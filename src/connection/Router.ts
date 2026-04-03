import { EventEmitter } from "events";
import { KNXService } from "./KNXService";
import { TPUARTConnection } from "./TPUART";
import { KNXTunneling } from "./KNXTunneling";
import { KNXUSBConnection } from "./KNXUSBConnection";
import { RouterConnOptions } from "../@types/interfaces/connection";
import { Logger } from "pino";
import { knxLogger } from "../utils/Logger";
import { CEMI, CEMIInstance } from "../core/CEMI";
import { KNXnetIPServer } from "./KNXnetIPServer";
import { GroupAddressCache } from "../core/cache/GroupAddressCache";
import { KnxDataEncoder } from "../core/data/KNXDataEncode";
import { AllDpts } from "../@types/types/AllDpts";
import { ControlField } from "../core/ControlField";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { TPDU } from "../core/layers/data/TPDU";
import { TPCI, TPCIType } from "../core/layers/interfaces/TPCI";
import { APDU } from "../core/layers/data/APDU";
import { APCI } from "../core/layers/interfaces/APCI";
import { APCIEnum } from "../core/enum/APCIEnum";

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
  public readonly addressTable: Map<string, { link: KNXService; key: string }> = new Map();

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
    if (options.knxNetIpServer) {
      options.knxNetIpServer.individualAddress = this.routerAddress;
      const ipServer = new KNXnetIPServer(options.knxNetIpServer);
      ipServer.isCacheDelegated = true;
      ipServer.isEventsDelegated = true;
      this.registerLink(`IP KNXnet/IP Server: ${ipServer.options.localIp}:${ipServer.options.port}`, ipServer);
    }
    if (options.tpuart) {
      options.tpuart.individualAddress = this.routerAddress;
      this.registerLink("TPUART", new TPUARTConnection(options.tpuart));
    }
    if (options.tunneling) {
      options.tunneling.forEach((c) => {
        // * Tunneling doesn't support individualAddress, is assigned by the tunnel connection
        // c.individualAddress = this.routerAddress;
        this.registerLink(`IP Tunneling: ${c.ip}:${c.port}`, new KNXTunneling(c));
      });
    }
    if (options.usb) {
      options.usb.individualAddress = this.routerAddress;
      this.registerLink("KNXUSB", new KNXUSBConnection(options.usb));
    }

    this.logger.info(`Router initialized at ${this.routerAddress}`);

    // Periodically clean the signature cache (knxd pattern)
    this.gcInterval = setInterval(() => this.gcDestinationAddress(), 1000);
  }

  public registerLink(key: string, link: KNXService) {
    if (this.links.has(key)) return;
    this.links.set(key, link);
    this.logger.info(`Link registered: ${key}`);

    link.on("indication", (cemi: CEMIInstance) => {
      this.processIncoming(cemi, link, key);
    });

    link.on("error", (err) => {
      this.logger.error({ link: key, err: err.message }, "Link error");
      this.emit("error", { link, error: err });
    });

    // knxd pattern: cleanup when link goes down
    link.on("disconnected", () => {
      this.logger.info(`Link disconnected: ${key}`);
      this.unregisterLink(key);
    });
  }

  public unregisterLink(key: string | "TPUART" | "KNXUSB") {
    if (!this.links.has(key)) return;

    // Cleanup routing table
    for (const [addr, l] of this.addressTable.entries()) {
      if (l.key === key) {
        this.addressTable.delete(addr);
      }
    }
    this.links.delete(key);
  }

  /**
   * Main entry point for any packet received from any link.
   * Based on knxd's Router::recv_L_Data and Router::trigger_cb logic.
   */
  private processIncoming(cemi: CEMIInstance, source: KNXService, keySource: string | "TPUART" | "KNXUSB") {
    if (!("sourceAddress" in cemi)) return;
    GroupAddressCache.getInstance().processCEMI(cemi);

    const src = cemi.sourceAddress;

    // 1. Source Validation (knxd pattern):
    // If we know this IA is on another link, discard to prevent loops/spoofing.
    if (src && src !== "0.0.0") {
      if (src === this.routerAddress) {
        // We shouldn't receive a packet claiming to be us from the outside.
        return;
      }
      const existingLink = this.addressTable.get(src);
      if (existingLink && existingLink.key !== keySource) {
        return; // Ignore packet from "wrong" interface
      }
    }

    // 2. IA Learning
    this.learnAddress(src, source, keySource);

    // 3. Loop Prevention (knxd strict pattern)

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

  private learnAddress(src: string, source: KNXService, keySource: string) {
    // knxd pattern: don't learn 0.0.0 or special 15.15.255 (0xFFFF) addresses
    if (src !== "0.0.0" && src !== "15.15.255") {
      if (this.addressTable.get(src)?.key !== keySource) {
        this.addressTable.set(src, { link: source, key: keySource });
        this.logger.debug(`Learned IA ${src} on link ${keySource}`);
      }
    }
  }

  private route(data: CEMIInstance, source: KNXService, keySource: string | "TPUART" | "KNXUSB") {
    if (!("controlField2" in data)) return;
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
        if (target.key !== keySource) {
          target.link.send(data).catch((err: any) => {
            this.logger.debug({ target: target.key, err: err.message }, "Selective routing failed");
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
      if (this.addressTable.get(data.sourceAddress)?.key === keySource) continue;

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
  private sendToLink(link: KNXService, data: CEMIInstance): void {
    link.send(data).catch((err: any) => {
      this.logger.debug({ link: link.constructor.name, err: err.message }, "Flooding routing failed for link");
    });
  }

  /**
   * Broadcasts a CEMI message to all registered links.
   */
  public async send(cemi: CEMIInstance): Promise<void> {
    const promises = Array.from(this.links.entries()).map(async ([key, link]) => {
      try {
        await link.send(cemi);
      } catch (err: any) {
        this.logger.debug({ link: key, err: err.message }, "Broadcast failed for link");
      }
    });
    await Promise.all(promises);
  }

  /**
   * Send a GroupValue_Read telegram to a group address to all registered links.
   * @param destination The group address (e.g., "1/1/1")
   */
  public async read(destination: string): Promise<void> {
    const cf1 = new ControlField(0xbc);
    const cf2 = new ExtendedControlField(0xe0);
    const tpdu = new TPDU(
      new TPCI(TPCIType.T_DATA_GROUP_PDU),
      new APDU(
        new TPCI(TPCIType.T_DATA_GROUP_PDU),
        new APCI(APCIEnum.A_GroupValue_Read_Protocol_Data_Unit),
        Buffer.alloc(0),
        true,
      ),
      Buffer.alloc(0),
    );

    const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, this.routerAddress, destination, tpdu);
    this.logger.debug({ service: cemi.constructor.name }, "Sending GroupValue_Read");

    return this.send(cemi);
  }

  /**
   * Send a GroupValue_Write telegram to a group address.
   * @param destination The group address (e.g., "1/1/1")
   * @param value The value to write.
   * @param dpt Optional Datapoint Type to help with encoding.
   */
  public async write<T extends (typeof KnxDataEncoder.dptEnum)[number] | string | null>(
    destination: string,
    dpt: T,
    value: AllDpts<T>,
  ): Promise<void> {
    let data: Buffer;
    let isShort = false;
    // data validation
    if (dpt !== undefined) {
      data = KnxDataEncoder.encodeThis(dpt, value);
      isShort = KnxDataEncoder.isShortDpt(dpt);
    } else if (typeof value === "boolean") {
      data = Buffer.from([value ? 1 : 0]);
      isShort = true;
    } else if (Buffer.isBuffer(value)) {
      data = value;
      isShort = data.length === 1 && data[0] <= 0x3f;
    } else if (typeof value === "number") {
      data = Buffer.from([value]);
      isShort = value <= 0x3f;
    } else {
      throw new Error("Cannot encode value without DPT or basic type (boolean/number/Buffer)");
    }

    const cf1 = new ControlField(0xbc);
    const cf2 = new ExtendedControlField(0xe0);
    const tpdu = new TPDU(
      new TPCI(TPCIType.T_DATA_GROUP_PDU),
      new APDU(
        new TPCI(TPCIType.T_DATA_GROUP_PDU),
        new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit),
        data,
        isShort,
      ),
      data,
    );

    const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, this.routerAddress, destination, tpdu);
    this.logger.debug({ service: cemi.constructor.name }, "Sending GroupValue_Write");

    return this.send(cemi);
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
