import type { FlagSetting, GroupObjectPriority, KnxApplicationProgram, ParsedKnxProd } from "../programming/types";

/**
 * ETS Group Address display/structuring style declared on `<ProjectInformation GroupAddressStyle="...">`.
 */
export type GroupAddressStyle = "ThreeLevel" | "TwoLevel" | "Free";

/**
 * Standard KNX Space types used under `<Locations><Space Type="...">`.
 */
export type KnxSpaceType =
  | "Building"
  | "BuildingPart"
  | "Floor"
  | "Room"
  | "DistributionBoard"
  | "Stairway"
  | "Corridor"
  | "Cabinet"
  | "Zone"
  | (string & {});

/**
 * Parsed ETS project certificate metadata (from `P-XXXX.certificate`).
 */
export interface KnxProjectCertificateInfo {
  id?: string;
  license?: string;
  customer?: string;
  number?: string;
  date?: string;
  time?: string;
  publicKey?: string;
}

/**
 * High-level archive & XML container metadata of a `.knxproj` file.
 */
export interface KnxProjectArchiveMetadata {
  /** Project ID prefix, e.g. `"P-0596"`. */
  projectId: string;
  /** Numeric XML schema version parsed from `xmlns="http://knx.org/xml/project/<N>"` (e.g. `20`, `21`, `23`). */
  schemaVersion: number;
  /** Full XML namespace URI (e.g. `"http://knx.org/xml/project/20"`). */
  xmlns: string;
  /** Tool that originally created/exported the project (e.g. `"ETS5"`, `"ETS6"`, `"KNX.ts"`). */
  createdBy: string;
  /** Tool version string (e.g. `"5.7.1428.39779"` or `"2.3.1"`). */
  toolVersion: string;
  /** Original filename if loaded from disk or supplied with `sourceName`. */
  sourceFileName?: string;
  /** Whether the archive stored the project inside an encrypted inner `P-XXXX.zip`. */
  isPasswordProtected: boolean;
  /** Whether the source archive contained `P-XXXX.signature`. */
  hasProjectSignature: boolean;
  /** Parsed `P-XXXX.certificate` details if present in the source archive. */
  certificate?: KnxProjectCertificateInfo;
  /** Loaded translation language code if requested on open (e.g. `"es-ES"`). */
  loadedLanguage?: string;
  /** Whether the project has been mutated since load/creation. */
  isModified: boolean;
}

/**
 * Parsed `<ProjectInformation>` attributes from `P-XXXX/project.xml`.
 */
export interface KnxProjectInfo {
  id: string;
  name: string;
  groupAddressStyle: GroupAddressStyle;
  comment?: string;
  completionStatus?: string;
  projectNumber?: string;
  contractNumber?: string;
  orderNumber?: string;
  projectStart?: string;
  projectEnd?: string;
  lastModified?: string;
  guid?: string;
  lastUsedPuid: number;
  codePage?: string;
  busAccessLegacyMode?: boolean;
  projectTracingLevel?: string;
  hide16BitGroupsFromLegacyPlugins?: boolean;
  deviceCount?: number;
  extraAttrs?: Record<string, string>;
}

/**
 * Optional project-level history entry from `P-XXXX/project.xml` `<HistoryEntries>`.
 */
export interface KnxProjectHistoryEntry {
  date?: string;
  user?: string;
  text?: string;
  detail?: string;
  extraAttrs?: Record<string, string>;
}

/**
 * Optional project-level user file reference from `P-XXXX/project.xml` `<UserFiles>`.
 */
export interface KnxProjectUserFile {
  filename: string;
  comment?: string;
  extraAttrs?: Record<string, string>;
}

// ============================================================================
// Master Data (`knx_master.xml`)
// ============================================================================

export interface KnxMasterManufacturer {
  id: string;
  numericId: number;
  name: string;
}

export interface KnxMasterMediumType {
  id: string;
  number: number;
  name: string;
  text: string;
  domainAddressLength?: number;
}

export interface KnxMasterDatapointSubtype {
  id: string;
  dptId: string;
  dptNumber: number;
  number: number;
  /** Formatted KNX DPT notation, e.g. `"1.001"`, `"9.001"`, `"10.001"`. */
  formatted: string;
  name: string;
  text: string;
  sizeInBit: number;
  isDefault?: boolean;
}

export interface KnxMasterDatapointType {
  id: string;
  number: number;
  name: string;
  text: string;
  sizeInBit: number;
  pdt?: string;
  subtypes: KnxMasterDatapointSubtype[];
}

export interface KnxMasterNamedRef {
  id: string;
  number?: number;
  text: string;
  description?: string;
}

export interface KnxMasterData {
  version?: number;
  schemaVersion?: number;
  manufacturers: Record<string, KnxMasterManufacturer>;
  mediumTypes: Record<string, KnxMasterMediumType>;
  datapointTypes: Record<string, KnxMasterDatapointType>;
  datapointSubtypes: Record<string, KnxMasterDatapointSubtype>;
  spaceUsages: Record<string, KnxMasterNamedRef>;
  functionTypes: Record<string, KnxMasterNamedRef>;
}

// ============================================================================
// Embedded Manufacturer Catalogs (`M-XXXX/Hardware.xml`, `Catalog.xml`, `Baggages.xml`)
// ============================================================================

export interface KnxProjectHardwareProduct {
  id: string;
  text: string;
  orderNumber: string;
  isRailMounted?: boolean;
  widthInMillimeter?: number;
  defaultLanguage?: string;
  hash?: string;
  attributes?: Record<string, string>;
}

export interface KnxProjectHardware2Program {
  id: string;
  mediumTypes: string[];
  applicationProgramRefIds: string[];
  hash?: string;
  registrationStatus?: string;
  registrationNumber?: string;
}

export interface KnxProjectHardwareEntry {
  id: string;
  manufacturerId: string;
  name: string;
  serialNumber?: string;
  versionNumber?: number;
  busCurrent?: number;
  hasIndividualAddress: boolean;
  hasApplicationProgram: boolean;
  isPowerSupply?: boolean;
  isChoke?: boolean;
  isCoupler?: boolean;
  isPowerLineRepeater?: boolean;
  isPowerLineSignalFilter?: boolean;
  isCable?: boolean;
  isIPEnabled?: boolean;
  products: KnxProjectHardwareProduct[];
  hardware2Programs: KnxProjectHardware2Program[];
}

export interface KnxCatalogItem {
  id: string;
  name: string;
  number?: string;
  visibleDescription?: string;
  productRefId: string;
  hardware2ProgramRefId?: string;
  defaultLanguage?: string;
}

export interface KnxCatalogSection {
  id: string;
  name: string;
  number?: string;
  visibleDescription?: string;
  defaultLanguage?: string;
  sections: KnxCatalogSection[];
  items: KnxCatalogItem[];
}

export interface KnxBaggageFile {
  id: string;
  manufacturerId: string;
  targetPath: string;
  name: string;
  timeInfo?: string;
  /** Relative ZIP entry path inside the `.knxproj`, e.g. `"M-0071/Baggages/Z35_3_1/icons.zip"`. */
  zipEntryPath: string;
  /** Guessed MIME type from filename extension (e.g. `"image/png"`, `"application/pdf"`). */
  mimeType?: string;
}

export interface KnxBaggageContent extends KnxBaggageFile {
  filename: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

export interface KnxManufacturerCatalog {
  manufacturerId: string;
  numericId: number;
  name: string;
  hasSignature: boolean;
  hardware: KnxProjectHardwareEntry[];
  catalogSections: KnxCatalogSection[];
  /** ApplicationProgram ID -> ZIP entry path + uncompressed XML size in bytes. */
  applicationFiles: Record<string, { zipEntryPath: string; uncompressedSize: number }>;
  baggages: KnxBaggageFile[];
}

// ============================================================================
// Project Installation Model (`P-XXXX/0.xml`)
// ============================================================================

export interface KnxParameterInstanceRef {
  refId: string;
  value: string;
  extraAttrs?: Record<string, string>;
}

export interface KnxComObjectInstanceRef {
  /** Reference ID as stored in `0.xml` (e.g. `"O-6_R-3713"` or `"MD-1_M-1_MI-1_O-2-0_R-4"` or full AppId-prefixed ID). */
  refId: string;
  text?: string;
  description?: string;
  functionText?: string;
  datapointType?: string;
  channelId?: string;
  /** Raw Group Address reference IDs from `Links="..."` (e.g. `["GA-1", "GA-2064"]`). First entry is the sending GA. */
  links: string[];
  communicationFlag?: FlagSetting;
  readFlag?: FlagSetting;
  writeFlag?: FlagSetting;
  transmitFlag?: FlagSetting;
  updateFlag?: FlagSetting;
  readOnInitFlag?: FlagSetting;
  priority?: GroupObjectPriority;
  isActive?: boolean;
  acknowledged?: boolean;
  extraAttrs?: Record<string, string>;
}

export interface KnxModuleInstanceArgument {
  refId: string;
  value: string;
  extraAttrs?: Record<string, string>;
}

export interface KnxModuleInstance {
  id: string;
  refId: string;
  repeatIndex?: string;
  arguments: KnxModuleInstanceArgument[];
  extraAttrs?: Record<string, string>;
}

export interface KnxGroupObjectTreeNode {
  type?: string;
  refId?: string;
  text?: string;
  groupObjectInstances?: string[];
  nodes: KnxGroupObjectTreeNode[];
  extraAttrs?: Record<string, string>;
}

export interface KnxGroupObjectTree {
  groupObjectInstances?: string[];
  nodes: KnxGroupObjectTreeNode[];
  extraAttrs?: Record<string, string>;
}

export interface KnxAdditionalAddress {
  address: number;
  name?: string;
  description?: string;
  comment?: string;
  extraAttrs?: Record<string, string>;
}

export interface KnxDeviceIpConfig {
  assign?: string;
  ipAddress?: string;
  subnetMask?: string;
  defaultGateway?: string;
  macAddress?: string;
  extraAttrs?: Record<string, string>;
}

export interface KnxDeviceSecurity {
  loadedIpRoutingBackboneKey?: string;
  deviceAuthenticationCode?: string;
  deviceAuthenticationCodeHash?: string;
  loadedDeviceAuthenticationCodeHash?: string;
  deviceManagementPassword?: string;
  deviceManagementPasswordHash?: string;
  loadedDeviceManagementPasswordHash?: string;
  toolKey?: string;
  loadedToolKey?: string;
  sequenceNumber?: string;
  sequenceNumberTimestamp?: string;
  extraAttrs?: Record<string, string>;
}

export interface KnxBinaryDataEntry {
  name?: string;
  internalDescription?: string;
  dataBase64: string;
  extraAttrs?: Record<string, string>;
}

export interface KnxBusInterfaceConnector {
  groupAddressRefId: string;
  extraAttrs?: Record<string, string>;
}

/**
 * IP Tunneling / gateway BusInterface entry under `<DeviceInstance><BusInterfaces><BusInterface ...>`.
 */
export interface KnxBusInterface {
  refId: string;
  name?: string;
  description?: string;
  comment?: string;
  password?: string;
  passwordHash?: string;
  connectors: KnxBusInterfaceConnector[];
  extraAttrs?: Record<string, string>;
}

export interface KnxDeviceInstance {
  id: string;
  /** Device address within its line (`0..255`), omitted if unassigned/dynamic. */
  address?: number;
  name?: string;
  description?: string;
  comment?: string;
  productRefId?: string;
  hardware2ProgramRefId?: string;
  /** Base64-encoded 6-byte KNX Serial Number as stored in ETS XML. */
  serialNumber?: string;
  /** Decoded 12-character uppercase hex KNX Serial Number (derived from `serialNumber` if valid 6-byte base64). */
  serialNumberHex?: string;
  uniqueNumber?: string;
  completionStatus?: string;
  puid?: number;
  applicationProgramLoaded?: boolean;
  communicationPartLoaded?: boolean;
  individualAddressLoaded?: boolean;
  mediumConfigLoaded?: boolean;
  parametersLoaded?: boolean;
  isActivityCalculated?: boolean;
  broken?: boolean;
  lastModified?: string;
  lastDownload?: string;
  lastUsedApduLength?: number;
  readMaxApduLength?: number;
  readMaxRoutingApduLength?: number;
  checkSums?: string;
  loadedImage?: string;
  parameterInstanceRefs: KnxParameterInstanceRef[];
  comObjectInstanceRefs: KnxComObjectInstanceRef[];
  moduleInstances: KnxModuleInstance[];
  groupObjectTree?: KnxGroupObjectTree;
  additionalAddresses: KnxAdditionalAddress[];
  ipConfig?: KnxDeviceIpConfig;
  security?: KnxDeviceSecurity;
  busInterfaces: KnxBusInterface[];
  binaryData: KnxBinaryDataEntry[];
  /** Preserves unmodeled child XML elements (e.g. `<Channels>`) verbatim for lossless round-trip. */
  rawExtraChildren?: string[];
  extraAttrs?: Record<string, string>;
}

export interface KnxSegment {
  id: string;
  number: number;
  name?: string;
  description?: string;
  comment?: string;
  mediumTypeRefId?: string;
  puid?: number;
  devices: KnxDeviceInstance[];
  rawExtraChildren?: string[];
  extraAttrs?: Record<string, string>;
}

export interface KnxLine {
  id: string;
  address: number;
  name: string;
  description?: string;
  comment?: string;
  mediumTypeRefId: string;
  domainAddress?: string;
  completionStatus?: string;
  puid?: number;
  /** Direct `<DeviceInstance>` children (ETS4/ETS5 schema <= 20, or flat lines). */
  devices: KnxDeviceInstance[];
  /** Optional ETS6 `<Segment>` children (schema >= 21). */
  segments: KnxSegment[];
  /** Manual filter-table Group Addresses under `<AdditionalGroupAddresses>`. */
  additionalGroupAddresses: number[];
  rawExtraChildren?: string[];
  extraAttrs?: Record<string, string>;
}

export interface KnxArea {
  id: string;
  address: number;
  name: string;
  description?: string;
  comment?: string;
  completionStatus?: string;
  puid?: number;
  lines: KnxLine[];
  rawExtraChildren?: string[];
  extraAttrs?: Record<string, string>;
}

export interface KnxTopology {
  areas: KnxArea[];
  unassignedDevices: KnxDeviceInstance[];
  rawExtraChildren?: string[];
}

export interface KnxGroupAddressRef {
  id?: string;
  refId: string;
  name?: string;
  role?: string;
  puid?: number;
  extraAttrs?: Record<string, string>;
}

export interface KnxFunction {
  id: string;
  name: string;
  type: string;
  number?: string;
  description?: string;
  comment?: string;
  defaultGroupRange?: string;
  completionStatus?: string;
  puid?: number;
  groupAddressRefs: KnxGroupAddressRef[];
  rawExtraChildren?: string[];
  extraAttrs?: Record<string, string>;
}

export interface KnxSpace {
  id: string;
  type: KnxSpaceType;
  name: string;
  number?: string;
  description?: string;
  comment?: string;
  usage?: string;
  defaultLine?: string;
  completionStatus?: string;
  puid?: number;
  deviceInstanceRefs: string[];
  functions: KnxFunction[];
  spaces: KnxSpace[];
  rawExtraChildren?: string[];
  extraAttrs?: Record<string, string>;
}

export interface KnxGroupAddress {
  id: string;
  /** 16-bit unsigned integer group address (`0..65535`). */
  address: number;
  name: string;
  description?: string;
  comment?: string;
  /** Raw ETS datapoint type ID, e.g. `"DPST-1-1"` or `"DPT-1"`. */
  datapointType?: string;
  central?: boolean;
  unfiltered?: boolean;
  /** Security setting: `"Auto" | "On" | "Off"`. */
  security?: string;
  /** Base64 or hex 16-byte Data Secure group key (when stored in project). */
  key?: string;
  puid?: number;
  extraAttrs?: Record<string, string>;
}

export interface KnxGroupRange {
  id: string;
  name: string;
  rangeStart: number;
  rangeEnd: number;
  description?: string;
  comment?: string;
  unfiltered?: boolean;
  security?: string;
  puid?: number;
  groupRanges: KnxGroupRange[];
  groupAddresses: KnxGroupAddress[];
  extraAttrs?: Record<string, string>;
}

export interface KnxTrade {
  id: string;
  name: string;
  number?: string;
  description?: string;
  comment?: string;
  completionStatus?: string;
  puid?: number;
  deviceInstanceRefs: string[];
  trades: KnxTrade[];
  rawExtraChildren?: string[];
  extraAttrs?: Record<string, string>;
}

export interface KnxInstallation {
  /** File index inside `P-XXXX/`, typically `"0"` (for `0.xml`). */
  installationId: string;
  name: string;
  bcuKey?: string;
  defaultLine?: string;
  ipRoutingLatencyTolerance?: number;
  ipRoutingMulticastAddress?: string;
  ipRoutingBackboneKey?: string;
  ipRoutingBackboneGroup?: string;
  splitType?: string;
  topology: KnxTopology;
  locations: KnxSpace[];
  groupRanges: KnxGroupRange[];
  trades: KnxTrade[];
  /** Preserves unmodeled top-level sections (e.g. `<SplitInfos>`) verbatim for lossless round-trip. */
  rawExtraSections?: string[];
  extraAttrs?: Record<string, string>;
}

// ============================================================================
// Enriched / View / Query / API DTOs (100% JSON-serializable for Web Apps)
// ============================================================================

export interface ResolvedDatapointTypeInfo {
  raw: string;
  main?: number;
  sub?: number;
  formatted: string;
  name?: string;
  text?: string;
  sizeInBit?: number;
}

export interface KnxDeviceSummary {
  id: string;
  installationId: string;
  areaAddress?: number;
  lineAddress?: number;
  segmentNumber?: number;
  address?: number;
  individualAddress?: string;
  name: string;
  description: string;
  comment: string;
  productRefId?: string;
  hardware2ProgramRefId?: string;
  applicationProgramRefId?: string;
  manufacturerId?: string;
  manufacturerName?: string;
  hardwareName?: string;
  productName?: string;
  orderNumber?: string;
  serialNumberHex?: string;
  locationPath?: string;
  spaceIds: string[];
  tradeIds: string[];
  ipAddress?: string;
  macAddress?: string;
  parameterCount: number;
  comObjectCount: number;
  linkedComObjectCount: number;
  hasSecurity: boolean;
  isLoaded: {
    applicationProgram?: boolean;
    communicationPart?: boolean;
    individualAddress?: boolean;
    mediumConfig?: boolean;
    parameters?: boolean;
  };
  lastModified?: string;
  lastDownload?: string;
}

export interface KnxResolvedComObjectInstance extends KnxComObjectInstanceRef {
  /** Resolved canonical Group Addresses (formatted according to project style). */
  groupAddresses: string[];
  /** Resolved full GroupAddress summaries for each link (first is sending). */
  linkedGroupAddresses: {
    id: string;
    shortId: string;
    address: number;
    addressFormatted: string;
    name: string;
    datapointType?: string;
    dpt?: ResolvedDatapointTypeInfo;
    isSending: boolean;
  }[];
  dpt?: ResolvedDatapointTypeInfo;
  /** Optional metadata enriched from the embedded `M-XXXX_A-*.xml` when `resolveCatalog: true`. */
  catalogInfo?: {
    comObjectId: string;
    comObjectRefId: string;
    number: number;
    name: string;
    text: string;
    functionText: string;
    objectSize: string;
    datapointType?: string;
  };
}

export interface KnxResolvedParameterInstance extends KnxParameterInstanceRef {
  /** Optional metadata enriched from the embedded `M-XXXX_A-*.xml` when `resolveCatalog: true`. */
  catalogInfo?: {
    parameterId?: string;
    name?: string;
    text?: string;
    defaultValue?: string;
    enumText?: string;
    suffixText?: string;
  };
}

export interface KnxDeviceDetails extends KnxDeviceSummary {
  serialNumber?: string;
  uniqueNumber?: string;
  completionStatus?: string;
  puid?: number;
  lastUsedApduLength?: number;
  readMaxApduLength?: number;
  readMaxRoutingApduLength?: number;
  additionalAddresses: KnxAdditionalAddress[];
  ipConfig?: KnxDeviceIpConfig;
  security?: KnxDeviceSecurity;
  busInterfaces: KnxBusInterface[];
  moduleInstances: KnxModuleInstance[];
  groupObjectTree?: KnxGroupObjectTree;
  comObjects: KnxResolvedComObjectInstance[];
  parameters: KnxResolvedParameterInstance[];
  hasLoadedImage: boolean;
  hasCheckSums: boolean;
  hasEmbeddedApplicationXml: boolean;
}

export interface KnxGroupAddressView extends KnxGroupAddress {
  installationId: string;
  /** Short ID used in `ComObjectInstanceRef/@Links` (e.g. `"GA-1"`). */
  shortId: string;
  /** Formatted address matching the project's `GroupAddressStyle` (`"1/0/1"`, `"1/1"`, or `"257"`). */
  addressFormatted: string;
  /** Always 3-level notation (`"1/0/1"`), useful for interoperability with KNX runtime tools. */
  address3Level: string;
  /** Parent range ID path from root to immediate parent. */
  rangePathIds: string[];
  /** Parent range name path, e.g. `"Generales / Hora y Fecha"`. */
  rangePath: string;
  dpt?: ResolvedDatapointTypeInfo;
  linkedDeviceCount: number;
  linkedComObjectCount: number;
}

export interface KnxGroupAddressLinkEntry {
  deviceId: string;
  individualAddress?: string;
  deviceName: string;
  deviceDescription: string;
  productName?: string;
  comObjectRefId: string;
  comObjectText?: string;
  channelId?: string;
  datapointType?: string;
  isSending: boolean;
  flags: {
    communication?: FlagSetting;
    read?: FlagSetting;
    write?: FlagSetting;
    transmit?: FlagSetting;
    update?: FlagSetting;
    readOnInit?: FlagSetting;
  };
}

export interface KnxCommunicationMatrixEntry {
  groupAddress: KnxGroupAddressView;
  links: KnxGroupAddressLinkEntry[];
}

export interface KnxProjectStats {
  installations: number;
  areas: number;
  lines: number;
  segments: number;
  devices: number;
  assignedDevices: number;
  unassignedDevices: number;
  groupRanges: number;
  groupAddresses: number;
  linkedGroupAddresses: number;
  unlinkedGroupAddresses: number;
  comObjectInstances: number;
  totalLinks: number;
  parameterInstances: number;
  spaces: number;
  functions: number;
  trades: number;
  manufacturers: number;
  embeddedCatalogProducts: number;
  embeddedApplicationFiles: number;
  embeddedBaggages: number;
}

export interface KnxProjectSummary {
  metadata: KnxProjectArchiveMetadata;
  projectInfo: KnxProjectInfo;
  stats: KnxProjectStats;
  manufacturers: {
    manufacturerId: string;
    name: string;
    productCount: number;
    applicationCount: number;
    deviceCount: number;
    hasSignature: boolean;
  }[];
}

export interface KnxProjectValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityType?: "project" | "area" | "line" | "device" | "groupRange" | "groupAddress" | "space" | "trade" | "catalog";
  entityId?: string;
}

export interface KnxProjectValidationResult {
  valid: boolean;
  errors: KnxProjectValidationIssue[];
  warnings: KnxProjectValidationIssue[];
}

export interface KnxProjectSearchResult {
  devices: KnxDeviceSummary[];
  groupAddresses: KnxGroupAddressView[];
  groupRanges: { id: string; name: string; rangeStart: number; rangeEnd: number; path: string }[];
  spaces: { id: string; type: string; name: string; path: string }[];
  functions: { id: string; name: string; type: string; spaceId: string; spacePath: string }[];
  trades: { id: string; name: string; path: string }[];
  products: {
    manufacturerId: string;
    manufacturerName: string;
    productRefId: string;
    hardware2ProgramRefId?: string;
    text: string;
    orderNumber: string;
  }[];
}

export type KnxFilterTableReason = "cross-line" | "cross-area" | "unfiltered" | "manual-additional";

export interface KnxFilterTableEntry {
  address: number;
  addressFormatted: string;
  groupAddressId?: string;
  name?: string;
  reasons: KnxFilterTableReason[];
  sourceLines: string[];
}

export interface KnxCouplerFilterTable {
  couplerType: "area" | "line";
  areaAddress: number;
  lineAddress?: number;
  /** Standard KNX coupler Individual Address (`"A.0.0"` for area coupler, `"A.L.0"` for line coupler). */
  couplerAddress: string;
  name: string;
  groupAddressCount: number;
  groupAddresses: KnxFilterTableEntry[];
  /** Standard KNX 8192-byte (65536-bit) filter table bitmask encoded as uppercase hex (bit `addr` = 1 if routed). */
  filterTableBitmaskHex: string;
}

export interface KnxProjectFilterTables {
  installationId: string;
  areaCouplers: KnxCouplerFilterTable[];
  lineCouplers: KnxCouplerFilterTable[];
}

/**
 * External user-supplied catalog resolver callback.
 * Allows backends/web apps to store manufacturer `.knxprod` files centrally and supply them
 * on demand when opening a `DeviceConfigSession` or resolving device catalog metadata.
 */
export type KnxExternalCatalogProvider = (
  applicationId: string,
  options?: { language?: string; manufacturerId?: string; productRefId?: string },
) =>
  | Promise<KnxApplicationProgram | ParsedKnxProd | Buffer | string | undefined>
  | KnxApplicationProgram
  | ParsedKnxProd
  | Buffer
  | string
  | undefined;

export type ExternalKnxProdInput = KnxApplicationProgram | ParsedKnxProd | Buffer | string;

export interface ImportKnxProdOptions {
  /** Optional language code for translating catalog/product names when indexing. */
  language?: string;
  /**
   * Whether to copy the large `M-XXXX/M-XXXX_A-*.xml` file(s) into the exported `.knxproj` (default: `true`).
   * Set to `false` to keep projects lightweight when your backend supplies `.knxprod` files externally at runtime.
   */
  embedApplicationXml?: boolean;
}

// ============================================================================
// Options & Mutation Input Types
// ============================================================================

export interface KnxProjectParseOptions {
  /** Project password for password-protected ETS5 (ZipCrypto) or ETS6 (WinZip AES-256) `.knxproj` files. */
  password?: string;
  /** Optional language code (e.g. `"es-ES"`, `"en-US"`) for localized catalog & master data labels. */
  language?: string;
}

export interface KnxProjectCreateOptions {
  name: string;
  /** Optional custom project ID (defaults to random `"P-XXXX"`). */
  projectId?: string;
  groupAddressStyle?: GroupAddressStyle;
  comment?: string;
  projectNumber?: string;
  contractNumber?: string;
  orderNumber?: string;
  completionStatus?: string;
  /** Schema version for XML serialization (default: `20`, ETS5.7+ widely compatible). */
  schemaVersion?: number;
  createdBy?: string;
  toolVersion?: string;
  /** Automatically create Backbone Area 0 / Line 0.0 and Area 1 / Line 1.1 (default: `true`). */
  createDefaultTopology?: boolean;
  /** Optional custom `knx_master.xml` content (XML string, `Buffer`, or path to a `.xml` file on disk). */
  masterXml?: string | Buffer;
}

export interface KnxProjectExportOptions {
  /**
   * Preserve original `P-XXXX.signature`, `P-XXXX.certificate` and `.validation` entries from source archive.
   * Defaults to `false` whenever the project was created or modified (since stale signatures fail validation),
   * and `true` only if unmodified and explicitly requested.
   */
  preserveProjectSignature?: boolean;
  /** Update `ProjectInformation/@LastModified` to current UTC ISO timestamp before export (default: `true` if modified). */
  updateLastModified?: boolean;
  /** zlib compression level `1..9` for newly written XML entries (default: `6`). */
  compressionLevel?: number;
  /** Override target XML schema version (defaults to the project's `metadata.schemaVersion`). */
  targetSchemaVersion?: number;
  /**
   * Optional project password to export a password-protected `.knxproj` with an encrypted inner `P-XXXX.zip`.
   */
  password?: string;
  /**
   * Encryption mode when `password` is provided:
   * - `"auto"` *(default)*: `"ets6"` (WinZip AES-256 + PBKDF2 `21.ets.knx.org`) if `targetSchemaVersion >= 21`, else `"ets5"` (PKWARE ZipCrypto)
   * - `"ets6"`: WinZip AES-256 AE-2 with ETS6 PBKDF2 password derivation
   * - `"ets5"`: PKWARE legacy ZipCrypto
   */
  encryption?: "auto" | "ets6" | "ets5";
}

export interface KnxProjectSnapshotOptions {
  /** Include base64 `loadedImage` / `checkSums` / `binaryData` fields (default: `false` to keep web payloads lean). */
  includeBinaryBlobs?: boolean;
  /** Include `rawExtraChildren` / `rawExtraSections` XML strings (default: `false`). */
  includeRawXml?: boolean;
  /** Include full `masterData` tables (default: `false` — use `getMasterData()` when needed). */
  includeMasterData?: boolean;
  /** Include full manufacturer catalog trees (default: `false` — use `getCatalogs()` when needed). */
  includeCatalogs?: boolean;
}

export interface SerializedKnxProject {
  schemaVersion: 1;
  metadata: KnxProjectArchiveMetadata;
  projectInfo: KnxProjectInfo;
  historyEntries: KnxProjectHistoryEntry[];
  userFiles: KnxProjectUserFile[];
  installations: KnxInstallation[];
  stats: KnxProjectStats;
  masterData?: KnxMasterData;
  catalogs?: Record<string, KnxManufacturerCatalog>;
}

export interface ImportKnxProdResult {
  manufacturerId: string;
  manufacturerName: string;
  hardwareCount: number;
  productCount: number;
  applicationIds: string[];
  baggageCount: number;
  mergedIntoExistingManufacturer: boolean;
}
