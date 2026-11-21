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
  InterfaceFeatureId,
  KNXLayer,
  SecureSessionStatus,
  TunnellingFeatureReturnCode,
} from "../core/enum/KNXnetIPEnum";
import { CEMI, CEMIInstance } from "../core/CEMI";
import { KNXDiscoveredDevice, KNXDiscoverOptions, KNXTunnelingOptions } from "../@types/interfaces/connection";
import { KNXHelper } from "../utils/KNXHelper";
import { GroupAddressCache } from "../core/cache/GroupAddressCache";
import { FSM } from "./FSM";
import { TcpFrameReader } from "./TcpFrameReader";
import { SecureSession } from "./SecureSession";
import { KnxKeyring } from "../security/KnxKeyring";
import { discoverKnxDevices } from "./KNXDiscovery";

/**
 * States for the KNXTunneling Finite State Machine.
 */
export enum KNXTunnelingState {
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  RECONNECTING = "RECONNECTING",
  FAULTED = "FAULTED",
}

/**
 * Events triggering transitions in the KNXTunneling FSM.
 */
export enum KNXTunnelingEvent {
  START = "START",
  STOP = "STOP",
  CONNECTED = "CONNECTED",
  CONNECTION_LOST = "CONNECTION_LOST",
  RETRY = "RETRY",
  FAIL_FATAL = "FAIL_FATAL",
}

/**
 * Handles KNXnet/IP Tunneling connections for point-to-point communication with a KNX gateway.
 * This class manages the connection state via an internal FSM, sequence numbering for reliable delivery,
 * heartbeat monitoring (ConnectionState), and message queuing over both UDP and TCP transports.
 */
export class KNXTunneling extends KNXService<KNXTunnelingOptions> {
  private fsm: FSM<KNXTunnelingState, KNXTunnelingEvent>;
  private channelId: number = 0;
  private sequenceNumber: number = 0;
  private rxSequenceNumber: number = 0;
  private tcpFrameReader: TcpFrameReader = new TcpFrameReader();
  private secureSession: SecureSession | null = null;
  private secureKeepAliveTimer: NodeJS.Timeout | null = null;
  public individualAddress: string = "1.0.1"; // Assigned Individual Address
  private isManualIA = false;
  // Heartbeat
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatFailures: number = 0;
  private heartbeatRetryTimer: NodeJS.Timeout | null = null;

  // Reconnection
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

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
    this._transport = options.secure ? "TCP" : options.transport || "UDP";
    if (!this.options.connectionType) {
      this.options.connectionType = ConnectionType.TUNNEL_CONNECTION;
    }
    this.options.port = options.port || 3671;
    this.MAX_QUEUE_SIZE = options.maxQueueSize || 100;
    this.logger = this.logger.child({ module: "TunnelClient" });
    if (options.individualAddress) {
      this.individualAddress =
        typeof options.individualAddress === "number"
          ? KNXHelper.individualAddressToString(options.individualAddress)
          : options.individualAddress;
      this.isManualIA = true;
    }

    // Initialize the FSM
    this.fsm = new FSM<KNXTunnelingState, KNXTunnelingEvent>(
      KNXTunnelingState.DISCONNECTED,
      {
        [KNXTunnelingState.DISCONNECTED]: {
          [KNXTunnelingEvent.START]: KNXTunnelingState.CONNECTING,
        },
        [KNXTunnelingState.CONNECTING]: {
          [KNXTunnelingEvent.CONNECTED]: KNXTunnelingState.CONNECTED,
          [KNXTunnelingEvent.CONNECTION_LOST]: KNXTunnelingState.RECONNECTING,
          [KNXTunnelingEvent.STOP]: KNXTunnelingState.DISCONNECTED,
        },
        [KNXTunnelingState.CONNECTED]: {
          [KNXTunnelingEvent.CONNECTION_LOST]: KNXTunnelingState.RECONNECTING,
          [KNXTunnelingEvent.STOP]: KNXTunnelingState.DISCONNECTED,
        },
        [KNXTunnelingState.RECONNECTING]: {
          [KNXTunnelingEvent.CONNECTED]: KNXTunnelingState.CONNECTED,
          [KNXTunnelingEvent.RETRY]: KNXTunnelingState.RECONNECTING,
          [KNXTunnelingEvent.FAIL_FATAL]: KNXTunnelingState.FAULTED,
          [KNXTunnelingEvent.STOP]: KNXTunnelingState.DISCONNECTED,
        },
        [KNXTunnelingState.FAULTED]: {
          [KNXTunnelingEvent.START]: KNXTunnelingState.CONNECTING,
          [KNXTunnelingEvent.STOP]: KNXTunnelingState.DISCONNECTED,
        },
      },
      (newState, oldState) => this.handleStateChange(newState, oldState),
    );

    this.logger.info(
      `Tunneling initialized with ip: ${options.ip} and port: ${options.port} and transport: ${this._transport}`,
    );
  }

  /**
   * Discovers KNXnet/IP servers using `SEARCH_REQUEST` / `SEARCH_REQUEST_EXTENDED`
   * with optional Search Request Parameters (SRPs).
   */
  public static async discover(options: KNXDiscoverOptions = {}): Promise<KNXDiscoveredDevice[]> {
    return discoverKnxDevices(options);
  }

  /**
   * Returns the current FSM state as a string.
   */
  public get connectionState(): string {
    return this.fsm.state;
  }

  /**
   * Returns true if currently connected.
   */
  public get isConnected(): boolean {
    return this.fsm.state === KNXTunnelingState.CONNECTED;
  }

  /**
   * Dispatches the transition to start the connection process.
   * Resolves when connected, rejects if connection fails or times out.
   */
  async connect(): Promise<void> {
    if (this.fsm.state === KNXTunnelingState.CONNECTED) return;

    return new Promise<void>((resolve, reject) => {
      const onConnected = () => {
        this.removeListener("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        this.removeListener("connected", onConnected);
        reject(err);
      };
      this.once("connected", onConnected);
      this.once("error", onError);

      this.fsm.transition(KNXTunnelingEvent.START);
    });
  }

  /**
   * Internal wrapper that performs the socket setup and connection.
   */
  private async performConnect(): Promise<void> {
    this.rxSequenceNumber = 0;
    try {
      if (this._transport === "TCP") {
        await this.connectTCP();
      } else {
        await this.connectUDP();
      }
      this.fsm.transition(KNXTunnelingEvent.CONNECTED);
    } catch (err: any) {
      this.fsm.transition(KNXTunnelingEvent.CONNECTION_LOST);
      throw err;
    }
  }

  private async connectUDP(): Promise<void> {
    this.socket = dgram.createSocket("udp4");

    // Message handler
    this.socket.on("message", (msg) => this.handleMessage(msg));

    // Socket error handler
    this.socket.on("error", (err) => {
      this.handleConnectionLost(err);
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener("connected", successListener);
        this.removeListener("error", errorListener);
        this.closeSocket();
        reject(new Error("Connection timeout"));
      }, 6000);

      const errorListener = (err: Error) => {
        clearTimeout(timeout);
        this.removeListener("connected", successListener);
        reject(err);
      };

      const successListener = () => {
        clearTimeout(timeout);
        this.removeListener("error", errorListener);
        resolve();
      };

      this.once("error", errorListener);
      this.once("connected", successListener);

      (this.socket as dgram.Socket).bind(this.options.localPort, this.options.localIp, () => {
        try {
          this.sendConnectRequest();
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
    });
  }

  private buildSecureSession(): SecureSession {
    const sec = this.options.secure!;
    let userId = sec.userId;
    let userPassword = sec.userPassword;
    let deviceAuthPassword = sec.deviceAuthenticationPassword;

    if (sec.keyringFile) {
      const keyring = KnxKeyring.fromSource(sec.keyringFile, sec.keyringPassword ?? "");
      const iface = keyring.getInterface(sec.tunnelInterfaceAddress);
      if (iface) {
        if (userId === undefined && iface.userId !== undefined) {
          userId = iface.userId;
        }
        if (userPassword === undefined && iface.decryptedPassword !== undefined) {
          userPassword = iface.decryptedPassword;
        }
        if (deviceAuthPassword === undefined && iface.decryptedAuthentication !== undefined) {
          deviceAuthPassword = iface.decryptedAuthentication;
        }
      }
      if (deviceAuthPassword === undefined && sec.tunnelInterfaceAddress) {
        const dev = keyring.getDevice(sec.tunnelInterfaceAddress);
        if (dev?.decryptedAuthentication !== undefined) {
          deviceAuthPassword = dev.decryptedAuthentication;
        }
      }
    }

    return new SecureSession({
      userId: userId ?? 2,
      userPassword: userPassword ?? "",
      deviceAuthenticationPassword: deviceAuthPassword,
      requireDeviceAuthentication: sec.requireDeviceAuthentication,
      serialNumber: sec.serialNumber,
    });
  }

  private getControlHPAI(): HPAI {
    if (this._transport === "TCP") {
      return HPAI.NULL_TCP_HPAI;
    }
    const localPort = (this.socket as dgram.Socket).address().port;
    const useRouteBack = this.options.useRouteBack;
    return new HPAI(
      HostProtocolCode.IPV4_UDP,
      useRouteBack ? "0.0.0.0" : this.options.localIp!,
      useRouteBack ? 0 : localPort,
    );
  }

  private async connectTCP(): Promise<void> {
    this.tcpFrameReader.reset();
    if (this.options.secure) {
      this.secureSession = this.buildSecureSession();
    } else {
      this.secureSession = null;
    }

    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      let settled = false;

      const timeoutMs = this.options.secure ? 10000 : 6000;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.removeListener("connected", successListener);
        this.removeListener("error", errorListener);
        this.closeSocket();
        reject(new Error("Connection timeout"));
      }, timeoutMs);

      const errorListener = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.removeListener("connected", successListener);
        this.closeSocket();
        reject(err);
      };

      const successListener = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.removeListener("error", errorListener);
        resolve();
      };

      this.once("error", errorListener);
      this.once("connected", successListener);

      (this.socket as net.Socket).connect(this.options.port!, this.options.ip!, () => {
        try {
          if (this.secureSession) {
            const reqFrame = this.secureSession.startHandshake();
            this.sendRawPlain(reqFrame);
          } else {
            this.sendConnectRequest();
          }
        } catch (err) {
          errorListener(err instanceof Error ? err : new Error(String(err)));
        }
      });

      (this.socket as net.Socket).on("data", (data) => {
        const chunk = typeof data === "string" ? Buffer.from(data) : data;
        let frames: Buffer[];
        try {
          frames = this.tcpFrameReader.push(chunk);
        } catch (err: any) {
          const streamErr = err instanceof Error ? err : new Error(String(err));
          this.handleConnectionLost(streamErr);
          return;
        }
        for (const frame of frames) {
          this.handleMessage(frame);
        }
      });

      (this.socket as net.Socket).on("error", (err) => {
        clearTimeout(timeout);
        this.handleConnectionLost(err);
        if (!settled) {
          settled = true;
          this.removeListener("connected", successListener);
          this.removeListener("error", errorListener);
          reject(err);
        }
      });

      (this.socket as net.Socket).on("close", () => {
        clearTimeout(timeout);
        this.handleConnectionLost(new Error("TCP connection closed by remote peer"));
      });
    });
  }

  private sendConnectRequest() {
    const hpai = this.getControlHPAI();
    const knxLayer = this.options.knxLayer ?? KNXLayer.LINK_LAYER;
    // let requestedIA: number | null = null;
    // if (this.options.individualAddress !== undefined) {
    //   requestedIA =
    //     typeof this.options.individualAddress === "number"
    //       ? this.options.individualAddress
    //       : KNXHelper.GetAddress(this.options.individualAddress, ".").readUInt16BE(0);
    // }
    const cri = new CRI(this.options.connectionType!, knxLayer);

    const header = new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_REQUEST, 0);
    const body = Buffer.concat([hpai.toBuffer(), hpai.toBuffer(), cri.toBuffer()]);
    header.totalLength = 6 + body.length;

    this.sendRaw(Buffer.concat([header.toBuffer(), body]));
  }

  /**
   * Safe disconnection of the connection.
   */
  disconnect() {
    if (this.fsm.state === KNXTunnelingState.CONNECTED && this.channelId) {
      try {
        const hpai = this.getControlHPAI();
        const header = new KNXnetIPHeader(KNXnetIPServiceType.DISCONNECT_REQUEST, 0);
        const body = Buffer.concat([Buffer.from([this.channelId, 0x00]), hpai.toBuffer()]);
        header.totalLength = 6 + body.length;
        this.sendRaw(Buffer.concat([header.toBuffer(), body]));
      } catch {
        /* empty */
      }

      this.disconnectTimeout = setTimeout(() => {
        this.closeSecureSessionIfOpen();
        this.fsm.transition(KNXTunnelingEvent.STOP);
      }, 1000);
    } else {
      this.closeSecureSessionIfOpen();
      this.fsm.transition(KNXTunnelingEvent.STOP);
    }
  }

  private closeSecureSessionIfOpen() {
    this.stopSecureKeepAlive();
    if (this.secureSession && this.secureSession.hasSessionKey) {
      const closeFrame = this.secureSession.buildCloseFrame();
      if (closeFrame) {
        this.sendRawPlain(closeFrame);
      }
    } else if (this.secureSession) {
      this.secureSession.close();
    }
  }

  private closeSocket() {
    this.stopHeartbeat();
    this.stopSecureKeepAlive();
    if (this.secureSession) {
      this.secureSession.close();
    }
    this.tcpFrameReader.reset();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }
    this.channelId = 0;

    if (this.socket) {
      const sock = this.socket;
      this.socket = null;
      try {
        sock.removeAllListeners();
        sock.on("error", () => {});
        if (this._transport === "UDP") {
          (sock as dgram.Socket).close();
        } else {
          (sock as net.Socket).end();
          (sock as net.Socket).unref();
        }
      } catch {
        /* empty */
      }
    }
    this.emit("disconnected");
  }

  /**
   * Action handler for FSM state entries.
   */
  private async handleStateChange(newState: KNXTunnelingState, oldState: KNXTunnelingState): Promise<void> {
    this.logger.info(`FSM: State transition from ${oldState} to ${newState}`);

    switch (newState) {
      case KNXTunnelingState.CONNECTING:
        this.reconnectAttempts = 0;
        try {
          await this.performConnect();
        } catch {
          /* Handled in performConnect */
        }
        break;

      case KNXTunnelingState.CONNECTED:
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.emit("connected", {
          channelId: this.channelId,
          individualAddress: this.individualAddress,
        });
        this.startHeartbeat();
        break;

      case KNXTunnelingState.RECONNECTING:
        this.scheduleReconnection();
        break;

      case KNXTunnelingState.DISCONNECTED:
        this.closeSocket();
        break;

      case KNXTunnelingState.FAULTED:
        this.closeSocket();
        this.emit("error", new Error("Connection faulted: Max reconnection attempts exceeded."));
        break;
    }
  }

  /**
   * Automatically handles unexpected connection loss.
   */
  private handleConnectionLost(err: Error) {
    if (this.fsm.state === KNXTunnelingState.DISCONNECTED || this.fsm.state === KNXTunnelingState.FAULTED) return;
    this.logger.warn(`Connection lost: ${err.message}`);
    this.closeSocket();
    const autoReconnect = this.options.autoReconnect ?? true;
    if (autoReconnect) {
      this.fsm.transition(KNXTunnelingEvent.CONNECTION_LOST);
    } else {
      this.fsm.transition(KNXTunnelingEvent.STOP);
      if (this.listenerCount("error") > 0) {
        this.emit("error", err);
      }
    }
  }

  /**
   * Reconnection retry scheduler.
   */
  private scheduleReconnection() {
    const maxAttempts = this.options.maxReconnectAttempts ?? 10;
    const delay = this.options.reconnectDelay ?? 5000;

    if (this.reconnectAttempts >= maxAttempts) {
      this.fsm.transition(KNXTunnelingEvent.FAIL_FATAL);
      return;
    }

    this.reconnectAttempts++;
    this.logger.warn(`FSM Reconnection: scheduling attempt #${this.reconnectAttempts} in ${delay}ms...`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.performConnect();
      } catch {
        this.fsm.transition(KNXTunnelingEvent.RETRY);
      }
    }, delay);
  }

  // #region Message Queue & Sending
  async send(cemi: CEMIInstance | Buffer): Promise<void> {
    if (!this.isConnected) throw new Error("Not connected");

    if (this.msgQueue.length >= this.MAX_QUEUE_SIZE) {
      throw new Error("Outgoing queue full");
    }

    let cemiObj: CEMIInstance | undefined = undefined;
    if (Buffer.isBuffer(cemi)) {
      try {
        cemiObj = CEMI.fromBuffer(cemi);
      } catch {
        /* empty */
      }
    } else {
      cemiObj = cemi;
    }

    if (!this.isCacheDelegated && cemiObj) {
      try {
        GroupAddressCache.getInstance().processCEMI(cemiObj);
      } catch {
        /* empty */
      }
    }
    if (cemiObj && "destinationAddress" in cemiObj) {
      if (!this.isEventsDelegated && cemiObj.destinationAddress) {
        this.emit(cemiObj.destinationAddress, cemiObj);
      }
    }

    this.emit("send", cemi);
    const wireCemi = this.prepareOutgoingCemi(cemi);
    const cemiBuffer = Buffer.isBuffer(wireCemi) ? wireCemi : wireCemi.toBuffer();
    const isDeviceMgmt = this.options.connectionType === ConnectionType.DEVICE_MGMT_CONNECTION;
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
    // On TCP, sequence number is not evaluated by the receiver and may be set to 0 (03_08_04 §2.6.2)
    const seqByte = this._transport === "TCP" && !msg.responseType ? 0x00 : this.sequenceNumber;
    const connHeader = Buffer.from([0x04, this.channelId, seqByte, 0x00]);
    header.totalLength = 6 + connHeader.length + msg.packet.length;
    const packet = Buffer.concat([header.toBuffer(), connHeader, msg.packet]);

    // Over TCP, no TUNNELLING_ACK is sent or expected (03_08_04 §2.6.2)
    if (this._transport === "TCP") {
      this.sendRaw(packet);
      if (!msg.responseType) {
        this.isSending = false;
        this.activeRequest = null;
        this.sequenceNumber = (this.sequenceNumber + 1) & 0xff;
        msg.resolve();
        this.processQueue();
      } else {
        // Waiting for TUNNELLING_FEATURE_RESPONSE (up to 3s per 03_08_04 §3.2)
        this.pendingAck = {
          seq: this.sequenceNumber,
          timer: setTimeout(() => {
            if (!this.pendingAck) return;
            this.pendingAck = null;
            this.isSending = false;
            this.activeRequest = null;
            msg.reject(new Error("Feature response timeout"));
            this.processQueue();
          }, 3000),
          retryCount: 1,
          currentMsg: msg,
        };
      }
      return;
    }

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
      const connHeader = Buffer.from([0x04, this.channelId, this.pendingAck.seq, 0x00]);
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
      this.handleConnectionLost(new Error("Tunneling ACK Timeout"));
    }
  }
  // #endregion

  // #region Tunneling Features
  private sendFeatureRequest(
    serviceType: KNXnetIPServiceType.TUNNELLING_FEATURE_GET | KNXnetIPServiceType.TUNNELLING_FEATURE_SET,
    featureId: number,
    value?: Buffer,
  ): Promise<Buffer> {
    if (!this.isConnected) throw new Error("Not connected");
    if (this.msgQueue.length >= this.MAX_QUEUE_SIZE) {
      throw new Error("Outgoing queue full");
    }

    const header = Buffer.from([featureId & 0xff, 0x00]);
    const body = value && value.length > 0 ? Buffer.concat([header, value]) : header;

    return new Promise((resolve, reject) => {
      this.msgQueue.push({
        packet: body,
        serviceType,
        resolve,
        reject,
        responseType: KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE,
      });
      this.processQueue();
    });
  }

  /**
   * Reads a Tunnelling Interface Feature via `TUNNELLING_FEATURE_GET` (03_08_04 §3.2).
   */
  public async getFeature(featureId: number): Promise<Buffer> {
    return this.sendFeatureRequest(KNXnetIPServiceType.TUNNELLING_FEATURE_GET, featureId);
  }

  /**
   * Writes a Tunnelling Interface Feature via `TUNNELLING_FEATURE_SET` (03_08_04 §3.3).
   */
  public async setFeature(featureId: number, value: Buffer): Promise<Buffer> {
    return this.sendFeatureRequest(KNXnetIPServiceType.TUNNELLING_FEATURE_SET, featureId, value);
  }
  // #endregion

  private handleMessage(msg: Buffer) {
    this.emit("raw_message", msg);
    try {
      const header = KNXnetIPHeader.fromBuffer(msg);

      if (this.secureSession) {
        if (header.serviceType === KNXnetIPServiceType.SESSION_RESPONSE) {
          try {
            const wrappedAuth = this.secureSession.handleSessionResponse(msg);
            this.sendRawPlain(wrappedAuth);
          } catch (err: any) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.handleConnectionLost(error);
          }
          return;
        }

        if (header.serviceType === KNXnetIPServiceType.SECURE_WRAPPER) {
          let innerFrame: Buffer;
          try {
            innerFrame = this.secureSession.unwrap(msg);
          } catch (err: any) {
            // Invalid MAC, wrong sessionId, or replayed frame must be discarded without dropping the session (03_08_09 §2.2.1.3.3)
            this.logger.warn(`Discarding SECURE_WRAPPER: ${err?.message ?? err}`);
            return;
          }

          const innerHeader = KNXnetIPHeader.fromBuffer(innerFrame);
          if (innerHeader.serviceType === KNXnetIPServiceType.SESSION_STATUS) {
            const status = this.secureSession.handleSessionStatus(innerFrame);
            if (status === SecureSessionStatus.STATUS_AUTHENTICATION_SUCCESS) {
              this.emit("secure_session_established", { sessionId: this.secureSession.sessionId });
              this.startSecureKeepAlive();
              this.sendConnectRequest();
            } else if (status !== SecureSessionStatus.STATUS_KEEPALIVE) {
              const statusErr = new Error(
                `KNX Secure Session closed or rejected with status 0x${status.toString(16)} (${SecureSessionStatus[status] ?? "UNKNOWN"})`,
              );
              this.emit("secure_session_closed", status);
              this.handleConnectionLost(statusErr);
            }
            return;
          }

          if (!this.secureSession.isAuthenticated) {
            this.logger.warn(
              `Discarding inner frame 0x${innerHeader.serviceType.toString(16)} before session authentication completed`,
            );
            return;
          }

          this.processKnxNetIpFrame(innerFrame);
          return;
        }

        // Plaintext frames received while a SecureSession is configured are ignored (03_08_09 §2.4.1)
        this.logger.warn(`Ignoring plaintext KNXnet/IP frame 0x${header.serviceType.toString(16)} in secure mode`);
        return;
      }

      this.processKnxNetIpFrame(msg);
    } catch (e) {
      this.emit("error", e);
    }
  }

  private processKnxNetIpFrame(msg: Buffer) {
    const header = KNXnetIPHeader.fromBuffer(msg);
    const body = msg.subarray(6);

    switch (header.serviceType) {
      case KNXnetIPServiceType.CONNECT_RESPONSE: {
        const status = body[1];
        if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
          this.channelId = body[0];
          this.sequenceNumber = 0;
          this.rxSequenceNumber = 0;

          if (body.length >= 14) {
            const crd = CRD.fromBuffer(body.subarray(10));
            if (!this.isManualIA) this.individualAddress = KNXHelper.GetAddress(crd.knxAddress, ".");
          }
          this.fsm.transition(KNXTunnelingEvent.CONNECTED);
        } else {
          const codeName = KNXnetIPErrorCodes[status] ?? "UNKNOWN";
          this.emit("error", new Error(`Connect Error: 0x${status.toString(16)} (${codeName})`));
        }
        break;
      }
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
            if (body[1] === KNXnetIPErrorCodes.E_CONNECTION_ID) {
              this.handleConnectionLost(new Error("Connection ID no longer valid on server"));
            }
          }
        }
        break;
      case KNXnetIPServiceType.CONNECTIONSTATE_REQUEST:
        if (body[0] === this.channelId) {
          const respHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE, 0);
          const respBody = Buffer.from([this.channelId, KNXnetIPErrorCodes.E_NO_ERROR]);
          respHeader.totalLength = 6 + respBody.length;
          this.sendRaw(Buffer.concat([respHeader.toBuffer(), respBody]));
        }
        break;
      case KNXnetIPServiceType.TUNNELLING_REQUEST:
        this.handleRequest(body, KNXnetIPServiceType.TUNNELLING_ACK);
        break;
      case KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST:
        this.handleRequest(body, KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK);
        break;
      case KNXnetIPServiceType.TUNNELLING_ACK:
      case KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK:
        // Over TCP, received TUNNELLING_ACK frames shall be ignored (03_08_04 §2.6.2)
        if (this._transport === "TCP") {
          break;
        }
        if (this.pendingAck && body[2] === this.pendingAck.seq) {
          const status = body[3];
          if (status !== KNXnetIPErrorCodes.E_NO_ERROR) {
            this.logger.error(`Received ACK with error status: 0x${status.toString(16)}. Terminating.`);
            if (this.activeRequest) this.activeRequest.reject(new Error(`ACK Error: 0x${status.toString(16)}`));
            clearTimeout(this.pendingAck.timer);
            this.pendingAck = null;
            this.isSending = false;
            this.activeRequest = null;
            this.handleConnectionLost(new Error(`ACK Error: 0x${status.toString(16)}`));
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
        if (body.length >= 6 && body[0] === 0x04 && body[1] === this.channelId) {
          // 03_08_04 §3.1: Confirmed identically to TUNNELLING_REQUEST (UDP sends TUNNELLING_ACK)
          if (!this.confirmIncomingSequence(body, KNXnetIPServiceType.TUNNELLING_ACK)) {
            break;
          }
          if (this.isSending && this.activeRequest?.responseType === KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE) {
            if (this.pendingAck) {
              clearTimeout(this.pendingAck.timer);
              this.pendingAck = null;
            }
            const featureId = body[4];
            const returnCode = body[5];
            const val = body.subarray(6);

            const resolve = this.activeRequest.resolve;
            const reject = this.activeRequest.reject;

            this.isSending = false;
            this.activeRequest = null;
            this.sequenceNumber = (this.sequenceNumber + 1) & 0xff;

            if (returnCode === TunnellingFeatureReturnCode.E_NO_ERROR) {
              if (featureId === InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS && val.length === 2) {
                this.individualAddress = KNXHelper.individualAddressToString(val.readUInt16BE(0));
              }
              resolve(val);
            } else {
              const errName = TunnellingFeatureReturnCode[returnCode] ?? "UNKNOWN";
              reject(new Error(`Feature Error: 0x${returnCode.toString(16)} (${errName})`));
            }
            this.processQueue();
          }
        }
        break;
      case KNXnetIPServiceType.DISCONNECT_REQUEST: {
        // Send DISCONNECT_RESPONSE before closing
        if (body[0] === this.channelId) {
          const respHeader = new KNXnetIPHeader(KNXnetIPServiceType.DISCONNECT_RESPONSE, 8);
          const respBody = Buffer.from([this.channelId, KNXnetIPErrorCodes.E_NO_ERROR]);
          this.sendRaw(Buffer.concat([respHeader.toBuffer(), respBody]));
          this.closeSecureSessionIfOpen();
          this.fsm.transition(KNXTunnelingEvent.STOP);
        }
        break;
      }
      case KNXnetIPServiceType.DISCONNECT_RESPONSE:
        if (body[0] === this.channelId) {
          this.closeSecureSessionIfOpen();
          this.fsm.transition(KNXTunnelingEvent.STOP);
        }
        break;
      case KNXnetIPServiceType.TUNNELLING_FEATURE_INFO:
        // Body: ConnHeader(4) + FeatureID(1) + Reserved(1) + Value(n)
        if (body.length >= 6 && body[0] === 0x04 && body[1] === this.channelId) {
          // 03_08_04 §3.1: Confirmed identically to TUNNELLING_REQUEST (UDP sends TUNNELLING_ACK)
          if (!this.confirmIncomingSequence(body, KNXnetIPServiceType.TUNNELLING_ACK)) {
            break;
          }
          const featureId = body[4];
          const val = body.subarray(6);
          if (featureId === InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS && val.length === 2) {
            this.individualAddress = KNXHelper.individualAddressToString(val.readUInt16BE(0));
          }
          this.emit("feature_info", featureId, val);
        }
        break;
    }
  }

  /**
   * Validates incoming server-to-client sequence counter and sends ACK over UDP (03_08_04 §2.6, §3.1).
   * Returns `true` if the frame should be processed, `false` if duplicate or out-of-sequence.
   */
  private confirmIncomingSequence(body: Buffer, ackType: KNXnetIPServiceType): boolean {
    if (this._transport === "TCP") {
      return true;
    }

    const seq = body[2];
    if (seq === this.rxSequenceNumber) {
      this.sendAck(ackType, seq, KNXnetIPErrorCodes.E_NO_ERROR);
      this.rxSequenceNumber = (this.rxSequenceNumber + 1) & 0xff;
      return true;
    }
    if (seq === ((this.rxSequenceNumber - 1) & 0xff)) {
      this.sendAck(ackType, seq, KNXnetIPErrorCodes.E_NO_ERROR);
    }
    return false;
  }

  private handleRequest(body: Buffer, ackType: KNXnetIPServiceType) {
    if (body.length < 4) return;
    const channel = body[1];
    if (channel !== this.channelId) return;

    if (this.confirmIncomingSequence(body, ackType)) {
      this.deliverCemiFromTunnelBody(body);
    }
  }

  private deliverCemiFromTunnelBody(body: Buffer) {
    try {
      const len = body[0]; // Connection Header Length
      const data = body.subarray(len);
      const rawCemi = CEMI.fromBuffer(data);
      this.emit("raw_indication", data);
      const cemi = this.processIncomingCemi(rawCemi);
      if (!cemi) return;
      this.emit("indication", cemi);
      if (!this.isCacheDelegated && cemi) {
        try {
          GroupAddressCache.getInstance().processCEMI(cemi);
        } catch {
          /* empty */
        }
      }
      if (!this.isEventsDelegated && "destinationAddress" in cemi) {
        this.emit(cemi.destinationAddress, cemi);
      }
    } catch {
      /* empty */
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
      (this.socket as dgram.Socket).send(buffer, this.options.port, this.options.ip, (err) => {
        if (err) {
          this.emit("error", err);
        }
      });
    } else {
      const out = this.secureSession && this.secureSession.isAuthenticated ? this.secureSession.wrap(buffer) : buffer;
      (this.socket as net.Socket).write(out);
    }
  }

  private sendRawPlain(buffer: Buffer) {
    if (!this.socket || this._transport !== "TCP") return;
    (this.socket as net.Socket).write(buffer);
  }

  private startSecureKeepAlive() {
    this.stopSecureKeepAlive();
    const intervalMs = this.options.secure?.sessionKeepAliveIntervalMs ?? 30000;
    if (intervalMs <= 0) return;
    this.secureKeepAliveTimer = setInterval(() => {
      if (this.secureSession && this.secureSession.isAuthenticated) {
        try {
          this.sendRawPlain(this.secureSession.buildKeepAliveFrame());
        } catch {
          /* empty */
        }
      }
    }, intervalMs);
  }

  private stopSecureKeepAlive() {
    if (this.secureKeepAliveTimer) {
      clearInterval(this.secureKeepAliveTimer);
      this.secureKeepAliveTimer = null;
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
    const hpai = this.getControlHPAI();
    const header = new KNXnetIPHeader(KNXnetIPServiceType.CONNECTIONSTATE_REQUEST, 0);
    const body = Buffer.concat([Buffer.from([this.channelId, 0x00]), hpai.toBuffer()]);
    header.totalLength = 6 + body.length;

    this.sendRaw(Buffer.concat([header.toBuffer(), body]));

    // Check timeout in 10s (spec recommendation)
    if (this.heartbeatRetryTimer) clearTimeout(this.heartbeatRetryTimer);
    this.heartbeatRetryTimer = setTimeout(() => this.handleHeartbeatTimeout(), 10000);
  }

  private handleHeartbeatTimeout() {
    this.heartbeatFailures++;
    this.logger.warn(`Heartbeat timeout (${this.heartbeatFailures}/3)`);
    if (this.heartbeatFailures >= 3) {
      this.handleConnectionLost(new Error("Heartbeat failed 3 times"));
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
