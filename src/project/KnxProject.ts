import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { KNXService } from "../connection/KNXService";
import { KNX_MANUFACTURERS } from "../core/resources/KNXManufacturers";
import type { KNXManagement } from "../management/KNXManagement";
import { DeviceConfigSession } from "../programming/DeviceConfigSession";
import { matchesWhenTest } from "../programming/DynamicEvaluator";
import type { KNXDeviceProgrammer } from "../programming/KNXDeviceProgrammer";
import {
  guessMimeTypeFromFilename,
  isCouplerMaskVersion,
  KnxProdParser,
  parseApplicationProgramStream,
  parseHardwareXml,
  parseKnxMasterMaskVersions,
} from "../programming/KnxProdParser";
import type {
  DeviceApplicationConfig,
  FlagSetting,
  GroupObjectLinkSpec,
  GroupObjectPriority,
  KnxApplicationProgram,
  KnxExtractedBaggage,
  KnxMaskVersion,
  KnxProdBaggageEntry,
  ParsedKnxProd,
} from "../programming/types";
import { deriveEts6ZipPassword, ZipReader } from "../programming/ZipReader";
import { ZipEntryEncryptionOptions, ZipWriter } from "../programming/ZipWriter";
import { KnxKeyring } from "../security/KnxKeyring";
import { parseKey16 } from "../security/KnxSecureKeys";
import {
  compareProjectDeviceWithBus,
  ComputeAuthorizedSendersOptions,
  ComputedAuthorizedSendersResult,
  computeProjectDeviceAuthorizedSenders,
  KnxBatchProgramOptions,
  KnxBatchProgramResult,
  KnxDeviceBusComparisonOptions,
  KnxDeviceBusComparisonResult,
  KnxProjectProgramDeviceOptions,
  KnxProjectProgramDeviceResult,
  programProjectAll,
  programProjectDevice,
  RecordDeviceCommissioningPatch,
} from "./KnxProjectCommissioning";
import { KnxProjectRuntime, KnxProjectRuntimeOptions } from "./KnxProjectRuntime";
import {
  decodeKnxSerialNumberHex,
  encodeKnxSerialNumberBase64,
  parseInstallationXml,
  parseKnxMasterData,
  parseManufacturerNumericId,
  parseProjectBaggagesXml,
  parseProjectCatalogXml,
  parseProjectCertificate,
  parseProjectHardwareXml,
  parseProjectXml,
} from "./KnxProjectXmlParser";
import {
  buildDefaultMasterData,
  formatGroupAddressByStyle,
  GroupAddressCsvExportOptions,
  mergeManufacturerContainerXml,
  parseGroupAddressToInt,
  serializeGroupAddressesCsv,
  serializeGroupAddressesExportXml,
  serializeInstallationXml,
  serializeMinimalKnxMasterXml,
  serializeProjectXml,
} from "./KnxProjectXmlSerializer";
import {
  ExternalKnxProdInput,
  ImportKnxProdOptions,
  ImportKnxProdResult,
  KnxAdditionalAddress,
  KnxArea,
  KnxBaggageContent,
  KnxBaggageFile,
  KnxBusInterface,
  KnxComObjectInstanceRef,
  KnxCommunicationMatrixEntry,
  KnxCouplerFilterTable,
  KnxDeviceDetails,
  KnxDeviceInstance,
  KnxDeviceIpConfig,
  KnxDeviceSecurity,
  KnxDeviceSummary,
  KnxExternalCatalogProvider,
  KnxFilterTableEntry,
  KnxFilterTableReason,
  KnxFunction,
  KnxGroupAddress,
  KnxGroupAddressLinkEntry,
  KnxGroupAddressRef,
  KnxGroupAddressView,
  KnxGroupObjectTree,
  KnxGroupObjectTreeNode,
  KnxGroupRange,
  KnxInstallation,
  KnxLine,
  KnxManufacturerCatalog,
  KnxMasterData,
  KnxProjectArchiveMetadata,
  KnxProjectCreateOptions,
  KnxProjectExportOptions,
  KnxProjectFilterTables,
  KnxProjectHardware2Program,
  KnxProjectHardwareEntry,
  KnxProjectHardwareProduct,
  KnxProjectHistoryEntry,
  KnxProjectInfo,
  KnxProjectParseOptions,
  KnxProjectSearchResult,
  KnxProjectSnapshotOptions,
  KnxProjectStats,
  KnxProjectSummary,
  KnxProjectUserFile,
  KnxProjectValidationIssue,
  KnxProjectValidationResult,
  KnxResolvedComObjectInstance,
  KnxResolvedParameterInstance,
  KnxSegment,
  KnxSpace,
  KnxSpaceType,
  KnxTrade,
  ResolvedDatapointTypeInfo,
  SerializedKnxProject,
} from "./types";

type ExtraArchiveSource = { kind: "buffer"; buffer: Buffer } | { kind: "zip"; reader: ZipReader; sourceName: string };

interface DeviceLocationRecord {
  device: KnxDeviceInstance;
  installation: KnxInstallation;
  area?: KnxArea;
  line?: KnxLine;
  segment?: KnxSegment;
  unassigned: boolean;
}

interface GroupAddressRecord {
  ga: KnxGroupAddress;
  installation: KnxInstallation;
  parentRange: KnxGroupRange;
  rangePathIds: string[];
  rangePathNames: string[];
}

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function randomProjectId(): string {
  const hex = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `P-${hex}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripInstallationPrefix(projectId: string, installationId: string, fullId: string): string {
  const prefix = `${projectId}-${installationId}_`;
  return fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId;
}

function extractMaxNumericSuffix(ids: Iterable<string>, token: string): number {
  const re = new RegExp(`(?:^|_)${token}-(\\d+)$`);
  let max = 0;
  for (const id of ids) {
    const m = re.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

function resolveMasterXmlInput(input: string | Buffer): { text: string; buffer: Buffer } {
  if (Buffer.isBuffer(input)) {
    const text = input.toString("utf8");
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, buffer: input };
  }
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("<") && !trimmed.startsWith("\uFEFF<") && fs.existsSync(input)) {
    const buf = fs.readFileSync(input);
    const text = buf.toString("utf8");
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, buffer: buf };
  }
  return { text: input.charCodeAt(0) === 0xfeff ? input.slice(1) : input, buffer: Buffer.from(input, "utf8") };
}

function tryReadInnerProjectZip(
  innerZipBuf: Buffer,
  password?: string,
): { reader: ZipReader; effectivePassword?: string } {
  const reader = ZipReader.fromBuffer(innerZipBuf);
  const entries = reader.listEntries().filter((e) => !e.isDirectory);
  const firstEncrypted = entries.find((e) => e.isEncrypted);
  if (!firstEncrypted) {
    return { reader };
  }
  if (!password) {
    throw new Error("This .knxproj archive is password-protected; provide { password } to open it.");
  }

  // Try raw password first (ETS5 ZipCrypto or plain WinZip AES), then ETS6 PBKDF2-derived base64 password
  const candidates =
    firstEncrypted.compressionMethod === 99
      ? [deriveEts6ZipPassword(password), password]
      : [password, deriveEts6ZipPassword(password)];

  let lastErr: Error | undefined;
  for (const cand of candidates) {
    try {
      reader.readEntryBuffer(firstEncrypted.fileName, cand);
      return { reader, effectivePassword: cand };
    } catch (err: any) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(`Failed to decrypt password-protected .knxproj: ${lastErr?.message ?? "invalid password"}`);
}

/**
 * Full-featured, zero-dependency, 100% JSON-serializable KNX Project (`.knxproj`) API.
 *
 * Capabilities:
 * - **Read**: Opens ETS4 / ETS5 / ETS6 `.knxproj` archives (including password-protected `P-XXXX.zip` archives)
 *   in milliseconds via lazy catalog loading, exposing ProjectInfo, MasterData, Topology (Areas/Lines/Segments),
 *   Devices, Parameters, ComObjects & Group Links, Locations (Spaces & Functions), GroupRanges & GroupAddresses,
 *   Trades, embedded Manufacturer Catalogs, and Baggage assets.
 * - **Create & Modify**: Full programmatic CRUD over every entity with automatic PUID/ID allocation,
 *   referential cleanup, `.knxprod` catalog importing, and live `DeviceConfigSession` bridging for ETS-grade
 *   dynamic parameterization & System B bus programming.
 * - **Export**: Lossless, ultra-fast `.knxproj` archive export (using zero-recompression raw passthrough for
 *   untouched manufacturer XMLs), plus ETS Group Address XML (`ga-export/01`), ETS CSV, `.knxkeys` Keyring,
 *   and portable JSON snapshots.
 */
export class KnxProject {
  private metadata: KnxProjectArchiveMetadata;
  private projectInfo: KnxProjectInfo;
  private historyEntries: KnxProjectHistoryEntry[];
  private userFiles: KnxProjectUserFile[];
  private projectRawExtraChildren: string[];
  private masterData: KnxMasterData;
  private catalogs: Map<string, KnxManufacturerCatalog>;
  private installations: KnxInstallation[];

  private sourceZip: ZipReader | null = null;
  private extraArchiveEntries = new Map<string, ExtraArchiveSource>();
  private removedArchiveEntries = new Set<string>();
  private applicationCache = new Map<string, KnxApplicationProgram>();
  private maskVersionsCache: Map<string, KnxMaskVersion> | null = null;
  private externalCatalogProvider: KnxExternalCatalogProvider | null = null;

  // Fast catalog lookup caches rebuilt on catalog changes
  private productIndex = new Map<
    string,
    { manufacturerId: string; hardware: KnxProjectHardwareEntry; product: KnxProjectHardwareProduct }
  >();
  private h2pIndex = new Map<
    string,
    { manufacturerId: string; hardware: KnxProjectHardwareEntry; h2p: KnxProjectHardware2Program }
  >();

  private constructor(init: {
    metadata: KnxProjectArchiveMetadata;
    projectInfo: KnxProjectInfo;
    historyEntries: KnxProjectHistoryEntry[];
    userFiles: KnxProjectUserFile[];
    projectRawExtraChildren: string[];
    masterData: KnxMasterData;
    catalogs: Map<string, KnxManufacturerCatalog>;
    installations: KnxInstallation[];
    sourceZip?: ZipReader | null;
  }) {
    this.metadata = init.metadata;
    this.projectInfo = init.projectInfo;
    this.historyEntries = init.historyEntries;
    this.userFiles = init.userFiles;
    this.projectRawExtraChildren = init.projectRawExtraChildren;
    this.masterData = init.masterData;
    this.catalogs = init.catalogs;
    this.installations = init.installations;
    this.sourceZip = init.sourceZip ?? null;
    this.rebuildCatalogIndexes();
  }

  // ============================================================================
  // Static Constructors: fromFile / fromBuffer / create / fromJSON
  // ============================================================================

  /**
   * Opens and parses an ETS `.knxproj` file from disk.
   */
  public static fromFile(filePath: string, options: KnxProjectParseOptions = {}): KnxProject {
    return this.fromBuffer(fs.readFileSync(filePath), options, path.basename(filePath));
  }

  /**
   * Opens and parses an ETS `.knxproj` archive from an in-memory `Buffer`.
   */
  public static fromBuffer(buffer: Buffer, options: KnxProjectParseOptions = {}, sourceName?: string): KnxProject {
    const outerZip = ZipReader.fromBuffer(buffer);
    const entries = outerZip.listEntries();

    // 1. Parse knx_master.xml if present
    const masterEntry = entries.find((e) => e.fileName.toLowerCase() === "knx_master.xml");
    const masterData = masterEntry
      ? parseKnxMasterData(outerZip.readEntryText(masterEntry.fileName), options.language)
      : buildDefaultMasterData(20);

    // 2. Locate project directory `P-XXXX/` OR encrypted inner `P-XXXX.zip`
    let projectId = "";
    let projectXmlText: string | null = null;
    const installationXmlFiles: { id: string; text: string }[] = [];
    let isPasswordProtected = false;
    let innerProjectZip: ZipReader | null = null;
    let innerProjectPassword: string | undefined;

    const projectXmlEntry = entries.find((e) => /^P-[^/]+\/project\.xml$/i.test(e.fileName));
    const innerZipEntry = !projectXmlEntry ? entries.find((e) => /^P-[^/]+\.zip$/i.test(e.fileName)) : undefined;

    if (projectXmlEntry) {
      projectId = projectXmlEntry.fileName.split("/")[0];
      projectXmlText = outerZip.readEntryText(projectXmlEntry.fileName);
      const instEntries = entries
        .filter((e) => {
          const m = new RegExp(`^${projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(\\d+)\\.xml$`, "i").exec(
            e.fileName,
          );
          return Boolean(m);
        })
        .sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));

      for (const ie of instEntries) {
        const instId = path.basename(ie.fileName, ".xml");
        installationXmlFiles.push({ id: instId, text: outerZip.readEntryText(ie.fileName) });
      }
    } else if (innerZipEntry) {
      projectId = path.basename(innerZipEntry.fileName, ".zip");
      const innerBuf = outerZip.readEntryBuffer(innerZipEntry.fileName);
      const unlocked = tryReadInnerProjectZip(innerBuf, options.password);
      innerProjectZip = unlocked.reader;
      innerProjectPassword = unlocked.effectivePassword;
      isPasswordProtected = innerProjectZip.listEntries().some((e) => e.isEncrypted);

      const innerEntries = innerProjectZip.listEntries();
      const innerProjXml = innerEntries.find((e) => /(^|\/)project\.xml$/i.test(e.fileName));
      if (!innerProjXml) {
        throw new Error(`Invalid password-protected .knxproj: missing project.xml inside "${innerZipEntry.fileName}"`);
      }
      projectXmlText = innerProjectZip.readEntryText(innerProjXml.fileName, innerProjectPassword);

      const innerInstEntries = innerEntries
        .filter((e) => /(^|\/)\d+\.xml$/i.test(e.fileName))
        .sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
      for (const ie of innerInstEntries) {
        const instId = path.basename(ie.fileName, ".xml");
        installationXmlFiles.push({
          id: instId,
          text: innerProjectZip.readEntryText(ie.fileName, innerProjectPassword),
        });
      }
    } else {
      throw new Error("Invalid .knxproj archive: could not find P-XXXX/project.xml or P-XXXX.zip");
    }

    // 3. Parse project.xml and installation XMLs (0.xml, 1.xml, ...)
    const parsedProj = parseProjectXml(projectXmlText, projectId);
    const installations: KnxInstallation[] = [];
    for (const file of installationXmlFiles) {
      const parsedInst = parseInstallationXml(file.text, file.id);
      installations.push(...parsedInst.installations);
    }
    if (installations.length === 0) {
      installations.push({
        installationId: "0",
        name: "",
        topology: { areas: [], unassignedDevices: [] },
        locations: [],
        groupRanges: [],
        trades: [],
      });
    }

    // 4. Parse project signature/certificate metadata
    const hasProjectSignature = outerZip.hasEntry(`${projectId}.signature`);
    const certEntry = outerZip.getEntry(`${projectId}.certificate`);
    const certificate = certEntry ? parseProjectCertificate(outerZip.readEntryText(certEntry.fileName)) : undefined;

    // 5. Parse manufacturer catalogs (Hardware.xml, Catalog.xml, Baggages.xml) & index ApplicationProgram XMLs lazily
    const catalogs = new Map<string, KnxManufacturerCatalog>();
    const ensureMfr = (mfrId: string): KnxManufacturerCatalog => {
      let cat = catalogs.get(mfrId);
      if (!cat) {
        const numericId = parseManufacturerNumericId(mfrId);
        const name = masterData.manufacturers[mfrId]?.name ?? KNX_MANUFACTURERS[numericId] ?? mfrId;
        cat = {
          manufacturerId: mfrId,
          numericId,
          name,
          hasSignature: outerZip.hasEntry(`${mfrId}.signature`),
          hardware: [],
          catalogSections: [],
          applicationFiles: {},
          baggages: [],
        };
        catalogs.set(mfrId, cat);
      }
      return cat;
    };

    for (const entry of entries) {
      const mfrMatch = /^(M-[0-9A-Fa-f]{4})\/(.+)$/.exec(entry.fileName);
      if (!mfrMatch || entry.isDirectory) continue;
      const mfrId = mfrMatch[1].toUpperCase();
      const rel = mfrMatch[2];
      const cat = ensureMfr(mfrId);

      if (/^Hardware\.xml$/i.test(rel)) {
        cat.hardware.push(...parseProjectHardwareXml(outerZip.readEntryText(entry.fileName), mfrId, options.language));
      } else if (/^Catalog\.xml$/i.test(rel)) {
        cat.catalogSections.push(...parseProjectCatalogXml(outerZip.readEntryText(entry.fileName), options.language));
      } else if (/^Baggages\.xml$/i.test(rel)) {
        cat.baggages.push(...parseProjectBaggagesXml(outerZip.readEntryText(entry.fileName), mfrId));
      } else {
        const appMatch = /^(M-[0-9A-Fa-f]{4}_A-[^/]+)\.xml$/i.exec(rel);
        if (appMatch) {
          cat.applicationFiles[appMatch[1]] = {
            zipEntryPath: entry.fileName,
            uncompressedSize: entry.uncompressedSize,
          };
        }
      }
    }

    const metadata: KnxProjectArchiveMetadata = {
      projectId: parsedProj.projectInfo.id,
      schemaVersion: parsedProj.schemaVersion,
      xmlns: parsedProj.xmlns,
      createdBy: parsedProj.createdBy,
      toolVersion: parsedProj.toolVersion,
      sourceFileName: sourceName,
      isPasswordProtected,
      hasProjectSignature,
      certificate,
      loadedLanguage: options.language,
      isModified: false,
    };

    const project = new KnxProject({
      metadata,
      projectInfo: parsedProj.projectInfo,
      historyEntries: parsedProj.historyEntries,
      userFiles: parsedProj.userFiles,
      projectRawExtraChildren: parsedProj.rawExtraChildren,
      masterData,
      catalogs,
      installations,
      sourceZip: outerZip,
    });

    // If unlocked from an inner password-protected P-XXXX.zip, preserve any extra non-XML user files from it
    if (innerProjectZip && innerZipEntry) {
      project.removedArchiveEntries.add(innerZipEntry.fileName);
      for (const ie of innerProjectZip.listEntries()) {
        if (ie.isDirectory) continue;
        if (/(^|\/)(project|\d+)\.xml$/i.test(ie.fileName)) continue;
        const rel = ie.fileName.startsWith(`${projectId}/`) ? ie.fileName : `${projectId}/${ie.fileName}`;
        project.extraArchiveEntries.set(rel, {
          kind: "buffer",
          buffer: innerProjectZip.readEntryBuffer(ie.fileName, innerProjectPassword),
        });
      }
    }

    return project;
  }

  /**
   * Creates a brand-new KNX project from scratch, ready to populate and export as `.knxproj`.
   */
  public static create(options: KnxProjectCreateOptions): KnxProject {
    const projectId = options.projectId?.trim() || randomProjectId();
    const schemaVersion = options.schemaVersion ?? 20;
    const now = nowIsoUtc();
    const resolvedMaster = options.masterXml ? resolveMasterXmlInput(options.masterXml) : null;
    const masterData = resolvedMaster ? parseKnxMasterData(resolvedMaster.text) : buildDefaultMasterData(schemaVersion);

    let lastPuid = 0;
    const nextPuid = () => ++lastPuid;

    const areas: KnxArea[] = [];
    let defaultLineId = "";
    if (options.createDefaultTopology !== false) {
      const a0Id = `${projectId}-0_A-1`;
      const l0Id = `${projectId}-0_L-1`;
      const a1Id = `${projectId}-0_A-2`;
      const l10Id = `${projectId}-0_L-2`;
      const l11Id = `${projectId}-0_L-3`;
      defaultLineId = l11Id;
      areas.push(
        {
          id: a0Id,
          address: 0,
          name: "Backbone area",
          puid: nextPuid(),
          lines: [
            {
              id: l0Id,
              address: 0,
              name: "Backbone line",
              mediumTypeRefId: "MT-5",
              puid: nextPuid(),
              devices: [],
              segments: [],
              additionalGroupAddresses: [],
            },
          ],
        },
        {
          id: a1Id,
          address: 1,
          name: "Area 1",
          puid: nextPuid(),
          lines: [
            {
              id: l10Id,
              address: 0,
              name: "Main line",
              mediumTypeRefId: "MT-5",
              puid: nextPuid(),
              devices: [],
              segments: [],
              additionalGroupAddresses: [],
            },
            {
              id: l11Id,
              address: 1,
              name: "Line 1.1",
              mediumTypeRefId: "MT-0",
              puid: nextPuid(),
              devices: [],
              segments: [],
              additionalGroupAddresses: [],
            },
          ],
        },
      );
    }

    const projectInfo: KnxProjectInfo = {
      id: projectId,
      name: options.name,
      groupAddressStyle: options.groupAddressStyle ?? "ThreeLevel",
      comment: options.comment ?? "",
      projectNumber: options.projectNumber,
      contractNumber: options.contractNumber,
      orderNumber: options.orderNumber,
      completionStatus: options.completionStatus ?? "Editing",
      projectStart: now,
      lastModified: now,
      guid: crypto.randomUUID(),
      lastUsedPuid: Math.max(1, lastPuid),
    };

    const metadata: KnxProjectArchiveMetadata = {
      projectId,
      schemaVersion,
      xmlns: `http://knx.org/xml/project/${schemaVersion}`,
      createdBy: options.createdBy ?? "KNX.ts",
      toolVersion: options.toolVersion ?? "2.3.1",
      isPasswordProtected: false,
      hasProjectSignature: false,
      isModified: true,
    };

    const project = new KnxProject({
      metadata,
      projectInfo,
      historyEntries: [],
      userFiles: [],
      projectRawExtraChildren: [],
      masterData,
      catalogs: new Map(),
      installations: [
        {
          installationId: "0",
          name: "",
          bcuKey: "4294967295",
          defaultLine: defaultLineId,
          ipRoutingLatencyTolerance: 2000,
          topology: { areas, unassignedDevices: [] },
          locations: [],
          groupRanges: [],
          trades: [],
        },
      ],
    });

    if (resolvedMaster) {
      project.extraArchiveEntries.set("knx_master.xml", {
        kind: "buffer",
        buffer: resolvedMaster.buffer,
      });
    }

    return project;
  }

  /**
   * Restores a `KnxProject` from a JSON snapshot previously created via `toJSON()` / `getSnapshot()`.
   */
  public static fromJSON(json: SerializedKnxProject | string): KnxProject {
    const parsed: SerializedKnxProject = typeof json === "string" ? JSON.parse(json) : json;
    if (!parsed || parsed.schemaVersion !== 1 || !parsed.projectInfo || !Array.isArray(parsed.installations)) {
      throw new Error("Invalid SerializedKnxProject: expected schemaVersion === 1 with projectInfo and installations");
    }
    const catalogs = new Map<string, KnxManufacturerCatalog>();
    if (parsed.catalogs) {
      for (const [k, v] of Object.entries(parsed.catalogs)) {
        catalogs.set(k, cloneJson(v));
      }
    }
    const installations = cloneJson(parsed.installations);
    // Normalize optional arrays for backwards-compatibility with older JSON snapshots
    const normalizeDev = (d: KnxDeviceInstance) => {
      if (!Array.isArray(d.busInterfaces)) d.busInterfaces = [];
      if (!Array.isArray(d.additionalAddresses)) d.additionalAddresses = [];
      if (!Array.isArray(d.moduleInstances)) d.moduleInstances = [];
      if (!Array.isArray(d.binaryData)) d.binaryData = [];
    };
    for (const inst of installations) {
      for (const area of inst.topology.areas) {
        for (const line of area.lines) {
          if (!Array.isArray(line.segments)) line.segments = [];
          if (!Array.isArray(line.additionalGroupAddresses)) line.additionalGroupAddresses = [];
          for (const d of line.devices) normalizeDev(d);
          for (const s of line.segments) for (const d of s.devices) normalizeDev(d);
        }
      }
      for (const d of inst.topology.unassignedDevices) normalizeDev(d);
    }
    return new KnxProject({
      metadata: { ...cloneJson(parsed.metadata), isModified: true },
      projectInfo: cloneJson(parsed.projectInfo),
      historyEntries: cloneJson(parsed.historyEntries ?? []),
      userFiles: cloneJson(parsed.userFiles ?? []),
      projectRawExtraChildren: [],
      masterData: parsed.masterData
        ? cloneJson(parsed.masterData)
        : buildDefaultMasterData(parsed.metadata?.schemaVersion ?? 20),
      catalogs,
      installations,
    });
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  private markModified(): void {
    this.metadata.isModified = true;
    this.projectInfo.lastModified = nowIsoUtc();
  }

  private allocatePuid(): number {
    this.projectInfo.lastUsedPuid = (this.projectInfo.lastUsedPuid ?? 0) + 1;
    return this.projectInfo.lastUsedPuid;
  }

  private rebuildCatalogIndexes(): void {
    this.productIndex.clear();
    this.h2pIndex.clear();
    for (const [mfrId, cat] of this.catalogs.entries()) {
      for (const hw of cat.hardware) {
        for (const prod of hw.products) {
          this.productIndex.set(prod.id, { manufacturerId: mfrId, hardware: hw, product: prod });
        }
        for (const h2p of hw.hardware2Programs) {
          this.h2pIndex.set(h2p.id, { manufacturerId: mfrId, hardware: hw, h2p });
        }
      }
    }
  }

  private getInst(installationId?: string): KnxInstallation {
    if (!installationId) return this.installations[0];
    const found = this.installations.find((i) => i.installationId === installationId);
    if (!found) throw new Error(`Installation "${installationId}" not found in project "${this.projectInfo.id}"`);
    return found;
  }

  private iterAllDevices(installationId?: string): DeviceLocationRecord[] {
    const out: DeviceLocationRecord[] = [];
    const insts = installationId ? [this.getInst(installationId)] : this.installations;
    for (const inst of insts) {
      for (const area of inst.topology.areas) {
        for (const line of area.lines) {
          for (const dev of line.devices) {
            out.push({ device: dev, installation: inst, area, line, unassigned: false });
          }
          for (const seg of line.segments) {
            for (const dev of seg.devices) {
              out.push({ device: dev, installation: inst, area, line, segment: seg, unassigned: false });
            }
          }
        }
      }
      for (const dev of inst.topology.unassignedDevices) {
        out.push({ device: dev, installation: inst, unassigned: true });
      }
    }
    return out;
  }

  private computeIndividualAddress(rec: DeviceLocationRecord): string | undefined {
    if (rec.unassigned || !rec.area || !rec.line || rec.device.address === undefined) return undefined;
    return `${rec.area.address}.${rec.line.address}.${rec.device.address}`;
  }

  private findDeviceRecord(idOrIa: string, installationId?: string): DeviceLocationRecord | undefined {
    const key = idOrIa.trim();
    const all = this.iterAllDevices(installationId);
    for (const rec of all) {
      if (rec.device.id === key) return rec;
      const ia = this.computeIndividualAddress(rec);
      if (ia && ia === key) return rec;
    }
    // Also allow short ID like "DI-168"
    for (const rec of all) {
      const shortId = stripInstallationPrefix(this.projectInfo.id, rec.installation.installationId, rec.device.id);
      if (shortId === key) return rec;
    }
    return undefined;
  }

  private requireDeviceRecord(idOrIa: string, installationId?: string): DeviceLocationRecord {
    const rec = this.findDeviceRecord(idOrIa, installationId);
    if (!rec) throw new Error(`Device "${idOrIa}" not found in project "${this.projectInfo.name}"`);
    return rec;
  }

  private iterAllGroupAddresses(installationId?: string): GroupAddressRecord[] {
    const out: GroupAddressRecord[] = [];
    const insts = installationId ? [this.getInst(installationId)] : this.installations;
    const walk = (inst: KnxInstallation, gr: KnxGroupRange, pathIds: string[], pathNames: string[]) => {
      const nextIds = [...pathIds, gr.id];
      const nextNames = [...pathNames, gr.name];
      for (const ga of gr.groupAddresses) {
        out.push({ ga, installation: inst, parentRange: gr, rangePathIds: nextIds, rangePathNames: nextNames });
      }
      for (const sub of gr.groupRanges) {
        walk(inst, sub, nextIds, nextNames);
      }
    };
    for (const inst of insts) {
      for (const gr of inst.groupRanges) {
        walk(inst, gr, [], []);
      }
    }
    return out;
  }

  private buildGaLookupMap(inst: KnxInstallation): Map<string, GroupAddressRecord> {
    const map = new Map<string, GroupAddressRecord>();
    for (const rec of this.iterAllGroupAddresses(inst.installationId)) {
      map.set(rec.ga.id, rec);
      const shortId = stripInstallationPrefix(this.projectInfo.id, inst.installationId, rec.ga.id);
      map.set(shortId, rec);
    }
    return map;
  }

  private findGroupAddressRecord(idOrAddr: string | number, installationId?: string): GroupAddressRecord | undefined {
    const all = this.iterAllGroupAddresses(installationId);
    if (typeof idOrAddr === "number") {
      return all.find((r) => r.ga.address === idOrAddr);
    }
    const key = idOrAddr.trim();
    // 1. Exact ID or short ID match
    for (const r of all) {
      if (r.ga.id === key) return r;
      if (stripInstallationPrefix(this.projectInfo.id, r.installation.installationId, r.ga.id) === key) return r;
    }
    // 2. Group Address numeric or slash notation match
    try {
      const addrInt = parseGroupAddressToInt(key);
      return all.find((r) => r.ga.address === addrInt);
    } catch {
      return undefined;
    }
  }

  private buildDeviceSpaceIndex(inst: KnxInstallation): {
    deviceToSpaceIds: Map<string, string[]>;
    deviceToPath: Map<string, string>;
  } {
    const deviceToSpaceIds = new Map<string, string[]>();
    const deviceToPath = new Map<string, string>();
    const walk = (sp: KnxSpace, trail: string[]) => {
      const nextTrail = [...trail, sp.name || sp.id];
      const pathStr = nextTrail.join(" / ");
      for (const refId of sp.deviceInstanceRefs) {
        let arr = deviceToSpaceIds.get(refId);
        if (!arr) {
          arr = [];
          deviceToSpaceIds.set(refId, arr);
        }
        arr.push(sp.id);
        if (!deviceToPath.has(refId)) deviceToPath.set(refId, pathStr);
      }
      for (const child of sp.spaces) {
        walk(child, nextTrail);
      }
    };
    for (const root of inst.locations) walk(root, []);
    return { deviceToSpaceIds, deviceToPath };
  }

  private buildDeviceTradeIndex(inst: KnxInstallation): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const walk = (tr: KnxTrade) => {
      for (const refId of tr.deviceInstanceRefs) {
        let arr = map.get(refId);
        if (!arr) {
          arr = [];
          map.set(refId, arr);
        }
        arr.push(tr.id);
      }
      for (const sub of tr.trades) walk(sub);
    };
    for (const root of inst.trades) walk(root);
    return map;
  }

  private findSpaceById(spaces: KnxSpace[], id: string): KnxSpace | undefined {
    for (const sp of spaces) {
      if (sp.id === id) return sp;
      const found = this.findSpaceById(sp.spaces, id);
      if (found) return found;
    }
    return undefined;
  }

  private findGroupRangeById(ranges: KnxGroupRange[], id: string): KnxGroupRange | undefined {
    for (const gr of ranges) {
      if (gr.id === id) return gr;
      const found = this.findGroupRangeById(gr.groupRanges, id);
      if (found) return found;
    }
    return undefined;
  }

  private findTradeById(trades: KnxTrade[], id: string): KnxTrade | undefined {
    for (const tr of trades) {
      if (tr.id === id) return tr;
      const found = this.findTradeById(tr.trades, id);
      if (found) return found;
    }
    return undefined;
  }

  private resolveLineTarget(
    lineIdOrCoords: string | { area: number; line: number },
    installationId?: string,
  ): { inst: KnxInstallation; area: KnxArea; line: KnxLine } {
    const inst = this.getInst(installationId);
    if (typeof lineIdOrCoords === "string") {
      const key = lineIdOrCoords.trim();
      for (const area of inst.topology.areas) {
        for (const line of area.lines) {
          if (
            line.id === key ||
            stripInstallationPrefix(this.projectInfo.id, inst.installationId, line.id) === key ||
            `${area.address}.${line.address}` === key
          ) {
            return { inst, area, line };
          }
        }
      }
      throw new Error(`Line "${lineIdOrCoords}" not found`);
    }
    const area = inst.topology.areas.find((a) => a.address === lineIdOrCoords.area);
    if (!area) throw new Error(`Area ${lineIdOrCoords.area} not found`);
    const line = area.lines.find((l) => l.address === lineIdOrCoords.line);
    if (!line) throw new Error(`Line ${lineIdOrCoords.area}.${lineIdOrCoords.line} not found`);
    return { inst, area, line };
  }

  private resolveApplicationIdForDevice(dev: KnxDeviceInstance): string | undefined {
    if (dev.hardware2ProgramRefId) {
      const hit = this.h2pIndex.get(dev.hardware2ProgramRefId);
      if (hit && hit.h2p.applicationProgramRefIds.length > 0) {
        return hit.h2p.applicationProgramRefIds[0];
      }
      // Fallback: derive from `_HP-XXXX-YY-ZZZZ` -> `M-mmmm_A-XXXX-YY-ZZZZ`
      const m = /^(M-[0-9A-Fa-f]{4})_.*_HP-([^_]+)$/.exec(dev.hardware2ProgramRefId);
      if (m) {
        const candidate = `${m[1]}_A-${m[2]}`;
        const cat = this.catalogs.get(m[1].toUpperCase());
        if (cat && cat.applicationFiles[candidate]) return candidate;
        return candidate;
      }
    }
    return undefined;
  }

  private summarizeDevice(
    rec: DeviceLocationRecord,
    spaceIdx: { deviceToSpaceIds: Map<string, string[]>; deviceToPath: Map<string, string> },
    tradeIdx: Map<string, string[]>,
  ): KnxDeviceSummary {
    const dev = rec.device;
    const prodHit = dev.productRefId ? this.productIndex.get(dev.productRefId) : undefined;
    const h2pHit = dev.hardware2ProgramRefId ? this.h2pIndex.get(dev.hardware2ProgramRefId) : undefined;
    const mfrId =
      prodHit?.manufacturerId ??
      h2pHit?.manufacturerId ??
      /^(M-[0-9A-Fa-f]{4})/.exec(dev.productRefId ?? dev.hardware2ProgramRefId ?? "")?.[1]?.toUpperCase();
    const mfrName = mfrId
      ? (this.catalogs.get(mfrId)?.name ??
        this.masterData.manufacturers[mfrId]?.name ??
        KNX_MANUFACTURERS[parseManufacturerNumericId(mfrId)] ??
        mfrId)
      : undefined;

    const linkedComObjectCount = dev.comObjectInstanceRefs.filter((c) => c.links.length > 0).length;
    const hasSecurity = Boolean(
      dev.security &&
      (dev.security.deviceAuthenticationCode ||
        dev.security.deviceManagementPassword ||
        dev.security.toolKey ||
        dev.security.loadedToolKey ||
        dev.security.deviceAuthenticationCodeHash ||
        dev.security.deviceManagementPasswordHash),
    );

    return {
      id: dev.id,
      installationId: rec.installation.installationId,
      areaAddress: rec.area?.address,
      lineAddress: rec.line?.address,
      segmentNumber: rec.segment?.number,
      address: dev.address,
      individualAddress: this.computeIndividualAddress(rec),
      name: dev.name ?? "",
      description: dev.description ?? "",
      comment: dev.comment ?? "",
      productRefId: dev.productRefId,
      hardware2ProgramRefId: dev.hardware2ProgramRefId,
      applicationProgramRefId: this.resolveApplicationIdForDevice(dev),
      manufacturerId: mfrId,
      manufacturerName: mfrName,
      hardwareName: prodHit?.hardware.name ?? h2pHit?.hardware.name,
      productName: prodHit?.product.text,
      orderNumber: prodHit?.product.orderNumber,
      serialNumberHex: dev.serialNumberHex ?? decodeKnxSerialNumberHex(dev.serialNumber),
      locationPath: spaceIdx.deviceToPath.get(dev.id),
      spaceIds: spaceIdx.deviceToSpaceIds.get(dev.id) ?? [],
      tradeIds: tradeIdx.get(dev.id) ?? [],
      ipAddress: dev.ipConfig?.ipAddress,
      macAddress: dev.ipConfig?.macAddress,
      parameterCount: dev.parameterInstanceRefs.length,
      comObjectCount: dev.comObjectInstanceRefs.length,
      linkedComObjectCount,
      hasSecurity,
      isLoaded: {
        applicationProgram: dev.applicationProgramLoaded,
        communicationPart: dev.communicationPartLoaded,
        individualAddress: dev.individualAddressLoaded,
        mediumConfig: dev.mediumConfigLoaded,
        parameters: dev.parametersLoaded,
      },
      lastModified: dev.lastModified,
      lastDownload: dev.lastDownload,
    };
  }

  private readArchiveEntryInternal(entryPath: string): Buffer | undefined {
    const norm = entryPath.replace(/\\/g, "/");
    if (this.removedArchiveEntries.has(norm)) return undefined;
    const extra = this.extraArchiveEntries.get(norm);
    if (extra) {
      return extra.kind === "buffer" ? extra.buffer : extra.reader.readEntryBuffer(extra.sourceName);
    }
    if (this.sourceZip?.hasEntry(norm)) {
      return this.sourceZip.readEntryBuffer(norm);
    }
    return undefined;
  }

  private createArchiveEntryStreamInternal(entryPath: string): Readable {
    const norm = entryPath.replace(/\\/g, "/");
    const extra = this.extraArchiveEntries.get(norm);
    if (extra) {
      if (extra.kind === "buffer") return Readable.from([extra.buffer]);
      return extra.reader.createEntryStream(extra.sourceName);
    }
    if (this.sourceZip?.hasEntry(norm)) {
      return this.sourceZip.createEntryStream(norm);
    }
    throw new Error(`Embedded archive entry not found: "${entryPath}"`);
  }

  // ============================================================================
  // Read & Inspection API
  // ============================================================================

  public getMetadata(): KnxProjectArchiveMetadata {
    return { ...this.metadata, certificate: this.metadata.certificate ? { ...this.metadata.certificate } : undefined };
  }

  public getProjectInfo(): KnxProjectInfo {
    return cloneJson(this.projectInfo);
  }

  public getMasterData(): KnxMasterData {
    return cloneJson(this.masterData);
  }

  public getCatalogs(): KnxManufacturerCatalog[] {
    return Array.from(this.catalogs.values()).map((c) => cloneJson(c));
  }

  public getCatalog(manufacturerId: string): KnxManufacturerCatalog | undefined {
    const cat = this.catalogs.get(manufacturerId.toUpperCase());
    return cat ? cloneJson(cat) : undefined;
  }

  public getInstallations(): KnxInstallation[] {
    return cloneJson(this.installations);
  }

  public getInstallation(installationId?: string): KnxInstallation {
    return cloneJson(this.getInst(installationId));
  }

  /**
   * Resolves an ETS DatapointType string (`"DPST-1-1"`, `"DPT-9"`, `"1.001"`, `"9.001"`) to structured metadata.
   */
  public resolveDatapointType(rawOrFormatted: string): ResolvedDatapointTypeInfo {
    const trimmed = rawOrFormatted.trim();
    // Handle space-separated multi-DPT strings (ETS allows "DPST-1-1 DPST-1-2") by resolving the first primary entry
    const first = trimmed.split(/\s+/)[0] || trimmed;

    const directSub = this.masterData.datapointSubtypes[first];
    if (directSub) {
      return {
        raw: trimmed,
        main: directSub.dptNumber,
        sub: directSub.number,
        formatted: directSub.formatted,
        name: directSub.name,
        text: directSub.text,
        sizeInBit: directSub.sizeInBit,
      };
    }

    const directDpt = this.masterData.datapointTypes[first];
    if (directDpt) {
      return {
        raw: trimmed,
        main: directDpt.number,
        formatted: `${directDpt.number}.xxx`,
        name: directDpt.name,
        text: directDpt.text,
        sizeInBit: directDpt.sizeInBit,
      };
    }

    // Parse DPST-<main>-<sub> or DPT-<main> or <main>.<sub>
    const dpstMatch = /^DPST-(\d+)-(\d+)$/i.exec(first);
    if (dpstMatch) {
      const main = parseInt(dpstMatch[1], 10);
      const sub = parseInt(dpstMatch[2], 10);
      return { raw: trimmed, main, sub, formatted: `${main}.${String(sub).padStart(3, "0")}` };
    }
    const dptMatch = /^DPT-(\d+)$/i.exec(first);
    if (dptMatch) {
      const main = parseInt(dptMatch[1], 10);
      return { raw: trimmed, main, formatted: `${main}.xxx` };
    }
    const dotMatch = /^(\d+)\.(\d+)$/.exec(first);
    if (dotMatch) {
      const main = parseInt(dotMatch[1], 10);
      const sub = parseInt(dotMatch[2], 10);
      const id = `DPST-${main}-${sub}`;
      const hit = this.masterData.datapointSubtypes[id];
      if (hit) {
        return {
          raw: id,
          main,
          sub,
          formatted: hit.formatted,
          name: hit.name,
          text: hit.text,
          sizeInBit: hit.sizeInBit,
        };
      }
      return { raw: id, main, sub, formatted: `${main}.${String(sub).padStart(3, "0")}` };
    }

    return { raw: trimmed, formatted: trimmed };
  }

  public getStats(): KnxProjectStats {
    let areas = 0;
    let lines = 0;
    let segments = 0;
    let devices = 0;
    let assignedDevices = 0;
    let unassignedDevices = 0;
    let groupRanges = 0;
    let groupAddresses = 0;
    let comObjectInstances = 0;
    let totalLinks = 0;
    let parameterInstances = 0;
    let spaces = 0;
    let functions = 0;
    let trades = 0;

    const linkedGaKeys = new Set<string>();

    const countRanges = (list: KnxGroupRange[]) => {
      for (const gr of list) {
        groupRanges++;
        groupAddresses += gr.groupAddresses.length;
        countRanges(gr.groupRanges);
      }
    };
    const countSpaces = (list: KnxSpace[]) => {
      for (const sp of list) {
        spaces++;
        functions += sp.functions.length;
        countSpaces(sp.spaces);
      }
    };
    const countTrades = (list: KnxTrade[]) => {
      for (const tr of list) {
        trades++;
        countTrades(tr.trades);
      }
    };

    for (const inst of this.installations) {
      const gaMap = this.buildGaLookupMap(inst);
      areas += inst.topology.areas.length;
      for (const a of inst.topology.areas) {
        lines += a.lines.length;
        for (const l of a.lines) {
          segments += l.segments.length;
        }
      }
      countRanges(inst.groupRanges);
      countSpaces(inst.locations);
      countTrades(inst.trades);

      for (const rec of this.iterAllDevices(inst.installationId)) {
        devices++;
        if (this.computeIndividualAddress(rec)) assignedDevices++;
        else unassignedDevices++;
        parameterInstances += rec.device.parameterInstanceRefs.length;
        comObjectInstances += rec.device.comObjectInstanceRefs.length;
        for (const co of rec.device.comObjectInstanceRefs) {
          totalLinks += co.links.length;
          for (const lk of co.links) {
            const hit = gaMap.get(lk);
            if (hit) linkedGaKeys.add(`${inst.installationId}::${hit.ga.id}`);
          }
        }
      }
    }

    let embeddedCatalogProducts = 0;
    let embeddedApplicationFiles = 0;
    let embeddedBaggages = 0;
    for (const cat of this.catalogs.values()) {
      for (const hw of cat.hardware) embeddedCatalogProducts += hw.products.length;
      embeddedApplicationFiles += Object.keys(cat.applicationFiles).length;
      embeddedBaggages += cat.baggages.length;
    }

    return {
      installations: this.installations.length,
      areas,
      lines,
      segments,
      devices,
      assignedDevices,
      unassignedDevices,
      groupRanges,
      groupAddresses,
      linkedGroupAddresses: linkedGaKeys.size,
      unlinkedGroupAddresses: Math.max(0, groupAddresses - linkedGaKeys.size),
      comObjectInstances,
      totalLinks,
      parameterInstances,
      spaces,
      functions,
      trades,
      manufacturers: this.catalogs.size,
      embeddedCatalogProducts,
      embeddedApplicationFiles,
      embeddedBaggages,
    };
  }

  /**
   * Returns a compact, JSON-serializable overview suitable for dashboards and project lists in web apps.
   */
  public getSummary(): KnxProjectSummary {
    const deviceCountByMfr = new Map<string, number>();
    for (const rec of this.iterAllDevices()) {
      const mfr =
        (rec.device.productRefId ? this.productIndex.get(rec.device.productRefId)?.manufacturerId : undefined) ??
        /^(M-[0-9A-Fa-f]{4})/
          .exec(rec.device.productRefId ?? rec.device.hardware2ProgramRefId ?? "")?.[1]
          ?.toUpperCase();
      if (mfr) deviceCountByMfr.set(mfr, (deviceCountByMfr.get(mfr) ?? 0) + 1);
    }

    const manufacturers = Array.from(this.catalogs.values())
      .map((cat) => ({
        manufacturerId: cat.manufacturerId,
        name: cat.name,
        productCount: cat.hardware.reduce((s, h) => s + h.products.length, 0),
        applicationCount: Object.keys(cat.applicationFiles).length,
        deviceCount: deviceCountByMfr.get(cat.manufacturerId) ?? 0,
        hasSignature: cat.hasSignature,
      }))
      .sort((a, b) => b.deviceCount - a.deviceCount || a.manufacturerId.localeCompare(b.manufacturerId));

    return {
      metadata: this.getMetadata(),
      projectInfo: this.getProjectInfo(),
      stats: this.getStats(),
      manufacturers,
    };
  }

  /**
   * Returns a complete, 100% JSON-serializable snapshot of the project.
   * By default omits heavy base64 `loadedImage`/`checkSums` blobs and raw XML extras to keep web API payloads fast.
   */
  public getSnapshot(options: KnxProjectSnapshotOptions = {}): SerializedKnxProject {
    const installations = cloneJson(this.installations);
    if (!options.includeBinaryBlobs || !options.includeRawXml) {
      const cleanDev = (dev: KnxDeviceInstance) => {
        if (!options.includeBinaryBlobs) {
          delete dev.loadedImage;
          delete dev.checkSums;
          dev.binaryData = [];
        }
        if (!options.includeRawXml) {
          delete dev.rawExtraChildren;
        }
      };
      const cleanSpaces = (list: KnxSpace[]) => {
        for (const sp of list) {
          if (!options.includeRawXml) delete sp.rawExtraChildren;
          for (const fn of sp.functions) {
            if (!options.includeRawXml) delete fn.rawExtraChildren;
          }
          cleanSpaces(sp.spaces);
        }
      };
      const cleanTrades = (list: KnxTrade[]) => {
        for (const tr of list) {
          if (!options.includeRawXml) delete tr.rawExtraChildren;
          cleanTrades(tr.trades);
        }
      };

      for (const inst of installations) {
        if (!options.includeRawXml) {
          delete inst.rawExtraSections;
          delete inst.topology.rawExtraChildren;
        }
        for (const area of inst.topology.areas) {
          if (!options.includeRawXml) delete area.rawExtraChildren;
          for (const line of area.lines) {
            if (!options.includeRawXml) delete line.rawExtraChildren;
            for (const dev of line.devices) cleanDev(dev);
            for (const seg of line.segments) {
              if (!options.includeRawXml) delete seg.rawExtraChildren;
              for (const dev of seg.devices) cleanDev(dev);
            }
          }
        }
        for (const dev of inst.topology.unassignedDevices) cleanDev(dev);
        cleanSpaces(inst.locations);
        cleanTrades(inst.trades);
      }
    }

    const result: SerializedKnxProject = {
      schemaVersion: 1,
      metadata: this.getMetadata(),
      projectInfo: this.getProjectInfo(),
      historyEntries: cloneJson(this.historyEntries),
      userFiles: cloneJson(this.userFiles),
      installations,
      stats: this.getStats(),
    };
    if (options.includeMasterData) {
      result.masterData = this.getMasterData();
    }
    if (options.includeCatalogs) {
      result.catalogs = {};
      for (const [k, v] of this.catalogs.entries()) {
        result.catalogs[k] = cloneJson(v);
      }
    }
    return result;
  }

  public toJSON(options?: KnxProjectSnapshotOptions): SerializedKnxProject {
    return this.getSnapshot(options);
  }

  // ---- Topology queries ----

  public getAreas(installationId?: string): KnxArea[] {
    return cloneJson(this.getInst(installationId).topology.areas);
  }

  public getArea(idOrAddress: string | number, installationId?: string): KnxArea | undefined {
    const inst = this.getInst(installationId);
    const area =
      typeof idOrAddress === "number"
        ? inst.topology.areas.find((a) => a.address === idOrAddress)
        : inst.topology.areas.find(
            (a) =>
              a.id === idOrAddress ||
              stripInstallationPrefix(this.projectInfo.id, inst.installationId, a.id) === idOrAddress ||
              String(a.address) === idOrAddress,
          );
    return area ? cloneJson(area) : undefined;
  }

  public getLines(installationId?: string): {
    areaId: string;
    areaAddress: number;
    areaName: string;
    line: KnxLine;
    mediumTypeName: string;
    deviceCount: number;
  }[] {
    const inst = this.getInst(installationId);
    const out: {
      areaId: string;
      areaAddress: number;
      areaName: string;
      line: KnxLine;
      mediumTypeName: string;
      deviceCount: number;
    }[] = [];
    for (const area of inst.topology.areas) {
      for (const line of area.lines) {
        const segDevs = line.segments.reduce((s, seg) => s + seg.devices.length, 0);
        out.push({
          areaId: area.id,
          areaAddress: area.address,
          areaName: area.name,
          line: cloneJson(line),
          mediumTypeName: this.masterData.mediumTypes[line.mediumTypeRefId]?.name ?? line.mediumTypeRefId,
          deviceCount: line.devices.length + segDevs,
        });
      }
    }
    return out;
  }

  public getLine(idOrCoords: string | { area: number; line: number }, installationId?: string): KnxLine | undefined {
    try {
      return cloneJson(this.resolveLineTarget(idOrCoords, installationId).line);
    } catch {
      return undefined;
    }
  }

  // ---- Device queries ----

  public getDevices(
    filter: {
      installationId?: string;
      area?: number;
      line?: number;
      manufacturerId?: string;
      productRefId?: string;
      applicationProgramRefId?: string;
      spaceId?: string;
      tradeId?: string;
      hasAddress?: boolean;
      search?: string;
    } = {},
  ): KnxDeviceSummary[] {
    const insts = filter.installationId ? [this.getInst(filter.installationId)] : this.installations;
    const q = filter.search?.trim().toLowerCase();
    const mfrFilter = filter.manufacturerId?.toUpperCase();
    const results: KnxDeviceSummary[] = [];

    for (const inst of insts) {
      const spaceIdx = this.buildDeviceSpaceIndex(inst);
      const tradeIdx = this.buildDeviceTradeIndex(inst);

      for (const rec of this.iterAllDevices(inst.installationId)) {
        if (filter.area !== undefined && rec.area?.address !== filter.area) continue;
        if (filter.line !== undefined && rec.line?.address !== filter.line) continue;

        const summary = this.summarizeDevice(rec, spaceIdx, tradeIdx);

        if (mfrFilter && summary.manufacturerId !== mfrFilter) continue;
        if (filter.productRefId && summary.productRefId !== filter.productRefId) continue;
        if (filter.applicationProgramRefId && summary.applicationProgramRefId !== filter.applicationProgramRefId) {
          continue;
        }
        if (filter.spaceId && !summary.spaceIds.includes(filter.spaceId)) continue;
        if (filter.tradeId && !summary.tradeIds.includes(filter.tradeId)) continue;
        if (filter.hasAddress !== undefined && Boolean(summary.individualAddress) !== filter.hasAddress) continue;

        if (q) {
          const hay = [
            summary.id,
            summary.individualAddress,
            summary.name,
            summary.description,
            summary.comment,
            summary.productName,
            summary.hardwareName,
            summary.orderNumber,
            summary.manufacturerName,
            summary.serialNumberHex,
            summary.locationPath,
            summary.ipAddress,
            summary.macAddress,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) continue;
        }

        results.push(summary);
      }
    }

    return results;
  }

  public getDevice(idOrIndividualAddress: string, installationId?: string): KnxDeviceInstance | undefined {
    const rec = this.findDeviceRecord(idOrIndividualAddress, installationId);
    return rec ? cloneJson(rec.device) : undefined;
  }

  /**
   * Synchronously returns detailed resolved information about a device (resolved Group Addresses, DPTs,
   * location path, trades, IP/security config) without parsing the embedded `M-XXXX_A-*.xml`.
   */
  public getDeviceDetailsSync(idOrIndividualAddress: string, installationId?: string): KnxDeviceDetails {
    const rec = this.requireDeviceRecord(idOrIndividualAddress, installationId);
    const inst = rec.installation;
    const spaceIdx = this.buildDeviceSpaceIndex(inst);
    const tradeIdx = this.buildDeviceTradeIndex(inst);
    const gaMap = this.buildGaLookupMap(inst);
    const summary = this.summarizeDevice(rec, spaceIdx, tradeIdx);
    const dev = rec.device;
    const style = this.projectInfo.groupAddressStyle;

    const comObjects: KnxResolvedComObjectInstance[] = dev.comObjectInstanceRefs.map((co) => {
      const linkedGroupAddresses: KnxResolvedComObjectInstance["linkedGroupAddresses"] = [];
      const groupAddresses: string[] = [];

      co.links.forEach((lk, idx) => {
        const hit = gaMap.get(lk);
        if (hit) {
          const formatted = formatGroupAddressByStyle(hit.ga.address, style);
          groupAddresses.push(formatted);
          linkedGroupAddresses.push({
            id: hit.ga.id,
            shortId: stripInstallationPrefix(this.projectInfo.id, inst.installationId, hit.ga.id),
            address: hit.ga.address,
            addressFormatted: formatted,
            name: hit.ga.name,
            datapointType: hit.ga.datapointType,
            dpt: hit.ga.datapointType ? this.resolveDatapointType(hit.ga.datapointType) : undefined,
            isSending: idx === 0,
          });
        }
      });

      return {
        ...cloneJson(co),
        groupAddresses,
        linkedGroupAddresses,
        dpt: co.datapointType ? this.resolveDatapointType(co.datapointType) : undefined,
      };
    });

    const parameters: KnxResolvedParameterInstance[] = dev.parameterInstanceRefs.map((p) => cloneJson(p));

    const appId = summary.applicationProgramRefId;
    const mfrCat = summary.manufacturerId ? this.catalogs.get(summary.manufacturerId) : undefined;
    const hasEmbeddedApplicationXml = Boolean(appId && mfrCat?.applicationFiles[appId]);

    return {
      ...summary,
      serialNumber: dev.serialNumber,
      uniqueNumber: dev.uniqueNumber,
      completionStatus: dev.completionStatus,
      puid: dev.puid,
      lastUsedApduLength: dev.lastUsedApduLength,
      readMaxApduLength: dev.readMaxApduLength,
      readMaxRoutingApduLength: dev.readMaxRoutingApduLength,
      additionalAddresses: cloneJson(dev.additionalAddresses),
      ipConfig: dev.ipConfig ? cloneJson(dev.ipConfig) : undefined,
      security: dev.security ? cloneJson(dev.security) : undefined,
      busInterfaces: cloneJson(dev.busInterfaces),
      moduleInstances: cloneJson(dev.moduleInstances),
      groupObjectTree: dev.groupObjectTree ? cloneJson(dev.groupObjectTree) : undefined,
      comObjects,
      parameters,
      hasLoadedImage: Boolean(dev.loadedImage),
      hasCheckSums: Boolean(dev.checkSums),
      hasEmbeddedApplicationXml,
    };
  }

  /**
   * Returns complete details for a device, optionally enriching every ComObject and Parameter with
   * definitions & localized labels parsed lazily from either the embedded `M-XXXX_A-*.xml` catalog,
   * an explicit user-supplied `externalKnxProd`, or a registered `KnxExternalCatalogProvider`.
   */
  public async getDeviceDetails(
    idOrIndividualAddress: string,
    options: {
      resolveCatalog?: boolean;
      language?: string;
      installationId?: string;
      externalKnxProd?: ExternalKnxProdInput;
    } = {},
  ): Promise<KnxDeviceDetails> {
    const details = this.getDeviceDetailsSync(idOrIndividualAddress, options.installationId);
    if (!options.resolveCatalog || !details.applicationProgramRefId) {
      return details;
    }
    if (!details.hasEmbeddedApplicationXml && !options.externalKnxProd && !this.externalCatalogProvider) {
      return details;
    }

    const app = await this.loadApplicationProgram(details.applicationProgramRefId, {
      language: options.language ?? this.metadata.loadedLanguage,
      externalKnxProd: options.externalKnxProd,
      manufacturerId: details.manufacturerId,
      productRefId: details.productRefId,
    });
    const appPrefix = `${app.id}_`;

    const lookupComObjectRef = (rawRefId: string) => {
      const fullRefId = rawRefId.startsWith(appPrefix) ? rawRefId : `${appPrefix}${rawRefId}`;
      const directCor = app.comObjectRefs.get(fullRefId);
      if (directCor) return { cor: directCor, baseCo: app.comObjects.get(directCor.refId) };
      // Also resolve ModuleDef ComObjectRefs (e.g. "MD-1_M-15_MI-1_O-2-0_R-4" -> MD-1 -> M-..._MD-1_O-2-0_R-4)
      const modMatch = /(MD-\d+)_M-[^_]+_MI-\d+_(.+)$/.exec(rawRefId);
      if (modMatch) {
        const modDef = app.moduleDefs.get(`${appPrefix}${modMatch[1]}`);
        if (modDef) {
          const tplCor = modDef.comObjectRefs.get(`${modDef.id}_${modMatch[2]}`);
          if (tplCor) return { cor: tplCor, baseCo: modDef.comObjects.get(tplCor.refId) };
        }
      }
      return undefined;
    };

    const lookupParamRef = (rawRefId: string) => {
      const fullRefId = rawRefId.startsWith(appPrefix) ? rawRefId : `${appPrefix}${rawRefId}`;
      const directPr = app.parameterRefs.get(fullRefId);
      if (directPr) return { pr: directPr, baseParam: app.parameters.get(directPr.refId) };
      const modMatch = /(MD-\d+)_M-[^_]+_MI-\d+_(.+)$/.exec(rawRefId);
      if (modMatch) {
        const modDef = app.moduleDefs.get(`${appPrefix}${modMatch[1]}`);
        if (modDef) {
          const tplPr = modDef.parameterRefs.get(`${modDef.id}_${modMatch[2]}`);
          if (tplPr) return { pr: tplPr, baseParam: modDef.parameters.get(tplPr.refId) };
        }
      }
      return undefined;
    };

    for (const co of details.comObjects) {
      const hit = lookupComObjectRef(co.refId);
      if (hit?.cor && hit.baseCo) {
        const { cor, baseCo } = hit;
        const trCor = app.translations?.get(cor.id);
        const trCo = app.translations?.get(baseCo.id);
        co.catalogInfo = {
          comObjectId: baseCo.id,
          comObjectRefId: cor.id,
          number: baseCo.number,
          name: cor.name ?? baseCo.name,
          text: trCor?.Text ?? cor.text ?? trCo?.Text ?? baseCo.text,
          functionText: trCor?.FunctionText ?? cor.functionText ?? trCo?.FunctionText ?? baseCo.functionText,
          objectSize: cor.objectSize ?? baseCo.objectSize,
          datapointType: cor.datapointType ?? baseCo.datapointType,
        };
        if (!co.dpt && co.catalogInfo.datapointType) {
          co.dpt = this.resolveDatapointType(co.catalogInfo.datapointType);
        }
      }
    }

    for (const param of details.parameters) {
      const hit = lookupParamRef(param.refId);
      if (hit?.pr && hit.baseParam) {
        const { pr, baseParam } = hit;
        const pType = app.parameterTypes.get(baseParam.parameterTypeId);
        let enumText: string | undefined;
        if (pType?.detail.kind === "Restriction") {
          const ev = pType.detail.enumerations.find((e) => String(e.value) === param.value);
          if (ev) {
            enumText = app.translations?.get(ev.id)?.Text ?? ev.text;
          }
        }
        const trPr = app.translations?.get(pr.id);
        const trP = app.translations?.get(baseParam.id);
        param.catalogInfo = {
          parameterId: baseParam.id,
          name: pr.name ?? baseParam.name,
          text: trPr?.Text ?? pr.text ?? trP?.Text ?? baseParam.text,
          defaultValue: pr.value ?? baseParam.defaultValue,
          enumText,
          suffixText: trPr?.SuffixText ?? pr.suffixText ?? trP?.SuffixText ?? baseParam.suffixText,
        };
      }
    }

    return details;
  }

  // ---- Group Address & Communication Matrix queries ----

  public getGroupRanges(installationId?: string): KnxGroupRange[] {
    return cloneJson(this.getInst(installationId).groupRanges);
  }

  public getGroupAddresses(
    filter: {
      installationId?: string;
      rangeId?: string;
      mainGroup?: number;
      middleGroup?: number;
      datapointType?: string;
      linkedOnly?: boolean;
      unlinkedOnly?: boolean;
      search?: string;
    } = {},
  ): KnxGroupAddressView[] {
    const insts = filter.installationId ? [this.getInst(filter.installationId)] : this.installations;
    const style = this.projectInfo.groupAddressStyle;
    const q = filter.search?.trim().toLowerCase();
    const dptFilter = filter.datapointType?.trim().toLowerCase();
    const out: KnxGroupAddressView[] = [];

    for (const inst of insts) {
      const gaMap = this.buildGaLookupMap(inst);
      const linkDevCounts = new Map<string, Set<string>>();
      const linkCoCounts = new Map<string, number>();

      for (const devRec of this.iterAllDevices(inst.installationId)) {
        for (const co of devRec.device.comObjectInstanceRefs) {
          for (const lk of co.links) {
            const hit = gaMap.get(lk);
            if (!hit) continue;
            let set = linkDevCounts.get(hit.ga.id);
            if (!set) {
              set = new Set();
              linkDevCounts.set(hit.ga.id, set);
            }
            set.add(devRec.device.id);
            linkCoCounts.set(hit.ga.id, (linkCoCounts.get(hit.ga.id) ?? 0) + 1);
          }
        }
      }

      for (const rec of this.iterAllGroupAddresses(inst.installationId)) {
        if (filter.rangeId && !rec.rangePathIds.includes(filter.rangeId)) continue;
        const main = (rec.ga.address >> 11) & 0x1f;
        const middle = (rec.ga.address >> 8) & 0x07;
        if (filter.mainGroup !== undefined && main !== filter.mainGroup) continue;
        if (filter.middleGroup !== undefined && middle !== filter.middleGroup) continue;

        const linkedComObjectCount = linkCoCounts.get(rec.ga.id) ?? 0;
        if (filter.linkedOnly && linkedComObjectCount === 0) continue;
        if (filter.unlinkedOnly && linkedComObjectCount > 0) continue;

        const dpt = rec.ga.datapointType ? this.resolveDatapointType(rec.ga.datapointType) : undefined;
        if (dptFilter) {
          const matchesDpt =
            (rec.ga.datapointType && rec.ga.datapointType.toLowerCase().includes(dptFilter)) ||
            (dpt &&
              (dpt.formatted.toLowerCase().includes(dptFilter) || (dpt.name ?? "").toLowerCase().includes(dptFilter)));
          if (!matchesDpt) continue;
        }

        const addressFormatted = formatGroupAddressByStyle(rec.ga.address, style);
        const address3Level = formatGroupAddressByStyle(rec.ga.address, "ThreeLevel");
        const rangePath = rec.rangePathNames.join(" / ");

        if (q) {
          const hay = [
            rec.ga.id,
            addressFormatted,
            address3Level,
            String(rec.ga.address),
            rec.ga.name,
            rec.ga.description,
            rec.ga.comment,
            rec.ga.datapointType,
            dpt?.formatted,
            dpt?.name,
            rangePath,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) continue;
        }

        out.push({
          ...cloneJson(rec.ga),
          installationId: inst.installationId,
          shortId: stripInstallationPrefix(this.projectInfo.id, inst.installationId, rec.ga.id),
          addressFormatted,
          address3Level,
          rangePathIds: rec.rangePathIds,
          rangePath,
          dpt,
          linkedDeviceCount: linkDevCounts.get(rec.ga.id)?.size ?? 0,
          linkedComObjectCount,
        });
      }
    }

    return out;
  }

  public getGroupAddress(idOrAddress: string | number, installationId?: string): KnxGroupAddressView | undefined {
    const rec = this.findGroupAddressRecord(idOrAddress, installationId);
    if (!rec) return undefined;
    const links = this.getGroupAddressLinks(rec.ga.id, rec.installation.installationId);
    const uniqueDevices = new Set(links.map((l) => l.deviceId));
    return {
      ...cloneJson(rec.ga),
      installationId: rec.installation.installationId,
      shortId: stripInstallationPrefix(this.projectInfo.id, rec.installation.installationId, rec.ga.id),
      addressFormatted: formatGroupAddressByStyle(rec.ga.address, this.projectInfo.groupAddressStyle),
      address3Level: formatGroupAddressByStyle(rec.ga.address, "ThreeLevel"),
      rangePathIds: rec.rangePathIds,
      rangePath: rec.rangePathNames.join(" / "),
      dpt: rec.ga.datapointType ? this.resolveDatapointType(rec.ga.datapointType) : undefined,
      linkedDeviceCount: uniqueDevices.size,
      linkedComObjectCount: links.length,
    };
  }

  /**
   * Reverse lookup: returns every Device + ComObjectInstanceRef linked to a specific Group Address.
   */
  public getGroupAddressLinks(idOrAddress: string | number, installationId?: string): KnxGroupAddressLinkEntry[] {
    const rec = this.findGroupAddressRecord(idOrAddress, installationId);
    if (!rec) return [];
    const targetFull = rec.ga.id;
    const targetShort = stripInstallationPrefix(this.projectInfo.id, rec.installation.installationId, rec.ga.id);

    const out: KnxGroupAddressLinkEntry[] = [];
    for (const devRec of this.iterAllDevices(rec.installation.installationId)) {
      const dev = devRec.device;
      const prodHit = dev.productRefId ? this.productIndex.get(dev.productRefId) : undefined;
      for (const co of dev.comObjectInstanceRefs) {
        const idx = co.links.findIndex((lk) => lk === targetFull || lk === targetShort);
        if (idx === -1) continue;
        out.push({
          deviceId: dev.id,
          individualAddress: this.computeIndividualAddress(devRec),
          deviceName: dev.name ?? "",
          deviceDescription: dev.description ?? "",
          productName: prodHit?.product.text,
          comObjectRefId: co.refId,
          comObjectText: co.text,
          channelId: co.channelId,
          datapointType: co.datapointType,
          isSending: idx === 0,
          flags: {
            communication: co.communicationFlag,
            read: co.readFlag,
            write: co.writeFlag,
            transmit: co.transmitFlag,
            update: co.updateFlag,
            readOnInit: co.readOnInitFlag,
          },
        });
      }
    }
    return out;
  }

  /**
   * Builds the full Group Address <-> Device/ComObject communication matrix in a single pass.
   */
  public getCommunicationMatrix(
    filter: { installationId?: string; linkedOnly?: boolean; search?: string } = {},
  ): KnxCommunicationMatrixEntry[] {
    const inst = this.getInst(filter.installationId);
    const gaMap = this.buildGaLookupMap(inst);
    const linksByGaId = new Map<string, KnxGroupAddressLinkEntry[]>();

    for (const devRec of this.iterAllDevices(inst.installationId)) {
      const dev = devRec.device;
      const ia = this.computeIndividualAddress(devRec);
      const prodHit = dev.productRefId ? this.productIndex.get(dev.productRefId) : undefined;
      for (const co of dev.comObjectInstanceRefs) {
        co.links.forEach((lk, idx) => {
          const hit = gaMap.get(lk);
          if (!hit) return;
          let arr = linksByGaId.get(hit.ga.id);
          if (!arr) {
            arr = [];
            linksByGaId.set(hit.ga.id, arr);
          }
          arr.push({
            deviceId: dev.id,
            individualAddress: ia,
            deviceName: dev.name ?? "",
            deviceDescription: dev.description ?? "",
            productName: prodHit?.product.text,
            comObjectRefId: co.refId,
            comObjectText: co.text,
            channelId: co.channelId,
            datapointType: co.datapointType,
            isSending: idx === 0,
            flags: {
              communication: co.communicationFlag,
              read: co.readFlag,
              write: co.writeFlag,
              transmit: co.transmitFlag,
              update: co.updateFlag,
              readOnInit: co.readOnInitFlag,
            },
          });
        });
      }
    }

    const gas = this.getGroupAddresses({
      installationId: inst.installationId,
      linkedOnly: filter.linkedOnly,
      search: filter.search,
    });
    return gas.map((ga) => ({
      groupAddress: ga,
      links: linksByGaId.get(ga.id) ?? [],
    }));
  }

  // ---- Locations & Trades queries ----

  public getLocations(installationId?: string): KnxSpace[] {
    return cloneJson(this.getInst(installationId).locations);
  }

  public getSpace(spaceId: string, installationId?: string): KnxSpace | undefined {
    const sp = this.findSpaceById(this.getInst(installationId).locations, spaceId);
    return sp ? cloneJson(sp) : undefined;
  }

  public getDeviceLocationPath(deviceIdOrIa: string, installationId?: string): string | undefined {
    const rec = this.findDeviceRecord(deviceIdOrIa, installationId);
    if (!rec) return undefined;
    return this.buildDeviceSpaceIndex(rec.installation).deviceToPath.get(rec.device.id);
  }

  public getFunctions(
    spaceId?: string,
    installationId?: string,
  ): { spaceId: string; spacePath: string; fn: KnxFunction }[] {
    const inst = this.getInst(installationId);
    const out: { spaceId: string; spacePath: string; fn: KnxFunction }[] = [];
    const walk = (sp: KnxSpace, trail: string[]) => {
      const next = [...trail, sp.name || sp.id];
      if (!spaceId || sp.id === spaceId) {
        for (const fn of sp.functions) {
          out.push({ spaceId: sp.id, spacePath: next.join(" / "), fn: cloneJson(fn) });
        }
      }
      for (const child of sp.spaces) walk(child, next);
    };
    for (const root of inst.locations) walk(root, []);
    return out;
  }

  public getTrades(installationId?: string): KnxTrade[] {
    return cloneJson(this.getInst(installationId).trades);
  }

  public getTrade(tradeId: string, installationId?: string): KnxTrade | undefined {
    const tr = this.findTradeById(this.getInst(installationId).trades, tradeId);
    return tr ? cloneJson(tr) : undefined;
  }

  // ---- Catalogs, Baggages, Archive & Unified Search ----

  public listCatalogProducts(manufacturerId?: string): {
    manufacturerId: string;
    manufacturerName: string;
    hardwareId: string;
    hardwareName: string;
    productRefId: string;
    text: string;
    orderNumber: string;
    hardware2ProgramRefIds: string[];
    applicationProgramRefIds: string[];
  }[] {
    const filter = manufacturerId?.toUpperCase();
    const out: {
      manufacturerId: string;
      manufacturerName: string;
      hardwareId: string;
      hardwareName: string;
      productRefId: string;
      text: string;
      orderNumber: string;
      hardware2ProgramRefIds: string[];
      applicationProgramRefIds: string[];
    }[] = [];

    for (const cat of this.catalogs.values()) {
      if (filter && cat.manufacturerId !== filter) continue;
      for (const hw of cat.hardware) {
        const h2pIds = hw.hardware2Programs.map((h) => h.id);
        const appIds = hw.hardware2Programs.flatMap((h) => h.applicationProgramRefIds);
        for (const prod of hw.products) {
          out.push({
            manufacturerId: cat.manufacturerId,
            manufacturerName: cat.name,
            hardwareId: hw.id,
            hardwareName: hw.name,
            productRefId: prod.id,
            text: prod.text,
            orderNumber: prod.orderNumber,
            hardware2ProgramRefIds: h2pIds,
            applicationProgramRefIds: appIds,
          });
        }
      }
    }
    return out;
  }

  public listBaggages(manufacturerId?: string): KnxBaggageFile[] {
    const filter = manufacturerId?.toUpperCase();
    const out: KnxBaggageFile[] = [];
    for (const cat of this.catalogs.values()) {
      if (filter && cat.manufacturerId !== filter) continue;
      out.push(
        ...cat.baggages.map((b) => ({
          ...b,
          mimeType: b.mimeType ?? guessMimeTypeFromFilename(b.name),
        })),
      );
    }
    return out;
  }

  private findBaggageRecord(refIdOrPath: string): KnxBaggageFile | undefined {
    const needle = refIdOrPath.replace(/\\/g, "/");
    const needleLower = needle.toLowerCase();
    for (const cat of this.catalogs.values()) {
      for (const b of cat.baggages) {
        if (
          b.id === needle ||
          b.zipEntryPath === needle ||
          b.zipEntryPath.toLowerCase() === needleLower ||
          b.name === needle ||
          b.name.toLowerCase() === needleLower
        ) {
          return b;
        }
      }
    }
    return undefined;
  }

  /**
   * Reads the raw `Buffer` of a baggage file by `zipEntryPath`, `BaggageRefId` (e.g. `"M-0071_BG--..."`), or filename.
   */
  public readBaggage(refIdOrPath: string): Buffer {
    const direct = this.readArchiveEntryInternal(refIdOrPath);
    if (direct) return direct;
    const rec = this.findBaggageRecord(refIdOrPath);
    if (rec) {
      const buf = this.readArchiveEntryInternal(rec.zipEntryPath);
      if (buf) return buf;
    }
    throw new Error(`Baggage file not found in project archive: "${refIdOrPath}"`);
  }

  /**
   * Extracts a baggage file with full metadata (`id`, `manufacturerId`, `targetPath`, `name`, `filename`, `mimeType`, `size`, `buffer`).
   * Accepts a `BaggageRefId`, `zipEntryPath`, or filename. Returns `undefined` if not found.
   */
  public getBaggage(refIdOrPath: string): KnxBaggageContent | undefined {
    const rec = this.findBaggageRecord(refIdOrPath);
    if (rec) {
      const buf = this.readArchiveEntryInternal(rec.zipEntryPath);
      if (!buf) return undefined;
      const mimeType = rec.mimeType ?? guessMimeTypeFromFilename(rec.name);
      return {
        ...rec,
        filename: rec.name,
        mimeType,
        size: buf.length,
        buffer: buf,
      };
    }
    const direct = this.readArchiveEntryInternal(refIdOrPath);
    if (!direct) return undefined;
    const normalized = refIdOrPath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const filename = parts[parts.length - 1] ?? normalized;
    const mfrMatch = normalized.match(/^(M-[0-9A-Fa-f]{4})\//);
    const manufacturerId = mfrMatch ? mfrMatch[1].toUpperCase() : "";
    const bagIdx = parts.findIndex((p) => p.toLowerCase() === "baggages");
    const targetPath = bagIdx !== -1 && parts.length > bagIdx + 2 ? parts.slice(bagIdx + 1, -1).join("/") : "";
    return {
      id: normalized,
      manufacturerId,
      targetPath,
      name: filename,
      filename,
      zipEntryPath: normalized,
      mimeType: guessMimeTypeFromFilename(filename),
      size: direct.length,
      buffer: direct,
    };
  }

  public listArchiveEntries(): { fileName: string; uncompressedSize: number; source: "sourceZip" | "override" }[] {
    const map = new Map<string, { fileName: string; uncompressedSize: number; source: "sourceZip" | "override" }>();
    if (this.sourceZip) {
      for (const e of this.sourceZip.listEntries()) {
        if (e.isDirectory || this.removedArchiveEntries.has(e.fileName)) continue;
        map.set(e.fileName, { fileName: e.fileName, uncompressedSize: e.uncompressedSize, source: "sourceZip" });
      }
    }
    for (const [name, src] of this.extraArchiveEntries.entries()) {
      const size =
        src.kind === "buffer" ? src.buffer.length : (src.reader.getEntry(src.sourceName)?.uncompressedSize ?? 0);
      map.set(name, { fileName: name, uncompressedSize: size, source: "override" });
    }
    return Array.from(map.values()).sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  public readArchiveEntry(fileName: string): Buffer {
    const buf = this.readArchiveEntryInternal(fileName);
    if (!buf) throw new Error(`Archive entry not found: "${fileName}"`);
    return buf;
  }

  /**
   * Unified search across Devices, Group Addresses, Group Ranges, Spaces, Functions, Trades, and Catalog Products.
   */
  public search(query: string, options: { limit?: number; installationId?: string } = {}): KnxProjectSearchResult {
    const q = query.trim().toLowerCase();
    const limit = Math.max(1, options.limit ?? 50);
    const inst = this.getInst(options.installationId);

    const devices = this.getDevices({ installationId: inst.installationId, search: q }).slice(0, limit);
    const groupAddresses = this.getGroupAddresses({ installationId: inst.installationId, search: q }).slice(0, limit);

    const groupRanges: KnxProjectSearchResult["groupRanges"] = [];
    const walkGr = (gr: KnxGroupRange, trail: string[]) => {
      if (groupRanges.length >= limit) return;
      const next = [...trail, gr.name];
      if (
        !q ||
        gr.name.toLowerCase().includes(q) ||
        (gr.description ?? "").toLowerCase().includes(q) ||
        gr.id.toLowerCase().includes(q)
      ) {
        groupRanges.push({
          id: gr.id,
          name: gr.name,
          rangeStart: gr.rangeStart,
          rangeEnd: gr.rangeEnd,
          path: next.join(" / "),
        });
      }
      for (const sub of gr.groupRanges) walkGr(sub, next);
    };
    for (const gr of inst.groupRanges) walkGr(gr, []);

    const spaces: KnxProjectSearchResult["spaces"] = [];
    const functions: KnxProjectSearchResult["functions"] = [];
    const walkSp = (sp: KnxSpace, trail: string[]) => {
      const next = [...trail, sp.name || sp.id];
      const pathStr = next.join(" / ");
      if (
        spaces.length < limit &&
        (!q ||
          sp.name.toLowerCase().includes(q) ||
          sp.type.toLowerCase().includes(q) ||
          (sp.description ?? "").toLowerCase().includes(q))
      ) {
        spaces.push({ id: sp.id, type: sp.type, name: sp.name, path: pathStr });
      }
      for (const fn of sp.functions) {
        if (
          functions.length < limit &&
          (!q || fn.name.toLowerCase().includes(q) || fn.type.toLowerCase().includes(q))
        ) {
          functions.push({ id: fn.id, name: fn.name, type: fn.type, spaceId: sp.id, spacePath: pathStr });
        }
      }
      for (const child of sp.spaces) walkSp(child, next);
    };
    for (const sp of inst.locations) walkSp(sp, []);

    const trades: KnxProjectSearchResult["trades"] = [];
    const walkTr = (tr: KnxTrade, trail: string[]) => {
      if (trades.length >= limit) return;
      const next = [...trail, tr.name];
      if (!q || tr.name.toLowerCase().includes(q) || (tr.description ?? "").toLowerCase().includes(q)) {
        trades.push({ id: tr.id, name: tr.name, path: next.join(" / ") });
      }
      for (const sub of tr.trades) walkTr(sub, next);
    };
    for (const tr of inst.trades) walkTr(tr, []);

    const products = this.listCatalogProducts()
      .filter((p) => {
        if (!q) return true;
        return (
          p.text.toLowerCase().includes(q) ||
          p.orderNumber.toLowerCase().includes(q) ||
          p.hardwareName.toLowerCase().includes(q) ||
          p.manufacturerName.toLowerCase().includes(q) ||
          p.productRefId.toLowerCase().includes(q)
        );
      })
      .slice(0, limit)
      .map((p) => ({
        manufacturerId: p.manufacturerId,
        manufacturerName: p.manufacturerName,
        productRefId: p.productRefId,
        hardware2ProgramRefId: p.hardware2ProgramRefIds[0],
        text: p.text,
        orderNumber: p.orderNumber,
      }));

    return { devices, groupAddresses, groupRanges, spaces, functions, trades, products };
  }

  // ============================================================================
  // Master XML, External Catalog Provider, `.knxprod` Import & `DeviceConfigSession` Bridge
  // ============================================================================

  /**
   * Replaces/embeds a user-supplied official `knx_master.xml` (XML string, `Buffer`, or file path)
   * into this project, updating DPTs, Manufacturers, MediumTypes, and MaskVersions (`HawkConfigurationData`).
   */
  public setMasterXml(xmlOrBufferOrPath: string | Buffer, language?: string): KnxMasterData {
    const resolved = resolveMasterXmlInput(xmlOrBufferOrPath);
    this.extraArchiveEntries.set("knx_master.xml", { kind: "buffer", buffer: resolved.buffer });
    this.removedArchiveEntries.delete("knx_master.xml");
    this.masterData = parseKnxMasterData(resolved.text, language ?? this.metadata.loadedLanguage);
    this.maskVersionsCache = null;
    this.markModified();
    return this.getMasterData();
  }

  /**
   * Returns `true` if this project contains full KNX `MaskVersions` (`HawkConfigurationData`, e.g. `MV-07B0`)
   * loaded from an official `knx_master.xml` (either from an ETS `.knxproj`, an imported `.knxprod`, or `setMasterXml()`).
   */
  public hasOfficialMaskVersions(): boolean {
    return this.getMaskVersionsLazy().size > 0;
  }

  /**
   * Registers an external user-supplied catalog provider callback.
   * When a device's `M-XXXX_A-*.xml` is not embedded inside the `.knxproj`, `loadApplicationProgram()`,
   * `getDeviceDetails(..., { resolveCatalog: true })`, and `openDeviceSession()` will query this provider
   * so your backend can supply `.knxprod` files on demand from central storage.
   */
  public registerCatalogProvider(provider: KnxExternalCatalogProvider | null): void {
    this.externalCatalogProvider = provider;
  }

  private async resolveExternalCatalog(
    input: ExternalKnxProdInput,
    applicationId: string,
    language?: string,
  ): Promise<{ app: KnxApplicationProgram; parsedProd?: ParsedKnxProd }> {
    if (typeof input === "string") {
      const parsed = await KnxProdParser.parseFile(input, { language, applicationId });
      const app = parsed.applications.find((a) => a.id === applicationId) ?? parsed.applications[0];
      if (!app) throw new Error(`ApplicationProgram "${applicationId}" not found in "${input}"`);
      return { app, parsedProd: parsed };
    }
    if (Buffer.isBuffer(input)) {
      const parsed = await KnxProdParser.parseBuffer(input, { language, applicationId });
      const app = parsed.applications.find((a) => a.id === applicationId) ?? parsed.applications[0];
      if (!app) throw new Error(`ApplicationProgram "${applicationId}" not found in supplied .knxprod Buffer`);
      return { app, parsedProd: parsed };
    }
    if ("applications" in input) {
      const app = input.applications.find((a) => a.id === applicationId) ?? input.applications[0];
      if (!app) throw new Error(`ApplicationProgram "${applicationId}" not found in supplied ParsedKnxProd`);
      return { app, parsedProd: input };
    }
    return { app: input };
  }

  /**
   * Imports a user-supplied official ETS `.knxprod` product catalog into this project so its devices can be
   * instantiated, parameterized, and (by default) bundled inside the exported `.knxproj` archive.
   *
   * Pass `{ embedApplicationXml: false }` to import only lightweight Hardware/Catalog metadata and supply
   * the heavy `M-XXXX_A-*.xml` externally at runtime via `registerCatalogProvider()` or `externalKnxProd`.
   */
  public importKnxProd(
    filePathOrBuffer: string | Buffer,
    options?: string | ImportKnxProdOptions,
  ): ImportKnxProdResult {
    const opts: ImportKnxProdOptions = typeof options === "string" ? { language: options } : (options ?? {});
    const language = opts.language;
    const embedApplicationXml = opts.embedApplicationXml !== false;

    const prodZip = Buffer.isBuffer(filePathOrBuffer)
      ? ZipReader.fromBuffer(filePathOrBuffer)
      : ZipReader.fromFile(filePathOrBuffer);
    const entries = prodZip.listEntries();

    // If project has no real knx_master.xml yet, adopt the one from .knxprod
    const prodMaster = entries.find((e) => e.fileName.toLowerCase() === "knx_master.xml");
    if (prodMaster && !this.sourceZip?.hasEntry("knx_master.xml") && !this.extraArchiveEntries.has("knx_master.xml")) {
      this.extraArchiveEntries.set("knx_master.xml", {
        kind: "zip",
        reader: prodZip,
        sourceName: prodMaster.fileName,
      });
      this.masterData = parseKnxMasterData(
        prodZip.readEntryText(prodMaster.fileName),
        language ?? this.metadata.loadedLanguage,
      );
      this.maskVersionsCache = null;
    }

    const mfrMatch = entries.map((e) => /^(M-[0-9A-Fa-f]{4})\//.exec(e.fileName)?.[1]).find(Boolean);
    if (!mfrMatch) {
      throw new Error("Invalid .knxprod archive: no M-XXXX manufacturer directory found");
    }
    const mfrId = mfrMatch.toUpperCase();
    const numericId = parseManufacturerNumericId(mfrId);
    const existed = this.catalogs.has(mfrId);
    const existingCat = this.catalogs.get(mfrId);
    const cat: KnxManufacturerCatalog = existingCat ?? {
      manufacturerId: mfrId,
      numericId,
      name: this.masterData.manufacturers[mfrId]?.name ?? KNX_MANUFACTURERS[numericId] ?? mfrId,
      hasSignature: false,
      hardware: [],
      catalogSections: [],
      applicationFiles: {},
      baggages: [],
    };
    this.catalogs.set(mfrId, cat);

    const addedAppIds: string[] = [];
    let addedHwCount = 0;
    let addedProdCount = 0;
    let addedBaggageCount = 0;

    // Copy or merge manufacturer XMLs and binary entries
    for (const entry of entries) {
      if (entry.isDirectory) continue;

      if (entry.fileName.toLowerCase() === `${mfrId.toLowerCase()}.signature`) {
        if (!existed && embedApplicationXml) {
          this.extraArchiveEntries.set(`${mfrId}.signature`, {
            kind: "zip",
            reader: prodZip,
            sourceName: entry.fileName,
          });
          cat.hasSignature = true;
        }
        continue;
      }

      if (!entry.fileName.toUpperCase().startsWith(`${mfrId}/`)) continue;
      const rel = entry.fileName.slice(mfrId.length + 1);
      const targetPath = `${mfrId}/${rel}`;

      if (/^Hardware\.xml$/i.test(rel)) {
        const incomingXml = prodZip.readEntryText(entry.fileName);
        const parsedHw = parseProjectHardwareXml(incomingXml, mfrId, language ?? this.metadata.loadedLanguage);
        const existingHwIds = new Set(cat.hardware.map((h) => h.id));
        for (const hw of parsedHw) {
          if (!existingHwIds.has(hw.id)) {
            cat.hardware.push(hw);
            addedHwCount++;
            addedProdCount += hw.products.length;
          }
        }
        const prevBuf = this.readArchiveEntryInternal(targetPath);
        if (prevBuf && existed) {
          const merged = mergeManufacturerContainerXml(prevBuf.toString("utf8"), incomingXml, "Hardware", "Hardware");
          this.extraArchiveEntries.set(targetPath, { kind: "buffer", buffer: Buffer.from(merged, "utf8") });
          // Manufacturer folder modified relative to original signature -> drop stale M-xxxx.signature
          this.removedArchiveEntries.add(`${mfrId}.signature`);
          this.extraArchiveEntries.delete(`${mfrId}.signature`);
          cat.hasSignature = false;
        } else {
          this.extraArchiveEntries.set(targetPath, { kind: "zip", reader: prodZip, sourceName: entry.fileName });
        }
      } else if (/^Catalog\.xml$/i.test(rel)) {
        const incomingXml = prodZip.readEntryText(entry.fileName);
        const parsedSections = parseProjectCatalogXml(incomingXml, language ?? this.metadata.loadedLanguage);
        const existingSecIds = new Set(cat.catalogSections.map((s) => s.id));
        for (const sec of parsedSections) {
          if (!existingSecIds.has(sec.id)) cat.catalogSections.push(sec);
        }
        const prevBuf = this.readArchiveEntryInternal(targetPath);
        if (prevBuf && existed) {
          const merged = mergeManufacturerContainerXml(
            prevBuf.toString("utf8"),
            incomingXml,
            "Catalog",
            "CatalogSection",
          );
          this.extraArchiveEntries.set(targetPath, { kind: "buffer", buffer: Buffer.from(merged, "utf8") });
        } else {
          this.extraArchiveEntries.set(targetPath, { kind: "zip", reader: prodZip, sourceName: entry.fileName });
        }
      } else if (/^Baggages\.xml$/i.test(rel)) {
        const incomingXml = prodZip.readEntryText(entry.fileName);
        const parsedBag = parseProjectBaggagesXml(incomingXml, mfrId);
        const existingBagIds = new Set(cat.baggages.map((b) => b.id));
        for (const b of parsedBag) {
          if (!existingBagIds.has(b.id)) {
            cat.baggages.push(b);
            addedBaggageCount++;
          }
        }
        const prevBuf = this.readArchiveEntryInternal(targetPath);
        if (prevBuf && existed) {
          const merged = mergeManufacturerContainerXml(prevBuf.toString("utf8"), incomingXml, "Baggages", "Baggage");
          this.extraArchiveEntries.set(targetPath, { kind: "buffer", buffer: Buffer.from(merged, "utf8") });
        } else {
          this.extraArchiveEntries.set(targetPath, { kind: "zip", reader: prodZip, sourceName: entry.fileName });
        }
      } else {
        const appMatch = /^(M-[0-9A-Fa-f]{4}_A-[^/]+)\.xml$/i.exec(rel);
        if (appMatch) {
          const appId = appMatch[1];
          addedAppIds.push(appId);
          if (embedApplicationXml) {
            this.extraArchiveEntries.set(targetPath, { kind: "zip", reader: prodZip, sourceName: entry.fileName });
            cat.applicationFiles[appId] = { zipEntryPath: targetPath, uncompressedSize: entry.uncompressedSize };
          }
        } else {
          // Baggage binary payload
          this.extraArchiveEntries.set(targetPath, { kind: "zip", reader: prodZip, sourceName: entry.fileName });
        }
      }
    }

    this.rebuildCatalogIndexes();
    this.markModified();

    return {
      manufacturerId: mfrId,
      manufacturerName: cat.name,
      hardwareCount: addedHwCount,
      productCount: addedProdCount,
      applicationIds: addedAppIds,
      baggageCount: addedBaggageCount,
      mergedIntoExistingManufacturer: existed,
    };
  }

  /**
   * Lazily streams and parses an `ApplicationProgram` from:
   * 1. Explicit `options.externalKnxProd` (if supplied), OR
   * 2. The project's embedded `M-XXXX/M-XXXX_A-*.xml` (cached per `appId::language`), OR
   * 3. The user-supplied `KnxExternalCatalogProvider` registered via `registerCatalogProvider()`.
   */
  public async loadApplicationProgram(
    applicationId: string,
    options: {
      language?: string;
      externalKnxProd?: ExternalKnxProdInput;
      manufacturerId?: string;
      productRefId?: string;
    } = {},
  ): Promise<KnxApplicationProgram> {
    const lang = options.language;
    if (options.externalKnxProd) {
      const resolved = await this.resolveExternalCatalog(options.externalKnxProd, applicationId, lang);
      return resolved.app;
    }

    const cacheKey = `${applicationId}::${lang ?? ""}`;
    const cached = this.applicationCache.get(cacheKey);
    if (cached) return cached;

    let zipEntryPath: string | undefined;
    for (const cat of this.catalogs.values()) {
      const found = cat.applicationFiles[applicationId];
      if (found) {
        zipEntryPath = found.zipEntryPath;
        break;
      }
    }

    if (zipEntryPath) {
      const stream = this.createArchiveEntryStreamInternal(zipEntryPath);
      const apps = await parseApplicationProgramStream(stream, { language: lang, applicationId });
      const app = apps.find((a) => a.id === applicationId) ?? apps[0];
      if (!app) {
        throw new Error(`ApplicationProgram "${applicationId}" not found inside "${zipEntryPath}"`);
      }
      this.applicationCache.set(cacheKey, app);
      return app;
    }

    if (this.externalCatalogProvider) {
      const supplied = await this.externalCatalogProvider(applicationId, {
        language: lang,
        manufacturerId: options.manufacturerId,
        productRefId: options.productRefId,
      });
      if (supplied) {
        const resolved = await this.resolveExternalCatalog(supplied, applicationId, lang);
        this.applicationCache.set(cacheKey, resolved.app);
        return resolved.app;
      }
    }

    throw new Error(
      `ApplicationProgram "${applicationId}" is not embedded in this project. Import its .knxprod with importKnxProd(), pass { externalKnxProd }, or register a catalog provider via registerCatalogProvider().`,
    );
  }

  private getMaskVersionsLazy(): Map<string, KnxMaskVersion> {
    if (this.maskVersionsCache) return this.maskVersionsCache;
    const buf = this.readArchiveEntryInternal("knx_master.xml");
    this.maskVersionsCache = buf ? parseKnxMasterMaskVersions(buf.toString("utf8")) : new Map();
    return this.maskVersionsCache;
  }

  /**
   * Opens a live `DeviceConfigSession` for any device in this `.knxproj`, preloaded with its
   * `ApplicationProgram` (from embedded `.knxproj` catalog, explicit `externalKnxProd`, or registered
   * external catalog provider), current `ParameterInstanceRefs` (including dynamic `<ModuleInstance>` refs!),
   * and linked Group Addresses.
   */
  public async openDeviceSession(
    idOrIndividualAddress: string,
    options: { language?: string; installationId?: string; externalKnxProd?: ExternalKnxProdInput } = {},
  ): Promise<DeviceConfigSession> {
    const rec = this.requireDeviceRecord(idOrIndividualAddress, options.installationId);
    const dev = rec.device;
    const appId = this.resolveApplicationIdForDevice(dev);
    if (!appId && !options.externalKnxProd) {
      throw new Error(`Cannot determine ApplicationProgramRefId for device "${dev.id}"`);
    }

    const lang = options.language ?? this.metadata.loadedLanguage;
    let parsedProd: ParsedKnxProd;
    let app: KnxApplicationProgram;

    if (options.externalKnxProd) {
      const resolved = await this.resolveExternalCatalog(options.externalKnxProd, appId ?? "", lang);
      app = resolved.app;
      if (resolved.parsedProd) {
        parsedProd = resolved.parsedProd;
      } else {
        const mfrId = app.manufacturerRefId;
        const hwXmlBuf = this.readArchiveEntryInternal(`${mfrId}/Hardware.xml`);
        parsedProd = {
          sourceName: this.metadata.sourceFileName ?? this.projectInfo.name,
          manufacturerId: app.manufacturerId,
          manufacturerRefId: mfrId,
          hardware: hwXmlBuf ? parseHardwareXml(hwXmlBuf.toString("utf8")) : [],
          applications: [app],
          maskVersions: this.getMaskVersionsLazy(),
        };
      }
    } else {
      const summary = this.summarizeDevice(
        rec,
        this.buildDeviceSpaceIndex(rec.installation),
        this.buildDeviceTradeIndex(rec.installation),
      );
      app = await this.loadApplicationProgram(appId!, {
        language: lang,
        manufacturerId: summary.manufacturerId,
        productRefId: dev.productRefId,
      });
      const maskVersions = this.getMaskVersionsLazy();
      const mfrId = app.manufacturerRefId;
      const hwXmlBuf = this.readArchiveEntryInternal(`${mfrId}/Hardware.xml`);
      const hardware = hwXmlBuf ? parseHardwareXml(hwXmlBuf.toString("utf8")) : [];
      const mfrBaggages: KnxProdBaggageEntry[] = this.listBaggages(mfrId).map((b) => ({
        id: b.id,
        manufacturerId: b.manufacturerId,
        targetPath: b.targetPath,
        name: b.name,
        filename: b.name,
        zipEntryPath: b.zipEntryPath,
        mimeType: b.mimeType ?? guessMimeTypeFromFilename(b.name),
      }));

      parsedProd = {
        sourceName: this.metadata.sourceFileName ?? this.projectInfo.name,
        manufacturerId: app.manufacturerId,
        manufacturerRefId: mfrId,
        hardware,
        applications: [app],
        maskVersions,
        baggages: mfrBaggages,
        readBaggage: (refIdOrName: string): KnxExtractedBaggage | undefined => {
          const hit = this.getBaggage(refIdOrName);
          if (!hit) return undefined;
          return {
            id: hit.id,
            manufacturerId: hit.manufacturerId,
            targetPath: hit.targetPath,
            name: hit.name,
            filename: hit.filename,
            zipEntryPath: hit.zipEntryPath,
            mimeType: hit.mimeType,
            size: hit.size,
            buffer: hit.buffer,
          };
        },
      };
    }

    const appPrefix = `${app.id}_`;
    const parameters: Record<string, string> = {};
    for (const pr of dev.parameterInstanceRefs) {
      const fullKey = pr.refId.startsWith(appPrefix) ? pr.refId : `${appPrefix}${pr.refId}`;
      parameters[fullKey] = pr.value;
    }

    const gaMap = this.buildGaLookupMap(rec.installation);
    const groupLinks: Record<string, GroupObjectLinkSpec> = {};
    for (const co of dev.comObjectInstanceRefs) {
      if (co.links.length === 0) continue;
      const resolvedGas: string[] = [];
      for (const lk of co.links) {
        const hit = gaMap.get(lk);
        if (hit) resolvedGas.push(formatGroupAddressByStyle(hit.ga.address, "ThreeLevel"));
      }
      if (resolvedGas.length === 0) continue;

      const fullCoRefId = co.refId.startsWith(appPrefix) ? co.refId : `${appPrefix}${co.refId}`;
      const flags: NonNullable<Exclude<GroupObjectLinkSpec, string | string[]>["flags"]> = {};
      if (co.communicationFlag) flags.communication = co.communicationFlag === "Enabled";
      if (co.readFlag) flags.read = co.readFlag === "Enabled";
      if (co.writeFlag) flags.write = co.writeFlag === "Enabled";
      if (co.transmitFlag) flags.transmit = co.transmitFlag === "Enabled";
      if (co.updateFlag) flags.update = co.updateFlag === "Enabled";
      if (co.readOnInitFlag) flags.readOnInit = co.readOnInitFlag === "Enabled";
      if (co.priority) flags.priority = co.priority;

      groupLinks[fullCoRefId] = {
        sending: resolvedGas[0],
        listening: resolvedGas.length > 1 ? resolvedGas.slice(1) : undefined,
        flags: Object.keys(flags).length > 0 ? flags : undefined,
      };
    }

    const deviceIa = this.computeIndividualAddress(rec);
    const initialConfig: DeviceApplicationConfig = {
      parameters,
      groupLinks,
      ...(deviceIa ? { individualAddress: deviceIa } : {}),
    };

    // Auto-populate coupler Filter Table when opening a session for a Line/Area Coupler (e.g. MV-091A / MV-2920)
    if (deviceIa && dev.address === 0 && isCouplerMaskVersion(app.maskVersion)) {
      const filters = this.computeFilterTables(rec.installation.installationId);
      const matchedCoupler =
        filters.lineCouplers.find((c) => c.couplerAddress === deviceIa) ??
        filters.areaCouplers.find((c) => c.couplerAddress === deviceIa);
      if (matchedCoupler) {
        initialConfig.filterTable = matchedCoupler.filterTableBitmaskHex;
        initialConfig.isAreaCoupler = matchedCoupler.couplerType === "area";
      }
    }

    return new DeviceConfigSession(parsedProd, initialConfig);
  }

  /**
   * Builds an ETS-compatible `<GroupObjectTree>` from a `DeviceConfigSession`'s evaluated UI tree.
   */
  private buildGroupObjectTreeFromSession(session: DeviceConfigSession): KnxGroupObjectTree | undefined {
    const ui = session.getUiState({ includeAccessNone: true });
    const evaluated = session.getEvaluatedState();
    const appPrefix = `${session.app.id}_`;

    const toShortCoRef = (internalOrFullId: string): string => {
      const etsMapped = evaluated.internalIdToEtsId.get(internalOrFullId);
      if (etsMapped) return etsMapped.startsWith(appPrefix) ? etsMapped.slice(appPrefix.length) : etsMapped;
      return internalOrFullId.startsWith(appPrefix) ? internalOrFullId.slice(appPrefix.length) : internalOrFullId;
    };

    const toShortContainerId = (rawId: string): string => {
      // Convert expanded module container IDs like "M-..._MD-1_M-15_r0_M-..._MD-1_PB-1" -> "MD-1_M-15_MI-1_PB-1"
      for (const mi of evaluated.instantiatedModules) {
        const prefix = `${mi.instanceKey}_${mi.moduleDefId}_`;
        if (rawId.startsWith(prefix)) {
          return `${mi.etsInstanceId}_${rawId.slice(prefix.length)}`;
        }
      }
      return rawId.startsWith(appPrefix) ? rawId.slice(appPrefix.length) : rawId;
    };

    // Map active ComObjects by channel & parameter block from the evaluated <Dynamic> tree
    const activeCoRefSet = new Set(ui.comObjects.map((c) => c.comObjectRefId));
    const placedCoRefs = new Set<string>();

    // Walk Dynamic AST to associate ComObjectRefRef nodes with their enclosing Channel & ParameterBlock
    const channelNodeMap = new Map<
      string,
      { text: string; directCos: string[]; folders: Map<string, { text: string; cos: string[] }> }
    >();
    const rootCos: string[] = [];

    const walkDyn = (
      nodes: typeof session.app.dynamic,
      curChannel?: { refId: string; text: string },
      curBlock?: { refId: string; text: string },
    ) => {
      for (const n of nodes) {
        if (n.type === "Container") {
          const shortId = n.id ? toShortContainerId(n.id) : undefined;
          const label =
            (n.id ? session.app.translations?.get(n.id)?.Text : undefined) ?? n.text ?? n.name ?? shortId ?? "";
          if (n.tag === "Channel" && shortId) {
            const ch = { refId: shortId, text: label };
            if (!channelNodeMap.has(shortId)) {
              channelNodeMap.set(shortId, { text: label, directCos: [], folders: new Map() });
            }
            walkDyn(n.children, ch, undefined);
          } else if ((n.tag === "ParameterBlock" || n.tag === "ComObjectParameterBlock") && shortId) {
            walkDyn(n.children, curChannel, { refId: shortId, text: label });
          } else {
            walkDyn(n.children, curChannel, curBlock);
          }
        } else if (n.type === "Choose") {
          const val = evaluated.parameterRefValues.get(n.paramRefId) ?? "";
          let matched = false;
          for (const w of n.whens) {
            if (!w.isDefault && matchesWhenTest(val, w.test)) {
              matched = true;
              walkDyn(w.children, curChannel, curBlock);
            }
          }
          if (!matched) {
            for (const w of n.whens) {
              if (w.isDefault) walkDyn(w.children, curChannel, curBlock);
            }
          }
        } else if (n.type === "Repeat") {
          // Expanded modules inside Repeat are visited via expandedModules below
          walkDyn(n.children, curChannel, curBlock);
        } else if (n.type === "Module") {
          for (const mi of evaluated.instantiatedModules) {
            if (mi.instanceKey === n.id || mi.instanceKey.startsWith(`${n.id}_`)) {
              const expNodes = evaluated.expandedModules.get(mi.instanceKey);
              if (expNodes) walkDyn(expNodes, curChannel, curBlock);
            }
          }
        } else if (n.type === "ComObjectRefRef") {
          if (!activeCoRefSet.has(n.refId) || placedCoRefs.has(n.refId)) continue;
          placedCoRefs.add(n.refId);
          const shortCo = toShortCoRef(n.refId);
          if (curChannel) {
            const entry = channelNodeMap.get(curChannel.refId)!;
            if (curBlock) {
              let f = entry.folders.get(curBlock.refId);
              if (!f) {
                f = { text: curBlock.text, cos: [] };
                entry.folders.set(curBlock.refId, f);
              }
              f.cos.push(shortCo);
            } else {
              entry.directCos.push(shortCo);
            }
          } else {
            rootCos.push(shortCo);
          }
        }
      }
    };

    walkDyn(session.app.dynamic);

    // Any remaining active ComObjects (e.g. from deep Repeat branches) go to rootCos
    for (const co of ui.comObjects) {
      if (!placedCoRefs.has(co.comObjectRefId)) {
        placedCoRefs.add(co.comObjectRefId);
        rootCos.push(toShortCoRef(co.comObjectRefId));
      }
    }

    const treeNodes: KnxGroupObjectTreeNode[] = [];
    for (const [chRefId, data] of channelNodeMap.entries()) {
      const folderNodes: KnxGroupObjectTreeNode[] = [];
      for (const [fRefId, fData] of data.folders.entries()) {
        if (fData.cos.length === 0) continue;
        folderNodes.push({
          type: "Folder",
          refId: fRefId,
          text: fData.text,
          groupObjectInstances: fData.cos,
          nodes: [],
        });
      }
      if (data.directCos.length === 0 && folderNodes.length === 0) continue;
      treeNodes.push({
        type: "Channel",
        refId: chRefId,
        text: data.text,
        groupObjectInstances: data.directCos.length > 0 ? data.directCos : undefined,
        nodes: folderNodes,
      });
    }

    if (treeNodes.length === 0 && rootCos.length === 0) return undefined;
    return {
      groupObjectInstances: rootCos.length > 0 ? rootCos : undefined,
      nodes: treeNodes,
    };
  }

  /**
   * Writes modified parameters, Group Object links, `<ModuleInstances>` (for `<ModuleDef>`/`<Repeat>` apps),
   * and `<GroupObjectTree>` from a `DeviceConfigSession` back into the corresponding `DeviceInstance`.
   */
  public applyDeviceSession(
    idOrIndividualAddress: string,
    session: DeviceConfigSession,
    options: {
      autoCreateGroupAddresses?: boolean;
      regenerateGroupObjectTree?: boolean;
      syncModuleInstances?: boolean;
      installationId?: string;
    } = {},
  ): {
    updatedParameters: number;
    updatedComObjects: number;
    syncedModuleInstances: number;
    createdGroupAddresses: string[];
  } {
    const rec = this.requireDeviceRecord(idOrIndividualAddress, options.installationId);
    const dev = rec.device;
    const inst = rec.installation;
    const appId = session.app.id;
    const appPrefix = `${appId}_`;
    const serialized = session.toJSON();
    const uiState = session.getUiState({ includeAccessNone: true });
    const evaluated = session.getEvaluatedState();

    // Helper: convert internal DynamicEvaluator ParameterRef/ComObjectRef IDs -> canonical ETS 0.xml RefIds
    const toEtsParamRefId = (rawKey: string): string => {
      const mapped = evaluated.internalIdToEtsId.get(rawKey);
      if (mapped) return mapped;
      if (evaluated.etsIdToInternalId.has(rawKey)) {
        return rawKey.startsWith(appPrefix) ? rawKey : `${appPrefix}${rawKey}`;
      }
      if (evaluated.allParameterRefs.has(rawKey)) return rawKey;
      const matchedRef = Array.from(evaluated.allParameterRefs.values()).find(
        (r) =>
          r.id === rawKey ||
          r.refId === rawKey ||
          r.name === rawKey ||
          evaluated.allParameters.get(r.refId)?.name === rawKey,
      );
      if (matchedRef) {
        return evaluated.internalIdToEtsId.get(matchedRef.id) ?? matchedRef.id;
      }
      return rawKey;
    };

    const toEtsComObjectShortRefId = (internalCoRefId: string): string => {
      const mapped = evaluated.internalIdToEtsId.get(internalCoRefId);
      if (mapped) return mapped.startsWith(appPrefix) ? mapped.slice(appPrefix.length) : mapped;
      return internalCoRefId.startsWith(appPrefix) ? internalCoRefId.slice(appPrefix.length) : internalCoRefId;
    };

    // 1. Update ParameterInstanceRefs
    const paramByRefId = new Map<string, string>();
    for (const existing of dev.parameterInstanceRefs) {
      paramByRefId.set(existing.refId, existing.value);
    }

    let updatedParameters = 0;
    for (const [key, val] of Object.entries(serialized.parameters)) {
      const targetRefId = toEtsParamRefId(key);
      if (paramByRefId.get(targetRefId) !== val) {
        paramByRefId.set(targetRefId, val);
        updatedParameters++;
      }
    }

    dev.parameterInstanceRefs = Array.from(paramByRefId.entries()).map(([refId, value]) => ({ refId, value }));

    // 2. Sync <ModuleInstances> when application uses <ModuleDef>
    let syncedModuleInstances = dev.moduleInstances.length;
    if (options.syncModuleInstances !== false && session.app.moduleDefs.size > 0) {
      dev.moduleInstances = evaluated.instantiatedModules.map((mi) => ({
        id: mi.etsInstanceId,
        refId: mi.etsRefId,
        repeatIndex: mi.repeatIndex,
        arguments: mi.arguments.map((a) => ({ refId: a.refId, value: a.value })),
      }));
      syncedModuleInstances = dev.moduleInstances.length;
    }

    // 3. Update ComObjectInstanceRefs & links
    const createdGroupAddresses: string[] = [];
    const ensureGaShortId = (gaStr: string): string => {
      const addrInt = parseGroupAddressToInt(gaStr);
      let gaRec = this.findGroupAddressRecord(addrInt, inst.installationId);
      if (!gaRec) {
        if (!options.autoCreateGroupAddresses) {
          throw new Error(
            `Group Address "${gaStr}" does not exist in project "${this.projectInfo.name}". Pass { autoCreateGroupAddresses: true } to create it automatically.`,
          );
        }
        const created = this.addGroupAddress(
          {
            address: addrInt,
            name: `GA ${formatGroupAddressByStyle(addrInt, this.projectInfo.groupAddressStyle)}`,
            autoCreateRanges: true,
          },
          inst.installationId,
        );
        createdGroupAddresses.push(created.addressFormatted);
        gaRec = this.findGroupAddressRecord(created.id, inst.installationId)!;
      }
      return stripInstallationPrefix(this.projectInfo.id, inst.installationId, gaRec.ga.id);
    };

    const existingCoByShortRef = new Map<string, KnxComObjectInstanceRef>();
    for (const co of dev.comObjectInstanceRefs) {
      const shortRef = co.refId.startsWith(appPrefix) ? co.refId.slice(appPrefix.length) : co.refId;
      existingCoByShortRef.set(shortRef, co);
    }

    let updatedComObjects = 0;
    const touchedShortRefs = new Set<string>();

    for (const uiCo of uiState.comObjects) {
      if (uiCo.groupAddresses.length === 0) continue;
      const shortRef = toEtsComObjectShortRefId(uiCo.comObjectRefId);
      touchedShortRefs.add(shortRef);

      const orderedGas: string[] = [];
      if (uiCo.sendingGroupAddress) orderedGas.push(uiCo.sendingGroupAddress);
      for (const ga of uiCo.groupAddresses) {
        if (!orderedGas.includes(ga)) orderedGas.push(ga);
      }
      const linkShortIds = orderedGas.map(ensureGaShortId);

      const existing = existingCoByShortRef.get(shortRef);
      if (existing) {
        existing.links = linkShortIds;
        if (uiCo.label) existing.text = uiCo.label;
        if (uiCo.datapointType) existing.datapointType = uiCo.datapointType;
      } else {
        const createdCo: KnxComObjectInstanceRef = {
          refId: shortRef,
          text: uiCo.label,
          datapointType: uiCo.datapointType,
          links: linkShortIds,
        };
        dev.comObjectInstanceRefs.push(createdCo);
        existingCoByShortRef.set(shortRef, createdCo);
      }
      updatedComObjects++;
    }

    // Clear links on ComObjects that were unlinked in the session (only for known active refs)
    for (const uiCo of uiState.comObjects) {
      if (uiCo.groupAddresses.length > 0) continue;
      const shortRef = toEtsComObjectShortRefId(uiCo.comObjectRefId);
      if (touchedShortRefs.has(shortRef)) continue;
      const existing = existingCoByShortRef.get(shortRef);
      if (existing && existing.links.length > 0) {
        existing.links = [];
        updatedComObjects++;
      }
    }

    // 4. Regenerate <GroupObjectTree>
    if (options.regenerateGroupObjectTree !== false) {
      const tree = this.buildGroupObjectTreeFromSession(session);
      if (tree) dev.groupObjectTree = tree;
    }

    dev.lastModified = nowIsoUtc();
    dev.parametersLoaded = false;
    dev.communicationPartLoaded = false;
    this.markModified();

    return { updatedParameters, updatedComObjects, syncedModuleInstances, createdGroupAddresses };
  }

  // ============================================================================
  // Full CRUD & Modification API
  // ============================================================================

  public updateProjectInfo(
    patch: Partial<
      Pick<
        KnxProjectInfo,
        | "name"
        | "groupAddressStyle"
        | "comment"
        | "completionStatus"
        | "projectNumber"
        | "contractNumber"
        | "orderNumber"
        | "projectStart"
        | "projectEnd"
      >
    >,
  ): KnxProjectInfo {
    Object.assign(this.projectInfo, patch);
    this.markModified();
    return this.getProjectInfo();
  }

  // ---- Areas ----

  public addArea(
    input: {
      address: number;
      name: string;
      description?: string;
      comment?: string;
      completionStatus?: string;
      id?: string;
      createMainLine?: boolean;
    },
    installationId?: string,
  ): KnxArea {
    if (!Number.isInteger(input.address) || input.address < 0 || input.address > 15) {
      throw new Error(`Area address must be an integer 0..15 (got ${input.address})`);
    }
    const inst = this.getInst(installationId);
    if (inst.topology.areas.some((a) => a.address === input.address)) {
      throw new Error(`Area ${input.address} already exists in installation "${inst.installationId}"`);
    }
    const maxA = extractMaxNumericSuffix(
      inst.topology.areas.map((a) => a.id),
      "A",
    );
    const areaId = input.id ?? `${this.projectInfo.id}-${inst.installationId}_A-${maxA + 1}`;
    const area: KnxArea = {
      id: areaId,
      address: input.address,
      name: input.name,
      description: input.description,
      comment: input.comment,
      completionStatus: input.completionStatus,
      puid: this.allocatePuid(),
      lines: [],
    };
    inst.topology.areas.push(area);
    inst.topology.areas.sort((a, b) => a.address - b.address);

    if (input.createMainLine) {
      this.addLine(area.id, { address: 0, name: "Main line", mediumTypeRefId: "MT-5" }, inst.installationId);
    }
    this.markModified();
    return cloneJson(area);
  }

  public updateArea(
    idOrAddress: string | number,
    patch: Partial<Pick<KnxArea, "address" | "name" | "description" | "comment" | "completionStatus">>,
    installationId?: string,
  ): KnxArea {
    const inst = this.getInst(installationId);
    const area =
      typeof idOrAddress === "number"
        ? inst.topology.areas.find((a) => a.address === idOrAddress)
        : inst.topology.areas.find((a) => a.id === idOrAddress || String(a.address) === idOrAddress);
    if (!area) throw new Error(`Area "${idOrAddress}" not found`);
    if (patch.address !== undefined && patch.address !== area.address) {
      if (!Number.isInteger(patch.address) || patch.address < 0 || patch.address > 15) {
        throw new Error(`Area address must be 0..15 (got ${patch.address})`);
      }
      if (inst.topology.areas.some((a) => a.address === patch.address && a.id !== area.id)) {
        throw new Error(`Area address ${patch.address} is already in use`);
      }
    }
    Object.assign(area, patch);
    inst.topology.areas.sort((a, b) => a.address - b.address);
    this.markModified();
    return cloneJson(area);
  }

  public removeArea(idOrAddress: string | number, installationId?: string): boolean {
    const inst = this.getInst(installationId);
    const idx = inst.topology.areas.findIndex((a) =>
      typeof idOrAddress === "number"
        ? a.address === idOrAddress
        : a.id === idOrAddress || String(a.address) === idOrAddress,
    );
    if (idx === -1) return false;
    const area = inst.topology.areas[idx];
    // Clean up device refs from spaces and trades for all devices inside this area
    const devIds = new Set<string>();
    for (const l of area.lines) {
      for (const d of l.devices) devIds.add(d.id);
      for (const s of l.segments) for (const d of s.devices) devIds.add(d.id);
    }
    this.cleanupDeviceRefs(inst, devIds);
    inst.topology.areas.splice(idx, 1);
    this.markModified();
    return true;
  }

  // ---- Lines & Segments ----

  public addLine(
    areaIdOrAddr: string | number,
    input: {
      address: number;
      name: string;
      mediumTypeRefId?: string;
      description?: string;
      comment?: string;
      domainAddress?: string;
      id?: string;
    },
    installationId?: string,
  ): KnxLine {
    if (!Number.isInteger(input.address) || input.address < 0 || input.address > 15) {
      throw new Error(`Line address must be an integer 0..15 (got ${input.address})`);
    }
    const inst = this.getInst(installationId);
    const area =
      typeof areaIdOrAddr === "number"
        ? inst.topology.areas.find((a) => a.address === areaIdOrAddr)
        : inst.topology.areas.find((a) => a.id === areaIdOrAddr || String(a.address) === areaIdOrAddr);
    if (!area) throw new Error(`Area "${areaIdOrAddr}" not found`);
    if (area.lines.some((l) => l.address === input.address)) {
      throw new Error(`Line ${area.address}.${input.address} already exists`);
    }

    const allLineIds = inst.topology.areas.flatMap((a) => a.lines.map((l) => l.id));
    const maxL = extractMaxNumericSuffix(allLineIds, "L");
    const lineId = input.id ?? `${this.projectInfo.id}-${inst.installationId}_L-${maxL + 1}`;
    const line: KnxLine = {
      id: lineId,
      address: input.address,
      name: input.name,
      mediumTypeRefId: input.mediumTypeRefId ?? "MT-0",
      description: input.description,
      comment: input.comment,
      domainAddress: input.domainAddress,
      puid: this.allocatePuid(),
      devices: [],
      segments: [],
      additionalGroupAddresses: [],
    };
    area.lines.push(line);
    area.lines.sort((a, b) => a.address - b.address);
    this.markModified();
    return cloneJson(line);
  }

  public updateLine(
    lineIdOrCoords: string | { area: number; line: number },
    patch: Partial<
      Pick<
        KnxLine,
        "address" | "name" | "mediumTypeRefId" | "description" | "comment" | "domainAddress" | "completionStatus"
      >
    >,
    installationId?: string,
  ): KnxLine {
    const { area, line } = this.resolveLineTarget(lineIdOrCoords, installationId);
    if (patch.address !== undefined && patch.address !== line.address) {
      if (!Number.isInteger(patch.address) || patch.address < 0 || patch.address > 15) {
        throw new Error(`Line address must be 0..15 (got ${patch.address})`);
      }
      if (area.lines.some((l) => l.address === patch.address && l.id !== line.id)) {
        throw new Error(`Line ${area.address}.${patch.address} already exists`);
      }
    }
    Object.assign(line, patch);
    area.lines.sort((a, b) => a.address - b.address);
    this.markModified();
    return cloneJson(line);
  }

  public removeLine(lineIdOrCoords: string | { area: number; line: number }, installationId?: string): boolean {
    try {
      const { inst, area, line } = this.resolveLineTarget(lineIdOrCoords, installationId);
      const devIds = new Set<string>();
      for (const d of line.devices) devIds.add(d.id);
      for (const s of line.segments) for (const d of s.devices) devIds.add(d.id);
      this.cleanupDeviceRefs(inst, devIds);
      area.lines = area.lines.filter((l) => l.id !== line.id);
      this.markModified();
      return true;
    } catch {
      return false;
    }
  }

  public addSegment(
    lineIdOrCoords: string | { area: number; line: number },
    input: {
      number: number;
      name?: string;
      description?: string;
      comment?: string;
      mediumTypeRefId?: string;
      id?: string;
    },
    installationId?: string,
  ): KnxSegment {
    const { inst, line } = this.resolveLineTarget(lineIdOrCoords, installationId);
    if (line.segments.some((s) => s.number === input.number)) {
      throw new Error(`Segment ${input.number} already exists on line "${line.id}"`);
    }
    const allSegIds = inst.topology.areas.flatMap((a) => a.lines.flatMap((l) => l.segments.map((s) => s.id)));
    const maxS = extractMaxNumericSuffix(allSegIds, "LS");
    const seg: KnxSegment = {
      id: input.id ?? `${this.projectInfo.id}-${inst.installationId}_LS-${maxS + 1}`,
      number: input.number,
      name: input.name,
      description: input.description,
      comment: input.comment,
      mediumTypeRefId: input.mediumTypeRefId ?? line.mediumTypeRefId,
      puid: this.allocatePuid(),
      devices: [],
    };
    line.segments.push(seg);
    this.markModified();
    return cloneJson(seg);
  }

  // ---- Devices ----

  private nextFreeDeviceAddress(line: KnxLine): number {
    const used = new Set<number>();
    for (const d of line.devices) if (d.address !== undefined) used.add(d.address);
    for (const s of line.segments) for (const d of s.devices) if (d.address !== undefined) used.add(d.address);
    for (let addr = 1; addr <= 255; addr++) {
      if (!used.has(addr)) return addr;
    }
    throw new Error(`Line "${line.id}" has no free Individual Addresses (1..255)`);
  }

  public addDevice(
    lineIdOrCoords: string | { area: number; line: number },
    input: {
      address?: number | "auto";
      name?: string;
      description?: string;
      comment?: string;
      productRefId?: string;
      hardware2ProgramRefId?: string;
      serialNumber?: string;
      ipConfig?: KnxDeviceIpConfig;
      security?: KnxDeviceSecurity;
      spaceId?: string;
      tradeId?: string;
      segmentNumber?: number;
      id?: string;
    },
    installationId?: string,
  ): KnxDeviceSummary {
    const { inst, area, line } = this.resolveLineTarget(lineIdOrCoords, installationId);

    let resolvedAddr: number | undefined;
    if (input.address === "auto") {
      resolvedAddr = this.nextFreeDeviceAddress(line);
    } else if (input.address !== undefined) {
      if (!Number.isInteger(input.address) || input.address < 0 || input.address > 255) {
        throw new Error(`Device address must be an integer 0..255 (got ${input.address})`);
      }
      const exists =
        line.devices.some((d) => d.address === input.address) ||
        line.segments.some((s) => s.devices.some((d) => d.address === input.address));
      if (exists) {
        throw new Error(`Individual Address ${area.address}.${line.address}.${input.address} is already in use`);
      }
      resolvedAddr = input.address;
    }

    // Auto-resolve hardware2ProgramRefId from ProductRefId if omitted and unambiguous
    let h2pRefId = input.hardware2ProgramRefId;
    if (!h2pRefId && input.productRefId) {
      const prodHit = this.productIndex.get(input.productRefId);
      if (prodHit && prodHit.hardware.hardware2Programs.length > 0) {
        h2pRefId = prodHit.hardware.hardware2Programs[0].id;
      }
    }

    const allDevIds = this.iterAllDevices(inst.installationId).map((r) => r.device.id);
    const maxDi = extractMaxNumericSuffix(allDevIds, "DI");
    const devId = input.id ?? `${this.projectInfo.id}-${inst.installationId}_DI-${maxDi + 1}`;
    const serialNumberB64 = input.serialNumber ? encodeKnxSerialNumberBase64(input.serialNumber) : undefined;

    const dev: KnxDeviceInstance = {
      id: devId,
      address: resolvedAddr,
      name: input.name ?? "",
      description: input.description ?? "",
      comment: input.comment ?? "",
      productRefId: input.productRefId,
      hardware2ProgramRefId: h2pRefId,
      serialNumber: serialNumberB64,
      serialNumberHex: decodeKnxSerialNumberHex(serialNumberB64),
      isActivityCalculated: true,
      lastModified: nowIsoUtc(),
      puid: this.allocatePuid(),
      parameterInstanceRefs: [],
      comObjectInstanceRefs: [],
      moduleInstances: [],
      additionalAddresses: [],
      ipConfig: input.ipConfig ? { ...input.ipConfig } : undefined,
      security: input.security ? { ...input.security } : undefined,
      busInterfaces: [],
      binaryData: [],
    };

    let targetSegment: KnxSegment | undefined;
    if (input.segmentNumber !== undefined) {
      targetSegment = line.segments.find((s) => s.number === input.segmentNumber);
      if (!targetSegment) throw new Error(`Segment ${input.segmentNumber} not found on line "${line.id}"`);
      targetSegment.devices.push(dev);
    } else if (line.segments.length > 0 && line.devices.length === 0) {
      targetSegment = line.segments[0];
      targetSegment.devices.push(dev);
    } else {
      line.devices.push(dev);
    }

    if (input.spaceId) {
      this.assignDeviceToSpace(dev.id, input.spaceId, inst.installationId);
    }
    if (input.tradeId) {
      this.assignDeviceToTrade(dev.id, input.tradeId, inst.installationId);
    }

    this.markModified();
    return this.summarizeDevice(
      { device: dev, installation: inst, area, line, segment: targetSegment, unassigned: false },
      this.buildDeviceSpaceIndex(inst),
      this.buildDeviceTradeIndex(inst),
    );
  }

  public updateDevice(
    idOrIa: string,
    patch: Partial<{
      address: number | null;
      name: string;
      description: string;
      comment: string;
      productRefId: string;
      hardware2ProgramRefId: string;
      serialNumber: string | null;
      completionStatus: string;
      applicationProgramLoaded: boolean;
      communicationPartLoaded: boolean;
      individualAddressLoaded: boolean;
      mediumConfigLoaded: boolean;
      parametersLoaded: boolean;
      ipConfig: KnxDeviceIpConfig | null;
      security: KnxDeviceSecurity | null;
    }>,
    installationId?: string,
  ): KnxDeviceSummary {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const dev = rec.device;

    if (patch.address !== undefined) {
      if (patch.address === null) {
        dev.address = undefined;
      } else {
        if (!Number.isInteger(patch.address) || patch.address < 0 || patch.address > 255) {
          throw new Error(`Device address must be 0..255 (got ${patch.address})`);
        }
        if (rec.line && patch.address !== dev.address) {
          const conflict =
            rec.line.devices.some((d) => d.id !== dev.id && d.address === patch.address) ||
            rec.line.segments.some((s) => s.devices.some((d) => d.id !== dev.id && d.address === patch.address));
          if (conflict) {
            throw new Error(
              `Individual Address ${rec.area?.address}.${rec.line.address}.${patch.address} is already in use`,
            );
          }
        }
        dev.address = patch.address;
      }
    }

    if (patch.name !== undefined) dev.name = patch.name;
    if (patch.description !== undefined) dev.description = patch.description;
    if (patch.comment !== undefined) dev.comment = patch.comment;
    if (patch.productRefId !== undefined) dev.productRefId = patch.productRefId;
    if (patch.hardware2ProgramRefId !== undefined) dev.hardware2ProgramRefId = patch.hardware2ProgramRefId;
    if (patch.completionStatus !== undefined) dev.completionStatus = patch.completionStatus;
    if (patch.applicationProgramLoaded !== undefined) dev.applicationProgramLoaded = patch.applicationProgramLoaded;
    if (patch.communicationPartLoaded !== undefined) dev.communicationPartLoaded = patch.communicationPartLoaded;
    if (patch.individualAddressLoaded !== undefined) dev.individualAddressLoaded = patch.individualAddressLoaded;
    if (patch.mediumConfigLoaded !== undefined) dev.mediumConfigLoaded = patch.mediumConfigLoaded;
    if (patch.parametersLoaded !== undefined) dev.parametersLoaded = patch.parametersLoaded;

    if (patch.serialNumber !== undefined) {
      if (patch.serialNumber === null || patch.serialNumber === "") {
        dev.serialNumber = undefined;
        dev.serialNumberHex = undefined;
      } else {
        dev.serialNumber = encodeKnxSerialNumberBase64(patch.serialNumber);
        dev.serialNumberHex = decodeKnxSerialNumberHex(dev.serialNumber);
      }
    }

    if (patch.ipConfig !== undefined) {
      dev.ipConfig = patch.ipConfig === null ? undefined : { ...(dev.ipConfig ?? {}), ...patch.ipConfig };
    }
    if (patch.security !== undefined) {
      dev.security = patch.security === null ? undefined : { ...(dev.security ?? {}), ...patch.security };
    }

    dev.lastModified = nowIsoUtc();
    this.markModified();
    return this.summarizeDevice(
      rec,
      this.buildDeviceSpaceIndex(rec.installation),
      this.buildDeviceTradeIndex(rec.installation),
    );
  }

  public moveDevice(
    idOrIa: string,
    targetLineIdOrCoords: string | { area: number; line: number },
    newAddress?: number | "auto",
    installationId?: string,
  ): KnxDeviceSummary {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const { inst, area, line } = this.resolveLineTarget(targetLineIdOrCoords, rec.installation.installationId);
    const dev = rec.device;

    let resolvedAddr: number | undefined;
    if (newAddress === "auto") {
      resolvedAddr = this.nextFreeDeviceAddress(line);
    } else if (newAddress !== undefined) {
      if (!Number.isInteger(newAddress) || newAddress < 0 || newAddress > 255) {
        throw new Error(`Device address must be 0..255 (got ${newAddress})`);
      }
      const conflict =
        line.devices.some((d) => d.id !== dev.id && d.address === newAddress) ||
        line.segments.some((s) => s.devices.some((d) => d.id !== dev.id && d.address === newAddress));
      if (conflict) {
        throw new Error(`Individual Address ${area.address}.${line.address}.${newAddress} is already in use`);
      }
      resolvedAddr = newAddress;
    } else if (dev.address !== undefined) {
      const conflict =
        line.devices.some((d) => d.id !== dev.id && d.address === dev.address) ||
        line.segments.some((s) => s.devices.some((d) => d.id !== dev.id && d.address === dev.address));
      resolvedAddr = conflict ? this.nextFreeDeviceAddress(line) : dev.address;
    }

    // Remove from old container
    if (rec.unassigned) {
      inst.topology.unassignedDevices = inst.topology.unassignedDevices.filter((d) => d.id !== dev.id);
    } else if (rec.segment) {
      rec.segment.devices = rec.segment.devices.filter((d) => d.id !== dev.id);
    } else if (rec.line) {
      rec.line.devices = rec.line.devices.filter((d) => d.id !== dev.id);
    }

    dev.address = resolvedAddr;
    dev.lastModified = nowIsoUtc();
    const targetSeg = line.segments.length > 0 && line.devices.length === 0 ? line.segments[0] : undefined;
    if (targetSeg) targetSeg.devices.push(dev);
    else line.devices.push(dev);

    this.markModified();
    return this.summarizeDevice(
      { device: dev, installation: inst, area, line, segment: targetSeg, unassigned: false },
      this.buildDeviceSpaceIndex(inst),
      this.buildDeviceTradeIndex(inst),
    );
  }

  private cleanupDeviceRefs(inst: KnxInstallation, devIds: Set<string>): void {
    const cleanSpaces = (list: KnxSpace[]) => {
      for (const sp of list) {
        sp.deviceInstanceRefs = sp.deviceInstanceRefs.filter((r) => !devIds.has(r));
        cleanSpaces(sp.spaces);
      }
    };
    const cleanTrades = (list: KnxTrade[]) => {
      for (const tr of list) {
        tr.deviceInstanceRefs = tr.deviceInstanceRefs.filter((r) => !devIds.has(r));
        cleanTrades(tr.trades);
      }
    };
    cleanSpaces(inst.locations);
    cleanTrades(inst.trades);
  }

  public removeDevice(idOrIa: string, installationId?: string): boolean {
    const rec = this.findDeviceRecord(idOrIa, installationId);
    if (!rec) return false;
    const devId = rec.device.id;
    if (rec.unassigned) {
      rec.installation.topology.unassignedDevices = rec.installation.topology.unassignedDevices.filter(
        (d) => d.id !== devId,
      );
    } else if (rec.segment) {
      rec.segment.devices = rec.segment.devices.filter((d) => d.id !== devId);
    } else if (rec.line) {
      rec.line.devices = rec.line.devices.filter((d) => d.id !== devId);
    }
    this.cleanupDeviceRefs(rec.installation, new Set([devId]));
    this.markModified();
    return true;
  }

  // ---- Device Parameters & ComObject Links ----

  public setDeviceParameter(
    idOrIa: string,
    refId: string,
    value: string | number | boolean,
    installationId?: string,
  ): void {
    this.setDeviceParameters(idOrIa, { [refId]: value }, installationId);
  }

  public setDeviceParameters(
    idOrIa: string,
    params: Record<string, string | number | boolean>,
    installationId?: string,
  ): void {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const dev = rec.device;
    for (const [refId, raw] of Object.entries(params)) {
      const val = typeof raw === "boolean" ? (raw ? "1" : "0") : String(raw);
      const existing = dev.parameterInstanceRefs.find((p) => p.refId === refId);
      if (existing) existing.value = val;
      else dev.parameterInstanceRefs.push({ refId, value: val });
    }
    dev.lastModified = nowIsoUtc();
    dev.parametersLoaded = false;
    this.markModified();
  }

  public removeDeviceParameter(idOrIa: string, refId: string, installationId?: string): boolean {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const before = rec.device.parameterInstanceRefs.length;
    rec.device.parameterInstanceRefs = rec.device.parameterInstanceRefs.filter((p) => p.refId !== refId);
    if (rec.device.parameterInstanceRefs.length === before) return false;
    rec.device.lastModified = nowIsoUtc();
    this.markModified();
    return true;
  }

  public setDeviceComObject(
    idOrIa: string,
    comObjectRefId: string,
    patch: Partial<{
      text: string;
      description: string;
      functionText: string;
      datapointType: string;
      channelId: string;
      communicationFlag: FlagSetting;
      readFlag: FlagSetting;
      writeFlag: FlagSetting;
      transmitFlag: FlagSetting;
      updateFlag: FlagSetting;
      readOnInitFlag: FlagSetting;
      priority: GroupObjectPriority;
      links: (string | number)[];
    }>,
    installationId?: string,
  ): KnxComObjectInstanceRef {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const dev = rec.device;
    const inst = rec.installation;
    let co = dev.comObjectInstanceRefs.find((c) => c.refId === comObjectRefId);
    if (!co) {
      co = { refId: comObjectRefId, links: [] };
      dev.comObjectInstanceRefs.push(co);
    }

    const { links, ...rest } = patch;
    Object.assign(co, rest);
    if (links !== undefined) {
      const resolvedLinks: string[] = [];
      for (const item of links) {
        const gaRec = this.findGroupAddressRecord(item, inst.installationId);
        if (!gaRec) throw new Error(`Group Address "${item}" not found in project`);
        const shortId = stripInstallationPrefix(this.projectInfo.id, inst.installationId, gaRec.ga.id);
        if (!resolvedLinks.includes(shortId)) resolvedLinks.push(shortId);
      }
      co.links = resolvedLinks;
    }

    dev.lastModified = nowIsoUtc();
    dev.communicationPartLoaded = false;
    this.markModified();
    return cloneJson(co);
  }

  public linkComObjectToGroupAddress(
    idOrIa: string,
    comObjectRefId: string,
    gaIdOrAddr: string | number,
    options: { asSending?: boolean; installationId?: string } = {},
  ): KnxComObjectInstanceRef {
    const rec = this.requireDeviceRecord(idOrIa, options.installationId);
    const inst = rec.installation;
    const gaRec = this.findGroupAddressRecord(gaIdOrAddr, inst.installationId);
    if (!gaRec) throw new Error(`Group Address "${gaIdOrAddr}" not found in project`);
    const shortId = stripInstallationPrefix(this.projectInfo.id, inst.installationId, gaRec.ga.id);

    let co = rec.device.comObjectInstanceRefs.find((c) => c.refId === comObjectRefId);
    if (!co) {
      co = { refId: comObjectRefId, links: [] };
      rec.device.comObjectInstanceRefs.push(co);
    }

    co.links = co.links.filter((l) => l !== shortId && l !== gaRec.ga.id);
    if (options.asSending) co.links.unshift(shortId);
    else co.links.push(shortId);

    rec.device.lastModified = nowIsoUtc();
    rec.device.communicationPartLoaded = false;
    this.markModified();
    return cloneJson(co);
  }

  public unlinkComObjectFromGroupAddress(
    idOrIa: string,
    comObjectRefId: string,
    gaIdOrAddr?: string | number,
    installationId?: string,
  ): boolean {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const co = rec.device.comObjectInstanceRefs.find((c) => c.refId === comObjectRefId);
    if (!co) return false;
    const before = co.links.length;
    if (gaIdOrAddr === undefined) {
      co.links = [];
    } else {
      const gaRec = this.findGroupAddressRecord(gaIdOrAddr, rec.installation.installationId);
      const shortId = gaRec
        ? stripInstallationPrefix(this.projectInfo.id, rec.installation.installationId, gaRec.ga.id)
        : String(gaIdOrAddr);
      const fullId = gaRec?.ga.id ?? String(gaIdOrAddr);
      co.links = co.links.filter((l) => l !== shortId && l !== fullId);
    }
    if (co.links.length === before) return false;
    rec.device.lastModified = nowIsoUtc();
    rec.device.communicationPartLoaded = false;
    this.markModified();
    return true;
  }

  // ---- Group Ranges & Group Addresses ----

  private collectAllGroupRangeIds(ranges: KnxGroupRange[], acc: string[] = []): string[] {
    for (const gr of ranges) {
      acc.push(gr.id);
      this.collectAllGroupRangeIds(gr.groupRanges, acc);
    }
    return acc;
  }

  public addGroupRange(
    input: {
      name: string;
      rangeStart: number;
      rangeEnd: number;
      parentRangeId?: string;
      description?: string;
      comment?: string;
      unfiltered?: boolean;
      security?: string;
      id?: string;
    },
    installationId?: string,
  ): KnxGroupRange {
    if (input.rangeStart < 0 || input.rangeEnd > 65535 || input.rangeStart > input.rangeEnd) {
      throw new Error(`Invalid GroupRange bounds: ${input.rangeStart}..${input.rangeEnd}`);
    }
    const inst = this.getInst(installationId);
    const maxGr = extractMaxNumericSuffix(this.collectAllGroupRangeIds(inst.groupRanges), "GR");
    const gr: KnxGroupRange = {
      id: input.id ?? `${this.projectInfo.id}-${inst.installationId}_GR-${maxGr + 1}`,
      name: input.name,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      description: input.description,
      comment: input.comment,
      unfiltered: input.unfiltered,
      security: input.security,
      puid: this.allocatePuid(),
      groupRanges: [],
      groupAddresses: [],
    };

    if (input.parentRangeId) {
      const parent = this.findGroupRangeById(inst.groupRanges, input.parentRangeId);
      if (!parent) throw new Error(`Parent GroupRange "${input.parentRangeId}" not found`);
      parent.groupRanges.push(gr);
      parent.groupRanges.sort((a, b) => a.rangeStart - b.rangeStart);
    } else {
      inst.groupRanges.push(gr);
      inst.groupRanges.sort((a, b) => a.rangeStart - b.rangeStart);
    }
    this.markModified();
    return cloneJson(gr);
  }

  /**
   * Convenience helper for 3-level projects: creates a Main Group range (`mainGroup` in `0..31`).
   */
  public addMainGroup(
    mainGroup: number,
    name: string,
    options: { description?: string; comment?: string; installationId?: string } = {},
  ): KnxGroupRange {
    if (!Number.isInteger(mainGroup) || mainGroup < 0 || mainGroup > 31) {
      throw new Error(`Main group must be 0..31 (got ${mainGroup})`);
    }
    const rangeStart = mainGroup === 0 ? 1 : mainGroup << 11;
    const rangeEnd = (mainGroup << 11) | 0x7ff;
    return this.addGroupRange(
      { name, rangeStart, rangeEnd, description: options.description, comment: options.comment },
      options.installationId,
    );
  }

  /**
   * Convenience helper for 3-level projects: creates a Middle Group range (`mainGroup: 0..31`, `middleGroup: 0..7`).
   * Auto-creates the parent Main Group if it doesn't exist yet.
   */
  public addMiddleGroup(
    mainGroup: number,
    middleGroup: number,
    name: string,
    options: { description?: string; comment?: string; mainGroupName?: string; installationId?: string } = {},
  ): KnxGroupRange {
    if (!Number.isInteger(mainGroup) || mainGroup < 0 || mainGroup > 31) {
      throw new Error(`Main group must be 0..31 (got ${mainGroup})`);
    }
    if (!Number.isInteger(middleGroup) || middleGroup < 0 || middleGroup > 7) {
      throw new Error(`Middle group must be 0..7 (got ${middleGroup})`);
    }
    const inst = this.getInst(options.installationId);
    const mainStart = mainGroup === 0 ? 1 : mainGroup << 11;
    const mainEnd = (mainGroup << 11) | 0x7ff;
    let mainRange = inst.groupRanges.find((gr) => gr.rangeStart <= mainStart && gr.rangeEnd >= mainEnd);
    if (!mainRange) {
      const created = this.addMainGroup(mainGroup, options.mainGroupName ?? `Main Group ${mainGroup}`, {
        installationId: inst.installationId,
      });
      mainRange = this.findGroupRangeById(inst.groupRanges, created.id)!;
    }

    const midStart = mainGroup === 0 && middleGroup === 0 ? 1 : (mainGroup << 11) | (middleGroup << 8);
    const midEnd = (mainGroup << 11) | (middleGroup << 8) | 0xff;
    return this.addGroupRange(
      {
        name,
        rangeStart: midStart,
        rangeEnd: midEnd,
        parentRangeId: mainRange.id,
        description: options.description,
        comment: options.comment,
      },
      inst.installationId,
    );
  }

  public updateGroupRange(
    rangeId: string,
    patch: Partial<
      Pick<KnxGroupRange, "name" | "rangeStart" | "rangeEnd" | "description" | "comment" | "unfiltered" | "security">
    >,
    installationId?: string,
  ): KnxGroupRange {
    const gr = this.findGroupRangeById(this.getInst(installationId).groupRanges, rangeId);
    if (!gr) throw new Error(`GroupRange "${rangeId}" not found`);
    Object.assign(gr, patch);
    this.markModified();
    return cloneJson(gr);
  }

  public removeGroupRange(rangeId: string, options: { recursive?: boolean; installationId?: string } = {}): boolean {
    const inst = this.getInst(options.installationId);
    const removeFrom = (list: KnxGroupRange[]): boolean => {
      const idx = list.findIndex((g) => g.id === rangeId);
      if (idx !== -1) {
        const target = list[idx];
        if (!options.recursive && (target.groupRanges.length > 0 || target.groupAddresses.length > 0)) {
          throw new Error(`GroupRange "${rangeId}" is not empty. Pass { recursive: true } to delete all descendants.`);
        }
        // Clean up links for all GAs removed
        const gaIdsToRemove = new Set<string>();
        const collectGa = (g: KnxGroupRange) => {
          for (const ga of g.groupAddresses) {
            gaIdsToRemove.add(ga.id);
            gaIdsToRemove.add(stripInstallationPrefix(this.projectInfo.id, inst.installationId, ga.id));
          }
          for (const sub of g.groupRanges) collectGa(sub);
        };
        collectGa(target);
        this.cleanupGroupAddressRefs(inst, gaIdsToRemove);
        list.splice(idx, 1);
        return true;
      }
      for (const g of list) {
        if (removeFrom(g.groupRanges)) return true;
      }
      return false;
    };
    const ok = removeFrom(inst.groupRanges);
    if (ok) this.markModified();
    return ok;
  }

  private findBestRangeForAddress(ranges: KnxGroupRange[], addrInt: number): KnxGroupRange | undefined {
    for (const gr of ranges) {
      if (addrInt >= gr.rangeStart && addrInt <= gr.rangeEnd) {
        const deeper = this.findBestRangeForAddress(gr.groupRanges, addrInt);
        return deeper ?? gr;
      }
    }
    return undefined;
  }

  public addGroupAddress(
    input: {
      address: string | number;
      name: string;
      rangeId?: string;
      autoCreateRanges?: boolean;
      description?: string;
      comment?: string;
      datapointType?: string;
      central?: boolean;
      unfiltered?: boolean;
      security?: string;
      key?: string;
      id?: string;
    },
    installationId?: string,
  ): KnxGroupAddressView {
    const inst = this.getInst(installationId);
    const addrInt = parseGroupAddressToInt(input.address);
    if (addrInt === 0) {
      throw new Error("Group Address 0 (0/0/0) is reserved by KNX and cannot be assigned");
    }
    if (this.findGroupAddressRecord(addrInt, inst.installationId)) {
      throw new Error(
        `Group Address ${formatGroupAddressByStyle(addrInt, this.projectInfo.groupAddressStyle)} (${addrInt}) already exists`,
      );
    }

    let targetRange: KnxGroupRange | undefined;
    if (input.rangeId) {
      targetRange = this.findGroupRangeById(inst.groupRanges, input.rangeId);
      if (!targetRange) throw new Error(`GroupRange "${input.rangeId}" not found`);
    } else {
      targetRange = this.findBestRangeForAddress(inst.groupRanges, addrInt);
      if (!targetRange && input.autoCreateRanges !== false) {
        if (this.projectInfo.groupAddressStyle === "ThreeLevel") {
          const main = (addrInt >> 11) & 0x1f;
          const middle = (addrInt >> 8) & 0x07;
          const createdMid = this.addMiddleGroup(main, middle, `Middle Group ${main}/${middle}`, {
            installationId: inst.installationId,
          });
          targetRange = this.findGroupRangeById(inst.groupRanges, createdMid.id);
        } else if (this.projectInfo.groupAddressStyle === "TwoLevel") {
          const main = (addrInt >> 11) & 0x1f;
          const createdMain = this.addMainGroup(main, `Main Group ${main}`, {
            installationId: inst.installationId,
          });
          targetRange = this.findGroupRangeById(inst.groupRanges, createdMain.id);
        } else {
          const createdRoot = this.addGroupRange(
            { name: "Group Addresses", rangeStart: 1, rangeEnd: 65535 },
            inst.installationId,
          );
          targetRange = this.findGroupRangeById(inst.groupRanges, createdRoot.id);
        }
      }
    }
    if (!targetRange) {
      throw new Error(
        `No matching GroupRange found for address ${addrInt}. Specify rangeId or autoCreateRanges: true.`,
      );
    }

    const allGaIds = this.iterAllGroupAddresses(inst.installationId).map((r) => r.ga.id);
    const maxGa = extractMaxNumericSuffix(allGaIds, "GA");
    const gaId = input.id ?? `${this.projectInfo.id}-${inst.installationId}_GA-${maxGa + 1}`;

    // Normalize DPT if passed in dot notation like "1.001" -> "DPST-1-1"
    let dptRaw = input.datapointType;
    if (dptRaw) {
      const dotMatch = /^(\d+)\.(\d+)$/.exec(dptRaw.trim());
      if (dotMatch) {
        dptRaw = `DPST-${parseInt(dotMatch[1], 10)}-${parseInt(dotMatch[2], 10)}`;
      }
    }

    const ga: KnxGroupAddress = {
      id: gaId,
      address: addrInt,
      name: input.name,
      description: input.description,
      comment: input.comment,
      datapointType: dptRaw,
      central: input.central,
      unfiltered: input.unfiltered,
      security: input.security,
      key: input.key,
      puid: this.allocatePuid(),
    };
    targetRange.groupAddresses.push(ga);
    targetRange.groupAddresses.sort((a, b) => a.address - b.address);
    this.markModified();
    return this.getGroupAddress(ga.id, inst.installationId)!;
  }

  public updateGroupAddress(
    idOrAddr: string | number,
    patch: Partial<{
      address: string | number;
      name: string;
      description: string;
      comment: string;
      datapointType: string | null;
      central: boolean;
      unfiltered: boolean;
      security: string;
      key: string | null;
    }>,
    installationId?: string,
  ): KnxGroupAddressView {
    const rec = this.findGroupAddressRecord(idOrAddr, installationId);
    if (!rec) throw new Error(`Group Address "${idOrAddr}" not found`);

    if (patch.address !== undefined) {
      const nextInt = parseGroupAddressToInt(patch.address);
      if (nextInt !== rec.ga.address) {
        const dup = this.findGroupAddressRecord(nextInt, rec.installation.installationId);
        if (dup && dup.ga.id !== rec.ga.id) {
          throw new Error(
            `Group Address ${formatGroupAddressByStyle(nextInt, this.projectInfo.groupAddressStyle)} already exists`,
          );
        }
        rec.ga.address = nextInt;
        rec.parentRange.groupAddresses.sort((a, b) => a.address - b.address);
      }
    }
    if (patch.name !== undefined) rec.ga.name = patch.name;
    if (patch.description !== undefined) rec.ga.description = patch.description;
    if (patch.comment !== undefined) rec.ga.comment = patch.comment;
    if (patch.central !== undefined) rec.ga.central = patch.central;
    if (patch.unfiltered !== undefined) rec.ga.unfiltered = patch.unfiltered;
    if (patch.security !== undefined) rec.ga.security = patch.security;
    if (patch.key !== undefined) rec.ga.key = patch.key === null ? undefined : patch.key;
    if (patch.datapointType !== undefined) {
      if (patch.datapointType === null || patch.datapointType === "") {
        rec.ga.datapointType = undefined;
      } else {
        const dotMatch = /^(\d+)\.(\d+)$/.exec(patch.datapointType.trim());
        rec.ga.datapointType = dotMatch
          ? `DPST-${parseInt(dotMatch[1], 10)}-${parseInt(dotMatch[2], 10)}`
          : patch.datapointType;
      }
    }

    this.markModified();
    return this.getGroupAddress(rec.ga.id, rec.installation.installationId)!;
  }

  private cleanupGroupAddressRefs(inst: KnxInstallation, gaIdsOrShortIds: Set<string>): void {
    for (const devRec of this.iterAllDevices(inst.installationId)) {
      for (const co of devRec.device.comObjectInstanceRefs) {
        co.links = co.links.filter((l) => !gaIdsOrShortIds.has(l));
      }
    }
    const cleanSpaces = (list: KnxSpace[]) => {
      for (const sp of list) {
        for (const fn of sp.functions) {
          fn.groupAddressRefs = fn.groupAddressRefs.filter((r) => !gaIdsOrShortIds.has(r.refId));
        }
        cleanSpaces(sp.spaces);
      }
    };
    cleanSpaces(inst.locations);
  }

  public removeGroupAddress(idOrAddr: string | number, installationId?: string): boolean {
    const rec = this.findGroupAddressRecord(idOrAddr, installationId);
    if (!rec) return false;
    rec.parentRange.groupAddresses = rec.parentRange.groupAddresses.filter((g) => g.id !== rec.ga.id);
    const shortId = stripInstallationPrefix(this.projectInfo.id, rec.installation.installationId, rec.ga.id);
    this.cleanupGroupAddressRefs(rec.installation, new Set([rec.ga.id, shortId]));
    this.markModified();
    return true;
  }

  // ---- Locations (Spaces & Functions) ----

  private collectAllSpaceIds(spaces: KnxSpace[], acc: string[] = []): string[] {
    for (const sp of spaces) {
      acc.push(sp.id);
      this.collectAllSpaceIds(sp.spaces, acc);
    }
    return acc;
  }

  public addSpace(
    input: {
      type: KnxSpaceType;
      name: string;
      parentSpaceId?: string;
      number?: string;
      description?: string;
      comment?: string;
      usage?: string;
      defaultLine?: string;
      id?: string;
    },
    installationId?: string,
  ): KnxSpace {
    const inst = this.getInst(installationId);
    const maxBp = extractMaxNumericSuffix(this.collectAllSpaceIds(inst.locations), "BP");
    const sp: KnxSpace = {
      id: input.id ?? `${this.projectInfo.id}-${inst.installationId}_BP-${maxBp + 1}`,
      type: input.type,
      name: input.name,
      number: input.number,
      description: input.description,
      comment: input.comment,
      usage: input.usage,
      defaultLine: input.defaultLine,
      puid: this.allocatePuid(),
      deviceInstanceRefs: [],
      functions: [],
      spaces: [],
    };
    if (input.parentSpaceId) {
      const parent = this.findSpaceById(inst.locations, input.parentSpaceId);
      if (!parent) throw new Error(`Parent Space "${input.parentSpaceId}" not found`);
      parent.spaces.push(sp);
    } else {
      inst.locations.push(sp);
    }
    this.markModified();
    return cloneJson(sp);
  }

  public updateSpace(
    spaceId: string,
    patch: Partial<Pick<KnxSpace, "type" | "name" | "number" | "description" | "comment" | "usage" | "defaultLine">>,
    installationId?: string,
  ): KnxSpace {
    const sp = this.findSpaceById(this.getInst(installationId).locations, spaceId);
    if (!sp) throw new Error(`Space "${spaceId}" not found`);
    Object.assign(sp, patch);
    this.markModified();
    return cloneJson(sp);
  }

  public removeSpace(spaceId: string, installationId?: string): boolean {
    const inst = this.getInst(installationId);
    const removeFrom = (list: KnxSpace[]): boolean => {
      const idx = list.findIndex((s) => s.id === spaceId);
      if (idx !== -1) {
        list.splice(idx, 1);
        return true;
      }
      for (const s of list) if (removeFrom(s.spaces)) return true;
      return false;
    };
    const ok = removeFrom(inst.locations);
    if (ok) this.markModified();
    return ok;
  }

  public assignDeviceToSpace(deviceIdOrIa: string, spaceId: string, installationId?: string): void {
    const rec = this.requireDeviceRecord(deviceIdOrIa, installationId);
    const sp = this.findSpaceById(rec.installation.locations, spaceId);
    if (!sp) throw new Error(`Space "${spaceId}" not found`);
    if (!sp.deviceInstanceRefs.includes(rec.device.id)) {
      sp.deviceInstanceRefs.push(rec.device.id);
      this.markModified();
    }
  }

  public unassignDeviceFromSpace(deviceIdOrIa: string, spaceId?: string, installationId?: string): boolean {
    const rec = this.requireDeviceRecord(deviceIdOrIa, installationId);
    let removed = false;
    const walk = (list: KnxSpace[]) => {
      for (const sp of list) {
        if (!spaceId || sp.id === spaceId) {
          const before = sp.deviceInstanceRefs.length;
          sp.deviceInstanceRefs = sp.deviceInstanceRefs.filter((r) => r !== rec.device.id);
          if (sp.deviceInstanceRefs.length !== before) removed = true;
        }
        walk(sp.spaces);
      }
    };
    walk(rec.installation.locations);
    if (removed) this.markModified();
    return removed;
  }

  public addFunction(
    spaceId: string,
    input: {
      name: string;
      type?: string;
      number?: string;
      description?: string;
      comment?: string;
      groupAddresses?: (string | number | { address: string | number; role?: string; name?: string })[];
      id?: string;
    },
    installationId?: string,
  ): KnxFunction {
    const inst = this.getInst(installationId);
    const sp = this.findSpaceById(inst.locations, spaceId);
    if (!sp) throw new Error(`Space "${spaceId}" not found`);

    const allFnIds = this.getFunctions(undefined, inst.installationId).map((f) => f.fn.id);
    const maxF = extractMaxNumericSuffix(allFnIds, "F");
    const fnId = input.id ?? `${this.projectInfo.id}-${inst.installationId}_F-${maxF + 1}`;
    const refs: KnxGroupAddressRef[] = [];

    if (input.groupAddresses) {
      let refIdx = 1;
      for (const entry of input.groupAddresses) {
        const gaKey = typeof entry === "object" ? entry.address : entry;
        const gaRec = this.findGroupAddressRecord(gaKey, inst.installationId);
        if (!gaRec) throw new Error(`Group Address "${gaKey}" not found`);
        refs.push({
          id: `${fnId}_GAR-${refIdx++}`,
          refId: gaRec.ga.id,
          name: typeof entry === "object" ? (entry.name ?? gaRec.ga.name) : gaRec.ga.name,
          role: typeof entry === "object" ? entry.role : undefined,
          puid: this.allocatePuid(),
        });
      }
    }

    const fn: KnxFunction = {
      id: fnId,
      name: input.name,
      type: input.type ?? "FT-0",
      number: input.number,
      description: input.description,
      comment: input.comment,
      puid: this.allocatePuid(),
      groupAddressRefs: refs,
    };
    sp.functions.push(fn);
    this.markModified();
    return cloneJson(fn);
  }

  public removeFunction(functionId: string, installationId?: string): boolean {
    const inst = this.getInst(installationId);
    let removed = false;
    const walk = (list: KnxSpace[]) => {
      for (const sp of list) {
        const before = sp.functions.length;
        sp.functions = sp.functions.filter((f) => f.id !== functionId);
        if (sp.functions.length !== before) removed = true;
        walk(sp.spaces);
      }
    };
    walk(inst.locations);
    if (removed) this.markModified();
    return removed;
  }

  // ---- Trades ----

  private collectAllTradeIds(trades: KnxTrade[], acc: string[] = []): string[] {
    for (const tr of trades) {
      acc.push(tr.id);
      this.collectAllTradeIds(tr.trades, acc);
    }
    return acc;
  }

  public addTrade(
    input: {
      name: string;
      parentTradeId?: string;
      number?: string;
      description?: string;
      comment?: string;
      id?: string;
    },
    installationId?: string,
  ): KnxTrade {
    const inst = this.getInst(installationId);
    const maxT = extractMaxNumericSuffix(this.collectAllTradeIds(inst.trades), "T");
    const tr: KnxTrade = {
      id: input.id ?? `${this.projectInfo.id}-${inst.installationId}_T-${maxT + 1}`,
      name: input.name,
      number: input.number,
      description: input.description,
      comment: input.comment,
      puid: this.allocatePuid(),
      deviceInstanceRefs: [],
      trades: [],
    };
    if (input.parentTradeId) {
      const parent = this.findTradeById(inst.trades, input.parentTradeId);
      if (!parent) throw new Error(`Parent Trade "${input.parentTradeId}" not found`);
      parent.trades.push(tr);
    } else {
      inst.trades.push(tr);
    }
    this.markModified();
    return cloneJson(tr);
  }

  public updateTrade(
    tradeId: string,
    patch: Partial<Pick<KnxTrade, "name" | "number" | "description" | "comment">>,
    installationId?: string,
  ): KnxTrade {
    const tr = this.findTradeById(this.getInst(installationId).trades, tradeId);
    if (!tr) throw new Error(`Trade "${tradeId}" not found`);
    Object.assign(tr, patch);
    this.markModified();
    return cloneJson(tr);
  }

  public removeTrade(tradeId: string, installationId?: string): boolean {
    const inst = this.getInst(installationId);
    const removeFrom = (list: KnxTrade[]): boolean => {
      const idx = list.findIndex((t) => t.id === tradeId);
      if (idx !== -1) {
        list.splice(idx, 1);
        return true;
      }
      for (const t of list) if (removeFrom(t.trades)) return true;
      return false;
    };
    const ok = removeFrom(inst.trades);
    if (ok) this.markModified();
    return ok;
  }

  public assignDeviceToTrade(deviceIdOrIa: string, tradeId: string, installationId?: string): void {
    const rec = this.requireDeviceRecord(deviceIdOrIa, installationId);
    const tr = this.findTradeById(rec.installation.trades, tradeId);
    if (!tr) throw new Error(`Trade "${tradeId}" not found`);
    if (!tr.deviceInstanceRefs.includes(rec.device.id)) {
      tr.deviceInstanceRefs.push(rec.device.id);
      this.markModified();
    }
  }

  public unassignDeviceFromTrade(deviceIdOrIa: string, tradeId?: string, installationId?: string): boolean {
    const rec = this.requireDeviceRecord(deviceIdOrIa, installationId);
    let removed = false;
    const walk = (list: KnxTrade[]) => {
      for (const tr of list) {
        if (!tradeId || tr.id === tradeId) {
          const before = tr.deviceInstanceRefs.length;
          tr.deviceInstanceRefs = tr.deviceInstanceRefs.filter((r) => r !== rec.device.id);
          if (tr.deviceInstanceRefs.length !== before) removed = true;
        }
        walk(tr.trades);
      }
    };
    walk(rec.installation.trades);
    if (removed) this.markModified();
    return removed;
  }

  // ============================================================================
  // Validation & Diagnostics
  // ============================================================================

  public validate(installationId?: string): KnxProjectValidationResult {
    const errors: KnxProjectValidationIssue[] = [];
    const warnings: KnxProjectValidationIssue[] = [];

    if (!this.projectInfo.name.trim()) {
      warnings.push({
        severity: "warning",
        code: "EMPTY_PROJECT_NAME",
        message: "Project name is empty",
        entityType: "project",
      });
    }

    const insts = installationId ? [this.getInst(installationId)] : this.installations;
    for (const inst of insts) {
      const seenIas = new Map<string, string>();
      const allDeviceIds = new Set<string>();
      const gaMap = this.buildGaLookupMap(inst);

      // 1. Validate Areas, Lines, Devices
      const seenAreas = new Set<number>();
      for (const area of inst.topology.areas) {
        if (seenAreas.has(area.address)) {
          errors.push({
            severity: "error",
            code: "DUPLICATE_AREA",
            message: `Duplicate Area address ${area.address}`,
            entityType: "area",
            entityId: area.id,
          });
        }
        seenAreas.add(area.address);

        const seenLines = new Set<number>();
        for (const line of area.lines) {
          if (seenLines.has(line.address)) {
            errors.push({
              severity: "error",
              code: "DUPLICATE_LINE",
              message: `Duplicate Line address ${area.address}.${line.address}`,
              entityType: "line",
              entityId: line.id,
            });
          }
          seenLines.add(line.address);
        }
      }

      for (const rec of this.iterAllDevices(inst.installationId)) {
        const dev = rec.device;
        allDeviceIds.add(dev.id);
        const ia = this.computeIndividualAddress(rec);
        if (ia) {
          if (seenIas.has(ia)) {
            errors.push({
              severity: "error",
              code: "DUPLICATE_INDIVIDUAL_ADDRESS",
              message: `Duplicate Individual Address ${ia} (shared by ${seenIas.get(ia)} and ${dev.id})`,
              entityType: "device",
              entityId: dev.id,
            });
          } else {
            seenIas.set(ia, dev.id);
          }
        } else {
          warnings.push({
            severity: "warning",
            code: "UNASSIGNED_DEVICE_ADDRESS",
            message: `Device "${dev.id}" (${dev.description || dev.name || "unnamed"}) has no Individual Address`,
            entityType: "device",
            entityId: dev.id,
          });
        }

        if (dev.productRefId && this.catalogs.size > 0 && !this.productIndex.has(dev.productRefId)) {
          warnings.push({
            severity: "warning",
            code: "MISSING_CATALOG_PRODUCT",
            message: `Device "${dev.id}" references ProductRefId "${dev.productRefId}" not found in embedded catalogs`,
            entityType: "device",
            entityId: dev.id,
          });
        }

        for (const co of dev.comObjectInstanceRefs) {
          for (const lk of co.links) {
            if (!gaMap.has(lk)) {
              errors.push({
                severity: "error",
                code: "DANGLING_GROUP_LINK",
                message: `Device "${dev.id}" ComObject "${co.refId}" links to unknown GroupAddress "${lk}"`,
                entityType: "device",
                entityId: dev.id,
              });
            }
          }
        }
      }

      // 2. Validate GroupRanges & GroupAddresses
      const seenGaInts = new Map<number, string>();
      const checkRange = (gr: KnxGroupRange) => {
        if (gr.rangeStart > gr.rangeEnd) {
          errors.push({
            severity: "error",
            code: "INVALID_GROUP_RANGE",
            message: `GroupRange "${gr.name}" (${gr.id}) has RangeStart (${gr.rangeStart}) > RangeEnd (${gr.rangeEnd})`,
            entityType: "groupRange",
            entityId: gr.id,
          });
        }
        for (const ga of gr.groupAddresses) {
          if (ga.address < gr.rangeStart || ga.address > gr.rangeEnd) {
            errors.push({
              severity: "error",
              code: "GROUP_ADDRESS_OUT_OF_RANGE",
              message: `GroupAddress "${ga.name}" (${ga.address}) is outside parent range "${gr.name}" (${gr.rangeStart}..${gr.rangeEnd})`,
              entityType: "groupAddress",
              entityId: ga.id,
            });
          }
          if (seenGaInts.has(ga.address)) {
            errors.push({
              severity: "error",
              code: "DUPLICATE_GROUP_ADDRESS",
              message: `Duplicate GroupAddress ${formatGroupAddressByStyle(ga.address, this.projectInfo.groupAddressStyle)} (${ga.id} & ${seenGaInts.get(ga.address)})`,
              entityType: "groupAddress",
              entityId: ga.id,
            });
          } else {
            seenGaInts.set(ga.address, ga.id);
          }
        }
        for (const sub of gr.groupRanges) checkRange(sub);
      };
      for (const gr of inst.groupRanges) checkRange(gr);

      // 3. Validate Locations & Trades DeviceInstanceRefs
      const checkSpaces = (list: KnxSpace[]) => {
        for (const sp of list) {
          for (const refId of sp.deviceInstanceRefs) {
            if (!allDeviceIds.has(refId)) {
              errors.push({
                severity: "error",
                code: "DANGLING_SPACE_DEVICE_REF",
                message: `Space "${sp.name}" (${sp.id}) references missing DeviceInstance "${refId}"`,
                entityType: "space",
                entityId: sp.id,
              });
            }
          }
          for (const fn of sp.functions) {
            for (const gRef of fn.groupAddressRefs) {
              if (!gaMap.has(gRef.refId)) {
                errors.push({
                  severity: "error",
                  code: "DANGLING_FUNCTION_GA_REF",
                  message: `Function "${fn.name}" (${fn.id}) references missing GroupAddress "${gRef.refId}"`,
                  entityType: "space",
                  entityId: sp.id,
                });
              }
            }
          }
          checkSpaces(sp.spaces);
        }
      };
      checkSpaces(inst.locations);

      const checkTrades = (list: KnxTrade[]) => {
        for (const tr of list) {
          for (const refId of tr.deviceInstanceRefs) {
            if (!allDeviceIds.has(refId)) {
              errors.push({
                severity: "error",
                code: "DANGLING_TRADE_DEVICE_REF",
                message: `Trade "${tr.name}" (${tr.id}) references missing DeviceInstance "${refId}"`,
                entityType: "trade",
                entityId: tr.id,
              });
            }
          }
          checkTrades(tr.trades);
        }
      };
      checkTrades(inst.trades);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ============================================================================
  // AdditionalGroupAddresses, BusInterfaces, Filter Tables, Installations, UserFiles & History
  // ============================================================================

  // ---- Line AdditionalGroupAddresses (manual filter-table entries) ----

  public getLineAdditionalGroupAddresses(
    lineIdOrCoords: string | { area: number; line: number },
    installationId?: string,
  ): { address: number; addressFormatted: string }[] {
    const { line } = this.resolveLineTarget(lineIdOrCoords, installationId);
    const style = this.projectInfo.groupAddressStyle;
    return line.additionalGroupAddresses.map((addr) => ({
      address: addr,
      addressFormatted: formatGroupAddressByStyle(addr, style),
    }));
  }

  public addLineAdditionalGroupAddress(
    lineIdOrCoords: string | { area: number; line: number },
    groupAddress: string | number,
    installationId?: string,
  ): number[] {
    const { line } = this.resolveLineTarget(lineIdOrCoords, installationId);
    const addrInt = parseGroupAddressToInt(groupAddress);
    if (!line.additionalGroupAddresses.includes(addrInt)) {
      line.additionalGroupAddresses.push(addrInt);
      line.additionalGroupAddresses.sort((a, b) => a - b);
      this.markModified();
    }
    return [...line.additionalGroupAddresses];
  }

  public removeLineAdditionalGroupAddress(
    lineIdOrCoords: string | { area: number; line: number },
    groupAddress: string | number,
    installationId?: string,
  ): boolean {
    const { line } = this.resolveLineTarget(lineIdOrCoords, installationId);
    const addrInt = parseGroupAddressToInt(groupAddress);
    const before = line.additionalGroupAddresses.length;
    line.additionalGroupAddresses = line.additionalGroupAddresses.filter((a) => a !== addrInt);
    if (line.additionalGroupAddresses.length === before) return false;
    this.markModified();
    return true;
  }

  public setLineAdditionalGroupAddresses(
    lineIdOrCoords: string | { area: number; line: number },
    groupAddresses: (string | number)[],
    installationId?: string,
  ): number[] {
    const { line } = this.resolveLineTarget(lineIdOrCoords, installationId);
    const unique = new Set(groupAddresses.map((g) => parseGroupAddressToInt(g)));
    line.additionalGroupAddresses = Array.from(unique).sort((a, b) => a - b);
    this.markModified();
    return [...line.additionalGroupAddresses];
  }

  // ---- Device BusInterfaces (IP Tunneling slots / gateways) & AdditionalAddresses ----

  public getDeviceBusInterfaces(idOrIa: string, installationId?: string): KnxBusInterface[] {
    return cloneJson(this.requireDeviceRecord(idOrIa, installationId).device.busInterfaces);
  }

  public setDeviceBusInterface(
    idOrIa: string,
    input: {
      refId: string;
      name?: string;
      description?: string;
      comment?: string;
      password?: string;
      passwordHash?: string;
      connectors?: (string | number)[];
    },
    installationId?: string,
  ): KnxBusInterface {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const dev = rec.device;
    const inst = rec.installation;

    const resolveConnectorRefId = (raw: string | number): string => {
      const gaRec = this.findGroupAddressRecord(raw, inst.installationId);
      return gaRec ? gaRec.ga.id : String(raw);
    };

    const existing = dev.busInterfaces.find((bi) => bi.refId === input.refId);
    if (existing) {
      if (input.name !== undefined) existing.name = input.name;
      if (input.description !== undefined) existing.description = input.description;
      if (input.comment !== undefined) existing.comment = input.comment;
      if (input.password !== undefined) existing.password = input.password;
      if (input.passwordHash !== undefined) existing.passwordHash = input.passwordHash;
      if (input.connectors !== undefined) {
        existing.connectors = input.connectors.map((c) => ({ groupAddressRefId: resolveConnectorRefId(c) }));
      }
      dev.lastModified = nowIsoUtc();
      this.markModified();
      return cloneJson(existing);
    }

    const created: KnxBusInterface = {
      refId: input.refId,
      name: input.name,
      description: input.description,
      comment: input.comment,
      password: input.password,
      passwordHash: input.passwordHash,
      connectors: (input.connectors ?? []).map((c) => ({ groupAddressRefId: resolveConnectorRefId(c) })),
    };
    dev.busInterfaces.push(created);
    dev.lastModified = nowIsoUtc();
    this.markModified();
    return cloneJson(created);
  }

  public removeDeviceBusInterface(idOrIa: string, refId: string, installationId?: string): boolean {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const before = rec.device.busInterfaces.length;
    rec.device.busInterfaces = rec.device.busInterfaces.filter((bi) => bi.refId !== refId);
    if (rec.device.busInterfaces.length === before) return false;
    rec.device.lastModified = nowIsoUtc();
    this.markModified();
    return true;
  }

  public addDeviceAdditionalAddress(
    idOrIa: string,
    input: { address: number; name?: string; description?: string; comment?: string },
    installationId?: string,
  ): KnxAdditionalAddress {
    if (!Number.isInteger(input.address) || input.address < 0 || input.address > 255) {
      throw new Error(`Additional device address must be 0..255 (got ${input.address})`);
    }
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const dev = rec.device;
    const existing = dev.additionalAddresses.find((a) => a.address === input.address);
    if (existing) {
      Object.assign(existing, input);
      dev.lastModified = nowIsoUtc();
      this.markModified();
      return cloneJson(existing);
    }
    const entry: KnxAdditionalAddress = {
      address: input.address,
      name: input.name,
      description: input.description,
      comment: input.comment,
    };
    dev.additionalAddresses.push(entry);
    dev.additionalAddresses.sort((a, b) => a.address - b.address);
    dev.lastModified = nowIsoUtc();
    this.markModified();
    return cloneJson(entry);
  }

  public removeDeviceAdditionalAddress(idOrIa: string, address: number, installationId?: string): boolean {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const before = rec.device.additionalAddresses.length;
    rec.device.additionalAddresses = rec.device.additionalAddresses.filter((a) => a.address !== address);
    if (rec.device.additionalAddresses.length === before) return false;
    rec.device.lastModified = nowIsoUtc();
    this.markModified();
    return true;
  }

  // ---- Automatic KNX Line / Area Coupler Filter Table Calculator ----

  /**
   * Automatically computes KNX Line Coupler (`A.L.0`) and Area / Backbone Coupler (`A.0.0`) Filter Tables
   * according to KNX Topology Routing rules:
   * - Cross-line Group Addresses (linked on devices across >= 2 different lines)
   * - Cross-area Group Addresses (linked on devices across >= 2 different areas)
   * - Unfiltered Group Addresses (marked `unfiltered: true` or inside an `unfiltered: true` GroupRange)
   * - Manual `AdditionalGroupAddresses` configured on a Line
   *
   * Includes both structured per-GA entries and the standard 8192-byte (65536-bit) KNX filter table bitmask.
   */
  public computeFilterTables(installationId?: string): KnxProjectFilterTables {
    const inst = this.getInst(installationId);
    const style = this.projectInfo.groupAddressStyle;
    const gaMap = this.buildGaLookupMap(inst);

    // 1. Identify unfiltered GAs (inheritance from ancestor GroupRanges) & map int -> GA record
    const unfilteredInts = new Set<number>();
    const gaByInt = new Map<number, KnxGroupAddress>();
    const walkRanges = (ranges: KnxGroupRange[], parentUnfiltered: boolean) => {
      for (const gr of ranges) {
        const isUnf = parentUnfiltered || Boolean(gr.unfiltered);
        for (const ga of gr.groupAddresses) {
          gaByInt.set(ga.address, ga);
          if (isUnf || ga.unfiltered) unfilteredInts.add(ga.address);
        }
        walkRanges(gr.groupRanges, isUnf);
      }
    };
    walkRanges(inst.groupRanges, false);

    // 2. Track which lines (`"A.L"`) and areas (`A`) reference each Group Address
    const linesByGaInt = new Map<number, Set<string>>();
    const areasByGaInt = new Map<number, Set<number>>();
    const addUsage = (gaInt: number, areaAddr: number, lineAddr: number) => {
      const lineKey = `${areaAddr}.${lineAddr}`;
      let lSet = linesByGaInt.get(gaInt);
      if (!lSet) {
        lSet = new Set();
        linesByGaInt.set(gaInt, lSet);
      }
      lSet.add(lineKey);
      let aSet = areasByGaInt.get(gaInt);
      if (!aSet) {
        aSet = new Set();
        areasByGaInt.set(gaInt, aSet);
      }
      aSet.add(areaAddr);
    };

    for (const devRec of this.iterAllDevices(inst.installationId)) {
      if (devRec.unassigned || !devRec.area || !devRec.line) continue;
      for (const co of devRec.device.comObjectInstanceRefs) {
        for (const lk of co.links) {
          const hit = gaMap.get(lk);
          if (hit) addUsage(hit.ga.address, devRec.area.address, devRec.line.address);
        }
      }
      // Also include BusInterface Connectors (IP Tunneling / Routing interfaces referencing GAs)
      for (const bi of devRec.device.busInterfaces) {
        for (const conn of bi.connectors) {
          const hit = gaMap.get(conn.groupAddressRefId);
          if (hit) addUsage(hit.ga.address, devRec.area.address, devRec.line.address);
        }
      }
    }

    const buildBitmaskHex = (addrs: number[]): string => {
      const mask = Buffer.alloc(8192, 0);
      for (const a of addrs) {
        const v = a & 0xffff;
        mask[v >> 3] |= 1 << (v & 7);
      }
      return mask.toString("hex").toUpperCase();
    };

    const makeEntry = (addr: number, reasons: KnxFilterTableReason[]): KnxFilterTableEntry => {
      const ga = gaByInt.get(addr);
      return {
        address: addr,
        addressFormatted: formatGroupAddressByStyle(addr, style),
        groupAddressId: ga?.id,
        name: ga?.name,
        reasons,
        sourceLines: Array.from(linesByGaInt.get(addr) ?? []).sort(),
      };
    };

    const areaCouplers: KnxCouplerFilterTable[] = [];
    const lineCouplers: KnxCouplerFilterTable[] = [];

    for (const area of inst.topology.areas) {
      // Area Coupler (A.0.0) for non-backbone areas (A >= 1)
      if (area.address > 0) {
        const areaReasons = new Map<number, Set<KnxFilterTableReason>>();
        const recordAreaReason = (addr: number, r: KnxFilterTableReason) => {
          let s = areaReasons.get(addr);
          if (!s) {
            s = new Set();
            areaReasons.set(addr, s);
          }
          s.add(r);
        };

        for (const [gaInt, areaSet] of areasByGaInt.entries()) {
          if (areaSet.has(area.address) && areaSet.size > 1) {
            recordAreaReason(gaInt, "cross-area");
          }
        }
        for (const unfInt of unfilteredInts) {
          recordAreaReason(unfInt, "unfiltered");
        }
        // Main line (L=0) additional GAs
        const mainLine = area.lines.find((l) => l.address === 0);
        if (mainLine) {
          for (const addInt of mainLine.additionalGroupAddresses) {
            recordAreaReason(addInt, "manual-additional");
          }
        }

        const sortedAddrs = Array.from(areaReasons.keys()).sort((a, b) => a - b);
        areaCouplers.push({
          couplerType: "area",
          areaAddress: area.address,
          couplerAddress: `${area.address}.0.0`,
          name: area.name || `Area ${area.address}`,
          groupAddressCount: sortedAddrs.length,
          groupAddresses: sortedAddrs.map((a) => makeEntry(a, Array.from(areaReasons.get(a)!))),
          filterTableBitmaskHex: buildBitmaskHex(sortedAddrs),
        });
      }

      // Line Couplers (A.L.0) for every secondary line (L >= 1)
      for (const line of area.lines) {
        if (line.address === 0) continue;
        const lineKey = `${area.address}.${line.address}`;
        const lineReasons = new Map<number, Set<KnxFilterTableReason>>();
        const recordLineReason = (addr: number, r: KnxFilterTableReason) => {
          let s = lineReasons.get(addr);
          if (!s) {
            s = new Set();
            lineReasons.set(addr, s);
          }
          s.add(r);
        };

        for (const [gaInt, lineSet] of linesByGaInt.entries()) {
          if (lineSet.has(lineKey) && lineSet.size > 1) {
            recordLineReason(gaInt, "cross-line");
            if ((areasByGaInt.get(gaInt)?.size ?? 0) > 1) {
              recordLineReason(gaInt, "cross-area");
            }
          }
        }
        for (const unfInt of unfilteredInts) {
          recordLineReason(unfInt, "unfiltered");
        }
        for (const addInt of line.additionalGroupAddresses) {
          recordLineReason(addInt, "manual-additional");
        }

        const sortedAddrs = Array.from(lineReasons.keys()).sort((a, b) => a - b);
        lineCouplers.push({
          couplerType: "line",
          areaAddress: area.address,
          lineAddress: line.address,
          couplerAddress: `${area.address}.${line.address}.0`,
          name: line.name || `Line ${area.address}.${line.address}`,
          groupAddressCount: sortedAddrs.length,
          groupAddresses: sortedAddrs.map((a) => makeEntry(a, Array.from(lineReasons.get(a)!))),
          filterTableBitmaskHex: buildBitmaskHex(sortedAddrs),
        });
      }
    }

    return {
      installationId: inst.installationId,
      areaCouplers,
      lineCouplers,
    };
  }

  // ---- Multiple Installations CRUD ----

  public addInstallation(input: {
    name?: string;
    installationId?: string;
    bcuKey?: string;
    ipRoutingLatencyTolerance?: number;
    ipRoutingMulticastAddress?: string;
    ipRoutingBackboneKey?: string;
    createDefaultTopology?: boolean;
  }): KnxInstallation {
    const existingIds = new Set(this.installations.map((i) => i.installationId));
    let nextId = input.installationId?.trim();
    if (!nextId) {
      let n = this.installations.length;
      while (existingIds.has(String(n))) n++;
      nextId = String(n);
    } else if (existingIds.has(nextId)) {
      throw new Error(`Installation "${nextId}" already exists`);
    }

    const inst: KnxInstallation = {
      installationId: nextId,
      name: input.name ?? "",
      bcuKey: input.bcuKey ?? "4294967295",
      defaultLine: "",
      ipRoutingLatencyTolerance: input.ipRoutingLatencyTolerance ?? 2000,
      ipRoutingMulticastAddress: input.ipRoutingMulticastAddress,
      ipRoutingBackboneKey: input.ipRoutingBackboneKey,
      topology: { areas: [], unassignedDevices: [] },
      locations: [],
      groupRanges: [],
      trades: [],
    };
    this.installations.push(inst);

    if (input.createDefaultTopology) {
      this.addArea({ address: 0, name: "Backbone area", createMainLine: true }, nextId);
      const a1 = this.addArea({ address: 1, name: "Area 1", createMainLine: true }, nextId);
      const l11 = this.addLine(a1.id, { address: 1, name: "Line 1.1", mediumTypeRefId: "MT-0" }, nextId);
      inst.defaultLine = l11.id;
    }

    this.markModified();
    return cloneJson(inst);
  }

  public updateInstallation(
    installationId: string,
    patch: Partial<
      Pick<
        KnxInstallation,
        | "name"
        | "bcuKey"
        | "defaultLine"
        | "ipRoutingLatencyTolerance"
        | "ipRoutingMulticastAddress"
        | "ipRoutingBackboneKey"
        | "ipRoutingBackboneGroup"
      >
    >,
  ): KnxInstallation {
    const inst = this.getInst(installationId);
    Object.assign(inst, patch);
    this.markModified();
    return cloneJson(inst);
  }

  public removeInstallation(installationId: string): boolean {
    if (this.installations.length <= 1) {
      throw new Error("Cannot remove the last remaining installation from a KNX project");
    }
    const idx = this.installations.findIndex((i) => i.installationId === installationId);
    if (idx === -1) return false;
    this.installations.splice(idx, 1);
    this.markModified();
    return true;
  }

  // ---- Project UserFiles & HistoryEntries CRUD ----

  public listUserFiles(): KnxProjectUserFile[] {
    return cloneJson(this.userFiles);
  }

  public addUserFile(filename: string, content: Buffer | string, comment?: string): KnxProjectUserFile {
    const safeName = filename.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!safeName || safeName.includes("..")) {
      throw new Error(`Invalid UserFile filename: "${filename}"`);
    }
    const entryPath = `${this.projectInfo.id}/UserFiles/${safeName}`;
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    this.extraArchiveEntries.set(entryPath, { kind: "buffer", buffer: buf });
    this.removedArchiveEntries.delete(entryPath);

    const existing = this.userFiles.find((u) => u.filename === safeName);
    if (existing) {
      if (comment !== undefined) existing.comment = comment;
      this.markModified();
      return cloneJson(existing);
    }
    const record: KnxProjectUserFile = { filename: safeName, comment };
    this.userFiles.push(record);
    this.markModified();
    return cloneJson(record);
  }

  public readUserFile(filename: string): Buffer {
    const safeName = filename.replace(/\\/g, "/").replace(/^\/+/, "");
    const entryPath = `${this.projectInfo.id}/UserFiles/${safeName}`;
    const buf =
      this.readArchiveEntryInternal(entryPath) ?? this.readArchiveEntryInternal(`${this.projectInfo.id}/${safeName}`);
    if (!buf) throw new Error(`UserFile "${filename}" not found in project archive`);
    return buf;
  }

  public removeUserFile(filename: string): boolean {
    const safeName = filename.replace(/\\/g, "/").replace(/^\/+/, "");
    const entryPath = `${this.projectInfo.id}/UserFiles/${safeName}`;
    const before = this.userFiles.length;
    this.userFiles = this.userFiles.filter((u) => u.filename !== safeName);
    this.extraArchiveEntries.delete(entryPath);
    this.removedArchiveEntries.add(entryPath);
    if (this.userFiles.length === before) return false;
    this.markModified();
    return true;
  }

  public getHistoryEntries(): KnxProjectHistoryEntry[] {
    return cloneJson(this.historyEntries);
  }

  public addHistoryEntry(entry: {
    text: string;
    user?: string;
    detail?: string;
    date?: string;
  }): KnxProjectHistoryEntry {
    const rec: KnxProjectHistoryEntry = {
      date: entry.date ?? nowIsoUtc(),
      user: entry.user,
      text: entry.text,
      detail: entry.detail,
    };
    this.historyEntries.push(rec);
    this.markModified();
    return cloneJson(rec);
  }

  // ============================================================================
  // Multi-Format Exporters (`.knxproj`, GA XML, GA CSV, Keyring `.knxkeys`)
  // ============================================================================

  /**
   * Serializes the project into a complete `.knxproj` ZIP archive `Buffer`.
   *
   * - Supports optional password protection (`options.password`), writing an encrypted inner `P-XXXX.zip`
   *   using either ETS6 WinZip AES-256 (`deriveEts6ZipPassword`) or ETS5 PKWARE ZipCrypto.
   * - For projects opened from ETS and modified via the API: copies all untouched manufacturer files
   *   (`M-XXXX/*`, `M-XXXX.signature`, `Baggages/*`, `knx_master.xml`) using zero-recompression raw ZIP passthrough.
   * - For projects created from scratch: writes `P-XXXX/project.xml`, `P-XXXX/0.xml`, `knx_master.xml`,
   *   and all imported `.knxprod` manufacturer folders.
   */
  public toKnxProjBuffer(options: KnxProjectExportOptions = {}): Buffer {
    const projectId = this.projectInfo.id;
    const targetSchema = options.targetSchemaVersion ?? this.metadata.schemaVersion;
    const level = options.compressionLevel ?? 6;
    const preserveProjectSignature =
      options.preserveProjectSignature ?? (!this.metadata.isModified && !options.password);

    if (options.updateLastModified ?? this.metadata.isModified) {
      this.projectInfo.lastModified = nowIsoUtc();
    }

    const writer = new ZipWriter();

    const projectXml = serializeProjectXml(
      this.metadata,
      this.projectInfo,
      this.historyEntries,
      this.userFiles,
      this.projectRawExtraChildren,
      targetSchema,
    );

    const projectPrefixLower = `${projectId.toLowerCase()}/`;
    const instFileRegex = new RegExp(`^${projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\d+\\.xml$`, "i");

    if (options.password) {
      // Password-protected export: pack all P-XXXX/* files into encrypted inner P-XXXX.zip
      const encMode =
        options.encryption && options.encryption !== "auto" ? options.encryption : targetSchema >= 21 ? "ets6" : "ets5";
      const encOpts: ZipEntryEncryptionOptions =
        encMode === "ets6"
          ? { method: "aes-256", password: deriveEts6ZipPassword(options.password) }
          : { method: "zipcrypto", password: options.password };

      const innerWriter = new ZipWriter();
      innerWriter.addText("project.xml", projectXml, { bom: true, level, encryption: encOpts });
      for (const inst of this.installations) {
        const instXml = serializeInstallationXml(this.metadata, projectId, inst, targetSchema);
        innerWriter.addText(`${inst.installationId}.xml`, instXml, { bom: true, level, encryption: encOpts });
      }

      // Include any extra project-scoped files (e.g. UserFiles) inside encrypted P-XXXX.zip
      if (this.sourceZip) {
        for (const entry of this.sourceZip.listEntries()) {
          if (entry.isDirectory) continue;
          const name = entry.fileName;
          if (!name.toLowerCase().startsWith(projectPrefixLower)) continue;
          if (this.removedArchiveEntries.has(name) || this.extraArchiveEntries.has(name)) continue;
          if (name.toLowerCase() === `${projectPrefixLower}project.xml` || instFileRegex.test(name)) continue;
          const relInner = name.slice(projectId.length + 1);
          innerWriter.addBuffer(relInner, this.sourceZip.readEntryBuffer(name), { level, encryption: encOpts });
        }
      }
      for (const [entryName, src] of this.extraArchiveEntries.entries()) {
        if (this.removedArchiveEntries.has(entryName)) continue;
        if (!entryName.toLowerCase().startsWith(projectPrefixLower)) continue;
        const relInner = entryName.slice(projectId.length + 1);
        const buf = src.kind === "buffer" ? src.buffer : src.reader.readEntryBuffer(src.sourceName);
        innerWriter.addBuffer(relInner, buf, { level, encryption: encOpts });
      }

      // ETS stores inner P-XXXX.zip uncompressed (Store) in the outer archive
      writer.addBuffer(`${projectId}.zip`, innerWriter.toBuffer(), { compress: false });
    } else {
      // Unencrypted export: write P-XXXX/project.xml and P-XXXX/<N>.xml directly
      writer.addText(`${projectId}/project.xml`, projectXml, { bom: true, level });
      for (const inst of this.installations) {
        const instXml = serializeInstallationXml(this.metadata, projectId, inst, targetSchema);
        writer.addText(`${projectId}/${inst.installationId}.xml`, instXml, { bom: true, level });
      }
    }

    // 2. Pass through untouched entries from sourceZip (fast raw compressed copy!)
    const skippedProjectSigNames = new Set([`${projectId}.signature`, `${projectId}.certificate`, `.validation`]);

    if (this.sourceZip) {
      for (const entry of this.sourceZip.listEntries()) {
        const name = entry.fileName;
        if (entry.isDirectory) continue;
        if (this.removedArchiveEntries.has(name)) continue;
        if (this.extraArchiveEntries.has(name)) continue;
        if (writer.hasEntry(name)) continue;
        // Skip original project/installation XMLs (already regenerated above)
        if (name.toLowerCase() === `${projectPrefixLower}project.xml`) continue;
        if (instFileRegex.test(name)) continue;
        // If encrypting into P-XXXX.zip, skip all P-XXXX/* files (already moved into inner P-XXXX.zip)
        if (options.password && name.toLowerCase().startsWith(projectPrefixLower)) continue;
        if (name.toLowerCase() === `${projectId.toLowerCase()}.zip`) continue;
        // Drop stale project signature/certificate/.validation when modified unless explicitly preserved
        if (!preserveProjectSignature && skippedProjectSigNames.has(name)) continue;

        writer.copyEntryFrom(this.sourceZip, name);
      }
    }

    // 3. Write all added/overridden entries (imported .knxprod catalogs, merged Hardware/Catalog XMLs, UserFiles, etc.)
    for (const [entryName, src] of this.extraArchiveEntries.entries()) {
      if (this.removedArchiveEntries.has(entryName)) continue;
      if (options.password && entryName.toLowerCase().startsWith(projectPrefixLower)) continue;
      if (writer.hasEntry(entryName)) continue;
      if (src.kind === "buffer") {
        writer.addBuffer(entryName, src.buffer, { level });
      } else {
        writer.copyEntryFrom(src.reader, src.sourceName, entryName);
      }
    }

    // 4. Ensure `knx_master.xml` is always present
    if (!writer.hasEntry("knx_master.xml")) {
      const minimalMaster = serializeMinimalKnxMasterXml(this.masterData, targetSchema);
      writer.addText("knx_master.xml", minimalMaster, { bom: true, level });
    }

    return writer.toBuffer();
  }

  /**
   * Exports and saves the project as a `.knxproj` file on disk.
   */
  public saveKnxProj(filePath: string, options: KnxProjectExportOptions = {}): void {
    const dir = path.dirname(filePath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, this.toKnxProjBuffer(options));
  }

  /**
   * Exports all Group Ranges & Group Addresses in official ETS Group Address XML format
   * (`http://knx.org/xml/ga-export/01`), directly importable into ETS4/ETS5/ETS6.
   */
  public exportGroupAddressesXml(installationId?: string): string {
    const inst = this.getInst(installationId);
    return serializeGroupAddressesExportXml(inst.groupRanges, this.projectInfo.groupAddressStyle);
  }

  /**
   * Exports all Group Addresses in ETS-compatible CSV format.
   */
  public exportGroupAddressesCsv(options: GroupAddressCsvExportOptions & { installationId?: string } = {}): string {
    const inst = this.getInst(options.installationId);
    return serializeGroupAddressesCsv(inst.groupRanges, this.projectInfo.groupAddressStyle, options);
  }

  /**
   * Builds a `KnxKeyring` instance from the project's Backbone Key, Secure Group Address keys,
   * and Device security credentials (which can then be saved as `.knxkeys` with `keyring.saveFile(path, password)`).
   */
  public exportKeyring(options: { installationId?: string; generateMissingGroupKeys?: boolean } = {}): KnxKeyring {
    const inst = this.getInst(options.installationId);
    const keyring = KnxKeyring.create({
      project: this.projectInfo.name,
      createdBy: "KNX.ts",
    });

    if (inst.ipRoutingBackboneKey || inst.ipRoutingMulticastAddress) {
      keyring.setBackbone({
        key: inst.ipRoutingBackboneKey ? Buffer.from(inst.ipRoutingBackboneKey, "base64") : "generate",
        multicastAddress: inst.ipRoutingMulticastAddress ?? "224.0.23.12",
        latency: inst.ipRoutingLatencyTolerance ?? 2000,
      });
    }

    for (const rec of this.iterAllGroupAddresses(inst.installationId)) {
      const addrStr = formatGroupAddressByStyle(rec.ga.address, "ThreeLevel");
      if (rec.ga.key) {
        try {
          const buf = parseKey16(rec.ga.key, `GA ${addrStr} key`);
          keyring.setGroupKey(addrStr, buf);
          continue;
        } catch {
          // ignore malformed key
        }
      }
      if (options.generateMissingGroupKeys && rec.ga.security === "On") {
        keyring.setGroupKey(addrStr);
      }
    }

    for (const rec of this.iterAllDevices(inst.installationId)) {
      const ia = this.computeIndividualAddress(rec);
      const sec = rec.device.security;
      if (!ia || !sec) continue;
      let toolKeyBuf: Buffer | undefined;
      if (sec.toolKey) {
        try {
          toolKeyBuf = parseKey16(sec.toolKey, `Device ${ia} toolKey`);
        } catch {
          // ignore malformed key
        }
      }
      if (toolKeyBuf || sec.deviceManagementPassword || sec.deviceAuthenticationCode) {
        keyring.setDevice({
          individualAddress: ia,
          toolKey: toolKeyBuf,
          managementPassword: sec.deviceManagementPassword,
          authentication: sec.deviceAuthenticationCode,
          sequenceNumber: sec.sequenceNumber ? BigInt(sec.sequenceNumber) : undefined,
          serialNumber: rec.device.serialNumberHex,
        });
      }
    }

    return keyring;
  }

  // ============================================================================
  // Commissioning Orchestrator, Bus Comparison & Typed Live Runtime Bridge
  // ============================================================================

  /**
   * Updates device download flags, `serialNumberHex`, `lastDownload`, `loadedImage` snapshot,
   * and security metadata after a physical bus download. Marks the project as modified.
   */
  public recordDeviceCommissioningResult(
    idOrIa: string,
    patch: RecordDeviceCommissioningPatch,
    installationId?: string,
  ): void {
    const rec = this.requireDeviceRecord(idOrIa, installationId);
    const dev = rec.device;

    if (patch.applicationProgramLoaded !== undefined) dev.applicationProgramLoaded = patch.applicationProgramLoaded;
    if (patch.parametersLoaded !== undefined) dev.parametersLoaded = patch.parametersLoaded;
    if (patch.communicationPartLoaded !== undefined) dev.communicationPartLoaded = patch.communicationPartLoaded;
    if (patch.individualAddressLoaded !== undefined) dev.individualAddressLoaded = patch.individualAddressLoaded;
    if (patch.mediumConfigLoaded !== undefined) dev.mediumConfigLoaded = patch.mediumConfigLoaded;
    if (patch.lastDownload !== undefined) dev.lastDownload = patch.lastDownload;
    if (patch.lastUsedApduLength !== undefined) dev.lastUsedApduLength = patch.lastUsedApduLength;
    if (patch.readMaxApduLength !== undefined) dev.readMaxApduLength = patch.readMaxApduLength;

    if (patch.serialNumberHex) {
      try {
        dev.serialNumber = encodeKnxSerialNumberBase64(patch.serialNumberHex);
        dev.serialNumberHex = decodeKnxSerialNumberHex(dev.serialNumber);
      } catch {
        // Ignore non-6-byte serial strings
      }
    }

    if (patch.loadedImage === null) {
      dev.loadedImage = undefined;
    } else if (patch.loadedImage !== undefined) {
      dev.loadedImage = patch.loadedImage;
    }

    if (patch.securityPatch) {
      dev.security = { ...(dev.security ?? {}), ...patch.securityPatch };
    }

    dev.lastModified = nowIsoUtc();
    this.markModified();
  }

  /**
   * Computes the sorted list of partner Individual Addresses for a device's `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`
   * from project Group Address links, BusInterface tunneling connectors, and optional Keyring / extra gateway IAs.
   */
  public computeDeviceAuthorizedSenders(
    idOrIa: string,
    options: ComputeAuthorizedSendersOptions = {},
  ): ComputedAuthorizedSendersResult {
    return computeProjectDeviceAuthorizedSenders(this, idOrIa, options);
  }

  /**
   * Reads live ETS "Device Info" diagnostics from a physical device on the bus and compares them
   * against this project's model (`serialNumber`, `manufacturerId`, `applicationProgram`, `loadStates`,
   * `groupAddresses`, `ipConfig`, `security`).
   */
  public async compareDeviceWithBus(
    idOrIa: string,
    programmerOrMgmt: KNXDeviceProgrammer | KNXManagement,
    options: KnxDeviceBusComparisonOptions = {},
  ): Promise<KnxDeviceBusComparisonResult> {
    return compareProjectDeviceWithBus(this, idOrIa, programmerOrMgmt, options);
  }

  /**
   * Commissions a single project device onto the physical KNX bus (opening its session, injecting coupler
   * filter tables & Data Secure `authorizedSenders`/keys, performing differential delta writes from
   * `LoadedImage` when applicable, optionally programming Object Type 11 IP config, and updating project loaded flags).
   */
  public async programDevice(
    idOrIa: string,
    programmer: KNXDeviceProgrammer,
    options: KnxProjectProgramDeviceOptions = {},
  ): Promise<KnxProjectProgramDeviceResult> {
    return programProjectDevice(this, idOrIa, programmer, options);
  }

  /**
   * Batch-commissions devices in this project in proper KNX topological order:
   * Area Couplers (`A.0.0`) -> Line Couplers / IP Routers (`A.L.0`) -> End devices (`A.L.D`).
   */
  public async programAll(
    programmer: KNXDeviceProgrammer,
    options: KnxBatchProgramOptions = {},
  ): Promise<KnxBatchProgramResult> {
    return programProjectAll(this, programmer, options);
  }

  /**
   * Creates a live typed `KnxProjectRuntime` bound to any `KNXService`, automatically decoding
   * incoming group telegrams with project DPTs, enriching with space/device metadata, and offering
   * typed `write()`, `respond()`, `read()`, and JSON-serializable `getSnapshot()`.
   */
  public createRuntime(service: KNXService, options: KnxProjectRuntimeOptions = {}): KnxProjectRuntime {
    return new KnxProjectRuntime(this, service, options);
  }
}
