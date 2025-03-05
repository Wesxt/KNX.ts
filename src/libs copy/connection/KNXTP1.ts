/**
 * Enumeración de prioridades para el Data Link Layer TP1.
 * Los valores internos representan la prioridad según la interfaz,
 * pero la codificación en el frame se ajusta a la especificación:
 *   - SYSTEM:  00 (0)
 *   - NORMAL:  01 (1)
 *   - URGENT:  10 (2)
 *   - LOW:     11 (3)
 */
export enum Priority {
  SYSTEM = 0,
  URGENT = 1,
  NORMAL = 2,
  LOW = 3,
}

/**
 * Mapea la prioridad definida en el enum a la codificación
 * requerida en el campo de control del frame TP1.
 * 
 * Específico para L_Data_Standard:
 *   - SYSTEM -> 0 (00b)
 *   - NORMAL -> 1 (01b)
 *   - URGENT -> 2 (10b)
 *   - LOW    -> 3 (11b)
 * 
 * @param p Prioridad
 * @returns Número de 2 bits codificado
 */
function mapPriority(p: Priority): number {
  switch (p) {
    case Priority.SYSTEM:
      return 0;
    case Priority.NORMAL:
      return 1;
    case Priority.URGENT:
      return 2;
    case Priority.LOW:
      return 3;
  }
}

/**
 * Calcula el Check Octet (FCS) para un frame TP1.
 * Se realiza un XOR acumulativo de todos los octetos del frame
 * y luego se aplica el complemento (NOT) bit a bit.
 * 
 * @param data Buffer con los octetos del frame (sin incluir el Check Octet)
 * @returns Check octet calculado
 */
function calculateCheckOctet(data: Buffer): number {
  const xor = data.reduce((acc, byte) => acc ^ byte, 0);
  return xor ^ 0xFF;
}

/**
 * Clase para construir frames KNX TP1 según la especificación.
 * Soporta:
 * 1. L_Data_Standard Frame (para mensajes de datos)
 * 2. L_Poll_Data Frame (para solicitudes de Poll Data)
 * 3. Short Acknowledgement Frame
 */
export class KNXTP1 {
  /**
   * Crea un frame L_Data_Standard.
   * 
   * Estructura del frame:
   * 
   * | Octet | Campo                                    |
   * |-------|------------------------------------------|
   * |  0    | Control Field (CTRL)                     |
   * |  1    | Source Address (alta)                    |
   * |  2    | Source Address (baja)                    |
   * |  3    | Destination Address (alta)               |
   * |  4    | Destination Address (baja)               |
   * |  5    | Dirección: Bit 7 = AT (0: individual, 1: group)  |
   * |  6    | Longitud del TPDU (0…14)                  |
   * | 7..N  | TPDU (datos de usuario)                  |
   * | N+1   | Check Octet (NOT XOR de todos los anteriores) |
   * 
   * El Control Field se construye de la siguiente forma:
   * - Bit 7: FT flag = 1 (para L_Data_Standard)
   * - Bit 6: r flag = 1 si el frame NO es repetido, 0 si es repetido.
   * - Bits 5-4: prioridad (codificada según mapPriority)
   * - Bits 3-0: reservados a 0.
   * 
   * @param sourceAddr Dirección de origen en formato [alta, baja] (ej. [0x11, 0x01])
   * @param destAddr Dirección de destino en formato [alta, baja]
   * @param destAddressType Tipo de dirección de destino: 0 = individual, 1 = group.
   * @param tpdu Datos del TPDU (máximo 14 octetos)
   * @param priority Prioridad del mensaje
   * @param nonRepeated Si es true (por defecto), se indica que el frame NO es repetido.
   * @returns Buffer con el frame L_Data_Standard completo.
   */
  static createLDataStandardFrame(
    sourceAddr: number[],
    destAddr: number[],
    destAddressType: number,
    tpdu: Buffer,
    priority: Priority,
    nonRepeated: boolean = true
  ): Buffer {
    if (sourceAddr.length !== 2) {
      throw new Error("sourceAddr debe tener 2 octetos");
    }
    if (destAddr.length !== 2) {
      throw new Error("destAddr debe tener 2 octetos");
    }
    if (tpdu.length > 14) {
      throw new Error("El TPDU para L_Data_Standard admite máximo 14 octetos");
    }
    // Tamaño total = 7 octetos de header + longitud del TPDU + 1 octeto de Check
    const totalLength = 7 + tpdu.length + 1;
    const buffer = Buffer.alloc(totalLength);

    // Construir el Control Field (octeto 0)
    // Bit 7 = 1 (L_Data_Standard), Bit 6 = nonRepeated ? 1 : 0,
    // Bits 5-4 = mapPriority(priority), Bits 3-0 = 0.
    const ctrl =
      0x80 | // FT flag = 1 para Standard
      (nonRepeated ? 0x40 : 0x00) |
      (mapPriority(priority) << 4);
    buffer[0] = ctrl;

    // Octetos 1-2: Source Address
    buffer[1] = sourceAddr[0];
    buffer[2] = sourceAddr[1];

    // Octetos 3-4: Destination Address
    buffer[3] = destAddr[0];
    buffer[4] = destAddr[1];

    // Octeto 5: Campo AT.
    // Se utiliza el bit 7 para indicar el tipo de dirección:
    // 0: Individual, 1: Group. Los demás bits se ponen a 0.
    buffer[5] = (destAddressType & 0x01) << 7;

    // Octeto 6: Longitud del TPDU (0 a 14)
    buffer[6] = tpdu.length & 0x0F;

    // Copia el TPDU (si existe) a partir del octeto 7
    tpdu.copy(buffer, 7);

    // El último octeto es el Check Octet
    buffer[totalLength - 1] = calculateCheckOctet(buffer.subarray(0, totalLength - 1));

    return buffer;
  }

  /**
   * Crea un frame L_Poll_Data Request.
   * 
   * Estructura del frame:
   * 
   * | Octet | Campo                                  |
   * |-------|----------------------------------------|
   * |  0    | Control Field (fijo: 0xF0 = 11110000)  |
   * |  1    | Source Address (alta)                  |
   * |  2    | Source Address (baja)                  |
   * |  3    | Poll Group Address (alta)              |
   * |  4    | Poll Group Address (baja)              |
   * |  5    | Número de Poll Data esperados (1-15)   |
   * |  6    | Check Octet (NOT XOR de 0 a 5)           |
   * 
   * @param sourceAddr Dirección de origen [alta, baja]
   * @param pollGroupAddr Dirección de grupo de Poll Data [alta, baja]
   * @param noOfExpectedPollData Número de respuestas esperadas (entre 1 y 15)
   * @returns Buffer con el frame L_Poll_Data Request.
   */
  static createLPollDataFrame(
    sourceAddr: number[],
    pollGroupAddr: number[],
    noOfExpectedPollData: number
  ): Buffer {
    if (sourceAddr.length !== 2) {
      throw new Error("sourceAddr debe tener 2 octetos");
    }
    if (pollGroupAddr.length !== 2) {
      throw new Error("pollGroupAddr debe tener 2 octetos");
    }
    if (noOfExpectedPollData < 1 || noOfExpectedPollData > 15) {
      throw new Error("noOfExpectedPollData debe estar entre 1 y 15");
    }

    // El frame tiene 7 octetos en total.
    const buffer = Buffer.alloc(7);
    // Control Field fijo para L_Poll_Data Request: 11110000 (0xF0)
    buffer[0] = 0xF0;
    // Source Address
    buffer[1] = sourceAddr[0];
    buffer[2] = sourceAddr[1];
    // Poll Group Address
    buffer[3] = pollGroupAddr[0];
    buffer[4] = pollGroupAddr[1];
    // Número de Poll Data esperados (solo los 4 bits bajos son válidos)
    buffer[5] = noOfExpectedPollData & 0x0F;
    // Check Octet
    buffer[6] = calculateCheckOctet(buffer.subarray(0, 6));

    return buffer;
  }

  /**
   * Crea un frame de Acknowledgement corto.
   * 
   * De acuerdo a la especificación, el frame de ACK consta de un único octeto.
   * Los códigos definidos son:
   * 
   * | Tipo       | Código (hex) | Binario       |
   * |------------|--------------|---------------|
   * | ACK        | 0xCC         | 11001100      |
   * | NAK        | 0x0C         | 00001100      |
   * | BUSY       | 0xC0         | 11000000      |
   * | NAK+BUSY   | 0x00         | 00000000      |
   * 
   * @param type Tipo de acknowledgment: 'ACK', 'NAK', 'BUSY' o 'NAK_BUSY'
   * @returns Buffer con el frame de Acknowledgement (1 octeto)
   */
  static createAckFrame(type: 'ACK' | 'NAK' | 'BUSY' | 'NAK_BUSY'): Buffer {
    let code: number;
    switch (type) {
      case 'ACK':
        code = 0xCC;
        break;
      case 'NAK':
        code = 0x0C;
        break;
      case 'BUSY':
        code = 0xC0;
        break;
      case 'NAK_BUSY':
        code = 0x00;
        break;
      default:
        throw new Error("Tipo de acknowledgment desconocido");
    }
    return Buffer.from([code]);
  }
}
