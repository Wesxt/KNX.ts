/**
 * Represents KNX DPTs (Data Point Types), decodes them according to their specification
 */
export class KnxDataDecode {
  private constructor() {
    throw new Error("This class is static and cannot be instantiated.");
  }

  static decodeThis(dpt: typeof KnxDataDecode.dptEnum[number], buffer: Buffer) {
    switch (dpt) {
      case 1:
        return this.asDpt1(buffer);
        break;
      case 2:
        return this.asDpt2(buffer);
        break;
      case 3007:
        return this.asDpt3007(buffer);
        break;
      case 3008:
        return this.asDpt3008(buffer);
        break;
      case 4001:
        return this.asDpt4001(buffer);
        break;
      case 4002:
        return this.asDpt4002(buffer);
        break;
      case 5:
        return this.asDpt5(buffer);
        break;
      case 5001:
        return this.asDpt5001(buffer);
        break;
      case 5002:
        return this.asDpt5002(buffer);
      case 6:
        return this.asDpt6(buffer);
        break;
      case 6001:
        return this.asDpt6001(buffer);
        break;
      case 6010:
        return this.asDpt6010(buffer);
        break;
      case 6020:
        return this.asDpt6020(buffer);
        break;
      case 7:
        return this.asDpt7(buffer);
        break;
      case 7001:
        return this.asDpt7001(buffer);
        break;
      case 7002:
        return this.asDpt7002(buffer);
        break;
      case 7003:
        return this.asDpt7003(buffer);
        break;
      case 7004:
        return this.asDpt7004(buffer);
        break;
      case 7005:
        return this.asDpt7005(buffer);
        break;
      case 7006:
        return this.asDpt7006(buffer);
        break;
      case 7007:
        return this.asDpt7007(buffer);
        break;
      case 7011:
        return this.asDpt7011(buffer);
        break;
      case 7012:
        return this.asDpt7012(buffer);
        break;
      case 7013:
        return this.asDpt7013(buffer);
        break;
      case 8:
        return this.asDpt8(buffer);
        break;
      case 9:
        return this.asDpt9(buffer);
        break;
      case 10001:
        return this.asDpt10001(buffer);
        break;
      case 11001:
        return this.asDpt11001(buffer);
        break;
      case 12001:
        return this.asDpt12001(buffer);
        break;
      case 12002:
        return this.asDpt12002(buffer);
        break;
      case 13:
        return this.asDpt13(buffer);
        break;
      case 13001:
        return this.asDpt13001(buffer);
        break;
      case 13002:
        return this.asDpt13002(buffer);
        break;
      case 13010:
        return this.asDpt13010(buffer);
        break;
      case 13011:
        return this.asDpt13011(buffer);
        break;
      case 13012:
        return this.asDpt13012(buffer);
        break;
      case 13013:
        return this.asDpt13013(buffer);
        break;
      case 13014:
        return this.asDpt13014(buffer);
        break;
      case 13015:
        return this.asDpt13015(buffer);
        break;
      case 13016:
        return this.asDpt13016(buffer);
        break;
      case 13100:
        return this.asDpt13100(buffer);
      case 14:
        return this.asDpt14(buffer);
        break;
      case 15000:
        return this.asDpt15000(buffer);
        break;
      case 16:
        return this.asDpt16(buffer);
        break;
      case 16002:
        return this.asDpt16002(buffer);
        break;
      case 20:
        return this.asDpt20(buffer);
        break;
      case 20001:
        return this.asDpt20001(buffer);
        break;
      case 20002:
        return this.asDpt20002(buffer);
        break;
      case 20003:
        return this.asDpt20003(buffer);
        break;
      case 20004:
        return this.asDpt20004(buffer);
        break;
      case 20005:
        return this.asDpt20005(buffer);
        break;
      case 20006:
        return this.asDpt20006(buffer);
        break;
      case 20007:
        return this.asDpt20007(buffer);
        break;
      case 20008:
        return this.asDpt20008(buffer);
        break;
      case 20011:
        return this.asDpt20011(buffer);
        break;
      case 20012:
        return this.asDpt20012(buffer);
        break;
      case 20013:
        return this.asDpt20013(buffer);
        break;
      case 20014:
        return this.asDpt20014(buffer);
        break;
      case 20017:
        return this.asDpt20017(buffer);
        break;
      case 20020:
        return this.asDpt20020(buffer);
        break;
      case 20021:
        return this.asDpt20021(buffer);
        break;
      case 20022:
        return this.asDpt20022(buffer);
        break;
      case 27001:
        return this.asDpt27001(buffer);
        break;
      case 28001:
        return this.asDpt28001(buffer);
        break;
      case 29:
        return this.asDpt29(buffer);
        break;
      case 29010:
        return this.asDpt29010(buffer);
        break;
      case 29011:
        return this.asDpt29011(buffer);
        break;
      case 29012:
        return this.asDpt29012(buffer);
        break;
      case 232600:
        return this.asDpt232600(buffer);
        break;
      case 238600:
        return this.asDpt238600(buffer);
        break;
      case 245600:
        return this.asDpt245600(buffer);
        break;
      case 250600:
        return this.asDpt250600(buffer);
        break;
      case 251600:
        return this.asDpt251600(buffer);
        break;
      default:
        throw new Error("The indicated dpt is not listed for decoding or the data provided is invalid");
    }
  }
  static get dptEnum() {
    return [1, 2, 3007, 3008, 4001, 4002, 5, 5001, 5002, 6, 6001, 6010, 6020, 7, 7001, 7002, 7003, 7004, 7005, 7006, 7007, 7011, 7012, 7013, 8, 9, 10001, 11001, 12001, 12002, 13, 13001, 13002, 13010, 13011, 13012, 13013, 13014, 13015, 13016, 13100, 14, 15000, 16, 16002, 20, 20001, 20002, 20003, 20004, 20005, 20006, 20007, 20008, 20011, 20012, 20013, 20014, 20017, 20020, 20021, 20022, 27001, 28001, 29, 29010, 29011, 29012, 232600, 238600, 245600, 250600, 251600] as const;
  }

  private static toPercentage(value: number) {
    return (value / 255) * 100 + '%';
  }
  private static toAngle(value: number) {
    return (value / 255) * 360 + 'ª';
  }
  /**
   * Interpret the underlying data as boolean value
   * @returns
   */
  static asDpt1(buffer: Buffer) {
    // 0x3F = 0011 1111
    const data = 0x3f & buffer[0];
    return data != 0;
  }
  /**
   * Interpretar la información del DPT2 (B2) y devolver un objeto con los campos:
   * - control (c): 0 o 1
   * - value (v): 0 o 1
   * - description: descripción basada en la combinación de bits
   *
   * Los datos se encuentran en el primer octeto (buffer[0]), y solo se toman en cuenta los dos bits menos significativos.
   */
  static asDpt2(buffer: Buffer) {
    // Extraer los dos bits menos significativos del primer octeto.
    const raw = buffer[0] & 0x03;
    const c = (raw >> 1) & 0x01; // Bit de control
    const v = raw & 0x01; // Bit de valor

    let description = '';
    // Según la combinación de bits, asignamos una descripción:
    // - c = 0: sin control.
    //   - v = 0: DPT_Enable_Control (2.003)
    //   - v = 1: DPT_Ramp_Control (2.004)
    // - c = 1: con control.
    //   - v = 0: DPT_Alarm_Control (2.005)
    //   - v = 1: DPT_BinaryValue_Control (2.006)
    if (c === 0) {
      if (v === 0) {
        description = 'No control (DPT_Enable_Control)';
      } else {
        description = 'No control (DPT_Ramp_Control)';
      }
    } else {
      // c === 1
      if (v === 0) {
        description = 'Control. Function value 0 (DPT_Alarm_Control)';
      } else {
        description = 'Control. Function value 1 (DPT_BinaryValue_Control)';
      }
    }

    return {
      control: c,
      value: v,
      description: description,
    };
  }
  /**
   * Interpretar la información del DPT3007 (B1U3) y devolver un objeto con:
   * - control: 0 (Decrease) o 1 (Increase)
   * - stepCode: valor de 3 bits (0…7)
   * - action: descripción de la acción (Decrease o Increase)
   * - description: "Break" si stepCode es 0 o el detalle de step con el número de intervalos
   *
   * Se asume que el dato se encuentra en el primer octeto útil, es decir, en buffer[0].
   * Como la información es de 4 bits, se toma el nibble inferior del byte.
   */
  static asDpt3007(buffer: Buffer) {
    // Extraemos el nibble inferior del byte en buffer[0].
    // El formato es: c StepCode, donde:
    // - c es el bit más significativo del nibble (bit 3) y
    // - StepCode son los 3 bits menos significativos (bits 0-2).
    const rawNibble = buffer[0] & 0x0f;
    const control = (rawNibble >> 3) & 0x01; // Extrae el bit c.
    const stepCode = rawNibble & 0x07; // Extrae los 3 bits de StepCode.
    // Determinar la acción según el bit de control.
    const action = control === 0 ? 'Decrease' : 'Increase';
    // Descripción basada en el valor de StepCode:
    // - Si StepCode es 0, se interpreta como "Break".
    // - Si StepCode es 1..7, se calcula el número de intervalos como 2^(stepCode - 1)
    let description = '';
    if (stepCode === 0) {
      description = 'Break';
    } else {
      const intervals = Math.pow(2, stepCode - 1);
      description = `StepCode ${stepCode} (Intervals: ${intervals})`;
    }
    return {
      control, // 0: Decrease, 1: Increase.
      stepCode, // Valor del StepCode (0...7).
      action, // Descripción breve: "Decrease" o "Increase".
      description, // Descripción completa: "Break" o detalle del step.
    };
  }
  /**
   * Interpretar la información del DPT3008 (DPT_Control_Blinds).
   * Se asume que los datos se encuentran en el primer octeto de la carga útil.
   *
   * Formato: 4 bit: B1U3
   * Campos:
   *  - c: 1 bit (0 = Up, 1 = Down)
   *  - stepCode: 3 bits
   *
   * Retorna un objeto con:
   *  - control: 0 o 1
   *  - stepCode: valor numérico de 0 a 7
   *  - description: texto descriptivo (p.ej. "Up" o "Down")
   *  - intervals: Si stepCode es distinto de 0, se calcula como 2^(stepCode - 1), o bien se indica "Break" si es 0.
   */
  static asDpt3008(buffer: Buffer) {
    const byte = buffer.readUInt8(0);
    // Extraer el nibble inferior (4 bits)
    const nibble = byte & 0x0f;
    // Extraer el bit de control (c) y el StepCode (3 bits)
    const control = (nibble >> 3) & 0x01; // Bit más significativo del nibble
    const stepCode = nibble & 0x07; // Los 3 bits menos significativos
    // Determinar la descripción y el número de intervalos
    const description = control === 0 ? 'Move Up' : 'Move Down';
    const intervals = stepCode === 0 ? 'Break indication' : Math.pow(2, stepCode - 1);
    return {
      control: control,
      stepCode: stepCode,
      description: description,
      intervals: intervals,
    };
  }
  /**
   * Interpreta la información del DPT4001 (DPT_Char_ASCII).
   * Se asume que el dato se encuentra en el primer octeto de la carga útil.
   *
   * - Valida que el MSB sea 0 (valor en el rango 0...127).
   * - Retorna el carácter ASCII correspondiente.
   */
  static asDpt4001(buffer: Buffer) {
    const value = buffer.readUInt8(0);
    // Validación: el MSB debe ser 0 para un carácter ASCII
    if (value & 0x80) {
      throw new Error(`Valor inválido para DPT4001: ${value}. El MSB debe ser 0.`);
    }

    return String.fromCharCode(value);
  }
  /**
   * Interpreta la información del DPT4002 (DPT_Char_8859_1).
   * Se asume que el dato se encuentra en el primer octeto de la carga útil.
   *
   * - No se impone restricción en el MSB (valor en el rango 0...255).
   * - Retorna el carácter correspondiente en ISO-8859-1.
   */
  static asDpt4002(buffer: Buffer) {
    const value = buffer.readUInt8(0);
    return String.fromCharCode(value);
  }

  /**
   * Interpret the underlying data as 1 Byte unsigned value
   * @returns
   */
  static asDpt5(buffer: Buffer) {
    return buffer.readUInt8(0);
  }
  static asDpt5001(buffer: Buffer) {
    return this.toPercentage(this.asDpt5(buffer));
  }
  static asDpt5002(buffer: Buffer) {
    return this.toAngle(this.asDpt5(buffer));
  }
  static asDpt6(buffer: Buffer) {
    return buffer.readInt8(0);
  }
  static asDpt6001(buffer: Buffer) {
    return this.asDpt6(buffer) + '%';
  }
  static asDpt6010(buffer: Buffer) {
    return this.asDpt6(buffer) + ' counter pulses';
  }
  static asDpt6020(buffer: Buffer) {
    // Extraer los primeros 5 bits (estado) de la primera posición
    const status = buffer.readUInt8(0) >> 3; // Desplazamos 3 bits a la derecha para obtener los primeros 5 bits
    // Extraer los últimos 3 bits (modo) de la primera posición
    const mode = buffer.readUInt8(0) & 0b111; // Usamos una máscara para obtener los últimos 3 bits
    // Asignar el modo (1: Modo 0, 2: Modo 1, 3: Modo 2)
    let modeText = '';
    switch (mode) {
      case 0b001:
        modeText = 'Modo 0 activo';
        break;
      case 0b010:
        modeText = 'Modo 1 activo';
        break;
      case 0b100:
        modeText = 'Modo 2 activo';
        break;
      default:
        modeText = 'Modo desconocido';
    }
    // Devolver los resultados como un objeto con estado y modo
    return {
      status: status === 1 ? 'Activo' : 'Inactivo', // Si el bit de estado es 1, es activo
      mode: modeText,
    };
  }
  static asDpt7(buffer: Buffer) {
    if (buffer.length === 1) {
      return buffer.readUInt8(0);
    } else {
      return buffer.readUInt16BE(0);
    }
  }
  static asDpt7001(buffer: Buffer) {
    const data = this.asDpt7(buffer);
    return data + 'pulses';
  }
  static asDpt7002(buffer: Buffer) {
    return this.asDpt7(buffer) + 'ms';
  }
  static asDpt7003(buffer: Buffer) {
    return this.asDpt7(buffer) / 100 + 's';
  }
  static asDpt7004(buffer: Buffer) {
    return this.asDpt7(buffer) / 10 + 's';
  }
  static asDpt7005(buffer: Buffer) {
    return this.asDpt7(buffer) + 's';
  }
  static asDpt7006(buffer: Buffer) {
    return this.asDpt7(buffer) + 'min';
  }
  static asDpt7007(buffer: Buffer) {
    return this.asDpt7(buffer) + 'h';
  }
  static asDpt7011(buffer: Buffer) {
    return this.asDpt7(buffer) + 'mm';
  }
  static asDpt7012(buffer: Buffer) {
    const data = this.asDpt7(buffer);
    if (data === 0) {
      return {
        value: data,
        status: 'No bus power supply functionality available',
      };
    } else {
      return {
        value: data + 'mA',
        status: '',
      };
    }
  }
  static asDpt7013(buffer: Buffer) {
    return this.asDpt7(buffer) + 'lux';
  }
  static asDpt8(buffer: Buffer) {
    return buffer.readInt16BE(0);
  }
  /**
   * Decodifica un DPT9 (2-octetos) según la especificación KNX:
   *   FloatValue = 0.01 * M * 2^(E)
   *   E (4 bits) = [0…15]
   *   M (12 bits, en complemento a dos) = [-2048 … 2047]
   * Si el valor codificado es 0x7FFF, se considera inválido.
   *
   * @returns El valor en punto flotante.
   */
  static asDpt9(buffer: Buffer): number {
    const raw = buffer.readUInt16BE(0);

    // Si el valor es 0x7FFF, se considera dato inválido.
    if (raw === 0x7fff) {
      throw new Error('DPT9: Invalid data (0x7FFF encountered)');
    }

    // Extraer el exponente (4 bits superiores)
    const exponent = (raw >> 12) & 0x0f;
    // Extraer la mantisa (12 bits inferiores)
    let mantissa = raw & 0x0fff;

    // Interpretar la mantisa como un entero de 12 bits con signo:
    if (mantissa & 0x0800) {
      // Si el bit de signo (bit 11) está a 1
      mantissa = mantissa - 4096;
    }

    // Calcular el valor real:
    const value = 0.01 * mantissa * Math.pow(2, exponent);
    return value;
  }

  /**
   * Interpreta la información del DPT 10001 (Time of Day).
   * Se asume que la carga útil contiene 3 octetos codificados según:
   *
   * Octeto 1: NNNUUUUU -> 3 bits para el Día y 5 bits para la Hora.
   * Octeto 2: rrUUUUUU -> 6 bits para los Minutos (dos bits reservados).
   * Octeto 3: rrUUUUUU -> 6 bits para los Segundos (dos bits reservados).
   *
   * Retorna un objeto con:
   *   - day: número del día (0 = no day, 1 = lunes, …, 7 = domingo)
   *   - dayName: nombre del día (o "No day")
   *   - hour: hora (0...23)
   *   - minutes: minutos (0...59)
   *   - seconds: segundos (0...59)
   */
  static asDpt10001(buffer: Buffer) {
    if (buffer.length < 3) {
      throw new Error('No hay suficientes datos para DPT10001');
    }
    // Octeto 1: Día y Hora
    const byte0 = buffer.readUInt8(0);
    const day = (byte0 >> 5) & 0x07; // Extrae los 3 bits superiores
    const hour = byte0 & 0x1f; // Extrae los 5 bits inferiores
    // Octeto 2: Minutos (6 bits)
    const byte1 = buffer.readUInt8(1);
    const minutes = byte1 & 0x3f; // Máscara 0011 1111
    // Octeto 3: Segundos (6 bits)
    const byte2 = buffer.readUInt8(2);
    const seconds = byte2 & 0x3f; // Máscara 0011 1111
    // Opcional: conversión del número del día a nombre
    const days: { [key: number]: string; } = {
      0: 'No day',
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday',
      7: 'Sunday',
    };
    return {
      day: day,
      dayName: days[day] || 'Unknown',
      hour: hour,
      minutes: minutes,
      seconds: seconds,
    };
  }
  /**
   * Interpreta la información del DPT 11001 (Date).
   * Se asume que la carga útil contiene 3 octetos codificados según:
   *
   * Octeto 1: r3U5 => Day: 5 bits (bits [4:0])
   * Octeto 2: r4U4 => Month: 4 bits (bits [3:0])
   * Octeto 3: r1U7 => Year: 7 bits (bits [6:0])
   *
   * La interpretación del año es:
   *   - Si el valor es >= 90: año = 1900 + valor (siglo XX)
   *   - Si el valor es < 90:  año = 2000 + valor (siglo XXI)
   *
   * Retorna un objeto con los campos day, month, year y una cadena formateada.
   */
  static asDpt11001(buffer: Buffer) {
    if (buffer.length < 3) {
      throw new Error('No hay suficientes datos para DPT11001');
    }
    // Octeto 1: Extraer el día (los 5 bits menos significativos)
    const byte0 = buffer.readUInt8(0);
    const day = byte0 & 0x1f; // 0x1F equivale a 0001 1111
    // Octeto 2: Extraer el mes (los 4 bits menos significativos)
    const byte1 = buffer.readUInt8(1);
    const month = byte1 & 0x0f; // 0x0F equivale a 0000 1111
    // Octeto 3: Extraer el año (los 7 bits menos significativos)
    const byte2 = buffer.readUInt8(2);
    const rawYear = byte2 & 0x7f; // 0x7F equivale a 0111 1111
    // Interpretar el siglo:
    // Si rawYear >= 90 => 1900 + rawYear (siglo XX: 1990-1999)
    // Si rawYear < 90  => 2000 + rawYear (siglo XXI: 2000-2089)
    const century = rawYear >= 90 ? 1900 : 2000;
    const year = century + rawYear;
    return {
      day,
      month,
      year,
      // Formateamos la fecha en formato DD/MM/YYYY
      dateString: `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`,
    };
  }
  /**
   * Interpreta la información del DPT 12.001 (4-Octet Unsigned Value para counter pulses).
   * Se asume que la carga útil contiene 4 octetos.
   *
   * @returns Un objeto con el valor sin signo y la unidad ("pulses").
   */
  static asDpt12001(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 12.001');
    }
    const value = buffer.readUInt32BE(0);
    return {
      value,
      unit: 'pulses',
    };
  }
  /**
   * Interpreta la información de los DPT LongTimePeriod (12.100, 12.101, 12.102) para operating hours.
   * Se asume que la carga útil contiene 4 octetos.
   *
   * @param variant Puede ser:
   *   - "sec" para DPT_LongTimePeriod_Sec (12.100, segundos),
   *   - "min" para DPT_LongTimePeriod_Min (12.101, minutos),
   *   - "hrs" para DPT_LongTimePeriod_Hrs (12.102, horas).
   *   Por defecto se usa "sec".
   *
   * @returns Un objeto con el valor sin signo y la unidad seleccionada.
   */
  static asDpt12002(buffer: Buffer, variant: 'sec' | 'min' | 'hrs' = 'sec') {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para el DPT LongTimePeriod');
    }
    const value = buffer.readUInt32BE(0);
    let unit: string;
    switch (variant) {
      case 'sec':
        unit = 's';
        break;
      case 'min':
        unit = 'min';
        break;
      case 'hrs':
        unit = 'h';
        break;
    }
    return {
      value,
      unit,
    };
  }
  /**
   * Interpret the underlying data as 4 byte signed integer
   * @returns
   */
  static asDpt13(buffer: Buffer) {
    return buffer.readInt32BE(0);
  }
  /**
   * DPT 13.001: DPT_Value_4_Count
   * Interpreta un contador de pulsos (valor de 4 octetos con signo).
   */
  static asDpt13001(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.001');
    }
    const value = buffer.readInt32BE(0);
    return {
      value,
      unit: 'pulses',
    };
  }
  /**
   * DPT 13.002: DPT_FlowRate_m3/h
   * Interpreta el flujo en m³/h (valor de 4 octetos con signo) con alta resolución.
   */
  static asDpt13002(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.002');
    }
    const rawValue = buffer.readInt32BE(0);
    const value = rawValue * 0.0001;
    return {
      value,
      unit: 'm³/h',
    };
  }
  /**
   * DPT 13.010: DPT_ActiveEnergy
   * Interpreta la energía activa en Wh.
   */
  static asDpt13010(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.010');
    }
    const value = buffer.readInt32BE(0);
    return {
      value,
      unit: 'Wh',
    };
  }
  /**
   * DPT 13.011: DPT_ApparantEnergy
   * Interpreta la energía aparente en VAh.
   */
  static asDpt13011(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.011');
    }
    const value = buffer.readInt32BE(0);
    return {
      value,
      unit: 'VAh',
    };
  }
  /**
   * DPT 13.012: DPT_ReactiveEnergy
   * Interpreta la energía reactiva en VARh.
   */
  static asDpt13012(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.012');
    }
    const value = buffer.readInt32BE(0);
    return {
      value,
      unit: 'VARh',
    };
  }
  /**
   * DPT 13.013: DPT_ActiveEnergy_kWh
   * Interpreta la energía activa en kWh.
   */
  static asDpt13013(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.013');
    }
    const value = buffer.readInt32BE(0);
    return {
      value,
      unit: 'kWh',
    };
  }
  /**
   * DPT 13.014: DPT_ApparantEnergy_kVAh
   * Interpreta la energía aparente en kVAh.
   */
  static asDpt13014(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.014');
    }
    const value = buffer.readInt32BE(0);
    return {
      value,
      unit: 'kVAh',
    };
  }
  /**
   * DPT 13.015: DPT_ReactiveEnergy_kVARh
   * Interpreta la energía reactiva en kVARh.
   */
  static asDpt13015(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.015');
    }
    const value = buffer.readInt32BE(0);
    return {
      value,
      unit: 'kVARh',
    };
  }
  /**
   * DPT 13.016: DPT_ActiveEnergy_MWh
   * Interpreta la energía activa en MWh.
   */
  static asDpt13016(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.016');
    }
    const value = buffer.readInt32BE(0);
    return {
      value,
      unit: 'MWh',
    };
  }
  /**
   * DPT 13.100: DPT_LongDeltaTimeSec
   * Interpreta un periodo de tiempo en segundos.
   */
  static asDpt13100(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 13.100');
    }
    const value = buffer.readInt32BE(0);
    return {
      value,
      unit: 's',
    };
  }

  /**
   * Interpret the underlying data as 4 byte floating point number
   */
  static asDpt14(buffer: Buffer) {
    return buffer.readFloatBE(0);
  }
  /**
   * DPT 15.000: DPT_Access_Data
   * Decodifica un valor de 4 bytes con información de acceso.
   */
  static asDpt15000(buffer: Buffer) {
    if (buffer.length < 4) {
      throw new Error('No hay suficientes datos para DPT 15.000 (Access Data).');
    }
    const d6 = buffer.readUInt8(0); // Octeto 4
    const d5 = (buffer.readUInt8(1) & 0b11110000) >> 4;
    const d4 = buffer.readUInt8(1) & 0b00001111;
    const d3 = (buffer.readUInt8(2) & 0b11110000) >> 4;
    const d2 = buffer.readUInt8(2) & 0b00001111;
    const d1 = (buffer.readUInt8(3) & 0b11110000) >> 4;
    const e = (buffer.readUInt8(3) & 0b00001000) !== 0;
    const p = (buffer.readUInt8(3) & 0b00000100) !== 0;
    const d = (buffer.readUInt8(3) & 0b00000010) !== 0;
    const c = (buffer.readUInt8(3) & 0b00000001) !== 0;
    const index = buffer.readUInt8(3) & 0b00001111;
    return {
      accessCode: `${d6}${d5}${d4}${d3}${d2}${d1}`,
      error: e,
      permission: p,
      readDirection: d,
      encryption: c,
      index: index,
    };
  }
  /**
   * DPT 16.000 / 16.001: DPT_String
   * Decodifica una cadena de 14 bytes en ASCII o ISO-8859-1.
   */
  static asDpt16(buffer: Buffer) {
    if (buffer.length < 14) {
      throw new Error('Datos insuficientes para DPT 16 (String).');
    }
    let str = '';
    for (let i = 0; i < 14; i++) {
      const charCode = buffer.readUInt8(i);
      if (charCode === 0x00) break; // Ignorar caracteres NULL
      str += String.fromCharCode(charCode);
    }
    return str;
  }
  /**
   * Decodifica un buffer de 14 bytes en formato hexadecimal (DPT 16.002).
   * (No oficial en la especificacion del DataPointType de Knx en la version 02.02.01)
   */
  static asDpt16002(buffer: Buffer) {
    if (buffer.length < 14) {
      throw new Error('Datos insuficientes para DPT 16.002 (Se esperan 14 bytes).');
    }
    let hexString = '';
    let decimalValue = BigInt(0);
    for (let i = 0; i < 14; i++) {
      if (buffer.readUInt8(i) === 0x00) break; // Ignorar caracteres NULL
      hexString += buffer.readUInt8(i).toString(16).padStart(2, '0').toUpperCase();
    }
    if (hexString) {
      decimalValue = BigInt('0x' + hexString); // Convertir de Hex a Decimal
    }
    return { hex: hexString, decimal: decimalValue.toString() };
  }
  static asDpt20(buffer: Buffer) {
    return buffer.readUInt8(0);
  }
  static asDpt20001(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['autonomous', 'slave', 'master'][value] || 'reserved';
  }
  static asDpt20002(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['Building in use', 'Building not used', 'Building protection'][value] || 'reserved';
  }
  static asDpt20003(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['occupied', 'standby', 'not occupied'][value] || 'reserved';
  }
  static asDpt20004(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['High', 'Medium', 'Low', 'void'][value] || 'reserved';
  }
  static asDpt20005(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['normal', 'presence simulation', 'night round'][value] || 'manufacturer specific';
  }
  static asDpt20006(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    const mapping: { [key: number]: string; } = {
      0: 'no fault',
      1: 'system and functions of common interest',
      10: 'HVAC general FBs',
      11: 'HVAC Hot Water Heating',
      12: 'HVAC Direct Electrical Heating',
      13: 'HVAC Terminal Units',
      14: 'HVAC VAC',
      20: 'Lighting',
      30: 'Security',
      40: 'Load Management',
      50: 'Shutters and blinds',
    };
    return mapping[value] || 'reserved';
  }
  static asDpt20007(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['reserved', 'simple alarm', 'basic alarm', 'extended alarm'][value] || 'reserved';
  }
  static asDpt20008(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['disabled', 'enabled', 'auto'][value] || 'reserved';
  }
  static asDpt20011(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    const mapping = [
      'no fault',
      'general device fault',
      'communication fault',
      'configuration fault',
      'hardware fault',
      'software fault',
      'insufficient non-volatile memory',
      'insufficient volatile memory',
      'memory allocation size 0 received',
      'CRC-error',
      'watchdog reset detected',
      'invalid opcode detected',
      'general protection fault',
      'maximal table length exceeded',
      'undefined load command received',
      'Group Address Table not sorted',
      'invalid connection number (TSAP)',
      'invalid Group Object number (ASAP)',
      'Group Object Type exceeds limit',
    ];
    return mapping[value] || 'reserved';
  }
  static asDpt20012(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['no fault', 'sensor fault', 'process/controller fault', 'actuator fault', 'other fault'][value] || 'reserved';
  }
  static asDpt20013(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    const mapping = [
      'not active',
      '1 s',
      '2 s',
      '3 s',
      '5 s',
      '10 s',
      '15 s',
      '20 s',
      '30 s',
      '45 s',
      '1 min',
      '1.25 min',
      '1.5 min',
      '2 min',
      '2.5 min',
      '3 min',
      '5 min',
      '15 min',
      '20 min',
      '30 min',
      '1 h',
      '2 h',
      '3 h',
      '5 h',
      '12 h',
      '24 h',
    ];
    return mapping[value] || 'reserved';
  }
  static asDpt20014(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return (
      [
        'calm (no wind)',
        'light air',
        'light breeze',
        'gentle breeze',
        'moderate breeze',
        'fresh breeze',
        'strong breeze',
        'near gale / moderate gale',
        'fresh gale',
        'strong gale',
        'whole gale / storm',
        'violent storm',
        'hurricane',
      ][value] || 'reserved'
    );
  }
  static asDpt20017(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return (
      ['inactive', 'digital input not inverted', 'digital input inverted', 'analog input 0%-100%', 'temperature sensor input'][value] || 'reserved'
    );
  }
  static asDpt20020(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['reserved', 'SensorConnection', 'ControllerConnection'][value] || 'reserved';
  }
  static asDpt20021(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return (
      [
        'Cloudless',
        'Sunny',
        'Sunshiny',
        'Lightly cloudy',
        'Scattered clouds',
        'Cloudy',
        'Heavily cloudy',
        'Almost overcast',
        'Overcast',
        'Sky obstructed from view',
      ][value] || 'reserved'
    );
  }
  static asDpt20022(buffer: Buffer): string {
    const value = buffer.readUInt8(0);
    return ['do not send', 'send always', 'send if value changed during powerdown'][value] || 'reserved';
  }
  static asDpt27001(buffer: Buffer): { outputs: boolean[]; masks: boolean[]; } {
    // Leer los 4 octetos (32 bits)
    const binaryValue = buffer.readUInt32BE(0);
    // Decodificar los 16 bits de salidas (outputs)
    const outputs = [];
    for (let i = 0; i < 16; i++) {
      outputs.push(((binaryValue >> i) & 1) === 1); // Comprobar si el bit i es 1 (encendido)
    }
    // Decodificar los 16 bits de máscaras (masks)
    const masks = [];
    for (let i = 16; i < 32; i++) {
      masks.push(((binaryValue >> i) & 1) === 1); // Comprobar si el bit i es 1 (válido)
    }
    return { outputs, masks };
  }
  static asDpt28001(buffer: Buffer): string {
    const utf8Bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    // Convertir los bytes a una cadena de texto usando UTF-8
    const decodedString = new TextDecoder('utf-8').decode(utf8Bytes);
    // Retornar la cadena decodificada
    return decodedString;
  }
  static asDpt29(buffer: Buffer): number {
    const signedValue = buffer.readBigInt64BE(0);
    return Number(signedValue); // Convertir a número
  }
  static asDpt29010(buffer: Buffer): number {
    const signedValue = buffer.readBigInt64BE(0);
    return Number(signedValue); // Convertir a número
  }
  static asDpt29011(buffer: Buffer): number {
    const signedValue = buffer.readBigInt64BE(0);
    return Number(signedValue); // Convertir a número
  }
  static asDpt29012(buffer: Buffer): number {
    const signedValue = buffer.readBigInt64BE(0);
    return Number(signedValue); // Convertir a número
  }
  static asDpt232600(buffer: Buffer) {
    const rgb = {
      R: buffer.readUInt8(0),
      G: buffer.readUInt8(1),
      B: buffer.readUInt8(2),
    };
    const result = {
      dataBuffer: buffer,
      rgb: rgb,
    };
    return result;
  }
  static asDpt238600(buffer: Buffer): { addr: number; lf: boolean; bf: boolean; } {
    const byte = buffer.readUInt8(0);
    // Decodificar los campos
    const addr = byte & 0x3f; // Los primeros 6 bits (b0 a b5) para la dirección del dispositivo
    const lf = (byte >> 6) & 0x01; // El bit b6 para fallo de lámpara
    const bf = (byte >> 7) & 0x01; // El bit b7 para fallo de balasto
    return {
      addr,
      lf: lf === 1,
      bf: bf === 1,
    };
  }
  static asDpt245600(buffer: Buffer) {
    // Decodificar los valores de cada campo
    const LPDTR = buffer.readUInt8(0); // 8 bits LPDTR (último resultado PDT)
    // Los 8 bits siguientes contienen los campos SF, SD, SP, y LDTR
    const byte1 = buffer.readUInt8(1);
    const SF = (byte1 >> 0) & 0x03; // Los 2 primeros bits para SF
    const SD = (byte1 >> 2) & 0x03; // Los siguientes 2 bits para SD
    const SP = (byte1 >> 4) & 0x03; // Los siguientes 2 bits para SP
    const LDTR = (byte1 >> 6) & 0x3f; // Los 6 bits restantes para LDTR
    // Los 12 bits siguientes contienen los campos LTRF, LTRD y LTRP
    const byte2 = buffer.readUInt8(2);
    const LTRF = (byte2 >> 12) & 0x0f; // Primeros 4 bits para LTRF
    const LTRD = (byte2 >> 8) & 0x0f; // Siguientes 4 bits para LTRD
    const LTRP = (byte2 >> 4) & 0x0f; // Últimos 4 bits para LTRP
    return {
      LTRF: LTRF, // Resultado de la última prueba de función
      LTRD: LTRD, // Resultado de la última prueba de duración
      LTRP: LTRP, // Resultado de la última prueba parcial de duración
      SF: SF, // Método de inicio de la última prueba de función
      SD: SD, // Método de inicio de la última prueba de duración
      SP: SP, // Método de inicio de la última prueba parcial de duración
      LDTR: LDTR, // Tiempo de descarga de batería
      LPDTR: LPDTR, // Nivel de carga restante después de la última prueba PDT
    };
  }
  static asDpt250600(buffer: Buffer) {
    // Decodificar el tercer octeto (last byte) para obtener los campos
    const byte3 = buffer.readUInt8(2);
    // r4B1U3r4B1U3B8
    const r4_1 = (byte3 >> 7) & 0x01; // r (bit 7)
    const r4_2 = (byte3 >> 6) & 0x01; // r (bit 6)
    const r4_3 = (byte3 >> 5) & 0x01; // r (bit 5)
    const r4_4 = (byte3 >> 4) & 0x01; // r (bit 4)
    const C = (byte3 >> 3) & 0x01; // C: Colour Temperature (bit 3)
    const StepCodeColourTemp = (byte3 >> 0) & 0x07; // Step Code Colour Temperature (bits 2-0)
    // Decodificar el segundo octeto
    const byte2 = buffer.readUInt8(1);
    const r4_5 = (byte2 >> 7) & 0x01; // r (bit 7)
    const r4_6 = (byte2 >> 6) & 0x01; // r (bit 6)
    const r4_7 = (byte2 >> 5) & 0x01; // r (bit 5)
    const r4_8 = (byte2 >> 4) & 0x01; // r (bit 4)
    const B = (byte2 >> 3) & 0x01; // Brightness (bit 3)
    const StepCodeBrightness = (byte2 >> 0) & 0x07; // Step Code Brightness (bits 2-0)
    // Decodificar el primer octeto
    const byte1 = buffer.readUInt8(0);
    // Los 6 bits más altos deben ser 0 (reservado)
    const reserved = (byte1 >> 2) & 0x3f; // Bits 7-2
    const validityColourTemp = (byte1 >> 1) & 0x01; // Validez de los campos CCT (bit 1)
    const validityBrightness = byte1 & 0x01; // Validez de los campos CB (bit 0)
    return {
      r4_1,
      r4_2,
      r4_3,
      r4_4, // r valores (bits 7 a 4)
      C, // Colour Temp Increase or Decrease (bit 3)
      StepCodeColourTemp, // Step Code for Colour Temp (bits 2-0)
      r4_5,
      r4_6,
      r4_7,
      r4_8, // r valores (bits 7 a 4) del segundo byte
      B, // Brightness Increase or Decrease (bit 3)
      StepCodeBrightness, // Step Code for Brightness (bits 2-0)
      reserved, // Bits reservados (bits 7-2)
      validityColourTemp, // Validación CCT (bit 1)
      validityBrightness, // Validación CB (bit 0)
    };
  }

  /**
   * DPT 251.600: DPT_Colour_RGBW
   * Decodifica un valor RGBW de 6 bytes con indicadores de validez.
   */
  static asDpt251600(buffer: Buffer) {
    const red = buffer.readUInt8(0);
    const green = buffer.readUInt8(1);
    const blue = buffer.readUInt8(2);
    const white = buffer.readUInt8(3);
    // Octeto 5 es reservado y no se usa
    const validityBits = buffer.readUInt8(5); // Último octeto
    return {
      R: { value: red, valid: (validityBits & 0b00001000) !== 0 },
      G: { value: green, valid: (validityBits & 0b00000100) !== 0 },
      B: { value: blue, valid: (validityBits & 0b00000010) !== 0 },
      W: { value: white, valid: (validityBits & 0b00000001) !== 0 },
    };
  }
}