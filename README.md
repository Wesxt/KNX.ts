# knx.ts

Spanish version: see [readme-es.md](./readme-es.md).

A high-performance **KNXnet/IP** and **Hardware Interface** library such as **HID USB** and **TPUART**, written in **TypeScript**.

This project focuses on protocol strictness, reading and sending any kind of **EMI** or **CEMI** message, broad DPT (Data Point Type) support, connection stability, and direct hardware integration, specifically optimized to provide a reliable experience when used as a Gateway for ETS or as a core for custom KNX controllers.

## 🌟 Capabilities

- **Robust UDP Tunneling**: Implements a strict *Stop-and-Wait* queue and sequence number management. This eliminates common "connection interrupted" issues in ETS or other applications during long sessions.
- **KNXnet/IP Routing**: Supports multicast routing (only in the **KNXnet/IP** server).
- **Discovery in the KNXnet/IP server**: Supports `SEARCH_REQUEST`, `SEARCH_REQUEST_EXTENDED`, `DESCRIPTION_REQUEST`, `CONNECT_REQUEST`, and `CONNECTIONSTATE_REQUEST` so applications such as ETS can discover it without manual configuration.
- **Direct Hardware Interfaces**: Native support for **KNX USB interfaces** (via `node-hid`) and **TPUART** serial chips (via `serialport`).
- **Learning Bridge (Router)**: Advanced multi-interface routing with Loop Prevention, Signature Tracking, and Individual Address (IA) learning, allowing you to bridge multiple physical interfaces and tunnels simultaneously.
- **Intuitive Address-Based Events**: Listen to specific telegrams using group addresses as event names (e.g., `server.on("1/1/1", ...)`).
- **Echo Cancellation**: Automatically filters loopback messages to prevent telegram processing loops.
- **High Performance**: Optimized for Node.js environments with minimal overhead.

## 🚧 Status: Experimental and In Development

According to `TODO.md`, several features are currently **experimental** or under development:

- **TCP Support**: The implementation is present, but testing is currently in an experimental phase.
- **Device Parameterization**: Support for *Programming Mode* (`progMode`) is planned to allow full device configuration through ETS.
- **Source Filtering**: Filtering based on source addresses and selective routing is on the roadmap.
- **Use of NPDU, TPDU, and APDU layers**: EMI still needs to use them for correct deserialization.

## 📦 Installation via git

```bash
git clone https://github.com/Wesxt/KNX.ts.git
cd KNX.ts
npm install
```

## 📦 Installation via npm

```bash
npm install knx.ts
```

## 🧩 External Dependencies

This library depends on a few key modules, both external and native, to enable its full functionality:

- **[Pino](https://getpino.io/)**: Used as the central logging engine. It is highly efficient, and the library exports a singleton logger so your application can share the same instance without overhead.
- **[node-hid](https://github.com/node-hid/node-hid)**: Used by `KNXUSBConnection` to interact natively with KNX USB interfaces. Keep in mind that native modules may require build tools on some operating systems.
- **[serialport](https://serialport.io/)**: Used by `TPUARTConnection` for direct UART communication. Like `node-hid`, this is a native module.

## 📚 API Reference (What is exported)

The library exposes a rich set of classes and utilities that allow both high-level usage and low-level protocol manipulation:

### 1. Connections and Gateways

These classes form the core of your interaction with the network. All of them inherit from a `KNXService` base and emit common events.

- `KNXnetIPServer`: Creates a standard KNXnet/IP server (Gateway). Perfect for providing tunneling slots to ETS or other tunneling clients.
- `KNXTunneling`: Connects as a client to an existing KNXnet/IP gateway.
- `KNXUSBConnection`: Connects directly to local KNX USB interfaces (ABB, MDT, Weinzierl, Zennio, etc.).
- `TPUARTConnection`: Connects directly to KNX through TPUART serial hardware.
- `Router`: A powerful bridge that interconnects different hardware connections or tunneling clients (**KNXUSBConnection**). You can attach multiple `KNXService` instances to it (e.g., one USB connection and 5 tunnels), and it will automatically route telegrams between them, handling Individual Address learning and loop prevention.

### 2. Data Conversion (DPTs)

- `KnxDataDecode`: Static utility to decode raw `Buffer` payloads into standard JavaScript/TypeScript types (e.g., numbers, booleans) depending on the KNX Data Point Type (DPT).
- `KnxDataEncoder`: Static utility to encode JavaScript/TypeScript values back into `Buffer` chunks ready to be sent onto the KNX bus.

### 3. Core KNX Frames and Types

For developers building advanced monitoring or injection tools, the library exports the entire internal frame structure:

- `CEMI` / `EMI` classes for parsing and serializing Common EMI and legacy EMI frames.
- `APDU`, `NPDU`, `TPDU` classes for manipulating the Network, Transport, and Application layers.
- `ControlField` to parse and serialize the control field of CEMI or EMI messages.
- `ExtendedControlField` to parse and serialize the `Extended Control Field` or `Control Field 2` of CEMI messages.
- `AddressType` is an enum that helps identify the Address Type (AT) bit in `ExtendedControlField`, so you can know whether the destination address is group or individual.
- `APCI` parses and serializes APCI values hosted between TPDU and APDU data. You must be careful because APCI uses 10 bits and writes into the 2 least significant bits of the byte shared with TPCI, while the following bits may belong to APCI or be data depending on the frame.
- `APCIEnum` is an enum that helps write APCI values according to the specification. **Warning**: this enum assumes all commands inside it are 10-bit or 2-byte values within the `0x3FF` mask; those with 4-bit length are simply represented inside a `0x3C0` mask.
- `TPCI` parses and serializes TPCI values in the TPDU layer.
- `TPCIType` is an enum that helps write or identify TPCI values according to the specification.
- `DPTs`: the library exports interfaces such as `DPT5001` or `DPT1`. These interfaces are used by `KnxDataDecode` to return JavaScript objects and by `KnxDataEncoder` as parameter types to convert them into `Buffer`s.
- `ServiceMessage` is an interface implemented by all CEMI and EMI messages, and also by NPDU, TPDU, and APCI layers. This is useful because they all expose two helpful methods: `toBuffer` to serialize the instance into a buffer and `describe` to provide a human-readable view of the instance. **Note**: most exported classes in this library that do not implement this interface, such as `APCI`, still provide a `describe` method.

## 🛠️ Quick Start

### Create a KNXnet/IP Server (Gateway)

Perfect for creating a bridge between your IP network and the KNX bus.

```typescript
import { KNXnetIPServer, ServiceMessage, KnxDataDecode } from 'knx.ts';

const server = new KNXnetIPServer({
  localIp: '192.168.1.50',
  individualAddress: '1.1.0', // Be careful not to create conflicts
  friendlyName: 'TypeScript KNX Gateway', // This name is shown in ETS
  clientAddrs: '1.1.10:5' // Provides 5 tunneling slots starting from 1.1.10
});

server.connect().then(() => {
  console.log('The KNXnet/IP server is running');
});

// Specific listener for a Group Address
server.on('1/1/1', (cemi: ServiceMessage) => {
  console.log('New data on 1/1/1:', cemi.TPDU.apdu.data); // Raw APDU data
  console.log('Decoded data:', KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Converted JavaScript value
});
```

### Direct USB Connection

```typescript
import { KNXUSBConnection } from 'knx.ts';

const usb = new KNXUSBConnection({
  // Omitting path/vendorId will automatically discover the first known KNX USB interface
});

usb.connect().then(() => {
  console.log('Connected directly to the KNX USB interface');
});

usb.on('indication', (cemi) => {
  console.log('USB telegram source:', cemi.sourceAddress);
});
```

### Tunneling Client

```typescript
import { KNXTunneling } from 'knx.ts';

const tunnel = new KNXTunneling({
  ip: '192.168.1.100',
  port: 3671,
  localIp: '192.168.1.50'
});

tunnel.connect().then(() => {
  console.log('Connected to the KNX bus');
});
```

## 📝 Logging

The library uses a single global logger based on [Pino](https://getpino.io/). You can configure it at the beginning of your application using `setupLogger`.

This is important because you do not need to instantiate Pino yourself; the internal `knxLogger` manages its state to avoid the performance overhead of multiple instances.

```typescript
import { setupLogger, knxLogger } from 'knx.ts';

// Configure the global logger
setupLogger({
  level: 'debug', // e.g. 'info', 'warn', 'error', 'debug'
  logToFile: true,
  logDir: './logs',
});

// You can also use the global logger in your own application
knxLogger.info("Application started");
```

All internal components (`KNXnetIPServer`, `KNXTunneling`, `Router`, etc.) automatically use this shared logger.

## 📡 Events and Callbacks

The library is event-driven. Depending on the class you use, different events are emitted to provide detailed control and monitoring.

### Common Events

All connection classes (`KNXnetIPServer`, `KNXTunneling`, `KNXUSBConnection`, `TPUARTConnection`) inherit from `KNXService` and emit the following standard events:

| Event | Description | Callback Arguments |
|--------|-------------|-------------------------|
| `connected` | Connection established and hardware/socket ready. | `void` (Server/USB/TPUART) / `{ channelId }` (Tunnel) |
| `disconnected` | Connection lost or explicitly closed. | `void` |
| `error` | A fatal error occurred during operation. | `err: Error` |
| `indication` | Any incoming standard KNX telegram (cEMI / L_Data.ind). | `cemi: ServiceMessage` |
| `raw_indication`| The raw `Buffer` before parsing (EMI/cEMI/payload). | `data: Buffer` |

### Class-Specific Events

Depending on the connection type, some classes emit additional specific events:

#### **KNXnetIPServer**

- `queue_overflow`: Fired when the internal tunneling queue for a connected client overflows.
- `<GroupAddress>` (e.g., `"1/1/1"`): Listen directly to specific group addresses (e.g., `server.on("1/1/1", (cemi) => {...})`).

#### **TPUARTConnection**

- `busmonitor`: Emitted in Busmonitor mode with raw cEMI frames.
- `bus_ack`: Emitted when the bus confirms a transmission (Ack, Nack, Busy).
- `warning`: Emitted for non-fatal hardware warnings (e.g., slave collision detected, transmission error).

#### **KNXUSBConnection**

- `indication_emi`: Emitted when an older EMI1/EMI2-formatted message is received from legacy USB interfaces.

#### **KNXTunneling**

- `feature_info`: Emitted when querying the features supported by a KNXnet/IP server.
- `raw_message`: Emitted with the raw IP payload (including full KNXnet/IP headers, not only cEMI).

#### **Router (Learning Bridge)**

Because `Router` links multiple interfaces, it emits link-specific routing events instead of standard indications:

- `indication_link`: Emitted when a packet is routed through the bridge. Argument: `{ src: string, msg: ServiceMessage }`, where `src` is the class name of the source connection.
- `error`: Emitted when an underlying link fails. Argument: `{ link: KNXService, error: Error }`.

### Understanding the Telegram Object

The `cemi` or `emi` object (implementing `ServiceMessage`) contains all the information about the KNX telegram. Here are the most relevant properties:

| Property | Type | Description |
|-----------|------|-------------|
| `sourceAddress` | `string` | Physical address of the sender (e.g., `"1.1.5"`). |
| `destinationAddress` | `string` | Group address (e.g., `"1/1/1"`) or physical address. |
| `TPDU.apdu.data` | `Buffer` | The raw payload data. |
| `TPDU.apdu.apci.command` | `string` | Command type (`A_GroupValue_Write`, `A_GroupValue_Read`, etc.). |

#### Handling Data Payloads

KNX handles data in two ways depending on size:

- **Short Data (<= 6 bits)**: For DPT1 (Switch), DPT3 (Control), etc. `cemi.TPDU.apdu.data[0]` contains the value.
- **Extended Data (> 6 bits)**: For DPT5 (Scaling), DPT9 (Float), etc. The `cemi.TPDU.apdu.data` buffer contains the full payload (e.g., 2 bytes for DPT9).

## 🔢 Data Encoding and Decoding

The library provides static utilities to handle conversion of KNX Data Point Types (DPT) between raw buffers and high-level TypeScript objects.

### Decoding Incoming Data

Use `KnxDataDecode` to transform raw cEMI data into readable values. There are several methods with the `asDpt` prefix for specific cases; `decodeThis` is convenient if you do not want to deal with those directly:

```typescript
import { KnxDataDecode } from 'knx.ts';

server.on('1/1/1', (cemi) => {
  // Decode as DPT 1 (Boolean)
  const value = KnxDataDecode.decodeThis(1, cemi.TPDU.apdu.data);
  console.log('Decoded value:', value); // true or false

  // Decode only as DPT 1 (Boolean)
  const value1 = KnxDataDecode.asDpt1(cemi.TPDU.apdu.data);

  // Decode as DPT 9 (2-byte float, e.g. Temperature)
  const temp = KnxDataDecode.decodeThis(9, cemi.TPDU.apdu.data);
  console.log('Temperature:', temp, '°C');

  // The first parameter also accepts strings with the standard DPT numbering
  const temp1 = KnxDataDecode.decodeThis("9", cemi.TPDU.apdu.data)
  const percentage = KnxDataDecode.decodeThis("5.001", cemi.TPDU.apdu.data)
});
```

### Encoding Data for Sending

Use `KnxDataEncoder` with the `encodeThis` method to prepare buffers for KNX telegrams; the second parameter is always an object. There are several `encodeDpt`-prefixed methods for specific cases, but `encodeThis` is convenient if you do not want to deal with those directly:

```typescript
import { KnxDataEncoder } from 'knx.ts';

// Encode a Boolean (DPT 1)
const buf1 = KnxDataEncoder.encodeThis(1, { value: true });

// Encode a Percentage (DPT 5.001)
const bufOnly5 = KnxDataEncoder.encodeDpt5({ valueDpt5001: 50 });
const buf5 = KnxDataEncoder.encodeThis(5001, { valueDpt5001: 50 });
const buf5001 = KnxDataEncoder.encodeThis("5.001", { valueDpt5001: 50 });

// Encode a Temperature (DPT 9.001)
const buf9 = KnxDataEncoder.encodeThis(9, { valueDpt9: 22.5 });
```

### Type Safety and IntelliSense

Both `KnxDataDecode.decodeThis()` and `KnxDataEncoder.encodeThis()` are strictly typed. This means:

- **IntelliSense Support**: Your IDE will automatically suggest supported DPTs as you type the first parameter.
- **Automatic Data Validation**: The second parameter (the data object) automatically adjusts its required properties based on the DPT selected in the first parameter.
- **Supported DPTs**: You can programmatically inspect the list of supported DPTs (they return an array of numbers):

  ```typescript
  console.log(KnxDataDecode.dptEnum);
  console.log(KnxDataEncoder.dptEnum);
  ```

## 🧪 Manual Message Construction and Sending (Experimental)

The library exports low-level classes for building or reading **cEMI** and **EMI** messages in a granular way. This is useful for diagnostics, custom telegram injection, or implementing services not covered by the high-level API.

### Hierarchy of a KNX Message

In the actual API of this project, you typically build the **APDU** and **TPDU** layers first, and then create the final **cEMI** or **EMI** service. For a standard `L_Data.req` telegram, the final class is `CEMI.DataLinkLayerCEMI["L_Data.req"]`.

#### 1. APDU (Application Protocol Data Unit)

Defines the command (**APCI**) and the message data.

```typescript
import { APDU, APCI, APCIEnum } from 'knx.ts';

const apci = new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit);
const apdu = new APDU(undefined, apci, Buffer.from([0x01]), true);
```

#### 2. TPDU (Transport Protocol Data Unit)

Wraps the APDU and defines the transport type.

```typescript
import { TPDU, TPCI, TPCIType } from 'knx.ts';

const tpdu = new TPDU(
  new TPCI(TPCIType.T_DATA_GROUP_PDU),
  apdu,
  apdu.data,
);
```

#### 3. cEMI `L_Data.req`

In this library you do not build a generic `new CEMI()` for this case. You must instantiate the concrete cEMI service and pass its control fields, addresses, and `TPDU`.

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

#### 4. Additional Information (optional)

`AdditionalInformationField` is not filled by assigning `type` and `data` manually. You must create instances of the concrete types defined in `KNXAddInfoTypes` and add them to the field.

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

`EMI` is also not used as a generic instance with `new EMI()`. The class acts as a service container and parser (`EMI.fromBuffer(...)`). In connections such as `KNXUSBConnection`, the library automatically converts a cEMI `ServiceMessage` to EMI when needed.

### Final Assembly and Sending Example

Once the structure is built, you can send it directly as a `ServiceMessage`, or serialize it with `toBuffer()` if you really need the raw buffer.

```typescript
import { KNXTunneling } from 'knx.ts';

const tunnel = new KNXTunneling({
  ip: '192.168.1.10',
  port: 3671,
});

await tunnel.connect();
await tunnel.send(cemi);

// If you need the serialized buffer:
await tunnel.send(cemi.toBuffer());
```

## 🛠️ Development

To build the project:

```bash
npm run build
```

To run routing tests:

```bash
npm run test:routing
```

```bash
npm run test:connection
```

## 👤 Author

- **Arnold Steven Beleño Zuletta (Wesxt)**

## ⚖️ License

This project is licensed under the MIT License.
