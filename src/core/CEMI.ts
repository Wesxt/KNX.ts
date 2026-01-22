import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { KNXHelper } from "../utils/KNXHelper";
import { ControlField } from "./ControlField";
import { ExtendedControlField } from "./ControlFieldExtended";
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
import { TPDU } from "./layers/data/TPDU";

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
    // Si viene un Buffer, intentamos leer el TypeID del primer byte
    this.typeId = value && Buffer.isBuffer(value) && value.length > 0 ? value.readUInt8(0) : null;

    // Si viene una instancia de clase, la asignamos
    if (value && value instanceof AddInfoBase) this.information = value;

    // Si es buffer, parseamos según el TypeID
    if (Buffer.isBuffer(value)) {
      switch (this.typeId) {
        case CEMIAddInfoType.PL_MEDIUM_INFO:
          this.information = new PLMediumInfo(value);
          break;
        case CEMIAddInfoType.RF_MEDIUM_INFO:
          this.information = new RFMediumInformation(value);
          break;
        case CEMIAddInfoType.BUSMONITOR_STATUS_INFO:
          this.information = value;
          this.error = "Error: This addInfoType 'BUSMONITOR_STATUS_INFO' (0x03) is not implemented";
          // Not implemented in KNXAddInfoTypes yet
          break;
        case CEMIAddInfoType.TIMESTAMP_RELATIVE:
          this.information = value;
          this.error = "Error: This addInfoType 'TIMESTAMP_RELATIVE' (0x04) is not implemented";
          // Not implemented in KNXAddInfoTypes yet
          break;
        case CEMIAddInfoType.TIME_DELAY_UNTIL_SENDING:
          this.information = value;
          this.error = "Error: This addInfoType 'TIME_DELAY_UNTIL_SENDING' (0x05) is not implemented";
          // Not implemented in KNXAddInfoTypes yet
          break;
        case CEMIAddInfoType.EXTENDED_RELATIVE_TIMESTAMP:
          this.information = new ExtendedRelativeTimestamp(value);
          break;
        case CEMIAddInfoType.BIBAT_INFO:
          this.information = new BiBatInformation(value);
          break;
        case CEMIAddInfoType.RF_MULTI_INFO:
          this.information = new RFMultiInformation(value);
          break;
        case CEMIAddInfoType.PREAMBLE_POSTAMBLE:
          this.information = new PreambleAndPostamble(value);
          break;
        case CEMIAddInfoType.RF_FAST_ACK_INFO:
          this.information = new RFFastACKInformation(value);
          break;
        case CEMIAddInfoType.MANUFACTURER_SPECIFIC:
          this.information = new ManufacturerSpecificData(value);
          break;
        default:
          // Caso: Info Type no implementado o buffer vacío
          this.information = value;
          break;
      }
    }

    // Calculate length based on the instantiated info class
    this.additionalInfoLength =
      this.information && !Buffer.isBuffer(this.information) ? this.information.totalLength : 0;
  }

  typeId: CEMIAddInfoType | null = null;
  information: ListAddInfoType | Buffer | null = null;
  additionalInfoLength: number = 0;
  private error: string | null = null;

  getBuffer(): Buffer {
    return this.information && !Buffer.isBuffer(this.information) ? this.information.getBuffer() : Buffer.alloc(0);
  }

  describe() {
    return {
      typeId: this.typeId ? CEMIAddInfoType[this.typeId] : null,
      typeIdValue: this.typeId,
      totalLength: this.additionalInfoLength,
      information: this.information,
      error: this.error,
    };
  }
}

export class CEMI {
  constructor() {
    throw new Error("This class is static");
  }

  static DataLinkLayerCEMI = {
    "L_Data.req": class L_Data_req implements ServiceMessage {
      constructor(
        additionalInfo: ListAddInfoType | null = null,
        controlField1: ControlField,
        controlField2: ExtendedControlField,
        sourceAddress: string,
        destinationAddress: string,
        TPDU: TPDU,
      ) {
        if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
        this.controlField1 = controlField1;
        this.controlField2 = controlField2;
        this.sourceAddress = sourceAddress;
        this.destinationAddress = destinationAddress;
        this.TPDU = TPDU;
        this.length = TPDU.length;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Data.req"].CEMI.value;
      additionalInfo: AdditionalInformationField = new AdditionalInformationField();
      controlField1: ControlField = new ControlField();
      controlField2: ExtendedControlField = new ExtendedControlField();
      sourceAddress: string = "";
      destinationAddress: string = "";
      length: number = 0;
      TPDU: TPDU = new TPDU();

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(10 + this.TPDU.length);
        buffer[0] = this.messageCode;
        buffer[1] = this.additionalInfo.additionalInfoLength;
        this.additionalInfo.getBuffer().copy(buffer, 2);
        this.controlField1.buffer.copy(buffer, 3 + this.additionalInfo.additionalInfoLength);
        this.controlField2.getBuffer().copy(buffer, 4 + this.additionalInfo.additionalInfoLength);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 5 + this.additionalInfo.additionalInfoLength);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 7 + this.additionalInfo.additionalInfoLength);
        buffer[9 + this.additionalInfo.additionalInfoLength] = this.length;
        this.TPDU.toBuffer().copy(buffer, 10 + this.additionalInfo.additionalInfoLength);
        return buffer;
      }

      static fromBuffer(buffer: Buffer): L_Data_req {
        // 1. Validar Message Code
        const msgCode = buffer.readUInt8(0);
        if (msgCode !== MESSAGE_CODE_FIELD["L_Data.req"].CEMI.value) {
          throw new Error(`Invalid Message Code for L_Data.req: expected 0x11, got 0x${msgCode.toString(16)}`);
        }

        // 2. Parse Additional Info Length & Data
        const addInfoLength = buffer.readUInt8(1);
        let additionalInfo: AdditionalInformationField | null = null;

        // Offset base después de la Additional Info
        // ESTÁNDAR: 2 + addInfoLength
        // TU toBuffer (ERRÓNEO): 3 + addInfoLength
        const baseOffset = 2 + addInfoLength;

        if (addInfoLength > 0) {
          const addInfoBuffer = buffer.subarray(2, baseOffset);
          additionalInfo = new AdditionalInformationField(addInfoBuffer);
        }

        // 3. Control Fields
        // Asumo que tus clases ControlField tienen un constructor que acepta Buffer o un fromBuffer estático.
        // Si no, tendrás que instanciarlas y asignar el valor manualmente.
        const controlField1 = new ControlField(buffer.subarray(baseOffset, baseOffset + 1));
        const controlField2 = new ExtendedControlField(buffer.subarray(baseOffset + 1, baseOffset + 2));

        // 4. Addresses
        // KNXHelper necesita un método para convertir Buffer a string (ej. "1.1.1").
        // Si no existe, debes implementarlo. Aquí asumo `getAddressString`.
        const srcBuffer = buffer.subarray(baseOffset + 2, baseOffset + 4);
        const dstBuffer = buffer.subarray(baseOffset + 4, baseOffset + 6);

        // Nota: Verifica si tu KNXHelper tiene este método o similar.
        // Si no, usa: `${srcBuffer.readUInt8(0) >> 4}.${srcBuffer.readUInt8(0) & 0x0F}.${srcBuffer.readUInt8(1)}`
        const sourceAddress = KNXHelper.GetAddress(srcBuffer);
        const destinationAddress = KNXHelper.GetAddress(dstBuffer);

        // 5. Data Length (L)
        // En cEMI, este byte indica la longitud de los datos (excluyendo TPCI en algunos contextos, pero es el campo L del frame).
        const length = buffer.readUInt8(baseOffset + 6);

        // 6. TPDU
        // El TPDU comienza inmediatamente después del byte de longitud.
        // Se asume que TPDU.fromBuffer maneja la lectura completa (TPCI + APCI + Data).
        const tpduBuffer = buffer.subarray(baseOffset + 7, baseOffset + 7 + length + 1); // +1 por seguridad si length excluye TPCI, ajusta según tu TPDU
        const tpdu = TPDU.fromBuffer(tpduBuffer);

        return new L_Data_req(
          additionalInfo ? additionalInfo.information : null,
          controlField1,
          controlField2,
          sourceAddress,
          destinationAddress,
          tpdu,
        );
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo.describe(),
          controlField1: this.controlField1.describe(),
          controlField2: this.controlField2.describe(),
          sourceAddress: this.sourceAddress,
          destinationAddress: this.destinationAddress,
        };
      }
    },
  } as const;
}

// !! Type check in all class

type KeysOfCEMI = "DataLinkLayerCEMI";

/**
 * List of services that do not implement the static fromBuffer method yet.
 */
type ExcludedServices = never;

/**
 * Validates that a class constructor has a static fromBuffer method
 * that returns an instance of that same class.
 */
type CEMIServiceConstructor<T> = T extends { new (...args: any[]): infer I }
  ? {
      new (...args: any[]): I;
      fromBuffer(buffer: Buffer): I;
    }
  : never;

/**
 * Validator for the EMI class structure.
 * Checks that every service in each layer (except LayerAccess and ExcludedServices)
 * correctly implements the static fromBuffer method.
 */
type CEMIValidator = {
  [K in KeysOfCEMI]: {
    [S in keyof (typeof CEMI)[K]]: S extends ExcludedServices
      ? any
      : (typeof CEMI)[K][S] extends { new (...args: any[]): any }
        ? CEMIServiceConstructor<(typeof CEMI)[K][S]>
        : any;
  };
};
// !! This is for verify all class if have the method fromBuffer
CEMI satisfies CEMIValidator;
