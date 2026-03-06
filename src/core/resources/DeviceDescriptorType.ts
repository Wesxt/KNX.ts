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

}
