import { HostProtocolCode, ConnectionType, TunnelLink } from "./enum/KNXnetIPEnum";
import { DescriptionType, KNXMedium } from "./enum/KNXnetIPEnum";
import { DeviceDescriptorType0 } from "./resources/DeviceDescriptorType";

export class HPAI {
  constructor(
    private _hostProtocol: HostProtocolCode = HostProtocolCode.IPV4_UDP,
    private _ipAddress: string,
    private _port: number = 3671,
  ) { }

  set protocol(proto: HostProtocolCode) {
    this._hostProtocol = proto;
  }

  get protocol(): HostProtocolCode {
    return this._hostProtocol;
  }

  set port(port: number) {
    if (
      isNaN(port) ||
      typeof port !== 'number' ||
      port < 0 ||
      port > 65535
    ) {
      throw new Error(`Invalid port ${port}`);
    }
    this._port = port;
  }

  get port(): number {
    return this._port;
  }

  set ipAddress(host: string) {
    if (host == null) {
      throw new Error('Host undefined');
    }
    const m = host.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (m === null) {
      throw new Error(`Invalid host format - ${host}`);
    }
    this._ipAddress = host;
  }

  get ipAddress(): string {
    return this._ipAddress;
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt8(0x08, 0); // Structure Length
    buffer.writeUInt8(this._hostProtocol, 1);

    const ipParts = this.ipAddress.split(".").map(Number);
    if (ipParts.length !== 4) throw new Error("Invalid IP Address");

    buffer.writeUInt8(ipParts[0], 2);
    buffer.writeUInt8(ipParts[1], 3);
    buffer.writeUInt8(ipParts[2], 4);
    buffer.writeUInt8(ipParts[3], 5);

    buffer.writeUInt16BE(this.port, 6);
    return buffer;
  }

  static fromBuffer(buffer: Buffer): HPAI {
    if (buffer.length < 8) throw new Error("Buffer too short for HPAI");
    const hostProtocol = buffer.readUInt8(1);
    const ipAddress = `${buffer[2]}.${buffer[3]}.${buffer[4]}.${buffer[5]}`;
    const port = buffer.readUInt16BE(6);

    return new HPAI(hostProtocol, ipAddress, port);
  }

  static get NULL_HPAI(): HPAI {
    return new HPAI(HostProtocolCode.IPV4_UDP, "0.0.0.0", 0);
  }
}

export class CRI {
  constructor(
    public connectionType: ConnectionType = ConnectionType.TUNNEL_CONNECTION,
    public knxLayer: number = TunnelLink.TUNNEL_LINKLAYER, // Tunnel Link Layer
    public individualAddress: number | null = null,
  ) { }

  toBuffer(): Buffer {
    const len = this.individualAddress !== null ? 6 : 4;
    const buffer = Buffer.alloc(len);
    buffer.writeUInt8(len, 0); // Length
    buffer.writeUInt8(this.connectionType, 1);
    buffer.writeUInt8(this.knxLayer, 2);
    buffer.writeUInt8(0, 3);
    if (this.individualAddress !== null) {
      buffer.writeUInt16BE(this.individualAddress, 4);
    }
    return buffer;
  }

  static fromBuffer(buffer: Buffer): CRI {
    if (buffer.length < 2) throw new Error("Buffer too short for CRI");
    const len = buffer.readUInt8(0);
    const connectionType = buffer.readUInt8(1);
    if (len === 2) {
      return new CRI(connectionType);
    }
    if (buffer.length < 4) throw new Error("Buffer too short for CRI");
    const knxLayer = buffer.readUInt8(2);
    // const unused = buffer.readUInt8(3);
    let individualAddress: number | null = null;
    if (len === 6 && buffer.length >= 6) {
      individualAddress = buffer.readUInt16BE(4);
    }
    return new CRI(connectionType, knxLayer, individualAddress);
  }
}

export class CRD {
  constructor(
    public connectionType: ConnectionType,
    public knxAddress: number = 0,
  ) { }

  static fromBuffer(buffer: Buffer): CRD {
    if (buffer.length < 2) throw new Error("Buffer too short for CRD");
    const len = buffer.readUInt8(0);
    const connectionType = buffer.readUInt8(1);
    if (len === 2) {
      return new CRD(connectionType);
    }
    // Spec says CRD for Tunneling is 4 bytes and contains IA
    if (buffer.length < 4) throw new Error("Buffer too short for CRD");
    const knxAddress = buffer.readUInt16BE(2);
    return new CRD(connectionType, knxAddress);
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt8(0x04, 0);
    buffer.writeUInt8(this.connectionType, 1);
    buffer.writeUInt16BE(this.knxAddress, 2);
    return buffer;
  }
}

export class RoutingBusy {
  constructor(
    public deviceState: number,
    public waitTime: number = 100,
    public routingBusyControl: number = 0x0000,
  ) { }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(6);
    buffer.writeUInt8(0x04, 0); // Structure Length
    buffer.writeUInt8(this.deviceState, 1);
    buffer.writeUInt16BE(this.waitTime, 2);
    buffer.writeUInt16BE(this.routingBusyControl, 4);
    return buffer;
  }

  static fromBuffer(buffer: Buffer): RoutingBusy {
    if (buffer.length < 6) throw new Error("Buffer too short for RoutingBusy");
    const deviceState = buffer.readUInt8(1);
    const waitTime = buffer.readUInt16BE(2);
    const routingBusyControl = buffer.readUInt16BE(4);
    return new RoutingBusy(deviceState, waitTime, routingBusyControl);
  }
}

export class RoutingLostMessage {
  constructor(
    public deviceState: number,
    public lostMessages: number,
  ) { }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt8(0x04, 0); // Structure Length
    buffer.writeUInt8(this.deviceState, 1);
    buffer.writeUInt16BE(this.lostMessages, 2);
    return buffer;
  }

  static fromBuffer(buffer: Buffer): RoutingLostMessage {
    if (buffer.length < 4) throw new Error("Buffer too short for RoutingLostMessage");
    const deviceState = buffer.readUInt8(1);
    const lostMessages = buffer.readUInt16BE(2);
    return new RoutingLostMessage(deviceState, lostMessages);
  }
}

// --- DIB Structures ---

export abstract class DIB {
  constructor(public type: DescriptionType) { }
  abstract toBuffer(): Buffer;

  static fromBuffer(buffer: Buffer): DIB {
    const len = buffer.readUInt8(0);
    const type = buffer.readUInt8(1);
    const data = buffer.subarray(0, len);

    switch (type) {
      case DescriptionType.DEVICE_INFO:
        return DeviceInformationDIB.fromBuffer(data);
      case DescriptionType.SUPP_SVC_FAMILIES:
        return SupportedServicesDIB.fromBuffer(data);
      case DescriptionType.IP_CONFIG:
        return IPConfigDIB.fromBuffer(data);
      case DescriptionType.IP_CUR_CONFIG:
        return IPCurrentConfigDIB.fromBuffer(data);
      case DescriptionType.TUNNELLING_INFO:
        return TunnellingInfoDIB.fromBuffer(data);
      case DescriptionType.DEVICE_INFO_EXTENDED:
        return ExtendedDeviceInformationDIB.fromBuffer(data);
      case DescriptionType.MFR_DATA:
        return MfrDataDIB.fromBuffer(data);
      default:
        return new UnknownDIB(type, data);
    }
  }
}

export class DeviceInformationDIB extends DIB {
  constructor(
    public knxMedium: KNXMedium,
    public deviceStatus: 1 | 0 | number,
    public individualAddress: number,
    public projectInstallationId: number,
    public serialNumber: Buffer,
    public routingMulticastAddress: string,
    public macAddress: string,
    public friendlyName: string,
  ) {
    super(DescriptionType.DEVICE_INFO);
  }

  toBuffer(): Buffer {
    const nameBuf = Buffer.from(this.friendlyName, "latin1");
    const nameLength = Math.min(nameBuf.length, 30);
    const buffer = Buffer.alloc(54);

    buffer.writeUInt8(24 + nameLength, 0); // Length
    buffer.writeUInt8(this.type, 1);
    buffer.writeUInt8(this.knxMedium, 2);
    buffer.writeUInt8(this.deviceStatus, 3);
    buffer.writeUInt16BE(this.individualAddress, 4);
    buffer.writeUInt16BE(this.projectInstallationId, 6);
    this.serialNumber.copy(buffer, 8);

    const mcast = this.routingMulticastAddress.split(".").map(Number);
    buffer.writeUInt8(mcast[0], 14);
    buffer.writeUInt8(mcast[1], 15);
    buffer.writeUInt8(mcast[2], 16);
    buffer.writeUInt8(mcast[3], 17);

    const mac = this.macAddress.replace(/[:\-]/g, "");
    Buffer.from(mac, "hex").copy(buffer, 18);

    nameBuf.copy(buffer, 24, 0, nameLength);

    return buffer;
  }

  static fromBuffer(buffer: Buffer): DeviceInformationDIB {
    const medium = buffer.readUInt8(2);
    const status = buffer.readUInt8(3);
    const address = buffer.readUInt16BE(4);
    const projId = buffer.readUInt16BE(6);
    const serial = buffer.subarray(8, 14);
    const multicast = `${buffer[14]}.${buffer[15]}.${buffer[16]}.${buffer[17]}`;
    const mac = buffer
      .subarray(18, 24)
      .toString("hex")
      .match(/.{1,2}/g)!
      .join(":");

    const nameBuf = buffer.subarray(24);
    const nullByte = nameBuf.indexOf(0x00);
    const name = nameBuf.subarray(0, nullByte === -1 ? 30 : nullByte).toString("latin1");

    return new DeviceInformationDIB(medium, status, address, projId, serial, multicast, mac, name);
  }
}

export class IPConfigDIB extends DIB {
  constructor(
    public ipAddress: string,
    public subnetMask: string,
    public defaultGateway: string,
    public ipCapabilities: number,
    public ipAssignmentMethod: number,
  ) {
    super(DescriptionType.IP_CONFIG);
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(16);
    buffer.writeUInt8(16, 0);
    buffer.writeUInt8(this.type, 1);

    const ip = this.ipAddress.split(".").map(Number);
    const mask = this.subnetMask.split(".").map(Number);
    const gw = this.defaultGateway.split(".").map(Number);

    for (let i = 0; i < 4; i++) {
      buffer.writeUInt8(ip[i], 2 + i);
      buffer.writeUInt8(mask[i], 6 + i);
      buffer.writeUInt8(gw[i], 10 + i);
    }

    buffer.writeUInt8(this.ipCapabilities, 14);
    buffer.writeUInt8(this.ipAssignmentMethod, 15);
    return buffer;
  }

  static fromBuffer(buffer: Buffer): IPConfigDIB {
    const ip = `${buffer[2]}.${buffer[3]}.${buffer[4]}.${buffer[5]}`;
    const mask = `${buffer[6]}.${buffer[7]}.${buffer[8]}.${buffer[9]}`;
    const gw = `${buffer[10]}.${buffer[11]}.${buffer[12]}.${buffer[13]}`;
    const caps = buffer.readUInt8(14);
    const method = buffer.readUInt8(15);
    return new IPConfigDIB(ip, mask, gw, caps, method);
  }
}

export class IPCurrentConfigDIB extends DIB {
  constructor(
    public ipAddress: string,
    public subnetMask: string,
    public defaultGateway: string,
    public dhcpServer: string,
    public ipAssignmentMethod: number,
  ) {
    super(DescriptionType.IP_CUR_CONFIG);
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(20);
    buffer.writeUInt8(20, 0);
    buffer.writeUInt8(this.type, 1);

    const ip = this.ipAddress.split(".").map(Number);
    const mask = this.subnetMask.split(".").map(Number);
    const gw = this.defaultGateway.split(".").map(Number);
    const dhcp = this.dhcpServer.split(".").map(Number);

    for (let i = 0; i < 4; i++) {
      buffer.writeUInt8(ip[i], 2 + i);
      buffer.writeUInt8(mask[i], 6 + i);
      buffer.writeUInt8(gw[i], 10 + i);
      buffer.writeUInt8(dhcp[i], 14 + i);
    }

    buffer.writeUInt8(this.ipAssignmentMethod, 18);
    buffer.writeUInt8(0, 19); // Reserved
    return buffer;
  }

  static fromBuffer(buffer: Buffer): IPCurrentConfigDIB {
    const ip = `${buffer[2]}.${buffer[3]}.${buffer[4]}.${buffer[5]}`;
    const mask = `${buffer[6]}.${buffer[7]}.${buffer[8]}.${buffer[9]}`;
    const gw = `${buffer[10]}.${buffer[11]}.${buffer[12]}.${buffer[13]}`;
    const dhcp = `${buffer[14]}.${buffer[15]}.${buffer[16]}.${buffer[17]}`;
    const method = buffer.readUInt8(18);
    return new IPCurrentConfigDIB(ip, mask, gw, dhcp, method);
  }
}

export class StatusTunnelingSlot {
  private _value: number;

  constructor(initialValue: number = 0xFFF8) {
    this._value = initialValue;
  }

  get value(): number {
    return this._value;
  }

  get usable(): boolean {
    return (this._value & 0x0004) !== 0;
  }

  set usable(v: boolean) {
    if (v) {
      this._value |= 0x0004; // Set bit 2
    } else {
      this._value &= ~0x0004; // Clear bit 2
    }
  }

  get authorised(): boolean {
    return (this._value & 0x0002) !== 0;
  }

  set authorised(v: boolean) {
    if (v) {
      this._value |= 0x0002; // Set bit 1
    } else {
      this._value &= ~0x0002; // Clear bit 1
    }
  }

  get free(): boolean {
    return (this._value & 0x0001) !== 0;
  }

  set free(v: boolean) {
    if (v) {
      this._value |= 0x0001; // Set bit 0
    } else {
      this._value &= ~0x0001; // Clear bit 0
    }
  }
}


export class TunnellingInfoDIB extends DIB {
  constructor(
    public apduLength: number = 508,
    public slots: { address: number; status: StatusTunnelingSlot; }[] = []
  ) {
    super(DescriptionType.TUNNELLING_INFO);
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(4 + this.slots.length * 4);
    buffer.writeUInt8(buffer.length, 0);
    buffer.writeUInt8(this.type, 1);
    buffer.writeUInt16BE(this.apduLength, 2);
    let offset = 4;
    for (const slot of this.slots) {
      buffer.writeUInt16BE(slot.address, offset);
      buffer.writeUInt16BE(slot.status.value, offset + 2);
      offset += 4;
    }
    return buffer;
  }

  static fromBuffer(buffer: Buffer): TunnellingInfoDIB {
    const apduLength = buffer.readUInt16BE(2);
    const slots = [];
    for (let i = 4; i < buffer.length; i += 4) {
      slots.push({
        address: buffer.readUInt16BE(i),
        status: new StatusTunnelingSlot(buffer.readUInt16BE(i + 2))
      });
    }
    return new TunnellingInfoDIB(apduLength, slots);
  }
}

export class ExtendedDeviceInformationDIB extends DIB {
  constructor(
    mediumStatus: boolean = false,
    public maximalLocalApduLength: number = 508,
    public deviceDescriptorType0: DeviceDescriptorType0 = DeviceDescriptorType0.KNXNET_IP_ROUTER,
  ) {
    super(DescriptionType.DEVICE_INFO_EXTENDED);
    this.mediumStatus = mediumStatus;
  }

  private _mediumStatus: number = 0;


  /**
   * Indicates whether or not
   * communication is possible using the
   * medium connection represented by this
   * Router Object.
   * 
   * - 0: FALSE: communication is possible
   * - 1: TRUE: communication is impossible
   */
  get mediumStatus(): number {
    return this._mediumStatus;
  }

  /**
   * Indicates whether or not
   * communication is possible using the
   * medium connection represented by this
   * Router Object.
   * 
   * - 0: FALSE: communication is possible
   * - 1: TRUE: communication is impossible
   */
  set mediumStatus(v: boolean) {
    this._mediumStatus = v ? 1 : 0;
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt8(8, 0); // Structure Length
    buffer.writeUInt8(this.type, 1);
    buffer.writeUInt8(this.mediumStatus, 2);
    buffer.writeUInt8(0, 3); // Reserved
    buffer.writeUInt16BE(this.maximalLocalApduLength, 4);
    buffer.writeUInt16BE(this.deviceDescriptorType0.value, 6);
    return buffer;
  }

  static fromBuffer(buffer: Buffer): ExtendedDeviceInformationDIB {
    const mediumStatus = buffer.readUInt8(2);
    const maximalLocalApduLength = buffer.readUInt16BE(4);
    const deviceDescriptorType0 = buffer.readUInt16BE(6);
    return new ExtendedDeviceInformationDIB(!!mediumStatus, maximalLocalApduLength, new DeviceDescriptorType0(deviceDescriptorType0));
  }
}

export class SupportedServicesDIB extends DIB {
  constructor(public services: { family: number; version: number; }[]) {
    super(DescriptionType.SUPP_SVC_FAMILIES);
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(2 + this.services.length * 2);
    buffer.writeUInt8(buffer.length, 0);
    buffer.writeUInt8(this.type, 1);
    let offset = 2;
    for (const svc of this.services) {
      buffer.writeUInt8(svc.family, offset++);
      buffer.writeUInt8(svc.version, offset++);
    }
    return buffer;
  }

  static fromBuffer(buffer: Buffer): SupportedServicesDIB {
    const len = buffer.readUInt8(0);
    const services = [];
    // Data starts at 2
    for (let i = 2; i < len; i += 2) {
      if (i + 1 < len) {
        services.push({
          family: buffer.readUInt8(i),
          version: buffer.readUInt8(i + 1),
        });
      }
    }
    return new SupportedServicesDIB(services);
  }
}

export class KNXAddressesDIB extends DIB {
  constructor(
    public knxIndividualAddress: number,
    public additionalIndividualAddresses: number[] = []
  ) {
    super(DescriptionType.KNX_ADDRESSES);
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(4 + this.additionalIndividualAddresses.length * 2);
    buffer.writeUInt8(buffer.length, 0); // Structure Length
    buffer.writeUInt8(this.type, 1);     // Description Type Code
    buffer.writeUInt16BE(this.knxIndividualAddress, 2);

    let offset = 4;
    for (const addr of this.additionalIndividualAddresses) {
      buffer.writeUInt16BE(addr, offset);
      offset += 2;
    }

    return buffer;
  }

  static fromBuffer(buffer: Buffer): KNXAddressesDIB {
    const len = buffer.readUInt8(0);
    const knxIndividualAddress = buffer.readUInt16BE(2);
    const additionalIndividualAddresses: number[] = [];

    for (let i = 4; i < len; i += 2) {
      if (i + 1 < len) {
        additionalIndividualAddresses.push(buffer.readUInt16BE(i));
      }
    }

    return new KNXAddressesDIB(knxIndividualAddress, additionalIndividualAddresses);
  }
}

export class MfrDataDIB extends DIB {
  constructor(
    public manufacturerId: number,
    public data: Buffer,
  ) {
    super(DescriptionType.MFR_DATA);
  }
  toBuffer(): Buffer {
    const buffer = Buffer.alloc(4 + this.data.length);
    buffer.writeUInt8(buffer.length, 0);
    buffer.writeUInt8(this.type, 1);
    buffer.writeUInt16BE(this.manufacturerId, 2);
    this.data.copy(buffer, 4);
    return buffer;
  }

  static fromBuffer(buffer: Buffer): MfrDataDIB {
    const mfrId = buffer.readUInt16BE(2);
    const data = buffer.subarray(4);
    return new MfrDataDIB(mfrId, data);
  }
}

export class UnknownDIB extends DIB {
  constructor(
    type: number,
    public rawData: Buffer,
  ) {
    super(type);
  }
  toBuffer(): Buffer { return this.rawData; }
}

export class SRP {
  constructor(
    public type: number,
    public data: Buffer,
    public isMandatory: boolean = true
  ) { }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(2 + this.data.length);
    buffer.writeUInt8(buffer.length, 0);
    // Type + Mandatory bit (bit 7)
    let typeByte = this.type;
    if (this.isMandatory) typeByte |= 0x80;
    buffer.writeUInt8(typeByte, 1);
    this.data.copy(buffer, 2);
    return buffer;
  }

  static fromBuffer(buffer: Buffer): SRP {
    const len = buffer.readUInt8(0);
    const type = buffer.readUInt8(1);
    const data = buffer.subarray(2, len);
    return new SRP(type & 0x7F, data, (type & 0x80) !== 0);
  }
}
