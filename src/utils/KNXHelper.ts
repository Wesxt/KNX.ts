//           +-----------------------------------------------+
// 16 bits   |              INDIVIDUAL ADDRESS               |
//           +-----------------------+-----------------------+
//           | OCTET 0 (high byte)   |  OCTET 1 (low byte)   |
//           +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
//    bits   | 7| 6| 5| 4| 3| 2| 1| 0| 7| 6| 5| 4| 3| 2| 1| 0|
//           +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
//           |  Subnetwork Address   |                       |
//           +-----------+-----------+     Device Address    |
//           |(Area Adrs)|(Line Adrs)|                       |
//           +-----------------------+-----------------------+

import { InvalidKnxAddressException } from "../errors/InvalidKnxAddresExeption";

//           +-----------------------------------------------+
// 16 bits   |             GROUP ADDRESS (3 level)           |
//           +-----------------------+-----------------------+
//           | OCTET 0 (high byte)   |  OCTET 1 (low byte)   |
//           +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
//    bits   | 7| 6| 5| 4| 3| 2| 1| 0| 7| 6| 5| 4| 3| 2| 1| 0|
//           +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
//           |  | Main Grp  | Midd G |       Sub Group       |
//           +--+--------------------+-----------------------+

//           +-----------------------------------------------+
// 16 bits   |             GROUP ADDRESS (2 level)           |
//           +-----------------------+-----------------------+
//           | OCTET 0 (high byte)   |  OCTET 1 (low byte)   |
//           +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
//    bits   | 7| 6| 5| 4| 3| 2| 1| 0| 7| 6| 5| 4| 3| 2| 1| 0|
//           +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
//           |  | Main Grp  |            Sub Group           |
//           +--+--------------------+-----------------------+

/**
 * This class is completely based on the knx.js repo, which has been very helpful.
 * @see https://github.com/estbeetoo/knx.js
 */
export class KNXHelper {
  constructor() {
    throw new Error("This class is static");
  }
  /**
   * Parsea un Buffer KNX (2 bytes) a su representación en string según el formato especificado.
   * Si es un buffer la dirección entonces se delega a {@link GetAddress_} para retornar un buffer
   * @param addr Buffer de 2 bytes conteniendo la dirección raw o un string indicando la dirección.
   * @param separator Separador visual ("." para Individual, "/" para Grupo). Por defecto infiere Grupo.
   * @param threeLevelAddressing Si es true, fuerza formato de grupo 3 niveles (x/y/z). Si es false y es grupo, usa 2 niveles (x/y).
   */
  static GetAddress(addr: string, separator?: "." | "/", threeLevelAddressing?: boolean): Buffer;
  static GetAddress(addr: number, separator?: "." | "/", threeLevelAddressing?: boolean): string;
  static GetAddress(addr: Buffer, separator?: "." | "/", threeLevelAddressing?: boolean): string;
  static GetAddress(
    addr: Buffer | string | number,
    separator: "." | "/" = "/",
    threeLevelAddressing: boolean = true,
  ): Buffer | string {
    // 1. Caso String: Delegar a GetAddress_
    if (typeof addr === "string") {
      return this.GetAddress_(addr);
    }

    // 2. Caso Number: llamar recursivamente
    if (typeof addr === "number") {
      const buffer = Buffer.alloc(2);
      buffer.writeUint16BE(addr & 0xFFFF);
      return this.GetAddress(buffer, separator, threeLevelAddressing) as string;
    }

    // 3. Caso Buffer
    if (Buffer.isBuffer(addr)) {
      if (addr.length < 2) {
        throw new Error("KNX Address buffer must be at least 2 bytes");
      }

      const highByte = addr[0];
      const lowByte = addr[1];
      const isGroup = separator === "/";

      // Caso A: Dirección de Grupo 2 Niveles (Main/Sub11)
      if (isGroup && !threeLevelAddressing) {
        const main = highByte >> 3; // 5 bits
        const sub = ((highByte & 0x07) << 8) | lowByte; // 3 bits altos + 8 bits bajos (Usar OR bitwise | es más seguro que +)

        return `${main}/${sub}`;
      }

      // Caso B: Dirección de Grupo 3 Niveles (Main/Mid/Sub)
      if (isGroup) {
        const main = (highByte >> 3) & 0x1f; // 5 bits (0-31)
        const middle = highByte & 0x07; // 3 bits (0-7)
        const sub = lowByte; // 8 bits (0-255)

        return `${main}/${middle}/${sub}`;
      }

      // Caso C: Dirección Individual (Area.Line.Device)
      // Estándar: Area (4 bits), Line (4 bits), Device (8 bits)
      const area = highByte >> 4; // 4 bits
      const line = highByte & 0x0f; // 4 bits
      const device = lowByte; // 8 bits

      return `${area}.${line}.${device}`;
    }

    throw new TypeError("Address must be a string or a Buffer");
  }
  /**
   * Converts a KNX address (string) into a 2-byte buffer, this method is an alternative to the {@link GetAddress_} method, both methods do the same thing
   * @param address Group or individual address (e.g., "1.1.100" or "1/2/3")
   * @param separator Address separator ("." for individual, "/" for group)
   * @param group `true` for group address, `false` for individual address
   * @param threeLevelAddressing `true` for 3-level, `false` for 2-level
   * @returns 2-byte buffer with the encoded address
   */
  static addressToBuffer(address: string, separator = ".", group = false, threeLevelAddressing = true): Buffer {
    const parts = address.split(separator).map(Number);
    let addr = Buffer.alloc(2);
    if (parts.length < (threeLevelAddressing ? 3 : 2)) {
      throw new InvalidKnxAddressException("Invalid address. Incorrect format.");
    }

    if (group) {
      if (threeLevelAddressing) {
        if (parts[0] > 31 || parts[1] > 7 || parts[2] > 255) {
          throw new InvalidKnxAddressException("Invalid group address (3 levels)");
        }
        addr[0] = ((parts[0] & 0x1f) << 3) | (parts[1] & 0x07);
        addr[1] = parts[2] & 0xff;
      } else {
        if (parts[0] > 31 || parts[1] > 2047) {
          throw new InvalidKnxAddressException("Invalid group address (2 levels)");
        }
        addr[0] = (parts[0] << 3) | ((parts[1] >> 8) & 0x07);
        addr[1] = parts[1] & 0xff;
      }
    } else {
      if (parts[0] > 15 || parts[1] > 15 || parts[2] > 255) {
        throw new InvalidKnxAddressException("Invalid individual address.");
      }
      addr[0] = ((parts[0] & 0x0f) << 4) | (parts[1] & 0x0f);
      addr[1] = parts[2] & 0xff;
    }

    return addr;
  }

  /**
   * Converts a group address from a string into a buffer, first validating if it is a source address if its separator is **"."** otherwise validating if it is a group address if the separator is **"/"**, the alternative to this method is {@link addressToBuffer}
   * @param address Group address
   * @returns
   */
  static GetAddress_(address: string) {
    try {
      let addr = Buffer.alloc(2);
      let threeLevelAddressing = true;
      let parts;
      let group = address.indexOf("/") !== -1;
      if (!group) {
        // individual address
        parts = address.split(".");
        if (parts.length != 3 || parts[0].length > 2 || parts[1].length > 2 || parts[2].length > 3)
          throw new InvalidKnxAddressException(address);
      } else {
        // group address
        parts = address.split("/");
        if (parts.length != 3 || parts[0].length > 2 || parts[1].length > 1 || parts[2].length > 3) {
          if (parts.length != 2 || parts[0].length > 2 || parts[1].length > 4)
            throw new InvalidKnxAddressException(address);
          threeLevelAddressing = false;
        }
      }
      if (!threeLevelAddressing) {
        let part = parseInt(parts[0]);
        if (part > 15) throw new InvalidKnxAddressException(address);
        addr[0] = (part << 3) & 255;
        part = parseInt(parts[1]);
        if (part > 2047) throw new InvalidKnxAddressException(address);
        let part2 = Buffer.alloc(2);
        part2.writeUInt16BE(part, 0);
        if (part2.length > 2) throw new InvalidKnxAddressException(address);
        addr[0] = (addr[0] | part2[0]) & 255;
        addr[1] = part2[1];
      } else {
        let part = parseInt(parts[0]);
        if (part > 31) throw new InvalidKnxAddressException(address);
        addr[0] = group ? (part << 3) & 255 : (part << 4) & 255;
        part = parseInt(parts[1]);
        if ((group && part > 7) || (!group && part > 15)) throw new InvalidKnxAddressException(address);
        addr[0] = (addr[0] | part) & 255;
        part = parseInt(parts[2]);
        if (part > 255) throw new InvalidKnxAddressException(address);
        addr[1] = part & 255;
      }
      return addr;
    } catch (e) {
      throw new InvalidKnxAddressException(address);
    }
  }

  static GetDataLength(data: Buffer, isShort: boolean = false) {
    if (data.length <= 0) return 0;
    if (isShort) return 1;
    if (data.length == 1 && data[0] <= 0x3f) return 1;
    if (data.length == 4) return 3;
    // if (data[0] <= 0x3f) return data.length;
    return data.length + 1;
  }

  /**
   * Método auxiliar para codificar un número en formato DPT9 (2 bytes).
   * Implementación corregida usando aritmética de bits y complemento a dos real.
   */
  // private static encodeFloatToDPT9(value: number): Buffer {
  //   // 1. Manejo de errores y casos especiales
  //   if (isNaN(value) || !isFinite(value)) {
  //     // Retornar valor de error estándar KNX o manejar excepción
  //     console.warn("DPT9: Valor inválido, enviando buffer vacío/error");
  //     return Buffer.from([0x7f, 0xff]);
  //   }

  //   // 2. Cálculo matemático
  //   // FloatValue = (0.01 * M) * 2^E
  //   let m = value / 0.01;
  //   let e = 0;

  //   // 3. Normalización: Buscar encajar M en 11 bits [-2048, 2047]
  //   while ((m > 2047 || m < -2048) && e < 15) {
  //     m /= 2;
  //     e++;
  //   }

  //   // Redondeo final
  //   let mInt = Math.round(m);

  //   // 4. Clamping (Asegurar límites para no romper el protocolo)
  //   if (mInt > 2047) mInt = 2047;
  //   if (mInt < -2048) mInt = -2048;

  //   // Caso especial: Evitar la colisión con "Invalid Data" (0x7FFF) si se diera el caso extremo
  //   if (e === 15 && mInt > 2046) mInt = 2046;

  //   // 5. Empaquetado
  //   // El signo se maneja automáticamente en la mantisa de 11 bits (complemento a 2)
  //   // pero KNX requiere que el bit de signo esté explícitamente en el bit 15 (MSB del buffer)
  //   const signBit = mInt < 0 ? 1 : 0;

  //   // Máscara 0x7FF (2047) obtiene los 11 bits bajos de la mantisa (sea positiva o negativa)
  //   const mantissaBits = mInt & 0x7ff;

  //   // Estructura: S (1 bit) | E (4 bits) | M (11 bits)
  //   const encoded = (signBit << 15) | ((e & 0x0f) << 11) | mantissaBits;

  //   const buffer = Buffer.alloc(2);
  //   buffer.writeUInt16BE(encoded, 0);
  //   return buffer;
  // }

  /**
   * Escribe los datos en el datagrama.
   * @param datagram PDU
   * @param data
   * @param dataStart Debe ser siempre en el indice donde están los bits menos significativos del APCI
   * @param isShort Si es true, el dato se incrusta en los 6 bits del APCI (DPT 1, 2, 3)
   */
  static WriteData(datagram: Buffer, data: Buffer, dataStart: number, isShort: boolean = false) {
    if (!data || data.length === 0) return;

    // ESTRATEGIA: DPT9 (Float 16-bit)
    // Asumimos que si vienen 4 bytes, es un Float32 crudo que debe convertirse a DPT9
    // !! No es necesario si ya hay una clase que lo codifica, decidir procesarlo aqui desafia lo que se espera de esta escritura
    // if (data.length === 4) {
    //   const floatValue = data.readFloatLE(0);
    //   const dpt9Buffer = this.encodeFloatToDPT9(floatValue);

    //   // DPT9 siempre ocupa 2 bytes y va después del byte de control APCI
    //   datagram[dataStart + 1] = dpt9Buffer[0];
    //   datagram[dataStart + 2] = dpt9Buffer[1];
    //   return;
    // }

    // ESTRATEGIA: Optimización "Short Data" (6 bits)
    // Si es 1 byte y el valor es pequeño (<= 0x3F), asumimos que es DPT1/2/3 y lo incrustamos.
    if (data.length === 1 && data[0] <= 0x3f || isShort) {
      // Usamos OR para mezclar los 6 bits bajos con el comando existente en dataStart
      datagram[dataStart] = (datagram[dataStart] & 0xc0) | (data[0] & 0x3f);
      return;
    }

    // ESTRATEGIA: Datos estándar (> 6 bits o arrays largos)
    // Se escriben a partir del siguiente byte (dataStart + 1)
    datagram[dataStart] = datagram[dataStart] & 0xc0; // Limpiamos la parte de datos del byte de control

    for (var i = 0; i < data.length; i++) {
      datagram[dataStart + 1 + i] = data[i];
    }
  }

  /**
   * Verifica si una dirección de grupo KNX es válida.
   * Los formatos admitidos son:
   *   - 3 niveles: "main/middle/sub" donde:
   *       main: 0-31, middle: 0-7, sub: 0-255.
   *   - 2 niveles: "main/sub" donde:
   *       main: 0-31, sub: 0-2047.
   *   - 1 nivel: un número entre 0 y 65535.
   *
   * @param address Dirección de grupo en formato string.
   * @returns true si la dirección es válida; false en caso contrario.
   */
  static isValidGroupAddress(address: string): boolean {
    const threeLevelRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{1,3})$/;
    const twoLevelRegex = /^(\d{1,2})\/(\d{1,4})$/;
    const oneLevelRegex = /^\d+$/;

    let match;
    if ((match = address.match(threeLevelRegex))) {
      const main = parseInt(match[1], 10);
      const middle = parseInt(match[2], 10);
      const sub = parseInt(match[3], 10);
      return main >= 0 && main <= 31 && middle >= 0 && middle <= 7 && sub >= 0 && sub <= 255;
    } else if ((match = address.match(twoLevelRegex))) {
      const main = parseInt(match[1], 10);
      const sub = parseInt(match[2], 10);
      return main >= 0 && main <= 31 && sub >= 0 && sub <= 2047;
    } else if (oneLevelRegex.test(address)) {
      const value = parseInt(address, 10);
      return value >= 0 && value <= 65535;
    }
    return false;
  }

  /**
   * Verifica si una dirección individual KNX es válida.
   * Formato válido: "area.line.device" donde:
   *   - area: 0–15
   *   - line: 0–15
   *   - device: 0–255
   *
   * @param address Dirección individual en formato string.
   * @returns true si la dirección es válida; false en caso contrario.
   */
  static isValidIndividualAddress(address: string): boolean {
    const regex = /^(\d{1,2})\.(\d{1,2})\.(\d{1,3})$/;
    const match = address.match(regex);
    if (!match) return false;

    const area = parseInt(match[1], 10);
    const line = parseInt(match[2], 10);
    const device = parseInt(match[3], 10);

    return area >= 0 && area <= 15 && line >= 0 && line <= 15 && device >= 0 && device <= 255;
  }

  /**
   * Verifica si un Buffer de 2 octetos representa una dirección de grupo KNX válida.
   *
   * Se asume que la dirección se codifica en 2 bytes (0–65535).
   *
   * @param buffer Buffer con la dirección de grupo.
   * @returns true si el buffer es válido; false en caso contrario.
   */
  static isValidGroupAddressBuffer(buffer: Buffer): boolean {
    if (buffer.length !== 2) return false;
    const value = buffer.readUInt16BE(0);
    return value >= 0 && value <= 65535;
  }
}
