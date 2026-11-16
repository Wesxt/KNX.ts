# TODO

Pendientes.

## Pruebas

Pruebas pendientes por hacer.

### Conexión TCP y KNX IP Secure

- **Cliente `KNXTunneling` (TCP plano y KNX IP Secure Unicast) y `KNXnetIPServer` (Secure Routing Multicast)**: Implementados conforme al estándar KNX (`03_08_02`, `03_08_04`, `03_08_09`) y validados con los vectores oficiales del Anexo A, archivos `.knxkeys` de ETS y pasarelas simuladas. **Queda pendiente probar con dispositivos físicos reales.**
- **Servidor TCP / Sesiones Seguras entrantes en `KNXnetIPServer`**: Falta implementar el listener TCP y el servidor de sesiones seguras para clientes entrantes en `KNXnetIPServer`.

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

## Caracteristicas poco fiables de mantener

Estas son caracteristicas que son dificiles de mantener o poco fiables en la implementación del protocolo o poco utiles.

- Modo busmonitor en KNXnetIPServer, hay problemas de conversión de mensajes 'L_data.xxx' a mensajes busmonitor.
