/// <summary>
///    Represent data send over knx bus and provide methods to interpret them as different dpt values
/// </summary>
/// <param name="data">Byte array value or integer</param>
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

import { KNXHelper } from "./KNXHelper";

/**
 * Represent data send over knx bus and provide methods to interpret them as different dpt values.
 * (Representar datos enviados a través del bus knx y proporcionar métodos para interpretarlos como diferentes valores dpt)
 * -- Byte array value or integer
 */
export class KnxData {
  apdu;
  buffer: ArrayBuffer | undefined;
  constructor(apdu: Buffer) {
    this.apdu = apdu
    
  }
  /**
 * Prepare the internal data to access it as specific type
 */
  dataView() {
    let i;
    let len = this.apdu.length - 2;
    this.buffer = new ArrayBuffer(len)
    const dataView = new DataView(this.buffer)
    for (i = 0; i < len; i++) {
      dataView.setUint8(i, this.apdu[i + 2]);
    }
    return dataView;
  }

  private toPercentage(value: number) {
    return (value / 255) * 100 + "%";
  }
  private toAngle(value: number) {
    return (value / 255) * 360 + "ª";
}
  /**
   * Interpret the underlying data as boolean value
   * @returns 
   */
  asDpt1() {
    // 0x3F = 0011 1111
    let data = 0x3f & this.apdu[1]
    return (data != 0)
  }
  /**
   * Interpret the underlying data as 1 Byte unsigned value
   * @returns 
   */
  asDpt5() {
    let view = this.dataView()
    return view.getUint8(0)
  }
  asDdt5001() {
    return this.toPercentage(this.asDpt5())
  }
  asDpt5002() {
    return this.toAngle(this.asDpt5())
  }
  asDpt6() {
    const data = this.dataView()
    return data.getInt8(0)
  }
  asDpt6001() {
    return this.asDpt6() + "%"
  }
  asDpt6010() {
    return this.asDpt6() + " counter pulses"
  }
  asDpt6020() {
    const view = this.dataView();
    // Extraer los primeros 5 bits (estado) de la primera posición
    const status = view.getUint8(0) >> 3; // Desplazamos 3 bits a la derecha para obtener los primeros 5 bits
    // Extraer los últimos 3 bits (modo) de la primera posición
    const mode = view.getUint8(0) & 0b111; // Usamos una máscara para obtener los últimos 3 bits
    // Asignar el modo (1: Modo 0, 2: Modo 1, 3: Modo 2)
    let modeText = "";
    switch (mode) {
      case 0b001:
        modeText = "Modo 0 activo";
        break;
      case 0b010:
        modeText = "Modo 1 activo";
        break;
      case 0b100:
        modeText = "Modo 2 activo";
        break;
      default:
        modeText = "Modo desconocido";
    }
    // Devolver los resultados como un objeto con estado y modo
    return {
      status: status === 1 ? "Activo" : "Inactivo", // Si el bit de estado es 1, es activo
      mode: modeText
    };
  }
  asDpt7() {
    const data = this.dataView()
    return data.getUint16(0)
  }
  asDpt7001() {
    const data = this.asDpt7()
    return data + "pulses"
  }
  asDpt7002() {
    return this.asDpt7() + "ms"
  }
  asDpt7003() {
    return (this.asDpt7() / 100) + "s"
  }
  asDpt7004() {
    return (this.asDpt7() / 10) + "s"
  }
  asDpt7005() {
    return this.asDpt7() + "s"
  }
  asDpt7006() {
    return this.asDpt7() + "min"
  }
  asDpt7007() {
    return this.asDpt7() + "h"
  }
  asDpt7011() {
    return this.asDpt7() + "mm"
  }
  asDpt7012() {
    const data = this.asDpt7()
    if(data === 0) {
      return {
        value: data,
        status: 'No bus power supply functionality available'
      }
    } else {
      return  {
        value: data + "mA",
        status: ''
      }
    }
  }
  asDpt7013() {
    return this.asDpt7() + "lux"
  }
  asDpt8() {
    return this.dataView().getInt16(0)
  }
  /**
   * Interpret the underlying data as 2 byte floating point value
   * @returns 
   */
  asDpt9() {
    let sign = this.apdu[2] >> 7;
    let exponent = (this.apdu[2] & 0b01111000) >> 3;
    let mantissa = 256 * (this.apdu[2] & 0b00000111) + this.apdu[3]
    mantissa = (sign == 1) ? ~(mantissa^2047) : mantissa;
    return KNXHelper.Idexp((0.01 * mantissa), exponent)
  }
  /**
   * Interpret the underlying data as 4 byte signed integer
   * @returns 
   */
  asDpt13() {
    let view = this.dataView()
    return view.getInt32(0)
  }
  /**
   * Interpret the underlying data as 4 byte floating point number
   */
  asDpt14() {
    let view = this.dataView()
    return view.getFloat32(0)
  }
  asDpt232600() {
    const data = this.dataView()
    const rgb = {
      R: data.getUint8(0),
      G: data.getUint8(1),
      B: data.getUint8(2)
    }
    const result = {
      dataBuffer: data,
      rgb: rgb
    }
    return result
  }
}