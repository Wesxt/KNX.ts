import { KnxDataDecode } from "../src/core/data/KNXDataDecode";

describe("KnxDataDecode DPT7", () => {
  test("decodes DPT7.001 (pulses) as object with value and unit", () => {
    const buf = Buffer.from([0x00, 0x0a]); // 10
    const decoded = KnxDataDecode.decodeThis(7001, buf);
    expect(decoded).toEqual({
      value: 10,
      unit: "pulses",
    });
  });

  test("decodes DPT7.002 (ms) as object with value and unit", () => {
    const buf = Buffer.from([0x01, 0xf4]); // 500
    const decoded = KnxDataDecode.decodeThis("7.002", buf);
    expect(decoded).toEqual({
      value: 500,
      unit: "ms",
    });
  });

  test("decodes DPT7.003 (10ms) as object with value and unit", () => {
    const buf = Buffer.from([0x00, 0x64]); // 100 -> / 100 = 1s
    const decoded = KnxDataDecode.decodeThis("7.003", buf);
    expect(decoded).toEqual({
      value: 1,
      unit: "s",
    });
  });

  test("decodes DPT7.004 (100ms) as object with value and unit", () => {
    const buf = Buffer.from([0x00, 0x32]); // 50 -> / 10 = 5s
    const decoded = KnxDataDecode.decodeThis("7.004", buf);
    expect(decoded).toEqual({
      value: 5,
      unit: "s",
    });
  });

  test("decodes DPT7.005 (s) as object with value and unit", () => {
    const buf = Buffer.from([0x00, 0x3c]); // 60
    const decoded = KnxDataDecode.decodeThis(7005, buf);
    expect(decoded).toEqual({
      value: 60,
      unit: "s",
    });
  });

  test("decodes DPT7.006 (min) as object with value and unit", () => {
    const buf = Buffer.from([0x00, 0x0f]); // 15
    const decoded = KnxDataDecode.decodeThis(7006, buf);
    expect(decoded).toEqual({
      value: 15,
      unit: "min",
    });
  });

  test("decodes DPT7.007 (h) as object with value and unit", () => {
    const buf = Buffer.from([0x00, 0x18]); // 24
    const decoded = KnxDataDecode.decodeThis(7007, buf);
    expect(decoded).toEqual({
      value: 24,
      unit: "h",
    });
  });

  test("decodes DPT7.011 (mm) as object with value and unit", () => {
    const buf = Buffer.from([0x00, 0x64]); // 100
    const decoded = KnxDataDecode.decodeThis(7011, buf);
    expect(decoded).toEqual({
      value: 100,
      unit: "mm",
    });
  });

  test("decodes DPT7.012 (mA) as object with value, unit, and status", () => {
    const buf = Buffer.from([0x00, 0xfa]); // 250
    const decoded = KnxDataDecode.decodeThis(7012, buf);
    expect(decoded).toEqual({
      value: 250,
      unit: "mA",
      status: "",
    });
  });

  test("decodes DPT7.013 (lux) as object with value and unit", () => {
    const buf = Buffer.from([0x01, 0x00]); // 256
    const decoded = KnxDataDecode.decodeThis(7013, buf);
    expect(decoded).toEqual({
      value: 256,
      unit: "lux",
    });
  });
});
