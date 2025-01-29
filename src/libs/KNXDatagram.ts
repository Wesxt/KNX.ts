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

  // Método para construir un datagrama en formato Buffer
  toBuffer() {
    const buffer = Buffer.alloc(this.total_length as number); // Crear un buffer con la longitud total

    // Ejemplo: Escribir datos en el buffer (esto debe adaptarse a tu protocolo)
    buffer.writeUInt8(this.header_length as number, 0); // Escribir la longitud del encabezado
    buffer.writeUInt8(this.protocol_version as number, 1); // Escribir la versión del protocolo

    // Aquí deberás continuar escribiendo los campos según el formato esperado
    // y asegurarte de manejar correctamente los offsets en el buffer.
    // buffer.writeUint8(this.message_code, )
    return buffer;
  }

  // Método para mostrar información del datagrama como texto legible
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
