import { KnxDataDecode } from "../../core/data/KNXDataDecode";

type decode = typeof KnxDataDecode;
// #region Decoded Types

export type DecodedDPT1 = ReturnType<decode["asDpt1"]>;
export type DecodedDPT2 = ReturnType<decode["asDpt2"]>;
export type DecodedDPT3007 = ReturnType<decode["asDpt3007"]>;
export type DecodedDPT3008 = ReturnType<decode["asDpt3008"]>;
export type DecodedDPT6020 = ReturnType<decode["asDpt6020"]>;
export type DecodedDPT7012 = ReturnType<decode["asDpt7012"]>;
export type DecodedDPT10001 = ReturnType<decode["asDpt10001"]>;
export type DecodedDPT11001 = ReturnType<decode["asDpt11001"]>;
export type DecodedDPTValueUnit =
  | ReturnType<decode["asDpt12001"]>
  | ReturnType<decode["asDpt12002"]>;
export type DecodedDPT15000 = ReturnType<decode["asDpt15000"]>;
export type DecodedDPT16002 = ReturnType<decode["asDpt16002"]>;
export type DecodedDPT27001 = ReturnType<decode["asDpt27001"]>;
export type DecodedDPT232600 = ReturnType<decode["asDpt232600"]>;
export type DecodedDPT238600 = ReturnType<decode["asDpt238600"]>;
export type DecodedDPT245600 = ReturnType<decode["asDpt245600"]>;
export type DecodedDPT250600 = ReturnType<decode["asDpt250600"]>;
export type DecodedDPT251600 = ReturnType<decode["asDpt251600"]>;

export type DecodedDPTType<T extends number | string> = T extends
  | 1
  | "1"
  | `1.${number}`
  ? DecodedDPT1
  : T extends 2 | "2" | `2.${number}`
  ? DecodedDPT2
  : T extends 3007 | "3.007"
  ? DecodedDPT3007
  : T extends 3008 | "3.008"
  ? DecodedDPT3008
  : T extends 4001 | "4.001" | 4002 | "4.002" | 4 | "4" | `4.${number}`
  ? string
  : T extends 5001 | "5.001" | 5002 | "5.002"
  ? string
  : T extends 5 | "5" | `5.${number}`
  ? number
  : T extends 6001 | "6.001" | 6010 | "6.010"
  ? string
  : T extends 6020 | "6.020"
  ? DecodedDPT6020
  : T extends 6 | "6" | `6.${number}`
  ? number
  : T extends
  | 7001
  | "7.001"
  | 7002
  | "7.002"
  | 7003
  | "7.003"
  | 7004
  | "7.004"
  | 7005
  | "7.005"
  | 7006
  | "7.006"
  | 7007
  | "7.007"
  | 7011
  | "7.011"
  | 7013
  | "7.013"
  ? string
  : T extends 7012 | "7.012"
  ? DecodedDPT7012
  : T extends 7 | "7" | `7.${number}`
  ? number
  : T extends 8 | "8" | `8.${number}`
  ? number
  : T extends 9 | "9" | `9.${number}`
  ? number
  : T extends
  | 10001
  | "10.001"
  | 10
  | "10"
  | `10.${number}`
  ? DecodedDPT10001
  : T extends
  | 11001
  | "11.001"
  | 11
  | "11"
  | `11.${number}`
  ? DecodedDPT11001
  : T extends
  | 12001
  | "12.001"
  | 12002
  | "12.002"
  | 12
  | "12"
  | `12.${number}`
  ? DecodedDPTValueUnit
  : T extends
  | 13001
  | "13.001"
  | 13002
  | "13.002"
  | 13010
  | "13.010"
  | 13011
  | "13.011"
  | 13012
  | "13.012"
  | 13013
  | "13.013"
  | 13014
  | "13.014"
  | 13015
  | "13.015"
  | 13016
  | "13.016"
  | 13100
  | "13.100"
  ? DecodedDPTValueUnit
  : T extends 13 | "13" | `13.${number}`
  ? number
  : T extends 14 | "14" | `14.${number}`
  ? number
  : T extends
  | 15000
  | "15.000"
  | 15
  | "15"
  | `15.${number}`
  ? DecodedDPT15000
  : T extends 16002 | "16.002"
  ? DecodedDPT16002
  : T extends
  | 16
  | "16"
  | `16.${number}`
  ? string
  : T extends
  | 20001
  | "20.001"
  | 20002
  | "20.002"
  | 20003
  | "20.003"
  | 20004
  | "20.004"
  | 20005
  | "20.005"
  | 20006
  | "20.006"
  | 20007
  | "20.007"
  | 20008
  | "20.008"
  | 20011
  | "20.011"
  | 20012
  | "20.012"
  | 20013
  | "20.013"
  | 20014
  | "20.014"
  | 20017
  | "20.017"
  | 20020
  | "20.020"
  | 20021
  | "20.021"
  | 20022
  | "20.022"
  ? string
  : T extends
  | 20
  | "20"
  | `20.${number}`
  ? number
  : T extends
  | 27001
  | "27.001"
  | 27
  | "27"
  | `27.${number}`
  ? DecodedDPT27001
  : T extends
  | 28001
  | "28.001"
  | 28
  | "28"
  | `28.${number}`
  ? string
  : T extends
  | 29010
  | "29.010"
  | 29011
  | "29.011"
  | 29012
  | "29.012"
  | 29
  | "29"
  | `29.${number}`
  ? number
  : T extends
  | 232600
  | "232.600"
  ? DecodedDPT232600
  : T extends
  | 238600
  | "238.600"
  ? DecodedDPT238600
  : T extends
  | 245600
  | "245.600"
  ? DecodedDPT245600
  : T extends
  | 250600
  | "250.600"
  ? DecodedDPT250600
  : T extends
  | 251600
  | "251.600"
  ? DecodedDPT251600
  : any;
