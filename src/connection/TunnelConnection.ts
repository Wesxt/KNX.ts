import dgram from "dgram";
import { HPAI } from "../core/KNXnetIPStructures";
import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import { KNXnetIPServiceType, KNXnetIPErrorCodes, KNXLayer } from "../core/enum/KNXnetIPEnum";

import { Logger } from "pino";

/**
 * Encapsulates a single KNXnet/IP Tunnelling or Management connection state.
 * Handles sequence numbers, heartbeats, reliable delivery (stop-and-wait),
 * and retransmissions according to KNX Spec Vol 3/8/4.
 */
export class TunnelConnection {
  public sno: number = 0;
  public rno: number = 0;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pendingAck: {
    packet: Buffer;
    timer: NodeJS.Timeout;
    seq: number;
    isRetransmission: boolean;
  } | null = null;

  private queue: { packet: Buffer; seq: number; serviceType: KNXnetIPServiceType }[] = [];
  private isSending: boolean = false;

  // Rate limiting / Pacing state
  public rxCount: number = 0;
  public lastRxTime: number = Date.now();
  private logger: Logger;

  constructor(
    public readonly channelId: number,
    public readonly controlHPAI: HPAI,
    public readonly dataHPAI: HPAI,
    public readonly knxAddress: number,
    public readonly knxAddressStr: string,
    public readonly knxLayer: KNXLayer,
    private readonly socket: dgram.Socket,
    private readonly heartbeatTimeoutMs: number,
    private readonly retransmitTimeoutMs: number,
    private readonly maxQueueSize: number,
    private readonly onDisconnect: (channelId: number, sendDisconnect: boolean) => void,
    parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ channelId, IA: knxAddressStr });
    this.resetHeartbeat();
  }

  /**
   * Resets the heartbeat timer. Should be called on any valid activity.
   */
  public resetHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.logger.warn(`Heartbeat timeout`);
      this.onDisconnect(this.channelId, true);
    }, this.heartbeatTimeoutMs);
  }

  /**
   * Enqueues a CEMI message to be sent to the client.
   */
  public enqueue(cemiBuffer: Buffer, serviceType: KNXnetIPServiceType): void {
    if (this.maxQueueSize > 0 && this.queue.length >= this.maxQueueSize) {
      this.logger.warn(`Outgoing queue full. Dropping connection.`);
      this.onDisconnect(this.channelId, true);
      return;
    }

    const seq = this.sno;
    const tunnelHeader = Buffer.from([0x04, this.channelId, seq, 0x00]);
    const responseHeader = new KNXnetIPHeader(
      serviceType,
      KNXnetIPHeader.HEADER_SIZE_10 + tunnelHeader.length + cemiBuffer.length,
    );
    const packet = Buffer.concat([responseHeader.toBuffer(), tunnelHeader, cemiBuffer]);

    this.queue.push({ packet, seq, serviceType });
    this.sno = (this.sno + 1) % 256;

    this.processQueue();
  }

  private processQueue(): void {
    if (this.isSending || this.queue.length === 0) return;

    this.isSending = true;
    const item = this.queue.shift()!;
    this.sendWithRetry(item.packet, item.seq, false);
  }

  private sendWithRetry(packet: Buffer, seq: number, isRetransmission: boolean): void {
    if (!this.socket) return;

    try {
      this.socket.send(packet, this.dataHPAI.port, this.dataHPAI.ipAddress);
    } catch (err: any) {
      this.logger.error(`Failed to send packet to ${this.dataHPAI.ipAddress}: ${err.message}`);
      this.onDisconnect(this.channelId, false);
      return;
    }

    this.pendingAck = {
      packet,
      seq,
      isRetransmission,
      timer: setTimeout(() => {
        if (!isRetransmission) {
          // Spec 2.6.1: Repeat once
          this.logger.warn(`ACK timeout for seq ${seq}, retransmitting...`);
          this.sendWithRetry(packet, seq, true);
        } else {
          // Spec 2.6.1: Terminate connection
          this.logger.error(`Second ACK timeout for seq ${seq}. Terminating connection.`);
          this.onDisconnect(this.channelId, true);
        }
      }, this.retransmitTimeoutMs),
    };
  }

  /**
   * Handles an incoming ACK from the client.
   */
  public handleAck(seq: number, status: number): void {
    this.resetHeartbeat();

    if (this.pendingAck && this.pendingAck.seq === seq) {
      clearTimeout(this.pendingAck.timer);
      this.pendingAck = null;
      this.isSending = false;

      if (status !== KNXnetIPErrorCodes.E_NO_ERROR) {
        this.logger.warn(`Received ACK with error ${status}. Closing connection.`);
        this.onDisconnect(this.channelId, true);
        return;
      }

      // Process next item in queue
      this.processQueue();
    } else {
      this.logger.debug(`Ignored ACK for seq ${seq} (expected ${this.pendingAck?.seq})`);
    }
  }

  /**
   * Validates an incoming request from the client according to sequence number rules.
   */
  public validateRequest(seq: number): { action: "process" | "discard" | "retransmit_ack"; status: number } {
    this.resetHeartbeat();

    if (seq === this.rno) {
      // Expected sequence number
      this.rno = (this.rno + 1) % 256;
      return { action: "process", status: KNXnetIPErrorCodes.E_NO_ERROR };
    } else if (seq === (this.rno - 1 + 256) % 256) {
      // Previous sequence number (retransmit ACK)
      return { action: "retransmit_ack", status: KNXnetIPErrorCodes.E_NO_ERROR };
    } else {
      // Out of sequence - discard without reply (Spec 2.6.1)
      this.logger.warn(`Out of sequence request: got ${seq}, expected ${this.rno}`);
      return { action: "discard", status: 0 };
    }
  }

  /**
   * Closes the connection and cleans up resources.
   */
  public close(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.pendingAck) clearTimeout(this.pendingAck.timer);
    this.heartbeatTimer = null;
    this.pendingAck = null;
    this.queue = [];
    this.isSending = false;
  }
}
