/*
 Datatypes

 KNX/EIB Function                   Information length      EIS         DPT     Value
 Switch                             1 Bit                   EIS 1       DPT 1	0,1
 Dimming (Position, Control, Value) 1 Bit, 4 Bit, 8 Bit     EIS 2	    DPT 3	[0,0]...[1,7]
 Time                               3 Byte                  EIS 3	    DPT 10
 Date                               3 Byte                  EIS 4       DPT 11
 Floating point                     2 Byte                  EIS 5	    DPT 9	-671088,64 - 670760,96
 8-bit unsigned value               1 Byte                  EIS 6	    DPT 5	0...255
 8-bit unsigned value               1 Byte                  DPT 5.001	DPT 5.001	0...100
 Blinds / Roller shutter            1 Bit                   EIS 7	    DPT 1	0,1
 Priority                           2 Bit                   EIS 8	    DPT 2	[0,0]...[1,1]
 IEEE Floating point                4 Byte                  EIS 9	    DPT 14	4-Octet Float Value IEEE 754
 16-bit unsigned value              2 Byte                  EIS 10	    DPT 7	0...65535
 16-bit signed value                2 Byte                  DPT 8	    DPT 8	-32768...32767
 32-bit unsigned value              4 Byte                  EIS 11	    DPT 12	0...4294967295
 32-bit signed value                4 Byte                  DPT 13	    DPT 13	-2147483648...2147483647
 Access control                     1 Byte                  EIS 12	    DPT 15
 ASCII character                    1 Byte                  EIS 13	    DPT 4
 8859_1 character                   1 Byte                  DPT 4.002	DPT 4.002
 8-bit signed value                 1 Byte                  EIS 14	    DPT 6	-128...127
 14 character ASCII                 14 Byte                 EIS 15	    DPT 16
 14 character 8859_1                14 Byte                 DPT 16.001	DPT 16.001
 Scene                              1 Byte                  DPT 17	    DPT 17	0...63
 HVAC                               1 Byte                  DPT 20	    DPT 20	0..255
 Unlimited string 8859_1            .                       DPT 24	    DPT 24
 List 3-byte value                  3 Byte                  DPT 232	    DPT 232	RGB[0,0,0]...[255,255,255]
 */

/**
 * Represents KNX DPTs (Data Point Types), decodes them according to their specification
 * TODO: Hay que hacerla no dependiente del valor APDU tomado en el constructor, tiene más sentido hacer que sus metodos reciban el valor para no instanciar la clase cada vez que hay un valor diferente
 */
export class KnxDataDecode {
  apdu;
  buffer: ArrayBuffer | undefined;
  /**
   * 
   * @param apdu Application Layer Protocol Data Unit
   * @param isOnlyDataPoint Indicates whether or not to ignore the first bits of the Application Layer Protocol Control Field (APCI), i.e. if the data is purely a DPT.
   */
  constructor(apdu: Buffer, isOnlyDataPoint?: boolean) {
    if (isOnlyDataPoint) {
      const bufferCorrect = Buffer.alloc(apdu.length + 2)
      for (let i = 0; i < bufferCorrect.length - 2; i++) {
        bufferCorrect.writeUInt8(i, apdu[i]);
      }
      this.apdu = bufferCorrect
    } else {
      this.apdu = apdu;
    }
  }
  decodeThis(dpt: typeof KnxDataDecode.dptEnum[number]) {
    switch (dpt) {
      case 1:
        return this.asDpt1()
        break;
      case 2:
        return this.asDpt2()
        break
      case 3007:
        return this.asDpt3007()
      break
      case 3008:
        return this.asDpt3008()
      break
      case 4001:
        return this.asDpt4001()
      break
      case 4002:
        return this.asDpt4002()
      break
      case 5:
        return this.asDpt5()
      break
      case 5001:
        return this.asDpt5001()
      break
      case 5002:
        return this.asDpt5002()
      case 6:
        return this.asDpt6()
      break
      case 6001:
        return this.asDpt6001()
      break
      case 6010:
        return this.asDpt6010()
      break
      case 6020:
        return this.asDpt6020()
      break
      case 7:
        return this.asDpt7()
      break
      case 7001:
        return this.asDpt7001()
      break
      case 7002:
        return this.asDpt7002()
      break
      case 7003:
        return this.asDpt7003()
      break
      case 7004:
        return this.asDpt7004()
      break
      case 7005:
        return this.asDpt7005()
      break
      case 7006:
        return this.asDpt7006()
      break
      case 7007:
        return this.asDpt7007()
      break
      case 7011:
        return this.asDpt7011()
      break
      case 7012:
        return this.asDpt7012()
      break
      case 7013:
        return this.asDpt7013()
      break
      case 8:
        return this.asDpt8()
      break
      case 9:
        return this.asDpt9()
      break
      case 10001:
        return this.asDpt10001()
      break
      case 11001:
        return this.asDpt11001()
      break
      case 12001:
        return this.asDpt12001()
      break
      case 12002:
        return this.asDpt12002()
      break
      case 13:
        return this.asDpt13()
      break
      case 13001:
        return this.asDpt13001()
      break
      case 13002:
        return this.asDpt13002()
      break
      case 13010:
        return this.asDpt13010()
      break
      case 13011:
        return this.asDpt13011()
      break
      case 13012:
        return this.asDpt13012()
      break
      case 13013:
        return this.asDpt13013()
      break
      case 13014:
        return this.asDpt13014()
      break
      case 13015:
        return this.asDpt13015()
      break
      case 13016:
        return this.asDpt13016()
      break
      case 13100:
        return this.asDpt13100()
      case 14:
        return this.asDpt14()
      break
      case 15000:
        return this.asDpt15000()
      break
      case 16:
        return this.asDpt16()
      break
      case 16002:
        return this.asDpt16002()
      break
      case 20:
        return this.asDpt20()
      break
      case 20001:
        return this.asDpt20001()
      break
      case 20002:
        return this.asDpt20002()
      break
      case 20003:
        return this.asDpt20003()
      break
      case 20004:
        return this.asDpt20004()
      break
      case 20005:
        return this.asDpt20005()
      break
      case 20006:
        return this.asDpt20006()
      break
      case 20007:
        return this.asDpt20007()
      break
      case 20008:
        return this.asDpt20008()
      break
      case 20011:
        return this.asDpt20011()
      break
      case 20012:
        return this.asDpt20012()
      break
      case 20013:
        return this.asDpt20013()
      break
      case 20014:
        return this.asDpt20014()
      break
      case 20017:
        return this.asDpt20017()
      break
      case 20020:
        return this.asDpt20020()
      break
      case 20021:
        return this.asDpt20021()
      break
      case 20022:
        return this.asDpt20022()
      break
      case 27001:
        return this.asDpt27001()
      break
      case 28001:
        return this.asDpt28001()
      break
      case 29:
        return this.asDpt29()
      break
      case 29010:
        return this.asDpt29010()
      break
      case 29011:
        return this.asDpt29011()
      break
      case 29012:
        return this.asDpt29012()
      break
      case 232600:
        return this.asDpt232600()
      break
      case 238600:
        return this.asDpt238600()
      break
      case 245600:
        return this.asDpt245600()
      break
      case 250600:
        return this.asDpt250600()
      break
      case 251600:
        return this.asDpt251600()
        break
      default:
        throw new Error("The indicated dpt is not listed for decoding or the data provided is invalid")
    }
  }
  static get dptEnum() {
    return [1, 2, 3007, 3008, 4001, 4002, 5, 5001, 5002, 6, 6001, 6010, 6020, 7, 7001, 7002, 7003, 7004, 7005, 7006, 7007, 7011, 7012, 7013, 8, 9, 10001, 11001, 12001, 12002, 13, 13001, 13002, 13010, 13011, 13012, 13013, 13014, 13015, 13016, 13100, 14, 15000, 16, 16002, 20, 20001, 20002, 20003, 20004, 20005, 20006, 20007, 20008, 20011, 20012, 20013, 20014, 20017, 20020, 20021, 20022, 27001, 28001, 29, 29010, 29011, 29012, 232600, 238600, 245600, 250600, 251600] as const
  }
  /**
   * Prepare the internal data to access it as specific type
   */
  dataView() {
    let i;
    const len = this.apdu.length - 2;
    this.buffer = new ArrayBuffer(len);
    const dataView = new DataView(this.buffer);
    for (i = 0; i < len; i++) {
      dataView.setUint8(i, this.apdu[i + 2]);
    }
    return dataView;
  }

  private toPercentage(value: number) {
    return (value / 255) * 100 + '%';
  }
  private toAngle(value: number) {
    return (value / 255) * 360 + 'ª';
  }
  /**
   * Interpret the underlying data as boolean value
   * @returns
   */
  asDpt1() {
    // 0x3F = 0011 1111
    const data = 0x3f & this.apdu[1];
    return data != 0;
  }
  /**
   * Interpretar la información del DPT2 (B2) y devolver un objeto con los campos:
   * - control (c): 0 o 1
   * - value (v): 0 o 1
   * - description: descripción basada en la combinación de bits
   *
   * Los datos se encuentran en el primer octeto (this.apdu[1]), y solo se toman en cuenta los dos bits menos significativos.
   */
  asDpt2() {
    // Extraer los dos bits menos significativos del primer octeto.
    const raw = this.apdu[1] & 0x03;
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
   * Se asume que el dato se encuentra en el primer octeto útil, es decir, en this.apdu[1].
   * Como la información es de 4 bits, se toma el nibble inferior del byte.
   */
  asDpt3007() {
    // Extraemos el nibble inferior del byte en this.apdu[1].
    // El formato es: c StepCode, donde:
    // - c es el bit más significativo del nibble (bit 3) y
    // - StepCode son los 3 bits menos significativos (bits 0-2).
    const rawNibble = this.apdu[1] & 0x0f;
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
   * Interpretar la información del DPT3008 (DPT_Control_Blinds) utilizando dataView.
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
  asDpt3008() {
    // Accedemos al primer byte de la carga útil mediante dataView()
    const view = this.dataView();
    const byte = view.getUint8(0);
    // Extraer el nibble inferior (4 bits)
    // Si se requiere el nibble superior, se usaría: (byte >> 4) & 0x0F
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
  asDpt4001() {
    const view = this.dataView();
    const value = view.getUint8(0);
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
  asDpt4002() {
    const view = this.dataView();
    const value = view.getUint8(0);

    return String.fromCharCode(value);
  }

  /**
   * Interpret the underlying data as 1 Byte unsigned value
   * @returns
   */
  asDpt5() {
    const view = this.dataView();
    return view.getUint8(0);
  }
  asDpt5001() {
    return this.toPercentage(this.asDpt5());
  }
  asDpt5002() {
    return this.toAngle(this.asDpt5());
  }
  asDpt6() {
    const data = this.dataView();
    return data.getInt8(0);
  }
  asDpt6001() {
    return this.asDpt6() + '%';
  }
  asDpt6010() {
    return this.asDpt6() + ' counter pulses';
  }
  asDpt6020() {
    const view = this.dataView();
    // Extraer los primeros 5 bits (estado) de la primera posición
    const status = view.getUint8(0) >> 3; // Desplazamos 3 bits a la derecha para obtener los primeros 5 bits
    // Extraer los últimos 3 bits (modo) de la primera posición
    const mode = view.getUint8(0) & 0b111; // Usamos una máscara para obtener los últimos 3 bits
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
  asDpt7() {
    const data = this.dataView();
    if (data.byteLength === 1) {
      const buf = Buffer.alloc(1);
      buf[0] = this.apdu[2];
      return buf.readUInt8();
    } else {
      return data.getUint16(0);
    }
  }
  asDpt7001() {
    const data = this.asDpt7();
    return data + 'pulses';
  }
  asDpt7002() {
    return this.asDpt7() + 'ms';
  }
  asDpt7003() {
    return this.asDpt7() / 100 + 's';
  }
  asDpt7004() {
    return this.asDpt7() / 10 + 's';
  }
  asDpt7005() {
    return this.asDpt7() + 's';
  }
  asDpt7006() {
    return this.asDpt7() + 'min';
  }
  asDpt7007() {
    return this.asDpt7() + 'h';
  }
  asDpt7011() {
    return this.asDpt7() + 'mm';
  }
  asDpt7012() {
    const data = this.asDpt7();
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
  asDpt7013() {
    return this.asDpt7() + 'lux';
  }
  asDpt8() {
    return this.dataView().getInt16(0);
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
  asDpt9(): number {
    const view = this.apdu[2];
    // Se asume que los 2 bytes que contienen el dato empiezan en la posición 0 del DataView.
    const raw = view; // Big-endian

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
  asDpt10001() {
    const view = this.dataView();
    if (view.byteLength < 3) {
      throw new Error('No hay suficientes datos para DPT10001');
    }
    // Octeto 1: Día y Hora
    const byte0 = view.getUint8(0);
    const day = (byte0 >> 5) & 0x07; // Extrae los 3 bits superiores
    const hour = byte0 & 0x1f; // Extrae los 5 bits inferiores
    // Octeto 2: Minutos (6 bits)
    const byte1 = view.getUint8(1);
    const minutes = byte1 & 0x3f; // Máscara 0011 1111
    // Octeto 3: Segundos (6 bits)
    const byte2 = view.getUint8(2);
    const seconds = byte2 & 0x3f; // Máscara 0011 1111
    // Opcional: conversión del número del día a nombre
    const days: { [key: number]: string } = {
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
  asDpt11001() {
    const view = this.dataView();
    if (view.byteLength < 3) {
      throw new Error('No hay suficientes datos para DPT11001');
    }
    // Octeto 1: Extraer el día (los 5 bits menos significativos)
    const byte0 = view.getUint8(0);
    const day = byte0 & 0x1f; // 0x1F equivale a 0001 1111
    // Octeto 2: Extraer el mes (los 4 bits menos significativos)
    const byte1 = view.getUint8(1);
    const month = byte1 & 0x0f; // 0x0F equivale a 0000 1111
    // Octeto 3: Extraer el año (los 7 bits menos significativos)
    const byte2 = view.getUint8(2);
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
  asDpt12001() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 12.001');
    }
    // getUint32() interpreta el valor en formato big-endian (MSB primero).
    const value = view.getUint32(0);
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
  asDpt12002(variant: 'sec' | 'min' | 'hrs' = 'sec') {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para el DPT LongTimePeriod');
    }
    const value = view.getUint32(0);
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
  asDpt13() {
    const view = this.dataView();
    return view.getInt32(0);
  }
  /**
   * DPT 13.001: DPT_Value_4_Count
   * Interpreta un contador de pulsos (valor de 4 octetos con signo).
   */
  asDpt13001() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.001');
    }
    const value = view.getInt32(0);
    return {
      value,
      unit: 'pulses',
    };
  }
  /**
   * DPT 13.002: DPT_FlowRate_m3/h
   * Interpreta el flujo en m³/h (valor de 4 octetos con signo) con alta resolución.
   */
  asDpt13002() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.002');
    }
    const rawValue = view.getInt32(0);
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
  asDpt13010() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.010');
    }
    const value = view.getInt32(0);
    return {
      value,
      unit: 'Wh',
    };
  }
  /**
   * DPT 13.011: DPT_ApparantEnergy
   * Interpreta la energía aparente en VAh.
   */
  asDpt13011() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.011');
    }
    const value = view.getInt32(0);
    return {
      value,
      unit: 'VAh',
    };
  }
  /**
   * DPT 13.012: DPT_ReactiveEnergy
   * Interpreta la energía reactiva en VARh.
   */
  asDpt13012() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.012');
    }
    const value = view.getInt32(0);
    return {
      value,
      unit: 'VARh',
    };
  }
  /**
   * DPT 13.013: DPT_ActiveEnergy_kWh
   * Interpreta la energía activa en kWh.
   */
  asDpt13013() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.013');
    }
    const value = view.getInt32(0);
    return {
      value,
      unit: 'kWh',
    };
  }
  /**
   * DPT 13.014: DPT_ApparantEnergy_kVAh
   * Interpreta la energía aparente en kVAh.
   */
  asDpt13014() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.014');
    }
    const value = view.getInt32(0);
    return {
      value,
      unit: 'kVAh',
    };
  }
  /**
   * DPT 13.015: DPT_ReactiveEnergy_kVARh
   * Interpreta la energía reactiva en kVARh.
   */
  asDpt13015() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.015');
    }
    const value = view.getInt32(0);
    return {
      value,
      unit: 'kVARh',
    };
  }
  /**
   * DPT 13.016: DPT_ActiveEnergy_MWh
   * Interpreta la energía activa en MWh.
   */
  asDpt13016() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.016');
    }
    const value = view.getInt32(0);
    return {
      value,
      unit: 'MWh',
    };
  }
  /**
   * DPT 13.100: DPT_LongDeltaTimeSec
   * Interpreta un periodo de tiempo en segundos.
   */
  asDpt13100() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 13.100');
    }
    const value = view.getInt32(0);
    return {
      value,
      unit: 's',
    };
  }

  /**
   * Interpret the underlying data as 4 byte floating point number
   */
  asDpt14() {
    const view = this.dataView();
    return view.getFloat32(0);
  }
  /**
   * DPT 15.000: DPT_Access_Data
   * Decodifica un valor de 4 bytes con información de acceso.
   */
  asDpt15000() {
    const view = this.dataView();
    if (view.byteLength < 4) {
      throw new Error('No hay suficientes datos para DPT 15.000 (Access Data).');
    }
    const d6 = view.getUint8(0); // Octeto 4
    const d5 = (view.getUint8(1) & 0b11110000) >> 4;
    const d4 = view.getUint8(1) & 0b00001111;
    const d3 = (view.getUint8(2) & 0b11110000) >> 4;
    const d2 = view.getUint8(2) & 0b00001111;
    const d1 = (view.getUint8(3) & 0b11110000) >> 4;
    const e = (view.getUint8(3) & 0b00001000) !== 0;
    const p = (view.getUint8(3) & 0b00000100) !== 0;
    const d = (view.getUint8(3) & 0b00000010) !== 0;
    const c = (view.getUint8(3) & 0b00000001) !== 0;
    const index = view.getUint8(3) & 0b00001111;
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
  asDpt16() {
    const view = this.dataView();
    if (view.byteLength < 14) {
      throw new Error('Datos insuficientes para DPT 16 (String).');
    }
    let str = '';
    for (let i = 0; i < 14; i++) {
      const charCode = view.getUint8(i);
      if (charCode === 0x00) break; // Ignorar caracteres NULL
      str += String.fromCharCode(charCode);
    }
    return str;
  }
  /**
   * Decodifica un buffer de 14 bytes en formato hexadecimal (DPT 16.002).
   * (No oficial en la especificacion del DataPointType de Knx en la version 02.02.01)
   */
  asDpt16002() {
    const buffer = this.dataView();
    if (buffer.byteLength < 14) {
      throw new Error('Datos insuficientes para DPT 16.002 (Se esperan 14 bytes).');
    }
    let hexString = '';
    let decimalValue = BigInt(0);
    for (let i = 0; i < 14; i++) {
      if (buffer.getUint8(i) === 0x00) break; // Ignorar caracteres NULL
      hexString += buffer.getUint8(i).toString(16).padStart(2, '0').toUpperCase();
    }
    if (hexString) {
      decimalValue = BigInt('0x' + hexString); // Convertir de Hex a Decimal
    }
    return { hex: hexString, decimal: decimalValue.toString() };
  }
  asDpt20() {
    const data = this.dataView();
    return data.getUint8(0);
  }
  asDpt20001(): string {
    const value = this.dataView().getUint8(0);
    return ['autonomous', 'slave', 'master'][value] || 'reserved';
  }
  asDpt20002(): string {
    const value = this.dataView().getUint8(0);
    return ['Building in use', 'Building not used', 'Building protection'][value] || 'reserved';
  }
  asDpt20003(): string {
    const value = this.dataView().getUint8(0);
    return ['occupied', 'standby', 'not occupied'][value] || 'reserved';
  }
  asDpt20004(): string {
    const value = this.dataView().getUint8(0);
    return ['High', 'Medium', 'Low', 'void'][value] || 'reserved';
  }
  asDpt20005(): string {
    const value = this.dataView().getUint8(0);
    return ['normal', 'presence simulation', 'night round'][value] || 'manufacturer specific';
  }
  asDpt20006(): string {
    const value = this.dataView().getUint8(0);
    const mapping: { [key: number]: string } = {
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
  asDpt20007(): string {
    const value = this.dataView().getUint8(0);
    return ['reserved', 'simple alarm', 'basic alarm', 'extended alarm'][value] || 'reserved';
  }
  asDpt20008(): string {
    const value = this.dataView().getUint8(0);
    return ['disabled', 'enabled', 'auto'][value] || 'reserved';
  }
  asDpt20011(): string {
    const value = this.dataView().getUint8(0);
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
  asDpt20012(): string {
    const value = this.dataView().getUint8(0);
    return ['no fault', 'sensor fault', 'process/controller fault', 'actuator fault', 'other fault'][value] || 'reserved';
  }
  asDpt20013(): string {
    const value = this.dataView().getUint8(0);
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
  asDpt20014(): string {
    const value = this.dataView().getUint8(0);
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
  asDpt20017(): string {
    const value = this.dataView().getUint8(0);
    return (
      ['inactive', 'digital input not inverted', 'digital input inverted', 'analog input 0%-100%', 'temperature sensor input'][value] || 'reserved'
    );
  }
  asDpt20020(): string {
    const value = this.dataView().getUint8(0);
    return ['reserved', 'SensorConnection', 'ControllerConnection'][value] || 'reserved';
  }
  asDpt20021(): string {
    const value = this.dataView().getUint8(0);
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
  asDpt20022(): string {
    const value = this.dataView().getUint8(0);
    return ['do not send', 'send always', 'send if value changed during powerdown'][value] || 'reserved';
  }
  asDpt27001(): { outputs: boolean[]; masks: boolean[] } {
    // Leer los 4 octetos (32 bits)
    const binaryValue = this.dataView().getUint32(0, false); // Big-endian
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
  asDpt28001(): string {
    const utf8Bytes = new Uint8Array(this.dataView().buffer);
    // Convertir los bytes a una cadena de texto usando UTF-8
    const decodedString = new TextDecoder('utf-8').decode(utf8Bytes);
    // Retornar la cadena decodificada
    return decodedString;
  }
  asDpt29(): number {
    const signedValue = this.dataView().getBigInt64(0, false); // Big-endian, 8 bytes
    return Number(signedValue); // Convertir a número
  }
  asDpt29010(): number {
    const signedValue = this.dataView().getBigInt64(0, false); // Big-endian, 8 bytes
    return Number(signedValue); // Convertir a número
  }
  asDpt29011(): number {
    const signedValue = this.dataView().getBigInt64(0, false); // Big-endian, 8 bytes
    return Number(signedValue); // Convertir a número
  }
  asDpt29012(): number {
    const signedValue = this.dataView().getBigInt64(0, false); // Big-endian, 8 bytes
    return Number(signedValue); // Convertir a número
  }
  asDpt232600() {
    const data = this.dataView();
    const rgb = {
      R: data.getUint8(0),
      G: data.getUint8(1),
      B: data.getUint8(2),
    };
    const result = {
      dataBuffer: data,
      rgb: rgb,
    };
    return result;
  }
  asDpt238600(): { addr: number; lf: boolean; bf: boolean } {
    const byte = this.dataView().getUint8(0); // Leer 1 octeto
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
  asDpt245600() {
    const dataView = this.dataView();
    // Decodificar los valores de cada campo
    const LPDTR = dataView.getUint8(0); // 8 bits LPDTR (último resultado PDT)
    // Los 8 bits siguientes contienen los campos SF, SD, SP, y LDTR
    const byte1 = dataView.getUint8(1);
    const SF = (byte1 >> 0) & 0x03; // Los 2 primeros bits para SF
    const SD = (byte1 >> 2) & 0x03; // Los siguientes 2 bits para SD
    const SP = (byte1 >> 4) & 0x03; // Los siguientes 2 bits para SP
    const LDTR = (byte1 >> 6) & 0x3f; // Los 6 bits restantes para LDTR
    // Los 12 bits siguientes contienen los campos LTRF, LTRD y LTRP
    const byte2 = dataView.getUint8(2);
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
  asDpt250600() {
    const dataView = this.dataView();
    // Decodificar el tercer octeto (last byte) para obtener los campos
    const byte3 = dataView.getUint8(2);
    // r4B1U3r4B1U3B8
    const r4_1 = (byte3 >> 7) & 0x01; // r (bit 7)
    const r4_2 = (byte3 >> 6) & 0x01; // r (bit 6)
    const r4_3 = (byte3 >> 5) & 0x01; // r (bit 5)
    const r4_4 = (byte3 >> 4) & 0x01; // r (bit 4)
    const C = (byte3 >> 3) & 0x01; // C: Colour Temperature (bit 3)
    const StepCodeColourTemp = (byte3 >> 0) & 0x07; // Step Code Colour Temperature (bits 2-0)
    // Decodificar el segundo octeto
    const byte2 = dataView.getUint8(1);
    const r4_5 = (byte2 >> 7) & 0x01; // r (bit 7)
    const r4_6 = (byte2 >> 6) & 0x01; // r (bit 6)
    const r4_7 = (byte2 >> 5) & 0x01; // r (bit 5)
    const r4_8 = (byte2 >> 4) & 0x01; // r (bit 4)
    const B = (byte2 >> 3) & 0x01; // Brightness (bit 3)
    const StepCodeBrightness = (byte2 >> 0) & 0x07; // Step Code Brightness (bits 2-0)
    // Decodificar el primer octeto
    const byte1 = dataView.getUint8(0);
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
  asDpt251600() {
    const view = this.dataView();
    const red = view.getUint8(0);
    const green = view.getUint8(1);
    const blue = view.getUint8(2);
    const white = view.getUint8(3);
    // Octeto 5 es reservado y no se usa
    const validityBits = view.getUint8(5); // Último octeto
    return {
      R: { value: red, valid: (validityBits & 0b00001000) !== 0 },
      G: { value: green, valid: (validityBits & 0b00000100) !== 0 },
      B: { value: blue, valid: (validityBits & 0b00000010) !== 0 },
      W: { value: white, valid: (validityBits & 0b00000001) !== 0 },
    };
  }
}
