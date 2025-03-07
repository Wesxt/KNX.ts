/** @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "KNX Standard Communication Media Twisted Pair 1" */
/** Address Type (bit 7) */
export enum AddressType {
  INDIVIDUAL = 0, // 0
  GROUP = 1       // 1
}

/** Extended Frame Format (bits 3..0) con 16 posibles valores (0..15) */
export enum ExtendedFrameFormat {
  /**
   * If the {@linkcode AddressType} is Individual (0) then it will be **Point_To_Point**, if it is Group (1) then it will be **Standard Group**
   */
  Point_To_Point_Or_Standard_Group_Addressed_L_Data_Extended_Frame  = 0,   // 0000
  /**
   * 11 → Global multicast within the entire KNX installation domain.
   * - **Warning**: this is not rigorously documented, this is only mentioned once in "KNX Standard Communication Media Twisted Pair 1" @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "KNX Standard Communication Media Twisted Pair 1"
   */
  Multicast_Zone_Addressed_11 = 0b0111,
  /**
   *  01 → Multicast to a subset of devices within a specific area.
   * - **Warning**: this is not rigorously documented, this is only mentioned once in "KNX Standard Communication Media Twisted Pair 1" @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "KNX Standard Communication Media Twisted Pair 1"
   * 
   */
  Multicast_Zone_Addressed_01 = 0b0101,
  /**
   * 10 → Multicast to a larger group within the facility.
   * - **Warning**: this is not rigorously documented, this is only mentioned once in "KNX Standard Communication Media Twisted Pair 1" @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "KNX Standard Communication Media Twisted Pair 1"
   * 
   */
  Multicast_Zone_Addressed_10  = 0b0110,
  /**
   * 00 → Multicast to a subset of devices within a specific line
   * - **Warning**: this is not rigorously documented, this is only mentioned once in "KNX Standard Communication Media Twisted Pair 1" @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "KNX Standard Communication Media Twisted Pair 1"
   * 
   */
  Multicast_Zone_Addressed_00  = 0b0100,

}
