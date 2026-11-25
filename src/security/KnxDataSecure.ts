import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { KNXService } from "../connection/KNXService";
import { CEMI, CEMIInstance } from "../core/CEMI";
import { ControlField } from "../core/ControlField";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { APCIEnum } from "../core/enum/APCIEnum";
import { AddressType } from "../core/enum/EnumControlFieldExtended";
import { APDU } from "../core/layers/data/APDU";
import { TPDU } from "../core/layers/data/TPDU";
import { APCI } from "../core/layers/interfaces/APCI";
import { TPCI, TPCIType } from "../core/layers/interfaces/TPCI";
import { MESSAGE_CODE_FIELD } from "../core/MessageCodeField";
import { KNXHelper } from "../utils/KNXHelper";
import {
  APCI_DATA_SECURE,
  buildSADataPdu,
  buildSASyncReqPdu,
  buildSASyncResPdu,
  decryptSADataPdu,
  decryptSASyncReqPdu,
  decryptSASyncResPdu,
  MAX_SEQ_NR_48,
  parseSecureAsduHeader,
  SecureAlService,
  SecurityAlgorithmId,
  SecurityControlField,
} from "./KnxDataSecureCcm";
import { KnxKeyring, normalizeKeyringGroupAddress } from "./KnxKeyring";
import { parseKey16 } from "./KnxSecureKeys";

export type DataSecureMode = "auth_conf" | "auth_only";

export type DataSecureCommMode = "individual" | "connected" | "broadcast" | "system_broadcast";

export type DataSecureFailureReason =
  | "invalid_scf"
  | "unsupported_comm_mode"
  | "tool_flag_on_group"
  | "unknown_sender"
  | "unknown_key"
  | "seq_zero"
  | "seq_duplicate"
  | "seq_too_low"
  | "mac_mismatch"
  | "invalid_reserved_bits";

/**
 * Metadata attached to a decrypted `L_Data.ind` CEMI instance (`(cemi as DataSecureCEMI).dataSecure`).
 */
export interface DataSecureMetadata {
  authenticated: true;
  confidential: boolean;
  toolAccess: boolean;
  systemBroadcast: boolean;
  sequenceNumber: bigint;
  scf: SecurityControlField;
  rawSecureCemi: CEMIInstance;
}

export type DataSecureCEMI = CEMIInstance & {
  dataSecure?: DataSecureMetadata;
};

/**
 * Security failure counters per `PID_SECURITY_FAILURES_LOG` (03_05_01 §6.3.9, 03_03_07 §5.4).
 */
export interface SecurityFailureCounters {
  cryptoErrors: number;
  seqNrErrors: number;
  accessRoleErrors: number;
}

export interface DataSecureFailureEvent {
  reason: DataSecureFailureReason;
  sourceAddress: string;
  destinationAddress: string;
  seqNr?: bigint;
  cemi: CEMIInstance;
}

export interface DataSecurePersistedState {
  version: 1;
  sequenceNumberSending: string;
  toolAccessLastValidSeq: string;
  lastValidSeqByIA: Record<string, string>;
}

/**
 * Configuration options for {@link KnxDataSecure} (KNX Standard 03_03_07 §5, 03_05_01 §6.3, 03_05_02 §4).
 */
export interface KNXDataSecureOptions {
  /** Pre-loaded {@link KnxKeyring} instance. */
  keyring?: KnxKeyring;
  /** Path to an ETS `.knxkeys` file, raw XML string, base64 string, or Buffer. */
  keyringFile?: string | Buffer;
  /** Password used to verify and decrypt `keyringFile`. */
  keyringPassword?: string;
  /**
   * Own KNX Individual Address used as Source Address (`SA`) in outgoing Data Secure frames.
   * Defaults to the attached `KNXService.individualAddress`.
   */
  sourceAddress?: string;
  /**
   * Initial `Sequence Number Sending` (`PID_SEQUENCE_NUMBER_SENDING`, 1..0xFFFFFFFFFFFF).
   * Defaults to `1n` (per 03_03_07 §5.3.1: shall not be 0). Ignored if a higher value is restored from `sequenceNumberFile`.
   */
  initialSequenceNumber?: bigint | number;
  /**
   * Optional JSON file path to persist `sequenceNumberSending`, `toolAccessLastValidSeq`, and `lastValidSeqByIA`
   * across process restarts (03_03_07 §5.3.1 Power down behaviour).
   */
  sequenceNumberFile?: string;
  /** Explicit Group Keys mapped by Group Address (`"1/0/1"`, `"2049"`, etc.) -> 16-byte Buffer or 32-char hex. */
  groupKeys?: Record<string, Buffer | string> | Map<string, Buffer | string>;
  /** Default security mode for outgoing secure group telegrams. Defaults to `"auth_conf"` (A+C, `SAI = 1`). */
  groupSecurityMode?: DataSecureMode;
  /** Optional per-Group-Address security mode overrides (`"auth_conf"` vs `"auth_only"`). */
  groupSecurityModes?: Record<string, DataSecureMode> | Map<string, DataSecureMode>;
  /** Device Tool Keys mapped by target Device Individual Address (`"1.1.1"` -> 16-byte key). Merged with keyring `<Devices>`. */
  deviceToolKeys?: Record<string, Buffer | string> | Map<string, Buffer | string>;
  /** Optional Factory Default Setup Keys (FDSK) mapped by Device Individual Address (`"1.1.1"` -> 16-byte key). */
  deviceFdsKeys?: Record<string, Buffer | string> | Map<string, Buffer | string>;
  /** Point-to-Point Keys (`PID_P2P_KEY_TABLE`) mapped by partner Individual Address (`"1.1.2"` -> 16-byte key). */
  p2pKeys?: Record<string, Buffer | string> | Map<string, Buffer | string>;
  /** Own Tool Key when this instance acts as a MaS (device/server) accepting `T = 1` requests. */
  ownToolKey?: Buffer | string;
  /** Own 6-byte KNX Serial Number (hex string or 6-byte Buffer) for `S-A_Sync_Req` filtering when acting as a MaS. */
  ownSerialNumber?: Buffer | string;
  /**
   * Authorized sender Individual Addresses (`PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`).
   * Only enforced on incoming non-Tool frames when `enforceSourceAddressTable` is `true`.
   */
  securityIndividualAddresses?: string[];
  /**
   * When true, incoming non-Tool `S-A_Data` frames whose Source Address is not in `securityIndividualAddresses`
   * are ignored without logging a failure (strict MaS behaviour per 03_03_07 §5.2.1.1).
   * Defaults to `false` so monitoring/client tools can decrypt all configured groups regardless of sender.
   */
  enforceSourceAddressTable?: boolean;
  /**
   * Enforce strictly increasing Sequence Numbers per sender IA (`03_03_07` §5.3.1). Defaults to `true`.
   */
  checkSequenceNumbers?: boolean;
  /**
   * Automatically encrypt outgoing `L_Data.req` Group frames whose destination GA has a configured Group Key.
   * Defaults to `true`.
   */
  autoEncryptOutgoingGroup?: boolean;
  /**
   * Automatically decrypt incoming `S-A_Data` `L_Data.ind` frames on attached `KNXService` instances.
   * Defaults to `true`.
   */
  autoDecryptIncoming?: boolean;
  /**
   * Automatically answer valid incoming `S-A_Sync_Req` frames (with 1-second rate limiting per 03_03_07 §5.3.2).
   * Defaults to `true`.
   */
  respondToSyncRequests?: boolean;
  /**
   * Timeout in milliseconds waiting for `S-A_Sync_Res` (03_03_07 §5.3.2 specifies 6000 ms). Defaults to `6000`.
   */
  syncTimeoutMs?: number;
  /**
   * When true, forces Extended Frame (`FT = 0`) even when the Secure APDU length is `<= 15`.
   * When false (default), uses Extended Frame automatically whenever Secure APDU length `> 15`.
   */
  forceExtendedFrame?: boolean;
  /**
   * When true (default), allows `syncSequenceNumber` Option 2 (`03_03_07` §5.3.2 Comparison 1): if a remote device
   * reports a smaller `SeqNrremote` than stored locally (e.g. after device master reset), updates local state instead of failing.
   */
  allowSyncRollback?: boolean;
}

export interface WrapCemiOptions {
  /** Override 16-byte AES-128 key. */
  key?: Buffer | string;
  /** Override Source Address (`SA`) used in frame & B0/Ctr0. */
  sourceAddress?: string;
  /** True for Authentication + Confidentiality (`SAI = 1`), false for Authentication only (`SAI = 0`). */
  confidentiality?: boolean;
  /** True when using Tool Key / FDSK (`SCF.T = 1`). */
  toolAccess?: boolean;
  /** Override `SCF.SBC` bit (defaults automatically per 03_03_07 Table 8). */
  systemBroadcast?: boolean;
  /** Force Extended Frame (`FT = 0`) even when length <= 15. */
  forceExtendedFrame?: boolean;
  /** Set true for Local TL mode (`SA = 0, DA = 0, TPCI = 0` in B0/Ctr0 per 03_03_07 §5.1.3.2). */
  localTl?: boolean;
  /** Explicit sequence number override (does NOT increment `sequenceNumberSending` when provided). */
  sequenceNumber?: bigint | number;
}

export interface UnwrapCemiResult {
  handled: boolean;
  /** Non-null when an `S-A_Data` frame was successfully verified, decrypted, and restored as a plain CEMI. */
  plainCemi: DataSecureCEMI | null;
  metadata?: DataSecureMetadata;
  failureReason?: DataSecureFailureReason;
  service?: SecureAlService;
}

export interface SyncSequenceNumberOptions {
  /** Communication mode (`DM_SecureSync_RCl`: `"individual"` | `"connected"`; `DM_SecureSync_SBC`: `"broadcast"` | `"system_broadcast"`). Defaults to `"individual"`. */
  commMode?: DataSecureCommMode;
  /** True to use Tool Key / FDSK (`SCF.T = 1`, default `true` if a Tool Key exists for target, else `false`). */
  toolAccess?: boolean;
  /** Explicit 16-byte key override. */
  key?: Buffer | string;
  /** Optional fallback key (e.g. FDSK if ToolKey fails, per 03_05_02 §4.1 Note 18). */
  fallbackKey?: Buffer | string;
  /** Target 6-byte KNX Serial Number (required non-zero for `"broadcast"` / `"system_broadcast"`, optional for point-to-point). */
  serialNumber?: Buffer | string;
  /** Source Individual Address override. */
  sourceAddress?: string;
  /** Custom 6-byte challenge (mainly for deterministic testing; random 6 bytes generated by default). */
  challenge?: Buffer;
  /** Explicit `SeqNrlocal` to send in `S-A_Sync_Req` (defaults to current `sequenceNumberSending`, or `0n` if unknown). */
  seqNrLocal?: bigint | number;
  /** Timeout in milliseconds per attempt (default `6000` ms per 03_03_07 §5.3.2). */
  timeoutMs?: number;
  /** Number of retries on timeout for connectionless/broadcast modes (default `1` per 03_05_02 §4.1–4.2; ignored for `"connected"`). */
  retries?: number;
  /**
   * Optional active connected TL channel hooks (used internally by `TransportConnection` so `S-A_Sync` runs
   * inside an already-open `T_Connect` session using the connection's live 4-bit TL sequence numbers).
   */
  connectedChannel?: {
    txSequence: number;
    sendNumbered: (secureAsdu: Buffer) => Promise<void>;
    waitResponse: (timeoutMs: number) => Promise<CEMIInstance>;
  };
}

export interface SyncSequenceNumberResult {
  remoteAddress: string;
  seqNrRemote: bigint;
  seqNrLocal: bigint;
  commMode: DataSecureCommMode;
  usedToolKey: boolean;
  usedFallbackKey: boolean;
}

interface PendingSyncWaiter {
  targetAddress?: string;
  commMode: DataSecureCommMode;
  toolAccess: boolean;
  key: Buffer;
  challenge: Buffer;
  resolve: (result: { remoteAddress: string; seqNrRemote: bigint; seqNrLocal: bigint }) => void;
}

function parseSerialNumber6(input: Buffer | string | undefined): Buffer | undefined {
  if (!input) return undefined;
  if (Buffer.isBuffer(input)) {
    if (input.length !== 6) throw new Error(`KNX Serial Number must be 6 bytes (got ${input.length})`);
    return Buffer.from(input);
  }
  const cleaned = input
    .trim()
    .replace(/^0x/i, "")
    .replace(/[\s:-]/g, "");
  if (!/^[0-9a-fA-F]{12}$/.test(cleaned)) {
    throw new Error(`Invalid KNX Serial Number hex string (expected 12 hex characters): ${input}`);
  }
  return Buffer.from(cleaned, "hex");
}

type LDataCemi =
  | InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.req"]>
  | InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>
  | InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.con"]>;

function isLDataCemi(cemi: CEMIInstance): cemi is LDataCemi {
  return (
    "TPDU" in cemi &&
    "controlField1" in cemi &&
    "controlField2" in cemi &&
    "sourceAddress" in cemi &&
    "destinationAddress" in cemi
  );
}

/**
 * Checks whether a CEMI frame carries a KNX Data Secure APDU (`APCI = 0x03F1`).
 */
export function isDataSecureCemi(cemi: CEMIInstance): boolean {
  if (!isLDataCemi(cemi)) return false;
  if (cemi.TPDU.tpci.dataControlFlag) return false;
  return cemi.TPDU.apdu.apci.value === APCI_DATA_SECURE;
}

/**
 * Complete KNX Data Security Application Layer (`S-AL`) implementation per KNX Standard v3.0.0:
 * - `03_03_07` §5 Secure Application Layer (`S-A_Data`, `S-A_Sync`, AES-128-CCM)
 * - `03_05_01` §6.3 Security Interface Object (Object Type 17)
 * - `03_05_02` §4 Security Management Procedures (`DM_SecureSync_SBC`, `DM_SecureSync_RCl`)
 */
export class KnxDataSecure extends EventEmitter {
  public readonly options: KNXDataSecureOptions;

  private readonly groupKeys: Map<number, Buffer> = new Map();
  private readonly groupModes: Map<number, DataSecureMode> = new Map();
  private readonly deviceToolKeys: Map<string, Buffer> = new Map();
  private readonly deviceFdsKeys: Map<string, Buffer> = new Map();
  private readonly deviceSerialNumbers: Map<string, Buffer> = new Map();
  private readonly p2pKeys: Map<string, Buffer> = new Map();
  private readonly authorizedSenders: Set<string> = new Set();

  private ownToolKey: Buffer | null = null;
  private ownSerialNumber: Buffer | null = null;
  private _sourceAddress?: string;

  /** Own `Sequence Number Sending` (`PID_SEQUENCE_NUMBER_SENDING`, next valid SeqNr, >= 1n). */
  private _sequenceNumberSending: bigint = 1n;
  /** Last Valid SeqNr per remote partner IA (`PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`). */
  private readonly lastValidSeqByIA: Map<string, bigint> = new Map();
  /** Last Valid SeqNr for incoming Tool Access frames (when acting as MaS, 03_05_01 §6.2). */
  private _toolAccessLastValidSeq: bigint = 0n;

  private readonly failureCounters: SecurityFailureCounters = {
    cryptoErrors: 0,
    seqNrErrors: 0,
    accessRoleErrors: 0,
  };

  private lastSyncResponseTimestampMs: number = 0;
  private readonly pendingSyncWaiters: Set<PendingSyncWaiter> = new Set();

  public readonly keyring: KnxKeyring | null = null;

  constructor(options: KNXDataSecureOptions = {}) {
    super();
    this.options = {
      groupSecurityMode: "auth_conf",
      enforceSourceAddressTable: false,
      checkSequenceNumbers: true,
      autoEncryptOutgoingGroup: true,
      autoDecryptIncoming: true,
      respondToSyncRequests: true,
      syncTimeoutMs: 6000,
      forceExtendedFrame: false,
      allowSyncRollback: true,
      ...options,
    };

    this._sourceAddress = options.sourceAddress;

    if (options.initialSequenceNumber !== undefined) {
      const initSeq =
        typeof options.initialSequenceNumber === "bigint"
          ? options.initialSequenceNumber
          : BigInt(Math.trunc(options.initialSequenceNumber));
      if (initSeq < 1n || initSeq > MAX_SEQ_NR_48) {
        throw new RangeError(`initialSequenceNumber must be between 1 and ${MAX_SEQ_NR_48}`);
      }
      this._sequenceNumberSending = initSeq;
    }

    if (options.ownToolKey) {
      this.ownToolKey = parseKey16(options.ownToolKey, "ownToolKey");
    }
    if (options.ownSerialNumber) {
      this.ownSerialNumber = parseSerialNumber6(options.ownSerialNumber) ?? null;
    }

    // 1. Load ETS keyring if provided
    let loadedKeyring: KnxKeyring | null = null;
    if (options.keyring) {
      loadedKeyring = options.keyring;
    } else if (options.keyringFile) {
      loadedKeyring = KnxKeyring.fromSource(options.keyringFile, options.keyringPassword ?? "");
    }
    if (loadedKeyring) {
      this.keyring = loadedKeyring;
      this.loadFromKeyring(loadedKeyring);
    }

    // 2. Apply explicit manual key overrides
    if (options.groupKeys) {
      const entries =
        options.groupKeys instanceof Map ? Array.from(options.groupKeys.entries()) : Object.entries(options.groupKeys);
      for (const [ga, key] of entries) {
        this.setGroupKey(ga, key);
      }
    }
    if (options.groupSecurityModes) {
      const entries =
        options.groupSecurityModes instanceof Map
          ? Array.from(options.groupSecurityModes.entries())
          : Object.entries(options.groupSecurityModes);
      for (const [ga, mode] of entries) {
        this.setGroupSecurityMode(ga, mode);
      }
    }
    if (options.deviceToolKeys) {
      const entries =
        options.deviceToolKeys instanceof Map
          ? Array.from(options.deviceToolKeys.entries())
          : Object.entries(options.deviceToolKeys);
      for (const [ia, key] of entries) {
        this.setDeviceToolKey(ia, key);
      }
    }
    if (options.deviceFdsKeys) {
      const entries =
        options.deviceFdsKeys instanceof Map
          ? Array.from(options.deviceFdsKeys.entries())
          : Object.entries(options.deviceFdsKeys);
      for (const [ia, key] of entries) {
        this.setDeviceFdsk(ia, key);
      }
    }
    if (options.p2pKeys) {
      const entries =
        options.p2pKeys instanceof Map ? Array.from(options.p2pKeys.entries()) : Object.entries(options.p2pKeys);
      for (const [ia, key] of entries) {
        this.setP2PKey(ia, key);
      }
    }
    if (options.securityIndividualAddresses) {
      for (const ia of options.securityIndividualAddresses) {
        this.authorizedSenders.add(ia);
      }
    }

    // 3. Restore persisted sequence numbers if file exists (takes highest value per partner / sending)
    if (options.sequenceNumberFile) {
      this.loadPersistedState(options.sequenceNumberFile);
    }
  }

  /**
   * Imports group keys, device tool keys, device sequence numbers, serial numbers, and authorized senders
   * from a decrypted {@link KnxKeyring}.
   */
  public loadFromKeyring(keyring: KnxKeyring): void {
    for (const entry of keyring.getGroupAddresses().values()) {
      if (entry.decryptedKey) {
        try {
          const { intValue } = normalizeKeyringGroupAddress(entry.address);
          this.groupKeys.set(intValue, Buffer.from(entry.decryptedKey));
        } catch {
          // Ignore malformed group addresses
        }
      }
    }

    for (const dev of keyring.getDevices().values()) {
      this.authorizedSenders.add(dev.individualAddress);
      if (dev.decryptedToolKey) {
        this.deviceToolKeys.set(dev.individualAddress, Buffer.from(dev.decryptedToolKey));
      }
      if (dev.sequenceNumberBigInt !== undefined && dev.sequenceNumberBigInt > 0n) {
        // Keyring Device/@SequenceNumber is the device's next sending sequence number at export time.
        // Per Axiom 1/2 (03_03_07 §5.3.2), LastValidSeqNr = SequenceNumber - 1 so that `SequenceNumber` itself is accepted.
        const seededLastValid = dev.sequenceNumberBigInt - 1n;
        const current = this.lastValidSeqByIA.get(dev.individualAddress) ?? 0n;
        if (seededLastValid > current) {
          this.lastValidSeqByIA.set(dev.individualAddress, seededLastValid);
        }
      }
      if (dev.serialNumber) {
        try {
          const sn = parseSerialNumber6(dev.serialNumber);
          if (sn) this.deviceSerialNumbers.set(dev.individualAddress, sn);
        } catch {
          // Some test fixtures store shorter serial numbers; ignore safely
        }
      }
    }

    for (const iface of keyring.getInterfaces().values()) {
      this.authorizedSenders.add(iface.individualAddress);
      for (const senders of iface.groupAddresses.values()) {
        for (const sender of senders) {
          this.authorizedSenders.add(sender);
        }
      }
    }
  }

  // ============================================================================
  // Key & Resource Management
  // ============================================================================

  public get sourceAddress(): string | undefined {
    return this._sourceAddress;
  }

  public set sourceAddress(ia: string | undefined) {
    this._sourceAddress = ia;
  }

  public get sequenceNumberSending(): bigint {
    return this._sequenceNumberSending;
  }

  public setSequenceNumberSending(seq: bigint | number): void {
    const val = typeof seq === "bigint" ? seq : BigInt(Math.trunc(seq));
    if (val < 1n || val > MAX_SEQ_NR_48) {
      throw new RangeError(`Sequence Number Sending must be between 1 and ${MAX_SEQ_NR_48}`);
    }
    this._sequenceNumberSending = val;
    this.persistStateIfConfigured();
  }

  /**
   * Consumes and returns the current `Sequence Number Sending`, incrementing the counter by 1 (03_03_07 §5.3.1).
   * Throws without wrapping if the counter has reached `0xFFFFFFFFFFFFn`.
   */
  public consumeSequenceNumberSending(): bigint {
    if (this._sequenceNumberSending >= MAX_SEQ_NR_48) {
      throw new Error(
        "KNX Data Secure Sequence Number Sending reached maximum 0xFFFFFFFFFFFF and cannot wrap (03_03_07 §5.3.1)",
      );
    }
    const current = this._sequenceNumberSending;
    this._sequenceNumberSending = current + 1n;
    this.persistStateIfConfigured();
    return current;
  }

  public getLastValidSequenceNumber(individualAddress: string): bigint | undefined {
    return this.lastValidSeqByIA.get(individualAddress);
  }

  public setLastValidSequenceNumber(individualAddress: string, seq: bigint | number): void {
    const val = typeof seq === "bigint" ? seq : BigInt(Math.trunc(seq));
    if (val < 0n || val > MAX_SEQ_NR_48) {
      throw new RangeError(`Last Valid SeqNr out of 48-bit range: ${val}`);
    }
    this.lastValidSeqByIA.set(individualAddress, val);
    this.persistStateIfConfigured();
  }

  public get toolAccessLastValidSeq(): bigint {
    return this._toolAccessLastValidSeq;
  }

  public setToolAccessLastValidSeq(seq: bigint | number): void {
    const val = typeof seq === "bigint" ? seq : BigInt(Math.trunc(seq));
    if (val < 0n || val > MAX_SEQ_NR_48) {
      throw new RangeError(`Tool Access Last Valid SeqNr out of 48-bit range: ${val}`);
    }
    this._toolAccessLastValidSeq = val;
    this.persistStateIfConfigured();
  }

  public setGroupKey(groupAddress: string | number, key: Buffer | string, mode?: DataSecureMode): void {
    const { intValue } = normalizeKeyringGroupAddress(groupAddress);
    this.groupKeys.set(intValue, parseKey16(key, `groupKey(${groupAddress})`));
    if (mode) {
      this.groupModes.set(intValue, mode);
    }
  }

  public removeGroupKey(groupAddress: string | number): boolean {
    const { intValue } = normalizeKeyringGroupAddress(groupAddress);
    this.groupModes.delete(intValue);
    return this.groupKeys.delete(intValue);
  }

  public getGroupKey(groupAddress: string | number): Buffer | undefined {
    try {
      const { intValue } = normalizeKeyringGroupAddress(groupAddress);
      return this.groupKeys.get(intValue);
    } catch {
      return undefined;
    }
  }

  public hasGroupKey(groupAddress: string | number): boolean {
    return this.getGroupKey(groupAddress) !== undefined;
  }

  public getConfiguredGroupAddresses(): string[] {
    return Array.from(this.groupKeys.keys()).map((intVal) => KNXHelper.GetAddress(intVal, "/"));
  }

  /**
   * Returns a snapshot of all configured Group Keys indexed by canonical 3-level Group Address (`"1/0/1"`).
   */
  public getGroupKeys(): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    for (const [intVal, key] of this.groupKeys.entries()) {
      out.set(KNXHelper.GetAddress(intVal, "/"), Buffer.from(key));
    }
    return out;
  }

  /**
   * Returns a snapshot of all configured Device Tool Keys indexed by Individual Address (`"1.1.1"`).
   */
  public getDeviceToolKeys(): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    for (const [ia, key] of this.deviceToolKeys.entries()) {
      out.set(ia, Buffer.from(key));
    }
    return out;
  }

  /**
   * Returns a snapshot of all tracked 48-bit Last Valid Sequence Numbers indexed by sender Individual Address.
   */
  public getLastValidSequenceNumbers(): Map<string, bigint> {
    return new Map(this.lastValidSeqByIA);
  }

  /**
   * Returns a snapshot of all configured 6-byte device Serial Numbers indexed by Individual Address.
   */
  public getDeviceSerialNumbers(): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    for (const [ia, sn] of this.deviceSerialNumbers.entries()) {
      out.set(ia, Buffer.from(sn));
    }
    return out;
  }

  /**
   * Synchronizes Group Keys, Device Tool Keys, Serial Numbers, and live 48-bit Sequence Numbers
   * from this runtime `KnxDataSecure` manager into a {@link KnxKeyring} instance (ready for `.knxkeys` export).
   *
   * Note: Per KNX Standard `03_03_07` §5.3.2, `Device/@SequenceNumber` in `.knxkeys` represents the next
   * sending sequence number (`LastValidSeqNr + 1` for remote devices; `sequenceNumberSending` for `sourceAddress`).
   */
  public syncToKeyring(
    keyring: KnxKeyring,
    options: {
      includeGroupKeys?: boolean;
      includeToolKeys?: boolean;
      includeSequenceNumbers?: boolean;
      includeSerialNumbers?: boolean;
      deviceAddresses?: string[];
    } = {},
  ): KnxKeyring {
    const includeGroupKeys = options.includeGroupKeys ?? true;
    const includeToolKeys = options.includeToolKeys ?? true;
    const includeSequenceNumbers = options.includeSequenceNumbers ?? true;
    const includeSerialNumbers = options.includeSerialNumbers ?? true;
    const filter = options.deviceAddresses ? new Set(options.deviceAddresses.map((ia) => ia.trim())) : undefined;

    if (includeGroupKeys) {
      for (const [intVal, key] of this.groupKeys.entries()) {
        keyring.setGroupKey(intVal, key);
      }
    }

    const deviceIas = new Set<string>();
    if (includeToolKeys) {
      for (const ia of this.deviceToolKeys.keys()) deviceIas.add(ia);
    }
    if (includeSequenceNumbers) {
      for (const ia of this.lastValidSeqByIA.keys()) deviceIas.add(ia);
      if (this._sourceAddress) deviceIas.add(this._sourceAddress);
    }
    if (includeSerialNumbers) {
      for (const ia of this.deviceSerialNumbers.keys()) deviceIas.add(ia);
    }

    for (const ia of deviceIas) {
      if (filter && !filter.has(ia)) continue;
      if (!KNXHelper.isValidIndividualAddress(ia)) continue;

      const patch: Parameters<KnxKeyring["setDevice"]>[0] = { individualAddress: ia, merge: true };
      let hasData = false;

      if (includeToolKeys) {
        const tk =
          this.deviceToolKeys.get(ia) ?? (ia === this._sourceAddress ? (this.ownToolKey ?? undefined) : undefined);
        if (tk) {
          patch.toolKey = tk;
          hasData = true;
        }
      }
      if (includeSequenceNumbers) {
        if (ia === this._sourceAddress) {
          patch.sequenceNumber = this._sequenceNumberSending;
          hasData = true;
        } else {
          const lastValid = this.lastValidSeqByIA.get(ia);
          if (lastValid !== undefined && lastValid > 0n) {
            const nextSeq = lastValid < MAX_SEQ_NR_48 ? lastValid + 1n : MAX_SEQ_NR_48;
            patch.sequenceNumber = nextSeq;
            hasData = true;
          }
        }
      }
      if (includeSerialNumbers) {
        const sn =
          this.deviceSerialNumbers.get(ia) ??
          (ia === this._sourceAddress ? (this.ownSerialNumber ?? undefined) : undefined);
        if (sn) {
          patch.serialNumber = sn;
          hasData = true;
        }
      }

      if (hasData) {
        keyring.setDevice(patch);
      }
    }

    return keyring;
  }

  public setGroupSecurityMode(groupAddress: string | number, mode: DataSecureMode): void {
    const { intValue } = normalizeKeyringGroupAddress(groupAddress);
    this.groupModes.set(intValue, mode);
  }

  public getGroupSecurityMode(groupAddress: string | number): DataSecureMode {
    try {
      const { intValue } = normalizeKeyringGroupAddress(groupAddress);
      return this.groupModes.get(intValue) ?? this.options.groupSecurityMode ?? "auth_conf";
    } catch {
      return this.options.groupSecurityMode ?? "auth_conf";
    }
  }

  public setDeviceToolKey(individualAddress: string, key: Buffer | string): void {
    this.deviceToolKeys.set(individualAddress, parseKey16(key, `toolKey(${individualAddress})`));
  }

  public getDeviceToolKey(individualAddress: string): Buffer | undefined {
    return this.deviceToolKeys.get(individualAddress);
  }

  public setDeviceFdsk(individualAddress: string, key: Buffer | string): void {
    this.deviceFdsKeys.set(individualAddress, parseKey16(key, `fdsk(${individualAddress})`));
  }

  public getDeviceFdsk(individualAddress: string): Buffer | undefined {
    return this.deviceFdsKeys.get(individualAddress);
  }

  public setDeviceSerialNumber(individualAddress: string, serialNumber: Buffer | string): void {
    const sn = parseSerialNumber6(serialNumber);
    if (sn) this.deviceSerialNumbers.set(individualAddress, sn);
  }

  public getDeviceSerialNumber(individualAddress: string): Buffer | undefined {
    return this.deviceSerialNumbers.get(individualAddress);
  }

  public setP2PKey(individualAddress: string, key: Buffer | string): void {
    this.p2pKeys.set(individualAddress, parseKey16(key, `p2pKey(${individualAddress})`));
    this.authorizedSenders.add(individualAddress);
  }

  public getP2PKey(individualAddress: string): Buffer | undefined {
    return this.p2pKeys.get(individualAddress);
  }

  public setOwnToolKey(key: Buffer | string | null): void {
    this.ownToolKey = key ? parseKey16(key, "ownToolKey") : null;
  }

  public getOwnToolKey(): Buffer | null {
    return this.ownToolKey;
  }

  public addAuthorizedSender(individualAddress: string): void {
    this.authorizedSenders.add(individualAddress);
  }

  public getSecurityFailureCounters(): Readonly<SecurityFailureCounters> {
    return { ...this.failureCounters };
  }

  public clearSecurityFailureCounters(): void {
    this.failureCounters.cryptoErrors = 0;
    this.failureCounters.seqNrErrors = 0;
    this.failureCounters.accessRoleErrors = 0;
  }

  // ============================================================================
  // Persistence (03_03_07 §5.3.1 Power down behaviour)
  // ============================================================================

  public exportState(): DataSecurePersistedState {
    const lastValid: Record<string, string> = {};
    for (const [ia, seq] of this.lastValidSeqByIA.entries()) {
      lastValid[ia] = seq.toString();
    }
    return {
      version: 1,
      sequenceNumberSending: this._sequenceNumberSending.toString(),
      toolAccessLastValidSeq: this._toolAccessLastValidSeq.toString(),
      lastValidSeqByIA: lastValid,
    };
  }

  public importState(state: DataSecurePersistedState): void {
    if (state.sequenceNumberSending) {
      const seq = BigInt(state.sequenceNumberSending);
      if (seq > this._sequenceNumberSending && seq <= MAX_SEQ_NR_48) {
        this._sequenceNumberSending = seq;
      }
    }
    if (state.toolAccessLastValidSeq) {
      const toolSeq = BigInt(state.toolAccessLastValidSeq);
      if (toolSeq > this._toolAccessLastValidSeq && toolSeq <= MAX_SEQ_NR_48) {
        this._toolAccessLastValidSeq = toolSeq;
      }
    }
    if (state.lastValidSeqByIA) {
      for (const [ia, seqStr] of Object.entries(state.lastValidSeqByIA)) {
        const seq = BigInt(seqStr);
        const cur = this.lastValidSeqByIA.get(ia) ?? 0n;
        if (seq > cur && seq <= MAX_SEQ_NR_48) {
          this.lastValidSeqByIA.set(ia, seq);
        }
      }
    }
  }

  public saveState(filePath?: string): void {
    const target = filePath ?? this.options.sequenceNumberFile;
    if (!target) return;
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(target, JSON.stringify(this.exportState(), null, 2), "utf8");
  }

  private loadPersistedState(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as DataSecurePersistedState;
      this.importState(parsed);
    } catch {
      // Do not crash on unreadable/corrupt persistence file
    }
  }

  private persistStateIfConfigured(): void {
    if (!this.options.sequenceNumberFile) return;
    try {
      this.saveState(this.options.sequenceNumberFile);
    } catch {
      // Best-effort persistence
    }
  }

  // ============================================================================
  // Outgoing S-A_Data CEMI Wrapping (03_03_07 §5.1.3 & §5.5)
  // ============================================================================

  /**
   * Wraps a plain `L_Data.req` / `L_Data.ind` CEMI frame into an `S-A_Data` KNX Data Secure CEMI frame.
   *
   * - Leaves already-secure (`0x3F1`) and Transport Control (`T_Connect`, `T_Disconnect`, `T_ACK`, `T_NAK`) frames untouched.
   * - Automatically sets Extended Frame (`FT = 0`) when the resulting Secure APDU length exceeds 15 octets.
   * - Increments `sequenceNumberSending` unless an explicit `options.sequenceNumber` override is passed.
   */
  public wrapCemi(cemi: CEMIInstance, options: WrapCemiOptions = {}): CEMIInstance {
    if (!isLDataCemi(cemi)) return cemi;
    if (cemi.TPDU.tpci.dataControlFlag) return cemi;
    if (cemi.TPDU.apdu.apci.value === APCI_DATA_SECURE) return cemi;

    const isGroupAddr = cemi.controlField2.addressType === AddressType.GROUP;
    const isBroadcastDest = isGroupAddr && cemi.destinationAddress === "0/0/0";

    // Resolve key, toolAccess, confidentiality, systemBroadcast
    let key: Buffer | undefined = options.key ? parseKey16(options.key, "wrapCemi.key") : undefined;
    const toolAccess = options.toolAccess ?? false;
    let confidentiality = options.confidentiality;
    let systemBroadcast = options.systemBroadcast;

    if (isGroupAddr && !isBroadcastDest) {
      // T_Data_Group (03_03_07 §5.5.3.3 & Table 10: Tool Key shall NOT be used on T_Data_Group)
      if (toolAccess) {
        throw new Error("Tool Key cannot be used for T_Data_Group communication (03_03_07 §5.5.3.3 & Table 10)");
      }
      if (!key) {
        key = this.getGroupKey(cemi.destinationAddress);
      }
      if (!key) return cemi;
      if (confidentiality === undefined) {
        confidentiality = this.getGroupSecurityMode(cemi.destinationAddress) === "auth_conf";
      }
      if (systemBroadcast === undefined) systemBroadcast = false;
    } else if (isBroadcastDest) {
      // Broadcast / System Broadcast (03_03_07 §5.5.6.3 & §5.5.7.3)
      if (!key) return cemi;
      if (confidentiality === undefined) confidentiality = true;
      if (systemBroadcast === undefined) {
        // ControlField bit 4 (systemBroadcast): 0 = System Broadcast, 1 = Broadcast
        systemBroadcast = !cemi.controlField1.systemBroadcast;
      }
    } else {
      // Point-to-point Individual / Connected (03_03_07 §5.5.5.3)
      if (!key) {
        if (options.toolAccess) {
          key = this.deviceToolKeys.get(cemi.destinationAddress) ?? this.deviceFdsKeys.get(cemi.destinationAddress);
        } else {
          key = this.p2pKeys.get(cemi.destinationAddress);
        }
      }
      if (!key) {
        if (options.toolAccess !== undefined || options.confidentiality !== undefined) {
          throw new Error(`No KNX Data Secure key configured for target ${cemi.destinationAddress}`);
        }
        return cemi;
      }
      if (confidentiality === undefined) confidentiality = true;
      if (systemBroadcast === undefined) systemBroadcast = false;
    }

    // 03_05_01 §6.3.10.4: Tool Key requires A+C (unless explicitly overridden for testing)
    const rawSource =
      options.sourceAddress ?? (cemi.sourceAddress !== "0.0.0" ? cemi.sourceAddress : this._sourceAddress);
    const sourceAddress = rawSource ?? "0.0.0";
    if (!options.localTl && sourceAddress === "0.0.0") {
      throw new Error(
        "KNX Data Secure requires a non-zero Source Individual Address (SA is authenticated in B0/Ctr0; set sourceAddress or service.individualAddress)",
      );
    }

    const plainTpduBuf = cemi.TPDU.toBuffer();
    if (plainTpduBuf.length < 2) {
      throw new Error(`Cannot secure TPDU shorter than 2 bytes (len=${plainTpduBuf.length})`);
    }
    const tpciByte = plainTpduBuf[0];
    const plainApdu = Buffer.from(plainTpduBuf);
    plainApdu[0] &= 0x03; // 000000b | APCI(high 2 bits)

    // Resulting Secure APDU length (excluding TPCI byte) = 1 (APCISec low) + 1 (SCF) + 6 (SeqNr) + plainApdu.length + 4 (MAC)
    const resultingApduLength = 1 + 1 + 6 + plainApdu.length + 4;
    const cf1 = new ControlField(cemi.controlField1.buffer[0]);
    const cf2 = new ExtendedControlField(cemi.controlField2.toNumber());

    const forceExt = options.forceExtendedFrame ?? this.options.forceExtendedFrame ?? false;
    if (resultingApduLength > 15 || forceExt) {
      cf1.frameType = false; // Extended Frame (FT = 0)
    }
    const isExtendedFrame = !cf1.frameType;

    const seqNr =
      options.sequenceNumber !== undefined
        ? typeof options.sequenceNumber === "bigint"
          ? options.sequenceNumber
          : BigInt(Math.trunc(options.sequenceNumber))
        : this.consumeSequenceNumberSending();

    const built = buildSADataPdu({
      key,
      seqNr,
      plainApdu,
      confidentiality,
      toolAccess,
      systemBroadcast,
      sourceAddress,
      destinationAddress: cemi.destinationAddress,
      addressType: cf2.addressType,
      isExtendedFrame,
      eff: cf2.eff,
      tpciByte,
      localTl: options.localTl,
    });

    const secureTpci = new TPCI((tpciByte & 0xfc) as TPCIType);
    const secureApdu = new APDU(
      new TPCI((tpciByte & 0xfc) as TPCIType),
      new APCI(APCIEnum.A_DataSecure_Protocol_Data_Unit),
      built.secureAsdu,
      false,
    );
    const secureTpdu = new TPDU(secureTpci, secureApdu, built.secureAsdu);

    const addInfoItems = cemi.additionalInfo.items.length > 0 ? [...cemi.additionalInfo.items] : null;
    if (cemi.messageCode === MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value) {
      return new CEMI.DataLinkLayerCEMI["L_Data.ind"](
        addInfoItems,
        cf1,
        cf2,
        sourceAddress,
        cemi.destinationAddress,
        secureTpdu,
      );
    }
    if (cemi.messageCode === MESSAGE_CODE_FIELD["L_Data.con"].CEMI.value) {
      return new CEMI.DataLinkLayerCEMI["L_Data.con"](
        addInfoItems,
        cf1,
        cf2,
        sourceAddress,
        cemi.destinationAddress,
        secureTpdu,
      );
    }
    return new CEMI.DataLinkLayerCEMI["L_Data.req"](
      addInfoItems,
      cf1,
      cf2,
      sourceAddress,
      cemi.destinationAddress,
      secureTpdu,
    );
  }

  /**
   * Automatically encrypts outgoing `L_Data.req` Group frames if `autoEncryptOutgoingGroup` is enabled
   * and a Group Key exists for the destination Group Address.
   */
  public prepareOutgoingCemi(data: Buffer | CEMIInstance, defaultSourceAddress?: string): Buffer | CEMIInstance {
    if (!this.options.autoEncryptOutgoingGroup) return data;

    let cemi: CEMIInstance;
    const wasBuffer = Buffer.isBuffer(data);
    if (wasBuffer) {
      try {
        cemi = CEMI.fromBuffer(data);
      } catch {
        return data;
      }
    } else {
      cemi = data;
    }

    if (!isLDataCemi(cemi)) return data;
    if (cemi.messageCode !== MESSAGE_CODE_FIELD["L_Data.req"].CEMI.value) return data;
    if (cemi.TPDU.tpci.dataControlFlag) return data;
    if (cemi.TPDU.apdu.apci.value === APCI_DATA_SECURE) return data;
    if (cemi.controlField2.addressType !== AddressType.GROUP || cemi.destinationAddress === "0/0/0") return data;
    if (!this.hasGroupKey(cemi.destinationAddress)) return data;

    const wrapped = this.wrapCemi(cemi, {
      sourceAddress:
        cemi.sourceAddress !== "0.0.0" ? cemi.sourceAddress : (this._sourceAddress ?? defaultSourceAddress),
    });
    return wasBuffer ? wrapped.toBuffer() : wrapped;
  }

  // ============================================================================
  // Incoming S-A_Data / S-A_Sync Processing (03_03_07 §5.1.3, §5.3.2, §5.5)
  // ============================================================================

  /**
   * Unwraps and verifies a single incoming `L_Data.ind` `S-A_Data` CEMI frame.
   * For plain frames or `L_Data.con`, returns `{ handled: false, plainCemi: cemi }`.
   */
  public unwrapCemi(cemi: CEMIInstance, options: { key?: Buffer; localTl?: boolean } = {}): UnwrapCemiResult {
    if (!isLDataCemi(cemi)) {
      return { handled: false, plainCemi: cemi };
    }
    if (cemi.TPDU.tpci.dataControlFlag || cemi.TPDU.apdu.apci.value !== APCI_DATA_SECURE) {
      return { handled: false, plainCemi: cemi };
    }
    // Do not run reception anti-replay / attack handling on own local confirmation echoes (L_Data.con)
    if (cemi.messageCode === MESSAGE_CODE_FIELD["L_Data.con"].CEMI.value) {
      return { handled: false, plainCemi: cemi };
    }

    const secureAsdu = cemi.TPDU.apdu.data;
    const header = parseSecureAsduHeader(secureAsdu);
    if (!header.valid) {
      // 03_03_07 §5.1.3.4.2 step 1: unsupported/reserved SCF ignored without logging in Security Failures Log
      this.emitFailure("invalid_scf", cemi);
      return { handled: true, plainCemi: null, failureReason: "invalid_scf" };
    }

    if (header.service !== SecureAlService.S_A_DATA) {
      return { handled: true, plainCemi: null, service: header.service };
    }

    const { scf, seqNr } = header;
    const isGroupAddr = cemi.controlField2.addressType === AddressType.GROUP;
    const isBroadcastDest = isGroupAddr && cemi.destinationAddress === "0/0/0";
    const src = cemi.sourceAddress;
    const dst = cemi.destinationAddress;

    // 1. Validate Tool Access flag & select key per 03_03_07 §5.5.3–5.5.7 & Table 10
    let candidateKeys: Buffer[] = [];
    let isMaSToolAccess = false;

    if (options.key) {
      candidateKeys = [options.key];
    } else if (isGroupAddr && !isBroadcastDest) {
      // T_Data_Group
      const groupKey = this.getGroupKey(dst);
      if (!groupKey) {
        this.emit("ignored", { reason: "unknown_key", cemi });
        return { handled: true, plainCemi: null, failureReason: "unknown_key", service: SecureAlService.S_A_DATA };
      }
      if (scf.toolAccess) {
        // 03_03_07 §5.5.3.2 step 1.1.1: Tool Access on Group is an attack -> Counter of Access or Roles errors
        this.failureCounters.accessRoleErrors++;
        this.emitFailure("tool_flag_on_group", cemi, seqNr);
        return {
          handled: true,
          plainCemi: null,
          failureReason: "tool_flag_on_group",
          service: SecureAlService.S_A_DATA,
        };
      }
      if (this.options.enforceSourceAddressTable && !this.authorizedSenders.has(src)) {
        // 03_03_07 §5.2.1.1 step 1: unknown SA ignored without incrementing failure counter
        this.emit("ignored", { reason: "unknown_sender", cemi });
        return { handled: true, plainCemi: null, failureReason: "unknown_sender", service: SecureAlService.S_A_DATA };
      }
      candidateKeys = [groupKey];
    } else if (scf.toolAccess) {
      // Point-to-point / Broadcast / System Broadcast with Tool Access
      const devToolKey = this.deviceToolKeys.get(src);
      const devFdsk = this.deviceFdsKeys.get(src);
      if (devToolKey) candidateKeys.push(devToolKey);
      if (devFdsk) candidateKeys.push(devFdsk);
      if (this.ownToolKey) {
        candidateKeys.push(this.ownToolKey);
        if (!devToolKey && !devFdsk) isMaSToolAccess = true;
      }
      if (candidateKeys.length === 0) {
        this.emit("ignored", { reason: "unknown_key", cemi });
        return { handled: true, plainCemi: null, failureReason: "unknown_key", service: SecureAlService.S_A_DATA };
      }
    } else {
      // Point-to-point / Broadcast with P2P Key Table
      if (isBroadcastDest && scf.systemBroadcast) {
        // 03_03_07 §5.5.6.2 step 1.1: System Broadcast without Tool Access -> ignore
        this.emit("ignored", { reason: "unsupported_comm_mode", cemi });
        return {
          handled: true,
          plainCemi: null,
          failureReason: "unsupported_comm_mode",
          service: SecureAlService.S_A_DATA,
        };
      }
      if (this.options.enforceSourceAddressTable && !this.authorizedSenders.has(src)) {
        this.emit("ignored", { reason: "unknown_sender", cemi });
        return { handled: true, plainCemi: null, failureReason: "unknown_sender", service: SecureAlService.S_A_DATA };
      }
      const p2pKey = this.p2pKeys.get(src);
      if (!p2pKey) {
        this.emit("ignored", { reason: "unknown_key", cemi });
        return { handled: true, plainCemi: null, failureReason: "unknown_key", service: SecureAlService.S_A_DATA };
      }
      candidateKeys = [p2pKey];
    }

    // 2. Sequence Number freshness verification (03_03_07 §5.3.1)
    if (this.options.checkSequenceNumbers) {
      if (seqNr === 0n) {
        // 03_03_07 §5.3.1 Note 31: SeqNr 0 is always ignored
        this.emitFailure("seq_zero", cemi, seqNr);
        return { handled: true, plainCemi: null, failureReason: "seq_zero", service: SecureAlService.S_A_DATA };
      }
      const lastValid = isMaSToolAccess ? this._toolAccessLastValidSeq : this.lastValidSeqByIA.get(src);
      if (lastValid !== undefined) {
        if (seqNr === lastValid) {
          // 03_03_07 §5.3.1 Note 28: duplicate retransmission -> ignore WITHOUT incrementing failure counter
          this.emit("ignored", { reason: "seq_duplicate", cemi, seqNr });
          return { handled: true, plainCemi: null, failureReason: "seq_duplicate", service: SecureAlService.S_A_DATA };
        }
        if (seqNr < lastValid) {
          this.failureCounters.seqNrErrors++;
          this.emitFailure("seq_too_low", cemi, seqNr);
          return { handled: true, plainCemi: null, failureReason: "seq_too_low", service: SecureAlService.S_A_DATA };
        }
      }
    }

    // 3. Decrypt & verify MAC
    const isExtendedFrame = !cemi.controlField1.frameType;
    const tpciByte = cemi.TPDU.tpci.getValue();

    let result: ReturnType<typeof decryptSADataPdu> | null = null;
    for (const key of candidateKeys) {
      const attempt = decryptSADataPdu({
        key,
        secureAsdu,
        sourceAddress: src,
        destinationAddress: dst,
        addressType: cemi.controlField2.addressType,
        isExtendedFrame,
        eff: cemi.controlField2.eff,
        tpciByte,
        localTl: options.localTl,
      });
      if (attempt.cryptoVerified) {
        result = attempt;
        break;
      }
    }

    if (!result || !result.cryptoVerified || !result.plainApdu) {
      this.failureCounters.cryptoErrors++;
      this.emitFailure("mac_mismatch", cemi, seqNr);
      return { handled: true, plainCemi: null, failureReason: "mac_mismatch", service: SecureAlService.S_A_DATA };
    }

    // 4. Update Last Valid SeqNr (even if 6 reserved bits are invalid, per 03_03_07 §5.2.1.4!)
    if (isMaSToolAccess) {
      if (seqNr > this._toolAccessLastValidSeq) {
        this._toolAccessLastValidSeq = seqNr;
        this.persistStateIfConfigured();
      }
    } else {
      const prev = this.lastValidSeqByIA.get(src) ?? 0n;
      if (seqNr > prev) {
        this.lastValidSeqByIA.set(src, seqNr);
        this.persistStateIfConfigured();
      }
    }

    if (!result.reservedBitsValid) {
      // 03_03_07 §5.2.1.4: do NOT pass to P-AL and do NOT increment Security Failure Log
      this.emitFailure("invalid_reserved_bits", cemi, seqNr);
      return {
        handled: true,
        plainCemi: null,
        failureReason: "invalid_reserved_bits",
        service: SecureAlService.S_A_DATA,
      };
    }

    // 5. Reconstruct Plain TPDU & Plain CEMI
    const plainTpduBytes = Buffer.from(result.plainApdu);
    plainTpduBytes[0] = (tpciByte & 0xfc) | (plainTpduBytes[0] & 0x03);
    const plainTpdu = TPDU.fromBuffer(plainTpduBytes);

    const addInfoItems = cemi.additionalInfo.items.length > 0 ? [...cemi.additionalInfo.items] : null;
    const cf1 = new ControlField(cemi.controlField1.buffer[0]);
    const cf2 = new ExtendedControlField(cemi.controlField2.toNumber());

    const plainCemi: DataSecureCEMI = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
      addInfoItems,
      cf1,
      cf2,
      src,
      dst,
      plainTpdu,
    );

    const metadata: DataSecureMetadata = {
      authenticated: true,
      confidential: scf.algorithmId === SecurityAlgorithmId.CCM_AUTH_CONF,
      toolAccess: scf.toolAccess,
      systemBroadcast: scf.systemBroadcast,
      sequenceNumber: seqNr,
      scf,
      rawSecureCemi: cemi,
    };
    plainCemi.dataSecure = metadata;

    this.emit("decrypted", { plainCemi, metadata });
    return { handled: true, plainCemi, metadata, service: SecureAlService.S_A_DATA };
  }

  /**
   * Entry point invoked by {@link KNXService} when any incoming CEMI arrives.
   * Handles `S-A_Sync_Req` (auto-responding when enabled), `S-A_Sync_Res` (resolving pending sync waiters),
   * and `S-A_Data` (decrypting and returning the restored plain CEMI).
   *
   * Returns:
   * - Original `cemi` if it is a plain frame or `L_Data.con`
   * - Decrypted plain `DataSecureCEMI` if it is a valid `S-A_Data`
   * - `null` if the frame was consumed (`S-A_Sync`) or rejected (security failure / unknown key)
   */
  public handleIncomingCemi(cemi: CEMIInstance, service?: KNXService): CEMIInstance | null {
    if (!this.options.autoDecryptIncoming) return cemi;
    if (!isLDataCemi(cemi)) return cemi;
    if (cemi.TPDU.tpci.dataControlFlag || cemi.TPDU.apdu.apci.value !== APCI_DATA_SECURE) {
      return cemi;
    }
    if (cemi.messageCode === MESSAGE_CODE_FIELD["L_Data.con"].CEMI.value) {
      return cemi;
    }

    const header = parseSecureAsduHeader(cemi.TPDU.apdu.data);
    if (!header.valid) {
      this.emitFailure("invalid_scf", cemi);
      return null;
    }

    if (header.service === SecureAlService.S_A_SYNC_RES) {
      this.handleIncomingSyncRes(cemi);
      // Preserve numbered T_Data_Connected S-A_Sync_Res so an active TransportConnection can T_ACK and advance rxSequence
      return cemi.TPDU.tpci.numberedFlag ? cemi : null;
    }

    if (header.service === SecureAlService.S_A_SYNC_REQ) {
      this.handleIncomingSyncReq(cemi, service);
      return null;
    }

    const unwrapped = this.unwrapCemi(cemi);
    return unwrapped.plainCemi;
  }

  // ============================================================================
  // S-A_Sync Service (03_03_07 §5.3.2 & 03_05_02 §4.1–4.2)
  // ============================================================================

  /**
   * Executes `DM_SecureSync_RCl` (`"individual"` / `"connected"`) or `DM_SecureSync_SBC` (`"broadcast"` / `"system_broadcast"`)
   * to synchronize both local and remote 48-bit Data Security Sequence Numbers with a target device.
   */
  public async syncSequenceNumber(
    service: KNXService,
    targetAddress: string,
    options: SyncSequenceNumberOptions = {},
  ): Promise<SyncSequenceNumberResult> {
    const commMode: DataSecureCommMode = options.commMode ?? "individual";
    const defaultToolAccess =
      options.toolAccess ??
      (this.deviceToolKeys.has(targetAddress) ||
        this.deviceFdsKeys.has(targetAddress) ||
        !this.p2pKeys.has(targetAddress));

    let primaryKey: Buffer | undefined = options.key ? parseKey16(options.key, "sync.key") : undefined;
    let fallbackKey: Buffer | undefined = options.fallbackKey
      ? parseKey16(options.fallbackKey, "sync.fallbackKey")
      : undefined;

    if (!primaryKey) {
      if (defaultToolAccess) {
        primaryKey = this.deviceToolKeys.get(targetAddress) ?? this.deviceFdsKeys.get(targetAddress);
        if (!fallbackKey && this.deviceToolKeys.has(targetAddress) && this.deviceFdsKeys.has(targetAddress)) {
          fallbackKey = this.deviceFdsKeys.get(targetAddress);
        }
      } else {
        primaryKey = this.p2pKeys.get(targetAddress);
      }
    }

    if (!primaryKey) {
      throw new Error(`No KNX Data Secure key available for S-A_Sync with ${targetAddress}`);
    }

    const serialNumber =
      parseSerialNumber6(options.serialNumber) ?? this.deviceSerialNumbers.get(targetAddress) ?? Buffer.alloc(6, 0x00);

    if ((commMode === "broadcast" || commMode === "system_broadcast") && serialNumber.every((b) => b === 0)) {
      throw new Error(
        `DM_SecureSync_SBC (${commMode}) requires a non-zero 6-byte KNX Serial Number (03_03_07 §5.3.2 & 03_05_02 §4.1)`,
      );
    }

    try {
      return await this.runSyncAttempt(service, targetAddress, {
        commMode,
        toolAccess: defaultToolAccess,
        key: primaryKey,
        usedFallbackKey: false,
        serialNumber,
        sourceAddress: options.sourceAddress,
        challenge: options.challenge,
        seqNrLocal: options.seqNrLocal,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        connectedChannel: options.connectedChannel,
      });
    } catch (primaryErr) {
      if (!fallbackKey) throw primaryErr;
      // 03_05_02 §4.1 Note 18 / §4.2 Note 19: retry with fallback key (ToolKey <-> FDSK)
      return await this.runSyncAttempt(service, targetAddress, {
        commMode,
        toolAccess: defaultToolAccess,
        key: fallbackKey,
        usedFallbackKey: true,
        serialNumber,
        sourceAddress: options.sourceAddress,
        challenge: options.challenge,
        seqNrLocal: options.seqNrLocal,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        connectedChannel: options.connectedChannel,
      });
    }
  }

  private async runSyncAttempt(
    service: KNXService,
    targetAddress: string,
    params: {
      commMode: DataSecureCommMode;
      toolAccess: boolean;
      key: Buffer;
      usedFallbackKey: boolean;
      serialNumber: Buffer;
      sourceAddress?: string;
      challenge?: Buffer;
      seqNrLocal?: bigint | number;
      timeoutMs?: number;
      retries?: number;
      connectedChannel?: SyncSequenceNumberOptions["connectedChannel"];
    },
  ): Promise<SyncSequenceNumberResult> {
    const sourceAddress = params.sourceAddress ?? this._sourceAddress ?? service.individualAddress;
    if (!sourceAddress || sourceAddress === "0.0.0") {
      throw new Error("S-A_Sync requires a non-zero Source Individual Address");
    }

    const timeoutMs = params.timeoutMs ?? this.options.syncTimeoutMs ?? 6000;
    // 03_05_02 §4.2: connection-oriented shall NOT be repeated; connectionless/broadcast repeat once (total 2 attempts)
    const maxRetries = params.commMode === "connected" ? 0 : (params.retries ?? 1);
    const seqNrLocal =
      params.seqNrLocal !== undefined
        ? typeof params.seqNrLocal === "bigint"
          ? params.seqNrLocal
          : BigInt(Math.trunc(params.seqNrLocal))
        : this._sequenceNumberSending;

    // If caller didn't attach this KnxDataSecure instance to `service`, listen temporarily for S-A_Sync_Res
    const needsDirectListener = service.dataSecure !== this;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeSingleSyncExchange(service, targetAddress, {
          ...params,
          sourceAddress,
          seqNrLocal,
          timeoutMs,
          needsDirectListener,
        });

        // Apply 03_03_07 §5.3.2 Comparisons 1 & 2
        const remoteIA = result.remoteAddress || targetAddress;
        const receivedRemoteLastValid = result.seqNrRemote > 0n ? result.seqNrRemote - 1n : 0n;
        const storedRemoteLastValid = this.lastValidSeqByIA.get(remoteIA);

        if (
          storedRemoteLastValid === undefined ||
          receivedRemoteLastValid > storedRemoteLastValid ||
          this.options.allowSyncRollback
        ) {
          this.lastValidSeqByIA.set(remoteIA, receivedRemoteLastValid);
        }

        // Comparison 2: SeqNrlocal = max(seqNrLocal_received, current Sequence Number Sending)
        if (result.seqNrLocal > this._sequenceNumberSending && result.seqNrLocal <= MAX_SEQ_NR_48) {
          this._sequenceNumberSending = result.seqNrLocal;
        }
        this.persistStateIfConfigured();

        return {
          remoteAddress: remoteIA,
          seqNrRemote: result.seqNrRemote,
          seqNrLocal: result.seqNrLocal,
          commMode: params.commMode,
          usedToolKey: params.toolAccess,
          usedFallbackKey: params.usedFallbackKey,
        };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error(`S-A_Sync failed with ${targetAddress}`);
  }

  private async executeSingleSyncExchange(
    service: KNXService,
    targetAddress: string,
    params: {
      commMode: DataSecureCommMode;
      toolAccess: boolean;
      key: Buffer;
      serialNumber: Buffer;
      sourceAddress: string;
      challenge?: Buffer;
      seqNrLocal: bigint;
      timeoutMs: number;
      needsDirectListener: boolean;
      connectedChannel?: SyncSequenceNumberOptions["connectedChannel"];
    },
  ): Promise<{ remoteAddress: string; seqNrRemote: bigint; seqNrLocal: bigint }> {
    const isBroadcast = params.commMode === "broadcast" || params.commMode === "system_broadcast";
    const destinationAddress = isBroadcast ? "0/0/0" : targetAddress;
    const addressType = isBroadcast ? AddressType.GROUP : AddressType.INDIVIDUAL;
    // Extended Frame (FT=0, length=24): System priority (00b), Do-not-repeat (1), SB=0 for system_broadcast else 1
    const cf1Byte = params.commMode === "system_broadcast" ? 0x20 : 0x30;
    const cf2Byte = isBroadcast ? 0xe0 : 0x60;

    // Special path: caller supplied an already-open TransportConnection channel
    if (params.commMode === "connected" && params.connectedChannel) {
      const tpciByte = TPCIType.T_DATA_CONNECTED_PDU | ((params.connectedChannel.txSequence & 0x0f) << 2);
      const built = buildSASyncReqPdu({
        key: params.key,
        seqNrLocal: params.seqNrLocal,
        serialNumber: params.serialNumber,
        challenge: params.challenge,
        toolAccess: params.toolAccess,
        systemBroadcast: false,
        sourceAddress: params.sourceAddress,
        destinationAddress,
        addressType,
        isExtendedFrame: true,
        eff: 0,
        tpciByte,
      });
      // Register response waiter BEFORE sending so a fast S-A_Sync_Res arriving right after T_ACK is never missed
      const respPromise = params.connectedChannel.waitResponse(params.timeoutMs);
      respPromise.catch(() => {});
      await params.connectedChannel.sendNumbered(built.secureAsdu);
      const respCemi = await respPromise;
      if (!isLDataCemi(respCemi)) throw new Error("Invalid S-A_Sync_Res frame");
      const dec = decryptSASyncResPdu({
        key: params.key,
        challenge: built.challenge,
        secureAsdu: respCemi.TPDU.apdu.data,
        sourceAddress: respCemi.sourceAddress,
        destinationAddress: respCemi.destinationAddress,
        addressType: respCemi.controlField2.addressType,
        isExtendedFrame: !respCemi.controlField1.frameType,
        eff: respCemi.controlField2.eff,
        tpciByte: respCemi.TPDU.tpci.getValue(),
      });
      if (!dec.ok || dec.seqNrRemote === undefined || dec.seqNrLocal === undefined) {
        throw new Error(`S-A_Sync_Res verification failed: ${dec.reason ?? "invalid MAC"}`);
      }
      return { remoteAddress: respCemi.sourceAddress, seqNrRemote: dec.seqNrRemote, seqNrLocal: dec.seqNrLocal };
    }

    // Standalone connected mode: open temporary T_Connect, send T_Data_Connected(seq=0), T_ACK response, T_Disconnect
    const isConnectedStandalone = params.commMode === "connected";
    const tpciByte = isConnectedStandalone ? TPCIType.T_DATA_CONNECTED_PDU : TPCIType.T_DATA_INDIVIDUAL_PDU;

    const built = buildSASyncReqPdu({
      key: params.key,
      seqNrLocal: params.seqNrLocal,
      serialNumber: params.serialNumber,
      challenge: params.challenge,
      toolAccess: params.toolAccess,
      systemBroadcast: isBroadcast,
      sourceAddress: params.sourceAddress,
      destinationAddress,
      addressType,
      isExtendedFrame: true,
      eff: 0,
      tpciByte,
    });

    const tpci = new TPCI(tpciByte);
    const apdu = new APDU(
      new TPCI(tpciByte),
      new APCI(APCIEnum.A_DataSecure_Protocol_Data_Unit),
      built.secureAsdu,
      false,
    );
    const tpdu = new TPDU(tpci, apdu, built.secureAsdu);
    const reqCemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
      null,
      new ControlField(cf1Byte),
      new ExtendedControlField(cf2Byte),
      params.sourceAddress,
      destinationAddress,
      tpdu,
    );

    let directListener: ((cemi: CEMIInstance) => void) | null = null;
    let connectedAckListener: ((cemi: CEMIInstance) => void) | null = null;
    let waiter: PendingSyncWaiter | null = null;

    const cleanup = () => {
      if (waiter) {
        this.pendingSyncWaiters.delete(waiter);
        waiter = null;
      }
      if (directListener) {
        service.removeListener("indication", directListener);
        directListener = null;
      }
      if (connectedAckListener) {
        service.removeListener("indication", connectedAckListener);
        connectedAckListener = null;
      }
    };

    try {
      const resPromise = new Promise<{ remoteAddress: string; seqNrRemote: bigint; seqNrLocal: bigint }>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup();
            reject(
              new Error(`S-A_Sync timeout (${params.timeoutMs} ms) waiting for S-A_Sync_Res from ${targetAddress}`),
            );
          }, params.timeoutMs);

          waiter = {
            targetAddress: isBroadcast ? undefined : targetAddress,
            commMode: params.commMode,
            toolAccess: params.toolAccess,
            key: params.key,
            challenge: built.challenge,
            resolve: (res) => {
              clearTimeout(timer);
              cleanup();
              resolve(res);
            },
          };
          this.pendingSyncWaiters.add(waiter);

          if (params.needsDirectListener) {
            directListener = (indCemi: CEMIInstance) => {
              if (
                isLDataCemi(indCemi) &&
                !indCemi.TPDU.tpci.dataControlFlag &&
                indCemi.TPDU.apdu.apci.value === APCI_DATA_SECURE
              ) {
                const hdr = parseSecureAsduHeader(indCemi.TPDU.apdu.data);
                if (hdr.valid && hdr.service === SecureAlService.S_A_SYNC_RES) {
                  this.handleIncomingSyncRes(indCemi);
                }
              }
            };
            service.on("indication", directListener);
          }

          if (isConnectedStandalone) {
            // Send T_ACK for incoming T_Data_Connected S-A_Sync_Res
            connectedAckListener = (indCemi: CEMIInstance) => {
              if (!isLDataCemi(indCemi)) return;
              if (indCemi.sourceAddress !== targetAddress) return;
              if (indCemi.controlField2.addressType !== AddressType.INDIVIDUAL) return;
              if (!indCemi.TPDU.tpci.dataControlFlag && indCemi.TPDU.tpci.numberedFlag) {
                const ackSeq = indCemi.TPDU.tpci.sequenceNumber;
                const ackTpci = new TPCI(((TPCIType.T_ACK_PDU & 0xc3) | ((ackSeq & 0x0f) << 2)) as TPCIType);
                const ackApdu = new APDU(ackTpci, new APCI(0), Buffer.alloc(0), false);
                const ackCemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
                  null,
                  new ControlField(0xb0),
                  new ExtendedControlField(0x60),
                  params.sourceAddress,
                  targetAddress,
                  new TPDU(ackTpci, ackApdu, Buffer.alloc(0)),
                );
                void service.send(ackCemi).catch(() => {});
              }
            };
            service.on("indication", connectedAckListener);
          }
        },
      );

      if (isConnectedStandalone) {
        const connTpci = new TPCI(TPCIType.T_CONNECT_PDU);
        const connCemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
          null,
          new ControlField(0xb0),
          new ExtendedControlField(0x60),
          params.sourceAddress,
          targetAddress,
          new TPDU(connTpci, new APDU(connTpci, new APCI(0), Buffer.alloc(0), false), Buffer.alloc(0)),
        );
        await service.send(connCemi);
      }

      await service.send(reqCemi);
      return await resPromise;
    } finally {
      cleanup();
      if (isConnectedStandalone) {
        const discTpci = new TPCI(TPCIType.T_DISCONNECT_PDU);
        const discCemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
          null,
          new ControlField(0xb0),
          new ExtendedControlField(0x60),
          params.sourceAddress,
          targetAddress,
          new TPDU(discTpci, new APDU(discTpci, new APCI(0), Buffer.alloc(0), false), Buffer.alloc(0)),
        );
        await service.send(discCemi).catch(() => {});
      }
    }
  }

  private handleIncomingSyncRes(cemi: LDataCemi): void {
    const isGroupAddr = cemi.controlField2.addressType === AddressType.GROUP;
    // 03_03_07 §5.3.2 Error handling: ignore S-A_Sync on T_Data_Group (non-broadcast group address)
    if (isGroupAddr && cemi.destinationAddress !== "0/0/0") return;

    const isExtendedFrame = !cemi.controlField1.frameType;
    const tpciByte = cemi.TPDU.tpci.getValue();

    for (const waiter of Array.from(this.pendingSyncWaiters)) {
      if (waiter.targetAddress && cemi.sourceAddress !== waiter.targetAddress) continue;
      const dec = decryptSASyncResPdu({
        key: waiter.key,
        challenge: waiter.challenge,
        secureAsdu: cemi.TPDU.apdu.data,
        sourceAddress: cemi.sourceAddress,
        destinationAddress: cemi.destinationAddress,
        addressType: cemi.controlField2.addressType,
        isExtendedFrame,
        eff: cemi.controlField2.eff,
        tpciByte,
      });
      if (dec.ok && dec.seqNrRemote !== undefined && dec.seqNrLocal !== undefined) {
        this.emit("sync_response", {
          sourceAddress: cemi.sourceAddress,
          seqNrRemote: dec.seqNrRemote,
          seqNrLocal: dec.seqNrLocal,
          scf: dec.scf,
        });
        waiter.resolve({
          remoteAddress: cemi.sourceAddress,
          seqNrRemote: dec.seqNrRemote,
          seqNrLocal: dec.seqNrLocal,
        });
        return;
      }
    }
  }

  /**
   * Handles an incoming `S-A_Sync_Req-PDU` per 03_03_07 §5.3.2 (steps 1–4):
   * - Enforces 1-second rate limit between responses
   * - Validates KNX Serial Number
   * - Verifies security using `ownToolKey` (when `T=1`) or `p2pKeys.get(src)` (when `T=0`)
   * - Updates stored `LastValidSeqNr` and sends `S-A_Sync_Res-PDU` (without incrementing `sequenceNumberSending`)
   */
  private handleIncomingSyncReq(cemi: LDataCemi, service?: KNXService): void {
    const isGroupAddr = cemi.controlField2.addressType === AddressType.GROUP;
    const isBroadcast = isGroupAddr && cemi.destinationAddress === "0/0/0";
    // 03_03_07 §5.3.2: S-A_Sync_Req is forbidden on T_Data_Group (non-broadcast)
    if (isGroupAddr && !isBroadcast) return;

    const header = parseSecureAsduHeader(cemi.TPDU.apdu.data);
    if (!header.valid || header.service !== SecureAlService.S_A_SYNC_REQ) return;

    // Step 1: 1-second rate limit (03_03_07 §5.3.2)
    const now = Date.now();
    if (now - this.lastSyncResponseTimestampMs < 1000) {
      return;
    }

    // Step 2: KNX Serial Number evaluation
    const snIsZero = header.serialNumber.every((b) => b === 0);
    if (isBroadcast && snIsZero) {
      return; // Broadcast/SystemBroadcast MUST carry a non-zero serial number
    }
    if (!snIsZero && this.ownSerialNumber && !header.serialNumber.equals(this.ownSerialNumber)) {
      return; // Addressed to another device; ignore without logging
    }

    // Step 3: Key selection & MAC verification
    const key = header.scf.toolAccess ? this.ownToolKey : this.p2pKeys.get(cemi.sourceAddress);
    if (!key) return;

    const isExtendedFrame = !cemi.controlField1.frameType;
    const tpciByte = cemi.TPDU.tpci.getValue();
    const dec = decryptSASyncReqPdu({
      key,
      secureAsdu: cemi.TPDU.apdu.data,
      sourceAddress: cemi.sourceAddress,
      destinationAddress: cemi.destinationAddress,
      addressType: cemi.controlField2.addressType,
      isExtendedFrame,
      eff: cemi.controlField2.eff,
      tpciByte,
    });

    if (!dec.ok || !dec.challenge || dec.seqNrLocal === undefined) {
      return;
    }

    this.emit("sync_request", {
      sourceAddress: cemi.sourceAddress,
      seqNrLocal: dec.seqNrLocal,
      serialNumber: dec.serialNumber,
      scf: header.scf,
    });

    if (!this.options.respondToSyncRequests || !service) return;

    // Step 4: Update stored SeqNrlocal if received (SeqNrlocal - 1) > stored
    const storedLast = header.scf.toolAccess
      ? this._toolAccessLastValidSeq
      : (this.lastValidSeqByIA.get(cemi.sourceAddress) ?? 0n);

    let updatedStored = storedLast;
    if (dec.seqNrLocal > 0n && dec.seqNrLocal - 1n > storedLast) {
      updatedStored = dec.seqNrLocal - 1n;
      if (header.scf.toolAccess) {
        this._toolAccessLastValidSeq = updatedStored;
      } else {
        this.lastValidSeqByIA.set(cemi.sourceAddress, updatedStored);
      }
      this.persistStateIfConfigured();
    }

    const replySeqNrLocal = updatedStored + 1n;
    const replySeqNrRemote = this._sequenceNumberSending;
    const ownIA = this._sourceAddress ?? service.individualAddress;
    const replyDest = isBroadcast ? "0/0/0" : cemi.sourceAddress;
    const replyAddrType = isBroadcast ? AddressType.GROUP : AddressType.INDIVIDUAL;
    const replyCf1 = new ControlField((cemi.controlField1.buffer[0] & 0x7f) | 0x20); // Extended Frame (FT=0)
    const replyCf2 = new ExtendedControlField(isBroadcast ? 0xe0 : 0x60);

    const builtRes = buildSASyncResPdu({
      key,
      challenge: dec.challenge,
      seqNrRemote: replySeqNrRemote,
      seqNrLocal: replySeqNrLocal,
      toolAccess: header.scf.toolAccess,
      systemBroadcast: header.scf.systemBroadcast,
      sourceAddress: ownIA,
      destinationAddress: replyDest,
      addressType: replyAddrType,
      isExtendedFrame: true,
      eff: replyCf2.eff,
      tpciByte: tpciByte & 0xfc,
    });

    const resTpci = new TPCI((tpciByte & 0xfc) as TPCIType);
    const resApdu = new APDU(
      new TPCI((tpciByte & 0xfc) as TPCIType),
      new APCI(APCIEnum.A_DataSecure_Protocol_Data_Unit),
      builtRes.secureAsdu,
      false,
    );
    const resCemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
      null,
      replyCf1,
      replyCf2,
      ownIA,
      replyDest,
      new TPDU(resTpci, resApdu, builtRes.secureAsdu),
    );

    this.lastSyncResponseTimestampMs = now;
    // NOTE 44: Transmitting S-A_Sync_Res shall NOT alter sequenceNumberSending
    void service.send(resCemi).catch(() => {});
  }

  private emitFailure(reason: DataSecureFailureReason, cemi: CEMIInstance, seqNr?: bigint): void {
    const evt: DataSecureFailureEvent = {
      reason,
      sourceAddress: isLDataCemi(cemi) ? cemi.sourceAddress : "",
      destinationAddress: isLDataCemi(cemi) ? cemi.destinationAddress : "",
      seqNr,
      cemi,
    };
    this.emit("security_failure", evt);
  }
}
