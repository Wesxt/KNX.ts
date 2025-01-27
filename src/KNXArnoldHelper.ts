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

import { InvalidKnxAddressException } from "./InvalidKnxAddresExeption";

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
export class KNXArnoldHelper {
  static Idexp(mantissa: number, exponent: number) {
    return exponent > 1023 // avoid multiplying by infinity
      ? mantissa * Math.pow(2, 1023) * Math.pow(2, exponent - 1023)
      : exponent < -1074 // avoid multiplying by zero
        ? mantissa * Math.pow(2, -1074) * Math.pow(2, exponent + 1074)
        : mantissa * Math.pow(2, exponent);
  }
  static frexp(value: number) {
    if (value === 0) return [value, 0];
    let data = new DataView(new ArrayBuffer(8))
    data.setFloat64(0, value)
    let bits = (data.getUint32(0) >>> 20) & 0x7FF;
    if (bits === 0) {
      data.setFloat64(0, value * Math.pow(2, 64));
      bits = ((data.getUint32(0) >>> 20) & 0x7FF) - 64;
    }
    let exponent = bits - 1022,
      mantissa = this.Idexp(value, -exponent)
    return [mantissa, exponent]
  }
  static IsAddressIndividual(address: string) {
    return address.indexOf('.') !== -1;
  }
  static GetIndividualAddress(addr: Buffer) {
    return this.GetAddress(addr, '.', false);
  }

  static GetGroupAddress(addr: Buffer, threeLevelAddressing: unknown) {
    return this.GetAddress(addr, '/', threeLevelAddressing);
  }
  static GetAddress(addr: Buffer, separator?: string, threeLevelAddressing?: unknown) {
    if (addr && !separator && (threeLevelAddressing === null || threeLevelAddressing == undefined)) {
      return this.GetAddress_(addr as unknown as string)
    }
    let group = separator === '/';
    let address = null;
    if (group && !threeLevelAddressing) {
      // 2 level group
      address = (addr[0] >> 3).toString();
      address += separator;
      address += (((addr[0] & 0x07) << 8) + addr[1]).toString(); // this may not work, must be checked
    }
    else {
      // 3 level individual or group
      address = group
        ? ((addr[0] & 0xFF) >> 3).toString()
        : (addr[0] >> 4).toString();
      address += separator;
      if (group)
        address += (addr[0] & 0x07).toString();
      else
        address += (addr[0] & 0x0F).toString();
      address += separator;
      address += addr[1].toString();
    }
    return address;
  }
  static GetAddress_(address: string) {
    try {
      let addr = Buffer.alloc(2);
      let threeLevelAddressing = true;
      let parts;
      let group = address.indexOf('/') !== -1;
      if (!group) {
        // individual address
        parts = address.split('.');
        if (parts.length != 3 || parts[0].length > 2 || parts[1].length > 2 || parts[2].length > 3)
          throw new InvalidKnxAddressException(address);
      }
      else {
        // group address
        parts = address.split('/');
        if (parts.length != 3 || parts[0].length > 2 || parts[1].length > 1 || parts[2].length > 3) {
          if (parts.length != 2 || parts[0].length > 2 || parts[1].length > 4)
            throw new InvalidKnxAddressException(address);
          threeLevelAddressing = false;
        }
      }
      if (!threeLevelAddressing) {
        var part = parseInt(parts[0]);
        if (part > 15)
          throw new InvalidKnxAddressException(address);
        addr[0] = (part << 3) & 255;
        part = parseInt(parts[1]);
        if (part > 2047)
          throw new InvalidKnxAddressException(address);
        var part2 = Buffer.alloc(2);
        part2.writeUInt16BE(part, 0);
        if (part2.length > 2)
          throw new InvalidKnxAddressException(address);
        addr[0] = (addr[0] | part2[0]) & 255;
        addr[1] = part2[1];
      }
      else {
        var part = parseInt(parts[0]);
        if (part > 31)
          throw new InvalidKnxAddressException(address);
        addr[0] = group
          ? ((part << 3) & 255)
          : ((part << 4) & 255);
        part = parseInt(parts[1]);
        if ((group && part > 7) || (!group && part > 15))
          throw new InvalidKnxAddressException(address);
        addr[0] = (addr[0] | part) & 255;
        part = parseInt(parts[2]);
        if (part > 255)
          throw new InvalidKnxAddressException(address);
        addr[1] = part & 255;
      }
      return addr;
    }
    catch (e) {
      throw new InvalidKnxAddressException(address);
    }
  }
  // Bit order
  // +---+---+---+---+---+---+---+---+
  // | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
  // +---+---+---+---+---+---+---+---+

  //  Control Field 1

  //   Bit  |
  //  ------+---------------------------------------------------------------
  //    7   | Frame Type  - 0x0 for extended frame
  //        |               0x1 for standard frame
  //  ------+---------------------------------------------------------------
  //    6   | Reserved
  //        |
  //  ------+---------------------------------------------------------------
  //    5   | Repeat Flag - 0x0 repeat frame on medium in case of an error
  //        |               0x1 do not repeat
  //  ------+---------------------------------------------------------------
  //    4   | System Broadcast - 0x0 system broadcast
  //        |                    0x1 broadcast
  //  ------+---------------------------------------------------------------
  //    3   | Priority    - 0x0 system
  //        |               0x1 normal (also called alarm priority)
  //  ------+               0x2 urgent (also called high priority)
  //    2   |               0x3 low
  //        |
  //  ------+---------------------------------------------------------------
  //    1   | Acknowledge Request - 0x0 no ACK requested
  //        | (L_Data.req)          0x1 ACK requested
  //  ------+---------------------------------------------------------------
  //    0   | Confirm      - 0x0 no error
  //        | (L_Data.con) - 0x1 error
  //  ------+---------------------------------------------------------------


  //  Control Field 2

  //   Bit  |
  //  ------+---------------------------------------------------------------
  //    7   | Destination Address Type - 0x0 individual address
  //        |                          - 0x1 group address
  //  ------+---------------------------------------------------------------
  //   6-4  | Hop Count (0-7)
  //  ------+---------------------------------------------------------------
  //   3-0  | Extended Frame Format - 0x0 standard frame
  //  ------+---------------------------------------------------------------
  static KnxDestinationAddressType = {
    INDIVIDUAL: 0,
    GROUP: 1
  }
  static GetKnxDestinationAddressType(control_field_2: number) {
    return (0x80 & control_field_2) != 0
      ? this.KnxDestinationAddressType.GROUP
      : this.KnxDestinationAddressType.INDIVIDUAL;
  }
  // In the Common EMI frame, the APDU payload is defined as follows:

  // +--------+--------+--------+--------+--------+
  // | TPCI + | APCI + |  Data  |  Data  |  Data  |
  // |  APCI  |  Data  |        |        |        |
  // +--------+--------+--------+--------+--------+
  //   byte 1   byte 2  byte 3     ...     byte 16

  // For data that is 6 bits or less in length, only the first two bytes are used in a Common EMI
  // frame. Common EMI frame also carries the information of the expected length of the Protocol
  // Data Unit (PDU). Data payload can be at most 14 bytes long.  <p>

  // The first byte is a combination of transport layer control information (TPCI) and application
  // layer control information (APCI). First 6 bits are dedicated for TPCI while the two least
  // significant bits of first byte hold the two most significant bits of APCI field, as follows:

  //   Bit 1    Bit 2    Bit 3    Bit 4    Bit 5    Bit 6    Bit 7    Bit 8      Bit 1   Bit 2
  // +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
  // |        |        |        |        |        |        |        |        ||        |
  // |  TPCI  |  TPCI  |  TPCI  |  TPCI  |  TPCI  |  TPCI  | APCI   |  APCI  ||  APCI  |
  // |        |        |        |        |        |        |(bit 1) |(bit 2) ||(bit 3) |
  // +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
  // +                            B  Y  T  E    1                            ||       B Y T E  2
  // +-----------------------------------------------------------------------++-------------....

  //Total number of APCI control bits can be either 4 or 10. The second byte bit structure is as follows:

  //   Bit 1    Bit 2    Bit 3    Bit 4    Bit 5    Bit 6    Bit 7    Bit 8      Bit 1   Bit 2
  // +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
  // |        |        |        |        |        |        |        |        ||        |
  // |  APCI  |  APCI  | APCI/  |  APCI/ |  APCI/ |  APCI/ | APCI/  |  APCI/ ||  Data  |  Data
  // |(bit 3) |(bit 4) | Data   |  Data  |  Data  |  Data  | Data   |  Data  ||        |
  // +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
  // +                            B  Y  T  E    2                            ||       B Y T E  3
  // +-----------------------------------------------------------------------++-------------....
  static GetData(dataLength: number, apdu: Buffer) {
    switch (dataLength) {
      case 0:
        return '';
      case 1:
        //TODO: originally, here is utf code to char convert (String.fromCharCode).
        // return parseInt(0x3F & apdu[1], 10).toString();
        // Interpreta el segundo byte con la máscara 0x3F.
      // Devuelve el valor del byte con la máscara 0x3F como una cadena.
      return (0x3F & apdu[1]).toString();
      case 2:
        //TODO: originally, here is utf code to char convert (String.fromCharCode).
        // Interpreta el tercer byte como un carácter Unicode.
      return String.fromCharCode(apdu[2]);
      case 3:
        var sign = apdu[2] >> 7;
        var exponent = (apdu[2] & 0b01111000) >> 3;
        var mantissa = 256 * (apdu[2] & 0b00000111) + apdu[3];
        mantissa = (sign == 1) ? ~(mantissa ^ 2047) : mantissa;

        //TODO: originally, here is utf code to char convert (String.fromCharCode).
        return this.Idexp((0.01 * mantissa), exponent).toString();
      default:
        var data = Buffer.alloc(apdu.length);
        //TODO: originally, here is utf code to char convert (String.fromCharCode).
        apdu.copy(data);
        return data;
    }
  }
  static GetDataLength(data: Buffer) {
    if (data.length <= 0)
      return 0;
    if (data.length == 1 && data[0] < 0x3F)
      return 1;
    if (data.length == 4)
      return 3;
    if (data[0] < 0x3F)
      return data.length;
    return data.length + 1;
  }
  static WriteData(datagram: Buffer, data: Buffer, dataStart: number) {
    if (data.length == 1) {
      if (data[0] < 0x3F) {
        datagram[dataStart] = (datagram[dataStart] | data[0]) & 255;
      }
      else {
        datagram[dataStart + 1] = data[0];
      }
    } else if (data.length == 4) {
      let value = data.readFloatLE(0);
      let apdu_data;
      if (!isFinite(value)) {
        console.log("DPT9: cannot write non-numeric or undefined value");
      } else {
        let arr = this.frexp(value);
        let mantissa = arr[0], exponent = arr[1];
        // find the minimum exponent that will upsize the normalized mantissa (0,5 to 1 range)
        // in order to fit in 11 bits ([-2048, 2047])
        let max_mantissa = 0;
        let e
        for (e = exponent; e >= -15; e--) {
          max_mantissa = this.Idexp(100 * mantissa, e);
          if (max_mantissa > -2048 && max_mantissa < 2047) break;
        }
        let sign = (mantissa < 0) ? 1 : 0
        let mant = (mantissa < 0) ? ~(max_mantissa ^ 2047) : max_mantissa
        let exp = exponent - e;
        apdu_data = Buffer.alloc(2);
        // yucks
        apdu_data[0] = (sign << 7) + (exp << 3) + (mant >> 8);
        apdu_data[1] = mant % 256;
      }
      if (apdu_data) {
        datagram[dataStart + 1] = apdu_data[0];
        datagram[dataStart + 2] = apdu_data[1];
      } else {
        throw new Error("apdu_data is not defined")
      }
    } else if (data.length > 1) {
      if (data[0] < 0x3F) {
        datagram[dataStart] = (datagram[dataStart] | data[0]) & 255;
        for (var i = 1; i < data.length; i++) {
          datagram[dataStart + i] = data[i];
        }
      }
      else {
        for (var i = 0; i < data.length; i++) {
          datagram[dataStart + 1 + i] = data[i];
        }
      }
    }
  }
  static SERVICE_TYPE = {
    /**
     * 0x0201
     */
    SEARCH_REQUEST: 0x0201,
    /**
     * 0x0202
     */
    SEARCH_RESPONSE: 0x0202,
    /**
     * 0x0203
     */
    DESCRIPTION_REQUEST: 0x0203,
    /**
     * 0x0204
     */
    DESCRIPTION_RESPONSE: 0x0204,
    /**
     * 0x0205
     */
    CONNECT_REQUEST: 0x0205,
    /**
     * 0x0206
     */
    CONNECT_RESPONSE: 0x0206,
    /**
     * 0x0207
     */
    CONNECTIONSTATE_REQUEST: 0x0207,
    /**
     * 0x0208
     */
    CONNECTIONSTATE_RESPONSE: 0x0208,
    /**
     * 0x0209
     */
    DISCONNECT_REQUEST: 0x0208,
    /**
     * 0x020A
     */
    DISCONNECT_RESPONSE: 0x020a,
    /**
     * 0x0310
     */
    DEVICE_CONFIGURATION_REQUEST: 0x0310,
    /**
     * 0x0311
     */
    DEVICE_CONFIGURATION_ACK: 0x0311,
    /**
     * 0x0420
     */
    TUNNELLING_REQUEST: 0x0420,
    /**
     * 0x0421
     */
    TUNNELLING_ACK: 0x0421,
    /**
     * 0x0530
     */
    ROUTING_INDICATION: 0x0530,
    /**
     * 0x0531
     */
    ROUTING_LOST_MESSAGE: 0x0531,
    /**
     * UNKNOWN = -1
     */
    UNKNOWN: -1
  }
  static GetServiceType(datagram: Buffer) {
    switch (datagram[2]) {
      case (0x02):
        {
          switch (datagram[3]) {
            case (0x06):
              return this.SERVICE_TYPE.CONNECT_RESPONSE;
            case (0x09):
              return this.SERVICE_TYPE.DISCONNECT_REQUEST;
            case (0x08):
              return this.SERVICE_TYPE.CONNECTIONSTATE_RESPONSE;
          }
        }
        break;
      case (0x04):
        {
          switch (datagram[3]) {
            case (0x20):
              return this.SERVICE_TYPE.TUNNELLING_REQUEST;
            case (0x21):
              return this.SERVICE_TYPE.TUNNELLING_ACK;
          }
        }
        break;
    }
    return this.SERVICE_TYPE.UNKNOWN;
  }
  GetChannelID(datagram: Buffer) {
    if (datagram.length > 6)
      return datagram[6];
    return -1;
  }
}
