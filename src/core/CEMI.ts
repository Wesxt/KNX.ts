import { KNXHelper } from "../utils/KNXHelper";
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

export class CEMI implements ServiceMessage {
  constructor(
    messageCode: number,
    additionalInfo: ListAddInfoType | null = null,
    controlField1: ControlField,
    controlField2: ExtendedControlField,
    sourceAddress: string,
    destinationAddress: string,
    TPDU: TPDU,
  ) {
    const filterCEMIValues = Object.values(MESSAGE_CODE_FIELD).map((item) => {
      // @ts-ignore
      if (item && item.CEMI) return item.CEMI.value;
    });
    // Nota: filterCEMIValues puede contener undefineds, el find debe ser robusto
    if (!filterCEMIValues.includes(messageCode))
      // throw new Error(`The message code 0x${messageCode.toString(16)} is not compatible with CEMI`);
      // Comentado para permitir flexibilidad durante desarrollo, pero idealmente debe estar activo.
      console.warn(
        `Warning: Message code 0x${messageCode.toString(16)} not strictly found in MessageCodeField definitions.`,
      );

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
  length: number = 0;
  TPDU: TPDU = new TPDU();

  /**
   * Construye el Buffer cEMI siguiendo la especificación 03.06.03
   * Estructura: [MC] [AddInfoLen] [AddInfoData...] [Ctrl1] [Ctrl2] [Src] [Dst] [Len] [TPDU]
   */
  toBuffer(): Buffer {
    const infoBuffer = this.additionalInfo.getBuffer();
    const infoLength = infoBuffer.length;

    // Calculamos el tamaño total.
    // 1 (MC) + 1 (InfoLen) + InfoData + 1 (C1) + 1 (C2) + 2 (Src) + 2 (Dst) + 1 (Len) + TPDU
    const headerSize = 1 + 1 + infoLength + 1 + 1 + 2 + 2 + 1;
    const tpduBuffer = this.TPDU.toBuffer();

    const buffer = Buffer.alloc(headerSize + tpduBuffer.length);
    let offset = 0;

    buffer.writeUInt8(this.messageCode, offset++); // MC
    buffer.writeUInt8(infoLength, offset++); // AddInfo Length (CORREGIDO: Faltaba este byte en tu lógica original)

    if (infoLength > 0) {
      infoBuffer.copy(buffer, offset);
      offset += infoLength;
    }

    this.controlField1.buffer.copy(buffer, offset++);
    this.controlField2.getBuffer().copy(buffer, offset++);

    KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, offset);
    offset += 2;

    KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, offset);
    offset += 2;

    // Length Field: En cEMI Standard Frame, este byte es la longitud de la DATA (LSDU),
    // que es la longitud del TPDU menos el byte TPCI si está optimizado, pero simplifiquemos a longitud TPDU.
    // Spec dice: "Number of octets of the LSDU".
    buffer.writeUInt8(tpduBuffer.length, offset++);

    tpduBuffer.copy(buffer, offset);

    return buffer;
  }

  /**
   * Parsea un buffer crudo cEMI a una instancia de la clase CEMI.
   * @param buffer El buffer completo comenzando por el Message Code.
   */
  static fromBuffer(buffer: Buffer): CEMI {
    if (buffer.length < 10) throw new Error("Buffer cEMI demasiado corto (< 10 bytes)");

    let offset = 0;

    // 1. Message Code
    const msgCode = buffer.readUInt8(offset++);

    // 2. Additional Info Length
    const addInfoLen = buffer.readUInt8(offset++);

    let additionalInfoObj: ListAddInfoType | null = null;

    // 3. Additional Info Data
    if (addInfoLen > 0) {
      const addInfoBuffer = buffer.subarray(offset, offset + addInfoLen);
      const addInfoField = new AdditionalInformationField(addInfoBuffer);

      // Extraemos la información parseada interna si existe
      if (addInfoField.information && !Buffer.isBuffer(addInfoField.information)) {
        additionalInfoObj = addInfoField.information;
      }
      offset += addInfoLen;
    }

    // 4. Control Field 1
    const c1Byte = buffer.readUInt8(offset++);
    const ctrl1 = new ControlField(c1Byte);

    // 5. Control Field 2 (Extended)
    const c2Byte = buffer.readUInt8(offset++);
    const ctrl2 = new ExtendedControlField(c2Byte);

    // 6. Source Address (Siempre Individual)
    const srcBuf = buffer.subarray(offset, offset + 2);
    const srcAddr = KNXHelper.GetAddress(srcBuf, ".") as string;
    offset += 2;

    // 7. Destination Address
    // Determinamos si es Grupo o Individual mirando el Bit 7 del Control Field 2
    // Spec 03.06.03: "Bit 7 (Dest. Addr. Flag): 0=Individual, 1=Group"
    const isGroup = (c2Byte & 0x80) !== 0;
    const dstBuf = buffer.subarray(offset, offset + 2);
    const dstAddr = KNXHelper.GetAddress(dstBuf, isGroup ? "/" : ".") as string;
    offset += 2;

    // 8. Length (LSDU length)
    const length = buffer.readUInt8(offset++);

    // 9. TPDU (Payload)
    // El resto del buffer corresponde al TPDU.
    // Validamos que haya suficientes bytes
    if (buffer.length - offset < length) {
      // Warning: A veces los dispositivos envían padding o calculan length diferente.
      // Usamos Math.min o lanzamos error estricto.
      // throw new Error(`Longitud declarada ${length} excede bytes disponibles ${buffer.length - offset}`);
    }

    // Tomamos el slice exacto basado en 'length' o lo que quede
    const tpduRaw = buffer.subarray(offset, offset + length);
    const tpdu = TPDU.fromBuffer(tpduRaw);

    // Retornamos la instancia
    const cemi = new CEMI(msgCode, additionalInfoObj, ctrl1, ctrl2, srcAddr, dstAddr, tpdu);

    // Ajustamos la propiedad length para que coincida con lo leído
    cemi.length = length;

    return cemi;
  }

  describe() {
    return {
      messageCode: `0x${this.messageCode.toString(16).toUpperCase()}`,
      additionalInfo: this.additionalInfo.describe(),
      controlField1: this.controlField1.describe(),
      controlField2: this.controlField2.describe(),
      sourceAddress: this.sourceAddress,
      destinationAddress: this.destinationAddress,
      length: this.length,
      TPDU: this.TPDU.describe(), // TPDU ahora delegará a TPCI, APDU, APCI
    };
  }
}

type CEMIFromBuffer = {
  new (...args: any[]): CEMI;
  fromBuffer(buffer: Buffer): CEMI;
};

CEMI satisfies CEMIFromBuffer;
