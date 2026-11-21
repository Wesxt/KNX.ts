import { KNXService } from "../connection/KNXService";
import { CEMI, CEMIInstance } from "../core/CEMI";
import { ControlField } from "../core/ControlField";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { APCIEnum } from "../core/enum/APCIEnum";
import { AddressType } from "../core/enum/EnumControlFieldExtended";
import { APDU } from "../core/layers/data/APDU";
import { TPDU } from "../core/layers/data/TPDU";
import { APCI } from "../core/layers/interfaces/APCI";
import { TPCI, TPCIType } from "../core/layers/interfaces/TPCI";
import { MESSAGE_CODE_FIELD } from "../core/MessageCodeField";
import type { KnxDataSecure } from "../security/KnxDataSecure";
import { APCI_DATA_SECURE, parseSecureAsduHeader, SecureAlService } from "../security/KnxDataSecureCcm";
import { buildConnectedLDataReq, buildTAckReq, buildTConnectReq, buildTDisconnectReq } from "./apduBuilders";

export interface TransportDataSecureOptions {
  /** {@link KnxDataSecure} manager holding keys and sequence numbers. */
  manager: KnxDataSecure;
  /** True to use Tool Key / FDSK (`SCF.T = 1`, default `true`). */
  toolAccess?: boolean;
  /** Optional explicit 16-byte AES-128 key override. */
  key?: Buffer | string;
  /** True for Authentication + Confidentiality (`SAI = 1`, default `true`), false for Authentication only (`SAI = 0`). */
  confidentiality?: boolean;
  /**
   * When true (default), automatically executes `DM_SecureSync_RCl` over the connected channel right after `T_Connect`
   * to synchronize both local and remote 48-bit sequence numbers before sending management requests.
   */
  autoSync?: boolean;
}

export interface TransportConnectionOptions {
  sourceAddress?: string;
  ackTimeoutMs?: number;
  responseTimeoutMs?: number;
  connectionTimeoutMs?: number;
  maxRetries?: number;
  /** Optional KNX Data Security configuration for securing all APDUs exchanged over this connection. */
  dataSecure?: TransportDataSecureOptions;
}

/**
 * Implements a KNX Point-to-Point Connection-Oriented Transport Layer session (KNX Standard 03_03_04 §5).
 *
 * Manages T_Connect, 4-bit sequence numbers (0..15), T_ACK / T_NAK with 3 s timeout and up to 3 retries,
 * 6 s connection inactivity timeout, and T_Disconnect cleanup.
 */
export class TransportConnection {
  public readonly sourceAddress: string;
  public readonly destinationAddress: string;
  private readonly ackTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly connectionTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly dataSecure?: TransportDataSecureOptions;

  private txSequence: number = 0;
  private rxSequence: number = 0;
  private _isConnected: boolean = false;
  private _remoteDisconnected: boolean = false;
  private connectionTimer: NodeJS.Timeout | null = null;
  private indicationHandler: ((cemi: CEMIInstance) => void) | null = null;

  private pendingAckWaiter: {
    expectedSeq: number;
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;

  private pendingResponseWaiter: {
    expectedApci: (APCIEnum | number)[];
    resolve: (apdu: APDU) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  private pendingRawSyncResWaiter: {
    resolve: (cemi: CEMIInstance) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  constructor(
    private readonly service: KNXService,
    destinationAddress: string,
    options: TransportConnectionOptions = {},
  ) {
    this.sourceAddress = options.sourceAddress ?? service.individualAddress ?? "0.0.0";
    this.destinationAddress = destinationAddress;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 3000;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 3000;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 6000;
    this.maxRetries = options.maxRetries ?? 3;
    this.dataSecure = options.dataSecure;
  }

  public get isConnected(): boolean {
    return this._isConnected && !this._remoteDisconnected;
  }

  public get remoteDisconnected(): boolean {
    return this._remoteDisconnected;
  }

  public get currentTxSequence(): number {
    return this.txSequence;
  }

  public get currentRxSequence(): number {
    return this.rxSequence;
  }

  /**
   * Opens the Transport Layer connection by sending T_Connect.
   */
  public async connect(): Promise<void> {
    if (this._isConnected) return;
    this.txSequence = 0;
    this.rxSequence = 0;
    this._remoteDisconnected = false;

    this.indicationHandler = (cemi: CEMIInstance) => this.onIndication(cemi);
    this.service.on("indication", this.indicationHandler);

    const connectCemi = buildTConnectReq(this.sourceAddress, this.destinationAddress);

    this._isConnected = true;
    this.resetConnectionTimer();
    await this.service.send(connectCemi);

    if (this.dataSecure && (this.dataSecure.autoSync ?? true)) {
      await this.syncDataSecure();
    }
  }

  /**
   * Synchronizes 48-bit Data Security Sequence Numbers (`DM_SecureSync_RCl`, connected mode)
   * over this active Transport Layer connection.
   */
  public async syncDataSecure(): Promise<void> {
    if (!this.dataSecure) return;
    if (!this.isConnected) {
      throw new Error(`TransportConnection to ${this.destinationAddress} is not connected`);
    }

    await this.dataSecure.manager.syncSequenceNumber(this.service, this.destinationAddress, {
      commMode: "connected",
      toolAccess: this.dataSecure.toolAccess ?? true,
      key: this.dataSecure.key,
      sourceAddress: this.sourceAddress,
      timeoutMs: Math.max(this.responseTimeoutMs, 6000),
      connectedChannel: {
        txSequence: this.txSequence,
        sendNumbered: async (secureAsdu: Buffer) => {
          const seq = this.txSequence;
          const tpci = new TPCI(TPCIType.T_DATA_CONNECTED_PDU);
          tpci.sequenceNumber = seq & 0x0f;
          const apdu = new APDU(
            new TPCI(tpci.getValue() as TPCIType),
            new APCI(APCIEnum.A_DataSecure_Protocol_Data_Unit),
            secureAsdu,
            false,
          );
          const reqCemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
            null,
            new ControlField(0x30), // Extended Frame, System priority
            new ExtendedControlField(0x60),
            this.sourceAddress,
            this.destinationAddress,
            new TPDU(tpci, apdu, secureAsdu),
          );
          await this.sendWithAckRetry(reqCemi, seq);
          this.txSequence = (this.txSequence + 1) & 0x0f;
        },
        waitResponse: (timeoutMs: number) =>
          new Promise<CEMIInstance>((resolve, reject) => {
            const timer = setTimeout(() => {
              if (this.pendingRawSyncResWaiter) {
                this.pendingRawSyncResWaiter = null;
                reject(new Error(`Timeout waiting for connected S-A_Sync_Res from ${this.destinationAddress}`));
              }
            }, timeoutMs);
            this.pendingRawSyncResWaiter = { resolve, reject, timer };
          }),
      },
    });
  }

  /**
   * Sends a numbered T_Data_Connected request, waits for T_ACK (repeating up to 3 times on timeout/T_NAK),
   * awaits the matching T_Data_Connected response, acknowledges it with T_ACK, and returns the response APDU.
   */
  public async request(
    apciRequest: APCIEnum | number,
    data: Buffer,
    isShort: boolean,
    expectedResponseApci: APCIEnum | number | (APCIEnum | number)[],
  ): Promise<APDU> {
    if (!this.isConnected) {
      throw new Error(`TransportConnection to ${this.destinationAddress} is not connected`);
    }

    const seq = this.txSequence;
    const plainReqCemi = buildConnectedLDataReq(
      this.sourceAddress,
      this.destinationAddress,
      seq,
      apciRequest,
      data,
      isShort,
    );
    const reqCemi = this.dataSecure
      ? this.dataSecure.manager.wrapCemi(plainReqCemi, {
          key: this.dataSecure.key,
          toolAccess: this.dataSecure.toolAccess ?? true,
          confidentiality: this.dataSecure.confidentiality ?? true,
          sourceAddress: this.sourceAddress,
        })
      : plainReqCemi;

    const expectedArray = Array.isArray(expectedResponseApci) ? expectedResponseApci : [expectedResponseApci];

    // Prepare the response waiter BEFORE sending so we never miss a fast response arriving right after T_ACK
    let responseWaiterTimer: NodeJS.Timeout | null = null;
    const responsePromise = new Promise<APDU>((resolve, reject) => {
      responseWaiterTimer = setTimeout(
        () => {
          if (this.pendingResponseWaiter) {
            this.pendingResponseWaiter = null;
            reject(new Error(`Timeout waiting for response from ${this.destinationAddress}`));
          }
        },
        this.ackTimeoutMs * (this.maxRetries + 1) + this.responseTimeoutMs,
      );

      this.pendingResponseWaiter = {
        expectedApci: expectedArray,
        resolve,
        reject,
        timer: responseWaiterTimer,
      };
    });
    // Prevent unhandled rejection if ACK fails first
    responsePromise.catch(() => {});

    try {
      await this.sendWithAckRetry(reqCemi, seq);
      this.txSequence = (this.txSequence + 1) & 0x0f;
      return await responsePromise;
    } catch (err) {
      if (this.pendingResponseWaiter) {
        clearTimeout(this.pendingResponseWaiter.timer);
        this.pendingResponseWaiter = null;
      }
      throw err;
    }
  }

  /**
   * Sends a numbered T_Data_Connected request that is acknowledged at the Transport Layer (`T_ACK`)
   * without an Application Layer response (e.g. `A_Memory_Write`, `A_MemoryBit_Write`, `A_UserMemory_Write`
   * when Verify Mode is inactive, or `A_FilterTable_Open`).
   */
  public async sendConnectedUnconfirmed(
    apciRequest: APCIEnum | number,
    data: Buffer,
    isShort: boolean = false,
  ): Promise<void> {
    if (!this.isConnected) {
      throw new Error(`TransportConnection to ${this.destinationAddress} is not connected`);
    }

    const seq = this.txSequence;
    const plainReqCemi = buildConnectedLDataReq(
      this.sourceAddress,
      this.destinationAddress,
      seq,
      apciRequest,
      data,
      isShort,
    );
    const reqCemi = this.dataSecure
      ? this.dataSecure.manager.wrapCemi(plainReqCemi, {
          key: this.dataSecure.key,
          toolAccess: this.dataSecure.toolAccess ?? true,
          confidentiality: this.dataSecure.confidentiality ?? true,
          sourceAddress: this.sourceAddress,
        })
      : plainReqCemi;

    await this.sendWithAckRetry(reqCemi, seq);
    this.txSequence = (this.txSequence + 1) & 0x0f;
  }

  /**
   * Sends an unconfirmed connected telegram (such as Basic A_Restart at the end of NM_IndividualAddress_Write)
   * and aborts the local Transport Layer connection state per 03_05_02 §2.3 step 4 / §3.7.3.
   */
  public async sendRestartAndAbort(cemi: CEMIInstance): Promise<void> {
    if (!this.isConnected) {
      throw new Error(`TransportConnection to ${this.destinationAddress} is not connected`);
    }
    const outCemi = this.dataSecure
      ? this.dataSecure.manager.wrapCemi(cemi, {
          key: this.dataSecure.key,
          toolAccess: this.dataSecure.toolAccess ?? true,
          confidentiality: this.dataSecure.confidentiality ?? true,
          sourceAddress: this.sourceAddress,
        })
      : cemi;
    await this.service.send(outCemi);
    await this.disconnect(false);
  }

  /**
   * Closes the Transport Layer connection. When `sendDisconnectPdu` is true (default), transmits T_Disconnect.
   */
  public async disconnect(sendDisconnectPdu: boolean = true): Promise<void> {
    this.clearTimers();

    if (this.indicationHandler) {
      this.service.removeListener("indication", this.indicationHandler);
      this.indicationHandler = null;
    }

    const wasConnected = this._isConnected;
    this._isConnected = false;

    if (this.pendingAckWaiter) {
      const waiter = this.pendingAckWaiter;
      this.pendingAckWaiter = null;
      waiter.reject(new Error("Transport connection closed while waiting for T_ACK"));
    }
    if (this.pendingResponseWaiter) {
      const waiter = this.pendingResponseWaiter;
      clearTimeout(waiter.timer);
      this.pendingResponseWaiter = null;
      waiter.reject(new Error("Transport connection closed while waiting for response"));
    }
    if (this.pendingRawSyncResWaiter) {
      const waiter = this.pendingRawSyncResWaiter;
      clearTimeout(waiter.timer);
      this.pendingRawSyncResWaiter = null;
      waiter.reject(new Error("Transport connection closed while waiting for S-A_Sync_Res"));
    }

    if (wasConnected && sendDisconnectPdu && !this._remoteDisconnected) {
      const discCemi = buildTDisconnectReq(this.sourceAddress, this.destinationAddress);
      await this.service.send(discCemi);
    }
  }

  private async sendWithAckRetry(reqCemi: CEMIInstance, seq: number): Promise<void> {
    let repCount = 0;
    while (repCount <= this.maxRetries) {
      this.resetConnectionTimer();
      const ackPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pendingAckWaiter) {
            this.pendingAckWaiter = null;
            reject(new Error(`T_ACK timeout for seq ${seq}`));
          }
        }, this.ackTimeoutMs);

        this.pendingAckWaiter = {
          expectedSeq: seq,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (err: Error) => {
            clearTimeout(timer);
            reject(err);
          },
        };
      });

      await this.service.send(reqCemi);

      try {
        await ackPromise;
        return;
      } catch (err: any) {
        if (this._remoteDisconnected || !this._isConnected) {
          throw err;
        }
        repCount++;
        if (repCount > this.maxRetries) {
          await this.disconnect(true);
          throw new Error(
            `Transport Layer T_Data_Connected failed after ${this.maxRetries} retries to ${this.destinationAddress}: ${err?.message ?? err}`,
            { cause: err },
          );
        }
      }
    }
  }

  private onIndication(cemi: CEMIInstance): void {
    if (!("TPDU" in cemi)) return;
    if (cemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) return;
    if (cemi.sourceAddress !== this.destinationAddress) return;
    if (cemi.controlField2?.addressType !== AddressType.INDIVIDUAL) return;
    if (this.sourceAddress !== "0.0.0" && cemi.destinationAddress && cemi.destinationAddress !== this.sourceAddress) {
      return;
    }
    const tpdu = cemi.TPDU;
    if (!tpdu || !tpdu.tpci) return;

    this.resetConnectionTimer();
    const tpci = tpdu.tpci;

    if (tpci.dataControlFlag) {
      const raw = tpci.getValue();
      if (raw === TPCIType.T_DISCONNECT_PDU) {
        this._remoteDisconnected = true;
        void this.disconnect(false);
        return;
      }
      const ctrlType = raw & 0xc3;
      const seq = tpci.sequenceNumber;
      if (ctrlType === TPCIType.T_ACK_PDU) {
        if (this.pendingAckWaiter && this.pendingAckWaiter.expectedSeq === seq) {
          const waiter = this.pendingAckWaiter;
          this.pendingAckWaiter = null;
          waiter.resolve();
        }
        return;
      }
      if (ctrlType === TPCIType.T_NAK_PDU) {
        if (this.pendingAckWaiter && this.pendingAckWaiter.expectedSeq === seq) {
          const waiter = this.pendingAckWaiter;
          this.pendingAckWaiter = null;
          waiter.reject(new Error(`Received T_NAK for seq ${seq}`));
        }
        return;
      }
      return;
    }

    // Numbered Data PDU (T_Data_Connected)
    if (!tpci.numberedFlag) return;
    const rxSeq = tpci.sequenceNumber;

    if (rxSeq === this.rxSequence) {
      this.rxSequence = (this.rxSequence + 1) & 0x0f;
      const ackCemi = buildTAckReq(this.sourceAddress, this.destinationAddress, rxSeq);
      void this.service.send(ackCemi).catch(() => {});

      let apdu: APDU | null = tpdu.apdu;

      // Handle connected KNX Data Secure frames if service.dataSecure did not already unwrap them
      if (apdu && apdu.apci.value === APCI_DATA_SECURE) {
        const hdr = parseSecureAsduHeader(apdu.data);
        if (hdr.valid && hdr.service === SecureAlService.S_A_SYNC_RES) {
          if (this.pendingRawSyncResWaiter) {
            const waiter = this.pendingRawSyncResWaiter;
            clearTimeout(waiter.timer);
            this.pendingRawSyncResWaiter = null;
            waiter.resolve(cemi);
          }
          return;
        }
        if (this.dataSecure) {
          const explicitKey =
            this.dataSecure.key !== undefined
              ? Buffer.isBuffer(this.dataSecure.key)
                ? this.dataSecure.key
                : Buffer.from(this.dataSecure.key.replace(/^0x/i, "").replace(/[\s:-]/g, ""), "hex")
              : undefined;
          const unwrapped = this.dataSecure.manager.unwrapCemi(cemi, { key: explicitKey });
          if (!unwrapped.plainCemi || !("TPDU" in unwrapped.plainCemi)) {
            // 03_03_07 §5.5.5.2 Error handling 1: failed security check does NOT close TL connection
            return;
          }
          apdu = unwrapped.plainCemi.TPDU.apdu;
        } else {
          return;
        }
      }

      if (this.pendingResponseWaiter && apdu) {
        const expected = this.pendingResponseWaiter.expectedApci;
        const rawApci = apdu.apci.value;
        const baseFourBitApci = APCIEnum[rawApci] === undefined ? rawApci & 0x03c0 : rawApci;
        if (expected.includes(rawApci) || expected.includes(baseFourBitApci)) {
          const waiter = this.pendingResponseWaiter;
          clearTimeout(waiter.timer);
          this.pendingResponseWaiter = null;
          waiter.resolve(apdu);
        }
      }
    } else if (rxSeq === ((this.rxSequence - 1 + 16) & 0x0f)) {
      // Duplicate T_Data_Connected from remote -> re-send T_ACK without reprocessing (03_03_04 §5.4)
      const ackCemi = buildTAckReq(this.sourceAddress, this.destinationAddress, rxSeq);
      void this.service.send(ackCemi).catch(() => {});
    }
  }

  private resetConnectionTimer(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
    }
    this.connectionTimer = setTimeout(() => {
      this.connectionTimer = null;
      if (this._isConnected) {
        void this.disconnect(true);
      }
    }, this.connectionTimeoutMs);
  }

  private clearTimers(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }
}
