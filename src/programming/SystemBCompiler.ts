import { normalizeKeyringGroupAddress } from "../security/KnxKeyring";
import { parseKey16 } from "../security/KnxSecureKeys";
import { KNXHelper } from "../utils/KNXHelper";
import { DynamicEvaluator } from "./DynamicEvaluator";
import {
  CompiledMemorySegment,
  CompiledSystemBImage,
  DeviceApplicationConfig,
  EvaluatedApplicationState,
  GroupObjectPriority,
  GroupObjectSecurityMode,
  KnxApplicationOptions,
  KnxApplicationProgram,
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
 * Compiles a KNX `ApplicationProgram` + `DeviceApplicationConfig` into a complete System B (`0x07B0`) binary image.
 */
export class SystemBCompiler {
  public static compile(
    app: KnxApplicationProgram,
    config: DeviceApplicationConfig = {},
    preEvaluated?: EvaluatedApplicationState,
  ): CompiledSystemBImage {
    const evaluated = preEvaluated ?? DynamicEvaluator.evaluate(app, config);
    const warnings = [...evaluated.warnings];

    // 1. Initialize mutable memory segment copies
    const segmentImages = new Map<string, { image: Buffer; mask: Buffer; lsm: number; patchedBytes: number }>();
    for (const seg of app.codeSegments.values()) {
      const image = Buffer.from(seg.data);
      const mask = seg.mask ? Buffer.from(seg.mask) : Buffer.alloc(seg.size, 0xff);
      segmentImages.set(seg.id, {
        image,
        mask,
        lsm: seg.loadStateMachine ?? 4,
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

    // Build compiled segment map keyed by LoadStateMachine index (e.g. 4)
    const segments = new Map<number, CompiledMemorySegment>();
    for (const [segId, entry] of segmentImages.entries()) {
      segments.set(entry.lsm, {
        segmentId: segId,
        loadStateMachine: entry.lsm,
        size: entry.image.length,
        image: entry.image,
        mask: entry.mask,
        crc16: crc16Ccitt(entry.image),
        patchedByteCount: entry.patchedBytes,
      });
    }

    // 2. Extract expected hardware properties (e.g., checkHW -> Object 0 PID_HARDWARE_TYPE = 78)
    const expectedProperties: CompiledSystemBImage["expectedProperties"] = [];
    for (const param of evaluated.allParameters.values()) {
      if (!param.property) continue;
      const pt = app.parameterTypes.get(param.parameterTypeId);
      if (!pt) continue;
      const val = evaluated.parameterValues.get(param.id) ?? param.defaultValue;
      const encoded = encodeParameterValue(val, pt, app.options);
      if (encoded && encoded.buffer.length > 0 && param.property.objectIndex !== undefined) {
        expectedProperties.push({
          objectIndex: param.property.objectIndex,
          propertyId: param.property.propertyId,
          expectedValue: encoded.buffer,
          description: param.name,
        });
      }
    }

    // 3. Compile System B Group Tables (Objects 1, 2, 3)
    const allGroupAddresses: string[] = [];
    for (const co of evaluated.activeComObjects.values()) {
      for (const ga of co.groupAddresses) {
        allGroupAddresses.push(ga);
      }
    }

    const grat = compileGroupAddressTable(allGroupAddresses);
    if (grat.sortedAddresses.length > app.addressTableMaxEntries) {
      warnings.push(
        `Group Address count (${grat.sortedAddresses.length}) exceeds AddressTable MaxEntries (${app.addressTableMaxEntries})`,
      );
    }

    const inferredFormat: 0 | 1 =
      config.associationTableFormat ??
      (app.addressTableMaxEntries > 255 || app.associationTableMaxEntries > 255 || evaluated.maxComObjectNumber > 255
        ? 1
        : 0);

    const groat = compileAssociationTable(evaluated.activeComObjects, grat.tsapByAddress, inferredFormat);
    if (groat.count > app.associationTableMaxEntries) {
      warnings.push(
        `Association count (${groat.count}) exceeds AssociationTable MaxEntries (${app.associationTableMaxEntries})`,
      );
    }

    const groupObjectCount = config.groupObjectTableSize ?? evaluated.maxComObjectNumber;
    const grot = compileGroupObjectTable(
      evaluated.activeComObjects,
      groupObjectCount,
      config.clearCommunicationFlagWhenUnlinked ?? true,
    );

    // 4. Build 5-byte PID_PROGRAM_VERSION (MfrId 2B + AppNr 2B + AppVer 1B)
    const programVersion = Buffer.alloc(5);
    programVersion.writeUInt16BE(app.manufacturerId & 0xffff, 0);
    programVersion.writeUInt16BE(app.applicationNumber & 0xffff, 2);
    programVersion.writeUInt8(app.applicationVersion & 0xff, 4);

    // 5. Optional Phase 2 KNX Data Secure Object 17 image
    const securityImage = compileSecurityObjectImage(
      app,
      evaluated,
      grat.tsapByAddress,
      groupObjectCount,
      config,
      warnings,
    );

    return {
      applicationId: app.id,
      applicationName: app.name,
      maskVersion: app.maskVersion,
      manufacturerId: app.manufacturerId,
      applicationNumber: app.applicationNumber,
      applicationVersion: app.applicationVersion,
      programVersion,
      groupAddressTable: grat.buffer,
      groupAddresses: grat.sortedAddresses,
      associationTable: groat.buffer,
      associationTableFormat: inferredFormat,
      associationCount: groat.count,
      groupObjectTable: grot,
      groupObjectCount,
      segments,
      evaluated,
      warnings,
      expectedProperties,
      securityImage,
    };
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
    } = {},
  ): MemoryWriteSpan[] {
    const start = Math.max(0, options.offset ?? 0);
    const end = Math.min(segment.size, start + (options.size ?? segment.size));
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
