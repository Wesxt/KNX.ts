import { ServiceMessage } from "../../../@types/interfaces/ServiceMessage";
import { AddressType } from "../../enum/EnumControlFieldExtended";
import { TPDU } from "../../TPDU";

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
  private _TPDU: TPDU; // Datos puros (payload del usuario)
  private _addressType: AddressType;
  constructor(InstanceOfTPDU: TPDU = new TPDU(), addressType: AddressType = AddressType.GROUP, hopCount: number = 6) {
    this._addressType = addressType;
    this.hopCount = hopCount; // Usa el setter para validar
    this._TPDU = InstanceOfTPDU;
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
    const tpduBuffer = this._TPDU.toBuffer();
    const length = tpduBuffer.length;

    // Construcción del Byte NPCI (Octeto 0 del NPDU)
    // Bits 7: Reservado (0) -> parece ser el AddressType
    // Bits 6-4: Hop Count
    // Bits 3-0: Length (Longitud del TPDU)
    const npciByte = (this.addressType << 7) | (this._hopCount << 4) | (length & 0x0f);

    const buffer = Buffer.alloc(1 + length);
    buffer.writeUInt8(npciByte, 0);
    tpduBuffer.copy(buffer, 1);

    return buffer;
  }

  describe() {
    return {
      layer: "Network Layer (NPDU)",
      addressType: AddressType[this.addressType],
      hopCount: this.hopCount,
      TPDU: this._TPDU.describe(),
    };
  }

  /**
   * Crea una instancia de NPDU a partir de un Buffer crudo.
   * Estructura: [NPCI] [TPDU...]
   * @param buffer El buffer completo comenzando con el byte NPCI.
   */
  static fromBuffer(buffer: Buffer): NPDU {
    if (buffer.length < 2) {
      // Mínimo 1 byte NPCI + 1 byte payload
      throw new Error("Buffer too short for NPDU");
    }

    // 1. Parsear el Byte NPCI (Octeto 0)
    // Bits 7: Reservado (0)
    // Bits 6-4: Hop Count
    // Bits 3-0: Length (Longitud del TPDU)
    const npci = buffer.readUInt8(0);
    const hopCount = (npci >> 4) & 0x07;
    const length = npci & 0x0f;

    // Validación de longitud según especificación 03_03_03
    // Nota: 'length' en NPCI indica la longitud del TPDU en bytes.
    if (buffer.length - 1 < length) {
      throw new Error(`NPDU declared length ${length} but buffer has only ${buffer.length - 1} bytes payload`);
    }

    // 2. Extraer el TPDU (Transport Layer PDU)
    // El payload comienza en el índice 1.
    const tpduBuffer = buffer.subarray(1, 1 + length);

    // Llamada estática recursiva a la siguiente capa
    const tpdu = TPDU.fromBuffer(tpduBuffer);

    // 3. Retornar nueva instancia
    // Nota: AddressType no viene en el NPDU, viene del cEMI. Asumimos GROUP por defecto.
    return new NPDU(tpdu, AddressType.GROUP, hopCount);
  }
}
