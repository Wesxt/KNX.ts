import { KnxData } from "./KNXData";

// TelegramParser.ts
export class TelegramParser {
  static parseTelegram(data: Buffer) {
    const apdu = Buffer.alloc(data.length - 7)
    data.copy(apdu, 0, 6, data.length - 1)
    console.log("data: ", apdu)
    const knxDecoder = new KnxData(apdu)
    return {
        control: data[0],
        srcAddress: `${(data[1] >> 4) & 0x0F}.${(data[1] & 0x0F)}.${data[2]}`,
        dstAddress: `${(data[3] >> 3)}.${(data[3] & 0x07)}.${data[4]}`,
        apci: data[6] & 0xC0, // Extrae sólo el código de APCI
        payload: data.subarray(7, 7 + (data[5] - 1)),
        decodeValue: knxDecoder.decodeThis(1),
        checksum: data[data.length - 1]
    };
}
}
