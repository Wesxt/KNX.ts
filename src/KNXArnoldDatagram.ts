class KNXArnoldDatagram {
      /**
       * HEADER => 
     * Longitud del encabezado - int
     */
  header_length: number;
  /**
   * HEADER => 
   * Versión del protocolo - byte
   */
  protocol_version: number;
  /**
   * HEADER =>
   * Tipo de servicio - byte[]
   */
  service_type: number;
  /**
   * HEADER =>
   * Longitud total - int
   */
  total_length: number;
  /**
   * CONNECTION =>
   * ID del canal - byte
   */
  channel_id: number;
  /**
   * CONNECTION =>
   * Estado de conexión
   */
  status: number;
  /**
   * CEMI =>
   * Código del mensaje
   */
  message_code: number;
  /**
   * CEMI =>
   * Longitud de información adicional
   */
  additional_info_length: number;
  /**
   * CEMI =>
   * Información adicional
   */
  additional_info: any;
  /**
   * CEMI =>
   * Campo de control 1
   */
  control_field_1: number;
  /**
   * CEMI =>
   * Campo de control 2
   */
  control_field_2: number;
  /**
   * CEMI =>
   * Dirección de origen
   */
  source_address: string;
  /**
   * CEMI =>
   * Dirección de destino
   */
  destination_address: string;
  /**
   * CEMI =>
   * Longitud de datos
   */
  data_length: number;
  /**
   * CEMI =>
   * APDU (Application Protocol Data Unit)
   */
  apdu: any;
  /**
   * CEMI =>
   * Datos
   */
  data: any;

  constructor(options: any) {
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
    const buffer = Buffer.alloc(this.total_length); // Crear un buffer con la longitud total

    // Ejemplo: Escribir datos en el buffer (esto debe adaptarse a tu protocolo)
    buffer.writeUInt8(this.header_length, 0); // Escribir la longitud del encabezado
    buffer.writeUInt8(this.protocol_version, 1); // Escribir la versión del protocolo

    // Aquí deberás continuar escribiendo los campos según el formato esperado
    // y asegurarte de manejar correctamente los offsets en el buffer.
    // buffer.writeUint8(this.message_code, )
    return buffer;
  }

  // Método para mostrar información del datagrama como texto legible
  toString() {
    return `
      Header Length: ${this.header_length}
      Protocol Version: ${this.protocol_version}
      Service Type: ${this.service_type}
      Total Length: ${this.total_length}
      Channel ID: ${this.channel_id}
      Status: ${this.status}
      Message Code: ${this.message_code}
      Additional Info Length: ${this.additional_info_length}
      Control Field 1: ${this.control_field_1}
      Control Field 2: ${this.control_field_2}
      Source Address: ${this.source_address}
      Destination Address: ${this.destination_address}
      Data Length: ${this.data_length}
      APDU: ${this.apdu}
      Data: ${this.data}
    `;
  }
}

// Exportar la clase como módulo
export default KNXArnoldDatagram;
