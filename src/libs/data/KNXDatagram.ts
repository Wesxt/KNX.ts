import { KNXHelper } from "../utils/class/KNXHelper";
// TODO: Its implementation must be improved and validations added to make it a guaranteed valid datagram.
export class KnxDatagram {
  /**Header => int */
  header_length?: number;
  /** Header => byte */
  protocol_version?: number;
  /**Header => byte[] */
  service_type?: Buffer;
  /**Header => int */
  total_length?: number;
  /**Connection => byte */
  channel_id?: number;
  /**Connection => byte */
  status?: number;
  /** CEMI => byte */
  message_code?: number;
  /**CEMI => int */
  additional_info_length?: number;
  /**CEMI => byte[] */
  additional_info?: Buffer;
  /**CEMI => byte */
  control_field_1?: number;
  /**CEMI => byte */
  control_field_2?: number;
  /**CEMI => string */
  source_address?: string | Buffer;
  /**CEMI => string */
  destination_address?: string | Buffer;
  /**CEMI => int */
  data_length?: number;
  /**CEMI => byte[] */
  apdu?: Buffer;
  /**CEMI => string */
  data?: string | Buffer;

  constructor(options: {
      /**Header => int */
  header_length?: number;
  /** Header => byte */
  protocol_version?: number;
  /**Header => byte[] */
  service_type?: Buffer;
  /**Header => int */
  total_length?: number;
  /**Connection => byte */
  channel_id?: number;
  /**Connection => byte */
  status?: number;
  /** CEMI => byte */
  message_code?: number;
  /**CEMI => int */
  additional_info_length?: number;
  /**CEMI => byte[] */
  additional_info?: Buffer;
  /**CEMI => byte */
  control_field_1?: number;
  /**CEMI => byte */
  control_field_2?: number;
  /**CEMI => string */
  source_address?: string | Buffer;
  /**CEMI => string */
  destination_address?: string;
  /**CEMI => int */
  data_length?: number;
  /**CEMI => byte[] */
  apdu?: Buffer;
  /**CEMI => string */
  data?: string;
  }) {
    // HEADER
    this.header_length = options.header_length;
    this.protocol_version = options.protocol_version;
    this.service_type = options.service_type;
    this.total_length = options.total_length;

    // CONNECTION
    this.channel_id = options.channel_id;
    this.status = options.status;

    // CEMI
    this.message_code = options.message_code;
    this.additional_info_length = options.additional_info_length;
    this.additional_info = options.additional_info;
    this.control_field_1 = options.control_field_1;
    this.control_field_2 = options.control_field_2;
    this.source_address = options.source_address;
    this.destination_address = options.destination_address;
    this.data_length = options.data_length;
    this.apdu = options.apdu;
    this.data = options.data;
  }

  /**
   * Returns a buffer of the created instance, it is not guaranteed to be exactly a valid datagram of the protocol
   * @returns {Buffer}
   */
  toBuffer(): Buffer<ArrayBuffer> {
    const buffer = Buffer.alloc(this.total_length as number);

    buffer.writeUInt8(this.header_length as number, 0); 
    buffer.writeUInt8(this.protocol_version as number, 1);
    if (this.service_type) {
      buffer.writeUInt8(this.service_type[0], 2);
      buffer.writeUInt8(this.service_type[1], 3);
    }
    if(this.total_length) {
      const totalLengthBuf = Buffer.alloc(2, this.total_length)
      buffer[4] = totalLengthBuf[0]
      buffer[5] = totalLengthBuf[1]
    }
    buffer.writeUint8(this.channel_id as number, 6)
    buffer.writeUint8(this.status as number, 7)
    buffer.writeUint8(1, 8) // sequence counter
    
    buffer.writeUint8(0, 9) // reserved
    buffer.writeUint8(this.message_code as number, 10)
    buffer[11] = this.additional_info?.readUint8() as number
    buffer.writeUint8(this.control_field_1 as number, 12)
    buffer.writeUint8(this.control_field_2 as number, 13)
    const addressSource = KNXHelper.addressToBuffer(this.source_address as string)
    const addressDestination = KNXHelper.addressToBuffer(this.destination_address as string)
    buffer[14] = addressSource[0]
    buffer[15] = addressSource[1]
    buffer[16] = addressDestination[0]
    buffer[17] = addressDestination[1]
    buffer.writeUint8(this.data_length as number, 18)
    if(this.apdu) {
      buffer[19] = this.apdu[0]
      buffer[20] = this.apdu[1]
    }
    return buffer;
  }

  
  /**
   * Returns a string representation of the KNX datagram.
   *
   * The string includes detailed information about the header, connection, and CEMI (Common External Message Interface) sections of the datagram.
   *
   * @returns {string} A formatted string containing the datagram details.
   */
  toString() {
    return `
      -------------Header------------------
      Header Length: ${this.header_length}
      Protocol Version: ${this.protocol_version}
      Service Type: ${this.service_type}
      Total Length: ${this.total_length}
      -------------Header------------------

      -------------Connection--------------
      Channel ID: ${this.channel_id}
      Status: ${this.status}
      -------------Connection--------------

      -------------CEMI--------------------
      Message Code: ${this.message_code}
      Additional Info Length: ${this.additional_info_length}
      Control Field 1: ${this.control_field_1}
      Control Field 2: ${this.control_field_2}
      Source Address: ${this.source_address}
      Destination Address: ${this.destination_address}
      Data Length: ${this.data_length}
      APDU: ${this.apdu}
      Data: ${this.data}
      -------------CEMI--------------------
    `;
  }
}

// Exportar la clase como módulo
export default KnxDatagram;
