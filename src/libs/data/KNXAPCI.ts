/**
 * Enumeración para los comandos del Application Control Field (APCI)
 * para el modo T_Data_Group, según la Tabla 1 de la especificación.
 *
 * Se utiliza el nibble alto del octeto (bits 7..4) para definir:
 *   - READ:      0x0 (0000) → A_GroupValue_Read-PDU
 *   - RESPONSE:  0x1 (0001) → A_GroupValue_Response-PDU
 *   - WRITE:     0x2 (0010) → A_GroupValue_Write-PDU
 * 
 * TODO: Este enum solo comprende el **T_Data_Group** del Application Control Field (APCI), es decir, solo una parte de la especificación
 */
export enum APCIEnum {
  A_GroupValue_Read_Protocol_Data_Unit = 0x00,
  /**
 * ## A_GroupValue_Response-PDU
 *
 * La especificación KNX define **dos formatos** diferentes para el PDU de respuesta de un objeto de grupo 
 * (A_GroupValue_Response-PDU) dependiendo de la longitud de los datos que se van a transmitir.
 *
 * ### Formato 1: Valor de hasta 6 bits
 *
 * Cuando el valor a enviar tiene un tamaño máximo de 6 bits (por ejemplo, un 1-bit o 6-bit DPT),
 * se utiliza un **formato optimizado**. De acuerdo con la Figura 4, el PDU consta de:
 * 
 * **El APCI comienza desde el bit 1 del (octeto 6) al bit6 del (octeto 7)**
 * 
 * ```
 *       +------------------+-------------------+
 * Octet |               6                  |                  7                 |
 *       +------------------+-------------------+
 * Bits 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0
 *       +------------------+-------------------+
 * Campo                       |      APCI      | Valor(≤6 bits)
 *       +------------------+-------------------+
 * ```
 *
 * - **Octeto 6 (APCI desde bit1 al bit6 del octeto 6)**: Contiene los bits de control de aplicación (Application Control Field),
 *   indicando que se trata de una respuesta de grupo (A_GroupValue_Response-PDU).
 * - **Octeto 7 (Valor desde bit5 al bit0)**: Alberga el dato de hasta 6 bits. Si el valor es menor a 6 bits,
 *   los bits no utilizados se ponen a 0.
 *
 * ### Formato 2: Valor mayor a 6 bits (hasta 14 octetos)
 *
 * Cuando el valor excede los 6 bits (hasta un máximo de 14 octetos),
 * se usa el **formato extendido** mostrado en la Figura 5. El PDU abarca más octetos:
 *
 * **El APCI comienza desde el bit 1 del (octeto 6) al bit6 del (octeto 7)**
 * 
 * **El valor comieza desde el octeto 8**
 * 
 * ```
 *       +------------------+-------------------+-------------------+
 * Octet |               6                  |                  7                 |                  8                 |
 *       +------------------+-------------------+-------------------+
 * Bits 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0
 *       +------------------+-------------------+-------------------+
 * Campo                       |      APCI     |  0  0  0  0  0  0  |        Valor(>6 bits)
 *       +------------------+-------------------+-------------------+
 * ```
 *
 * - **Octeto 6 (APCI desde bit1)**: Igual que en el formato anterior, identifica que es un
 *   A_GroupValue_Response-PDU.
 * - **Octeto 8 (6 bits+ N de bits de los datos)**: Contienen el valor en una o varias octetos,
 *   según la longitud real de los datos (hasta 14 octetos como máximo).
 *
 * ### Notas Generales
 * - El valor puede llegar hasta 14 octetos en total.
 * - Los bits del octeto 7 no son usados cuando los datos son mayores a 6 bits **se rellenan con 0**.
 * - Estos dos formatos permiten optimizar la transmisión cuando se envían pocos bits
 *   (por ejemplo, estados ON/OFF de 1 bit) y, a su vez, soportan valores más grandes
 *   (por ejemplo, para DPT de varios octetos).
 */
  A_GroupValue_Response_Protocol_Data_Unit = 0x10,
    /**
 * ## A_GroupValue_Write-PDU
 *
 * La especificación KNX define **dos formatos** diferentes para el PDU de respuesta de un objeto de grupo 
 * (A_GroupValue_Write-PDU) dependiendo de la longitud de los datos que se van a transmitir.
 *
 * ### Formato 1: Valor de hasta 6 bits
 *
 * Cuando el valor a enviar tiene un tamaño máximo de 6 bits (por ejemplo, un 1-bit o 6-bit DPT),
 * se utiliza un **formato optimizado**. De acuerdo con la Figura 4, el PDU consta de:
 * 
 * **El APCI comienza desde el bit 1 del (octeto 6) al bit6 del (octeto 7)**
 * 
 * ```
 *       +------------------+-------------------+
 * Octet |               6                  |                  7                 |
 *       +------------------+-------------------+
 * Bits 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0
 *       +------------------+-------------------+
 * Campo                       |      APCI      | Valor(≤6 bits)
 *       +------------------+-------------------+
 * ```
 *
 * - **Octeto 6 (APCI desde bit1 al bit6 del octeto 6)**: Contiene los bits de control de aplicación (Application Control Field),
 *   indicando que se trata de una respuesta de grupo (A_GroupValue_Write-PDU).
 * - **Octeto 7 (Valor desde bit5 al bit0)**: Alberga el dato de hasta 6 bits. Si el valor es menor a 6 bits,
 *   los bits no utilizados se ponen a 0.
 *
 * ### Formato 2: Valor mayor a 6 bits (hasta 14 octetos)
 *
 * Cuando el valor excede los 6 bits (hasta un máximo de 14 octetos),
 * se usa el **formato extendido** mostrado en la Figura 5. El PDU abarca más octetos:
 *
 * **El APCI comienza desde el bit 1 del (octeto 6) al bit6 del (octeto 7)**
 * 
 * **El valor comieza desde el octeto 8**
 * 
 * ```
 *       +------------------+-------------------+-------------------+
 * Octet |               6                  |                  7                 |                  8                 |
 *       +------------------+-------------------+-------------------+
 * Bits 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0
 *       +------------------+-------------------+-------------------+
 * Campo                       |      APCI     |  0  0  0  0  0  0  |        Valor(>6 bits)
 *       +------------------+-------------------+-------------------+
 * ```
 *
 * - **Octeto 6 (APCI desde bit1)**: Igual que en el formato anterior, identifica que es un
 *   A_GroupValue_Write-PDU.
 * - **Octeto 8 (6 bits+ N de bits de los datos)**: Contienen el valor en una o varias octetos,
 *   según la longitud real de los datos (hasta 14 octetos como máximo).
 *
 * ### Notas Generales
 * - El valor puede llegar hasta 14 octetos en total.
 * - Los bits del octeto 7 no son usados cuando los datos son mayores a 6 bits **se rellenan con 0**.
 * - Estos dos formatos permiten optimizar la transmisión cuando se envían pocos bits
 *   (por ejemplo, estados ON/OFF de 1 bit) y, a su vez, soportan valores más grandes
 *   (por ejemplo, para DPT de varios octetos).
 */
  A_GroupValue_Write_Protocol_Data_Unit = 0x20
}

/**
 * Clase para manejar el Application Control Field (APCI) en comunicaciones KNX,
 * específicamente para el modo T_Data_Group.
 *
 * El APCI se compone de 8 bits:
 *  - Nibble alto (bits 7..4): Comando obligatorio.
 *      • 0x0 → A_GroupValue_Read-PDU
 *      • 0x1 → A_GroupValue_Response-PDU
 *      • 0x2 → A_GroupValue_Write-PDU
 *  - Nibble bajo (bits 3..0): No utilizado (se fija a 0).
 * 
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "Application Layer of the KNX System, Version 02.01.01"
 * 
 * TODO: Esta clase solo comprende el **T_Data_Group** del Application Control Field (APCI), es decir, solo una parte de la especificación
 */
export class KNXAPCI {
  private _value: number;

  constructor(apci: APCIEnum = APCIEnum.A_GroupValue_Write_Protocol_Data_Unit) {
    // Se fija el valor en el nibble alto y el nibble bajo en 0.
    this._value = apci & 0xF0;
  }

  /**
   * Obtiene el valor crudo del APCI (8 bits).
   */
  get value(): number {
    return this._value;
  }

  /**
   * Asigna un nuevo valor crudo al APCI.
   * Se preservan solo los 4 bits.
   */
  set value(val: number) {
    this._value = val & 0xF0;
  }

  /**
   * Obtiene el comando APCI, es decir, el nibble alto (bits 7..4).
   */
  get command(): APCIEnum {
    return (this._value & 0xF0) as APCIEnum;
  }

  /**
   * Establece el comando APCI, fijando el nibble bajo a 0.
   * @param cmd Comando APCI (uno de los valores del enum APCIEnum)
   */
  set command(cmd: APCIEnum) {
    this._value = cmd & 0xF0;
  }

  /**
   * Retorna una representación hexadecimal del APCI.
   */
  toHex(): string {
    return `0x${this._value.toString(16).padStart(2, '0').toUpperCase()}`;
  }

  /**
   * Devuelve el APCI como Buffer (1 octeto).
   */
  toBuffer(): Buffer {
    return Buffer.from([this._value]);
  }

  /**
   * Proporciona una descripción legible del APCI.
   */
  describe(): string {
    let desc: string;
    switch (this.command) {
      case APCIEnum.A_GroupValue_Read_Protocol_Data_Unit:
        desc = "A_GroupValue_Read-PDU";
        break;
      case APCIEnum.A_GroupValue_Response_Protocol_Data_Unit:
        desc = "A_GroupValue_Response-PDU";
        break;
      case APCIEnum.A_GroupValue_Write_Protocol_Data_Unit:
        desc = "A_GroupValue_Write-PDU";
        break;
      default:
        desc = "Desconocido";
    }
    return `APCI:
  Command: ${desc} (nibble alto: 0x${(this.command >> 4).toString(16).toUpperCase()})
  Full Value: ${this.toHex()} (Buffer: ${this.toBuffer().toString('hex').toUpperCase()})`;
  }
}
