import { SerialPort } from 'serialport';
import EventEmitter from 'events';
import { KNXHelper } from '../utils/class/KNXHelper';
import { KNXTPCIHandler, TPCIType } from '../data/KNXTPCI';
import { FrameType, Priority, TelegramType } from '../data/enum/KNXEnumControlField';
import { KNXControlField } from '../data/KNXControlField';
import { KNXExtendedControlFieldHandler } from '../data/KNXControlFieldExtended';

// Constantes del protocolo UART
const UART_SERVICES = {
    RESET_REQ: 0x01,
    RESET_IND: 0x03,
    STATE_REQ: 0x02,
    STATE_IND: 0x07,
    ACTIVATE_BUSMON: 0x05,
    LDATA_CON: 0x0b,
    ACK_INFO: 0x10,
    LDATA_START: 0x80,
    LDATA_END: 0x40
} as const;

// Constantes de frame TP1
const TP1_FRAME = {
    ALWAYS_SET: 0x10,
    STD_FRAME_FORMAT: 0x80 | 0x10,
    EXT_FRAME_FORMAT: 0x10,
    REPEAT_FLAG: 0x20,
    ACK: 0xcc,
    NAK: 0x0c,
    BUSY: 0xc0
} as const;

// Configuración de tiempos
const TIMING = {
    UART_BAUD_RATE: 19200,
    TP1_BAUD_RATE: 9600,
    UART_STATE_READ_INTERVAL: 5_000_000, // microsegundos
    ONE_BIT_TIME: Math.ceil(1 / 9600 * 1_000_000), // microsegundos
    MAX_SEND_ATTEMPTS: 4
} as const;

export class TPUARTConnection extends EventEmitter {
    private port: SerialPort;
    private addresses: Set<string> = new Set();
    private sending: Map<string, number> = new Map();
    private receiver: Receiver;
    private idle: boolean = true;
    private busmon: boolean = false;
    private lastUartState: number = 0;

    constructor(portPath: string, acknowledge: string[] = []) {
        super();
        this.port = new SerialPort({
            path: portPath,
            baudRate: TIMING.UART_BAUD_RATE,
            dataBits: 8,
            parity: 'even',
            stopBits: 1,
            autoOpen: false
        });

        this.addresses = new Set(acknowledge);
        this.receiver = new Receiver(this);

        this.port.on('open', () => this.emit('open'));
        this.port.on('error', (err) => this.emit('error', err));
        this.port.on('data', (data) => this.receiver.handleData(data));
    }

    async open(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.port.open((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.reset()
                    .then(() => this.waitForInitialUartState())
                    .then((data) => resolve())
                    .catch(reject);
            });
        });
    }

    private async reset(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.busmon = false;
            this.port.write([UART_SERVICES.RESET_REQ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async sendGroupValue(groupAddress: number[], data: Buffer, priority: Priority = Priority.NORMAL, sourceAddr = [0x11, 0x01]): Promise<void> {
        const telegram = this.createGroupValueTelegram(groupAddress, data, priority, sourceAddr);
        console.log("telegram: ", telegram)
        await this.sendTelegram(telegram);
    }

    private createGroupValueTelegram(
        groupAddress: number[],
        data: Buffer,
        priority: Priority,
        sourceAddr: number[]
    ): Buffer {
        if (groupAddress.length !== 2) {
            throw new Error("groupAddress debe tener exactamente 2 elementos");
        }
        if (sourceAddr.length !== 2) {
            throw new Error("sourceAddr debe tener exactamente 2 elementos");
        }

        // Para el GroupValue, se asume que la dirección destino es de grupo (AT = 1)
        const destAddressType = 1; // 1 = Group Address

        // Si la TPDU (datos) es de hasta 15 octetos, usamos el formato estándar
        if (data.length <= 15) {
            // Formato L_Data_Standard:
            // Estructura:
            // [0] CTRL (Control Field, con FT = 1)
            // [1] Source Address (alta)
            // [2] Source Address (baja)
            // [3] Destination Address (alta)
            // [4] Destination Address (baja)
            // [5] Longitud: 4 bits de data.length + 0xE0 en los 4 bits altos
            // [6] Valor fijo (0x00, reservado para APCI en esta posición)
            // [7] TPCI
            // [8..8+data.length-1] NPDU (APCI y datos, escritos con KNXHelper.WriteData)
            // [final] Check Octet (NOT XOR de todos los octetos anteriores)
            const headerLength = 7;
            const totalLength = headerLength + KNXHelper.GetDataLength(data) +1; // +1 para el Check Octet
            const telegram = Buffer.alloc(totalLength);
            let offset = 0;

            // Construir Control Field para formato estándar (FT flag = 1)
            const controlField = new KNXControlField();
            // Aseguramos que el bit 7 (FT) esté establecido para L_Data_Standard:
            controlField.priority = priority;
            controlField.repeat = false;
            controlField.telegramType = TelegramType.L_Data_Frame;
            controlField.frameType = FrameType.STANDARD;
            console.log(controlField.describe())

            telegram[offset++] = controlField.rawValue;

            // Source Address (2 octetos)
            telegram[offset++] = sourceAddr[0];
            telegram[offset++] = sourceAddr[1];

            // Destination Address (2 octetos)
            telegram[offset++] = groupAddress[0];
            telegram[offset++] = groupAddress[1];

            // Campo de longitud: 4 bits de data.length y 0xE0 en los 4 bits altos
            const lengthField = (data.length & 0x0F) | 0xE0;
            telegram[offset++] = lengthField;

            // Octeto fijo (0x00), reservado en este formato
            telegram[offset++] = 0x00;

            // TPCI: se crea una instancia del handler con un tipo de control (por ejemplo, CONTROL_REQUEST)
            const tpciHandler = new KNXTPCIHandler(TPCIType.CONTROL_REQUEST);
            telegram[offset] = tpciHandler.getValue();

            // Escribir NPDU (APCI + datos) a partir del offset actual
            KNXHelper.WriteData(telegram, data, offset);
            // offset += data.length;

            // Calcular y agregar el Check Octet (NOT XOR de todos los octetos previos)
            const checksum = this.calculateChecksum(telegram.subarray(0, offset + data.length));
            telegram[offset + data.length] = checksum;

            return telegram;
        } else {
            // Si la TPDU es extendida (más de 15 octetos)
            // Usamos el formato L_Data_Extended:
            // Estructura:
            // [0] CTRL (Control Field, con FT = 0 para frame extendido)
            // [1] CTRLE (Extended Control Field; aquí se fija el bit AT según destAddressType)
            // [2] Source Address (alta)
            // [3] Source Address (baja)
            // [4] Destination Address (alta)
            // [5] Destination Address (baja)
            // [6] Longitud extendida: 8 bits completos (data.length, debe ser ≤ 254)
            // [7] TPCI
            // [8] APCI (por ejemplo, 0x80 para GroupValueWrite)
            // [9..9+data.length-1] NPDU (datos, escritos con KNXHelper.WriteData)
            // [final] Check Octet
            if (data.length > 254) {
                throw new Error("El TPDU extendido admite máximo 254 octetos");
            }
            const headerLength = 9;
            const totalLength = headerLength + KNXHelper.GetDataLength(data) + 1;
            const telegram = Buffer.alloc(totalLength);
            let offset = 0;

            // Construir Control Field para formato extendido (FT flag = 0)
            const controlField = new KNXControlField();
            // Limpiar el bit 7 para indicar L_Data_Extended (FT = 0)
            controlField.priority = priority;
            controlField.repeat = true;
            controlField.telegramType = TelegramType.L_Data_Frame;
            controlField.frameType = FrameType.EXTENDED;
            telegram[offset++] = controlField.rawValue;

            // Extended Control Field (CTRLE):
            // Para simplificar, fijamos el bit AT según destAddressType; sin hop count y con EFF = 0.
            const ctrle = new KNXExtendedControlFieldHandler();
            ctrle.setAddressType(true)
            ctrle.setExtendedFrameFormat(true)
            ctrle.setHopCount(0)
            telegram[offset++] = ctrle.toNumber();

            // Source Address (2 octetos)
            telegram[offset++] = sourceAddr[0];
            telegram[offset++] = sourceAddr[1];

            // Destination Address (2 octetos)
            telegram[offset++] = groupAddress[0];
            telegram[offset++] = groupAddress[1];

            // Campo de longitud extendida: se usa un octeto completo con data.length
            telegram[offset++] = KNXHelper.GetDataLength(data);

            // TPCI: mismo procedimiento que antes
            const tpciHandler = new KNXTPCIHandler(TPCIType.CONTROL_REQUEST);
            telegram[offset++] = tpciHandler.getValue();

            // APCI: para GroupValueWrite, se suele usar 0x80
            telegram[offset] = 0x80;

            // Escribir NPDU (datos) a partir del offset actual
            KNXHelper.WriteData(telegram, data, offset);
            // offset += KNXHelper.GetDataLength(data);

            // Calcular y agregar el Check Octet
            const checksum = this.calculateChecksum(telegram.subarray(0, offset + data.length));
            
            telegram[offset + data.length] = checksum;

            return telegram;
        }
    }

    private calculateChecksum(data: Buffer): number {
        return data.reduce((acc, byte) => acc ^ byte, 0) ^ 0xFF;
    }

    private async sendTelegram(telegram: Buffer): Promise<void> {
        // Convertir a formato UART
        const uartServices = this.toUartServices(telegram);

        return new Promise((resolve, reject) => {
            this.port.write(uartServices, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    private toUartServices(telegram: Buffer): Buffer {
        const result = Buffer.alloc(telegram.length * 2);
        let offset = 0;

        // Convertir cada byte del telegrama en servicios UART
        for (let i = 0; i < telegram.length - 1; i++) {
            result[offset++] = UART_SERVICES.LDATA_START | i;
            result[offset++] = telegram[i];
        }

        // Añadir byte final con checksum
        result[offset++] = UART_SERVICES.LDATA_END | (telegram.length - 1);
        result[offset] = telegram[telegram.length - 1];

        return result.subarray(0, offset + 1);
    }

    close(): void {
        this.port.close();
    }

    private async waitForInitialUartState(): Promise<boolean> {
        const timeout = 1000; // 1 segundo
        const interval = 10; // 10ms entre checks
        const maxAttempts = timeout / interval;

        for (let i = 0; i < maxAttempts; i++) {
            if (this.lastUartState !== 0) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        return false;
    }
}

class Receiver {
    private connection: TPUARTConnection;
    private buffer: Buffer = Buffer.alloc(0);
    private lastRead: number = 0;
    private extFrame: boolean = false;

    constructor(connection: TPUARTConnection) {
        this.connection = connection;
    }

    handleData(data: Buffer): void {
        // Procesar cada byte recibido
        for (const byte of data) {
            this.processByte(byte);
        }
    }

    private processByte(byte: number): void {
        const now = Date.now();

        // Resetear buffer si ha pasado mucho tiempo
        if (this.buffer.length > 0 && (now - this.lastRead) > 50) {
            this.buffer = Buffer.alloc(0);
        }

        // Procesar según el tipo de byte
        if (this.isFrameStart(byte)) {
            this.buffer = Buffer.from([byte]);
            this.lastRead = now;
        } else if (this.buffer.length > 0) {
            this.buffer = Buffer.concat([this.buffer, Buffer.from([byte])]);
            this.lastRead = now;

            // Verificar si tenemos un frame completo
            this.checkCompleteFrame();
        }
    }

    private isFrameStart(byte: number): boolean {
        this.extFrame = (byte & TP1_FRAME.STD_FRAME_FORMAT) !== TP1_FRAME.STD_FRAME_FORMAT;
        return (byte & 0x03) === 0 &&
            ((byte & 0xD0) === TP1_FRAME.STD_FRAME_FORMAT ||
                (byte & 0xD0) === TP1_FRAME.EXT_FRAME_FORMAT);
    }

    private checkCompleteFrame(): void {
        const minLength = this.extFrame ? 7 : 6;

        if (this.buffer.length >= minLength) {
            const length = this.extFrame ?
                8 + (this.buffer[6] & 0x3F) + 1 :
                7 + (this.buffer[5] & 0x0F) + 1;

            if (this.buffer.length >= length) {
                this.connection.emit('frame', this.buffer.subarray(0, length));
                this.buffer = Buffer.alloc(0);
            }
        }
    }
}