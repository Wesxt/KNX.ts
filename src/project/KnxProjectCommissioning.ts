import {
  KnxIpInterfaceConfig,
  KnxIpInterfaceWriteConfig,
  KNXManagement,
  LoadState,
  OpenSessionOptions,
} from "../management/KNXManagement";
import { KNXDeviceProgrammer } from "../programming/KNXDeviceProgrammer";
import { decodeKnxTsLoadedImage, encodeKnxTsLoadedImage } from "../programming/SystemBCompiler";
import {
  CommissionSecureDeviceOptions,
  CommissionSecureDeviceResult,
  DeviceDiagnosticsOptions,
  DeviceDiagnosticsReport,
  DeviceDownloadOptions,
  DeviceDownloadResult,
  DeviceSecurityConfig,
} from "../programming/types";
import { KnxKeyring } from "../security/KnxKeyring";
import { parseKey16 } from "../security/KnxSecureKeys";
import { KNXHelper } from "../utils/KNXHelper";
import type { KnxProject } from "./KnxProject";
import { formatGroupAddressByStyle } from "./KnxProjectXmlSerializer";
import type { ExternalKnxProdInput, KnxDeviceSummary } from "./types";

// ============================================================================
// Public Commissioning & Bus Comparison Types
// ============================================================================

export interface ComputeAuthorizedSendersOptions {
  installationId?: string;
  /** Restrict peer lookup to Group Addresses marked `security === "On"` or having an explicit Group Key. Default: `false`. */
  onlySecureGroupAddresses?: boolean;
  /** Only include peer devices whose ComObject has `transmitFlag !== "Disabled"`. Default: `false`. */
  onlyTransmittingPeers?: boolean;
  /** Extra Individual Addresses to include (e.g. local commissioning gateway/server IA). */
  extraSenders?: string[];
  /** Optional `KnxKeyring` to merge additional group senders from `<GroupAddresses><Group Senders="...">`. */
  keyring?: KnxKeyring;
  /** Include the target device's own Individual Address in the output list. Default: `false`. */
  includeSelf?: boolean;
}

export interface ComputedAuthorizedSendersResult {
  deviceId: string;
  individualAddress?: string;
  authorizedSenders: string[];
  sendersByGroupAddress: Record<string, string[]>;
}

export interface KnxDeviceBusDifference {
  field:
    | "serialNumber"
    | "manufacturerId"
    | "applicationProgram"
    | "loadState"
    | "groupAddresses"
    | "ipConfig"
    | "security";
  severity: "mismatch" | "warning";
  projectValue?: unknown;
  busValue?: unknown;
  message: string;
}

export interface KnxDeviceBusComparisonOptions extends DeviceDiagnosticsOptions {
  installationId?: string;
  /** Explicit Individual Address override (defaults to the device's IA in the project). */
  individualAddress?: string;
  /** Optional `KnxKeyring` to look up the device ToolKey if secure diagnostics are needed. */
  keyring?: KnxKeyring;
}

export interface KnxDeviceBusComparisonResult {
  deviceId: string;
  individualAddress: string;
  inSync: boolean;
  differences: KnxDeviceBusDifference[];
  groupAddressDiff?: {
    missingOnDevice: string[];
    extraOnDevice: string[];
    matchedCount: number;
  };
  diagnostics: DeviceDiagnosticsReport;
}

export interface KnxProjectProgramDeviceOptions extends Omit<
  DeviceDownloadOptions,
  "previousSegments" | "previousAbsoluteSegments"
> {
  installationId?: string;
  language?: string;
  externalKnxProd?: ExternalKnxProdInput;
  /** Explicit Individual Address override (defaults to the device's assigned IA in the project). */
  individualAddress?: string;
  /** Optional `KnxKeyring` to supply/receive Group Keys and ToolKeys (merged with keys stored in the project). */
  keyring?: KnxKeyring;
  /** Extra authorized sender IAs (e.g. your KNXnet/IP gateway/server IA) for `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`. */
  extraAuthorizedSenders?: string[];
  /** Automatically compute `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` from project topology & BusInterfaces. Default: `true`. */
  autoComputeAuthorizedSenders?: boolean;
  /** Optional initial KNX Data Secure commissioning (`FDSK -> ToolKey`) executed before application download. */
  commissionSecure?: CommissionSecureDeviceOptions;
  /**
   * Automatically decode `DeviceInstance.loadedImage` (if created by KNX.ts) to perform differential delta writes
   * on `mode: "par"` and `mode: "par,grp"`. Default: `true`.
   */
  useProjectLoadedImage?: boolean;
  /**
   * Program the KNXnet/IP Parameter Object (Object Type 11) from `device.ipConfig` / `ipConfigOverride` after download.
   * Default: `false` (unless `ipConfigOverride` is supplied).
   */
  programIpConfig?: boolean;
  /** Explicit Object Type 11 IP properties to write (overrides fields from `device.ipConfig`). */
  ipConfigOverride?: KnxIpInterfaceWriteConfig;
  /**
   * Update `DeviceInstance` download flags (`applicationProgramLoaded`, `parametersLoaded`, `communicationPartLoaded`,
   * `individualAddressLoaded`, `mediumConfigLoaded`), `serialNumberHex`, `lastDownload`, `loadedImage`, and `security`
   * in the project after a successful (non-dry-run) download. Default: `true`.
   */
  updateProjectState?: boolean;
  /** Sync project Group Keys and ToolKey into `programmer.management.dataSecure` and `options.keyring`. Default: `true`. */
  syncSecurityManagers?: boolean;
}

export interface KnxProjectProgramDeviceResult {
  deviceId: string;
  individualAddress: string;
  download: DeviceDownloadResult;
  commissionSecureResult?: CommissionSecureDeviceResult;
  ipConfigResult?: {
    individualAddress: string;
    objectIndex: number;
    writtenProperties: string[];
    restarted: boolean;
    configAfterWrite?: KnxIpInterfaceConfig;
  };
  authorizedSenders: string[];
  usedDifferentialSnapshot: boolean;
  updatedProjectState: boolean;
}

export type KnxBatchDeviceRole = "area_coupler" | "line_coupler" | "device";

export interface KnxBatchDeviceOutcome {
  deviceId: string;
  individualAddress?: string;
  name: string;
  role: KnxBatchDeviceRole;
  status: "programmed" | "skipped" | "failed";
  reason?: string;
  error?: string;
  bytesWritten?: number;
  durationMs?: number;
  result?: KnxProjectProgramDeviceResult;
}

export interface KnxBatchProgramOptions extends Omit<
  KnxProjectProgramDeviceOptions,
  "individualAddress" | "commissionSecure" | "ipConfigOverride"
> {
  /** Filter to a specific KNX Area address (`0..15`). */
  area?: number;
  /** Filter to a specific KNX Line address (`0..15`). */
  line?: number;
  /** Restrict batch commissioning to explicit device IDs or Individual Addresses. */
  deviceIds?: string[];
  /** Skip devices whose loaded flags already satisfy the requested `mode`. Default: `false`. */
  onlyModified?: boolean;
  /** Skip devices without an assigned Individual Address or ApplicationProgramRefId. Default: `true`. */
  skipUnassigned?: boolean;
  /** Skip devices whose catalog declares a proprietary ETS DCA / Download Plugin instead of failing. Default: `true`. */
  skipDca?: boolean;
  /** Automatically program Object Type 11 IP config on devices that define `device.ipConfig`. Default: `false`. */
  programIpConfigOnIpDevices?: boolean;
  /** Abort the batch immediately on the first device error. Default: `false` (collects all outcomes). */
  stopOnError?: boolean;
  /** Optional per-device callback invoked before commissioning each device. */
  onDeviceStart?: (info: {
    index: number;
    total: number;
    deviceId: string;
    individualAddress?: string;
    name: string;
    role: KnxBatchDeviceRole;
  }) => void;
  /** Optional per-device callback invoked after each device finishes, skips, or fails. */
  onDeviceComplete?: (outcome: KnxBatchDeviceOutcome, index: number, total: number) => void;
}

export interface KnxBatchProgramResult {
  installationId: string;
  totalCandidates: number;
  programmedCount: number;
  skippedCount: number;
  failedCount: number;
  totalBytesWritten: number;
  durationMs: number;
  outcomes: KnxBatchDeviceOutcome[];
}

export interface RecordDeviceCommissioningPatch {
  applicationProgramLoaded?: boolean;
  parametersLoaded?: boolean;
  communicationPartLoaded?: boolean;
  individualAddressLoaded?: boolean;
  mediumConfigLoaded?: boolean;
  serialNumberHex?: string;
  lastDownload?: string;
  lastUsedApduLength?: number;
  readMaxApduLength?: number;
  loadedImage?: string | null;
  securityPatch?: {
    toolKey?: string;
    loadedToolKey?: string;
    sequenceNumber?: string;
    sequenceNumberTimestamp?: string;
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

function iaToSortKey(ia: string): number {
  try {
    return KNXHelper.GetAddress(ia, ".").readUInt16BE(0);
  } catch {
    return 0xffff;
  }
}

function parseApplicationIdMetadata(
  appId?: string,
): { manufacturerId: number; applicationNumber: number; applicationVersion: number } | undefined {
  if (!appId) return undefined;
  const m = /^M-([0-9A-Fa-f]{4})_A-([0-9A-Fa-f]{4})-([0-9A-Fa-f]{2})/i.exec(appId.trim());
  if (!m) return undefined;
  return {
    manufacturerId: parseInt(m[1], 16),
    applicationNumber: parseInt(m[2], 16),
    applicationVersion: parseInt(m[3], 16),
  };
}

function parseManufacturerHexId(mfrId?: string): number | undefined {
  if (!mfrId) return undefined;
  const m = /^M-([0-9A-Fa-f]{4})$/i.exec(mfrId.trim());
  return m ? parseInt(m[1], 16) : undefined;
}

function classifyDeviceRole(dev: KnxDeviceSummary): {
  role: KnxBatchDeviceRole;
  sortTuple: [number, number, number, number];
} {
  const area = dev.areaAddress ?? 255;
  const line = dev.lineAddress ?? 255;
  const addr = dev.address ?? 255;

  if (dev.address === 0 && dev.lineAddress === 0 && (dev.areaAddress ?? 0) >= 1) {
    return { role: "area_coupler", sortTuple: [0, area, 0, 0] };
  }
  if (dev.address === 0 && (dev.lineAddress ?? 0) >= 1) {
    return { role: "line_coupler", sortTuple: [1, area, line, 0] };
  }
  if (dev.lineAddress === 0) {
    return { role: "device", sortTuple: [2, area, 0, addr] };
  }
  return { role: "device", sortTuple: [3, area, line, addr] };
}

function compareTuples(a: [number, number, number, number], b: [number, number, number, number]): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function isAlreadyLoadedForMode(dev: KnxDeviceSummary, mode: NonNullable<DeviceDownloadOptions["mode"]>): boolean {
  switch (mode) {
    case "par":
      return Boolean(dev.isLoaded.parameters);
    case "grp":
      return Boolean(dev.isLoaded.communicationPart);
    case "par,grp":
      return Boolean(dev.isLoaded.parameters && dev.isLoaded.communicationPart);
    case "full":
    case "ap1":
      return Boolean(dev.isLoaded.applicationProgram && dev.isLoaded.parameters && dev.isLoaded.communicationPart);
    case "unload":
      return false;
  }
}

// ============================================================================
// 1. Authorized Senders Calculator (`PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`)
// ============================================================================

/**
 * Computes the sorted list of partner Individual Addresses that should be authorized in
 * `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (Security Interface Object Type 17, PID 54) for `idOrIa`,
 * by inspecting all Group Address links, BusInterface tunneling connectors, optional Keyring senders,
 * and optional extra gateway Individual Addresses.
 */
export function computeProjectDeviceAuthorizedSenders(
  project: KnxProject,
  idOrIa: string,
  options: ComputeAuthorizedSendersOptions = {},
): ComputedAuthorizedSendersResult {
  const details = project.getDeviceDetailsSync(idOrIa, options.installationId);
  const instId = details.installationId;
  const selfIa = details.individualAddress;

  // Build map of GA ID/shortId -> tunneling gateway IAs (including AdditionalAddresses) from all devices' BusInterfaces
  const busInterfaceSendersByGaId = new Map<string, Set<string>>();
  const allDevices = project.getDevices({ installationId: instId });
  const gaByKey = new Map<string, { id: string; address3Level: string; security?: string; key?: string }>();
  for (const ga of project.getGroupAddresses({ installationId: instId })) {
    const info = { id: ga.id, address3Level: ga.address3Level, security: ga.security, key: ga.key };
    gaByKey.set(ga.id, info);
    gaByKey.set(ga.shortId, info);
    gaByKey.set(ga.address3Level, info);
  }

  for (const devSummary of allDevices) {
    const devRaw = project.getDevice(devSummary.id, instId);
    if (!devRaw || devRaw.busInterfaces.length === 0) continue;
    const devIas: string[] = [];
    if (devSummary.individualAddress) devIas.push(devSummary.individualAddress);
    if (devSummary.areaAddress !== undefined && devSummary.lineAddress !== undefined) {
      for (const add of devRaw.additionalAddresses) {
        devIas.push(`${devSummary.areaAddress}.${devSummary.lineAddress}.${add.address}`);
      }
    }
    if (devIas.length === 0) continue;

    for (const bi of devRaw.busInterfaces) {
      for (const conn of bi.connectors) {
        const gaHit = gaByKey.get(conn.groupAddressRefId);
        if (!gaHit) continue;
        let set = busInterfaceSendersByGaId.get(gaHit.id);
        if (!set) {
          set = new Set();
          busInterfaceSendersByGaId.set(gaHit.id, set);
        }
        for (const ia of devIas) set.add(ia);
      }
    }
  }

  const allSenders = new Set<string>();
  const sendersByGroupAddress: Record<string, string[]> = {};
  const processedGaIds = new Set<string>();

  for (const co of details.comObjects) {
    for (const linked of co.linkedGroupAddresses) {
      if (processedGaIds.has(linked.id)) continue;
      processedGaIds.add(linked.id);

      const gaMeta = gaByKey.get(linked.id);
      const ga3Level = gaMeta?.address3Level ?? formatGroupAddressByStyle(linked.address, "ThreeLevel");
      if (options.onlySecureGroupAddresses && gaMeta?.security !== "On" && !gaMeta?.key) {
        continue;
      }

      const gaSenders = new Set<string>();
      const links = project.getGroupAddressLinks(linked.id, instId);
      for (const lk of links) {
        if (!lk.individualAddress) continue;
        if (!options.includeSelf && (lk.deviceId === details.id || lk.individualAddress === selfIa)) continue;
        if (options.onlyTransmittingPeers && lk.flags.transmit === "Disabled") continue;
        gaSenders.add(lk.individualAddress);
      }

      const biSenders = busInterfaceSendersByGaId.get(linked.id);
      if (biSenders) {
        for (const ia of biSenders) {
          if (!options.includeSelf && ia === selfIa) continue;
          gaSenders.add(ia);
        }
      }

      if (options.keyring) {
        for (const ia of options.keyring.getGroupSenders(ga3Level)) {
          if (!options.includeSelf && ia === selfIa) continue;
          gaSenders.add(ia);
        }
      }

      const sortedGaSenders = Array.from(gaSenders).sort((a, b) => iaToSortKey(a) - iaToSortKey(b));
      sendersByGroupAddress[ga3Level] = sortedGaSenders;
      for (const s of sortedGaSenders) allSenders.add(s);
    }
  }

  for (const extra of options.extraSenders ?? []) {
    if (!KNXHelper.isValidIndividualAddress(extra)) {
      throw new Error(`Invalid KNX Individual Address in extraSenders: "${extra}"`);
    }
    if (!options.includeSelf && extra === selfIa) continue;
    allSenders.add(extra);
  }

  const authorizedSenders = Array.from(allSenders).sort((a, b) => iaToSortKey(a) - iaToSortKey(b));
  return {
    deviceId: details.id,
    individualAddress: selfIa,
    authorizedSenders,
    sendersByGroupAddress,
  };
}

// ============================================================================
// 2. Bus vs Project Device Comparison
// ============================================================================

/**
 * Inspects a physical KNX device via `readDeviceDiagnostics()` and compares its live state
 * against the `.knxproj` model (Serial Number, Manufacturer ID, Application Program version,
 * Load States, Group Address Table diff, KNXnet/IP config, and Security Mode).
 */
export async function compareProjectDeviceWithBus(
  project: KnxProject,
  idOrIa: string,
  programmerOrMgmt: KNXDeviceProgrammer | KNXManagement,
  options: KnxDeviceBusComparisonOptions = {},
): Promise<KnxDeviceBusComparisonResult> {
  const programmer =
    programmerOrMgmt instanceof KNXDeviceProgrammer ? programmerOrMgmt : new KNXDeviceProgrammer(programmerOrMgmt);
  const details = project.getDeviceDetailsSync(idOrIa, options.installationId);
  const ia = options.individualAddress ?? details.individualAddress;
  if (!ia) {
    throw new Error(`Device "${details.id}" has no assigned Individual Address in the project`);
  }

  // Register device ToolKey if available and secure diagnostics are requested
  const dataSecure = programmer.management.dataSecure;
  if (dataSecure) {
    const rawToolKey = details.security?.loadedToolKey ?? details.security?.toolKey;
    if (rawToolKey) {
      try {
        dataSecure.setDeviceToolKey(ia, parseKey16(rawToolKey, `Device ${ia} toolKey`));
      } catch {
        // ignore invalid base64/hex
      }
    } else if (options.keyring) {
      const kDev = options.keyring.getDevice(ia);
      if (kDev?.toolKey) {
        dataSecure.setDeviceToolKey(ia, kDev.toolKey);
      }
    }
  }

  const diagnostics = await programmer.readDeviceDiagnostics(ia, options);
  const differences: KnxDeviceBusDifference[] = [];

  // 1. Serial Number
  if (details.serialNumberHex && diagnostics.serialNumber) {
    if (details.serialNumberHex.toUpperCase() !== diagnostics.serialNumber.toUpperCase()) {
      differences.push({
        field: "serialNumber",
        severity: "mismatch",
        projectValue: details.serialNumberHex.toUpperCase(),
        busValue: diagnostics.serialNumber.toUpperCase(),
        message: `Serial number mismatch: project expects ${details.serialNumberHex.toUpperCase()}, device reports ${diagnostics.serialNumber.toUpperCase()}`,
      });
    }
  }

  // 2. Manufacturer ID
  const projectMfrId = parseManufacturerHexId(details.manufacturerId);
  if (projectMfrId !== undefined && diagnostics.manufacturerId !== undefined) {
    // BCU1 reports 8-bit manufacturer ID in EEPROM 0x0104
    const matches =
      diagnostics.managementModel === "Bcu1"
        ? (projectMfrId & 0xff) === diagnostics.manufacturerId
        : projectMfrId === diagnostics.manufacturerId;
    if (!matches) {
      differences.push({
        field: "manufacturerId",
        severity: "mismatch",
        projectValue: projectMfrId,
        busValue: diagnostics.manufacturerId,
        message: `Manufacturer ID mismatch: project expects 0x${projectMfrId.toString(16).padStart(4, "0")}, device reports 0x${diagnostics.manufacturerId.toString(16).padStart(4, "0")}`,
      });
    }
  }

  // 3. Application Program (Number + Version)
  const expectedApp = parseApplicationIdMetadata(details.applicationProgramRefId);
  if (expectedApp && diagnostics.applicationIdInfo) {
    const busApp = diagnostics.applicationIdInfo;
    if (
      expectedApp.applicationNumber !== busApp.applicationNumber ||
      expectedApp.applicationVersion !== busApp.applicationVersion
    ) {
      differences.push({
        field: "applicationProgram",
        severity: "mismatch",
        projectValue: {
          applicationId: details.applicationProgramRefId,
          applicationNumber: expectedApp.applicationNumber,
          applicationVersion: expectedApp.applicationVersion,
        },
        busValue: busApp,
        message: `Application program mismatch: project expects App 0x${expectedApp.applicationNumber.toString(16).padStart(4, "0")} v${expectedApp.applicationVersion}, device reports App 0x${busApp.applicationNumber.toString(16).padStart(4, "0")} v${busApp.applicationVersion}`,
      });
    }
  }

  // 4. Load States
  for (const ls of diagnostics.loadStates) {
    if (ls.state !== LoadState.LOADED) {
      differences.push({
        field: "loadState",
        severity: "mismatch",
        projectValue: "LOADED",
        busValue: { objectIndex: ls.objectIndex, state: ls.state, stateName: ls.stateName },
        message: `Object ${ls.objectIndex} load state is ${ls.stateName} (expected LOADED)`,
      });
    }
  }

  // 5. Group Address Table diff
  let groupAddressDiff: KnxDeviceBusComparisonResult["groupAddressDiff"];
  if (diagnostics.groupAddressTable) {
    const projectGas = new Set<string>();
    for (const co of details.comObjects) {
      for (const lk of co.linkedGroupAddresses) {
        projectGas.add(formatGroupAddressByStyle(lk.address, "ThreeLevel"));
      }
    }
    const busGas = new Set(diagnostics.groupAddressTable.groupAddresses);

    const missingOnDevice = Array.from(projectGas)
      .filter((ga) => !busGas.has(ga))
      .sort();
    const extraOnDevice = Array.from(busGas)
      .filter((ga) => !projectGas.has(ga))
      .sort();
    const matchedCount = Array.from(projectGas).filter((ga) => busGas.has(ga)).length;

    groupAddressDiff = { missingOnDevice, extraOnDevice, matchedCount };
    if (missingOnDevice.length > 0 || extraOnDevice.length > 0) {
      differences.push({
        field: "groupAddresses",
        severity: "mismatch",
        projectValue: Array.from(projectGas).sort(),
        busValue: Array.from(busGas).sort(),
        message: `Group Address Table out of sync: ${missingOnDevice.length} missing on device, ${extraOnDevice.length} extra on device`,
      });
    }
  }

  // 6. KNXnet/IP Config comparison (Object Type 11)
  if (details.ipConfig && diagnostics.ipConfig) {
    const pIp = details.ipConfig;
    const bIp = diagnostics.ipConfig;
    const busIpAddr = bIp.ipAddress ?? bIp.currentIpAddress;
    const busMask = bIp.subnetMask ?? bIp.currentSubnetMask;
    const busGw = bIp.defaultGateway ?? bIp.currentDefaultGateway;

    if (pIp.assign === "Fixed") {
      if (pIp.ipAddress && busIpAddr && pIp.ipAddress !== busIpAddr) {
        differences.push({
          field: "ipConfig",
          severity: "mismatch",
          projectValue: pIp.ipAddress,
          busValue: busIpAddr,
          message: `IP Address mismatch: project=${pIp.ipAddress}, device=${busIpAddr}`,
        });
      }
      if (pIp.subnetMask && busMask && pIp.subnetMask !== busMask) {
        differences.push({
          field: "ipConfig",
          severity: "mismatch",
          projectValue: pIp.subnetMask,
          busValue: busMask,
          message: `Subnet Mask mismatch: project=${pIp.subnetMask}, device=${busMask}`,
        });
      }
      if (pIp.defaultGateway && busGw && pIp.defaultGateway !== busGw) {
        differences.push({
          field: "ipConfig",
          severity: "mismatch",
          projectValue: pIp.defaultGateway,
          busValue: busGw,
          message: `Default Gateway mismatch: project=${pIp.defaultGateway}, device=${busGw}`,
        });
      }
      if (bIp.ipAssignmentMethod && !bIp.ipAssignmentMethod.manual) {
        differences.push({
          field: "ipConfig",
          severity: "mismatch",
          projectValue: "Fixed",
          busValue: bIp.ipAssignmentMethod,
          message: `IP Assignment mismatch: project expects Fixed/Manual, device has manual=false`,
        });
      }
    } else if (pIp.assign === "Auto" && bIp.ipAssignmentMethod) {
      if (!bIp.ipAssignmentMethod.dhcp && !bIp.ipAssignmentMethod.autoIp) {
        differences.push({
          field: "ipConfig",
          severity: "mismatch",
          projectValue: "Auto",
          busValue: bIp.ipAssignmentMethod,
          message: `IP Assignment mismatch: project expects Auto (DHCP/AutoIP), device has dhcp=false, autoIp=false`,
        });
      }
    }

    if (
      details.additionalAddresses.length > 0 &&
      details.areaAddress !== undefined &&
      details.lineAddress !== undefined
    ) {
      const expectedAdd = details.additionalAddresses
        .map((a) => `${details.areaAddress}.${details.lineAddress}.${a.address}`)
        .sort((a, b) => iaToSortKey(a) - iaToSortKey(b));
      const actualAdd = [...bIp.additionalIndividualAddresses].sort((a, b) => iaToSortKey(a) - iaToSortKey(b));
      if (expectedAdd.join(",") !== actualAdd.join(",")) {
        differences.push({
          field: "ipConfig",
          severity: "mismatch",
          projectValue: expectedAdd,
          busValue: actualAdd,
          message: `Additional tunneling Individual Addresses mismatch: project=[${expectedAdd.join(", ")}], device=[${actualAdd.join(", ")}]`,
        });
      }
    }
  }

  // 7. Security Mode check
  const projectExpectsSecurity = Boolean(details.security?.toolKey || details.security?.loadedToolKey);
  if (projectExpectsSecurity && diagnostics.security && diagnostics.security.securityMode === false) {
    differences.push({
      field: "security",
      severity: "mismatch",
      projectValue: true,
      busValue: false,
      message: "Device has KNX Data Security configured in project, but PID_SECURITY_MODE is disabled on bus",
    });
  }

  return {
    deviceId: details.id,
    individualAddress: ia,
    inSync: differences.filter((d) => d.severity === "mismatch").length === 0,
    differences,
    groupAddressDiff,
    diagnostics,
  };
}

// ============================================================================
// 3. Single-Device Commissioning Orchestrator (`project.programDevice`)
// ============================================================================

/**
 * End-to-end commissioning of a single device directly from a `KnxProject`:
 * 1. Opens a `DeviceConfigSession` with parameters, links, and coupler filter table (if coupler).
 * 2. Optionally runs initial KNX Data Secure FDSK commissioning (`FDSK -> ToolKey`).
 * 3. Automatically computes `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (`authorizedSenders`) and loads project/keyring Group Keys.
 * 4. Automatically uses KNX.ts `LoadedImage` snapshots for byte-level differential delta writes on `mode: "par" | "par,grp"`.
 * 5. Downloads the compiled image onto the bus via `KNXDeviceProgrammer`.
 * 6. Optionally commissions KNXnet/IP Parameter Object (Object Type 11) for IP interfaces/routers.
 * 7. Updates `DeviceInstance` loaded flags, `serialNumberHex`, `lastDownload`, `loadedImage`, and `security` state in the project.
 */
export async function programProjectDevice(
  project: KnxProject,
  idOrIa: string,
  programmer: KNXDeviceProgrammer,
  options: KnxProjectProgramDeviceOptions = {},
): Promise<KnxProjectProgramDeviceResult> {
  const details = project.getDeviceDetailsSync(idOrIa, options.installationId);
  const instId = details.installationId;
  const ia = options.individualAddress ?? details.individualAddress;
  if (!ia) {
    throw new Error(`Device "${details.id}" has no assigned Individual Address in the project`);
  }

  const mode = options.mode ?? "ap1";
  const syncManagers = options.syncSecurityManagers !== false;
  const dataSecure = programmer.management.dataSecure;

  // 1. Open DeviceConfigSession (already injects IA & coupler Filter Table if coupler!)
  const session = await project.openDeviceSession(details.id, {
    language: options.language,
    installationId: instId,
    externalKnxProd: options.externalKnxProd,
  });

  // 2. Optional FDSK -> ToolKey commissioning
  let commissionSecureResult: CommissionSecureDeviceResult | undefined;
  if (options.commissionSecure && !options.dryRun) {
    commissionSecureResult = await programmer.commissionSecureDevice(ia, options.commissionSecure);
    if (syncManagers && options.keyring) {
      options.keyring.setDevice({
        individualAddress: ia,
        toolKey: commissionSecureResult.toolKey,
        sequenceNumber: commissionSecureResult.sequenceNumberSending,
        serialNumber: details.serialNumberHex,
      });
    }
  }

  // 3. Prepare KNX Data Secure runtime config & authorizedSenders
  let authorizedSenders: string[] = [];
  let runtimeSecurity: Partial<DeviceSecurityConfig> | undefined;
  let effectiveSessionOptions: OpenSessionOptions | undefined = options.sessionOptions;

  const groupKeys: Record<string, Buffer> = {};
  let hasSecureGa = false;
  for (const co of details.comObjects) {
    for (const lk of co.linkedGroupAddresses) {
      const gaView = project.getGroupAddress(lk.id, instId);
      const ga3 = gaView?.address3Level ?? formatGroupAddressByStyle(lk.address, "ThreeLevel");
      if (gaView?.security === "On") hasSecureGa = true;
      if (gaView?.key) {
        try {
          const buf = parseKey16(gaView.key, `GA ${ga3} key`);
          groupKeys[ga3] = buf;
          hasSecureGa = true;
        } catch {
          // ignore malformed key
        }
      } else if (options.keyring) {
        const kBuf = options.keyring.getGroupKey(ga3);
        if (kBuf) {
          groupKeys[ga3] = kBuf;
          hasSecureGa = true;
        }
      }
    }
  }

  // Resolve device ToolKey from commissionSecure, project DeviceInstance, or keyring
  let resolvedToolKeyBuf: Buffer | undefined = commissionSecureResult?.toolKey;
  if (!resolvedToolKeyBuf && (details.security?.toolKey || details.security?.loadedToolKey)) {
    try {
      resolvedToolKeyBuf = parseKey16(
        (details.security.toolKey ?? details.security.loadedToolKey)!,
        `Device ${ia} toolKey`,
      );
    } catch {
      // ignore malformed
    }
  }
  if (!resolvedToolKeyBuf && options.keyring) {
    const keyringToolKey = options.keyring.getDevice(ia)?.toolKey;
    if (keyringToolKey) {
      try {
        resolvedToolKeyBuf = parseKey16(keyringToolKey, `Keyring Device ${ia} toolKey`);
      } catch {
        // ignore malformed
      }
    }
  }

  const securityRelevant =
    session.app.isSecureEnabled &&
    (hasSecureGa ||
      Boolean(resolvedToolKeyBuf) ||
      Boolean(options.sessionOptions?.secure) ||
      options.programSecurityObject === true);

  if (securityRelevant) {
    if (options.autoComputeAuthorizedSenders !== false) {
      const computed = computeProjectDeviceAuthorizedSenders(project, details.id, {
        installationId: instId,
        extraSenders: options.extraAuthorizedSenders,
        keyring: options.keyring,
      });
      authorizedSenders = computed.authorizedSenders;
    } else if (options.extraAuthorizedSenders) {
      authorizedSenders = [...options.extraAuthorizedSenders].sort((a, b) => iaToSortKey(a) - iaToSortKey(b));
    }

    runtimeSecurity = {
      enabled: true,
      keyring: options.keyring,
      groupKeys: Object.keys(groupKeys).length > 0 ? groupKeys : undefined,
      authorizedSenders,
    };

    if (syncManagers && dataSecure) {
      if (resolvedToolKeyBuf) {
        dataSecure.setDeviceToolKey(ia, resolvedToolKeyBuf);
      }
      for (const [ga, kBuf] of Object.entries(groupKeys)) {
        dataSecure.setGroupKey(ga, kBuf);
      }
    }

    if (effectiveSessionOptions === undefined && dataSecure && resolvedToolKeyBuf) {
      effectiveSessionOptions = { secure: true };
    }
  }

  // 4. Decode existing KNX.ts LoadedImage snapshot for differential delta writes
  let previousSegments: Map<number, Buffer> | undefined;
  let previousAbsoluteSegments: Map<string, Buffer> | undefined;
  let usedDifferentialSnapshot = false;
  if (options.useProjectLoadedImage !== false) {
    const rawDev = project.getDevice(details.id, instId);
    if (rawDev?.loadedImage) {
      const decoded = decodeKnxTsLoadedImage(rawDev.loadedImage);
      if (decoded && decoded.applicationId === session.app.id) {
        previousSegments = decoded.segments;
        previousAbsoluteSegments = decoded.absoluteSegments;
        if (
          options.differentialWrite !== false &&
          (mode === "par" || mode === "par,grp" || options.differentialWrite)
        ) {
          usedDifferentialSnapshot = true;
        }
      }
    }
  }

  // 5. Execute hardware download
  const downloadOpts: DeviceDownloadOptions = {
    mode,
    authorizeKey: options.authorizeKey,
    dryRun: options.dryRun,
    verifyDeviceBeforeWrite: options.verifyDeviceBeforeWrite,
    strictHardwareTypeCheck: options.strictHardwareTypeCheck,
    interfaceMaxApduLength: options.interfaceMaxApduLength,
    skipFillRuns: options.skipFillRuns,
    differentialWrite: options.differentialWrite,
    previousSegments,
    previousAbsoluteSegments,
    verifyMemoryMode: options.verifyMemoryMode,
    skipRestart: options.skipRestart,
    programSecurityObject: options.programSecurityObject,
    sessionOptions: effectiveSessionOptions,
    allowDcaOverride: options.allowDcaOverride,
    skipDelay: options.skipDelay,
    onProgress: options.onProgress,
  };

  const download = await session.download(programmer, ia, downloadOpts, runtimeSecurity);

  // 6. Optional Object Type 11 KNXnet/IP commissioning
  let ipConfigResult: KnxProjectProgramDeviceResult["ipConfigResult"];
  if (!options.dryRun && mode !== "unload" && (options.programIpConfig || options.ipConfigOverride)) {
    const ipWrite: KnxIpInterfaceWriteConfig = {};
    if (details.ipConfig) {
      if (details.ipConfig.assign) {
        ipWrite.ipAssignmentMethod = details.ipConfig.assign as KnxIpInterfaceWriteConfig["ipAssignmentMethod"];
      }
      if (details.ipConfig.ipAddress) ipWrite.ipAddress = details.ipConfig.ipAddress;
      if (details.ipConfig.subnetMask) ipWrite.subnetMask = details.ipConfig.subnetMask;
      if (details.ipConfig.defaultGateway) ipWrite.defaultGateway = details.ipConfig.defaultGateway;
    }
    if (
      details.additionalAddresses.length > 0 &&
      details.areaAddress !== undefined &&
      details.lineAddress !== undefined
    ) {
      ipWrite.additionalIndividualAddresses = details.additionalAddresses.map(
        (a) => `${details.areaAddress}.${details.lineAddress}.${a.address}`,
      );
    }
    if (details.name) {
      ipWrite.friendlyName = details.name;
    }
    const inst = project.getInstallation(instId);
    if (inst?.ipRoutingMulticastAddress) {
      ipWrite.routingMulticastAddress = inst.ipRoutingMulticastAddress;
    }
    Object.assign(ipWrite, options.ipConfigOverride ?? {});

    if (Object.keys(ipWrite).length > 0) {
      ipConfigResult = await programmer.configureIpInterface(ia, ipWrite, {
        authorizeKey: options.authorizeKey,
        sessionOptions: effectiveSessionOptions,
        restart: !options.skipRestart,
      });
    }
  }

  // 7. Write back commissioning state to project DeviceInstance
  let updatedProjectState = false;
  if (!options.dryRun && options.updateProjectState !== false) {
    const nowIso = new Date().toISOString();
    const patch: RecordDeviceCommissioningPatch = {
      lastDownload: nowIso,
      serialNumberHex: download.preflight?.serialNumber,
      readMaxApduLength: download.preflight?.maxApduLength,
      lastUsedApduLength: download.preflight?.effectiveMaxApduLength,
    };

    if (mode === "unload") {
      patch.applicationProgramLoaded = false;
      patch.parametersLoaded = false;
      patch.communicationPartLoaded = false;
      patch.loadedImage = null;
    } else {
      if (mode === "full" || mode === "ap1") {
        patch.applicationProgramLoaded = true;
        patch.parametersLoaded = true;
        patch.communicationPartLoaded = true;
        patch.individualAddressLoaded = true;
      } else if (mode === "par") {
        patch.parametersLoaded = true;
      } else if (mode === "grp") {
        patch.communicationPartLoaded = true;
      } else if (mode === "par,grp") {
        patch.parametersLoaded = true;
        patch.communicationPartLoaded = true;
      }
      if (ipConfigResult) {
        patch.mediumConfigLoaded = true;
      }
      patch.loadedImage = encodeKnxTsLoadedImage(download.image);
    }

    if (commissionSecureResult) {
      const tkB64 = commissionSecureResult.toolKey.toString("base64");
      patch.securityPatch = {
        toolKey: tkB64,
        loadedToolKey: tkB64,
        sequenceNumber: commissionSecureResult.sequenceNumberSending?.toString(),
        sequenceNumberTimestamp: nowIso,
      };
    }

    project.recordDeviceCommissioningResult(details.id, patch, instId);
    updatedProjectState = true;
  }

  // Sync final security state into keyring if provided
  if (!options.dryRun && syncManagers && options.keyring && securityRelevant) {
    for (const [ga, kBuf] of Object.entries(groupKeys)) {
      options.keyring.setGroupKey(ga, kBuf);
    }
    if (resolvedToolKeyBuf) {
      options.keyring.setDevice({
        individualAddress: ia,
        toolKey: resolvedToolKeyBuf,
        serialNumber: download.preflight?.serialNumber ?? details.serialNumberHex,
        sequenceNumber: commissionSecureResult?.sequenceNumberSending,
      });
    }
  }

  return {
    deviceId: details.id,
    individualAddress: ia,
    download,
    commissionSecureResult,
    ipConfigResult,
    authorizedSenders,
    usedDifferentialSnapshot,
    updatedProjectState,
  };
}

// ============================================================================
// 4. Batch Topological Commissioning (`project.programAll`)
// ============================================================================

/**
 * Commissions multiple devices in a `KnxProject` installation in strict KNX topological order:
 * 1. Area / Backbone Couplers (`A.0.0`)
 * 2. Line Couplers & IP Routers (`A.L.0`)
 * 3. Backbone / Main-Line devices (`A.0.D`)
 * 4. Line end-devices (`A.L.D`, sorted ascending by `A`, `L`, `D`)
 *
 * Gracefully skips unassigned devices, already-loaded devices (when `onlyModified: true`),
 * and proprietary ETS DCA devices (when `skipDca: true`).
 */
export async function programProjectAll(
  project: KnxProject,
  programmer: KNXDeviceProgrammer,
  options: KnxBatchProgramOptions = {},
): Promise<KnxBatchProgramResult> {
  const startedAt = Date.now();
  const inst = project.getInstallation(options.installationId);
  if (!inst) {
    throw new Error(`Installation "${options.installationId ?? "0"}" not found in project`);
  }
  const instId = inst.installationId;
  const mode = options.mode ?? "ap1";
  const onlyModified = options.onlyModified ?? false;
  const skipUnassigned = options.skipUnassigned ?? true;
  const skipDca = options.skipDca ?? true;
  const stopOnError = options.stopOnError ?? false;

  const explicitSet = options.deviceIds ? new Set(options.deviceIds) : null;
  let candidates = project.getDevices({
    installationId: instId,
    area: options.area,
    line: options.line,
  });

  if (explicitSet) {
    candidates = candidates.filter(
      (d) => explicitSet.has(d.id) || (d.individualAddress !== undefined && explicitSet.has(d.individualAddress)),
    );
  }

  const ordered = candidates
    .map((dev) => ({ dev, ...classifyDeviceRole(dev) }))
    .sort((a, b) => compareTuples(a.sortTuple, b.sortTuple));

  const outcomes: KnxBatchDeviceOutcome[] = [];
  let programmedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalBytesWritten = 0;

  const total = ordered.length;
  for (let idx = 0; idx < total; idx++) {
    const { dev, role } = ordered[idx];
    const displayName = dev.name || dev.description || dev.productName || dev.id;

    options.onDeviceStart?.({
      index: idx,
      total,
      deviceId: dev.id,
      individualAddress: dev.individualAddress,
      name: displayName,
      role,
    });

    if (!dev.individualAddress) {
      if (skipUnassigned) {
        const out: KnxBatchDeviceOutcome = {
          deviceId: dev.id,
          name: displayName,
          role,
          status: "skipped",
          reason: "No Individual Address assigned",
        };
        outcomes.push(out);
        skippedCount++;
        options.onDeviceComplete?.(out, idx, total);
        continue;
      }
    }

    if (!dev.applicationProgramRefId && !options.externalKnxProd) {
      if (skipUnassigned) {
        const out: KnxBatchDeviceOutcome = {
          deviceId: dev.id,
          individualAddress: dev.individualAddress,
          name: displayName,
          role,
          status: "skipped",
          reason: "Device has no ApplicationProgramRefId (e.g. passive hardware / power supply)",
        };
        outcomes.push(out);
        skippedCount++;
        options.onDeviceComplete?.(out, idx, total);
        continue;
      }
    }

    if (onlyModified && isAlreadyLoadedForMode(dev, mode)) {
      const out: KnxBatchDeviceOutcome = {
        deviceId: dev.id,
        individualAddress: dev.individualAddress,
        name: displayName,
        role,
        status: "skipped",
        reason: `Already loaded for mode "${mode}"`,
      };
      outcomes.push(out);
      skippedCount++;
      options.onDeviceComplete?.(out, idx, total);
      continue;
    }

    // Check DCA before programming if skipDca is enabled
    if (skipDca && mode !== "unload" && !options.allowDcaOverride && dev.applicationProgramRefId) {
      try {
        const app = await project.loadApplicationProgram(dev.applicationProgramRefId, {
          language: options.language,
          externalKnxProd: options.externalKnxProd,
          manufacturerId: dev.manufacturerId,
          productRefId: dev.productRefId,
        });
        if (app.extension?.hasDownloadPlugin) {
          const out: KnxBatchDeviceOutcome = {
            deviceId: dev.id,
            individualAddress: dev.individualAddress,
            name: displayName,
            role,
            status: "skipped",
            reason: `Requires proprietary ETS DCA / Download Plugin (${app.extension.etsDownloadPlugin ?? app.extension.etsDataHandler ?? "DCA"})`,
          };
          outcomes.push(out);
          skippedCount++;
          options.onDeviceComplete?.(out, idx, total);
          continue;
        }
      } catch {
        // Let programProjectDevice surface catalog load errors normally below
      }
    }

    const devStartedAt = Date.now();
    try {
      const devRaw = project.getDevice(dev.id, instId);
      const programIp = options.programIpConfig || Boolean(options.programIpConfigOnIpDevices && devRaw?.ipConfig);

      const res = await programProjectDevice(project, dev.id, programmer, {
        ...options,
        installationId: instId,
        programIpConfig: programIp,
      });

      totalBytesWritten += res.download.bytesWritten;
      programmedCount++;
      const out: KnxBatchDeviceOutcome = {
        deviceId: dev.id,
        individualAddress: res.individualAddress,
        name: displayName,
        role,
        status: "programmed",
        bytesWritten: res.download.bytesWritten,
        durationMs: Date.now() - devStartedAt,
        result: res,
      };
      outcomes.push(out);
      options.onDeviceComplete?.(out, idx, total);
    } catch (err: any) {
      failedCount++;
      const out: KnxBatchDeviceOutcome = {
        deviceId: dev.id,
        individualAddress: dev.individualAddress,
        name: displayName,
        role,
        status: "failed",
        error: err?.message ?? String(err),
        durationMs: Date.now() - devStartedAt,
      };
      outcomes.push(out);
      options.onDeviceComplete?.(out, idx, total);
      if (stopOnError) break;
    }
  }

  return {
    installationId: instId,
    totalCandidates: total,
    programmedCount,
    skippedCount,
    failedCount,
    totalBytesWritten,
    durationMs: Date.now() - startedAt,
    outcomes,
  };
}
