import { SerialPort } from "serialport";
import { BIT_1_TIME_IN_9600_BAUDIOS } from "./constants/1bitTimeIn9600Baudios";

/**
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "KNX Standard Communication Media Twisted Pair 1"
 */

export enum ShortAckCode {
  ACK = 0xCC,
  NAK = 0x0C,
  BUSY = 0xC0,
  NAK_BUSY = 0x00
}

export class KNXTP1ACKFrame {
  static sendShortAck(port: SerialPort, code: ShortAckCode): void {
    // Debes asegurarte de respetar el idle time de 15 bits
    // antes de enviar el octeto.
    setTimeout(() => {
      port.write(Buffer.from([code]));
    }, BIT_1_TIME_IN_9600_BAUDIOS * 15); // Ajusta según tu temporización
  }

  static parseShortAck(byte: number): ShortAckCode | null {
    switch (byte) {
      case 0xCC: return ShortAckCode.ACK;
      case 0x0C: return ShortAckCode.NAK;
      case 0xC0: return ShortAckCode.BUSY;
      case 0x00: return ShortAckCode.NAK_BUSY;
      default:   return null; // no es un short ack válido
    }
  }
}