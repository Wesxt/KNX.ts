import fs from "node:fs";
import { Readable } from "node:stream";
import zlib from "node:zlib";

export interface ZipEntryInfo {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

const SIG_LOCAL_FILE_HEADER = 0x04034b50;
const SIG_CENTRAL_DIR_HEADER = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;

/**
 * Zero-dependency ZIP archive reader built on Node's native `zlib`.
 * Supports standard ZIP and ZIP64 archives (Store and Deflate entries), such as ETS `.knxprod` and `.knxproj` files.
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
   * Synchronously reads and decompresses an entry into a `Buffer`.
   */
  public readEntryBuffer(fileName: string): Buffer {
    const entry = this.getEntry(fileName);
    if (!entry) {
      throw new Error(`ZIP entry not found: "${fileName}"`);
    }
    if (entry.isDirectory) {
      return Buffer.alloc(0);
    }
    const slice = this.getCompressedSlice(entry);
    if (entry.compressionMethod === 0) {
      return Buffer.from(slice);
    }
    if (entry.compressionMethod === 8) {
      return zlib.inflateRawSync(slice);
    }
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for "${entry.fileName}"`);
  }

  /**
   * Synchronously reads an entry as a UTF-8 string (stripping UTF-8 BOM if present).
   */
  public readEntryText(fileName: string): string {
    const text = this.readEntryBuffer(fileName).toString("utf8");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /**
   * Opens a Readable stream of decompressed bytes for large XML entries (e.g. 64 MB ApplicationProgram XMLs).
   */
  public createEntryStream(fileName: string, chunkSize: number = 64 * 1024): Readable {
    const entry = this.getEntry(fileName);
    if (!entry) {
      throw new Error(`ZIP entry not found: "${fileName}"`);
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

      // Parse ZIP64 extra field (header ID 0x0001) if any 32-bit field is 0xFFFFFFFF
      if (
        (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) &&
        extraLen > 0
      ) {
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
            break;
          }
          ex += dataSize;
        }
      }

      this.entries.set(fileName, {
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        crc32,
        localHeaderOffset,
        isDirectory: fileName.endsWith("/"),
      });

      cursor = nameStart + nameLen + extraLen + commentLen;
    }
  }
}
