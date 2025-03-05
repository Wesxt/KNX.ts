/**
 * Proporciona una conexión con un controlador TP-UART-IC para la comunicación transparente con
 * una red KNX TP1. La conexión soporta la comunicación cEMI L-Data y el modo busmonitor.
 *
 * Política de interrupción: se cancelan todos los envíos bloqueantes.
 */

import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';
import { KnxConnectionTunneling } from './KNXConnectionTunneling';

/* ===== Interfaces y Clases de Soporte ===== */

// Modo de envío
export enum BlockingMode {
  Blocking,
  NonBlocking
}

// Interfaz de conexión
export interface Connection<T> {
  addConnectionListener(listener: KNXListener): void;
  removeConnectionListener(listener: KNXListener): void;
  name(): string;
  send(frame: Uint8Array, blockingMode: BlockingMode): Promise<void>;
  close(): void;
}

// Interfaz para recibir eventos
export interface KNXListener {
  connectionClosed(event: CloseEvent): void;
  frameReceived(event: FrameEvent): void;
}

// Eventos de cierre
export class CloseEvent {
  constructor(public connection: TpuartConnection, public origin: number, public reason: string) {}
}

// Evento de frame recibido
export class FrameEvent {
  constructor(public source: any, public frame: Uint8Array) {}
}

// Excepciones personalizadas
export class KNXException extends Error {}
export class KNXPortClosedException extends KNXException {
  constructor(message: string, public portId: string) {
    super(message);
  }
}
export class KNXAckTimeoutException extends KNXException {}
export class KNXIllegalArgumentException extends KNXException {}
export class KNXFormatException extends KNXException {}

// Stub de LogService y Logger (ajusta según tu sistema de logging)
class LogService {
  static getAsyncLogger(name: string): Logger {
    return new Logger(name);
  }
  static getLogger(name: string): Logger {
    return new Logger(name);
  }
}
class Logger {
  constructor(private name: string) {}
  log(level: string, ...args: any[]): void {
    console.log(`[${this.name}] ${level}:`, ...args);
  }
}

// Stub para formatear en hexadecimal
class HexFormat {
  static ofDelimiter(delimiter: string) {
    return {
      formatHex: (data: Uint8Array) => Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(delimiter)
    };
  }
}

// Stub para la factoría de conexiones seriales
class SerialConnectionFactory {
  static open(portId: string, baudRate: number, timeout?: number, writeTimeout?: number): SerialCom {
    // Aquí utilizarías la librería 'serialport' u otra similar
    return new SerialCom(portId, baudRate);
  }
}

// Clase que simula la conexión serial (usa serialport o similar)
class SerialCom {
  private port: SerialPort;
  constructor(public portId: string, public baudRate: number) {
    this.port = new SerialPort({ path: portId, baudRate: baudRate, autoOpen: true });
  }
  outputStream(): SerialPort {
    return this.port; // Se usa para escribir: port.write(...)
  }
  inputStream(): SerialPort {
    return this.port; // Se usa para leer: port.on('data', ...)
  }
  close(): void {
    this.port.close();
  }
}

// Stub para direcciones KNX
export class KNXAddress {
  constructor(public address: string) {}
}
export class GroupAddress extends KNXAddress {}
export class IndividualAddress extends KNXAddress {}

// Stub para cEMI
class CEMILData {
  static MC_LDATA_CON = 0x11; // Valor de ejemplo
  static MC_LDATA_IND = 0x29; // Valor de ejemplo
}
class CEMIFactory {
  static create(frame: Uint8Array, offset: number, length: number): any {
    // Implementación dummy; reemplaza según tu lógica
    return { frame, offset, length };
  }
}
class CEMIBusMon {
  static newWithSequenceNumber(seq: number, timestamp: number, flag: boolean, data: Uint8Array) {
    return { toByteArray: () => data };
  }
}

enum Priority {
  SYSTEM = 0,
  URGENT = 1,
  NORMAL = 2,
  LOW = 3
}

enum TelegramType {
  DATA_PACKET = 0,
  POLL_DATA = 1,
  ACKNOWLEDGE = 2,
  RESERVED = 3
}

class ControlField {
  private value: number;

  constructor(value: number = 0) {
      this.value = value & 0xFF; // Asegurar que solo tenga 8 bits
  }

  /** Getters y Setters para cada campo del Control Field **/
  
  get priority(): Priority {
      return (this.value >> 6) & 0b11;
  }
  
  set priority(priority: Priority) {
      this.value = (this.value & 0b00111111) | ((priority & 0b11) << 6);
  }

  get repeat(): boolean {
      return ((this.value >> 5) & 0b1) === 0;
  }
  
  set repeat(enabled: boolean) {
      this.value = enabled ? (this.value & 0b11011111) : (this.value | 0b00100000);
  }

  get broadcast(): boolean {
      return ((this.value >> 4) & 0b1) === 1;
  }
  
  set broadcast(enabled: boolean) {
      this.value = enabled ? (this.value | 0b00010000) : (this.value & 0b11101111);
  }

  get telegramType(): TelegramType {
      return (this.value >> 2) & 0b11;
  }
  
  set telegramType(type: TelegramType) {
      this.value = (this.value & 0b11110011) | ((type & 0b11) << 2);
  }

  get rawValue(): number {
      return this.value;
  }
  
  set rawValue(value: number) {
      this.value = value & 0xFF;
  }

  /** Método para obtener el valor en binario */
  toBinary(): string {
      return this.value.toString(2).padStart(8, '0');
  }
}

/* ===== Clase Principal: TpuartConnection ===== */

export class TpuartConnection implements Connection<Uint8Array> {
  // Constantes de servicios UART
  private static readonly Reset_req = 0x01;
  private static readonly Reset_ind = 0x03;
  // private static readonly ProductId_req = 0x20; // No se utiliza
  // private static readonly V2ReleaseA = 0b01000001; // No se utiliza
  private static readonly State_req = 0x02;
  private static readonly State_ind = 0x07;
  private static readonly ActivateBusmon = 0x05;
  private static readonly LData_con = 0x0b; // MSB es confirmación pos/negativa
  private static readonly AckInfo = 0x10;
  private static readonly LDataStart = 0x80; // índice de byte L_Data
  private static readonly LDataEnd = 0x40;   // final de L_Data

  // Constantes de TP1 frame
  private static readonly AlwaysSet = 0x10;
  private static readonly StdFrameFormat = 0x80 | TpuartConnection.AlwaysSet;
  private static readonly ExtFrameFormat = TpuartConnection.AlwaysSet;
  private static readonly RepeatFlag = 0x20;

  // ACK cortos en modo busmonitor
  private static readonly Ack = 0xcc;
  private static readonly Nak = 0x0c;
  private static readonly Busy = 0xc0;

  // Parámetros de envío TP-UART
  private static readonly UartStateReadInterval = 5_000_000; // en microsegundos
  private static readonly UartBaudRate = 19200;
  private static readonly Tp1BaudRate = 9600;
  private static readonly OneBitTime = Math.ceil(1 / TpuartConnection.Tp1BaudRate * 1_000_000);
  static readonly BitTimes_50 = 50 * TpuartConnection.OneBitTime; // en microsegundos
  private static readonly MaxSendAttempts = 4;

  // Campos internos
  private portId: string;
  private com: SerialCom;
  private os: SerialPort;
  is: SerialPort;
  private receiver: Receiver;
  private idle: boolean = false;
  private req: Uint8Array | null = null;
  private busmon: boolean = false;
  private busmonSequence: number = 0;
  private listeners: KNXListener[] = [];
  private addresses: Set<string> = new Set(); // Usamos string para representar la dirección
  private sending: Map<string, number> = new Map();
  logger: Logger;

  // Para simular la espera en condiciones (idle)
  private idlePromiseResolve: (() => void) | null = null;

  constructor(portId: string, acknowledge: KNXAddress[]) {
    this.portId = portId;
    this.logger = LogService.getAsyncLogger("io.calimero.serial.tpuart:" + portId);
    this.com = SerialConnectionFactory.open(portId, TpuartConnection.UartBaudRate);
    this.os = this.com.outputStream();
    this.is = this.com.inputStream();

    // Se agregan direcciones de difusión y las direcciones para reconocimiento
    this.addresses.add("GroupAddress.Broadcast");
    for (const addr of acknowledge) {
      this.addresses.add(addr.address);
    }

    // Iniciar el receptor (simulación de hilo)
    this.receiver = new Receiver(this);
    this.receiver.start();

    // Se realiza el reset inicial
    this.reset().catch((e) => {
      this.closeResources();
      throw new KNXPortClosedException("Error al resetear el controlador TP-UART: " + e, portId);
    });

    // Se espera (de forma asíncrona) el estado inicial del UART
    this.waitForInitialUartState().then((ok) => {
      if (!ok) {
        this.closeResources();
        throw new KNXPortClosedException("Tiempo de espera agotado para el estado inicial del TP-UART", portId);
      }
    });
  }

  private async waitForInitialUartState(): Promise<boolean> {
    this.logger.log("TRACE", "Esperando el estado inicial del TP-UART");
    const end = Date.now() + 1000; // 1 segundo
    while (Date.now() < end) {
      if (this.receiver.lastUartState !== 0) return true;
      await this.sleep(10);
    }
    return false;
  }

  addConnectionListener(l: KNXListener): void {
    this.listeners.push(l);
  }

  removeConnectionListener(l: KNXListener): void {
    this.listeners = this.listeners.filter(listener => listener !== l);
  }

  name(): string {
    return this.portId;
  }

  async activateBusmonitor(): Promise<void> {
    this.logger.log("DEBUG", "Activando busmonitor TP-UART");
    this.os.write(Buffer.from([TpuartConnection.ActivateBusmon]));
    this.busmonSequence = 0;
    this.busmon = true;
  }

  addAddress(ack: KNXAddress): void {
    this.addresses.add(ack.address);
  }

  removeAddress(ack: KNXAddress): void {
    this.addresses.delete(ack.address);
  }

  async send(frame: Uint8Array, blockingMode: BlockingMode): Promise<void> {
    await this.sendInternal(frame, blockingMode === BlockingMode.Blocking);
  }

  private async sendInternal(frame: Uint8Array, waitForCon: boolean): Promise<void> {
    try {
      const tp1Frame = TpuartConnection.cEmiToTP1(frame);
      const data = TpuartConnection.toUartServices(tp1Frame);
      this.logger.log("TRACE", "Creando servicios UART: " + HexFormat.ofDelimiter(" ").formatHex(new Uint8Array(data)));
      this.req = frame.slice();

      // Simula un periodo de enfriamiento si fuera necesario
      // (Se utiliza process.hrtime.bigint() para tiempos en nanosegundos)
      const now = process.hrtime.bigint();
      const coolDownMillis = Number(this.receiver.coolDownUntil - now) / 1_000_000;
      if (coolDownMillis > 0) await this.sleep(coolDownMillis);

      const start = process.hrtime.bigint();
      const group = (frame[3] & 0x80) === 0x80;
      if (group) {
        const key = `${frame[6]}-${frame[7]}`;
        this.sending.set(key, Number(start));
      }

      // Espera hasta que la conexión esté "idle"
      if (!this.idle) {
        await this.waitForIdle();
      }
      this.logger.log("DEBUG", "Enviando servicios UART, " + (waitForCon ? "esperando confirmación" : "sin bloqueo"));

      // Se escribe el dato en el stream de salida
      this.os.write(Buffer.from(data));
      if (!waitForCon) return;
      const rcvdCon = await this.waitForCon(tp1Frame.length);
      if (rcvdCon) return;
      throw new KNXAckTimeoutException("No se recibió ACK para L-Data.con");
    } catch (e: any) {
      if (e instanceof Error && e.name === "InterruptedIOException") {
        throw new Error(e.message);
      } else if (e instanceof Error) {
        this.close();
        throw new KNXPortClosedException("Error I/O: " + e.message, this.portId);
      }
      throw e;
    } finally {
      this.req = null;
    }
  }

  close(): void {
    this.closeInternal(1, "petición del usuario");
  }

  closeInternal(origin: number, reason: string): void {
    this.reset().catch(() => {});
    this.closeResources();
    this.fireConnectionClosed(origin, reason);
  }

  private closeResources(): void {
    this.receiver.quit();
    this.com.close();
  }

  private fireConnectionClosed(origin: number, reason: string): void {
    const ce = new CloseEvent(this, origin, reason);
    for (const l of this.listeners) {
      l.connectionClosed(ce);
    }
  }

  private async reset(): Promise<void> {
    this.logger.log("DEBUG", "Reseteando el controlador TP-UART");
    this.busmon = false;
    this.busmonSequence = 0;
    this.os.write(Buffer.from([TpuartConnection.Reset_req]));
  }

  // Conversión de cEMI a TP1
  private static cEmiToTP1(frame: Uint8Array): Uint8Array {
    const stdMaxApdu = 15;
    const skipToCtrl1 = 2 + (frame[1] & 0xff);
    console.log("skipToCtrl1: ", skipToCtrl1)
    const cemiPrefix = skipToCtrl1 + 8;
    const extended = (frame[skipToCtrl1] & 0x80) === 0;
    const std = !extended && frame.length <= cemiPrefix + stdMaxApdu;
    let tp1: Uint8Array;
    if (std) {
      tp1 = new Uint8Array(frame.length - skipToCtrl1);
      let i = 0;
      tp1[i++] = (frame[skipToCtrl1] & 0xfc) | TpuartConnection.StdFrameFormat | TpuartConnection.RepeatFlag;
      tp1[i++] = frame[skipToCtrl1 + 2];
      tp1[i++] = frame[skipToCtrl1 + 3];
      tp1[i++] = frame[skipToCtrl1 + 4];
      tp1[i++] = frame[skipToCtrl1 + 5];
      const len = frame[skipToCtrl1 + 6];
      tp1[i++] = ((frame[skipToCtrl1 + 1] & 0xf0) | len) & 0xff;
      tp1[i++] = frame[skipToCtrl1 + 7];
      for (let k = 0; k < len; k++) {
        tp1[i++] = frame[cemiPrefix + k];
      }
    } else {
      const length = frame.length - skipToCtrl1 + 1;
      if (length > 64)
        throw new KNXIllegalArgumentException("L-Data frame length " + length + " > max. 64 bytes for TP-UART");
      tp1 = frame.slice(skipToCtrl1, frame.length);
      // Asegura que no sea un frame ext repetido
      tp1[0] = (tp1[0] & ~TpuartConnection.StdFrameFormat) | TpuartConnection.ExtFrameFormat | TpuartConnection.RepeatFlag;
    }
    tp1[tp1.length - 1] = TpuartConnection.checksum(tp1);
    console.log("tp1: " ,new DataView(tp1.buffer))
    return tp1;
  }

  // Envuelve el TP1 frame en servicios UART
  private static toUartServices(tp1: Uint8Array): number[] {
    const data: number[] = [];
    for (let i = 0; i < tp1.length - 1; i++) {
      data.push(TpuartConnection.LDataStart | i);
      data.push(tp1[i]);
    }
    data.push(TpuartConnection.LDataEnd | (tp1.length - 1));
    data.push(tp1[tp1.length - 1]);
    return data;
  }

  // Simula la espera de confirmación
  private async waitForCon(frameLen: number): Promise<boolean> {
    const innerFrameChar = 13 * TpuartConnection.OneBitTime;
    const bitTimes_15 = 15 * TpuartConnection.OneBitTime;
    const maxExchangeTimeout = TpuartConnection.MaxSendAttempts *
      ((TpuartConnection.BitTimes_50 + frameLen * innerFrameChar + 2 * bitTimes_15) / 1000);
    const start = Date.now();
    // En una implementación real se esperaría una señal de confirmación;
    // aquí se simula resolviendo la promesa luego de maxExchangeTimeout.
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        const now = Date.now();
        if (now - start >= maxExchangeTimeout) {
          this.logger.log("DEBUG", "No se recibió ACK después de " + (now - start) + " ms");
          resolve(false);
        } else {
          resolve(true);
        }
      }, maxExchangeTimeout);
    });
  }

  // Función de ayuda para dormir
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cálculo del checksum
  private static checksum(frame: Uint8Array): number {
    let cs = 0;
    for (const b of frame) {
      cs ^= b;
    }
    return (~cs) & 0xff;
  }

  // Se invoca desde el receptor al recibir confirmación
  onConfirmation(pos: boolean): void {
    if (!this.req) return;
    this.req[0] = CEMILData.MC_LDATA_CON;
    if (pos) {
      this.req[2] &= 0xfe;
    } else {
      this.req[2] |= 0x01;
    }
    // Notifica a los listeners que se recibió el frame
    this.fireFrameReceived(this.req);
  }

  fireFrameReceived(frame: Uint8Array): void {
    this.logger.log("TRACE", "cEMI (longitud " + frame.length + "): " +
      HexFormat.ofDelimiter(" ").formatHex(frame));
    try {
      const msg = CEMIFactory.create(frame, 0, frame.length);
      const fe = new FrameEvent(this, frame);
      for (const listener of this.listeners) {
        listener.frameReceived(fe);
      }
    } catch (e: any) {
      this.logger.log("ERROR", "Frame cEMI inválido: " +
        HexFormat.ofDelimiter(" ").formatHex(frame), e);
    }
  }

  // Notificación del receptor cuando se alcanza estado "idle"
  notifyIdle(): void {
    this.idle = true;
    if (this.idlePromiseResolve) {
      this.idlePromiseResolve();
      this.idlePromiseResolve = null;
    }
  }
  private waitForIdle(): Promise<void> {
    if (this.idle) return Promise.resolve();
    return new Promise(resolve => {
      this.idlePromiseResolve = resolve;
    });
  }
}

/* ===== Clase Receptor (simulación de hilo) ===== */

class Receiver {
  private quitFlag: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  public lastUartState: number = 0;
  public coolDownUntil: bigint = BigInt(0);
  // Otras variables internas para manejo del buffer y tiempos
  private inBuffer: number[] = [];
  private lastRead: number = 0;
  private extFrame: boolean = false;
  private frameAcked: boolean = false;
  private lastReceived: Uint8Array = new Uint8Array();
  private uartStatePending: boolean = false;
  private maxDelay: number = TpuartConnection.BitTimes_50;
  private consecutiveFrameDrops: number = -1;

  constructor(private parent: TpuartConnection) {
    // Suscribirse al evento 'data' para procesar datos entrantes
    this.parent.is.on('data', (data: Buffer) => this.processData(data));
  }

  start(): void {
    // Se inicia el loop (aún puedes mantener el setInterval si necesitas lógica periódica)
    this.intervalId = setInterval(() => this.run(), 10);
  }
  
  processData(data: Buffer): void {
    // Procesa el buffer recibido; por ejemplo, actualiza lastUartState
    if (data.length > 0) {
      this.parent.logger.log("TRACE", "Dato recibido: " + data.toString('hex'));
      // Aquí podrías aplicar validaciones específicas para determinar si es un estado válido
      // Por simplicidad, se actualiza lastUartState a la marca de tiempo actual
      this.lastUartState = Date.now();
    }
  }


  async run(): Promise<void> {
    if (this.quitFlag) return;
    try {
      // Simula lectura de datos del stream.
      // Por ejemplo, podrías suscribirte a eventos: this.parent.is.on('data', data => this.processData(data))
      // En este ejemplo se omite la lógica detallada.
    } catch (e) {
      this.parent.closeInternal(2, "Fallo en la comunicación del receptor: " + e);
      this.quit();
    }
  }

  quit(): void {
    this.quitFlag = true;
    if (this.intervalId) clearInterval(this.intervalId);
  }
}


// import { TpuartConnection, BlockingMode, KNXAddress, GroupAddress } from './TpuartConnection'; // Ajusta la ruta de importación
let connection: TpuartConnection
async function sendBooleanCommand() {
  // Se crea la conexión en el puerto "COM3".
  // Como es un comando de escritura de grupo, la lista de direcciones a reconocer puede quedar vacía.
  connection = new TpuartConnection("/dev/serial0", []);

  // Construcción del frame cEMI para enviar un valor booleano "true" (1 bit) a la dirección de grupo 1/1/1.
  // La codificación de la dirección de grupo 1/1/1 se realiza como:
  //   - Alto: (1 << 3) | 1 = 0x09
  //   - Bajo: 1 = 0x01
  const frame = new Uint8Array([
    0x11, // MC: L-Data.req (código de mensaje)
    0x00, // Longitud de información adicional
    0xB0, // Campo de control 1 (estándar, con flag de repetición)
    0x00, // Campo auxiliar (se usará para combinar con la longitud de la APDU)
    0x00, // Dirección de origen (alto, ejemplo: 0.0.1)
    0x01, // Dirección de origen (bajo)
    0x09, // Dirección de destino (alto para 1/1/1: (1<<3)|1)
    0x01, // Dirección de destino (bajo para 1/1/1)
    0x01, // Longitud de la APDU (1 byte)
    0x00, // TPCI (para este ejemplo se usa 0x00)
    0x01  // APDU: valor booleano "true" (1 bit)
  ]);

  try {
    // await connection.send(frame, BlockingMode.Blocking);
    await connection.activateBusmonitor()
    console.log("Comando booleano enviado exitosamente a la dirección de grupo 1/1/1");
  } catch (error) {
    console.error("Error al enviar el comando booleano:", error);
  }
}
// const connectionKnx = new KnxConnectionTunneling('192.168.0.81', 3671);
// connectionKnx.debug = true
// let value = true;
// function toggleValue() {
//   value = !value;
//   connectionKnx.Action('1/1/1', 1, {value});
// }
// let idInterval: NodeJS.Timeout
// connectionKnx.Connect(() => {
//   idInterval = setInterval(toggleValue, 3000)
// })

sendBooleanCommand();

process.on('SIGINT', () => {
  console.log("Cerrando conexión TPUART")
  connection.close()
  // connectionKnx.Disconnect(() => {
  //   console.log("Conexión de KNX/ip desconectada")
  //   clearInterval(idInterval)
  // })
})
