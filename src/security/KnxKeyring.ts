import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { KNXHelper } from "../utils/KNXHelper";
import type { KnxDataSecure } from "./KnxDataSecure";
import { deriveKeyringPasswordKey, parseKey16 } from "./KnxSecureKeys";

/**
 * Normalizes a KNX Group Address from ETS integer string (e.g. `"2049"`), number (`2049`),
 * 2-level string (`"1/1"`), or 3-level string (`"1/0/1"`) to canonical 3-level string (`"1/0/1"`) and 16-bit integer.
 */
export function normalizeKeyringGroupAddress(address: string | number): {
  formatted: string;
  intValue: number;
} {
  if (typeof address === "number") {
    const intValue = address & 0xffff;
    return { formatted: KNXHelper.GetAddress(intValue, "/"), intValue };
  }
  const trimmed = address.trim();
  if (/^\d+$/.test(trimmed)) {
    const intValue = parseInt(trimmed, 10) & 0xffff;
    return { formatted: KNXHelper.GetAddress(intValue, "/"), intValue };
  }
  const buf = KNXHelper.GetAddress_(trimmed);
  const intValue = buf.readUInt16BE(0);
  return { formatted: KNXHelper.GetAddress(buf, "/"), intValue };
}

export interface KeyringInterfaceEntry {
  type: string;
  individualAddress: string;
  host?: string;
  userId?: number;
  password?: string;
  authentication?: string;
  decryptedPassword?: string;
  decryptedAuthentication?: string;
  groupAddresses: Map<string, string[]>;
}

export interface KeyringBackboneEntry {
  key?: string;
  decryptedKey?: Buffer;
  latency?: number;
  multicastAddress?: string;
}

export interface KeyringGroupAddressEntry {
  /** Raw `Address` attribute as stored in the XML (e.g. `"2049"` in ETS5 or `"1/2/3"`). */
  address: string;
  /** Canonical 3-level group address (e.g. `"1/0/1"`). */
  addressFormatted?: string;
  /** 16-bit unsigned integer encoding of the group address (e.g. `2049`). */
  addressInt?: number;
  key: string;
  decryptedKey?: Buffer;
}

export interface KeyringDeviceEntry {
  individualAddress: string;
  toolKey?: string;
  decryptedToolKey?: Buffer;
  managementPassword?: string;
  decryptedManagementPassword?: string;
  authentication?: string;
  decryptedAuthentication?: string;
  sequenceNumber?: number;
  /** Exact 48-bit sequence number as BigInt (lossless up to `0xFFFFFFFFFFFFn`). */
  sequenceNumberBigInt?: bigint;
  serialNumber?: string;
}

export interface KeyringLoadOptions {
  /**
   * Verify the ETS keyring signature (default: true).
   */
  validateSignature?: boolean;
}

export interface KeyringMetadata {
  /** Optional ETS project name (`Project="..."` attribute on `<Keyring>`). */
  project?: string;
  /** Tool identifier written into `CreatedBy="..."` (defaults to `"KNX.ts"`). */
  createdBy?: string;
  /** ISO-8601 creation timestamp written into `Created="..."` (also derives the AES-128-CBC IV). */
  created?: string;
}

export interface KeyringBackboneInput {
  /** 16-byte Backbone Key (`Buffer`, 32-char hex string, or `"generate"` / omitted for CSPRNG generation). */
  key?: Buffer | string | "generate";
  /** Multicast IPv4 address (defaults to `"224.0.23.12"`). */
  multicastAddress?: string;
  /** Routing latency tolerance in milliseconds (defaults to `2000`). */
  latency?: number;
}

export interface KeyringDeviceInput {
  /** Target KNX Individual Address (e.g. `"1.1.1"`). */
  individualAddress: string;
  /** 16-byte Device Tool Key (`Buffer`, 32-char hex string, or `"generate"` for CSPRNG generation). */
  toolKey?: Buffer | string | "generate";
  /** Optional plaintext Management Password (encrypted with random 8B salt + PKCS#7 on export). */
  managementPassword?: string;
  /** Optional plaintext Device Authentication Code (encrypted with random 8B salt + PKCS#7 on export). */
  authentication?: string;
  /** Next sending 48-bit Sequence Number exported in `SequenceNumber="..."`. */
  sequenceNumber?: bigint | number;
  /** Optional 6-byte KNX Serial Number (12-char hex string or 6-byte Buffer). */
  serialNumber?: Buffer | string;
  /** When true (default), preserves existing fields on the device entry if omitted in this call. */
  merge?: boolean;
}

export interface KeyringInterfaceInput {
  /** Interface Individual Address (e.g. `"1.1.200"`). */
  individualAddress: string;
  /** Interface type (`"Tunnelling"`, `"Backbone"`, `"USB"`, etc.). Defaults to `"Tunnelling"`. */
  type?: string;
  /** Optional host Individual Address (e.g. `"1.1.0"`). */
  host?: string;
  /** Optional KNX IP Secure User ID (1..127). */
  userId?: number;
  /** Optional plaintext Tunneling User Password. */
  password?: string;
  /** Optional plaintext Interface Authentication Code. */
  authentication?: string;
  /** Optional Group Address -> authorized sender IAs map (`<Group Address="..." Senders="..." />`). */
  groupAddresses?: Record<string, string[]> | Map<string, string[]>;
  /** When true (default), preserves existing fields and group address links if omitted in this call. */
  merge?: boolean;
}

export interface KeyringExportOptions {
  /** Override `Project="..."` attribute. */
  project?: string;
  /** Override `CreatedBy="..."` attribute (defaults to existing `createdBy` or `"KNX.ts"`). */
  createdBy?: string;
  /** Override `Created="..."` attribute (`Date` or ISO-8601 string). Controls the AES-128-CBC IV. */
  created?: string | Date;
  /**
   * Format for `<Group Address="..." />` attributes:
   * - `"3-level"` *(default)*: `"1/0/1"` (ETS 6 / xknx standard)
   * - `"integer"`: `"2049"` (ETS 5 integer encoding)
   */
  groupAddressFormat?: "3-level" | "integer";
  /**
   * Output container format for `toBuffer()` / `saveFile()`:
   * - `"xml"` *(default)*: UTF-8 XML directly (matches native ETS 5 / ETS 6 `.knxkeys` files)
   * - `"zip"`: Standard DEFLATE ZIP archive containing the signed XML entry
   */
  format?: "xml" | "zip";
  /** Prepend UTF-8 BOM (`0xEF 0xBB 0xBF`) when `format === "xml"` (default: `true`, matching ETS). */
  includeBom?: boolean;
  /** Entry filename inside the ZIP archive when `format === "zip"` (defaults to `<project>.xml` or `"keyring.xml"`). */
  zipEntryName?: string;
}

interface XmlElementNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlElementNode[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseIndividualAddressSortable(ia: string): number {
  try {
    return KNXHelper.GetAddress_(ia).readUInt16BE(0);
  } catch {
    return 0x10000;
  }
}

function formatIsoCreated(input?: string | Date): string {
  if (typeof input === "string" && input.trim()) return input.trim();
  const date = input instanceof Date ? input : new Date();
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildSingleFileZip(entryName: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(entryName, "utf8");
  const crc = computeCrc32(content);
  const compressed = zlib.deflateRawSync(content);

  // Local File Header (30 bytes + filename)
  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0); // Local file header signature
  lfh.writeUInt16LE(20, 4); // Version needed to extract (2.0)
  lfh.writeUInt16LE(0x0800, 6); // General purpose bit flag (UTF-8 filename)
  lfh.writeUInt16LE(8, 8); // Compression method: DEFLATE
  lfh.writeUInt16LE(0, 10); // Mod time
  lfh.writeUInt16LE(0, 12); // Mod date
  lfh.writeUInt32LE(crc, 14); // CRC-32
  lfh.writeUInt32LE(compressed.length, 18); // Compressed size
  lfh.writeUInt32LE(content.length, 22); // Uncompressed size
  lfh.writeUInt16LE(nameBuf.length, 26); // File name length
  lfh.writeUInt16LE(0, 28); // Extra field length
  nameBuf.copy(lfh, 30);

  const cdOffset = lfh.length + compressed.length;

  // Central Directory File Header (46 bytes + filename)
  const cdfh = Buffer.alloc(46 + nameBuf.length);
  cdfh.writeUInt32LE(0x02014b50, 0); // Central directory file header signature
  cdfh.writeUInt16LE(20, 4); // Version made by
  cdfh.writeUInt16LE(20, 6); // Version needed to extract
  cdfh.writeUInt16LE(0x0800, 8); // UTF-8 filename flag
  cdfh.writeUInt16LE(8, 10); // Compression method: DEFLATE
  cdfh.writeUInt16LE(0, 12); // Mod time
  cdfh.writeUInt16LE(0, 14); // Mod date
  cdfh.writeUInt32LE(crc, 16); // CRC-32
  cdfh.writeUInt32LE(compressed.length, 20); // Compressed size
  cdfh.writeUInt32LE(content.length, 24); // Uncompressed size
  cdfh.writeUInt16LE(nameBuf.length, 28); // File name length
  cdfh.writeUInt16LE(0, 30); // Extra field length
  cdfh.writeUInt16LE(0, 32); // File comment length
  cdfh.writeUInt16LE(0, 34); // Disk number start
  cdfh.writeUInt16LE(0, 36); // Internal file attributes
  cdfh.writeUInt32LE(0, 38); // External file attributes
  cdfh.writeUInt32LE(0, 42); // Relative offset of local header
  nameBuf.copy(cdfh, 46);

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk with start of central directory
  eocd.writeUInt16LE(1, 8); // Total entries on this disk
  eocd.writeUInt16LE(1, 10); // Total entries
  eocd.writeUInt32LE(cdfh.length, 12); // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([lfh, compressed, cdfh, eocd]);
}

function encryptKey16AesCbc(key16: Buffer, passwordHash: Buffer, iv: Buffer): string {
  if (key16.length !== 16) {
    throw new Error(`Expected 16-byte key for keyring encryption (got ${key16.length})`);
  }
  const cipher = crypto.createCipheriv("aes-128-cbc", passwordHash, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(key16), cipher.final()]).toString("base64");
}

function encryptPasswordAesCbc(plainPassword: string, passwordHash: Buffer, iv: Buffer): string {
  const pwdBytes = Buffer.from(plainPassword, "utf8");
  const salt8 = crypto.randomBytes(8);
  const padLen = 16 - ((8 + pwdBytes.length) % 16);
  const padBuf = Buffer.alloc(padLen, padLen);
  const block = Buffer.concat([salt8, pwdBytes, padBuf]);
  const cipher = crypto.createCipheriv("aes-128-cbc", passwordHash, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]).toString("base64");
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const val = match[2] !== undefined ? match[2] : match[3] || "";
    attrs[key] = unescapeXml(val);
  }
  return attrs;
}

/**
 * Lightweight, zero-dependency XML element tree parser tailored for ETS .knxkeys XML files.
 */
function parseKeyringXmlTree(xml: string): XmlElementNode {
  const cleaned = xml
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  const tagRegex = /<\/?([A-Za-z0-9_:-]+)([^>]*?)(\/?)>/g;
  const stack: XmlElementNode[] = [];
  let root: XmlElementNode | null = null;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(cleaned)) !== null) {
    const fullTag = match[0];
    const isClosing = fullTag.startsWith("</");
    const tagName = match[1];
    const attrPart = match[2] || "";
    const isSelfClosing = match[3] === "/";

    if (isClosing) {
      stack.pop();
    } else {
      const node: XmlElementNode = {
        name: tagName,
        attrs: parseAttributes(attrPart),
        children: [],
      };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else if (!root) {
        root = node;
      }
      if (!isSelfClosing) {
        stack.push(node);
      }
    }
  }

  if (!root || (!root.name.endsWith("Keyring") && root.name !== "Keyring")) {
    throw new Error("Invalid keyring XML: missing <Keyring> root element");
  }
  return root;
}

/**
 * Extracts the XML string from a .knxkeys ZIP buffer using Node's built-in zlib.
 */
function extractXmlFromZipBuffer(zipBuffer: Buffer): string {
  // Check PK\x03\x04 local file header signature
  if (zipBuffer.length >= 30 && zipBuffer.readUInt32LE(0) === 0x04034b50) {
    const compressionMethod = zipBuffer.readUInt16LE(8);
    let compressedSize = zipBuffer.readUInt32LE(18);
    const fileNameLen = zipBuffer.readUInt16LE(26);
    const extraLen = zipBuffer.readUInt16LE(28);
    const dataOffset = 30 + fileNameLen + extraLen;

    // If compressedSize is 0 in local header (bit 3 data descriptor), read it from Central Directory (PK\x01\x02)
    if (compressedSize === 0) {
      const cdSig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
      const cdOffset = zipBuffer.indexOf(cdSig, dataOffset);
      if (cdOffset !== -1 && cdOffset + 24 <= zipBuffer.length) {
        compressedSize = zipBuffer.readUInt32LE(cdOffset + 20);
      }
    }

    const compressedSlice =
      compressedSize > 0 ? zipBuffer.subarray(dataOffset, dataOffset + compressedSize) : zipBuffer.subarray(dataOffset);

    if (compressionMethod === 0) {
      return compressedSlice.toString("utf8");
    }
    if (compressionMethod === 8) {
      return zlib.inflateRawSync(compressedSlice).toString("utf8");
    }
  }

  // Fallback: raw XML embedded in buffer
  const xmlStart = zipBuffer.indexOf("<?xml");
  if (xmlStart !== -1) {
    const endTag = "</Keyring>";
    const xmlEnd = zipBuffer.indexOf(endTag);
    if (xmlEnd !== -1) {
      return zipBuffer.subarray(xmlStart, xmlEnd + endTag.length).toString("utf8");
    }
  }

  throw new Error("Unable to extract XML from .knxkeys archive");
}

/**
 * Computes the canonical 16-byte ETS Keyring signature over the parsed XML tree.
 */
export function computeKeyringSignatureFromXml(
  xmlContent: string,
  passwordHash: Buffer,
): { signature?: Buffer; computed: Buffer } {
  const root = parseKeyringXmlTree(xmlContent);
  const signatureB64 = root.attrs.Signature ?? "";

  const chunks: Buffer[] = [];
  const appendString = (value: string) => {
    const encoded = Buffer.from(value, "utf8");
    chunks.push(Buffer.from([encoded.length & 0xff]), encoded);
  };

  const walk = (node: XmlElementNode) => {
    chunks.push(Buffer.from([1]));
    const localName = node.name.includes(":") ? node.name.split(":").pop()! : node.name;
    appendString(localName);
    for (const attr of Object.keys(node.attrs).sort()) {
      if (attr === "xmlns" || attr === "Signature") continue;
      appendString(attr);
      appendString(String(node.attrs[attr]));
    }
    for (const child of node.children) {
      walk(child);
    }
    chunks.push(Buffer.from([2]));
  };

  walk(root);
  appendString(passwordHash.toString("base64"));

  const computed = Buffer.from(crypto.createHash("sha256").update(Buffer.concat(chunks)).digest().subarray(0, 16));
  const signature = signatureB64.trim() ? Buffer.from(signatureB64, "base64") : undefined;
  return { signature, computed };
}

/**
 * Zero-dependency reader, builder, and exporter for ETS `.knxkeys` keyring files
 * (`http://knx.org/xml/keyring/1`, compatible with ETS 5, ETS 6, Home Assistant / xknx, and `KNX.ts`).
 */
export class KnxKeyring {
  private readonly interfaces: Map<string, KeyringInterfaceEntry> = new Map();
  private readonly backbones: KeyringBackboneEntry[] = [];
  private readonly groupAddresses: Map<string, KeyringGroupAddressEntry> = new Map();
  private readonly groupAddressesByInt: Map<number, KeyringGroupAddressEntry> = new Map();
  private readonly devices: Map<string, KeyringDeviceEntry> = new Map();

  private passwordHash?: Buffer;
  private iv?: Buffer;
  public project?: string;
  public createdBy?: string;
  public created?: string;

  constructor(meta: KeyringMetadata = {}) {
    this.project = meta.project;
    this.createdBy = meta.createdBy;
    this.created = meta.created;
  }

  /**
   * Creates a new empty keyring ready to be populated and exported as `.knxkeys`.
   */
  public static create(meta: KeyringMetadata = {}): KnxKeyring {
    return new KnxKeyring({
      project: meta.project,
      createdBy: meta.createdBy ?? "KNX.ts",
      created: meta.created,
    });
  }

  /**
   * Generates a cryptographically strong random 16-byte AES-128 KNX Secure key.
   */
  public static generateKey(): Buffer {
    return crypto.randomBytes(16);
  }

  /**
   * Loads and decrypts a keyring from a file path, raw XML string, base64 string, or Buffer.
   */
  public static fromSource(source: string | Buffer, password: string, options: KeyringLoadOptions = {}): KnxKeyring {
    const keyring = new KnxKeyring();
    keyring.loadSync(source, password, options);
    return keyring;
  }

  public loadSync(source: string | Buffer, password: string, options: KeyringLoadOptions = {}): void {
    let xmlContent: string;
    if (Buffer.isBuffer(source)) {
      const trimmed = source.toString("utf8").trim();
      if (trimmed.startsWith("<")) {
        xmlContent = trimmed;
      } else {
        xmlContent = extractXmlFromZipBuffer(source);
      }
    } else if (fs.existsSync(source)) {
      const fileBuf = fs.readFileSync(source);
      const asText = fileBuf.toString("utf8").trim();
      xmlContent = asText.startsWith("<") ? asText : extractXmlFromZipBuffer(fileBuf);
    } else {
      const trimmed = source.trim();
      if (trimmed.startsWith("<")) {
        xmlContent = trimmed;
      } else {
        const buf = Buffer.from(trimmed, "base64");
        xmlContent = extractXmlFromZipBuffer(buf);
      }
    }

    this.loadFromXmlSync(xmlContent, password, options);
  }

  public loadFromXmlSync(xmlContent: string, password: string, options: KeyringLoadOptions = {}): void {
    const root = parseKeyringXmlTree(xmlContent);
    this.passwordHash = deriveKeyringPasswordKey(password);

    if (options.validateSignature !== false) {
      const { signature, computed } = computeKeyringSignatureFromXml(xmlContent, this.passwordHash);
      if (!signature) {
        throw new Error("Keyring signature verification failed: missing Signature attribute");
      }
      if (signature.length !== computed.length || !crypto.timingSafeEqual(signature, computed)) {
        throw new Error("Keyring signature verification failed: invalid password or modified keyring");
      }
    }

    this.interfaces.clear();
    this.backbones.length = 0;
    this.groupAddresses.clear();
    this.groupAddressesByInt.clear();
    this.devices.clear();

    this.project = root.attrs.Project;
    this.createdBy = root.attrs.CreatedBy;
    this.created = root.attrs.Created;
    if (this.created) {
      const createdHash = crypto.createHash("sha256").update(Buffer.from(this.created, "utf8")).digest();
      this.iv = Buffer.from(createdHash.subarray(0, 16));
    } else {
      this.iv = Buffer.alloc(16, 0);
    }

    for (const child of root.children) {
      const localName = child.name.includes(":") ? child.name.split(":").pop()! : child.name;
      if (localName === "Interface") {
        this.parseInterfaceNode(child);
      } else if (localName === "Backbone") {
        this.parseBackboneNode(child);
      } else if (localName === "GroupAddresses") {
        for (const groupNode of child.children) {
          this.parseGroupNode(groupNode);
        }
      } else if (localName === "Devices") {
        for (const devNode of child.children) {
          this.parseDeviceNode(devNode);
        }
      }
    }
  }

  private decryptAes128Cbc(encryptedBase64: string): Buffer {
    if (!this.passwordHash) throw new Error("Keyring password hash not initialized");
    const encrypted = Buffer.from(encryptedBase64, "base64");
    const iv = this.iv ?? Buffer.alloc(16, 0);
    const decipher = crypto.createDecipheriv("aes-128-cbc", this.passwordHash, iv);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  private extractPasswordString(decrypted: Buffer): string {
    if (decrypted.length === 0) return "";
    const pad = decrypted[decrypted.length - 1];
    if (pad < 1 || pad > decrypted.length - 8 || !decrypted.subarray(decrypted.length - pad).every((b) => b === pad)) {
      throw new Error("Keyring decryption failed: invalid padding");
    }
    return decrypted.subarray(8, decrypted.length - pad).toString("utf8");
  }

  private parseInterfaceNode(node: XmlElementNode): void {
    const a = node.attrs;
    if (!a.IndividualAddress) return;
    const entry: KeyringInterfaceEntry = {
      type: a.Type || "Tunnelling",
      individualAddress: a.IndividualAddress,
      host: a.Host,
      userId: a.UserID !== undefined ? parseInt(a.UserID, 10) : undefined,
      password: a.Password,
      authentication: a.Authentication,
      groupAddresses: new Map(),
    };
    if (entry.password) {
      entry.decryptedPassword = this.extractPasswordString(this.decryptAes128Cbc(entry.password));
    }
    if (entry.authentication) {
      entry.decryptedAuthentication = this.extractPasswordString(this.decryptAes128Cbc(entry.authentication));
    }
    for (const child of node.children) {
      if (child.attrs.Address) {
        const senders = child.attrs.Senders ? child.attrs.Senders.split(/\s+/).filter(Boolean) : [];
        entry.groupAddresses.set(child.attrs.Address, senders);
      }
    }
    this.interfaces.set(entry.individualAddress, entry);
  }

  private parseBackboneNode(node: XmlElementNode): void {
    const a = node.attrs;
    const entry: KeyringBackboneEntry = {
      key: a.Key,
      latency: a.Latency !== undefined ? parseInt(a.Latency, 10) : undefined,
      multicastAddress: a.MulticastAddress,
    };
    if (entry.key) {
      entry.decryptedKey = this.decryptAes128Cbc(entry.key);
    }
    this.backbones.push(entry);
  }

  private parseGroupNode(node: XmlElementNode): void {
    const a = node.attrs;
    if (!a.Address || !a.Key) return;
    let addressFormatted: string | undefined;
    let addressInt: number | undefined;
    try {
      const normalized = normalizeKeyringGroupAddress(a.Address);
      addressFormatted = normalized.formatted;
      addressInt = normalized.intValue;
    } catch {
      // Keep raw address if non-standard
    }
    const entry: KeyringGroupAddressEntry = {
      address: a.Address,
      addressFormatted,
      addressInt,
      key: a.Key,
      decryptedKey: this.decryptAes128Cbc(a.Key),
    };
    this.groupAddresses.set(entry.address, entry);
    if (addressInt !== undefined) {
      this.groupAddressesByInt.set(addressInt, entry);
    }
  }

  private parseDeviceNode(node: XmlElementNode): void {
    const a = node.attrs;
    if (!a.IndividualAddress) return;
    let sequenceNumber: number | undefined;
    let sequenceNumberBigInt: bigint | undefined;
    if (a.SequenceNumber !== undefined && a.SequenceNumber.trim() !== "") {
      sequenceNumber = parseInt(a.SequenceNumber, 10);
      try {
        sequenceNumberBigInt = BigInt(a.SequenceNumber.trim());
      } catch {
        // Ignore malformed non-integer SequenceNumber
      }
    }
    const entry: KeyringDeviceEntry = {
      individualAddress: a.IndividualAddress,
      toolKey: a.ToolKey,
      managementPassword: a.ManagementPassword,
      authentication: a.Authentication,
      sequenceNumber,
      sequenceNumberBigInt,
      serialNumber: a.SerialNumber,
    };
    if (entry.toolKey) {
      entry.decryptedToolKey = this.decryptAes128Cbc(entry.toolKey);
    }
    if (entry.managementPassword) {
      entry.decryptedManagementPassword = this.extractPasswordString(this.decryptAes128Cbc(entry.managementPassword));
    }
    if (entry.authentication) {
      entry.decryptedAuthentication = this.extractPasswordString(this.decryptAes128Cbc(entry.authentication));
    }
    this.devices.set(entry.individualAddress, entry);
  }

  public getInterfaces(): Map<string, KeyringInterfaceEntry> {
    return this.interfaces;
  }

  public getInterface(individualAddress?: string): KeyringInterfaceEntry | undefined {
    if (individualAddress) {
      const exact = this.interfaces.get(individualAddress);
      if (exact) return exact;
      for (const iface of this.interfaces.values()) {
        if (iface.host === individualAddress) return iface;
      }
      return undefined;
    }
    return this.interfaces.values().next().value;
  }

  public getBackbones(): KeyringBackboneEntry[] {
    return this.backbones;
  }

  public getBackbone(): KeyringBackboneEntry | undefined {
    return this.backbones[0];
  }

  public getGroupAddresses(): Map<string, KeyringGroupAddressEntry> {
    return this.groupAddresses;
  }

  /**
   * Looks up a group address entry by 3-level string (`"1/0/1"`), 2-level string (`"1/1"`),
   * integer string (`"2049"`), or 16-bit integer (`2049`).
   */
  public getGroupAddress(address: string | number): KeyringGroupAddressEntry | undefined {
    if (typeof address === "string") {
      const exact = this.groupAddresses.get(address);
      if (exact) return exact;
    }
    try {
      const { intValue } = normalizeKeyringGroupAddress(address);
      return this.groupAddressesByInt.get(intValue);
    } catch {
      return undefined;
    }
  }

  /**
   * Returns the decrypted 16-byte KNX Data Secure Group Key for a group address (if present).
   */
  public getGroupKey(address: string | number): Buffer | undefined {
    return this.getGroupAddress(address)?.decryptedKey;
  }

  /**
   * Returns all authorized sender Individual Addresses declared across `<Interface><Group ... Senders="..." />`
   * entries for the given group address (if any).
   */
  public getGroupSenders(address: string | number): string[] {
    let targetInt: number | undefined;
    try {
      targetInt = normalizeKeyringGroupAddress(address).intValue;
    } catch {
      // Fall back to exact string match
    }
    const senders = new Set<string>();
    for (const iface of this.interfaces.values()) {
      for (const [gaKey, list] of iface.groupAddresses.entries()) {
        let match = typeof address === "string" && gaKey === address;
        if (!match && targetInt !== undefined) {
          try {
            match = normalizeKeyringGroupAddress(gaKey).intValue === targetInt;
          } catch {
            match = false;
          }
        }
        if (match) {
          for (const ia of list) senders.add(ia);
        }
      }
    }
    return Array.from(senders);
  }

  public getDevices(): Map<string, KeyringDeviceEntry> {
    return this.devices;
  }

  public getDevice(individualAddress: string): KeyringDeviceEntry | undefined {
    return this.devices.get(individualAddress);
  }

  /**
   * Returns the decrypted 16-byte Tool Key for the given device Individual Address (if present).
   */
  public getDeviceToolKey(individualAddress: string): Buffer | undefined {
    return this.devices.get(individualAddress)?.decryptedToolKey;
  }

  // ============================================================================
  // Builder / Mutation API (Construct or edit keyrings before exporting .knxkeys)
  // ============================================================================

  /**
   * Adds or replaces a `<Backbone>` entry (KNX IP Secure Routing multicast key).
   * Generates a random 16-byte key if `key` is omitted or `"generate"`.
   */
  public setBackbone(entry: KeyringBackboneInput = {}): KeyringBackboneEntry {
    const rawKey =
      entry.key === undefined || entry.key === "generate"
        ? KnxKeyring.generateKey()
        : parseKey16(entry.key, "backbone.key");
    const multicastAddress = entry.multicastAddress ?? "224.0.23.12";
    const latency = entry.latency ?? 2000;

    const built: KeyringBackboneEntry = {
      multicastAddress,
      latency,
      decryptedKey: rawKey,
    };

    const existingIdx = this.backbones.findIndex((b) => b.multicastAddress === multicastAddress);
    if (existingIdx >= 0) {
      this.backbones[existingIdx] = built;
    } else {
      this.backbones.push(built);
    }
    return built;
  }

  /**
   * Removes all `<Backbone>` entries from the keyring.
   */
  public clearBackbones(): this {
    this.backbones.length = 0;
    return this;
  }

  /**
   * Adds or updates a 16-byte KNX Data Secure Group Key for a Group Address (`"1/0/1"`, `"1/1"`, `"2049"`, or `2049`).
   * Generates a random 16-byte key via CSPRNG if `key` is omitted. Returns the 16-byte key `Buffer`.
   */
  public setGroupKey(address: string | number, key?: Buffer | string): Buffer {
    const { formatted, intValue } = normalizeKeyringGroupAddress(address);
    const keyBuf = key === undefined ? KnxKeyring.generateKey() : parseKey16(key, `groupKey(${formatted})`);

    const existing = this.groupAddressesByInt.get(intValue);
    if (existing && existing.address !== formatted) {
      this.groupAddresses.delete(existing.address);
    }

    const entry: KeyringGroupAddressEntry = {
      address: formatted,
      addressFormatted: formatted,
      addressInt: intValue,
      key: "",
      decryptedKey: keyBuf,
    };
    this.groupAddresses.set(formatted, entry);
    this.groupAddressesByInt.set(intValue, entry);
    return Buffer.from(keyBuf);
  }

  /**
   * Returns the existing 16-byte Group Key for `address`, or generates, stores, and returns a new random one.
   */
  public ensureGroupKey(address: string | number): Buffer {
    const existing = this.getGroupKey(address);
    if (existing) return Buffer.from(existing);
    return this.setGroupKey(address);
  }

  /**
   * Removes a Group Address key entry from the keyring.
   */
  public removeGroupKey(address: string | number): boolean {
    try {
      const { intValue } = normalizeKeyringGroupAddress(address);
      const existing = this.groupAddressesByInt.get(intValue);
      if (existing) {
        this.groupAddresses.delete(existing.address);
        this.groupAddressesByInt.delete(intValue);
        return true;
      }
    } catch {
      // Fall back to direct string key removal
    }
    return typeof address === "string" ? this.groupAddresses.delete(address) : false;
  }

  /**
   * Adds or updates a `<Device>` entry (`ToolKey`, `SequenceNumber`, `SerialNumber`, passwords).
   * Pass `toolKey: "generate"` to create a new random 16-byte Tool Key.
   * By default (`merge: true`), omitted fields preserve existing values on that device.
   */
  public setDevice(input: KeyringDeviceInput): KeyringDeviceEntry {
    const ia = input.individualAddress.trim();
    if (!KNXHelper.isValidIndividualAddress(ia)) {
      throw new Error(`Invalid KNX Individual Address for keyring device: "${input.individualAddress}"`);
    }

    const existing = input.merge !== false ? this.devices.get(ia) : undefined;
    const entry: KeyringDeviceEntry = existing ? { ...existing, individualAddress: ia } : { individualAddress: ia };

    if (input.toolKey !== undefined) {
      entry.decryptedToolKey =
        input.toolKey === "generate" ? KnxKeyring.generateKey() : parseKey16(input.toolKey, `device(${ia}).toolKey`);
      entry.toolKey = undefined;
    }
    if (input.managementPassword !== undefined) {
      entry.decryptedManagementPassword = input.managementPassword;
      entry.managementPassword = undefined;
    }
    if (input.authentication !== undefined) {
      entry.decryptedAuthentication = input.authentication;
      entry.authentication = undefined;
    }
    if (input.sequenceNumber !== undefined) {
      const seqBig =
        typeof input.sequenceNumber === "bigint"
          ? input.sequenceNumber
          : BigInt(Math.max(0, Math.trunc(input.sequenceNumber)));
      if (seqBig < 0n || seqBig > 0xffffffffffffn) {
        throw new RangeError(`SequenceNumber for device ${ia} out of 48-bit range: ${seqBig}`);
      }
      entry.sequenceNumberBigInt = seqBig;
      entry.sequenceNumber = Number(seqBig);
    }
    if (input.serialNumber !== undefined) {
      if (Buffer.isBuffer(input.serialNumber)) {
        if (input.serialNumber.length !== 6) {
          throw new Error(`SerialNumber buffer for ${ia} must be 6 bytes (got ${input.serialNumber.length})`);
        }
        entry.serialNumber = input.serialNumber.toString("hex").toUpperCase();
      } else {
        entry.serialNumber = input.serialNumber
          .trim()
          .replace(/^0x/i, "")
          .replace(/[\s:-]/g, "")
          .toUpperCase();
      }
    }

    this.devices.set(ia, entry);
    return entry;
  }

  /**
   * Removes a `<Device>` entry by Individual Address.
   */
  public removeDevice(individualAddress: string): boolean {
    return this.devices.delete(individualAddress.trim());
  }

  /**
   * Adds or updates an `<Interface>` entry (Tunneling, Backbone, or USB) along with optional group sender bindings.
   */
  public setInterface(input: KeyringInterfaceInput): KeyringInterfaceEntry {
    const ia = input.individualAddress.trim();
    if (!KNXHelper.isValidIndividualAddress(ia)) {
      throw new Error(`Invalid KNX Individual Address for keyring interface: "${input.individualAddress}"`);
    }

    const existing = input.merge !== false ? this.interfaces.get(ia) : undefined;
    const groupAddresses = new Map<string, string[]>();
    if (existing) {
      for (const [ga, senders] of existing.groupAddresses.entries()) {
        groupAddresses.set(ga, [...senders]);
      }
    }

    const entry: KeyringInterfaceEntry = {
      type: input.type ?? existing?.type ?? "Tunnelling",
      individualAddress: ia,
      host: input.host !== undefined ? input.host : existing?.host,
      userId: input.userId !== undefined ? input.userId : existing?.userId,
      password: input.password !== undefined ? undefined : existing?.password,
      authentication: input.authentication !== undefined ? undefined : existing?.authentication,
      decryptedPassword: input.password !== undefined ? input.password : existing?.decryptedPassword,
      decryptedAuthentication:
        input.authentication !== undefined ? input.authentication : existing?.decryptedAuthentication,
      groupAddresses,
    };

    if (input.groupAddresses) {
      const pairs =
        input.groupAddresses instanceof Map
          ? Array.from(input.groupAddresses.entries())
          : Object.entries(input.groupAddresses);
      for (const [ga, senders] of pairs) {
        this.setInterfaceGroupSendersInternal(entry, ga, senders, false);
      }
    }

    this.interfaces.set(ia, entry);
    return entry;
  }

  private setInterfaceGroupSendersInternal(
    iface: KeyringInterfaceEntry,
    groupAddress: string | number,
    senders: string[],
    append: boolean,
  ): void {
    const { formatted, intValue } = normalizeKeyringGroupAddress(groupAddress);
    let existingKey: string | undefined;
    let existingSenders: string[] = [];

    for (const [gaKey, list] of iface.groupAddresses.entries()) {
      try {
        if (normalizeKeyringGroupAddress(gaKey).intValue === intValue) {
          existingKey = gaKey;
          existingSenders = list;
          break;
        }
      } catch {
        if (gaKey === formatted) {
          existingKey = gaKey;
          existingSenders = list;
          break;
        }
      }
    }

    if (existingKey && existingKey !== formatted) {
      iface.groupAddresses.delete(existingKey);
    }

    const merged = new Set<string>(append ? existingSenders : []);
    for (const s of senders) {
      const clean = s.trim();
      if (!clean) continue;
      if (!KNXHelper.isValidIndividualAddress(clean)) {
        throw new Error(`Invalid sender Individual Address "${clean}" for group ${formatted}`);
      }
      merged.add(clean);
    }

    iface.groupAddresses.set(
      formatted,
      Array.from(merged).sort((a, b) => parseIndividualAddressSortable(a) - parseIndividualAddressSortable(b)),
    );
  }

  /**
   * Adds one or more authorized sender IAs to a Group Address under an `<Interface>` entry.
   * Creates the `<Interface>` entry (default `type: "Tunnelling"`) if it does not yet exist.
   */
  public addInterfaceGroupSender(
    interfaceIndividualAddress: string,
    groupAddress: string | number,
    senderIa: string | string[],
    interfaceType: string = "Tunnelling",
  ): this {
    const ia = interfaceIndividualAddress.trim();
    const iface = this.interfaces.get(ia) ?? this.setInterface({ individualAddress: ia, type: interfaceType });
    const list = Array.isArray(senderIa) ? senderIa : [senderIa];
    this.setInterfaceGroupSendersInternal(iface, groupAddress, list, true);
    return this;
  }

  /**
   * Removes an `<Interface>` entry by Individual Address.
   */
  public removeInterface(individualAddress: string): boolean {
    return this.interfaces.delete(individualAddress.trim());
  }

  /**
   * Synchronizes Group Keys, Device ToolKeys, Serial Numbers, and live 48-bit Sequence Numbers
   * from a runtime {@link KnxDataSecure} manager into this keyring before exporting `.knxkeys`.
   */
  public syncFromDataSecure(
    dataSecure: KnxDataSecure,
    options: {
      includeGroupKeys?: boolean;
      includeToolKeys?: boolean;
      includeSequenceNumbers?: boolean;
      includeSerialNumbers?: boolean;
      deviceAddresses?: string[];
    } = {},
  ): this {
    dataSecure.syncToKeyring(this, options);
    return this;
  }

  // ============================================================================
  // Export API (Standard ETS .knxkeys XML / ZIP with AES-128-CBC + SHA-256 Signature)
  // ============================================================================

  /**
   * Serializes, encrypts (AES-128-CBC with PBKDF2-HMAC-SHA256 derived key and SHA-256(Created) IV),
   * and signs this keyring as a standards-compliant ETS `.knxkeys` XML document (`http://knx.org/xml/keyring/1`).
   */
  public toXml(password: string, options: KeyringExportOptions = {}): string {
    if (typeof password !== "string" || password.length === 0) {
      throw new Error("Keyring export password must be a non-empty string");
    }

    const passwordHash = deriveKeyringPasswordKey(password);
    const created = formatIsoCreated(options.created ?? this.created ?? new Date());
    const createdBy = options.createdBy ?? this.createdBy ?? "KNX.ts";
    const project = options.project ?? this.project;
    const gaFormat = options.groupAddressFormat ?? "3-level";

    const iv = Buffer.from(crypto.createHash("sha256").update(Buffer.from(created, "utf8")).digest().subarray(0, 16));

    const formatGa = (raw: string): string => {
      try {
        const norm = normalizeKeyringGroupAddress(raw);
        return gaFormat === "integer" ? String(norm.intValue) : norm.formatted;
      } catch {
        return raw;
      }
    };

    const gaSortKey = (raw: string): number => {
      try {
        return normalizeKeyringGroupAddress(raw).intValue;
      } catch {
        return 0x10000;
      }
    };

    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="utf-8"?>');

    const rootAttrs: string[] = [];
    if (project !== undefined && project !== "") {
      rootAttrs.push(`Project="${escapeXml(project)}"`);
    }
    rootAttrs.push(`CreatedBy="${escapeXml(createdBy)}"`);
    rootAttrs.push(`Created="${escapeXml(created)}"`);
    rootAttrs.push('Signature="__PENDING_SIGNATURE__"');
    rootAttrs.push('xmlns="http://knx.org/xml/keyring/1"');
    lines.push(`<Keyring ${rootAttrs.join(" ")}>`);

    // 1. <Backbone ... />
    for (const bb of this.backbones) {
      const attrs: string[] = [];
      if (bb.multicastAddress) attrs.push(`MulticastAddress="${escapeXml(bb.multicastAddress)}"`);
      if (bb.latency !== undefined) attrs.push(`Latency="${bb.latency}"`);
      if (bb.decryptedKey) {
        attrs.push(`Key="${encryptKey16AesCbc(bb.decryptedKey, passwordHash, iv)}"`);
      }
      lines.push(`  <Backbone ${attrs.join(" ")} />`);
    }

    // 2. <Interface ...>
    const sortedInterfaces = Array.from(this.interfaces.values()).sort(
      (a, b) =>
        parseIndividualAddressSortable(a.individualAddress) - parseIndividualAddressSortable(b.individualAddress),
    );
    for (const iface of sortedInterfaces) {
      const attrs: string[] = [];
      attrs.push(`Type="${escapeXml(iface.type)}"`);
      attrs.push(`IndividualAddress="${escapeXml(iface.individualAddress)}"`);
      if (iface.host) attrs.push(`Host="${escapeXml(iface.host)}"`);
      if (iface.userId !== undefined) attrs.push(`UserID="${iface.userId}"`);
      if (iface.decryptedPassword !== undefined) {
        attrs.push(`Password="${encryptPasswordAesCbc(iface.decryptedPassword, passwordHash, iv)}"`);
      }
      if (iface.decryptedAuthentication !== undefined) {
        attrs.push(`Authentication="${encryptPasswordAesCbc(iface.decryptedAuthentication, passwordHash, iv)}"`);
      }

      const sortedIfaceGroups = Array.from(iface.groupAddresses.entries()).sort(
        ([a], [b]) => gaSortKey(a) - gaSortKey(b),
      );
      if (sortedIfaceGroups.length === 0) {
        lines.push(`  <Interface ${attrs.join(" ")} />`);
      } else {
        lines.push(`  <Interface ${attrs.join(" ")}>`);
        for (const [gaKey, senders] of sortedIfaceGroups) {
          lines.push(`    <Group Address="${escapeXml(formatGa(gaKey))}" Senders="${escapeXml(senders.join(" "))}" />`);
        }
        lines.push("  </Interface>");
      }
    }

    // 3. <GroupAddresses>
    const sortedGroups = Array.from(this.groupAddresses.values())
      .filter((g) => Boolean(g.decryptedKey))
      .sort((a, b) => (a.addressInt ?? gaSortKey(a.address)) - (b.addressInt ?? gaSortKey(b.address)));
    if (sortedGroups.length > 0) {
      lines.push("  <GroupAddresses>");
      for (const g of sortedGroups) {
        const encKey = encryptKey16AesCbc(g.decryptedKey!, passwordHash, iv);
        lines.push(`    <Group Address="${escapeXml(formatGa(g.address))}" Key="${encKey}" />`);
      }
      lines.push("  </GroupAddresses>");
    }

    // 4. <Devices>
    const sortedDevices = Array.from(this.devices.values()).sort(
      (a, b) =>
        parseIndividualAddressSortable(a.individualAddress) - parseIndividualAddressSortable(b.individualAddress),
    );
    if (sortedDevices.length > 0) {
      lines.push("  <Devices>");
      for (const dev of sortedDevices) {
        const attrs: string[] = [`IndividualAddress="${escapeXml(dev.individualAddress)}"`];
        if (dev.decryptedToolKey) {
          attrs.push(`ToolKey="${encryptKey16AesCbc(dev.decryptedToolKey, passwordHash, iv)}"`);
        }
        if (dev.decryptedManagementPassword !== undefined) {
          attrs.push(
            `ManagementPassword="${encryptPasswordAesCbc(dev.decryptedManagementPassword, passwordHash, iv)}"`,
          );
        }
        if (dev.decryptedAuthentication !== undefined) {
          attrs.push(`Authentication="${encryptPasswordAesCbc(dev.decryptedAuthentication, passwordHash, iv)}"`);
        }
        if (dev.sequenceNumberBigInt !== undefined) {
          attrs.push(`SequenceNumber="${dev.sequenceNumberBigInt.toString()}"`);
        } else if (dev.sequenceNumber !== undefined) {
          attrs.push(`SequenceNumber="${Math.trunc(dev.sequenceNumber)}"`);
        }
        if (dev.serialNumber) {
          attrs.push(`SerialNumber="${escapeXml(dev.serialNumber)}"`);
        }
        lines.push(`    <Device ${attrs.join(" ")} />`);
      }
      lines.push("  </Devices>");
    }

    lines.push("</Keyring>");

    const unsignedXml = lines.join("\r\n");
    const { computed } = computeKeyringSignatureFromXml(unsignedXml, passwordHash);
    return unsignedXml.replace('Signature="__PENDING_SIGNATURE__"', `Signature="${computed.toString("base64")}"`);
  }

  /**
   * Exports this keyring as a ready-to-save `.knxkeys` `Buffer` (XML with UTF-8 BOM by default, or ZIP if `format: "zip"`).
   */
  public toBuffer(password: string, options: KeyringExportOptions = {}): Buffer {
    const xml = this.toXml(password, options);
    const includeBom = options.includeBom ?? true;
    const xmlBuf =
      includeBom && (options.format ?? "xml") === "xml"
        ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml, "utf8")])
        : Buffer.from(xml, "utf8");

    if (options.format === "zip") {
      const safeProject = (options.project ?? this.project ?? "keyring").replace(/[^a-zA-Z0-9._-]/g, "_") || "keyring";
      const entryName = options.zipEntryName ?? `${safeProject}.xml`;
      return buildSingleFileZip(entryName, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml, "utf8")]));
    }

    return xmlBuf;
  }

  /**
   * Writes an encrypted, signed `.knxkeys` file directly to disk (creating parent directories if needed).
   */
  public saveFile(filePath: string, password: string, options: KeyringExportOptions = {}): void {
    const buf = this.toBuffer(password, options);
    const dir = path.dirname(path.resolve(filePath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, buf);
  }
}
