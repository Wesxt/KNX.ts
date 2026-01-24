// KNXAddInfoTypes.ts
import { Buffer } from "buffer";
import { Status } from "./SystemStatus";

/**
 * Interfaz base para todos los tipos de AddInfo.
 * Define las propiedades y métodos comunes.
 */
interface IAddInfoType {
  /** El identificador de tipo (p.ej., 0x02, 0x06). */
  readonly typeId: number;
  /** La longitud de los *datos* (sin incluir el Type ID y el octeto de Longitud). */
  readonly dataLength: number;
  /**
   * Genera un Buffer que representa la estructura completa de AddInfo,
   * incluyendo Type ID, Length y los datos.
   * @returns Un Buffer listo para ser enviado.
   */
  getBuffer(): Buffer;
}

/**
 * Clase base abstracta para ayudar a implementar IAddInfoType.
 */
export abstract class AddInfoBase implements IAddInfoType {
  protected _typeId: number;
  protected _dataLength: number; // Longitud de los datos (sin TypeID y Length byte)

  constructor(typeId: number, dataLength: number) {
    this._typeId = typeId;
    this._dataLength = dataLength;
  }

  public get typeId(): number {
    return this._typeId;
  }

  public get dataLength(): number {
    return this._dataLength;
  }

  public get totalLength() {
    return this.getBuffer().length;
  }

  public abstract getBuffer(): Buffer;

  /**
   * Ayudante para parsear el header del buffer en los constructores hijos.
   * @param buffer El buffer de entrada completo (comenzando con Type ID).
   * @param expectedType El Type ID esperado para esta clase.
   * @param expectedLength La longitud de datos fija esperada (para tipos de longitud no variable).
   * @returns El Buffer que contiene solo la porción de *datos*.
   */
  protected static parseDataBuffer(buffer: Buffer, expectedType: number, expectedLength?: number): Buffer {
    if (buffer.length < 2) {
      throw new Error(
        `[AddInfoBase] Buffer demasiado corto. Se esperaban al menos 2 octetos, se recibieron ${buffer.length}.`,
      );
    }

    const typeId = buffer.readUInt8(0);
    const length = buffer.readUInt8(1);

    if (typeId !== expectedType) {
      throw new Error(
        `[AddInfoBase] Type ID incorrecto. Se esperaba 0x${expectedType.toString(16)}, se recibió 0x${typeId.toString(
          16,
        )}.`,
      );
    }

    const dataBuffer = buffer.subarray(2);

    if (dataBuffer.length !== length) {
      throw new Error(
        `[AddInfoBase] Discrepancia en la longitud del buffer. El header dice ${length}, pero los datos tienen ${dataBuffer.length} octetos.`,
      );
    }

    if (expectedLength !== undefined && length !== expectedLength) {
      throw new Error(
        `[AddInfoBase] Longitud de datos incorrecta. Se esperaba ${expectedLength}, se recibió ${length}.`,
      );
    }

    return dataBuffer;
  }
}

export class PLMediumInfo extends AddInfoBase {
  public static readonly TYPE_ID = 0x01;
  public static readonly DATA_LENGTH = 0x02;

  constructor(buffer?: Buffer) {
    super(PLMediumInfo.TYPE_ID, PLMediumInfo.DATA_LENGTH);

    if (buffer) {
      const data = AddInfoBase.parseDataBuffer(buffer, PLMediumInfo.TYPE_ID, PLMediumInfo.DATA_LENGTH);
      data.copy(this._domainAddress, 0, 2);
    }
  }

  private _domainAddress: Buffer = Buffer.alloc(2);

  public set domainAddress(value: Buffer) {
    this._domainAddress = value;
  }

  public get domainAddress() {
    return this._domainAddress;
  }

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(4); // 1 (Type) + 1 (Length) + 2 (Data)
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);
    buffer.writeUInt8(this._domainAddress[0], 2);
    buffer.writeUInt8(this._domainAddress[1], 3);
    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.2 AddInfoType 02h: RF medium information
// -------------------------------------------------------------------

/**
 * Implementación de AddInfoType 02h: RF medium information.
 * Longitud de datos: 8 octetos.
 */
export class RFMediumInformation extends AddInfoBase {
  private _rfInfo: number = 0;
  private _serialNumberOrDoA: Buffer = Buffer.alloc(6);
  private _lfn: number = 0;

  public static readonly TYPE_ID = 0x02;
  public static readonly DATA_LENGTH = 0x08;

  constructor(buffer?: Buffer) {
    super(RFMediumInformation.TYPE_ID, RFMediumInformation.DATA_LENGTH);

    if (buffer) {
      const dataBuffer = AddInfoBase.parseDataBuffer(buffer, this._typeId, this._dataLength);
      this._rfInfo = dataBuffer.readUInt8(0);
      dataBuffer.copy(this._serialNumberOrDoA, 0, 1, 7);
      this._lfn = dataBuffer.readUInt8(7);
    } else {
      // Valores por defecto
      this._rfInfo = 0b00000010; // Battery OK por defecto
    }
  }

  // --- Getters y Setters para RF-Info (Octeto 0) ---

  public get routeLastFlag(): boolean {
    return (this._rfInfo & 0b10000000) !== 0;
  }
  public set routeLastFlag(value: boolean) {
    this._rfInfo = value ? this._rfInfo | 0b10000000 : this._rfInfo & ~0b10000000;
  }

  public get rssi(): number {
    return (this._rfInfo & 0b00110000) >> 4;
  }
  public set rssi(value: number) {
    this._rfInfo = (this._rfInfo & ~0b00110000) | ((value & 0b11) << 4);
  }

  public get retransmitterRssi(): number {
    return (this._rfInfo & 0b00001100) >> 2;
  }
  public set retransmitterRssi(value: number) {
    this._rfInfo = (this._rfInfo & ~0b00001100) | ((value & 0b11) << 2);
  }

  public get batteryState(): boolean {
    return (this._rfInfo & 0b00000010) !== 0;
  }
  public set batteryState(value: boolean) {
    this._rfInfo = value ? this._rfInfo | 0b00000010 : this._rfInfo & ~0b00000010;
  }

  public get unidirFlag(): boolean {
    return (this._rfInfo & 0b00000001) !== 0;
  }
  public set unidirFlag(value: boolean) {
    this._rfInfo = value ? this._rfInfo | 0b00000001 : this._rfInfo & ~0b00000001;
  }

  // --- Getters y Setters para otros campos ---

  public get serialNumberOrDoA(): Buffer {
    return this._serialNumberOrDoA;
  }
  public set serialNumberOrDoA(value: Buffer) {
    if (value.length !== 6) {
      throw new Error("El número de serie/DoA debe tener 6 octetos.");
    }
    this._serialNumberOrDoA = Buffer.from(value);
  }

  public get lfn(): number {
    return this._lfn;
  }
  public set lfn(value: number) {
    this._lfn = value & 0xff;
  }

  // --- Método getBuffer ---

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(10); // 1 (Type) + 1 (Length) + 8 (Data)
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);

    buffer.writeUInt8(this._rfInfo, 2);
    this._serialNumberOrDoA.copy(buffer, 3);
    buffer.writeUInt8(this._lfn, 9);

    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.3 AddInfo-Type 06h: Extended relative timestamp
// -------------------------------------------------------------------

/**
 * Implementación de AddInfoType 06h: Extended relative timestamp.
 * Longitud de datos: 4 octetos.
 */
export class ExtendedRelativeTimestamp extends AddInfoBase {
  private _timestamp: number = 0;

  public static readonly TYPE_ID = 0x06;
  public static readonly DATA_LENGTH = 0x04;

  constructor(buffer?: Buffer) {
    super(ExtendedRelativeTimestamp.TYPE_ID, ExtendedRelativeTimestamp.DATA_LENGTH);

    if (buffer) {
      const dataBuffer = AddInfoBase.parseDataBuffer(buffer, this._typeId, this._dataLength);
      this._timestamp = dataBuffer.readUInt32BE(0);
    }
  }

  public get timestamp(): number {
    return this._timestamp;
  }
  public set timestamp(value: number) {
    this._timestamp = value;
  }

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(6); // 1 (Type) + 1 (Length) + 4 (Data)
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);
    buffer.writeUInt32BE(this._timestamp, 2);
    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.4 AddInfo-Type 07h: BiBat information
// -------------------------------------------------------------------

/**
 * Implementación de AddInfoType 07h: BiBat information.
 * Longitud de datos: 2 octetos.
 */
export class BiBatInformation extends AddInfoBase {
  private _bibatCtrl: number = 0;
  private _bibatBlock: number = 0;

  public static readonly TYPE_ID = 0x07;
  public static readonly DATA_LENGTH = 0x02;

  constructor(buffer?: Buffer) {
    super(BiBatInformation.TYPE_ID, BiBatInformation.DATA_LENGTH);

    if (buffer) {
      const dataBuffer = AddInfoBase.parseDataBuffer(buffer, this._typeId, this._dataLength);
      this._bibatCtrl = dataBuffer.readUInt8(0);
      this._bibatBlock = dataBuffer.readUInt8(1);
    }
  }

  public get bibatCtrl(): number {
    // Devuelve solo los 4 bits superiores
    return (this._bibatCtrl & 0xf0) >> 4;
  }
  public set bibatCtrl(value: number) {
    // Establece solo los 4 bits superiores
    this._bibatCtrl = (this._bibatCtrl & 0x0f) | ((value & 0x0f) << 4);
  }

  public get bibatBlock(): number {
    return this._bibatBlock;
  }
  public set bibatBlock(value: number) {
    this._bibatBlock = value & 0xff;
  }

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(4); // 1 (Type) + 1 (Length) + 2 (Data)
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);
    buffer.writeUInt8(this._bibatCtrl, 2);
    buffer.writeUInt8(this._bibatBlock, 3);
    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.5 AddInfoType 08h: RF Multi information
// -------------------------------------------------------------------

/**
 * Implementación de AddInfoType 08h: RF Multi information.
 * Longitud de datos: 4 octetos.
 */
export class RFMultiInformation extends AddInfoBase {
  private _transmissionFrequency: number = 0;
  private _callChannel: number = 0;
  private _physicalAcknowledge: number = 0;
  private _receptionFrequency: number = 0;

  public static readonly TYPE_ID = 0x08;
  public static readonly DATA_LENGTH = 0x04;

  constructor(buffer?: Buffer) {
    super(RFMultiInformation.TYPE_ID, RFMultiInformation.DATA_LENGTH);

    if (buffer) {
      const dataBuffer = AddInfoBase.parseDataBuffer(buffer, this._typeId, this._dataLength);
      this._transmissionFrequency = dataBuffer.readUInt8(0);
      this._callChannel = dataBuffer.readUInt8(1);
      this._physicalAcknowledge = dataBuffer.readUInt8(2);
      this._receptionFrequency = dataBuffer.readUInt8(3);
    }
  }

  // 4.1.4.3.5.2 Transmission Frequency
  public get transmissionFrequency(): number {
    return this._transmissionFrequency;
  }
  public set transmissionFrequency(value: number) {
    this._transmissionFrequency = value & 0xff;
  }

  // 4.1.4.3.5.3 Fast and Slow Call Channel
  public get fastCallChannel(): number {
    return (this._callChannel & 0xf0) >> 4;
  }
  public set fastCallChannel(value: number) {
    this._callChannel = (this._callChannel & 0x0f) | ((value & 0x0f) << 4);
  }

  public get slowCallChannel(): number {
    return this._callChannel & 0x0f;
  }
  public set slowCallChannel(value: number) {
    this._callChannel = (this._callChannel & 0xf0) | (value & 0x0f);
  }

  // 4.1.4.3.5.4 Physical Acknowledge
  public get physicalAcknowledge(): number {
    return this._physicalAcknowledge;
  }
  public set physicalAcknowledge(value: number) {
    this._physicalAcknowledge = value & 0xff;
  }

  // 4.1.4.3.5.5 Reception frequency
  public get receptionFrequency(): number {
    return this._receptionFrequency;
  }
  public set receptionFrequency(value: number) {
    this._receptionFrequency = value & 0xff;
  }

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(6); // 1 (Type) + 1 (Length) + 4 (Data)
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);
    buffer.writeUInt8(this._transmissionFrequency, 2);
    buffer.writeUInt8(this._callChannel, 3);
    buffer.writeUInt8(this._physicalAcknowledge, 4);
    buffer.writeUInt8(this._receptionFrequency, 5);
    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.6 AddInfoType 09h: Preamble and postamble
// -------------------------------------------------------------------

/**
 * Implementación de AddInfoType 09h: Preamble and postamble.
 * Longitud de datos: 3 octetos.
 */
export class PreambleAndPostamble extends AddInfoBase {
  private _preambleLength: number = 0;
  private _postambleLength: number = 0;

  public static readonly TYPE_ID = 0x09;
  public static readonly DATA_LENGTH = 0x03;

  constructor(buffer?: Buffer) {
    super(PreambleAndPostamble.TYPE_ID, PreambleAndPostamble.DATA_LENGTH);

    if (buffer) {
      const dataBuffer = AddInfoBase.parseDataBuffer(buffer, this._typeId, this._dataLength);
      this._preambleLength = dataBuffer.readUInt16BE(0);
      this._postambleLength = dataBuffer.readUInt8(2);
    }
  }

  public get preambleLength(): number {
    return this._preambleLength;
  }
  public set preambleLength(value: number) {
    this._preambleLength = value & 0xffff;
  }

  public get postambleLength(): number {
    return this._postambleLength;
  }
  public set postambleLength(value: number) {
    this._postambleLength = value & 0xff;
  }

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(5); // 1 (Type) + 1 (Length) + 3 (Data)
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);
    buffer.writeUInt16BE(this._preambleLength, 2);
    buffer.writeUInt8(this._postambleLength, 4);
    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.7 AddInfoType 0Ah: RF Fast ack information
// -------------------------------------------------------------------

interface IRfFastAck {
  status: number;
  info: number;
}

/**
 * Implementación de AddInfoType 0Ah: RF Fast ack information.
 * Longitud de datos: Variable (N * 2 octetos).
 */
export class RFFastACKInformation extends AddInfoBase {
  private _fastAcks: IRfFastAck[] = [];

  public static readonly TYPE_ID = 0x0a;

  constructor(buffer?: Buffer) {
    // Longitud de datos inicial es 0, se recalculará
    super(RFFastACKInformation.TYPE_ID, 0);

    if (buffer) {
      // No podemos usar parseDataBuffer directamente por la longitud variable
      if (buffer.length < 2) {
        throw new Error("[AddInfoType0Ah] Buffer demasiado corto.");
      }
      const typeId = buffer.readUInt8(0);
      const length = buffer.readUInt8(1);

      if (typeId !== this._typeId) {
        throw new Error(
          `[AddInfoType0Ah] Type ID incorrecto. Se esperaba 0x${this._typeId.toString(
            16,
          )}, se recibió 0x${typeId.toString(16)}.`,
        );
      }

      const dataBuffer = buffer.subarray(2);

      if (dataBuffer.length !== length) {
        throw new Error(
          `[AddInfoType0Ah] Discrepancia en la longitud del buffer. El header dice ${length}, pero los datos tienen ${dataBuffer.length} octetos.`,
        );
      }

      if (length % 2 !== 0) {
        throw new Error(
          `[AddInfoType0Ah] Longitud de datos inválida. Debe ser un múltiplo de 2, se recibió ${length}.`,
        );
      }

      this._dataLength = length;

      for (let i = 0; i < length; i += 2) {
        this._fastAcks.push({
          status: dataBuffer.readUInt8(i),
          info: dataBuffer.readUInt8(i + 1),
        });
      }
    }
  }

  public getFastAcks(): IRfFastAck[] {
    return [...this._fastAcks];
  }

  public setFastAcks(acks: IRfFastAck[]) {
    this._fastAcks = [...acks];
    this._dataLength = this._fastAcks.length * 2;
  }

  public addFastAck(ack: IRfFastAck) {
    this._fastAcks.push(ack);
    this._dataLength += 2;
  }

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(2 + this._dataLength);
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);

    let offset = 2;
    for (const ack of this._fastAcks) {
      buffer.writeUInt8(ack.status & 0xff, offset);
      buffer.writeUInt8(ack.info & 0xff, offset + 1);
      offset += 2;
    }

    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.8 AddInfoType FEh: Manufacturer specific data
// -------------------------------------------------------------------

/**
 * Implementación de AddInfoType FEh: Manufacturer specific data.
 * Longitud de datos: Variable (N + 3 octetos).
 */
export class ManufacturerSpecificData extends AddInfoBase {
  private _manufacturerId: number = 0;
  private _subfunction: number = 0;
  private _data: Buffer = Buffer.alloc(0);

  public static readonly TYPE_ID = 0xfe;
  public static readonly MIN_DATA_LENGTH = 3;

  constructor(buffer?: Buffer) {
    // Longitud de datos inicial es 3 (mínimo), se recalculará
    super(ManufacturerSpecificData.TYPE_ID, ManufacturerSpecificData.MIN_DATA_LENGTH);

    if (buffer) {
      // No podemos usar parseDataBuffer directamente por la longitud variable
      if (buffer.length < 2) {
        throw new Error("[AddInfoTypeFEh] Buffer demasiado corto.");
      }
      const typeId = buffer.readUInt8(0);
      const length = buffer.readUInt8(1);

      if (typeId !== this._typeId) {
        throw new Error(
          `[AddInfoTypeFEh] Type ID incorrecto. Se esperaba 0x${this._typeId.toString(
            16,
          )}, se recibió 0x${typeId.toString(16)}.`,
        );
      }

      const dataBuffer = buffer.subarray(2);

      if (dataBuffer.length !== length) {
        throw new Error(
          `[AddInfoTypeFEh] Discrepancia en la longitud del buffer. El header dice ${length}, pero los datos tienen ${dataBuffer.length} octetos.`,
        );
      }

      if (length < ManufacturerSpecificData.MIN_DATA_LENGTH) {
        throw new Error(`[AddInfoTypeFEh] Longitud de datos inválida. Debe ser al menos 3, se recibió ${length}.`);
      }

      this._dataLength = length;
      this._manufacturerId = dataBuffer.readUInt16BE(0);
      this._subfunction = dataBuffer.readUInt8(2);
      this._data = Buffer.from(dataBuffer.subarray(3));
    }
  }

  public get manufacturerId(): number {
    return this._manufacturerId;
  }
  public set manufacturerId(value: number) {
    this._manufacturerId = value & 0xffff;
  }

  public get subfunction(): number {
    return this._subfunction;
  }
  public set subfunction(value: number) {
    this._subfunction = value & 0xff;
  }

  public get data(): Buffer {
    return this._data;
  }
  public set data(value: Buffer) {
    this._data = Buffer.from(value);
    this._dataLength = 3 + this._data.length;
  }

  public getBuffer(): Buffer {
    this._dataLength = 3 + this._data.length;
    const buffer = Buffer.alloc(2 + this._dataLength);

    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);

    buffer.writeUInt16BE(this._manufacturerId, 2);
    buffer.writeUInt8(this._subfunction, 4);
    this._data.copy(buffer, 5);

    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.1 AddInfo-Type 03h: Busmonitor Status Info
// -------------------------------------------------------------------

/**
 * 4.1.4.3.1 AddInfo-Type 03h: Busmonitor Status Info
 * Longitud de datos: 1 octeto.
 * Utiliza la clase Status existente para la gestión de bits.
 */
export class BusmonitorStatusInfo extends AddInfoBase {
  public static readonly TYPE_ID = 0x03;
  public static readonly DATA_LENGTH = 0x01;

  private _status: Status;

  constructor(buffer?: Buffer) {
    super(BusmonitorStatusInfo.TYPE_ID, BusmonitorStatusInfo.DATA_LENGTH);

    if (buffer) {
      // Validamos y extraemos la data pura (1 byte)
      const dataBuffer = AddInfoBase.parseDataBuffer(buffer, this._typeId, this._dataLength);
      // Delegamos la creación a tu método estático existente
      this._status = Status.fromByte(dataBuffer.readUInt8(0));
    } else {
      // Constructor por defecto: Estado limpio
      this._status = new Status({
        frameError: false,
        bitError: false,
        parityError: false,
        overflow: false,
        lost: false,
        sequenceNumber: 0,
      });
    }
  }

  /**
   * Devuelve la instancia interna de Status para manipulación directa.
   */
  public get status(): Status {
    return this._status;
  }

  public set status(value: Status) {
    this._status = value;
  }

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(3); // 1 (Type) + 1 (Length) + 1 (Data)
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);
    buffer.writeUInt8(this._status.value, 2);
    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.9 AddInfo-Type 04h: Timestamp Relative
// -------------------------------------------------------------------

/**
 * Implementación de AddInfoType 04h: Timestamp Relative.
 * Longitud de datos: 2 octetos.
 * Representa una marca de tiempo relativa (generalmente en ms o ticks desde el último evento).
 */
export class TimestampRelative extends AddInfoBase {
  private _timestamp: number = 0;

  public static readonly TYPE_ID = 0x04;
  public static readonly DATA_LENGTH = 0x02;

  constructor(buffer?: Buffer) {
    super(TimestampRelative.TYPE_ID, TimestampRelative.DATA_LENGTH);

    if (buffer) {
      const dataBuffer = AddInfoBase.parseDataBuffer(buffer, this._typeId, this._dataLength);
      this._timestamp = dataBuffer.readUInt16BE(0);
    }
  }

  public get timestamp(): number {
    return this._timestamp;
  }

  public set timestamp(value: number) {
    this._timestamp = value & 0xffff;
  }

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(4); // 1 (Type) + 1 (Length) + 2 (Data)
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);
    buffer.writeUInt16BE(this._timestamp, 2);
    return buffer;
  }
}

// -------------------------------------------------------------------
// 4.1.4.3.10 AddInfo-Type 05h: Time Delay Until Sending
// -------------------------------------------------------------------

/**
 * Implementación de AddInfoType 05h: Time Delay Until Sending.
 * Longitud de datos: 2 octetos.
 * Define un retardo antes de enviar la trama al medio.
 */
export class TimeDelayUntilSending extends AddInfoBase {
  private _delay: number = 0;

  public static readonly TYPE_ID = 0x05;
  public static readonly DATA_LENGTH = 0x02;

  constructor(buffer?: Buffer) {
    super(TimeDelayUntilSending.TYPE_ID, TimeDelayUntilSending.DATA_LENGTH);

    if (buffer) {
      const dataBuffer = AddInfoBase.parseDataBuffer(buffer, this._typeId, this._dataLength);
      this._delay = dataBuffer.readUInt16BE(0);
    }
  }

  public get delay(): number {
    return this._delay;
  }

  public set delay(value: number) {
    this._delay = value & 0xffff;
  }

  public getBuffer(): Buffer {
    const buffer = Buffer.alloc(4); // 1 (Type) + 1 (Length) + 2 (Data)
    buffer.writeUInt8(this._typeId, 0);
    buffer.writeUInt8(this._dataLength, 1);
    buffer.writeUInt16BE(this._delay, 2);
    return buffer;
  }
}
