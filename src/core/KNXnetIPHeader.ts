import { KNXnetIPServiceType } from "./enum/KNXnetIPEnum";

export class KNXnetIPHeader {
  public static readonly HEADER_SIZE_10 = 0x06;
  public static readonly KNXNETIP_VERSION_10 = 0x10;

  constructor(
    public serviceType: KNXnetIPServiceType,
    public totalLength: number
  ) {}

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(6);
    buffer.writeUInt8(KNXnetIPHeader.HEADER_SIZE_10, 0);
    buffer.writeUInt8(KNXnetIPHeader.KNXNETIP_VERSION_10, 1);
    buffer.writeUInt16BE(this.serviceType, 2);
    buffer.writeUInt16BE(this.totalLength, 4);
    return buffer;
  }

  static fromBuffer(buffer: Buffer): KNXnetIPHeader {
    if (buffer.length < 6) {
      throw new Error("Buffer too short for KNXnet/IP Header");
    }
    const headerSize = buffer.readUInt8(0);
    const version = buffer.readUInt8(1);
    
    if (headerSize !== KNXnetIPHeader.HEADER_SIZE_10) {
      throw new Error(`Invalid Header Size: ${headerSize}`);
    }
    if (version !== KNXnetIPHeader.KNXNETIP_VERSION_10) {
      throw new Error(`Invalid Protocol Version: ${version}`);
    }

    const serviceType = buffer.readUInt16BE(2);
    const totalLength = buffer.readUInt16BE(4);

    return new KNXnetIPHeader(serviceType, totalLength);
  }
}
