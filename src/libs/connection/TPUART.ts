import { SerialPort } from 'serialport';
import EventEmitter from 'events';
import { KNXTP1 } from '../data/KNXTP1';
import { L_Data_Extended, L_Data_Standard } from '../@types/interfaces/KNXTP1';

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

// TP1 frame constant
const TP1_FRAME = {
    ALWAYS_SET: 0x10,
    STD_FRAME_FORMAT: 0x80 | 0x10,
    EXT_FRAME_FORMAT: 0x10,
    REPEAT_FLAG: 0x20,
    ACK: 0xcc,
    NAK: 0x0c,
    BUSY: 0xc0
} as const;

// Setting times
const TIMING = {
    UART_BAUD_RATE: 19200,
    TP1_BAUD_RATE: 9600,
    UART_STATE_READ_INTERVAL: 5_000_000, // microseconds
    ONE_BIT_TIME: Math.ceil(1 / 9600 * 1_000_000), // microseconds
    MAX_SEND_ATTEMPTS: 4
} as const;

export class TPUARTConnection extends EventEmitter {
    private port: SerialPort;
    private receiver: Receiver;
    private lastUartState: number = 0;
    private KNXTP = new KNXTP1()

    constructor(portPath: string) {
        super();
        this.port = new SerialPort({
            path: portPath,
            baudRate: TIMING.UART_BAUD_RATE,
            dataBits: 8,
            parity: 'even',
            stopBits: 1,
            autoOpen: false
        });

        this.receiver = new Receiver(this);

        this.port.on('open', () => this.emit('open'));
        this.port.on('error', (err) => this.emit('error', err));
        this.port.on('data', (data) => {
            this.receiver.handleData(data)
        });
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
                    .then(() => resolve())
                    .catch((error) => this.emit("error", error));
            });
        });
    }

    private async reset(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.port.write([UART_SERVICES.RESET_REQ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async sendGroupValueWriteInLDataStandard(LDataStandard: L_Data_Standard): Promise<void> {
        const telegram = this.KNXTP.createLDataStandardFrame(LDataStandard)
        await this.sendTelegram(telegram);
    }

    async sendGroupValueWriteInLDataExtended(LDataExtended: L_Data_Extended): Promise<void> {
        const telegram = this.KNXTP.createLDataExtendedFrame(LDataExtended)
        await this.sendTelegram(telegram);
    }

    // private calculateChecksum(data: Buffer): number {
    //     return data.reduce((acc, byte) => acc ^ byte, 0) ^ 0xFF;
    // }

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
        console.log("Esperando el estado inicial del TPUART")
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
    
        // Si ha pasado mucho tiempo desde el último byte, reiniciamos el buffer.
        if (this.buffer.length > 0 && (now - this.lastRead) > 50) {
            this.buffer = Buffer.alloc(0);
        }
    
        // Solo iniciar un nuevo buffer si aún no estamos procesando un frame.
        if (this.buffer.length === 0) {
            if (this.isFrameStart(byte)) {
                this.buffer = Buffer.from([byte]);
                this.lastRead = now;
            }
        } else {
            // Si ya tenemos un frame en proceso, simplemente concatenamos.
            this.buffer = Buffer.concat([this.buffer, Buffer.from([byte])]);
            this.lastRead = now;
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