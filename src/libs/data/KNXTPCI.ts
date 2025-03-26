/**
 * Este enumerable se basa en el esquema numero 3 del titulo "2. TPDU" del documento "Transport Layer of the KNX System, Version 01.02.03"
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "Transport Layer of the KNX System, Version 01.02.03"
 */
export enum TPCIType {
  /** Destination address = 0
   * - The T_Data_Broadcast service shall be applied by the user of Transport Layer, to transmit a TSDU (Transport Service Data Unit) over a connectionless communication mode to all remote partners.
   */
  T_DATA_BROADCAST_PDU = 0x00,
  /** Destination address ≠ 0
   * - The T_Data_Group service shall be applied by the user of Transport Layer, to transmit a TSDU (Transport Service Data Unit) over a multicast communication mode to one or more remote partners.
   */
  T_DATA_GROUP_PDU = 0x01,
  /** The T_Data_Tag_Group-service shall be applied by the user of Transport Layer, to transmit a TSDU over a multicast communication mode to one or more remote partners. */
  T_DATA_TAG_GROUP_PDU = 0x00,
  /** PDU (Protocol Data Unit) individual
   * - The T_Data_Individual service shall be applied by the user of Transport Layer, to transmit a TSDU over a connectionless point-to-point communication mode to exactly one remote partner.
   */
  T_DATA_INDIVIDUAL_PDU = 0x01,
  /** PDU (Protocol Data Unit) connected
   * - The T_Data_Connected service shall b applied by the user of Transport Layer, to transmit a TSDU over a Transport Layer connection on a connection-oriented communication mode to a remote partner.
   */
  T_DATA_CONNECTED_PDU = 0x10,
  /** Establish connection
   * - The T_Connect service shall be applied by the user of Transport Layer, to establish a Transport Layer connection on a connection-oriented point-to-point communication mode.
  */
  T_CONNECT_PDU = 0x80,
  /** End connection
   * - The T_Disconnect service shall be applied by the user of Transport Layer, to release a Transport Layer connection on a connection-oriented point-to-point communication mode.
   */
  T_DISCONNECT_PDU = 0x81,
  /** Acknowledgement */
  T_ACK_PDU = 0xC0,
  /** Negative Acknowledgement */
  T_NAK_PDU = 0xC1
}

/**
 * Clase para manejar el TPCI (Transport Protocol Control Field)
 * en KNX, correspondiente al primer octeto del TPDU (Transport Layer Protocol Data Unit).
 *
 * **Estructura del TPCI (8 bits):**
 *   - Bit 7         : Data/Control Flag (1 = Control, 0 = Data)
 *   - Bit 6         : Numbered flag (1 = Mensaje numerado, 0 = No numerado)
 *   - Bits 5..2     : Número de secuencia (4 bits: 0..15)
 *   - Bits 1..0     : Reservados para el Application Layer Control Field (APCI) (se fijan a 0)
 * 
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "Transport Layer of the KNX System, Version 01.02.03"
 */
export class KNXTPCI {
  private _buffer: Buffer;

  constructor(initialValue: TPCIType = 0) {
    this._buffer = Buffer.alloc(1);
    this.setValue(initialValue);
  }

  /**
   * Devuelve el valor crudo (8 bits) del TPCI.
   */
  getValue(): number {
    return this._buffer[0];
  }

  /**
   * Asigna el valor crudo (8 bits) del TPCI.
   */
  setValue(value: number): void {
    this._buffer[0] = value & 0xFF;
  }

  /**
   * Data/Control Flag (Bit 7):
   * - true  → Bit 7 = 1 (Control)
   * - false → Bit 7 = 0 (Data)
   */
  get dataControlFlag(): boolean {
    return ((this._buffer[0] >> 7) & 0x01) === 1;
  }

  set dataControlFlag(flag: boolean) {
    if (flag) {
      this._buffer[0] |= 0x80; // Fija bit7 en 1
    } else {
      this._buffer[0] &= 0x7F; // Limpia bit7
    }
  }

  /**
   * Numbered Flag (Bit 6):
   * - true  → Bit 6 = 1 (Mensaje numerado)
   * - false → Bit 6 = 0 (No numerado)
   */
  get numberedFlag(): boolean {
    return ((this._buffer[0] >> 6) & 0x01) === 1;
  }

  set numberedFlag(flag: boolean) {
    if (flag) {
      this._buffer[0] |= 0x40; // Fija bit6 en 1
    } else {
      this._buffer[0] &= 0xBF; // 0xBF = 10111111, limpia bit6
    }
  }

  /**
   * Número de Secuencia (Bits 5 a 2):
   * Valor de 0 a 15.
   */
  get sequenceNumber(): number {
    return (this._buffer[0] >> 2) & 0x0F;
  }

  set sequenceNumber(seq: number) {
    if (seq < 0 || seq > 15) {
      throw new Error("El número de secuencia debe estar entre 0 y 15");
    }
    // Limpiar bits 5..2: máscara para bits 5..2 es 0x3C (0011 1100)
    this._buffer[0] &= ~0x3C; 
    // Pegar seq en bits 5..2
    this._buffer[0] |= ((seq & 0x0F) << 2);
  }

  /**
   * Bits Reservados (Bits 1 a 0).
   * En esta clase se asumen en 0
   */
  get reserved(): number {
    return this._buffer[0] & 0x03; // Máscara 00000011
  }
/**
 * Primeros dos bits para el Application Layer Control Field (APCI)
 */
  set reserved(val: number) {
    if (val < 0 || val > 3) {
      throw new Error("Los bits reservados deben estar entre 0 y 3");
    }
    this._buffer[0] &= 0xFC; // Limpia bits 1..0 (0xFC = 11111100)
    this._buffer[0] |= (val & 0x03);
  }

  /**
   * Representa el TPCI como un Buffer (1 octeto).
   */
  toBuffer(): Buffer {
    return Buffer.from(this._buffer);
  }

  /**
   * Representa el TPCI en hexadecimal.
   */
  toHex(): string {
    return `0x${this._buffer[0].toString(16).padStart(2, '0').toUpperCase()}`;
  }
  /**
   * Describe la codificación actual del objecto KNXTPCI (Transport Layer Control Field)
   * @returns {string} Codificación explicada en cadena de texto
   */
  describe(): string {
    return `Value: 0x${this.getValue().toString(16)},
    Data/ControlFlag: ${this.dataControlFlag},
    Numbered: ${this.numberedFlag},
    SequenceNumber: ${this.sequenceNumber} (${this.sequenceNumber.toString(2)}),
    Reserved, the first two bits are for the Application Layer Control Field (APCI): ${this.reserved} (${this.reserved.toString(2)})`
  }

  mapTPCIType(value: TPCIType | number): string {
    switch (value) {
      case TPCIType.T_DATA_BROADCAST_PDU: return 'T_Data_Broadcast_PDU';
      case TPCIType.T_DATA_GROUP_PDU: return 'T_Data_Group_PDU';
      case TPCIType.T_DATA_CONNECTED_PDU: return 'T_DATA_CONNECTED_PDU';
      case TPCIType.T_CONNECT_PDU: return 'T_CONNECT_PDU';
      case TPCIType.T_DISCONNECT_PDU: return 'T_DISCONNECT_PDU';
      case TPCIType.T_ACK_PDU: return 'T_ACK_PDU';
      case TPCIType.T_NAK_PDU: return 'T_NAK_PDU';
      default: return 'Unknown PDU';
    }
  }
}

