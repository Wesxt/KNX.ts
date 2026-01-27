import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { KNXHelper } from "../utils/KNXHelper";
import { ControlField } from "./ControlField";
import { ExtendedControlField } from "./ControlFieldExtended";
import {
  AddInfoBase,
  BiBatInformation,
  BusmonitorStatusInfo,
  ExtendedRelativeTimestamp,
  ManufacturerSpecificData,
  PLMediumInfo,
  PreambleAndPostamble,
  RFFastACKInformation,
  RFMediumInformation,
  RFMultiInformation,
  TimeDelayUntilSending,
  TimestampRelative,
} from "./KNXAddInfoTypes";
import { MESSAGE_CODE_FIELD } from "./MessageCodeField";
import { ErrorCodeSet } from "./enum/ErrorCodeSet";
import { TPDU } from "./layers/data/TPDU";
import { TPCI } from "./layers/interfaces/TPCI";

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
            item = new BusmonitorStatusInfo(dataSubset); // Implementar si falta
            break;
          case CEMIAddInfoType.TIMESTAMP_RELATIVE:
            item = new TimestampRelative(dataSubset);
            break;
          case CEMIAddInfoType.TIME_DELAY_UNTIL_SENDING:
            item = new TimeDelayUntilSending(dataSubset);
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
    "L_Busmon.ind": class L_Busmon_ind implements ServiceMessage {
      constructor(additionalInfo: AddInfoBase[] | null, data: Buffer) {
        this.data = data;
        if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
      }
      messageCode = MESSAGE_CODE_FIELD["L_Busmon.ind"].CEMI.value;
      additionalInfo = new AdditionalInformationField([new BusmonitorStatusInfo(), new TimestampRelative()]);
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.data.length);
        const baseOffset = 2 + this.additionalInfo.length;
        buffer.writeUint8(this.messageCode, 0);
        buffer.writeUint8(this.additionalInfo.length, 1);
        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2, baseOffset);
        }
        this.data.copy(buffer, baseOffset + 1, baseOffset + 1 + this.data.length);
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
        if (messageCode !== MESSAGE_CODE_FIELD["L_Busmon.ind"].CEMI.value)
          throw new Error(`Invalid Message Code for L_Busmon.ind: expected 0x2B, got 0x${messageCode.toString(16)}`);
        const addInfoLength = buffer.readUint8(1);
        const baseOffset = 2 + addInfoLength;
        let addInfo: AdditionalInformationField | null = null;
        if (addInfoLength > 0) {
          addInfo = AdditionalInformationField.fromBuffer(buffer.subarray(2, baseOffset));
        }
        const data = buffer.subarray(baseOffset + 1, baseOffset + 1 + buffer.length);
        const addInfoData = addInfo?.items ?? null;
        return new L_Busmon_ind(addInfoData, data);
      }
    },
  } as const;

  static TransportLayerCEMI = {
    "T_Data_Connected.req": class T_Data_Connected_ind implements ServiceMessage {
      constructor(addInfo: AddInfoBase[] | null, TPDU: TPDU) {
        if (addInfo) this.additionalInfo = new AdditionalInformationField(addInfo);
        this.tpdu = TPDU;
      }

      messageCode = MESSAGE_CODE_FIELD["T_Data_Connected.req"].CEMI.value;
      additionalInfo = new AdditionalInformationField();
      tpdu = new TPDU(new TPCI(0));

      toBuffer(): Buffer {
        const baseOffset = 2 + this.additionalInfo.length;
        const buffer = Buffer.alloc(baseOffset + 6 + 1 + this.tpdu.length);
        buffer.writeUint8(this.messageCode, 0);
        buffer.writeUint8(this.additionalInfo.length, 1);
        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2, baseOffset);
        }
        buffer.writeUint8(this.tpdu.length, baseOffset + 6);
        this.tpdu.toBuffer().copy(buffer, baseOffset + 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          tpdu: this.tpdu,
        };
      }

      static fromBuffer(buffer: Buffer) {
        const messageCode = MESSAGE_CODE_FIELD["T_Data_Connected.req"].CEMI.value;
        if (messageCode !== buffer.readUint8(0)) {
          throw new Error(
            `Invalid Message Code for T_Data_Connected.ind: expected 0x41, got 0x${messageCode.toString(16)}`,
          );
        }
        const addInfoLength = buffer.readUInt8(1);
        const baseOffset = 2 + addInfoLength;
        let addInfo: AdditionalInformationField | null = null;
        if (addInfoLength > 0) {
          addInfo = AdditionalInformationField.fromBuffer(buffer.subarray(2, baseOffset));
        }
        const addInfoData = addInfo?.items ?? null;
        const tpdu = TPDU.fromBuffer(buffer.subarray(7 + baseOffset));
        return new T_Data_Connected_ind(addInfoData, tpdu);
      }
    },
    "T_Data_Connected.ind": class T_Data_Connected_ind implements ServiceMessage {
      constructor(addInfo: AddInfoBase[] | null, TPDU: TPDU) {
        if (addInfo) this.additionalInfo = new AdditionalInformationField(addInfo);
        this.tpdu = TPDU;
      }

      messageCode = MESSAGE_CODE_FIELD["T_Data_Connected.ind"].CEMI.value;
      additionalInfo = new AdditionalInformationField();
      tpdu = new TPDU(new TPCI(0));

      toBuffer(): Buffer {
        const baseOffset = 2 + this.additionalInfo.length;
        const buffer = Buffer.alloc(baseOffset + 6 + 1 + this.tpdu.length);
        buffer.writeUint8(this.messageCode, 0);
        buffer.writeUint8(this.additionalInfo.length, 1);
        if (this.additionalInfo.length > 0) {
          this.additionalInfo.toBuffer().copy(buffer, 2, baseOffset);
        }
        buffer.writeUint8(this.tpdu.length, baseOffset + 6);
        this.tpdu.toBuffer().copy(buffer, baseOffset + 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          additionalInfo: this.additionalInfo,
          tpdu: this.tpdu,
        };
      }

      static fromBuffer(buffer: Buffer) {
        const messageCode = MESSAGE_CODE_FIELD["T_Data_Connected.ind"].CEMI.value;
        if (messageCode !== buffer.readUint8(0)) {
          throw new Error(
            `Invalid Message Code for T_Data_Connected.ind: expected 0x89, got 0x${messageCode.toString(16)}`,
          );
        }
        const addInfoLength = buffer.readUInt8(1);
        const baseOffset = 2 + addInfoLength;
        let addInfo: AdditionalInformationField | null = null;
        if (addInfoLength > 0) {
          addInfo = AdditionalInformationField.fromBuffer(buffer.subarray(2, baseOffset));
        }
        const addInfoData = addInfo?.items ?? null;
        const tpdu = TPDU.fromBuffer(buffer.subarray(7 + baseOffset));
        return new T_Data_Connected_ind(addInfoData, tpdu);
      }
    },
  } as const;

  static ManagementCEMI = {
    // ---------------------------------------------------------------------
    // M_PropRead
    // ---------------------------------------------------------------------
    "M_PropRead.req": class M_PropRead_req implements ServiceMessage {
      constructor(
        interfaceObjectType: number,
        objectInstance: number,
        propertyId: number,
        numberOfElements: number,
        startIndex: number,
      ) {
        this.interfaceObjectType = interfaceObjectType;
        this.objectInstance = objectInstance;
        this.propertyId = propertyId;
        this.numberOfElements = numberOfElements;
        this.startIndex = startIndex;
      }

      messageCode = MESSAGE_CODE_FIELD["M_PropRead.req"].CEMI.value; // 0xFC
      interfaceObjectType: number = 0;
      objectInstance: number = 0;
      propertyId: number = 0;
      numberOfElements: number = 1;
      startIndex: number = 1;

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt16BE(this.interfaceObjectType, 1);
        buffer.writeUInt8(this.objectInstance, 3);
        buffer.writeUInt8(this.propertyId, 4);
        buffer.writeUInt16BE((this.startIndex & 0x0fff) | ((this.numberOfElements & 0x0f) << 12), 5);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          interfaceObjectType: this.interfaceObjectType,
          objectInstance: this.objectInstance,
          propertyId: this.propertyId,
          numberOfElements: this.numberOfElements,
          startIndex: this.startIndex,
        };
      }

      static fromBuffer(buffer: Buffer): M_PropRead_req {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["M_PropRead.req"].CEMI.value)
          throw new Error(`Invalid Message Code for M_PropRead.req: expected 0xFC, got 0x${messageCode.toString(16)}`);

        const interfaceObjectType = buffer.readUInt16BE(1);
        const objectInstance = buffer.readUInt8(3);
        const propertyId = buffer.readUInt8(4);
        const byte5 = buffer.readUInt16BE(5);
        const startIndex = byte5 & 0x0fff;
        const numberOfElements = byte5 & 0xf000;

        return new M_PropRead_req(interfaceObjectType, objectInstance, propertyId, numberOfElements, startIndex);
      }
    },
    "M_PropRead.con": class M_PropRead_con implements ServiceMessage {
      constructor(
        interfaceObjectType: number,
        objectInstance: number,
        propertyId: number,
        numberOfElements: number,
        startIndex: number,
        data: Buffer,
      ) {
        this.interfaceObjectType = interfaceObjectType;
        this.objectInstance = objectInstance;
        this.propertyId = propertyId;
        this.numberOfElements = numberOfElements;
        this.startIndex = startIndex;
        this.data = data;
      }

      messageCode = MESSAGE_CODE_FIELD["M_PropRead.con"].CEMI.value; // 0xFC
      interfaceObjectType: number = 0;
      objectInstance: number = 0;
      propertyId: number = 0;
      numberOfElements: number = 1;
      startIndex: number = 1;
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.data.length);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt16BE(this.interfaceObjectType, 1);
        buffer.writeUInt8(this.objectInstance, 3);
        buffer.writeUInt8(this.propertyId, 4);
        buffer.writeUInt16BE((this.startIndex & 0x0fff) | ((this.numberOfElements & 0x0f) << 12), 5);
        this.data.copy(buffer, 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          interfaceObjectType: this.interfaceObjectType,
          objectInstance: this.objectInstance,
          propertyId: this.propertyId,
          numberOfElements: this.numberOfElements,
          startIndex: this.startIndex,
        };
      }

      static fromBuffer(buffer: Buffer): M_PropRead_con {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["M_PropRead.con"].CEMI.value)
          throw new Error(`Invalid Message Code for M_PropRead.con: expected 0xFB, got 0x${messageCode.toString(16)}`);

        const interfaceObjectType = buffer.readUInt16BE(1);
        const objectInstance = buffer.readUInt8(3);
        const propertyId = buffer.readUInt8(4);
        const byte5 = buffer.readUInt16BE(5);
        const startIndex = byte5 & 0x0fff;
        const numberOfElements = byte5 & 0xf000;
        const data = buffer.subarray(7, buffer.length - 1);

        return new M_PropRead_con(interfaceObjectType, objectInstance, propertyId, numberOfElements, startIndex, data);
      }
    },

    // ---------------------------------------------------------------------
    // M_PropWrite
    // ---------------------------------------------------------------------
    "M_PropWrite.req": class M_PropWrite_req implements ServiceMessage {
      constructor(
        interfaceObjectType: number,
        objectInstance: number,
        propertyId: number,
        numberOfElements: number,
        startIndex: number,
        data: Buffer,
      ) {
        this.interfaceObjectType = interfaceObjectType;
        this.objectInstance = objectInstance;
        this.propertyId = propertyId;
        this.numberOfElements = numberOfElements;
        this.startIndex = startIndex;
        this.data = data;
      }

      messageCode = MESSAGE_CODE_FIELD["M_PropWrite.req"].CEMI.value; // 0xFC
      interfaceObjectType: number = 0;
      objectInstance: number = 0;
      propertyId: number = 0;
      numberOfElements: number = 1;
      startIndex: number = 1;
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.data.length);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt16BE(this.interfaceObjectType, 1);
        buffer.writeUInt8(this.objectInstance, 3);
        buffer.writeUInt8(this.propertyId, 4);
        buffer.writeUInt16BE((this.startIndex & 0x0fff) | ((this.numberOfElements & 0x0f) << 12), 5);
        this.data.copy(buffer, 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          interfaceObjectType: this.interfaceObjectType,
          objectInstance: this.objectInstance,
          propertyId: this.propertyId,
          numberOfElements: this.numberOfElements,
          startIndex: this.startIndex,
        };
      }

      static fromBuffer(buffer: Buffer): M_PropWrite_req {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["M_PropWrite.req"].CEMI.value)
          throw new Error(`Invalid Message Code for M_PropWrite.req: expected 0xF6, got 0x${messageCode.toString(16)}`);

        const interfaceObjectType = buffer.readUInt16BE(1);
        const objectInstance = buffer.readUInt8(3);
        const propertyId = buffer.readUInt8(4);
        const byte5 = buffer.readUInt16BE(5);
        const startIndex = byte5 & 0x0fff;
        const numberOfElements = byte5 & 0xf000;
        const data = buffer.subarray(7, buffer.length - 1);

        return new M_PropWrite_req(interfaceObjectType, objectInstance, propertyId, numberOfElements, startIndex, data);
      }
    },

    "M_PropWrite.con": class M_PropWrite_con implements ServiceMessage {
      constructor(
        interfaceObjectType: number,
        objectInstance: number,
        propertyId: number,
        numberOfElements: number,
        startIndex: number,
        errorInfo: ErrorCodeSet,
      ) {
        this.interfaceObjectType = interfaceObjectType;
        this.objectInstance = objectInstance;
        this.propertyId = propertyId;
        this.numberOfElements = numberOfElements;
        this.startIndex = startIndex;
        this.errorInfo = errorInfo;
      }

      messageCode = MESSAGE_CODE_FIELD["M_PropWrite.con"].CEMI.value; // 0xFC
      interfaceObjectType: number = 0;
      objectInstance: number = 0;
      propertyId: number = 0;
      numberOfElements: number = 1;
      startIndex: number = 1;
      errorInfo: number;

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt16BE(this.interfaceObjectType, 1);
        buffer.writeUInt8(this.objectInstance, 3);
        buffer.writeUInt8(this.propertyId, 4);
        buffer.writeUInt16BE((this.startIndex & 0x0fff) | ((this.numberOfElements & 0x0f) << 12), 5);
        buffer.writeUint8(this.errorInfo, 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          interfaceObjectType: this.interfaceObjectType,
          objectInstance: this.objectInstance,
          propertyId: this.propertyId,
          numberOfElements: this.numberOfElements,
          startIndex: this.startIndex,
        };
      }

      static fromBuffer(buffer: Buffer): M_PropWrite_con {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["M_PropWrite.con"].CEMI.value)
          throw new Error(`Invalid Message Code for M_PropWrite.con: expected 0xF5, got 0x${messageCode.toString(16)}`);

        const interfaceObjectType = buffer.readUInt16BE(1);
        const objectInstance = buffer.readUInt8(3);
        const propertyId = buffer.readUInt8(4);
        const byte5 = buffer.readUInt16BE(5);
        const startIndex = byte5 & 0x0fff;
        const numberOfElements = byte5 & 0xf000;
        const errorInfo = buffer.subarray(7).readUint8();

        return new M_PropWrite_con(
          interfaceObjectType,
          objectInstance,
          propertyId,
          numberOfElements,
          startIndex,
          errorInfo,
        );
      }
    },
    // ---------------------------------------------------------------------
    // M_PropInfo
    // ---------------------------------------------------------------------
    "M_PropInfo.ind": class M_PropInfo_ind implements ServiceMessage {
      constructor(
        interfaceObjectType: number,
        objectInstance: number,
        propertyId: number,
        numberOfElements: number,
        startIndex: number,
        data: Buffer,
      ) {
        this.interfaceObjectType = interfaceObjectType;
        this.objectInstance = objectInstance;
        this.propertyId = propertyId;
        this.numberOfElements = numberOfElements;
        this.startIndex = startIndex;
        this.data = data;
      }

      messageCode = MESSAGE_CODE_FIELD["M_PropInfo.ind"].CEMI.value; // 0xF7
      interfaceObjectType: number = 0;
      objectInstance: number = 0;
      propertyId: number = 0;
      numberOfElements: number = 1;
      startIndex: number = 1;
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.data.length);

        buffer.writeUInt8(this.messageCode, 0);

        buffer.writeUInt16BE(this.interfaceObjectType, 1);
        buffer.writeUInt8(this.objectInstance, 3);
        buffer.writeUInt8(this.propertyId, 4);
        buffer.writeUInt16BE((this.startIndex & 0x0fff) | ((this.numberOfElements & 0x0f) << 12), 5);
        this.data.copy(buffer, 7);

        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          interfaceObjectType: this.interfaceObjectType,
          objectInstance: this.objectInstance,
          propertyId: this.propertyId,
          numberOfElements: this.numberOfElements,
          startIndex: this.startIndex,
          data: this.data,
        };
      }

      static fromBuffer(buffer: Buffer): M_PropInfo_ind {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["M_PropInfo.ind"].CEMI.value)
          throw new Error(`Invalid Message Code for M_PropInfo.ind: expected 0xF7, got 0x${messageCode.toString(16)}`);

        const interfaceObjectType = buffer.readUInt16BE(1);
        const objectInstance = buffer.readUInt8(3);
        const propertyId = buffer.readUInt8(4);
        const byte5 = buffer.readUInt16BE(5);
        const startIndex = byte5 & 0x0fff;
        const numberOfElements = byte5 & 0xf000;
        const data = buffer.subarray(7);

        return new M_PropInfo_ind(interfaceObjectType, objectInstance, propertyId, numberOfElements, startIndex, data);
      }
    },

    // ---------------------------------------------------------------------
    // M_FuncPropCommand
    // ---------------------------------------------------------------------
    "M_FuncPropCommand.req": class M_FuncPropCommand_req implements ServiceMessage {
      constructor(interfaceObjectType: number, objectInstance: number, propertyIndentifier: number, data: Buffer) {
        this.interfaceObjectType = interfaceObjectType;
        this.objectInstance = objectInstance;
        this.propertyId = propertyIndentifier;
        this.data = data;
      }

      messageCode = MESSAGE_CODE_FIELD["M_FuncPropCommand.req"].CEMI.value;
      interfaceObjectType: number = 0;
      objectInstance: number = 0;
      propertyId: number = 0;
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(5 + this.data.length);
        buffer.writeUint8(this.messageCode, 0);
        buffer.writeUint16BE(this.interfaceObjectType, 1);
        buffer.writeUint8(this.objectInstance, 3);
        buffer.writeUint8(this.propertyId, 4);
        this.data.copy(buffer, 5);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          interfaceObjectType: this.interfaceObjectType,
          objectInstance: this.objectInstance,
          propertyId: this.propertyId,
        };
      }

      static fromBuffer(buffer: Buffer) {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["M_FuncPropCommand.req"].CEMI.value)
          throw new Error(
            `Invalid Message Code for M_FuncPropCommand.req: expected 0xF8, got 0x${messageCode.toString(16)}`,
          );

        const interfaceObjectType = buffer.readUInt16BE(1);
        const objectInstance = buffer.readUInt8(3);
        const propertyId = buffer.readUInt8(4);
        const data = buffer.subarray(5);
        return new M_FuncPropCommand_req(interfaceObjectType, objectInstance, propertyId, data);
      }
    },
    "M_FuncPropCommand.con": class M_FuncPropCommand_con implements ServiceMessage {
      constructor(
        interfaceObjectType: number,
        objectInstance: number,
        propertyIndentifier: number,
        return_code: number,
        data: Buffer,
      ) {
        this.interfaceObjectType = interfaceObjectType;
        this.objectInstance = objectInstance;
        this.propertyId = propertyIndentifier;
        this.return_code = return_code;
        this.data = data;
      }

      messageCode = MESSAGE_CODE_FIELD["M_FuncPropCommand.con"].CEMI.value;
      interfaceObjectType: number = 0;
      objectInstance: number = 0;
      propertyId: number = 0;
      return_code: number = 0;
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6 + this.data.length);
        buffer.writeUint8(this.messageCode, 0);
        buffer.writeUint16BE(this.interfaceObjectType, 1);
        buffer.writeUint8(this.objectInstance, 3);
        buffer.writeUint8(this.propertyId, 4);
        buffer.writeUint8(this.return_code, 5);
        this.data.copy(buffer, 6);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          interfaceObjectType: this.interfaceObjectType,
          objectInstance: this.objectInstance,
          propertyId: this.propertyId,
          return_code: this.return_code,
        };
      }

      static fromBuffer(buffer: Buffer) {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["M_FuncPropCommand.con"].CEMI.value)
          throw new Error(
            `Invalid Message Code for M_FuncPropCommand.con: expected 0xFA, got 0x${messageCode.toString(16)}`,
          );

        const interfaceObjectType = buffer.readUInt16BE(1);
        const objectInstance = buffer.readUInt8(3);
        const propertyId = buffer.readUInt8(4);
        const return_code = buffer.readUint8(5);
        const data = buffer.subarray(6);
        return new M_FuncPropCommand_con(interfaceObjectType, objectInstance, propertyId, return_code, data);
      }
    },
    "M_FuncPropStateRead.req": class M_FuncPropCommand_con implements ServiceMessage {
      constructor(interfaceObjectType: number, objectInstance: number, propertyIndentifier: number, data: Buffer) {
        this.interfaceObjectType = interfaceObjectType;
        this.objectInstance = objectInstance;
        this.propertyId = propertyIndentifier;
        this.data = data;
      }

      messageCode = MESSAGE_CODE_FIELD["M_FuncPropStateRead.req"].CEMI.value;
      interfaceObjectType: number = 0;
      objectInstance: number = 0;
      propertyId: number = 0;
      data: Buffer = Buffer.alloc(1);

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(5 + this.data.length);
        buffer.writeUint8(this.messageCode, 0);
        buffer.writeUint16BE(this.interfaceObjectType, 1);
        buffer.writeUint8(this.objectInstance, 3);
        buffer.writeUint8(this.propertyId, 4);
        this.data.copy(buffer, 5);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          interfaceObjectType: this.interfaceObjectType,
          objectInstance: this.objectInstance,
          propertyId: this.propertyId,
        };
      }

      static fromBuffer(buffer: Buffer) {
        const messageCode = buffer.readUInt8(0);
        if (messageCode !== MESSAGE_CODE_FIELD["M_FuncPropStateRead.req"].CEMI.value)
          throw new Error(
            `Invalid Message Code for M_FuncPropStateRead.req: expected 0xF9, got 0x${messageCode.toString(16)}`,
          );

        const interfaceObjectType = buffer.readUInt16BE(1);
        const objectInstance = buffer.readUInt8(3);
        const propertyId = buffer.readUInt8(4);
        const data = buffer.subarray(5);
        return new M_FuncPropCommand_con(interfaceObjectType, objectInstance, propertyId, data);
      }
    },
    // ---------------------------------------------------------------------
    // M_Reset
    // ---------------------------------------------------------------------
    // "M_Reset.req": class M_Reset_req implements ServiceMessage {
    //   constructor(additionalInfo: AddInfoBase[] | null = null) {
    //     if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
    //   }
    //   messageCode = MESSAGE_CODE_FIELD["M_Reset.req"].CEMI.value; // 0xF1
    //   additionalInfo: AdditionalInformationField = new AdditionalInformationField();

    //   toBuffer(): Buffer {
    //     const baseOffset = 2 + this.additionalInfo.length;
    //     const buffer = Buffer.alloc(baseOffset);
    //     buffer.writeUInt8(this.messageCode, 0);
    //     buffer.writeUInt8(this.additionalInfo.length, 1);
    //     if (this.additionalInfo.length > 0) {
    //       this.additionalInfo.toBuffer().copy(buffer, 2);
    //     }
    //     return buffer;
    //   }
    //   describe() {
    //     return { messageCode: this.messageCode, additionalInfo: this.additionalInfo };
    //   }

    //   static fromBuffer(buffer: Buffer): M_Reset_req {
    //     const messageCode = buffer.readUInt8(0);
    //     if (messageCode !== MESSAGE_CODE_FIELD["M_Reset.req"].CEMI.value) throw new Error("Invalid MC for M_Reset.req");
    //     // Parse AddInfo Logic similiar to others...
    //     const addInfoLength = buffer.readUInt8(1);
    //     const baseOffset = 2 + addInfoLength;
    //     let addInfo: AdditionalInformationField | null = null;
    //     if (addInfoLength > 0) addInfo = AdditionalInformationField.fromBuffer(buffer.subarray(2, baseOffset));
    //     return new M_Reset_req(addInfo?.items ?? null);
    //   }
    // },
    // "M_Reset.ind": class M_Reset_ind implements ServiceMessage {
    //   constructor(additionalInfo: AddInfoBase[] | null = null) {
    //     if (additionalInfo) this.additionalInfo = new AdditionalInformationField(additionalInfo);
    //   }
    //   messageCode = MESSAGE_CODE_FIELD["M_Reset.ind"].CEMI.value; // 0xF0
    //   additionalInfo: AdditionalInformationField = new AdditionalInformationField();

    //   toBuffer(): Buffer {
    //     const baseOffset = 2 + this.additionalInfo.length;
    //     const buffer = Buffer.alloc(baseOffset);
    //     buffer.writeUInt8(this.messageCode, 0);
    //     buffer.writeUInt8(this.additionalInfo.length, 1);
    //     if (this.additionalInfo.length > 0) {
    //       this.additionalInfo.toBuffer().copy(buffer, 2);
    //     }
    //     return buffer;
    //   }
    //   describe() {
    //     return { messageCode: this.messageCode, additionalInfo: this.additionalInfo };
    //   }

    //   static fromBuffer(buffer: Buffer): M_Reset_ind {
    //     const messageCode = buffer.readUInt8(0);
    //     if (messageCode !== MESSAGE_CODE_FIELD["M_Reset.ind"].CEMI.value) throw new Error("Invalid MC for M_Reset.ind");
    //     const addInfoLength = buffer.readUInt8(1);
    //     const baseOffset = 2 + addInfoLength;
    //     let addInfo: AdditionalInformationField | null = null;
    //     if (addInfoLength > 0) addInfo = AdditionalInformationField.fromBuffer(buffer.subarray(2, baseOffset));
    //     return new M_Reset_ind(addInfo?.items ?? null);
    //   }
    // },
  } as const;
}

// !! Type check in all class

type KeysOfCEMI = "DataLinkLayerCEMI" | "TransportLayerCEMI";

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
