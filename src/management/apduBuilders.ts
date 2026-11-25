import { CEMI } from "../core/CEMI";
import { ControlField } from "../core/ControlField";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { APCIEnum } from "../core/enum/APCIEnum";
import { APDU } from "../core/layers/data/APDU";
import { TPDU } from "../core/layers/data/TPDU";
import { APCI } from "../core/layers/interfaces/APCI";
import { TPCI, TPCIType } from "../core/layers/interfaces/TPCI";
import { KNXHelper } from "../utils/KNXHelper";

/**
 * Standard ControlField1 for KNX Management frames:
 * Standard frame (bit 7 = 1), Do not repeat = 1 (bit 5 = 1), Broadcast = normal (bit 4 = 1), Priority = SYSTEM (bits 3..2 = 00) -> 0xB0.
 */
export const MGMT_CF1_INDIVIDUAL = 0xb0;

/**
 * Standard ControlField1 for KNX System Broadcast Management frames:
 * Standard frame (bit 7 = 1), Do not repeat = 1 (bit 5 = 1), Broadcast = system (bit 4 = 0), Priority = SYSTEM (bits 3..2 = 00) -> 0xA0.
 */
export const MGMT_CF1_SYSTEM_BROADCAST = 0xa0;

/**
 * ExtendedControlField for point-to-point individual addressing (DAF = 0, HopCount = 6) -> 0x60.
 */
export const MGMT_CF2_INDIVIDUAL = 0x60;

/**
 * ExtendedControlField for broadcast management addressing (DAF = 1, HopCount = 6) -> 0xE0.
 */
export const MGMT_CF2_BROADCAST = 0xe0;

/**
 * Standard Return Codes for KNX Application Layer Management services (03_03_07 §3.4.5.5, §3.4.8.3, §3.4.9).
 */
export enum ManagementReturnCode {
  E_SUCCESS = 0x00,
  E_SUCCESS_WITH_CRC = 0x01,
  E_MEMORY_ERROR = 0xf1,
  E_COMMAND_INVALID = 0xf2,
  E_COMMAND_IMPOSSIBLE = 0xf3,
  E_LENGTH_EXCEEDS_MAX_APDU_LENGTH = 0xf4,
  E_DATA_OVERFLOW = 0xf5,
  E_DATA_MIN = 0xf6,
  E_DATA_MAX = 0xf7,
  E_DATA_VOID = 0xf8,
  E_TEMPORARILY_NOT_AVAILABLE = 0xf9,
  E_ACCESS_WRITE_ONLY = 0xfa,
  E_ACCESS_READ_ONLY = 0xfb,
  E_ACCESS_DENIED = 0xfc,
  E_ADDRESS_VOID = 0xfd,
  E_DATA_TYPE_CONFLICT = 0xfe,
  E_ERROR = 0xff,
}

/**
 * Master Reset Erase Codes for `A_Restart` (`restart_type = 1`, 03_05_02 §3.7.1.2.3 Table 4).
 */
export enum RestartEraseCode {
  CONFIRMED_RESTART = 0x01,
  FACTORY_RESET = 0x02,
  RESET_IA = 0x03,
  RESET_AP = 0x04,
  RESET_PARAM = 0x05,
  RESET_LINKS = 0x06,
  FACTORY_RESET_WITHOUT_IA = 0x07,
  ERASE_PERSISTENT_APP_DATA = 0x08,
}

function makeTpciConnected(seq: number): TPCI {
  const tpci = new TPCI(TPCIType.T_DATA_CONNECTED_PDU);
  tpci.sequenceNumber = seq & 0x0f;
  return tpci;
}

function makeTpciControl(
  type: TPCIType.T_CONNECT_PDU | TPCIType.T_DISCONNECT_PDU | TPCIType.T_ACK_PDU | TPCIType.T_NAK_PDU,
  seq: number = 0,
): TPCI {
  const raw = type === TPCIType.T_ACK_PDU || type === TPCIType.T_NAK_PDU ? (type & 0xc3) | ((seq & 0x0f) << 2) : type;
  return new TPCI(raw as TPCIType);
}

export function buildTConnectReq(sourceAddress: string, destinationAddress: string) {
  const cf1 = new ControlField(MGMT_CF1_INDIVIDUAL);
  const cf2 = new ExtendedControlField(MGMT_CF2_INDIVIDUAL);
  const tpci = makeTpciControl(TPCIType.T_CONNECT_PDU);
  const apdu = new APDU(tpci, new APCI(0), Buffer.alloc(0), false);
  const tpdu = new TPDU(tpci, apdu, Buffer.alloc(0));
  return new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, sourceAddress, destinationAddress, tpdu);
}

export function buildTDisconnectReq(sourceAddress: string, destinationAddress: string) {
  const cf1 = new ControlField(MGMT_CF1_INDIVIDUAL);
  const cf2 = new ExtendedControlField(MGMT_CF2_INDIVIDUAL);
  const tpci = makeTpciControl(TPCIType.T_DISCONNECT_PDU);
  const apdu = new APDU(tpci, new APCI(0), Buffer.alloc(0), false);
  const tpdu = new TPDU(tpci, apdu, Buffer.alloc(0));
  return new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, sourceAddress, destinationAddress, tpdu);
}

export function buildTAckReq(sourceAddress: string, destinationAddress: string, sequenceNumber: number) {
  const cf1 = new ControlField(MGMT_CF1_INDIVIDUAL);
  const cf2 = new ExtendedControlField(MGMT_CF2_INDIVIDUAL);
  const tpci = makeTpciControl(TPCIType.T_ACK_PDU, sequenceNumber);
  const apdu = new APDU(tpci, new APCI(0), Buffer.alloc(0), false);
  const tpdu = new TPDU(tpci, apdu, Buffer.alloc(0));
  return new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, sourceAddress, destinationAddress, tpdu);
}

export function buildTNakReq(sourceAddress: string, destinationAddress: string, sequenceNumber: number) {
  const cf1 = new ControlField(MGMT_CF1_INDIVIDUAL);
  const cf2 = new ExtendedControlField(MGMT_CF2_INDIVIDUAL);
  const tpci = makeTpciControl(TPCIType.T_NAK_PDU, sequenceNumber);
  const apdu = new APDU(tpci, new APCI(0), Buffer.alloc(0), false);
  const tpdu = new TPDU(tpci, apdu, Buffer.alloc(0));
  return new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, sourceAddress, destinationAddress, tpdu);
}

export function buildConnectedLDataReq(
  sourceAddress: string,
  destinationAddress: string,
  sequenceNumber: number,
  apciCommand: APCIEnum | number,
  data: Buffer,
  isShort: boolean = false,
) {
  const cf1 = new ControlField(MGMT_CF1_INDIVIDUAL);
  const cf2 = new ExtendedControlField(MGMT_CF2_INDIVIDUAL);
  const tpci = makeTpciConnected(sequenceNumber);
  const apdu = new APDU(makeTpciConnected(sequenceNumber), new APCI(apciCommand as APCIEnum), data, isShort);
  if (apdu.length > 15) {
    // KNX 03_03_02 §2.2: frames with NPDU/APDU length > 15 octets MUST use Extended Frame format (FT = 0).
    cf1.frameType = false;
  }
  const tpdu = new TPDU(tpci, apdu, data);
  return new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, sourceAddress, destinationAddress, tpdu);
}

export function buildIndividualLDataReq(
  sourceAddress: string,
  destinationAddress: string,
  apciCommand: APCIEnum | number,
  data: Buffer,
  isShort: boolean = false,
) {
  const cf1 = new ControlField(MGMT_CF1_INDIVIDUAL);
  const cf2 = new ExtendedControlField(MGMT_CF2_INDIVIDUAL);
  const tpci = new TPCI(TPCIType.T_DATA_INDIVIDUAL_PDU);
  const apdu = new APDU(new TPCI(TPCIType.T_DATA_INDIVIDUAL_PDU), new APCI(apciCommand as APCIEnum), data, isShort);
  if (apdu.length > 15) {
    cf1.frameType = false;
  }
  const tpdu = new TPDU(tpci, apdu, data);
  return new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, sourceAddress, destinationAddress, tpdu);
}

export function buildBroadcastLDataReq(
  sourceAddress: string,
  apciCommand: APCIEnum | number,
  data: Buffer,
  isShort: boolean = false,
) {
  const cf1 = new ControlField(MGMT_CF1_INDIVIDUAL);
  const cf2 = new ExtendedControlField(MGMT_CF2_BROADCAST);
  const tpci = new TPCI(TPCIType.T_DATA_BROADCAST_PDU);
  const apdu = new APDU(new TPCI(TPCIType.T_DATA_BROADCAST_PDU), new APCI(apciCommand as APCIEnum), data, isShort);
  if (apdu.length > 15) {
    cf1.frameType = false;
  }
  const tpdu = new TPDU(tpci, apdu, data);
  return new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, sourceAddress, "0/0/0", tpdu);
}

export function buildSystemBroadcastLDataReq(
  sourceAddress: string,
  apciCommand: APCIEnum | number,
  data: Buffer,
  isShort: boolean = false,
) {
  const cf1 = new ControlField(MGMT_CF1_SYSTEM_BROADCAST);
  const cf2 = new ExtendedControlField(MGMT_CF2_BROADCAST);
  const tpci = new TPCI(TPCIType.T_DATA_BROADCAST_PDU);
  const apdu = new APDU(new TPCI(TPCIType.T_DATA_BROADCAST_PDU), new APCI(apciCommand as APCIEnum), data, isShort);
  if (apdu.length > 15) {
    cf1.frameType = false;
  }
  const tpdu = new TPDU(tpci, apdu, data);
  return new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, sourceAddress, "0/0/0", tpdu);
}

// ============================================================================
// 1. Device Descriptor & Restart Services (03_03_07 §3.4.2)
// ============================================================================

export function createDeviceDescriptorReadApdu(
  descriptorType: number = 0,
  sequenceNumber?: number,
): {
  apci: APCIEnum;
  data: Buffer;
  isShort: boolean;
  sequenceNumber?: number;
} {
  return {
    apci: APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit,
    data: Buffer.from([descriptorType & 0x3f]),
    isShort: true,
    sequenceNumber,
  };
}

/**
 * Builds Basic A_Restart (0x0380 with restart_type = 0) over a connected channel (03_03_07 §3.4.2.2 Fig. 39).
 */
export function buildBasicRestartConnectedReq(
  sourceAddress: string,
  destinationAddress: string,
  sequenceNumber: number,
) {
  return buildConnectedLDataReq(
    sourceAddress,
    destinationAddress,
    sequenceNumber,
    APCIEnum.A_Restart_Protocol_Data_Unit,
    Buffer.from([0x00]),
    true,
  );
}

/**
 * Builds Basic A_Restart (0x0380 with restart_type = 0) over a connectionless individual frame.
 */
export function buildBasicRestartIndividualReq(sourceAddress: string, destinationAddress: string) {
  return buildIndividualLDataReq(
    sourceAddress,
    destinationAddress,
    APCIEnum.A_Restart_Protocol_Data_Unit,
    Buffer.from([0x00]),
    true,
  );
}

/**
 * Encodes Master Reset A_Restart request (`0x0380 | 0x01 = 0x0381`, `eraseCode`, `channelNumber`, 03_03_07 §3.4.2.2 Fig. 40).
 */
export function encodeMasterResetApdu(
  eraseCode: RestartEraseCode | number,
  channelNumber: number = 0x00,
): { apci: APCIEnum; data: Buffer; isShort: boolean } {
  return {
    apci: (APCIEnum.A_Restart_Protocol_Data_Unit | 0x01) as APCIEnum,
    data: Buffer.from([eraseCode & 0xff, channelNumber & 0xff]),
    isShort: false,
  };
}

export interface DecodedMasterResetResponse {
  errorCode: number;
  processTimeSeconds: number;
}

/**
 * Decodes `A_Restart_Response` (`0x03A1`, 03_03_07 §3.4.2.2 Fig. 41).
 */
export function decodeMasterResetResponse(apdu: APDU): DecodedMasterResetResponse {
  if (apdu.data.length < 1) {
    throw new Error(`A_Restart_Response payload too short: ${apdu.data.length}`);
  }
  const errorCode = apdu.data.readUInt8(0);
  const processTimeSeconds = apdu.data.length >= 3 ? apdu.data.readUInt16BE(1) : 0;
  return { errorCode, processTimeSeconds };
}

// ============================================================================
// 2. Interface Object Property & Function Property Services (03_03_07 §3.4.3–3.4.8)
// ============================================================================

export interface PropertyValueReadParams {
  objectIndex: number;
  propertyId: number;
  count?: number;
  startIndex?: number;
}

export function encodePropertyValueReadData(params: PropertyValueReadParams): Buffer {
  const count = (params.count ?? 1) & 0x0f;
  const startIndex = (params.startIndex ?? 1) & 0x0fff;
  const buf = Buffer.alloc(4);
  buf.writeUInt8(params.objectIndex & 0xff, 0);
  buf.writeUInt8(params.propertyId & 0xff, 1);
  buf.writeUInt8((count << 4) | ((startIndex >> 8) & 0x0f), 2);
  buf.writeUInt8(startIndex & 0xff, 3);
  return buf;
}

export interface PropertyValueWriteParams {
  objectIndex: number;
  propertyId: number;
  count?: number;
  startIndex?: number;
  data: Buffer;
}

export function encodePropertyValueWriteData(params: PropertyValueWriteParams): Buffer {
  const header = encodePropertyValueReadData({
    objectIndex: params.objectIndex,
    propertyId: params.propertyId,
    count: params.count ?? 1,
    startIndex: params.startIndex ?? 1,
  });
  return Buffer.concat([header, params.data]);
}

export interface DecodedPropertyValueResponse {
  objectIndex: number;
  propertyId: number;
  count: number;
  startIndex: number;
  data: Buffer;
}

export function decodePropertyValueResponseData(payload: Buffer): DecodedPropertyValueResponse {
  if (payload.length < 4) {
    throw new Error(`A_PropertyValue_Response payload too short: ${payload.length}`);
  }
  const objectIndex = payload.readUInt8(0);
  const propertyId = payload.readUInt8(1);
  const count = (payload.readUInt8(2) >> 4) & 0x0f;
  const startIndex = ((payload.readUInt8(2) & 0x0f) << 8) | payload.readUInt8(3);
  const data = Buffer.from(payload.subarray(4));
  return { objectIndex, propertyId, count, startIndex, data };
}

export interface PropertyDescriptionReadParams {
  objectIndex: number;
  propertyId?: number;
  propertyIndex?: number;
}

export function encodePropertyDescriptionReadData(params: PropertyDescriptionReadParams): Buffer {
  const buf = Buffer.alloc(3);
  buf.writeUInt8(params.objectIndex & 0xff, 0);
  buf.writeUInt8((params.propertyId ?? 0) & 0xff, 1);
  buf.writeUInt8((params.propertyIndex ?? 0) & 0xff, 2);
  return buf;
}

export interface DecodedPropertyDescriptionResponse {
  objectIndex: number;
  propertyId: number;
  propertyIndex: number;
  writeEnabled: boolean;
  pdt: number;
  maxElements: number;
  readAccessLevel: number;
  writeAccessLevel: number;
}

export function decodePropertyDescriptionResponseData(payload: Buffer): DecodedPropertyDescriptionResponse {
  if (payload.length < 7) {
    throw new Error(`A_PropertyDescription_Response payload too short: ${payload.length}`);
  }
  const objectIndex = payload.readUInt8(0);
  const propertyId = payload.readUInt8(1);
  const propertyIndex = payload.readUInt8(2);
  const typeByte = payload.readUInt8(3);
  const writeEnabled = (typeByte & 0x80) !== 0;
  const pdt = typeByte & 0x3f;
  const maxElements = payload.readUInt16BE(4) & 0x0fff;
  const accessByte = payload.readUInt8(6);
  const readAccessLevel = (accessByte >> 4) & 0x0f;
  const writeAccessLevel = accessByte & 0x0f;
  return {
    objectIndex,
    propertyId,
    propertyIndex,
    writeEnabled,
    pdt,
    maxElements,
    readAccessLevel,
    writeAccessLevel,
  };
}

export interface FunctionPropertyParams {
  objectIndex: number;
  propertyId: number;
  data?: Buffer;
}

export function encodeFunctionPropertyRequestData(params: FunctionPropertyParams): Buffer {
  const header = Buffer.from([params.objectIndex & 0xff, params.propertyId & 0xff]);
  return params.data && params.data.length > 0 ? Buffer.concat([header, params.data]) : header;
}

export interface DecodedFunctionPropertyResponse {
  objectIndex: number;
  propertyId: number;
  returnCode: number | undefined;
  data: Buffer;
}

export function decodeFunctionPropertyResponseData(payload: Buffer): DecodedFunctionPropertyResponse {
  if (payload.length < 2) {
    throw new Error(`A_FunctionPropertyState_Response payload too short: ${payload.length}`);
  }
  const objectIndex = payload.readUInt8(0);
  const propertyId = payload.readUInt8(1);
  const returnCode = payload.length >= 3 ? payload.readUInt8(2) : undefined;
  const data = payload.length > 3 ? Buffer.from(payload.subarray(3)) : Buffer.alloc(0);
  return { objectIndex, propertyId, returnCode, data };
}

// --- Extended Property & Function Property Services (03_03_07 §3.4.3.2, §3.4.5, §3.4.8) ---

export function encodeExtObjectHeader(objectType: number, objectInstance: number, propertyId: number): Buffer {
  const buf = Buffer.alloc(5);
  buf.writeUInt16BE(objectType & 0xffff, 0);
  buf.writeUInt8((objectInstance >> 4) & 0xff, 2);
  buf.writeUInt8(((objectInstance & 0x0f) << 4) | ((propertyId >> 8) & 0x0f), 3);
  buf.writeUInt8(propertyId & 0xff, 4);
  return buf;
}

export function decodeExtObjectHeader(payload: Buffer): {
  objectType: number;
  objectInstance: number;
  propertyId: number;
} {
  const objectType = payload.readUInt16BE(0);
  const objectInstance = (payload.readUInt8(2) << 4) | ((payload.readUInt8(3) >> 4) & 0x0f);
  const propertyId = ((payload.readUInt8(3) & 0x0f) << 8) | payload.readUInt8(4);
  return { objectType, objectInstance, propertyId };
}

export interface PropertyExtValueReadParams {
  objectType: number;
  objectInstance?: number;
  propertyId: number;
  count?: number;
  startIndex?: number;
}

export function encodePropertyExtValueReadData(params: PropertyExtValueReadParams): Buffer {
  const header = encodeExtObjectHeader(params.objectType, params.objectInstance ?? 1, params.propertyId);
  const tail = Buffer.alloc(3);
  tail.writeUInt8((params.count ?? 1) & 0xff, 0);
  tail.writeUInt16BE((params.startIndex ?? 1) & 0x0fff, 1);
  return Buffer.concat([header, tail]);
}

export interface PropertyExtValueWriteParams extends PropertyExtValueReadParams {
  data: Buffer;
}

export function encodePropertyExtValueWriteData(params: PropertyExtValueWriteParams): Buffer {
  return Buffer.concat([encodePropertyExtValueReadData(params), params.data]);
}

export interface DecodedPropertyExtValueResponse {
  objectType: number;
  objectInstance: number;
  propertyId: number;
  count: number;
  startIndex: number;
  data: Buffer;
  returnCode?: number;
}

export function decodePropertyExtValueResponseData(payload: Buffer): DecodedPropertyExtValueResponse {
  if (payload.length < 8) {
    throw new Error(`A_PropertyExtValue_Response payload too short: ${payload.length}`);
  }
  const { objectType, objectInstance, propertyId } = decodeExtObjectHeader(payload);
  const count = payload.readUInt8(5);
  const startIndex = payload.readUInt16BE(6) & 0x0fff;
  const data = Buffer.from(payload.subarray(8));
  const returnCode = count === 0 && data.length >= 1 ? data.readUInt8(0) : undefined;
  return { objectType, objectInstance, propertyId, count, startIndex, data, returnCode };
}

export function decodePropertyExtWriteConResData(payload: Buffer): {
  objectType: number;
  objectInstance: number;
  propertyId: number;
  count: number;
  startIndex: number;
  returnCode: number;
} {
  if (payload.length < 9) {
    throw new Error(`A_PropertyExtValue_WriteConRes payload too short: ${payload.length}`);
  }
  const { objectType, objectInstance, propertyId } = decodeExtObjectHeader(payload);
  const count = payload.readUInt8(5);
  const startIndex = payload.readUInt16BE(6) & 0x0fff;
  const returnCode = payload.readUInt8(8);
  return { objectType, objectInstance, propertyId, count, startIndex, returnCode };
}

export interface PropertyExtDescriptionReadParams {
  objectType: number;
  objectInstance?: number;
  propertyId?: number;
  propertyIndex?: number;
  descriptionType?: number;
}

export function encodePropertyExtDescriptionReadData(params: PropertyExtDescriptionReadParams): Buffer {
  const header = encodeExtObjectHeader(params.objectType, params.objectInstance ?? 1, params.propertyId ?? 0);
  const tail = Buffer.alloc(2);
  const descType = (params.descriptionType ?? 0) & 0x0f;
  const propIdx = (params.propertyIndex ?? 0) & 0x0fff;
  tail.writeUInt16BE((descType << 12) | propIdx, 0);
  return Buffer.concat([header, tail]);
}

export interface DecodedPropertyExtDescriptionResponse {
  objectType: number;
  objectInstance: number;
  propertyId: number;
  descriptionType: number;
  propertyIndex: number;
  dptMain: number;
  dptSub: number;
  writeEnabled: boolean;
  pdt: number;
  maxElements: number;
  readAccessLevel: number;
  writeAccessLevel: number;
}

export function decodePropertyExtDescriptionResponseData(payload: Buffer): DecodedPropertyExtDescriptionResponse {
  if (payload.length < 15) {
    throw new Error(`A_PropertyExtDescription_Response payload too short: ${payload.length}`);
  }
  const { objectType, objectInstance, propertyId } = decodeExtObjectHeader(payload);
  const descAndIdx = payload.readUInt16BE(5);
  const descriptionType = (descAndIdx >> 12) & 0x0f;
  const propertyIndex = descAndIdx & 0x0fff;
  const dptMain = payload.readUInt16BE(7);
  const dptSub = payload.readUInt16BE(9);
  const typeByte = payload.readUInt8(11);
  const writeEnabled = (typeByte & 0x80) !== 0;
  const pdt = typeByte & 0x3f;
  const maxElements = payload.readUInt16BE(12) & 0x0fff;
  const accessByte = payload.readUInt8(14);
  const readAccessLevel = (accessByte >> 4) & 0x0f;
  const writeAccessLevel = accessByte & 0x0f;
  return {
    objectType,
    objectInstance,
    propertyId,
    descriptionType,
    propertyIndex,
    dptMain,
    dptSub,
    writeEnabled,
    pdt,
    maxElements,
    readAccessLevel,
    writeAccessLevel,
  };
}

export interface FunctionPropertyExtParams {
  objectType: number;
  objectInstance?: number;
  propertyId: number;
  data?: Buffer;
}

export function encodeFunctionPropertyExtRequestData(params: FunctionPropertyExtParams): Buffer {
  const header = encodeExtObjectHeader(params.objectType, params.objectInstance ?? 1, params.propertyId);
  return params.data && params.data.length > 0 ? Buffer.concat([header, params.data]) : header;
}

export interface DecodedFunctionPropertyExtResponse {
  objectType: number;
  objectInstance: number;
  propertyId: number;
  returnCode: number;
  data: Buffer;
}

export function decodeFunctionPropertyExtResponseData(payload: Buffer): DecodedFunctionPropertyExtResponse {
  if (payload.length < 6) {
    throw new Error(`A_FunctionPropertyExtState_Response payload too short: ${payload.length}`);
  }
  const { objectType, objectInstance, propertyId } = decodeExtObjectHeader(payload);
  const returnCode = payload.readUInt8(5);
  const data = payload.length > 6 ? Buffer.from(payload.subarray(6)) : Buffer.alloc(0);
  return { objectType, objectInstance, propertyId, returnCode, data };
}

// ============================================================================
// 3. Memory, UserMemory, ExtendedMemory, BitWrite & ADC (03_03_07 §3.4.9, §3.5)
// ============================================================================

export function encodeMemoryReadApdu(
  memoryAddress: number,
  length: number,
): { apci: APCIEnum; data: Buffer; isShort: boolean } {
  if (length < 1 || length > 63) {
    throw new Error(`Invalid A_Memory_Read length ${length} (expected 1..63)`);
  }
  const addrBuf = Buffer.alloc(2);
  addrBuf.writeUInt16BE(memoryAddress & 0xffff, 0);
  return {
    apci: (APCIEnum.A_Memory_Read_Protocol_Data_Unit | (length & 0x3f)) as APCIEnum,
    data: addrBuf,
    isShort: false,
  };
}

export function encodeMemoryWriteApdu(
  memoryAddress: number,
  data: Buffer,
): { apci: APCIEnum; data: Buffer; isShort: boolean } {
  if (data.length < 1 || data.length > 63) {
    throw new Error(`Invalid A_Memory_Write length ${data.length} (expected 1..63)`);
  }
  const payload = Buffer.alloc(2 + data.length);
  payload.writeUInt16BE(memoryAddress & 0xffff, 0);
  data.copy(payload, 2);
  return {
    apci: (APCIEnum.A_Memory_Write_Protocol_Data_Unit | (data.length & 0x3f)) as APCIEnum,
    data: payload,
    isShort: false,
  };
}

export interface DecodedMemoryResponse {
  length: number;
  memoryAddress: number;
  data: Buffer;
}

export function decodeMemoryResponseApdu(apdu: APDU): DecodedMemoryResponse {
  if (apdu.data.length < 2) {
    throw new Error(`A_Memory_Response payload too short: ${apdu.data.length}`);
  }
  const length = apdu.apci.value & 0x3f;
  const memoryAddress = apdu.data.readUInt16BE(0);
  const data = Buffer.from(apdu.data.subarray(2));
  return { length, memoryAddress, data };
}

export function encodeMemoryBitWriteData(memoryAddress: number, andData: Buffer, xorData: Buffer): Buffer {
  if (andData.length !== xorData.length || andData.length < 1 || andData.length > 5) {
    throw new Error(`Invalid A_MemoryBit_Write mask length ${andData.length} (expected 1..5 matching bytes)`);
  }
  const header = Buffer.alloc(3);
  header.writeUInt8(andData.length & 0xff, 0);
  header.writeUInt16BE(memoryAddress & 0xffff, 1);
  return Buffer.concat([header, andData, xorData]);
}

export function encodeUserMemoryReadData(memoryAddress20: number, length: number): Buffer {
  if (length < 1 || length > 15) {
    throw new Error(`Invalid A_UserMemory_Read length ${length} (expected 1..15)`);
  }
  const addrExt = (memoryAddress20 >> 16) & 0x0f;
  const buf = Buffer.alloc(3);
  buf.writeUInt8((addrExt << 4) | (length & 0x0f), 0);
  buf.writeUInt16BE(memoryAddress20 & 0xffff, 1);
  return buf;
}

export function encodeUserMemoryWriteData(memoryAddress20: number, data: Buffer): Buffer {
  if (data.length < 1 || data.length > 15) {
    throw new Error(`Invalid A_UserMemory_Write length ${data.length} (expected 1..15)`);
  }
  return Buffer.concat([encodeUserMemoryReadData(memoryAddress20, data.length), data]);
}

export interface DecodedUserMemoryResponse {
  length: number;
  memoryAddress: number;
  data: Buffer;
}

export function decodeUserMemoryResponseData(payload: Buffer): DecodedUserMemoryResponse {
  if (payload.length < 3) {
    throw new Error(`A_UserMemory_Response payload too short: ${payload.length}`);
  }
  const extAndLen = payload.readUInt8(0);
  const addrExt = (extAndLen >> 4) & 0x0f;
  const length = extAndLen & 0x0f;
  const addrLow = payload.readUInt16BE(1);
  const memoryAddress = (addrExt << 16) | addrLow;
  const data = Buffer.from(payload.subarray(3));
  return { length, memoryAddress, data };
}

export function encodeMemoryExtendedReadData(memoryAddress24: number, length: number): Buffer {
  if (length < 1 || length > 250) {
    throw new Error(`Invalid A_MemoryExtended_Read length ${length} (expected 1..250)`);
  }
  const buf = Buffer.alloc(4);
  buf.writeUInt8(length & 0xff, 0);
  buf.writeUInt8((memoryAddress24 >> 16) & 0xff, 1);
  buf.writeUInt16BE(memoryAddress24 & 0xffff, 2);
  return buf;
}

export function encodeMemoryExtendedWriteData(memoryAddress24: number, data: Buffer): Buffer {
  if (data.length < 1 || data.length > 250) {
    throw new Error(`Invalid A_MemoryExtended_Write length ${data.length} (expected 1..250)`);
  }
  return Buffer.concat([encodeMemoryExtendedReadData(memoryAddress24, data.length), data]);
}

export interface DecodedMemoryExtendedResponse {
  returnCode: ManagementReturnCode;
  memoryAddress: number;
  data: Buffer;
}

export function decodeMemoryExtendedResponseData(payload: Buffer): DecodedMemoryExtendedResponse {
  if (payload.length < 4) {
    throw new Error(`A_MemoryExtended_Response payload too short: ${payload.length}`);
  }
  const returnCode = payload.readUInt8(0) as ManagementReturnCode;
  const memoryAddress = (payload.readUInt8(1) << 16) | payload.readUInt16BE(2);
  const data = Buffer.from(payload.subarray(4));
  return { returnCode, memoryAddress, data };
}

export function encodeAdcReadApdu(
  channelNr: number,
  readCount: number = 1,
): { apci: APCIEnum; data: Buffer; isShort: boolean } {
  return {
    apci: (APCIEnum.A_Analog_to_Digital_Converter_Read_Protocol_Data_Unit | (channelNr & 0x3f)) as APCIEnum,
    data: Buffer.from([readCount & 0xff]),
    isShort: false,
  };
}

export function decodeAdcResponseApdu(apdu: APDU): { channelNr: number; readCount: number; sum: number } {
  if (apdu.data.length < 3) {
    throw new Error(`A_ADC_Response payload too short: ${apdu.data.length}`);
  }
  const channelNr = apdu.apci.value & 0x3f;
  const readCount = apdu.data.readUInt8(0);
  const sum = apdu.data.readUInt16BE(1);
  return { channelNr, readCount, sum };
}

// ============================================================================
// 4. Authorization, Keys & Group Object Link Services (03_03_07 §3.4.6, §3.5.7–8)
// ============================================================================

export function normalizeAuthKey(key: number | Buffer): Buffer {
  if (typeof key === "number") {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(key >>> 0, 0);
    return buf;
  }
  if (key.length !== 4) {
    throw new Error(`Invalid KNX authorization key length: ${key.length} (expected 4 bytes)`);
  }
  return Buffer.from(key);
}

/**
 * Encodes `A_Authorize_Request` (`0x03D1`, 03_03_07 §3.5.7 Fig. 86):
 * Octet 8 = 0x00 (must be 0), Octet 9..12 = 4-byte key.
 */
export function encodeAuthorizeRequestData(key: number | Buffer = 0xffffffff): Buffer {
  return Buffer.concat([Buffer.from([0x00]), normalizeAuthKey(key)]);
}

export function decodeAuthorizeResponseData(payload: Buffer): number {
  if (payload.length < 1) {
    throw new Error("A_Authorize_Response payload is empty");
  }
  return payload.readUInt8(0);
}

/**
 * Encodes `A_Key_Write` (`0x03D3`, 03_03_07 §3.5.8 Fig. 89):
 * Octet 8 = level (1 byte), Octet 9..12 = 4-byte key.
 */
export function encodeKeyWriteData(level: number, key: number | Buffer): Buffer {
  return Buffer.concat([Buffer.from([level & 0xff]), normalizeAuthKey(key)]);
}

export function decodeKeyResponseData(payload: Buffer): number {
  if (payload.length < 1) {
    throw new Error("A_Key_Response payload is empty");
  }
  return payload.readUInt8(0);
}

export function encodeLinkReadData(groupObjectNumber: number, startIndex: number = 1): Buffer {
  return Buffer.from([groupObjectNumber & 0xff, startIndex & 0x0f]);
}

export function encodeLinkWriteData(
  groupObjectNumber: number,
  groupAddress: string,
  options: { delete?: boolean; sending?: boolean } = {},
): Buffer {
  if (!KNXHelper.isValidGroupAddress(groupAddress)) {
    throw new Error(`Invalid KNX Group Address: ${groupAddress}`);
  }
  const flags = (options.delete ? 0x02 : 0x00) | (!options.delete && options.sending ? 0x01 : 0x00);
  const gaBuf = KNXHelper.GetAddress(groupAddress, "/");
  return Buffer.concat([Buffer.from([groupObjectNumber & 0xff, flags]), gaBuf]);
}

export interface DecodedLinkResponse {
  groupObjectNumber: number;
  sendingAddressIndex: number;
  startIndex: number;
  groupAddresses: string[];
}

export function decodeLinkResponseData(payload: Buffer): DecodedLinkResponse {
  if (payload.length < 2) {
    throw new Error(`A_Link_Response payload too short: ${payload.length}`);
  }
  const groupObjectNumber = payload.readUInt8(0);
  const idxByte = payload.readUInt8(1);
  const sendingAddressIndex = (idxByte >> 4) & 0x0f;
  const startIndex = idxByte & 0x0f;
  const groupAddresses: string[] = [];
  for (let offset = 2; offset + 2 <= payload.length; offset += 2) {
    groupAddresses.push(KNXHelper.GetAddress(payload.subarray(offset, offset + 2), "/"));
  }
  return { groupObjectNumber, sendingAddressIndex, startIndex, groupAddresses };
}

// ============================================================================
// 5. Network Management Services: IA, Domain Address, Network Parameter (03_03_07 §3.2–3.3)
// ============================================================================

export function buildIndividualAddressReadReq(sourceAddress: string) {
  return buildBroadcastLDataReq(
    sourceAddress,
    APCIEnum.A_IndividualAddress_Read_Protocol_Data_Unit,
    Buffer.from([0x00]),
    true,
  );
}

export function buildIndividualAddressWriteReq(sourceAddress: string, newAddress: string) {
  if (!KNXHelper.isValidIndividualAddress(newAddress)) {
    throw new Error(`Invalid KNX Individual Address: ${newAddress}`);
  }
  const addrBuf = KNXHelper.GetAddress(newAddress, ".");
  return buildBroadcastLDataReq(sourceAddress, APCIEnum.A_IndividualAddress_Write_Protocol_Data_Unit, addrBuf, false);
}

export function buildIndividualAddressSerialNumberReadReq(sourceAddress: string, serialNumber: Buffer) {
  if (serialNumber.length !== 6) {
    throw new Error(`Invalid KNX Serial Number length: ${serialNumber.length} (expected 6 bytes)`);
  }
  return buildBroadcastLDataReq(
    sourceAddress,
    APCIEnum.A_IndividualAddressSerialNumber_Read_Protocol_Data_Unit,
    Buffer.from(serialNumber),
    false,
  );
}

export function buildIndividualAddressSerialNumberWriteReq(
  sourceAddress: string,
  serialNumber: Buffer,
  newAddress: string,
) {
  if (serialNumber.length !== 6) {
    throw new Error(`Invalid KNX Serial Number length: ${serialNumber.length} (expected 6 bytes)`);
  }
  if (!KNXHelper.isValidIndividualAddress(newAddress)) {
    throw new Error(`Invalid KNX Individual Address: ${newAddress}`);
  }
  const addrBuf = KNXHelper.GetAddress(newAddress, ".");
  const payload = Buffer.concat([serialNumber, addrBuf, Buffer.alloc(4, 0x00)]);
  return buildBroadcastLDataReq(
    sourceAddress,
    APCIEnum.A_IndividualAddressSerialNumber_Write_Protocol_Data_Unit,
    payload,
    false,
  );
}

export function buildDomainAddressReadReq(sourceAddress: string, systemBroadcast: boolean = true) {
  const builder = systemBroadcast ? buildSystemBroadcastLDataReq : buildBroadcastLDataReq;
  return builder(sourceAddress, APCIEnum.A_DomainAddress_Read_Protocol_Data_Unit, Buffer.alloc(0), false);
}

export function buildDomainAddressWriteReq(
  sourceAddress: string,
  domainAddress: Buffer,
  systemBroadcast: boolean = true,
) {
  if (domainAddress.length !== 2 && domainAddress.length !== 6) {
    throw new Error(`Invalid KNX Domain Address length: ${domainAddress.length} (expected 2 or 6 bytes)`);
  }
  const builder = systemBroadcast ? buildSystemBroadcastLDataReq : buildBroadcastLDataReq;
  return builder(sourceAddress, APCIEnum.A_DomainAddress_Write_Protocol_Data_Unit, Buffer.from(domainAddress), false);
}

export function buildDomainAddressSelectiveReadReq(
  sourceAddress: string,
  domainAddress2B: Buffer,
  startAddress: string,
  range: number,
  systemBroadcast: boolean = true,
) {
  if (domainAddress2B.length !== 2) {
    throw new Error(`A_DomainAddressSelective_Read requires a 2-byte Domain Address (got ${domainAddress2B.length})`);
  }
  const startIaBuf = KNXHelper.GetAddress(startAddress, ".");
  const payload = Buffer.concat([domainAddress2B, startIaBuf, Buffer.from([range & 0xff])]);
  const builder = systemBroadcast ? buildSystemBroadcastLDataReq : buildBroadcastLDataReq;
  return builder(sourceAddress, APCIEnum.A_DomainAddressSelective_Read_Protocol_Data_Unit, payload, false);
}

export function buildDomainAddressSerialNumberReadReq(
  sourceAddress: string,
  serialNumber: Buffer,
  systemBroadcast: boolean = true,
) {
  if (serialNumber.length !== 6) {
    throw new Error(`Invalid KNX Serial Number length: ${serialNumber.length} (expected 6 bytes)`);
  }
  const builder = systemBroadcast ? buildSystemBroadcastLDataReq : buildBroadcastLDataReq;
  return builder(
    sourceAddress,
    APCIEnum.A_DomainAddressSerialNumber_Read_Protocol_Data_Unit,
    Buffer.from(serialNumber),
    false,
  );
}

export function buildDomainAddressSerialNumberWriteReq(
  sourceAddress: string,
  serialNumber: Buffer,
  domainAddress: Buffer,
  systemBroadcast: boolean = true,
) {
  if (serialNumber.length !== 6) {
    throw new Error(`Invalid KNX Serial Number length: ${serialNumber.length} (expected 6 bytes)`);
  }
  if (![2, 4, 6, 21].includes(domainAddress.length)) {
    throw new Error(`Invalid Domain Address length: ${domainAddress.length} (expected 2, 4, 6, or 21 bytes)`);
  }
  const payload = Buffer.concat([serialNumber, domainAddress]);
  const builder = systemBroadcast ? buildSystemBroadcastLDataReq : buildBroadcastLDataReq;
  return builder(sourceAddress, APCIEnum.A_DomainAddressSerialNumber_Write_Protocol_Data_Unit, payload, false);
}

export interface NetworkParameterParams {
  objectType: number;
  propertyId: number;
  data?: Buffer;
}

export function encodeNetworkParameterData(params: NetworkParameterParams): Buffer {
  const header = Buffer.alloc(3);
  header.writeUInt16BE(params.objectType & 0xffff, 0);
  header.writeUInt8(params.propertyId & 0xff, 2);
  return params.data && params.data.length > 0 ? Buffer.concat([header, params.data]) : header;
}

export function decodeNetworkParameterResponseData(payload: Buffer): {
  objectType: number;
  propertyId: number;
  data: Buffer;
} {
  if (payload.length < 3) {
    throw new Error(`A_NetworkParameter_Response payload too short: ${payload.length}`);
  }
  const objectType = payload.readUInt16BE(0);
  const propertyId = payload.readUInt8(2);
  const data = Buffer.from(payload.subarray(3));
  return { objectType, propertyId, data };
}

export function encodeSystemNetworkParameterData(params: NetworkParameterParams): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(params.objectType & 0xffff, 0);
  header.writeUInt16BE((params.propertyId & 0x0fff) << 4, 2);
  return params.data && params.data.length > 0 ? Buffer.concat([header, params.data]) : header;
}

export function decodeSystemNetworkParameterResponseData(payload: Buffer): {
  objectType: number;
  propertyId: number;
  data: Buffer;
} {
  if (payload.length < 4) {
    throw new Error(`A_SystemNetworkParameter_Response payload too short: ${payload.length}`);
  }
  const objectType = payload.readUInt16BE(0);
  const propertyId = (payload.readUInt16BE(2) >> 4) & 0x0fff;
  const data = Buffer.from(payload.subarray(4));
  return { objectType, propertyId, data };
}
