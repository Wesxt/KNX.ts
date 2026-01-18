import { FrameType, Priority } from "./enum/EnumControlField";
/**
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "KNX Standard External Message Interface"
 */
/**
 * @alias Controlfield 1
 */
export class ControlField {
  private _buffer: Buffer;

  constructor(initialValue: number = 0) {
    this._buffer = Buffer.alloc(1);
    this._buffer.writeUInt8(initialValue, 0);
  }

  /**  Bit 7: Frame Type (FT) - 0: extended, 1: standard 
   * - This shall specify the Frame Type that shall be used for transmission or 
   * reception of the frame.
  */
  set frameType(value: boolean) {
    if (value) {
      this._buffer[0] = this._buffer[0] | 0x80; // Set bit 7 for standard frame
    } else {
      this._buffer[0] = this._buffer[0] & 0x7F; // Clear bit 7 for extended frame
    }
  }

  get frameType(): boolean {
    return (this._buffer[0] & 0x80) === 0x80;
  }

  /**  Bit 5: Repeat (R) - 0: repeat, 1: do not repeat 
   * - Repeat, not valid for all media
  */
  set repeat(value: boolean) {
    if (value) {
      this._buffer[0] = this._buffer[0] | 0x20; // Set bit 5 for do not repeat
    } else {
      this._buffer[0] = this._buffer[0] & 0xDF; // Clear bit 5 for repeat
    }
  }

  get repeat(): boolean {
    return (this._buffer[0] & 0x20) === 0x20;
  }

  /**  Bit 4: System Broadcast (SB) - 0: system broadcast, 1: broadcast 
   * - This shall specify whether the frame is transmitted using system broadcast 
   * communication mode or broadcast communication mode (applicable only on
   * open media);
  */
  set systemBroadcast(value: boolean) {
    if (value) {
      this._buffer[0] = this._buffer[0] | 0x10; // Set bit 4 for broadcast
    } else {
      this._buffer[0] = this._buffer[0] & 0xEF; // Clear bit 4 for system broadcast
    }
  }

  get systemBroadcast(): boolean {
    return (this._buffer[0] & 0x10) === 0x10;
  }

  /**  Bits 3 and 2: Priority (P) 
   * - This shall specify that Priority that shall be used for transmission or
   * reception of the frame.
  */
  set priority(value: Priority) {
    if (value < 0 || value > 3) throw new Error("Priority must be 0-3");
    // Clear bits 2 and 3, then set them
    this._buffer[0] = (this._buffer[0] & 0xF3) | ((value & 0x03) << 2);
  }

  get priority(): number {
    return (this._buffer[0] >> 2) & 0x03;
  }

  /** Bit 1: Acknowledge request (A) - 0: no ack, 1: ack requested 
   * - This shall specify whether a L2-acknowledge shall be requested for the
   * L_Data.req frame or not. This is not valid for all media.
  */
  set ackRequest(value: boolean) {
    if (value) {
      this._buffer[0] = this._buffer[0] | 0x02; // Set bit 1 for ack requested
    } else {
      this._buffer[0] = this._buffer[0] & 0xFD; // Clear bit 1 for no ack
    }
  }

  get ackRequest(): boolean {
    return (this._buffer[0] & 0x02) === 0x02;
  }

  /**  Bit 0: Confirm (C) - 0: no error, 1: error 
   * - This shall specify whether a L2-acknowledge shall be requested for the 
   * L_Data.req frame or not. This is not valid for all media.
  */
  set confirm(value: boolean) {
    if (value) {
      this._buffer[0] = this._buffer[0] | 0x01; // Set bit 0 for error
    } else {
      this._buffer[0] = this._buffer[0] & 0xFE; // Clear bit 0 for no error
    }
  }

  get confirm(): boolean {
    return (this._buffer[0] & 0x01) === 0x01;
  }

  get buffer(): Buffer {
    return this._buffer;
  }

  describe() {
    return {
      ControlField: `0x${this._buffer[0].toString(16).padStart(2, '0')}`,
      FrameType: FrameType[this.frameType ? 1 : 0],
      Repeat: this.repeat,
      SystemBroadcast: this.systemBroadcast,
      Priority: Priority[this.priority],
      ACKRequest: this.ackRequest ? "acknowledge requested" : "no acknowledge is requested",
      Confirm: this.confirm ? "error" : "no error"
    }
  }
}