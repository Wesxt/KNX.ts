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
  private _items: AddInfoBase[] = [];

  constructor(items: AddInfoBase[] = []) {
    this._items = items;
  }

  /**
   * Obtiene la lista completa de informaciones adicionales parseadas.
   */
  public get items(): AddInfoBase[] {
    return this._items;
  }

  /**
   * Añade una nueva pieza de información adicional.
   */
  public add(item: AddInfoBase): void {
    this._items.push(item);
  }

  /**
   * Calcula la longitud total en bytes de este campo (suma de todas las partes).
   * Ojo: Esto es lo que va en el byte "Additional Info Length" del frame cEMI.
   */
  public get length(): number {
    return this._items.reduce((acc, item) => acc + item.totalLength, 0);
  }

  /**
   * Genera el buffer concatenado de todos los elementos.
   */
  public toBuffer(): Buffer {
    const buffers = this._items.map((item) => item.getBuffer());
    return Buffer.concat(buffers);
  }

  /**
   * Parsea el bloque de "Additional Information" completo.
   * @param buffer El buffer que contiene SOLO la parte de Additional Info (sin el byte de longitud previo).
   */
  static fromBuffer(buffer: Buffer): AdditionalInformationField {
    const items: AddInfoBase[] = [];
    let offset = 0;

    // Iteramos mientras haya datos por leer en el buffer asignado
    while (offset < buffer.length) {
      // 1. Validar que al menos podemos leer Type ID y Length (2 bytes mínimo)
      if (offset + 2 > buffer.length) {
        throw new Error("AddInfo invalid, the length is too short");
        break;
      }

      const typeId = buffer.readUInt8(offset);
      const len = buffer.readUInt8(offset + 1); // Longitud de la DATA, no del bloque entero

      const totalBlockSize = 2 + len; // Type(1) + Len(1) + Data(len)

      // 2. Validar que el bloque completo cabe en el buffer
      if (offset + totalBlockSize > buffer.length) {
        throw new Error(
          `[AdditionalInformationField] Bloque incompleto para TypeID 0x${typeId.toString(16)}. Se esperaban ${totalBlockSize} bytes, quedan ${buffer.length - offset}.`,
        );
      }

      // 3. Extraer el bloque completo (Type + Len + Data) para pasarlo a las clases específicas
      // NOTA: Tus clases en KNXAddInfoTypes deben saber parsearse a sí mismas, idealmente con un método estático fromBuffer
      // o un constructor que acepte el payload. Asumo aquí que pasamos la data pura.

      const dataSubset = buffer.subarray(offset + 2, offset + 2 + len);

      let item: AddInfoBase | null = null;

      try {
        switch (typeId) {
          case CEMIAddInfoType.PL_MEDIUM_INFO:
            item = new PLMediumInfo(dataSubset);
            break;
          case CEMIAddInfoType.RF_MEDIUM_INFO:
            item = new RFMediumInformation(dataSubset);
            break;
          case CEMIAddInfoType.BUSMONITOR_STATUS_INFO:
            // item = new BusmonitorStatusInfo(dataSubset); // Implementar si falta
            break;
          case CEMIAddInfoType.TIMESTAMP_RELATIVE:
            // item = new TimestampRelative(dataSubset);
            break;
          case CEMIAddInfoType.TIME_DELAY_UNTIL_SENDING:
            // item = new TimeDelayUntilSending(dataSubset);
            break;
          case CEMIAddInfoType.EXTENDED_RELATIVE_TIMESTAMP:
            item = new ExtendedRelativeTimestamp(dataSubset);
            break;
          case CEMIAddInfoType.BIBAT_INFO:
            item = new BiBatInformation(dataSubset);
            break;
          case CEMIAddInfoType.RF_MULTI_INFO:
            item = new RFMultiInformation(dataSubset);
            break;
          case CEMIAddInfoType.PREAMBLE_POSTAMBLE:
            item = new PreambleAndPostamble(dataSubset);
            break;
          case CEMIAddInfoType.RF_FAST_ACK_INFO:
            item = new RFFastACKInformation(dataSubset);
            break;
          case CEMIAddInfoType.MANUFACTURER_SPECIFIC:
            item = new ManufacturerSpecificData(dataSubset);
            break;
          default:
            // Si el tipo es desconocido, decidimos si ignorarlo o guardarlo como genérico.
            // Para depuración, es útil saber que llegó algo raro.
            console.warn(`[AdditionalInformationField] TypeID desconocido: 0x${typeId.toString(16)}`);
            break;
        }
      } catch (err) {
        console.error(`Error parseando AddInfo Type 0x${typeId.toString(16)}:`, err);
      }

      if (item) {
        items.push(item);
      }

      // Avanzamos el offset
      offset += totalBlockSize;
    }

    return new AdditionalInformationField(items);
  }
}

export class CEMI {
  constructor() {
    throw new Error("This class is static");
  }

  static DataLinkLayerCEMI = {
    "L_Data.req": class L_Data_req implements ServiceMessage {
      constructor(
        additionalInfo: AddInfoBase[] | null = null,
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
        // Cálculo correcto del tamaño total
        // Offset base = 2 (MC + AddInfoLen) + AddInfoData
        const baseOffset = 2 + this.additionalInfo.length;

        // 7 bytes fijos después de AddInfo: CF1(1) + CF2(1) + Src(2) + Dst(2) + Len(1)
        const buffer = Buffer.alloc(baseOffset + 7 + this.TPDU.length);

        buffer[0] = this.messageCode;
        buffer[1] = this.additionalInfo.length;

        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2);
        }

        this.controlField1.buffer.copy(buffer, baseOffset);
        this.controlField2.getBuffer().copy(buffer, baseOffset + 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, baseOffset + 2);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, baseOffset + 4);
        buffer[baseOffset + 6] = this.length;
        this.TPDU.toBuffer().copy(buffer, baseOffset + 7);

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
        let additionalInfoInstance: AdditionalInformationField | null = null;

        // Offset base correcto según estándar (2 + len)
        const baseOffset = 2 + addInfoLength;

        if (addInfoLength > 0) {
          const addInfoBuffer = buffer.subarray(2, baseOffset);
          additionalInfoInstance = AdditionalInformationField.fromBuffer(addInfoBuffer);
        }

        // 3. Control Fields
        const controlField1 = new ControlField(buffer.subarray(baseOffset, baseOffset + 1).readUint8());
        const controlField2 = new ExtendedControlField(buffer.subarray(baseOffset + 1, baseOffset + 2));

        // 4. Addresses
        const srcBuffer = buffer.subarray(baseOffset + 2, baseOffset + 4);
        const dstBuffer = buffer.subarray(baseOffset + 4, baseOffset + 6);

        const sourceAddress = KNXHelper.GetAddress(srcBuffer, controlField2.addressType ? "/" : ".") as string;
        const destinationAddress = KNXHelper.GetAddress(dstBuffer, controlField2.addressType ? "/" : ".") as string;

        // 5. Data Length (L)
        // Indica la longitud en bytes del LSDU (Link Service Data Unit)
        const length = buffer.readUInt8(baseOffset + 6);

        // 6. TPDU
        // Extraemos exactamente 'length' bytes para el TPDU
        const tpduBuffer = buffer.subarray(baseOffset + 7, baseOffset + 7 + length);
        const tpdu = TPDU.fromBuffer(tpduBuffer);

        // Extraemos la información interna del wrapper AdditionalInformationField si existe
        const addInfoData = additionalInfoInstance?.items ?? null;

        return new L_Data_req(addInfoData, controlField1, controlField2, sourceAddress, destinationAddress, tpdu);
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          controlField1: this.controlField1.describe(),
          controlField2: this.controlField2.describe(),
          sourceAddress: this.sourceAddress,
          destinationAddress: this.destinationAddress,
        };
      }
    },
    "L_Data.con": class L_Data_con implements ServiceMessage {
      constructor(
        additionalInfo: AddInfoBase[] | null = null,
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
      messageCode = MESSAGE_CODE_FIELD["L_Data.con"].CEMI.value;
      additionalInfo: AdditionalInformationField = new AdditionalInformationField();
      controlField1: ControlField = new ControlField();
      controlField2: ExtendedControlField = new ExtendedControlField();
      sourceAddress: string = "";
      destinationAddress: string = "";
      length: number = 0;
      TPDU: TPDU = new TPDU();

      toBuffer(): Buffer {
        // Cálculo correcto del tamaño total
        // Offset base = 2 (MC + AddInfoLen) + AddInfoData
        const baseOffset = 2 + this.additionalInfo.length;

        // 7 bytes fijos después de AddInfo: CF1(1) + CF2(1) + Src(2) + Dst(2) + Len(1)
        const buffer = Buffer.alloc(baseOffset + 7 + this.TPDU.length);

        buffer[0] = this.messageCode;
        buffer[1] = this.additionalInfo.length;

        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2);
        }

        this.controlField1.buffer.copy(buffer, baseOffset);
        this.controlField2.getBuffer().copy(buffer, baseOffset + 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, baseOffset + 2);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, baseOffset + 4);
        buffer[baseOffset + 6] = this.length;
        this.TPDU.toBuffer().copy(buffer, baseOffset + 7);

        return buffer;
      }

      static fromBuffer(buffer: Buffer): L_Data_con {
        // 1. Validar Message Code
        const msgCode = buffer.readUInt8(0);
        if (msgCode !== MESSAGE_CODE_FIELD["L_Data.con"].CEMI.value) {
          throw new Error(`Invalid Message Code for L_Data.con: expected 0x2E, got 0x${msgCode.toString(16)}`);
        }

        // 2. Parse Additional Info Length & Data
        const addInfoLength = buffer.readUInt8(1);
        let additionalInfoInstance: AdditionalInformationField | null = null;

        // Offset base correcto según estándar (2 + len)
        const baseOffset = 2 + addInfoLength;

        if (addInfoLength > 0) {
          const addInfoBuffer = buffer.subarray(2, baseOffset);
          additionalInfoInstance = AdditionalInformationField.fromBuffer(addInfoBuffer);
        }

        // 3. Control Fields
        const controlField1 = new ControlField(buffer.subarray(baseOffset, baseOffset + 1).readUint8());
        const controlField2 = new ExtendedControlField(buffer.subarray(baseOffset + 1, baseOffset + 2));

        // 4. Addresses
        const srcBuffer = buffer.subarray(baseOffset + 2, baseOffset + 4);
        const dstBuffer = buffer.subarray(baseOffset + 4, baseOffset + 6);

        const sourceAddress = KNXHelper.GetAddress(srcBuffer, controlField2.addressType ? "/" : ".") as string;
        const destinationAddress = KNXHelper.GetAddress(dstBuffer, controlField2.addressType ? "/" : ".") as string;

        // 5. Data Length (L)
        // Indica la longitud en bytes del LSDU (Link Service Data Unit)
        const length = buffer.readUInt8(baseOffset + 6);

        // 6. TPDU
        // Extraemos exactamente 'length' bytes para el TPDU
        const tpduBuffer = buffer.subarray(baseOffset + 7, baseOffset + 7 + length);
        const tpdu = TPDU.fromBuffer(tpduBuffer);

        // Extraemos la información interna del wrapper AdditionalInformationField si existe
        const addInfoData = additionalInfoInstance?.items ?? null;

        return new L_Data_con(addInfoData, controlField1, controlField2, sourceAddress, destinationAddress, tpdu);
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          controlField1: this.controlField1.describe(),
          controlField2: this.controlField2.describe(),
          sourceAddress: this.sourceAddress,
          destinationAddress: this.destinationAddress,
        };
      }
    },
    "L_Data.ind": class L_Data_ind implements ServiceMessage {
      constructor(
        additionalInfo: AddInfoBase[] | null = null,
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
      messageCode = MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value;
      additionalInfo: AdditionalInformationField = new AdditionalInformationField();
      controlField1: ControlField = new ControlField();
      controlField2: ExtendedControlField = new ExtendedControlField();
      sourceAddress: string = "";
      destinationAddress: string = "";
      length: number = 0;
      TPDU: TPDU = new TPDU();

      toBuffer(): Buffer {
        // Cálculo correcto del tamaño total
        // Offset base = 2 (MC + AddInfoLen) + AddInfoData
        const baseOffset = 2 + this.additionalInfo.length;

        // 7 bytes fijos después de AddInfo: CF1(1) + CF2(1) + Src(2) + Dst(2) + Len(1)
        const buffer = Buffer.alloc(baseOffset + 7 + this.TPDU.length);

        buffer[0] = this.messageCode;
        buffer[1] = this.additionalInfo.length;

        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2);
        }

        this.controlField1.buffer.copy(buffer, baseOffset);
        this.controlField2.getBuffer().copy(buffer, baseOffset + 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, baseOffset + 2);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, baseOffset + 4);
        buffer[baseOffset + 6] = this.length;
        this.TPDU.toBuffer().copy(buffer, baseOffset + 7);

        return buffer;
      }

      static fromBuffer(buffer: Buffer): L_Data_ind {
        // 1. Validar Message Code
        const msgCode = buffer.readUInt8(0);
        if (msgCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) {
          throw new Error(`Invalid Message Code for L_Data.ind: expected 0x29, got 0x${msgCode.toString(16)}`);
        }

        // 2. Parse Additional Info Length & Data
        const addInfoLength = buffer.readUInt8(1);
        let additionalInfoInstance: AdditionalInformationField | null = null;

        // Offset base correcto según estándar (2 + len)
        const baseOffset = 2 + addInfoLength;

        if (addInfoLength > 0) {
          const addInfoBuffer = buffer.subarray(2, baseOffset);
          additionalInfoInstance = AdditionalInformationField.fromBuffer(addInfoBuffer);
        }

        // 3. Control Fields
        const controlField1 = new ControlField(buffer.subarray(baseOffset, baseOffset + 1).readUint8());
        const controlField2 = new ExtendedControlField(buffer.subarray(baseOffset + 1, baseOffset + 2));

        // 4. Addresses
        const srcBuffer = buffer.subarray(baseOffset + 2, baseOffset + 4);
        const dstBuffer = buffer.subarray(baseOffset + 4, baseOffset + 6);

        const sourceAddress = KNXHelper.GetAddress(srcBuffer, controlField2.addressType ? "/" : ".") as string;
        const destinationAddress = KNXHelper.GetAddress(dstBuffer, controlField2.addressType ? "/" : ".") as string;

        // 5. Data Length (L)
        // Indica la longitud en bytes del LSDU (Link Service Data Unit)
        const length = buffer.readUInt8(baseOffset + 6);

        // 6. TPDU
        // Extraemos exactamente 'length' bytes para el TPDU
        const tpduBuffer = buffer.subarray(baseOffset + 7, baseOffset + 7 + length);
        const tpdu = TPDU.fromBuffer(tpduBuffer);

        // Extraemos la información interna del wrapper AdditionalInformationField si existe
        const addInfoData = additionalInfoInstance?.items ?? null;

        return new L_Data_ind(addInfoData, controlField1, controlField2, sourceAddress, destinationAddress, tpdu);
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          controlField1: this.controlField1.describe(),
          controlField2: this.controlField2.describe(),
          sourceAddress: this.sourceAddress,
          destinationAddress: this.destinationAddress,
        };
      }
    },
    "L_Poll_Data.req": class L_Poll_Data_req implements ServiceMessage {
      constructor(
        additionalInfo: AddInfoBase[] | null = null,
        controlField1: ControlField,
        controlField2: ExtendedControlField,
        sourceAddress: string,
        destinationAddress: string,
        numOfSlots: number,
      ) {
        if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
        this.controlField1 = controlField1;
        this.controlField2 = controlField2;
        this.sourceAddress = sourceAddress;
        this.destinationAddress = destinationAddress;
        if (numOfSlots > 15) throw new Error("The numOfSLots is under of 15 (4 bits)");
        this.numOfSlots = numOfSlots;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Poll_Data.req"].CEMI.value;
      additionalInfo: AdditionalInformationField = new AdditionalInformationField();
      controlField1: ControlField = new ControlField();
      controlField2: ExtendedControlField = new ExtendedControlField();
      sourceAddress: string = "";
      destinationAddress: string = "";
      numOfSlots: number = 0;

      toBuffer(): Buffer {
        // Cálculo correcto del tamaño total
        // Offset base = 2 (MC + AddInfoLen) + AddInfoData
        const baseOffset = 2 + this.additionalInfo.length;

        // 7 bytes fijos después de AddInfo: CF1(1) + CF2(1) + Src(2) + Dst(2) + Len(1)
        const buffer = Buffer.alloc(baseOffset + 8);

        buffer[0] = this.messageCode;
        buffer[1] = this.additionalInfo.length;

        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2);
        }

        this.controlField1.buffer.copy(buffer, baseOffset);
        this.controlField2.getBuffer().copy(buffer, baseOffset + 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, baseOffset + 2);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, baseOffset + 4);
        buffer.writeUInt8(this.numOfSlots, 6 + baseOffset);

        return buffer;
      }

      static fromBuffer(buffer: Buffer): L_Poll_Data_req {
        // 1. Validar Message Code
        const msgCode = buffer.readUInt8(0);
        if (msgCode !== MESSAGE_CODE_FIELD["L_Poll_Data.req"].CEMI.value) {
          throw new Error(`Invalid Message Code for L_Poll_Data.req: expected 0x13, got 0x${msgCode.toString(16)}`);
        }

        // 2. Parse Additional Info Length & Data
        const addInfoLength = buffer.readUInt8(1);
        let additionalInfoInstance: AdditionalInformationField | null = null;

        // Offset base correcto según estándar (2 + len)
        const baseOffset = 2 + addInfoLength;

        if (addInfoLength > 0) {
          const addInfoBuffer = buffer.subarray(2, baseOffset);
          additionalInfoInstance = AdditionalInformationField.fromBuffer(addInfoBuffer);
        }

        // 3. Control Fields
        const controlField1 = new ControlField(buffer.subarray(baseOffset, baseOffset + 1).readUint8());
        const controlField2 = new ExtendedControlField(buffer.subarray(baseOffset + 1, baseOffset + 2));

        // 4. Addresses
        const srcBuffer = buffer.subarray(baseOffset + 2, baseOffset + 4);
        const dstBuffer = buffer.subarray(baseOffset + 4, baseOffset + 6);

        const sourceAddress = KNXHelper.GetAddress(srcBuffer, controlField2.addressType ? "/" : ".") as string;
        const destinationAddress = KNXHelper.GetAddress(dstBuffer, controlField2.addressType ? "/" : ".") as string;

        const numOfSlots = buffer.subarray(6 + baseOffset, 7 + baseOffset).readUint8() & 0x0f;

        // Extraemos la información interna del wrapper AdditionalInformationField si existe
        const addInfoData = additionalInfoInstance?.items ?? null;

        return new L_Poll_Data_req(
          addInfoData,
          controlField1,
          controlField2,
          sourceAddress,
          destinationAddress,
          numOfSlots,
        );
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          controlField1: this.controlField1.describe(),
          controlField2: this.controlField2.describe(),
          sourceAddress: this.sourceAddress,
          destinationAddress: this.destinationAddress,
        };
      }
    },
    "L_Poll_Data.con": class L_Poll_Data_con implements ServiceMessage {
      constructor(
        additionalInfo: AddInfoBase[] | null = null,
        controlField1: ControlField,
        controlField2: ExtendedControlField,
        sourceAddress: string,
        destinationAddress: string,
        numOfSlots: number,
        pollData: number,
      ) {
        if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
        this.controlField1 = controlField1;
        this.controlField2 = controlField2;
        this.sourceAddress = sourceAddress;
        this.destinationAddress = destinationAddress;
        if (numOfSlots > 15) throw new Error("The numOfSLots is under of 15 (4 bits)");
        this.numOfSlots = numOfSlots;
        if (pollData > 14) throw new Error("The pollData is under of 14 (4 bits)");
        this.pollData = pollData;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value;
      additionalInfo: AdditionalInformationField = new AdditionalInformationField();
      controlField1: ControlField = new ControlField();
      controlField2: ExtendedControlField = new ExtendedControlField();
      sourceAddress: string = "";
      destinationAddress: string = "";
      numOfSlots: number = 0;
      pollData: number = 0;

      toBuffer(): Buffer {
        // Cálculo correcto del tamaño total
        // Offset base = 2 (MC + AddInfoLen) + AddInfoData
        const baseOffset = 2 + this.additionalInfo.length;

        // 7 bytes fijos después de AddInfo: CF1(1) + CF2(1) + Src(2) + Dst(2) + Len(1)
        const buffer = Buffer.alloc(baseOffset + 8);

        buffer[0] = this.messageCode;
        buffer[1] = this.additionalInfo.length;

        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2);
        }

        this.controlField1.buffer.copy(buffer, baseOffset);
        this.controlField2.getBuffer().copy(buffer, baseOffset + 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, baseOffset + 2);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, baseOffset + 4);
        buffer.writeUInt8(this.numOfSlots, 6 + baseOffset);
        buffer.writeUInt8(this.pollData, 7 + baseOffset);

        return buffer;
      }

      static fromBuffer(buffer: Buffer): L_Poll_Data_con {
        // 1. Validar Message Code
        const msgCode = buffer.readUInt8(0);
        if (msgCode !== MESSAGE_CODE_FIELD["L_Poll_Data.con"].CEMI.value) {
          throw new Error(`Invalid Message Code for L_Poll_Data.con: expected 0x25, got 0x${msgCode.toString(16)}`);
        }

        // 2. Parse Additional Info Length & Data
        const addInfoLength = buffer.readUInt8(1);
        let additionalInfoInstance: AdditionalInformationField | null = null;

        // Offset base correcto según estándar (2 + len)
        const baseOffset = 2 + addInfoLength;

        if (addInfoLength > 0) {
          const addInfoBuffer = buffer.subarray(2, baseOffset);
          additionalInfoInstance = AdditionalInformationField.fromBuffer(addInfoBuffer);
        }

        // 3. Control Fields
        const controlField1 = new ControlField(buffer.subarray(baseOffset, baseOffset + 1).readUint8());
        const controlField2 = new ExtendedControlField(buffer.subarray(baseOffset + 1, baseOffset + 2));

        // 4. Addresses
        const srcBuffer = buffer.subarray(baseOffset + 2, baseOffset + 4);
        const dstBuffer = buffer.subarray(baseOffset + 4, baseOffset + 6);

        const sourceAddress = KNXHelper.GetAddress(srcBuffer, controlField2.addressType ? "/" : ".") as string;
        const destinationAddress = KNXHelper.GetAddress(dstBuffer, controlField2.addressType ? "/" : ".") as string;

        const numOfSlots = buffer.subarray(6 + baseOffset, 7 + baseOffset).readUint8() & 0x0f;
        const pollData = buffer.subarray(7 + baseOffset, 8 + baseOffset).readUint8() & 0x0f;

        // Extraemos la información interna del wrapper AdditionalInformationField si existe
        const addInfoData = additionalInfoInstance?.items ?? null;

        return new L_Poll_Data_con(
          addInfoData,
          controlField1,
          controlField2,
          sourceAddress,
          destinationAddress,
          numOfSlots,
          pollData,
        );
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          controlField1: this.controlField1.describe(),
          controlField2: this.controlField2.describe(),
          sourceAddress: this.sourceAddress,
          destinationAddress: this.destinationAddress,
        };
      }
    },
    "L_Raw.req": class L_Raw_req implements ServiceMessage {
      constructor(additionalInfo: AddInfoBase[] | null = null, data: Buffer) {
        if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
        this.data = data;
      }

      messageCode = MESSAGE_CODE_FIELD["L_Raw.req"].CEMI.value;
      additionalInfo = new AdditionalInformationField();
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const baseOffset = 2 + this.additionalInfo.length;
        const buffer = Buffer.alloc(baseOffset + this.data.length);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.additionalInfo.length, 1);
        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2);
        }
        this.data.copy(buffer, baseOffset);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          data: this.data,
        };
      }

      static fromBuffer(buffer: Buffer) {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["L_Raw.req"].CEMI.value)
          throw new Error(`Invalid Message Code for L_Raw.req: expected 0x10, got 0x${messageCode.toString(16)}`);
        const addInfoLength = buffer.readUint8(1);
        const baseOffset = 2 + addInfoLength;
        let addInfo: AdditionalInformationField | null = null;
        if (addInfoLength > 0) {
          addInfo = AdditionalInformationField.fromBuffer(buffer.subarray(2, baseOffset));
        }
        const data = buffer.subarray(baseOffset + 1, baseOffset + 1 + buffer.length);
        const addInfoData = addInfo?.items ?? null;
        return new L_Raw_req(addInfoData, data);
      }
    },
    "L_Raw.con": class L_Raw_con implements ServiceMessage {
      constructor(additionalInfo: AddInfoBase[] | null = null, data: Buffer) {
        if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
        this.data = data;
      }

      messageCode = MESSAGE_CODE_FIELD["L_Raw.con"].CEMI.value;
      additionalInfo = new AdditionalInformationField();
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const baseOffset = 2 + this.additionalInfo.length;
        const buffer = Buffer.alloc(baseOffset + this.data.length);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.additionalInfo.length, 1);
        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2);
        }
        this.data.copy(buffer, baseOffset);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          data: this.data,
        };
      }

      static fromBuffer(buffer: Buffer) {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["L_Raw.con"].CEMI.value)
          throw new Error(`Invalid Message Code for L_Raw.con: expected 0x2f, got 0x${messageCode.toString(16)}`);
        const addInfoLength = buffer.readUint8(1);
        const baseOffset = 2 + addInfoLength;
        let addInfo: AdditionalInformationField | null = null;
        if (addInfoLength > 0) {
          addInfo = AdditionalInformationField.fromBuffer(buffer.subarray(2, baseOffset));
        }
        const data = buffer.subarray(baseOffset + 1, baseOffset + 1 + buffer.length);
        const addInfoData = addInfo?.items ?? null;
        return new L_Raw_con(addInfoData, data);
      }
    },
    "L_Raw.ind": class L_Raw_ind implements ServiceMessage {
      constructor(additionalInfo: AddInfoBase[] | null = null, data: Buffer) {
        if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
        this.data = data;
      }

      messageCode = MESSAGE_CODE_FIELD["L_Raw.ind"].CEMI.value;
      additionalInfo = new AdditionalInformationField();
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const baseOffset = 2 + this.additionalInfo.length;
        const buffer = Buffer.alloc(baseOffset + this.data.length);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.additionalInfo.length, 1);
        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2);
        }
        this.data.copy(buffer, baseOffset);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          data: this.data,
        };
      }

      static fromBuffer(buffer: Buffer) {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["L_Raw.ind"].CEMI.value)
          throw new Error(`Invalid Message Code for L_Raw.ind: expected 0x2D, got 0x${messageCode.toString(16)}`);
        const addInfoLength = buffer.readUint8(1);
        const baseOffset = 2 + addInfoLength;
        let addInfo: AdditionalInformationField | null = null;
        if (addInfoLength > 0) {
          addInfo = AdditionalInformationField.fromBuffer(buffer.subarray(2, baseOffset));
        }
        const data = buffer.subarray(baseOffset + 1, baseOffset + 1 + buffer.length);
        const addInfoData = addInfo?.items ?? null;
        return new L_Raw_ind(addInfoData, data);
      }
    },
  } as const;
}

// !! Type check in all class

type KeysOfCEMI = "DataLinkLayerCEMI";

type ExcludedServices = never;

type CEMIServiceConstructor<T> = T extends { new (...args: any[]): infer I }
  ? {
      new (...args: any[]): I;
      fromBuffer(buffer: Buffer): I;
    }
  : never;

type CEMIValidator = {
  [K in KeysOfCEMI]: {
    [S in keyof (typeof CEMI)[K]]: S extends ExcludedServices
      ? any
      : (typeof CEMI)[K][S] extends { new (...args: any[]): any }
        ? CEMIServiceConstructor<(typeof CEMI)[K][S]>
        : any;
  };
};

CEMI satisfies CEMIValidator;
