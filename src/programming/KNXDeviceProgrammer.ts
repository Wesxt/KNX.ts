import crypto from "node:crypto";
import { KNXService } from "../connection/KNXService";
import { RestartEraseCode } from "../management/apduBuilders";
import {
  KNXManagement,
  KNXManagementOptions,
  KNXManagementSession,
  KNXPropertyId,
  LoadEvent,
  LoadState,
} from "../management/KNXManagement";
import { parseKey16 } from "../security/KnxSecureKeys";
import { KnxProdParser } from "./KnxProdParser";
import { LoadProcedureEngine } from "./LoadProcedureEngine";
import { computeDefaultSecuritySequenceNumber, SystemBCompiler } from "./SystemBCompiler";
import {
  CommissionSecureDeviceOptions,
  CommissionSecureDeviceResult,
  CompiledSystemBImage,
  DeviceApplicationConfig,
  DeviceDownloadOptions,
  DeviceDownloadResult,
  DevicePreflightInfo,
  DownloadMode,
  DownloadPlan,
  DownloadProgressEvent,
  KnxApplicationProgram,
  KnxProdParseOptions,
  ParsedKnxProd,
  SecurityCommissioningImage,
} from "./types";

const PDT_GENERIC_02 = 0x12; // 18: 2-byte Association Table entry (1B TSAP + 1B ASAP)
const PDT_GENERIC_04 = 0x14; // 20: 4-byte Association Table entry (2B TSAP + 2B ASAP)

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

/**
 * High-level KNX Application Program Downloader for real KNX devices (System B `0x07B0` and compatible masks).
 *
 * Bridges `.knxprod` product catalogs (`KnxProdParser`), `<Dynamic>` evaluation (`DynamicEvaluator`),
 * System B binary compilation (`SystemBCompiler`), and `LoadProcedure` merging (`LoadProcedureEngine`)
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
   * Evaluates parameters & `<Dynamic>` rules and compiles a complete System B binary image (offline).
   */
  public compile(source: KnxProdSource, config: DeviceApplicationConfig = {}): CompiledSystemBImage {
    const { app } = unwrapSource(source);
    return SystemBCompiler.compile(app, config);
  }

  /**
   * Builds a concrete `DownloadPlan` (offline dry-run) without touching the KNX bus.
   */
  public planDownload(
    source: KnxProdSource,
    config: DeviceApplicationConfig = {},
    options: Pick<DeviceDownloadOptions, "mode" | "skipFillRuns" | "skipRestart" | "programSecurityObject"> = {},
  ): { image: CompiledSystemBImage; plan: DownloadPlan } {
    const { knxProd, app } = unwrapSource(source);
    const image = SystemBCompiler.compile(app, config);
    const plan = LoadProcedureEngine.buildPlan(app, image, options.mode ?? "ap1", {
      knxProd,
      skipFillRuns: options.skipFillRuns ?? true,
      skipRestart: options.skipRestart ?? false,
      programSecurityObject: options.programSecurityObject,
    });
    return { image, plan };
  }

  /**
   * Executes a complete or partial application download onto a real KNX device.
   *
   * Safety guarantees:
   * - Validates `MaskVersion` (Device Descriptor Type 0), `ManufacturerId`, and expected `PID_HARDWARE_TYPE`
   *   before unloading or writing anything (configurable via `verifyDeviceBeforeWrite` / `strictHardwareTypeCheck`).
   * - Auto-detects `PID_MAX_APDULENGTH` and `GrOAT` format (`PDT_GENERIC_02` vs `PDT_GENERIC_04`) directly from the device.
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
    let image = SystemBCompiler.compile(app, config);
    let plan = LoadProcedureEngine.buildPlan(app, image, mode, {
      knxProd,
      skipFillRuns,
      skipRestart: options.skipRestart ?? false,
      programSecurityObject: options.programSecurityObject,
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
      });
      executedSteps.push(
        `Preflight OK: mask=0x${preflight.maskVersion.toString(16).padStart(4, "0")}, maxAPDU=${preflight.maxApduLength} (effective=${preflight.effectiveMaxApduLength}), mfr=0x${(preflight.manufacturerId ?? 0).toString(16).padStart(4, "0")}, GrOAT=Format${preflight.associationTableFormat}`,
      );

      // Recompile GrOAT + Plan if live device uses a different GrOAT format than inferred offline
      if (preflight.associationTableFormat !== image.associationTableFormat) {
        image = SystemBCompiler.recompileAssociationTable(image, preflight.associationTableFormat);
        plan = LoadProcedureEngine.buildPlan(app, image, mode, {
          knxProd,
          skipFillRuns,
          skipRestart: options.skipRestart ?? false,
          programSecurityObject: options.programSecurityObject,
        });
        executedSteps.push(
          `Recompiled GrOAT to Format ${preflight.associationTableFormat} (${image.associationTable.length} bytes)`,
        );
      }

      if (dryRun) {
        executedSteps.push(
          `Dry-run complete: ${plan.actions.length} steps planned, ${plan.estimatedBytesToWrite} bytes would be written`,
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
      // PHASE 2: Execute Merged LoadProcedure Actions
      // ======================================================================
      const totalSteps = plan.actions.length;
      const savedImageProps = new Map<string, Buffer>();
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

      for (let idx = 0; idx < totalSteps; idx++) {
        const action = plan.actions[idx];

        switch (action.type) {
          case "Connect":
            // Already connected via openSession
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
            emitProgress(idx, totalSteps, "unload", `Unloading LSM ${action.lsmIdx}`);
            try {
              const st = await session.writeLoadState(action.lsmIdx, LoadEvent.UNLOAD);
              if (st !== LoadState.UNLOADED && !action.ignoreErrors) {
                throw new Error(`LSM ${action.lsmIdx} unload returned state ${LoadState[st] ?? st}`);
              }
              executedSteps.push(`Unload LSM ${action.lsmIdx} -> ${LoadState[st] ?? st}`);
            } catch (err: any) {
              if (!action.ignoreErrors) throw err;
              executedSteps.push(`Unload LSM ${action.lsmIdx} ignored (${err?.message ?? err})`);
            }
            break;
          }

          case "LoadStart": {
            emitProgress(idx, totalSteps, "allocate", `Start loading LSM ${action.lsmIdx}`);
            const st = await session.writeLoadState(action.lsmIdx, LoadEvent.START_LOADING);
            if (st !== LoadState.LOADING) {
              await this.throwWithLsmError(
                session,
                action.lsmIdx,
                `START_LOADING returned state ${LoadState[st] ?? st}`,
              );
            }
            executedSteps.push(`LoadStart LSM ${action.lsmIdx} -> LOADING`);
            break;
          }

          case "AllocRelSegment": {
            emitProgress(idx, totalSteps, "allocate", `Allocating ${action.size} B for LSM ${action.lsmIdx}`);
            // 03_05_02 §3.31.3.4 Load Event Data Relative Allocation (0x03 0x0B <size:4B> <mode:1B> <fill:1B> 00 00)
            const payload = Buffer.alloc(9, 0x00);
            payload.writeUInt8(0x0b, 0);
            payload.writeUInt32BE(action.size >>> 0, 1);
            payload.writeUInt8(action.mode & 0xff, 5);
            payload.writeUInt8(action.fill & 0xff, 6);
            const st = await session.writeLoadState(action.lsmIdx, LoadEvent.ADDITIONAL_LOAD_CONTROLS, payload);
            if (st !== LoadState.LOADING) {
              await this.throwWithLsmError(
                session,
                action.lsmIdx,
                `AllocRelSegment(${action.size} B, mode=${action.mode}, fill=${action.fill}) returned ${LoadState[st] ?? st}`,
              );
            }
            executedSteps.push(
              `AllocRelSegment LSM ${action.lsmIdx}: size=${action.size}, mode=${action.mode}, fill=0x${action.fill.toString(16).padStart(2, "0")} -> LOADING`,
            );
            break;
          }

          case "WriteRelMem": {
            const ptrResp = await session.readProperty({
              objectIndex: action.objIdx,
              propertyId: KNXPropertyId.PID_TABLE_REFERENCE,
              count: 1,
              startIndex: 1,
            });
            if (ptrResp.count === 0 || ptrResp.data.length < 2) {
              throw new Error(`Unable to read PID_TABLE_REFERENCE for Object ${action.objIdx}`);
            }
            const baseAddr = ptrResp.data.length >= 4 ? ptrResp.data.readUInt32BE(0) : ptrResp.data.readUInt16BE(0);
            if (baseAddr === 0) {
              throw new Error(`Memory allocation failed on Object ${action.objIdx}: PID_TABLE_REFERENCE is 0x00000000`);
            }

            const spans = this.resolveSpansForObject(image, action.objIdx, action.offset, action.size, {
              mode: action.mode,
              fill: action.fill,
              skipFillRuns,
            });

            let objBytes = 0;
            for (const span of spans) {
              const absAddr = baseAddr + span.offset;
              const stats = await this.writeMemorySpan(session, absAddr, span.data, {
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
                    `Writing Object ${action.objIdx} @ 0x${absAddr.toString(16).toUpperCase()} (${bytesWritten}/${plan.estimatedBytesToWrite} B)`,
                  );
                },
              });
              void stats;
            }

            executedSteps.push(
              `WriteRelMem Obj ${action.objIdx} @ 0x${baseAddr.toString(16).padStart(6, "0")}: ${objBytes} B in ${spans.length} span(s)`,
            );
            break;
          }

          case "WriteAbsMem": {
            await this.writeMemorySpan(session, action.address, action.data, {
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
                  `Writing absolute memory @ 0x${action.address.toString(16)}`,
                );
              },
            });
            executedSteps.push(`WriteAbsMem @ 0x${action.address.toString(16)}: ${action.data.length} B`);
            break;
          }

          case "WriteProp": {
            emitProgress(idx, totalSteps, "write_property", `Writing Obj ${action.objIdx} PID ${action.propId}`);
            await session.writeProperty(
              {
                objectIndex: action.objIdx,
                propertyId: action.propId,
                startIndex: action.startElement,
                count: action.count,
                data: action.data,
              },
              { verify: action.verify },
            );
            executedSteps.push(
              `WriteProp Obj ${action.objIdx} PID ${action.propId} [${action.startElement}..+${action.count}] = ${action.data.toString("hex").toUpperCase()}`,
            );
            break;
          }

          case "LoadImageProp": {
            emitProgress(
              idx,
              totalSteps,
              "finalize",
              `Reading image property Obj ${action.objIdx} PID ${action.propId}`,
            );
            try {
              const resp = await session.readProperty({
                objectIndex: action.objIdx,
                propertyId: action.propId,
                startIndex: action.startElement,
                count: action.count,
              });
              const propKey = `${action.objIdx}:${action.propId}:${action.startElement}`;
              savedImageProps.set(propKey, resp.data);
              loadedStamps.set(propKey, resp.data);
              executedSteps.push(
                `LoadImageProp Obj ${action.objIdx} PID ${action.propId} = ${resp.data.toString("hex").toUpperCase()}`,
              );
            } catch (err: any) {
              // Some devices don't expose PID_MCB_TABLE (27) on all objects; record non-fatal note
              executedSteps.push(
                `LoadImageProp Obj ${action.objIdx} PID ${action.propId} skipped (${err?.message ?? err})`,
              );
            }
            break;
          }

          case "CompareProp": {
            emitProgress(idx, totalSteps, "verify", `Comparing Obj ${action.objIdx} PID ${action.propId}`);
            const resp = await session.readProperty({
              objectIndex: action.objIdx,
              propertyId: action.propId,
              startIndex: action.startElement,
              count: action.count,
            });
            const propKey = `${action.objIdx}:${action.propId}:${action.startElement}`;
            const expected = action.compareWithLoadedImage ? savedImageProps.get(propKey) : action.expected;
            if (expected && !resp.data.equals(expected)) {
              throw new Error(
                `LdCtrlCompareProp mismatch on Obj ${action.objIdx} PID ${action.propId}: expected ${expected.toString("hex").toUpperCase()}, got ${resp.data.toString("hex").toUpperCase()} (partial download incompatible; run full download instead)`,
              );
            }
            executedSteps.push(`CompareProp Obj ${action.objIdx} PID ${action.propId} OK`);
            break;
          }

          case "LoadCompleted": {
            emitProgress(idx, totalSteps, "finalize", `Completing load on LSM ${action.lsmIdx}`);
            const st = await session.writeLoadState(action.lsmIdx, LoadEvent.LOAD_COMPLETED);
            if (st !== LoadState.LOADED) {
              await this.throwWithLsmError(
                session,
                action.lsmIdx,
                `LOAD_COMPLETED returned state ${LoadState[st] ?? st}`,
              );
            }
            executedSteps.push(`LoadCompleted LSM ${action.lsmIdx} -> LOADED`);
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
   * Unloads all loadable objects (1..5) on a System B device.
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
    },
  ): Promise<DevicePreflightInfo> {
    const dd0 = await session.readDeviceDescriptor(0);
    const maskVersion = dd0.data.length >= 2 ? dd0.data.readUInt16BE(0) : 0;

    if (opts.verifyDevice && app.maskVersion > 0 && maskVersion !== app.maskVersion) {
      const secureHint =
        maskVersion === 0xffff && !opts.isSecureSession
          ? " (Hint: 0xFFFF in plain mode typically means KNX Data Secure is enabled on this device; provide a KnxDataSecure keyring/ToolKey and pass sessionOptions: { secure: true })"
          : "";
      throw new Error(
        `MaskVersion mismatch on ${session.destinationAddress}: device reports 0x${maskVersion.toString(16).padStart(4, "0")}, application "${app.name}" requires 0x${app.maskVersion.toString(16).padStart(4, "0")}${secureHint}`,
      );
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

    // Authorize (standard in plain System B downloads; optional/skipped when using KNX Data Secure)
    let accessLevel: number | undefined;
    if (!opts.isSecureSession) {
      try {
        accessLevel = await session.authorize(opts.authorizeKey);
      } catch {
        // Some devices without access control may ignore or reject authorize; continue if readable
      }
    }

    // Detect GrOAT format via A_PropertyDescription_Read(obj=2, pid=23) exactly as ETS does
    let associationTableFormat: 0 | 1 = opts.explicitGroatFormat ?? image.associationTableFormat;
    if (opts.explicitGroatFormat === undefined) {
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
    const appLoadStateBuf = await tryReadProp(4, KNXPropertyId.PID_LOAD_STATE_CONTROL);
    const curProgVerBuf = await tryReadProp(4, KNXPropertyId.PID_PROGRAM_VERSION);

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
    opts: { mode?: number; fill?: number; skipFillRuns: boolean },
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
