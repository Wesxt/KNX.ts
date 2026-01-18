import { ServiceMessage } from "../../../@types/interfaces/ServiceMessage";
import { KNXHelper } from "../../../utils/KNXHelper";
import { TPCI, TPCIType } from "../interfaces/TPCI";
import { APDU } from "./APDU";

export class TPDU implements ServiceMessage {
  _tpci: TPCI;
  _apdu: APDU;
  _data: Buffer;

  constructor(
    tpci: TPCI = new TPCI(TPCIType.T_DATA_GROUP_PDU),
    apdu: APDU = new APDU(),
    data: Buffer = Buffer.alloc(0),
  ) {
    this._tpci = tpci;
    this._apdu = apdu;
    this._data = data;
  }

  get length(): number {
    return KNXHelper.GetDataLength(this._data);
  }

  /**
   * Devuelve un buffer con TPCI/APCI + data
   */
  toBuffer(): Buffer {
    const buffer = Buffer.alloc(1 + (this._data.length > 0 ? this._data.length : 1));
    buffer[0] = this._tpci.getValue();
    KNXHelper.WriteData(buffer, this._data, 1);
    return buffer;
  }

  describe() {
    return {
      layer: "Transport Layer (TPDU)",
      tpci: this._tpci.describe(),
      APDU: this._apdu.describe(),
    };
  }

  /**
   * Crea una instancia de TPDU.
   * Estructura: [TPCI + APCI_High] [APCI_Low + Data] [Data...]
   */
  static fromBuffer(buffer: Buffer): TPDU {
    if (buffer.length < 1) throw new Error("Buffer too short for TPDU");

    // 1. Extraer TPCI (Transport Protocol Control Information)
    // El TPCI ocupa los primeros 6 bits del primer octeto.
    // Máscara: 1111 1100 (0xFC)
    // Pasamos el byte completo sin aplicar la mascara para que el TPCI pueda describir
    // sus dos ultimos bits que son del APCI.
    // Perfectamente se puede aplicar la mascara sin ningún problema
    const tpciByte = buffer.readUInt8(0);
    const tpciValue = tpciByte;
    const tpci = new TPCI(tpciValue);

    // 2. Extraer APDU (Application Protocol Data Unit)
    // IMPORTANTE: Pasamos TODO el buffer, porque el APDU necesita los
    // últimos 2 bits del primer byte (que son parte del APCI).
    const apdu = APDU.fromBuffer(buffer);

    return new TPDU(tpci, apdu);
  }
}
