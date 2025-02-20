import { KNXReceiver } from "./KNXReceiver";
import { KNXConnection } from "./KNXConnection";
import dgram from 'node:dgram';
import { KNXHelper } from "../utils/class/KNXHelper";
import { LocalEndPoint } from "../@types/interfaces/localEndPoint";
import KnxDatagram from "../data/KNXDatagram";
export class KNXReceiverTunneling extends KNXReceiver {
  private udpClient: dgram.Socket;
  private localEndPoint: LocalEndPoint;
  private rxSequenceNumber: number | null = null;
  private pendingAcks: Map<number, NodeJS.Timeout> = new Map();
  constructor(connection: KNXConnection, udpClient: dgram.Socket, localEndPoint: LocalEndPoint) {
    super(connection)
    this.udpClient = udpClient
    this.localEndPoint = localEndPoint
  }
  socketReceiveLstnr: ((msg: any, rinfo: any) => void) | null = null;
  SetClient(client: typeof this.udpClient) {
    this.udpClient = client
  }
  Start(callback: (...any: any[]) => any) {
    let thisClass = this;
    this.socketReceiveLstnr = function (msg, rinfo) {
      try {
        thisClass.ProcessDatagram(msg);
      } catch (e) {
        console.error('Error processing KNX incoming datagram[' + msg.toString('hex') + '], cause: ' + (e as Error).toLocaleString());
      }
    }
    this.udpClient.on('message', this.socketReceiveLstnr);
    this.udpClient.bind(this.localEndPoint.port, callback);
  }
  Stop() {
    if (this.socketReceiveLstnr) {
      this.udpClient.removeListener('message', this.socketReceiveLstnr);
      this.socketReceiveLstnr = null;
    }
  }
  ProcessDatagram(datagram: Buffer) {
    if (this.connection.debug)
      console.log(`ProcessDatagram datagram: `, datagram);
    try {
      switch (KNXHelper.GetServiceType(datagram)) {
        case KNXHelper.SERVICE_TYPE.CONNECT_RESPONSE:
          this.ProcessConnectResponse(datagram);
          break;
        case KNXHelper.SERVICE_TYPE.CONNECTIONSTATE_RESPONSE:
          this.ProcessConnectionStateResponse(datagram);
          break;
        case KNXHelper.SERVICE_TYPE.TUNNELLING_ACK:
          this.ProcessTunnelingAck(datagram);
          break;
        case KNXHelper.SERVICE_TYPE.DISCONNECT_REQUEST:
          this.ProcessDisconnectRequest(datagram);
          break;
        case KNXHelper.SERVICE_TYPE.TUNNELLING_REQUEST:
          this.ProcessDatagramHeaders(datagram);
          break;
        default:
          console.log(`Unknown serviceType of datagram: ${datagram.toString('hex')}`);
          break;
      }
    }
    catch (e) {
      console.error('Error processing datagram[' + datagram.toString('hex') + '] inside of KnxReceiverTunneling.prototype.ProcessDatagram, cause: ' + (e as Error).toLocaleString());
    }
  }
  ProcessDatagramHeaders(datagram: Buffer) {
    // HEADER
    // TODO: Might be interesting to take out these magic numbers for the datagram indices
    let service_type = Buffer.alloc(2);
    service_type[0] = datagram[2];
    service_type[1] = datagram[3];
    let knxDatagram = new KnxDatagram({
      header_length: datagram[0],
      protocol_version: datagram[1],
      service_type: service_type,
      total_length: datagram[4] + datagram[5]
    });
    let channelId = datagram[7];
    if (channelId != this.connection.ChannelId) {
      return;
    }
    let sequenceNumber = datagram[8];
    let process = true;
    if (sequenceNumber && this.rxSequenceNumber && sequenceNumber <= this.rxSequenceNumber) {
      process = false;
    }
    this.rxSequenceNumber = sequenceNumber;
    if (process) {
      // TODO: Magic number 10, what is it?
      let cemi = Buffer.alloc(datagram.length - 10);
      datagram.copy(cemi, 0, 10, datagram.length);
      this.ProcessCEMI(knxDatagram, cemi);
    }
    if(this.connection.knxSender) {
      this.connection.knxSender.SendTunnelingAck(sequenceNumber);
    }
  }
  ProcessDisconnectRequest(datagram: Buffer) {
    let channelId = datagram[6];
    if (channelId != this.connection.ChannelId) {
      return;
    }
    this.Stop();
    this.connection.emit('close');
    this.udpClient.close();
  }
  /**
   * TODO: implement ack processing!
   * @param datagram 
   */
  
  ProcessTunnelingAck(datagram: Buffer): void {
    const channelId = datagram[6];
    const sequenceNumber = datagram[7];
    const status = datagram[8];
    if (channelId !== this.connection.ChannelId) {
      console.warn(`Received ACK for unknown channel ID: ${channelId}`);
      return;
    }
    // Limpiar el timeout pendiente para este sequence number
    const pendingTimeout = this.pendingAcks.get(sequenceNumber);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this.pendingAcks.delete(sequenceNumber);
    }
    if (status !== 0x00) {
      console.error(`Tunneling ACK received with error status: ${status}`);
      this.connection.emit('error', new Error(`Tunneling ACK error: ${status}`));
      return;
    }
    // Emitir evento de ACK recibido
    this.connection.emit('ack_received', { sequenceNumber, status });
  }
  // Método para manejar los timeouts de ACK
  waitForAck(sequenceNumber: number, timeout: number = 1000): void {
    const timeoutHandler = setTimeout(() => {
      if (this.pendingAcks.has(sequenceNumber)) {
        this.pendingAcks.delete(sequenceNumber);
        this.connection.emit('ack_timeout', { sequenceNumber });
        // Opcional: Reintentar el envío
        this.connection.emit('retry_required', { sequenceNumber });
      }
    }, timeout);
    this.pendingAcks.set(sequenceNumber, timeoutHandler);
  }
  ProcessConnectionStateResponse(datagram: Buffer) {
    // HEADER
    // 06 10 02 08 00 08 -- 48 21
    let service_type = Buffer.alloc(2);
    service_type[0] = datagram[2];
    service_type[1] = datagram[3];
    let knxDatagram = new KnxDatagram({
        header_length: datagram[0],
        protocol_version: datagram[1],
        service_type: service_type,
        total_length: datagram[4] + datagram[5],
        channel_id: datagram[6]
    });
    let response = datagram[7];
    if (response != 0x21) {
        this.connection.emit('alive');
        return;
    }
    if (this.connection.debug) {
      console.log(`KnxReceiverTunneling: Received connection state response - No active connection with channel ID ${knxDatagram.channel_id}`);
    }
    let thisClass = this
    new Promise(function (win: (value: unknown) => void) {
      if(thisClass.connection.Disconnect) {
        thisClass.connection.Disconnect(win);
      }
    }.bind(this)).then(() => {
      if(this.connection.Connect) {
        this.connection.Connect.bind(this.connection)
      }
    });
}

ProcessConnectResponse(datagram: Buffer) {
    // HEADER
    let service_type = Buffer.alloc(2);

    service_type[0] = datagram[2];
    service_type[1] = datagram[3];

    let knxDatagram = new KnxDatagram({
        header_length: datagram[0],
        protocol_version: datagram[1],
        service_type: service_type,
        total_length: datagram[4] + datagram[5],
        channel_id: datagram[6],
        status: datagram[7]
    });

    if (knxDatagram.channel_id == 0x00 && knxDatagram.status == 0x24)
        throw "KnxReceiverTunneling: Received connect response - No more connections available";
    else {
        this.connection.ChannelId = knxDatagram.channel_id as number;
        if(this.connection.ResetSequenceNumber) {
          this.connection.ResetSequenceNumber();
        }
        this.connection.connected = true;
        this.connection.emit('connected');
    }
}
}