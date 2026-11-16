import crypto from "node:crypto";

export const AES_BLOCK_SIZE = 16;
export const MAX_CCM_PAYLOAD_LENGTH = 255 * AES_BLOCK_SIZE; // 4080 octets (03_08_09 §2.2.1.3.2)

/**
 * Pads a buffer with trailing 0x00 bytes to a multiple of 16 bytes.
 */
export function pad16(buffer: Buffer): Buffer {
  const rem = buffer.length % AES_BLOCK_SIZE;
  if (rem === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(AES_BLOCK_SIZE - rem, 0)]);
}

/**
 * Constant-time comparison of two MAC buffers.
 */
export function macEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Builds the 16-byte B0 block for SECURE_WRAPPER or TIMER_NOTIFY.
 * Layout (03_08_09 Fig. 8 & Fig. 12): SeqOrTimer(6) | SerialNr(6) | Tag(2) | PayloadLength(2 BE)
 */
export function buildNonceB0(seqOrTimer6: Buffer, serial6: Buffer, tag2: Buffer, payloadLength: number): Buffer {
  if (seqOrTimer6.length !== 6) throw new Error("seqOrTimer must be 6 bytes");
  if (serial6.length !== 6) throw new Error("serialNumber must be 6 bytes");
  if (tag2.length !== 2) throw new Error("messageTag must be 2 bytes");
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(payloadLength, 0);
  return Buffer.concat([seqOrTimer6, serial6, tag2, lenBuf]);
}

/**
 * Builds the 16-byte initial counter block Ctr0 for SECURE_WRAPPER or TIMER_NOTIFY.
 * Layout (03_08_09 Fig. 9 & Fig. 13): SeqOrTimer(6) | SerialNr(6) | Tag(2) | 0xFF | 0x00
 */
export function buildNonceCtr0(seqOrTimer6: Buffer, serial6: Buffer, tag2: Buffer): Buffer {
  if (seqOrTimer6.length !== 6) throw new Error("seqOrTimer must be 6 bytes");
  if (serial6.length !== 6) throw new Error("serialNumber must be 6 bytes");
  if (tag2.length !== 2) throw new Error("messageTag must be 2 bytes");
  return Buffer.concat([seqOrTimer6, serial6, tag2, Buffer.from([0xff, 0x00])]);
}

/**
 * Fixed B0 (16 zero bytes) used for SESSION_RESPONSE and SESSION_AUTHENTICATE (03_08_09 Fig. 16 & 19).
 */
export const SESSION_AUTH_B0 = Buffer.alloc(16, 0x00);

/**
 * Fixed Ctr0 (14 zero bytes + 0xFF00) used for SESSION_RESPONSE and SESSION_AUTHENTICATE (03_08_09 Fig. 17 & 20).
 */
export const SESSION_AUTH_CTR0 = Buffer.from("0000000000000000000000000000ff00", "hex");

/**
 * Calculates the raw 16-byte CBC-MAC (Y_n) according to KNX Standard 03_08_09 §2.2.1.3.2 & Annex A.
 *
 * Block layout fed to AES-128-CBC (with zero IV):
 *   B0 (16B) || pad16( uint16BE(additionalData.length) || additionalData || payload )
 */
export function calculateCbcMac(
  key: Buffer,
  additionalData: Buffer,
  payload: Buffer = Buffer.alloc(0),
  b0: Buffer = SESSION_AUTH_B0,
): Buffer {
  if (key.length !== 16) throw new Error(`Invalid AES-128 key length: ${key.length}`);
  if (b0.length !== 16) throw new Error(`Invalid B0 length: ${b0.length}`);

  const aadLen = Buffer.alloc(2);
  aadLen.writeUInt16BE(additionalData.length, 0);

  const blocks = pad16(Buffer.concat([b0, aadLen, additionalData, payload]));
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  cipher.setAutoPadding(false);

  const encrypted = Buffer.concat([cipher.update(blocks), cipher.final()]);
  return Buffer.from(encrypted.subarray(encrypted.length - AES_BLOCK_SIZE));
}

/**
 * Encrypts a payload and its CBC-MAC using KNX AES-128-CCM (03_08_09 §2.2.1.3.2).
 *
 * Ctr_0 encrypts the CBC-MAC; Ctr_1..Ctr_k encrypt the payload blocks.
 */
export function ccmEncrypt(
  key: Buffer,
  ctr0: Buffer,
  b0: Buffer,
  additionalData: Buffer,
  payload: Buffer = Buffer.alloc(0),
): { ciphertext: Buffer; mac: Buffer } {
  if (payload.length > MAX_CCM_PAYLOAD_LENGTH) {
    throw new Error(`CCM payload length ${payload.length} exceeds maximum ${MAX_CCM_PAYLOAD_LENGTH}`);
  }
  const cbcMac = calculateCbcMac(key, additionalData, payload, b0);
  const ctr = crypto.createCipheriv("aes-128-ctr", key, ctr0);
  const mac = Buffer.from(ctr.update(cbcMac));
  const ciphertext = Buffer.from(Buffer.concat([ctr.update(payload), ctr.final()]));
  return { ciphertext, mac };
}

/**
 * Decrypts and authenticates a KNX AES-128-CCM ciphertext + encrypted MAC.
 * Returns the decrypted plaintext Buffer if the MAC is valid, or null if MAC verification fails.
 */
export function ccmDecrypt(
  key: Buffer,
  ctr0: Buffer,
  b0: Buffer,
  additionalData: Buffer,
  ciphertext: Buffer,
  encryptedMac: Buffer,
): Buffer | null {
  if (encryptedMac.length !== AES_BLOCK_SIZE) return null;
  if (ciphertext.length > MAX_CCM_PAYLOAD_LENGTH) return null;

  const ctr = crypto.createDecipheriv("aes-128-ctr", key, ctr0);
  const receivedCbcMac = Buffer.from(ctr.update(encryptedMac));
  const plaintext = Buffer.from(Buffer.concat([ctr.update(ciphertext), ctr.final()]));

  const expectedCbcMac = calculateCbcMac(key, additionalData, plaintext, b0);
  if (!macEquals(expectedCbcMac, receivedCbcMac)) {
    return null;
  }
  return plaintext;
}

/**
 * Computes the 16-byte encrypted CCM-MAC for authentication-only frames
 * (SESSION_RESPONSE, SESSION_AUTHENTICATE, TIMER_NOTIFY) where payload is empty.
 */
export function ccmComputeAuthMac(
  key: Buffer,
  additionalData: Buffer,
  ctr0: Buffer = SESSION_AUTH_CTR0,
  b0: Buffer = SESSION_AUTH_B0,
): Buffer {
  return ccmEncrypt(key, ctr0, b0, additionalData, Buffer.alloc(0)).mac;
}

/**
 * Verifies the 16-byte encrypted CCM-MAC of an authentication-only frame.
 */
export function ccmVerifyAuthMac(
  key: Buffer,
  additionalData: Buffer,
  encryptedMac: Buffer,
  ctr0: Buffer = SESSION_AUTH_CTR0,
  b0: Buffer = SESSION_AUTH_B0,
): boolean {
  return ccmDecrypt(key, ctr0, b0, additionalData, Buffer.alloc(0), encryptedMac) !== null;
}
