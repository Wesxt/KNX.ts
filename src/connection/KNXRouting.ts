import dgram from "dgram";
import { KNXClient } from "./KNXClient";
import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import {
  KNXnetIPServiceType,
  KNXMedium,
  HostProtocolCode,
  KNXnetIPErrorCodes,
  DescriptionType,
  ConnectionType,
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
import { KNXRoutingOptions } from "../@types/interfaces/connection";
import { getNetworkInfo } from "../utils/localIp";

export class KNXRouting extends KNXClient {
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
      sequenceCounter: number;
    }
  >();

  private readonly MAX_QUEUE_SIZE = 50; // Increased for safety

  constructor(options: KNXRoutingOptions) {
    super(options);
    this._transport = "UDP";
    // Set defaults for discovery if not provided
    const routingOptions = this.options as KNXRoutingOptions;
    const netInfo = getNetworkInfo();

    routingOptions.individualAddress = options.individualAddress || "15.15.0";
    routingOptions.serialNumber =
      options.serialNumber || Buffer.from([0x00, 0xfa, 0x12, 0x34, 0x56, 0x78]);
    routingOptions.friendlyName = options.friendlyName || "KNX.ts Routing Node";
    routingOptions.macAddress = options.macAddress || netInfo.mac;
  }

  async connect(): Promise<void> {
    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this.socket.on("message", (msg, rinfo) => {
      this.handleMessage(msg, rinfo);
    });

    this.socket.on("error", (err) => {
      this.emit("error", err);
    });

    return new Promise((resolve, reject) => {
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
  }

  disconnect(): void {
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
  }

  /**
   * Send a cEMI message via Routing Indication.
   * Enqueues the message to respect rate limiting and flow control.
   */
  async send(data: Buffer | ServiceMessage): Promise<void> {
    let cemi: ServiceMessage;
    if (Buffer.isBuffer(data)) {
      try {
        cemi = CEMI.fromBuffer(data);
      } catch (e) {
        // If it's not a valid CEMI, we can't process Routing Counter, but we can still try to send it as is
        return this.enqueuePacket(data);
      }
    } else {
      cemi = data;
    }

    // Spec 3.9: Routing Counter (Hop Count)
    // Most DataLinkLayer messages have controlField2 which contains hopCount
    if ((cemi as any).controlField2) {
      const cf2 = (cemi as any).controlField2 as ExtendedControlField;
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

    await this.enqueuePacket(cemi.toBuffer());
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

    const now = Date.now();
    const timeSinceLastSend = now - this.lastSentTime;
    // Default rate limit: 20ms gap (50 telegrams/s)
    const waitTime = Math.max(0, 20 - timeSinceLastSend);

    setTimeout(() => {
      if (this.isRoutingBusy) {
        this.isProcessingQueue = false;
        return;
      }

      const packet = this.msgQueue.shift();
      if (packet && this.socket) {
        (this.socket as dgram.Socket).send(
          packet,
          this.options.port!,
          this.options.ip!,
          (err) => {
            if (err) this.emit("error", err);
            this.lastSentTime = Date.now();
            this.isProcessingQueue = false;
            if (this.msgQueue.length > 0) {
              this.processQueue();
            }
          },
        );
      } else {
        this.isProcessingQueue = false;
      }
    }, waitTime);
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
    try {
      const header = KNXnetIPHeader.fromBuffer(msg);
      const body = msg.subarray(6);
      console.log(KNXnetIPServiceType[header.serviceType], body);
      switch (header.serviceType) {
        case KNXnetIPServiceType.ROUTING_INDICATION:
          this.emit("raw_indication", body);
          // Forward to active tunneling clients
          this._tunnelConnections.forEach((conn, channelId) => {
            this.sendTunnelingRequest(channelId, body, conn.dataHPAI);
          });
          try {
            const cemi = CEMI.fromBuffer(body);
            this.emit("indication", cemi);
          } catch (e) {
            console.error(e);
            // ignore invalid cemi
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
          this.handleSearchRequest(msg, false);
          break;
        case KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED:
          this.handleSearchRequest(msg, true);
          break;
        case KNXnetIPServiceType.DESCRIPTION_REQUEST:
          this.handleDescriptionRequest(msg);
          break;
        case KNXnetIPServiceType.CONNECT_REQUEST:
          this.handleConnectRequest(msg);
          break;
        case KNXnetIPServiceType.CONNECTIONSTATE_REQUEST:
          this.handleConnectionStateRequest(msg);
          break;
        case KNXnetIPServiceType.DISCONNECT_REQUEST:
          this.handleDisconnectRequest(msg);
          break;
        case KNXnetIPServiceType.TUNNELLING_REQUEST:
          this.handleTunnelingRequest(msg);
          break;
        case KNXnetIPServiceType.ROUTING_SYSTEM_BROADCAST:
          this.emit("routing_system_broadcast", body);
          break;
      }
    } catch (e) {
      this.emit("error", e);
    }
  }

  private handleSearchRequest(msg: Buffer, isExtended: boolean) {
    // SEARCH_REQUEST contains the HPAI of the client at offset 6
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));

    const responseType = isExtended
      ? KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED
      : KNXnetIPServiceType.SEARCH_RESPONSE;
    const responseHeader = new KNXnetIPHeader(responseType, 0);
    const serverHPAI = new HPAI(
      HostProtocolCode.IPV4_UDP,
      this.options.localIp!,
      this.options.port!,
    );

    let dibs = this.getIdentificationDIBs();
    if (!isExtended) {
      // Spec 3.8.2 Table 4 & 5: Tunnelling Info and Extended Device Info not allowed in SEARCH_RESPONSE
      dibs = dibs.filter(
        (d) =>
          d.type !== DescriptionType.TUNNELLING_INFO &&
          d.type !== DescriptionType.DEVICE_INFO_EXTENDED &&
          d.type !== DescriptionType.IP_CONFIG &&
          d.type !== DescriptionType.IP_CUR_CONFIG,
      );
    }

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

  private handleDescriptionRequest(msg: Buffer) {
    // DESCRIPTION_REQUEST contains the HPAI of the client at offset 6
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));

    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.DESCRIPTION_RESPONSE,
      0,
    );
    let dibs = this.getIdentificationDIBs();
    // Spec 3.8.2 Table 4 & 5: Tunnelling Info and Extended Device Info not allowed in DESCRIPTION_RESPONSE
    dibs = dibs.filter(
      (d) =>
        d.type !== DescriptionType.TUNNELLING_INFO &&
        d.type !== DescriptionType.DEVICE_INFO_EXTENDED,
    );

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

  private handleConnectRequest(msg: Buffer) {
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(6));
    const clientDataHPAI = HPAI.fromBuffer(msg.subarray(14));
    const cri = CRI.fromBuffer(msg.subarray(22));

    console.log("CONNECT_REQUEST", {
      clientControlHPAI,
      clientDataHPAI,
      connectionType: cri.connectionType,
    });

    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.CONNECT_RESPONSE,
      0,
    );

    let status = KNXnetIPErrorCodes.E_NO_ERROR;
    let channelId = 0;
    let body: Buffer;

    if (cri.connectionType === ConnectionType.TUNNEL_CONNECTION) {
      channelId = 1; // Support one active connection for now
      this._tunnelConnections.set(channelId, {
        controlHPAI: clientControlHPAI,
        dataHPAI: clientDataHPAI,
        sequenceCounter: 0,
      });

      const serverDataHPAI = new HPAI(
        HostProtocolCode.IPV4_UDP,
        this.options.localIp!,
        (this.socket as dgram.Socket).address().port,
      );

      const routingOptions = this.options as KNXRoutingOptions;
      const crd = new CRD(
        ConnectionType.TUNNEL_CONNECTION,
        KNXHelper.GetAddress(
          routingOptions.individualAddress as string,
          ".",
        ).readUint16BE(),
      );

      body = Buffer.concat([
        Buffer.from([channelId, status]),
        serverDataHPAI.toBuffer(),
        crd.toBuffer(),
      ]);
    } else if (cri.connectionType === ConnectionType.DEVICE_MGMT_CONNECTION) {
      channelId = 2; // Support a management channel
      this._tunnelConnections.set(channelId, {
        controlHPAI: clientControlHPAI,
        dataHPAI: clientDataHPAI,
        sequenceCounter: 0,
      });

      const serverDataHPAI = new HPAI(
        HostProtocolCode.IPV4_UDP,
        this.options.localIp!,
        (this.socket as dgram.Socket).address().port,
      );

      const crd = new CRD(ConnectionType.DEVICE_MGMT_CONNECTION);

      body = Buffer.concat([
        Buffer.from([channelId, status]),
        serverDataHPAI.toBuffer(),
        crd.toBuffer(),
      ]);
    } else {
      status = KNXnetIPErrorCodes.E_CONNECTION_TYPE;
      body = Buffer.from([0, status]);
    }

    responseHeader.totalLength = 6 + body.length;
    const packet = Buffer.concat([responseHeader.toBuffer(), body]);

    console.log("Sending CONNECT_RESPONSE", { channelId, status });

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        clientControlHPAI.port,
        clientControlHPAI.ipAddress,
      );
    }
  }

  private handleConnectionStateRequest(msg: Buffer) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));

    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE,
      0,
    );
    const status = this._tunnelConnections.has(channelId)
      ? KNXnetIPErrorCodes.E_NO_ERROR
      : KNXnetIPErrorCodes.E_CONNECTION_ID;

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

  private handleDisconnectRequest(msg: Buffer) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));

    this._tunnelConnections.delete(channelId);

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
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const cemiBuffer = msg.subarray(10);

    const conn = this._tunnelConnections.get(channelId);
    if (!conn) {
      this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_CONNECTION_ID);
      return;
    }

    // Send ACK immediately
    this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);

    try {
      const cemi = CEMI.fromBuffer(cemiBuffer);
      // Bridge to the KNX bus (multicast group)
      this.send(cemi);
    } catch (e) {
      console.error("Failed to parse CEMI from tunneling request", e);
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
    const tunnelHeader = Buffer.from([
      0x04,
      channelId,
      conn.sequenceCounter,
      0x00,
    ]);
    header.totalLength = 6 + tunnelHeader.length + cemiBuffer.length;
    const packet = Buffer.concat([header.toBuffer(), tunnelHeader, cemiBuffer]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        packet,
        dataHPAI.port,
        dataHPAI.ipAddress,
      );
      conn.sequenceCounter = (conn.sequenceCounter + 1) % 256;
    }
  }

  private getIdentificationDIBs() {
    const routingOptions = this.options as KNXRoutingOptions;
    const netInfo = getNetworkInfo();

    const devInfo = new DeviceInformationDIB(
      KNXMedium.KNXIP,
      0, // Device status (0 = normal)
      KNXHelper.GetAddress(
        routingOptions.individualAddress as string,
        ".",
      ).readUint16BE(),
      0, // Project installation ID
      routingOptions.serialNumber!,
      this.options.ip!, // Routing multicast address
      routingOptions.macAddress!,
      routingOptions.friendlyName!,
    );

    const suppSvc = new SupportedServicesDIB([
      { family: 0x02, version: 1 }, // Core v1
      { family: 0x03, version: 1 }, // Device Management
      { family: 0x04, version: 1 }, // Tunnelling
      { family: 0x05, version: 1 }, // Routing
    ]);

    const extDevInfo = new ExtendedDeviceInformationDIB(
      0, // Medium status (0 = normal)
      254, // Max APDU length (more conservative)
      0x091a, // Device Descriptor Type 0 (Common for IP Routers)
    );

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
    const tunnelInfo = new TunnellingInfoDIB(254, [
      { address: 0x0000, status: 0xffff },
    ]);

    return [devInfo, suppSvc, extDevInfo, ipConfig, ipCurrent, tunnelInfo];
  }

  private handleRoutingBusy(busy: RoutingBusy) {
    const now = Date.now();

    // N (busyCounter) increment logic: increment if > 10ms since last BUSY
    if (now - this.lastBusyTime > 10) {
      this.busyCounter++;
      this.resetDecrementTimer();
    }
    this.lastBusyTime = now;

    if (busy.controlField === 0x0000) {
      // General flow control logic as per Spec 2.3.5
      // total_time = tw + trandom
      // trandom = [0...1] * N * 50ms
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

    // tslowduration = N * 100 ms
    const tslowduration = this.busyCounter * 100;

    this.decrementTimer = setTimeout(() => {
      // decrement by one every tbd = 5 ms after tslowduration has elapsed
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
}
