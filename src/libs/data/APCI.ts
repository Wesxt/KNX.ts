import { APCIEnum } from "./enum/APCIEnum";

/**
 * Clase para manejar el Application Control Field (APCI) en comunicaciones KNX,
 * específicamente para el modo T_Data_Group.
 *
 * El APCI se compone de 4 o 10 bits
 * 
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "Application Layer of the KNX System, Version 02.01.01"
 * 
 */
export class APCI {
  private _value: number;

  constructor(apci: APCIEnum = APCIEnum.A_GroupValue_Write_Protocol_Data_Unit) {
    this._value = apci & 0x3FF;
  }

  /**
   * Obtiene el valor crudo del APCI (10 bits).
   */
  get value(): number {
    return this._value;
  }

  /**
   * Asigna un nuevo valor crudo al APCI.
   * Se preservan solo en la máscara de 10 bits (0x3FF).
   * @param val Valor numérico (0-1023) que representa el APCI
   */
  set value(val: number) {
    this._value = val & 0x3FF;
  }

  /**
   * Obtiene el comando APCI
   */
  get command(): string {
    return APCIEnum[this._value & 0x3FF];
  }

  /**
   * Establece el comando APCI.
   * @param cmd Comando APCI (uno de los valores del enum APCIEnum)
   */
  set command(cmd: APCIEnum) {
    this._value = cmd;
  }

  /**
   * Retorna una representación hexadecimal del APCI.
   */
  toHex(): string {
    return `0x${this._value.toString(16).padStart(2, '0').toUpperCase()}`;
  }

  /**
   * Devuelve el APCI como Buffer (2 octeto).
   */
  toBuffer(): Buffer {
    return Buffer.from([this._value >> 8, this._value & 0xFF]);
  }

  /**
   * Proporciona una descripción legible del APCI.
   */
  describe(): string {
    return `APCI:
  Command: ${this.command}
  Full Value: ${this.toHex()} (Buffer: ${this.toBuffer().toString('hex').toUpperCase()})`;
  }
}