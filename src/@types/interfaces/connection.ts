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
  /**
   * Maximum number of messages allowed in the outgoing queue.
   * Defaults to 100.
   */
  maxQueueSize?: number;
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
  /**
   * It abruptly stops a Tunneling client connection if it exceeds this limit of request messages per second; this is done to prevent performance degradation (the default is 100); to disable it, set it to less than 1
   */
  MAX_PENDING_REQUESTS_PER_CLIENT?: number;
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
  /**
   * Pino logger configuration for the Router bridge.
   */
  logOptions?: LoggerOptions;
}

import { LoggerOptions } from "pino";

export interface KNXnetIPOptions {
  ip?: string;
  port?: number;
  localIp?: string;
  localPort?: number;
  /**
   * Pino logger configuration.
   * Allows setting log levels ('info', 'debug', 'warn', 'error', 'silent')
   * and other Pino options like transports for files or rotation.
   * 
   * ## 1. Silent
  * - What it does: Completely disables all logging.
  
  * - When to use it: In production, when performance is the absolute priority and you don't want anything written to stdout.
  
  * ## 2. Error (Maximum Severity)
  * - What it logs: Critical failures that detected an operation or closed a connection.
  * 
  * - Example: Second ACK timeout for sequence 5. Terminating the connection.
  * 
  * - Example: UDP socket errors (busy port, etc.).
  * 
  * - Ideal for: Monitoring system failures that require intervention.
  * 
  * ## 3. Warning
  * - What it logs: Anomalous situations that don't break the server but indicate potential problems.
  * 
  * - Example: Client 192.168.1.50 is being flooded (105 requests/s). (Rate throttling/limiting).
  * 
  * - Example: IA 15.15.1 already in use. Channel replacement. (Orphan Connection Management)
  * 
  * - Example: First retransmission attempt timeouts.
  * 
  * - Ideal for: Identifying misconfigured clients or network congestion.
  * 
  * ## 4. info (Default Level)
  * - What it logs: Important application lifecycle milestones.
  * 
  * - Example: Server initialized at 192.168.1.10:3671.
  * 
  * - Example: Tunnel connection established! Channel: 1, IA: 15.15.1.
  * 
  * - Example: Joining multicast groups on specific interfaces.
  * 
  * - Ideal for: Viewing the overall server status without getting bogged down in the technical details of each packet.
  * 
  * ## 5. debug
  * - What it logs: Protocol "noise." Details of each control message.
  * 
  * - Example: Tunnel ACK received for channel 1, sequence 5.
  * 
  * - Example: Responses to search or description requests. * Example: Details of M_PropRead (object management requests).
  * 
  * - Ideal for: Developers who are integrating the library and need to understand why a command isn't being committed.
  * 
  * ## 6. Trace (Optional)
  * - We haven't implemented this extensively yet
   * 
   * @example
   * // Log rotation with pino-roll (included)
   * logOptions: {
   *   transport: {
   *     target: 'pino-roll',
   *     options: { file: './logs/knx.log', size: '10m', mkdir: true }
   *   }
   * }
   * 
   */
  logOptions?: LoggerOptions;
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
