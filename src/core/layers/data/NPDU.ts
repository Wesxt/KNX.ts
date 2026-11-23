import { ServiceMessage } from "../../../@types/interfaces/ServiceMessage";
import { AddressType } from "../../enum/EnumControlFieldExtended";
import { TPDU } from "./TPDU";

/**
 * Clase que representa la Network Protocol Data Unit (NPDU).
 * * Responsabilidades:
 * 1. Gestionar el Hop Count (Contador de saltos) para el enrutamiento.
 * 2. Gestionar la longitud de la trama de datos (Length).
 * 3. Encapsular el TPDU (Transport Layer PDU), que a su vez contiene el TPCI y el APDU.
 * * Estructura del Byte NPCI (Network Protocol Control Information):
 * Bits [7]   : Reservado (normalmente 0 en tramas estándar)
 * Bits [6-4] : Hop Count (0-7)
 * Bits [3-0] : Longitud del Payload (APDU)
 * @see 03_03_03 Network Layer v02.01.01 AS
 */
export class NPDU implements ServiceMessage {
  private _hopCount: number = 6; // Valor por defecto estándar en KNX
  public TPDU: TPDU; // Datos puros (payload del usuario)
  private _addressType: AddressType;
  public length: number = 0;
  constructor(
    InstanceOfTPDU: TPDU = new TPDU(),
    addressType: AddressType = AddressType.GROUP,
    hopCount: number = 6,
    length?: number,
  ) {
    this._addressType = addressType;
    this.hopCount = hopCount; // Usa el setter para validar
    this.TPDU = InstanceOfTPDU;
    if (length !== undefined) {
      this.length = length;
    } else {
      this.length = Math.max(0, InstanceOfTPDU.toBuffer().length - 1);
    }
  }

  /**
   * Obtiene el Hop Count (0-7).
   */
  get hopCount(): number {
    return this._hopCount;
  }

  /**
   * Establece el Hop Count. Lanza error si está fuera de rango (0-7).
   */
  set hopCount(value: number) {
    if (value < 0 || value > 7) {
      throw new Error("Hop Count must be between 0 and 7");
    }
    this._hopCount = value;
  }

  get addressType() {
    return this._addressType;
  }

  set addressType(value: AddressType) {
    if (value > 1 || value < 0) throw new Error("The address type is not mayor or minor than 0..1");
    this._addressType = value;
  }

  toBuffer(): Buffer {
    const tpduBuffer = this.TPDU.toBuffer();
    const apduLength = Math.max(0, tpduBuffer.length - 1);

    // Construcción del Byte NPCI (Octeto 0 del NPDU)
    // Bit 7   : Address Type (0 = Individual, 1 = Group)
    // Bits 6-4: Hop Count (0..7)
    // Bits 3-0: Length LG = longitud de APDU (TPDU.length - 1, 0..15)
    const npciByte = (this.addressType << 7) | (this._hopCount << 4) | (apduLength & 0x0f);

    const buffer = Buffer.alloc(1 + tpduBuffer.length);
    buffer.writeUInt8(npciByte, 0);
    tpduBuffer.copy(buffer, 1);

    return buffer;
  }

  describe() {
    return {
      obj: this.constructor.name,
      layer: "Network Layer (NPDU)",
      addressType: AddressType[this.addressType],
      hopCount: this.hopCount,
      TPDU: this.TPDU.describe(),
    };
  }

  /**
   * Crea una instancia de NPDU a partir de un Buffer crudo.
   * Estructura: [AT|HC|LG] [TPDU (LG + 1 octetos)...]
   * @param buffer El buffer completo comenzando con el byte NPCI/DRL.
   */
  static fromBuffer(buffer: Buffer): NPDU {
    if (buffer.length < 2) {
      // Mínimo 1 byte NPCI + 1 byte TPCI (LG = 0)
      throw new Error("Buffer too short for NPDU");
    }

    // 1. Parsear el Byte NPCI/DRL (Octeto 0)
    // Bit 7   : Address Type (0 = Individual, 1 = Group)
    // Bits 6-4: Hop Count (0..7)
    // Bits 3-0: Length LG (longitud del APDU; TPDU ocupa LG + 1 bytes según 03_02_02 §2.2.4.5 y 03_03_03)
    const npci = buffer.readUInt8(0);
    const addressType = ((npci >> 7) & 0x01) as AddressType;
    const hopCount = (npci >> 4) & 0x07;
    const length = npci & 0x0f;
    const tpduByteLen = length + 1;

    if (buffer.length - 1 < tpduByteLen) {
      throw new Error(
        `NPDU declared APDU length ${length} (${tpduByteLen} TPDU bytes) but buffer has only ${buffer.length - 1} bytes payload`,
      );
    }

    // 2. Extraer el TPDU completo (1 byte TPCI + length bytes APDU)
    const tpduBuffer = buffer.subarray(1, 1 + tpduByteLen);
    const tpdu = TPDU.fromBuffer(tpduBuffer);

    return new NPDU(tpdu, addressType, hopCount, length);
  }
}
