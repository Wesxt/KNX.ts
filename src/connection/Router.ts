import { EventEmitter } from "events";
import { KNXService } from "./KNXService";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { TPUARTConnection } from "./TPUART";
import { KNXTunneling } from "./KNXTunneling";
import { ExternalManagerOptions } from "../@types/interfaces/connection";

import { Logger } from "pino";
import { createKNXLogger } from "../utils/Logger";

/**
 * Router: A high-performance, robust Learning Bridge.
 * Architecture strictly follows knxd/src/libserver/router.cpp patterns:
 * 1. Loop Prevention via signature tracking AND Repeat Flag analysis.
 * 2. IA Learning & Selective Routing.
 * 3. Source Address Patching & Sanitization.
 * 4. Client Address Pool Management (KNXnet/IP Tunneling).
 */
export class Router extends EventEmitter {
  private links: Set<KNXService> = new Set();
  private addressTable: Map<string, KNXService> = new Map();

  // knxd 'ignore' list: prevents infinite loops across different physical paths
  // Only ignores frames if they are marked as repeated in the KNX Control Field.
  private recentSignatures: Map<string, number> = new Map();
  private readonly MAX_SIGNATURES_SIZE = 10000;

  private routerAddress: string = "15.15.0"; // Default, should be configurable

  // Dynamic address pool for clients (like KNXnet/IP Tunneling)
  private clientAddrsStart: string | null = null;
  private clientAddrsCount: number = 0;
  private clientAddrsUsed: boolean[] = [];

  private logger: Logger;

  constructor(
    options: ExternalManagerOptions & {
      routerAddress?: string;
      clientAddrs?: string;
    },
  ) {
    super();
    this.logger = createKNXLogger(options.logOptions).child({ module: "Router" });

    if (options.routerAddress) this.routerAddress = options.routerAddress;

    // Parse client addrs e.g. "15.15.10:10"
    if (options.clientAddrs) {
      const parts = options.clientAddrs.split(":");
      if (parts.length === 2) {
        this.clientAddrsStart = parts[0];
        this.clientAddrsCount = parseInt(parts[1], 10);
        this.clientAddrsUsed = new Array(this.clientAddrsCount).fill(false);
      }
    }

    if (options.tpuart) this.registerLink(new TPUARTConnection(options.tpuart));
    if (options.tunneling)
      options.tunneling.forEach((c) => this.registerLink(new KNXTunneling(c)));

    this.logger.info(`Router initialized at ${this.routerAddress}`);

    // Periodically clean the signature cache (knxd pattern)
    setInterval(() => this.gcSignatures(), 1000);
  }

  /**
   * Allocates a free physical address for a tunneling client.
   */
  public getClientAddress(): string | null {
    if (!this.clientAddrsStart || this.clientAddrsCount === 0) return null;

    const startInt = this.addrToInt(this.clientAddrsStart);

    for (let i = 0; i < this.clientAddrsCount; i++) {
      if (!this.clientAddrsUsed[i]) {
        this.clientAddrsUsed[i] = true;
        return this.intToAddr(startInt + i);
      }
    }
    return null; // Pool exhausted
  }

  /**
   * Releases an allocated physical address when a client disconnects.
   */
  public releaseClientAddress(addr: string) {
    if (!this.clientAddrsStart || this.clientAddrsCount === 0) return;

    const startInt = this.addrToInt(this.clientAddrsStart);
    const addrInt = this.addrToInt(addr);

    const index = addrInt - startInt;
    if (index >= 0 && index < this.clientAddrsCount) {
      this.clientAddrsUsed[index] = false;
    }
  }

  private addrToInt(addr: string): number {
    const [a, b, c] = addr.split(".").map(Number);
    return ((a & 0x0f) << 12) | ((b & 0x0f) << 8) | (c & 0xff);
  }

  private intToAddr(val: number): string {
    return `${(val >> 12) & 0x0f}.${(val >> 8) & 0x0f}.${val & 0xff}`;
  }

  public registerLink(link: KNXService) {
    if (this.links.has(link)) return;
    this.links.add(link);
    this.logger.info(`Link registered: ${link.constructor.name}`);

    link.on("indication", (cemi: ServiceMessage) => {
      this.processIncoming(cemi, link);
    });

    link.on("error", (err) => {
      this.logger.error({ link: link.constructor.name, err: err.message }, "Link error");
      this.emit("error", { link, error: err });
    });

    // knxd pattern: cleanup when link goes down
    link.on("disconnected", () => {
      this.logger.info(`Link disconnected: ${link.constructor.name}`);
      this.unregisterLink(link);
    });
  }

  public unregisterLink(link: KNXService) {
    if (!this.links.has(link)) return;

    // Cleanup routing table
    for (const [addr, l] of this.addressTable.entries()) {
      if (l === link) {
        this.addressTable.delete(addr);
        // If it was a dynamic client address, release it
        this.releaseClientAddress(addr);
      }
    }
    this.links.delete(link);
  }

  /**
   * Main entry point for any packet received from any link.
   * Based on knxd's Router::recv_L_Data and Router::trigger_cb logic.
   */
  private processIncoming(cemi: ServiceMessage, source: KNXService) {
    const cemiAny = cemi as any;
    let src = cemiAny.sourceAddress;

    // 1. Source Validation (knxd pattern):
    // If we know this IA is on another link, discard to prevent loops/spoofing.
    if (src && src !== "0.0.0") {
      if (src === this.routerAddress) {
        // We shouldn't receive a packet claiming to be us from the outside.
        return;
      }
      const existingLink = this.addressTable.get(src);
      if (existingLink && existingLink !== source) {
        return; // Ignore packet from "wrong" interface
      }
    }

    // 2. Source Patching (Standard KNX Requirement)
    // If src is 0.0.0, it must be replaced by the router's/client's address
    if (!src || src === "0.0.0") {
      cemiAny.sourceAddress =
        "individualAddress" in source.options &&
        source.options.individualAddress
          ? source.options.individualAddress
          : this.routerAddress;
      src = cemiAny.sourceAddress;
    }

    // 3. IA Learning
    this.learnAddress(src, source);

    // 4. Loop Prevention (knxd strict pattern)
    const buf = cemi.toBuffer();
    // In CEMI, Ctrl1 is at offset `2 + AddIL`
    const addIL = buf[1];
    const ctrl1 = buf[2 + addIL];

    // KNX Standard: Repeat bit is bit 5 (0x20). Active LOW (0 = repeated frame).
    const isRepeated = (ctrl1 & 0x20) === 0;
    const signature = this.getSignature(buf, addIL);

    if (isRepeated) {
      if (this.recentSignatures.has(signature)) {
        this.logger.debug({ signature, src }, "Loop prevented: duplicated repeated frame dropped");
        return; // Drop repeated packet we've recently seen on the bus
      }
    }

    // Always record the signature. If a loop occurs, the echoed packet will have
    // the repeat flag set to 0 (since it failed to ACK or was physically echoed),
    // and we will drop it next time.
    if (this.recentSignatures.size >= this.MAX_SIGNATURES_SIZE) {
      const firstKey = this.recentSignatures.keys().next().value;
      if (firstKey !== undefined) this.recentSignatures.delete(firstKey);
    }
    this.recentSignatures.set(signature, Date.now());

    // 5. Route
    this.route(cemi, source);
  }

  private learnAddress(src: string, source: KNXService) {
    // knxd pattern: don't learn 0.0.0 or special 15.15.255 (0xFFFF) addresses
    if (src !== "0.0.0" && src !== "15.15.255") {
      if (this.addressTable.get(src) !== source) {
        this.addressTable.set(src, source);
        this.logger.debug(`Learned IA ${src} on link ${source.constructor.name}`);
      }
    }
  }

  private route(cemi: ServiceMessage, source: KNXService) {
    const cemiAny = cemi as any;

    // Hop Count Management (Protect the whole network)
    if (
      cemiAny.controlField2 &&
      typeof cemiAny.controlField2.hopCount === "number"
    ) {
      const hops = cemiAny.controlField2.hopCount;
      if (hops === 0) {
        this.logger.debug({ src: cemiAny.sourceAddress, dst: cemiAny.destinationAddress }, "Packet dropped: hop count reached 0");
        return; // Drop packet
      }
      if (hops < 7) cemiAny.controlField2.hopCount = hops - 1;
    }

    const isGroup = cemiAny.controlField2?.addressType === 1;
    const dest = cemiAny.destinationAddress;

    // If packet is destined for the router itself, consume it and don't route
    if (!isGroup && dest === this.routerAddress) {
      this.logger.debug({ src: cemiAny.sourceAddress }, "Packet consumed by router local address");
      this.emit("indication", cemi);
      return;
    }

    // Selective Routing (IA)
    if (!isGroup && dest && dest !== "0.0.0" && dest !== "15.15.255") {
      const target = this.addressTable.get(dest);
      if (target) {
        if (target !== source) {
          target.send(cemi).catch((err: any) => {
            this.logger.debug({ target: target.constructor.name, err: err.message }, "Selective routing failed");
          });
        }
        // Send to upper layers (KNXnet/IP server core)
        this.emit("indication", cemi);
        return; // Do not flood
      }
      // If target is unknown, knxd broadcasts it to all interfaces
    }

    // Flood to all links except source, respecting filters (knxd pattern)
    for (const link of this.links) {
      if (link === source) continue;

      // Avoid looping back to the physical source address if known via another route
      if (this.addressTable.get(cemiAny.sourceAddress) === link) continue;

      // Check if the link should filter this message
      if (isGroup) {
        if (link.shouldFilterGroup && !link.shouldFilterGroup(dest)) continue;
      } else {
        if (link.shouldFilterIA && !link.shouldFilterIA(dest)) continue;
      }

      link.send(cemi).catch((err: any) => {
        this.logger.debug({ link: link.constructor.name, err: err.message }, "Flooding routing failed for link");
      });
    }

    // Notify upper layers
    this.emit("indication", cemi);
  }

  private getSignature(buf: Buffer, addIL: number): string {
    // Signature based on Dst + APCI + Data (knxd style)
    // We skip Src and HopCount because they change during routing
    // Payload starts after CEMI header (2) + AddIL + Ctrl1 (1) + Ctrl2 (1) + Src (2)
    // Actually, taking from Dst onwards is a solid signature.
    // Dst is at offset 2 + addIL + 4
    const dstOffset = 2 + addIL + 4;
    return buf.subarray(dstOffset).toString("hex");
  }

  private gcSignatures() {
    const now = Date.now();
    for (const [sig, time] of this.recentSignatures) {
      // knxd keeps them for 1 second
      if (now - time > 1000) this.recentSignatures.delete(sig);
    }
  }

  async connect(): Promise<void> {
    await Promise.all(Array.from(this.links).map((l) => l.connect()));
  }

  disconnect(): void {
    this.links.forEach((l) => l.disconnect());
  }
}
