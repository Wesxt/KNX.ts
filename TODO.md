# TODO

Pendientes.

## Pruebas

Pruebas pendientes por hacer.

### Conexión TCP, Tunnelling v2 y KNX IP Secure

- **Cliente `KNXTunneling` (UDP, TCP plano, Tunnelling v2 Features y KNX IP Secure) y `KNXnetIPServer` (TCP Unicast, Secure Sessions, Core v2 Extended Search, Tunnelling v2 Features y Secure Routing Multicast)**: Implementados conforme al estándar KNX (`03_08_02`, `03_08_04`, `03_08_09`) y validados con pruebas automatizadas, vectores oficiales del Anexo A, archivos `.knxkeys` de ETS, sesiones reales con ETS5 (descubrimiento, túnel TCP/Secure, Group Monitor y Busmonitor) y **hardware físico real (LogicMachine en Secure Routing Multicast con `SECURE_WRAPPER` + sincronización `TIMER_NOTIFY` + Zennio MAXinBOX 66 v3)**.

### Gestión de Red y Dispositivos (`KNXManagement` y `KNXManagementSession`)

- Implementado el stack completo de procedimientos de red (`NM_*`) y de dispositivo (`DM_*`, `03_05_02`, `03_03_07`, `03_08_03`) sobre `TransportConnection` (`03_03_04`):
  - Lectura, programación y reset de Dirección Individual (por botón y por número de serie) y Dirección de Dominio.
  - Sesiones persistentes (`openSession` / `withSession`), autorización (`A_Authorize_Request`) y escritura de claves (`A_Key_Write`).
  - Lectura, escritura, descripción y escaneo de propiedades y funciones de objetos de interfaz (estándar y extendidas).
  - Lectura, escritura y verificación de memoria estándar (16 bits), de usuario (20 bits), extendida (24 bits) y por bits (`A_MemoryBit_Write`).
  - Control de máquinas de estados de carga (`PID_LOAD_STATE_CONTROL`) y ejecución (`PID_RUN_STATE_CONTROL`), enlaces de objetos de grupo (`A_Link_Read` / `A_Link_Write`), reinicio básico y *Master Reset* confirmado (`A_Restart`), y gestión local cEMI (`M_PropRead` / `M_PropWrite` / `M_FuncPropCommand` / `M_Reset`).
- Validado contra capturas reales de ETS (`test_xml/`), dispositivos simulados y **hardware físico real (Zennio MAXinBOX 66 v3 con gestión segura Data Secure + `ToolKey` sobre `TransportConnection`)**. Queda pendiente ampliar pruebas físicas para procedimientos de memoria/descarga completa.

### Enrutado de conexiones

Tener varias conexiones de IP Tunneling con TPUART y/o USB con la gestión de conexiones de la clase `Router`

- Ver si los mensajes se enrutan correctamente al host KNXnetIPServer para la ip de multidifusión

### TPUART

Probar con una placa pasarela TPUART

- Si realiza la conexión correctamente
- Envio de mensajes y recibirlos
- Enrutamiento de mensajes
- Modo Busmonitor

### Varias instancias

- Verificar si varias instancias de host de KNXnetIPserver pueden interactuar entre si con distintos puertos en la misma IP o en distintas (Superficialmente probado, parece que si funciona)

- ¿Que pasa si se conecta un cliente IP Tunneling con la clase KNXTunneling? al host KNXnetIpServer (Superficialmente probado, parece que si funciona)

### Implementaciones

Implementaciones pendientes.

- Implementar escucha de eventos basado en las direcciones de fuente
- Deserialización completa de EMI apoyándose en las capas NPDU, TPDU y APDU

## Características recientes / resueltas

- **Programación de Aplicaciones desde `.knxprod` (System B `MV-07B0`), Comisionamiento Data Secure Fase 2 (Object 17), Exportador `.knxkeys` y API Web (`DeviceConfigSession`, `KnxKeyring`)**: Implementado pipeline completo sin dependencias externas (`ZipReader`, `KnxProdParser` streaming con traducciones multi-idioma, `DynamicEvaluator` con `<choose>`/`<when>`/`<Assign>`/`<ModuleDef>`/`<Repeat>`/`<ParameterCalculation>`, `SystemBCompiler` para Objetos 1–4 y Object 17 Data Secure, `LoadProcedureEngine`, `KNXDeviceProgrammer` con pre-flight de seguridad HW y `commissionSecureDevice` `FDSK -> ToolKey`, `DeviceConfigSession` 100% JSON serializable con `ensureSecurityKeys` y `exportToKeyring`, y constructor/exportador `.knxkeys` en `KnxKeyring` con AES-128-CBC + PBKDF2 + firma canónica SHA-256 en XML/ZIP compatible con ETS 5/6 y Home Assistant). **Validado extremo a extremo en hardware físico real contra Zennio MAXinBOX 66 v3 (`1.1.1`)**: descarga completa cifrada de 124.409 bytes (727 tramas) de Objetos 1–4 + Security Interface Object Type 17 (12 claves de grupo, 1536 flags GO, tabla de IAs) + `A_Restart`, con control bidireccional cifrado A+C verificado en salidas A1/A2 (`1/0/1..2` ↔ `1/1/1..2`). Documentado en [docs/PROGRAMMING_GUIDE_ES.md](./docs/PROGRAMMING_GUIDE_ES.md) y [docs/PROGRAMMING_GUIDE.md](./docs/PROGRAMMING_GUIDE.md).
- **KNX Data Secure (`03_03_07` §5, `03_05_01` §6.3, `03_05_02` §4)**: Implementado soporte completo para `S-A_Data` (`APCISec = 0x03F1`, modos *Auth+Conf* y *Auth-only*, cambio automático a *Extended Frame* cuando APDU > 15 bytes), `S-A_Sync` (`DM_SecureSync_RCl` y `DM_SecureSync_SBC`), anti-replay de 48 bits con persistencia en JSON, lectura/normalización de `.knxkeys` ETS5/ETS6 y sesiones de gestión segura (`KNXManagement` + Security Interface Object Tipo 17). **Validado con los 4 vectores oficiales del Anexo C (`C.1.1`–`C.1.4`) y en hardware físico real contra un Zennio MAXinBOX 66 v3** (sincronización `S-A_Sync`, lectura del Security Interface Object con `ToolKey`, y envío/recepción bidireccional de grupos Data Secure).
- **Modo Busmonitor en `KNXnetIPServer`**: Corregida la conversión de `L_Data.ind`/`L_Data.con`/`L_Data.req` (estándar `FT=1` con `LG = dataLen`, extendido `FT=0`) y `L_Raw.ind`/`L_Raw.req` hacia `L_Busmon.ind` (`0x2b`) con su `FCS` y bloque `AdditionalInformationField` (`BusmonitorStatusInfo` `0x03`, `TimestampRelative` `0x04`), validado con ETS5 y pruebas unitarias.
