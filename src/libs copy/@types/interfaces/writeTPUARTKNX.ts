import { KnxDataEncoder } from "../../data/KNXDataEncode";
import { AllDpts } from "../types/AllDpts";

export interface WriteKNXTp {
  addressGroup: string;
  data: AllDpts<typeof KnxDataEncoder.dptEnum[number]> | Error,
  dpt: typeof KnxDataEncoder.dptEnum[number]
}