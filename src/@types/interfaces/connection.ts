import { ConnectionType } from "../../core/enum/KNXnetIPEnum";
import { CEMIInstance } from "../../core/CEMI";

/**
 * Options for configuring a KNX Tunneling connection.
 */
export interface KNXTunnelingOptions extends KNXnetIPOptions {
  /**
   * The transport protocol to use for the connection.
   * 'UDP' is the default and standard for KNXnet/IP.
   * 'TCP' is optional and used for connection-oriented communication.
   */
  transport?: "UDP" | "TCP";
  /**
   * The type of connection to establish.
   * Defaults to TUNNEL_CONNECTION (0x04) for standard telegram exchange.
   * Use DEVICE_MGMT_CONNECTION (0x03) for device configuration and management.
   */
  connectionType?: ConnectionType;
  /**
   * If true, sends a "Route Back" HPAI (IP 0.0.0.0 and port 0).
   * This instructs the KNXnet/IP server to respond directly to the source IP and port
   * from which the request originated. Essential for environments with NAT,
   * firewalls, or VPNs like ZeroTier.
   */
  useRouteBack?: boolean;
  /**
   * Maximum number of messages allowed in the outgoing queue.
   * Defaults to 100.
   */
  maxQueueSize?: number;
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

export interface KNXnetIPOptions {
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

export interface TPUARTOptions {
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

export interface KNXUSBOptions {
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
  projectInstallationId: number;
  serialNumber: Buffer;
  routingMulticastAddress: string;
  macAddress: string;
  friendlyName: string;
}

export interface IndicationRouterLink {
  src: string;
  msg: CEMIInstance;
}
