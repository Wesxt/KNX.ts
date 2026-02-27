import dgram from "dgram";
import { KNXService } from "./KNXService";
import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import {
  KNXnetIPServiceType,
  KNXMedium,
  HostProtocolCode,
  KNXnetIPErrorCodes,
  ConnectionType,
  AllowedSupportedServiceFamilies,
  KNXLayer,
} from "../core/enum/KNXnetIPEnum";
import { CEMI } from "../core/CEMI";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import {
  RoutingBusy,
  RoutingLostMessage,
  HPAI,
  DeviceInformationDIB,
  SupportedServicesDIB,
  ExtendedDeviceInformationDIB,
  IPConfigDIB,
  IPCurrentConfigDIB,
  TunnellingInfoDIB,
  CRI,
  CRD,
} from "../core/KNXnetIPStructures";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { KNXHelper } from "../utils/KNXHelper";
import { KNXnetIPServerOptions } from "../@types/interfaces/connection";
import { getNetworkInfo } from "../utils/localIp";
import {
  BusmonitorStatusInfo,
  TimestampRelative,
} from "../core/KNXAddInfoTypes";
import { Router } from "./Router";

/**
 * Implements a KNXnet/IP Server (Gateway) that supports Routing and Tunneling protocols.
 * This class handles device discovery (Search/Description), manages multiple concurrent
 * tunneling connections, and bridges communication between IP multicast (Routing) and
 * point-to-point (Tunneling) clients. It includes implementation for flow control
 * (RoutingBusy), rate limiting, and echo cancellation.
 */
export class KNXnetIPServer extends KNXService {
  private isRoutingBusy: boolean = false;
  private routingBusyTimer: NodeJS.Timeout | null = null;
  private msgQueue: Buffer[] = [];
  private isProcessingQueue: boolean = false;
  private lastSentTime: number = 0;

  private busyCounter: number = 0; // N for random wait time calculation
  private lastBusyTime: number = 0;
  private decrementTimer: NodeJS.Timeout | null = null;
  private decrementInterval: NodeJS.Timeout | null = null;

  private _tunnelConnections = new Map<
    number,
    {
      controlHPAI: HPAI;
      dataHPAI: HPAI;
      sno: number; // Send sequence number
      rno: number; // Receive sequence number
      heartbeatTimer: NodeJS.Timeout;
      knxAddress: number;
      knxAddressStr: string;
      knxLayer: KNXLayer;
    }
  >();

  private readonly MAX_QUEUE_SIZE = 100;
  private readonly BUSY_THRESHOLD = 15;
  private readonly HEARTBEAT_TIMEOUT = 120000; // 120 seconds
  private readonly MAX_TUNNEL_CONNECTIONS = 15; // Typically 15 slots for ETS

  private externalManager: Router | null = null;

  constructor(options: KNXnetIPServerOptions) {
    super(options);
    this._transport = "UDP";
    // Set defaults for discovery if not provided
    const routingOptions = this.options as KNXnetIPServerOptions;
    const netInfo = getNetworkInfo();

    routingOptions.individualAddress = options.individualAddress || "15.15.0";
    routingOptions.serialNumber =
      options.serialNumber || Buffer.from([0x00, 0xfa, 0x12, 0x34, 0x56, 0x78]);
    routingOptions.friendlyName = options.friendlyName || "KNX.ts Routing Node";
    routingOptions.macAddress = options.macAddress || netInfo.mac;
    routingOptions.routingDelay = options.routingDelay ?? 20;

    if (options.externals) {
      this.externalManager = new Router(options.externals);
    }
  }

  async connect(): Promise<void> {
    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this.socket.on("message", (msg, rinfo) => {
      this.handleMessage(msg, rinfo);
    });

    this.socket.on("error", (err) => {
      this.emit("error", err);
    });

    const connectPromise = new Promise<void>((resolve, reject) => {
      const socket = this.socket as dgram.Socket;
      socket.bind(this.options.port, () => {
        try {
          socket.setBroadcast(true);
          socket.setMulticastTTL(128);
          socket.addMembership(this.options.ip!, this.options.localIp!);
          socket.setMulticastLoopback(true);
          this.emit("connected");
          resolve();
        } catch (err) {
          this.emit("error", err);
          reject(err);
        }
      });
    });

    await connectPromise;

    if (this.externalManager) {
      await this.externalManager.connect();
    }
  }

  disconnect(): void {
    if (this.externalManager) {
      this.externalManager.disconnect();
    }
    if (this.socket) {
      (this.socket as dgram.Socket).close();
      this.socket = null;
    }
    this.clearTimers();
  }

  private clearTimers() {
    if (this.routingBusyTimer) clearTimeout(this.routingBusyTimer);
    if (this.decrementTimer) clearTimeout(this.decrementTimer);
    if (this.decrementInterval) clearInterval(this.decrementInterval);
    this.routingBusyTimer = null;
    this.decrementTimer = null;
    this.decrementInterval = null;

    this._tunnelConnections.forEach((conn) => {
      clearTimeout(conn.heartbeatTimer);
    });
    this._tunnelConnections.clear();
  }

  /**
   * Send a cEMI message via Routing Indication.
   * Enqueues the message to respect rate limiting and flow control.
   */
  async send(data: Buffer | ServiceMessage): Promise<void> {
    let cemiBuffer: Buffer;
    if (Buffer.isBuffer(data)) {
      cemiBuffer = data;
    } else {
      // Spec 3.9: Routing Counter (Hop Count)
      // Most DataLinkLayer messages have controlField2 which contains hopCount
      if ((data as any).controlField2) {
        const cf2 = (data as any).controlField2 as ExtendedControlField;
        const hopCount = cf2.hopCount;

        if (hopCount === 0) {
          // Drop message if hop count is 0
          return;
        }

        if (hopCount < 7) {
          // Decrement hop count if it's between 1 and 6
          cf2.hopCount = hopCount - 1;
        }
        // If hopCount is 7, it's routed without decrementing
      }
      cemiBuffer = data.toBuffer();
    }

    // Local Emit if we are sending, to allow ExternalManager to bridge without loopback reliance
    try {
      const cemi = Buffer.isBuffer(data) ? CEMI.fromBuffer(data) : data;
      this.emit("indication", cemi);
    } catch (e) {
      // Ignore parsing errors for local emit
    }

    await this.enqueuePacket(cemiBuffer);
  }

  /**
   * Send a raw cEMI message buffer via Routing Indication.
   * Useful for high performance bridging.
   */
  async sendRaw(cemiBuffer: Buffer): Promise<void> {
    await this.enqueuePacket(cemiBuffer);
  }

  /**
   * Enqueues a packet for sending, respecting queue limits and flow control.
   */
  private async enqueuePacket(cemiBuffer: Buffer): Promise<void> {
    if (this.msgQueue.length >= this.MAX_QUEUE_SIZE) {
      // Spec 3.7.3: discard the telegram to be routed last (the one just received in FIFO)
      // Spec 2.3.4: Send ROUTING_LOST_MESSAGE multicast
      this.sendLostMessage(1);
      this.emit("queue_overflow");
      return;
    }

    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.ROUTING_INDICATION,
      0,
    );
    header.totalLength = 6 + cemiBuffer.length;
    const packet = Buffer.concat([header.toBuffer(), cemiBuffer]);

    this.msgQueue.push(packet);

    // Flow control: Send ROUTING_BUSY if queue is filling up
    if (this.msgQueue.length >= this.BUSY_THRESHOLD && !this.isRoutingBusy) {
      const routingOptions = this.options as KNXnetIPServerOptions;
      const waitTime =
        (routingOptions.routingDelay ?? 20) * this.msgQueue.length;
      this.sendRoutingBusy(Math.min(100, waitTime));
    }

    this.processQueue();
  }

  /**
   * Sends a ROUTING_LOST_MESSAGE multicast notification.
   */
  private sendLostMessage(count: number): void {
    const lostMsg = new RoutingLostMessage(0, count); // Assuming device state 0 (normal)
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.ROUTING_LOST_MESSAGE,
      10,
    );
    const packet = Buffer.concat([header.toBuffer(), lostMsg.toBuffer()]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        this.options.port!,
        this.options.ip!,
        (err) => {
          if (err) this.emit("error", err);
        },
      );
    }
  }

  /**
   * Sends a ROUTING_BUSY multicast notification.
   */
  private sendRoutingBusy(waitTime: number): void {
    const busyMsg = new RoutingBusy(0, waitTime, 0x0000);
    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_BUSY, 12);
    const packet = Buffer.concat([header.toBuffer(), busyMsg.toBuffer()]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        this.options.port!,
        this.options.ip!,
        (err) => {
          if (err) this.emit("error", err);
        },
      );
    }
  }

  /**
   * Processes the message queue with Rate Limiting and Flow Control
   */
  private processQueue() {
    if (
      this.isProcessingQueue ||
      this.isRoutingBusy ||
      this.msgQueue.length === 0
    )
      return;

    this.isProcessingQueue = true;

    const routingOptions = this.options as KNXnetIPServerOptions;
    const delay = routingOptions.routingDelay ?? 20;

    const executeSend = () => {
      if (!this.socket || this.isRoutingBusy) {
        this.isProcessingQueue = false;
        return;
      }

      const packet = this.msgQueue.shift();
      if (packet) {
        // Record precise start time to handle cumulative delays
        const startTime = Date.now();

        (this.socket as dgram.Socket).send(
          packet,
          this.options.port!,
          this.options.ip!,
          (err) => {
            if (err) this.emit("error", err);

            this.lastSentTime = Date.now();
            this.isProcessingQueue = false;

            if (this.msgQueue.length > 0) {
              const elapsed = this.lastSentTime - startTime;
              const nextWait = Math.max(0, delay - elapsed);

              if (nextWait === 0) {
                // Yield to event loop but process next message as soon as possible
                setImmediate(() => this.processQueue());
              } else {
                setTimeout(() => this.processQueue(), nextWait);
              }
            }
          },
        );
      } else {
        this.isProcessingQueue = false;
      }
    };

    const now = Date.now();
    const elapsedSinceLast = now - this.lastSentTime;
    const initialWait = Math.max(0, delay - elapsedSinceLast);

    if (initialWait === 0) {
      executeSend();
    } else {
      setTimeout(executeSend, initialWait);
    }
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
    try {
      const header = KNXnetIPHeader.fromBuffer(msg);
      const body = msg.subarray(6);
      switch (header.serviceType) {
        case KNXnetIPServiceType.ROUTING_INDICATION:
          this.emit("raw_indication", body);

          // Efficiently extract srcIA for echo cancellation
          const msgCode = body[0];
          const addInfoLen = body[1];
          let srcIA = -1;
          if (msgCode === 0x29) {
            // L_Data.ind
            srcIA = body.readUInt16BE(2 + addInfoLen + 2);
          }

          // Forward to active tunneling clients
          this._tunnelConnections.forEach((conn, channelId) => {
            // Echo cancellation: Don't forward back to the client that originated this message
            if (srcIA !== -1 && srcIA === conn.knxAddress) {
              return;
            }

            if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER) {
              const busmonBody = this.convertDataIndToBusmonInd(body);
              this.sendTunnelingRequest(channelId, busmonBody, conn.dataHPAI);
            } else {
              this.sendTunnelingRequest(channelId, body, conn.dataHPAI);
            }
          });

          // Local events
          try {
            const cemi = CEMI.fromBuffer(body);
            this.emit("indication", cemi);
          } catch (e) {
            // Silently ignore parsing errors for local events
          }
          break;
        case KNXnetIPServiceType.ROUTING_BUSY:
          this.handleRoutingBusy(RoutingBusy.fromBuffer(body));
          break;
        case KNXnetIPServiceType.ROUTING_LOST_MESSAGE:
          this.emit(
            "routing_lost_message",
            RoutingLostMessage.fromBuffer(body),
          );
          break;
        case KNXnetIPServiceType.SEARCH_REQUEST:
          this.handleSearchRequest(msg, rinfo, false);
          break;
        case KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED:
          this.handleSearchRequest(msg, rinfo, true);
          break;
        case KNXnetIPServiceType.DESCRIPTION_REQUEST:
          this.handleDescriptionRequest(msg, rinfo);
          break;
        case KNXnetIPServiceType.CONNECT_REQUEST:
          this.handleConnectRequest(msg, rinfo);
          break;
        case KNXnetIPServiceType.CONNECTIONSTATE_REQUEST:
          this.handleConnectionStateRequest(msg, rinfo);
          break;
        case KNXnetIPServiceType.DISCONNECT_REQUEST:
          this.handleDisconnectRequest(msg, rinfo);
          break;
        case KNXnetIPServiceType.TUNNELLING_REQUEST:
          this.handleTunnelingRequest(msg);
          break;
        case KNXnetIPServiceType.TUNNELLING_ACK:
          this.resetHeartbeat(msg.readUInt8(7));
          break;
        case KNXnetIPServiceType.TUNNELLING_FEATURE_GET:
          this.handleTunnelingFeatureGet(msg);
          break;
        case KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST:
          this.handleDeviceConfigurationRequest(msg);
          break;
        case KNXnetIPServiceType.ROUTING_SYSTEM_BROADCAST:
          this.emit("routing_system_broadcast", body);
          break;
      }
    } catch (e) {
      this.emit("error", e);
    }
  }

  private handleSearchRequest(
    msg: Buffer,
    rinfo: dgram.RemoteInfo,
    isExtended: boolean,
  ) {
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));
    if (clientHPAI.ipAddress === "0.0.0.0")
      clientHPAI.ipAddress = rinfo.address;
    if (clientHPAI.port === 0) clientHPAI.port = rinfo.port;

    const responseType = isExtended
      ? KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED
      : KNXnetIPServiceType.SEARCH_RESPONSE;
    const responseHeader = new KNXnetIPHeader(responseType, 0);
    const serverHPAI = new HPAI(
      HostProtocolCode.IPV4_UDP,
      this.options.localIp!,
      (this.socket as dgram.Socket).address().port,
    );

    const dibs = this.getIdentificationDIBs();
    const body = Buffer.concat([
      serverHPAI.toBuffer(),
      ...dibs.map((d) => d.toBuffer()),
    ]);
    responseHeader.totalLength = 6 + body.length;

    const packet = Buffer.concat([responseHeader.toBuffer(), body]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        clientHPAI.port,
        clientHPAI.ipAddress,
      );
    }
  }

  private handleDescriptionRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));
    if (clientHPAI.ipAddress === "0.0.0.0")
      clientHPAI.ipAddress = rinfo.address;
    if (clientHPAI.port === 0) clientHPAI.port = rinfo.port;

    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.DESCRIPTION_RESPONSE,
      0,
    );
    const dibs = this.getIdentificationDIBs();
    const body = Buffer.concat(dibs.map((d) => d.toBuffer()));
    responseHeader.totalLength = 6 + body.length;

    const packet = Buffer.concat([responseHeader.toBuffer(), body]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        clientHPAI.port,
        clientHPAI.ipAddress,
      );
    }
  }

  private handleConnectRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(6));
    if (clientControlHPAI.ipAddress === "0.0.0.0")
      clientControlHPAI.ipAddress = rinfo.address;
    if (clientControlHPAI.port === 0) clientControlHPAI.port = rinfo.port;

    const clientDataHPAI = HPAI.fromBuffer(msg.subarray(14));
    if (clientDataHPAI.ipAddress === "0.0.0.0")
      clientDataHPAI.ipAddress = rinfo.address;
    if (clientDataHPAI.port === 0) clientDataHPAI.port = rinfo.port;

    const cri = CRI.fromBuffer(msg.subarray(22));

    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.CONNECT_RESPONSE,
      0,
    );

    let status = KNXnetIPErrorCodes.E_NO_ERROR;
    let channelId = 0;
    let body: Buffer;

    for (let i = 1; i <= this.MAX_TUNNEL_CONNECTIONS; i++) {
      if (!this._tunnelConnections.has(i)) {
        channelId = i;
        break;
      }
    }

    if (channelId === 0) {
      status = KNXnetIPErrorCodes.E_NO_MORE_CONNECTIONS;
      body = Buffer.from([0, status]);
    } else if (
      cri.connectionType === ConnectionType.TUNNEL_CONNECTION ||
      cri.connectionType === ConnectionType.DEVICE_MGMT_CONNECTION
    ) {
      const routingOptions = this.options as KNXnetIPServerOptions;
      const hostIA = KNXHelper.GetAddress(
        routingOptions.individualAddress as string,
        ".",
      );

      // Determine requested or automatic IA
      let knxAddress = cri.individualAddress;
      if (knxAddress === null || knxAddress === 0) {
        // Automatic assignment: Area.Line.channelId
        knxAddress = (hostIA.readUInt16BE() & 0xff00) | channelId;
      }

      // Check if requested layer is supported
      if (
        cri.knxLayer !== KNXLayer.LINK_LAYER &&
        cri.knxLayer !== KNXLayer.BUSMONITOR_LAYER &&
        cri.knxLayer !== KNXLayer.RAW_LAYER
      ) {
        status = KNXnetIPErrorCodes.E_TUNNELLING_LAYER;
      }

      // Check if address is already in use by another tunnel
      if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
        for (const conn of this._tunnelConnections.values()) {
          if (conn.knxAddress === knxAddress) {
            status = KNXnetIPErrorCodes.E_CONNECTION_IN_USE;
            break;
          }
        }
      }

      if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
        // Pre-calculate string IA for legacy/events
        const addrBuf = Buffer.alloc(2);
        addrBuf.writeUInt16BE(knxAddress);
        const knxAddressStr = KNXHelper.GetAddress(addrBuf, ".") as string;

        this._tunnelConnections.set(channelId, {
          controlHPAI: clientControlHPAI,
          dataHPAI: clientDataHPAI,
          sno: 0,
          rno: 0,
          heartbeatTimer: setTimeout(
            () => this.closeConnection(channelId),
            this.HEARTBEAT_TIMEOUT,
          ),
          knxAddress: knxAddress,
          knxAddressStr: knxAddressStr,
          knxLayer: cri.knxLayer,
        });

        const serverDataHPAI = new HPAI(
          HostProtocolCode.IPV4_UDP,
          this.options.localIp!,
          (this.socket as dgram.Socket).address().port,
        );

        const crd = new CRD(cri.connectionType, knxAddress);

        body = Buffer.concat([
          Buffer.from([channelId, status]),
          serverDataHPAI.toBuffer(),
          crd.toBuffer(),
        ]);
      } else {
        body = Buffer.from([0, status]);
      }
    } else {
      status = KNXnetIPErrorCodes.E_CONNECTION_TYPE;
      body = Buffer.from([0, status]);
    }

    responseHeader.totalLength = 6 + body.length;
    const packet = Buffer.concat([responseHeader.toBuffer(), body]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        clientControlHPAI.port,
        clientControlHPAI.ipAddress,
      );
    }
  }

  private resetHeartbeat(channelId: number) {
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      clearTimeout(conn.heartbeatTimer);
      conn.heartbeatTimer = setTimeout(
        () => this.closeConnection(channelId),
        this.HEARTBEAT_TIMEOUT,
      );
    }
  }

  private closeConnection(channelId: number) {
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      clearTimeout(conn.heartbeatTimer);
      this._tunnelConnections.delete(channelId);
    }
  }

  private handleConnectionStateRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));
    if (clientControlHPAI.ipAddress === "0.0.0.0")
      clientControlHPAI.ipAddress = rinfo.address;
    if (clientControlHPAI.port === 0) clientControlHPAI.port = rinfo.port;

    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE,
      0,
    );

    let status = KNXnetIPErrorCodes.E_CONNECTION_ID;
    if (this._tunnelConnections.has(channelId)) {
      status = KNXnetIPErrorCodes.E_NO_ERROR;
      this.resetHeartbeat(channelId);
    }

    const body = Buffer.from([channelId, status]);
    responseHeader.totalLength = 6 + body.length;
    const packet = Buffer.concat([responseHeader.toBuffer(), body]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        clientControlHPAI.port,
        clientControlHPAI.ipAddress,
      );
    }
  }

  private handleDisconnectRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));
    if (clientControlHPAI.ipAddress === "0.0.0.0")
      clientControlHPAI.ipAddress = rinfo.address;
    if (clientControlHPAI.port === 0) clientControlHPAI.port = rinfo.port;

    this.closeConnection(channelId);

    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.DISCONNECT_RESPONSE,
      0,
    );
    const body = Buffer.from([channelId, KNXnetIPErrorCodes.E_NO_ERROR]);
    responseHeader.totalLength = 6 + body.length;
    const packet = Buffer.concat([responseHeader.toBuffer(), body]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        clientControlHPAI.port,
        clientControlHPAI.ipAddress,
      );
    }
  }

  private handleTunnelingRequest(msg: Buffer) {
    const headerLen = msg.readUInt8(6);
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const cemiBuffer = msg.subarray(6 + headerLen);

    const conn = this._tunnelConnections.get(channelId);
    if (!conn) {
      this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_CONNECTION_ID);
      return;
    }

    this.resetHeartbeat(channelId);

    // Sequence number logic (Spec 3.3.4.2)
    if (seq === (conn.rno - 1 + 256) % 256) {
      this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);
      return;
    }

    if (seq !== conn.rno) {
      console.warn(
        `[KNXnetIP] Wrong sequence for channel ${channelId}: expected ${conn.rno}, got ${seq}`,
      );
      return;
    }

    // Correct sequence number
    this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);
    conn.rno = (conn.rno + 1) % 256;

    // Fast path: Efficiently bridge Tunneling Request to Routing Indication
    const msgCode = cemiBuffer[0];
    const addInfoLen = cemiBuffer[1];

    // Spec 3.2: KNXnet/IP Client shall not send L_Data.req in Busmonitor mode
    if (
      conn.knxLayer === KNXLayer.BUSMONITOR_LAYER &&
      (msgCode === 0x11 || msgCode === 0x10)
    ) {
      // Silently discard or could send an error? Spec says "shall not send", usually server ignores or drops.
      // We already sent ACK, so we just return here to not bridge to the bus.
      return;
    }

    // Spec 2.2.2: Patch source address if 0.0.0 (Only for L_Data)
    if (msgCode === 0x11) {
      // L_Data.req
      const srcIAOffset = 2 + addInfoLen + 2;
      const srcIA = cemiBuffer.readUInt16BE(srcIAOffset);
      if (srcIA === 0) {
        cemiBuffer.writeUInt16BE(conn.knxAddress, srcIAOffset);
      }
    }

    // Convert Request to Indication for Routing (Spec 03_08_05 Routing, 3.8)
    let routingCemiBuffer = cemiBuffer;
    if (msgCode === 0x11) {
      // L_Data.req -> L_Data.ind (0x11 -> 0x29)
      routingCemiBuffer = Buffer.from(cemiBuffer);
      routingCemiBuffer[0] = 0x29;
    } else if (msgCode === 0x10) {
      // L_Raw.req -> L_Raw.ind (0x10 -> 0x2D)
      routingCemiBuffer = Buffer.from(cemiBuffer);
      routingCemiBuffer[0] = 0x2d;
    }

    // Bridge to Routing (multicast)
    this.sendRaw(routingCemiBuffer);

    // Send Tunneling Confirmation (L_Data.con / L_Raw.con) back to client
    if (msgCode === 0x11 || msgCode === 0x10) {
      const conCode = msgCode + 0x1d; // 0x11 -> 0x2E, 0x10 -> 0x2F
      const conCemiBuffer = Buffer.from(cemiBuffer);
      conCemiBuffer[0] = conCode;
      // Ensure bit 0 of CF1 is 0 (No error)
      const cf1Offset = 2 + addInfoLen;
      conCemiBuffer[cf1Offset] &= 0xfe;

      this.sendTunnelingConfirmation(channelId, conCemiBuffer, conn.dataHPAI);
    }

    // Emit indication locally for events
    try {
      const cemi = CEMI.fromBuffer(cemiBuffer);
      this.emit("indication", cemi);
    } catch (e) {
      // Parsing failed, but we already bridged the raw data
    }
  }

  private sendTunnelingConfirmation(
    channelId: number,
    conCemiBuffer: Buffer,
    dataHPAI: HPAI,
  ) {
    const conn = this._tunnelConnections.get(channelId);
    if (!conn) return;

    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.TUNNELLING_REQUEST,
      0,
    );
    const tunnelHeader = Buffer.from([0x04, channelId, conn.sno, 0x00]);
    header.totalLength = 6 + tunnelHeader.length + conCemiBuffer.length;
    const packet = Buffer.concat([
      header.toBuffer(),
      tunnelHeader,
      conCemiBuffer,
    ]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        dataHPAI.port,
        dataHPAI.ipAddress,
      );
      conn.sno = (conn.sno + 1) % 256;
    }
  }

  private handleTunnelingFeatureGet(msg: Buffer) {
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const featureIdentifier = msg.readUInt8(10);

    const conn = this._tunnelConnections.get(channelId);
    if (!conn) {
      this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_CONNECTION_ID);
      return;
    }

    this.resetHeartbeat(channelId);
    this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);

    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE,
      0,
    );
    const tunnelHeader = Buffer.from([0x04, channelId, conn.sno, 0x00]);

    let featureValue: Buffer;
    let returnCode = 0x00; // E_NO_ERROR

    switch (featureIdentifier) {
      case 0x07: // Max APDU Length
        featureValue = Buffer.alloc(2);
        featureValue.writeUInt16BE(254);
        break;
      case 0x06: // Interface Individual Address
        featureValue = Buffer.alloc(2);
        featureValue.writeUInt16BE(conn.knxAddress);
        break;
      default:
        featureValue = Buffer.alloc(0);
        returnCode = 0x01; // E_DATA_VOID
    }

    const featureBody = Buffer.concat([
      Buffer.from([featureIdentifier, returnCode]),
      featureValue,
    ]);

    header.totalLength = 6 + tunnelHeader.length + featureBody.length;
    const packet = Buffer.concat([
      header.toBuffer(),
      tunnelHeader,
      featureBody,
    ]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        conn.dataHPAI.port,
        conn.dataHPAI.ipAddress,
      );
      conn.sno = (conn.sno + 1) % 256;
    }
  }

  private handleDeviceConfigurationRequest(msg: Buffer) {
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);

    const conn = this._tunnelConnections.get(channelId);
    if (!conn) {
      this.sendDeviceConfigACK(
        channelId,
        seq,
        KNXnetIPErrorCodes.E_CONNECTION_ID,
      );
      return;
    }

    this.resetHeartbeat(channelId);

    if (seq === (conn.rno - 1 + 256) % 256) {
      this.sendDeviceConfigACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);
      return;
    }

    if (seq !== conn.rno) return;

    this.sendDeviceConfigACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);
    conn.rno = (conn.rno + 1) % 256;
  }

  private sendDeviceConfigACK(channelId: number, seq: number, status: number) {
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK,
      10,
    );
    const body = Buffer.from([0x04, channelId, seq, status]);
    const packet = Buffer.concat([header.toBuffer(), body]);

    const conn = this._tunnelConnections.get(channelId);
    if (conn && this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        conn.dataHPAI.port,
        conn.dataHPAI.ipAddress,
      );
    }
  }

  private sendTunnelACK(channelId: number, seq: number, status: number) {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.TUNNELLING_ACK, 10);
    const body = Buffer.from([0x04, channelId, seq, status]);
    const packet = Buffer.concat([header.toBuffer(), body]);

    const conn = this._tunnelConnections.get(channelId);
    if (conn && this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        conn.dataHPAI.port,
        conn.dataHPAI.ipAddress,
      );
    }
  }

  private sendTunnelingRequest(
    channelId: number,
    cemiBuffer: Buffer,
    dataHPAI: HPAI,
  ) {
    const conn = this._tunnelConnections.get(channelId);
    if (!conn) return;

    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.TUNNELLING_REQUEST,
      0,
    );
    const tunnelHeader = Buffer.from([0x04, channelId, conn.sno, 0x00]);
    header.totalLength = 6 + tunnelHeader.length + cemiBuffer.length;
    const packet = Buffer.concat([header.toBuffer(), tunnelHeader, cemiBuffer]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        dataHPAI.port,
        dataHPAI.ipAddress,
      );
      conn.sno = (conn.sno + 1) % 256;
    }
  }

  private getIdentificationDIBs() {
    const routingOptions = this.options as KNXnetIPServerOptions;
    const netInfo = getNetworkInfo();

    const devInfo = new DeviceInformationDIB(
      KNXMedium.KNXIP,
      0,
      KNXHelper.GetAddress(
        routingOptions.individualAddress as string,
        ".",
      ).readUint16BE(),
      0,
      routingOptions.serialNumber!,
      this.options.ip!,
      routingOptions.macAddress!,
      routingOptions.friendlyName!,
    );

    const suppSvc = new SupportedServicesDIB([
      { family: AllowedSupportedServiceFamilies.Core, version: 1 },
      { family: AllowedSupportedServiceFamilies.DeviceManagement, version: 1 },
      { family: AllowedSupportedServiceFamilies.Tunnelling, version: 1 },
      { family: AllowedSupportedServiceFamilies.Routing, version: 1 },
    ]);

    const extDevInfo = new ExtendedDeviceInformationDIB(0, 254, 0x091a);

    const ipConfig = new IPConfigDIB(
      netInfo.address,
      netInfo.netmask,
      "0.0.0.0",
      0x01,
      0x02,
    );
    const ipCurrent = new IPCurrentConfigDIB(
      netInfo.address,
      netInfo.netmask,
      "0.0.0.0",
      "0.0.0.0",
      0x02,
    );

    const hostIA = KNXHelper.GetAddress(
      routingOptions.individualAddress as string,
      ".",
    );
    const baseIA = hostIA.readUInt16BE() & 0xff00;

    const slots = [];
    for (let i = 1; i <= this.MAX_TUNNEL_CONNECTIONS; i++) {
      const conn = this._tunnelConnections.get(i);
      // Spec: Bits 15-3 must be 1. Bit 2 (Usable), Bit 1 (Authorised), Bit 0 (Free)
      // Free slot: 0xFFFF (all bits 1)
      // Occupied slot: 0xFFFE (bit 0 is 0)
      slots.push({
        address: conn ? conn.knxAddress : baseIA | i,
        status: conn ? 0xfffe : 0xffff,
      });
    }

    const tunnelInfo = new TunnellingInfoDIB(254, slots);

    return [devInfo, suppSvc, extDevInfo, ipConfig, ipCurrent, tunnelInfo];
  }

  private handleRoutingBusy(busy: RoutingBusy) {
    const now = Date.now();
    if (now - this.lastBusyTime > 10) {
      this.busyCounter++;
      this.resetDecrementTimer();
    }
    this.lastBusyTime = now;

    if (busy.controlField === 0x0000) {
      const tw = busy.waitTime;
      const trandom = Math.floor(Math.random() * this.busyCounter * 50);
      const totalWait = tw + trandom;
      this.pauseSending(totalWait);
    }
    this.emit("routing_busy", busy);
  }

  private resetDecrementTimer() {
    if (this.decrementTimer) clearTimeout(this.decrementTimer);
    if (this.decrementInterval) clearInterval(this.decrementInterval);
    const tslowduration = this.busyCounter * 100;
    this.decrementTimer = setTimeout(() => {
      this.decrementInterval = setInterval(() => {
        if (this.busyCounter > 0) {
          this.busyCounter--;
        } else {
          if (this.decrementInterval) clearInterval(this.decrementInterval);
          this.decrementInterval = null;
        }
      }, 5);
    }, tslowduration);
  }

  private pauseSending(waitTime: number) {
    this.isRoutingBusy = true;
    if (this.routingBusyTimer) clearTimeout(this.routingBusyTimer);
    this.routingBusyTimer = setTimeout(() => {
      this.isRoutingBusy = false;
      this.routingBusyTimer = null;
      this.emit("routing_ready");
      this.processQueue();
    }, waitTime);
  }

  private convertDataIndToBusmonInd(cemiBuffer: Buffer): Buffer {
    const msgCode = cemiBuffer[0];
    if (msgCode !== 0x29 && msgCode !== 0x2d) {
      return cemiBuffer;
    }

    const addInfoLen = cemiBuffer[1];
    // Reconstruct raw LPDU from CEMI L_Data.ind
    // CEMI 0x29: [MC][AddInfoLen][AddInfo][CF1][CF2][Src][Dst][Len][TPDU]
    // Raw LPDU: [CF1][CF2][Src][Dst][NPCI(Length)][TPDU][FCS]
    // We don't have the real FCS, so we omit it or use 0.
    const lpdu = cemiBuffer.subarray(2 + addInfoLen);

    // Create L_Busmon.ind CEMI
    const busmonStatus = new BusmonitorStatusInfo();
    const timestamp = new TimestampRelative();
    timestamp.timestamp = Date.now() & 0xffff;

    const addInfo = Buffer.concat([
      busmonStatus.getBuffer(),
      timestamp.getBuffer(),
    ]);

    const header = Buffer.from([0x2b, addInfo.length]);
    return Buffer.concat([header, addInfo, lpdu]);
  }
}
