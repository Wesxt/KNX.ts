import crypto from "node:crypto";
import { FSM } from "./FSM";
import { SecureSessionStatus } from "../core/enum/KNXnetIPEnum";
import {
  SessionRequest,
  SessionResponse,
  SessionAuthenticate,
  SessionStatus,
  SecureWrapper,
} from "../core/KNXnetIPSecureStructures";
import {
  computeSessionKey,
  deriveDeviceAuthenticationCode,
  deriveUserPasswordKey,
  generateX25519KeyPair,
} from "../security/KnxSecureKeys";

export enum SecureSessionState {
  IDLE = "IDLE",
  UNAUTHENTICATED = "UNAUTHENTICATED",
  AUTHENTICATED = "AUTHENTICATED",
  CLOSED = "CLOSED",
}

export enum SecureSessionEvent {
  REQUEST_SENT = "REQUEST_SENT",
  AUTHENTICATED = "AUTHENTICATED",
  CLOSE = "CLOSE",
  RESET = "RESET",
}

export interface SecureSessionConfig {
  userId?: number;
  userPassword: string | Buffer;
  deviceAuthenticationPassword?: string | Buffer;
  requireDeviceAuthentication?: boolean;
  serialNumber?: Buffer;
}

const DEFAULT_CLIENT_SERIAL = Buffer.from("00006b6e7874", "hex"); // "\0\0knxt"

/**
 * Manages a single KNXnet/IP Secure unicast session over TCP (KNX Standard 03_08_09 §2.2.3 & §2.4.1).
 *
 * Enforces ephemeral X25519 key generation per session, mutual authentication (server MAC via
 * Device Authentication Code and client MAC via User Password Hash), 48-bit monotonic sequence numbers,
 * and AES-128-CCM wrapping/unwrapping.
 */
export class SecureSession {
  private readonly fsm: FSM<SecureSessionState, SecureSessionEvent>;
  public readonly userId: number;
  private readonly userPasswordKey: Buffer;
  private readonly deviceAuthCodes: Buffer[] = [];
  public readonly requireDeviceAuthentication: boolean;
  public readonly serialNumber: Buffer;

  private privateKey: crypto.KeyObject | null = null;
  private clientPublicKey: Buffer | null = null;
  private serverPublicKey: Buffer | null = null;
  private sessionKey: Buffer | null = null;
  private _sessionId: number = 0;
  private txSequence: bigint = 0n;
  private lastRxSequence: bigint = -1n;

  constructor(config: SecureSessionConfig) {
    this.userId = config.userId ?? 2;
    if (this.userId <= 0 || this.userId >= 0x80) {
      throw new Error(`Invalid KNX Secure userId ${this.userId}: must be in range 1..127`);
    }
    this.userPasswordKey = deriveUserPasswordKey(config.userPassword);

    if (config.deviceAuthenticationPassword !== undefined) {
      if (Buffer.isBuffer(config.deviceAuthenticationPassword)) {
        this.deviceAuthCodes.push(deriveDeviceAuthenticationCode(config.deviceAuthenticationPassword));
      } else if (config.deviceAuthenticationPassword.length > 0) {
        this.deviceAuthCodes.push(deriveDeviceAuthenticationCode(config.deviceAuthenticationPassword));
        const trimmed = config.deviceAuthenticationPassword.trim();
        if (trimmed.length > 0 && trimmed !== config.deviceAuthenticationPassword) {
          this.deviceAuthCodes.push(deriveDeviceAuthenticationCode(trimmed));
        }
      }
    }

    this.requireDeviceAuthentication = config.requireDeviceAuthentication ?? false;
    if (this.requireDeviceAuthentication && this.deviceAuthCodes.length === 0) {
      throw new Error(
        "requireDeviceAuthentication is enabled, but no deviceAuthenticationPassword was provided",
      );
    }

    if (config.serialNumber) {
      if (config.serialNumber.length !== 6) {
        throw new Error(`Invalid KNX serialNumber length: ${config.serialNumber.length} (expected 6 bytes)`);
      }
      this.serialNumber = Buffer.from(config.serialNumber);
    } else {
      this.serialNumber = Buffer.from(DEFAULT_CLIENT_SERIAL);
    }

    this.fsm = new FSM<SecureSessionState, SecureSessionEvent>(
      SecureSessionState.IDLE,
      {
        [SecureSessionState.IDLE]: {
          [SecureSessionEvent.REQUEST_SENT]: SecureSessionState.UNAUTHENTICATED,
          [SecureSessionEvent.CLOSE]: SecureSessionState.CLOSED,
        },
        [SecureSessionState.UNAUTHENTICATED]: {
          [SecureSessionEvent.AUTHENTICATED]: SecureSessionState.AUTHENTICATED,
          [SecureSessionEvent.CLOSE]: SecureSessionState.CLOSED,
          [SecureSessionEvent.RESET]: SecureSessionState.IDLE,
        },
        [SecureSessionState.AUTHENTICATED]: {
          [SecureSessionEvent.CLOSE]: SecureSessionState.CLOSED,
          [SecureSessionEvent.RESET]: SecureSessionState.IDLE,
        },
        [SecureSessionState.CLOSED]: {
          [SecureSessionEvent.RESET]: SecureSessionState.IDLE,
          [SecureSessionEvent.REQUEST_SENT]: SecureSessionState.UNAUTHENTICATED,
        },
      },
      () => {},
    );
  }

  public get state(): SecureSessionState {
    return this.fsm.state;
  }

  public get sessionId(): number {
    return this._sessionId;
  }

  public get isAuthenticated(): boolean {
    return this.fsm.state === SecureSessionState.AUTHENTICATED && this.sessionKey !== null;
  }

  public get hasSessionKey(): boolean {
    return this.sessionKey !== null && this._sessionId > 0;
  }

  /**
   * Starts a new handshake: forgets any previous session key/counters, generates a fresh
   * Curve25519 key pair (03_08_09 §2.2.3.1.1), and returns the 46-byte SESSION_REQUEST frame.
   */
  public startHandshake(): Buffer {
    this.clearSecrets();
    const { privateKey, publicKeyRaw } = generateX25519KeyPair();
    this.privateKey = privateKey;
    this.clientPublicKey = publicKeyRaw;

    const req = new SessionRequest(this.clientPublicKey);
    this.fsm.transition(SecureSessionEvent.REQUEST_SENT);
    return req.toBuffer();
  }

  /**
   * Processes an incoming SESSION_RESPONSE (0x0952) frame, verifies the server's MAC if a
   * Device Authentication Code is configured, derives the 16-byte Session Key, and returns
   * the wrapped SESSION_AUTHENTICATE (0x0953 inside 0x0950) frame.
   */
  public handleSessionResponse(frame: Buffer): Buffer {
    if (this.fsm.state !== SecureSessionState.UNAUTHENTICATED || !this.privateKey || !this.clientPublicKey) {
      throw new Error(`Unexpected SESSION_RESPONSE in state ${this.fsm.state}`);
    }

    const response = SessionResponse.fromBuffer(frame);

    if (this.deviceAuthCodes.length > 0) {
      const verified = this.deviceAuthCodes.some((code) => response.verifyMac(this.clientPublicKey!, code));
      if (!verified) {
        this.close();
        throw new Error("SESSION_RESPONSE device authentication MAC verification failed");
      }
    } else if (this.requireDeviceAuthentication) {
      this.close();
      throw new Error("SESSION_RESPONSE MAC could not be verified: missing device authentication code");
    }

    this._sessionId = response.sessionId;
    this.serverPublicKey = response.serverPublicKey;
    this.sessionKey = computeSessionKey(this.privateKey, this.serverPublicKey);
    this.txSequence = 0n;
    this.lastRxSequence = -1n;

    const auth = SessionAuthenticate.create(
      this.userId,
      this.clientPublicKey,
      this.serverPublicKey,
      this.userPasswordKey,
    );
    return this.wrap(auth.toBuffer());
  }

  /**
   * Processes an unwrapped SESSION_STATUS (0x0954) frame and updates the session state.
   */
  public handleSessionStatus(innerFrame: Buffer): SecureSessionStatus {
    const statusMsg = SessionStatus.fromBuffer(innerFrame);
    switch (statusMsg.status) {
      case SecureSessionStatus.STATUS_AUTHENTICATION_SUCCESS:
        if (this.fsm.state === SecureSessionState.UNAUTHENTICATED) {
          this.fsm.transition(SecureSessionEvent.AUTHENTICATED);
        }
        break;
      case SecureSessionStatus.STATUS_KEEPALIVE:
        break;
      case SecureSessionStatus.STATUS_AUTHENTICATION_FAILED:
      case SecureSessionStatus.STATUS_UNAUTHENTICATED:
      case SecureSessionStatus.STATUS_TIMEOUT:
      case SecureSessionStatus.STATUS_CLOSE:
        this.close();
        break;
    }
    return statusMsg.status;
  }

  /**
   * Wraps an inner KNXnet/IP frame into a SECURE_WRAPPER (0x0950) using the current session key
   * and increments the 48-bit outgoing sequence counter.
   */
  public wrap(innerFrame: Buffer, messageTag?: Buffer): Buffer {
    if (!this.sessionKey || this._sessionId <= 0) {
      throw new Error("Secure session key not established");
    }
    if (this.txSequence > 0xffffffffffffn) {
      throw new Error("Secure session 48-bit sequence number exhausted");
    }
    const seq = this.txSequence;
    this.txSequence += 1n;

    return SecureWrapper.wrap({
      sessionId: this._sessionId,
      sequenceNumber: seq,
      serialNumber: this.serialNumber,
      messageTag,
      innerFrame,
      key: this.sessionKey,
    });
  }

  /**
   * Validates and decrypts an incoming SECURE_WRAPPER (0x0950) frame for this session.
   * Enforces session ID matching and monotonic sequence number anti-replay (03_08_09 §2.2.1.3.3 & §2.2.3.3).
   */
  public unwrap(wrapperFrame: Buffer): Buffer {
    if (!this.sessionKey || this._sessionId <= 0) {
      throw new Error("Secure session key not established");
    }

    const headerInfo = SecureWrapper.parseHeader(wrapperFrame);
    if (headerInfo.sessionId !== this._sessionId) {
      throw new Error(
        `SECURE_WRAPPER sessionId mismatch: received 0x${headerInfo.sessionId.toString(16)}, expected 0x${this._sessionId.toString(16)}`,
      );
    }
    if (this.lastRxSequence >= 0n && headerInfo.sequenceNumber <= this.lastRxSequence) {
      throw new Error(
        `SECURE_WRAPPER replay detected: seq ${headerInfo.sequenceNumber} <= last ${this.lastRxSequence}`,
      );
    }

    const unwrapped = SecureWrapper.unwrap(wrapperFrame, this.sessionKey);
    this.lastRxSequence = unwrapped.sequenceNumber;
    return unwrapped.innerFrame;
  }

  /**
   * Builds a wrapped SESSION_STATUS (STATUS_KEEPALIVE = 0x04) frame to prevent session timeout.
   */
  public buildKeepAliveFrame(): Buffer {
    const status = new SessionStatus(SecureSessionStatus.STATUS_KEEPALIVE).toBuffer();
    return this.wrap(status);
  }

  /**
   * Builds a wrapped SESSION_STATUS (STATUS_CLOSE = 0x05) frame and closes the local session.
   */
  public buildCloseFrame(): Buffer | null {
    if (!this.sessionKey || this._sessionId <= 0) {
      this.close();
      return null;
    }
    try {
      const status = new SessionStatus(SecureSessionStatus.STATUS_CLOSE).toBuffer();
      const wrapped = this.wrap(status);
      this.close();
      return wrapped;
    } catch {
      this.close();
      return null;
    }
  }

  /**
   * Closes the session and wipes all ephemeral key material.
   */
  public close(): void {
    this.clearSecrets();
    this.fsm.transition(SecureSessionEvent.CLOSE);
  }

  private clearSecrets(): void {
    if (this.sessionKey) {
      this.sessionKey.fill(0);
    }
    this.privateKey = null;
    this.clientPublicKey = null;
    this.serverPublicKey = null;
    this.sessionKey = null;
    this._sessionId = 0;
    this.txSequence = 0n;
    this.lastRxSequence = -1n;
  }
}
