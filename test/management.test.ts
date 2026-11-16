import * as fs from "fs";
import * as path from "path";
import { KNXService } from "../src/connection/KNXService";
import { CEMI, CEMIInstance } from "../src/core/CEMI";
import { ControlField } from "../src/core/ControlField";
import { ExtendedControlField } from "../src/core/ControlFieldExtended";
import { APCIEnum } from "../src/core/enum/APCIEnum";
import { APDU } from "../src/core/layers/data/APDU";
import { TPDU } from "../src/core/layers/data/TPDU";
import { APCI } from "../src/core/layers/interfaces/APCI";
import { TPCI, TPCIType } from "../src/core/layers/interfaces/TPCI";
import { MESSAGE_CODE_FIELD } from "../src/core/MessageCodeField";
import {
  encodePropertyDescriptionReadData,
  encodePropertyValueReadData,
  ManagementReturnCode,
  RestartEraseCode,
} from "../src/management/apduBuilders";
import {
  KNXManagement,
  KNXPropertyId,
  LoadEvent,
  LoadState,
  RunEvent,
  RunState,
} from "../src/management/KNXManagement";

class MockKNXBusService extends KNXService {
  public sentFrames: CEMIInstance[] = [];
  private responder: ((cemi: CEMIInstance, bus: MockKNXBusService) => void) | null = null;

  constructor(individualAddress: string = "1.1.250") {
    super({ individualAddress });
    this.individualAddress = individualAddress;
  }

  public get connectionState(): string {
    return "CONNECTED";
  }

  public setResponder(fn: (cemi: CEMIInstance, bus: MockKNXBusService) => void): void {
    this.responder = fn;
  }

  public async connect(): Promise<void> {}
  public disconnect(): void {}

  public async send(data: CEMIInstance | Buffer): Promise<void> {
    const cemi = Buffer.isBuffer(data) ? CEMI.fromBuffer(data) : data;
    this.sentFrames.push(cemi);
    if (this.responder) {
      queueMicrotask(() => this.responder!(cemi, this));
    }
  }

  public injectIndication(cemi: CEMIInstance): void {
    this.emit("indication", cemi);
  }

  public injectRawIndicationHex(hex: string): void {
    const cemi = CEMI.fromBuffer(Buffer.from(hex, "hex"));
    this.emit("indication", cemi);
  }
}

function makeLDataInd(
  src: string,
  dst: string,
  tpciRaw: number,
  apciVal: APCIEnum | number = 0,
  data: Buffer = Buffer.alloc(0),
  isShort: boolean = false,
  isBroadcast: boolean = false,
): CEMIInstance {
  const cf1 = new ControlField(0xb0);
  const cf2 = new ExtendedControlField(isBroadcast ? 0xe0 : 0x60);
  const tpci = new TPCI(tpciRaw as TPCIType);
  const apdu = new APDU(new TPCI(tpciRaw as TPCIType), new APCI(apciVal as APCIEnum), data, isShort);
  const tpdu = new TPDU(tpci, apdu, data);
  return new CEMI.DataLinkLayerCEMI["L_Data.ind"](null, cf1, cf2, src, dst, tpdu);
}

describe("Full KNXManagement Stack (03_05_02, 03_03_07, 03_08_03)", () => {
  test("checkIndividualAddress matches ETS comprobación de dirección individual (1).xml capture byte-for-byte", async () => {
    const xmlPath = path.resolve(__dirname, "../test_xml/comprobación de dirección individual (1).xml");
    const xmlContent = fs.readFileSync(xmlPath, "utf8");
    const rawFrames = Array.from(xmlContent.matchAll(/RawData="([0-9A-Fa-f]+)"/g)).map((m) =>
      m[1].toUpperCase(),
    );
    expect(rawFrames.length).toBe(14);

    const bus = new MockKNXBusService("1.1.250");
    const mgmt = new KNXManagement(bus, { sourceAddress: "1.1.250", minFrameDelayMs: 0 });

    bus.setResponder((cemi) => {
      const hex = cemi.toBuffer().toString("hex").toUpperCase();
      if (hex === "1100B06011FA123F0080") return;
      if (hex === "1100B06011FA123F014300") {
        bus.injectRawIndicationHex(rawFrames[2]);
        setTimeout(() => bus.injectRawIndicationHex(rawFrames[3]), 5);
        return;
      }
      if (hex === "1100B06011FA123F0547D500381001") {
        bus.injectRawIndicationHex(rawFrames[6]);
        setTimeout(() => bus.injectRawIndicationHex(rawFrames[7]), 5);
        return;
      }
      if (hex === "1100B06011FA123F054BD500361001") {
        bus.injectRawIndicationHex(rawFrames[10]);
        setTimeout(() => bus.injectRawIndicationHex(rawFrames[11]), 5);
      }
    });

    const result = await mgmt.checkIndividualAddress("1.2.63");
    expect(result.individualAddress).toBe("1.2.63");
    expect(result.descriptorType0.maskType).toBe(0x07);
    expect(result.descriptorType0.firmwareVersion).toBe(0xb0);
    expect(result.maxApduLength).toBe(254);
    expect(result.programmingMode).toBe(false);

    const sentHex = bus.sentFrames.map((f) => f.toBuffer().toString("hex").toUpperCase());
    expect(sentHex[0]).toBe(rawFrames[0].replace(/^2E/, "11"));
    expect(sentHex[1]).toBe(rawFrames[1].replace(/^2E/, "11"));
    expect(sentHex[2]).toBe(rawFrames[4].replace(/^2E/, "11"));
    expect(sentHex[3]).toBe(rawFrames[5].replace(/^2E/, "11"));
    expect(sentHex[4]).toBe(rawFrames[8].replace(/^2E/, "11"));
    expect(sentHex[5]).toBe(rawFrames[9].replace(/^2E/, "11"));
    expect(sentHex[6]).toBe(rawFrames[12].replace(/^2E/, "11"));
    expect(sentHex[7]).toBe(rawFrames[13].replace(/^2E/, "11"));
  });

  test("NM_IndividualAddress_Read, Write, Reset & SerialNumber Read/Write", async () => {
    const bus = new MockKNXBusService("1.1.250");
    const mgmt = new KNXManagement(bus, { minFrameDelayMs: 5 });

    let currentDeviceIa = "15.15.255";
    const deviceSerial = Buffer.from("00FA11223344", "hex");

    bus.setResponder((cemi) => {
      const anyCemi = cemi as any;
      const tpdu = anyCemi.TPDU ?? anyCemi.tpdu;
      const tpci = tpdu.tpci;
      const apdu = tpdu.apdu;
      const dst = anyCemi.destinationAddress;

      // Broadcast services
      if (dst === "0/0/0") {
        if (apdu.apci.value === APCIEnum.A_IndividualAddress_Read_Protocol_Data_Unit) {
          bus.injectIndication(
            makeLDataInd(
              currentDeviceIa,
              "0/0/0",
              TPCIType.T_DATA_BROADCAST_PDU,
              APCIEnum.A_IndividualAddress_Response_Protocol_Data_Unit,
              Buffer.from([0x00]),
              true,
              true,
            ),
          );
          return;
        }
        if (apdu.apci.value === APCIEnum.A_IndividualAddress_Write_Protocol_Data_Unit) {
          currentDeviceIa = `${apdu.data[0] >> 4}.${apdu.data[0] & 0x0f}.${apdu.data[1]}`;
          return;
        }
        if (apdu.apci.value === APCIEnum.A_IndividualAddressSerialNumber_Write_Protocol_Data_Unit) {
          if (apdu.data.subarray(0, 6).equals(deviceSerial)) {
            currentDeviceIa = `${apdu.data[6] >> 4}.${apdu.data[6] & 0x0f}.${apdu.data[7]}`;
          }
          return;
        }
        if (apdu.apci.value === APCIEnum.A_IndividualAddressSerialNumber_Read_Protocol_Data_Unit) {
          if (apdu.data.subarray(0, 6).equals(deviceSerial)) {
            const payload = Buffer.concat([deviceSerial, Buffer.from([0x00, 0x00, 0x00, 0x00])]);
            bus.injectIndication(
              makeLDataInd(
                currentDeviceIa,
                "0/0/0",
                TPCIType.T_DATA_BROADCAST_PDU,
                APCIEnum.A_IndividualAddressSerialNumber_Response_Protocol_Data_Unit,
                payload,
                false,
                true,
              ),
            );
          }
          return;
        }
      }

      // Connected services to currentDeviceIa
      if (dst === currentDeviceIa && !tpci.dataControlFlag && tpci.numberedFlag) {
        const seq = tpci.sequenceNumber;
        bus.injectIndication(makeLDataInd(currentDeviceIa, "1.1.250", TPCIType.T_ACK_PDU | (seq << 2)));
        if (apdu.apci.value === APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit) {
          setTimeout(() => {
            bus.injectIndication(
              makeLDataInd(
                currentDeviceIa,
                "1.1.250",
                TPCIType.T_DATA_CONNECTED_PDU | (0 << 2),
                APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit,
                Buffer.from([0x07, 0x05]),
                false,
              ),
            );
          }, 5);
        }
      }
    });

    // 1. Write Individual Address by Programming Mode button
    const writeRes = await mgmt.writeIndividualAddress("1.1.10", {
      checkOccupiedTimeoutMs: 30,
      progModeTimeoutMs: 30,
    });
    expect(writeRes.previousAddress).toBe("15.15.255");
    expect(writeRes.newAddress).toBe("1.1.10");
    expect(currentDeviceIa).toBe("1.1.10");

    // 2. Write Individual Address by Serial Number
    const serialRes = await mgmt.writeIndividualAddressBySerial(deviceSerial, "1.1.12", {
      checkOccupied: false,
      verifyTimeoutMs: 100,
    });
    expect(serialRes.individualAddress).toBe("1.1.12");
    expect(currentDeviceIa).toBe("1.1.12");

    // 3. Reset Individual Address to 15.15.255
    const resetRes = await mgmt.resetIndividualAddress({ progModeTimeoutMs: 30 });
    expect(resetRes.previousAddress).toBe("1.1.12");
    expect(resetRes.resetAddress).toBe("15.15.255");
    expect(currentDeviceIa).toBe("15.15.255");
  });

  test("KNXManagementSession: authorize, setKey, read/writeProperty, scanObjectProperties, Load/Run State, Links & Master Reset", async () => {
    const bus = new MockKNXBusService("1.1.250");
    const mgmt = new KNXManagement(bus, { minFrameDelayMs: 2 });

    let remoteRxSeq = 0;
    const propStore = new Map<string, Buffer>([
      ["0:54", Buffer.from([0x00])],
      ["3:5", Buffer.from([LoadState.LOADED])],
      ["3:6", Buffer.from([RunState.RUNNING])],
    ]);
    const keyStore = new Map<number, number>([[0, 0x11223344]]);
    const links: string[] = ["1/1/1"];

    bus.setResponder((cemi) => {
      const anyCemi = cemi as any;
      const tpdu = anyCemi.TPDU ?? anyCemi.tpdu;
      const tpci = tpdu.tpci;
      const apdu: APDU = tpdu.apdu;

      if (tpci.dataControlFlag) {
        if (tpci.getValue() === TPCIType.T_CONNECT_PDU) {
          remoteRxSeq = 0;
        }
        return;
      }
      if (!tpci.numberedFlag) return;

      const seq = tpci.sequenceNumber;
      bus.injectIndication(makeLDataInd("1.1.5", "1.1.250", TPCIType.T_ACK_PDU | (seq << 2)));

      const sendConnectedReply = (apciCmd: APCIEnum | number, data: Buffer, isShort: boolean = false) => {
        const txSeq = remoteRxSeq;
        remoteRxSeq = (remoteRxSeq + 1) & 0x0f;
        setTimeout(() => {
          bus.injectIndication(
            makeLDataInd(
              "1.1.5",
              "1.1.250",
              TPCIType.T_DATA_CONNECTED_PDU | (txSeq << 2),
              apciCmd,
              data,
              isShort,
            ),
          );
        }, 2);
      };

      const cmd = apdu.apci.value;
      if (cmd === APCIEnum.A_Authorize_Request_Protocol_Data_Unit) {
        const key = apdu.data.readUInt32BE(1);
        const level = key === keyStore.get(0) ? 0 : 3;
        sendConnectedReply(APCIEnum.A_Authorize_Response_Protocol_Data_Unit, Buffer.from([level]));
      } else if (cmd === APCIEnum.A_Key_Write_Protocol_Data_Unit) {
        const level = apdu.data.readUInt8(0);
        const newKey = apdu.data.readUInt32BE(1);
        keyStore.set(level, newKey);
        sendConnectedReply(APCIEnum.A_Key_Response_Protocol_Data_Unit, Buffer.from([level]));
      } else if (cmd === APCIEnum.A_PropertyValue_Read_Protocol_Data_Unit) {
        const objIdx = apdu.data.readUInt8(0);
        const pid = apdu.data.readUInt8(1);
        const val = propStore.get(`${objIdx}:${pid}`) ?? Buffer.alloc(0);
        const header = encodePropertyValueReadData({
          objectIndex: objIdx,
          propertyId: pid,
          count: val.length > 0 ? 1 : 0,
          startIndex: 1,
        });
        sendConnectedReply(
          APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
          Buffer.concat([header, val]),
        );
      } else if (cmd === APCIEnum.A_PropertyValue_Write_Protocol_Data_Unit) {
        const objIdx = apdu.data.readUInt8(0);
        const pid = apdu.data.readUInt8(1);
        const written = apdu.data.subarray(4);
        if (pid === KNXPropertyId.PID_LOAD_STATE_CONTROL) {
          const event = written.readUInt8(0) as LoadEvent;
          const nextState =
            event === LoadEvent.UNLOAD
              ? LoadState.UNLOADED
              : event === LoadEvent.START_LOADING
                ? LoadState.LOADING
                : LoadState.LOADED;
          propStore.set(`${objIdx}:${pid}`, Buffer.from([nextState]));
        } else if (pid === KNXPropertyId.PID_RUN_STATE_CONTROL) {
          const event = written.readUInt8(0) as RunEvent;
          const nextRun = event === RunEvent.STOP ? RunState.TERMINATED : RunState.RUNNING;
          propStore.set(`${objIdx}:${pid}`, Buffer.from([nextRun]));
        } else {
          propStore.set(`${objIdx}:${pid}`, Buffer.from(written));
        }
        const currentVal = propStore.get(`${objIdx}:${pid}`)!;
        const header = encodePropertyValueReadData({
          objectIndex: objIdx,
          propertyId: pid,
          count: 1,
          startIndex: 1,
        });
        sendConnectedReply(
          APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
          Buffer.concat([header, currentVal]),
        );
      } else if (cmd === APCIEnum.A_PropertyDescription_Read_Protocol_Data_Unit) {
        const objIdx = apdu.data.readUInt8(0);
        const propIdx = apdu.data.readUInt8(2);
        if (propIdx === 0) {
          sendConnectedReply(
            APCIEnum.A_PropertyDescription_Response_Protocol_Data_Unit,
            Buffer.from([objIdx, KNXPropertyId.PID_OBJECT_TYPE, 0, 0x04, 0x00, 0x01, 0x33]),
          );
        } else {
          sendConnectedReply(
            APCIEnum.A_PropertyDescription_Response_Protocol_Data_Unit,
            Buffer.from([objIdx, 0, propIdx, 0x00, 0x00, 0x00, 0x00]),
          );
        }
      } else if (cmd === APCIEnum.A_Link_Read_Protocol_Data_Unit) {
        const goNr = apdu.data.readUInt8(0);
        sendConnectedReply(
          APCIEnum.A_Link_Response_Protocol_Data_Unit,
          Buffer.from([goNr, 0x11, 0x09, 0x01]),
        );
      } else if (cmd === APCIEnum.A_Link_Write_Protocol_Data_Unit) {
        const goNr = apdu.data.readUInt8(0);
        links.push("1/1/2");
        sendConnectedReply(
          APCIEnum.A_Link_Response_Protocol_Data_Unit,
          Buffer.from([goNr, 0x11, 0x09, 0x01, 0x09, 0x02]),
        );
      } else if ((cmd & 0x03c0) === APCIEnum.A_Restart_Protocol_Data_Unit && (cmd & 0x01) === 1) {
        // Master Reset response (0x0380 | 0x21 = 0x03A1)
        sendConnectedReply(
          (APCIEnum.A_Restart_Protocol_Data_Unit | 0x21) as APCIEnum,
          Buffer.from([0x00, 0x00, 0x03]),
        );
      }
    });

    await mgmt.withSession("1.1.5", async (session) => {
      // 1. Authorize with key 0x11223344 -> level 0
      const level = await session.authorize(0x11223344);
      expect(level).toBe(0);

      // 2. Set key for level 1
      const updatedLevel = await session.setKey(1, 0xdeadbeef);
      expect(updatedLevel).toBe(1);
      expect(keyStore.get(1)).toBe(0xdeadbeef);

      // 3. Switch Programming Mode ON and verify
      await session.setProgrammingMode(true);
      expect(await session.readProgrammingMode()).toBe(true);

      // 4. Scan Object Properties
      const props = await session.scanObjectProperties(0);
      expect(props.length).toBe(1);
      expect(props[0].propertyId).toBe(KNXPropertyId.PID_OBJECT_TYPE);

      // 5. Load State Machine transitions (UNLOAD -> START_LOADING -> LOAD_COMPLETED)
      expect(await session.writeLoadState(3, LoadEvent.UNLOAD)).toBe(LoadState.UNLOADED);
      expect(await session.writeLoadState(3, LoadEvent.START_LOADING)).toBe(LoadState.LOADING);
      expect(await session.writeLoadState(3, LoadEvent.LOAD_COMPLETED)).toBe(LoadState.LOADED);

      // 6. Run State Machine transitions
      expect(await session.writeRunState(3, RunEvent.STOP)).toBe(RunState.TERMINATED);
      expect(await session.writeRunState(3, RunEvent.RESTART)).toBe(RunState.RUNNING);

      // 7. Group Object Links
      const readLinks = await session.readGroupObjectLinks(1);
      expect(readLinks.groupAddresses).toEqual(["1/1/1"]);
      const updatedLinks = await session.writeGroupObjectLink(1, "1/1/2", { sending: true });
      expect(updatedLinks.groupAddresses).toEqual(["1/1/1", "1/1/2"]);

      // 8. Master Reset (Factory Reset without IA = 0x07)
      const resetResp = await session.restart({
        type: "master",
        eraseCode: RestartEraseCode.FACTORY_RESET_WITHOUT_IA,
        channelNumber: 0,
      });
      expect(resetResp).toEqual({ errorCode: 0, processTimeSeconds: 3 });
    });
  });

  test("Standard Memory (16-bit), User Memory (20-bit) and Extended Memory (24-bit) multi-chunk read/write with verification", async () => {
    const bus = new MockKNXBusService("1.1.250");
    const mgmt = new KNXManagement(bus, { minFrameDelayMs: 1 });

    const stdMem = Buffer.alloc(65536, 0x00);
    const userMem = Buffer.alloc(1024, 0x00);
    const extMem = Buffer.alloc(1024, 0x00);
    let remoteRxSeq = 0;

    bus.setResponder((cemi) => {
      const anyCemi = cemi as any;
      const tpdu = anyCemi.TPDU ?? anyCemi.tpdu;
      const tpci = tpdu.tpci;
      const apdu: APDU = tpdu.apdu;

      if (tpci.dataControlFlag) {
        if (tpci.getValue() === TPCIType.T_CONNECT_PDU) remoteRxSeq = 0;
        return;
      }
      if (!tpci.numberedFlag) return;

      const seq = tpci.sequenceNumber;
      bus.injectIndication(makeLDataInd("1.1.20", "1.1.250", TPCIType.T_ACK_PDU | (seq << 2)));

      const sendReply = (apciCmd: number, data: Buffer) => {
        const txSeq = remoteRxSeq;
        remoteRxSeq = (remoteRxSeq + 1) & 0x0f;
        setTimeout(() => {
          bus.injectIndication(
            makeLDataInd(
              "1.1.20",
              "1.1.250",
              TPCIType.T_DATA_CONNECTED_PDU | (txSeq << 2),
              apciCmd,
              data,
              false,
            ),
          );
        }, 2);
      };

      const rawApci = apdu.apci.value;
      const base4Bit = APCIEnum[rawApci] === undefined ? rawApci & 0x03c0 : rawApci;

      if (base4Bit === APCIEnum.A_Memory_Write_Protocol_Data_Unit) {
        const count = rawApci & 0x3f;
        const addr = apdu.data.readUInt16BE(0);
        apdu.data.subarray(2, 2 + count).copy(stdMem, addr);
      } else if (base4Bit === APCIEnum.A_Memory_Read_Protocol_Data_Unit) {
        const count = rawApci & 0x3f;
        const addr = apdu.data.readUInt16BE(0);
        const slice = stdMem.subarray(addr, addr + count);
        const addrBuf = Buffer.alloc(2);
        addrBuf.writeUInt16BE(addr, 0);
        sendReply(
          APCIEnum.A_Memory_Response_Protocol_Data_Unit | count,
          Buffer.concat([addrBuf, slice]),
        );
      } else if (rawApci === APCIEnum.A_UserMemory_Write_Protocol_Data_Unit) {
        const extAndLen = apdu.data.readUInt8(0);
        const count = extAndLen & 0x0f;
        const addr = (((extAndLen >> 4) & 0x0f) << 16) | apdu.data.readUInt16BE(1);
        apdu.data.subarray(3, 3 + count).copy(userMem, addr);
      } else if (rawApci === APCIEnum.A_UserMemory_Read_Protocol_Data_Unit) {
        const extAndLen = apdu.data.readUInt8(0);
        const count = extAndLen & 0x0f;
        const addr = (((extAndLen >> 4) & 0x0f) << 16) | apdu.data.readUInt16BE(1);
        const slice = userMem.subarray(addr, addr + count);
        sendReply(
          APCIEnum.A_UserMemory_Response_Protocol_Data_Unit,
          Buffer.concat([apdu.data.subarray(0, 3), slice]),
        );
      } else if (rawApci === APCIEnum.A_MemoryExtended_Write_Protocol_Data_Unit) {
        const count = apdu.data.readUInt8(0);
        const addr = (apdu.data.readUInt8(1) << 16) | apdu.data.readUInt16BE(2);
        apdu.data.subarray(4, 4 + count).copy(extMem, addr);
        const resp = Buffer.alloc(4);
        resp.writeUInt8(ManagementReturnCode.E_SUCCESS, 0);
        apdu.data.subarray(1, 4).copy(resp, 1);
        sendReply(APCIEnum.A_MemoryExtended_WriteResponse_Protocol_Data_Unit, resp);
      } else if (rawApci === APCIEnum.A_MemoryExtended_Read_Protocol_Data_Unit) {
        const count = apdu.data.readUInt8(0);
        const addr = (apdu.data.readUInt8(1) << 16) | apdu.data.readUInt16BE(2);
        const slice = extMem.subarray(addr, addr + count);
        const header = Buffer.alloc(4);
        header.writeUInt8(ManagementReturnCode.E_SUCCESS, 0);
        apdu.data.subarray(1, 4).copy(header, 1);
        sendReply(
          APCIEnum.A_MemoryExtended_ReadResponse_Protocol_Data_Unit,
          Buffer.concat([header, slice]),
        );
      }
    });

    // 1. Standard 16-bit memory (28 bytes -> split across 3 chunks of 12, 12, 4 with read-back verification)
    const payload28 = Buffer.from("0102030405060708090A0B0C0D0E0F101112131415161718191A1B1C", "hex");
    await mgmt.writeMemory("1.1.20", 0x0100, payload28, { verify: true, maxChunkSize: 12 });
    const readStd = await mgmt.readMemory("1.1.20", 0x0100, payload28.length, { maxChunkSize: 12 });
    expect(readStd).toEqual(payload28);

    // 2. 20-bit User Memory (20 bytes -> split across 2 chunks of 11 and 9 with verification)
    const userPayload20 = Buffer.from("AABBCCDDEEFF00112233445566778899AABBCCDD", "hex");
    await mgmt.writeUserMemory("1.1.20", 0x00020, userPayload20, { verify: true, maxChunkSize: 11 });
    const readUser = await mgmt.readUserMemory("1.1.20", 0x00020, userPayload20.length, { maxChunkSize: 11 });
    expect(readUser).toEqual(userPayload20);

    // 3. 24-bit Extended Memory
    const extPayload = Buffer.from("DEADBEEFCAFEBABE0123456789ABCDEF", "hex");
    await mgmt.writeExtendedMemory("1.1.20", 0x000100, extPayload);
    const readExt = await mgmt.readExtendedMemory("1.1.20", 0x000100, extPayload.length);
    expect(readExt).toEqual(extPayload);
  });

  test("Local cEMI Device Management (M_PropRead, M_PropWrite, M_FuncPropCommand, M_Reset)", async () => {
    const bus = new MockKNXBusService("1.1.250");
    const mgmt = new KNXManagement(bus);

    let localStoredValue = Buffer.from([0x11, 0x00]);
    let localResetCalled = false;

    bus.setResponder((cemi) => {
      const anyCemi = cemi as any;
      if (anyCemi.messageCode === MESSAGE_CODE_FIELD["M_PropRead.req"].CEMI.value) {
        const con = new CEMI.ManagementCEMI["M_PropRead.con"](
          anyCemi.interfaceObjectType,
          anyCemi.objectInstance,
          anyCemi.propertyId,
          anyCemi.numberOfElements,
          anyCemi.startIndex,
          localStoredValue,
        );
        bus.injectIndication(con);
      } else if (anyCemi.messageCode === MESSAGE_CODE_FIELD["M_PropWrite.req"].CEMI.value) {
        localStoredValue = Buffer.from(anyCemi.data);
        const con = new CEMI.ManagementCEMI["M_PropWrite.con"](
          anyCemi.interfaceObjectType,
          anyCemi.objectInstance,
          anyCemi.propertyId,
          anyCemi.numberOfElements,
          anyCemi.startIndex,
        );
        bus.injectIndication(con);
      } else if (anyCemi.messageCode === MESSAGE_CODE_FIELD["M_FuncPropCommand.req"].CEMI.value) {
        const con = new CEMI.ManagementCEMI["M_FuncPropCommand.con"](
          anyCemi.interfaceObjectType,
          anyCemi.objectInstance,
          anyCemi.propertyId,
          0x00,
          Buffer.from([0x42]),
        );
        bus.injectIndication(con);
      } else if (anyCemi.messageCode === MESSAGE_CODE_FIELD["M_Reset.req"].CEMI.value) {
        localResetCalled = true;
      }
    });

    await mgmt.writeLocalProperty({
      objectType: 0,
      objectInstance: 1,
      propertyId: KNXPropertyId.PID_SUBNET_ADDR,
      data: Buffer.from([0x12, 0x34]),
    });

    const readRes = await mgmt.readLocalProperty({
      objectType: 0,
      objectInstance: 1,
      propertyId: KNXPropertyId.PID_SUBNET_ADDR,
    });
    expect(readRes.data).toEqual(Buffer.from([0x12, 0x34]));

    const funcRes = await mgmt.callLocalFunctionProperty({
      objectType: 0,
      objectInstance: 1,
      propertyId: 50,
      data: Buffer.from([0x01]),
    });
    expect(funcRes).toEqual({ returnCode: 0x00, data: Buffer.from([0x42]) });

    await mgmt.resetLocalDevice();
    expect(localResetCalled).toBe(true);
  });

  test("Domain Address, Network/SystemNetwork Parameters, Extended Properties, identifyDevice & scanLine", async () => {
    const bus = new MockKNXBusService("1.1.250");
    const mgmt = new KNXManagement(bus, { minFrameDelayMs: 1 });

    let domainAddr = Buffer.from([0x00, 0x11]);
    const serial = Buffer.from("00FA99887766", "hex");
    let netParamVal = Buffer.from([0xaa]);
    let sysNetParamVal = Buffer.from([0xbb]);
    let extPropVal = Buffer.from([0x12, 0x34]);
    let remoteRxSeq = 0;

    bus.setResponder((cemi) => {
      const anyCemi = cemi as any;
      const tpdu = anyCemi.TPDU ?? anyCemi.tpdu;
      const tpci = tpdu?.tpci;
      const apdu: APDU = tpdu?.apdu;
      if (!apdu) return;

      const dst = anyCemi.destinationAddress;
      const cmd = apdu.apci.value;

      // Broadcast / System Broadcast
      if (dst === "0/0/0") {
        if (cmd === APCIEnum.A_DomainAddress_Write_Protocol_Data_Unit) {
          domainAddr = Buffer.from(apdu.data);
        } else if (
          cmd === APCIEnum.A_DomainAddress_Read_Protocol_Data_Unit ||
          cmd === APCIEnum.A_DomainAddressSelective_Read_Protocol_Data_Unit
        ) {
          bus.injectIndication(
            makeLDataInd(
              "1.1.30",
              "0/0/0",
              TPCIType.T_DATA_BROADCAST_PDU,
              APCIEnum.A_DomainAddress_Response_Protocol_Data_Unit,
              domainAddr,
              false,
              true,
            ),
          );
        } else if (cmd === APCIEnum.A_DomainAddressSerialNumber_Write_Protocol_Data_Unit) {
          if (apdu.data.subarray(0, 6).equals(serial)) {
            domainAddr = Buffer.from(apdu.data.subarray(6));
          }
        } else if (cmd === APCIEnum.A_DomainAddressSerialNumber_Read_Protocol_Data_Unit) {
          if (apdu.data.subarray(0, 6).equals(serial)) {
            bus.injectIndication(
              makeLDataInd(
                "1.1.30",
                "0/0/0",
                TPCIType.T_DATA_BROADCAST_PDU,
                APCIEnum.A_DomainAddressSerialNumber_Response_Protocol_Data_Unit,
                Buffer.concat([serial, domainAddr]),
                false,
                true,
              ),
            );
          }
        } else if (cmd === APCIEnum.A_NetworkParameter_Write_Protocol_Data_Unit) {
          netParamVal = Buffer.from(apdu.data.subarray(3));
        } else if (cmd === APCIEnum.A_NetworkParameter_Read_Protocol_Data_Unit) {
          bus.injectIndication(
            makeLDataInd(
              "1.1.30",
              "0/0/0",
              TPCIType.T_DATA_BROADCAST_PDU,
              APCIEnum.A_NetworkParameter_Response_Protocol_Data_Unit,
              Buffer.concat([apdu.data.subarray(0, 3), netParamVal]),
              false,
              true,
            ),
          );
        } else if (cmd === APCIEnum.A_SystemNetworkParameter_Write_Protocol_Data_Unit) {
          sysNetParamVal = Buffer.from(apdu.data.subarray(4));
        } else if (cmd === APCIEnum.A_SystemNetworkParameter_Read_Protocol_Data_Unit) {
          bus.injectIndication(
            makeLDataInd(
              "1.1.30",
              "0/0/0",
              TPCIType.T_DATA_BROADCAST_PDU,
              APCIEnum.A_SystemNetworkParameter_Response_Protocol_Data_Unit,
              Buffer.concat([apdu.data.subarray(0, 4), sysNetParamVal]),
              false,
              true,
            ),
          );
        }
        return;
      }

      if (dst !== "1.1.30") return;
      if (tpci.dataControlFlag) {
        if (tpci.getValue() === TPCIType.T_CONNECT_PDU) remoteRxSeq = 0;
        return;
      }
      if (!tpci.numberedFlag) return;

      const seq = tpci.sequenceNumber;
      bus.injectIndication(makeLDataInd("1.1.30", "1.1.250", TPCIType.T_ACK_PDU | (seq << 2)));

      const sendConnectedReply = (apciCmd: number, data: Buffer) => {
        const txSeq = remoteRxSeq;
        remoteRxSeq = (remoteRxSeq + 1) & 0x0f;
        setTimeout(() => {
          bus.injectIndication(
            makeLDataInd(
              "1.1.30",
              "1.1.250",
              TPCIType.T_DATA_CONNECTED_PDU | (txSeq << 2),
              apciCmd,
              data,
              false,
            ),
          );
        }, 2);
      };

      if (cmd === APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit) {
        sendConnectedReply(APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit, Buffer.from([0x07, 0xb0]));
      } else if (cmd === APCIEnum.A_PropertyValue_Read_Protocol_Data_Unit) {
        const pid = apdu.data.readUInt8(1);
        const map: Record<number, Buffer> = {
          [KNXPropertyId.PID_MANUFACTURER_ID]: Buffer.from([0x00, 0xc8]),
          [KNXPropertyId.PID_SERIAL_NUMBER]: serial,
          [KNXPropertyId.PID_HARDWARE_TYPE]: Buffer.from("000000010203", "hex"),
          [KNXPropertyId.PID_ORDER_INFO]: Buffer.from("0102030405060708090A", "hex"),
          [KNXPropertyId.PID_FIRMWARE_REVISION]: Buffer.from([0x02]),
          [KNXPropertyId.PID_MAX_APDULENGTH]: Buffer.from([0x00, 0x37]),
          [KNXPropertyId.PID_PROG_MODE]: Buffer.from([0x00]),
        };
        const val = map[pid] ?? Buffer.alloc(0);
        const header = encodePropertyValueReadData({
          objectIndex: 0,
          propertyId: pid,
          count: val.length > 0 ? 1 : 0,
          startIndex: 1,
        });
        sendConnectedReply(
          APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
          Buffer.concat([header, val]),
        );
      } else if (cmd === APCIEnum.A_PropertyExtValue_WriteCon_Protocol_Data_Unit) {
        extPropVal = Buffer.from(apdu.data.subarray(8));
        sendConnectedReply(
          APCIEnum.A_PropertyExtValue_WriteConRes_Protocol_Data_Unit,
          Buffer.concat([apdu.data.subarray(0, 8), Buffer.from([ManagementReturnCode.E_SUCCESS])]),
        );
      } else if (cmd === APCIEnum.A_PropertyExtValue_Read_Protocol_Data_Unit) {
        sendConnectedReply(
          APCIEnum.A_PropertyExtValue_Response_Protocol_Data_Unit,
          Buffer.concat([apdu.data.subarray(0, 8), extPropVal]),
        );
      }
    });

    // 1. Domain Address Write & Read
    await mgmt.writeDomainAddress(Buffer.from([0x12, 0x34]));
    const domRead = await mgmt.readDomainAddress({ timeoutMs: 25 });
    expect(domRead).toEqual([{ sourceAddress: "1.1.30", domainAddress: Buffer.from([0x12, 0x34]) }]);

    await mgmt.writeDomainAddressBySerial(serial, Buffer.from([0x56, 0x78]));
    const domBySerial = await mgmt.readDomainAddressBySerial(serial, { timeoutMs: 50 });
    expect(domBySerial?.domainAddress).toEqual(Buffer.from([0x56, 0x78]));

    // 2. Network & System Network Parameters
    await mgmt.writeNetworkParameter({ objectType: 0, propertyId: 59, data: Buffer.from([0x33]) });
    const netParam = await mgmt.readNetworkParameter({ objectType: 0, propertyId: 59 }, { timeoutMs: 25 });
    expect(netParam[0].data).toEqual(Buffer.from([0x33]));

    await mgmt.writeSystemNetworkParameter({ objectType: 0, propertyId: 60, data: Buffer.from([0x44]) });
    const sysParam = await mgmt.readSystemNetworkParameter({ objectType: 0, propertyId: 60 }, { timeoutMs: 25 });
    expect(sysParam[0].data).toEqual(Buffer.from([0x44]));

    // 3. Extended Property WriteCon & Read
    await mgmt.writePropertyExtended("1.1.30", {
      objectType: 8,
      objectInstance: 1,
      propertyId: 51,
      data: Buffer.from([0xca, 0xfe]),
    });
    const extRead = await mgmt.readPropertyExtended("1.1.30", {
      objectType: 8,
      objectInstance: 1,
      propertyId: 51,
    });
    expect(extRead.data).toEqual(Buffer.from([0xca, 0xfe]));

    // 4. Scan line & Export inventory
    const found = await mgmt.scanLine("1.1", { range: [29, 31], timeoutPerAddressMs: 25 });
    expect(found).toEqual(["1.1.30"]);

    const inv = await mgmt.exportInventory(found);
    expect(inv[0].manufacturerId).toBe(0x00c8);
    expect(inv[0].serialNumber).toBe("00FA99887766");
    expect(inv[0].firmwareRevision).toBe(2);
  });

  test("readDeviceGroupAddresses supports PID_TABLE (System B), PID_TABLE_REFERENCE (BIM/BCU2) and fixed memory 0x0116 (BCU1)", async () => {
    const bus = new MockKNXBusService("1.1.250");
    const mgmt = new KNXManagement(bus, { minFrameDelayMs: 1 });
    let remoteRxSeq = 0;

    // 1.1.40 -> Property-based PID_TABLE (23) with ["1/1/1", "1/1/2", "2/0/10"]
    // 1.1.41 -> Pointer-based PID_TABLE_REFERENCE (7) pointing to 0x0200 with ["3/1/5", "3/1/6"]
    // 1.1.42 -> Fixed memory at 0x0116 with ["4/2/1"]
    bus.setResponder((cemi) => {
      const anyCemi = cemi as any;
      const tpdu = anyCemi.TPDU ?? anyCemi.tpdu;
      const tpci = tpdu?.tpci;
      const apdu: APDU = tpdu?.apdu;
      const dst = anyCemi.destinationAddress;

      if (tpci.dataControlFlag) {
        if (tpci.getValue() === TPCIType.T_CONNECT_PDU) remoteRxSeq = 0;
        return;
      }
      if (!tpci.numberedFlag) return;

      const seq = tpci.sequenceNumber;
      bus.injectIndication(makeLDataInd(dst, "1.1.250", TPCIType.T_ACK_PDU | (seq << 2)));

      const sendConnectedReply = (apciCmd: number, data: Buffer) => {
        const txSeq = remoteRxSeq;
        remoteRxSeq = (remoteRxSeq + 1) & 0x0f;
        setTimeout(() => {
          bus.injectIndication(
            makeLDataInd(
              dst,
              "1.1.250",
              TPCIType.T_DATA_CONNECTED_PDU | (txSeq << 2),
              apciCmd,
              data,
              false,
            ),
          );
        }, 2);
      };

      const rawApci = apdu.apci.value;
      const base4Bit = APCIEnum[rawApci] === undefined ? rawApci & 0x03c0 : rawApci;

      if (rawApci === APCIEnum.A_PropertyValue_Read_Protocol_Data_Unit) {
        const objIdx = apdu.data.readUInt8(0);
        const pid = apdu.data.readUInt8(1);
        const count = (apdu.data.readUInt8(2) >> 4) & 0x0f;
        const startIndex = ((apdu.data.readUInt8(2) & 0x0f) << 8) | apdu.data.readUInt8(3);

        if (dst === "1.1.40" && objIdx === 1 && pid === KNXPropertyId.PID_TABLE) {
          if (startIndex === 0) {
            sendConnectedReply(
              APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
              Buffer.concat([
                encodePropertyValueReadData({ objectIndex: 1, propertyId: pid, count: 1, startIndex: 0 }),
                Buffer.from([0x00, 0x03]),
              ]),
            );
          } else {
            const entries = [
              Buffer.from([0x09, 0x01]), // 1/1/1
              Buffer.from([0x09, 0x02]), // 1/1/2
              Buffer.from([0x10, 0x0a]), // 2/0/10
            ];
            const slice = entries.slice(startIndex - 1, startIndex - 1 + count);
            sendConnectedReply(
              APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
              Buffer.concat([
                encodePropertyValueReadData({
                  objectIndex: 1,
                  propertyId: pid,
                  count: slice.length,
                  startIndex,
                }),
                ...slice,
              ]),
            );
          }
          return;
        }

        if (dst === "1.1.41" && objIdx === 1 && pid === KNXPropertyId.PID_TABLE_REFERENCE) {
          sendConnectedReply(
            APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
            Buffer.concat([
              encodePropertyValueReadData({ objectIndex: 1, propertyId: pid, count: 1, startIndex: 1 }),
              Buffer.from([0x02, 0x00]),
            ]),
          );
          return;
        }

        // Negative response (count = 0)
        sendConnectedReply(
          APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
          encodePropertyValueReadData({ objectIndex: objIdx, propertyId: pid, count: 0, startIndex }),
        );
      } else if (rawApci === APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit) {
        sendConnectedReply(
          APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit,
          Buffer.from([0x00, 0x12]),
        );
      } else if (base4Bit === APCIEnum.A_Memory_Read_Protocol_Data_Unit) {
        const count = rawApci & 0x3f;
        const addr = apdu.data.readUInt16BE(0);
        // Memory layout at 0x0200 (for 1.1.41): [len=3, IA=0x1129, GA1=0x1905 (3/1/5), GA2=0x1906 (3/1/6)]
        // Memory layout at 0x0116 (for 1.1.42): [len=2, IA=0x112A, GA1=0x2201 (4/2/1)]
        const mem41 = Buffer.from([0x03, 0x11, 0x29, 0x19, 0x05, 0x19, 0x06]);
        const mem42 = Buffer.from([0x02, 0x11, 0x2a, 0x22, 0x01]);
        const base = dst === "1.1.41" ? 0x0200 : 0x0116;
        const srcBuf = dst === "1.1.41" ? mem41 : mem42;
        const offset = addr - base;
        const data = srcBuf.subarray(offset, offset + count);
        sendConnectedReply(
          APCIEnum.A_Memory_Response_Protocol_Data_Unit | count,
          Buffer.concat([apdu.data.subarray(0, 2), data]),
        );
      }
    });

    const res40 = await mgmt.readDeviceGroupAddresses("1.1.40");
    expect(res40.method).toBe("property_table");
    expect(res40.groupAddresses).toEqual(["1/1/1", "1/1/2", "2/0/10"]);

    const res41 = await mgmt.readDeviceGroupAddresses("1.1.41");
    expect(res41.method).toBe("table_reference_memory");
    expect(res41.tableAddress).toBe(0x0200);
    expect(res41.groupAddresses).toEqual(["3/1/5", "3/1/6"]);

    const res42 = await mgmt.readDeviceGroupAddresses("1.1.42");
    expect(res42.method).toBe("fixed_memory");
    expect(res42.tableAddress).toBe(0x0116);
    expect(res42.groupAddresses).toEqual(["4/2/1"]);
  });
});
