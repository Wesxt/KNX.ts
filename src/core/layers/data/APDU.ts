import { ServiceMessage } from "../../../@types/interfaces/ServiceMessage";
import { KNXHelper } from "../../../utils/KNXHelper";
import { APCIEnum } from "../../enum/APCIEnum";
import { APCI } from "../interfaces/APCI";
import { TPCI, TPCIType } from "../interfaces/TPCI";

export class APDU implements ServiceMessage {
  tpci: TPCI;
  apci: APCI;
  data: Buffer;
  isShort: boolean;

  constructor(
    tpci: TPCI = new TPCI(TPCIType.T_DATA_GROUP_PDU),
    apci: APCI = new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit),
    data: Buffer = Buffer.alloc(0),
    isShort: boolean = false
  ) {
    this.tpci = tpci;
    this.apci = apci;
    this.data = data;
    this.isShort = isShort;
  }

  get length(): number {
    return KNXHelper.GetDataLength(this.data, this.isShort);
  }

  /**
   * Devuelve un buffer con TPCI/APCI + data
   */
  toBuffer(): Buffer {
    const buffer = Buffer.alloc(1 + this.length);
    const packNumber = this.apci.packNumber();
    this.tpci.first2bitsOfAPCI = packNumber[0];
    // TPCI/APCI
    buffer.writeUInt8(this.tpci.getValue(), 0);
    buffer.writeUInt8(packNumber[1], 1);
    // Data
    KNXHelper.WriteData(buffer, this.data, 1, this.isShort);
    return buffer;
  }

  describe() {
    return {
      layer: "Application Layer (APDU)",
      tpci: this.tpci.describe(),
      apci: this.apci.describe(),
      data: this.data,
    };
  }

  /**
   * Crea una instancia de APDU reconstruyendo APCI y Datos.
   * Maneja la lógica de bits mezclados según Spec 03.03.07.
   */
  static fromBuffer(buffer: Buffer): APDU {
    if (buffer.length < 1) throw new Error("Buffer too short for APDU");

    // 1. Reconstruir el APCI (10 bits)
    // Byte 0: [T T T T T T A9 A8]  -> Nos interesan los últimos 2 bits
    // Byte 1: [A7 A6 A5 A4 D D D D] -> Nos interesan los primeros 4 bits (normalmente)
    // OJO: La máscara depende del comando, pero para GroupValueWrite/Read estándar (0x80, 0x00),
    // el APCI ocupa los 4 bits altos del segundo byte.

    const byte0 = buffer.readUInt8(0);
    let byte1 = 0;
    if (buffer.length > 1) {
      byte1 = buffer.readUInt8(1);
    }

    // ** Se evita usar la mascara 0xfc para que el tpci tenga los dos bits más
    // ** significativos del APCI
    const tpciValue = byte0;
    const tpci = new TPCI(tpciValue);

    // Parte Alta APCI (2 bits): Byte 0 & 0000 0011
    const apciHigh = byte0 & 0x03;

    // Parte Baja APCI (4 bits): Byte 1 & 1100 0000 (0xC0)
    // Nota: Aunque APCI son 10 bits, los comandos estándar usan los bits altos.
    // El resto del byte 1 son datos para payloads cortos (Short Frame).
    const apciLow = byte1 & 0xc0;

    // Reconstruimos el valor completo del APCI Enum
    // (A9 A8) << 8 | (A7 A6 A5 A4 0 0 0 0)
    const apciValue = (apciHigh << 8) | apciLow;

    const apci = new APCI(apciValue);

    // 2. Extraer los Datos (Payload)
    let data: Buffer;
    let isShort = false;

    // Regla de longitud KNX:
    // Si el TPDU tiene longitud > 2 bytes, los datos comienzan en el byte 2 (Extended Data).
    // Si el TPDU tiene longitud == 2 bytes, los datos son los 6 bits bajos del byte 1 (Optimized/Short Data).

    if (buffer.length > 2) {
      // Caso: Datos largos (> 6 bits o estructurados)
      // Ejemplo: Escribir un flotante (4 bytes) -> buffer total 1 + 1 + 4 = 6 bytes.
      // Los datos empiezan en el índice 2.
      data = buffer.subarray(2);
      isShort = false;
    } else {
      // Caso: Datos cortos (<= 6 bits)
      // Ejemplo: Escribir Booleano (ON/OFF) o 3-bit scaling.
      // Los datos están en los últimos 6 bits del byte 1.
      // Máscara: 0011 1111 (0x3F)
      if (buffer.length === 2) {
        const shortData = byte1 & 0x3f;
        // Lo convertimos a Buffer de 1 byte para mantener consistencia
        data = Buffer.from([shortData]);
        isShort = true;
      } else {
        // Caso raro: Longitud 1 (Solo comando sin datos, ej. Read request)
        data = Buffer.alloc(0);
        isShort = false;
      }
    }

    return new APDU(tpci, apci, data, isShort);
  }
}
