import dgram from "dgram";
import { KNXClient } from "./KNXClient";
import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import { KNXnetIPServiceType, KNXMedium, HostProtocolCode } from "../core/enum/KNXnetIPEnum";
import { CEMI } from "../core/CEMI";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { RoutingBusy, RoutingLostMessage, HPAI, DeviceInformationDIB, SupportedServicesDIB } from "../core/KNXnetIPStructures";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { KNXHelper } from "../utils/KNXHelper";
import { KNXRoutingOptions } from "../@types/interfaces/connection";

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

  private readonly MAX_QUEUE_SIZE = 50; // Increased for safety

  constructor(options: KNXRoutingOptions) {
    super(options);
    this._transport = "UDP";
    // Set defaults for discovery if not provided
    (this.options as KNXRoutingOptions).individualAddress = options.individualAddress || "0.0.0";
    (this.options as KNXRoutingOptions).serialNumber = options.serialNumber || Buffer.from([0, 0, 0, 0, 0, 0]);
    (this.options as KNXRoutingOptions).friendlyName = options.friendlyName || "KNX.ts Routing Node";
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

    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_INDICATION, 0);
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
    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_LOST_MESSAGE, 10);
    const packet = Buffer.concat([header.toBuffer(), lostMsg.toBuffer()]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(packet, this.options.port!, this.options.ip!, (err) => {
        if (err) this.emit("error", err);
      });
    }
  }

  /**
   * Processes the message queue with Rate Limiting and Flow Control
   */
  private processQueue() {
    if (this.isProcessingQueue || this.isRoutingBusy || this.msgQueue.length === 0) return;

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
        (this.socket as dgram.Socket).send(packet, this.options.port!, this.options.ip!, (err) => {
          if (err) this.emit("error", err);
          this.lastSentTime = Date.now();
          this.isProcessingQueue = false;
          if (this.msgQueue.length > 0) {
            this.processQueue();
          }
        });
      } else {
        this.isProcessingQueue = false;
      }
    }, waitTime);
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
    // Filter echo if configured or if coming from self
    // if (this.options.localIp === rinfo.address && rinfo.port === this.options.port) return;
    // console.log(msg);

    try {
      const header = KNXnetIPHeader.fromBuffer(msg);
      const body = msg.subarray(6);

      switch (header.serviceType) {
        case KNXnetIPServiceType.ROUTING_INDICATION:
          this.emit('raw_indication', body);
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
          this.emit("routing_lost_message", RoutingLostMessage.fromBuffer(body));
          break;
        case KNXnetIPServiceType.SEARCH_REQUEST:
          this.handleSearchRequest(msg);
          break;
        case KNXnetIPServiceType.DESCRIPTION_REQUEST:
          this.handleDescriptionRequest(msg);
          break;
        case KNXnetIPServiceType.ROUTING_SYSTEM_BROADCAST:
          this.emit("routing_system_broadcast", body);
          break;
      }
    } catch (e) {
      this.emit("error", e);
    }
  }

  private handleSearchRequest(msg: Buffer) {
    // SEARCH_REQUEST contains the HPAI of the client at offset 6
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));

    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.SEARCH_RESPONSE, 0);
    const serverHPAI = new HPAI(HostProtocolCode.IPV4_UDP, this.options.localIp!, this.options.port!); // 1 = IPV4_UDP
    const dibs = this.getIdentificationDIBs();

    const body = Buffer.concat([serverHPAI.toBuffer(), ...dibs.map(d => d.toBuffer())]);
    responseHeader.totalLength = 6 + body.length;

    const packet = Buffer.concat([responseHeader.toBuffer(), body]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(packet, clientHPAI.port, clientHPAI.ipAddress);
    }
  }

  private handleDescriptionRequest(msg: Buffer) {
    // DESCRIPTION_REQUEST contains the HPAI of the client at offset 6
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));

    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.DESCRIPTION_RESPONSE, 0);
    const dibs = this.getIdentificationDIBs();

    const body = Buffer.concat(dibs.map(d => d.toBuffer()));
    responseHeader.totalLength = 6 + body.length;

    const packet = Buffer.concat([responseHeader.toBuffer(), body]);

    if (this.socket) {
      (this.socket as dgram.Socket).send(packet, clientHPAI.port, clientHPAI.ipAddress);
    }
  }

  private getIdentificationDIBs() {
    const devInfo = new DeviceInformationDIB(
      KNXMedium.KNXIP,
      0, // Device status (0 = normal)
      KNXHelper.GetAddress((this.options as KNXRoutingOptions).individualAddress as string, ".").readUint16BE(),
      0, // Project installation ID
      (this.options as KNXRoutingOptions).serialNumber!,
      this.options.ip!, // Routing multicast address
      "00:00:00:00:00:00", // MAC Address (placeholder)
      (this.options as KNXRoutingOptions).friendlyName!
    );

    const suppSvc = new SupportedServicesDIB([
      { family: 0x02, version: 1 }, // Core
      { family: 0x05, version: 1 }  // Routing
    ]);

    return [devInfo, suppSvc];
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