import * as hid from 'node-hid';
import { KNXService } from "./KNXService";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { CEMIAdapter } from "../utils/CEMIAdapter";
import { CEMI } from "../core/CEMI";
import { KNXUSBOptions } from '../@types/interfaces/connection';

export class KNXUSBConnection extends KNXService<KNXUSBOptions> {
  private device: hid.HID | null = null;
  private isConnected: boolean = false;
  private sequenceCounter: number = 0;
  private rxBuffer: Buffer = Buffer.alloc(0);

  constructor(options: KNXUSBOptions) {
    super(options);
    this.logger = this.logger.child({ module: 'KNXUSBConnection' });
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    return new Promise((resolve, reject) => {
      try {
        const options = this.options;
        let devicePath = options.path;

        if (!devicePath) {
          const devices = hid.devices();
          const knxDevice = devices.find(d =>
            (options.vendorId && d.vendorId === options.vendorId && options.productId && d.productId === options.productId) ||
            (d.vendorId === 0x28c2) || // Zennio
            (d.vendorId === 0x145c) || // ABB/Busch-Jaeger
            (d.vendorId === 0x10a6) || // MDT
            (d.vendorId === 0x135e) || // Siemens
            (d.vendorId === 0x0e77) || // Weinzierl/Siemens
            (d.vendorId === 0x147b) || // Weinzierl
            (d.vendorId === 0x16d0) || // MCS
            (d.product && d.product.toLowerCase().includes('knx'))
          );

          if (!knxDevice || !knxDevice.path) {
            throw new Error("No KNX USB device found");
          }
          devicePath = knxDevice.path;
        }

        this.logger.info(`Opening KNX USB device at ${devicePath}`);
        this.device = new hid.HID(devicePath);

        this.device.on("data", (data: Buffer) => {
          this.handleData(data);
        });
        this.device.on("error", (err: any) => this.handleError(err));

        this.isConnected = true;
        this.sequenceCounter = 0;
        this.rxBuffer = Buffer.alloc(0);

        this.initializeDevice().then(() => {
          this.emit("connected");
          resolve();
        }).catch((err) => {
          this.logger.error("Failed to initialize KNX USB: " + err);
          this.disconnect();
          reject(err);
        });

      } catch (err) {
        this.logger.error("Failed to connect to KNX USB: " + err);
        reject(err);
      }
    });
  }

  disconnect(): void {
    if (!this.isConnected || !this.device) return;

    try {
      this.device.close();
    } catch (e) {
      // Ignore close errors
    } finally {
      this.device = null;
      this.isConnected = false;
      this.emit("disconnected");
    }
  }

  private async initializeDevice(): Promise<void> {
    // 1. Send Reset Request (M_RESET_REQ = 0xF1)
    await this.sendUSBTransfer(0x01, 0x03, Buffer.from([0xF1]));
    await new Promise(r => setTimeout(r, 100));

    // 2. Set active EMI type to cEMI (0x03)
    // protocolId: 0x0f (BusAccessServerFeatureService)
    // emiId: 0x03 (service device feature set), feature: 0x05, value: 0x03
    await this.sendUSBTransfer(0x0f, 0x03, Buffer.from([0x05, 0x03]));
    await new Promise(r => setTimeout(r, 100));

    // 3. Set Comm Mode (PID_COMM_MODE)
    // M_PROP_WRITE_REQ (0xF6), ObjType (0x0008), ObjInst (0x01), PropId (0x34), Elements (1) + StartIdx (1) -> 0x1001, Mode: 0x00 (DataLinkLayer)
    const commModeBuf = Buffer.from([
      0xF6, // M_PROP_WRITE_REQ
      0x00, 0x08, // Interface Object
      0x01, // Object Instance
      0x34, // Property ID (52)
      0x10, 0x01, // Elements + Start Index
      0x00 // Data (DataLinkLayer, 0x00)
    ]);
    await this.sendUSBTransfer(0x01, 0x03, commModeBuf);
    await new Promise(r => setTimeout(r, 100));
  }

  private async sendUSBTransfer(protocolId: number, emiId: number, data: Buffer): Promise<void> {
    if (!this.device) throw new Error("Device offline");

    const header = Buffer.alloc(8);
    header[0] = 0x00; // protocol version
    header[1] = 0x08; // header length
    header.writeUInt16BE(data.length, 2); // body length
    header[4] = protocolId;
    header[5] = emiId;
    header.writeUInt16BE(0x0000, 6); // manufacturer code

    const body = Buffer.concat([header, data]);
    this.sendHIDReport(body);
  }

  private sendHIDReport(data: Buffer): void {
    if (!this.device) return;

    const reportSize = 64;
    const maxBodyLength = 61;

    let offset = 0;
    while (offset < data.length) {
      const isStart = offset === 0;
      const chunk = data.subarray(offset, offset + maxBodyLength);
      offset += chunk.length;
      const isEnd = offset >= data.length;

      let packageType = 0;
      if (isStart && isEnd) packageType = 3;
      else if (isStart) packageType = 1;
      else if (isEnd) packageType = 2;
      else packageType = 0;

      this.sequenceCounter = (this.sequenceCounter + 1) & 0x0f;
      if (this.sequenceCounter === 0) this.sequenceCounter = 1;

      const report = Buffer.alloc(reportSize);
      report[0] = 0x01; // Report ID
      report[1] = (this.sequenceCounter << 4) | packageType;
      report[2] = chunk.length;
      chunk.copy(report, 3);

      this.device.write(report);
    }
  }

  async send(data: Buffer | ServiceMessage): Promise<void> {
    if (!this.isConnected || !this.device) {
      throw new Error("KNX USB device offline");
    }

    try {
      let frame: Buffer;

      if (Buffer.isBuffer(data)) {
        frame = data;
      } else {
        frame = data.toBuffer();
      }

      // Send as cEMI
      await this.sendUSBTransfer(0x01, 0x03, frame);

    } catch (err) {
      this.logger.error("Error sending to USB:" + err);
      throw err;
    }
  }

  private handleData(data: Buffer) {
    if (data.length < 3 || data[0] !== 0x01) return;

    const sequenceAndType = data[1];
    const packageType = sequenceAndType & 0x0f;
    const bodyLength = data[2];

    if (data.length < 3 + bodyLength) return;

    const body = data.subarray(3, 3 + bodyLength);

    if (packageType & 0x01) {
      // Start of packet
      this.rxBuffer = Buffer.from(body);
    } else {
      // Continuation
      this.rxBuffer = Buffer.concat([this.rxBuffer, body]);
    }

    if (packageType & 0x02) {
      // End of packet, process frame
      this.processTransferFrame(this.rxBuffer);
    }
  }

  private processTransferFrame(buffer: Buffer) {
    if (buffer.length < 8) return;

    const headerLength = buffer[1];
    const bodyLength = buffer.readUInt16BE(2);
    const protocolId = buffer[4];
    const emiId = buffer[5];

    if (headerLength !== 0x08 || buffer.length < headerLength + bodyLength) return;

    const bodyStart = headerLength;
    const payload = buffer.subarray(bodyStart, bodyStart + bodyLength);

    if (protocolId === 0x01 && emiId === 0x03) {
      // cEMI
      if (payload.length > 0) {
        try {
          const cemiMsg = CEMI.fromBuffer(payload);
          if (cemiMsg) {
            this.emit("indication", cemiMsg);
            this.emit("raw_indication", payload);
            try {
               const emiMsg = CEMIAdapter.cemiToEmi(cemiMsg);
               if (emiMsg) this.emit("indication_emi", emiMsg);
            } catch(e) {}
          }
        } catch (e: any) {
          this.logger.debug(`Error parsing incoming USB cEMI data: ${e.message}`);
        }
      }
    }
  }

  private handleError(err: any) {
    this.logger.error("KNX USB Error:", err);
    this.isConnected = false;
    this.emit("error", err);
  }
}
