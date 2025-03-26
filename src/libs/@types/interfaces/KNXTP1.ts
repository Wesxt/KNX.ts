import { FrameKind, FrameType, Priority } from "../../data/enum/KNXEnumControlField";
import { AddressType, ExtendedFrameFormat } from "../../data/enum/KNXEnumControlFieldExtended";
import { KnxDataEncoder } from "../../data/KNXDataEncode";
import { AllDpts } from "../types/AllDpts";

export interface ControlFieldData {
  frameKind: FrameKind,
  frameType: FrameType,
  priority: Priority,
  repeat: boolean
}
export interface ControlFieldExtendedData {
  addressType: AddressType,
  hopCount: number,
  extendedFrameFormat: ExtendedFrameFormat
}
export interface WriteKNXTp {
  addressGroup: string;
  data: AllDpts<typeof KnxDataEncoder.dptEnum[number]>,
  dpt: typeof KnxDataEncoder.dptEnum[number]
}
export interface MsgInTask {
  msgType: "info" | "error" | "frame",
  data: unknown
}