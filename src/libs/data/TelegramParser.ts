import { AddressType } from "./enum/KNXEnumControlFieldExtended";
import { KNXAPCI } from "./KNXAPCI";
import { KnxData } from "./KNXData";
import { KNXTP1 } from "./KNXTP1";
import { KNXTP1ControlField } from "./KNXTP1ControlField";
import { KNXTP1ExtendedControlField } from "./KNXTP1ControlFieldExtended";
import { KNXTPCI } from "./KNXTPCI";

// TelegramParser.ts
export class TelegramParser {
  static parseTelegram(data: Buffer, dpt?: typeof KnxData.dptEnum[number]) {
    console.log(data)
    if ((data.length - 7) <= KNXTP1.DataLength_Data_In_L_Data_Standard + 1) {
      const apdu = data.subarray(6, data.length - 1);
      // Parseo de TPCI (bits 7..2 de data[6])
      const tpciValue = (data[6] & 0xFC);
      const tpci = new KNXTPCI(tpciValue)
      // Parseo de APCI (bits 1..0 de data[6], bits 7..6 de data[7])
      const apciValue = (((data[6] << 6) & 0xC0) | ((data[7] >> 2) & 0x30));
      const apci = new KNXAPCI(apciValue)
      const knxDecoder = new KnxData(apdu)
      const controlField = new KNXTP1ControlField(data[0])
      return {
        controlField: controlField.describe(),
        srcAddress: `${(data[1] >> 4) & 0x0F}.${(data[1] & 0x0F)}.${data[2]}`,
        dstAddress: `${(data[3] >> 3)}/${(data[3] & 0x07)}/${data[4]}`,
        addressType: AddressType[(data[5] >> 7)],
        hopCount: (data[5] & 0x70) >> 4,
        lengthData: (data[5] & 0x0F),
        tpci: tpci.mapTPCIType(tpciValue),
        tpciDescribe: tpci.describe(),
        apci: apci.describe(),
        payload: apdu,
        decodeValue: dpt ? knxDecoder.decodeThis(dpt) : null,
        checksum: data[data.length - 1]
      };
    } else if ((data.length - 8) <= KNXTP1.DataLength_Data_In_L_Data_Extended + 1) {
      const apdu = data.subarray(7, data.length - 1);
      const knxDecoder = new KnxData(apdu)
      const controlField = new KNXTP1ControlField(data[0])
      const controlFieldExtended = new KNXTP1ExtendedControlField(data[1])
      // Parseo de TPCI (bits 7..2 de data[7])
      const tpciValue = (data[7] & 0xFC) >> 2;
      const tpci = new KNXTPCI(tpciValue)
      // Parseo de APCI (bits 1..0 de data[7], bits 7..6 de data[8])
      const apciValue = ((data[7] & 0x03) << 2) | ((data[8] >> 6) & 0x03);
      const apci = new KNXAPCI(apciValue)
      return {
        controlField: controlField.describe(),
        controlFieldExtended: controlFieldExtended.describe(),
        srcAddress: `${(data[2] >> 4) & 0x0F}.${(data[2] & 0x0F)}.${data[3]}`,
        dstAddress: `${(data[4] >> 3)}/${(data[4] & 0x07)}/${data[5]}`,
        lengthData: data[6],
        tpci: tpci.mapTPCIType(tpciValue),
        tpciDescribe: tpci.describe(),
        apci: apci.describe(),
        payload: apdu,
        decodeValue: dpt ? knxDecoder.decodeThis(dpt) : null,
        checksum: data[data.length - 1]
      };
    } else {
      throw new Error("The length of the telegram exceeds the maximum allowed")
    }
  }
}
