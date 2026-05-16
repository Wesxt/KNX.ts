import { CEMI } from "../src/core/CEMI";

describe("CEMI Decoding and Encoding Reproduction", () => {
  test("should decode and encode L_Data.ind DeviceDescriptorResponse correctly", () => {
    const raw = Buffer.from("2900B050113E11FA03434007B0", "hex");
    const cemi = CEMI.fromBuffer(raw);

    console.log("Decoded CEMI:", JSON.stringify(cemi.describe(), null, 2));

    const encoded = cemi.toBuffer();
    expect(encoded.toString("hex").toUpperCase()).toBe(raw.toString("hex").toUpperCase());
  });

  test("should decode and encode L_Data.req DeviceDescriptorRead correctly", () => {
    const raw = Buffer.from("1100B06011FA113E014300", "hex");
    const cemi = CEMI.fromBuffer(raw);

    console.log("Decoded Req:", JSON.stringify(cemi.describe(), null, 2));

    const encoded = cemi.toBuffer();
    expect(encoded.toString("hex").toUpperCase()).toBe(raw.toString("hex").toUpperCase());
  });

  test("should decode and encode IndividualAddressRead correctly", () => {
    const raw = Buffer.from("1100B0E011FA0000010100", "hex");
    const cemi = CEMI.fromBuffer(raw);

    console.log("Decoded IA Read:", JSON.stringify(cemi.describe(), null, 2));

    const encoded = cemi.toBuffer();
    expect(encoded.toString("hex").toUpperCase()).toBe(raw.toString("hex").toUpperCase());
  });

  test("should handle empty data in TPDU correctly", () => {
    const raw = Buffer.from("2900B06011FA113E0080", "hex"); // L_Data.ind with empty payload
    const cemi = CEMI.fromBuffer(raw);
    const encoded = cemi.toBuffer();
    expect(encoded.toString("hex").toUpperCase()).toBe(raw.toString("hex").toUpperCase());
  });

  test("should preserve short GroupValueWrite boolean true data", () => {
    const raw = Buffer.from("1100B4E011FA0001010081", "hex");
    const cemi = CEMI.fromBuffer(raw);

    expect(cemi.TPDU.apdu.isShort).toBe(true);
    expect(cemi.TPDU.apdu.data).toEqual(Buffer.from([0x01]));
    expect(cemi.toBuffer().toString("hex").toUpperCase()).toBe(raw.toString("hex").toUpperCase());
  });
});
