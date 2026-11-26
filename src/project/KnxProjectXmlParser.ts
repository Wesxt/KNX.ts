import { decodeXmlEntities } from "../programming/KnxProdParser";
import type { FlagSetting, GroupObjectPriority } from "../programming/types";
import {
  GroupAddressStyle,
  KnxArea,
  KnxBaggageFile,
  KnxBinaryDataEntry,
  KnxBusInterface,
  KnxCatalogItem,
  KnxCatalogSection,
  KnxDeviceInstance,
  KnxFunction,
  KnxGroupAddress,
  KnxGroupAddressRef,
  KnxGroupObjectTreeNode,
  KnxGroupRange,
  KnxInstallation,
  KnxLine,
  KnxMasterData,
  KnxMasterDatapointSubtype,
  KnxMasterDatapointType,
  KnxModuleInstance,
  KnxProjectCertificateInfo,
  KnxProjectHardware2Program,
  KnxProjectHardwareEntry,
  KnxProjectHardwareProduct,
  KnxProjectHistoryEntry,
  KnxProjectInfo,
  KnxProjectUserFile,
  KnxSegment,
  KnxSpace,
  KnxTrade,
} from "./types";

// ============================================================================
// Low-level offset-aware zero-dependency XML scanner (supports lossless raw capture)
// ============================================================================

interface RawXmlToken {
  kind: "start" | "end" | "text";
  tag: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  startPos: number;
  endPos: number;
  text: string;
}

function stripPrefix(raw: string): string {
  const idx = raw.indexOf(":");
  return idx === -1 ? raw : raw.slice(idx + 1);
}

function parseAttributesFast(src: string, start: number, end: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = start;
  while (i < end) {
    while (i < end && src.charCodeAt(i) <= 32) i++;
    if (i >= end) break;
    const nameStart = i;
    while (i < end) {
      const c = src.charCodeAt(i);
      if (c === 61 /* = */ || c <= 32 || c === 47 /* / */) break;
      i++;
    }
    const name = src.slice(nameStart, i);
    while (i < end && src.charCodeAt(i) <= 32) i++;
    if (i >= end || src.charCodeAt(i) !== 61) continue;
    i++;
    while (i < end && src.charCodeAt(i) <= 32) i++;
    if (i >= end) break;
    const q = src.charCodeAt(i);
    if (q === 34 || q === 39) {
      i++;
      const valStart = i;
      const valEnd = src.indexOf(q === 34 ? '"' : "'", valStart);
      if (valEnd === -1 || valEnd > end) break;
      const rawVal = src.slice(valStart, valEnd);
      attrs[name] = rawVal.includes("&") ? decodeXmlEntities(rawVal) : rawVal;
      i = valEnd + 1;
    } else {
      const valStart = i;
      while (i < end && src.charCodeAt(i) > 32) i++;
      attrs[name] = src.slice(valStart, i);
    }
  }
  return attrs;
}

interface ScanXmlOptions {
  /** Return `"skip"` to silently skip a subtree, `"capture"` to return raw XML substring via `onCapturedRaw`, or `undefined` to descend normally. */
  onStart: (
    tag: string,
    attrs: Record<string, string>,
    selfClosing: boolean,
    startPos: number,
    endPos: number,
  ) => void | "skip" | "capture";
  onEnd?: (tag: string, startPos: number, endPos: number) => void;
  onText?: (text: string) => void;
  onCapturedRaw?: (tag: string, rawXml: string) => void;
}

/**
 * Single-pass offset-aware XML scanner that supports skipping subtrees AND capturing exact
 * verbatim XML fragments of unknown elements for lossless `.knxproj` round-trip serialization.
 */
export function scanXmlSync(xml: string, opts: ScanXmlOptions): void {
  const clean = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const len = clean.length;
  let pos = 0;

  let bypassMode: "skip" | "capture" | null = null;
  let bypassTag = "";
  let bypassDepth = 0;
  let bypassStartPos = 0;

  while (pos < len) {
    if (bypassMode !== null) {
      const lt = clean.indexOf("<", pos);
      if (lt === -1) break;
      const c1 = clean.charCodeAt(lt + 1);
      if (c1 === 33) {
        if (clean.startsWith("<!--", lt)) {
          const end = clean.indexOf("-->", lt + 4);
          pos = end === -1 ? len : end + 3;
          continue;
        }
        if (clean.startsWith("<![CDATA[", lt)) {
          const end = clean.indexOf("]]>", lt + 9);
          pos = end === -1 ? len : end + 3;
          continue;
        }
        const gt = clean.indexOf(">", lt + 2);
        pos = gt === -1 ? len : gt + 1;
        continue;
      }
      if (c1 === 63) {
        const end = clean.indexOf("?>", lt + 2);
        pos = end === -1 ? len : end + 2;
        continue;
      }

      let gt = -1;
      let q = 0;
      for (let i = lt + 1; i < len; i++) {
        const ch = clean.charCodeAt(i);
        if (q !== 0) {
          if (ch === q) q = 0;
        } else if (ch === 34 || ch === 39) {
          q = ch;
        } else if (ch === 62) {
          gt = i;
          break;
        }
      }
      if (gt === -1) break;

      if (c1 === 47) {
        let nameEnd = lt + 2;
        while (nameEnd < gt && clean.charCodeAt(nameEnd) > 32) nameEnd++;
        if (stripPrefix(clean.slice(lt + 2, nameEnd)) === bypassTag) {
          bypassDepth--;
          if (bypassDepth === 0) {
            const mode = bypassMode;
            const tag = bypassTag;
            bypassMode = null;
            if (mode === "capture" && opts.onCapturedRaw) {
              opts.onCapturedRaw(tag, clean.slice(bypassStartPos, gt + 1));
            }
          }
        }
      } else if (clean.charCodeAt(gt - 1) !== 47) {
        let nameEnd = lt + 1;
        while (nameEnd < gt && clean.charCodeAt(nameEnd) > 32 && clean.charCodeAt(nameEnd) !== 47) nameEnd++;
        if (stripPrefix(clean.slice(lt + 1, nameEnd)) === bypassTag) {
          bypassDepth++;
        }
      }
      pos = gt + 1;
      continue;
    }

    const lt = clean.indexOf("<", pos);
    if (lt === -1) {
      if (opts.onText && pos < len) {
        const txt = clean.slice(pos);
        opts.onText(txt.includes("&") ? decodeXmlEntities(txt) : txt);
      }
      break;
    }

    if (lt > pos && opts.onText) {
      const txt = clean.slice(pos, lt);
      opts.onText(txt.includes("&") ? decodeXmlEntities(txt) : txt);
    }

    const c1 = clean.charCodeAt(lt + 1);
    if (c1 === 33) {
      if (clean.startsWith("<!--", lt)) {
        const end = clean.indexOf("-->", lt + 4);
        pos = end === -1 ? len : end + 3;
        continue;
      }
      if (clean.startsWith("<![CDATA[", lt)) {
        const end = clean.indexOf("]]>", lt + 9);
        if (end !== -1 && opts.onText) opts.onText(clean.slice(lt + 9, end));
        pos = end === -1 ? len : end + 3;
        continue;
      }
      const gt = clean.indexOf(">", lt + 2);
      pos = gt === -1 ? len : gt + 1;
      continue;
    }
    if (c1 === 63) {
      const end = clean.indexOf("?>", lt + 2);
      pos = end === -1 ? len : end + 2;
      continue;
    }

    let gt = -1;
    let q = 0;
    for (let i = lt + 1; i < len; i++) {
      const ch = clean.charCodeAt(i);
      if (q !== 0) {
        if (ch === q) q = 0;
      } else if (ch === 34 || ch === 39) {
        q = ch;
      } else if (ch === 62) {
        gt = i;
        break;
      }
    }
    if (gt === -1) break;

    if (c1 === 47) {
      let nameEnd = lt + 2;
      while (nameEnd < gt && clean.charCodeAt(nameEnd) > 32) nameEnd++;
      const tag = stripPrefix(clean.slice(lt + 2, nameEnd));
      opts.onEnd?.(tag, lt, gt + 1);
      pos = gt + 1;
      continue;
    }

    let nameEnd = lt + 1;
    while (nameEnd < gt && clean.charCodeAt(nameEnd) > 32 && clean.charCodeAt(nameEnd) !== 47) nameEnd++;
    const tag = stripPrefix(clean.slice(lt + 1, nameEnd));
    const selfClosing = clean.charCodeAt(gt - 1) === 47;
    const attrEnd = selfClosing ? gt - 1 : gt;
    const attrs = nameEnd < attrEnd ? parseAttributesFast(clean, nameEnd, attrEnd) : {};

    const action = opts.onStart(tag, attrs, selfClosing, lt, gt + 1);
    if (action === "skip") {
      if (!selfClosing) {
        bypassMode = "skip";
        bypassTag = tag;
        bypassDepth = 1;
      }
    } else if (action === "capture") {
      if (selfClosing) {
        opts.onCapturedRaw?.(tag, clean.slice(lt, gt + 1));
      } else {
        bypassMode = "capture";
        bypassTag = tag;
        bypassDepth = 1;
        bypassStartPos = lt;
      }
    } else if (selfClosing) {
      opts.onEnd?.(tag, lt, gt + 1);
    }

    pos = gt + 1;
  }
}

void (null as unknown as RawXmlToken);

// ============================================================================
// Attribute extraction helpers
// ============================================================================

function optInt(val?: string): number | undefined {
  if (val === undefined || val === "") return undefined;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? undefined : n;
}

function optFloat(val?: string): number | undefined {
  if (val === undefined || val === "") return undefined;
  const n = parseFloat(val);
  return Number.isNaN(n) ? undefined : n;
}

function optBool(val?: string): boolean | undefined {
  if (val === undefined || val === "") return undefined;
  return val === "true" || val === "1";
}

function optFlag(val?: string): FlagSetting | undefined {
  if (val === "Enabled" || val === "Disabled") return val;
  return undefined;
}

function optPriority(val?: string): GroupObjectPriority | undefined {
  if (val === "System" || val === "Normal" || val === "Urgent" || val === "Alert" || val === "Low") return val;
  return undefined;
}

function collectExtraAttrs(attrs: Record<string, string>, known: Set<string>): Record<string, string> | undefined {
  let extras: Record<string, string> | undefined;
  for (const [k, v] of Object.entries(attrs)) {
    if (!known.has(k)) {
      if (!extras) extras = {};
      extras[k] = v;
    }
  }
  return extras;
}

export function decodeKnxSerialNumberHex(base64?: string): string | undefined {
  if (!base64) return undefined;
  try {
    const buf = Buffer.from(base64, "base64");
    if (buf.length === 6) return buf.toString("hex").toUpperCase();
  } catch {
    // ignore malformed base64
  }
  return undefined;
}

export function encodeKnxSerialNumberBase64(hexOrBase64: string): string {
  const cleanHex = hexOrBase64.replace(/[:\-\s]/g, "");
  if (/^[0-9a-fA-F]{12}$/.test(cleanHex)) {
    return Buffer.from(cleanHex, "hex").toString("base64");
  }
  return hexOrBase64;
}

export function extractSchemaVersionFromXmlns(xmlns?: string): number {
  if (!xmlns) return 20;
  const m = /\/project\/(\d+)\s*$/.exec(xmlns);
  return m ? parseInt(m[1], 10) : 20;
}

export function parseManufacturerNumericId(mfrId: string): number {
  const m = /M-([0-9A-Fa-f]{4})/.exec(mfrId);
  return m ? parseInt(m[1], 16) : 0;
}

// ============================================================================
// 1. Parse `P-XXXX.certificate`
// ============================================================================

export function parseProjectCertificate(text: string): KnxProjectCertificateInfo {
  const info: KnxProjectCertificateInfo = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*([A-Z]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (!m) continue;
    const [, key, val] = m;
    switch (key) {
      case "ID":
        info.id = val;
        break;
      case "LICENSE":
        info.license = val;
        break;
      case "CUSTOMER":
        info.customer = val;
        break;
      case "NUMBER":
        info.number = val;
        break;
      case "DATE":
        info.date = val;
        break;
      case "TIME":
        info.time = val;
        break;
      case "PUBLICKEY":
        info.publicKey = val;
        break;
    }
  }
  return info;
}

// ============================================================================
// 2. Parse `knx_master.xml` (DPTs, MediumTypes, Manufacturers, SpaceUsages, FunctionTypes)
// ============================================================================

export function parseKnxMasterData(masterXml: string, language?: string): KnxMasterData {
  const data: KnxMasterData = {
    manufacturers: {},
    mediumTypes: {},
    datapointTypes: {},
    datapointSubtypes: {},
    spaceUsages: {},
    functionTypes: {},
  };

  let currentDpt: KnxMasterDatapointType | null = null;
  let currentTranslationRefId: string | null = null;
  const translations = new Map<string, Record<string, string>>();

  scanXmlSync(masterXml, {
    onStart(tag, attrs) {
      if (tag === "KNX") {
        data.schemaVersion = extractSchemaVersionFromXmlns(attrs.xmlns);
        return;
      }
      if (tag === "MasterData") {
        data.version = optInt(attrs.Version);
        return;
      }
      // Skip large sections not needed for project model (MaskVersions are parsed on demand via KnxProdParser)
      if (
        tag === "MaskVersions" ||
        tag === "InterfaceObjectTypes" ||
        tag === "InterfaceObjectProperties" ||
        tag === "PropertyDataTypes" ||
        tag === "FunctionalBlocks" ||
        tag === "ProductLanguages" ||
        tag === "DatapointRoles"
      ) {
        return "skip";
      }
      if (tag === "Language") {
        if (!language || attrs.Identifier !== language) return "skip";
        return;
      }
      if (tag === "TranslationElement" && attrs.RefId) {
        currentTranslationRefId = attrs.RefId;
        return;
      }
      if (tag === "Translation" && currentTranslationRefId && attrs.AttributeName) {
        let map = translations.get(currentTranslationRefId);
        if (!map) {
          map = {};
          translations.set(currentTranslationRefId, map);
        }
        map[attrs.AttributeName] = attrs.Text ?? "";
        return;
      }

      if (tag === "DatapointType" && attrs.Id) {
        const dpt: KnxMasterDatapointType = {
          id: attrs.Id,
          number: optInt(attrs.Number) ?? 0,
          name: attrs.Name ?? attrs.Id,
          text: attrs.Text ?? "",
          sizeInBit: optInt(attrs.SizeInBit) ?? 0,
          pdt: attrs.PDT,
          subtypes: [],
        };
        data.datapointTypes[dpt.id] = dpt;
        currentDpt = dpt;
        return;
      }
      if (tag === "DatapointSubtype" && attrs.Id && currentDpt) {
        const num = optInt(attrs.Number) ?? 0;
        const sub: KnxMasterDatapointSubtype = {
          id: attrs.Id,
          dptId: currentDpt.id,
          dptNumber: currentDpt.number,
          number: num,
          formatted: `${currentDpt.number}.${String(num).padStart(3, "0")}`,
          name: attrs.Name ?? attrs.Id,
          text: attrs.Text ?? "",
          sizeInBit: currentDpt.sizeInBit,
          isDefault: optBool(attrs.Default),
        };
        currentDpt.subtypes.push(sub);
        data.datapointSubtypes[sub.id] = sub;
        return;
      }
      if (tag === "MediumType" && attrs.Id) {
        data.mediumTypes[attrs.Id] = {
          id: attrs.Id,
          number: optInt(attrs.Number) ?? 0,
          name: attrs.Name ?? attrs.Id,
          text: attrs.Text ?? attrs.Name ?? attrs.Id,
          domainAddressLength: optInt(attrs.DomainAddressLength),
        };
        return;
      }
      if (tag === "Manufacturer" && attrs.Id) {
        data.manufacturers[attrs.Id] = {
          id: attrs.Id,
          numericId: optInt(attrs.KnxManufacturerId) ?? parseManufacturerNumericId(attrs.Id),
          name: attrs.Name ?? attrs.Id,
        };
        return;
      }
      if (tag === "SpaceUsage" && attrs.Id) {
        data.spaceUsages[attrs.Id] = {
          id: attrs.Id,
          number: optInt(attrs.Number),
          text: attrs.Text ?? attrs.Id,
          description: attrs.Description,
        };
        return;
      }
      if (tag === "FunctionType" && attrs.Id) {
        data.functionTypes[attrs.Id] = {
          id: attrs.Id,
          number: optInt(attrs.Number),
          text: attrs.Text ?? attrs.Id,
          description: attrs.Description,
        };
        return;
      }
    },
    onEnd(tag) {
      if (tag === "DatapointType") currentDpt = null;
      else if (tag === "TranslationElement") currentTranslationRefId = null;
    },
  });

  // Apply requested language translations if available
  if (translations.size > 0) {
    for (const dpt of Object.values(data.datapointTypes)) {
      const tr = translations.get(dpt.id);
      if (tr?.Text) dpt.text = tr.Text;
    }
    for (const sub of Object.values(data.datapointSubtypes)) {
      const tr = translations.get(sub.id);
      if (tr?.Text) sub.text = tr.Text;
    }
    for (const mt of Object.values(data.mediumTypes)) {
      const tr = translations.get(mt.id);
      if (tr?.Text) mt.text = tr.Text;
    }
    for (const su of Object.values(data.spaceUsages)) {
      const tr = translations.get(su.id);
      if (tr?.Text) su.text = tr.Text;
      if (tr?.Description) su.description = tr.Description;
    }
    for (const ft of Object.values(data.functionTypes)) {
      const tr = translations.get(ft.id);
      if (tr?.Text) ft.text = tr.Text;
      if (tr?.Description) ft.description = tr.Description;
    }
  }

  return data;
}

// ============================================================================
// 3. Parse `M-XXXX/Hardware.xml`, `Catalog.xml`, `Baggages.xml`
// ============================================================================

export function parseProjectHardwareXml(
  hardwareXml: string,
  fallbackMfrId: string,
  language?: string,
): KnxProjectHardwareEntry[] {
  const entries: KnxProjectHardwareEntry[] = [];
  let manufacturerId = fallbackMfrId;
  let currentHw: KnxProjectHardwareEntry | null = null;
  let currentProduct: KnxProjectHardwareProduct | null = null;
  let currentH2P: KnxProjectHardware2Program | null = null;
  let currentTranslationRefId: string | null = null;
  const translations = new Map<string, Record<string, string>>();

  scanXmlSync(hardwareXml, {
    onStart(tag, attrs) {
      if (tag === "Manufacturer" && attrs.RefId) {
        manufacturerId = attrs.RefId;
        return;
      }
      if (tag === "Language") {
        if (!language || attrs.Identifier !== language) return "skip";
        return;
      }
      if (tag === "TranslationElement" && attrs.RefId) {
        currentTranslationRefId = attrs.RefId;
        return;
      }
      if (tag === "Translation" && currentTranslationRefId && attrs.AttributeName) {
        let map = translations.get(currentTranslationRefId);
        if (!map) {
          map = {};
          translations.set(currentTranslationRefId, map);
        }
        map[attrs.AttributeName] = attrs.Text ?? "";
        return;
      }
      if (tag === "Hardware" && attrs.Id) {
        currentHw = {
          id: attrs.Id,
          manufacturerId,
          name: attrs.Name ?? attrs.Id,
          serialNumber: attrs.SerialNumber,
          versionNumber: optInt(attrs.VersionNumber),
          busCurrent: optInt(attrs.BusCurrent),
          hasIndividualAddress: optBool(attrs.HasIndividualAddress) ?? true,
          hasApplicationProgram: optBool(attrs.HasApplicationProgram) ?? true,
          isPowerSupply: optBool(attrs.IsPowerSupply),
          isChoke: optBool(attrs.IsChoke),
          isCoupler: optBool(attrs.IsCoupler),
          isPowerLineRepeater: optBool(attrs.IsPowerLineRepeater),
          isPowerLineSignalFilter: optBool(attrs.IsPowerLineSignalFilter),
          isCable: optBool(attrs.IsCable),
          isIPEnabled: optBool(attrs.IsIPEnabled),
          products: [],
          hardware2Programs: [],
        };
        entries.push(currentHw);
        return;
      }
      if (tag === "Product" && currentHw && attrs.Id) {
        currentProduct = {
          id: attrs.Id,
          text: attrs.Text ?? "",
          orderNumber: attrs.OrderNumber ?? "",
          isRailMounted: optBool(attrs.IsRailMounted),
          widthInMillimeter: optFloat(attrs.WidthInMillimeter),
          defaultLanguage: attrs.DefaultLanguage,
          hash: attrs.Hash,
        };
        currentHw.products.push(currentProduct);
        return;
      }
      if (tag === "Attribute" && currentProduct && attrs.Name) {
        if (!currentProduct.attributes) currentProduct.attributes = {};
        currentProduct.attributes[attrs.Name] = attrs.Value ?? "";
        return;
      }
      if (tag === "Hardware2Program" && currentHw && attrs.Id) {
        currentH2P = {
          id: attrs.Id,
          mediumTypes: attrs.MediumTypes ? attrs.MediumTypes.split(/\s+/).filter(Boolean) : [],
          applicationProgramRefIds: [],
          hash: attrs.Hash,
        };
        currentHw.hardware2Programs.push(currentH2P);
        return;
      }
      if (tag === "ApplicationProgramRef" && currentH2P && attrs.RefId) {
        currentH2P.applicationProgramRefIds.push(attrs.RefId);
        return;
      }
      if (tag === "RegistrationInfo" && currentH2P) {
        currentH2P.registrationStatus = attrs.RegistrationStatus;
        currentH2P.registrationNumber = attrs.RegistrationNumber;
      }
    },
    onEnd(tag) {
      if (tag === "Product") currentProduct = null;
      else if (tag === "Hardware2Program") currentH2P = null;
      else if (tag === "TranslationElement") currentTranslationRefId = null;
    },
  });

  if (translations.size > 0) {
    for (const hw of entries) {
      for (const prod of hw.products) {
        const tr = translations.get(prod.id);
        if (tr?.Text) prod.text = tr.Text;
      }
    }
  }

  return entries;
}

export function parseProjectCatalogXml(catalogXml: string, language?: string): KnxCatalogSection[] {
  const roots: KnxCatalogSection[] = [];
  const stack: KnxCatalogSection[] = [];
  const allSections: KnxCatalogSection[] = [];
  const allItems: KnxCatalogItem[] = [];
  let currentTranslationRefId: string | null = null;
  const translations = new Map<string, Record<string, string>>();

  scanXmlSync(catalogXml, {
    onStart(tag, attrs) {
      if (tag === "Language") {
        if (!language || attrs.Identifier !== language) return "skip";
        return;
      }
      if (tag === "TranslationElement" && attrs.RefId) {
        currentTranslationRefId = attrs.RefId;
        return;
      }
      if (tag === "Translation" && currentTranslationRefId && attrs.AttributeName) {
        let map = translations.get(currentTranslationRefId);
        if (!map) {
          map = {};
          translations.set(currentTranslationRefId, map);
        }
        map[attrs.AttributeName] = attrs.Text ?? "";
        return;
      }
      if (tag === "CatalogSection" && attrs.Id) {
        const sec: KnxCatalogSection = {
          id: attrs.Id,
          name: attrs.Name ?? attrs.Id,
          number: attrs.Number,
          visibleDescription: attrs.VisibleDescription || undefined,
          defaultLanguage: attrs.DefaultLanguage,
          sections: [],
          items: [],
        };
        allSections.push(sec);
        if (stack.length > 0) {
          stack[stack.length - 1].sections.push(sec);
        } else {
          roots.push(sec);
        }
        stack.push(sec);
        return;
      }
      if (tag === "CatalogItem" && attrs.Id) {
        const item: KnxCatalogItem = {
          id: attrs.Id,
          name: attrs.Name ?? attrs.Id,
          number: attrs.Number,
          visibleDescription: attrs.VisibleDescription || undefined,
          productRefId: attrs.ProductRefId ?? "",
          hardware2ProgramRefId: attrs.Hardware2ProgramRefId,
          defaultLanguage: attrs.DefaultLanguage,
        };
        allItems.push(item);
        if (stack.length > 0) {
          stack[stack.length - 1].items.push(item);
        }
      }
    },
    onEnd(tag) {
      if (tag === "CatalogSection" && stack.length > 0) stack.pop();
      else if (tag === "TranslationElement") currentTranslationRefId = null;
    },
  });

  if (translations.size > 0) {
    for (const sec of allSections) {
      const tr = translations.get(sec.id);
      if (tr?.Name) sec.name = tr.Name;
      if (tr?.VisibleDescription) sec.visibleDescription = tr.VisibleDescription;
    }
    for (const item of allItems) {
      const tr = translations.get(item.id);
      if (tr?.Name) item.name = tr.Name;
      if (tr?.VisibleDescription) item.visibleDescription = tr.VisibleDescription;
    }
  }

  return roots;
}

export function parseProjectBaggagesXml(baggagesXml: string, fallbackMfrId: string): KnxBaggageFile[] {
  const result: KnxBaggageFile[] = [];
  let manufacturerId = fallbackMfrId;
  let current: KnxBaggageFile | null = null;

  scanXmlSync(baggagesXml, {
    onStart(tag, attrs) {
      if (tag === "Manufacturer" && attrs.RefId) {
        manufacturerId = attrs.RefId;
        return;
      }
      if (tag === "Baggage" && attrs.Name) {
        const targetPath = (attrs.TargetPath ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const zipEntryPath = targetPath
          ? `${manufacturerId}/Baggages/${targetPath}/${attrs.Name}`
          : `${manufacturerId}/Baggages/${attrs.Name}`;
        current = {
          id: attrs.Id ?? `${manufacturerId}_BG-${attrs.Name}`,
          manufacturerId,
          targetPath,
          name: attrs.Name,
          zipEntryPath,
        };
        result.push(current);
        return;
      }
      if (tag === "FileInfo" && current && attrs.TimeInfo) {
        current.timeInfo = attrs.TimeInfo;
      }
    },
    onEnd(tag) {
      if (tag === "Baggage") current = null;
    },
  });

  return result;
}

// ============================================================================
// 4. Parse `P-XXXX/project.xml`
// ============================================================================

export interface ParsedProjectXmlResult {
  xmlns: string;
  schemaVersion: number;
  createdBy: string;
  toolVersion: string;
  projectInfo: KnxProjectInfo;
  historyEntries: KnxProjectHistoryEntry[];
  userFiles: KnxProjectUserFile[];
  rawExtraChildren: string[];
}

const KNOWN_PROJECT_INFO_ATTRS = new Set([
  "Name",
  "GroupAddressStyle",
  "Comment",
  "CompletionStatus",
  "ProjectNumber",
  "ContractNumber",
  "OrderNumber",
  "ProjectStart",
  "ProjectEnd",
  "LastModified",
  "Guid",
  "LastUsedPuid",
  "CodePage",
  "BusAccessLegacyMode",
  "ProjectTracingLevel",
  "Hide16BitGroupsFromLegacyPlugins",
  "DeviceCount",
]);

const KNOWN_HISTORY_ATTRS = new Set(["Date", "User", "Text", "Detail"]);
const KNOWN_USERFILE_ATTRS = new Set(["Filename", "Comment"]);

export function parseProjectXml(projectXml: string, fallbackProjectId: string): ParsedProjectXmlResult {
  let xmlns = "http://knx.org/xml/project/20";
  let schemaVersion = 20;
  let createdBy = "ETS5";
  let toolVersion = "5.7.1428.39779";
  let projectId = fallbackProjectId;
  let projectInfo: KnxProjectInfo = {
    id: fallbackProjectId,
    name: "Untitled KNX Project",
    groupAddressStyle: "ThreeLevel",
    lastUsedPuid: 1,
  };
  const historyEntries: KnxProjectHistoryEntry[] = [];
  const userFiles: KnxProjectUserFile[] = [];
  const rawExtraChildren: string[] = [];

  let insideProjectInfo = false;

  scanXmlSync(projectXml, {
    onStart(tag, attrs) {
      if (tag === "KNX") {
        if (attrs.xmlns) {
          xmlns = attrs.xmlns;
          schemaVersion = extractSchemaVersionFromXmlns(attrs.xmlns);
        }
        if (attrs.CreatedBy) createdBy = attrs.CreatedBy;
        if (attrs.ToolVersion) toolVersion = attrs.ToolVersion;
        return;
      }
      if (tag === "Project") {
        if (attrs.Id) projectId = attrs.Id;
        return;
      }
      if (tag === "ProjectInformation") {
        insideProjectInfo = true;
        const style = attrs.GroupAddressStyle;
        const groupAddressStyle: GroupAddressStyle =
          style === "TwoLevel" || style === "Free" || style === "ThreeLevel" ? style : "ThreeLevel";
        projectInfo = {
          id: projectId,
          name: attrs.Name ?? "",
          groupAddressStyle,
          comment: attrs.Comment,
          completionStatus: attrs.CompletionStatus,
          projectNumber: attrs.ProjectNumber,
          contractNumber: attrs.ContractNumber,
          orderNumber: attrs.OrderNumber,
          projectStart: attrs.ProjectStart,
          projectEnd: attrs.ProjectEnd,
          lastModified: attrs.LastModified,
          guid: attrs.Guid,
          lastUsedPuid: optInt(attrs.LastUsedPuid) ?? 1,
          codePage: attrs.CodePage,
          busAccessLegacyMode: optBool(attrs.BusAccessLegacyMode),
          projectTracingLevel: attrs.ProjectTracingLevel,
          hide16BitGroupsFromLegacyPlugins: optBool(attrs.Hide16BitGroupsFromLegacyPlugins),
          deviceCount: optInt(attrs.DeviceCount),
          extraAttrs: collectExtraAttrs(attrs, KNOWN_PROJECT_INFO_ATTRS),
        };
        return;
      }
      if (tag === "HistoryEntries" || tag === "UserFiles") {
        return;
      }
      if (tag === "HistoryEntry") {
        historyEntries.push({
          date: attrs.Date,
          user: attrs.User,
          text: attrs.Text,
          detail: attrs.Detail,
          extraAttrs: collectExtraAttrs(attrs, KNOWN_HISTORY_ATTRS),
        });
        return;
      }
      if (tag === "UserFile") {
        userFiles.push({
          filename: attrs.Filename ?? "",
          comment: attrs.Comment,
          extraAttrs: collectExtraAttrs(attrs, KNOWN_USERFILE_ATTRS),
        });
        return;
      }
      // Capture any other children of <Project> or <ProjectInformation> (e.g. <AddinData>, <ProjectTraces>, <ToDoItems>)
      if (!insideProjectInfo) {
        return "capture";
      }
      return "capture";
    },
    onEnd(tag) {
      if (tag === "ProjectInformation") insideProjectInfo = false;
    },
    onCapturedRaw(_tag, rawXml) {
      rawExtraChildren.push(rawXml);
    },
  });

  return {
    xmlns,
    schemaVersion,
    createdBy,
    toolVersion,
    projectInfo,
    historyEntries,
    userFiles,
    rawExtraChildren,
  };
}

// ============================================================================
// 5. Parse `P-XXXX/0.xml` (Installations, Topology, Devices, Locations, GroupAddresses, Trades)
// ============================================================================

const KNOWN_INSTALLATION_ATTRS = new Set([
  "Name",
  "BCUKey",
  "DefaultLine",
  "IPRoutingLatencyTolerance",
  "IPRoutingMulticastAddress",
  "IPRoutingBackboneKey",
  "IPRoutingBackboneGroup",
  "SplitType",
]);

const KNOWN_AREA_ATTRS = new Set(["Id", "Address", "Name", "Description", "Comment", "CompletionStatus", "Puid"]);
const KNOWN_LINE_ATTRS = new Set([
  "Id",
  "Address",
  "Name",
  "Description",
  "Comment",
  "MediumTypeRefId",
  "DomainAddress",
  "CompletionStatus",
  "Puid",
]);
const KNOWN_SEGMENT_ATTRS = new Set(["Id", "Number", "Name", "Description", "Comment", "MediumTypeRefId", "Puid"]);
const KNOWN_DEVICE_ATTRS = new Set([
  "Id",
  "Address",
  "Name",
  "Description",
  "Comment",
  "ProductRefId",
  "Hardware2ProgramRefId",
  "SerialNumber",
  "UniqueNumber",
  "CompletionStatus",
  "Puid",
  "ApplicationProgramLoaded",
  "CommunicationPartLoaded",
  "IndividualAddressLoaded",
  "MediumConfigLoaded",
  "ParametersLoaded",
  "IsActivityCalculated",
  "Broken",
  "LastModified",
  "LastDownload",
  "LastUsedAPDULength",
  "ReadMaxAPDULength",
  "ReadMaxRoutingAPDULength",
  "CheckSums",
  "LoadedImage",
]);
const KNOWN_PARAM_REF_ATTRS = new Set(["RefId", "Value"]);
const KNOWN_CO_REF_ATTRS = new Set([
  "RefId",
  "Text",
  "Description",
  "FunctionText",
  "DatapointType",
  "ChannelId",
  "Links",
  "CommunicationFlag",
  "ReadFlag",
  "WriteFlag",
  "TransmitFlag",
  "UpdateFlag",
  "ReadOnInitFlag",
  "Priority",
  "IsActive",
  "Acknowledged",
]);
const KNOWN_MODULE_INST_ATTRS = new Set(["Id", "RefId", "RepeatIndex"]);
const KNOWN_MODULE_ARG_ATTRS = new Set(["RefId", "Value"]);
const KNOWN_GOTREE_ATTRS = new Set(["GroupObjectInstances"]);
const KNOWN_GOTREE_NODE_ATTRS = new Set(["Type", "RefId", "Text", "GroupObjectInstances"]);
const KNOWN_ADD_ADDR_ATTRS = new Set(["Address", "Name", "Description", "Comment"]);
const KNOWN_IPCONFIG_ATTRS = new Set(["Assign", "IPAddress", "SubnetMask", "DefaultGateway", "MACAddress"]);
const KNOWN_SECURITY_ATTRS = new Set([
  "LoadedIPRoutingBackboneKey",
  "DeviceAuthenticationCode",
  "DeviceAuthenticationCodeHash",
  "LoadedDeviceAuthenticationCodeHash",
  "DeviceManagementPassword",
  "DeviceManagementPasswordHash",
  "LoadedDeviceManagementPasswordHash",
  "ToolKey",
  "LoadedToolKey",
  "SequenceNumber",
  "SequenceNumberTimestamp",
]);
const KNOWN_BINARY_DATA_ATTRS = new Set(["Name", "InternalDescription"]);
const KNOWN_BUS_INTERFACE_ATTRS = new Set(["RefId", "Name", "Description", "Comment", "Password", "PasswordHash"]);
const KNOWN_CONNECTOR_ATTRS = new Set(["GroupAddressRefId"]);
const KNOWN_SPACE_ATTRS = new Set([
  "Id",
  "Type",
  "Name",
  "Number",
  "Description",
  "Comment",
  "Usage",
  "DefaultLine",
  "CompletionStatus",
  "Puid",
]);
const KNOWN_FUNCTION_ATTRS = new Set([
  "Id",
  "Name",
  "Type",
  "Number",
  "Description",
  "Comment",
  "DefaultGroupRange",
  "CompletionStatus",
  "Puid",
]);
const KNOWN_GA_REF_ATTRS = new Set(["Id", "RefId", "Name", "Role", "Puid"]);
const KNOWN_GR_ATTRS = new Set([
  "Id",
  "Name",
  "RangeStart",
  "RangeEnd",
  "Description",
  "Comment",
  "Unfiltered",
  "Security",
  "Puid",
]);
const KNOWN_GA_ATTRS = new Set([
  "Id",
  "Address",
  "Name",
  "Description",
  "Comment",
  "DatapointType",
  "Central",
  "Unfiltered",
  "Security",
  "Key",
  "Puid",
]);
const KNOWN_TRADE_ATTRS = new Set(["Id", "Name", "Number", "Description", "Comment", "CompletionStatus", "Puid"]);

export interface ParsedInstallationXmlResult {
  xmlns?: string;
  schemaVersion?: number;
  createdBy?: string;
  toolVersion?: string;
  installations: KnxInstallation[];
}

export function parseInstallationXml(xml: string, installationId: string = "0"): ParsedInstallationXmlResult {
  let xmlns: string | undefined;
  let schemaVersion: number | undefined;
  let createdBy: string | undefined;
  let toolVersion: string | undefined;
  const installations: KnxInstallation[] = [];

  let inst: KnxInstallation | null = null;
  type SectionMode = "none" | "Topology" | "Locations" | "GroupAddresses" | "Trades";
  let section: SectionMode = "none";

  // Topology state
  let currentArea: KnxArea | null = null;
  let currentLine: KnxLine | null = null;
  let currentSegment: KnxSegment | null = null;
  let inUnassigned = false;
  let inAdditionalGroupAddresses = false;

  // Device state
  let currentDevice: KnxDeviceInstance | null = null;
  let currentModule: KnxModuleInstance | null = null;
  let currentBusInterface: KnxBusInterface | null = null;
  let inGoTree = false;
  const goNodeStack: KnxGroupObjectTreeNode[] = [];
  let inBinaryDataContainer = false;
  let currentBinaryData: KnxBinaryDataEntry | null = null;
  let inBinaryDataText = false;
  let binaryDataChunks: string[] = [];

  // Locations state
  const spaceStack: KnxSpace[] = [];
  let currentFunction: KnxFunction | null = null;

  // GroupAddresses state
  const groupRangeStack: KnxGroupRange[] = [];

  // Trades state
  const tradeStack: KnxTrade[] = [];

  // Capture destination tracking
  type CaptureTarget =
    | { kind: "installation"; target: KnxInstallation }
    | { kind: "topology"; target: KnxInstallation }
    | { kind: "area"; target: KnxArea }
    | { kind: "line"; target: KnxLine }
    | { kind: "segment"; target: KnxSegment }
    | { kind: "device"; target: KnxDeviceInstance }
    | { kind: "space"; target: KnxSpace }
    | { kind: "function"; target: KnxFunction }
    | { kind: "trade"; target: KnxTrade };
  let activeCaptureTarget: CaptureTarget | null = null;

  scanXmlSync(xml, {
    onStart(tag, attrs) {
      if (tag === "KNX") {
        if (attrs.xmlns) {
          xmlns = attrs.xmlns;
          schemaVersion = extractSchemaVersionFromXmlns(attrs.xmlns);
        }
        if (attrs.CreatedBy) createdBy = attrs.CreatedBy;
        if (attrs.ToolVersion) toolVersion = attrs.ToolVersion;
        return;
      }
      if (tag === "Project" || tag === "Installations") return;

      if (tag === "Installation") {
        inst = {
          installationId,
          name: attrs.Name ?? "",
          bcuKey: attrs.BCUKey,
          defaultLine: attrs.DefaultLine,
          ipRoutingLatencyTolerance: optInt(attrs.IPRoutingLatencyTolerance),
          ipRoutingMulticastAddress: attrs.IPRoutingMulticastAddress,
          ipRoutingBackboneKey: attrs.IPRoutingBackboneKey,
          ipRoutingBackboneGroup: attrs.IPRoutingBackboneGroup,
          splitType: attrs.SplitType,
          topology: { areas: [], unassignedDevices: [] },
          locations: [],
          groupRanges: [],
          trades: [],
          extraAttrs: collectExtraAttrs(attrs, KNOWN_INSTALLATION_ATTRS),
        };
        installations.push(inst);
        return;
      }
      if (!inst) return;

      // Top-level sections inside <Installation>
      if (section === "none") {
        if (tag === "Topology" || tag === "Locations" || tag === "GroupAddresses" || tag === "Trades") {
          section = tag;
          return;
        }
        activeCaptureTarget = { kind: "installation", target: inst };
        return "capture";
      }

      // ---- TOPOLOGY ----
      if (section === "Topology") {
        if (currentDevice) {
          if (
            tag === "ParameterInstanceRefs" ||
            tag === "ComObjectInstanceRefs" ||
            tag === "ModuleInstances" ||
            tag === "Arguments" ||
            tag === "AdditionalAddresses" ||
            tag === "BusInterfaces" ||
            tag === "Connectors" ||
            tag === "Nodes"
          ) {
            return;
          }
          if (tag === "BusInterface" && attrs.RefId) {
            currentBusInterface = {
              refId: attrs.RefId,
              name: attrs.Name,
              description: attrs.Description,
              comment: attrs.Comment,
              password: attrs.Password,
              passwordHash: attrs.PasswordHash,
              connectors: [],
              extraAttrs: collectExtraAttrs(attrs, KNOWN_BUS_INTERFACE_ATTRS),
            };
            currentDevice.busInterfaces.push(currentBusInterface);
            return;
          }
          if (tag === "Connector" && currentBusInterface && attrs.GroupAddressRefId) {
            currentBusInterface.connectors.push({
              groupAddressRefId: attrs.GroupAddressRefId,
              extraAttrs: collectExtraAttrs(attrs, KNOWN_CONNECTOR_ATTRS),
            });
            return;
          }
          if (tag === "ParameterInstanceRef" && attrs.RefId) {
            currentDevice.parameterInstanceRefs.push({
              refId: attrs.RefId,
              value: attrs.Value ?? "",
              extraAttrs: collectExtraAttrs(attrs, KNOWN_PARAM_REF_ATTRS),
            });
            return;
          }
          if (tag === "ComObjectInstanceRef" && attrs.RefId) {
            currentDevice.comObjectInstanceRefs.push({
              refId: attrs.RefId,
              text: attrs.Text,
              description: attrs.Description,
              functionText: attrs.FunctionText,
              datapointType: attrs.DatapointType,
              channelId: attrs.ChannelId,
              links: attrs.Links ? attrs.Links.split(/\s+/).filter(Boolean) : [],
              communicationFlag: optFlag(attrs.CommunicationFlag),
              readFlag: optFlag(attrs.ReadFlag),
              writeFlag: optFlag(attrs.WriteFlag),
              transmitFlag: optFlag(attrs.TransmitFlag),
              updateFlag: optFlag(attrs.UpdateFlag),
              readOnInitFlag: optFlag(attrs.ReadOnInitFlag),
              priority: optPriority(attrs.Priority),
              isActive: optBool(attrs.IsActive),
              acknowledged: optBool(attrs.Acknowledged),
              extraAttrs: collectExtraAttrs(attrs, KNOWN_CO_REF_ATTRS),
            });
            return;
          }
          if (tag === "ModuleInstance" && attrs.Id) {
            currentModule = {
              id: attrs.Id,
              refId: attrs.RefId ?? "",
              repeatIndex: attrs.RepeatIndex,
              arguments: [],
              extraAttrs: collectExtraAttrs(attrs, KNOWN_MODULE_INST_ATTRS),
            };
            currentDevice.moduleInstances.push(currentModule);
            return;
          }
          if (tag === "Argument" && currentModule && attrs.RefId) {
            currentModule.arguments.push({
              refId: attrs.RefId,
              value: attrs.Value ?? "",
              extraAttrs: collectExtraAttrs(attrs, KNOWN_MODULE_ARG_ATTRS),
            });
            return;
          }
          if (tag === "GroupObjectTree") {
            inGoTree = true;
            goNodeStack.length = 0;
            currentDevice.groupObjectTree = {
              groupObjectInstances: attrs.GroupObjectInstances
                ? attrs.GroupObjectInstances.split(/\s+/).filter(Boolean)
                : undefined,
              nodes: [],
              extraAttrs: collectExtraAttrs(attrs, KNOWN_GOTREE_ATTRS),
            };
            return;
          }
          if (tag === "Node" && inGoTree && currentDevice.groupObjectTree) {
            const node: KnxGroupObjectTreeNode = {
              type: attrs.Type,
              refId: attrs.RefId,
              text: attrs.Text,
              groupObjectInstances: attrs.GroupObjectInstances
                ? attrs.GroupObjectInstances.split(/\s+/).filter(Boolean)
                : undefined,
              nodes: [],
              extraAttrs: collectExtraAttrs(attrs, KNOWN_GOTREE_NODE_ATTRS),
            };
            if (goNodeStack.length > 0) {
              goNodeStack[goNodeStack.length - 1].nodes.push(node);
            } else {
              currentDevice.groupObjectTree.nodes.push(node);
            }
            goNodeStack.push(node);
            return;
          }
          if (tag === "Address" && attrs.Address !== undefined) {
            const addr = optInt(attrs.Address);
            if (addr !== undefined) {
              currentDevice.additionalAddresses.push({
                address: addr,
                name: attrs.Name,
                description: attrs.Description,
                comment: attrs.Comment,
                extraAttrs: collectExtraAttrs(attrs, KNOWN_ADD_ADDR_ATTRS),
              });
            }
            return;
          }
          if (tag === "IPConfig") {
            currentDevice.ipConfig = {
              assign: attrs.Assign,
              ipAddress: attrs.IPAddress,
              subnetMask: attrs.SubnetMask,
              defaultGateway: attrs.DefaultGateway,
              macAddress: attrs.MACAddress,
              extraAttrs: collectExtraAttrs(attrs, KNOWN_IPCONFIG_ATTRS),
            };
            return;
          }
          if (tag === "Security") {
            currentDevice.security = {
              loadedIpRoutingBackboneKey: attrs.LoadedIPRoutingBackboneKey,
              deviceAuthenticationCode: attrs.DeviceAuthenticationCode,
              deviceAuthenticationCodeHash: attrs.DeviceAuthenticationCodeHash,
              loadedDeviceAuthenticationCodeHash: attrs.LoadedDeviceAuthenticationCodeHash,
              deviceManagementPassword: attrs.DeviceManagementPassword,
              deviceManagementPasswordHash: attrs.DeviceManagementPasswordHash,
              loadedDeviceManagementPasswordHash: attrs.LoadedDeviceManagementPasswordHash,
              toolKey: attrs.ToolKey,
              loadedToolKey: attrs.LoadedToolKey,
              sequenceNumber: attrs.SequenceNumber,
              sequenceNumberTimestamp: attrs.SequenceNumberTimestamp,
              extraAttrs: collectExtraAttrs(attrs, KNOWN_SECURITY_ATTRS),
            };
            return;
          }
          if (tag === "BinaryData") {
            if (!inBinaryDataContainer) {
              inBinaryDataContainer = true;
            } else {
              currentBinaryData = {
                name: attrs.Name,
                internalDescription: attrs.InternalDescription,
                dataBase64: "",
                extraAttrs: collectExtraAttrs(attrs, KNOWN_BINARY_DATA_ATTRS),
              };
              currentDevice.binaryData.push(currentBinaryData);
            }
            return;
          }
          if (tag === "Data" && currentBinaryData) {
            inBinaryDataText = true;
            binaryDataChunks = [];
            return;
          }

          // Unknown child of DeviceInstance (e.g. <BusInterfaces>, <Channels>, <IpRoutes>) -> preserve verbatim
          activeCaptureTarget = { kind: "device", target: currentDevice };
          return "capture";
        }

        if (inAdditionalGroupAddresses) {
          if (tag === "GroupAddress" && currentLine && attrs.Address !== undefined) {
            const addr = optInt(attrs.Address);
            if (addr !== undefined) currentLine.additionalGroupAddresses.push(addr);
          }
          return;
        }

        if (tag === "Area") {
          currentArea = {
            id: attrs.Id ?? "",
            address: optInt(attrs.Address) ?? 0,
            name: attrs.Name ?? "",
            description: attrs.Description,
            comment: attrs.Comment,
            completionStatus: attrs.CompletionStatus,
            puid: optInt(attrs.Puid),
            lines: [],
            extraAttrs: collectExtraAttrs(attrs, KNOWN_AREA_ATTRS),
          };
          inst.topology.areas.push(currentArea);
          return;
        }
        if (tag === "Line" && currentArea) {
          currentLine = {
            id: attrs.Id ?? "",
            address: optInt(attrs.Address) ?? 0,
            name: attrs.Name ?? "",
            description: attrs.Description,
            comment: attrs.Comment,
            mediumTypeRefId: attrs.MediumTypeRefId ?? "MT-0",
            domainAddress: attrs.DomainAddress,
            completionStatus: attrs.CompletionStatus,
            puid: optInt(attrs.Puid),
            devices: [],
            segments: [],
            additionalGroupAddresses: [],
            extraAttrs: collectExtraAttrs(attrs, KNOWN_LINE_ATTRS),
          };
          currentArea.lines.push(currentLine);
          return;
        }
        if (tag === "Segment" && currentLine) {
          currentSegment = {
            id: attrs.Id ?? "",
            number: optInt(attrs.Number) ?? 0,
            name: attrs.Name,
            description: attrs.Description,
            comment: attrs.Comment,
            mediumTypeRefId: attrs.MediumTypeRefId,
            puid: optInt(attrs.Puid),
            devices: [],
            extraAttrs: collectExtraAttrs(attrs, KNOWN_SEGMENT_ATTRS),
          };
          currentLine.segments.push(currentSegment);
          return;
        }
        if (tag === "UnassignedDevices") {
          inUnassigned = true;
          return;
        }
        if (tag === "AdditionalGroupAddresses" && currentLine) {
          inAdditionalGroupAddresses = true;
          return;
        }
        if (tag === "DeviceInstance") {
          const serialNumber = attrs.SerialNumber;
          const dev: KnxDeviceInstance = {
            id: attrs.Id ?? "",
            address: optInt(attrs.Address),
            name: attrs.Name,
            description: attrs.Description,
            comment: attrs.Comment,
            productRefId: attrs.ProductRefId,
            hardware2ProgramRefId: attrs.Hardware2ProgramRefId,
            serialNumber,
            serialNumberHex: decodeKnxSerialNumberHex(serialNumber),
            uniqueNumber: attrs.UniqueNumber,
            completionStatus: attrs.CompletionStatus,
            puid: optInt(attrs.Puid),
            applicationProgramLoaded: optBool(attrs.ApplicationProgramLoaded),
            communicationPartLoaded: optBool(attrs.CommunicationPartLoaded),
            individualAddressLoaded: optBool(attrs.IndividualAddressLoaded),
            mediumConfigLoaded: optBool(attrs.MediumConfigLoaded),
            parametersLoaded: optBool(attrs.ParametersLoaded),
            isActivityCalculated: optBool(attrs.IsActivityCalculated),
            broken: optBool(attrs.Broken),
            lastModified: attrs.LastModified,
            lastDownload: attrs.LastDownload,
            lastUsedApduLength: optInt(attrs.LastUsedAPDULength),
            readMaxApduLength: optInt(attrs.ReadMaxAPDULength),
            readMaxRoutingApduLength: optInt(attrs.ReadMaxRoutingAPDULength),
            checkSums: attrs.CheckSums,
            loadedImage: attrs.LoadedImage,
            parameterInstanceRefs: [],
            comObjectInstanceRefs: [],
            moduleInstances: [],
            additionalAddresses: [],
            busInterfaces: [],
            binaryData: [],
            extraAttrs: collectExtraAttrs(attrs, KNOWN_DEVICE_ATTRS),
          };
          if (inUnassigned) {
            inst.topology.unassignedDevices.push(dev);
          } else if (currentSegment) {
            currentSegment.devices.push(dev);
          } else if (currentLine) {
            currentLine.devices.push(dev);
          } else {
            inst.topology.unassignedDevices.push(dev);
          }
          currentDevice = dev;
          return;
        }

        // Preserve any extra topology elements (e.g. <BusAccess>, <Coupler>, etc.)
        if (currentSegment) activeCaptureTarget = { kind: "segment", target: currentSegment };
        else if (currentLine) activeCaptureTarget = { kind: "line", target: currentLine };
        else if (currentArea) activeCaptureTarget = { kind: "area", target: currentArea };
        else activeCaptureTarget = { kind: "topology", target: inst };
        return "capture";
      }

      // ---- LOCATIONS ----
      if (section === "Locations") {
        if (tag === "Space") {
          const sp: KnxSpace = {
            id: attrs.Id ?? "",
            type: attrs.Type ?? "Room",
            name: attrs.Name ?? "",
            number: attrs.Number,
            description: attrs.Description,
            comment: attrs.Comment,
            usage: attrs.Usage,
            defaultLine: attrs.DefaultLine,
            completionStatus: attrs.CompletionStatus,
            puid: optInt(attrs.Puid),
            deviceInstanceRefs: [],
            functions: [],
            spaces: [],
            extraAttrs: collectExtraAttrs(attrs, KNOWN_SPACE_ATTRS),
          };
          if (spaceStack.length > 0) {
            spaceStack[spaceStack.length - 1].spaces.push(sp);
          } else {
            inst.locations.push(sp);
          }
          spaceStack.push(sp);
          return;
        }
        if (tag === "DeviceInstanceRef" && attrs.RefId && spaceStack.length > 0) {
          spaceStack[spaceStack.length - 1].deviceInstanceRefs.push(attrs.RefId);
          return;
        }
        if (tag === "Function" && spaceStack.length > 0) {
          const fn: KnxFunction = {
            id: attrs.Id ?? "",
            name: attrs.Name ?? "",
            type: attrs.Type ?? "FT-0",
            number: attrs.Number,
            description: attrs.Description,
            comment: attrs.Comment,
            defaultGroupRange: attrs.DefaultGroupRange,
            completionStatus: attrs.CompletionStatus,
            puid: optInt(attrs.Puid),
            groupAddressRefs: [],
            extraAttrs: collectExtraAttrs(attrs, KNOWN_FUNCTION_ATTRS),
          };
          spaceStack[spaceStack.length - 1].functions.push(fn);
          currentFunction = fn;
          return;
        }
        if (tag === "GroupAddressRef" && currentFunction && attrs.RefId) {
          const ref: KnxGroupAddressRef = {
            id: attrs.Id,
            refId: attrs.RefId,
            name: attrs.Name,
            role: attrs.Role,
            puid: optInt(attrs.Puid),
            extraAttrs: collectExtraAttrs(attrs, KNOWN_GA_REF_ATTRS),
          };
          currentFunction.groupAddressRefs.push(ref);
          return;
        }
        if (currentFunction) {
          activeCaptureTarget = { kind: "function", target: currentFunction };
          return "capture";
        }
        if (spaceStack.length > 0) {
          activeCaptureTarget = { kind: "space", target: spaceStack[spaceStack.length - 1] };
          return "capture";
        }
        return;
      }

      // ---- GROUP ADDRESSES ----
      if (section === "GroupAddresses") {
        if (tag === "GroupRanges") return;
        if (tag === "GroupRange") {
          const gr: KnxGroupRange = {
            id: attrs.Id ?? "",
            name: attrs.Name ?? "",
            rangeStart: optInt(attrs.RangeStart) ?? 0,
            rangeEnd: optInt(attrs.RangeEnd) ?? 65535,
            description: attrs.Description,
            comment: attrs.Comment,
            unfiltered: optBool(attrs.Unfiltered),
            security: attrs.Security,
            puid: optInt(attrs.Puid),
            groupRanges: [],
            groupAddresses: [],
            extraAttrs: collectExtraAttrs(attrs, KNOWN_GR_ATTRS),
          };
          if (groupRangeStack.length > 0) {
            groupRangeStack[groupRangeStack.length - 1].groupRanges.push(gr);
          } else {
            inst.groupRanges.push(gr);
          }
          groupRangeStack.push(gr);
          return;
        }
        if (tag === "GroupAddress" && attrs.Address !== undefined) {
          const ga: KnxGroupAddress = {
            id: attrs.Id ?? "",
            address: optInt(attrs.Address) ?? 0,
            name: attrs.Name ?? "",
            description: attrs.Description,
            comment: attrs.Comment,
            datapointType: attrs.DatapointType,
            central: optBool(attrs.Central),
            unfiltered: optBool(attrs.Unfiltered),
            security: attrs.Security,
            key: attrs.Key,
            puid: optInt(attrs.Puid),
            extraAttrs: collectExtraAttrs(attrs, KNOWN_GA_ATTRS),
          };
          if (groupRangeStack.length > 0) {
            groupRangeStack[groupRangeStack.length - 1].groupAddresses.push(ga);
          } else {
            // Free-level project with GAs directly under GroupRanges (wrap in synthetic root range only if needed)
            if (inst.groupRanges.length === 0) {
              inst.groupRanges.push({
                id: "GR-ROOT",
                name: "Group Addresses",
                rangeStart: 1,
                rangeEnd: 65535,
                groupRanges: [],
                groupAddresses: [],
              });
            }
            inst.groupRanges[0].groupAddresses.push(ga);
          }
          return;
        }
        return;
      }

      // ---- TRADES ----
      if (section === "Trades") {
        if (tag === "Trade") {
          const tr: KnxTrade = {
            id: attrs.Id ?? "",
            name: attrs.Name ?? "",
            number: attrs.Number,
            description: attrs.Description,
            comment: attrs.Comment,
            completionStatus: attrs.CompletionStatus,
            puid: optInt(attrs.Puid),
            deviceInstanceRefs: [],
            trades: [],
            extraAttrs: collectExtraAttrs(attrs, KNOWN_TRADE_ATTRS),
          };
          if (tradeStack.length > 0) {
            tradeStack[tradeStack.length - 1].trades.push(tr);
          } else {
            inst.trades.push(tr);
          }
          tradeStack.push(tr);
          return;
        }
        if (tag === "DeviceInstanceRef" && attrs.RefId && tradeStack.length > 0) {
          tradeStack[tradeStack.length - 1].deviceInstanceRefs.push(attrs.RefId);
          return;
        }
        if (tradeStack.length > 0) {
          activeCaptureTarget = { kind: "trade", target: tradeStack[tradeStack.length - 1] };
          return "capture";
        }
      }
    },
    onText(text) {
      if (inBinaryDataText) {
        binaryDataChunks.push(text);
      }
    },
    onEnd(tag) {
      if (tag === "Installation") {
        inst = null;
        section = "none";
        return;
      }
      if (section === "Topology") {
        if (tag === "Topology") {
          section = "none";
          return;
        }
        if (tag === "DeviceInstance") {
          currentDevice = null;
          currentModule = null;
          currentBusInterface = null;
          inGoTree = false;
          goNodeStack.length = 0;
          inBinaryDataContainer = false;
          currentBinaryData = null;
          inBinaryDataText = false;
          return;
        }
        if (currentDevice) {
          if (tag === "ModuleInstance") currentModule = null;
          else if (tag === "BusInterface") currentBusInterface = null;
          else if (tag === "GroupObjectTree") {
            inGoTree = false;
            goNodeStack.length = 0;
          } else if (tag === "Node" && inGoTree && goNodeStack.length > 0) {
            goNodeStack.pop();
          } else if (tag === "Data" && inBinaryDataText) {
            if (currentBinaryData) {
              currentBinaryData.dataBase64 = binaryDataChunks.join("").trim();
            }
            inBinaryDataText = false;
            binaryDataChunks = [];
          } else if (tag === "BinaryData") {
            if (currentBinaryData) currentBinaryData = null;
            else inBinaryDataContainer = false;
          }
          return;
        }
        if (tag === "AdditionalGroupAddresses") inAdditionalGroupAddresses = false;
        else if (tag === "UnassignedDevices") inUnassigned = false;
        else if (tag === "Segment") currentSegment = null;
        else if (tag === "Line") currentLine = null;
        else if (tag === "Area") currentArea = null;
        return;
      }

      if (section === "Locations") {
        if (tag === "Locations") {
          section = "none";
          spaceStack.length = 0;
          currentFunction = null;
        } else if (tag === "Function") {
          currentFunction = null;
        } else if (tag === "Space" && spaceStack.length > 0) {
          spaceStack.pop();
        }
        return;
      }

      if (section === "GroupAddresses") {
        if (tag === "GroupAddresses") {
          section = "none";
          groupRangeStack.length = 0;
        } else if (tag === "GroupRange" && groupRangeStack.length > 0) {
          groupRangeStack.pop();
        }
        return;
      }

      if (section === "Trades") {
        if (tag === "Trades") {
          section = "none";
          tradeStack.length = 0;
        } else if (tag === "Trade" && tradeStack.length > 0) {
          tradeStack.pop();
        }
      }
    },
    onCapturedRaw(_tag, rawXml) {
      const target = activeCaptureTarget;
      activeCaptureTarget = null;
      if (!target) return;
      switch (target.kind) {
        case "installation":
          if (!target.target.rawExtraSections) target.target.rawExtraSections = [];
          target.target.rawExtraSections.push(rawXml);
          break;
        case "topology":
          if (!target.target.topology.rawExtraChildren) target.target.topology.rawExtraChildren = [];
          target.target.topology.rawExtraChildren.push(rawXml);
          break;
        case "area":
        case "line":
        case "segment":
        case "device":
        case "space":
        case "function":
        case "trade":
          if (!target.target.rawExtraChildren) target.target.rawExtraChildren = [];
          target.target.rawExtraChildren.push(rawXml);
          break;
      }
    },
  });

  return {
    xmlns,
    schemaVersion,
    createdBy,
    toolVersion,
    installations,
  };
}
