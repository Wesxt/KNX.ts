import dgram from "dgram";
import net from "node:net";
import { KNXDiscoveredDevice, KNXDiscoverOptions } from "../@types/interfaces/connection";
import {
  AllowedSupportedServiceFamilies,
  DescriptionType,
  HostProtocolCode,
  KNXMedium,
  KNXnetIPServiceType,
  SRPType,
} from "../core/enum/KNXnetIPEnum";
import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import {
  DIB,
  DeviceInformationDIB,
  ExtendedDeviceInformationDIB,
  HPAI,
  IPConfigDIB,
  IPCurrentConfigDIB,
  KNXAddressesDIB,
  MfrDataDIB,
  SRP,
  SecuredServiceFamiliesDIB,
  SupportedServicesDIB,
  TunnellingInfoDIB,
} from "../core/KNXnetIPStructures";
import { getNetworkInfo } from "../utils/localIp";
import { TcpFrameReader } from "./TcpFrameReader";
import { KNXHelper } from "../utils/KNXHelper";
import { DeviceDescriptorType0 } from "../core/resources/DeviceDescriptorType";

const ALL_DIB_TYPES: number[] = [
  DescriptionType.DEVICE_INFO,
  DescriptionType.SUPP_SVC_FAMILIES,
  DescriptionType.IP_CONFIG,
  DescriptionType.IP_CUR_CONFIG,
  DescriptionType.KNX_ADDRESSES,
  DescriptionType.SECURED_SERVICE_FAMILIES,
  DescriptionType.TUNNELLING_INFO,
  DescriptionType.DEVICE_INFO_EXTENDED,
  DescriptionType.MFR_DATA,
];

const MEDIUM_NAMES: Record<number, string> = {
  [KNXMedium.TP1]: "TP1",
  [KNXMedium.PL110]: "PL110",
  [KNXMedium.RF]: "RF",
  [KNXMedium.KNXIP]: "KNXIP",
};

const SERVICE_FAMILY_NAMES: Record<number, string> = {
  [AllowedSupportedServiceFamilies.Core]: "Core",
  [AllowedSupportedServiceFamilies.DeviceManagement]: "DeviceManagement",
  [AllowedSupportedServiceFamilies.Tunnelling]: "Tunnelling",
  [AllowedSupportedServiceFamilies.Routing]: "Routing",
  [AllowedSupportedServiceFamilies.RemoteLogging]: "RemoteLogging",
  [AllowedSupportedServiceFamilies.RemoteConfigurationAndDiagnosis]: "RemoteConfigurationAndDiagnosis",
  [AllowedSupportedServiceFamilies.ObjectServer]: "ObjectServer",
  [AllowedSupportedServiceFamilies.Security]: "Security",
};

function getServiceFamilyName(family: number): string {
  return SERVICE_FAMILY_NAMES[family] ?? `Unknown(0x${family.toString(16).padStart(2, "0")})`;
}

function formatIpCapabilities(caps: number): string[] {
  const result: string[] = [];
  if (caps & 0x01) result.push("BootP");
  if (caps & 0x02) result.push("DHCP");
  if (caps & 0x04) result.push("AutoIP");
  return result.length > 0 ? result : ["Fixed"];
}

function formatIpAssignmentMethod(method: number): string {
  switch (method) {
    case 0x01:
      return "Manual";
    case 0x02:
      return "BootP";
    case 0x04:
      return "DHCP";
    case 0x08:
      return "AutoIP";
    default:
      return `Unknown(0x${method.toString(16).padStart(2, "0")})`;
  }
}

function buildSearchSrps(options: KNXDiscoverOptions): { srps: SRP[]; hasUserFilters: boolean } {
  const srps: SRP[] = [...(options.srps ?? [])];
  let hasUserFilters = srps.length > 0;

  if (options.programmingModeOnly) {
    srps.push(SRP.selectByProgrammingMode(true));
    hasUserFilters = true;
  }
  if (options.macAddress) {
    srps.push(SRP.selectByMacAddress(options.macAddress, true));
    hasUserFilters = true;
  }
  if (options.minService) {
    srps.push(
      SRP.selectByService(options.minService.family, options.minService.version, options.minService.mandatory ?? true),
    );
    hasUserFilters = true;
  }

  if (options.requestDibs && options.requestDibs.length > 0) {
    srps.push(SRP.requestDibs(options.requestDibs, false));
    hasUserFilters = true;
  } else if (!srps.some((s) => s.type === SRPType.REQUEST_DIBS)) {
    // Request all known DIBs by default (optional M=0) so Core v2 servers return maximum info
    srps.push(SRP.requestDibs(ALL_DIB_TYPES, false));
  }

  return { srps, hasUserFilters };
}

function buildSearchPacket(serviceType: KNXnetIPServiceType, clientHPAI: HPAI, srps: SRP[]): Buffer {
  const body =
    serviceType === KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED && srps.length > 0
      ? Buffer.concat([clientHPAI.toBuffer(), ...srps.map((s) => s.toBuffer())])
      : clientHPAI.toBuffer();
  const header = new KNXnetIPHeader(serviceType, KNXnetIPHeader.HEADER_SIZE_10 + body.length);
  return Buffer.concat([header.toBuffer(), body]);
}

function parseSearchResponseIntoMap(msg: Buffer, discoveredDevices: Map<string, KNXDiscoveredDevice>): void {
  const header = KNXnetIPHeader.fromBuffer(msg);
  if (
    header.serviceType !== KNXnetIPServiceType.SEARCH_RESPONSE &&
    header.serviceType !== KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED
  ) {
    return;
  }

  const body = msg.subarray(KNXnetIPHeader.HEADER_SIZE_10);
  if (body.length < 8) return;
  const hpai = HPAI.fromBuffer(body);

  const deviceKey = `${hpai.ipAddress}:${hpai.port}`;
  const entry: KNXDiscoveredDevice = discoveredDevices.get(deviceKey) ?? {
    ip: hpai.ipAddress,
    port: hpai.port,
    knxMediumRaw: 0,
    knxMedium: "Unknown",
    deviceStatusRaw: 0,
    deviceStatus: "Unknown",
    individualAddress: 0,
    individualAddressText: "0.0.0",
    projectInstallationId: 0,
    serialNumber: Buffer.alloc(6),
    serialNumberHex: "000000000000",
    routingMulticastAddress: "0.0.0.0",
    macAddress: "00:00:00:00:00:00",
    friendlyName: "",
  };

  let offset = 8;
  let parsedAnyDib = false;

  while (offset < body.length) {
    const dibLen = body.readUInt8(offset);
    if (dibLen === 0 || offset + dibLen > body.length) break;
    const dib = DIB.fromBuffer(body.subarray(offset, offset + dibLen));
    offset += dibLen;

    if (dib instanceof DeviceInformationDIB) {
      parsedAnyDib = true;
      entry.knxMediumRaw = dib.knxMedium;
      entry.knxMedium = MEDIUM_NAMES[dib.knxMedium] ?? `Unknown (${dib.knxMedium})`;
      entry.deviceStatusRaw = dib.deviceStatus;
      entry.deviceStatus =
        dib.deviceStatus === 1
          ? "Programmed"
          : dib.deviceStatus === 0
            ? "Not Programmed"
            : `Unknown (${dib.deviceStatus})`;
      entry.individualAddress = dib.individualAddress;
      entry.individualAddressText = KNXHelper.individualAddressToString(dib.individualAddress);
      entry.projectInstallationId = dib.projectInstallationId;
      entry.serialNumber = dib.serialNumber;
      entry.serialNumberHex = dib.serialNumber.toString("hex");
      entry.routingMulticastAddress = dib.routingMulticastAddress;
      entry.macAddress = dib.macAddress;
      entry.friendlyName = dib.friendlyName;
    } else if (dib instanceof SupportedServicesDIB) {
      parsedAnyDib = true;
      entry.supportedServices = dib.services.map((s) => ({
        family: s.family,
        familyName: getServiceFamilyName(s.family),
        version: s.version,
      }));
      entry.supportsTcp = dib.services.some((s) => s.family === AllowedSupportedServiceFamilies.Core && s.version >= 2);
      entry.supportsSecurity = dib.services.some((s) => s.family === AllowedSupportedServiceFamilies.Security);
    } else if (dib instanceof IPConfigDIB) {
      parsedAnyDib = true;
      entry.ipConfig = {
        ipAddress: dib.ipAddress,
        subnetMask: dib.subnetMask,
        defaultGateway: dib.defaultGateway,
        ipCapabilities: dib.ipCapabilities,
        ipCapabilitiesText: formatIpCapabilities(dib.ipCapabilities),
        ipAssignmentMethod: dib.ipAssignmentMethod,
        ipAssignmentMethodText: formatIpAssignmentMethod(dib.ipAssignmentMethod),
      };
    } else if (dib instanceof IPCurrentConfigDIB) {
      parsedAnyDib = true;
      entry.ipCurrentConfig = {
        ipAddress: dib.ipAddress,
        subnetMask: dib.subnetMask,
        defaultGateway: dib.defaultGateway,
        dhcpServer: dib.dhcpServer,
        ipAssignmentMethod: dib.ipAssignmentMethod,
        ipAssignmentMethodText: formatIpAssignmentMethod(dib.ipAssignmentMethod),
      };
    } else if (dib instanceof KNXAddressesDIB) {
      parsedAnyDib = true;
      entry.knxAddresses = {
        individualAddress: dib.knxIndividualAddress,
        individualAddressText: KNXHelper.individualAddressToString(dib.knxIndividualAddress),
        additionalIndividualAddresses: dib.additionalIndividualAddresses,
        additionalIndividualAddressesText: dib.additionalIndividualAddresses.map((addr) =>
          KNXHelper.individualAddressToString(addr),
        ),
      };
    } else if (dib instanceof SecuredServiceFamiliesDIB) {
      parsedAnyDib = true;
      entry.securedServices = dib.services.map((s) => ({
        family: s.family,
        familyName: getServiceFamilyName(s.family),
        securityVersion: s.securityVersion,
      }));
    } else if (dib instanceof TunnellingInfoDIB) {
      parsedAnyDib = true;
      entry.tunnellingInfo = {
        apduLength: dib.apduLength,
        slots: dib.slots.map((slot) => ({
          address: slot.address,
          addressText: KNXHelper.individualAddressToString(slot.address),
          usable: slot.status.usable,
          authorised: slot.status.authorised,
          free: slot.status.free,
        })),
      };
    } else if (dib instanceof ExtendedDeviceInformationDIB) {
      parsedAnyDib = true;
      const dd0 = dib.deviceDescriptorType0.value;
      entry.extendedDeviceInfo = {
        mediumStatus: dib.mediumStatus,
        mediumStatusText: dib.mediumStatus === 0 ? "Communication Possible" : "Communication Impossible",
        maximalLocalApduLength: dib.maximalLocalApduLength,
        deviceDescriptorType0: dd0,
        deviceDescriptorType0Hex: `0x${dd0.toString(16).toUpperCase().padStart(4, "0")}`,
        deviceDescriptorType0Name: DeviceDescriptorType0.describe(dd0),
      };
    } else if (dib instanceof MfrDataDIB) {
      parsedAnyDib = true;
      entry.manufacturerData = {
        manufacturerId: dib.manufacturerId,
        data: dib.data,
        dataHex: dib.data.toString("hex"),
      };
    }
  }

  if (parsedAnyDib) {
    discoveredDevices.set(deviceKey, entry);
  }
}

async function discoverOverTcp(
  targetIp: string,
  port: number,
  timeout: number,
  srps: SRP[],
): Promise<KNXDiscoveredDevice[]> {
  return new Promise<KNXDiscoveredDevice[]>((resolve, reject) => {
    const discoveredDevices = new Map<string, KNXDiscoveredDevice>();
    const reader = new TcpFrameReader();
    let settled = false;
    const socket = net.createConnection({ host: targetIp, port });

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(Array.from(discoveredDevices.values()));
    };

    const timer = setTimeout(() => finish(), timeout);

    socket.once("connect", () => {
      socket.write(buildSearchPacket(KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED, HPAI.NULL_TCP_HPAI, srps));
    });

    socket.on("data", (chunk) => {
      try {
        const frames = reader.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        for (const frame of frames) {
          parseSearchResponseIntoMap(frame, discoveredDevices);
          if (discoveredDevices.size > 0) {
            finish();
            return;
          }
        }
      } catch {
        // Ignore malformed frames
      }
    });

    socket.once("close", () => finish());
    socket.once("error", (err) => finish(err));
  });
}

async function discoverOverUdp(
  targetIp: string,
  ipLocal: string,
  port: number,
  timeout: number,
  useExtended: boolean,
  includeLegacySearch: boolean,
  srps: SRP[],
): Promise<KNXDiscoveredDevice[]> {
  return new Promise<KNXDiscoveredDevice[]>((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const discoveredDevices = new Map<string, KNXDiscoveredDevice>();
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Ignore already-closed socket
      }
      if (err) reject(err);
      else resolve(Array.from(discoveredDevices.values()));
    };

    socket.on("message", (msg: Buffer) => {
      try {
        parseSearchResponseIntoMap(msg, discoveredDevices);
      } catch {
        // Ignore parsing errors for individual packets
      }
    });

    const timer = setTimeout(() => finish(), timeout);
    socket.on("error", (err) => finish(err));

    const bindHost = ipLocal !== "" ? ipLocal : targetIp === "127.0.0.1" ? "127.0.0.1" : undefined;

    socket.bind(0, bindHost, () => {
      const netInfo = getNetworkInfo();
      const advertisedIp = ipLocal !== "" ? ipLocal : targetIp === "127.0.0.1" ? "127.0.0.1" : netInfo.address;
      const clientHPAI = new HPAI(HostProtocolCode.IPV4_UDP, advertisedIp, socket.address().port);

      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(128);

        if (includeLegacySearch) {
          socket.send(buildSearchPacket(KNXnetIPServiceType.SEARCH_REQUEST, clientHPAI, []), port, targetIp);
        }
        if (useExtended) {
          socket.send(buildSearchPacket(KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED, clientHPAI, srps), port, targetIp);
        }
      } catch (e) {
        finish(e as Error);
      }
    });
  });
}

/**
 * Discovers KNXnet/IP servers using `SEARCH_REQUEST` and/or `SEARCH_REQUEST_EXTENDED` (with SRPs),
 * returning all available Device, Service, IP, Address, Tunnelling and Security information.
 */
export async function discoverKnxDevices(options: KNXDiscoverOptions = {}): Promise<KNXDiscoveredDevice[]> {
  const transport = options.transport ?? "UDP";
  const port = options.port ?? 3671;
  const timeout = options.timeout ?? 3000;
  const { srps, hasUserFilters } = buildSearchSrps(options);

  if (transport === "TCP") {
    const targetIp =
      options.ip ?? (options.ipMulticast && options.ipMulticast !== "224.0.23.12" ? options.ipMulticast : "");
    if (!targetIp) {
      throw new Error("Target unicast IP (`options.ip`) is required for TCP SEARCH_REQUEST_EXTENDED");
    }
    return discoverOverTcp(targetIp, port, timeout, srps);
  }

  const targetIp = options.ip ?? options.ipMulticast ?? "224.0.23.12";
  const ipLocal = options.ipLocal ?? "";
  const useExtended = options.useExtended ?? true;
  const includeLegacySearch = options.includeLegacySearch ?? !hasUserFilters;

  return discoverOverUdp(targetIp, ipLocal, port, timeout, useExtended, includeLegacySearch, srps);
}
