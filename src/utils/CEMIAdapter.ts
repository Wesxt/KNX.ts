import { CEMI } from "../core/CEMI";
import { ControlField } from "../core/ControlField";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { KNXHelper } from "./KNXHelper";
import { AddressType } from "../core/enum/EnumControlFieldExtended";
import { MessageCodeTranslator } from "./MessageCodeTranslator";
import { EMI } from "../core/EMI";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { NPDU } from "../core/layers/data/NPDU";

/**
 * Adapter utility to convert between EMI (External Message Interface) and cEMI (Common External Message Interface).
 * EMI is typically used by physical interfaces like TPUART, while cEMI is standard for KNXnet/IP.
 */
export class CEMIAdapter {
  /**
   * Adapts a raw EMI2 message (Buffer) to a cEMI instance.
   * Typical EMI structure: [MC] [Ctrl] [Src] [Dst] [Len] [NPDU(NPCI + TPDU)]
   */
  static emiToCemi(emiBuffer: Buffer): ServiceMessage | null {
    if (emiBuffer.length < 7) throw new Error("EMI buffer too short");

    const messageCode = emiBuffer.readUInt8(0);
    const ctrlByte = emiBuffer.readUInt8(1);

    // Addresses (2 bytes each)
    const srcAddr = KNXHelper.GetAddress(emiBuffer.subarray(2, 4), ".") as string;
    let dstAddr = "";

    // const oct6 = emiBuffer.readUInt8(6); // AT,NPCI,LG
    // const addressType = (oct6 >> 7) & 0x01;
    // const hopCount = (oct6 >> 4) & 0x07;
    // const octNum = oct6 & 0x0f; // NPDU Length

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
    // Translate Message Code (EMI 0x11 -> cEMI 0x11, etc.)
    const cemiCode = MessageCodeTranslator.translate(messageCode, "EMI2/IMI2", "CEMI");
    if (cemiCode === null) return null;

    // Construct the appropriate cEMI class using CEMI.fromBuffer or directly
    // Since we already parsed components, we might want to find the class
    // But CEMI.fromBuffer takes a buffer. Let's use it for simplicity if we can re-construct a cEMI buffer
    // Or just instantiate the specific class.
    // Given the structure of CEMI.ts, it's better to use the constructors if possible or fromBuffer with a temporary buffer.

    const tempCemi = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
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
  static cemiToEmi(cemi: any): ServiceMessage | null {
    if (!cemi.TPDU || !cemi.controlField1 || !cemi.controlField2) return null;

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
