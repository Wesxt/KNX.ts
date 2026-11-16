import crypto from "node:crypto";
import { SecureWrapper, TimerNotify } from "../core/KNXnetIPSecureStructures";
import { parseKey16 } from "../security/KnxSecureKeys";

export enum SecureRoutingTimerState {
  SCHED_PERIODIC = "SCHED_PERIODIC",
  SCHED_UPDATE = "SCHED_UPDATE",
}

export interface SecureRoutingTimerOptions {
  backboneKey: Buffer | string;
  serialNumber: Buffer;
  latencyToleranceMs?: number;
  syncLatencyFraction?: number;
  initialNotifyMaxDelayMs?: number;
  initialTimerValue?: bigint | number;
  onSendTimerNotify?: (frame: Buffer) => void;
  nowMs?: () => number;
  randomFn?: () => number;
}

/**
 * Implements the KNX IP Secure Multicast Timer Synchronization State Machine (03_08_09 §2.2.2.3.2)
 * and multicast SECURE_WRAPPER / TIMER_NOTIFY encryption & authentication.
 */
export class SecureRoutingTimer {
  private backboneKey: Buffer;
  public readonly serialNumber: Buffer;
  public readonly latencyToleranceMs: number;
  public readonly syncLatencyToleranceMs: number;
  public readonly initialNotifyMaxDelayMs: number;

  public readonly minDelayTimeKeeperPeriodicNotifyMs: number = 10000;
  public readonly maxDelayTimeKeeperPeriodicNotifyMs: number;
  public readonly minDelayTimeFollowerPeriodicNotifyMs: number;
  public readonly maxDelayTimeFollowerPeriodicNotifyMs: number;

  public readonly minDelayTimeKeeperUpdateNotifyMs: number = 100;
  public readonly maxDelayTimeKeeperUpdateNotifyMs: number;
  public readonly minDelayTimeFollowerUpdateNotifyMs: number;
  public readonly maxDelayTimeFollowerUpdateNotifyMs: number;

  private _state: SecureRoutingTimerState = SecureRoutingTimerState.SCHED_PERIODIC;
  private _isTimeKeeper: boolean = false;
  private minDelayPeriodicNotifyMs: number;
  private maxDelayPeriodicNotifyMs: number;
  private minDelayUpdateNotifyMs: number;
  private maxDelayUpdateNotifyMs: number;

  private baseTimerValue: bigint = 0n;
  private baseMonotonicMs: number;
  private notifyTimer: NodeJS.Timeout | null = null;
  private rememberedOutdatedSerial: Buffer | null = null;
  private rememberedOutdatedTag: Buffer | null = null;
  private lastMillisecondSent: bigint = -1n;
  private sameMsCounter: number = 0;

  private readonly onSendTimerNotify?: (frame: Buffer) => void;
  private readonly nowMs: () => number;
  private readonly randomFn: () => number;

  constructor(options: SecureRoutingTimerOptions) {
    this.backboneKey = parseKey16(options.backboneKey, "backboneKey");
    if (options.serialNumber.length !== 6) {
      throw new Error(`Invalid serialNumber length: ${options.serialNumber.length} (expected 6 bytes)`);
    }
    this.serialNumber = Buffer.from(options.serialNumber);

    this.latencyToleranceMs = options.latencyToleranceMs ?? 2000;
    const fraction = options.syncLatencyFraction ?? 0.1;
    this.syncLatencyToleranceMs = Math.max(1, Math.round(this.latencyToleranceMs * fraction));
    this.initialNotifyMaxDelayMs = options.initialNotifyMaxDelayMs ?? 10000;

    // Calculated delay windows per 03_08_09 §2.2.2.3.2.2
    this.maxDelayTimeKeeperPeriodicNotifyMs = this.minDelayTimeKeeperPeriodicNotifyMs + 3 * this.syncLatencyToleranceMs;
    this.minDelayTimeFollowerPeriodicNotifyMs =
      this.maxDelayTimeKeeperPeriodicNotifyMs + 1 * this.syncLatencyToleranceMs;
    this.maxDelayTimeFollowerPeriodicNotifyMs =
      this.minDelayTimeFollowerPeriodicNotifyMs + 10 * this.syncLatencyToleranceMs;

    this.maxDelayTimeKeeperUpdateNotifyMs = this.minDelayTimeKeeperUpdateNotifyMs + 1 * this.syncLatencyToleranceMs;
    this.minDelayTimeFollowerUpdateNotifyMs = this.maxDelayTimeKeeperUpdateNotifyMs + 1 * this.syncLatencyToleranceMs;
    this.maxDelayTimeFollowerUpdateNotifyMs =
      this.minDelayTimeFollowerUpdateNotifyMs + 10 * this.syncLatencyToleranceMs;

    // Initially time follower
    this.minDelayPeriodicNotifyMs = this.minDelayTimeFollowerPeriodicNotifyMs;
    this.maxDelayPeriodicNotifyMs = this.maxDelayTimeFollowerPeriodicNotifyMs;
    this.minDelayUpdateNotifyMs = this.minDelayTimeFollowerUpdateNotifyMs;
    this.maxDelayUpdateNotifyMs = this.maxDelayTimeFollowerUpdateNotifyMs;

    this.nowMs = options.nowMs ?? (() => Math.floor(performance.now()));
    this.randomFn = options.randomFn ?? (() => Math.random());
    this.onSendTimerNotify = options.onSendTimerNotify;

    this.baseMonotonicMs = this.nowMs();
    if (options.initialTimerValue !== undefined) {
      this.baseTimerValue =
        typeof options.initialTimerValue === "bigint"
          ? options.initialTimerValue
          : BigInt(Math.floor(options.initialTimerValue));
    }
  }

  public get state(): SecureRoutingTimerState {
    return this._state;
  }

  public get isTimeKeeper(): boolean {
    return this._isTimeKeeper;
  }

  /**
   * Returns the current 48-bit monotonic multicast timer value in milliseconds (mc_timer).
   */
  public getTimerValue(): bigint {
    const elapsed = Math.max(0, this.nowMs() - this.baseMonotonicMs);
    const val = this.baseTimerValue + BigInt(elapsed);
    return val > 0xffffffffffffn ? 0xffffffffffffn : val;
  }

  /**
   * Action A1: Sets mc_timer forward to `newTimerValue` (never decreases except on backbone key change).
   */
  public setTimerValueForward(newTimerValue: bigint): void {
    const current = this.getTimerValue();
    if (newTimerValue > current) {
      this.baseTimerValue = newTimerValue;
      this.baseMonotonicMs = this.nowMs();
    }
  }

  /**
   * Starts the multicast timer synchronization (03_08_09 §2.2.2.3.2.8).
   */
  public start(isPowerUp: boolean = true): void {
    this.stop();
    this._state = SecureRoutingTimerState.SCHED_PERIODIC;
    this.becomeTimeFollower();
    const delay = isPowerUp ? this.randomInt(0, this.initialNotifyMaxDelayMs) : 0;
    this.scheduleNotifyTimer(delay);
  }

  public stop(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
  }

  /**
   * Updates the Secure Backbone Key (Events E11 / E12, 03_08_09 §2.2.2.3.2.3).
   * If the key differs from the current key, resets mc_timer to 0 and restarts synchronization (E11 -> A7).
   */
  public setBackboneKey(newKey: Buffer | string): void {
    const parsed = parseKey16(newKey, "backboneKey");
    if (!parsed.equals(this.backboneKey)) {
      this.backboneKey = parsed;
      this.baseTimerValue = 0n;
      this.baseMonotonicMs = this.nowMs();
      this.start(false);
    }
  }

  /**
   * Wraps an outgoing multicast KNXnet/IP frame (e.g. ROUTING_INDICATION) into a SECURE_WRAPPER
   * with SessionID = 0x0000 and triggers event E09.
   */
  public wrapMulticastFrame(innerFrame: Buffer, explicitTag?: Buffer): Buffer {
    const timerVal = this.getTimerValue();
    let tag: Buffer;
    if (explicitTag && explicitTag.length === 2) {
      tag = explicitTag;
    } else {
      tag = crypto.randomBytes(2);
      if (timerVal === this.lastMillisecondSent) {
        this.sameMsCounter = (this.sameMsCounter + 1) & 0xffff;
        tag.writeUInt16BE((tag.readUInt16BE(0) ^ this.sameMsCounter) & 0xffff, 0);
      } else {
        this.lastMillisecondSent = timerVal;
        this.sameMsCounter = 0;
      }
    }

    const wrapped = SecureWrapper.wrap({
      sessionId: 0x0000,
      sequenceNumber: timerVal,
      serialNumber: this.serialNumber,
      messageTag: tag,
      innerFrame,
      key: this.backboneKey,
    });

    // Event E09: Transmitted multicast SECURE_WRAPPER frame
    if (this._state === SecureRoutingTimerState.SCHED_PERIODIC) {
      this.reschedulePeriodic(); // A3
    }
    // Note 3: In SCHED_UPDATE, E09 performs A0 (does not cancel scheduled update notify)

    return wrapped;
  }

  /**
   * Processes an incoming multicast SECURE_WRAPPER (0x0950) frame (Events E05..E08).
   * Returns the decrypted inner KNXnet/IP frame if authentic and within latencyTolerance, or null if discarded.
   */
  public unwrapMulticastFrame(wrapperBuffer: Buffer): Buffer | null {
    const headerInfo = SecureWrapper.parseHeader(wrapperBuffer);
    if (headerInfo.sessionId !== 0x0000) {
      throw new Error(`Invalid multicast SECURE_WRAPPER sessionId: 0x${headerInfo.sessionId.toString(16)}`);
    }

    // For multicast, MAC must be verified BEFORE evaluating timer value (03_08_09 §2.2.1.3.3)
    const unwrapped = SecureWrapper.unwrap(wrapperBuffer, this.backboneKey);
    const receivedTimer = unwrapped.sequenceNumber;
    const localTimer = this.getTimerValue();
    const syncTol = BigInt(this.syncLatencyToleranceMs);
    const latTol = BigInt(this.latencyToleranceMs);

    if (receivedTimer > localTimer) {
      // E05: received_timer_value > mc_timer
      this.setTimerValueForward(receivedTimer); // A1
      if (this._state === SecureRoutingTimerState.SCHED_PERIODIC) {
        this.reschedulePeriodic(); // A3
      }
      return unwrapped.innerFrame; // A2
    }

    if (localTimer - receivedTimer < syncTol) {
      // E06: mc_timer - syncLatencyTolerance < received_timer_value <= mc_timer
      if (this._state === SecureRoutingTimerState.SCHED_PERIODIC) {
        this.reschedulePeriodic(); // A3
      }
      return unwrapped.innerFrame; // A2
    }

    if (localTimer - receivedTimer < latTol) {
      // E07: mc_timer - latencyTolerance < received_timer_value <= mc_timer - syncLatencyTolerance
      return unwrapped.innerFrame; // A2
    }

    // E08: received_timer_value <= mc_timer - latencyTolerance (outdated -> discard frame and schedule update)
    if (this._state === SecureRoutingTimerState.SCHED_PERIODIC) {
      this._state = SecureRoutingTimerState.SCHED_UPDATE;
      this.rememberOutdatedAndScheduleUpdate(unwrapped.serialNumber, unwrapped.messageTag); // A4
    }
    return null;
  }

  /**
   * Processes an incoming TIMER_NOTIFY (0x0955) frame (Events E01..E04).
   * Returns true if the MAC was valid, false otherwise.
   */
  public handleTimerNotify(frameBuffer: Buffer): boolean {
    const notify = TimerNotify.fromBuffer(frameBuffer);
    // Ignore our own looped-back TIMER_NOTIFY if serial matches
    if (notify.serialNumber.equals(this.serialNumber) && notify.timerValue === this.getTimerValue()) {
      return false;
    }
    if (!notify.verifyMac(this.backboneKey)) {
      return false;
    }

    const receivedTimer = notify.timerValue;
    const localTimer = this.getTimerValue();
    const syncTol = BigInt(this.syncLatencyToleranceMs);
    const latTol = BigInt(this.latencyToleranceMs);

    if (receivedTimer > localTimer) {
      // E01: received_timer_value > mc_timer -> SCHED_PERIODIC: A1 + A9 + A3
      this._state = SecureRoutingTimerState.SCHED_PERIODIC;
      this.setTimerValueForward(receivedTimer); // A1
      this.becomeTimeFollower(); // A9
      this.reschedulePeriodic(); // A3
      return true;
    }

    if (localTimer - receivedTimer < syncTol) {
      // E02: mc_timer - syncLatencyTolerance < received_timer_value <= mc_timer -> SCHED_PERIODIC: A9 + A3
      this._state = SecureRoutingTimerState.SCHED_PERIODIC;
      this.becomeTimeFollower(); // A9
      this.reschedulePeriodic(); // A3
      return true;
    }

    if (localTimer - receivedTimer < latTol) {
      // E03: A0 (do nothing)
      return true;
    }

    // E04: received_timer_value <= mc_timer - latencyTolerance
    if (this._state === SecureRoutingTimerState.SCHED_PERIODIC) {
      this._state = SecureRoutingTimerState.SCHED_UPDATE;
      this.rememberOutdatedAndScheduleUpdate(notify.serialNumber, notify.messageTag); // A4
    }
    return true;
  }

  /**
   * Builds a TIMER_NOTIFY (0x0955) frame with the current mc_timer.
   */
  public buildTimerNotifyFrame(serialNumber: Buffer = this.serialNumber, messageTag?: Buffer): Buffer {
    const tag = messageTag ?? crypto.randomBytes(2);
    return TimerNotify.create(this.getTimerValue(), serialNumber, tag, this.backboneKey).toBuffer();
  }

  private onNotifyTimerExpired(): void {
    // Event E10: notify_timer expired
    const prevState = this._state;
    this._state = SecureRoutingTimerState.SCHED_PERIODIC;

    let frame: Buffer;
    if (
      prevState === SecureRoutingTimerState.SCHED_UPDATE &&
      this.rememberedOutdatedSerial &&
      this.rememberedOutdatedTag
    ) {
      // Action A6: Send TIMER_NOTIFY with own mc_timer, but serial number and tag from A4
      frame = this.buildTimerNotifyFrame(this.rememberedOutdatedSerial, this.rememberedOutdatedTag);
      this.rememberedOutdatedSerial = null;
      this.rememberedOutdatedTag = null;
    } else {
      // Action A5: Send TIMER_NOTIFY with own mc_timer, own serial number, and random tag
      frame = this.buildTimerNotifyFrame(this.serialNumber);
    }

    this.becomeTimeKeeper(); // A8
    this.reschedulePeriodic(); // A3

    if (this.onSendTimerNotify) {
      this.onSendTimerNotify(frame);
    }
  }

  private becomeTimeKeeper(): void {
    // Action A8
    this._isTimeKeeper = true;
    this.minDelayUpdateNotifyMs = this.minDelayTimeKeeperUpdateNotifyMs;
    this.maxDelayUpdateNotifyMs = this.maxDelayTimeKeeperUpdateNotifyMs;
    this.minDelayPeriodicNotifyMs = this.minDelayTimeKeeperPeriodicNotifyMs;
    this.maxDelayPeriodicNotifyMs = this.maxDelayTimeKeeperPeriodicNotifyMs;
  }

  private becomeTimeFollower(): void {
    // Action A9
    this._isTimeKeeper = false;
    this.minDelayUpdateNotifyMs = this.minDelayTimeFollowerUpdateNotifyMs;
    this.maxDelayUpdateNotifyMs = this.maxDelayTimeFollowerUpdateNotifyMs;
    this.minDelayPeriodicNotifyMs = this.minDelayTimeFollowerPeriodicNotifyMs;
    this.maxDelayPeriodicNotifyMs = this.maxDelayTimeFollowerPeriodicNotifyMs;
  }

  private reschedulePeriodic(): void {
    // Action A3
    const delay = this.randomInt(this.minDelayPeriodicNotifyMs, this.maxDelayPeriodicNotifyMs);
    this.scheduleNotifyTimer(delay);
  }

  private rememberOutdatedAndScheduleUpdate(serial: Buffer, tag: Buffer): void {
    // Action A4
    this.rememberedOutdatedSerial = Buffer.from(serial);
    this.rememberedOutdatedTag = Buffer.from(tag);
    const delay = this.randomInt(this.minDelayUpdateNotifyMs, this.maxDelayUpdateNotifyMs);
    this.scheduleNotifyTimer(delay);
  }

  private scheduleNotifyTimer(delayMs: number): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
    }
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.onNotifyTimerExpired();
    }, delayMs);
  }

  private randomInt(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.randomFn() * (max - min + 1));
  }
}
