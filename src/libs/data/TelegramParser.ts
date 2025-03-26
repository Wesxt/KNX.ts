import { KnxData } from "./KNXData";
import { KNXTP1 } from "./KNXTP1";
import { KNXTP1ControlField } from "./KNXTP1ControlField";
import { KNXTP1ExtendedControlField } from "./KNXTP1ControlFieldExtended";
import { TPCIType } from "./KNXTPCI";

// TelegramParser.ts
export class TelegramParser {
  static parseTelegram(data: Buffer, dpt?: typeof KnxData.dptEnum[number]) {
    if ((data.length - 7) <= KNXTP1.DataLength_Data_APCI_In_L_Data_Standard + 1) {
      const apdu = Buffer.alloc(data.length - 7)
      data.copy(apdu, 0, 6, data.length - 1)
      const knxDecoder = new KnxData(apdu)
      const controlField = new KNXTP1ControlField(data[0])
      return {
        control: controlField.describe(),
        srcAddress: `${(data[1] >> 4) & 0x0F}.${(data[1] & 0x0F)}.${data[2]}`,
        dstAddress: `${(data[3] >> 3)}/${(data[3] & 0x07)}/${data[4]}`,
        tpci: TPCIType[data[7]] + `: ${data[8].toString(16)}`,
        payload: apdu,
        decodeValue: dpt ? knxDecoder.decodeThis(dpt) : null,
        checksum: data[data.length - 1]
      };
    } else if ((data.length - 8) <= KNXTP1.DataLength_Data_APCI_In_L_Data_Extended + 1) {
      const apdu = Buffer.alloc(data.length - 8)
      data.copy(apdu, 0, 7, data.length - 1)
      const knxDecoder = new KnxData(apdu)
      const controlField = new KNXTP1ControlField(data[0])
      const controlFieldExtended = new KNXTP1ExtendedControlField(data[1])
      return {
        control: controlField.describe(),
        controlExtended: controlFieldExtended.describe(),
        srcAddress: `${(data[2] >> 4) & 0x0F}.${(data[2] & 0x0F)}.${data[3]}`,
        dstAddress: `${(data[4] >> 3)}/${(data[4] & 0x07)}/${data[5]}`,
        tpci: TPCIType[data[8]] + `: ${data[8].toString(16)}`,
        payload: apdu,
        decodeValue: dpt ? knxDecoder.decodeThis(dpt) : dpt,
        checksum: data[data.length - 1]
      };
    } else {
      throw new Error("The length of the telegram exceeds the maximum allowed")
    }
  }
}
