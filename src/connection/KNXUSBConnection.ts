import * as hid from 'node-hid';
import { KNXService } from "./KNXService";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { CEMIAdapter } from "../utils/CEMIAdapter";
import { CEMI } from "../core/CEMI";
import { KNXUSBOptions } from '../@types/interfaces/connection';
import { EMI } from '../core/EMI';
import { inspect } from 'util';

export class KNXUSBConnection extends KNXService<KNXUSBOptions> {
  private device: hid.HID | null = null;
  private isConnected: boolean = false;

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
            (d.vendorId === 0x0e77) || // Weinzierl
            (d.product && d.product.includes('KNX'))
          );

          if (!knxDevice || !knxDevice.path) {
            throw new Error("No KNX USB device found");
          }
          devicePath = knxDevice.path;
        }

        this.logger.info(`Opening KNX USB device at ${devicePath}`);
        this.device = new hid.HID(devicePath);

        this.device.on("data", (data: Buffer) => {
          console.log(inspect(data, {
            depth: Infinity
          }));
          this.handleData(data);
        });
        this.device.on("error", (err: any) => this.handleError(err));

        this.isConnected = true;
        this.emit("connected");
        resolve();
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

  async send(data: Buffer | ServiceMessage): Promise<void> {
    if (!this.isConnected || !this.device) {
      throw new Error("KNX USB device offline");
    }

    try {
      let frame: Buffer;

      if (Buffer.isBuffer(data)) {
        try {
          const cemi = CEMI.fromBuffer(data);
          const emi = CEMIAdapter.cemiToEmi(cemi);
          if (!emi) throw new Error("Could not convert CEMI to EMI");
          frame = emi.toBuffer();
        } catch (e) {
          frame = data;
        }
      } else {
        const emi = CEMIAdapter.cemiToEmi(data);
        if (!emi) throw new Error("Could not convert CEMI to EMI");
        frame = emi.toBuffer();
      }

      // KNX USB requires 64-byte HID reports
      const report = Buffer.alloc(64);
      report[0] = 0x01; // Report ID for KNX

      // Some interfaces require the frame length to be specified explicitly
      // But standard EMI wrapper includes message code.
      frame.copy(report, 1, 0, Math.min(frame.length, 63));

      this.device.write(report);

    } catch (err) {
      this.logger.error("Error sending to USB:" + err);
      throw err;
    }
  }

  private handleData(data: Buffer) {
    let payloadOffset = 0;
    // let isCemi = false;
    // Check if the first byte is the Report ID (0x01)
    if (data[0] === 0x01) {
      // Check for KNX USB Transfer Protocol Header
      // Format: 01 [Seq/Type] [TotalLen] [ProtocolVersion] [HeaderLen] [BodyLen MSB] [BodyLen LSB] [ProtocolID] [EMI_ID]
      if (data.length > 8 && data[3] === 0x00 && data[4] > 0 && data[7] === 0x01) {
        payloadOffset = 3 + data[4];
        // if (data[8] === 0x03) {
        //   isCemi = true; // EMI ID 0x03 indicates cEMI                                                                                                                                       
        // }
      } else if (data[1] === 0x29 || data[1] === 0x2b || data[1] === 0x11 || data[1] === 0x8b || data[1] === 0x49) {
        payloadOffset = 1; // Raw EMI/cEMI without USB Transfer Header
      }
    }

    if (payloadOffset === 0 || payloadOffset >= data.length) return;

    const messageCode = data[payloadOffset];

    // Valid EMI/cEMI message codes (e.g., L_Data.ind, L_Data.con)
    if (messageCode === 0x29 || messageCode === 0x2B || messageCode === 0x11 || messageCode === 0x8B || messageCode === 0x49) {

      let endIdx = data.length;
      while (endIdx > payloadOffset && data[endIdx - 1] === 0) {
        endIdx--;
      }

      // If we know it's not cEMI, we can approximate the length using NPDU len
      // if (!isCemi && endIdx - payloadOffset > 7) {
      if (endIdx - payloadOffset > 7) {
        const npduLen = data[payloadOffset + 6];
        const expectedLen = 7 + npduLen;
        if (expectedLen > 0 && expectedLen <= (data.length - payloadOffset)) {
          endIdx = payloadOffset + expectedLen;
        }
      }
      const payloadBuffer = data.subarray(payloadOffset, endIdx);

      try {
        let emimsg: ServiceMessage | null = null;
        let cemiMsg: ServiceMessage | null = null;

        emimsg = EMI.fromBuffer(payloadBuffer);
        console.log("EMI_USB", emimsg);
        cemiMsg = CEMIAdapter.emiToCemi(payloadBuffer);
        console.log("EMI_TO_CEMI_USB", cemiMsg);
        console.log("Direct_CEMI", CEMI.fromBuffer(payloadBuffer));

        if (emimsg) {
          this.emit("indication", cemiMsg);
          // ** Falta ver como lo recibe el RouterLinks
          this.emit("indication_emi", emimsg);
          this.emit("raw_indication", payloadBuffer);
        }
      } catch (e: any) {
        this.logger.debug(`Error parsing incoming USB data: ${e.message}`);
      }
    }
  }
  private handleError(err: any) {
    this.logger.error("KNX USB Error:", err);
    this.isConnected = false;
    this.emit("error", err);
  }
}