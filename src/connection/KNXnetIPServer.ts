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
      pendingAcks: Map<number, { packet: Buffer; timer: NodeJS.Timeout; }>;
      queue: Buffer[]; // Queue for outgoing Indications (Indication/Confirmation)
      isSending: boolean; // Stop-and-wait state
    }
  >();

  private readonly MAX_QUEUE_SIZE = 100;
  private readonly BUSY_THRESHOLD = 15;
  private readonly HEARTBEAT_TIMEOUT = 120000; // 120 seconds
  private readonly RETRANSMIT_TIMEOUT = 1000; // 1 second

  private maxTunnelConnections: number;
  private clientAddrsStartInt: number;

  private externalManager: Router | null = null;

  constructor(options: KNXnetIPServerOptions) {
    super(options);
    this._transport = "UDP";
    // Set defaults for discovery if not provided
    const routingOptions = this.options as KNXnetIPServerOptions;
    const netInfo = getNetworkInfo();

    this.options.localIp = options.localIp || netInfo.address;
    routingOptions.individualAddress = options.individualAddress || "15.15.0";

    // Serial must be deterministic and unique per instance (MAC + Port), similar to knxd
    if (!options.serialNumber) {
      const macBuf = Buffer.from(netInfo.mac.replace(/[:\-]/g, ""), "hex");
      const port = options.port || 3671;
      const serial = Buffer.from(macBuf);
      serial[0] ^= (port >> 8) & 0xff;
      serial[1] ^= port & 0xff;
      routingOptions.serialNumber = serial;
    } else {
      routingOptions.serialNumber = options.serialNumber;
    }

    routingOptions.friendlyName = options.friendlyName || "KNX.ts Routing Node";
    routingOptions.macAddress = options.macAddress || netInfo.mac;
    routingOptions.routingDelay = options.routingDelay ?? 20;

    console.log(`[Server] Initialized on ${this.options.localIp}:${options.port || 3671}`);
    console.log(`[Server] Serial Number: ${routingOptions.serialNumber.toString("hex").toUpperCase()}`);

    const serverIA = KNXHelper.GetAddress(routingOptions.individualAddress, ".").readUInt16BE();
    if (options.clientAddrs) {
      const parts = options.clientAddrs.split(":");
      if (parts.length === 2) {
        this.clientAddrsStartInt = KNXHelper.GetAddress(parts[0], ".").readUInt16BE();
        this.maxTunnelConnections = parseInt(parts[1], 10);
      } else {
        this.maxTunnelConnections = 15;
        this.clientAddrsStartInt = serverIA + 1;
      }
    } else {
      this.maxTunnelConnections = 15;
      this.clientAddrsStartInt = serverIA + 1;
    }

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

          // Central listener for all KNX indications (from IP Multicast, TP, or Tunnels)
          this.on("indication", (cemi: any) => {
            const body = cemi.toBuffer();
            const srcIAStr = cemi.sourceAddress;

            // Optional: Re-emit by Group Address for specific listening (e.g., server.on("1/1/1", (cemi) => ...))
            // This is efficient in Node.js and makes the API more intuitive.
            if (cemi.controlField2 && cemi.controlField2.addressType === 1) {
              this.emit(cemi.destinationAddress, cemi);
            }

            this._tunnelConnections.forEach((conn, channelId) => {
              // Echo cancellation: Don't forward back to the client that originated this message
              if (srcIAStr === conn.knxAddressStr) {
                return;
              }

              if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER) {
                const busmonBody = this.convertDataIndToBusmonInd(body);
                this.sendTunnelingRequest(channelId, busmonBody, conn.dataHPAI);
              } else {
                // Link Layer or Raw Layer
                this.sendTunnelingRequest(channelId, body, conn.dataHPAI);
              }
            });
          });

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
      this.externalManager.registerLink(this);
      await this.externalManager.connect();
    }
  }

  disconnect(): void {
    if (this.externalManager) {
      this.externalManager.unregisterLink(this);
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
      conn.pendingAcks.forEach((item) => clearTimeout(item.timer));
    });
    this._tunnelConnections.clear();
    this.removeAllListeners("indication");
  }

  async send(data: Buffer | ServiceMessage): Promise<void> {
    let cemiBuffer: Buffer;
    let cemi: any;
    if (Buffer.isBuffer(data)) {
      cemiBuffer = data;
      try {
        cemi = CEMI.fromBuffer(data);
      } catch (e) { }
    } else {
      cemi = data;
      if ((data as any).controlField2) {
        const cf2 = (data as any).controlField2 as ExtendedControlField;
        const hopCount = cf2.hopCount;
        if (hopCount === 0) return;
        if (hopCount < 7) cf2.hopCount = hopCount - 1;
      }
      cemiBuffer = data.toBuffer();
    }

    if (cemi) {
      this.emit("indication", cemi);
    }

    await this.enqueuePacket(cemiBuffer);
  }

  async sendRaw(cemiBuffer: Buffer): Promise<void> {
    try {
      const cemi = CEMI.fromBuffer(cemiBuffer);
      this.emit("indication", cemi);
    } catch (e) { }
    await this.enqueuePacket(cemiBuffer);
  }

  private async enqueuePacket(cemiBuffer: Buffer): Promise<void> {
    if (this.msgQueue.length >= this.MAX_QUEUE_SIZE) {
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

    if (this.msgQueue.length >= this.BUSY_THRESHOLD && !this.isRoutingBusy) {
      const routingOptions = this.options as KNXnetIPServerOptions;
      const waitTime = (routingOptions.routingDelay ?? 20) * this.msgQueue.length;
      this.sendRoutingBusy(Math.min(100, waitTime));
    }

    this.processQueue();
  }

  private sendLostMessage(count: number): void {
    const lostMsg = new RoutingLostMessage(0, count);
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.ROUTING_LOST_MESSAGE,
      10,
    );
    const packet = Buffer.concat([header.toBuffer(), lostMsg.toBuffer()]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(packet, this.options.port!, this.options.ip!, (err) => {
        if (err) this.emit("error", err);
      });
    }
  }

  private sendRoutingBusy(waitTime: number): void {
    const busyMsg = new RoutingBusy(0, waitTime, 0x0000);
    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_BUSY, 12);
    const packet = Buffer.concat([header.toBuffer(), busyMsg.toBuffer()]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(packet, this.options.port!, this.options.ip!, (err) => {
        if (err) this.emit("error", err);
      });
    }
  }

  private processQueue() {
    if (this.isProcessingQueue || this.isRoutingBusy || this.msgQueue.length === 0) return;

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
        const startTime = Date.now();
        (this.socket as dgram.Socket).send(packet, this.options.port!, this.options.ip!, (err) => {
          if (err) this.emit("error", err);
          this.lastSentTime = Date.now();
          this.isProcessingQueue = false;
          if (this.msgQueue.length > 0) {
            const elapsed = this.lastSentTime - startTime;
            const nextWait = Math.max(0, delay - elapsed);
            if (nextWait === 0) setImmediate(() => this.processQueue());
            else setTimeout(() => this.processQueue(), nextWait);
          }
        });
      } else {
        this.isProcessingQueue = false;
      }
    };

    const now = Date.now();
    const initialWait = Math.max(0, delay - (now - this.lastSentTime));
    if (initialWait === 0) executeSend();
    else setTimeout(executeSend, initialWait);
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
    try {
      const header = KNXnetIPHeader.fromBuffer(msg);
      const body = msg.subarray(6);
      const ourAddress = (this.socket as dgram.Socket).address();
      if (rinfo.address === this.options.localIp && rinfo.port === ourAddress.port) return;
      console.log("[Service type]:", KNXnetIPServiceType[header.serviceType]);
      switch (header.serviceType) {
        case KNXnetIPServiceType.ROUTING_INDICATION:
          this.emit("raw_indication", body);
          try {
            const cemi = CEMI.fromBuffer(body);
            this.emit("indication", cemi);
          } catch (e) { }
          break;
        case KNXnetIPServiceType.ROUTING_BUSY:
          this.handleRoutingBusy(RoutingBusy.fromBuffer(body));
          break;
        case KNXnetIPServiceType.ROUTING_LOST_MESSAGE:
          this.emit("routing_lost_message", RoutingLostMessage.fromBuffer(body));
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
          this.handleTunnelingRequest(msg, rinfo);
          break;
        case KNXnetIPServiceType.TUNNELLING_ACK:
          this.handleTunnelingAck(msg);
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

  private handleTunnelingAck(msg: Buffer) {
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      this.resetHeartbeat(channelId);
      const pending = conn.pendingAcks.get(seq);
      if (pending) {
        clearTimeout(pending.timer);
        conn.pendingAcks.delete(seq);
        // Spec 5.3.4: sno is incremented after confirmation
        conn.isSending = false;
        conn.sno = (conn.sno + 1) % 256;
        this.processTunnelQueue(channelId);
      }
    }
  }

  private handleSearchRequest(msg: Buffer, rinfo: dgram.RemoteInfo, isExtended: boolean) {
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));
    if (clientHPAI.ipAddress === "0.0.0.0") clientHPAI.ipAddress = rinfo.address;
    if (clientHPAI.port === 0) clientHPAI.port = rinfo.port;

    const responseType = isExtended ? KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED : KNXnetIPServiceType.SEARCH_RESPONSE;

    // Ensure we report a reachable local IP for the control endpoint
    let localIp = this.options.localIp!;
    if (localIp === "0.0.0.0") {
      localIp = getNetworkInfo().address;
    }
    const localPort = (this.socket as dgram.Socket).address().port;

    console.log(`[Discovery] Responding to ${clientHPAI.ipAddress}:${clientHPAI.port} with Control Endpoint ${localIp}:${localPort}`);

    const serverHPAI = new HPAI(HostProtocolCode.IPV4_UDP, localIp, localPort);
    const dibs = this.getIdentificationDIBs(responseType);
    const body = Buffer.concat([serverHPAI.toBuffer(), ...dibs.map((d) => d.toBuffer())]);
    const responseHeader = new KNXnetIPHeader(responseType, 6 + body.length);

    if (this.socket) {
      (this.socket as dgram.Socket).send(Buffer.concat([responseHeader.toBuffer(), body]), clientHPAI.port, clientHPAI.ipAddress);
    }
  }

  private handleDescriptionRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));
    if (clientHPAI.ipAddress === "0.0.0.0") clientHPAI.ipAddress = rinfo.address;
    if (clientHPAI.port === 0) clientHPAI.port = rinfo.port;

    const dibs = this.getIdentificationDIBs(KNXnetIPServiceType.DESCRIPTION_RESPONSE);
    const body = Buffer.concat(dibs.map((d) => d.toBuffer()));
    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.DESCRIPTION_RESPONSE, 6 + body.length);

    console.log(`[Description] Responding to ${clientHPAI.ipAddress}:${clientHPAI.port}`);

    if (this.socket) {
      (this.socket as dgram.Socket).send(Buffer.concat([responseHeader.toBuffer(), body]), clientHPAI.port, clientHPAI.ipAddress);
    }
  }

  private getHPAI(): HPAI {
    let localIp = this.options.localIp!;
    if (localIp === "0.0.0.0") {
      localIp = getNetworkInfo().address;
    }
    return new HPAI(
      HostProtocolCode.IPV4_UDP,
      localIp,
      (this.socket as dgram.Socket).address().port,
    );
  }

  private handleConnectRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(6));
    if (clientControlHPAI.ipAddress === "0.0.0.0") clientControlHPAI.ipAddress = rinfo.address;
    if (clientControlHPAI.port === 0) clientControlHPAI.port = rinfo.port;

    const clientDataHPAI = HPAI.fromBuffer(msg.subarray(14));
    if (clientDataHPAI.ipAddress === "0.0.0.0") clientDataHPAI.ipAddress = rinfo.address;
    if (clientDataHPAI.port === 0) clientDataHPAI.port = rinfo.port;

    const cri = CRI.fromBuffer(msg.subarray(22));
    let status = KNXnetIPErrorCodes.E_NO_ERROR;
    let channelId = 0;

    console.log(`[Connect Request] IP: ${rinfo.address}, Type: ${cri.connectionType}, IA: ${cri.individualAddress}, Layer: ${cri.knxLayer}`);

    // Check if a connection from the same IP already exists with the same IA
    // If so, it might be a stale connection from a client that crashed/restarted
    let knxAddress = cri.individualAddress;
    // We'll determine the IA later if it's 0, but for now check if it's specified
    if (knxAddress !== null && knxAddress !== 0) {
      for (const [cid, conn] of this._tunnelConnections.entries()) {
        if (conn.knxAddress === knxAddress && conn.controlHPAI.ipAddress === rinfo.address) {
          console.warn(`[Connect Request] IA ${knxAddress} already in use by stale connection from same IP ${rinfo.address}. Replacing channel ${cid}.`);
          this.closeConnection(cid, true);
          break;
        }
      }
    }

    for (let i = 1; i <= this.maxTunnelConnections; i++) {
      if (!this._tunnelConnections.has(i)) {
        channelId = i;
        break;
      }
    }

    if (channelId === 0) {
      console.warn("[Connect Request] No more channels available.");
      status = KNXnetIPErrorCodes.E_NO_MORE_CONNECTIONS;
    } else if (cri.connectionType === ConnectionType.DEVICE_MGMT_CONNECTION) {
      // Management connections don't usually have a dedicated IA assigned in the CRD
      console.log(`[Connect Request] Management Success! Channel: ${channelId}`);
      this._tunnelConnections.set(channelId, {
        controlHPAI: clientControlHPAI,
        dataHPAI: clientDataHPAI,
        sno: 0,
        rno: 0,
        heartbeatTimer: setTimeout(() => this.closeConnection(channelId, true), this.HEARTBEAT_TIMEOUT),
        knxAddress: 0,
        knxAddressStr: "0.0.0",
        knxLayer: cri.knxLayer,
        pendingAcks: new Map(),
        queue: [],
        isSending: false,
      });

      const serverDataHPAI = this.getHPAI();
      // CRD for management is typically just 2 bytes (Len 2, Type 3)
      const body = Buffer.concat([
        Buffer.from([channelId, status]),
        serverDataHPAI.toBuffer(),
        Buffer.from([0x02, ConnectionType.DEVICE_MGMT_CONNECTION])
      ]);
      const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_RESPONSE, 6 + body.length);
      if (this.socket) (this.socket as dgram.Socket).send(Buffer.concat([responseHeader.toBuffer(), body]), clientControlHPAI.port, clientControlHPAI.ipAddress);
      return;
    } else if (cri.connectionType === ConnectionType.TUNNEL_CONNECTION) {
      if (knxAddress === null || knxAddress === 0) {
        knxAddress = this.clientAddrsStartInt + channelId - 1;
      }

      if (cri.knxLayer !== KNXLayer.LINK_LAYER && cri.knxLayer !== KNXLayer.BUSMONITOR_LAYER && cri.knxLayer !== KNXLayer.RAW_LAYER) {
        console.warn(`[Connect Request] Invalid layer: ${cri.knxLayer}`);
        status = KNXnetIPErrorCodes.E_TUNNELLING_LAYER;
      }

      if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
        for (const [cid, conn] of this._tunnelConnections.entries()) {
          if (conn.knxAddress === knxAddress) {
            console.warn(`[Connect Request] IA ${knxAddress} already in use by channel ${cid}`);
            status = KNXnetIPErrorCodes.E_NO_MORE_UNIQUE_CONNECTIONS;
            break;
          }
        }
      }

      if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
        const addrBuf = Buffer.alloc(2);
        addrBuf.writeUInt16BE(knxAddress);
        const knxAddressStr = KNXHelper.GetAddress(addrBuf, ".") as string;

        console.log(`[Connect Request] Tunnel Success! Channel: ${channelId}, IA: ${knxAddressStr}`);
        this._tunnelConnections.set(channelId, {
          controlHPAI: clientControlHPAI,
          dataHPAI: clientDataHPAI,
          sno: 0,
          rno: 0,
          heartbeatTimer: setTimeout(() => this.closeConnection(channelId, true), this.HEARTBEAT_TIMEOUT),
          knxAddress: knxAddress,
          knxAddressStr: knxAddressStr,
          knxLayer: cri.knxLayer,
          pendingAcks: new Map(),
          queue: [],
          isSending: false,
        });

        const serverDataHPAI = this.getHPAI();
        const crd = new CRD(cri.connectionType, knxAddress);
        const body = Buffer.concat([Buffer.from([channelId, status]), serverDataHPAI.toBuffer(), crd.toBuffer()]);
        const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_RESPONSE, 6 + body.length);
        if (this.socket) (this.socket as dgram.Socket).send(Buffer.concat([responseHeader.toBuffer(), body]), clientControlHPAI.port, clientControlHPAI.ipAddress);
        return;
      }
    } else {
      status = KNXnetIPErrorCodes.E_CONNECTION_TYPE;
    }

    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_RESPONSE, 8);
    if (this.socket) (this.socket as dgram.Socket).send(Buffer.concat([responseHeader.toBuffer(), Buffer.from([0, status])]), clientControlHPAI.port, clientControlHPAI.ipAddress);
  }

  private resetHeartbeat(channelId: number) {
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      clearTimeout(conn.heartbeatTimer);
      conn.heartbeatTimer = setTimeout(() => this.closeConnection(channelId, true), this.HEARTBEAT_TIMEOUT);
    }
  }

  private closeConnection(channelId: number, sendDisconnect: boolean = false) {
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      clearTimeout(conn.heartbeatTimer);
      conn.pendingAcks.forEach((item) => clearTimeout(item.timer));
      conn.pendingAcks.clear();

      if (sendDisconnect && this.socket) {
        // Send DISCONNECT_REQUEST to client (Spec 5.4/5.5)
        const header = new KNXnetIPHeader(KNXnetIPServiceType.DISCONNECT_REQUEST, 16);
        const body = Buffer.concat([Buffer.from([channelId, 0x00]), this.getHPAI().toBuffer()]);
        (this.socket as dgram.Socket).send(Buffer.concat([header.toBuffer(), body]), conn.controlHPAI.port, conn.controlHPAI.ipAddress);
      }

      this._tunnelConnections.delete(channelId);
      this.emit("disconnected", channelId);
    }
  }

  private handleConnectionStateRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));
    if (clientControlHPAI.ipAddress === "0.0.0.0") clientControlHPAI.ipAddress = rinfo.address;
    if (clientControlHPAI.port === 0) clientControlHPAI.port = rinfo.port;

    let status = KNXnetIPErrorCodes.E_CONNECTION_ID;
    if (this._tunnelConnections.has(channelId)) {
      status = KNXnetIPErrorCodes.E_NO_ERROR;
      this.resetHeartbeat(channelId);
    }

    const body = Buffer.from([channelId, status]);
    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE, 6 + body.length);
    if (this.socket) (this.socket as dgram.Socket).send(Buffer.concat([responseHeader.toBuffer(), body]), clientControlHPAI.port, clientControlHPAI.ipAddress);
  }

  private handleDisconnectRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));
    if (clientControlHPAI.ipAddress === "0.0.0.0") clientControlHPAI.ipAddress = rinfo.address;
    if (clientControlHPAI.port === 0) clientControlHPAI.port = rinfo.port;

    this.closeConnection(channelId, false);
    const body = Buffer.from([channelId, KNXnetIPErrorCodes.E_NO_ERROR]);
    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.DISCONNECT_RESPONSE, 6 + body.length);
    if (this.socket) (this.socket as dgram.Socket).send(Buffer.concat([responseHeader.toBuffer(), body]), clientControlHPAI.port, clientControlHPAI.ipAddress);
  }

  private handleTunnelingRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const headerLen = msg.readUInt8(6);
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const cemiBuffer = msg.subarray(6 + headerLen);

    const conn = this._tunnelConnections.get(channelId);
    if (!conn) {
      this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_CONNECTION_ID, rinfo);
      return;
    }

    this.resetHeartbeat(channelId);

    if (seq === (conn.rno - 1 + 256) % 256) {
      this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR, rinfo);
      return;
    }

    if (seq !== conn.rno) return; // Spec 2.6.1: Discard without reply

    this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR, rinfo);
    conn.rno = (conn.rno + 1) % 256;

    const msgCode = cemiBuffer[0];
    const addInfoLen = cemiBuffer[1];

    if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER && (msgCode === 0x11 || msgCode === 0x10)) return;

    if (msgCode === 0x11) {
      const srcIAOffset = 2 + addInfoLen + 2;
      if (cemiBuffer.readUInt16BE(srcIAOffset) === 0) {
        cemiBuffer.writeUInt16BE(conn.knxAddress, srcIAOffset);
      }
    }

    let routingCemiBuffer = cemiBuffer;
    if (msgCode === 0x11) {
      routingCemiBuffer = Buffer.from(cemiBuffer);
      routingCemiBuffer[0] = 0x29;
    } else if (msgCode === 0x10) {
      routingCemiBuffer = Buffer.from(cemiBuffer);
      routingCemiBuffer[0] = 0x2d;
    }

    this.sendRaw(routingCemiBuffer);

    if (msgCode === 0x11 || msgCode === 0x10) {
      const conCemiBuffer = Buffer.from(cemiBuffer);
      conCemiBuffer[0] = msgCode + 0x1d; // 0x11 -> 0x2E, 0x10 -> 0x2F
      conCemiBuffer[2 + addInfoLen] &= 0xfe;
      this.sendTunnelingRequest(channelId, conCemiBuffer, conn.dataHPAI);
    }
  }

  private sendTunnelingRequest(channelId: number, cemiBuffer: Buffer, dataHPAI: HPAI) {
    const conn = this._tunnelConnections.get(channelId);
    if (!conn) return;
    conn.queue.push(cemiBuffer);
    this.processTunnelQueue(channelId);
  }

  private processTunnelQueue(channelId: number) {
    const conn = this._tunnelConnections.get(channelId);
    if (!conn || conn.isSending || conn.queue.length === 0) return;

    conn.isSending = true;
    const cemiBuffer = conn.queue.shift()!;
    const seq = conn.sno;

    const tunnelHeader = Buffer.from([0x04, channelId, seq, 0x00]);
    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.TUNNELLING_REQUEST, 6 + tunnelHeader.length + cemiBuffer.length);
    const packet = Buffer.concat([responseHeader.toBuffer(), tunnelHeader, cemiBuffer]);

    const send = (pkt: Buffer) => {
      if (this.socket && this._tunnelConnections.has(channelId)) {
        (this.socket as dgram.Socket).send(pkt, conn.dataHPAI.port, conn.dataHPAI.ipAddress);
      }
    };

    const timer = setTimeout(() => {
      send(packet);
      const pending = conn.pendingAcks.get(seq);
      if (pending) {
        pending.timer = setTimeout(() => {
          console.warn(`[Tunneling] Retransmission failed for channel ${channelId}. Closing connection.`);
          this.closeConnection(channelId, true);
        }, this.RETRANSMIT_TIMEOUT);
      }
    }, this.RETRANSMIT_TIMEOUT);

    conn.pendingAcks.set(seq, { packet, timer });
    send(packet);
  }

  private sendTunnelACK(channelId: number, seq: number, status: number, rinfo?: dgram.RemoteInfo) {
    const body = Buffer.from([0x04, channelId, seq, status]);
    const header = new KNXnetIPHeader(KNXnetIPServiceType.TUNNELLING_ACK, 6 + body.length);
    const conn = this._tunnelConnections.get(channelId);
    if (this.socket) {
      const port = conn ? conn.dataHPAI.port : (rinfo ? rinfo.port : 0);
      const addr = conn ? conn.dataHPAI.ipAddress : (rinfo ? rinfo.address : "");
      if (port > 0 && addr !== "") {
        (this.socket as dgram.Socket).send(Buffer.concat([header.toBuffer(), body]), port, addr);
      }
    }
  }

  private handleTunnelingFeatureGet(msg: Buffer) {
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const featId = msg.readUInt8(10);
    const conn = this._tunnelConnections.get(channelId);
    if (!conn) {
      this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_CONNECTION_ID);
      return;
    }
    this.resetHeartbeat(channelId);
    this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);

    let featVal: Buffer;
    let retCode = 0x00;
    switch (featId) {
      case 0x07: featVal = Buffer.alloc(2); featVal.writeUInt16BE(254); break;
      case 0x06: featVal = Buffer.alloc(2); featVal.writeUInt16BE(conn.knxAddress); break;
      default: featVal = Buffer.alloc(0); retCode = 0x01;
    }
    const featBody = Buffer.concat([Buffer.from([featId, retCode]), featVal]);
    const tunnelHeader = Buffer.from([0x04, channelId, conn.sno, 0x00]);
    const header = new KNXnetIPHeader(KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE, 6 + tunnelHeader.length + featBody.length);
    if (this.socket) {
      (this.socket as dgram.Socket).send(Buffer.concat([header.toBuffer(), tunnelHeader, featBody]), conn.dataHPAI.port, conn.dataHPAI.ipAddress);
      conn.sno = (conn.sno + 1) % 256;
    }
  }

  private handleDeviceConfigurationRequest(msg: Buffer) {
    const headerLen = msg.readUInt8(6);
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const cemiBuffer = msg.subarray(6 + headerLen);

    const conn = this._tunnelConnections.get(channelId);
    if (!conn) {
      this.sendDeviceConfigACK(channelId, seq, KNXnetIPErrorCodes.E_CONNECTION_ID);
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

    try {
      const msgCode = cemiBuffer.readUInt8(0);
      if (msgCode === 0xFC) { // M_PropRead.req
        const req = CEMI.ManagementCEMI["M_PropRead.req"].fromBuffer(cemiBuffer);
        console.log(`[Management] PropRead Req: Obj=${req.interfaceObjectType}, Prop=${req.propertyId}`);

        let data = Buffer.alloc(0);
        const routingOptions = this.options as KNXnetIPServerOptions;

        // Respond to Individual Address (Prop 1) of Device Object (Obj 0)
        if (req.interfaceObjectType === 0 && req.propertyId === 1) {
          data = Buffer.alloc(2);
          data.writeUInt16BE(KNXHelper.GetAddress(routingOptions.individualAddress!, ".").readUInt16BE());
        }

        const resCemi = new CEMI.ManagementCEMI["M_PropRead.con"](
          req.interfaceObjectType,
          req.objectInstance,
          req.propertyId,
          req.numberOfElements,
          req.startIndex,
          data
        );

        this.sendDeviceConfigurationRequest(channelId, resCemi.toBuffer());
      }
    } catch (e) {
      console.error("[Management] Error processing configuration request:", e);
    }
  }

  private sendDeviceConfigurationRequest(channelId: number, cemiBuffer: Buffer) {
    const conn = this._tunnelConnections.get(channelId);
    if (!conn) return;

    const seq = conn.sno;
    const tunnelHeader = Buffer.from([0x04, channelId, seq, 0x00]);
    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST, 6 + tunnelHeader.length + cemiBuffer.length);
    const packet = Buffer.concat([responseHeader.toBuffer(), tunnelHeader, cemiBuffer]);

    const send = (pkt: Buffer) => {
      if (this.socket && this._tunnelConnections.has(channelId)) {
        (this.socket as dgram.Socket).send(pkt, conn.dataHPAI.port, conn.dataHPAI.ipAddress);
      }
    };

    // Note: We should handle ACKs for these too, but for now we'll just send
    send(packet);
    conn.sno = (conn.sno + 1) % 256;
  }

  private sendDeviceConfigACK(channelId: number, seq: number, status: number) {
    const body = Buffer.from([0x04, channelId, seq, status]);
    const header = new KNXnetIPHeader(KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK, 6 + body.length);
    const conn = this._tunnelConnections.get(channelId);
    if (conn && this.socket) {
      (this.socket as dgram.Socket).send(Buffer.concat([header.toBuffer(), body]), conn.dataHPAI.port, conn.dataHPAI.ipAddress);
    }
  }

  private getIdentificationDIBs(serviceType?: KNXnetIPServiceType) {
    const routingOptions = this.options as KNXnetIPServerOptions;
    const netInfo = getNetworkInfo();

    // Spec says use TP1 (0x02) for gateway reporting
    const devInfo = new DeviceInformationDIB(
      KNXMedium.KNXIP,
      0,
      KNXHelper.GetAddress(routingOptions.individualAddress as string, ".").readUint16BE(),
      0,
      routingOptions.serialNumber!,
      this.options.ip!,
      routingOptions.macAddress!,
      routingOptions.friendlyName!
    );

    const suppSvc = new SupportedServicesDIB([
      { family: AllowedSupportedServiceFamilies.Core, version: 1 },
      { family: AllowedSupportedServiceFamilies.DeviceManagement, version: 1 },
      { family: AllowedSupportedServiceFamilies.Tunnelling, version: 1 },
      { family: AllowedSupportedServiceFamilies.Routing, version: 1 },
    ]);

    if (serviceType === KNXnetIPServiceType.SEARCH_RESPONSE) {
      return [devInfo, suppSvc];
    }

    const extDevInfo = new ExtendedDeviceInformationDIB(0, 254, 0x091a);
    const ipConfig = new IPConfigDIB(netInfo.address, netInfo.netmask, "0.0.0.0", 0x01, 0x02);
    const ipCurrent = new IPCurrentConfigDIB(netInfo.address, netInfo.netmask, "0.0.0.0", "0.0.0.0", 0x02);

    const slots = [];
    for (let i = 1; i <= this.maxTunnelConnections; i++) {
      const conn = this._tunnelConnections.get(i);
      slots.push({
        address: conn ? conn.knxAddress : this.clientAddrsStartInt + i - 1,
        status: conn ? 0xfffe : 0xffff
      });
    }

    // Spec p.30/31: TunnellingInfoDIB and ExtendedDeviceInformationDIB are NOT allowed in SEARCH_RESPONSE
    // They are usually only sent in DESCRIPTION_RESPONSE or SEARCH_RESPONSE_EXTENDED
    return [devInfo, suppSvc, extDevInfo, ipConfig, ipCurrent, new TunnellingInfoDIB(254, slots)];
  }

  private handleRoutingBusy(busy: RoutingBusy) {
    const now = Date.now();
    if (now - this.lastBusyTime > 10) { this.busyCounter++; this.resetDecrementTimer(); }
    this.lastBusyTime = now;
    if (busy.controlField === 0x0000) {
      this.pauseSending(busy.waitTime + Math.floor(Math.random() * this.busyCounter * 50));
    }
    this.emit("routing_busy", busy);
  }

  private resetDecrementTimer() {
    if (this.decrementTimer) clearTimeout(this.decrementTimer);
    if (this.decrementInterval) clearInterval(this.decrementInterval);
    this.decrementTimer = setTimeout(() => {
      this.decrementInterval = setInterval(() => {
        if (this.busyCounter > 0) this.busyCounter--;
        else { if (this.decrementInterval) clearInterval(this.decrementInterval); this.decrementInterval = null; }
      }, 5);
    }, this.busyCounter * 100);
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
    if (msgCode !== 0x29 && msgCode !== 0x2d && msgCode !== 0x2e && msgCode !== 0x11 && msgCode !== 0x10) return cemiBuffer;
    const addInfoLen = cemiBuffer[1];
    const baseOffset = 2 + addInfoLen;
    const cf1 = cemiBuffer[baseOffset];
    const cf2 = cemiBuffer[baseOffset + 1];
    const src = cemiBuffer.subarray(baseOffset + 2, baseOffset + 4);
    const dst = cemiBuffer.subarray(baseOffset + 4, baseOffset + 6);
    const dataLen = cemiBuffer[baseOffset + 6];
    const tpdu = cemiBuffer.subarray(baseOffset + 7);
    const lpdu = Buffer.concat([Buffer.from([cf1]), src, dst, Buffer.from([(cf2 & 0xf0) | (dataLen + 1)]), tpdu, Buffer.alloc(1)]);
    let xor = 0;
    for (let i = 0; i < lpdu.length - 1; i++) xor ^= lpdu[i];
    lpdu[lpdu.length - 1] = ~xor & 0xff;
    return new (CEMI.DataLinkLayerCEMI["L_Busmon.ind"] as any)(null, lpdu).toBuffer();
  }
}
