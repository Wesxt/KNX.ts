# knx.ts

Una librería de alto rendimiento para **KNXnet/IP** e **Interfaces de Hardware** como **HID USB** y **TPUART** escrita en **TypeScript**.

Este proyecto se centra en la rigurosidad del protocolo, leer y enviar cualquier tipo de mensaje **EMI** o **CEMI**, Amplio soporte de DPTs (Data Point Types), la estabilidad de la conexión y la integración directa con el hardware, optimizado específicamente para proporcionar una experiencia fiable cuando se utiliza como Pasarela (Gateway) para ETS o como núcleo para controladores KNX personalizados.

## 🌟 Capacidades

- **Túnel UDP y TCP Robusto (v1 y v2)**: Implementa una cola estricta _Stop-and-Wait_ para UDP, reensamblado de tramas sobre flujo TCP (`TcpFrameReader`, sin sobrecarga de `TUNNELLING_ACK` según `03_08_04` §2.6.2), HPAI Route Back (`0.0.0.0:0`) para NAT/VPN, Extended CRI (solicitud de Dirección Individual específica), capas Busmonitor/Raw y **Características de Tunnelling v2** (`TUNNELLING_FEATURE_GET`, `TUNNELLING_FEATURE_SET`, `TUNNELLING_FEATURE_INFO` según `03_08_04` §3).
- **Servidor KNXnet/IP (UDP, TCP y Pasarela ETS)**: Servidor KNXnet/IP completo con pool de ranuras de túnel (`clientAddrs`), `SEARCH_REQUEST` y Core v2 `SEARCH_REQUEST_EXTENDED` (sobre UDP y TCP con filtrado por SRP), DIBs de `DESCRIPTION_RESPONSE` (`TUNNELLING_INFO`, `DEVICE_INFO_EXTENDED`, `KNX_ADDRESSES`, `SECURED_SERVICE_FAMILIES`) y compatibilidad con **Monitor de Grupos y Busmonitor de ETS** (conversión `L_Busmon.ind` para tramas TP1 estándar/extendidas y `L_Raw.ind`).
- **KNXnet/IP Secure (`03_08_09`)**:
  - **Cliente y Servidor de Túnel Seguro (TCP Unicast)**: Intercambio de claves ECDH con X25519, autenticación mutua de usuario y dispositivo con PBKDF2-HMAC-SHA256 (`SESSION_REQUEST`, `SESSION_RESPONSE`, `SESSION_AUTHENTICATE`, `SESSION_STATUS`) y cifrado/autenticación AES-128-CCM en `SECURE_WRAPPER` tanto en `KNXTunneling` como en `KNXnetIPServer` (`ServerSecureSession`).
  - **Enrutamiento Multicast Seguro (Secure Routing)**: Cifrado multicast en `SECURE_WRAPPER` y máquina de estados de sincronización de reloj de 48 bits con `TIMER_NOTIFY` (`SecureRoutingTimer`) en `KNXnetIPServer`.
  - **Lector, Constructor y Exportador `.knxkeys` sin dependencias (`KnxKeyring`)**: Carga, verifica la firma canónica de ETS, descifra, edita y **exporta archivos `.knxkeys` cifrados y firmados** (XML con UTF-8 BOM o ZIP, direcciones enteras ETS5 o 3-niveles ETS6, generación CSPRNG de claves y sincronización de secuencias de 48 bits con `KnxDataSecure`) usando únicamente `crypto` y `zlib` nativos de Node.js.
- **KNX Data Secure (`03_03_07` §5, `03_05_01` §6.3, `03_05_02` §4)**:
  - **Seguridad Transparente en Capa de Aplicación (`KnxDataSecure`)**: Cifrado y autenticación extremo a extremo AES-128-CCM (`APCISec = 0x03F1`, `S-A_Data` en modos *Autenticación + Confidencialidad* y *Solo Autenticación*, cambio automático a *Extended Frame* `FT=0` para cargas > 15 bytes) acoplable a cualquier `KNXService` (`KNXTunneling`, `KNXnetIPServer`, `KNXUSBConnection`, `TPUARTConnection`).
  - **Contadores de 48 bits y Motor `S-A_Sync`**: Validación anti-replay por dirección fuente, persistencia opcional en JSON (`sequenceNumberFile`), `DM_SecureSync_RCl` (punto a punto / conectado) y `DM_SecureSync_SBC` (broadcast / system broadcast) con respaldo `ToolKey` ↔ `FDSK`.
  - **Gestión Segura y Security Interface Object (Tipo 17)**: Sesiones seguras en `KNXManagement` (`openSession(ia, { secure: true })` / `withSession`) con helpers para `PID_SECURITY_MODE`, `PID_LOAD_STATE_CONTROL`, `PID_P2P_KEY_TABLE`, `PID_GRP_KEY_TABLE`, `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`, `PID_TOOL_KEY`, `PID_GO_SECURITY_FLAGS`, `PID_SECURITY_FAILURES_LOG` y `PID_SEQUENCE_NUMBER_SENDING`. *(Validado con los vectores oficiales del Anexo C de `03_03_07` y en hardware físico real contra un Zennio MAXinBOX 66 v3.)*
- **Programación Directa desde `.knxprod`, API de Parametrización Web y Comisionamiento Data Secure Fase 2 (`KNXDeviceProgrammer`, `DeviceConfigSession`)**: Parsea catálogos oficiales `.knxprod` de ETS (streaming XML de 60+ MB e idiomas), evalúa `<Dynamic>` / `<Assign>` / `<ModuleDef>` / `<Repeat>` / `<ParameterCalculation>` JS, expone una **API 100% serializable a JSON (`DeviceConfigSession`)** para apps web, compila Objetos 1–4 System B (`MV-07B0`) + Security Interface Object Tipo 17 (incluyendo comisionamiento inicial `FDSK -> ToolKey`) y programa dispositivos reales por Tunneling IP, KNX USB (`cEMI`), Routing o TP-UART. Ver la [Guía Completa de Programación y API Web](./docs/PROGRAMMING_GUIDE_ES.md).
- **Descubrimiento Extendido Core v2 (`KNXTunneling.discover` / `KNXnetIPServer.discover`)**: Descubre servidores KNXnet/IP por multicast/unicast UDP o unicast TCP con Search Request Parameters (SRP: modo programación, dirección MAC, versión mínima de familia de servicio, DIBs solicitados) y decodifica metadatos legibles (`KNXDiscoveredDevice`).
- **Gestión Completa de Red y Dispositivos KNX (`KNXManagement` y `KNXManagementSession`)**: Implementación completa del stack de gestión KNX (`03_05_02 Management Procedures`, `03_03_07 Application Layer`, `03_05_01 Resources` y `03_08_03 / 03_06_03 Gestión Local cEMI`) sobre una capa de transporte orientada a conexión punto a punto (`TransportConnection`, `03_03_04`), además de modos broadcast, system broadcast y sin conexión:
  - **Gestión de Dirección Individual y de Dominio (`NM_*`)**: Lectura de dispositivos en modo programación (con detección de direcciones duplicadas), programación de Dirección Individual mediante botón (`writeIndividualAddress`) o por número de serie de 6 bytes sin pulsar botón (`writeIndividualAddressBySerial`), restablecimiento a `15.15.255` (`resetIndividualAddress`), lectura/escritura de Dirección de Dominio (`readDomainAddress`, `writeDomainAddress`, `readDomainAddressSelective`, `readDomainAddressBySerial`, `writeDomainAddressBySerial`) y lectura/escritura de parámetros de red (`A_NetworkParameter_*` y `A_SystemNetworkParameter_*`).
  - **Gestión de Dispositivos (`DM_*`)**: Sesiones persistentes autenticadas (`openSession` / `withSession`), autorización de acceso (`authorize` / `A_Authorize_Request`) y escritura de claves (`setKey` / `A_Key_Write`), conmutación remota del modo programación (`setProgrammingMode`), lectura/escritura/descripción/escaneo de propiedades y funciones de objetos de interfaz (estándar y extendidas), lectura/escritura de memoria estándar (16 bits), memoria de usuario (20 bits), memoria extendida (24 bits) y escritura por bits con segmentación automática y verificación de lectura (`DMP_MemWrite_RCoV`), control de las máquinas de estados de carga y ejecución (`PID_LOAD_STATE_CONTROL` / `PID_RUN_STATE_CONTROL`), lectura/escritura de enlaces de objetos de grupo (`A_Link_Read` / `A_Link_Write`), y reinicio básico o *Master Reset* confirmado (`A_Restart` con `RestartEraseCode`).
  - **Gestión Local de la Propia Interfaz (`M_PropRead` / `M_PropWrite` / `M_FuncPropCommand` / `M_Reset`)**: Gestión local cEMI sobre `DEVICE_MGMT_CONNECTION` o USB.
- **Enrutamiento KNXnet/IP (Routing)**: Soporta enrutamiento multicast plano y seguro (en el servidor **KNXnet/IP**).
- **Descubrimiento en el servidor KNXnet/IP**: Soporta `SEARCH_REQUEST`, `SEARCH_REQUEST_EXTENDED`, `DESCRIPTION_REQUEST`, `CONNECT_REQUEST` y `CONNECTIONSTATE_REQUEST` para que aplicaciones como ETS puedan descubrirlo sin necesidad de configuración manual.
- **Interfaces de Hardware Directas**: Soporte nativo para **interfaces USB KNX** (vía `node-hid`) y chips serie **TPUART** (vía `serialport`).
- **Programar dispositivos desde ETS**: La librería es capaz de programar dispositivos KNX completamente desde ETS puenteando un enlace `KNXnetIPServer` con un enlace físico (`KNXUSBConnection` / `TPUART`). *(Probado en bus real con un Zennio MAXinBOX 66.)*
- **Puente de Aprendizaje (Router)**: Enrutamiento avanzado multi-interfaz con Prevención de Bucles, Seguimiento de Firmas y Aprendizaje de Direcciones Individuales (IA), permitiéndote puentear varias interfaces físicas y túneles simultáneamente.
- **Eventos Intuitivos Basados en Direcciones**: Escucha telegramas específicos usando direcciones de grupo como nombres de eventos (ej., `server.on("1/1/1", ...)`).
- **Cancelación de Eco**: Filtra automáticamente los mensajes de bucle invertido (loopback) para evitar bucles de procesamiento de telegramas.
- **Alto Rendimiento**: Optimizado para entornos Node.js con una sobrecarga mínima.

## 🚧 Estado: Experimental y Validación en Hardware

Según el `TODO.md`, varias características han sido verificadas mediante suites automatizadas e integración con ETS, mientras otras permanecen pendientes de validación extendida en hardware físico:

- **Integración con ETS5 y Cumplimiento del Estándar**: El descubrimiento (`SEARCH_REQUEST` / `SEARCH_REQUEST_EXTENDED` con SRPs), `DESCRIPTION_RESPONSE`, túnel UDP/TCP, características de Tunnelling v2, sesiones seguras TCP y Monitor de Grupos / Busmonitor en ETS están implementados y verificados con pruebas automatizadas y sesiones reales contra ETS5.
- **KNX IP Secure Routing, KNX Data Secure, `KNXManagement` y Programación `.knxprod` (Validado en Hardware Físico)**: Implementados conforme al estándar KNX v3.0.0 y verificados contra los vectores criptográficos oficiales del Anexo A (`03_08_09`) y Anexo C (`03_03_07`), archivos `.knxkeys` reales de ETS, capturas XML reales de ETS y **hardware físico real**: KNX IP Secure Routing (`SECURE_WRAPPER` + `TIMER_NOTIFY`) con LogicMachine, comunicación de grupo KNX Data Secure + gestión segura `ToolKey` / `S-A_Sync` / Security Interface Object 17 sobre **KNXnet/IP (Tunneling y Secure Routing)** y **KNX USB (`cEMI` + programación de IA de hardware)**, y **descarga completa de aplicación desde `.knxprod` + comisionamiento Data Secure Fase 2 Object Type 17 (124 KB en 727 tramas cifradas) verificada en vivo en un Zennio MAXinBOX 66 v3 físico** (con control de relés y retorno de estado cifrado A+C confirmado). Las tramas extendidas TP-UART (`FT=0`, `U_L_DataOffset`) y transferencias USB HID multi-trama (`09_03`) están verificadas mediante tests unitarios.
- **Filtrado de Origen**: El filtrado basado en direcciones de origen y el enrutamiento selectivo están en la hoja de ruta.
- **Uso de las capas NPDU, TPDU y APDU**: En EMI hace falta usarlas para una correcta deserialización.

## 📦 Instalación via git

```bash
git clone https://github.com/Wesxt/KNX.ts.git
cd KNX.ts
npm install
```

## 📦 Instalación via npm

```bash
npm install knx.ts
```

## 🧩 Dependencias Externas

Esta librería depende de algunos módulos clave, tanto externos como nativos, para habilitar toda su funcionalidad:

- **Logger Personalizado Integrado**: Un sistema de registro propio altamente eficiente, construido con `worker_threads` para escrituras asíncronas no bloqueantes, con reloleo diario de archivos de log, etiquetado por módulos y salidas de consola coloreadas.
- **[node-hid](https://github.com/node-hid/node-hid)**: Utilizado por `KNXUSBConnection` para interactuar de forma nativa con interfaces USB KNX. Ten en cuenta que los módulos nativos pueden requerir herramientas de compilación en ciertos sistemas operativos.
- **[serialport](https://serialport.io/)**: Utilizado por `TPUARTConnection` para comunicación directa por UART. Al igual que `node-hid`, este es un módulo nativo.

## Pasarelas

Si busca una pasarela para conectar su red KNX con una interfaz web o una plataforma IoT busque el repo `GatewaySources`, puede usar `KNXWebSocketGateway` o `KNXMQTTGateway`. Si busca una pasarela para conectar su red KNX con una red Modbus, puede usar `ModbusGateway`.

## 📚 Referencia de la API (Lo que se exporta)

La librería expone un conjunto rico de clases y utilidades que permiten tanto el uso de alto nivel como la manipulación del protocolo a bajo nivel:

### 1. Conexiones y Pasarelas

Estas clases forman el núcleo de tu interacción con la red. Todas ellas heredan de una base `KNXService` y emiten eventos comunes.

- `KNXnetIPServer`: Crea un servidor KNXnet/IP completo (Gateway) con listeners UDP y TCP (`tcp`, `tcpPort`, `tcpHost`, `allowPlainTcp`), sesiones unicast KNX IP Secure (`secure.users`, `secure.deviceAuthenticationPassword`), Secure Routing multicast opcional (`secure.backboneKey` / `keyringFile`), Extended Search Core v2 (evaluación SRP), Interface Features Tunnelling v2 y soporte para Monitor de Grupos y Busmonitor en ETS (`L_Busmon.ind`).
- `KNXTunneling`: Se conecta como cliente a una pasarela KNXnet/IP existente mediante UDP (`useRouteBack`), TCP plano (`transport: "TCP"`) o **KNX IP Secure sobre TCP** (`secure: { ... }`), con Extended CRI (`individualAddress`, `knxLayer`), características Tunnelling v2 (`getFeature`, `setFeature`) y descubrimiento estático (`KNXTunneling.discover`).
- `KNXManagement`, `KNXManagementSession` y `TransportConnection`: Stack completo de gestión de red y dispositivos KNX (`03_05_02`, `03_03_07`, `03_08_03`) para leer y escribir Direcciones Individuales/de Dominio, Propiedades y Funciones de Objetos de Interfaz, Memoria de Dispositivo/Usuario/Extendida, Claves de Autorización, Máquinas de Estados de Carga y Ejecución, Enlaces de Objetos de Grupo y Reinicio Básico o *Master Reset* sin depender de ETS.
- `KnxProdParser`, `DeviceConfigSession`, `DynamicEvaluator`, `SystemBCompiler`, `LoadProcedureEngine` y `KNXDeviceProgrammer`: Parser de `.knxprod` de ETS, API de parametrización serializable a JSON para apps web/externas (árbol UI traducido, diffs `<Dynamic>` en vivo, buscador, validación y `toJSON`/`fromJSON`), compilador binario System B (`MV-07B0`, Objetos 1–4 + Object 17 Data Secure) y programador de dispositivos con verificaciones pre-flight y comisionamiento `FDSK -> ToolKey`. Ver [docs/PROGRAMMING_GUIDE_ES.md](./docs/PROGRAMMING_GUIDE_ES.md).
- `KnxKeyring`: Lector, constructor y exportador sin dependencias externas para archivos `.knxkeys` estándar (compatible con ETS 5/6, Home Assistant / `xknx` y `knx.ts`).
- `KnxDataSecure` y `KnxDataSecureCcm`: Implementación completa de la capa de aplicación segura KNX Data Security (`S-AL`, `03_03_07` §5) con soporte para `S-A_Data` (A+C y Solo Autenticación), `S-A_Sync`, persistencia de números de secuencia de 48 bits, cifrado/descifrado transparente en `KNXService` y sesiones seguras en `KNXManagement` con `ToolKey` / `P2PKey`.
- `KNXUSBConnection`: Se conecta directamente a interfaces USB KNX locales usando el **catálogo oficial de ETS6 `KNX_USB_INTERFACES` integrado (78 interfaces de todos los fabricantes KNX)** con descubrimiento exacto `VendorID:ProductID` (`KNXUSBConnection.discover()`), metadatos de la interfaz conectada (`usb.interfaceInfo`), **prioridad `cEMI`** (requerida para tramas extendidas y KNX Data Secure), **fragmentación y reensamblado USB HID multi-trama** (`09_03` §3.4.1.2, hasta 5 reportes), **detección automática de la Dirección Individual de hardware** (`PID_SUBNET_ADDR` / `PID_DEVICE_ADDR`) y programación local de IA (`setHardwareIndividualAddress()` / `programHardwareAddress: true`).
- `TPUARTConnection`: Se conecta directamente al bus KNX TP1 mediante hardware serie TPUART / TP-UART2 / NCN5120 con soporte completo para **tramas TP1 Estándar (`FT=1`) y Extendidas (`FT=0`)** (`CEMIAdapter.cemiToTp1` / `tp1ToCemi`), **`U_L_DataOffset`** para tramas > 64 bytes, ACK hardware en fase de dirección, System Broadcast (`SB=0`) y KNX Data Secure transparente.
- `Router`: Un potente Puente que intercomunica las distintas conexiones de hardware o clientes tunneling (**KNXUSBConnection**). Puedes adjuntar múltiples instancias de `KNXService` a él (ej., una conexión USB y 5 túneles), y enrutará automáticamente los telegramas entre ellos, gestionando el aprendizaje de Direcciones Individuales y la prevención de bucles.

### 2. Conversión de Datos (DPTs)

- `KnxDataDecode`: Utilidad estática para decodificar cargas útiles `Buffer` en tipos estándar de JavaScript/TypeScript (primitivos como `boolean`, `number`, `string`, o estructuras enriquecidas con metadatos/unidades como `{ value, unit }`, desglose de hora o indicadores de validez RGBW) según la especificación KNX. Cuenta con documentación JSDoc completa en inglés y control descriptivo de errores.
- `KnxDataEncoder`: Utilidad estática para validar y codificar valores de JavaScript/TypeScript en fragmentos de `Buffer` listos para el bus KNX. Los DPTs de valor único aceptan tanto valores primitivos directos (ej., `true`, `22.5`, `75`) como objetos envolventes `{ value: ... }`, mientras que los DPTs multifunción aceptan objetos estructurados. Incluye validación granular con diagnóstico detallado de errores (`InvalidParametersForDpt`), verificación previa sin codificar (`encodeThisOnlyVerify`) y JSDocs completos en inglés.

### 3. Tramas y Tipos Core de KNX

Para desarrolladores que construyen herramientas avanzadas de monitoreo o inyección, la librería exporta toda la estructura interna de las tramas:

- Clases `CEMI` / `EMI` para analizar y serializar tramas Common EMI y EMI antiguas.
- Clases `APDU`, `NPDU`, `TPDU` para la manipulación de las capas de Red, Transporte y Aplicación.
- `ControlField` para analizar y serializar los control field de los mensajes CEMI o EMI.
- `ExtendedControlField` para analizar y serializar los `Extended Control Field` o `Control Field 2` de los mensajes CEMI.
- `AddressType` Es un enumerable que ayuda a identificar el bit de Address Type (AT) del ExtendedControlField, asi puede saber que dirección de destino se trata, si de grupo o individual.
- `APCI` Para analizar y serializar los APCI que se alojan entre los datos de TPDU y APDU, debe tener cuidado ya que el APCI se maneja con 10 bits y escribe en los 2 bits menos significativos del Byte que donde el TPCI y los siguientes 2 bits son exclusivos del APCI y los 6 bits son del APCI o son datos.
- `APCIEnum` Es un enumerable que ayuda a escribir el APCI según la especificación, **Advertencia**: Esta enumeración asume todos comandos dentro son 10 bits o 2 bytes pero dentro de la mascara 0x3FF, los que son de longitud de 4 bits simplemente están en una mascara 0x3C0.
- `TPCI` Es para analizar y serializar los TPCI que están en la capa TPDU.
- `TPCIType` Es un enumerable que ayuda a escribir o indentificar los TPCI según la especificación.
- `SRP`: Construye y analiza bloques *Search Request Parameter* (`selectByProgrammingMode`, `selectByMacAddress`, `selectByService`, `requestDibs`) para `SEARCH_REQUEST_EXTENDED` de Core v2.
- `KNXnetIPStructures` / `KNXnetIPEnum`: Incluye DIBs, HPAIs, CRIs, CRDs, `DescriptionType`, `KNXLayer`, `InterfaceFeatureId`, `TunnellingFeatureReturnCode`, `AllowedSupportedServiceFamilies` y `SRPType`.
- Tipos de Configuración y Descubrimiento: `KNXnetIPServerOptions`, `KNXTunnelingOptions`, `KNXSecureOptions`, `KNXDiscoverOptions`, `KNXDiscoveredDevice`, `RouterConnOptions`, `TPUARTOptions`, `KNXUSBOptions` y `KNXLoggerOptions`.
- `DPTs`: La librería exporta interfaces como `DPT5001`, `DPT1` o `DPT10001`. Los tipos de DPT de valor único admiten tanto valores primitivos directos como objetos `{ value: T }`. Estas interfaces son utilizadas por `KnxDataDecode` para tipar los valores decodificados y por `KnxDataEncoder` para validar y convertir los parámetros en `Buffer`.
- `ServiceMessage` Es una interfaz que implementan todos los mensajes del CEMI y EMI, tambien todas las capas NPDU, TPDU y APCI, esto sirve para que contegan dos metodos utiles: `toBuffer` para devolver la instancia en un buffer y `describe` que otorga información sobre la instancia de una forma amigable de ver. **Nota**: En la mayoria de clases que exporta esta librería y no implementa esta interfaz como el APCI aún tienen el metodo `describe`.
- `CEMIInstance` Es un tipo de todas las instancias de CEMI.

## 🛠️ Inicio Rápido

### Crear un Servidor KNXnet/IP (Pasarela)

Perfecto para crear un puente entre tu red IP y el bus KNX.

```typescript
import { KNXnetIPServer, ServiceMessage, KnxDataDecode, CEMIInstance } from "knx.ts";

const server = new KNXnetIPServer({
  localIp: "192.168.1.50",
  individualAddress: "1.1.0", // Tenga cuidado de hacer conflicto
  friendlyName: "TypeScript KNX Gateway", // Este nombre se muestra en el ETS
  clientAddrs: "1.1.10:5", // Proporciona 5 ranuras de túnel comenzando desde 1.1.10
});

server.on("error", (err) => {
  console.error(err)
})

server.connect().then(() => {
  console.log("El servidor KNXnet/IP está en funcionamiento");
});

server.on("indication", (cemi: CEMIInstance) => {
  console.log("New data:", cemi.TPDU.apdu.data); // Raw APDU data
  console.log("Decoded data:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Converted JavaScript value
});

// Escucha específica para una Dirección de Grupo
server.on("1/1/1", (cemi: CEMIInstance) => {
  console.log("Nuevos datos en 1/1/1:", cemi.TPDU.apdu.data); // Datos crudos del APDU
  console.log("Datos decodificados:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Dato convertido en un valor de javascript
});
```

### Conexión USB Directa

```typescript
import { KNXUSBConnection } from "knx.ts";

// Opcional: listar todas las interfaces KNX-USB conectadas (catálogo oficial ETS6 de 78 interfaces)
const found = KNXUSBConnection.discover({ language: "es-ES" });
console.log(found.map((i) => `${i.displayName} [${i.knxManufacturerName ?? "Desconocido"}] (${i.vendorIdHex}:${i.productIdHex})`));

const usb = new KNXUSBConnection({
  // Omitir path/vendorId/productId selecciona automáticamente la primera interfaz USB KNX detectada
});

usb.connect().then(() => {
  console.log("Conectado directamente a:", usb.interfaceInfo?.displayName);
});

usb.on("indication", (cemi) => {
  console.log("Origen del telegrama USB:", cemi.sourceAddress);
});

usb.on("error", (err) => {
  console.error(err)
})
```

### Cliente de Túnel (Tunneling)

```typescript
import { KNXTunneling } from "knx.ts";

const tunnel = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  localIp: "192.168.1.50",
});

tunnel.connect().then(() => {
  console.log("Conectado al bus KNX");
});

tunnel.on("error", (err) => {
  console.error(err)
})

tunnel.on("indication", (cemi: CEMIInstance) => {
  console.log("New data:", cemi.TPDU.apdu.data); // Raw APDU data
  console.log("Decoded data:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Converted JavaScript value
});

tunnel.on("1/1/1", (cemi: CEMIInstance) => {
  console.log("New data on 1/1/1:", cemi.TPDU.apdu.data); // Raw APDU data
  console.log("Decoded data:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Converted JavaScript value
});
```

### Guía Detallada de Descubrimiento (`KNXTunneling.discover` y `KNXnetIPServer.discover`)

Tanto `KNXTunneling.discover(options?: KNXDiscoverOptions)` como `KNXnetIPServer.discover(...)` implementan el descubrimiento KNXnet/IP Core v1 (`SEARCH_REQUEST`) y Core v2 (`SEARCH_REQUEST_EXTENDED` con SRPs), devolviendo objetos `KNXDiscoveredDevice[]` enriquecidos con campos legibles (`individualAddressText`, `knxMedium`, `deviceStatus`, `supportedServices`, `tunnellingInfo.slots`, `extendedDeviceInfo`, `supportsTcp`, `supportsSecurity`, etc.).

```typescript
import {
  KNXTunneling,
  KNXnetIPServer,
  AllowedSupportedServiceFamilies,
  DescriptionType,
  SRP,
} from "knx.ts";

// 1. Descubrimiento estándar UDP Multicast (envía SEARCH_REQUEST_EXTENDED + SEARCH_REQUEST)
const devices = await KNXTunneling.discover({
  timeout: 3000,
  ipLocal: "192.168.1.50", // IP de la interfaz local (opcional)
});

for (const dev of devices) {
  console.log(
    `${dev.friendlyName} @ ${dev.ip}:${dev.port} | IA: ${dev.individualAddressText} | Medio: ${dev.knxMedium} | TCP: ${dev.supportsTcp} | Secure: ${dev.supportsSecurity}`,
  );
  console.log("Servicios:", dev.supportedServices); // ej. [{ family: 4, familyName: "Tunnelling", version: 2 }]
  console.log("Slots de túnel:", dev.tunnellingInfo?.slots); // [{ addressText: "1.1.2", usable: true, authorised: true, free: true }]
}

// 2. Descubrimiento Extendido UDP con filtros SRP de conveniencia
// Cuando se especifican SRPs, includeLegacySearch pasa a false por defecto para que solo respondan servidores que cumplan el filtro
const progDevices = await KNXTunneling.discover({
  programmingModeOnly: true,
  timeout: 2000,
});

// Filtrar por dirección MAC o versión mínima de familia de servicio (ej. Security v1)
const secureRouters = await KNXTunneling.discover({
  minService: {
    family: AllowedSupportedServiceFamilies.Security,
    version: 1,
    mandatory: true,
  },
  requestDibs: [
    DescriptionType.DEVICE_INFO,
    DescriptionType.SUPP_SVC_FAMILIES,
    DescriptionType.SECURED_SERVICE_FAMILIES,
    DescriptionType.TUNNELLING_INFO,
  ],
});

// 3. Descubrimiento Unicast sobre TCP (Core v2 SEARCH_REQUEST_EXTENDED sobre TCP)
const tcpDevices = await KNXTunneling.discover({
  ip: "192.168.1.100",
  port: 3671,
  transport: "TCP",
  srps: [SRP.requestDibs([DescriptionType.DEVICE_INFO, DescriptionType.TUNNELLING_INFO], false)],
});

// 4. Atajo posicional en KNXnetIPServer:
const simpleList = await KNXnetIPServer.discover("192.168.1.50", "224.0.23.12", 3671, 3000, true);
```

### Guía Detallada de `KNXTunneling` (UDP, TCP, Route Back, Capas y Características v2)

`KNXTunneling` soporta UDP (`useRouteBack`), TCP plano (`03_08_04` §2.6.2), KNX IP Secure sobre TCP (`03_08_09`), Extended CRI para solicitar una Dirección Individual específica, capas Raw/Busmonitor y Características de Interfaz de Tunnelling v2 (`03_08_04` §3):

```typescript
import {
  KNXTunneling,
  ConnectionType,
  KNXLayer,
  InterfaceFeatureId,
} from "knx.ts";

// 1. Túnel TCP plano solicitando una Dirección Individual específica mediante Extended CRI (0x08)
const tunnelV2 = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  transport: "TCP", // Usa automáticamente HPAI nulo (0.0.0.0:0) y omite TUNNELLING_ACK
  connectionType: ConnectionType.TUNNEL_CONNECTION,
  knxLayer: KNXLayer.LINK_LAYER, // Opciones: LINK_LAYER (0x02), RAW_LAYER (0x04), BUSMONITOR_LAYER (0x80)
  individualAddress: "1.1.15", // Opcional: solicita una IA específica vía Extended CRI
  maxQueueSize: 100,
});

// Escuchar notificaciones asíncronas de cambio de características (TUNNELLING_FEATURE_INFO)
tunnelV2.on("feature_info", (featureId: number, value: Buffer) => {
  console.log(`Característica 0x${featureId.toString(16)} actualizada:`, value.toString("hex"));
});

await tunnelV2.connect();
console.log("IA asignada:", tunnelV2.individualAddress);

// 2. Características de Interfaz Tunnelling v2 (TUNNELLING_FEATURE_GET / TUNNELLING_FEATURE_SET)
const maxApduBuf = await tunnelV2.getFeature(InterfaceFeatureId.MAX_APDU_LENGTH);
const dd0Buf = await tunnelV2.getFeature(InterfaceFeatureId.DEVICE_DESCRIPTOR_TYPE_0);
const assignedIaBuf = await tunnelV2.getFeature(InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS);

// Habilitar notificaciones TUNNELLING_FEATURE_INFO (1 = habilitar, 0 = deshabilitar)
await tunnelV2.setFeature(InterfaceFeatureId.INTERFACE_FEATURE_INFO_ENABLE, Buffer.from([0x01]));

// Libera siempre el canal al cerrar (especialmente importante en UDP)
await tunnelV2.disconnect();
```

> **Consejo para VPN / ZeroTier / NAT (`UDP`)**: Activa `useRouteBack: true` en conexiones UDP para enviar un HPAI *Route Back* (`0.0.0.0:0`), permitiendo que pasarelas detrás de NAT o VPN respondan directamente a tu IP y puerto de origen.

### Guía Detallada de `KNXnetIPServer` (UDP, TCP, Sesiones Seguras, Routing y Busmonitor ETS)

`KNXnetIPServer` actúa simultáneamente como servidor Tunnelling v1/v2 (UDP y TCP), Router KNXnet/IP (multicast plano y Secure Routing) y servidor de sesiones unicast KNX IP Secure:

```typescript
import { KNXnetIPServer } from "knx.ts";

const server = new KNXnetIPServer({
  ip: "224.0.23.12",
  localIp: "192.168.1.50",
  port: 3671, // Usa 0 para puerto efímero UDP/TCP asignado por el sistema operativo
  individualAddress: "1.15.1",
  friendlyName: "KNX.ts IP Gateway",
  clientAddrs: "1.15.2:8", // Pool de 8 slots de túnel (1.15.2 .. 1.15.9)
  useAllInterfaces: true, // Multi-homing multicast en las interfaces activas del host
  routingDelay: 20, // Espera mínima en ms entre tramas multicast salientes (defecto 20ms)
  ignoreACKTimeout: false,
  MAX_PENDING_REQUESTS_PER_CLIENT: 100,

  // Opciones del Servidor TCP Unicast (03_08_02 §8.4.3)
  tcp: true, // Habilita listener TCP (defecto: true)
  tcpHost: "0.0.0.0", // Host de escucha TCP
  tcpPort: 3671, // Por defecto usa `port`
  tcpIdleTimeoutMs: 10000, // Cierra sockets TCP inactivos sin canal ni sesión segura
  allowPlainTcp: true, // Usa false para exigir KNX IP Secure en TCP

  // Configuración opcional de KNXnet/IP Secure (TCP Unicast + Routing Multicast)
  secure: {
    deviceAuthenticationPassword: "miDeviceAuthPassword", // FDSK / contraseña de puesta en marcha (opcional)
    users: {
      1: "miPasswordManagement", // User ID 1 = Management / Puesta en marcha (ETS)
      2: "miPasswordTunnel", // User ID >= 2 = Cliente de Tunnelling
    },
    // Opcionalmente habilita Secure Routing multicast (o carga todo desde un .knxkeys de ETS):
    // keyringFile: "./proyecto.knxkeys",
    // keyringPassword: "passwordDelKeyring",
    multicastLatencyToleranceMs: 2000,
    sessionAuthenticationTimeoutMs: 10000,
    sessionTimeoutMs: 60000,
    sessionKeepAliveIntervalMs: 30000,
  },
});

await server.connect();
console.log("Puerto UDP:", server.udpListeningPort, "Puerto TCP:", server.tcpListeningPort);
```

- **Busmonitor y Monitor de Grupos en ETS**: Cuando ETS (u otro cliente) abre un túnel con `KNXLayer.BUSMONITOR_LAYER` (`0x80`), `KNXnetIPServer` convierte automáticamente las tramas `L_Data.ind`, `L_Data.con`, `L_Data.req`, `L_Raw.ind` y `L_Raw.req` a `L_Busmon.ind` (`0x2b`) válidas en formato TP1 Estándar (`FT=1`, `LG = dataLen`) o TP1 Extendido (`FT=0`) con su `FCS`, e incluye la información adicional `BusmonitorStatusInfo` (`0x03`) y `TimestampRelative` (`0x04`). Según la especificación KNX `03_08_04`, el modo Busmonitor acepta un único cliente exclusivo mientras no existan túneles link-layer activos.
- **Descubrimiento Compatible Pre-Seguridad**: Incluso cuando se configuran `secure.users` o `secure.deviceAuthenticationPassword`, `DESCRIPTION_RESPONSE` / `SEARCH_RESPONSE_EXTENDED` anuncian las familias `SUPP_SVC_FAMILIES` (`Core v2`, `DeviceManagement v1`, `Tunnelling v2`, `Routing v1`, `Security v1`) junto con `SECURED_SERVICE_FAMILIES` (`0x06`), permitiendo que ETS descubra la pasarela y negocie sesiones seguras TCP sin errores de compatibilidad.

### Guía de KNX IP Secure y TCP (`KNXTunneling`, `KNXnetIPServer`, `KnxKeyring`)

> **Nota**: Validado contra los vectores del Anexo A de `03_08_09`, archivos `.knxkeys` reales de ETS y hardware físico de KNX IP Secure Routing (LogicMachine + Zennio MAXinBOX 66 v3). KNX IP Secure Tunneling está validado contra vectores oficiales de `03_08_09` y pasarelas simuladas.

#### 0. Configuración en ETS y Exportación del Archivo `.knxkeys`

Antes de usar KNX IP Secure en `KNX.ts`, configura la seguridad en ETS y exporta el anillo de claves (keyring) del proyecto:

1. **Proteger el proyecto de ETS con contraseña**: Abre la configuración del proyecto en ETS5/ETS6 y establece una **Contraseña del proyecto** (ETS la exige para habilitar KNX Secure).
2. **Configurar IP Secure en ETS**:
   - **Para IP Secure Tunneling**: Añade tu Interfaz IP / Router IP KNX en la topología, activa la **Puesta en marcha segura / IP Secure** (introduciendo su **FDSK** o código QR cuando ETS lo solicite), revisa los slots de **Tunneling** (cada canal tiene su propia Dirección Individual y contraseña de usuario) y descarga la interfaz IP.
   - **Para IP Secure Routing (Backbone)**: Selecciona la línea **Backbone** (`0.0`) o el Router IP en ETS, activa **Seguridad / Enrutamiento Seguro**, verifica la dirección multicast (por defecto `224.0.23.12`) y la **Clave Backbone**, y descarga el Router IP. *(Si usas un router externo como LogicMachine, puedes consultar la Backbone Key de 32 caracteres hexadecimales con `keyring.getBackbone()?.decryptedKey?.toString("hex")` y pegarla en su campo "Clave de encriptado".)*
3. **Exportar el archivo `.knxkeys`**:
   - **ETS5**: Ve a la vista **Proyectos** → selecciona tu proyecto → **Detalles** → **Seguridad** → **Exportar claves** (`.knxkeys`) e introduce una **Contraseña de exportación**.
   - **ETS6**: Abre el proyecto → **Resumen / Overview** (esquina superior izquierda) → **Seguridad** → **Exportar anillo de claves / Export Keyring** (`.knxkeys`) e introduce una **Contraseña de exportación**.
   - Usa esa contraseña de exportación como `keyringPassword` en `KNX.ts`. Vuelve a exportar el `.knxkeys` cada vez que agregues dispositivos seguros, cambies slots de túnel o regeneres claves.

#### 1. Túnel sobre TCP Plano (`03_08_04` §2.6.2)

```typescript
import { KNXTunneling } from "knx.ts";

const tcpTunnel = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  transport: "TCP", // Utiliza HPAI nulo (0.0.0.0:0) y omite TUNNELLING_ACK según la especificación
});

await tcpTunnel.connect();
```

#### 2. Cliente de Túnel con KNX IP Secure sobre TCP (`03_08_09`)

Puedes autenticar una sesión de túnel seguro proporcionando las contraseñas manualmente o cargando directamente el archivo `.knxkeys` exportado desde ETS:

```typescript
import { KNXTunneling, KnxKeyring } from "knx.ts";

// Opción A: Credenciales manuales
const secureTunnel = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  secure: {
    userId: 2, // 1 = Gestión (Management), >= 2 = Canal de Tunnelling
    userPassword: "miPasswordDeTunel",
    deviceAuthenticationPassword: "miAuthPasswordOFDSK",
  },
});

// Opción B: Cargando directamente un archivo .knxkeys exportado de ETS
const secureTunnelFromKeyring = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  secure: {
    keyringFile: "./proyecto.knxkeys",
    keyringPassword: "passwordDelKeyring",
    tunnelInterfaceAddress: "1.1.1", // Opcional: selecciona el slot de túnel específico del keyring
  },
});

// Inspección directa de un archivo .knxkeys:
const keyring = KnxKeyring.fromSource("./proyecto.knxkeys", "passwordDelKeyring");
console.log("Backbone Key:", keyring.getBackbone()?.decryptedKey?.toString("hex"));
console.log("Interfaces:", Array.from(keyring.getInterfaces().values()));

// Crear o editar un keyring y exportar un archivo .knxkeys firmado (sin necesitar ETS):
const nuevoKeyring = KnxKeyring.create({ project: "MiEdificio" });
nuevoKeyring.ensureGroupKey("1/0/1"); // Clave AES-128 aleatoria de 16 bytes
nuevoKeyring.setDevice({ individualAddress: "1.1.1", toolKey: "generate", sequenceNumber: 1n });
nuevoKeyring.addInterfaceGroupSender("1.1.200", "1/0/1", "1.1.1");
nuevoKeyring.saveFile("./MiEdificio.knxkeys", "claveExportacion"); // o nuevoKeyring.toBuffer("claveExportacion")
```

#### 3. Enrutamiento Multicast Seguro (Secure Routing) en `KNXnetIPServer`

```typescript
import { KNXnetIPServer } from "knx.ts";

const secureServer = new KNXnetIPServer({
  localIp: "192.168.1.50",
  individualAddress: "1.1.200",
  friendlyName: "Secure TypeScript KNX Router",
  secure: {
    // Proporciona una Backbone Key de 16 bytes directamente o cárgala desde .knxkeys:
    keyringFile: "./proyecto.knxkeys",
    keyringPassword: "passwordDelKeyring",
    multicastLatencyToleranceMs: 2000,
  },
});

await secureServer.connect();
```

---

### Guía de KNX Data Secure (`KnxDataSecure`, `03_03_07` §5)

#### 1. Configuración en ETS: Asignar la Dirección Individual y Exportar `.knxkeys`

Cada dispositivo KNX Data Secure mantiene una tabla interna de direcciones individuales autorizadas (**Security Individual Address Table**, `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`). En comunicación de grupo cifrada (`GroupValue_Write` / `GroupValue_Read`), el dispositivo destino **solo acepta telegramas seguros cuya Dirección Individual (IA) de origen haya sido autorizada en ETS**; de lo contrario, descarta silenciosamente la trama e incrementa su contador de fallos de seguridad.

Sigue estos pasos en **ETS5 / ETS6** antes de conectar con `KNX.ts`:

1. **Configurar contraseña del proyecto**: Asegúrate de que el proyecto en ETS tenga contraseña para habilitar KNX Secure.
2. **Añadir dispositivos seguros y activar seguridad en Direcciones de Grupo**:
   - Añade tus dispositivos KNX Data Secure (por ejemplo, actuadores o sensores) a la topología e introduce su **FDSK** (Factory Default Setup Key / código QR) cuando ETS lo pida.
   - Crea tus Direcciones de Grupo y verifica que la propiedad **Seguridad** esté activada (*Automático* o *Activado*).
3. **Asignar la Dirección Individual de `KNX.ts` en el proyecto de ETS**:
   - **Si te conectas por IP Routing (`KNXnetIPServer`), USB o TP-UART**:
     1. En la línea correspondiente de la Topología en ETS, añade un dispositivo **Dummy / Visualización** (por ejemplo, *KNX Association → Dummy*) o un **Router IP**, y asígnale una Dirección Individual libre (por ejemplo, `1.1.200`).
     2. Asocia todas las Direcciones de Grupo seguras que `KNX.ts` va a leer o escribir a ese Dummy/Router IP (arrastrando las Direcciones de Grupo a las asociaciones de la interfaz o a sus objetos de grupo para que ETS registre `1.1.200` como emisor/receptor autorizado).
   - **Si te conectas por IP Tunneling (`KNXTunneling`)**:
     1. Selecciona tu Interfaz IP / Router IP en la Topología de ETS y revisa sus canales de **Tunneling** (cada canal tiene su propia IA, por ejemplo `1.1.250`).
     2. Asocia las Direcciones de Grupo seguras al canal de Tunneling específico que usará `KNX.ts` (en las propiedades de **Asociaciones / Direcciones de Grupo** de ese túnel).
4. **Descargar (Programar) los dispositivos KNX Data Secure**:
   - Realiza una **Descarga de aplicación / Descarga parcial** en **todos los dispositivos KNX Data Secure** que compartan esas Direcciones de Grupo.
   - Al programarlos, ETS escribe tu IA asignada (`1.1.200` o la IA del túnel) en la `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` de cada dispositivo junto con las claves de grupo compartidas.
5. **Exportar el archivo `.knxkeys`**:
   - **ETS5**: *Proyectos* → selecciona el proyecto → **Detalles** → **Seguridad** → **Exportar claves** (`.knxkeys`) y define una contraseña de exportación.
   - **ETS6**: Abre el proyecto → **Resumen / Overview** → **Seguridad** → **Exportar anillo de claves / Export Keyring** (`.knxkeys`) y define una contraseña de exportación.
   - **Importante**: Exporta el `.knxkeys` **después** de asignar la IA, vincular las Direcciones de Grupo y descargar los dispositivos para que el archivo incluya las claves de grupo, `ToolKey`s y números de secuencia actualizados.
6. **Usar la misma Dirección Individual en `KNX.ts`**:
   - En **IP Routing (`KNXnetIPServer`)** y **TP-UART (`TPUARTConnection`)**, configura tanto `individualAddress` como `dataSecure.sourceAddress` con la IA exacta asignada en ETS (por ejemplo, `"1.1.200"`).
   - En **KNX USB (`KNXUSBConnection`)**, `KNX.ts` selecciona automáticamente **`cEMI`** y lee la IA física del stick (`hardwareIndividualAddress`). Para que funcionen a la vez tanto telegramas de grupo como sesiones punto a punto (`KNXManagement` / `S-A_Sync`), la IA física del stick USB debe coincidir con la IA autorizada en ETS: puedes omitir `individualAddress` para usar la IA del stick, pasar `programHardwareAddress: true` junto con `individualAddress: "1.1.200"`, o llamar a `await usb.setHardwareIndividualAddress("1.1.200")` (escribe `PID_SUBNET_ADDR` / `PID_DEVICE_ADDR` por `M_PropWrite.req`).
   - En **Tunneling (`KNXTunneling`)**, la pasarela asigna la IA del túnel al conectar; verifica que coincida con el canal de túnel autorizado en ETS.
   - *Nota para sesiones de gestión*: Las sesiones de gestión seguras (`KNXManagement` con `{ secure: true }`) utilizan la `ToolKey` del dispositivo desde el `.knxkeys` y no requieren que la IA esté en la tabla de grupos; sin embargo, si pasas por un router/pasarela IP (como LogicMachine), asegúrate de activar la opción *"Pasar telegramas individuales vía enrutado IP"*.

#### 2. Ejemplos de Uso en `KNX.ts` (IP, KNX USB y TP-UART)

Pasa `dataSecure` a cualquier `KNXService` (`KNXTunneling`, `KNXnetIPServer`, `KNXUSBConnection` o `TPUARTConnection`) para cifrar automáticamente los telegramas de grupo salientes (`write`, `read`, `respond`) y descifrar los `S-A_Data` entrantes (`0x03F1`), o úsalo con `KNXManagement` para sesiones seguras con `ToolKey`:

```typescript
import {
  KNXnetIPServer,
  KNXUSBConnection,
  TPUARTConnection,
  KNXManagement,
  KnxDataSecure,
  KnxDataDecode,
  DataSecureCEMI,
} from "knx.ts";

const dataSecure = new KnxDataSecure({
  keyringFile: "./proyecto.knxkeys",
  keyringPassword: "passwordDelKeyring",
  sourceAddress: "1.1.200", // Debe coincidir con la IA autorizada en ETS (Paso 3)
  sequenceNumberFile: "./seq_state.json", // Persiste los contadores de 48 bits entre reinicios
});

// Opción A: KNXnet/IP Routing (plano o combinado con KNX IP Secure Routing)
const knx = new KNXnetIPServer({
  ip: "224.0.23.12",
  localIp: "192.168.1.50",
  individualAddress: "1.1.200",
  tcp: false,
  dataSecure,
});

// Opción B: Interfaz KNX USB directa (cEMI + HID multi-trama + programación opcional de IA hardware)
// const knx = new KNXUSBConnection({
//   individualAddress: "1.1.200",
//   programHardwareAddress: true, // Opcional: programa 1.1.200 en el stick USB vía M_PropWrite.req
//   dataSecure,
// });
// O cambiar la IA física tras conectar: await knx.setHardwareIndividualAddress("1.1.200");

// Opción C: Transceptor serie TP-UART / TP-UART2 / NCN5120 (Tramas Extendidas TP1)
// const knx = new TPUARTConnection({
//   path: "/dev/ttyUSB0",
//   individualAddress: "1.1.200",
//   dataSecure,
// });

knx.on("indication", (cemi: DataSecureCEMI) => {
  if (cemi.dataSecure) {
    console.log("Telegrama Data Secure descifrado:", cemi.sourceAddress, "->", cemi.destinationAddress, "seq:", cemi.dataSecure.sequenceNumber);
    console.log("Valor:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data));
  }
});

await knx.connect();
await knx.write("1/0/1", "1.001", true); // Se cifra automáticamente con la clave de grupo (A+C)

// Sesión de gestión segura usando ToolKey + S-A_Sync automático:
const mgmt = new KNXManagement(knx, { dataSecure });
await mgmt.withSession("1.1.1", async (session) => {
  console.log("Security Mode:", await session.readSecurityMode());
  console.log("Security IA Table:", await session.readSecurityIndividualAddressTable());
  console.log("Failures Log:", await session.readSecurityFailuresLog());
}, { secure: true });
```

---

### Guía Completa de Gestión de Red y Dispositivos (`KNXManagement`)

> **Nota**: Implementa el stack completo de KNX Management (`03_05_02`, `03_03_07`, `03_08_03`) tanto para lectura como para escritura. Validado contra capturas reales de ETS (`test_xml/`), dispositivos simulados y hardware físico KNX Data Secure (Security Interface Object Type 17 y sesiones con `ToolKey` en Zennio MAXinBOX 66 v3).

```typescript
import {
  KNXManagement,
  KNXPropertyId,
  LoadEvent,
  RunEvent,
  RestartEraseCode,
} from "knx.ts";

const mgmt = new KNXManagement(tunnel, {
  sourceAddress: "1.1.250",
  minFrameDelayMs: 20,
});
```

#### 1. Programación de Dirección Individual y de Dominio (`NM_*`)

```typescript
// A. Leer todos los dispositivos con el botón de programación activo (detecta direcciones duplicadas)
const prog = await mgmt.readProgrammingModeDevices();
console.log("En modo programación:", prog.addresses, "Duplicadas:", prog.duplicates);

// B. Programar la Dirección Individual del dispositivo en modo programación (NM_IndividualAddress_Write)
// Verifica automáticamente si 1.1.10 está ocupada por otro dispositivo, escribe la IA, verifica DD0 y ejecuta Basic Restart
const writeRes = await mgmt.writeIndividualAddress("1.1.10");

// C. Programar la Dirección Individual mediante Número de Serie de 6 bytes sin pulsar botón (NM_IndividualAddress_SerialNumber_Write)
const serialRes = await mgmt.writeIndividualAddressBySerial(
  Buffer.from("00FA12345678", "hex"),
  "1.1.12",
);

// D. Restablecer la Dirección Individual del dispositivo en modo programación a 15.15.255 (NM_IndividualAddress_Reset)
await mgmt.resetIndividualAddress();

// E. Leer y Escribir Dirección de Dominio (PL110 2 bytes / RF 6 bytes)
const domains = await mgmt.readDomainAddress();
await mgmt.writeDomainAddress(Buffer.from([0x00, 0x1a]));
await mgmt.writeDomainAddressBySerial(
  Buffer.from("00FA12345678", "hex"),
  Buffer.from([0x00, 0x1a]),
);
```

#### 2. Descubrimiento, Diagnóstico e Inventario de Dispositivos

```typescript
// Comprobar si una dirección individual está ocupada en el bus (detecta tanto respuesta DD0 como T_Disconnect inmediato)
const occupied = await mgmt.isAddressOccupied("1.1.10");

// Ejecutar la secuencia exacta de "Comprobación de Dirección Individual" de ETS (DD0 + PID_MAX_APDULENGTH + PID_PROG_MODE)
const check = await mgmt.checkIndividualAddress("1.1.10");

// Identificación completa del dispositivo (DM_Identify_RCo2: DD0, Manufacturer ID, Serial, HW Type, Order Info, Firmware)
const identity = await mgmt.identifyDevice("1.1.10");

// Escanear una línea (method: "connect" o "descriptor") y exportar inventario en JSON
const activeAddresses = await mgmt.scanLine("1.1", { range: [1, 64], method: "connect" });
const inventory = await mgmt.exportInventory(activeAddresses);
```

#### 3. Sesiones Persistentes (`withSession` / `openSession`), Autorización y Claves

Cuando un dispositivo requiere autorización (`A_Authorize_Request`), el nivel de acceso concedido solo se mantiene mientras permanezca abierta la misma conexión `T_Connect`. Utiliza `mgmt.withSession(ia, async (session) => { ... })` para encadenar múltiples operaciones sobre la misma sesión orientada a conexión:

```typescript
await mgmt.withSession("1.1.10", async (session) => {
  // 1. Autenticarse con una clave de 4 bytes (la clave por defecto de fábrica suele ser 0xFFFFFFFF)
  const accessLevel = await session.authorize(0xffffffff);
  console.log("Nivel de acceso concedido:", accessLevel);

  // 2. Opcionalmente escribir una nueva clave para el nivel de acceso 1 (DM_SetKey_RCo)
  await session.setKey(1, 0x11223344);

  // 3. Conmutar remotamente el LED de modo programación del dispositivo (DM_ProgMode_Switch)
  await session.setProgrammingMode(true);
  console.log("Modo programación activo:", await session.readProgrammingMode());
  await session.setProgrammingMode(false);
});
```

#### 4. Propiedades y Funciones de Objetos de Interfaz (Estándar y Extendidas)

```typescript
// Escanear todas las propiedades disponibles en el Objeto de Interfaz 0 (Device Object)
const propDescriptions = await mgmt.scanObjectProperties("1.1.10", 0);

// Leer y Escribir propiedades estándar (A_PropertyValue_Read / Write)
const routingCount = await mgmt.readProperty("1.1.10", {
  objectIndex: 0,
  propertyId: KNXPropertyId.PID_ROUTING_COUNT,
});

await mgmt.writeProperty(
  "1.1.10",
  {
    objectIndex: 0,
    propertyId: KNXPropertyId.PID_ROUTING_COUNT,
    data: Buffer.from([0x60]),
  },
  { verify: true, authKey: 0xffffffff },
);

// Invocar una Function Property (A_FunctionPropertyCommand) o consultar su estado
const fnResult = await mgmt.callFunctionProperty("1.1.10", {
  objectIndex: 0,
  propertyId: 50,
  data: Buffer.from([0x01, 0x02]),
});

// Propiedades Extendidas (direccionamiento por Object Type de 16 bits, Instance de 12 bits y PID de 12 bits)
const extVal = await mgmt.readPropertyExtended("1.1.10", {
  objectType: 0,
  objectInstance: 1,
  propertyId: KNXPropertyId.PID_SERIAL_NUMBER,
});
```

#### 5. Lectura/Escritura de Memoria (16 bits, 20 bits Usuario, 24 bits Extendida) y Máquinas de Estados

```typescript
await mgmt.withSession("1.1.10", async (session) => {
  await session.authorize(0xffffffff);

  // 1. Memoria estándar de 16 bits con segmentación automática y verificación de lectura (DMP_MemWrite_RCoV)
  const memDump = await session.readMemory(0x0100, 32);
  await session.writeMemory(0x0100, Buffer.alloc(32, 0xaa), { verify: true, maxChunkSize: 12 });

  // 2. Modificación de bits individuales en memoria (A_MemoryBit_Write)
  await session.writeMemoryBit(0x0060, Buffer.from([0xfe]), Buffer.from([0x01]));

  // 3. Memoria de Usuario de 20 bits (A_UserMemory_Read / Write) y Memoria Extendida de 24 bits (A_MemoryExtended_Read / Write)
  const userMem = await session.readUserMemory(0x00100, 16);
  await session.writeUserMemory(0x00100, userMem, { verify: true });
  await session.writeExtendedMemory(0x010000, Buffer.from([0x01, 0x02, 0x03, 0x04]));

  // 4. Máquina de Estados de Carga (PID_LOAD_STATE_CONTROL = 5) y de Ejecución (PID_RUN_STATE_CONTROL = 6)
  await session.writeLoadState(3, LoadEvent.UNLOAD);
  await session.writeLoadState(3, LoadEvent.START_LOADING);
  // ... escribir tablas/parámetros en memoria o propiedades ...
  await session.writeLoadState(3, LoadEvent.LOAD_COMPLETED);
  await session.writeRunState(3, RunEvent.RESTART);
});
```

#### 6. Leer Todas las Direcciones de Grupo de un Dispositivo, Enlaces y Reinicio / *Master Reset*

```typescript
// Leer TODAS las Direcciones de Grupo programadas en la Tabla de Direcciones de Grupo del dispositivo (GrAT, 03_05_01 §4.16)
// Detecta automáticamente System B / System 7 PID_TABLE (23), BCU2 / BIM PID_TABLE_REFERENCE (7),
// memoria fija BCU1 (0x0116 / 0x4000) o servicios de enlace (A_Link_Read)
const gaTable = await mgmt.readDeviceGroupAddresses("1.1.10");
console.log("Direcciones de grupo del dispositivo:", gaTable.groupAddresses, "vía:", gaTable.method);

// Leer Direcciones de Grupo asociadas al Objeto de Grupo #1 (A_Link_Read)
const links = await mgmt.readGroupObjectLinks("1.1.10", 1);

// Añadir o eliminar una Dirección de Grupo en el Objeto de Grupo #1 (A_Link_Write)
await mgmt.writeGroupObjectLink("1.1.10", 1, "1/1/5", { sending: true });

// Reinicio Básico (restart_type = 0)
await mgmt.restartDevice("1.1.10", { type: "basic" });

// Master Reset Confirmado (restart_type = 1, p. ej. restablecimiento de fábrica conservando la Dirección Individual)
const resetInfo = await mgmt.restartDevice("1.1.10", {
  type: "master",
  eraseCode: RestartEraseCode.FACTORY_RESET_WITHOUT_IA,
  channelNumber: 0,
  authKey: 0xffffffff,
});
console.log("Tiempo estimado de Master Reset (s):", resetInfo?.processTimeSeconds);
```

#### 7. Gestión Local cEMI de la Propia Interfaz (`M_PropRead` / `M_PropWrite` / `M_Reset`)

Sobre una conexión `DEVICE_MGMT_CONNECTION` o USB local cEMI, puedes leer y escribir propiedades de la propia interfaz conectada:

```typescript
const localSerial = await mgmt.readLocalProperty({
  objectType: 0,
  objectInstance: 1,
  propertyId: KNXPropertyId.PID_SERIAL_NUMBER,
});

await mgmt.writeLocalProperty({
  objectType: 0,
  objectInstance: 1,
  propertyId: KNXPropertyId.PID_PROG_MODE,
  data: Buffer.from([0x00]),
});

await mgmt.resetLocalDevice();
```

### Programación Directa desde `.knxprod` y API para Apps Web (`DeviceConfigSession`, `KNXDeviceProgrammer`)

> **Guía Completa**: Consulta [docs/PROGRAMMING_GUIDE_ES.md](./docs/PROGRAMMING_GUIDE_ES.md) ([English version](./docs/PROGRAMMING_GUIDE.md)) para ver la arquitectura backend/frontend de aplicaciones web, mapa de widgets, comisionamiento Fase 2 KNX Data Secure Object 17 (`FDSK -> ToolKey` y `.knxkeys`), comandos del CLI y solución de problemas.

`DeviceConfigSession` convierte cualquier `.knxprod` de ETS en un **configurador 100% serializable a JSON** (`getUiState()` para el frontend web y `toJSON()` / `fromJSON()` para guardar en base de datos), listo para compilar y descargar a hardware físico System B (`MV-07B0`):

```typescript
import {
  DeviceConfigSession,
  KNXDeviceProgrammer,
  KnxKeyring,
  KnxProdParser,
} from "knx.ts";

// 1. Parsear catálogo .knxprod con traducciones en español (streaming, soporta XML de 60+ MB)
const parsed = await KnxProdParser.parseFile("./producto.knxprod", { language: "es-ES" });

// 2. Abrir sesión interactiva (envía session.getUiState() directamente a tu frontend Web)
const session = new DeviceConfigSession(parsed);
const uiState = session.getUiState(); // Canales -> Bloques -> Parámetros tipados/Separadores + ComObjects activos

// 3. Aplicar cambios del usuario (re-evalúa <Dynamic> y JS calcs, devolviendo diffs exactos)
const diff = session.setParameters({ bOutput: 1, "outputCh[0].type": 1, "indOutput[0].bEnabled": 1 });
session.linkGroupObject(765, { sending: "1/0/1", security: "auth_conf" });
session.linkGroupObject(766, { sending: "1/1/1", security: "auth_conf" });

// 4. Comisionamiento Fase 2 KNX Data Secure (Object Type 17) usando .knxkeys de ETS
const keyring = KnxKeyring.fromSource("./proyecto.knxkeys", "claveKeyring");
session.setSecurityConfig({ enabled: true, keyring, authorizedSenders: ["1.1.200"] });

// 5. Validar, guardar borrador JSON y programar dispositivo (Tunneling, USB, Routing o TP-UART)
const validation = session.validate();
if (validation.valid) {
  const borradorBd = session.toJSON({ includeSecrets: false });
  const programmer = new KNXDeviceProgrammer(tunnel, { sourceAddress: "1.1.200", dataSecure });
  await session.download(programmer, "1.1.1", {
    mode: "ap1",
    dryRun: false, // Poner true para validar en vivo sin escribir en memoria flash
    sessionOptions: { secure: true },
    onProgress: (ev) => console.log(`[${ev.percent}%] (${ev.phase}) ${ev.message}`),
  });
}
```

### Enrutador de enlaces (Router)

Si deseas combinar distintas conexiones KNX que soporta la libreria y enrutar sus mensajes puedes instanciarlas atravez de la clase ``Router``, cada una es opcional por lo tanto se pueden hacer distintas combinaciones

Tu puedes programar dispositivos KNX reales manteniendo un enlace KNXnetIpServer para que se conecte ETS y un enlace que pueda comunicarse atravez del bus KNX (TPUART, KNXUSB), para que esto se cumpla asigne en falso o lo deja por defecto la opción `handleHopCount` y asigne en verdadero o lo deja por defecto la opción `isUseSingleIA`.

```typescript
import { Router } from "knx.ts";

const router = new Router({
  individualAddress: "1.1.250",
    knxNetIpServer: {
      ip: MULTICAST_IP,
      port: PORT,
      localIp: "192.168.0.200",
      friendlyName: "Test",
      clientAddrs: "15.15.1:5",
      useAllInterfaces: true,
      logOptions: { level: "info" },
    },
    usb: {
      logOptions: {
        level: "debug",
      },
    },
    tpuart: {
      path: "/dev/ttyAMA0"
    },
    tunneling: [
      {
        ip: "192.168.0.10"
      },
      {
        ip: "192.168.0.50"
      }
    ],
    toIpFilter: { // (Opcional) Filtar direcciones hacia conexiones Tunneling y KNXnetIPServer
      groupAddress: {
        addresses: [],
        groupAddressToIpFilterPolicie: "accept only"
      },
      individualAddress: {
        addresses: [],
        individualAddressToIpFilterPolicie: "discard all"
      }
    },
    toLocalFilter: { // (Opcional) Filtar direcciones hacia conexiones TPUART y KNXUSB
      groupAddress: {
        addresses: [],
        groupAddressToLocalFilterPolicie: "discard all"
      },
      individualAddress: {
        addresses: [],
        individualAddressToLocalFilterPolicie: "accept only"
      }
    },
    logOptions: { // El Router tambien se le puede configurar el logger
      level: "debug",
    },
  });

  router.connect()

  router.on("indication_link", (msg: {src: string, msg: CEMIInstance}) => {
    // Aqui puedes capturar todos los mensajes de los enlaces
    console.log(msg)
  })
```

## 🌐 (API)

### GroupAddressCache (Caché Integrada)

Las pasarelas dependen del `GroupAddressCache` interno de la librería para conocer qué DPT se asocia a cada dirección de grupo, lo que les permite decodificar automáticamente valores y recibirlos en formato primtivo sin enviar la DPT en cada petición.

Todos los `KNXService` (tales como `KNXnetIPServer`, `Router`, etc.) integran un `GroupAddressCache`. Él escucha los telegramas de entrada y recuerda el último valor conocido junto con el histórico para las distintas herramientas de consulta en las APIs de WebSocket o lecturas internas locales.

> **Importante**: La caché viene **deshabilitada por defecto** para ahorrar memoria en proyectos que no la requieran.
> Para activarla (muy recomendado antes de usar `KNXWebSocketGateway` o `KNXMQTTGateway`), debes habilitarla globalmente así:

```typescript
import { GroupAddressCache } from 'knx.ts';

// Habilita el singleton global
GroupAddressCache.getInstance().setEnabled(true);

// Opcionalmente puedes configurar sus límites de espacio (máx direcciones en memoria, máx msj históricos por dirección)
GroupAddressCache.getInstance().configure(65535, 10);
```

Si creas una instancia de un enrutador y registras enlaces en él, el enrutador se encargará de la gestión de la caché y hará lo mismo con los eventos de direcciones de destino.

```typescript
import { Router, KNXUSBConnection, CEMIInstance } from "knx.ts";

const router = new Router({});
const usb = new KNXUSBConnection({
  individualAddress: "1.1.250"
});
// El enrutador se encargará de la gestión de la caché y emitirá eventos de direcciones de destino en lugar del enlace.
router.addLink(usb);

router.on("error", (err) => {
  console.error(err)
})

router.on("indication_link", (data: { src: string, msg: CEMIInstance }) => {
  console.log("Source:", data.src);
  console.log("New data:", data.msg.TPDU.apdu.data); // Raw APDU data
  console.log("Decoded data:", KnxDataDecode.decodeThis("1.001", data.msg.TPDU.apdu.data)); // Converted JavaScript value
});

router.on("1/1/1", (cemi: CEMIInstance) => { // <--- se activa
  console.log("Nuevos datos en 1/1/1:", cemi.TPDU.apdu.data); // Datos crudos del APDU
  console.log("Datos decodificados:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Valor de javascript convertido
});

usb.on("1/1/1", (cemi: CEMIInstance) => { // <--- no se activa
  console.log("Nuevos datos en 1/1/1:", cemi.TPDU.apdu.data); // Datos crudos del APDU
  console.log("Datos decodificados:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Valor de javascript convertido
});
```

## 📝 Registros (Logging)

La librería utiliza un registrador único global y personalizado que ejecuta sus operaciones de escritura en archivos mediante `worker_threads` para evitar bloqueos en el bucle de eventos. Puedes configurarlo al comienzo de tu aplicación usando `setupLogger`.

Esto es crucial porque no necesitas instanciar el logger tú mismo; el `knxLogger` interno gestiona su estado, el reloleo diario de archivos y el etiquetado semántico de módulos.

```typescript
import { setupLogger, knxLogger } from "knx.ts";

// Configurar el registrador global
setupLogger({
  level: "debug", // ej., 'info', 'warn', 'error', 'debug'
  logToFile: true,
  logDir: "./logs",
});

// También puedes usar el registrador global en tu propia aplicación
knxLogger.info("Aplicación iniciada");
```

Todos los componentes internos (`KNXnetIPServer`, `KNXTunneling`, `Router`, etc.) utilizan automáticamente este registrador compartido.

## 📡 Eventos y Callbacks

La librería está orientada a eventos. Dependiendo de la clase utilizada, se emiten diferentes eventos para proporcionar un control y monitoreo detallados.

### Monitoreo del Estado de la Conexión (FSM)

Todas las clases de conexión (`KNXnetIPServer`, `KNXTunneling`, `KNXUSBConnection`, `TPUARTConnection`) comparten un motor unificado de Máquina de Estados Finita (FSM). Esto asegura transiciones robustas, previene condiciones de carrera, y maneja de forma elegante las auto-reconexiones.
Puedes comprobar de forma síncrona el estado actual de cualquier conexión en todo momento leyendo la propiedad `connectionState`:

```typescript
import { KNXTunneling, KNXTunnelingState } from "knx.ts";

const tunnel = new KNXTunneling({ ip: "192.168.1.100", port: 3671 });

console.log(tunnel.connectionState); // "DISCONNECTED"

tunnel.connect().then(() => {
  console.log(tunnel.connectionState); // "CONNECTED"
});

// Si la red se cae, el FSM entra automáticamente en modo de recuperación
// console.log(tunnel.connectionState); // "RECONNECTING"
```

Las cadenas de texto de los estados están estrictamente tipadas y se exportan como enumerables/objetos (ej., `KNXTunnelingState`, `KNXUSBState`, `KNXServerState`, `TPUARTState`), permitiéndote manejar lógicas precisas en tu aplicación.

### Eventos Comunes

Todas las clases de conexión (`KNXnetIPServer`, `KNXTunneling`, `KNXUSBConnection`, `TPUARTConnection`) heredan de `KNXService` y emiten los siguientes eventos estándar:

| Evento           | Descripción                                                      | Argumentos del Callback                               |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `connected`      | Conexión establecida y hardware/socket listo.                    | `void` (Server/USB/TPUART) / `{ channelId }` (Tunnel) |
| `disconnected`   | Conexión perdida o cerrada explícitamente.                       | `void`                                                |
| `disconnected_client`   | Se perdió la conexión o se cerró explícitamente de un cliente tunel en KNXNetIPServer.                                                     | `number` (ChannelId)                                                |
| `error`          | Ocurrió un error fatal durante la operación.                     | `err: Error`                                          |
| `indication`     | Cualquier telegrama KNX estándar entrante (cEMI / L_Data.ind).   | `cemi: CEMIInstance`                                  |
| `raw_indication` | El Buffer sin procesar antes del análisis (EMI/cEMI/carga útil). | `data: Buffer`                                        |
| `indication_emi` | Emitido cuando se recibe un mensaje formateado en EMI1/EMI2 desde interfaces USB antiguas. | `emi: EMIInstance`                                    |
| `send`           | Emitido cuando se envía un mensaje al bus.                       | `data: CEMIInstance`                                  |

### Eventos Específicos de Clase

Dependiendo del tipo de conexión, algunas clases emiten eventos específicos adicionales:

#### **KNXnetIPServer**

- `queue_overflow`: Se dispara cuando la cola interna de Tunnelling para un cliente conectado se desborda.
- `routing_busy`: Se emite cuando se recibe una trama `ROUTING_BUSY` (`RoutingBusy` con `waitTime`).
- `routing_ready`: Se emite cuando finaliza la espera de `ROUTING_BUSY` y se reanuda el enrutamiento.
- `routing_lost_message`: Se emite cuando llega una indicación `ROUTING_LOST_MESSAGE` (`RoutingLostMessage`).
- `routing_system_broadcast`: Se emite con la carga útil cEMI cruda de un `ROUTING_SYSTEM_BROADCAST` entrante.
- `<DirecciónDeGrupo>` (ej., `"1/1/1"`): Escucha direcciones de grupo específicas directamente (ej., `server.on("1/1/1", (cemi) => {...})`).

#### **TPUARTConnection**

- `busmonitor`: Emitido en modo Busmonitor con tramas cEMI sin procesar.
- `bus_ack`: Emitido cuando el bus confirma una transmisión (Ack, Nack, Busy).
- `warning`: Emitido para advertencias de hardware no fatales (ej., colisión de esclavo detectada, error de transmisión).

#### **KNXUSBConnection**

- `indication_emi`: Emitido cuando se recibe un mensaje con formato EMI1/EMI2 antiguo de interfaces USB heredadas.

#### **KNXTunneling**

- `feature_info`: Emitido al recibir una notificación `TUNNELLING_FEATURE_INFO` desde el servidor (`(featureId: number, value: Buffer) => void`).
- `secure_session_established`: Emitido cuando se autentica una sesión KNX IP Secure sobre TCP (`({ sessionId }) => void`).
- `secure_session_closed`: Emitido cuando el servidor envía `SESSION_STATUS` cerrando o rechazando la sesión segura (`(status: number) => void`).
- `raw_message`: Emitido con la carga útil IP sin procesar (incluyendo las cabeceras KNXnet/IP completas, no solo cEMI).

#### **Router (Puente de Aprendizaje)**

Debido a que el `Router` enlaza múltiples interfaces, emite eventos de enrutamiento específicos del enlace en lugar de indicaciones estándar:

- `indication_link`: Emitido cuando un paquete se enruta a través del puente. Argumento: `{ src: string, msg: CEMIInstance }` donde `src` es el nombre de la clase de la conexión de origen.
- `error`: Emitido cuando falla un enlace subyacente. Argumento: `{ link: KNXService, error: Error }`.

### Entendiendo el Objeto Telegrama

El objeto `cemi` o `emi` (que implementa `ServiceMessage`) contiene toda la información sobre el telegrama KNX. Aquí están las propiedades más relevantes:

| Propiedad                | Tipo     | Descripción                                                        |
| ------------------------ | -------- | ------------------------------------------------------------------ |
| `sourceAddress`          | `string` | Dirección física del remitente (ej., `"1.1.5"`).                   |
| `destinationAddress`     | `string` | Dirección de grupo (ej., `"1/1/1"`) o dirección física.            |
| `TPDU.apdu.data`         | `Buffer` | Los datos de la carga útil sin procesar.                           |
| `TPDU.apdu.apci.command` | `string` | Tipo de comando (`A_GroupValue_Write`, `A_GroupValue_Read`, etc.). |

#### Manejo de Cargas Útiles de Datos

KNX maneja los datos de dos maneras dependiendo del tamaño:

- **Datos Cortos (<= 6 bits)**: Para DPT1 (Interruptor), DPT3 (Control), etc. El `cemi.TPDU.apdu.data[0]` contiene el valor.
- **Datos Extendidos (> 6 bits)**: Para DPT5 (Escalado), DPT9 (Flotante), etc. El Buffer `cemi.TPDU.apdu.data` contiene la carga útil completa (ej., 2 bytes para DPT9).

## 🔢 Codificación y Decodificación de Datos

La librería proporciona utilidades estáticas para manejar la conversión de Tipos de Puntos de Datos (DPT) de KNX entre Buffers sin procesar y objetos de TypeScript de alto nivel.

### Decodificación de Datos Entrantes

Usa `KnxDataDecode` para transformar los datos cEMI sin procesar en valores legibles. Puedes usar el método genérico `decodeThis` (que infiere automáticamente el tipo según el DPT indicado) o métodos específicos con el prefijo `asDpt`:

```typescript
import { KnxDataDecode } from "knx.ts";

server.on("1/1/1", (cemi) => {
  // Decodificar como DPT 1 (Booleano) -> devuelve boolean (true | false)
  const value = KnxDataDecode.decodeThis(1, cemi.TPDU.apdu.data);
  console.log("Valor decodificado:", value); // true o false

  // Decodificar directamente mediante método específico
  const value1 = KnxDataDecode.asDpt1(cemi.TPDU.apdu.data);

  // Decodificar como DPT 9 (Flotante de 2 bytes, ej., Temperatura) -> devuelve number
  const temp = KnxDataDecode.decodeThis(9, cemi.TPDU.apdu.data);
  console.log("Temperatura:", temp, "°C");

  // También se admiten cadenas con la numeración estándar del DPT
  const temp1 = KnxDataDecode.decodeThis("9.001", cemi.TPDU.apdu.data);
  const percentage = KnxDataDecode.decodeThis("5.001", cemi.TPDU.apdu.data);

  // Los DPTs complejos devuelven objetos estructurados descriptivos:
  // DPT 10.001 (Time of Day) -> { day: 1, dayName: "Monday", hour: 14, minutes: 30, seconds: 0 }
  const time = KnxDataDecode.decodeThis(10001, cemi.TPDU.apdu.data);

  // DPT 251.600 (RGBW) -> { R: { value, valid }, G: { ... }, B: { ... }, W: { ... } }
  const rgbw = KnxDataDecode.decodeThis(251600, cemi.TPDU.apdu.data);
});
```

Todos los métodos de `KnxDataDecode` incluyen JSDocs en inglés y lanzan errores descriptivos si el tamaño del buffer es insuficiente o el formato es inválido.

### Codificación de Datos para el Envío

Usa `KnxDataEncoder` con el método `encodeThis` para validar y preparar buffers para telegramas KNX. Existen también métodos específicos `encodeDpt...`, pero `encodeThis` proporciona inferencia estricta en TypeScript y delegación automática:

- **DPTs de valor único** (ej., DPT 1, 5, 5.001, 5.002, 6, 7, 8, 9, 12, 13, 14, 20, 28.001, 29): Aceptan **tanto el valor primitivo directo** como el objeto envolvente `{ value: ... }`.
- **DPTs multifunción complejos** (ej., DPT 2, 3, 10.001, 11.001, 15, 27.001, 238.600, 245.600, 250.600, 251.600): Aceptan objetos estructurados tipados con sus campos requeridos correspondientes.

```typescript
import { KnxDataEncoder } from "knx.ts";

// --- DPTs de Valor Único: Primitivo Directo o Envolvente { value } ---

// DPT 1 (Booleano): acepta boolean directamente o { value: boolean }
const buf1Raw = KnxDataEncoder.encodeThis(1, true);
const buf1Obj = KnxDataEncoder.encodeThis(1, { value: true });

// DPT 5.001 (Porcentaje 0-100%): acepta number o { value: number }
const buf5Raw = KnxDataEncoder.encodeThis(5001, 75);
const buf5Obj = KnxDataEncoder.encodeThis("5.001", { value: 75 });

// DPT 9 (Flotante de 2 bytes / Temperatura): acepta number o { value: number }
const buf9Raw = KnxDataEncoder.encodeThis(9, 21.5);
const buf9Obj = KnxDataEncoder.encodeThis("9.001", { value: 21.5 });

// DPT 28.001 (Cadena UTF-8) y DPT 29 (BigInt de 64 bits)
const buf28 = KnxDataEncoder.encodeThis(28001, "Salón Principal");
const buf29 = KnxDataEncoder.encodeThis(29, 123456789012345n);

// --- DPTs Complejos Multifunción: Objetos Estructurados ---

// DPT 2 (1 bit control + 1 bit valor)
const buf2 = KnxDataEncoder.encodeThis(2, { control: 1, value: 0 });

// DPT 3.007 / 3.008 (Control de Regulación / Persianas)
const buf3 = KnxDataEncoder.encodeThis(3007, { control: 1, stepCode: 5 });

// DPT 10.001 (Hora del Día: day, hour, minutes, seconds)
const bufTime = KnxDataEncoder.encodeThis(10001, {
  day: 1, // Lunes
  hour: 14,
  minutes: 30,
  seconds: 0,
});

// DPT 11.001 (Fecha: day, month, year)
const bufDate = KnxDataEncoder.encodeThis(11001, {
  day: 25,
  month: 9,
  year: 2026,
});

// DPT 251.600 (RGBW con máscaras de validez individuales)
const bufRgbw = KnxDataEncoder.encodeThis(251600, {
  R: 255, G: 128, B: 0, W: 64,
  mR: 1, mG: 1, mB: 1, mW: 1,
});
```

### Verificación Rigurosa de Datos y Diagnóstico de Errores (`InvalidParametersForDpt`)

`KnxDataEncoder` valida rigurosamente los datos antes de serializarlos. Si un valor no cumple con el tipo, rango o estructura esperada, lanza un error `InvalidParametersForDpt` con diagnóstico detallado:

- `error.dpt`: El número de DPT que se intenta codificar.
- `error.received`: El dato recibido.
- `error.property`: La propiedad exacta que falló la validación (ej. `'hour'`, `'value'`, `'cCT'`).
- `error.expected`: Descripción del tipo o rango esperado (ej. `'number (0 to 23)'`).
- `error.reason`: Explicación detallada de por qué falló (ej. `'Value 25 is out of range (0 to 23)'` o `'Missing required property "hour"'`).

```typescript
import { KnxDataEncoder, InvalidParametersForDpt } from "knx.ts";

try {
  KnxDataEncoder.encodeThis(10001, { day: 1, hour: 25, minutes: 0, seconds: 0 } as any);
} catch (error) {
  if (error instanceof InvalidParametersForDpt) {
    console.error(`Error en DPT ${error.dpt}, propiedad "${error.property}":`);
    console.error(`Esperado: ${error.expected}`);
    console.error(`Motivo: ${error.reason}`);
  }
}
```

### Verificación sin Codificar (`encodeThisOnlyVerify`)

Si deseas validar entradas de usuario, cargas de APIs o datos de formularios sin generar un `Buffer`, utiliza `encodeThisOnlyVerify`:

```typescript
// Valida los datos según las reglas del DPT y devuelve el dato validado, o lanza InvalidParametersForDpt
const validatedData = KnxDataEncoder.encodeThisOnlyVerify(10001, userInput);
```

### Seguridad de Tipos e IntelliSense

Tanto `KnxDataDecode.decodeThis()` como `KnxDataEncoder.encodeThis()` están estrictamente tipados:

- **Soporte de IntelliSense**: Tu IDE sugerirá automáticamente los DPTs soportados mientras escribes el primer parámetro (números o cadenas en formato `"1.001"`, `"9.001"`).
- **Tipado Adaptativo de Datos**: El segundo parámetro ajusta automáticamente los tipos permitidos según el DPT seleccionado (permitiendo tanto primitivos directos como envolventes `{ value }` para DPTs de valor único, u objetos estructurados para DPTs complejos).
- **DPTs Soportados**: Puedes consultar programáticamente el array numérico de DPTs soportados:

  ```typescript
  console.log(KnxDataDecode.dptEnum);
  console.log(KnxDataEncoder.dptEnum);
  ```

## 🧪 Construcción y Envío Manual de Mensajes (Experimental)

La librería exporta clases de bajo nivel para construir o leer mensajes **cEMI** y **EMI** de forma granular. Esto es útil para diagnóstico, inyección de telegramas personalizados o para implementar servicios que no estén cubiertos por la API de alto nivel.

### Jerarquía de un mensaje KNX

En la API real del proyecto, normalmente construyes primero las capas **APDU** y **TPDU**, y después creas el servicio final **cEMI** o **EMI** correspondiente. Para un telegrama estándar `L_Data.req`, la clase final es `CEMI.DataLinkLayerCEMI["L_Data.req"]`.

#### 1. APDU (Application Protocol Data Unit)

Define el comando (**APCI**) y los datos del mensaje.

```typescript
import { APDU, APCI, APCIEnum } from "knx.ts";

const apci = new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit);
const apdu = new APDU(undefined, apci, Buffer.from([0x01]), true);
```

#### 2. TPDU (Transport Protocol Data Unit)

Envuelve la APDU y define el tipo de transporte.

```typescript
import { TPDU, TPCI, TPCIType } from "knx.ts";

const tpdu = new TPDU(new TPCI(TPCIType.T_DATA_GROUP_PDU), apdu, apdu.data);
```

#### 3. cEMI `L_Data.req`

En esta librería no se construye un `new CEMI()` genérico para este caso. Debes instanciar el servicio cEMI concreto y pasarle sus campos de control, direcciones y `TPDU`.

```typescript
import { AddressType, CEMI, ControlField, ExtendedControlField, Priority } from "knx.ts";

const controlField1 = new ControlField();
controlField1.frameType = true;
controlField1.priority = Priority.LOW;

const controlField2 = new ExtendedControlField();
controlField2.addressType = AddressType.GROUP;
controlField2.hopCount = 6;

const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](null, controlField1, controlField2, "1.1.1", "1/1/1", tpdu);
```

#### 4. Additional Information (opcional)

`AdditionalInformationField` no se rellena asignando `type` y `data` manualmente. Debes crear instancias de los tipos concretos definidos en `KNXAddInfoTypes` y añadirlas al campo.

```typescript
import { AdditionalInformationField, ManufacturerSpecificData } from "knx.ts";

const addInfo = new AdditionalInformationField();
const manufacturerInfo = new ManufacturerSpecificData();
manufacturerInfo.data = Buffer.from([0x00, 0x01]);
addInfo.add(manufacturerInfo);

cemi.additionalInfo = addInfo;
```

#### 5. EMI (External Message Interface)

`EMI` tampoco se usa como una instancia genérica con `new EMI()`. La clase actúa como contenedor de servicios y parser (`EMI.fromBuffer(...)`). En conexiones como `KNXUSBConnection`, la librería convierte automáticamente un `CEMIInstance` cEMI a EMI cuando el KNX USB solo soporta EMI y no CEMI.

> [!NOTE]
> El código del EMI es relativamente antiguo, pero no obsoleto; los argumentos de los constructores de clases de objetos EMI pueden ser redundantes o arbitrarios en comparación con los de CEMI (esto se refiere únicamente al estilo del código, no a su especificación).

### Ejemplo de ensamblaje y envío final

Una vez construida la estructura, puedes enviarla directamente como `CEMIInstance`, o serializarla con `toBuffer()` si realmente necesitas el buffer crudo.

```typescript
import { KNXTunneling } from "knx.ts";

const tunnel = new KNXTunneling({
  ip: "192.168.1.10",
  port: 3671,
});

await tunnel.connect();
await tunnel.send(cemi);

// Si necesitas el buffer serializado:
await tunnel.send(cemi.toBuffer());
```

## 🛠️ Desarrollo

Para compilar y verificar el proyecto:

```bash
# Compilar TypeScript hacia dist/
npm run build

# Ejecutar toda la suite de pruebas Jest
npm test

# Validar linting sobre src/
npx eslint src/
```

Scripts de estabilidad y pruebas manuales (según `package.json`):

```bash
# Scripts de estabilidad de conexión
npm run test:stability
npm run test:server-stability

# Scripts manuales (pruebas con hardware / ETS)
npm run manualTest:routing
npm run manualTest:tunneling
npm run manualTest:management
npm run manualTest:program
npm run manualTest:secureTcp
npm run manualTest:router
npm run manualTest:usb
npm run manualTest:routingUsb
npm run manualTest:tpuart
```

## 👤 Autor

- **Arnold Steven Beleño Zuletta (Wesxt)**

## ⚖️ Licencia

Este proyecto está bajo la Licencia MIT.
