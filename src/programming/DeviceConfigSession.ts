import { KnxKeyring, normalizeKeyringGroupAddress } from "../security/KnxKeyring";
import { parseKey16 } from "../security/KnxSecureKeys";
import { KNXHelper } from "../utils/KNXHelper";
import { DynamicEvaluator, matchesWhenTest, objectSizeToValueTypeCode } from "./DynamicEvaluator";
import { KNXDeviceProgrammer, KnxProdSource } from "./KNXDeviceProgrammer";
import { LoadProcedureEngine } from "./LoadProcedureEngine";
import { SystemBCompiler } from "./SystemBCompiler";
import {
  CompiledSystemBImage,
  ConfigMutationResult,
  ConfigValidationIssue,
  DeviceApplicationConfig,
  DeviceCatalogSummary,
  DeviceConfigValidationResult,
  DeviceDownloadOptions,
  DeviceDownloadResult,
  DeviceP2PKeySpec,
  DeviceSecurityConfig,
  DeviceUiState,
  DownloadPlan,
  EnsureSecurityKeysOptions,
  EnsureSecurityKeysResult,
  EvaluatedApplicationState,
  ExportSessionToKeyringOptions,
  GroupObjectLinkSpec,
  GroupObjectPriority,
  GroupObjectSecurityMode,
  KnxApplicationProgram,
  KnxDynamicNode,
  KnxParameterDef,
  KnxParameterRefDef,
  KnxParameterType,
  ParameterWidgetType,
  ParsedKnxProd,
  ResolvedComObject,
  SerializedDeviceConfig,
  SerializedDeviceSecurityConfig,
  SerializedGroupObjectLink,
  UiChannelNode,
  UiComObject,
  UiParameterBlockNode,
  UiParameterField,
  UiParameterOption,
  UiSeparatorItem,
} from "./types";

function unwrapSource(source: KnxProdSource): { knxProd?: ParsedKnxProd; app: KnxApplicationProgram } {
  if ("applications" in source) {
    if (source.applications.length === 0) {
      throw new Error("ParsedKnxProd contains no ApplicationProgram entries");
    }
    return { knxProd: source, app: source.applications[0] };
  }
  return { app: source };
}

function isSerializedDeviceConfig(input: unknown): input is SerializedDeviceConfig {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as Partial<SerializedDeviceConfig>).schemaVersion === 1 &&
    typeof (input as Partial<SerializedDeviceConfig>).parameters === "object" &&
    typeof (input as Partial<SerializedDeviceConfig>).groupLinks === "object"
  );
}

function normalizeLinkSpec(spec: GroupObjectLinkSpec): SerializedGroupObjectLink {
  if (typeof spec === "string") {
    return { sending: spec.trim() };
  }
  if (Array.isArray(spec)) {
    const cleaned = spec.map((g) => g.trim()).filter(Boolean);
    return {
      sending: cleaned[0],
      listening: cleaned.length > 1 ? cleaned.slice(1) : undefined,
    };
  }
  return {
    sending: spec.sending?.trim() || undefined,
    listening: spec.listening?.map((g) => g.trim()).filter(Boolean),
    flags: spec.flags ? { ...spec.flags } : undefined,
    security: spec.security,
  };
}

function normalizeAccess(raw?: string): "ReadWrite" | "Read" | "None" {
  if (raw === "None") return "None";
  if (raw === "Read") return "Read";
  return "ReadWrite";
}

function inferWidget(paramType?: KnxParameterType): ParameterWidgetType {
  if (!paramType) return "text";
  const d = paramType.detail;
  switch (d.kind) {
    case "Restriction":
      return "select";
    case "Number":
      if (d.uiHint === "CheckBox" || (d.sizeInBit === 1 && d.minInclusive === 0 && d.maxInclusive === 1)) {
        return "checkbox";
      }
      return d.numberType === "float" ? "float" : "number";
    case "Float":
      return "float";
    case "Text":
      return "text";
    case "Color":
      return "color";
    case "IPAddress":
      return "ip";
    case "Time":
      return "time";
    case "Picture":
      return "picture";
    case "RawData":
      return "raw";
    case "None":
    default:
      return "none";
  }
}

function keyToHexString(key: Buffer | string): string {
  try {
    return parseKey16(key, "security key").toString("hex").toUpperCase();
  } catch {
    return Buffer.isBuffer(key) ? key.toString("hex").toUpperCase() : String(key);
  }
}

function normalizeTextEncoding(knxEncoding: string): BufferEncoding {
  const lower = knxEncoding.trim().toLowerCase();
  if (lower === "utf-8" || lower === "utf8") return "utf8";
  if (lower === "iso-8859-1" || lower === "latin1" || lower === "windows-1252" || lower === "cp1252") return "latin1";
  if (lower === "utf-16" || lower === "utf-16le") return "utf16le";
  return "latin1";
}

/**
 * Stateful, 100% JSON-serializable KNX Device Parameterization & Commissioning Session API.
 *
 * Designed for external applications (web frontends, REST/WebSocket backends, automation tools)
 * to inspect `.knxprod` catalogs with localized labels, interactively edit parameters / Group Object
 * links / KNX Data Secure settings with live `<Dynamic>` re-evaluation and UI diffs, validate inputs,
 * persist/restore portable JSON configs, and compile or download directly via `KNXDeviceProgrammer`.
 */
export class DeviceConfigSession {
  public readonly knxProd?: ParsedKnxProd;
  public readonly app: KnxApplicationProgram;

  private parameterOverrides = new Map<string, string>();
  private groupLinks = new Map<string, SerializedGroupObjectLink>();
  private securityConfig: DeviceSecurityConfig = {};
  private compileOptions: {
    runParameterCalculations?: boolean;
    associationTableFormat?: 0 | 1;
    clearCommunicationFlagWhenUnlinked?: boolean;
    groupObjectTableSize?: number;
  } = {};

  private evaluated!: EvaluatedApplicationState;
  private cachedUiState: DeviceUiState | null = null;
  private cachedUiStateIncludeAccessNone = false;
  private hasInvalidDraftGroupAddress = false;

  constructor(source: KnxProdSource, initialConfig?: DeviceApplicationConfig | SerializedDeviceConfig) {
    const unwrapped = unwrapSource(source);
    this.knxProd = unwrapped.knxProd;
    this.app = unwrapped.app;

    if (initialConfig) {
      if (isSerializedDeviceConfig(initialConfig)) {
        this.loadSerializedConfig(initialConfig);
      } else {
        this.loadDeviceApplicationConfig(initialConfig);
      }
    }

    this.recompute();
  }

  /**
   * Restores a `DeviceConfigSession` from a serialized JSON object or JSON string created by `toJSON()`.
   */
  public static fromJSON(
    source: KnxProdSource,
    json: SerializedDeviceConfig | string,
    runtimeSecurity?: Partial<Pick<DeviceSecurityConfig, "keyring" | "groupKeys" | "toolKey">>,
  ): DeviceConfigSession {
    const parsed: SerializedDeviceConfig = typeof json === "string" ? JSON.parse(json) : json;
    if (!isSerializedDeviceConfig(parsed)) {
      throw new Error("Invalid SerializedDeviceConfig: expected schemaVersion === 1 with parameters and groupLinks");
    }
    const session = new DeviceConfigSession(source, parsed);
    if (runtimeSecurity) {
      session.setSecurityConfig(runtimeSecurity);
    }
    return session;
  }

  private loadDeviceApplicationConfig(cfg: DeviceApplicationConfig): void {
    if (cfg.parameters) {
      for (const [k, v] of Object.entries(cfg.parameters)) {
        this.parameterOverrides.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
      }
    }
    if (cfg.groupLinks) {
      for (const [k, spec] of Object.entries(cfg.groupLinks)) {
        this.groupLinks.set(String(k), normalizeLinkSpec(spec));
      }
    }
    if (cfg.security) {
      this.securityConfig = {
        ...cfg.security,
        groupKeys: cfg.security.groupKeys ? { ...cfg.security.groupKeys } : undefined,
        groupObjectSecurityModes: cfg.security.groupObjectSecurityModes
          ? { ...cfg.security.groupObjectSecurityModes }
          : undefined,
        authorizedSenders: cfg.security.authorizedSenders ? [...cfg.security.authorizedSenders] : undefined,
        p2pKeys: cfg.security.p2pKeys ? cfg.security.p2pKeys.map((p) => ({ ...p })) : undefined,
      };
    }
    this.compileOptions = {
      runParameterCalculations: cfg.runParameterCalculations,
      associationTableFormat: cfg.associationTableFormat,
      clearCommunicationFlagWhenUnlinked: cfg.clearCommunicationFlagWhenUnlinked,
      groupObjectTableSize: cfg.groupObjectTableSize,
    };
  }

  private loadSerializedConfig(cfg: SerializedDeviceConfig): void {
    if (cfg.applicationId && cfg.applicationId !== this.app.id) {
      throw new Error(
        `SerializedDeviceConfig applicationId "${cfg.applicationId}" does not match loaded application "${this.app.id}"`,
      );
    }
    for (const [k, v] of Object.entries(cfg.parameters ?? {})) {
      this.parameterOverrides.set(k, String(v));
    }
    for (const [k, link] of Object.entries(cfg.groupLinks ?? {})) {
      this.groupLinks.set(k, {
        sending: link.sending,
        listening: link.listening ? [...link.listening] : undefined,
        flags: link.flags ? { ...link.flags } : undefined,
        security: link.security,
      });
    }
    if (cfg.security) {
      this.securityConfig = {
        enabled: cfg.security.enabled,
        groupKeys: cfg.security.groupKeys ? { ...cfg.security.groupKeys } : undefined,
        defaultGroupSecurityMode: cfg.security.defaultGroupSecurityMode,
        groupObjectSecurityModes: cfg.security.groupObjectSecurityModes
          ? { ...cfg.security.groupObjectSecurityModes }
          : undefined,
        authorizedSenders: cfg.security.authorizedSenders?.map((s) => ({
          individualAddress: s.individualAddress,
          lastValidSeqNr: s.lastValidSeqNr !== undefined ? BigInt(s.lastValidSeqNr) : undefined,
        })),
        includeKeyringSenders: cfg.security.includeKeyringSenders,
        p2pKeys: cfg.security.p2pKeys?.map((p) => ({
          individualAddress: p.individualAddress,
          key: p.key,
          roles: p.roles,
        })),
        toolKey: cfg.security.toolKey,
        enableSecurityMode: cfg.security.enableSecurityMode,
        initialSequenceNumberSending:
          cfg.security.initialSequenceNumberSending === "auto"
            ? "auto"
            : cfg.security.initialSequenceNumberSending !== undefined
              ? BigInt(cfg.security.initialSequenceNumberSending)
              : undefined,
        objectInstance: cfg.security.objectInstance,
      };
    }
    if (cfg.options) {
      this.compileOptions = { ...cfg.options };
    }
  }

  private recompute(): void {
    const cfg = this.toDeviceConfig();
    const invalidGaWarnings: string[] = [];
    // Filter malformed draft Group Addresses during live UI evaluation so web apps can display validation errors gracefully
    if (cfg.groupLinks) {
      const safeLinks: Record<string, GroupObjectLinkSpec> = {};
      for (const [k, rawSpec] of Object.entries(cfg.groupLinks)) {
        const spec = normalizeLinkSpec(rawSpec);
        let sending = spec.sending;
        if (sending && !KNXHelper.isValidGroupAddress(sending)) {
          invalidGaWarnings.push(`Invalid KNX Group Address "${sending}" on ComObject "${k}"`);
          sending = undefined;
        }
        const listening: string[] = [];
        for (const ga of spec.listening ?? []) {
          if (!KNXHelper.isValidGroupAddress(ga)) {
            invalidGaWarnings.push(`Invalid KNX Group Address "${ga}" on ComObject "${k}"`);
          } else {
            listening.push(ga);
          }
        }
        safeLinks[k] = {
          ...(sending ? { sending } : {}),
          ...(listening.length > 0 ? { listening } : {}),
          ...(spec.flags ? { flags: spec.flags } : {}),
          ...(spec.security ? { security: spec.security } : {}),
        };
      }
      cfg.groupLinks = safeLinks;
    }

    this.evaluated = DynamicEvaluator.evaluate(this.app, cfg);
    this.hasInvalidDraftGroupAddress = invalidGaWarnings.length > 0;
    if (invalidGaWarnings.length > 0) {
      this.evaluated.warnings.push(...invalidGaWarnings);
    }
    this.cachedUiState = null;
  }

  // ============================================================================
  // Translation & Label Helpers
  // ============================================================================

  private translate(refId: string | undefined, attr: string, fallback: string): string {
    if (!refId || !this.app.translations) return fallback;
    const direct = this.app.translations.get(refId)?.[attr];
    if (direct !== undefined) return direct;
    // Support module-instantiated IDs like "MOD_r0_M-0071_A-..."
    const markerIdx = refId.indexOf("_M-");
    if (markerIdx !== -1) {
      const stripped = refId.slice(markerIdx + 1);
      const fromTemplate = this.app.translations.get(stripped)?.[attr];
      if (fromTemplate !== undefined) return fromTemplate;
    }
    return fallback;
  }

  private applyTextParam(text: string, textParamRefId?: string): string {
    if (!textParamRefId || !text.includes("{{0")) return text;
    const val = this.evaluated.parameterRefValues.get(textParamRefId) ?? "";
    return text.replace(/\{\{0(?::([^}]*))?\}\}/g, (_m, fallback: string | undefined) =>
      val !== "" ? val : (fallback ?? ""),
    );
  }

  // ============================================================================
  // Inspection & UI Tree API (100% JSON-Serializable)
  // ============================================================================

  /**
   * Returns static catalog metadata (product info, supported languages, table capacities, security capabilities).
   */
  public getCatalogSummary(): DeviceCatalogSummary {
    const translatedName = this.translate(this.app.id, "Name", this.app.name);
    const translatedDesc = this.translate(this.app.id, "VisibleDescription", this.app.visibleDescription ?? "");
    return {
      sourceName: this.knxProd?.sourceName,
      applicationId: this.app.id,
      name: translatedName,
      visibleDescription: translatedDesc || undefined,
      manufacturerId: this.app.manufacturerId,
      manufacturerRefId: this.app.manufacturerRefId,
      applicationNumber: this.app.applicationNumber,
      applicationVersion: this.app.applicationVersion,
      maskVersionId: this.app.maskVersionId,
      maskVersion: this.app.maskVersion,
      parameterByteOrder: this.app.options.parameterByteOrder,
      isSecureEnabled: this.app.isSecureEnabled,
      defaultLanguage: this.app.defaultLanguage,
      loadedLanguage: this.app.loadedLanguage,
      availableLanguages: [...this.app.availableLanguages],
      addressTableMaxEntries: this.app.addressTableMaxEntries,
      associationTableMaxEntries: this.app.associationTableMaxEntries,
      maxSecurityGroupKeyTableEntries: this.app.maxSecurityGroupKeyTableEntries,
      maxSecurityIndividualAddressEntries: this.app.maxSecurityIndividualAddressEntries,
      maxSecurityP2PKeyTableEntries: this.app.maxSecurityP2PKeyTableEntries,
      totalParameters: this.evaluated.allParameters.size,
      totalComObjects: this.evaluated.allComObjects.size,
      hardware: (this.knxProd?.hardware ?? []).map((hw) => ({
        id: hw.id,
        name: hw.name,
        serialNumber: hw.serialNumber,
        products: hw.products.map((p) => ({
          id: p.id,
          text: p.text,
          orderNumber: p.orderNumber,
        })),
      })),
    };
  }

  /**
   * Returns the complete, current, JSON-serializable UI state:
   * - Active `channels` -> `blocks` -> visible typed `parameters` & `separators`
   * - Flat list of all visible `parameters`
   * - Active `comObjects` with translated labels, flags, Group Address links, and Data Secure levels
   * - Security summary and live counts/warnings
   */
  public getUiState(options: { includeAccessNone?: boolean } = {}): DeviceUiState {
    const includeAccessNone = options.includeAccessNone ?? false;
    if (this.cachedUiState && this.cachedUiStateIncludeAccessNone === includeAccessNone) {
      return this.cachedUiState;
    }

    const channels: UiChannelNode[] = [];
    const flatParameters: UiParameterField[] = [];
    const seenParamRefIds = new Set<string>();
    let rootChannel: UiChannelNode | null = null;
    let anonCounter = 0;

    const ensureRootChannel = (): UiChannelNode => {
      if (!rootChannel) {
        rootChannel = {
          id: "__root__",
          name: "General",
          label: "General",
          isIndependent: true,
          blocks: [],
          items: [],
        };
        channels.unshift(rootChannel);
      }
      return rootChannel;
    };

    const getRefValue = (refId: string): string => {
      const v = this.evaluated.parameterRefValues.get(refId);
      if (v !== undefined) return v;
      const ref = this.evaluated.allParameterRefs.get(refId);
      if (ref) {
        return (
          ref.value ??
          this.evaluated.parameterValues.get(ref.refId) ??
          this.evaluated.allParameters.get(ref.refId)?.defaultValue ??
          ""
        );
      }
      return this.evaluated.parameterValues.get(refId) ?? "";
    };

    const walkNodes = (
      nodes: KnxDynamicNode[],
      repeatPrefix: string,
      currentChannel: UiChannelNode | null,
      currentBlock: UiParameterBlockNode | null,
    ): void => {
      for (const node of nodes) {
        switch (node.type) {
          case "Container": {
            if (normalizeAccess(node.access) === "None" && !includeAccessNone) {
              continue;
            }
            if (node.tag === "Channel" || node.tag === "ChannelIndependentBlock") {
              const isIndependent = node.tag === "ChannelIndependentBlock";
              const rawName = node.name ?? (isIndependent ? "General" : `Channel ${++anonCounter}`);
              const rawText = node.text ?? rawName;
              const translated = this.applyTextParam(this.translate(node.id, "Text", rawText), node.textParameterRefId);
              const ch: UiChannelNode = {
                id: node.id ?? `ch_${++anonCounter}`,
                name: rawName,
                label: translated || rawName,
                isIndependent,
                blocks: [],
                items: [],
              };
              walkNodes(node.children, repeatPrefix, ch, null);
              if (ch.blocks.length > 0 || ch.items.length > 0) {
                channels.push(ch);
              }
            } else {
              // ParameterBlock / ComObjectParameterBlock
              const targetCh = currentChannel ?? ensureRootChannel();
              const rawName = node.name ?? `Block ${++anonCounter}`;
              const rawText = node.text ?? rawName;
              const translated = this.applyTextParam(this.translate(node.id, "Text", rawText), node.textParameterRefId);
              const blk: UiParameterBlockNode = {
                id: node.id ?? `blk_${++anonCounter}`,
                name: rawName,
                label: translated || rawName,
                items: [],
                blocks: [],
              };
              walkNodes(node.children, repeatPrefix, targetCh, blk);
              if (blk.items.length > 0 || blk.blocks.length > 0) {
                if (currentBlock) {
                  currentBlock.blocks.push(blk);
                } else {
                  targetCh.blocks.push(blk);
                }
              }
            }
            break;
          }

          case "ParameterRefRef": {
            if (seenParamRefIds.has(node.refId)) break;
            const field = this.buildParameterField(
              node.refId,
              node.indentLevel ?? 0,
              currentChannel?.id,
              currentBlock?.id,
            );
            if (!field) break;
            if (field.access === "None" && !includeAccessNone) break;
            seenParamRefIds.add(node.refId);
            flatParameters.push(field);
            if (currentBlock) {
              currentBlock.items.push(field);
            } else {
              (currentChannel ?? ensureRootChannel()).items.push(field);
            }
            break;
          }

          case "Separator": {
            const text = this.translate(node.id, "Text", node.text);
            const sep: UiSeparatorItem = {
              kind: "separator",
              id: node.id,
              text,
              uiHint: node.uiHint,
            };
            if (sep.text || sep.uiHint) {
              if (currentBlock) {
                currentBlock.items.push(sep);
              } else if (currentChannel) {
                currentChannel.items.push(sep);
              }
            }
            break;
          }

          case "Choose": {
            const testVal = getRefValue(node.paramRefId);
            let matchedAny = false;
            for (const w of node.whens) {
              if (!w.isDefault && matchesWhenTest(testVal, w.test)) {
                matchedAny = true;
                walkNodes(w.children, repeatPrefix, currentChannel, currentBlock);
              }
            }
            if (!matchedAny) {
              for (const w of node.whens) {
                if (w.isDefault) {
                  walkNodes(w.children, repeatPrefix, currentChannel, currentBlock);
                }
              }
            }
            break;
          }

          case "Repeat": {
            let count = node.count ?? 0;
            if (node.parameterRefId) {
              const n = Number(getRefValue(node.parameterRefId).trim());
              count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
            }
            for (let idx = 0; idx < count; idx++) {
              const nextPrefix = repeatPrefix ? `${repeatPrefix}_r${idx}` : `r${idx}`;
              walkNodes(node.children, nextPrefix, currentChannel, currentBlock);
            }
            break;
          }

          case "Module": {
            const instanceKey = repeatPrefix ? `${node.id}_${repeatPrefix}` : node.id;
            const expanded = this.evaluated.expandedModules.get(instanceKey);
            if (expanded) {
              walkNodes(expanded, repeatPrefix, currentChannel, currentBlock);
            }
            break;
          }

          case "ComObjectRefRef":
          case "Assign":
            break;
        }
      }
    };

    walkNodes(this.app.dynamic, "", null, null);

    // Build sorted active ComObjects with translated labels & effective security
    const comObjects = this.buildUiComObjects();

    const uniqueGas = new Set<string>();
    let linkedCount = 0;
    let secureGoCount = 0;
    for (const co of comObjects) {
      if (co.groupAddresses.length > 0) linkedCount++;
      for (const ga of co.groupAddresses) uniqueGas.add(ga);
      if (co.effectiveSecurity !== "plain" && co.groupAddresses.length > 0) secureGoCount++;
    }

    const secEnabled = this.isSecurityActive();
    const state: DeviceUiState = {
      catalog: this.getCatalogSummary(),
      channels,
      parameters: flatParameters,
      comObjects,
      security: {
        isSupportedByApplication: this.app.isSecureEnabled,
        enabled: secEnabled,
        defaultGroupSecurityMode: this.securityConfig.defaultGroupSecurityMode ?? "auth_conf",
        configuredGroupKeyCount: Object.keys(this.securityConfig.groupKeys ?? {}).length,
        authorizedSenderCount: this.securityConfig.authorizedSenders?.length ?? 0,
        p2pKeyCount: this.securityConfig.p2pKeys?.length ?? 0,
        hasToolKeyOverride: this.securityConfig.toolKey !== undefined,
        enableSecurityMode: this.securityConfig.enableSecurityMode,
      },
      stats: {
        visibleParameters: flatParameters.length,
        modifiedParameters: flatParameters.filter((p) => p.isModified).length,
        activeComObjects: comObjects.length,
        linkedComObjects: linkedCount,
        uniqueGroupAddresses: uniqueGas.size,
        secureGroupObjects: secureGoCount,
      },
      warnings: [...this.evaluated.warnings],
    };

    this.cachedUiState = state;
    this.cachedUiStateIncludeAccessNone = includeAccessNone;
    return state;
  }

  private buildParameterField(
    paramRefId: string,
    indentLevel: number,
    channelId?: string,
    blockId?: string,
  ): UiParameterField | null {
    const ref = this.evaluated.allParameterRefs.get(paramRefId);
    const param = ref ? this.evaluated.allParameters.get(ref.refId) : this.evaluated.allParameters.get(paramRefId);
    if (!param) return null;

    const paramType = this.app.parameterTypes.get(param.parameterTypeId);
    const access = normalizeAccess(ref?.access ?? param.access);
    const defaultValue = ref?.value ?? param.defaultValue;
    const value =
      (ref ? this.evaluated.parameterRefValues.get(ref.id) : undefined) ??
      this.evaluated.parameterValues.get(param.id) ??
      defaultValue;

    const fallbackLabel = ref?.text ?? param.text ?? ref?.name ?? param.name;
    const label = this.translate(ref?.id, "Text", this.translate(param.id, "Text", fallbackLabel));

    const fallbackSuffix = ref?.suffixText ?? param.suffixText;
    const suffixText = fallbackSuffix
      ? this.translate(ref?.id, "SuffixText", this.translate(param.id, "SuffixText", fallbackSuffix))
      : undefined;

    const widget = inferWidget(paramType);
    const detail = paramType?.detail;

    let options: UiParameterOption[] | undefined;
    let sizeInBit: number | undefined;
    let numberType: "unsignedInt" | "signedInt" | "float" | undefined;
    let floatEncoding: string | undefined;
    let min: number | undefined;
    let max: number | undefined;
    let maxByteLength: number | undefined;
    let pattern: string | undefined;
    let unit: string | undefined;
    let colorSpace: string | undefined;
    let ipVersion: string | undefined;

    if (detail) {
      switch (detail.kind) {
        case "Restriction":
          sizeInBit = detail.sizeInBit;
          options = detail.enumerations.map((e) => ({
            id: e.id,
            value: e.value,
            label: this.translate(e.id, "Text", e.text),
            isBinary: detail.base === "BinaryValue" ? true : undefined,
          }));
          break;
        case "Number":
          sizeInBit = detail.sizeInBit;
          numberType = detail.numberType;
          min = detail.minInclusive;
          max = detail.maxInclusive;
          break;
        case "Float":
          sizeInBit = detail.sizeInBit;
          floatEncoding = detail.encoding;
          min = detail.minInclusive;
          max = detail.maxInclusive;
          break;
        case "Text":
          sizeInBit = detail.sizeInBit;
          maxByteLength = Math.ceil(detail.sizeInBit / 8);
          pattern = detail.pattern;
          break;
        case "Time":
          sizeInBit = detail.sizeInBit;
          unit = detail.unit;
          break;
        case "Color":
          sizeInBit = detail.sizeInBit;
          colorSpace = detail.space;
          break;
        case "IPAddress":
          sizeInBit = detail.sizeInBit;
          ipVersion = detail.version;
          break;
        case "RawData":
          maxByteLength = detail.maxSize;
          break;
      }
    }

    return {
      kind: "parameter",
      paramId: param.id,
      paramRefId: ref?.id ?? param.id,
      name: ref?.name ?? param.name,
      label,
      suffixText,
      access,
      readOnly: access !== "ReadWrite",
      widget,
      typeKind: detail?.kind ?? "None",
      sizeInBit,
      numberType,
      floatEncoding,
      min,
      max,
      maxByteLength,
      pattern,
      unit,
      colorSpace,
      ipVersion,
      options,
      indentLevel,
      value,
      defaultValue,
      isModified: value !== defaultValue || this.evaluated.modifiedParameterIds.has(param.id),
      channelId,
      blockId,
    };
  }

  private buildUiComObjects(): UiComObject[] {
    const sortedNums = Array.from(this.evaluated.activeComObjects.keys()).sort((a, b) => a - b);
    const result: UiComObject[] = [];

    for (const num of sortedNums) {
      const co = this.evaluated.activeComObjects.get(num)!;
      result.push(this.toUiComObject(co));
    }
    return result;
  }

  private toUiComObject(co: ResolvedComObject): UiComObject {
    const cor = this.evaluated.allComObjectRefs.get(co.comObjectRefId);
    const rawLabel = this.translate(co.comObjectRefId, "Text", this.translate(co.comObjectId, "Text", co.text));
    const rawFunc = this.translate(
      co.comObjectRefId,
      "FunctionText",
      this.translate(co.comObjectId, "FunctionText", co.functionText),
    );
    const label = this.applyTextParam(rawLabel, cor?.textParameterRefId);
    const functionText = this.applyTextParam(rawFunc, cor?.textParameterRefId);
    const securityOverride = this.getExplicitComObjectSecurity(co);
    const effectiveSecurity = this.computeEffectiveComObjectSecurity(co, securityOverride);

    return {
      number: co.number,
      comObjectId: co.comObjectId,
      comObjectRefId: co.comObjectRefId,
      name: co.name,
      label,
      functionText,
      objectSize: co.objectSize,
      valueTypeCode: co.valueTypeCode,
      datapointType: co.datapointType,
      priority: co.priority,
      flags: { ...co.flags },
      sendingGroupAddress: co.sendingGroupAddress,
      groupAddresses: [...co.groupAddresses],
      securityOverride,
      effectiveSecurity,
    };
  }

  private isSecurityActive(): boolean {
    if (this.securityConfig.enabled === false) return false;
    if (this.securityConfig.enabled === true) return true;
    if (
      this.securityConfig.toolKey !== undefined ||
      this.securityConfig.enableSecurityMode !== undefined ||
      this.securityConfig.initialSequenceNumberSending !== undefined ||
      (this.securityConfig.p2pKeys && this.securityConfig.p2pKeys.length > 0) ||
      (this.securityConfig.authorizedSenders && this.securityConfig.authorizedSenders.length > 0)
    ) {
      return true;
    }
    for (const co of this.evaluated.activeComObjects.values()) {
      if (co.security === "auth_only" || co.security === "auth_conf") return true;
    }
    return false;
  }

  private lookupGroupKey(ga: string, runtimeSecurity?: Partial<DeviceSecurityConfig>): Buffer | undefined {
    const checkRecord = (rec?: Record<string, Buffer | string>): Buffer | undefined => {
      if (!rec) return undefined;
      try {
        const targetInt = normalizeKeyringGroupAddress(ga).intValue;
        for (const [k, v] of Object.entries(rec)) {
          try {
            if (normalizeKeyringGroupAddress(k).intValue === targetInt) {
              return parseKey16(v, `groupKeys[${k}]`);
            }
          } catch {
            // ignore malformed
          }
        }
      } catch {
        // ignore malformed
      }
      return undefined;
    };

    const fromRuntime = checkRecord(runtimeSecurity?.groupKeys);
    if (fromRuntime) return fromRuntime;
    const fromSession = checkRecord(this.securityConfig.groupKeys);
    if (fromSession) return fromSession;
    const kr = runtimeSecurity?.keyring ?? this.securityConfig.keyring;
    return kr?.getGroupKey(ga);
  }

  private getExplicitComObjectSecurity(co: ResolvedComObject): GroupObjectSecurityMode | undefined {
    const overrides = this.securityConfig.groupObjectSecurityModes ?? {};
    return (
      co.security ??
      overrides[co.number] ??
      overrides[String(co.number)] ??
      overrides[co.name] ??
      overrides[co.comObjectId] ??
      overrides[co.comObjectRefId]
    );
  }

  private computeEffectiveComObjectSecurity(
    co: ResolvedComObject,
    explicit?: GroupObjectSecurityMode,
    runtimeSecurity?: Partial<DeviceSecurityConfig>,
  ): GroupObjectSecurityMode {
    if (co.groupAddresses.length === 0) return "plain";
    if (explicit !== undefined) return explicit;
    if (!this.isSecurityActive() && !runtimeSecurity?.enabled) return "plain";
    const hasKey = co.groupAddresses.some((ga) => this.lookupGroupKey(ga, runtimeSecurity) !== undefined);
    if (!hasKey) return "plain";
    return runtimeSecurity?.defaultGroupSecurityMode ?? this.securityConfig.defaultGroupSecurityMode ?? "auth_conf";
  }

  /**
   * Returns a single parameter by Name, Parameter ID, or ParameterRef ID.
   */
  public getParameter(key: string): UiParameterField | undefined {
    const state = this.getUiState({ includeAccessNone: true });
    const visible = state.parameters.find((p) => p.paramRefId === key || p.paramId === key || p.name === key);
    if (visible) return visible;

    const ref = this.evaluated.allParameterRefs.get(key);
    if (ref) return this.buildParameterField(ref.id, 0) ?? undefined;
    const param = this.evaluated.allParameters.get(key);
    if (param) return this.buildParameterField(param.id, 0) ?? undefined;
    for (const p of this.evaluated.allParameters.values()) {
      if (p.name === key) return this.buildParameterField(p.id, 0) ?? undefined;
    }
    return undefined;
  }

  /**
   * Searches parameters by label, name, or ID (ideal for search bars in large 15k+ parameter catalogs).
   */
  public findParameters(query: string, options: { onlyVisible?: boolean; limit?: number } = {}): UiParameterField[] {
    const q = query.trim().toLowerCase();
    const onlyVisible = options.onlyVisible ?? true;
    const limit = options.limit ?? 50;
    const results: UiParameterField[] = [];

    if (onlyVisible) {
      const state = this.getUiState();
      for (const p of state.parameters) {
        if (
          !q ||
          p.label.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.paramId.toLowerCase().includes(q) ||
          p.paramRefId.toLowerCase().includes(q)
        ) {
          results.push(p);
          if (results.length >= limit) break;
        }
      }
      return results;
    }

    for (const param of this.evaluated.allParameters.values()) {
      const label = this.translate(param.id, "Text", param.text);
      if (
        !q ||
        label.toLowerCase().includes(q) ||
        param.name.toLowerCase().includes(q) ||
        param.id.toLowerCase().includes(q)
      ) {
        const field = this.buildParameterField(param.id, 0);
        if (field) {
          results.push(field);
          if (results.length >= limit) break;
        }
      }
    }
    return results;
  }

  /**
   * Returns a single active Communication Object by Number, Name, ComObject ID, or ComObjectRef ID.
   */
  public getComObject(target: string | number): UiComObject | undefined {
    const state = this.getUiState();
    const keyStr = String(target).trim();
    if (/^\d+$/.test(keyStr)) {
      const num = parseInt(keyStr, 10);
      return state.comObjects.find((c) => c.number === num);
    }
    return state.comObjects.find((c) => c.name === keyStr || c.comObjectId === keyStr || c.comObjectRefId === keyStr);
  }

  /**
   * Searches Communication Objects by label, functionText, name, number, or linked Group Address.
   */
  public findComObjects(query: string, options: { onlyActive?: boolean; limit?: number } = {}): UiComObject[] {
    const q = query.trim().toLowerCase();
    const onlyActive = options.onlyActive ?? true;
    const limit = options.limit ?? 100;
    const results: UiComObject[] = [];

    if (onlyActive) {
      for (const co of this.getUiState().comObjects) {
        if (
          !q ||
          co.label.toLowerCase().includes(q) ||
          co.functionText.toLowerCase().includes(q) ||
          co.name.toLowerCase().includes(q) ||
          String(co.number) === q ||
          co.groupAddresses.some((ga) => ga.toLowerCase().includes(q))
        ) {
          results.push(co);
          if (results.length >= limit) break;
        }
      }
      return results;
    }

    for (const co of this.evaluated.allComObjects.values()) {
      const active = this.evaluated.activeComObjects.get(co.number);
      const ui: UiComObject = active
        ? this.toUiComObject(active)
        : {
            number: co.number,
            comObjectId: co.id,
            comObjectRefId: co.id,
            name: co.name,
            label: this.translate(co.id, "Text", co.text),
            functionText: this.translate(co.id, "FunctionText", co.functionText),
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
            effectiveSecurity: "plain",
          };
      if (
        !q ||
        ui.label.toLowerCase().includes(q) ||
        ui.functionText.toLowerCase().includes(q) ||
        ui.name.toLowerCase().includes(q) ||
        String(ui.number) === q
      ) {
        results.push(ui);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  public getEvaluatedState(): EvaluatedApplicationState {
    return this.evaluated;
  }

  // ============================================================================
  // Interactive Mutations with Live `<Dynamic>` Re-Evaluation & UI Diffs
  // ============================================================================

  private runMutation(mutate: () => boolean): ConfigMutationResult {
    const prevUi = this.getUiState();
    const prevParamKeys = new Set(prevUi.parameters.map((p) => p.paramRefId));
    const prevComNums = new Set(prevUi.comObjects.map((c) => c.number));

    const changed = mutate();
    this.recompute();

    const nextUi = this.getUiState();
    const nextParamKeys = new Set(nextUi.parameters.map((p) => p.paramRefId));
    const nextComNums = new Set(nextUi.comObjects.map((c) => c.number));

    const addedParameters = Array.from(nextParamKeys).filter((id) => !prevParamKeys.has(id));
    const removedParameters = Array.from(prevParamKeys).filter((id) => !nextParamKeys.has(id));
    const addedComObjects = Array.from(nextComNums)
      .filter((n) => !prevComNums.has(n))
      .sort((a, b) => a - b);
    const removedComObjects = Array.from(prevComNums)
      .filter((n) => !nextComNums.has(n))
      .sort((a, b) => a - b);

    return {
      changed:
        changed ||
        addedParameters.length > 0 ||
        removedParameters.length > 0 ||
        addedComObjects.length > 0 ||
        removedComObjects.length > 0,
      addedParameters,
      removedParameters,
      addedComObjects,
      removedComObjects,
      warnings: [...nextUi.warnings],
      state: nextUi,
    };
  }

  private resolveParameterAliases(key: string): {
    canonicalKey: string;
    relatedKeys: string[];
    param?: KnxParameterDef;
    ref?: KnxParameterRefDef;
  } {
    const directRef = this.evaluated.allParameterRefs.get(key);
    if (directRef) {
      const param = this.evaluated.allParameters.get(directRef.refId);
      const related = [directRef.id];
      if (param) {
        related.push(param.id, param.name);
      }
      return { canonicalKey: directRef.id, relatedKeys: related, param, ref: directRef };
    }

    const directParam = this.evaluated.allParameters.get(key);
    if (directParam) {
      const related = [directParam.id, directParam.name];
      for (const r of this.evaluated.allParameterRefs.values()) {
        if (r.refId === directParam.id) related.push(r.id);
      }
      return { canonicalKey: directParam.id, relatedKeys: related, param: directParam };
    }

    // Search by Name
    const matchedParams: KnxParameterDef[] = [];
    for (const p of this.evaluated.allParameters.values()) {
      if (p.name === key) matchedParams.push(p);
    }
    if (matchedParams.length === 1) {
      const p = matchedParams[0];
      const related = [p.id, p.name];
      for (const r of this.evaluated.allParameterRefs.values()) {
        if (r.refId === p.id) related.push(r.id);
      }
      return { canonicalKey: p.name, relatedKeys: related, param: p };
    }

    return { canonicalKey: key, relatedKeys: [key] };
  }

  private applySingleParameterOverride(key: string, value: string | number | boolean): boolean {
    const strVal = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    const { canonicalKey, relatedKeys } = this.resolveParameterAliases(key);
    const prevVal = this.parameterOverrides.get(canonicalKey);
    for (const alias of relatedKeys) {
      if (alias !== canonicalKey) {
        this.parameterOverrides.delete(alias);
      }
    }
    this.parameterOverrides.set(canonicalKey, strVal);
    return prevVal !== strVal;
  }

  /**
   * Updates a single parameter (by `paramRefId`, `paramId`, or `name`), re-evaluates `<Dynamic>`
   * & `<ParameterCalculation>`, and returns the new UI state + added/removed parameter & ComObject diffs.
   */
  public setParameter(key: string, value: string | number | boolean): ConfigMutationResult {
    return this.runMutation(() => this.applySingleParameterOverride(key, value));
  }

  /**
   * Batch-updates multiple parameters in a single `<Dynamic>` re-evaluation pass.
   */
  public setParameters(patch: Record<string, string | number | boolean>): ConfigMutationResult {
    return this.runMutation(() => {
      let anyChanged = false;
      for (const [k, v] of Object.entries(patch)) {
        if (this.applySingleParameterOverride(k, v)) {
          anyChanged = true;
        }
      }
      return anyChanged;
    });
  }

  /**
   * Resets a single parameter back to its catalog default value.
   */
  public resetParameter(key: string): ConfigMutationResult {
    return this.runMutation(() => {
      const { relatedKeys } = this.resolveParameterAliases(key);
      let deleted = false;
      for (const alias of relatedKeys) {
        if (this.parameterOverrides.delete(alias)) deleted = true;
      }
      return deleted;
    });
  }

  /**
   * Resets all parameter overrides back to catalog defaults.
   */
  public resetAllParameters(): ConfigMutationResult {
    return this.runMutation(() => {
      const hadAny = this.parameterOverrides.size > 0;
      this.parameterOverrides.clear();
      return hadAny;
    });
  }

  private canonicalComObjectKey(target: string | number): string {
    const keyStr = String(target).trim();
    if (/^\d+$/.test(keyStr)) return keyStr;
    const found = this.getComObject(keyStr);
    if (found) return String(found.number);
    for (const co of this.evaluated.allComObjects.values()) {
      if (co.name === keyStr || co.id === keyStr) return String(co.number);
    }
    const cor = this.evaluated.allComObjectRefs.get(keyStr);
    if (cor) {
      const co = this.evaluated.allComObjects.get(cor.refId);
      if (co) return String(co.number);
    }
    return keyStr;
  }

  /**
   * Links a Communication Object (by 1-based Number, Name, Id, or RefId) to one or more Group Addresses,
   * optionally setting flag overrides and KNX Data Secure protection mode.
   */
  public linkGroupObject(target: string | number, spec: GroupObjectLinkSpec): ConfigMutationResult {
    return this.runMutation(() => {
      const key = this.canonicalComObjectKey(target);
      const existing = this.groupLinks.get(key);
      const next = normalizeLinkSpec(spec);
      // Preserve previously set flags/security if caller passed simple string/array shorthand
      if (typeof spec === "string" || Array.isArray(spec)) {
        if (existing?.flags) next.flags = { ...existing.flags };
        if (existing?.security) next.security = existing.security;
      }
      this.groupLinks.set(key, next);
      return true;
    });
  }

  /**
   * Removes Group Address bindings for a Communication Object.
   */
  public unlinkGroupObject(target: string | number): ConfigMutationResult {
    return this.runMutation(() => {
      const key = this.canonicalComObjectKey(target);
      const deletedCanonical = this.groupLinks.delete(key);
      const deletedRaw = this.groupLinks.delete(String(target));
      return deletedCanonical || deletedRaw;
    });
  }

  /**
   * Overrides individual Communication Object flags (C, R, W, T, U, I, Priority).
   */
  public setGroupObjectFlags(
    target: string | number,
    flags: Partial<{
      communication: boolean;
      read: boolean;
      write: boolean;
      transmit: boolean;
      update: boolean;
      readOnInit: boolean;
      priority: GroupObjectPriority;
    }>,
  ): ConfigMutationResult {
    return this.runMutation(() => {
      const key = this.canonicalComObjectKey(target);
      const current = this.groupLinks.get(key) ?? {};
      this.groupLinks.set(key, {
        ...current,
        flags: { ...(current.flags ?? {}), ...flags },
      });
      return true;
    });
  }

  /**
   * Sets or clears the KNX Data Secure protection level (`"plain" | "auth_only" | "auth_conf"`)
   * for a specific Communication Object (`PID_GO_SECURITY_FLAGS`).
   */
  public setGroupObjectSecurity(
    target: string | number,
    mode: GroupObjectSecurityMode | undefined,
  ): ConfigMutationResult {
    return this.runMutation(() => {
      const key = this.canonicalComObjectKey(target);
      const current = this.groupLinks.get(key) ?? {};
      if (mode === undefined) {
        delete current.security;
        if (this.securityConfig.groupObjectSecurityModes) {
          delete this.securityConfig.groupObjectSecurityModes[key];
          delete this.securityConfig.groupObjectSecurityModes[String(target)];
        }
      } else {
        current.security = mode;
      }
      this.groupLinks.set(key, current);
      return true;
    });
  }

  /**
   * Merges updates into the KNX Data Secure commissioning configuration (`Object 17`).
   */
  public setSecurityConfig(patch: Partial<DeviceSecurityConfig>): ConfigMutationResult {
    return this.runMutation(() => {
      this.securityConfig = {
        ...this.securityConfig,
        ...patch,
        groupKeys:
          patch.groupKeys !== undefined
            ? { ...(this.securityConfig.groupKeys ?? {}), ...patch.groupKeys }
            : this.securityConfig.groupKeys,
        groupObjectSecurityModes:
          patch.groupObjectSecurityModes !== undefined
            ? { ...(this.securityConfig.groupObjectSecurityModes ?? {}), ...patch.groupObjectSecurityModes }
            : this.securityConfig.groupObjectSecurityModes,
      };
      return true;
    });
  }

  /**
   * Attaches or clears an ETS `.knxkeys` `KnxKeyring` for automatic Group Key & sender resolution.
   */
  public setKeyring(keyring: KnxKeyring | undefined): ConfigMutationResult {
    return this.runMutation(() => {
      this.securityConfig = { ...this.securityConfig, keyring };
      return true;
    });
  }

  /**
   * Automatically generates cryptographically secure 16-byte AES-128 keys for all active linked
   * Communication Objects whose security mode is not `"plain"` and that do not yet have a Group Key
   * in either the session or the supplied/attached `KnxKeyring`.
   *
   * Ideal for autonomous commissioning workflows without ETS:
   * - If `options.keyring` is provided, generated keys are written into that keyring and the keyring
   *   is attached to the session if none was attached yet.
   * - If no `options.keyring` is provided, generated keys are stored in `session.security.groupKeys`.
   */
  public ensureSecurityKeys(options: EnsureSecurityKeysOptions = {}): EnsureSecurityKeysResult {
    const enableSecurity = options.enableSecurity ?? true;
    const generateMissingGroupKeys = options.generateMissingGroupKeys ?? true;
    const generateToolKey = options.generateToolKey ?? false;
    const targetKeyring = options.keyring ?? this.securityConfig.keyring;
    const storeInSession = options.storeInSession ?? !targetKeyring;

    const generatedGroupKeys: Record<string, string> = {};
    let generatedToolKey: string | undefined;

    const mutation = this.runMutation(() => {
      let changed = false;

      if (enableSecurity && this.securityConfig.enabled !== true) {
        this.securityConfig = { ...this.securityConfig, enabled: true };
        changed = true;
      }

      if (options.keyring && this.securityConfig.keyring !== options.keyring) {
        this.securityConfig = { ...this.securityConfig, keyring: options.keyring };
        changed = true;
      }

      if (generateToolKey && this.securityConfig.toolKey === undefined) {
        const tk = KnxKeyring.generateKey();
        generatedToolKey = tk.toString("hex").toUpperCase();
        this.securityConfig = { ...this.securityConfig, toolKey: generatedToolKey };
        changed = true;
      }

      if (generateMissingGroupKeys) {
        const defaultMode = this.securityConfig.defaultGroupSecurityMode ?? "auth_conf";
        const nextGroupKeys: Record<string, Buffer | string> = { ...(this.securityConfig.groupKeys ?? {}) };
        let addedAnyGroupKey = false;

        for (const co of this.evaluated.activeComObjects.values()) {
          if (co.groupAddresses.length === 0) continue;
          const explicit = this.getExplicitComObjectSecurity(co);
          const effective = explicit ?? defaultMode;
          if (effective === "plain") continue;

          for (const ga of co.groupAddresses) {
            if (!KNXHelper.isValidGroupAddress(ga)) continue;
            const normGa = normalizeKeyringGroupAddress(ga).formatted;
            const existing = this.lookupGroupKey(normGa, targetKeyring ? { keyring: targetKeyring } : undefined);
            if (existing) continue;

            const keyBuf = KnxKeyring.generateKey();
            const keyHex = keyBuf.toString("hex").toUpperCase();
            generatedGroupKeys[normGa] = keyHex;

            if (targetKeyring) {
              targetKeyring.setGroupKey(normGa, keyBuf);
            }
            if (storeInSession) {
              nextGroupKeys[normGa] = keyHex;
              addedAnyGroupKey = true;
            }
            changed = true;
          }
        }

        if (addedAnyGroupKey) {
          this.securityConfig = { ...this.securityConfig, groupKeys: nextGroupKeys };
        }
      }

      return changed;
    });

    return {
      generatedGroupKeys,
      generatedToolKey,
      mutation,
    };
  }

  /**
   * Exports this device's KNX Data Secure keys (`ToolKey`, Group Keys), metadata (`SerialNumber`, `SequenceNumber`),
   * and optional `<Interface>` group sender links into a {@link KnxKeyring} instance ready to be saved as `.knxkeys`.
   *
   * Pass an existing `options.keyring` to aggregate multiple configured devices into a single project `.knxkeys` file.
   */
  public exportToKeyring(options: ExportSessionToKeyringOptions): KnxKeyring {
    const ia = options.individualAddress.trim();
    if (!KNXHelper.isValidIndividualAddress(ia)) {
      throw new Error(`Invalid KNX Individual Address for exportToKeyring: "${options.individualAddress}"`);
    }

    const target = options.keyring ?? KnxKeyring.create({ project: options.project ?? this.app.name });
    const mergedSec = this.mergeSecurityConfig(options.runtimeSecurity);

    // 1. Export all active secure Group Keys
    const secureGasTransmittedByDevice = new Set<string>();
    const allActiveSecureGas = new Set<string>();

    for (const co of this.evaluated.activeComObjects.values()) {
      if (co.groupAddresses.length === 0) continue;
      const eff = this.computeEffectiveComObjectSecurity(
        co,
        this.getExplicitComObjectSecurity(co),
        options.runtimeSecurity,
      );
      if (eff === "plain") continue;

      for (const ga of co.groupAddresses) {
        if (!KNXHelper.isValidGroupAddress(ga)) continue;
        const normGa = normalizeKeyringGroupAddress(ga).formatted;
        const key =
          this.lookupGroupKey(normGa, options.runtimeSecurity) ??
          target.getGroupKey(normGa) ??
          options.dataSecure?.getGroupKey(normGa);
        if (key) {
          target.setGroupKey(normGa, key);
          allActiveSecureGas.add(normGa);
          if (co.flags.transmit || co.sendingGroupAddress === ga) {
            secureGasTransmittedByDevice.add(normGa);
          }
        }
      }
    }

    // 2. Resolve Device ToolKey, SequenceNumber, and SerialNumber
    const resolvedToolKey =
      options.toolKey ??
      mergedSec.toolKey ??
      options.dataSecure?.getDeviceToolKey(ia) ??
      target.getDeviceToolKey(ia) ??
      mergedSec.keyring?.getDeviceToolKey(ia);

    let resolvedSeq: bigint | number | undefined = options.sequenceNumber;
    if (resolvedSeq === undefined && options.dataSecure) {
      const lastValid = options.dataSecure.getLastValidSequenceNumber(ia);
      if (lastValid !== undefined && lastValid > 0n) {
        resolvedSeq = lastValid < 0xffffffffffffn ? lastValid + 1n : 0xffffffffffffn;
      }
    }
    if (resolvedSeq === undefined && mergedSec.initialSequenceNumberSending !== undefined) {
      if (mergedSec.initialSequenceNumberSending !== "auto") {
        resolvedSeq = mergedSec.initialSequenceNumberSending;
      }
    }

    const resolvedSerial = options.serialNumber ?? options.dataSecure?.getDeviceSerialNumber(ia);

    target.setDevice({
      individualAddress: ia,
      ...(resolvedToolKey !== undefined ? { toolKey: resolvedToolKey } : {}),
      ...(resolvedSeq !== undefined ? { sequenceNumber: resolvedSeq } : {}),
      ...(resolvedSerial !== undefined ? { serialNumber: resolvedSerial } : {}),
      ...(options.managementPassword !== undefined ? { managementPassword: options.managementPassword } : {}),
      ...(options.authentication !== undefined ? { authentication: options.authentication } : {}),
      merge: true,
    });

    // 3. Optionally populate <Interface> entry and <Group Address="..." Senders="..." />
    if (options.interfaceAddress) {
      const ifaceIa = options.interfaceAddress.trim();
      target.setInterface({
        individualAddress: ifaceIa,
        type: options.interfaceType ?? "Tunnelling",
        ...(options.interfaceHost !== undefined ? { host: options.interfaceHost } : {}),
        ...(options.interfaceUserId !== undefined ? { userId: options.interfaceUserId } : {}),
        ...(options.interfacePassword !== undefined ? { password: options.interfacePassword } : {}),
        ...(options.interfaceAuthentication !== undefined ? { authentication: options.interfaceAuthentication } : {}),
        merge: true,
      });

      for (const ga of allActiveSecureGas) {
        const senders: string[] = [];
        if (secureGasTransmittedByDevice.has(ga)) {
          senders.push(ia);
        }
        target.addInterfaceGroupSender(ifaceIa, ga, senders, options.interfaceType ?? "Tunnelling");
      }
    }

    return target;
  }

  /**
   * Updates compiler options (association table format, JS calculations toggle, etc.).
   */
  public setOptions(
    options: Partial<
      Pick<
        DeviceApplicationConfig,
        | "runParameterCalculations"
        | "associationTableFormat"
        | "clearCommunicationFlagWhenUnlinked"
        | "groupObjectTableSize"
      >
    >,
  ): ConfigMutationResult {
    return this.runMutation(() => {
      this.compileOptions = { ...this.compileOptions, ...options };
      return true;
    });
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validates all visible parameter values, Group Address links, table limits, and KNX Data Secure
   * keys/addresses before compilation or device download.
   */
  public validate(runtimeSecurity?: Partial<DeviceSecurityConfig>): DeviceConfigValidationResult {
    const errors: ConfigValidationIssue[] = [];
    const warnings: ConfigValidationIssue[] = [];
    const ui = this.getUiState();

    // 1. Validate visible parameters against their ParameterType definitions
    for (const field of ui.parameters) {
      if (field.readOnly || field.typeKind === "None" || field.typeKind === "Picture") continue;
      const val = field.value;

      if (field.typeKind === "Number" || field.typeKind === "Time") {
        const n = Number(val.trim());
        if (val.trim() === "" || !Number.isFinite(n)) {
          errors.push({
            severity: "error",
            code: "INVALID_NUMBER",
            path: `parameters.${field.name}`,
            message: `Parameter "${field.label}" (${field.name}) requires a numeric value (got "${val}")`,
          });
          continue;
        }
        if (field.typeKind === "Number" && field.numberType !== "float" && !Number.isInteger(n)) {
          errors.push({
            severity: "error",
            code: "INVALID_INTEGER",
            path: `parameters.${field.name}`,
            message: `Parameter "${field.label}" (${field.name}) requires an integer value (got "${val}")`,
          });
        }
        if (field.min !== undefined && n < field.min) {
          errors.push({
            severity: "error",
            code: "VALUE_BELOW_MIN",
            path: `parameters.${field.name}`,
            message: `Parameter "${field.label}" (${field.name}) value ${n} is below minimum ${field.min}`,
          });
        }
        if (field.max !== undefined && n > field.max) {
          errors.push({
            severity: "error",
            code: "VALUE_ABOVE_MAX",
            path: `parameters.${field.name}`,
            message: `Parameter "${field.label}" (${field.name}) value ${n} exceeds maximum ${field.max}`,
          });
        }
      } else if (field.typeKind === "Float") {
        const n = Number(val.trim());
        if (val.trim() === "" || !Number.isFinite(n)) {
          errors.push({
            severity: "error",
            code: "INVALID_FLOAT",
            path: `parameters.${field.name}`,
            message: `Parameter "${field.label}" (${field.name}) requires a floating-point number (got "${val}")`,
          });
          continue;
        }
        if (field.min !== undefined && n < field.min) {
          errors.push({
            severity: "error",
            code: "VALUE_BELOW_MIN",
            path: `parameters.${field.name}`,
            message: `Parameter "${field.label}" (${field.name}) value ${n} is below minimum ${field.min}`,
          });
        }
        if (field.max !== undefined && n > field.max) {
          errors.push({
            severity: "error",
            code: "VALUE_ABOVE_MAX",
            path: `parameters.${field.name}`,
            message: `Parameter "${field.label}" (${field.name}) value ${n} exceeds maximum ${field.max}`,
          });
        }
      } else if (field.typeKind === "Restriction" && field.options && field.options.length > 0) {
        const n = parseInt(val, 10);
        const matched = Number.isFinite(n) && field.options.some((o) => o.value === n);
        if (!matched) {
          errors.push({
            severity: "error",
            code: "INVALID_ENUM_VALUE",
            path: `parameters.${field.name}`,
            message: `Parameter "${field.label}" (${field.name}) value "${val}" is not one of the allowed options`,
          });
        }
      } else if (field.typeKind === "Text") {
        const enc = normalizeTextEncoding(this.app.options.textParameterEncoding);
        const byteLen = Buffer.byteLength(val, enc);
        const maxBytes = field.maxByteLength ?? 0;
        const limit = this.app.options.textParameterZeroTerminate ? Math.max(0, maxBytes - 1) : maxBytes;
        if (maxBytes > 0 && byteLen > limit) {
          errors.push({
            severity: "error",
            code: "TEXT_TOO_LONG",
            path: `parameters.${field.name}`,
            message: `Parameter "${field.label}" (${field.name}) exceeds maximum byte length (${byteLen} > ${limit})`,
          });
        }
        if (field.pattern) {
          try {
            const re = new RegExp(`^(?:${field.pattern})$`);
            if (!re.test(val)) {
              errors.push({
                severity: "error",
                code: "PATTERN_MISMATCH",
                path: `parameters.${field.name}`,
                message: `Parameter "${field.label}" (${field.name}) value "${val}" does not match pattern /${field.pattern}/`,
              });
            }
          } catch {
            // Ignore non-JS regex patterns
          }
        }
      }
    }

    // 2. Validate Group Links & Table Capacities
    const uniqueGas = new Set<string>();
    let totalAssociations = 0;

    for (const [key, link] of this.groupLinks.entries()) {
      const gas = [...(link.sending ? [link.sending] : []), ...(link.listening ?? [])];
      for (const ga of gas) {
        if (!KNXHelper.isValidGroupAddress(ga)) {
          errors.push({
            severity: "error",
            code: "INVALID_GROUP_ADDRESS",
            path: `groupLinks.${key}`,
            message: `Invalid KNX Group Address "${ga}" on ComObject "${key}"`,
          });
        } else {
          const norm = KNXHelper.GetAddress(KNXHelper.GetAddress(ga, "/"), "/") as string;
          uniqueGas.add(norm);
        }
      }
    }

    for (const co of ui.comObjects) {
      totalAssociations += co.groupAddresses.length;
    }

    if (uniqueGas.size > this.app.addressTableMaxEntries) {
      errors.push({
        severity: "error",
        code: "ADDRESS_TABLE_OVERFLOW",
        path: "groupLinks",
        message: `Unique Group Addresses (${uniqueGas.size}) exceed AddressTable MaxEntries (${this.app.addressTableMaxEntries})`,
      });
    }
    if (totalAssociations > this.app.associationTableMaxEntries) {
      errors.push({
        severity: "error",
        code: "ASSOCIATION_TABLE_OVERFLOW",
        path: "groupLinks",
        message: `Group Object associations (${totalAssociations}) exceed AssociationTable MaxEntries (${this.app.associationTableMaxEntries})`,
      });
    }

    // 3. Validate Security Configuration
    const mergedSec = this.mergeSecurityConfig(runtimeSecurity);
    const secActive = this.isSecurityActive() || Boolean(runtimeSecurity?.enabled);

    if (secActive) {
      if (!this.app.isSecureEnabled) {
        warnings.push({
          severity: "warning",
          code: "SECURITY_UNSUPPORTED_BY_APP",
          path: "security",
          message: `Application "${this.app.name}" does not declare IsSecureEnabled="true"`,
        });
      }

      // Validate explicit keys format
      if (mergedSec.groupKeys) {
        for (const [ga, k] of Object.entries(mergedSec.groupKeys)) {
          try {
            parseKey16(k, `security.groupKeys[${ga}]`);
          } catch (err: any) {
            errors.push({
              severity: "error",
              code: "INVALID_SECURITY_KEY",
              path: `security.groupKeys.${ga}`,
              message: err?.message ?? `Invalid 16-byte Group Key for ${ga}`,
            });
          }
        }
      }
      if (mergedSec.toolKey !== undefined) {
        try {
          parseKey16(mergedSec.toolKey, "security.toolKey");
        } catch (err: any) {
          errors.push({
            severity: "error",
            code: "INVALID_SECURITY_KEY",
            path: "security.toolKey",
            message: err?.message ?? "Invalid 16-byte Tool Key",
          });
        }
      }

      // Validate authorized senders & P2P keys
      const senderSet = new Set<string>();
      for (const entry of mergedSec.authorizedSenders ?? []) {
        const ia = typeof entry === "string" ? entry : entry.individualAddress;
        if (!KNXHelper.isValidIndividualAddress(ia)) {
          errors.push({
            severity: "error",
            code: "INVALID_INDIVIDUAL_ADDRESS",
            path: "security.authorizedSenders",
            message: `Invalid Individual Address "${ia}" in security.authorizedSenders`,
          });
        } else {
          senderSet.add(ia);
        }
      }

      for (const p2p of mergedSec.p2pKeys ?? []) {
        if (!KNXHelper.isValidIndividualAddress(p2p.individualAddress)) {
          errors.push({
            severity: "error",
            code: "INVALID_INDIVIDUAL_ADDRESS",
            path: `security.p2pKeys.${p2p.individualAddress}`,
            message: `Invalid Individual Address "${p2p.individualAddress}" in security.p2pKeys`,
          });
        } else {
          senderSet.add(p2p.individualAddress);
        }
        try {
          parseKey16(p2p.key, `security.p2pKeys[${p2p.individualAddress}]`);
        } catch (err: any) {
          errors.push({
            severity: "error",
            code: "INVALID_SECURITY_KEY",
            path: `security.p2pKeys.${p2p.individualAddress}`,
            message: err?.message ?? `Invalid 16-byte P2P key for ${p2p.individualAddress}`,
          });
        }
      }

      // Check every secure ComObject has keys for all its linked GAs
      const usedSecureGas = new Set<string>();
      for (const co of this.evaluated.activeComObjects.values()) {
        if (co.groupAddresses.length === 0) continue;
        const eff = this.computeEffectiveComObjectSecurity(co, this.getExplicitComObjectSecurity(co), runtimeSecurity);
        if (eff === "plain") continue;

        for (const ga of co.groupAddresses) {
          const key = this.lookupGroupKey(ga, runtimeSecurity);
          if (!key) {
            errors.push({
              severity: "error",
              code: "MISSING_GROUP_KEY",
              path: `comObjects.${co.number}`,
              message: `Secure ComObject #${co.number} ("${co.name}") is linked to Group Address ${ga} without a Group Key`,
            });
          } else {
            usedSecureGas.add(ga);
            if (mergedSec.keyring && mergedSec.includeKeyringSenders !== false) {
              for (const s of mergedSec.keyring.getGroupSenders(ga)) {
                senderSet.add(s);
              }
            }
          }
        }
      }

      if (usedSecureGas.size > 0 && senderSet.size === 0) {
        warnings.push({
          severity: "warning",
          code: "NO_AUTHORIZED_SENDERS",
          path: "security.authorizedSenders",
          message:
            "Secure Group Objects are configured but PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE has 0 authorized senders; incoming secure group telegrams from other devices will be ignored unless their Individual Addresses are added",
        });
      }

      if (
        this.app.maxSecurityGroupKeyTableEntries !== undefined &&
        usedSecureGas.size > this.app.maxSecurityGroupKeyTableEntries
      ) {
        errors.push({
          severity: "error",
          code: "SECURITY_TABLE_OVERFLOW",
          path: "security.groupKeys",
          message: `Secure Group Keys (${usedSecureGas.size}) exceed MaxSecurityGroupKeyTableEntries (${this.app.maxSecurityGroupKeyTableEntries})`,
        });
      }
      if (
        this.app.maxSecurityIndividualAddressEntries !== undefined &&
        senderSet.size > this.app.maxSecurityIndividualAddressEntries
      ) {
        errors.push({
          severity: "error",
          code: "SECURITY_TABLE_OVERFLOW",
          path: "security.authorizedSenders",
          message: `Security Individual Address entries (${senderSet.size}) exceed MaxSecurityIndividualAddressEntries (${this.app.maxSecurityIndividualAddressEntries})`,
        });
      }
      if (
        this.app.maxSecurityP2PKeyTableEntries !== undefined &&
        (mergedSec.p2pKeys?.length ?? 0) > this.app.maxSecurityP2PKeyTableEntries
      ) {
        errors.push({
          severity: "error",
          code: "SECURITY_TABLE_OVERFLOW",
          path: "security.p2pKeys",
          message: `P2P keys (${mergedSec.p2pKeys?.length ?? 0}) exceed MaxSecurityP2PKeyTableEntries (${this.app.maxSecurityP2PKeyTableEntries})`,
        });
      }
    }

    for (const w of this.evaluated.warnings) {
      warnings.push({
        severity: "warning",
        code: "EVALUATION_WARNING",
        path: "evaluation",
        message: w,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ============================================================================
  // Serialization & Programming Bridge
  // ============================================================================

  /**
   * Serializes the entire user configuration into a portable, plain JSON object (`schemaVersion: 1`).
   * Pass `{ includeSecrets: false }` to omit raw AES keys (`groupKeys`, `p2pKeys`, `toolKey`) when returning
   * configuration state to untrusted clients.
   */
  public toJSON(options: { includeSecrets?: boolean } = {}): SerializedDeviceConfig {
    const includeSecrets = options.includeSecrets ?? true;

    const parameters: Record<string, string> = {};
    for (const [k, v] of this.parameterOverrides.entries()) {
      parameters[k] = v;
    }

    const groupLinks: Record<string, SerializedGroupObjectLink> = {};
    for (const [k, link] of this.groupLinks.entries()) {
      groupLinks[k] = {
        ...(link.sending !== undefined ? { sending: link.sending } : {}),
        ...(link.listening && link.listening.length > 0 ? { listening: [...link.listening] } : {}),
        ...(link.flags ? { flags: { ...link.flags } } : {}),
        ...(link.security !== undefined ? { security: link.security } : {}),
      };
    }

    let security: SerializedDeviceSecurityConfig | undefined;
    if (
      this.securityConfig.enabled !== undefined ||
      this.securityConfig.defaultGroupSecurityMode !== undefined ||
      this.securityConfig.groupKeys !== undefined ||
      this.securityConfig.groupObjectSecurityModes !== undefined ||
      this.securityConfig.authorizedSenders !== undefined ||
      this.securityConfig.p2pKeys !== undefined ||
      this.securityConfig.toolKey !== undefined ||
      this.securityConfig.enableSecurityMode !== undefined ||
      this.securityConfig.initialSequenceNumberSending !== undefined ||
      this.securityConfig.objectInstance !== undefined ||
      this.securityConfig.includeKeyringSenders !== undefined
    ) {
      security = {};
      if (this.securityConfig.enabled !== undefined) security.enabled = this.securityConfig.enabled;
      if (this.securityConfig.defaultGroupSecurityMode !== undefined) {
        security.defaultGroupSecurityMode = this.securityConfig.defaultGroupSecurityMode;
      }
      if (this.securityConfig.includeKeyringSenders !== undefined) {
        security.includeKeyringSenders = this.securityConfig.includeKeyringSenders;
      }
      if (this.securityConfig.objectInstance !== undefined) {
        security.objectInstance = this.securityConfig.objectInstance;
      }
      if (this.securityConfig.enableSecurityMode !== undefined) {
        security.enableSecurityMode = this.securityConfig.enableSecurityMode;
      }
      if (this.securityConfig.initialSequenceNumberSending !== undefined) {
        security.initialSequenceNumberSending =
          this.securityConfig.initialSequenceNumberSending === "auto"
            ? "auto"
            : String(this.securityConfig.initialSequenceNumberSending);
      }
      if (this.securityConfig.groupObjectSecurityModes) {
        security.groupObjectSecurityModes = {};
        for (const [k, v] of Object.entries(this.securityConfig.groupObjectSecurityModes)) {
          security.groupObjectSecurityModes[String(k)] = v;
        }
      }
      if (this.securityConfig.authorizedSenders) {
        security.authorizedSenders = this.securityConfig.authorizedSenders.map((s) =>
          typeof s === "string"
            ? { individualAddress: s }
            : {
                individualAddress: s.individualAddress,
                ...(s.lastValidSeqNr !== undefined ? { lastValidSeqNr: String(s.lastValidSeqNr) } : {}),
              },
        );
      }
      if (includeSecrets) {
        if (this.securityConfig.groupKeys) {
          security.groupKeys = {};
          for (const [ga, k] of Object.entries(this.securityConfig.groupKeys)) {
            security.groupKeys[ga] = keyToHexString(k);
          }
        }
        if (this.securityConfig.p2pKeys) {
          security.p2pKeys = this.securityConfig.p2pKeys.map((p: DeviceP2PKeySpec) => ({
            individualAddress: p.individualAddress,
            key: keyToHexString(p.key),
            ...(p.roles !== undefined ? { roles: p.roles } : {}),
          }));
        }
        if (this.securityConfig.toolKey !== undefined) {
          security.toolKey = keyToHexString(this.securityConfig.toolKey);
        }
      }
    }

    const hasOptions = Object.values(this.compileOptions).some((v) => v !== undefined);

    return {
      schemaVersion: 1,
      applicationId: this.app.id,
      ...(this.app.loadedLanguage ? { language: this.app.loadedLanguage } : {}),
      parameters,
      groupLinks,
      ...(security ? { security } : {}),
      ...(hasOptions ? { options: { ...this.compileOptions } } : {}),
    };
  }

  private mergeSecurityConfig(runtimeSecurity?: Partial<DeviceSecurityConfig>): DeviceSecurityConfig {
    if (!runtimeSecurity) return { ...this.securityConfig };
    return {
      ...this.securityConfig,
      ...runtimeSecurity,
      groupKeys:
        this.securityConfig.groupKeys || runtimeSecurity.groupKeys
          ? { ...(this.securityConfig.groupKeys ?? {}), ...(runtimeSecurity.groupKeys ?? {}) }
          : undefined,
      groupObjectSecurityModes:
        this.securityConfig.groupObjectSecurityModes || runtimeSecurity.groupObjectSecurityModes
          ? {
              ...(this.securityConfig.groupObjectSecurityModes ?? {}),
              ...(runtimeSecurity.groupObjectSecurityModes ?? {}),
            }
          : undefined,
      authorizedSenders: runtimeSecurity.authorizedSenders ?? this.securityConfig.authorizedSenders,
      p2pKeys: runtimeSecurity.p2pKeys ?? this.securityConfig.p2pKeys,
    };
  }

  /**
   * Produces a `DeviceApplicationConfig` suitable for `SystemBCompiler.compile()` or `KNXDeviceProgrammer.download()`.
   * Optional `runtimeSecurity` (e.g. a server-side `KnxKeyring`) is merged without mutating the session.
   */
  public toDeviceConfig(runtimeSecurity?: Partial<DeviceSecurityConfig>): DeviceApplicationConfig {
    const parameters: Record<string, string> = {};
    for (const [k, v] of this.parameterOverrides.entries()) {
      parameters[k] = v;
    }

    const groupLinks: Record<string, GroupObjectLinkSpec> = {};
    for (const [k, link] of this.groupLinks.entries()) {
      groupLinks[k] = {
        sending: link.sending,
        listening: link.listening ? [...link.listening] : undefined,
        flags: link.flags ? { ...link.flags } : undefined,
        security: link.security,
      };
    }

    const mergedSecurity = this.mergeSecurityConfig(runtimeSecurity);
    const hasSecurity = Object.values(mergedSecurity).some((v) => v !== undefined);

    return {
      parameters,
      groupLinks,
      ...(hasSecurity ? { security: mergedSecurity } : {}),
      ...this.compileOptions,
    };
  }

  /**
   * Compiles the current session configuration into a System B binary image (including Object 17 if secure).
   */
  public compile(runtimeSecurity?: Partial<DeviceSecurityConfig>): CompiledSystemBImage {
    const cfg = this.toDeviceConfig(runtimeSecurity);
    const reuseEvaluated = !runtimeSecurity && !this.hasInvalidDraftGroupAddress;
    return SystemBCompiler.compile(this.app, cfg, reuseEvaluated ? this.evaluated : undefined);
  }

  /**
   * Builds a concrete `DownloadPlan` (offline dry-run) for the current session configuration.
   */
  public planDownload(
    options: Pick<DeviceDownloadOptions, "mode" | "skipFillRuns" | "skipRestart" | "programSecurityObject"> = {},
    runtimeSecurity?: Partial<DeviceSecurityConfig>,
  ): { image: CompiledSystemBImage; plan: DownloadPlan } {
    const image = this.compile(runtimeSecurity);
    const plan = LoadProcedureEngine.buildPlan(this.app, image, options.mode ?? "ap1", {
      knxProd: this.knxProd,
      skipFillRuns: options.skipFillRuns ?? true,
      skipRestart: options.skipRestart ?? false,
      programSecurityObject: options.programSecurityObject,
    });
    return { image, plan };
  }

  /**
   * Compiles and downloads the current session configuration onto a real KNX device using `KNXDeviceProgrammer`.
   */
  public async download(
    programmer: KNXDeviceProgrammer,
    individualAddress: string,
    options: DeviceDownloadOptions = {},
    runtimeSecurity?: Partial<DeviceSecurityConfig>,
  ): Promise<DeviceDownloadResult> {
    const source: KnxProdSource = this.knxProd ?? this.app;
    return programmer.download(individualAddress, source, this.toDeviceConfig(runtimeSecurity), options);
  }
}
