import { ModbusDataType, ModbusGatewayOptions, ModbusMapping } from "../@types/interfaces/modbus";
import { GroupAddressCache } from "../core/cache/GroupAddressCache";
import { CEMIInstance } from "../core/CEMI";
import { Aedes } from "aedes";
import { createServer, Server } from "aedes-server-factory";
import * as mqtt from "mqtt";
import { knxLogger } from "../utils/Logger";
import pino from "pino";
import ModbusRTU from "modbus-serial";

export class ModbusGateway {
  private options: ModbusGatewayOptions;
  public mappings: ModbusMapping[] = [];

  // MQTT
  private aedesBroker: Aedes | null = null;
  private mqttServer: Server | null = null;
  private mqttClient: mqtt.MqttClient | null = null;

  // Modbus
  private modbusClient: ModbusRTU | null = null; // Master
  private modbusServer: any = null; // Slave
  private memoryMap: {
    coils: Buffer;
    discrete: Buffer;
    holding: Buffer;
    input: Buffer;
  } = {
    coils: Buffer.alloc(10000), // simplistic memory map up to 10000 registers
    discrete: Buffer.alloc(10000),
    holding: Buffer.alloc(20000), // 2 bytes per holding
    input: Buffer.alloc(20000),
  };

  private pollingTimers: NodeJS.Timeout[] = [];
  private notifyDebouncers: Map<string, NodeJS.Timeout> = new Map();
  private logger: pino.Logger<never, boolean>;

  constructor(options: ModbusGatewayOptions) {
    this.options = options;
    if (options.mappings) {
      this.mappings = [...options.mappings];
    }
    this.logger = knxLogger.child({ module: "ModbusGateway" });
  }

  public async start(): Promise<void> {
    if (this.options.mqtt) {
      await this.initMQTT();
    }

    if (this.options.knxContext) {
      // Enable cache if it's not already delegated
      GroupAddressCache.getInstance().setEnabled(true);
      this.initKNX();
    }

    if (this.options.mode === "master") {
      this.modbusClient = new ModbusRTU();
      await this.connectModbusClient();
      this.startMasterPolling();
    } else if (this.options.mode === "slave") {
      await this.startModbusServer();
    }
  }

  public stop(): void {
    if (this.mqttClient) this.mqttClient.end();
    if (this.mqttServer) this.mqttServer.close();
    if (this.aedesBroker) this.aedesBroker.close();

    this.pollingTimers.forEach(clearInterval);
    this.pollingTimers = [];

    if (this.modbusClient) this.modbusClient.close();
    if (this.modbusServer) this.modbusServer.close();
  }

  // ============== MODBUS CLIENT (MASTER) ==============

  private async connectModbusClient() {
    this.modbusClient!.setID(this.options.modbusId || 1);
    this.modbusClient!.setTimeout(2000);

    if (this.options.protocol === "tcp") {
      if (!this.options.host || !this.options.port) throw new Error("Missing host or port for TCP mode");
      const host = this.options.host;
      const port = this.options.port;
      await new Promise<void>((resolve, reject) => {
        this.modbusClient!.connectTCP(host, { port }, (err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
    } else {
      if (!this.options.path || !this.options.baudRate) throw new Error("Missing path or baudRate for RTU mode");
      const path = this.options.path;
      const baudRate = this.options.baudRate;
      await new Promise<void>((resolve, reject) => {
        this.modbusClient!.connectRTU(path, { baudRate }, (err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }

  private startMasterPolling() {
    const defaultInterval = this.options.defaultPollingInterval || 1000;

    // We can poll individually based on intervals.
    // For optimization in real world, grouping continuous registers is preferred.
    // Here we use single register polling for precise mapping implementation.
    for (const mapping of this.mappings) {
      const intervalMs = mapping.interval || defaultInterval;

      let lastValue: any = null;

      const timer = setInterval(async () => {
        if (!this.modbusClient?.isOpen) return;

        try {
          let value: number | boolean | null = null;
          const dataType = mapping.dataType || "uint16";
          const is32Bit = dataType.includes("32");
          const lengthToRead = is32Bit ? 2 : 1;

          if (mapping.type === "holding") {
            const data = await this.modbusClient!.readHoldingRegisters(mapping.address, lengthToRead);
            value = is32Bit ? this.parse32BitBuffer(data.buffer, dataType) : data.data[0];
          } else if (mapping.type === "input") {
            const data = await this.modbusClient!.readInputRegisters(mapping.address, lengthToRead);
            value = is32Bit ? this.parse32BitBuffer(data.buffer, dataType) : data.data[0];
          } else if (mapping.type === "coil") {
            const data = await this.modbusClient!.readCoils(mapping.address, 1);
            value = data.data[0];
          } else if (mapping.type === "discrete") {
            const data = await this.modbusClient!.readDiscreteInputs(mapping.address, 1);
            value = data.data[0];
          }

          if (value !== null) {
            let processedValue = value;
            if (mapping.scale && typeof value === "number") {
              processedValue = value * mapping.scale;
            }

            if (lastValue !== processedValue) {
              lastValue = processedValue;
              this.onModbusValueChanged(mapping, processedValue);
            }
          }
        } catch (e) {
          this.logger.debug(e, "Error polling modbus register");
        }
      }, intervalMs);

      this.pollingTimers.push(timer);
    }
  }

  // ============== MODBUS SERVER (SLAVE) ==============

  private async startModbusServer() {
    const vector = {
      getCoil: (addr: number) => this.memoryMap.coils.readUInt8(addr) > 0,
      getDiscreteInput: (addr: number) => this.memoryMap.discrete.readUInt8(addr) > 0,
      getHoldingRegister: (addr: number) => this.memoryMap.holding.readUInt16BE(addr * 2),
      getInputRegister: (addr: number) => this.memoryMap.input.readUInt16BE(addr * 2),
      setCoil: (addr: number, val: boolean) => {
        this.memoryMap.coils.writeUInt8(val ? 1 : 0, addr);
        this.notifyModbusSlaveChange("coil", addr, val);
      },
      setRegister: (addr: number, val: number) => {
        this.memoryMap.holding.writeUInt16BE(val, addr * 2);
        this.notifyModbusSlaveChange("holding", addr, val);
      },
    };

    if (this.options.protocol === "tcp") {
      this.modbusServer = new (ModbusRTU as any).ServerTCP(vector, {
        host: this.options.host || "0.0.0.0",
        port: this.options.port || 502,
        debug: false,
        unitID: this.options.modbusId || 1,
      });
    } else {
      this.modbusServer = new (ModbusRTU as any).ServerSerial(vector, {
        port: this.options.path,
        baudRate: this.options.baudRate,
        debug: false,
        unitID: this.options.modbusId || 1,
      });
    }
  }

  private notifyModbusSlaveChange(type: "coil" | "holding", addr: number, rawValue: boolean | number) {
    const mapping = this.mappings.find((m) => {
      if (m.type !== type) return false;
      const is32Bit = m.dataType?.includes("32");
      if (is32Bit) {
        return m.address === addr || m.address + 1 === addr;
      }
      return m.address === addr;
    });
    if (!mapping) return;

    const debounceMs = mapping.debounceMs ?? 50;
    const key = `${type}-${mapping.address}`;

    if (this.notifyDebouncers.has(key)) {
      clearTimeout(this.notifyDebouncers.get(key));
    }

    const timer = setTimeout(() => {
      this.notifyDebouncers.delete(key);

      let processedValue: any = rawValue;

      const is32Bit = mapping.dataType?.includes("32");
      if (is32Bit && mapping.type === "holding") {
        const buffer = Buffer.alloc(4);
        buffer.writeUInt16BE(this.memoryMap.holding.readUInt16BE(mapping.address * 2), 0);
        buffer.writeUInt16BE(this.memoryMap.holding.readUInt16BE((mapping.address + 1) * 2), 2);
        processedValue = this.parse32BitBuffer(buffer, mapping.dataType!);
      } else if (mapping.dataType === "int16" && typeof rawValue === "number") {
        const buf = Buffer.alloc(2);
        buf.writeUInt16BE(rawValue, 0);
        processedValue = buf.readInt16BE(0);
      }

      if (mapping.scale && typeof processedValue === "number") {
        processedValue = processedValue * mapping.scale;
      }

      this.onModbusValueChanged(mapping, processedValue);
    }, debounceMs);

    this.notifyDebouncers.set(key, timer);
  }

  // ============== DATA FLOW: MODBUS -> OTHERS ==============

  private onModbusValueChanged(mapping: ModbusMapping, value: any) {
    // 1. Send to KNX if configured
    if (mapping.knx && this.options.knxContext) {
      if (mapping.knx.dpt === "config_dpt") return; // Edge case
      this.options.knxContext.write(mapping.knx.groupAddress, mapping.knx.dpt as any, { value } as any).catch((e) => {
        this.logger.debug(e, "Error writing to KNX context");
      });
    }

    // 2. Send to MQTT if configured
    if (mapping.mqtt && this.mqttClient?.connected) {
      const topic = mapping.mqtt.topic;
      let payload = JSON.stringify({ value });
      if (mapping.mqtt.publishTemplate) {
        payload = mapping.mqtt.publishTemplate.replace("{{value}}", String(value));
      }
      this.mqttClient.publish(topic, payload, { retain: true });
    }
  }

  // ============== DATA FLOW: OTHERS -> MODBUS ==============

  private async writeToModbus(mapping: ModbusMapping, value: any) {
    let targetRawValue = value;
    if (mapping.scale && typeof value === "number") {
      targetRawValue = value / mapping.scale; // Reverse scale
      // Note: we don't round immediately because we might be writing a float32!
    }

    const dataType = mapping.dataType || "uint16";
    const is32Bit = dataType.includes("32");

    if (this.options.mode === "master" && this.modbusClient?.isOpen) {
      try {
        if (mapping.type === "coil") {
          await this.modbusClient.writeCoil(mapping.address, !!targetRawValue);
        } else if (mapping.type === "holding") {
          if (is32Bit) {
            const words = this.create32BitBuffer(Number(targetRawValue), dataType);
            await this.modbusClient.writeRegisters(mapping.address, words);
          } else {
            let intValue = Math.round(Number(targetRawValue));
            if (dataType === "int16" && intValue < 0) {
              const buf = Buffer.alloc(2);
              buf.writeInt16BE(intValue, 0);
              intValue = buf.readUInt16BE(0);
            }
            await this.modbusClient.writeRegister(mapping.address, intValue);
          }
        }
      } catch (err) {
        this.logger.debug(err, "Error writing to modbus register");
      }
    } else if (this.options.mode === "slave") {
      if (mapping.type === "coil") {
        this.memoryMap.coils.writeUInt8(targetRawValue ? 1 : 0, mapping.address);
      } else if (mapping.type === "holding") {
        if (is32Bit) {
          const words = this.create32BitBuffer(Number(targetRawValue), dataType);
          this.memoryMap.holding.writeUInt16BE(words[0], mapping.address * 2);
          this.memoryMap.holding.writeUInt16BE(words[1], (mapping.address + 1) * 2);
        } else {
          let intValue = Math.round(Number(targetRawValue));
          if (dataType === "int16" && intValue < 0) {
            const buf = Buffer.alloc(2);
            buf.writeInt16BE(intValue, 0);
            intValue = buf.readUInt16BE(0);
          }
          this.memoryMap.holding.writeUInt16BE(intValue, mapping.address * 2);
        }
      }
    }
  }

  // ============== HELPER BUFFER CONVERSIONS ==============

  private parse32BitBuffer(buffer: Buffer, dataType: ModbusDataType): number {
    if (buffer.length < 4) return 0;

    // modbus-serial returns buffer in Big Endian by default for words
    // buffer = [ byte0, byte1, byte2, byte3 ]

    if (dataType === "float32") return buffer.readFloatBE(0);
    if (dataType === "uint32") return buffer.readUInt32BE(0);
    if (dataType === "int32") return buffer.readInt32BE(0);

    // Swapped means CD AB order (Little Endian words, but bytes inside words are still Big Endian)
    // Swap the first two bytes with the last two bytes
    if (dataType.includes("swapped")) {
      const swapped = Buffer.alloc(4);
      swapped.writeUInt16BE(buffer.readUInt16BE(2), 0);
      swapped.writeUInt16BE(buffer.readUInt16BE(0), 2);

      if (dataType === "float32_swapped") return swapped.readFloatBE(0);
      if (dataType === "uint32_swapped") return swapped.readUInt32BE(0);
      if (dataType === "int32_swapped") return swapped.readInt32BE(0);
    }

    return buffer.readUInt16BE(0);
  }

  private create32BitBuffer(value: number, dataType: ModbusDataType): number[] {
    const buffer = Buffer.alloc(4);

    // Default or non-swapped
    if (dataType === "float32" || dataType === "float32_swapped") buffer.writeFloatBE(value, 0);
    else if (dataType === "uint32" || dataType === "uint32_swapped") buffer.writeUInt32BE(value, 0);
    else if (dataType === "int32" || dataType === "int32_swapped") buffer.writeInt32BE(value, 0);
    else buffer.writeUInt32BE(value, 0);

    const word1 = buffer.readUInt16BE(0);
    const word2 = buffer.readUInt16BE(2);

    if (dataType.includes("swapped")) {
      // CD AB
      return [word2, word1];
    }
    // AB CD
    return [word1, word2];
  }

  // ============== INTEGRATIONS ==============

  private initKNX() {
    if (!this.options.knxContext) return;
    this.options.knxContext.on("indication", (cemi: CEMIInstance) => {
      if (!("destinationAddress" in cemi)) return;
      const dest = cemi.destinationAddress;
      if (!dest) return;

      const cache = GroupAddressCache.getInstance();
      const entries = cache.query(dest, undefined, undefined, true);
      let decodedValue = undefined;

      if (entries && entries.length > 0) {
        decodedValue = entries[0].decodedValue;
      } else {
        // Fallback or rely only on bindings
        return;
      }

      // Check if this destination maps to any modbus register
      const relevantMappings = this.mappings.filter((m) => m.knx?.groupAddress === dest);
      for (const m of relevantMappings) {
        this.writeToModbus(m, decodedValue);
      }
    });
  }

  private async initMQTT(): Promise<void> {
    const mqttOpts = this.options.mqtt;
    if (!mqttOpts) return;

    if (mqttOpts.embeddedBroker) {
      this.aedesBroker = await Aedes.createBroker();
      this.mqttServer = createServer(this.aedesBroker);
      const port = mqttOpts.embeddedBroker.port;
      const host = mqttOpts.embeddedBroker.host || "127.0.0.1";

      await new Promise<void>((serverResolve, serverReject) => {
        if (!this.mqttServer) return serverReject(new Error("The server is null"));
        this.mqttServer.on("error", (err: any) => serverReject(err));
        this.mqttServer.listen(port, host, () => {
          serverResolve();
        });
      });
    }

    return new Promise<void>((resolve, reject) => {
      const url =
        mqttOpts.brokerUrl ||
        (mqttOpts.embeddedBroker
          ? `mqtt://${mqttOpts.embeddedBroker.host ?? "127.0.0.1"}:${mqttOpts.embeddedBroker.port}`
          : null);
      if (!url) {
        throw new Error("No Broker URL provided nor embedded broker requested.");
      }

      this.mqttClient = mqtt.connect(url, {
        username: mqttOpts.mqttUsername,
        password: mqttOpts.mqttPassword,
        connectTimeout: 5000,
      });

      this.mqttClient.on("connect", () => {
        const dynamicTopic = this.options.dynamicConfigTopic || "modbus/config/add_mapping";
        this.mqttClient?.subscribe(dynamicTopic);

        // Subscribe to SET commands for mapped topics
        for (const m of this.mappings) {
          if (m.mqtt?.topic) {
            this.mqttClient?.subscribe(`${m.mqtt.topic}/set`);
          }
        }
        resolve();
      });

      this.mqttClient.on("error", (err) => reject(new Error(`MQTT Client error: ${err.message}`)));

      this.mqttClient.on("message", (topic, message) => {
        const dynamicTopic = this.options.dynamicConfigTopic || "modbus/config/add_mapping";
        if (topic === dynamicTopic) {
          try {
            const newMapping: ModbusMapping = JSON.parse(message.toString());
            this.mappings.push(newMapping);
            if (newMapping.mqtt?.topic) {
              this.mqttClient?.subscribe(`${newMapping.mqtt.topic}/set`);
            }
          } catch (err) {
            this.logger.debug(err, "Error parsing dynamic mapping");
          }
          return;
        }

        // Handle SET commands from MQTT
        if (topic.endsWith("/set")) {
          const stateTopic = topic.replace("/set", "");
          const mapping = this.mappings.find((m) => m.mqtt?.topic === stateTopic);
          if (mapping) {
            try {
              const msgStr = message.toString();
              const payload = JSON.parse(msgStr);
              const val = payload.value !== undefined ? payload.value : payload;
              this.writeToModbus(mapping, val);
            } catch (e) {
              this.logger.debug(e, "Error parsing dynamic mapping");
              // Direct raw value (e.g. true, false, 1)
              const str = message.toString();
              let val: any = str;
              if (str === "true") val = true;
              else if (str === "false") val = false;
              else if (!isNaN(Number(str))) val = Number(str);
              this.writeToModbus(mapping, val);
            }
          }
        }
      });
    });
  }
}
