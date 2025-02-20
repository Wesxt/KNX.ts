import { KNXSender } from "./KNXSender";
import dgram from 'node:dgram';
import { KNXHelper } from "../utils/class/KNXHelper";
import { KnxConnectionTunneling } from "./KNXConnectionTunneling";

export class KNXSenderTunneling extends KNXSender {
  constructor(connection: KnxConnectionTunneling, private udpClient: dgram.Socket, private remoteEndpoint: {
    host: string,
    port: number,
    toBytes: () => Buffer
  }) {
    super(connection)
  }
  Action(destinationAddress: Buffer | string, data: Buffer, callback?: (err: Error | null) => void) {
    this.SendData(this.CreateActionDatagram(destinationAddress as string, data) as Buffer, callback);
  }
  RequestStatus(destinationAddress: Buffer | string, callback: (...args: any[]) => void) {
    callback && this.connection.once('status.' + destinationAddress.toString(), callback);
    this.SendData(this.CreateRequestStatusDatagram(destinationAddress as string) as Buffer);
  }
  SetClient(client: typeof this.udpClient) {
    this.udpClient = client
  }
  SendDataSingle(datagram: Buffer, callback?: (error: Error | null) => void) {
    let thisClass = this
    function callbackError(error: Error | null, bytes?: number) {
      if (thisClass.connection.debug)
        console.log('udp sent, err[' + (error ? error.toString() : 'no_err') + '], bytes[' + bytes + ']');
      callback && callback(error);
    }
    this.udpClient.send(datagram, 0, datagram.length, this.remoteEndpoint.port, this.remoteEndpoint.host, callbackError)
  }
  SendData(datagram: Buffer, callback?: (error: Error | null) => void) {
    if (!datagram) {
      return callbackError(new Error('Cannot send empty datagram'));
    }
    let thisClass = this;
    function callbackError(err: Error | null, bytes?: number) {
      if (thisClass.connection.debug)
        console.log('udp sent, err[' + (err ? err.toString() : 'no_err') + ']');
      callback && callback(err);
    }
    this.udpClient.send(datagram, 0, datagram.length, this.remoteEndpoint.port, this.remoteEndpoint.host, callbackError);
  }
  SendTunnelingAck(sequenceNumber: number) {
    // HEADER
    let datagram = Buffer.alloc(10);
    datagram[0] = 0x06;
    datagram[1] = 0x10;
    datagram[2] = 0x04;
    datagram[3] = 0x21;
    datagram[4] = 0x00;
    datagram[5] = 0x0A;

    datagram[6] = 0x04;
    datagram[7] = this.connection.ChannelId;
    datagram[8] = sequenceNumber;
    datagram[9] = 0x00;

    this.udpClient.send(datagram, 0, datagram.length, this.remoteEndpoint.port, this.remoteEndpoint.host);
  }
  CreateActionDatagram(destinationAddress: string, data: Buffer) {
    try {
      let dataLength = KNXHelper.GetDataLength(data);

      // HEADER
      let datagram = Buffer.alloc(10);
      datagram[0] = 0x06;
      datagram[1] = 0x10;
      datagram[2] = 0x04;
      datagram[3] = 0x20;

      let totalLength = dataLength + 20;
      let buf = Buffer.alloc(2);
      buf.writeUInt16LE(totalLength);
      datagram[4] = buf[1];
      datagram[5] = buf[0];

      datagram[6] = 0x04;
      datagram[7] = this.connection.ChannelId;
      if (this.connection.GenerateSequenceNumber) datagram[8] = this.connection.GenerateSequenceNumber();
      datagram[9] = 0x00;
      return this.CreateActionDatagramCommon(destinationAddress, data, datagram);
    }
    catch (e) {
      if (this.connection.RevertSingleSequenceNumber) this.connection.RevertSingleSequenceNumber();
      return null;
    }
  }
  CreateRequestStatusDatagram( destinationAddress: string) {
    try {
        // HEADER
        let datagram = Buffer.alloc(21);
        datagram[0] = 0x06;
        datagram[1] = 0x10;
        datagram[2] = 0x04;
        datagram[3] = 0x20;
        datagram[4] = 0x00;
        datagram[5] = 0x15;

        datagram[6] = 0x04;
        datagram[7] = this.connection.ChannelId;
        if(this.connection.GenerateSequenceNumber) {
          datagram[8] = this.connection.GenerateSequenceNumber();
        }
        datagram[9] = 0x00;

        return this.CreateRequestStatusDatagramCommon(destinationAddress, datagram, 10);
    }
    catch (e) {
        if (this.connection.RevertSingleSequenceNumber) {
          this.connection.RevertSingleSequenceNumber();
        }
        return null;
    }
}
}