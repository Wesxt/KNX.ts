import { CEMI, CEMIInstance } from "../core/CEMI";
import { ControlField } from "../core/ControlField";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { KNXHelper } from "./KNXHelper";
import { AddressType } from "../core/enum/EnumControlFieldExtended";
import { MessageCodeTranslator } from "./MessageCodeTranslator";
import { EMI, EMIInstance } from "../core/EMI";
import { NPDU } from "../core/layers/data/NPDU";
import { TPDU } from "../core/layers/data/TPDU";

/**
 * Adapter utility to convert between EMI (External Message Interface) and cEMI (Common External Message Interface).
 * EMI is typically used by physical interfaces like TPUART, while cEMI is standard for KNXnet/IP.
 */
export class CEMIAdapter {
  /**
   * Adapts a raw EMI1 or EMI2 message (Buffer) to a cEMI instance.
   * Standard frame structure: [MC] [Ctrl(FT=1)] [Src(2)] [Dst(2)] [AT|HC|LG] [TPDU(LG+1)...]
   * Extended frame structure: [MC] [Ctrl(FT=0)] [CtrlE] [Src(2)] [Dst(2)] [LG] [TPDU(LG+1)...]
   */
  static emiToCemi(emiBuffer: Buffer, emiType: "EMI1" | "EMI2/IMI2" = "EMI2/IMI2"): CEMIInstance | null {
    if (emiBuffer.length < 8) throw new Error("EMI buffer too short");

    const messageCode = emiBuffer.readUInt8(0);
    const ctrlByte = emiBuffer.readUInt8(1);
    const isExtended = (ctrlByte & 0x80) === 0;

    // Translate Message Code (e.g. EMI1 0x49 -> cEMI 0x29, EMI2 0x11 -> cEMI 0x11)
    const cemiCode = MessageCodeTranslator.translate(messageCode, emiType, "CEMI");
    const serviceName = MessageCodeTranslator.getServiceName(messageCode, emiType);
    if (cemiCode === null || !serviceName || !MessageCodeTranslator.isDataLinkLayerMessage(serviceName)) return null;

    if (isExtended) {
      if (emiBuffer.length < 9) throw new Error("Extended EMI buffer too short");
      const controlField1 = new ControlField(ctrlByte);
      const controlField2 = new ExtendedControlField(emiBuffer.readUInt8(2));
      const srcAddr = KNXHelper.GetAddress(emiBuffer.subarray(3, 5), ".") as string;
      const dstAddr = KNXHelper.GetAddress(
        emiBuffer.subarray(5, 7),
        controlField2.addressType === AddressType.GROUP ? "/" : ".",
      ) as string;
      const length = emiBuffer.readUInt8(7);
      const tpduEnd = Math.min(8 + length + 1, emiBuffer.length);
      const tpdu = TPDU.fromBuffer(emiBuffer.subarray(8, tpduEnd));
      return new CEMI.DataLinkLayerCEMI[serviceName as "L_Data.ind" | "L_Data.con" | "L_Data.req"](
        null,
        controlField1,
        controlField2,
        srcAddr,
        dstAddr,
        tpdu,
      );
    }

    // Addresses (2 bytes each)
    const srcAddr = KNXHelper.GetAddress(emiBuffer.subarray(2, 4), ".") as string;

    // --- Control Fields Transformation ---
    // 1. cEMI Control Field 1 is identical to EMI Control
    const controlField1 = new ControlField(ctrlByte);

    // 2. cEMI Control Field 2 (Extended) is extracted from EMI NPCI/DRL byte
    // DRL: [AT] [Hop2] [Hop1] [Hop0] [LG3] [LG2] [LG1] [LG0]
    const controlField2 = new ExtendedControlField();

    // --- NPDU Extraction ---
    const npduBuff = emiBuffer.subarray(6);
    const npdu = NPDU.fromBuffer(npduBuff);
    controlField2.hopCount = npdu.hopCount;
    controlField2.addressType = npdu.addressType;
    const dstAddr = KNXHelper.GetAddress(emiBuffer.subarray(4, 6), npdu.addressType === AddressType.GROUP ? "/" : ".");

    return new CEMI.DataLinkLayerCEMI[serviceName as "L_Data.ind" | "L_Data.con" | "L_Data.req"](
      null,
      controlField1,
      controlField2,
      srcAddr,
      dstAddr,
      npdu.TPDU,
    );
  }

  /**
   * Converts a cEMI instance to an EMI1 or EMI2 ServiceMessage (Standard Frames only, APDU <= 15 octets).
   * Returns `null` for non-L_Data services or Extended Frames (`APDU > 15`) that EMI1/EMI2 cannot represent.
   */
  static cemiToEmi(cemi: CEMIInstance, emiType: "EMI1" | "EMI2/IMI2" = "EMI2/IMI2"): EMIInstance | null {
    if (!("TPDU" in cemi) || !("controlField1" in cemi) || !("controlField2" in cemi)) {
      return null;
    }

    const tpduBuffer = cemi.TPDU.toBuffer();
    const apduLength = Math.max(0, tpduBuffer.length - 1);
    if (apduLength > 15 || !cemi.controlField1.frameType) {
      return null;
    }

    // In EMI1/EMI2, DRL = (AddressType << 7) | (HopCount << 4) | (APDU Length LG)
    const addressBit = cemi.controlField2.addressType === AddressType.GROUP ? 0x80 : 0x00;
    const npciByte = addressBit | ((cemi.controlField2.hopCount & 0x07) << 4) | (apduLength & 0x0f);

    const emiCode = MessageCodeTranslator.translate(cemi.messageCode, "CEMI", emiType);
    if (emiCode === null) return null;

    // Buffer [MC] [Ctrl] [Src] [Dst] [DRL] [TPDU]
    const buffer = Buffer.alloc(7 + tpduBuffer.length);
    let offset = 0;

    buffer.writeUInt8(emiCode, offset++);
    cemi.controlField1.buffer.copy(buffer, offset++);

    KNXHelper.GetAddress(cemi.sourceAddress, ".").copy(buffer, offset);
    offset += 2;

    KNXHelper.GetAddress(
      cemi.destinationAddress,
      cemi.controlField2.addressType === AddressType.GROUP ? "/" : ".",
    ).copy(buffer, offset);
    offset += 2;

    buffer.writeUInt8(npciByte, offset++);
    tpduBuffer.copy(buffer, offset);

    return EMI.fromBuffer(buffer);
  }

  /**
   * Converts a cEMI `L_Data.*` instance into a raw KNX TP1 LPDU Buffer (with trailing odd-parity FCS checksum)
   * suitable for direct transmission via TP-UART / TP-UART2 / NCN5120 (`03_02_02` §2.2.4 & §2.2.5).
   *
   * - Uses **L_Data_Standard** (`FT = 1`) when `controlField1.frameType === true`, `LG <= 15`, and `EFF === 0`.
   * - Uses **L_Data_Extended** (`FT = 0`) when `!controlField1.frameType`, `LG > 15` (required for KNX Data Secure),
   *   or `EFF !== 0`.
   */
  static cemiToTp1(cemi: CEMIInstance): Buffer | null {
    if (!("TPDU" in cemi) || !("controlField1" in cemi) || !("controlField2" in cemi)) {
      return null;
    }

    const tpduBuffer = cemi.TPDU.toBuffer();
    if (tpduBuffer.length < 1) {
      throw new Error("TPDU buffer cannot be empty");
    }
    const apduLength = tpduBuffer.length - 1;
    if (apduLength > 254) {
      throw new Error(`TP1 Extended Frame APDU length ${apduLength} exceeds maximum 254 octets (03_02_02 §2.2.5.4)`);
    }

    const cf1Raw = cemi.controlField1.buffer[0];
    const cf2Byte = cemi.controlField2.toNumber();
    const isExtended = !cemi.controlField1.frameType || apduLength > 15 || cemi.controlField2.eff !== 0;

    const srcBuf = KNXHelper.GetAddress_(cemi.sourceAddress);
    const dstBuf = KNXHelper.GetAddress_(cemi.destinationAddress);

    let lpduWithoutFcs: Buffer;
    if (isExtended) {
      // Extended Frame (03_02_02 §2.2.5): [CTRL(FT=0)] [CTRLE] [SA(2)] [DA(2)] [LG] [TPDU(LG+1)] [FCS]
      // Mask CTRL to clear FT (bit 7), reserved bit 6, and cEMI-only bits 1..0
      const ctrl1 = cf1Raw & 0x3c;
      lpduWithoutFcs = Buffer.alloc(7 + tpduBuffer.length);
      lpduWithoutFcs[0] = ctrl1;
      lpduWithoutFcs[1] = cf2Byte;
      srcBuf.copy(lpduWithoutFcs, 2);
      dstBuf.copy(lpduWithoutFcs, 4);
      lpduWithoutFcs[6] = apduLength;
      tpduBuffer.copy(lpduWithoutFcs, 7);
    } else {
      // Standard Frame (03_02_02 §2.2.4): [CTRL(FT=1)] [SA(2)] [DA(2)] [AT|HC|LG] [TPDU(LG+1)] [FCS]
      const ctrl1 = (cf1Raw & 0x3c) | 0x80;
      const drl = (cf2Byte & 0xf0) | (apduLength & 0x0f);
      lpduWithoutFcs = Buffer.alloc(6 + tpduBuffer.length);
      lpduWithoutFcs[0] = ctrl1;
      srcBuf.copy(lpduWithoutFcs, 1);
      dstBuf.copy(lpduWithoutFcs, 3);
      lpduWithoutFcs[5] = drl;
      tpduBuffer.copy(lpduWithoutFcs, 6);
    }

    // Odd-parity TP1 Check Octet (FCS = NOT XOR of all preceding octets, 03_02_02 §2.2.4.6)
    let xor = 0;
    for (let i = 0; i < lpduWithoutFcs.length; i++) {
      xor ^= lpduWithoutFcs[i];
    }
    const fcs = ~xor & 0xff;
    return Buffer.concat([lpduWithoutFcs, Buffer.from([fcs])]);
  }

  /**
   * Converts a raw KNX TP1 LPDU Buffer (Standard `FT = 1` or Extended `FT = 0`, with trailing FCS checksum)
   * received from a TP-UART interface into a cEMI `L_Data.ind` (or specified service) instance.
   */
  static tp1ToCemi(
    tp1Frame: Buffer,
    serviceName: "L_Data.ind" | "L_Data.con" | "L_Data.req" = "L_Data.ind",
  ): CEMIInstance | null {
    if (tp1Frame.length < 8) return null;

    const ctrlByte = tp1Frame[0];
    const isExtended = (ctrlByte & 0x80) === 0;
    const controlField1 = new ControlField(ctrlByte);

    if (isExtended) {
      if (tp1Frame.length < 9) return null;
      const controlField2 = new ExtendedControlField(tp1Frame[1]);
      const srcAddr = KNXHelper.GetAddress(tp1Frame.subarray(2, 4), ".") as string;
      const dstAddr = KNXHelper.GetAddress(
        tp1Frame.subarray(4, 6),
        controlField2.addressType === AddressType.GROUP ? "/" : ".",
      ) as string;
      const length = tp1Frame[6];
      const expectedTotal = length + 9; // 7 header + (length + 1) TPDU + 1 FCS
      if (tp1Frame.length < expectedTotal) return null;
      const tpdu = TPDU.fromBuffer(tp1Frame.subarray(7, 7 + length + 1));
      return new CEMI.DataLinkLayerCEMI[serviceName](null, controlField1, controlField2, srcAddr, dstAddr, tpdu);
    }

    const srcAddr = KNXHelper.GetAddress(tp1Frame.subarray(1, 3), ".") as string;
    const drl = tp1Frame[5];
    const addressType = ((drl >> 7) & 0x01) as AddressType;
    const hopCount = (drl >> 4) & 0x07;
    const length = drl & 0x0f;
    const expectedTotal = length + 8; // 6 header + (length + 1) TPDU + 1 FCS
    if (tp1Frame.length < expectedTotal) return null;

    const controlField2 = new ExtendedControlField();
    controlField2.addressType = addressType;
    controlField2.hopCount = hopCount;

    const dstAddr = KNXHelper.GetAddress(
      tp1Frame.subarray(3, 5),
      addressType === AddressType.GROUP ? "/" : ".",
    ) as string;
    const tpdu = TPDU.fromBuffer(tp1Frame.subarray(6, 6 + length + 1));
    return new CEMI.DataLinkLayerCEMI[serviceName](null, controlField1, controlField2, srcAddr, dstAddr, tpdu);
  }
}
