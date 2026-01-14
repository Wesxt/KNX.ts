import { KNXHelper } from "../utils/class/KNXHelper";
import { ExtendedControlField } from "./ControlFieldExtended";
import { ControlField, ServiceMessage } from "./EMI";
import {
  AddInfoBase,
  BiBatInformation,
  ExtendedRelativeTimestamp,
  ManufacturerSpecificData,
  PLMediumInfo,
  PreambleAndPostamble,
  RFFastACKInformation,
  RFMediumInformation,
  RFMultiInformation,
} from "./KNXAddInfoTypes";
import { MESSAGE_CODE_FIELD } from "./MessageCodeField";
import { TPDU } from "./TPDU";

/**
 * Enum for Additional Information Types (PDF Section 4.1.4.3.1)
 */
export enum CEMIAddInfoType {
  PL_MEDIUM_INFO = 0x01,
  RF_MEDIUM_INFO = 0x02,
  BUSMONITOR_STATUS_INFO = 0x03,
  TIMESTAMP_RELATIVE = 0x04,
  TIME_DELAY_UNTIL_SENDING = 0x05,
  EXTENDED_RELATIVE_TIMESTAMP = 0x06,
  BIBAT_INFO = 0x07,
  RF_MULTI_INFO = 0x08,
  PREAMBLE_POSTAMBLE = 0x09,
  RF_FAST_ACK_INFO = 0x0a,
  MANUFACTURER_SPECIFIC = 0xfe,
}

type ListAddInfoType =
  | RFMediumInformation
  | BiBatInformation
  | RFFastACKInformation
  | ExtendedRelativeTimestamp
  | RFMultiInformation
  | PreambleAndPostamble
  | ManufacturerSpecificData
  | PLMediumInfo;

export class AdditionalInformationField {
  constructor(value?: Buffer | ListAddInfoType) {
    this.typeId = value && Buffer.isBuffer(value) ? value.readUint8(0) : null;
    if (value && value instanceof AddInfoBase) this.information = value;
    switch (this.typeId) {
      case CEMIAddInfoType.PL_MEDIUM_INFO:
        this.information = new PLMediumInfo(value as Buffer);
        break;
      case CEMIAddInfoType.RF_MEDIUM_INFO:
        this.information = new RFMediumInformation(value as Buffer);
        break;
      case CEMIAddInfoType.BUSMONITOR_STATUS_INFO:
        this.information = "Error: This addInfoType 'BUSMONITOR_STATUS_INFO' (0x03) is not implemented";
        // Not implemented in KNXAddInfoTypes yet
        break;
      case CEMIAddInfoType.TIMESTAMP_RELATIVE:
        this.information = "Error: This addInfoType 'TIMESTAMP_RELATIVE' (0x04) is not implemented";
        // Not implemented in KNXAddInfoTypes yet
        break;
      case CEMIAddInfoType.TIME_DELAY_UNTIL_SENDING:
        this.information = "Error: This addInfoType 'TIME_DELAY_UNTIL_SENDING' (0x05) is not implemented";
        // Not implemented in KNXAddInfoTypes yet
        break;
      case CEMIAddInfoType.EXTENDED_RELATIVE_TIMESTAMP:
        this.information = new ExtendedRelativeTimestamp(value as Buffer);
        break;
      case CEMIAddInfoType.BIBAT_INFO:
        this.information = new BiBatInformation(value as Buffer);
        break;
      case CEMIAddInfoType.RF_MULTI_INFO:
        this.information = new RFMultiInformation(value as Buffer);
        break;
      case CEMIAddInfoType.PREAMBLE_POSTAMBLE:
        this.information = new PreambleAndPostamble(value as Buffer);
        break;
      case CEMIAddInfoType.RF_FAST_ACK_INFO:
        this.information = new RFFastACKInformation(value as Buffer);
        break;
      case CEMIAddInfoType.MANUFACTURER_SPECIFIC:
        this.information = new ManufacturerSpecificData(value as Buffer);
        break;
    }

    // Calculate length based on the instantiated info class
    this.additionalInfoLength =
      this.information && typeof this.information !== "string" ? this.information?.totalLength : 0;
  }

  typeId: CEMIAddInfoType | null = null;
  // Union type of all possible AddInfo classes
  information:
    | RFMediumInformation
    | BiBatInformation
    | RFFastACKInformation
    | ExtendedRelativeTimestamp
    | RFMultiInformation
    | PreambleAndPostamble
    | ManufacturerSpecificData
    | PLMediumInfo
    | null
    | string = null;

  /** Length of the whole block (Type + Len + Data) */
  additionalInfoLength: number = 0;

  getBuffer(): Buffer {
    return this.information && typeof this.information !== "string" ? this.information.getBuffer() : Buffer.alloc(1);
  }

  describe() {
    return {
      typeId: this.typeId ? CEMIAddInfoType[this.typeId] : null,
      typeIdValue: this.typeId,
      totalLength: this.additionalInfoLength,
      information: this.information,
    };
  }
}

export class CEMI implements ServiceMessage {
  /**
   * @param messageCode CEMI-compatible message code
   * @param additionalInfo AdditionalInfo
   * @param controlField1 Control Field
   * @param ControlField2 Extended Control Field
   * @param sourceAddress Ej: "1.1.1" or "1/1/1"
   * @param destinationAddress Ej: "1.1.1" or "1/1/1"
   * @param TPDU Transport Protocol Data Unit
   */
  constructor(
    messageCode: number,
    additionalInfo: ListAddInfoType | null = null,
    controlField1: ControlField,
    controlField2: ExtendedControlField,
    sourceAddress: string,
    destinationAddress: string,
    TPDU: TPDU
  ) {
    const filterCEMIValues = Object.values(MESSAGE_CODE_FIELD).map((item) => {
      if (item && "CEMI" in item) return item.CEMI.value;
    });
    if (!filterCEMIValues.find((item) => item === messageCode))
      throw new Error("The message code is not compatible with CEMI");
    if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
    this.messageCode = messageCode;
    this.controlField1 = controlField1;
    this.controlField2 = controlField2;
    this.sourceAddress = sourceAddress;
    this.destinationAddress = destinationAddress;
    this.TPDU = TPDU;
    this.length = TPDU.length;
  }
  messageCode: number = 0;
  additionalInfo: AdditionalInformationField = new AdditionalInformationField();
  controlField1: ControlField = new ControlField();
  controlField2: ExtendedControlField = new ExtendedControlField();
  sourceAddress: string = "";
  destinationAddress: string = "";
  /** Network Protocol Data Unit => length */
  length: number = 0;
  /** Network Protocol Data Unit => TPCI/APCI */
  TPDU: TPDU = new TPDU();

  toBuffer(): Buffer {
    // Typically the length is 10 bytes
    // messageCode || additional Info || control field 1 || control field 2 || source address || destination address || length || NPDU => APCI/TPCI => It appears to be only the TPDU because it makes no sense to discard the hop count (which is the network control field) and continue calling it NPDU
    // 1 byte      ||  1 byte         ||  1 byte         ||    1 byte       ||  2 bytes       ||   2 bytes           || 1 byte ||  1 byte => if the data is minor than 256 => depends of APCI and DataPointType (DPT)
    const buffer = Buffer.alloc(10 + this.additionalInfo.additionalInfoLength + this.length);
    buffer.writeUInt8(this.messageCode, 0);
    const bufferAdditionalInfo = this.additionalInfo.getBuffer();
    bufferAdditionalInfo.copy(buffer, 1);
    this.controlField1.buffer.copy(buffer, 2 + bufferAdditionalInfo.length);
    this.controlField2.getBuffer().copy(buffer, 3 + bufferAdditionalInfo.length);
    KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 4 + bufferAdditionalInfo.length);
    KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 6 + bufferAdditionalInfo.length);
    buffer.writeUInt8(this.length, 8 + bufferAdditionalInfo.length);
    this.TPDU.toBuffer().copy(buffer, 9 + bufferAdditionalInfo.length);
    return buffer;
  }

  static fromBuffer(buffer: Buffer) {}

  describe() {
    return {
      messageCode: this.messageCode,
      additionalInfo: this.additionalInfo.describe(),
      controlField1: this.controlField1.describe(),
      controlField2: this.controlField2.describe(),
      sourceAddress: this.sourceAddress,
      destinationAddress: this.destinationAddress,
      length: this.length,
      TPDU: this.TPDU.describe(),
    };
  }
}

type CEMIFromBuffer = {
  new (...args: any[]): CEMI;
  fromBuffer(buffer: Buffer): CEMI;
};

CEMI satisfies CEMIFromBuffer;
