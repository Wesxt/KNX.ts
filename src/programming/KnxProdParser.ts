import path from "node:path";
import { Readable } from "node:stream";
import { ZipReader } from "./ZipReader";
import {
  FlagSetting,
  GroupObjectPriority,
  KnxAllocatorDef,
  KnxApplicationOptions,
  KnxApplicationProgram,
  KnxAppLoadProcedure,
  KnxCalculationParamBinding,
  KnxCodeSegment,
  KnxComObjectDef,
  KnxComObjectRefDef,
  KnxDynamicNode,
  KnxEnumerationValue,
  KnxHardwareInfo,
  KnxHardwareProduct,
  KnxLdCtrlStep,
  KnxMaskResource,
  KnxMaskVersion,
  KnxMasterProcedure,
  KnxMemoryLocation,
  KnxModuleDef,
  KnxParameterCalculationDef,
  KnxParameterDef,
  KnxParameterRefDef,
  KnxParameterType,
  KnxProdParseOptions,
  KnxPropertyLocation,
  KnxWhenNode,
  ParsedKnxProd,
} from "./types";

interface XmlCallbacks {
  onStartElement: (tag: string, attrs: Record<string, string>, selfClosing: boolean) => void;
  onEndElement: (tag: string) => void;
  onText?: (text: string) => void;
  /** Optional fast-skip predicate: return true to ignore an entire subtree's children until matching end tag. */
  shouldSkipSubtree?: (tag: string, attrs: Record<string, string>) => boolean;
}

export function decodeXmlEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
          const cp = parseInt(entity.slice(2), 16);
          return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
        }
        if (entity.startsWith("#")) {
          const cp = parseInt(entity.slice(1), 10);
          return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
        }
        return match;
    }
  });
}

function stripNamespacePrefix(rawTag: string): string {
  const colon = rawTag.indexOf(":");
  return colon === -1 ? rawTag : rawTag.slice(colon + 1);
}

/**
 * Fast zero-regex attribute parser for XML start tags.
 */
function parseTagAttributes(tagBody: string, startIdx: number, endIdx: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = startIdx;

  while (i < endIdx) {
    // Skip whitespace
    while (i < endIdx && tagBody.charCodeAt(i) <= 32) i++;
    if (i >= endIdx) break;

    const nameStart = i;
    while (i < endIdx) {
      const c = tagBody.charCodeAt(i);
      if (c === 61 /* = */ || c <= 32 || c === 47 /* / */) break;
      i++;
    }
    const name = tagBody.slice(nameStart, i);
    while (i < endIdx && tagBody.charCodeAt(i) <= 32) i++;
    if (i >= endIdx || tagBody.charCodeAt(i) !== 61 /* = */) {
      continue;
    }
    i++; // skip '='
    while (i < endIdx && tagBody.charCodeAt(i) <= 32) i++;
    if (i >= endIdx) break;

    const quote = tagBody.charCodeAt(i);
    if (quote === 34 /* " */ || quote === 39 /* ' */) {
      i++;
      const valStart = i;
      const valEnd = tagBody.indexOf(quote === 34 ? '"' : "'", valStart);
      if (valEnd === -1 || valEnd > endIdx) break;
      const rawVal = tagBody.slice(valStart, valEnd);
      attrs[name] = rawVal.includes("&") ? decodeXmlEntities(rawVal) : rawVal;
      i = valEnd + 1;
    } else {
      const valStart = i;
      while (i < endIdx && tagBody.charCodeAt(i) > 32) i++;
      attrs[name] = tagBody.slice(valStart, i);
    }
  }

  return attrs;
}

/**
 * High-speed streaming XML scanner that processes arbitrarily large XML streams (64+ MB)
 * in chunks with optional subtree fast-skipping (e.g., skipping 30+ MB `<Languages>` sections).
 */
async function parseXmlStream(stream: Readable, callbacks: XmlCallbacks): Promise<void> {
  let leftover = "";
  let skipTag: string | null = null;
  let skipDepth = 0;

  const processBuffer = (data: string, isFinal: boolean): string => {
    let pos = 0;
    const len = data.length;

    while (pos < len) {
      // Fast-path when skipping an entire subtree (e.g. <Languages>...</Languages>)
      if (skipTag !== null) {
        const lt = data.indexOf("<", pos);
        if (lt === -1) {
          return "";
        }
        const gt = data.indexOf(">", lt + 1);
        if (gt === -1) {
          return data.slice(lt);
        }
        // Check if this tag is opening or closing the skipped tag name
        const nextChar = data.charCodeAt(lt + 1);
        if (nextChar === 47 /* / */) {
          let endName = lt + 2;
          while (endName < gt && data.charCodeAt(endName) > 32) endName++;
          const closeName = stripNamespacePrefix(data.slice(lt + 2, endName));
          if (closeName === skipTag) {
            skipDepth--;
            if (skipDepth === 0) {
              skipTag = null;
            }
          }
        } else if (nextChar !== 33 /* ! */ && nextChar !== 63 /* ? */) {
          const selfClosing = data.charCodeAt(gt - 1) === 47; /* / */
          if (!selfClosing) {
            let endName = lt + 1;
            while (endName < gt && data.charCodeAt(endName) > 32 && data.charCodeAt(endName) !== 47) endName++;
            const openName = stripNamespacePrefix(data.slice(lt + 1, endName));
            if (openName === skipTag) {
              skipDepth++;
            }
          }
        }
        pos = gt + 1;
        continue;
      }

      const lt = data.indexOf("<", pos);
      if (lt === -1) {
        if (callbacks.onText && pos < len) {
          // Keep tail safely if it ends with an incomplete entity like "&lt"
          const amp = data.lastIndexOf("&");
          if (!isFinal && amp !== -1 && amp >= len - 12 && data.indexOf(";", amp) === -1) {
            if (amp > pos) callbacks.onText(decodeXmlEntities(data.slice(pos, amp)));
            return data.slice(amp);
          }
          callbacks.onText(decodeXmlEntities(data.slice(pos)));
        }
        return "";
      }

      if (lt > pos && callbacks.onText) {
        callbacks.onText(decodeXmlEntities(data.slice(pos, lt)));
      }

      // Need at least 2 chars to identify tag type
      if (lt + 1 >= len) {
        return data.slice(lt);
      }

      const c1 = data.charCodeAt(lt + 1);

      // Comment or CDATA or DOCTYPE: <!
      if (c1 === 33 /* ! */) {
        if (data.startsWith("<!--", lt)) {
          const endComment = data.indexOf("-->", lt + 4);
          if (endComment === -1) return data.slice(lt);
          pos = endComment + 3;
          continue;
        }
        if (data.startsWith("<![CDATA[", lt)) {
          const endCdata = data.indexOf("]]>", lt + 9);
          if (endCdata === -1) return data.slice(lt);
          if (callbacks.onText) {
            callbacks.onText(data.slice(lt + 9, endCdata));
          }
          pos = endCdata + 3;
          continue;
        }
        if (!isFinal && lt + 9 > len) {
          return data.slice(lt);
        }
        const gt = data.indexOf(">", lt + 2);
        if (gt === -1) return data.slice(lt);
        pos = gt + 1;
        continue;
      }

      // Processing instruction: <? ... ?>
      if (c1 === 63 /* ? */) {
        const endPi = data.indexOf("?>", lt + 2);
        if (endPi === -1) return data.slice(lt);
        pos = endPi + 2;
        continue;
      }

      // Find end of tag '>' (respecting quoted attributes containing '>')
      let gt = -1;
      let quoteChar = 0;
      for (let i = lt + 1; i < len; i++) {
        const ch = data.charCodeAt(i);
        if (quoteChar !== 0) {
          if (ch === quoteChar) quoteChar = 0;
        } else {
          if (ch === 34 /* " */ || ch === 39 /* ' */) {
            quoteChar = ch;
          } else if (ch === 62 /* > */) {
            gt = i;
            break;
          }
        }
      }
      if (gt === -1) {
        return data.slice(lt);
      }

      // Closing tag: </Name>
      if (c1 === 47 /* / */) {
        let nameEnd = lt + 2;
        while (nameEnd < gt && data.charCodeAt(nameEnd) > 32) nameEnd++;
        const tagName = stripNamespacePrefix(data.slice(lt + 2, nameEnd));
        callbacks.onEndElement(tagName);
        pos = gt + 1;
        continue;
      }

      // Start tag: <Name attr="val" ... /> or <Name ...>
      let nameEnd = lt + 1;
      while (nameEnd < gt) {
        const ch = data.charCodeAt(nameEnd);
        if (ch <= 32 || ch === 47 /* / */) break;
        nameEnd++;
      }
      const tagName = stripNamespacePrefix(data.slice(lt + 1, nameEnd));
      const selfClosing = data.charCodeAt(gt - 1) === 47; /* / */
      const attrEnd = selfClosing ? gt - 1 : gt;
      const attrs = nameEnd < attrEnd ? parseTagAttributes(data, nameEnd, attrEnd) : {};

      if (!selfClosing && callbacks.shouldSkipSubtree && callbacks.shouldSkipSubtree(tagName, attrs)) {
        skipTag = tagName;
        skipDepth = 1;
        pos = gt + 1;
        continue;
      }

      callbacks.onStartElement(tagName, attrs, selfClosing);
      if (selfClosing) {
        callbacks.onEndElement(tagName);
      }

      pos = gt + 1;
    }

    return "";
  };

  let firstChunk = true;
  for await (const rawChunk of stream) {
    let text = typeof rawChunk === "string" ? rawChunk : (rawChunk as Buffer).toString("utf8");
    if (firstChunk) {
      firstChunk = false;
      if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
      }
    }
    leftover = processBuffer(leftover + text, false);
  }
  if (leftover.length > 0) {
    processBuffer(leftover, true);
  }
}

function parseXmlStringSync(xml: string, callbacks: XmlCallbacks): void {
  const clean = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  let pos = 0;
  const len = clean.length;
  let skipTag: string | null = null;
  let skipDepth = 0;

  while (pos < len) {
    if (skipTag !== null) {
      const lt = clean.indexOf("<", pos);
      if (lt === -1) break;
      const gt = clean.indexOf(">", lt + 1);
      if (gt === -1) break;
      const c1 = clean.charCodeAt(lt + 1);
      if (c1 === 47) {
        let nameEnd = lt + 2;
        while (nameEnd < gt && clean.charCodeAt(nameEnd) > 32) nameEnd++;
        if (stripNamespacePrefix(clean.slice(lt + 2, nameEnd)) === skipTag) {
          skipDepth--;
          if (skipDepth === 0) skipTag = null;
        }
      } else if (c1 !== 33 && c1 !== 63 && clean.charCodeAt(gt - 1) !== 47) {
        let nameEnd = lt + 1;
        while (nameEnd < gt && clean.charCodeAt(nameEnd) > 32 && clean.charCodeAt(nameEnd) !== 47) nameEnd++;
        if (stripNamespacePrefix(clean.slice(lt + 1, nameEnd)) === skipTag) {
          skipDepth++;
        }
      }
      pos = gt + 1;
      continue;
    }

    const lt = clean.indexOf("<", pos);
    if (lt === -1) {
      if (callbacks.onText && pos < len) callbacks.onText(decodeXmlEntities(clean.slice(pos)));
      break;
    }
    if (lt > pos && callbacks.onText) {
      callbacks.onText(decodeXmlEntities(clean.slice(pos, lt)));
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
        if (end !== -1 && callbacks.onText) callbacks.onText(clean.slice(lt + 9, end));
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
    let quoteChar = 0;
    for (let i = lt + 1; i < len; i++) {
      const ch = clean.charCodeAt(i);
      if (quoteChar !== 0) {
        if (ch === quoteChar) quoteChar = 0;
      } else if (ch === 34 || ch === 39) {
        quoteChar = ch;
      } else if (ch === 62) {
        gt = i;
        break;
      }
    }
    if (gt === -1) break;

    if (c1 === 47) {
      let nameEnd = lt + 2;
      while (nameEnd < gt && clean.charCodeAt(nameEnd) > 32) nameEnd++;
      callbacks.onEndElement(stripNamespacePrefix(clean.slice(lt + 2, nameEnd)));
      pos = gt + 1;
      continue;
    }

    let nameEnd = lt + 1;
    while (nameEnd < gt && clean.charCodeAt(nameEnd) > 32 && clean.charCodeAt(nameEnd) !== 47) nameEnd++;
    const tagName = stripNamespacePrefix(clean.slice(lt + 1, nameEnd));
    const selfClosing = clean.charCodeAt(gt - 1) === 47;
    const attrEnd = selfClosing ? gt - 1 : gt;
    const attrs = nameEnd < attrEnd ? parseTagAttributes(clean, nameEnd, attrEnd) : {};

    if (!selfClosing && callbacks.shouldSkipSubtree && callbacks.shouldSkipSubtree(tagName, attrs)) {
      skipTag = tagName;
      skipDepth = 1;
      pos = gt + 1;
      continue;
    }

    callbacks.onStartElement(tagName, attrs, selfClosing);
    if (selfClosing) callbacks.onEndElement(tagName);
    pos = gt + 1;
  }
}

function parseIntOpt(val?: string): number | undefined {
  if (val === undefined || val === "") return undefined;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseFloatOpt(val?: string): number | undefined {
  if (val === undefined || val === "") return undefined;
  const n = parseFloat(val);
  return Number.isNaN(n) ? undefined : n;
}

function parseBool(val: string | undefined, defaultVal: boolean): boolean {
  if (val === undefined) return defaultVal;
  return val === "true" || val === "1";
}

function parseManufacturerId(refId: string): number {
  const m = /M-([0-9A-Fa-f]{4})/.exec(refId);
  return m ? parseInt(m[1], 16) : 0;
}

function parseMaskVersionNumber(maskVersionId: string): number {
  const m = /MV-([0-9A-Fa-f]{4})/.exec(maskVersionId);
  return m ? parseInt(m[1], 16) : 0;
}

function parseFlag(val: string | undefined, fallback: FlagSetting): FlagSetting {
  if (val === "Enabled" || val === "Disabled") return val;
  return fallback;
}

function parsePriority(val: string | undefined): GroupObjectPriority {
  if (val === "System" || val === "Normal" || val === "Urgent" || val === "Alert" || val === "Low") {
    return val;
  }
  return "Low";
}

/**
 * Parses `knx_master.xml` to extract `<MaskVersion>` definitions and their non-legacy `<HawkConfigurationData>`
 * (including System B `MV-07B0` `<Procedure>` templates and `<Resources>`).
 */
export function parseKnxMasterMaskVersions(masterXml: string): Map<string, KnxMaskVersion> {
  const maskVersions = new Map<string, KnxMaskVersion>();

  let currentMv: KnxMaskVersion | null = null;
  let inHawk = false;
  let ignoreLegacyHawk = false;
  let currentResource: KnxMaskResource | null = null;
  let currentProcedure: KnxMasterProcedure | null = null;

  parseXmlStringSync(masterXml, {
    shouldSkipSubtree(tag, attrs) {
      if (
        tag === "Languages" ||
        tag === "DatapointTypes" ||
        tag === "Manufacturers" ||
        tag === "FunctionTypes" ||
        tag === "SpaceUsages"
      ) {
        return true;
      }
      if (tag === "HawkConfigurationData" && attrs.LegacyVersion !== undefined) {
        return true;
      }
      return false;
    },
    onStartElement(tag, attrs) {
      if (tag === "MaskVersion") {
        currentMv = {
          id: attrs.Id ?? "",
          maskVersion: parseIntOpt(attrs.MaskVersion) ?? parseMaskVersionNumber(attrs.Id ?? ""),
          name: attrs.Name ?? "",
          managementModel: attrs.ManagementModel ?? "",
          mediumTypeRefId: attrs.MediumTypeRefId ?? "MT-0",
          features: {},
          resources: new Map(),
          procedures: [],
        };
        if (currentMv.id) {
          maskVersions.set(currentMv.id, currentMv);
        }
        return;
      }
      if (!currentMv) return;

      if (tag === "HawkConfigurationData") {
        ignoreLegacyHawk = attrs.LegacyVersion !== undefined;
        inHawk = !ignoreLegacyHawk;
        return;
      }
      if (!inHawk) return;

      if (tag === "Feature" && attrs.Name) {
        currentMv.features[attrs.Name] = attrs.Value ?? "";
      } else if (tag === "Resource" && attrs.Name) {
        currentResource = {
          name: attrs.Name,
          access: attrs.Access ?? "",
          addressSpace: "",
        };
        currentMv.resources.set(currentResource.name, currentResource);
      } else if (tag === "Location" && currentResource) {
        currentResource.addressSpace = attrs.AddressSpace ?? "";
        currentResource.interfaceObjectRef = parseIntOpt(attrs.InterfaceObjectRef);
        currentResource.propertyId = parseIntOpt(attrs.PropertyID);
        currentResource.startAddress = parseIntOpt(attrs.StartAddress);
      } else if (tag === "ResourceType" && currentResource) {
        currentResource.length = parseIntOpt(attrs.Length);
        currentResource.flavour = attrs.Flavour;
      } else if (tag === "Procedure") {
        currentProcedure = {
          procedureType: attrs.ProcedureType ?? "",
          procedureSubType: attrs.ProcedureSubType ?? "",
          access: attrs.Access ?? "",
          steps: [],
        };
        currentMv.procedures.push(currentProcedure);
      } else if (currentProcedure && tag.startsWith("LdCtrl")) {
        currentProcedure.steps.push({ tag, attrs });
      }
    },
    onEndElement(tag) {
      if (tag === "MaskVersion") {
        currentMv = null;
        inHawk = false;
      } else if (tag === "HawkConfigurationData") {
        inHawk = false;
        ignoreLegacyHawk = false;
      } else if (tag === "Resource") {
        currentResource = null;
      } else if (tag === "Procedure") {
        currentProcedure = null;
      }
    },
  });

  return maskVersions;
}

/**
 * Parses `M-xxxx/Hardware.xml`.
 */
export function parseHardwareXml(hardwareXml: string): KnxHardwareInfo[] {
  const result: KnxHardwareInfo[] = [];
  let currentHw: KnxHardwareInfo | null = null;

  parseXmlStringSync(hardwareXml, {
    shouldSkipSubtree(tag) {
      return tag === "Languages";
    },
    onStartElement(tag, attrs) {
      if (tag === "Hardware" && attrs.Id) {
        currentHw = {
          id: attrs.Id,
          name: attrs.Name ?? "",
          serialNumber: attrs.SerialNumber,
          versionNumber: parseIntOpt(attrs.VersionNumber),
          busCurrent: parseIntOpt(attrs.BusCurrent),
          hasIndividualAddress: parseBool(attrs.HasIndividualAddress, true),
          hasApplicationProgram: parseBool(attrs.HasApplicationProgram, true),
          products: [],
          applicationProgramRefIds: [],
        };
        result.push(currentHw);
      } else if (tag === "Product" && currentHw && attrs.Id) {
        const prod: KnxHardwareProduct = {
          id: attrs.Id,
          text: attrs.Text ?? "",
          orderNumber: attrs.OrderNumber ?? "",
          isRailMounted: attrs.IsRailMounted !== undefined ? parseBool(attrs.IsRailMounted, false) : undefined,
          defaultLanguage: attrs.DefaultLanguage,
        };
        currentHw.products.push(prod);
      } else if (tag === "ApplicationProgramRef" && currentHw && attrs.RefId) {
        currentHw.applicationProgramRefIds.push(attrs.RefId);
      }
    },
    onEndElement(tag) {
      if (tag === "Hardware" && currentHw) {
        // Note: outer <Hardware> wrapper has no Id, inner <Hardware Id="..."> sets currentHw
        // Only clear when matching the inner Hardware element
      }
    },
  });

  return result;
}

/**
 * Streams and parses a KNX ApplicationProgram XML (`M-xxxx/M-xxxx_A-*.xml`).
 */
export async function parseApplicationProgramStream(
  stream: Readable,
  options: KnxProdParseOptions = {},
): Promise<KnxApplicationProgram[]> {
  const apps: KnxApplicationProgram[] = [];
  const wantedLanguage = options.language;

  let manufacturerRefId = "";
  let app: KnxApplicationProgram | null = null;
  let currentModuleDef: KnxModuleDef | null = null;

  // Helpers that target either the active ModuleDef or the root ApplicationProgram
  const targetParams = () => (currentModuleDef ? currentModuleDef.parameters : app!.parameters);
  const targetParamRefs = () => (currentModuleDef ? currentModuleDef.parameterRefs : app!.parameterRefs);
  const targetComObjects = () => (currentModuleDef ? currentModuleDef.comObjects : app!.comObjects);
  const targetComObjectRefs = () => (currentModuleDef ? currentModuleDef.comObjectRefs : app!.comObjectRefs);
  const targetCalcs = () => (currentModuleDef ? currentModuleDef.parameterCalculations : app!.parameterCalculations);

  // Active parsing contexts
  let currentSegment: {
    kind: "RelativeSegment" | "AbsoluteSegment";
    attrs: Record<string, string>;
    dataChunks: string[];
    maskChunks: string[];
  } | null = null;
  let currentSegmentChild: "Data" | "Mask" | null = null;

  let currentParamType: KnxParameterType | null = null;
  let currentRestrictionEnums: KnxEnumerationValue[] | null = null;

  let unionCounter = 0;
  let currentUnion: {
    id: string;
    sizeInBit: number;
    memory?: KnxMemoryLocation;
    params: KnxParameterDef[];
  } | null = null;
  let currentParam: KnxParameterDef | null = null;

  let currentCalc: KnxParameterCalculationDef | null = null;
  let currentCalcSection: "LR" | "RL" | "LParams" | "RParams" | null = null;
  let calcTextChunks: string[] = [];

  let currentLoadProc: KnxAppLoadProcedure | null = null;
  let inScript = false;
  let scriptChunks: string[] = [];

  // Dynamic AST builder stack
  let inDynamic = false;
  type DynStackFrame =
    | { kind: "Root"; tag: "Dynamic"; children: KnxDynamicNode[] }
    | { kind: "Container"; tag: string; node: Extract<KnxDynamicNode, { type: "Container" }> }
    | { kind: "Choose"; tag: "choose"; node: Extract<KnxDynamicNode, { type: "Choose" }> }
    | { kind: "When"; tag: "when"; node: KnxWhenNode }
    | { kind: "Repeat"; tag: "Repeat"; node: Extract<KnxDynamicNode, { type: "Repeat" }> }
    | { kind: "Module"; tag: "Module"; node: Extract<KnxDynamicNode, { type: "Module" }> };
  const dynStack: DynStackFrame[] = [];

  const pushDynChild = (node: KnxDynamicNode) => {
    const top = dynStack[dynStack.length - 1];
    if (!top) return;
    if (top.kind === "Root") top.children.push(node);
    else if (top.kind === "Container") top.node.children.push(node);
    else if (top.kind === "When") top.node.children.push(node);
    else if (top.kind === "Repeat") top.node.children.push(node);
  };

  // Optional translation & language discovery
  let currentTranslationRefId: string | null = null;
  const translationsMap: Map<string, Record<string, string>> | null = wantedLanguage ? new Map() : null;
  const foundLanguages: string[] = [];
  const recordLanguage = (langId?: string) => {
    if (langId && !foundLanguages.includes(langId)) {
      foundLanguages.push(langId);
    }
  };

  await parseXmlStream(stream, {
    shouldSkipSubtree(tag, attrs) {
      if (tag === "Language") {
        recordLanguage(attrs.Identifier);
        return !wantedLanguage || attrs.Identifier !== wantedLanguage;
      }
      if (tag === "ApplicationProgram" && options.applicationId && attrs.Id !== options.applicationId) {
        return true;
      }
      // Skip purely layout/binary metadata not needed for parameterization or programming
      if (tag === "Rows" || tag === "Columns" || tag === "Button" || tag === "HelpContext" || tag === "Baggages") {
        return true;
      }
      return false;
    },
    onStartElement(tag, attrs, selfClosing) {
      if (tag === "Manufacturer" && attrs.RefId) {
        manufacturerRefId = attrs.RefId;
        return;
      }
      if (tag === "Language" && attrs.Identifier) {
        recordLanguage(attrs.Identifier);
        return;
      }

      // Translations (only reached if wantedLanguage matches)
      if (translationsMap && tag === "TranslationElement" && attrs.RefId) {
        currentTranslationRefId = attrs.RefId;
        return;
      }
      if (translationsMap && tag === "Translation" && currentTranslationRefId && attrs.AttributeName) {
        let entry = translationsMap.get(currentTranslationRefId);
        if (!entry) {
          entry = {};
          translationsMap.set(currentTranslationRefId, entry);
        }
        entry[attrs.AttributeName] = attrs.Text ?? "";
        return;
      }

      if (tag === "ApplicationProgram" && attrs.Id) {
        const mfrId = parseManufacturerId(manufacturerRefId || attrs.Id);
        const maskVersionId = attrs.MaskVersion ?? "MV-07B0";
        const defaultOptions: KnxApplicationOptions = {
          parameterByteOrder: "BigEndian",
          textParameterEncoding: "us-ascii",
          textParameterZeroTerminate: false,
          preferPartialDownloadIfApplicationLoaded: false,
          supportsExtendedMemoryServices: false,
          supportsExtendedPropertyServices: false,
        };
        app = {
          id: attrs.Id,
          manufacturerRefId: manufacturerRefId || `M-${mfrId.toString(16).toUpperCase().padStart(4, "0")}`,
          manufacturerId: mfrId,
          applicationNumber: parseIntOpt(attrs.ApplicationNumber) ?? 0,
          applicationVersion: parseIntOpt(attrs.ApplicationVersion) ?? 0,
          programType: attrs.ProgramType ?? "ApplicationProgram",
          maskVersionId,
          maskVersion: parseMaskVersionNumber(maskVersionId),
          name: attrs.Name ?? attrs.Id,
          visibleDescription: attrs.VisibleDescription,
          loadProcedureStyle: attrs.LoadProcedureStyle ?? "MergedProcedure",
          peiType: parseIntOpt(attrs.PeiType) ?? 0,
          defaultLanguage: attrs.DefaultLanguage ?? "en-US",
          dynamicTableManagement: parseBool(attrs.DynamicTableManagement, false),
          linkable: parseBool(attrs.Linkable, false),
          isSecureEnabled: parseBool(attrs.IsSecureEnabled, false),
          maxSecurityIndividualAddressEntries: parseIntOpt(attrs.MaxSecurityIndividualAddressEntries),
          maxSecurityGroupKeyTableEntries: parseIntOpt(attrs.MaxSecurityGroupKeyTableEntries),
          maxSecurityP2PKeyTableEntries: parseIntOpt(attrs.MaxSecurityP2PKeyTableEntries),
          addressTableMaxEntries: 255,
          associationTableMaxEntries: 255,
          options: defaultOptions,
          codeSegments: new Map(),
          parameterTypes: new Map(),
          parameters: new Map(),
          parameterRefs: new Map(),
          comObjects: new Map(),
          comObjectRefs: new Map(),
          parameterCalculations: [],
          allocators: new Map(),
          moduleDefs: new Map(),
          loadProcedures: [],
          dynamic: [],
          availableLanguages: [],
        };
        apps.push(app);
        return;
      }

      if (!app) return;

      // ---- Dynamic section ----
      if (tag === "Dynamic") {
        inDynamic = true;
        dynStack.length = 0;
        const targetRoot = currentModuleDef ? currentModuleDef.dynamic : app.dynamic;
        dynStack.push({ kind: "Root", tag: "Dynamic", children: targetRoot });
        return;
      }

      if (inDynamic) {
        if (tag === "choose") {
          const node: Extract<KnxDynamicNode, { type: "Choose" }> = {
            type: "Choose",
            paramRefId: attrs.ParamRefId ?? "",
            whens: [],
          };
          pushDynChild(node);
          dynStack.push({ kind: "Choose", tag: "choose", node });
        } else if (tag === "when") {
          const top = dynStack[dynStack.length - 1];
          const whenNode: KnxWhenNode = {
            test: attrs.test,
            isDefault: parseBool(attrs.default, false),
            children: [],
          };
          if (top && top.kind === "Choose") {
            top.node.whens.push(whenNode);
          }
          dynStack.push({ kind: "When", tag: "when", node: whenNode });
        } else if (tag === "ParameterRefRef" && attrs.RefId) {
          pushDynChild({
            type: "ParameterRefRef",
            refId: attrs.RefId,
            indentLevel: parseIntOpt(attrs.IndentLevel),
          });
        } else if (tag === "ComObjectRefRef" && attrs.RefId) {
          pushDynChild({
            type: "ComObjectRefRef",
            refId: attrs.RefId,
          });
        } else if (tag === "Assign" && attrs.TargetParamRefRef) {
          pushDynChild({
            type: "Assign",
            targetParamRefRef: attrs.TargetParamRefRef,
            sourceParamRefRef: attrs.SourceParamRefRef,
            value: attrs.Value,
          });
        } else if (tag === "Module" && attrs.RefId) {
          const modNode: Extract<KnxDynamicNode, { type: "Module" }> = {
            type: "Module",
            id: attrs.Id ?? "",
            refId: attrs.RefId,
            numericArgs: [],
          };
          pushDynChild(modNode);
          dynStack.push({ kind: "Module", tag: "Module", node: modNode });
        } else if (tag === "NumericArg" && attrs.RefId) {
          const top = dynStack[dynStack.length - 1];
          if (top && top.kind === "Module") {
            top.node.numericArgs.push({
              refId: attrs.RefId,
              value: parseIntOpt(attrs.Value),
              allocatorRefId: attrs.AllocatorRefId,
            });
          }
        } else if (tag === "Repeat") {
          const repNode: Extract<KnxDynamicNode, { type: "Repeat" }> = {
            type: "Repeat",
            id: attrs.Id ?? "",
            parameterRefId: attrs.ParameterRefId,
            count: parseIntOpt(attrs.Count),
            children: [],
          };
          pushDynChild(repNode);
          dynStack.push({ kind: "Repeat", tag: "Repeat", node: repNode });
        } else if (tag === "ParameterSeparator") {
          pushDynChild({
            type: "Separator",
            id: attrs.Id,
            text: attrs.Text ?? "",
            uiHint: attrs.UIHint,
          });
        } else if (
          tag === "Channel" ||
          tag === "ChannelIndependentBlock" ||
          tag === "ParameterBlock" ||
          tag === "ComObjectParameterBlock"
        ) {
          const container: Extract<KnxDynamicNode, { type: "Container" }> = {
            type: "Container",
            tag,
            id: attrs.Id,
            name: attrs.Name,
            text: attrs.Text,
            textParameterRefId: attrs.TextParameterRefId,
            access: attrs.Access,
            children: [],
          };
          pushDynChild(container);
          dynStack.push({ kind: "Container", tag, node: container });
        }
        return;
      }

      // ---- ModuleDef ----
      if (tag === "ModuleDef" && attrs.Id) {
        currentModuleDef = {
          id: attrs.Id,
          name: attrs.Name ?? attrs.Id,
          arguments: [],
          parameters: new Map(),
          parameterRefs: new Map(),
          comObjects: new Map(),
          comObjectRefs: new Map(),
          parameterCalculations: [],
          dynamic: [],
        };
        app.moduleDefs.set(currentModuleDef.id, currentModuleDef);
        return;
      }
      if (currentModuleDef && tag === "Argument" && attrs.Id) {
        currentModuleDef.arguments.push({
          id: attrs.Id,
          name: attrs.Name ?? "",
          allocates: parseIntOpt(attrs.Allocates),
          baseValue: parseIntOpt(attrs.BaseValue),
        });
        return;
      }

      // ---- Code Segments ----
      if (tag === "RelativeSegment" || tag === "AbsoluteSegment") {
        currentSegment = {
          kind: tag,
          attrs,
          dataChunks: [],
          maskChunks: [],
        };
        return;
      }
      if (currentSegment && (tag === "Data" || tag === "Mask")) {
        currentSegmentChild = tag;
        return;
      }

      // ---- Static Tables & Options ----
      if (tag === "AddressTable" && attrs.MaxEntries) {
        app.addressTableMaxEntries = parseIntOpt(attrs.MaxEntries) ?? app.addressTableMaxEntries;
        return;
      }
      if (tag === "AssociationTable" && attrs.MaxEntries) {
        app.associationTableMaxEntries = parseIntOpt(attrs.MaxEntries) ?? app.associationTableMaxEntries;
        return;
      }
      if (tag === "Options") {
        app.options = {
          parameterByteOrder: attrs.ParameterByteOrder === "LittleEndian" ? "LittleEndian" : "BigEndian",
          textParameterEncoding: attrs.TextParameterEncoding ?? "us-ascii",
          textParameterZeroTerminate: parseBool(attrs.TextParameterZeroTerminate, false),
          preferPartialDownloadIfApplicationLoaded: parseBool(attrs.PreferPartialDownloadIfApplicationLoaded, false),
          downloadInvisibleParameters: attrs.DownloadInvisibleParameters,
          supportsExtendedMemoryServices: parseBool(attrs.SupportsExtendedMemoryServices, false),
          supportsExtendedPropertyServices: parseBool(attrs.SupportsExtendedPropertyServices, false),
          comparable: attrs.Comparable !== undefined ? parseBool(attrs.Comparable, false) : undefined,
          reconstructable: attrs.Reconstructable !== undefined ? parseBool(attrs.Reconstructable, false) : undefined,
        };
        return;
      }

      // ---- Allocators ----
      if (tag === "Allocator" && attrs.Id) {
        const alloc: KnxAllocatorDef = {
          id: attrs.Id,
          name: attrs.Name ?? attrs.Id,
          start: parseIntOpt(attrs.Start) ?? 0,
          maxInclusive: parseIntOpt(attrs.maxInclusive) ?? 0,
        };
        app.allocators.set(alloc.id, alloc);
        return;
      }

      // ---- ParameterTypes ----
      if (tag === "ParameterType" && attrs.Id) {
        currentParamType = {
          id: attrs.Id,
          name: attrs.Name ?? attrs.Id,
          detail: { kind: "None" },
        };
        app.parameterTypes.set(currentParamType.id, currentParamType);
        currentRestrictionEnums = null;
        return;
      }
      if (currentParamType) {
        if (tag === "TypeNumber") {
          currentParamType.detail = {
            kind: "Number",
            sizeInBit: parseIntOpt(attrs.SizeInBit) ?? 8,
            numberType: attrs.Type === "signedInt" ? "signedInt" : attrs.Type === "float" ? "float" : "unsignedInt",
            minInclusive: parseFloatOpt(attrs.minInclusive),
            maxInclusive: parseFloatOpt(attrs.maxInclusive),
            uiHint: attrs.UIHint,
          };
          return;
        }
        if (tag === "TypeRestriction") {
          const enums: KnxEnumerationValue[] = [];
          currentRestrictionEnums = enums;
          currentParamType.detail = {
            kind: "Restriction",
            base: attrs.Base === "BinaryValue" ? "BinaryValue" : "Value",
            sizeInBit: parseIntOpt(attrs.SizeInBit) ?? 8,
            enumerations: enums,
          };
          return;
        }
        if (tag === "Enumeration" && currentRestrictionEnums) {
          currentRestrictionEnums.push({
            id: attrs.Id ?? "",
            text: attrs.Text ?? "",
            value: parseIntOpt(attrs.Value) ?? 0,
            binaryValue: attrs.BinaryValue ? Buffer.from(attrs.BinaryValue, "base64") : undefined,
          });
          return;
        }
        if (tag === "TypeFloat") {
          const encoding = attrs.Encoding ?? "IEEE-754 Single";
          const sizeInBit = encoding === "DPT 9" ? 16 : encoding === "IEEE-754 Double" ? 64 : 32;
          currentParamType.detail = {
            kind: "Float",
            encoding,
            sizeInBit,
            minInclusive: parseFloatOpt(attrs.minInclusive),
            maxInclusive: parseFloatOpt(attrs.maxInclusive),
          };
          return;
        }
        if (tag === "TypeText") {
          currentParamType.detail = {
            kind: "Text",
            sizeInBit: parseIntOpt(attrs.SizeInBit) ?? 0,
            pattern: attrs.Pattern,
          };
          return;
        }
        if (tag === "TypePicture") {
          currentParamType.detail = { kind: "Picture", refId: attrs.RefId };
          return;
        }
        if (tag === "TypeNone") {
          currentParamType.detail = { kind: "None" };
          return;
        }
        if (tag === "TypeRawData") {
          currentParamType.detail = { kind: "RawData", maxSize: parseIntOpt(attrs.MaxSize) };
          return;
        }
        if (tag === "TypeColor") {
          currentParamType.detail = {
            kind: "Color",
            space: attrs.Space,
            sizeInBit: attrs.Space === "RGBW" ? 32 : 24,
          };
          return;
        }
        if (tag === "TypeTime") {
          currentParamType.detail = {
            kind: "Time",
            sizeInBit: parseIntOpt(attrs.SizeInBit) ?? 16,
            unit: attrs.Unit,
          };
          return;
        }
        if (tag === "TypeIPAddress") {
          currentParamType.detail = {
            kind: "IPAddress",
            version: attrs.Version ?? "IPv4",
            sizeInBit: attrs.Version === "IPv6" ? 128 : 32,
          };
          return;
        }
      }

      // ---- Parameters & Unions ----
      if (tag === "Union") {
        unionCounter++;
        currentUnion = {
          id: `U-${unionCounter}`,
          sizeInBit: parseIntOpt(attrs.SizeInBit) ?? 8,
          params: [],
        };
        return;
      }
      if (tag === "Parameter" && attrs.Id) {
        const param: KnxParameterDef = {
          id: attrs.Id,
          name: attrs.Name ?? attrs.Id,
          text: attrs.Text ?? attrs.Name ?? "",
          parameterTypeId: attrs.ParameterType ?? "",
          defaultValue: attrs.Value ?? "",
          access: attrs.Access,
          suffixText: attrs.SuffixText,
        };
        if (currentUnion) {
          param.unionId = currentUnion.id;
          param.unionSizeInBit = currentUnion.sizeInBit;
          param.unionOffset = parseIntOpt(attrs.Offset) ?? 0;
          param.unionBitOffset = parseIntOpt(attrs.BitOffset) ?? 0;
          param.defaultUnionParameter = parseBool(attrs.DefaultUnionParameter, false);
          if (currentUnion.memory) {
            param.memory = {
              codeSegment: currentUnion.memory.codeSegment,
              offset: currentUnion.memory.offset + param.unionOffset,
              bitOffset: currentUnion.memory.bitOffset + param.unionBitOffset,
              baseOffset: currentUnion.memory.baseOffset,
            };
          }
          currentUnion.params.push(param);
        }
        currentParam = param;
        targetParams().set(param.id, param);
        return;
      }
      if (tag === "Memory") {
        const mem: KnxMemoryLocation = {
          codeSegment: attrs.CodeSegment ?? "",
          offset: parseIntOpt(attrs.Offset) ?? 0,
          bitOffset: parseIntOpt(attrs.BitOffset) ?? 0,
          baseOffset: attrs.BaseOffset,
        };
        if (currentParam) {
          currentParam.memory = mem;
        } else if (currentUnion) {
          currentUnion.memory = mem;
          for (const up of currentUnion.params) {
            up.memory = {
              codeSegment: mem.codeSegment,
              offset: mem.offset + (up.unionOffset ?? 0),
              bitOffset: mem.bitOffset + (up.unionBitOffset ?? 0),
              baseOffset: mem.baseOffset,
            };
          }
        }
        return;
      }
      if (tag === "Property" && currentParam) {
        const prop: KnxPropertyLocation = {
          objectIndex: parseIntOpt(attrs.ObjectIndex),
          objectType: parseIntOpt(attrs.ObjectType),
          occurrence: parseIntOpt(attrs.Occurrence),
          propertyId: parseIntOpt(attrs.PropertyId) ?? 0,
          offset: parseIntOpt(attrs.Offset) ?? 0,
          bitOffset: parseIntOpt(attrs.BitOffset) ?? 0,
        };
        currentParam.property = prop;
        return;
      }

      // ---- ParameterRefs ----
      if (tag === "ParameterRef" && attrs.Id && attrs.RefId) {
        const ref: KnxParameterRefDef = {
          id: attrs.Id,
          refId: attrs.RefId,
          name: attrs.Name,
          text: attrs.Text,
          value: attrs.Value,
          access: attrs.Access,
          suffixText: attrs.SuffixText,
        };
        targetParamRefs().set(ref.id, ref);
        return;
      }

      // ---- ParameterCalculations ----
      if (tag === "ParameterCalculation" && attrs.Id) {
        currentCalc = {
          id: attrs.Id,
          name: attrs.Name ?? attrs.Id,
          language: attrs.Language ?? "JavaScript",
          lrTransformationFunc: attrs.LRTransformationFunc,
          rlTransformationFunc: attrs.RLTransformationFunc,
          lrTransformationParameters: attrs.LRTransformationParameters,
          rlTransformationParameters: attrs.RLTransformationParameters,
          lParameters: [],
          rParameters: [],
        };
        targetCalcs().push(currentCalc);
        return;
      }
      if (currentCalc) {
        if (tag === "LRTransformation") {
          currentCalcSection = "LR";
          calcTextChunks = [];
          return;
        }
        if (tag === "RLTransformation") {
          currentCalcSection = "RL";
          calcTextChunks = [];
          return;
        }
        if (tag === "LParameters") {
          currentCalcSection = "LParams";
          return;
        }
        if (tag === "RParameters") {
          currentCalcSection = "RParams";
          return;
        }
        if (tag === "ParameterRefRef" && attrs.RefId) {
          const binding: KnxCalculationParamBinding = {
            refId: attrs.RefId,
            aliasName: attrs.AliasName ?? attrs.RefId,
          };
          if (currentCalcSection === "LParams") currentCalc.lParameters.push(binding);
          else if (currentCalcSection === "RParams") currentCalc.rParameters.push(binding);
          return;
        }
      }

      // ---- ComObjectTable & ComObjectRefs ----
      if (tag === "ComObject" && attrs.Id) {
        const co: KnxComObjectDef = {
          id: attrs.Id,
          number: parseIntOpt(attrs.Number) ?? 0,
          name: attrs.Name ?? attrs.Id,
          text: attrs.Text ?? "",
          functionText: attrs.FunctionText ?? "",
          objectSize: attrs.ObjectSize ?? "1 Bit",
          datapointType: attrs.DatapointType,
          priority: parsePriority(attrs.Priority),
          communicationFlag: parseFlag(attrs.CommunicationFlag, "Enabled"),
          readFlag: parseFlag(attrs.ReadFlag, "Disabled"),
          writeFlag: parseFlag(attrs.WriteFlag, "Disabled"),
          transmitFlag: parseFlag(attrs.TransmitFlag, "Disabled"),
          updateFlag: parseFlag(attrs.UpdateFlag, "Disabled"),
          readOnInitFlag: parseFlag(attrs.ReadOnInitFlag, "Disabled"),
          baseNumber: attrs.BaseNumber,
        };
        targetComObjects().set(co.id, co);
        return;
      }
      if (tag === "ComObjectRef" && attrs.Id && attrs.RefId) {
        const cor: KnxComObjectRefDef = {
          id: attrs.Id,
          refId: attrs.RefId,
          name: attrs.Name,
          text: attrs.Text,
          functionText: attrs.FunctionText,
          objectSize: attrs.ObjectSize,
          datapointType: attrs.DatapointType,
          priority: attrs.Priority ? parsePriority(attrs.Priority) : undefined,
          communicationFlag: attrs.CommunicationFlag ? parseFlag(attrs.CommunicationFlag, "Enabled") : undefined,
          readFlag: attrs.ReadFlag ? parseFlag(attrs.ReadFlag, "Disabled") : undefined,
          writeFlag: attrs.WriteFlag ? parseFlag(attrs.WriteFlag, "Disabled") : undefined,
          transmitFlag: attrs.TransmitFlag ? parseFlag(attrs.TransmitFlag, "Disabled") : undefined,
          updateFlag: attrs.UpdateFlag ? parseFlag(attrs.UpdateFlag, "Disabled") : undefined,
          readOnInitFlag: attrs.ReadOnInitFlag ? parseFlag(attrs.ReadOnInitFlag, "Disabled") : undefined,
          textParameterRefId: attrs.TextParameterRefId,
        };
        targetComObjectRefs().set(cor.id, cor);
        return;
      }

      // ---- LoadProcedures ----
      if (tag === "LoadProcedure") {
        currentLoadProc = {
          mergeId: parseIntOpt(attrs.MergeId),
          steps: [],
        };
        app.loadProcedures.push(currentLoadProc);
        return;
      }
      if (currentLoadProc && tag.startsWith("LdCtrl")) {
        const step: KnxLdCtrlStep = { tag, attrs };
        currentLoadProc.steps.push(step);
        return;
      }

      // ---- Script ----
      if (tag === "Script" && !selfClosing) {
        inScript = true;
        scriptChunks = [];
        return;
      }
    },
    onText(text) {
      if (currentSegment && currentSegmentChild === "Data") {
        currentSegment.dataChunks.push(text);
      } else if (currentSegment && currentSegmentChild === "Mask") {
        currentSegment.maskChunks.push(text);
      } else if (currentCalc && (currentCalcSection === "LR" || currentCalcSection === "RL")) {
        calcTextChunks.push(text);
      } else if (inScript) {
        scriptChunks.push(text);
      }
    },
    onEndElement(tag) {
      if (tag === "TranslationElement") {
        currentTranslationRefId = null;
        return;
      }

      if (inDynamic) {
        if (tag === "Dynamic") {
          inDynamic = false;
          dynStack.length = 0;
        } else if (
          tag === "choose" ||
          tag === "when" ||
          tag === "Repeat" ||
          tag === "Module" ||
          tag === "Channel" ||
          tag === "ChannelIndependentBlock" ||
          tag === "ParameterBlock" ||
          tag === "ComObjectParameterBlock"
        ) {
          if (dynStack.length > 1 && dynStack[dynStack.length - 1].tag === tag) {
            dynStack.pop();
          }
        }
        return;
      }

      if (tag === "ApplicationProgram") {
        if (app && translationsMap && translationsMap.size > 0) {
          app.translations = translationsMap;
        }
        app = null;
        return;
      }
      if (tag === "ModuleDef") {
        currentModuleDef = null;
        return;
      }
      if (currentSegment && (tag === "Data" || tag === "Mask")) {
        currentSegmentChild = null;
        return;
      }
      if (currentSegment && (tag === "RelativeSegment" || tag === "AbsoluteSegment")) {
        const a = currentSegment.attrs;
        const size = parseIntOpt(a.Size) ?? 0;
        const rawDataStr = currentSegment.dataChunks.join("").replace(/\s+/g, "");
        const rawMaskStr = currentSegment.maskChunks.join("").replace(/\s+/g, "");
        let dataBuf = rawDataStr.length > 0 ? Buffer.from(rawDataStr, "base64") : Buffer.alloc(size);
        if (size > 0 && dataBuf.length < size) {
          const padded = Buffer.alloc(size);
          dataBuf.copy(padded, 0);
          dataBuf = padded;
        }
        let maskBuf: Buffer | undefined;
        if (rawMaskStr.length > 0) {
          maskBuf = Buffer.from(rawMaskStr, "base64");
          if (size > 0 && maskBuf.length < size) {
            const padded = Buffer.alloc(size);
            maskBuf.copy(padded, 0);
            maskBuf = padded;
          }
        }
        const seg: KnxCodeSegment = {
          kind: currentSegment.kind,
          id: a.Id ?? "",
          name: a.Name,
          size: size || dataBuf.length,
          loadStateMachine: parseIntOpt(a.LoadStateMachine),
          offset: parseIntOpt(a.Offset) ?? 0,
          address: parseIntOpt(a.Address),
          memoryType: a.MemoryType,
          data: dataBuf,
          mask: maskBuf,
        };
        if (app && seg.id) {
          app.codeSegments.set(seg.id, seg);
        }
        currentSegment = null;
        currentSegmentChild = null;
        return;
      }
      if (tag === "ParameterType") {
        currentParamType = null;
        currentRestrictionEnums = null;
        return;
      }
      if (tag === "Parameter") {
        currentParam = null;
        return;
      }
      if (tag === "Union") {
        currentUnion = null;
        return;
      }
      if (tag === "LRTransformation" && currentCalc) {
        const code = calcTextChunks.join("").trim();
        if (code) currentCalc.lrTransformation = code;
        currentCalcSection = null;
        calcTextChunks = [];
        return;
      }
      if (tag === "RLTransformation" && currentCalc) {
        const code = calcTextChunks.join("").trim();
        if (code) currentCalc.rlTransformation = code;
        currentCalcSection = null;
        calcTextChunks = [];
        return;
      }
      if (tag === "LParameters" || tag === "RParameters") {
        currentCalcSection = null;
        return;
      }
      if (tag === "ParameterCalculation") {
        currentCalc = null;
        currentCalcSection = null;
        return;
      }
      if (tag === "LoadProcedure") {
        currentLoadProc = null;
        return;
      }
      if (tag === "Script" && inScript) {
        inScript = false;
        const code = scriptChunks.join("").trim();
        if (app && code) {
          app.script = app.script ? `${app.script}\n${code}` : code;
        }
        scriptChunks = [];
      }
    },
  });

  for (const a of apps) {
    a.availableLanguages = [...foundLanguages];
    if (translationsMap && translationsMap.size > 0) {
      if (!a.translations) a.translations = translationsMap;
      a.loadedLanguage = wantedLanguage;
    } else if (wantedLanguage && foundLanguages.includes(wantedLanguage)) {
      a.loadedLanguage = wantedLanguage;
    }
  }

  return apps;
}

/**
 * Streaming loader & parser for official KNX `.knxprod` product database archives.
 */
export class KnxProdParser {
  /**
   * Parses a `.knxprod` archive from disk.
   */
  public static async parseFile(filePath: string, options: KnxProdParseOptions = {}): Promise<ParsedKnxProd> {
    const zip = ZipReader.fromFile(filePath);
    return this.parseZip(zip, path.basename(filePath), options);
  }

  /**
   * Parses a `.knxprod` archive from an in-memory `Buffer`.
   */
  public static async parseBuffer(
    buffer: Buffer,
    options: KnxProdParseOptions = {},
    sourceName?: string,
  ): Promise<ParsedKnxProd> {
    const zip = ZipReader.fromBuffer(buffer);
    return this.parseZip(zip, sourceName, options);
  }

  private static async parseZip(
    zip: ZipReader,
    sourceName: string | undefined,
    options: KnxProdParseOptions,
  ): Promise<ParsedKnxProd> {
    const entries = zip.listEntries();

    // 1. Parse knx_master.xml MaskVersions
    let maskVersions = new Map<string, KnxMaskVersion>();
    const masterEntry = entries.find((e) => e.fileName.toLowerCase() === "knx_master.xml");
    if (masterEntry) {
      maskVersions = parseKnxMasterMaskVersions(zip.readEntryText(masterEntry.fileName));
    }

    // 2. Parse M-xxxx/Hardware.xml
    const hardware: KnxHardwareInfo[] = [];
    for (const entry of entries) {
      if (/(^|\/)Hardware\.xml$/i.test(entry.fileName)) {
        hardware.push(...parseHardwareXml(zip.readEntryText(entry.fileName)));
      }
    }

    // 3. Stream-parse M-xxxx/M-xxxx_A-*.xml ApplicationPrograms
    const applications: KnxApplicationProgram[] = [];
    for (const entry of entries) {
      if (/M-[0-9A-Fa-f]{4}_A-[^/]+\.xml$/i.test(entry.fileName)) {
        const stream = zip.createEntryStream(entry.fileName);
        const parsedApps = await parseApplicationProgramStream(stream, options);
        applications.push(...parsedApps);
      }
    }

    const firstApp = applications[0];
    const mfrRefId =
      firstApp?.manufacturerRefId ??
      entries.map((e) => /(M-[0-9A-Fa-f]{4})\//.exec(e.fileName)?.[1]).find(Boolean) ??
      "M-0000";
    const manufacturerId = firstApp?.manufacturerId ?? parseManufacturerId(mfrRefId);

    return {
      sourceName,
      manufacturerId,
      manufacturerRefId: mfrRefId,
      hardware,
      applications,
      maskVersions,
    };
  }
}
