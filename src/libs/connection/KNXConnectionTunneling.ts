const CONNECT_TIMEOUT = 5000;

import { KNXConnection } from './KNXConnection';
import { KNXSenderTunneling } from './KNXSenderTunneling';
import { KNXReceiverTunneling } from './KNXReceiverTunneling';
import { ConnectionErrorException } from '../errors/ConnectionErrorException';
import dgram from 'node:dgram';
import { getLocalIP } from '../utils/function/localIp';
import { LocalEndPoint } from '../@types/interfaces/localEndPoint';
/**
 * Represents a KNX tunneling connection.
 * 
 * @class KnxConnectionTunneling
 * @extends {KNXConnection}
 * 
 * @param {string} remoteIpAddress - Remote gateway IP address.
 * @param {number} remotePort - Remote gateway port.
 * @param {string} [localIpAddress=getLocalIP()] - Local IP address to bind to.
 * @param {number} [localPort=13671] - Local port to bind to.
 * 
 * @property {string} localIpAddress - Local IP address.
 * @property {number} localPort - Local port.
 * @property {NodeJS.Timeout | null} reConnectTimeout - Reconnect timeout.
 * @property {NodeJS.Timeout | null} connectTimeout - Connect timeout.
 * @property {KNXReceiverTunneling | null} knxReceiver - KNX receiver.
 * @property {KNXSenderTunneling | null} knxSender - KNX sender.
 * @property {LocalEndPoint} localEndpoint - Local endpoint.
 * @property {number} ChannelId - Channel ID.
 * @property {NodeJS.Timeout | null} stateRequestTimer - State request timer.
 * @property {dgram.Socket | null} udpClient - UDP client.
 * @property {number} sequenceNumber - Sequence number.
 */
export class KnxConnectionTunneling extends KNXConnection {
  localIpAddress: string;
  localPort: number;
  reConnectTimeout: NodeJS.Timeout | null = null;
  connectTimeout: NodeJS.Timeout | null = null;
  knxReceiver: KNXReceiverTunneling | null = null;
  knxSender: KNXSenderTunneling | null = null;
  /**
  * IPEndPoint {host: host, port: port}
  */
  private localEndpoint: LocalEndPoint;
  ChannelId = 0x00;
  constructor(remoteIpAddress: string, remotePort: number, localIpAddress: string = getLocalIP(), localPort: number = 13671) {
    super(remoteIpAddress, remotePort)
    this.localIpAddress = localIpAddress;
    this.localPort = localPort;
    this.localEndpoint = {
      host: this.localIpAddress,
      port: localPort,
      toBytes: function () {
        if (!this.host || this.host === '')
          throw 'Cannot proceed toString for localIpAddress with empy host'
        if (localIpAddress.indexOf('.') === -1 || this.host.split('.').length < 4)
          throw 'Cannot proceed toString for localIpAddress with host[' + this.host + '], it should contain ip address'
        var result = Buffer.alloc(4);
        var arr = localIpAddress.split('.');
        result[0] = parseInt(arr[0]) & 255;
        result[1] = parseInt(arr[1]) & 255;
        result[2] = parseInt(arr[2]) & 255;
        result[3] = parseInt(arr[3]) & 255;
        return result;
      }
    };
  }
  /**
   * Timer
   */
  private stateRequestTimer: NodeJS.Timeout | null = null;
  /**
   * The KNXnet/ip communicates via UDP or TCP, this is the UDP client
   */
  private udpClient: null | dgram.Socket = null;
  /**
 * Represents the sequence number used in KNX/IP tunneling messages.
 *
 * The sequence number is included in `TUNNELING_REQUEST` messages to ensure 
 * proper synchronization between the KNX/IP client and server.
 *
 * ## Purpose:
 * - Prevents message duplication by tracking sent packets.
 * - Ensures correct acknowledgment (`TUNNELING_ACK`) from the server.
 * - Helps detect lost or out-of-order messages for retransmission.
 *
 * ## Behavior:
 * - The client increments this number with each new `TUNNELING_REQUEST`.
 * - The server must reply with the same sequence number in `TUNNELING_ACK`.
 * - Wraps around to `0x00` after reaching `0xFF` (8-bit counter).
 *
 * @private
 * @type {number}
 * @default 0x00
 */
  private sequenceNumber: number = 0x00;
  GenerateSequenceNumber = () => {
    return this.sequenceNumber++;
  }
  RevertSingleSequenceNumber = () => {
    return this.sequenceNumber--;
  }
  ResetSequenceNumber = () => {
    return this.sequenceNumber = 0x00;
  }
  ClearReconnectTimeout() {
    let thisClass = this
    if (thisClass.reConnectTimeout) {
      clearTimeout(this.reConnectTimeout as NodeJS.Timeout)
      this.reConnectTimeout = null
    }
  }
  ClearConnectTimeout() {
    let thisClass = this
    if (thisClass.connectTimeout) {
      clearTimeout(this.connectTimeout as NodeJS.Timeout)
      this.connectTimeout = null
    }
  }
  /**
   *  Start the connection
   * @param callback 
   * @returns 
   */
  Connect = (callback?: (msg?: { msg: string, reason: string }) => void) => {
    let thisClass = this;
    if (this.connected && this.udpClient) {
      callback && callback()
      return true;
    }
    this.connectTimeout = setTimeout(() => {
      thisClass.removeListener('connected', thisClass.ClearConnectTimeout);
      thisClass.Disconnect(function () {
        if (thisClass.debug)
          console.log('Error connecting: timeout');
        callback && callback({ msg: 'Error connecting: timeout', reason: 'CONNECTTIMEOUT' });
        thisClass.ClearReconnectTimeout();
        thisClass.reConnectTimeout = setTimeout(function () {
          if (thisClass.debug)
            console.log('reconnecting');
          thisClass.Connect(callback);
        }, 3 * CONNECT_TIMEOUT);
      });
    }, CONNECT_TIMEOUT);
    this.once('connected', thisClass.ClearConnectTimeout);
    if (callback) {
      this.removeListener('connected', callback);
      this.once('connected', callback);
    }
    try {
      if (this.udpClient != null) {
        try {
          this.udpClient.close();
          //this._udpClient.Client.Dispose();
        }
        catch (e) {
          // ignore
        }
      }

      this.udpClient = dgram.createSocket("udp4");//new UdpClient(_localEndpoint)
    }
    catch (e) {
      throw new ConnectionErrorException(JSON.stringify(this.localEndpoint), e);
    }
    // Here the classes that handle sending and receiving data are initialized.
    if (this.knxReceiver == null || this.knxSender == null) {
      this.knxReceiver = new KNXReceiverTunneling(this, this.udpClient, this.localEndpoint);
      this.knxSender = new KNXSenderTunneling(this, this.udpClient, this.RemoteEndpoint);
    }
    else {
      this.knxReceiver.SetClient(this.udpClient);
      this.knxSender.SetClient(this.udpClient);
    }
    // let thisClass = this;
    new Promise(function (fulfill, reject) {
      if (thisClass.knxReceiver instanceof KNXReceiverTunneling) {
        thisClass.knxReceiver.Start(fulfill);
      } else {
        console.error('knxReceiver is not instance of KNXReceiverTunneling')
      }
    })
      .then(function () {
        thisClass.InitializeStateRequest();
      })
      .then(function () {
        thisClass.ConnectRequest();
      })
      .then(function () {
        thisClass.emit('connect');
        thisClass.emit('connecting');
      });
  }
  /**
   * Stop the connection
   * @param callback 
   */
  Disconnect = (callback: (...any: any[]) => void) => {
    let thisClass = this;
    thisClass.ClearConnectTimeout();
    thisClass.ClearReconnectTimeout();
    if (callback)
      thisClass.once('disconnect', callback);
    try {
      this.TerminateStateRequest();
      new Promise(function (resolve, reject) {
        thisClass.ConnectRequest(resolve);
      })
        .then(function () {
          if (thisClass.knxReceiver instanceof KNXReceiverTunneling) {
            thisClass.knxReceiver.Stop();
          } else {
            console.error('knxReceiver is not instance of KNXReceiverTunneling')
          }
          if (thisClass.udpClient instanceof dgram.Socket) {
            thisClass.udpClient.close();
          } else {
            console.error('udpClient is not instance of dgram.Socket')
          }
          thisClass.connected = false;
          thisClass.emit('close');
          thisClass.emit('disconnect');
          thisClass.emit('disconnected');
        })
    }
    catch (e) {
      thisClass.emit('disconnect', e);
    }
  }
  delay(time: number) {
    return new Promise(function (resolve, reject) {
      setTimeout(resolve, time);
    });
  }
  timeout(fnForSuccessPromise: (fn: () => void) => void, time: number, timeoutFunc: () => void) {
    let success: boolean | null = null;
    let succPromise = new Promise(function (resolve, reject) {
      fnForSuccessPromise(function () {
        if (success === null) {
          success = true;
          resolve(success);
        } else { reject(); }
      });
    });
    let timeoutPromise = this.delay(time);
    timeoutPromise.then(function () {
      if (!success)
        return timeoutFunc && timeoutFunc();
    });
    return Promise.race([succPromise, timeoutPromise]);
  }
  /**
   * Check the connection every 60 seconds and send a status request, which if it does not receive a response after 10000ms, it attempts to restart the connection.
   */
  InitializeStateRequest() {
    let thisClass = this;
    this.stateRequestTimer = setInterval(function () {
      thisClass.timeout(function (resolve) {
        thisClass.removeAllListeners('alive');
        thisClass.StateRequest(function (err) {
          if (!err) {
            thisClass.once('alive', resolve);
          }
        });
      }, 2 * CONNECT_TIMEOUT, function () {
        if (thisClass.debug) {
          console.log('Connection stale, so disconnect and then try to reconnect again');
        }
        new Promise(function (resolve) {
          thisClass.Disconnect(resolve);
        }).then(function () {
          thisClass.Connect();
        });
      });
    }, 60000); // same time as ETS with group monitor open
  }
  TerminateStateRequest() {
    if (this.stateRequestTimer == null) return;
    clearTimeout(this.stateRequestTimer);
  }
  // TODO: I wonder if we can extract all these types of requests
  /**
   * 
   * @param resolve - This property is a resolver function of a promise, it is designed to receive an error if there is a problem in the sending.
   */
  ConnectRequest(resolve?: (value?: unknown) => void) {
    // HEADER
    let datagram = Buffer.alloc(26);
    datagram[0] = 0x06;
    datagram[1] = 0x10;
    datagram[2] = 0x02;
    datagram[3] = 0x05;
    datagram[4] = 0x00;
    datagram[5] = 0x1A;

    datagram[6] = 0x08;
    datagram[7] = 0x01;
    datagram[8] = this.localEndpoint.toBytes()[0];
    datagram[9] = this.localEndpoint.toBytes()[1];
    datagram[10] = this.localEndpoint.toBytes()[2];
    datagram[11] = this.localEndpoint.toBytes()[3];
    datagram[12] = (this.localEndpoint.port >> 8) & 255;
    datagram[13] = this.localEndpoint.port & 255;
    datagram[14] = 0x08;
    datagram[15] = 0x01;
    datagram[16] = this.localEndpoint.toBytes()[0];
    datagram[17] = this.localEndpoint.toBytes()[1];
    datagram[18] = this.localEndpoint.toBytes()[2];
    datagram[19] = this.localEndpoint.toBytes()[3];
    datagram[20] = (this.localEndpoint.port >> 8) & 255;
    datagram[21] = this.localEndpoint.port & 255;
    datagram[22] = 0x04;
    datagram[23] = 0x04;
    datagram[24] = 0x02;
    datagram[25] = 0x00;
    try {
      if (this.knxSender instanceof KNXSenderTunneling) {
        this.knxSender.SendDataSingle(datagram, resolve);
      }
    }
    catch (e) {
      resolve && resolve();
    }
  }
  /**
   * 
   * @param resolve - This property is a resolver function of a promise, it is designed to receive an error if there is a problem in the sending.
   */
  StateRequest(resolve: (value?: unknown) => void) {
    // HEADER
    let datagram = Buffer.alloc(16);
    datagram[0] = 0x06;
    datagram[1] = 0x10;
    datagram[2] = 0x02;
    datagram[3] = 0x07;
    datagram[4] = 0x00;
    datagram[5] = 0x10;

    datagram[5] = this.ChannelId;
    datagram[7] = 0x00;
    datagram[8] = 0x08;
    datagram[9] = 0x01;
    datagram[10] = this.localEndpoint.toBytes()[0];
    datagram[11] = this.localEndpoint.toBytes()[1];
    datagram[12] = this.localEndpoint.toBytes()[2];
    datagram[13] = this.localEndpoint.toBytes()[3];
    datagram[14] = (this.localEndpoint.port >> 8) & 255;
    datagram[15] = this.localEndpoint.port & 255;

    try {
      if (this.knxSender instanceof KNXSenderTunneling) {
        this.knxSender.SendData(datagram, resolve);
      }
    }
    catch (e) {
      resolve(e)
    }
  }
  /**
 * 
 * @param resolve - This property is a resolver function of a promise, it is designed to receive an error if there is a problem in the sending.
 */
  DisconnectRequest(resolve: (value?: unknown) => void) {
    if (!this.connected) {
      resolve && resolve();
      return false;
    }
    // HEADER
    var datagram = Buffer.alloc(16);
    datagram[0] = 0x06;
    datagram[1] = 0x10;
    datagram[2] = 0x02;
    datagram[3] = 0x09;
    datagram[4] = 0x00;
    datagram[5] = 0x10;

    datagram[6] = this.ChannelId;
    datagram[7] = 0x00;
    datagram[8] = 0x08;
    datagram[9] = 0x01;
    datagram[10] = this.localEndpoint.toBytes()[0];
    datagram[11] = this.localEndpoint.toBytes()[1];
    datagram[12] = this.localEndpoint.toBytes()[2];
    datagram[13] = this.localEndpoint.toBytes()[3];
    datagram[14] = (this.localEndpoint.port >> 8) & 255;
    datagram[15] = this.localEndpoint.port & 255;
    try {
      if (this.knxSender instanceof KNXSenderTunneling) {
        this.knxSender.SendData(datagram, resolve);
      }
    }
    catch (e) {
      resolve(e)
    }
  }
}

