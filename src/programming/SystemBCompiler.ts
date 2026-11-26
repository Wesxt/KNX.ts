import zlib from "node:zlib";
import { normalizeKeyringGroupAddress } from "../security/KnxKeyring";
import { parseKey16 } from "../security/KnxSecureKeys";
import { KNXHelper } from "../utils/KNXHelper";
import { DynamicEvaluator } from "./DynamicEvaluator";
import { isCouplerMaskVersion, resolveManagementModel } from "./KnxProdParser";
import {
  CompiledMemorySegment,
  CompiledPropertyWrite,
  CompiledSystemBImage,
  DeviceApplicationConfig,
  EvaluatedApplicationState,
  GroupObjectPriority,
  GroupObjectSecurityMode,
  KnxApplicationOptions,
  KnxApplicationProgram,
  KnxManagementModel,
  KnxParameterDef,
  KnxParameterType,
  MemoryWriteSpan,
  ResolvedComObject,
  SecurityCommissioningImage,
} from "./types";

/** KNX Data Secure sequence number epoch (`2018-01-05T00:00:00Z`, 03_05_03 §1.5.4.1). */
export const KNX_SECURITY_EPOCH_MS = Date.UTC(2018, 0, 5, 0, 0, 0);

/**
 * Computes the standard initial 48-bit `PID_SEQUENCE_NUMBER_SENDING` value (ms since `2018-01-05T00:00:00Z`)
 * per KNX Standard 03_05_03 §1.5.4.1.
 */
export function computeDefaultSecuritySequenceNumber(nowMs: number = Date.now()): bigint {
  const delta = Math.max(1, Math.trunc(nowMs - KNX_SECURITY_EPOCH_MS));
  return BigInt(delta);
}

/**
 * Encodes a Group Object security mode to its `PID_GO_SECURITY_FLAGS` octet (03_05_01 §6.3.15 Fig. 81):
 * - `"plain"` -> `0x00`
 * - `"auth_only"` -> `0x01` (b0=auth)
 * - `"auth_conf"` -> `0x03` (b0=auth | b1=conf)
 */
export function encodeGoSecurityFlagByte(mode: GroupObjectSecurityMode): number {
  switch (mode) {
    case "auth_only":
      return 0x01;
    case "auth_conf":
      return 0x03;
    case "plain":
    default:
      return 0x00;
  }
}

/**
 * Computes KNX CRC16-CCITT (AUG-CCITT) per 03_05_01 §4.2.27.1.2:
 * Width=16, Polynomial=0x1021, non-direct initial value=0xFFFF (equivalent to direct init=0x1D0F),
 * RefIn=false, RefOut=false, XorOut=0x0000.
 * Official spec check vector: `crc16Ccitt(Buffer.from("123456789")) === 0xE5CC`.
 */
export function crc16Ccitt(data: Buffer): number {
  let crc = 0x1d0f;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
}

/**
 * Encodes a floating-point number into KNX DPT 9 16-bit float (`03_07_02` §3.10):
 * `V = (0.01 * M) * 2^E`, `M in [-2048..2047]` (2's complement), `E in [0..15]`.
 */
export function encodeDpt9Word(value: number): number {
  if (!Number.isFinite(value)) return 0x7fff;
  let scaled = value * 100;
  let exp = 0;
  while ((scaled < -2048 || scaled > 2047) && exp < 15) {
    scaled /= 2;
    exp++;
  }
  const mantissa = Math.max(-2048, Math.min(2047, Math.round(scaled)));
  const sign = mantissa < 0 ? 1 : 0;
  const m11 = mantissa & 0x07ff;
  return ((sign << 15) | ((exp & 0x0f) << 11) | m11) & 0xffff;
}

/**
 * Encodes priority name to 2-bit System B priority code (03_05_01 §4.18.6 Table 87).
 */
export function encodeGroupObjectPriority(priority: GroupObjectPriority): number {
  switch (priority) {
    case "System":
      return 0b00;
    case "Normal":
      return 0b01;
    case "Urgent":
    case "Alert":
      return 0b10;
    case "Low":
    default:
      return 0b11;
  }
}

/**
 * Encodes a single KNX Parameter value into raw bytes + bit length according to its `KnxParameterType`
 * and `KnxApplicationOptions` (`ParameterByteOrder`, `TextParameterEncoding`, `TextParameterZeroTerminate`).
 */
export function encodeParameterValue(
  rawValue: string,
  paramType: KnxParameterType,
  options: KnxApplicationOptions,
): { buffer: Buffer; bitLength: number } | null {
  const isLE = options.parameterByteOrder === "LittleEndian";
  const detail = paramType.detail;

  switch (detail.kind) {
    case "None":
    case "Picture":
      return null;

    case "Number": {
      const bitLength = detail.sizeInBit;
      if (bitLength <= 0) return null;
      const num = rawValue.trim() === "" ? 0 : Number(rawValue);
      const safeNum = Number.isFinite(num) ? num : 0;

      if (detail.numberType === "float") {
        const buf = Buffer.alloc(bitLength === 64 ? 8 : 4);
        if (bitLength === 64) {
          if (isLE) buf.writeDoubleLE(safeNum, 0);
          else buf.writeDoubleBE(safeNum, 0);
        } else {
          if (isLE) buf.writeFloatLE(safeNum, 0);
          else buf.writeFloatBE(safeNum, 0);
        }
        return { buffer: buf, bitLength };
      }

      return {
        buffer: encodeInteger(safeNum, bitLength, detail.numberType === "signedInt", isLE),
        bitLength,
      };
    }

    case "Restriction": {
      const bitLength = detail.sizeInBit;
      if (bitLength <= 0) return null;
      const numVal = rawValue.trim() === "" ? 0 : parseInt(rawValue, 10);
      if (detail.base === "BinaryValue") {
        const matched = detail.enumerations.find((e) => e.value === numVal);
        if (matched?.binaryValue) {
          return { buffer: Buffer.from(matched.binaryValue), bitLength: matched.binaryValue.length * 8 };
        }
        // Fallback: interpret rawValue as base64 or hex
        return { buffer: Buffer.alloc(Math.ceil(bitLength / 8)), bitLength };
      }
      return {
        buffer: encodeInteger(Number.isFinite(numVal) ? numVal : 0, bitLength, false, isLE),
        bitLength,
      };
    }

    case "Float": {
      const num = rawValue.trim() === "" ? 0 : Number(rawValue);
      const safeNum = Number.isFinite(num) ? num : 0;
      if (detail.encoding === "DPT 9") {
        const word = encodeDpt9Word(safeNum);
        const buf = Buffer.alloc(2);
        if (isLE) buf.writeUInt16LE(word, 0);
        else buf.writeUInt16BE(word, 0);
        return { buffer: buf, bitLength: 16 };
      }
      if (detail.encoding === "IEEE-754 Double" || detail.sizeInBit === 64) {
        const buf = Buffer.alloc(8);
        if (isLE) buf.writeDoubleLE(safeNum, 0);
        else buf.writeDoubleBE(safeNum, 0);
        return { buffer: buf, bitLength: 64 };
      }
      const buf = Buffer.alloc(4);
      if (isLE) buf.writeFloatLE(safeNum, 0);
      else buf.writeFloatBE(safeNum, 0);
      return { buffer: buf, bitLength: 32 };
    }

    case "Text": {
      const byteLen = Math.ceil(detail.sizeInBit / 8);
      if (byteLen <= 0) return null;
      const buf = Buffer.alloc(byteLen, 0x00);
      const enc = normalizeTextEncoding(options.textParameterEncoding);
      const encoded = Buffer.from(rawValue, enc);
      const maxCopy = options.textParameterZeroTerminate ? Math.max(0, byteLen - 1) : byteLen;
      encoded.copy(buf, 0, 0, Math.min(encoded.length, maxCopy));
      return { buffer: buf, bitLength: byteLen * 8 };
    }

    case "Time": {
      const num = rawValue.trim() === "" ? 0 : Number(rawValue);
      return {
        buffer: encodeInteger(Number.isFinite(num) ? num : 0, detail.sizeInBit, false, isLE),
        bitLength: detail.sizeInBit,
      };
    }

    case "Color": {
      const clean = rawValue.replace(/^#/, "").trim();
      const byteLen = Math.ceil(detail.sizeInBit / 8);
      const buf = Buffer.alloc(byteLen, 0x00);
      if (/^[0-9a-fA-F]+$/.test(clean)) {
        const raw = Buffer.from(clean.padStart(byteLen * 2, "0").slice(0, byteLen * 2), "hex");
        raw.copy(buf, 0);
      }
      return { buffer: buf, bitLength: byteLen * 8 };
    }

    case "IPAddress": {
      const byteLen = Math.ceil(detail.sizeInBit / 8);
      const buf = Buffer.alloc(byteLen, 0x00);
      if (byteLen === 4) {
        const parts = rawValue.split(".").map((p) => parseInt(p, 10) & 0xff);
        for (let i = 0; i < Math.min(4, parts.length); i++) buf[i] = parts[i];
      }
      return { buffer: buf, bitLength: byteLen * 8 };
    }

    case "RawData": {
      const raw = Buffer.from(rawValue.replace(/\s+/g, ""), "base64");
      return { buffer: raw, bitLength: raw.length * 8 };
    }
  }
}

function normalizeTextEncoding(knxEncoding: string): BufferEncoding {
  const lower = knxEncoding.trim().toLowerCase();
  if (lower === "utf-8" || lower === "utf8") return "utf8";
  if (lower === "iso-8859-1" || lower === "latin1" || lower === "windows-1252" || lower === "cp1252") return "latin1";
  if (lower === "utf-16" || lower === "utf-16le") return "utf16le";
  return "latin1";
}

function encodeInteger(value: number, bitLength: number, signed: boolean, isLittleEndian: boolean): Buffer {
  const byteLen = Math.ceil(bitLength / 8);
  const buf = Buffer.alloc(byteLen, 0);
  const rounded = Math.trunc(value);

  if (bitLength <= 8) {
    const mask = bitLength === 8 ? 0xff : (1 << bitLength) - 1;
    buf[0] = rounded & mask;
    return buf;
  }

  // Use BigInt for lossless 16/24/32/48/64-bit two's complement encoding
  let big = BigInt(rounded);
  if (signed && big < 0n) {
    big = (1n << BigInt(bitLength)) + big;
  }
  const bitMask = (1n << BigInt(bitLength)) - 1n;
  big = big & bitMask;

  if (isLittleEndian && bitLength % 8 === 0) {
    for (let i = 0; i < byteLen; i++) {
      buf[i] = Number((big >> BigInt(i * 8)) & 0xffn);
    }
  } else {
    for (let i = 0; i < byteLen; i++) {
      buf[byteLen - 1 - i] = Number((big >> BigInt(i * 8)) & 0xffn);
    }
  }

  return buf;
}

/**
 * Writes `bitLength` bits from `encoded` into `target` starting at `(byteOffset, bitOffset)`
 * (where `bitOffset = 0` is MSB bit 7 of `target[byteOffset]` per KNX XML specification).
 * Returns the number of bytes whose value changed in `target`.
 */
export function patchBitsIntoBuffer(
  target: Buffer,
  mask: Buffer,
  byteOffset: number,
  bitOffset: number,
  bitLength: number,
  encoded: Buffer,
): number {
  if (bitLength <= 0 || byteOffset < 0) return 0;

  // Fast path: byte-aligned whole bytes
  if (bitOffset === 0 && bitLength % 8 === 0) {
    const byteLen = bitLength / 8;
    if (byteOffset + byteLen > target.length) return 0;
    let changed = 0;
    for (let i = 0; i < byteLen; i++) {
      const nextByte = i < encoded.length ? encoded[i] : 0;
      if (target[byteOffset + i] !== nextByte) {
        target[byteOffset + i] = nextByte;
        changed++;
      }
      mask[byteOffset + i] = 0xff;
    }
    return changed;
  }

  // General bit-level packing (MSB-first within bytes per ETS/KNX XML convention)
  const totalBitsTarget = target.length * 8;
  const startBit = byteOffset * 8 + bitOffset;
  if (startBit + bitLength > totalBitsTarget) return 0;

  const srcStartBit = encoded.length * 8 - bitLength;
  const touchedBytes = new Set<number>();
  const beforeBytes = new Map<number, number>();

  for (let b = 0; b < bitLength; b++) {
    const srcBitIndex = srcStartBit + b;
    const srcByteIdx = Math.floor(srcBitIndex / 8);
    const srcBitInByte = 7 - (srcBitIndex % 8);
    const bitVal = srcByteIdx >= 0 && srcByteIdx < encoded.length ? (encoded[srcByteIdx] >> srcBitInByte) & 1 : 0;

    const dstBitIndex = startBit + b;
    const dstByteIdx = Math.floor(dstBitIndex / 8);
    const dstBitInByte = 7 - (dstBitIndex % 8);
    const dstBitMask = 1 << dstBitInByte;

    if (!beforeBytes.has(dstByteIdx)) {
      beforeBytes.set(dstByteIdx, target[dstByteIdx]);
    }
    if (bitVal) {
      target[dstByteIdx] |= dstBitMask;
    } else {
      target[dstByteIdx] &= ~dstBitMask;
    }
    mask[dstByteIdx] |= dstBitMask;
    touchedBytes.add(dstByteIdx);
  }

  let changed = 0;
  for (const idx of touchedBytes) {
    if (beforeBytes.get(idx) !== target[idx]) changed++;
  }
  return changed;
}

/**
 * Compiles System B Object 1 — Group Address Table (`GrAT`, Realisation Type 7, 03_05_01 §4.16.8 Table 78).
 * Returns the binary table buffer and the sorted unique Group Addresses (1-based `TSAP` = `index + 1`).
 */
export function compileGroupAddressTable(groupAddresses: string[]): {
  buffer: Buffer;
  sortedAddresses: string[];
  tsapByAddress: Map<string, number>;
} {
  const uniqueByInt = new Map<number, string>();
  for (const ga of groupAddresses) {
    const buf = KNXHelper.GetAddress(ga, "/");
    const intVal = buf.readUInt16BE(0);
    if (!uniqueByInt.has(intVal)) {
      uniqueByInt.set(intVal, KNXHelper.GetAddress(buf, "/") as string);
    }
  }

  // 03_05_01 §4.16.8.2.4: Group Addresses MUST be filled in ascending numeric order
  const sortedInts = Array.from(uniqueByInt.keys()).sort((a, b) => a - b);
  const sortedAddresses: string[] = [];
  const tsapByAddress = new Map<string, number>();

  const out = Buffer.alloc(2 + sortedInts.length * 2);
  out.writeUInt16BE(sortedInts.length, 0);

  for (let i = 0; i < sortedInts.length; i++) {
    const intVal = sortedInts[i];
    const formatted = uniqueByInt.get(intVal)!;
    out.writeUInt16BE(intVal, 2 + i * 2);
    sortedAddresses.push(formatted);
    tsapByAddress.set(formatted, i + 1); // TSAP is 1-based
  }

  return { buffer: out, sortedAddresses, tsapByAddress };
}

/**
 * Compiles System B Object 2 — Group Object Association Table (`GrOAT`, Realisation Type 6/7, 03_05_01 §4.17.5.2.5).
 * - `format === 0`: `PDT_GENERIC_02` (1B TSAP, 1B ASAP)
 * - `format === 1`: `PDT_GENERIC_04` (2B TSAP, 2B ASAP)
 *
 * Ensures that for every Group Object (`ASAP`), its sending Group Address (`TSAP`) appears FIRST.
 */
export function compileAssociationTable(
  activeComObjects: Map<number, ResolvedComObject>,
  tsapByAddress: Map<string, number>,
  format: 0 | 1,
): { buffer: Buffer; count: number } {
  const sendingPairs: { tsap: number; asap: number }[] = [];
  const listeningPairs: { tsap: number; asap: number }[] = [];

  const sortedComObjNums = Array.from(activeComObjects.keys()).sort((a, b) => a - b);

  for (const asap of sortedComObjNums) {
    const co = activeComObjects.get(asap)!;
    if (co.groupAddresses.length === 0) continue;

    const sendingGa = co.sendingGroupAddress ?? co.groupAddresses[0];
    const sendingTsap = tsapByAddress.get(sendingGa);
    if (sendingTsap !== undefined) {
      sendingPairs.push({ tsap: sendingTsap, asap });
    }

    for (const ga of co.groupAddresses) {
      if (ga === sendingGa) continue;
      const tsap = tsapByAddress.get(ga);
      if (tsap !== undefined) {
        listeningPairs.push({ tsap, asap });
      }
    }
  }

  // Sending associations come first so the first matching ASAP is always the sending TSAP (03_05_01 §4.17.5.2.5)
  sendingPairs.sort((a, b) => a.tsap - b.tsap || a.asap - b.asap);
  listeningPairs.sort((a, b) => a.tsap - b.tsap || a.asap - b.asap);
  const allPairs = [...sendingPairs, ...listeningPairs];

  const entrySize = format === 1 ? 4 : 2;
  const out = Buffer.alloc(2 + allPairs.length * entrySize);
  out.writeUInt16BE(allPairs.length, 0);

  for (let i = 0; i < allPairs.length; i++) {
    const { tsap, asap } = allPairs[i];
    if (format === 0) {
      if (tsap > 255 || asap > 255) {
        throw new Error(
          `Association (TSAP=${tsap}, ASAP=${asap}) exceeds Format 0 (8-bit) limit; device requires Format 1 (PDT_GENERIC_04)`,
        );
      }
      out.writeUInt8(tsap, 2 + i * 2);
      out.writeUInt8(asap, 2 + i * 2 + 1);
    } else {
      out.writeUInt16BE(tsap, 2 + i * 4);
      out.writeUInt16BE(asap, 2 + i * 4 + 2);
    }
  }

  return { buffer: out, count: allPairs.length };
}

/**
 * Compiles System B Object 3 — Group Object Table (`GrOT`, Realisation Type 7, 03_05_01 §4.18.6 Tables 86–88).
 *
 * Layout:
 * - Bytes `0..1`: `uint16BE(tableSize)`
 * - Slot `number - 1` (bytes `2 + (number - 1) * 2`):
 *   - High byte: `[U(7) | T(6) | I(5) | W(4) | R(3) | C(2) | Prio(1..0)]`
 *   - Low byte: `ValueFieldType` (Table 88)
 * - Inactive / hidden ComObjects are `0x00 0x00`.
 */
export function compileGroupObjectTable(
  activeComObjects: Map<number, ResolvedComObject>,
  tableSize: number,
  clearCommunicationFlagWhenUnlinked: boolean = true,
): Buffer {
  const out = Buffer.alloc(2 + tableSize * 2, 0x00);
  out.writeUInt16BE(tableSize, 0);

  for (const [number, co] of activeComObjects.entries()) {
    if (number < 1 || number > tableSize) continue;

    const commEnabled = co.flags.communication && (!clearCommunicationFlagWhenUnlinked || co.groupAddresses.length > 0);
    const prioBits = encodeGroupObjectPriority(co.priority) & 0x03;

    const configByte =
      ((co.flags.update ? 1 : 0) << 7) |
      ((co.flags.transmit ? 1 : 0) << 6) |
      ((co.flags.readOnInit ? 1 : 0) << 5) |
      ((co.flags.write ? 1 : 0) << 4) |
      ((co.flags.read ? 1 : 0) << 3) |
      ((commEnabled ? 1 : 0) << 2) |
      prioBits;

    const slotOffset = 2 + (number - 1) * 2;
    out.writeUInt8(configByte, slotOffset);
    out.writeUInt8(co.valueTypeCode & 0xff, slotOffset + 1);
  }

  return out;
}

/**
 * Returns the RAM value byte size for a KNX Group Object `ValueFieldType` code (03_05_01 §4.18 Table 88).
 */
export function valueTypeCodeToByteSize(valueTypeCode: number): number {
  if (valueTypeCode <= 7) return 1; // 1..7 bit or 1 byte -> 1 byte in RAM
  if (valueTypeCode === 8) return 2;
  if (valueTypeCode === 9) return 3;
  if (valueTypeCode === 10) return 4;
  if (valueTypeCode === 11) return 6;
  if (valueTypeCode === 12) return 8;
  if (valueTypeCode === 13) return 10;
  if (valueTypeCode === 14) return 14;
  if (valueTypeCode === 15) return 5;
  if (valueTypeCode === 16) return 7;
  if (valueTypeCode === 17) return 9;
  if (valueTypeCode === 18) return 11;
  if (valueTypeCode === 19) return 12;
  if (valueTypeCode === 20) return 13;
  if (valueTypeCode >= 21 && valueTypeCode <= 254) return valueTypeCode - 6;
  return 1;
}

/**
 * Compiles a legacy BCU1 / BCU2 / BIM M112 Group Address Table (`GrAT`, Realisation Type 1 / 2,
 * `03_05_01` §4.16.2–4.16.3):
 * - Byte `0`: `count = 1 + groupAddresses.length` (includes own Individual Address at slot 0)
 * - Bytes `1..2`: `uint16BE(individualAddress)` (preserved from `existingTable` or `0xFFFF` if omitted)
 * - Bytes `3..`: sorted unique 16-bit Group Addresses (`TSAP = 1..N`)
 */
export function compileLegacyGroupAddressTable(
  groupAddresses: string[],
  individualAddress?: string,
  existingTable?: Buffer,
): {
  buffer: Buffer;
  sortedAddresses: string[];
  tsapByAddress: Map<string, number>;
} {
  const uniqueByInt = new Map<number, string>();
  for (const ga of groupAddresses) {
    const buf = KNXHelper.GetAddress(ga, "/");
    const intVal = buf.readUInt16BE(0);
    if (!uniqueByInt.has(intVal)) {
      uniqueByInt.set(intVal, KNXHelper.GetAddress(buf, "/") as string);
    }
  }

  const sortedInts = Array.from(uniqueByInt.keys()).sort((a, b) => a - b);
  if (sortedInts.length > 254) {
    throw new Error(
      `Legacy Realisation Type 1/2 Address Table supports at most 254 Group Addresses (got ${sortedInts.length})`,
    );
  }

  const sortedAddresses: string[] = [];
  const tsapByAddress = new Map<string, number>();

  const count = 1 + sortedInts.length;
  const out = Buffer.alloc(1 + count * 2, 0x00);
  out.writeUInt8(count & 0xff, 0);

  if (individualAddress && KNXHelper.isValidIndividualAddress(individualAddress.trim())) {
    const iaBuf = KNXHelper.GetAddress(individualAddress.trim(), ".");
    iaBuf.copy(out, 1, 0, 2);
  } else if (existingTable && existingTable.length >= 3) {
    existingTable.copy(out, 1, 1, 3);
  } else {
    out.writeUInt16BE(0xffff, 1);
  }

  for (let i = 0; i < sortedInts.length; i++) {
    const intVal = sortedInts[i];
    const formatted = uniqueByInt.get(intVal)!;
    out.writeUInt16BE(intVal, 3 + i * 2);
    sortedAddresses.push(formatted);
    tsapByAddress.set(formatted, i + 1); // TSAP is 1-based (index 0 is own IA)
  }

  return { buffer: out, sortedAddresses, tsapByAddress };
}

/**
 * Compiles a legacy BCU1 / BCU2 / BIM M112 Group Object Association Table (`GrOAT`, Realisation Type 1 / 2,
 * `03_05_01` §4.17.2–4.17.3):
 * - Byte `0`: `count` (1 byte, max 255)
 * - Bytes `1..`: pairs `[1B TSAP (1-based), 1B ASAP (0-based ComObject number)]` with sending GA first per ASAP.
 */
export function compileLegacyAssociationTable(
  activeComObjects: Map<number, ResolvedComObject>,
  tsapByAddress: Map<string, number>,
): { buffer: Buffer; count: number } {
  const sendingPairs: { tsap: number; asap: number }[] = [];
  const listeningPairs: { tsap: number; asap: number }[] = [];

  const sortedComObjNums = Array.from(activeComObjects.keys()).sort((a, b) => a - b);

  for (const asap of sortedComObjNums) {
    const co = activeComObjects.get(asap)!;
    if (co.groupAddresses.length === 0) continue;

    const sendingGa = co.sendingGroupAddress ?? co.groupAddresses[0];
    const sendingTsap = tsapByAddress.get(sendingGa);
    if (sendingTsap !== undefined) {
      sendingPairs.push({ tsap: sendingTsap, asap });
    }

    for (const ga of co.groupAddresses) {
      if (ga === sendingGa) continue;
      const tsap = tsapByAddress.get(ga);
      if (tsap !== undefined) {
        listeningPairs.push({ tsap, asap });
      }
    }
  }

  sendingPairs.sort((a, b) => a.tsap - b.tsap || a.asap - b.asap);
  listeningPairs.sort((a, b) => a.tsap - b.tsap || a.asap - b.asap);
  const allPairs = [...sendingPairs, ...listeningPairs];

  if (allPairs.length > 255) {
    throw new Error(
      `Legacy Realisation Type 1/2 Association Table supports at most 255 associations (got ${allPairs.length})`,
    );
  }

  const out = Buffer.alloc(1 + allPairs.length * 2, 0x00);
  out.writeUInt8(allPairs.length & 0xff, 0);

  for (let i = 0; i < allPairs.length; i++) {
    const { tsap, asap } = allPairs[i];
    if (tsap > 255 || asap > 255 || asap < 0) {
      throw new Error(`Legacy Association (TSAP=${tsap}, ASAP=${asap}) exceeds 8-bit Realisation Type 1/2 range`);
    }
    out.writeUInt8(tsap & 0xff, 1 + i * 2);
    out.writeUInt8(asap & 0xff, 1 + i * 2 + 1);
  }

  return { buffer: out, count: allPairs.length };
}

/**
 * Compiles or patches a legacy BCU1 / BCU2 (Realisation Type 1, `pointerSize = 1`) or
 * BIM M112 / System 7 (Realisation Type 2, `pointerSize = 2`) Group Object Table (`GrOT`, `03_05_01` §4.18.2–4.18.3).
 *
 * When `existingTable` contains manufacturer pre-populated RAM pointers (standard for BIM M112 & BCU1 `.knxprod`
 * `<AbsoluteSegment><Data>`), the existing `ramFlagsPtr` and per-object `dataPtr` bytes are preserved verbatim
 * regardless of MCU endianness, updating only the Config Flags byte and ValueType byte.
 */
export function compileLegacyGroupObjectTable(
  activeComObjects: Map<number, ResolvedComObject>,
  tableSize: number,
  options: {
    pointerSize: 1 | 2;
    clearCommunicationFlagWhenUnlinked?: boolean;
    existingTable?: Buffer;
    littleEndianPointers?: boolean;
    baseRamAddress?: number;
  },
): Buffer {
  const ptrSize = options.pointerSize;
  const clearWhenUnlinked = options.clearCommunicationFlagWhenUnlinked ?? true;
  const headerSize = 1 + ptrSize; // 1B count + 1B/2B ramFlagsPtr
  const entrySize = ptrSize + 2; // 1B/2B dataPtr + 1B config + 1B valueType

  const existing = options.existingTable;
  const hasExistingTemplate =
    existing !== undefined &&
    existing.length >= headerSize + entrySize &&
    existing[0] > 0 &&
    headerSize + existing[0] * entrySize <= existing.length;

  const count = hasExistingTemplate ? existing[0] : Math.max(0, Math.min(255, tableSize));
  const totalBytes = headerSize + count * entrySize;
  const out = Buffer.alloc(totalBytes, 0x00);

  if (hasExistingTemplate) {
    existing.copy(out, 0, 0, totalBytes);
  } else {
    out.writeUInt8(count & 0xff, 0);
    const ramFlagsBase = options.baseRamAddress ?? (ptrSize === 1 ? 0x00 : 0x0700);
    if (ptrSize === 1) {
      out.writeUInt8(ramFlagsBase & 0xff, 1);
    } else if (options.littleEndianPointers) {
      out.writeUInt16LE(ramFlagsBase & 0xffff, 1);
    } else {
      out.writeUInt16BE(ramFlagsBase & 0xffff, 1);
    }

    // Auto-assign sequential RAM value pointers right after RAM flags table (4 bits per object)
    let dataCursor = ramFlagsBase + Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
      const entryOff = headerSize + i * entrySize;
      const co = activeComObjects.get(i);
      if (ptrSize === 1) {
        out.writeUInt8(dataCursor & 0xff, entryOff);
      } else if (options.littleEndianPointers) {
        out.writeUInt16LE(dataCursor & 0xffff, entryOff);
      } else {
        out.writeUInt16BE(dataCursor & 0xffff, entryOff);
      }
      dataCursor += co ? valueTypeCodeToByteSize(co.valueTypeCode) : 1;
    }
  }

  // Update Config Byte & ValueType for all slots (0-based ASAP index on BCU1/BCU2/BIM M112)
  for (let i = 0; i < count; i++) {
    const entryOff = headerSize + i * entrySize;
    const cfgOff = entryOff + ptrSize;
    const typeOff = entryOff + ptrSize + 1;
    const co = activeComObjects.get(i);

    if (!co) {
      // Inactive ComObject: preserve pointer & type, clear Communication (C) bit
      if (hasExistingTemplate) {
        out[cfgOff] &= ~0x04;
      }
      continue;
    }

    const commEnabled = co.flags.communication && (!clearWhenUnlinked || co.groupAddresses.length > 0);
    const prioBits = encodeGroupObjectPriority(co.priority) & 0x03;
    // Preserve manufacturer Segment bit (bit 5: 0=RAM, 1=EEPROM) when patching existing Realisation Type 1/2 table
    const segmentBit = hasExistingTemplate ? out[cfgOff] & 0x20 : 0x00;

    const configByte =
      ((co.flags.update ? 1 : 0) << 7) |
      ((co.flags.transmit ? 1 : 0) << 6) |
      segmentBit |
      ((co.flags.write ? 1 : 0) << 4) |
      ((co.flags.read ? 1 : 0) << 3) |
      ((commEnabled ? 1 : 0) << 2) |
      prioBits;

    out.writeUInt8(configByte, cfgOff);
    out.writeUInt8(co.valueTypeCode & 0xff, typeOff);
  }

  return out;
}

/**
 * Compiles a KNX Line/Area Coupler Filter Table bitmask (`8192` bytes for standard 16-bit GA space
 * `MV-091A`/`MV-2920`, or `3584` bytes for legacy `MV-0910`/`MV-0912` main groups `0..13`).
 *
 * Accepts a prebuilt `Buffer`, a hex string (e.g. from `KnxProject.computeFilterTables()`),
 * or an array of Group Addresses (`"1/0/1"` or numeric `2049`).
 */
export function compileCouplerFilterTable(input?: Buffer | string | (string | number)[], size: number = 8192): Buffer {
  const out = Buffer.alloc(size, 0x00);
  if (!input) return out;

  if (Buffer.isBuffer(input)) {
    input.copy(out, 0, 0, Math.min(input.length, size));
    return out;
  }

  if (typeof input === "string") {
    const clean = input.replace(/[\s_-]+/g, "");
    if (clean.length > 0) {
      const raw = Buffer.from(clean, "hex");
      raw.copy(out, 0, 0, Math.min(raw.length, size));
    }
    return out;
  }

  for (const ga of input) {
    let addrInt: number;
    if (typeof ga === "number") {
      addrInt = ga & 0xffff;
    } else {
      const buf = KNXHelper.GetAddress(ga.trim(), "/");
      addrInt = buf.readUInt16BE(0);
    }
    const byteIdx = addrInt >> 3;
    if (byteIdx >= 0 && byteIdx < size) {
      out[byteIdx] |= 1 << (addrInt & 7);
    }
  }
  return out;
}

/**
 * Compiles Security Interface Object (Object Type 17, 03_05_01 §6.3) commissioning tables:
 * - `PID_GRP_KEY_TABLE` (PID 53, sorted ascending by 1-based `gaIndex` / `TSAP`)
 * - `PID_GO_SECURITY_FLAGS` (PID 61, 1 byte per Group Object slot)
 * - `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (PID 54, sorted ascending by 16-bit IA)
 * - `PID_P2P_KEY_TABLE` (PID 52, sorted ascending by 1-based `iaIndex`)
 * - Optional `PID_TOOL_KEY` (PID 56), `PID_SECURITY_MODE` (PID 51), `PID_SEQUENCE_NUMBER_SENDING` (PID 59).
 */
export function compileSecurityObjectImage(
  app: KnxApplicationProgram,
  evaluated: EvaluatedApplicationState,
  tsapByAddress: Map<string, number>,
  groupObjectCount: number,
  config: DeviceApplicationConfig,
  warnings: string[],
): SecurityCommissioningImage | undefined {
  const sec = config.security;
  const hasExplicitSecureComObj = Array.from(evaluated.activeComObjects.values()).some(
    (co) => co.security === "auth_only" || co.security === "auth_conf",
  );
  const shouldCompile =
    sec?.enabled === true ||
    hasExplicitSecureComObj ||
    sec?.toolKey !== undefined ||
    sec?.enableSecurityMode !== undefined ||
    sec?.initialSequenceNumberSending !== undefined ||
    (sec?.p2pKeys !== undefined && sec.p2pKeys.length > 0) ||
    (sec?.authorizedSenders !== undefined && sec.authorizedSenders.length > 0);

  if (!shouldCompile || sec?.enabled === false) {
    return undefined;
  }

  if (!app.isSecureEnabled) {
    warnings.push(
      `Application "${app.name}" does not declare IsSecureEnabled="true"; compiling Object 17 Security image as requested`,
    );
  }

  // Normalize explicit group keys keyed by 16-bit GA int
  const explicitGroupKeys = new Map<number, Buffer>();
  if (sec?.groupKeys) {
    for (const [gaRaw, keyVal] of Object.entries(sec.groupKeys)) {
      try {
        const { intValue } = normalizeKeyringGroupAddress(gaRaw);
        explicitGroupKeys.set(intValue, parseKey16(keyVal, `security.groupKeys[${gaRaw}]`));
      } catch (err: any) {
        warnings.push(`Invalid security.groupKeys entry "${gaRaw}": ${err?.message ?? err}`);
      }
    }
  }

  const lookupGroupKey = (ga: string): Buffer | undefined => {
    try {
      const { intValue } = normalizeKeyringGroupAddress(ga);
      const explicit = explicitGroupKeys.get(intValue);
      if (explicit) return explicit;
    } catch {
      // ignore malformed
    }
    return sec?.keyring?.getGroupKey(ga);
  };

  const defaultMode: GroupObjectSecurityMode = sec?.defaultGroupSecurityMode ?? "auth_conf";
  const modeOverrides = sec?.groupObjectSecurityModes ?? {};

  const resolveComObjectMode = (co: ResolvedComObject): GroupObjectSecurityMode => {
    const explicit =
      co.security ??
      modeOverrides[co.number] ??
      modeOverrides[String(co.number)] ??
      modeOverrides[co.name] ??
      modeOverrides[co.comObjectId] ??
      modeOverrides[co.comObjectRefId];
    if (explicit !== undefined) return explicit;
    if (co.groupAddresses.length === 0) return "plain";
    const hasAnyKey = co.groupAddresses.some((ga) => lookupGroupKey(ga) !== undefined);
    return hasAnyKey ? defaultMode : "plain";
  };

  // 1. PID_GO_SECURITY_FLAGS & PID_GRP_KEY_TABLE
  const goSecurityFlags = Buffer.alloc(Math.max(0, groupObjectCount), 0x00);
  const groupKeyByTsap = new Map<number, { gaIndex: number; groupAddress: string; key: Buffer }>();

  for (const [number, co] of evaluated.activeComObjects.entries()) {
    if (number < 1 || number > groupObjectCount) continue;
    const mode = resolveComObjectMode(co);
    if (mode === "plain" || co.groupAddresses.length === 0) continue;

    goSecurityFlags[number - 1] = encodeGoSecurityFlagByte(mode);

    for (const ga of co.groupAddresses) {
      const tsap = tsapByAddress.get(ga);
      const key = lookupGroupKey(ga);
      if (!key) {
        warnings.push(
          `Secure Group Object #${number} ("${co.name}") is linked to Group Address ${ga} which has no Group Key configured`,
        );
        continue;
      }
      if (tsap !== undefined && !groupKeyByTsap.has(tsap)) {
        groupKeyByTsap.set(tsap, { gaIndex: tsap, groupAddress: ga, key: Buffer.from(key) });
      }
    }
  }

  const groupKeyTable = Array.from(groupKeyByTsap.values()).sort((a, b) => a.gaIndex - b.gaIndex);

  if (app.maxSecurityGroupKeyTableEntries !== undefined && groupKeyTable.length > app.maxSecurityGroupKeyTableEntries) {
    warnings.push(
      `Security Group Key Table count (${groupKeyTable.length}) exceeds application MaxSecurityGroupKeyTableEntries (${app.maxSecurityGroupKeyTableEntries})`,
    );
  }

  // 2. PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE (sorted ascending by 16-bit IA)
  const iaEntriesByInt = new Map<number, { individualAddress: string; lastValidSeqNr: bigint }>();
  const addPartnerIa = (rawIa: string, seqNr: bigint = 0n) => {
    const trimmed = rawIa.trim();
    if (!KNXHelper.isValidIndividualAddress(trimmed)) {
      warnings.push(`Invalid Individual Address in security configuration: "${rawIa}"`);
      return;
    }
    const buf = KNXHelper.GetAddress(trimmed, ".");
    const intVal = buf.readUInt16BE(0);
    const canonical = KNXHelper.GetAddress(buf, ".") as string;
    const prev = iaEntriesByInt.get(intVal);
    if (!prev || seqNr > prev.lastValidSeqNr) {
      iaEntriesByInt.set(intVal, { individualAddress: canonical, lastValidSeqNr: seqNr });
    }
  };

  if (sec?.authorizedSenders) {
    for (const entry of sec.authorizedSenders) {
      if (typeof entry === "string") {
        addPartnerIa(entry, 0n);
      } else {
        const seq =
          entry.lastValidSeqNr === undefined
            ? 0n
            : typeof entry.lastValidSeqNr === "bigint"
              ? entry.lastValidSeqNr
              : BigInt(Math.max(0, Math.trunc(entry.lastValidSeqNr)));
        addPartnerIa(entry.individualAddress, seq);
      }
    }
  }

  if (sec?.keyring && sec.includeKeyringSenders !== false) {
    for (const gk of groupKeyTable) {
      for (const senderIa of sec.keyring.getGroupSenders(gk.groupAddress)) {
        addPartnerIa(senderIa, 0n);
      }
    }
  }

  if (sec?.p2pKeys) {
    for (const p2p of sec.p2pKeys) {
      addPartnerIa(p2p.individualAddress, 0n);
    }
  }

  const sortedIaInts = Array.from(iaEntriesByInt.keys()).sort((a, b) => a - b);
  const securityIndividualAddressTable = sortedIaInts.map((intVal) => iaEntriesByInt.get(intVal)!);
  const iaIndexByInt = new Map<number, number>();
  for (let i = 0; i < sortedIaInts.length; i++) {
    iaIndexByInt.set(sortedIaInts[i], i + 1); // 1-based IA index
  }

  if (
    app.maxSecurityIndividualAddressEntries !== undefined &&
    securityIndividualAddressTable.length > app.maxSecurityIndividualAddressEntries
  ) {
    warnings.push(
      `Security Individual Address Table count (${securityIndividualAddressTable.length}) exceeds application MaxSecurityIndividualAddressEntries (${app.maxSecurityIndividualAddressEntries})`,
    );
  }

  // 3. PID_P2P_KEY_TABLE (sorted ascending by 1-based iaIndex)
  const p2pKeyTable: { iaIndex: number; individualAddress: string; key: Buffer; roles: number }[] = [];
  if (sec?.p2pKeys) {
    for (const p2p of sec.p2pKeys) {
      if (!KNXHelper.isValidIndividualAddress(p2p.individualAddress.trim())) continue;
      const buf = KNXHelper.GetAddress(p2p.individualAddress.trim(), ".");
      const intVal = buf.readUInt16BE(0);
      const iaIndex = iaIndexByInt.get(intVal);
      if (iaIndex === undefined) continue;
      p2pKeyTable.push({
        iaIndex,
        individualAddress: KNXHelper.GetAddress(buf, ".") as string,
        key: parseKey16(p2p.key, `security.p2pKeys[${p2p.individualAddress}]`),
        roles: (p2p.roles ?? 0) & 0xffff,
      });
    }
    p2pKeyTable.sort((a, b) => a.iaIndex - b.iaIndex);
  }

  if (app.maxSecurityP2PKeyTableEntries !== undefined && p2pKeyTable.length > app.maxSecurityP2PKeyTableEntries) {
    warnings.push(
      `Security P2P Key Table count (${p2pKeyTable.length}) exceeds application MaxSecurityP2PKeyTableEntries (${app.maxSecurityP2PKeyTableEntries})`,
    );
  }

  // 4. Optional ToolKey, SecurityMode, Initial Sequence Number Sending
  const toolKey = sec?.toolKey !== undefined ? parseKey16(sec.toolKey, "security.toolKey") : undefined;
  let initialSequenceNumberSending: bigint | undefined;
  if (sec?.initialSequenceNumberSending === "auto") {
    initialSequenceNumberSending = computeDefaultSecuritySequenceNumber();
  } else if (sec?.initialSequenceNumberSending !== undefined) {
    initialSequenceNumberSending =
      typeof sec.initialSequenceNumberSending === "bigint"
        ? sec.initialSequenceNumberSending
        : BigInt(Math.max(1, Math.trunc(sec.initialSequenceNumberSending)));
  }

  return {
    objectInstance: sec?.objectInstance ?? 1,
    groupKeyTable,
    goSecurityFlags,
    securityIndividualAddressTable,
    p2pKeyTable,
    toolKey,
    enableSecurityMode: sec?.enableSecurityMode,
    initialSequenceNumberSending,
  };
}

/**
 * Multi-architecture KNX Application Program Binary Compiler.
 *
 * Supports:
 * - **System B** (`MV-07B0`, `MV-17B0`, `MV-27B0`, `MV-2920`, `MV-57B0`): RelativeSegments + Realisation Type 7 tables + Object 17 Data Secure
 * - **System 7 / BIM M112** (`MV-0700`, `MV-0701`, `MV-0705`, `MV-1900`, `MV-2705`, `MV-5705`): AbsoluteSegments + Realisation Type 2 tables (2B RAM ptrs)
 * - **System 2 / BCU2** (`MV-0020`, `MV-0021`, `MV-0025`): AbsoluteSegments + Realisation Type 1 tables (1B RAM ptrs) + UserMemory
 * - **System 1 / BCU1 & Couplers** (`MV-0010`–`MV-0013`, `MV-1011`–`MV-1013`, `MV-091A`, `MV-0912`): AbsoluteSegments + EEPROM tables + 8 KB Filter Table
 * - **System 300 / PropertyBased** (`MV-0300`): Property-mapped parameter writes (`A_PropertyValue_Write`)
 */
export class SystemBCompiler {
  public static compile(
    app: KnxApplicationProgram,
    config: DeviceApplicationConfig = {},
    preEvaluated?: EvaluatedApplicationState,
  ): CompiledSystemBImage {
    const evaluated = preEvaluated ?? DynamicEvaluator.evaluate(app, config);
    const warnings = [...evaluated.warnings];
    const managementModel: KnxManagementModel = resolveManagementModel(app.maskVersion, config.maskVersionDef);

    // 1. Initialize mutable memory segment copies (both RelativeSegment and AbsoluteSegment)
    const segmentImages = new Map<
      string,
      {
        kind: "RelativeSegment" | "AbsoluteSegment";
        image: Buffer;
        mask: Buffer;
        lsm: number;
        address?: number;
        userMemory?: boolean;
        memoryType?: string;
        patchedBytes: number;
      }
    >();
    for (const seg of app.codeSegments.values()) {
      const image = Buffer.from(seg.data);
      const mask = seg.mask ? Buffer.from(seg.mask) : Buffer.alloc(seg.size, 0xff);
      segmentImages.set(seg.id, {
        kind: seg.kind,
        image,
        mask,
        lsm: seg.loadStateMachine ?? 4,
        address: seg.address,
        userMemory: seg.userMemory,
        memoryType: seg.memoryType,
        patchedBytes: 0,
      });
    }

    // Group union members so inactive union slots don't clobber active ones
    const unions = new Map<string, KnxParameterDef[]>();
    for (const p of evaluated.allParameters.values()) {
      if (p.unionId) {
        let list = unions.get(p.unionId);
        if (!list) {
          list = [];
          unions.set(p.unionId, list);
        }
        list.push(p);
      }
    }

    const writeParam = (param: KnxParameterDef, value: string): void => {
      if (!param.memory) return;
      const segEntry = segmentImages.get(param.memory.codeSegment);
      if (!segEntry) {
        warnings.push(`Parameter "${param.name}" references unknown CodeSegment "${param.memory.codeSegment}"`);
        return;
      }
      const paramType = app.parameterTypes.get(param.parameterTypeId);
      if (!paramType) return;
      const encoded = encodeParameterValue(value, paramType, app.options);
      if (!encoded) return;

      const changed = patchBitsIntoBuffer(
        segEntry.image,
        segEntry.mask,
        param.memory.offset,
        param.memory.bitOffset,
        encoded.bitLength,
        encoded.buffer,
      );
      segEntry.patchedBytes += changed;
    };

    const downloadInvisible = (app.options.downloadInvisibleParameters ?? "All").toLowerCase();
    const writeBackgroundDefaults = downloadInvisible !== "none" && downloadInvisible !== "false";

    // Pass 1: Background defaults for inactive parameters (matching ETS DownloadInvisibleParameters="Background")
    if (writeBackgroundDefaults) {
      // Standalone non-union memory parameters
      for (const param of evaluated.allParameters.values()) {
        if (!param.memory || param.unionId) continue;
        if (evaluated.activeParameterIds.has(param.id) || evaluated.modifiedParameterIds.has(param.id)) continue;
        const val = evaluated.parameterValues.get(param.id) ?? param.defaultValue;
        writeParam(param, val);
      }

      // Inactive unions: write default union member (or first member if none marked DefaultUnionParameter)
      for (const members of unions.values()) {
        const hasActiveOrModified = members.some(
          (m) => evaluated.activeParameterIds.has(m.id) || evaluated.modifiedParameterIds.has(m.id),
        );
        if (hasActiveOrModified) continue;
        const defaultMember = members.find((m) => m.defaultUnionParameter) ?? members[0];
        if (defaultMember) {
          const val = evaluated.parameterValues.get(defaultMember.id) ?? defaultMember.defaultValue;
          writeParam(defaultMember, val);
        }
      }
    }

    // Pass 2: Active and explicitly modified parameters (always take precedence over background defaults!)
    // First apply modified non-active params (e.g. <Assign> or <ParameterCalculation> outputs), then active visible params
    for (const param of evaluated.allParameters.values()) {
      if (!param.memory) continue;
      if (evaluated.modifiedParameterIds.has(param.id) && !evaluated.activeParameterIds.has(param.id)) {
        const val = evaluated.parameterValues.get(param.id) ?? param.defaultValue;
        writeParam(param, val);
      }
    }
    for (const param of evaluated.allParameters.values()) {
      if (!param.memory) continue;
      if (evaluated.activeParameterIds.has(param.id)) {
        const val = evaluated.parameterValues.get(param.id) ?? param.defaultValue;
        writeParam(param, val);
      }
    }

    // 2. Extract hardware check properties (read-only) AND writable property-mapped parameters (System 300 / Couplers)
    const expectedProperties: CompiledSystemBImage["expectedProperties"] = [];
    const propertyWrites: CompiledPropertyWrite[] = [];
    const READ_ONLY_CHECK_PIDS = new Set([
      12 /* PID_MANUFACTURER_ID */, 13 /* PID_PROGRAM_VERSION */, 78 /* PID_HARDWARE_TYPE */,
    ]);

    for (const param of evaluated.allParameters.values()) {
      if (!param.property) continue;
      const pt = app.parameterTypes.get(param.parameterTypeId);
      if (!pt) continue;
      const val = evaluated.parameterValues.get(param.id) ?? param.defaultValue;
      const encoded = encodeParameterValue(val, pt, app.options);
      if (!encoded || encoded.buffer.length === 0) continue;

      const isReadOnlyHardwareCheck =
        param.property.objectIndex === 0 && READ_ONLY_CHECK_PIDS.has(param.property.propertyId);

      if (isReadOnlyHardwareCheck) {
        expectedProperties.push({
          objectIndex: param.property.objectIndex!,
          propertyId: param.property.propertyId,
          expectedValue: encoded.buffer,
          description: param.name,
        });
      } else if (
        param.access !== "Read" &&
        (evaluated.activeParameterIds.has(param.id) ||
          evaluated.modifiedParameterIds.has(param.id) ||
          managementModel === "PropertyBased")
      ) {
        propertyWrites.push({
          objectIndex: param.property.objectIndex,
          objectType: param.property.objectType,
          occurrence: param.property.occurrence,
          propertyId: param.property.propertyId,
          offset: param.property.offset,
          bitOffset: param.property.bitOffset,
          data: encoded.buffer,
          bitLength: encoded.bitLength,
          parameterName: param.name,
        });
      } else if (param.property.objectIndex !== undefined && param.access === "Read") {
        expectedProperties.push({
          objectIndex: param.property.objectIndex,
          propertyId: param.property.propertyId,
          expectedValue: encoded.buffer,
          description: param.name,
        });
      }
    }

    // 3. Compile Group Tables (System B Realisation Type 7 OR Legacy BCU1/BCU2/BIM M112 Realisation Type 1/2)
    const allGroupAddresses: string[] = [];
    for (const co of evaluated.activeComObjects.values()) {
      for (const ga of co.groupAddresses) {
        allGroupAddresses.push(ga);
      }
    }

    const isLegacyMemoryModel =
      managementModel === "Bcu1" || managementModel === "Bcu2" || managementModel === "BimM112";
    const hasLegacyTableSegments =
      isLegacyMemoryModel &&
      Boolean(app.addressTable?.codeSegment || app.associationTable?.codeSegment || app.comObjectTable?.codeSegment);

    let gratBuffer: Buffer;
    let sortedAddresses: string[];
    let tsapByAddress: Map<string, number>;
    let groatBuffer: Buffer;
    let inferredFormat: 0 | 1;
    let associationCount: number;
    let grotBuffer: Buffer;
    let groupObjectCount: number;

    if (hasLegacyTableSegments) {
      // --- Legacy BCU1 / BCU2 / BIM M112 (Realisation Type 1 / 2) ---
      const addrSeg = app.addressTable?.codeSegment ? segmentImages.get(app.addressTable.codeSegment) : undefined;
      const addrOff = app.addressTable?.offset ?? 0;
      const existingGrat = addrSeg ? addrSeg.image.subarray(addrOff) : undefined;

      const legacyGrat = compileLegacyGroupAddressTable(allGroupAddresses, config.individualAddress, existingGrat);
      gratBuffer = legacyGrat.buffer;
      sortedAddresses = legacyGrat.sortedAddresses;
      tsapByAddress = legacyGrat.tsapByAddress;

      if (sortedAddresses.length > app.addressTableMaxEntries) {
        warnings.push(
          `Group Address count (${sortedAddresses.length}) exceeds AddressTable MaxEntries (${app.addressTableMaxEntries})`,
        );
      }

      // Patch GrAT into its target AbsoluteSegment
      if (addrSeg) {
        const maxTableBytes = Math.min(addrSeg.image.length - addrOff, 1 + (1 + app.addressTableMaxEntries) * 2);
        if (maxTableBytes > 0) {
          // Clear unused trailing placeholder slots in AddressTable, then copy compiled GrAT
          addrSeg.image.fill(0x00, addrOff, addrOff + maxTableBytes);
          const copyLen = Math.min(gratBuffer.length, addrSeg.image.length - addrOff);
          gratBuffer.copy(addrSeg.image, addrOff, 0, copyLen);
          addrSeg.mask.fill(0xff, addrOff, addrOff + maxTableBytes);
          addrSeg.patchedBytes += copyLen;
        }
      }

      const legacyGroat = compileLegacyAssociationTable(evaluated.activeComObjects, tsapByAddress);
      groatBuffer = legacyGroat.buffer;
      inferredFormat = 0;
      associationCount = legacyGroat.count;

      if (associationCount > app.associationTableMaxEntries) {
        warnings.push(
          `Association count (${associationCount}) exceeds AssociationTable MaxEntries (${app.associationTableMaxEntries})`,
        );
      }

      // Patch GrOAT into its target AbsoluteSegment
      const assocSeg = app.associationTable?.codeSegment
        ? segmentImages.get(app.associationTable.codeSegment)
        : undefined;
      const assocOff = app.associationTable?.offset ?? 0;
      if (assocSeg) {
        const maxAssocBytes = Math.min(assocSeg.image.length - assocOff, 1 + app.associationTableMaxEntries * 2);
        if (maxAssocBytes > 0) {
          assocSeg.image.fill(0x00, assocOff, assocOff + maxAssocBytes);
          const copyLen = Math.min(groatBuffer.length, assocSeg.image.length - assocOff);
          groatBuffer.copy(assocSeg.image, assocOff, 0, copyLen);
          assocSeg.mask.fill(0xff, assocOff, assocOff + maxAssocBytes);
          assocSeg.patchedBytes += copyLen;
        }
      }

      // Patch GrOT into its target AbsoluteSegment (preserving pre-populated RAM pointers!)
      const coSeg = app.comObjectTable?.codeSegment ? segmentImages.get(app.comObjectTable.codeSegment) : undefined;
      const coOff = app.comObjectTable?.offset ?? 0;
      const existingGrot = coSeg ? coSeg.image.subarray(coOff) : undefined;
      const pointerSize: 1 | 2 = managementModel === "BimM112" ? 2 : 1;
      const computedCoSlots =
        evaluated.allComObjects.size === 0
          ? 0
          : evaluated.comObjectNumberBase === 0
            ? evaluated.maxComObjectNumber + 1
            : evaluated.maxComObjectNumber;
      const requestedCoCount = config.groupObjectTableSize ?? computedCoSlots;

      grotBuffer = compileLegacyGroupObjectTable(evaluated.activeComObjects, requestedCoCount, {
        pointerSize,
        clearCommunicationFlagWhenUnlinked: config.clearCommunicationFlagWhenUnlinked ?? true,
        existingTable: existingGrot,
        littleEndianPointers: app.options.parameterByteOrder === "LittleEndian",
      });
      groupObjectCount = grotBuffer.length > 0 ? grotBuffer[0] : 0;

      if (coSeg && grotBuffer.length > 0) {
        const copyLen = Math.min(grotBuffer.length, coSeg.image.length - coOff);
        grotBuffer.copy(coSeg.image, coOff, 0, copyLen);
        coSeg.mask.fill(0xff, coOff, coOff + copyLen);
        coSeg.patchedBytes += copyLen;
      }
    } else {
      // --- Standard System B (Realisation Type 7 / 6) ---
      const grat = compileGroupAddressTable(allGroupAddresses);
      gratBuffer = grat.buffer;
      sortedAddresses = grat.sortedAddresses;
      tsapByAddress = grat.tsapByAddress;

      if (sortedAddresses.length > app.addressTableMaxEntries) {
        warnings.push(
          `Group Address count (${sortedAddresses.length}) exceeds AddressTable MaxEntries (${app.addressTableMaxEntries})`,
        );
      }

      inferredFormat =
        config.associationTableFormat ??
        (app.addressTableMaxEntries > 255 || app.associationTableMaxEntries > 255 || evaluated.maxComObjectNumber > 255
          ? 1
          : 0);

      const groat = compileAssociationTable(evaluated.activeComObjects, tsapByAddress, inferredFormat);
      groatBuffer = groat.buffer;
      associationCount = groat.count;

      if (associationCount > app.associationTableMaxEntries) {
        warnings.push(
          `Association count (${associationCount}) exceeds AssociationTable MaxEntries (${app.associationTableMaxEntries})`,
        );
      }

      groupObjectCount = config.groupObjectTableSize ?? evaluated.maxComObjectNumber;
      grotBuffer = compileGroupObjectTable(
        evaluated.activeComObjects,
        groupObjectCount,
        config.clearCommunicationFlagWhenUnlinked ?? true,
      );
    }

    // Build compiled segment maps AFTER legacy table patching so AbsoluteSegments include GrAT/GrOAT/GrOT!
    const segments = new Map<number, CompiledMemorySegment>();
    const absoluteSegments: CompiledMemorySegment[] = [];
    const segmentsById = new Map<string, CompiledMemorySegment>();

    for (const [segId, entry] of segmentImages.entries()) {
      const compiledSeg: CompiledMemorySegment = {
        segmentId: segId,
        loadStateMachine: entry.lsm,
        size: entry.image.length,
        address: entry.address,
        userMemory: entry.userMemory,
        memoryType: entry.memoryType,
        image: entry.image,
        mask: entry.mask,
        crc16: crc16Ccitt(entry.image),
        patchedByteCount: entry.patchedBytes,
      };
      segmentsById.set(segId, compiledSeg);
      if (entry.kind === "AbsoluteSegment") {
        absoluteSegments.push(compiledSeg);
      } else {
        segments.set(entry.lsm, compiledSeg);
      }
    }
    absoluteSegments.sort((a, b) => (a.address ?? 0) - (b.address ?? 0));

    // 4. Optional Coupler Filter Table (`MV-091A`, `MV-0912`, `MV-2920`)
    let filterTable: Buffer | undefined;
    if (config.filterTable !== undefined) {
      filterTable = compileCouplerFilterTable(config.filterTable, 8192);
    } else if (config.filterTableGroupAddresses !== undefined) {
      filterTable = compileCouplerFilterTable(config.filterTableGroupAddresses, 8192);
    } else if (isCouplerMaskVersion(app.maskVersion)) {
      filterTable = Buffer.alloc(8192, 0x00);
    }

    const isAreaCoupler =
      config.isAreaCoupler !== undefined
        ? config.isAreaCoupler
        : config.individualAddress
          ? /^[1-9]\d*\.0\.0$/.test(config.individualAddress.trim())
          : undefined;

    // 5. Build 5-byte PID_PROGRAM_VERSION (MfrId 2B + AppNr 2B + AppVer 1B)
    const programVersion = Buffer.alloc(5);
    programVersion.writeUInt16BE(app.manufacturerId & 0xffff, 0);
    programVersion.writeUInt16BE(app.applicationNumber & 0xffff, 2);
    programVersion.writeUInt8(app.applicationVersion & 0xff, 4);

    // 6. Optional Phase 2 KNX Data Secure Object 17 image
    const securityImage = compileSecurityObjectImage(app, evaluated, tsapByAddress, groupObjectCount, config, warnings);

    return {
      applicationId: app.id,
      applicationName: app.name,
      maskVersion: app.maskVersion,
      managementModel,
      manufacturerId: app.manufacturerId,
      applicationNumber: app.applicationNumber,
      applicationVersion: app.applicationVersion,
      programVersion,
      groupAddressTable: gratBuffer,
      groupAddresses: sortedAddresses,
      associationTable: groatBuffer,
      associationTableFormat: inferredFormat,
      associationCount,
      groupObjectTable: grotBuffer,
      groupObjectCount,
      segments,
      absoluteSegments,
      segmentsById,
      filterTable,
      individualAddress: config.individualAddress,
      isAreaCoupler,
      propertyWrites,
      evaluated,
      warnings,
      expectedProperties,
      securityImage,
    };
  }

  /**
   * Extracts writable byte spans covering absolute memory range `[address, address + size)` across
   * all compiled `<AbsoluteSegment>` blocks (respecting each segment's `mask`, `userMemory` flag,
   * and optional `previousAbsoluteSegments` for byte-level differential writes).
   */
  public static extractAbsoluteMemorySpans(
    image: CompiledSystemBImage,
    address: number,
    size: number,
    options: {
      skipZeroMask?: boolean;
      previousAbsoluteSegments?: Map<string, Buffer>;
      coalesceGapBytes?: number;
    } = {},
  ): { address: number; data: Buffer; userMemory: boolean }[] {
    if (size <= 0) return [];
    const reqStart = address;
    const reqEnd = address + size;
    const skipZeroMask = options.skipZeroMask ?? true;
    const results: { address: number; data: Buffer; userMemory: boolean }[] = [];

    for (const seg of image.absoluteSegments) {
      if (seg.address === undefined || seg.size <= 0) continue;
      const segStart = seg.address;
      const segEnd = segStart + seg.size;
      const overlapStart = Math.max(reqStart, segStart);
      const overlapEnd = Math.min(reqEnd, segEnd);
      if (overlapEnd <= overlapStart) continue;

      const localStart = overlapStart - segStart;
      const localLen = overlapEnd - overlapStart;
      const prevImg = options.previousAbsoluteSegments?.get(seg.segmentId);

      if (!skipZeroMask && !prevImg) {
        results.push({
          address: overlapStart,
          data: Buffer.from(seg.image.subarray(localStart, localStart + localLen)),
          userMemory: Boolean(seg.userMemory),
        });
      } else {
        const spans = this.extractWritableSpans(seg, {
          offset: localStart,
          size: localLen,
          skipFillRuns: false,
          previousImage: prevImg,
          coalesceGapBytes: options.coalesceGapBytes,
        });
        for (const sp of spans) {
          results.push({
            address: segStart + sp.offset,
            data: Buffer.from(sp.data),
            userMemory: Boolean(seg.userMemory),
          });
        }
      }
    }

    return results;
  }

  /**
   * Recompiles only Object 2 (`GrOAT`) when live device probing reveals a different format (0 vs 1).
   */
  public static recompileAssociationTable(image: CompiledSystemBImage, format: 0 | 1): CompiledSystemBImage {
    if (image.associationTableFormat === format) return image;
    const tsapByAddress = new Map<string, number>();
    for (let i = 0; i < image.groupAddresses.length; i++) {
      tsapByAddress.set(image.groupAddresses[i], i + 1);
    }
    const groat = compileAssociationTable(image.evaluated.activeComObjects, tsapByAddress, format);
    return {
      ...image,
      associationTable: groat.buffer,
      associationTableFormat: format,
      associationCount: groat.count,
    };
  }

  /**
   * Splits a `CompiledMemorySegment` into contiguous writable byte spans:
   * - Excludes bytes where `mask[i] === 0x00` (unowned/reserved firmware gaps like offsets 240..511 in Zennio).
   * - When `previousImage` (same length) is provided, computes **byte-level differential delta spans**
   *   writing only bytes that actually changed relative to `previousImage` (coalescing tiny unchanged gaps
   *   `<= coalesceGapBytes` where `mask !== 0x00` to minimize APDU frame overhead).
   * - When `mode === 1` and `skipFillRuns` is true, also skips contiguous runs of `>= minFillRun` bytes
   *   already equal to `fill` (since the device pre-filled the segment during `LdCtrlRelSegment`).
   */
  public static extractWritableSpans(
    segment: CompiledMemorySegment,
    options: {
      offset?: number;
      size?: number;
      mode?: number;
      fill?: number;
      skipFillRuns?: boolean;
      minFillRun?: number;
      previousImage?: Buffer;
      coalesceGapBytes?: number;
    } = {},
  ): MemoryWriteSpan[] {
    const start = Math.max(0, options.offset ?? 0);
    const end = Math.min(segment.size, start + (options.size ?? segment.size));

    // Differential delta mode: write ONLY bytes that changed vs `previousImage` (respecting `mask`)
    if (options.previousImage && options.previousImage.length === segment.size) {
      const prev = options.previousImage;
      const maxGap = Math.max(0, options.coalesceGapBytes ?? 4);
      const rawDiffs: MemoryWriteSpan[] = [];
      let cursor = start;
      while (cursor < end) {
        while (cursor < end && (segment.mask[cursor] === 0x00 || segment.image[cursor] === prev[cursor])) {
          cursor++;
        }
        if (cursor >= end) break;
        let runEnd = cursor + 1;
        while (runEnd < end && segment.mask[runEnd] !== 0x00 && segment.image[runEnd] !== prev[runEnd]) {
          runEnd++;
        }
        rawDiffs.push({ offset: cursor, data: segment.image.subarray(cursor, runEnd) });
        cursor = runEnd;
      }

      if (rawDiffs.length <= 1 || maxGap === 0) return rawDiffs;

      // Coalesce adjacent changed spans separated by <= maxGap writable bytes (mask !== 0)
      const merged: MemoryWriteSpan[] = [rawDiffs[0]];
      for (let i = 1; i < rawDiffs.length; i++) {
        const last = merged[merged.length - 1];
        const cur = rawDiffs[i];
        const lastEnd = last.offset + last.data.length;
        const gap = cur.offset - lastEnd;
        let gapWritable = gap <= maxGap;
        if (gapWritable) {
          for (let g = lastEnd; g < cur.offset; g++) {
            if (segment.mask[g] === 0x00) {
              gapWritable = false;
              break;
            }
          }
        }
        if (gapWritable) {
          const nextEnd = cur.offset + cur.data.length;
          merged[merged.length - 1] = {
            offset: last.offset,
            data: segment.image.subarray(last.offset, nextEnd),
          };
        } else {
          merged.push(cur);
        }
      }
      return merged;
    }

    const skipFill = (options.skipFillRuns ?? true) && options.mode === 1;
    const fillByte = (options.fill ?? 0) & 0xff;
    const minFillRun = options.minFillRun ?? 8;

    const spans: MemoryWriteSpan[] = [];
    let cursor = start;

    while (cursor < end) {
      // Skip mask === 0x00 bytes
      while (cursor < end && segment.mask[cursor] === 0x00) {
        cursor++;
      }
      if (cursor >= end) break;

      // Find maximal mask !== 0 run
      let runEnd = cursor;
      while (runEnd < end && segment.mask[runEnd] !== 0x00) {
        runEnd++;
      }

      if (!skipFill) {
        spans.push({ offset: cursor, data: segment.image.subarray(cursor, runEnd) });
      } else {
        // Split run around long runs of fillByte (>= minFillRun)
        let subStart = cursor;
        let i = cursor;
        while (i < runEnd) {
          if (segment.image[i] === fillByte) {
            let fillEnd = i;
            while (fillEnd < runEnd && segment.image[fillEnd] === fillByte) fillEnd++;
            if (fillEnd - i >= minFillRun) {
              if (i > subStart) {
                spans.push({ offset: subStart, data: segment.image.subarray(subStart, i) });
              }
              subStart = fillEnd;
            }
            i = fillEnd;
          } else {
            i++;
          }
        }
        if (runEnd > subStart) {
          spans.push({ offset: subStart, data: segment.image.subarray(subStart, runEnd) });
        }
      }

      cursor = runEnd;
    }

    return spans;
  }
}

/**
 * Encodes a compiled device image's memory segments into a compact zlib-compressed Base64 snapshot
 * suitable for persisting in `DeviceInstance.loadedImage` (enabling fast byte-level differential downloads).
 */
export function encodeKnxTsLoadedImage(image: CompiledSystemBImage): string {
  const rel: Record<string, string> = {};
  for (const [lsm, seg] of image.segments.entries()) {
    rel[String(lsm)] = seg.image.toString("base64");
  }
  const abs: Record<string, string> = {};
  for (const seg of image.absoluteSegments) {
    abs[seg.segmentId] = seg.image.toString("base64");
  }
  const payload = JSON.stringify({
    format: "knx.ts-loaded-image-v1",
    applicationId: image.applicationId,
    maskVersion: image.maskVersion,
    segments: rel,
    absoluteSegments: abs,
  });
  return zlib.deflateSync(Buffer.from(payload, "utf8")).toString("base64");
}

/**
 * Decodes a `knx.ts` Base64 `LoadedImage` snapshot back into `previousSegments` / `previousAbsoluteSegments`.
 * Returns `undefined` gracefully if the string is an opaque native ETS `LoadedImage` binary blob.
 */
export function decodeKnxTsLoadedImage(loadedImageBase64?: string):
  | {
      applicationId: string;
      maskVersion: number;
      segments: Map<number, Buffer>;
      absoluteSegments: Map<string, Buffer>;
    }
  | undefined {
  if (!loadedImageBase64 || loadedImageBase64.trim() === "") return undefined;
  try {
    const raw = Buffer.from(loadedImageBase64.replace(/\s+/g, ""), "base64");
    const inflated = zlib.inflateSync(raw).toString("utf8");
    const parsed = JSON.parse(inflated);
    if (!parsed || parsed.format !== "knx.ts-loaded-image-v1") return undefined;
    const segments = new Map<number, Buffer>();
    for (const [k, v] of Object.entries(parsed.segments ?? {})) {
      if (typeof v === "string") segments.set(Number(k), Buffer.from(v, "base64"));
    }
    const absoluteSegments = new Map<string, Buffer>();
    for (const [k, v] of Object.entries(parsed.absoluteSegments ?? {})) {
      if (typeof v === "string") absoluteSegments.set(k, Buffer.from(v, "base64"));
    }
    return {
      applicationId: String(parsed.applicationId ?? ""),
      maskVersion: Number(parsed.maskVersion ?? 0),
      segments,
      absoluteSegments,
    };
  } catch {
    return undefined;
  }
}

/**
 * Multi-architecture alias for {@link SystemBCompiler} (supports System B, System 7 BIM M112,
 * System 2 BCU2, System 1 BCU1, Couplers `MV-091A`/`MV-2920`, and System 300 PropertyBased).
 */
export const KNXApplicationCompiler = SystemBCompiler;
