# TODO

Pendientes.

## Pruebas

Pruebas pendientes por hacer.

### Conexión TCP

La conexión TCP del KNXnetIPServer, está en fase experimental o falta su implementación, se prevee que esto debe implementarse si o si en la version 2.0 del protocolo KNXnet/IP junto con KNX Segure.

La conexión TCP del KNXTunneling, está en fase experimental o falta su implementación, se prevee que esto debe implementarse si o si en la version 2.0 del protocolo KNXnet/IP junto con KNX Segure.

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
