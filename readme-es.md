# knx.ts

Una librería de alto rendimiento para **KNXnet/IP** e **Interfaces de Hardware** como **HID USB** y **TPUART** escrita en **TypeScript**.

Este proyecto se centra en la rigurosidad del protocolo, leer y enviar cualquier tipo de mensaje **EMI** o **CEMI**, Amplio soporte de DPTs (Data Point Types), la estabilidad de la conexión y la integración directa con el hardware, optimizado específicamente para proporcionar una experiencia fiable cuando se utiliza como Pasarela (Gateway) para ETS o como núcleo para controladores KNX personalizados.

## 🌟 Capacidades

- **Túnel UDP Robusto**: Implementa una cola estricta *Stop-and-Wait* y gestión de números de secuencia. Esto elimina los problemas comunes de "conexión interrumpida" en ETS o otras aplicaciones durante sesiones largas.
- **Enrutamiento KNXnet/IP (Routing)**: Soporta enrutamiento multicast (Solo en el servidor **KNXnet/IP**).
- **Descubrimiento en el servidor KNXnet/IP**: Soporta ``SEARCH_REQUEST``, ``SEARCH_REQUEST_EXTENDED``, ``DESCRIPTION_REQUEST``, ``CONNECT_REQUEST`` y ``CONNECTIONSTATE_REQUEST`` para que aplicaciones como ETS pueda descubrirlo sin necesidad de especificarselo.
- **Interfaces de Hardware Directas**: Soporte nativo para **interfaces USB KNX** (vía `node-hid`) y chips serie **TPUART** (vía `serialport`).
- **Puente de Aprendizaje (Router)**: Enrutamiento avanzado multi-interfaz con Prevención de Bucles, Seguimiento de Firmas y Aprendizaje de Direcciones Individuales (IA), permitiéndote puentear varias interfaces físicas y túneles simultáneamente.
- **Eventos Intuitivos Basados en Direcciones**: Escucha telegramas específicos usando direcciones de grupo como nombres de eventos (ej., `server.on("1/1/1", ...)`).
- **Cancelación de Eco**: Filtra automáticamente los mensajes de bucle invertido (loopback) para evitar bucles de procesamiento de telegramas.
- **Alto Rendimiento**: Optimizado para entornos Node.js con una sobrecarga mínima.

## 🚧 Estado: Experimental y en Desarrollo

Según el `TODO.md`, varias características se encuentran actualmente en estado **experimental** o bajo desarrollo:

- **Soporte TCP**: La implementación está presente, pero las pruebas están actualmente en fase experimental.
- **Parametrización de Dispositivos**: Se planea el soporte para el *Modo de Programación* (progMode) para permitir la configuración completa del dispositivo a través de ETS.
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

- **[Pino](https://getpino.io/)**: Utilizado como motor de registro (logging) central. Es altamente eficiente y la librería exporta un registrador único (singleton) para que tu aplicación pueda compartir la misma instancia sin sobrecarga.
- **[node-hid](https://github.com/node-hid/node-hid)**: Utilizado por `KNXUSBConnection` para interactuar de forma nativa con interfaces USB KNX. Ten en cuenta que los módulos nativos pueden requerir herramientas de compilación en ciertos sistemas operativos.
- **[serialport](https://serialport.io/)**: Utilizado por `TPUARTConnection` para comunicación directa por UART. Al igual que `node-hid`, este es un módulo nativo.

## 📚 Referencia de la API (Lo que se exporta)

La librería expone un conjunto rico de clases y utilidades que permiten tanto el uso de alto nivel como la manipulación del protocolo a bajo nivel:

### 1. Conexiones y Pasarelas

Estas clases forman el núcleo de tu interacción con la red. Todas ellas heredan de una base `KNXService` y emiten eventos comunes.

- `KNXnetIPServer`: Crea un servidor KNXnet/IP estándar (Gateway). Perfecto para proporcionar ranuras de túnel (slots) a ETS u otros clientes tunneling.
- `KNXTunneling`: Se conecta como cliente a una pasarela KNXnet/IP existente.
- `KNXUSBConnection`: Se conecta directamente a interfaces USB KNX locales (ABB, MDT, Weinzierl, Zennio, etc.).
- `TPUARTConnection`: Se conecta directamente a KNX a través de hardware serie TPUART.
- `Router`: Un potente Puente que intercomunica las distintas conexiones de hardware o clientes tunneling (**KNXUSBConnection**). Puedes adjuntar múltiples instancias de `KNXService` a él (ej., una conexión USB y 5 túneles), y enrutará automáticamente los telegramas entre ellos, gestionando el aprendizaje de Direcciones Individuales y la prevención de bucles.

### 2. Conversión de Datos (DPTs)

- `KnxDataDecode`: Utilidad estática para decodificar cargas útiles `Buffer` sin procesar en tipos estándar de JavaScript/TypeScript (ej., números, booleanos) dependiendo del Tipo de Punto de Datos (DPT) de KNX.
- `KnxDataEncoder`: Utilidad estática para codificar valores de JavaScript/TypeScript de nuevo en fragmentos de `Buffer` listos para ser enviados al bus KNX.

### 3. Tramas y Tipos Core de KNX

Para desarrolladores que construyen herramientas avanzadas de monitoreo o inyección, la librería exporta toda la estructura interna de las tramas:

- Clases `CEMI` / `EMI` para analizar y serializar tramas Common EMI y EMI antiguas.
- Clases `APDU`, `NPDU`, `TPDU` para la manipulación de las capas de Red, Transporte y Aplicación.
- `ControlField` para analizar y serializar los control field de los mensajes CEMI o EMI.
- `ExtendedControlField` para analizar y serializar los ``Extended Control Field`` o ``Control Field 2`` de los mensajes CEMI.
- `AddressType` Es un enumerable que ayuda a identificar el bit de Address Type (AT) del ExtendedControlField, asi puede saber que dirección de destino se trata, si de grupo o individual.
- `APCI` Para analizar y serializar los APCI que se alojan entre los datos de TPDU y APDU, debe tener cuidado ya que el APCI se maneja con 10 bits y escribe en los 2 bits menos significativos del Byte que donde el TPCI y los siguientes 2 bits son exclusivos del APCI y los 6 bits son del APCI o son datos.
- `APCIEnum` Es un enumerable que ayuda a escribir el APCI según la especificación, **Advertencia**: Esta enumeración asume todos comandos dentro son 10 bits o 2 bytes pero dentro de la mascara 0x3FF, los que son de longitud de 4 bits simplemente están en una mascara 0x3C0.
- `TPCI` Es para analizar y serializar los TPCI que están en la capa TPDU.
- `TPCIType` Es un enumerable que ayuda a escribir o indentificar los TPCI según la especificación.
- `DPTs` La librería exporta interfaces como `DPT5001` o `DPT1`, estas interfaces son usadas por KnxDataDecode para devolver objetos javascript y KnxDataEncoder para pasarlos como parametros para convertirlos en Buffer.
- `ServiceMessage` Es una interfaz que implementan todos los mensajes del CEMI y EMI, tambien todas las capas NPDU, TPDU y APCI, esto sirve para que contegan dos metodos utiles: `toBuffer` para devolver la instancia en un buffer y `describe` que otorga información sobre la instancia de una forma amigable de ver. **Nota**: En la mayoria de clases que exporta esta librería y no implementa esta interfaz como el APCI aún tienen el metodo `describe`.

## 🛠️ Inicio Rápido

### Crear un Servidor KNXnet/IP (Pasarela)

Perfecto para crear un puente entre tu red IP y el bus KNX.

```typescript
import { KNXnetIPServer, ServiceMessage, KnxDataDecode } from 'knx.ts';

const server = new KNXnetIPServer({
  localIp: '192.168.1.50',
  individualAddress: '1.1.0', // Tenga cuidado de hacer conflicto
  friendlyName: 'TypeScript KNX Gateway', // Este nombre se muestra en el ETS
  clientAddrs: '1.1.10:5' // Proporciona 5 ranuras de túnel comenzando desde 1.1.10
});

server.connect().then(() => {
  console.log('El servidor KNXnet/IP está en funcionamiento');
});

// Escucha específica para una Dirección de Grupo
server.on('1/1/1', (cemi: ServiceMessage) => {
  console.log('Nuevos datos en 1/1/1:', cemi.TPDU.apdu.data); // Datos crudos del APDU
  console.log('Datos decodificados:', KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Dato convertido en un valor de javascript
});
```

### Conexión USB Directa

```typescript
import { KNXUSBConnection } from 'knx.ts';

const usb = new KNXUSBConnection({
  // Omitir path/vendorId descubrirá automáticamente la primera interfaz USB KNX conocida
});

usb.connect().then(() => {
  console.log('Conectado directamente a la interfaz USB KNX');
});

usb.on('indication', (cemi) => {
  console.log('Origen del telegrama USB:', cemi.sourceAddress);
});
```

### Cliente de Túnel (Tunneling)

```typescript
import { KNXTunneling } from 'knx.ts';

const tunnel = new KNXTunneling({
  ip: '192.168.1.100', 
  port: 3671,
  localIp: '192.168.1.50'
});

tunnel.connect().then(() => {
  console.log('Conectado al bus KNX');
});
```

## 📝 Registros (Logging)

La librería utiliza un registrador único global basado en [Pino](https://getpino.io/). Puedes configurarlo al comienzo de tu aplicación usando `setupLogger`.

Esto es crucial porque no necesitas instanciar Pino tú mismo; el `knxLogger` interno gestiona su estado para evitar la sobrecarga de rendimiento de múltiples instancias.

```typescript
import { setupLogger, knxLogger } from 'knx.ts';

// Configurar el registrador global
setupLogger({
  level: 'debug', // ej., 'info', 'warn', 'error', 'debug'
  logToFile: true,
  logDir: './logs',
});

// También puedes usar el registrador global en tu propia aplicación
knxLogger.info("Aplicación iniciada");
```

Todos los componentes internos (`KNXnetIPServer`, `KNXTunneling`, `Router`, etc.) utilizan automáticamente este registrador compartido.

## 📡 Eventos y Callbacks

La librería está orientada a eventos. Dependiendo de la clase utilizada, se emiten diferentes eventos para proporcionar un control y monitoreo detallados.

### Eventos Comunes

Todas las clases de conexión (`KNXnetIPServer`, `KNXTunneling`, `KNXUSBConnection`, `TPUARTConnection`) heredan de `KNXService` y emiten los siguientes eventos estándar:

| Evento | Descripción | Argumentos del Callback |
|--------|-------------|-------------------------|
| `connected` | Conexión establecida y hardware/socket listo. | `void` (Server/USB/TPUART) / `{ channelId }` (Tunnel) |
| `disconnected` | Conexión perdida o cerrada explícitamente. | `void` |
| `error` | Ocurrió un error fatal durante la operación. | `err: Error` |
| `indication` | Cualquier telegrama KNX estándar entrante (cEMI / L_Data.ind). | `cemi: ServiceMessage` |
| `raw_indication`| El Buffer sin procesar antes del análisis (EMI/cEMI/carga útil). | `data: Buffer` |

### Eventos Específicos de Clase

Dependiendo del tipo de conexión, algunas clases emiten eventos específicos adicionales:

#### **KNXnetIPServer**

- `queue_overflow`: Se dispara cuando la cola interna de Tunnelling para un cliente conectado se desborda.
- `<DirecciónDeGrupo>` (ej., `"1/1/1"`): Escucha direcciones de grupo específicas directamente (ej., `server.on("1/1/1", (cemi) => {...})`).

#### **TPUARTConnection**

- `busmonitor`: Emitido en modo Busmonitor con tramas cEMI sin procesar.
- `bus_ack`: Emitido cuando el bus confirma una transmisión (Ack, Nack, Busy).
- `warning`: Emitido para advertencias de hardware no fatales (ej., colisión de esclavo detectada, error de transmisión).

#### **KNXUSBConnection**

- `indication_emi`: Emitido cuando se recibe un mensaje con formato EMI1/EMI2 antiguo de interfaces USB heredadas.

#### **KNXTunneling**

- `feature_info`: Emitido al consultar las características soportadas por un servidor KNXnet/IP.
- `raw_message`: Emitido con la carga útil IP sin procesar (incluyendo las cabeceras KNXnet/IP completas, no solo cEMI).

#### **Router (Puente de Aprendizaje)**

Debido a que el `Router` enlaza múltiples interfaces, emite eventos de enrutamiento específicos del enlace en lugar de indicaciones estándar:

- `indication_link`: Emitido cuando un paquete se enruta a través del puente. Argumento: `{ src: string, msg: ServiceMessage }` donde `src` es el nombre de la clase de la conexión de origen.
- `error`: Emitido cuando falla un enlace subyacente. Argumento: `{ link: KNXService, error: Error }`.

### Entendiendo el Objeto Telegrama

El objeto `cemi` o `emi` (que implementa `ServiceMessage`) contiene toda la información sobre el telegrama KNX. Aquí están las propiedades más relevantes:

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `sourceAddress` | `string` | Dirección física del remitente (ej., `"1.1.5"`). |
| `destinationAddress` | `string` | Dirección de grupo (ej., `"1/1/1"`) o dirección física. |
| `TPDU.apdu.data` | `Buffer` | Los datos de la carga útil sin procesar. |
| `TPDU.apdu.apci.command` | `string` | Tipo de comando (`A_GroupValue_Write`, `A_GroupValue_Read`, etc.). |

#### Manejo de Cargas Útiles de Datos

KNX maneja los datos de dos maneras dependiendo del tamaño:

- **Datos Cortos (<= 6 bits)**: Para DPT1 (Interruptor), DPT3 (Control), etc. El `cemi.TPDU.apdu.data[0]` contiene el valor.
- **Datos Extendidos (> 6 bits)**: Para DPT5 (Escalado), DPT9 (Flotante), etc. El Buffer `cemi.TPDU.apdu.data` contiene la carga útil completa (ej., 2 bytes para DPT9).

## 🔢 Codificación y Decodificación de Datos

La librería proporciona utilidades estáticas para manejar la conversión de Tipos de Puntos de Datos (DPT) de KNX entre Buffers sin procesar y objetos de TypeScript de alto nivel.

### Decodificación de Datos Entrantes

Usa `KnxDataDecode` para transformar los datos cEMI sin procesar en valores legibles, hay varios metodos con el prefijo `asDpt` que son especificos, el metodo `decodeThis` es util y practico si no quieres lidiar con esos:

```typescript
import { KnxDataDecode } from 'knx.ts';

server.on('1/1/1', (cemi) => {
  // Decodificar como DPT 1 (Booleano)
  const value = KnxDataDecode.decodeThis(1, cemi.TPDU.apdu.data);
  console.log('Valor decodificado:', value); // true o false

  // Decodificar solo como DPT 1 (Booleano)
  const value1 = KnxDataDecode.asDpt1(cemi.TPDU.apdu.data);

  // Decodificar como DPT 9 (Flotante de 2 bytes, ej., Temperatura)
  const temp = KnxDataDecode.decodeThis(9, cemi.TPDU.apdu.data);
  console.log('Temperatura:', temp, '°C');

  // El primer parametro acepta strings con la numeración estandar del DPT
  const temp1 = KnxDataDecode.decodeThis("9", cemi.TPDU.apdu.data)
  const porcentage = KnxDataDecode.decodeThis("5.001", cemi.TPDU.apdu.data)
});
```

### Codificación de Datos para el Envío

Usa `KnxDataEncoder` con el método `encodeThis` para preparar buffers para telegramas KNX; el segundo parámetro es siempre un objeto, hay varios metodos con el prefijo `encodeDpt` que son especificos, el metodo `encodeThis` es util y practico si no quieres lidiar con esos:

```typescript
import { KnxDataEncoder } from 'knx.ts';

// Codificar un Booleano (DPT 1)
const buf1 = KnxDataEncoder.encodeThis(1, { value: true });

// Codificar un Porcentaje (DPT 5.001)
const bufOnly5 = KnxDataEncoder.encodeDpt5({ valueDpt5001: 50 });
const buf5 = KnxDataEncoder.encodeThis(5001, { valueDpt5001: 50 });
const buf5001 = KnxDataEncoder.encodeThis("5.001", { valueDpt5001: 50 });

// Codificar una Temperatura (DPT 9.001)
const buf9 = KnxDataEncoder.encodeThis(9, { valueDpt9: 22.5 });
```

### Seguridad de Tipos e IntelliSense

Tanto `KnxDataDecode.decodeThis()` como `KnxDataEncoder.encodeThis()` están estrictamente tipados. Esto significa:

- **Soporte de IntelliSense**: Tu IDE sugerirá automáticamente los DPTs soportados mientras escribes el primer parámetro.
- **Validación Automática de Datos**: El segundo parámetro (el objeto de datos) ajusta automáticamente sus propiedades requeridas según el DPT seleccionado en el primer parámetro.
- **DPTs Soportados**: Puedes consultar programáticamente la lista de DPTs soportados (devuelven un array de numeros):

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
import { APDU, APCI, APCIEnum } from 'knx.ts';

const apci = new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit);
const apdu = new APDU(undefined, apci, Buffer.from([0x01]), true);
```

#### 2. TPDU (Transport Protocol Data Unit)

Envuelve la APDU y define el tipo de transporte.

```typescript
import { TPDU, TPCI, TPCIType } from 'knx.ts';

const tpdu = new TPDU(
  new TPCI(TPCIType.T_DATA_GROUP_PDU),
  apdu,
  apdu.data,
);
```

#### 3. cEMI `L_Data.req`

En esta librería no se construye un `new CEMI()` genérico para este caso. Debes instanciar el servicio cEMI concreto y pasarle sus campos de control, direcciones y `TPDU`.

```typescript
import {
  AddressType,
  CEMI,
  ControlField,
  ExtendedControlField,
  Priority,
} from 'knx.ts';

const controlField1 = new ControlField();
controlField1.frameType = true;
controlField1.priority = Priority.LOW;

const controlField2 = new ExtendedControlField();
controlField2.addressType = AddressType.GROUP;
controlField2.hopCount = 6;

const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
  null,
  controlField1,
  controlField2,
  "1.1.1",
  "1/1/1",
  tpdu,
);
```

#### 4. Additional Information (opcional)

`AdditionalInformationField` no se rellena asignando `type` y `data` manualmente. Debes crear instancias de los tipos concretos definidos en `KNXAddInfoTypes` y añadirlas al campo.

```typescript
import {
  AdditionalInformationField,
  ManufacturerSpecificData,
} from 'knx.ts';

const addInfo = new AdditionalInformationField();
const manufacturerInfo = new ManufacturerSpecificData();
manufacturerInfo.data = Buffer.from([0x00, 0x01]);
addInfo.add(manufacturerInfo);

cemi.additionalInfo = addInfo;
```

#### 5. EMI (External Message Interface)

`EMI` tampoco se usa como una instancia genérica con `new EMI()`. La clase actúa como contenedor de servicios y parser (`EMI.fromBuffer(...)`). En conexiones como `KNXUSBConnection`, la librería convierte automáticamente un `ServiceMessage` cEMI a EMI cuando hace falta.

### Ejemplo de ensamblaje y envío final

Una vez construida la estructura, puedes enviarla directamente como `ServiceMessage`, o serializarla con `toBuffer()` si realmente necesitas el buffer crudo.

```typescript
import { KNXTunneling } from 'knx.ts';

const tunnel = new KNXTunneling({
  ip: '192.168.1.10',
  port: 3671,
});

await tunnel.connect();
await tunnel.send(cemi);

// Si necesitas el buffer serializado:
await tunnel.send(cemi.toBuffer());
```

## 🛠️ Desarrollo

Para compilar el proyecto:

```bash
npm run build
```

Para ejecutar las pruebas de enrutamiento:

```bash
npm run test:routing
```

```bash
npm run test:connection
```

## 👤 Autor

- **Arnold Steven Beleño Zuletta (Wesxt)**

## ⚖️ Licencia

Este proyecto está bajo la Licencia MIT.
