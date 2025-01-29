export class DataPointTranslator {
  constructor() {}
  FromDataPoint(type: string, data: Buffer): any {
    switch (type) {
      case "1": // Switch (1 Bit)
        return data[0] & 1;
      case "3": // Dimming (4 Bit)
        return (data[0] & 0b01111000) >> 3;
      case "9": // Floating point (2 Byte)
        return this.fromDPT9(data);
      case "5": // 8-bit unsigned value
      case "5.001": // Percentage (0...100)
        return data[0];
      case "7": // 16-bit unsigned value
        return data.readUInt16BE(0);
      case "8": // 16-bit signed value
        return data.readInt16BE(0);
      case "10": // Time (3 Byte)
        return this.fromDPT10(data);
      case "11": // Date (3 Byte)
        return this.fromDPT11(data);
      case "14": // IEEE 754 Floating point (4 Byte)
        return data.readFloatBE(0);
      case "12": // 32-bit unsigned value
        return data.readUInt32BE(0);
      case "13": // 32-bit signed value
        return data.readInt32BE(0);
      case "16": // 14 character ASCII
        return data.toString("ascii").trim();
      case "24": // Unlimited string (8859_1)
        return data.toString("latin1").trim();
      case "232": // List 3-byte value (RGB)
        return { red: data[0], green: data[1], blue: data[2] };
      default:
        throw new Error(`DPT ${type} no soportado.`);
    }
  }
  ToDataPoint(type: string, value: any): Buffer {
    switch (type) {
      case "1": // Switch (1 Bit)
        return Buffer.from([value ? 1 : 0]);
      case "3": // Dimming (4 Bit)
        return Buffer.from([(value << 3) & 0b01111000]);
      case "9": // Floating point (2 Byte)
        return this.toDPT9(value);
      case "5": // 8-bit unsigned value
      case "5.001": // Percentage (0...100)
        return Buffer.from([value]);
      case "7": // 16-bit unsigned value
        const buf7 = Buffer.alloc(2);
        buf7.writeUInt16BE(value);
        return buf7;
      case "8": // 16-bit signed value
        const buf8 = Buffer.alloc(2);
        buf8.writeInt16BE(value);
        return buf8;
      case "10": // Time (3 Byte)
        return this.toDPT10(value);
      case "11": // Date (3 Byte)
        return this.toDPT11(value);
      case "14": // IEEE 754 Floating point (4 Byte)
        const buf14 = Buffer.alloc(4);
        buf14.writeFloatBE(value);
        return buf14;
      case "12": // 32-bit unsigned value
        const buf12 = Buffer.alloc(4);
        buf12.writeUInt32BE(value);
        return buf12;
      case "13": // 32-bit signed value
        const buf13 = Buffer.alloc(4);
        buf13.writeInt32BE(value);
        return buf13;
      case "16": // 14 character ASCII
        return Buffer.from(value.padEnd(14).slice(0, 14), "ascii");
      case "24": // Unlimited string (8859_1)
        return Buffer.from(value, "latin1");
      case "232": // List 3-byte value (RGB)
        return Buffer.from([value.red, value.green, value.blue]);
      default:
        throw new Error(`DPT ${type} no soportado.`);
    }
  }
  // DPT 9: 2-Byte Float
  private fromDPT9(data: Buffer): number {
    const sign = (data[0] & 0x80) >> 7;
    const exponent = (data[0] & 0x78) >> 3;
    let mantissa = ((data[0] & 0x07) << 8) | data[1];
    if (sign === 1) mantissa = -(~mantissa & 0x07FF) - 1;
    return mantissa * Math.pow(2, exponent) * 0.01;
  }
  private toDPT9(value: number): Buffer {
    const buf = Buffer.alloc(2);
    const sign = value < 0 ? 1 : 0;
    const absValue = Math.abs(value) / 0.01;
    const exponent = Math.floor(Math.log2(absValue) - 10);
    const mantissa = Math.round(absValue / Math.pow(2, exponent));
    buf[0] = (sign << 7) | ((exponent & 0x0F) << 3) | ((mantissa >> 8) & 0x07);
    buf[1] = mantissa & 0xFF;
    return buf;
  }
  // DPT 10: Time (3 Byte)
  private fromDPT10(data: Buffer): string {
    const hours = data[0] & 0x1F;
    const minutes = data[1] & 0x3F;
    const seconds = data[2] & 0x3F;
    return `${hours}:${minutes}:${seconds}`;
  }
  private toDPT10(time: string): Buffer {
    const [hours, minutes, seconds] = time.split(":").map((t) => parseInt(t, 10));
    return Buffer.from([hours & 0x1F, minutes & 0x3F, seconds & 0x3F]);
  }
  // DPT 11: Date (3 Byte)
  private fromDPT11(data: Buffer): string {
    const day = data[0] & 0x1F;
    const month = data[1] & 0x0F;
    const year = 1900 + (data[2] & 0x7F);
    return `${year}-${month}-${day}`;
  }
  private toDPT11(date: string): Buffer {
    const [year, month, day] = date.split("-").map((d) => parseInt(d, 10));
    return Buffer.from([day & 0x1F, month & 0x0F, (year - 1900) & 0x7F]);
  }
}
