import { FrameKind, FrameType, Priority } from "../../core/enum/EnumControlField";
import { AddressType, ExtendedFrameFormat } from "../../core/enum/EnumControlFieldExtended";
import { APCIEnum } from "../../core/enum/APCIEnum";
import { KnxDataEncoder } from "../../core/data/KNXDataEncode";
import { TPCIType } from "../../core/layers/interfaces/TPCI";
import { AllDpts } from "../types/AllDpts";

export interface ControlFieldData {
  frameKind: FrameKind;
  frameType: FrameType;
  priority: Priority;
  repeat: boolean;
}
export interface ControlFieldExtendedData {
  addressType: AddressType;
  hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  extendedFrameFormat: ExtendedFrameFormat;
}
export interface WriteKNXTp {
  addressGroup: string;
  data: AllDpts<(typeof KnxDataEncoder.dptEnum)[number]>;
  dpt: (typeof KnxDataEncoder.dptEnum)[number];
}
export interface MsgInTask {
  msgType: "info" | "error" | "frame";
  data: unknown;
}
export interface L_Data_Standard {
  /** The Control field shall indicate the type of the request Frame: L_Data_Standard Frame L_Data_Extended Frame, L_Poll_Data request Frame or Acknowledgment Frame. */
  controlFieldData: ControlFieldData;
  /** Individual Address, Each device, i.e. a Router or an end device, shall have a unique Individual Address (IA) in a network. The Individual Address shall be a 2 octet value that shall consist of an 8 bit Subnetwork Address (SNA) and an 8 bit Device Address (DA). The Device Address shall be unique within a Subnetwork. Routers shall always have the Device Address zero, i.e. other devices may have the Device Addresses with values 1 to 255. */
  sourceAddr: string;
  /** The Group Address shall be a 2 octet value that does not need to be unique. A Device may have more than one Group Address. */
  groupAddress: string;
  /** The Destination Address (octets three and four) shall define the devices that shall receive the Frame. For an L_Data_Standard Frame, the Destination Address can be either an Individual Address (AT = 0) or a Group Address (AT = 1), depending on the Destination **Address Type (AT)** in octet five. */
  addressType: AddressType;
  /** Controls how many line repeaters or couplers (Line Couplers or Area Couplers) can retransmit the message. */
  hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Transport Layer Control Field */
  TPCIType: TPCIType;
  /** Application Layer Control Field */
  APCIType: APCIEnum;
  /** A Buffer from a DPT */
  data: Buffer;
}
export interface L_Data_Extended extends Omit<L_Data_Standard, "addressType" | "hopCount"> {
  /**
   * If the Frame Type flag FT = 1 in the CTRL field, an Extended Control field CTRLE shall follow on octet 1.
   * 
   * The CTRLE shall contain the Extended Frame format parameter EFF and the Hop Count parameter.
Bit 7 shall contain the Destination Address Type (AT) flag g/i. The AT shall only indicate the Address
Type and shall not point to a difference in the Frame Format.
   */
  controlFieldExtendedData: ControlFieldExtendedData;
}
