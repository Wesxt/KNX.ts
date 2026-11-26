import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { KNXService } from "../src/connection/KNXService";
import { CEMI, CEMIInstance } from "../src/core/CEMI";
import { ControlField } from "../src/core/ControlField";
import { ExtendedControlField } from "../src/core/ControlFieldExtended";
import { APCIEnum } from "../src/core/enum/APCIEnum";
import { APDU } from "../src/core/layers/data/APDU";
import { TPDU } from "../src/core/layers/data/TPDU";
import { APCI } from "../src/core/layers/interfaces/APCI";
import { TPCI, TPCIType } from "../src/core/layers/interfaces/TPCI";
import { ManagementReturnCode } from "../src/management/apduBuilders";
import { KNXManagement, KNXPropertyId, LoadEvent, LoadState } from "../src/management/KNXManagement";
import {
  compileCouplerFilterTable,
  compileLegacyAssociationTable,
  compileLegacyGroupAddressTable,
  compileLegacyGroupObjectTable,
  DeviceConfigSession,
  KNXApplicationCompiler,
  KNXDeviceProgrammer,
  KnxProdParser,
  LoadProcedureEngine,
  parseApplicationProgramStream,
  resolveManagementModel,
  SystemBCompiler,
  ZipWriter,
} from "../src/programming";
import { KnxProject } from "../src/project";

// ============================================================================
// Mock Bus + Multi-Architecture KNX Device (BCU1 / BCU2 / BIM M112 / Couplers / System 300)
// ============================================================================

class MockBus extends KNXService {
  private responder: ((cemi: CEMIInstance, bus: MockBus) => void) | null = null;

  constructor(ia: string = "1.1.250") {
    super({ individualAddress: ia });
    this.individualAddress = ia;
  }

  public get connectionState(): string {
    return "CONNECTED";
  }

  public setResponder(fn: (cemi: CEMIInstance, bus: MockBus) => void): void {
    this.responder = fn;
  }

  public async connect(): Promise<void> {}
  public disconnect(): void {}

  public async send(data: CEMIInstance | Buffer): Promise<void> {
    const prepared = this.prepareOutgoingCemi(data);
    const cemi = Buffer.isBuffer(prepared) ? CEMI.fromBuffer(prepared) : prepared;
    if (this.responder) {
      queueMicrotask(() => this.responder!(cemi, this));
    }
  }

  public inject(cemi: CEMIInstance): void {
    const processed = this.processIncomingCemi(cemi);
    if (processed) this.emit("indication", processed);
  }
}

function makeInd(
  src: string,
  dst: string,
  tpciRaw: number,
  apciVal: APCIEnum | number = 0,
  data: Buffer = Buffer.alloc(0),
  isShort: boolean = false,
): CEMIInstance {
  const cf1 = new ControlField(0xb0);
  const cf2 = new ExtendedControlField(0x60);
  const tpci = new TPCI(tpciRaw as TPCIType);
  const apdu = new APDU(new TPCI(tpciRaw as TPCIType), new APCI(apciVal as APCIEnum), data, isShort);
  if (apdu.length > 15) cf1.frameType = false;
  const tpdu = new TPDU(tpci, apdu, data);
  return new CEMI.DataLinkLayerCEMI["L_Data.ind"](null, cf1, cf2, src, dst, tpdu);
}

interface MockMultiArchConfig {
  individualAddress: string;
  maskVersion: number;
  manufacturerId: number;
  supportsInterfaceObjects?: boolean;
  /** Ordered list of Interface Object Types for PID_IO_LIST (index i -> objType). */
  ioList?: number[];
  maxApduLength?: number;
  initialProps?: Map<string, Buffer>;
  memorySize?: number;
}

class MockMultiArchDevice {
  public readonly ia: string;
  public readonly maskVersion: number;
  public readonly manufacturerId: number;
  public readonly supportsInterfaceObjects: boolean;
  public readonly ioList: number[];
  public readonly maxApduLength: number;

  public memory: Buffer;
  public userMemory: Buffer = Buffer.alloc(65536, 0x00);
  public loadStates = new Map<number, LoadState>();
  public props = new Map<string, Buffer>();
  public relBases = new Map<number, number>();
  public loadControlsReceived: { objIdx: number; event: number; payload: Buffer }[] = [];
  public functionPropsCalled: { objIdx: number; propId: number; data: Buffer }[] = [];
  public restarted = false;
  public masterReset?: { eraseCode: number; channel: number };
  private devTxSeq = 0;

  constructor(cfg: MockMultiArchConfig) {
    this.ia = cfg.individualAddress;
    this.maskVersion = cfg.maskVersion;
    this.manufacturerId = cfg.manufacturerId;
    this.supportsInterfaceObjects = cfg.supportsInterfaceObjects ?? true;
    this.ioList = cfg.ioList ?? [0, 1, 2, 3, 4];
    this.maxApduLength = cfg.maxApduLength ?? 55;
    this.memory = Buffer.alloc(cfg.memorySize ?? 65536, 0x00);
    // Write BCU1 manufacturer ID at 0x0104
    this.memory[0x0104] = this.manufacturerId & 0xff;
    this.memory[0x0116] = 0x01; // default BCU1 AddressTable length byte

    for (let i = 0; i < this.ioList.length; i++) {
      this.loadStates.set(i, LoadState.LOADED);
      this.relBases.set(i, 0x8000 + i * 0x2000);
    }

    // Seed standard Object 0 properties
    const mfrBuf = Buffer.alloc(2);
    mfrBuf.writeUInt16BE(this.manufacturerId, 0);
    this.props.set(`0:${KNXPropertyId.PID_MANUFACTURER_ID}`, mfrBuf);
    const apduBuf = Buffer.alloc(2);
    apduBuf.writeUInt16BE(this.maxApduLength, 0);
    this.props.set(`0:${KNXPropertyId.PID_MAX_APDULENGTH}`, apduBuf);
    if (cfg.initialProps) {
      for (const [k, v] of cfg.initialProps.entries()) {
        this.props.set(k, Buffer.from(v));
      }
    }
  }

  public attach(bus: MockBus): void {
    bus.setResponder((cemi) => this.handle(cemi, bus));
  }

  private reply(bus: MockBus, dst: string, apci: APCIEnum | number, data: Buffer, isShort: boolean = false): void {
    const seq = this.devTxSeq;
    this.devTxSeq = (this.devTxSeq + 1) & 0x0f;
    bus.inject(makeInd(this.ia, dst, TPCIType.T_DATA_CONNECTED_PDU | (seq << 2), apci, data, isShort));
  }

  private handle(cemi: CEMIInstance, bus: MockBus): void {
    if (!("TPDU" in cemi) || !("destinationAddress" in cemi)) return;
    if (cemi.destinationAddress !== this.ia) return;
    const src = cemi.sourceAddress;
    const tpci = cemi.TPDU.tpci;
    const apdu = cemi.TPDU.apdu;

    if (tpci.dataControlFlag) {
      if (tpci.getValue() === TPCIType.T_CONNECT_PDU) this.devTxSeq = 0;
      return;
    }
    if (!tpci.numberedFlag) return;
    bus.inject(makeInd(this.ia, src, TPCIType.T_ACK_PDU | (tpci.sequenceNumber << 2)));

    const apci = apdu.apci.value;
    const data = apdu.data;

    if (apci === APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit) {
      const dd0 = Buffer.alloc(3);
      dd0.writeUInt8(0x00, 0);
      dd0.writeUInt16BE(this.maskVersion, 1);
      // APDU short header uses low 6 bits for descType=0, payload is 2B maskVersion
      this.reply(bus, src, APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit, dd0.subarray(1), false);
      return;
    }

    if (apci === APCIEnum.A_Authorize_Request_Protocol_Data_Unit) {
      this.reply(bus, src, APCIEnum.A_Authorize_Response_Protocol_Data_Unit, Buffer.from([0x00]), false);
      return;
    }

    if (apci === (APCIEnum.A_Restart_Protocol_Data_Unit | 0x01)) {
      this.masterReset = { eraseCode: data[0] ?? 0, channel: data[1] ?? 0 };
      this.reply(bus, src, APCIEnum.A_Restart_Protocol_Data_Unit | 0x21, Buffer.from([0x00, 0x00, 0x01]), false);
      return;
    }

    if (apci === APCIEnum.A_Restart_Protocol_Data_Unit) {
      this.restarted = true;
      return;
    }

    // Standard Memory Read (0x0200 | count) — 4-bit APCI with count in low 6 bits
    if ((apci & 0x03c0) === APCIEnum.A_Memory_Read_Protocol_Data_Unit) {
      const count = apci & 0x3f;
      const addr = data.readUInt16BE(0);
      const slice = Buffer.from(this.memory.subarray(addr, addr + count));
      const resp = Buffer.concat([data.subarray(0, 2), slice]);
      this.reply(bus, src, APCIEnum.A_Memory_Response_Protocol_Data_Unit | (count & 0x3f), resp, false);
      return;
    }

    // Standard Memory Write (0x0280 | count) — 4-bit APCI with count in low 6 bits
    if ((apci & 0x03c0) === APCIEnum.A_Memory_Write_Protocol_Data_Unit) {
      const count = apci & 0x3f;
      const addr = data.readUInt16BE(0);
      const bytes = data.subarray(2, 2 + count);
      bytes.copy(this.memory, addr);
      // Respond with A_Memory_Response (verify mode)
      const resp = Buffer.concat([data.subarray(0, 2), bytes]);
      this.reply(bus, src, APCIEnum.A_Memory_Response_Protocol_Data_Unit | (count & 0x3f), resp, false);
      return;
    }

    if (apci === APCIEnum.A_UserMemory_Read_Protocol_Data_Unit) {
      const addrExt = (data[0] >> 4) & 0x0f;
      const count = data[0] & 0x0f;
      const addr = (addrExt << 16) | data.readUInt16BE(1);
      const slice = Buffer.from(this.userMemory.subarray(addr & 0xffff, (addr & 0xffff) + count));
      const resp = Buffer.concat([data.subarray(0, 3), slice]);
      this.reply(bus, src, APCIEnum.A_UserMemory_Response_Protocol_Data_Unit, resp, false);
      return;
    }

    if (apci === APCIEnum.A_UserMemory_Write_Protocol_Data_Unit) {
      const addrExt = (data[0] >> 4) & 0x0f;
      const count = data[0] & 0x0f;
      const addr = (addrExt << 16) | data.readUInt16BE(1);
      const bytes = data.subarray(3, 3 + count);
      bytes.copy(this.userMemory, addr & 0xffff);
      const resp = Buffer.concat([data.subarray(0, 3), bytes]);
      this.reply(bus, src, APCIEnum.A_UserMemory_Response_Protocol_Data_Unit, resp, false);
      return;
    }

    if (!this.supportsInterfaceObjects) return;

    if (apci === APCIEnum.A_FunctionPropertyCommand_Protocol_Data_Unit) {
      const objIdx = data[0];
      const propId = data[1];
      const cmdData = Buffer.from(data.subarray(2));
      this.functionPropsCalled.push({ objIdx, propId, data: cmdData });
      const resp = Buffer.from([objIdx, propId, ManagementReturnCode.E_SUCCESS]);
      this.reply(bus, src, APCIEnum.A_FunctionPropertyState_Response_Protocol_Data_Unit, resp, false);
      return;
    }

    if (apci === APCIEnum.A_PropertyValue_Read_Protocol_Data_Unit) {
      const objIdx = data[0];
      const propId = data[1];
      const count = (data[2] >> 4) & 0x0f;
      const start = ((data[2] & 0x0f) << 8) | data[3];

      let val: Buffer | undefined;
      if (objIdx === 0 && propId === KNXPropertyId.PID_IO_LIST) {
        if (start === 0) {
          val = Buffer.alloc(2);
          val.writeUInt16BE(this.ioList.length, 0);
        } else {
          const items = this.ioList.slice(start - 1, start - 1 + count);
          val = Buffer.alloc(items.length * 2);
          items.forEach((t, i) => val!.writeUInt16BE(t, i * 2));
        }
      } else if (propId === KNXPropertyId.PID_OBJECT_TYPE && objIdx < this.ioList.length) {
        val = Buffer.alloc(2);
        val.writeUInt16BE(this.ioList[objIdx], 0);
      } else if (propId === KNXPropertyId.PID_LOAD_STATE_CONTROL) {
        val = Buffer.from([this.loadStates.get(objIdx) ?? LoadState.UNLOADED]);
      } else if (propId === KNXPropertyId.PID_TABLE_REFERENCE) {
        val = Buffer.alloc(2);
        val.writeUInt16BE(this.relBases.get(objIdx) ?? 0x8000, 0);
      } else {
        val = this.props.get(`${objIdx}:${propId}`);
      }

      if (!val) {
        // Count=0 indicates unsupported property
        const hdr = Buffer.from([objIdx, propId, (start >> 8) & 0x0f, start & 0xff]);
        this.reply(bus, src, APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit, hdr, false);
        return;
      }
      const respCount = objIdx === 0 && propId === KNXPropertyId.PID_IO_LIST && start > 0 ? val.length / 2 : count;
      const hdr = Buffer.from([objIdx, propId, ((respCount & 0x0f) << 4) | ((start >> 8) & 0x0f), start & 0xff]);
      this.reply(bus, src, APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit, Buffer.concat([hdr, val]), false);
      return;
    }

    if (apci === APCIEnum.A_PropertyValue_Write_Protocol_Data_Unit) {
      const objIdx = data[0];
      const propId = data[1];
      const count = (data[2] >> 4) & 0x0f;
      const start = ((data[2] & 0x0f) << 8) | data[3];
      const val = Buffer.from(data.subarray(4));

      if (propId === KNXPropertyId.PID_LOAD_STATE_CONTROL && val.length >= 1) {
        const event = val[0];
        this.loadControlsReceived.push({ objIdx, event, payload: Buffer.from(val.subarray(1)) });
        let nextState = this.loadStates.get(objIdx) ?? LoadState.UNLOADED;
        if (event === LoadEvent.UNLOAD) nextState = LoadState.UNLOADED;
        else if (event === LoadEvent.START_LOADING) nextState = LoadState.LOADING;
        else if (event === LoadEvent.ADDITIONAL_LOAD_CONTROLS) nextState = LoadState.LOADING;
        else if (event === LoadEvent.LOAD_COMPLETED) nextState = LoadState.LOADED;
        this.loadStates.set(objIdx, nextState);
        const hdr = Buffer.from([objIdx, propId, (1 << 4) | ((start >> 8) & 0x0f), start & 0xff, nextState]);
        this.reply(bus, src, APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit, hdr, false);
        return;
      }

      this.props.set(`${objIdx}:${propId}`, val);
      const hdr = Buffer.from([objIdx, propId, ((count & 0x0f) << 4) | ((start >> 8) & 0x0f), start & 0xff]);
      this.reply(bus, src, APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit, Buffer.concat([hdr, val]), false);
    }
  }
}

function buildSyntheticKnxProd(appXml: string, mfrId = "M-0002", appId = "M-0002_A-1001-10-0001"): Buffer {
  const zip = new ZipWriter();
  zip.addText(
    `${mfrId}/Hardware.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20">
  <ManufacturerData>
    <Manufacturer RefId="${mfrId}">
      <Hardware>
        <Hardware Id="${mfrId}_H-TEST-1" Name="Test HW" HasIndividualAddress="true" HasApplicationProgram="true">
          <Products><Product Id="${mfrId}_H-TEST-1_P-1" Text="Test Device" OrderNumber="TEST-1" /></Products>
          <Hardware2Programs>
            <Hardware2Program Id="${mfrId}_H-TEST-1_HP-1"><ApplicationProgramRef RefId="${appId}" /></Hardware2Program>
          </Hardware2Programs>
        </Hardware>
      </Hardware>
    </Manufacturer>
  </ManufacturerData>
</KNX>`,
  );
  zip.addText(`${mfrId}/${appId}.xml`, appXml);
  return zip.toBuffer();
}

describe("Multi-Architecture KNX Programming (System 7 / System 2 / System 1 / Couplers / System 300 / DCA)", () => {
  test("ManagementModel resolution & legacy table encoders (Realisation Type 1 & Type 2)", () => {
    expect(resolveManagementModel(0x07b0)).toBe("SystemB");
    expect(resolveManagementModel(0x2920)).toBe("SystemB");
    expect(resolveManagementModel(0x57b0)).toBe("SystemB");
    expect(resolveManagementModel(0x0701)).toBe("BimM112");
    expect(resolveManagementModel(0x0705)).toBe("BimM112");
    expect(resolveManagementModel(0x0021)).toBe("Bcu2");
    expect(resolveManagementModel(0x0012)).toBe("Bcu1");
    expect(resolveManagementModel(0x091a)).toBe("Bcu1");
    expect(resolveManagementModel(0x0300)).toBe("PropertyBased");

    // Legacy GrAT: [count=1+N][2B IA][2B sorted GAs]
    const grat = compileLegacyGroupAddressTable(["2/0/5", "1/0/1", "1/0/1"], "1.2.3");
    expect(grat.sortedAddresses).toEqual(["1/0/1", "2/0/5"]);
    expect(grat.buffer.readUInt8(0)).toBe(3); // 1 IA + 2 GAs
    expect(grat.buffer.readUInt16BE(1)).toBe(0x1203); // 1.2.3
    expect(grat.buffer.readUInt16BE(3)).toBe(0x0801); // 1/0/1
    expect(grat.buffer.readUInt16BE(5)).toBe(0x1005); // 2/0/5

    // Legacy GrOAT: [count][1B TSAP, 1B ASAP(0-based)]
    const activeCos = new Map([
      [
        0,
        {
          number: 0,
          comObjectId: "O-0",
          comObjectRefId: "O-0_R-0",
          name: "Switch",
          text: "Switch",
          functionText: "On/Off",
          objectSize: "1 Bit",
          valueTypeCode: 0,
          priority: "Low" as const,
          flags: { communication: true, read: false, write: true, transmit: true, update: false, readOnInit: false },
          sendingGroupAddress: "2/0/5",
          groupAddresses: ["2/0/5", "1/0/1"],
        },
      ],
    ]);
    const groat = compileLegacyAssociationTable(activeCos, grat.tsapByAddress);
    expect(groat.count).toBe(2);
    expect(groat.buffer.toString("hex")).toBe("0202000100"); // count=2, sending TSAP=2->ASAP=0 first, then TSAP=1->ASAP=0

    // Legacy GrOT Type 2 (BIM M112, 2B pointers): preserves manufacturer RAM pointers verbatim!
    const existingGrot = Buffer.from("02600460054f0061055700", "hex"); // 2 objs, ramFlags=0x6004, ptr0=0x6005, ptr1=0x6105
    const patchedGrot = compileLegacyGroupObjectTable(activeCos, 2, {
      pointerSize: 2,
      existingTable: existingGrot,
    });
    expect(patchedGrot.subarray(0, 5).toString("hex")).toBe("0260046005"); // count, ramFlagsPtr & obj0 dataPtr untouched!
    expect(patchedGrot[5]).toBe(0x57); // C|W|T|Low (0b0101_0111)
    expect(patchedGrot[6]).toBe(0x00); // 1 Bit
    expect(patchedGrot.subarray(7, 9).toString("hex")).toBe("6105"); // obj1 dataPtr untouched!
    expect(patchedGrot[9] & 0x04).toBe(0); // inactive obj1 Communication bit cleared!

    // Coupler Filter Table bitmask
    const ft = compileCouplerFilterTable(["1/0/1", "5/0/1"], 8192);
    const ga1 = 0x0801; // 1/0/1
    const ga2 = 0x2801; // 5/0/1
    expect((ft[ga1 >> 3] & (1 << (ga1 & 7))) !== 0).toBe(true);
    expect((ft[ga2 >> 3] & (1 << (ga2 & 7))) !== 0).toBe(true);
    expect((ft[0] & 1) === 0).toBe(true);
  });

  test("System 7 / BIM M112 (MV-0701) full compile & simulated download (0-based ComObjects, masked CompareProp, AllocAbsSegment, TaskSegment)", async () => {
    // Build a realistic MV-0701 app with 3 AbsoluteSegments: AddressTable @ 0x4000, AssocTable @ 0x4200, ComObjectTable @ 0x4400
    const gratTemplate = Buffer.alloc(16, 0xaa);
    const groatTemplate = Buffer.alloc(16, 0xbb);
    // 2 objects, ramFlagsPtr=0x0737, obj0 ptr=0x0700 cfg=0x4f type=0, obj1 ptr=0x0701 cfg=0x57 type=7 + 1 param byte @ offset 12
    const grotTemplate = Buffer.concat([Buffer.from("02073707004f0007015707", "hex"), Buffer.from([0x11, 0x00])]);

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20">
  <ManufacturerData>
    <Manufacturer RefId="M-0002">
      <ApplicationPrograms>
        <ApplicationProgram Id="M-0002_A-A04C-13-0D6B" ApplicationNumber="41036" ApplicationVersion="19" ProgramType="ApplicationProgram" MaskVersion="MV-0701" Name="BIM M112 Binary 4f" LoadProcedureStyle="ProductProcedure" PeiType="128" DefaultLanguage="en-US">
          <Static>
            <Code>
              <AbsoluteSegment Id="AS-4000" Address="16384" Size="16"><Data>${gratTemplate.toString("base64")}</Data></AbsoluteSegment>
              <AbsoluteSegment Id="AS-4200" Address="16896" Size="16"><Data>${groatTemplate.toString("base64")}</Data></AbsoluteSegment>
              <AbsoluteSegment Id="AS-4400" Address="17408" Size="13"><Data>${grotTemplate.toString("base64")}</Data></AbsoluteSegment>
            </Code>
            <ParameterTypes>
              <ParameterType Id="PT-Byte"><TypeNumber SizeInBit="8" Type="unsignedInt" minInclusive="0" maxInclusive="255" /></ParameterType>
            </ParameterTypes>
            <Parameters>
              <Parameter Id="P-1" Name="DebounceMs" ParameterType="PT-Byte" Text="Debounce" Value="10">
                <Memory CodeSegment="AS-4400" Offset="12" BitOffset="0" />
              </Parameter>
            </Parameters>
            <ParameterRefs><ParameterRef Id="P-1_R-1" RefId="P-1" /></ParameterRefs>
            <ComObjectTable CodeSegment="AS-4400" Offset="0">
              <ComObject Id="O-0" Name="In0" Text="Input 0" Number="0" FunctionText="Switch" ObjectSize="1 Bit" CommunicationFlag="Enabled" ReadFlag="Disabled" WriteFlag="Enabled" TransmitFlag="Enabled" UpdateFlag="Disabled" ReadOnInitFlag="Disabled" />
              <ComObject Id="O-1" Name="In1" Text="Input 1" Number="1" FunctionText="Dim" ObjectSize="1 Byte" CommunicationFlag="Enabled" ReadFlag="Enabled" WriteFlag="Disabled" TransmitFlag="Enabled" UpdateFlag="Disabled" ReadOnInitFlag="Disabled" />
            </ComObjectTable>
            <ComObjectRefs>
              <ComObjectRef Id="O-0_R-0" RefId="O-0" />
              <ComObjectRef Id="O-1_R-1" RefId="O-1" />
            </ComObjectRefs>
            <AddressTable CodeSegment="AS-4000" Offset="0" MaxEntries="6" />
            <AssociationTable CodeSegment="AS-4200" Offset="0" MaxEntries="6" />
            <LoadProcedures>
              <LoadProcedure>
                <LdCtrlConnect />
                <LdCtrlCompareProp ObjIdx="3" PropId="13" InlineData="0000A04C00" Mask="0000FFFF00" />
                <LdCtrlUnload LsmIdx="1" />
                <LdCtrlUnload LsmIdx="2" />
                <LdCtrlUnload LsmIdx="3" />
                <LdCtrlLoad LsmIdx="1" />
                <LdCtrlAbsSegment LsmIdx="1" SegType="0" Address="16384" Size="16" Access="255" MemType="3" SegFlags="0" />
                <LdCtrlTaskSegment LsmIdx="1" Address="16384" />
                <LdCtrlLoadCompleted LsmIdx="1" />
                <LdCtrlLoad LsmIdx="2" />
                <LdCtrlAbsSegment LsmIdx="2" SegType="0" Address="16896" Size="16" Access="255" MemType="3" SegFlags="0" />
                <LdCtrlTaskSegment LsmIdx="2" Address="16896" />
                <LdCtrlLoadCompleted LsmIdx="2" />
                <LdCtrlLoad LsmIdx="3" />
                <LdCtrlAbsSegment LsmIdx="3" SegType="0" Address="17408" Size="13" Access="255" MemType="3" SegFlags="128" />
                <LdCtrlTaskSegment LsmIdx="3" Address="17408" />
                <LdCtrlTaskCtrl1 LsmIdx="3" Address="17410" Count="1" />
                <LdCtrlLoadCompleted LsmIdx="3" />
                <LdCtrlRestart />
              </LoadProcedure>
            </LoadProcedures>
          </Static>
          <Dynamic>
            <ChannelIndependentBlock>
              <ParameterBlock Id="PB-1" Name="General">
                <ParameterRefRef RefId="P-1_R-1" />
                <ComObjectRefRef RefId="O-0_R-0" />
                <ComObjectRefRef RefId="O-1_R-1" />
              </ParameterBlock>
            </ChannelIndependentBlock>
          </Dynamic>
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

    const prodBuf = buildSyntheticKnxProd(xml, "M-0002", "M-0002_A-A04C-13-0D6B");
    const parsed = await KnxProdParser.parseBuffer(prodBuf);
    const session = new DeviceConfigSession(parsed);
    expect(session.getCatalogSummary().managementModel).toBe("BimM112");
    expect(session.getCatalogSummary().requiresDca).toBe(false);
    // Verify 0-based ComObject #0 is visible and active!
    expect(session.getComObject(0)?.name).toBe("In0");
    expect(session.getComObject(1)?.name).toBe("In1");

    session.setParameter("DebounceMs", 42);
    session.linkGroupObject(0, "1/0/5");
    session.linkGroupObject(1, "1/0/6");

    const bus = new MockBus("1.1.250");
    const mockDev = new MockMultiArchDevice({
      individualAddress: "1.1.12",
      maskVersion: 0x0701,
      manufacturerId: 0x0002,
      initialProps: new Map([["3:13", Buffer.from("0002A04C13", "hex")]]), // matches Mask 0000FFFF00!
    });
    mockDev.attach(bus);

    const programmer = new KNXDeviceProgrammer(new KNXManagement(bus, { minFrameDelayMs: 0 }));
    const res = await session.download(programmer, "1.1.12", { mode: "ap1", skipDelay: true });

    expect(res.dryRun).toBe(false);
    expect(res.image.managementModel).toBe("BimM112");
    expect(mockDev.restarted).toBe(true);
    // Verify AddressTable @ 0x4000 has IA=1.1.12 (0x110c) and GAs 1/0/5 (0x0805), 1/0/6 (0x0806)
    expect(mockDev.memory.subarray(0x4000, 0x4007).toString("hex")).toBe("03110c08050806");
    // Verify AssociationTable @ 0x4200 has TSAP=1->ASAP=0, TSAP=2->ASAP=1
    expect(mockDev.memory.subarray(0x4200, 0x4205).toString("hex")).toBe("0201000201");
    // Verify ComObjectTable @ 0x4400 preserved RAM pointers 0x0737 / 0x0700 / 0x0701 AND patched DebounceMs=42 (0x2a) at offset 12!
    expect(mockDev.memory.subarray(0x4400, 0x4405).toString("hex")).toBe("0207370700");
    expect(mockDev.memory[0x4400 + 12]).toBe(42);
    // Verify TaskSegment (0x03) and TaskCtrl1 (0x05) load controls were sent
    const taskSeg = mockDev.loadControlsReceived.find((c) => c.event === 0x03 && c.payload[0] === 0x03);
    const taskCtrl1 = mockDev.loadControlsReceived.find((c) => c.event === 0x03 && c.payload[0] === 0x05);
    expect(taskSeg).toBeDefined();
    expect(taskSeg!.payload.readUInt8(3)).toBe(128); // peiType
    expect(taskSeg!.payload.readUInt16BE(4)).toBe(0x0002); // manufacturerId
    expect(taskSeg!.payload.readUInt16BE(6)).toBe(0xa04c); // appNumber
    expect(taskSeg!.payload.readUInt8(8)).toBe(19); // appVersion
    expect(taskCtrl1).toBeDefined();
  });

  test("System 1 / BCU1 (MV-0012) pure memory-only download & BCU2 (MV-0021) downward mask compatibility", async () => {
    const eepromBase = Buffer.alloc(256, 0x00);
    eepromBase[0x04] = 0x02; // MfrId at 0x0104
    eepromBase[0x16] = 0x01; // AddressTable count at 0x0116

    const bcu1Xml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20">
  <ManufacturerData>
    <Manufacturer RefId="M-0002">
      <ApplicationPrograms>
        <ApplicationProgram Id="M-0002_A-0100-10-0001" ApplicationNumber="256" ApplicationVersion="16" ProgramType="ApplicationProgram" MaskVersion="MV-0012" Name="Legacy BCU1 Switch" LoadProcedureStyle="MergedProcedure" PeiType="0" DefaultLanguage="en-US">
          <Static>
            <Code>
              <AbsoluteSegment Id="AS-0100" Address="256" Size="256"><Data>${eepromBase.toString("base64")}</Data></AbsoluteSegment>
            </Code>
            <ParameterTypes>
              <ParameterType Id="PT-Mode"><TypeNumber SizeInBit="8" Type="unsignedInt" minInclusive="0" maxInclusive="5" /></ParameterType>
            </ParameterTypes>
            <Parameters>
              <Parameter Id="P-Mode" Name="SwitchMode" ParameterType="PT-Mode" Text="Mode" Value="1">
                <Memory CodeSegment="AS-0100" Offset="60" BitOffset="0" />
              </Parameter>
            </Parameters>
            <ParameterRefs><ParameterRef Id="P-Mode_R-1" RefId="P-Mode" /></ParameterRefs>
            <ComObjectTable CodeSegment="AS-0100" Offset="80">
              <ComObject Id="O-0" Name="Relay" Text="Relay" Number="0" FunctionText="On/Off" ObjectSize="1 Bit" CommunicationFlag="Enabled" ReadFlag="Disabled" WriteFlag="Enabled" TransmitFlag="Disabled" UpdateFlag="Disabled" ReadOnInitFlag="Disabled" />
            </ComObjectTable>
            <ComObjectRefs><ComObjectRef Id="O-0_R-0" RefId="O-0" /></ComObjectRefs>
            <AddressTable CodeSegment="AS-0100" Offset="22" MaxEntries="4" />
            <AssociationTable CodeSegment="AS-0100" Offset="40" MaxEntries="4" />
            <LoadProcedures />
          </Static>
          <Dynamic>
            <ChannelIndependentBlock>
              <ParameterBlock Id="PB-1" Name="General">
                <ParameterRefRef RefId="P-Mode_R-1" />
                <ComObjectRefRef RefId="O-0_R-0" />
              </ParameterBlock>
            </ChannelIndependentBlock>
          </Dynamic>
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

    const parsedBcu1 = await KnxProdParser.parseBuffer(
      buildSyntheticKnxProd(bcu1Xml, "M-0002", "M-0002_A-0100-10-0001"),
    );

    // 1. Download onto pure memory-only BCU1 device (MV-0012, no Interface Objects)
    const bus1 = new MockBus("1.1.250");
    const mockBcu1 = new MockMultiArchDevice({
      individualAddress: "1.1.20",
      maskVersion: 0x0012,
      manufacturerId: 0x0002,
      supportsInterfaceObjects: false,
    });
    // Real BCU1 holds its programmed IA (1.1.20 = 0x1114) at 0x0117..0x0118 (not overwritten by app download)
    mockBcu1.memory.writeUInt16BE(0x1114, 0x0117);
    mockBcu1.attach(bus1);

    const prog1 = new KNXDeviceProgrammer(new KNXManagement(bus1, { minFrameDelayMs: 0 }));
    const r1 = await prog1.download(
      "1.1.20",
      parsedBcu1,
      { parameters: { SwitchMode: 3 }, groupLinks: { 0: "3/1/2" } },
      { mode: "ap1", skipDelay: true },
    );
    expect(r1.image.managementModel).toBe("Bcu1");
    expect(mockBcu1.restarted).toBe(true);
    expect(mockBcu1.memory[0x0100 + 60]).toBe(3); // SwitchMode patched in EEPROM
    expect(mockBcu1.memory[0x010d]).toBe(0xff); // RunError restored to 0xFF at end of BCU1 procedure
    expect(mockBcu1.memory.subarray(0x0100 + 22, 0x0100 + 27).toString("hex")).toBe("0211141902"); // count=2, IA=1.1.20 (0x1114), GA=3/1/2 (0x1902)

    // 2. Downward compatibility: MV-0021 (BCU2) hardware accepts MV-0012 application!
    const bus2 = new MockBus("1.1.250");
    const mockBcu2 = new MockMultiArchDevice({
      individualAddress: "1.1.21",
      maskVersion: 0x0021,
      manufacturerId: 0x0002,
      supportsInterfaceObjects: true,
    });
    mockBcu2.attach(bus2);
    const prog2 = new KNXDeviceProgrammer(new KNXManagement(bus2, { minFrameDelayMs: 0 }));
    const r2 = await prog2.download("1.1.21", parsedBcu1, { parameters: { SwitchMode: 4 } }, { dryRun: true });
    expect(r2.dryRun).toBe(true);
    expect(r2.preflight?.maskVersion).toBe(0x0021);
  });

  test("Couplers MV-091A & MV-2920 (PID_IO_LIST ObjType 6, ClearLCFilterTable, FilterTable & Area HopCount) + System 300 (MV-0300)", async () => {
    // 1. System B Coupler MV-2920 (Area Coupler 1.0.0 -> PID_HOP_COUNT=0004, ObjType 6 Occurrence 1 Filter Table)
    const coupler2920Xml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20">
  <ManufacturerData>
    <Manufacturer RefId="M-0071">
      <ApplicationPrograms>
        <ApplicationProgram Id="M-0071_A-9001-10-0001" ApplicationNumber="36865" ApplicationVersion="16" ProgramType="ApplicationProgram" MaskVersion="MV-2920" Name="System B Coupler" LoadProcedureStyle="MergedProcedure" PeiType="0" DefaultLanguage="en-US">
          <Static>
            <Code />
            <ParameterTypes />
            <Parameters />
            <ParameterRefs />
            <ComObjectTable />
            <ComObjectRefs />
            <LoadProcedures />
          </Static>
          <Dynamic />
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

    const parsed2920 = await KnxProdParser.parseBuffer(
      buildSyntheticKnxProd(coupler2920Xml, "M-0071", "M-0071_A-9001-10-0001"),
    );

    const bus2920 = new MockBus("1.1.250");
    // IO List: [0:Device, 6:PrimaryRouter (occ 0), 6:SecondaryRouter (occ 1)]
    const mock2920 = new MockMultiArchDevice({
      individualAddress: "1.0.0",
      maskVersion: 0x2920,
      manufacturerId: 0x0071,
      ioList: [0, 6, 6],
    });
    mock2920.attach(bus2920);

    const prog2920 = new KNXDeviceProgrammer(new KNXManagement(bus2920, { minFrameDelayMs: 0 }));
    const res2920 = await prog2920.download(
      "1.0.0",
      parsed2920,
      { filterTableGroupAddresses: ["1/0/1", "4/2/3"] },
      { mode: "ap1", skipDelay: true },
    );
    expect(res2920.image.isAreaCoupler).toBe(true);
    // ClearLCFilterTable called FunctionProperty PID 58 on secondary router object (index 2)
    expect(mock2920.functionPropsCalled.some((f) => f.objIdx === 2 && f.propId === 58 && f.data[0] === 0x01)).toBe(
      true,
    );
    // PID_HOP_COUNT (PID 61) on primary router (index 1) was adjusted to 0004 for Area Coupler 1.0.0!
    expect(mock2920.props.get("1:61")?.toString("hex")).toBe("0004");
    // Filter table bits written at secondary router base address (relBases.get(2) = 0xC000)
    const router2Base = mock2920.relBases.get(2)!;
    const gaA = 0x0801; // 1/0/1
    const gaB = 0x2203; // 4/2/3
    expect((mock2920.memory[router2Base + (gaA >> 3)] & (1 << (gaA & 7))) !== 0).toBe(true);
    expect((mock2920.memory[router2Base + (gaB >> 3)] & (1 << (gaB & 7))) !== 0).toBe(true);

    // Unload on MV-2920 executes LdCtrlMasterReset (EraseCode=7)
    await prog2920.unload("1.0.0", parsed2920, { skipDelay: true });
    expect(mock2920.masterReset).toEqual({ eraseCode: 7, channel: 0 });

    // 2. System 300 (MV-0300 PropertyBased) direct property parameter download
    const sys300Xml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20">
  <ManufacturerData>
    <Manufacturer RefId="M-0083">
      <ApplicationPrograms>
        <ApplicationProgram Id="M-0083_A-0300-10-0001" ApplicationNumber="768" ApplicationVersion="16" ProgramType="ApplicationProgram" MaskVersion="MV-0300" Name="System 300 Device" LoadProcedureStyle="MergedProcedure" PeiType="0" DefaultLanguage="en-US">
          <Static>
            <Code />
            <ParameterTypes>
              <ParameterType Id="PT-U16"><TypeNumber SizeInBit="16" Type="unsignedInt" minInclusive="0" maxInclusive="65535" /></ParameterType>
            </ParameterTypes>
            <Parameters>
              <Parameter Id="P-Timeout" Name="TimeoutSec" ParameterType="PT-U16" Text="Timeout" Value="30">
                <Property ObjectIndex="0" PropertyId="200" Offset="0" BitOffset="0" />
              </Parameter>
            </Parameters>
            <ParameterRefs><ParameterRef Id="P-Timeout_R-1" RefId="P-Timeout" /></ParameterRefs>
            <ComObjectTable />
            <ComObjectRefs />
            <LoadProcedures />
          </Static>
          <Dynamic>
            <ChannelIndependentBlock>
              <ParameterBlock Id="PB-1" Name="General"><ParameterRefRef RefId="P-Timeout_R-1" /></ParameterBlock>
            </ChannelIndependentBlock>
          </Dynamic>
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

    const parsed300 = await KnxProdParser.parseBuffer(
      buildSyntheticKnxProd(sys300Xml, "M-0083", "M-0083_A-0300-10-0001"),
    );
    const img300 = KNXApplicationCompiler.compile(parsed300.applications[0], { parameters: { TimeoutSec: 600 } });
    expect(img300.managementModel).toBe("PropertyBased");
    expect(img300.propertyWrites).toHaveLength(1);
    expect(img300.propertyWrites[0].data.readUInt16BE(0)).toBe(600);

    const bus300 = new MockBus("1.1.250");
    const mock300 = new MockMultiArchDevice({
      individualAddress: "1.1.30",
      maskVersion: 0x0300,
      manufacturerId: 0x0083,
    });
    mock300.attach(bus300);
    const prog300 = new KNXDeviceProgrammer(new KNXManagement(bus300, { minFrameDelayMs: 0 }));
    await prog300.download("1.1.30", parsed300, { parameters: { TimeoutSec: 600 } }, { mode: "ap1" });
    expect(mock300.props.get("0:200")?.readUInt16BE(0)).toBe(600);
    expect(mock300.restarted).toBe(true);
  });

  test("Automatic ETS Plugin / DCA detection (fail-fast guard + zero false positives on icon baggages)", async () => {
    const dcaXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20">
  <ManufacturerData>
    <Manufacturer RefId="M-0004">
      <ApplicationPrograms>
        <ApplicationProgram Id="M-0004_A-DALI-10-0001" ApplicationNumber="1" ApplicationVersion="1" ProgramType="ApplicationProgram" MaskVersion="MV-07B0" Name="DALI Gateway DCA" LoadProcedureStyle="MergedProcedure" PeiType="0" DefaultLanguage="en-US" DownloadInfoIncomplete="true">
          <Static>
            <Code />
            <ParameterTypes>
              <ParameterType Id="PT-Custom" Plugin="DaliMatrixPlugin"><TypeNone /></ParameterType>
            </ParameterTypes>
            <Parameters />
            <ParameterRefs />
            <ComObjectTable />
            <ComObjectRefs />
            <LoadProcedures />
            <Extension EtsDownloadPlugin="DaliGateway.DownloadPlugin.dll" EtsUiPlugin="DaliGateway.Ui.dll" RequiresExternalSoftware="true">
              <Baggage RefId="M-0004_BG-icon" />
            </Extension>
          </Static>
          <Dynamic />
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

    const parsedDca = await KnxProdParser.parseBuffer(buildSyntheticKnxProd(dcaXml, "M-0004", "M-0004_A-DALI-10-0001"));
    const appDca = parsedDca.applications[0];
    expect(appDca.extension?.requiresDca).toBe(true);
    expect(appDca.extension?.hasDownloadPlugin).toBe(true);
    expect(appDca.extension?.hasUiPlugin).toBe(true);
    expect(appDca.extension?.etsDownloadPlugin).toBe("DaliGateway.DownloadPlugin.dll");
    expect(appDca.extension?.pluginParameterTypeIds).toEqual(["PT-Custom"]);

    const session = new DeviceConfigSession(parsedDca);
    expect(session.getCatalogSummary().requiresDca).toBe(true);
    const val = session.validate();
    expect(val.valid).toBe(false);
    expect(val.errors.some((e) => e.code === "REQUIRES_ETS_DCA")).toBe(true);

    const bus = new MockBus("1.1.250");
    const programmer = new KNXDeviceProgrammer(new KNXManagement(bus, { minFrameDelayMs: 0 }));
    await expect(programmer.download("1.1.50", parsedDca, {}, { dryRun: true })).rejects.toThrow(/DCA|Plugin/i);

    // Normal Baggage-only <Extension> (like Zennio icons) must NOT trigger requiresDca!
    const normalXml = dcaXml
      .replace(`DownloadInfoIncomplete="true"`, `DownloadInfoIncomplete="false"`)
      .replace(`Plugin="DaliMatrixPlugin"`, `Plugin=""`)
      .replace(
        `EtsDownloadPlugin="DaliGateway.DownloadPlugin.dll" EtsUiPlugin="DaliGateway.Ui.dll" RequiresExternalSoftware="true"`,
        `RequiresExternalSoftware="0"`,
      );
    const parsedNormal = await parseApplicationProgramStream(Readable.from([normalXml]));
    expect(parsedNormal[0].extension?.requiresDca).toBe(false);
    expect(parsedNormal[0].extension?.baggageRefIds).toEqual(["M-0004_BG-icon"]);
  });

  const CHIA_KNXPROJ = path.resolve(__dirname, "../Ignore/knxproj/Alcaldia de Chia V2.knxproj");
  const testIfChia = fs.existsSync(CHIA_KNXPROJ) ? test : test.skip;

  testIfChia(
    "Real ETS project (Alcaldia de Chia): compile & plan MV-0701, MV-0705, MV-0021 & MV-091A Coupler directly from KnxProject",
    async () => {
      const project = KnxProject.fromFile(CHIA_KNXPROJ);
      const devices = project.getDevices();

      // Inspect real non-SystemB devices inside the ETS project
      const testedModels = new Set<string>();
      for (const dev of devices) {
        if (!dev.individualAddress || !dev.applicationProgramRefId) continue;
        const appId = dev.applicationProgramRefId;
        if (
          appId !== "M-0002_A-A04C-13-0D6B" && // MV-0701 (BimM112)
          appId !== "M-008E_A-5960-20-C245" && // MV-0705 (BimM112)
          appId !== "M-00FE_A-2027-10-EBCC" && // MV-0021 (Bcu2)
          appId !== "M-0071_A-6371-11-83E5-O0072" // MV-091A (Bcu1 Coupler)
        ) {
          continue;
        }
        if (testedModels.has(appId)) continue;
        testedModels.add(appId);

        const session = await project.openDeviceSession(dev.individualAddress);
        const summary = session.getCatalogSummary();
        expect(summary.requiresDca).toBe(false);

        const { image, plan } = session.planDownload({ mode: "ap1" });
        expect(plan.actions.length).toBeGreaterThan(3);

        if (appId === "M-0002_A-A04C-13-0D6B") {
          expect(image.managementModel).toBe("BimM112");
          expect(image.absoluteSegments.length).toBe(5);
          expect(plan.actions.some((a) => a.type === "AllocAbsSegment")).toBe(true);
          expect(plan.actions.some((a) => a.type === "TaskSegment")).toBe(true);
          expect(plan.actions.some((a) => a.type === "WriteAbsMem")).toBe(true);
        } else if (appId === "M-008E_A-5960-20-C245") {
          expect(image.managementModel).toBe("BimM112");
          expect(session.getComObject(0)).toBeDefined(); // 0-based ComObject #0 active!
          expect(plan.actions.some((a) => a.type === "TaskCtrl1")).toBe(true);
        } else if (appId === "M-00FE_A-2027-10-EBCC") {
          expect(image.managementModel).toBe("Bcu2");
          expect(plan.actions[0].type).toBe("Connect"); // minimal ProductProcedure auto-wrapped!
          expect(plan.actions.some((a) => a.type === "AllocAbsSegment")).toBe(true);
        } else if (appId === "M-0071_A-6371-11-83E5-O0072") {
          expect(image.managementModel).toBe("Bcu1");
          expect(image.filterTable?.length).toBe(8192);
          expect(plan.actions.some((a) => a.type === "ClearLCFilterTable")).toBe(true);
          expect(plan.actions.some((a) => a.type === "WriteAbsMem" && a.address === 264)).toBe(true);
        }
      }

      // Also test embedded MV-0701 (BimM112) catalog app directly even when unassigned in topology
      const mv0701App = await project.loadApplicationProgram("M-0002_A-A04C-13-0D6B");
      const mv0701Img = SystemBCompiler.compile(mv0701App, { individualAddress: "1.1.99" });
      const mv0701Plan = LoadProcedureEngine.buildPlan(mv0701App, mv0701Img, "ap1");
      expect(mv0701Img.managementModel).toBe("BimM112");
      expect(mv0701Img.absoluteSegments.length).toBe(5);
      expect(mv0701Plan.actions.some((a) => a.type === "CompareProp" && a.mask !== undefined)).toBe(true);
      expect(mv0701Plan.actions.some((a) => a.type === "AllocAbsSegment")).toBe(true);
      expect(mv0701Plan.actions.some((a) => a.type === "TaskSegment")).toBe(true);
      expect(mv0701Plan.actions.some((a) => a.type === "WriteAbsMem")).toBe(true);

      expect(testedModels.size).toBeGreaterThanOrEqual(3);
    },
    30000,
  );
});
