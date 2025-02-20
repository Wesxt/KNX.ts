import EventEmitter from 'events';
import { KNXSenderTunneling } from './KNXSenderTunneling';
import { KnxDataEncoder } from '../data/KNXDataEncode';
import { KNXHelper } from '../utils/class/KNXHelper';
import { KnxData } from '../data/KNXData';
import { AllDpts } from '../@types/types/AllDpts';

export class KNXConnection extends EventEmitter {
  host: string;
  port: number;
  RemoteEndpoint;
  connected = false;
  ActionMessageCode = 0x00;
  /**
   * This indicates whether the group addresses are three-level, i.e. "0/0/1" for example.
   */
  ThreeLevelGroupAddressing = true;
  debug = false;
  ChannelId = 0x00;
  knxSender: KNXSenderTunneling | null = null;
  /**
   * This property is intended to be extended, here is the logic of the disconnection
   */
  Disconnect: ((callback: (...any: any[]) => void) => void) | null = null;
  /**
   * This property is intended to be extended, here is the connection logic
   */
  Connect: ((callback?: (...args: any[]) => void) => void) | null = null;
  ResetSequenceNumber: (() => number) | null = null;
  GenerateSequenceNumber: (() => number) | null = null;
  RevertSingleSequenceNumber: (() => number) | null = null;
  private callKnxSender = () => {
    if (this.knxSender instanceof KNXSenderTunneling) {
      return this.knxSender;
    } else {
      console.error('knxSender is not instance of KNXSenderTunneling');
    }
  };
  constructor(host: string, port: number) {
    super();
    this.host = host;
    this.port = port;
    this.RemoteEndpoint = {
      host: host,
      port: port,
      toBytes() {
        if (!this.host || this.host === '') throw 'Cannot proceed toString for endPoint with empy host';
        if (this.host.indexOf('.') === -1 || this.host.split('.').length < 4)
          throw 'Cannot proceed toString for endPoint with host[' + this.host + '], it should contain ip address';
        const result = Buffer.alloc(4);
        const arr = this.host.split('.');
        result[0] = parseInt(arr[0]) & 255;
        result[1] = parseInt(arr[1]) & 255;
        result[2] = parseInt(arr[2]) & 255;
        result[3] = parseInt(arr[3]) & 255;
        return result;
      },
    };
  }
  /*
 Datatypes

 KNX/EIB Function                   Information length      EIS         DPT     Value
 Switch                             1 Bit                   EIS 1       DPT 1	0,1
 Dimming (Position, Control, Value) 1 Bit, 4 Bit, 8 Bit     EIS 2	    DPT 3	[0,0]...[1,7]
 Time                               3 Byte                  EIS 3	    DPT 10
 Date                               3 Byte                  EIS 4       DPT 11
 Floating point                     2 Byte                  EIS 5	    DPT 9	-671088,64 - 670760,96
 8-bit unsigned value               1 Byte                  EIS 6	    DPT 5	0...255
 8-bit unsigned value               1 Byte                  DPT 5.001	DPT 5.001	0...100
 Blinds / Roller shutter            1 Bit                   EIS 7	    DPT 1	0,1
 Priority                           2 Bit                   EIS 8	    DPT 2	[0,0]...[1,1]
 IEEE Floating point                4 Byte                  EIS 9	    DPT 14	4-Octet Float Value IEEE 754
 16-bit unsigned value              2 Byte                  EIS 10	    DPT 7	0...65535
 16-bit signed value                2 Byte                  DPT 8	    DPT 8	-32768...32767
 32-bit unsigned value              4 Byte                  EIS 11	    DPT 12	0...4294967295
 32-bit signed value                4 Byte                  DPT 13	    DPT 13	-2147483648...2147483647
 Access control                     1 Byte                  EIS 12	    DPT 15
 ASCII character                    1 Byte                  EIS 13	    DPT 4
 8859_1 character                   1 Byte                  DPT 4.002	DPT 4.002
 8-bit signed value                 1 Byte                  EIS 14	    DPT 6	-128...127
 14 character ASCII                 14 Byte                 EIS 15	    DPT 16
 14 character 8859_1                14 Byte                 DPT 16.001	DPT 16.001
 Scene                              1 Byte                  DPT 17	    DPT 17	0...63
 HVAC                               1 Byte                  DPT 20	    DPT 20	0..255
 Unlimited string 8859_1            .                       DPT 24	    DPT 24
 List 3-byte value                  3 Byte                  DPT 232	    DPT 232	RGB[0,0,0]...[255,255,255]
 */
  /**
   * Send a byte array value as data to specified address
   * @param address KNX Address
   * @param data Byte array value or integer
   * @param callback callback
   */
  Action<T extends (typeof KnxDataEncoder.dptEnum)[number] | null>(address: Buffer | string, dpt: T, dataInput: AllDpts<T>, callback?: () => any) {
    let data;
    if (!Buffer.isBuffer(dataInput)) {
      // var buf = null;
      // switch (typeof (data)) {
      //   case 'boolean':
      //     buf = Buffer.alloc(1);
      //     buf.writeInt8(data ? 1 : 0, 0);
      //     break
      //   case 'number':
      //     //if integer
      //     if (this.isInt(data)) {
      //       buf = Buffer.alloc(2);
      //       if (data <= 255) {
      //         buf[0] = 0x00;
      //         buf[1] = data & 255;
      //       }
      //       else if (data <= 65535) {
      //         buf[0] = data & 255;
      //         buf[1] = (data >> 8) & 255;
      //       }
      //       else
      //         throw new InvalidKnxDataException(data.toString());
      //     }
      //     //if float
      //     else if (this.isFloat(data)) {
      //       buf = Buffer.alloc(4);
      //       buf.writeFloatLE(data, 0);
      //     }
      //     else
      //       throw new InvalidKnxDataException(data.toString());
      //     break
      //   case 'string':
      //     buf = Buffer.alloc(parseInt(data));
      //     break
      // }
      const dataEncoder = new KnxDataEncoder();
      try {
        if (dpt !== null) {
          const buf = dataEncoder.encodeThis(dpt, dataInput);
          data = buf;
        } else {
          throw new Error('DPT cannot be null');
        }
      } catch (error) {
        console.error(error);
      }
    }
    if (this.debug) {
      console.log(`${this.constructor.name} Sending ${JSON.stringify(data)} to ${JSON.stringify(address)}.`);
    }
    const knxSender = this.callKnxSender();
    if (knxSender && data instanceof Buffer) {
      knxSender.Action(address, data, callback);
    } else {
      console.log(data);
      throw new Error(`The data is not valid Buffer`);
    }
    if (this.debug) {
      console.log(`${this.constructor.name} Sent ${JSON.stringify(data)} to ${JSON.stringify(address)}.`);
    }
  }
  // TODO: It would be good to make a type for address, to make sure not any random string can be passed in
  /// <summary>
  ///     Send a request to KNX asking for specified address current status
  /// </summary>
  /// <param name="address"></param>
  /**
   *  Send a request to KNX asking for specified address current status
   * @param address
   * @param callback
   */
  RequestStatus(address: Buffer | string, callback: () => any) {
    if (typeof address === "string") {
      KNXHelper.isValidGroupAddress(address)
    } else if (address instanceof Buffer) {
      KNXHelper.isValidGroupAddressBuffer(address)
    } else {
      throw new TypeError("Address is invalid")
    }
    if (this.debug) {
      console.log(`${this.constructor.name} Sending request status to ${JSON.stringify(address)}.`);
    }
    const knxSender = this.callKnxSender();
    if (knxSender) {
      knxSender.RequestStatus(address, callback);
    }
    if (this.debug) {
      console.log(`${this.constructor.name} Sent request status to ${JSON.stringify(address)}.`);
    }
  }
  /**
   * Convert a value received from KNX using datapoint translator, e.g.,
   * get a temperature value in Celsius
   * @param type Datapoint type, e.g.: 9.001
   * @param data Data to convert
   */
  FromDataPoint(type: typeof KnxData.dptEnum[number], data: Buffer) {
    const knxDataDecode = new KnxData(data, true)
    return knxDataDecode.decodeThis(type);
  }
  /**
   * Convert a value to send to KNX using datapoint translator, e.g.,
   * get a temperature value in Celsius in a byte representation
   * @param type Datapoint type, e.g.: 9.001
   * @param value Value to convert
   * @returns {Buffer<ArrayBufferLike> | Error}
   */
  ToDataPoint<T extends (typeof KnxDataEncoder.dptEnum)[number]>(type: T, value: AllDpts<T>): Buffer<ArrayBufferLike> | Error {
    const dataEncoder = new KnxDataEncoder();
    return dataEncoder.encodeThis(type, value);
  }
}
