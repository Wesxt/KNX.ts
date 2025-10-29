import { Buffer } from 'buffer';

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
abstract class AddInfoBase implements IAddInfoType {
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
            throw new Error(`[AddInfoBase] Buffer demasiado corto. Se esperaban al menos 2 octetos, se recibieron ${buffer.length}.`);
        }

        const typeId = buffer.readUInt8(0);
        const length = buffer.readUInt8(1);

        if (typeId !== expectedType) {
            throw new Error(`[AddInfoBase] Type ID incorrecto. Se esperaba 0x${expectedType.toString(16)}, se recibió 0x${typeId.toString(16)}.`);
        }

        const dataBuffer = buffer.subarray(2);

        if (dataBuffer.length !== length) {
            throw new Error(`[AddInfoBase] Discrepancia en la longitud del buffer. El header dice ${length}, pero los datos tienen ${dataBuffer.length} octetos.`);
        }

        if (expectedLength !== undefined && length !== expectedLength) {
            throw new Error(`[AddInfoBase] Longitud de datos incorrecta. Se esperaba ${expectedLength}, se recibió ${length}.`);
        }

        return dataBuffer;
    }
}

// -------------------------------------------------------------------
// 4.1.4.3.2 AddInfoType 02h: RF medium information
// -------------------------------------------------------------------

/**
 * Implementación de AddInfoType 02h: RF medium information.
 * Longitud de datos: 8 octetos.
 */
class AddInfoType02h extends AddInfoBase {
    private _rfInfo: number = 0;
    private _serialNumberOrDoA: Buffer = Buffer.alloc(6);
    private _lfn: number = 0;

    public static readonly TYPE_ID = 0x02;
    public static readonly DATA_LENGTH = 0x08;

    constructor(buffer?: Buffer) {
        super(AddInfoType02h.TYPE_ID, AddInfoType02h.DATA_LENGTH);

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
        this._rfInfo = value ? (this._rfInfo | 0b10000000) : (this._rfInfo & ~0b10000000);
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
        this._rfInfo = value ? (this._rfInfo | 0b00000010) : (this._rfInfo & ~0b00000010);
    }

    public get unidirFlag(): boolean {
        return (this._rfInfo & 0b00000001) !== 0;
    }
    public set unidirFlag(value: boolean) {
        this._rfInfo = value ? (this._rfInfo | 0b00000001) : (this._rfInfo & ~0b00000001);
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
        this._lfn = value & 0xFF;
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
class AddInfoType06h extends AddInfoBase {
    private _timestamp: number = 0;

    public static readonly TYPE_ID = 0x06;
    public static readonly DATA_LENGTH = 0x04;

    constructor(buffer?: Buffer) {
        super(AddInfoType06h.TYPE_ID, AddInfoType06h.DATA_LENGTH);

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
class AddInfoType07h extends AddInfoBase {
    private _bibatCtrl: number = 0;
    private _bibatBlock: number = 0;

    public static readonly TYPE_ID = 0x07;
    public static readonly DATA_LENGTH = 0x02;

    constructor(buffer?: Buffer) {
        super(AddInfoType07h.TYPE_ID, AddInfoType07h.DATA_LENGTH);

        if (buffer) {
            const dataBuffer = AddInfoBase.parseDataBuffer(buffer, this._typeId, this._dataLength);
            this._bibatCtrl = dataBuffer.readUInt8(0);
            this._bibatBlock = dataBuffer.readUInt8(1);
        }
    }

    public get bibatCtrl(): number {
        // Devuelve solo los 4 bits superiores
        return (this._bibatCtrl & 0xF0) >> 4;
    }
    public set bibatCtrl(value: number) {
        // Establece solo los 4 bits superiores
        this._bibatCtrl = (this._bibatCtrl & 0x0F) | ((value & 0x0F) << 4);
    }
    
    public get bibatBlock(): number {
        return this._bibatBlock;
    }
    public set bibatBlock(value: number) {
        this._bibatBlock = value & 0xFF;
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
class AddInfoType08h extends AddInfoBase {
    private _transmissionFrequency: number = 0;
    private _callChannel: number = 0;
    private _physicalAcknowledge: number = 0;
    private _receptionFrequency: number = 0;

    public static readonly TYPE_ID = 0x08;
    public static readonly DATA_LENGTH = 0x04;

    constructor(buffer?: Buffer) {
        super(AddInfoType08h.TYPE_ID, AddInfoType08h.DATA_LENGTH);

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
        this._transmissionFrequency = value & 0xFF;
    }

    // 4.1.4.3.5.3 Fast and Slow Call Channel
    public get fastCallChannel(): number {
        return (this._callChannel & 0xF0) >> 4;
    }
    public set fastCallChannel(value: number) {
        this._callChannel = (this._callChannel & 0x0F) | ((value & 0x0F) << 4);
    }
    
    public get slowCallChannel(): number {
        return this._callChannel & 0x0F;
    }
    public set slowCallChannel(value: number) {
        this._callChannel = (this._callChannel & 0xF0) | (value & 0x0F);
    }

    // 4.1.4.3.5.4 Physical Acknowledge
    public get physicalAcknowledge(): number {
        return this._physicalAcknowledge;
    }
    public set physicalAcknowledge(value: number) {
        this._physicalAcknowledge = value & 0xFF;
    }

    // 4.1.4.3.5.5 Reception frequency
    public get receptionFrequency(): number {
        return this._receptionFrequency;
    }
    public set receptionFrequency(value: number) {
        this._receptionFrequency = value & 0xFF;
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
class AddInfoType09h extends AddInfoBase {
    private _preambleLength: number = 0;
    private _postambleLength: number = 0;

    public static readonly TYPE_ID = 0x09;
    public static readonly DATA_LENGTH = 0x03;

    constructor(buffer?: Buffer) {
        super(AddInfoType09h.TYPE_ID, AddInfoType09h.DATA_LENGTH);

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
        this._preambleLength = value & 0xFFFF;
    }
    
    public get postambleLength(): number {
        return this._postambleLength;
    }
    public set postambleLength(value: number) {
        this._postambleLength = value & 0xFF;
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
class AddInfoType0Ah extends AddInfoBase {
    private _fastAcks: IRfFastAck[] = [];

    public static readonly TYPE_ID = 0x0A;

    constructor(buffer?: Buffer) {
        // Longitud de datos inicial es 0, se recalculará
        super(AddInfoType0Ah.TYPE_ID, 0);

        if (buffer) {
            // No podemos usar parseDataBuffer directamente por la longitud variable
            if (buffer.length < 2) {
                throw new Error("[AddInfoType0Ah] Buffer demasiado corto.");
            }
            const typeId = buffer.readUInt8(0);
            const length = buffer.readUInt8(1);

            if (typeId !== this._typeId) {
                throw new Error(`[AddInfoType0Ah] Type ID incorrecto. Se esperaba 0x${this._typeId.toString(16)}, se recibió 0x${typeId.toString(16)}.`);
            }
            
            const dataBuffer = buffer.subarray(2);

            if (dataBuffer.length !== length) {
                throw new Error(`[AddInfoType0Ah] Discrepancia en la longitud del buffer. El header dice ${length}, pero los datos tienen ${dataBuffer.length} octetos.`);
            }

            if (length % 2 !== 0) {
                throw new Error(`[AddInfoType0Ah] Longitud de datos inválida. Debe ser un múltiplo de 2, se recibió ${length}.`);
            }
            
            this._dataLength = length;

            for (let i = 0; i < length; i += 2) {
                this._fastAcks.push({
                    status: dataBuffer.readUInt8(i),
                    info: dataBuffer.readUInt8(i + 1)
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
            buffer.writeUInt8(ack.status & 0xFF, offset);
            buffer.writeUInt8(ack.info & 0xFF, offset + 1);
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
class AddInfoTypeFEh extends AddInfoBase {
    private _manufacturerId: number = 0;
    private _subfunction: number = 0;
    private _data: Buffer = Buffer.alloc(0);

    public static readonly TYPE_ID = 0xFE;
    public static readonly MIN_DATA_LENGTH = 3;

    constructor(buffer?: Buffer) {
        // Longitud de datos inicial es 3 (mínimo), se recalculará
        super(AddInfoTypeFEh.TYPE_ID, AddInfoTypeFEh.MIN_DATA_LENGTH);

        if (buffer) {
            // No podemos usar parseDataBuffer directamente por la longitud variable
            if (buffer.length < 2) {
                throw new Error("[AddInfoTypeFEh] Buffer demasiado corto.");
            }
            const typeId = buffer.readUInt8(0);
            const length = buffer.readUInt8(1);

            if (typeId !== this._typeId) {
                throw new Error(`[AddInfoTypeFEh] Type ID incorrecto. Se esperaba 0x${this._typeId.toString(16)}, se recibió 0x${typeId.toString(16)}.`);
            }

            const dataBuffer = buffer.subarray(2);

            if (dataBuffer.length !== length) {
                throw new Error(`[AddInfoTypeFEh] Discrepancia en la longitud del buffer. El header dice ${length}, pero los datos tienen ${dataBuffer.length} octetos.`);
            }

            if (length < AddInfoTypeFEh.MIN_DATA_LENGTH) {
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
        this._manufacturerId = value & 0xFFFF;
    }
    
    public get subfunction(): number {
        return this._subfunction;
    }
    public set subfunction(value: number) {
        this._subfunction = value & 0xFF;
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

// --- Ejemplo de uso (opcional, para demostración) ---
// try {
//     console.log("--- Creando AddInfoType02h (RF Info) por defecto ---");
//     const rfInfo = new AddInfoType02h();
//     rfInfo.serialNumberOrDoA = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
//     rfInfo.lfn = 0xAB;
//     rfInfo.routeLastFlag = true;
//     rfInfo.rssi = 0b10; // medium
//     console.log(rfInfo.getBuffer().toString('hex')); // Debería ser: 02088a010203040506ab

//     console.log("\n--- Parseando AddInfoType06h (Timestamp) ---");
//     const tsBuffer = Buffer.from([0x06, 0x04, 0x00, 0x1A, 0xBC, 0xDE]);
//     const timestamp = new AddInfoType06h(tsBuffer);
//     console.log(`Timestamp: ${timestamp.timestamp} (0x${timestamp.timestamp.toString(16)})`); // 1752286

//     console.log("\n--- Creando AddInfoType08h (RF Multi) ---");
//     const rfMulti = new AddInfoType08h();
//     rfMulti.transmissionFrequency = 0x02; // F1 (RF1.M)
//     rfMulti.fastCallChannel = 0x01; // F2
//     rfMulti.slowCallChannel = 0x0F; // use current
//     rfMulti.physicalAcknowledge = 3; // 3 acks
//     rfMulti.receptionFrequency = 0x07; // Fx (RF1.M)
//     console.log(rfMulti.getBuffer().toString('hex')); // Debería ser: 0804021f0307

//     console.log("\n--- Creando AddInfoTypeFEh (Manuf. Specific) ---");
//     const manuf = new AddInfoTypeFEh();
//     manuf.manufacturerId = 0x00CD; // KNX Association
//     manuf.subfunction = 0x01;
//     manuf.data = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
//     console.log(manuf.getBuffer().toString('hex')); // Debería ser: fe0700cd01deadbeef
    
//     console.log("\n--- Parseando AddInfoTypeFEh (Manuf. Specific) ---");
//     const manufBuffer = Buffer.from([0xFE, 0x05, 0x12, 0x34, 0xFF, 0xAA, 0xBB]);
//     const parsedManuf = new AddInfoTypeFEh(manufBuffer);
//     console.log(`Manuf ID: 0x${parsedManuf.manufacturerId.toString(16)}`); // 1234
//     console.log(`Subfunction: 0x${parsedManuf.subfunction.toString(16)}`); // ff
//     console.log(`Data: ${parsedManuf.data.toString('hex')}`); // aabb

// } catch (e) {
//     console.error("Error en el ejemplo de uso:", e);
// }
