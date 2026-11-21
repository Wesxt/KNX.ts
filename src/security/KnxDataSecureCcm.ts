import crypto from "node:crypto";
import { AddressType } from "../core/enum/EnumControlFieldExtended";
import { KNXHelper } from "../utils/KNXHelper";
import { AES_BLOCK_SIZE, calculateCbcMac, macEquals } from "./KnxCcm";
import { KNX_KEY_SIZE } from "./KnxSecureKeys";

/**
 * Dedicated 10-bit APCI for KNX Data Security (`APCISec = 3F1h`, KNX Standard 03_03_07 §5.2.1.2).
 */
export const APCI_DATA_SECURE = 0x03f1;

/**
 * Length in octets of the truncated CBC-MAC in KNX Data Security (32 bits / 4 octets, 03_03_07 §5.1.3.4.2).
 */
export const DATA_SECURE_MAC_LENGTH = 4;

/**
 * Length in octets of the 48-bit Sequence Number / Random / Challenge / Serial Number fields (03_03_07 §5.3.1).
 */
export const DATA_SECURE_SEQ_LENGTH = 6;

/**
 * Maximum 48-bit Sequence Number value (`FFFFFFFFFFFFh`). Once reached, it shall NOT wrap to 0 (03_03_07 §5.3.1).
 */
export const MAX_SEQ_NR_48 = 0xffffffffffffn;

/**
 * Maximum payload length `q` encodable in the 1-octet `q` field of `B0` (03_03_07 §5.1.3.2 Fig. 100).
 */
export const MAX_DATA_SECURE_PAYLOAD_LENGTH = 255;

/**
 * Security Algorithm Identifier (SAI, bits 6..4 of SCF, 03_03_07 §5.2.1.2 Table 6).
 */
export enum SecurityAlgorithmId {
  /** AES-128-CCM with authentication only (no confidentiality). */
  CCM_AUTH_ONLY = 0,
  /** AES-128-CCM with authentication and confidentiality. */
  CCM_AUTH_CONF = 1,
}

/**
 * Secure Application Layer (S-AL) service type (bits 2..0 of SCF, 03_03_07 §5.1.1 Table 5 & §5.2.1.2 Fig. 106).
 */
export enum SecureAlService {
  /** Secured plain AL-service (`S-A_Data-PDU`, `000b`). */
  S_A_DATA = 0,
  /** Sequence Number synchronisation request (`S-A_Sync_Req-PDU`, `010b`). */
  S_A_SYNC_REQ = 2,
  /** Sequence Number synchronisation response (`S-A_Sync_Res-PDU`, `011b`). */
  S_A_SYNC_RES = 3,
}

/**
 * Decoded Security Control Field (SCF, 1 octet, 03_03_07 §5.2.1.2 Fig. 106).
 */
export interface SecurityControlField {
  /** Bit 7 (`T`): true if protected with Tool Key or FDSK. */
  toolAccess: boolean;
  /** Bits 6..4 (`SAI`): Security Algorithm Identifier. */
  algorithmId: SecurityAlgorithmId;
  /** Bit 3 (`SBC`): true for System Broadcast communication mode, false for "by service". */
  systemBroadcast: boolean;
  /** Bits 2..0 (`S-AL service`): S_A_DATA (0), S_A_SYNC_REQ (2), or S_A_SYNC_RES (3). */
  service: SecureAlService;
}

/**
 * Encodes a {@link SecurityControlField} into its 1-octet wire representation (03_03_07 §5.2.1.2 Fig. 106).
 */
export function encodeScf(scf: SecurityControlField): number {
  const t = scf.toolAccess ? 0x80 : 0x00;
  const sai = (scf.algorithmId & 0x07) << 4;
  const sbc = scf.systemBroadcast ? 0x08 : 0x00;
  const svc = scf.service & 0x07;
  return t | sai | sbc | svc;
}

/**
 * Decodes and validates a 1-octet SCF byte (03_03_07 §5.1.3.4.2, §5.1.3.5.2, §5.2.1.2 Fig. 106).
 * Returns `null` if any reserved/unsupported SAI or S-AL service combination is present.
 */
export function decodeScf(byte: number): SecurityControlField | null {
  const b = byte & 0xff;
  const toolAccess = (b & 0x80) !== 0;
  const algorithmId = (b >> 4) & 0x07;
  const systemBroadcast = (b & 0x08) !== 0;
  const service = b & 0x07;

  if (algorithmId !== SecurityAlgorithmId.CCM_AUTH_ONLY && algorithmId !== SecurityAlgorithmId.CCM_AUTH_CONF) {
    return null;
  }

  if (
    service !== SecureAlService.S_A_DATA &&
    service !== SecureAlService.S_A_SYNC_REQ &&
    service !== SecureAlService.S_A_SYNC_RES
  ) {
    return null;
  }

  // Per 03_03_07 Fig. 106 & §5.3.2, S-A_Sync_Req and S-A_Sync_Res are only defined with SAI = 001b (A+C)
  if (
    (service === SecureAlService.S_A_SYNC_REQ || service === SecureAlService.S_A_SYNC_RES) &&
    algorithmId !== SecurityAlgorithmId.CCM_AUTH_CONF
  ) {
    return null;
  }

  return {
    toolAccess,
    algorithmId,
    systemBroadcast,
    service,
  };
}

/**
 * Encodes a 48-bit unsigned sequence number (`0..0xFFFFFFFFFFFF`) as a 6-octet big-endian Buffer (03_03_07 §5.3.1 Fig. 108).
 */
export function encodeSeqNr48(seq: bigint | number): Buffer {
  const val = typeof seq === "bigint" ? seq : BigInt(Math.trunc(seq));
  if (val < 0n || val > MAX_SEQ_NR_48) {
    throw new RangeError(`KNX Data Secure sequence number out of 48-bit range: ${val.toString()}`);
  }
  const buf = Buffer.alloc(DATA_SECURE_SEQ_LENGTH);
  buf.writeUIntBE(Number(val), 0, DATA_SECURE_SEQ_LENGTH);
  return buf;
}

/**
 * Decodes a 6-octet big-endian Buffer into a 48-bit unsigned BigInt sequence number.
 */
export function decodeSeqNr48(buf: Buffer, offset: number = 0): bigint {
  if (buf.length < offset + DATA_SECURE_SEQ_LENGTH) {
    throw new Error(`Buffer too short for 6-byte sequence number (len=${buf.length}, offset=${offset})`);
  }
  return BigInt(buf.readUIntBE(offset, DATA_SECURE_SEQ_LENGTH));
}

/**
 * Normalizes a KNX address (2-byte Buffer, 16-bit integer, or string like `"1.1.1"` / `"1/0/1"`) to a 2-byte Buffer.
 */
export function normalizeAddress2(addr: string | number | Buffer): Buffer {
  if (Buffer.isBuffer(addr)) {
    if (addr.length !== 2) throw new Error(`Expected 2-byte KNX address buffer, got ${addr.length}`);
    return Buffer.from(addr);
  }
  if (typeof addr === "number") {
    const buf = Buffer.alloc(2);
    buf.writeUInt16BE(addr & 0xffff, 0);
    return buf;
  }
  return KNXHelper.GetAddress_(addr);
}

/**
 * Computes the `AT` octet (`A000EEEEb`) placed at octet 11 of `B0` (03_03_07 §5.1.3.2 Fig. 100).
 *
 * - Bit 7 (`A`): Address Type (`1` = Group, `0` = Individual)
 * - Bits 3..0 (`EEEEb`): Extended Frame Format (`EFF`) if Extended Frame (`FT = 0`), otherwise `0000b`.
 */
export function computeDataSecureAtByte(
  addressType: AddressType | number,
  isExtendedFrame: boolean,
  eff: number = 0,
): number {
  const aBit = addressType === AddressType.GROUP || addressType === 1 ? 0x80 : 0x00;
  const effBits = isExtendedFrame ? eff & 0x0f : 0x00;
  return aBit | effBits;
}

/**
 * Builds the 2-octet `TPCI / APCISec` field placed at octets 12..13 of `B0` (03_03_07 §5.1.3.2 Fig. 101).
 * Bits 15..10 = top 6 bits of `tpciByte`, bits 9..0 = `0x3F1` (`1111110001b`).
 */
export function buildDataSecureTpciApci(tpciByte: number): Buffer {
  return Buffer.from([(tpciByte & 0xfc) | ((APCI_DATA_SECURE >> 8) & 0x03), APCI_DATA_SECURE & 0xff]);
}

/**
 * Builds the 16-octet `B0` block for KNX Data Security CCM (03_03_07 §5.1.3.2 Fig. 100).
 *
 * Layout: `SeqNr/Random(6) | SA(2) | DA(2) | 00h | AT(1) | TPCI/APCISec(2) | 00h | q(1)`
 */
export function buildDataSecureB0(
  seqOrRandom6: Buffer,
  sa2: Buffer,
  da2: Buffer,
  atByte: number,
  tpciApciSec2: Buffer,
  payloadLength: number,
): Buffer {
  if (seqOrRandom6.length !== DATA_SECURE_SEQ_LENGTH) throw new Error("seqOrRandom6 must be 6 bytes");
  if (sa2.length !== 2) throw new Error("sa2 must be 2 bytes");
  if (da2.length !== 2) throw new Error("da2 must be 2 bytes");
  if (tpciApciSec2.length !== 2) throw new Error("tpciApciSec2 must be 2 bytes");
  if (payloadLength < 0 || payloadLength > MAX_DATA_SECURE_PAYLOAD_LENGTH) {
    throw new RangeError(`KNX Data Secure payload length q out of range: ${payloadLength}`);
  }
  return Buffer.concat([
    seqOrRandom6,
    sa2,
    da2,
    Buffer.from([0x00, atByte & 0xff]),
    tpciApciSec2,
    Buffer.from([0x00, payloadLength & 0xff]),
  ]);
}

/**
 * Builds the 16-octet initial counter block `Ctr0` for KNX Data Security CCM (03_03_07 §5.1.3.2 Fig. 102).
 *
 * Layout: `SeqNr/Random(6) | SA(2) | DA(2) | 00h 00h 00h 00h 01h 00h`
 */
export function buildDataSecureCtr0(seqOrRandom6: Buffer, sa2: Buffer, da2: Buffer): Buffer {
  if (seqOrRandom6.length !== DATA_SECURE_SEQ_LENGTH) throw new Error("seqOrRandom6 must be 6 bytes");
  if (sa2.length !== 2) throw new Error("sa2 must be 2 bytes");
  if (da2.length !== 2) throw new Error("da2 must be 2 bytes");
  return Buffer.concat([seqOrRandom6, sa2, da2, Buffer.from([0x00, 0x00, 0x00, 0x00, 0x01, 0x00])]);
}

function aes128EcbBlock(key: Buffer, block16: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block16), cipher.final()]);
}

/**
 * Generates the KNX Data Security CTR keystream blocks `S0` (first 4 bytes for MAC, remaining 12 bytes
 * start payload keystream) followed by `S1..Sn` (03_03_07 Annex A.3 steps 5–7 & Fig. 121).
 */
function generateKeystream(
  key: Buffer,
  ctr0: Buffer,
  payloadLength: number,
): { s0Mac4: Buffer; payloadStream: Buffer } {
  if (key.length !== KNX_KEY_SIZE) throw new Error(`Invalid AES-128 key length: ${key.length}`);
  if (ctr0.length !== AES_BLOCK_SIZE) throw new Error(`Invalid Ctr0 length: ${ctr0.length}`);
  if (payloadLength < 0 || payloadLength > MAX_DATA_SECURE_PAYLOAD_LENGTH) {
    throw new RangeError(`Payload length out of range: ${payloadLength}`);
  }

  const s0 = aes128EcbBlock(key, ctr0);
  const s0Mac4 = Buffer.from(s0.subarray(0, DATA_SECURE_MAC_LENGTH));
  if (payloadLength === 0) {
    return { s0Mac4, payloadStream: Buffer.alloc(0) };
  }

  // S = LSB96(S0) | S1 | S2 | ... | Sn (03_03_07 Annex A.3 step 7)
  const chunks: Buffer[] = [s0.subarray(DATA_SECURE_MAC_LENGTH)];
  let available = AES_BLOCK_SIZE - DATA_SECURE_MAC_LENGTH; // 12 bytes from S0
  let j = 1;
  while (available < payloadLength) {
    const ctrj = Buffer.from(ctr0);
    ctrj[15] = j & 0xff;
    chunks.push(aes128EcbBlock(key, ctrj));
    available += AES_BLOCK_SIZE;
    j++;
  }

  return {
    s0Mac4,
    payloadStream: Buffer.concat(chunks).subarray(0, payloadLength),
  };
}

/**
 * Encrypts a KNX Data Security payload and computes the 4-octet encrypted MAC (03_03_07 Annex A.3 & Fig. 121).
 *
 * - For Authentication + Confidentiality: `A = SCF` (or `SCF | SN`), `P = payload`, `q = P.length`.
 * - For Authentication only: `A = SCF | PlainAPDU`, `P = empty`, `q = 0`.
 */
export function dataSecureCcmEncrypt(
  key: Buffer,
  b0: Buffer,
  ctr0: Buffer,
  additionalData: Buffer,
  payload: Buffer = Buffer.alloc(0),
): { ciphertext: Buffer; mac: Buffer } {
  if (payload.length > MAX_DATA_SECURE_PAYLOAD_LENGTH) {
    throw new RangeError(`KNX Data Secure payload length ${payload.length} exceeds ${MAX_DATA_SECURE_PAYLOAD_LENGTH}`);
  }

  const yn = calculateCbcMac(key, additionalData, payload, b0);
  const { s0Mac4, payloadStream } = generateKeystream(key, ctr0, payload.length);

  const mac = Buffer.alloc(DATA_SECURE_MAC_LENGTH);
  for (let i = 0; i < DATA_SECURE_MAC_LENGTH; i++) {
    mac[i] = yn[i] ^ s0Mac4[i];
  }

  const ciphertext = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    ciphertext[i] = payload[i] ^ payloadStream[i];
  }

  return { ciphertext, mac };
}

/**
 * Decrypts and verifies a KNX Data Security ciphertext + 4-octet encrypted MAC (03_03_07 Annex A.3 Message verification).
 * Returns the decrypted plaintext `P` (empty Buffer for auth-only) if the MAC is valid, or `null` if verification fails.
 */
export function dataSecureCcmDecrypt(
  key: Buffer,
  b0: Buffer,
  ctr0: Buffer,
  additionalData: Buffer,
  ciphertext: Buffer,
  encryptedMac4: Buffer,
): Buffer | null {
  if (encryptedMac4.length !== DATA_SECURE_MAC_LENGTH) return null;
  if (ciphertext.length > MAX_DATA_SECURE_PAYLOAD_LENGTH) return null;

  const { s0Mac4, payloadStream } = generateKeystream(key, ctr0, ciphertext.length);

  const plaintext = Buffer.alloc(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) {
    plaintext[i] = ciphertext[i] ^ payloadStream[i];
  }

  const receivedMac = Buffer.alloc(DATA_SECURE_MAC_LENGTH);
  for (let i = 0; i < DATA_SECURE_MAC_LENGTH; i++) {
    receivedMac[i] = encryptedMac4[i] ^ s0Mac4[i];
  }

  const expectedYn = calculateCbcMac(key, additionalData, plaintext, b0);
  if (!macEquals(expectedYn.subarray(0, DATA_SECURE_MAC_LENGTH), receivedMac)) {
    return null;
  }

  return plaintext;
}

export interface DataSecureFrameContext {
  sourceAddress: string | number | Buffer;
  destinationAddress: string | number | Buffer;
  addressType: AddressType | number;
  isExtendedFrame: boolean;
  eff?: number;
  /** Full first octet of TPDU (bits 7..2 are TPCI; bits 1..0 are ignored and overwritten with `11b` for `0x3F1`). */
  tpciByte: number;
  /**
   * When true (Local TL connection where SA, DA and TL sequence number are unavailable),
   * SA, DA and TPCI in `B0` and `Ctrj` are set to 0 per 03_03_07 §5.1.3.2.
   */
  localTl?: boolean;
}

function resolveB0AndCtr0Inputs(ctx: DataSecureFrameContext): {
  sa2: Buffer;
  da2: Buffer;
  atByte: number;
  tpciApciSec2: Buffer;
} {
  if (ctx.localTl) {
    return {
      sa2: Buffer.alloc(2, 0x00),
      da2: Buffer.alloc(2, 0x00),
      atByte: computeDataSecureAtByte(ctx.addressType, ctx.isExtendedFrame, ctx.eff ?? 0),
      tpciApciSec2: buildDataSecureTpciApci(0x00),
    };
  }
  return {
    sa2: normalizeAddress2(ctx.sourceAddress),
    da2: normalizeAddress2(ctx.destinationAddress),
    atByte: computeDataSecureAtByte(ctx.addressType, ctx.isExtendedFrame, ctx.eff ?? 0),
    tpciApciSec2: buildDataSecureTpciApci(ctx.tpciByte),
  };
}

export interface BuildSADataParams extends DataSecureFrameContext {
  key: Buffer;
  seqNr: bigint | number;
  /** Plain APDU (`000000b | APCI(10 bits) | ASDU`). Top 6 bits of octet 0 are masked to `000000b`. */
  plainApdu: Buffer;
  /** True for Authentication + Confidentiality (`SAI = 1`, default), false for Authentication only (`SAI = 0`). */
  confidentiality?: boolean;
  /** True when secured using Tool Key / FDSK (`SCF.T = 1`). */
  toolAccess?: boolean;
  /** True for System Broadcast (`SCF.SBC = 1`). */
  systemBroadcast?: boolean;
}

export interface BuiltSecurePdu {
  scfByte: number;
  scf: SecurityControlField;
  /** Secure ASDU: `SCF | Secure Data` (the bytes immediately following `TPCI/APCISec`). */
  secureAsdu: Buffer;
  /** Complete TPDU: `TPCI/APCISec(2) | secureAsdu`. */
  tpduBuffer: Buffer;
  mac: Buffer;
}

/**
 * Builds an `S-A_Data-PDU` (Authentication + Confidentiality or Authentication only, 03_03_07 §5.1.3.4–5.1.3.5).
 */
export function buildSADataPdu(params: BuildSADataParams): BuiltSecurePdu {
  const confidentiality = params.confidentiality ?? true;
  if (params.plainApdu.length < 2) {
    throw new Error(`Plain APDU must be at least 2 bytes (got ${params.plainApdu.length})`);
  }

  // Ensure leading 6 bits are 000000b per 03_03_07 §5.1.3.1
  const normalizedPlainApdu = Buffer.from(params.plainApdu);
  normalizedPlainApdu[0] &= 0x03;

  const scf: SecurityControlField = {
    toolAccess: Boolean(params.toolAccess),
    algorithmId: confidentiality ? SecurityAlgorithmId.CCM_AUTH_CONF : SecurityAlgorithmId.CCM_AUTH_ONLY,
    systemBroadcast: Boolean(params.systemBroadcast),
    service: SecureAlService.S_A_DATA,
  };
  const scfByte = encodeScf(scf);
  const seq6 = encodeSeqNr48(params.seqNr);

  const { sa2, da2, atByte, tpciApciSec2 } = resolveB0AndCtr0Inputs(params);
  const ctr0 = buildDataSecureCtr0(seq6, sa2, da2);

  let secureAsdu: Buffer;
  let mac: Buffer;

  if (confidentiality) {
    // 03_03_07 §5.1.3.5.2: A = SCF, P = 000000b | Plain APDU
    const aad = Buffer.from([scfByte]);
    const b0 = buildDataSecureB0(seq6, sa2, da2, atByte, tpciApciSec2, normalizedPlainApdu.length);
    const enc = dataSecureCcmEncrypt(params.key, b0, ctr0, aad, normalizedPlainApdu);
    mac = enc.mac;
    secureAsdu = Buffer.concat([aad, seq6, enc.ciphertext, enc.mac]);
  } else {
    // 03_03_07 §5.1.3.4.2: A = SCF | 000000b | Plain APDU, P = empty (q = 0)
    const aad = Buffer.concat([Buffer.from([scfByte]), normalizedPlainApdu]);
    const b0 = buildDataSecureB0(seq6, sa2, da2, atByte, tpciApciSec2, 0);
    const enc = dataSecureCcmEncrypt(params.key, b0, ctr0, aad, Buffer.alloc(0));
    mac = enc.mac;
    secureAsdu = Buffer.concat([Buffer.from([scfByte]), seq6, normalizedPlainApdu, enc.mac]);
  }

  const wireTpciApci = buildDataSecureTpciApci(params.tpciByte);
  const tpduBuffer = Buffer.concat([wireTpciApci, secureAsdu]);
  return { scfByte, scf, secureAsdu, tpduBuffer, mac };
}

export type ParsedSecureAsduHeader =
  | {
      valid: false;
      reason: string;
    }
  | {
      valid: true;
      service: SecureAlService.S_A_DATA;
      scfByte: number;
      scf: SecurityControlField;
      seqNr: bigint;
      seqNrBuf: Buffer;
      payloadOrCiphertext: Buffer;
      mac: Buffer;
    }
  | {
      valid: true;
      service: SecureAlService.S_A_SYNC_REQ;
      scfByte: number;
      scf: SecurityControlField;
      seqNrLocal: bigint;
      seqNrLocalBuf: Buffer;
      serialNumber: Buffer;
      encryptedChallenge: Buffer;
      mac: Buffer;
    }
  | {
      valid: true;
      service: SecureAlService.S_A_SYNC_RES;
      scfByte: number;
      scf: SecurityControlField;
      challengeXorRandom: Buffer;
      encryptedPayload: Buffer;
      mac: Buffer;
    };

/**
 * Parses the unencrypted header fields of a Secure ASDU (`SCF | Secure Data`, following `TPCI/APCISec`).
 */
export function parseSecureAsduHeader(secureAsdu: Buffer): ParsedSecureAsduHeader {
  if (secureAsdu.length < 1) {
    return { valid: false, reason: "Empty secure ASDU" };
  }
  const scfByte = secureAsdu[0];
  const scf = decodeScf(scfByte);
  if (!scf) {
    return { valid: false, reason: `Unsupported or reserved SCF: 0x${scfByte.toString(16).padStart(2, "0")}` };
  }

  if (scf.service === SecureAlService.S_A_DATA) {
    // Minimum: SCF(1) + SeqNr(6) + PlainAPDU(>=2) + MAC(4) = 13 octets
    if (secureAsdu.length < 1 + DATA_SECURE_SEQ_LENGTH + 2 + DATA_SECURE_MAC_LENGTH) {
      return { valid: false, reason: `S-A_Data ASDU too short (${secureAsdu.length} bytes)` };
    }
    const seqNrBuf = Buffer.from(secureAsdu.subarray(1, 1 + DATA_SECURE_SEQ_LENGTH));
    const seqNr = decodeSeqNr48(seqNrBuf);
    const macStart = secureAsdu.length - DATA_SECURE_MAC_LENGTH;
    const payloadOrCiphertext = Buffer.from(secureAsdu.subarray(1 + DATA_SECURE_SEQ_LENGTH, macStart));
    const mac = Buffer.from(secureAsdu.subarray(macStart));
    return {
      valid: true,
      service: SecureAlService.S_A_DATA,
      scfByte,
      scf,
      seqNr,
      seqNrBuf,
      payloadOrCiphertext,
      mac,
    };
  }

  if (scf.service === SecureAlService.S_A_SYNC_REQ) {
    // Exact length: SCF(1) + SeqNrLocal(6) + SerialNumber(6) + EncChallenge(6) + MAC(4) = 23 octets
    const expectedLen = 1 + 6 + 6 + 6 + DATA_SECURE_MAC_LENGTH;
    if (secureAsdu.length !== expectedLen) {
      return {
        valid: false,
        reason: `Invalid S-A_Sync_Req ASDU length (${secureAsdu.length}, expected ${expectedLen})`,
      };
    }
    const seqNrLocalBuf = Buffer.from(secureAsdu.subarray(1, 7));
    return {
      valid: true,
      service: SecureAlService.S_A_SYNC_REQ,
      scfByte,
      scf,
      seqNrLocal: decodeSeqNr48(seqNrLocalBuf),
      seqNrLocalBuf,
      serialNumber: Buffer.from(secureAsdu.subarray(7, 13)),
      encryptedChallenge: Buffer.from(secureAsdu.subarray(13, 19)),
      mac: Buffer.from(secureAsdu.subarray(19, 23)),
    };
  }

  // S_A_SYNC_RES: Exact length: SCF(1) + (Challenge XOR Random)(6) + Enc(SeqNrRemote(6) | SeqNrLocal(6))(12) + MAC(4) = 23 octets
  const expectedLen = 1 + 6 + 12 + DATA_SECURE_MAC_LENGTH;
  if (secureAsdu.length !== expectedLen) {
    return { valid: false, reason: `Invalid S-A_Sync_Res ASDU length (${secureAsdu.length}, expected ${expectedLen})` };
  }
  return {
    valid: true,
    service: SecureAlService.S_A_SYNC_RES,
    scfByte,
    scf,
    challengeXorRandom: Buffer.from(secureAsdu.subarray(1, 7)),
    encryptedPayload: Buffer.from(secureAsdu.subarray(7, 19)),
    mac: Buffer.from(secureAsdu.subarray(19, 23)),
  };
}

export interface DecryptSADataParams extends DataSecureFrameContext {
  key: Buffer;
  /** Secure ASDU (`SCF | SeqNr(6) | PlainOrCipherAPDU | MAC(4)`). */
  secureAsdu: Buffer;
}

export interface DecryptSADataResult {
  ok: boolean;
  /** True if MAC verified and decryption succeeded (even if leading 6 reserved bits were non-zero). */
  cryptoVerified: boolean;
  /** True if leading 6 reserved bits of Plain APDU are `000000b` per 03_03_07 §5.2.1.4. */
  reservedBitsValid: boolean;
  scf?: SecurityControlField;
  scfByte?: number;
  seqNr?: bigint;
  plainApdu?: Buffer;
  reason?: string;
}

/**
 * Verifies and (if confidential) decrypts an `S-A_Data-PDU` (03_03_07 §5.1.3.4.2, §5.1.3.5.2, §5.2.1.4).
 */
export function decryptSADataPdu(params: DecryptSADataParams): DecryptSADataResult {
  const parsed = parseSecureAsduHeader(params.secureAsdu);
  if (!parsed.valid) {
    return { ok: false, cryptoVerified: false, reservedBitsValid: false, reason: parsed.reason };
  }
  if (parsed.service !== SecureAlService.S_A_DATA) {
    return {
      ok: false,
      cryptoVerified: false,
      reservedBitsValid: false,
      reason: `Expected S_A_DATA service, got ${SecureAlService[parsed.service]}`,
    };
  }

  const { sa2, da2, atByte, tpciApciSec2 } = resolveB0AndCtr0Inputs(params);
  const ctr0 = buildDataSecureCtr0(parsed.seqNrBuf, sa2, da2);

  let plainApdu: Buffer;
  if (parsed.scf.algorithmId === SecurityAlgorithmId.CCM_AUTH_CONF) {
    const aad = Buffer.from([parsed.scfByte]);
    const b0 = buildDataSecureB0(parsed.seqNrBuf, sa2, da2, atByte, tpciApciSec2, parsed.payloadOrCiphertext.length);
    const decrypted = dataSecureCcmDecrypt(params.key, b0, ctr0, aad, parsed.payloadOrCiphertext, parsed.mac);
    if (!decrypted) {
      return {
        ok: false,
        cryptoVerified: false,
        reservedBitsValid: false,
        scf: parsed.scf,
        scfByte: parsed.scfByte,
        seqNr: parsed.seqNr,
        reason: "MAC verification failed",
      };
    }
    plainApdu = decrypted;
  } else {
    // Authentication only: A = SCF | Plain APDU, P = empty
    const aad = Buffer.concat([Buffer.from([parsed.scfByte]), parsed.payloadOrCiphertext]);
    const b0 = buildDataSecureB0(parsed.seqNrBuf, sa2, da2, atByte, tpciApciSec2, 0);
    const verified = dataSecureCcmDecrypt(params.key, b0, ctr0, aad, Buffer.alloc(0), parsed.mac);
    if (!verified) {
      return {
        ok: false,
        cryptoVerified: false,
        reservedBitsValid: false,
        scf: parsed.scf,
        scfByte: parsed.scfByte,
        seqNr: parsed.seqNr,
        reason: "MAC verification failed",
      };
    }
    plainApdu = Buffer.from(parsed.payloadOrCiphertext);
  }

  // 03_03_07 §5.2.1.4: Verify that the 6 leading bits before APCI are 000000b
  const reservedBitsValid = plainApdu.length >= 2 && (plainApdu[0] & 0xfc) === 0x00;
  return {
    ok: reservedBitsValid,
    cryptoVerified: true,
    reservedBitsValid,
    scf: parsed.scf,
    scfByte: parsed.scfByte,
    seqNr: parsed.seqNr,
    plainApdu,
    reason: reservedBitsValid
      ? undefined
      : "Non-zero 6 reserved leading bits in decrypted Plain APDU (03_03_07 §5.2.1.4)",
  };
}

export interface BuildSASyncReqParams extends DataSecureFrameContext {
  key: Buffer;
  seqNrLocal: bigint | number;
  /** 6-octet target KNX Serial Number (required non-zero for broadcast/system broadcast; may be 0 for p2p). */
  serialNumber?: Buffer;
  /** 6-octet challenge N1 (random 6 bytes generated automatically if omitted). */
  challenge?: Buffer;
  /** True for Tool Key / FDSK (`SCF.T = 1`). */
  toolAccess: boolean;
  /** True for Broadcast / System Broadcast sync (`SCF.SBC = 1`), false for point-to-point (`SCF.SBC = 0`). */
  systemBroadcast: boolean;
}

export interface BuiltSASyncReq extends BuiltSecurePdu {
  challenge: Buffer;
  serialNumber: Buffer;
  seqNrLocal: bigint;
}

/**
 * Builds an `S-A_Sync_Req-PDU` (03_03_07 §5.3.2 Fig. 109 & Annex C.1.3).
 */
export function buildSASyncReqPdu(params: BuildSASyncReqParams): BuiltSASyncReq {
  const serialNumber = params.serialNumber ? Buffer.from(params.serialNumber) : Buffer.alloc(6, 0x00);
  if (serialNumber.length !== 6) {
    throw new Error(`KNX Serial Number must be 6 bytes (got ${serialNumber.length})`);
  }
  const challenge = params.challenge ? Buffer.from(params.challenge) : crypto.randomBytes(6);
  if (challenge.length !== 6) {
    throw new Error(`S-A_Sync challenge must be 6 bytes (got ${challenge.length})`);
  }

  const scf: SecurityControlField = {
    toolAccess: params.toolAccess,
    algorithmId: SecurityAlgorithmId.CCM_AUTH_CONF,
    systemBroadcast: params.systemBroadcast,
    service: SecureAlService.S_A_SYNC_REQ,
  };
  const scfByte = encodeScf(scf);
  const seq6 = encodeSeqNr48(params.seqNrLocal);

  const { sa2, da2, atByte, tpciApciSec2 } = resolveB0AndCtr0Inputs(params);
  // 03_03_07 §5.3.2: A = SCF | KNX Serial Number, P = Challenge
  const aad = Buffer.concat([Buffer.from([scfByte]), serialNumber]);
  const b0 = buildDataSecureB0(seq6, sa2, da2, atByte, tpciApciSec2, challenge.length);
  const ctr0 = buildDataSecureCtr0(seq6, sa2, da2);

  const enc = dataSecureCcmEncrypt(params.key, b0, ctr0, aad, challenge);
  const secureAsdu = Buffer.concat([Buffer.from([scfByte]), seq6, serialNumber, enc.ciphertext, enc.mac]);
  const tpduBuffer = Buffer.concat([buildDataSecureTpciApci(params.tpciByte), secureAsdu]);

  return {
    scfByte,
    scf,
    secureAsdu,
    tpduBuffer,
    mac: enc.mac,
    challenge,
    serialNumber,
    seqNrLocal: decodeSeqNr48(seq6),
  };
}

export interface DecryptSASyncReqParams extends DataSecureFrameContext {
  key: Buffer;
  secureAsdu: Buffer;
}

export interface DecryptSASyncReqResult {
  ok: boolean;
  scf?: SecurityControlField;
  scfByte?: number;
  seqNrLocal?: bigint;
  serialNumber?: Buffer;
  challenge?: Buffer;
  reason?: string;
}

/**
 * Verifies and decrypts an `S-A_Sync_Req-PDU` (03_03_07 §5.3.2).
 */
export function decryptSASyncReqPdu(params: DecryptSASyncReqParams): DecryptSASyncReqResult {
  const parsed = parseSecureAsduHeader(params.secureAsdu);
  if (!parsed.valid) return { ok: false, reason: parsed.reason };
  if (parsed.service !== SecureAlService.S_A_SYNC_REQ) {
    return { ok: false, reason: `Expected S_A_SYNC_REQ, got ${SecureAlService[parsed.service]}` };
  }

  const { sa2, da2, atByte, tpciApciSec2 } = resolveB0AndCtr0Inputs(params);
  const aad = Buffer.concat([Buffer.from([parsed.scfByte]), parsed.serialNumber]);
  const b0 = buildDataSecureB0(parsed.seqNrLocalBuf, sa2, da2, atByte, tpciApciSec2, parsed.encryptedChallenge.length);
  const ctr0 = buildDataSecureCtr0(parsed.seqNrLocalBuf, sa2, da2);

  const challenge = dataSecureCcmDecrypt(params.key, b0, ctr0, aad, parsed.encryptedChallenge, parsed.mac);
  if (!challenge) {
    return { ok: false, scf: parsed.scf, scfByte: parsed.scfByte, reason: "MAC verification failed" };
  }

  return {
    ok: true,
    scf: parsed.scf,
    scfByte: parsed.scfByte,
    seqNrLocal: parsed.seqNrLocal,
    serialNumber: parsed.serialNumber,
    challenge,
  };
}

export interface BuildSASyncResParams extends DataSecureFrameContext {
  key: Buffer;
  /** Original 6-byte Challenge from the `S-A_Sync_Req-PDU`. */
  challenge: Buffer;
  /** 6-byte Random value generated by the responder (random 6 bytes generated automatically if omitted). */
  random?: Buffer;
  /** Responder's own `Sequence Number Sending` (`SeqNrremote`). */
  seqNrRemote: bigint | number;
  /** Next valid Sequence Number expected from requester (`SeqNrlocal`). */
  seqNrLocal: bigint | number;
  toolAccess: boolean;
  systemBroadcast: boolean;
}

export interface BuiltSASyncRes extends BuiltSecurePdu {
  random: Buffer;
  challengeXorRandom: Buffer;
  seqNrRemote: bigint;
  seqNrLocal: bigint;
}

/**
 * Builds an `S-A_Sync_Res-PDU` (03_03_07 §5.3.2 Fig. 110 & Annex C.1.4).
 */
export function buildSASyncResPdu(params: BuildSASyncResParams): BuiltSASyncRes {
  if (params.challenge.length !== 6) {
    throw new Error(`Challenge must be 6 bytes (got ${params.challenge.length})`);
  }
  const random = params.random ? Buffer.from(params.random) : crypto.randomBytes(6);
  if (random.length !== 6) {
    throw new Error(`Random must be 6 bytes (got ${random.length})`);
  }

  const challengeXorRandom = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    challengeXorRandom[i] = params.challenge[i] ^ random[i];
  }

  const scf: SecurityControlField = {
    toolAccess: params.toolAccess,
    algorithmId: SecurityAlgorithmId.CCM_AUTH_CONF,
    systemBroadcast: params.systemBroadcast,
    service: SecureAlService.S_A_SYNC_RES,
  };
  const scfByte = encodeScf(scf);
  const seqRemote6 = encodeSeqNr48(params.seqNrRemote);
  const seqLocal6 = encodeSeqNr48(params.seqNrLocal);
  const payload = Buffer.concat([seqRemote6, seqLocal6]);

  const { sa2, da2, atByte, tpciApciSec2 } = resolveB0AndCtr0Inputs(params);
  // 03_03_07 §5.3.2: A = SCF, P = SeqNrremote | SeqNrlocal, B0 & Ctr0 use Random (6 bytes)
  const aad = Buffer.from([scfByte]);
  const b0 = buildDataSecureB0(random, sa2, da2, atByte, tpciApciSec2, payload.length);
  const ctr0 = buildDataSecureCtr0(random, sa2, da2);

  const enc = dataSecureCcmEncrypt(params.key, b0, ctr0, aad, payload);
  const secureAsdu = Buffer.concat([aad, challengeXorRandom, enc.ciphertext, enc.mac]);
  const tpduBuffer = Buffer.concat([buildDataSecureTpciApci(params.tpciByte), secureAsdu]);

  return {
    scfByte,
    scf,
    secureAsdu,
    tpduBuffer,
    mac: enc.mac,
    random,
    challengeXorRandom,
    seqNrRemote: decodeSeqNr48(seqRemote6),
    seqNrLocal: decodeSeqNr48(seqLocal6),
  };
}

export interface DecryptSASyncResParams extends DataSecureFrameContext {
  key: Buffer;
  /** Original 6-byte Challenge sent in the initiating `S-A_Sync_Req-PDU`. */
  challenge: Buffer;
  secureAsdu: Buffer;
}

export interface DecryptSASyncResResult {
  ok: boolean;
  scf?: SecurityControlField;
  scfByte?: number;
  random?: Buffer;
  seqNrRemote?: bigint;
  seqNrLocal?: bigint;
  reason?: string;
}

/**
 * Verifies and decrypts an `S-A_Sync_Res-PDU` using the original `challenge` (03_03_07 §5.3.2 & Annex C.1.4).
 */
export function decryptSASyncResPdu(params: DecryptSASyncResParams): DecryptSASyncResResult {
  if (params.challenge.length !== 6) {
    return { ok: false, reason: `Challenge must be 6 bytes (got ${params.challenge.length})` };
  }
  const parsed = parseSecureAsduHeader(params.secureAsdu);
  if (!parsed.valid) return { ok: false, reason: parsed.reason };
  if (parsed.service !== SecureAlService.S_A_SYNC_RES) {
    return { ok: false, reason: `Expected S_A_SYNC_RES, got ${SecureAlService[parsed.service]}` };
  }

  const random = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    random[i] = parsed.challengeXorRandom[i] ^ params.challenge[i];
  }

  const { sa2, da2, atByte, tpciApciSec2 } = resolveB0AndCtr0Inputs(params);
  const aad = Buffer.from([parsed.scfByte]);
  const b0 = buildDataSecureB0(random, sa2, da2, atByte, tpciApciSec2, parsed.encryptedPayload.length);
  const ctr0 = buildDataSecureCtr0(random, sa2, da2);

  const plaintext = dataSecureCcmDecrypt(params.key, b0, ctr0, aad, parsed.encryptedPayload, parsed.mac);
  if (!plaintext || plaintext.length !== 12) {
    return { ok: false, scf: parsed.scf, scfByte: parsed.scfByte, reason: "MAC verification failed" };
  }

  return {
    ok: true,
    scf: parsed.scf,
    scfByte: parsed.scfByte,
    random,
    seqNrRemote: decodeSeqNr48(plaintext, 0),
    seqNrLocal: decodeSeqNr48(plaintext, 6),
  };
}
