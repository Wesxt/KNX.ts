# Complete Guide to KNX Application Programming (`.knxprod`), Web Parameterization API & KNX Data Secure Commissioning (Phase 2)

> Versión en español: ver [PROGRAMMING_GUIDE_ES.md](./PROGRAMMING_GUIDE_ES.md)

`knx.ts` provides a complete, zero-external-dependency pipeline to **parse official ETS `.knxprod` product catalogs**, **dynamically parameterize devices from external/web applications**, **compile KNX System B (`MV-07B0`) binary images**, **commission KNX Data Secure (Security Interface Object Type 17)**, and **download applications directly onto physical KNX devices** over IP Tunneling, KNX USB (`cEMI`), Routing, or TP-UART.

---

## 1. End-to-End Architecture

```text
  .knxprod archive (ZIP containing knx_master.xml, Hardware.xml, M-xxxx_A-*.xml)
         │
         ▼
  KnxProdParser (streaming XML parser, handles 60+ MB catalogs & localization)
         │
         ▼
  DeviceConfigSession ◄──► Web App / REST API / WebSocket (100% JSON-serializable)
    │   • getUiState()        -> channels, blocks, typed parameters, localized ComObjects
    │   • setParameter()      -> re-evaluates <Dynamic>, <Assign>, JS calcs & returns diffs
    │   • validate()          -> validates ranges, GAs, table capacities & AES keys
    │   • toJSON()/fromJSON() -> persists & restores compact config snapshots in a DB
         │
         ▼
  DynamicEvaluator ──► SystemBCompiler (Objects 1..4 + Object 17 Data Secure)
         │
         ▼
  LoadProcedureEngine (merges knx_master.xml + MergeId 1..7 + ProgramSecurityObject)
         │
         ▼
  KNXDeviceProgrammer (Pre-flight, HW safety checks, APDU chunking, download, Restart)
         │
         ▼
  KNXManagement / KnxDataSecure ──► IP Tunneling / KNX USB / Routing / TP-UART ──► KNX Bus
```

### Supported Features

| Component | Technical details per KNX Standard v3.0.0 |
|---|---|
| **`.knxprod` Parser** (`ZipReader`, `KnxProdParser`) | Zero-dependency ZIP/ZIP64 reader (`node:zlib`) and streaming XML scanner. Extracts `knx_master.xml` (`HawkConfigurationData` / `MaskVersions`), `Hardware.xml`, and `ApplicationProgram`, discovers all `availableLanguages`, and loads `<Languages>` translations and `<ParameterSeparator>` nodes on demand. |
| **`<Dynamic>` Evaluator** (`DynamicEvaluator`) | Fixed-point evaluation of `<choose>`/`<when>` (`!=`, `<`, `<=`, `>`, `>=`, `a..b` ranges, space-separated OR), `<Assign>`, `<ModuleDef>`/`<Module>`/`<Repeat>`/`<Allocator>`, `{{0:fallback}}` text templates, and `<ParameterCalculation>` + `<Script>` inside an isolated `node:vm` sandbox. |
| **System B Compiler** (`SystemBCompiler`) | Compiles **Obj 1 (`GrAT`)** sorted ascending, **Obj 2 (`GrOAT`)** Format 0 (`PDT_GENERIC_02`) & Format 1 (`PDT_GENERIC_04`) with sending GA first, bit-exact **Obj 3 (`GrOT`)** (`U/T/I/W/R/C/Prio` + Table 88), **Obj 4 (`RelativeSegment`)** supporting `LittleEndian`/`BigEndian`, `Union`, MSB sub-byte bit-packing, `DPT 9`, `IEEE-754`, `TypeText`, `Mask == 0` exclusion, and `CRC16-CCITT` (`03_05_01` §4.2.27). |
| **Phase 2 — Data Secure** (`compileSecurityObjectImage`, `KNXDeviceProgrammer`) | Compiles and programs **Security Interface Object (Type 17)**: `PID_LOAD_STATE_CONTROL` (5), `PID_P2P_KEY_TABLE` (52), `PID_GRP_KEY_TABLE` (53), `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (54), `PID_TOOL_KEY` (56), `PID_SEQUENCE_NUMBER_SENDING` (59), `PID_GO_SECURITY_FLAGS` (61), and `PID_SECURITY_MODE` (51). Includes factory initial **`FDSK → ToolKey`** commissioning (`commissionSecureDevice`). |
| **`.knxkeys` Keyring** (`KnxKeyring`) | Zero-dependency reader, builder/editor, and **exporter** compatible with ETS 5, ETS 6, Home Assistant (`xknx`), and `knx.ts`: PBKDF2-HMAC-SHA256 + AES-128-CBC encryption, canonical SHA-256 `Signature`, CSPRNG key generation, XML (UTF-8 BOM) or ZIP containers, 3-level (`1/0/1`) or ETS5 integer (`2049`) addresses, and live 48-bit sequence number sync with `KnxDataSecure`. |
| **External / Web API** (`DeviceConfigSession`) | Stateful, 100% JSON-serializable session exposing hierarchical UI schemas, live mutation diffs, parameter/ComObject search, structured validation, automatic key generation (`ensureSecurityKeys`), keyring export (`exportToKeyring`), and portable JSON persistence (`schemaVersion: 1`). |

---

## 2. How Web Apps Integrate `DeviceConfigSession` (`DeviceUiState` vs `SerializedDeviceConfig`)

A web frontend **never** needs to parse `.knxprod` XML or hardcode vendor-specific parameter names (like `"bOutput"` or ComObject `"765"`). Instead, the architecture separates **two JSON payloads**:

| JSON | Method | Consumer | Purpose |
|---|---|---|---|
| **`DeviceUiState`** | `session.getUiState()` | **Web Frontend** (React, Vue, Angular, mobile) | Localized, fully typed UI tree (`channels -> blocks -> items` + active `comObjects` + `security` + `stats`). The frontend renders generic widgets directly from this schema. |
| **`SerializedDeviceConfig`** | `session.toJSON()` | **Backend / Database** | Compact snapshot of user overrides (`schemaVersion: 1`, `parameters`, `groupLinks`, `security`). Stored in your DB and rehydrated via `DeviceConfigSession.fromJSON(parsed, json)`. |

### Widget Mapping for a Generic Frontend Renderer

Each entry in `block.items` has `kind: "parameter"` or `kind: "separator"`:

| `item.kind` / `item.widget` | UI Control | Key Properties |
|---|---|---|
| `kind: "separator"` | Info banner, heading, or horizontal rule based on `item.uiHint` (`"Information"`, `"Headline"`, `"HorizontalRuler"`, `"Error"`). | `text`, `uiHint` |
| `widget: "checkbox"` | Toggle / Checkbox (`"1"` = enabled, `"0"` = disabled). | `label`, `value`, `readOnly` |
| `widget: "select"` | Dropdown (`<select>`) or radio group populated from `item.options`. | `options: [{ value, label }]`, `value` |
| `widget: "number"` | Integer input constrained by `min`/`max`. | `min`, `max`, `suffixText` (`"s"`, `"ms"`, `"%"`) |
| `widget: "float"` | Floating-point input (e.g. DPT 9 or IEEE-754). | `min`, `max`, `floatEncoding`, `suffixText` |
| `widget: "text"` | Text input enforcing byte length and optional regex pattern. | `maxByteLength`, `pattern` |
| `widget: "color"` | Color picker (`RGB` / `RGBW` hex). | `colorSpace` |
| `widget: "ip"` | IPv4/IPv6 input. | `ipVersion` |
| `widget: "time"` | Duration / time input with unit. | `unit`, `min`, `max` |
| `widget: "raw"` / `"picture"` / `"none"` | Base64 payload / static image / read-only note. | `maxByteLength` |

---

## 3. Complete Web Backend + Generic Frontend Example

### Node.js Backend (REST / WebSocket API)

```typescript
import {
  DeviceConfigSession,
  KNXDeviceProgrammer,
  KnxKeyring,
  KnxProdParser,
  ParsedKnxProd,
} from "knx.ts";

// 1. Cache parsed catalogs per file + language (~0.5 s once for a 64 MB .knxprod)
const catalogCache = new Map<string, ParsedKnxProd>();
async function getCatalog(knxprodPath: string, language = "en-US"): Promise<ParsedKnxProd> {
  const key = `${knxprodPath}::${language}`;
  let parsed = catalogCache.get(key);
  if (!parsed) {
    parsed = await KnxProdParser.parseFile(knxprodPath, { language });
    catalogCache.set(key, parsed);
  }
  return parsed;
}

const sessions = new Map<string, DeviceConfigSession>();

// POST /api/sessions -> Open a new or restored device configuration session
async function createSession(sessionId: string, knxprodPath: string, savedJson?: string, language = "en-US") {
  const parsed = await getCatalog(knxprodPath, language);
  const session = savedJson
    ? DeviceConfigSession.fromJSON(parsed, savedJson)
    : new DeviceConfigSession(parsed);
  sessions.set(sessionId, session);
  return session.getUiState();
}

// PATCH /api/sessions/:id/parameters -> Apply edits & return UI diffs + updated state
function patchParameters(sessionId: string, patch: Record<string, string | number | boolean>) {
  return sessions.get(sessionId)!.setParameters(patch);
}

// PUT /api/sessions/:id/com-objects/:number -> Bind Group Addresses & Data Secure mode
function linkComObject(
  sessionId: string,
  comObjectNumber: number,
  body: { sending?: string; listening?: string[]; security?: "plain" | "auth_only" | "auth_conf" },
) {
  return sessions.get(sessionId)!.linkGroupObject(comObjectNumber, body);
}

// GET /api/sessions/:id/export -> Persist config JSON (use includeSecrets: false for untrusted clients)
function exportConfig(sessionId: string, forBrowser = false) {
  return sessions.get(sessionId)!.toJSON({ includeSecrets: !forBrowser });
}

// POST /api/sessions/:id/download -> Validate & program physical KNX device
async function downloadToDevice(
  sessionId: string,
  programmer: KNXDeviceProgrammer,
  individualAddress: string,
  keyring?: KnxKeyring,
  onProgress?: (ev: unknown) => void,
) {
  const session = sessions.get(sessionId)!;
  const runtimeSec = keyring ? { keyring } : undefined;
  const validation = session.validate(runtimeSec);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }
  const result = await session.download(
    programmer,
    individualAddress,
    { mode: "ap1", sessionOptions: keyring ? { secure: true } : undefined, onProgress },
    runtimeSec,
  );
  return { ok: true, result };
}
```

### Generic React Field Renderer

```tsx
function KnxBlockItem({ item, onChange }: { item: UiBlockItem; onChange: (paramRefId: string, val: string) => void }) {
  if (item.kind === "separator") {
    return <div className={`knx-sep knx-sep-${item.uiHint ?? "info"}`}>{item.text}</div>;
  }
  return (
    <div style={{ marginLeft: item.indentLevel * 16 }}>
      <label>{item.label}</label>
      {item.widget === "checkbox" && (
        <input
          type="checkbox"
          disabled={item.readOnly}
          checked={item.value === "1"}
          onChange={(e) => onChange(item.paramRefId, e.target.checked ? "1" : "0")}
        />
      )}
      {item.widget === "select" && (
        <select disabled={item.readOnly} value={item.value} onChange={(e) => onChange(item.paramRefId, e.target.value)}>
          {item.options?.map((opt) => (
            <option key={opt.id || opt.value} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
      {(item.widget === "number" || item.widget === "float" || item.widget === "time") && (
        <input
          type="number"
          disabled={item.readOnly}
          min={item.min}
          max={item.max}
          step={item.widget === "float" ? "any" : 1}
          value={item.value}
          onChange={(e) => onChange(item.paramRefId, e.target.value)}
        />
      )}
      {item.widget === "text" && (
        <input
          type="text"
          disabled={item.readOnly}
          maxLength={item.maxByteLength}
          value={item.value}
          onChange={(e) => onChange(item.paramRefId, e.target.value)}
        />
      )}
      {item.suffixText && <span> {item.suffixText}</span>}
    </div>
  );
}
```

---

## 4. `DeviceConfigSession` Method Reference

| Method | Description |
|---|---|
| `new DeviceConfigSession(source, initialConfig?)` | Creates a session from `ParsedKnxProd` or `KnxApplicationProgram` with optional initial config. |
| `DeviceConfigSession.fromJSON(source, json, runtimeSecurity?)` | Restores a session from a `SerializedDeviceConfig` object or JSON string. |
| `getCatalogSummary()` | Static metadata: IDs, MaskVersion, available/loaded languages, table limits, hardware/products, and Data Secure limits. |
| `getUiState({ includeAccessNone? })` | Returns the full JSON-serializable `DeviceUiState` (`Access="None"` hidden by default). |
| `getParameter(key)` / `getComObject(target)` | Looks up a single parameter or active Communication Object. |
| `findParameters(query, { onlyVisible?, limit? })` | Searches parameters by localized label, name, or ID (fast on 15,000+ parameter catalogs). |
| `findComObjects(query, { onlyActive?, limit? })` | Searches Communication Objects by label, function text, name, number, or linked Group Address. |
| `setParameter(key, value)` / `setParameters(patch)` | Updates parameters, re-evaluates `<Dynamic>` & JS calculations, and returns `ConfigMutationResult` with diffs + updated `state`. |
| `resetParameter(key)` / `resetAllParameters()` | Resets one or all parameters back to catalog defaults. |
| `linkGroupObject(target, spec)` / `unlinkGroupObject(target)` | Binds/unbinds Group Addresses (`"1/0/1"`, `["1/0/1", "1/0/2"]`, or `{ sending, listening, flags, security }`). |
| `setGroupObjectFlags(target, flags)` | Overrides C/R/W/T/U/I flags and transmission priority. |
| `setGroupObjectSecurity(target, mode)` | Sets per-object Data Secure level: `"plain"` (`0x00`), `"auth_only"` (`0x01`), or `"auth_conf"` (`0x03`). |
| `setSecurityConfig(patch)` / `setKeyring(keyring)` | Configures Object 17 settings (`enabled`, `keyring`, `groupKeys`, `authorizedSenders`, `p2pKeys`, `toolKey`, `enableSecurityMode`, `initialSequenceNumberSending`). |
| `ensureSecurityKeys(options?)` | Generates random 16-byte AES-128 keys for all active linked secure ComObjects missing a key (and optionally a `ToolKey`), writing them into `options.keyring` (attaching it to the session) or `session.security.groupKeys`. Skips `"plain"` ComObjects. |
| `exportToKeyring(options)` | Merges this device's active secure Group Keys, `ToolKey`, `SequenceNumber`, `SerialNumber`, and optional `<Interface>` group sender entries into a `KnxKeyring` (new or shared multi-device project keyring) ready for `.knxkeys` export. |
| `validate(runtimeSecurity?)` | Returns `{ valid, errors, warnings }` with structured codes (`VALUE_BELOW_MIN`, `VALUE_ABOVE_MAX`, `INVALID_ENUM_VALUE`, `TEXT_TOO_LONG`, `INVALID_GROUP_ADDRESS`, `MISSING_GROUP_KEY`, `INVALID_INDIVIDUAL_ADDRESS`, `SECURITY_TABLE_OVERFLOW`, `NO_AUTHORIZED_SENDERS`, etc.). |
| `toJSON({ includeSecrets? })` | Serializes to portable `SerializedDeviceConfig` (`schemaVersion: 1`). Pass `{ includeSecrets: false }` to strip raw AES keys. |
| `compile(runtimeSecurity?)` | Compiles to `CompiledSystemBImage` (Objects 1–4 + optional Object 17 `securityImage`). |
| `planDownload(options?, runtimeSecurity?)` | Builds an offline `DownloadPlan` with estimated bytes to write. |
| `download(programmer, ia, options?, runtimeSecurity?)` | Executes pre-flight + download (or `dryRun: true`) via `KNXDeviceProgrammer`. |

---

## 5. Programming a Device WITHOUT KNX IP Secure or KNX Data Secure (Plain Mode)

If your target device **does not use KNX Data Secure** (standard KNX devices or Secure devices operating in plain mode) and your gateway/USB link is not IP Secure, **you do not need `KnxKeyring`, `KnxDataSecure`, or `sessionOptions: { secure: true }`**:

```typescript
import {
  ConnectionType,
  DeviceConfigSession,
  KNXDeviceProgrammer,
  KNXTunneling,
  KnxProdParser,
} from "knx.ts";

// 1. Parse the .knxprod catalog (optionally specifying a UI language)
const parsed = await KnxProdParser.parseFile("./product.knxprod", { language: "en-US" });

// 2. Configure parameters & Group Address links (no security config needed)
const session = new DeviceConfigSession(parsed);
session.setParameters({
  bOutput: 1,
  "outputCh[0].type": 1,
  "indOutput[0].bEnabled": 1,
});
session.linkGroupObject(765, { sending: "1/0/1" }); // Output 1 control (plain)
session.linkGroupObject(766, { sending: "1/1/1" }); // Output 1 status (plain)

// Optional: validate ranges & Group Addresses before opening the bus connection
const check = session.validate();
if (!check.valid) {
  throw new Error(`Invalid configuration: ${JSON.stringify(check.errors, null, 2)}`);
}

// 3. Connect via plain UDP Tunneling (or use KNXUSBConnection / TPUARTConnection)
const tunnel = new KNXTunneling({
  ip: "192.168.0.204",
  port: 3671,
  connectionType: ConnectionType.TUNNEL_CONNECTION,
  individualAddress: "1.1.200", // Optional: omit to use gateway-assigned IA
  transport: "UDP",
});
await tunnel.connect();

// 4. Create programmer (no dataSecure) and run download
const programmer = new KNXDeviceProgrammer(tunnel, {
  sourceAddress: tunnel.individualAddress,
});

try {
  // Recommended first pass: dryRun: true verifies MaskVersion, ManufacturerId & HardwareType without writing flash
  const result = await session.download(programmer, "1.1.1", {
    mode: "ap1",   // "ap1" (full application + tables) or "grp" (group tables only)
    dryRun: false, // Set true for read-only pre-flight check
    onProgress: (ev) => console.log(`[${ev.percent}%] (${ev.phase}) ${ev.message}`),
  });

  console.log(`Plain download complete: ${result.bytesWritten} B in ${result.durationMs} ms`);
} finally {
  tunnel.disconnect();
}
```

> **Direct shortcut without `DeviceConfigSession`:** If you already know the exact parameter names and do not need the interactive UI schema, you can call `programmer.download("1.1.1", parsed, { parameters: { ... }, groupLinks: { 765: "1/0/1", 766: "1/1/1" } }, { mode: "ap1" })` directly.

---

## 6. Phase 2: KNX Data Secure Commissioning (Object Type 17)

### Per-Group-Object Security Modes (`auth_conf`, `auth_only`, `plain`)

Each Communication Object stores a 1-byte security flag in **`PID_GO_SECURITY_FLAGS`** inside the Security Interface Object (Type 17):

| Mode in `knx.ts` | `PID_GO_SECURITY_FLAGS` Byte | Encrypts DPT Payload | 4 B MAC + 48-bit SeqNr | When to use |
|---|---|---|---|---|
| **`"auth_conf"` (A+C)** | `0x03` (`SAI = 1`) | **Yes** (AES-128-CCM) | **Yes** | **Recommended default (ETS standard).** Prevents eavesdropping, tampering, and replay attacks. |
| **`"auth_only"` (A-only)** | `0x01` (`SAI = 0`) | **No** (cleartext payload) | **Yes** | Payload stays readable for passive diagnostics/monitors, while receivers reject forged or replayed telegrams. |
| **`"plain"` (Unsecured)** | `0x00` | **No** | **No** | Classic KNX telegram. Enables **mixed-mode devices** (some encrypted channels alongside legacy plain devices). |

> **Interoperability rule:** Every device bound to the same Group Address must share the exact same **16-byte Group Key** and the **same mode** (`auth_conf`, `auth_only`, or `plain`), and each secure receiver must include every sender's Individual Address in `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (`authorizedSenders`).

### Factory Commissioning (`FDSK → ToolKey`, `03_05_03` §1.5.4.4–5)

```typescript
const commissioned = await programmer.commissionSecureDevice("1.1.1", {
  fdsk: "0123456789ABCDEF0123456789ABCDEF", // 16-byte FDSK from the device QR/label
  // toolKey: "..." // Optional: CSPRNG-generated if omitted
  initialSequenceNumberSending: "auto", // ms since 2018-01-05T00:00:00Z
  enableSecurityMode: true,
  restartAfterCommissioning: true, // Confirmed Restart (eraseCode = 0x01)
});
console.log("Store this new ToolKey securely:", commissioned.toolKeyHex);
```

### Secure Application + Object 17 Download

1. Attach `KnxDataSecure` (with `.knxkeys` or explicit `deviceToolKeys`) to your `KNXTunneling`, `KNXUSBConnection`, `KNXnetIPServer`, or `TPUARTConnection`.
2. Pass `sessionOptions: { secure: true }` to `programmer.download(...)` or `session.download(...)`.
3. **Important (`authorizedSenders`)**: Every Individual Address that will send encrypted group telegrams to the target device (including your own gateway/interface IA such as `"1.1.200"` and any secure wall switches) **must** be included in `security.authorizedSenders` (or in the keyring `<Interface><Group Senders="..."/>`) so it is written to `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (PID 54). Otherwise the target device will discard incoming secure group telegrams from those senders.
4. When rotating `toolKey` during a download, `KNXDeviceProgrammer` writes `PID_TOOL_KEY`, sends `A_Restart` encrypted with the still-active old key, and rotates the local `KnxDataSecure` manager immediately after restart.

---

## 7. Autonomous `.knxkeys` Generation & Export (`KnxKeyring`, ETS-Free Workflow)

`KnxKeyring` is a complete zero-dependency **reader, builder/editor, and exporter** for ETS `.knxkeys` files (`http://knx.org/xml/keyring/1`), interoperable with **ETS 5**, **ETS 6**, **Home Assistant (`xknx`)**, **Calimero**, and **`knx.ts`**.

### Cryptographic Format & Compatibility

1. **Key derivation**: `PBKDF2-HMAC-SHA256(password, salt = "1.keyring.ets.knx.org", iterations = 65536, 16 bytes)`.
2. **Initialization Vector (IV)**: first 16 bytes of `SHA-256(Created)` (exact ISO string written in `Created="..."`).
3. **AES-128-CBC encryption**:
   - **16-byte keys** (`Backbone/@Key`, `GroupAddresses/Group/@Key`, `Devices/Device/@ToolKey`): raw AES-128-CBC (no padding) → Base64.
   - **Text passwords** (`Interface/@Password`, `Interface/@Authentication`, `Device/@ManagementPassword`, `Device/@Authentication`): 8 random bytes (CSPRNG) + UTF-8 password + PKCS#7 padding → AES-128-CBC → Base64.
4. **Integrity signature (`Signature="..."`)**: canonical XML tree walk (attributes sorted alphabetically excluding `xmlns` and `Signature`) + `Base64(passwordHash)` → first 16 bytes of `SHA-256` as Base64.
5. **Output options (`KeyringExportOptions`)**:
   - `format: "xml"` *(default)* with `includeBom: true`: UTF-8 XML with BOM matching native ETS 5 / ETS 6 `.knxkeys` exports.
   - `format: "zip"`: standard DEFLATE ZIP archive containing the signed XML entry.
   - `groupAddressFormat: "3-level"` *(default, e.g. `"1/0/1"`, ETS 6 / `xknx`)* or `"integer"` *(e.g. `"2049"`, legacy ETS 5 compatibility)*.

### `KnxKeyring` API Reference

| Method | Description |
|---|---|
| `KnxKeyring.create({ project?, createdBy?, created? })` | Creates an empty keyring ready to be populated and exported. |
| `KnxKeyring.fromSource(source, password, { validateSignature? })` | Loads, verifies the signature, and decrypts a `.knxkeys` from a file path, raw XML, Base64, or `Buffer` (XML or ZIP). |
| `KnxKeyring.generateKey()` | Generates a CSPRNG random 16-byte AES-128 key. |
| `setBackbone({ key?, multicastAddress?, latency? })` / `clearBackbones()` | Configures KNX IP Secure Routing `<Backbone>` (generates random 16 B key when `key` is omitted or `"generate"`). |
| `setGroupKey(address, key?)` | Sets/updates the 16-byte key for a GA (`"1/0/1"`, `"1/1"`, or `2049`), generating one if `key` is omitted. Returns the 16-byte `Buffer`. |
| `ensureGroupKey(address)` | Idempotently returns the existing key for `address` or generates, stores, and returns a new 16-byte key. |
| `removeGroupKey(address)` | Removes a Group Address key entry. |
| `setDevice({ individualAddress, toolKey?, managementPassword?, authentication?, sequenceNumber?, serialNumber?, merge? })` | Adds/updates a `<Device>` entry (`toolKey: "generate"`, 48-bit `bigint`/`number` `sequenceNumber`, 6-byte `Buffer`/hex `serialNumber`). `merge: true` (default) preserves omitted fields. |
| `removeDevice(individualAddress)` | Removes a `<Device>` entry. |
| `setInterface({ individualAddress, type?, host?, userId?, password?, authentication?, groupAddresses?, merge? })` | Adds/updates an `<Interface>` (`"Tunnelling"`, `"Backbone"`, `"USB"`). |
| `addInterfaceGroupSender(interfaceIa, groupAddress, senderIa, interfaceType?)` | Appends authorized sender IA(s) to `<Interface><Group Address="..." Senders="..." />`. |
| `removeInterface(individualAddress)` | Removes an `<Interface>` entry. |
| `syncFromDataSecure(dataSecure, options?)` / `dataSecure.syncToKeyring(keyring, options?)` | Pulls Group Keys, `ToolKey`s, `SerialNumber`s, and live 48-bit Sequence Numbers (`SequenceNumber = LastValidSeqNr + 1` per `03_03_07` §5.3.2) into the keyring before exporting. |
| `toXml(password, options?)` | Returns the encrypted and signed XML document as a `string`. |
| `toBuffer(password, options?)` | Returns the `.knxkeys` binary payload (`Buffer`, XML with BOM or ZIP) — ideal for HTTP downloads. |
| `saveFile(filePath, password, options?)` | Writes the `.knxkeys` file directly to disk (auto-creating parent directories). |
| `getBackbone()` / `getInterfaces()` / `getInterface(ia?)` / `getGroupAddresses()` / `getGroupKey(ga)` / `getGroupSenders(ga)` / `getDevices()` / `getDevice(ia)` / `getDeviceToolKey(ia)` | Read decrypted keyring contents. |

### End-to-End Autonomous Workflow (Factory FDSK → Program → Export `.knxkeys`)

```typescript
import {
  ConnectionType,
  DeviceConfigSession,
  KNXDeviceProgrammer,
  KNXTunneling,
  KnxDataSecure,
  KnxKeyring,
  KnxProdParser,
} from "knx.ts";

// 1. Create a project keyring (aggregates all devices in your installation)
const projectKeyring = KnxKeyring.create({ project: "NorthBuilding", createdBy: "MyKNXPlatform 1.0" });
projectKeyring.setBackbone({ multicastAddress: "224.0.23.12", latency: 2000, key: "generate" });

const dataSecure = new KnxDataSecure({ sourceAddress: "1.1.200", sequenceNumberFile: "./sec/seq_state.json" });
const tunnel = new KNXTunneling({
  ip: "192.168.0.204",
  port: 3671,
  connectionType: ConnectionType.TUNNEL_CONNECTION,
  individualAddress: "1.1.200",
  transport: "UDP",
  dataSecure,
});
await tunnel.connect();
const programmer = new KNXDeviceProgrammer(tunnel, { sourceAddress: "1.1.200", dataSecure });

try {
  // 2. Commission factory-new device (FDSK -> random ToolKey)
  const comm = await programmer.commissionSecureDevice("1.1.1", {
    fdsk: "0123456789ABCDEF0123456789ABCDEF",
    enableSecurityMode: true,
    restartAfterCommissioning: true,
  });

  // 3. Configure parameters & Group Objects (mixed A+C / A-only / plain supported)
  const parsed = await KnxProdParser.parseFile("./product.knxprod", { language: "en-US" });
  const session = new DeviceConfigSession(parsed);
  session.setParameters({ bOutput: 1, "outputCh[0].type": 1, "indOutput[0].bEnabled": 1 });
  session.linkGroupObject(765, { sending: "1/0/1", security: "auth_conf" });
  session.linkGroupObject(766, { sending: "1/1/1", security: "auth_conf" });
  session.setSecurityConfig({ enabled: true, authorizedSenders: ["1.1.200"] });

  // 4. Auto-generate missing 16-byte Group Keys into projectKeyring & attach it
  session.ensureSecurityKeys({ keyring: projectKeyring });
  dataSecure.loadFromKeyring(projectKeyring);

  // 5. Validate and download encrypted application + Object 17
  if (!session.validate().valid) throw new Error("Invalid device config");
  const dl = await session.download(programmer, "1.1.1", { mode: "ap1", sessionOptions: { secure: true } });

  // 6. Export device ToolKey, SerialNumber, Group Keys, interface senders, and live SeqNrs to .knxkeys
  session.exportToKeyring({
    keyring: projectKeyring,
    individualAddress: "1.1.1",
    toolKey: comm.toolKey,
    serialNumber: dl.preflight?.serialNumber,
    dataSecure,
    interfaceAddress: "1.1.200",
  });
  projectKeyring.syncFromDataSecure(dataSecure);
  projectKeyring.saveFile("./exports/NorthBuilding.knxkeys", "ExportPassword#2026");
} finally {
  dataSecure.saveState();
  tunnel.disconnect();
}
```

### Editing & Re-Exporting an Existing ETS `.knxkeys`

```typescript
import { KnxKeyring } from "knx.ts";

const keyring = KnxKeyring.fromSource("./existing-ets.knxkeys", "oldPassword");
keyring.ensureGroupKey("2/0/1");
keyring.setDevice({ individualAddress: "1.1.50", toolKey: "generate", sequenceNumber: 1n });
keyring.addInterfaceGroupSender("1.1.200", "2/0/1", ["1.1.50", "1.1.200"]);

// All existing keys & passwords are re-encrypted under the new password with a freshly computed Signature
keyring.saveFile("./updated.knxkeys", "newPassword", {
  groupAddressFormat: "3-level", // Or "integer" for legacy ETS 5
  format: "xml",                 // Or "zip" for ZIP-wrapped XML
});
```

---

## 8. Download Modes & Pre-Flight Safety Guards

- **Modes (`options.mode`)**:
  - `"ap1"` *(default)*: Full Application 1 (Obj 4) + `GrOT` (Obj 3) + `GrOAT` (Obj 2) + `GrAT` (Obj 1) + Object 17 + `Restart`.
  - `"full"`: Same as `"ap1"` plus PEI Application 2 (Obj 5) if present.
  - `"grp"`: Fast Group Tables (Obj 1–3) + Object 17 + `Restart` (leaves application memory untouched).
  - `"par,grp"`: Partial parameters (Obj 4 `Mode=0`) + Group Tables + Object 17 + `Restart`.
  - `"par"`: Parameters only (Obj 4).
  - `"unload"`: Unloads loadable Objects 1..5.
- **Pre-Flight Guarantees (`verifyDeviceBeforeWrite: true`)**: Verifies `MaskVersion` (`DD0`), `ManufacturerId`, and exact `PID_HARDWARE_TYPE` (`strictHardwareTypeCheck: true`) before unloading or writing a single byte; auto-detects live `PID_MAX_APDULENGTH` (subtracting 13 bytes for `S-A_Data` in secure sessions) and `GrOAT` Format 0 vs 1.

---

## 9. Configuration JSON Schema (`SerializedDeviceConfig` / `CONFIG_JSON`)

`SerializedDeviceConfig` is the compact JSON payload produced by **`session.toJSON()`**, restored by **`DeviceConfigSession.fromJSON(parsed, json)`**, and accepted by the repository CLI via `CONFIG_JSON`. Normally your web app produces it automatically, though it can also be hand-authored and version-controlled.

### Supported Fields

| Field | Required | Description |
|---|---|---|
| `schemaVersion` | **Yes** | Always `1`. |
| `applicationId` | **Yes** | `ApplicationProgram` ID from the `.knxprod` catalog (e.g. `"M-0071_A-49B1-21-F03B"`). |
| `language` | No | Informational language tag used when authoring the config (e.g. `"en-US"`, `"es-ES"`). |
| `parameters` | **Yes** | Map `{ "<key>": "<value>" }` of non-default parameter overrides. `<key>` may be `paramRefId` (recommended because it is globally unique), `paramId`, or `name` (e.g. `"bOutput"`). Values are stored as strings (e.g. `"1"`, `"0"`, `"250"`). |
| `groupLinks` | **Yes** | Map `{ "<comObject>": { sending?, listening?, flags?, security? } }`, keyed by 1-based ComObject number (e.g. `"765"`) or `name`.<br>• `sending`: primary sending Group Address (e.g. `"1/0/1"`).<br>• `listening`: optional array of extra listening Group Addresses (e.g. `["1/0/2", "1/0/3"]`).<br>• `flags`: optional flag overrides `{ communication, read, write, transmit, update, readOnInit, priority }`.<br>• `security`: optional (Data Secure only): `"plain"`, `"auth_only"`, or `"auth_conf"`. |
| `security` | No | **Omit entirely** for plain (non-Secure) devices. For KNX Data Secure (Object 17) supports:<br>• `enabled`: `true`/`false`.<br>• `defaultGroupSecurityMode`: `"auth_conf"` *(default)*, `"auth_only"`, or `"plain"`.<br>• `authorizedSenders`: allowed sender IAs for PID 54 (`[{ "individualAddress": "1.1.200" }]`).<br>• `includeKeyringSenders`: `true` *(default)* to inherit `<Interface><Group Senders="..."/>` from `.knxkeys`.<br>• `groupKeys`: optional `{ "1/0/1": "<32 hex>" }` map (not needed when keys come from `.knxkeys`).<br>• `groupObjectSecurityModes`: optional `{ "765": "auth_conf" }` map.<br>• `p2pKeys`: optional `[{ "individualAddress": "1.1.5", "key": "<32 hex>", "roles": 1 }]`.<br>• `toolKey`: optional 32-char hex key to rotate `PID_TOOL_KEY`.<br>• `enableSecurityMode`: optional `true`/`false` for `PID_SECURITY_MODE`.<br>• `initialSequenceNumberSending`: `"auto"` or 48-bit integer string. |
| `options` | No | Optional compiler flags: `{ runParameterCalculations?, associationTableFormat?: 0 \| 1, clearCommunicationFlagWhenUnlinked?, groupObjectTableSize? }`. |

### Example A: Plain Device JSON (No KNX Secure / Data Secure)

```json
{
  "schemaVersion": 1,
  "applicationId": "M-0071_A-49B1-21-F03B",
  "language": "en-US",
  "parameters": {
    "bOutput": "1",
    "outputCh[0].type": "1",
    "indOutput[0].bEnabled": "1",
    "indOutput[1].bEnabled": "1"
  },
  "groupLinks": {
    "765": { "sending": "1/0/1" },
    "766": { "sending": "1/1/1" },
    "779": { "sending": "1/0/2", "listening": ["1/0/10"] },
    "780": {
      "sending": "1/1/2",
      "flags": { "read": true, "transmit": true }
    }
  }
}
```

### Example B: KNX Data Secure Device JSON (Object 17 + `.knxkeys`)

```json
{
  "schemaVersion": 1,
  "applicationId": "M-0071_A-49B1-21-F03B",
  "language": "en-US",
  "parameters": {
    "bOutput": "1",
    "outputCh[0].type": "1",
    "indOutput[0].bEnabled": "1"
  },
  "groupLinks": {
    "765": { "sending": "1/0/1", "security": "auth_conf" },
    "766": { "sending": "1/1/1", "security": "auth_conf" }
  },
  "security": {
    "enabled": true,
    "defaultGroupSecurityMode": "auth_conf",
    "authorizedSenders": [
      { "individualAddress": "1.1.200" }
    ]
  }
}
```

> **Tip:** To discover the exact `applicationId`, parameter keys, and ComObject numbers of any `.knxprod`, instantiate `DeviceConfigSession(parsed)` and inspect `session.getCatalogSummary()`, `session.findParameters("...")`, and `session.findComObjects("...")`, or export directly via `session.toJSON()`.

---

## 10. Built-In Repository CLI (`npm run manualTest:program`)

> **Important note:** This CLI script is available **if you cloned the `KNX.ts` repository** (`git clone https://github.com/Wesxt/KNX.ts.git && npm install`). If you installed `knx.ts` as an npm dependency in your own project, use the TypeScript API (`KnxProdParser`, `DeviceConfigSession`, `KNXDeviceProgrammer`) shown in Sections 3–7.

[program_device_manual.ts](../manual-tests/program_device_manual.ts) lets you test offline compilation, live dry-runs, or real hardware downloads straight from the terminal without writing a script. It defaults to **`DRY_RUN=true`** for safety.

### Plain Mode Examples (No KNX Secure / No `.knxkeys`)

```bash
# 1) Offline compile & plan (no hardware required)
OFFLINE=true KNX_LANG=en-US \
KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_plain.json" \
npm run manualTest:program

# 2) Live plain UDP Tunneling dry-run (read-only pre-flight check)
KNX_IP=192.168.0.204 TARGET_DEVICE=1.1.1 \
KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_plain.json" \
npm run manualTest:program

# 3) Real plain download (DRY_RUN=false) over UDP Tunneling
DRY_RUN=false MODE=ap1 KNX_IP=192.168.0.204 TARGET_DEVICE=1.1.1 \
KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_plain.json" \
npm run manualTest:program

# 4) Real plain download over KNX USB
DRY_RUN=false TRANSPORT=usb TARGET_DEVICE=1.1.1 \
KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_plain.json" \
npm run manualTest:program
```

### KNX Data Secure Examples (Object 17 + `.knxkeys`)

```bash
# 1) Live Data Secure dry-run over IP Tunneling (read-only)
KNX_IP=192.168.0.204 KNX_LOCAL_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="project.knxkeys" KNX_KEYRING_PASSWORD="secret" \
npm run manualTest:program

# 2) Real download (DRY_RUN=false) over IP Tunneling with Data Secure + Object 17
DRY_RUN=false MODE=ap1 KNX_IP=192.168.0.204 KNX_LOCAL_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="project.knxkeys" KNX_KEYRING_PASSWORD="secret" \
npm run manualTest:program

# 3) Real Data Secure download over KNX USB (cEMI)
DRY_RUN=false TRANSPORT=usb USB_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="project.knxkeys" KNX_KEYRING_PASSWORD="secret" \
npm run manualTest:program
```

---

## 11. Troubleshooting

| Symptom / Error | Cause | Fix |
|---|---|---|
| `MaskVersion mismatch: device reports 0xffff` | Device has KNX Data Secure active and was queried in plain mode. | Configure `KnxDataSecure` with the device's `ToolKey` / `.knxkeys` and pass `sessionOptions: { secure: true }`. |
| Device ignores encrypted `GroupValue_Write` after download | Sender IA (e.g. `1.1.200` or wall switch) is missing from `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`. | Add the sender IA(s) to `security.authorizedSenders` and re-download with `MODE=grp` or `MODE=ap1`. |
| `Hardware verification failed (Obj 0 PID 78)` | Selected `.knxprod` does not match the physical hardware model. | Verify `TARGET_DEVICE` and load the exact `.knxprod` for that hardware revision. |
| `MISSING_GROUP_KEY` in `session.validate()` | A secure ComObject is linked to a Group Address with no 16-byte key configured. | Add the key to `security.groupKeys`, attach a `KnxKeyring`, or set `security: "plain"` on that object. |
