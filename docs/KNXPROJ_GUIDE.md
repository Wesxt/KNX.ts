# KNX Project (`.knxproj`) Complete Guide — Read, Create, Edit, Export & Web Integration

> Versión en español: ver [KNXPROJ_GUIDE_ES.md](./KNXPROJ_GUIDE_ES.md)

`knx.ts` provides a zero-external-dependency, 100% JSON-serializable API (`KnxProject`, `ZipReader`, `ZipWriter`) to **read, inspect, create, modify, validate, and export `.knxproj` projects** (ETS4 / ETS5 / ETS6), natively connected with `DeviceConfigSession`, `KNXDeviceProgrammer`, and `KnxKeyring`.

> **Important note on manufacturer catalogs (`.knxprod` and `knx_master.xml`)**:
> `knx.ts` **does not bundle or distribute proprietary manufacturer catalogs** (`.knxprod`) or a full proprietary `knx_master.xml`. When working with new projects or device programming, **the user / application must supply the manufacturers' `.knxprod` files** (either by embedding them into the project via `importKnxProd()` or resolving them on demand from your own catalog store via `registerCatalogProvider()` or `{ externalKnxProd }`).

---

## 1. Architecture & Performance on Large Projects

A `.knxproj` file is a ZIP archive containing:

- `P-XXXX/project.xml` — Metadata (`ProjectInformation`, GA style, `Guid`, `LastUsedPuid`, `HistoryEntries`, `UserFiles`).
- `P-XXXX/0.xml` (or `P-XXXX.zip` encrypted with ZipCrypto in ETS5 or WinZip AES-256 + PBKDF2 in ETS6, plus `1.xml`, `2.xml` in multi-installation projects) — Topology (`Area` → `Line` → `Segment` → `DeviceInstance`), `ParameterInstanceRefs`, `ComObjectInstanceRefs`, `ModuleInstances`, `GroupObjectTree`, `BusInterfaces`, `AdditionalAddresses`, `AdditionalGroupAddresses`, `IPConfig`, `Security`, `Locations`/`Space`/`Function`, `GroupRanges`/`GroupAddress`, and `Trades`.
- `knx_master.xml` — DPTs/subtypes, mediums, manufacturers, space usages, functions, and `MaskVersions` (`HawkConfigurationData`).
- `M-XXXX/Hardware.xml`, `Catalog.xml`, `Baggages.xml`, `M-XXXX/Baggages/**`, and `M-XXXX/M-XXXX_A-*.xml` — Embedded manufacturer catalogs (can exceed 350+ MB uncompressed).

### Performance & Lossless Preservation

1. **Lazy loading of `M-XXXX_A-*.xml`**: `KnxProject.fromFile()` / `fromBuffer()` reads `project.xml`, `0.xml`, `knx_master.xml`, `Hardware.xml`, `Catalog.xml`, and `Baggages.xml` in milliseconds without parsing huge application XMLs until they are actually needed (`loadApplicationProgram()`, `getDeviceDetails(..., { resolveCatalog: true })`, or `openDeviceSession()`).
2. **Zero-recompression passthrough export**: When modifying and re-exporting an ETS `.knxproj`, `ZipWriter.copyEntryFrom()` copies the compressed blocks of `M-XXXX/*`, `Baggages/*`, and `knx_master.xml` directly without decompressing or recompressing them.
3. **Lossless round-trip**: Extra attributes and advanced sections (`LoadedImage`, `CheckSums`, `ModuleInstances`, `GroupObjectTree`, `BusInterfaces`, `AdditionalGroupAddresses`, `SplitInfos`, etc.) are preserved intact.

---

## 2. Real-World Limits & Importing Back into ETS5 / ETS6 (Read Before Production)

It is important to distinguish clearly between what you can do with this API and the restrictions imposed by ETS:

### A. Importing a Created or Modified `.knxproj` Back into Commercial ETS5 / ETS6

- **ETS cryptographic signatures**: Commercial ETS5 and ETS6 sign the project directory (`P-XXXX.signature` + `P-XXXX.certificate`) using the private key of the user's official ETS license, and sign each manufacturer folder (`M-XXXX.signature`) with KNX Association's key. **No external tool can generate or forge these private signatures.**
- **Practical consequence**:
  - A `.knxproj` **created from scratch or modified** with `KnxProject` conforms to the official KNX XML schema (`http://knx.org/xml/project/20`–`23`), strips stale project signatures (`P-XXXX.signature`/`.validation`), and preserves untouched manufacturer `M-XXXX.signature` files.
  - It is **100% usable** by `KNX.ts`, your own web app, `xknxproject`/Home Assistant, SCADA/BMS platforms, and any compatible software.
  - **However, commercial ETS5/ETS6 will reject direct import of a `.knxproj` created or edited outside ETS** when it detects a missing or mismatched project signature.
- **What ETS5 / ETS6 DOES import directly without a project signature**:
  - **Group Addresses XML** (`project.exportGroupAddressesXml()`, official schema `http://knx.org/xml/ga-export/01`).
  - **Group Addresses CSV** (`project.exportGroupAddressesCsv()`).
  - **KNX Secure Keyring** (`project.exportKeyring().saveFile("keys.knxkeys", password)`).

### B. User-Supplied Catalogs & `knx_master.xml`

- If you create a project without importing any `.knxprod` or calling `setMasterXml()`, `KnxProject` generates a minimal `knx_master.xml` containing the primary DPTs and manufacturers, but **without `MaskVersions`** (`hasOfficialMaskVersions() === false`).
- To parameterize or program real devices, the user must supply:
  1. The manufacturer `.knxprod` files (via `importKnxProd()`, `registerCatalogProvider()`, or `{ externalKnxProd }`).
  2. An official `knx_master.xml` (automatically adopted when importing any `.knxprod`, or manually via `project.setMasterXml(pathOrXml)`).

### C. Technical & Physical Bus Programming Limits

- **KNX standard limits**: Areas `0..15`, Lines `0..15`, Devices per line `0..255`, Group Addresses `1..65535` (`0/0/0` reserved).
- **Node.js memory**: `ZipReader` / `ZipWriter` operate on in-memory `Buffer`s (they support ZIP64; plenty of headroom for real-world 5–200 MB compressed `.knxproj` files, bounded by Node.js's ~2 GB `Buffer` ceiling).
- **Physical bus download (`KNXDeviceProgrammer`)**: The multi-architecture compiler (`SystemBCompiler` / `KNXApplicationCompiler`) supports **System B (`MV-07B0`, `17B0`, `27B0`, `2920`, `57B0`)**, **System 7 / BIM M112 (`MV-0700`, `0701`, `0705`, `1900`, `2705`, `5705`)**, **System 2 / BCU2 (`MV-0020`, `0021`, `0025`)**, **System 1 / BCU1 & couplers (`MV-0010`–`0013`, `091A`, `0912`)**, and **System 300 (`MV-0300` PropertyBased)**. In addition, opening a session on a Line/Area Coupler (`openDeviceSession("1.1.0")`) automatically attaches its filter table computed by `computeFilterTables()`.
- **Proprietary ETS binary plugins (DCA)**: Devices relying on *Device Configuration Apps* (`.dll` `.NET`/Windows binaries, `EtsDownloadPlugin`, `EtsDataHandler`, `RequiresExternalSoftware="true"`, or `DownloadInfoIncomplete="true"`) **still require ETS for physical bus downloads** because their binary generation logic is not described in XML. `knx.ts` detects them automatically (`summary.requiresDca === true`, `REQUIRES_ETS_DCA` error in `validate()`), blocks unsafe downloads in `KNXDeviceProgrammer`, and preserves their `<AddInData>`, `Baggages`, and `LoadedImage` intact inside `.knxproj`.

---

## 3. Core `KnxProject` API Operations

### 3.1 Reading & Inspecting (Open or Password-Protected Projects)

```ts
import { KnxProject } from "knx.ts";

// Supports unencrypted .knxproj, ETS5 (ZipCrypto), and ETS6 (WinZip AES-256 + PBKDF2)
const project = KnxProject.fromFile("Project.knxproj", {
  language: "en-US",
  // password: "ETSPassword", // only if password-protected
});

const summary = project.getSummary();
const devices = project.getDevices({ area: 1, line: 1, search: "Zennio" });
const details = await project.getDeviceDetails("1.1.1", { resolveCatalog: true, language: "en-US" });
const gaLinks = project.getGroupAddressLinks("1/0/1"); // reverse lookup
const matrix = project.getCommunicationMatrix({ linkedOnly: true });
const search = project.search("Lighting", { limit: 30 });
```

### 3.2 Creating from Scratch with User-Supplied Catalogs

```ts
import { KnxProject } from "knx.ts";

const project = KnxProject.create({
  name: "Central Building",
  groupAddressStyle: "ThreeLevel",
  schemaVersion: 20, // or 21/22/23 for ETS6
  // masterXml: "/path/knx_master.xml", // optional: automatically adopted from the first .knxprod
});

// Option A: embed the .knxprod inside the .knxproj (self-contained)
const imp = project.importKnxProd("/user_catalogs/MAXinBOX_66_v3.knxprod", {
  language: "en-US",
  embedApplicationXml: true, // set false if your backend serves .knxprod catalogs externally
});

// Option B: register an external provider for lightweight projects without embedding 60 MB per device
project.registerCatalogProvider(async (applicationId, { language }) => {
  const filePath = `/catalog_store/${applicationId}.knxprod`;
  return filePath; // may return a file path, Buffer, ParsedKnxProd, or KnxApplicationProgram
});

const prod = project.listCatalogProducts(imp.manufacturerId)[0];
const bldg = project.addSpace({ type: "Building", name: "Central Building" });
const room = project.addSpace({ type: "Room", name: "Distribution Board F1", parentSpaceId: bldg.id });

project.addMainGroup(1, "Lighting");
project.addMiddleGroup(1, 0, "Floor 1");
project.addGroupAddress({ address: "1/0/1", name: "Office 1 Light", datapointType: "1.001" });

const dev = project.addDevice("1.1", {
  address: "auto",
  name: "Actuator 1",
  productRefId: prod.productRefId,
  hardware2ProgramRefId: prod.hardware2ProgramRefIds[0],
  spaceId: room.id,
});
```

### 3.3 Full Bridge with `DeviceConfigSession` (Including `ModuleInstances` and `GroupObjectTree`)

```ts
// Open interactive session (supports embedded catalogs, external provider, or { externalKnxProd })
const session = await project.openDeviceSession("1.1.1", {
  language: "en-US",
  // externalKnxProd: "/user_catalogs/my_device.knxprod", // optional if not embedded
});

// Edit parameters (including parameters inside <ModuleDef>/<Repeat>) and link ComObjects
session.setParameters({ bOutput: 1, "outputCh[0].type": 1, "indOutput[0].bEnabled": 1 });
session.linkGroupObject(765, { sending: "1/0/1" });

// Apply changes back to the project:
// - Updates ParameterInstanceRefs (including ETS IDs MD-x_M-y_MI-z_P-...)
// - Updates ComObjectInstanceRefs and group links
// - Synchronizes <ModuleInstances> and regenerates <GroupObjectTree>
project.applyDeviceSession("1.1.1", session, {
  autoCreateGroupAddresses: true,
  regenerateGroupObjectTree: true,
  syncModuleInstances: true,
});
```

### 3.4 Automatic Filter Tables, `BusInterfaces`, `AdditionalGroupAddresses`, `UserFiles` & Multi-Installation

```ts
// 1. Couplers and automatic filter tables (cross-line/cross-area + unfiltered + manual entries)
project.addLineAdditionalGroupAddress("1.1", "5/0/1");
const filters = project.computeFilterTables();
// filters.lineCouplers[0] -> { couplerAddress: "1.1.0", groupAddresses: [...], filterTableBitmaskHex: "..." }
// filters.areaCouplers[0] -> { couplerAddress: "1.0.0", groupAddresses: [...], filterTableBitmaskHex: "..." }

// 2. BusInterfaces (IP tunneling channels) and gateway additional addresses
project.setDeviceBusInterface("1.1.1", {
  refId: "M-0071_H-IP-1_BI-1",
  name: "Tunnel 1",
  connectors: ["1/0/1"],
});
project.addDeviceAdditionalAddress("1.1.1", { address: 240, name: "Tunnel 1 (1.1.240)" });

// 3. Multiple installations, UserFiles, and history
project.addInstallation({ name: "Annex Building", createDefaultTopology: true });
project.addUserFile("floor1_plan.pdf", pdfBuffer, "Electrical floor plan");
project.addHistoryEntry({ user: "admin", text: "Initial lighting review" });
```

### 3.5 Exporting (Plain, ETS5/ETS6 Password-Protected, GA XML, CSV, Keyring & JSON)

```ts
// 1. Unencrypted .knxproj
project.saveKnxProj("out/project.knxproj");

// 2. Password-protected .knxproj (ETS6 AES-256 or ETS5 ZipCrypto)
project.saveKnxProj("out/project_secure.knxproj", {
  password: "MySecurePassword",
  encryption: "ets6", // "ets6" | "ets5" | "auto"
});

// 3. Formats directly importable into ETS4/ETS5/ETS6 without a project signature
const gaXml = project.exportGroupAddressesXml();
const gaCsv = project.exportGroupAddressesCsv({ separator: ";" });
const keyring = project.exportKeyring({ generateMissingGroupKeys: true });
keyring.saveFile("out/project.knxkeys", "KeyringPassword");

// 4. JSON persistence in a database
const snapshot = project.toJSON();
const restored = KnxProject.fromJSON(snapshot);
```

---

## 4. Step-by-Step Guide: Backend and Frontend Integration (Web App)

### Recommended Architecture

```text
┌─────────────────────────────┐         HTTPS / JSON / Binary          ┌───────────────────────────────────────┐
│   Web Frontend              │ ◄────────────────────────────────────► │   Backend (Node.js / Express / Fastify)│
│   (React / Vue / Angular)   │                                        │                                       │
│                             │  • GET  /projects/:id/summary          │  1. User-supplied .knxprod catalog    │
│  • Topology Explorer        │  • GET  /projects/:id/devices          │     repository (S3 / local disk)      │
│  • Buildings / GA Tree      │  • GET  /projects/:id/group-addresses  │  2. Active KnxProject instances +     │
│  • Generic Dynamic Editor   │  • POST /projects/:id/devices/:ia/edit │     ParsedKnxProd cache               │
│    (renders DeviceUiState)  │  • GET  /projects/:id/filter-tables    │  3. DB (stores JSON snapshots or      │
│  • Export .knxproj Button   │  • GET  /projects/:id/export/knxproj   │     .knxproj storage paths)           │
└─────────────────────────────┘                                        └──────────────────┬────────────────────┘
                                                                                          │ (Optional)
                                                                                          ▼
                                                                           KNXDeviceProgrammer / KNX Bus
```

> **Key design principle**: The browser must **never** parse 60 MB XMLs or 25 MB `.knxproj` archives. All heavy work (`KnxProject`, `KnxProdParser`, `DeviceConfigSession`, `ZipWriter`) lives in the **Node.js Backend**, and the **Frontend** only consumes and edits lightweight JSON DTOs.

---

### Step 1 (Backend): User-Supplied `.knxprod` Catalog Repository

Your backend should let users upload their own `.knxprod` files (and optionally a `knx_master.xml`) and maintain an index `{ applicationId -> filePath }`:

```ts
import fs from "node:fs";
import path from "node:path";
import { KnxProdParser, KnxProject, ParsedKnxProd, ZipReader } from "knx.ts";

// Simple in-memory index for your backend (in production, persist in PostgreSQL / MongoDB / Redis)
const catalogFileByAppId = new Map<string, string>();
const parsedCatalogCache = new Map<string, ParsedKnxProd>();

// When a user uploads a .knxprod file to your backend:
export function indexUploadedKnxProd(filePath: string) {
  const zip = ZipReader.fromFile(filePath);
  const appIds: string[] = [];
  for (const entry of zip.listEntries()) {
    const m = /M-[0-9A-Fa-f]{4}\/(M-[0-9A-Fa-f]{4}_A-[^/]+)\.xml$/i.exec(entry.fileName);
    if (m) {
      catalogFileByAppId.set(m[1], filePath);
      appIds.push(m[1]);
    }
  }
  return { filePath, appIds };
}

// Attach the external catalog provider to any KnxProject you open or create:
export function attachUserCatalogProvider(project: KnxProject) {
  project.registerCatalogProvider(async (applicationId, opts) => {
    const filePath = catalogFileByAppId.get(applicationId);
    if (!filePath || !fs.existsSync(filePath)) return undefined;

    const cacheKey = `${applicationId}::${opts?.language ?? ""}`;
    let parsed = parsedCatalogCache.get(cacheKey);
    if (!parsed) {
      parsed = await KnxProdParser.parseFile(filePath, {
        applicationId,
        language: opts?.language,
      });
      parsedCatalogCache.set(cacheKey, parsed);
    }
    return parsed;
  });
}
```

---

### Step 2 (Backend): Project Session Service & REST Endpoints (Express Example)

```ts
import express from "express";
import { DeviceConfigSession, KnxProject } from "knx.ts";
import { attachUserCatalogProvider } from "./catalogStore";

const app = express();
app.use(express.json({ limit: "10mb" }));

const activeProjects = new Map<string, KnxProject>();
const activeDeviceSessions = new Map<string, { projectId: string; deviceKey: string; session: DeviceConfigSession }>();

// 1. Open a user-uploaded .knxproj (or restore it from storage)
app.post("/api/projects/open", express.raw({ type: "application/octet-stream", limit: "100mb" }), (req, res) => {
  const password = req.header("x-knx-password") || undefined;
  const language = req.header("x-knx-language") || "en-US";
  const project = KnxProject.fromBuffer(req.body as Buffer, { password, language });
  attachUserCatalogProvider(project);

  const id = crypto.randomUUID();
  activeProjects.set(id, project);
  res.status(201).json({ id, summary: project.getSummary() });
});

// 2. Create a project from scratch
app.post("/api/projects", (req, res) => {
  const { name, groupAddressStyle, comment } = req.body;
  const project = KnxProject.create({ name, groupAddressStyle, comment });
  attachUserCatalogProvider(project);

  const id = crypto.randomUUID();
  activeProjects.set(id, project);
  res.status(201).json({ id, summary: project.getSummary() });
});

// 3. Lightweight queries for the Frontend
app.get("/api/projects/:id/topology", (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  res.json({ areas: p.getAreas(), lines: p.getLines() });
});

app.get("/api/projects/:id/devices", (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  res.json({ devices: p.getDevices({ search: req.query.q as string }) });
});

app.get("/api/projects/:id/group-addresses", (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  res.json({
    ranges: p.getGroupRanges(),
    groupAddresses: p.getGroupAddresses({ search: req.query.q as string }),
  });
});

app.get("/api/projects/:id/filter-tables", (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  res.json(p.computeFilterTables());
});

// 4. Import a user-supplied .knxprod into the project
app.post("/api/projects/:id/import-knxprod", express.raw({ type: "application/octet-stream", limit: "100mb" }), (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  const embedApplicationXml = req.query.embed !== "false";
  const result = p.importKnxProd(req.body as Buffer, {
    language: (req.query.language as string) || "en-US",
    embedApplicationXml,
  });
  res.json(result);
});

// 5. Open interactive parameter editor for a device (DeviceConfigSession)
app.post("/api/projects/:id/devices/:ia/session", async (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  const session = await p.openDeviceSession(req.params.ia, { language: req.body?.language ?? "en-US" });
  const sid = crypto.randomUUID();
  activeDeviceSessions.set(sid, { projectId: req.params.id, deviceKey: req.params.ia, session });
  res.status(201).json({ sessionId: sid, uiState: session.getUiState() });
});

// Edit parameter live and return diff + updated UI tree
app.patch("/api/device-sessions/:sid/parameters", (req, res) => {
  const entry = activeDeviceSessions.get(req.params.sid)!;
  const diff = entry.session.setParameter(req.body.key, req.body.value);
  res.json(diff);
});

// Save session changes back to the KnxProject
app.post("/api/device-sessions/:sid/apply", (req, res) => {
  const entry = activeDeviceSessions.get(req.params.sid)!;
  const p = activeProjects.get(entry.projectId)!;
  const result = p.applyDeviceSession(entry.deviceKey, entry.session, { autoCreateGroupAddresses: true });
  res.json(result);
});

// 6. Export .knxproj (with optional password) or Group Addresses XML
app.post("/api/projects/:id/export/knxproj", (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  const buf = p.toKnxProjBuffer({
    password: req.body?.password,
    encryption: req.body?.encryption ?? "auto",
  });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${p.getProjectInfo().name}.knxproj"`);
  res.send(buf);
});

app.get("/api/projects/:id/export/ga-xml", (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  res.type("application/xml").send(p.exportGroupAddressesXml());
});
```

---

### Step 3 (Frontend): Consuming from React / Vue / TypeScript

The Frontend never hardcodes manufacturer parameters or schemas; it consumes JSON endpoints and downloads binaries:

```ts
// 1. Upload a user's .knxproj (with optional password)
async function uploadKnxProj(file: File, password?: string) {
  const res = await fetch("/api/projects/open", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Knx-Language": "en-US",
      ...(password ? { "X-Knx-Password": password } : {}),
    },
    body: await file.arrayBuffer(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { id, summary: { projectInfo, stats, manufacturers } }
}

// 2. Open dynamic editor for a project device (e.g. "1.1.1")
async function openDeviceEditor(projectId: string, ia: string) {
  const res = await fetch(`/api/projects/${projectId}/devices/${encodeURIComponent(ia)}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "en-US" }),
  });
  return res.json(); // { sessionId, uiState: { channels, comObjects, stats } }
  // Render uiState.channels -> blocks -> items using generic widgets (select, checkbox, number, text)
  // See docs/PROGRAMMING_GUIDE.md §2 for the complete DeviceUiState widget map.
}

// 3. Edit a parameter and update the UI live
async function onParameterChange(sessionId: string, paramRefId: string, value: string | number | boolean) {
  const res = await fetch(`/api/device-sessions/${sessionId}/parameters`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: paramRefId, value }),
  });
  const diff = await res.json(); // { changed, addedParameters, removedParameters, addedComObjects, state }
  return diff.state; // replaces the editor's UI state
}

// 4. Save device changes back to the project and download the modified .knxproj
async function saveAndDownloadKnxProj(projectId: string, sessionId: string, password?: string) {
  await fetch(`/api/device-sessions/${sessionId}/apply`, { method: "POST" });

  const res = await fetch(`/api/projects/${projectId}/export/knxproj`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(password ? { password, encryption: "ets6" } : {}),
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modified_project.knxproj";
  a.click();
  URL.revokeObjectURL(url);
}
```

### Step 4: Recommended Production Persistence

- **Small projects or active drafts**: Save `project.toJSON()` in your database and restore with `KnxProject.fromJSON(doc)` (re-attaching `attachUserCatalogProvider(project)` on restore to maintain access to the user's `.knxprod` catalogs).
- **Full ETS projects (with `LoadedImage`, `Baggages`, and `M-XXXX/*`)**: Store the binary `.knxproj` file in Object Storage (S3 / MinIO / disk) and keep only the summary/index in your database; when opening an editing session, load `KnxProject.fromBuffer(s3Buffer)`, apply modifications, and write `project.toKnxProjBuffer()` back to storage.

---

## 5. Commissioning Orchestrator, Bus Comparison, Baggages & Typed Live Runtime

### 5.1 Single-Device & Topological Batch Commissioning (`programDevice` & `programAll`)

`KnxProject` orchestrates end-to-end physical bus commissioning directly from the project model:

- Automatically computes **`PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`** (`computeDeviceAuthorizedSenders()`) from peer links on shared Group Addresses, `BusInterfaces` tunneling gateways (including `AdditionalAddresses`), optional `.knxkeys` keyrings, and extra gateway IAs.
- Automatically stores a compressed KNX.ts **`LoadedImage`** snapshot on each programmed `DeviceInstance` so subsequent `mode: "par"` or `mode: "par,grp"` downloads perform **byte-level differential delta writes** (writing only changed bytes; native opaque ETS `LoadedImage` blobs are gracefully ignored).
- Automatically updates `applicationProgramLoaded`, `parametersLoaded`, `communicationPartLoaded`, `individualAddressLoaded`, `mediumConfigLoaded`, `serialNumberHex`, `lastDownload`, and `security` fields back onto the project.
- `programAll()` sorts devices in strict **KNX topological order** (Area Couplers `A.0.0` → Line Couplers / IP Routers `A.L.0` → Main-line devices → Line end-devices `A.L.D`), automatically skipping unassigned devices, already-loaded devices (`onlyModified: true`), and proprietary ETS DCA devices (`skipDca: true`).

```ts
import { KnxProject, KNXTunneling, KNXDeviceProgrammer } from "knx.ts";

const project = KnxProject.fromFile("Building.knxproj");
const tunnel = new KNXTunneling({ ip: "192.168.1.100", port: 3671 });
await tunnel.connect();
const programmer = new KNXDeviceProgrammer(tunnel);

// 1. Inspect auto-computed Data Secure authorized senders for a device
const senders = project.computeDeviceAuthorizedSenders("1.1.1", { extraSenders: ["1.1.250"] });
console.log("Authorized senders for 1.1.1:", senders.authorizedSenders);

// 2. Commission a single device (optional Object Type 11 IP config & FDSK commissioning supported)
const single = await project.programDevice("1.1.1", programmer, {
  mode: "ap1",
  extraAuthorizedSenders: ["1.1.250"],
  // programIpConfig: true, // for KNXnet/IP interfaces & routers (Object Type 11)
});
console.log("Programmed 1.1.1:", single.download.bytesWritten, "bytes");

// 3. After modifying 1 parameter, run a fast differential delta download
project.setDeviceParameter("1.1.1", "M-0071_A-49B1-21-F03B_P-1_R-4", "1");
const delta = await project.programDevice("1.1.1", programmer, { mode: "par" });
console.log("Delta used:", delta.usedDifferentialSnapshot, "bytes:", delta.download.bytesWritten);

// 4. Batch-commission the entire installation in topological order (Couplers first -> End devices)
const batch = await project.programAll(programmer, {
  onlyModified: true,
  skipDca: true,
  onDeviceComplete: (out) => console.log(`${out.individualAddress} [${out.role}]: ${out.status}`),
});
console.log(`Done: ${batch.programmedCount} programmed, ${batch.skippedCount} skipped, ${batch.failedCount} failed`);
```

### 5.2 Bus vs. Project Comparison (`compareDeviceWithBus`)

Compare any physical KNX device against its `.knxproj` definition (`serialNumber`, `manufacturerId`, `applicationProgram`, `loadStates`, `groupAddresses` missing/extra diff, `ipConfig`, and `security`):

```ts
const cmp = await project.compareDeviceWithBus("1.1.1", programmer);
console.log("In sync:", cmp.inSync);
console.log("Differences:", cmp.differences);
console.log("Missing GAs on device:", cmp.groupAddressDiff?.missingOnDevice);
console.log("Extra GAs on device:", cmp.groupAddressDiff?.extraOnDevice);
```

### 5.3 Typed `.knxproj` Live Runtime & Group Monitor (`KnxProjectRuntime`)

Connect any `KNXService` (`KNXTunneling`, `KNXnetIPServer`, `KNXUSBConnection`, `TPUARTConnection`) directly to a `KnxProject` to get automatic ETS DPT decoding (`DPST-1-1` → `1.001`, `DPST-9-1` → `9.001`), Space/Function/Device enrichment, typed `write()`/`respond()`/`read()`, and JSON-serializable state snapshots for SCADA, dashboards, and REST/WebSocket backends:

```ts
const runtime = project.createRuntime(tunnel, {
  maxHistoryPerGa: 20, // optional per-GA ring buffer
  loadProjectGroupKeys: true, // auto-loads project Group Keys into tunnel.dataSecure
});

// Listen to all decoded group telegrams (or specific GA with "ga:1/0/1")
runtime.on("telegram", (ev) => {
  console.log(
    `[${ev.kind}] ${ev.groupAddress} (${ev.meta?.name} @ ${ev.meta?.spacePath}) =`,
    ev.value,
    `from ${ev.sourceDevice?.name ?? ev.sourceAddress}`,
  );
});

// Send typed writes by Group Address, integer, GA ID, or unique GA name
await runtime.write("1/0/1", true);
await runtime.write("Living Room Dimmer", 75);

// Send GroupValue_Read and await the decoded GroupValue_Response
const tempEvent = await runtime.read("1/0/2", { timeoutMs: 3000 });
console.log("Current temperature:", tempEvent?.value);

// 100% JSON-serializable live snapshot for REST / WebSocket dashboards
const snapshot = runtime.getSnapshot();
// Clean up listener & timers on shutdown
runtime.destroy();
```

### 5.4 Catalog Baggages (`listBaggages`, `readBaggage`, `getBaggage`)

Extract product images (`TypePicture`), icons, ZIP icon packs, and PDFs embedded inside `M-XXXX/Baggages/**` (also accessible via `session.listBaggages()` / `session.readBaggage(field.baggageRefId)` in `DeviceConfigSession`):

```ts
const baggages = project.listBaggages(); // [{ id, manufacturerId, targetPath, name, zipEntryPath, mimeType }]
const asset = project.getBaggage(baggages[0].id); // { ..., filename, mimeType, size, buffer }
// Or raw Buffer by BaggageRefId or zipEntryPath:
const rawBuf = project.readBaggage(baggages[0].id);
```
