import crypto from "node:crypto";
import { KNXService } from "../connection/KNXService";
import { DeviceDescriptorType0 } from "../core/resources/DeviceDescriptorType";
import { getKNXManufacturerName } from "../core/resources/KNXManufacturers";
import { RestartEraseCode } from "../management/apduBuilders";
import {
  KNXInterfaceObjectType,
  KnxIpInterfaceConfig,
  KnxIpInterfaceWriteConfig,
  KNXManagement,
  KNXManagementOptions,
  KNXManagementSession,
  KNXPropertyId,
  LoadEvent,
  LoadState,
  OpenSessionOptions,
} from "../management/KNXManagement";
import { parseKey16 } from "../security/KnxSecureKeys";
import { isCouplerMaskVersion, isPureBcu1MemoryOnlyMask, KnxProdParser, resolveManagementModel } from "./KnxProdParser";
import { LoadProcedureEngine } from "./LoadProcedureEngine";
import { computeDefaultSecuritySequenceNumber, SystemBCompiler } from "./SystemBCompiler";
import {
  CommissionSecureDeviceOptions,
  CommissionSecureDeviceResult,
  CompiledSystemBImage,
  DeviceApplicationConfig,
  DeviceDiagnosticsOptions,
  DeviceDiagnosticsReport,
  DeviceDownloadOptions,
  DeviceDownloadResult,
  DevicePreflightInfo,
  DownloadMode,
  DownloadPlan,
  DownloadProgressEvent,
  KnxApplicationProgram,
  KnxMaskVersion,
  KnxProdParseOptions,
  ParsedKnxProd,
  SecurityCommissioningImage,
} from "./types";

const PDT_GENERIC_02 = 0x12; // 18: 2-byte Association Table entry (1B TSAP + 1B ASAP)
const PDT_GENERIC_04 = 0x14; // 20: 4-byte Association Table entry (2B TSAP + 2B ASAP)
const PID_ROUTING_TABLE_CONTROL = 58; // Router Object (Type 6) Function Property to clear filter table (0x01)

/** Built-in KNX MaskVersion downward compatibility table (when knx_master.xml is not supplied). */
const BUILTIN_DOWNWARD_COMPATIBLE_MASKS: Record<number, number[]> = {
  0x0011: [0x0010],
  0x0012: [0x0010, 0x0011],
  0x0013: [0x0010, 0x0011, 0x0012],
  0x0020: [0x0010, 0x0011, 0x0012],
  0x0021: [0x0010, 0x0011, 0x0012, 0x0020],
  0x0025: [0x0010, 0x0011, 0x0012, 0x0020, 0x0021],
  0x1012: [0x1011],
  0x1013: [0x1011, 0x1012],
};

export type KnxProdSource = ParsedKnxProd | KnxApplicationProgram;

function unwrapSource(source: KnxProdSource): { knxProd?: ParsedKnxProd; app: KnxApplicationProgram } {
  if ("applications" in source) {
    if (source.applications.length === 0) {
      throw new Error("ParsedKnxProd contains no ApplicationProgram entries");
    }
    return { knxProd: source, app: source.applications[0] };
  }
  return { app: source };
}

function buffersEqualWithMask(actual: Buffer, expected: Buffer, mask?: Buffer): boolean {
  const len = Math.min(actual.length, expected.length);
  if (actual.length !== expected.length && !mask) return false;
  for (let i = 0; i < len; i++) {
    const m = mask && i < mask.length ? mask[i] : 0xff;
    if ((actual[i] & m) !== (expected[i] & m)) return false;
  }
  return true;
}

function isMaskCompatible(
  deviceMask: number,
  app: KnxApplicationProgram,
  maskVersions?: Map<string, KnxMaskVersion>,
): boolean {
  if (app.maskVersion === 0 || deviceMask === app.maskVersion) return true;
  // Check knx_master.xml DownwardCompatibleMasks on the physical device's MaskVersion
  if (maskVersions) {
    const devMvId = `MV-${deviceMask.toString(16).toUpperCase().padStart(4, "0")}`;
    const devMv = maskVersions.get(devMvId);
    if (devMv?.downwardCompatibleMasks.includes(app.maskVersionId)) {
      return true;
    }
  }
  // Built-in fallback compatibility table
  const compat = BUILTIN_DOWNWARD_COMPATIBLE_MASKS[deviceMask];
  return Boolean(compat && compat.includes(app.maskVersion));
}

/**
 * High-level multi-architecture KNX Application Program Downloader for real KNX devices:
 * - **System B** (`MV-07B0`, `17B0`, `27B0`, `2920`, `57B0`) + KNX Data Secure Object Type 17
 * - **System 7 / BIM M112** (`MV-0700`, `0701`, `0705`, `1900`, `2705`, `5705`)
 * - **System 2 / BCU2** (`MV-0020`, `0021`, `0025`)
 * - **System 1 / BCU1 & Couplers** (`MV-0010`–`0013`, `1011`–`1013`, `091A`, `0912`)
 * - **System 300 / PropertyBased** (`MV-0300`)
 *
 * Bridges `.knxprod` product catalogs (`KnxProdParser`), `<Dynamic>` evaluation (`DynamicEvaluator`),
 * binary compilation (`SystemBCompiler`), and `LoadProcedure` merging (`LoadProcedureEngine`)
 * directly onto `KNXManagement` / `KNXManagementSession`.
 */
export class KNXDeviceProgrammer {
  public readonly management: KNXManagement;

  constructor(managementOrService: KNXManagement | KNXService, managementOptions?: KNXManagementOptions) {
    if (managementOrService instanceof KNXManagement) {
      this.management = managementOrService;
    } else {
      this.management = new KNXManagement(managementOrService, managementOptions);
    }
  }

  /**
   * Loads and parses a `.knxprod` file from disk or Buffer.
   */
  public async loadKnxProd(source: string | Buffer, options?: KnxProdParseOptions): Promise<ParsedKnxProd> {
    if (Buffer.isBuffer(source)) {
      return KnxProdParser.parseBuffer(source, options);
    }
    return KnxProdParser.parseFile(source, options);
  }

  /**
   * Evaluates parameters & `<Dynamic>` rules and compiles a complete binary image (offline)
   * matching the application's KNX Management Model (`SystemB`, `BimM112`, `Bcu2`, `Bcu1`, `PropertyBased`).
   */
  public compile(source: KnxProdSource, config: DeviceApplicationConfig = {}): CompiledSystemBImage {
    const { knxProd, app } = unwrapSource(source);
    const maskVersionDef = config.maskVersionDef ?? knxProd?.maskVersions.get(app.maskVersionId);
    return SystemBCompiler.compile(app, { ...config, maskVersionDef });
  }

  /**
   * Builds a concrete `DownloadPlan` (offline dry-run) without touching the KNX bus.
   */
  public planDownload(
    source: KnxProdSource,
    config: DeviceApplicationConfig = {},
    options: Pick<
      DeviceDownloadOptions,
      | "mode"
      | "skipFillRuns"
      | "skipRestart"
      | "programSecurityObject"
      | "differentialWrite"
      | "previousSegments"
      | "previousAbsoluteSegments"
    > = {},
  ): { image: CompiledSystemBImage; plan: DownloadPlan } {
    const { knxProd, app } = unwrapSource(source);
    const maskVersionDef = config.maskVersionDef ?? knxProd?.maskVersions.get(app.maskVersionId);
    const image = SystemBCompiler.compile(app, { ...config, maskVersionDef });
    const plan = LoadProcedureEngine.buildPlan(app, image, options.mode ?? "ap1", {
      knxProd,
      maskVersion: maskVersionDef,
      skipFillRuns: options.skipFillRuns ?? true,
      skipRestart: options.skipRestart ?? false,
      programSecurityObject: options.programSecurityObject,
      differentialWrite: options.differentialWrite,
      previousSegments: options.previousSegments,
      previousAbsoluteSegments: options.previousAbsoluteSegments,
    });
    return { image, plan };
  }

  /**
   * Executes a complete or partial application download onto a real KNX device.
   *
   * Safety guarantees:
   * - Detects proprietary ETS Download Plugins / DCAs and fails fast unless `allowDcaOverride: true`.
   * - Validates `MaskVersion` (Device Descriptor Type 0, honoring `DownwardCompatibleMasks`), `ManufacturerId`,
   *   and expected `PID_HARDWARE_TYPE` before unloading or writing anything.
   * - Auto-detects `PID_MAX_APDULENGTH`, `GrOAT` format (`PDT_GENERIC_02` vs `PDT_GENERIC_04` on System B),
   *   and Interface Object indices by `ObjType` + `Occurrence` (`PID_IO_LIST`).
   * - Supports `dryRun: true` to run all compilation, planning, and read-only device checks without writing a single byte.
   */
  public async download(
    individualAddress: string,
    source: KnxProdSource,
    config: DeviceApplicationConfig = {},
    options: DeviceDownloadOptions = {},
  ): Promise<DeviceDownloadResult> {
    const startedAt = Date.now();
    const mode: DownloadMode = options.mode ?? "ap1";
    const dryRun = options.dryRun ?? false;
    const verifyDevice = options.verifyDeviceBeforeWrite ?? true;
    const strictHwCheck = options.strictHardwareTypeCheck ?? true;
    const interfaceMaxApdu = options.interfaceMaxApduLength ?? 220;
    const skipFillRuns = options.skipFillRuns ?? true;
    const verifyMemoryMode = options.verifyMemoryMode ?? "response";

    const { knxProd, app } = unwrapSource(source);

    // Fail fast on proprietary ETS Download Plugins / DCAs unless explicitly overridden
    if (mode !== "unload" && app.extension?.hasDownloadPlugin && !options.allowDcaOverride) {
      const reasons: string[] = [];
      if (app.extension.etsDownloadPlugin) reasons.push(`EtsDownloadPlugin="${app.extension.etsDownloadPlugin}"`);
      if (app.extension.etsDataHandler) reasons.push(`EtsDataHandler="${app.extension.etsDataHandler}"`);
      if (app.extension.requiresExternalSoftware) reasons.push(`RequiresExternalSoftware="true"`);
      if (app.extension.downloadInfoIncomplete) reasons.push(`DownloadInfoIncomplete="true"`);
      throw new Error(
        `Application "${app.name}" (${app.id}) requires a proprietary ETS Download Plugin / DCA (${reasons.join(", ")}) and cannot be compiled/downloaded generically without ETS. Pass allowDcaOverride: true only if you have verified that standard XML memory segments are sufficient.`,
      );
    }

    const maskVersionDef = config.maskVersionDef ?? knxProd?.maskVersions.get(app.maskVersionId);
    const effectiveConfig: DeviceApplicationConfig = {
      ...config,
      individualAddress: config.individualAddress ?? individualAddress,
      maskVersionDef,
    };

    const useDifferential =
      options.differentialWrite ??
      ((mode === "par" || mode === "par,grp") &&
        Boolean(options.previousSegments?.size || options.previousAbsoluteSegments?.size));

    let image = SystemBCompiler.compile(app, effectiveConfig);
    let plan = LoadProcedureEngine.buildPlan(app, image, mode, {
      knxProd,
      maskVersion: maskVersionDef,
      skipFillRuns,
      skipRestart: options.skipRestart ?? false,
      programSecurityObject: options.programSecurityObject,
      differentialWrite: options.differentialWrite,
      previousSegments: options.previousSegments,
      previousAbsoluteSegments: options.previousAbsoluteSegments,
    });

    const executedSteps: string[] = [];
    const loadedStamps = new Map<string, Buffer>();
    let bytesWritten = 0;
    let framesSent = 0;
    let preflight: DevicePreflightInfo | undefined;

    const emitProgress = (
      stepIndex: number,
      totalSteps: number,
      phase: DownloadProgressEvent["phase"],
      message: string,
    ) => {
      if (!options.onProgress) return;
      const totalBytes = Math.max(1, plan.estimatedBytesToWrite);
      const percent = Math.min(100, Math.round((bytesWritten / totalBytes) * 100));
      options.onProgress({
        stepIndex,
        totalSteps,
        phase,
        message,
        bytesWritten,
        totalBytes: plan.estimatedBytesToWrite,
        percent,
      });
    };

    const session = await this.management.openSession(individualAddress, options.sessionOptions);
    try {
      // ======================================================================
      // PHASE 1: Pre-flight Discovery & Hardware Safety Verification
      // ======================================================================
      emitProgress(0, plan.actions.length, "verify", `Inspecting device ${individualAddress}`);
      preflight = await this.runPreflight(session, app, image, {
        authorizeKey: options.authorizeKey ?? 0xffffffff,
        interfaceMaxApdu,
        verifyDevice,
        strictHwCheck,
        explicitGroatFormat: config.associationTableFormat,
        isSecureSession: Boolean(options.sessionOptions?.secure),
        maskVersions: knxProd?.maskVersions,
      });
      executedSteps.push(
        `Preflight OK: mask=0x${preflight.maskVersion.toString(16).padStart(4, "0")} (${image.managementModel}), maxAPDU=${preflight.maxApduLength} (effective=${preflight.effectiveMaxApduLength}), mfr=0x${(preflight.manufacturerId ?? 0).toString(16).padStart(4, "0")}, GrOAT=Format${preflight.associationTableFormat}`,
      );

      // Recompile GrOAT + Plan if live System B device uses a different GrOAT format than inferred offline
      if (
        image.managementModel === "SystemB" &&
        !isCouplerMaskVersion(app.maskVersion) &&
        preflight.associationTableFormat !== image.associationTableFormat
      ) {
        image = SystemBCompiler.recompileAssociationTable(image, preflight.associationTableFormat);
        plan = LoadProcedureEngine.buildPlan(app, image, mode, {
          knxProd,
          maskVersion: maskVersionDef,
          skipFillRuns,
          skipRestart: options.skipRestart ?? false,
          programSecurityObject: options.programSecurityObject,
          differentialWrite: options.differentialWrite,
          previousSegments: options.previousSegments,
          previousAbsoluteSegments: options.previousAbsoluteSegments,
        });
        executedSteps.push(
          `Recompiled GrOAT to Format ${preflight.associationTableFormat} (${image.associationTable.length} bytes)`,
        );
      }

      if (dryRun) {
        executedSteps.push(
          `Dry-run complete: ${plan.actions.length} steps planned (${image.managementModel}), ${plan.estimatedBytesToWrite} bytes would be written`,
        );
        await session.close(true);
        return {
          individualAddress,
          mode,
          dryRun: true,
          preflight,
          plan,
          image,
          bytesWritten: 0,
          framesSent: 0,
          durationMs: Date.now() - startedAt,
          loadedStamps,
          executedSteps,
        };
      }

      // ======================================================================
      // PHASE 2: Execute Merged / Product LoadProcedure Actions
      // ======================================================================
      const totalSteps = plan.actions.length;
      const savedImageProps = new Map<string, Buffer>();
      const savedImageMem = new Map<string, Buffer>();
      let ioListByType: Map<number, number[]> | null = null;
      let pendingToolKeyUpdate: Buffer | undefined;
      const isSecureSession = Boolean(options.sessionOptions?.secure);
      // KNX Data Secure (S-A_Data, 03_03_07 §5.2) adds 13 octets to APDU length:
      // 1B APCISec-lo + 1B SCF + 6B SeqNr + 1B inner APCI-hi + 4B MAC
      const secureOverhead = isSecureSession ? 13 : 0;
      const useExtendedMemory =
        app.options.supportsExtendedMemoryServices && preflight.effectiveMaxApduLength >= 15 + secureOverhead;
      // Plain Extended Memory Write APDU overhead: 1B APCI-lo + 1B count + 3B addr24 = 5B (+13B if Data Secure = 18B)
      const maxExtChunk = Math.min(250, Math.max(1, preflight.effectiveMaxApduLength - 5 - secureOverhead));
      const maxStdChunk = Math.min(
        63,
        Math.max(1, Math.min(12, preflight.effectiveMaxApduLength - 3 - secureOverhead)),
      );
      const maxUserChunk = Math.min(
        15,
        Math.max(1, Math.min(11, preflight.effectiveMaxApduLength - 4 - secureOverhead)),
      );

      const resolveObjectIndex = async (objIdx?: number, objType?: number, occurrence?: number): Promise<number> => {
        if (objIdx !== undefined) return objIdx;
        if (objType === undefined) return 0;
        if (!ioListByType) {
          ioListByType = await this.discoverInterfaceObjectIndices(session);
        }
        const matches = ioListByType.get(objType);
        if (matches && matches.length > 0) {
          const occ = occurrence ?? 0;
          return matches[occ] ?? matches[0];
        }
        // Standard KNX fallback object indices when PID_IO_LIST isn't exposed
        if (objType === 0) return 0;
        if (objType === 1) return 1;
        if (objType === 2) return 2;
        if (objType === 3) return 3;
        if (objType === 6) return occurrence === 1 ? 2 : 1;
        throw new Error(
          `Unable to resolve Interface Object index for ObjType=${objType} (Occurrence=${occurrence ?? 0}) on ${individualAddress}`,
        );
      };

      for (let idx = 0; idx < totalSteps; idx++) {
        const action = plan.actions[idx];

        switch (action.type) {
          case "Connect":
            executedSteps.push("Connect (active session)");
            break;

          case "Disconnect":
            await session.close(true);
            executedSteps.push("Disconnect");
            break;

          case "Authorize": {
            const level = await session.authorize(action.key);
            executedSteps.push(`Authorize -> level ${level}`);
            break;
          }

          case "Unload": {
            const targetIdx = await resolveObjectIndex(action.lsmIdx, action.objType, action.occurrence);
            emitProgress(idx, totalSteps, "unload", `Unloading LSM ${targetIdx}`);
            try {
              const st = await session.writeLoadState(targetIdx, LoadEvent.UNLOAD);
              if (st !== LoadState.UNLOADED && !action.ignoreErrors) {
                throw new Error(`LSM ${targetIdx} unload returned state ${LoadState[st] ?? st}`);
              }
              executedSteps.push(`Unload LSM ${targetIdx} -> ${LoadState[st] ?? st}`);
            } catch (err: any) {
              if (!action.ignoreErrors) throw err;
              executedSteps.push(`Unload LSM ${targetIdx} ignored (${err?.message ?? err})`);
            }
            break;
          }

          case "LoadStart": {
            const targetIdx = await resolveObjectIndex(action.lsmIdx, action.objType, action.occurrence);
            emitProgress(idx, totalSteps, "allocate", `Start loading LSM ${targetIdx}`);
            const st = await session.writeLoadState(targetIdx, LoadEvent.START_LOADING);
            if (st !== LoadState.LOADING) {
              await this.throwWithLsmError(session, targetIdx, `START_LOADING returned state ${LoadState[st] ?? st}`);
            }
            executedSteps.push(`LoadStart LSM ${targetIdx} -> LOADING`);
            break;
          }

          case "AllocRelSegment": {
            const targetIdx = await resolveObjectIndex(action.lsmIdx, action.objType, action.occurrence);
            emitProgress(idx, totalSteps, "allocate", `Allocating ${action.size} B for LSM ${targetIdx}`);
            // 03_05_02 §3.31.3.4 Load Event Data Relative Allocation (0x03 0x0B <size:4B> <mode:1B> <fill:1B> 00 00)
            const payload = Buffer.alloc(9, 0x00);
            payload.writeUInt8(0x0b, 0);
            payload.writeUInt32BE(action.size >>> 0, 1);
            payload.writeUInt8(action.mode & 0xff, 5);
            payload.writeUInt8(action.fill & 0xff, 6);
            const st = await session.writeLoadState(targetIdx, LoadEvent.ADDITIONAL_LOAD_CONTROLS, payload);
            if (st !== LoadState.LOADING) {
              await this.throwWithLsmError(
                session,
                targetIdx,
                `AllocRelSegment(${action.size} B, mode=${action.mode}, fill=${action.fill}) returned ${LoadState[st] ?? st}`,
              );
            }
            executedSteps.push(
              `AllocRelSegment LSM ${targetIdx}: size=${action.size}, mode=${action.mode}, fill=0x${action.fill.toString(16).padStart(2, "0")} -> LOADING`,
            );
            break;
          }

          case "AllocAbsSegment": {
            emitProgress(
              idx,
              totalSteps,
              "allocate",
              `Allocating absolute segment LSM ${action.lsmIdx} @ 0x${action.address.toString(16).toUpperCase()} (${action.size} B)`,
            );
            // 03_05_02 §3.31.3.4.1 Data Segment Allocation (0x03 <0x01|0x02> <addr:2B> <size:2B> <access:1B> <memType:1B> <segFlags:1B> 00)
            const payload = Buffer.alloc(9, 0x00);
            payload.writeUInt8(action.segType === 1 ? 0x02 : 0x01, 0);
            payload.writeUInt16BE(action.address & 0xffff, 1);
            payload.writeUInt16BE(action.size & 0xffff, 3);
            payload.writeUInt8(action.access & 0xff, 5);
            payload.writeUInt8(action.memType & 0xff, 6);
            payload.writeUInt8(action.segFlags & 0xff, 7);
            const st = await session.writeLoadState(action.lsmIdx, LoadEvent.ADDITIONAL_LOAD_CONTROLS, payload);
            if (st !== LoadState.LOADING) {
              await this.throwWithLsmError(
                session,
                action.lsmIdx,
                `AllocAbsSegment(0x${action.address.toString(16)}, ${action.size} B) returned ${LoadState[st] ?? st}`,
              );
            }
            executedSteps.push(
              `AllocAbsSegment LSM ${action.lsmIdx}: addr=0x${action.address.toString(16).padStart(4, "0")}, size=${action.size}, memType=${action.memType} -> LOADING`,
            );
            break;
          }

          case "TaskSegment": {
            emitProgress(
              idx,
              totalSteps,
              "allocate",
              `Configuring TaskSegment LSM ${action.lsmIdx} @ 0x${action.address.toString(16).toUpperCase()}`,
            );
            // 03_05_02 §3.31.3.4.2 Data Task Segment (0x03 0x03 <addr:2B> <peiType:1B> <mfrId:2B> <appId:2B> <appVer:1B>)
            const payload = Buffer.alloc(9, 0x00);
            payload.writeUInt8(0x03, 0);
            payload.writeUInt16BE(action.address & 0xffff, 1);
            payload.writeUInt8(app.peiType & 0xff, 3);
            payload.writeUInt16BE(app.manufacturerId & 0xffff, 4);
            payload.writeUInt16BE(app.applicationNumber & 0xffff, 6);
            payload.writeUInt8(app.applicationVersion & 0xff, 8);
            const st = await session.writeLoadState(action.lsmIdx, LoadEvent.ADDITIONAL_LOAD_CONTROLS, payload);
            if (st !== LoadState.LOADING && st !== LoadState.LOADED) {
              await this.throwWithLsmError(
                session,
                action.lsmIdx,
                `TaskSegment(0x${action.address.toString(16)}) returned ${LoadState[st] ?? st}`,
              );
            }
            executedSteps.push(
              `TaskSegment LSM ${action.lsmIdx}: addr=0x${action.address.toString(16).padStart(4, "0")} -> ${LoadState[st] ?? st}`,
            );
            break;
          }

          case "TaskPtr": {
            emitProgress(idx, totalSteps, "allocate", `Configuring TaskPtr LSM ${action.lsmIdx}`);
            // 03_05_02 §3.31.3.4.3 Data Task Pointer (0x03 0x04 <init:2B> <save:2B> <serial:2B> 00 00)
            const payload = Buffer.alloc(9, 0x00);
            payload.writeUInt8(0x04, 0);
            payload.writeUInt16BE(action.initPtr & 0xffff, 1);
            payload.writeUInt16BE(action.savePtr & 0xffff, 3);
            payload.writeUInt16BE(action.serialPtr & 0xffff, 5);
            const st = await session.writeLoadState(action.lsmIdx, LoadEvent.ADDITIONAL_LOAD_CONTROLS, payload);
            if (st !== LoadState.LOADING) {
              await this.throwWithLsmError(session, action.lsmIdx, `TaskPtr returned ${LoadState[st] ?? st}`);
            }
            executedSteps.push(
              `TaskPtr LSM ${action.lsmIdx}: init=0x${action.initPtr.toString(16)}, save=0x${action.savePtr.toString(16)}, serial=0x${action.serialPtr.toString(16)}`,
            );
            break;
          }

          case "TaskCtrl1": {
            emitProgress(idx, totalSteps, "allocate", `Configuring TaskCtrl1 LSM ${action.lsmIdx}`);
            // 03_05_02 §3.31.3.4.4 Data Task Control 1 (0x03 0x05 <addr:2B> <count:1B> 00..00)
            const payload = Buffer.alloc(9, 0x00);
            payload.writeUInt8(0x05, 0);
            payload.writeUInt16BE(action.address & 0xffff, 1);
            payload.writeUInt8(action.count & 0xff, 3);
            const st = await session.writeLoadState(action.lsmIdx, LoadEvent.ADDITIONAL_LOAD_CONTROLS, payload);
            if (st !== LoadState.LOADING) {
              await this.throwWithLsmError(session, action.lsmIdx, `TaskCtrl1 returned ${LoadState[st] ?? st}`);
            }
            executedSteps.push(
              `TaskCtrl1 LSM ${action.lsmIdx}: addr=0x${action.address.toString(16)}, count=${action.count}`,
            );
            break;
          }

          case "TaskCtrl2": {
            emitProgress(idx, totalSteps, "allocate", `Configuring TaskCtrl2 LSM ${action.lsmIdx}`);
            // 03_05_02 §3.31.3.4.5 Data Task Control 2 (0x03 0x06 <cb:2B> <addr:2B> <seg0:2B> <seg1:2B>)
            const payload = Buffer.alloc(9, 0x00);
            payload.writeUInt8(0x06, 0);
            payload.writeUInt16BE(action.callback & 0xffff, 1);
            payload.writeUInt16BE(action.address & 0xffff, 3);
            payload.writeUInt16BE(action.seg0 & 0xffff, 5);
            payload.writeUInt16BE(action.seg1 & 0xffff, 7);
            const st = await session.writeLoadState(action.lsmIdx, LoadEvent.ADDITIONAL_LOAD_CONTROLS, payload);
            if (st !== LoadState.LOADING) {
              await this.throwWithLsmError(session, action.lsmIdx, `TaskCtrl2 returned ${LoadState[st] ?? st}`);
            }
            executedSteps.push(
              `TaskCtrl2 LSM ${action.lsmIdx}: cb=0x${action.callback.toString(16)}, addr=0x${action.address.toString(16)}`,
            );
            break;
          }

          case "WriteRelMem": {
            const targetIdx = await resolveObjectIndex(action.objIdx, action.objType, action.occurrence);
            const ptrResp = await session.readProperty({
              objectIndex: targetIdx,
              propertyId: KNXPropertyId.PID_TABLE_REFERENCE,
              count: 1,
              startIndex: 1,
            });
            if (ptrResp.count === 0 || ptrResp.data.length < 2) {
              throw new Error(`Unable to read PID_TABLE_REFERENCE for Object ${targetIdx}`);
            }
            const baseAddr = ptrResp.data.length >= 4 ? ptrResp.data.readUInt32BE(0) : ptrResp.data.readUInt16BE(0);
            if (baseAddr === 0) {
              throw new Error(`Memory allocation failed on Object ${targetIdx}: PID_TABLE_REFERENCE is 0x00000000`);
            }

            const spans =
              action.objType === 6 && image.filterTable
                ? [
                    {
                      offset: action.offset,
                      data: image.filterTable.subarray(action.offset, action.offset + action.size),
                    },
                  ]
                : this.resolveSpansForObject(image, targetIdx, action.offset, action.size, {
                    mode: action.mode,
                    fill: action.fill,
                    skipFillRuns,
                    previousImage:
                      useDifferential && action.mode !== 1 ? options.previousSegments?.get(targetIdx) : undefined,
                  });

            let objBytes = 0;
            for (const span of spans) {
              const absAddr = baseAddr + span.offset;
              await this.writeMemorySpan(session, absAddr, span.data, {
                useExtendedMemory,
                maxExtChunk,
                maxStdChunk,
                maxUserChunk,
                verify: action.verify,
                verifyMemoryMode,
                onChunkWritten: (chunkBytes) => {
                  bytesWritten += chunkBytes;
                  objBytes += chunkBytes;
                  framesSent++;
                  emitProgress(
                    idx,
                    totalSteps,
                    "write_memory",
                    `Writing Object ${targetIdx} @ 0x${absAddr.toString(16).toUpperCase()} (${bytesWritten}/${plan.estimatedBytesToWrite} B)`,
                  );
                },
              });
            }

            executedSteps.push(
              `WriteRelMem Obj ${targetIdx} @ 0x${baseAddr.toString(16).padStart(6, "0")}: ${objBytes} B in ${spans.length} span(s)`,
            );
            break;
          }

          case "WriteAbsMem": {
            if (action.addressSpace === "LcSlave") {
              executedSteps.push(`WriteAbsMem (LcSlave) @ 0x${action.address.toString(16)} skipped on remote bus`);
              break;
            }
            let payloadData = action.data;
            if (action.restoreFromLoadedImage) {
              const saved = savedImageMem.get(`${action.address}:${action.data.length}`);
              if (saved) payloadData = saved;
            }
            if (action.addressSpace === "UserMemory") {
              const doVerify = action.verify && verifyMemoryMode !== "none";
              let offset = 0;
              while (offset < payloadData.length) {
                const chunk = payloadData.subarray(offset, offset + maxUserChunk);
                await session.writeUserMemory(action.address + offset, chunk, {
                  verify: doVerify,
                  maxChunkSize: chunk.length,
                });
                bytesWritten += chunk.length;
                framesSent++;
                emitProgress(
                  idx,
                  totalSteps,
                  "write_memory",
                  `Writing UserMemory @ 0x${(action.address + offset).toString(16).toUpperCase()}`,
                );
                offset += chunk.length;
              }
            } else {
              await this.writeMemorySpan(session, action.address, payloadData, {
                useExtendedMemory,
                maxExtChunk,
                maxStdChunk,
                maxUserChunk,
                verify: action.verify,
                verifyMemoryMode,
                onChunkWritten: (chunkBytes) => {
                  bytesWritten += chunkBytes;
                  framesSent++;
                  emitProgress(
                    idx,
                    totalSteps,
                    "write_memory",
                    `Writing ${action.addressSpace ?? "Standard"} memory @ 0x${action.address.toString(16).toUpperCase()}`,
                  );
                },
              });
            }
            executedSteps.push(
              `WriteAbsMem (${action.addressSpace ?? "Standard"}) @ 0x${action.address.toString(16).padStart(4, "0")}: ${payloadData.length} B`,
            );
            break;
          }

          case "LoadImageMem": {
            emitProgress(
              idx,
              totalSteps,
              "verify",
              `Reading memory image @ 0x${action.address.toString(16).toUpperCase()} (${action.size} B)`,
            );
            const readBuf =
              action.addressSpace === "UserMemory" || action.address + action.size > 0x10000
                ? await session.readUserMemory(action.address, action.size, { maxChunkSize: maxUserChunk })
                : await session.readMemory(action.address, action.size, { maxChunkSize: maxStdChunk });
            const memKey = `${action.address}:${action.size}`;
            savedImageMem.set(memKey, readBuf);
            loadedStamps.set(`mem:${memKey}`, readBuf);
            executedSteps.push(
              `LoadImageMem @ 0x${action.address.toString(16).padStart(4, "0")} (${action.size} B) = ${readBuf.toString("hex").toUpperCase()}`,
            );
            break;
          }

          case "CompareMem": {
            emitProgress(
              idx,
              totalSteps,
              "verify",
              `Comparing memory @ 0x${action.address.toString(16).toUpperCase()} (${action.size} B)`,
            );
            const actual =
              action.addressSpace === "UserMemory" || action.address + action.size > 0x10000
                ? await session.readUserMemory(action.address, action.size, { maxChunkSize: maxUserChunk })
                : await session.readMemory(action.address, action.size, { maxChunkSize: maxStdChunk });
            const expected = action.compareWithLoadedImage
              ? savedImageMem.get(`${action.address}:${action.size}`)
              : action.expected;
            if (expected && !buffersEqualWithMask(actual, expected, action.mask)) {
              throw new Error(
                `LdCtrlCompareMem mismatch @ 0x${action.address.toString(16)}: expected ${expected.toString("hex").toUpperCase()}, got ${actual.toString("hex").toUpperCase()}`,
              );
            }
            executedSteps.push(`CompareMem @ 0x${action.address.toString(16).padStart(4, "0")} OK`);
            break;
          }

          case "ClearLCFilterTable": {
            emitProgress(idx, totalSteps, "allocate", "Clearing Line/Area Coupler filter table");
            if (action.useFunctionProp) {
              const routerIdx = await resolveObjectIndex(undefined, action.objType ?? 6, action.occurrence ?? 0);
              try {
                await session.callFunctionProperty({
                  objectIndex: routerIdx,
                  propertyId: PID_ROUTING_TABLE_CONTROL,
                  data: Buffer.from([0x01]),
                });
                executedSteps.push(
                  `ClearLCFilterTable (FunctionProp Obj ${routerIdx} PID ${PID_ROUTING_TABLE_CONTROL}) OK`,
                );
              } catch (err: any) {
                executedSteps.push(
                  `ClearLCFilterTable (FunctionProp Obj ${routerIdx}) fallback ignored (${err?.message ?? err})`,
                );
              }
            } else {
              executedSteps.push("ClearLCFilterTable (memory clear handled by write)");
            }
            break;
          }

          case "WriteProp": {
            const targetIdx = await resolveObjectIndex(action.objIdx, action.objType, action.occurrence);
            emitProgress(idx, totalSteps, "write_property", `Writing Obj ${targetIdx} PID ${action.propId}`);
            await session.writeProperty(
              {
                objectIndex: targetIdx,
                propertyId: action.propId,
                startIndex: action.startElement,
                count: action.count,
                data: action.data,
              },
              { verify: action.verify },
            );
            executedSteps.push(
              `WriteProp Obj ${targetIdx} PID ${action.propId} [${action.startElement}..+${action.count}] = ${action.data.toString("hex").toUpperCase()}`,
            );
            break;
          }

          case "LoadImageProp": {
            const targetIdx = await resolveObjectIndex(action.objIdx, action.objType, action.occurrence);
            emitProgress(idx, totalSteps, "finalize", `Reading image property Obj ${targetIdx} PID ${action.propId}`);
            try {
              const resp = await session.readProperty({
                objectIndex: targetIdx,
                propertyId: action.propId,
                startIndex: action.startElement,
                count: action.count,
              });
              const propKey = `${targetIdx}:${action.propId}:${action.startElement}`;
              savedImageProps.set(propKey, resp.data);
              loadedStamps.set(propKey, resp.data);
              executedSteps.push(
                `LoadImageProp Obj ${targetIdx} PID ${action.propId} = ${resp.data.toString("hex").toUpperCase()}`,
              );
            } catch (err: any) {
              // Some devices don't expose PID_MCB_TABLE (27) on all objects; record non-fatal note
              executedSteps.push(
                `LoadImageProp Obj ${targetIdx} PID ${action.propId} skipped (${err?.message ?? err})`,
              );
            }
            break;
          }

          case "CompareProp": {
            const targetIdx = await resolveObjectIndex(action.objIdx, action.objType, action.occurrence);
            emitProgress(idx, totalSteps, "verify", `Comparing Obj ${targetIdx} PID ${action.propId}`);
            const resp = await session.readProperty({
              objectIndex: targetIdx,
              propertyId: action.propId,
              startIndex: action.startElement,
              count: action.count,
            });
            const propKey = `${targetIdx}:${action.propId}:${action.startElement}`;
            const expected = action.compareWithLoadedImage ? savedImageProps.get(propKey) : action.expected;
            if (expected && !buffersEqualWithMask(resp.data, expected, action.mask)) {
              throw new Error(
                `LdCtrlCompareProp mismatch on Obj ${targetIdx} PID ${action.propId}: expected ${expected.toString("hex").toUpperCase()}, got ${resp.data.toString("hex").toUpperCase()} (partial download incompatible; run full download instead)`,
              );
            }
            executedSteps.push(`CompareProp Obj ${targetIdx} PID ${action.propId} OK`);
            break;
          }

          case "LoadCompleted": {
            const targetIdx = await resolveObjectIndex(action.lsmIdx, action.objType, action.occurrence);
            emitProgress(idx, totalSteps, "finalize", `Completing load on LSM ${targetIdx}`);
            const st = await session.writeLoadState(targetIdx, LoadEvent.LOAD_COMPLETED);
            if (st !== LoadState.LOADED) {
              await this.throwWithLsmError(session, targetIdx, `LOAD_COMPLETED returned state ${LoadState[st] ?? st}`);
            }
            executedSteps.push(`LoadCompleted LSM ${targetIdx} -> LOADED`);
            break;
          }

          case "ProgramSecurityObject": {
            const sec = image.securityImage;
            if (!sec) break;
            if (!isSecureSession) {
              throw new Error(
                "Programming Security Interface Object (Type 17) requires a KNX Data Secure management session (pass sessionOptions: { secure: true })",
              );
            }
            const secStats = await this.programSecurityObject(
              session,
              sec,
              preflight.effectiveMaxApduLength,
              (msg, deltaBytes, deltaFrames) => {
                bytesWritten += deltaBytes;
                framesSent += deltaFrames;
                emitProgress(idx, totalSteps, "security", msg);
              },
            );
            if (sec.toolKey) {
              // Defer local ToolKey rotation until AFTER A_Restart so A_Restart stays encrypted with the active ToolKey!
              pendingToolKeyUpdate = Buffer.from(sec.toolKey);
            }
            executedSteps.push(...secStats.steps);
            break;
          }

          case "Delay": {
            if (!options.skipDelay && action.milliseconds > 0) {
              await new Promise((resolve) => setTimeout(resolve, action.milliseconds));
            }
            executedSteps.push(`Delay ${action.milliseconds} ms${options.skipDelay ? " (skipped)" : ""}`);
            break;
          }

          case "MasterReset": {
            emitProgress(
              idx,
              totalSteps,
              "restart",
              `MasterReset device ${individualAddress} (eraseCode=${action.eraseCode})`,
            );
            await session.restart({
              type: "master",
              eraseCode: action.eraseCode as RestartEraseCode,
              channelNumber: action.channelNumber,
            });
            executedSteps.push(`MasterReset (eraseCode=${action.eraseCode}, channel=${action.channelNumber})`);
            break;
          }

          case "Restart": {
            emitProgress(idx, totalSteps, "restart", `Restarting device ${individualAddress}`);
            await session.restart({ type: "basic" });
            if (pendingToolKeyUpdate) {
              this.management.dataSecure?.setDeviceToolKey(individualAddress, pendingToolKeyUpdate);
              pendingToolKeyUpdate = undefined;
            }
            executedSteps.push("Restart (basic A_Restart)");
            break;
          }
        }
      }

      if (pendingToolKeyUpdate) {
        this.management.dataSecure?.setDeviceToolKey(individualAddress, pendingToolKeyUpdate);
      }
    } finally {
      if (session.isConnected) {
        await session.close(true).catch(() => {});
      }
    }

    return {
      individualAddress,
      mode,
      dryRun: false,
      preflight,
      plan,
      image,
      bytesWritten,
      framesSent,
      durationMs: Date.now() - startedAt,
      loadedStamps,
      executedSteps,
    };
  }

  /**
   * Unloads all loadable objects on a KNX device (System B, BIM M112, BCU2, BCU1, or Couplers).
   */
  public async unload(
    individualAddress: string,
    source: KnxProdSource,
    options: Omit<DeviceDownloadOptions, "mode"> = {},
  ): Promise<DeviceDownloadResult> {
    return this.download(individualAddress, source, {}, { ...options, mode: "unload", skipRestart: true });
  }

  /**
   * Executes initial KNX Data Secure commissioning of a factory-new device (`FDSK -> ToolKey`)
   * per KNX Standard `03_05_03` §1.5.4.4–1.5.4.5:
   * 1. Opens a Data Secure Tool-Access (`SCF.T=1`, `SAI=1`) session authenticated with the device's FDSK.
   * 2. Optionally initializes `PID_SEQUENCE_NUMBER_SENDING` (PID 59) if lower than target.
   * 3. Enables `PID_SECURITY_MODE = 1` (PID 51).
   * 4. Writes the new 16-byte `ToolKey` to `PID_TOOL_KEY` (PID 56) and registers it in the local `KnxDataSecure` manager.
   * 5. Executes a Confirmed Restart (`A_Restart` Master Reset `eraseCode = 0x01`) so the new ToolKey takes effect.
   */
  public async commissionSecureDevice(
    individualAddress: string,
    options: CommissionSecureDeviceOptions,
  ): Promise<CommissionSecureDeviceResult> {
    const dataSecure = this.management.dataSecure;
    if (!dataSecure) {
      throw new Error(
        "commissionSecureDevice requires a KnxDataSecure manager configured on KNXManagement or KNXService",
      );
    }

    const fdskBuf = parseKey16(options.fdsk, "fdsk");
    const newToolKey = options.toolKey ? parseKey16(options.toolKey, "toolKey") : crypto.randomBytes(16);
    const objInst = options.objectInstance ?? 1;
    const enableSecurityMode = options.enableSecurityMode ?? true;
    const restartAfter = options.restartAfterCommissioning ?? true;
    const executedSteps: string[] = [];

    // Register FDSK on KnxDataSecure so KNXService.processIncomingCemi can decrypt incoming FDSK responses
    dataSecure.setDeviceFdsk(individualAddress, fdskBuf);

    const session = await this.management.openSession(individualAddress, {
      secure: {
        manager: dataSecure,
        toolAccess: true,
        key: fdskBuf,
        confidentiality: true,
        autoSync: true,
      },
    });

    let writtenSeqNr: bigint | undefined;
    let restarted = false;

    try {
      executedSteps.push(`Opened Data Secure session to ${individualAddress} using FDSK`);

      // Step 1: Optionally initialize PID_SEQUENCE_NUMBER_SENDING if lower than target
      if (options.initialSequenceNumberSending !== false) {
        const targetSeq =
          options.initialSequenceNumberSending === undefined || options.initialSequenceNumberSending === "auto"
            ? computeDefaultSecuritySequenceNumber()
            : typeof options.initialSequenceNumberSending === "bigint"
              ? options.initialSequenceNumberSending
              : BigInt(Math.max(1, Math.trunc(options.initialSequenceNumberSending)));

        let currentSeq = 0n;
        try {
          currentSeq = await session.readSequenceNumberSending(objInst);
        } catch {
          // Device may reject reading SeqNr before mode/init; proceed to write
        }

        if (currentSeq < targetSeq) {
          await session.writeSequenceNumberSending(targetSeq, objInst);
          writtenSeqNr = targetSeq;
          executedSteps.push(`Initialized PID_SEQUENCE_NUMBER_SENDING = ${targetSeq.toString()}`);
        } else {
          writtenSeqNr = currentSeq;
          executedSteps.push(`Kept existing PID_SEQUENCE_NUMBER_SENDING = ${currentSeq.toString()}`);
        }
      }

      // Step 2: Enable Security Mode (PID_SECURITY_MODE = 1)
      if (enableSecurityMode) {
        await session.writeSecurityMode(true, objInst);
        executedSteps.push("Enabled PID_SECURITY_MODE = 1");
      }

      // Step 3: Write new ToolKey (PID_TOOL_KEY)
      await session.writeToolKey(newToolKey, objInst);
      executedSteps.push("Wrote new 16-byte PID_TOOL_KEY");

      // Step 4: Confirmed Restart (03_05_03 §1.5.4.5) while FDSK is still active
      if (restartAfter) {
        await session.restart({
          type: "master",
          eraseCode: RestartEraseCode.CONFIRMED_RESTART,
        });
        restarted = true;
        executedSteps.push("Executed Confirmed Restart (eraseCode=0x01)");
      }

      // Activate new ToolKey locally after device accepted it & restarted
      dataSecure.setDeviceToolKey(individualAddress, newToolKey);
      executedSteps.push("Updated local KnxDataSecure manager with new ToolKey");
    } finally {
      if (session.isConnected) {
        await session.close(true).catch(() => {});
      }
    }

    return {
      individualAddress,
      toolKey: Buffer.from(newToolKey),
      toolKeyHex: newToolKey.toString("hex").toUpperCase(),
      securityModeEnabled: enableSecurityMode,
      sequenceNumberSending: writtenSeqNr,
      restarted,
      executedSteps,
    };
  }

  /**
   * Reads the KNXnet/IP Parameter Object (Object Type 11, 03_08_03 §2.5) configuration from a KNXnet/IP Interface or Router.
   * Auto-discovers Object Type 11 via `PID_IO_LIST` unless `options.objectIndex` is supplied.
   */
  public async readIpInterfaceConfig(
    individualAddress: string,
    options: {
      objectIndex?: number;
      authorizeKey?: number | Buffer;
      sessionOptions?: OpenSessionOptions;
    } = {},
  ): Promise<KnxIpInterfaceConfig> {
    return this.management.withSession(
      individualAddress,
      async (session) => {
        if (!options.sessionOptions?.secure) {
          try {
            await session.authorize(options.authorizeKey ?? 0xffffffff);
          } catch {
            // Optional on devices without access control
          }
        }
        let objIdx = options.objectIndex;
        if (objIdx === undefined) {
          const ioMap = await this.discoverInterfaceObjectIndices(session);
          const matches = ioMap.get(KNXInterfaceObjectType.KNXNETIP_PARAMETER_OBJECT);
          if (!matches || matches.length === 0) {
            throw new Error(
              `Device ${individualAddress} does not expose a KNXnet/IP Parameter Object (Object Type 11)`,
            );
          }
          objIdx = matches[0];
        }
        return session.readIpParameterConfig(objIdx);
      },
      options.sessionOptions,
    );
  }

  /**
   * Configures the KNXnet/IP Parameter Object (Object Type 11, 03_08_03 §2.5) on a KNXnet/IP Interface or Router
   * (static IP, subnet mask, gateway, DHCP/Manual assignment, routing multicast, TTL, friendly name, additional tunneling IAs).
   * Performs a basic `A_Restart` by default (`restart: true`) so the new network configuration takes effect.
   */
  public async configureIpInterface(
    individualAddress: string,
    config: KnxIpInterfaceWriteConfig,
    options: {
      objectIndex?: number;
      authorizeKey?: number | Buffer;
      restart?: boolean;
      readBack?: boolean;
      sessionOptions?: OpenSessionOptions;
    } = {},
  ): Promise<{
    individualAddress: string;
    objectIndex: number;
    writtenProperties: string[];
    restarted: boolean;
    configAfterWrite?: KnxIpInterfaceConfig;
  }> {
    const restart = options.restart ?? true;
    const session = await this.management.openSession(individualAddress, options.sessionOptions);
    try {
      if (!options.sessionOptions?.secure) {
        try {
          await session.authorize(options.authorizeKey ?? 0xffffffff);
        } catch {
          // Optional on devices without access control
        }
      }
      let objIdx = options.objectIndex;
      if (objIdx === undefined) {
        const ioMap = await this.discoverInterfaceObjectIndices(session);
        const matches = ioMap.get(KNXInterfaceObjectType.KNXNETIP_PARAMETER_OBJECT);
        if (!matches || matches.length === 0) {
          throw new Error(`Device ${individualAddress} does not expose a KNXnet/IP Parameter Object (Object Type 11)`);
        }
        objIdx = matches[0];
      }

      const { writtenProperties } = await session.writeIpParameterConfig(config, objIdx);
      const configAfterWrite = options.readBack ? await session.readIpParameterConfig(objIdx) : undefined;

      let restarted = false;
      if (restart && writtenProperties.length > 0) {
        await session.restart({ type: "basic" });
        restarted = true;
      }

      return {
        individualAddress,
        objectIndex: objIdx,
        writtenProperties,
        restarted,
        configAfterWrite,
      };
    } finally {
      if (session.isConnected) {
        await session.close(true).catch(() => {});
      }
    }
  }

  /**
   * Executes a comprehensive read-only ETS "Device Info" diagnostic inspection of any KNX device on the bus.
   * Returns a 100% JSON-serializable `DeviceDiagnosticsReport` covering MaskVersion, identity, firmware,
   * Load/Run states, ProgramVersion, loaded Group Addresses, KNXnet/IP Parameter Object (Type 11),
   * and Security Object (Type 17) state/counters when available.
   */
  public async readDeviceDiagnostics(
    individualAddress: string,
    options: DeviceDiagnosticsOptions = {},
  ): Promise<DeviceDiagnosticsReport> {
    const includeGas = options.includeGroupAddresses ?? true;
    const includeIp = options.includeIpConfig ?? true;
    const includeSec = options.includeSecurity ?? true;
    const includeIos = options.includeInterfaceObjects ?? true;
    const warnings: string[] = [];

    return this.management.withSession(
      individualAddress,
      async (session) => {
        const dd0 = await session.readDeviceDescriptor(0);
        const maskVersion = dd0.data.length >= 2 ? dd0.data.readUInt16BE(0) : 0;
        const maskVersionHex = `0x${maskVersion.toString(16).toUpperCase().padStart(4, "0")}`;
        const maskName = maskVersion ? DeviceDescriptorType0.describe(maskVersion) : undefined;
        const managementModel = resolveManagementModel(maskVersion);
        const pureBcu1 = isPureBcu1MemoryOnlyMask(maskVersion);

        if (pureBcu1) {
          let manufacturerId: number | undefined;
          let applicationIdInfo: DeviceDiagnosticsReport["applicationIdInfo"];
          let programVersionHex: string | undefined;
          let programmingMode: boolean | undefined;

          try {
            const eeprom = await session.readMemory(0x0104, 4, { maxChunkSize: 4 });
            if (eeprom.length >= 4) {
              manufacturerId = eeprom.readUInt8(0);
              const appNum = eeprom.readUInt16BE(1);
              const appVer = eeprom.readUInt8(3);
              applicationIdInfo = {
                manufacturerId,
                applicationNumber: appNum,
                applicationVersion: appVer,
              };
              const pv = Buffer.alloc(5);
              pv.writeUInt16BE(manufacturerId, 0);
              pv.writeUInt16BE(appNum, 2);
              pv.writeUInt8(appVer, 4);
              programVersionHex = pv.toString("hex").toUpperCase();
            }
          } catch {
            warnings.push("Unable to read BCU1 EEPROM application header at 0x0104");
          }

          try {
            programmingMode = await session.readProgrammingMode();
          } catch {
            // ignore
          }

          let groupAddressTable: DeviceDiagnosticsReport["groupAddressTable"];
          if (includeGas) {
            try {
              const grat = await session.readGroupAddressTable();
              groupAddressTable = {
                method: grat.method,
                tableAddress: grat.tableAddress,
                count: grat.groupAddresses.length,
                groupAddresses: grat.groupAddresses,
              };
            } catch (err: any) {
              warnings.push(`Unable to read Group Address Table: ${err?.message ?? err}`);
            }
          }

          return {
            individualAddress,
            inspectedAt: new Date().toISOString(),
            maskVersion,
            maskVersionHex,
            maskName,
            managementModel,
            manufacturerId,
            manufacturerName: manufacturerId !== undefined ? getKNXManufacturerName(manufacturerId) : undefined,
            maxApduLength: 15,
            programmingMode,
            programVersionHex,
            applicationIdInfo,
            loadStates: [],
            interfaceObjects: [],
            groupAddressTable,
            warnings,
          };
        }

        if (!options.sessionOptions?.secure) {
          try {
            await session.authorize(options.authorizeKey ?? 0xffffffff);
          } catch {
            // Optional when device has no access protection
          }
        }

        const tryReadProp = async (objectIndex: number, propertyId: number): Promise<Buffer | undefined> => {
          try {
            const resp = await session.readProperty({ objectIndex, propertyId, count: 1, startIndex: 1 });
            return resp.count > 0 && resp.data.length > 0 ? resp.data : undefined;
          } catch {
            return undefined;
          }
        };

        const mfrBuf = await tryReadProp(0, KNXPropertyId.PID_MANUFACTURER_ID);
        const serialBuf = await tryReadProp(0, KNXPropertyId.PID_SERIAL_NUMBER);
        const hwTypeBuf = await tryReadProp(0, KNXPropertyId.PID_HARDWARE_TYPE);
        const orderBuf = await tryReadProp(0, KNXPropertyId.PID_ORDER_INFO);
        const fwRevBuf = await tryReadProp(0, KNXPropertyId.PID_FIRMWARE_REVISION);
        const fwVerBuf = await tryReadProp(0, KNXPropertyId.PID_VERSION);
        const maxApduBuf = await tryReadProp(0, KNXPropertyId.PID_MAX_APDULENGTH);
        const progModeBuf = await tryReadProp(0, KNXPropertyId.PID_PROG_MODE);
        const peiBuf = await tryReadProp(0, KNXPropertyId.PID_PEI_TYPE);

        const manufacturerId = mfrBuf && mfrBuf.length >= 2 ? mfrBuf.readUInt16BE(0) : undefined;
        const maxApduLength =
          maxApduBuf && maxApduBuf.length >= 2
            ? maxApduBuf.readUInt16BE(0)
            : maxApduBuf && maxApduBuf.length === 1
              ? maxApduBuf.readUInt8(0)
              : 15;
        const orderInfoText = orderBuf
          ? Array.from(orderBuf)
              .filter((b) => b >= 0x20 && b <= 0x7e)
              .map((b) => String.fromCharCode(b))
              .join("")
              .trim() || undefined
          : undefined;

        // Discover Interface Objects via PID_IO_LIST (or fallback probe)
        const ioByType =
          includeIos || includeIp || includeSec
            ? await this.discoverInterfaceObjectIndices(session)
            : new Map<number, number[]>();

        const interfaceObjects: { objectIndex: number; objectType: number }[] = [];
        const objTypeByIdx = new Map<number, number>();
        for (const [objType, indices] of ioByType.entries()) {
          for (const objectIndex of indices) {
            interfaceObjects.push({ objectIndex, objectType: objType });
            objTypeByIdx.set(objectIndex, objType);
          }
        }
        interfaceObjects.sort((a, b) => a.objectIndex - b.objectIndex);

        // Determine Application Program object index (System B = Obj 4, legacy = Obj 3, or discovered Type 3)
        const discoveredAppObjs = ioByType.get(KNXInterfaceObjectType.APPLICATIONPROGRAM_OBJECT);
        const appObjIdx =
          discoveredAppObjs && discoveredAppObjs.length > 0
            ? discoveredAppObjs[0]
            : managementModel === "SystemB"
              ? 4
              : 3;

        // Read Load States on standard / discovered loadable objects
        const loadIdxSet = new Set<number>([1, 2, 3, 4]);
        if (ioByType.size > 0) {
          for (const { objectIndex, objectType } of interfaceObjects) {
            if (
              objectType === KNXInterfaceObjectType.ADDRESSTABLE_OBJECT ||
              objectType === KNXInterfaceObjectType.ASSOCIATIONTABLE_OBJECT ||
              objectType === KNXInterfaceObjectType.APPLICATIONPROGRAM_OBJECT ||
              objectType === KNXInterfaceObjectType.INTERFACEPROGRAM_OBJECT ||
              objectType === KNXInterfaceObjectType.ROUTER_OBJECT ||
              objectType === KNXInterfaceObjectType.GROUP_OBJECT_TABLE_OBJECT
            ) {
              loadIdxSet.add(objectIndex);
            }
          }
        }
        const rawLoadStates = await session.readLoadState(Array.from(loadIdxSet).sort((a, b) => a - b));
        const loadStates = rawLoadStates.map((ls) => ({
          objectIndex: ls.objectIndex,
          objectType: objTypeByIdx.get(ls.objectIndex),
          state: ls.state,
          stateName: ls.stateName,
        }));

        // Read ProgramVersion & RunState on Application Program object
        const progVerBuf =
          (await tryReadProp(appObjIdx, KNXPropertyId.PID_PROGRAM_VERSION)) ??
          (appObjIdx !== 3 ? await tryReadProp(3, KNXPropertyId.PID_PROGRAM_VERSION) : undefined);
        const programVersionHex = progVerBuf ? progVerBuf.toString("hex").toUpperCase() : undefined;
        let applicationIdInfo: DeviceDiagnosticsReport["applicationIdInfo"];
        if (progVerBuf && progVerBuf.length >= 5) {
          applicationIdInfo = {
            manufacturerId: progVerBuf.readUInt16BE(0),
            applicationNumber: progVerBuf.readUInt16BE(2),
            applicationVersion: progVerBuf.readUInt8(4),
          };
        }

        let runState: DeviceDiagnosticsReport["runState"];
        try {
          const rs = await session.readRunState(appObjIdx);
          runState = { objectIndex: appObjIdx, state: rs.state, stateName: rs.stateName };
        } catch {
          // Many System B devices omit PID_RUN_STATE_CONTROL
        }

        // Read Group Address Table (skip for couplers without Object 1)
        let groupAddressTable: DeviceDiagnosticsReport["groupAddressTable"];
        if (includeGas && !isCouplerMaskVersion(maskVersion)) {
          try {
            const addrObjIdx = ioByType.get(KNXInterfaceObjectType.ADDRESSTABLE_OBJECT)?.[0] ?? 1;
            const grat = await session.readGroupAddressTable({ objectIndex: addrObjIdx });
            groupAddressTable = {
              method: grat.method,
              tableAddress: grat.tableAddress,
              count: grat.groupAddresses.length,
              groupAddresses: grat.groupAddresses,
            };
          } catch (err: any) {
            warnings.push(`Unable to read Group Address Table: ${err?.message ?? err}`);
          }
        }

        // Read KNXnet/IP Parameter Object (Type 11) if present
        let ipConfig: KnxIpInterfaceConfig | undefined;
        const ipObjIdx = ioByType.get(KNXInterfaceObjectType.KNXNETIP_PARAMETER_OBJECT)?.[0];
        if (includeIp && ipObjIdx !== undefined) {
          try {
            ipConfig = await session.readIpParameterConfig(ipObjIdx);
          } catch (err: any) {
            warnings.push(`Unable to read KNXnet/IP Parameter Object (Obj ${ipObjIdx}): ${err?.message ?? err}`);
          }
        }

        // Read Security Interface Object (Type 17) status if present or secure session active
        let security: DeviceDiagnosticsReport["security"];
        const hasSecObj = (ioByType.get(KNXInterfaceObjectType.SECURITY_OBJECT)?.length ?? 0) > 0;
        if (includeSec && (hasSecObj || Boolean(options.sessionOptions?.secure))) {
          const secInfo: NonNullable<DeviceDiagnosticsReport["security"]> = { objectPresent: true };
          try {
            secInfo.securityMode = await session.readSecurityMode(1);
          } catch {
            // May require secure tool access
          }
          try {
            const secLs = await session.readSecurityLoadState(1);
            secInfo.loadState = secLs;
            secInfo.loadStateName = LoadState[secLs] ?? `UNKNOWN(${secLs})`;
          } catch {
            // ignore
          }
          try {
            const seq = await session.readSequenceNumberSending(1);
            secInfo.sequenceNumberSending = seq.toString();
          } catch {
            // ignore
          }
          try {
            const gks = await session.readGroupKeyTable(1);
            secInfo.groupKeyCount = gks.length;
          } catch {
            // ignore
          }
          try {
            const senders = await session.readSecurityIndividualAddressTable(1);
            secInfo.authorizedSenders = senders.map((s) => s.individualAddress);
          } catch {
            // ignore
          }
          try {
            const log = await session.readSecurityFailuresLog(1);
            secInfo.failuresLog = {
              seqNrErrors: log.seqNrErrors,
              cryptoErrors: log.cryptoErrors,
              accessRoleErrors: log.accessRoleErrors,
            };
          } catch {
            // ignore
          }
          if (
            hasSecObj ||
            secInfo.securityMode !== undefined ||
            secInfo.loadState !== undefined ||
            secInfo.sequenceNumberSending !== undefined
          ) {
            security = secInfo;
          }
        }

        return {
          individualAddress,
          inspectedAt: new Date().toISOString(),
          maskVersion,
          maskVersionHex,
          maskName,
          managementModel,
          manufacturerId,
          manufacturerName: manufacturerId !== undefined ? getKNXManufacturerName(manufacturerId) : undefined,
          serialNumber: serialBuf?.toString("hex").toUpperCase(),
          hardwareType: hwTypeBuf?.toString("hex").toUpperCase(),
          orderInfo: orderBuf?.toString("hex").toUpperCase(),
          orderInfoText,
          firmwareRevision: fwRevBuf && fwRevBuf.length >= 1 ? fwRevBuf.readUInt8(0) : undefined,
          firmwareVersionHex: fwVerBuf?.toString("hex").toUpperCase(),
          peiType: peiBuf && peiBuf.length >= 1 ? peiBuf.readUInt8(0) : undefined,
          maxApduLength,
          programmingMode: progModeBuf && progModeBuf.length >= 1 ? (progModeBuf.readUInt8(0) & 0x01) !== 0 : undefined,
          programVersionHex,
          applicationIdInfo,
          loadStates,
          runState,
          interfaceObjects,
          groupAddressTable,
          ipConfig,
          security,
          warnings,
        };
      },
      options.sessionOptions,
    );
  }

  private async discoverInterfaceObjectIndices(session: KNXManagementSession): Promise<Map<number, number[]>> {
    const byType = new Map<number, number[]>();
    const add = (objType: number, objIdx: number) => {
      let arr = byType.get(objType);
      if (!arr) {
        arr = [];
        byType.set(objType, arr);
      }
      arr.push(objIdx);
    };

    // 1. Try PID_IO_LIST (Object 0, PID 71): first read element 0 (count), then entries 1..count
    try {
      const countResp = await session.readProperty({
        objectIndex: 0,
        propertyId: KNXPropertyId.PID_IO_LIST,
        count: 1,
        startIndex: 0,
      });
      if (countResp.count > 0 && countResp.data.length >= 2) {
        const total = countResp.data.readUInt16BE(0);
        if (total > 0 && total <= 64) {
          let start = 1;
          while (start <= total) {
            const batch = Math.min(5, total - start + 1);
            const resp = await session.readProperty({
              objectIndex: 0,
              propertyId: KNXPropertyId.PID_IO_LIST,
              count: batch,
              startIndex: start,
            });
            for (let i = 0; i < resp.count && i * 2 + 1 < resp.data.length; i++) {
              const objType = resp.data.readUInt16BE(i * 2);
              add(objType, start - 1 + i);
            }
            start += batch;
          }
          if (byType.size > 0) return byType;
        }
      }
    } catch {
      // Fallback to probing PID_OBJECT_TYPE sequentially
    }

    // 2. Fallback: probe PID_OBJECT_TYPE (PID 1) on object indices 0..12
    for (let objIdx = 0; objIdx <= 12; objIdx++) {
      try {
        const resp = await session.readProperty({
          objectIndex: objIdx,
          propertyId: KNXPropertyId.PID_OBJECT_TYPE,
          count: 1,
          startIndex: 1,
        });
        if (resp.count === 0 || resp.data.length < 2) break;
        add(resp.data.readUInt16BE(0), objIdx);
      } catch {
        break;
      }
    }
    return byType;
  }

  private async programSecurityObject(
    session: KNXManagementSession,
    sec: SecurityCommissioningImage,
    effectiveMaxApduLength: number,
    onProgress: (message: string, deltaBytes: number, deltaFrames: number) => void,
  ): Promise<{ steps: string[] }> {
    const steps: string[] = [];
    const objInst = sec.objectInstance;

    // A_PropertyExtValue_WriteCon header (9B) + S-A_Data overhead (13B) = 22B (use 24B safe margin)
    const extPropPayloadBudget = Math.max(20, effectiveMaxApduLength - 24);
    const maxIaEntries = Math.max(1, Math.min(25, Math.floor(extPropPayloadBudget / 8)));
    const maxGrpKeyEntries = Math.max(1, Math.min(12, Math.floor(extPropPayloadBudget / 18)));
    const maxP2pEntries = Math.max(1, Math.min(10, Math.floor(extPropPayloadBudget / 20)));
    const maxFlagBytes = Math.max(1, Math.min(200, extPropPayloadBudget));

    // 1. Unload Object 17
    onProgress(`Unloading Security Interface Object (Type 17, inst ${objInst})`, 0, 0);
    const unloadedState = await session.writeSecurityLoadState(LoadEvent.UNLOAD, undefined, objInst);
    if (unloadedState !== LoadState.UNLOADED) {
      throw new Error(`Security Object (Type 17) UNLOAD returned state ${LoadState[unloadedState] ?? unloadedState}`);
    }
    steps.push(`Security Obj 17 UNLOAD -> UNLOADED`);

    // 2. Start Loading Object 17
    const loadingState = await session.writeSecurityLoadState(LoadEvent.START_LOADING, undefined, objInst);
    if (loadingState !== LoadState.LOADING) {
      throw new Error(
        `Security Object (Type 17) START_LOADING returned state ${LoadState[loadingState] ?? loadingState}`,
      );
    }
    steps.push(`Security Obj 17 START_LOADING -> LOADING`);

    // 3. Write PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE (PID 54)
    onProgress(`Writing Security IA Table (${sec.securityIndividualAddressTable.length} entries)`, 0, 0);
    await session.writeSecurityIndividualAddressTable(sec.securityIndividualAddressTable, {
      objectInstance: objInst,
      maxChunkEntries: maxIaEntries,
    });
    const iaBytes = sec.securityIndividualAddressTable.length * 8;
    const iaFrames =
      1 +
      (sec.securityIndividualAddressTable.length > 0
        ? Math.ceil(sec.securityIndividualAddressTable.length / maxIaEntries)
        : 0);
    onProgress(`Wrote Security IA Table (${sec.securityIndividualAddressTable.length} entries)`, iaBytes, iaFrames);
    steps.push(
      `Security Obj 17 PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE: ${sec.securityIndividualAddressTable.length} IA(s)`,
    );

    // 4. Write PID_GRP_KEY_TABLE (PID 53)
    onProgress(`Writing Group Key Table (${sec.groupKeyTable.length} keys)`, 0, 0);
    await session.writeGroupKeyTable(sec.groupKeyTable, {
      objectInstance: objInst,
      maxChunkEntries: maxGrpKeyEntries,
    });
    const gkBytes = sec.groupKeyTable.length * 18;
    const gkFrames = 1 + (sec.groupKeyTable.length > 0 ? Math.ceil(sec.groupKeyTable.length / maxGrpKeyEntries) : 0);
    onProgress(`Wrote Group Key Table (${sec.groupKeyTable.length} keys)`, gkBytes, gkFrames);
    steps.push(`Security Obj 17 PID_GRP_KEY_TABLE: ${sec.groupKeyTable.length} key(s)`);

    // 5. Write PID_GO_SECURITY_FLAGS (PID 61)
    onProgress(`Writing Group Object Security Flags (${sec.goSecurityFlags.length} slots)`, 0, 0);
    await session.writeGoSecurityFlags(sec.goSecurityFlags, {
      objectInstance: objInst,
      maxChunkBytes: maxFlagBytes,
    });
    const flagFrames = 1 + (sec.goSecurityFlags.length > 0 ? Math.ceil(sec.goSecurityFlags.length / maxFlagBytes) : 0);
    onProgress(
      `Wrote Group Object Security Flags (${sec.goSecurityFlags.length} slots)`,
      sec.goSecurityFlags.length,
      flagFrames,
    );
    steps.push(`Security Obj 17 PID_GO_SECURITY_FLAGS: ${sec.goSecurityFlags.length} slot(s)`);

    // 6. Write PID_P2P_KEY_TABLE (PID 52) if configured
    if (sec.p2pKeyTable.length > 0) {
      onProgress(`Writing P2P Key Table (${sec.p2pKeyTable.length} keys)`, 0, 0);
      await session.writeP2PKeyTable(sec.p2pKeyTable, {
        objectInstance: objInst,
        maxChunkEntries: maxP2pEntries,
      });
      const p2pBytes = sec.p2pKeyTable.length * 20;
      const p2pFrames = 1 + Math.ceil(sec.p2pKeyTable.length / maxP2pEntries);
      onProgress(`Wrote P2P Key Table (${sec.p2pKeyTable.length} keys)`, p2pBytes, p2pFrames);
      steps.push(`Security Obj 17 PID_P2P_KEY_TABLE: ${sec.p2pKeyTable.length} key(s)`);
    }

    // 7. Complete Loading Object 17
    const loadedState = await session.writeSecurityLoadState(LoadEvent.LOAD_COMPLETED, undefined, objInst);
    if (loadedState !== LoadState.LOADED) {
      throw new Error(
        `Security Object (Type 17) LOAD_COMPLETED returned state ${LoadState[loadedState] ?? loadedState}`,
      );
    }
    steps.push(`Security Obj 17 LOAD_COMPLETED -> LOADED`);

    // 8. Optional independent properties (not gated by Object 17 LSM)
    if (sec.initialSequenceNumberSending !== undefined) {
      await session.writeSequenceNumberSending(sec.initialSequenceNumberSending, objInst);
      onProgress(`Wrote PID_SEQUENCE_NUMBER_SENDING`, 6, 1);
      steps.push(`Security Obj 17 PID_SEQUENCE_NUMBER_SENDING = ${sec.initialSequenceNumberSending.toString()}`);
    }

    if (sec.enableSecurityMode !== undefined) {
      await session.writeSecurityMode(sec.enableSecurityMode, objInst);
      steps.push(`Security Obj 17 PID_SECURITY_MODE = ${sec.enableSecurityMode ? 1 : 0}`);
    }

    if (sec.toolKey) {
      await session.writeToolKey(sec.toolKey, objInst);
      onProgress(`Updated PID_TOOL_KEY`, 16, 1);
      steps.push(`Security Obj 17 PID_TOOL_KEY written`);
    }

    return { steps };
  }

  private async runPreflight(
    session: KNXManagementSession,
    app: KnxApplicationProgram,
    image: CompiledSystemBImage,
    opts: {
      authorizeKey: number | Buffer;
      interfaceMaxApdu: number;
      verifyDevice: boolean;
      strictHwCheck: boolean;
      explicitGroatFormat?: 0 | 1;
      isSecureSession: boolean;
      maskVersions?: Map<string, KnxMaskVersion>;
    },
  ): Promise<DevicePreflightInfo> {
    const dd0 = await session.readDeviceDescriptor(0);
    const maskVersion = dd0.data.length >= 2 ? dd0.data.readUInt16BE(0) : 0;

    if (opts.verifyDevice && app.maskVersion > 0 && !isMaskCompatible(maskVersion, app, opts.maskVersions)) {
      const secureHint =
        maskVersion === 0xffff && !opts.isSecureSession
          ? " (Hint: 0xFFFF in plain mode typically means KNX Data Secure is enabled on this device; provide a KnxDataSecure keyring/ToolKey and pass sessionOptions: { secure: true })"
          : "";
      throw new Error(
        `MaskVersion mismatch on ${session.destinationAddress}: device reports 0x${maskVersion.toString(16).padStart(4, "0")}, application "${app.name}" requires 0x${app.maskVersion.toString(16).padStart(4, "0")}${secureHint}`,
      );
    }

    const pureMemoryBcu1 = isPureBcu1MemoryOnlyMask(maskVersion);
    const resolvedModel = resolveManagementModel(maskVersion, opts.maskVersions?.get(app.maskVersionId));

    // Pure legacy BCU1 (MV-0010..0013) does not support Interface Object properties; read MfrId from EEPROM 0x0104
    if (pureMemoryBcu1) {
      let manufacturerId: number | undefined;
      try {
        const mfrMem = await session.readMemory(0x0104, 1, { maxChunkSize: 1 });
        if (mfrMem.length >= 1) manufacturerId = mfrMem.readUInt8(0);
      } catch {
        // Ignore if unreadable
      }
      if (
        opts.verifyDevice &&
        manufacturerId !== undefined &&
        manufacturerId !== 0 &&
        app.manufacturerId > 0 &&
        manufacturerId !== (app.manufacturerId & 0xff)
      ) {
        throw new Error(
          `Manufacturer ID mismatch on BCU1 ${session.destinationAddress}: device EEPROM reports 0x${manufacturerId.toString(16).padStart(2, "0")}, application "${app.name}" is for 0x${app.manufacturerId.toString(16).padStart(4, "0")}`,
        );
      }
      return {
        individualAddress: session.destinationAddress,
        maskVersion,
        maxApduLength: 15,
        effectiveMaxApduLength: Math.min(15, opts.interfaceMaxApdu),
        manufacturerId,
        associationTableFormat: 0,
      };
    }

    const tryReadProp = async (objectIndex: number, propertyId: number): Promise<Buffer | undefined> => {
      try {
        const resp = await session.readProperty({ objectIndex, propertyId, count: 1, startIndex: 1 });
        return resp.count > 0 && resp.data.length > 0 ? resp.data : undefined;
      } catch {
        return undefined;
      }
    };

    const maxApduBuf = await tryReadProp(0, KNXPropertyId.PID_MAX_APDULENGTH);
    const maxApduLength =
      maxApduBuf && maxApduBuf.length >= 2
        ? maxApduBuf.readUInt16BE(0)
        : maxApduBuf && maxApduBuf.length === 1
          ? maxApduBuf.readUInt8(0)
          : 15;
    const effectiveMaxApduLength = Math.max(15, Math.min(maxApduLength, opts.interfaceMaxApdu));

    // Authorize (standard in plain System B / BCU2 / BIM M112 downloads; skipped when using KNX Data Secure)
    let accessLevel: number | undefined;
    if (!opts.isSecureSession) {
      try {
        accessLevel = await session.authorize(opts.authorizeKey);
      } catch {
        // Some devices without access control may ignore or reject authorize; continue if readable
      }
    }

    // Detect GrOAT format via A_PropertyDescription_Read(obj=2, pid=23) on System B end-devices
    let associationTableFormat: 0 | 1 = opts.explicitGroatFormat ?? image.associationTableFormat;
    if (opts.explicitGroatFormat === undefined && resolvedModel === "SystemB" && !isCouplerMaskVersion(maskVersion)) {
      try {
        const desc = await session.readPropertyDescription({
          objectIndex: 2,
          propertyId: KNXPropertyId.PID_TABLE,
          propertyIndex: 0,
        });
        if (desc.pdt === PDT_GENERIC_04) {
          associationTableFormat = 1;
        } else if (desc.pdt === PDT_GENERIC_02) {
          associationTableFormat = 0;
        }
      } catch {
        // Keep inferred format from ApplicationProgram MaxEntries
      }
    }

    const serialBuf = await tryReadProp(0, KNXPropertyId.PID_SERIAL_NUMBER);
    const mfrBuf = await tryReadProp(0, KNXPropertyId.PID_MANUFACTURER_ID);
    const hwTypeBuf = await tryReadProp(0, KNXPropertyId.PID_HARDWARE_TYPE);
    const orderBuf = await tryReadProp(0, KNXPropertyId.PID_ORDER_INFO);
    const fwVerBuf = await tryReadProp(0, KNXPropertyId.PID_VERSION);
    const appObjIdx = resolvedModel === "SystemB" ? 4 : 3;
    const appLoadStateBuf = await tryReadProp(appObjIdx, KNXPropertyId.PID_LOAD_STATE_CONTROL);
    const curProgVerBuf = await tryReadProp(appObjIdx, KNXPropertyId.PID_PROGRAM_VERSION);

    const manufacturerId = mfrBuf && mfrBuf.length >= 2 ? mfrBuf.readUInt16BE(0) : undefined;

    if (
      opts.verifyDevice &&
      manufacturerId !== undefined &&
      app.manufacturerId > 0 &&
      manufacturerId !== app.manufacturerId
    ) {
      throw new Error(
        `Manufacturer ID mismatch on ${session.destinationAddress}: device is 0x${manufacturerId.toString(16).padStart(4, "0")}, application "${app.name}" is for 0x${app.manufacturerId.toString(16).padStart(4, "0")}`,
      );
    }

    // Verify expected hardware properties declared by the .knxprod (e.g. Zennio checkHW -> PID_HARDWARE_TYPE)
    if (opts.verifyDevice && opts.strictHwCheck && image.expectedProperties.length > 0) {
      for (const exp of image.expectedProperties) {
        const actual =
          exp.objectIndex === 0 && exp.propertyId === KNXPropertyId.PID_HARDWARE_TYPE
            ? hwTypeBuf
            : await tryReadProp(exp.objectIndex, exp.propertyId);
        if (actual && !actual.equals(exp.expectedValue)) {
          throw new Error(
            `Hardware verification failed on ${session.destinationAddress} (${exp.description}, Obj ${exp.objectIndex} PID ${exp.propertyId}): device reports ${actual.toString("hex").toUpperCase()}, application "${app.name}" expects ${exp.expectedValue.toString("hex").toUpperCase()}`,
          );
        }
      }
    }

    return {
      individualAddress: session.destinationAddress,
      maskVersion,
      maxApduLength,
      effectiveMaxApduLength,
      manufacturerId,
      serialNumber: serialBuf?.toString("hex").toUpperCase(),
      hardwareType: hwTypeBuf,
      orderInfo: orderBuf,
      firmwareVersion: fwVerBuf,
      currentProgramVersion: curProgVerBuf,
      currentAppLoadState: appLoadStateBuf && appLoadStateBuf.length >= 1 ? appLoadStateBuf.readUInt8(0) : undefined,
      associationTableFormat,
      accessLevel,
    };
  }

  private resolveSpansForObject(
    image: CompiledSystemBImage,
    objIdx: number,
    offset: number,
    size: number,
    opts: { mode?: number; fill?: number; skipFillRuns: boolean; previousImage?: Buffer },
  ): { offset: number; data: Buffer }[] {
    if (objIdx === 1) {
      return [{ offset, data: image.groupAddressTable.subarray(offset, offset + size) }];
    }
    if (objIdx === 2) {
      return [{ offset, data: image.associationTable.subarray(offset, offset + size) }];
    }
    if (objIdx === 3) {
      return [{ offset, data: image.groupObjectTable.subarray(offset, offset + size) }];
    }
    const seg = image.segments.get(objIdx);
    if (!seg) {
      throw new Error(`No compiled memory segment found for Object ${objIdx}`);
    }
    return SystemBCompiler.extractWritableSpans(seg, {
      offset,
      size,
      mode: opts.mode,
      fill: opts.fill,
      skipFillRuns: opts.skipFillRuns,
      previousImage: opts.previousImage,
    });
  }

  private async writeMemorySpan(
    session: KNXManagementSession,
    startAddress: number,
    data: Buffer,
    opts: {
      useExtendedMemory: boolean;
      maxExtChunk: number;
      maxStdChunk: number;
      maxUserChunk: number;
      verify: boolean;
      verifyMemoryMode: "response" | "readback" | "none";
      onChunkWritten: (bytes: number) => void;
    },
  ): Promise<void> {
    if (data.length === 0) return;

    if (opts.useExtendedMemory) {
      let offset = 0;
      while (offset < data.length) {
        const chunk = data.subarray(offset, offset + opts.maxExtChunk);
        const addr = startAddress + offset;
        await session.writeExtendedMemory(addr, chunk, { maxChunkSize: chunk.length });
        if (opts.verify && opts.verifyMemoryMode === "readback") {
          const readBack = await session.readExtendedMemory(addr, chunk.length, { maxChunkSize: chunk.length });
          if (!readBack.equals(chunk)) {
            throw new Error(`Extended memory readback mismatch at 0x${addr.toString(16)}`);
          }
        }
        opts.onChunkWritten(chunk.length);
        offset += chunk.length;
      }
      return;
    }

    // Legacy memory path per 03_05_03 Table 5: <= 0xFFFF -> A_Memory_Write, > 0xFFFF -> A_UserMemory_Write
    const doVerify = opts.verify && opts.verifyMemoryMode !== "none";
    if (startAddress + data.length <= 0x10000) {
      let offset = 0;
      while (offset < data.length) {
        const chunk = data.subarray(offset, offset + opts.maxStdChunk);
        await session.writeMemory(startAddress + offset, chunk, {
          verify: doVerify,
          maxChunkSize: chunk.length,
        });
        opts.onChunkWritten(chunk.length);
        offset += chunk.length;
      }
    } else {
      let offset = 0;
      while (offset < data.length) {
        const chunk = data.subarray(offset, offset + opts.maxUserChunk);
        await session.writeUserMemory(startAddress + offset, chunk, {
          verify: doVerify,
          maxChunkSize: chunk.length,
        });
        opts.onChunkWritten(chunk.length);
        offset += chunk.length;
      }
    }
  }

  private async throwWithLsmError(session: KNXManagementSession, lsmIdx: number, message: string): Promise<never> {
    let errCodeInfo = "";
    try {
      const errProp = await session.readProperty({
        objectIndex: lsmIdx,
        propertyId: KNXPropertyId.PID_ERROR_CODE,
        count: 1,
        startIndex: 1,
      });
      if (errProp.count > 0 && errProp.data.length >= 1) {
        errCodeInfo = ` (PID_ERROR_CODE=0x${errProp.data.readUInt8(0).toString(16).padStart(2, "0")})`;
      }
    } catch {
      // Device may not expose PID_ERROR_CODE
    }
    throw new Error(`LSM ${lsmIdx} error on ${session.destinationAddress}: ${message}${errCodeInfo}`);
  }
}
