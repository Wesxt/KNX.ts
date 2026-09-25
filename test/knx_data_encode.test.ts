import { KnxDataEncoder } from "../src/core/data/KNXDataEncode";
import { InvalidParametersForDpt } from "../src/errors/DPTNotFound";

describe("KnxDataEncoder - Raw Values and Detailed Validation", () => {
  describe("Value-only DPTs: accept raw primitive values as well as { value }", () => {
    test("DPT 1: accepts boolean directly and { value: boolean }", () => {
      const buf1 = KnxDataEncoder.encodeThis(1, true);
      const buf2 = KnxDataEncoder.encodeThis(1, { value: true });
      const buf3 = KnxDataEncoder.encodeThis(1, false);
      const buf4 = KnxDataEncoder.encodeThis(1, { value: false });

      expect(buf1).toEqual(Buffer.from([0x01]));
      expect(buf2).toEqual(Buffer.from([0x01]));
      expect(buf3).toEqual(Buffer.from([0x00]));
      expect(buf4).toEqual(Buffer.from([0x00]));

      // Direct method call
      expect(KnxDataEncoder.encodeDpt1(true)).toEqual(Buffer.from([0x01]));
      expect(KnxDataEncoder.encodeDpt1({ value: false })).toEqual(Buffer.from([0x00]));
    });

    test("DPT 5: accepts number directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(5, 128);
      const buf2 = KnxDataEncoder.encodeThis(5, { value: 128 });
      expect(buf1).toEqual(Buffer.from([128]));
      expect(buf2).toEqual(Buffer.from([128]));

      expect(KnxDataEncoder.encodeDpt5(200)).toEqual(Buffer.from([200]));
      expect(KnxDataEncoder.encodeDpt5({ value: 200 })).toEqual(Buffer.from([200]));
    });

    test("DPT 5.001 (Percentage): accepts number directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(5001, 100);
      const buf2 = KnxDataEncoder.encodeThis(5001, { value: 100 });
      expect(buf1).toEqual(Buffer.from([255]));
      expect(buf2).toEqual(Buffer.from([255]));

      expect(KnxDataEncoder.encodeDpt5001(50)).toEqual(Buffer.from([128]));
      expect(KnxDataEncoder.encodeDpt5001({ value: 50 })).toEqual(Buffer.from([128]));
    });

    test("DPT 5.002 (Angle): accepts number directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(5002, 360);
      const buf2 = KnxDataEncoder.encodeThis(5002, { value: 360 });
      expect(buf1).toEqual(Buffer.from([255]));
      expect(buf2).toEqual(Buffer.from([255]));

      expect(KnxDataEncoder.encodeDpt5002(180)).toEqual(Buffer.from([128]));
    });

    test("DPT 6: accepts signed number directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(6, -50);
      const buf2 = KnxDataEncoder.encodeThis(6, { value: -50 });
      expect(buf1.readInt8(0)).toBe(-50);
      expect(buf2.readInt8(0)).toBe(-50);

      expect(KnxDataEncoder.encodeDpt6(25).readInt8(0)).toBe(25);
    });

    test("DPT 7: accepts 16-bit unsigned number directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(7, 5000);
      const buf2 = KnxDataEncoder.encodeThis(7, { value: 5000 });
      expect(buf1.readUInt16BE(0)).toBe(5000);
      expect(buf2.readUInt16BE(0)).toBe(5000);

      expect(KnxDataEncoder.encodeDpt7(65000).readUInt16BE(0)).toBe(65000);
      expect(KnxDataEncoder.encodeDpt7001(1234).readUInt16BE(0)).toBe(1234);
    });

    test("DPT 8: accepts 16-bit signed number directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(8, -25000);
      const buf2 = KnxDataEncoder.encodeThis(8, { value: -25000 });
      expect(buf1.readInt16BE(0)).toBe(-25000);
      expect(buf2.readInt16BE(0)).toBe(-25000);

      expect(KnxDataEncoder.encodeDpt8(1234).readInt16BE(0)).toBe(1234);
    });

    test("DPT 9: accepts 2-byte float directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(9, 21.5);
      const buf2 = KnxDataEncoder.encodeThis(9, { value: 21.5 });
      expect(buf1).toEqual(buf2);

      expect(KnxDataEncoder.encodeDpt9(21.5)).toEqual(buf1);
    });

    test("DPT 12: accepts 32-bit unsigned number directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(12001, 100000);
      const buf2 = KnxDataEncoder.encodeThis(12001, { value: 100000 });
      expect(buf1.readUInt32BE(0)).toBe(100000);
      expect(buf2.readUInt32BE(0)).toBe(100000);

      expect(KnxDataEncoder.encodeDpt12001(500000).readUInt32BE(0)).toBe(500000);
    });

    test("DPT 13: accepts 32-bit signed number directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(13001, -100000);
      const buf2 = KnxDataEncoder.encodeThis(13001, { value: -100000 });
      expect(buf1.readInt32BE(0)).toBe(-100000);
      expect(buf2.readInt32BE(0)).toBe(-100000);

      expect(KnxDataEncoder.encodeDpt13001(-500).readInt32BE(0)).toBe(-500);
    });

    test("DPT 14: accepts 4-byte float directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(14, 3.14159);
      const buf2 = KnxDataEncoder.encodeThis(14, { value: 3.14159 });
      expect(buf1.readFloatBE(0)).toBeCloseTo(3.14159);
      expect(buf2.readFloatBE(0)).toBeCloseTo(3.14159);

      expect(KnxDataEncoder.encodeDpt14(10.5).readFloatBE(0)).toBeCloseTo(10.5);
    });

    test("DPT 20: accepts enum number directly and { value: number }", () => {
      const buf1 = KnxDataEncoder.encodeThis(20, 15);
      const buf2 = KnxDataEncoder.encodeThis(20, { value: 15 });
      expect(buf1).toEqual(Buffer.from([15]));
      expect(buf2).toEqual(Buffer.from([15]));

      expect(KnxDataEncoder.encodeDpt20(7)).toEqual(Buffer.from([7]));
      expect(KnxDataEncoder.encodeDpt20001(2)).toEqual(Buffer.from([2]));
    });

    test("DPT 28.001: accepts UTF-8 string directly and { value: string }", () => {
      const buf1 = KnxDataEncoder.encodeThis(28001, "Hola KNX");
      const buf2 = KnxDataEncoder.encodeThis(28001, { value: "Hola KNX" });
      expect(buf1).toEqual(buf2);
      expect(buf1.toString("utf8")).toBe("Hola KNX\0");

      expect(KnxDataEncoder.encodeDpt28001("Test").toString("utf8")).toBe("Test\0");
    });

    test("DPT 29: accepts 64-bit BigInt directly and { value: bigint }", () => {
      const big = 123456789012345n;
      const buf1 = KnxDataEncoder.encodeThis(29, big);
      const buf2 = KnxDataEncoder.encodeThis(29, { value: big });
      expect(buf1.readBigInt64BE(0)).toBe(big);
      expect(buf2.readBigInt64BE(0)).toBe(big);

      expect(KnxDataEncoder.encodeDpt29(-999999n).readBigInt64BE(0)).toBe(-999999n);
    });
  });

  describe("Refined incoming data verification: reports exact property and reason", () => {
    test("reports missing property for DPT 2", () => {
      try {
        KnxDataEncoder.encodeThis(2, { control: 1 } as any);
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.dpt).toBe(2);
        expect(error.property).toBe("value");
        expect(error.message).toContain('property "value" is invalid');
        expect(error.reason).toContain('Missing required property "value"');
      }
    });

    test("reports invalid type for DPT 1", () => {
      try {
        KnxDataEncoder.encodeThis(1, "invalid" as any);
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.dpt).toBe(1);
        expect(error.property).toBe("value");
        expect(error.expected).toBe("boolean");
        expect(error.received).toBe("invalid");
        expect(error.message).toContain('must be of type boolean, but received string');
      }
    });

    test("reports out-of-range value for DPT 5001", () => {
      try {
        KnxDataEncoder.encodeThis(5001, 150);
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.dpt).toBe(5001);
        expect(error.property).toBe("value");
        expect(error.received).toBe(150);
        expect(error.reason).toContain("exceeds maximum 100");
      }
    });

    test("reports exact missing property in DPT 10001 (Time of Day)", () => {
      try {
        KnxDataEncoder.encodeThis(10001, { day: 1, hour: 12, minutes: 30 } as any);
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.dpt).toBe(10001);
        expect(error.property).toBe("seconds");
        expect(error.reason).toContain('Missing required property "seconds"');
      }
    });

    test("reports out-of-range property in DPT 10001", () => {
      try {
        KnxDataEncoder.encodeThis(10001, { day: 1, hour: 25, minutes: 30, seconds: 0 });
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.dpt).toBe(10001);
        expect(error.property).toBe("hour");
        expect(error.received).toBe(25);
        expect(error.reason).toContain("exceeds maximum 23");
      }
    });

    test("reports exact invalid property in DPT 11001 (Date)", () => {
      try {
        KnxDataEncoder.encodeThis(11001, { day: 32, month: 5, year: 2024 });
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.dpt).toBe(11001);
        expect(error.property).toBe("day");
        expect(error.received).toBe(32);
        expect(error.reason).toContain("exceeds maximum 31");
      }
    });

    test("reports exact invalid property in DPT 251600 (RGBW)", () => {
      try {
        KnxDataEncoder.encodeThis(251600, {
          R: 255,
          G: 200,
          B: 150,
          W: 50,
          mR: 1,
          mG: 1,
          mB: 1,
          // missing mW
        } as any);
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.dpt).toBe(251600);
        expect(error.property).toBe("mW");
        expect(error.reason).toContain('Missing required property "mW"');
      }
    });

    test("reports non-object input for complex DPT", () => {
      try {
        KnxDataEncoder.encodeThis(10001, 12345 as any);
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.dpt).toBe(10001);
        expect(error.reason).toContain("The parameter is not an object");
      }
    });

    test("reports null input", () => {
      try {
        KnxDataEncoder.encodeThis(1, null as any);
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.reason).toContain("Input data is null or undefined");
      }
    });
  });

  describe("Regression fixes for specific DPTs", () => {
    test("DPT 16002: successfully encodes valid hex string", () => {
      const hex = "4A5F3C2E";
      const buf = KnxDataEncoder.encodeThis(16002, { hex });
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBe(14);
      expect(buf.slice(0, 4)).toEqual(Buffer.from(hex, "hex"));
    });

    test("DPT 16002: rejects non-string hex with detailed error", () => {
      try {
        KnxDataEncoder.encodeThis(16002, { hex: 12345 } as any);
        fail("Should have thrown InvalidParametersForDpt");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidParametersForDpt);
        const error = err as InvalidParametersForDpt;
        expect(error.dpt).toBe(16002);
        expect(error.property).toBe("hex");
        expect(error.expected).toBe("string");
      }
    });

    test("DPT 250600: successfully encodes object with property cCT", () => {
      const data = {
        cCT: 1 as const,
        stepCodeCT: 3,
        cB: 0 as const,
        stepCodeB: 2,
        validCT: 1 as const,
        validB: 1 as const,
      };
      const buf = KnxDataEncoder.encodeThis(250600, data);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBe(3);
    });

    test("DPT 15: successfully encodes with property C", () => {
      const data = {
        D6: 1,
        D5: 2,
        D4: 3,
        D3: 4,
        D2: 5,
        D1: 6,
        E: 1 as const,
        P: 0 as const,
        D: 1 as const,
        C: 1 as const,
        index: 5,
      };
      const buf = KnxDataEncoder.encodeThis(15, data);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBe(4);
    });
  });

  describe("encodeThisOnlyVerify consistency", () => {
    test("validates and returns data without encoding", () => {
      const verified = KnxDataEncoder.encodeThisOnlyVerify(1, true);
      expect(verified).toBe(true);

      const verifiedObj = KnxDataEncoder.encodeThisOnlyVerify(5001, { value: 75 });
      expect(verifiedObj).toEqual({ value: 75 });
    });

    test("throws same detailed error on invalid data", () => {
      expect(() => KnxDataEncoder.encodeThisOnlyVerify(5001, 150)).toThrow(InvalidParametersForDpt);
    });
  });
});
