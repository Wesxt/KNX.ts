import { SerialPortOptions } from "modbus-serial/ModbusRTU";
import { KNXService } from "../../connection/KNXService";
import { Router } from "../../connection/Router";
import { KNXLoggerOptions } from "./connection";

export type ModbusProtocol = "tcp" | "rtu";
export type ModbusMode = "master" | "slave";
export type ModbusRegisterType = "coil" | "discrete" | "holding" | "input";

export type ModbusDataType =
  | "uint16" // Standard 16-bit unsigned (Default)
  | "int16" // Standard 16-bit signed
  | "uint32" // 32-bit unsigned (Big Endian)
  | "int32" // 32-bit signed (Big Endian)
  | "float32" // 32-bit IEEE 754 Float (Big Endian - AB CD)
  | "float32_swapped" // 32-bit IEEE 754 Float (Little Endian Word Swap - CD AB)
  | "uint32_swapped" // 32-bit unsigned (Little Endian Word Swap - CD AB)
  | "int32_swapped"; // 32-bit signed (Little Endian Word Swap - CD AB)

export interface ModbusMapping {
  /**
   * Type of the Modbus register
   */
  type: ModbusRegisterType;
  /**
   * Address of the register (0-based or 1-based, typically 0-based for modbus-serial)
   */
  address: number;
  /**
   * Identifies how to interpret the raw bytes (used for 32-bit floats/ints).
   * Default: "uint16"
   */
  dataType?: ModbusDataType;
  /**
   * Scale to apply to the read value (e.g. read 225 => * 0.1 => 22.5)
   */
  scale?: number;
  /**
   * Specific polling interval for this mapping in ms (only applies in master mode)
   */
  interval?: number;
  /**
   * Delay in ms to wait to forward the data after a write to slave memory arrives (Wait for chunks of 32 bits to be fully written).
   * Only applies in Slave mode. Default: 50
   */
  debounceMs?: number;

  /**
   * If provided, the gateway will sync this Modbus register with this KNX Group Address.
   */
  knx?: {
    groupAddress: string;
    dpt: string | number;
  };

  /**
   * If provided, the gateway will sync this Modbus register with this MQTT Topic.
   */
  mqtt?: {
    topic: string;
    /**
     * Optional JSON template for publishing.
     * Use {{value}} to inject the scaled value.
     * Example: '{"value": {{value}}}'
     */
    publishTemplate?: string;
  };
  _lastValue?: any;
}

export interface SharedMQTTOptions {
  // Either spin up an internal Aedes broker
  embeddedBroker?: {
    port: number;
    host?: string;
  };
  // And/Or connect to an existing broker
  brokerUrl?: string;
  mqttUsername?: string;
  mqttPassword?: string;
  topicPrefix?: string;
}

export interface ModbusGatewayOptions {
  /**
   * Gateway mode.
   * 'master': Polls remote slaves and writes back.
   * 'slave': Holds a local memory map and serves requests from a master.
   */
  mode: ModbusMode;
  /**
   * Protocol to use.
   */
  protocol: ModbusProtocol;

  // Connection config: TCP
  host?: string;
  port?: number;
  path: string;

  serialPort: SerialPortOptions;

  /**
   * Modbus Unit ID (Slave ID).
   * For master: ID of the remote slave
   * For slave: ID this server will listen to (default 1)
   */
  modbusId?: number;

  // Networking Links
  knxContext?: KNXService | Router;
  mqtt?: SharedMQTTOptions;

  /**
   * Pre-configured mappings
   */
  mappings?: ModbusMapping[];

  /**
   * Default polling interval for Master mode (ms)
   */
  defaultPollingInterval?: number;

  /**
   * MQTT Topic to listen for dynamic mapping injections.
   * Default: modbus/config/add_mapping
   */
  dynamicConfigTopic?: string;

  logOptions?: KNXLoggerOptions;
}
