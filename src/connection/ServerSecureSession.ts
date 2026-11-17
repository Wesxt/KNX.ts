import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import { KNXnetIPServiceType, SecureSessionStatus } from "../core/enum/KNXnetIPEnum";
import {
  SecureWrapper,
  SessionAuthenticate,
  SessionResponse,
  SessionStatus,
} from "../core/KNXnetIPSecureStructures";
import { computeSessionKey, generateX25519KeyPair } from "../security/KnxSecureKeys";
import { Logger } from "../utils/Logger";

export enum ServerSecureSessionState {
  UNAUTHENTICATED = "UNAUTHENTICATED",
  AUTHENTICATED = "AUTHENTICATED",
  CLOSED = "CLOSED",
}

export interface ServerSecureSessionOptions {
  sessionId: number;
  serverSerial: Buffer;
  deviceAuthenticationCode: Buffer;
  userPasswordHashes: Map<number, Buffer>;
  authenticationTimeoutMs?: number;
  sessionTimeoutMs?: number;
  onSend: (frame: Buffer) => void;
  onCloseChannels: (sessionId: number) => void;
  onDeallocate: (sessionId: number) => void;
  parentLogger: Logger;
}

export interface AuthenticatedInnerFrame {
  innerFrame: Buffer;
  userId: number;
}

/**
 * Server-side KNXnet/IP Secure Unicast Session State Machine (03_08_09 §2.2.3.5.2).
 *
 * Manages a single ECDH X25519 handshake, AES-128 CCM wrapper encryption/verification,
 * 48-bit monotonic anti-replay sequence counters, single-attempt user authentication,
 * and authentication/session timeouts on top of a TCP connection.
 */
export class ServerSecureSession {
  public readonly sessionId: number;
  private readonly serverSerial: Buffer;
  private readonly deviceAuthenticationCode: Buffer;
  private readonly userPasswordHashes: Map<number, Buffer>;
  private readonly authenticationTimeoutMs: number;
  private readonly sessionTimeoutMs: number;
  private readonly onSend: (frame: Buffer) => void;
  private readonly onCloseChannels: (sessionId: number) => void;
  private readonly onDeallocate: (sessionId: number) => void;
  private readonly logger: Logger;

  private _state: ServerSecureSessionState = ServerSecureSessionState.UNAUTHENTICATED;
  private _userId: number = 0;

  private clientPublicKey: Buffer | null = null;
  private serverPublicKey: Buffer | null = null;
  private sessionKey: Buffer | null = null;

  private txSequence: bigint = 0n;
  private lastRxSequence: bigint = -1n;
  private sessionTimer: NodeJS.Timeout | null = null;

  constructor(options: ServerSecureSessionOptions) {
    if (options.sessionId <= 0 || options.sessionId > 0xffff) {
      throw new Error(`Invalid unicast Secure Session Identifier: ${options.sessionId}`);
    }
    this.sessionId = options.sessionId;
    this.serverSerial = Buffer.from(options.serverSerial);
    this.deviceAuthenticationCode = Buffer.from(options.deviceAuthenticationCode);
    this.userPasswordHashes = options.userPasswordHashes;
    this.authenticationTimeoutMs = options.authenticationTimeoutMs ?? 10000;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? 60000;
    this.onSend = options.onSend;
    this.onCloseChannels = options.onCloseChannels;
    this.onDeallocate = options.onDeallocate;
    this.logger = options.parentLogger.child({ module: "ServerSecureSession", sessionId: this.sessionId });
  }

  public get state(): ServerSecureSessionState {
    return this._state;
  }

  public get userId(): number {
    return this._userId;
  }

  public get isAuthenticated(): boolean {
    return this._state === ServerSecureSessionState.AUTHENTICATED;
  }

  /**
   * Executes Action A0 (03_08_09 §2.2.3.5.2.4):
   * Generates a fresh Curve25519 keypair, derives the shared AES-128 session key,
   * arms timeoutAuthentication (10s), and returns the SESSION_RESPONSE (0x0952) frame.
   */
  public start(clientPublicKey: Buffer): Buffer {
    if (this._state !== ServerSecureSessionState.UNAUTHENTICATED || this.sessionKey !== null) {
      throw new Error(`Cannot start session ${this.sessionId} in state ${this._state}`);
    }

    const { publicKeyRaw, privateKey } = generateX25519KeyPair();
    this.clientPublicKey = Buffer.from(clientPublicKey);
    this.serverPublicKey = Buffer.from(publicKeyRaw);
    this.sessionKey = computeSessionKey(privateKey, this.clientPublicKey);

    this.txSequence = 0n;
    this.lastRxSequence = -1n;
    this.armTimer(this.authenticationTimeoutMs);

    const response = SessionResponse.createAuthenticated(
      this.sessionId,
      this.serverPublicKey,
      this.clientPublicKey,
      this.deviceAuthenticationCode,
    );
    return response.toBuffer();
  }

  /**
   * Wraps an inner KNXnet/IP frame using the session key and increments the 48-bit tx counter.
   */
  public wrap(innerFrame: Buffer, messageTag?: Buffer): Buffer {
    if (!this.sessionKey || this._state === ServerSecureSessionState.CLOSED) {
      throw new Error(`Secure session ${this.sessionId} is not active`);
    }
    if (this.txSequence > 0xffffffffffffn) {
      throw new Error(`Secure session ${this.sessionId} 48-bit tx sequence counter exhausted`);
    }
    const seq = this.txSequence;
    this.txSequence += 1n;

    return SecureWrapper.wrap({
      sessionId: this.sessionId,
      sequenceNumber: seq,
      serialNumber: this.serverSerial,
      messageTag,
      innerFrame,
      key: this.sessionKey,
    });
  }

  /**
   * Processes an incoming SECURE_WRAPPER (0x0950) addressed to this session.
   * Invalid wrappers (MAC failure, replayed sequence, malformed inner header) are ignored per 03_08_09 §2.2.3.5.2.3.
   * Returns `{ innerFrame, userId }` when an inner KNXnet/IP service frame should be dispatched.
   */
  public handleWrappedFrame(wrapperFrame: Buffer): AuthenticatedInnerFrame | null {
    if (this._state === ServerSecureSessionState.CLOSED || !this.sessionKey) {
      return null;
    }

    let innerFrame: Buffer;
    let headerInfo: ReturnType<typeof SecureWrapper.parseHeader>;
    try {
      headerInfo = SecureWrapper.parseHeader(wrapperFrame);
      if (headerInfo.sessionId !== this.sessionId) {
        return null;
      }
      if (this.lastRxSequence >= 0n && headerInfo.sequenceNumber <= this.lastRxSequence) {
        this.logger.warn(
          `Ignoring replayed SECURE_WRAPPER: seq=${headerInfo.sequenceNumber}, last=${this.lastRxSequence}`,
        );
        return null;
      }
      const unwrapped = SecureWrapper.unwrap(wrapperFrame, this.sessionKey);
      this.lastRxSequence = unwrapped.sequenceNumber;
      innerFrame = unwrapped.innerFrame;
    } catch (err: any) {
      this.logger.warn(`Ignoring invalid SECURE_WRAPPER: ${err?.message ?? err}`);
      return null;
    }

    let innerHeader: KNXnetIPHeader;
    try {
      innerHeader = KNXnetIPHeader.fromBuffer(innerFrame);
    } catch (err: any) {
      this.logger.warn(`Ignoring SECURE_WRAPPER with malformed inner header: ${err?.message ?? err}`);
      return null;
    }

    // E01 / E02: SESSION_AUTHENTICATE
    if (innerHeader.serviceType === KNXnetIPServiceType.SESSION_AUTHENTICATE) {
      this.handleSessionAuthenticate(innerFrame);
      return null;
    }

    // E03 / E04 / invalid SESSION_STATUS
    if (innerHeader.serviceType === KNXnetIPServiceType.SESSION_STATUS) {
      this.handleSessionStatus(innerFrame);
      return null;
    }

    // E05: Any frame except SESSION_AUTHENTICATE and SESSION_STATUS
    if (this._state === ServerSecureSessionState.UNAUTHENTICATED) {
      // Action A6
      this.logger.warn(
        `Received inner service 0x${innerHeader.serviceType.toString(16)} while UNAUTHENTICATED; closing session`,
      );
      this.terminateWithStatus(SecureSessionStatus.STATUS_UNAUTHENTICATED, true);
      return null;
    }

    // Action A4: Reset session timeout in AUTHENTICATED state
    this.armTimer(this.sessionTimeoutMs);
    return {
      innerFrame,
      userId: this._userId,
    };
  }

  private handleSessionAuthenticate(innerFrame: Buffer): void {
    // Second authentication attempt in AUTHENTICATED -> E01/E02 -> Action A2 (03_08_09 §2.2.3.5.2.5)
    if (this._state !== ServerSecureSessionState.UNAUTHENTICATED) {
      this.logger.warn(`Unexpected SESSION_AUTHENTICATE in state ${this._state}; closing session`);
      this.terminateWithStatus(SecureSessionStatus.STATUS_AUTHENTICATION_FAILED, true);
      return;
    }

    let auth: SessionAuthenticate;
    try {
      auth = SessionAuthenticate.fromBuffer(innerFrame);
    } catch (err: any) {
      this.logger.warn(`Invalid SESSION_AUTHENTICATE frame: ${err?.message ?? err}`);
      this.terminateWithStatus(SecureSessionStatus.STATUS_AUTHENTICATION_FAILED, false);
      return;
    }

    const userPasswordHash = this.userPasswordHashes.get(auth.userId);
    const verified =
      !!userPasswordHash &&
      !!this.clientPublicKey &&
      !!this.serverPublicKey &&
      auth.verifyMac(this.clientPublicKey, this.serverPublicKey, userPasswordHash);

    if (!verified) {
      // E02 -> Action A2
      this.logger.warn(`Authentication failed for userId=${auth.userId}`);
      this.terminateWithStatus(SecureSessionStatus.STATUS_AUTHENTICATION_FAILED, false);
      return;
    }

    // E01 -> Action A1
    this._state = ServerSecureSessionState.AUTHENTICATED;
    this._userId = auth.userId;
    this.armTimer(this.sessionTimeoutMs);

    try {
      const successFrame = this.wrap(new SessionStatus(SecureSessionStatus.STATUS_AUTHENTICATION_SUCCESS).toBuffer());
      this.onSend(successFrame);
    } catch (err: any) {
      this.logger.error(`Failed to send STATUS_AUTHENTICATION_SUCCESS: ${err?.message ?? err}`);
      this.forceClose();
    }
  }

  private handleSessionStatus(innerFrame: Buffer): void {
    let statusMsg: SessionStatus;
    try {
      statusMsg = SessionStatus.fromBuffer(innerFrame);
    } catch (err: any) {
      this.logger.warn(`Malformed SESSION_STATUS frame: ${err?.message ?? err}`);
      return;
    }

    if (statusMsg.status === SecureSessionStatus.STATUS_CLOSE) {
      // E03 -> Action A3: close contained channels without DISCONNECT_REQUEST, send STATUS_CLOSE, deallocate
      this.terminateWithStatus(SecureSessionStatus.STATUS_CLOSE, true);
      return;
    }

    if (statusMsg.status === SecureSessionStatus.STATUS_KEEPALIVE) {
      if (this._state === ServerSecureSessionState.UNAUTHENTICATED) {
        // E04 in UNAUTHENTICATED -> Action A6
        this.terminateWithStatus(SecureSessionStatus.STATUS_UNAUTHENTICATED, true);
        return;
      }
      // E04 in AUTHENTICATED -> Action A4
      this.armTimer(this.sessionTimeoutMs);
      return;
    }

    if (this._state === ServerSecureSessionState.UNAUTHENTICATED) {
      this.terminateWithStatus(SecureSessionStatus.STATUS_UNAUTHENTICATED, true);
    }
  }

  private handleTimerExpired(): void {
    if (this._state === ServerSecureSessionState.CLOSED) return;
    // E06 -> Action A5
    this.logger.warn(`Secure session timer expired in state ${this._state}`);
    this.terminateWithStatus(SecureSessionStatus.STATUS_TIMEOUT, true);
  }

  private terminateWithStatus(status: SecureSessionStatus, closeChannelsFirst: boolean): void {
    if (this._state === ServerSecureSessionState.CLOSED) return;
    this.clearTimer();

    if (closeChannelsFirst) {
      this.onCloseChannels(this.sessionId);
    }

    try {
      if (this.sessionKey) {
        const frame = this.wrap(new SessionStatus(status).toBuffer());
        this.onSend(frame);
      }
    } catch (err: any) {
      this.logger.debug(`Could not send SESSION_STATUS 0x${status.toString(16)}: ${err?.message ?? err}`);
    }

    if (!closeChannelsFirst) {
      this.onCloseChannels(this.sessionId);
    }

    this._state = ServerSecureSessionState.CLOSED;
    this.clearSecrets();
    this.onDeallocate(this.sessionId);
  }

  /**
   * Immediately closes the session locally (e.g. TCP disconnect or server shutdown) without sending frames.
   */
  public forceClose(): void {
    if (this._state === ServerSecureSessionState.CLOSED) return;
    this._state = ServerSecureSessionState.CLOSED;
    this.clearTimer();
    this.onCloseChannels(this.sessionId);
    this.clearSecrets();
    this.onDeallocate(this.sessionId);
  }

  private armTimer(ms: number): void {
    this.clearTimer();
    if (ms <= 0) return;
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null;
      this.handleTimerExpired();
    }, ms);
  }

  private clearTimer(): void {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  private clearSecrets(): void {
    if (this.sessionKey) {
      this.sessionKey.fill(0);
    }
    this.sessionKey = null;
    this.clientPublicKey = null;
    this.serverPublicKey = null;
    this.txSequence = 0n;
    this.lastRxSequence = -1n;
  }
}
