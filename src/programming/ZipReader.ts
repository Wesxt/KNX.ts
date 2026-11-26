import crypto from "node:crypto";
import fs from "node:fs";
import { Readable } from "node:stream";
import zlib from "node:zlib";

export interface ZipEntryInfo {
  fileName: string;
  flags: number;
  compressionMethod: number;
  modTime: number;
  modDate: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  isDirectory: boolean;
  isEncrypted: boolean;
  /** WinZip AES header version (1 = AE-1, 2 = AE-2) when compressionMethod === 99. */
  aesVersion?: number;
  /** WinZip AES key strength (1 = 128-bit, 2 = 192-bit, 3 = 256-bit) when compressionMethod === 99. */
  aesStrength?: number;
  /** Underlying compression method (0 = Store, 8 = Deflate) when compressionMethod === 99. */
  aesActualCompressionMethod?: number;
}

const SIG_LOCAL_FILE_HEADER = 0x04034b50;
const SIG_CENTRAL_DIR_HEADER = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;

// Precomputed standard IEEE 802.3 CRC-32 lookup table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Fast table-driven IEEE 802.3 CRC-32 computation.
 */
export function computeCrc32(buf: Buffer, initialCrc: number = 0): number {
  let crc = (initialCrc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32Byte(crc: number, byte: number): number {
  return (CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
}

/**
 * Derives the ETS6 (schema >= 21) password string used for WinZip AES-256 encrypted inner `P-XXXX.zip` archives.
 * ETS6 runs PBKDF2-HMAC-SHA256 over UTF-16LE password with salt `"21.ets.knx.org"` (65536 iterations, 32 bytes)
 * and uses the Base64 encoding as the WinZip AES password.
 */
export function deriveEts6ZipPassword(password: string): string {
  return crypto
    .pbkdf2Sync(Buffer.from(password, "utf16le"), Buffer.from("21.ets.knx.org", "ascii"), 65536, 32, "sha256")
    .toString("base64");
}

/**
 * Decrypts a PKWARE Traditional (ZipCrypto) encrypted payload (used by ETS5 password-protected `P-XXXX.zip`).
 */
function decryptZipCrypto(encrypted: Buffer, password: string | Buffer, entry: ZipEntryInfo): Buffer {
  if (encrypted.length < 12) {
    throw new Error(`Invalid ZipCrypto entry "${entry.fileName}": payload shorter than 12-byte header`);
  }
  const pwdBytes = Buffer.isBuffer(password) ? password : Buffer.from(password, "utf8");
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;

  const updateKeys = (byte: number) => {
    k0 = crc32Byte(k0, byte);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = crc32Byte(k2, (k1 >>> 24) & 0xff);
  };

  const decryptByte = (): number => {
    const temp = (k2 | 2) & 0xffff;
    return ((temp * (temp ^ 1)) >>> 8) & 0xff;
  };

  for (let i = 0; i < pwdBytes.length; i++) {
    updateKeys(pwdBytes[i]);
  }

  // Decrypt 12-byte encryption header
  let lastHeaderByte = 0;
  for (let i = 0; i < 12; i++) {
    const plain = encrypted[i] ^ decryptByte();
    updateKeys(plain);
    lastHeaderByte = plain;
  }

  // Verify check byte: high byte of CRC32 (or high byte of modTime when bit 3 data descriptor flag is set)
  const expectedCheckByte = (entry.flags & 0x0008) !== 0 ? (entry.modTime >>> 8) & 0xff : (entry.crc32 >>> 24) & 0xff;
  if (lastHeaderByte !== expectedCheckByte) {
    throw new Error(`Invalid ZIP password for ZipCrypto entry "${entry.fileName}"`);
  }

  const out = Buffer.allocUnsafe(encrypted.length - 12);
  for (let i = 12; i < encrypted.length; i++) {
    const plain = encrypted[i] ^ decryptByte();
    updateKeys(plain);
    out[i - 12] = plain;
  }
  return out;
}

/**
 * Decrypts a WinZip AES (AE-1 / AE-2, method 99) encrypted payload (used by ETS6 password-protected `P-XXXX.zip`).
 */
function decryptWinZipAes(encrypted: Buffer, password: string | Buffer, entry: ZipEntryInfo): Buffer {
  const strength = entry.aesStrength ?? 3;
  const keyLen = strength === 1 ? 16 : strength === 2 ? 24 : 32;
  const saltLen = keyLen / 2; // 8, 12, or 16 bytes
  const overhead = saltLen + 2 + 10; // salt + pwdVerify(2) + hmac(10)
  if (encrypted.length < overhead) {
    throw new Error(`Invalid WinZip AES entry "${entry.fileName}": payload too short`);
  }

  const salt = encrypted.subarray(0, saltLen);
  const pwdVerify = encrypted.subarray(saltLen, saltLen + 2);
  const cipherText = encrypted.subarray(saltLen + 2, encrypted.length - 10);
  const authCode = encrypted.subarray(encrypted.length - 10);

  const pwdBuf = Buffer.isBuffer(password) ? password : Buffer.from(password, "utf8");
  const derived = crypto.pbkdf2Sync(pwdBuf, salt, 1000, keyLen * 2 + 2, "sha1");
  const encKey = derived.subarray(0, keyLen);
  const hmacKey = derived.subarray(keyLen, keyLen * 2);
  const expectedVerify = derived.subarray(keyLen * 2, keyLen * 2 + 2);

  if (!crypto.timingSafeEqual(pwdVerify, expectedVerify)) {
    throw new Error(`Invalid ZIP password for WinZip AES entry "${entry.fileName}"`);
  }

  // Verify HMAC-SHA1 truncated to 10 bytes
  const hmac = crypto.createHmac("sha1", hmacKey).update(cipherText).digest().subarray(0, 10);
  if (!crypto.timingSafeEqual(authCode, hmac)) {
    throw new Error(`WinZip AES authentication failed for entry "${entry.fileName}"`);
  }

  // WinZip AES uses AES-CTR with a 16-byte little-endian block counter starting at 1
  const algo = strength === 1 ? "aes-128-ecb" : strength === 2 ? "aes-192-ecb" : "aes-256-ecb";
  const plain = Buffer.allocUnsafe(cipherText.length);
  const counterBlock = Buffer.alloc(16, 0);
  const ecb = crypto.createCipheriv(algo, encKey, null);
  ecb.setAutoPadding(false);

  let blockCounter = 1n;
  for (let off = 0; off < cipherText.length; off += 16) {
    counterBlock.writeBigUInt64LE(blockCounter & 0xffffffffffffffffn, 0);
    counterBlock.writeBigUInt64LE((blockCounter >> 64n) & 0xffffffffffffffffn, 8);
    blockCounter += 1n;
    const keystream = ecb.update(counterBlock);
    const chunkLen = Math.min(16, cipherText.length - off);
    for (let j = 0; j < chunkLen; j++) {
      plain[off + j] = cipherText[off + j] ^ keystream[j];
    }
  }

  return plain;
}

/**
 * Zero-dependency ZIP archive reader built on Node's native `zlib` and `crypto`.
 * Supports standard ZIP, ZIP64 (Store and Deflate entries), raw compressed passthrough,
 * and password-protected entries (PKWARE ZipCrypto and WinZip AES-128/192/256), such as
 * ETS `.knxprod` and `.knxproj` (including encrypted ETS5/ETS6 `P-XXXX.zip`) archives.
 */
export class ZipReader {
  private readonly buffer: Buffer;
  private readonly entries: Map<string, ZipEntryInfo> = new Map();

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.parseCentralDirectory();
  }

  public static fromFile(filePath: string): ZipReader {
    return new ZipReader(fs.readFileSync(filePath));
  }

  public static fromBuffer(buffer: Buffer): ZipReader {
    return new ZipReader(buffer);
  }

  public listEntries(): ZipEntryInfo[] {
    return Array.from(this.entries.values());
  }

  public getEntry(fileName: string): ZipEntryInfo | undefined {
    const exact = this.entries.get(fileName);
    if (exact) return exact;
    const normalized = fileName.replace(/\\/g, "/");
    return this.entries.get(normalized);
  }

  public hasEntry(fileName: string): boolean {
    return this.getEntry(fileName) !== undefined;
  }

  /**
   * Returns raw compressed payload slice for an entry.
   */
  private getCompressedSlice(entry: ZipEntryInfo): Buffer {
    const off = entry.localHeaderOffset;
    if (off + 30 > this.buffer.length || this.buffer.readUInt32LE(off) !== SIG_LOCAL_FILE_HEADER) {
      throw new Error(`Invalid ZIP local file header for entry "${entry.fileName}" at offset ${off}`);
    }
    const nameLen = this.buffer.readUInt16LE(off + 26);
    const extraLen = this.buffer.readUInt16LE(off + 28);
    const dataStart = off + 30 + nameLen + extraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > this.buffer.length) {
      throw new Error(`ZIP entry "${entry.fileName}" exceeds archive bounds`);
    }
    return this.buffer.subarray(dataStart, dataEnd);
  }

  /**
   * Exposes the entry metadata and raw compressed payload slice so `ZipWriter.copyEntryFrom()`
   * can copy large untouched files (e.g. 60 MB manufacturer XMLs) without decompressing/recompressing.
   */
  public getRawCompressedEntry(fileName: string): { entry: ZipEntryInfo; compressedData: Buffer } {
    const entry = this.getEntry(fileName);
    if (!entry) {
      throw new Error(`ZIP entry not found: "${fileName}"`);
    }
    return {
      entry,
      compressedData: entry.isDirectory ? Buffer.alloc(0) : this.getCompressedSlice(entry),
    };
  }

  /**
   * Synchronously reads and decompresses an entry into a `Buffer`.
   * Supports unencrypted entries as well as ZipCrypto and WinZip AES encrypted entries when `password` is supplied.
   */
  public readEntryBuffer(fileName: string, password?: string | Buffer): Buffer {
    const entry = this.getEntry(fileName);
    if (!entry) {
      throw new Error(`ZIP entry not found: "${fileName}"`);
    }
    if (entry.isDirectory) {
      return Buffer.alloc(0);
    }

    let payload = this.getCompressedSlice(entry);
    let method = entry.compressionMethod;

    if (entry.isEncrypted) {
      if (password === undefined) {
        throw new Error(`ZIP entry "${entry.fileName}" is encrypted and requires a password`);
      }
      if (entry.compressionMethod === 99) {
        payload = decryptWinZipAes(payload, password, entry);
        method = entry.aesActualCompressionMethod ?? 8;
      } else {
        payload = decryptZipCrypto(payload, password, entry);
      }
    }

    if (method === 0) {
      return Buffer.from(payload);
    }
    if (method === 8) {
      return zlib.inflateRawSync(payload);
    }
    throw new Error(`Unsupported ZIP compression method ${method} for "${entry.fileName}"`);
  }

  /**
   * Synchronously reads an entry as a UTF-8 string (stripping UTF-8 BOM if present).
   */
  public readEntryText(fileName: string, password?: string | Buffer): string {
    const text = this.readEntryBuffer(fileName, password).toString("utf8");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /**
   * Opens a Readable stream of decompressed bytes for large XML entries (e.g. 64 MB ApplicationProgram XMLs).
   */
  public createEntryStream(fileName: string, chunkSize: number = 64 * 1024, password?: string | Buffer): Readable {
    const entry = this.getEntry(fileName);
    if (!entry) {
      throw new Error(`ZIP entry not found: "${fileName}"`);
    }

    if (entry.isEncrypted) {
      const decrypted = this.readEntryBuffer(fileName, password);
      return Readable.from([decrypted]);
    }

    const slice = this.getCompressedSlice(entry);
    const source = new Readable({
      read() {},
    });

    // Feed compressed chunks incrementally so inflate does not materialize the entire 64 MB XML at once
    let offset = 0;
    const pushNext = () => {
      while (offset < slice.length) {
        const end = Math.min(offset + chunkSize, slice.length);
        const chunk = slice.subarray(offset, end);
        offset = end;
        if (!source.push(chunk)) {
          return;
        }
      }
      source.push(null);
    };
    source._read = pushNext;

    if (entry.compressionMethod === 0) {
      return source;
    }
    if (entry.compressionMethod === 8) {
      const inflater = zlib.createInflateRaw({ chunkSize });
      source.pipe(inflater);
      return inflater;
    }
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for "${entry.fileName}"`);
  }

  private parseCentralDirectory(): void {
    const buf = this.buffer;
    if (buf.length < 22) {
      throw new Error("Invalid ZIP archive: file too small");
    }

    // Scan backwards for End of Central Directory (max comment length = 65535)
    const minPos = Math.max(0, buf.length - 22 - 65535);
    let eocdOffset = -1;
    for (let pos = buf.length - 22; pos >= minPos; pos--) {
      if (buf.readUInt32LE(pos) === SIG_EOCD) {
        const commentLen = buf.readUInt16LE(pos + 20);
        if (pos + 22 + commentLen === buf.length) {
          eocdOffset = pos;
          break;
        }
      }
    }
    if (eocdOffset === -1) {
      throw new Error("Invalid ZIP archive: End of Central Directory record not found");
    }

    let entryCount = buf.readUInt16LE(eocdOffset + 10);
    let cdSize = buf.readUInt32LE(eocdOffset + 12);
    let cdOffset = buf.readUInt32LE(eocdOffset + 16);

    // Handle ZIP64 EOCD locator if present immediately before EOCD
    if (
      (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) &&
      eocdOffset >= 20 &&
      buf.readUInt32LE(eocdOffset - 20) === SIG_ZIP64_EOCD_LOCATOR
    ) {
      const zip64EocdOffset = Number(buf.readBigUInt64LE(eocdOffset - 12));
      if (zip64EocdOffset + 56 <= buf.length && buf.readUInt32LE(zip64EocdOffset) === SIG_ZIP64_EOCD) {
        entryCount = Number(buf.readBigUInt64LE(zip64EocdOffset + 32));
        cdSize = Number(buf.readBigUInt64LE(zip64EocdOffset + 40));
        cdOffset = Number(buf.readBigUInt64LE(zip64EocdOffset + 48));
      }
    }

    let cursor = cdOffset;
    const cdEnd = Math.min(buf.length, cdOffset + cdSize);

    for (let i = 0; i < entryCount && cursor + 46 <= cdEnd; i++) {
      if (buf.readUInt32LE(cursor) !== SIG_CENTRAL_DIR_HEADER) {
        break;
      }
      const flags = buf.readUInt16LE(cursor + 8);
      const compressionMethod = buf.readUInt16LE(cursor + 10);
      const modTime = buf.readUInt16LE(cursor + 12);
      const modDate = buf.readUInt16LE(cursor + 14);
      const crc32 = buf.readUInt32LE(cursor + 16);
      let compressedSize = buf.readUInt32LE(cursor + 20);
      let uncompressedSize = buf.readUInt32LE(cursor + 24);
      const nameLen = buf.readUInt16LE(cursor + 28);
      const extraLen = buf.readUInt16LE(cursor + 30);
      const commentLen = buf.readUInt16LE(cursor + 32);
      let localHeaderOffset = buf.readUInt32LE(cursor + 42);

      const nameStart = cursor + 46;
      const encoding = (flags & 0x0800) !== 0 ? "utf8" : "utf8";
      const fileName = buf
        .subarray(nameStart, nameStart + nameLen)
        .toString(encoding)
        .replace(/\\/g, "/");

      let aesVersion: number | undefined;
      let aesStrength: number | undefined;
      let aesActualCompressionMethod: number | undefined;

      // Parse ZIP64 (0x0001) and WinZip AES (0x9901) extra fields
      if (extraLen > 0) {
        let ex = nameStart + nameLen;
        const exEnd = ex + extraLen;
        while (ex + 4 <= exEnd) {
          const headerId = buf.readUInt16LE(ex);
          const dataSize = buf.readUInt16LE(ex + 2);
          ex += 4;
          if (headerId === 0x0001) {
            let p = ex;
            if (uncompressedSize === 0xffffffff && p + 8 <= ex + dataSize) {
              uncompressedSize = Number(buf.readBigUInt64LE(p));
              p += 8;
            }
            if (compressedSize === 0xffffffff && p + 8 <= ex + dataSize) {
              compressedSize = Number(buf.readBigUInt64LE(p));
              p += 8;
            }
            if (localHeaderOffset === 0xffffffff && p + 8 <= ex + dataSize) {
              localHeaderOffset = Number(buf.readBigUInt64LE(p));
            }
          } else if (headerId === 0x9901 && dataSize >= 7 && ex + 7 <= exEnd) {
            // WinZip AES extra data record:
            // uint16 version (1=AE-1, 2=AE-2), char[2] "AE", uint8 strength (1/2/3), uint16 actualMethod
            aesVersion = buf.readUInt16LE(ex);
            aesStrength = buf.readUInt8(ex + 4);
            aesActualCompressionMethod = buf.readUInt16LE(ex + 5);
          }
          ex += dataSize;
        }
      }

      this.entries.set(fileName, {
        fileName,
        flags,
        compressionMethod,
        modTime,
        modDate,
        compressedSize,
        uncompressedSize,
        crc32,
        localHeaderOffset,
        isDirectory: fileName.endsWith("/"),
        isEncrypted: (flags & 0x0001) !== 0 || compressionMethod === 99,
        aesVersion,
        aesStrength,
        aesActualCompressionMethod,
      });

      cursor = nameStart + nameLen + extraLen + commentLen;
    }
  }
}
