import { format } from "util";
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
  DPT11001,
  DPT12001,
  DPT29,
  DPT251600,
  DPT10001,
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
} from "../../@types/interfaces/DPTs";
import { AllDpts } from "../../@types/types/AllDpts";

export class KnxDataEncoder {
  private typeErrorData = new TypeError("The object does not contain valid parameters to encode the dpt");
  private allPropertiesTypeVerify(
    data: Object,
    type: "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function",
  ) {
    if (typeof data !== "object")
      throw new TypeError("The parameter 'data' is not object", { cause: format("%s", data) });
    return Object.values(data).every((item) => typeof item === type);
  }
  // #region Method for encoding dpts
  encodeThis<T extends (typeof KnxDataEncoder.dptEnum)[number] | null>(dpt: T, data: AllDpts<T>) {
    switch (dpt) {
      case 1:
        if ("value" in data && typeof data.value === "boolean") return this.encodeDpt1(data as DPT1);
        break;
      case 2:
        if ("control" in data && "valueDpt2" in data && this.allPropertiesTypeVerify(data, "number"))
          return this.encodeDpt2(data as DPT2);
        break;
      case 3007:
        if ("control" in data && "stepCode" in data && this.allPropertiesTypeVerify(data, "number"))
          return this.encodeDpt3007(data as DPT3);
        break;
      case 3008:
        if ("control" in data && "stepCode" in data && this.allPropertiesTypeVerify(data, "number"))
          return this.encodeDpt3008(data as DPT3);
        break;
      case 4001:
        if ("char" in data && typeof data.char === "string") return this.encodeDpt4001(data as DPT4);
        break;
      case 5:
        if ("valueDpt5" in data && typeof data.valueDpt5 === "number" && data.valueDpt5 <= 255 && data.valueDpt5 >= 0)
          return this.encodeDpt5(data as DPT5);
        break;
      case 5001:
        if (
          "valueDpt5001" in data &&
          typeof data.valueDpt5001 === "number" &&
          data.valueDpt5001 <= 100 &&
          data.valueDpt5001 >= 0
        )
          return this.encodeDpt5001(data as DPT5001);
        break;
      case 5002:
        if ("valueDpt5002" in data && typeof data.valueDpt5002 === "number") return this.encodeDpt5002(data as DPT5002);
        break;
      case 6:
        if ("valueDpt6" in data && typeof data.valueDpt6 === "number") return this.encodeDpt6(data as DPT6);
        break;
      case 6010:
        if ("valueDpt6" in data && typeof data.valueDpt6 === "number") return this.encodeDpt6(data as DPT6);
        break;
      case 6020:
        if ("status" in data && "mode" in data) return this.encodeDpt6020(data as DPT6020);
        break;
      case 7:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7(data as DPT7);
        break;
      case 7001:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7001(data as DPT7);
        break;
      case 7002:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7002(data as DPT7);
        break;
      case 7003:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7003(data as DPT7);
        break;
      case 7004:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7004(data as DPT7);
        break;
      case 7005:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7005(data as DPT7);
        break;
      case 7006:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7006(data as DPT7);
        break;
      case 7007:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7007(data as DPT7);
        break;
      case 7011:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7011(data as DPT7);
        break;
      case 7012:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7012(data as DPT7);
        break;
      case 7013:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return this.encodeDpt7013(data as DPT7);
        break;
      case 8:
        if ("valueDpt8" in data && typeof data.valueDpt8 === "number") return this.encodeDpt8(data as DPT8);
        break;
      case 9:
        if ("valueDpt9" in data && typeof data.valueDpt9 === "number") return this.encodeDpt9(data as DPT9);
        break;
      case 10001:
        if (
          "day" in data &&
          "hour" in data &&
          "minutes" in data &&
          "seconds" in data &&
          Object.values(data).every((item) => typeof item === "number")
        )
          return this.encodeDpt10001(data);
        break;
      case 11001:
        if (
          "day" in data &&
          "month" in data &&
          "year" in data &&
          Object.values(data).every((item) => typeof item === "number")
        )
          return this.encodeDpt11001(data as DPT11001);
        break;
      case 12:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number")
          return this.encodeDpt12001(data as DPT12001);
        break;
      case 12001:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number")
          return this.encodeDpt12001(data as DPT12001);
        break;
      case 12100:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number")
          return this.encodeDpt12001(data as DPT12001);
        break;
      case 12101:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number")
          return this.encodeDpt12001(data as DPT12001);
        break;
      case 12102:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number")
          return this.encodeDpt12001(data as DPT12001);
        break;
      case 13001:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13001(data);
        break;
      case 13002:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13002(data);
        break;
      case 13010:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13010(data);
        break;
      case 13011:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13011(data);
        break;
      case 13012:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13012(data);
        break;
      case 13013:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13013(data);
        break;
      case 13014:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13014(data);
        break;
      case 13015:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13015(data);
        break;
      case 13016:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13016(data);
        break;
      case 13100:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return this.encodeDpt13100(data);
        break;
      case 14:
        if ("valueDpt14" in data && typeof data.valueDpt14 === "number") return this.encodeDpt14(data);
        break;
      case 15:
        if (
          "D6" in data &&
          "D5" in data &&
          "D4" in data &&
          "D3" in data &&
          "D2" in data &&
          "D1" in data &&
          "E" in data &&
          "P" in data &&
          "D" in data &&
          "c" in data &&
          "index" in data &&
          Object.values(data).every((item) => typeof item === "number")
        ) {
          return this.encodeDpt15(data);
        }
        break;
      case 16:
        if ("text" in data && typeof data.text === "string") return this.encodeDpt16(data);
        break;
      case 16002:
        if ("hex" in data && typeof data.hex === "number") return this.encodeDpt16002(data);
        break;
      case 20:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20(data);
        break;
      case 20001:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20001(data);
        break;
      case 20002:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20002(data);
        break;
      case 20003:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20003(data);
        break;
      case 20004:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20004(data);
        break;
      case 20005:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20005(data);
        break;
      case 20006:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20006(data);
        break;
      case 20007:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20007(data);
        break;
      case 20008:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20008(data);
        break;
      case 20011:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20011(data);
        break;
      case 20012:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20012(data);
        break;
      case 20013:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20013(data);
        break;
      case 20014:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20014(data);
        break;
      case 20017:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20017(data);
        break;
      case 20020:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20020(data);
        break;
      case 20021:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20021(data);
        break;
      case 20022:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return this.encodeDpt20022(data);
        break;
      case 27001:
        if ("mask" in data && "status" in data && this.allPropertiesTypeVerify(data, "number"))
          return this.encodeDpt27001(data);
        break;
      case 28001:
        if ("textDpt28001" in data && typeof data.textDpt28001 === "string") return this.encodeDpt28001(data);
        break;
      case 29:
        if ("valueDpt29" in data && typeof data.valueDpt29 === "bigint") return this.encodeDpt29(data as DPT29);
        break;
      case 238600:
        if ("BF" in data && "LF" in data && "Addr" in data && this.allPropertiesTypeVerify(data, "number"))
          return this.encodeDpt238600(data);
        break;
      case 245600:
        if (
          "LTRF" in data &&
          "LTRD" in data &&
          "LTRP" in data &&
          "SF" in data &&
          "SD" in data &&
          "SP" in data &&
          "LDTR" in data &&
          "LPDTR" in data &&
          this.allPropertiesTypeVerify(data, "number")
        )
          return this.encodeDpt245600(data);
        break;
      case 250600:
        if (
          "cCt" in data &&
          "stepCodeCT" in data &&
          "cB" in data &&
          "stepCodeB" in data &&
          "validCT" in data &&
          "validB" in data &&
          this.allPropertiesTypeVerify(data, "number")
        )
          return this.encodeDpt250600(data);
        break;
      case 251600:
        if (
          "R" in data &&
          "G" in data &&
          "B" in data &&
          "W" in data &&
          "mR" in data &&
          "mG" in data &&
          "mB" in data &&
          "mW" in data &&
          this.allPropertiesTypeVerify(data, "number")
        )
          return this.encodeDpt251600(data as DPT251600);
        break;
      default:
        throw this.typeErrorData;
    }
    throw this.typeErrorData;
  }
  // #endregion
  encodeThisOnlyVerify<T extends (typeof KnxDataEncoder.dptEnum)[number] | null>(
    dpt: T,
    data: AllDpts<T>,
  ): typeof data | Error {
    switch (dpt) {
      case 1:
        if ("value" in data && typeof data.value === "boolean") return data;
        break;
      case 2:
        if ("control" in data && "valueDpt2" in data && this.allPropertiesTypeVerify(data, "number")) return data;
        break;
      case 3007:
        if ("control" in data && "stepCode" in data && this.allPropertiesTypeVerify(data, "number")) return data;
        break;
      case 3008:
        if ("control" in data && "stepCode" in data && this.allPropertiesTypeVerify(data, "number")) return data;
        break;
      case 4001:
        if ("char" in data && typeof data.char === "string") return data;
        break;
      case 5:
        if ("valueDpt5" in data && typeof data.valueDpt5 === "number" && data.valueDpt5 <= 255 && data.valueDpt5 >= 0)
          return data;
        break;
      case 5001:
        if (
          "valueDpt5001" in data &&
          typeof data.valueDpt5001 === "number" &&
          data.valueDpt5001 <= 100 &&
          data.valueDpt5001 >= 0
        )
          return data;
        break;
      case 5002:
        if ("valueDpt5002" in data && typeof data.valueDpt5002 === "number") return data;
        break;
      case 6:
        if ("valueDpt6" in data && typeof data.valueDpt6 === "number") return data;
        break;
      case 6010:
        if ("valueDpt6" in data && typeof data.valueDpt6 === "number") return data;
        break;
      case 6020:
        if ("status" in data && "mode" in data) return data;
        break;
      case 7:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7001:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7002:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7003:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7004:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7005:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7006:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7007:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7011:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7012:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 7013:
        if ("valueDpt7" in data && typeof data.valueDpt7 === "number") return data;
        break;
      case 8:
        if ("valueDpt8" in data && typeof data.valueDpt8 === "number") return data;
        break;
      case 9:
        if ("valueDpt9" in data && typeof data.valueDpt9 === "number") return data;
        break;
      case 10001:
        if (
          "day" in data &&
          "hour" in data &&
          "minutes" in data &&
          "seconds" in data &&
          Object.values(data).every((item) => typeof item === "number")
        )
          return data;
        break;
      case 11001:
        if (
          "day" in data &&
          "month" in data &&
          "year" in data &&
          Object.values(data).every((item) => typeof item === "number")
        )
          return data;
        break;
      case 12:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number") return data;
        break;
      case 12001:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number") return data;
        break;
      case 12100:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number") return data;
        break;
      case 12101:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number") return data;
        break;
      case 12102:
        if ("valueDpt12001" in data && typeof data.valueDpt12001 === "number") return data;
        break;
      case 13001:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 13002:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 13010:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 13011:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 13012:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 13013:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 13014:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 13015:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 13016:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 13100:
        if ("valueDpt13001" in data && typeof data.valueDpt13001 === "number") return data;
        break;
      case 14:
        if ("valueDpt14" in data && typeof data.valueDpt14 === "number") return data;
        break;
      case 15:
        if (
          "D6" in data &&
          "D5" in data &&
          "D4" in data &&
          "D3" in data &&
          "D2" in data &&
          "D1" in data &&
          "E" in data &&
          "P" in data &&
          "D" in data &&
          "c" in data &&
          "index" in data &&
          Object.values(data).every((item) => typeof item === "number")
        ) {
          return data;
        }
        break;
      case 16:
        if ("text" in data && typeof data.text === "string") return data;
        break;
      case 16002:
        if ("hex" in data && typeof data.hex === "number") return data;
        break;
      case 20:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20001:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20002:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20003:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20004:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20005:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20006:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20007:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20008:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20011:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20012:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20013:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20014:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20017:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20020:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20021:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 20022:
        if ("valueDpt20" in data && typeof data.valueDpt20 === "number") return data;
        break;
      case 27001:
        if ("mask" in data && "status" in data && this.allPropertiesTypeVerify(data, "number")) return data;
        break;
      case 28001:
        if ("textDpt28001" in data && typeof data.textDpt28001 === "string") return data;
        break;
      case 29:
        if ("valueDpt29" in data && typeof data.valueDpt29 === "bigint") return data;
        break;
      case 238600:
        if ("BF" in data && "LF" in data && "Addr" in data && this.allPropertiesTypeVerify(data, "number")) return data;
        break;
      case 245600:
        if (
          "LTRF" in data &&
          "LTRD" in data &&
          "LTRP" in data &&
          "SF" in data &&
          "SD" in data &&
          "SP" in data &&
          "LDTR" in data &&
          "LPDTR" in data &&
          this.allPropertiesTypeVerify(data, "number")
        )
          return data;
        break;
      case 250600:
        if (
          "cCt" in data &&
          "stepCodeCT" in data &&
          "cB" in data &&
          "stepCodeB" in data &&
          "validCT" in data &&
          "validB" in data &&
          this.allPropertiesTypeVerify(data, "number")
        )
          return data;
        break;
      case 251600:
        if (
          "R" in data &&
          "G" in data &&
          "B" in data &&
          "W" in data &&
          "mR" in data &&
          "mG" in data &&
          "mB" in data &&
          "mW" in data &&
          this.allPropertiesTypeVerify(data, "number")
        )
          return data;
        break;
      default:
        throw this.typeErrorData;
    }
    throw this.typeErrorData;
  }

  // #region DPTEnum
  static get dptEnum() {
    return [
      1, 2, 3007, 3008, 4001, 5, 5001, 5002, 6, 6001, 6010, 6020, 7, 7001, 7002, 7003, 7004, 7005, 7006, 7007, 7011,
      7012, 7013, 8, 9, 10001, 11001, 12, 12001, 12100, 12101, 12102, 13001, 13002, 13010, 13011, 13012, 13013, 13014,
      13015, 13016, 13100, 14, 15, 16, 16002, 20, 20001, 20002, 20003, 20004, 20005, 20006, 20007, 20008, 20011, 20012,
      20013, 20014, 20017, 20020, 20021, 20022, 27001, 28001, 29, 238600, 245600, 250600, 251600,
    ] as const;
  }
  // #endregion
  /**
   * Codifica un valor booleano en DPT1.
   * Retorna un ArrayBuffer de 1 byte.
   */
  encodeDpt1({ value }: DPT1) {
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    // Se codifica 0x01 si es true, 0x00 si es false.
    view.setUint8(0, value ? 0x01 : 0x00);
    return Buffer.from(buffer);
  }

  /**
   * Codifica DPT2, que utiliza 2 bits: un bit de control y otro de valor.
   * Los parámetros deben ser 0 o 1.
   * Retorna un ArrayBuffer de 1 byte.
   */
  encodeDpt2({ control, valueDpt2 }: DPT2) {
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    // Se codifica en los 2 bits menos significativos.
    view.setUint8(0, (control << 1) | valueDpt2);
    return Buffer.from(buffer);
  }

  /**
   * Codifica DPT3007: Formato B1U3 (4 bits).
   * - control: 0 (Decrease) o 1 (Increase)
   * - stepCode: de 0 a 7 (0 = Break; 1..7 = número de intervalos según 2^(stepCode-1))
   *
   * Retorna un ArrayBuffer de 1 byte, utilizando el nibble inferior.
   */
  encodeDpt3007({ control, stepCode }: DPT3) {
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    // El nibble se compone: bit 3 = control, bits 0-2 = stepCode.
    view.setUint8(0, (control << 3) | (stepCode & 0x07));
    return Buffer.from(buffer);
  }

  /**
   * Codifica DPT3008: Formato B1U3 para control de persianas/ventanas.
   * - control: 0 (Up) o 1 (Down)
   * - stepCode: de 0 a 7 (0 = Break; 1..7 = número de intervalos)
   *
   * Retorna un ArrayBuffer de 1 byte.
   */
  encodeDpt3008({ control, stepCode }: DPT3) {
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    view.setUint8(0, (control << 3) | (stepCode & 0x07));
    return Buffer.from(buffer);
  }

  /**
   * Codifica DPT4001: DPT_Char_ASCII.
   * Se espera un único carácter (con MSB = 0, valor entre 0 y 127).
   * Retorna un ArrayBuffer de 1 byte.
   */
  encodeDpt4001({ char }: DPT4) {
    if (char.length !== 1) {
      throw new Error("Only one character allowed");
    }
    const code = char.charCodeAt(0);
    if (code & 0x80) {
      throw new Error("Character out of ASCII range (MSB must be 0)");
    }
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    view.setUint8(0, code);
    return Buffer.from(buffer);
  }
  /**
   * DPT5: 1 byte unsigned (0…255)
   */
  encodeDpt5({ valueDpt5: value }: DPT5): Buffer {
    if (value < 0 || value > 255) throw new Error("DPT5 value must be between 0 and 255");
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(value, 1);
    return buffer;
  }

  /**
   * DPT5001: Percentage (0–100) codificado en escala 0–255
   */
  encodeDpt5001({ valueDpt5001: value }: DPT5001): Buffer {
    const encodedValue = Math.round((value / 100) * 255);
    return this.encodeDpt5({ valueDpt5: encodedValue });
  }

  /**
   * DPT5002: Angle (0–360°) codificado en escala 0–255
   */
  encodeDpt5002({ valueDpt5002: value }: DPT5002): Buffer {
    const encodedValue = Math.round((value / 360) * 255);
    return this.encodeDpt5({ valueDpt5: encodedValue });
  }

  /**
   * DPT6: 1 byte signed (-128…127)
   */
  encodeDpt6({ valueDpt6: value }: DPT6): Buffer {
    if (value < -128 || value > 127) throw new Error("DPT6 value must be between -128 and 127");
    const buffer = Buffer.alloc(2);
    buffer.writeInt8(value, 1);
    return buffer;
  }

  /**
   * DPT6001: Se codifica igual que DPT6 (por ejemplo, porcentaje expresado en valor numérico)
   */
  encodeDpt6001({ valueDpt6: value }: DPT6): Buffer {
    return this.encodeDpt6({ valueDpt6: value });
  }

  /**
   * DPT6010: Counter pulses, codificado igual que DPT6
   */
  encodeDpt6010({ valueDpt6: value }: DPT6): Buffer {
    return this.encodeDpt6({ valueDpt6: value });
  }

  /**
   * DPT6020: Estado y modo en 1 byte:
   * Los 5 bits superiores (status) y los 3 bits inferiores (mode)
   */
  encodeDpt6020({ status, mode }: DPT6020): Buffer {
    const byte = (status << 3) | (mode & 0b111);
    const data = Buffer.alloc(2);
    data[1] = byte;
    return data;
  }

  /**
   * DPT7: 2-byte unsigned (0…65535)
   */
  encodeDpt7({ valueDpt7: value }: DPT7): Buffer {
    if (value <= 0 || value >= 65535) throw new Error("DPT7 value must be between 0 and 65535");
    const buffer = Buffer.alloc(3);
    buffer.writeUInt16BE(value, 1);
    return buffer;
  }

  /**
   * DPT7001: Pulses (igual que DPT7)
   */
  encodeDpt7001(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7002: Time in ms (igual que DPT7)
   */
  encodeDpt7002(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7003: Time in seconds (valor en segundos escalado multiplicando por 100)
   */
  encodeDpt7003({ valueDpt7: value }: DPT7): Buffer {
    const scaled = Math.round(value * 100);
    return this.encodeDpt7({ valueDpt7: scaled });
  }

  /**
   * DPT7004: Time in seconds (valor en segundos escalado multiplicando por 10)
   */
  encodeDpt7004({ valueDpt7: value }: DPT7): Buffer {
    const scaled = Math.round(value * 10);
    return this.encodeDpt7({ valueDpt7: scaled });
  }

  /**
   * DPT7005: Time in seconds (igual que DPT7)
   */
  encodeDpt7005(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7006: Time in minutes (igual que DPT7)
   */
  encodeDpt7006(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7007: Time in hours (igual que DPT7)
   */
  encodeDpt7007(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7011: Distance in mm (igual que DPT7)
   */
  encodeDpt7011(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7012: Bus power supply current in mA (igual que DPT7)
   */
  encodeDpt7012(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * DPT7013: Light intensity in lux (igual que DPT7)
   */
  encodeDpt7013(data: DPT7): Buffer {
    return this.encodeDpt7({ valueDpt7: data.valueDpt7 });
  }

  /**
   * Codifica un valor de 2 octetos (DPT8) en notación de complemento a dos.
   * Rango: [-32768 … 32767]
   *
   * @param param0 Objeto con la propiedad value a codificar.
   * @returns Buffer con el valor codificado en 2 octetos (big-endian).
   */
  encodeDpt8({ valueDpt8 }: DPT8): Buffer {
    if (valueDpt8 < -32768 || valueDpt8 > 32767) {
      throw new Error("DPT8 value must be between -32768 and 32767");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeInt16BE(valueDpt8, 0);
    return buffer;
  }

  encodeDpt9({ valueDpt9 }: DPT9): Buffer {
    // 1. Manejo de seguridad para valores no numéricos
    if (isNaN(valueDpt9) || !isFinite(valueDpt9)) {
      return Buffer.from([0x7f, 0xff]);
    }

    // 2. Cálculo inicial de la mantisa según la fórmula: Float = (0.01 * M) * 2^E
    // Despejamos M inicial (con E=0): M = Value / 0.01
    let m = valueDpt9 / 0.01;
    let e = 0;

    // 3. Normalización: M debe estar en el rango [-2048, 2047]
    // Si se sale, aumentamos el exponente (E) y dividimos M por 2
    while ((m > 2047 || m < -2048) && e < 15) {
      m /= 2;
      e++;
    }

    // Redondeo final para evitar errores de precisión de punto flotante
    let mInt = Math.round(m);

    // 4. Protección contra el valor "Invalid Data" (0x7FFF)
    // El máximo valor positivo permitido es M=2046 si E=15
    if (e === 15 && mInt > 2046) {
      mInt = 2046;
    }

    // 5. Empaquetado de bits
    // El bit de signo (S) es el bit 11 de la mantisa.
    // mInt & 0x7FF extrae los 11 bits en formato complemento a dos automáticamente.
    const mEncoded = mInt & 0x7ff;
    const sign = mInt < 0 ? 1 : 0;

    // Ensamblaje según: S | EEEE | MMMMMMMMMM (11 bits de M)
    // Nota: El MSB de mEncoded (bit 10) es el signo, pero KNX lo quiere en el bit 15.
    const encoded = (sign << 15) | (e << 11) | (mEncoded & 0x7ff);

    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(encoded, 0);
    return buffer;
  }

  /**
   * Codifica DPT10001 (Time of Day) en 3 octetos.
   *
   * Estructura:
   *  - Octeto 1: bits 7-5 = Day (3 bits), bits 4-0 = Hour (5 bits)
   *  - Octeto 2: bits 7-6 = reserved (0), bits 5-0 = Minutes (6 bits)
   *  - Octeto 3: bits 7-6 = reserved (0), bits 5-0 = Seconds (6 bits)
   *
   * Rango:
   *  - Day: 0 a 7
   *  - Hour: 0 a 23
   *  - Minutes: 0 a 59
   *  - Seconds: 0 a 59
   *
   * @param param0 Objeto con day, hour, minutes y seconds.
   * @returns Buffer con los 3 octetos codificados.
   */
  encodeDpt10001({ day, hour, minutes, seconds }: DPT10001): Buffer {
    // Validar rangos:
    if (day < 0 || day > 7) {
      throw new Error("Day must be between 0 and 7");
    }
    if (hour < 0 || hour > 23) {
      throw new Error("Hour must be between 0 and 23");
    }
    if (minutes < 0 || minutes > 59) {
      throw new Error("Minutes must be between 0 and 59");
    }
    if (seconds < 0 || seconds > 59) {
      throw new Error("Seconds must be between 0 and 59");
    }

    const buffer = Buffer.alloc(3);

    // Octeto 1: Day en bits 7-5 y Hour en bits 4-0.
    // day ocupa 3 bits (0-7) y se coloca desplazado 5 bits a la izquierda.
    // hour ocupa 5 bits (0-23).
    buffer[0] = ((day & 0x07) << 5) | (hour & 0x1f);

    // Octeto 2: Bits 7-6 reservados (0), Bits 5-0: Minutes
    buffer[1] = minutes & 0x3f; // 0x3F = 0b00111111

    // Octeto 3: Bits 7-6 reservados (0), Bits 5-0: Seconds
    buffer[2] = seconds & 0x3f;

    return buffer;
  }
  /**
   * Codifica DPT11001 (Date) en 3 octetos.
   *
   * Formato: 3 octetos: r3U5  r4U4  r1U7
   *   - Octeto 3 (MSB): 3 bits reservados (0) y 5 bits para el día (1–31)
   *   - Octeto 2: 4 bits reservados (0) y 4 bits para el mes (1–12)
   *   - Octeto 1 (LSB): 1 bit reservado (0) y 7 bits para el año (0–99)
   *       * Si el valor codificado en el campo Year es ≥ 90, se interpreta como 1900 + valor.
   *       * Si es < 90, se interpreta como 2000 + valor.
   *
   * @param param0 Objeto con { day, month, year }.
   *               - day: número del día (1 a 31)
   *               - month: número del mes (1 a 12)
   *               - year: año completo (entre 1990 y 2089)
   * @returns Buffer de 3 octetos con el dato codificado en orden MSB a LSB.
   */
  encodeDpt11001({ day, month, year }: DPT11001): Buffer {
    // Validación de rangos
    if (day < 1 || day > 31) {
      throw new Error("Day must be between 1 and 31");
    }
    if (month < 1 || month > 12) {
      throw new Error("Month must be between 1 and 12");
    }
    if (year < 1990 || year > 2089) {
      throw new Error("Year must be between 1990 and 2089");
    }

    // Codificar el año en 7 bits:
    // Si el año es menor a 2000, se codifica como (year - 1900) (valores 90–99)
    // Si el año es 2000 o mayor, se codifica como (year - 2000) (valores 0–89)
    let encodedYear: number;
    if (year < 2000) {
      encodedYear = year - 1900; // Ejemplo: 1999 → 99
    } else {
      encodedYear = year - 2000; // Ejemplo: 2004 → 4
    }

    // Construir cada octeto según la numeración de la especificación:
    // Octeto 3 (MSB): r3 (reservado 0) + U5 (día)
    const octet3 = (day & 0x1f) ^ 0x80; // 5 bits para el día
    // Octeto 2: r4 (reservado 0) + U4 (mes)
    const octet2 = month & 0x0f; // 4 bits para el mes
    // Octeto 1 (LSB): r1 (reservado 0) + U7 (año)
    const octet1 = encodedYear & 0x7f; // 7 bits para el año

    // Retornar el Buffer en el orden: [Octeto3, Octeto2, Octeto1] (de MSB a LSB)
    return Buffer.from([octet3, octet2, octet1]);
  }

  /**
   * Codifica DPT 12.001: DPT_Value_4_Ucount
   * Formato: 4 octetos (U32)
   * Rango: [0 ... 4 294 967 295]
   * Uso: counter pulses, resolución 1 pulse.
   *
   * @param param0 Objeto con { value }
   * @returns Buffer de 4 octetos con el valor codificado.
   */
  encodeDpt12001({ valueDpt12001 }: DPT12001): Buffer {
    if (valueDpt12001 < 0 || valueDpt12001 > 0xffffffff) {
      throw new Error("DPT 12.001 value must be between 0 and 4294967295");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeUInt32BE(valueDpt12001, 1);
    return buffer;
  }
  /**
   * Codifica DPT 12.100: DPT_LongTimePeriod_Sec
   * Formato: 4 octetos (U32)
   * Rango: [0 ... 4 294 967 295]
   * Uso: Operative hours en segundos, 1 s de resolución.
   *
   * @param param0 Objeto con { value } representando segundos.
   * @returns Buffer de 4 octetos con el valor codificado.
   */
  encodeDpt12100({ valueDpt12001 }: DPT12001): Buffer {
    return this.encodeDpt12001({ valueDpt12001 });
  }

  /**
   * Codifica DPT 12.101: DPT_LongTimePeriod_Min
   * Formato: 4 octetos (U32)
   * Rango: [0 ... 4 294 967 295]
   * Uso: Operative hours en minutos, 1 min de resolución.
   *
   * @param param0 Objeto con { value } representando minutos.
   * @returns Buffer de 4 octetos con el valor codificado.
   */
  encodeDpt12101({ valueDpt12001 }: DPT12001): Buffer {
    return this.encodeDpt12001({ valueDpt12001 });
  }

  /**
   * Codifica DPT 12.102: DPT_LongTimePeriod_Hrs
   * Formato: 4 octetos (U32)
   * Rango: [0 ... 4 294 967 295]
   * Uso: Operative hours en horas, 1 h de resolución.
   *
   * @param param0 Objeto con { value } representando horas.
   * @returns Buffer de 4 octetos con el valor codificado.
   */
  encodeDpt12102({ valueDpt12001 }: DPT12001): Buffer {
    return this.encodeDpt12001({ valueDpt12001 });
  }
  /**
   * Codifica DPT 13.001: DPT_Value_4_Count
   * Formato: 4 octetos (V32)
   * Rango: [-2,147,483,648 … 2,147,483,647]
   * Unidad: counter pulses (1 pulse de resolución)
   *
   * @param param0 Objeto con la propiedad { value } que contiene el valor a codificar.
   * @returns Buffer de 4 octetos con el valor codificado en formato big-endian.
   */
  encodeDpt13001({ valueDpt13001 }: DPT13001): Buffer {
    if (valueDpt13001 < -2147483648 || valueDpt13001 > 2147483647) {
      throw new Error("DPT 13.001 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(valueDpt13001, 1);

    return buffer;
  }

  /**
   * Codifica DPT 13.002: DPT_FlowRate_m3/h
   * Formato: 4 octetos (V32)
   * Rango: [-2,147,483,648 … 2,147,483,647]
   * Resolución: 0.0001 m³/h (se espera que el valor se suministre en m³/h)
   *
   * Para codificar se multiplica el valor (en m³/h) por 10,000 y se redondea.
   *
   * @param param0 Objeto con la propiedad { value } que contiene el flujo en m³/h.
   * @returns Buffer de 4 octetos con el valor codificado en formato big-endian.
   */
  encodeDpt13002({ valueDpt13001 }: DPT13001): Buffer {
    const rawValue = Math.round(valueDpt13001 * 10000);
    if (rawValue < -2147483648 || rawValue > 2147483647) {
      throw new Error("DPT 13.002 value, after scaling, must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(rawValue, 1);
    return buffer;
  }
  /**
   * DPT 13.010: DPT_ActiveEnergy
   * Unidad: Wh, resolución 1 Wh
   */
  encodeDpt13010({ valueDpt13001 }: DPT13001): Buffer {
    if (valueDpt13001 < -2147483648 || valueDpt13001 > 2147483647) {
      throw new Error("DPT 13.010 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(valueDpt13001, 1);
    return buffer;
  }

  /**
   * DPT 13.011: DPT_ApparantEnergy
   * Unidad: VAh, resolución 1 VAh
   */
  encodeDpt13011({ valueDpt13001 }: DPT13001): Buffer {
    if (valueDpt13001 < -2147483648 || valueDpt13001 > 2147483647) {
      throw new Error("DPT 13.011 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(valueDpt13001, 1);
    return buffer;
  }

  /**
   * DPT 13.012: DPT_ReactiveEnergy
   * Unidad: VARh, resolución 1 VARh
   */
  encodeDpt13012({ valueDpt13001 }: DPT13001): Buffer {
    if (valueDpt13001 < -2147483648 || valueDpt13001 > 2147483647) {
      throw new Error("DPT 13.012 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(valueDpt13001, 1);
    return buffer;
  }

  /**
   * DPT 13.013: DPT_ActiveEnergy_kWh
   * Unidad: kWh, resolución 1 kWh
   */
  encodeDpt13013({ valueDpt13001 }: DPT13001): Buffer {
    if (valueDpt13001 < -2147483648 || valueDpt13001 > 2147483647) {
      throw new Error("DPT 13.013 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(valueDpt13001, 1);
    return buffer;
  }

  /**
   * DPT 13.014: DPT_ApparantEnergy_kVAh
   * Unidad: kVAh, resolución 1 kVAh
   */
  encodeDpt13014({ valueDpt13001 }: DPT13001): Buffer {
    if (valueDpt13001 < -2147483648 || valueDpt13001 > 2147483647) {
      throw new Error("DPT 13.014 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(valueDpt13001, 1);
    return buffer;
  }

  /**
   * DPT 13.015: DPT_ReactiveEnergy_kVARh
   * Unidad: kVARh, resolución 1 kVARh
   */
  encodeDpt13015({ valueDpt13001 }: DPT13001): Buffer {
    if (valueDpt13001 < -2147483648 || valueDpt13001 > 2147483647) {
      throw new Error("DPT 13.015 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(valueDpt13001, 1);
    return buffer;
  }

  /**
   * DPT 13.016: DPT_ActiveEnergy_MWh
   * Unidad: MWh, resolución 1 MWh
   */
  encodeDpt13016({ valueDpt13001 }: DPT13001): Buffer {
    if (valueDpt13001 < -2147483648 || valueDpt13001 > 2147483647) {
      throw new Error("DPT 13.016 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(valueDpt13001, 1);
    return buffer;
  }

  /**
   * DPT 13.100: DPT_ActiveEnergy_MWh
   * Unidad: s, resolución 1 s
   */
  encodeDpt13100({ valueDpt13001 }: DPT13001): Buffer {
    if (valueDpt13001 < -2147483648 || valueDpt13001 > 2147483647) {
      throw new Error("DPT 13.016 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(5);
    buffer.writeInt32BE(valueDpt13001, 1);
    return buffer;
  }

  /**
   * Codifica DPT14: 4-Octet Float Value (IEEE 754 single precision).
   *
   * Formato: 4 octetos (F32) con:
   *   - S: bit de signo
   *   - Exponent: 8 bits (sesgado, según IEEE 754)
   *   - Fraction: 23 bits (mantisa, con bit implícito)
   *
   * Esto se codifica de acuerdo al estándar IEEE 754 single precision.
   *
   * @param param0 Objeto con { value } donde value es el número de punto flotante a codificar.
   * @returns Buffer de 4 octetos codificado en IEEE 754 (big-endian).
   */
  encodeDpt14({ valueDpt14 }: DPT14): Buffer {
    const buffer = Buffer.alloc(5);
    buffer.writeFloatBE(valueDpt14, 1);
    return buffer;
  }
  /**
   * Codifica DPT15 (DPT_Access_Data) en 4 octetos.
   *
   * Formato: 4 octetos: U4 U4 U4 U4 U4 U4 B4 N4, donde:
   *  - D6, D5, D4, D3, D2, D1: 6 dígitos en 4 bits cada uno (0–9)
   *  - E, P, D, C: 4 bits (cada uno 0 o 1)
   *  - Index: 4 bits (0–15)
   *
   * Los bits se organizan de la siguiente manera (bits 31 a 0):
   *
   *   [ D6(4) | D5(4) | D4(4) | D3(4) | D2(4) | D1(4) | E P D C (4) | Index (4) ]
   *
   * @param param0 Objeto con { D6, D5, D4, D3, D2, D1, E, P, D, C, index }.
   * @returns Buffer de 4 octetos con el valor codificado en formato big-endian.
   */
  encodeDpt15({ D6, D5, D4, D3, D2, D1, E, P, D, C, index }: DPT15): Buffer {
    // Validaciones básicas
    if (D6 < 0 || D6 > 9) throw new Error("D6 must be between 0 and 9");
    if (D5 < 0 || D5 > 9) throw new Error("D5 must be between 0 and 9");
    if (D4 < 0 || D4 > 9) throw new Error("D4 must be between 0 and 9");
    if (D3 < 0 || D3 > 9) throw new Error("D3 must be between 0 and 9");
    if (D2 < 0 || D2 > 9) throw new Error("D2 must be between 0 and 9");
    if (D1 < 0 || D1 > 9) throw new Error("D1 must be between 0 and 9");
    if (index < 0 || index > 15) throw new Error("Index must be between 0 and 15");

    // Construir la parte de los 6 dígitos (cada uno en 4 bits)
    const partDigits =
      ((D6 & 0x0f) << 28) |
      ((D5 & 0x0f) << 24) |
      ((D4 & 0x0f) << 20) |
      ((D3 & 0x0f) << 16) |
      ((D2 & 0x0f) << 12) |
      ((D1 & 0x0f) << 8);

    // Construir la parte de estado (E, P, D, C) en 4 bits.
    // Se asume que E es el bit más significativo de ese nibble.
    const statusNibble = ((E & 1) << 3) | ((P & 1) << 2) | ((D & 1) << 1) | (C & 1);

    // Combinar el status nibble y el index:
    const partStatusIndex = ((statusNibble & 0x0f) << 4) | (index & 0x0f);

    // Combinar las dos partes en un entero de 32 bits:
    const encoded = partDigits | partStatusIndex;

    // Escribir el valor en un Buffer de 4 octetos (big-endian)
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(encoded, 0);
    return buffer;
  }
  /**
   * Codifica DPT16: DPT_String_ASCII
   * Formato: 14 octetos (A112)
   * - Cada octeto corresponde a un carácter ASCII.
   * - Si la cadena es menor a 14 caracteres, se rellenan los octetos sobrantes con 0x00.
   *
   * @param param0 Objeto con { text }.
   * @returns Buffer de 14 octetos con la cadena codificada.
   */
  encodeDpt16({ text }: DPT16): Buffer {
    const maxLength = 14;
    // Trunca la cadena si es mayor a 14 caracteres
    const truncated = text.slice(0, maxLength);
    // Crea un buffer de 14 bytes inicializado a 0x00
    const buffer = Buffer.alloc(maxLength, 0x00);

    for (let i = 0; i < truncated.length; i++) {
      const charCode = truncated.charCodeAt(i);
      // Opcional: validar que el carácter esté en el rango ASCII (0-127)
      if (charCode > 127) {
        throw new Error(`Character "${truncated[i]}" is not in the ASCII range`);
      }
      buffer[i] = charCode;
    }

    return buffer;
  }
  /**
   * Codifica DPT 16.002 (no oficial) en 14 octetos.
   *
   * Formato:
   * - Longitud fija de 14 octetos.
   * - Se espera recibir una cadena hexadecimal (sin espacios) que represente hasta 14 bytes (28 dígitos hex).
   * - Si la cadena es menor, se rellenan los octetos sobrantes con 0x00.
   *
   * @param param0 Objeto con { hex } donde hex es una cadena hexadecimal.
   * @returns Buffer de 14 octetos con el dato codificado.
   */
  encodeDpt16002({ hex }: DPT16002): Buffer {
    // Eliminar espacios en blanco (si existiesen)
    const cleanedHex = hex.replace(/\s+/g, "");

    // La cadena debe tener un número par de dígitos (cada byte se representa con 2 dígitos)
    if (cleanedHex.length % 2 !== 0) {
      throw new Error("La cadena hexadecimal debe tener una cantidad par de dígitos");
    }

    // Calcular la cantidad de bytes representados por la cadena
    const numBytes = cleanedHex.length / 2;
    if (numBytes > 14) {
      throw new Error("La cadena hexadecimal es demasiado larga; máximo 14 bytes (28 dígitos)");
    }

    // Crear un Buffer a partir de la cadena hexadecimal
    let buffer = Buffer.from(cleanedHex, "hex");

    // Si el buffer tiene menos de 14 bytes, rellenar con 0x00 hasta alcanzar 14 bytes
    if (buffer.length < 14) {
      const padding = Buffer.alloc(14 - buffer.length, 0x00);
      buffer = Buffer.concat([buffer, padding]);
    }

    return buffer;
  }
  /**
   * Codifica DPT20: Datapoint Type N8
   * Formato: 1 octeto: N8
   * - Field: field1
   * - Encoding: Valor absoluto N en el rango [0 … 255]
   *
   * @param param0 Objeto con { value }
   * @returns Buffer de 1 octeto con el valor codificado.
   */
  encodeDpt20({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 255) {
      throw new Error("DPT20 value must be between 0 and 255");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }
  /**
   * DPT 20.001: DPT_SCLOMode
   * Field: SCLOMode
   *  - 0: autonomous
   *  - 1: slave
   *  - 2: master
   *  - 3 a 255: reservados (válidos de 0 a 3)
   *
   * @param param0 Objeto con { value } donde value debe estar entre 0 y 3.
   * @returns Buffer de 1 octeto.
   */
  encodeDpt20001({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 3) {
      throw new Error("DPT 20.001 value must be between 0 and 3");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.002: DPT_BuildingMode
   * Field: BuildingMode
   *  - 0: Building in use
   *  - 1: Building not used
   *  - 2: Building protection
   *  - 3 a 255: reservados (válido 0 a 2)
   *
   * @param param0 Objeto con { value } donde value debe estar entre 0 y 2.
   * @returns Buffer de 1 octeto.
   */
  encodeDpt20002({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 2) {
      throw new Error("DPT 20.002 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.003: DPT_OccMode
   * Field: OccMode
   *  - 0: occupied
   *  - 1: standby
   *  - 2: not occupied
   *  - 3 a 255: reservados (válido 0 a 2)
   *
   * @param param0 Objeto con { value } donde value debe estar entre 0 y 2.
   * @returns Buffer de 1 octeto.
   */
  encodeDpt20003({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 2) {
      throw new Error("DPT 20.003 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.004: DPT_Priority
   * Field: Priority
   *  - 0: High
   *  - 1: Medium
   *  - 2: Low
   *  - 3: 'void'
   *  - 4 a 255: reservados (válido 0 a 3)
   *
   * @param param0 Objeto con { value } donde value debe estar entre 0 y 3.
   * @returns Buffer de 1 octeto.
   */
  encodeDpt20004({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 3) {
      throw new Error("DPT 20.004 value must be between 0 and 3");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.005: DPT_LightApplicationMode
   * Field: Application Mode
   *  - 0: normal
   *  - 1: presence simulation
   *  - 2: night round
   *  - 3 a 16: reservados
   *  - 17 a 255: manufacturer specific
   *  (Se valida aquí el rango básico [0 a 2], según el uso común)
   *
   * @param param0 Objeto con { value } donde value debe estar entre 0 y 2.
   * @returns Buffer de 1 octeto.
   */
  encodeDpt20005({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 2) {
      throw new Error("DPT 20.005 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }
  /**
   * DPT 20.006: DPT_ApplicationArea
   * Field: ApplicationArea
   * Valores válidos: 0, 1, 10, 11, 12, 13, 14, 20, 30, 40, 50.
   */
  encodeDpt20006({ valueDpt20 }: DPT20): Buffer {
    const validValues = [0, 1, 10, 11, 12, 13, 14, 20, 30, 40, 50];
    if (!validValues.includes(valueDpt20)) {
      throw new Error("DPT 20.006 value must be one of: " + validValues.join(", "));
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.007: DPT_AlarmClassType
   * Field: AlarmClassType
   * Valores válidos: 0 (reserved), 1 (simple alarm), 2 (basic alarm), 3 (extended alarm).
   */
  encodeDpt20007({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 3) {
      throw new Error("DPT 20.007 value must be between 0 and 3");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.008: DPT_PSUMode
   * Field: PSUMode
   * Valores válidos: 0 (disabled), 1 (enabled), 2 (auto).
   */
  encodeDpt20008({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 2) {
      throw new Error("DPT 20.008 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.011: DPT_ErrorClass_System
   * Field: ErrorClass_System
   * Valores válidos: de 0 a 18.
   */
  encodeDpt20011({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 18) {
      throw new Error("DPT 20.011 value must be between 0 and 18");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.012: DPT_ErrorClass_HVAC
   * Field: AlarmClass_HVAC
   * Valores válidos: 0 (no fault), 1 (sensor fault), 2 (process/controller fault), 3 (actuator fault), 4 (other fault).
   */
  encodeDpt20012({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 4) {
      throw new Error("DPT 20.012 value must be between 0 and 4");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.013: DPT_Time_Delay
   * Field: TimeDelay
   * Valores válidos: de 0 a 25 (los valores 26 a 255 están reservados).
   */
  encodeDpt20013({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 25) {
      throw new Error("DPT 20.013 value must be between 0 and 25");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.014: DPT_Beaufort_Wind_Force_Scale
   * Field: Wind Force Scale
   * Valores válidos: de 0 a 12.
   */
  encodeDpt20014({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 12) {
      throw new Error("DPT 20.014 value must be between 0 and 12");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.017: DPT_SensorSelect
   * Field: SensorSelect
   * Valores válidos: 0 (inactive), 1 (digital input not inverted), 2 (digital input inverted), 3 (analog input), 4 (temperature sensor input).
   */
  encodeDpt20017({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 4) {
      throw new Error("DPT 20.017 value must be between 0 and 4");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.020: DPT_ActuatorConnectType
   * Field: ActuatorConnectType
   * Valores válidos: 1 (SensorConnection) o 2 (ControllerConnection).
   */
  encodeDpt20020({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 !== 1 && valueDpt20 !== 2) {
      throw new Error("DPT 20.020 value must be either 1 (SensorConnection) or 2 (ControllerConnection)");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.021: DPT_Cloud_Cover
   * Field: CloudCover
   * Valores válidos: de 0 a 9.
   */
  encodeDpt20021({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 9) {
      throw new Error("DPT 20.021 value must be between 0 and 9");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * DPT 20.022: DPT_PowerReturnMode
   * Field: power return mode
   * Valores válidos: 0 (do not send), 1 (send always), 2 (send if value changed during powerdown)
   */
  encodeDpt20022({ valueDpt20 }: DPT20): Buffer {
    if (valueDpt20 < 0 || valueDpt20 > 2) {
      throw new Error("DPT 20.022 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(valueDpt20, 1);
    return buffer;
  }

  /**
   * Codifica DPT 27.001: DPT_CombinedInfoOnOff en 4 octetos.
   *
   * Formato (de MSB a LSB, 32 bits):
   *   [ m15 m14 ... m0  |  s15 s14 ... s0 ]
   *
   * Es decir, los 16 bits superiores contienen los bits de máscara,
   * y los 16 bits inferiores contienen los bits de estado.
   *
   * @param param0 Objeto con { mask, status }.
   * @returns Buffer de 4 octetos en formato big-endian.
   */
  encodeDpt27001({ mask, status }: DPT27001): Buffer {
    if (mask < 0 || mask > 0xffff) {
      throw new Error("mask must be between 0 and 65535");
    }
    if (status < 0 || status > 0xffff) {
      throw new Error("status must be between 0 and 65535");
    }
    // Combinar los dos campos: los bits de máscara se desplazan 16 bits a la izquierda,
    // y se OR con los bits de estado.
    const encoded = (mask << 16) | (status & 0xffff);
    const buffer = Buffer.alloc(5);
    buffer.writeUInt32BE(encoded, 1);
    return buffer;
  }
  /**
   * Codifica DPT 28.001: DPT_UTF-8.
   *
   * Formato: A[n]
   *  - La cadena se codifica utilizando el esquema UTF‑8.
   *  - La cadena se termina con un byte nulo (0x00).
   *  - No se transmite información de longitud, se asume que la longitud está implícita en el frame.
   *
   * @param param0 Objeto con { text }.
   * @returns Buffer con la cadena codificada en UTF-8, terminada en 0x00.
   */
  encodeDpt28001({ textDpt28001 }: DPT28001): Buffer {
    // Codificar la cadena en UTF-8
    const utf8Buffer = Buffer.from(textDpt28001, "utf8");
    // Crear un buffer con el terminador nulo
    const nullTerminator = Buffer.from([0x00]);
    // Concatenar la cadena codificada y el terminador
    return Buffer.concat([utf8Buffer, nullTerminator]);
  }
  /**
   * Codifica DPT29: 4-Octet Signed Value (V64) en 8 octetos.
   *
   * Formato: 8 octetos (V64) en notación de complemento a dos (big-endian)
   *
   * @param param0 Objeto con { value } donde value es un BigInt que debe estar entre:
   *               –9,223,372,036,854,775,808 y 9,223,372,036,854,775,807.
   * @returns Buffer de 8 octetos con el valor codificado.
   */
  encodeDpt29({ valueDpt29 }: DPT29): Buffer {
    const min = -9223372036854775808n; // -2^63
    const max = 9223372036854775807n; // 2^63 - 1
    if (valueDpt29 < min || valueDpt29 > max) {
      throw new Error("DPT29 value must be between -9223372036854775808 and 9223372036854775807");
    }
    const buffer = Buffer.alloc(9);
    // Escribe el BigInt en formato big-endian
    buffer.writeBigInt64BE(valueDpt29, 1);
    return buffer;
  }
  encodeDpt238600({ BF, LF, Addr }: DPT238600): Buffer {
    if (BF !== 0 && BF !== 1) {
      throw new Error("BF must be 0 or 1");
    }
    if (LF !== 0 && LF !== 1) {
      throw new Error("LF must be 0 or 1");
    }
    if (Addr < 0 || Addr > 63) {
      throw new Error("Addr must be between 0 and 63");
    }

    // Construir el byte:
    // Bit 7: BF, Bit 6: LF, Bits 5-0: Addr
    const byte = (BF << 7) | (LF << 6) | (Addr & 0x3f);
    return Buffer.from([byte]);
  }
  /**
   * Codifica DPT 245.600: DPT_Converter_Test_Result en 6 octetos.
   *
   * La estructura es la siguiente (bits 47 a 0):
   *
   *   [ LTRF (4) | LTRD (4) | LTRP (4) | Reserved (4=0) | SF (2) | SD (2) | SP (2) | Reserved (2=0) | LDTR (16) | LPDTR (8) ]
   *
   * @param param0 Objeto con { LTRF, LTRD, LTRP, SF, SD, SP, LDTR, LPDTR }.
   * @returns Buffer de 6 octetos codificado en formato big-endian.
   */
  encodeDpt245600({ LTRF, LTRD, LTRP, SF, SD, SP, LDTR, LPDTR }: DPT245600): Buffer {
    // Validaciones básicas
    if (LTRF < 0 || LTRF > 15) throw new Error("LTRF must be between 0 and 15");
    if (LTRD < 0 || LTRD > 15) throw new Error("LTRD must be between 0 and 15");
    if (LTRP < 0 || LTRP > 15) throw new Error("LTRP must be between 0 and 15");
    if (SF < 0 || SF > 3) throw new Error("SF must be between 0 and 3");
    if (SD < 0 || SD > 3) throw new Error("SD must be between 0 and 3");
    if (SP < 0 || SP > 3) throw new Error("SP must be between 0 and 3");
    if (LDTR < 0 || LDTR > 0xffff) throw new Error("LDTR must be between 0 and 65535");
    if (LPDTR < 0 || LPDTR > 255) throw new Error("LPDTR must be between 0 and 255");

    // Construir el valor de 48 bits utilizando desplazamientos y multiplicaciones.
    // Usaremos la siguiente asignación:
    // bits 47-44: LTRF
    // bits 43-40: LTRD
    // bits 39-36: LTRP
    // bits 35-32: Reserved = 0
    // bits 31-30: SF (2 bits)
    // bits 29-28: SD (2 bits)
    // bits 27-26: SP (2 bits)
    // bits 25-24: Reserved = 0
    // bits 23-8: LDTR (16 bits)
    // bits 7-0: LPDTR (8 bits)
    let encoded = 0;
    encoded += (LTRF & 0x0f) * Math.pow(2, 44); // bits 47-44
    encoded += (LTRD & 0x0f) * Math.pow(2, 40); // bits 43-40
    encoded += (LTRP & 0x0f) * Math.pow(2, 36); // bits 39-36
    // bits 35-32: reserved (0)
    encoded += (SF & 0x03) * Math.pow(2, 30); // bits 31-30
    encoded += (SD & 0x03) * Math.pow(2, 28); // bits 29-28
    encoded += (SP & 0x03) * Math.pow(2, 26); // bits 27-26
    // bits 25-24: reserved (0)
    encoded += (LDTR & 0xffff) * Math.pow(2, 8); // bits 23-8
    encoded += LPDTR & 0xff; // bits 7-0

    // Extraer los 6 bytes (big-endian) a partir del valor de 48 bits.
    const buffer = Buffer.alloc(6);
    buffer[0] = Math.floor(encoded / Math.pow(2, 40)) & 0xff;
    buffer[1] = Math.floor(encoded / Math.pow(2, 32)) & 0xff;
    buffer[2] = Math.floor(encoded / Math.pow(2, 24)) & 0xff;
    buffer[3] = Math.floor(encoded / Math.pow(2, 16)) & 0xff;
    buffer[4] = Math.floor(encoded / Math.pow(2, 8)) & 0xff;
    buffer[5] = encoded & 0xff;
    return buffer;
  }
  /**
   * Codifica DPT 250600: DPT_Brightness_Colour_Temperature_Control en 3 octetos.
   *
   * Formato:
   *   Octeto 3 (MSB): r4B1U3
   *      - Bits 7-4: Reservados (0)
   *      - Bit 3: cCT
   *      - Bits 2-0: Step Code Colour Temperature
   *   Octeto 2: r4B1U3
   *      - Bits 7-4: Reservados (0)
   *      - Bit 3: cB
   *      - Bits 2-0: Step Code Brightness
   *   Octeto 1 (LSB): B8
   *      - Bits 7-2: Reservados (0)
   *      - Bit 1: validCT
   *      - Bit 0: validB
   *
   * @param param0 Objeto con { cCT, stepCodeCT, cB, stepCodeB, validCT, validB }.
   * @returns Buffer de 3 octetos con el valor codificado.
   */
  encodeDpt250600({ cCT, stepCodeCT, cB, stepCodeB, validCT, validB }: DPT250600): Buffer {
    // Validaciones
    if (stepCodeCT < 0 || stepCodeCT > 7) {
      throw new Error("stepCodeCT must be between 0 and 7");
    }
    if (stepCodeB < 0 || stepCodeB > 7) {
      throw new Error("stepCodeB must be between 0 and 7");
    }
    // Octeto 3 (MSB): r4B1U3 para Colour Temperature
    // Bits 7-4: Reservados (0), Bit 3: cCT, Bits 2-0: stepCodeCT
    const octet3 = ((cCT & 0x01) << 3) | (stepCodeCT & 0x07);

    // Octeto 2: r4B1U3 para Brightness
    // Bits 7-4: Reservados (0), Bit 3: cB, Bits 2-0: stepCodeB
    const octet2 = ((cB & 0x01) << 3) | (stepCodeB & 0x07);

    // Octeto 1 (LSB): B8 para validación y reservados
    // Bits 7-2: 0, Bit 1: validCT, Bit 0: validB
    const octet1 = ((validCT & 0x01) << 1) | (validB & 0x01);

    return Buffer.from([octet3, octet2, octet1]);
  }
  /**
   * Codifica DPT 251.600: DPT_Colour_RGBW en 6 octetos.
   *
   * Estructura:
   *   Octeto 6 (MSB): R (8 bits)
   *   Octeto 5: G (8 bits)
   *   Octeto 4: B (8 bits)
   *   Octeto 3: W (8 bits)
   *   Octeto 2: Reserved (8 bits, 0x00)
   *   Octeto 1 (LSB): High nibble = 0, Low nibble = (mR<<3 | mG<<2 | mB<<1 | mW)
   *
   * @param param0 Objeto con { R, G, B, W, mR, mG, mB, mW }.
   * @returns Buffer de 6 octetos con el valor codificado.
   */
  encodeDpt251600({ R, G, B, W, mR, mG, mB, mW }: DPT251600): Buffer {
    // Validaciones
    if (R < 0 || R > 255) throw new Error("R must be between 0 and 255");
    if (G < 0 || G > 255) throw new Error("G must be between 0 and 255");
    if (B < 0 || B > 255) throw new Error("B must be between 0 and 255");
    if (W < 0 || W > 255) throw new Error("W must be between 0 and 255");
    // mR, mG, mB, mW deben ser 0 o 1 (se asume que el tipo ya lo valida)

    const buffer = Buffer.alloc(6);

    // Octeto 6 (índice 0): R
    buffer[0] = R;
    // Octeto 5 (índice 1): G
    buffer[1] = G;
    // Octeto 4 (índice 2): B
    buffer[2] = B;
    // Octeto 3 (índice 3): W
    buffer[3] = W;
    // Octeto 2 (índice 4): Reserved = 0x00
    buffer[4] = 0x00;
    // Octeto 1 (índice 5, LSB): High nibble = 0, Low nibble = (mR<<3 | mG<<2 | mB<<1 | mW)
    buffer[5] = ((mR & 1) << 3) | ((mG & 1) << 2) | ((mB & 1) << 1) | (mW & 1);

    return buffer;
  }
}
