export class DeviceDescriptorType0 {
  constructor(private _value: number) {
    if (_value < 0 || _value > 0xFFFF) {
      throw new Error(`Invalid Device Descriptor Type 0 value: ${_value}`);
    }
  }

  get value(): number {
    return this._value;
  }

  get maskType(): number {
    return (this._value >> 8) & 0xFF;
  }

  get mediumType(): number {
    return (this._value >> 12) & 0x0F;
  }

  get firmwareType(): number {
    return (this._value >> 8) & 0x0F;
  }

  get firmwareVersion(): number {
    return this._value & 0xFF;
  }

  get version(): number {
    return (this._value >> 4) & 0x0F;
  }

  get subcode(): number {
    return this._value & 0x0F;
  }

  static readonly TP1_BCU_1_SYSTEM_1_V0 = new DeviceDescriptorType0(0x0010);
  static readonly TP1_BCU_1_SYSTEM_1_V1 = new DeviceDescriptorType0(0x0011);
  static readonly TP1_BCU_1_SYSTEM_1_V2 = new DeviceDescriptorType0(0x0012);
  static readonly TP1_BCU_1_SYSTEM_1_V3 = new DeviceDescriptorType0(0x0013);
  static readonly TP1_BCU_2_SYSTEM_2_V0 = new DeviceDescriptorType0(0x0020);
  static readonly TP1_BCU_2_SYSTEM_2_V1 = new DeviceDescriptorType0(0x0021);
  static readonly TP1_BCU_2_SYSTEM_2_V5 = new DeviceDescriptorType0(0x0025);
  static readonly TP1_SYSTEM_300 = new DeviceDescriptorType0(0x0300);
  static readonly TP1_USB_INTERFACE_V1 = new DeviceDescriptorType0(0x0310);
  static readonly TP1_USB_INTERFACE_V2 = new DeviceDescriptorType0(0x0311);
  static readonly TP1_BIM_M112_V0 = new DeviceDescriptorType0(0x0700);
  static readonly TP1_BIM_M112_V1 = new DeviceDescriptorType0(0x0701);
  static readonly TP1_BIM_M112_V5 = new DeviceDescriptorType0(0x0705);
  static readonly TP1_SYSTEM_B = new DeviceDescriptorType0(0x07B0);
  static readonly TP1_IR_DECODER_V0 = new DeviceDescriptorType0(0x0810);
  static readonly TP1_IR_DECODER_V1 = new DeviceDescriptorType0(0x0811);
  static readonly TP1_COUPLER_1_0 = new DeviceDescriptorType0(0x0910);
  static readonly TP1_COUPLER_1_1 = new DeviceDescriptorType0(0x0911);
  static readonly TP1_COUPLER_1_2 = new DeviceDescriptorType0(0x0912);
  static readonly KNXNET_IP_ROUTER = new DeviceDescriptorType0(0x091A);
  static readonly TP1_NONE_FD = new DeviceDescriptorType0(0x0AFD);
  static readonly TP1_NONE_FE = new DeviceDescriptorType0(0x0AFE);
  static readonly PL110_BCU_1_V2 = new DeviceDescriptorType0(0x1012);
  static readonly PL110_BCU_1_V3 = new DeviceDescriptorType0(0x1013);
  static readonly PL110_USB_INTERFACE_V1 = new DeviceDescriptorType0(0x1310);
  static readonly PL110_USB_INTERFACE_V2 = new DeviceDescriptorType0(0x1311);
  static readonly PL110_SYSTEM_B = new DeviceDescriptorType0(0x17B0);
  static readonly TP1_PL110_MEDIA_COUPLER = new DeviceDescriptorType0(0x1900);
  static readonly RF_BI_DIRECTIONAL_DEVICES = new DeviceDescriptorType0(0x2010);
  static readonly RF_UNI_DIRECTIONAL_DEVICES = new DeviceDescriptorType0(0x2110);
  static readonly RF_USB_INTERFACE_V2 = new DeviceDescriptorType0(0x2311);
  static readonly TP0_BCU_1_V2 = new DeviceDescriptorType0(0x3012);
  static readonly PL132_BCU_1_V2 = new DeviceDescriptorType0(0x4012);
  static readonly KNX_IP_SYSTEM_7 = new DeviceDescriptorType0(0x5705);
  static readonly KNX_IP_SYSTEM_B = new DeviceDescriptorType0(0x57B0);

  private static readonly MASK_NAMES: Record<number, string> = {
    0x0001: "Dummy",
    0x0010: "TP1 BCU 1 (System 1) v0",
    0x0011: "TP1 BCU 1 (System 1) v1",
    0x0012: "TP1 BCU 1 (System 1) v2",
    0x0013: "TP1 BCU 1 (System 1) v3",
    0x0020: "TP1 BCU 2 (System 2) v0",
    0x0021: "TP1 BCU 2 (System 2) v1",
    0x0025: "TP1 BCU 2 (System 2) v5",
    0x0300: "TP1 System 300",
    0x0310: "TP1 cEMI Server / USB Interface v1",
    0x0311: "TP1 USB Interface v2",
    0x0700: "TP1 BIM M112 v0 (7.0)",
    0x0701: "TP1 BIM M112 v1 (7.1)",
    0x0705: "TP1 BIM M112 v5 (System 7 / 7.5)",
    0x07B0: "TP1 System B",
    0x0810: "TP1 IR Decoder v0",
    0x0811: "TP1 IR Decoder v1",
    0x0900: "TP1 Coupler 0900",
    0x0910: "TP1 Coupler 1.0 (0910)",
    0x0911: "TP1 Coupler 1.1 (0911)",
    0x0912: "TP1 Coupler 1.2 (0912)",
    0x091A: "KNXnet/IP Router (Coupler 091A)",
    0x0AFD: "TP1 None (0x0AFD)",
    0x0AFE: "TP1 None (0x0AFE)",
    0x1011: "PL110 BCU 1 v1",
    0x1012: "PL110 BCU 1 v2",
    0x1013: "PL110 BCU 1 v3",
    0x1310: "PL110 cEMI Server / USB Interface v1",
    0x1311: "PL110 USB Interface v2",
    0x17B0: "PL110 System B",
    0x1900: "TP1-PL110 Media Coupler (7.1 PL)",
    0x2010: "RF Bi-directional Devices",
    0x2110: "RF Uni-directional Devices",
    0x2311: "RF USB Interface v2",
    0x2705: "RF 7.5 (BIM M112)",
    0x27B0: "RF System B",
    0x2920: "Coupler 2920 (System B)",
    0x3012: "TP0 BCU 1 v2",
    0x4012: "PL132 BCU 1 v2",
    0x5705: "KNX IP System 7 (7.5 IP)",
    0x57B0: "KNX IP System B",
    0x6800: "IoT Point API",
    0x6900: "IoT Router",
  };

  private static readonly MEDIUM_NAMES: Record<number, string> = {
    0x0: "TP1",
    0x1: "PL110",
    0x2: "RF",
    0x3: "TP0",
    0x4: "PL132",
    0x5: "KNXnet/IP",
    0x6: "KNX IoT",
  };

  get name(): string | undefined {
    return DeviceDescriptorType0.getName(this._value);
  }

  get mediumName(): string {
    return DeviceDescriptorType0.MEDIUM_NAMES[this.mediumType] ?? `Medium(${this.mediumType})`;
  }

  static getName(value: number): string | undefined {
    return DeviceDescriptorType0.MASK_NAMES[value];
  }

  static describe(value: number): string {
    const known = DeviceDescriptorType0.MASK_NAMES[value];
    if (known) return known;
    const medium = DeviceDescriptorType0.MEDIUM_NAMES[(value >> 12) & 0x0f] ?? "Unknown Medium";
    return `${medium} (0x${value.toString(16).toUpperCase().padStart(4, "0")})`;
  }
}
