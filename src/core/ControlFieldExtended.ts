import { AddressType, ExtendedFrameFormat } from "./enum/EnumControlFieldExtended";

/**
 * Clase para manejar el Extended Control Field (CTRLE) en un L_Data_Extended Frame TP1
 */
export class ExtendedControlField {
  private buffer: Buffer;

  /**
   * Constructor de la clase
   * @param input Buffer, número o array de números que representa el CTRLE (1 octeto).
   */
  constructor(input?: Buffer | number | number[]) {
    if (input instanceof Buffer) {
      this.buffer = input.length > 0 ? input.subarray(0, 1) : Buffer.alloc(1, 0);
    } else if (Array.isArray(input)) {
      this.buffer = Buffer.from(input.slice(0, 1));
      if (this.buffer.length < 1) {
        this.buffer = Buffer.alloc(1, 0);
      }
    } else if (typeof input === 'number') {
      this.buffer = Buffer.alloc(1, input & 0xFF);
    } else {
      this.buffer = Buffer.alloc(1, 0);
    }
  }

  /**
   * Obtiene el buffer completo del CTRLE (1 octeto).
   */
  getBuffer(): Buffer {
    return this.buffer;
  }

  /**
   * Representación en hexadecimal (2 dígitos).
   */
  toHexString(): string {
    return this.buffer[0].toString(16).padStart(2, '0').toUpperCase();
  }

  /**
   * Valor numérico (0..255).
   */
  toNumber(): number {
    return this.buffer[0];
  }

  /**
   * Address Type (bit 7):
   *  - 0 => Individual Address
   *  - 1 => Group Address
   */
  get addressType(): AddressType {
    return (this.buffer[0] & 0x80) ? AddressType.GROUP : AddressType.INDIVIDUAL;
  }

  set addressType(type: AddressType) {
    if (type === AddressType.GROUP) {
      this.buffer[0] |= 0x80;  // bit7 = 1
    } else {
      this.buffer[0] &= 0x7F;  // bit7 = 0
    }
  }

  /**
   * Hop Count (bits 6..4) => 3 bits (0..7).
   */
  get hopCount(): number {
    // bits6..4 => 0111 0000 => 0x70
    // SHIFT 4 => 3 bits
    return (this.buffer[0] & 0x70) >> 4;
  }

  set hopCount(value: number) {
    if (value < 0 || value > 7) {
      throw new Error("HopCount debe estar entre 0..7");
    }
    // Preserva bit7 y bits3..0 => 0x8F => 1000 1111
    this.buffer[0] = (this.buffer[0] & 0x8F) | ((value & 0x07) << 4);
  }

  /**
   * Extended Frame Format (bits 3..0) => 4 bits (0..15).
   */
  get eff(): ExtendedFrameFormat {
    return (this.buffer[0] & 0x0F) as ExtendedFrameFormat;
  }

  set eff(value: ExtendedFrameFormat) {
    if (value < 0 || value > 15) {
      throw new Error("EFF debe estar en el rango 0..15");
    }
    // Preserva bits7..4 => 0xF0 => 1111 0000
    this.buffer[0] = (this.buffer[0] & 0xF0) | (value & 0x0F);
  }

  /**
   * Descripción detallada del CTRLE
   */
  describe() {
    const val = this.buffer[0];
    return {
      obj: this.constructor.name,
      hex: `0x${this.toHexString()}`,
      addressType: this.addressType === AddressType.GROUP ? "GROUP(1)" : "INDIVIDUAL(0)",
      hopCount: this.hopCount,
      eff: this.eff,
      binary: val.toString(2).padStart(8, '0')
    };
  }

  /**
   * Método estático para crear una instancia desde diferentes tipos de entrada
   */
  static from(input: Buffer | number | number[]): ExtendedControlField {
    return new ExtendedControlField(input);
  }
}
