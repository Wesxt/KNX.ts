import { SerialPort } from "serialport";
import { KNXService } from "./KNXService";
import { TPUARTOptions } from "../@types/interfaces/connection";
import { CEMIAdapter } from "../utils/CEMIAdapter";
import { KNXHelper } from "../utils/KNXHelper";
import { CEMI, CEMIInstance } from "../core/CEMI";
import { GroupAddressCache } from "../core/cache/GroupAddressCache";

const UART_SERVICES = {
  RESET_REQ: 0x01,
  RESET_IND: 0x03,
  STATE_REQ: 0x02,
  STATE_IND: 0x07,
  ACTIVATE_BUSMON: 0x05,
  LDATA_CON_POS: 0x8b,
  LDATA_CON_NEG: 0x0b,
  ACK_INFO: 0x10,
  LDATA_START: 0x80,
  LDATA_END: 0x40,
  BUSY: 0xc0,
} as const;

enum TPUARTState {
  DISCONNECTED,
  RESET_WAIT,
  SET_ADDR_WAIT,
  GET_STATE_WAIT,
  ONLINE,
  ERROR,
}

export class TPUARTConnection extends KNXService<TPUARTOptions> {
  private serialPort: SerialPort;
  private receiver: Receiver;
  private connectionState: TPUARTState = TPUARTState.DISCONNECTED;
  private isOpening: boolean = false;

  private initPromise: {
    resolve: () => void;
    reject: (err: any) => void;
  } | null = null;
  private msgQueue: {
    frame: Buffer;
    resolve: () => void;
    reject: (err: any) => void;
    attempts: number;
  }[] = [];
  private isProcessing: boolean = false;
  private lastSentFrame: Buffer | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private confirmationTimer: NodeJS.Timeout | null = null;
  private initTimer: NodeJS.Timeout | null = null;
  private initRetryCount: number = 0;
  private isBusmonitorMode: boolean = false;

  constructor(options: TPUARTOptions) {
    super(options);
    this.serialPort = new SerialPort({
      path: options.path,
      baudRate: 19200,
      dataBits: 8,
      parity: "even",
      stopBits: 1,
      autoOpen: false,
    });

    this.receiver = new Receiver(this);
    this.serialPort.on("data", (data) => this.receiver.handleData(data));
    this.serialPort.on("error", (err) => {
      this.handleFatalError(err);
    });

    this.on("raw_frame", (frame: Buffer) => {
      // 1. Echo Cancellation (knxd pattern: ignore repeat bit 0x20)
      if (this.lastSentFrame && frame.length === this.lastSentFrame.length) {
        if (
          (frame[0] & ~0x20) === (this.lastSentFrame[0] & ~0x20) &&
          frame.subarray(1).equals(this.lastSentFrame.subarray(1))
        ) {
          this.lastSentFrame = null;
          return;
        }
      }

      this.resetKeepalive();

      // 2. Hardware ACK (knxd pattern)
      // Only if NOT in busmonitor mode
      if (!this.isBusmonitorMode) {
        const options = this.options;
        let ackByte = 0x10; // Default: No ACK

        if (options.ackGroup || options.ackIndividual) {
          const isExtended = (frame[0] & 0x80) === 0;
          const controlByte = isExtended ? frame[1] : frame[5];
          const isGroup = (controlByte & 0x80) !== 0;

          if ((isGroup && options.ackGroup) || (!isGroup && options.ackIndividual)) {
            ackByte = 0x11; // Send ACK
          }
        }
        this.writeRaw([ackByte]).catch(() => {});
      }

      try {
        if (this.isBusmonitorMode) {
          // In Busmonitor mode, we emit L_Busmon.ind
          const cemi = new CEMI.DataLinkLayerCEMI["L_Busmon.ind"](null, frame);
          this.emit("indication", cemi);
          this.emit("busmonitor", cemi);
        } else {
          const emiBuffer = Buffer.concat([Buffer.from([0x29]), frame]);
          const cemi = CEMIAdapter.emiToCemi(emiBuffer);
          if (cemi) {
            this.emit("indication", cemi);
            if (!this.isCacheDelegated && "destinationAddress" in cemi && "sourceAddress" in cemi) {
              try {
                GroupAddressCache.getInstance().processCEMI(
                  cemi as InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>,
                );
              } catch {
                /* empty */
              }
            }
            if (!this.isEventsDelegated && "destinationAddress" in cemi) {
              this.emit(cemi.destinationAddress as string, cemi);
            }
            this.emit("raw_indication", cemi.toBuffer());
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        /* empty */
      }
    });
  }

  private handleFatalError(err: any) {
    this.stopTimers();
    this.connectionState = TPUARTState.ERROR;
    this.isOpening = false;
    // Reject all pending messages
    while (this.msgQueue.length > 0) {
      this.msgQueue.shift()?.reject(err);
    }
    this.isProcessing = false;
    this.emit("error", err);
  }

  private stopTimers() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    if (this.confirmationTimer) clearTimeout(this.confirmationTimer);
    if (this.initTimer) clearTimeout(this.initTimer);
    this.keepaliveTimer = null;
    this.confirmationTimer = null;
    this.initTimer = null;
    this.removeAllListeners();
  }

  private resetKeepalive() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      if (this.connectionState === TPUARTState.ONLINE) {
        this.initRetryCount = 0;
        this.requestState();
      }
    }, 10000);
  }

  async connect(): Promise<void> {
    if (this.connectionState !== TPUARTState.DISCONNECTED && this.connectionState !== TPUARTState.ERROR) return;
    if (this.isOpening) return;
    this.isOpening = true;
    return new Promise((resolve, reject) => {
      this.initPromise = {
        resolve: () => {
          this.isOpening = false;
          resolve();
        },
        reject: (e) => {
          this.isOpening = false;
          reject(e);
        },
      };
      this.serialPort.open(async (err) => {
        if (err) {
          this.initPromise = null;
          this.isOpening = false;
          reject(err);
          return;
        }
        this.initRetryCount = 0;
        this.sendResetRequest();
      });
    });
  }

  private sendResetRequest() {
    this.connectionState = TPUARTState.RESET_WAIT;
    this.writeRaw([UART_SERVICES.RESET_REQ]).catch(() => {});
    if (this.initTimer) clearTimeout(this.initTimer);
    this.initTimer = setTimeout(() => {
      if (this.connectionState === TPUARTState.RESET_WAIT) {
        this.initRetryCount++;
        if (this.initRetryCount < 3) {
          this.sendResetRequest();
        } else {
          if (this.initPromise) {
            this.initPromise.reject(new Error("TPUART reset timeout"));
            this.initPromise = null;
          }
          this.handleFatalError(new Error("TPUART reset timeout"));
        }
      }
    }, 500);
  }

  async disconnect(): Promise<void> {
    this.stopTimers();
    this.connectionState = TPUARTState.DISCONNECTED;
    this.isOpening = false;

    // Clear queue
    while (this.msgQueue.length > 0) {
      this.msgQueue.shift()?.reject(new Error("Disconnected by user"));
    }
    this.isProcessing = false;

    return new Promise((resolve) => {
      if (this.serialPort.isOpen) {
        this.serialPort.close(() => {
          this.emit("disconnected");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Enable or disable busmonitor mode.
   * @param enabled
   */
  public async setBusmonitor(enabled: boolean): Promise<void> {
    if (this.connectionState < TPUARTState.ONLINE) throw new Error("TPUART offline");
    this.isBusmonitorMode = enabled;
    if (enabled) {
      await this.writeRaw([UART_SERVICES.ACTIVATE_BUSMON]);
    } else {
      // To exit busmonitor, we usually need a reset or re-init
      this.initRetryCount = 0;
      this.sendResetRequest();
    }
  }

  async send(data: Buffer | CEMIInstance): Promise<void> {
    if (this.connectionState < TPUARTState.ONLINE) throw new Error("TPUART offline");

    let cemiObj: CEMIInstance | undefined = undefined;
    if (Buffer.isBuffer(data)) {
      try {
        cemiObj = CEMI.fromBuffer(data);
      } catch {
        /* empty */
      }
    } else {
      cemiObj = data;
    }

    if (cemiObj && "destinationAddress" in cemiObj && "sourceAddress" in cemiObj) {
      if (!this.isCacheDelegated) {
        try {
          GroupAddressCache.getInstance().processCEMI(
            cemiObj as InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>,
          );
        } catch {
          /* empty */
        }
      }
      if (!this.isEventsDelegated && cemiObj.destinationAddress) {
        this.emit(cemiObj.destinationAddress, cemiObj);
      }
    }

    const frame = Buffer.isBuffer(data) ? data : CEMIAdapter.cemiToEmi(data)?.toBuffer();
    if (!frame) throw new Error("Invalid data");
    this.emit("send", data);
    return this.enqueueFrame(frame);
  }

  private async enqueueFrame(frame: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.msgQueue.push({ frame, resolve, reject, attempts: 0 });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.msgQueue.length === 0) return;
    this.isProcessing = true;
    const item = this.msgQueue[0];

    // knxd pattern: If this is a retry (attempts > 0), set the Repeat Bit (bit 5) to 0
    // This tells the bus that this is a repetition of a previously failed frame.
    if (item.attempts > 0 && item.frame[0] & 0x20) {
      item.frame[0] &= ~0x20; // Set repeat bit to 0
      // Update checksum (XOR with 0x20 since we toggled one bit)
      item.frame[item.frame.length - 1] ^= 0x20;
    }

    this.lastSentFrame = item.frame;

    // Timeout for hardware confirmation (0x8B/0x0B)
    this.confirmationTimer = setTimeout(() => {
      this.isProcessing = false;
      this.lastSentFrame = null;
      if (item.attempts < 3) {
        item.attempts++;
        this.processQueue();
      } else {
        this.msgQueue.shift();
        item.reject(new Error("TPUART confirmation timeout"));
        this.processQueue();
      }
    }, 2000);

    this.serialPort.write(this.toUartServices(item.frame), (err) => {
      if (err) {
        if (this.confirmationTimer) clearTimeout(this.confirmationTimer);
        this.isProcessing = false;
        this.lastSentFrame = null;
        if (item.attempts < 3) {
          item.attempts++;
          setTimeout(() => this.processQueue(), 50);
        } else {
          this.msgQueue.shift();
          item.reject(err);
          this.processQueue();
        }
      }
    });
  }

  private toUartServices(telegram: Buffer): Buffer {
    const result = Buffer.alloc(telegram.length * 2);
    for (let i = 0; i < telegram.length; i++) {
      const ctrl =
        i === telegram.length - 1 ? UART_SERVICES.LDATA_END | (i & 0x3f) : UART_SERVICES.LDATA_START | (i & 0x3f);
      result[i * 2] = ctrl;
      result[i * 2 + 1] = telegram[i];
    }
    return result;
  }

  _handleControlByte(byte: number) {
    this.resetKeepalive();

    // 1. External ACKs/NACKs from other devices
    if (byte === 0xcc || byte === 0x0c || byte === 0xc0) {
      this.emit("bus_ack", {
        type: byte === 0xcc ? "ACK" : byte === 0x0c ? "NACK" : "BUSY",
        timestamp: Date.now(),
      });
      return;
    }

    // 2. NCN5120 / TPUART2 Frame State Indication
    if ((byte & 0x17) === 0x13) {
      const hasError = (byte & 0x07) !== 0;
      if (hasError) {
        const error = byte & 0x04 ? "Checksum Error" : byte & 0x02 ? "Timing Error" : "Bit Error";
        this.emit("warning", `TPUART Frame Error: ${error}`);
      }
      return;
    }

    if (byte === UART_SERVICES.RESET_IND) {
      if (this.connectionState === TPUARTState.RESET_WAIT) {
        if (this.initTimer) clearTimeout(this.initTimer);
        this.initRetryCount = 0;
        const options = this.options;
        if (options.individualAddress) {
          this.connectionState = TPUARTState.SET_ADDR_WAIT;
          this.writeRaw(
            Buffer.concat([Buffer.from([0x28]), KNXHelper.GetAddress(options.individualAddress, ".")]),
          ).catch((e) => this.emit("error", e));
          // knxd immediately transitions to get state after setting address
          this.requestState();
        } else {
          this.requestState();
        }
      } else if (this.connectionState >= TPUARTState.ONLINE) {
        // Spurious reset (power glitch?) -> re-initialize
        this.emit("warning", "TPUART spurious reset detected, re-initializing...");
        this.initRetryCount = 0;
        this.sendResetRequest();
      }
      return;
    }
    if (byte === UART_SERVICES.BUSY) {
      if (this.confirmationTimer) clearTimeout(this.confirmationTimer);
      const item = this.msgQueue[0];
      if (item && item.attempts < 3) {
        item.attempts++;
        this.isProcessing = false;
        setTimeout(() => this.processQueue(), 50);
      } else if (item) {
        this.msgQueue.shift();
        this.isProcessing = false;
        this.lastSentFrame = null;
        item.reject(new Error("Bus Busy"));
        this.processQueue();
      }
      return;
    }
    if (byte === UART_SERVICES.LDATA_CON_POS || byte === UART_SERVICES.LDATA_CON_NEG) {
      if (this.confirmationTimer) clearTimeout(this.confirmationTimer);
      const item = this.msgQueue.shift();
      this.isProcessing = false;
      if (item && byte === UART_SERVICES.LDATA_CON_POS) {
        item.resolve();
      } else if (item) {
        item.reject(new Error("NAK"));
      }
      this.processQueue();
      return;
    }
    if ((byte & 0x07) === UART_SERVICES.STATE_IND) {
      if (this.initTimer) clearTimeout(this.initTimer);
      this.initRetryCount = 0;

      // Decode error bits (knxd pattern)
      if (byte !== 0x07 && byte !== 0x00) {
        if (byte & 0x40) this.emit("warning", "TPUART: Hardware ACK NOT supported by this chip");
        if (byte & 0x04) this.emit("warning", "TPUART: Slave collision detected");
        if (byte & 0x02) this.emit("warning", "TPUART: Receive error");
        if (byte & 0x01) this.emit("warning", "TPUART: Transmit error");
      }

      if (this.connectionState < TPUARTState.ONLINE) {
        this.connectionState = TPUARTState.ONLINE;
        if (this.initPromise) {
          this.initPromise.resolve();
          this.initPromise = null;
          this.emit("connected");
        }
      }
    }
  }

  private async writeRaw(data: number[] | Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.serialPort.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private requestState() {
    this.connectionState = TPUARTState.GET_STATE_WAIT;
    this.writeRaw([UART_SERVICES.STATE_REQ]).catch((e) => this.emit("error", e));
    if (this.initTimer) clearTimeout(this.initTimer);
    this.initTimer = setTimeout(() => {
      if (this.connectionState === TPUARTState.GET_STATE_WAIT) {
        this.initRetryCount++;
        if (this.initRetryCount < 5) {
          this.requestState();
        } else {
          if (this.initPromise) {
            this.initPromise.reject(new Error("TPUART state request timeout"));
            this.initPromise = null;
          }
          this.handleFatalError(new Error("TPUART state request timeout"));
        }
      }
    }, 500);
  }
}

class Receiver {
  private buffer: Buffer = Buffer.alloc(0);
  private lastRead: number = 0;
  private extFrame: boolean = false;

  constructor(private connection: TPUARTConnection) {}

  handleData(data: Buffer) {
    for (const byte of data) {
      this.processByte(byte);
    }
  }

  private processByte(byte: number) {
    // BUG FIX: Only handle control bytes if we are NOT in the middle of a frame
    // This prevents data bytes (like 0x03) from being interpreted as RESET_IND
    if (this.buffer.length === 0) {
      if (this.isControlByte(byte)) {
        this.connection._handleControlByte(byte);
        return;
      }
      // Support for NCN5120/TPUART2: Ignore frame end (0xCB) and state indication (0x13)
      if (byte === 0xcb || (byte & 0x17) === 0x13) return;
    }

    const now = Date.now();
    // Inter-byte timeout (1000ms) to reset buffer if sync is lost (matches knxd T_wait_more)
    if (this.buffer.length > 0 && now - this.lastRead > 1000) this.buffer = Buffer.alloc(0);

    if (this.buffer.length === 0) {
      if (this.isFrameStart(byte)) {
        this.buffer = Buffer.from([byte]);
        this.lastRead = now;
      }
    } else {
      this.buffer = Buffer.concat([this.buffer, Buffer.from([byte])]);
      this.lastRead = now;
      this.checkCompleteFrame();
    }
  }

  private isControlByte(byte: number): boolean {
    return (
      byte === UART_SERVICES.RESET_IND ||
      byte === UART_SERVICES.LDATA_CON_POS ||
      byte === UART_SERVICES.LDATA_CON_NEG ||
      byte === UART_SERVICES.BUSY ||
      (byte & 0x07) === UART_SERVICES.STATE_IND
    );
  }

  private isFrameStart(byte: number): boolean {
    this.extFrame = (byte & 0x80) === 0;
    return (byte & 0x50) === 0x10;
  }

  private checkCompleteFrame() {
    const minLength = this.extFrame ? 7 : 6;
    if (this.buffer.length >= minLength) {
      const payloadLen = this.extFrame ? this.buffer[6] : this.buffer[5] & 0x0f;
      const totalLen = payloadLen + (this.extFrame ? 9 : 8);
      if (this.buffer.length >= totalLen) {
        const frame = this.buffer.subarray(0, totalLen);
        if (this.validateChecksum(frame)) this.connection.emit("raw_frame", frame);
        this.buffer = Buffer.alloc(0);
      }
    }
  }

  private validateChecksum(frame: Buffer): boolean {
    let checksum = 0;
    for (let i = 0; i < frame.length - 1; i++) checksum ^= frame[i];
    return frame[frame.length - 1] === (checksum ^ 0xff);
  }
}
