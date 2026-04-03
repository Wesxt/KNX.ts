# TODO

Pendientes.

## Pruebas

Pruebas pendientes por hacer.

### Conexión TCP

Aún no se ha probado la conexión TCP del host KNXnetIPServer, está en fase experimental.

### Enrutado de conexiones

Tener varias conexiones de IP Tunneling con TPUART y/o USB con la gestión de conexiones de la clase `Router`

- Ver si los mensajes se enrutan correctamente al host KNXnetIPServer para la ip de multidifusión

### TPUART

Probar con una placa pasarela al chip SIEMENS TPUART

- Si realiza la conexión correctamente
- Envio de mensajes y recibirlos
- Enrutamiento de mensajes
- Modo Busmonitor

### Varias instancias

- Verificar si varias instancias de host de KNXnetIPserver pueden interactuar entre si con distintos puertos en la misma IP o en distintas

- ¿Que pasa si se conecta un cliente IP Tunneling con la clase KNXTunneling? al host KNXnetIpServer

### Implementaciones

Implementaciones pendientes.

- Manejar dispositivos en progMode, es vital para que sea posible parametrizar con ETS

- Implementar escucha de eventos basado en las direcciones de fuente

- Usar las capas implementas de NPDU, TPDU y APDU en las clases de EMI

#### Filtros

- Implementar un filtro para direcciones que no se quieren escuchar

- Implementar un filtro para direcciones que no se quieren enrutar
