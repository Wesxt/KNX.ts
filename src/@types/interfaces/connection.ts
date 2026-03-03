import { ConnectionType } from "../../core/enum/KNXnetIPEnum";

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
}

export interface KNXnetIPServerOptions extends KNXnetIPOptions {
  individualAddress?: string;
  serialNumber?: Buffer;
  friendlyName?: string;
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
   * Optional configuration for bridging to external connections (TPUART, Tunneling).
   */
  externals?: ExternalManagerOptions;
}

export interface ExternalManagerOptions {
  /**
   * Optional configuration for a physical TPUART connection.
   */
  tpuart?: TPUARTOptions;
  /**
   * Optional list of outbound KNX IP Tunneling client connections.
   */
  tunneling?: KNXTunnelingOptions[];
}

export interface KNXnetIPOptions {
  ip?: string;
  port?: number;
  localIp?: string;
  localPort?: number;
}

export interface TPUARTOptions extends KNXnetIPOptions {
  /**
   * The serial port path (e.g., "/dev/ttyS0" or "COM3").
   */
  path: string;
  /**
   * Optional physical address to assign to the TPUART chip (e.g., "1.1.255").
   */
  individualAddress?: string;
  /**
   * If true, the TPUART will send an ACK for all group telegrams.
   */
  ackGroup?: boolean;
  /**
   * If true, the TPUART will send an ACK for all individual telegrams.
   */
  ackIndividual?: boolean;
}
