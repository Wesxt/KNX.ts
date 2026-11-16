import { KNXService } from "../connection/KNXService";
import { CEMI, CEMIInstance } from "../core/CEMI";
import { APCIEnum } from "../core/enum/APCIEnum";
import { DeviceDescriptorType0 } from "../core/resources/DeviceDescriptorType";
import { getKNXManufacturerName } from "../core/resources/KNXManufacturers";
import { MESSAGE_CODE_FIELD } from "../core/MessageCodeField";
import { TPCIType } from "../core/layers/interfaces/TPCI";
import { KNXHelper } from "../utils/KNXHelper";
import {
  buildBasicRestartConnectedReq,
  buildBasicRestartIndividualReq,
  buildBroadcastLDataReq,
  buildDomainAddressReadReq,
  buildDomainAddressSelectiveReadReq,
  buildDomainAddressSerialNumberReadReq,
  buildDomainAddressSerialNumberWriteReq,
  buildDomainAddressWriteReq,
  buildIndividualAddressReadReq,
  buildIndividualAddressSerialNumberReadReq,
  buildIndividualAddressSerialNumberWriteReq,
  buildIndividualAddressWriteReq,
  buildIndividualLDataReq,
  buildSystemBroadcastLDataReq,
  decodeAdcResponseApdu,
  decodeAuthorizeResponseData,
  DecodedFunctionPropertyExtResponse,
  DecodedFunctionPropertyResponse,
  decodeFunctionPropertyExtResponseData,
  decodeFunctionPropertyResponseData,
  decodeKeyResponseData,
  DecodedLinkResponse,
  decodeLinkResponseData,
  DecodedMasterResetResponse,
  decodeMasterResetResponse,
  DecodedMemoryExtendedResponse,
  decodeMemoryExtendedResponseData,
  decodeMemoryResponseApdu,
  decodeNetworkParameterResponseData,
  DecodedPropertyDescriptionResponse,
  decodePropertyDescriptionResponseData,
  DecodedPropertyExtDescriptionResponse,
  decodePropertyExtDescriptionResponseData,
  DecodedPropertyExtValueResponse,
  decodePropertyExtValueResponseData,
  decodePropertyExtWriteConResData,
  DecodedPropertyValueResponse,
  decodePropertyValueResponseData,
  decodeSystemNetworkParameterResponseData,
  decodeUserMemoryResponseData,
  encodeAdcReadApdu,
  encodeAuthorizeRequestData,
  encodeFunctionPropertyExtRequestData,
  encodeFunctionPropertyRequestData,
  encodeKeyWriteData,
  encodeLinkReadData,
  encodeLinkWriteData,
  encodeMasterResetApdu,
  encodeMemoryBitWriteData,
  encodeMemoryExtendedReadData,
  encodeMemoryExtendedWriteData,
  encodeMemoryReadApdu,
  encodeMemoryWriteApdu,
  encodeNetworkParameterData,
  encodePropertyDescriptionReadData,
  encodePropertyExtDescriptionReadData,
  encodePropertyExtValueReadData,
  encodePropertyExtValueWriteData,
  encodePropertyValueReadData,
  encodePropertyValueWriteData,
  encodeSystemNetworkParameterData,
  encodeUserMemoryReadData,
  encodeUserMemoryWriteData,
  FunctionPropertyExtParams,
  FunctionPropertyParams,
  ManagementReturnCode,
  NetworkParameterParams,
  PropertyDescriptionReadParams,
  PropertyExtDescriptionReadParams,
  PropertyExtValueReadParams,
  PropertyExtValueWriteParams,
  PropertyValueReadParams,
  PropertyValueWriteParams,
  RestartEraseCode,
} from "./apduBuilders";
import { TransportConnection } from "./TransportConnection";

/**
 * Standard KNX Interface Object Property Identifiers (03_05_01 §4.3–4.4).
 */
export enum KNXPropertyId {
  PID_OBJECT_TYPE = 1,
  PID_OBJECT_NAME = 2,
  PID_SEMAPHOR = 3,
  PID_GROUP_OBJECT_REFERENCE = 4,
  PID_LOAD_STATE_CONTROL = 5,
  PID_RUN_STATE_CONTROL = 6,
  PID_TABLE_REFERENCE = 7,
  PID_SERVICE_CONTROL = 8,
  PID_FIRMWARE_REVISION = 9,
  PID_SERVICES_SUPPORTED = 10,
  PID_SERIAL_NUMBER = 11,
  PID_MANUFACTURER_ID = 12,
  PID_PROGRAM_VERSION = 13,
  PID_DEVICE_CONTROL = 14,
  PID_ORDER_INFO = 15,
  PID_PEI_TYPE = 16,
  PID_PORT_CONFIGURATION = 17,
  PID_POLL_GROUP_SETTINGS = 18,
  PID_MANUFACTURER_DATA = 19,
  PID_DESCRIPTION = 21,
  PID_FILE = 22,
  PID_TABLE = 23,
  PID_ENROL = 24,
  PID_VERSION = 25,
  PID_GROUP_ADDRESS_ASSIGNMENT = 26,
  PID_MCB_TABLE = 27,
  PID_ERROR_CODE = 28,
  PID_OBJECT_INDEX = 29,
  PID_DOWNLOAD_COUNTER = 30,
  PID_ROUTING_COUNT = 51,
  PID_MAX_RETRY_COUNT = 52,
  PID_ERROR_FLAGS = 53,
  PID_PROG_MODE = 54,
  PID_PRODUCT_ID = 55,
  PID_MAX_APDULENGTH = 56,
  PID_SUBNET_ADDR = 57,
  PID_DEVICE_ADDR = 58,
  PID_PB_CONFIG = 59,
  PID_ADDRESS_REPORT = 60,
  PID_ADDRESS_CHECK = 61,
  PID_OBJECT_VALUE = 62,
  PID_OBJECTLINK = 63,
  PID_APPLICATION = 64,
  PID_PARAMETER = 65,
  PID_OBJECTADDRESS = 66,
  PID_PSU_TYPE = 67,
  PID_PSU_STATUS = 68,
  PID_PSU_ENABLE = 69,
  PID_DOMAIN_ADDRESS = 70,
  PID_IO_LIST = 71,
  PID_MGT_DESCRIPTOR_01 = 72,
  PID_PL110_PARAM = 73,
  PID_RF_REPEAT_COUNTER = 74,
  PID_RECEIVE_BLOCK_TABLE = 75,
  PID_RANDOM_PAUSE_TABLE = 76,
  PID_RECEIVE_BLOCK_NR = 77,
  PID_HARDWARE_TYPE = 78,
  PID_RETRANSMITTER_NUMBER = 79,
  PID_SERIAL_NR_TABLE = 80,
  PID_BIBATMASTER_ADDRESS = 81,
  PID_RF_DOMAIN_ADDRESS = 82,
  PID_DEVICE_DESCRIPTOR = 83,
  PID_METERING_FILTER_TABLE = 84,
  PID_GROUP_TELEGR_RATE_LIMIT_TIME_BASE = 85,
  PID_GROUP_TELEGR_RATE_LIMIT_NO_OF_TELEGR = 86,
}

/**
 * Load State Machine states (`PID_LOAD_STATE_CONTROL`, 03_05_01 §4.3.1.1 / 03_05_02 §3.31).
 */
export enum LoadState {
  UNLOADED = 0,
  LOADED = 1,
  LOADING = 2,
  ERROR = 3,
  UNLOADING = 4,
  LOAD_COMPLETING = 5,
}

/**
 * Load State Machine control events (`PID_LOAD_STATE_CONTROL`, 03_05_02 §3.31.3).
 */
export enum LoadEvent {
  NO_OPERATION = 0x00,
  START_LOADING = 0x01,
  LOAD_COMPLETED = 0x02,
  ADDITIONAL_LOAD_CONTROLS = 0x03,
  UNLOAD = 0x04,
}

/**
 * Run State Machine states (`PID_RUN_STATE_CONTROL`, 03_05_01 §4.3.1.2 / 03_05_02 §3.34).
 */
export enum RunState {
  HALTED = 0,
  RUNNING = 1,
  READY = 2,
  TERMINATED = 3,
  STARTING = 4,
  SHUTTING_DOWN = 5,
}

/**
 * Run State Machine control events (`PID_RUN_STATE_CONTROL`, 03_05_02 §3.34.3).
 */
export enum RunEvent {
  NO_OPERATION = 0x00,
  RESTART = 0x01,
  STOP = 0x02,
}

export interface KNXManagementOptions {
  /**
   * Source Individual Address to use in outgoing management requests.
   * Defaults to `service.individualAddress`.
   */
  sourceAddress?: string;
  /**
   * Minimum delay in milliseconds between consecutive management frames.
   * Defaults to 20 ms.
   */
  minFrameDelayMs?: number;
  /**
   * Default timeout in milliseconds for Transport Layer T_ACK.
   * Defaults to 3000 ms (03_03_04 §5.3).
   */
  ackTimeoutMs?: number;
  /**
   * Default timeout in milliseconds for Application Layer responses.
   * Defaults to 3000 ms.
   */
  responseTimeoutMs?: number;
}

export interface ProgrammingModeReadResult {
  addresses: string[];
  duplicates: string[];
}

export interface SerialNumberAddressResult {
  individualAddress: string;
  serialNumber: Buffer;
  domainAddress: Buffer;
}

export interface IndividualAddressCheckResult {
  individualAddress: string;
  descriptorType0: DeviceDescriptorType0;
  maxApduLength: number;
  programmingMode: boolean;
}

export interface DeviceIdentity {
  individualAddress: string;
  descriptorType0: number;
  maskName?: string;
  manufacturerId?: number;
  manufacturerName?: string;
  serialNumber?: string;
  hardwareType?: string;
  orderInfo?: string;
  orderInfoText?: string;
  firmwareRevision?: number;
  maxApduLength?: number;
  programmingMode?: boolean;
}

export interface IndividualAddressWriteResult {
  previousAddress: string;
  newAddress: string;
  descriptorType0: DeviceDescriptorType0;
}

export interface GroupAddressTableResult {
  individualAddress: string;
  groupAddresses: string[];
  method: "property_table" | "table_reference_memory" | "fixed_memory" | "link_services";
  tableAddress?: number;
}

export interface ScanLineOptions {
  /**
   * 'connect': uses T_Connect + DeviceDescriptor_Read(0) or T_Disconnect detection (`NM_SubnetworkDevices_Scan`).
   * 'descriptor': uses connectionless A_DeviceDescriptor_Read(0) with 1 retry (`NM_SubnetworkDevices_Scan2`).
   * Defaults to 'connect'.
   */
  method?: "connect" | "descriptor";
  /**
   * Device address range [start, end] within the line (0..255). Defaults to [1, 255].
   */
  range?: [number, number];
  /**
   * Per-address timeout in milliseconds during scanning. Defaults to 250 ms.
   */
  timeoutPerAddressMs?: number;
}

export interface MemoryWriteOptions {
  /**
   * When true (default), explicitly reads back each memory chunk with `A_Memory_Read` / `A_UserMemory_Read`
   * and verifies that the written bytes match (`DMP_MemWrite_RCoV`, 03_05_02 §3.16.3).
   */
  verify?: boolean;
  /**
   * Set to true if the remote device has Verify Mode active (`PID_DEVICE_CONTROL` bit 2),
   * meaning the device automatically replies to `A_Memory_Write` with `A_Memory_Response`.
   * Defaults to false.
   */
  verifyModeActive?: boolean;
  /**
   * Maximum bytes per write chunk (1..63 for standard memory, 1..15 for user memory).
   * Defaults to 12 bytes for standard memory (compatible with 15-byte standard APDU) and 11 bytes for user memory.
   */
  maxChunkSize?: number;
}

export interface RestartOptions {
  /**
   * 'basic' (default): sends unconfirmed `A_Restart` (`0x0380`, `restart_type = 0`).
   * 'master': sends confirmed `A_Restart` (`0x0381`, `restart_type = 1`) with `eraseCode` and `channelNumber`,
   * waiting for `A_Restart_Response` (`0x03A1`).
   */
  type?: "basic" | "master";
  /**
   * Erase code for Master Reset (`RestartEraseCode`, default `RestartEraseCode.CONFIRMED_RESTART = 0x01`).
   */
  eraseCode?: RestartEraseCode | number;
  /**
   * Application channel number for Master Reset (`0x00` = all channels). Defaults to `0x00`.
   */
  channelNumber?: number;
  /**
   * Send over connectionless `T_Data_Individual` (`DM_Restart_RCl`) instead of connected `T_Data_Connected` (`DM_Restart_RCo`).
   * Defaults to false.
   */
  connectionless?: boolean;
}

export interface LocalPropertyReadParams {
  objectType: number;
  objectInstance?: number;
  propertyId: number;
  count?: number;
  startIndex?: number;
}

export interface LocalPropertyWriteParams extends LocalPropertyReadParams {
  data: Buffer;
}

export interface LocalFunctionPropertyParams {
  objectType: number;
  objectInstance?: number;
  propertyId: number;
  data?: Buffer;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Compute even parity on bits 0..6 and place the parity bit in bit 7 (used by BCU1 `0x0060` programming mode byte).
 */
function withEvenParityBit7(byteVal: number): number {
  const low7 = byteVal & 0x7f;
  let ones = 0;
  for (let i = 0; i < 7; i++) {
    if ((low7 & (1 << i)) !== 0) ones++;
  }
  return ones % 2 === 0 ? low7 : low7 | 0x80;
}

/**
 * Represents an active Point-to-Point Connection-Oriented Management Session (`T_Connect`)
 * to a specific KNX Individual Address.
 *
 * Keeping a single `KNXManagementSession` open across multiple operations is essential when using
 * `authorize(key)` (`A_Authorize_Request`), because the granted access level remains active only
 * for the lifetime of the underlying `TransportConnection` (03_03_07 §3.5.7).
 */
export class KNXManagementSession {
  constructor(
    public readonly connection: TransportConnection,
    private readonly minFrameDelayMs: number = 20,
  ) {}

  public get destinationAddress(): string {
    return this.connection.destinationAddress;
  }

  public get isConnected(): boolean {
    return this.connection.isConnected;
  }

  /**
   * Closes the underlying `TransportConnection` (`DM_Disconnect_RCo`).
   */
  public async close(sendDisconnectPdu: boolean = true): Promise<void> {
    await this.connection.disconnect(sendDisconnectPdu);
  }

  /**
   * Reads a Device Descriptor (Type 0 or Type 2) over the active session (`A_DeviceDescriptor_Read`).
   */
  public async readDeviceDescriptor(
    descriptorType: number = 0,
  ): Promise<{ descriptorType: number; data: Buffer; descriptorType0?: DeviceDescriptorType0 }> {
    const apdu = await this.connection.request(
      APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit,
      Buffer.from([descriptorType & 0x3f]),
      true,
      APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit,
    );
    const descriptorType0 =
      descriptorType === 0 && apdu.data.length >= 2 ? new DeviceDescriptorType0(apdu.data.readUInt16BE(0)) : undefined;
    return {
      descriptorType,
      data: Buffer.from(apdu.data),
      descriptorType0,
    };
  }

  /**
   * `DM_Authorize_RCo` (03_05_02 §3.5.1 / 03_03_07 §3.5.7):
   * Authenticates the session with a 4-byte authorization key (defaults to default key `0xFFFFFFFF`)
   * and returns the granted access level (`0` = highest privilege, `3` or `15` = lowest).
   */
  public async authorize(key: number | Buffer = 0xffffffff): Promise<number> {
    const apdu = await this.connection.request(
      APCIEnum.A_Authorize_Request_Protocol_Data_Unit,
      encodeAuthorizeRequestData(key),
      false,
      APCIEnum.A_Authorize_Response_Protocol_Data_Unit,
    );
    return decodeAuthorizeResponseData(apdu.data);
  }

  /**
   * `DM_SetKey_RCo` (03_05_02 §3.6.1 / 03_03_07 §3.5.8):
   * Writes a 4-byte authorization key for the given access `level` (`0xFFFFFFFF` deletes the key).
   * Verifies that the returned access level in `A_Key_Response` matches `level`.
   */
  public async setKey(level: number, key: number | Buffer): Promise<number> {
    const apdu = await this.connection.request(
      APCIEnum.A_Key_Write_Protocol_Data_Unit,
      encodeKeyWriteData(level, key),
      false,
      APCIEnum.A_Key_Response_Protocol_Data_Unit,
    );
    const returnedLevel = decodeKeyResponseData(apdu.data);
    if (returnedLevel !== (level & 0xff)) {
      throw new Error(
        `DM_SetKey failed on ${this.destinationAddress}: requested level ${level}, device returned 0x${returnedLevel.toString(16)}`,
      );
    }
    return returnedLevel;
  }

  /**
   * `DM_InterfaceObjectRead_R` (03_05_02 §3.27.2):
   * Reads an Interface Object Property value (`A_PropertyValue_Read`).
   */
  public async readProperty(params: PropertyValueReadParams): Promise<DecodedPropertyValueResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_PropertyValue_Read_Protocol_Data_Unit,
      encodePropertyValueReadData(params),
      false,
      APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
    );
    return decodePropertyValueResponseData(apdu.data);
  }

  /**
   * `DM_InterfaceObjectWrite_R` (03_05_02 §3.25.2):
   * Writes an Interface Object Property value (`A_PropertyValue_Write`) and validates the returned
   * `A_PropertyValue_Response` (throws if `count === 0`, which indicates a negative confirmation).
   */
  public async writeProperty(
    params: PropertyValueWriteParams,
    options: { verify?: boolean } = {},
  ): Promise<DecodedPropertyValueResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_PropertyValue_Write_Protocol_Data_Unit,
      encodePropertyValueWriteData(params),
      false,
      APCIEnum.A_PropertyValue_Response_Protocol_Data_Unit,
    );
    const decoded = decodePropertyValueResponseData(apdu.data);
    const expectedCount = params.count ?? 1;
    if (expectedCount > 0 && decoded.count === 0) {
      throw new Error(
        `A_PropertyValue_Write rejected by ${this.destinationAddress} (objectIndex=${params.objectIndex}, propertyId=${params.propertyId})`,
      );
    }
    if ((options.verify ?? false) && !decoded.data.equals(params.data)) {
      throw new Error(
        `A_PropertyValue_Write verification mismatch on ${this.destinationAddress}: wrote ${params.data.toString("hex")}, read back ${decoded.data.toString("hex")}`,
      );
    }
    return decoded;
  }

  /**
   * Reads an Interface Object Property Description (`A_PropertyDescription_Read`, 03_03_07 §3.4.3.1).
   */
  public async readPropertyDescription(
    params: PropertyDescriptionReadParams,
  ): Promise<DecodedPropertyDescriptionResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_PropertyDescription_Read_Protocol_Data_Unit,
      encodePropertyDescriptionReadData(params),
      false,
      APCIEnum.A_PropertyDescription_Response_Protocol_Data_Unit,
    );
    return decodePropertyDescriptionResponseData(apdu.data);
  }

  /**
   * `DM_InterfaceObjectScan_R` (03_05_02 §3.28.2):
   * Iterates sequentially through `propertyIndex = 0..maxProperties` on `objectIndex` using
   * `A_PropertyDescription_Read(propertyId = 0, propertyIndex = i)` until the device reports
   * `maxElements === 0` or `propertyId === 0`.
   */
  public async scanObjectProperties(
    objectIndex: number,
    maxProperties: number = 128,
  ): Promise<DecodedPropertyDescriptionResponse[]> {
    const descriptions: DecodedPropertyDescriptionResponse[] = [];
    for (let idx = 0; idx < maxProperties; idx++) {
      try {
        const desc = await this.readPropertyDescription({
          objectIndex,
          propertyId: 0,
          propertyIndex: idx,
        });
        if (desc.maxElements === 0 || desc.propertyId === 0) {
          break;
        }
        descriptions.push(desc);
      } catch {
        break;
      }
    }
    return descriptions;
  }

  /**
   * `DM_FunctionProperty_Write_R` (03_05_02 §3.30 / 03_03_07 §3.4.7.1):
   * Invokes a Function Property (`A_FunctionPropertyCommand`) and returns the `A_FunctionPropertyState_Response`.
   */
  public async callFunctionProperty(params: FunctionPropertyParams): Promise<DecodedFunctionPropertyResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_FunctionPropertyCommand_Protocol_Data_Unit,
      encodeFunctionPropertyRequestData(params),
      false,
      APCIEnum.A_FunctionPropertyState_Response_Protocol_Data_Unit,
    );
    return decodeFunctionPropertyResponseData(apdu.data);
  }

  /**
   * Reads the state of a Function Property (`A_FunctionPropertyState_Read`, 03_03_07 §3.4.7.2).
   */
  public async readFunctionPropertyState(params: FunctionPropertyParams): Promise<DecodedFunctionPropertyResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_FunctionPropertyState_Read_Protocol_Data_Unit,
      encodeFunctionPropertyRequestData(params),
      false,
      APCIEnum.A_FunctionPropertyState_Response_Protocol_Data_Unit,
    );
    return decodeFunctionPropertyResponseData(apdu.data);
  }

  /**
   * `DMP_ExtInterfaceObjectRead_R` (03_05_02 §3.27.4 / 03_03_07 §3.4.5.1):
   * Reads an Extended Interface Object Property (`A_PropertyExtValue_Read`).
   */
  public async readPropertyExtended(params: PropertyExtValueReadParams): Promise<DecodedPropertyExtValueResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_PropertyExtValue_Read_Protocol_Data_Unit,
      encodePropertyExtValueReadData(params),
      false,
      APCIEnum.A_PropertyExtValue_Response_Protocol_Data_Unit,
    );
    return decodePropertyExtValueResponseData(apdu.data);
  }

  /**
   * `DMP_ExtInterfaceObjectWriteCon_R` / `WriteUnCon_R` (03_05_02 §3.25.4–5 / 03_03_07 §3.4.5.2–3):
   * Writes an Extended Interface Object Property (`A_PropertyExtValue_WriteCon` or `A_PropertyExtValue_WriteUnCon`).
   */
  public async writePropertyExtended(
    params: PropertyExtValueWriteParams,
    options: { confirmed?: boolean } = {},
  ): Promise<{ returnCode: number } | void> {
    const payload = encodePropertyExtValueWriteData(params);
    if (options.confirmed ?? true) {
      const apdu = await this.connection.request(
        APCIEnum.A_PropertyExtValue_WriteCon_Protocol_Data_Unit,
        payload,
        false,
        APCIEnum.A_PropertyExtValue_WriteConRes_Protocol_Data_Unit,
      );
      const res = decodePropertyExtWriteConResData(apdu.data);
      if (res.returnCode !== ManagementReturnCode.E_SUCCESS) {
        throw new Error(
          `A_PropertyExtValue_WriteCon failed on ${this.destinationAddress} with ReturnCode 0x${res.returnCode.toString(16)}`,
        );
      }
      return { returnCode: res.returnCode };
    } else {
      await this.connection.sendConnectedUnconfirmed(
        APCIEnum.A_PropertyExtValue_WriteUnCon_Protocol_Data_Unit,
        payload,
        false,
      );
    }
  }

  /**
   * Reads an Extended Interface Object Property Description (`A_PropertyExtDescription_Read`, 03_03_07 §3.4.3.2).
   */
  public async readPropertyDescriptionExtended(
    params: PropertyExtDescriptionReadParams,
  ): Promise<DecodedPropertyExtDescriptionResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_PropertyExtDescription_Read_Protocol_Data_Unit,
      encodePropertyExtDescriptionReadData(params),
      false,
      APCIEnum.A_PropertyExtDescription_Response_Protocol_Data_Unit,
    );
    return decodePropertyExtDescriptionResponseData(apdu.data);
  }

  /**
   * Invokes an Extended Function Property (`A_FunctionPropertyExtCommand`, 03_03_07 §3.4.8.1).
   */
  public async callFunctionPropertyExtended(
    params: FunctionPropertyExtParams,
  ): Promise<DecodedFunctionPropertyExtResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_FunctionPropertyExtCommand_Protocol_Data_Unit,
      encodeFunctionPropertyExtRequestData(params),
      false,
      APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit,
    );
    return decodeFunctionPropertyExtResponseData(apdu.data);
  }

  /**
   * Reads an Extended Function Property state (`A_FunctionPropertyExtState_Read`, 03_03_07 §3.4.8.2).
   */
  public async readFunctionPropertyStateExtended(
    params: FunctionPropertyExtParams,
  ): Promise<DecodedFunctionPropertyExtResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_FunctionPropertyExtState_Read_Protocol_Data_Unit,
      encodeFunctionPropertyExtRequestData(params),
      false,
      APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit,
    );
    return decodeFunctionPropertyExtResponseData(apdu.data);
  }

  /**
   * Reads whether Programming Mode is currently enabled on the target device (`PID_PROG_MODE = 54` on Object 0,
   * with fallback to memory address `0x0060` bit 0 per `03_05_02` §3.13.2).
   */
  public async readProgrammingMode(): Promise<boolean> {
    try {
      const resp = await this.readProperty({
        objectIndex: 0,
        propertyId: KNXPropertyId.PID_PROG_MODE,
        count: 1,
        startIndex: 1,
      });
      if (resp.count > 0 && resp.data.length >= 1) {
        return (resp.data.readUInt8(0) & 0x01) !== 0;
      }
    } catch {
      // Fallback to BCU memory 0x0060
    }
    const mem = await this.readMemory(0x0060, 1);
    return mem.length >= 1 && (mem.readUInt8(0) & 0x01) !== 0;
  }

  /**
   * `DMP_ProgModeSwitch_RCo` (03_05_02 §3.13.2):
   * Switches the remote device's Programming Mode ON or OFF via `PID_PROG_MODE` (54) on Object 0,
   * with automatic fallback to BCU memory `0x0060` (preserving bits 1..6 and computing even parity in bit 7).
   */
  public async setProgrammingMode(enabled: boolean): Promise<void> {
    try {
      await this.writeProperty({
        objectIndex: 0,
        propertyId: KNXPropertyId.PID_PROG_MODE,
        count: 1,
        startIndex: 1,
        data: Buffer.from([enabled ? 0x01 : 0x00]),
      });
      return;
    } catch {
      // Fallback to BCU memory 0x0060 per 03_05_02 §3.13.2
    }
    const current = await this.readMemory(0x0060, 1);
    const baseByte = current.length >= 1 ? current.readUInt8(0) & 0x7e : 0x60;
    const newByte = withEvenParityBit7(enabled ? baseByte | 0x01 : baseByte & ~0x01);
    await this.writeMemory(0x0060, Buffer.from([newByte]), { verify: false });
  }

  /**
   * `DM_PeiTypeRead` (03_05_02 §3.15):
   * Reads the Physical External Interface (PEI) type from `PID_PEI_TYPE` (16) on Object 0,
   * or via `A_ADC_Read` on channel 4 (`(20 * sum + 128 * readCount) / (256 * readCount)`).
   */
  public async readPeiType(): Promise<number> {
    try {
      const prop = await this.readProperty({
        objectIndex: 0,
        propertyId: KNXPropertyId.PID_PEI_TYPE,
        count: 1,
        startIndex: 1,
      });
      if (prop.count > 0 && prop.data.length >= 1) {
        return prop.data.readUInt8(0);
      }
    } catch {
      // Fallback to ADC channel 4 per DMP_PeiTypeRead_RCo_ADC (03_05_02 §3.15.2)
    }
    const adc = await this.readAdc(4, 1);
    if (adc.readCount === 0) {
      throw new Error(`DM_PeiTypeRead failed on ${this.destinationAddress}: ADC readCount = 0`);
    }
    return Math.floor((20 * adc.sum + 128 * adc.readCount) / (256 * adc.readCount));
  }

  /**
   * Reads legacy User Manufacturer Info (`A_UserManufacturerInfo_Read`, 03_03_07 §3.5.6.5).
   */
  public async readUserManufacturerInfo(): Promise<{ manufacturerId: number; manufacturerSpecific: Buffer }> {
    const apdu = await this.connection.request(
      APCIEnum.A_UserManufacturerInfo_Read_Protocol_Data_Unit,
      Buffer.alloc(0),
      false,
      APCIEnum.A_UserManufacturerInfo_Response_Protocol_Data_Unit,
    );
    if (apdu.data.length < 3) {
      throw new Error(`A_UserManufacturerInfo_Response too short: ${apdu.data.length}`);
    }
    return {
      manufacturerId: apdu.data.readUInt8(0),
      manufacturerSpecific: Buffer.from(apdu.data.subarray(1, 3)),
    };
  }

  /**
   * Reads an ADC channel (`A_ADC_Read`, 03_03_07 §3.5.2).
   */
  public async readAdc(
    channelNr: number,
    readCount: number = 1,
  ): Promise<{ channelNr: number; readCount: number; sum: number }> {
    const req = encodeAdcReadApdu(channelNr, readCount);
    const apdu = await this.connection.request(
      req.apci,
      req.data,
      req.isShort,
      APCIEnum.A_Analog_to_Digital_Converter_Response_Protocol_Data_Unit,
    );
    return decodeAdcResponseApdu(apdu);
  }

  /**
   * `DM_MemRead_RCo` (03_05_02 §3.18.2 / 03_03_07 §3.5.3):
   * Reads `length` bytes starting at 16-bit `memoryAddress`, automatically splitting requests into chunks
   * (default `maxChunkSize = 12`, max `63` bytes per `A_Memory_Read` PDU).
   */
  public async readMemory(
    memoryAddress: number,
    length: number,
    options: { maxChunkSize?: number } = {},
  ): Promise<Buffer> {
    if (length <= 0) return Buffer.alloc(0);
    if (memoryAddress < 0 || memoryAddress + length > 0x10000) {
      throw new Error(`Invalid 16-bit memory range: 0x${memoryAddress.toString(16)} + ${length}`);
    }
    const maxChunk = Math.min(Math.max(options.maxChunkSize ?? 12, 1), 63);
    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset < length) {
      const chunkLen = Math.min(maxChunk, length - offset);
      const addr = memoryAddress + offset;
      const req = encodeMemoryReadApdu(addr, chunkLen);
      const apdu = await this.connection.request(
        req.apci,
        req.data,
        req.isShort,
        APCIEnum.A_Memory_Response_Protocol_Data_Unit,
      );
      const decoded = decodeMemoryResponseApdu(apdu);
      if (decoded.length === 0 || decoded.data.length < chunkLen) {
        throw new Error(
          `A_Memory_Read failed at 0x${addr.toString(16)} on ${this.destinationAddress} (received ${decoded.length} bytes)`,
        );
      }
      chunks.push(decoded.data.subarray(0, chunkLen));
      offset += chunkLen;
    }

    return Buffer.concat(chunks);
  }

  /**
   * `DM_MemWrite_RCo` / `DMP_MemWrite_RCoV` (03_05_02 §3.16.2–3 / 03_03_07 §3.5.4):
   * Writes `data` starting at 16-bit `memoryAddress` in chunks (default `maxChunkSize = 12`, max `63` bytes).
   * When `verify` is true (default), reads back each written chunk using `A_Memory_Read` (or uses the
   * automatic `A_Memory_Response` if `verifyModeActive` is true) and throws if any byte differs.
   */
  public async writeMemory(memoryAddress: number, data: Buffer, options: MemoryWriteOptions = {}): Promise<void> {
    if (data.length === 0) return;
    if (memoryAddress < 0 || memoryAddress + data.length > 0x10000) {
      throw new Error(`Invalid 16-bit memory range: 0x${memoryAddress.toString(16)} + ${data.length}`);
    }
    const verify = options.verify ?? true;
    const verifyModeActive = options.verifyModeActive ?? false;
    const maxChunk = Math.min(Math.max(options.maxChunkSize ?? 12, 1), 63);

    let offset = 0;
    while (offset < data.length) {
      const chunk = data.subarray(offset, offset + maxChunk);
      const addr = memoryAddress + offset;
      const req = encodeMemoryWriteApdu(addr, chunk);

      if (verifyModeActive) {
        const respApdu = await this.connection.request(
          req.apci,
          req.data,
          req.isShort,
          APCIEnum.A_Memory_Response_Protocol_Data_Unit,
        );
        const decoded = decodeMemoryResponseApdu(respApdu);
        if (decoded.length === 0 || !decoded.data.subarray(0, chunk.length).equals(chunk)) {
          throw new Error(
            `A_Memory_Write (Verify Mode) mismatch at 0x${addr.toString(16)} on ${this.destinationAddress}`,
          );
        }
      } else {
        await this.connection.sendConnectedUnconfirmed(req.apci, req.data, req.isShort);
        if (this.minFrameDelayMs > 0) {
          await delay(this.minFrameDelayMs);
        }
        if (verify) {
          const readBack = await this.readMemory(addr, chunk.length, { maxChunkSize: chunk.length });
          if (!readBack.equals(chunk)) {
            throw new Error(
              `DMP_MemWrite_RCoV verification failed at 0x${addr.toString(16)} on ${this.destinationAddress}: expected ${chunk.toString("hex")}, got ${readBack.toString("hex")}`,
            );
          }
        }
      }
      offset += chunk.length;
    }
  }

  /**
   * Modifies individual bits in 1..5 contiguous bytes at 16-bit `memoryAddress` (`A_MemoryBit_Write`, 03_03_07 §3.5.5).
   * Formula per bit: `result = (block_bit AND and_data_bit) XOR xor_data_bit`.
   */
  public async writeMemoryBit(
    memoryAddress: number,
    andData: Buffer,
    xorData: Buffer,
    options: { verifyModeActive?: boolean } = {},
  ): Promise<void> {
    const payload = encodeMemoryBitWriteData(memoryAddress, andData, xorData);
    if (options.verifyModeActive) {
      const apdu = await this.connection.request(
        APCIEnum.A_MemoryBit_Write_Protocol_Data_Unit,
        payload,
        false,
        APCIEnum.A_Memory_Response_Protocol_Data_Unit,
      );
      const decoded = decodeMemoryResponseApdu(apdu);
      if (decoded.length === 0) {
        throw new Error(`A_MemoryBit_Write failed at 0x${memoryAddress.toString(16)}`);
      }
    } else {
      await this.connection.sendConnectedUnconfirmed(APCIEnum.A_MemoryBit_Write_Protocol_Data_Unit, payload, false);
    }
  }

  /**
   * `DM_UserMemRead_RCo` (03_05_02 §3.21.2 / 03_03_07 §3.5.6.2):
   * Reads `length` bytes from the 20-bit User Memory address space (`0x00000..0xFFFFF`),
   * automatically chunking requests (up to 15 bytes per `A_UserMemory_Read` PDU).
   */
  public async readUserMemory(
    memoryAddress20: number,
    length: number,
    options: { maxChunkSize?: number } = {},
  ): Promise<Buffer> {
    if (length <= 0) return Buffer.alloc(0);
    if (memoryAddress20 < 0 || memoryAddress20 + length > 0x100000) {
      throw new Error(`Invalid 20-bit user memory range: 0x${memoryAddress20.toString(16)} + ${length}`);
    }
    const maxChunk = Math.min(Math.max(options.maxChunkSize ?? 11, 1), 15);
    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset < length) {
      const chunkLen = Math.min(maxChunk, length - offset);
      const addr = memoryAddress20 + offset;
      const apdu = await this.connection.request(
        APCIEnum.A_UserMemory_Read_Protocol_Data_Unit,
        encodeUserMemoryReadData(addr, chunkLen),
        false,
        APCIEnum.A_UserMemory_Response_Protocol_Data_Unit,
      );
      const decoded = decodeUserMemoryResponseData(apdu.data);
      if (decoded.length === 0 || decoded.data.length < chunkLen) {
        throw new Error(`A_UserMemory_Read failed at 0x${addr.toString(16)} on ${this.destinationAddress}`);
      }
      chunks.push(decoded.data.subarray(0, chunkLen));
      offset += chunkLen;
    }

    return Buffer.concat(chunks);
  }

  /**
   * `DM_UserMemWrite_RCo` / `DMP_UserMemWrite_RCoV` (03_05_02 §3.19.2–3 / 03_03_07 §3.5.6.3):
   * Writes `data` to the 20-bit User Memory address space in chunks of up to 15 bytes, with optional read-back verification.
   */
  public async writeUserMemory(memoryAddress20: number, data: Buffer, options: MemoryWriteOptions = {}): Promise<void> {
    if (data.length === 0) return;
    if (memoryAddress20 < 0 || memoryAddress20 + data.length > 0x100000) {
      throw new Error(`Invalid 20-bit user memory range: 0x${memoryAddress20.toString(16)} + ${data.length}`);
    }
    const verify = options.verify ?? true;
    const verifyModeActive = options.verifyModeActive ?? false;
    const maxChunk = Math.min(Math.max(options.maxChunkSize ?? 11, 1), 15);

    let offset = 0;
    while (offset < data.length) {
      const chunk = data.subarray(offset, offset + maxChunk);
      const addr = memoryAddress20 + offset;
      const payload = encodeUserMemoryWriteData(addr, chunk);

      if (verifyModeActive) {
        const apdu = await this.connection.request(
          APCIEnum.A_UserMemory_Write_Protocol_Data_Unit,
          payload,
          false,
          APCIEnum.A_UserMemory_Response_Protocol_Data_Unit,
        );
        const decoded = decodeUserMemoryResponseData(apdu.data);
        if (decoded.length === 0 || !decoded.data.subarray(0, chunk.length).equals(chunk)) {
          throw new Error(
            `A_UserMemory_Write (Verify Mode) mismatch at 0x${addr.toString(16)} on ${this.destinationAddress}`,
          );
        }
      } else {
        await this.connection.sendConnectedUnconfirmed(APCIEnum.A_UserMemory_Write_Protocol_Data_Unit, payload, false);
        if (this.minFrameDelayMs > 0) {
          await delay(this.minFrameDelayMs);
        }
        if (verify) {
          const readBack = await this.readUserMemory(addr, chunk.length, { maxChunkSize: chunk.length });
          if (!readBack.equals(chunk)) {
            throw new Error(
              `DMP_UserMemWrite_RCoV verification failed at 0x${addr.toString(16)} on ${this.destinationAddress}`,
            );
          }
        }
      }
      offset += chunk.length;
    }
  }

  /**
   * Modifies individual bits in 1..5 contiguous bytes of User Memory (`A_UserMemoryBit_Write`, 03_03_07 §3.5.6.4).
   */
  public async writeUserMemoryBit(
    memoryAddress16: number,
    andData: Buffer,
    xorData: Buffer,
    options: { verifyModeActive?: boolean } = {},
  ): Promise<void> {
    const payload = encodeMemoryBitWriteData(memoryAddress16, andData, xorData);
    if (options.verifyModeActive) {
      const apdu = await this.connection.request(
        APCIEnum.A_UserMemoryBit_Write_Protocol_Data_Unit,
        payload,
        false,
        APCIEnum.A_UserMemory_Response_Protocol_Data_Unit,
      );
      const decoded = decodeUserMemoryResponseData(apdu.data);
      if (decoded.length === 0) {
        throw new Error(`A_UserMemoryBit_Write failed at 0x${memoryAddress16.toString(16)}`);
      }
    } else {
      await this.connection.sendConnectedUnconfirmed(APCIEnum.A_UserMemoryBit_Write_Protocol_Data_Unit, payload, false);
    }
  }

  /**
   * `DMP_MemRead_Extended_R` (03_05_02 §3.24 / 03_03_07 §3.4.9.1):
   * Reads `length` bytes from the 24-bit Extended Memory address space (`0x000000..0xFFFFFF`)
   * using `A_MemoryExtended_Read` (up to 250 bytes per chunk).
   */
  public async readExtendedMemory(
    memoryAddress24: number,
    length: number,
    options: { maxChunkSize?: number } = {},
  ): Promise<Buffer> {
    if (length <= 0) return Buffer.alloc(0);
    if (memoryAddress24 < 0 || memoryAddress24 + length > 0x1000000) {
      throw new Error(`Invalid 24-bit extended memory range: 0x${memoryAddress24.toString(16)} + ${length}`);
    }
    const maxChunk = Math.min(Math.max(options.maxChunkSize ?? 128, 1), 250);
    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset < length) {
      const chunkLen = Math.min(maxChunk, length - offset);
      const addr = memoryAddress24 + offset;
      const apdu = await this.connection.request(
        APCIEnum.A_MemoryExtended_Read_Protocol_Data_Unit,
        encodeMemoryExtendedReadData(addr, chunkLen),
        false,
        APCIEnum.A_MemoryExtended_ReadResponse_Protocol_Data_Unit,
      );
      const decoded: DecodedMemoryExtendedResponse = decodeMemoryExtendedResponseData(apdu.data);
      if (decoded.returnCode !== ManagementReturnCode.E_SUCCESS) {
        throw new Error(
          `A_MemoryExtended_Read failed at 0x${addr.toString(16)} with ReturnCode 0x${decoded.returnCode.toString(16)}`,
        );
      }
      chunks.push(decoded.data.subarray(0, chunkLen));
      offset += chunkLen;
    }

    return Buffer.concat(chunks);
  }

  /**
   * `DMP_MemWrite_Extended_R` (03_05_02 §3.22 / 03_03_07 §3.4.9.2):
   * Writes `data` to the 24-bit Extended Memory address space using confirmed `A_MemoryExtended_Write`
   * (up to 250 bytes per chunk).
   */
  public async writeExtendedMemory(
    memoryAddress24: number,
    data: Buffer,
    options: { maxChunkSize?: number } = {},
  ): Promise<void> {
    if (data.length === 0) return;
    if (memoryAddress24 < 0 || memoryAddress24 + data.length > 0x1000000) {
      throw new Error(`Invalid 24-bit extended memory range: 0x${memoryAddress24.toString(16)} + ${data.length}`);
    }
    const maxChunk = Math.min(Math.max(options.maxChunkSize ?? 128, 1), 250);
    let offset = 0;

    while (offset < data.length) {
      const chunk = data.subarray(offset, offset + maxChunk);
      const addr = memoryAddress24 + offset;
      const apdu = await this.connection.request(
        APCIEnum.A_MemoryExtended_Write_Protocol_Data_Unit,
        encodeMemoryExtendedWriteData(addr, chunk),
        false,
        APCIEnum.A_MemoryExtended_WriteResponse_Protocol_Data_Unit,
      );
      const decoded = decodeMemoryExtendedResponseData(apdu.data);
      if (
        decoded.returnCode !== ManagementReturnCode.E_SUCCESS &&
        decoded.returnCode !== ManagementReturnCode.E_SUCCESS_WITH_CRC
      ) {
        throw new Error(
          `A_MemoryExtended_Write failed at 0x${addr.toString(16)} with ReturnCode 0x${decoded.returnCode.toString(16)}`,
        );
      }
      offset += chunk.length;
    }
  }

  /**
   * `DM_LoadStateMachineRead` (03_05_02 §3.33.3):
   * Reads `PID_LOAD_STATE_CONTROL` (5) on the specified Interface Object indexes (default: `[1, 2, 3]`).
   */
  public async readLoadState(
    objectIndexes: number[] = [1, 2, 3],
  ): Promise<{ objectIndex: number; state: LoadState; stateName: string }[]> {
    const results: { objectIndex: number; state: LoadState; stateName: string }[] = [];
    for (const objectIndex of objectIndexes) {
      try {
        const decoded = await this.readProperty({
          objectIndex,
          propertyId: KNXPropertyId.PID_LOAD_STATE_CONTROL,
          count: 1,
          startIndex: 1,
        });
        if (decoded.count > 0 && decoded.data.length >= 1) {
          const state = decoded.data.readUInt8(0) as LoadState;
          results.push({
            objectIndex,
            state,
            stateName: LoadState[state] ?? `UNKNOWN(${state})`,
          });
        }
      } catch {
        // Object index may not exist on this device; continue
      }
    }
    return results;
  }

  /**
   * `DMP_LoadStateMachineWrite_RCo_IO` (03_05_02 §3.31.3):
   * Writes a 10-octet Load Event (`START_LOADING = 1`, `LOAD_COMPLETED = 2`, `ADDITIONAL_LOAD_CONTROLS = 3`, `UNLOAD = 4`)
   * to `PID_LOAD_STATE_CONTROL` (5) on `objectIndex` and returns the resulting `LoadState`.
   */
  public async writeLoadState(objectIndex: number, event: LoadEvent, additionalPayload?: Buffer): Promise<LoadState> {
    const controlBlock = Buffer.alloc(10, 0x00);
    controlBlock.writeUInt8(event & 0xff, 0);
    if (additionalPayload && additionalPayload.length > 0) {
      additionalPayload.copy(controlBlock, 1, 0, Math.min(additionalPayload.length, 9));
    }
    const resp = await this.writeProperty({
      objectIndex,
      propertyId: KNXPropertyId.PID_LOAD_STATE_CONTROL,
      count: 1,
      startIndex: 1,
      data: controlBlock,
    });
    if (resp.data.length < 1) {
      throw new Error(`PID_LOAD_STATE_CONTROL response empty on objectIndex=${objectIndex}`);
    }
    return resp.data.readUInt8(0) as LoadState;
  }

  /**
   * `DM_RunStateMachineRead` (03_05_02 §3.36.3):
   * Reads `PID_RUN_STATE_CONTROL` (6) on `objectIndex` (default `3` = Application Program Object).
   */
  public async readRunState(objectIndex: number = 3): Promise<{ state: RunState; stateName: string }> {
    const resp = await this.readProperty({
      objectIndex,
      propertyId: KNXPropertyId.PID_RUN_STATE_CONTROL,
      count: 1,
      startIndex: 1,
    });
    if (resp.count === 0 || resp.data.length < 1) {
      throw new Error(`Unable to read PID_RUN_STATE_CONTROL on objectIndex=${objectIndex}`);
    }
    const state = resp.data.readUInt8(0) as RunState;
    return { state, stateName: RunState[state] ?? `UNKNOWN(${state})` };
  }

  /**
   * `DMP_RunStateMachineWrite_R_IO` (03_05_02 §3.34.3):
   * Writes a 10-octet Run Event (`RESTART = 1`, `STOP = 2`) to `PID_RUN_STATE_CONTROL` (6) on `objectIndex`
   * and returns the resulting `RunState`.
   */
  public async writeRunState(objectIndex: number, event: RunEvent): Promise<RunState> {
    const controlBlock = Buffer.alloc(10, 0x00);
    controlBlock.writeUInt8(event & 0xff, 0);
    const resp = await this.writeProperty({
      objectIndex,
      propertyId: KNXPropertyId.PID_RUN_STATE_CONTROL,
      count: 1,
      startIndex: 1,
      data: controlBlock,
    });
    if (resp.data.length < 1) {
      throw new Error(`PID_RUN_STATE_CONTROL response empty on objectIndex=${objectIndex}`);
    }
    return resp.data.readUInt8(0) as RunState;
  }

  /**
   * `DM_GroupObjectLink_Read` (03_05_02 §3.37.2 / 03_03_07 §3.4.6.1):
   * Reads Group Addresses linked to `groupObjectNumber` starting at `startIndex` (`1..15`).
   */
  public async readGroupObjectLinks(groupObjectNumber: number, startIndex: number = 1): Promise<DecodedLinkResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_Link_Read_Protocol_Data_Unit,
      encodeLinkReadData(groupObjectNumber, startIndex),
      false,
      APCIEnum.A_Link_Response_Protocol_Data_Unit,
    );
    return decodeLinkResponseData(apdu.data);
  }

  /**
   * `DM_GroupObjectLink_Write` (03_05_02 §3.37.3 / 03_03_07 §3.4.6.2):
   * Adds or deletes a Group Address link on `groupObjectNumber`.
   */
  public async writeGroupObjectLink(
    groupObjectNumber: number,
    groupAddress: string,
    options: { delete?: boolean; sending?: boolean } = {},
  ): Promise<DecodedLinkResponse> {
    const apdu = await this.connection.request(
      APCIEnum.A_Link_Write_Protocol_Data_Unit,
      encodeLinkWriteData(groupObjectNumber, groupAddress, options),
      false,
      APCIEnum.A_Link_Response_Protocol_Data_Unit,
    );
    return decodeLinkResponseData(apdu.data);
  }

  /**
   * Reads all Group Addresses programmed in the remote device's Group Address Table (`GrAT`, 03_05_01 §4.16.3–4.16.11).
   *
   * Automatically detects and tries the standard KNX realization types in order:
   * 1. **Property-based (`PID_TABLE = 23` on Object 1)**: System B (`0x07B0`), System 7 (`0x0705`), System 300 (`Realisation Types 6 & 7`).
   * 2. **Table Reference pointer (`PID_TABLE_REFERENCE = 7` on Object 1)**: BIM M112 (`0x0701`), BCU2 (`0x0020`, `0x0021`), Easy 2 (`Realisation Types 2 & Easy 2`).
   * 3. **Fixed memory address (`0x4000` for Mask `0x5705`, or `0x0116` for BCU1/BCU2/PL110)**: `Realisation Types 1, 4, 5, 8 & Easy 1`.
   * 4. **Link Services (`A_Link_Read`)**: Fallback for E-Mode devices that only expose Group Object Link services.
   */
  public async readGroupAddressTable(
    options: { objectIndex?: number; maxLinkObjects?: number } = {},
  ): Promise<GroupAddressTableResult> {
    const objIdx = options.objectIndex ?? 1;

    // 1. Try Property-based Group Address Table (Object 1, PID_TABLE = 23)
    try {
      const countResp = await this.readProperty({
        objectIndex: objIdx,
        propertyId: KNXPropertyId.PID_TABLE,
        count: 1,
        startIndex: 0,
      });
      if (countResp.count > 0 && countResp.data.length >= 2) {
        const totalEntries = countResp.data.readUInt16BE(0);
        const groupAddresses: string[] = [];
        let startIdx = 1;
        while (startIdx <= totalEntries) {
          const batchCount = Math.min(4, totalEntries - startIdx + 1);
          const elemResp = await this.readProperty({
            objectIndex: objIdx,
            propertyId: KNXPropertyId.PID_TABLE,
            count: batchCount,
            startIndex: startIdx,
          });
          if (elemResp.count === 0 || elemResp.data.length < 2) break;
          for (let offset = 0; offset + 2 <= elemResp.data.length; offset += 2) {
            groupAddresses.push(KNXHelper.GetAddress(elemResp.data.subarray(offset, offset + 2), "/"));
          }
          startIdx += elemResp.count;
        }
        return {
          individualAddress: this.destinationAddress,
          groupAddresses,
          method: "property_table",
        };
      }
    } catch {
      // Fall through to PID_TABLE_REFERENCE
    }

    // 2. Try Pointer-based Group Address Table (Object 1, PID_TABLE_REFERENCE = 7)
    try {
      const ptrResp = await this.readProperty({
        objectIndex: objIdx,
        propertyId: KNXPropertyId.PID_TABLE_REFERENCE,
        count: 1,
        startIndex: 1,
      });
      if (ptrResp.count > 0 && ptrResp.data.length >= 2) {
        const tablePtr = ptrResp.data.length >= 4 ? ptrResp.data.readUInt32BE(0) : ptrResp.data.readUInt16BE(0);
        if (tablePtr > 0) {
          const groupAddresses = await this.readGroupAddressesFromMemoryTable(tablePtr, false);
          return {
            individualAddress: this.destinationAddress,
            groupAddresses,
            method: "table_reference_memory",
            tableAddress: tablePtr,
          };
        }
      }
    } catch {
      // Fall through to fixed memory
    }

    // 3. Try Mask-aware Fixed Memory (0x4000 for mask 0x5705, 0x0116 for BCU1/BCU2/PL110)
    try {
      let baseAddr = 0x0116;
      let mask15Bit = false;
      try {
        const dd0 = await this.readDeviceDescriptor(0);
        if (dd0.data.length >= 2) {
          const maskVersion = dd0.data.readUInt16BE(0);
          if (maskVersion === 0x5705) {
            baseAddr = 0x4000;
          } else if (maskVersion === 0x1012 || maskVersion === 0x1013) {
            mask15Bit = true;
          }
        }
      } catch {
        // Default to 0x0116
      }

      const groupAddresses = await this.readGroupAddressesFromMemoryTable(baseAddr, mask15Bit);
      return {
        individualAddress: this.destinationAddress,
        groupAddresses,
        method: "fixed_memory",
        tableAddress: baseAddr,
      };
    } catch {
      // Fall through to Link Services
    }

    // 4. Fallback to Link Services (A_Link_Read)
    const maxObjects = options.maxLinkObjects ?? 64;
    const seen = new Set<string>();
    let anyObjectResponded = false;
    for (let goNr = 1; goNr <= maxObjects; goNr++) {
      try {
        const linkResp = await this.readGroupObjectLinks(goNr, 1);
        if (linkResp.startIndex === 0 && linkResp.groupAddresses.length === 0) {
          break;
        }
        anyObjectResponded = true;
        for (const ga of linkResp.groupAddresses) {
          seen.add(ga);
        }
      } catch {
        break;
      }
    }

    if (anyObjectResponded) {
      return {
        individualAddress: this.destinationAddress,
        groupAddresses: Array.from(seen),
        method: "link_services",
      };
    }

    throw new Error(`Unable to read Group Address Table from ${this.destinationAddress}`);
  }

  private async readGroupAddressesFromMemoryTable(tableAddress: number, mask15Bit: boolean): Promise<string[]> {
    const readMem = (addr: number, len: number) =>
      tableAddress > 0xffff ? this.readExtendedMemory(addr, len) : this.readMemory(addr, len);

    const lenBuf = await readMem(tableAddress, 1);
    if (lenBuf.length < 1) {
      throw new Error(`Empty Group Address Table length at 0x${tableAddress.toString(16)}`);
    }
    const tableLength = lenBuf.readUInt8(0);
    // In BCU/Realisation Type 1/2/4/5/8, tableLength includes the Individual Address at index 0
    if (tableLength <= 1) {
      return [];
    }
    const gaCount = tableLength - 1;
    const rawGaBytes = await readMem(tableAddress + 3, gaCount * 2);
    const groupAddresses: string[] = [];
    for (let offset = 0; offset + 2 <= rawGaBytes.length; offset += 2) {
      const slice = Buffer.from(rawGaBytes.subarray(offset, offset + 2));
      if (mask15Bit) {
        slice[0] &= 0x7f;
      }
      groupAddresses.push(KNXHelper.GetAddress(slice, "/"));
    }
    return groupAddresses;
  }

  /**
   * `DM_Identify_RCo2` (03_05_02 §3.4.3):
   * Reads Device Descriptor Type 0, Manufacturer ID, Serial Number, Hardware Type, Order Info,
   * Firmware Revision, Max APDU Length, and Programming Mode status.
   */
  public async identifyDevice(): Promise<DeviceIdentity> {
    const dd = await this.readDeviceDescriptor(0);
    const dd0Val = dd.data.length >= 2 ? dd.data.readUInt16BE(0) : 0;

    const tryReadProp = async (propertyId: number): Promise<Buffer | null> => {
      try {
        const decoded = await this.readProperty({ objectIndex: 0, propertyId, count: 1, startIndex: 1 });
        return decoded.count > 0 && decoded.data.length > 0 ? decoded.data : null;
      } catch {
        return null;
      }
    };

    const mfrBuf = await tryReadProp(KNXPropertyId.PID_MANUFACTURER_ID);
    const serialBuf = await tryReadProp(KNXPropertyId.PID_SERIAL_NUMBER);
    const hwTypeBuf = await tryReadProp(KNXPropertyId.PID_HARDWARE_TYPE);
    const orderBuf = await tryReadProp(KNXPropertyId.PID_ORDER_INFO);
    const fwRevBuf = await tryReadProp(KNXPropertyId.PID_FIRMWARE_REVISION);
    const maxApduBuf = await tryReadProp(KNXPropertyId.PID_MAX_APDULENGTH);
    const progModeBuf = await tryReadProp(KNXPropertyId.PID_PROG_MODE);

    const manufacturerId = mfrBuf && mfrBuf.length >= 2 ? mfrBuf.readUInt16BE(0) : undefined;
    const orderInfoText = orderBuf
      ? Array.from(orderBuf)
          .filter((b) => b >= 0x20 && b <= 0x7e)
          .map((b) => String.fromCharCode(b))
          .join("")
          .trim() || undefined
      : undefined;

    return {
      individualAddress: this.destinationAddress,
      descriptorType0: dd0Val,
      maskName: dd0Val ? DeviceDescriptorType0.describe(dd0Val) : undefined,
      manufacturerId,
      manufacturerName: manufacturerId !== undefined ? getKNXManufacturerName(manufacturerId) : undefined,
      serialNumber: serialBuf ? serialBuf.toString("hex").toUpperCase() : undefined,
      hardwareType: hwTypeBuf ? hwTypeBuf.toString("hex").toUpperCase() : undefined,
      orderInfo: orderBuf ? orderBuf.toString("hex").toUpperCase() : undefined,
      orderInfoText,
      firmwareRevision: fwRevBuf && fwRevBuf.length >= 1 ? fwRevBuf.readUInt8(0) : undefined,
      maxApduLength:
        maxApduBuf && maxApduBuf.length >= 2
          ? maxApduBuf.readUInt16BE(0)
          : maxApduBuf && maxApduBuf.length === 1
            ? maxApduBuf.readUInt8(0)
            : undefined,
      programmingMode: progModeBuf && progModeBuf.length >= 1 ? (progModeBuf.readUInt8(0) & 0x01) !== 0 : undefined,
    };
  }

  /**
   * `DM_Restart_RCo` (03_05_02 §3.7.3):
   * Performs either a Basic Restart (`type: "basic"`, unconfirmed) or a Master Reset (`type: "master"`, confirmed
   * with `A_Restart_Response`) and closes the local session.
   */
  public async restart(
    options: Omit<RestartOptions, "connectionless"> = {},
  ): Promise<DecodedMasterResetResponse | void> {
    if (options.type === "master") {
      const eraseCode = options.eraseCode ?? RestartEraseCode.CONFIRMED_RESTART;
      const channelNumber = options.channelNumber ?? 0x00;
      const req = encodeMasterResetApdu(eraseCode, channelNumber);
      const respApdu = await this.connection.request(
        req.apci,
        req.data,
        req.isShort,
        APCIEnum.A_Restart_Protocol_Data_Unit,
      );
      const decoded = decodeMasterResetResponse(respApdu);
      await this.connection.disconnect(false);
      return decoded;
    } else {
      const restartCemi = buildBasicRestartConnectedReq(
        this.connection.sourceAddress,
        this.destinationAddress,
        this.connection.currentTxSequence,
      );
      await this.connection.sendRestartAndAbort(restartCemi);
    }
  }
}

/**
 * Full KNX Network & Device Management Client (`03_05_02 Management Procedures`, `03_03_07 Application Layer`,
 * and `03_08_03 / 03_06_03 Local cEMI Management`) over any `KNXService` connection.
 */
export class KNXManagement {
  private readonly options: Required<
    Pick<KNXManagementOptions, "minFrameDelayMs" | "ackTimeoutMs" | "responseTimeoutMs">
  > & { sourceAddress?: string };

  constructor(
    private readonly service: KNXService,
    options: KNXManagementOptions = {},
  ) {
    this.options = {
      sourceAddress: options.sourceAddress,
      minFrameDelayMs: options.minFrameDelayMs ?? 20,
      ackTimeoutMs: options.ackTimeoutMs ?? 3000,
      responseTimeoutMs: options.responseTimeoutMs ?? 3000,
    };
  }

  public get sourceAddress(): string {
    return this.options.sourceAddress ?? this.service.individualAddress ?? "0.0.0";
  }

  private createTransportConnection(destinationAddress: string, timeoutOverrideMs?: number): TransportConnection {
    return new TransportConnection(this.service, destinationAddress, {
      sourceAddress: this.sourceAddress,
      ackTimeoutMs: timeoutOverrideMs ?? this.options.ackTimeoutMs,
      responseTimeoutMs: timeoutOverrideMs ?? this.options.responseTimeoutMs,
    });
  }

  // ============================================================================
  // 1. Session Management (`DM_Connect` / `DM_Disconnect`)
  // ============================================================================

  /**
   * Opens a persistent Transport Layer connection (`T_Connect`) to `individualAddress` and returns
   * a `KNXManagementSession` for executing multiple authenticated/sequential operations.
   */
  public async openSession(individualAddress: string): Promise<KNXManagementSession> {
    if (!KNXHelper.isValidIndividualAddress(individualAddress)) {
      throw new Error(`Invalid KNX Individual Address: ${individualAddress}`);
    }
    const conn = this.createTransportConnection(individualAddress);
    await conn.connect();
    return new KNXManagementSession(conn, this.options.minFrameDelayMs);
  }

  /**
   * Opens a `KNXManagementSession` to `individualAddress`, executes `fn(session)`, and guarantees
   * `session.close(true)` (`T_Disconnect`) when finished.
   */
  public async withSession<T>(
    individualAddress: string,
    fn: (session: KNXManagementSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.openSession(individualAddress);
    try {
      return await fn(session);
    } finally {
      if (session.isConnected) {
        await session.close(true);
      }
    }
  }

  // ============================================================================
  // 2. Network Management Procedures (`NM_*`, 03_05_02 §2)
  // ============================================================================

  /**
   * `NM_IndividualAddress_Read` (03_05_02 §2.2):
   * Broadcasts `A_IndividualAddress_Read` and waits for `timeoutMs` (default 3000 ms) to collect all
   * devices currently in Programming Mode, including detection of duplicate Individual Addresses.
   */
  public async readProgrammingModeDevices(timeoutMs: number = 3000): Promise<ProgrammingModeReadResult> {
    const seen = new Map<string, number>();
    const onIndication = (cemi: CEMIInstance) => {
      const anyCemi = cemi as any;
      if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
      const tpdu = anyCemi.TPDU ?? anyCemi.tpdu;
      const apciCmd = tpdu?.apdu?.apci?.value;
      if (apciCmd === APCIEnum.A_IndividualAddress_Response_Protocol_Data_Unit && anyCemi.sourceAddress) {
        const src: string = anyCemi.sourceAddress;
        seen.set(src, (seen.get(src) ?? 0) + 1);
      }
    };

    this.service.on("indication", onIndication);
    try {
      const req = buildIndividualAddressReadReq(this.sourceAddress);
      await this.service.send(req);
      await delay(timeoutMs);
    } finally {
      this.service.removeListener("indication", onIndication);
    }

    const addresses = Array.from(seen.keys());
    const duplicates = Array.from(seen.entries())
      .filter(([, count]) => count > 1)
      .map(([addr]) => addr);

    return { addresses, duplicates };
  }

  /**
   * `NM_IndividualAddress_Write` (03_05_02 §2.3):
   * Programs the Individual Address of a single device that has its Programming Mode active:
   * 1. Checks if `newAddress` is already occupied on the bus.
   * 2. Reads devices in Programming Mode (`A_IndividualAddress_Read`) and verifies that exactly one device responds.
   * 3. Sends `A_IndividualAddress_Write(newAddress)` if `newAddress !== currentAddress`.
   * 4. Verifies the new address via `T_Connect` + `A_DeviceDescriptor_Read(0)` and deactivates Programming Mode
   *    with a Basic `A_Restart` (`restart_type = 0`).
   */
  public async writeIndividualAddress(
    newAddress: string,
    options: { progModeTimeoutMs?: number; checkOccupiedTimeoutMs?: number } = {},
  ): Promise<IndividualAddressWriteResult> {
    if (!KNXHelper.isValidIndividualAddress(newAddress)) {
      throw new Error(`Invalid KNX Individual Address: ${newAddress}`);
    }

    const isOccupied = await this.isAddressOccupied(newAddress, options.checkOccupiedTimeoutMs ?? 1000);
    const progMode = await this.readProgrammingModeDevices(options.progModeTimeoutMs ?? 1000);

    if (progMode.addresses.length === 0) {
      throw new Error("NM_IndividualAddress_Write failed: no device is in Programming Mode");
    }
    if (progMode.addresses.length > 1 || progMode.duplicates.length > 0) {
      throw new Error(
        `NM_IndividualAddress_Write aborted: multiple devices in Programming Mode (${progMode.addresses.join(", ")})`,
      );
    }

    const currentAddress = progMode.addresses[0];
    if (isOccupied && currentAddress !== newAddress) {
      throw new Error(
        `NM_IndividualAddress_Write aborted: target address ${newAddress} is already occupied by another device (device in Programming Mode is at ${currentAddress})`,
      );
    }

    if (newAddress !== currentAddress) {
      const writeCemi = buildIndividualAddressWriteReq(this.sourceAddress, newAddress);
      await this.service.send(writeCemi);
      if (this.options.minFrameDelayMs > 0) {
        await delay(this.options.minFrameDelayMs);
      }
    }

    const conn = this.createTransportConnection(newAddress);
    try {
      await conn.connect();
      const ddResp = await conn.request(
        APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit,
        Buffer.from([0x00]),
        true,
        APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit,
      );
      if (ddResp.data.length < 2) {
        throw new Error(`Invalid A_DeviceDescriptor_Response length: ${ddResp.data.length}`);
      }
      const descriptorType0 = new DeviceDescriptorType0(ddResp.data.readUInt16BE(0));

      const restartCemi = buildBasicRestartConnectedReq(this.sourceAddress, newAddress, conn.currentTxSequence);
      await conn.sendRestartAndAbort(restartCemi);

      return {
        previousAddress: currentAddress,
        newAddress,
        descriptorType0,
      };
    } catch (err) {
      await conn.disconnect(false);
      throw err;
    }
  }

  /**
   * `NM_IndividualAddress_Reset` (03_05_02 §2.18):
   * Resets the Individual Address of the single device currently in Programming Mode to the default
   * unassigned address `15.15.255` (`0xFFFF`) and sends a Basic `A_Restart`.
   */
  public async resetIndividualAddress(options: { progModeTimeoutMs?: number } = {}): Promise<{
    previousAddress: string;
    resetAddress: string;
  }> {
    const progMode = await this.readProgrammingModeDevices(options.progModeTimeoutMs ?? 1000);
    if (progMode.addresses.length === 0) {
      throw new Error("NM_IndividualAddress_Reset failed: no device is in Programming Mode");
    }
    if (progMode.addresses.length > 1 || progMode.duplicates.length > 0) {
      throw new Error(
        `NM_IndividualAddress_Reset aborted: multiple devices in Programming Mode (${progMode.addresses.join(", ")})`,
      );
    }

    const previousAddress = progMode.addresses[0];
    const resetAddress = "15.15.255";

    await this.service.send(buildIndividualAddressWriteReq(this.sourceAddress, resetAddress));
    if (this.options.minFrameDelayMs > 0) {
      await delay(this.options.minFrameDelayMs);
    }

    const conn = this.createTransportConnection(resetAddress);
    try {
      await conn.connect();
      const restartCemi = buildBasicRestartConnectedReq(this.sourceAddress, resetAddress, conn.currentTxSequence);
      await conn.sendRestartAndAbort(restartCemi);
    } catch {
      await conn.disconnect(false);
    }

    return { previousAddress, resetAddress };
  }

  /**
   * `NM_IndividualAddress_SerialNumber_Read` (03_05_02 §2.4):
   * Reads the current Individual Address and Domain Address of a device given its 6-byte KNX Serial Number.
   */
  public async readIndividualAddressBySerial(
    serialNumber: Buffer,
    timeoutMs: number = 3000,
  ): Promise<SerialNumberAddressResult | null> {
    if (serialNumber.length !== 6) {
      throw new Error(`Invalid KNX Serial Number length: ${serialNumber.length} (expected 6 bytes)`);
    }

    return new Promise<SerialNumberAddressResult | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.service.removeListener("indication", onIndication);
        resolve(null);
      }, timeoutMs);

      const onIndication = (cemi: CEMIInstance) => {
        const anyCemi = cemi as any;
        if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
        const tpdu = anyCemi.TPDU ?? anyCemi.tpdu;
        const apdu = tpdu?.apdu;
        if (apdu?.apci?.value !== APCIEnum.A_IndividualAddressSerialNumber_Response_Protocol_Data_Unit) return;
        if (!apdu.data || apdu.data.length < 6) return;
        const rxSerial = apdu.data.subarray(0, 6);
        if (!rxSerial.equals(serialNumber)) return;

        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        const domainAddress = apdu.data.length >= 8 ? Buffer.from(apdu.data.subarray(6, 8)) : Buffer.alloc(2, 0);
        resolve({
          individualAddress: anyCemi.sourceAddress,
          serialNumber: Buffer.from(rxSerial),
          domainAddress,
        });
      };

      this.service.on("indication", onIndication);
      const req = buildIndividualAddressSerialNumberReadReq(this.sourceAddress, serialNumber);
      this.service.send(req).catch((err) => {
        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        reject(err);
      });
    });
  }

  /**
   * `NM_IndividualAddress_SerialNumber_Write` (03_05_02 §2.5):
   * Programs the Individual Address of a device identified by its 6-byte KNX Serial Number
   * without requiring physical button press, and verifies the assignment via `A_IndividualAddressSerialNumber_Read`.
   */
  public async writeIndividualAddressBySerial(
    serialNumber: Buffer,
    newAddress: string,
    options: { checkOccupied?: boolean; verifyTimeoutMs?: number } = {},
  ): Promise<SerialNumberAddressResult> {
    if (serialNumber.length !== 6) {
      throw new Error(`Invalid KNX Serial Number length: ${serialNumber.length} (expected 6 bytes)`);
    }
    if (!KNXHelper.isValidIndividualAddress(newAddress)) {
      throw new Error(`Invalid KNX Individual Address: ${newAddress}`);
    }

    const verifyTimeout = options.verifyTimeoutMs ?? 3000;

    if (options.checkOccupied ?? true) {
      const current = await this.readIndividualAddressBySerial(serialNumber, verifyTimeout);
      if (current && current.individualAddress !== newAddress) {
        const occupied = await this.isAddressOccupied(newAddress, 1000);
        if (occupied) {
          throw new Error(
            `NM_IndividualAddress_SerialNumber_Write aborted: target address ${newAddress} is already occupied`,
          );
        }
      }
    }

    const writeReq = buildIndividualAddressSerialNumberWriteReq(this.sourceAddress, serialNumber, newAddress);
    await this.service.send(writeReq);

    if (this.options.minFrameDelayMs > 0) {
      await delay(this.options.minFrameDelayMs);
    }

    const verified = await this.readIndividualAddressBySerial(serialNumber, verifyTimeout);
    if (!verified || verified.individualAddress !== newAddress) {
      throw new Error(
        `NM_IndividualAddress_SerialNumber_Write verification failed: expected ${newAddress}, got ${verified?.individualAddress ?? "no response"}`,
      );
    }

    return verified;
  }

  /**
   * `NM_DomainAddress_Read` (03_05_02 §2.7 / 03_03_07 §3.3.4):
   * Reads Domain Addresses from devices currently in Programming Mode.
   */
  public async readDomainAddress(
    options: { timeoutMs?: number; systemBroadcast?: boolean } = {},
  ): Promise<{ sourceAddress: string; domainAddress: Buffer }[]> {
    const results: { sourceAddress: string; domainAddress: Buffer }[] = [];
    const onIndication = (cemi: CEMIInstance) => {
      const anyCemi = cemi as any;
      if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
      const apdu = (anyCemi.TPDU ?? anyCemi.tpdu)?.apdu;
      if (apdu?.apci?.value === APCIEnum.A_DomainAddress_Response_Protocol_Data_Unit && apdu.data) {
        results.push({
          sourceAddress: anyCemi.sourceAddress,
          domainAddress: Buffer.from(apdu.data),
        });
      }
    };

    this.service.on("indication", onIndication);
    try {
      await this.service.send(buildDomainAddressReadReq(this.sourceAddress, options.systemBroadcast ?? true));
      await delay(options.timeoutMs ?? 3000);
    } finally {
      this.service.removeListener("indication", onIndication);
    }
    return results;
  }

  /**
   * `NM_DomainAddress_Write` (03_03_07 §3.3.3):
   * Writes a 2-byte (PL110) or 6-byte (RF) Domain Address to the device in Programming Mode.
   */
  public async writeDomainAddress(domainAddress: Buffer, options: { systemBroadcast?: boolean } = {}): Promise<void> {
    const req = buildDomainAddressWriteReq(this.sourceAddress, domainAddress, options.systemBroadcast ?? true);
    await this.service.send(req);
  }

  /**
   * `A_DomainAddressSelective_Read` (03_05_02 §2.14 / 03_03_07 §3.3.5):
   * Selectively reads 2-byte Domain Addresses in `[startAddress .. startAddress + range]`.
   */
  public async readDomainAddressSelective(
    domainAddress2B: Buffer,
    startAddress: string,
    range: number,
    options: { timeoutMs?: number; systemBroadcast?: boolean } = {},
  ): Promise<{ sourceAddress: string; domainAddress: Buffer }[]> {
    const results: { sourceAddress: string; domainAddress: Buffer }[] = [];
    const onIndication = (cemi: CEMIInstance) => {
      const anyCemi = cemi as any;
      if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
      const apdu = (anyCemi.TPDU ?? anyCemi.tpdu)?.apdu;
      if (apdu?.apci?.value === APCIEnum.A_DomainAddress_Response_Protocol_Data_Unit && apdu.data) {
        results.push({
          sourceAddress: anyCemi.sourceAddress,
          domainAddress: Buffer.from(apdu.data),
        });
      }
    };

    this.service.on("indication", onIndication);
    try {
      const req = buildDomainAddressSelectiveReadReq(
        this.sourceAddress,
        domainAddress2B,
        startAddress,
        range,
        options.systemBroadcast ?? true,
      );
      await this.service.send(req);
      await delay(options.timeoutMs ?? 3000);
    } finally {
      this.service.removeListener("indication", onIndication);
    }
    return results;
  }

  /**
   * `A_DomainAddressSerialNumber_Read` (03_03_07 §3.3.6):
   * Reads the Domain Address of a device identified by its 6-byte KNX Serial Number.
   */
  public async readDomainAddressBySerial(
    serialNumber: Buffer,
    options: { timeoutMs?: number; systemBroadcast?: boolean } = {},
  ): Promise<{ sourceAddress: string; serialNumber: Buffer; domainAddress: Buffer } | null> {
    if (serialNumber.length !== 6) {
      throw new Error(`Invalid KNX Serial Number length: ${serialNumber.length} (expected 6 bytes)`);
    }
    const timeoutMs = options.timeoutMs ?? 3000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.service.removeListener("indication", onIndication);
        resolve(null);
      }, timeoutMs);

      const onIndication = (cemi: CEMIInstance) => {
        const anyCemi = cemi as any;
        if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
        const apdu = (anyCemi.TPDU ?? anyCemi.tpdu)?.apdu;
        if (apdu?.apci?.value !== APCIEnum.A_DomainAddressSerialNumber_Response_Protocol_Data_Unit) return;
        if (!apdu.data || apdu.data.length < 8) return;
        const rxSerial = apdu.data.subarray(0, 6);
        if (!rxSerial.equals(serialNumber)) return;

        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        resolve({
          sourceAddress: anyCemi.sourceAddress,
          serialNumber: Buffer.from(rxSerial),
          domainAddress: Buffer.from(apdu.data.subarray(6)),
        });
      };

      this.service.on("indication", onIndication);
      const req = buildDomainAddressSerialNumberReadReq(
        this.sourceAddress,
        serialNumber,
        options.systemBroadcast ?? true,
      );
      this.service.send(req).catch((err) => {
        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        reject(err);
      });
    });
  }

  /**
   * `NM_DomainAddressSerialNumber_Write` (03_05_02 §2.12 / 03_03_07 §3.3.7):
   * Writes the Domain Address of a device identified by its 6-byte KNX Serial Number.
   */
  public async writeDomainAddressBySerial(
    serialNumber: Buffer,
    domainAddress: Buffer,
    options: { systemBroadcast?: boolean } = {},
  ): Promise<void> {
    const req = buildDomainAddressSerialNumberWriteReq(
      this.sourceAddress,
      serialNumber,
      domainAddress,
      options.systemBroadcast ?? true,
    );
    await this.service.send(req);
  }

  /**
   * `NM_NetworkParameter_Read_R` (03_05_02 §2.23 / 03_03_07 §3.2.6):
   * Reads a network parameter via broadcast or unicast (`A_NetworkParameter_Read`).
   */
  public async readNetworkParameter(
    params: NetworkParameterParams,
    options: { individualAddress?: string; timeoutMs?: number } = {},
  ): Promise<{ sourceAddress: string; objectType: number; propertyId: number; data: Buffer }[]> {
    const results: { sourceAddress: string; objectType: number; propertyId: number; data: Buffer }[] = [];
    const payload = encodeNetworkParameterData(params);

    const onIndication = (cemi: CEMIInstance) => {
      const anyCemi = cemi as any;
      if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
      if (options.individualAddress && anyCemi.sourceAddress !== options.individualAddress) return;
      const apdu = (anyCemi.TPDU ?? anyCemi.tpdu)?.apdu;
      if (apdu?.apci?.value === APCIEnum.A_NetworkParameter_Response_Protocol_Data_Unit && apdu.data?.length >= 3) {
        const decoded = decodeNetworkParameterResponseData(apdu.data);
        if (decoded.objectType === params.objectType && decoded.propertyId === params.propertyId) {
          results.push({ sourceAddress: anyCemi.sourceAddress, ...decoded });
        }
      }
    };

    this.service.on("indication", onIndication);
    try {
      const req = options.individualAddress
        ? buildIndividualLDataReq(
            this.sourceAddress,
            options.individualAddress,
            APCIEnum.A_NetworkParameter_Read_Protocol_Data_Unit,
            payload,
            false,
          )
        : buildBroadcastLDataReq(
            this.sourceAddress,
            APCIEnum.A_NetworkParameter_Read_Protocol_Data_Unit,
            payload,
            false,
          );
      await this.service.send(req);
      await delay(options.timeoutMs ?? 1500);
    } finally {
      this.service.removeListener("indication", onIndication);
    }
    return results;
  }

  /**
   * `NM_NetworkParameter_Write_R` (03_05_02 §2.22 / 03_03_07 §3.2.7):
   * Writes a network parameter via broadcast or unicast (`A_NetworkParameter_Write`).
   */
  public async writeNetworkParameter(
    params: NetworkParameterParams,
    options: { individualAddress?: string } = {},
  ): Promise<void> {
    const payload = encodeNetworkParameterData(params);
    const req = options.individualAddress
      ? buildIndividualLDataReq(
          this.sourceAddress,
          options.individualAddress,
          APCIEnum.A_NetworkParameter_Write_Protocol_Data_Unit,
          payload,
          false,
        )
      : buildBroadcastLDataReq(
          this.sourceAddress,
          APCIEnum.A_NetworkParameter_Write_Protocol_Data_Unit,
          payload,
          false,
        );
    await this.service.send(req);
  }

  /**
   * `A_SystemNetworkParameter_Read` (03_05_02 §2.20 / 03_03_07 §3.3.8):
   * Reads a system network parameter over system broadcast or broadcast.
   */
  public async readSystemNetworkParameter(
    params: NetworkParameterParams,
    options: { timeoutMs?: number; systemBroadcast?: boolean } = {},
  ): Promise<{ sourceAddress: string; objectType: number; propertyId: number; data: Buffer }[]> {
    const results: { sourceAddress: string; objectType: number; propertyId: number; data: Buffer }[] = [];
    const payload = encodeSystemNetworkParameterData(params);

    const onIndication = (cemi: CEMIInstance) => {
      const anyCemi = cemi as any;
      if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
      const apdu = (anyCemi.TPDU ?? anyCemi.tpdu)?.apdu;
      if (
        apdu?.apci?.value === APCIEnum.A_SystemNetworkParameter_Response_Protocol_Data_Unit &&
        apdu.data?.length >= 4
      ) {
        const decoded = decodeSystemNetworkParameterResponseData(apdu.data);
        if (decoded.objectType === params.objectType && decoded.propertyId === params.propertyId) {
          results.push({ sourceAddress: anyCemi.sourceAddress, ...decoded });
        }
      }
    };

    this.service.on("indication", onIndication);
    try {
      const builder = (options.systemBroadcast ?? true) ? buildSystemBroadcastLDataReq : buildBroadcastLDataReq;
      await this.service.send(
        builder(this.sourceAddress, APCIEnum.A_SystemNetworkParameter_Read_Protocol_Data_Unit, payload, false),
      );
      await delay(options.timeoutMs ?? 1500);
    } finally {
      this.service.removeListener("indication", onIndication);
    }
    return results;
  }

  /**
   * `A_SystemNetworkParameter_Write` (03_05_02 §2.21 / 03_03_07 §3.3.9):
   * Writes a system network parameter over system broadcast or broadcast.
   */
  public async writeSystemNetworkParameter(
    params: NetworkParameterParams,
    options: { systemBroadcast?: boolean } = {},
  ): Promise<void> {
    const payload = encodeSystemNetworkParameterData(params);
    const builder = (options.systemBroadcast ?? true) ? buildSystemBroadcastLDataReq : buildBroadcastLDataReq;
    await this.service.send(
      builder(this.sourceAddress, APCIEnum.A_SystemNetworkParameter_Write_Protocol_Data_Unit, payload, false),
    );
  }

  /**
   * Checks whether an Individual Address is currently occupied on the KNX bus (03_05_02 §2.3 step 1 / §2.19).
   * An address is considered occupied if the device responds to `A_DeviceDescriptor_Read(0)` or immediately
   * rejects the Transport Layer connection with a `T_Disconnect-PDU`.
   */
  public async isAddressOccupied(individualAddress: string, timeoutMs: number = 1500): Promise<boolean> {
    if (!KNXHelper.isValidIndividualAddress(individualAddress)) {
      throw new Error(`Invalid KNX Individual Address: ${individualAddress}`);
    }

    const conn = this.createTransportConnection(individualAddress, timeoutMs);
    try {
      await conn.connect();
      await conn.request(
        APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit,
        Buffer.from([0x00]),
        true,
        APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit,
      );
      return true;
    } catch {
      return conn.remoteDisconnected;
    } finally {
      await conn.disconnect(true);
    }
  }

  /**
   * Executes the exact ETS Individual Address check sequence:
   * `T_Connect` -> `A_DeviceDescriptor_Read(0)` -> `A_PropertyValue_Read(PID_MAX_APDULENGTH)`
   * -> `A_PropertyValue_Read(PID_PROG_MODE)` -> `T_Disconnect`.
   */
  public async checkIndividualAddress(individualAddress: string): Promise<IndividualAddressCheckResult> {
    return this.withSession(individualAddress, async (session) => {
      const dd = await session.readDeviceDescriptor(0);
      if (!dd.descriptorType0) {
        throw new Error("DeviceDescriptor_Response data too short");
      }

      const decodedApduLen = await session.readProperty({
        objectIndex: 0,
        propertyId: KNXPropertyId.PID_MAX_APDULENGTH,
        count: 1,
        startIndex: 1,
      });
      const maxApduLength =
        decodedApduLen.data.length >= 2
          ? decodedApduLen.data.readUInt16BE(0)
          : decodedApduLen.data.length === 1
            ? decodedApduLen.data.readUInt8(0)
            : 15;

      const decodedProgMode = await session.readProperty({
        objectIndex: 0,
        propertyId: KNXPropertyId.PID_PROG_MODE,
        count: 1,
        startIndex: 1,
      });
      const programmingMode = decodedProgMode.data.length >= 1 && (decodedProgMode.data.readUInt8(0) & 0x01) !== 0;

      return {
        individualAddress,
        descriptorType0: dd.descriptorType0,
        maxApduLength,
        programmingMode,
      };
    });
  }

  /**
   * Scans a subnetwork line (e.g. `"1.1"`) for existing devices (`NM_SubnetworkDevices_Scan` / `Scan2`, 03_05_02 §2.16–2.17).
   */
  public async scanLine(subnetworkAddress: string, options: ScanLineOptions = {}): Promise<string[]> {
    const parts = subnetworkAddress.split(".");
    if (parts.length !== 2) {
      throw new Error(`Invalid subnetworkAddress "${subnetworkAddress}" (expected "area.line", e.g. "1.1")`);
    }
    const [startDev, endDev] = options.range ?? [1, 255];
    const method = options.method ?? "connect";
    const timeoutMs = options.timeoutPerAddressMs ?? 250;
    const discovered: string[] = [];

    for (let dev = startDev; dev <= endDev; dev++) {
      const ia = `${parts[0]}.${parts[1]}.${dev}`;
      const exists =
        method === "connect"
          ? await this.isAddressOccupied(ia, timeoutMs)
          : await this.pingDescriptorConnectionless(ia, timeoutMs);
      if (exists) {
        discovered.push(ia);
      }
    }

    return discovered;
  }

  /**
   * Exports a structured JSON-ready inventory for a list of Individual Addresses.
   */
  public async exportInventory(addresses: string[]): Promise<DeviceIdentity[]> {
    const inventory: DeviceIdentity[] = [];
    for (const ia of addresses) {
      inventory.push(await this.identifyDevice(ia));
    }
    return inventory;
  }

  // ============================================================================
  // 3. One-Shot Device Management Helpers (`DM_*`, 03_05_02 §3)
  // ============================================================================

  public async readDeviceDescriptor(
    individualAddress: string,
    descriptorType: number = 0,
  ): Promise<{ descriptorType: number; data: Buffer; descriptorType0?: DeviceDescriptorType0 }> {
    return this.withSession(individualAddress, (s) => s.readDeviceDescriptor(descriptorType));
  }

  public async identifyDevice(individualAddress: string): Promise<DeviceIdentity> {
    return this.withSession(individualAddress, (s) => s.identifyDevice());
  }

  public async authorize(individualAddress: string, key: number | Buffer = 0xffffffff): Promise<number> {
    return this.withSession(individualAddress, (s) => s.authorize(key));
  }

  public async setKey(
    individualAddress: string,
    level: number,
    key: number | Buffer,
    authKey?: number | Buffer,
  ): Promise<number> {
    return this.withSession(individualAddress, async (s) => {
      if (authKey !== undefined) {
        await s.authorize(authKey);
      }
      return s.setKey(level, key);
    });
  }

  public async readProperty(
    individualAddress: string,
    params: PropertyValueReadParams,
  ): Promise<DecodedPropertyValueResponse> {
    return this.withSession(individualAddress, (s) => s.readProperty(params));
  }

  public async writeProperty(
    individualAddress: string,
    params: PropertyValueWriteParams,
    options: { verify?: boolean; authKey?: number | Buffer } = {},
  ): Promise<DecodedPropertyValueResponse> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      return s.writeProperty(params, { verify: options.verify });
    });
  }

  public async readPropertyDescription(
    individualAddress: string,
    params: PropertyDescriptionReadParams,
  ): Promise<DecodedPropertyDescriptionResponse> {
    return this.withSession(individualAddress, (s) => s.readPropertyDescription(params));
  }

  public async scanObjectProperties(
    individualAddress: string,
    objectIndex: number = 0,
    maxProperties: number = 128,
  ): Promise<DecodedPropertyDescriptionResponse[]> {
    return this.withSession(individualAddress, (s) => s.scanObjectProperties(objectIndex, maxProperties));
  }

  public async callFunctionProperty(
    individualAddress: string,
    params: FunctionPropertyParams,
  ): Promise<DecodedFunctionPropertyResponse> {
    return this.withSession(individualAddress, (s) => s.callFunctionProperty(params));
  }

  public async readFunctionPropertyState(
    individualAddress: string,
    params: FunctionPropertyParams,
  ): Promise<DecodedFunctionPropertyResponse> {
    return this.withSession(individualAddress, (s) => s.readFunctionPropertyState(params));
  }

  public async readPropertyExtended(
    individualAddress: string,
    params: PropertyExtValueReadParams,
  ): Promise<DecodedPropertyExtValueResponse> {
    return this.withSession(individualAddress, (s) => s.readPropertyExtended(params));
  }

  public async writePropertyExtended(
    individualAddress: string,
    params: PropertyExtValueWriteParams,
    options: { confirmed?: boolean } = {},
  ): Promise<{ returnCode: number } | void> {
    return this.withSession(individualAddress, (s) => s.writePropertyExtended(params, options));
  }

  public async readPropertyDescriptionExtended(
    individualAddress: string,
    params: PropertyExtDescriptionReadParams,
  ): Promise<DecodedPropertyExtDescriptionResponse> {
    return this.withSession(individualAddress, (s) => s.readPropertyDescriptionExtended(params));
  }

  public async callFunctionPropertyExtended(
    individualAddress: string,
    params: FunctionPropertyExtParams,
  ): Promise<DecodedFunctionPropertyExtResponse> {
    return this.withSession(individualAddress, (s) => s.callFunctionPropertyExtended(params));
  }

  public async readFunctionPropertyStateExtended(
    individualAddress: string,
    params: FunctionPropertyExtParams,
  ): Promise<DecodedFunctionPropertyExtResponse> {
    return this.withSession(individualAddress, (s) => s.readFunctionPropertyStateExtended(params));
  }

  public async readProgrammingMode(individualAddress: string): Promise<boolean> {
    return this.withSession(individualAddress, (s) => s.readProgrammingMode());
  }

  public async setProgrammingMode(individualAddress: string, enabled: boolean): Promise<void> {
    return this.withSession(individualAddress, (s) => s.setProgrammingMode(enabled));
  }

  public async readPeiType(individualAddress: string): Promise<number> {
    return this.withSession(individualAddress, (s) => s.readPeiType());
  }

  public async readUserManufacturerInfo(
    individualAddress: string,
  ): Promise<{ manufacturerId: number; manufacturerSpecific: Buffer }> {
    return this.withSession(individualAddress, (s) => s.readUserManufacturerInfo());
  }

  public async readAdc(
    individualAddress: string,
    channelNr: number,
    readCount: number = 1,
  ): Promise<{ channelNr: number; readCount: number; sum: number }> {
    return this.withSession(individualAddress, (s) => s.readAdc(channelNr, readCount));
  }

  public async readMemory(
    individualAddress: string,
    memoryAddress: number,
    length: number,
    options: { maxChunkSize?: number; authKey?: number | Buffer } = {},
  ): Promise<Buffer> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      return s.readMemory(memoryAddress, length, { maxChunkSize: options.maxChunkSize });
    });
  }

  public async writeMemory(
    individualAddress: string,
    memoryAddress: number,
    data: Buffer,
    options: MemoryWriteOptions & { authKey?: number | Buffer } = {},
  ): Promise<void> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      await s.writeMemory(memoryAddress, data, options);
    });
  }

  public async writeMemoryBit(
    individualAddress: string,
    memoryAddress: number,
    andData: Buffer,
    xorData: Buffer,
    options: { verifyModeActive?: boolean; authKey?: number | Buffer } = {},
  ): Promise<void> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      await s.writeMemoryBit(memoryAddress, andData, xorData, options);
    });
  }

  public async readUserMemory(
    individualAddress: string,
    memoryAddress20: number,
    length: number,
    options: { maxChunkSize?: number; authKey?: number | Buffer } = {},
  ): Promise<Buffer> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      return s.readUserMemory(memoryAddress20, length, { maxChunkSize: options.maxChunkSize });
    });
  }

  public async writeUserMemory(
    individualAddress: string,
    memoryAddress20: number,
    data: Buffer,
    options: MemoryWriteOptions & { authKey?: number | Buffer } = {},
  ): Promise<void> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      await s.writeUserMemory(memoryAddress20, data, options);
    });
  }

  public async writeUserMemoryBit(
    individualAddress: string,
    memoryAddress16: number,
    andData: Buffer,
    xorData: Buffer,
    options: { verifyModeActive?: boolean; authKey?: number | Buffer } = {},
  ): Promise<void> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      await s.writeUserMemoryBit(memoryAddress16, andData, xorData, options);
    });
  }

  public async readExtendedMemory(
    individualAddress: string,
    memoryAddress24: number,
    length: number,
    options: { maxChunkSize?: number; authKey?: number | Buffer } = {},
  ): Promise<Buffer> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      return s.readExtendedMemory(memoryAddress24, length, { maxChunkSize: options.maxChunkSize });
    });
  }

  public async writeExtendedMemory(
    individualAddress: string,
    memoryAddress24: number,
    data: Buffer,
    options: { maxChunkSize?: number; authKey?: number | Buffer } = {},
  ): Promise<void> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      await s.writeExtendedMemory(memoryAddress24, data, { maxChunkSize: options.maxChunkSize });
    });
  }

  public async readLoadState(
    individualAddress: string,
    objectIndexes: number[] = [1, 2, 3],
  ): Promise<{ objectIndex: number; state: LoadState; stateName: string }[]> {
    return this.withSession(individualAddress, (s) => s.readLoadState(objectIndexes));
  }

  public async writeLoadState(
    individualAddress: string,
    objectIndex: number,
    event: LoadEvent,
    additionalPayload?: Buffer,
  ): Promise<LoadState> {
    return this.withSession(individualAddress, (s) => s.writeLoadState(objectIndex, event, additionalPayload));
  }

  public async readRunState(
    individualAddress: string,
    objectIndex: number = 3,
  ): Promise<{ state: RunState; stateName: string }> {
    return this.withSession(individualAddress, (s) => s.readRunState(objectIndex));
  }

  public async writeRunState(individualAddress: string, objectIndex: number, event: RunEvent): Promise<RunState> {
    return this.withSession(individualAddress, (s) => s.writeRunState(objectIndex, event));
  }

  public async readGroupObjectLinks(
    individualAddress: string,
    groupObjectNumber: number,
    startIndex: number = 1,
  ): Promise<DecodedLinkResponse> {
    return this.withSession(individualAddress, (s) => s.readGroupObjectLinks(groupObjectNumber, startIndex));
  }

  public async writeGroupObjectLink(
    individualAddress: string,
    groupObjectNumber: number,
    groupAddress: string,
    options: { delete?: boolean; sending?: boolean } = {},
  ): Promise<DecodedLinkResponse> {
    return this.withSession(individualAddress, (s) => s.writeGroupObjectLink(groupObjectNumber, groupAddress, options));
  }

  /**
   * Reads all Group Addresses programmed in a remote device's Group Address Table (`GrAT`, 03_05_01 §4.16.3–4.16.11).
   *
   * Automatically detects and supports:
   * - Property-based tables (`PID_TABLE = 23` on Object 1, System B / System 7 / System 300)
   * - Pointer-referenced memory tables (`PID_TABLE_REFERENCE = 7` on Object 1, BCU2 / BIM M112)
   * - Fixed memory tables (`0x0116` on BCU1/BCU2/PL110 and `0x4000` on Mask `0x5705`)
   * - Group Object Link services (`A_Link_Read`)
   */
  public async readDeviceGroupAddresses(
    individualAddress: string,
    options: { objectIndex?: number; maxLinkObjects?: number; authKey?: number | Buffer } = {},
  ): Promise<GroupAddressTableResult> {
    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      return s.readGroupAddressTable(options);
    });
  }

  /**
   * `DM_Restart` (03_05_02 §3.7):
   * Performs a Basic Restart (`type: "basic"`) or a Master Reset (`type: "master"`) over either
   * a connected `T_Connect` session (`DM_Restart_RCo`, default) or connectionless `T_Data_Individual` (`DM_Restart_RCl`).
   */
  public async restartDevice(
    individualAddress: string,
    options: RestartOptions & { authKey?: number | Buffer } = {},
  ): Promise<DecodedMasterResetResponse | void> {
    if (options.connectionless) {
      if (options.type === "master") {
        const eraseCode = options.eraseCode ?? RestartEraseCode.CONFIRMED_RESTART;
        const channelNumber = options.channelNumber ?? 0x00;
        const reqSpec = encodeMasterResetApdu(eraseCode, channelNumber);
        const reqCemi = buildIndividualLDataReq(
          this.sourceAddress,
          individualAddress,
          reqSpec.apci,
          reqSpec.data,
          reqSpec.isShort,
        );
        return new Promise<DecodedMasterResetResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.service.removeListener("indication", onIndication);
            reject(new Error(`Timeout waiting for connectionless A_Restart_Response from ${individualAddress}`));
          }, this.options.responseTimeoutMs);

          const onIndication = (cemi: CEMIInstance) => {
            const anyCemi = cemi as any;
            if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
            if (anyCemi.sourceAddress !== individualAddress) return;
            const apdu = (anyCemi.TPDU ?? anyCemi.tpdu)?.apdu;
            if (!apdu || (apdu.apci.value & 0x03c0) !== APCIEnum.A_Restart_Protocol_Data_Unit) return;
            clearTimeout(timer);
            this.service.removeListener("indication", onIndication);
            resolve(decodeMasterResetResponse(apdu));
          };

          this.service.on("indication", onIndication);
          this.service.send(reqCemi).catch((err) => {
            clearTimeout(timer);
            this.service.removeListener("indication", onIndication);
            reject(err);
          });
        });
      } else {
        await this.service.send(buildBasicRestartIndividualReq(this.sourceAddress, individualAddress));
        return;
      }
    }

    return this.withSession(individualAddress, async (s) => {
      if (options.authKey !== undefined) {
        await s.authorize(options.authKey);
      }
      return s.restart(options);
    });
  }

  // ============================================================================
  // 4. Local cEMI Device Management (`DMP_*_R_KNXnetIPDeviceManagement` / `LcEMI`, 03_08_03 / 03_06_03)
  // ============================================================================

  /**
   * Reads a local property on the connected interface/gateway using cEMI `M_PropRead.req` (`0xFC`)
   * and awaits `M_PropRead.con` (`0xFB`).
   */
  public async readLocalProperty(
    params: LocalPropertyReadParams,
    timeoutMs: number = this.options.responseTimeoutMs,
  ): Promise<{
    objectType: number;
    objectInstance: number;
    propertyId: number;
    count: number;
    startIndex: number;
    data: Buffer;
  }> {
    const objectInstance = params.objectInstance ?? 1;
    const count = params.count ?? 1;
    const startIndex = params.startIndex ?? 1;
    const req = new CEMI.ManagementCEMI["M_PropRead.req"](
      params.objectType,
      objectInstance,
      params.propertyId,
      count,
      startIndex,
    );

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.service.removeListener("indication", onIndication);
        reject(
          new Error(`Timeout waiting for M_PropRead.con (objectType=${params.objectType}, pid=${params.propertyId})`),
        );
      }, timeoutMs);

      const onIndication = (cemi: CEMIInstance) => {
        const anyCemi = cemi as any;
        if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["M_PropRead.con"].CEMI.value) return;
        if (
          anyCemi.interfaceObjectType !== params.objectType ||
          anyCemi.objectInstance !== objectInstance ||
          anyCemi.propertyId !== params.propertyId
        ) {
          return;
        }
        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        if (anyCemi.numberOfElements === 0) {
          const errCode = anyCemi.data?.length >= 1 ? anyCemi.data.readUInt8(0) : 0;
          reject(
            new Error(
              `M_PropRead.con negative confirmation (errorCode=0x${errCode.toString(16)}) for PID ${params.propertyId}`,
            ),
          );
          return;
        }
        resolve({
          objectType: anyCemi.interfaceObjectType,
          objectInstance: anyCemi.objectInstance,
          propertyId: anyCemi.propertyId,
          count: anyCemi.numberOfElements,
          startIndex: anyCemi.startIndex,
          data: Buffer.from(anyCemi.data ?? Buffer.alloc(0)),
        });
      };

      this.service.on("indication", onIndication);
      this.service.send(req).catch((err) => {
        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        reject(err);
      });
    });
  }

  /**
   * Writes a local property on the connected interface/gateway using cEMI `M_PropWrite.req` (`0xF6`)
   * and awaits `M_PropWrite.con` (`0xF5`).
   */
  public async writeLocalProperty(
    params: LocalPropertyWriteParams,
    timeoutMs: number = this.options.responseTimeoutMs,
  ): Promise<void> {
    const objectInstance = params.objectInstance ?? 1;
    const count = params.count ?? 1;
    const startIndex = params.startIndex ?? 1;
    const req = new CEMI.ManagementCEMI["M_PropWrite.req"](
      params.objectType,
      objectInstance,
      params.propertyId,
      count,
      startIndex,
      params.data,
    );

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.service.removeListener("indication", onIndication);
        reject(
          new Error(`Timeout waiting for M_PropWrite.con (objectType=${params.objectType}, pid=${params.propertyId})`),
        );
      }, timeoutMs);

      const onIndication = (cemi: CEMIInstance) => {
        const anyCemi = cemi as any;
        if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["M_PropWrite.con"].CEMI.value) return;
        if (
          anyCemi.interfaceObjectType !== params.objectType ||
          anyCemi.objectInstance !== objectInstance ||
          anyCemi.propertyId !== params.propertyId
        ) {
          return;
        }
        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        if (anyCemi.numberOfElements === 0) {
          reject(
            new Error(
              `M_PropWrite.con negative confirmation (errorInfo=0x${(anyCemi.errorInfo ?? 0).toString(16)}) for PID ${params.propertyId}`,
            ),
          );
          return;
        }
        resolve();
      };

      this.service.on("indication", onIndication);
      this.service.send(req).catch((err) => {
        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        reject(err);
      });
    });
  }

  /**
   * Calls a local Function Property on the connected interface/gateway using cEMI `M_FuncPropCommand.req` (`0xF8`)
   * and awaits `M_FuncPropCommand.con` (`0xFA`).
   */
  public async callLocalFunctionProperty(
    params: LocalFunctionPropertyParams,
    timeoutMs: number = this.options.responseTimeoutMs,
  ): Promise<{ returnCode: number; data: Buffer }> {
    const objectInstance = params.objectInstance ?? 1;
    const req = new CEMI.ManagementCEMI["M_FuncPropCommand.req"](
      params.objectType,
      objectInstance,
      params.propertyId,
      params.data ?? Buffer.alloc(0),
    );
    return this.awaitLocalFuncPropCon(req, params.objectType, objectInstance, params.propertyId, timeoutMs);
  }

  /**
   * Reads a local Function Property state on the connected interface/gateway using cEMI `M_FuncPropStateRead.req` (`0xF9`)
   * and awaits `M_FuncPropCommand.con` (`0xFA`).
   */
  public async readLocalFunctionPropertyState(
    params: LocalFunctionPropertyParams,
    timeoutMs: number = this.options.responseTimeoutMs,
  ): Promise<{ returnCode: number; data: Buffer }> {
    const objectInstance = params.objectInstance ?? 1;
    const req = new CEMI.ManagementCEMI["M_FuncPropStateRead.req"](
      params.objectType,
      objectInstance,
      params.propertyId,
      params.data ?? Buffer.alloc(0),
    );
    return this.awaitLocalFuncPropCon(req, params.objectType, objectInstance, params.propertyId, timeoutMs);
  }

  /**
   * Resets the local interface/gateway via cEMI `M_Reset.req` (`0xF1`).
   */
  public async resetLocalDevice(): Promise<void> {
    const req = new CEMI.ManagementCEMI["M_Reset.req"]();
    await this.service.send(req);
  }

  private awaitLocalFuncPropCon(
    req: CEMIInstance,
    objectType: number,
    objectInstance: number,
    propertyId: number,
    timeoutMs: number,
  ): Promise<{ returnCode: number; data: Buffer }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.service.removeListener("indication", onIndication);
        reject(new Error(`Timeout waiting for M_FuncPropCommand.con (objectType=${objectType}, pid=${propertyId})`));
      }, timeoutMs);

      const onIndication = (cemi: CEMIInstance) => {
        const anyCemi = cemi as any;
        if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["M_FuncPropCommand.con"].CEMI.value) return;
        if (
          anyCemi.interfaceObjectType !== objectType ||
          anyCemi.objectInstance !== objectInstance ||
          anyCemi.propertyId !== propertyId
        ) {
          return;
        }
        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        resolve({
          returnCode: anyCemi.return_code ?? 0,
          data: Buffer.from(anyCemi.data ?? Buffer.alloc(0)),
        });
      };

      this.service.on("indication", onIndication);
      this.service.send(req).catch((err) => {
        clearTimeout(timer);
        this.service.removeListener("indication", onIndication);
        reject(err);
      });
    });
  }

  private async pingDescriptorConnectionless(individualAddress: string, timeoutMs: number): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ok = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.service.removeListener("indication", onIndication);
          resolve(false);
        }, timeoutMs);

        const onIndication = (cemi: CEMIInstance) => {
          const anyCemi = cemi as any;
          if (anyCemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
          if (anyCemi.sourceAddress !== individualAddress) return;
          const tpdu = anyCemi.TPDU ?? anyCemi.tpdu;
          const tpciVal = tpdu?.tpci?.getValue?.();
          const apciVal = tpdu?.apdu?.apci?.value;
          if (
            (apciVal !== undefined && (apciVal & 0x03c0) === APCIEnum.A_DeviceDescriptor_Response_Protocol_Data_Unit) ||
            tpciVal === TPCIType.T_DISCONNECT_PDU
          ) {
            clearTimeout(timer);
            this.service.removeListener("indication", onIndication);
            resolve(true);
          }
        };

        this.service.on("indication", onIndication);
        const req = buildIndividualLDataReq(
          this.sourceAddress,
          individualAddress,
          APCIEnum.A_DeviceDescriptor_Read_Protocol_Data_Unit,
          Buffer.from([0x00]),
          true,
        );
        this.service.send(req).catch(() => {
          clearTimeout(timer);
          this.service.removeListener("indication", onIndication);
          resolve(false);
        });
      });

      if (ok) return true;
    }
    return false;
  }
}
