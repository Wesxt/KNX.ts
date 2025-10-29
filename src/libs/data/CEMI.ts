import { EMI } from "./EMI";

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
    RF_FAST_ACK_INFO = 0x0A,
    MANUFACTURER_SPECIFIC = 0xFE,
}

class AdditionalInformationField {
  constructor(additionalInfoType: CEMIAddInfoType) {
    this.typeId = additionalInfoType;

    switch (additionalInfoType) {
      case CEMIAddInfoType.PL_MEDIUM_INFO:
        this.lengthOfInformation = 2;
        break;
      case CEMIAddInfoType.RF_MEDIUM_INFO:
        this.lengthOfInformation = 8;
        break;
      case CEMIAddInfoType.BUSMONITOR_STATUS_INFO:
        this.lengthOfInformation = 1;
        break;
      case CEMIAddInfoType.TIMESTAMP_RELATIVE:
        this.lengthOfInformation = 2;
        break;
      case CEMIAddInfoType.TIME_DELAY_UNTIL_SENDING:
        this.lengthOfInformation = 4;
        break;
      case CEMIAddInfoType.EXTENDED_RELATIVE_TIMESTAMP:
        this.lengthOfInformation = 4;
        break;
      case CEMIAddInfoType.BIBAT_INFO:
        this.lengthOfInformation = 2;
        break;
      case CEMIAddInfoType.RF_MULTI_INFO:
        this.lengthOfInformation = 4;
        break;
      case CEMIAddInfoType.PREAMBLE_POSTAMBLE:
        this.lengthOfInformation = 3;
        break;
      case CEMIAddInfoType.RF_FAST_ACK_INFO:
        this.lengthOfInformation = null; // Variable (N * 2 octetos)
        break;
      case CEMIAddInfoType.MANUFACTURER_SPECIFIC:
        this.lengthOfInformation = null; // Variable (N * 3 octetos)
        break;
    }
    if (this.lengthOfInformation) {
      this.information = Buffer.alloc(this.lengthOfInformation)
    }
  }
  
  typeId: CEMIAddInfoType;
  lengthOfInformation: number | null = null;
  information: Buffer | null = null;

  describe() {
    return {
      typeId: CEMIAddInfoType[this.typeId],
      typeIdValue: this.typeId,
      lengthOfInformation: this.lengthOfInformation,
    }
  }
}

export class CEMI extends EMI {
  constructor() {
    super()
  }

  messageCode: number;
  additionalInfoLength: number;
  additionalInfo: AdditionalInformationField;
}