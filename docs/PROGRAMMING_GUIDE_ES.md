# Guía Completa de Programación KNX (`.knxprod`), API de Parametrización Web y KNX Data Secure (Fase 2)

> English version: see [PROGRAMMING_GUIDE.md](./PROGRAMMING_GUIDE.md)

`knx.ts` incluye un stack completo y sin dependencias externas para **leer catálogos oficiales `.knxprod` de ETS**, **parametrizar dispositivos dinámicamente desde aplicaciones externas/web**, **compilar imágenes binarias multi-arquitectura (System B, System 7 BIM M112, System 2 BCU2, System 1 BCU1, Acopladores y System 300)**, **comisionar seguridad KNX Data Secure (Security Interface Object Type 17)** y **descargar la aplicación directamente a dispositivos físicos KNX** por Tunneling IP, KNX USB (`cEMI`), Routing o TP-UART.

---

## 1. Arquitectura y flujo completo

```text
  Archivo .knxprod (ZIP con knx_master.xml, Hardware.xml, M-xxxx_A-*.xml)
         │
         ▼
  KnxProdParser (streaming XML, soporta catálogos de 60+ MB e idiomas)
         │
         ▼
  DeviceConfigSession ◄──► App Web / API REST / WebSocket (JSON 100% serializable)
    │   • getUiState()    -> canales, bloques, parámetros tipados, ComObjects traducidos
    │   • setParameter()  -> re-evalúa <Dynamic>, <Assign>, JS calcs y devuelve diffs
    │   • validate()      -> valida rangos, GAs, límites de tablas y claves AES
    │   • toJSON()/fromJSON() -> guarda y restaura borradores compactos en BD
         │
         ▼
  DynamicEvaluator ──► SystemBCompiler / KNXApplicationCompiler
                       (System B + System 7/2/1 + Couplers + System 300 + Object 17)
         │
         ▼
  LoadProcedureEngine (fusiona knx_master.xml / ProductProcedure + LdCtrl* + ProgramSecurityObject)
         │
         ▼
  KNXDeviceProgrammer (Pre-flight, verificación HW, fragmentación APDU, descarga, Restart)
         │
         ▼
  KNXManagement / KnxDataSecure ──► Tunneling IP / KNX USB / Routing / TP-UART ──► Bus KNX
```

### Capacidades soportadas

| Componente | Detalles técnicos conforme al Estándar KNX v3.0.0 |
| --- | --- |
| **Parser `.knxprod`** (`ZipReader`, `KnxProdParser`) | Lector ZIP/ZIP64 nativo (`node:zlib`) y parser XML en streaming. Extrae `knx_master.xml` (`HawkConfigurationData`, `MaskVersions` y `DownwardCompatibleMasks`), `Hardware.xml`, `Baggages.xml` (extracción binaria perezosa con tipo MIME para `TypePicture`, iconos y PDFs) y `ApplicationProgram` (incluyendo tablas estáticas `<AddressTable>`/`<AssociationTable>`/`<ComObjectTable>`, `<AbsoluteSegment>`/`<RelativeSegment>` y detección automática de plugins/DCA en `<Extension>`), descubre idiomas (`availableLanguages`) y carga traducciones (`<Languages>`) bajo demanda. |
| **Evaluador `<Dynamic>`** (`DynamicEvaluator`) | Punto fijo sobre `<choose>`/`<when>` (`!=`, `<`, `<=`, `>`, `>=`, rangos `a..b`, OR por espacios), `<Assign>`, `<ModuleDef>`/`<Module>`/`<Repeat>`/`<Allocator>`, placeholders `{{0:texto}}`, ComObjects 1-based (System B) y 0-based (BCU1/BCU2/BIM M112) y `<ParameterCalculation>` + `<Script>` en sandbox `node:vm`. |
| **Compilador Multi-Arquitectura** (`SystemBCompiler` / `KNXApplicationCompiler`) | Compila **System B** (`MV-07B0`/`17B0`/`27B0`/`2920`/`57B0`: Obj 1 `GrAT`, Obj 2 `GrOAT` Format 0/1, Obj 3 `GrOT` Type 7, Obj 4 `RelativeSegment` con `CRC16-CCITT`), **System 7 BIM M112** (`MV-0700`/`0701`/`0705`: `AbsoluteSegment` + Type 2 preservando punteros RAM de 2 B), **System 2 BCU2 / System 1 BCU1** (`MV-0021`/`0012`: `AbsoluteSegment` + Type 1 con punteros de 1 B y `UserMemory`), **Acopladores** (`MV-091A`/`2920`: bitmask 8 KB `compileCouplerFilterTable`), **System 300** (`MV-0300`: `propertyWrites`) y **spans diferenciales delta** (`encodeKnxTsLoadedImage` / `decodeKnxTsLoadedImage`). |
| **Configuración IP y Diagnóstico** (`KNXDeviceProgrammer`, `KNXManagementSession`) | Auto-descubre y lee/escribe el **KNXnet/IP Parameter Object (Object Type 11)** (`readIpInterfaceConfig` / `configureIpInterface`: IP, máscara, puerta de enlace, bitmask DHCP/Manual, multicast, TTL, nombre amigable e IAs adicionales de túnel) y ejecuta diagnóstico en vivo solo-lectura tipo **Device Info de ETS** (`readDeviceDiagnostics`). |
| **Fase 2 — Data Secure** (`compileSecurityObjectImage`, `KNXDeviceProgrammer`) | Compila y programa **Security Interface Object (Type 17)**: `PID_LOAD_STATE_CONTROL` (5), `PID_P2P_KEY_TABLE` (52), `PID_GRP_KEY_TABLE` (53), `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (54), `PID_TOOL_KEY` (56), `PID_SEQUENCE_NUMBER_SENDING` (59), `PID_GO_SECURITY_FLAGS` (61) y `PID_SECURITY_MODE` (51). Incluye comisionamiento inicial de fábrica **`FDSK → ToolKey`** (`commissionSecureDevice`). |
| **Keyring `.knxkeys`** (`KnxKeyring`) | Lector, constructor/editor y **exportador sin dependencias** compatible con ETS 5, ETS 6, Home Assistant (`xknx`) y `KNX.ts`: cifrado AES-128-CBC con PBKDF2-HMAC-SHA256, firma canónica `Signature` SHA-256, generación CSPRNG de claves, exportación XML (UTF-8 BOM) o ZIP, direcciones 3-niveles (`1/0/1`) o enteras ETS5 (`2049`), y sincronización de contadores de 48 bits con `KnxDataSecure`. |
| **API Web / Externa** (`DeviceConfigSession`) | Sesión con estado, 100% serializable a JSON, con árbol UI jerárquico, diffs en vivo al editar parámetros, buscador de parámetros/ComObjects, validación estructurada, generación automática de claves (`ensureSecurityKeys`), exportación a keyring (`exportToKeyring`) y serialización portable (`schemaVersion: 1`). |

---

## 2. Cómo debe integrarlo una App Web (`DeviceUiState` vs `SerializedDeviceConfig`)

El error más común al diseñar una interfaz web sobre KNX es intentar que el frontend conozca nombres internos del fabricante (como `"bOutput"` o `"765"`). **Con `DeviceConfigSession` el frontend nunca hardcodea ningún parámetro de ningún fabricante.**

Existen **dos estructuras JSON con propósitos distintos**:

| JSON | Método que lo produce | Quién lo usa | Para qué sirve |
| --- | --- | --- | --- |
| **`DeviceUiState`** | `session.getUiState()` | **Frontend Web** (React, Vue, Angular, móvil) | Árbol completo y traducido de la pantalla de configuración actual (`channels -> blocks -> items` + `comObjects` + `security` + `stats`). El frontend solo pinta estos widgets genéricos. |
| **`SerializedDeviceConfig`** | `session.toJSON()` | **Backend / Base de datos** | Foto compacta de los cambios del usuario (`schemaVersion: 1`, `parameters`, `groupLinks`, `security`). Se guarda en BD y luego se rehidrata con `DeviceConfigSession.fromJSON(parsed, json)`. |

### Estructura de `DeviceUiState` (`session.getUiState()`)

```json
{
  "catalog": {
    "applicationId": "M-0071_A-49B1-21-F03B",
    "name": "MAXinBOX 66 v3 2.1",
    "visibleDescription": "Actuador multifunción con 6 salidas y 6 entradas con KNX Secure.",
    "isSecureEnabled": true,
    "loadedLanguage": "es-ES",
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
          "label": "Configuración",
          "blocks": [],
          "items": [
            {
              "kind": "separator",
              "text": "Todas las escenas salvadas en el dispositivo se perderán.",
              "uiHint": "Information"
            },
            {
              "kind": "parameter",
              "paramId": "M-0071_A-49B1-21-F03B_P-1",
              "paramRefId": "M-0071_A-49B1-21-F03B_P-1_R-4",
              "name": "bOutput",
              "label": "Salidas",
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
      "label": "[S1][] Encender/Apagar",
      "functionText": "N.A. (0 = Abrir relé; 1 = Cerrar relé)",
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

### Mapa de widgets para tu componente genérico de Frontend

Cada elemento de `block.items` tiene `kind: "parameter"` o `kind: "separator"`:

| `item.kind` / `item.widget` | Cómo renderizarlo en la UI Web | Propiedades útiles |
| --- | --- | --- |
| `kind: "separator"` | Banner informativo, subtítulo o línea divisoria según `item.uiHint` (`"Information"`, `"Headline"`, `"HorizontalRuler"`, `"Error"`). | `text`, `uiHint` |
| `widget: "checkbox"` | Interruptor / Checkbox (`"1"` = activo, `"0"` = inactivo). | `label`, `value`, `readOnly` |
| `widget: "select"` | Desplegable (`<select>`) o grupo de radios con `item.options`. | `options: [{ value, label }]`, `value` |
| `widget: "number"` | Input numérico entero con validación `min`/`max`. | `min`, `max`, `suffixText` (`"s"`, `"ms"`, `"%"`) |
| `widget: "float"` | Input decimal (ej. DPT 9 temperatura o IEEE-754). | `min`, `max`, `floatEncoding`, `suffixText` |
| `widget: "text"` | Campo de texto respetando límite en bytes y expresión regular. | `maxByteLength`, `pattern` |
| `widget: "color"` | Selector de color (`RGB` / `RGBW` hex). | `colorSpace` |
| `widget: "ip"` | Campo dirección IPv4/IPv6. | `ipVersion` |
| `widget: "time"` | Duración / tiempo con unidad. | `unit`, `min`, `max` |
| `widget: "raw"` / `"picture"` / `"none"` | Carga Base64 / imagen estática / etiqueta informativa. | `maxByteLength` |

---

## 3. Ejemplo completo: Backend API REST + Frontend React genérico

### Backend Node.js (Express / Fastify / NestJS)

```typescript
import {
  DeviceConfigSession,
  KNXDeviceProgrammer,
  KnxKeyring,
  KnxProdParser,
  ParsedKnxProd,
} from "knx.ts";

// 1. Cachear catálogos parseados por archivo + idioma (parsear 64 MB tarda ~0.5 s una sola vez)
const catalogCache = new Map<string, ParsedKnxProd>();
async function getCatalog(knxprodPath: string, language = "es-ES"): Promise<ParsedKnxProd> {
  const key = `${knxprodPath}::${language}`;
  let parsed = catalogCache.get(key);
  if (!parsed) {
    parsed = await KnxProdParser.parseFile(knxprodPath, { language });
    catalogCache.set(key, parsed);
  }
  return parsed;
}

// 2. Sesiones activas en memoria (pueden persistirse en BD con session.toJSON())
const sessions = new Map<string, DeviceConfigSession>();

// POST /api/sessions -> Crea o restaura una sesión de configuración
async function createSession(sessionId: string, knxprodPath: string, savedJson?: string, language = "es-ES") {
  const parsed = await getCatalog(knxprodPath, language);
  const session = savedJson
    ? DeviceConfigSession.fromJSON(parsed, savedJson)
    : new DeviceConfigSession(parsed);
  sessions.set(sessionId, session);
  return session.getUiState();
}

// PATCH /api/sessions/:id/parameters -> Aplica uno o varios cambios y devuelve diffs + nuevo árbol UI
function patchParameters(sessionId: string, patch: Record<string, string | number | boolean>) {
  const session = sessions.get(sessionId)!;
  return session.setParameters(patch); // { changed, addedParameters, removedParameters, addedComObjects, removedComObjects, state }
}

// PUT /api/sessions/:id/com-objects/:number -> Enlaza direcciones de grupo, flags y nivel Data Secure
function linkComObject(
  sessionId: string,
  comObjectNumber: number,
  body: { sending?: string; listening?: string[]; security?: "plain" | "auth_only" | "auth_conf" },
) {
  const session = sessions.get(sessionId)!;
  return session.linkGroupObject(comObjectNumber, body);
}

// GET /api/sessions/:id/export -> Guarda en BD (usar includeSecrets: false si viaja al navegador)
function exportConfig(sessionId: string, forBrowser = false) {
  const session = sessions.get(sessionId)!;
  return session.toJSON({ includeSecrets: !forBrowser });
}

// POST /api/sessions/:id/download -> Valida y descarga al dispositivo KNX físico
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

### Frontend genérico (React / TypeScript)

```tsx
// Renderiza CUALQUIER parámetro de CUALQUIER fabricante desde session.getUiState()
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

Cuando el usuario cambia un parámetro, el frontend llama a `PATCH /api/sessions/:id/parameters` con `{ [paramRefId]: newValue }` y actualiza su estado con `response.state`: los canales, sub-bloques y ComObjects aparecen o desaparecen automáticamente exactamente igual que en ETS.

---

## 4. Referencia completa de `DeviceConfigSession`

| Método | Descripción |
| --- | --- |
| `new DeviceConfigSession(source, initialConfig?)` | Crea una sesión a partir de `ParsedKnxProd` o `KnxApplicationProgram`, con configuración inicial opcional (`DeviceApplicationConfig` o `SerializedDeviceConfig`). |
| `DeviceConfigSession.fromJSON(source, json, runtimeSecurity?)` | Restaura una sesión desde un objeto o string JSON generado por `toJSON()`. |
| `getCatalogSummary()` | Metadatos estáticos del catálogo: IDs, `MaskVersion`, `managementModel`, detección de plugins/DCA (`requiresDca`, `extension`), idiomas disponibles/cargados, límites de tablas, hardware/productos y capacidades Data Secure. |
| `getUiState({ includeAccessNone? })` | Devuelve el estado completo de UI (`DeviceUiState`), 100% serializable a JSON. Por defecto oculta parámetros internos `Access="None"`. |
| `getParameter(key)` / `getComObject(target)` | Obtiene un parámetro (por `paramRefId`, `paramId` o `name`) o un ComObject activo (por `number`, `name`, `comObjectId` o `comObjectRefId`). |
| `findParameters(query, { onlyVisible?, limit? })` | Búsqueda por texto traducido, nombre o ID (ideal para barras de búsqueda en catálogos de 15.000+ parámetros). |
| `findComObjects(query, { onlyActive?, limit? })` | Búsqueda de Objetos de Comunicación por etiqueta, función, nombre, número o dirección de grupo enlazada. |
| `setParameter(key, value)` / `setParameters(patch)` | Modifica uno o varios parámetros, re-evalúa `<Dynamic>` y `<ParameterCalculation>` y retorna `ConfigMutationResult` con diffs exactos y el nuevo `state`. |
| `resetParameter(key)` / `resetAllParameters()` | Restablece uno o todos los parámetros a sus valores por defecto del `.knxprod`. |
| `linkGroupObject(target, spec)` / `unlinkGroupObject(target)` | Enlaza/desenlaza direcciones de grupo (`"1/0/1"`, `["1/0/1", "1/0/2"]` o `{ sending, listening, flags, security }`). |
| `setGroupObjectFlags(target, flags)` | Sobrescribe flags `communication`, `read`, `write`, `transmit`, `update`, `readOnInit` y `priority`. |
| `setGroupObjectSecurity(target, mode)` | Define el modo KNX Data Secure por objeto: `"plain"` (`0x00`), `"auth_only"` (`0x01`) o `"auth_conf"` (`0x03`). |
| `setSecurityConfig(patch)` / `setKeyring(keyring)` | Configura `enabled`, `keyring`, `groupKeys`, `defaultGroupSecurityMode`, `authorizedSenders`, `p2pKeys`, `toolKey`, `enableSecurityMode`, `initialSequenceNumberSending`. |
| `ensureSecurityKeys(options?)` | Genera automáticamente claves AES-128 aleatorias (16 B) para todos los ComObjects seguros activos sin clave (y opcionalmente un `ToolKey`), almacenándolas en `options.keyring` (y adjuntándolo a la sesión) o en `session.security.groupKeys`. Ignora los ComObjects en modo `"plain"`. |
| `exportToKeyring(options)` | Vuelca las claves de grupo activas, `ToolKey`, `SequenceNumber`, `SerialNumber` y enlaces de emisores de `<Interface>` de este dispositivo en un `KnxKeyring` (nuevo o existente multi-dispositivo) listo para exportar a `.knxkeys`. |
| `validate(runtimeSecurity?)` | Retorna `{ valid, errors, warnings }` con códigos estructurados (`REQUIRES_ETS_DCA`, `HAS_ETS_UI_PLUGIN`, `VALUE_BELOW_MIN`, `VALUE_ABOVE_MAX`, `INVALID_ENUM_VALUE`, `TEXT_TOO_LONG`, `INVALID_GROUP_ADDRESS`, `MISSING_GROUP_KEY`, `INVALID_INDIVIDUAL_ADDRESS`, `SECURITY_TABLE_OVERFLOW`, `NO_AUTHORIZED_SENDERS`, etc.). |
| `toJSON({ includeSecrets? })` | Serializa la configuración a `SerializedDeviceConfig` (`schemaVersion: 1`). Con `includeSecrets: false` omite claves AES. |
| `compile(runtimeSecurity?)` | Compila a `CompiledSystemBImage` (Objetos 1–4 + `securityImage` Object 17 si aplica). |
| `planDownload(options?, runtimeSecurity?)` | Genera el plan completo de pasos (`DownloadPlan`) y bytes estimados sin tocar el bus. |
| `download(programmer, ia, options?, runtimeSecurity?)` | Ejecuta la descarga (o `dryRun: true`) en el dispositivo físico con `KNXDeviceProgrammer`. |

---

## 5. Programar un dispositivo SIN KNX IP Secure ni KNX Data Secure (Modo Plano)

Si tu dispositivo KNX **no utiliza KNX Data Secure** (equipos clásicos o dispositivos Secure con seguridad desactivada) y tu pasarela/USB no usa KNX IP Secure, **no necesitas `KnxKeyring`, ni `KnxDataSecure`, ni `sessionOptions: { secure: true }`**. El flujo es totalmente directo:

```typescript
import {
  ConnectionType,
  DeviceConfigSession,
  KNXDeviceProgrammer,
  KNXTunneling,
  KnxProdParser,
} from "knx.ts";

// 1. Parsear el catálogo .knxprod (opcionalmente con idioma)
const parsed = await KnxProdParser.parseFile("./producto.knxprod", { language: "es-ES" });

// 2. Configurar parámetros y enlaces de grupo (sin sección security)
const session = new DeviceConfigSession(parsed);
session.setParameters({
  bOutput: 1,
  "outputCh[0].type": 1,
  "indOutput[0].bEnabled": 1,
});
session.linkGroupObject(765, { sending: "1/0/1" }); // Control Salida 1 (en plano)
session.linkGroupObject(766, { sending: "1/1/1" }); // Estado Salida 1 (en plano)

// Opcional: validar antes de conectar al bus
const check = session.validate();
if (!check.valid) {
  throw new Error(`Configuración inválida: ${JSON.stringify(check.errors, null, 2)}`);
}

// 3. Conectar a la pasarela KNXnet/IP por UDP plano (o usar KNXUSBConnection / TPUARTConnection)
const tunnel = new KNXTunneling({
  ip: "192.168.0.204",
  port: 3671,
  connectionType: ConnectionType.TUNNEL_CONNECTION,
  individualAddress: "1.1.200", // Opcional: si se omite, la pasarela asigna una IA
  transport: "UDP",
});
await tunnel.connect();

// 4. Crear el programador (sin dataSecure) y ejecutar la descarga
const programmer = new KNXDeviceProgrammer(tunnel, {
  sourceAddress: tunnel.individualAddress,
});

try {
  // Recomendado primero: dryRun: true para comprobar MaskVersion, fabricante y HardwareType sin escribir flash
  const result = await session.download(programmer, "1.1.1", {
    mode: "ap1",     // "ap1" (app completa + tablas) o "grp" (solo direcciones de grupo)
    dryRun: false,   // Pon true para inspección de solo lectura
    onProgress: (ev) => console.log(`[${ev.percent}%] (${ev.phase}) ${ev.message}`),
  });

  console.log(`Programación plana completada: ${result.bytesWritten} B en ${result.durationMs} ms`);
} finally {
  tunnel.disconnect();
}
```

> **Alternativa directa sin `DeviceConfigSession`:** si ya conoces los nombres exactos de parámetros y no necesitas el árbol UI, puedes llamar directamente a `programmer.download("1.1.1", parsed, { parameters: { ... }, groupLinks: { 765: "1/0/1", 766: "1/1/1" } }, { mode: "ap1" })`.

---

## 6. Fase 2: Comisionamiento KNX Data Secure (Object Type 17)

### Modos de seguridad por Objeto de Comunicación (`auth_conf`, `auth_only`, `plain`)

En KNX Data Secure, cada Objeto de Comunicación (Group Object) tiene 1 byte en la tabla **`PID_GO_SECURITY_FLAGS`** del Security Interface Object (Type 17) que controla cómo emite y valida telegramas en sus Direcciones de Grupo:

| Modo en `knx.ts` | Byte `PID_GO_SECURITY_FLAGS` | Cifra payload (DPT) | MAC 4 B + SeqNr 48 bits | Cuándo usarlo |
| --- | --- | --- | --- | --- |
| **`"auth_conf"` (A+C)** | `0x03` (`SAI = 1`) | **Sí** (AES-128-CCM) | **Sí** | **Recomendado y por defecto.** Evita lectura/espionaje del valor en el bus, manipulación de telegramas y ataques de repetición (*replay*). |
| **`"auth_only"` (Solo A)** | `0x01` (`SAI = 0`) | **No** (en claro) | **Sí** | El valor viaja legible para diagnósticos/monitores pasivos, pero el receptor rechaza cualquier telegrama falsificado o repetido. |
| **`"plain"` (Sin cifrar)** | `0x00` | **No** | **No** | Telegrama KNX clásico. Permite **instalaciones mixtas** en un mismo dispositivo (algunas salidas cifradas y otras en plano para convivir con equipos antiguos). |

> **Regla de interoperabilidad:** Todos los dispositivos enlazados a una misma Dirección de Grupo deben usar exactamente la **misma clave de grupo de 16 bytes** y el **mismo modo** (`auth_conf`, `auth_only` o `plain`). Además, cada receptor seguro exige tener las Direcciones Individuales de sus emisores en `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` (`authorizedSenders`).

### Caso A: Dispositivo nuevo de fábrica (`FDSK → ToolKey`, `03_05_03` §1.5.4.4–5)

Si el dispositivo nunca ha sido comisionado en modo seguro (aún usa su **FDSK** de fábrica impresa en el código QR/etiqueta), primero establece su `ToolKey`:

```typescript
const commissioned = await programmer.commissionSecureDevice("1.1.1", {
  fdsk: "0123456789ABCDEF0123456789ABCDEF", // FDSK de 16 bytes (hex, base64 o Buffer)
  // toolKey: "..." // Opcional: si se omite se genera aleatoriamente con CSPRNG
  initialSequenceNumberSending: "auto", // ms desde 2018-01-05T00:00:00Z (03_05_03 §1.5.4.1)
  enableSecurityMode: true,
  restartAfterCommissioning: true, // Confirmed Restart (eraseCode = 0x01)
});

// ¡IMPORTANTE! Guarda commissioned.toolKeyHex de forma segura en tu proyecto/keyring
console.log("Nuevo ToolKey asignado:", commissioned.toolKeyHex);
```

### Caso B: Descarga de aplicación + Object 17 con `.knxkeys` (dispositivo ya comisionado)

Cuando el dispositivo ya tiene `ToolKey` (por ejemplo en un `.knxkeys` exportado de ETS), abre el transporte con `KnxDataSecure` y pasa `sessionOptions: { secure: true }`:

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
  language: "es-ES",
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
  authorizedSenders: ["1.1.200"], // Todo emisor autorizado para enviar a 1/0/1
});

const programmer = new KNXDeviceProgrammer(tunnel, { sourceAddress: "1.1.200", dataSecure });

try {
  const result = await session.download(programmer, "1.1.1", {
    mode: "ap1",
    dryRun: false, // Cambiar a true para inspeccionar sin escribir en flash
    sessionOptions: { secure: true },
    onProgress: (ev) => console.log(`[${ev.percent}%] (${ev.phase}) ${ev.message}`),
  });
  console.log("Descarga completada:", result.bytesWritten, "bytes en", result.durationMs, "ms");
} finally {
  dataSecure.saveState();
  tunnel.disconnect();
}
```

> **Nota sobre rotación de `ToolKey`:** Al rotar `toolKey` durante una descarga, `KNXDeviceProgrammer` escribe `PID_TOOL_KEY`, envía `A_Restart` cifrado con la clave anterior todavía activa y rota el gestor local `KnxDataSecure` inmediatamente después del reinicio.

### Regla crítica: `authorizedSenders` (`PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`)

En KNX Data Secure, cada dispositivo guarda una lista blanca de **Direcciones Individuales emisoras autorizadas** (PID 54). Si tu app/interfaz (`1.1.200`) o un pulsador (`1.1.5`) envía un `GroupValue_Write` cifrado a `1/0/1`, el actuador (`1.1.1`) **descartará el telegrama** salvo que `1.1.200` y `1.1.5` estén registrados en su `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`.

- `SystemBCompiler` incluye automáticamente:
  1. Todas las IAs en `security.authorizedSenders`.
  2. Todas las IAs declaradas como `Senders="..."` en el `.knxkeys` para los grupos seguros enlazados (salvo `includeKeyringSenders: false`).
  3. Todas las IAs compañeras declaradas en `security.p2pKeys`.
- Si `session.validate()` detecta objetos seguros con `0` emisores autorizados, emite la advertencia `NO_AUTHORIZED_SENDERS`.

---

## 7. Gestión y Exportación Autónoma de `.knxkeys` (`KnxKeyring`, sin depender de ETS)

`KnxKeyring` no solo lee archivos `.knxkeys` de ETS: es un **constructor, editor y exportador completo sin dependencias externas**, 100% conforme al esquema oficial `http://knx.org/xml/keyring/1` (compatible con **ETS 5**, **ETS 6**, **Home Assistant / `xknx`**, **Calimero** y **`knx.ts`**).

### Cómo protege `KnxKeyring` las claves y la firma del `.knxkeys`

1. **Derivación de clave de exportación**: `PBKDF2-HMAC-SHA256(password, salt = "1.keyring.ets.knx.org", iteraciones = 65536, 16 bytes)`.
2. **Vector de inicialización (IV)**: primeros 16 bytes de `SHA-256(Created)` (la marca temporal ISO escrita en el atributo `Created="..."`).
3. **Cifrado AES-128-CBC**:
   - **Claves binarias de 16 bytes** (`Backbone/@Key`, `GroupAddresses/Group/@Key`, `Devices/Device/@ToolKey`): AES-128-CBC sin padding → Base64.
   - **Contraseñas de texto** (`Interface/@Password`, `Interface/@Authentication`, `Device/@ManagementPassword`, `Device/@Authentication`): 8 bytes aleatorios (CSPRNG) + UTF-8 + padding PKCS#7 → AES-128-CBC → Base64.
4. **Firma de integridad (`Signature="..."`)**: recorrido canónico del árbol XML (atributos ordenados alfabéticamente excluyendo `xmlns` y `Signature`) + `Base64(passwordHash)` → primeros 16 bytes de `SHA-256` en Base64. Cualquier alteración o contraseña errónea falla la verificación.
5. **Formato de salida (`KeyringExportOptions`)**:
   - `format: "xml"` *(por defecto)* con `includeBom: true`: archivo XML UTF-8 con BOM idéntico al que exportan ETS 5 y ETS 6.
   - `format: "zip"`: archivo ZIP estándar DEFLATE válido que encapsula el XML firmado (por si alguna herramienta externa exige ZIP).
   - `groupAddressFormat: "3-level"` *(por defecto, ej. `"1/0/1"`, ETS 6 / `xknx`)* o `"integer"` *(ej. `"2049"`, compatibilidad estricta ETS 5)*.

### Referencia completa de `KnxKeyring`

| Método | Descripción |
| --- | --- |
| `KnxKeyring.create({ project?, createdBy?, created? })` | Crea un keyring vacío listo para poblar y exportar. |
| `KnxKeyring.fromSource(source, password, { validateSignature? })` | Carga, valida la firma y descifra un `.knxkeys` desde ruta de archivo, XML, Base64 o `Buffer` (XML o ZIP). |
| `KnxKeyring.generateKey()` | Genera una clave AES-128 aleatoria de 16 bytes usando `crypto.randomBytes(16)`. |
| `setBackbone({ key?, multicastAddress?, latency? })` / `clearBackbones()` | Configura la clave de Routing Multicast Seguro (`key: "generate"` u omitida crea 16 B aleatorios). |
| `setGroupKey(address, key?)` | Añade/actualiza la clave de 16 B de una GA (`"1/0/1"`, `"1/1"` o `2049`). Si omites `key`, genera una aleatoria. Devuelve el `Buffer` de 16 B. |
| `ensureGroupKey(address)` | Devuelve la clave existente de la GA o genera, guarda y devuelve una nueva de 16 B (idempotente). |
| `removeGroupKey(address)` | Elimina la clave de una Dirección de Grupo. |
| `setDevice({ individualAddress, toolKey?, managementPassword?, authentication?, sequenceNumber?, serialNumber?, merge? })` | Añade o actualiza un `<Device>`. Acepta `toolKey: "generate"`, `sequenceNumber` `bigint`/`number` (48 bits) y `serialNumber` (`Buffer` 6 B o hex). Por defecto `merge: true` preserva campos existentes no especificados. |
| `removeDevice(individualAddress)` | Elimina un dispositivo del keyring. |
| `setInterface({ individualAddress, type?, host?, userId?, password?, authentication?, groupAddresses?, merge? })` | Añade o actualiza una `<Interface>` (`"Tunnelling"`, `"Backbone"`, `"USB"`). |
| `addInterfaceGroupSender(interfaceIa, groupAddress, senderIa, interfaceType?)` | Registra una o más IAs emisoras autorizadas en `<Interface><Group Address="..." Senders="..." />`. |
| `removeInterface(individualAddress)` | Elimina una interfaz del keyring. |
| `syncFromDataSecure(dataSecure, options?)` / `dataSecure.syncToKeyring(keyring, options?)` | Vuelca claves de grupo, `ToolKey`s, `SerialNumber`s y contadores de secuencia vivos de 48 bits (`SequenceNumber = LastValidSeqNr + 1` según `03_03_07` §5.3.2) para mantener el `.knxkeys` sincronizado con el bus. |
| `toXml(password, options?)` | Devuelve el XML cifrado y firmado como `string`. |
| `toBuffer(password, options?)` | Devuelve el archivo `.knxkeys` listo para enviar por HTTP o guardar (`Buffer`, XML con BOM o ZIP). |
| `saveFile(filePath, password, options?)` | Escribe el `.knxkeys` directamente a disco (creando carpetas padre si no existen). |
| `getBackbone()` / `getInterfaces()` / `getInterface(ia?)` / `getGroupAddresses()` / `getGroupKey(ga)` / `getGroupSenders(ga)` / `getDevices()` / `getDevice(ia)` / `getDeviceToolKey(ia)` | Consultan los datos descifrados del keyring. |

### Ejemplo 1: Flujo autónomo completo sin ETS (FDSK → Programación → Exportación `.knxkeys`)

Este flujo permite que tu propia aplicación web o backend comisione dispositivos KNX Data Secure nuevos de fábrica y entregue al cliente un archivo `.knxkeys` estándar al finalizar:

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

// 1. Crear el keyring del proyecto (puede acumular N dispositivos)
const projectKeyring = KnxKeyring.create({
  project: "EdificioNorte",
  createdBy: "MiPlataformaKNX 1.0",
});

// Opcional: añadir también Routing Multicast Seguro (Backbone)
projectKeyring.setBackbone({
  multicastAddress: "224.0.23.12",
  latency: 2000,
  key: "generate",
});

// 2. Preparar transporte y gestor KNX Data Secure
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
  // 3. Primera puesta en marcha de fábrica del dispositivo 1.1.1 (FDSK -> nueva ToolKey)
  //    (Omite este paso si el dispositivo ya tenía ToolKey asignada)
  const comm = await programmer.commissionSecureDevice("1.1.1", {
    fdsk: "0123456789ABCDEF0123456789ABCDEF", // FDSK del QR/etiqueta del equipo
    enableSecurityMode: true,
    restartAfterCommissioning: true,
  });

  // 4. Parametrizar el dispositivo con DeviceConfigSession y enlazar GAs con sus modos de seguridad
  const parsed = await KnxProdParser.parseFile("Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod", {
    language: "es-ES",
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

  // 5. Generar automáticamente claves AES-128 para las GAs seguras que aún no tengan clave
  //    (se guardan directamente en projectKeyring y éste queda adjunto a la sesión)
  const { generatedGroupKeys } = session.ensureSecurityKeys({ keyring: projectKeyring });
  console.log("Claves de grupo generadas:", Object.keys(generatedGroupKeys));

  // Cargar las nuevas claves de grupo en el runtime de Data Secure
  dataSecure.loadFromKeyring(projectKeyring);

  // 6. Validar y programar aplicación + Object 17 de forma cifrada
  const check = session.validate();
  if (!check.valid) throw new Error(JSON.stringify(check.errors));

  const dl = await session.download(programmer, "1.1.1", {
    mode: "ap1",
    dryRun: false,
    sessionOptions: { secure: true },
  });

  // 7. Volcar este dispositivo (ToolKey, SerialNumber, GAs y emisores de interfaz) al keyring
  session.exportToKeyring({
    keyring: projectKeyring,
    individualAddress: "1.1.1",
    toolKey: comm.toolKey,
    serialNumber: dl.preflight?.serialNumber,
    dataSecure,
    interfaceAddress: "1.1.200",
    interfaceType: "Tunnelling",
  });

  // 8. Sincronizar los contadores de secuencia de 48 bits vivos y exportar el .knxkeys firmado
  projectKeyring.syncFromDataSecure(dataSecure);
  projectKeyring.saveFile("./exports/EdificioNorte.knxkeys", "PasswordExportacion#2026");

  // En una API REST, puedes devolver el archivo como descarga directa sin tocar disco:
  // const fileBuffer = projectKeyring.toBuffer("PasswordExportacion#2026");
  // res.setHeader("Content-Disposition", 'attachment; filename="EdificioNorte.knxkeys"');
  // res.end(fileBuffer);
} finally {
  dataSecure.saveState();
  tunnel.disconnect();
}
```

### Ejemplo 2: Importar un `.knxkeys` de ETS, modificarlo y re-exportarlo

```typescript
import { KnxKeyring } from "knx.ts";

// Cargar un keyring existente exportado desde ETS 5 / ETS 6
const keyring = KnxKeyring.fromSource("testKey/PRUEBA-ACTUALIZADO.knxkeys", "123456789");

// Añadir un nuevo dispositivo y nuevas direcciones de grupo seguras
const nuevaClaveLuz = keyring.ensureGroupKey("2/0/1");
keyring.setDevice({
  individualAddress: "1.1.50",
  toolKey: "generate",
  sequenceNumber: 1n,
  serialNumber: "007100AABBCC",
});
keyring.addInterfaceGroupSender("1.1.200", "2/0/1", ["1.1.50", "1.1.200"]);

// Re-exportar con firma recalculada (todas las claves previas de ETS se re-cifran con la nueva contraseña)
keyring.saveFile("./PRUEBA-V2.knxkeys", "NuevaClaveSegura", {
  groupAddressFormat: "3-level", // Usar "integer" solo para compatibilidad estricta con ETS 5 antiguo
  format: "xml",                 // Usar "zip" si el sistema destino exige contenedor ZIP
});
```

---

## 8. Modos de descarga, Arquitecturas (`MaskVersion`), Pre-Flight y Transportes

### Modos (`options.mode`)

| Modo | Qué reprograma | Cuándo usarlo |
| --- | --- | --- |
| `"ap1"` *(defecto)* | Aplicación completa (Obj 4 en System B, o procedimiento completo `"all"` / `ProductProcedure` en BCU1/BCU2/BIM M112/Acopladores/System 300) + tablas + **Object 17** (si seguridad activa) + `Restart` | Primera descarga o cambio completo de programa. |
| `"full"` | Igual que `"ap1"`, incluyendo Objeto 5 (PEI Application 2) si existe en el `.knxprod`. | Dispositivos con aplicación PEI secundaria. |
| `"grp"` | Solo tablas de grupos (`GrAT`/`GrOAT`/`GrOT`, o tabla de filtro en acopladores `MV-091A`/`2920`) + **Object 17** + `Restart`. | Cambios rápidos de direcciones de grupo, tabla de filtro o claves/flags de seguridad. |
| `"par,grp"` | Parámetros (Obj 4 con `Mode=0`) + tablas de grupos (Obj 1–3) + **Object 17** + `Restart`. | Actualización parcial de parámetros y enlaces de grupo. |
| `"par"` | Solo parámetros. No reprograma Object 17 salvo `programSecurityObject: true`. | Ajuste rápido de parámetros cuando ya está cargada la misma aplicación. |
| `"unload"` | Descarga (`UNLOAD` / `MasterReset` en `MV-2920` / limpieza EEPROM en BCU1) la aplicación cargada. | Limpiar la aplicación cargada en el dispositivo. |

### Arquitecturas (`MaskVersion`) soportadas y detección de DCA / Plugins

| Familia / `ManagementModel` | `MaskVersion` (`DD0`) | Soporte en `knx.ts` | Detalles técnicos clave |
| --- | --- | --- | --- |
| **System B** (`SystemB`) | `MV-07B0`, `17B0`, `27B0`, `57B0` | **Completo** | `RelativeSegment`, tablas Realisation Type 7 (`GrAT`/`GrOAT` Format 0–1/`GrOT`), Extended Memory, KNX Data Secure (Obj 17). |
| **Acopladores System B** (`SystemB`) | `MV-2920` | **Completo** | Descubrimiento dinámico `PID_IO_LIST` (`ObjType=6`), `LdCtrlClearLCFilterTable`, tabla de filtro 8 KB, `PID_HOP_COUNT` automático (`0004` Área / `0005` Línea), `LdCtrlMasterReset`. |
| **System 7 / BIM M112** (`BimM112`) | `MV-0700`, `0701`, `0705`, `1900`, `2705`, `5705` | **Completo** | `ProductProcedure`, `AbsoluteSegment`, `LdCtrlAbsSegment`, `LdCtrlTaskSegment`/`TaskCtrl1`/`TaskCtrl2`, `CompareProp` con `Mask`, tablas Realisation Type 2 (preserva punteros RAM de 2 B y ComObjects 0-based). |
| **System 2 / BCU2** (`Bcu2`) | `MV-0020`, `0021`, `0025` | **Completo** | `AbsoluteSegment`, `UserMemory`, `LdCtrlAbsSegment`/`TaskPtr`/`TaskCtrl2`/`Delay`/`CompareMem`, tablas Realisation Type 1 (punteros de 1 B), compatibilidad descendente (`DownwardCompatibleMasks`). |
| **System 1 / BCU1 y Acopladores** (`Bcu1`) | `MV-0010`–`0013`, `1011`–`1013`, `091A`, `0912` | **Completo** | BCU1 puro por EEPROM (`0x0100–0x01FF`, `A_Memory_Write` sin Interface Objects); acopladores `MV-091A`/`0912` con `ObjType=6`, `ClearLCFilterTable` y memoria `LcFilter` de 8 KB. |
| **System 300** (`PropertyBased`) | `MV-0300` | **Completo** | Compila parámetros mapeados a `<Property>` en `propertyWrites` y los escribe mediante `A_PropertyValue_Write`. |
| **Plugins binarios / DCA de ETS** | Cualquier `MaskVersion` con `EtsDownloadPlugin` / `EtsDataHandler` / `RequiresExternalSoftware` / `DownloadInfoIncomplete` | **Detección y bloqueo seguro (requiere ETS)** | Las DLLs propietarias `.NET`/Windows de ETS no se ejecutan fuera de ETS. `DeviceConfigSession.validate()` reporta `REQUIRES_ETS_DCA` y `KNXDeviceProgrammer.download()` aborta antes de escribir (salvo `allowDcaOverride: true`). |

> **Recomendación en hardware heredado (`MV-0012`, `MV-0021`, `MV-0701`, `MV-0705`, `MV-091A`):** ejecuta siempre primero con `dryRun: true` para verificar `MaskVersion`, fabricante y plan de acciones antes de escribir en EEPROM/flash.

### Protecciones automáticas antes de escribir (`verifyDeviceBeforeWrite: true`)

Antes de enviar cualquier comando `UNLOAD` o escritura en memoria, `KNXDeviceProgrammer` verifica:

1. **`MaskVersion` (`DD0`)**: aborta si no coincide con el `.knxprod` ni es compatible hacia abajo vía `<DownwardCompatibleMasks>` (ej. un equipo físico `MV-0021` acepta aplicaciones `MV-0020`/`MV-0012`), y avisa si recibe `0xFFFF` por falta de sesión Data Secure.
2. **`ManufacturerId`**: verifica `PID_MANUFACTURER_ID` (o EEPROM `0x0104` en BCU1 puro sin Interface Objects) y aborta si el fabricante difiere del catálogo.
3. **`PID_HARDWARE_TYPE` (`strictHardwareTypeCheck: true`)**: verifica la huella exacta de hardware (ej. `0071000049B0` en MAXinBOX 66 v3) para impedir flashear el firmware de un modelo en otro.
4. **Auto-detección de `PID_MAX_APDULENGTH`, `PID_IO_LIST` y `GrOAT`**: ajusta automáticamente los chunks de escritura (descontando los 13 bytes de `S-A_Data` en sesiones seguras), resuelve índices de objetos por `ObjType`/`Occurrence` (ej. `ObjType=6` en acopladores) y recompila `GrOAT` a Format 0 o Format 1 en System B según reporte el dispositivo en vivo.

### Transportes compatibles

`KNXDeviceProgrammer` funciona de manera idéntica sobre cualquier `KNXService`:

- **KNXnet/IP Tunneling** (`KNXTunneling`, UDP, TCP plano o KNX IP Secure TCP)
- **KNX USB** (`KNXUSBConnection` en modo `cEMI`, con fragmentación HID multi-trama hasta 305 B)
- **KNXnet/IP Routing** (`KNXnetIPServer`, multicast plano o IP Secure Routing)
- **TP-UART / TP-UART2 / NCN5120** (`TPUARTConnection`, tramas extendidas TP1 `FT=0` + `U_L_DataOffset`)

### Descargas Diferenciales Delta (`LoadedImage`)

Al actualizar parámetros en un dispositivo ya programado (`mode: "par"` o `mode: "par,grp"`), puedes guardar la imagen compilada anterior con `encodeKnxTsLoadedImage()` y pasar sus segmentos en la siguiente descarga. `LoadProcedureEngine` fuerza automáticamente la asignación sin borrado (`Mode=0`, protegida por `CompareProp` sobre `PID_TABLE_REFERENCE`) y escribe **únicamente los bloques de bytes modificados**:

```ts
import { encodeKnxTsLoadedImage, decodeKnxTsLoadedImage } from "knx.ts";

// Tras una descarga completa inicial, guarda el snapshot compacto zlib+Base64:
const snapshotStr = encodeKnxTsLoadedImage(fullResult.image);

// Después, tras editar parámetros, ejecuta una descarga delta rápida a nivel de byte:
const prev = decodeKnxTsLoadedImage(snapshotStr);
const deltaResult = await session.download(programmer, "1.1.1", {
  mode: "par",
  previousSegments: prev?.segments,
  previousAbsoluteSegments: prev?.absoluteSegments,
});
console.log("Bytes delta escritos:", deltaResult.bytesWritten);
```

### Comisionamiento de KNXnet/IP Parameter Object (Object Type 11)

`KNXDeviceProgrammer` auto-descubre el Object Type 11 vía `PID_IO_LIST` y lee/escribe parámetros de red (`03_08_03` §2.5) en cualquier Interfaz o Router KNXnet/IP:

```ts
const ipCfg = await programmer.readIpInterfaceConfig("1.1.0");
console.log(ipCfg.ipAddress, ipCfg.macAddress, ipCfg.friendlyName, ipCfg.additionalIndividualAddresses);

await programmer.configureIpInterface("1.1.0", {
  ipAssignmentMethod: "Fixed", // o "Auto" | "DHCP" | { manual: true }
  ipAddress: "192.168.1.50",
  subnetMask: "255.255.255.0",
  defaultGateway: "192.168.1.1",
  routingMulticastAddress: "224.0.23.12",
  ttl: 16,
  friendlyName: "Router KNX Principal",
  additionalIndividualAddresses: ["1.1.240", "1.1.241"],
});
```

### Diagnóstico en Vivo ("Device Info") y Baggages de Catálogo

```ts
// 1. Leer diagnóstico completo serializable a JSON tipo "Device Info" de ETS desde el bus
const diag = await programmer.readDeviceDiagnostics("1.1.1", {
  // sessionOptions: { secure: true }, // si el dispositivo tiene Data Secure activo
});
console.log(diag.maskVersionHex, diag.serialNumber, diag.applicationIdInfo, diag.loadStates, diag.groupAddressTable);

// 2. Extraer imágenes TypePicture / iconos / PDFs embebidos desde .knxprod o DeviceConfigSession
const ui = session.getUiState();
const picField = ui.parameters.find((p) => p.widget === "picture");
if (picField?.baggageRefId) {
  const asset = session.readBaggage(picField.baggageRefId);
  console.log(asset?.filename, asset?.mimeType, asset?.size); // Buffer listo para respuesta HTTP
}
```

---

## 9. Formato del archivo JSON de configuración (`SerializedDeviceConfig` / `CONFIG_JSON`)

El formato `SerializedDeviceConfig` es el JSON compacto que genera **`session.toJSON()`**, que recarga **`DeviceConfigSession.fromJSON(parsed, json)`** y que consume la variable `CONFIG_JSON` del CLI del repositorio. Normalmente lo genera tu aplicación web automáticamente, aunque también puedes crearlo o editarlo a mano.

### Campos soportados

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `schemaVersion` | **Sí** | Siempre `1`. |
| `applicationId` | **Sí** | ID de la `ApplicationProgram` del `.knxprod` (ej. `"M-0071_A-49B1-21-F03B"`). Si no coincide con el `.knxprod` cargado, `fromJSON` avisa o falla según compatibilidad. |
| `language` | No | Idioma usado al crear el borrador (ej. `"es-ES"`, `"en-US"`). Informativo. |
| `parameters` | **Sí** | Mapa `{ "<clave>": "<valor>" }` con solo los parámetros distintos al valor de fábrica. La `<clave>` puede ser `paramRefId` (recomendado por ser único, ej. `"M-0071_A-49B1-21-F03B_P-1_R-4"`), `paramId` o `name` (ej. `"bOutput"`). Los valores se guardan como string (ej. `"1"`, `"0"`, `"250"`). |
| `groupLinks` | **Sí** | Mapa `{ "<comObject>": { sending?, listening?, flags?, security? } }`. La clave es el número 1-based del ComObject (ej. `"765"`) o su `name`.<br>• `sending`: GA emisora principal (ej. `"1/0/1"`).<br>• `listening`: array opcional de GAs adicionales de escucha (ej. `["1/0/2", "1/0/3"]`).<br>• `flags`: sobrescritura opcional de `{ communication, read, write, transmit, update, readOnInit, priority }`.<br>• `security`: opcional (solo si usas Data Secure): `"plain"`, `"auth_only"` o `"auth_conf"`. |
| `security` | No | **Omitir completamente** para dispositivos sin KNX Data Secure. Cuando se usa Data Secure (Object 17) admite:<br>• `enabled`: `true`/`false`.<br>• `defaultGroupSecurityMode`: `"auth_conf"` *(defecto)*, `"auth_only"` o `"plain"`.<br>• `authorizedSenders`: array de emisores permitidos en PID 54 (`[{ "individualAddress": "1.1.200" }]`).<br>• `includeKeyringSenders`: `true` *(defecto)* para heredar emisores del `.knxkeys`.<br>• `groupKeys`: mapa opcional `{ "1/0/1": "<32 hex>" }` (si usas `.knxkeys`, no hace falta poner claves aquí).<br>• `groupObjectSecurityModes`: mapa opcional `{ "765": "auth_conf" }`.<br>• `p2pKeys`: array opcional `[{ "individualAddress": "1.1.5", "key": "<32 hex>", "roles": 1 }]`.<br>• `toolKey`: clave hex de 32 chars opcional para rotar `PID_TOOL_KEY`.<br>• `enableSecurityMode`: `true`/`false` opcional para `PID_SECURITY_MODE`.<br>• `initialSequenceNumberSending`: `"auto"` o entero en string (48 bits). |
| `options` | No | Opciones avanzadas del compilador: `{ runParameterCalculations?, associationTableFormat?: 0 \| 1, clearCommunicationFlagWhenUnlinked?, groupObjectTableSize? }`. |

### Ejemplo A: JSON para un dispositivo SIN KNX Secure (modo plano)

```json
{
  "schemaVersion": 1,
  "applicationId": "M-0071_A-49B1-21-F03B",
  "language": "es-ES",
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

### Ejemplo B: JSON para un dispositivo CON KNX Data Secure (Object 17 + `.knxkeys`)

```json
{
  "schemaVersion": 1,
  "applicationId": "M-0071_A-49B1-21-F03B",
  "language": "es-ES",
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

> **Tip:** si no sabes qué `applicationId`, claves de `parameters` o números de `groupLinks` tiene tu `.knxprod`, abre una `DeviceConfigSession(parsed)` y consulta `session.getCatalogSummary()`, `session.findParameters("...")` y `session.findComObjects("...")` (o exporta directamente con `session.toJSON()`).

---

## 10. Uso del CLI integrado del repositorio (`npm run manualTest:program`)

> **Nota importante:** Este script CLI está disponible **si clonaste el repositorio `KNX.ts`** (`git clone https://github.com/Wesxt/KNX.ts.git && npm install`). Si instalaste `knx.ts` como dependencia npm en tu propia aplicación, utiliza directamente la API TypeScript (`KnxProdParser`, `DeviceConfigSession`, `KNXDeviceProgrammer`) mostrada en las secciones anteriores.

El script [program_device_manual.ts](../manual-tests/program_device_manual.ts) te sirve para probar compilaciones, inspecciones *dry-run* o descargas reales desde terminal sin escribir código propio. Siempre ejecuta con **`DRY_RUN=true` por defecto** para evitar escrituras accidentales en flash.

### Variables de entorno

| Variable | Default | Descripción |
| --- | --- | --- |
| `KNXPROD` | `Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod` | Ruta al archivo `.knxprod`. |
| `CONFIG_JSON` | *(vacío — valores de fábrica)* | Ruta a un archivo JSON `SerializedDeviceConfig` (ver [Sección 9](#9-formato-del-archivo-json-de-configuración-serializeddeviceconfig--config_json)). |
| `KNX_LANG` | *(vacío)* | Idioma de traducciones (ej. `es-ES`, `en-US`, `de-DE`). |
| `OFFLINE` | `false` | Si `true`, solo parsea, valida, compila y muestra el plan sin abrir transporte. |
| `DRY_RUN` | `true` | Si `true`, realiza pre-flight real en el bus pero **no escribe** en flash. Poner `false` para grabar. |
| `MODE` | `ap1` | Modo de descarga (`ap1`, `full`, `par`, `grp`, `par,grp`, `unload`). |
| `TRANSPORT` | `tunnel` | Transporte: `tunnel`, `usb` o `routing`. |
| `KNX_IP` / `KNX_PORT` | `192.168.0.204` / `3671` | IP y puerto de la pasarela KNXnet/IP. |
| `KNX_LOCAL_IA` | *(asignada por gateway)* | Dirección individual local (ej. `1.1.200`). |
| `USB_PATH` / `USB_IA` | *(auto-detect)* | Ruta HID USB e IA de hardware (cuando `TRANSPORT=usb`). |
| `TARGET_DEVICE` | `1.1.1` | Dirección individual del dispositivo objetivo a programar. |
| `KNX_KEYRING_FILE` / `KNX_KEYRING_PASSWORD` | *(vacío — modo plano)* | **Opcionales.** Solo se indican si el dispositivo/pasarela usa KNX Data Secure o KNX IP Secure. |
| `KNX_IP_SECURE` | `false` | `true` para usar KNX IP Secure (TCP Tunneling o Routing multicast). |
| `PROGRAM_SECURITY_OBJECT` | `false` | Fuerza `security.enabled = true` aunque no esté en `CONFIG_JSON`. |
| `KNX_SEQ_FILE` | `testKey/seq_state.json` | Archivo de persistencia de contadores de secuencia de 48 bits (solo si usas Data Secure). |

### Comandos de ejemplo (después de clonar el repositorio)

#### A) Dispositivo y pasarela SIN seguridad (modo plano, sin `.knxkeys`)

```bash
# 1) Compilación y plan offline en español (sin hardware)
OFFLINE=true KNX_LANG=es-ES \
KNXPROD="ruta/al/producto.knxprod" CONFIG_JSON="device_plain.json" \
npm run manualTest:program

# 2) Dry-run en vivo por Tunneling IP UDP plano (solo lectura, no graba flash)
KNX_IP=192.168.0.204 TARGET_DEVICE=1.1.1 \
KNXPROD="ruta/al/producto.knxprod" CONFIG_JSON="device_plain.json" \
npm run manualTest:program

# 3) Descarga real (DRY_RUN=false) en modo plano por Tunneling IP UDP
DRY_RUN=false MODE=ap1 KNX_IP=192.168.0.204 TARGET_DEVICE=1.1.1 \
KNXPROD="ruta/al/producto.knxprod" CONFIG_JSON="device_plain.json" \
npm run manualTest:program

# 4) Descarga real en modo plano por interfaz KNX USB
DRY_RUN=false TRANSPORT=usb TARGET_DEVICE=1.1.1 \
KNXPROD="ruta/al/producto.knxprod" CONFIG_JSON="device_plain.json" \
npm run manualTest:program
```

#### B) Dispositivo CON KNX Data Secure (Object 17 + `.knxkeys`)

```bash
# 1) Dry-run en vivo por Tunneling IP con KNX Data Secure (solo lectura)
KNX_IP=192.168.0.204 KNX_LOCAL_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNX_LANG=es-ES KNXPROD="ruta/al/producto.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="testKey/proyecto.knxkeys" KNX_KEYRING_PASSWORD="miPassword" \
npm run manualTest:program

# 2) Descarga real (DRY_RUN=false) por Tunneling IP con Data Secure + Object 17
DRY_RUN=false MODE=ap1 KNX_IP=192.168.0.204 KNX_LOCAL_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNX_LANG=es-ES KNXPROD="ruta/al/producto.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="testKey/proyecto.knxkeys" KNX_KEYRING_PASSWORD="miPassword" \
npm run manualTest:program

# 3) Descarga real por KNX USB (cEMI) con Data Secure
DRY_RUN=false TRANSPORT=usb USB_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNX_LANG=es-ES KNXPROD="ruta/al/producto.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="testKey/proyecto.knxkeys" KNX_KEYRING_PASSWORD="miPassword" \
npm run manualTest:program

# 4) Actualización rápida solo de direcciones de grupo + Object 17 (MODE=grp)
DRY_RUN=false MODE=grp KNX_IP=192.168.0.204 KNX_LOCAL_IA=1.1.200 TARGET_DEVICE=1.1.1 \
KNXPROD="ruta/al/producto.knxprod" CONFIG_JSON="device_secure.json" \
KNX_KEYRING_FILE="testKey/proyecto.knxkeys" KNX_KEYRING_PASSWORD="miPassword" \
npm run manualTest:program
```

---

## 11. Solución de problemas (Troubleshooting)

| Síntoma / Error | Causa | Solución |
| --- | --- | --- |
| `MaskVersion mismatch: device reports 0xffff` | El dispositivo tiene KNX Data Secure activo y se intentó acceder en plano. | Carga el `.knxkeys` en `KnxDataSecure` y pasa `sessionOptions: { secure: true }`. |
| El actuador ignora `GroupValue_Write` cifrados tras descargar | La Dirección Individual emisora (ej. `1.1.200` o un pulsador) no se incluyó en `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`. | Añade esa IA en `security.authorizedSenders` y reprograma con `MODE=grp` (o `MODE=ap1`). |
| `Hardware verification failed (Obj 0 PID 78)` | El `.knxprod` seleccionado no corresponde al modelo físico del dispositivo objetivo. | Verifica `TARGET_DEVICE` y usa el `.knxprod` exacto de ese modelo/versión de hardware. |
| `MISSING_GROUP_KEY` al ejecutar `session.validate()` | Un ComObject enlazado está en modo `auth_conf`/`auth_only` pero su Dirección de Grupo no tiene clave AES de 16 bytes. | Añade la clave en `security.groupKeys`, adjunta un `KnxKeyring` que contenga esa GA, o cambia el objeto a `security: "plain"`. |
| Timeout o rechazo en `S-A_Sync` / errores de secuencia | Desincronización de contador de 48 bits o `ToolKey` distinto al del dispositivo. | Persiste `sequenceNumberFile` entre ejecuciones, verifica la contraseña/versión del `.knxkeys` y que el `KNX_LOCAL_IA` coincida con `dataSecure.sourceAddress`. |
| Error `REQUIRES_ETS_DCA` / `proprietary ETS Download Plugin` | El `.knxprod` declara un plugin binario propietario de ETS (`EtsDownloadPlugin`, `EtsDataHandler`, `RequiresExternalSoftware` o `DownloadInfoIncomplete`). | Usa ETS para descargar ese dispositivo concreto (o pasa `allowDcaOverride: true` solo si verificaste que sus segmentos XML estándar bastan). |
