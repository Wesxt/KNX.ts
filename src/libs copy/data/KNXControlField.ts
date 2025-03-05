import { FrameType, Priority, TelegramType } from "./enum/KNXEnumControlField";

export class KNXControlField {
  private _buffer: Buffer;

  constructor(value: number = 0) {
    this._buffer = Buffer.alloc(1);
    this.rawValue = value & 0xFF; // Asegura que solo tenga 8 bits
  }

  /** Frame Type (bit 7):\n * - STANDARD: 1 → L_Data_Standard\n * - EXTENDED: 0 → L_Data_Extended */
  get frameType(): FrameType {
    return ((this.rawValue >> 7) & 0b1) === 1 ? FrameType.STANDARD : FrameType.EXTENDED;
  }

  set frameType(type: FrameType) {
    this.rawValue = type === FrameType.STANDARD
      ? (this.rawValue | 0b10000000)   // Set bit 7
      : (this.rawValue & 0b01111111);  // Clear bit 7
  }

  /** Repeat flag (bit 6):\n * Según la especificación:\n * 0 → repetido\n * 1 → no repetido */
  get repeat(): boolean {
    return ((this.rawValue >> 6) & 0b1) === 1;
  }

  set repeat(notRepeated: boolean) {
    // Si notRepeated es true, seteamos bit 6 en 1; si false, lo ponemos en 0.
    this.rawValue = notRepeated
      ? (this.rawValue | 0b01000000)
      : (this.rawValue & 0b10111111);
  }

  /** Priority (bits 5-4):\n * Codificación esperada:\n * 00: System\n * 10: Urgent\n * 01: Normal\n * 11: Low */
  get priority(): Priority {
    return (this.rawValue >> 4) & 0b11;
  }

  set priority(priority: Priority) {
    // Limpiamos los bits 5-4 y seteamos los nuevos.
    this.rawValue = (this.rawValue & 0b11001111) | ((priority & 0b11) << 4);
  }

  /** Telegram Type (bits 3-0): Para L_Data_Standard se espera que sean 0 (según la especificación).\n * En otros tipos de frame podrían usarse para indicar otros valores. */
  get telegramType(): TelegramType {
    return this.rawValue & 0b00001111;
  }

  set telegramType(type: TelegramType) {
    this.rawValue = (this.rawValue & 0b11110000) | (type & 0b00001111);
  }

  /** Obtiene el valor crudo del campo */
  get rawValue(): number {
    return this._buffer[0];
  }

  set rawValue(value: number) {
    this._buffer[0] = value & 0xFF;
  }

  /** Devuelve el valor en binario en formato de 8 bits */
  toBinary(): string {
    return this.rawValue.toString(2).padStart(8, '0');
  }

  /** Devuelve el Buffer que contiene el control field (1 octeto) */
  get buffer(): Buffer {
    return this._buffer;
  }

  /**
   * Crea una instancia de KNXControlField a partir de un Buffer.
   * @param buffer Buffer de al menos 1 octeto.
   */
  static fromBuffer(buffer: Buffer): KNXControlField {
    if (buffer.length < 1) {
      throw new Error("El buffer debe tener al menos 1 octeto");
    }
    return new KNXControlField(buffer[0]);
  }

  /**
   * Devuelve una descripción legible del control field.
   * @returns {string} Descripción detallada de cada campo.
   */
  describe(): string {
    return `Control Field:
  - Frame Type: ${this.frameType === FrameType.STANDARD ? "L_Data_Standard" : "L_Data_Extended"}
  - Repeat: ${this.repeat ? "No repetido (1)" : "Repetido (0)"}
  - Priority: ${Priority[this.priority]} (${this.priority})
  - Telegram Type: ${TelegramType[this.telegramType]} (${this.telegramType})
  - Raw Value (binario): ${this.toBinary()}`;
  }
}
