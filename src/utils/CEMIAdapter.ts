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
   * Adapts a raw EMI2 message (Buffer) to a cEMI instance.
   * Standard frame structure: [MC] [Ctrl(FT=1)] [Src(2)] [Dst(2)] [NPCI] [TPDU...]
   * Extended frame structure: [MC] [Ctrl(FT=0)] [CtrlE] [Src(2)] [Dst(2)] [Len] [TPDU(Len+1)...]
   */
  static emiToCemi(emiBuffer: Buffer): CEMIInstance | null {
    if (emiBuffer.length < 7) throw new Error("EMI buffer too short");

    const messageCode = emiBuffer.readUInt8(0);
    const ctrlByte = emiBuffer.readUInt8(1);
    const isExtended = (ctrlByte & 0x80) === 0;

    // Translate Message Code (EMI 0x11 -> cEMI 0x11, etc.)
    const cemiCode = MessageCodeTranslator.translate(messageCode, "EMI2/IMI2", "CEMI");
    const serviceName = MessageCodeTranslator.getServiceName(messageCode, "EMI2/IMI2");
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
    let dstAddr = "";

    // --- Control Fields Transformation ---
    // 1. cEMI Control Field 1 is identical to EMI Control
    const controlField1 = new ControlField(ctrlByte);

    // 2. cEMI Control Field 2 (Extended) is extracted from EMI NPCI
    // NPCI: [Res/AddrType] [Hop3] [Hop2] [Hop1] [Len3] [Len2] [Len1] [Len0]

    const controlField2 = new ExtendedControlField();

    // --- NPDU Extraction ---
    const npduBuff = emiBuffer.subarray(6);
    // The implementation of NPDU have NPCI
    const npdu = NPDU.fromBuffer(npduBuff);
    controlField2.hopCount = npdu.hopCount;
    controlField2.addressType = npdu.addressType;
    dstAddr = KNXHelper.GetAddress(emiBuffer.subarray(4, 6), npdu.addressType === 1 ? "/" : ".");

    const tempCemi = new CEMI.DataLinkLayerCEMI[serviceName as "L_Data.ind" | "L_Data.con" | "L_Data.req"](
      null,
      controlField1,
      controlField2,
      srcAddr,
      dstAddr,
      npdu.TPDU,
    );

    return tempCemi;
  }

  /**
   * Converts a cEMI instance to an EMI2 compatible Buffer or ServiceMessage.
   */
  static cemiToEmi(cemi: CEMIInstance): EMIInstance | null {
    if (!("TPDU" in cemi) || !("controlField1" in cemi) || !("controlField2" in cemi)) {
      return null;
    }

    const tpduBuffer = cemi.TPDU.toBuffer();

    // In EMI, NPDU includes NPCI byte at start
    // NPCI = (AddressType << 7) | (HopCount << 4) | (TPDU Length)
    const addressBit = cemi.controlField2.addressType === AddressType.GROUP ? 0x80 : 0x00;
    const npciByte = addressBit | (cemi.controlField2.hopCount << 4) | (tpduBuffer.length & 0x0f);

    const emiCode = MessageCodeTranslator.translate(cemi.messageCode, "CEMI", "EMI2/IMI2");
    if (emiCode === null) return null;

    // Buffer [MC] [Ctrl] [Src] [Dst] [NPCI] [TPDU]
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

    // // NPDU Length (NPCI + TPDU)
    // buffer.writeUInt8(tpduBuffer.length + 1, offset++);

    // Write NPCI then TPDU
    buffer.writeUInt8(npciByte, offset++);
    tpduBuffer.copy(buffer, offset);

    return EMI.fromBuffer(buffer);
  }
}
