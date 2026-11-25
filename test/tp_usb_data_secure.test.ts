import { EventEmitter } from "node:events";

// Mock serialport and node-hid BEFORE importing TPUARTConnection / KNXUSBConnection
class MockSerialPort extends EventEmitter {
  public static lastInstance: MockSerialPort | null = null;
  public isOpen = false;
  public written: Buffer[] = [];
  public onWrite?: (buf: Buffer) => void;

  constructor(public config: any) {
    super();
    MockSerialPort.lastInstance = this;
  }

  open(cb?: (err?: Error | null) => void) {
    this.isOpen = true;
    cb?.(null);
  }

  write(data: number[] | Buffer, cb?: (err?: Error | null) => void) {
    const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
    this.written.push(buf);
    cb?.(null);
    this.onWrite?.(buf);
    return true;
  }

  close(cb?: (err?: Error | null) => void) {
    this.isOpen = false;
    cb?.(null);
  }
}

class MockHID extends EventEmitter {
  public static lastInstance: MockHID | null = null;
  public written: Buffer[] = [];
  public onWrite?: (buf: Buffer) => void;
  public closed = false;

  constructor(public path: string) {
    super();
    MockHID.lastInstance = this;
  }

  write(data: number[] | Buffer) {
    const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
    this.written.push(buf);
    this.onWrite?.(buf);
    return buf.length;
  }

  close() {
    this.closed = true;
  }
}

jest.mock("serialport", () => ({
  SerialPort: MockSerialPort,
}));

jest.mock("node-hid", () => ({
  HID: MockHID,
  devices: jest.fn(() => [{ vendorId: 0x28c2, productId: 0x0001, path: "/dev/mock-knx-usb", product: "Mock KNX USB" }]),
}));

import * as hid from "node-hid";
import { CEMI } from "../src/core/CEMI";
import { ControlField } from "../src/core/ControlField";
import { ExtendedControlField } from "../src/core/ControlFieldExtended";
import { APCIEnum } from "../src/core/enum/APCIEnum";
import { AddressType } from "../src/core/enum/EnumControlFieldExtended";
import { APDU } from "../src/core/layers/data/APDU";
import { NPDU } from "../src/core/layers/data/NPDU";
import { TPDU } from "../src/core/layers/data/TPDU";
import { APCI } from "../src/core/layers/interfaces/APCI";
import { TPCI, TPCIType } from "../src/core/layers/interfaces/TPCI";
import { KnxDataDecode } from "../src/core/data/KNXDataDecode";
import {
  KNX_USB_INTERFACES,
  KNX_USB_INTERFACES_VERSION,
  findKnxUsbInterface,
  getKnxUsbInterfaceDisplayName,
  getKnxUsbInterfaceManufacturerName,
  isKnownKnxUsbDevice,
} from "../src/core/resources/KNXUsbInterfaces";
import { TPUARTConnection } from "../src/connection/TPUART";
import { KNXUSBConnection } from "../src/connection/KNXUSBConnection";
import { CEMIAdapter } from "../src/utils/CEMIAdapter";
import { DataSecureCEMI, KnxDataSecure } from "../src/security/KnxDataSecure";

const GROUP_KEY = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const TOOL_KEY = Buffer.from("a0a1a2a3a4a5a6a7a8a9aaabacadaeaf", "hex");

/** Decodes a TP-UART UART service stream (U_L_DataStart/Continue/End + optional U_L_DataOffset) back into a raw TP1 LPDU. */
function decodeUartServicesToTp1(stream: Buffer): Buffer {
  const out: number[] = [];
  let pageOffset = 0;
  let i = 0;
  while (i < stream.length) {
    const cmd = stream[i++];
    if ((cmd & 0xf8) === 0x08) {
      pageOffset = (cmd & 0x07) << 6;
      continue;
    }
    const data = stream[i++];
    const idx = pageOffset + (cmd & 0x3f);
    out[idx] = data;
    if ((cmd & 0xc0) === 0x40) {
      break;
    }
  }
  return Buffer.from(out);
}

/** Validates TP1 odd-parity FCS check octet (NOT XOR of all preceding bytes). */
function hasValidTp1Fcs(frame: Buffer): boolean {
  if (frame.length < 8) return false;
  let xor = 0;
  for (let i = 0; i < frame.length - 1; i++) xor ^= frame[i];
  return frame[frame.length - 1] === (~xor & 0xff);
}

/** Builds a KNX USB Transfer Frame ([8-byte header][payload]) and splits it into 64-byte HID reports. */
function wrapCemiInUsbHidReports(payload: Buffer, protocolId = 0x01, emiId = 0x03): Buffer[] {
  const header = Buffer.alloc(8);
  header[0] = 0x00;
  header[1] = 0x08;
  header.writeUInt16BE(payload.length, 2);
  header[4] = protocolId;
  header[5] = emiId;
  header.writeUInt16BE(0x0000, 6);
  return KNXUSBConnection.buildHIDReports(Buffer.concat([header, payload]));
}

/** Reassembles 64-byte KNX USB HID reports back into the inner KNX USB Transfer Protocol payload. */
function extractUsbTransferPayload(reports: Buffer[]): { protocolId: number; emiId: number; payload: Buffer } {
  const chunks: Buffer[] = [];
  for (const r of reports) {
    expect(r.length).toBe(64);
    expect(r[0]).toBe(0x01);
    const len = r[2];
    chunks.push(r.subarray(3, 3 + len));
  }
  const transfer = Buffer.concat(chunks);
  const bodyLen = transfer.readUInt16BE(2);
  return {
    protocolId: transfer[4],
    emiId: transfer[5],
    payload: transfer.subarray(8, 8 + bodyLen),
  };
}

describe("KNX Data Secure over TP-UART and KNX USB", () => {
  describe("1. NPDU & CEMIAdapter TP1 / EMI Standard & Extended Frames", () => {
    test("NPDU.fromBuffer preserves full (LG + 1) TPDU bytes and AddressType (Individual vs Group)", () => {
      // Standard Individual frame: AT=0, HC=6, LG=1 -> DRL = 0x61, TPDU = [0x00, 0x81]
      const indBuf = Buffer.from([0x61, 0x00, 0x81, 0xaa]); // trailing 0xAA must be ignored
      const indNpdu = NPDU.fromBuffer(indBuf);
      expect(indNpdu.addressType).toBe(AddressType.INDIVIDUAL);
      expect(indNpdu.hopCount).toBe(6);
      expect(indNpdu.length).toBe(1);
      expect(indNpdu.TPDU.toBuffer()).toEqual(Buffer.from([0x00, 0x81]));

      // T_Connect (LG=0 -> TPDU is 1 byte [0x80])
      const connNpdu = NPDU.fromBuffer(Buffer.from([0x60, 0x80]));
      expect(connNpdu.addressType).toBe(AddressType.INDIVIDUAL);
      expect(connNpdu.TPDU.toBuffer()).toEqual(Buffer.from([0x80]));
      expect(connNpdu.toBuffer()).toEqual(Buffer.from([0x60, 0x80]));
    });

    test("CEMIAdapter.cemiToTp1 <-> tp1ToCemi round-trips Standard & Extended KNX Data Secure frames with valid FCS", () => {
      const senderSec = new KnxDataSecure({
        sourceAddress: "1.1.200",
        initialSequenceNumber: 50n,
        groupKeys: { "1/0/1": GROUP_KEY },
      });
      const receiverSec = new KnxDataSecure({
        sourceAddress: "1.1.1",
        groupKeys: { "1/0/1": GROUP_KEY },
      });

      // A) Standard Frame (FT=1) KNX Data Secure: DPT 1.001 (APDU = 14 <= 15)
      const shortPlain = new CEMI.DataLinkLayerCEMI["L_Data.req"](
        null,
        new ControlField(0xbc),
        new ExtendedControlField(0xe0),
        "1.1.200",
        "1/0/1",
        new TPDU(
          new TPCI(TPCIType.T_DATA_GROUP_PDU),
          new APDU(
            new TPCI(TPCIType.T_DATA_GROUP_PDU),
            new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit),
            Buffer.from([1]),
            true,
          ),
          Buffer.from([1]),
        ),
      );
      const shortWrapped = senderSec.wrapCemi(shortPlain);
      const shortTp1 = CEMIAdapter.cemiToTp1(shortWrapped)!;
      expect(shortTp1).not.toBeNull();
      expect(shortTp1[0] & 0x80).toBe(0x80); // FT=1 Standard Frame
      expect(hasValidTp1Fcs(shortTp1)).toBe(true);

      const shortBack = CEMIAdapter.tp1ToCemi(shortTp1, "L_Data.ind")!;
      const shortUnwrapped = receiverSec.unwrapCemi(shortBack);
      expect(shortUnwrapped.handled).toBe(true);
      expect(shortUnwrapped.plainCemi).not.toBeNull();
      expect(KnxDataDecode.decodeThis("1.001", (shortUnwrapped.plainCemi as any).TPDU.apdu.data)).toBe(true);

      // B) Extended Frame (FT=0) KNX Data Secure: 4-byte float (APDU = 18 > 15)
      const floatPayload = Buffer.from([0x41, 0xbc, 0x00, 0x00]); // 23.5f
      const extPlain = new CEMI.DataLinkLayerCEMI["L_Data.req"](
        null,
        new ControlField(0xbc),
        new ExtendedControlField(0xe0),
        "1.1.200",
        "1/0/1",
        new TPDU(
          new TPCI(TPCIType.T_DATA_GROUP_PDU),
          new APDU(
            new TPCI(TPCIType.T_DATA_GROUP_PDU),
            new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit),
            floatPayload,
            false,
          ),
          floatPayload,
        ),
      );
      const extWrapped = senderSec.wrapCemi(extPlain);
      const extTp1 = CEMIAdapter.cemiToTp1(extWrapped)!;
      expect(extTp1[0] & 0x80).toBe(0x00); // FT=0 Extended Frame
      expect(hasValidTp1Fcs(extTp1)).toBe(true);

      const extBack = CEMIAdapter.tp1ToCemi(extTp1, "L_Data.ind")!;
      const extUnwrapped = receiverSec.unwrapCemi(extBack);
      expect(extUnwrapped.handled).toBe(true);
      expect(extUnwrapped.plainCemi).not.toBeNull();
      expect((extUnwrapped.plainCemi as any).TPDU.apdu.data).toEqual(floatPayload);
    });
  });

  describe("2. TPUARTConnection KNX Data Secure TX/RX & Long Extended Frames", () => {
    async function createOnlineTpuart(dataSecure: KnxDataSecure) {
      const tpuart = new TPUARTConnection({
        path: "/dev/mock-tpuart",
        individualAddress: "1.1.200",
        dataSecure,
        logOptions: { enabled: false },
      });
      const port = MockSerialPort.lastInstance!;
      port.onWrite = (buf) => {
        if (buf.length === 1 && buf[0] === 0x01) {
          // RESET_REQ -> reply RESET_IND (0x03)
          setImmediate(() => port.emit("data", Buffer.from([0x03])));
        } else if (buf.length === 1 && buf[0] === 0x02) {
          // STATE_REQ -> reply STATE_IND (0x07)
          setImmediate(() => port.emit("data", Buffer.from([0x07])));
        } else if (buf.length >= 2 && (buf[0] & 0xc0) === 0x80) {
          // L_Data TX -> reply positive confirmation (0x8B)
          setImmediate(() => port.emit("data", Buffer.from([0x8b])));
        }
      };
      await tpuart.connect();
      return { tpuart, port };
    }

    test("encodes > 64-byte Extended TP1 frames with U_L_DataOffset (0x09)", () => {
      const fakeLongTp1 = Buffer.alloc(72, 0x55);
      fakeLongTp1[0] = 0x3c;
      const uartStream = TPUARTConnection.encodeUartServices(fakeLongTp1);
      // 64 bytes * 2 + 1 offset byte (0x09) + 8 bytes * 2 = 145 bytes
      expect(uartStream.length).toBe(145);
      expect(uartStream[128]).toBe(0x09); // U_L_DataOffset page 1
      expect(uartStream[129]).toBe(0x80); // index 64 & 0x3f = 0 -> U_L_DataContinue(0)
      expect(uartStream[143]).toBe(0x47); // last index 71 & 0x3f = 7 -> U_L_DataEnd(7)
      expect(decodeUartServicesToTp1(uartStream)).toEqual(fakeLongTp1);
    });

    test("encrypts outgoing Group writes into valid Extended TP1 LPDUs and decrypts incoming TP1 Data Secure frames", async () => {
      const clientSec = new KnxDataSecure({
        sourceAddress: "1.1.200",
        initialSequenceNumber: 100n,
        groupKeys: { "1/0/1": GROUP_KEY },
        deviceToolKeys: { "1.1.1": TOOL_KEY },
      });
      const deviceSec = new KnxDataSecure({
        sourceAddress: "1.1.1",
        initialSequenceNumber: 500n,
        groupKeys: { "1/0/1": GROUP_KEY },
        ownToolKey: TOOL_KEY,
      });

      const { tpuart, port } = await createOnlineTpuart(clientSec);

      // Verify U_SetAddress (0x28, 0x11, 0xC8) was sent on init
      expect(port.written.some((b) => b.equals(Buffer.from([0x28, 0x11, 0xc8])))).toBe(true);

      // 1. Outgoing Extended Frame Group write (DPT 14.056 -> 4-byte float -> Extended Frame FT=0)
      port.written = [];
      await tpuart.write("1/0/1", "14.056", 42.5);

      const txUart = port.written.find((b) => b.length > 10 && b[0] === 0x80)!;
      expect(txUart).toBeDefined();
      const txTp1 = decodeUartServicesToTp1(txUart);
      expect(hasValidTp1Fcs(txTp1)).toBe(true);
      expect(txTp1[0] & 0x80).toBe(0x00); // Extended Frame FT=0

      const parsedOnBus = CEMIAdapter.tp1ToCemi(txTp1, "L_Data.ind")!;
      const decryptedAtDevice = deviceSec.unwrapCemi(parsedOnBus);
      expect(decryptedAtDevice.handled).toBe(true);
      expect(decryptedAtDevice.plainCemi).not.toBeNull();
      expect(KnxDataDecode.decodeThis("14.056", (decryptedAtDevice.plainCemi as any).TPDU.apdu.data)).toBeCloseTo(
        42.5,
        2,
      );

      // 2. Echo cancellation: feeding back our own sent frame (even with repeat bit cleared) must NOT emit indication
      const indications: DataSecureCEMI[] = [];
      tpuart.on("indication", (c: DataSecureCEMI) => indications.push(c));

      const repeatedEcho = Buffer.from(txTp1);
      repeatedEcho[0] &= ~0x20;
      repeatedEcho[repeatedEcho.length - 1] ^= 0x20;
      port.emit("data", repeatedEcho);
      expect(indications).toHaveLength(0);

      // 3. Incoming Extended TP1 Data Secure Group frame from 1.1.1 -> 1/0/1
      const devReplyPlain = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
        null,
        new ControlField(0xbc),
        new ExtendedControlField(0xe0),
        "1.1.1",
        "1/0/1",
        new TPDU(
          new TPCI(TPCIType.T_DATA_GROUP_PDU),
          new APDU(
            new TPCI(TPCIType.T_DATA_GROUP_PDU),
            new APCI(APCIEnum.A_GroupValue_Response_Protocol_Data_Unit),
            Buffer.from([0x42, 0x2a, 0x00, 0x00]), // 42.5f
            false,
          ),
          Buffer.from([0x42, 0x2a, 0x00, 0x00]),
        ),
      );
      const devReplySecure = deviceSec.wrapCemi(devReplyPlain);
      const devReplyTp1 = CEMIAdapter.cemiToTp1(devReplySecure)!;
      port.emit("data", devReplyTp1);

      expect(indications).toHaveLength(1);
      expect(indications[0].dataSecure?.authenticated).toBe(true);
      expect(indications[0].dataSecure?.sequenceNumber).toBe(500n);
      expect(KnxDataDecode.decodeThis("14.056", (indications[0] as any).TPDU.apdu.data)).toBeCloseTo(42.5, 2);

      // 4. Incoming Individual ToolKey frame (1.1.1 -> 1.1.200) triggers real-time hardware ACK (0x11) at byte 6
      port.written = [];
      const toolPlain = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
        null,
        new ControlField(0xbc),
        new ExtendedControlField(0x60), // Individual, HC=6
        "1.1.1",
        "1.1.200",
        new TPDU(
          new TPCI(TPCIType.T_DATA_INDIVIDUAL_PDU),
          new APDU(
            new TPCI(TPCIType.T_DATA_INDIVIDUAL_PDU),
            new APCI(APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit),
            Buffer.from([0x07, 0xb0]),
            false,
          ),
          Buffer.from([0x07, 0xb0]),
        ),
      );
      const toolSecure = deviceSec.wrapCemi(toolPlain, { toolAccess: true, key: TOOL_KEY });
      const toolTp1 = CEMIAdapter.cemiToTp1(toolSecure)!;
      port.emit("data", toolTp1);

      expect(port.written.some((b) => b.length === 1 && b[0] === 0x11)).toBe(true);
      expect(indications).toHaveLength(2);
      expect(indications[1].dataSecure?.toolAccess).toBe(true);
      expect((indications[1] as any).sourceAddress).toBe("1.1.1");
      expect((indications[1] as any).destinationAddress).toBe("1.1.200");

      // 5. Incoming System Broadcast (SB=0, Ctrl1=0x2C) Extended frame is accepted by Receiver
      const sbcPlain = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
        null,
        new ControlField(0x2c), // FT=0, R=1, SB=0 (System Broadcast), Low priority
        new ExtendedControlField(0xe0),
        "1.1.1",
        "0/0/0",
        new TPDU(
          new TPCI(TPCIType.T_DATA_BROADCAST_PDU),
          new APDU(
            new TPCI(TPCIType.T_DATA_BROADCAST_PDU),
            new APCI(APCIEnum.A_DomainAddress_Response_Protocol_Data_Unit),
            Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]),
            false,
          ),
          Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]),
        ),
      );
      const sbcSecure = deviceSec.wrapCemi(sbcPlain, { toolAccess: true, key: TOOL_KEY, systemBroadcast: true });
      const sbcTp1 = CEMIAdapter.cemiToTp1(sbcSecure)!;
      expect(sbcTp1[0]).toBe(0x2c); // SB=0 preserved
      port.emit("data", sbcTp1);

      expect(indications).toHaveLength(3);
      expect(indications[2].dataSecure?.systemBroadcast).toBe(true);

      await tpuart.disconnect();
      expect(tpuart.connectionState).toBe("DISCONNECTED");
    });
  });

  describe("3. KNXUSBConnection cEMI Priority, Hardware IA Discovery & Multi-Frame HID Data Secure", () => {
    function setupMockUsbHandshake(
      hidDev: MockHID,
      emiBitmask: number,
      hwSubnet = 0x11,
      hwDevice = 0xc8,
      options: { rejectPropWriteError?: number } = {},
    ) {
      let curSubnet = hwSubnet;
      let curDevice = hwDevice;

      hidDev.onWrite = (report) => {
        if (report[0] !== 0x01) return;
        const len = report[2];
        const body = report.subarray(3, 3 + len);
        if (body.length < 8) return;
        const protocolId = body[4];
        const emiId = body[5];
        const payload = body.subarray(8);

        // Device Feature Get: Supported EMI type (0x0F / 0x01 / [0x01])
        if (protocolId === 0x0f && emiId === 0x01 && payload[0] === 0x01) {
          const resp = wrapCemiInUsbHidReports(Buffer.from([0x01, 0x00, emiBitmask]), 0x0f, 0x02);
          setImmediate(() => resp.forEach((r) => hidDev.emit("data", r)));
        }

        // cEMI M_PropRead.req (0xFC) for Device Object (0x0000), instance 1, PID 57 (subnet) or 58 (device)
        if (protocolId === 0x01 && emiId === 0x03 && payload[0] === 0xfc && payload.length >= 7) {
          const objType = payload.readUInt16BE(1);
          const objInst = payload[3];
          const propId = payload[4];
          if (objType === 0x0000 && objInst === 0x01 && (propId === 57 || propId === 58)) {
            const val = propId === 57 ? curSubnet : curDevice;
            const con = Buffer.from([0xfb, 0x00, 0x00, 0x01, propId, 0x10, 0x01, val]);
            const resp = wrapCemiInUsbHidReports(con, 0x01, 0x03);
            setImmediate(() => resp.forEach((r) => hidDev.emit("data", r)));
          }
        }

        // cEMI M_PropWrite.req (0xF6) for Device Object (0x0000), instance 1, PID 57 (subnet) or 58 (device)
        if (protocolId === 0x01 && emiId === 0x03 && payload[0] === 0xf6 && payload.length >= 8) {
          const objType = payload.readUInt16BE(1);
          const objInst = payload[3];
          const propId = payload[4];
          if (objType === 0x0000 && objInst === 0x01 && (propId === 57 || propId === 58)) {
            let con: Buffer;
            if (options.rejectPropWriteError !== undefined) {
              con = Buffer.from([0xf5, 0x00, 0x00, 0x01, propId, 0x00, 0x01, options.rejectPropWriteError]);
            } else {
              if (propId === 57) curSubnet = payload[7];
              if (propId === 58) curDevice = payload[7];
              con = Buffer.from([0xf5, 0x00, 0x00, 0x01, propId, 0x10, 0x01]);
            }
            const resp = wrapCemiInUsbHidReports(con, 0x01, 0x03);
            setImmediate(() => resp.forEach((r) => hidDev.emit("data", r)));
          }
        }
      };
    }

    test("buildHIDReports fragments frames > 61 bytes per KNX 09_03 §3.4.1.2.2–§3.4.2.1", () => {
      const payload = Buffer.alloc(160, 0xab);
      const reports = wrapCemiInUsbHidReports(payload);
      // 8B header + 160B payload = 168B -> ceil(168 / 61) = 3 HID reports (61 + 61 + 46)
      expect(reports).toHaveLength(3);
      expect(reports[0][1]).toBe(0x15); // seq=1, start+partial
      expect(reports[0][2]).toBe(61);
      expect(reports[1][1]).toBe(0x24); // seq=2, partial
      expect(reports[1][2]).toBe(61);
      expect(reports[2][1]).toBe(0x36); // seq=3, partial+end
      expect(reports[2][2]).toBe(46);

      const extracted = extractUsbTransferPayload(reports);
      expect(extracted.payload).toEqual(payload);
    });

    test("prefers cEMI over EMI2/EMI1, discovers hardware IA, and handles multi-frame HID KNX Data Secure TX & RX", async () => {
      const clientSec = new KnxDataSecure({
        initialSequenceNumber: 200n,
        groupKeys: { "1/0/1": GROUP_KEY },
      });
      const deviceSec = new KnxDataSecure({
        sourceAddress: "1.1.1",
        initialSequenceNumber: 800n,
        groupKeys: { "1/0/1": GROUP_KEY },
      });

      const usb = new KNXUSBConnection({
        dataSecure: clientSec,
        logOptions: { enabled: false },
      });

      // Attach mock handshake right as HID device opens
      const connectPromise = usb.connect();
      const hidDev = MockHID.lastInstance!;
      // Bitmask 0x07 = supports EMI1 + EMI2 + cEMI -> MUST pick cEMI (0x03)!
      setupMockUsbHandshake(hidDev, 0x07, 0x11, 0xc8); // 1.1.200
      // Re-trigger initial discovery packet response since first attempt fired synchronously during connect()
      const firstInitResp = wrapCemiInUsbHidReports(Buffer.from([0x01, 0x00, 0x07]), 0x0f, 0x02);
      firstInitResp.forEach((r) => hidDev.emit("data", r));

      await connectPromise;

      expect(usb.activeEmiType).toBe(0x03); // cEMI selected instead of EMI2!
      expect(usb.hardwareIndividualAddress).toBe("1.1.200");
      expect(usb.individualAddress).toBe("1.1.200");

      // 1. TX a long KNX Data Secure Extended Frame (> 53B cEMI -> 2 HID packets!)
      const longPayload = Buffer.alloc(60, 0x33); // 60B payload + 13B S-A_Data overhead + 11B cEMI header = 84B cEMI!
      const longPlainCemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
        null,
        new ControlField(0xbc),
        new ExtendedControlField(0xe0),
        "1.1.200",
        "1/0/1",
        new TPDU(
          new TPCI(TPCIType.T_DATA_GROUP_PDU),
          new APDU(
            new TPCI(TPCIType.T_DATA_GROUP_PDU),
            new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit),
            longPayload,
            false,
          ),
          longPayload,
        ),
      );

      hidDev.written = [];
      await usb.send(longPlainCemi);

      expect(hidDev.written).toHaveLength(2);
      expect(hidDev.written[0][1]).toBe(0x15); // seq=1, start+partial
      expect(hidDev.written[1][1]).toBe(0x26); // seq=2, partial+end

      const { payload: wireCemiBuf } = extractUsbTransferPayload(hidDev.written);
      const wireCemi = CEMI.fromBuffer(wireCemiBuf);
      // Simulate reception at peer device (convert L_Data.req to L_Data.ind)
      const wireIndBuf = Buffer.from(wireCemiBuf);
      wireIndBuf[0] = 0x29;
      const decryptedAtDevice = deviceSec.unwrapCemi(CEMI.fromBuffer(wireIndBuf));
      expect(decryptedAtDevice.handled).toBe(true);
      expect(decryptedAtDevice.plainCemi).not.toBeNull();
      expect((decryptedAtDevice.plainCemi as any).TPDU.apdu.data).toEqual(longPayload);
      expect((wireCemi as any).controlField1.frameType).toBe(false); // Extended Frame FT=0

      // 2. RX a 3-packet multi-frame HID transfer carrying an encrypted 130-byte KNX Data Secure L_Data.ind
      const rxIndications: DataSecureCEMI[] = [];
      usb.on("indication", (c: DataSecureCEMI) => rxIndications.push(c));

      const rxLargeData = Buffer.alloc(120, 0x7a);
      const devLargePlain = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
        null,
        new ControlField(0xbc),
        new ExtendedControlField(0xe0),
        "1.1.1",
        "1/0/1",
        new TPDU(
          new TPCI(TPCIType.T_DATA_GROUP_PDU),
          new APDU(
            new TPCI(TPCIType.T_DATA_GROUP_PDU),
            new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit),
            rxLargeData,
            false,
          ),
          rxLargeData,
        ),
      );
      const devLargeSecure = deviceSec.wrapCemi(devLargePlain);
      const rxReports = wrapCemiInUsbHidReports(devLargeSecure.toBuffer(), 0x01, 0x03);
      expect(rxReports.length).toBe(3);
      expect(rxReports[0][1]).toBe(0x15);
      expect(rxReports[1][1]).toBe(0x24);
      expect(rxReports[2][1]).toBe(0x36);

      for (const r of rxReports) {
        hidDev.emit("data", r);
      }

      expect(rxIndications).toHaveLength(1);
      expect(rxIndications[0].dataSecure?.authenticated).toBe(true);
      expect(rxIndications[0].dataSecure?.sequenceNumber).toBe(800n);
      expect((rxIndications[0] as any).TPDU.apdu.data).toEqual(rxLargeData);

      usb.disconnect();
    });

    test("throws a clear error when attempting to send an Extended Frame on an EMI2-only USB interface", async () => {
      const clientSec = new KnxDataSecure({
        sourceAddress: "1.1.200",
        initialSequenceNumber: 1n,
        groupKeys: { "1/0/1": GROUP_KEY },
      });

      const usb = new KNXUSBConnection({
        individualAddress: "1.1.200",
        dataSecure: clientSec,
        logOptions: { enabled: false },
      });

      const connectPromise = usb.connect();
      const hidDev = MockHID.lastInstance!;
      // Bitmask 0x02 = EMI2 only (no cEMI)
      const emi2Resp = wrapCemiInUsbHidReports(Buffer.from([0x01, 0x00, 0x02]), 0x0f, 0x02);
      emi2Resp.forEach((r) => hidDev.emit("data", r));
      await connectPromise;

      expect(usb.activeEmiType).toBe(0x02);
      await expect(usb.write("1/0/1", "14.056", 12.34)).rejects.toThrow(/Extended Frames/);

      usb.disconnect();
    });

    test("setHardwareIndividualAddress & programHardwareAddress update USB IA via M_PropWrite.req (PID 57 & 58)", async () => {
      const clientSec = new KnxDataSecure({
        sourceAddress: "1.1.250",
        groupKeys: { "1/0/1": GROUP_KEY },
      });

      // A) Automatic programming on connect via programHardwareAddress: true (1.1.250 -> 1.1.200)
      const usb = new KNXUSBConnection({
        individualAddress: "1.1.200",
        programHardwareAddress: true,
        dataSecure: clientSec,
        logOptions: { enabled: false },
      });

      const connectPromise = usb.connect();
      const hidDev = MockHID.lastInstance!;
      setupMockUsbHandshake(hidDev, 0x04, 0x11, 0xfa); // starts at 1.1.250
      wrapCemiInUsbHidReports(Buffer.from([0x01, 0x00, 0x04]), 0x0f, 0x02).forEach((r) => hidDev.emit("data", r));
      await connectPromise;

      expect(usb.hardwareIndividualAddress).toBe("1.1.200");
      expect(usb.individualAddress).toBe("1.1.200");
      expect(clientSec.sourceAddress).toBe("1.1.200");

      // B) Explicit setHardwareIndividualAddress("1.2.15") at runtime
      const updated = await usb.setHardwareIndividualAddress("1.2.15");
      expect(updated).toBe("1.2.15");
      expect(usb.hardwareIndividualAddress).toBe("1.2.15");
      expect(usb.individualAddress).toBe("1.2.15");
      expect(clientSec.sourceAddress).toBe("1.2.15");
      usb.disconnect();

      // C) Rejects cleanly with AN203 0x0B Access Denied when Security Mode is enabled on the USB stick
      const lockedUsb = new KNXUSBConnection({
        individualAddress: "1.1.250",
        logOptions: { enabled: false },
      });
      const lockedConnect = lockedUsb.connect();
      const lockedHid = MockHID.lastInstance!;
      setupMockUsbHandshake(lockedHid, 0x04, 0x11, 0xfa, { rejectPropWriteError: 0x0b });
      wrapCemiInUsbHidReports(Buffer.from([0x01, 0x00, 0x04]), 0x0f, 0x02).forEach((r) => lockedHid.emit("data", r));
      await lockedConnect;

      await expect(lockedUsb.setHardwareIndividualAddress("1.1.200")).rejects.toThrow(/0x0b.*Access denied/i);
      lockedUsb.disconnect();
    });

    test("ETS6 KNX_USB_INTERFACES catalog, KNXUSBConnection.discover(), strict VID/PID selection & false-positive prevention", async () => {
      expect(KNX_USB_INTERFACES_VERSION).toBe(68);
      expect(KNX_USB_INTERFACES.length).toBe(78);

      // Verify exact catalog lookups, flags, timing & localized display names
      const zennio = findKnxUsbInterface(0x28c2, 0x0002)!;
      expect(zennio).toBeDefined();
      expect(zennio.defaultDisplayText).toBe("Zennio KNX USB Interface");
      expect(getKnxUsbInterfaceManufacturerName(zennio)).toMatch(/Zennio/i);

      const oci700 = findKnxUsbInterface(0x0681, 0x0014)!;
      expect(oci700.persistsIndividualAddress).toBe(false);
      expect(getKnxUsbInterfaceDisplayName(oci700, "de-DE")).toBe("Siemens Schnittstelle OCI700 USB");

      const weinzierlTp = findKnxUsbInterface(0x0e77, 0x0104)!;
      expect(weinzierlTp.requiresKnxUsbFix).toBe(true);
      expect(getKnxUsbInterfaceDisplayName(weinzierlTp, "es")).toBe("KNX-USB Interfaz (TP)");

      const siemensUp = findKnxUsbInterface(0x0e77, 0x0111)!;
      expect(siemensUp.timing).toEqual([1000, 100]);

      // Prevent false positives on shared non-KNX USB Vendor IDs (FTDI 0x0403, MCS 0x16D0)
      expect(isKnownKnxUsbDevice({ vendorId: 0x0403, productId: 0x6001, product: "FT232R USB UART" })).toBe(false);
      expect(isKnownKnxUsbDevice({ vendorId: 0x16d0, productId: 0x9999, product: "Generic OpenHW Board" })).toBe(false);
      expect(isKnownKnxUsbDevice({ vendorId: 0x0403, productId: 0x6898 })).toBe(true);
      expect(isKnownKnxUsbDevice({ vendorId: 0x16d0, productId: 0x0491 })).toBe(true); // MDT KNX_USB_Interface
      expect(isKnownKnxUsbDevice({ vendorId: 0x16de, productId: 0x008e })).toBe(true); // Schneider SpaceLogic

      // Test KNXUSBConnection.discover() and strict vendorId/productId filtering with multiple attached HID devices
      const mockedDevices = hid.devices as jest.Mock;
      const origImpl = mockedDevices.getMockImplementation();
      try {
        mockedDevices.mockReturnValue([
          { vendorId: 0x0403, productId: 0x6001, path: "/dev/ftdi-serial", product: "FT232R USB UART" },
          { vendorId: 0x16d0, productId: 0x0491, path: "/dev/knx-mdt", product: "MDT USB" },
          { vendorId: 0x28c2, productId: 0x0002, path: "/dev/knx-zennio", product: "Zennio USB" },
          { vendorId: 0x135e, productId: 0x0323, path: "/dev/knx-jung", product: "Jung USB" },
        ]);

        const discovered = KNXUSBConnection.discover({ language: "es-ES" });
        expect(discovered.map((d) => d.path)).toEqual(["/dev/knx-mdt", "/dev/knx-zennio", "/dev/knx-jung"]);
        expect(discovered[0].displayName).toBe("MDT KNX_USB_Interface");
        expect(discovered[1].vendorIdHex).toBe("28C2");
        expect(discovered[1].productIdHex).toBe("0002");
        expect(discovered[1].knxManufacturerName).toMatch(/Zennio/i);
        expect(discovered[2].displayName).toBe("Módulo comunicación USB");

        // Explicitly request Zennio (28C2:0002) even though MDT appears first -> must open /dev/knx-zennio!
        const usb = new KNXUSBConnection({
          vendorId: 0x28c2,
          productId: 0x0002,
          logOptions: { enabled: false },
        });
        const connPromise = usb.connect();
        const hidDev = MockHID.lastInstance!;
        expect(hidDev.path).toBe("/dev/knx-zennio");
        setupMockUsbHandshake(hidDev, 0x04, 0x11, 0xc8);
        wrapCemiInUsbHidReports(Buffer.from([0x01, 0x00, 0x04]), 0x0f, 0x02).forEach((r) => hidDev.emit("data", r));
        await connPromise;

        expect(usb.interfaceInfo?.displayName).toBe("Zennio KNX USB Interface");
        expect(usb.interfaceInfo?.matchedCatalog).toBe(true);
        expect(usb.interfaceInfo?.persistsIndividualAddress).toBe(true);
        usb.disconnect();
      } finally {
        if (origImpl) mockedDevices.mockImplementation(origImpl);
        else
          mockedDevices.mockReturnValue([
            { vendorId: 0x28c2, productId: 0x0001, path: "/dev/mock-knx-usb", product: "Mock KNX USB" },
          ]);
      }
    });
  });
});
