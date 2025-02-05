export interface DPT1 {
  value: boolean;
}
export interface DPT2 {
  control: 0 | 1;
  valueDpt2: 0 | 1;
}
export interface DPT3 {
  control: 0 | 1;
  stepCode: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
}
export interface DPT4 {
  char: string;
}
export interface DPT5 {
  valueDpt5: number; // 0-255
}
export interface DPT5001 {
  valueDpt5001: number; // 0-100 (Percentage)
}
export interface DPT5002 {
  valueDpt5002: number; // 0-360 (Angle)
}
export interface DPT6 {
  valueDpt6: number; // -128 to 127
}
export interface DPT6020 {
  status: 0 | 1; // 0-1 (1 bit)
  mode: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; // 0-7 (3 bits)
}
export interface DPT7 {
  valueDpt7: number; // 0-65535
}
export type AllDpts<Dpt extends (typeof KnxDataEncoder.dptEnum)[number] | null> = Dpt extends 1
  ? DPT1
  : Dpt extends 2
    ? DPT2
    : Dpt extends 3007 | 3008
      ? DPT3
      : Dpt extends 4001
        ? DPT4
        : Dpt extends 5
          ? DPT5
          : Dpt extends 5001
            ? DPT5001
            : Dpt extends 5002
              ? DPT5002
              : Dpt extends 6 | 6010
                ? DPT6
                : Dpt extends 6020
                  ? DPT6020
                  : Dpt extends 7 | 7001 | 7002 | 7003 | 7004 | 7005 | 7006 | 7007 | 7011 | 7012 | 7013
                    ? DPT7
                    : Buffer;
export class KnxDataEncoder {
  private typeErrorData = new TypeError('The object does not contain valid parameters to encode the dpt');

  encodeThis(dpt: (typeof KnxDataEncoder.dptEnum)[number], data: AllDpts<typeof dpt>): Buffer | Error {
    switch (dpt) {
      case 1:
        if ('value' in data && typeof data.value === 'boolean') return this.encodeDpt1(data as DPT1);
        break;
      case 2:
        if ('control' in data && 'valueDpt2' in data && typeof data.control === 'number' && typeof data.valueDpt2 === 'number')
          return this.encodeDpt2(data as DPT2);
        break;
      case 3007:
        if ('control' in data && 'stepCode' in data && typeof data.control === 'number' && typeof data.stepCode === 'number')
          return this.encodeDpt3007(data as DPT3);
        break;
      case 3008:
        if ('control' in data && 'stepCode' in data && typeof data.control === 'number' && typeof data.stepCode === 'number')
          return this.encodeDpt3008(data as DPT3);
        break;
      case 4001:
        if ('char' in data && typeof data.char === 'string') return this.encodeDpt4001(data as DPT4);
        break;
      case 5:
        if ('valueDpt5' in data && typeof data.valueDpt5 === 'number' && data.valueDpt5 <= 255 && data.valueDpt5 >= 0)
          return this.encodeDpt5(data as DPT5);
        break;
      case 5001:
        if ('valueDpt5001' in data && typeof data.valueDpt5001 === 'number' && data.valueDpt5001 <= 100 && data.valueDpt5001 >= 0)
          return this.encodeDpt5001(data as DPT5001);
        break;
      case 5002:
        if ('valueDpt5002' in data && typeof data.valueDpt5002 === 'number') return this.encodeDpt5002(data as DPT5002);
        break;
      case 6:
        if ('valueDpt6' in data && typeof data.valueDpt6 === 'number') return this.encodeDpt6(data as DPT6);
        break;
      case 6010:
        if ('valueDpt6' in data && typeof data.valueDpt6 === 'number') return this.encodeDpt6(data as DPT6);
        break;
      case 6020:
        if ('status' in data && 'mode' in data) return this.encodeDpt6020(data as DPT6020);
        break;
      case 7:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7(data as DPT7);
        break;
      case 7001:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7001(data as DPT7);
        break;
      case 7002:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7002(data as DPT7);
        break;
      case 7003:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7003(data as DPT7);
        break;
      case 7004:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7004(data as DPT7);
        break;
      case 7005:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7005(data as DPT7);
        break;
      case 7006:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7006(data as DPT7);
        break;
      case 7007:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7007(data as DPT7);
        break;
      case 7011:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7011(data as DPT7);
        break;
      case 7012:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7012(data as DPT7);
        break;
      case 7013:
        if ('valueDpt7' in data && typeof data.valueDpt7 === 'number') return this.encodeDpt7013(data as DPT7);
        break;
      default:
        throw this.typeErrorData;
    }
    throw this.typeErrorData;
  }
  static get dptEnum() {
    return [1, 2, 3007, 3008, 4001, 5, 5001, 5002, 6, 6001, 6010, 6020, 7, 7001, 7002, 7003, 7004, 7005, 7006, 7007, 7011, 7012, 7013] as const;
  }
  /**
   * Codifica un valor booleano en DPT1.
   * Retorna un ArrayBuffer de 1 byte.
   */
  encodeDpt1({ value }: DPT1) {
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    // Se codifica 0x01 si es true, 0x00 si es false.
    view.setUint8(0, value ? 0x01 : 0x00);
    return Buffer.from(buffer);
  }

  /**
   * Codifica DPT2, que utiliza 2 bits: un bit de control y otro de valor.
   * Los parámetros deben ser 0 o 1.
   * Retorna un ArrayBuffer de 1 byte.
   */
  encodeDpt2({ control, valueDpt2 }: DPT2) {
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    // Se codifica en los 2 bits menos significativos.
    view.setUint8(0, (control << 1) | valueDpt2);
    return Buffer.from(buffer);
  }

  /**
   * Codifica DPT3007: Formato B1U3 (4 bits).
   * - control: 0 (Decrease) o 1 (Increase)
   * - stepCode: de 0 a 7 (0 = Break; 1..7 = número de intervalos según 2^(stepCode-1))
   *
   * Retorna un ArrayBuffer de 1 byte, utilizando el nibble inferior.
   */
  encodeDpt3007({ control, stepCode }: DPT3) {
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    // El nibble se compone: bit 3 = control, bits 0-2 = stepCode.
    view.setUint8(0, (control << 3) | (stepCode & 0x07));
    return Buffer.from(buffer);
  }

  /**
   * Codifica DPT3008: Formato B1U3 para control de persianas/ventanas.
   * - control: 0 (Up) o 1 (Down)
   * - stepCode: de 0 a 7 (0 = Break; 1..7 = número de intervalos)
   *
   * Retorna un ArrayBuffer de 1 byte.
   */
  encodeDpt3008({ control, stepCode }: DPT3) {
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    view.setUint8(0, (control << 3) | (stepCode & 0x07));
    return Buffer.from(buffer);
  }

  /**
   * Codifica DPT4001: DPT_Char_ASCII.
   * Se espera un único carácter (con MSB = 0, valor entre 0 y 127).
   * Retorna un ArrayBuffer de 1 byte.
   */
  encodeDpt4001({ char }: DPT4) {
    if (char.length !== 1) {
      throw new Error('Only one character allowed');
    }
    const code = char.charCodeAt(0);
    if (code & 0x80) {
      throw new Error('Character out of ASCII range (MSB must be 0)');
    }
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    view.setUint8(0, code);
    return Buffer.from(buffer);
  }
  /**
   * DPT5: 1 byte unsigned (0…255)
   */
  encodeDpt5({ valueDpt5: value }: DPT5): Buffer {
    if (value <= 0 || value >= 255) throw new Error('DPT5 value must be between 0 and 255');
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(value, 1);
    return buffer;
  }

  /**
   * DPT5001: Percentage (0–100) codificado en escala 0–255
   */
  encodeDpt5001({ valueDpt5001: value }: DPT5001): Buffer {
    const encodedValue = Math.round((value / 100) * 255);
    return this.encodeDpt5({ valueDpt5: encodedValue });
  }

  /**
   * DPT5002: Angle (0–360°) codificado en escala 0–255
   */
  encodeDpt5002({ valueDpt5002: value }: DPT5002): Buffer {
    const encodedValue = Math.round((value / 360) * 255);
    return this.encodeDpt5({ valueDpt5: encodedValue });
  }

  /**
   * DPT6: 1 byte signed (-128…127)
   */
  encodeDpt6({ valueDpt6: value }: DPT6): Buffer {
    if (value < -128 || value > 127) throw new Error('DPT6 value must be between -128 and 127');
    const buffer = Buffer.alloc(2);
    buffer.writeInt8(value, 1);
    return buffer;
  }

  /**
   * DPT6001: Se codifica igual que DPT6 (por ejemplo, porcentaje expresado en valor numérico)
   */
  encodeDpt6001({ valueDpt6: value }: DPT6): Buffer {
    return this.encodeDpt6({ valueDpt6: value });
  }

  /**
   * DPT6010: Counter pulses, codificado igual que DPT6
   */
  encodeDpt6010({ valueDpt6: value }: DPT6): Buffer {
    return this.encodeDpt6({ valueDpt6: value });
  }

  /**
   * DPT6020: Estado y modo en 1 byte:
   * Los 5 bits superiores (status) y los 3 bits inferiores (mode)
   */
  encodeDpt6020({ status, mode }: DPT6020): Buffer {
    const byte = (status << 3) | (mode & 0b111);
    return Buffer.from([byte]);
  }

  /**
   * DPT7: 2-byte unsigned (0…65535)
   */
  encodeDpt7({ valueDpt7: value }: DPT7): Buffer {
    if (value <= 0 || value >= 65535) throw new Error('DPT7 value must be between 0 and 65535');
    const buffer = Buffer.alloc(3);
    buffer.writeUInt16BE(value, 2);
    return buffer;
  }

  /**
   * DPT7001: Pulses (igual que DPT7)
   */
  encodeDpt7001(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7002: Time in ms (igual que DPT7)
   */
  encodeDpt7002(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7003: Time in seconds (valor en segundos escalado multiplicando por 100)
   */
  encodeDpt7003({ valueDpt7: value }: DPT7): Buffer {
    const scaled = Math.round(value * 100);
    return this.encodeDpt7({ valueDpt7: scaled });
  }

  /**
   * DPT7004: Time in seconds (valor en segundos escalado multiplicando por 10)
   */
  encodeDpt7004({ valueDpt7: value }: DPT7): Buffer {
    const scaled = Math.round(value * 10);
    return this.encodeDpt7({ valueDpt7: scaled });
  }

  /**
   * DPT7005: Time in seconds (igual que DPT7)
   */
  encodeDpt7005(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7006: Time in minutes (igual que DPT7)
   */
  encodeDpt7006(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7007: Time in hours (igual que DPT7)
   */
  encodeDpt7007(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7011: Distance in mm (igual que DPT7)
   */
  encodeDpt7011(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7012: Bus power supply current in mA (igual que DPT7)
   */
  encodeDpt7012(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7013: Light intensity in lux (igual que DPT7)
   */
  encodeDpt7013(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }
}
