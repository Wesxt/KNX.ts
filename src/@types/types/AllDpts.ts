import { KnxDataEncoder } from "../../core/data/KNXDataEncode";
import {
  DPT1,
  DPT2,
  DPT3,
  DPT4,
  DPT5,
  DPT5001,
  DPT5002,
  DPT6,
  DPT6020,
  DPT7,
  DPT8,
  DPT9,
  DPT10001,
  DPT11001,
  DPT12001,
  DPT13001,
  DPT14,
  DPT15,
  DPT16,
  DPT16002,
  DPT20,
  DPT27001,
  DPT28001,
  DPT238600,
  DPT245600,
  DPT250600,
  DPT251600,
  DPT29,
} from "../interfaces/DPTs";

// #region Type dinamic of all DPTs
export type AllDpts<Dpt extends (typeof KnxDataEncoder.dptEnum)[number] | string | null> =
  Dpt extends 1 | "1" | `1.${number}` ? DPT1 :
  Dpt extends 2 | "2" | `2.${number}` ? DPT2 :
  Dpt extends 3007 | "3.007" | 3008 | "3.008" ? DPT3 :
  Dpt extends 4001 | "4.001" | 4 | "4" | `4.${number}` ? DPT4 :
  // Specific DPT 5 subtypes
  Dpt extends 5001 | "5.001" ? DPT5001 :
  Dpt extends 5002 | "5.002" ? DPT5002 :
  Dpt extends 5 | "5" | `5.${number}` ? DPT5 :
  // Specific DPT 6 subtypes
  Dpt extends 6020 | "6.020" ? DPT6020 :
  Dpt extends 6 | "6" | 6010 | "6.010" | `6.${number}` ? DPT6 :
  // Specific DPT 7 subtypes (all map to DPT7 interface for now)
  Dpt extends 7 | "7" | `7.${number}` ? DPT7 :
  Dpt extends 8 | "8" | `8.${number}` ? DPT8 :
  Dpt extends 9 | "9" | `9.${number}` ? DPT9 :
  Dpt extends 10001 | "10.001" | 10 | "10" | `10.${number}` ? DPT10001 :
  Dpt extends 11001 | "11.001" | 11 | "11" | `11.${number}` ? DPT11001 :
  // DPT 12
  Dpt extends 12 | "12" | `12.${number}` ? DPT12001 :
  // DPT 13
  Dpt extends 13 | "13" | `13.${number}` ? DPT13001 :
  Dpt extends 14 | "14" | `14.${number}` ? DPT14 :
  Dpt extends 15 | "15" | `15.${number}` ? DPT15 :
  Dpt extends 16002 | "16.002" ? DPT16002 :
  Dpt extends 16 | "16" | `16.${number}` ? DPT16 :
  // DPT 20
  Dpt extends 20 | "20" | `20.${number}` ? DPT20 :
  Dpt extends 27001 | "27.001" | 27 | "27" | `27.${number}` ? DPT27001 :
  Dpt extends 28001 | "28.001" | 28 | "28" | `28.${number}` ? DPT28001 :
  Dpt extends 29 | "29" | `29.${number}` ? DPT29 :
  Dpt extends 238600 | "238.600" ? DPT238600 :
  Dpt extends 245600 | "245.600" ? DPT245600 :
  Dpt extends 250600 | "250.600" ? DPT250600 :
  Dpt extends 251600 | "251.600" ? DPT251600 :
  Buffer;
// #endregion