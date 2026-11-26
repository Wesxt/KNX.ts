# Guía Completa de Proyectos KNX (`.knxproj`) — Lectura, Creación, Edición, Exportación e Integración Web

> English version: see [KNXPROJ_GUIDE.md](./KNXPROJ_GUIDE.md)

`knx.ts` provee una API sin dependencias externas y 100% serializable a JSON (`KnxProject`, `ZipReader`, `ZipWriter`) para **leer, inspeccionar, crear, modificar, validar y exportar proyectos `.knxproj`** (ETS4 / ETS5 / ETS6), conectada de forma nativa con `DeviceConfigSession`, `KNXDeviceProgrammer` y `KnxKeyring`.

> **Importante sobre catálogos (`.knxprod` y `knx_master.xml`)**:
> `knx.ts` **no incluye ni distribuye catálogos de fabricantes** (`.knxprod`) ni un `knx_master.xml` propietario completo. Cuando trabajas con proyectos nuevos o con programación de dispositivos, **el usuario / aplicación debe suministrar los archivos `.knxprod`** de los fabricantes (ya sea importándolos dentro del proyecto con `importKnxProd()` o resolviéndolos bajo demanda desde tu propio almacén de catálogos mediante `registerCatalogProvider()` o `{ externalKnxProd }`).

---

## 1. Arquitectura y rendimiento en proyectos grandes

Un archivo `.knxproj` es un contenedor ZIP con:

- `P-XXXX/project.xml` — Metadatos (`ProjectInformation`, estilo de GAs, `Guid`, `LastUsedPuid`, `HistoryEntries`, `UserFiles`).
- `P-XXXX/0.xml` (o `P-XXXX.zip` cifrado con ZipCrypto en ETS5 o WinZip AES-256 + PBKDF2 en ETS6, más `1.xml`, `2.xml` en proyectos multi-instalación) — Topología (`Area` → `Line` → `Segment` → `DeviceInstance`), `ParameterInstanceRefs`, `ComObjectInstanceRefs`, `ModuleInstances`, `GroupObjectTree`, `BusInterfaces`, `AdditionalAddresses`, `AdditionalGroupAddresses`, `IPConfig`, `Security`, `Locations`/`Space`/`Function`, `GroupRanges`/`GroupAddress` y `Trades`.
- `knx_master.xml` — DPTs/subtipos, medios, fabricantes, usos de espacio, funciones y `MaskVersions` (`HawkConfigurationData`).
- `M-XXXX/Hardware.xml`, `Catalog.xml`, `Baggages.xml`, `M-XXXX/Baggages/**` y `M-XXXX/M-XXXX_A-*.xml` — Catálogos embebidos de fabricantes (pueden superar los 350+ MB descomprimidos).

### Rendimiento y preservación sin pérdida

1. **Carga perezosa (*lazy*) de `M-XXXX_A-*.xml`**: `KnxProject.fromFile()` / `fromBuffer()` lee en milisegundos `project.xml`, `0.xml`, `knx_master.xml`, `Hardware.xml`, `Catalog.xml` y `Baggages.xml` sin parsear los XML gigantes de aplicación hasta que realmente se necesiten (`loadApplicationProgram()`, `getDeviceDetails(..., { resolveCatalog: true })` o `openDeviceSession()`).
2. **Exportación *zero-recompression passthrough***: Al modificar y re-exportar un `.knxproj` de ETS, `ZipWriter.copyEntryFrom()` copia directamente los bloques comprimidos de `M-XXXX/*`, `Baggages/*` y `knx_master.xml` sin descomprimir ni recomprimir.
3. **Round-trip sin pérdida**: Atributos extra y secciones avanzadas (`LoadedImage`, `CheckSums`, `ModuleInstances`, `GroupObjectTree`, `BusInterfaces`, `AdditionalGroupAddresses`, `SplitInfos`, etc.) se preservan intactos.

---

## 2. Límites reales e importación en ETS5 / ETS6 (leer antes de producción)

Conviene distinguir claramente qué puedes hacer con esta API y qué restricciones impone ETS:

### A. Importar un `.knxproj` creado o modificado de vuelta en ETS5 / ETS6 comercial

- **Firmas criptográficas de ETS**: ETS5 y ETS6 firman el proyecto (`P-XXXX.signature` + `P-XXXX.certificate`) usando la clave privada de la licencia oficial de ETS del usuario, y firman cada carpeta de fabricante (`M-XXXX.signature`) con la clave de KNX Association. **Ninguna herramienta externa puede generar ni falsificar esas firmas privadas.**
- **Consecuencia práctica**:
  - Un `.knxproj` **creado desde cero o modificado** con `KnxProject` cumple el esquema XML oficial (`http://knx.org/xml/project/20`–`23`), omite firmas obsoletas (`P-XXXX.signature`/`.validation`) y preserva las firmas `M-XXXX.signature` de fabricantes no alterados.
  - Es **100% utilizable** por `KNX.ts`, tu propia app web, `xknxproject`/Home Assistant, SCADA/BMS y cualquier software compatible.
  - **Sin embargo, ETS5/ETS6 comercial rechazará la importación directa de un `.knxproj` creado o editado fuera de ETS** al detectar ausencia o discrepancia en la firma de proyecto.
- **Qué SÍ importa ETS5 / ETS6 directamente sin firma de proyecto**:
  - **Direcciones de Grupo XML** (`project.exportGroupAddressesXml()`, esquema oficial `http://knx.org/xml/ga-export/01`).
  - **Direcciones de Grupo CSV** (`project.exportGroupAddressesCsv()`).
  - **Keyring KNX Secure** (`project.exportKeyring().saveFile("keys.knxkeys", password)`).

### B. Catálogos suministrados por el usuario y `knx_master.xml`

- Si creas un proyecto sin importar ningún `.knxprod` ni llamar a `setMasterXml()`, `KnxProject` genera un `knx_master.xml` mínimo con los DPTs principales y fabricantes, pero **sin `MaskVersions`** (`hasOfficialMaskVersions() === false`).
- Para parametrizar o programar dispositivos reales, el usuario debe suministrar:
  1. Los archivos `.knxprod` del fabricante (vía `importKnxProd()`, `registerCatalogProvider()` o `{ externalKnxProd }`).
  2. Un `knx_master.xml` oficial (se adopta automáticamente al importar cualquier `.knxprod`, o manualmente con `project.setMasterXml(pathOrXml)`).

### C. Límites técnicos y de programación física al bus

- **Límites del estándar KNX**: Áreas `0..15`, Líneas `0..15`, Dispositivos por línea `0..255`, Direcciones de Grupo `1..65535` (`0/0/0` reservada).
- **Memoria en Node.js**: `ZipReader` / `ZipWriter` operan sobre `Buffer` en memoria (soportan ZIP64; holgados para `.knxproj` reales de 5–200 MB comprimidos, con límite técnico del `Buffer` de Node.js ~2 GB).
- **Descarga al bus físico (`KNXDeviceProgrammer`)**: El compilador multi-arquitectura (`SystemBCompiler` / `KNXApplicationCompiler`) soporta **System B (`MV-07B0`, `17B0`, `27B0`, `2920`, `57B0`)**, **System 7 / BIM M112 (`MV-0700`, `0701`, `0705`, `1900`, `2705`, `5705`)**, **System 2 / BCU2 (`MV-0020`, `0021`, `0025`)**, **System 1 / BCU1 y acopladores (`MV-0010`–`0013`, `091A`, `0912`)** y **System 300 (`MV-0300` PropertyBased)**. Además, al abrir sesión sobre un acoplador (`openDeviceSession("1.1.0")`), se inyecta automáticamente su tabla de filtro calculada por `computeFilterTables()`.
- **Plugins binarios propietarios de ETS (DCA)**: Los dispositivos que dependen de *Device Configuration Apps* (`.dll` `.NET`/Windows, `EtsDownloadPlugin`, `EtsDataHandler`, `RequiresExternalSoftware="true"` o `DownloadInfoIncomplete="true"`) **siguen requiriendo ETS para la descarga física** porque su lógica binaria no está descrita en el XML. `knx.ts` los detecta automáticamente (`summary.requiresDca === true`, error `REQUIRES_ETS_DCA` en `validate()`), bloquea descargas accidentales en `KNXDeviceProgrammer` y preserva intactos sus `<AddInData>`, `Baggages` y `LoadedImage` dentro del `.knxproj`.

---

## 3. Operaciones principales de la API `KnxProject`

### 3.1 Leer e inspeccionar (proyectos abiertos o protegidos con contraseña)

```ts
import { KnxProject } from "knx.ts";

// Soporta .knxproj sin contraseña, ETS5 (ZipCrypto) y ETS6 (WinZip AES-256 + PBKDF2)
const project = KnxProject.fromFile("Proyecto.knxproj", {
  language: "es-ES",
  // password: "PasswordETS", // solo si está protegido
});

const summary = project.getSummary();
const devices = project.getDevices({ area: 1, line: 1, search: "Zennio" });
const details = await project.getDeviceDetails("1.1.1", { resolveCatalog: true, language: "es-ES" });
const gaLinks = project.getGroupAddressLinks("1/0/1"); // búsqueda inversa
const matrix = project.getCommunicationMatrix({ linkedOnly: true });
const search = project.search("Iluminación", { limit: 30 });
```

### 3.2 Crear desde cero con catálogos suministrados por el usuario

```ts
import { KnxProject } from "knx.ts";

const project = KnxProject.create({
  name: "Edificio Central",
  groupAddressStyle: "ThreeLevel",
  schemaVersion: 20, // o 21/22/23 para ETS6
  // masterXml: "/ruta/knx_master.xml", // opcional: se adopta automáticamente del primer .knxprod
});

// Opción A: incrustar el .knxprod dentro del .knxproj (autocontenido)
const imp = project.importKnxProd("/catalogos_usuario/MAXinBOX_66_v3.knxprod", {
  language: "es-ES",
  embedApplicationXml: true, // pon false si tu backend sirve los .knxprod externamente
});

// Opción B: registrar un proveedor externo para proyectos ligeros sin incrustar 60 MB por dispositivo
project.registerCatalogProvider(async (applicationId, { language }) => {
  const filePath = `/almacen_catalogos/${applicationId}.knxprod`;
  return filePath; // puede devolver ruta, Buffer, ParsedKnxProd o KnxApplicationProgram
});

const prod = project.listCatalogProducts(imp.manufacturerId)[0];
const bldg = project.addSpace({ type: "Building", name: "Edificio Central" });
const room = project.addSpace({ type: "Room", name: "Tablero P1", parentSpaceId: bldg.id });

project.addMainGroup(1, "Iluminación");
project.addMiddleGroup(1, 0, "Piso 1");
project.addGroupAddress({ address: "1/0/1", name: "Luz Oficina 1", datapointType: "1.001" });

const dev = project.addDevice("1.1", {
  address: "auto",
  name: "Actuador 1",
  productRefId: prod.productRefId,
  hardware2ProgramRefId: prod.hardware2ProgramRefIds[0],
  spaceId: room.id,
});
```

### 3.3 Puente completo con `DeviceConfigSession` (incluye `ModuleInstances` y `GroupObjectTree`)

```ts
// Abre sesión interactiva (soporta catálogos embebidos, proveedor externo o { externalKnxProd })
const session = await project.openDeviceSession("1.1.1", {
  language: "es-ES",
  // externalKnxProd: "/catalogos_usuario/mi_equipo.knxprod", // opcional si no está embebido
});

// Editar parámetros (incluidos parámetros dentro de <ModuleDef>/<Repeat>) y enlazar ComObjects
session.setParameters({ bOutput: 1, "outputCh[0].type": 1, "indOutput[0].bEnabled": 1 });
session.linkGroupObject(765, { sending: "1/0/1" });

// Aplica de vuelta al proyecto:
// - Actualiza ParameterInstanceRefs (incluyendo IDs ETS MD-x_M-y_MI-z_P-...)
// - Actualiza ComObjectInstanceRefs y enlaces
// - Sincroniza <ModuleInstances> y regenera <GroupObjectTree>
project.applyDeviceSession("1.1.1", session, {
  autoCreateGroupAddresses: true,
  regenerateGroupObjectTree: true,
  syncModuleInstances: true,
});
```

### 3.4 Tablas de filtro automáticas, `BusInterfaces`, `AdditionalGroupAddresses`, `UserFiles` y Multi-instalación

```ts
// 1. Acopladores y tablas de filtro automáticas (cruce de líneas/áreas + unfiltered + manuales)
project.addLineAdditionalGroupAddress("1.1", "5/0/1");
const filters = project.computeFilterTables();
// filters.lineCouplers[0] -> { couplerAddress: "1.1.0", groupAddresses: [...], filterTableBitmaskHex: "..." }
// filters.areaCouplers[0] -> { couplerAddress: "1.0.0", groupAddresses: [...], filterTableBitmaskHex: "..." }

// 2. BusInterfaces (canales de túnel IP) y direcciones adicionales de gateways
project.setDeviceBusInterface("1.1.1", {
  refId: "M-0071_H-IP-1_BI-1",
  name: "Túnel 1",
  connectors: ["1/0/1"],
});
project.addDeviceAdditionalAddress("1.1.1", { address: 240, name: "Túnel 1 (1.1.240)" });

// 3. Múltiples instalaciones, UserFiles e historial
project.addInstallation({ name: "Edificio Anexo", createDefaultTopology: true });
project.addUserFile("plano_piso1.pdf", pdfBuffer, "Plano eléctrico");
project.addHistoryEntry({ user: "admin", text: "Revisión inicial de iluminación" });
```

### 3.5 Exportación (normal, protegida con contraseña ETS5/ETS6, GA XML, CSV, Keyring y JSON)

```ts
// 1. .knxproj sin contraseña
project.saveKnxProj("out/proyecto.knxproj");

// 2. .knxproj protegido con contraseña (ETS6 AES-256 o ETS5 ZipCrypto)
project.saveKnxProj("out/proyecto_seguro.knxproj", {
  password: "MiPasswordSegura",
  encryption: "ets6", // "ets6" | "ets5" | "auto"
});

// 3. Formatos importables directamente en ETS4/ETS5/ETS6 sin firma de proyecto
const gaXml = project.exportGroupAddressesXml();
const gaCsv = project.exportGroupAddressesCsv({ separator: ";" });
const keyring = project.exportKeyring({ generateMissingGroupKeys: true });
keyring.saveFile("out/proyecto.knxkeys", "PasswordKeyring");

// 4. Persistencia JSON en base de datos
const snapshot = project.toJSON();
const restored = KnxProject.fromJSON(snapshot);
```

---

## 4. Guía paso a paso: Integración en Backend y Frontend (App Web)

### Arquitectura recomendada

```text
┌─────────────────────────────┐         HTTPS / JSON / Binario         ┌───────────────────────────────────────┐
│   Frontend Web              │ ◄────────────────────────────────────► │   Backend (Node.js / Express / Fastify)│
│   (React / Vue / Angular)   │                                        │                                       │
│                             │  • GET  /projects/:id/summary          │  1. Repositorio de .knxprod del       │
│  • Explorador de Topología  │  • GET  /projects/:id/devices          │     usuario (S3 / disco local)        │
│  • Árbol de Edificios/GAs   │  • GET  /projects/:id/group-addresses  │  2. Instancias KnxProject activas +   │
│  • Editor dinámico genérico │  • POST /projects/:id/devices/:ia/edit │     caché de ParsedKnxProd            │
│    (pinta DeviceUiState)    │  • GET  /projects/:id/filter-tables    │  3. BD (guarda snapshots JSON o rutas │
│  • Botón Exportar .knxproj  │  • GET  /projects/:id/export/knxproj   │     a .knxproj en storage)            │
└─────────────────────────────┘                                        └──────────────────┬────────────────────┘
                                                                                          │ (Opcional)
                                                                                          ▼
                                                                           KNXDeviceProgrammer / Bus KNX
```

> **Principio clave de diseño**: el navegador **nunca** debe parsear XMLs de 60 MB ni `.knxproj` de 25 MB. Todo el trabajo pesado (`KnxProject`, `KnxProdParser`, `DeviceConfigSession`, `ZipWriter`) vive en el **Backend Node.js**, y el **Frontend** únicamente consume y edita DTOs JSON ligeros.

---

### Paso 1 (Backend): Repositorio de catálogos `.knxprod` suministrados por el usuario

Tu backend debe permitir que el usuario suba sus propios archivos `.knxprod` (y opcionalmente un `knx_master.xml`) y guardar un índice `{ applicationId -> filePath }`:

```ts
import fs from "node:fs";
import path from "node:path";
import { KnxProdParser, KnxProject, ParsedKnxProd, ZipReader } from "knx.ts";

// Índice simple en tu backend (en producción guárdalo en PostgreSQL / MongoDB / Redis)
const catalogFileByAppId = new Map<string, string>();
const parsedCatalogCache = new Map<string, ParsedKnxProd>();

// Cuando el usuario sube un archivo .knxprod a tu backend:
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

// Inyecta el proveedor externo en cualquier KnxProject que abras o crees:
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

### Paso 2 (Backend): Servicio de sesiones de proyecto y endpoints REST (ejemplo Express)

```ts
import express from "express";
import { DeviceConfigSession, KnxProject } from "knx.ts";
import { attachUserCatalogProvider } from "./catalogStore";

const app = express();
app.use(express.json({ limit: "10mb" }));

const activeProjects = new Map<string, KnxProject>();
const activeDeviceSessions = new Map<string, { projectId: string; deviceKey: string; session: DeviceConfigSession }>();

// 1. Abrir un .knxproj subido por el usuario (o restaurarlo desde almacenamiento)
app.post("/api/projects/open", express.raw({ type: "application/octet-stream", limit: "100mb" }), (req, res) => {
  const password = req.header("x-knx-password") || undefined;
  const language = req.header("x-knx-language") || "es-ES";
  const project = KnxProject.fromBuffer(req.body as Buffer, { password, language });
  attachUserCatalogProvider(project);

  const id = crypto.randomUUID();
  activeProjects.set(id, project);
  res.status(201).json({ id, summary: project.getSummary() });
});

// 2. Crear un proyecto desde cero
app.post("/api/projects", (req, res) => {
  const { name, groupAddressStyle, comment } = req.body;
  const project = KnxProject.create({ name, groupAddressStyle, comment });
  attachUserCatalogProvider(project);

  const id = crypto.randomUUID();
  activeProjects.set(id, project);
  res.status(201).json({ id, summary: project.getSummary() });
});

// 3. Consultas ligeras para el Frontend
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

// 4. Importar un .knxprod suministrado por el usuario en el proyecto
app.post("/api/projects/:id/import-knxprod", express.raw({ type: "application/octet-stream", limit: "100mb" }), (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  const embedApplicationXml = req.query.embed !== "false";
  const result = p.importKnxProd(req.body as Buffer, {
    language: (req.query.language as string) || "es-ES",
    embedApplicationXml,
  });
  res.json(result);
});

// 5. Abrir editor interactivo de parámetros de un dispositivo (DeviceConfigSession)
app.post("/api/projects/:id/devices/:ia/session", async (req, res) => {
  const p = activeProjects.get(req.params.id)!;
  const session = await p.openDeviceSession(req.params.ia, { language: req.body?.language ?? "es-ES" });
  const sid = crypto.randomUUID();
  activeDeviceSessions.set(sid, { projectId: req.params.id, deviceKey: req.params.ia, session });
  res.status(201).json({ sessionId: sid, uiState: session.getUiState() });
});

// Editar parámetro en vivo y devolver diff + nuevo árbol UI
app.patch("/api/device-sessions/:sid/parameters", (req, res) => {
  const entry = activeDeviceSessions.get(req.params.sid)!;
  const diff = entry.session.setParameter(req.body.key, req.body.value);
  res.json(diff);
});

// Guardar cambios de la sesión de vuelta al KnxProject
app.post("/api/device-sessions/:sid/apply", (req, res) => {
  const entry = activeDeviceSessions.get(req.params.sid)!;
  const p = activeProjects.get(entry.projectId)!;
  const result = p.applyDeviceSession(entry.deviceKey, entry.session, { autoCreateGroupAddresses: true });
  res.json(result);
});

// 6. Exportar .knxproj (con contraseña opcional) o XML de direcciones de grupo
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

### Paso 3 (Frontend): Consumo desde React / Vue / TypeScript

El Frontend nunca hardcodea parámetros ni estructuras de fabricantes; consume los endpoints JSON y descarga binarios:

```ts
// 1. Subir un .knxproj del usuario (con contraseña opcional)
async function uploadKnxProj(file: File, password?: string) {
  const res = await fetch("/api/projects/open", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Knx-Language": "es-ES",
      ...(password ? { "X-Knx-Password": password } : {}),
    },
    body: await file.arrayBuffer(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { id, summary: { projectInfo, stats, manufacturers } }
}

// 2. Abrir editor dinámico para un dispositivo del proyecto (ej. "1.1.1")
async function openDeviceEditor(projectId: string, ia: string) {
  const res = await fetch(`/api/projects/${projectId}/devices/${encodeURIComponent(ia)}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "es-ES" }),
  });
  return res.json(); // { sessionId, uiState: { channels, comObjects, stats } }
  // Pinta uiState.channels -> blocks -> items usando widgets genéricos (select, checkbox, number, text)
  // Ver docs/PROGRAMMING_GUIDE_ES.md §2 para el mapa completo de widgets de DeviceUiState.
}

// 3. Editar un parámetro y actualizar la UI en vivo
async function onParameterChange(sessionId: string, paramRefId: string, value: string | number | boolean) {
  const res = await fetch(`/api/device-sessions/${sessionId}/parameters`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: paramRefId, value }),
  });
  const diff = await res.json(); // { changed, addedParameters, removedParameters, addedComObjects, state }
  return diff.state; // reemplaza el estado UI del editor
}

// 4. Guardar cambios del dispositivo al proyecto y descargar el .knxproj modificado
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
  a.download = "proyecto_modificado.knxproj";
  a.click();
  URL.revokeObjectURL(url);
}
```

### Paso 4: Persistencia recomendada en producción

- **Proyectos pequeños o borradores en edición**: guarda `project.toJSON()` en tu base de datos y restaura con `KnxProject.fromJSON(doc)` (registrando `attachUserCatalogProvider(project)` al restaurar para mantener acceso a los `.knxprod` del usuario).
- **Proyectos completos provenientes de ETS (con `LoadedImage`, `Baggages` y `M-XXXX/*`)**: guarda el archivo binario `.knxproj` en Object Storage (S3 / MinIO / disco) y guarda solo el resumen/índice en tu BD; al abrir una sesión de edición, carga `KnxProject.fromBuffer(s3Buffer)`, aplica los cambios y vuelve a guardar `project.toKnxProjBuffer()` en Storage.

---

## 5. Orquestador de Puesta en Marcha, Comparación con el Bus, Baggages y Runtime Tipado en Vivo

### 5.1 Puesta en Marcha Individual y por Lotes en Orden Topológico (`programDevice` y `programAll`)

`KnxProject` orquesta la descarga física al bus extremo a extremo directamente desde el modelo del proyecto:

- Calcula automáticamente **`PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`** (`computeDeviceAuthorizedSenders()`) a partir de los enlaces de otros dispositivos en las mismas Direcciones de Grupo, pasarelas de túnel en `BusInterfaces` (incluyendo `AdditionalAddresses`), keyrings `.knxkeys` opcionales e IAs de pasarela adicionales.
- Guarda automáticamente un snapshot comprimido KNX.ts en **`LoadedImage`** sobre cada `DeviceInstance` programado para que las descargas posteriores en `mode: "par"` o `mode: "par,grp"` realicen **escrituras diferenciales delta a nivel de byte** (escribiendo solo los bytes cambiados; los blobs `LoadedImage` opacos nativos de ETS se ignoran de forma segura).
- Actualiza automáticamente en el proyecto los flags `applicationProgramLoaded`, `parametersLoaded`, `communicationPartLoaded`, `individualAddressLoaded`, `mediumConfigLoaded`, `serialNumberHex`, `lastDownload` y `security`.
- `programAll()` ordena los dispositivos en estricto **orden topológico KNX** (Acopladores de Área `A.0.0` → Acopladores de Línea / Routers IP `A.L.0` → Dispositivos de línea principal → Dispositivos finales `A.L.D`), omitiendo automáticamente equipos sin asignar, equipos ya cargados (`onlyModified: true`) y equipos con plugin propietario DCA de ETS (`skipDca: true`).

```ts
import { KnxProject, KNXTunneling, KNXDeviceProgrammer } from "knx.ts";

const project = KnxProject.fromFile("Edificio.knxproj");
const tunnel = new KNXTunneling({ ip: "192.168.1.100", port: 3671 });
await tunnel.connect();
const programmer = new KNXDeviceProgrammer(tunnel);

// 1. Inspeccionar emisores autorizados Data Secure calculados automáticamente para un dispositivo
const senders = project.computeDeviceAuthorizedSenders("1.1.1", { extraSenders: ["1.1.250"] });
console.log("Emisores autorizados para 1.1.1:", senders.authorizedSenders);

// 2. Programar un dispositivo individual (soporta Object Type 11 IP y comisionamiento FDSK opcional)
const single = await project.programDevice("1.1.1", programmer, {
  mode: "ap1",
  extraAuthorizedSenders: ["1.1.250"],
  // programIpConfig: true, // para interfaces y routers KNXnet/IP (Object Type 11)
});
console.log("Programado 1.1.1:", single.download.bytesWritten, "bytes");

// 3. Tras modificar 1 parámetro, ejecutar descarga diferencial delta ultrarrápida
project.setDeviceParameter("1.1.1", "M-0071_A-49B1-21-F03B_P-1_R-4", "1");
const delta = await project.programDevice("1.1.1", programmer, { mode: "par" });
console.log("Delta usado:", delta.usedDifferentialSnapshot, "bytes:", delta.download.bytesWritten);

// 4. Programación por lotes en orden topológico (Acopladores primero -> Dispositivos finales)
const batch = await project.programAll(programmer, {
  onlyModified: true,
  skipDca: true,
  onDeviceComplete: (out) => console.log(`${out.individualAddress} [${out.role}]: ${out.status}`),
});
console.log(`Listo: ${batch.programmedCount} programados, ${batch.skippedCount} omitidos, ${batch.failedCount} fallidos`);
```

### 5.2 Comparación Bus vs. Proyecto (`compareDeviceWithBus`)

Compara cualquier dispositivo físico KNX contra su definición en el `.knxproj` (`serialNumber`, `manufacturerId`, `applicationProgram`, `loadStates`, diff de `groupAddresses` faltantes/sobrantes, `ipConfig` y `security`):

```ts
const cmp = await project.compareDeviceWithBus("1.1.1", programmer);
console.log("Sincronizado:", cmp.inSync);
console.log("Diferencias:", cmp.differences);
console.log("GAs faltantes en dispositivo:", cmp.groupAddressDiff?.missingOnDevice);
console.log("GAs sobrantes en dispositivo:", cmp.groupAddressDiff?.extraOnDevice);
```

### 5.3 Runtime Tipado y Monitor de Grupos desde `.knxproj` (`KnxProjectRuntime`)

Conecta cualquier `KNXService` (`KNXTunneling`, `KNXnetIPServer`, `KNXUSBConnection`, `TPUARTConnection`) directamente a un `KnxProject` para obtener decodificación automática de DPTs de ETS (`DPST-1-1` → `1.001`, `DPST-9-1` → `9.001`), enriquecimiento con Espacio/Función/Dispositivo, `write()`/`respond()`/`read()` tipados y snapshots JSON para SCADA, dashboards y backends REST/WebSocket:

```ts
const runtime = project.createRuntime(tunnel, {
  maxHistoryPerGa: 20, // historial circular opcional por GA
  loadProjectGroupKeys: true, // carga automática de Group Keys del proyecto en tunnel.dataSecure
});

// Escuchar todos los telegramas de grupo decodificados (o una GA específica con "ga:1/0/1")
runtime.on("telegram", (ev) => {
  console.log(
    `[${ev.kind}] ${ev.groupAddress} (${ev.meta?.name} @ ${ev.meta?.spacePath}) =`,
    ev.value,
    `desde ${ev.sourceDevice?.name ?? ev.sourceAddress}`,
  );
});

// Enviar escrituras tipadas por Dirección de Grupo, entero, ID de GA o nombre único de GA
await runtime.write("1/0/1", true);
await runtime.write("Dimmer Salón", 75);

// Enviar GroupValue_Read y esperar la respuesta GroupValue_Response decodificada
const tempEvent = await runtime.read("1/0/2", { timeoutMs: 3000 });
console.log("Temperatura actual:", tempEvent?.value);

// Snapshot 100% serializable a JSON para dashboards REST / WebSocket
const snapshot = runtime.getSnapshot();
// Liberar listeners y temporizadores al cerrar
runtime.destroy();
```

### 5.4 Extracción de Baggages de Catálogo (`listBaggages`, `readBaggage`, `getBaggage`)

Extrae imágenes de producto (`TypePicture`), iconos, paquetes ZIP de iconos y PDFs embebidos en `M-XXXX/Baggages/**` (también accesibles vía `session.listBaggages()` / `session.readBaggage(field.baggageRefId)` en `DeviceConfigSession`):

```ts
const baggages = project.listBaggages(); // [{ id, manufacturerId, targetPath, name, zipEntryPath, mimeType }]
const asset = project.getBaggage(baggages[0].id); // { ..., filename, mimeType, size, buffer }
// O Buffer crudo por BaggageRefId o zipEntryPath:
const rawBuf = project.readBaggage(baggages[0].id);
```
