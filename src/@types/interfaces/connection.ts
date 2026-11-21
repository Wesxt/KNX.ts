import { ConnectionType, KNXLayer, TunnelLink } from "../../core/enum/KNXnetIPEnum";
import { CEMIInstance } from "../../core/CEMI";
import type { KnxDataSecure, KNXDataSecureOptions } from "../../security/KnxDataSecure";

/**
 * Configuration options for KNXnet/IP Secure (KNX Standard 03_08_09).
 */
export interface KNXSecureOptions {
  /**
   * User ID for KNXnet/IP Secure unicast sessions (1 = management access, 2..127 = user/tunnelling access).
   * Defaults to 2 (or to the UserID read from the keyring if a keyring is supplied).
   */
  userId?: number;
  /**
   * User password string (ISO-8859-1 / Latin-1) or pre-derived 16-byte PBKDF2 password hash.
   */
  userPassword?: string | Buffer;
  /**
   * Device Authentication Password (FDSK or commissioning auth code) or pre-derived 16-byte Device Authentication Code.
   * Used to verify the server's MAC in SESSION_RESPONSE (03_08_09 §2.2.3.7.3).
   */
  deviceAuthenticationPassword?: string | Buffer;
  /**
   * If true, refuses to establish a secure session unless a valid Device Authentication Code is verified.
   * Defaults to false.
   */
  requireDeviceAuthentication?: boolean;
  /**
   * Path to an ETS `.knxkeys` file, raw XML string, base64 string, or Buffer containing the keyring.
   * When provided with `keyringPassword`, automatically populates `userId`, `userPassword`,
   * `deviceAuthenticationPassword`, or `backboneKey`.
   */
  keyringFile?: string | Buffer;
  /**
   * Password used to decrypt and verify the ETS `.knxkeys` keyring.
   */
  keyringPassword?: string;
  /**
   * Individual Address of the tunnelling interface in the keyring (e.g. "1.1.1").
   * If omitted, the first tunnelling interface in the keyring is selected.
   */
  tunnelInterfaceAddress?: string;
  /**
   * 6-byte KNX Serial Number sent in outgoing SECURE_WRAPPER / TIMER_NOTIFY frames.
   * Defaults to 0x00006b6e7874 ("knxt") for tunnelling clients or the server's serialNumber for routing.
   */
  serialNumber?: Buffer;
  /**
   * 16-byte Secure Backbone Key (or 32-char hex string) for KNX IP Secure Multicast Routing (03_08_09 §2.2.2).
   */
  backboneKey?: Buffer | string;
  /**
   * Multicast latency tolerance in milliseconds (PID_MULTICAST_LATENCY_TOLERANCE).
   * Defaults to 2000 ms (03_08_09 §2.2.2.3.2.2).
   */
  multicastLatencyToleranceMs?: number;
  /**
   * Session keepalive interval in milliseconds for unicast secure sessions.
   * Defaults to 30000 ms (0 = disabled).
   */
  sessionKeepAliveIntervalMs?: number;
  /**
   * Server-side map or record of allowed User IDs (1 = management, 2..127 = user)
   * to plain passwords (ISO-8859-1) or pre-derived 16-byte password hashes.
   */
  users?: Record<number, string | Buffer> | Map<number, string | Buffer>;
  /**
   * Timeout in milliseconds waiting for SESSION_AUTHENTICATE in UNAUTHENTICATED state.
   * Defaults to 10000 ms (03_08_09 §2.2.3.4).
   */
  sessionAuthenticationTimeoutMs?: number;
  /**
   * Inactivity timeout in milliseconds for an AUTHENTICATED secure session.
   * Defaults to 60000 ms (03_08_09 §2.2.3.4).
   */
  sessionTimeoutMs?: number;
  /**
   * Explicit list of secured service families announced in SecuredServiceFamiliesDIB.
   * Defaults automatically when server unicast/routing security credentials are configured.
   */
  securedServiceFamilies?: Array<{ family: number; version: number }>;
}

/**
 * Options for configuring a KNX Tunneling connection.
 */
export interface KNXTunnelingOptions extends KNXnetIPOptions {
  /**
   * The transport protocol to use for the connection.
   * 'UDP' is the default and standard for KNXnet/IP.
   * 'TCP' is optional and used for connection-oriented communication (mandatory when `secure` is set).
   */
  transport?: "UDP" | "TCP";
  /**
   * The type of connection to establish.
   * Defaults to TUNNEL_CONNECTION (0x04) for standard telegram exchange.
   * Use DEVICE_MGMT_CONNECTION (0x03) for device configuration and management.
   */
  connectionType?: ConnectionType;
  /**
   * KNX link layer requested in CRI (`LINK_LAYER` 0x02, `RAW_LAYER` 0x04, `BUSMONITOR_LAYER` 0x80).
   * Defaults to `LINK_LAYER` (03_08_04 §2.2.2–2.2.4).
   */
  knxLayer?: KNXLayer | TunnelLink;
  /**
   * Optional specific KNX Individual Address to request via Extended CRI (03_08_04 §5.4.3.2).
   * Can be a string (`"15.15.2"`) or a 16-bit integer.
   */
  individualAddress?: string | number;
  /**
   * If true, sends a "Route Back" HPAI (IP 0.0.0.0 and port 0).
   * This instructs the KNXnet/IP server to respond directly to the source IP and port
   * from which the request originated. Essential for environments with NAT,
   * firewalls, or VPNs like ZeroTier. Always enabled automatically on TCP.
   */
  useRouteBack?: boolean;
  /**
   * Maximum number of messages allowed in the outgoing queue.
   * Defaults to 100.
   */
  maxQueueSize?: number;
  /**
   * Optional KNXnet/IP Secure configuration. When set, forces TCP transport and establishes
   * an encrypted Secure Session (0x0950..0x0954) prior to opening the tunnelling channel.
   */
  secure?: KNXSecureOptions;
}

export interface KNXnetIPServerOptions extends Omit<KNXnetIPOptions, "ip"> {
  /**
   * IP for Multicast
   */
  ip?: string;
  /**
   * Port for listening to Tunneling clients
   */
  port?: number;
  /**
   * Individual address for KNXnetIpServer
   */
  individualAddress?: string;
  /**
   * MAC address for the KNXnetIP
   */
  serialNumber?: Buffer;
  /**
   * The name displayed to other KNXnetIP devices or applications such as ETS.
   */
  friendlyName?: string;
  /**
   * MAC address for the KNXnetIP
   */
  macAddress?: string;
  /**
   * Defines the client address pool for KNXnet/IP Tunneling connections (e.g. "15.15.10:10" or "1.1.1:5").
   * Format: "START_ADDRESS:COUNT". This dictates how many tunneling clients can connect concurrently
   * and which individual addresses they will receive. Defaults to 15 connections starting from Area.Line.1.
   */
  clientAddrs?: string;
  /**
   * The minimum delay between two consecutive ROUTING_INDICATION frames sent to the bus.
   * Default is 20ms (standard for TP1 compatibility).
   * Setting this to a lower value can increase performance but may flood slow KNX segments.
   */
  routingDelay?: number;
  /**
   * It abruptly stops a Tunneling client connection if it exceeds this limit of request messages per second; this is done to prevent performance degradation (the default is 100); to disable it, set it to less than 1
   */
  MAX_PENDING_REQUESTS_PER_CLIENT?: number;
  /**
   * If true, the server will join the multicast group on all valid host network interfaces (Multi-homing).
   * This improves discovery in multi-interface systems but can be disabled for specific network isolation.
   * Defaults to true.
   */
  useAllInterfaces?: boolean;
  /**
   * Ignore the ACK timeout for tunneling clients that do not respond with TUNNELLING_ACK.
   * Default: false
   */
  ignoreACKTimeout?: boolean;
  /**
   * Optional KNXnet/IP Secure configuration for Secure Routing multicast (03_08_09 §2.2.2)
   * and Secure TCP unicast sessions (03_08_09 §2.2.3).
   */
  secure?: KNXSecureOptions;
  /**
   * Enables the TCP listener on the KNXnet/IP server (03_08_02 §8.4.3).
   * Defaults to true.
   */
  tcp?: boolean;
  /**
   * Optional port override for the TCP listener. Defaults to `port` (3671).
   */
  tcpPort?: number;
  /**
   * Optional host/IP address to bind the TCP listener to. Defaults to "0.0.0.0".
   */
  tcpHost?: string;
  /**
   * Idle timeout in milliseconds for TCP sockets with no active KNXnet/IP connections or Secure Sessions.
   * Defaults to 10000 ms (03_08_02 §8.4.3.5).
   */
  tcpIdleTimeoutMs?: number;
  /**
   * Whether plaintext KNXnet/IP connections (CONNECT_REQUEST, DESCRIPTION_REQUEST, etc.)
   * are accepted on TCP without a Secure Session. Defaults to true.
   */
  allowPlainTcp?: boolean;
}

export interface ExternalManagerOptions {
  /**
   * Optional configuration for a KNXnetIPServer
   */
  knxNetIpServer?: { individualAddress?: string } & Omit<KNXnetIPServerOptions, "individualAddress">;
  /**
   * Optional configuration for a physical TPUART connection.
   */
  tpuart?: { individualAddress?: string } & Omit<TPUARTOptions, "individualAddress">;
  /**
   * Optional list of outbound KNX IP Tunneling client connections.
   */
  tunneling?: KNXTunnelingOptions[];
  /**
   * Optional configuration for a physical KNX USB connection.
   */
  usb?: { individualAddress?: string } & Omit<KNXUSBOptions, "individualAddress">;
  /**
   * Pino logger configuration for the Router bridge.
   */
  logOptions?: KNXLoggerOptions;
}
export interface KNXLoggerOptions {
  /**
   * Log level. Defaults to 'info'. 'noLog' disables logging.
   */
  level?: "info" | "warn" | "error" | "debug" | "noLog";
  /**
   * Enable or disable logging. Defaults to true.
   */
  enabled?: boolean;
  /**
   * If true, logs will be written to a file using an asynchronous Worker Thread.
   * The files will be rolled daily.
   */
  logToFile?: boolean;
  /**
   * Directory where log files will be stored. Defaults to './logs'.
   */
  logDir?: string;
  /**
   * Base filename for the log file. If not provided, it defaults to the date (YYYY-MM-DD.log).
   * If provided, the date will be prepended to the filename.
   */
  logFilename?: string;
}

export interface BaseConnectionOptions {
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  /**
   * Optional KNX Data Security (`03_03_07` §5) configuration or pre-created {@link KnxDataSecure} manager.
   * When configured, outgoing Group telegrams for configured Group Addresses are automatically encrypted
   * and incoming `S-A_Data` frames are automatically verified and decrypted before emitting `indication` / GA events.
   */
  dataSecure?: KnxDataSecure | KNXDataSecureOptions;
}

export interface KNXnetIPOptions extends BaseConnectionOptions {
  /**
   * IP address of the KNXnetIP server
   */
  ip: string;
  /**
   * Port of the KNXnetIP server
   */
  port?: number;
  localIp?: string;
  localPort?: number;
  /**
   * Pino logger configuration.
   */
  logOptions?: KNXLoggerOptions;
}

export interface TPUARTOptions extends BaseConnectionOptions {
  /**
   * The serial port path (e.g., "/dev/ttyS0" or "COM3").
   */
  path: string;
  /**
   * Physical address to assign to the TPUART chip (e.g., "1.1.255").
   */
  individualAddress: string;
  /**
   * If true, the TPUART will send an ACK for all group telegrams.
   */
  ackGroup?: boolean;
  /**
   * If true, the TPUART will send an ACK for all individual telegrams.
   */
  ackIndividual?: boolean;
  /**
   * Pino logger configuration.
   */
  logOptions?: KNXLoggerOptions;
}

export interface RouterConnOptions extends ExternalManagerOptions {
  /**
   * This is so that the router decrements the hop count each time it routes the message to other links. Logically, if the incoming message has 0 hop counts, the message is not routed. If enabled, it is no longer possible to program devices to the physical layer links (TPUART, KNXUSB). Default: false.
   */
  handleHopCount?: boolean;
  /**
   * This individual address will be assigned to all links, except tunneling links; this is done to enable programming devices through ETS.
   * @warning This will obviously cause some links to be out of line.
   */
  individualAddress: string;
  /**
   * This is to assign the same individual address to all links except Tunneling links; default: true
   * @warning This will obviously cause some links to be out of line.
   */
  isUseSingleIA?: boolean;
  /**
   * Filtering IP addresses from KNXnetIP to other interfaces such as TPUART or USB
   */
  toLocalFilter?: {
    individualAddress?: {
      addresses: string[];
      individualAddressToLocalFilterPolicie: "discard all" | "accept only";
    };
    groupAddress?: {
      addresses: string[];
      groupAddressToLocalFilterPolicie: "discard all" | "accept only";
    };
  };
  /**
   * Filtering addresses from interfaces such as TP UART or USB to KNXnet IP
   */
  toIpFilter?: {
    individualAddress?: {
      addresses: string[];
      individualAddressToIpFilterPolicie: "discard all" | "accept only";
    };
    groupAddress?: {
      addresses: string[];
      groupAddressToIpFilterPolicie: "discard all" | "accept only";
    };
  };
}

export interface KNXUSBOptions extends BaseConnectionOptions {
  path?: string;
  vendorId?: number;
  productId?: number;
  individualAddress: string;
  /**
   * Pino logger configuration.
   */
  logOptions?: KNXLoggerOptions;
}

export type AllConnectionOptions = TPUARTOptions | KNXUSBOptions | KNXnetIPServerOptions | KNXTunnelingOptions;

import type { SRP } from "../../core/KNXnetIPStructures";

/**
 * Interface for a discovered KNXnet/IP device.
 */
export interface KNXDiscoveredDevice {
  ip: string;
  port: number;
  knxMediumRaw: number;
  knxMedium: string;
  deviceStatusRaw: number;
  deviceStatus: string;
  individualAddress: number;
  individualAddressText: string;
  projectInstallationId: number;
  serialNumber: Buffer;
  serialNumberHex?: string;
  routingMulticastAddress: string;
  macAddress: string;
  friendlyName: string;
  supportedServices?: { family: number; familyName: string; version: number }[];
  ipConfig?: {
    ipAddress: string;
    subnetMask: string;
    defaultGateway: string;
    ipCapabilities: number;
    ipCapabilitiesText: string[];
    ipAssignmentMethod: number;
    ipAssignmentMethodText: string;
  };
  ipCurrentConfig?: {
    ipAddress: string;
    subnetMask: string;
    defaultGateway: string;
    dhcpServer: string;
    ipAssignmentMethod: number;
    ipAssignmentMethodText: string;
  };
  knxAddresses?: {
    individualAddress: number;
    individualAddressText: string;
    additionalIndividualAddresses: number[];
    additionalIndividualAddressesText: string[];
  };
  securedServices?: { family: number; familyName: string; securityVersion: number }[];
  tunnellingInfo?: {
    apduLength: number;
    slots: { address: number; addressText: string; usable: boolean; authorised: boolean; free: boolean }[];
  };
  extendedDeviceInfo?: {
    mediumStatus: number;
    mediumStatusText: string;
    maximalLocalApduLength: number;
    deviceDescriptorType0: number;
    deviceDescriptorType0Hex: string;
    deviceDescriptorType0Name: string;
  };
  manufacturerData?: {
    manufacturerId: number;
    data: Buffer;
    dataHex: string;
  };
  supportsTcp?: boolean;
  supportsSecurity?: boolean;
}

/**
 * Options for KNXnet/IP discovery (`SEARCH_REQUEST` / `SEARCH_REQUEST_EXTENDED` with SRPs).
 */
export interface KNXDiscoverOptions {
  /** Target unicast IP (optional for UDP multicast, required for TCP). */
  ip?: string;
  /** Local interface IP for UDP discovery endpoint HPAI. */
  ipLocal?: string;
  /** Multicast destination IP when `ip` is omitted (default `"224.0.23.12"`). */
  ipMulticast?: string;
  /** Target port (default `3671`). */
  port?: number;
  /** Discovery wait timeout in milliseconds (default `3000`). */
  timeout?: number;
  /** Transport protocol (`"UDP"` multicast/unicast or `"TCP"` unicast extended search). */
  transport?: "UDP" | "TCP";
  /** Whether to send `SEARCH_REQUEST_EXTENDED` on UDP (default `true`). */
  useExtended?: boolean;
  /**
   * Whether to also send legacy `SEARCH_REQUEST` on UDP.
   * Defaults to `true` when no SRPs are provided and `false` when SRPs are present so SRP filters take effect.
   */
  includeLegacySearch?: boolean;
  /** Raw Search Request Parameter (SRP) blocks to include in `SEARCH_REQUEST_EXTENDED`. */
  srps?: SRP[];
  /** Convenience SRP: filter for servers in programming mode (`0x01`). */
  programmingModeOnly?: boolean;
  /** Convenience SRP: filter by server MAC address (`0x02`). */
  macAddress?: string;
  /** Convenience SRP: filter by minimum supported service family version (`0x03`). */
  minService?: { family: number; version: number; mandatory?: boolean };
  /** Convenience SRP: request specific Description Information Block (DIB) type codes (`0x04`). */
  requestDibs?: number[];
}

export interface IndicationRouterLink {
  src: string;
  msg: CEMIInstance;
}
