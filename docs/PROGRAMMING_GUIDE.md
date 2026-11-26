# Complete Guide to KNX Application Programming (`.knxprod`), Web Parameterization API & KNX Data Secure Commissioning (Phase 2)

> Versión en español: ver [PROGRAMMING_GUIDE_ES.md](./PROGRAMMING_GUIDE_ES.md)

`knx.ts` provides a complete, zero-external-dependency pipeline to **parse official ETS `.knxprod` product catalogs**, **dynamically parameterize devices from external/web applications**, **compile multi-architecture binary images (System B, System 7 BIM M112, System 2 BCU2, System 1 BCU1, Couplers & System 300)**, **commission KNX Data Secure (Security Interface Object Type 17)**, and **download applications directly onto physical KNX devices** over IP Tunneling, KNX USB (`cEMI`), Routing, or TP-UART.

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
  DynamicEvaluator ──► SystemBCompiler / KNXApplicationCompiler
                       (System B + System 7/2/1 + Couplers + System 300 + Object 17)
         │
         ▼
  LoadProcedureEngine (merges knx_master.xml / ProductProcedure + LdCtrl* + ProgramSecurityObject)
         │
         ▼
  KNXDeviceProgrammer (Pre-flight, HW safety checks, APDU chunking, download, Restart)
         │
         ▼
  KNXManagement / KnxDataSecure ──► IP Tunneling / KNX USB / Routing / TP-UART ──► KNX Bus
```

### Supported Features

| Component | Technical details per KNX Standard v3.0.0 |
| --- | --- |
| **`.knxprod` Parser** (`ZipReader`, `KnxProdParser`) | Zero-dependency ZIP/ZIP64 reader (`node:zlib`) and streaming XML scanner. Extracts `knx_master.xml` (`HawkConfigurationData`, `MaskVersions` & `DownwardCompatibleMasks`), `Hardware.xml`, `Baggages.xml` (lazy binary extraction with MIME types for `TypePicture`, icons, PDFs), and `ApplicationProgram` (including static `<AddressTable>`/`<AssociationTable>`/`<ComObjectTable>` placements, `<AbsoluteSegment>`/`<RelativeSegment>`, and automatic ETS plugin/DCA detection in `<Extension>`), discovers all `availableLanguages`, and loads `<Languages>` translations on demand. |
| **`<Dynamic>` Evaluator** (`DynamicEvaluator`) | Fixed-point evaluation of `<choose>`/`<when>` (`!=`, `<`, `<=`, `>`, `>=`, `a..b` ranges, space-separated OR), `<Assign>`, `<ModuleDef>`/`<Module>`/`<Repeat>`/`<Allocator>`, `{{0:fallback}}` text templates, both 1-based (System B) and 0-based (BCU1/BCU2/BIM M112) ComObjects, and `<ParameterCalculation>` + `<Script>` inside an isolated `node:vm` sandbox. |
| **Multi-Architecture Compiler** (`SystemBCompiler` / `KNXApplicationCompiler`) | Compiles **System B** (`MV-07B0`/`17B0`/`27B0`/`2920`/`57B0`: Obj 1 `GrAT`, Obj 2 `GrOAT` Format 0/1, Obj 3 `GrOT` Type 7, Obj 4 `RelativeSegment` with `CRC16-CCITT`), **System 7 BIM M112** (`MV-0700`/`0701`/`0705`: `AbsoluteSegment` + Type 2 preserving 2-byte RAM pointers), **System 2 BCU2 / System 1 BCU1** (`MV-0021`/`0012`: `AbsoluteSegment` + Type 1 with 1-byte pointers & `UserMemory`), **Couplers** (`MV-091A`/`2920`: 8 KB bitmask `compileCouplerFilterTable`), **System 300** (`MV-0300`: `propertyWrites`), and **differential delta spans** (`encodeKnxTsLoadedImage` / `decodeKnxTsLoadedImage`). |
| **IP Config & Diagnostics** (`KNXDeviceProgrammer`, `KNXManagementSession`) | Auto-discovers and reads/writes **KNXnet/IP Parameter Object (Object Type 11)** (`readIpInterfaceConfig` / `configureIpInterface`: IP, subnet, gateway, DHCP/Manual bitmask, multicast, TTL, friendly name, additional tunneling IAs) and executes ETS-style read-only **Device Info Diagnostics** (`readDeviceDiagnostics`). |
| **Phase 2 — Data Secure** (`compileSecurityObjectImage`, `KNXDeviceProgrammer`) | Compiles and programs **Security Interface Object (Type 17)**: `PID_LOAD_STATE_CONTROL` (5), `PID_P2P_KEY_TABLE` (52), `PID_GRP_KEY_TABLE` (53), `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (54), `PID_TOOL_KEY` (56), `PID_SEQUENCE_NUMBER_SENDING` (59), `PID_GO_SECURITY_FLAGS` (61), and `PID_SECURITY_MODE` (51). Includes factory initial **`FDSK → ToolKey`** commissioning (`commissionSecureDevice`). |
| **`.knxkeys` Keyring** (`KnxKeyring`) | Zero-dependency reader, builder/editor, and **exporter** compatible with ETS 5, ETS 6, Home Assistant (`xknx`), and `knx.ts`: PBKDF2-HMAC-SHA256 + AES-128-CBC encryption, canonical SHA-256 `Signature`, CSPRNG key generation, XML (UTF-8 BOM) or ZIP containers, 3-level (`1/0/1`) or ETS5 integer (`2049`) addresses, and live 48-bit sequence number sync with `KnxDataSecure`. |
| **External / Web API** (`DeviceConfigSession`) | Stateful, 100% JSON-serializable session exposing hierarchical UI schemas, live mutation diffs, parameter/ComObject search, structured validation, automatic key generation (`ensureSecurityKeys`), keyring export (`exportToKeyring`), and portable JSON persistence (`schemaVersion: 1`). |

---

## 2. How Web Apps Integrate `DeviceConfigSession` (`DeviceUiState` vs `SerializedDeviceConfig`)

The most common mistake when designing a web interface on top of KNX is trying to make the frontend understand vendor-specific internal names (such as `"bOutput"` or `"765"`). **With `DeviceConfigSession`, the frontend never hardcodes any manufacturer parameter.**

Instead, the architecture separates **two JSON payloads with distinct purposes**:

| JSON | Method | Consumer | Purpose |
| --- | --- | --- | --- |
| **`DeviceUiState`** | `session.getUiState()` | **Web Frontend** (React, Vue, Angular, mobile) | Localized, fully typed UI tree of the current configuration screen (`channels -> blocks -> items` + active `comObjects` + `security` + `stats`). The frontend renders generic widgets directly from this schema. |
| **`SerializedDeviceConfig`** | `session.toJSON()` | **Backend / Database** | Compact snapshot of user overrides (`schemaVersion: 1`, `parameters`, `groupLinks`, `security`). Stored in your DB and rehydrated via `DeviceConfigSession.fromJSON(parsed, json)`. |

### Structure of `DeviceUiState` (`session.getUiState()`)

```json
{
  "catalog": {
    "applicationId": "M-0071_A-49B1-21-F03B",
    "name": "MAXinBOX 66 v3 2.1",
    "visibleDescription": "Multifunction actuator with 6 outputs and 6 inputs with KNX Secure.",
    "isSecureEnabled": true,
    "loadedLanguage": "en-US",
    "availableLanguages": ["en-US", "es-ES", "de-DE", "fr-FR", "it-IT", "ru-RU", "uk-UA"]
  },
  "channels": [
    {
      "id": "M-0071_A-49B1-21-F03B_CH-310",
      "name": "GENERAL",
      "label": "General",
      "isIndependent": false,
      "items": [],
      "blocks": [
        {
          "id": "M-0071_A-49B1-21-F03B_PB-1",
          "name": "Configuration",
          "label": "Configuration",
          "blocks": [],
          "items": [
            {
              "kind": "separator",
              "text": "All scenes saved in the device will be lost.",
              "uiHint": "Information"
            },
            {
              "kind": "parameter",
              "paramId": "M-0071_A-49B1-21-F03B_P-1",
              "paramRefId": "M-0071_A-49B1-21-F03B_P-1_R-4",
              "name": "bOutput",
              "label": "Outputs",
              "widget": "checkbox",
              "typeKind": "Number",
              "min": 0,
              "max": 1,
              "value": "1",
              "defaultValue": "0",
              "isModified": true,
              "readOnly": false,
              "indentLevel": 0
            }
          ]
        }
      ]
    }
  ],
  "comObjects": [
    {
      "number": 765,
      "name": "oIDO[0].onOff",
      "label": "[O1][] On/Off",
      "functionText": "N.O. (0 = Open relay; 1 = Close relay)",
      "objectSize": "1 Bit",
      "datapointType": "DPST-1-6",
      "priority": "Low",
      "flags": { "communication": true, "read": false, "write": true, "transmit": false, "update": false, "readOnInit": false },
      "sendingGroupAddress": "1/0/1",
      "groupAddresses": ["1/0/1"],
      "securityOverride": "auth_conf",
      "effectiveSecurity": "auth_conf"
    }
  ],
  "security": {
    "isSupportedByApplication": true,
    "enabled": true,
    "defaultGroupSecurityMode": "auth_conf",
    "configuredGroupKeyCount": 0,
    "authorizedSenderCount": 1,
    "p2pKeyCount": 0,
    "hasToolKeyOverride": false
  },
  "stats": {
    "visibleParameters": 115,
    "modifiedParameters": 10,
    "activeComObjects": 12,
    "linkedComObjects": 12,
    "uniqueGroupAddresses": 12,
    "secureGroupObjects": 12
  },
  "warnings": []
}
```

### Widget Mapping for a Generic Frontend Renderer

Each entry in `block.items` has `kind: "parameter"` or `kind: "separator"`:

| `item.kind` / `item.widget` | UI Control | Key Properties |
| --- | --- | --- |
| `kind: "separator"` | Info banner, heading, or horizontal rule based on `item.uiHint` (`"Information"`, `"Headline"`, `"HorizontalRuler"`, `"Error"`). | `text`, `uiHint` |
| `widget: "checkbox"` | Toggle / Checkbox (`"1"` = enabled, `"0"` = disabled). | `label`, `value`, `readOnly` |
| `widget: "select"` | Dropdown (`<select>`) or radio group populated from `item.options`. | `options: [{ value, label }]`, `value` |
| `widget: "number"` | Integer input constrained by `min`/`max`. | `min`, `max`, `suffixText` (`"s"`, `"ms"`, `"%"`) |
| `widget: "float"` | Floating-point input (e.g. DPT 9 temperature or IEEE-754). | `min`, `max`, `floatEncoding`, `suffixText` |
| `widget: "text"` | Text input enforcing byte length and optional regex pattern. | `maxByteLength`, `pattern` |
| `widget: "color"` | Color picker (`RGB` / `RGBW` hex). | `colorSpace` |
| `widget: "ip"` | IPv4/IPv6 input. | `ipVersion` |
| `widget: "time"` | Duration / time input with unit. | `unit`, `min`, `max` |
| `widget: "raw"` / `"picture"` / `"none"` | Base64 payload / static image / read-only note. | `maxByteLength` |

---

## 3. Complete Web Backend + Generic React Frontend Example

### Node.js Backend (Express / Fastify / NestJS)

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

// 2. Active in-memory sessions (persistable to a DB via session.toJSON())
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
  const session = sessions.get(sessionId)!;
  return session.setParameters(patch); // { changed, addedParameters, removedParameters, addedComObjects, removedComObjects, state }
}

// PUT /api/sessions/:id/com-objects/:number -> Bind Group Addresses, flags & Data Secure mode
function linkComObject(
  sessionId: string,
  comObjectNumber: number,
  body: { sending?: string; listening?: string[]; security?: "plain" | "auth_only" | "auth_conf" },
) {
  const session = sessions.get(sessionId)!;
  return session.linkGroupObject(comObjectNumber, body);
}

// GET /api/sessions/:id/export -> Persist config JSON (use includeSecrets: false for untrusted clients)
function exportConfig(sessionId: string, forBrowser = false) {
  const session = sessions.get(sessionId)!;
  return session.toJSON({ includeSecrets: !forBrowser });
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
    {
      mode: "ap1",
      dryRun: false,
      sessionOptions: keyring ? { secure: true } : undefined,
      onProgress,
    },
    runtimeSec,
  );
  return { ok: true, result };
}
```

### Generic Frontend (React / TypeScript)

```tsx
// Renders ANY parameter of ANY manufacturer from session.getUiState()
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
        <select
          disabled={item.readOnly}
          value={item.value}
          onChange={(e) => onChange(item.paramRefId, e.target.value)}
        >
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

When the user changes a parameter, the frontend calls `PATCH /api/sessions/:id/parameters` with `{ [paramRefId]: newValue }` and updates its state with `response.state`: channels, sub-blocks, and ComObjects automatically appear or disappear exactly like in ETS.

---

## 4. Complete `DeviceConfigSession` Reference

| Method | Description |
| --- | --- |
| `new DeviceConfigSession(source, initialConfig?)` | Creates a session from `ParsedKnxProd` or `KnxApplicationProgram`, with optional initial config (`DeviceApplicationConfig` or `SerializedDeviceConfig`). |
| `DeviceConfigSession.fromJSON(source, json, runtimeSecurity?)` | Restores a session from a `SerializedDeviceConfig` object or JSON string generated by `toJSON()`. |
| `getCatalogSummary()` | Static metadata: IDs, `MaskVersion`, `managementModel`, ETS plugin/DCA detection (`requiresDca`, `extension`), available/loaded languages, table limits, hardware/products, and Data Secure capabilities. |
| `getUiState({ includeAccessNone? })` | Returns the full JSON-serializable `DeviceUiState` (`Access="None"` internal parameters hidden by default). |
| `getParameter(key)` / `getComObject(target)` | Looks up a single parameter (by `paramRefId`, `paramId`, or `name`) or active Communication Object (by `number`, `name`, `comObjectId`, or `comObjectRefId`). |
| `findParameters(query, { onlyVisible?, limit? })` | Searches parameters by localized label, name, or ID (ideal for search bars on 15,000+ parameter catalogs). |
| `findComObjects(query, { onlyActive?, limit? })` | Searches Communication Objects by label, function text, name, number, or linked Group Address. |
| `setParameter(key, value)` / `setParameters(patch)` | Updates one or more parameters, re-evaluates `<Dynamic>` & `<ParameterCalculation>`, and returns `ConfigMutationResult` with exact diffs + updated `state`. |
| `resetParameter(key)` / `resetAllParameters()` | Resets one or all parameters back to catalog defaults from the `.knxprod`. |
| `linkGroupObject(target, spec)` / `unlinkGroupObject(target)` | Binds/unbinds Group Addresses (`"1/0/1"`, `["1/0/1", "1/0/2"]`, or `{ sending, listening, flags, security }`). |
| `setGroupObjectFlags(target, flags)` | Overrides `communication`, `read`, `write`, `transmit`, `update`, `readOnInit` flags and transmission `priority`. |
| `setGroupObjectSecurity(target, mode)` | Sets per-object KNX Data Secure mode: `"plain"` (`0x00`), `"auth_only"` (`0x01`), or `"auth_conf"` (`0x03`). |
| `setSecurityConfig(patch)` / `setKeyring(keyring)` | Configures `enabled`, `keyring`, `groupKeys`, `defaultGroupSecurityMode`, `authorizedSenders`, `p2pKeys`, `toolKey`, `enableSecurityMode`, `initialSequenceNumberSending`. |
| `ensureSecurityKeys(options?)` | Automatically generates random 16-byte AES-128 keys for all active linked secure ComObjects missing a key (and optionally a `ToolKey`), storing them into `options.keyring` (attaching it to the session) or `session.security.groupKeys`. Skips `"plain"` ComObjects. |
| `exportToKeyring(options)` | Merges this device's active secure Group Keys, `ToolKey`, `SequenceNumber`, `SerialNumber`, and optional `<Interface>` group sender entries into a `KnxKeyring` (new or existing multi-device project keyring) ready for `.knxkeys` export. |
| `validate(runtimeSecurity?)` | Returns `{ valid, errors, warnings }` with structured codes (`REQUIRES_ETS_DCA`, `HAS_ETS_UI_PLUGIN`, `VALUE_BELOW_MIN`, `VALUE_ABOVE_MAX`, `INVALID_ENUM_VALUE`, `TEXT_TOO_LONG`, `INVALID_GROUP_ADDRESS`, `MISSING_GROUP_KEY`, `INVALID_INDIVIDUAL_ADDRESS`, `SECURITY_TABLE_OVERFLOW`, `NO_AUTHORIZED_SENDERS`, etc.). |
| `toJSON({ includeSecrets? })` | Serializes to portable `SerializedDeviceConfig` (`schemaVersion: 1`). Pass `{ includeSecrets: false }` to strip raw AES keys. |
| `compile(runtimeSecurity?)` | Compiles to `CompiledSystemBImage` (Objects 1–4 + optional Object 17 `securityImage`). |
| `planDownload(options?, runtimeSecurity?)` | Generates the full `DownloadPlan` and estimated bytes to write without touching the bus. |
| `download(programmer, ia, options?, runtimeSecurity?)` | Executes pre-flight + download (or `dryRun: true`) on the physical device via `KNXDeviceProgrammer`. |

---

## 5. Programming a Device WITHOUT KNX IP Secure or KNX Data Secure (Plain Mode)

If your target device **does not use KNX Data Secure** (standard KNX devices or Secure devices operating in plain mode) and your gateway/USB link does not use KNX IP Secure, **you do not need `KnxKeyring`, `KnxDataSecure`, or `sessionOptions: { secure: true }`**:

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

// 2. Configure parameters & Group Address links (no security section needed)
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

In KNX Data Secure, each Communication Object (Group Object) has a 1-byte entry in **`PID_GO_SECURITY_FLAGS`** inside the Security Interface Object (Type 17) controlling how it transmits and validates telegrams on its Group Addresses:

| Mode in `knx.ts` | `PID_GO_SECURITY_FLAGS` Byte | Encrypts DPT Payload | 4 B MAC + 48-bit SeqNr | When to use |
| --- | --- | --- | --- | --- |
| **`"auth_conf"` (A+C)** | `0x03` (`SAI = 1`) | **Yes** (AES-128-CCM) | **Yes** | **Recommended default (ETS standard).** Prevents eavesdropping, tampering, and replay attacks. |
| **`"auth_only"` (A-only)** | `0x01` (`SAI = 0`) | **No** (cleartext payload) | **Yes** | Payload stays readable for passive diagnostics/monitors, while receivers reject forged or replayed telegrams. |
| **`"plain"` (Unsecured)** | `0x00` | **No** | **No** | Classic KNX telegram. Enables **mixed-mode installations** on the same device (some channels encrypted alongside legacy plain devices). |

> **Interoperability rule:** Every device bound to the same Group Address must share the exact same **16-byte Group Key** and the **same mode** (`auth_conf`, `auth_only`, or `plain`). In addition, every secure receiver must have the Individual Addresses of its senders registered in `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (`authorizedSenders`).

### Case A: Factory-New Device (`FDSK → ToolKey`, `03_05_03` §1.5.4.4–5)

If the device has never been commissioned in secure mode (it still uses its factory **FDSK** printed on the QR code/label), first set its `ToolKey`:

```typescript
const commissioned = await programmer.commissionSecureDevice("1.1.1", {
  fdsk: "0123456789ABCDEF0123456789ABCDEF", // 16-byte FDSK (hex, base64, or Buffer)
  // toolKey: "..." // Optional: CSPRNG-generated if omitted
  initialSequenceNumberSending: "auto", // ms since 2018-01-05T00:00:00Z (03_05_03 §1.5.4.1)
  enableSecurityMode: true,
  restartAfterCommissioning: true, // Confirmed Restart (eraseCode = 0x01)
});

// IMPORTANT! Store commissioned.toolKeyHex securely in your project/keyring
console.log("New ToolKey assigned:", commissioned.toolKeyHex);
```

### Case B: Application + Object 17 Download with `.knxkeys` (Already Commissioned Device)

When the device already has a `ToolKey` (for example in a `.knxkeys` file exported from ETS), open the transport with `KnxDataSecure` and pass `sessionOptions: { secure: true }`:

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

const parsed = await KnxProdParser.parseFile("Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod", {
  language: "en-US",
});
const keyring = KnxKeyring.fromSource("testKey/PRUEBA-ACTUALIZADO.knxkeys", "123456789");
const dataSecure = new KnxDataSecure({
  keyring,
  sourceAddress: "1.1.200",
  sequenceNumberFile: "testKey/seq_state.json",
});

const tunnel = new KNXTunneling({
  ip: "192.168.0.204",
  port: 3671,
  connectionType: ConnectionType.TUNNEL_CONNECTION,
  individualAddress: "1.1.200",
  transport: "UDP",
  dataSecure,
});
await tunnel.connect();

const session = new DeviceConfigSession(parsed);
session.setParameters({
  bOutput: 1,
  "outputCh[0].type": 1,
  "indOutput[0].bEnabled": 1,
});
session.linkGroupObject(765, { sending: "1/0/1", security: "auth_conf" });
session.linkGroupObject(766, { sending: "1/1/1", security: "auth_conf" });
session.setSecurityConfig({
  enabled: true,
  keyring,
  authorizedSenders: ["1.1.200"], // Every sender authorized to transmit to 1/0/1
});

const programmer = new KNXDeviceProgrammer(tunnel, { sourceAddress: "1.1.200", dataSecure });

try {
  const result = await session.download(programmer, "1.1.1", {
    mode: "ap1",
    dryRun: false, // Set to true to inspect without writing to flash
    sessionOptions: { secure: true },
    onProgress: (ev) => console.log(`[${ev.percent}%] (${ev.phase}) ${ev.message}`),
  });
  console.log("Download complete:", result.bytesWritten, "bytes in", result.durationMs, "ms");
} finally {
  dataSecure.saveState();
  tunnel.disconnect();
}
```

> **Note on `ToolKey` rotation:** When rotating `toolKey` during a download, `KNXDeviceProgrammer` writes `PID_TOOL_KEY`, sends `A_Restart` encrypted with the still-active old key, and rotates the local `KnxDataSecure` manager immediately after restart.

### Critical Rule: `authorizedSenders` (`PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`)

In KNX Data Secure, every device stores an allowlist of **authorized sender Individual Addresses** (PID 54). If your app/interface (`1.1.200`) or a wall switch (`1.1.5`) sends an encrypted `GroupValue_Write` to `1/0/1`, the actuator (`1.1.1`) **will discard the telegram** unless `1.1.200` and `1.1.5` are registered in its `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`.

- `SystemBCompiler` automatically includes:
  1. All IAs in `security.authorizedSenders`.
  2. All IAs declared as `Senders="..."` in the `.knxkeys` file for the linked secure Group Addresses (unless `includeKeyringSenders: false`).
  3. All peer IAs declared in `security.p2pKeys`.
- If `session.validate()` detects secure Group Objects with `0` authorized senders, it emits the `NO_AUTHORIZED_SENDERS` warning.

---

## 7. Autonomous `.knxkeys` Management & Export (`KnxKeyring`, ETS-Free Workflow)

`KnxKeyring` does not just read ETS `.knxkeys` files: it is a **complete zero-external-dependency builder, editor, and exporter**, 100% compliant with the official `http://knx.org/xml/keyring/1` schema (interoperable with **ETS 5**, **ETS 6**, **Home Assistant / `xknx`**, **Calimero**, and **`knx.ts`**).

### How `KnxKeyring` Protects Keys & `.knxkeys` Integrity

1. **Export key derivation**: `PBKDF2-HMAC-SHA256(password, salt = "1.keyring.ets.knx.org", iterations = 65536, 16 bytes)`.
2. **Initialization Vector (IV)**: first 16 bytes of `SHA-256(Created)` (the exact ISO timestamp written in `Created="..."`).
3. **AES-128-CBC encryption**:
   - **16-byte binary keys** (`Backbone/@Key`, `GroupAddresses/Group/@Key`, `Devices/Device/@ToolKey`): raw AES-128-CBC (no padding) → Base64.
   - **Text passwords** (`Interface/@Password`, `Interface/@Authentication`, `Device/@ManagementPassword`, `Device/@Authentication`): 8 random bytes (CSPRNG) + UTF-8 password + PKCS#7 padding → AES-128-CBC → Base64.
4. **Integrity signature (`Signature="..."`)**: canonical XML tree walk (attributes sorted alphabetically excluding `xmlns` and `Signature`) + `Base64(passwordHash)` → first 16 bytes of `SHA-256` as Base64. Any tampering or wrong password fails verification.
5. **Output format (`KeyringExportOptions`)**:
   - `format: "xml"` *(default)* with `includeBom: true`: UTF-8 XML with BOM matching native ETS 5 / ETS 6 `.knxkeys` exports.
   - `format: "zip"`: standard DEFLATE ZIP archive wrapping the signed XML entry (for external tools requiring ZIP).
   - `groupAddressFormat: "3-level"` *(default, e.g. `"1/0/1"`, ETS 6 / `xknx`)* or `"integer"` *(e.g. `"2049"`, strict legacy ETS 5 compatibility)*.

### Complete `KnxKeyring` Reference

| Method | Description |
| --- | --- |
| `KnxKeyring.create({ project?, createdBy?, created? })` | Creates an empty keyring ready to be populated and exported. |
| `KnxKeyring.fromSource(source, password, { validateSignature? })` | Loads, verifies the signature, and decrypts a `.knxkeys` from a file path, raw XML, Base64, or `Buffer` (XML or ZIP). |
| `KnxKeyring.generateKey()` | Generates a random 16-byte AES-128 key using `crypto.randomBytes(16)`. |
| `setBackbone({ key?, multicastAddress?, latency? })` / `clearBackbones()` | Configures the KNX IP Secure Multicast Routing key (`key: "generate"` or omitted generates 16 random bytes). |
| `setGroupKey(address, key?)` | Adds/updates the 16-byte key for a GA (`"1/0/1"`, `"1/1"`, or `2049`), generating a random one if `key` is omitted. Returns the 16-byte `Buffer`. |
| `ensureGroupKey(address)` | Idempotently returns the existing key for `address` or generates, stores, and returns a new 16-byte key. |
| `removeGroupKey(address)` | Removes a Group Address key entry. |
| `setDevice({ individualAddress, toolKey?, managementPassword?, authentication?, sequenceNumber?, serialNumber?, merge? })` | Adds or updates a `<Device>`. Accepts `toolKey: "generate"`, 48-bit `bigint`/`number` `sequenceNumber`, and `serialNumber` (`Buffer` 6 B or hex). `merge: true` (default) preserves unspecified existing fields. |
| `removeDevice(individualAddress)` | Removes a device from the keyring. |
| `setInterface({ individualAddress, type?, host?, userId?, password?, authentication?, groupAddresses?, merge? })` | Adds or updates an `<Interface>` (`"Tunnelling"`, `"Backbone"`, `"USB"`). |
| `addInterfaceGroupSender(interfaceIa, groupAddress, senderIa, interfaceType?)` | Registers one or more authorized sender IAs in `<Interface><Group Address="..." Senders="..." />`. |
| `removeInterface(individualAddress)` | Removes an interface from the keyring. |
| `syncFromDataSecure(dataSecure, options?)` / `dataSecure.syncToKeyring(keyring, options?)` | Pulls Group Keys, `ToolKey`s, `SerialNumber`s, and live 48-bit Sequence Numbers (`SequenceNumber = LastValidSeqNr + 1` per `03_03_07` §5.3.2) to keep the `.knxkeys` synchronized with the bus. |
| `toXml(password, options?)` | Returns the encrypted and signed XML document as a `string`. |
| `toBuffer(password, options?)` | Returns the `.knxkeys` file ready to send over HTTP or save (`Buffer`, XML with BOM or ZIP). |
| `saveFile(filePath, password, options?)` | Writes the `.knxkeys` file directly to disk (auto-creating parent directories). |
| `getBackbone()` / `getInterfaces()` / `getInterface(ia?)` / `getGroupAddresses()` / `getGroupKey(ga)` / `getGroupSenders(ga)` / `getDevices()` / `getDevice(ia)` / `getDeviceToolKey(ia)` | Query the decrypted keyring contents. |

### Example 1: Autonomous End-to-End Workflow Without ETS (Factory FDSK → Program → Export `.knxkeys`)

This workflow lets your own web application or backend commission factory-new KNX Data Secure devices and deliver a standard `.knxkeys` file to the customer at the end:

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

// 1. Create the project keyring (can accumulate N devices)
const projectKeyring = KnxKeyring.create({
  project: "NorthBuilding",
  createdBy: "MyKNXPlatform 1.0",
});

// Optional: also add Secure Multicast Routing (Backbone)
projectKeyring.setBackbone({
  multicastAddress: "224.0.23.12",
  latency: 2000,
  key: "generate",
});

// 2. Prepare transport and KNX Data Secure manager
const dataSecure = new KnxDataSecure({
  sourceAddress: "1.1.200",
  sequenceNumberFile: "./sec/seq_state.json",
});

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
  // 3. Initial factory commissioning of device 1.1.1 (FDSK -> new ToolKey)
  //    (Skip this step if the device already has a ToolKey assigned)
  const comm = await programmer.commissionSecureDevice("1.1.1", {
    fdsk: "0123456789ABCDEF0123456789ABCDEF", // FDSK from the device QR/label
    enableSecurityMode: true,
    restartAfterCommissioning: true,
  });

  // 4. Parameterize the device with DeviceConfigSession and link GAs with their security modes
  const parsed = await KnxProdParser.parseFile("Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod", {
    language: "en-US",
  });
  const session = new DeviceConfigSession(parsed);
  session.setParameters({
    bOutput: 1,
    "outputCh[0].type": 1,
    "indOutput[0].bEnabled": 1,
  });
  session.linkGroupObject(765, { sending: "1/0/1", security: "auth_conf" }); // A+C
  session.linkGroupObject(766, { sending: "1/1/1", security: "auth_conf" }); // A+C
  session.setSecurityConfig({
    enabled: true,
    authorizedSenders: ["1.1.200"],
  });

  // 5. Auto-generate AES-128 keys for secure GAs missing a key
  //    (stored directly into projectKeyring and attached to the session)
  const { generatedGroupKeys } = session.ensureSecurityKeys({ keyring: projectKeyring });
  console.log("Generated group keys:", Object.keys(generatedGroupKeys));

  // Load the new group keys into the Data Secure runtime
  dataSecure.loadFromKeyring(projectKeyring);

  // 6. Validate and download encrypted application + Object 17
  const check = session.validate();
  if (!check.valid) throw new Error(JSON.stringify(check.errors));

  const dl = await session.download(programmer, "1.1.1", {
    mode: "ap1",
    dryRun: false,
    sessionOptions: { secure: true },
  });

  // 7. Export this device (ToolKey, SerialNumber, GAs, and interface senders) into the keyring
  session.exportToKeyring({
    keyring: projectKeyring,
    individualAddress: "1.1.1",
    toolKey: comm.toolKey,
    serialNumber: dl.preflight?.serialNumber,
    dataSecure,
    interfaceAddress: "1.1.200",
    interfaceType: "Tunnelling",
  });

  // 8. Sync live 48-bit sequence numbers and export the signed .knxkeys file
  projectKeyring.syncFromDataSecure(dataSecure);
  projectKeyring.saveFile("./exports/NorthBuilding.knxkeys", "ExportPassword#2026");

  // In a REST API, you can return the file as a direct download without touching disk:
  // const fileBuffer = projectKeyring.toBuffer("ExportPassword#2026");
  // res.setHeader("Content-Disposition", 'attachment; filename="NorthBuilding.knxkeys"');
  // res.end(fileBuffer);
} finally {
  dataSecure.saveState();
  tunnel.disconnect();
}
```

### Example 2: Importing, Editing & Re-Exporting an Existing ETS `.knxkeys`

```typescript
import { KnxKeyring } from "knx.ts";

// Load an existing keyring exported from ETS 5 / ETS 6
const keyring = KnxKeyring.fromSource("testKey/PRUEBA-ACTUALIZADO.knxkeys", "123456789");

// Add a new device and new secure Group Addresses
const newLightKey = keyring.ensureGroupKey("2/0/1");
keyring.setDevice({
  individualAddress: "1.1.50",
  toolKey: "generate",
  sequenceNumber: 1n,
  serialNumber: "007100AABBCC",
});
keyring.addInterfaceGroupSender("1.1.200", "2/0/1", ["1.1.50", "1.1.200"]);

// Re-export with a freshly calculated signature (all previous ETS keys are re-encrypted under the new password)
keyring.saveFile("./PRUEBA-V2.knxkeys", "NewSecurePassword", {
  groupAddressFormat: "3-level", // Use "integer" only for strict compatibility with legacy ETS 5
  format: "xml",                 // Use "zip" if the target system requires a ZIP container
});
```

---

## 8. Download Modes, Supported Architectures (`MaskVersion`), Pre-Flight & Transports

### Download Modes (`options.mode`)

| Mode | What gets reprogrammed | When to use |
| --- | --- | --- |
| `"ap1"` *(default)* | Full application (Obj 4 on System B, or full `"all"` / `ProductProcedure` on BCU1/BCU2/BIM M112/Couplers/System 300) + tables + **Object 17** (if security enabled) + `Restart` | First download or full application change. |
| `"full"` | Same as `"ap1"`, plus Object 5 (PEI Application 2) if present in the `.knxprod`. | Devices with a secondary PEI application. |
| `"grp"` | Group tables only (`GrAT`/`GrOAT`/`GrOT`, or filter table on `MV-091A`/`2920` couplers) + **Object 17** + `Restart`. | Fast Group Address, filter table, or security key/flag updates. |
| `"par,grp"` | Parameters (Obj 4 with `Mode=0`) + group tables (Obj 1–3) + **Object 17** + `Restart`. | Partial update of parameters and group links. |
| `"par"` | Parameters only. Does not reprogram Object 17 unless `programSecurityObject: true`. | Fast parameter tweaking when the same application is already loaded. |
| `"unload"` | Unloads (`UNLOAD` / `MasterReset` on `MV-2920` / EEPROM clear on BCU1) the loaded application. | Clearing the loaded application from the device. |

### Supported Architectures (`MaskVersion`) & Automatic DCA / Plugin Detection

| Family / `ManagementModel` | `MaskVersion` (`DD0`) | Support in `knx.ts` | Key technical details |
| --- | --- | --- | --- |
| **System B** (`SystemB`) | `MV-07B0`, `17B0`, `27B0`, `57B0` | **Full** | `RelativeSegment`, Realisation Type 7 tables (`GrAT`/`GrOAT` Format 0–1/`GrOT`), Extended Memory, KNX Data Secure (Obj 17). |
| **System B Couplers** (`SystemB`) | `MV-2920` | **Full** | Dynamic `PID_IO_LIST` (`ObjType=6`) resolution, `LdCtrlClearLCFilterTable`, 8 KB filter table, automatic `PID_HOP_COUNT` (`0004` Area / `0005` Line), `LdCtrlMasterReset`. |
| **System 7 / BIM M112** (`BimM112`) | `MV-0700`, `0701`, `0705`, `1900`, `2705`, `5705` | **Full** | `ProductProcedure`, `AbsoluteSegment`, `LdCtrlAbsSegment`, `LdCtrlTaskSegment`/`TaskCtrl1`/`TaskCtrl2`, masked `CompareProp`, Realisation Type 2 tables (preserves 2-byte RAM pointers & 0-based ComObjects). |
| **System 2 / BCU2** (`Bcu2`) | `MV-0020`, `0021`, `0025` | **Full** | `AbsoluteSegment`, `UserMemory`, `LdCtrlAbsSegment`/`TaskPtr`/`TaskCtrl2`/`Delay`/`CompareMem`, Realisation Type 1 tables (1-byte pointers), downward mask compatibility (`DownwardCompatibleMasks`). |
| **System 1 / BCU1 & Couplers** (`Bcu1`) | `MV-0010`–`0013`, `1011`–`1013`, `091A`, `0912` | **Full** | Pure memory-only BCU1 EEPROM (`0x0100–0x01FF`, `A_Memory_Write` without Interface Objects); `MV-091A`/`0912` couplers with `ObjType=6`, `ClearLCFilterTable`, and 8 KB `LcFilter` memory. |
| **System 300** (`PropertyBased`) | `MV-0300` | **Full** | Compiles `<Property>`-mapped parameters into `propertyWrites` and writes them via `A_PropertyValue_Write`. |
| **ETS Binary Plugins / DCA** | Any `MaskVersion` declaring `EtsDownloadPlugin` / `EtsDataHandler` / `RequiresExternalSoftware` / `DownloadInfoIncomplete` | **Detected & safely blocked (requires ETS)** | Proprietary `.NET`/Windows ETS DLLs cannot run outside ETS. `DeviceConfigSession.validate()` reports `REQUIRES_ETS_DCA` and `KNXDeviceProgrammer.download()` aborts before writing (unless `allowDcaOverride: true`). |

> **Recommendation for legacy hardware (`MV-0012`, `MV-0021`, `MV-0701`, `MV-0705`, `MV-091A`):** always run with `dryRun: true` first to verify `MaskVersion`, manufacturer ID, and the planned actions before writing to EEPROM/flash.

### Automatic Pre-Flight Safety Guards (`verifyDeviceBeforeWrite: true`)

Before sending any `UNLOAD` command or writing memory, `KNXDeviceProgrammer` checks:

1. **`MaskVersion` (`DD0`)**: aborts if it does not match the `.knxprod` nor is downward-compatible via `<DownwardCompatibleMasks>` (e.g. physical `MV-0021` hardware accepts `MV-0020`/`MV-0012` apps), and warns if `0xFFFF` is returned due to a missing Data Secure session.
2. **`ManufacturerId`**: verifies `PID_MANUFACTURER_ID` (or EEPROM `0x0104` on pure memory-only BCU1 devices without Interface Objects) and aborts if the physical device's manufacturer differs from the catalog.
3. **`PID_HARDWARE_TYPE` (`strictHardwareTypeCheck: true`)**: verifies the exact hardware fingerprint (e.g. `0071000049B0` on MAXinBOX 66 v3) to prevent flashing firmware from one model onto another.
4. **Auto-detection of `PID_MAX_APDULENGTH`, `PID_IO_LIST`, and `GrOAT`**: automatically tunes write chunk sizes (subtracting the 13 bytes of `S-A_Data` overhead in secure sessions), resolves object indices by `ObjType`/`Occurrence` (e.g. `ObjType=6` on couplers), and recompiles `GrOAT` to Format 0 or Format 1 on System B based on what the live device reports.

### Supported Transports

`KNXDeviceProgrammer` works identically over any `KNXService`:

- **KNXnet/IP Tunneling** (`KNXTunneling`, UDP, plain TCP, or KNX IP Secure TCP)
- **KNX USB** (`KNXUSBConnection` in `cEMI` mode, with multi-frame HID fragmentation up to 305 B)
- **KNXnet/IP Routing** (`KNXnetIPServer`, plain multicast or IP Secure Routing)
- **TP-UART / TP-UART2 / NCN5120** (`TPUARTConnection`, extended TP1 frames `FT=0` + `U_L_DataOffset`)

### Differential Delta Downloads (`LoadedImage`)

When updating parameters on an already-programmed device (`mode: "par"` or `mode: "par,grp"`), you can persist the previous compiled image with `encodeKnxTsLoadedImage()` and supply its segments back on the next download. `LoadProcedureEngine` automatically forces non-erasing segment allocation (`Mode=0`, guarded by `CompareProp` on `PID_TABLE_REFERENCE`) and writes **only the changed byte spans**:

```ts
import { encodeKnxTsLoadedImage, decodeKnxTsLoadedImage } from "knx.ts";

// After an initial full download, persist the compact zlib+Base64 snapshot:
const snapshotStr = encodeKnxTsLoadedImage(fullResult.image);

// Later, after editing parameters, run a fast byte-level delta download:
const prev = decodeKnxTsLoadedImage(snapshotStr);
const deltaResult = await session.download(programmer, "1.1.1", {
  mode: "par",
  previousSegments: prev?.segments,
  previousAbsoluteSegments: prev?.absoluteSegments,
});
console.log("Delta bytes written:", deltaResult.bytesWritten);
```

### KNXnet/IP Parameter Object Commissioning (Object Type 11)

`KNXDeviceProgrammer` auto-discovers Object Type 11 via `PID_IO_LIST` and reads/writes network parameters (`03_08_03` §2.5) on any KNXnet/IP Interface or Router:

```ts
const ipCfg = await programmer.readIpInterfaceConfig("1.1.0");
console.log(ipCfg.ipAddress, ipCfg.macAddress, ipCfg.friendlyName, ipCfg.additionalIndividualAddresses);

await programmer.configureIpInterface("1.1.0", {
  ipAssignmentMethod: "Fixed", // or "Auto" | "DHCP" | { manual: true }
  ipAddress: "192.168.1.50",
  subnetMask: "255.255.255.0",
  defaultGateway: "192.168.1.1",
  routingMulticastAddress: "224.0.23.12",
  ttl: 16,
  friendlyName: "Main KNX Router",
  additionalIndividualAddresses: ["1.1.240", "1.1.241"],
});
```

### Live Device Diagnostics ("Device Info") & Catalog Baggages

```ts
// 1. Read complete JSON-serializable ETS "Device Info" diagnostics from any device on the bus
const diag = await programmer.readDeviceDiagnostics("1.1.1", {
  // sessionOptions: { secure: true }, // if Data Secure is active on this device
});
console.log(diag.maskVersionHex, diag.serialNumber, diag.applicationIdInfo, diag.loadStates, diag.groupAddressTable);

// 2. Extract embedded TypePicture / icon / PDF baggages from .knxprod or DeviceConfigSession
const ui = session.getUiState();
const picField = ui.parameters.find((p) => p.widget === "picture");
if (picField?.baggageRefId) {
  const asset = session.readBaggage(picField.baggageRefId);
  console.log(asset?.filename, asset?.mimeType, asset?.size); // Buffer ready for HTTP response
}
```

---

## 9. Configuration JSON Schema (`SerializedDeviceConfig` / `CONFIG_JSON`)

`SerializedDeviceConfig` is the compact JSON payload produced by **`session.toJSON()`**, restored by **`DeviceConfigSession.fromJSON(parsed, json)`**, and accepted by the repository CLI via `CONFIG_JSON`. Normally your web app produces it automatically, though it can also be hand-authored and version-controlled.

### Supported Fields

| Field | Required | Description |
| --- | --- | --- |
| `schemaVersion` | **Yes** | Always `1`. |
| `applicationId` | **Yes** | `ApplicationProgram` ID from the `.knxprod` catalog (e.g. `"M-0071_A-49B1-21-F03B"`). If it does not match the loaded `.knxprod`, `fromJSON` warns or fails depending on compatibility. |
| `language` | No | Informational language tag used when authoring the config (e.g. `"en-US"`, `"es-ES"`). |
| `parameters` | **Yes** | Map `{ "<key>": "<value>" }` of non-default parameter overrides. `<key>` may be `paramRefId` (recommended because it is globally unique, e.g. `"M-0071_A-49B1-21-F03B_P-1_R-4"`), `paramId`, or `name` (e.g. `"bOutput"`). Values are stored as strings (e.g. `"1"`, `"0"`, `"250"`). |
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

> **Important note:** This CLI script is available **if you cloned the `KNX.ts` repository** (`git clone https://github.com/Wesxt/KNX.ts.git && npm install`). If you installed `knx.ts` as an npm dependency in your own project, use the TypeScript API (`KnxProdParser`, `DeviceConfigSession`, `KNXDeviceProgrammer`) shown in the previous sections.

[program_device_manual.ts](../manual-tests/program_device_manual.ts) lets you test offline compilation, live dry-runs, or real hardware downloads straight from the terminal without writing custom code. It always defaults to **`DRY_RUN=true`** to prevent accidental flash writes.

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `KNXPROD` | `Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod` | Path to the `.knxprod` file. |
| `CONFIG_JSON` | *(empty — factory defaults)* | Path to a `SerializedDeviceConfig` JSON file (see [Section 9](#9-configuration-json-schema-serializeddeviceconfig--config_json)). |
| `KNX_LANG` | *(empty)* | Translation language (e.g. `en-US`, `es-ES`, `de-DE`). |
| `OFFLINE` | `false` | When `true`, only parses, validates, compiles, and prints the download plan without opening a transport. |
| `DRY_RUN` | `true` | When `true`, runs live pre-flight checks on the bus but **does not write** to flash. Set `false` to write. |
| `MODE` | `ap1` | Download mode (`ap1`, `full`, `par`, `grp`, `par,grp`, `unload`). |
| `TRANSPORT` | `tunnel` | Transport: `tunnel`, `usb`, or `routing`. |
| `KNX_IP` / `KNX_PORT` | `192.168.0.204` / `3671` | KNXnet/IP gateway IP address and port. |
| `KNX_LOCAL_IA` | *(gateway-assigned)* | Local Individual Address (e.g. `1.1.200`). |
| `USB_PATH` / `USB_IA` | *(auto-detect)* | USB HID device path and hardware IA (when `TRANSPORT=usb`). |
| `TARGET_DEVICE` | `1.1.1` | Individual Address of the target device to program. |
| `KNX_KEYRING_FILE` / `KNX_KEYRING_PASSWORD` | *(empty — plain mode)* | **Optional.** Only needed if the device/gateway uses KNX Data Secure or KNX IP Secure. |
| `KNX_IP_SECURE` | `false` | Set `true` to use KNX IP Secure (TCP Tunneling or Multicast Routing). |
| `PROGRAM_SECURITY_OBJECT` | `false` | Forces `security.enabled = true` even if not set in `CONFIG_JSON`. |
| `KNX_SEQ_FILE` | `testKey/seq_state.json` | Persistence file for 48-bit sequence counters (only used with Data Secure). |

### Example Commands (After Cloning the Repository)

#### A) Device & Gateway WITHOUT Security (Plain Mode, No `.knxkeys`)

```bash
# 1) Offline compile & plan in English (no hardware required)
OFFLINE=true KNX_LANG=en-US \
KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_plain.json" \
npm run manualTest:program

# 2) Live plain UDP Tunneling dry-run (read-only pre-flight check, no flash writes)
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

#### B) Device WITH KNX Data Secure (Object 17 + `.knxkeys`)

```bash
# 1) Live Data Secure dry-run over IP Tunneling (read-only)
KNX_IP=192.168.0.204 KNX_LOCAL_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNX_LANG=en-US KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="testKey/project.knxkeys" KNX_KEYRING_PASSWORD="myPassword" \
npm run manualTest:program

# 2) Real download (DRY_RUN=false) over IP Tunneling with Data Secure + Object 17
DRY_RUN=false MODE=ap1 KNX_IP=192.168.0.204 KNX_LOCAL_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNX_LANG=en-US KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="testKey/project.knxkeys" KNX_KEYRING_PASSWORD="myPassword" \
npm run manualTest:program

# 3) Real Data Secure download over KNX USB (cEMI)
DRY_RUN=false TRANSPORT=usb USB_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNX_LANG=en-US KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="testKey/project.knxkeys" KNX_KEYRING_PASSWORD="myPassword" \
npm run manualTest:program

# 4) Fast update of Group Address tables + Object 17 only (MODE=grp)
DRY_RUN=false MODE=grp KNX_IP=192.168.0.204 KNX_LOCAL_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNXPROD="path/to/product.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="testKey/project.knxkeys" KNX_KEYRING_PASSWORD="myPassword" \
npm run manualTest:program
```

---

## 11. Troubleshooting

| Symptom / Error | Cause | Fix |
| --- | --- | --- |
| `MaskVersion mismatch: device reports 0xffff` | Device has KNX Data Secure active and was queried in plain mode. | Load the `.knxkeys` into `KnxDataSecure` and pass `sessionOptions: { secure: true }`. |
| Actuator ignores encrypted `GroupValue_Write` after download | Sender IA (e.g. `1.1.200` or a wall switch) was not included in `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`. | Add the sender IA(s) to `security.authorizedSenders` and re-download with `MODE=grp` (or `MODE=ap1`). |
| `Hardware verification failed (Obj 0 PID 78)` | Selected `.knxprod` does not match the physical hardware model of the target device. | Verify `TARGET_DEVICE` and load the exact `.knxprod` for that hardware model/revision. |
| `MISSING_GROUP_KEY` in `session.validate()` | A linked ComObject is in `auth_conf`/`auth_only` mode but its Group Address has no 16-byte AES key. | Add the key to `security.groupKeys`, attach a `KnxKeyring` containing that GA, or set `security: "plain"` on that object. |
| Timeout or rejection in `S-A_Sync` / sequence errors | Out-of-sync 48-bit sequence counter or `ToolKey` mismatch with the device. | Persist `sequenceNumberFile` across runs, verify the `.knxkeys` password/version, and ensure `KNX_LOCAL_IA` matches `dataSecure.sourceAddress`. |
| `REQUIRES_ETS_DCA` / `proprietary ETS Download Plugin` error | The `.knxprod` declares a proprietary ETS binary plugin (`EtsDownloadPlugin`, `EtsDataHandler`, `RequiresExternalSoftware`, or `DownloadInfoIncomplete`). | Use ETS to download that specific device (or pass `allowDcaOverride: true` only after verifying its standard XML memory segments are sufficient). |
