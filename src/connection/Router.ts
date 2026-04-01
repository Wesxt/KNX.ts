import { EventEmitter } from "events";
import { KNXService } from "./KNXService";
import { TPUARTConnection } from "./TPUART";
import { KNXTunneling } from "./KNXTunneling";
import { KNXUSBConnection } from "./KNXUSBConnection";
import { RouterConnOptions } from "../@types/interfaces/connection";
import { Logger } from "pino";
import { knxLogger } from "../utils/Logger";
import { CEMI } from "../core/CEMI";
import { KNXnetIPServer } from "./KNXnetIPServer";

/**
 * Router: A robust, high-performance learning bridge.
 * The architecture is based on the patterns in the knxd repository at knxd/src/libserver/router.cpp:
 * 1. Loop prevention through destination address tracking.
 * 2. AI learning and selective routing.
 * 3. Source address correction and sanitization.
 * 4. Address filtering between KNXnetIP and other connections, and vice versa.
 */
export class Router extends EventEmitter {
  public readonly links: Map<string, KNXService> = new Map();
  public readonly addressTable: Map<string, KNXService> = new Map();

  // knxd 'ignore' list: prevents infinite loops across different physical paths
  // Only ignores frames if they are marked as repeated in the KNX Control Field.
  private recentDestinationAddress: Map<string, number> = new Map();
  private readonly MAX_SIGNATURES_SIZE = 10000;

  public routerAddress: string = "15.15.0"; // Default, should be configurable

  private logger: Logger;
  private gcInterval: NodeJS.Timeout;

  public readonly toIPFilter: RouterConnOptions["toIpFilter"] = {};
  public readonly toLocalFilter: RouterConnOptions["toLocalFilter"] = {};
  constructor(options: RouterConnOptions) {
    super();
    this.logger = knxLogger.child({ module: "Router" });

    if (options.routerAddress) this.routerAddress = options.routerAddress;
    if (options.toIpFilter) {
      this.toIPFilter = options.toIpFilter;
    }
    if (options.toLocalFilter) {
      this.toLocalFilter = options.toLocalFilter;
    }
    if (options.knxNetIpServer)
      this.registerLink(
        `IP${options.knxNetIpServer.ip ? `: ${options.knxNetIpServer.ip}` : ""}`,
        new KNXnetIPServer(options.knxNetIpServer),
      );
    if (options.tpuart) this.registerLink("TPUART", new TPUARTConnection(options.tpuart));
    if (options.tunneling) options.tunneling.forEach((c) => this.registerLink(`IP: ${c.ip}`, new KNXTunneling(c)));
    if (options.usb) this.registerLink("KNXUSB", new KNXUSBConnection(options.usb));

    this.logger.info(`Router initialized at ${this.routerAddress}`);

    // Periodically clean the signature cache (knxd pattern)
    this.gcInterval = setInterval(() => this.gcDestinationAddress(), 1000);
  }

  public registerLink(key: string, link: KNXService) {
    if (this.links.has(key)) return;
    this.links.set(key, link);
    this.logger.info(`Link registered: ${link.constructor.name}`);

    link.on("indication", (cemi: InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>) => {
      this.processIncoming(cemi, link, key);
    });

    link.on("error", (err) => {
      this.logger.error({ link: link.constructor.name, err: err.message }, "Link error");
      this.emit("error", { link, error: err });
    });

    // knxd pattern: cleanup when link goes down
    link.on("disconnected", () => {
      this.logger.info(`Link disconnected: ${link.constructor.name}`);
      this.unregisterLink(key, link);
    });
  }

  public unregisterLink(key: string | "TPUART" | "KNXUSB", link: KNXService) {
    if (!this.links.has(key)) return;

    // Cleanup routing table
    for (const [addr, l] of this.addressTable.entries()) {
      if (l === link) {
        this.addressTable.delete(addr);
      }
    }
    this.links.delete(key);
  }

  /**
   * Main entry point for any packet received from any link.
   * Based on knxd's Router::recv_L_Data and Router::trigger_cb logic.
   */
  private processIncoming(
    cemi: InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>,
    source: KNXService,
    keySource: string | "TPUART" | "KNXUSB",
  ) {
    let src = cemi.sourceAddress;

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
      cemi.sourceAddress =
        "individualAddress" in source.options &&
        source.options.individualAddress &&
        typeof source.options.individualAddress === "string"
          ? source.options.individualAddress
          : this.routerAddress;
      src = cemi.sourceAddress;
    }

    // 3. IA Learning
    this.learnAddress(src, source);

    // 4. Loop Prevention (knxd strict pattern)

    // KNX Standard: Repeat bit is bit 5 (0x20). Active LOW (0 = repeated frame).
    const isRepeated = !cemi.controlField1.repeat;
    const destinationAddress = cemi.destinationAddress;

    if (isRepeated) {
      if (this.recentDestinationAddress.has(destinationAddress)) {
        this.logger.debug({ signature: destinationAddress, src }, "Loop prevented: duplicated repeated frame dropped");
        return; // Drop repeated packet we've recently seen on the bus
      }
    }

    // Always record the signature. If a loop occurs, the echoed packet will have
    // the repeat flag set to 0 (since it failed to ACK or was physically echoed),
    // and we will drop it next time.
    if (this.recentDestinationAddress.size >= this.MAX_SIGNATURES_SIZE) {
      const firstKey = this.recentDestinationAddress.keys().next().value;
      if (firstKey !== undefined) this.recentDestinationAddress.delete(firstKey);
    }
    this.recentDestinationAddress.set(destinationAddress, Date.now());

    // 5. Route
    this.route(cemi, source, keySource);
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

  private route(
    data: InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>,
    source: KNXService,
    keySource: string | "TPUART" | "KNXUSB",
  ) {
    // Hop Count Management (Protect the whole network)
    if (data.controlField2 && typeof data.controlField2.hopCount === "number") {
      const hops = data.controlField2.hopCount;
      if (hops === 0) {
        this.logger.debug(
          { src: data.sourceAddress, dst: data.destinationAddress },
          "Packet dropped: hop count reached 0",
        );
        return; // Drop packet
      }
      if (hops < 7) data.controlField2.hopCount = hops - 1;
    }

    const isGroup = data.controlField2?.addressType === 1;
    const dest = data.destinationAddress;

    // If packet is destined for the router itself, consume it and don't route
    if (!isGroup && dest === this.routerAddress) {
      this.logger.debug({ src: data.sourceAddress }, "Packet consumed by router local address");
      this.emit("indication_link", { src: source.constructor.name, msg: data });
      return;
    }

    // Selective Routing (IA)
    if (!isGroup && dest && dest !== "0.0.0" && dest !== "15.15.255") {
      const target = this.addressTable.get(dest);
      if (target) {
        if (target.constructor.name !== source.constructor.name) {
          target.send(data).catch((err: any) => {
            this.logger.debug({ target: target.constructor.name, err: err.message }, "Selective routing failed");
          });
        }
        // Send to upper layers (KNXnet/IP server core)
        this.emit("indication_link", { src: source.constructor.name, msg: data });
        return; // Do not flood
      }
      // If target is unknown, knxd broadcasts it to all interfaces
    }
    const isSourceIP = keySource.includes("IP");
    // Flood to all links except source, respecting filters (knxd pattern)
    for (const [key, link] of this.links) {
      if (key === keySource) continue;

      // Avoid looping back to the physical source address if known via another route
      if (this.addressTable.get(data.sourceAddress) === link) continue;

      // Check if the link should filter this message
      const shouldSend = this.evaluateFilter(dest, isGroup, isSourceIP);
      if (!shouldSend) continue;

      // Send to link
      this.sendToLink(link, data);
    }

    // Notify upper layers
    this.emit("indication_link", { src: source.constructor.name, msg: data });
  }

  /**
   * Evaluates if a message should be sent to a link based on configured filters.
   * Logic: Skip if the policy is "discard all" and the address matches.
   * Otherwise, send if the address is in the filter list or no filter exists.
   */
  private evaluateFilter(dest: string, isGroup: boolean, isSourceIP: boolean): boolean {
    if (isSourceIP) {
      return this.evaluateLocalFilter(dest, isGroup);
    } else {
      return this.evaluateIpFilter(dest, isGroup);
    }
  }

  private evaluateLocalFilter(dest: string, isGroup: boolean): boolean {
    if (isGroup) {
      const filter = this.toLocalFilter?.groupAddress;
      if (!filter?.addresses?.includes(dest)) return true;
      return filter.groupAddressToLocalFilterPolicie !== "discard all";
    } else {
      const filter = this.toLocalFilter?.individualAddress;
      if (!filter?.addresses?.includes(dest)) return true;
      return filter.individualAddressToLocalFilterPolicie !== "discard all";
    }
  }

  private evaluateIpFilter(dest: string, isGroup: boolean): boolean {
    if (isGroup) {
      const filter = this.toIPFilter?.groupAddress;
      if (!filter?.addresses?.includes(dest)) return true;
      return filter.groupAddressToIpFilterPolicie !== "discard all";
    } else {
      const filter = this.toIPFilter?.individualAddress;
      if (!filter?.addresses?.includes(dest)) return true;
      return filter.individualAddressToIpFilterPolicie !== "discard all";
    }
  }

  /**
   * Sends data to a link with error handling.
   */
  private sendToLink(link: KNXService, data: InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>): void {
    link.send(data).catch((err: any) => {
      this.logger.debug({ link: link.constructor.name, err: err.message }, "Flooding routing failed for link");
    });
  }

  private gcDestinationAddress() {
    const now = Date.now();
    for (const [sig, time] of this.recentDestinationAddress) {
      // knxd keeps them for 1 second
      if (now - time > 1000) this.recentDestinationAddress.delete(sig);
    }
  }

  async connect(): Promise<void> {
    await Promise.all(Array.from(this.links.values()).map((link) => link.connect()));
  }

  disconnect(): void {
    clearInterval(this.gcInterval);
    this.links.forEach((l) => l.disconnect());
  }
}
