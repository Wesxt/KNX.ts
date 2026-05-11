import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CEMI } from "../src/core/CEMI";

type ExpectedTelegram = {
  service: string;
  rawData: string;
  sourceAddress: string;
  destinationAddress: string;
  hopCount: number;
  tpciType: string;
  sequenceNumber?: number;
  apciCommand?: string;
  data?: string;
};

const fixturesDir = join(__dirname, "..", "03 Volume 3 System Specifications");
const txtFixture = join(fixturesDir, "comprobación de dirección individual.txt");
const xmlFixture = join(fixturesDir, "comprobación de dirección individual (1).xml");

const expectedTelegrams: ExpectedTelegram[] = [
  {
    service: "L_Data.con",
    rawData: "2E00B06011FA123F0080",
    sourceAddress: "1.1.250",
    destinationAddress: "1.2.63",
    hopCount: 6,
    tpciType: "T_CONNECT_PDU",
  },
  {
    service: "L_Data.con",
    rawData: "2E00B06011FA123F014300",
    sourceAddress: "1.1.250",
    destinationAddress: "1.2.63",
    hopCount: 6,
    tpciType: "T_Data_Connected_PDU",
    sequenceNumber: 0,
    apciCommand: "A_DeviceDescriptor_Read_Protocol_Data_Unit",
    data: "00",
  },
  {
    service: "L_Data.ind",
    rawData: "2900B060123F11FA00C2",
    sourceAddress: "1.2.63",
    destinationAddress: "1.1.250",
    hopCount: 6,
    tpciType: "T_ACK_PDU",
    sequenceNumber: 0,
  },
  {
    service: "L_Data.ind",
    rawData: "2900B060123F11FA03434007B0",
    sourceAddress: "1.2.63",
    destinationAddress: "1.1.250",
    hopCount: 6,
    tpciType: "T_Data_Connected_PDU",
    sequenceNumber: 0,
    apciCommand: "A_DeviceDescriptor_Response_Protocol_Data_Unit",
    data: "07B0",
  },
  {
    service: "L_Data.con",
    rawData: "2E00B06011FA123F00C2",
    sourceAddress: "1.1.250",
    destinationAddress: "1.2.63",
    hopCount: 6,
    tpciType: "T_ACK_PDU",
    sequenceNumber: 0,
  },
  {
    service: "L_Data.con",
    rawData: "2E00B06011FA123F0547D500381001",
    sourceAddress: "1.1.250",
    destinationAddress: "1.2.63",
    hopCount: 6,
    tpciType: "T_Data_Connected_PDU",
    sequenceNumber: 1,
    apciCommand: "A_PropertyValue_Read_Protocol_Data_Unit",
    data: "00381001",
  },
  {
    service: "L_Data.ind",
    rawData: "2900B060123F11FA00C6",
    sourceAddress: "1.2.63",
    destinationAddress: "1.1.250",
    hopCount: 6,
    tpciType: "T_ACK_PDU",
    sequenceNumber: 1,
  },
  {
    service: "L_Data.ind",
    rawData: "2900B060123F11FA0747D60038100100FE",
    sourceAddress: "1.2.63",
    destinationAddress: "1.1.250",
    hopCount: 6,
    tpciType: "T_Data_Connected_PDU",
    sequenceNumber: 1,
    apciCommand: "A_PropertyValue_Response_Protocol_Data_Unit",
    data: "0038100100FE",
  },
  {
    service: "L_Data.con",
    rawData: "2E00B06011FA123F00C6",
    sourceAddress: "1.1.250",
    destinationAddress: "1.2.63",
    hopCount: 6,
    tpciType: "T_ACK_PDU",
    sequenceNumber: 1,
  },
  {
    service: "L_Data.con",
    rawData: "2E00B06011FA123F054BD500361001",
    sourceAddress: "1.1.250",
    destinationAddress: "1.2.63",
    hopCount: 6,
    tpciType: "T_Data_Connected_PDU",
    sequenceNumber: 2,
    apciCommand: "A_PropertyValue_Read_Protocol_Data_Unit",
    data: "00361001",
  },
  {
    service: "L_Data.ind",
    rawData: "2900B060123F11FA00CA",
    sourceAddress: "1.2.63",
    destinationAddress: "1.1.250",
    hopCount: 6,
    tpciType: "T_ACK_PDU",
    sequenceNumber: 2,
  },
  {
    service: "L_Data.ind",
    rawData: "2900B060123F11FA064BD60036100100",
    sourceAddress: "1.2.63",
    destinationAddress: "1.1.250",
    hopCount: 6,
    tpciType: "T_Data_Connected_PDU",
    sequenceNumber: 2,
    apciCommand: "A_PropertyValue_Response_Protocol_Data_Unit",
    data: "0036100100",
  },
  {
    service: "L_Data.con",
    rawData: "2E00B06011FA123F00CA",
    sourceAddress: "1.1.250",
    destinationAddress: "1.2.63",
    hopCount: 6,
    tpciType: "T_ACK_PDU",
    sequenceNumber: 2,
  },
  {
    service: "L_Data.con",
    rawData: "2E00B06011FA123F0081",
    sourceAddress: "1.1.250",
    destinationAddress: "1.2.63",
    hopCount: 6,
    tpciType: "T_DISCONNECT_PDU",
  },
];

function readRawDataFromXml(): string[] {
  const xml = readFileSync(xmlFixture, "utf8");
  return [...xml.matchAll(/RawData="([0-9A-F]+)"/g)].map((match) => match[1]);
}

function readTechnicalServicesFromTxt(): string[] {
  const txt = readFileSync(txtFixture, "utf8");
  return txt
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split("\t")[10]);
}

function expectTpci(description: any, expected: ExpectedTelegram): void {
  const tpci = description.TPDU.tpci;

  if (expected.tpciType === "T_Data_Connected_PDU") {
    expect(tpci.dataOrControlFlag).toBe("Data");
    expect(tpci.numbered).toBe(true);
    expect(tpci.sequenceNumber).toBe(expected.sequenceNumber);
    return;
  }

  if (expected.tpciType === "T_ACK_PDU") {
    expect(tpci.dataOrControlFlag).toBe("Control");
    expect(tpci.numbered).toBe(true);
    expect(tpci.sequenceNumber).toBe(expected.sequenceNumber ?? 0);
    return;
  }

  expect(tpci.TPCIType).toBe(expected.tpciType);
}

describe("CEMI - comprobación de dirección individual", () => {
  test("decodifica y codifica todos los telegramas CommonEmi del XML", () => {
    const rawDataFromXml = readRawDataFromXml();

    expect(rawDataFromXml).toEqual(expectedTelegrams.map((telegram) => telegram.rawData));

    for (const expected of expectedTelegrams) {
      const cemi = CEMI.fromBuffer(Buffer.from(expected.rawData, "hex"));
      const description = cemi.describe() as any;

      expect(description.obj).toBe(expected.service.replaceAll(".", "_"));
      expect(description.sourceAddress).toBe(expected.sourceAddress);
      expect(description.destinationAddress).toBe(expected.destinationAddress);
      expect(description.controlField2.hopCount).toBe(expected.hopCount);
      expect(description.controlField2.addressType).toBe("INDIVIDUAL(0)");
      expectTpci(description, expected);

      if (expected.apciCommand) {
        expect(description.TPDU.APDU.apci.command).toBe(expected.apciCommand);
      }

      if (expected.data) {
        expect(description.TPDU.APDU.data.toString("hex").toUpperCase()).toBe(expected.data);
      }

      expect(cemi.toBuffer().toString("hex").toUpperCase()).toBe(expected.rawData);
    }
  });

  test("mantiene la misma secuencia técnica descrita en el TXT", () => {
    expect(readTechnicalServicesFromTxt()).toEqual([
      "T_Connect",
      "DeviceDescriptorRead (S=0)",
      "T_ACK (S=0)",
      "DeviceDescriptorResponse (S=0)",
      "T_ACK (S=0)",
      "PropertyValueRead (S=1)",
      "T_ACK (S=1)",
      "PropertyValueResponse (S=1)",
      "T_ACK (S=1)",
      "PropertyValueRead (S=2)",
      "T_ACK (S=2)",
      "PropertyValueResponse (S=2)",
      "T_ACK (S=2)",
      "T_Disconnect",
    ]);
  });
});
