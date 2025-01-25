enum ActionType {
  GroupRead = 0,
  GroupResp = 0x40,
  GroupWrite = 0x80,

  IndividualWrite = 0x0C0,
  IndividualRead = 0x100,
  IndividualResp = 0x140,

  AdcRead = 0x180,
  AdcResp = 0x1C0,

  SysNetParamRead = 0x1C4,
  SysNetParamResp = 0x1C9,
  SysNetParamWrite = 0x1CA,

  MemoryRead = 0x200,
  MemoryResp = 0x240,
  MemoryWrite = 0x280,

  UserMemoryRead = 0x2C0,
  UserMemoryResp = 0x2C1,
  UserMemoryWrite = 0x2C2,

  UserManufacturerInfoRead = 0x2C5,
  UserManufacturerInfoResp = 0x2C6,

  FunctionPropertyCommand = 0x2C7,
  FunctionPropertyStateRead = 0x2C8,
  FunctionPropertyStateResp = 0x2C9,

  DeviceDescriptorRead = 0x300,
  DeviceDescriptorResp = 0x340,

  Restart = 0x380,
  Escape = 0x3C0, // Not sure about this one

  AuthorizeRequest = 0x3D1,
  AuthorizeResp = 0x3D2,

  KeyWrite = 0x3D3,
  KeyResp = 0x3D4,

  PropertyValueRead = 0x3D5,
  PropertyValueResp = 0x3D6,
  PropertyValueWrite = 0x3D7,

  PropertyDescriptionRead = 0x3D8,
  PropertyDescriptionResp = 0x3D9,

  NetworkParamRead = 0x3DA,
  NetworkParamResp = 0x3DB,

  IndividualSerialNumRead = 0x3DC,
  IndividualSerialNumResp = 0x3DD,
  IndividualSerialNumWrite = 0x3DF,

  DomainWrite = 0x3E0,
  DomainRead = 0x3E1,
  DomainResp = 0x3E2,
  DomainSelectiveRead = 0x3E3,

  NetworkParamWrite = 0x3E4,

  LinkRead = 0x3E5,
  LinkResp = 0x3E6,
  LinkWrite = 0x3E7,

  GroupPropValueRead = 0x3E8,
  GroupPropValueResp = 0x3E9,
  GroupPropValueWrite = 0x3EA,
  GroupPropValueInfo = 0x3EB,

  DomainSerialNumRead = 0x3EC,
  DomainSerialNumResp = 0x3ED,
  DomainSerialNumWrite = 0x3EE,

  FilesystemInfo = 0x3F0
}

enum TpciType {
  UnnumberedData = 0b00,
  NumberedData = 0b01,
  UnnumberedControl = 0b10,
  NumberedControl = 0b11,
}

/**
 * @type {Uint8Array} - Son enteros sin signo
 */
enum MsgCode {
  RawRequest = 0x10,
  DataRequest = 0x11,
  PollDataRequest = 0x13,
  PollDataConnection = 0x25,
  DataIndicator = 0x29,
  BusmonIndicator = 0x2B,
  RawIndicator = 0x2D,
  DataConnection = 0x2E,
  RawConnection = 0x2F,
  DataConnectionRequest = 0x41,
  DataIndividualRequest = 0x4A,
  DataConnectionIndicator = 0x89,
  DataIndividualIndicator = 0x94,
  ResetIndicator = 0xF0,
  ResetRequest = 0xF1,
  PropwriteConnection = 0xF5,
  PropwriteRequest = 0xF6,
  PropinfoIndicator = 0xF7,
  FuncPropComRequest = 0xF8,
  FuncPropStatReadRequest = 0xF9,
  FuncPropComConnection = 0xFA,
  PropReadConnection = 0xFB,
  PropReadRequest = 0xFC
}

enum Priority {
  SYSTEM = 0,
  ALARM,
  HIGH,
  LOW
}

const ERROR_CODES = {
  0x00: "Unspecified Error",
  0x01: "Out of range",
  0x02: "Out of maxrange",
  0x03: "Out of minrange",
  0x04: "Memory Error",
  0x05: "Read only",
  0x06: "Illegal command",
  0x07: "Void DP",
  0x08: "Type conflict",
  0x09: "Prop. Index range error",
  0x0A: "Value temporarily not writeable",
}

import KNXArnoldDatagram from "./KNXArnoldDatagram";
import { KNXArnoldHelper } from "./KNXArnoldHelper";

export class KNXArnoldReceiver {
  connection: any;
  constructor(connection: any) {
    this.connection = connection
  }
  processCEMI(datagram: any, cemi: any) {
    try {
      datagram.message_code = cemi[0]
      datagram.additional_info_length = cemi[1]
      if (datagram.additional_info_length > 0) {
        datagram.additional_info = Buffer.from(datagram.additional_info_length)
        for (let i = 0; i < datagram.additional_info_length; i++) {
          datagram.additional_info[i] = cemi[2 + i]
        }
      }
      datagram.control_field_1 = cemi[2 + datagram.additional_info_length];
      datagram.control_field_2 = cemi[3 + datagram.additional_info_length];
      let buf = Buffer.alloc(2);
      buf[0] = cemi[4 + datagram.additional_info_length];
      buf[1] = cemi[5 + datagram.additional_info_length];
      datagram.source_address = KNXArnoldHelper.GetIndividualAddress(buf);
      buf = Buffer.alloc(2);
      datagram.destination_address =
        (KNXArnoldHelper.GetKnxDestinationAddressType(datagram.control_field_2) === KNXArnoldHelper.KnxDestinationAddressType.INDIVIDUAL) ?
          KNXArnoldHelper.GetIndividualAddress(buf) :
          KNXArnoldHelper.GetGroupAddress(buf, this.connection.ThreeLevelGroupAddressing);
      datagram.data_length = cemi[8 + datagram.additional_info_length]
      datagram.apdu = Buffer.alloc(datagram.data_length + 1);
      for (var i = 0; i < datagram.apdu.length; i++)
        datagram.apdu[i] = cemi[9 + i + datagram.additional_info_length];
      datagram.data = KNXArnoldHelper.GetData(datagram.data_length, datagram.apdu);

      datagram.dtpData = new KNXArnoldDatagram(datagram.apdu);
      if (this.connection.debug) {
        console.log("-----------------------------------------------------------------------------------------------------");
        console.log(cemi.toString('hex'));
        console.log("Event Header Length: " + datagram.header_length);
        console.log("Event Protocol Version: " + datagram.protocol_version);
        console.log("Event Service Type: 0x" + datagram.service_type.toString('hex'));
        console.log("Event Total Length: " + datagram.total_length);
        console.log("Event Message Code: " + datagram.message_code);
        console.log("Event Aditional Info Length: " + datagram.additional_info_length);
        if (datagram.additional_info_length > 0)
          console.log("Event Aditional Info: 0x" + datagram.additional_info.toString('hex'));
        console.log("Event Control Field 1: " + datagram.control_field_1);
        console.log("Event Control Field 2: " + datagram.control_field_2);
        console.log("Event Source Address: " + datagram.source_address);
        console.log("Event Destination Address: " + datagram.destination_address);
        console.log("Event Data Length: " + datagram.data_length);
        console.log("Event APDU: 0x" + datagram.apdu.toString('hex'));
        console.log("Event Data: " + datagram.data.toString('hex'));
        console.log("-----------------------------------------------------------------------------------------------------");
      }
      if (datagram.message_code != 0x29) {
        return;
      }
      const type = datagram.apdu[1] >> 4;
      switch (type) {
        case 8:
          this.connection.emit('event', datagram.destination_address, datagram.data, datagram);
          this.connection.emit('event.' + datagram.destination_address.toString(), datagram.destination_address, datagram.data, datagram);
          break;
        case 4:
          this.connection.emit('status', datagram.destination_address, datagram.data, datagram);
          this.connection.emit('status.' + datagram.destination_address.toString(), datagram.destination_address, datagram.data, datagram);
          break;
        default:
          console.log('Unknown type[' + type + '] received in datagram[' + datagram.data.toString('hex') + ']');
          break;
      }
    } catch (error) {
        // ignore, missing warning information
      console.error(error)
    }
  }
}