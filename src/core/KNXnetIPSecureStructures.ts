import { KNXnetIPHeader } from "./KNXnetIPHeader";
import { HPAI } from "./KNXnetIPStructures";
import { KNXnetIPServiceType, HostProtocolCode, SecureSessionStatus } from "./enum/KNXnetIPEnum";
import {
  buildNonceB0,
  buildNonceCtr0,
  ccmComputeAuthMac,
  ccmDecrypt,
  ccmEncrypt,
  ccmVerifyAuthMac,
  SESSION_AUTH_B0,
  SESSION_AUTH_CTR0,
} from "../security/KnxCcm";
import { xorPublicKeys } from "../security/KnxSecureKeys";

export const SECURE_WRAPPER_OVERHEAD = 38; // Header(6) + SessionID(2) + Seq(6) + Serial(6) + Tag(2) + MAC(16)
export const SECURE_WRAPPER_MIN_LENGTH = 44; // 38 + minimum 6-byte inner KNXnet/IP Header
export const SESSION_REQUEST_LENGTH = 46;
export const SESSION_RESPONSE_LENGTH = 56;
export const SESSION_AUTHENTICATE_LENGTH = 24;
export const SESSION_STATUS_LENGTH = 8;
export const TIMER_NOTIFY_LENGTH = 36;

export function writeUInt48BE(value: bigint | number): Buffer {
  const buf = Buffer.alloc(6);
  const big = typeof value === "bigint" ? value : BigInt(Math.floor(value));
  buf.writeUInt16BE(Number((big >> 32n) & 0xffffn), 0);
  buf.writeUInt32BE(Number(big & 0xffffffffn), 2);
  return buf;
}

export function readUInt48BE(buffer: Buffer, offset: number = 0): bigint {
  const high = BigInt(buffer.readUInt16BE(offset));
  const low = BigInt(buffer.readUInt32BE(offset + 2));
  return (high << 32n) | low;
}

/**
 * SESSION_REQUEST (0x0951) frame (03_08_09 §2.2.3.6).
 */
export class SessionRequest {
  public readonly hpai: HPAI;
  public readonly clientPublicKey: Buffer;

  constructor(clientPublicKey: Buffer, hpai: HPAI = HPAI.NULL_TCP_HPAI) {
    if (clientPublicKey.length !== 32) {
      throw new Error(`Invalid client ECDH public key length: ${clientPublicKey.length} (expected 32)`);
    }
    this.hpai = hpai;
    this.clientPublicKey = Buffer.from(clientPublicKey);
  }

  public toBuffer(): Buffer {
    const hpaiBuf = this.hpai.toBuffer();
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.SESSION_REQUEST,
      KNXnetIPHeader.HEADER_SIZE_10 + hpaiBuf.length + 32,
    );
    return Buffer.concat([header.toBuffer(), hpaiBuf, this.clientPublicKey]);
  }

  public static fromBuffer(buffer: Buffer, strictTcpRouteBack: boolean = true): SessionRequest {
    if (buffer.length !== SESSION_REQUEST_LENGTH) {
      throw new Error(`Invalid SESSION_REQUEST length: ${buffer.length} (expected ${SESSION_REQUEST_LENGTH})`);
    }
    const header = KNXnetIPHeader.fromBuffer(buffer);
    if (header.serviceType !== KNXnetIPServiceType.SESSION_REQUEST || header.totalLength !== SESSION_REQUEST_LENGTH) {
      throw new Error("Invalid SESSION_REQUEST header");
    }
    const hpai = HPAI.fromBuffer(buffer.subarray(6, 14));
    if (
      strictTcpRouteBack &&
      (hpai.protocol !== HostProtocolCode.IPV4_TCP || hpai.ipAddress !== "0.0.0.0" || hpai.port !== 0)
    ) {
      throw new Error("SESSION_REQUEST must contain a TCP route-back HPAI (0.0.0.0:0)");
    }
    const clientPublicKey = buffer.subarray(14, 46);
    return new SessionRequest(clientPublicKey, hpai);
  }
}

/**
 * SESSION_RESPONSE (0x0952) frame (03_08_09 §2.2.3.7).
 */
export class SessionResponse {
  public readonly sessionId: number;
  public readonly serverPublicKey: Buffer;
  public readonly mac: Buffer;

  constructor(sessionId: number, serverPublicKey: Buffer, mac: Buffer) {
    if (sessionId <= 0 || sessionId > 0xffff) {
      throw new Error(`Invalid unicast Secure Session Identifier: ${sessionId}`);
    }
    if (serverPublicKey.length !== 32) {
      throw new Error(`Invalid server ECDH public key length: ${serverPublicKey.length} (expected 32)`);
    }
    if (mac.length !== 16) {
      throw new Error(`Invalid SESSION_RESPONSE MAC length: ${mac.length} (expected 16)`);
    }
    this.sessionId = sessionId;
    this.serverPublicKey = Buffer.from(serverPublicKey);
    this.mac = Buffer.from(mac);
  }

  public static createAuthenticated(
    sessionId: number,
    serverPublicKey: Buffer,
    clientPublicKey: Buffer,
    deviceAuthCode16: Buffer,
  ): SessionResponse {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.SESSION_RESPONSE, SESSION_RESPONSE_LENGTH);
    const sidBuf = Buffer.alloc(2);
    sidBuf.writeUInt16BE(sessionId, 0);
    const xorKeys = xorPublicKeys(clientPublicKey, serverPublicKey);
    const aad = Buffer.concat([header.toBuffer(), sidBuf, xorKeys]);
    const mac = ccmComputeAuthMac(deviceAuthCode16, aad, SESSION_AUTH_CTR0, SESSION_AUTH_B0);
    return new SessionResponse(sessionId, serverPublicKey, mac);
  }

  public verifyMac(clientPublicKey: Buffer, deviceAuthCode16: Buffer): boolean {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.SESSION_RESPONSE, SESSION_RESPONSE_LENGTH);
    const sidBuf = Buffer.alloc(2);
    sidBuf.writeUInt16BE(this.sessionId, 0);
    const xorKeys = xorPublicKeys(clientPublicKey, this.serverPublicKey);
    const aad = Buffer.concat([header.toBuffer(), sidBuf, xorKeys]);
    return ccmVerifyAuthMac(deviceAuthCode16, aad, this.mac, SESSION_AUTH_CTR0, SESSION_AUTH_B0);
  }

  public toBuffer(): Buffer {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.SESSION_RESPONSE, SESSION_RESPONSE_LENGTH);
    const sidBuf = Buffer.alloc(2);
    sidBuf.writeUInt16BE(this.sessionId, 0);
    return Buffer.concat([header.toBuffer(), sidBuf, this.serverPublicKey, this.mac]);
  }

  public static fromBuffer(buffer: Buffer): SessionResponse {
    if (buffer.length !== SESSION_RESPONSE_LENGTH) {
      throw new Error(`Invalid SESSION_RESPONSE length: ${buffer.length} (expected ${SESSION_RESPONSE_LENGTH})`);
    }
    const header = KNXnetIPHeader.fromBuffer(buffer);
    if (header.serviceType !== KNXnetIPServiceType.SESSION_RESPONSE || header.totalLength !== SESSION_RESPONSE_LENGTH) {
      throw new Error("Invalid SESSION_RESPONSE header");
    }
    const sessionId = buffer.readUInt16BE(6);
    const serverPublicKey = buffer.subarray(8, 40);
    const mac = buffer.subarray(40, 56);
    return new SessionResponse(sessionId, serverPublicKey, mac);
  }
}

/**
 * SESSION_AUTHENTICATE (0x0953) frame (03_08_09 §2.2.3.8).
 */
export class SessionAuthenticate {
  public readonly userId: number;
  public readonly mac: Buffer;

  constructor(userId: number, mac: Buffer) {
    if (userId <= 0 || userId >= 0x80) {
      throw new Error(`Invalid KNX Secure User ID: ${userId} (must be in range 0x01..0x7F)`);
    }
    if (mac.length !== 16) {
      throw new Error(`Invalid SESSION_AUTHENTICATE MAC length: ${mac.length} (expected 16)`);
    }
    this.userId = userId;
    this.mac = Buffer.from(mac);
  }

  public static create(
    userId: number,
    clientPublicKey: Buffer,
    serverPublicKey: Buffer,
    userPasswordHash16: Buffer,
  ): SessionAuthenticate {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.SESSION_AUTHENTICATE, SESSION_AUTHENTICATE_LENGTH);
    const xorKeys = xorPublicKeys(clientPublicKey, serverPublicKey);
    const aad = Buffer.concat([header.toBuffer(), Buffer.from([0x00, userId]), xorKeys]);
    const mac = ccmComputeAuthMac(userPasswordHash16, aad, SESSION_AUTH_CTR0, SESSION_AUTH_B0);
    return new SessionAuthenticate(userId, mac);
  }

  public verifyMac(clientPublicKey: Buffer, serverPublicKey: Buffer, userPasswordHash16: Buffer): boolean {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.SESSION_AUTHENTICATE, SESSION_AUTHENTICATE_LENGTH);
    const xorKeys = xorPublicKeys(clientPublicKey, serverPublicKey);
    const aad = Buffer.concat([header.toBuffer(), Buffer.from([0x00, this.userId]), xorKeys]);
    return ccmVerifyAuthMac(userPasswordHash16, aad, this.mac, SESSION_AUTH_CTR0, SESSION_AUTH_B0);
  }

  public toBuffer(): Buffer {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.SESSION_AUTHENTICATE, SESSION_AUTHENTICATE_LENGTH);
    return Buffer.concat([header.toBuffer(), Buffer.from([0x00, this.userId]), this.mac]);
  }

  public static fromBuffer(buffer: Buffer): SessionAuthenticate {
    if (buffer.length !== SESSION_AUTHENTICATE_LENGTH) {
      throw new Error(
        `Invalid SESSION_AUTHENTICATE length: ${buffer.length} (expected ${SESSION_AUTHENTICATE_LENGTH})`,
      );
    }
    const header = KNXnetIPHeader.fromBuffer(buffer);
    if (
      header.serviceType !== KNXnetIPServiceType.SESSION_AUTHENTICATE ||
      header.totalLength !== SESSION_AUTHENTICATE_LENGTH
    ) {
      throw new Error("Invalid SESSION_AUTHENTICATE header");
    }
    const reserved = buffer.readUInt8(6);
    if (reserved !== 0x00) {
      throw new Error(`Invalid SESSION_AUTHENTICATE reserved byte: 0x${reserved.toString(16)}`);
    }
    const userId = buffer.readUInt8(7);
    const mac = buffer.subarray(8, 24);
    return new SessionAuthenticate(userId, mac);
  }
}

/**
 * SESSION_STATUS (0x0954) frame (03_08_09 §2.2.3.9).
 * Always encodes to 8 octets per specification; accepts 7 or 8 octets on decoding for compatibility
 * with gateways that omit the trailing reserved octet.
 */
export class SessionStatus {
  constructor(public readonly status: SecureSessionStatus) {}

  public toBuffer(): Buffer {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.SESSION_STATUS, SESSION_STATUS_LENGTH);
    return Buffer.concat([header.toBuffer(), Buffer.from([this.status & 0xff, 0x00])]);
  }

  public static fromBuffer(buffer: Buffer): SessionStatus {
    if (buffer.length !== SESSION_STATUS_LENGTH && buffer.length !== 7) {
      throw new Error(`Invalid SESSION_STATUS length: ${buffer.length} (expected 8 or 7)`);
    }
    const header = KNXnetIPHeader.fromBuffer(buffer);
    if (header.serviceType !== KNXnetIPServiceType.SESSION_STATUS || header.totalLength !== buffer.length) {
      throw new Error("Invalid SESSION_STATUS header");
    }
    if (buffer.length === 8 && buffer.readUInt8(7) !== 0x00) {
      throw new Error("Invalid SESSION_STATUS reserved byte");
    }
    return new SessionStatus(buffer.readUInt8(6) as SecureSessionStatus);
  }
}

/**
 * TIMER_NOTIFY (0x0955) frame (03_08_09 §2.2.2.4).
 */
export class TimerNotify {
  public readonly timerValue: bigint;
  public readonly serialNumber: Buffer;
  public readonly messageTag: Buffer;
  public readonly mac: Buffer;

  constructor(timerValue: bigint | number, serialNumber: Buffer, messageTag: Buffer, mac: Buffer) {
    if (serialNumber.length !== 6) throw new Error("serialNumber must be 6 bytes");
    if (messageTag.length !== 2) throw new Error("messageTag must be 2 bytes");
    if (mac.length !== 16) throw new Error("MAC must be 16 bytes");
    this.timerValue = typeof timerValue === "bigint" ? timerValue : BigInt(Math.floor(timerValue));
    this.serialNumber = Buffer.from(serialNumber);
    this.messageTag = Buffer.from(messageTag);
    this.mac = Buffer.from(mac);
  }

  public static create(
    timerValue: bigint | number,
    serialNumber: Buffer,
    messageTag: Buffer,
    backboneKey16: Buffer,
  ): TimerNotify {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.TIMER_NOTIFY, TIMER_NOTIFY_LENGTH);
    const timerBuf = writeUInt48BE(timerValue);
    const b0 = buildNonceB0(timerBuf, serialNumber, messageTag, 0);
    const ctr0 = buildNonceCtr0(timerBuf, serialNumber, messageTag);
    const mac = ccmComputeAuthMac(backboneKey16, header.toBuffer(), ctr0, b0);
    return new TimerNotify(timerValue, serialNumber, messageTag, mac);
  }

  public verifyMac(backboneKey16: Buffer): boolean {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.TIMER_NOTIFY, TIMER_NOTIFY_LENGTH);
    const timerBuf = writeUInt48BE(this.timerValue);
    const b0 = buildNonceB0(timerBuf, this.serialNumber, this.messageTag, 0);
    const ctr0 = buildNonceCtr0(timerBuf, this.serialNumber, this.messageTag);
    return ccmVerifyAuthMac(backboneKey16, header.toBuffer(), this.mac, ctr0, b0);
  }

  public toBuffer(): Buffer {
    const header = new KNXnetIPHeader(KNXnetIPServiceType.TIMER_NOTIFY, TIMER_NOTIFY_LENGTH);
    return Buffer.concat([header.toBuffer(), writeUInt48BE(this.timerValue), this.serialNumber, this.messageTag, this.mac]);
  }

  public static fromBuffer(buffer: Buffer): TimerNotify {
    if (buffer.length !== TIMER_NOTIFY_LENGTH) {
      throw new Error(`Invalid TIMER_NOTIFY length: ${buffer.length} (expected ${TIMER_NOTIFY_LENGTH})`);
    }
    const header = KNXnetIPHeader.fromBuffer(buffer);
    if (header.serviceType !== KNXnetIPServiceType.TIMER_NOTIFY || header.totalLength !== TIMER_NOTIFY_LENGTH) {
      throw new Error("Invalid TIMER_NOTIFY header");
    }
    const timerValue = readUInt48BE(buffer, 6);
    const serialNumber = buffer.subarray(12, 18);
    const messageTag = buffer.subarray(18, 20);
    const mac = buffer.subarray(20, 36);
    return new TimerNotify(timerValue, serialNumber, messageTag, mac);
  }
}

export interface WrapFrameParams {
  sessionId: number;
  sequenceNumber: bigint | number;
  serialNumber: Buffer;
  messageTag?: Buffer;
  innerFrame: Buffer;
  key: Buffer;
}

export interface UnwrappedSecureFrame {
  sessionId: number;
  sequenceNumber: bigint;
  serialNumber: Buffer;
  messageTag: Buffer;
  innerFrame: Buffer;
}

/**
 * SECURE_WRAPPER (0x0950) frame (03_08_09 §2.2.1.3).
 */
export class SecureWrapper {
  public static readonly DEFAULT_UNICAST_TAG = Buffer.from([0x00, 0x00]);

  /**
   * Encrypts and wraps a plain KNXnet/IP frame into a SECURE_WRAPPER (0x0950) buffer.
   */
  public static wrap(params: WrapFrameParams): Buffer {
    const { sessionId, sequenceNumber, serialNumber, innerFrame, key } = params;
    const messageTag = params.messageTag ?? SecureWrapper.DEFAULT_UNICAST_TAG;

    if (innerFrame.length < KNXnetIPHeader.HEADER_SIZE_10) {
      throw new Error(`Inner KNXnet/IP frame too short: ${innerFrame.length}`);
    }
    // Nested SECURE_WRAPPER is forbidden (03_08_09 §2.2.1.2.2.2)
    const innerService = innerFrame.readUInt16BE(2);
    if (innerService === KNXnetIPServiceType.SECURE_WRAPPER) {
      throw new Error("Cannot nest a SECURE_WRAPPER inside another SECURE_WRAPPER");
    }

    const totalLength = SECURE_WRAPPER_OVERHEAD + innerFrame.length;
    const header = new KNXnetIPHeader(KNXnetIPServiceType.SECURE_WRAPPER, totalLength);
    const sidBuf = Buffer.alloc(2);
    sidBuf.writeUInt16BE(sessionId, 0);

    const seqBuf = writeUInt48BE(sequenceNumber);
    const aad = Buffer.concat([header.toBuffer(), sidBuf]);
    const b0 = buildNonceB0(seqBuf, serialNumber, messageTag, innerFrame.length);
    const ctr0 = buildNonceCtr0(seqBuf, serialNumber, messageTag);

    const { ciphertext, mac } = ccmEncrypt(key, ctr0, b0, aad, innerFrame);
    return Buffer.concat([header.toBuffer(), sidBuf, seqBuf, serialNumber, messageTag, ciphertext, mac]);
  }

  /**
   * Parses the unencrypted header and security metadata of a SECURE_WRAPPER without decrypting it yet.
   * Useful for checking session ID and unicast sequence number before MAC evaluation (03_08_09 §2.2.1.3.3).
   */
  public static parseHeader(buffer: Buffer): {
    totalLength: number;
    sessionId: number;
    sequenceNumber: bigint;
    serialNumber: Buffer;
    messageTag: Buffer;
    ciphertext: Buffer;
    mac: Buffer;
  } {
    if (buffer.length < SECURE_WRAPPER_MIN_LENGTH) {
      throw new Error(
        `SECURE_WRAPPER too short: ${buffer.length} (minimum ${SECURE_WRAPPER_MIN_LENGTH} octets)`,
      );
    }
    const header = KNXnetIPHeader.fromBuffer(buffer);
    if (header.serviceType !== KNXnetIPServiceType.SECURE_WRAPPER || header.totalLength !== buffer.length) {
      throw new Error("Invalid SECURE_WRAPPER header");
    }
    const sessionId = buffer.readUInt16BE(6);
    const sequenceNumber = readUInt48BE(buffer, 8);
    const serialNumber = Buffer.from(buffer.subarray(14, 20));
    const messageTag = Buffer.from(buffer.subarray(20, 22));
    const ciphertext = buffer.subarray(22, buffer.length - 16);
    const mac = buffer.subarray(buffer.length - 16);

    return {
      totalLength: header.totalLength,
      sessionId,
      sequenceNumber,
      serialNumber,
      messageTag,
      ciphertext,
      mac,
    };
  }

  /**
   * Decrypts and verifies a SECURE_WRAPPER (0x0950) buffer.
   * Throws an Error if the frame is malformed, MAC verification fails, or the inner frame is invalid/nested.
   */
  public static unwrap(buffer: Buffer, key: Buffer): UnwrappedSecureFrame {
    const parsed = SecureWrapper.parseHeader(buffer);
    const seqBuf = buffer.subarray(8, 14);
    const aad = buffer.subarray(0, 8); // Header(6) + SessionID(2)
    const b0 = buildNonceB0(seqBuf, parsed.serialNumber, parsed.messageTag, parsed.ciphertext.length);
    const ctr0 = buildNonceCtr0(seqBuf, parsed.serialNumber, parsed.messageTag);

    const innerFrame = ccmDecrypt(key, ctr0, b0, aad, parsed.ciphertext, parsed.mac);
    if (!innerFrame) {
      throw new Error("SECURE_WRAPPER MAC verification failed");
    }

    // Validate inner KNXnet/IP header and reject nested SECURE_WRAPPER
    const innerHeader = KNXnetIPHeader.fromBuffer(innerFrame);
    if (innerHeader.totalLength !== innerFrame.length) {
      throw new Error("Decrypted inner KNXnet/IP frame has mismatched totalLength");
    }
    if (innerHeader.serviceType === KNXnetIPServiceType.SECURE_WRAPPER) {
      throw new Error("Nested SECURE_WRAPPER frames are forbidden");
    }

    return {
      sessionId: parsed.sessionId,
      sequenceNumber: parsed.sequenceNumber,
      serialNumber: parsed.serialNumber,
      messageTag: parsed.messageTag,
      innerFrame,
    };
  }
}
