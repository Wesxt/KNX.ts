import vm from "node:vm";
import { KNXHelper } from "../utils/KNXHelper";
import {
  DeviceApplicationConfig,
  EvaluatedApplicationState,
  EvaluatedModuleInstanceInfo,
  FlagSetting,
  GroupObjectLinkSpec,
  GroupObjectPriority,
  KnxApplicationProgram,
  KnxComObjectDef,
  KnxComObjectRefDef,
  KnxDynamicNode,
  KnxModuleDef,
  KnxParameterCalculationDef,
  KnxParameterDef,
  KnxParameterRefDef,
  KnxParameterType,
  ResolvedComObject,
} from "./types";

/**
 * KNX System B Group Object Value Field Type codes (03_05_01 §4.18.6.2.4.1.4 Table 88).
 */
const OBJECT_SIZE_TO_VALUE_TYPE: Record<string, number> = {
  "1 bit": 0,
  "2 bit": 1,
  "2 bits": 1,
  "3 bit": 2,
  "3 bits": 2,
  "4 bit": 3,
  "4 bits": 3,
  "5 bit": 4,
  "5 bits": 4,
  "6 bit": 5,
  "6 bits": 5,
  "7 bit": 6,
  "7 bits": 6,
  "1 byte": 7,
  "1 octet": 7,
  "2 bytes": 8,
  "2 octets": 8,
  "3 bytes": 9,
  "3 octets": 9,
  "4 bytes": 10,
  "4 octets": 10,
  "6 bytes": 11,
  "6 octets": 11,
  "8 bytes": 12,
  "8 octets": 12,
  "10 bytes": 13,
  "10 octets": 13,
  "14 bytes": 14,
  "14 octets": 14,
  "5 bytes": 15,
  "5 octets": 15,
  "7 bytes": 16,
  "7 octets": 16,
  "9 bytes": 17,
  "9 octets": 17,
  "11 bytes": 18,
  "11 octets": 18,
  "12 bytes": 19,
  "12 octets": 19,
  "13 bytes": 20,
  "13 octets": 20,
};

/**
 * Maps a KNX XML `ObjectSize` string (e.g. `"1 Bit"`, `"4 Bit"`, `"1 Byte"`, `"14 Bytes"`, `"20 Bytes"`)
 * to its System B Group Object Table Value Field Type code (03_05_01 §4.18.6 Table 88).
 */
export function objectSizeToValueTypeCode(objectSize: string): number {
  const normalized = objectSize.trim().toLowerCase();
  const direct = OBJECT_SIZE_TO_VALUE_TYPE[normalized];
  if (direct !== undefined) return direct;

  const byteMatch = /^(\d+)\s*(?:bytes?|octets?)$/.exec(normalized);
  if (byteMatch) {
    const n = parseInt(byteMatch[1], 10);
    if (n >= 15 && n <= 248) return n + 6;
    if (n === 252) return 255;
  }
  const bitMatch = /^(\d+)\s*bits?$/.exec(normalized);
  if (bitMatch) {
    const bits = parseInt(bitMatch[1], 10);
    if (bits >= 1 && bits <= 7) return bits - 1;
    if (bits % 8 === 0) return objectSizeToValueTypeCode(`${bits / 8} Bytes`);
  }
  throw new Error(`Unsupported KNX ComObject ObjectSize: "${objectSize}"`);
}

function tryParseNumeric(val: string): number | null {
  const trimmed = val.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Evaluates a KNX XML `<when test="...">` condition against a parameter value.
 * Supports:
 * - Exact values & numeric equivalence (`"0"`, `"01"`, `"1"`)
 * - Space-separated OR alternatives (`"0 2"`, `"1 4 5 6 7 8"`)
 * - Relational operators (`"!=0"`, `"<10"`, `"<=2"`, `">0"`, `">=1"`, `"=3"`)
 * - Inclusive numeric ranges (`"1..5"`, `"0 3..6"`)
 */
export function matchesWhenTest(rawValue: string, test: string | undefined): boolean {
  if (test === undefined || test.trim() === "") return false;
  const trimmedTest = test.trim();
  const numVal = tryParseNumeric(rawValue);

  const evalSingle = (clause: string): boolean => {
    const relMatch = /^(!=|<=|>=|<|>|=)(.+)$/.exec(clause);
    if (relMatch) {
      const op = relMatch[1];
      const rhsRaw = relMatch[2].trim();
      const rhsNum = tryParseNumeric(rhsRaw);
      if (numVal !== null && rhsNum !== null) {
        switch (op) {
          case "!=":
            return numVal !== rhsNum;
          case "=":
            return numVal === rhsNum;
          case "<":
            return numVal < rhsNum;
          case "<=":
            return numVal <= rhsNum;
          case ">":
            return numVal > rhsNum;
          case ">=":
            return numVal >= rhsNum;
        }
      }
      if (op === "!=") return rawValue.trim() !== rhsRaw;
      if (op === "=") return rawValue.trim() === rhsRaw;
      return false;
    }

    const rangeMatch = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(clause);
    if (rangeMatch && numVal !== null) {
      const lo = Number(rangeMatch[1]);
      const hi = Number(rangeMatch[2]);
      return numVal >= lo && numVal <= hi;
    }

    const rhsNum = tryParseNumeric(clause);
    if (numVal !== null && rhsNum !== null) {
      return numVal === rhsNum;
    }
    return rawValue.trim() === clause;
  };

  // Space-separated clauses are OR-ed per KNX XML schema (Condition_t)
  const clauses = trimmedTest.split(/\s+/).filter(Boolean);
  for (const clause of clauses) {
    if (evalSingle(clause)) return true;
  }
  return false;
}

function normalizeUserParamValue(val: string | number | boolean): string {
  if (typeof val === "boolean") return val ? "1" : "0";
  return String(val);
}

function normalizeGroupAddress(ga: string): string {
  const trimmed = ga.trim();
  if (!KNXHelper.isValidGroupAddress(trimmed)) {
    throw new Error(`Invalid KNX Group Address: "${ga}"`);
  }
  const buf = KNXHelper.GetAddress(trimmed, "/");
  return KNXHelper.GetAddress(buf, "/") as string;
}

function substituteTemplate(text: string, argNames: Map<string, number>): string {
  if (!text.includes("{{")) return text;
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const val = argNames.get(key.trim());
    return val !== undefined ? String(val) : match;
  });
}

function coerceForJs(raw: string, paramType?: KnxParameterType): string | number {
  if (!paramType) {
    const n = tryParseNumeric(raw);
    return n !== null ? n : raw;
  }
  const kind = paramType.detail.kind;
  if (
    kind === "Number" ||
    kind === "Float" ||
    (kind === "Restriction" && paramType.detail.base === "Value") ||
    kind === "Time"
  ) {
    const n = tryParseNumeric(raw);
    return n !== null ? n : 0;
  }
  return raw;
}

function formatFromJs(val: unknown, paramType?: KnxParameterType): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "boolean") return val ? "1" : "0";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "0";
    if (paramType && (paramType.detail.kind === "Number" || paramType.detail.kind === "Restriction")) {
      if (paramType.detail.kind === "Number" && paramType.detail.numberType !== "float") {
        return String(Math.round(val));
      }
      if (paramType.detail.kind === "Restriction") {
        return String(Math.round(val));
      }
    }
    return String(val);
  }
  return String(val);
}

/**
 * Evaluates a KNX `ApplicationProgram`'s `<Dynamic>` tree, `<Module>`/`<Repeat>` templates,
 * `<Assign>` statements, `<ParameterCalculation>` JavaScript transforms, and Group Address bindings.
 */
export class DynamicEvaluator {
  public static evaluate(app: KnxApplicationProgram, config: DeviceApplicationConfig = {}): EvaluatedApplicationState {
    const warnings: string[] = [];

    // Working copies of static definitions (extended when <Module> instances are expanded)
    const allParameters = new Map<string, KnxParameterDef>(app.parameters);
    const allParameterRefs = new Map<string, KnxParameterRefDef>(app.parameterRefs);
    const allComObjects = new Map<string, KnxComObjectDef>(app.comObjects);
    const allComObjectRefs = new Map<string, KnxComObjectRefDef>(app.comObjectRefs);
    const allCalculations: KnxParameterCalculationDef[] = [...app.parameterCalculations];

    // Name -> ParameterDef[] index for friendly user overrides
    const paramsByName = new Map<string, KnxParameterDef[]>();
    const indexParamByName = (p: KnxParameterDef) => {
      let list = paramsByName.get(p.name);
      if (!list) {
        list = [];
        paramsByName.set(p.name, list);
      }
      list.push(p);
    };
    for (const p of allParameters.values()) indexParamByName(p);

    // Parameter ID -> ParameterRef IDs index
    const refsByParamId = new Map<string, string[]>();
    const indexRef = (ref: KnxParameterRefDef) => {
      let list = refsByParamId.get(ref.refId);
      if (!list) {
        list = [];
        refsByParamId.set(ref.refId, list);
      }
      list.push(ref.id);
    };
    for (const ref of allParameterRefs.values()) indexRef(ref);

    // Effective values
    const parameterRefValues = new Map<string, string>();
    const parameterValues = new Map<string, string>();
    const userOverriddenParamIds = new Set<string>();
    const userOverriddenRefIds = new Set<string>();
    const modifiedParameterIds = new Set<string>();

    // 1. Seed defaults
    for (const param of allParameters.values()) {
      parameterValues.set(param.id, param.defaultValue);
    }
    for (const ref of allParameterRefs.values()) {
      const base = allParameters.get(ref.refId);
      parameterRefValues.set(ref.id, ref.value ?? base?.defaultValue ?? "");
    }

    // Helper to apply user overrides against currently known parameters/refs
    const rawOverrides = config.parameters ?? {};
    const matchedOverrideKeys = new Set<string>();
    const etsIdToInternalId = new Map<string, string>();
    const internalIdToEtsId = new Map<string, string>();

    const applyUserOverrides = () => {
      for (const [key, rawVal] of Object.entries(rawOverrides)) {
        const strVal = normalizeUserParamValue(rawVal);
        const mappedKey = etsIdToInternalId.get(key) ?? key;

        // Match ParameterRef ID (direct or via ETS module-instance alias)
        const directRef = allParameterRefs.get(mappedKey);
        if (directRef) {
          parameterRefValues.set(directRef.id, strVal);
          parameterValues.set(directRef.refId, strVal);
          userOverriddenRefIds.add(directRef.id);
          userOverriddenParamIds.add(directRef.refId);
          modifiedParameterIds.add(directRef.refId);
          matchedOverrideKeys.add(key);
          continue;
        }

        // Match Parameter ID
        const directParam = allParameters.get(mappedKey);
        if (directParam) {
          parameterValues.set(directParam.id, strVal);
          userOverriddenParamIds.add(directParam.id);
          modifiedParameterIds.add(directParam.id);
          for (const rId of refsByParamId.get(directParam.id) ?? []) {
            parameterRefValues.set(rId, strVal);
            userOverriddenRefIds.add(rId);
          }
          matchedOverrideKeys.add(key);
          continue;
        }

        // Match Parameter Name
        const namedParams = paramsByName.get(key);
        if (namedParams && namedParams.length > 0) {
          for (const p of namedParams) {
            parameterValues.set(p.id, strVal);
            userOverriddenParamIds.add(p.id);
            modifiedParameterIds.add(p.id);
            for (const rId of refsByParamId.get(p.id) ?? []) {
              parameterRefValues.set(rId, strVal);
              userOverriddenRefIds.add(rId);
            }
          }
          matchedOverrideKeys.add(key);
        }
      }
    };

    applyUserOverrides();

    // 2. Module instantiation cache (for apps with <ModuleDef>, e.g. Zennio CX 1.2, Flat, DALI)
    const allocatorCursors = new Map<string, number>();
    for (const [allocId, alloc] of app.allocators.entries()) {
      allocatorCursors.set(allocId, alloc.start);
    }
    const expandedModules = new Map<string, KnxDynamicNode[]>();
    const instantiatedModules: EvaluatedModuleInstanceInfo[] = [];
    const moduleSeqByModId = new Map<string, number>();
    const appIdPrefix = `${app.id}_`;
    const stripAppPrefix = (id: string) => (id.startsWith(appIdPrefix) ? id.slice(appIdPrefix.length) : id);

    const remapId = (instancePrefix: string, localId: string, modDef: KnxModuleDef): string => {
      if (
        modDef.parameters.has(localId) ||
        modDef.parameterRefs.has(localId) ||
        modDef.comObjects.has(localId) ||
        modDef.comObjectRefs.has(localId)
      ) {
        return `${instancePrefix}_${localId}`;
      }
      return localId;
    };

    const cloneDynamicWithRemap = (
      nodes: KnxDynamicNode[],
      instancePrefix: string,
      modDef: KnxModuleDef,
      argNames: Map<string, number>,
    ): KnxDynamicNode[] => {
      return nodes.map((n): KnxDynamicNode => {
        switch (n.type) {
          case "Container":
            return {
              ...n,
              id: n.id ? `${instancePrefix}_${n.id}` : undefined,
              name: n.name ? substituteTemplate(n.name, argNames) : undefined,
              text: n.text ? substituteTemplate(n.text, argNames) : undefined,
              textParameterRefId: n.textParameterRefId
                ? remapId(instancePrefix, n.textParameterRefId, modDef)
                : undefined,
              children: cloneDynamicWithRemap(n.children, instancePrefix, modDef, argNames),
            };
          case "Separator":
            return {
              ...n,
              id: n.id ? `${instancePrefix}_${n.id}` : undefined,
              text: substituteTemplate(n.text, argNames),
            };
          case "Choose":
            return {
              type: "Choose",
              paramRefId: remapId(instancePrefix, n.paramRefId, modDef),
              whens: n.whens.map((w) => ({
                test: w.test,
                isDefault: w.isDefault,
                children: cloneDynamicWithRemap(w.children, instancePrefix, modDef, argNames),
              })),
            };
          case "ParameterRefRef":
            return {
              type: "ParameterRefRef",
              refId: remapId(instancePrefix, n.refId, modDef),
              indentLevel: n.indentLevel,
            };
          case "ComObjectRefRef":
            return {
              type: "ComObjectRefRef",
              refId: remapId(instancePrefix, n.refId, modDef),
            };
          case "Assign":
            return {
              type: "Assign",
              targetParamRefRef: remapId(instancePrefix, n.targetParamRefRef, modDef),
              sourceParamRefRef: n.sourceParamRefRef ? remapId(instancePrefix, n.sourceParamRefRef, modDef) : undefined,
              value: n.value,
            };
          case "Repeat":
            return {
              ...n,
              id: `${instancePrefix}_${n.id}`,
              parameterRefId: n.parameterRefId ? remapId(instancePrefix, n.parameterRefId, modDef) : undefined,
              children: cloneDynamicWithRemap(n.children, instancePrefix, modDef, argNames),
            };
          case "Module":
            return {
              ...n,
              id: `${instancePrefix}_${n.id}`,
            };
        }
      });
    };

    const expandModule = (
      modNode: Extract<KnxDynamicNode, { type: "Module" }>,
      repeatSuffix: string,
      etsRepeatIndex?: string,
    ): KnxDynamicNode[] => {
      const instanceKey = repeatSuffix ? `${modNode.id}_${repeatSuffix}` : modNode.id;
      const existing = expandedModules.get(instanceKey);
      if (existing) return existing;

      const modDef = app.moduleDefs.get(modNode.refId);
      if (!modDef) {
        warnings.push(`Unknown ModuleDef RefId "${modNode.refId}" referenced by Module "${modNode.id}"`);
        expandedModules.set(instanceKey, []);
        return [];
      }

      const miSeq = (moduleSeqByModId.get(modNode.id) ?? 0) + 1;
      moduleSeqByModId.set(modNode.id, miSeq);
      const etsRefId = stripAppPrefix(modNode.id);
      const etsInstanceId = `${etsRefId}_MI-${miSeq}`;
      const modDefPrefix = `${modDef.id}_`;
      const makeEtsLocalSuffix = (templateId: string) =>
        templateId.startsWith(modDefPrefix) ? templateId.slice(modDefPrefix.length) : stripAppPrefix(templateId);

      const argValuesById = new Map<string, number>();
      const argValuesByName = new Map<string, number>();
      const etsArgs: EvaluatedModuleInstanceInfo["arguments"] = [];

      for (const argDef of modDef.arguments) {
        const provided = modNode.numericArgs.find((na) => na.refId === argDef.id);
        let resolvedVal = argDef.baseValue ?? 0;
        let etsArgVal = String(resolvedVal);
        if (provided) {
          if (provided.value !== undefined) {
            resolvedVal = provided.value;
            etsArgVal = String(resolvedVal);
          } else if (provided.allocatorRefId) {
            const cur = allocatorCursors.get(provided.allocatorRefId) ?? 0;
            resolvedVal = cur;
            allocatorCursors.set(provided.allocatorRefId, cur + (argDef.allocates ?? 1));
            etsArgVal = stripAppPrefix(provided.allocatorRefId);
          }
        }
        argValuesById.set(argDef.id, resolvedVal);
        if (argDef.name) argValuesByName.set(argDef.name, resolvedVal);
        etsArgs.push({ refId: stripAppPrefix(argDef.id), value: etsArgVal, resolvedNumber: resolvedVal });
      }

      instantiatedModules.push({
        instanceKey,
        etsInstanceId,
        etsRefId,
        moduleDefId: modDef.id,
        repeatIndex: etsRepeatIndex || undefined,
        arguments: etsArgs,
      });

      // Instantiate Parameters
      for (const p of modDef.parameters.values()) {
        const newId = `${instanceKey}_${p.id}`;
        const etsShort = `${etsInstanceId}_${makeEtsLocalSuffix(p.id)}`;
        const etsFull = `${appIdPrefix}${etsShort}`;
        etsIdToInternalId.set(etsFull, newId);
        etsIdToInternalId.set(etsShort, newId);
        internalIdToEtsId.set(newId, etsFull);

        const baseOff = p.memory?.baseOffset ? (argValuesById.get(p.memory.baseOffset) ?? 0) : 0;
        const cloned: KnxParameterDef = {
          ...p,
          id: newId,
          name: substituteTemplate(p.name, argValuesByName),
          text: substituteTemplate(p.text, argValuesByName),
          unionId: p.unionId ? `${instanceKey}_${p.unionId}` : undefined,
          memory: p.memory
            ? {
                codeSegment: p.memory.codeSegment,
                offset: p.memory.offset + baseOff,
                bitOffset: p.memory.bitOffset,
              }
            : undefined,
        };
        allParameters.set(newId, cloned);
        parameterValues.set(newId, cloned.defaultValue);
        indexParamByName(cloned);
      }

      // Instantiate ParameterRefs
      for (const r of modDef.parameterRefs.values()) {
        const newId = `${instanceKey}_${r.id}`;
        const etsShort = `${etsInstanceId}_${makeEtsLocalSuffix(r.id)}`;
        const etsFull = `${appIdPrefix}${etsShort}`;
        etsIdToInternalId.set(etsFull, newId);
        etsIdToInternalId.set(etsShort, newId);
        internalIdToEtsId.set(newId, etsFull);

        const newRefId = remapId(instanceKey, r.refId, modDef);
        const cloned: KnxParameterRefDef = {
          ...r,
          id: newId,
          refId: newRefId,
          name: r.name ? substituteTemplate(r.name, argValuesByName) : undefined,
          text: r.text ? substituteTemplate(r.text, argValuesByName) : undefined,
        };
        allParameterRefs.set(newId, cloned);
        indexRef(cloned);
        const baseParam = allParameters.get(newRefId);
        parameterRefValues.set(newId, cloned.value ?? baseParam?.defaultValue ?? "");
      }

      // Instantiate ComObjects
      for (const co of modDef.comObjects.values()) {
        const newId = `${instanceKey}_${co.id}`;
        const etsShort = `${etsInstanceId}_${makeEtsLocalSuffix(co.id)}`;
        const etsFull = `${appIdPrefix}${etsShort}`;
        etsIdToInternalId.set(etsFull, newId);
        etsIdToInternalId.set(etsShort, newId);
        internalIdToEtsId.set(newId, etsShort);

        const baseNum = co.baseNumber ? (argValuesById.get(co.baseNumber) ?? 0) : 0;
        const cloned: KnxComObjectDef = {
          ...co,
          id: newId,
          number: co.number + baseNum,
          name: substituteTemplate(co.name, argValuesByName),
          text: substituteTemplate(co.text, argValuesByName),
          functionText: substituteTemplate(co.functionText, argValuesByName),
          baseNumber: undefined,
        };
        allComObjects.set(newId, cloned);
      }

      // Instantiate ComObjectRefs
      for (const cor of modDef.comObjectRefs.values()) {
        const newId = `${instanceKey}_${cor.id}`;
        const etsShort = `${etsInstanceId}_${makeEtsLocalSuffix(cor.id)}`;
        const etsFull = `${appIdPrefix}${etsShort}`;
        etsIdToInternalId.set(etsFull, newId);
        etsIdToInternalId.set(etsShort, newId);
        internalIdToEtsId.set(newId, etsShort);

        const newRefId = remapId(instanceKey, cor.refId, modDef);
        const cloned: KnxComObjectRefDef = {
          ...cor,
          id: newId,
          refId: newRefId,
          name: cor.name ? substituteTemplate(cor.name, argValuesByName) : undefined,
          text: cor.text ? substituteTemplate(cor.text, argValuesByName) : undefined,
          functionText: cor.functionText ? substituteTemplate(cor.functionText, argValuesByName) : undefined,
          textParameterRefId: cor.textParameterRefId ? remapId(instanceKey, cor.textParameterRefId, modDef) : undefined,
        };
        allComObjectRefs.set(newId, cloned);
      }

      // Instantiate ParameterCalculations
      for (const calc of modDef.parameterCalculations) {
        allCalculations.push({
          ...calc,
          id: `${instanceKey}_${calc.id}`,
          lParameters: calc.lParameters.map((lp) => ({
            ...lp,
            refId: remapId(instanceKey, lp.refId, modDef),
          })),
          rParameters: calc.rParameters.map((rp) => ({
            ...rp,
            refId: remapId(instanceKey, rp.refId, modDef),
          })),
        });
      }

      // Re-apply user overrides in case any target newly instantiated module parameter names
      applyUserOverrides();

      const expandedTree = cloneDynamicWithRemap(modDef.dynamic, instanceKey, modDef, argValuesByName);
      expandedModules.set(instanceKey, expandedTree);
      return expandedTree;
    };

    // Helper to look up a ParameterRef's current effective value
    const getRefValue = (refId: string): string => {
      const v = parameterRefValues.get(refId);
      if (v !== undefined) return v;
      const ref = allParameterRefs.get(refId);
      if (ref) {
        return ref.value ?? parameterValues.get(ref.refId) ?? allParameters.get(ref.refId)?.defaultValue ?? "";
      }
      return parameterValues.get(refId) ?? "";
    };

    // 3. Fixed-point Dynamic traversal + ParameterCalculations
    let activeParameterRefIds = new Set<string>();
    let activeParameterIds = new Set<string>();
    let activeComObjectRefIds: string[] = [];

    const maxPasses = 6;
    for (let pass = 0; pass < maxPasses; pass++) {
      activeParameterRefIds = new Set<string>();
      activeParameterIds = new Set<string>();
      activeComObjectRefIds = [];
      let stateChanged = false;

      const walk = (nodes: KnxDynamicNode[], repeatPrefix: string, etsRepeatTrail: string): void => {
        for (const node of nodes) {
          switch (node.type) {
            case "Container":
              walk(node.children, repeatPrefix, etsRepeatTrail);
              break;
            case "ParameterRefRef": {
              activeParameterRefIds.add(node.refId);
              const ref = allParameterRefs.get(node.refId);
              if (ref) {
                activeParameterIds.add(ref.refId);
                // Sync active ParameterRef's value to its Parameter ID if not overridden by another active ref
                const refVal = parameterRefValues.get(ref.id);
                if (refVal !== undefined) {
                  parameterValues.set(ref.refId, refVal);
                }
              }
              break;
            }
            case "ComObjectRefRef":
              activeComObjectRefIds.push(node.refId);
              break;
            case "Assign": {
              const targetRef = allParameterRefs.get(node.targetParamRefRef);
              const targetParamId = targetRef?.refId;
              // Do not overwrite an explicit user override on this exact target
              if (
                userOverriddenRefIds.has(node.targetParamRefRef) ||
                (targetParamId && userOverriddenParamIds.has(targetParamId))
              ) {
                break;
              }
              const assignedVal = node.sourceParamRefRef ? getRefValue(node.sourceParamRefRef) : (node.value ?? "");
              const prevVal = parameterRefValues.get(node.targetParamRefRef);
              if (prevVal !== assignedVal) {
                parameterRefValues.set(node.targetParamRefRef, assignedVal);
                if (targetParamId) {
                  parameterValues.set(targetParamId, assignedVal);
                  modifiedParameterIds.add(targetParamId);
                }
                stateChanged = true;
              }
              break;
            }
            case "Choose": {
              const testVal = getRefValue(node.paramRefId);
              let matchedAny = false;
              for (const w of node.whens) {
                if (!w.isDefault && matchesWhenTest(testVal, w.test)) {
                  matchedAny = true;
                  walk(w.children, repeatPrefix, etsRepeatTrail);
                }
              }
              if (!matchedAny) {
                for (const w of node.whens) {
                  if (w.isDefault) {
                    walk(w.children, repeatPrefix, etsRepeatTrail);
                  }
                }
              }
              break;
            }
            case "Repeat": {
              let count = node.count ?? 0;
              if (node.parameterRefId) {
                const n = tryParseNumeric(getRefValue(node.parameterRefId));
                count = n !== null ? Math.max(0, Math.floor(n)) : 0;
              }
              const repNumMatch = /(\d+)$/.exec(node.id);
              const repIdNum = repNumMatch ? repNumMatch[1] : node.id;
              for (let idx = 0; idx < count; idx++) {
                const nextPrefix = repeatPrefix ? `${repeatPrefix}_r${idx}` : `r${idx}`;
                const seg = `${repIdNum}x${idx + 1}`;
                const nextEtsTrail = etsRepeatTrail ? `${etsRepeatTrail} ${seg}` : seg;
                walk(node.children, nextPrefix, nextEtsTrail);
              }
              break;
            }
            case "Module": {
              const expanded = expandModule(node, repeatPrefix, etsRepeatTrail);
              walk(expanded, repeatPrefix, etsRepeatTrail);
              break;
            }
            case "Separator":
              break;
          }
        }
      };

      walk(app.dynamic, "", "");

      // Run ParameterCalculations (JS transforms)
      if (config.runParameterCalculations !== false && allCalculations.length > 0) {
        const calcChanged = this.runParameterCalculations(
          app,
          allCalculations,
          allParameters,
          allParameterRefs,
          parameterRefValues,
          parameterValues,
          activeParameterRefIds,
          userOverriddenRefIds,
          userOverriddenParamIds,
          modifiedParameterIds,
          warnings,
        );
        if (calcChanged) stateChanged = true;
      }

      if (!stateChanged) break;
    }

    // Warn about any user parameter keys that never matched any parameter
    for (const key of Object.keys(rawOverrides)) {
      if (!matchedOverrideKeys.has(key)) {
        warnings.push(`Parameter override "${key}" did not match any Parameter Name, ID, or ParameterRef ID`);
      }
    }

    // 4. Resolve active ComObjects & Group Links
    let maxComObjectNumber = 0;
    let hasZeroBasedComObject = false;
    for (const co of allComObjects.values()) {
      if (co.number === 0) hasZeroBasedComObject = true;
      if (co.number > maxComObjectNumber) maxComObjectNumber = co.number;
    }

    const activeComObjects = new Map<number, ResolvedComObject>();
    for (const corId of activeComObjectRefIds) {
      const cor = allComObjectRefs.get(corId);
      if (!cor) continue;
      const co = allComObjects.get(cor.refId);
      if (!co || co.number < 0) continue;

      const objectSize = cor.objectSize ?? co.objectSize;
      let text = cor.text ?? co.text;
      let functionText = cor.functionText ?? co.functionText;

      if (cor.textParameterRefId) {
        const subVal = getRefValue(cor.textParameterRefId);
        const replacePlaceholder = (s: string) =>
          s.replace(/\{\{0(?::([^}]*))?\}\}/g, (_m, fallback: string | undefined) =>
            subVal !== "" ? subVal : (fallback ?? ""),
          );
        text = replacePlaceholder(text);
        functionText = replacePlaceholder(functionText);
      }

      const flagEnabled = (override: FlagSetting | undefined, base: FlagSetting): boolean =>
        (override ?? base) === "Enabled";

      const resolved: ResolvedComObject = {
        number: co.number,
        comObjectId: co.id,
        comObjectRefId: cor.id,
        name: cor.name ?? co.name,
        text,
        functionText,
        objectSize,
        valueTypeCode: objectSizeToValueTypeCode(objectSize),
        datapointType: cor.datapointType ?? co.datapointType,
        priority: (cor.priority ?? co.priority ?? "Low") as GroupObjectPriority,
        flags: {
          communication: flagEnabled(cor.communicationFlag, co.communicationFlag),
          read: flagEnabled(cor.readFlag, co.readFlag),
          write: flagEnabled(cor.writeFlag, co.writeFlag),
          transmit: flagEnabled(cor.transmitFlag, co.transmitFlag),
          update: flagEnabled(cor.updateFlag, co.updateFlag),
          readOnInit: flagEnabled(cor.readOnInitFlag, co.readOnInitFlag),
        },
        groupAddresses: [],
      };

      activeComObjects.set(co.number, resolved);
      if (co.number > maxComObjectNumber) maxComObjectNumber = co.number;
    }

    // Apply user groupLinks (resolving ETS module-instance ComObjectRef aliases automatically)
    const groupLinks = config.groupLinks ?? {};
    for (const [key, spec] of Object.entries(groupLinks)) {
      const mappedKey = etsIdToInternalId.get(key) ?? key;
      const target = this.findComObjectForLink(mappedKey, activeComObjects, allComObjects, allComObjectRefs, warnings);
      if (!target) continue;
      this.applyGroupLink(target, spec);
    }

    return {
      application: app,
      parameterRefValues,
      parameterValues,
      activeParameterRefIds,
      activeParameterIds,
      modifiedParameterIds,
      allParameters,
      allParameterRefs,
      allComObjects,
      allComObjectRefs,
      expandedModules,
      instantiatedModules,
      etsIdToInternalId,
      internalIdToEtsId,
      activeComObjects,
      comObjectNumberBase: hasZeroBasedComObject ? 0 : 1,
      maxComObjectNumber,
      warnings,
    };
  }

  private static findComObjectForLink(
    key: string,
    activeComObjects: Map<number, ResolvedComObject>,
    allComObjects: Map<string, KnxComObjectDef>,
    allComObjectRefs: Map<string, KnxComObjectRefDef>,
    warnings: string[],
  ): ResolvedComObject | undefined {
    // 1. Direct numeric ComObject Number
    if (/^\d+$/.test(key.trim())) {
      const num = parseInt(key.trim(), 10);
      const active = activeComObjects.get(num);
      if (active) return active;

      // Fallback: if the user explicitly links an inactive ComObject by Number, activate it with a warning
      for (const co of allComObjects.values()) {
        if (co.number === num) {
          warnings.push(
            `Group link targets ComObject #${num} ("${co.name}") which was inactive under current parameters; activating it explicitly`,
          );
          const created: ResolvedComObject = {
            number: co.number,
            comObjectId: co.id,
            comObjectRefId: co.id,
            name: co.name,
            text: co.text,
            functionText: co.functionText,
            objectSize: co.objectSize,
            valueTypeCode: objectSizeToValueTypeCode(co.objectSize),
            datapointType: co.datapointType,
            priority: co.priority,
            flags: {
              communication: co.communicationFlag === "Enabled",
              read: co.readFlag === "Enabled",
              write: co.writeFlag === "Enabled",
              transmit: co.transmitFlag === "Enabled",
              update: co.updateFlag === "Enabled",
              readOnInit: co.readOnInitFlag === "Enabled",
            },
            groupAddresses: [],
          };
          activeComObjects.set(num, created);
          return created;
        }
      }
      warnings.push(`Group link key "${key}" did not match any ComObject number`);
      return undefined;
    }

    // 2. Match active ComObjects by Name, ComObjectId, or ComObjectRefId
    for (const co of activeComObjects.values()) {
      if (co.name === key || co.comObjectId === key || co.comObjectRefId === key) {
        return co;
      }
    }

    // 3. Fallback search in static ComObjectRefs / ComObjects
    const cor = allComObjectRefs.get(key);
    if (cor) {
      const co = allComObjects.get(cor.refId);
      if (co) {
        return this.findComObjectForLink(
          String(co.number),
          activeComObjects,
          allComObjects,
          allComObjectRefs,
          warnings,
        );
      }
    }
    for (const co of allComObjects.values()) {
      if (co.name === key || co.id === key) {
        return this.findComObjectForLink(
          String(co.number),
          activeComObjects,
          allComObjects,
          allComObjectRefs,
          warnings,
        );
      }
    }

    warnings.push(`Group link key "${key}" did not match any ComObject`);
    return undefined;
  }

  private static applyGroupLink(target: ResolvedComObject, spec: GroupObjectLinkSpec): void {
    const ordered: string[] = [];
    const addGa = (raw: string) => {
      const normalized = normalizeGroupAddress(raw);
      if (!ordered.includes(normalized)) {
        ordered.push(normalized);
      }
    };

    if (typeof spec === "string") {
      addGa(spec);
      target.sendingGroupAddress = ordered[0];
    } else if (Array.isArray(spec)) {
      for (const ga of spec) addGa(ga);
      target.sendingGroupAddress = ordered[0];
    } else {
      if (spec.sending) {
        addGa(spec.sending);
        target.sendingGroupAddress = ordered[0];
      }
      if (spec.listening) {
        for (const ga of spec.listening) addGa(ga);
      }
      if (!target.sendingGroupAddress && ordered.length > 0) {
        target.sendingGroupAddress = ordered[0];
      }
      if (spec.flags) {
        if (spec.flags.communication !== undefined) target.flags.communication = spec.flags.communication;
        if (spec.flags.read !== undefined) target.flags.read = spec.flags.read;
        if (spec.flags.write !== undefined) target.flags.write = spec.flags.write;
        if (spec.flags.transmit !== undefined) target.flags.transmit = spec.flags.transmit;
        if (spec.flags.update !== undefined) target.flags.update = spec.flags.update;
        if (spec.flags.readOnInit !== undefined) target.flags.readOnInit = spec.flags.readOnInit;
        if (spec.flags.priority !== undefined) target.priority = spec.flags.priority;
      }
      if (spec.security !== undefined) {
        target.security = spec.security;
      }
    }

    target.groupAddresses = ordered;
  }

  private static runParameterCalculations(
    app: KnxApplicationProgram,
    calculations: KnxParameterCalculationDef[],
    allParameters: Map<string, KnxParameterDef>,
    allParameterRefs: Map<string, KnxParameterRefDef>,
    parameterRefValues: Map<string, string>,
    parameterValues: Map<string, string>,
    activeParameterRefIds: Set<string>,
    userOverriddenRefIds: Set<string>,
    userOverriddenParamIds: Set<string>,
    modifiedParameterIds: Set<string>,
    warnings: string[],
  ): boolean {
    let anyChanged = false;

    // Pre-compile shared app <Script> into a sandbox if any calculation uses LRTransformationFunc
    let scriptContext: vm.Context | null = null;
    const needsAppScript = calculations.some((c) => Boolean(c.lrTransformationFunc));
    if (needsAppScript && app.script) {
      try {
        scriptContext = vm.createContext({
          Math,
          Number,
          String,
          Boolean,
          Array,
          Object,
          parseInt,
          parseFloat,
          isNaN,
          isFinite,
        });
        vm.runInContext(app.script, scriptContext, { timeout: 300 });
      } catch (err: any) {
        warnings.push(`Failed to initialize application <Script>: ${err?.message ?? err}`);
        scriptContext = null;
      }
    }

    const getParamType = (refId: string): KnxParameterType | undefined => {
      const ref = allParameterRefs.get(refId);
      const p = ref ? allParameters.get(ref.refId) : undefined;
      return p ? app.parameterTypes.get(p.parameterTypeId) : undefined;
    };

    for (const calc of calculations) {
      if (calc.language.toLowerCase() !== "javascript") continue;
      if (!calc.lrTransformation && !calc.lrTransformationFunc) continue;
      if (calc.rParameters.length === 0) continue;

      // Only run calculation if at least one LParameter is active or modified (or if no LParameters exist)
      const shouldRun =
        calc.lParameters.length === 0 ||
        calc.lParameters.some((lp) => {
          if (activeParameterRefIds.has(lp.refId)) return true;
          const ref = allParameterRefs.get(lp.refId);
          return ref ? modifiedParameterIds.has(ref.refId) : false;
        });
      if (!shouldRun) continue;

      try {
        if (calc.lrTransformationFunc && scriptContext) {
          const inputObj: Record<string, unknown> = {};
          for (const lp of calc.lParameters) {
            const raw = parameterRefValues.get(lp.refId) ?? "";
            inputObj[lp.aliasName] = coerceForJs(raw, getParamType(lp.refId));
          }
          const outputObj: Record<string, unknown> = {};
          for (const rp of calc.rParameters) {
            const raw = parameterRefValues.get(rp.refId) ?? "";
            outputObj[rp.aliasName] = coerceForJs(raw, getParamType(rp.refId));
          }
          let paramsArg: unknown = {};
          if (calc.lrTransformationParameters) {
            try {
              paramsArg = vm.runInContext(`(${calc.lrTransformationParameters})`, scriptContext, { timeout: 50 });
            } catch {
              paramsArg = {};
            }
          }
          const fn = (scriptContext as any)[calc.lrTransformationFunc];
          if (typeof fn === "function") {
            fn(inputObj, outputObj, paramsArg);
            for (const rp of calc.rParameters) {
              if (!(rp.aliasName in outputObj)) continue;
              const targetRef = allParameterRefs.get(rp.refId);
              if (userOverriddenRefIds.has(rp.refId) || (targetRef && userOverriddenParamIds.has(targetRef.refId))) {
                continue;
              }
              const nextStr = formatFromJs(outputObj[rp.aliasName], getParamType(rp.refId));
              if (parameterRefValues.get(rp.refId) !== nextStr) {
                parameterRefValues.set(rp.refId, nextStr);
                if (targetRef) {
                  parameterValues.set(targetRef.refId, nextStr);
                  modifiedParameterIds.add(targetRef.refId);
                }
                anyChanged = true;
              }
            }
          }
        } else if (calc.lrTransformation) {
          const sandbox: Record<string, unknown> = {
            Math,
            Number,
            String,
            Boolean,
            Array,
            Object,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
          };
          for (const lp of calc.lParameters) {
            const raw = parameterRefValues.get(lp.refId) ?? "";
            sandbox[lp.aliasName] = coerceForJs(raw, getParamType(lp.refId));
          }
          for (const rp of calc.rParameters) {
            if (!(rp.aliasName in sandbox)) {
              const raw = parameterRefValues.get(rp.refId) ?? "";
              sandbox[rp.aliasName] = coerceForJs(raw, getParamType(rp.refId));
            }
          }
          const ctx = vm.createContext(sandbox);
          vm.runInContext(calc.lrTransformation, ctx, { timeout: 200 });

          for (const rp of calc.rParameters) {
            const targetRef = allParameterRefs.get(rp.refId);
            if (userOverriddenRefIds.has(rp.refId) || (targetRef && userOverriddenParamIds.has(targetRef.refId))) {
              continue;
            }
            const nextStr = formatFromJs(sandbox[rp.aliasName], getParamType(rp.refId));
            if (parameterRefValues.get(rp.refId) !== nextStr) {
              parameterRefValues.set(rp.refId, nextStr);
              if (targetRef) {
                parameterValues.set(targetRef.refId, nextStr);
                modifiedParameterIds.add(targetRef.refId);
              }
              anyChanged = true;
            }
          }
        }
      } catch (err: any) {
        warnings.push(`ParameterCalculation "${calc.name}" (${calc.id}) skipped due to error: ${err?.message ?? err}`);
      }
    }

    return anyChanged;
  }
}
