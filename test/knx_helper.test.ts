import { KNXHelper } from "../src/utils/KNXHelper";
import { InvalidKnxAddressException } from "../src/errors/InvalidKnxAddresExeption";

describe("KNXHelper.individualAddressToString", () => {
  test("converts 16-bit numeric individual addresses to area.line.device string", () => {
    expect(KNXHelper.individualAddressToString(0x0000)).toBe("0.0.0");
    expect(KNXHelper.individualAddressToString(0x1101)).toBe("1.1.1");
    expect(KNXHelper.individualAddressToString(0xff00)).toBe("15.15.0");
    expect(KNXHelper.individualAddressToString(0xffff)).toBe("15.15.255");
    expect(KNXHelper.individualAddressToString(0x2345)).toBe("2.3.69");
  });

  test("throws InvalidKnxAddressException on out-of-range or non-integer values", () => {
    expect(() => KNXHelper.individualAddressToString(-1)).toThrow(InvalidKnxAddressException);
    expect(() => KNXHelper.individualAddressToString(0x10000)).toThrow(InvalidKnxAddressException);
    expect(() => KNXHelper.individualAddressToString(1.5)).toThrow(InvalidKnxAddressException);
    expect(() => KNXHelper.individualAddressToString(Number.NaN)).toThrow(InvalidKnxAddressException);
  });
});
