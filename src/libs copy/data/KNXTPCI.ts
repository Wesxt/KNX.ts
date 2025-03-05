/**
 * Enumeración de los valores posibles de TPCI (Transport Protocol Control Information)
 * en comunicaciones KNX.
 */
export enum TPCIType {
    // Comunicación de datos de usuario (UDP - User Data Protocol)
    UDP_STANDARD = 0x00,   // Comunicación estándar de datos de usuario
    UDP_NUMBERED = 0x40,   // Comunicación numerada de datos de usuario
  
    // Comunicación de control
    CONTROL_REQUEST = 0x80,   // Solicitud de control
    CONTROL_RESPONSE = 0xC0,  // Respuesta de control
  
    // Tipos de comunicación especiales
    ACK = 0xC2,             // Reconocimiento de recepción
    NACK = 0xC3,            // No reconocimiento (error)
  }
  
  /**
   * Clase para manejar TPCI en comunicaciones KNX utilizando un Buffer.
   */
  export class KNXTPCIHandler {
    private _buffer: Buffer;
  
    constructor(tpci: TPCIType = TPCIType.UDP_STANDARD) {
      this._buffer = Buffer.alloc(1);
      this._buffer[0] = tpci;
    }
  
    /**
     * Obtiene el valor raw del TPCI.
     * @returns {number} Valor numérico del TPCI.
     */
    getValue(): number {
      return this._buffer[0];
    }
  
    /**
     * Establece el valor raw del TPCI.
     * @param value Nuevo valor (se preserva solo 8 bits).
     */
    setValue(value: number): void {
      this._buffer[0] = value & 0xFF;
    }
  
    /**
     * Obtiene el tipo de TPCI actual.
     * Se utilizan los 2 bits más significativos.
     * @returns {TPCIType} Tipo de TPCI.
     */
    getType(): TPCIType {
      return (this.getValue() & 0xC0) as TPCIType;
    }
  
    /**
     * Establece el tipo de TPCI, preservando los 6 bits menos significativos.
     * @param type Nuevo tipo de TPCI.
     */
    setType(type: TPCIType): void {
      this.setValue((this.getValue() & 0x3F) | type);
    }
  
    /**
     * Obtiene el número de secuencia para comunicaciones numeradas.
     * Para comunicaciones numeradas, los 2 bits siguientes a los 2 más significativos indican el número de secuencia.
     * @returns {number} Número de secuencia (0-3).
     */
    getSequenceNumber(): number {
      return (this.getValue() & 0x0C) >> 2;
    }
  
    /**
     * Establece el número de secuencia.
     * @param seqNum Número de secuencia (0-3).
     */
    setSequenceNumber(seqNum: number): void {
      if (seqNum < 0 || seqNum > 3) {
        throw new Error('Número de secuencia debe estar entre 0 y 3');
      }
      // Se preservan los bits que no corresponden a la secuencia (bits 7-4 y 1-0)
      this.setValue((this.getValue() & 0xF3) | ((seqNum << 2) & 0x0C));
    }
  
    /**
     * Convierte el TPCI a su representación hexadecimal.
     * @returns {string} Valor hexadecimal del TPCI.
     */
    toHex(): string {
      return `0x${this.getValue().toString(16).padStart(2, '0').toUpperCase()}`;
    }
  
    /**
     * Devuelve el TPCI como Buffer (1 octeto).
     * @returns {Buffer} Buffer que contiene el TPCI.
     */
    toBuffer(): Buffer {
      // Se retorna una copia para evitar modificaciones externas
      return Buffer.from(this._buffer);
    }
  }