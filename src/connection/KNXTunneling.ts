import dgram from "dgram";
import net from "net";
import { KNXService } from "./KNXService";
import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import { HPAI, CRI, CRD } from "../core/KNXnetIPStructures";
import {
  KNXnetIPServiceType,
  KNXnetIPErrorCodes,
  HostProtocolCode,
  ConnectionType,
} from "../core/enum/KNXnetIPEnum";
import { CEMI } from "../core/CEMI";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { KNXTunnelingOptions } from "../@types/interfaces/connection";


/**
 * Handles KNXnet/IP Tunneling connections for point-to-point communication with a KNX gateway.
 * This class manages the connection state, sequence numbering for reliable delivery,
 * heartbeat monitoring (ConnectionState), and message queuing over both UDP and TCP transports.
 */
export class KNXTunneling extends KNXService<KNXTunnelingOptions> {
  private channelId: number = 0;
  private sequenceNumber: number = 0;
  private rxSequenceNumber: number = 0;
  private isConnected: boolean = false;
  private tcpBuffer: Buffer = Buffer.alloc(0);
  public assignedAddress: number = 0; // Assigned Individual Address

  // Heartbeat
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatFailures: number = 0;
  private heartbeatRetryTimer: NodeJS.Timeout | null = null;

  // Message Queue
  private msgQueue: {
    packet: Buffer;
    serviceType: KNXnetIPServiceType;
    resolve: (val?: any) => void;
    reject: (e: Error) => void;
    responseType?: KNXnetIPServiceType;
  }[] = [];
  private isSending: boolean = false;
  private pendingAck: {
    seq: number;
    timer: NodeJS.Timeout;
    retryCount: number;
    currentMsg: any;
  } | null = null;
  private activeRequest: any | null = null;

  private readonly MAX_QUEUE_SIZE: number;

  // Disconnect
  private disconnectTimeout: NodeJS.Timeout | null = null;

  constructor(options: KNXTunnelingOptions) {
    super(options);
    this._transport = options.transport || "UDP";
    if (!this.options.connectionType) {
      this.options.connectionType =
        ConnectionType.TUNNEL_CONNECTION;
    }
    this.MAX_QUEUE_SIZE = options.maxQueueSize || 100;
    this.logger = this.logger.child({ module: "TunnelClient" });
  }

  async connect(): Promise<void> {
    this.rxSequenceNumber = 0;
    if (this._transport === "TCP") {
      await this.connectTCP();
    } else {
      await this.connectUDP();
    }
  }

  private async connectUDP(): Promise<void> {
    this.socket = dgram.createSocket("udp4");

    // Manejo de mensajes entrantes
    this.socket.on("message", (msg) => this.handleMessage(msg));

    // ERROR GLOBAL: Si el socket muere, desconectamos
    this.socket.on("error", (err) => {
      this.emit("error", err);
      this.disconnect();
    });

    return new Promise((resolve, reject) => {
      // Listener temporal para atrapar errores DURANTE la conexión inicial
      const errorListener = (err: Error) => {
        this.removeListener("connected", successListener);
        reject(err);
      };

      const successListener = (info: any) => {
        this.removeListener("error", errorListener); // Limpiamos el listener de error temporal
        resolve();
      };

      // Escuchamos ambos eventos
      this.once("error", errorListener);
      this.once("connected", successListener);

      // Bind
      (this.socket as dgram.Socket).bind(
        this.options.localPort,
        this.options.localIp,
        () => {
          try {
            this.sendConnectRequest();
          } catch (e) {
            reject(e);
          }
        },
      );
    });
  }

  private async connectTCP(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();

      (this.socket as net.Socket).connect(
        this.options.port!,
        this.options.ip!,
        () => {
          this.sendConnectRequest();
          this.once("connected", resolve);
        },
      );

      (this.socket as net.Socket).on("data", (data) => {
        this.tcpBuffer = Buffer.concat([this.tcpBuffer, data]);
        while (this.tcpBuffer.length >= 6) {
          const totalLength = this.tcpBuffer.readUInt16BE(4);
          if (this.tcpBuffer.length >= totalLength) {
            const frame = this.tcpBuffer.subarray(0, totalLength);
            this.tcpBuffer = this.tcpBuffer.subarray(totalLength);
            this.handleMessage(frame);
          } else {
            break;
          }
        }
      });

      (this.socket as net.Socket).on("error", (err) => {
        this.emit("error", err);
        this.disconnect();
        reject(err);
      });

      (this.socket as net.Socket).on("close", () => this.disconnect());
    });
  }

  private sendConnectRequest() {
    const localPort =
      this._transport === "UDP"
        ? (this.socket as dgram.Socket).address().port
        : (this.socket as net.Socket).localPort!;

    const useRouteBack = this.options.useRouteBack;
    const hpai = new HPAI(
      this._transport === "TCP"
        ? HostProtocolCode.IPV4_TCP
        : HostProtocolCode.IPV4_UDP,
      useRouteBack ? "0.0.0.0" : this.options.localIp!,
      useRouteBack ? 0 : localPort,
    );
    // @ts-ignore
    const cri = new CRI(this.options.connectionType!);

    const header = new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_REQUEST, 0);
    // CORRECCIÓN
    // Estructura: HPAI (Control) -> HPAI (Data) -> CRI
    const body = Buffer.concat([
      hpai.toBuffer(),
      hpai.toBuffer(),
      cri.toBuffer(),
    ]);
    header.totalLength = 6 + body.length;

    this.sendRaw(Buffer.concat([header.toBuffer(), body]));
  }

  disconnect() {
    if (this.isConnected && this.channelId) {
      const localPort =
        this._transport === "UDP"
          ? (this.socket as dgram.Socket).address().port
          : (this.socket as net.Socket).localPort!;
      const useRouteBack = this.options.useRouteBack;
      const hpai = new HPAI(
        this._transport === "TCP"
          ? HostProtocolCode.IPV4_TCP
          : HostProtocolCode.IPV4_UDP,
        useRouteBack ? "0.0.0.0" : this.options.localIp!,
        useRouteBack ? 0 : localPort,
      );

      const header = new KNXnetIPHeader(
        KNXnetIPServiceType.DISCONNECT_REQUEST,
        0,
      );
      const body = Buffer.concat([
        Buffer.from([this.channelId, 0x00]),
        hpai.toBuffer(),
      ]);
      header.totalLength = 6 + body.length;
      this.sendRaw(Buffer.concat([header.toBuffer(), body]));

      // Graceful disconnect: Wait for response or timeout (1s)
      this.disconnectTimeout = setTimeout(() => {
        this.closeSocket();
      }, 1000);
    } else {
      this.closeSocket();
    }
  }

  private closeSocket() {
    this.stopHeartbeat();
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }
    this.isConnected = false;
    this.channelId = 0;

    if (this.socket) {
      if (this._transport === "UDP") (this.socket as dgram.Socket).close();
      else (this.socket as net.Socket).destroy();
      this.socket = null;
    }
    this.emit("disconnected");
  }

  // #region Message Queue & Sending
  async send(cemi: ServiceMessage | Buffer): Promise<void> {
    if (!this.isConnected) throw new Error("Not connected");

    if (this.msgQueue.length >= this.MAX_QUEUE_SIZE) {
      throw new Error("Outgoing queue full");
    }

    const cemiBuffer = Buffer.isBuffer(cemi) ? cemi : cemi.toBuffer();
    const isDeviceMgmt =
      this.options.connectionType ===
      ConnectionType.DEVICE_MGMT_CONNECTION;
    const serviceType = isDeviceMgmt
      ? KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST
      : KNXnetIPServiceType.TUNNELLING_REQUEST;

    return new Promise((resolve, reject) => {
      this.msgQueue.push({ packet: cemiBuffer, serviceType, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.isSending || this.msgQueue.length === 0) return;

    this.isSending = true;
    const msg = this.msgQueue.shift()!;
    this.activeRequest = msg;

    const header = new KNXnetIPHeader(msg.serviceType, 0);
    const connHeader = Buffer.from([
      0x04,
      this.channelId,
      this.sequenceNumber,
      0x00,
    ]);
    header.totalLength = 6 + connHeader.length + msg.packet.length;
    const packet = Buffer.concat([header.toBuffer(), connHeader, msg.packet]);

    this.pendingAck = {
      seq: this.sequenceNumber,
      timer: setTimeout(() => this.handleAckTimeout(), 1000),
      retryCount: 0,
      currentMsg: msg,
    };

    this.sendRaw(packet);
  }

  private handleAckTimeout() {
    if (!this.pendingAck) return;

    if (this.pendingAck.retryCount < 1) {
      // 1 retry (Spec 2.6.1)
      this.pendingAck.retryCount++;
      const msg = this.pendingAck.currentMsg;

      const header = new KNXnetIPHeader(msg.serviceType, 0);
      const connHeader = Buffer.from([
        0x04,
        this.channelId,
        this.pendingAck.seq,
        0x00,
      ]);
      header.totalLength = 6 + connHeader.length + msg.packet.length;
      const packet = Buffer.concat([header.toBuffer(), connHeader, msg.packet]);

      this.logger.warn(`ACK timeout for seq ${this.pendingAck.seq}, retrying (1/1)...`);
      this.sendRaw(packet);
      this.pendingAck.timer = setTimeout(() => this.handleAckTimeout(), 1000);
    } else {
      // Fail (Spec 2.6.1: terminate connection)
      const reject = this.pendingAck.currentMsg.reject;
      this.logger.error(`ACK timeout failed after retry for seq ${this.pendingAck.seq}. Terminating connection.`);
      this.pendingAck = null;
      this.isSending = false;
      reject(new Error("Tunneling ACK Timeout"));
      this.disconnect();
    }
  }
  // #endregion

  // #region Tunneling Features
  public async getFeature(featureId: number): Promise<Buffer> {
    if (!this.isConnected) throw new Error("Not connected");
    if (this.msgQueue.length >= this.MAX_QUEUE_SIZE) {
      throw new Error("Outgoing queue full");
    }

    return new Promise((resolve, reject) => {
      const body = Buffer.from([featureId, 0x00]); // FeatureID + Reserved
      this.msgQueue.push({
        packet: body,
        serviceType: KNXnetIPServiceType.TUNNELLING_FEATURE_GET,
        resolve,
        reject,
        responseType: KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE,
      });
      this.processQueue();
    });
  }
  // #endregion

  private handleMessage(msg: Buffer) {
    this.emit("raw_message", msg);
    try {
      const header = KNXnetIPHeader.fromBuffer(msg);
      const body = msg.subarray(6);

      switch (header.serviceType) {
        case KNXnetIPServiceType.CONNECT_RESPONSE:
          const status = body[1];
          if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
            this.channelId = body[0];
            this.sequenceNumber = 0;
            this.rxSequenceNumber = 0;
            this.isConnected = true;

            // Parse CRD
            if (body.length >= 14) {
              const crd = CRD.fromBuffer(body.subarray(10));
              this.assignedAddress = crd.knxAddress;
              this.emit("connected", {
                channelId: this.channelId,
                assignedAddress: crd.knxAddress,
              });
            } else {
              this.emit("connected", { channelId: this.channelId });
            }
            this.startHeartbeat();
          } else {
            this.emit(
              "error",
              new Error(`Connect Error: 0x${status.toString(16)}`),
            );
          }
          break;
        case KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE:
          if (body[0] === this.channelId) {
            if (body[1] === KNXnetIPErrorCodes.E_NO_ERROR) {
              this.heartbeatFailures = 0;
              if (this.heartbeatRetryTimer) {
                clearTimeout(this.heartbeatRetryTimer);
                this.heartbeatRetryTimer = null;
              }
            } else {
              this.logger.warn(`Heartbeat response error from server: 0x${body[1].toString(16)}`);
              // If it's a connection ID error, we should probably disconnect
              if (body[1] === KNXnetIPErrorCodes.E_CONNECTION_ID) {
                this.emit(
                  "error",
                  new Error("Connection ID no longer valid on server"),
                );
                this.disconnect();
              }
            }
          }
          break;
        case KNXnetIPServiceType.CONNECTIONSTATE_REQUEST:
          if (body[0] === this.channelId) {
            const respHeader = new KNXnetIPHeader(
              KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE,
              0,
            );
            const respBody = Buffer.from([
              this.channelId,
              KNXnetIPErrorCodes.E_NO_ERROR,
            ]);
            respHeader.totalLength = 6 + respBody.length;
            this.sendRaw(Buffer.concat([respHeader.toBuffer(), respBody]));
          }
          break;
        case KNXnetIPServiceType.TUNNELLING_REQUEST:
          this.handleRequest(body, KNXnetIPServiceType.TUNNELLING_ACK);
          break;
        case KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST:
          this.handleRequest(
            body,
            KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK,
          );
          break;
        case KNXnetIPServiceType.TUNNELLING_ACK:
        case KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK:
          if (this.pendingAck && body[2] === this.pendingAck.seq) {
            const status = body[3];
            if (status !== KNXnetIPErrorCodes.E_NO_ERROR) {
              this.logger.error(
                `Received ACK with error status: 0x${status.toString(16)}. Terminating.`,
              );
              if (this.activeRequest)
                this.activeRequest.reject(
                  new Error(`ACK Error: 0x${status.toString(16)}`),
                );
              clearTimeout(this.pendingAck.timer);
              this.pendingAck = null;
              this.isSending = false;
              this.activeRequest = null;
              this.disconnect();
              return;
            }

            clearTimeout(this.pendingAck.timer);
            this.pendingAck = null;

            if (!this.activeRequest?.responseType) {
              this.isSending = false;
              if (this.activeRequest) this.activeRequest.resolve();
              this.activeRequest = null;
              this.sequenceNumber = (this.sequenceNumber + 1) & 0xff;
              this.processQueue();
            } else {
              this.logger.debug(
                `ACK received for seq ${this.sequenceNumber}, waiting for response type 0x${this.activeRequest.responseType.toString(16)}`,
              );
            }
          }
          break;
        case KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE:
          // Body: ConnHeader(4) + FeatureID(1) + ReturnCode(1) + Value(n)
          if (
            this.isSending &&
            this.activeRequest?.responseType ===
            KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE
          ) {
            if (
              body[0] === 0x04 &&
              body[1] === this.channelId &&
              body[2] === this.sequenceNumber
            ) {
              const returnCode = body[5];
              const val = body.subarray(6);

              const resolve = this.activeRequest.resolve;
              const reject = this.activeRequest.reject;

              this.isSending = false;
              this.activeRequest = null;
              this.sequenceNumber = (this.sequenceNumber + 1) & 0xff;

              if (returnCode === KNXnetIPErrorCodes.E_NO_ERROR) {
                resolve(val);
              } else {
                reject(new Error(`Feature Error: 0x${returnCode.toString(16)}`));
              }
              this.processQueue();
            }
          }
          break;
        case KNXnetIPServiceType.DISCONNECT_REQUEST:
          // Server closed connection
          this.closeSocket();
          break;
        case KNXnetIPServiceType.DISCONNECT_RESPONSE:
          this.closeSocket();
          break;
        case KNXnetIPServiceType.TUNNELLING_FEATURE_INFO:
          // Body: ConnHeader(4) + FeatureID(1) + Len(1) + Value...
          if (body[0] === 0x04 && body[1] === this.channelId) {
            // Check Conn Header length & Channel ID
            const featureId = body[4];
            const val = body.subarray(6);
            this.emit("feature_info", featureId, val);
          }
          break;
      }
    } catch (e) {
      this.emit("error", e);
    }
  }

  private handleRequest(body: Buffer, ackType: KNXnetIPServiceType) {
    const seq = body[2];

    // Check for sequence number
    if (seq === this.rxSequenceNumber) {
      // Correct sequence
      this.sendAck(ackType, seq, KNXnetIPErrorCodes.E_NO_ERROR);
      this.rxSequenceNumber = (this.rxSequenceNumber + 1) & 0xff;

      try {
        const len = body[0]; // Connection Header Length
        const data = body.subarray(len);
        const cemi = CEMI.fromBuffer(data);
        this.emit("indication", cemi);
        this.emit("raw_indication", data);
      } catch (e) { }
    } else if (seq === ((this.rxSequenceNumber - 1) & 0xff)) {
      // Duplicate frame, send ACK again but don't process
      this.sendAck(ackType, seq, KNXnetIPErrorCodes.E_NO_ERROR);
    } else {
      // Out of sequence, discard (TCP handles this mostly, but for UDP/Tunneling logic)
      // Do not ACK
    }
  }

  private sendAck(type: KNXnetIPServiceType, seq: number, status: number) {
    const header = new KNXnetIPHeader(type, 0);
    const body = Buffer.from([0x04, this.channelId, seq, status]);
    header.totalLength = 6 + body.length;
    this.sendRaw(Buffer.concat([header.toBuffer(), body]));
  }

  private sendRaw(buffer: Buffer) {
    if (!this.socket) return;
    if (this._transport === "UDP") {
      (this.socket as dgram.Socket).send(
        buffer,
        this.options.port!,
        this.options.ip!,
      );
    } else {
      (this.socket as net.Socket).write(buffer);
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatFailures = 0;

    // Check every 60s (as per spec)
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeatRequest();
    }, 60000);
  }

  private sendHeartbeatRequest() {
    const localPort =
      this._transport === "UDP"
        ? (this.socket as dgram.Socket).address().port
        : (this.socket as net.Socket).localPort!;

    const useRouteBack = this.options.useRouteBack;
    const hpai = new HPAI(
      this._transport === "TCP"
        ? HostProtocolCode.IPV4_TCP
        : HostProtocolCode.IPV4_UDP,
      useRouteBack ? "0.0.0.0" : this.options.localIp!,
      useRouteBack ? 0 : localPort,
    );
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.CONNECTIONSTATE_REQUEST,
      0,
    );
    const body = Buffer.concat([
      Buffer.from([this.channelId, 0x00]),
      hpai.toBuffer(),
    ]);
    header.totalLength = 6 + body.length;

    this.sendRaw(Buffer.concat([header.toBuffer(), body]));

    // Check timeout in 10s (spec recommendation)
    if (this.heartbeatRetryTimer) clearTimeout(this.heartbeatRetryTimer);
    this.heartbeatRetryTimer = setTimeout(
      () => this.handleHeartbeatTimeout(),
      10000,
    );
  }

  private handleHeartbeatTimeout() {
    this.heartbeatFailures++;
    this.logger.warn(`Heartbeat timeout (${this.heartbeatFailures}/3)`);
    if (this.heartbeatFailures >= 3) {
      this.emit("error", new Error("Heartbeat failed 3 times"));
      this.disconnect();
    } else {
      // Immediate retry
      this.sendHeartbeatRequest();
    }
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatRetryTimer) clearTimeout(this.heartbeatRetryTimer);
    this.heartbeatTimer = null;
    this.heartbeatRetryTimer = null;
  }
}
