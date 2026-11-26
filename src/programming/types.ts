import type { KnxIpInterfaceConfig, OpenSessionOptions } from "../management/KNXManagement";
import type { KnxDataSecure } from "../security/KnxDataSecure";
import type { KnxKeyring } from "../security/KnxKeyring";

/**
 * Security protection level for a Group Object (`PID_GO_SECURITY_FLAGS`, 03_05_01 §6.3.15 Fig. 81):
 * - `"plain"` -> `0x00` (unsecured)
 * - `"auth_only"` -> `0x01` (Authentication only)
 * - `"auth_conf"` -> `0x03` (Authentication + Confidentiality)
 */
export type GroupObjectSecurityMode = "plain" | "auth_only" | "auth_conf";

/**
 * Supported KNX download modes matching `knx_master.xml` `<Procedure ProcedureSubType="...">`
 * and `.knxprod` `AppliesTo` attributes.
 */
export type DownloadMode = "full" | "ap1" | "par" | "grp" | "par,grp" | "unload";

/**
 * KNX Group Object transmission priority (03_05_01 §4.18.6 Table 87).
 */
export type GroupObjectPriority = "System" | "Normal" | "Urgent" | "Alert" | "Low";

/**
 * Flag state used in KNX XML (`ComObject` / `ComObjectRef`).
 */
export type FlagSetting = "Enabled" | "Disabled";

/**
 * KNX Management Model derived from `knx_master.xml` `<MaskVersion ManagementModel="...">`
 * or inferred from the 16-bit MaskVersion (`DD0`).
 */
export type KnxManagementModel = "SystemB" | "BimM112" | "Bcu2" | "Bcu1" | "PropertyBased" | "None";

/**
 * Static memory-mapped table declaration inside `<ApplicationProgram><Static>`
 * (`<AddressTable>`, `<AssociationTable>`, `<ComObjectTable>`).
 */
export interface KnxStaticTableLocation {
  codeSegment?: string;
  offset: number;
  maxEntries?: number;
}

/**
 * ETS Plugin / Device Configuration App (DCA) metadata detected on an `ApplicationProgram`.
 */
export interface KnxApplicationExtensionInfo {
  requiresExternalSoftware: boolean;
  downloadInfoIncomplete: boolean;
  etsDownloadPlugin?: string;
  etsUiPlugin?: string;
  etsDataHandler?: string;
  baggageRefIds: string[];
  pluginParameterTypeIds: string[];
  /** True if the application relies on a proprietary ETS download plugin / data handler or incomplete download info. */
  hasDownloadPlugin: boolean;
  /** True if the application relies on a proprietary ETS UI plugin / external software / parameter-type plugin. */
  hasUiPlugin: boolean;
  /** True if either `hasDownloadPlugin` or `hasUiPlugin` is set (proprietary ETS DCA/plugin detected). */
  requiresDca: boolean;
}

/**
 * KNX Application Program `<Options>` parsed from `.knxprod`.
 */
export interface KnxApplicationOptions {
  parameterByteOrder: "BigEndian" | "LittleEndian";
  textParameterEncoding: string;
  textParameterZeroTerminate: boolean;
  preferPartialDownloadIfApplicationLoaded: boolean;
  downloadInvisibleParameters?: string;
  supportsExtendedMemoryServices: boolean;
  supportsExtendedPropertyServices: boolean;
  comparable?: boolean;
  reconstructable?: boolean;
  legacyPatchManufacturerIdInTaskSegment?: boolean;
  setObjectTableLengthAlwaysToOne?: boolean;
  legacyNoMemoryVerifyMode?: boolean;
}

/**
 * Code / Memory Segment defined under `<Static><Code>`.
 */
export interface KnxCodeSegment {
  kind: "RelativeSegment" | "AbsoluteSegment";
  id: string;
  name?: string;
  size: number;
  loadStateMachine?: number;
  offset: number;
  address?: number;
  memoryType?: string;
  /** True when `<AbsoluteSegment UserMemory="true|1">` (BCU2 user memory space). */
  userMemory?: boolean;
  /** Initial image data decoded from Base64 `<Data>` (padded/sized to `size` if shorter). */
  data: Buffer;
  /** Validity bitmask decoded from Base64 `<Mask>` (`1` = defined/owned by ETS, `0` = untouched/reserved). */
  mask?: Buffer;
}

export interface KnxEnumerationValue {
  id: string;
  text: string;
  value: number;
  /** Optional raw binary value (Base64 decoded) when `TypeRestriction/@Base="BinaryValue"`. */
  binaryValue?: Buffer;
}

export type KnxParameterTypeKind =
  | {
      kind: "Number";
      sizeInBit: number;
      numberType: "unsignedInt" | "signedInt" | "float";
      minInclusive?: number;
      maxInclusive?: number;
      uiHint?: string;
    }
  | {
      kind: "Restriction";
      base: "Value" | "BinaryValue";
      sizeInBit: number;
      enumerations: KnxEnumerationValue[];
    }
  | {
      kind: "Float";
      encoding: "DPT 9" | "IEEE-754 Single" | "IEEE-754 Double" | string;
      sizeInBit: number;
      minInclusive?: number;
      maxInclusive?: number;
    }
  | {
      kind: "Text";
      sizeInBit: number;
      pattern?: string;
    }
  | {
      kind: "Picture";
      refId?: string;
    }
  | {
      kind: "None";
    }
  | {
      kind: "RawData";
      maxSize?: number;
    }
  | {
      kind: "Color";
      space?: string;
      sizeInBit: number;
    }
  | {
      kind: "Time";
      sizeInBit: number;
      unit?: string;
    }
  | {
      kind: "IPAddress";
      version?: string;
      sizeInBit: number;
    };

export interface KnxParameterType {
  id: string;
  name: string;
  detail: KnxParameterTypeKind;
}

export interface KnxMemoryLocation {
  codeSegment: string;
  offset: number;
  bitOffset: number;
  /** Optional ModuleDef Argument Id when inside a `<ModuleDef>`. */
  baseOffset?: string;
}

export interface KnxPropertyLocation {
  objectIndex?: number;
  objectType?: number;
  occurrence?: number;
  propertyId: number;
  offset: number;
  bitOffset: number;
}

export interface KnxParameterDef {
  id: string;
  name: string;
  text: string;
  parameterTypeId: string;
  defaultValue: string;
  access?: string;
  suffixText?: string;
  memory?: KnxMemoryLocation;
  property?: KnxPropertyLocation;
  /** If belonging to a `<Union>`, identifies the union group and relative offset/bitOffset. */
  unionId?: string;
  unionSizeInBit?: number;
  unionOffset?: number;
  unionBitOffset?: number;
  defaultUnionParameter?: boolean;
}

export interface KnxParameterRefDef {
  id: string;
  refId: string;
  name?: string;
  text?: string;
  value?: string;
  access?: string;
  suffixText?: string;
}

export interface KnxComObjectDef {
  id: string;
  number: number;
  name: string;
  text: string;
  functionText: string;
  objectSize: string;
  datapointType?: string;
  priority: GroupObjectPriority;
  communicationFlag: FlagSetting;
  readFlag: FlagSetting;
  writeFlag: FlagSetting;
  transmitFlag: FlagSetting;
  updateFlag: FlagSetting;
  readOnInitFlag: FlagSetting;
  /** Optional ModuleDef Argument Id when inside a `<ModuleDef>`. */
  baseNumber?: string;
}

export interface KnxComObjectRefDef {
  id: string;
  refId: string;
  name?: string;
  text?: string;
  functionText?: string;
  objectSize?: string;
  datapointType?: string;
  priority?: GroupObjectPriority;
  communicationFlag?: FlagSetting;
  readFlag?: FlagSetting;
  writeFlag?: FlagSetting;
  transmitFlag?: FlagSetting;
  updateFlag?: FlagSetting;
  readOnInitFlag?: FlagSetting;
  textParameterRefId?: string;
}

export interface KnxCalculationParamBinding {
  refId: string;
  aliasName: string;
}

export interface KnxParameterCalculationDef {
  id: string;
  name: string;
  language: string;
  lrTransformation?: string;
  rlTransformation?: string;
  lrTransformationFunc?: string;
  rlTransformationFunc?: string;
  lrTransformationParameters?: string;
  rlTransformationParameters?: string;
  lParameters: KnxCalculationParamBinding[];
  rParameters: KnxCalculationParamBinding[];
}

export interface KnxAllocatorDef {
  id: string;
  name: string;
  start: number;
  maxInclusive: number;
}

export interface KnxModuleArgumentDef {
  id: string;
  name: string;
  allocates?: number;
  baseValue?: number;
}

export interface KnxModuleDef {
  id: string;
  name: string;
  arguments: KnxModuleArgumentDef[];
  parameters: Map<string, KnxParameterDef>;
  parameterRefs: Map<string, KnxParameterRefDef>;
  comObjects: Map<string, KnxComObjectDef>;
  comObjectRefs: Map<string, KnxComObjectRefDef>;
  parameterCalculations: KnxParameterCalculationDef[];
  dynamic: KnxDynamicNode[];
}

/**
 * Compact AST node for `<Dynamic>` trees inside ApplicationProgram and ModuleDef.
 */
export type KnxDynamicNode =
  | {
      type: "Container";
      tag: string;
      id?: string;
      name?: string;
      text?: string;
      textParameterRefId?: string;
      access?: string;
      children: KnxDynamicNode[];
    }
  | {
      type: "Choose";
      paramRefId: string;
      whens: KnxWhenNode[];
    }
  | {
      type: "ParameterRefRef";
      refId: string;
      indentLevel?: number;
    }
  | {
      type: "ComObjectRefRef";
      refId: string;
    }
  | {
      type: "Assign";
      targetParamRefRef: string;
      sourceParamRefRef?: string;
      value?: string;
    }
  | {
      type: "Module";
      id: string;
      refId: string;
      numericArgs: { refId: string; value?: number; allocatorRefId?: string }[];
    }
  | {
      type: "Repeat";
      id: string;
      parameterRefId?: string;
      count?: number;
      children: KnxDynamicNode[];
    }
  | {
      type: "Separator";
      id?: string;
      text: string;
      uiHint?: string;
    };

export interface KnxWhenNode {
  test?: string;
  isDefault: boolean;
  children: KnxDynamicNode[];
}

/**
 * Single load control step from `<LoadProcedures>` or `knx_master.xml` `<Procedure>`.
 */
export interface KnxLdCtrlStep {
  tag: string;
  attrs: Record<string, string>;
}

/**
 * LoadProcedure block inside `<ApplicationProgram><Static><LoadProcedures>`.
 */
export interface KnxAppLoadProcedure {
  mergeId?: number;
  steps: KnxLdCtrlStep[];
}

/**
 * HawkConfigurationData Procedure template from `knx_master.xml`.
 */
export interface KnxMasterProcedure {
  procedureType: string;
  procedureSubType: string;
  access: string;
  steps: KnxLdCtrlStep[];
}

/**
 * Resource descriptor from `knx_master.xml` `<MaskVersion><HawkConfigurationData>`.
 */
export interface KnxMaskResource {
  name: string;
  access: string;
  addressSpace: string;
  interfaceObjectRef?: number;
  propertyId?: number;
  startAddress?: number;
  length?: number;
  flavour?: string;
}

/**
 * Parsed `<MaskVersion>` metadata from `knx_master.xml`.
 */
export interface KnxMaskVersion {
  id: string;
  maskVersion: number;
  name: string;
  managementModel: string;
  mediumTypeRefId: string;
  /** Downward-compatible MaskVersion IDs declared under `<DownwardCompatibleMasks>` (e.g. `MV-0012` -> `["MV-0010", "MV-0011"]`). */
  downwardCompatibleMasks: string[];
  features: Record<string, string>;
  resources: Map<string, KnxMaskResource>;
  procedures: KnxMasterProcedure[];
}

export interface KnxHardwareProduct {
  id: string;
  text: string;
  orderNumber: string;
  isRailMounted?: boolean;
  defaultLanguage?: string;
}

export interface KnxHardwareInfo {
  id: string;
  name: string;
  serialNumber?: string;
  versionNumber?: number;
  busCurrent?: number;
  hasIndividualAddress: boolean;
  hasApplicationProgram: boolean;
  products: KnxHardwareProduct[];
  applicationProgramRefIds: string[];
}

/**
 * Fully parsed KNX Application Program from a `.knxprod` archive.
 */
export interface KnxApplicationProgram {
  id: string;
  manufacturerRefId: string;
  manufacturerId: number;
  applicationNumber: number;
  applicationVersion: number;
  programType: string;
  maskVersionId: string;
  maskVersion: number;
  name: string;
  visibleDescription?: string;
  loadProcedureStyle: string;
  peiType: number;
  defaultLanguage: string;
  dynamicTableManagement: boolean;
  linkable: boolean;
  isSecureEnabled: boolean;
  maxSecurityIndividualAddressEntries?: number;
  maxSecurityGroupKeyTableEntries?: number;
  maxSecurityP2PKeyTableEntries?: number;
  addressTableMaxEntries: number;
  associationTableMaxEntries: number;
  /** Static `<AddressTable>` memory placement (used by BCU1 / BCU2 / BIM M112). */
  addressTable?: KnxStaticTableLocation;
  /** Static `<AssociationTable>` memory placement (used by BCU1 / BCU2 / BIM M112). */
  associationTable?: KnxStaticTableLocation;
  /** Static `<ComObjectTable>` memory placement (used by BCU1 / BCU2 / BIM M112). */
  comObjectTable?: KnxStaticTableLocation;
  /** Detected ETS Plugin / Device Configuration App (DCA) metadata (if any). */
  extension?: KnxApplicationExtensionInfo;
  options: KnxApplicationOptions;
  codeSegments: Map<string, KnxCodeSegment>;
  parameterTypes: Map<string, KnxParameterType>;
  parameters: Map<string, KnxParameterDef>;
  parameterRefs: Map<string, KnxParameterRefDef>;
  comObjects: Map<string, KnxComObjectDef>;
  comObjectRefs: Map<string, KnxComObjectRefDef>;
  parameterCalculations: KnxParameterCalculationDef[];
  allocators: Map<string, KnxAllocatorDef>;
  moduleDefs: Map<string, KnxModuleDef>;
  loadProcedures: KnxAppLoadProcedure[];
  script?: string;
  dynamic: KnxDynamicNode[];
  /** Language identifiers declared inside `<Languages>` (e.g. `["en-US", "es-ES", ...]`). */
  availableLanguages: string[];
  /** Language identifier whose translations were loaded (if `options.language` was requested). */
  loadedLanguage?: string;
  /** Optional translations indexed by RefId -> AttributeName -> translated text. */
  translations?: Map<string, Record<string, string>>;
}

/**
 * Baggage file metadata declared in `M-XXXX/Baggages.xml` inside a `.knxprod` archive
 * (e.g. button icons, `TypePicture` images, manuals).
 */
export interface KnxProdBaggageEntry {
  id: string;
  manufacturerId: string;
  targetPath: string;
  name: string;
  zipEntryPath: string;
  mimeType: string;
  size?: number;
}

/**
 * Extracted Baggage binary payload ready for web UI rendering (`TypePicture`, icons, PDFs).
 */
export interface KnxExtractedBaggage extends KnxProdBaggageEntry {
  filename: string;
  size: number;
  buffer: Buffer;
}

/**
 * Top-level parsed `.knxprod` package.
 */
export interface ParsedKnxProd {
  sourceName?: string;
  manufacturerId: number;
  manufacturerRefId: string;
  hardware: KnxHardwareInfo[];
  applications: KnxApplicationProgram[];
  maskVersions: Map<string, KnxMaskVersion>;
  /** Indexed manufacturer baggage files from `M-XXXX/Baggages.xml` (lazy binary extraction via `readBaggage`). */
  baggages?: KnxProdBaggageEntry[];
  /** Lazy extractor for baggage files by Baggage `Id`, `zipEntryPath`, or filename. */
  readBaggage?: (refIdOrName: string) => KnxExtractedBaggage | undefined;
}

/**
 * Options for `KnxProdParser.parseFile()` / `KnxProdParser.parseBuffer()`.
 */
export interface KnxProdParseOptions {
  /**
   * Optional language code (e.g. `"es-ES"` or `"en-US"`) to load `<Translations>`.
   * Omitted by default so massive multi-language `<Languages>` sections (10–35 MB) are skipped.
   */
  language?: string;
  /**
   * Optional application ID filter when a `.knxprod` contains multiple ApplicationPrograms.
   */
  applicationId?: string;
}

/**
 * Group Address link specification for a Communication Object.
 * - A string `"1/2/3"` links a single sending+listening GA.
 * - An array `["1/2/3", "1/2/4"]` sets the first entry as the sending GA (`TSAP`) and all entries as listening GAs.
 * - An object allows explicit control over `sending` and `listening` GAs plus optional per-object flag overrides.
 */
export type GroupObjectLinkSpec =
  | string
  | string[]
  | {
      /** Primary sending Group Address (placed first in GrOAT per 03_05_01 §4.17.5.2.5). */
      sending?: string;
      /** Additional listening Group Addresses. */
      listening?: string[];
      /** Optional flag overrides on top of the ComObject / ComObjectRef defaults. */
      flags?: Partial<{
        communication: boolean;
        read: boolean;
        write: boolean;
        transmit: boolean;
        update: boolean;
        readOnInit: boolean;
        priority: GroupObjectPriority;
      }>;
      /** Optional KNX Data Secure protection level for this Group Object (`PID_GO_SECURITY_FLAGS`). */
      security?: GroupObjectSecurityMode;
    };

/**
 * Point-to-Point (P2P) security key entry for `PID_P2P_KEY_TABLE` (PID 52, 03_05_01 §6.3.6).
 */
export interface DeviceP2PKeySpec {
  /** Authorized partner Individual Address (automatically included in `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`). */
  individualAddress: string;
  /** 16-byte AES-128 key (Buffer, 32-char hex string, or base64). */
  key: Buffer | string;
  /** 16-bit security access roles bitmask (default: `0`). */
  roles?: number;
}

/**
 * KNX Data Secure commissioning configuration for Security Interface Object (Object Type 17, 03_05_01 §6.3).
 */
export interface DeviceSecurityConfig {
  /** Enable compiling and programming Object 17 (`PID_GRP_KEY_TABLE`, `PID_GO_SECURITY_FLAGS`, `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`, `PID_P2P_KEY_TABLE`). */
  enabled?: boolean;
  /** Optional ETS `.knxkeys` keyring used to automatically look up Group Keys & authorized group senders. */
  keyring?: KnxKeyring;
  /** Explicit Group Keys keyed by Group Address (`"1/0/1"` -> 16-byte Buffer, hex, or base64). Overrides keyring entries. */
  groupKeys?: Record<string, Buffer | string>;
  /** Default security mode for linked Group Objects whose Group Address has a configured key. Default: `"auth_conf"`. */
  defaultGroupSecurityMode?: GroupObjectSecurityMode;
  /** Per-ComObject security mode overrides keyed by ComObject Number, Name, Id, or RefId. */
  groupObjectSecurityModes?: Record<string | number, GroupObjectSecurityMode>;
  /**
   * Authorized sender Individual Addresses for `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (PID 54).
   * Merged with senders from `keyring.getGroupSenders(ga)` (unless `includeKeyringSenders === false`)
   * and any `p2pKeys` partner addresses.
   */
  authorizedSenders?: (string | { individualAddress: string; lastValidSeqNr?: bigint | number })[];
  /** Automatically include sender Individual Addresses from `keyring` `<Interface><Group Senders="..."/>`. Default: `true`. */
  includeKeyringSenders?: boolean;
  /** Optional Point-to-Point keys for `PID_P2P_KEY_TABLE` (PID 52). */
  p2pKeys?: DeviceP2PKeySpec[];
  /** Optional new 16-byte Tool Key to write to `PID_TOOL_KEY` (PID 56) during Object 17 commissioning. */
  toolKey?: Buffer | string;
  /** Optional explicit `PID_SECURITY_MODE` (PID 51) state to write (`true` = enable, `false` = disable). */
  enableSecurityMode?: boolean;
  /**
   * Optional `PID_SEQUENCE_NUMBER_SENDING` (PID 59) to write:
   * - `"auto"`: milliseconds elapsed since KNX epoch `2018-01-05T00:00:00Z` per 03_05_03 §1.5.4.1
   * - `bigint | number`: explicit 48-bit sequence number
   */
  initialSequenceNumberSending?: "auto" | bigint | number;
  /** Security Interface Object instance number (default: `1`). */
  objectInstance?: number;
}

/**
 * User configuration applied to a parsed `KnxApplicationProgram` before compilation.
 */
export interface DeviceApplicationConfig {
  /**
   * Parameter overrides keyed by:
   * - Parameter `Name` (e.g. `"bOutput"`, `"outputCh[0].type"`), OR
   * - Parameter `Id` (e.g. `"M-0071_A-49B1-21-F03B_P-1"`), OR
   * - ParameterRef `Id` (e.g. `"M-0071_A-49B1-21-F03B_P-1_R-1"`).
   */
  parameters?: Record<string, string | number | boolean>;
  /**
   * Group Address bindings keyed by:
   * - ComObject 1-based `Number` (e.g. `1`, `"4"`), OR
   * - ComObject `Name` (e.g. `"oHb.funcBit.hb"`), OR
   * - ComObject `Id` or active `ComObjectRef` `Id`.
   */
  groupLinks?: Record<string | number, GroupObjectLinkSpec>;
  /**
   * Optional KNX Data Secure commissioning settings (Security Interface Object Type 17).
   */
  security?: DeviceSecurityConfig;
  /**
   * Whether to execute `<ParameterCalculation>` JavaScript transforms in an isolated VM sandbox.
   * Defaults to `true`.
   */
  runParameterCalculations?: boolean;
  /**
   * Optional explicit GrOAT entry format override:
   * - `0`: Format 0 (1-byte TSAP, 1-byte ASAP — max 255 entries)
   * - `1`: Format 1 (2-byte TSAP, 2-byte ASAP — up to 4095/65535 entries)
   * Defaults to auto-detection (`1` if `MaxEntries > 255`, or queried live from device `A_PropertyDescription_Read`).
   */
  associationTableFormat?: 0 | 1;
  /**
   * When true (default, matching ETS behavior), clears the Communication (`C`) flag in GrOT
   * for active ComObjects that have no Group Address linked.
   */
  clearCommunicationFlagWhenUnlinked?: boolean;
  /**
   * Optional Group Object Table length override. Defaults to `maxComObjectNumber` defined by the application.
   */
  groupObjectTableSize?: number;
  /**
   * Optional target Individual Address (e.g. `"1.1.5"`).
   * Embedded in bytes 1..2 of legacy BCU1 / BCU2 / BIM M112 Group Address Tables (`GrAT`)
   * and used to detect Area (`A.0.0`) vs Line (`A.L.0`) Couplers (`PID_HOP_COUNT`).
   * Automatically supplied by `KNXDeviceProgrammer.download(ia, ...)` if omitted.
   */
  individualAddress?: string;
  /**
   * Optional coupler Filter Table bitmask (`Buffer` or hex string, e.g. from `KnxProject.computeFilterTables()`).
   * Used when programming KNX Line/Area Couplers (`MV-091A`, `MV-0912`, `MV-2920`).
   */
  filterTable?: Buffer | string;
  /**
   * Convenience list of Group Addresses to allow through a KNX Line/Area Coupler filter table.
   * Automatically compiled into the 8192-byte filter bitmask when `filterTable` is not provided.
   */
  filterTableGroupAddresses?: (string | number)[];
  /**
   * Explicit Area Coupler flag for `MV-2920` (`PID_HOP_COUNT` = `0x0004` for Area Coupler vs `0x0005` for Line Coupler).
   * Auto-inferred from `individualAddress` (`A.0.0` with `A > 0`) when omitted.
   */
  isAreaCoupler?: boolean;
  /**
   * Optional `KnxMaskVersion` definition from `knx_master.xml` to guide management model detection during offline compilation.
   */
  maskVersionDef?: KnxMaskVersion;
}

/**
 * Resolved Communication Object after evaluating `<Dynamic>` and user links.
 */
export interface ResolvedComObject {
  number: number;
  comObjectId: string;
  comObjectRefId: string;
  name: string;
  text: string;
  functionText: string;
  objectSize: string;
  valueTypeCode: number;
  datapointType?: string;
  priority: GroupObjectPriority;
  flags: {
    communication: boolean;
    read: boolean;
    write: boolean;
    transmit: boolean;
    update: boolean;
    readOnInit: boolean;
  };
  /** Sending Group Address (if linked). */
  sendingGroupAddress?: string;
  /** All linked Group Addresses (sending first, followed by listening). */
  groupAddresses: string[];
  /** Explicit KNX Data Secure mode override for this Group Object (if set via `groupLinks`). */
  security?: GroupObjectSecurityMode;
}

/**
 * ETS-compatible metadata for an instantiated `<Module>` node inside `<Dynamic>` / `<Repeat>`.
 */
export interface EvaluatedModuleInstanceInfo {
  /** Internal DynamicEvaluator instance key, e.g. `"M-0071_A-5C41-12-3158_MD-1_M-15_r0"`. */
  instanceKey: string;
  /** ETS `0.xml` `<ModuleInstance Id="...">`, e.g. `"MD-1_M-15_MI-1"`. */
  etsInstanceId: string;
  /** ETS `0.xml` `<ModuleInstance RefId="...">`, e.g. `"MD-1_M-15"`. */
  etsRefId: string;
  /** Full `<ModuleDef Id="...">`, e.g. `"M-0071_A-5C41-12-3158_MD-1"`. */
  moduleDefId: string;
  /** ETS `RepeatIndex` attribute when expanded inside `<Repeat>`, e.g. `"1589x1"` or `"352x1 353x1"`. */
  repeatIndex?: string;
  /** ETS `<Arguments><Argument RefId="..." Value="..." /></Arguments>` entries. */
  arguments: { refId: string; value: string; resolvedNumber: number }[];
}

/**
 * Output of `DynamicEvaluator.evaluate()`.
 */
export interface EvaluatedApplicationState {
  application: KnxApplicationProgram;
  /** Effective value per ParameterRef ID (after defaults, user overrides, Assigns, and JS ParameterCalculations). */
  parameterRefValues: Map<string, string>;
  /** Effective value per Parameter ID (active/visible Ref takes precedence over hidden Ref). */
  parameterValues: Map<string, string>;
  /** Active/visible ParameterRef IDs reached during `<Dynamic>` traversal. */
  activeParameterRefIds: Set<string>;
  /** Active/visible Parameter IDs reached during `<Dynamic>` traversal. */
  activeParameterIds: Set<string>;
  /** Parameter IDs explicitly overridden by user or `<Assign>` or `<ParameterCalculation>`. */
  modifiedParameterIds: Set<string>;
  /** All instantiated Parameters (base + expanded ModuleDef instances). */
  allParameters: Map<string, KnxParameterDef>;
  /** All instantiated ParameterRefs (base + expanded ModuleDef instances). */
  allParameterRefs: Map<string, KnxParameterRefDef>;
  /** All instantiated ComObjects (base + expanded ModuleDef instances). */
  allComObjects: Map<string, KnxComObjectDef>;
  /** All instantiated ComObjectRefs (base + expanded ModuleDef instances). */
  allComObjectRefs: Map<string, KnxComObjectRefDef>;
  /** Expanded `<Dynamic>` subtrees for instantiated `<Module>` nodes keyed by instanceKey. */
  expandedModules: Map<string, KnxDynamicNode[]>;
  /** ETS-compatible `<ModuleInstance>` metadata for every instantiated `<Module>` node. */
  instantiatedModules: EvaluatedModuleInstanceInfo[];
  /** Bidirectional map between internal `DynamicEvaluator` ParameterRef/ComObjectRef IDs and ETS `0.xml` module IDs. */
  etsIdToInternalId: Map<string, string>;
  internalIdToEtsId: Map<string, string>;
  /** Active/visible Communication Objects keyed by `Number` (ASAP: 1-based on System B, 0-based on BCU1/BCU2/BIM M112). */
  activeComObjects: Map<number, ResolvedComObject>;
  /** Lowest ComObject Number base (`0` for BCU1/BCU2/BIM M112 0-based tables, `1` for System B 1-based tables). */
  comObjectNumberBase: 0 | 1;
  /** Highest ComObject Number across base + instantiated modules. */
  maxComObjectNumber: number;
  /** Warnings emitted during evaluation (e.g. unknown parameter name, skipped calculation error). */
  warnings: string[];
}

/**
 * Contiguous writable byte span inside a memory segment (excluding `Mask == 0` regions).
 */
export interface MemoryWriteSpan {
  offset: number;
  data: Buffer;
}

/**
 * Compiled memory segment ready for download.
 */
export interface CompiledMemorySegment {
  segmentId: string;
  loadStateMachine: number;
  size: number;
  /** Absolute start address when compiled from `<AbsoluteSegment>` (undefined for `<RelativeSegment>`). */
  address?: number;
  /** True when `<AbsoluteSegment UserMemory="true|1">` (BCU2 user memory space). */
  userMemory?: boolean;
  memoryType?: string;
  /** Full patched binary image for the segment. */
  image: Buffer;
  /** Effective write mask (`0xFF` = defined/patched byte, `0x00` = untouched/reserved byte). */
  mask: Buffer;
  /** CRC16-CCITT (poly 0x1021, init 0xFFFF) over the full image (03_05_01 §4.2.27). */
  crc16: number;
  /** Offsets modified relative to the base segment `<Data>` (useful for differential / partial writes). */
  patchedByteCount: number;
}

/**
 * Compiled writable property value (used by System 300 `PropertyBased` devices and property-backed router/app parameters).
 */
export interface CompiledPropertyWrite {
  objectIndex?: number;
  objectType?: number;
  occurrence?: number;
  propertyId: number;
  offset: number;
  bitOffset: number;
  data: Buffer;
  bitLength: number;
  parameterName: string;
}

/**
 * Complete compiled KNX device binary image (supports System B `MV-07B0`/`17B0`/`27B0`/`2920`/`57B0`,
 * System 7 BIM M112 `MV-0700`/`0701`/`0705`, System 2 BCU2 `MV-0020`/`0021`/`0025`,
 * System 1 BCU1 `MV-0010`–`0013` & Couplers `MV-091A`/`0912`, and System 300 `MV-0300`).
 */
export interface CompiledSystemBImage {
  applicationId: string;
  applicationName: string;
  maskVersion: number;
  /** Resolved KNX Management Model (`"SystemB"`, `"BimM112"`, `"Bcu2"`, `"Bcu1"`, `"PropertyBased"`, `"None"`). */
  managementModel: KnxManagementModel;
  manufacturerId: number;
  applicationNumber: number;
  applicationVersion: number;
  /** 5-byte `PID_PROGRAM_VERSION` (`[MfrHi, MfrLo, AppHi, AppLo, AppVer]`). */
  programVersion: Buffer;
  /** Object 1 — Group Address Table (`GrAT`, Realisation Type 7 on System B or Type 1/2 on BCU1/BCU2/BIM M112). */
  groupAddressTable: Buffer;
  /** Sorted unique Group Addresses in `GrAT` (index `i` corresponds to `TSAP = i + 1`). */
  groupAddresses: string[];
  /** Object 2 — Group Object Association Table (`GrOAT`, Realisation Type 6/7 or Type 1/2). */
  associationTable: Buffer;
  /** GrOAT format used (`0` = 1B TSAP + 1B ASAP, `1` = 2B TSAP + 2B ASAP). */
  associationTableFormat: 0 | 1;
  /** Number of association pairs in `GrOAT`. */
  associationCount: number;
  /** Object 3 — Group Object Table (`GrOT`, Realisation Type 7 on System B, Type 2 on BIM M112, Type 1 on BCU1/BCU2). */
  groupObjectTable: Buffer;
  /** Number of Group Object slots in `GrOT`. */
  groupObjectCount: number;
  /** Relative memory segments keyed by LSM index (`4`, `5`, etc.) for System B. */
  segments: Map<number, CompiledMemorySegment>;
  /** All compiled `<AbsoluteSegment>` blocks (sorted ascending by `address`) for BCU1 / BCU2 / BIM M112 / Couplers. */
  absoluteSegments: CompiledMemorySegment[];
  /** All compiled segments (both relative and absolute) indexed by XML `CodeSegment` Id. */
  segmentsById: Map<string, CompiledMemorySegment>;
  /** Optional compiled 8192-byte (or 3584-byte) KNX Coupler Filter Table bitmask (`MV-091A`, `MV-0912`, `MV-2920`). */
  filterTable?: Buffer;
  /** Target Individual Address used during compilation (if provided). */
  individualAddress?: string;
  /** Area coupler flag (`A.0.0`) used by `MV-2920` `PID_HOP_COUNT`. */
  isAreaCoupler?: boolean;
  /** Writable property-mapped parameters (System 300 `MV-0300` & property-backed parameters such as `PID_FILTER_TABLE_USE`). */
  propertyWrites: CompiledPropertyWrite[];
  /** Evaluated state used to produce this image. */
  evaluated: EvaluatedApplicationState;
  /** Warnings produced during compilation. */
  warnings: string[];
  /**
   * Optional hardware check properties (e.g. `PID_HARDWARE_TYPE` from read-only `Property` parameters in the `.knxprod`).
   */
  expectedProperties: {
    objectIndex: number;
    propertyId: number;
    expectedValue: Buffer;
    description: string;
  }[];
  /**
   * Extension slot for Phase 2 KNX Data Secure commissioning (Object 17: Security Interface Object).
   */
  securityImage?: SecurityCommissioningImage;
}

/**
 * Compiled KNX Data Secure commissioning image for Security Interface Object (Object Type 17, 03_05_01 §6.3).
 */
export interface SecurityCommissioningImage {
  /** Security Interface Object instance (default: `1`). */
  objectInstance: number;
  /** `PID_GRP_KEY_TABLE` (PID 53) sorted ascending by 1-based `gaIndex` (`TSAP` in `GrAT`). */
  groupKeyTable: { gaIndex: number; groupAddress: string; key: Buffer }[];
  /** `PID_GO_SECURITY_FLAGS` (PID 61): 1 byte per Group Object (`0x00` plain, `0x01` auth_only, `0x03` auth_conf). */
  goSecurityFlags: Buffer;
  /** `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (PID 54) sorted ascending by 16-bit Individual Address. */
  securityIndividualAddressTable: { individualAddress: string; lastValidSeqNr: bigint }[];
  /** `PID_P2P_KEY_TABLE` (PID 52) sorted ascending by 1-based `iaIndex` into `securityIndividualAddressTable`. */
  p2pKeyTable: { iaIndex: number; individualAddress: string; key: Buffer; roles: number }[];
  /** Optional new 16-byte Tool Key (`PID_TOOL_KEY`, PID 56). */
  toolKey?: Buffer;
  /** Optional explicit `PID_SECURITY_MODE` (PID 51) toggle. */
  enableSecurityMode?: boolean;
  /** Optional initial 48-bit `PID_SEQUENCE_NUMBER_SENDING` (PID 59). */
  initialSequenceNumberSending?: bigint;
}

/**
 * Concrete executable step in a merged DownloadPlan.
 */
export type DownloadAction =
  | { type: "Connect" }
  | { type: "Disconnect" }
  | { type: "Authorize"; key: number | Buffer }
  | { type: "Unload"; lsmIdx?: number; objType?: number; occurrence?: number; ignoreErrors?: boolean }
  | { type: "LoadStart"; lsmIdx?: number; objType?: number; occurrence?: number }
  | {
      type: "AllocRelSegment";
      lsmIdx?: number;
      objType?: number;
      occurrence?: number;
      size: number;
      mode: number;
      fill: number;
    }
  | {
      type: "AllocAbsSegment";
      lsmIdx: number;
      segType: number;
      address: number;
      size: number;
      access: number;
      memType: number;
      segFlags: number;
    }
  | { type: "TaskSegment"; lsmIdx: number; address: number }
  | { type: "TaskPtr"; lsmIdx: number; initPtr: number; savePtr: number; serialPtr: number }
  | { type: "TaskCtrl1"; lsmIdx: number; address: number; count: number }
  | { type: "TaskCtrl2"; lsmIdx: number; callback: number; address: number; seg0: number; seg1: number }
  | {
      type: "WriteRelMem";
      objIdx?: number;
      objType?: number;
      occurrence?: number;
      offset: number;
      size: number;
      verify: boolean;
      mode?: number;
      fill?: number;
    }
  | {
      type: "WriteAbsMem";
      address: number;
      data: Buffer;
      verify: boolean;
      addressSpace?: "Standard" | "UserMemory" | "LcFilter" | "LcSlave";
      restoreFromLoadedImage?: boolean;
    }
  | {
      type: "LoadImageMem";
      address: number;
      size: number;
      addressSpace?: "Standard" | "UserMemory";
    }
  | {
      type: "CompareMem";
      address: number;
      size: number;
      expected?: Buffer;
      mask?: Buffer;
      compareWithLoadedImage?: boolean;
      addressSpace?: "Standard" | "UserMemory";
    }
  | {
      type: "ClearLCFilterTable";
      useFunctionProp: boolean;
      objType?: number;
      occurrence?: number;
    }
  | {
      type: "WriteProp";
      objIdx?: number;
      objType?: number;
      occurrence?: number;
      propId: number;
      startElement: number;
      count: number;
      data: Buffer;
      verify: boolean;
    }
  | {
      type: "CompareProp";
      objIdx?: number;
      objType?: number;
      occurrence?: number;
      propId: number;
      startElement: number;
      count: number;
      expected?: Buffer;
      mask?: Buffer;
      compareWithLoadedImage?: boolean;
    }
  | {
      type: "LoadImageProp";
      objIdx?: number;
      objType?: number;
      occurrence?: number;
      propId: number;
      startElement: number;
      count: number;
    }
  | { type: "LoadCompleted"; lsmIdx?: number; objType?: number; occurrence?: number }
  | {
      type: "ProgramSecurityObject";
      objectInstance: number;
      summary: {
        groupKeys: number;
        goFlagsLength: number;
        iaEntries: number;
        p2pKeys: number;
        writeToolKey: boolean;
        setSecurityMode?: boolean;
        writeSequenceNumberSending: boolean;
      };
    }
  | { type: "Delay"; milliseconds: number }
  | { type: "MasterReset"; eraseCode: number; channelNumber: number }
  | { type: "Restart" };

/**
 * Merged, concrete download execution plan ready for dry-run inspection or hardware download.
 */
export interface DownloadPlan {
  mode: DownloadMode;
  procedureSubType: string;
  maskVersion: number;
  managementModel: KnxManagementModel;
  actions: DownloadAction[];
  estimatedBytesToWrite: number;
}

export interface DownloadProgressEvent {
  stepIndex: number;
  totalSteps: number;
  phase: "verify" | "unload" | "allocate" | "write_memory" | "write_property" | "security" | "finalize" | "restart";
  message: string;
  bytesWritten: number;
  totalBytes: number;
  percent: number;
}

export interface DeviceDownloadOptions {
  /** Download mode (`"full"` = full application + tables, `"par"` = parameters only, `"grp"` = group tables only, `"par,grp"`, `"ap1"`, `"unload"`). Default: `"ap1"` (full Application 1 + tables, matching MV-07B0). */
  mode?: DownloadMode;
  /** Authorization key (defaults to KNX default key `0xFFFFFFFF`). */
  authorizeKey?: number | Buffer;
  /**
   * When true, compiles and validates the entire download plan and runs optional read-only device verification
   * WITHOUT writing a single byte or changing any device state.
   */
  dryRun?: boolean;
  /** Verify device MaskVersion, Manufacturer ID, and expected HardwareType before modifying device memory. Default: `true`. */
  verifyDeviceBeforeWrite?: boolean;
  /** Strictly enforce `HardwareType` check if declared in `.knxprod`. Default: `true`. */
  strictHardwareTypeCheck?: boolean;
  /** Maximum APDU length permitted by the local bus interface (USB/IP/TPUART). Default: `220` (matching ETS 215-byte extended write chunks). */
  interfaceMaxApduLength?: number;
  /** Skip runs of >= 8 bytes matching the `Fill` byte when segment was allocated with `Mode = 1`. Default: `true`. */
  skipFillRuns?: boolean;
  /**
   * Enable differential (byte-level delta) memory writing when `previousSegments` or `previousAbsoluteSegments`
   * is provided (automatically enabled on `mode: "par"` / `"par,grp"` when previous images are supplied).
   */
  differentialWrite?: boolean;
  /** Previous compiled RelativeSegment images keyed by LSM index (`4`, `5`, etc.) for differential delta writes. */
  previousSegments?: Map<number, Buffer>;
  /** Previous compiled AbsoluteSegment images keyed by XML `CodeSegment` Id for differential delta writes. */
  previousAbsoluteSegments?: Map<string, Buffer>;
  /** Memory write verification strategy: `"response"` (rely on confirmed `A_MemoryExtended_WriteResponse`, default for extended memory), `"readback"` (explicit read-back), or `"none"`. */
  verifyMemoryMode?: "response" | "readback" | "none";
  /** Skip `A_Restart` at the end of download (not recommended on real hardware unless chaining operations). Default: `false`. */
  skipRestart?: boolean;
  /**
   * Program Security Interface Object (Type 17) when `config.security` compiles a `securityImage`.
   * Defaults to `true` whenever `image.securityImage` is present (skipped on `"unload"` and plain `"par"` unless explicitly set to `true`).
   */
  programSecurityObject?: boolean;
  /** Optional session options (e.g. `{ secure: true }` for KNX Data Secure management sessions). */
  sessionOptions?: OpenSessionOptions;
  /**
   * Allow attempting download even if the `.knxprod` declares a proprietary ETS Download Plugin / DCA
   * (`app.extension.hasDownloadPlugin === true`). Default: `false` (fails fast with a descriptive error).
   */
  allowDcaOverride?: boolean;
  /** Skip `LdCtrlDelay` waits during download (mainly useful for unit tests / offline simulation). Default: `false`. */
  skipDelay?: boolean;
  /** Optional progress callback for UI/CLI feedback. */
  onProgress?: (event: DownloadProgressEvent) => void;
}

/**
 * Options for initial KNX Data Secure commissioning of a factory-new device (`FDSK -> ToolKey`, 03_05_03 §1.5.4.4–5).
 */
export interface CommissionSecureDeviceOptions {
  /** 16-byte Factory Default Setup Key (FDSK) printed on the device (Buffer, 32-char hex, or base64). */
  fdsk: Buffer | string;
  /** New 16-byte Tool Key to program into `PID_TOOL_KEY` (PID 56). Randomly generated via CSPRNG if omitted. */
  toolKey?: Buffer | string;
  /**
   * Initialize `PID_SEQUENCE_NUMBER_SENDING` (PID 59) if lower than target:
   * - `"auto"` (default): ms since `2018-01-05T00:00:00Z` per 03_05_03 §1.5.4.1
   * - `bigint | number`: explicit minimum sequence number
   * - `false`: skip sequence number initialization
   */
  initialSequenceNumberSending?: "auto" | bigint | number | false;
  /** Enable `PID_SECURITY_MODE = 1` before writing `PID_TOOL_KEY`. Default: `true`. */
  enableSecurityMode?: boolean;
  /** Perform Confirmed Restart (`A_Restart` eraseCode `0x01`) after writing `PID_TOOL_KEY`. Default: `true`. */
  restartAfterCommissioning?: boolean;
  /** Security Interface Object instance (default: `1`). */
  objectInstance?: number;
}

export interface CommissionSecureDeviceResult {
  individualAddress: string;
  toolKey: Buffer;
  toolKeyHex: string;
  securityModeEnabled: boolean;
  sequenceNumberSending?: bigint;
  restarted: boolean;
  executedSteps: string[];
}

export interface DevicePreflightInfo {
  individualAddress: string;
  maskVersion: number;
  maxApduLength: number;
  effectiveMaxApduLength: number;
  manufacturerId?: number;
  serialNumber?: string;
  hardwareType?: Buffer;
  orderInfo?: Buffer;
  firmwareVersion?: Buffer;
  currentProgramVersion?: Buffer;
  currentAppLoadState?: number;
  associationTableFormat: 0 | 1;
  accessLevel?: number;
}

export interface DeviceDownloadResult {
  individualAddress: string;
  mode: DownloadMode;
  dryRun: boolean;
  preflight?: DevicePreflightInfo;
  plan: DownloadPlan;
  image: CompiledSystemBImage;
  bytesWritten: number;
  framesSent: number;
  durationMs: number;
  loadedStamps: Map<string, Buffer>;
  executedSteps: string[];
}

export interface DeviceDiagnosticsOptions {
  /** Authorization key for plain sessions (defaults to `0xFFFFFFFF`). */
  authorizeKey?: number | Buffer;
  /** Optional management session options (e.g. `{ secure: true }` for KNX Data Secure devices). */
  sessionOptions?: OpenSessionOptions;
  /** Read Group Address Table (`GrAT`). Default: `true`. */
  includeGroupAddresses?: boolean;
  /** Read KNXnet/IP Parameter Object (Type 11) if present on the device. Default: `true`. */
  includeIpConfig?: boolean;
  /** Read KNX Data Secure Object (Type 17) status & failures log if present/accessible. Default: `true`. */
  includeSecurity?: boolean;
  /** Read Interface Object list (`PID_IO_LIST`). Default: `true`. */
  includeInterfaceObjects?: boolean;
}

/**
 * Complete ETS "Device Info" diagnostic snapshot read from a physical KNX device.
 * 100% JSON-serializable for web UIs, REST APIs, and bus-vs-project comparison.
 */
export interface DeviceDiagnosticsReport {
  individualAddress: string;
  inspectedAt: string;
  maskVersion: number;
  maskVersionHex: string;
  maskName?: string;
  managementModel: KnxManagementModel;
  manufacturerId?: number;
  manufacturerName?: string;
  serialNumber?: string;
  hardwareType?: string;
  orderInfo?: string;
  orderInfoText?: string;
  firmwareRevision?: number;
  firmwareVersionHex?: string;
  peiType?: number;
  maxApduLength: number;
  programmingMode?: boolean;
  programVersionHex?: string;
  applicationIdInfo?: {
    manufacturerId: number;
    applicationNumber: number;
    applicationVersion: number;
  };
  loadStates: { objectIndex: number; objectType?: number; state: number; stateName: string }[];
  runState?: { objectIndex: number; state: number; stateName: string };
  interfaceObjects: { objectIndex: number; objectType: number }[];
  groupAddressTable?: {
    method: string;
    tableAddress?: number;
    count: number;
    groupAddresses: string[];
  };
  ipConfig?: KnxIpInterfaceConfig;
  security?: {
    objectPresent: boolean;
    securityMode?: boolean;
    loadState?: number;
    loadStateName?: string;
    sequenceNumberSending?: string;
    groupKeyCount?: number;
    authorizedSenders?: string[];
    failuresLog?: {
      seqNrErrors: number;
      cryptoErrors: number;
      accessRoleErrors: number;
    };
  };
  warnings: string[];
}

// ============================================================================
// External Software / Web App Parameterization API (`DeviceConfigSession`)
// All types below are strictly JSON-serializable for REST/WebSocket/UI layers.
// ============================================================================

export type ParameterWidgetType =
  | "checkbox"
  | "select"
  | "number"
  | "float"
  | "text"
  | "color"
  | "ip"
  | "time"
  | "picture"
  | "raw"
  | "none";

export interface UiParameterOption {
  id: string;
  value: number;
  label: string;
  isBinary?: boolean;
}

export interface UiParameterField {
  kind: "parameter";
  paramId: string;
  paramRefId: string;
  name: string;
  label: string;
  suffixText?: string;
  access: "ReadWrite" | "Read" | "None";
  readOnly: boolean;
  widget: ParameterWidgetType;
  typeKind: KnxParameterType["detail"]["kind"];
  sizeInBit?: number;
  numberType?: "unsignedInt" | "signedInt" | "float";
  floatEncoding?: string;
  min?: number;
  max?: number;
  maxByteLength?: number;
  pattern?: string;
  unit?: string;
  colorSpace?: string;
  ipVersion?: string;
  baggageRefId?: string;
  options?: UiParameterOption[];
  indentLevel: number;
  value: string;
  defaultValue: string;
  isModified: boolean;
  channelId?: string;
  blockId?: string;
}

export interface UiSeparatorItem {
  kind: "separator";
  id?: string;
  text: string;
  uiHint?: string;
}

export type UiBlockItem = UiParameterField | UiSeparatorItem;

export interface UiParameterBlockNode {
  id: string;
  name: string;
  label: string;
  items: UiBlockItem[];
  blocks: UiParameterBlockNode[];
}

export interface UiChannelNode {
  id: string;
  name: string;
  label: string;
  isIndependent: boolean;
  blocks: UiParameterBlockNode[];
  items: UiBlockItem[];
}

export interface UiComObject {
  number: number;
  comObjectId: string;
  comObjectRefId: string;
  name: string;
  label: string;
  functionText: string;
  objectSize: string;
  valueTypeCode: number;
  datapointType?: string;
  priority: GroupObjectPriority;
  flags: {
    communication: boolean;
    read: boolean;
    write: boolean;
    transmit: boolean;
    update: boolean;
    readOnInit: boolean;
  };
  sendingGroupAddress?: string;
  groupAddresses: string[];
  /** Explicit per-object security override (`undefined` = inherits `security.defaultGroupSecurityMode`). */
  securityOverride?: GroupObjectSecurityMode;
  /** Effective KNX Data Secure protection level computed for this Group Object. */
  effectiveSecurity: GroupObjectSecurityMode;
}

export interface DeviceCatalogSummary {
  sourceName?: string;
  applicationId: string;
  name: string;
  visibleDescription?: string;
  manufacturerId: number;
  manufacturerRefId: string;
  applicationNumber: number;
  applicationVersion: number;
  maskVersionId: string;
  maskVersion: number;
  /** Resolved KNX Management Model (`"SystemB"`, `"BimM112"`, `"Bcu2"`, `"Bcu1"`, `"PropertyBased"`, `"None"`). */
  managementModel: KnxManagementModel;
  /** True if the catalog declares a proprietary ETS Plugin / Device Configuration App (DCA). */
  requiresDca: boolean;
  /** Detailed ETS Plugin / DCA metadata (if present in the `.knxprod`). */
  extension?: KnxApplicationExtensionInfo;
  parameterByteOrder: "BigEndian" | "LittleEndian";
  isSecureEnabled: boolean;
  defaultLanguage: string;
  loadedLanguage?: string;
  availableLanguages: string[];
  addressTableMaxEntries: number;
  associationTableMaxEntries: number;
  maxSecurityGroupKeyTableEntries?: number;
  maxSecurityIndividualAddressEntries?: number;
  maxSecurityP2PKeyTableEntries?: number;
  totalParameters: number;
  totalComObjects: number;
  hardware: {
    id: string;
    name: string;
    serialNumber?: string;
    products: { id: string; text: string; orderNumber: string }[];
  }[];
}

export interface ConfigValidationIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface DeviceConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationIssue[];
  warnings: ConfigValidationIssue[];
}

export interface SerializedGroupObjectLink {
  sending?: string;
  listening?: string[];
  flags?: Partial<{
    communication: boolean;
    read: boolean;
    write: boolean;
    transmit: boolean;
    update: boolean;
    readOnInit: boolean;
    priority: GroupObjectPriority;
  }>;
  security?: GroupObjectSecurityMode;
}

export interface SerializedDeviceSecurityConfig {
  enabled?: boolean;
  groupKeys?: Record<string, string>;
  defaultGroupSecurityMode?: GroupObjectSecurityMode;
  groupObjectSecurityModes?: Record<string, GroupObjectSecurityMode>;
  authorizedSenders?: { individualAddress: string; lastValidSeqNr?: string }[];
  includeKeyringSenders?: boolean;
  p2pKeys?: { individualAddress: string; key: string; roles?: number }[];
  toolKey?: string;
  enableSecurityMode?: boolean;
  initialSequenceNumberSending?: "auto" | string;
  objectInstance?: number;
}

export interface SerializedDeviceConfig {
  schemaVersion: 1;
  applicationId: string;
  language?: string;
  parameters: Record<string, string>;
  groupLinks: Record<string, SerializedGroupObjectLink>;
  security?: SerializedDeviceSecurityConfig;
  options?: {
    runParameterCalculations?: boolean;
    associationTableFormat?: 0 | 1;
    clearCommunicationFlagWhenUnlinked?: boolean;
    groupObjectTableSize?: number;
    individualAddress?: string;
    filterTableHex?: string;
    isAreaCoupler?: boolean;
  };
}

export interface DeviceUiState {
  catalog: DeviceCatalogSummary;
  channels: UiChannelNode[];
  parameters: UiParameterField[];
  comObjects: UiComObject[];
  security: {
    isSupportedByApplication: boolean;
    enabled: boolean;
    defaultGroupSecurityMode: GroupObjectSecurityMode;
    configuredGroupKeyCount: number;
    authorizedSenderCount: number;
    p2pKeyCount: number;
    hasToolKeyOverride: boolean;
    enableSecurityMode?: boolean;
  };
  stats: {
    visibleParameters: number;
    modifiedParameters: number;
    activeComObjects: number;
    linkedComObjects: number;
    uniqueGroupAddresses: number;
    secureGroupObjects: number;
  };
  warnings: string[];
}

export interface ConfigMutationResult {
  changed: boolean;
  addedParameters: string[];
  removedParameters: string[];
  addedComObjects: number[];
  removedComObjects: number[];
  warnings: string[];
  state: DeviceUiState;
}

export interface EnsureSecurityKeysOptions {
  /**
   * Optional `KnxKeyring` to check for existing keys and populate with newly generated Group Keys.
   * If provided and the session has no keyring attached yet, it is automatically attached to the session.
   */
  keyring?: KnxKeyring;
  /** Generate random 16-byte AES keys for every active linked secure ComObject missing a key (default: `true`). */
  generateMissingGroupKeys?: boolean;
  /** Generate a random 16-byte Tool Key on the session if none is configured (default: `false`). */
  generateToolKey?: boolean;
  /** Set `security.enabled = true` on the session (default: `true`). */
  enableSecurity?: boolean;
  /**
   * Store newly generated Group Keys inside `session.security.groupKeys` in addition to any `keyring`.
   * Defaults to `true` when no `keyring` is provided, and `false` when a `keyring` is provided (keeping secrets centralized).
   */
  storeInSession?: boolean;
}

export interface EnsureSecurityKeysResult {
  /** Newly generated Group Keys mapped by canonical 3-level Group Address (`"1/0/1"` -> uppercase 32-char hex). */
  generatedGroupKeys: Record<string, string>;
  /** Newly generated 16-byte Tool Key (uppercase 32-char hex) if `generateToolKey` created one. */
  generatedToolKey?: string;
  /** Resulting session mutation diff and updated UI state. */
  mutation: ConfigMutationResult;
}

export interface ExportSessionToKeyringOptions {
  /** Individual Address of the device represented by this session (e.g. `"1.1.1"`). */
  individualAddress: string;
  /** Existing `KnxKeyring` to merge this device into (creates a new keyring if omitted). */
  keyring?: KnxKeyring;
  /** Project name used when creating a new keyring (defaults to the catalog application name). */
  project?: string;
  /** Explicit 16-byte Device Tool Key (falls back to `session.security.toolKey`, `keyring`, or `dataSecure`). */
  toolKey?: Buffer | string;
  /** Next sending 48-bit Sequence Number (falls back to `initialSequenceNumberSending` or `dataSecure`). */
  sequenceNumber?: bigint | number;
  /** 6-byte KNX Serial Number (12-char hex or 6-byte Buffer, e.g. from `downloadResult.preflight?.serialNumber`). */
  serialNumber?: Buffer | string;
  /** Optional plaintext Management Password for the `<Device>` entry. */
  managementPassword?: string;
  /** Optional plaintext Authentication Code for the `<Device>` entry. */
  authentication?: string;
  /** Optional runtime `KnxDataSecure` manager to pull live ToolKey, SerialNumber, Group Keys, and Sequence Numbers. */
  dataSecure?: KnxDataSecure;
  /** Optional Interface / Gateway Individual Address (e.g. `"1.1.200"`) to populate `<Interface>` group sender links. */
  interfaceAddress?: string;
  /** Interface `Type` attribute when creating `<Interface>` (default: `"Tunnelling"`). */
  interfaceType?: string;
  /** Optional Interface `Host` Individual Address. */
  interfaceHost?: string;
  /** Optional Interface `UserID`. */
  interfaceUserId?: number;
  /** Optional plaintext Tunneling User Password for `<Interface>`. */
  interfacePassword?: string;
  /** Optional plaintext Interface Authentication Code for `<Interface>`. */
  interfaceAuthentication?: string;
  /** Optional runtime security overrides (same as `validate()` / `compile()`). */
  runtimeSecurity?: Partial<DeviceSecurityConfig>;
}
