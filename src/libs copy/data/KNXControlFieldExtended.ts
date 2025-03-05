import { Priority } from "./enum/KNXEnumControlField";

/**
 * Clase para manejar el Extended Control Field (CTRLE) en KNX
 */
export class KNXExtendedControlFieldHandler {
  private buffer: Buffer;

  /**
   * Constructor de la clase
   * @param input Buffer, número o array de números que representa el CTRLE
   */
  constructor(input?: Buffer | number | number[]) {
    if (input instanceof Buffer) {
      this.buffer = input;
    } else if (Array.isArray(input)) {
      this.buffer = Buffer.from(input);
    } else if (typeof input === 'number') {
      this.buffer = Buffer.alloc(1, input);
    } else {
      this.buffer = Buffer.alloc(1, 0);
    }
  }

  /**
   * Obtiene el valor completo del CTRLE como buffer
   * @returns {Buffer} Buffer del CTRLE
   */
  getBuffer(): Buffer {
    return this.buffer;
  }

  /**
   * Obtiene el CTRLE como un array de números
   * @returns {number[]} Array de números representando el CTRLE
   */
  toNumberArray(): number[] {
    return Array.from(this.buffer);
  }

  /**
   * Convierte el CTRLE a una representación hexadecimal
   * @returns {string} Representación hexadecimal del CTRLE
   */
  toHexString(): string {
    return this.buffer.toString('hex').toUpperCase();
  }

  /**
   * Obtiene el valor numérico del CTRLE
   * @returns {number} Valor numérico del CTRLE
   */
  toNumber(): number {
    return this.buffer.readUInt8(0);
  }

  /**
   * Extrae el bit de dirección de destino (Address Type - AT)
   * @returns {boolean} True si es una dirección de grupo, False si es punto a punto
   */
  getAddressType(): boolean {
    return Boolean(this.buffer[0] & 0x80);
  }

  /**
   * Establece el bit de dirección de destino (Address Type - AT)
   * @param {boolean} isGroupAddress True para dirección de grupo, False para punto a punto
   */
  setAddressType(isGroupAddress: boolean): void {
    this.buffer[0] = isGroupAddress 
      ? (this.buffer[0] | 0x80) 
      : (this.buffer[0] & 0x7F);
  }

  /**
   * Extrae los bits de hop count (bits 6-3)
   * @returns {number} Valor del hop count (0-15)
   */
  getHopCount(): number {
    return (this.buffer[0] & 0x78) >> 3;
  }

  /**
   * Establece los bits de hop count, define el número máximo de saltos que un paquete puede realizar antes de ser descartado.
   *  Su propósito principal es evitar que los mensajes circulen indefinidamente en la red, similar al concepto de TTL (Time-To-Live) en protocolos como IP.
   * @param {number} count Valor del hop count (0-15)
   */
  setHopCount(count: number): void {
    if (count < 0 || count > 15) {
      throw new Error('El hop count debe estar entre 0 y 15');
    }
    this.buffer[0] = (this.buffer[0] & 0x87) | ((count & 0x0F) << 3);
  }

  /**
   * Extrae el bit de Extended Frame Format (EFF)
   * @returns {boolean} True si es un frame extendido
   */
  getExtendedFrameFormat(): boolean {
    return Boolean(this.buffer[0] & 0x01);
  }

  /**
   * Establece el bit de Extended Frame Format (EFF)
   * @param {boolean} isExtendedFrame True si es un frame extendido
   */
  setExtendedFrameFormat(isExtendedFrame: boolean): void {
    this.buffer[0] = isExtendedFrame 
      ? (this.buffer[0] | 0x01) 
      : (this.buffer[0] & 0xFE);
  }

  /**
   * Crea una representación detallada del CTRLE
   * @returns {string} Descripción detallada del CTRLE
   */
  describe(): string {
    return `CTRLE: 
      Hex: ${this.toHexString()}
      Address Type: ${this.getAddressType() ? "Group Address" : "Point-to-Point Address"}
      Hop Count: ${this.getHopCount()}
      Extended Frame Format: ${this.getExtendedFrameFormat()}`;
  }

  /**
   * Método estático para crear una instancia desde diferentes tipos de entrada
   * @param {Buffer | number | number[]} input Entrada para crear el CTRLE
   * @returns {KNXExtendedControlFieldHandler} Instancia de KNXExtendedControlFieldHandler
   */
  static from(input: Buffer | number | number[]): KNXExtendedControlFieldHandler {
    return new KNXExtendedControlFieldHandler(input);
  }
}
