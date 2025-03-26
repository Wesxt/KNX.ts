import { KnxDataEncoder } from "../../data/KNXDataEncode";
import { DPT1, DPT2, DPT3, DPT4, DPT5, DPT5001, DPT5002, DPT6, DPT6020, DPT7, DPT8, DPT9, DPT10001, DPT11001, DPT12001, DPT13001, DPT14, DPT15, DPT16, DPT16002, DPT20, DPT27001, DPT28001, DPT238600, DPT245600, DPT250600, DPT251600, DPT29 } from "../interfaces/DPTs";

// #region Type dinamic of all DPTs
export type AllDpts<Dpt extends (typeof KnxDataEncoder.dptEnum)[number] | null> = Dpt extends 1
  ? DPT1
  : Dpt extends 2
    ? DPT2
    : Dpt extends 3007 | 3008
      ? DPT3
      : Dpt extends 4001 | 4
        ? DPT4
        : Dpt extends 5
          ? DPT5
          : Dpt extends 5001
            ? DPT5001
            : Dpt extends 5002
              ? DPT5002
              : Dpt extends 6 | 6010
                ? DPT6
                : Dpt extends 6020
                  ? DPT6020
                  : Dpt extends 7 | 7001 | 7002 | 7003 | 7004 | 7005 | 7006 | 7007 | 7011 | 7012 | 7013
                    ? DPT7
                    : Dpt extends 8
                      ? DPT8
                      : Dpt extends 9
                        ? DPT9
                        : Dpt extends 10001
                          ? DPT10001
                          : Dpt extends 11001
                            ? DPT11001
                            : Dpt extends 12 | 12001 | 12100 | 12101 | 12102
                              ? DPT12001
                              : Dpt extends 13 | 13001 | 13002 | 13010 | 13011 | 13012 | 13013 | 13014 | 13015 | 13016 | 13100
                                ? DPT13001
                                : Dpt extends 14
                                  ? DPT14
                                  : Dpt extends 15
                                    ? DPT15
                                    : Dpt extends 16
                                      ? DPT16
                                      : Dpt extends 16002
                                        ? DPT16002
                                        : Dpt extends
                                              | 20
                                              | 20001
                                              | 20002
                                              | 20003
                                              | 20004
                                              | 20005
                                              | 20006
                                              | 20007
                                              | 20008
                                              | 20011
                                              | 20012
                                              | 20013
                                              | 20014
                                              | 20017
                                              | 20020
                                              | 20021
                                              | 20022
                                          ? DPT20
                                          : Dpt extends 27001
                                            ? DPT27001
                                            : Dpt extends 28001
                                              ? DPT28001
                                              : Dpt extends 29 ? DPT29 : Dpt extends 238600
                                                ? DPT238600
                                                : Dpt extends 245600
                                                  ? DPT245600
                                                  : Dpt extends 250600
                                                    ? DPT250600
                                                    : Dpt extends 251600
                                                      ? DPT251600
                                                      : Buffer;
// #endregion