import { ConnectionType } from "../../core/enum/KNXnetIPEnum";

/**
 * Options for configuring a KNX Tunneling connection.
 */
export interface KNXTunnelingOptions extends KNXClientOptions {
  /**
   * The transport protocol to use for the connection.
   * 'UDP' is the default and standard for KNXnet/IP.
   * 'TCP' is optional and used for connection-oriented communication.
   */
  transport?: 'UDP' | 'TCP';
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

export interface KNXRoutingOptions extends KNXClientOptions {
  individualAddress?: string;
  serialNumber?: Buffer;
  friendlyName?: string;
}

export interface KNXClientOptions {
  ip?: string;
  port?: number;
  localIp?: string;
  localPort?: number;
}