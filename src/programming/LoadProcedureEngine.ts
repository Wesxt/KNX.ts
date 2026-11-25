import { SystemBCompiler } from "./SystemBCompiler";
import {
  CompiledSystemBImage,
  DownloadAction,
  DownloadMode,
  DownloadPlan,
  KnxApplicationProgram,
  KnxLdCtrlStep,
  KnxMaskVersion,
  KnxMasterProcedure,
  ParsedKnxProd,
} from "./types";

/**
 * Built-in fallback System B (`MV-07B0`) procedure templates matching `knx_master.xml` HawkConfigurationData,
 * used when a `KnxApplicationProgram` is compiled standalone without `knx_master.xml`.
 */
const DEFAULT_SYSTEM_B_PROCEDURES: Record<string, KnxLdCtrlStep[]> = {
  ap1: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlMerge", attrs: { MergeId: "1" } },
    { tag: "LdCtrlMapError", attrs: { OriginalError: "3221498632", MappedError: "0" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "5" } },
    { tag: "LdCtrlMapError", attrs: { OriginalError: "3221498632", MappedError: "3221498632" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "2" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlRelSegment", attrs: { LsmIdx: "3", Size: "2", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlRelSegment", attrs: { LsmIdx: "1", Size: "2", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlRelSegment", attrs: { LsmIdx: "2", Size: "2", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "4" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjIdx: "3", Offset: "0", Size: "1048576", Verify: "true" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjIdx: "2", Offset: "0", Size: "1048576", Verify: "true" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjIdx: "1", Offset: "0", Size: "1048576", Verify: "true" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjIdx: "4", PropId: "13", Verify: "true", InlineData: "0000000000" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "6" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "7" } },
    { tag: "LdCtrlRestart", attrs: {} },
  ],
  grp: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlRelSegment", attrs: { LsmIdx: "3", Size: "2", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlRelSegment", attrs: { LsmIdx: "1", Size: "2", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlRelSegment", attrs: { LsmIdx: "2", Size: "2", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjIdx: "3", Offset: "0", Size: "1048576", Verify: "true" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjIdx: "2", Offset: "0", Size: "1048576", Verify: "true" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjIdx: "1", Offset: "0", Size: "1048576", Verify: "true" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "7" } },
    { tag: "LdCtrlRestart", attrs: {} },
  ],
  par: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlLoadImageProp", attrs: { ObjIdx: "4", PropId: "7" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "2" } },
    { tag: "LdCtrlCompareProp", attrs: { ObjIdx: "4", PropId: "7", InlineData: "00000000" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "4" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjIdx: "4", PropId: "13", Verify: "true", InlineData: "0000000000" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "6" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "7" } },
    { tag: "LdCtrlRestart", attrs: {} },
  ],
  "par,grp": [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlLoadImageProp", attrs: { ObjIdx: "4", PropId: "7" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "2" } },
    { tag: "LdCtrlCompareProp", attrs: { ObjIdx: "4", PropId: "7", InlineData: "00000000" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlRelSegment", attrs: { LsmIdx: "3", Size: "2", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlRelSegment", attrs: { LsmIdx: "1", Size: "2", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlRelSegment", attrs: { LsmIdx: "2", Size: "2", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "4" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjIdx: "3", Offset: "0", Size: "1048576", Verify: "true" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjIdx: "2", Offset: "0", Size: "1048576", Verify: "true" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjIdx: "1", Offset: "0", Size: "1048576", Verify: "true" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjIdx: "4", PropId: "13", Verify: "true", InlineData: "0000000000" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "6" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "7" } },
    { tag: "LdCtrlRestart", attrs: {} },
  ],
  unload: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "1" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "2" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "3" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "4" } },
    { tag: "LdCtrlMapError", attrs: { OriginalError: "3221498632", MappedError: "0" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "5" } },
    { tag: "LdCtrlMapError", attrs: { OriginalError: "3221498632", MappedError: "3221498632" } },
    { tag: "LdCtrlDisconnect", attrs: {} },
  ],
};

function appliesToMode(appliesTo: string | undefined, mode: DownloadMode): boolean {
  if (!appliesTo || appliesTo.trim() === "") return true;
  const tokens = appliesTo
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (mode === "full" || mode === "ap1") {
    return tokens.includes("full") || tokens.includes("all");
  }
  if (mode === "par") {
    return tokens.includes("par");
  }
  if (mode === "grp") {
    return tokens.includes("grp");
  }
  if (mode === "par,grp") {
    return tokens.includes("par") || tokens.includes("grp");
  }
  return false;
}

function isAllZeroHex(hex: string): boolean {
  return hex.length > 0 && /^0+$/.test(hex);
}

/**
 * Merges `knx_master.xml` `<MaskVersion><HawkConfigurationData><Procedures>` with an
 * `ApplicationProgram`'s `<LoadProcedures>` (`MergeId` 1..7) and compiles them into a concrete `DownloadPlan`.
 */
export class LoadProcedureEngine {
  public static buildPlan(
    app: KnxApplicationProgram,
    image: CompiledSystemBImage,
    mode: DownloadMode = "ap1",
    options: {
      knxProd?: ParsedKnxProd;
      maskVersion?: KnxMaskVersion;
      skipFillRuns?: boolean;
      skipRestart?: boolean;
      programSecurityObject?: boolean;
    } = {},
  ): DownloadPlan {
    const maskVer = options.maskVersion ?? options.knxProd?.maskVersions.get(app.maskVersionId);
    const hasPeiSegment = image.segments.has(5);

    // Choose procedureSubType matching MV-07B0 HawkConfigurationData
    const procedureType = mode === "unload" ? "Unload" : "Load";
    let procedureSubType: string;
    if (mode === "unload") {
      procedureSubType = "all";
    } else if (mode === "full") {
      procedureSubType = hasPeiSegment ? "all" : "ap1";
    } else {
      procedureSubType = mode;
    }

    // 1. Obtain template steps (MergedProcedure vs ProductProcedure)
    let rawSteps: KnxLdCtrlStep[];

    if (app.loadProcedureStyle === "ProductProcedure" && mode !== "unload") {
      rawSteps = app.loadProcedures.flatMap((lp) => lp.steps);
    } else {
      const masterProc = this.findMasterProcedure(maskVer, procedureType, procedureSubType);
      const templateSteps =
        masterProc?.steps ??
        DEFAULT_SYSTEM_B_PROCEDURES[mode === "unload" ? "unload" : procedureSubType] ??
        DEFAULT_SYSTEM_B_PROCEDURES.ap1;

      const appByMergeId = new Map<number, KnxLdCtrlStep[]>();
      for (const lp of app.loadProcedures) {
        if (lp.mergeId !== undefined) {
          const existing = appByMergeId.get(lp.mergeId) ?? [];
          existing.push(...lp.steps);
          appByMergeId.set(lp.mergeId, existing);
        }
      }

      rawSteps = [];
      for (const step of templateSteps) {
        if (step.tag === "LdCtrlMerge") {
          const mergeId = parseInt(step.attrs.MergeId ?? "0", 10);
          const merged = appByMergeId.get(mergeId);
          if (merged) {
            for (const ms of merged) {
              if (appliesToMode(ms.attrs.AppliesTo, mode)) {
                rawSteps.push(ms);
              }
            }
          }
        } else {
          // Skip Obj 5 (PEI Application Program 2) load/write steps when no PEI segment exists
          const objIdx = parseInt(step.attrs.ObjIdx ?? step.attrs.LsmIdx ?? "-1", 10);
          if (!hasPeiSegment && objIdx === 5 && step.tag !== "LdCtrlUnload") {
            continue;
          }
          if (appliesToMode(step.attrs.AppliesTo, mode)) {
            rawSteps.push(step);
          }
        }
      }
    }

    // 2. Translate raw XML LdCtrl steps into concrete DownloadActions with resolved sizes & payloads
    const actions: DownloadAction[] = [];
    const allocMetaByLsm = new Map<number, { mode: number; fill: number; size: number }>();
    let ignoreCurrentErrors = false;
    let estimatedBytesToWrite = 0;

    for (const step of rawSteps) {
      const a = step.attrs;
      switch (step.tag) {
        case "LdCtrlConnect":
          actions.push({ type: "Connect" });
          break;
        case "LdCtrlDisconnect":
          actions.push({ type: "Disconnect" });
          break;
        case "LdCtrlMapError": {
          // In knx_master.xml, MappedError="0" suppresses errors on optional LSMs (e.g. Obj 5 PEI unload)
          const mapped = parseInt(a.MappedError ?? "1", 10);
          ignoreCurrentErrors = mapped === 0;
          break;
        }
        case "LdCtrlUnload": {
          const lsmIdx = parseInt(a.LsmIdx ?? "0", 10);
          if (lsmIdx > 0) {
            actions.push({ type: "Unload", lsmIdx, ignoreErrors: ignoreCurrentErrors || lsmIdx === 5 });
          }
          break;
        }
        case "LdCtrlLoad": {
          const lsmIdx = parseInt(a.LsmIdx ?? "0", 10);
          if (lsmIdx > 0) {
            actions.push({ type: "LoadStart", lsmIdx });
          }
          break;
        }
        case "LdCtrlRelSegment": {
          const lsmIdx = parseInt(a.LsmIdx ?? "0", 10);
          const allocMode = parseInt(a.Mode ?? "0", 10);
          const fill = parseInt(a.Fill ?? "0", 10);
          let size = parseInt(a.Size ?? "0", 10);

          // Resolve actual table/segment size dynamically for Objects 1..5
          if (lsmIdx === 1) size = image.groupAddressTable.length;
          else if (lsmIdx === 2) size = image.associationTable.length;
          else if (lsmIdx === 3) size = image.groupObjectTable.length;
          else {
            const seg = image.segments.get(lsmIdx);
            if (seg) size = seg.size;
          }

          allocMetaByLsm.set(lsmIdx, { mode: allocMode, fill, size });
          actions.push({ type: "AllocRelSegment", lsmIdx, size, mode: allocMode, fill });
          break;
        }
        case "LdCtrlWriteRelMem": {
          const objIdx = parseInt(a.ObjIdx ?? "0", 10);
          const offset = parseInt(a.Offset ?? "0", 10);
          const requestedSize = parseInt(a.Size ?? "0", 10);
          const verify = a.Verify !== "false";
          const allocMeta = allocMetaByLsm.get(objIdx);

          const actualSize = this.resolveObjectByteLength(image, objIdx, offset, requestedSize);
          if (actualSize > 0) {
            const seg = image.segments.get(objIdx);
            if (seg) {
              const spans = SystemBCompiler.extractWritableSpans(seg, {
                offset,
                size: actualSize,
                mode: allocMeta?.mode,
                fill: allocMeta?.fill,
                skipFillRuns: options.skipFillRuns ?? true,
              });
              estimatedBytesToWrite += spans.reduce((acc, s) => acc + s.data.length, 0);
            } else {
              estimatedBytesToWrite += actualSize;
            }
            actions.push({
              type: "WriteRelMem",
              objIdx,
              offset,
              size: actualSize,
              verify,
              mode: allocMeta?.mode,
              fill: allocMeta?.fill,
            });
          }
          break;
        }
        case "LdCtrlWriteMem": {
          const address = parseInt(a.Address ?? "0", 10);
          const inlineHex = (a.InlineData ?? "").replace(/\s+/g, "");
          if (inlineHex.length > 0) {
            const data = Buffer.from(inlineHex, "hex");
            estimatedBytesToWrite += data.length;
            actions.push({
              type: "WriteAbsMem",
              address,
              data,
              verify: a.Verify !== "false",
            });
          }
          break;
        }
        case "LdCtrlWriteProp": {
          const objIdx = parseInt(a.ObjIdx ?? "0", 10);
          const propId = parseInt(a.PropId ?? "0", 10);
          const startElement = parseInt(a.StartElement ?? "1", 10);
          const count = parseInt(a.Count ?? "1", 10);
          const verify = a.Verify !== "false";
          const inlineHex = (a.InlineData ?? "").replace(/\s+/g, "");
          let data = inlineHex.length > 0 ? Buffer.from(inlineHex, "hex") : Buffer.alloc(0);

          // Substitute 5-byte PID_PROGRAM_VERSION when template holds 0000000000 placeholder
          if (objIdx === 4 && propId === 13 && (data.length === 0 || isAllZeroHex(inlineHex))) {
            data = Buffer.from(image.programVersion);
          }

          if (data.length > 0) {
            actions.push({ type: "WriteProp", objIdx, propId, startElement, count, data, verify });
          }
          break;
        }
        case "LdCtrlCompareProp": {
          const objIdx = parseInt(a.ObjIdx ?? "0", 10);
          const propId = parseInt(a.PropId ?? "0", 10);
          const startElement = parseInt(a.StartElement ?? "1", 10);
          const count = parseInt(a.Count ?? "1", 10);
          const inlineHex = (a.InlineData ?? "").replace(/\s+/g, "");
          const compareWithLoadedImage = inlineHex.length === 0 || isAllZeroHex(inlineHex);
          actions.push({
            type: "CompareProp",
            objIdx,
            propId,
            startElement,
            count,
            expected: compareWithLoadedImage ? undefined : Buffer.from(inlineHex, "hex"),
            compareWithLoadedImage,
          });
          break;
        }
        case "LdCtrlLoadImageProp": {
          const objIdx = parseInt(a.ObjIdx ?? "0", 10);
          const propId = parseInt(a.PropId ?? "0", 10);
          const startElement = parseInt(a.StartElement ?? "1", 10);
          const count = parseInt(a.Count ?? "1", 10);
          actions.push({ type: "LoadImageProp", objIdx, propId, startElement, count });
          break;
        }
        case "LdCtrlLoadCompleted": {
          const lsmIdx = parseInt(a.LsmIdx ?? "0", 10);
          if (lsmIdx > 0) {
            actions.push({ type: "LoadCompleted", lsmIdx });
          }
          break;
        }
        case "LdCtrlRestart":
          if (!options.skipRestart) {
            actions.push({ type: "Restart" });
          }
          break;
        default:
          break;
      }
    }

    // 3. Phase 2: Insert Security Interface Object (Type 17) commissioning step before Restart
    const sec = image.securityImage;
    const shouldProgramSecurity =
      Boolean(sec) &&
      mode !== "unload" &&
      (options.programSecurityObject !== undefined ? options.programSecurityObject : mode !== "par");

    if (sec && shouldProgramSecurity) {
      const secAction: DownloadAction = {
        type: "ProgramSecurityObject",
        objectInstance: sec.objectInstance,
        summary: {
          groupKeys: sec.groupKeyTable.length,
          goFlagsLength: sec.goSecurityFlags.length,
          iaEntries: sec.securityIndividualAddressTable.length,
          p2pKeys: sec.p2pKeyTable.length,
          writeToolKey: Boolean(sec.toolKey),
          setSecurityMode: sec.enableSecurityMode,
          writeSequenceNumberSending: sec.initialSequenceNumberSending !== undefined,
        },
      };

      estimatedBytesToWrite +=
        sec.groupKeyTable.length * 18 +
        sec.goSecurityFlags.length +
        sec.securityIndividualAddressTable.length * 8 +
        sec.p2pKeyTable.length * 20 +
        (sec.toolKey ? 16 : 0) +
        (sec.initialSequenceNumberSending !== undefined ? 6 : 0);

      const restartIdx = actions.findIndex((a) => a.type === "Restart" || a.type === "Disconnect");
      if (restartIdx !== -1) {
        actions.splice(restartIdx, 0, secAction);
      } else {
        actions.push(secAction);
      }
    }

    return {
      mode,
      procedureSubType,
      maskVersion: app.maskVersion,
      actions,
      estimatedBytesToWrite,
    };
  }

  private static findMasterProcedure(
    maskVer: KnxMaskVersion | undefined,
    procedureType: string,
    procedureSubType: string,
  ): KnxMasterProcedure | undefined {
    if (!maskVer) return undefined;
    return maskVer.procedures.find(
      (p) =>
        p.procedureType.toLowerCase() === procedureType.toLowerCase() &&
        p.procedureSubType.toLowerCase() === procedureSubType.toLowerCase(),
    );
  }

  private static resolveObjectByteLength(
    image: CompiledSystemBImage,
    objIdx: number,
    offset: number,
    requestedSize: number,
  ): number {
    let totalLen = 0;
    if (objIdx === 1) totalLen = image.groupAddressTable.length;
    else if (objIdx === 2) totalLen = image.associationTable.length;
    else if (objIdx === 3) totalLen = image.groupObjectTable.length;
    else {
      const seg = image.segments.get(objIdx);
      if (seg) totalLen = seg.size;
    }
    if (totalLen <= offset) return 0;
    return Math.min(requestedSize, totalLen - offset);
  }
}
