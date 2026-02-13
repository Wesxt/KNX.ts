import dgram from "dgram";
import { KNXClient, KNXClientOptions } from "./KNXClient";
import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import { KNXnetIPServiceType } from "../core/enum/KNXnetIPEnum";
import { CEMI } from "../core/CEMI";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { RoutingBusy, RoutingLostMessage } from "../core/KNXnetIPStructures";

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

  constructor(options: KNXClientOptions) {
    super(options);
    this._transport = "UDP";
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
    const cemiBuffer = Buffer.isBuffer(data) ? data : data.toBuffer();
    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_INDICATION, 0);
    header.totalLength = 6 + cemiBuffer.length;
    const packet = Buffer.concat([header.toBuffer(), cemiBuffer]);

    if (this.msgQueue.length >= this.MAX_QUEUE_SIZE) {
      // Queue overflow: discard oldest message (FIFO) or newest? 
      // Spec 3.7.3: "one telegram has to be discarded. The telegram to be routed last ... shall be cast off."
      this.msgQueue.shift();
      this.emit("queue_overflow");
    }

    this.msgQueue.push(packet);
    this.processQueue();
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
    if (this.options.localIp === rinfo.address && rinfo.port === this.options.port) return;

    try {
      const header = KNXnetIPHeader.fromBuffer(msg);
      const body = msg.subarray(6);

      switch (header.serviceType) {
        case KNXnetIPServiceType.ROUTING_INDICATION:
          try {
            const cemi = CEMI.fromBuffer(body);
            this.emit("indication", cemi);
          } catch (e) {
            // ignore invalid cemi
          }
          break;
        case KNXnetIPServiceType.ROUTING_BUSY:
          this.handleRoutingBusy(RoutingBusy.fromBuffer(body));
          break;
        case KNXnetIPServiceType.ROUTING_LOST_MESSAGE:
          this.emit("routing_lost_message", RoutingLostMessage.fromBuffer(body));
          break;
        case KNXnetIPServiceType.ROUTING_SYSTEM_BROADCAST:
          this.emit("routing_system_broadcast", body);
          break;
      }
    } catch (e) {
      this.emit("error", e);
    }
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