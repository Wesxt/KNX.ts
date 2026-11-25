import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { KNXService } from "../src/connection/KNXService";
import { CEMI, CEMIInstance } from "../src/core/CEMI";
import { ControlField } from "../src/core/ControlField";
import { ExtendedControlField } from "../src/core/ControlFieldExtended";
import { APCIEnum } from "../src/core/enum/APCIEnum";
import { AddressType } from "../src/core/enum/EnumControlFieldExtended";
import { APDU } from "../src/core/layers/data/APDU";
import { TPDU } from "../src/core/layers/data/TPDU";
import { APCI } from "../src/core/layers/interfaces/APCI";
import { TPCI, TPCIType } from "../src/core/layers/interfaces/TPCI";
import {
  buildConnectedLDataReq,
  decodeExtObjectHeader,
  encodeExtObjectHeader,
  encodeMemoryExtendedWriteData,
  ManagementReturnCode,
  RestartEraseCode,
} from "../src/management/apduBuilders";
import {
  KNXInterfaceObjectType,
  KNXManagement,
  KNXPropertyId,
  KNXSecurityPropertyId,
  LoadEvent,
  LoadState,
} from "../src/management/KNXManagement";
import {
  compileAssociationTable,
  compileGroupAddressTable,
  compileGroupObjectTable,
  crc16Ccitt,
  DeviceConfigSession,
  DynamicEvaluator,
  encodeDpt9Word,
  KNXDeviceProgrammer,
  KnxProdParser,
  LoadProcedureEngine,
  matchesWhenTest,
  objectSizeToValueTypeCode,
  patchBitsIntoBuffer,
  ResolvedComObject,
  SystemBCompiler,
  ZipReader,
} from "../src/programming";
import { KnxDataSecure } from "../src/security/KnxDataSecure";
import {
  APCI_DATA_SECURE,
  buildSASyncResPdu,
  decodeScf,
  decodeSeqNr48,
  decryptSASyncReqPdu,
  encodeSeqNr48,
  SecureAlService,
} from "../src/security/KnxDataSecureCcm";
import { KnxKeyring } from "../src/security/KnxKeyring";
import { KNXHelper } from "../src/utils/KNXHelper";

// ============================================================================
// Mock KNX Bus & Simulated System B (0x07B0) Hardware Device
// ============================================================================

class MockKNXBusService extends KNXService {
  public sentFrames: CEMIInstance[] = [];
  private responder: ((cemi: CEMIInstance, bus: MockKNXBusService) => void) | null = null;

  constructor(individualAddress: string = "1.1.250", dataSecure?: KnxDataSecure) {
    super({ individualAddress, dataSecure });
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
    const prepared = this.prepareOutgoingCemi(data);
    const cemi = Buffer.isBuffer(prepared) ? CEMI.fromBuffer(prepared) : prepared;
    this.sentFrames.push(cemi);
    if (this.responder) {
      queueMicrotask(() => this.responder!(cemi, this));
    }
  }

  public injectIndication(cemi: CEMIInstance): void {
    const processed = this.processIncomingCemi(cemi);
    if (!processed) return;
    this.emit("indication", processed);
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

interface MockSystemBDeviceConfig {
  individualAddress: string;
  maskVersion?: number;
  manufacturerId: number;
  hardwareType: Buffer;
  serialNumber?: Buffer;
  orderInfo?: Buffer;
  maxApduLength?: number;
  groatFormat?: 0 | 1;
  hasPeiObject?: boolean;
  dataSecure?: {
    toolKey: Buffer;
    requireSecure?: boolean;
    securityMode?: boolean;
    initialSeqNr?: bigint;
  };
}

class MockSystemBDevice {
  public readonly ia: string;
  public readonly maskVersion: number;
  public readonly manufacturerId: number;
  public readonly hardwareType: Buffer;
  public readonly serialNumber: Buffer;
  public readonly orderInfo: Buffer;
  public readonly maxApduLength: number;
  public readonly groatFormat: 0 | 1;
  public readonly hasPeiObject: boolean;
  public readonly requireSecure: boolean;

  public loadStates = new Map<number, LoadState>([
    [1, LoadState.LOADED],
    [2, LoadState.LOADED],
    [3, LoadState.LOADED],
    [4, LoadState.LOADED],
  ]);
  public tableRefs = new Map<number, number>([
    [1, 0x03a000],
    [2, 0x03c000],
    [3, 0x038000],
    [4, 0x040000],
  ]);
  public allocatedSizes = new Map<number, number>();
  public memory = new Map<number, Buffer>();
  public writtenRanges: { address: number; length: number; extendedFrame: boolean }[] = [];
  public programVersion: Buffer = Buffer.alloc(5, 0x00);
  public mcbTables = new Map<string, Buffer>();
  public restarted = false;
  public masterResetEraseCode?: number;
  public authorized = false;
  public maxObservedApduLength = 0;

  // Phase 2 Security Interface Object (Type 17) state
  public securityLoadState: LoadState = LoadState.LOADED;
  public securityMode = false;
  public toolKey: Buffer | null = null;
  public pendingToolKey: Buffer | null = null;
  public sequenceNumberSending = 1n;
  public securityIaTable: { individualAddress: string; lastValidSeqNr: bigint }[] = [];
  public securityGroupKeyTable: { gaIndex: number; key: Buffer }[] = [];
  public securityGoFlags: Buffer = Buffer.alloc(0);
  public securityP2PKeyTable: { iaIndex: number; key: Buffer; roles: number }[] = [];

  private deviceSec: KnxDataSecure | null = null;
  private devTxSeq = 0;

  constructor(cfg: MockSystemBDeviceConfig) {
    this.ia = cfg.individualAddress;
    this.maskVersion = cfg.maskVersion ?? 0x07b0;
    this.manufacturerId = cfg.manufacturerId;
    this.hardwareType = cfg.hardwareType;
    this.serialNumber = cfg.serialNumber ?? Buffer.from("007100112233", "hex");
    this.orderInfo = cfg.orderInfo ?? Buffer.from("FF5A494F4D4E36365633", "hex");
    this.maxApduLength = cfg.maxApduLength ?? 254;
    this.groatFormat = cfg.groatFormat ?? 1;
    this.hasPeiObject = cfg.hasPeiObject ?? false;
    this.requireSecure = cfg.dataSecure?.requireSecure ?? false;

    if (cfg.dataSecure) {
      this.toolKey = Buffer.from(cfg.dataSecure.toolKey);
      this.securityMode = cfg.dataSecure.securityMode ?? true;
      this.sequenceNumberSending = cfg.dataSecure.initialSeqNr ?? 100n;
      this.deviceSec = new KnxDataSecure({
        sourceAddress: this.ia,
        initialSequenceNumber: this.sequenceNumberSending,
        ownToolKey: this.toolKey,
      });
    }

    // Pre-populate base segment buffers
    this.memory.set(1, Buffer.alloc(2));
    this.memory.set(2, Buffer.alloc(2));
    this.memory.set(3, Buffer.alloc(2));
    this.memory.set(4, Buffer.alloc(256));
  }

  public attach(bus: MockKNXBusService): void {
    bus.setResponder((cemi) => this.handleFrame(cemi, bus));
  }

  private sendResp(
    bus: MockKNXBusService,
    dst: string,
    apci: APCIEnum | number,
    data: Buffer,
    isShort: boolean = false,
    useSecure: boolean = false,
  ): void {
    const seq = this.devTxSeq;
    this.devTxSeq = (this.devTxSeq + 1) & 0x0f;
    const tpci = TPCIType.T_DATA_CONNECTED_PDU | (seq << 2);
    const plain = makeInd(this.ia, dst, tpci, apci, data, isShort);
    if (useSecure && this.deviceSec && this.toolKey) {
      const wrapped = this.deviceSec.wrapCemi(plain, {
        toolAccess: true,
        key: this.toolKey,
        confidentiality: true,
      });
      bus.injectIndication(wrapped);
    } else {
      bus.injectIndication(plain);
    }
  }

  private findObjectForAddress(addr: number, len: number): { objIdx: number; offset: number; buf: Buffer } | undefined {
    for (const [objIdx, base] of this.tableRefs.entries()) {
      const buf = this.memory.get(objIdx);
      if (buf && addr >= base && addr + len <= base + buf.length) {
        return { objIdx, offset: addr - base, buf };
      }
    }
    return undefined;
  }

  private handleFrame(cemi: CEMIInstance, bus: MockKNXBusService): void {
    if (!("TPDU" in cemi) || !("destinationAddress" in cemi)) return;
    if (cemi.destinationAddress !== this.ia) return;
    const src = cemi.sourceAddress;
    const tpci = cemi.TPDU.tpci;
    const wireApdu = cemi.TPDU.apdu;

    if (tpci.dataControlFlag) {
      if (tpci.getValue() === TPCIType.T_CONNECT_PDU) {
        this.devTxSeq = 0;
      }
      return;
    }

    if (!tpci.numberedFlag) return;
    const seq = tpci.sequenceNumber;
    // Always ACK incoming numbered frame
    bus.injectIndication(makeInd(this.ia, src, TPCIType.T_ACK_PDU | (seq << 2)));

    if ("length" in cemi && typeof cemi.length === "number" && cemi.length > this.maxObservedApduLength) {
      this.maxObservedApduLength = cemi.length;
    }

    let apdu = wireApdu;
    let isSecureFrame = false;

    // Handle KNX Data Secure connected frames (S-A_Sync_Req and S-A_Data)
    if (wireApdu.apci.value === APCI_DATA_SECURE) {
      if (!this.deviceSec || !this.toolKey) return;
      const asdu = wireApdu.data;
      const scf = decodeScf(asdu[0]);
      if (!scf) return;

      if (scf.service === SecureAlService.S_A_SYNC_REQ) {
        const decReq = decryptSASyncReqPdu({
          key: this.toolKey,
          secureAsdu: asdu,
          sourceAddress: src,
          destinationAddress: this.ia,
          addressType: AddressType.INDIVIDUAL,
          isExtendedFrame: !cemi.controlField1.frameType,
          eff: cemi.controlField2.eff,
          tpciByte: tpci.getValue(),
        });
        if (!decReq.ok || !decReq.challenge) return;
        const replySeq = this.devTxSeq;
        this.devTxSeq = (this.devTxSeq + 1) & 0x0f;
        const replyTpciByte = TPCIType.T_DATA_CONNECTED_PDU | (replySeq << 2);
        const builtRes = buildSASyncResPdu({
          key: this.toolKey,
          challenge: decReq.challenge,
          seqNrRemote: this.deviceSec.sequenceNumberSending,
          seqNrLocal: this.deviceSec.toolAccessLastValidSeq + 1n,
          toolAccess: true,
          systemBroadcast: false,
          sourceAddress: this.ia,
          destinationAddress: src,
          addressType: AddressType.INDIVIDUAL,
          isExtendedFrame: true,
          eff: 0,
          tpciByte: replyTpciByte,
        });
        bus.injectIndication(
          makeInd(this.ia, src, replyTpciByte, APCIEnum.A_DataSecure_Protocol_Data_Unit, builtRes.secureAsdu, false),
        );
        return;
      }

      const indBuf = Buffer.concat([Buffer.from([0x29]), cemi.toBuffer().subarray(1)]);
      const unwrapped = this.deviceSec.unwrapCemi(CEMI.fromBuffer(indBuf));
      if (!unwrapped.plainCemi || !("TPDU" in unwrapped.plainCemi)) return;
      apdu = unwrapped.plainCemi.TPDU.apdu;
      isSecureFrame = true;
    }

    const rawApci = apdu.apci.value;

    // Plain access to a Data Secure device returns 0xFFFF on DeviceDescriptor_Read (matching real hardware)
    if (this.requireSecure && !isSecureFrame) {
      if (rawApci === APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit) {
        this.sendResp(
          bus,
          src,
          APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit,
          Buffer.from([0xff, 0xff]),
          false,
          false,
        );
      }
      return;
    }

    // Confirmed Master Reset A_Restart (0x0381)
    if (rawApci === (APCIEnum.A_Restart_Protocol_Data_Unit | 0x01)) {
      this.masterResetEraseCode = apdu.data.length >= 1 ? apdu.data[0] : 0;
      this.restarted = true;
      this.sendResp(
        bus,
        src,
        APCIEnum.A_Restart_Protocol_Data_Unit | 0x21,
        Buffer.from([0x00, 0x00, 0x01]),
        false,
        isSecureFrame,
      );
      if (this.pendingToolKey && this.deviceSec) {
        this.toolKey = Buffer.from(this.pendingToolKey);
        this.deviceSec = new KnxDataSecure({
          sourceAddress: this.ia,
          initialSequenceNumber: this.sequenceNumberSending,
          ownToolKey: this.toolKey,
        });
        this.pendingToolKey = null;
      }
      return;
    }

    // Basic A_Restart
    if (rawApci === APCIEnum.A_Restart_Protocol_Data_Unit) {
      this.restarted = true;
      if (this.pendingToolKey && this.deviceSec) {
        this.toolKey = Buffer.from(this.pendingToolKey);
        this.deviceSec = new KnxDataSecure({
          sourceAddress: this.ia,
          initialSequenceNumber: this.sequenceNumberSending,
          ownToolKey: this.toolKey,
        });
        this.pendingToolKey = null;
      }
      return;
    }

    // Device Descriptor Read
    if (rawApci === APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit) {
      const dd = Buffer.alloc(2);
      dd.writeUInt16BE(this.maskVersion, 0);
      this.sendResp(bus, src, APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit, dd, false, isSecureFrame);
      return;
    }

    // Authorize Request
    if (rawApci === APCIEnum.A_Authorize_Request_Protocol_Data_Unit) {
      this.authorized = true;
      this.sendResp(
        bus,
        src,
        APCIEnum.A_Authorize_Response_Protocol_Data_Unit,
        Buffer.from([0x02]),
        false,
        isSecureFrame,
      );
      return;
    }

    // Property Description Read
    if (rawApci === APCIEnum.A_PropertyDescription_Read_Protocol_Data_Unit) {
      const objIdx = apdu.data[0];
      const pid = apdu.data[1];
      if (objIdx === 2 && pid === KNXPropertyId.PID_TABLE) {
        const pdt = this.groatFormat === 1 ? 0x14 : 0x12; // PDT_GENERIC_04 vs PDT_GENERIC_02
        const resp = Buffer.from([objIdx, pid, 0x03, 0x80 | pdt, 0x0f, 0xff, 0x31]);
        this.sendResp(bus, src, APCIEnum.A_PropertyDescription_Response_Protocol_Data_Unit, resp, false, isSecureFrame);
      } else {
        const resp = Buffer.from([objIdx, pid, 0x00, 0x00, 0x00, 0x00, 0x00]);
        this.sendResp(bus, src, APCIEnum.A_PropertyDescription_Response_Protocol_Data_Unit, resp, false, isSecureFrame);
      }
      return;
    }

    // Property Value Read
    if (rawApci === APCIEnum.A_PropertyValue_Read_Protocol_Data_Unit) {
      const objIdx = apdu.data[0];
      const pid = apdu.data[1];
      const count = (apdu.data[2] >> 4) & 0x0f;
      const startIndex = ((apdu.data[2] & 0x0f) << 8) | apdu.data[3];
      const val = this.readProp(objIdx, pid, startIndex, count);
      const hdr = Buffer.from([objIdx, pid, ((val ? count : 0) << 4) | ((startIndex >> 8) & 0x0f), startIndex & 0xff]);
      this.sendResp(
        bus,
        src,
        APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
        val ? Buffer.concat([hdr, val]) : hdr,
        false,
        isSecureFrame,
      );
      return;
    }

    // Property Value Write
    if (rawApci === APCIEnum.A_PropertyValue_Write_Protocol_Data_Unit) {
      const objIdx = apdu.data[0];
      const pid = apdu.data[1];
      const count = (apdu.data[2] >> 4) & 0x0f;
      const startIndex = ((apdu.data[2] & 0x0f) << 8) | apdu.data[3];
      const valData = Buffer.from(apdu.data.subarray(4));
      const respData = this.writeProp(objIdx, pid, startIndex, count, valData);
      const outCount = respData ? count : 0;
      const hdr = Buffer.from([objIdx, pid, (outCount << 4) | ((startIndex >> 8) & 0x0f), startIndex & 0xff]);
      this.sendResp(
        bus,
        src,
        APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
        respData ? Buffer.concat([hdr, respData]) : hdr,
        false,
        isSecureFrame,
      );
      return;
    }

    // Extended Property Value Read (Object Type 17 — Security Interface Object)
    if (rawApci === APCIEnum.A_PropertyExtValue_Read_Protocol_Data_Unit) {
      const { objectType, objectInstance, propertyId } = decodeExtObjectHeader(apdu.data);
      const count = apdu.data.readUInt8(5);
      const startIndex = apdu.data.readUInt16BE(6) & 0x0fff;
      const val = this.readExtProp(objectType, objectInstance, propertyId, startIndex, count);
      const hdr = Buffer.alloc(8);
      encodeExtObjectHeader(objectType, objectInstance, propertyId).copy(hdr, 0);
      hdr.writeUInt8(val ? count : 0, 5);
      hdr.writeUInt16BE(startIndex & 0x0fff, 6);
      this.sendResp(
        bus,
        src,
        APCIEnum.A_PropertyExtValue_Response_Protocol_Data_Unit,
        val ? Buffer.concat([hdr, val]) : Buffer.concat([hdr, Buffer.from([ManagementReturnCode.E_DATA_VOID])]),
        false,
        isSecureFrame,
      );
      return;
    }

    // Extended Property Value Write Confirmed (Object Type 17 — Security Interface Object)
    if (rawApci === APCIEnum.A_PropertyExtValue_WriteCon_Protocol_Data_Unit) {
      const { objectType, objectInstance, propertyId } = decodeExtObjectHeader(apdu.data);
      const count = apdu.data.readUInt8(5);
      const startIndex = apdu.data.readUInt16BE(6) & 0x0fff;
      const valData = Buffer.from(apdu.data.subarray(8));
      const rc = this.writeExtProp(objectType, objectInstance, propertyId, startIndex, count, valData);
      const resp = Buffer.alloc(9);
      encodeExtObjectHeader(objectType, objectInstance, propertyId).copy(resp, 0);
      resp.writeUInt8(rc === ManagementReturnCode.E_SUCCESS ? count : 0, 5);
      resp.writeUInt16BE(startIndex & 0x0fff, 6);
      resp.writeUInt8(rc, 8);
      this.sendResp(bus, src, APCIEnum.A_PropertyExtValue_WriteConRes_Protocol_Data_Unit, resp, false, isSecureFrame);
      return;
    }

    // Extended Function Property Command / State Read (PID_SECURITY_MODE)
    if (
      rawApci === APCIEnum.A_FunctionPropertyExtCommand_Protocol_Data_Unit ||
      rawApci === APCIEnum.A_FunctionPropertyExtState_Read_Protocol_Data_Unit
    ) {
      const { objectType, objectInstance, propertyId } = decodeExtObjectHeader(apdu.data);
      const fnData = apdu.data.subarray(5);
      const hdr = encodeExtObjectHeader(objectType, objectInstance, propertyId);
      if (
        objectType === KNXInterfaceObjectType.SECURITY_OBJECT &&
        propertyId === KNXSecurityPropertyId.PID_SECURITY_MODE
      ) {
        if (rawApci === APCIEnum.A_FunctionPropertyExtCommand_Protocol_Data_Unit && fnData.length >= 3) {
          this.securityMode = fnData[2] !== 0;
          this.sendResp(
            bus,
            src,
            APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit,
            Buffer.concat([hdr, Buffer.from([ManagementReturnCode.E_SUCCESS, 0x00, 0x00])]),
            false,
            isSecureFrame,
          );
          return;
        }
        this.sendResp(
          bus,
          src,
          APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit,
          Buffer.concat([hdr, Buffer.from([ManagementReturnCode.E_SUCCESS, 0x00, this.securityMode ? 0x01 : 0x00])]),
          false,
          isSecureFrame,
        );
        return;
      }
      this.sendResp(
        bus,
        src,
        APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit,
        Buffer.concat([hdr, Buffer.from([ManagementReturnCode.E_DATA_VOID])]),
        false,
        isSecureFrame,
      );
      return;
    }

    // Extended Memory Write (0x01FB)
    if (rawApci === APCIEnum.A_MemoryExtended_Write_Protocol_Data_Unit) {
      const len = apdu.data[0];
      const addr24 = (apdu.data[1] << 16) | apdu.data.readUInt16BE(2);
      const payload = apdu.data.subarray(4, 4 + len);
      const target = this.findObjectForAddress(addr24, len);
      const extendedFrame = !cemi.controlField1.frameType; // FT=0 => Extended Frame
      this.writtenRanges.push({ address: addr24, length: len, extendedFrame });

      let rc = ManagementReturnCode.E_ADDRESS_VOID;
      if (target) {
        payload.copy(target.buf, target.offset);
        rc = ManagementReturnCode.E_SUCCESS;
      }
      const resp = Buffer.from([rc, (addr24 >> 16) & 0xff, (addr24 >> 8) & 0xff, addr24 & 0xff]);
      this.sendResp(bus, src, APCIEnum.A_MemoryExtended_WriteResponse_Protocol_Data_Unit, resp, false, isSecureFrame);
      return;
    }

    // Extended Memory Read (0x01FD)
    if (rawApci === APCIEnum.A_MemoryExtended_Read_Protocol_Data_Unit) {
      const len = apdu.data[0];
      const addr24 = (apdu.data[1] << 16) | apdu.data.readUInt16BE(2);
      const target = this.findObjectForAddress(addr24, len);
      if (target) {
        const hdr = Buffer.from([
          ManagementReturnCode.E_SUCCESS,
          (addr24 >> 16) & 0xff,
          (addr24 >> 8) & 0xff,
          addr24 & 0xff,
        ]);
        const slice = target.buf.subarray(target.offset, target.offset + len);
        this.sendResp(
          bus,
          src,
          APCIEnum.A_MemoryExtended_ReadResponse_Protocol_Data_Unit,
          Buffer.concat([hdr, slice]),
          false,
          isSecureFrame,
        );
      } else {
        const hdr = Buffer.from([
          ManagementReturnCode.E_ADDRESS_VOID,
          (addr24 >> 16) & 0xff,
          (addr24 >> 8) & 0xff,
          addr24 & 0xff,
        ]);
        this.sendResp(bus, src, APCIEnum.A_MemoryExtended_ReadResponse_Protocol_Data_Unit, hdr, false, isSecureFrame);
      }
    }
  }

  private readExtProp(
    objectType: number,
    _objectInstance: number,
    pid: number,
    startIndex: number,
    count: number,
  ): Buffer | null {
    if (objectType !== KNXInterfaceObjectType.SECURITY_OBJECT) return null;
    if (pid === KNXSecurityPropertyId.PID_LOAD_STATE_CONTROL) {
      return Buffer.from([this.securityLoadState]);
    }
    if (pid === KNXSecurityPropertyId.PID_SEQUENCE_NUMBER_SENDING) {
      return encodeSeqNr48(this.sequenceNumberSending);
    }
    if (pid === KNXSecurityPropertyId.PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE) {
      if (startIndex === 0) {
        const b = Buffer.alloc(2);
        b.writeUInt16BE(this.securityIaTable.length, 0);
        return b;
      }
      const chunks: Buffer[] = [];
      for (let i = startIndex - 1; i < startIndex - 1 + count && i < this.securityIaTable.length; i++) {
        const e = this.securityIaTable[i];
        chunks.push(KNXHelper.GetAddress(e.individualAddress, "."), encodeSeqNr48(e.lastValidSeqNr));
      }
      return chunks.length > 0 ? Buffer.concat(chunks) : null;
    }
    if (pid === KNXSecurityPropertyId.PID_GRP_KEY_TABLE) {
      if (startIndex === 0) {
        const b = Buffer.alloc(2);
        b.writeUInt16BE(this.securityGroupKeyTable.length, 0);
        return b;
      }
      const chunks: Buffer[] = [];
      for (let i = startIndex - 1; i < startIndex - 1 + count && i < this.securityGroupKeyTable.length; i++) {
        const e = this.securityGroupKeyTable[i];
        const idxBuf = Buffer.alloc(2);
        idxBuf.writeUInt16BE(e.gaIndex, 0);
        chunks.push(idxBuf, e.key);
      }
      return chunks.length > 0 ? Buffer.concat(chunks) : null;
    }
    if (pid === KNXSecurityPropertyId.PID_GO_SECURITY_FLAGS) {
      if (startIndex === 0) {
        const b = Buffer.alloc(2);
        b.writeUInt16BE(this.securityGoFlags.length, 0);
        return b;
      }
      return Buffer.from(this.securityGoFlags.subarray(startIndex - 1, startIndex - 1 + count));
    }
    if (pid === KNXSecurityPropertyId.PID_P2P_KEY_TABLE) {
      if (startIndex === 0) {
        const b = Buffer.alloc(2);
        b.writeUInt16BE(this.securityP2PKeyTable.length, 0);
        return b;
      }
      const chunks: Buffer[] = [];
      for (let i = startIndex - 1; i < startIndex - 1 + count && i < this.securityP2PKeyTable.length; i++) {
        const e = this.securityP2PKeyTable[i];
        const row = Buffer.alloc(20);
        row.writeUInt16BE(e.iaIndex, 0);
        e.key.copy(row, 2);
        row.writeUInt16BE(e.roles, 18);
        chunks.push(row);
      }
      return chunks.length > 0 ? Buffer.concat(chunks) : null;
    }
    return null;
  }

  private writeExtProp(
    objectType: number,
    _objectInstance: number,
    pid: number,
    startIndex: number,
    count: number,
    data: Buffer,
  ): number {
    if (objectType !== KNXInterfaceObjectType.SECURITY_OBJECT) return ManagementReturnCode.E_DATA_VOID;

    if (pid === KNXSecurityPropertyId.PID_LOAD_STATE_CONTROL && data.length >= 1) {
      const event = data[0] as LoadEvent;
      if (event === LoadEvent.UNLOAD) this.securityLoadState = LoadState.UNLOADED;
      else if (event === LoadEvent.START_LOADING) this.securityLoadState = LoadState.LOADING;
      else if (event === LoadEvent.LOAD_COMPLETED) this.securityLoadState = LoadState.LOADED;
      return ManagementReturnCode.E_SUCCESS;
    }
    if (pid === KNXSecurityPropertyId.PID_TOOL_KEY && data.length === 16) {
      this.pendingToolKey = Buffer.from(data);
      return ManagementReturnCode.E_SUCCESS;
    }
    if (pid === KNXSecurityPropertyId.PID_SEQUENCE_NUMBER_SENDING && data.length === 6) {
      this.sequenceNumberSending = decodeSeqNr48(data, 0);
      return ManagementReturnCode.E_SUCCESS;
    }
    if (pid === KNXSecurityPropertyId.PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE) {
      if (startIndex === 0) {
        this.securityIaTable = [];
        return ManagementReturnCode.E_SUCCESS;
      }
      for (let i = 0; i < count && (i + 1) * 8 <= data.length; i++) {
        const ia = KNXHelper.GetAddress(data.subarray(i * 8, i * 8 + 2), ".");
        const seq = decodeSeqNr48(data, i * 8 + 2);
        this.securityIaTable[startIndex - 1 + i] = { individualAddress: ia, lastValidSeqNr: seq };
      }
      return ManagementReturnCode.E_SUCCESS;
    }
    if (pid === KNXSecurityPropertyId.PID_GRP_KEY_TABLE) {
      if (startIndex === 0) {
        this.securityGroupKeyTable = [];
        return ManagementReturnCode.E_SUCCESS;
      }
      for (let i = 0; i < count && (i + 1) * 18 <= data.length; i++) {
        const gaIndex = data.readUInt16BE(i * 18);
        const key = Buffer.from(data.subarray(i * 18 + 2, i * 18 + 18));
        this.securityGroupKeyTable[startIndex - 1 + i] = { gaIndex, key };
      }
      return ManagementReturnCode.E_SUCCESS;
    }
    if (pid === KNXSecurityPropertyId.PID_GO_SECURITY_FLAGS) {
      if (startIndex === 0) {
        this.securityGoFlags = Buffer.alloc(0);
        return ManagementReturnCode.E_SUCCESS;
      }
      const needed = startIndex - 1 + count;
      if (this.securityGoFlags.length < needed) {
        const next = Buffer.alloc(needed, 0x00);
        this.securityGoFlags.copy(next, 0);
        this.securityGoFlags = next;
      }
      data.copy(this.securityGoFlags, startIndex - 1, 0, Math.min(count, data.length));
      return ManagementReturnCode.E_SUCCESS;
    }
    if (pid === KNXSecurityPropertyId.PID_P2P_KEY_TABLE) {
      if (startIndex === 0) {
        this.securityP2PKeyTable = [];
        return ManagementReturnCode.E_SUCCESS;
      }
      for (let i = 0; i < count && (i + 1) * 20 <= data.length; i++) {
        const iaIndex = data.readUInt16BE(i * 20);
        const key = Buffer.from(data.subarray(i * 20 + 2, i * 20 + 18));
        const roles = data.readUInt16BE(i * 20 + 18);
        this.securityP2PKeyTable[startIndex - 1 + i] = { iaIndex, key, roles };
      }
      return ManagementReturnCode.E_SUCCESS;
    }
    return ManagementReturnCode.E_DATA_VOID;
  }

  private readProp(objIdx: number, pid: number, startIndex: number, count: number): Buffer | null {
    if (objIdx === 0) {
      if (pid === KNXPropertyId.PID_MAX_APDULENGTH) {
        const b = Buffer.alloc(2);
        b.writeUInt16BE(this.maxApduLength, 0);
        return b;
      }
      if (pid === KNXPropertyId.PID_MANUFACTURER_ID) {
        const b = Buffer.alloc(2);
        b.writeUInt16BE(this.manufacturerId, 0);
        return b;
      }
      if (pid === KNXPropertyId.PID_SERIAL_NUMBER) return this.serialNumber;
      if (pid === KNXPropertyId.PID_HARDWARE_TYPE) return this.hardwareType;
      if (pid === KNXPropertyId.PID_ORDER_INFO) return this.orderInfo;
      if (pid === KNXPropertyId.PID_VERSION) return Buffer.from([0x18, 0x05]);
      return null;
    }

    if (objIdx === 5 && !this.hasPeiObject) return null;

    if (pid === KNXPropertyId.PID_LOAD_STATE_CONTROL) {
      return Buffer.from([this.loadStates.get(objIdx) ?? LoadState.UNLOADED]);
    }
    if (pid === KNXPropertyId.PID_TABLE_REFERENCE) {
      const ptr = this.tableRefs.get(objIdx) ?? 0;
      const b = Buffer.alloc(4);
      b.writeUInt32BE(ptr >>> 0, 0);
      return b;
    }
    if (pid === KNXPropertyId.PID_PROGRAM_VERSION && objIdx === 4) {
      return this.programVersion;
    }
    if (pid === KNXPropertyId.PID_MCB_TABLE) {
      const key = `${objIdx}:${startIndex}`;
      const stored = this.mcbTables.get(key);
      if (stored) return stored;
      const buf = this.memory.get(objIdx) ?? Buffer.alloc(0);
      const stamp = Buffer.alloc(8 * count, 0);
      stamp.writeUInt32BE(buf.length, 0);
      stamp.writeUInt16BE(crc16Ccitt(buf), 6);
      return stamp;
    }
    return null;
  }

  private writeProp(objIdx: number, pid: number, startIndex: number, _count: number, data: Buffer): Buffer | null {
    if (objIdx === 5 && !this.hasPeiObject) return null;

    if (pid === KNXPropertyId.PID_LOAD_STATE_CONTROL && data.length >= 1) {
      const event = data[0] as LoadEvent;
      if (event === LoadEvent.UNLOAD) {
        this.loadStates.set(objIdx, LoadState.UNLOADED);
        this.tableRefs.set(objIdx, 0);
        return Buffer.from([LoadState.UNLOADED]);
      }
      if (event === LoadEvent.START_LOADING) {
        this.loadStates.set(objIdx, LoadState.LOADING);
        return Buffer.from([LoadState.LOADING]);
      }
      if (event === LoadEvent.ADDITIONAL_LOAD_CONTROLS && data.length >= 8 && data[1] === 0x0b) {
        const size = data.readUInt32BE(2);
        const mode = data[6];
        const fill = data[7];
        const baseMap: Record<number, number> = { 1: 0x03a000, 2: 0x03c000, 3: 0x038000, 4: 0x040000, 5: 0x100000 };
        this.tableRefs.set(objIdx, baseMap[objIdx] ?? 0x040000);
        this.allocatedSizes.set(objIdx, size);
        const prev = this.memory.get(objIdx);
        if (mode === 1 || !prev || prev.length !== size) {
          this.memory.set(objIdx, Buffer.alloc(size, mode === 1 ? fill : 0x00));
        }
        this.loadStates.set(objIdx, LoadState.LOADING);
        return Buffer.from([LoadState.LOADING]);
      }
      if (event === LoadEvent.LOAD_COMPLETED) {
        this.loadStates.set(objIdx, LoadState.LOADED);
        return Buffer.from([LoadState.LOADED]);
      }
      return null;
    }

    if (pid === KNXPropertyId.PID_PROGRAM_VERSION && objIdx === 4 && data.length === 5) {
      this.programVersion = Buffer.from(data);
      return Buffer.from(data);
    }

    if (pid === KNXPropertyId.PID_MCB_TABLE) {
      this.mcbTables.set(`${objIdx}:${startIndex}`, Buffer.from(data));
      return Buffer.from(data);
    }

    return null;
  }
}

// ============================================================================
// Helper: Build a synthetic in-memory ZIP buffer for unit tests
// ============================================================================

function buildZipBuffer(files: Record<string, Buffer | string>): Buffer {
  const localChunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let offset = 0;
  let count = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const deflated = zlib.deflateRawSync(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);

    localChunks.push(local, deflated);
    cdChunks.push(cd);
    offset += local.length + deflated.length;
    count++;
  }

  const cdBuf = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

// ============================================================================
// 1. Spec Primitives & Binary Table Tests
// ============================================================================

describe("KNX System B Programming Primitives (03_05_01 / 03_05_02 / 03_05_03)", () => {
  test("CRC16-CCITT matches KNX 03_05_01 §4.2.27.1.2 official vector ('123456789' -> 0xE5CC)", () => {
    expect(crc16Ccitt(Buffer.from("123456789", "ascii"))).toBe(0xe5cc);
  });

  test("encodeDpt9Word encodes standard KNX DPT 9 floating point values", () => {
    expect(encodeDpt9Word(0)).toBe(0x0000);
    expect(encodeDpt9Word(5.0)).toBe(500); // exp=0, mantissa=500 -> 0x01F4
    expect(encodeDpt9Word(20.47)).toBe(2047); // exp=0, mantissa=2047
    // -5.0 => exp=0, mantissa=-500 -> sign=1, m11 = (-500 & 0x7FF) = 0x60C => 0x860C
    expect(encodeDpt9Word(-5.0)).toBe(0x860c);
  });

  test("matchesWhenTest handles exact, numeric, space-OR, relational, and range conditions", () => {
    expect(matchesWhenTest("1", "1")).toBe(true);
    expect(matchesWhenTest("01", "1")).toBe(true);
    expect(matchesWhenTest("2", "0 2 5")).toBe(true);
    expect(matchesWhenTest("3", "0 2 5")).toBe(false);
    expect(matchesWhenTest("1", "!=0")).toBe(true);
    expect(matchesWhenTest("0", "!=0")).toBe(false);
    expect(matchesWhenTest("5", ">=5")).toBe(true);
    expect(matchesWhenTest("4", ">=5")).toBe(false);
    expect(matchesWhenTest("2", "<=2")).toBe(true);
    expect(matchesWhenTest("3", "<=2")).toBe(false);
    expect(matchesWhenTest("4", "1..5")).toBe(true);
    expect(matchesWhenTest("6", "1..5")).toBe(false);
    expect(matchesWhenTest("9", "0 3..5 9")).toBe(true);
  });

  test("objectSizeToValueTypeCode matches KNX 03_05_01 §4.18.6 Table 88", () => {
    expect(objectSizeToValueTypeCode("1 Bit")).toBe(0);
    expect(objectSizeToValueTypeCode("4 Bit")).toBe(3);
    expect(objectSizeToValueTypeCode("1 Byte")).toBe(7);
    expect(objectSizeToValueTypeCode("2 Bytes")).toBe(8);
    expect(objectSizeToValueTypeCode("3 Bytes")).toBe(9);
    expect(objectSizeToValueTypeCode("4 Bytes")).toBe(10);
    expect(objectSizeToValueTypeCode("6 Bytes")).toBe(11);
    expect(objectSizeToValueTypeCode("14 Bytes")).toBe(14);
    expect(objectSizeToValueTypeCode("5 Bytes")).toBe(15);
    expect(objectSizeToValueTypeCode("15 Bytes")).toBe(21);
    expect(objectSizeToValueTypeCode("252 Bytes")).toBe(255);
  });

  test("buildConnectedLDataReq automatically switches ControlField1 to Extended Frame (0x30) when APDU > 15 bytes", () => {
    const shortReq = buildConnectedLDataReq(
      "1.1.250",
      "1.2.63",
      0,
      APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit,
      Buffer.from([0x00]),
      true,
    );
    expect(shortReq.controlField1.frameType).toBe(true); // Standard Frame (0xB0)
    expect(shortReq.controlField1.buffer[0]).toBe(0xb0);

    const payload215 = encodeMemoryExtendedWriteData(0x038000, Buffer.alloc(215, 0xaa));
    const longReq = buildConnectedLDataReq(
      "1.1.250",
      "1.2.63",
      7,
      APCIEnum.A_MemoryExtended_Write_Protocol_Data_Unit,
      payload215,
      false,
    );
    expect(longReq.length).toBe(220); // 1 (APCI lo) + 4 (len+addr24) + 215 (data)
    expect(longReq.controlField1.frameType).toBe(false); // Extended Frame (0x30)
    expect(longReq.controlField1.buffer[0]).toBe(0x30);
  });

  test("System B GrAT, GrOAT (Format 0 & 1), and GrOT match 03_05_01 & real ETS capture bit-for-bit", () => {
    // 1. GrAT ascending order & 1-based TSAP
    const grat = compileGroupAddressTable(["2/1/5", "1/0/1", "1/0/2", "1/0/1"]);
    expect(grat.sortedAddresses).toEqual(["1/0/1", "1/0/2", "2/1/5"]);
    expect(grat.tsapByAddress.get("1/0/1")).toBe(1);
    expect(grat.tsapByAddress.get("1/0/2")).toBe(2);
    expect(grat.tsapByAddress.get("2/1/5")).toBe(3);
    expect(grat.buffer.readUInt16BE(0)).toBe(3);
    expect(grat.buffer.readUInt16BE(2)).toBe(0x0801); // 1/0/1
    expect(grat.buffer.readUInt16BE(4)).toBe(0x0802); // 1/0/2
    expect(grat.buffer.readUInt16BE(6)).toBe(0x1105); // 2/1/5

    // 2. GrOT descriptors matching ETS capture Programacion_exitosa_del_knx_usb 2 (1).xml:
    //    GO #4 (slot 3): 1 Byte, Write, Low, unlinked -> 0x13 0x07
    //    GO #5 (slot 4): 1 Byte, Transmit, Low, unlinked -> 0x43 0x07
    //    GO #28 (slot 27): 1 Bit, Read+Transmit, Low, linked to 2/1/5 (sending) & 1/0/1 (listening) -> 0x4F 0x00 (C=1!)
    //    GO #34 (slot 33): 2 Bytes, Read+Write, Low, unlinked -> 0x1B 0x08
    const active = new Map<number, ResolvedComObject>([
      [
        4,
        {
          number: 4,
          comObjectId: "O-4",
          comObjectRefId: "O-4_R-4",
          name: "sceneRx",
          text: "",
          functionText: "",
          objectSize: "1 Byte",
          valueTypeCode: 7,
          priority: "Low",
          flags: { communication: true, read: false, write: true, transmit: false, update: false, readOnInit: false },
          groupAddresses: [],
        },
      ],
      [
        5,
        {
          number: 5,
          comObjectId: "O-5",
          comObjectRefId: "O-5_R-5",
          name: "sceneTx",
          text: "",
          functionText: "",
          objectSize: "1 Byte",
          valueTypeCode: 7,
          priority: "Low",
          flags: { communication: true, read: false, write: false, transmit: true, update: false, readOnInit: false },
          groupAddresses: [],
        },
      ],
      [
        28,
        {
          number: 28,
          comObjectId: "O-28",
          comObjectRefId: "O-28_R-28",
          name: "status",
          text: "",
          functionText: "",
          objectSize: "1 Bit",
          valueTypeCode: 0,
          priority: "Low",
          flags: { communication: true, read: true, write: false, transmit: true, update: false, readOnInit: false },
          sendingGroupAddress: "2/1/5",
          groupAddresses: ["2/1/5", "1/0/1"],
        },
      ],
      [
        34,
        {
          number: 34,
          comObjectId: "O-34",
          comObjectRefId: "O-34_R-34",
          name: "temp",
          text: "",
          functionText: "",
          objectSize: "2 Bytes",
          valueTypeCode: 8,
          priority: "Low",
          flags: { communication: true, read: true, write: true, transmit: false, update: false, readOnInit: false },
          groupAddresses: [],
        },
      ],
    ]);

    const grot = compileGroupObjectTable(active, 238, true);
    expect(grot.length).toBe(478); // 2 + 238*2 = 0x1DE (matches real ETS capture!)
    expect(grot.readUInt16BE(0)).toBe(238);
    expect(grot.readUInt16BE(2 + 3 * 2)).toBe(0x1307); // GO #4
    expect(grot.readUInt16BE(2 + 4 * 2)).toBe(0x4307); // GO #5
    expect(grot.readUInt16BE(2 + 27 * 2)).toBe(0x4f00); // GO #28 (C=1 because linked!)
    expect(grot.readUInt16BE(2 + 33 * 2)).toBe(0x1b08); // GO #34
    expect(grot.readUInt16BE(2 + 0 * 2)).toBe(0x0000); // Inactive GO #1

    // 3. GrOAT Format 1 & Format 0: sending GA (2/1/5 -> TSAP 3) MUST appear before listening GA (1/0/1 -> TSAP 1) for ASAP 28!
    const groat1 = compileAssociationTable(active, grat.tsapByAddress, 1);
    expect(groat1.count).toBe(2);
    expect(groat1.buffer.length).toBe(2 + 2 * 4);
    expect(groat1.buffer.readUInt16BE(0)).toBe(2);
    expect(groat1.buffer.readUInt16BE(2)).toBe(3); // TSAP 3 (sending)
    expect(groat1.buffer.readUInt16BE(4)).toBe(28); // ASAP 28
    expect(groat1.buffer.readUInt16BE(6)).toBe(1); // TSAP 1 (listening)
    expect(groat1.buffer.readUInt16BE(8)).toBe(28); // ASAP 28

    const groat0 = compileAssociationTable(active, grat.tsapByAddress, 0);
    expect(groat0.buffer.length).toBe(2 + 2 * 2);
    expect(Array.from(groat0.buffer)).toEqual([0x00, 0x02, 3, 28, 1, 28]);
  });

  test("patchBitsIntoBuffer supports sub-byte MSB bit-packing and preserves adjacent bits", () => {
    const target = Buffer.from([0x00, 0xff]);
    const mask = Buffer.from([0x00, 0x00]);
    // Write 3-bit value 0b101 at bitOffset=1 -> bits 6..4 = 101 => 0b0101_0000 = 0x50
    patchBitsIntoBuffer(target, mask, 0, 1, 3, Buffer.from([0b101]));
    expect(target[0]).toBe(0x50);
    expect(mask[0]).toBe(0x70);
    // Write 4-bit value 0b1001 at bitOffset=4 -> bits 3..0 = 1001 => 0x59
    patchBitsIntoBuffer(target, mask, 0, 4, 4, Buffer.from([0b1001]));
    expect(target[0]).toBe(0x59);
    expect(mask[0]).toBe(0x7f);
  });
});

// ============================================================================
// 2. Synthetic .knxprod End-to-End Tests (Always Runs in CI)
// ============================================================================

describe("Synthetic .knxprod Parse, Evaluate, Compile & Simulated MV-07B0 Download", () => {
  const baseData = Buffer.alloc(64, 0x00);
  // Put firmware header at 0..7
  Buffer.from("DEADBEEFCAFEBABE", "hex").copy(baseData, 0);
  const baseMask = Buffer.alloc(64, 0xff);
  // Mark offset 8..15 as unowned (Mask=0) to verify it is NEVER written!
  baseMask.fill(0x00, 8, 16);

  const syntheticAppXml = `<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20">
  <ManufacturerData>
    <Manufacturer RefId="M-0071">
      <ApplicationPrograms>
        <ApplicationProgram Id="M-0071_A-1234-10-ABCD" ApplicationNumber="4660" ApplicationVersion="16" ProgramType="ApplicationProgram" MaskVersion="MV-07B0" Name="Synthetic Actuator" VisibleDescription="Synthetic Secure Actuator" LoadProcedureStyle="MergedProcedure" PeiType="0" DefaultLanguage="en-US" IsSecureEnabled="true" MaxSecurityGroupKeyTableEntries="64" MaxSecurityIndividualAddressEntries="64" MaxSecurityP2PKeyTableEntries="8">
          <Static>
            <Code>
              <RelativeSegment Id="SEG-4" Name="Params+App" Size="64" LoadStateMachine="4" Offset="0">
                <Data>${baseData.toString("base64")}</Data>
                <Mask>${baseMask.toString("base64")}</Mask>
              </RelativeSegment>
            </Code>
            <ParameterTypes>
              <ParameterType Id="PT-HW" Name="HW">
                <TypeRestriction Base="BinaryValue" SizeInBit="48">
                  <Enumeration Id="E-HW" Text="HW" Value="0" BinaryValue="${Buffer.from("007100001234", "hex").toString("base64")}" />
                </TypeRestriction>
              </ParameterType>
              <ParameterType Id="PT-BOOL" Name="Bool">
                <TypeRestriction Base="Value" SizeInBit="8">
                  <Enumeration Id="E-NO" Text="Disabled" Value="0" />
                  <Enumeration Id="E-YES" Text="Enabled" Value="1" />
                </TypeRestriction>
              </ParameterType>
              <ParameterType Id="PT-U16" Name="U16">
                <TypeNumber SizeInBit="16" Type="unsignedInt" minInclusive="0" maxInclusive="65535" />
              </ParameterType>
              <ParameterType Id="PT-DPT9" Name="DPT9">
                <TypeFloat Encoding="DPT 9" minInclusive="-50" maxInclusive="100" />
              </ParameterType>
            </ParameterTypes>
            <Parameters>
              <Parameter Id="P-HW" Name="checkHW" ParameterType="PT-HW" Text="HW" Value="0" Access="None">
                <Property ObjectIndex="0" PropertyId="78" Offset="0" BitOffset="0" />
              </Parameter>
              <Parameter Id="P-EN" Name="ch1.enable" ParameterType="PT-BOOL" Text="Enable Ch1" Value="0">
                <Memory CodeSegment="SEG-4" Offset="16" BitOffset="0" />
              </Parameter>
              <Parameter Id="P-DELAY" Name="ch1.delay" ParameterType="PT-U16" Text="Delay" SuffixText="ms" Value="100">
                <Memory CodeSegment="SEG-4" Offset="18" BitOffset="0" />
              </Parameter>
              <Parameter Id="P-DOUBLED" Name="ch1.delayDoubled" ParameterType="PT-U16" Text="Delay x2" Value="200">
                <Memory CodeSegment="SEG-4" Offset="20" BitOffset="0" />
              </Parameter>
              <Parameter Id="P-TEMP" Name="ch1.threshold" ParameterType="PT-DPT9" Text="Temp" SuffixText="C" Value="5.0">
                <Memory CodeSegment="SEG-4" Offset="22" BitOffset="0" />
              </Parameter>
              <Union SizeInBit="8">
                <Memory CodeSegment="SEG-4" Offset="24" BitOffset="0" />
                <Parameter Id="UP-OFF" Name="ch1.modeOff" ParameterType="PT-BOOL" Text="Off" Value="0" Offset="0" BitOffset="0" DefaultUnionParameter="true" />
                <Parameter Id="UP-ON" Name="ch1.modeOn" ParameterType="PT-BOOL" Text="On" Value="1" Offset="0" BitOffset="0" />
              </Union>
            </Parameters>
            <ParameterRefs>
              <ParameterRef Id="P-EN_R-1" RefId="P-EN" />
              <ParameterRef Id="P-DELAY_R-1" RefId="P-DELAY" />
              <ParameterRef Id="P-DOUBLED_R-1" RefId="P-DOUBLED" />
              <ParameterRef Id="P-TEMP_R-1" RefId="P-TEMP" />
              <ParameterRef Id="UP-OFF_R-1" RefId="UP-OFF" />
              <ParameterRef Id="UP-ON_R-1" RefId="UP-ON" />
            </ParameterRefs>
            <ParameterCalculations>
              <ParameterCalculation Id="PC-1" Language="JavaScript" Name="DoubleDelay">
                <LRTransformation>OUT = IN * 2;</LRTransformation>
                <LParameters><ParameterRefRef RefId="P-DELAY_R-1" AliasName="IN" /></LParameters>
                <RParameters><ParameterRefRef RefId="P-DOUBLED_R-1" AliasName="OUT" /></RParameters>
              </ParameterCalculation>
            </ParameterCalculations>
            <ComObjectTable>
              <ComObject Id="O-1" Name="ch1.switch" Text="Ch1 Switch" Number="1" FunctionText="On/Off" ObjectSize="1 Bit" ReadFlag="Disabled" WriteFlag="Enabled" CommunicationFlag="Enabled" TransmitFlag="Disabled" UpdateFlag="Disabled" ReadOnInitFlag="Disabled" />
              <ComObject Id="O-2" Name="ch1.status" Text="Ch1 Status" Number="2" FunctionText="On/Off" ObjectSize="1 Bit" ReadFlag="Enabled" WriteFlag="Disabled" CommunicationFlag="Enabled" TransmitFlag="Enabled" UpdateFlag="Disabled" ReadOnInitFlag="Disabled" />
            </ComObjectTable>
            <ComObjectRefs>
              <ComObjectRef Id="O-1_R-1" RefId="O-1" />
              <ComObjectRef Id="O-2_R-1" RefId="O-2" />
            </ComObjectRefs>
            <AddressTable MaxEntries="4095" />
            <AssociationTable MaxEntries="4095" />
            <LoadProcedures>
              <LoadProcedure MergeId="2">
                <LdCtrlRelSegment AppliesTo="full" LsmIdx="4" Size="64" Mode="1" Fill="0" />
                <LdCtrlRelSegment AppliesTo="par" LsmIdx="4" Size="64" Mode="0" Fill="0" />
              </LoadProcedure>
              <LoadProcedure MergeId="4">
                <LdCtrlWriteRelMem AppliesTo="full,par" ObjIdx="4" Offset="0" Size="64" Verify="true" />
              </LoadProcedure>
              <LoadProcedure MergeId="7">
                <LdCtrlLoadImageProp ObjIdx="4" PropId="27" />
              </LoadProcedure>
            </LoadProcedures>
            <Options ParameterByteOrder="LittleEndian" SupportsExtendedMemoryServices="true" SupportsExtendedPropertyServices="true" DownloadInvisibleParameters="Background" />
          </Static>
          <Dynamic>
            <Channel Id="CH-1" Name="Main" Text="Main Channel">
              <ParameterBlock Id="PB-1" Name="Settings" Text="Settings">
                <ParameterSeparator Id="PS-1" Text="Configure channel 1 below." UIHint="Information" />
                <ParameterRefRef RefId="P-EN_R-1" />
                <choose ParamRefId="P-EN_R-1">
                  <when test="0">
                    <ParameterRefRef RefId="UP-OFF_R-1" />
                  </when>
                  <when test="1">
                    <ParameterRefRef RefId="UP-ON_R-1" />
                    <ParameterRefRef RefId="P-DELAY_R-1" />
                    <ParameterRefRef RefId="P-TEMP_R-1" />
                    <ComObjectRefRef RefId="O-1_R-1" />
                    <ComObjectRefRef RefId="O-2_R-1" />
                  </when>
                </choose>
              </ParameterBlock>
            </Channel>
          </Dynamic>
        </ApplicationProgram>
      </ApplicationPrograms>
      <Languages>
        <Language Identifier="en-US">
          <TranslationUnit RefId="M-0071_A-1234-10-ABCD">
            <TranslationElement RefId="M-0071_A-1234-10-ABCD">
              <Translation AttributeName="Name" Text="Synthetic Actuator" />
              <Translation AttributeName="VisibleDescription" Text="Synthetic Secure Actuator" />
            </TranslationElement>
          </TranslationUnit>
        </Language>
        <Language Identifier="es-ES">
          <TranslationUnit RefId="M-0071_A-1234-10-ABCD">
            <TranslationElement RefId="M-0071_A-1234-10-ABCD">
              <Translation AttributeName="Name" Text="Actuador Sintético" />
              <Translation AttributeName="VisibleDescription" Text="Actuador KNX Secure de prueba" />
            </TranslationElement>
            <TranslationElement RefId="CH-1">
              <Translation AttributeName="Text" Text="Canal Principal" />
            </TranslationElement>
            <TranslationElement RefId="PB-1">
              <Translation AttributeName="Text" Text="Configuración" />
            </TranslationElement>
            <TranslationElement RefId="PS-1">
              <Translation AttributeName="Text" Text="Configure el canal 1 abajo." />
            </TranslationElement>
            <TranslationElement RefId="P-EN">
              <Translation AttributeName="Text" Text="Habilitar Canal 1" />
            </TranslationElement>
            <TranslationElement RefId="P-DELAY">
              <Translation AttributeName="Text" Text="Retraso de encendido" />
              <Translation AttributeName="SuffixText" Text="ms" />
            </TranslationElement>
            <TranslationElement RefId="E-NO">
              <Translation AttributeName="Text" Text="Deshabilitado" />
            </TranslationElement>
            <TranslationElement RefId="E-YES">
              <Translation AttributeName="Text" Text="Habilitado" />
            </TranslationElement>
            <TranslationElement RefId="O-1">
              <Translation AttributeName="Text" Text="Canal 1 Conmutación" />
              <Translation AttributeName="FunctionText" Text="Encender/Apagar" />
            </TranslationElement>
            <TranslationElement RefId="O-2">
              <Translation AttributeName="Text" Text="Canal 1 Estado" />
              <Translation AttributeName="FunctionText" Text="Estado On/Off" />
            </TranslationElement>
          </TranslationUnit>
        </Language>
      </Languages>
    </Manufacturer>
  </ManufacturerData>
</KNX>`;

  const syntheticZip = buildZipBuffer({
    "M-0071/M-0071_A-1234-10-ABCD.xml": syntheticAppXml,
  });

  test("ZipReader + KnxProdParser + DynamicEvaluator + SystemBCompiler + Full/Partial/DryRun/Safety Downloads", async () => {
    const zip = ZipReader.fromBuffer(syntheticZip);
    expect(zip.listEntries().map((e) => e.fileName)).toEqual(["M-0071/M-0071_A-1234-10-ABCD.xml"]);

    const parsed = await KnxProdParser.parseBuffer(syntheticZip, {}, "synthetic.knxprod");
    expect(parsed.applications.length).toBe(1);
    const app = parsed.applications[0];
    expect(app.manufacturerId).toBe(0x0071);
    expect(app.applicationNumber).toBe(0x1234);
    expect(app.maskVersion).toBe(0x07b0);

    const config = {
      parameters: {
        "ch1.enable": 1,
        "ch1.delay": 350, // JS ParameterCalculation computes ch1.delayDoubled = 700!
      },
      groupLinks: {
        "ch1.switch": ["1/0/1", "1/0/5"],
        2: "1/0/2",
      },
    };

    const image = SystemBCompiler.compile(app, config);
    const seg4 = image.segments.get(4)!;
    expect(seg4.image.subarray(0, 8).toString("hex").toUpperCase()).toBe("DEADBEEFCAFEBABE");
    expect(seg4.image[16]).toBe(1); // ch1.enable = 1
    expect(seg4.image.readUInt16LE(18)).toBe(350); // LittleEndian uint16
    expect(seg4.image.readUInt16LE(20)).toBe(700); // Computed by JS ParameterCalculation!
    expect(seg4.image.readUInt16LE(22)).toBe(encodeDpt9Word(5.0)); // DPT 9 LE
    expect(seg4.image[24]).toBe(1); // Active Union member UP-ON overwrote default UP-OFF!
    expect(image.expectedProperties).toHaveLength(1);
    expect(image.expectedProperties[0].expectedValue.toString("hex").toUpperCase()).toBe("007100001234");
    expect(image.programVersion.toString("hex").toUpperCase()).toBe("0071123410");

    // Mask==0 gap (offset 8..15) must NOT appear in writable spans
    const spans = SystemBCompiler.extractWritableSpans(seg4, { mode: 1, fill: 0, skipFillRuns: true });
    for (const sp of spans) {
      expect(sp.offset >= 16 || sp.offset + sp.data.length <= 8).toBe(true);
    }

    // 1. Safety guard: wrong HardwareType MUST abort BEFORE unloading or writing!
    const busWrong = new MockKNXBusService("1.1.250");
    const wrongDevice = new MockSystemBDevice({
      individualAddress: "1.1.10",
      manufacturerId: 0x0071,
      hardwareType: Buffer.from("007100009999", "hex"),
    });
    wrongDevice.attach(busWrong);
    const progWrong = new KNXDeviceProgrammer(new KNXManagement(busWrong, { minFrameDelayMs: 0 }));
    await expect(progWrong.download("1.1.10", parsed, config)).rejects.toThrow(/Hardware verification failed/i);
    expect(wrongDevice.writtenRanges.length).toBe(0);
    expect(wrongDevice.loadStates.get(4)).toBe(LoadState.LOADED);

    // 2. Dry-run mode: verifies device and returns full plan without writing anything
    const busDry = new MockKNXBusService("1.1.250");
    const device = new MockSystemBDevice({
      individualAddress: "1.1.10",
      manufacturerId: 0x0071,
      hardwareType: Buffer.from("007100001234", "hex"),
      groatFormat: 0, // Test live Format 0 auto-detection & recompilation!
    });
    device.attach(busDry);
    const programmer = new KNXDeviceProgrammer(new KNXManagement(busDry, { minFrameDelayMs: 0 }));

    const dryRes = await programmer.download("1.1.10", parsed, config, { dryRun: true });
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.bytesWritten).toBe(0);
    expect(dryRes.image.associationTableFormat).toBe(0); // Auto-recompiled from 1 -> 0!
    expect(device.writtenRanges.length).toBe(0);

    // 3. Full download ("ap1") onto simulated MV-07B0 device
    const progressPhases: string[] = [];
    const fullRes = await programmer.download("1.1.10", parsed, config, {
      mode: "ap1",
      onProgress: (ev) => progressPhases.push(ev.phase),
    });

    expect(fullRes.dryRun).toBe(false);
    expect(fullRes.bytesWritten).toBeGreaterThan(0);
    expect(device.restarted).toBe(true);
    expect(device.loadStates.get(1)).toBe(LoadState.LOADED);
    expect(device.loadStates.get(2)).toBe(LoadState.LOADED);
    expect(device.loadStates.get(3)).toBe(LoadState.LOADED);
    expect(device.loadStates.get(4)).toBe(LoadState.LOADED);
    expect(device.programVersion.toString("hex").toUpperCase()).toBe("0071123410");
    // Verify flash content of Objects 1, 2, 3, 4 matches compiled image byte-for-byte!
    expect(device.memory.get(1)!.equals(fullRes.image.groupAddressTable)).toBe(true);
    expect(device.memory.get(2)!.equals(fullRes.image.associationTable)).toBe(true);
    expect(device.memory.get(3)!.equals(fullRes.image.groupObjectTable)).toBe(true);
    expect(device.memory.get(4)!.equals(seg4.image)).toBe(true);
    expect(progressPhases).toContain("verify");
    expect(progressPhases).toContain("write_memory");
    expect(progressPhases).toContain("restart");

    // 4. Partial group-only download ("grp"): does NOT unload Obj 4
    device.restarted = false;
    device.writtenRanges.length = 0;
    const grpRes = await programmer.download(
      "1.1.10",
      parsed,
      { ...config, groupLinks: { 1: "3/0/1" } },
      { mode: "grp" },
    );
    expect(grpRes.mode).toBe("grp");
    expect(device.restarted).toBe(true);
    expect(device.memory.get(1)!.readUInt16BE(0)).toBe(1); // 1 GA: 3/0/1
    expect(device.memory.get(4)!.equals(seg4.image)).toBe(true); // Obj 4 untouched!

    // 5. Unload procedure
    const unloadRes = await programmer.unload("1.1.10", parsed);
    expect(unloadRes.mode).toBe("unload");
    expect(device.loadStates.get(1)).toBe(LoadState.UNLOADED);
    expect(device.loadStates.get(4)).toBe(LoadState.UNLOADED);
  });

  test("Phase 2 KNX Data Secure Commissioning: encrypted full download + Object 17 tables + ToolKey rotation + chunking", async () => {
    const parsed = await KnxProdParser.parseBuffer(syntheticZip, { language: "es-ES" }, "synthetic.knxprod");
    const INITIAL_TOOL_KEY = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const ROTATED_TOOL_KEY = Buffer.from("ffeeddccbbaa99887766554433221100", "hex");
    const GROUP_KEY_1 = Buffer.from("11111111111111111111111111111111", "hex");
    const GROUP_KEY_2 = Buffer.from("22222222222222222222222222222222", "hex");
    const GROUP_KEY_5 = Buffer.from("55555555555555555555555555555555", "hex");
    const P2P_KEY = Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "hex");

    const clientDataSecure = new KnxDataSecure({
      sourceAddress: "1.1.250",
      initialSequenceNumber: 10n,
      deviceToolKeys: { "1.1.15": INITIAL_TOOL_KEY },
    });

    const bus = new MockKNXBusService("1.1.250", clientDataSecure);
    const secureDevice = new MockSystemBDevice({
      individualAddress: "1.1.15",
      manufacturerId: 0x0071,
      hardwareType: Buffer.from("007100001234", "hex"),
      maxApduLength: 254,
      groatFormat: 1,
      dataSecure: {
        toolKey: INITIAL_TOOL_KEY,
        requireSecure: true,
        securityMode: true,
        initialSeqNr: 500n,
      },
    });
    secureDevice.attach(bus);

    const programmer = new KNXDeviceProgrammer(
      new KNXManagement(bus, { minFrameDelayMs: 0, dataSecure: clientDataSecure }),
    );

    // Build configuration using DeviceConfigSession API
    const cfgSession = new DeviceConfigSession(parsed);
    cfgSession.setParameters({ "ch1.enable": 1, "ch1.delay": 350 });
    cfgSession.linkGroupObject(1, { sending: "1/0/1", listening: ["1/0/5"], security: "auth_conf" });
    cfgSession.linkGroupObject(2, { sending: "1/0/2", security: "auth_only" });
    cfgSession.setSecurityConfig({
      enabled: true,
      groupKeys: {
        "1/0/1": GROUP_KEY_1,
        "1/0/2": GROUP_KEY_2,
        "1/0/5": GROUP_KEY_5,
      },
      authorizedSenders: ["1.1.20", { individualAddress: "1.1.5", lastValidSeqNr: 42n }],
      p2pKeys: [{ individualAddress: "1.1.5", key: P2P_KEY, roles: 0x0003 }],
      toolKey: ROTATED_TOOL_KEY,
      initialSequenceNumberSending: 999999n,
    });

    expect(cfgSession.validate().valid).toBe(true);

    // 1. Plain session against a Data Secure device fails with clear 0xFFFF Data Secure hint
    await expect(cfgSession.download(programmer, "1.1.15", { mode: "ap1", dryRun: true })).rejects.toThrow(
      /0xffff.*Data Secure/i,
    );

    // 2. Encrypted full download with tight interfaceMaxApduLength=70 to verify multi-chunk Object 17 + Extended Memory!
    const phases: string[] = [];
    const res = await cfgSession.download(programmer, "1.1.15", {
      mode: "ap1",
      interfaceMaxApduLength: 70,
      sessionOptions: { secure: true },
      onProgress: (ev) => phases.push(ev.phase),
    });

    expect(res.dryRun).toBe(false);
    expect(phases).toContain("security");
    expect(secureDevice.maxObservedApduLength).toBeLessThanOrEqual(70);
    expect(secureDevice.restarted).toBe(true);
    expect(secureDevice.securityLoadState).toBe(LoadState.LOADED);

    // Verify Objects 1..4 flash image
    expect(secureDevice.memory.get(1)!.equals(res.image.groupAddressTable)).toBe(true);
    expect(secureDevice.memory.get(2)!.equals(res.image.associationTable)).toBe(true);
    expect(secureDevice.memory.get(3)!.equals(res.image.groupObjectTable)).toBe(true);
    expect(secureDevice.memory.get(4)!.equals(res.image.segments.get(4)!.image)).toBe(true);

    // Verify Object 17 Security Tables!
    // PID 54 sorted ascending by IA: 1.1.5 (seq 42), 1.1.20 (seq 0)
    expect(secureDevice.securityIaTable).toEqual([
      { individualAddress: "1.1.5", lastValidSeqNr: 42n },
      { individualAddress: "1.1.20", lastValidSeqNr: 0n },
    ]);
    // PID 53 sorted ascending by TSAP (1/0/1 -> 1, 1/0/2 -> 2, 1/0/5 -> 3)
    expect(secureDevice.securityGroupKeyTable.map((e) => e.gaIndex)).toEqual([1, 2, 3]);
    expect(secureDevice.securityGroupKeyTable[0].key.equals(GROUP_KEY_1)).toBe(true);
    expect(secureDevice.securityGroupKeyTable[1].key.equals(GROUP_KEY_2)).toBe(true);
    expect(secureDevice.securityGroupKeyTable[2].key.equals(GROUP_KEY_5)).toBe(true);
    // PID 61 GO Security Flags: GO #1 = 0x03 (auth_conf), GO #2 = 0x01 (auth_only)
    expect(Array.from(secureDevice.securityGoFlags)).toEqual([0x03, 0x01]);
    // PID 52 P2P Key Table: 1.1.5 is iaIndex 1
    expect(secureDevice.securityP2PKeyTable).toHaveLength(1);
    expect(secureDevice.securityP2PKeyTable[0].iaIndex).toBe(1);
    expect(secureDevice.securityP2PKeyTable[0].key.equals(P2P_KEY)).toBe(true);
    expect(secureDevice.securityP2PKeyTable[0].roles).toBe(0x0003);
    // PID 59 & PID 56 ToolKey rotation + local KnxDataSecure sync
    expect(secureDevice.sequenceNumberSending).toBe(999999n);
    expect(secureDevice.toolKey!.equals(ROTATED_TOOL_KEY)).toBe(true);
    expect(clientDataSecure.getDeviceToolKey("1.1.15")!.equals(ROTATED_TOOL_KEY)).toBe(true);
  });

  test("Phase 2 Initial FDSK -> ToolKey Commissioning (commissionSecureDevice per 03_05_03 §1.5.4.4-5)", async () => {
    const FDSK = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    const NEW_TOOL_KEY = Buffer.from("cafebabedeadbeef0011223344556677", "hex");

    const clientSec = new KnxDataSecure({
      sourceAddress: "1.1.250",
      initialSequenceNumber: 5n,
    });
    const bus = new MockKNXBusService("1.1.250", clientSec);
    const factoryDevice = new MockSystemBDevice({
      individualAddress: "1.1.16",
      manufacturerId: 0x0071,
      hardwareType: Buffer.from("007100001234", "hex"),
      dataSecure: {
        toolKey: FDSK,
        requireSecure: true,
        securityMode: false,
        initialSeqNr: 1n,
      },
    });
    factoryDevice.attach(bus);

    const programmer = new KNXDeviceProgrammer(new KNXManagement(bus, { minFrameDelayMs: 0, dataSecure: clientSec }));
    const res = await programmer.commissionSecureDevice("1.1.16", {
      fdsk: FDSK,
      toolKey: NEW_TOOL_KEY,
    });

    expect(res.toolKey.equals(NEW_TOOL_KEY)).toBe(true);
    expect(res.toolKeyHex).toBe(NEW_TOOL_KEY.toString("hex").toUpperCase());
    expect(res.securityModeEnabled).toBe(true);
    expect(res.restarted).toBe(true);
    expect(res.sequenceNumberSending).toBeDefined();
    expect(res.sequenceNumberSending! > 1_000_000_000n).toBe(true);

    expect(factoryDevice.securityMode).toBe(true);
    expect(factoryDevice.toolKey!.equals(NEW_TOOL_KEY)).toBe(true);
    expect(factoryDevice.masterResetEraseCode).toBe(RestartEraseCode.CONFIRMED_RESTART);
    expect(clientSec.getDeviceToolKey("1.1.16")!.equals(NEW_TOOL_KEY)).toBe(true);
  });

  test("DeviceConfigSession External/Web API: translations, UI tree, live diffs, search, validation & JSON round-trip", async () => {
    const parsedEs = await KnxProdParser.parseBuffer(syntheticZip, { language: "es-ES" }, "synthetic.knxprod");
    expect(parsedEs.applications[0].availableLanguages).toEqual(["en-US", "es-ES"]);
    expect(parsedEs.applications[0].loadedLanguage).toBe("es-ES");

    const session = new DeviceConfigSession(parsedEs);

    // 1. Catalog summary & localized Spanish UI tree
    const summary = session.getCatalogSummary();
    expect(summary.name).toBe("Actuador Sintético");
    expect(summary.visibleDescription).toBe("Actuador KNX Secure de prueba");
    expect(summary.availableLanguages).toEqual(["en-US", "es-ES"]);
    expect(summary.isSecureEnabled).toBe(true);

    const initialUi = session.getUiState();
    // Strictly 100% JSON-serializable!
    expect(JSON.parse(JSON.stringify(initialUi))).toEqual(initialUi);
    expect(initialUi.channels).toHaveLength(1);
    expect(initialUi.channels[0].label).toBe("Canal Principal");
    expect(initialUi.channels[0].blocks[0].label).toBe("Configuración");
    expect(initialUi.channels[0].blocks[0].items[0]).toMatchObject({
      kind: "separator",
      text: "Configure el canal 1 abajo.",
      uiHint: "Information",
    });
    // Initially ch1.enable = 0 -> ComObjects 1 & 2 are hidden, Access="None" checkHW is hidden
    expect(initialUi.comObjects).toHaveLength(0);
    expect(initialUi.parameters.some((p) => p.name === "checkHW")).toBe(false);
    const enableParam = initialUi.parameters.find((p) => p.name === "ch1.enable")!;
    expect(enableParam.label).toBe("Habilitar Canal 1");
    expect(enableParam.widget).toBe("select");
    expect(enableParam.options?.map((o) => o.label)).toEqual(["Deshabilitado", "Habilitado"]);

    // 2. Interactive parameter mutation with live <Dynamic> diff!
    const mut = session.setParameter("ch1.enable", 1);
    expect(mut.changed).toBe(true);
    expect(mut.addedParameters).toEqual(expect.arrayContaining(["P-DELAY_R-1", "P-TEMP_R-1", "UP-ON_R-1"]));
    expect(mut.removedParameters).toContain("UP-OFF_R-1");
    expect(mut.addedComObjects).toEqual([1, 2]);
    expect(mut.state.comObjects.map((c) => c.label)).toEqual(["Canal 1 Conmutación", "Canal 1 Estado"]);

    // 3. Search helpers (localized!)
    expect(session.findParameters("retraso").map((p) => p.name)).toEqual(["ch1.delay"]);
    expect(session.findComObjects("estado").map((c) => c.number)).toEqual([2]);

    // 4. Validation catches out-of-range, invalid GA, and missing Group Key
    session.setParameter("ch1.delay", 99999);
    session.linkGroupObject(1, { sending: "99/99/99", security: "auth_conf" });
    const badVal = session.validate();
    expect(badVal.valid).toBe(false);
    expect(badVal.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(["VALUE_ABOVE_MAX", "INVALID_GROUP_ADDRESS"]),
    );

    session.setParameter("ch1.delay", 400);
    session.linkGroupObject(1, { sending: "1/0/1", security: "auth_conf" });
    const missingKeyVal = session.validate();
    expect(missingKeyVal.valid).toBe(false);
    expect(missingKeyVal.errors.map((e) => e.code)).toContain("MISSING_GROUP_KEY");

    session.setSecurityConfig({
      enabled: true,
      groupKeys: { "1/0/1": "11223344556677889900aabbccddeeff" },
      authorizedSenders: ["1.1.2"],
    });
    expect(session.validate().valid).toBe(true);

    // 5. Portable JSON serialization round-trip + includeSecrets: false redaction
    const jsonFull = session.toJSON();
    const jsonRedacted = session.toJSON({ includeSecrets: false });
    expect(jsonFull.security?.groupKeys?.["1/0/1"]).toBe("11223344556677889900AABBCCDDEEFF");
    expect(jsonRedacted.security?.groupKeys).toBeUndefined();

    const restored = DeviceConfigSession.fromJSON(parsedEs, JSON.stringify(jsonFull));
    const imgA = session.compile();
    const imgB = restored.compile();
    expect(imgB.segments.get(4)!.image.equals(imgA.segments.get(4)!.image)).toBe(true);
    expect(imgB.groupAddressTable.equals(imgA.groupAddressTable)).toBe(true);
    expect(imgB.securityImage!.goSecurityFlags.equals(imgA.securityImage!.goSecurityFlags)).toBe(true);
    expect(imgB.securityImage!.groupKeyTable[0].key.equals(imgA.securityImage!.groupKeyTable[0].key)).toBe(true);
  });

  test("DeviceConfigSession autonomous ETS-free workflow: ensureSecurityKeys() + exportToKeyring() -> signed .knxkeys", async () => {
    const parsedEs = await KnxProdParser.parseBuffer(syntheticZip, { language: "es-ES" }, "synthetic.knxprod");
    const session = new DeviceConfigSession(parsedEs);

    // Enable channel 1 -> activates ComObjects #1 (Switch) and #2 (Status)
    session.setParameter("ch1.enable", 1);
    session.linkGroupObject(1, { sending: "1/0/1", security: "auth_conf" });
    session.linkGroupObject(2, { sending: "1/1/1", security: "auth_only" });
    session.setSecurityConfig({
      enabled: true,
      authorizedSenders: ["1.1.200"],
    });

    // Before generating keys, validation reports MISSING_GROUP_KEY on both 1/0/1 and 1/1/1
    const beforeVal = session.validate();
    expect(beforeVal.valid).toBe(false);
    expect(beforeVal.errors.filter((e) => e.code === "MISSING_GROUP_KEY")).toHaveLength(2);

    // Also verify plain objects are NOT given generated keys
    const plainSession = new DeviceConfigSession(parsedEs);
    plainSession.setParameter("ch1.enable", 1);
    plainSession.linkGroupObject(1, { sending: "1/0/1", security: "auth_conf" });
    plainSession.linkGroupObject(2, { sending: "2/0/1", security: "plain" });
    const plainKr = KnxKeyring.create({ project: "MixedMode" });
    const plainEnsured = plainSession.ensureSecurityKeys({ keyring: plainKr });
    expect(Object.keys(plainEnsured.generatedGroupKeys)).toEqual(["1/0/1"]);
    expect(plainKr.getGroupKey("2/0/1")).toBeUndefined();

    // Generate missing keys into a fresh project keyring + generate ToolKey
    const projectKeyring = KnxKeyring.create({ project: "AutonomousProject" });
    const ensured = session.ensureSecurityKeys({
      keyring: projectKeyring,
      generateToolKey: true,
    });

    expect(Object.keys(ensured.generatedGroupKeys).sort()).toEqual(["1/0/1", "1/1/1"]);
    expect(ensured.generatedToolKey).toMatch(/^[0-9A-F]{32}$/);

    // Validation and Object 17 compilation now pass immediately!
    expect(session.validate().valid).toBe(true);
    const compiled = session.compile();
    expect(compiled.securityImage?.groupKeyTable).toHaveLength(2);
    expect(compiled.securityImage?.goSecurityFlags[0]).toBe(0x03); // auth_conf (A+C)
    expect(compiled.securityImage?.goSecurityFlags[1]).toBe(0x01); // auth_only (A)

    // Export device metadata + keys + interface sender bindings into .knxkeys
    session.exportToKeyring({
      keyring: projectKeyring,
      individualAddress: "1.1.1",
      serialNumber: "0071001B7C5D",
      sequenceNumber: 280081013600n,
      interfaceAddress: "1.1.200",
      interfaceType: "Tunnelling",
      interfaceUserId: 2,
      interfacePassword: "TunnelUserPass",
    });

    const knxkeysBuf = projectKeyring.toBuffer("ProjectExportPass123");
    const reloaded = KnxKeyring.fromSource(knxkeysBuf, "ProjectExportPass123");

    expect(reloaded.project).toBe("AutonomousProject");
    expect(reloaded.getGroupKey("1/0/1")?.toString("hex").toUpperCase()).toBe(ensured.generatedGroupKeys["1/0/1"]);
    expect(reloaded.getGroupKey("1/1/1")?.toString("hex").toUpperCase()).toBe(ensured.generatedGroupKeys["1/1/1"]);
    expect(reloaded.getDeviceToolKey("1.1.1")?.toString("hex").toUpperCase()).toBe(ensured.generatedToolKey);
    expect(reloaded.getDevice("1.1.1")?.serialNumber).toBe("0071001B7C5D");
    expect(reloaded.getDevice("1.1.1")?.sequenceNumberBigInt).toBe(280081013600n);
    expect(reloaded.getInterface("1.1.200")?.decryptedPassword).toBe("TunnelUserPass");
    expect(reloaded.getGroupSenders("1/0/1")).toContain("1.1.1");
    expect(reloaded.getGroupSenders("1/1/1")).toContain("1.1.1");
  });
});

// ============================================================================
// 3. Real .knxprod Integration Tests (Runs Automatically When Ignore/ Exists)
// ============================================================================

const IGNORE_DIR = path.resolve(__dirname, "../Ignore");
const MAXINBOX_FILE = path.join(IGNORE_DIR, "[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod");
const RAILQUAD_FILE = path.join(IGNORE_DIR, "[Cert.]_RailQUAD_8_v2_1.3_EIFAItRUk.knxprod");
const CX_FILE = path.join(IGNORE_DIR, "CX_1.2_EIFAItRUk.knxprod");
const SCHNEIDER_FILE = path.join(IGNORE_DIR, "MTN6185-nnnnS_ETS5_ETS6_1842_10_2026_36.knxprod");

const describeReal = fs.existsSync(MAXINBOX_FILE) ? describe : describe.skip;

describeReal("Real .knxprod Catalog Integration Tests (Ignore/*.knxprod)", () => {
  test("Zennio MAXinBOX 66 v3 (64 MB XML): parse, evaluate, compile & full simulated MV-07B0 download", async () => {
    const parsed = await KnxProdParser.parseFile(MAXINBOX_FILE);
    expect(parsed.applications.length).toBe(1);
    const app = parsed.applications[0];
    expect(app.manufacturerId).toBe(0x0071);
    expect(app.applicationNumber).toBe(0x49b1);
    expect(app.applicationVersion).toBe(33);
    expect(app.maskVersion).toBe(0x07b0);
    expect(app.options.parameterByteOrder).toBe("LittleEndian");
    expect(app.options.supportsExtendedMemoryServices).toBe(true);
    expect(parsed.maskVersions.has("MV-07B0")).toBe(true);

    const config = {
      parameters: {
        bOutput: 1,
        "outputCh[0].type": 1,
        "hb.bEnabled": 1,
      },
      groupLinks: {
        1: "0/0/1", // [Heartbeat] Object to Send '1'
      },
    };

    const evaluated = DynamicEvaluator.evaluate(app, config);
    expect(evaluated.activeParameterIds.size).toBeGreaterThan(20);
    expect(evaluated.activeComObjects.has(1)).toBe(true);
    expect(evaluated.activeComObjects.get(1)!.groupAddresses).toEqual(["0/0/1"]);

    const image = SystemBCompiler.compile(app, config, evaluated);
    expect(image.programVersion.toString("hex").toUpperCase()).toBe("007149B121");
    expect(image.groupObjectCount).toBe(1536);
    expect(image.groupObjectTable.length).toBe(2 + 1536 * 2);
    expect(image.groupAddresses).toEqual(["0/0/1"]);
    expect(image.associationTableFormat).toBe(1);
    expect(image.associationCount).toBe(1);
    expect(image.expectedProperties[0]?.expectedValue.toString("hex").toUpperCase()).toBe("0071000049B0");

    const seg4 = image.segments.get(4)!;
    expect(seg4.size).toBe(123848);
    // Verify Mask==0 gap (240..511) is strictly excluded from writable spans
    const spans = SystemBCompiler.extractWritableSpans(seg4, { mode: 1, fill: 0, skipFillRuns: true });
    for (const sp of spans) {
      expect(sp.offset >= 512 || sp.offset + sp.data.length <= 240).toBe(true);
    }

    // Full simulated download onto a Mock Zennio MAXinBOX 66 v3 device
    const bus = new MockKNXBusService("1.1.250");
    const mockMaxInBox = new MockSystemBDevice({
      individualAddress: "1.1.20",
      manufacturerId: 0x0071,
      hardwareType: Buffer.from("0071000049B0", "hex"),
      maxApduLength: 254,
      groatFormat: 1,
    });
    mockMaxInBox.attach(bus);

    const programmer = new KNXDeviceProgrammer(new KNXManagement(bus, { minFrameDelayMs: 0 }));
    const res = await programmer.download("1.1.20", parsed, config, { mode: "ap1" });

    expect(res.dryRun).toBe(false);
    expect(res.bytesWritten).toBeGreaterThan(50000);
    expect(mockMaxInBox.restarted).toBe(true);
    expect(mockMaxInBox.programVersion.toString("hex").toUpperCase()).toBe("007149B121");
    // Verify Extended Frames (FT=0) were used for large A_MemoryExtended_Write frames!
    expect(mockMaxInBox.writtenRanges.some((r) => r.length === 215 && r.extendedFrame)).toBe(true);
    // Verify flash content of Obj 1, 2, 3, and 4 matches compiled image byte-for-byte!
    expect(mockMaxInBox.memory.get(1)!.equals(res.image.groupAddressTable)).toBe(true);
    expect(mockMaxInBox.memory.get(2)!.equals(res.image.associationTable)).toBe(true);
    expect(mockMaxInBox.memory.get(3)!.equals(res.image.groupObjectTable)).toBe(true);
    expect(mockMaxInBox.memory.get(4)!.equals(seg4.image)).toBe(true);
  }, 30000);

  test("Schneider MTN6185 Push-Button Pro T (798B BigEndian + 5x PID_MCB_TABLE): parse, compile & full simulated download", async () => {
    const parsed = await KnxProdParser.parseFile(SCHNEIDER_FILE);
    const app = parsed.applications[0];
    expect(app.manufacturerId).toBe(0x0064);
    expect(app.applicationNumber).toBe(0x1842);
    expect(app.options.parameterByteOrder).toBe("BigEndian");

    const image = SystemBCompiler.compile(app, {});
    expect(image.segments.get(4)!.size).toBe(798);
    const plan = LoadProcedureEngine.buildPlan(app, image, "ap1", { knxProd: parsed });
    const mcbWrites = plan.actions.filter((a) => a.type === "WriteProp" && a.objIdx === 4 && a.propId === 27);
    expect(mcbWrites.length).toBe(5);

    const hwExpected = image.expectedProperties[0]?.expectedValue ?? Buffer.alloc(6);
    const bus = new MockKNXBusService("1.1.250");
    const mockSchneider = new MockSystemBDevice({
      individualAddress: "1.1.30",
      manufacturerId: 0x0064,
      hardwareType: hwExpected,
      maxApduLength: 254,
      groatFormat: 0,
    });
    mockSchneider.attach(bus);

    const programmer = new KNXDeviceProgrammer(new KNXManagement(bus, { minFrameDelayMs: 0 }));
    const res = await programmer.download("1.1.30", parsed, {}, { mode: "ap1" });
    expect(res.dryRun).toBe(false);
    expect(mockSchneider.restarted).toBe(true);
    expect(mockSchneider.memory.get(4)!.equals(image.segments.get(4)!.image)).toBe(true);
    expect(mockSchneider.mcbTables.size).toBe(5);
    expect(mockSchneider.programVersion.toString("hex").toUpperCase()).toBe("0064184210");
  }, 20000);

  test("Zennio RailQUAD 8 v2 & CX 1.2 (with ModuleDef/Repeat/Script): parse, evaluate & compile cleanly", async () => {
    const rq = await KnxProdParser.parseFile(RAILQUAD_FILE);
    const rqApp = rq.applications[0];
    expect(rqApp.applicationNumber).toBe(0x42b1);
    const rqImg = SystemBCompiler.compile(rqApp, {});
    expect(rqImg.segments.get(4)!.size).toBe(70524);
    expect(rqImg.expectedProperties[0]?.expectedValue.toString("hex").toUpperCase()).toBe("0071000042B0");

    const cx = await KnxProdParser.parseFile(CX_FILE);
    const cxApp = cx.applications[0];
    expect(cxApp.applicationNumber).toBe(0x5d21);
    expect(cxApp.moduleDefs.size).toBe(2);
    expect(cxApp.allocators.size).toBe(6);
    expect(cxApp.script).toBeDefined();
    const cxImg = SystemBCompiler.compile(cxApp, {});
    expect(cxImg.segments.get(4)!.size).toBe(504972);
    expect(cxImg.evaluated.allParameters.size).toBeGreaterThanOrEqual(cxApp.parameters.size);
  }, 30000);

  test("Real Zennio MAXinBOX 66 v3 + Spanish (es-ES) + DeviceConfigSession + Real ETS .knxkeys Keyring", async () => {
    const parsedEs = await KnxProdParser.parseFile(MAXINBOX_FILE, { language: "es-ES" });
    const app = parsedEs.applications[0];
    expect(app.availableLanguages).toEqual(expect.arrayContaining(["en-US", "es-ES"]));
    expect(app.loadedLanguage).toBe("es-ES");

    const session = new DeviceConfigSession(parsedEs);
    const summary = session.getCatalogSummary();
    expect(summary.visibleDescription).toMatch(/Actuador multifunci/i);
    expect(summary.isSecureEnabled).toBe(true);

    const uiBefore = session.getUiState();
    expect(uiBefore.channels.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(uiBefore.catalog))).toEqual(uiBefore.catalog);

    // Enable Outputs A1..C6 & Heartbeat interactively -> dynamically reveals channels, params & all 12 output ComObjects!
    const mut = session.setParameters({
      bOutput: 1,
      "outputCh[0].type": 1,
      "outputCh[1].type": 1,
      "outputCh[2].type": 1,
      "indOutput[0].bEnabled": 1,
      "indOutput[1].bEnabled": 1,
      "indOutput[2].bEnabled": 1,
      "indOutput[3].bEnabled": 1,
      "indOutput[4].bEnabled": 1,
      "indOutput[5].bEnabled": 1,
      "hb.bEnabled": 1,
    });
    expect(mut.changed).toBe(true);
    expect(mut.addedParameters.length).toBeGreaterThan(5);
    expect(mut.addedComObjects).toEqual(
      expect.arrayContaining([1, 765, 766, 779, 780, 793, 794, 807, 808, 821, 822, 835, 836]),
    );
    const hbObj = session.getComObject(1);
    expect(hbObj?.label).toMatch(/Objeto para enviar/i);
    expect(session.getComObject(765)?.label).toMatch(/\[S1\]/);
    expect(session.getComObject(779)?.label).toMatch(/\[S2\]/);

    // If real testKey/PRUEBA-ACTUALIZADO.knxkeys exists, verify real keyring -> Object 17 compilation (read-only!)
    const keyringPath = path.resolve(__dirname, "../testKey/PRUEBA-ACTUALIZADO.knxkeys");
    if (fs.existsSync(keyringPath)) {
      const keyring = KnxKeyring.fromSource(keyringPath, "123456789");
      session.linkGroupObject(1, "1/0/1");
      session.setSecurityConfig({ enabled: true, keyring });
      expect(session.validate().valid).toBe(true);

      const { image, plan } = session.planDownload({ mode: "ap1" });
      expect(image.securityImage).toBeDefined();
      expect(image.securityImage!.groupKeyTable).toHaveLength(1);
      expect(image.securityImage!.groupKeyTable[0].gaIndex).toBe(1);
      expect(image.securityImage!.groupKeyTable[0].groupAddress).toBe("1/0/1");
      expect(image.securityImage!.groupKeyTable[0].key.equals(keyring.getGroupKey("1/0/1")!)).toBe(true);
      expect(image.securityImage!.goSecurityFlags[0]).toBe(0x03); // auth_conf
      expect(plan.actions.some((a) => a.type === "ProgramSecurityObject")).toBe(true);
    }
  }, 30000);
});
