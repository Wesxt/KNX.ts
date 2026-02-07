import { ServiceMessage } from "../../../@types/interfaces/ServiceMessage";
import { KNXHelper } from "../../../utils/KNXHelper";
import { TPCI, TPCIType } from "../interfaces/TPCI";
import { APDU } from "./APDU";

export class TPDU implements ServiceMessage {
  tpci: TPCI;
  apdu: APDU;
  data: Buffer;

  constructor(
    tpci: TPCI = new TPCI(TPCIType.T_DATA_GROUP_PDU),
    apdu: APDU = new APDU(),
    data: Buffer = Buffer.alloc(0),
  ) {
    this.tpci = tpci;
    this.apdu = apdu;
    this.data = data;
  }

  /**
   * Get length all TPDU
   */
  get length(): number {
    return this.toBuffer().length;
  }

  get TSDU() {
    return this.apdu;
  }

  /**
   * Devuelve un buffer con TPCI/APCI + data
   */
  toBuffer(): Buffer {
    const buffer = Buffer.alloc(1 + (this.data.length > 0 ? this.data.length : 1));
    // La clase APDU tiene el tpci y el apci en su buffer
    // para simplificar la envoltura de los octetos por lo tanto
    // se escribe el tpci desde del apdu para evitar problemas
    buffer.writeUint8(this.apdu.tpci.getValue(), 0);
    const packNumber = this.apdu.apci.packNumber();
    buffer.writeUInt8(packNumber[1], 1);
    KNXHelper.WriteData(buffer, this.data, 1);
    return buffer;
  }

  describe() {
    return {
      layer: "Transport Layer (TPDU)",
      tpci: this.tpci.describe(),
      APDU: this.apdu.describe(),
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
    // ** Se evita usar la mascara 0xfc para que el tpci tenga los dos bits más
    // ** significativos del APCI
    const tpciByte = buffer.readUInt8(0);
    const tpciValue = tpciByte;
    const tpci = new TPCI(tpciValue);

    // 2. Extraer APDU (Application Protocol Data Unit)
    // IMPORTANTE: Pasamos TODO el buffer, porque el APDU necesita los
    // últimos 2 bits del primer byte (que son parte del APCI).
    const apdu = APDU.fromBuffer(buffer);

    return new TPDU(tpci, apdu, apdu.data);
  }
}
