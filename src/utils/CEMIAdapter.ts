// import { CEMI } from "../core/CEMI";
// import { ControlField } from "../core/ControlField";
// import { ExtendedControlField } from "../core/ControlFieldExtended";
// import { TPDU } from "../core/layers/data/TPDU";
// import { KNXHelper } from "./KNXHelper";
// import { AddressType } from "../core/enum/EnumControlFieldExtended";
// import { MessageCodeTranslator } from "./MessageCodeTranslator";
// import { EMI } from "../core/EMI";
// import { ServiceMessage } from "../@types/interfaces/ServiceMessage";

// export class CEMIAdapter {
//   /**
//    * Adapta un mensaje crudo EMI2 (Buffer) a una instancia de CEMI.
//    * Estructura EMI típica: [MC] [Ctrl] [Src] [Dst] [Len] [NPDU(NPCI + TPDU)]
//    */
//   static emiToCemi(emiBuffer: Buffer): CEMI | null {
//     if (emiBuffer.length < 7) throw new Error("Buffer EMI demasiado corto");

//     let offset = 0;
//     const messageCode = emiBuffer.readUInt8(offset++);
//     const ctrlByte = emiBuffer.readUInt8(offset++);

//     // Direcciones (2 bytes cada una)
//     const srcAddr = KNXHelper.GetAddress(emiBuffer.subarray(offset, offset + 2), ".") as string;
//     offset += 2;
//     const dstAddr = KNXHelper.GetAddress(emiBuffer.subarray(offset, offset + 2), "/") as string;
//     offset += 2;

//     const dataLength = emiBuffer.readUInt8(offset++); // Longitud del NPDU
//     const npciByte = emiBuffer.readUInt8(offset++); // Primer byte del NPDU (NPCI)

//     // --- Transformación de campos de Control ---
//     // 1. Control Field 1 de cEMI es idéntico al Control de EMI
//     const controlField1 = new ControlField(ctrlByte);

//     // 2. Control Field 2 (Extended) se extrae del NPCI del EMI
//     // NPCI: [Res/AddrType] [Hop3] [Hop2] [Hop1] [Len3] [Len2] [Len1] [Len0]
//     const hopCount = (npciByte >> 4) & 0x07;
//     const addressType = npciByte & 0x80 ? AddressType.GROUP : AddressType.INDIVIDUAL;

//     const controlField2 = new ExtendedControlField();
//     controlField2.hopCount = hopCount;
//     controlField2.addressType = addressType;

//     // --- Extracción del TPDU ---
//     // En cEMI, el payload es el TPDU puro (sin el byte NPCI)
//     const tpduBuffer = emiBuffer.subarray(offset, offset + dataLength - 1);
//     const tpdu = TPDU.fromBuffer(tpduBuffer);

//     // Traducir Message Code si es necesario (EMI 0x11 -> cEMI 0x11, etc.)
//     // Basado en tu MessageCodeField
//     const cemiCode = MessageCodeTranslator.translate(messageCode, "EMI2/IMI2", "CEMI");
//     if (!cemiCode) return null;

//     return new CEMI(
//       cemiCode,
//       null, // Additional Info suele ser null al venir de EMI
//       controlField1,
//       controlField2,
//       srcAddr,
//       dstAddr,
//       tpdu,
//     );
//   }

//   /**
//    * Convierte una instancia de CEMI a un Buffer compatible con EMI2.
//    * Requiere re-empaquetar el Hop Count en el byte NPCI.
//    */
//   static cemiToEmi(cemi: CEMI): ServiceMessage | null {
//     const tpduBuffer = cemi.TPDU.toBuffer();

//     // En EMI, el NPDU incluye el byte NPCI al inicio
//     // NPCI = (AddressType << 7) | (HopCount << 4) | (TPDU Length)
//     const addressBit = cemi.controlField2.addressType === AddressType.GROUP ? 0x80 : 0x00;
//     const npciByte = addressBit | (cemi.controlField2.hopCount << 4) | (tpduBuffer.length & 0x0f);

//     const emiCode = MessageCodeTranslator.translate(cemi.messageCode, "CEMI", "EMI2/IMI2");
//     if (!emiCode) return null;

//     // Construcción del Buffer [MC] [Ctrl] [Src] [Dst] [NPDU_Len] [NPCI] [TPDU]
//     const buffer = Buffer.alloc(7 + 1 + tpduBuffer.length);
//     let offset = 0;

//     buffer.writeUInt8(emiCode, offset++);
//     cemi.controlField1.buffer.copy(buffer, offset++);

//     KNXHelper.GetAddress_(cemi.sourceAddress).copy(buffer, offset);
//     offset += 2;

//     KNXHelper.GetAddress_(cemi.destinationAddress).copy(buffer, offset);
//     offset += 2;

//     // Longitud del NPDU (NPCI + TPDU)
//     buffer.writeUInt8(tpduBuffer.length + 1, offset++);

//     // Escribir NPCI y luego los datos
//     buffer.writeUInt8(npciByte, offset++);
//     tpduBuffer.copy(buffer, offset);

//     return EMI.fromBuffer(buffer);
//   }
// }
