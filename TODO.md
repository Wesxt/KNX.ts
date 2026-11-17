# TODO

Pendientes.

## Pruebas

Pruebas pendientes por hacer.

### Conexión TCP, Tunnelling v2 y KNX IP Secure

- **Cliente `KNXTunneling` (UDP, TCP plano, Tunnelling v2 Features y KNX IP Secure) y `KNXnetIPServer` (TCP Unicast, Secure Sessions, Core v2 Extended Search, Tunnelling v2 Features y Secure Routing Multicast)**: Implementados conforme al estándar KNX (`03_08_02`, `03_08_04`, `03_08_09`) y validados con pruebas automatizadas, vectores oficiales del Anexo A, archivos `.knxkeys` de ETS y pruebas reales con ETS5 (descubrimiento, túnel TCP/Secure, Group Monitor y Busmonitor).
- **Pendiente de validación extendida en hardware físico externo**: Falta validar Secure Routing Multicast y `KNXManagement` directamente frente a routers/dispositivos físicos KNX IP Secure independientes.

### Gestión de Red y Dispositivos (`KNXManagement` y `KNXManagementSession`)

- Implementado el stack completo de procedimientos de red (`NM_*`) y de dispositivo (`DM_*`, `03_05_02`, `03_03_07`, `03_08_03`) sobre `TransportConnection` (`03_03_04`):
  - Lectura, programación y reset de Dirección Individual (por botón y por número de serie) y Dirección de Dominio.
  - Sesiones persistentes (`openSession` / `withSession`), autorización (`A_Authorize_Request`) y escritura de claves (`A_Key_Write`).
  - Lectura, escritura, descripción y escaneo de propiedades y funciones de objetos de interfaz (estándar y extendidas).
  - Lectura, escritura y verificación de memoria estándar (16 bits), de usuario (20 bits), extendida (24 bits) y por bits (`A_MemoryBit_Write`).
  - Control de máquinas de estados de carga (`PID_LOAD_STATE_CONTROL`) y ejecución (`PID_RUN_STATE_CONTROL`), enlaces de objetos de grupo (`A_Link_Read` / `A_Link_Write`), reinicio básico y *Master Reset* confirmado (`A_Restart`), y gestión local cEMI (`M_PropRead` / `M_PropWrite` / `M_FuncPropCommand` / `M_Reset`).
- Validado contra capturas reales de ETS (`test_xml/`) y dispositivos simulados. **Queda pendiente probar directamente con dispositivos KNX físicos reales.**

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

- **Modo Busmonitor en `KNXnetIPServer`**: Corregida la conversión de `L_Data.ind`/`L_Data.con`/`L_Data.req` (estándar `FT=1` con `LG = dataLen`, extendido `FT=0`) y `L_Raw.ind`/`L_Raw.req` hacia `L_Busmon.ind` (`0x2b`) con su `FCS` y bloque `AdditionalInformationField` (`BusmonitorStatusInfo` `0x03`, `TimestampRelative` `0x04`), validado con ETS5 y pruebas unitarias.
