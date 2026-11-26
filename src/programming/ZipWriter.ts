import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { computeCrc32, ZipReader } from "./ZipReader";

const SIG_LOCAL_FILE_HEADER = 0x04034b50;
const SIG_CENTRAL_DIR_HEADER = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_EOCD_LOCATOR = 0x07064b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;

// Precomputed CRC32 byte table for PKWARE ZipCrypto key schedule
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32Byte(crc: number, byte: number): number {
  return (CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
}

export interface ZipEntryEncryptionOptions {
  /** Encryption algorithm: `"aes-256"` (WinZip AE-2, ETS6) or `"zipcrypto"` (PKWARE legacy, ETS5). */
  method: "aes-256" | "zipcrypto";
  /** Password string or raw bytes. For ETS6 `P-XXXX.zip`, pass `deriveEts6ZipPassword(password)`. */
  password: string | Buffer;
}

export interface ZipWriteEntryOptions {
  /** Compress with raw DEFLATE (default: `true`). Set `false` for Store (method 0). */
  compress?: boolean;
  /** zlib compression level `1..9` (default: `6`). */
  level?: number;
  /** Last modification timestamp written into DOS header fields (default: `new Date()`). */
  modDate?: Date;
  /** Optional entry encryption (WinZip AES-256 AE-2 or PKWARE ZipCrypto). */
  encryption?: ZipEntryEncryptionOptions;
}

export interface ZipRawEntryMeta {
  compressionMethod: number;
  uncompressedSize: number;
  crc32: number;
  modTime?: number;
  modDate?: number;
  flags?: number;
  extraField?: Buffer;
  minVersion?: number;
}

interface PendingZipEntry {
  fileName: string;
  compressionMethod: number;
  flags: number;
  modTime: number;
  modDate: number;
  crc32: number;
  compressedData: Buffer;
  uncompressedSize: number;
  isDirectory: boolean;
  extraField: Buffer;
  minVersion: number;
}

function encodeDosDateTime(date: Date = new Date()): { modTime: number; modDate: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const modTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const modDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { modTime, modDate };
}

function normalizeZipPath(fileName: string): string {
  return fileName.replace(/\\/g, "/").replace(/^\/+/, "");
}

function encryptZipCryptoPayload(plainCompressed: Buffer, crc32: number, password: string | Buffer): Buffer {
  const pwdBytes = Buffer.isBuffer(password) ? password : Buffer.from(password, "utf8");
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;

  const updateKeys = (byte: number) => {
    k0 = crc32Byte(k0, byte);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = crc32Byte(k2, (k1 >>> 24) & 0xff);
  };
  const keystreamByte = (): number => {
    const temp = (k2 | 2) & 0xffff;
    return ((temp * (temp ^ 1)) >>> 8) & 0xff;
  };

  for (let i = 0; i < pwdBytes.length; i++) updateKeys(pwdBytes[i]);

  const header = crypto.randomBytes(12);
  header[11] = (crc32 >>> 24) & 0xff;

  const out = Buffer.allocUnsafe(12 + plainCompressed.length);
  for (let i = 0; i < 12; i++) {
    const p = header[i];
    out[i] = p ^ keystreamByte();
    updateKeys(p);
  }
  for (let i = 0; i < plainCompressed.length; i++) {
    const p = plainCompressed[i];
    out[12 + i] = p ^ keystreamByte();
    updateKeys(p);
  }
  return out;
}

function encryptWinZipAes256Payload(
  plainCompressed: Buffer,
  actualCompressionMethod: number,
  password: string | Buffer,
): { payload: Buffer; extraField: Buffer } {
  const pwdBuf = Buffer.isBuffer(password) ? password : Buffer.from(password, "utf8");
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(pwdBuf, salt, 1000, 66, "sha1");
  const encKey = derived.subarray(0, 32);
  const hmacKey = derived.subarray(32, 64);
  const pwdVerify = derived.subarray(64, 66);

  const cipherText = Buffer.allocUnsafe(plainCompressed.length);
  const ecb = crypto.createCipheriv("aes-256-ecb", encKey, null);
  ecb.setAutoPadding(false);
  const counterBlock = Buffer.alloc(16, 0);
  let blockCounter = 1n;

  for (let off = 0; off < plainCompressed.length; off += 16) {
    counterBlock.writeBigUInt64LE(blockCounter & 0xffffffffffffffffn, 0);
    counterBlock.writeBigUInt64LE((blockCounter >> 64n) & 0xffffffffffffffffn, 8);
    blockCounter += 1n;
    const keystream = ecb.update(counterBlock);
    const chunkLen = Math.min(16, plainCompressed.length - off);
    for (let j = 0; j < chunkLen; j++) {
      cipherText[off + j] = plainCompressed[off + j] ^ keystream[j];
    }
  }

  const authCode = crypto.createHmac("sha1", hmacKey).update(cipherText).digest().subarray(0, 10);
  const payload = Buffer.concat([salt, pwdVerify, cipherText, authCode]);

  // WinZip AES Extra Field (0x9901, 7 data bytes: version=2 AE-2, "AE", strength=3 AES-256, actualMethod)
  const extraField = Buffer.alloc(11);
  extraField.writeUInt16LE(0x9901, 0);
  extraField.writeUInt16LE(7, 2);
  extraField.writeUInt16LE(2, 4);
  extraField.write("AE", 6, "ascii");
  extraField.writeUInt8(3, 8);
  extraField.writeUInt16LE(actualCompressionMethod, 9);

  return { payload, extraField };
}

/**
 * Zero-dependency ZIP / ZIP64 archive writer built on Node's native `zlib` and `crypto`.
 * Supports Store, Deflate, UTF-8 filenames, ZIP64 overflow handling, PKWARE ZipCrypto & WinZip AES-256
 * encryption (for ETS5/ETS6 password-protected `.knxproj` inner archives), and zero-recompression
 * raw entry passthrough from an existing `ZipReader`.
 */
export class ZipWriter {
  private readonly entries = new Map<string, PendingZipEntry>();

  public hasEntry(fileName: string): boolean {
    return this.entries.has(normalizeZipPath(fileName));
  }

  public removeEntry(fileName: string): boolean {
    return this.entries.delete(normalizeZipPath(fileName));
  }

  public listEntryNames(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Adds or replaces a binary entry in the archive.
   */
  public addBuffer(fileName: string, content: Buffer, options: ZipWriteEntryOptions = {}): this {
    const normalized = normalizeZipPath(fileName);
    const { modTime, modDate } = encodeDosDateTime(options.modDate);
    let crc32 = computeCrc32(content);
    const shouldCompress = options.compress !== false && content.length > 0;

    let compressionMethod = 0;
    let payload: Buffer = content;
    if (shouldCompress) {
      const deflated = zlib.deflateRawSync(content, { level: options.level ?? 6 });
      if (deflated.length < content.length) {
        compressionMethod = 8;
        payload = deflated;
      }
    }

    let flags = UTF8_FLAG;
    let extraField: Buffer = Buffer.alloc(0);
    let minVersion = 20;

    if (options.encryption) {
      flags |= ENCRYPTED_FLAG;
      if (options.encryption.method === "aes-256") {
        const enc = encryptWinZipAes256Payload(payload, compressionMethod, options.encryption.password);
        payload = enc.payload;
        extraField = enc.extraField;
        compressionMethod = 99;
        crc32 = 0; // WinZip AE-2 requires CRC-32 = 0
        minVersion = 51;
      } else {
        payload = encryptZipCryptoPayload(payload, crc32, options.encryption.password);
      }
    }

    this.entries.set(normalized, {
      fileName: normalized,
      compressionMethod,
      flags,
      modTime,
      modDate,
      crc32,
      compressedData: payload,
      uncompressedSize: content.length,
      isDirectory: false,
      extraField,
      minVersion,
    });
    return this;
  }

  /**
   * Adds or replaces a UTF-8 text entry (optionally prepending UTF-8 BOM `0xEF 0xBB 0xBF`, matching ETS XML files).
   */
  public addText(fileName: string, text: string, options: ZipWriteEntryOptions & { bom?: boolean } = {}): this {
    const raw = Buffer.from(text, "utf8");
    const content = options.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]) : raw;
    return this.addBuffer(fileName, content, options);
  }

  /**
   * Adds an explicit directory entry (trailing `/`).
   */
  public addDirectory(dirName: string, modDate?: Date): this {
    let normalized = normalizeZipPath(dirName);
    if (!normalized.endsWith("/")) normalized += "/";
    const dos = encodeDosDateTime(modDate);
    this.entries.set(normalized, {
      fileName: normalized,
      compressionMethod: 0,
      flags: UTF8_FLAG,
      modTime: dos.modTime,
      modDate: dos.modDate,
      crc32: 0,
      compressedData: Buffer.alloc(0),
      uncompressedSize: 0,
      isDirectory: true,
      extraField: Buffer.alloc(0),
      minVersion: 20,
    });
    return this;
  }

  /**
   * Adds a pre-compressed entry directly without recompressing.
   */
  public addRawEntry(fileName: string, compressedData: Buffer, meta: ZipRawEntryMeta): this {
    const normalized = normalizeZipPath(fileName);
    const dos = encodeDosDateTime();
    // Strip data-descriptor bit (0x0008) because we always write exact sizes/CRC in the Local File Header
    const cleanFlags = ((meta.flags ?? UTF8_FLAG) & ~0x0008) | UTF8_FLAG;
    this.entries.set(normalized, {
      fileName: normalized,
      compressionMethod: meta.compressionMethod,
      flags: cleanFlags,
      modTime: meta.modTime ?? dos.modTime,
      modDate: meta.modDate ?? dos.modDate,
      crc32: meta.crc32 >>> 0,
      compressedData,
      uncompressedSize: meta.uncompressedSize,
      isDirectory: normalized.endsWith("/"),
      extraField: meta.extraField ?? Buffer.alloc(0),
      minVersion: meta.minVersion ?? 20,
    });
    return this;
  }

  /**
   * Copies an entry directly from a `ZipReader` using raw compressed passthrough (zero inflate/deflate cost).
   * Falls back to decrypt+recompress only if the source entry is encrypted and a password is provided.
   */
  public copyEntryFrom(
    reader: ZipReader,
    sourceFileName: string,
    targetFileName?: string,
    password?: string | Buffer,
  ): this {
    const { entry, compressedData } = reader.getRawCompressedEntry(sourceFileName);
    const destName = normalizeZipPath(targetFileName ?? entry.fileName);

    if (entry.isDirectory) {
      this.entries.set(destName.endsWith("/") ? destName : `${destName}/`, {
        fileName: destName.endsWith("/") ? destName : `${destName}/`,
        compressionMethod: 0,
        flags: UTF8_FLAG,
        modTime: entry.modTime,
        modDate: entry.modDate,
        crc32: 0,
        compressedData: Buffer.alloc(0),
        uncompressedSize: 0,
        isDirectory: true,
        extraField: Buffer.alloc(0),
        minVersion: 20,
      });
      return this;
    }

    if (entry.isEncrypted) {
      const plain = reader.readEntryBuffer(sourceFileName, password);
      return this.addBuffer(destName, plain);
    }

    return this.addRawEntry(destName, compressedData, {
      compressionMethod: entry.compressionMethod,
      uncompressedSize: entry.uncompressedSize,
      crc32: entry.crc32,
      modTime: entry.modTime,
      modDate: entry.modDate,
      flags: entry.flags,
    });
  }

  /**
   * Serializes the archive into a complete ZIP (or ZIP64 if needed) `Buffer`.
   */
  public toBuffer(): Buffer {
    const localChunks: Buffer[] = [];
    const centralChunks: Buffer[] = [];
    let offset = 0;

    for (const entry of this.entries.values()) {
      const nameBuf = Buffer.from(entry.fileName, "utf8");
      const compSize = entry.compressedData.length;
      const uncompSize = entry.uncompressedSize;
      const localHeaderOffset = offset;

      const needsLfhZip64 = compSize >= 0xffffffff || uncompSize >= 0xffffffff;
      const lfhZip64Extra = needsLfhZip64 ? Buffer.alloc(20) : Buffer.alloc(0);
      if (needsLfhZip64) {
        lfhZip64Extra.writeUInt16LE(0x0001, 0);
        lfhZip64Extra.writeUInt16LE(16, 2);
        lfhZip64Extra.writeBigUInt64LE(BigInt(uncompSize), 4);
        lfhZip64Extra.writeBigUInt64LE(BigInt(compSize), 12);
      }
      const lfhExtra =
        lfhZip64Extra.length > 0 && entry.extraField.length > 0
          ? Buffer.concat([lfhZip64Extra, entry.extraField])
          : lfhZip64Extra.length > 0
            ? lfhZip64Extra
            : entry.extraField;

      const versionNeeded = Math.max(entry.minVersion, needsLfhZip64 || localHeaderOffset >= 0xffffffff ? 45 : 20);

      // Local File Header (30 + nameLen + extraLen)
      const lfh = Buffer.alloc(30 + nameBuf.length + lfhExtra.length);
      lfh.writeUInt32LE(SIG_LOCAL_FILE_HEADER, 0);
      lfh.writeUInt16LE(versionNeeded, 4);
      lfh.writeUInt16LE(entry.flags, 6);
      lfh.writeUInt16LE(entry.compressionMethod, 8);
      lfh.writeUInt16LE(entry.modTime, 10);
      lfh.writeUInt16LE(entry.modDate, 12);
      lfh.writeUInt32LE(entry.crc32 >>> 0, 14);
      lfh.writeUInt32LE(needsLfhZip64 ? 0xffffffff : compSize, 18);
      lfh.writeUInt32LE(needsLfhZip64 ? 0xffffffff : uncompSize, 22);
      lfh.writeUInt16LE(nameBuf.length, 26);
      lfh.writeUInt16LE(lfhExtra.length, 28);
      nameBuf.copy(lfh, 30);
      if (lfhExtra.length > 0) lfhExtra.copy(lfh, 30 + nameBuf.length);

      localChunks.push(lfh, entry.compressedData);
      offset += lfh.length + entry.compressedData.length;

      // Central Directory File Header
      const cdZip64Fields: bigint[] = [];
      if (uncompSize >= 0xffffffff) cdZip64Fields.push(BigInt(uncompSize));
      if (compSize >= 0xffffffff) cdZip64Fields.push(BigInt(compSize));
      if (localHeaderOffset >= 0xffffffff) cdZip64Fields.push(BigInt(localHeaderOffset));

      const cdZip64Extra = cdZip64Fields.length > 0 ? Buffer.alloc(4 + cdZip64Fields.length * 8) : Buffer.alloc(0);
      if (cdZip64Fields.length > 0) {
        cdZip64Extra.writeUInt16LE(0x0001, 0);
        cdZip64Extra.writeUInt16LE(cdZip64Fields.length * 8, 2);
        cdZip64Fields.forEach((v, idx) => cdZip64Extra.writeBigUInt64LE(v, 4 + idx * 8));
      }
      const cdExtra =
        cdZip64Extra.length > 0 && entry.extraField.length > 0
          ? Buffer.concat([cdZip64Extra, entry.extraField])
          : cdZip64Extra.length > 0
            ? cdZip64Extra
            : entry.extraField;

      const cdfh = Buffer.alloc(46 + nameBuf.length + cdExtra.length);
      cdfh.writeUInt32LE(SIG_CENTRAL_DIR_HEADER, 0);
      cdfh.writeUInt16LE(versionNeeded, 4); // Version made by
      cdfh.writeUInt16LE(versionNeeded, 6); // Version needed
      cdfh.writeUInt16LE(entry.flags, 8);
      cdfh.writeUInt16LE(entry.compressionMethod, 10);
      cdfh.writeUInt16LE(entry.modTime, 12);
      cdfh.writeUInt16LE(entry.modDate, 14);
      cdfh.writeUInt32LE(entry.crc32 >>> 0, 16);
      cdfh.writeUInt32LE(compSize >= 0xffffffff ? 0xffffffff : compSize, 20);
      cdfh.writeUInt32LE(uncompSize >= 0xffffffff ? 0xffffffff : uncompSize, 24);
      cdfh.writeUInt16LE(nameBuf.length, 28);
      cdfh.writeUInt16LE(cdExtra.length, 30);
      cdfh.writeUInt16LE(0, 32); // File comment length
      cdfh.writeUInt16LE(0, 34); // Disk number start
      cdfh.writeUInt16LE(0, 36); // Internal file attributes
      cdfh.writeUInt32LE(entry.isDirectory ? 0x10 : 0, 38); // External file attributes
      cdfh.writeUInt32LE(localHeaderOffset >= 0xffffffff ? 0xffffffff : localHeaderOffset, 42);
      nameBuf.copy(cdfh, 46);
      if (cdExtra.length > 0) cdExtra.copy(cdfh, 46 + nameBuf.length);

      centralChunks.push(cdfh);
    }

    const cdOffset = offset;
    const cdSize = centralChunks.reduce((sum, b) => sum + b.length, 0);
    const entryCount = this.entries.size;
    const tailChunks: Buffer[] = [];

    const needsZip64Eocd = entryCount >= 0xffff || cdSize >= 0xffffffff || cdOffset >= 0xffffffff;
    if (needsZip64Eocd) {
      const zip64EocdOffset = cdOffset + cdSize;
      const zip64Eocd = Buffer.alloc(56);
      zip64Eocd.writeUInt32LE(SIG_ZIP64_EOCD, 0);
      zip64Eocd.writeBigUInt64LE(44n, 4); // Size of remaining record
      zip64Eocd.writeUInt16LE(45, 12); // Version made by
      zip64Eocd.writeUInt16LE(45, 14); // Version needed
      zip64Eocd.writeUInt32LE(0, 16); // Disk number
      zip64Eocd.writeUInt32LE(0, 20); // Disk with CD
      zip64Eocd.writeBigUInt64LE(BigInt(entryCount), 24);
      zip64Eocd.writeBigUInt64LE(BigInt(entryCount), 32);
      zip64Eocd.writeBigUInt64LE(BigInt(cdSize), 40);
      zip64Eocd.writeBigUInt64LE(BigInt(cdOffset), 48);

      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(SIG_ZIP64_EOCD_LOCATOR, 0);
      locator.writeUInt32LE(0, 4); // Disk with ZIP64 EOCD
      locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
      locator.writeUInt32LE(1, 16); // Total disks

      tailChunks.push(zip64Eocd, locator);
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entryCount >= 0xffff ? 0xffff : entryCount, 8);
    eocd.writeUInt16LE(entryCount >= 0xffff ? 0xffff : entryCount, 10);
    eocd.writeUInt32LE(cdSize >= 0xffffffff ? 0xffffffff : cdSize, 12);
    eocd.writeUInt32LE(cdOffset >= 0xffffffff ? 0xffffffff : cdOffset, 16);
    eocd.writeUInt16LE(0, 20);
    tailChunks.push(eocd);

    return Buffer.concat([...localChunks, ...centralChunks, ...tailChunks]);
  }

  /**
   * Writes the archive to disk, creating parent directories if needed.
   */
  public saveFile(filePath: string): void {
    const dir = path.dirname(filePath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, this.toBuffer());
  }
}
