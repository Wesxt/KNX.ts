import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CEMI } from "../src/core/CEMI";

type XmlTelegram = {
  service: string;
  rawData: string;
};

const xmlFixture = join(__dirname, "..", "test_xml", "Programacion_exitosa_del_knx_usb 2 (1).xml");
const xmlFixture2 = join(__dirname, "../../", "test_xml", "Programacion_exitosa_del_knx_usb 2 (1).xml");

function readTelegramsFromXml(): XmlTelegram[] {
  try {
    const xml = readFileSync(xmlFixture, "utf8");
    return [
      ...xml.matchAll(/<Telegram\b[^>]*Service="([^"]+)"[^>]*FrameFormat="CommonEmi"[^>]*RawData="([0-9A-F]+)"/g),
    ].map((match) => ({
      service: match[1],
      rawData: match[2],
    }));
  } catch {
    const xml = readFileSync(xmlFixture2, "utf8");
    return [
      ...xml.matchAll(/<Telegram\b[^>]*Service="([^"]+)"[^>]*FrameFormat="CommonEmi"[^>]*RawData="([0-9A-F]+)"/g),
    ].map((match) => ({
      service: match[1],
      rawData: match[2],
    }));
  }
}

describe("CEMI - programación exitosa por KNX USB", () => {
  test("decodifica y codifica todos los telegramas CommonEmi del XML", () => {
    const telegrams = readTelegramsFromXml();

    expect(telegrams).toHaveLength(167);

    for (const telegram of telegrams) {
      const cemi = CEMI.fromBuffer(Buffer.from(telegram.rawData, "hex"));
      const description = cemi.describe();

      expect(description.obj).toBe(telegram.service.replaceAll(".", "_"));
      expect(cemi.toBuffer().toString("hex").toUpperCase()).toBe(telegram.rawData);
    }
  });
});
