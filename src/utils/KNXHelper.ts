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
   * Parses a KNX Buffer (2 bytes) into its string representation according to the specified format.
   * If `addr` is a string, delegates to {@link GetAddress_} to return a Buffer.
   * @param addr 2-byte Buffer containing the raw address, a numeric 16-bit address, or a string address.
   * @param separator Visual separator ("." for Individual, "/" for Group). Defaults to Group ("/").
   * @param threeLevelAddressing If true, forces 3-level group format (x/y/z). If false and group, uses 2-level (x/y).
   */
  static GetAddress(addr: string, separator?: "." | "/", threeLevelAddressing?: boolean): Buffer;
  static GetAddress(addr: number, separator?: "." | "/", threeLevelAddressing?: boolean): string;
  static GetAddress(addr: Buffer, separator?: "." | "/", threeLevelAddressing?: boolean): string;
  static GetAddress(
    addr: Buffer | string | number,
    separator: "." | "/" = "/",
    threeLevelAddressing: boolean = true,
  ): Buffer | string {
    // 1. String case: delegate to GetAddress_
    if (typeof addr === "string") {
      return this.GetAddress_(addr);
    }

    // 2. Number case: convert to 2-byte Buffer and recurse
    if (typeof addr === "number") {
      const buffer = Buffer.alloc(2);
      buffer.writeUint16BE(addr & 0xffff);
      return this.GetAddress(buffer, separator, threeLevelAddressing) as string;
    }

    // 3. Buffer case
    if (Buffer.isBuffer(addr)) {
      if (addr.length < 2) {
        throw new Error("KNX Address buffer must be at least 2 bytes");
      }

      const highByte = addr[0];
      const lowByte = addr[1];
      const isGroup = separator === "/";

      // Case A: 2-level Group Address (Main/Sub11)
      if (isGroup && !threeLevelAddressing) {
        const main = highByte >> 3; // 5 bits
        const sub = ((highByte & 0x07) << 8) | lowByte; // 3 high bits + 8 low bits (bitwise OR is safer than +)

        return `${main}/${sub}`;
      }

      // Case B: 3-level Group Address (Main/Mid/Sub)
      if (isGroup) {
        const main = (highByte >> 3) & 0x1f; // 5 bits (0-31)
        const middle = highByte & 0x07; // 3 bits (0-7)
        const sub = lowByte; // 8 bits (0-255)

        return `${main}/${middle}/${sub}`;
      }

      // Case C: Individual Address (Area.Line.Device)
      // Standard: Area (4 bits), Line (4 bits), Device (8 bits)
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
    const addr = Buffer.alloc(2);
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
      const addr = Buffer.alloc(2);
      let threeLevelAddressing = true;
      let parts;
      const group = address.indexOf("/") !== -1;
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
        const part2 = Buffer.alloc(2);
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      throw new InvalidKnxAddressException(address);
    }
  }

  static GetDataLength(data: Buffer, isShort: boolean = false) {
    if (data.length <= 0) return 0;
    if (isShort) return 1;
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
   * Writes data into the datagram.
   * @param datagram PDU
   * @param data Payload buffer
   * @param dataStart Index of the byte containing the least significant bits of the APCI
   * @param isShort If true, the data is embedded in the 6 bits of the APCI (DPT 1, 2, 3)
   */
  static WriteData(datagram: Buffer, data: Buffer, dataStart: number, isShort: boolean = false) {
    if (!data || data.length === 0) return;

    // STRATEGY: "Short Data" optimization (6 bits)
    // If 1 byte and small value (<= 0x3F), assume DPT1/2/3 and embed it.
    if (isShort) {
      // Use OR to merge the lower 6 bits with the existing command at dataStart
      datagram[dataStart] = (datagram[dataStart] & 0xc0) | (data[0] & 0x3f);
      return;
    }

    // STRATEGY: Standard data (> 6 bits or longer arrays)
    // Written starting at the next byte (dataStart + 1)
    for (let i = 0; i < data.length; i++) {
      datagram[dataStart + 1 + i] = data[i];
    }
  }

  /**
   * Checks whether a KNX group address string is valid.
   * Supported formats:
   *   - 3-level: "main/middle/sub" where:
   *       main: 0-31, middle: 0-7, sub: 0-255.
   *   - 2-level: "main/sub" where:
   *       main: 0-31, sub: 0-2047.
   *   - 1-level: a number between 0 and 65535.
   *
   * @param address Group address string.
   * @returns true if the address is valid; false otherwise.
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
   * Checks whether a KNX individual address string is valid.
   * Valid format: "area.line.device" where:
   *   - area: 0–15
   *   - line: 0–15
   *   - device: 0–255
   *
   * @param address Individual address string.
   * @returns true if the address is valid; false otherwise.
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
   * Converts a numeric 16-bit KNX individual address to string (`"area.line.device"`).
   *
   * @param address 16-bit encoded individual address (`0..65535`, e.g. `0x1101` -> `"1.1.1"`).
   * @returns Individual address in `"area.line.device"` format.
   */
  static individualAddressToString(address: number): string {
    if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
      throw new InvalidKnxAddressException(`Invalid individual address number: ${address}`);
    }
    const area = (address >> 12) & 0x0f;
    const line = (address >> 8) & 0x0f;
    const device = address & 0xff;
    return `${area}.${line}.${device}`;
  }

  /**
   * Checks whether a 2-octet Buffer represents a valid KNX group address.
   *
   * Assumes the address is encoded in 2 bytes (0–65535).
   *
   * @param buffer Buffer containing the group address.
   * @returns true if the buffer is valid; false otherwise.
   */
  static isValidGroupAddressBuffer(buffer: Buffer): boolean {
    if (buffer.length !== 2) return false;
    const value = buffer.readUInt16BE(0);
    return value >= 0 && value <= 65535;
  }
}
