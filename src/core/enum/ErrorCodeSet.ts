export const enum ErrorCodeSet {
  /**
   * unknown error
   * @service R/W
   */
  Unspecified_Error = 0x00,
  /**
   * write value not allowed (general, if not error 2 or 3)
   * @service W
   */
  Out_of_Range = 0x01,
  /**
   * write value to high
   * @service W
   */
  Out_of_MaxRange = 0x02,
  /**
   * write value to low
   * @service W
   */
  Out_of_MinRange = 0x03,
  /**
   * memory can not be written or only with fault(s)
   * @service W
   */
  Memory_Error = 0x04,
  /**
   * write access to a ‘read only’ or a write protected Property
   * @service W
   */
  Read_Only = 0x05,
  /**
   * COMMAND not valid or not supported
   * @service W
   */
  Illegal_COMMAND = 0x06,
  /**
   * read or write access to an non existing Property
   * @service R/W
   */
  Void_DP = 0x07,
  /**
   * write access with a wrong data type (Datapoint length)
   * @service W
   */
  Type_Conflict = 0x08,
  /**
   * read or write access to a non existing Property array index
   * @service R/W
   */
  Prop_Index_Range_Error = 0x09,
  /**
   * The Property exists but can at this moment not be written with a new value
   * @service W
   */
  Value_temporarily_not_writeable = 0x0a,
}
