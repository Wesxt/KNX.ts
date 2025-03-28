import { KNXHelper } from '../utils/class/KNXHelper';
import { KNXConnection } from './KNXConnection';
import KnxDatagram from '../data/KNXDatagram';
import { KnxData } from '../data/KNXData';

interface ExtendDatagram extends KnxDatagram {
  dtpData?: KnxData;
}

export class KNXReceiver {
  connection: KNXConnection;
  constructor(connection: KNXConnection) {
    this.connection = connection;
  }
  ProcessCEMI(datagram: ExtendDatagram, cemi: Buffer) {
    try {
      // CEMI
      // +--------+--------+--------+--------+----------------+----------------+--------+----------------+
      // |  Msg   |Add.Info| Ctrl 1 | Ctrl 2 | Source Address | Dest. Address  |  Data  |      APDU      |
      // | Code   | Length |        |        |                |                | Length |                |
      // +--------+--------+--------+--------+----------------+----------------+--------+----------------+
      //   1 byte   1 byte   1 byte   1 byte      2 bytes          2 bytes       1 byte      2 bytes
      //
      //  Message Code    = 0x11 - a L_Data.req primitive
      //      COMMON EMI MESSAGE CODES FOR DATA LINK LAYER PRIMITIVES
      //          FROM NETWORK LAYER TO DATA LINK LAYER
      //          +---------------------------+--------------+-------------------------+---------------------+------------------+
      //          | Data Link Layer Primitive | Message Code | Data Link Layer Service | Service Description | Common EMI Frame |
      //          +---------------------------+--------------+-------------------------+---------------------+------------------+
      //          |        L_Raw.req          |    0x10      |                         |                     |                  |
      //          +---------------------------+--------------+-------------------------+---------------------+------------------+
      //          |                           |              |                         | Primitive used for  | Sample Common    |
      //          |        L_Data.req         |    0x11      |      Data Service       | transmitting a data | EMI frame        |
      //          |                           |              |                         | frame               |                  |
      //          +---------------------------+--------------+-------------------------+---------------------+------------------+
      //          |        L_Poll_Data.req    |    0x13      |    Poll Data Service    |                     |                  |
      //          +---------------------------+--------------+-------------------------+---------------------+------------------+
      //          |        L_Raw.req          |    0x10      |                         |                     |                  |
      //          +---------------------------+--------------+-------------------------+---------------------+------------------+
      //          FROM DATA LINK LAYER TO NETWORK LAYER
      //          +---------------------------+--------------+-------------------------+---------------------+
      //          | Data Link Layer Primitive | Message Code | Data Link Layer Service | Service Description |
      //          +---------------------------+--------------+-------------------------+---------------------+
      //          |        L_Poll_Data.con    |    0x25      |    Poll Data Service    |                     |
      //          +---------------------------+--------------+-------------------------+---------------------+
      //          |                           |              |                         | Primitive used for  |
      //          |        L_Data.ind         |    0x29      |      Data Service       | receiving a data    |
      //          |                           |              |                         | frame               |
      //          +---------------------------+--------------+-------------------------+---------------------+
      //          |        L_Busmon.ind       |    0x2B      |   Bus Monitor Service   |                     |
      //          +---------------------------+--------------+-------------------------+---------------------+
      //          |        L_Raw.ind          |    0x2D      |                         |                     |
      //          +---------------------------+--------------+-------------------------+---------------------+
      //          |                           |              |                         | Primitive used for  |
      //          |                           |              |                         | local confirmation  |
      //          |        L_Data.con         |    0x2E      |      Data Service       | that a frame was    |
      //          |                           |              |                         | sent (does not mean |
      //          |                           |              |                         | successful receive) |
      //          +---------------------------+--------------+-------------------------+---------------------+
      //          |        L_Raw.con          |    0x2F      |                         |                     |
      //          +---------------------------+--------------+-------------------------+---------------------+

      //  Add.Info Length = 0x00 - no additional info
      //  Control Field 1 = see the bit structure above
      //  Control Field 2 = see the bit structure above
      //  Source Address  = 0x0000 - filled in by router/gateway with its source address which is
      //                    part of the KNX subnet
      //  Dest. Address   = KNX group or individual address (2 byte)
      //  Data Length     = Number of bytes of data in the APDU excluding the TPCI/APCI bits
      //  APDU            = Application Protocol Data Unit - the actual payload including transport
      //                    protocol control information (TPCI), application protocol control
      //                    information (APCI) and data passed as an argument from higher layers of
      //                    the KNX communication stack
      //
      datagram.message_code = cemi[0];
      datagram.additional_info_length = cemi[1];

      if (datagram.additional_info_length > 0) {
        datagram.additional_info = Buffer.alloc(datagram.additional_info_length);
        for (let i = 0; i < datagram.additional_info_length; i++) {
          datagram.additional_info[i] = cemi[2 + i];
        }
      }

      datagram.control_field_1 = cemi[2 + datagram.additional_info_length];
      datagram.control_field_2 = cemi[3 + datagram.additional_info_length];
      let buf = Buffer.alloc(2);
      buf[0] = cemi[4 + datagram.additional_info_length];
      buf[1] = cemi[5 + datagram.additional_info_length];
      datagram.source_address = KNXHelper.GetIndividualAddress(buf);

      buf = Buffer.alloc(2);
      buf[0] = cemi[6 + datagram.additional_info_length];
      buf[1] = cemi[7 + datagram.additional_info_length];

      datagram.destination_address =
        KNXHelper.GetKnxDestinationAddressType(datagram.control_field_2) === KNXHelper.KnxDestinationAddressType.INDIVIDUAL
          ? KNXHelper.GetIndividualAddress(buf)
          : KNXHelper.GetGroupAddress(buf, this.connection.ThreeLevelGroupAddressing);

      datagram.data_length = cemi[8 + datagram.additional_info_length];
      datagram.apdu = Buffer.alloc(datagram.data_length + 1);

      for (let i = 0; i < datagram.apdu.length; i++) {
        datagram.apdu[i] = cemi[9 + i + datagram.additional_info_length];
      }

      datagram.data = KNXHelper.GetData(datagram.data_length, datagram.apdu);
      datagram.dtpData = new KnxData(datagram.apdu);

      if (this.connection.debug) {
        try {
          console.log('dataView: ', datagram.dtpData.dataView());
          console.log('asDpt1: ', datagram.dtpData.asDpt1());
          // console.log('asDpt2: ', datagram.dtpData.asDpt2());
          // console.log('asDpt3007: ', datagram.dtpData.asDpt3007());
          // console.log('asDpt3008: ', datagram.dtpData.asDpt3008());
          // console.log('asDpt4001', datagram.dtpData.asDpt4001());
          // console.log('asDpt5', datagram.dtpData.asDpt5());
          // console.log('asDpt6', datagram.dtpData.asDpt6());
          // console.log(datagram.dtpData.asDpt6020.name, datagram.dtpData.asDpt6020());
          // console.log('asDpt7', datagram.dtpData.asDpt7());
          // console.log('asDpt8', datagram.dtpData.asDpt8());
          // console.log('asDpt9', datagram.dtpData.asDpt9());
          // console.log('asDpt10001', datagram.dtpData.asDpt10001());
          // console.log('asDpt11001', datagram.dtpData.asDpt11001());
          // console.log('asDpt12001', datagram.dtpData.asDpt12001());
          // console.log('asDpt13: ', datagram.dtpData.asDpt13));
          // console.log('asDpt14: ', datagram.dtpData.asDpt14());
          // console.log("asDpt15000: ", datagram.dtpData.asDpt15000())
          // console.log("asDpt16: ", datagram.dtpData.asDpt16())
          // console.log("asDpt20: ", datagram.dtpData.asDpt20())
          // console.log("asDpt27001: ", datagram.dtpData.asDpt27001())
          // console.log("asDpt28001: ", datagram.dtpData.asDpt28001())
          // console.log("asDpt29: ", datagram.dtpData.asDpt29())
          // console.log("asDpt232600: ", datagram.dtpData.asDpt232600())
          // console.log("asDpt245600: ", datagram.dtpData.asDpt245600())
          // console.log("asDpt250600: ", datagram.dtpData.asDpt250600())
          // console.log("asDpt251600: ", datagram.dtpData.asDpt251600())
        } catch (error) {
          console.error(error);
        }
        console.log('-----------------------------------------------------------------------------------------------------');
        console.log('-----------Header----------------');
        console.log('Event Header Length: ' + datagram.header_length);
        console.log('Event Protocol Version: ' + datagram.protocol_version);
        console.log('Event Service Type: 0x' + (datagram.service_type ? datagram.service_type.toString('hex') : 'undefined'));
        console.log('Event Total Length: ' + datagram.total_length);

        console.log('-----------CEMI: ' + cemi.toString('hex') + '------------');
        console.log('Event Message Code: ' + datagram.message_code);
        console.log('Event Aditional Info Length: ' + datagram.additional_info_length);

        if (datagram.additional_info_length > 0)
          console.log('Event Aditional Info: 0x' + (datagram.additional_info ? datagram.additional_info.toString('hex') : 'undefined'));

        console.log('Event Control Field 1: ' + datagram.control_field_1);
        console.log('Event Control Field 2: ' + datagram.control_field_2);
        console.log('Event Source Address: ' + datagram.source_address);
        console.log('Event Destination Address: ' + datagram.destination_address);
        console.log('Event Data Length: ' + datagram.data_length);
        console.log('Event APDU: 0x' + datagram.apdu.toString('hex'));
        console.log('Event APDU the last byte: 0x' + datagram.apdu[datagram.apdu.length - 1].toString(16));
        console.log('Event APDU the last byte convert to decimal: ' + datagram.apdu[datagram.apdu.length - 1].toString(10));
        console.log('Event Data: ' + datagram.data.toString('hex'));
        console.log('-----------------------------------------------------------------------------------------------------');
      }
      if (datagram.message_code != 0x29) {
        return;
      }
      const type = datagram.apdu[1] >> 4;
      switch (type) {
        case 8:
          this.connection.emit('event', datagram.destination_address, datagram.data, datagram);
          if (datagram.destination_address) {
            this.connection.emit('event.' + datagram.destination_address.toString(), datagram.destination_address, datagram.data, datagram);
          }
          break;
        case 4:
          this.connection.emit('status', datagram.destination_address, datagram.data, datagram);
          if (datagram.destination_address) {
            this.connection.emit('status.' + datagram.destination_address.toString(), datagram.destination_address, datagram.data, datagram);
          }
          break;
        default:
          console.log('Unknown type[' + type + '] received in datagram[' + datagram.data.toString('hex') + ']');
          break;
      }
    } catch {
      // ignore, missing warning information
      // console.error(error)
    }
  }
}
