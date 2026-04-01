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
  KNXTimeoutConstants,
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
  StatusTunnelingSlot,
} from "../core/KNXnetIPStructures";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { KNXHelper } from "../utils/KNXHelper";
import { KNXnetIPServerOptions } from "../@types/interfaces/connection";
import { getNetworkInfo } from "../utils/localIp";
import os from "node:os";
import { DeviceDescriptorType0 } from "../core/resources/DeviceDescriptorType";
import { TunnelConnection } from "./TunnelConnection";
import { InvalidKnxAddressException } from "../errors/InvalidKnxAddresExeption";

/**
 * Implements a KNXnet/IP Server (Gateway) that supports Routing and Tunneling protocols.
 * This class handles device discovery (Search/Description), manages multiple concurrent
 * tunneling connections, and bridges communication between IP multicast (Routing) and
 * point-to-point (Tunneling) clients. It includes implementation for flow control
 * (RoutingBusy), rate limiting, and echo cancellation.
 */
export class KNXnetIPServer extends KNXService<KNXnetIPServerOptions> {
  private isRoutingBusy: boolean = false;
  private routingBusyTimer: NodeJS.Timeout | null = null;
  private msgQueue: Buffer[] = [];
  private isProcessingQueue: boolean = false;
  private lastSentTime: number = 0;

  private busyCounter: number = 0; // N for random wait time calculation
  private lastBusyTime: number = 0;
  private decrementTimer: NodeJS.Timeout | null = null;
  private decrementInterval: NodeJS.Timeout | null = null;

  // [MEJORA] Almacenamos la IA en formato entero para el filtro anti-eco rápido
  private serverIAInt: number;

  private _tunnelConnections = new Map<number, TunnelConnection>();

  private readonly MAX_QUEUE_SIZE = 100;
  private readonly BUSY_THRESHOLD = 15;
  private readonly HEARTBEAT_TIMEOUT = KNXTimeoutConstants.CONNECTION_ALIVE_TIME * 1000;
  private readonly RETRANSMIT_TIMEOUT = KNXTimeoutConstants.TUNNELING_REQUEST_TIMEOUT * 1000;
  private MAX_PENDING_REQUESTS_PER_CLIENT = 100; // [MEJORA] Límite de ráfagas

  private maxTunnelConnections: number;
  private clientAddrsStartInt: number;

  constructor(options: KNXnetIPServerOptions) {
    super(options);
    this._transport = "UDP";
    // Set defaults for discovery if not provided
    const routingOptions = this.options;
    const netInfo = getNetworkInfo();

    this.options.localIp = options.localIp || netInfo.address;
    routingOptions.individualAddress = options.individualAddress || "15.15.0";
    this.individualAddress = routingOptions.individualAddress;
    if (!KNXHelper.isValidIndividualAddress(routingOptions.individualAddress)) {
      throw new InvalidKnxAddressException(`This ${routingOptions.individualAddress} is not individual address`);
    }

    // Setup Logger
    this.logger = this.logger.child({ module: this.constructor.name });

    // Serial must be deterministic and unique per instance (MAC + Port), similar to knxd
    if (!options.serialNumber) {
      // eslint-disable-next-line no-useless-escape
      const macBuf = Buffer.from(netInfo.mac.replace(/[:\-]/g, ""), "hex");
      const port = options.port || 3671;
      const serial = Buffer.from(macBuf);
      serial[0] ^= (port >> 8) & 0xff;
      serial[1] ^= port & 0xff;
      routingOptions.serialNumber = serial;
    } else {
      routingOptions.serialNumber = options.serialNumber;
    }

    routingOptions.friendlyName = options.friendlyName || "KNX.ts";
    routingOptions.macAddress = options.macAddress || netInfo.mac;
    routingOptions.routingDelay = options.routingDelay ?? 20;
    if (routingOptions.MAX_PENDING_REQUESTS_PER_CLIENT)
      this.MAX_PENDING_REQUESTS_PER_CLIENT = routingOptions.MAX_PENDING_REQUESTS_PER_CLIENT;

    this.logger.info(`Initialized on ${this.options.localIp}:${options.port || 3671}`);
    this.logger.info(`Serial Number: ${routingOptions.serialNumber.toString("hex").toUpperCase()}`);

    const serverIA = KNXHelper.GetAddress(routingOptions.individualAddress, ".").readUInt16BE();
    this.serverIAInt = serverIA;

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
  }

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }

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
          socket.setMulticastLoopback(true);

          // [MEJORA] Multi-homing: Unirse al multicast en todas las interfaces válidas (si está habilitado)
          const interfaces = os.networkInterfaces();
          const joinedInterfaces = new Set<string>();
          const useAllInterfaces = this.options.useAllInterfaces ?? true;

          // Siempre intenta unirse primero a la localIp especificada
          if (this.options.localIp && this.options.localIp !== "0.0.0.0") {
            try {
              socket.addMembership(this.options.ip!, this.options.localIp);
              joinedInterfaces.add(this.options.localIp);
              this.logger.info(`Joined multicast on primary interface (${this.options.localIp})`);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (e) {
              this.logger.debug(`Failed to join multicast on primary interface ${this.options.localIp}`);
            }
          }

          if (useAllInterfaces) {
            // Itera sobre todas las demás interfaces de red del host
            for (const name of Object.keys(interfaces)) {
              for (const net of interfaces[name]!) {
                if (net.family === "IPv4" && !net.internal) {
                  if (!joinedInterfaces.has(net.address)) {
                    try {
                      socket.addMembership(this.options.ip!, net.address);
                      joinedInterfaces.add(net.address);
                      this.logger.info(`Joined multicast on interface ${name} (${net.address})`);
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    } catch (err) {
                      // Ignora interfaces virtuales que no soportan IGMP
                    }
                  }
                }
              }
            }
          } else {
            this.logger.info("Multi-homing disabled. Only primary interface used for multicast.");
          }

          this.emit("connected");
          resolve();
        } catch (err) {
          this.emit("error", err);
          reject(err);
        }
      });
    });

    await connectPromise;
  }

  disconnect(): void {
    if (this.socket) {
      (this.socket as dgram.Socket).close();
      this.socket = null;
    }
    this.clearTimers();
  }

  // [MEJORA] Validación estricta Route Back (NAT Traversal) según Especificación 8.6.2.2
  private resolveRouteBack(hpai: HPAI, rinfo: dgram.RemoteInfo): boolean {
    const isIpZero = hpai.ipAddress === "0.0.0.0";
    const isPortZero = hpai.port === 0;

    if (isIpZero && isPortZero) {
      // Modo "Route Back" válido
      hpai.ipAddress = rinfo.address;
      hpai.port = rinfo.port;
      return true;
    } else if (isIpZero || isPortZero) {
      // Si solo UNO de los dos es 0, es un HPAI INVÁLIDO según la spec.
      return false;
    }
    // Es un HPAI estándar, se queda tal cual
    return true;
  }

  private clearTimers() {
    if (this.routingBusyTimer) clearTimeout(this.routingBusyTimer);
    if (this.decrementTimer) clearTimeout(this.decrementTimer);
    if (this.decrementInterval) clearInterval(this.decrementInterval);
    this.routingBusyTimer = null;
    this.decrementTimer = null;
    this.decrementInterval = null;

    this._tunnelConnections.forEach((conn) => {
      conn.close();
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        /* empty */
      }
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
      this.emit(cemi.destinationAddress, cemi);
      const body = cemiBuffer;
      const srcIAStr = cemi.sourceAddress;
      let busmonBody: Buffer | null = null;
      this._tunnelConnections.forEach((conn) => {
        // Echo cancellation: Don't forward back to the client that originated this message
        if (srcIAStr === conn.knxAddressStr) {
          return;
        }

        if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER) {
          if (!busmonBody) busmonBody = this.convertDataIndToBusmonInd(body);
          conn.enqueue(busmonBody, KNXnetIPServiceType.TUNNELLING_REQUEST);
        } else {
          // Link Layer or Raw Layer
          conn.enqueue(body, KNXnetIPServiceType.TUNNELLING_REQUEST);
        }
      });
    }

    await this.enqueuePacket(cemiBuffer);
  }

  async sendRaw(cemiBuffer: Buffer): Promise<void> {
    try {
      const cemi = CEMI.fromBuffer(cemiBuffer);
      this.emit("indication", cemi);
      this.emit((cemi as any).destinationAddress, cemi);
      const body = cemiBuffer;
      const srcIAStr = (cemi as any).sourceAddress;
      let busmonBody: Buffer | null = null;
      this._tunnelConnections.forEach((conn) => {
        // Echo cancellation: Don't forward back to the client that originated this message
        if (srcIAStr === conn.knxAddressStr) {
          return;
        }

        if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER) {
          if (!busmonBody) busmonBody = this.convertDataIndToBusmonInd(body);
          conn.enqueue(busmonBody, KNXnetIPServiceType.TUNNELLING_REQUEST);
        } else {
          // Link Layer or Raw Layer
          conn.enqueue(body, KNXnetIPServiceType.TUNNELLING_REQUEST);
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      /* empty */
    }
    await this.enqueuePacket(cemiBuffer);
  }

  private async enqueuePacket(cemiBuffer: Buffer): Promise<void> {
    if (this.msgQueue.length >= this.MAX_QUEUE_SIZE) {
      this.sendLostMessage(1);
      this.emit("queue_overflow");
      return;
    }

    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_INDICATION, 0);
    header.totalLength = KNXnetIPHeader.HEADER_SIZE_10 + cemiBuffer.length;
    const packet = Buffer.concat([header.toBuffer(), cemiBuffer]);

    this.msgQueue.push(packet);

    if (this.msgQueue.length >= this.BUSY_THRESHOLD && !this.isRoutingBusy) {
      const routingOptions = this.options;
      const waitTime = (routingOptions.routingDelay ?? 20) * this.msgQueue.length;
      this.sendRoutingBusy(Math.min(100, waitTime));
    }

    this.processQueue();
  }

  private sendLostMessage(count: number): void {
    const lostMsg = new RoutingLostMessage(0, count);
    const msgBody = lostMsg.toBuffer();
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.ROUTING_LOST_MESSAGE,
      KNXnetIPHeader.HEADER_SIZE_10 + msgBody.length,
    );
    const packet = Buffer.concat([header.toBuffer(), msgBody]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(packet, this.options.port!, this.options.ip!, (err) => {
        if (err) this.emit("error", err);
      });
    }
  }

  private sendRoutingBusy(waitTime: number): void {
    const busyMsg = new RoutingBusy(0, waitTime, 0x0000);
    const msgBody = busyMsg.toBuffer();
    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_BUSY, KNXnetIPHeader.HEADER_SIZE_10 + msgBody.length);
    const packet = Buffer.concat([header.toBuffer(), msgBody]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(packet, this.options.port!, this.options.ip!, (err) => {
        if (err) this.emit("error", err);
      });
    }
  }

  private processQueue() {
    if (this.isProcessingQueue || this.isRoutingBusy || this.msgQueue.length === 0) return;

    this.isProcessingQueue = true;
    const routingOptions = this.options;
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

      // Filtro Anti-Eco inicial por IP/Puerto
      if (rinfo.address === this.options.localIp && rinfo.port === ourAddress.port) return;

      switch (header.serviceType) {
        case KNXnetIPServiceType.ROUTING_INDICATION: {
          // [MEJORA] Filtro Anti-Eco Seguro leyendo la Individual Address (IA) origen del CEMI
          const addInfoLen = body[1];
          if (body.length >= 6 + addInfoLen) {
            const srcIA = body.readUInt16BE(4 + addInfoLen);
            if (srcIA === this.serverIAInt) {
              return; // Es nuestro propio paquete Multicast reenviado por el router
            }
          }
          this.emit("raw_indication", body);
          try {
            const cemi = CEMI.fromBuffer(body);
            this.emit("indication", cemi);
            this.emit((cemi as any).destinationAddress, cemi);
            const srcIAStr = (cemi as any).sourceAddress;
            let busmonBody: Buffer | null = null;
            this._tunnelConnections.forEach((conn) => {
              // Echo cancellation: Don't forward back to the client that originated this message
              if (srcIAStr === conn.knxAddressStr) {
                return;
              }

              if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER) {
                if (!busmonBody) busmonBody = this.convertDataIndToBusmonInd(body);
                conn.enqueue(busmonBody, KNXnetIPServiceType.TUNNELLING_REQUEST);
              } else {
                // Link Layer or Raw Layer
                conn.enqueue(body, KNXnetIPServiceType.TUNNELLING_REQUEST);
              }
            });
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            /* empty */
          }
          break;
        }
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
        case KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK:
          this.handleDeviceConfigAck(msg);
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
    const status = msg.readUInt8(9);
    this.logger.debug(`Received Tunnelling ACK for channel ${channelId}, seq ${seq}, status ${status}`);
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      conn.handleAck(seq, status);
    }
  }

  private handleSearchRequest(msg: Buffer, rinfo: dgram.RemoteInfo, isExtended: boolean) {
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));

    // [MEJORA] Route Back validation
    if (!this.resolveRouteBack(clientHPAI, rinfo)) {
      return; // Silently drop invalid HPAI
    }

    const responseType = isExtended
      ? KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED
      : KNXnetIPServiceType.SEARCH_RESPONSE;

    const serverHPAI = this.getHPAI(rinfo);
    const localIp = serverHPAI.ipAddress;
    const localPort = serverHPAI.port;

    this.logger.debug(
      `Responding to search from ${clientHPAI.ipAddress}:${clientHPAI.port} with ${localIp}:${localPort}`,
    );

    const dibs = this.getIdentificationDIBs(responseType, localIp);
    const body = Buffer.concat([serverHPAI.toBuffer(), ...dibs.map((d) => d.toBuffer())]);
    const responseHeader = new KNXnetIPHeader(responseType, KNXnetIPHeader.HEADER_SIZE_10 + body.length);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        Buffer.concat([responseHeader.toBuffer(), body]),
        clientHPAI.port,
        clientHPAI.ipAddress,
      );
    }
  }

  private handleDescriptionRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));

    // [MEJORA] Route Back validation
    if (!this.resolveRouteBack(clientHPAI, rinfo)) return;

    const serverHPAI = this.getHPAI(rinfo);
    const dibs = this.getIdentificationDIBs(KNXnetIPServiceType.DESCRIPTION_RESPONSE, serverHPAI.ipAddress);
    const body = Buffer.concat(dibs.map((d) => d.toBuffer()));
    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.DESCRIPTION_RESPONSE,
      KNXnetIPHeader.HEADER_SIZE_10 + body.length,
    );

    this.logger.debug(`Responding to description request from ${clientHPAI.ipAddress}:${clientHPAI.port}`);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        Buffer.concat([responseHeader.toBuffer(), body]),
        clientHPAI.port,
        clientHPAI.ipAddress,
      );
    }
  }

  private getHPAI(rinfo?: dgram.RemoteInfo): HPAI {
    let localIp = this.options.localIp!;
    if (localIp === "0.0.0.0") {
      localIp = getNetworkInfo().address;
    }

    // [MEJORA] Multi-homed IP matching.
    // Ensure we report the local IP of the interface that can actually route back to the client.
    if (rinfo && rinfo.address) {
      const interfaces = os.networkInterfaces();
      const rinfoNum = rinfo.address.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
      for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]!) {
          if (net.family === "IPv4" && !net.internal) {
            const netNum = net.address.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
            const maskNum = net.netmask.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
            if ((rinfoNum & maskNum) === (netNum & maskNum)) {
              localIp = net.address;
            }
          }
        }
      }
    }

    return new HPAI(HostProtocolCode.IPV4_UDP, localIp, (this.socket as dgram.Socket).address().port);
  }

  private handleConnectRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(6));
    const clientDataHPAI = HPAI.fromBuffer(msg.subarray(14));

    // [MEJORA] Route Back validation estricta para el control y el data endpoint
    if (!this.resolveRouteBack(clientControlHPAI, rinfo)) {
      this.logger.warn(`Invalid Control HPAI from ${rinfo.address}. Dropping.`);
      return;
    }
    if (!this.resolveRouteBack(clientDataHPAI, rinfo)) {
      this.logger.warn(`Invalid Data HPAI from ${rinfo.address}. Dropping.`);
      return;
    }

    const cri = CRI.fromBuffer(msg.subarray(22));
    let status = KNXnetIPErrorCodes.E_NO_ERROR;
    let channelId = 0;

    const serverDataHPAI = this.getHPAI(rinfo);

    this.logger.info(
      `Connect Request from IP: ${rinfo.address}, Type: ${cri.connectionType}, IA: ${cri.individualAddress}, Layer: ${cri.knxLayer}`,
    );

    // Check if a connection from the same IP already exists with the same IA
    // If so, it might be a stale connection from a client that crashed/restarted
    let knxAddress = cri.individualAddress;
    if (knxAddress !== null && knxAddress !== 0) {
      for (const [cid, conn] of this._tunnelConnections.entries()) {
        if (conn.knxAddress === knxAddress && conn.controlHPAI.ipAddress === rinfo.address) {
          this.logger.warn(
            `IA ${knxAddress} already in use by stale connection from same IP ${rinfo.address}. Replacing channel ${cid}.`,
          );
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
      this.logger.warn("Connect Request refused: No more channels available.");
      status = KNXnetIPErrorCodes.E_NO_MORE_CONNECTIONS;
    } else if (cri.connectionType === ConnectionType.DEVICE_MGMT_CONNECTION) {
      // Management connections don't usually have a dedicated IA assigned in the CRD
      this.logger.info(`Management Connection established! Channel: ${channelId}`);
      this._tunnelConnections.set(
        channelId,
        new TunnelConnection(
          channelId,
          clientControlHPAI,
          clientDataHPAI,
          0,
          "0.0.0",
          cri.knxLayer,
          this.socket as dgram.Socket,
          this.HEARTBEAT_TIMEOUT,
          this.RETRANSMIT_TIMEOUT,
          this.MAX_PENDING_REQUESTS_PER_CLIENT,
          (cid: number, sendDisconnect: boolean) => this.closeConnection(cid, sendDisconnect),
          this.logger,
        ),
      );

      const body = Buffer.concat([
        Buffer.from([channelId, status]),
        serverDataHPAI.toBuffer(),
        Buffer.from([0x02, ConnectionType.DEVICE_MGMT_CONNECTION]),
      ]);
      const responseHeader = new KNXnetIPHeader(
        KNXnetIPServiceType.CONNECT_RESPONSE,
        KNXnetIPHeader.HEADER_SIZE_10 + body.length,
      );
      if (this.socket)
        (this.socket as dgram.Socket).send(
          Buffer.concat([responseHeader.toBuffer(), body]),
          clientControlHPAI.port,
          clientControlHPAI.ipAddress,
        );
      return;
    } else if (cri.connectionType === ConnectionType.TUNNEL_CONNECTION) {
      if (knxAddress === null || knxAddress === 0) {
        knxAddress = this.clientAddrsStartInt + channelId - 1;
      }

      if (
        cri.knxLayer !== KNXLayer.LINK_LAYER &&
        cri.knxLayer !== KNXLayer.BUSMONITOR_LAYER &&
        cri.knxLayer !== KNXLayer.RAW_LAYER
      ) {
        this.logger.warn(`Connect Request refused: Invalid layer ${cri.knxLayer}`);
        status = KNXnetIPErrorCodes.E_TUNNELLING_LAYER;
      }

      if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
        for (const [cid, conn] of this._tunnelConnections.entries()) {
          if (conn.knxAddress === knxAddress) {
            this.logger.warn(`Connect Request refused: IA ${knxAddress} already in use by channel ${cid}`);
            status = KNXnetIPErrorCodes.E_NO_MORE_UNIQUE_CONNECTIONS;
            break;
          }
        }
      }

      if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
        const addrBuf = Buffer.alloc(2);
        addrBuf.writeUInt16BE(knxAddress);
        const knxAddressStr = KNXHelper.GetAddress(addrBuf, ".") as string;

        this.logger.info(
          `Tunnel Connection established! Channel: ${channelId}, IA: ${knxAddressStr}, Layer: ${cri.knxLayer}`,
        );
        this._tunnelConnections.set(
          channelId,
          new TunnelConnection(
            channelId,
            clientControlHPAI,
            clientDataHPAI,
            knxAddress,
            knxAddressStr,
            cri.knxLayer,
            this.socket as dgram.Socket,
            this.HEARTBEAT_TIMEOUT,
            this.RETRANSMIT_TIMEOUT,
            this.MAX_PENDING_REQUESTS_PER_CLIENT,
            (cid: number, sendDisconnect: boolean) => this.closeConnection(cid, sendDisconnect),
            this.logger,
          ),
        );

        const crd = new CRD(cri.connectionType, knxAddress);
        const body = Buffer.concat([Buffer.from([channelId, status]), serverDataHPAI.toBuffer(), crd.toBuffer()]);
        const responseHeader = new KNXnetIPHeader(
          KNXnetIPServiceType.CONNECT_RESPONSE,
          KNXnetIPHeader.HEADER_SIZE_10 + body.length,
        );
        if (this.socket)
          (this.socket as dgram.Socket).send(
            Buffer.concat([responseHeader.toBuffer(), body]),
            clientControlHPAI.port,
            clientControlHPAI.ipAddress,
          );
        return;
      }
    } else {
      status = KNXnetIPErrorCodes.E_CONNECTION_TYPE;
    }

    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_RESPONSE, 8);
    if (this.socket)
      (this.socket as dgram.Socket).send(
        Buffer.concat([responseHeader.toBuffer(), Buffer.from([0, status])]),
        clientControlHPAI.port,
        clientControlHPAI.ipAddress,
      );
  }

  private resetHeartbeat(channelId: number) {
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      conn.resetHeartbeat();
    }
  }

  private closeConnection(channelId: number, sendDisconnect: boolean = false) {
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      const controlHPAI = conn.controlHPAI;
      conn.close();

      if (sendDisconnect && this.socket) {
        // Send DISCONNECT_REQUEST to client (Spec 5.4/5.5)
        const body = Buffer.concat([Buffer.from([channelId, 0x00]), this.getHPAI().toBuffer()]);
        const header = new KNXnetIPHeader(
          KNXnetIPServiceType.DISCONNECT_REQUEST,
          KNXnetIPHeader.HEADER_SIZE_10 + body.length,
        );
        (this.socket as dgram.Socket).send(
          Buffer.concat([header.toBuffer(), body]),
          controlHPAI.port,
          controlHPAI.ipAddress,
        );
      }

      this._tunnelConnections.delete(channelId);
      this.emit("disconnected", channelId);
    }
  }

  private handleConnectionStateRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));

    // [MEJORA] Route Back validation
    if (!this.resolveRouteBack(clientControlHPAI, rinfo)) return;

    let status = KNXnetIPErrorCodes.E_CONNECTION_ID;
    if (this._tunnelConnections.has(channelId)) {
      status = KNXnetIPErrorCodes.E_NO_ERROR;
      this.resetHeartbeat(channelId);
    }

    const body = Buffer.from([channelId, status]);
    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE, 6 + body.length);
    if (this.socket)
      (this.socket as dgram.Socket).send(
        Buffer.concat([responseHeader.toBuffer(), body]),
        clientControlHPAI.port,
        clientControlHPAI.ipAddress,
      );
  }

  private handleDisconnectRequest(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));

    // [MEJORA] Route Back validation
    if (!this.resolveRouteBack(clientControlHPAI, rinfo)) return;

    this.closeConnection(channelId, false);
    const body = Buffer.from([channelId, KNXnetIPErrorCodes.E_NO_ERROR]);
    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.DISCONNECT_RESPONSE,
      KNXnetIPHeader.HEADER_SIZE_10 + body.length,
    );
    if (this.socket)
      (this.socket as dgram.Socket).send(
        Buffer.concat([responseHeader.toBuffer(), body]),
        clientControlHPAI.port,
        clientControlHPAI.ipAddress,
      );
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

    // [MEJORA] Rate Limiting (Pacing) para evitar Flooding por parte del cliente
    const now = Date.now();
    if (now - conn.lastRxTime > 1000) {
      conn.rxCount = 0;
      conn.lastRxTime = now;
    }
    conn.rxCount++;
    if (this.MAX_PENDING_REQUESTS_PER_CLIENT > 0 && conn.rxCount > this.MAX_PENDING_REQUESTS_PER_CLIENT) {
      this.logger.warn(
        `Client ${rinfo.address} is flooding (${conn.rxCount} req/s). Terminating connection on channel ${channelId}.`,
      );
      this.closeConnection(channelId, true);
      return;
    }

    const { action, status } = conn.validateRequest(seq);

    if (action === "retransmit_ack") {
      this.sendTunnelACK(channelId, seq, status, rinfo);
      return;
    }

    if (action === "discard") return;

    this.sendTunnelACK(channelId, seq, status, rinfo);

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
      conn.enqueue(conCemiBuffer, KNXnetIPServiceType.TUNNELLING_REQUEST);
    }
  }

  private sendTunnelACK(channelId: number, seq: number, status: number, rinfo?: dgram.RemoteInfo) {
    const body = Buffer.from([0x04, channelId, seq, status]);
    const header = new KNXnetIPHeader(KNXnetIPServiceType.TUNNELLING_ACK, KNXnetIPHeader.HEADER_SIZE_10 + body.length);
    const conn = this._tunnelConnections.get(channelId);
    if (this.socket) {
      const port = conn ? conn.dataHPAI.port : rinfo ? rinfo.port : 0;
      const addr = conn ? conn.dataHPAI.ipAddress : rinfo ? rinfo.address : "";
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

    const { action, status } = conn.validateRequest(seq);
    this.logger.debug(`Feature Get for channel ${channelId}, feat: ${featId}, seq: ${seq}`);
    if (action === "retransmit_ack") {
      this.sendTunnelACK(channelId, seq, status);
      return;
    }
    if (action === "discard") return;

    this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);

    let featVal: Buffer;
    let retCode = 0x00;
    switch (featId) {
      case 0x07:
        featVal = Buffer.alloc(2);
        featVal.writeUInt16BE(254);
        break;
      case 0x06:
        featVal = Buffer.alloc(2);
        featVal.writeUInt16BE(conn.knxAddress);
        break;
      default:
        featVal = Buffer.alloc(0);
        retCode = 0x01;
    }
    const featBody = Buffer.concat([Buffer.from([featId, retCode]), featVal]);
    conn.enqueue(featBody, KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE);
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

    const { action, status } = conn.validateRequest(seq);
    if (action === "retransmit_ack") {
      this.sendDeviceConfigACK(channelId, seq, status);
      return;
    }
    if (action === "discard") return;

    this.sendDeviceConfigACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);

    try {
      const msgCode = cemiBuffer.readUInt8(0);
      if (msgCode === 0xfc) {
        // M_PropRead.req
        const req = CEMI.ManagementCEMI["M_PropRead.req"].fromBuffer(cemiBuffer);
        this.logger.debug(
          `Management PropRead: Obj=${req.interfaceObjectType}, Prop=${req.propertyId} on channel ${channelId}`,
        );

        let data = Buffer.alloc(0);
        const routingOptions = this.options;

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
          data,
        );

        conn.enqueue(resCemi.toBuffer(), KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST);
      }
    } catch (e: any) {
      this.logger.error(`Error processing management config request on channel ${channelId}: ${e.message}`);
    }
  }

  private handleDeviceConfigAck(msg: Buffer) {
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const status = msg.readUInt8(9);
    this.logger.debug(`Received Management ACK for channel ${channelId}, seq ${seq}, status ${status}`);
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      conn.handleAck(seq, status);
    }
  }

  private sendDeviceConfigACK(channelId: number, seq: number, status: number) {
    const body = Buffer.from([0x04, channelId, seq, status]);
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK,
      KNXnetIPHeader.HEADER_SIZE_10 + body.length,
    );
    const conn = this._tunnelConnections.get(channelId);
    if (conn && this.socket) {
      (this.socket as dgram.Socket).send(
        Buffer.concat([header.toBuffer(), body]),
        conn.dataHPAI.port,
        conn.dataHPAI.ipAddress,
      );
    }
  }

  private getIdentificationDIBs(serviceType?: KNXnetIPServiceType, requestLocalIp?: string) {
    const routingOptions = this.options;
    const netInfo = getNetworkInfo();
    const effectiveLocalIp = requestLocalIp || netInfo.address;
    let effectiveNetmask = netInfo.netmask;

    if (requestLocalIp && requestLocalIp !== netInfo.address) {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]!) {
          if (net.address === requestLocalIp) {
            effectiveNetmask = net.netmask;
          }
        }
      }
    }

    // Spec says use TP1 (0x02) for gateway reporting
    const devInfo = new DeviceInformationDIB(
      KNXMedium.KNXIP,
      0,
      KNXHelper.GetAddress(routingOptions.individualAddress as string, ".").readUint16BE(),
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

    if (serviceType === KNXnetIPServiceType.SEARCH_RESPONSE) {
      return [devInfo, suppSvc];
    }
    const deviceDescriptorType0 = DeviceDescriptorType0.KNXNET_IP_ROUTER;
    const extDevInfo = new ExtendedDeviceInformationDIB(false, 254, deviceDescriptorType0);
    const ipConfig = new IPConfigDIB(effectiveLocalIp, effectiveNetmask, "0.0.0.0", 0x01, 0x02);
    const ipCurrent = new IPCurrentConfigDIB(effectiveLocalIp, effectiveNetmask, "0.0.0.0", "0.0.0.0", 0x02);
    const slots: { address: number; status: StatusTunnelingSlot }[] = [];
    for (let i = 1; i <= this.maxTunnelConnections; i++) {
      const conn = this._tunnelConnections.get(i);
      const status = new StatusTunnelingSlot();
      status.authorised = true;
      status.usable = !!conn;
      status.free = !conn;
      slots.push({
        address: conn ? conn.knxAddress : this.clientAddrsStartInt + i - 1,
        status: status,
      });
    }

    return [devInfo, suppSvc, extDevInfo, ipConfig, ipCurrent, new TunnellingInfoDIB(254, slots)];
  }

  private handleRoutingBusy(busy: RoutingBusy) {
    const now = Date.now();
    if (now - this.lastBusyTime > 10) {
      this.busyCounter++;
      this.resetDecrementTimer();
    }
    this.lastBusyTime = now;
    if (busy.routingBusyControl === 0x0000) {
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
        else {
          if (this.decrementInterval) clearInterval(this.decrementInterval);
          this.decrementInterval = null;
        }
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
    if (msgCode !== 0x29 && msgCode !== 0x2d && msgCode !== 0x2e && msgCode !== 0x11 && msgCode !== 0x10)
      return cemiBuffer;
    const addInfoLen = cemiBuffer[1];
    const baseOffset = 2 + addInfoLen;
    const cf1 = cemiBuffer[baseOffset];
    const cf2 = cemiBuffer[baseOffset + 1];
    const src = cemiBuffer.subarray(baseOffset + 2, baseOffset + 4);
    const dst = cemiBuffer.subarray(baseOffset + 4, baseOffset + 6);
    const dataLen = cemiBuffer[baseOffset + 6];
    const tpdu = cemiBuffer.subarray(baseOffset + 7);
    const lpdu = Buffer.concat([
      Buffer.from([cf1]),
      src,
      dst,
      Buffer.from([(cf2 & 0xf0) | (dataLen + 1)]),
      tpdu,
      Buffer.alloc(1),
    ]);
    let xor = 0;
    for (let i = 0; i < lpdu.length - 1; i++) xor ^= lpdu[i];
    lpdu[lpdu.length - 1] = ~xor & 0xff;
    return new (CEMI.DataLinkLayerCEMI["L_Busmon.ind"] as any)(null, lpdu).toBuffer();
  }
}
