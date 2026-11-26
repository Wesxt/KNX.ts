import { EventEmitter } from "node:events";
import { KNXService } from "../connection/KNXService";
import { GroupAddressCache } from "../core/cache/GroupAddressCache";
import { CEMIInstance } from "../core/CEMI";
import { KnxDataDecode } from "../core/data/KNXDataDecode";
import { APCIEnum } from "../core/enum/APCIEnum";
import { MESSAGE_CODE_FIELD } from "../core/MessageCodeField";
import { KnxDataSecure } from "../security/KnxDataSecure";
import { parseKey16 } from "../security/KnxSecureKeys";
import type { KnxProject } from "./KnxProject";
import { formatGroupAddressByStyle, parseGroupAddressToInt } from "./KnxProjectXmlSerializer";
import type { KnxSpace } from "./types";

// ============================================================================
// Public Runtime Types (100% JSON-Serializable for REST/WebSocket/SCADA)
// ============================================================================

export type KnxRuntimeTelegramKind = "write" | "response" | "read";

export interface KnxRuntimeDeviceRef {
  deviceId: string;
  individualAddress?: string;
  name: string;
  description?: string;
  productName?: string;
  spacePath?: string;
}

export interface KnxRuntimeGroupAddressMeta {
  id: string;
  shortId: string;
  /** 16-bit numeric group address (`0..65535`). */
  address: number;
  /** Canonical 3-level string (e.g. `"1/0/1"`). */
  address3Level: string;
  /** Project-style formatted string (ThreeLevel, TwoLevel, or Free). */
  addressFormatted: string;
  name: string;
  description?: string;
  comment?: string;
  rangePath: string;
  spacePath?: string;
  functionName?: string;
  /** Raw ETS datapoint string (e.g. `"DPST-1-1"` or `"DPT-9"`). */
  rawDatapointType?: string;
  /** Normalized `KNX.ts` DPT identifier (e.g. `"1.001"`, `"9.001"`, `"9"`). */
  dpt?: string;
  dptName?: string;
  security?: string;
  linkedDevices: KnxRuntimeDeviceRef[];
}

export interface KnxRuntimeTelegramEvent {
  kind: KnxRuntimeTelegramKind;
  timestamp: string;
  /** Canonical 3-level Group Address (e.g. `"1/0/1"`). */
  groupAddress: string;
  /** Project-formatted Group Address. */
  groupAddressFormatted: string;
  /** 16-bit numeric Group Address. */
  groupAddressInt: number;
  sourceAddress: string;
  /** True if this Group Address exists in the `.knxproj` project. */
  knownInProject: boolean;
  /** Normalized DPT used for decoding (e.g. `"1.001"`, `"9.001"`). */
  dpt?: string;
  /** Decoded typed value (boolean, number, string, object, etc.) for `write` and `response` telegrams. */
  value?: unknown;
  /** Raw APDU payload in uppercase hex. */
  rawHex: string;
  /** Raw APDU payload length in bytes. */
  rawByteLength: number;
  /** Populated if DPT decoding failed or was unsupported (event is still emitted with `rawHex`). */
  decodeError?: string;
  /** Project metadata for this Group Address (if known). */
  meta?: KnxRuntimeGroupAddressMeta;
  /** Project metadata for the source KNX device (if source IA exists in the project). */
  sourceDevice?: KnxRuntimeDeviceRef;
}

export interface KnxRuntimeGaState {
  groupAddress: string;
  groupAddressFormatted: string;
  name?: string;
  dpt?: string;
  value?: unknown;
  rawHex?: string;
  lastKind?: KnxRuntimeTelegramKind;
  lastSourceAddress?: string;
  lastSourceDevice?: KnxRuntimeDeviceRef;
  updatedAt?: string;
  meta?: KnxRuntimeGroupAddressMeta;
}

export interface KnxProjectRuntimeSnapshot {
  projectName: string;
  installationId: string;
  capturedAt: string;
  totalGroupAddresses: number;
  populatedGroupAddresses: number;
  values: Record<string, KnxRuntimeGaState>;
}

export interface KnxProjectRuntimeOptions {
  /** Target installation ID inside the `.knxproj` (defaults to the first installation). */
  installationId?: string;
  /** Also register GA DPTs and forward incoming group telegrams to the global `GroupAddressCache` singleton. Default: `false`. */
  syncGlobalCache?: boolean;
  /** Load project Group Keys into `service.dataSecure` when present. Default: `true`. */
  loadProjectGroupKeys?: boolean;
  /** Automatically instantiate `KnxDataSecure` on `service` if the project defines Group Keys and `service.dataSecure` is null. Default: `false`. */
  autoEnableDataSecure?: boolean;
  /** Default timeout (ms) when awaiting a `GroupValue_Response` in `read()`. Default: `3000`. */
  readTimeoutMs?: number;
  /** Emit events for Group Addresses not defined in the `.knxproj` (with `knownInProject: false`). Default: `true`. */
  emitUnknownGroupAddresses?: boolean;
  /** Maximum per-GA history entries retained in memory (`0` = disabled, default: `0`). */
  maxHistoryPerGa?: number;
  /** Also process `L_Data.con` frames (confirmations of own transmissions) in addition to `L_Data.ind`. Default: `false`. */
  includeConfirmations?: boolean;
}

export interface KnxRuntimeReadOptions {
  /** Wait for and return the decoded `GroupValue_Response` telegram (default: `true`). */
  waitForResponse?: boolean;
  /** Response timeout in milliseconds (defaults to runtime `readTimeoutMs`). */
  timeoutMs?: number;
  /** Also resolve a pending `read()` if a `GroupValue_Write` arrives on the same GA. Default: `false`. */
  acceptWrite?: boolean;
}

// ============================================================================
// DPT Normalization Helper
// ============================================================================

/**
 * Converts ETS XML Datapoint Type identifiers into `KNX.ts` dot notation accepted by
 * `KnxDataDecode.decodeThis()` and `KnxDataEncoder.encodeThis()`:
 * - `"DPST-1-1"` -> `"1.001"`
 * - `"DPST-5-1"` -> `"5.001"`
 * - `"DPST-9-1"` -> `"9.001"`
 * - `"DPST-232-600"` -> `"232.600"`
 * - `"DPT-9"` -> `"9"`
 * - `"1.001"` -> `"1.001"`
 * - `"9"` -> `"9"`
 */
export function normalizeEtsDatapointType(raw?: string): string | undefined {
  if (!raw) return undefined;
  const firstToken = raw.trim().split(/\s+/)[0];
  if (!firstToken) return undefined;

  const dpstMatch = /^DPST-(\d+)-(\d+)$/i.exec(firstToken);
  if (dpstMatch) {
    const main = parseInt(dpstMatch[1], 10);
    const sub = parseInt(dpstMatch[2], 10);
    return `${main}.${String(sub).padStart(3, "0")}`;
  }

  const dptMatch = /^DPT-(\d+)$/i.exec(firstToken);
  if (dptMatch) {
    return String(parseInt(dptMatch[1], 10));
  }

  const dotMatch = /^(\d+)\.(\d+)$/.exec(firstToken);
  if (dotMatch) {
    const main = parseInt(dotMatch[1], 10);
    const sub = parseInt(dotMatch[2], 10);
    return `${main}.${String(sub).padStart(3, "0")}`;
  }

  if (/^\d+$/.test(firstToken)) {
    return String(parseInt(firstToken, 10));
  }

  return undefined;
}

function decodePayloadSafe(dpt: string | undefined, rawData: Buffer): { value?: unknown; decodeError?: string } {
  if (!dpt) return {};
  try {
    return { value: KnxDataDecode.decodeThis(dpt, rawData) };
  } catch (err: any) {
    // Fallback to main DPT if sub-DPT isn't explicitly registered
    const dotIdx = dpt.indexOf(".");
    if (dotIdx !== -1) {
      const mainDpt = dpt.slice(0, dotIdx);
      try {
        return { value: KnxDataDecode.decodeThis(mainDpt, rawData) };
      } catch {
        // return original error below
      }
    }
    return { decodeError: err?.message ?? String(err) };
  }
}

interface PendingReadWaiter {
  acceptWrite: boolean;
  resolve: (ev: KnxRuntimeTelegramEvent) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// ============================================================================
// KnxProjectRuntime
// ============================================================================

/**
 * Typed `.knxproj`-driven KNX Bus Runtime & Group Monitor.
 *
 * Bridges a loaded `KnxProject` with any `KNXService` (`KNXTunneling`, `Router`, `KNXUSBConnection`, `TPUART`, `KNXnetIPServer`):
 * - Automatically decodes incoming `GroupValue_Write` and `GroupValue_Response` telegrams using each Group Address's ETS DPT.
 * - Enriches every event with Group Address name, GroupRange path, Space/Location path, Function name, and Source Device identity.
 * - Provides typed `write()`, `respond()`, and promise-based `read()` by Group Address (`"1/0/1"`), numeric address, GA ID, or unique GA name.
 * - Maintains an up-to-date live state store (`getValue()` / `getSnapshot()`) ready for SCADA, dashboards, and REST/WebSocket APIs.
 *
 * Events emitted:
 * - `"telegram"` `(event: KnxRuntimeTelegramEvent)` — every group telegram (`write`, `response`, `read`)
 * - `"write"` `(event: KnxRuntimeTelegramEvent)` — `GroupValue_Write`
 * - `"response"` `(event: KnxRuntimeTelegramEvent)` — `GroupValue_Response`
 * - `"read"` `(event: KnxRuntimeTelegramEvent)` — `GroupValue_Read`
 * - `"ga:<3-level-addr>"` `(event: KnxRuntimeTelegramEvent)` — per-Group-Address stream (e.g. `"ga:1/0/1"`)
 */
export class KnxProjectRuntime extends EventEmitter {
  public readonly project: KnxProject;
  public readonly service: KNXService;
  public readonly installationId: string;

  private readonly syncGlobalCache: boolean;
  private readonly loadProjectGroupKeys: boolean;
  private readonly autoEnableDataSecure: boolean;
  private readonly readTimeoutMs: number;
  private readonly emitUnknownGroupAddresses: boolean;
  private readonly maxHistoryPerGa: number;
  private readonly includeConfirmations: boolean;

  private readonly gaBy3Level = new Map<string, KnxRuntimeGroupAddressMeta>();
  private readonly gaByFormatted = new Map<string, KnxRuntimeGroupAddressMeta>();
  private readonly gaByInt = new Map<number, KnxRuntimeGroupAddressMeta>();
  private readonly gaById = new Map<string, KnxRuntimeGroupAddressMeta>();
  private readonly gaByName = new Map<string, KnxRuntimeGroupAddressMeta | "ambiguous">();
  private readonly deviceByIa = new Map<string, KnxRuntimeDeviceRef>();

  private readonly liveStates = new Map<string, KnxRuntimeGaState>();
  private readonly historyByGa = new Map<string, KnxRuntimeTelegramEvent[]>();
  private readonly pendingReads = new Map<string, Set<PendingReadWaiter>>();
  private destroyed = false;

  private readonly boundOnIndication: (cemi: CEMIInstance) => void;

  constructor(project: KnxProject, service: KNXService, options: KnxProjectRuntimeOptions = {}) {
    super();
    this.project = project;
    this.service = service;

    const inst = project.getInstallation(options.installationId);
    if (!inst) {
      throw new Error(`Installation "${options.installationId ?? "0"}" not found in project`);
    }
    this.installationId = inst.installationId;
    this.syncGlobalCache = options.syncGlobalCache ?? false;
    this.loadProjectGroupKeys = options.loadProjectGroupKeys ?? true;
    this.autoEnableDataSecure = options.autoEnableDataSecure ?? false;
    this.readTimeoutMs = options.readTimeoutMs ?? 3000;
    this.emitUnknownGroupAddresses = options.emitUnknownGroupAddresses ?? true;
    this.maxHistoryPerGa = Math.max(0, Math.trunc(options.maxHistoryPerGa ?? 0));
    this.includeConfirmations = options.includeConfirmations ?? false;

    this.refreshProject();

    this.boundOnIndication = (cemi: CEMIInstance) => this.handleIncomingCemi(cemi);
    this.service.on("indication", this.boundOnIndication);
  }

  /**
   * Re-indexes all Group Addresses, DPTs, Spaces/Functions, Devices, and (optionally) Group Keys
   * from the underlying `KnxProject`. Call after mutating the project at runtime.
   */
  public refreshProject(): void {
    this.gaBy3Level.clear();
    this.gaByFormatted.clear();
    this.gaByInt.clear();
    this.gaById.clear();
    this.gaByName.clear();
    this.deviceByIa.clear();

    // 1. Index Devices by Individual Address
    const devices = this.project.getDevices({ installationId: this.installationId });
    const deviceRefById = new Map<string, KnxRuntimeDeviceRef>();
    for (const d of devices) {
      const ref: KnxRuntimeDeviceRef = {
        deviceId: d.id,
        individualAddress: d.individualAddress,
        name: d.name || d.description || d.productName || d.id,
        description: d.description || undefined,
        productName: d.productName,
        spacePath: d.locationPath,
      };
      deviceRefById.set(d.id, ref);
      if (d.individualAddress) {
        this.deviceByIa.set(d.individualAddress, ref);
      }
    }

    // 2. Index Spaces/Functions -> GroupAddressRefId for spacePath & functionName enrichment
    const gaLocationMap = new Map<string, { spacePath: string; functionName: string }>();
    const walkSpaces = (spaces: KnxSpace[], trail: string[]) => {
      for (const sp of spaces) {
        const nextTrail = [...trail, sp.name || sp.id];
        const pathStr = nextTrail.join(" / ");
        for (const fn of sp.functions) {
          for (const gRef of fn.groupAddressRefs) {
            if (!gaLocationMap.has(gRef.refId)) {
              gaLocationMap.set(gRef.refId, { spacePath: pathStr, functionName: fn.name });
            }
          }
        }
        walkSpaces(sp.spaces, nextTrail);
      }
    };
    walkSpaces(this.project.getLocations(this.installationId), []);

    // 3. Build single-pass Communication Matrix to get linked devices + fallback DPTs from ComObjects
    const matrix = this.project.getCommunicationMatrix({ installationId: this.installationId });
    const globalCache = this.syncGlobalCache ? GroupAddressCache.getInstance() : null;
    const projectGroupKeys: Record<string, Buffer> = {};

    for (const entry of matrix) {
      const ga = entry.groupAddress;
      const linkedDevs: KnxRuntimeDeviceRef[] = [];
      const seenDevIds = new Set<string>();
      let fallbackRawDpt: string | undefined;

      for (const lk of entry.links) {
        if (!fallbackRawDpt && lk.datapointType) {
          fallbackRawDpt = lk.datapointType;
        }
        if (!seenDevIds.has(lk.deviceId)) {
          seenDevIds.add(lk.deviceId);
          linkedDevs.push(
            deviceRefById.get(lk.deviceId) ?? {
              deviceId: lk.deviceId,
              individualAddress: lk.individualAddress,
              name: lk.deviceName || lk.deviceDescription || lk.deviceId,
              description: lk.deviceDescription || undefined,
              productName: lk.productName,
            },
          );
        }
      }

      const rawDpt = ga.datapointType ?? fallbackRawDpt;
      const dpt = normalizeEtsDatapointType(rawDpt);
      const locInfo = gaLocationMap.get(ga.id) ?? gaLocationMap.get(ga.shortId);

      const meta: KnxRuntimeGroupAddressMeta = {
        id: ga.id,
        shortId: ga.shortId,
        address: ga.address,
        address3Level: ga.address3Level,
        addressFormatted: ga.addressFormatted,
        name: ga.name,
        description: ga.description,
        comment: ga.comment,
        rangePath: ga.rangePath,
        spacePath: locInfo?.spacePath,
        functionName: locInfo?.functionName,
        rawDatapointType: rawDpt,
        dpt,
        dptName: ga.dpt?.name,
        security: ga.security,
        linkedDevices: linkedDevs,
      };

      this.gaBy3Level.set(ga.address3Level, meta);
      this.gaByFormatted.set(ga.addressFormatted, meta);
      this.gaByInt.set(ga.address, meta);
      this.gaById.set(ga.id, meta);
      this.gaById.set(ga.shortId, meta);

      const nameKey = ga.name.trim().toLowerCase();
      if (nameKey) {
        if (this.gaByName.has(nameKey)) {
          this.gaByName.set(nameKey, "ambiguous");
        } else {
          this.gaByName.set(nameKey, meta);
        }
      }

      if (globalCache && dpt) {
        globalCache.setAddressDPT(ga.address3Level, dpt);
      }

      if (ga.key) {
        try {
          projectGroupKeys[ga.address3Level] = parseKey16(ga.key, `GA ${ga.address3Level} key`);
        } catch {
          // ignore malformed key
        }
      }

      // Refresh metadata on existing live state entry if present
      const existingState = this.liveStates.get(ga.address3Level);
      if (existingState) {
        existingState.name = meta.name;
        existingState.dpt = meta.dpt;
        existingState.groupAddressFormatted = meta.addressFormatted;
        existingState.meta = meta;
      }
    }

    // 4. Load project Group Keys into KNXService.dataSecure if requested
    if (this.loadProjectGroupKeys && Object.keys(projectGroupKeys).length > 0) {
      let ds = this.service.dataSecure;
      if (!ds && this.autoEnableDataSecure) {
        ds = new KnxDataSecure({ groupKeys: projectGroupKeys });
        this.service.setDataSecure(ds);
      } else if (ds) {
        for (const [gaAddr, keyBuf] of Object.entries(projectGroupKeys)) {
          ds.setGroupKey(gaAddr, keyBuf);
        }
      }
    }
  }

  /**
   * Resolves any target identifier (3-level GA `"1/0/1"`, 2-level GA, numeric integer, ETS GA ID, or unique GA name)
   * into its canonical 3-level Group Address and optional project metadata.
   */
  private resolveTarget(target: string | number): {
    address3Level: string;
    addressInt: number;
    meta?: KnxRuntimeGroupAddressMeta;
  } {
    if (typeof target === "number") {
      const meta = this.gaByInt.get(target);
      const address3Level = meta?.address3Level ?? formatGroupAddressByStyle(target, "ThreeLevel");
      return { address3Level, addressInt: target & 0xffff, meta };
    }

    const trimmed = target.trim();
    const direct = this.gaBy3Level.get(trimmed) ?? this.gaByFormatted.get(trimmed) ?? this.gaById.get(trimmed);
    if (direct) {
      return { address3Level: direct.address3Level, addressInt: direct.address, meta: direct };
    }

    const byName = this.gaByName.get(trimmed.toLowerCase());
    if (byName === "ambiguous") {
      throw new Error(
        `Group Address name "${target}" is ambiguous in project "${this.project.getProjectInfo().name}"; use the Group Address (e.g. "1/0/1") or GA ID instead`,
      );
    }
    if (byName) {
      return { address3Level: byName.address3Level, addressInt: byName.address, meta: byName };
    }

    // Fall back to parsing raw Group Address string ("1/0/1", "1/1", or integer string)
    const addrInt = parseGroupAddressToInt(trimmed);
    const meta = this.gaByInt.get(addrInt);
    const address3Level = meta?.address3Level ?? formatGroupAddressByStyle(addrInt, "ThreeLevel");
    return { address3Level, addressInt: addrInt, meta };
  }

  /**
   * Sends a typed `GroupValue_Write` telegram using the DPT configured in the `.knxproj` (or `dptOverride`).
   */
  public async write(
    target: string | number,
    value: unknown,
    dptOverride?: string,
  ): Promise<{ groupAddress: string; dpt: string | null }> {
    this.ensureActive();
    const resolved = this.resolveTarget(target);
    const dpt = (dptOverride ? (normalizeEtsDatapointType(dptOverride) ?? dptOverride) : resolved.meta?.dpt) ?? null;
    await this.service.write(resolved.address3Level, (dpt ?? undefined) as any, value as any);
    return { groupAddress: resolved.address3Level, dpt };
  }

  /**
   * Sends a typed `GroupValue_Response` telegram using the DPT configured in the `.knxproj` (or `dptOverride`).
   */
  public async respond(
    target: string | number,
    value: unknown,
    dptOverride?: string,
  ): Promise<{ groupAddress: string; dpt: string | null }> {
    this.ensureActive();
    const resolved = this.resolveTarget(target);
    const dpt = (dptOverride ? (normalizeEtsDatapointType(dptOverride) ?? dptOverride) : resolved.meta?.dpt) ?? null;
    await this.service.respond(resolved.address3Level, (dpt ?? undefined) as any, value as any);
    return { groupAddress: resolved.address3Level, dpt };
  }

  /**
   * Sends a `GroupValue_Read` telegram and (by default, `waitForResponse: true`) awaits and returns
   * the decoded, project-enriched `GroupValue_Response` event.
   */
  public async read(
    target: string | number,
    options: KnxRuntimeReadOptions = {},
  ): Promise<KnxRuntimeTelegramEvent | void> {
    this.ensureActive();
    const resolved = this.resolveTarget(target);
    const waitForResponse = options.waitForResponse ?? true;
    const timeoutMs = options.timeoutMs ?? this.readTimeoutMs;
    const acceptWrite = options.acceptWrite ?? false;

    if (!waitForResponse) {
      await this.service.read(resolved.address3Level);
      return;
    }

    return new Promise<KnxRuntimeTelegramEvent>((resolve, reject) => {
      const waiter: PendingReadWaiter = {
        acceptWrite,
        resolve: (ev) => {
          clearTimeout(waiter.timer);
          this.removeWaiter(resolved.address3Level, waiter);
          resolve(ev);
        },
        reject: (err) => {
          clearTimeout(waiter.timer);
          this.removeWaiter(resolved.address3Level, waiter);
          reject(err);
        },
        timer: setTimeout(() => {
          this.removeWaiter(resolved.address3Level, waiter);
          reject(new Error(`Timed out waiting for GroupValue_Response on ${resolved.address3Level} (${timeoutMs} ms)`));
        }, timeoutMs),
      };

      let set = this.pendingReads.get(resolved.address3Level);
      if (!set) {
        set = new Set();
        this.pendingReads.set(resolved.address3Level, set);
      }
      set.add(waiter);

      this.service.read(resolved.address3Level).catch((err) => {
        waiter.reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /**
   * Returns the latest live decoded state for a Group Address (or `undefined` if no telegram has been seen yet).
   */
  public getValue(target: string | number): KnxRuntimeGaState | undefined {
    try {
      const resolved = this.resolveTarget(target);
      const state = this.liveStates.get(resolved.address3Level);
      return state ? { ...state } : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Returns project metadata for a Group Address (by address, integer, ID, or unique name).
   */
  public getGroupAddressMeta(target: string | number): KnxRuntimeGroupAddressMeta | undefined {
    try {
      const resolved = this.resolveTarget(target);
      return resolved.meta ? { ...resolved.meta, linkedDevices: [...resolved.meta.linkedDevices] } : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Lists all indexed Group Addresses from the project installation.
   */
  public listGroupAddresses(): KnxRuntimeGroupAddressMeta[] {
    return Array.from(this.gaBy3Level.values()).map((m) => ({
      ...m,
      linkedDevices: [...m.linkedDevices],
    }));
  }

  /**
   * Returns the bounded telegram history for a Group Address (requires `maxHistoryPerGa > 0`).
   */
  public getHistory(target: string | number): KnxRuntimeTelegramEvent[] {
    try {
      const resolved = this.resolveTarget(target);
      return [...(this.historyByGa.get(resolved.address3Level) ?? [])];
    } catch {
      return [];
    }
  }

  /**
   * Returns a 100% JSON-serializable snapshot of all project Group Addresses and their current live bus values.
   */
  public getSnapshot(options: { onlyPopulated?: boolean } = {}): KnxProjectRuntimeSnapshot {
    const values: Record<string, KnxRuntimeGaState> = {};
    let populated = 0;

    for (const [ga3, meta] of this.gaBy3Level.entries()) {
      const live = this.liveStates.get(ga3);
      if (live) {
        populated++;
        values[ga3] = { ...live };
      } else if (!options.onlyPopulated) {
        values[ga3] = {
          groupAddress: ga3,
          groupAddressFormatted: meta.addressFormatted,
          name: meta.name,
          dpt: meta.dpt,
          meta,
        };
      }
    }

    // Also include unknown GAs that were observed on the bus
    for (const [ga3, live] of this.liveStates.entries()) {
      if (!this.gaBy3Level.has(ga3)) {
        populated++;
        values[ga3] = { ...live };
      }
    }

    return {
      projectName: this.project.getProjectInfo().name,
      installationId: this.installationId,
      capturedAt: new Date().toISOString(),
      totalGroupAddresses: this.gaBy3Level.size,
      populatedGroupAddresses: populated,
      values,
    };
  }

  /**
   * Detaches all listeners from the underlying `KNXService` and cancels any pending `read()` timers.
   */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.service.removeListener("indication", this.boundOnIndication);
    for (const waiters of this.pendingReads.values()) {
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.reject(new Error("KnxProjectRuntime was destroyed while awaiting GroupValue_Response"));
      }
    }
    this.pendingReads.clear();
    this.removeAllListeners();
  }

  private ensureActive(): void {
    if (this.destroyed) {
      throw new Error("KnxProjectRuntime has been destroyed");
    }
  }

  private removeWaiter(ga3: string, waiter: PendingReadWaiter): void {
    const set = this.pendingReads.get(ga3);
    if (!set) return;
    set.delete(waiter);
    if (set.size === 0) this.pendingReads.delete(ga3);
  }

  private handleIncomingCemi(cemi: CEMIInstance): void {
    if (this.destroyed) return;
    const anyCemi = cemi as any;
    const msgCode = anyCemi.messageCode;
    const isInd = msgCode === MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value;
    const isCon = msgCode === MESSAGE_CODE_FIELD["L_Data.con"].CEMI.value;
    if (!isInd && !(this.includeConfirmations && isCon)) return;

    const dest: string | undefined = anyCemi.destinationAddress;
    if (!dest || !dest.includes("/")) return;

    const tpdu = anyCemi.TPDU ?? anyCemi.tpdu;
    const apdu = tpdu?.apdu;
    const apciVal: number | undefined = apdu?.apci?.value;

    let kind: KnxRuntimeTelegramKind;
    if (apciVal === APCIEnum.A_GroupValue_Write_Protocol_Data_Unit) {
      kind = "write";
    } else if (apciVal === APCIEnum.A_GroupValue_Response_Protocol_Data_Unit) {
      kind = "response";
    } else if (apciVal === APCIEnum.A_GroupValue_Read_Protocol_Data_Unit) {
      kind = "read";
    } else {
      return;
    }

    let addrInt: number;
    let ga3Level: string;
    try {
      addrInt = parseGroupAddressToInt(dest);
      ga3Level = formatGroupAddressByStyle(addrInt, "ThreeLevel");
    } catch {
      return;
    }

    const meta = this.gaByInt.get(addrInt);
    if (!meta && !this.emitUnknownGroupAddresses) return;

    if (this.syncGlobalCache) {
      try {
        GroupAddressCache.getInstance().processCEMI(cemi);
      } catch {
        // never let cache sync disrupt runtime events
      }
    }

    const rawData: Buffer = Buffer.isBuffer(apdu?.data)
      ? Buffer.from(apdu.data)
      : Buffer.isBuffer(tpdu?.data)
        ? Buffer.from(tpdu.data)
        : Buffer.alloc(0);

    const decoded = kind === "read" ? {} : decodePayloadSafe(meta?.dpt, rawData);
    const sourceAddress: string = anyCemi.sourceAddress ?? "0.0.0";
    const sourceDevice = this.deviceByIa.get(sourceAddress);
    const timestamp = new Date().toISOString();

    const event: KnxRuntimeTelegramEvent = {
      kind,
      timestamp,
      groupAddress: ga3Level,
      groupAddressFormatted:
        meta?.addressFormatted ?? formatGroupAddressByStyle(addrInt, this.project.getProjectInfo().groupAddressStyle),
      groupAddressInt: addrInt,
      sourceAddress,
      knownInProject: Boolean(meta),
      dpt: meta?.dpt,
      value: decoded.value,
      rawHex: rawData.toString("hex").toUpperCase(),
      rawByteLength: rawData.length,
      decodeError: decoded.decodeError,
      meta,
      sourceDevice,
    };

    if (kind === "write" || kind === "response") {
      this.liveStates.set(ga3Level, {
        groupAddress: ga3Level,
        groupAddressFormatted: event.groupAddressFormatted,
        name: meta?.name,
        dpt: meta?.dpt,
        value: event.value,
        rawHex: event.rawHex,
        lastKind: kind,
        lastSourceAddress: sourceAddress,
        lastSourceDevice: sourceDevice,
        updatedAt: timestamp,
        meta,
      });
    }

    if (this.maxHistoryPerGa > 0) {
      let hist = this.historyByGa.get(ga3Level);
      if (!hist) {
        hist = [];
        this.historyByGa.set(ga3Level, hist);
      }
      hist.push(event);
      if (hist.length > this.maxHistoryPerGa) {
        hist.splice(0, hist.length - this.maxHistoryPerGa);
      }
    }

    // Resolve any pending read() waiters
    const waiters = this.pendingReads.get(ga3Level);
    if (waiters && (kind === "response" || kind === "write")) {
      for (const w of Array.from(waiters)) {
        if (kind === "response" || w.acceptWrite) {
          w.resolve(event);
        }
      }
    }

    this.emit("telegram", event);
    this.emit(kind, event);
    this.emit(`ga:${ga3Level}`, event);
  }
}
