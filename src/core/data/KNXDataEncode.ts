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
import { DPTNotFound, InvalidParametersForDpt } from "../../errors/DPTNotFound";
import { KNXData } from "./KNXData";

export class KnxDataEncoder extends KNXData {
  private constructor() {
    super();
    throw new Error("This class is static and cannot be instantiated.");
  }

  private static extractValue<T>(data: { value: T } | T): T {
    if (typeof data === "object" && data !== null && "value" in data) {
      return (data as { value: T }).value;
    }
    return data as T;
  }

  private static validateProperty(
    dpt: number | string,
    obj: any,
    prop: string,
    type: "number" | "string" | "boolean" | "bigint",
    options?: {
      min?: number | bigint;
      max?: number | bigint;
      integer?: boolean;
      enum?: readonly (number | string)[] | (number | string)[];
      custom?: (val: any) => boolean | string;
    },
  ): void {
    if (typeof obj !== "object" || obj === null) {
      throw new InvalidParametersForDpt({
        dpt,
        property: prop,
        expected: `object containing property "${prop}"`,
        received: obj,
        reason: "The parameter is not an object",
      });
    }

    if (!(prop in obj)) {
      let expectedDesc: string = type;
      if (options?.min !== undefined && options?.max !== undefined) {
        expectedDesc = `${type} between ${options.min} and ${options.max}`;
      } else if (options?.enum) {
        expectedDesc = `one of [${options.enum.join(", ")}]`;
      }
      throw new InvalidParametersForDpt({
        dpt,
        property: prop,
        expected: expectedDesc,
        received: undefined,
        reason: `Missing required property "${prop}"`,
      });
    }

    const val = obj[prop];

    if (typeof val !== type) {
      throw new InvalidParametersForDpt({
        dpt,
        property: prop,
        expected: type,
        received: val,
        reason: `Property "${prop}" must be of type ${type}, but received ${typeof val}`,
      });
    }

    if (type === "number") {
      if (isNaN(val) || !isFinite(val)) {
        throw new InvalidParametersForDpt({
          dpt,
          property: prop,
          expected: "valid finite number",
          received: val,
          reason: `Property "${prop}" cannot be NaN or Infinity`,
        });
      }
      if (options?.integer && !Number.isInteger(val)) {
        throw new InvalidParametersForDpt({
          dpt,
          property: prop,
          expected: "integer",
          received: val,
          reason: `Property "${prop}" must be an integer`,
        });
      }
    }

    if (options?.min !== undefined && val < options.min) {
      throw new InvalidParametersForDpt({
        dpt,
        property: prop,
        expected: `${type} >= ${options.min}`,
        received: val,
        reason: `Property "${prop}" is less than minimum ${options.min}`,
      });
    }

    if (options?.max !== undefined && val > options.max) {
      throw new InvalidParametersForDpt({
        dpt,
        property: prop,
        expected: `${type} <= ${options.max}`,
        received: val,
        reason: `Property "${prop}" exceeds maximum ${options.max}`,
      });
    }

    if (options?.enum && !options.enum.includes(val)) {
      throw new InvalidParametersForDpt({
        dpt,
        property: prop,
        expected: `one of [${options.enum.join(", ")}]`,
        received: val,
        reason: `Property "${prop}" must be one of [${options.enum.join(", ")}]`,
      });
    }

    if (options?.custom) {
      const res = options.custom(val);
      if (res !== true) {
        const desc = typeof res === "string" ? res : `Property "${prop}" failed custom validation`;
        throw new InvalidParametersForDpt({
          dpt,
          property: prop,
          expected: desc,
          received: val,
          reason: desc,
        });
      }
    }
  }

  private static isValueOnlyDpt(dptNum: number): boolean {
    const main = Math.floor(dptNum / 1000) || dptNum;
    return (
      dptNum === 1 ||
      main === 1 ||
      dptNum === 5 ||
      dptNum === 5001 ||
      dptNum === 5002 ||
      main === 5 ||
      dptNum === 6 ||
      dptNum === 6001 ||
      dptNum === 6010 ||
      (main === 6 && dptNum !== 6020) ||
      dptNum === 7 ||
      (dptNum >= 7001 && dptNum <= 7013) ||
      main === 7 ||
      dptNum === 8 ||
      main === 8 ||
      dptNum === 9 ||
      main === 9 ||
      dptNum === 12 ||
      (dptNum >= 12001 && dptNum <= 12102) ||
      main === 12 ||
      dptNum === 13 ||
      (dptNum >= 13001 && dptNum <= 13100) ||
      main === 13 ||
      dptNum === 14 ||
      main === 14 ||
      dptNum === 20 ||
      (dptNum >= 20001 && dptNum <= 20022) ||
      main === 20 ||
      dptNum === 28001 ||
      dptNum === 28 ||
      main === 28 ||
      dptNum === 29 ||
      main === 29
    );
  }

  private static validateDptData(dptNum: number, rawData: any): any {
    if (rawData === undefined || rawData === null) {
      throw new InvalidParametersForDpt({
        dpt: dptNum,
        property: "value",
        expected: "valid data",
        received: rawData,
        reason: "Input data is null or undefined",
      });
    }

    let data = rawData;
    if (this.isValueOnlyDpt(dptNum)) {
      if (typeof rawData !== "object" || rawData === null) {
        data = { value: rawData };
      } else if (!("value" in rawData)) {
        throw new InvalidParametersForDpt({
          dpt: dptNum,
          property: "value",
          expected: "object containing property 'value' or primitive value",
          received: rawData,
          reason: "Missing required property 'value'",
        });
      }
    }

    switch (dptNum) {
      case 1:
        this.validateProperty(1, data, "value", "boolean");
        return data;

      case 2:
        this.validateProperty(2, data, "control", "number", { enum: [0, 1] });
        this.validateProperty(2, data, "value", "number", { enum: [0, 1] });
        return data;

      case 3007:
        this.validateProperty(3007, data, "control", "number", { enum: [0, 1] });
        this.validateProperty(3007, data, "stepCode", "number", { min: 0, max: 7, integer: true });
        return data;

      case 3008:
        this.validateProperty(3008, data, "control", "number", { enum: [0, 1] });
        this.validateProperty(3008, data, "stepCode", "number", { min: 0, max: 7, integer: true });
        return data;

      case 4:
      case 4001:
        this.validateProperty(dptNum, data, "char", "string", {
          custom: (val: string) => {
            if (val.length !== 1) return "String must contain exactly one character";
            if ((val.charCodeAt(0) & 0x80) !== 0) return "Character out of ASCII range (MSB must be 0)";
            return true;
          },
        });
        return data;

      case 5:
        this.validateProperty(5, data, "value", "number", { min: 0, max: 255 });
        return data;

      case 5001:
        this.validateProperty(5001, data, "value", "number", { min: 0, max: 100 });
        return data;

      case 5002:
        this.validateProperty(5002, data, "value", "number", { min: 0, max: 360 });
        return data;

      case 6:
      case 6001:
      case 6010:
        this.validateProperty(dptNum, data, "value", "number", { min: -128, max: 127 });
        return data;

      case 6020:
        this.validateProperty(6020, data, "status", "number", { enum: [0, 1] });
        this.validateProperty(6020, data, "mode", "number", { min: 0, max: 7, integer: true });
        return data;

      case 7:
      case 7001:
      case 7002:
      case 7005:
      case 7006:
      case 7007:
      case 7011:
      case 7012:
      case 7013:
        this.validateProperty(dptNum, data, "value", "number", { min: 0, max: 65535 });
        return data;

      case 7003:
        this.validateProperty(7003, data, "value", "number", {
          custom: (val: number) => {
            const scaled = Math.round(val * 100);
            return scaled >= 0 && scaled <= 65535 ? true : "Scaled value (value * 100) must be between 0 and 65535";
          },
        });
        return data;

      case 7004:
        this.validateProperty(7004, data, "value", "number", {
          custom: (val: number) => {
            const scaled = Math.round(val * 10);
            return scaled >= 0 && scaled <= 65535 ? true : "Scaled value (value * 10) must be between 0 and 65535";
          },
        });
        return data;

      case 8:
        this.validateProperty(8, data, "value", "number", { min: -32768, max: 32767 });
        return data;

      case 9:
        this.validateProperty(9, data, "value", "number");
        return data;

      case 10001:
        this.validateProperty(10001, data, "day", "number", { min: 0, max: 7, integer: true });
        this.validateProperty(10001, data, "hour", "number", { min: 0, max: 23, integer: true });
        this.validateProperty(10001, data, "minutes", "number", { min: 0, max: 59, integer: true });
        this.validateProperty(10001, data, "seconds", "number", { min: 0, max: 59, integer: true });
        return data;

      case 11001:
        this.validateProperty(11001, data, "day", "number", { min: 1, max: 31, integer: true });
        this.validateProperty(11001, data, "month", "number", { min: 1, max: 12, integer: true });
        this.validateProperty(11001, data, "year", "number", { min: 1990, max: 2089, integer: true });
        return data;

      case 12:
      case 12001:
      case 12100:
      case 12101:
      case 12102:
        this.validateProperty(dptNum, data, "value", "number", { min: 0, max: 0xffffffff });
        return data;

      case 13001:
      case 13010:
      case 13011:
      case 13012:
      case 13013:
      case 13014:
      case 13015:
      case 13016:
      case 13100:
        this.validateProperty(dptNum, data, "value", "number", { min: -2147483648, max: 2147483647 });
        return data;

      case 13002:
        this.validateProperty(13002, data, "value", "number", {
          custom: (val: number) => {
            const raw = Math.round(val * 10000);
            return raw >= -2147483648 && raw <= 2147483647
              ? true
              : "Scaled value (value * 10000) must be between -2147483648 and 2147483647";
          },
        });
        return data;

      case 14:
        this.validateProperty(14, data, "value", "number");
        return data;

      case 15:
        this.validateProperty(15, data, "D6", "number", { min: 0, max: 9, integer: true });
        this.validateProperty(15, data, "D5", "number", { min: 0, max: 9, integer: true });
        this.validateProperty(15, data, "D4", "number", { min: 0, max: 9, integer: true });
        this.validateProperty(15, data, "D3", "number", { min: 0, max: 9, integer: true });
        this.validateProperty(15, data, "D2", "number", { min: 0, max: 9, integer: true });
        this.validateProperty(15, data, "D1", "number", { min: 0, max: 9, integer: true });
        this.validateProperty(15, data, "E", "number", { enum: [0, 1] });
        this.validateProperty(15, data, "P", "number", { enum: [0, 1] });
        this.validateProperty(15, data, "D", "number", { enum: [0, 1] });
        this.validateProperty(15, data, "C", "number", { enum: [0, 1] });
        this.validateProperty(15, data, "index", "number", { min: 0, max: 15, integer: true });
        return data;

      case 16:
        this.validateProperty(16, data, "text", "string", {
          custom: (val: string) => {
            for (let i = 0; i < Math.min(val.length, 14); i++) {
              if (val.charCodeAt(i) > 127) return `Character "${val[i]}" is not in ASCII range`;
            }
            return true;
          },
        });
        return data;

      case 16002:
        this.validateProperty(16002, data, "hex", "string", {
          custom: (val: string) => {
            const cleaned = val.replace(/\s+/g, "");
            if (cleaned.length % 2 !== 0) return "Hex string must have an even number of digits";
            if (cleaned.length / 2 > 14) return "Hex string is too long; maximum 14 bytes (28 digits)";
            if (!/^[0-9a-fA-F]*$/.test(cleaned)) return "Hex string must contain valid hexadecimal characters";
            return true;
          },
        });
        return data;

      case 20:
        this.validateProperty(20, data, "value", "number", { min: 0, max: 255 });
        return data;
      case 20001:
        this.validateProperty(20001, data, "value", "number", { min: 0, max: 3 });
        return data;
      case 20002:
        this.validateProperty(20002, data, "value", "number", { min: 0, max: 2 });
        return data;
      case 20003:
        this.validateProperty(20003, data, "value", "number", { min: 0, max: 2 });
        return data;
      case 20004:
        this.validateProperty(20004, data, "value", "number", { min: 0, max: 3 });
        return data;
      case 20005:
        this.validateProperty(20005, data, "value", "number", { min: 0, max: 2 });
        return data;
      case 20006:
        this.validateProperty(20006, data, "value", "number", {
          enum: [0, 1, 10, 11, 12, 13, 14, 20, 30, 40, 50],
        });
        return data;
      case 20007:
        this.validateProperty(20007, data, "value", "number", { min: 0, max: 3 });
        return data;
      case 20008:
        this.validateProperty(20008, data, "value", "number", { min: 0, max: 2 });
        return data;
      case 20011:
        this.validateProperty(20011, data, "value", "number", { min: 0, max: 18 });
        return data;
      case 20012:
        this.validateProperty(20012, data, "value", "number", { min: 0, max: 4 });
        return data;
      case 20013:
        this.validateProperty(20013, data, "value", "number", { min: 0, max: 25 });
        return data;
      case 20014:
        this.validateProperty(20014, data, "value", "number", { min: 0, max: 12 });
        return data;
      case 20017:
        this.validateProperty(20017, data, "value", "number", { min: 0, max: 4 });
        return data;
      case 20020:
        this.validateProperty(20020, data, "value", "number", { enum: [1, 2] });
        return data;
      case 20021:
        this.validateProperty(20021, data, "value", "number", { min: 0, max: 9 });
        return data;
      case 20022:
        this.validateProperty(20022, data, "value", "number", { min: 0, max: 2 });
        return data;

      case 27001:
        this.validateProperty(27001, data, "mask", "number", { min: 0, max: 0xffff, integer: true });
        this.validateProperty(27001, data, "status", "number", { min: 0, max: 0xffff, integer: true });
        return data;

      case 28:
      case 28001:
        this.validateProperty(dptNum, data, "value", "string");
        return data;

      case 29:
        this.validateProperty(29, data, "value", "bigint", {
          min: -9223372036854775808n,
          max: 9223372036854775807n,
        });
        return data;

      case 238600:
        this.validateProperty(238600, data, "BF", "number", { enum: [0, 1] });
        this.validateProperty(238600, data, "LF", "number", { enum: [0, 1] });
        this.validateProperty(238600, data, "Addr", "number", { min: 0, max: 63, integer: true });
        return data;

      case 245600:
        this.validateProperty(245600, data, "LTRF", "number", { min: 0, max: 15, integer: true });
        this.validateProperty(245600, data, "LTRD", "number", { min: 0, max: 15, integer: true });
        this.validateProperty(245600, data, "LTRP", "number", { min: 0, max: 15, integer: true });
        this.validateProperty(245600, data, "SF", "number", { min: 0, max: 3, integer: true });
        this.validateProperty(245600, data, "SD", "number", { min: 0, max: 3, integer: true });
        this.validateProperty(245600, data, "SP", "number", { min: 0, max: 3, integer: true });
        this.validateProperty(245600, data, "LDTR", "number", { min: 0, max: 65535, integer: true });
        this.validateProperty(245600, data, "LPDTR", "number", { min: 0, max: 255, integer: true });
        return data;

      case 250600:
        this.validateProperty(250600, data, "cCT", "number", { enum: [0, 1] });
        this.validateProperty(250600, data, "stepCodeCT", "number", { min: 0, max: 7, integer: true });
        this.validateProperty(250600, data, "cB", "number", { enum: [0, 1] });
        this.validateProperty(250600, data, "stepCodeB", "number", { min: 0, max: 7, integer: true });
        this.validateProperty(250600, data, "validCT", "number", { enum: [0, 1] });
        this.validateProperty(250600, data, "validB", "number", { enum: [0, 1] });
        return data;

      case 251600:
        this.validateProperty(251600, data, "R", "number", { min: 0, max: 255, integer: true });
        this.validateProperty(251600, data, "G", "number", { min: 0, max: 255, integer: true });
        this.validateProperty(251600, data, "B", "number", { min: 0, max: 255, integer: true });
        this.validateProperty(251600, data, "W", "number", { min: 0, max: 255, integer: true });
        this.validateProperty(251600, data, "mR", "number", { enum: [0, 1] });
        this.validateProperty(251600, data, "mG", "number", { enum: [0, 1] });
        this.validateProperty(251600, data, "mB", "number", { enum: [0, 1] });
        this.validateProperty(251600, data, "mW", "number", { enum: [0, 1] });
        return data;

      default:
        throw new DPTNotFound();
    }
  }

  /**
   * Determines if a DPT is packed into the APCI (<= 6 bits)
   */
  public static isShortDpt(dpt: any): boolean {
    const dptNum = this.getDptNumber(dpt);
    if (dptNum === null) return false;
    // DPT 1 (1 bit), 2 (2 bits), 3 (4 bits) son "short"
    const main = Math.floor(dptNum / 1000) || dptNum;
    return main >= 1 && main <= 3;
  }

  // #region Method for encoding dpts
  static encodeThis<T extends (typeof KnxDataEncoder.dptEnum)[number] | string | null>(
    dpt: T,
    data: AllDpts<T>,
  ): Buffer {
    let dptNum = this.getDptNumber<T>(dpt);
    if (dptNum === null) throw new DPTNotFound();

    // Si el DPT específico no existe, intentamos usar el principal (ej: 5.003 -> 5)
    dptNum = this.fallbackDPT(dptNum);

    const validData = this.validateDptData(dptNum, data);

    switch (dptNum) {
      case 1:
        return this.encodeDpt1(validData as DPT1);
      case 2:
        return this.encodeDpt2(validData as DPT2);
      case 3007:
        return this.encodeDpt3007(validData as DPT3);
      case 3008:
        return this.encodeDpt3008(validData as DPT3);
      case 4:
      case 4001:
        return this.encodeDpt4001(validData as DPT4);
      case 5:
        return this.encodeDpt5(validData as DPT5);
      case 5001:
        return this.encodeDpt5001(validData as DPT5001);
      case 5002:
        return this.encodeDpt5002(validData as DPT5002);
      case 6:
      case 6001:
      case 6010:
        return this.encodeDpt6(validData as DPT6);
      case 6020:
        return this.encodeDpt6020(validData as DPT6020);
      case 7:
        return this.encodeDpt7(validData as DPT7);
      case 7001:
        return this.encodeDpt7001(validData as DPT7);
      case 7002:
        return this.encodeDpt7002(validData as DPT7);
      case 7003:
        return this.encodeDpt7003(validData as DPT7);
      case 7004:
        return this.encodeDpt7004(validData as DPT7);
      case 7005:
        return this.encodeDpt7005(validData as DPT7);
      case 7006:
        return this.encodeDpt7006(validData as DPT7);
      case 7007:
        return this.encodeDpt7007(validData as DPT7);
      case 7011:
        return this.encodeDpt7011(validData as DPT7);
      case 7012:
        return this.encodeDpt7012(validData as DPT7);
      case 7013:
        return this.encodeDpt7013(validData as DPT7);
      case 8:
        return this.encodeDpt8(validData as DPT8);
      case 9:
        return this.encodeDpt9(validData as DPT9);
      case 10001:
        return this.encodeDpt10001(validData as DPT10001);
      case 11001:
        return this.encodeDpt11001(validData as DPT11001);
      case 12:
      case 12001:
        return this.encodeDpt12001(validData as DPT12001);
      case 12100:
        return this.encodeDpt12100(validData as DPT12001);
      case 12101:
        return this.encodeDpt12101(validData as DPT12001);
      case 12102:
        return this.encodeDpt12102(validData as DPT12001);
      case 13001:
        return this.encodeDpt13001(validData as DPT13001);
      case 13002:
        return this.encodeDpt13002(validData as DPT13001);
      case 13010:
        return this.encodeDpt13010(validData as DPT13001);
      case 13011:
        return this.encodeDpt13011(validData as DPT13001);
      case 13012:
        return this.encodeDpt13012(validData as DPT13001);
      case 13013:
        return this.encodeDpt13013(validData as DPT13001);
      case 13014:
        return this.encodeDpt13014(validData as DPT13001);
      case 13015:
        return this.encodeDpt13015(validData as DPT13001);
      case 13016:
        return this.encodeDpt13016(validData as DPT13001);
      case 13100:
        return this.encodeDpt13100(validData as DPT13001);
      case 14:
        return this.encodeDpt14(validData as DPT14);
      case 15:
        return this.encodeDpt15(validData as DPT15);
      case 16:
        return this.encodeDpt16(validData as DPT16);
      case 16002:
        return this.encodeDpt16002(validData as DPT16002);
      case 20:
        return this.encodeDpt20(validData as DPT20);
      case 20001:
        return this.encodeDpt20001(validData as DPT20);
      case 20002:
        return this.encodeDpt20002(validData as DPT20);
      case 20003:
        return this.encodeDpt20003(validData as DPT20);
      case 20004:
        return this.encodeDpt20004(validData as DPT20);
      case 20005:
        return this.encodeDpt20005(validData as DPT20);
      case 20006:
        return this.encodeDpt20006(validData as DPT20);
      case 20007:
        return this.encodeDpt20007(validData as DPT20);
      case 20008:
        return this.encodeDpt20008(validData as DPT20);
      case 20011:
        return this.encodeDpt20011(validData as DPT20);
      case 20012:
        return this.encodeDpt20012(validData as DPT20);
      case 20013:
        return this.encodeDpt20013(validData as DPT20);
      case 20014:
        return this.encodeDpt20014(validData as DPT20);
      case 20017:
        return this.encodeDpt20017(validData as DPT20);
      case 20020:
        return this.encodeDpt20020(validData as DPT20);
      case 20021:
        return this.encodeDpt20021(validData as DPT20);
      case 20022:
        return this.encodeDpt20022(validData as DPT20);
      case 27001:
        return this.encodeDpt27001(validData as DPT27001);
      case 28:
      case 28001:
        return this.encodeDpt28001(validData as DPT28001);
      case 29:
        return this.encodeDpt29(validData as DPT29);
      case 238600:
        return this.encodeDpt238600(validData as DPT238600);
      case 245600:
        return this.encodeDpt245600(validData as DPT245600);
      case 250600:
        return this.encodeDpt250600(validData as DPT250600);
      case 251600:
        return this.encodeDpt251600(validData as DPT251600);
      default:
        throw new DPTNotFound();
    }
  }

  // #endregion

  static encodeThisOnlyVerify<T extends (typeof KnxDataEncoder.dptEnum)[number] | string | null>(
    dpt: T,
    data: AllDpts<T>,
  ): typeof data {
    let dptNum = this.getDptNumber(dpt);
    if (dptNum === null) throw new DPTNotFound();

    dptNum = this.fallbackDPT(dptNum) as typeof dptNum;

    this.validateDptData(dptNum, data);
    return data;
  }

  // #region DPTEnum

  /**
   * List of all available DPTs
   */
  static get dptEnum() {
    return [
      1, 2, 3007, 3008, 4001, 5, 5001, 5002, 6, 6001, 6010, 6020, 7, 7001, 7002, 7003, 7004, 7005, 7006, 7007, 7011,
      7012, 7013, 8, 9, 10001, 11001, 12, 12001, 12100, 12101, 12102, 13001, 13002, 13010, 13011, 13012, 13013, 13014,
      13015, 13016, 13100, 14, 15, 16, 16002, 20, 20001, 20002, 20003, 20004, 20005, 20006, 20007, 20008, 20011, 20012,
      20013, 20014, 20017, 20020, 20021, 20022, 27001, 28001, 29, 238600, 245600, 250600, 251600,
    ] as const;
  }

  /**
   * Returns a DPT as a number, given a string
   * @param value DPT in "1.001" format for example
   * @returns Returns a DPT as a number, given a string
   */
  static dptEnumStr(value: string) {
    return this.getDptNumber(value);
  }
  // #endregion

  /**
   * Encodes a boolean value into DPT1.
   * Returns a 1-byte Buffer.
   */
  static encodeDpt1(data: DPT1) {
    const value = this.extractValue(data);
    const buffer = Buffer.alloc(1);
    buffer.writeUint8(value ? 0x01 : 0x00, 0);
    return buffer;
  }

  /**
   * Encodes DPT2, which uses 2 bits: a control bit and a value bit.
   * Parameters must be 0 or 1.
   * Returns a 1-byte Buffer.
   */
  static encodeDpt2({ control, value }: DPT2) {
    const buffer = Buffer.alloc(1);
    buffer.writeUint8((control << 1) | value, 0);
    return buffer;
  }

  /**
   * Encodes DPT3007: B1U3 format (4 bits).
   * - control: 0 (Decrease) or 1 (Increase)
   * - stepCode: 0 to 7 (0 = Break; 1..7 = number of intervals according to 2^(stepCode-1))
   *
   * Returns a 1-byte Buffer, using the lower nibble.
   */
  static encodeDpt3007({ control, stepCode }: DPT3) {
    const buffer = Buffer.alloc(1);
    buffer.writeUint8((control << 3) | (stepCode & 0x07), 0);
    return buffer;
  }

  /**
   * Encodes DPT3008: B1U3 format for blind/shutter control.
   * - control: 0 (Up) or 1 (Down)
   * - stepCode: 0 to 7 (0 = Break; 1..7 = number of intervals)
   *
   * Returns a 1-byte Buffer.
   */
  static encodeDpt3008({ control, stepCode }: DPT3) {
    const buffer = Buffer.alloc(1);
    buffer.writeUint8((control << 3) | (stepCode & 0x07), 0);
    return buffer;
  }

  /**
   * Encodes DPT4001: DPT_Char_ASCII.
   * A single character is expected (with MSB = 0, value between 0 and 127).
   * Returns a 1-byte Buffer.
   */
  static encodeDpt4001({ char }: DPT4) {
    if (char.length !== 1) {
      throw new Error("Only one character allowed");
    }
    const code = char.charCodeAt(0);
    if (code & 0x80) {
      throw new Error("Character out of ASCII range (MSB must be 0)");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUint8(code, 0);
    return buffer;
  }

  /**
   * DPT5: 1 byte unsigned (0…255)
   */
  static encodeDpt5(data: DPT5): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 255) throw new Error("DPT5 value must be between 0 and 255");
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT5001: Percentage (0–100) encoded in 0–255 scale
   */
  static encodeDpt5001(data: DPT5001): Buffer {
    const value = this.extractValue(data);
    const encodedValue = Math.round((value / 100) * 255);
    return this.encodeDpt5({ value: encodedValue });
  }

  /**
   * DPT5002: Angle (0–360°) encoded in 0–255 scale
   */
  static encodeDpt5002(data: DPT5002): Buffer {
    const value = this.extractValue(data);
    const encodedValue = Math.round((value / 360) * 255);
    return this.encodeDpt5({ value: encodedValue });
  }

  /**
   * DPT6: 1 byte signed (-128…127)
   */
  static encodeDpt6(data: DPT6): Buffer {
    const value = this.extractValue(data);
    if (value < -128 || value > 127) throw new Error("DPT6 value must be between -128 and 127");
    const buffer = Buffer.alloc(1);
    buffer.writeInt8(value, 0);
    return buffer;
  }

  /**
   * DPT6001: Encoded same as DPT6 (for example, percentage expressed as numeric value)
   */
  static encodeDpt6001(data: DPT6): Buffer {
    return this.encodeDpt6(data);
  }

  /**
   * DPT6010: Counter pulses, encoded same as DPT6
   */
  static encodeDpt6010(data: DPT6): Buffer {
    return this.encodeDpt6(data);
  }

  /**
   * DPT6020: Status and mode in 1 byte:
   * Upper 5 bits (status) and lower 3 bits (mode)
   */
  static encodeDpt6020({ status, mode }: DPT6020): Buffer {
    const byte = (status << 3) | (mode & 0b111);
    const data = Buffer.alloc(1);
    data[0] = byte;
    return data;
  }

  /**
   * DPT7: 2-byte unsigned (0…65535)
   */
  static encodeDpt7(data: DPT7): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 65535) throw new Error("DPT7 value must be between 0 and 65535");
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(value, 0);
    return buffer;
  }

  /**
   * DPT7001: Pulses (same as DPT7)
   */
  static encodeDpt7001(data: DPT7): Buffer {
    return this.encodeDpt7(data);
  }

  /**
   * DPT7002: Time in ms (same as DPT7)
   */
  static encodeDpt7002(data: DPT7): Buffer {
    return this.encodeDpt7(data);
  }

  /**
   * DPT7003: Time in seconds (value in seconds scaled by multiplying by 100)
   */
  static encodeDpt7003(data: DPT7): Buffer {
    const value = this.extractValue(data);
    const scaled = Math.round(value * 100);
    return this.encodeDpt7({ value: scaled });
  }

  /**
   * DPT7004: Time in seconds (value in seconds scaled by multiplying by 10)
   */
  static encodeDpt7004(data: DPT7): Buffer {
    const value = this.extractValue(data);
    const scaled = Math.round(value * 10);
    return this.encodeDpt7({ value: scaled });
  }

  /**
   * DPT7005: Time in seconds (same as DPT7)
   */
  static encodeDpt7005(data: DPT7): Buffer {
    return this.encodeDpt7(data);
  }

  /**
   * DPT7006: Time in minutes (same as DPT7)
   */
  static encodeDpt7006(data: DPT7): Buffer {
    return this.encodeDpt7(data);
  }

  /**
   * DPT7007: Time in hours (same as DPT7)
   */
  static encodeDpt7007(data: DPT7): Buffer {
    return this.encodeDpt7(data);
  }

  /**
   * DPT7011: Distance in mm (same as DPT7)
   */
  static encodeDpt7011(data: DPT7): Buffer {
    return this.encodeDpt7(data);
  }

  /**
   * DPT7012: Bus power supply current in mA (same as DPT7)
   */
  static encodeDpt7012(data: DPT7): Buffer {
    return this.encodeDpt7(data);
  }

  /**
   * DPT7013: Light intensity in lux (same as DPT7)
   */
  static encodeDpt7013(data: DPT7): Buffer {
    return this.encodeDpt7(data);
  }

  /**
   * Encodes a 2-octet value (DPT8) in two's complement notation.
   * Range: [-32768 … 32767]
   *
   * @param data Object with value property to encode or direct numeric value.
   * @returns Buffer with encoded 2-octet value (big-endian).
   */
  static encodeDpt8(data: DPT8): Buffer {
    const value = this.extractValue(data);
    if (value < -32768 || value > 32767) {
      throw new Error("DPT8 value must be between -32768 and 32767");
    }
    const buffer = Buffer.alloc(2);
    buffer.writeInt16BE(value, 0);
    return buffer;
  }

  static encodeDpt9(data: DPT9): Buffer {
    const value = this.extractValue(data);
    // 1. Manejo de seguridad para valores no numéricos
    if (isNaN(value) || !isFinite(value)) {
      return Buffer.from([0x7f, 0xff]);
    }

    // 2. Cálculo inicial de la mantisa según la fórmula: Float = (0.01 * M) * 2^E
    // Despejamos M inicial (con E=0): M = Value / 0.01
    let m = value / 0.01;
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
    const encoded = (sign << 15) | (e << 11) | (mEncoded & 0x7ff);

    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(encoded, 0);
    return buffer;
  }

  /**
   * Encodes DPT10001 (Time of Day) into 3 octets.
   *
   * Structure:
   *  - Octet 1: bits 7-5 = Day (3 bits), bits 4-0 = Hour (5 bits)
   *  - Octet 2: bits 7-6 = reserved (0), bits 5-0 = Minutes (6 bits)
   *  - Octet 3: bits 7-6 = reserved (0), bits 5-0 = Seconds (6 bits)
   *
   * Range:
   *  - Day: 0 to 7
   *  - Hour: 0 to 23
   *  - Minutes: 0 to 59
   *  - Seconds: 0 to 59
   *
   * @param param0 Object with day, hour, minutes, and seconds.
   * @returns Buffer with the 3 encoded octets.
   */
  static encodeDpt10001({ day, hour, minutes, seconds }: DPT10001): Buffer {
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
    buffer[0] = ((day & 0x07) << 5) | (hour & 0x1f);

    // Octeto 2: Bits 7-6 reservados (0), Bits 5-0: Minutes
    buffer[1] = minutes & 0x3f; // 0x3F = 0b00111111

    // Octeto 3: Bits 7-6 reservados (0), Bits 5-0: Seconds
    buffer[2] = seconds & 0x3f;

    return buffer;
  }

  /**
   * Encodes DPT11001 (Date) into 3 octets.
   *
   * @param param0 Object with { day, month, year }.
   * @returns 3-octet Buffer with data encoded from MSB to LSB.
   */
  static encodeDpt11001({ day, month, year }: DPT11001): Buffer {
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

    let encodedYear: number;
    if (year < 2000) {
      encodedYear = year - 1900; // Ejemplo: 1999 → 99
    } else {
      encodedYear = year - 2000; // Ejemplo: 2004 → 4
    }

    // Octeto 3 (MSB): r3 (reservado 0) + U5 (día)
    const octet3 = (day & 0x1f) ^ 0x80;
    // Octeto 2: r4 (reservado 0) + U4 (mes)
    const octet2 = month & 0x0f;
    // Octeto 1 (LSB): r1 (reservado 0) + U7 (año)
    const octet1 = encodedYear & 0x7f;

    return Buffer.from([octet3, octet2, octet1]);
  }

  /**
   * Encodes DPT 12.001: DPT_Value_4_Ucount
   * @param data Object with { value } or direct numeric value.
   * @returns 4-octet Buffer with encoded value.
   */
  static encodeDpt12001(data: DPT12001): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 0xffffffff) {
      throw new Error("DPT 12.001 value must be between 0 and 4294967295");
    }
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value, 0);
    return buffer;
  }

  /**
   * Encodes DPT 12.100: DPT_LongTimePeriod_Sec
   */
  static encodeDpt12100(data: DPT12001): Buffer {
    return this.encodeDpt12001(data);
  }

  /**
   * Encodes DPT 12.101: DPT_LongTimePeriod_Min
   */
  static encodeDpt12101(data: DPT12001): Buffer {
    return this.encodeDpt12001(data);
  }

  /**
   * Encodes DPT 12.102: DPT_LongTimePeriod_Hrs
   */
  static encodeDpt12102(data: DPT12001): Buffer {
    return this.encodeDpt12001(data);
  }

  /**
   * Encodes DPT 13.001: DPT_Value_4_Count
   * @param data Object with { value } property or direct numeric value.
   * @returns 4-octet Buffer with encoded value in big-endian format.
   */
  static encodeDpt13001(data: DPT13001): Buffer {
    const value = this.extractValue(data);
    if (value < -2147483648 || value > 2147483647) {
      throw new Error("DPT 13.001 value must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value, 0);
    return buffer;
  }

  /**
   * Encodes DPT 13.002: DPT_FlowRate_m3/h
   */
  static encodeDpt13002(data: DPT13001): Buffer {
    const value = this.extractValue(data);
    const rawValue = Math.round(value * 10000);
    if (rawValue < -2147483648 || rawValue > 2147483647) {
      throw new Error("DPT 13.002 value, after scaling, must be between -2147483648 and 2147483647");
    }
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(rawValue, 0);
    return buffer;
  }

  /**
   * DPT 13.010: DPT_ActiveEnergy
   */
  static encodeDpt13010(data: DPT13001): Buffer {
    return this.encodeDpt13001(data);
  }

  /**
   * DPT 13.011: DPT_ApparantEnergy
   */
  static encodeDpt13011(data: DPT13001): Buffer {
    return this.encodeDpt13001(data);
  }

  /**
   * DPT 13.012: DPT_ReactiveEnergy
   */
  static encodeDpt13012(data: DPT13001): Buffer {
    return this.encodeDpt13001(data);
  }

  /**
   * DPT 13.013: DPT_ActiveEnergy_kWh
   */
  static encodeDpt13013(data: DPT13001): Buffer {
    return this.encodeDpt13001(data);
  }

  /**
   * DPT 13.014: DPT_ApparantEnergy_kVAh
   */
  static encodeDpt13014(data: DPT13001): Buffer {
    return this.encodeDpt13001(data);
  }

  /**
   * DPT 13.015: DPT_ReactiveEnergy_kVARh
   */
  static encodeDpt13015(data: DPT13001): Buffer {
    return this.encodeDpt13001(data);
  }

  /**
   * DPT 13.016: DPT_ActiveEnergy_MWh
   */
  static encodeDpt13016(data: DPT13001): Buffer {
    return this.encodeDpt13001(data);
  }

  /**
   * DPT 13.100: DPT_LongDeltaTimeSec
   */
  static encodeDpt13100(data: DPT13001): Buffer {
    return this.encodeDpt13001(data);
  }

  /**
   * Encodes DPT14: 4-Octet Float Value (IEEE 754 single precision).
   */
  static encodeDpt14(data: DPT14): Buffer {
    const value = this.extractValue(data);
    const buffer = Buffer.alloc(4);
    buffer.writeFloatBE(value, 0);
    return buffer;
  }

  /**
   * Encodes DPT15 (DPT_Access_Data) into 4 octets.
   */
  static encodeDpt15({ D6, D5, D4, D3, D2, D1, E, P, D, C, index }: DPT15): Buffer {
    if (D6 < 0 || D6 > 9) throw new Error("D6 must be between 0 and 9");
    if (D5 < 0 || D5 > 9) throw new Error("D5 must be between 0 and 9");
    if (D4 < 0 || D4 > 9) throw new Error("D4 must be between 0 and 9");
    if (D3 < 0 || D3 > 9) throw new Error("D3 must be between 0 and 9");
    if (D2 < 0 || D2 > 9) throw new Error("D2 must be between 0 and 9");
    if (D1 < 0 || D1 > 9) throw new Error("D1 must be between 0 and 9");
    if (index < 0 || index > 15) throw new Error("Index must be between 0 and 15");

    const partDigits =
      ((D6 & 0x0f) << 28) |
      ((D5 & 0x0f) << 24) |
      ((D4 & 0x0f) << 20) |
      ((D3 & 0x0f) << 16) |
      ((D2 & 0x0f) << 12) |
      ((D1 & 0x0f) << 8);

    const statusNibble = ((E & 1) << 3) | ((P & 1) << 2) | ((D & 1) << 1) | (C & 1);
    const partStatusIndex = ((statusNibble & 0x0f) << 4) | (index & 0x0f);
    const encoded = partDigits | partStatusIndex;

    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(encoded, 0);
    return buffer;
  }

  /**
   * Encodes DPT16: DPT_String_ASCII
   */
  static encodeDpt16({ text }: DPT16): Buffer {
    const maxLength = 14;
    const truncated = text.slice(0, maxLength);
    const buffer = Buffer.alloc(maxLength, 0x00);

    for (let i = 0; i < truncated.length; i++) {
      const charCode = truncated.charCodeAt(i);
      if (charCode > 127) {
        throw new Error(`Character "${truncated[i]}" is not in the ASCII range`);
      }
      buffer[i] = charCode;
    }
    return buffer;
  }

  /**
   * Encodes DPT 16.002 (unofficial) into 14 octets.
   */
  static encodeDpt16002({ hex }: DPT16002): Buffer {
    const cleanedHex = hex.replace(/\s+/g, "");
    if (cleanedHex.length % 2 !== 0) {
      throw new Error("Hex string must have an even number of digits");
    }

    const numBytes = cleanedHex.length / 2;
    if (numBytes > 14) {
      throw new Error("Hex string is too long; maximum 14 bytes (28 digits)");
    }

    let buffer = Buffer.from(cleanedHex, "hex");
    if (buffer.length < 14) {
      const padding = Buffer.alloc(14 - buffer.length, 0x00);
      buffer = Buffer.concat([buffer, padding]);
    }
    return buffer;
  }

  /**
   * Encodes DPT20: Datapoint Type N8
   */
  static encodeDpt20(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 255) {
      throw new Error("DPT20 value must be between 0 and 255");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.001: DPT_SCLOMode
   */
  static encodeDpt20001(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 3) {
      throw new Error("DPT 20.001 value must be between 0 and 3");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.002: DPT_BuildingMode
   */
  static encodeDpt20002(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 2) {
      throw new Error("DPT 20.002 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.003: DPT_OccMode
   */
  static encodeDpt20003(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 2) {
      throw new Error("DPT 20.003 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.004: DPT_Priority
   */
  static encodeDpt20004(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 3) {
      throw new Error("DPT 20.004 value must be between 0 and 3");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.005: DPT_LightApplicationMode
   */
  static encodeDpt20005(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 2) {
      throw new Error("DPT 20.005 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.006: DPT_ApplicationArea
   */
  static encodeDpt20006(data: DPT20): Buffer {
    const value = this.extractValue(data);
    const validValues = [0, 1, 10, 11, 12, 13, 14, 20, 30, 40, 50];
    if (!validValues.includes(value)) {
      throw new Error("DPT 20.006 value must be one of: " + validValues.join(", "));
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.007: DPT_AlarmClassType
   */
  static encodeDpt20007(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 3) {
      throw new Error("DPT 20.007 value must be between 0 and 3");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.008: DPT_PSUMode
   */
  static encodeDpt20008(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 2) {
      throw new Error("DPT 20.008 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.011: DPT_ErrorClass_System
   */
  static encodeDpt20011(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 18) {
      throw new Error("DPT 20.011 value must be between 0 and 18");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.012: DPT_ErrorClass_HVAC
   */
  static encodeDpt20012(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 4) {
      throw new Error("DPT 20.012 value must be between 0 and 4");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.013: DPT_Time_Delay
   */
  static encodeDpt20013(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 25) {
      throw new Error("DPT 20.013 value must be between 0 and 25");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.014: DPT_Beaufort_Wind_Force_Scale
   */
  static encodeDpt20014(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 12) {
      throw new Error("DPT 20.014 value must be between 0 and 12");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.017: DPT_SensorSelect
   */
  static encodeDpt20017(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 4) {
      throw new Error("DPT 20.017 value must be between 0 and 4");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.020: DPT_ActuatorConnectType
   */
  static encodeDpt20020(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value !== 1 && value !== 2) {
      throw new Error("DPT 20.020 value must be either 1 (SensorConnection) or 2 (ControllerConnection)");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.021: DPT_Cloud_Cover
   */
  static encodeDpt20021(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 9) {
      throw new Error("DPT 20.021 value must be between 0 and 9");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * DPT 20.022: DPT_PowerReturnMode
   */
  static encodeDpt20022(data: DPT20): Buffer {
    const value = this.extractValue(data);
    if (value < 0 || value > 2) {
      throw new Error("DPT 20.022 value must be between 0 and 2");
    }
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    return buffer;
  }

  /**
   * Encodes DPT 27.001: DPT_CombinedInfoOnOff into 4 octets.
   */
  static encodeDpt27001({ mask, status }: DPT27001): Buffer {
    if (mask < 0 || mask > 0xffff) throw new Error("mask must be between 0 and 65535");
    if (status < 0 || status > 0xffff) throw new Error("status must be between 0 and 65535");
    const encoded = (mask << 16) | (status & 0xffff);
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(encoded, 0);
    return buffer;
  }

  /**
   * Encodes DPT 28.001: DPT_UTF-8.
   */
  static encodeDpt28001(data: DPT28001): Buffer {
    const value = this.extractValue(data);
    const utf8Buffer = Buffer.from(value, "utf8");
    const nullTerminator = Buffer.from([0x00]);
    return Buffer.concat([utf8Buffer, nullTerminator]);
  }

  /**
   * Encodes DPT29: 4-Octet Signed Value (V64) into 8 octets.
   */
  static encodeDpt29(data: DPT29): Buffer {
    const value = this.extractValue(data);
    const min = -9223372036854775808n;
    const max = 9223372036854775807n;
    if (value < min || value > max) {
      throw new Error("DPT29 value must be between -9223372036854775808 and 9223372036854775807");
    }
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(value, 0);
    return buffer;
  }

  static encodeDpt238600({ BF, LF, Addr }: DPT238600): Buffer {
    if (BF !== 0 && BF !== 1) throw new Error("BF must be 0 or 1");
    if (LF !== 0 && LF !== 1) throw new Error("LF must be 0 or 1");
    if (Addr < 0 || Addr > 63) throw new Error("Addr must be between 0 and 63");
    const byte = (BF << 7) | (LF << 6) | (Addr & 0x3f);
    return Buffer.from([byte]);
  }

  /**
   * Encodes DPT 245.600: DPT_Converter_Test_Result into 6 octets.
   */
  static encodeDpt245600({ LTRF, LTRD, LTRP, SF, SD, SP, LDTR, LPDTR }: DPT245600): Buffer {
    if (LTRF < 0 || LTRF > 15) throw new Error("LTRF must be between 0 and 15");
    if (LTRD < 0 || LTRD > 15) throw new Error("LTRD must be between 0 and 15");
    if (LTRP < 0 || LTRP > 15) throw new Error("LTRP must be between 0 and 15");
    if (SF < 0 || SF > 3) throw new Error("SF must be between 0 and 3");
    if (SD < 0 || SD > 3) throw new Error("SD must be between 0 and 3");
    if (SP < 0 || SP > 3) throw new Error("SP must be between 0 and 3");
    if (LDTR < 0 || LDTR > 0xffff) throw new Error("LDTR must be between 0 and 65535");
    if (LPDTR < 0 || LPDTR > 255) throw new Error("LPDTR must be between 0 and 255");

    let encoded = 0;
    encoded += (LTRF & 0x0f) * Math.pow(2, 44);
    encoded += (LTRD & 0x0f) * Math.pow(2, 40);
    encoded += (LTRP & 0x0f) * Math.pow(2, 36);
    encoded += (SF & 0x03) * Math.pow(2, 30);
    encoded += (SD & 0x03) * Math.pow(2, 28);
    encoded += (SP & 0x03) * Math.pow(2, 26);
    encoded += (LDTR & 0xffff) * Math.pow(2, 8);
    encoded += LPDTR & 0xff;

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
   * Encodes DPT 250600: DPT_Brightness_Colour_Temperature_Control into 3 octets.
   */
  static encodeDpt250600({ cCT, stepCodeCT, cB, stepCodeB, validCT, validB }: DPT250600): Buffer {
    if (stepCodeCT < 0 || stepCodeCT > 7) throw new Error("stepCodeCT must be between 0 and 7");
    if (stepCodeB < 0 || stepCodeB > 7) throw new Error("stepCodeB must be between 0 and 7");
    const octet3 = ((cCT & 0x01) << 3) | (stepCodeCT & 0x07);
    const octet2 = ((cB & 0x01) << 3) | (stepCodeB & 0x07);
    const octet1 = ((validCT & 0x01) << 1) | (validB & 0x01);
    return Buffer.from([octet3, octet2, octet1]);
  }

  /**
   * Encodes DPT 251.600: DPT_Colour_RGBW into 6 octets.
   */
  static encodeDpt251600({ R, G, B, W, mR, mG, mB, mW }: DPT251600): Buffer {
    if (R < 0 || R > 255) throw new Error("R must be between 0 and 255");
    if (G < 0 || G > 255) throw new Error("G must be between 0 and 255");
    if (B < 0 || B > 255) throw new Error("B must be between 0 and 255");
    if (W < 0 || W > 255) throw new Error("W must be between 0 and 255");

    const buffer = Buffer.alloc(6);
    buffer[0] = R;
    buffer[1] = G;
    buffer[2] = B;
    buffer[3] = W;
    buffer[4] = 0x00;
    buffer[5] = ((mR & 1) << 3) | ((mG & 1) << 2) | ((mB & 1) << 1) | (mW & 1);
    return buffer;
  }
}
