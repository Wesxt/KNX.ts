import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import { deriveKeyringPasswordKey } from "./KnxSecureKeys";

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
  address: string;
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
  serialNumber?: string;
}

export interface KeyringLoadOptions {
  /**
   * Verify the ETS keyring signature (default: true).
   */
  validateSignature?: boolean;
}

interface XmlElementNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlElementNode[];
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
      compressedSize > 0
        ? zipBuffer.subarray(dataOffset, dataOffset + compressedSize)
        : zipBuffer.subarray(dataOffset);

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

  const computed = Buffer.from(
    crypto.createHash("sha256").update(Buffer.concat(chunks)).digest().subarray(0, 16),
  );
  const signature = signatureB64.trim() ? Buffer.from(signatureB64, "base64") : undefined;
  return { signature, computed };
}

/**
 * Zero-dependency reader and decryptor for ETS `.knxkeys` keyring files.
 */
export class KnxKeyring {
  private readonly interfaces: Map<string, KeyringInterfaceEntry> = new Map();
  private readonly backbones: KeyringBackboneEntry[] = [];
  private readonly groupAddresses: Map<string, KeyringGroupAddressEntry> = new Map();
  private readonly devices: Map<string, KeyringDeviceEntry> = new Map();

  private passwordHash?: Buffer;
  private iv?: Buffer;
  public createdBy?: string;
  public created?: string;

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
    this.devices.clear();

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
    const entry: KeyringGroupAddressEntry = {
      address: a.Address,
      key: a.Key,
      decryptedKey: this.decryptAes128Cbc(a.Key),
    };
    this.groupAddresses.set(entry.address, entry);
  }

  private parseDeviceNode(node: XmlElementNode): void {
    const a = node.attrs;
    if (!a.IndividualAddress) return;
    const entry: KeyringDeviceEntry = {
      individualAddress: a.IndividualAddress,
      toolKey: a.ToolKey,
      managementPassword: a.ManagementPassword,
      authentication: a.Authentication,
      sequenceNumber: a.SequenceNumber !== undefined ? parseInt(a.SequenceNumber, 10) : undefined,
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

  public getDevices(): Map<string, KeyringDeviceEntry> {
    return this.devices;
  }

  public getDevice(individualAddress: string): KeyringDeviceEntry | undefined {
    return this.devices.get(individualAddress);
  }
}
