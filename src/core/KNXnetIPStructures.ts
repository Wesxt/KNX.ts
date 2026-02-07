import { HostProtocolCode, ConnectionType } from "./enum/KNXnetIPEnum";
import { DescriptionType, KNXMedium } from "./enum/KNXnetIPEnum";

export class HPAI {
  constructor(
    public hostProtocol: HostProtocolCode,
    public ipAddress: string,
    public port: number,
  ) {}

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt8(0x08, 0); // Structure Length
    buffer.writeUInt8(this.hostProtocol, 1);

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
    public connectionType: ConnectionType,
    public knxLayer: number = 0x02, // Tunnel Link Layer
    public unused: number = 0x00,
  ) {}

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt8(0x04, 0); // Length
    buffer.writeUInt8(this.connectionType, 1);
    buffer.writeUInt8(this.knxLayer, 2);
    buffer.writeUInt8(this.unused, 3);
    return buffer;
  }
}

export class CRD {
  constructor(
    public connectionType: ConnectionType,
    public knxAddress: number,
  ) {}

  static fromBuffer(buffer: Buffer): CRD {
    if (buffer.length < 4) throw new Error("Buffer too short for CRD");
    // Length at 0
    const connectionType = buffer.readUInt8(1);
    const knxAddress = buffer.readUInt16BE(2);
    return new CRD(connectionType, knxAddress);
  }
}

export class RoutingBusy {
  constructor(
    public deviceState: number,
    public waitTime: number,
    public controlField: number = 0x0000,
  ) {}

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(6);
    buffer.writeUInt8(0x06, 0); // Structure Length
    buffer.writeUInt8(this.deviceState, 1);
    buffer.writeUInt16BE(this.waitTime, 2);
    buffer.writeUInt16BE(this.controlField, 4);
    return buffer;
  }

  static fromBuffer(buffer: Buffer): RoutingBusy {
    if (buffer.length < 6) throw new Error("Buffer too short for RoutingBusy");
    const deviceState = buffer.readUInt8(1);
    const waitTime = buffer.readUInt16BE(2);
    const controlField = buffer.readUInt16BE(4);
    return new RoutingBusy(deviceState, waitTime, controlField);
  }
}

export class RoutingLostMessage {
  constructor(
    public deviceState: number,
    public lostMessages: number,
  ) {}

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
  constructor(public type: DescriptionType) {}
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
    public deviceStatus: number,
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
    // Implementation omitted for brevity in this direction as mostly read by client
    return Buffer.alloc(0);
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
    // Friendly name is 30 bytes fixed, null terminated
    const nameBuf = buffer.subarray(24, 54);
    const nullByte = nameBuf.indexOf(0x00);
    const name = nameBuf.subarray(0, nullByte === -1 ? 30 : nullByte).toString("utf-8");

    return new DeviceInformationDIB(medium, status, address, projId, serial, multicast, mac, name);
  }
}

export class SupportedServicesDIB extends DIB {
  constructor(public services: { family: number; version: number }[]) {
    super(DescriptionType.SUPP_SVC_FAMILIES);
  }

  toBuffer(): Buffer {
    return Buffer.alloc(0);
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

export class MfrDataDIB extends DIB {
  constructor(
    public manufacturerId: number,
    public data: Buffer,
  ) {
    super(DescriptionType.MFR_DATA);
  }
  toBuffer(): Buffer {
    return Buffer.alloc(0);
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
    ) {}
  
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
