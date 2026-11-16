import { TcpFrameReader } from "../src/connection/TcpFrameReader";

describe("TcpFrameReader (03_08_02 §8.4.3.3 & 08_TSSK 2.5.4-2.5.9)", () => {
  const frameA = Buffer.from("06100207001001000802000000000000", "hex"); // 16 bytes
  const frameB = Buffer.from("0610020800080100", "hex"); // 8 bytes

  test("reassembles frames arriving 1 byte at a time", () => {
    const reader = new TcpFrameReader();
    const collected: Buffer[] = [];
    const combined = Buffer.concat([frameA, frameB]);

    for (let i = 0; i < combined.length; i++) {
      const out = reader.push(combined.subarray(i, i + 1));
      collected.push(...out);
    }

    expect(collected).toHaveLength(2);
    expect(collected[0].equals(frameA)).toBe(true);
    expect(collected[1].equals(frameB)).toBe(true);
    expect(reader.hasPendingBytes).toBe(false);
  });

  test("splits multiple frames arriving in a single TCP chunk", () => {
    const reader = new TcpFrameReader();
    const out = reader.push(Buffer.concat([frameA, frameB]));
    expect(out).toHaveLength(2);
    expect(out[0].equals(frameA)).toBe(true);
    expect(out[1].equals(frameB)).toBe(true);
  });

  test("throws on wrong header length (08_TSSK 2.5.4)", () => {
    const reader = new TcpFrameReader();
    expect(() => reader.push(Buffer.from("0510020800080100", "hex"))).toThrow(/invalid header length/);
  });

  test("throws on totalLength < 6 (08_TSSK 2.5.6)", () => {
    const reader = new TcpFrameReader();
    expect(() => reader.push(Buffer.from("061004200000", "hex"))).toThrow(/invalid total length/);
  });

  test("skips oversized frames without closing TCP and parses subsequent frame (03_08_02 §8.4.3.3 / 08_TSSK 2.5.8)", () => {
    const reader = new TcpFrameReader({ maxFrameLength: 32 });
    const oversizedLen = 100;
    const oversizedHeader = Buffer.from([0x06, 0x10, 0x04, 0x20, 0x00, oversizedLen]);
    const oversizedBody = Buffer.alloc(oversizedLen - 6, 0xaa);

    // Send header + first half of body
    expect(reader.push(Buffer.concat([oversizedHeader, oversizedBody.subarray(0, 40)]))).toEqual([]);
    expect(reader.hasPendingBytes).toBe(true);

    // Send remaining body + valid frameB
    const frames = reader.push(Buffer.concat([oversizedBody.subarray(40), frameB]));
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(frameB)).toBe(true);
    expect(reader.hasPendingBytes).toBe(false);
  });

  test("skips frames with unsupported protocol version when closeOnUnsupportedVersion is false", () => {
    const reader = new TcpFrameReader({ closeOnUnsupportedVersion: false });
    const badVerFrame = Buffer.from("062004200008aabb", "hex");
    const frames = reader.push(Buffer.concat([badVerFrame, frameB]));
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(frameB)).toBe(true);
  });
});
