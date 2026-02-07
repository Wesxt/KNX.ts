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

  constructor(options: KNXClientOptions) {
    super(options);
    this._transport = "UDP";
  }

  async connect(): Promise<void> {
    this.socket = dgram.createSocket("udp4");

    this.socket.on("message", (msg, rinfo) => {
      this.handleMessage(msg, rinfo);
    });

    this.socket.on("error", (err) => {
      this.emit("error", err);
    });

    return new Promise((resolve) => {
      (this.socket as dgram.Socket).bind(this.options.port, this.options.localIp, () => {
        try {
          (this.socket as dgram.Socket).setBroadcast(true);
          (this.socket as dgram.Socket).setMulticastTTL(128);
          (this.socket as dgram.Socket).addMembership(this.options.ip!, this.options.localIp!);
          (this.socket as dgram.Socket).setMulticastLoopback(true);
          this.emit("connected");
          resolve();
        } catch (err) {
          this.emit("error", err);
        }
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      (this.socket as dgram.Socket).close();
      this.socket = null;
    }
  }

  /**
   * Send a cEMI message via Routing Indication.
   * Enqueues the message to respect rate limiting.
   */
  async send(data: Buffer | ServiceMessage): Promise<void> {
    const cemiBuffer = Buffer.isBuffer(data) ? data : data.toBuffer();
    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_INDICATION, 0);
    header.totalLength = 6 + cemiBuffer.length;
    const packet = Buffer.concat([header.toBuffer(), cemiBuffer]);

    this.msgQueue.push(packet);
    this.processQueue();
  }

  /**
   * Processes the message queue with Rate Limiting (50 telegrams/s -> ~20ms gap)
   */
  private processQueue() {
    if (this.isProcessingQueue || this.isRoutingBusy || this.msgQueue.length === 0) return;

    this.isProcessingQueue = true;

    const now = Date.now();
    const timeSinceLastSend = now - this.lastSentTime;
    const waitTime = Math.max(0, 20 - timeSinceLastSend); // Ensure 20ms gap

    setTimeout(() => {
      if (this.isRoutingBusy) {
        this.isProcessingQueue = false;
        return; // Will be restarted by routing_ready event
      }

      const packet = this.msgQueue.shift();
      if (packet && this.socket) {
        (this.socket as dgram.Socket).send(packet, this.options.port!, this.options.ip!, (err) => {
          if (err) this.emit("error", err);
          this.lastSentTime = Date.now();
          this.isProcessingQueue = false;
          // Process next
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
    // Filter echo (Multicast Loopback)
    if (this.options.localIp === rinfo.address) return;

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
          const busy = RoutingBusy.fromBuffer(body);

          // Calculate N
          const now = Date.now();
          if (now - this.lastBusyTime > 10) { // 10ms window
            // Start new window or increment? 
            // Spec: "N shall be incremented by one with each ROUTING_BUSY Frame received after 10 ms have passed since the last ROUTING_BUSY"
            this.busyCounter++;
          }
          // If we want to strictly follow decrementing logic (every 5ms after N*100ms), it's complex for this scope.
          // We will reset N if it's been a while (e.g. > 1s)
          if (now - this.lastBusyTime > 1000) {
            this.busyCounter = 1;
          }
          this.lastBusyTime = now;

          if (busy.controlField === 0) {
            // Calculate random wait time
            // trandom = [0...1] * N * 50ms
            const randomFactor = Math.random();
            const tRandom = Math.floor(randomFactor * this.busyCounter * 50);
            const totalWait = busy.waitTime + tRandom;

            this.pauseSending(totalWait);
          }
          this.emit("routing_busy", busy);
          break;
        case KNXnetIPServiceType.ROUTING_LOST_MESSAGE:
          const lost = RoutingLostMessage.fromBuffer(body);
          this.emit("routing_lost_message", lost);
          break;
        case KNXnetIPServiceType.ROUTING_SYSTEM_BROADCAST:
          // Could contain system info, just emit for now
          this.emit("routing_system_broadcast", body);
          break;
      }
    } catch (e) {
      this.emit("error", e);
    }
  }

  private pauseSending(waitTime: number) {
    this.isRoutingBusy = true;
    if (this.routingBusyTimer) clearTimeout(this.routingBusyTimer);

    this.routingBusyTimer = setTimeout(() => {
      this.isRoutingBusy = false;
      this.routingBusyTimer = null;
      this.emit("routing_ready");
      this.processQueue(); // Resume
    }, waitTime);
  }
}