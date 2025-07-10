import { FrameKind, FrameType, Priority } from "./enum/KNXEnumControlField";
/**
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "KNX Standard Communication Media Twisted Pair 1"
 */
/**
 * Clase que maneja el Control Field en TP1 según la figura 28.
 * - L_Data-Frame:   FT 0 r 1 p1 p0 0 0
 * - L_Poll_Data:    1 1 1 1 0 0 0 0 (0xF0)
 * - Acknowledgement x x 0 0 x x 0 0 (patrón parcial)
 */
export class KNXTP1ControlField {
  private _value: number;
  private _kind: FrameKind = FrameKind.L_DATA_FRAME; // Por defecto

  constructor(value: number = 0) {
    if (value < 0 || value > 255) {
      throw new Error("ControlField debe ser un valor de 0 a 255 (8 bits)");
    }
    this._value = value & 0xFF;
  }

  static from(frameKind: FrameKind, frameType: FrameType, repeat: boolean, priority: Priority) {
    const instance = new KNXTP1ControlField()
    instance.frameKind = frameKind
    instance.frameType = frameType
    instance.repeat = repeat
    instance.priority = priority
    return instance
  }

  /**
   * Establece o devuelve el tipo de Frame:
   * - L_DATA_FRAME
   * - L_POLL_DATA_FRAME
   * - ACKNOWLEDGEMENT_FRAME
   *
   * Al asignar un nuevo tipo, se ajustan los bits del Control Field
   * según la figura 28.
   */
  get frameKind(): FrameKind {
    return this._kind;
  }

  set frameKind(kind: FrameKind) {
    this._kind = kind;

    switch (kind) {
      case FrameKind.L_DATA_FRAME:
        // Según figura 28: FT 0 r 1 p1 p0 0 0
        // bit7 = FT
        // bit6 = 0 (fijo para L_Data)
        // bit5 = r (repetición)
        // bit4 = 1 (fijo en L_Data)
        // bits3..2 = p1 p0 (prioridad)
        // bits1..0 = 0 0
        // Por ahora, forzamos bit6=0, bit4=1, bits1..0=0, y dejamos bit5 (repeat) y bits3..2 (priority) configurables
        // => 1 0 ? 1 ? ? 0 0

        // Limpiamos todo y aplicamos la máscara base: 10010000 (0x90)
        // bit7=1, bit6=0, bit5=0, bit4=1, bits3..2=0, bits1..0=0
        this._value = 0x90;
        break;

      case FrameKind.L_POLL_DATA_FRAME:
        // Según figura 28: 1 1 1 1 0 0 0 0 = 0xF0
        // Este frame no permite priorizar ni repetir según la tabla.
        this._value = 0xF0;
        break;

      case FrameKind.ACKNOWLEDGEMENT_FRAME:
        // Según figura 28: x x 0 0 x x 0 0 => varios patrones
        // Ejemplo: si quisiéramos un ack "genérico", podemos forzar bits5..4=00, bits1..0=00
        // y dejar bits7..6 y bits3..2 como "x x x"
        // Tomaremos un valor por defecto, e.g. 0x0C (0000 1100) => un NAK
        // o 0xCC (1100 1100) => un ACK
        // Esto varía según tu implementación. Aquí elegimos 0xCC como "ACK" por defecto.
        this._value = 0xCC;
        break;
    }
  }

  /**
 * Indica si el Frame es L_Data_Standard (bit 7 = 1) o L_Data_Extended (bit 7 = 0).
 * Al asignar `true`, se fuerza la codificación de bits para un L_Data_Standard Frame:
 *  - bit7 = 1
 *  - bit6 = 0
 *  - bit5 se mantiene (repeat)
 *  - bit4 = 1
 *  - bits3-2 = priority
 *  - bits1-0 = 0
 */
  get frameType(): FrameType {
    return ((this._value >> 7) & 0b1) === 1
      ? FrameType.STANDARD
      : FrameType.EXTENDED;
  }

  set frameType(isStandard: FrameType) {
    if (this._kind !== FrameKind.L_DATA_FRAME) return;
    if (isStandard === FrameType.STANDARD) {
      // bit7 = 1
      this._value |= 0b10000000;
    } else {
      // bit7 = 0 → L_Data_Extended
      this._value &= 0b01111111;
    }
  }

  /**
   * Repetición (solo aplica en L_DATA_FRAME).
   * bit5 => 0 = repeated, 1 = not repeated
   */
  get repeat(): boolean {
    // bit5 => SHIFT 5 y mask 1
    return ((this._value >> 5) & 0b1) === 1;
  }

  set repeat(notRepeated: boolean) {
    if (this._kind !== FrameKind.L_DATA_FRAME) {
      // No aplica en poll data ni ack
      return;
    }
    if (notRepeated) {
      this._value |= 0b00100000; // bit5=1
    } else {
      this._value &= 0b11011111; // bit5=0
    }
  }

  /**
   * Prioridad (solo aplica en L_DATA_FRAME).
   * bits3..2 => p1 p0
   * 00 = system, 10 = urgent, 01 = normal, 11 = low
   */
  get priority(): Priority {
    if (this._kind !== FrameKind.L_DATA_FRAME) {
      // No aplica en poll data ni ack, devolvemos un default
      return Priority.SYSTEM;
    }
    return (this._value >> 2) & 0b11;
  }

  set priority(p: Priority) {
    if (this._kind !== FrameKind.L_DATA_FRAME) {
      return;
    }
    // Limpia bits3..2 pero PRESERVA bit4
    this._value &= 0b11110011;
    // Asigna p1..p0 en bits3..2
    this._value |= (p & 0b11) << 2;
  }

  get lastTwoBits(): number {
    // bits1..0
    return this._value & 0b11;
  }

  set lastTwoBits(val: 0 | 1 | 2 | 3) {
    // Limpia bits1..0
    this._value &= 0b11111100;
    // Asigna los últimos dos bits
    this._value |= (val & 0b11);
  }

  /**
   * Valor bruto de 8 bits
   */
  get rawValue(): number {
    return this._value;
  }

  set rawValue(val: number) {
    this._value = val & 0xFF;
  }

  /**
   * Obtiene el buffer (1 octeto) del control field
   */
  get buffer(): Buffer {
    return Buffer.from([this._value]);
  }

  /**
   * Describe los bits según el frameKind
   */
  describe() {
    const valuesInHex = this._value.toString(16).toUpperCase().split("")
    const valuesInBinary = this.toBinary().split("")
    switch (this._kind) {
      case FrameKind.L_DATA_FRAME:
        return `L_Data-Frame (Figura 28: FT 0 r 1 p1 p0 0 0):
        Bits: ${this.toBinary()}
        => bit7 = 1, bit6 = 0, bit5 = ${this.repeat ? 1 : 0}, bit4 = 1, bits3..2 = ${this.priority}, bits1..0 = 00
        => repeated=${!this.repeat}, priority=${Priority[this.priority]}
        => raw=0x${this._value.toString(16).toUpperCase()}
        `;
      case FrameKind.L_POLL_DATA_FRAME:
        return `L_Poll_Data-Frame:
        Bits: ${this.toBinary()} (0xF0)
        => Neither repeat nor priority are configured
        => raw=0x${this._value.toString(16).toUpperCase()}
        `;
      case FrameKind.ACKNOWLEDGEMENT_FRAME:
        return `Acknowledgement Frame:
        Bits: ${this.toBinary()}
        => La figura 28 indica bits5..4 = 00 y bits1..0 = 00, con bits7..6 y bits3..2 variables.
        => raw=0x${this._value.toString(16).toUpperCase()}
        `;
      default:
        return console.error("FrameKind unknown")
    }
  }

  /**
   * Construye un ControlField desde un buffer
   */
  static fromBuffer(buf: Buffer): KNXTP1ControlField {
    if (buf.length < 1) {
      throw new Error("Se requiere al menos 1 octeto");
    }
    const cf = new KNXTP1ControlField(buf[0]);

    // Deducción básica del frameKind según la figura 28
    if (buf[0] === 0xF0) {
      cf._kind = FrameKind.L_POLL_DATA_FRAME;
    } else if ((buf[0] & 0b00110011) === 0) {
      // bits5..4=00, bits1..0=00 => probable ack
      cf._kind = FrameKind.ACKNOWLEDGEMENT_FRAME;
    } else {
      cf._kind = FrameKind.L_DATA_FRAME;
    }

    return cf;
  }

  /**
   * Muestra los bits en binario (8 bits)
   */
  toBinary(): string {
    return this._value.toString(2).padStart(8, '0');
  }
}
