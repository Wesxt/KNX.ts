import { isCouplerMaskVersion, resolveManagementModel } from "./KnxProdParser";
import { SystemBCompiler } from "./SystemBCompiler";
import {
  CompiledSystemBImage,
  DownloadAction,
  DownloadMode,
  DownloadPlan,
  KnxApplicationProgram,
  KnxLdCtrlStep,
  KnxManagementModel,
  KnxMaskVersion,
  KnxMasterProcedure,
  ParsedKnxProd,
} from "./types";

/**
 * Built-in fallback System B (`MV-07B0` / `17B0` / `27B0` / `57B0`) procedure templates matching
 * `knx_master.xml` HawkConfigurationData, used when compiled standalone without `knx_master.xml`.
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

/** Built-in fallback BCU1 (`MV-0010`..`MV-0013`) procedures matching `knx_master.xml`. */
const DEFAULT_BCU1_PROCEDURES: Record<string, KnxLdCtrlStep[]> = {
  all: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlSetControlVariable", attrs: { Name: "EnableVerifyOnWriteDirect", Value: "true" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "269", Size: "1", Verify: "true", InlineData: "00" } },
    { tag: "LdCtrlLoadImageMem", attrs: { Address: "278", Size: "1" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "278", Size: "1", Verify: "true", InlineData: "01" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "256", Size: "1", Verify: "true" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "260", Size: "9", Verify: "true" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "270", Size: "8", Verify: "true" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "281", Size: "230", Verify: "true" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "206", Size: "9", Verify: "true", InlineData: "000000000000000000" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "215", Size: "9", Verify: "true", InlineData: "000000000000000000" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "278", Size: "1", Verify: "true" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "269", Size: "1", Verify: "true", InlineData: "FF" } },
    { tag: "LdCtrlRestart", attrs: {} },
  ],
  unload: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlSetControlVariable", attrs: { Name: "EnableVerifyOnWriteDirect", Value: "true" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "269", Size: "1", Verify: "true", InlineData: "00" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "278", Size: "1", Verify: "true", InlineData: "01" } },
    { tag: "LdCtrlWriteMem", attrs: { Address: "261", Size: "3", Verify: "true", InlineData: "000000" } },
    { tag: "LdCtrlDisconnect", attrs: {} },
  ],
};

/** Built-in fallback BCU1 Coupler (`MV-091A`) procedures matching `knx_master.xml`. */
const DEFAULT_COUPLER_091A_PROCEDURES: Record<string, KnxLdCtrlStep[]> = {
  all: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlMerge", attrs: { MergeId: "1" } },
    { tag: "LdCtrlUnload", attrs: { ObjType: "6" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "2" } },
    { tag: "LdCtrlLoad", attrs: { ObjType: "6" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "52", Verify: "true", InlineData: "77" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "53", Verify: "true", InlineData: "77" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "54", Verify: "true", InlineData: "17" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "55", Verify: "true", InlineData: "17" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "3" } },
    { tag: "LdCtrlClearLCFilterTable", attrs: { UseFunctionProp: "true" } },
    { tag: "LdCtrlWriteMem", attrs: { AddressSpace: "LcFilter", Address: "512", Size: "8192", Verify: "true" } },
    { tag: "LdCtrlLoadCompleted", attrs: { ObjType: "6" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "4" } },
    { tag: "LdCtrlRestart", attrs: {} },
  ],
  par: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlMerge", attrs: { MergeId: "1" } },
    { tag: "LdCtrlLoad", attrs: { ObjType: "6" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "52", Verify: "true", InlineData: "77" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "53", Verify: "true", InlineData: "77" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "54", Verify: "true", InlineData: "17" } },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "55", Verify: "true", InlineData: "17" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "3" } },
    { tag: "LdCtrlLoadCompleted", attrs: { ObjType: "6" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "4" } },
    { tag: "LdCtrlRestart", attrs: {} },
  ],
  grp: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlMerge", attrs: { MergeId: "1" } },
    { tag: "LdCtrlLoad", attrs: { ObjType: "6" } },
    { tag: "LdCtrlClearLCFilterTable", attrs: { UseFunctionProp: "true" } },
    { tag: "LdCtrlWriteMem", attrs: { AddressSpace: "LcFilter", Address: "512", Size: "8192", Verify: "true" } },
    { tag: "LdCtrlLoadCompleted", attrs: { ObjType: "6" } },
    { tag: "LdCtrlDisconnect", attrs: {} },
  ],
  unload: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlMerge", attrs: { MergeId: "5" } },
    { tag: "LdCtrlDisconnect", attrs: {} },
  ],
};

/** Built-in fallback System B Coupler (`MV-2920`) procedures matching `knx_master.xml`. */
const DEFAULT_COUPLER_2920_PROCEDURES: Record<string, KnxLdCtrlStep[]> = {
  all: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlMerge", attrs: { MergeId: "1" } },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "0" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "2" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "0" } },
    { tag: "LdCtrlUnload", attrs: { ObjType: "6", Occurrence: "1" } },
    { tag: "LdCtrlLoad", attrs: { ObjType: "6", Occurrence: "1" } },
    { tag: "LdCtrlClearLCFilterTable", attrs: { UseFunctionProp: "true" } },
    { tag: "LdCtrlRelSegment", attrs: { ObjType: "6", Occurrence: "1", Size: "8192", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjType: "6", Occurrence: "1", Offset: "0", Size: "8192", Verify: "true" } },
    {
      tag: "LdCtrlWriteProp",
      attrs: { ObjType: "6", Occurrence: "1", PropId: "67", InlineData: "01", Verify: "true" },
    },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "61", InlineData: "0005", Verify: "true" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "3" } },
    { tag: "LdCtrlLoadCompleted", attrs: { ObjType: "6", Occurrence: "1" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "0" } },
    { tag: "LdCtrlLoadImageProp", attrs: { ObjType: "6", Occurrence: "1", PropId: "27" } },
    { tag: "LdCtrlDisconnect", attrs: {} },
  ],
  grp: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlUnload", attrs: { ObjType: "6", Occurrence: "1" } },
    { tag: "LdCtrlLoad", attrs: { ObjType: "6", Occurrence: "1" } },
    { tag: "LdCtrlClearLCFilterTable", attrs: { UseFunctionProp: "true" } },
    { tag: "LdCtrlRelSegment", attrs: { ObjType: "6", Occurrence: "1", Size: "8192", Mode: "0", Fill: "0" } },
    { tag: "LdCtrlWriteRelMem", attrs: { ObjType: "6", Occurrence: "1", Offset: "0", Size: "8192", Verify: "true" } },
    { tag: "LdCtrlLoadCompleted", attrs: { ObjType: "6", Occurrence: "1" } },
    { tag: "LdCtrlLoadImageProp", attrs: { ObjType: "6", Occurrence: "1", PropId: "27" } },
    { tag: "LdCtrlDisconnect", attrs: {} },
  ],
  par: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlUnload", attrs: { LsmIdx: "0" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "2" } },
    { tag: "LdCtrlLoad", attrs: { LsmIdx: "0" } },
    {
      tag: "LdCtrlWriteProp",
      attrs: { ObjType: "6", Occurrence: "1", PropId: "67", InlineData: "01", Verify: "true" },
    },
    { tag: "LdCtrlWriteProp", attrs: { ObjType: "6", PropId: "61", InlineData: "0005", Verify: "true" } },
    { tag: "LdCtrlMerge", attrs: { MergeId: "3" } },
    { tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: "0" } },
    { tag: "LdCtrlDisconnect", attrs: {} },
  ],
  unload: [
    { tag: "LdCtrlConnect", attrs: {} },
    { tag: "LdCtrlMasterReset", attrs: { EraseCode: "7", ChannelNumber: "0" } },
    { tag: "LdCtrlDisconnect", attrs: {} },
  ],
};

/** Built-in fallback BIM M112 / System 7 (`MV-0700`/`0701`/`0705`) Unload procedure. */
const DEFAULT_BIM_M112_UNLOAD: KnxLdCtrlStep[] = [
  { tag: "LdCtrlConnect", attrs: {} },
  { tag: "LdCtrlUnload", attrs: { LsmIdx: "1" } },
  { tag: "LdCtrlUnload", attrs: { LsmIdx: "2" } },
  { tag: "LdCtrlUnload", attrs: { LsmIdx: "3" } },
  { tag: "LdCtrlUnload", attrs: { LsmIdx: "4" } },
  { tag: "LdCtrlDisconnect", attrs: {} },
];

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

function parseIntAttr(val?: string): number | undefined {
  if (val === undefined || val === "") return undefined;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? undefined : n;
}

function extractNonZeroFilterSpans(
  filterTable: Buffer,
  baseOffset: number,
  size: number,
  skipZeroRuns: boolean,
): { offset: number; data: Buffer }[] {
  const effectiveLen = Math.min(size, filterTable.length - baseOffset);
  if (effectiveLen <= 0) return [];
  if (!skipZeroRuns) {
    return [{ offset: baseOffset, data: Buffer.from(filterTable.subarray(baseOffset, baseOffset + effectiveLen)) }];
  }

  const spans: { offset: number; data: Buffer }[] = [];
  const end = baseOffset + effectiveLen;
  let i = baseOffset;
  while (i < end) {
    while (i < end && filterTable[i] === 0x00) i++;
    if (i >= end) break;
    const start = i;
    let zeroRun = 0;
    while (i < end) {
      if (filterTable[i] === 0x00) {
        zeroRun++;
        if (zeroRun >= 8) break;
      } else {
        zeroRun = 0;
      }
      i++;
    }
    const spanEnd = zeroRun >= 8 ? i - zeroRun + 1 : i;
    if (spanEnd > start) {
      spans.push({ offset: start, data: Buffer.from(filterTable.subarray(start, spanEnd)) });
    }
  }
  return spans;
}

/**
 * Merges `knx_master.xml` `<MaskVersion><HawkConfigurationData><Procedures>` with an
 * `ApplicationProgram`'s `<LoadProcedures>` (`MergedProcedure` or `ProductProcedure`) and compiles
 * them into a concrete `DownloadPlan` across all supported KNX Management Models:
 * - System B (`MV-07B0`, `17B0`, `27B0`, `2920`, `57B0`)
 * - System 7 / BIM M112 (`MV-0700`, `0701`, `0705`, `1900`, `2705`, `5705`)
 * - System 2 / BCU2 (`MV-0020`, `0021`, `0025`)
 * - System 1 / BCU1 & Couplers (`MV-0010`–`0013`, `1011`–`1013`, `091A`, `0912`)
 * - System 300 / PropertyBased (`MV-0300`)
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
      differentialWrite?: boolean;
      previousSegments?: Map<number, Buffer>;
      previousAbsoluteSegments?: Map<string, Buffer>;
    } = {},
  ): DownloadPlan {
    const maskVer = options.maskVersion ?? options.knxProd?.maskVersions.get(app.maskVersionId);
    const managementModel: KnxManagementModel =
      image.managementModel ?? resolveManagementModel(app.maskVersion, maskVer);
    const hasPeiSegment = image.segments.has(5);
    const isCoupler = isCouplerMaskVersion(app.maskVersion);

    // Choose procedureSubType matching HawkConfigurationData
    const procedureType = mode === "unload" ? "Unload" : "Load";
    let procedureSubType: string;
    if (mode === "unload") {
      procedureSubType = "all";
    } else if (mode === "full") {
      procedureSubType = hasPeiSegment || managementModel !== "SystemB" || isCoupler ? "all" : "ap1";
    } else if (mode === "ap1" && (managementModel !== "SystemB" || isCoupler)) {
      procedureSubType = "all";
    } else {
      procedureSubType = mode;
    }

    // 1. Obtain template steps (ProductProcedure vs PropertyBased vs MergedProcedure)
    let rawSteps: KnxLdCtrlStep[];

    if (managementModel === "PropertyBased" && app.loadProcedures.length === 0 && mode !== "unload") {
      // System 300 (MV-0300): Property-based direct writes
      rawSteps = [{ tag: "LdCtrlConnect", attrs: {} }];
      for (const pw of image.propertyWrites) {
        const attrs: Record<string, string> = {
          PropId: String(pw.propertyId),
          StartElement: "1",
          Count: "1",
          Verify: "true",
          InlineData: pw.data.toString("hex").toUpperCase(),
        };
        if (pw.objectIndex !== undefined) attrs.ObjIdx = String(pw.objectIndex);
        else if (pw.objectType !== undefined) {
          attrs.ObjType = String(pw.objectType);
          if (pw.occurrence !== undefined) attrs.Occurrence = String(pw.occurrence);
        } else {
          attrs.ObjIdx = "0";
        }
        rawSteps.push({ tag: "LdCtrlWriteProp", attrs });
      }
      rawSteps.push({ tag: "LdCtrlRestart", attrs: {} });
    } else if (app.loadProcedureStyle === "ProductProcedure" && mode !== "unload") {
      const productSteps = app.loadProcedures
        .flatMap((lp) => lp.steps)
        .filter((s) => appliesToMode(s.attrs.AppliesTo, mode));

      // Minimal ProductProcedure (e.g. BCU2 MV-0021 containing only <LdCtrlAbsSegment>) needs Connect/Unload/Load/LoadCompleted wrapper
      const hasLifecycle = productSteps.some(
        (s) => s.tag === "LdCtrlConnect" || s.tag === "LdCtrlLoad" || s.tag === "LdCtrlUnload",
      );
      if (!hasLifecycle && productSteps.length > 0) {
        const lsmSet = new Set<number>();
        for (const s of productSteps) {
          const lsm = parseIntAttr(s.attrs.LsmIdx);
          if (lsm !== undefined) lsmSet.add(lsm);
        }
        const lsms = Array.from(lsmSet).sort((a, b) => a - b);
        rawSteps = [{ tag: "LdCtrlConnect", attrs: {} }];
        for (const lsm of lsms) rawSteps.push({ tag: "LdCtrlUnload", attrs: { LsmIdx: String(lsm) } });
        for (const lsm of lsms) {
          rawSteps.push({ tag: "LdCtrlLoad", attrs: { LsmIdx: String(lsm) } });
          for (const s of productSteps) {
            if (parseIntAttr(s.attrs.LsmIdx) === lsm) rawSteps.push(s);
          }
          rawSteps.push({ tag: "LdCtrlLoadCompleted", attrs: { LsmIdx: String(lsm) } });
        }
        for (const s of productSteps) {
          if (parseIntAttr(s.attrs.LsmIdx) === undefined) rawSteps.push(s);
        }
        rawSteps.push({ tag: "LdCtrlRestart", attrs: {} });
      } else {
        rawSteps = productSteps;
      }
    } else {
      const masterProc = this.findMasterProcedure(maskVer, procedureType, procedureSubType);
      const templateSteps =
        masterProc?.steps ?? this.getFallbackTemplateSteps(app.maskVersion, managementModel, mode, procedureSubType);

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

    // Check if an application parameter overrides PID_FILTER_TABLE_USE (ObjType 6, PID 67)
    const filterTableUseParam = image.propertyWrites.find(
      (pw) => (pw.objectType === 6 || pw.objectIndex === 6) && pw.propertyId === 67,
    );
    const filterTableDisabled =
      filterTableUseParam !== undefined && filterTableUseParam.data.length > 0 && filterTableUseParam.data[0] === 0;

    // 2. Translate raw XML LdCtrl steps into concrete DownloadActions with resolved sizes & payloads
    const actions: DownloadAction[] = [];
    const allocMetaByKey = new Map<string, { mode: number; fill: number; size: number }>();
    const loadedImageMemKeys = new Set<string>();
    let ignoreCurrentErrors = false;
    let enableSegmentWrite = true;
    let enableVerifyOnWriteDirect = false;
    let filterTableCleared = false;
    let estimatedBytesToWrite = 0;

    const useDifferential =
      options.differentialWrite ??
      ((mode === "par" || mode === "par,grp") &&
        Boolean(options.previousSegments?.size || options.previousAbsoluteSegments?.size));

    const allocKey = (objIdx?: number, objType?: number, occurrence?: number) =>
      objIdx !== undefined ? `idx:${objIdx}` : `type:${objType ?? -1}:${occurrence ?? 0}`;

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
        case "LdCtrlSetControlVariable": {
          const name = a.Name ?? "";
          const val = a.Value === "true" || a.Value === "1";
          if (name === "EnableSegmentWrite") enableSegmentWrite = val;
          else if (name === "EnableVerifyOnWriteDirect") enableVerifyOnWriteDirect = val;
          break;
        }
        case "LdCtrlUnload": {
          const lsmIdx = parseIntAttr(a.LsmIdx);
          const objType = parseIntAttr(a.ObjType);
          const occurrence = parseIntAttr(a.Occurrence);
          if (lsmIdx !== undefined || objType !== undefined) {
            actions.push({
              type: "Unload",
              lsmIdx,
              objType,
              occurrence,
              ignoreErrors: ignoreCurrentErrors || lsmIdx === 5,
            });
          }
          break;
        }
        case "LdCtrlLoad": {
          const lsmIdx = parseIntAttr(a.LsmIdx);
          const objType = parseIntAttr(a.ObjType);
          const occurrence = parseIntAttr(a.Occurrence);
          if (lsmIdx !== undefined || objType !== undefined) {
            actions.push({ type: "LoadStart", lsmIdx, objType, occurrence });
          }
          break;
        }
        case "LdCtrlRelSegment": {
          const lsmIdx = parseIntAttr(a.LsmIdx);
          const objType = parseIntAttr(a.ObjType);
          const occurrence = parseIntAttr(a.Occurrence);
          let allocMode = parseInt(a.Mode ?? "0", 10);
          const fill = parseInt(a.Fill ?? "0", 10);
          let size = parseInt(a.Size ?? "0", 10);

          if (lsmIdx === 1) size = image.groupAddressTable.length;
          else if (lsmIdx === 2) size = image.associationTable.length;
          else if (lsmIdx === 3) size = image.groupObjectTable.length;
          else if (lsmIdx !== undefined) {
            const seg = image.segments.get(lsmIdx);
            if (seg) size = seg.size;
          } else if (objType === 6 && image.filterTable) {
            size = Math.min(size || image.filterTable.length, image.filterTable.length);
          }

          // When performing a partial differential download on an unchanged segment size, force Mode=0 (do not erase)
          // so untouched bytes remain intact on the device (guarded by LdCtrlCompareProp on PID_TABLE_REFERENCE).
          if (
            useDifferential &&
            (mode === "par" || mode === "par,grp") &&
            lsmIdx !== undefined &&
            lsmIdx >= 4 &&
            options.previousSegments?.get(lsmIdx)?.length === size
          ) {
            allocMode = 0;
          }

          allocMetaByKey.set(allocKey(lsmIdx, objType, occurrence), { mode: allocMode, fill, size });
          actions.push({ type: "AllocRelSegment", lsmIdx, objType, occurrence, size, mode: allocMode, fill });
          break;
        }
        case "LdCtrlAbsSegment": {
          const lsmIdx = parseInt(a.LsmIdx ?? "0", 10);
          const segType = parseInt(a.SegType ?? "0", 10);
          const address = parseInt(a.Address ?? "0", 10);
          const size = parseInt(a.Size ?? "0", 10);
          const access = parseInt(a.Access ?? "255", 10);
          const memType = parseInt(a.MemType ?? "3", 10);
          const segFlags = parseInt(a.SegFlags ?? "0", 10);

          actions.push({
            type: "AllocAbsSegment",
            lsmIdx,
            segType,
            address,
            size,
            access,
            memType,
            segFlags,
          });

          // Per KNX 03_05_02 & Hawk EnableSegmentWrite (default true): non-RAM absolute segments (MemType=3 EEPROM/Flash)
          // are written immediately after allocation unless EnableSegmentWrite was explicitly set to false.
          if (enableSegmentWrite && memType !== 1 && memType !== 2 && size > 0) {
            const spans = SystemBCompiler.extractAbsoluteMemorySpans(image, address, size, {
              previousAbsoluteSegments: useDifferential ? options.previousAbsoluteSegments : undefined,
            });
            for (const sp of spans) {
              estimatedBytesToWrite += sp.data.length;
              actions.push({
                type: "WriteAbsMem",
                address: sp.address,
                data: sp.data,
                verify: !app.options.legacyNoMemoryVerifyMode,
                addressSpace: sp.userMemory ? "UserMemory" : "Standard",
              });
            }
          }
          break;
        }
        case "LdCtrlTaskSegment": {
          const lsmIdx = parseInt(a.LsmIdx ?? "0", 10);
          const address = parseInt(a.Address ?? "0", 10);
          actions.push({ type: "TaskSegment", lsmIdx, address });
          break;
        }
        case "LdCtrlTaskPtr": {
          const lsmIdx = parseInt(a.LsmIdx ?? "0", 10);
          const initPtr = parseInt(a.InitPtr ?? "0", 10);
          const savePtr = parseInt(a.SavePtr ?? "0", 10);
          const serialPtr = parseInt(a.SerialPtr ?? "0", 10);
          actions.push({ type: "TaskPtr", lsmIdx, initPtr, savePtr, serialPtr });
          break;
        }
        case "LdCtrlTaskCtrl1": {
          const lsmIdx = parseInt(a.LsmIdx ?? "0", 10);
          const address = parseInt(a.Address ?? "0", 10);
          const count = parseInt(a.Count ?? "0", 10);
          actions.push({ type: "TaskCtrl1", lsmIdx, address, count });
          break;
        }
        case "LdCtrlTaskCtrl2": {
          const lsmIdx = parseInt(a.LsmIdx ?? "0", 10);
          const callback = parseInt(a.Callback ?? "0", 10);
          const address = parseInt(a.Address ?? "0", 10);
          const seg0 = parseInt(a.Seg0 ?? "0", 10);
          const seg1 = parseInt(a.Seg1 ?? "0", 10);
          actions.push({ type: "TaskCtrl2", lsmIdx, callback, address, seg0, seg1 });
          break;
        }
        case "LdCtrlWriteRelMem": {
          const objIdx = parseIntAttr(a.ObjIdx);
          const objType = parseIntAttr(a.ObjType);
          const occurrence = parseIntAttr(a.Occurrence);
          const offset = parseInt(a.Offset ?? "0", 10);
          const requestedSize = parseInt(a.Size ?? "0", 10);
          const verify = a.Verify !== "false";
          const allocMeta = allocMetaByKey.get(allocKey(objIdx, objType, occurrence));

          if (objType === 6) {
            // Router Filter Table relative write (MV-2920)
            if (filterTableDisabled || !image.filterTable) break;
            const spans = extractNonZeroFilterSpans(
              image.filterTable,
              offset,
              requestedSize,
              filterTableCleared && (options.skipFillRuns ?? true),
            );
            for (const sp of spans) {
              estimatedBytesToWrite += sp.data.length;
              actions.push({
                type: "WriteRelMem",
                objType,
                occurrence,
                offset: sp.offset,
                size: sp.data.length,
                verify,
                mode: allocMeta?.mode,
                fill: allocMeta?.fill,
              });
            }
            break;
          }

          if (objIdx === undefined) break;
          const actualSize = this.resolveObjectByteLength(image, objIdx, offset, requestedSize);
          if (actualSize > 0) {
            const seg = image.segments.get(objIdx);
            if (seg) {
              const prevSeg =
                useDifferential && allocMeta?.mode !== 1 ? options.previousSegments?.get(objIdx) : undefined;
              const spans = SystemBCompiler.extractWritableSpans(seg, {
                offset,
                size: actualSize,
                mode: allocMeta?.mode,
                fill: allocMeta?.fill,
                skipFillRuns: options.skipFillRuns ?? true,
                previousImage: prevSeg,
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
          const requestedSize = parseInt(a.Size ?? "0", 10);
          const verify = a.Verify !== undefined ? a.Verify !== "false" : enableVerifyOnWriteDirect;
          const rawSpace = a.AddressSpace ?? "Standard";
          const addressSpace: "Standard" | "UserMemory" | "LcFilter" | "LcSlave" =
            rawSpace === "LcFilter"
              ? "LcFilter"
              : rawSpace === "LcSlave"
                ? "LcSlave"
                : rawSpace === "UserMemory"
                  ? "UserMemory"
                  : "Standard";
          const inlineHex = (a.InlineData ?? "").replace(/\s+/g, "");

          if (inlineHex.length > 0) {
            const data = Buffer.from(inlineHex, "hex");
            if (addressSpace !== "LcSlave") estimatedBytesToWrite += data.length;
            actions.push({
              type: "WriteAbsMem",
              address,
              data,
              verify,
              addressSpace,
            });
          } else if (addressSpace === "LcFilter") {
            if (!filterTableDisabled && image.filterTable) {
              const tableSize = requestedSize > 0 ? requestedSize : image.filterTable.length;
              const spans = extractNonZeroFilterSpans(
                image.filterTable,
                0,
                tableSize,
                filterTableCleared && (options.skipFillRuns ?? true),
              );
              for (const sp of spans) {
                estimatedBytesToWrite += sp.data.length;
                actions.push({
                  type: "WriteAbsMem",
                  address: address + sp.offset,
                  data: sp.data,
                  verify,
                  addressSpace: "LcFilter",
                });
              }
            }
          } else if (requestedSize > 0) {
            const spans = SystemBCompiler.extractAbsoluteMemorySpans(image, address, requestedSize, {
              previousAbsoluteSegments: useDifferential ? options.previousAbsoluteSegments : undefined,
            });
            if (spans.length > 0) {
              for (const sp of spans) {
                if (addressSpace !== "LcSlave") estimatedBytesToWrite += sp.data.length;
                actions.push({
                  type: "WriteAbsMem",
                  address: sp.address,
                  data: sp.data,
                  verify,
                  addressSpace: addressSpace === "Standard" && sp.userMemory ? "UserMemory" : addressSpace,
                });
              }
            } else if (loadedImageMemKeys.has(`${address}:${requestedSize}`)) {
              // Restore byte(s) saved by an earlier LdCtrlLoadImageMem (e.g. BCU1/BCU2 addr 278 when no segment covers it)
              estimatedBytesToWrite += requestedSize;
              actions.push({
                type: "WriteAbsMem",
                address,
                data: Buffer.alloc(requestedSize),
                verify,
                addressSpace,
                restoreFromLoadedImage: true,
              });
            }
          }
          break;
        }
        case "LdCtrlLoadImageMem": {
          const address = parseInt(a.Address ?? "0", 10);
          const size = parseInt(a.Size ?? "1", 10);
          const addressSpace = a.AddressSpace === "UserMemory" ? "UserMemory" : "Standard";
          loadedImageMemKeys.add(`${address}:${size}`);
          actions.push({ type: "LoadImageMem", address, size, addressSpace });
          break;
        }
        case "LdCtrlCompareMem": {
          const address = parseInt(a.Address ?? "0", 10);
          const size = parseInt(a.Size ?? "1", 10);
          const inlineHex = (a.InlineData ?? "").replace(/\s+/g, "");
          const maskHex = (a.Mask ?? "").replace(/\s+/g, "");
          const compareWithLoadedImage = inlineHex.length === 0;
          actions.push({
            type: "CompareMem",
            address,
            size,
            expected: inlineHex.length > 0 ? Buffer.from(inlineHex, "hex") : undefined,
            mask: maskHex.length > 0 ? Buffer.from(maskHex, "hex") : undefined,
            compareWithLoadedImage,
            addressSpace: a.AddressSpace === "UserMemory" ? "UserMemory" : "Standard",
          });
          break;
        }
        case "LdCtrlClearLCFilterTable": {
          filterTableCleared = true;
          actions.push({
            type: "ClearLCFilterTable",
            useFunctionProp: a.UseFunctionProp === "true" || a.UseFunctionProp === "1",
            objType: parseIntAttr(a.ObjType) ?? 6,
            occurrence: parseIntAttr(a.Occurrence) ?? (app.maskVersion === 0x2920 ? 1 : 0),
          });
          break;
        }
        case "LdCtrlWriteProp": {
          const objIdx = parseIntAttr(a.ObjIdx);
          const objType = parseIntAttr(a.ObjType);
          const occurrence = parseIntAttr(a.Occurrence);
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

          // MV-2920 PID_FILTER_TABLE_USE (ObjType 6, PID 67) parameter override
          if (objType === 6 && propId === 67 && filterTableUseParam) {
            data = Buffer.from(filterTableUseParam.data);
          }

          // MV-2920 PID_HOP_COUNT (ObjType 6, PID 61): 0004 for Area Coupler (A.0.0), 0005 for Line Coupler
          if (objType === 6 && propId === 61 && image.isAreaCoupler && inlineHex.toUpperCase() === "0005") {
            data = Buffer.from("0004", "hex");
          }

          if (data.length > 0) {
            actions.push({ type: "WriteProp", objIdx, objType, occurrence, propId, startElement, count, data, verify });
          }
          break;
        }
        case "LdCtrlCompareProp": {
          const objIdx = parseIntAttr(a.ObjIdx);
          const objType = parseIntAttr(a.ObjType);
          const occurrence = parseIntAttr(a.Occurrence);
          const propId = parseInt(a.PropId ?? "0", 10);
          const startElement = parseInt(a.StartElement ?? "1", 10);
          const count = parseInt(a.Count ?? "1", 10);
          const inlineHex = (a.InlineData ?? "").replace(/\s+/g, "");
          const maskHex = (a.Mask ?? "").replace(/\s+/g, "");
          const compareWithLoadedImage = inlineHex.length === 0 || (isAllZeroHex(inlineHex) && maskHex.length === 0);
          actions.push({
            type: "CompareProp",
            objIdx,
            objType,
            occurrence,
            propId,
            startElement,
            count,
            expected: compareWithLoadedImage ? undefined : Buffer.from(inlineHex, "hex"),
            mask: maskHex.length > 0 ? Buffer.from(maskHex, "hex") : undefined,
            compareWithLoadedImage,
          });
          break;
        }
        case "LdCtrlLoadImageProp": {
          const objIdx = parseIntAttr(a.ObjIdx);
          const objType = parseIntAttr(a.ObjType);
          const occurrence = parseIntAttr(a.Occurrence);
          const propId = parseInt(a.PropId ?? "0", 10);
          const startElement = parseInt(a.StartElement ?? "1", 10);
          const count = parseInt(a.Count ?? "1", 10);
          actions.push({ type: "LoadImageProp", objIdx, objType, occurrence, propId, startElement, count });
          break;
        }
        case "LdCtrlLoadCompleted": {
          const lsmIdx = parseIntAttr(a.LsmIdx);
          const objType = parseIntAttr(a.ObjType);
          const occurrence = parseIntAttr(a.Occurrence);
          if (lsmIdx !== undefined || objType !== undefined) {
            actions.push({ type: "LoadCompleted", lsmIdx, objType, occurrence });
          }
          break;
        }
        case "LdCtrlDelay": {
          const ms = parseInt(a.MilliSeconds ?? "0", 10);
          if (ms > 0) {
            actions.push({ type: "Delay", milliseconds: ms });
          }
          break;
        }
        case "LdCtrlMasterReset": {
          const eraseCode = parseInt(a.EraseCode ?? "1", 10);
          const channelNumber = parseInt(a.ChannelNumber ?? "0", 10);
          actions.push({ type: "MasterReset", eraseCode, channelNumber });
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

    // 3. Phase 2: Insert Security Interface Object (Type 17) commissioning step before Restart/Disconnect
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
      managementModel,
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
    const matchBySubType = (sub: string) => {
      const candidates = maskVer.procedures.filter(
        (p) =>
          p.procedureType.toLowerCase() === procedureType.toLowerCase() &&
          p.procedureSubType.toLowerCase() === sub.toLowerCase(),
      );
      if (candidates.length === 0) return undefined;
      // Prefer "remote" procedure over local-only procedures (e.g. BCU2 MV-0021 has "remote local2" and "local1")
      return candidates.find((p) => p.access.toLowerCase().includes("remote")) ?? candidates[0];
    };

    const exact = matchBySubType(procedureSubType);
    if (exact) return exact;
    if (procedureType.toLowerCase() === "load" && (procedureSubType === "ap1" || procedureSubType === "full")) {
      return matchBySubType("all") ?? matchBySubType("ap1");
    }
    return undefined;
  }

  private static getFallbackTemplateSteps(
    maskVersion: number,
    managementModel: KnxManagementModel,
    mode: DownloadMode,
    procedureSubType: string,
  ): KnxLdCtrlStep[] {
    const key = mode === "unload" ? "unload" : procedureSubType;
    if (maskVersion === 0x2920) {
      return DEFAULT_COUPLER_2920_PROCEDURES[key] ?? DEFAULT_COUPLER_2920_PROCEDURES.all;
    }
    if (maskVersion === 0x091a || maskVersion === 0x0912) {
      return DEFAULT_COUPLER_091A_PROCEDURES[key] ?? DEFAULT_COUPLER_091A_PROCEDURES.all;
    }
    if (managementModel === "BimM112" && mode === "unload") {
      return DEFAULT_BIM_M112_UNLOAD;
    }
    if (managementModel === "Bcu1") {
      return DEFAULT_BCU1_PROCEDURES[key] ?? DEFAULT_BCU1_PROCEDURES.all;
    }
    if (managementModel === "Bcu2") {
      return mode === "unload" ? DEFAULT_BIM_M112_UNLOAD : DEFAULT_BCU1_PROCEDURES.all;
    }
    return DEFAULT_SYSTEM_B_PROCEDURES[key] ?? DEFAULT_SYSTEM_B_PROCEDURES.ap1;
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
