import fs from "node:fs";
import path from "node:path";
import { KNXService } from "../src/connection/KNXService";
import { CEMI, CEMIInstance } from "../src/core/CEMI";
import { ControlField } from "../src/core/ControlField";
import { ExtendedControlField } from "../src/core/ControlFieldExtended";
import { KnxDataEncoder } from "../src/core/data/KNXDataEncode";
import { APCIEnum } from "../src/core/enum/APCIEnum";
import { APDU } from "../src/core/layers/data/APDU";
import { TPDU } from "../src/core/layers/data/TPDU";
import { APCI } from "../src/core/layers/interfaces/APCI";
import { TPCI, TPCIType } from "../src/core/layers/interfaces/TPCI";
import { ManagementReturnCode } from "../src/management/apduBuilders";
import {
  KNXInterfaceObjectType,
  KNXIPParameterPropertyId,
  KNXManagement,
  KNXPropertyId,
  KNXSecurityPropertyId,
  LoadEvent,
  LoadState,
  RunState,
} from "../src/management/KNXManagement";
import {
  decodeKnxTsLoadedImage,
  DeviceConfigSession,
  encodeKnxTsLoadedImage,
  KNXDeviceProgrammer,
  KnxProdParser,
  ZipWriter,
} from "../src/programming";
import { KnxProject, KnxRuntimeTelegramEvent, normalizeEtsDatapointType } from "../src/project";
import { KNXHelper } from "../src/utils/KNXHelper";

// ============================================================================
// Multi-Device Mock KNX Bus Harness
// ============================================================================

class MultiDeviceMockBus extends KNXService {
  private readonly devices = new Map<string, MockBusDevice>();
  public readonly sentGroupFrames: { dst: string; apci: number; data: Buffer }[] = [];
  private groupHandler?: (dst: string, apci: number, data: Buffer, bus: MultiDeviceMockBus) => void;

  constructor(ia: string = "1.1.250") {
    super({ individualAddress: ia });
    this.individualAddress = ia;
  }

  public get connectionState(): string {
    return "CONNECTED";
  }

  public registerDevice(dev: MockBusDevice): void {
    this.devices.set(dev.ia, dev);
  }

  public setGroupHandler(fn: (dst: string, apci: number, data: Buffer, bus: MultiDeviceMockBus) => void): void {
    this.groupHandler = fn;
  }

  public async connect(): Promise<void> {}
  public disconnect(): void {}

  public async send(data: CEMIInstance | Buffer): Promise<void> {
    const prepared = this.prepareOutgoingCemi(data);
    const cemi = Buffer.isBuffer(prepared) ? CEMI.fromBuffer(prepared) : prepared;
    if ("destinationAddress" in cemi && "TPDU" in cemi) {
      const dst = cemi.destinationAddress;
      if (dst.includes("/")) {
        const apci = cemi.TPDU.apdu.apci.value;
        const payload = Buffer.from(cemi.TPDU.apdu.data);
        this.sentGroupFrames.push({ dst, apci, data: payload });
        if (this.groupHandler) {
          queueMicrotask(() => this.groupHandler!(dst, apci, payload, this));
        }
        return;
      }
      const dev = this.devices.get(dst);
      if (dev) {
        queueMicrotask(() => dev.handle(cemi, this));
      }
    }
  }

  public inject(cemi: CEMIInstance): void {
    const processed = this.processIncomingCemi(cemi);
    if (processed) this.emit("indication", processed);
  }

  public injectGroupTelegram(srcIa: string, dstGa: string, apci: APCIEnum, dpt: string | null, value?: unknown): void {
    let data: Buffer = Buffer.alloc(1, 0x00);
    let isShort = true;
    if (apci !== APCIEnum.A_GroupValue_Read_Protocol_Data_Unit && dpt) {
      data = KnxDataEncoder.encodeThis(dpt as any, value as any);
      isShort = KnxDataEncoder.isShortDpt(dpt as any);
    }
    const cf1 = new ControlField(0xbc);
    const cf2 = new ExtendedControlField(0xe0);
    const tpdu = new TPDU(
      new TPCI(TPCIType.T_DATA_GROUP_PDU),
      new APDU(new TPCI(TPCIType.T_DATA_GROUP_PDU), new APCI(apci), data, isShort),
      data,
    );
    const ind = new CEMI.DataLinkLayerCEMI["L_Data.ind"](null, cf1, cf2, srcIa, dstGa, tpdu);
    this.inject(ind);
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

interface MockBusDeviceConfig {
  ia: string;
  maskVersion: number;
  manufacturerId: number;
  serialNumberHex?: string;
  hardwareTypeHex?: string;
  orderInfo?: string;
  firmwareRevision?: number;
  maxApduLength?: number;
  ioList?: number[];
  programVersionHex?: string;
  groupAddresses?: string[];
  ipObjIdx?: number;
  ipProps?: {
    ipAddress?: string;
    subnetMask?: string;
    defaultGateway?: string;
    assignmentMethod?: number;
    macHex?: string;
    routingMulticast?: string;
    ttl?: number;
    friendlyName?: string;
    additionalIas?: string[];
  };
  hasSecurityObj?: boolean;
  securityMode?: boolean;
  onDownloadEvent?: (ia: string) => void;
}

class MockBusDevice {
  public readonly ia: string;
  public readonly maskVersion: number;
  public readonly manufacturerId: number;
  public readonly ioList: number[];
  public readonly maxApduLength: number;
  public memory: Buffer = Buffer.alloc(0x30000, 0x00);
  public loadStates = new Map<number, LoadState>();
  public relBases = new Map<number, number>();
  public props = new Map<string, Buffer>();
  public groupAddresses: string[];
  public additionalIas: string[];
  public friendlyNameBuf: Buffer = Buffer.alloc(30, 0x00);
  public ipObjIdx?: number;
  public securityMode: boolean;
  public securityLoadState: LoadState = LoadState.LOADED;
  public securitySeqNr: bigint = 123456n;
  public restartedCount = 0;
  public writeMemoryCalls = 0;
  public writtenMemoryBytes = 0;
  private devTxSeq = 0;
  private readonly onDownloadEvent?: (ia: string) => void;

  constructor(cfg: MockBusDeviceConfig) {
    this.ia = cfg.ia;
    this.maskVersion = cfg.maskVersion;
    this.manufacturerId = cfg.manufacturerId;
    this.maxApduLength = cfg.maxApduLength ?? 220;
    this.ipObjIdx = cfg.ipObjIdx;
    this.securityMode = cfg.securityMode ?? false;
    this.onDownloadEvent = cfg.onDownloadEvent;
    this.groupAddresses = [...(cfg.groupAddresses ?? [])];
    this.additionalIas = [...(cfg.ipProps?.additionalIas ?? [])];

    if (cfg.ioList) {
      this.ioList = [...cfg.ioList];
    } else {
      const list = [0, 1, 2, 9, 3]; // System B: Dev(0), GrAT(1), GrOAT(2), GrOT(3->type9), App(4->type3)
      if (cfg.ipObjIdx !== undefined) {
        while (list.length < cfg.ipObjIdx) list.push(0);
        list[cfg.ipObjIdx] = KNXInterfaceObjectType.KNXNETIP_PARAMETER_OBJECT;
      }
      if (cfg.hasSecurityObj) {
        list.push(KNXInterfaceObjectType.SECURITY_OBJECT);
      }
      this.ioList = list;
    }

    for (let i = 0; i < Math.max(6, this.ioList.length); i++) {
      this.loadStates.set(i, LoadState.LOADED);
      this.relBases.set(i, 0x4000 + i * 0x2000);
    }

    const mfrBuf = Buffer.alloc(2);
    mfrBuf.writeUInt16BE(this.manufacturerId, 0);
    this.props.set(`0:${KNXPropertyId.PID_MANUFACTURER_ID}`, mfrBuf);

    const apduBuf = Buffer.alloc(2);
    apduBuf.writeUInt16BE(this.maxApduLength, 0);
    this.props.set(`0:${KNXPropertyId.PID_MAX_APDULENGTH}`, apduBuf);

    if (cfg.serialNumberHex) {
      this.props.set(`0:${KNXPropertyId.PID_SERIAL_NUMBER}`, Buffer.from(cfg.serialNumberHex, "hex"));
    }
    if (cfg.hardwareTypeHex) {
      this.props.set(`0:${KNXPropertyId.PID_HARDWARE_TYPE}`, Buffer.from(cfg.hardwareTypeHex, "hex"));
    }
    if (cfg.orderInfo) {
      this.props.set(`0:${KNXPropertyId.PID_ORDER_INFO}`, Buffer.from(cfg.orderInfo, "ascii"));
    }
    if (cfg.firmwareRevision !== undefined) {
      this.props.set(`0:${KNXPropertyId.PID_FIRMWARE_REVISION}`, Buffer.from([cfg.firmwareRevision]));
    }
    this.props.set(`0:${KNXPropertyId.PID_PROG_MODE}`, Buffer.from([0x00]));

    if (cfg.programVersionHex) {
      const appIdx = this.ioList.indexOf(KNXInterfaceObjectType.APPLICATIONPROGRAM_OBJECT);
      this.props.set(
        `${appIdx >= 0 ? appIdx : 4}:${KNXPropertyId.PID_PROGRAM_VERSION}`,
        Buffer.from(cfg.programVersionHex, "hex"),
      );
    }

    if (cfg.ipObjIdx !== undefined && cfg.ipProps) {
      const idx = cfg.ipObjIdx;
      const toIpv4 = (ip: string) => Buffer.from(ip.split(".").map((s) => parseInt(s, 10)));
      if (cfg.ipProps.ipAddress) {
        this.props.set(`${idx}:${KNXIPParameterPropertyId.PID_IP_ADDRESS}`, toIpv4(cfg.ipProps.ipAddress));
        this.props.set(`${idx}:${KNXIPParameterPropertyId.PID_CURRENT_IP_ADDRESS}`, toIpv4(cfg.ipProps.ipAddress));
      }
      if (cfg.ipProps.subnetMask) {
        this.props.set(`${idx}:${KNXIPParameterPropertyId.PID_SUBNET_MASK}`, toIpv4(cfg.ipProps.subnetMask));
        this.props.set(`${idx}:${KNXIPParameterPropertyId.PID_CURRENT_SUBNET_MASK}`, toIpv4(cfg.ipProps.subnetMask));
      }
      if (cfg.ipProps.defaultGateway) {
        this.props.set(`${idx}:${KNXIPParameterPropertyId.PID_DEFAULT_GATEWAY}`, toIpv4(cfg.ipProps.defaultGateway));
        this.props.set(
          `${idx}:${KNXIPParameterPropertyId.PID_CURRENT_DEFAULT_GATEWAY}`,
          toIpv4(cfg.ipProps.defaultGateway),
        );
      }
      if (cfg.ipProps.assignmentMethod !== undefined) {
        this.props.set(
          `${idx}:${KNXIPParameterPropertyId.PID_IP_ASSIGNMENT_METHOD}`,
          Buffer.from([cfg.ipProps.assignmentMethod]),
        );
        this.props.set(
          `${idx}:${KNXIPParameterPropertyId.PID_CURRENT_IP_ASSIGNMENT_METHOD}`,
          Buffer.from([cfg.ipProps.assignmentMethod]),
        );
      }
      if (cfg.ipProps.macHex) {
        this.props.set(`${idx}:${KNXIPParameterPropertyId.PID_MAC_ADDRESS}`, Buffer.from(cfg.ipProps.macHex, "hex"));
      }
      if (cfg.ipProps.routingMulticast) {
        this.props.set(
          `${idx}:${KNXIPParameterPropertyId.PID_ROUTING_MULTICAST_ADDRESS}`,
          toIpv4(cfg.ipProps.routingMulticast),
        );
      }
      if (cfg.ipProps.ttl !== undefined) {
        this.props.set(`${idx}:${KNXIPParameterPropertyId.PID_TTL}`, Buffer.from([cfg.ipProps.ttl]));
      }
      if (cfg.ipProps.friendlyName) {
        Buffer.from(cfg.ipProps.friendlyName, "latin1").copy(
          this.friendlyNameBuf,
          0,
          0,
          Math.min(cfg.ipProps.friendlyName.length, 29),
        );
      }
      this.props.set(
        `${idx}:${KNXIPParameterPropertyId.PID_KNX_INDIVIDUAL_ADDRESS}`,
        KNXHelper.GetAddress(this.ia, "."),
      );
    }
  }

  private reply(
    bus: MultiDeviceMockBus,
    dst: string,
    apci: APCIEnum | number,
    data: Buffer,
    isShort: boolean = false,
  ): void {
    const seq = this.devTxSeq;
    this.devTxSeq = (this.devTxSeq + 1) & 0x0f;
    bus.inject(makeInd(this.ia, dst, TPCIType.T_DATA_CONNECTED_PDU | (seq << 2), apci, data, isShort));
  }

  public handle(cemi: CEMIInstance, bus: MultiDeviceMockBus): void {
    if (!("TPDU" in cemi) || !("destinationAddress" in cemi)) return;
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
      const dd0 = Buffer.alloc(2);
      dd0.writeUInt16BE(this.maskVersion, 0);
      this.reply(bus, src, APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit, dd0, false);
      return;
    }

    if (apci === APCIEnum.A_Authorize_Request_Protocol_Data_Unit) {
      this.reply(bus, src, APCIEnum.A_Authorize_Response_Protocol_Data_Unit, Buffer.from([0x00]), false);
      return;
    }

    if (apci === APCIEnum.A_Restart_Protocol_Data_Unit) {
      this.restartedCount++;
      return;
    }

    if (apci === APCIEnum.A_PropertyDescription_Read_Protocol_Data_Unit) {
      const objIdx = data[0];
      const propId = data[1];
      const propIdx = data[2];
      // Report Format 0 (PDT_GENERIC_02 = 0x12) for GrOAT Obj 2 PID 23
      if (objIdx === 2 && propId === KNXPropertyId.PID_TABLE) {
        this.reply(
          bus,
          src,
          APCIEnum.A_PropertyDescription_Response_Protocol_Data_Unit,
          Buffer.from([objIdx, propId, propIdx, 0x12, 0x00, 0xff, 0x33]),
        );
        return;
      }
      this.reply(
        bus,
        src,
        APCIEnum.A_PropertyDescription_Response_Protocol_Data_Unit,
        Buffer.from([objIdx, propId, propIdx, 0x00, 0x00, 0x00, 0x00]),
      );
      return;
    }

    if (apci === APCIEnum.A_FunctionPropertyCommand_Protocol_Data_Unit) {
      const objIdx = data[0];
      const propId = data[1];
      this.reply(
        bus,
        src,
        APCIEnum.A_FunctionPropertyState_Response_Protocol_Data_Unit,
        Buffer.from([objIdx, propId, ManagementReturnCode.E_SUCCESS]),
      );
      return;
    }

    if (apci === APCIEnum.A_PropertyValue_Read_Protocol_Data_Unit) {
      const objIdx = data[0];
      const propId = data[1];
      const count = (data[2] >> 4) & 0x0f;
      const startIndex = ((data[2] & 0x0f) << 8) | data[3];
      const mkResp = (c: number, payload: Buffer) => {
        const hdr = Buffer.alloc(4);
        hdr[0] = objIdx;
        hdr[1] = propId;
        hdr[2] = ((c & 0x0f) << 4) | ((startIndex >> 8) & 0x0f);
        hdr[3] = startIndex & 0xff;
        this.reply(bus, src, APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit, Buffer.concat([hdr, payload]));
      };

      // PID_IO_LIST (Obj 0, PID 71)
      if (objIdx === 0 && propId === KNXPropertyId.PID_IO_LIST) {
        if (startIndex === 0) {
          const b = Buffer.alloc(2);
          b.writeUInt16BE(this.ioList.length, 0);
          mkResp(1, b);
          return;
        }
        const slice = this.ioList.slice(startIndex - 1, startIndex - 1 + count);
        const buf = Buffer.alloc(slice.length * 2);
        slice.forEach((t, i) => buf.writeUInt16BE(t, i * 2));
        mkResp(slice.length, buf);
        return;
      }

      // PID_OBJECT_TYPE
      if (propId === KNXPropertyId.PID_OBJECT_TYPE) {
        if (objIdx < this.ioList.length) {
          const b = Buffer.alloc(2);
          b.writeUInt16BE(this.ioList[objIdx], 0);
          mkResp(1, b);
          return;
        }
        mkResp(0, Buffer.alloc(0));
        return;
      }

      // PID_LOAD_STATE_CONTROL
      if (propId === KNXPropertyId.PID_LOAD_STATE_CONTROL) {
        const st = this.loadStates.get(objIdx);
        if (st !== undefined) {
          mkResp(1, Buffer.from([st]));
          return;
        }
        mkResp(0, Buffer.alloc(0));
        return;
      }

      // PID_RUN_STATE_CONTROL
      if (propId === KNXPropertyId.PID_RUN_STATE_CONTROL) {
        const appIdx = this.ioList.indexOf(KNXInterfaceObjectType.APPLICATIONPROGRAM_OBJECT);
        if (objIdx === (appIdx >= 0 ? appIdx : 4)) {
          mkResp(1, Buffer.from([RunState.RUNNING]));
          return;
        }
        mkResp(0, Buffer.alloc(0));
        return;
      }

      // PID_TABLE_REFERENCE
      if (propId === KNXPropertyId.PID_TABLE_REFERENCE) {
        const base = this.relBases.get(objIdx) ?? 0x4000;
        const b = Buffer.alloc(4);
        b.writeUInt32BE(base, 0);
        mkResp(1, b);
        return;
      }

      // Object 1 PID_TABLE (Group Address Table)
      if (objIdx === 1 && propId === KNXPropertyId.PID_TABLE) {
        if (startIndex === 0) {
          const b = Buffer.alloc(2);
          b.writeUInt16BE(this.groupAddresses.length, 0);
          mkResp(1, b);
          return;
        }
        const slice = this.groupAddresses.slice(startIndex - 1, startIndex - 1 + count);
        const buf = Buffer.concat(slice.map((ga) => KNXHelper.GetAddress(ga, "/")));
        mkResp(slice.length, buf);
        return;
      }

      // Object Type 11 special array properties
      if (this.ipObjIdx !== undefined && objIdx === this.ipObjIdx) {
        if (propId === KNXIPParameterPropertyId.PID_ADDITIONAL_INDIVIDUAL_ADDRESSES) {
          if (startIndex === 0) {
            const b = Buffer.alloc(2);
            b.writeUInt16BE(this.additionalIas.length, 0);
            mkResp(1, b);
            return;
          }
          const slice = this.additionalIas.slice(startIndex - 1, startIndex - 1 + count);
          const buf = Buffer.concat(slice.map((ia) => KNXHelper.GetAddress(ia, ".")));
          mkResp(slice.length, buf);
          return;
        }
        if (propId === KNXIPParameterPropertyId.PID_FRIENDLY_NAME) {
          const s = startIndex - 1;
          const slice = this.friendlyNameBuf.subarray(s, Math.min(30, s + count));
          mkResp(slice.length, slice);
          return;
        }
      }

      const val = this.props.get(`${objIdx}:${propId}`);
      if (val) {
        mkResp(1, val);
      } else {
        mkResp(0, Buffer.alloc(0));
      }
      return;
    }

    if (apci === APCIEnum.A_PropertyValue_Write_Protocol_Data_Unit) {
      const objIdx = data[0];
      const propId = data[1];
      const count = (data[2] >> 4) & 0x0f;
      const startIndex = ((data[2] & 0x0f) << 8) | data[3];
      const payload = Buffer.from(data.subarray(4));
      const mkResp = (c: number, respPayload: Buffer) => {
        const hdr = Buffer.alloc(4);
        hdr[0] = objIdx;
        hdr[1] = propId;
        hdr[2] = ((c & 0x0f) << 4) | ((startIndex >> 8) & 0x0f);
        hdr[3] = startIndex & 0xff;
        this.reply(bus, src, APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit, Buffer.concat([hdr, respPayload]));
      };

      if (propId === KNXPropertyId.PID_LOAD_STATE_CONTROL) {
        const ev = payload[0] as LoadEvent;
        if (ev === LoadEvent.UNLOAD) {
          this.loadStates.set(objIdx, LoadState.UNLOADED);
          this.onDownloadEvent?.(this.ia);
        } else if (ev === LoadEvent.START_LOADING) {
          this.loadStates.set(objIdx, LoadState.LOADING);
        } else if (ev === LoadEvent.ADDITIONAL_LOAD_CONTROLS) {
          if (payload[1] === 0x0b) {
            const size = payload.readUInt32BE(2);
            const allocMode = payload[6];
            const fill = payload[7];
            const base = this.relBases.get(objIdx) ?? 0x4000;
            // Honor Mode=1 fill vs Mode=0 preserve existing memory!
            if (allocMode === 1) {
              this.memory.fill(fill, base, base + size);
            }
          }
          this.loadStates.set(objIdx, LoadState.LOADING);
        } else if (ev === LoadEvent.LOAD_COMPLETED) {
          this.loadStates.set(objIdx, LoadState.LOADED);
          // Decode written GrAT memory into groupAddresses when Obj 1 finishes loading
          if (objIdx === 1) {
            const base = this.relBases.get(1) ?? 0x6000;
            const gaCount = this.memory.readUInt16BE(base);
            const gas: string[] = [];
            for (let i = 0; i < gaCount; i++) {
              gas.push(KNXHelper.GetAddress(this.memory.subarray(base + 2 + i * 2, base + 4 + i * 2), "/"));
            }
            this.groupAddresses = gas;
          }
        }
        mkResp(1, Buffer.from([this.loadStates.get(objIdx) ?? LoadState.LOADED]));
        return;
      }

      if (this.ipObjIdx !== undefined && objIdx === this.ipObjIdx) {
        if (propId === KNXIPParameterPropertyId.PID_ADDITIONAL_INDIVIDUAL_ADDRESSES) {
          if (startIndex === 0) {
            this.additionalIas = [];
            mkResp(1, Buffer.from([0x00, 0x00]));
            return;
          }
          for (let i = 0; i < count && i * 2 + 1 < payload.length; i++) {
            this.additionalIas[startIndex - 1 + i] = KNXHelper.GetAddress(payload.subarray(i * 2, i * 2 + 2), ".");
          }
          mkResp(count, payload);
          return;
        }
        if (propId === KNXIPParameterPropertyId.PID_FRIENDLY_NAME) {
          payload.copy(this.friendlyNameBuf, startIndex - 1, 0, Math.min(payload.length, 30 - (startIndex - 1)));
          mkResp(count, payload);
          return;
        }
      }

      this.props.set(`${objIdx}:${propId}`, payload);
      mkResp(count, payload);
      return;
    }

    // Extended Memory Write (0x01FB)
    if (apci === APCIEnum.A_MemoryExtended_Write_Protocol_Data_Unit) {
      const count = data[0];
      const addr24 = (data[1] << 16) | (data[2] << 8) | data[3];
      const bytes = data.subarray(4, 4 + count);
      bytes.copy(this.memory, addr24);
      this.writeMemoryCalls++;
      this.writtenMemoryBytes += bytes.length;
      const resp = Buffer.from([ManagementReturnCode.E_SUCCESS, count, data[1], data[2], data[3]]);
      this.reply(bus, src, APCIEnum.A_MemoryExtended_WriteResponse_Protocol_Data_Unit, resp);
      return;
    }

    // Extended Memory Read (0x01FD)
    if (apci === APCIEnum.A_MemoryExtended_Read_Protocol_Data_Unit) {
      const count = data[0];
      const addr24 = (data[1] << 16) | (data[2] << 8) | data[3];
      const slice = Buffer.from(this.memory.subarray(addr24, addr24 + count));
      const resp = Buffer.concat([
        Buffer.from([ManagementReturnCode.E_SUCCESS, count, data[1], data[2], data[3]]),
        slice,
      ]);
      this.reply(bus, src, APCIEnum.A_MemoryExtended_ReadResponse_Protocol_Data_Unit, resp);
      return;
    }

    // Standard Memory Write (0x0280 | count)
    if ((apci & 0x03c0) === APCIEnum.A_Memory_Write_Protocol_Data_Unit) {
      const count = apci & 0x3f;
      const addr = data.readUInt16BE(0);
      const bytes = data.subarray(2, 2 + count);
      bytes.copy(this.memory, addr);
      this.writeMemoryCalls++;
      this.writtenMemoryBytes += bytes.length;
      this.reply(
        bus,
        src,
        APCIEnum.A_Memory_Response_Protocol_Data_Unit | (count & 0x3f),
        Buffer.concat([data.subarray(0, 2), bytes]),
      );
      return;
    }

    // Standard Memory Read (0x0200 | count)
    if ((apci & 0x03c0) === APCIEnum.A_Memory_Read_Protocol_Data_Unit) {
      const count = apci & 0x3f;
      const addr = data.readUInt16BE(0);
      const slice = Buffer.from(this.memory.subarray(addr, addr + count));
      this.reply(
        bus,
        src,
        APCIEnum.A_Memory_Response_Protocol_Data_Unit | (count & 0x3f),
        Buffer.concat([data.subarray(0, 2), slice]),
      );
      return;
    }

    // Extended Property Read (Object Type 17 Security diagnostics)
    if (apci === APCIEnum.A_PropertyExtValue_Read_Protocol_Data_Unit) {
      const objType = data.readUInt16BE(0);
      const propId = ((data[3] & 0x0f) << 8) | data[4];
      const startIndex = ((data[6] & 0x0f) << 8) | data[7];
      const hdr = Buffer.from(data.subarray(0, 8));
      if (objType === KNXInterfaceObjectType.SECURITY_OBJECT) {
        if (propId === KNXSecurityPropertyId.PID_LOAD_STATE_CONTROL) {
          hdr[5] = 1;
          this.reply(
            bus,
            src,
            APCIEnum.A_PropertyExtValue_Response_Protocol_Data_Unit,
            Buffer.concat([hdr, Buffer.from([this.securityLoadState])]),
          );
          return;
        }
        if (propId === KNXSecurityPropertyId.PID_SEQUENCE_NUMBER_SENDING) {
          hdr[5] = 1;
          const seq6 = Buffer.alloc(6);
          seq6.writeUIntBE(Number(this.securitySeqNr), 0, 6);
          this.reply(bus, src, APCIEnum.A_PropertyExtValue_Response_Protocol_Data_Unit, Buffer.concat([hdr, seq6]));
          return;
        }
        if (
          propId === KNXSecurityPropertyId.PID_GRP_KEY_TABLE ||
          propId === KNXSecurityPropertyId.PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE
        ) {
          if (startIndex === 0) {
            hdr[5] = 1;
            this.reply(
              bus,
              src,
              APCIEnum.A_PropertyExtValue_Response_Protocol_Data_Unit,
              Buffer.concat([hdr, Buffer.from([0x00, 0x00])]),
            );
            return;
          }
        }
      }
      hdr[5] = 0;
      this.reply(bus, src, APCIEnum.A_PropertyExtValue_Response_Protocol_Data_Unit, hdr);
      return;
    }

    // Extended Function Property State Read (Object Type 17 PID_SECURITY_MODE / PID_SECURITY_FAILURES_LOG)
    if (apci === APCIEnum.A_FunctionPropertyExtState_Read_Protocol_Data_Unit) {
      const objType = data.readUInt16BE(0);
      const propId = ((data[3] & 0x0f) << 8) | data[4];
      const hdr = Buffer.from(data.subarray(0, 5));
      if (objType === KNXInterfaceObjectType.SECURITY_OBJECT) {
        if (propId === KNXSecurityPropertyId.PID_SECURITY_MODE) {
          this.reply(
            bus,
            src,
            APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit,
            Buffer.concat([hdr, Buffer.from([ManagementReturnCode.E_SUCCESS, 0x00, this.securityMode ? 0x01 : 0x00])]),
          );
          return;
        }
        if (propId === KNXSecurityPropertyId.PID_SECURITY_FAILURES_LOG) {
          const counters = Buffer.from([
            ManagementReturnCode.E_SUCCESS,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x02,
            0x00,
            0x01,
            0x00,
            0x00,
          ]);
          this.reply(
            bus,
            src,
            APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit,
            Buffer.concat([hdr, counters]),
          );
          return;
        }
      }
      this.reply(
        bus,
        src,
        APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit,
        Buffer.concat([hdr, Buffer.from([0xff])]),
      );
      return;
    }
  }
}

// ============================================================================
// Synthetic .knxprod Builders
// ============================================================================

function buildSystemBKnxProdWithBaggages(opts: {
  mfrId?: string;
  appNum?: string;
  appVer?: string;
  segSize?: number;
  dcaPlugin?: string;
  productName?: string;
}): Buffer {
  const mfr = opts.mfrId ?? "M-0099";
  const appNum = opts.appNum ?? "0010";
  const appVer = opts.appVer ?? "10";
  const appId = `${mfr}_A-${appNum}-${appVer}-0001`;
  const segSize = opts.segSize ?? 512;
  const baseData = Buffer.alloc(segSize, 0x11);
  baseData[0] = 0x2a; // ParamA default = 42
  baseData[100] = 0x05; // ParamB default = 5
  const baseMask = Buffer.alloc(segSize, 0xff);
  const prodName = opts.productName ?? "Test Dimmer";

  const extXml = opts.dcaPlugin ? `<Extension EtsDownloadPlugin="${opts.dcaPlugin}" />` : "";

  const appXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/21">
  <ManufacturerData>
    <Manufacturer RefId="${mfr}">
      <ApplicationPrograms>
        <ApplicationProgram Id="${appId}" ApplicationNumber="${parseInt(appNum, 16)}" ApplicationVersion="${parseInt(appVer, 16)}" ProgramType="ApplicationProgram" MaskVersion="MV-07B0" Name="${prodName} App" LoadProcedureStyle="MergedProcedure" PeiType="0" DefaultLanguage="en-US">
          <Static>
            <Code>
              <RelativeSegment Id="${appId}_RS-04-00000" Name="Parameters" Offset="0" Size="${segSize}" LoadStateMachine="4">
                <Data>${baseData.toString("base64")}</Data>
                <Mask>${baseMask.toString("base64")}</Mask>
              </RelativeSegment>
            </Code>
            <ParameterTypes>
              <ParameterType Id="${appId}_PT-Byte" Name="Byte">
                <TypeNumber SizeInBit="8" Type="unsignedInt" minInclusive="0" maxInclusive="255" />
              </ParameterType>
              <ParameterType Id="${appId}_PT-Pic" Name="DevicePic">
                <TypePicture RefId="${mfr}_BG--506963" />
              </ParameterType>
            </ParameterTypes>
            <Parameters>
              <Parameter Id="${appId}_P-1" Name="ParamA" ParameterType="${appId}_PT-Byte" Text="Parameter A" Value="42">
                <Memory CodeSegment="${appId}_RS-04-00000" Offset="0" BitOffset="0" />
              </Parameter>
              <Parameter Id="${appId}_P-2" Name="ParamB" ParameterType="${appId}_PT-Byte" Text="Parameter B" Value="5">
                <Memory CodeSegment="${appId}_RS-04-00000" Offset="100" BitOffset="0" />
              </Parameter>
              <Parameter Id="${appId}_P-3" Name="Logo" ParameterType="${appId}_PT-Pic" Text="Logo" Access="Read" Value="" />
            </Parameters>
            <ParameterRefs>
              <ParameterRef Id="${appId}_P-1_R-1" RefId="${appId}_P-1" />
              <ParameterRef Id="${appId}_P-2_R-2" RefId="${appId}_P-2" />
              <ParameterRef Id="${appId}_P-3_R-3" RefId="${appId}_P-3" />
            </ParameterRefs>
            <ComObjectTable>
              <ComObject Id="${appId}_O-1" Name="Switch" Text="Switch" Number="1" FunctionText="On/Off" ObjectSize="1 Bit" ReadFlag="Enabled" WriteFlag="Enabled" CommunicationFlag="Enabled" TransmitFlag="Enabled" UpdateFlag="Disabled" DatapointType="DPST-1-1" />
              <ComObject Id="${appId}_O-2" Name="Temp" Text="Temperature" Number="2" FunctionText="Temp" ObjectSize="2 Bytes" ReadFlag="Enabled" WriteFlag="Disabled" CommunicationFlag="Enabled" TransmitFlag="Enabled" UpdateFlag="Disabled" DatapointType="DPST-9-1" />
            </ComObjectTable>
            <ComObjectRefs>
              <ComObjectRef Id="${appId}_O-1_R-1" RefId="${appId}_O-1" />
              <ComObjectRef Id="${appId}_O-2_R-2" RefId="${appId}_O-2" />
            </ComObjectRefs>
            <AddressTable MaxEntries="255" />
            <AssociationTable MaxEntries="255" />
            <LoadProcedures>
              <LoadProcedure MergeId="2">
                <LdCtrlRelSegment LsmIdx="4" Size="${segSize}" Mode="1" Fill="0" AppliesTo="full" />
                <LdCtrlRelSegment LsmIdx="4" Size="${segSize}" Mode="0" Fill="0" AppliesTo="par" />
              </LoadProcedure>
              <LoadProcedure MergeId="4">
                <LdCtrlWriteRelMem ObjIdx="4" Offset="0" Size="${segSize}" Verify="true" />
              </LoadProcedure>
            </LoadProcedures>
            ${extXml}
            <Options SupportsExtendedMemoryServices="true" SupportsExtendedPropertyServices="true" />
          </Static>
          <Dynamic>
            <ChannelIndependentBlock>
              <ParameterBlock Id="${appId}_PB-1" Name="General" Text="General">
                <ParameterRefRef RefId="${appId}_P-1_R-1" />
                <ParameterRefRef RefId="${appId}_P-2_R-2" />
                <ParameterRefRef RefId="${appId}_P-3_R-3" />
              </ParameterBlock>
              <ComObjectRefRef RefId="${appId}_O-1_R-1" />
              <ComObjectRefRef RefId="${appId}_O-2_R-2" />
            </ChannelIndependentBlock>
          </Dynamic>
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

  const hwXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/21">
  <ManufacturerData>
    <Manufacturer RefId="${mfr}">
      <Hardware>
        <Hardware Id="${mfr}_H-${appNum}" Name="${prodName}" SerialNumber="SN-${appNum}" VersionNumber="1" HasIndividualAddress="true" HasApplicationProgram="true">
          <Products>
            <Product Id="${mfr}_H-${appNum}_P-1" Text="${prodName}" OrderNumber="ORD-${appNum}" IsRailMounted="true" DefaultLanguage="en-US" />
          </Products>
          <Hardware2Programs>
            <Hardware2Program Id="${mfr}_H-${appNum}_HP-${appNum}" MediumTypes="MT-0">
              <ApplicationProgramRef RefId="${appId}" />
            </Hardware2Program>
          </Hardware2Programs>
        </Hardware>
      </Hardware>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

  const catXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/21">
  <ManufacturerData>
    <Manufacturer RefId="${mfr}">
      <Catalog>
        <CatalogSection Id="${mfr}_CS-1" Name="Devices" Number="1">
          <CatalogItem Id="${mfr}_CI-${appNum}" Name="${prodName}" Number="1" ProductRefId="${mfr}_H-${appNum}_P-1" Hardware2ProgramRefId="${mfr}_H-${appNum}_HP-${appNum}" />
        </CatalogSection>
      </Catalog>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

  const baggagesXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/21">
  <ManufacturerData>
    <Manufacturer RefId="${mfr}">
      <Baggages>
        <Baggage TargetPath="Images" Name="logo.png" Id="${mfr}_BG--506963">
          <FileInfo TimeInfo="2025-01-01T00:00:00Z" />
        </Baggage>
        <Baggage TargetPath="Docs" Name="manual.pdf" Id="${mfr}_BG--4D616E">
          <FileInfo TimeInfo="2025-01-01T00:00:00Z" />
        </Baggage>
      </Baggages>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

  const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
  const fakePdf = Buffer.from("%PDF-1.7\nMock Manual\n%%EOF", "ascii");

  const zip = new ZipWriter();
  zip.addText(`${mfr}/${appId}.xml`, appXml);
  zip.addText(`${mfr}/Hardware.xml`, hwXml);
  zip.addText(`${mfr}/Catalog.xml`, catXml);
  zip.addText(`${mfr}/Baggages.xml`, baggagesXml);
  zip.addBuffer(`${mfr}/Baggages/Images/logo.png`, fakePng);
  zip.addBuffer(`${mfr}/Baggages/Docs/manual.pdf`, fakePdf);
  return zip.toBuffer();
}

function buildCouplerKnxProd(opts: {
  mfrId: string;
  appNum: string;
  maskVersion: "MV-091A" | "MV-2920";
  name: string;
}): Buffer {
  const mfr = opts.mfrId;
  const appId = `${mfr}_A-${opts.appNum}-10-0001`;
  const appXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/21">
  <ManufacturerData>
    <Manufacturer RefId="${mfr}">
      <ApplicationPrograms>
        <ApplicationProgram Id="${appId}" ApplicationNumber="${parseInt(opts.appNum, 16)}" ApplicationVersion="16" ProgramType="ApplicationProgram" MaskVersion="${opts.maskVersion}" Name="${opts.name}" LoadProcedureStyle="MergedProcedure" PeiType="0" DefaultLanguage="en-US">
          <Static>
            <Code />
            <ParameterTypes />
            <Parameters />
            <ParameterRefs />
            <ComObjectTable />
            <ComObjectRefs />
            <LoadProcedures />
            <Options SupportsExtendedMemoryServices="${opts.maskVersion === "MV-2920" ? "true" : "false"}" />
          </Static>
          <Dynamic />
        </ApplicationProgram>
      </ApplicationPrograms>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

  const hwXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/21">
  <ManufacturerData>
    <Manufacturer RefId="${mfr}">
      <Hardware>
        <Hardware Id="${mfr}_H-${opts.appNum}" Name="${opts.name}" HasIndividualAddress="true" HasApplicationProgram="true" IsCoupler="true">
          <Products>
            <Product Id="${mfr}_H-${opts.appNum}_P-1" Text="${opts.name}" OrderNumber="CPL-${opts.appNum}" DefaultLanguage="en-US" />
          </Products>
          <Hardware2Programs>
            <Hardware2Program Id="${mfr}_H-${opts.appNum}_HP-1" MediumTypes="MT-0">
              <ApplicationProgramRef RefId="${appId}" />
            </Hardware2Program>
          </Hardware2Programs>
        </Hardware>
      </Hardware>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

  const zip = new ZipWriter();
  zip.addText(`${mfr}/${appId}.xml`, appXml);
  zip.addText(`${mfr}/Hardware.xml`, hwXml);
  return zip.toBuffer();
}

// ============================================================================
// Tests
// ============================================================================

describe("Baggages, Delta Downloads, Object Type 11, Diagnostics, Commissioning Orchestrator & Typed Runtime", () => {
  test("1. Baggages extraction works across KnxProdParser, DeviceConfigSession (TypePicture), and KnxProject", async () => {
    const knxprodBuf = buildSystemBKnxProdWithBaggages({});
    const parsed = await KnxProdParser.parseBuffer(knxprodBuf);

    expect(parsed.baggages).toHaveLength(2);
    expect(parsed.baggages?.[0].id).toBe("M-0099_BG--506963");
    expect(parsed.baggages?.[0].mimeType).toBe("image/png");
    expect(parsed.baggages?.[1].mimeType).toBe("application/pdf");

    const extractedPng = parsed.readBaggage?.("M-0099_BG--506963");
    expect(extractedPng).toBeDefined();
    expect(extractedPng!.mimeType).toBe("image/png");
    expect(extractedPng!.size).toBe(11);
    expect(extractedPng!.buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);

    // DeviceConfigSession exposes baggageRefId on TypePicture parameters + readBaggage()
    const session = new DeviceConfigSession(parsed);
    const ui = session.getUiState();
    const picField = ui.parameters.find((p) => p.name === "Logo");
    expect(picField?.widget).toBe("picture");
    expect(picField?.baggageRefId).toBe("M-0099_BG--506963");
    expect(session.listBaggages()).toHaveLength(2);
    expect(session.readBaggage(picField!.baggageRefId!)?.filename).toBe("logo.png");

    // KnxProject baggages API (including by refId, by filename, getBaggage, and openDeviceSession)
    const proj = KnxProject.create({ name: "Baggage Project" });
    proj.importKnxProd(knxprodBuf);
    const dev = proj.addDevice({ area: 1, line: 1 }, { address: 1, productRefId: "M-0099_H-0010_P-1" });

    const projBaggages = proj.listBaggages();
    expect(projBaggages).toHaveLength(2);
    expect(projBaggages.find((b) => b.name === "logo.png")?.mimeType).toBe("image/png");

    // Backwards-compatible readBaggage returns Buffer (by refId or zipEntryPath)
    expect(proj.readBaggage("M-0099_BG--506963").length).toBe(11);
    expect(proj.readBaggage("M-0099/Baggages/Docs/manual.pdf").toString("ascii")).toContain("Mock Manual");

    // Rich getBaggage returns full metadata + Buffer
    const metaPdf = proj.getBaggage("M-0099_BG--4D616E");
    expect(metaPdf?.mimeType).toBe("application/pdf");
    expect(metaPdf?.size).toBeGreaterThan(10);

    // Session opened from KnxProject inherits readBaggage()
    const projSession = await proj.openDeviceSession(dev.id);
    expect(projSession.readBaggage("M-0099_BG--506963")?.size).toBe(11);
  });

  test("2. Differential delta download writes only changed bytes while keeping full device memory identical", async () => {
    const knxprodBuf = buildSystemBKnxProdWithBaggages({ segSize: 512 });
    const parsed = await KnxProdParser.parseBuffer(knxprodBuf);

    const bus = new MultiDeviceMockBus("1.1.250");
    const dev = new MockBusDevice({
      ia: "1.1.10",
      maskVersion: 0x07b0,
      manufacturerId: 0x0099,
    });
    bus.registerDevice(dev);
    const programmer = new KNXDeviceProgrammer(new KNXManagement(bus, { minFrameDelayMs: 0 }));

    // Step 1: Full initial download
    const fullRes = await programmer.download("1.1.10", parsed, {
      parameters: { ParamA: 42, ParamB: 5 },
      groupLinks: { 1: "1/0/1" },
    });
    expect(fullRes.bytesWritten).toBeGreaterThanOrEqual(512);

    const encodedSnapshot = encodeKnxTsLoadedImage(fullRes.image);
    const decodedSnapshot = decodeKnxTsLoadedImage(encodedSnapshot);
    expect(decodedSnapshot).not.toBeNull();
    expect(decodedSnapshot!.segments.get(4)?.length).toBe(512);
    // Native opaque ETS blob returns undefined gracefully
    expect(decodeKnxTsLoadedImage(Buffer.from("OPAQUE_ETS_BLOB").toString("base64"))).toBeUndefined();

    // Step 2: Change ONE parameter (ParamB: 5 -> 99) and run differential partial download
    const beforeCalls = dev.writeMemoryCalls;
    const deltaRes = await programmer.download(
      "1.1.10",
      parsed,
      { parameters: { ParamA: 42, ParamB: 99 }, groupLinks: { 1: "1/0/1" } },
      {
        mode: "par",
        previousSegments: decodedSnapshot!.segments,
        previousAbsoluteSegments: decodedSnapshot!.absoluteSegments,
      },
    );

    // Only 1 byte changed -> delta write should send 1 byte in 1 memory write call!
    expect(deltaRes.bytesWritten).toBe(1);
    expect(dev.writeMemoryCalls - beforeCalls).toBe(1);

    // Verify full 512-byte segment in mock device memory matches the newly compiled full segment byte-for-byte!
    const baseAddr = dev.relBases.get(4)!;
    const deviceSeg = dev.memory.subarray(baseAddr, baseAddr + 512);
    expect(deviceSeg.equals(deltaRes.image.segments.get(4)!.image)).toBe(true);
    expect(deviceSeg[0]).toBe(42);
    expect(deviceSeg[100]).toBe(99);
  });

  test("3. Object Type 11 KNXnet/IP Parameter Object read and configure works with auto-discovery", async () => {
    const bus = new MultiDeviceMockBus("1.1.250");
    const ipRouter = new MockBusDevice({
      ia: "1.1.0",
      maskVersion: 0x2920,
      manufacturerId: 0x0099,
      ipObjIdx: 5,
      ipProps: {
        ipAddress: "192.168.1.20",
        subnetMask: "255.255.255.0",
        defaultGateway: "192.168.1.1",
        assignmentMethod: 0x0c, // DHCP + AutoIP
        macHex: "001122334455",
        routingMulticast: "224.0.23.12",
        ttl: 16,
        friendlyName: "Factory Router",
        additionalIas: ["1.1.240"],
      },
    });
    bus.registerDevice(ipRouter);
    const programmer = new KNXDeviceProgrammer(new KNXManagement(bus, { minFrameDelayMs: 0 }));

    const initial = await programmer.readIpInterfaceConfig("1.1.0");
    expect(initial.objectIndex).toBe(5);
    expect(initial.ipAddress).toBe("192.168.1.20");
    expect(initial.macAddress).toBe("00:11:22:33:44:55");
    expect(initial.ipAssignmentMethod?.dhcp).toBe(true);
    expect(initial.friendlyName).toBe("Factory Router");
    expect(initial.additionalIndividualAddresses).toEqual(["1.1.240"]);

    const writeRes = await programmer.configureIpInterface(
      "1.1.0",
      {
        ipAssignmentMethod: "Fixed",
        ipAddress: "10.0.0.50",
        subnetMask: "255.255.0.0",
        defaultGateway: "10.0.0.1",
        routingMulticastAddress: "224.0.23.15",
        ttl: 32,
        friendlyName: "Building A Router",
        additionalIndividualAddresses: ["1.1.241", "1.1.242", "1.1.243"],
      },
      { readBack: true },
    );

    expect(writeRes.objectIndex).toBe(5);
    expect(writeRes.restarted).toBe(true);
    expect(ipRouter.restartedCount).toBe(1);
    expect(writeRes.configAfterWrite?.ipAddress).toBe("10.0.0.50");
    expect(writeRes.configAfterWrite?.subnetMask).toBe("255.255.0.0");
    expect(writeRes.configAfterWrite?.defaultGateway).toBe("10.0.0.1");
    expect(writeRes.configAfterWrite?.routingMulticastAddress).toBe("224.0.23.15");
    expect(writeRes.configAfterWrite?.ttl).toBe(32);
    expect(writeRes.configAfterWrite?.ipAssignmentMethod?.manual).toBe(true);
    expect(writeRes.configAfterWrite?.friendlyName).toBe("Building A Router");
    expect(writeRes.configAfterWrite?.additionalIndividualAddresses).toEqual(["1.1.241", "1.1.242", "1.1.243"]);
  });

  test("4. readDeviceDiagnostics & project.compareDeviceWithBus detect in-sync and out-of-sync states", async () => {
    const knxprodBuf = buildSystemBKnxProdWithBaggages({ mfrId: "M-0099", appNum: "0010", appVer: "10" });
    const proj = KnxProject.create({ name: "Diag Project" });
    proj.importKnxProd(knxprodBuf);
    proj.addGroupAddress({ address: "1/0/1", name: "Light", datapointType: "DPST-1-1", autoCreateRanges: true });
    proj.addGroupAddress({ address: "1/0/2", name: "Temp", datapointType: "DPST-9-1", autoCreateRanges: true });

    const devSummary = proj.addDevice(
      { area: 1, line: 1 },
      {
        address: 10,
        name: "Actuator 1",
        productRefId: "M-0099_H-0010_P-1",
        serialNumber: "009911223344",
        ipConfig: {
          assign: "Fixed",
          ipAddress: "192.168.1.50",
          subnetMask: "255.255.255.0",
          defaultGateway: "192.168.1.1",
        },
      },
    );
    proj.linkComObjectToGroupAddress(devSummary.id, "O-1_R-1", "1/0/1");
    proj.linkComObjectToGroupAddress(devSummary.id, "O-2_R-2", "1/0/2");

    const bus = new MultiDeviceMockBus("1.1.250");
    const mockDev = new MockBusDevice({
      ia: "1.1.10",
      maskVersion: 0x07b0,
      manufacturerId: 0x0099,
      serialNumberHex: "009911223344",
      hardwareTypeHex: "000102030405",
      orderInfo: "ORD-0010",
      firmwareRevision: 3,
      programVersionHex: "0099001010", // mfr=0x0099, appNum=0x0010, appVer=0x10
      groupAddresses: ["1/0/1", "1/0/2"],
      ipObjIdx: 5,
      ipProps: {
        ipAddress: "192.168.1.50",
        subnetMask: "255.255.255.0",
        defaultGateway: "192.168.1.1",
        assignmentMethod: 0x01,
      },
      hasSecurityObj: true,
      securityMode: true,
    });
    bus.registerDevice(mockDev);
    const programmer = new KNXDeviceProgrammer(new KNXManagement(bus, { minFrameDelayMs: 0 }));

    // Diagnostics report is 100% JSON-serializable
    const diag = await programmer.readDeviceDiagnostics("1.1.10");
    const roundTripped = JSON.parse(JSON.stringify(diag));
    expect(roundTripped.maskVersionHex).toBe("0x07B0");
    expect(roundTripped.serialNumber).toBe("009911223344");
    expect(roundTripped.orderInfoText).toBe("ORD-0010");
    expect(roundTripped.applicationIdInfo).toEqual({
      manufacturerId: 0x0099,
      applicationNumber: 0x0010,
      applicationVersion: 0x10,
    });
    expect(roundTripped.groupAddressTable.groupAddresses).toEqual(["1/0/1", "1/0/2"]);
    expect(roundTripped.security.securityMode).toBe(true);
    expect(roundTripped.security.failuresLog).toEqual({ seqNrErrors: 2, cryptoErrors: 1, accessRoleErrors: 0 });

    // Compare in-sync
    const cmpOk = await proj.compareDeviceWithBus("1.1.10", programmer);
    expect(cmpOk.inSync).toBe(true);
    expect(cmpOk.differences).toHaveLength(0);
    expect(cmpOk.groupAddressDiff?.matchedCount).toBe(2);

    // Mutate bus state -> out of sync!
    mockDev.groupAddresses = ["1/0/1", "1/0/99"];
    mockDev.props.set(`0:${KNXPropertyId.PID_SERIAL_NUMBER}`, Buffer.from("AABBCCDDEEFF", "hex"));
    mockDev.loadStates.set(4, LoadState.UNLOADED);

    const cmpDiff = await proj.compareDeviceWithBus("1.1.10", programmer);
    expect(cmpDiff.inSync).toBe(false);
    expect(cmpDiff.differences.map((d) => d.field)).toEqual(
      expect.arrayContaining(["serialNumber", "loadState", "groupAddresses"]),
    );
    expect(cmpDiff.groupAddressDiff?.missingOnDevice).toEqual(["1/0/2"]);
    expect(cmpDiff.groupAddressDiff?.extraOnDevice).toEqual(["1/0/99"]);
  });

  test("5. Commissioning Orchestrator: authorizedSenders, programDevice (with delta writeback), and topological programAll", async () => {
    const knxprodSysB = buildSystemBKnxProdWithBaggages({
      mfrId: "M-0099",
      appNum: "0010",
      appVer: "10",
      segSize: 256,
    });
    const knxprodDca = buildSystemBKnxProdWithBaggages({
      mfrId: "M-0098",
      appNum: "0020",
      appVer: "10",
      dcaPlugin: "Vendor.ProprietaryDCA",
      productName: "DCA Panel",
    });
    const knxprodAreaCpl = buildCouplerKnxProd({
      mfrId: "M-0097",
      appNum: "0001",
      maskVersion: "MV-091A",
      name: "Area Coupler",
    });
    const knxprodLineCpl = buildCouplerKnxProd({
      mfrId: "M-0097",
      appNum: "0002",
      maskVersion: "MV-2920",
      name: "Line Coupler",
    });

    const proj = KnxProject.create({ name: "Full Building" });
    proj.importKnxProd(knxprodSysB);
    proj.importKnxProd(knxprodDca);
    proj.importKnxProd(knxprodAreaCpl);
    proj.importKnxProd(knxprodLineCpl);

    const ga1 = proj.addGroupAddress({
      address: "1/0/1",
      name: "Living Switch",
      datapointType: "DPST-1-1",
      autoCreateRanges: true,
    });
    const ga2 = proj.addGroupAddress({
      address: "1/0/2",
      name: "Living Temp",
      datapointType: "DPST-9-1",
      autoCreateRanges: true,
    });

    // Topology: Area Coupler 1.0.0, Line Coupler 1.1.0, End Devices 1.1.1, 1.1.2, DCA 1.1.9, IP Gateway 1.1.200 (+1.1.201)
    proj.addDevice({ area: 1, line: 0 }, { address: 0, name: "Area Coupler 1.0.0", productRefId: "M-0097_H-0001_P-1" });
    proj.addDevice({ area: 1, line: 1 }, { address: 0, name: "Line Coupler 1.1.0", productRefId: "M-0097_H-0002_P-1" });
    const dev1 = proj.addDevice(
      { area: 1, line: 1 },
      { address: 1, name: "Dimmer 1", productRefId: "M-0099_H-0010_P-1" },
    );
    const dev2 = proj.addDevice(
      { area: 1, line: 1 },
      { address: 2, name: "Sensor 2", productRefId: "M-0099_H-0010_P-1" },
    );
    proj.addDevice({ area: 1, line: 1 }, { address: 9, name: "DCA Touch", productRefId: "M-0098_H-0020_P-1" });
    const gw = proj.addDevice({ area: 1, line: 1 }, { address: 200, name: "IP Tunneling GW" });
    proj.addDeviceAdditionalAddress(gw.id, { address: 201, name: "Tunnel Slot 1" });
    proj.setDeviceBusInterface(gw.id, { refId: "BI-1", name: "Tunneling", connectors: [ga2.id] });

    proj.linkComObjectToGroupAddress(dev1.id, "O-1_R-1", ga1.id);
    proj.linkComObjectToGroupAddress(dev1.id, "O-2_R-2", ga2.id);
    proj.linkComObjectToGroupAddress(dev2.id, "O-1_R-1", ga1.id);

    // 5a. Auto-compute authorizedSenders for 1.1.1 -> includes peer 1.1.2 + gateway 1.1.200/1.1.201 + extra 1.1.250
    const senders = proj.computeDeviceAuthorizedSenders("1.1.1", { extraSenders: ["1.1.250"] });
    expect(senders.authorizedSenders).toEqual(["1.1.2", "1.1.200", "1.1.201", "1.1.250"]);
    expect(senders.sendersByGroupAddress["1/0/1"]).toEqual(["1.1.2"]);
    expect(senders.sendersByGroupAddress["1/0/2"]).toEqual(["1.1.200", "1.1.201"]);

    // 5b. Set up mock bus devices and track download order
    const bus = new MultiDeviceMockBus("1.1.250");
    const downloadOrder: string[] = [];
    const recordOrder = (ia: string) => {
      if (!downloadOrder.includes(ia)) downloadOrder.push(ia);
    };

    bus.registerDevice(
      new MockBusDevice({
        ia: "1.0.0",
        maskVersion: 0x091a,
        manufacturerId: 0x0097,
        ioList: [0, 6],
        onDownloadEvent: recordOrder,
      }),
    );
    bus.registerDevice(
      new MockBusDevice({
        ia: "1.1.0",
        maskVersion: 0x2920,
        manufacturerId: 0x0097,
        ioList: [0, 6],
        onDownloadEvent: recordOrder,
      }),
    );
    const mockDev1 = new MockBusDevice({
      ia: "1.1.1",
      maskVersion: 0x07b0,
      manufacturerId: 0x0099,
      serialNumberHex: "009900000001",
      onDownloadEvent: recordOrder,
    });
    const mockDev2 = new MockBusDevice({
      ia: "1.1.2",
      maskVersion: 0x07b0,
      manufacturerId: 0x0099,
      serialNumberHex: "009900000002",
      onDownloadEvent: recordOrder,
    });
    bus.registerDevice(mockDev1);
    bus.registerDevice(mockDev2);

    const programmer = new KNXDeviceProgrammer(new KNXManagement(bus, { minFrameDelayMs: 0 }));

    // 5c. programAll runs in strict topological order: 1.0.0 -> 1.1.0 -> 1.1.1 -> 1.1.2, skips DCA 1.1.9 & passive 1.1.200
    const batchRes = await proj.programAll(programmer, { skipDelay: true });
    expect(batchRes.failedCount).toBe(0);
    expect(batchRes.programmedCount).toBe(4);
    expect(batchRes.skippedCount).toBe(2);
    expect(downloadOrder).toEqual(["1.0.0", "1.1.0", "1.1.1", "1.1.2"]);

    const dcaOutcome = batchRes.outcomes.find((o) => o.individualAddress === "1.1.9");
    expect(dcaOutcome?.status).toBe("skipped");
    expect(dcaOutcome?.reason).toContain("DCA");

    // Verify project DeviceInstance state was updated after download
    const updatedDev1 = proj.getDevice(dev1.id)!;
    expect(updatedDev1.applicationProgramLoaded).toBe(true);
    expect(updatedDev1.parametersLoaded).toBe(true);
    expect(updatedDev1.communicationPartLoaded).toBe(true);
    expect(updatedDev1.serialNumberHex).toBe("009900000001");
    expect(updatedDev1.loadedImage).toBeDefined();
    expect(updatedDev1.lastDownload).toBeDefined();

    // 5d. Running programAll with onlyModified: true skips all already-loaded devices
    const secondBatch = await proj.programAll(programmer, { onlyModified: true });
    expect(secondBatch.programmedCount).toBe(0);
    expect(secondBatch.skippedCount).toBe(6);

    // 5e. Modify 1 parameter on 1.1.1 -> programDevice(mode: "par") uses differential LoadedImage automatically!
    proj.setDeviceParameter(dev1.id, "M-0099_A-0010-10-0001_P-2_R-2", 77);
    const parRes = await proj.programDevice(dev1.id, programmer, { mode: "par" });
    expect(parRes.usedDifferentialSnapshot).toBe(true);
    expect(parRes.download.bytesWritten).toBe(1);
    expect(proj.getDevice(dev1.id)!.parametersLoaded).toBe(true);
  });

  test("6. KnxProjectRuntime auto-decodes DPTs, enriches metadata, writes/reads typed values, and produces JSON snapshots", async () => {
    expect(normalizeEtsDatapointType("DPST-1-1")).toBe("1.001");
    expect(normalizeEtsDatapointType("DPST-5-1")).toBe("5.001");
    expect(normalizeEtsDatapointType("DPST-9-1")).toBe("9.001");
    expect(normalizeEtsDatapointType("DPST-232-600")).toBe("232.600");
    expect(normalizeEtsDatapointType("DPT-9")).toBe("9");
    expect(normalizeEtsDatapointType("1.001")).toBe("1.001");

    const proj = KnxProject.create({ name: "Smart Home" });
    const gaLight = proj.addGroupAddress({
      address: "1/0/1",
      name: "Living Room Light",
      datapointType: "DPST-1-1",
      autoCreateRanges: true,
    });
    const gaTemp = proj.addGroupAddress({
      address: "1/0/2",
      name: "Living Room Temp",
      datapointType: "DPST-9-1",
      autoCreateRanges: true,
    });
    const gaDim = proj.addGroupAddress({
      address: "1/0/3",
      name: "Living Room Dimmer",
      datapointType: "DPST-5-1",
      autoCreateRanges: true,
    });

    const bldg = proj.addSpace({ type: "Building", name: "HQ" });
    const room = proj.addSpace({ type: "Room", name: "Living Room", parentSpaceId: bldg.id });
    proj.addFunction(room.id, {
      name: "Lighting & Climate",
      groupAddresses: [gaLight.id, gaTemp.id, gaDim.id],
    });
    const sensor = proj.addDevice({ area: 1, line: 1 }, { address: 5, name: "Wall Sensor", spaceId: room.id });
    proj.linkComObjectToGroupAddress(sensor.id, "O-1_R-1", gaLight.id);

    const bus = new MultiDeviceMockBus("1.1.250");
    bus.setGroupHandler((dst, apci) => {
      if (apci === APCIEnum.A_GroupValue_Read_Protocol_Data_Unit && dst === "1/0/2") {
        bus.injectGroupTelegram("1.1.5", "1/0/2", APCIEnum.A_GroupValue_Response_Protocol_Data_Unit, "9.001", 23.5);
      }
    });

    const runtime = proj.createRuntime(bus, { maxHistoryPerGa: 4 });
    const allEvents: KnxRuntimeTelegramEvent[] = [];
    const lightEvents: KnxRuntimeTelegramEvent[] = [];
    runtime.on("telegram", (ev) => allEvents.push(ev));
    runtime.on("ga:1/0/1", (ev) => lightEvents.push(ev));

    // Incoming GroupValue_Write telegrams
    bus.injectGroupTelegram("1.1.5", "1/0/1", APCIEnum.A_GroupValue_Write_Protocol_Data_Unit, "1.001", true);
    bus.injectGroupTelegram("1.1.5", "1/0/3", APCIEnum.A_GroupValue_Write_Protocol_Data_Unit, "5.001", 50);

    expect(allEvents).toHaveLength(2);
    expect(lightEvents).toHaveLength(1);
    expect(lightEvents[0].value).toBe(true);
    expect(lightEvents[0].dpt).toBe("1.001");
    expect(lightEvents[0].meta?.name).toBe("Living Room Light");
    expect(lightEvents[0].meta?.spacePath).toBe("HQ / Living Room");
    expect(lightEvents[0].meta?.functionName).toBe("Lighting & Climate");
    expect(lightEvents[0].sourceDevice?.name).toBe("Wall Sensor");
    expect(lightEvents[0].sourceDevice?.individualAddress).toBe("1.1.5");

    const dimVal = runtime.getValue("1/0/3")?.value as { value: number; unit: string };
    expect(Math.round(dimVal.value)).toBe(50);
    expect(dimVal.unit).toBe("%");

    // Typed write by GA name!
    const writeInfo = await runtime.write("Living Room Light", true);
    expect(writeInfo).toEqual({ groupAddress: "1/0/1", dpt: "1.001" });
    expect(bus.sentGroupFrames[0].dst).toBe("1/0/1");
    expect(bus.sentGroupFrames[0].data.equals(Buffer.from([0x01]))).toBe(true);

    // Typed read awaiting decoded GroupValue_Response
    const readEv = await runtime.read("Living Room Temp", { timeoutMs: 1000 });
    expect(readEv).toBeDefined();
    expect(readEv!.kind).toBe("response");
    expect(Number(readEv!.value)).toBeCloseTo(23.5, 1);
    expect(runtime.getHistory("1/0/2")).toHaveLength(1);

    // JSON-serializable snapshot
    const snapshot = JSON.parse(JSON.stringify(runtime.getSnapshot()));
    expect(snapshot.projectName).toBe("Smart Home");
    expect(snapshot.totalGroupAddresses).toBe(3);
    expect(snapshot.populatedGroupAddresses).toBe(3);
    expect(snapshot.values["1/0/1"].value).toBe(true);
    expect(snapshot.values["1/0/2"].value).toBeCloseTo(23.5, 1);

    // Clean destroy detaches bus listener
    runtime.destroy();
    bus.injectGroupTelegram("1.1.5", "1/0/1", APCIEnum.A_GroupValue_Write_Protocol_Data_Unit, "1.001", false);
    expect(allEvents).toHaveLength(3); // unchanged after destroy
  });

  test("7. Real .knxproj baggage extraction smoke test (when sample files are available)", () => {
    const samplePath = path.resolve(__dirname, "../Ignore/knxproj/Alcaldia de Chia V2.knxproj");
    if (!fs.existsSync(samplePath)) return;
    const proj = KnxProject.fromFile(samplePath);
    const baggages = proj.listBaggages();
    expect(baggages.length).toBeGreaterThan(0);
    const first = proj.getBaggage(baggages[0].id);
    expect(first).toBeDefined();
    expect(first!.size).toBeGreaterThan(0);
    expect(first!.mimeType).toBeTruthy();
  });
});
