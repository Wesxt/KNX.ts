import * as hid from "node-hid";
import { KNXService } from "./KNXService";
import { CEMIAdapter } from "../utils/CEMIAdapter";
import { CEMI, CEMIInstance } from "../core/CEMI";
import { KNXUSBOptions } from "../@types/interfaces/connection";
import { EMIInstance } from "../core/EMI";
import { GroupAddressCache } from "../core/cache/GroupAddressCache";
import {
  findKnxUsbInterface,
  getKnxUsbInterfaceDisplayName,
  getKnxUsbInterfaceManufacturerName,
  isKnownKnxUsbDevice,
  KnxUsbInterfaceDescriptor,
} from "../core/resources/KNXUsbInterfaces";
import { KNXHelper } from "../utils/KNXHelper";
import { FSM } from "./FSM";

/**
 * Enriched metadata for a discovered or connected KNX-USB HID interface.
 */
export interface KNXDiscoveredUsbInterface {
  /** OS HID device path used to open the interface with `KNXUSBConnection({ path })`. */
  path: string;
  /** 16-bit USB Vendor ID. */
  vendorId: number;
  /** 16-bit USB Product ID. */
  productId: number;
  /** Formatted 4-digit uppercase hex Vendor ID (e.g. `"28C2"`). */
  vendorIdHex: string;
  /** Formatted 4-digit uppercase hex Product ID (e.g. `"0002"`). */
  productIdHex: string;
  /** USB serial number reported by HID (if available). */
  serialNumber?: string;
  /** HID manufacturer string reported by the OS (if available). */
  manufacturer?: string;
  /** HID product string reported by the OS (if available). */
  product?: string;
  /** HID release number (if available). */
  release?: number;
  /** USB HID interface number (if available). */
  interface?: number;
  /** Localized human-readable display name from ETS6 `KNX_USB_INTERFACES` (or HID product string fallback). */
  displayName: string;
  /** 16-bit KNX Association Manufacturer ID (when matched in ETS6 `KNX_USB_INTERFACES`). */
  knxManufacturerId?: number;
  /** KNX Association Manufacturer name resolved via `KNX_MANUFACTURERS` (when matched). */
  knxManufacturerName?: string;
  /** Whether the interface persists its programmed Individual Address across power cycles (false e.g. for Siemens OCI700). */
  persistsIndividualAddress: boolean;
  /** Whether ETS flags this interface with `RequiresKnxUsbFix="true"`. */
  requiresKnxUsbFix: boolean;
  /** Optional vendor-specific timing `[initWaitMs, stepWaitMs]` from ETS6 `knx_interfaces.xml`. */
  timing?: readonly [number, number];
  /** True when the `(vendorId, productId)` matched an official ETS6 `KNX_USB_INTERFACES` entry. */
  matchedCatalog: boolean;
  /** Raw catalog descriptor when `matchedCatalog` is true. */
  catalogEntry?: KnxUsbInterfaceDescriptor;
}

export interface KNXUsbDiscoverOptions {
  /** Optional BCP-47 language tag (e.g. `"es-ES"`, `"de-DE"`, `"en-US"`) for localized `displayName`. */
  language?: string;
  /**
   * Include fallback matches (dedicated KNX VIDs or HID product names containing `"knx"`/`"eib"`)
   * in addition to exact `(vendorId, productId)` entries from `KNX_USB_INTERFACES`. Defaults to `true`.
   */
  includeFallbackMatches?: boolean;
}

function buildUsbInterfaceInfo(device: hid.Device, language?: string): KNXDiscoveredUsbInterface {
  const desc = findKnxUsbInterface(device.vendorId, device.productId);
  const vendorIdHex = (device.vendorId & 0xffff).toString(16).toUpperCase().padStart(4, "0");
  const productIdHex = (device.productId & 0xffff).toString(16).toUpperCase().padStart(4, "0");
  const knxManufacturerName = desc ? getKnxUsbInterfaceManufacturerName(desc) : undefined;

  return {
    path: device.path ?? "",
    vendorId: device.vendorId,
    productId: device.productId,
    vendorIdHex,
    productIdHex,
    serialNumber: device.serialNumber,
    manufacturer: device.manufacturer,
    product: device.product,
    release: device.release,
    interface: device.interface,
    displayName: desc
      ? getKnxUsbInterfaceDisplayName(desc, language)
      : device.product || `KNX USB Interface (${vendorIdHex}:${productIdHex})`,
    knxManufacturerId: desc?.knxManufacturerId,
    knxManufacturerName,
    persistsIndividualAddress: desc ? desc.persistsIndividualAddress : true,
    requiresKnxUsbFix: desc ? desc.requiresKnxUsbFix : false,
    timing: desc?.timing,
    matchedCatalog: Boolean(desc),
    catalogEntry: desc,
  };
}

/**
 * States for the KNXUSBConnection Finite State Machine.
 */
export enum KNXUSBState {
  DISCONNECTED = "DISCONNECTED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  FAULTED = "FAULTED",
}

/**
 * Events triggering transitions in the KNXUSBConnection FSM.
 */
export enum KNXUSBEvent {
  START = "START",
  STOP = "STOP",
  CONNECTED = "CONNECTED",
  ERROR = "ERROR",
}

export class KNXUSBConnection extends KNXService<KNXUSBOptions> {
  private fsm: FSM<KNXUSBState, KNXUSBEvent>;
  private device: hid.HID | null = null;
  private busConnected: boolean = false;
  private supportedEmiType: number = 0x03;
  private hasExplicitIndividualAddress: boolean = false;
  private warnedSourceAddressMismatch: boolean = false;
  private rxFragments: Buffer[] = [];
  private rxExpectedSeq: number = 0;
  private pendingPropReads: Map<string, (data: Buffer | null) => void> = new Map();
  private pendingPropWrites: Map<string, (result: { ok: boolean; errorCode?: number }) => void> = new Map();

  /**
   * Hardware Individual Address read from the KNX USB interface via Local Device Management
   * (`Device Object 0`, `PID_SUBNET_ADDR` / `PID_DEVICE_ADDR`, per `AN203` Table 1) in cEMI mode.
   */
  public hardwareIndividualAddress: string | null = null;

  /**
   * Enriched descriptor of the currently connected KNX-USB interface (matched against ETS6 `KNX_USB_INTERFACES`).
   */
  public interfaceInfo: KNXDiscoveredUsbInterface | null = null;

  /**
   * Discovers all locally attached KNX-USB HID interfaces using the official ETS6 `KNX_USB_INTERFACES`
   * catalog (exact `VendorID:ProductID` matching first, avoiding false positives on shared VIDs like FTDI/Siemens).
   */
  public static discover(options: KNXUsbDiscoverOptions = {}): KNXDiscoveredUsbInterface[] {
    const includeFallback = options.includeFallbackMatches ?? true;
    const devices = hid.devices();
    const seenPaths = new Set<string>();
    const results: KNXDiscoveredUsbInterface[] = [];

    for (const d of devices) {
      if (!d.path || seenPaths.has(d.path)) continue;
      const exact = findKnxUsbInterface(d.vendorId, d.productId);
      if (!exact && (!includeFallback || !isKnownKnxUsbDevice(d))) continue;

      seenPaths.add(d.path);
      results.push(buildUsbInterfaceInfo(d, options.language));
    }

    // Prioritize official ETS6 catalog matches before fallback heuristic matches
    results.sort((a, b) => Number(b.matchedCatalog) - Number(a.matchedCatalog));
    return results;
  }

  constructor(options: KNXUSBOptions = {}) {
    super(options);
    this.logger = this.logger.child({ module: "KNXUSBConnection" });
    this.hasExplicitIndividualAddress =
      typeof options.individualAddress === "string" &&
      options.individualAddress.trim().length > 0 &&
      options.individualAddress.trim() !== "0.0.0";

    // Initialize FSM
    this.fsm = new FSM<KNXUSBState, KNXUSBEvent>(
      KNXUSBState.DISCONNECTED,
      {
        [KNXUSBState.DISCONNECTED]: {
          [KNXUSBEvent.START]: KNXUSBState.CONNECTING,
        },
        [KNXUSBState.CONNECTING]: {
          [KNXUSBEvent.CONNECTED]: KNXUSBState.CONNECTED,
          [KNXUSBEvent.ERROR]: KNXUSBState.FAULTED,
          [KNXUSBEvent.STOP]: KNXUSBState.DISCONNECTED,
        },
        [KNXUSBState.CONNECTED]: {
          [KNXUSBEvent.ERROR]: KNXUSBState.FAULTED,
          [KNXUSBEvent.STOP]: KNXUSBState.DISCONNECTED,
        },
        [KNXUSBState.FAULTED]: {
          [KNXUSBEvent.START]: KNXUSBState.CONNECTING,
          [KNXUSBEvent.STOP]: KNXUSBState.DISCONNECTED,
        },
      },
      (newState, oldState) => this.handleStateChange(newState, oldState),
    );
  }

  /**
   * Returns the current state as a string.
   */
  public get connectionState(): string {
    return this.fsm.state;
  }

  /**
   * Returns true if currently connected.
   */
  public get isConnected(): boolean {
    return this.fsm.state === KNXUSBState.CONNECTED;
  }

  /**
   * Active KNX USB EMI type (`0x01` = EMI1, `0x02` = EMI2, `0x03` = cEMI).
   */
  public get activeEmiType(): number {
    return this.supportedEmiType;
  }

  async connect(): Promise<void> {
    if (this.fsm.state === KNXUSBState.CONNECTED) return;

    return new Promise<void>((resolve, reject) => {
      const onConnected = () => {
        this.removeListener("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        this.removeListener("connected", onConnected);
        reject(err);
      };
      this.once("connected", onConnected);
      this.once("error", onError);

      this.fsm.transition(KNXUSBEvent.START);
    });
  }

  private async performConnect(): Promise<void> {
    try {
      const options = this.options;
      let devicePath = options.path;
      let matchedHidDevice: hid.Device | undefined;
      const devices = hid.devices();

      if (devicePath) {
        matchedHidDevice = devices.find((d) => d.path === devicePath);
      } else if (options.vendorId !== undefined || options.productId !== undefined) {
        // Strict filter when caller explicitly requests vendorId and/or productId
        matchedHidDevice = devices.find(
          (d) =>
            Boolean(d.path) &&
            (options.vendorId === undefined || d.vendorId === options.vendorId) &&
            (options.productId === undefined || d.productId === options.productId),
        );
        if (!matchedHidDevice || !matchedHidDevice.path) {
          const vidStr = options.vendorId !== undefined ? `0x${options.vendorId.toString(16).padStart(4, "0")}` : "*";
          const pidStr = options.productId !== undefined ? `0x${options.productId.toString(16).padStart(4, "0")}` : "*";
          throw new Error(`No KNX USB device found matching ${vidStr}:${pidStr}`);
        }
        devicePath = matchedHidDevice.path;
      } else {
        // Auto-discover: prefer exact (vendorId, productId) matches in official ETS6 KNX_USB_INTERFACES first,
        // then fall back to dedicated KNX VIDs or product names mentioning "knx"/"eib".
        matchedHidDevice =
          devices.find((d) => Boolean(d.path) && Boolean(findKnxUsbInterface(d.vendorId, d.productId))) ??
          devices.find((d) => Boolean(d.path) && isKnownKnxUsbDevice(d));

        if (!matchedHidDevice || !matchedHidDevice.path) {
          throw new Error("No KNX USB device found");
        }
        devicePath = matchedHidDevice.path;
      }

      this.interfaceInfo = matchedHidDevice ? buildUsbInterfaceInfo(matchedHidDevice) : null;

      if (this.interfaceInfo) {
        const mfrTag = this.interfaceInfo.knxManufacturerName ? ` [${this.interfaceInfo.knxManufacturerName}]` : "";
        this.logger.info(
          `Opening KNX USB device: ${this.interfaceInfo.displayName}${mfrTag} (${this.interfaceInfo.vendorIdHex}:${this.interfaceInfo.productIdHex}) at ${devicePath}`,
        );
        if (this.interfaceInfo.requiresKnxUsbFix) {
          if (process.platform === "win32") {
            this.logger.warn(
              `KNX USB interface "${this.interfaceInfo.displayName}" (${this.interfaceInfo.vendorIdHex}:${this.interfaceInfo.productIdHex}) is flagged RequiresKnxUsbFix=true. On Windows (especially USB 3.0 xHCI ports), apply the official ETS KNX USB Fix, disable USB Selective Suspend, or use a USB 2.0 port if you experience timeouts or disconnects.`,
            );
          } else {
            this.logger.debug(
              `KNX USB interface ${this.interfaceInfo.vendorIdHex}:${this.interfaceInfo.productIdHex} is flagged RequiresKnxUsbFix=true in ETS6 catalog`,
            );
          }
        }
      } else {
        this.logger.info(`Opening KNX USB device at ${devicePath}`);
      }
      this.device = new hid.HID(devicePath);

      this.device.on("data", (data: Buffer) => {
        this.handleData(data);
      });
      this.device.on("error", (err: any) => this.handleError(err));

      this.busConnected = false;

      await this.initializeDevice();
      this.fsm.transition(KNXUSBEvent.CONNECTED);
    } catch (err: any) {
      if (process.platform === "win32" && this.interfaceInfo?.requiresKnxUsbFix) {
        this.logger.warn(
          `Connection failed on Windows for legacy KNX USB interface ${this.interfaceInfo.vendorIdHex}:${this.interfaceInfo.productIdHex} (RequiresKnxUsbFix=true). Install the official ETS KNX USB Fix, disable USB Selective Suspend, or try a USB 2.0 port.`,
        );
      }
      this.logger.error("Failed to connect to KNX USB: " + err);
      this.fsm.transition(KNXUSBEvent.ERROR);
      throw err;
    }
  }

  disconnect(): void {
    this.fsm.transition(KNXUSBEvent.STOP);
  }

  private closeDevice(): void {
    if (this.device) {
      try {
        this.device.close();
      } catch {
        // Ignore close errors
      }
      this.device = null;
    }
    this.interfaceInfo = null;
    this.busConnected = false;
    this.rxFragments = [];
    this.rxExpectedSeq = 0;
    for (const resolve of this.pendingPropReads.values()) {
      resolve(null);
    }
    this.pendingPropReads.clear();
    for (const resolve of this.pendingPropWrites.values()) {
      resolve({ ok: false });
    }
    this.pendingPropWrites.clear();
  }

  private async handleStateChange(newState: KNXUSBState, oldState: KNXUSBState): Promise<void> {
    this.logger.info(`FSM: State transition from ${oldState} to ${newState}`);

    switch (newState) {
      case KNXUSBState.CONNECTING:
        try {
          await this.performConnect();
        } catch (err: any) {
          this.emit("error", err);
        }
        break;

      case KNXUSBState.CONNECTED:
        this.emit("connected");
        break;

      case KNXUSBState.DISCONNECTED:
      case KNXUSBState.FAULTED:
        this.closeDevice();
        this.emit("disconnected");
        break;
    }
  }

  private async initializeDevice(): Promise<void> {
    // 1. Discover supported EMI types FIRST before sending any resets that might lock up older interfaces
    // knxd implementation uses up to 5 retries for EMI discovery
    await this.discoverEmiType();

    // 2. Set active EMI type to the discovered type
    // protocolId: 0x0f (BusAccessServerFeatureService)
    // emiId: 0x03 (service device feature set), feature: 0x05, value: this.supportedEmiType
    await this.sendUSBTransfer(0x0f, 0x03, Buffer.from([0x05, this.supportedEmiType]));
    await new Promise((r) => setTimeout(r, 100));

    if (this.supportedEmiType === 0x03) {
      // 3. cEMI Specific Initialization
      // Send Reset Request (M_RESET_REQ = 0xF1)
      await this.sendUSBTransfer(0x01, 0x03, Buffer.from([0xf1]));
      await new Promise((r) => setTimeout(r, 100));

      // Set Comm Mode (PID_COMM_MODE)
      // M_PROP_WRITE_REQ (0xF6), ObjType (0x0008), ObjInst (0x01), PropId (0x34), Elements (1) + StartIdx (1) -> 0x1001, Mode: 0x00 (DataLinkLayer)
      const commModeBuf = Buffer.from([
        0xf6, // M_PROP_WRITE_REQ
        0x00,
        0x08, // Interface Object (cEMI Server Object)
        0x01, // Object Instance
        0x34, // Property ID (52 = PID_COMM_MODE)
        0x10,
        0x01, // Elements + Start Index
        0x00, // Data (DataLinkLayer, 0x00)
      ]);
      await this.sendUSBTransfer(0x01, 0x03, commModeBuf);
      await new Promise((r) => setTimeout(r, 100));

      // 4. Best-effort read of the USB interface's programmed Individual Address (AN203 Table 1: always readable)
      await this.discoverHardwareIndividualAddress();
    } else if (this.dataSecure) {
      this.logger.warn(
        `KNX USB interface active EMI is ${this.supportedEmiType === 0x01 ? "EMI1" : "EMI2"} (Standard Frames only, max 15B APDU). KNX Data Secure requires cEMI for Extended Frames (> 15B APDU).`,
      );
    }
  }

  /**
   * Reads a single Local Device Management property via `M_PropRead.req` (`0xFC`) in cEMI mode.
   */
  private async readLocalProperty(
    objectType: number,
    objectInstance: number,
    propertyId: number,
    timeoutMs: number = 300,
  ): Promise<Buffer | null> {
    if (!this.device || this.supportedEmiType !== 0x03) return null;

    const key = `${objectType}:${objectInstance}:${propertyId}`;
    return new Promise<Buffer | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPropReads.delete(key);
        resolve(null);
      }, timeoutMs);

      this.pendingPropReads.set(key, (data) => {
        clearTimeout(timer);
        this.pendingPropReads.delete(key);
        resolve(data);
      });

      const reqBuf = Buffer.from([
        0xfc, // M_PropRead.req
        (objectType >> 8) & 0xff,
        objectType & 0xff,
        objectInstance & 0xff,
        propertyId & 0xff,
        0x10, // 1 element, startIndex high nibble 0
        0x01, // startIndex low byte = 1
      ]);
      this.sendUSBTransfer(0x01, 0x03, reqBuf).catch(() => {
        clearTimeout(timer);
        this.pendingPropReads.delete(key);
        resolve(null);
      });
    });
  }

  /**
   * Writes a single Local Device Management property via `M_PropWrite.req` (`0xF6`) in cEMI mode
   * and waits for the corresponding `M_PropWrite.con` (`0xF5`).
   */
  private async writeLocalProperty(
    objectType: number,
    objectInstance: number,
    propertyId: number,
    data: Buffer,
    timeoutMs: number = 1000,
  ): Promise<{ ok: boolean; errorCode?: number }> {
    if (!this.device || this.supportedEmiType !== 0x03) {
      return { ok: false };
    }

    const key = `${objectType}:${objectInstance}:${propertyId}`;
    return new Promise<{ ok: boolean; errorCode?: number }>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPropWrites.delete(key);
        resolve({ ok: false });
      }, timeoutMs);

      this.pendingPropWrites.set(key, (result) => {
        clearTimeout(timer);
        this.pendingPropWrites.delete(key);
        resolve(result);
      });

      const reqBuf = Buffer.concat([
        Buffer.from([
          0xf6, // M_PropWrite.req
          (objectType >> 8) & 0xff,
          objectType & 0xff,
          objectInstance & 0xff,
          propertyId & 0xff,
          0x10, // 1 element, startIndex high nibble 0
          0x01, // startIndex low byte = 1
        ]),
        data,
      ]);
      this.sendUSBTransfer(0x01, 0x03, reqBuf).catch(() => {
        clearTimeout(timer);
        this.pendingPropWrites.delete(key);
        resolve({ ok: false });
      });
    });
  }

  /**
   * Programs the KNX USB interface's hardware Individual Address via cEMI Local Device Management
   * (`M_PropWrite.req` `0xF6` on `Device Object 0`, `PID_SUBNET_ADDR = 57` & `PID_DEVICE_ADDR = 58`,
   * per `03_06_03` §4.1.7.3 and `AN203` Table 1).
   *
   * Requires cEMI mode (`activeEmiType === 0x03`) and Security Mode disabled on the USB interface itself
   * (per `AN203` Table 1, devices with local Security Mode enabled respond with error `0x0B` Access Denied).
   * Updates `hardwareIndividualAddress`, `individualAddress`, and `dataSecure.sourceAddress` on success.
   */
  public async setHardwareIndividualAddress(individualAddress: string, timeoutMs: number = 1000): Promise<string> {
    if (!this.device) {
      throw new Error("KNX USB device offline");
    }
    if (this.supportedEmiType !== 0x03) {
      throw new Error("setHardwareIndividualAddress requires cEMI mode (active EMI is EMI1/EMI2)");
    }
    if (!KNXHelper.isValidIndividualAddress(individualAddress)) {
      throw new Error(`Invalid KNX Individual Address: "${individualAddress}"`);
    }
    if (this.interfaceInfo && !this.interfaceInfo.persistsIndividualAddress) {
      this.logger.warn(
        `KNX USB interface "${this.interfaceInfo.displayName}" (${this.interfaceInfo.vendorIdHex}:${this.interfaceInfo.productIdHex}) does not persist its Individual Address across power cycles (PersistsIndividualAddress=false).`,
      );
    }

    const addrBuf = KNXHelper.GetAddress_(individualAddress);
    const subnetRes = await this.writeLocalProperty(0x0000, 0x01, 57, Buffer.from([addrBuf[0]]), timeoutMs);
    if (!subnetRes.ok) {
      const codeStr =
        subnetRes.errorCode !== undefined
          ? ` (cEMI error 0x${subnetRes.errorCode.toString(16).padStart(2, "0")}${subnetRes.errorCode === 0x0b ? " - Access denied / Security Mode enabled" : ""})`
          : " (timeout)";
      throw new Error(`Failed to write PID_SUBNET_ADDR (57) on KNX USB interface${codeStr}`);
    }

    const deviceRes = await this.writeLocalProperty(0x0000, 0x01, 58, Buffer.from([addrBuf[1]]), timeoutMs);
    if (!deviceRes.ok) {
      const codeStr =
        deviceRes.errorCode !== undefined
          ? ` (cEMI error 0x${deviceRes.errorCode.toString(16).padStart(2, "0")}${deviceRes.errorCode === 0x0b ? " - Access denied / Security Mode enabled" : ""})`
          : " (timeout)";
      throw new Error(`Failed to write PID_DEVICE_ADDR (58) on KNX USB interface${codeStr}`);
    }

    // Read back to verify the USB interface committed the new address
    const readSubnet = await this.readLocalProperty(0x0000, 0x01, 57, timeoutMs);
    const readDevice = await this.readLocalProperty(0x0000, 0x01, 58, timeoutMs);
    const verifiedIa =
      readSubnet && readSubnet.length >= 1 && readDevice && readDevice.length >= 1
        ? (KNXHelper.GetAddress(Buffer.from([readSubnet[0], readDevice[0]]), ".") as string)
        : individualAddress;

    if (verifiedIa !== individualAddress) {
      throw new Error(
        `KNX USB hardware IA verification mismatch: requested ${individualAddress}, read back ${verifiedIa}`,
      );
    }

    this.hardwareIndividualAddress = verifiedIa;
    this.individualAddress = verifiedIa;
    this.hasExplicitIndividualAddress = true;
    this.warnedSourceAddressMismatch = false;
    if (this.dataSecure) {
      this.dataSecure.sourceAddress = verifiedIa;
    }
    this.logger.info(`Programmed KNX USB hardware Individual Address to ${verifiedIa}`);
    return verifiedIa;
  }

  /**
   * Queries `Device Object (0)` `PID_SUBNET_ADDR (57)` and `PID_DEVICE_ADDR (58)` (always readable per AN203 Table 1)
   * so KNX Data Secure knows the true hardware Individual Address of KNX USB interfaces.
   */
  private async discoverHardwareIndividualAddress(): Promise<void> {
    try {
      const subnetData = await this.readLocalProperty(0x0000, 0x01, 57);
      const deviceData = await this.readLocalProperty(0x0000, 0x01, 58);
      if (subnetData && subnetData.length >= 1 && deviceData && deviceData.length >= 1) {
        const hwIa = KNXHelper.GetAddress(Buffer.from([subnetData[0], deviceData[0]]), ".") as string;
        this.hardwareIndividualAddress = hwIa;
        this.logger.info(`KNX USB hardware Individual Address: ${hwIa}`);

        if (!this.hasExplicitIndividualAddress) {
          this.individualAddress = hwIa;
        } else if (this.individualAddress !== hwIa) {
          if (this.options.programHardwareAddress) {
            try {
              await this.setHardwareIndividualAddress(this.individualAddress);
            } catch (err: any) {
              this.logger.warn(
                `Failed to program KNX USB hardware IA from ${hwIa} to ${this.individualAddress}: ${err?.message ?? err}`,
              );
            }
          } else if (this.dataSecure) {
            this.logger.warn(
              `KNX USB configured individualAddress (${this.individualAddress}) differs from hardware IA (${hwIa}). Point-to-point traffic (KNXManagement / S-A_Sync T_ACK) only works for ${hwIa}, and single-IA USB sticks may overwrite SA on TP1. Use hardware IA ${hwIa}, pass programHardwareAddress: true, or call setHardwareIndividualAddress("${this.individualAddress}").`,
            );
          }
        }
      }
    } catch {
      // Best-effort discovery; continue without failing connection
    }
  }

  private async discoverEmiType(): Promise<void> {
    return new Promise((resolve) => {
      let attempts = 0;
      let timeout: NodeJS.Timeout;

      const attemptDiscovery = () => {
        attempts++;
        this.sendUSBTransfer(0x0f, 0x01, Buffer.from([0x01])).catch((e) => {
          this.logger.error("Error sending EMI discovery: " + e);
        });

        timeout = setTimeout(() => {
          if (attempts < 5) {
            attemptDiscovery();
          } else {
            this.removeListener("emi_discovery", onDiscovery);
            this.logger.warn("EMI discovery timeout, defaulting to cEMI");
            this.supportedEmiType = 0x03;
            resolve();
          }
        }, 1000); // 1 second timeout for each retry like knxd
      };

      const onDiscovery = (version: number) => {
        clearTimeout(timeout);
        this.supportedEmiType = version;
        this.logger.info(`Discovered EMI version: ${version === 0x03 ? "cEMI" : version === 0x01 ? "EMI1" : "EMI2"}`);
        resolve();
      };

      this.once("emi_discovery", onDiscovery);
      attemptDiscovery();
    });
  }

  private async sendUSBTransfer(protocolId: number, emiId: number, data: Buffer): Promise<void> {
    if (!this.device) throw new Error("Device offline");

    const header = Buffer.alloc(8);
    header[0] = 0x00; // protocol version
    header[1] = 0x08; // header length
    header.writeUInt16BE(data.length, 2); // body length
    header[4] = protocolId;
    header[5] = emiId;
    header.writeUInt16BE(0x0000, 6); // manufacturer code

    const body = Buffer.concat([header, data]);
    this.sendHIDReport(body);
  }

  /**
   * Splits a KNX USB Transfer Frame (`[8-byte USB Header][EMI/cEMI Body]`) into one or more
   * 64-byte KNX USB HID Reports per KNX Standard `09_03` §3.4.1.2.2–§3.4.1.2.3 & §3.4.2.1.
   *
   * - Single packet (`<= 61` bytes): PacketInfo = `0x13` (seq=1, start+end).
   * - Multi-frame (`> 61` bytes, up to 5 packets / 305 bytes):
   *   - Packet 1: `(1 << 4) | 0x05` (start+partial)
   *   - Middle packets: `(seq << 4) | 0x04` (partial)
   *   - Final packet: `(seq << 4) | 0x06` (partial+end)
   */
  public static buildHIDReports(data: Buffer): Buffer[] {
    const MAX_CHUNK = 61;
    const MAX_PACKETS = 5;
    if (data.length === 0) {
      throw new Error("KNX USB HID report data cannot be empty");
    }
    const packetCount = Math.ceil(data.length / MAX_CHUNK);
    if (packetCount > MAX_PACKETS) {
      throw new Error(
        `KNX USB transfer frame too large (${data.length} bytes, requires ${packetCount} HID packets; max is ${MAX_PACKETS})`,
      );
    }

    const reports: Buffer[] = [];
    for (let idx = 0; idx < packetCount; idx++) {
      const seq = idx + 1;
      const start = idx * MAX_CHUNK;
      const chunk = data.subarray(start, Math.min(start + MAX_CHUNK, data.length));

      let packetType: number;
      if (packetCount === 1) {
        packetType = 0x03; // start & end
      } else if (idx === 0) {
        packetType = 0x05; // start & partial
      } else if (idx === packetCount - 1) {
        packetType = 0x06; // partial & end
      } else {
        packetType = 0x04; // partial
      }

      const report = Buffer.alloc(64);
      report[0] = 0x01; // Report ID
      report[1] = ((seq & 0x0f) << 4) | packetType;
      report[2] = chunk.length;
      chunk.copy(report, 3);
      reports.push(report);
    }
    return reports;
  }

  private sendHIDReport(data: Buffer): void {
    if (!this.device) return;

    const reports = KNXUSBConnection.buildHIDReports(data);
    try {
      for (const report of reports) {
        this.device.write(report);
      }
    } catch (e) {
      this.logger.error("Failed to write to KNX USB device: " + e);
      this.handleError(e);
    }
  }

  async send(data: Buffer | CEMIInstance): Promise<void> {
    if (!this.isConnected || !this.device) {
      throw new Error("KNX USB device offline");
    }

    try {
      const wireData = this.prepareOutgoingCemi(data);
      const emiStandard = this.supportedEmiType === 0x01 ? "EMI1" : "EMI2/IMI2";
      let frame: Buffer | undefined;

      if (this.supportedEmiType === 0x03) {
        if (Buffer.isBuffer(wireData)) {
          frame = wireData;
        } else {
          frame = wireData.toBuffer();
        }
      } else {
        // EMI1 / EMI2 mode (Standard Frames only, max 15B APDU)
        let emiMsg: EMIInstance | null = null;
        if (Buffer.isBuffer(wireData)) {
          try {
            const parsedCemi = CEMI.fromBuffer(wireData);
            emiMsg = CEMIAdapter.cemiToEmi(parsedCemi, emiStandard);
            if (!emiMsg) {
              throw new Error(
                `KNX USB interface is in ${emiStandard} mode and cannot transmit Extended Frames (APDU > 15 octets, required for KNX Data Secure). Use a cEMI-capable USB interface.`,
              );
            }
            frame = emiMsg.toBuffer();
          } catch (e: any) {
            if (e?.message?.includes("Extended Frames")) throw e;
            frame = wireData;
          }
        } else {
          this.logger.debug(`Converting cEMI to ${emiStandard}`);
          emiMsg = CEMIAdapter.cemiToEmi(wireData, emiStandard);
          if (!emiMsg) {
            throw new Error(
              `KNX USB interface is in ${emiStandard} mode and cannot transmit Extended Frames (APDU > 15 octets, required for KNX Data Secure). Use a cEMI-capable USB interface.`,
            );
          }
          frame = emiMsg.toBuffer();
        }
      }

      if (frame) {
        let cemiObj: CEMIInstance | undefined = undefined;
        try {
          if (!Buffer.isBuffer(data)) {
            cemiObj = data;
          } else if (this.supportedEmiType === 0x03) {
            cemiObj = CEMI.fromBuffer(data);
          } else {
            cemiObj = CEMIAdapter.emiToCemi(data, emiStandard) || undefined;
          }
        } catch {
          /* empty */
        }

        if (cemiObj) {
          if (!this.isCacheDelegated) {
            try {
              GroupAddressCache.getInstance().processCEMI(cemiObj);
            } catch {
              /* empty */
            }
          }
          if (!this.isEventsDelegated && "destinationAddress" in cemiObj) {
            this.emit(cemiObj.destinationAddress, cemiObj);
          }
        }
        this.emit("send", frame);
        await this.sendUSBTransfer(0x01, this.supportedEmiType, frame);
      }
    } catch (err) {
      this.logger.error("Error sending to USB:" + err);
      throw err;
    }
  }

  private handleData(data: Buffer) {
    if (data.length < 3 || data[0] !== 0x01) return;

    const packetInfo = data[1];
    const seq = (packetInfo >> 4) & 0x0f;
    const packetType = packetInfo & 0x0f;
    const bodyLength = data[2];
    if (bodyLength > 61 || 3 + bodyLength > data.length) return;

    const chunk = data.subarray(3, 3 + bodyLength);

    // Multi-frame HID reassembly per KNX Standard 09_03 §3.4.1.2.2–§3.4.1.2.3
    if (packetType === 0x03) {
      // Single-frame packet (start & end): discard any stale incomplete multi-frame transfer
      this.rxFragments = [];
      this.rxExpectedSeq = 0;

      // Connection State Check based on knxd USBLowLevelDriver logic
      const wanted = Buffer.from([0x01, 0x13, 0x0a, 0x00, 0x08, 0x00, 0x02, 0x0f, 0x04, 0x00, 0x00, 0x03]);
      if (data.length >= 13 && data.subarray(0, 12).equals(wanted)) {
        const isConnectedToBus = (data[12] & 0x01) === 1;
        if (isConnectedToBus) {
          if (!this.busConnected) {
            this.busConnected = true;
            this.logger.info("KNX Bus Connected");
            this.emit("bus_connected");
          }
        } else {
          if (this.busConnected) {
            this.busConnected = false;
            this.logger.error("KNX Bus Disconnected");
            this.emit("bus_disconnected");
          }
        }
        return;
      }

      this.processTransferFrame(chunk);
      return;
    }

    if (packetType === 0x05) {
      // Start & partial packet (seq should be 1 per Fig. 14; tolerate 0 for non-compliant interfaces)
      if (seq !== 1 && seq !== 0) {
        this.rxFragments = [];
        this.rxExpectedSeq = 0;
        return;
      }
      this.rxFragments = [Buffer.from(chunk)];
      this.rxExpectedSeq = seq === 0 ? 0 : 2;
      return;
    }

    if (packetType === 0x04) {
      // Middle partial packet
      if (this.rxFragments.length === 0 || (this.rxExpectedSeq !== 0 && seq !== this.rxExpectedSeq)) {
        this.rxFragments = [];
        this.rxExpectedSeq = 0;
        return;
      }
      this.rxFragments.push(Buffer.from(chunk));
      if (this.rxExpectedSeq !== 0) this.rxExpectedSeq++;
      return;
    }

    if (packetType === 0x06) {
      // Partial & end packet
      if (this.rxFragments.length === 0 || (this.rxExpectedSeq !== 0 && seq !== this.rxExpectedSeq)) {
        this.rxFragments = [];
        this.rxExpectedSeq = 0;
        return;
      }
      this.rxFragments.push(Buffer.from(chunk));
      const fullTransferFrame = Buffer.concat(this.rxFragments);
      this.rxFragments = [];
      this.rxExpectedSeq = 0;
      this.processTransferFrame(fullTransferFrame);
    }
  }

  private processTransferFrame(buffer: Buffer) {
    if (buffer.length < 8) return;

    const headerLength = buffer[1];
    const bodyLength = buffer.readUInt16BE(2);
    const protocolId = buffer[4];
    const emiId = buffer[5];

    if (headerLength !== 0x08 || buffer.length < headerLength + bodyLength) return;

    const bodyStart = headerLength;
    const payload = buffer.subarray(bodyStart, bodyStart + bodyLength);

    if (protocolId === 0x0f && emiId === 0x02 && payload.length >= 3 && payload[0] === 0x01) {
      // EMI Discovery response (09_03 §3.5.3.3.2): bit 0 = EMI1, bit 1 = EMI2, bit 2 = cEMI
      // Prefer cEMI by default because Extended Frames (> 15B APDU) and KNX Data Secure require cEMI.
      const bitmask = payload[2];
      const preferred = this.options.preferredEmiType ?? "cEMI";
      let version = 0x03;

      if (preferred === "EMI1" && bitmask & 0x01) {
        version = 0x01;
      } else if (preferred === "EMI2" && bitmask & 0x02) {
        version = 0x02;
      } else if (bitmask & 0x04) {
        version = 0x03; // cEMI (recommended per 09_03 §3.4.2.2 & required for KNX Data Secure)
      } else if (bitmask & 0x02) {
        version = 0x02; // EMI2
      } else if (bitmask & 0x01) {
        version = 0x01; // EMI1
      } else {
        this.logger.warn(`EMI version bitmask 0x${bitmask.toString(16)} not recognized, defaulting to cEMI`);
        version = 0x03;
      }
      this.emit("emi_discovery", version);
      return;
    }

    if (protocolId === 0x01 && emiId === this.supportedEmiType) {
      if (payload.length > 0) {
        if (this.supportedEmiType === 0x03) {
          // Intercept M_PropRead.con (0xFB) for internal Local Device Management queries
          if (payload[0] === 0xfb && payload.length >= 7 && this.pendingPropReads.size > 0) {
            const objType = payload.readUInt16BE(1);
            const objInst = payload[3];
            const propId = payload[4];
            const key = `${objType}:${objInst}:${propId}`;
            const waiter = this.pendingPropReads.get(key);
            if (waiter) {
              const numElems = (payload[5] >> 4) & 0x0f;
              waiter(numElems > 0 ? Buffer.from(payload.subarray(7)) : null);
              return;
            }
          }

          // Intercept M_PropWrite.con (0xF5) for internal Local Device Management writes
          if (payload[0] === 0xf5 && payload.length >= 7 && this.pendingPropWrites.size > 0) {
            const objType = payload.readUInt16BE(1);
            const objInst = payload[3];
            const propId = payload[4];
            const key = `${objType}:${objInst}:${propId}`;
            const waiter = this.pendingPropWrites.get(key);
            if (waiter) {
              const numElems = (payload[5] >> 4) & 0x0f;
              const errorCode = numElems === 0 && payload.length >= 8 ? payload[7] : undefined;
              waiter({ ok: numElems > 0, errorCode });
              return;
            }
          }

          // cEMI
          try {
            const rawCemiMsg = CEMI.fromBuffer(payload);
            if (rawCemiMsg) {
              // Detect single-IA USB interface rewriting SA during KNX Data Secure TX
              if (
                rawCemiMsg.messageCode === 0x2e &&
                this.dataSecure &&
                !this.warnedSourceAddressMismatch &&
                "sourceAddress" in rawCemiMsg &&
                rawCemiMsg.sourceAddress !== "0.0.0" &&
                rawCemiMsg.sourceAddress !== this.individualAddress
              ) {
                this.warnedSourceAddressMismatch = true;
                this.logger.warn(
                  `KNX USB L_Data.con reported Source Address ${rawCemiMsg.sourceAddress} instead of ${this.individualAddress}. Match individualAddress & dataSecure.sourceAddress to ${rawCemiMsg.sourceAddress} so KNX Data Secure MAC verification succeeds.`,
                );
              }

              this.emit("raw_indication", payload);
              const cemiMsg = this.processIncomingCemi(rawCemiMsg);
              if (cemiMsg) {
                this.emit("indication", cemiMsg);
                if (!this.isCacheDelegated && "destinationAddress" in cemiMsg && "sourceAddress" in cemiMsg) {
                  GroupAddressCache.getInstance().processCEMI(
                    cemiMsg as InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>,
                  );
                }
                if (!this.isEventsDelegated && "destinationAddress" in cemiMsg) {
                  this.emit(cemiMsg.destinationAddress as string, cemiMsg);
                }
                try {
                  const emiMsg = CEMIAdapter.cemiToEmi(cemiMsg);
                  if (emiMsg) this.emit("indication_emi", emiMsg);
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                } catch (e) {
                  /* empty */
                }
              }
            }
          } catch (e: any) {
            this.logger.debug(`Error parsing incoming USB cEMI data: `, e);
          }
        } else {
          // EMI1 / EMI2
          const emiStandard = this.supportedEmiType === 0x01 ? "EMI1" : "EMI2/IMI2";
          try {
            const rawCemiMsg = CEMIAdapter.emiToCemi(payload, emiStandard);
            if (rawCemiMsg) {
              this.emit("raw_indication", payload);
              const cemiMsg = this.processIncomingCemi(rawCemiMsg);
              if (cemiMsg) {
                this.emit("indication", cemiMsg);
                if (!this.isCacheDelegated && "destinationAddress" in cemiMsg && "sourceAddress" in cemiMsg) {
                  GroupAddressCache.getInstance().processCEMI(
                    cemiMsg as InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>,
                  );
                }
                if (!this.isEventsDelegated && "destinationAddress" in cemiMsg) {
                  this.emit(cemiMsg.destinationAddress as string, cemiMsg);
                }
              }
            }
          } catch (e: any) {
            this.logger.debug(`Error parsing incoming USB ${emiStandard} data: ${e.message}`);
          }
        }
      }
    }
  }

  private handleError(err: any) {
    this.logger.error("KNX USB Error:", err);
    this.fsm.transition(KNXUSBEvent.ERROR);
    this.emit("error", err);
  }
}
