# knx.ts

Spanish version: see [readme-es.md](./readme-es.md).

A high-performance **KNXnet/IP** and **Hardware Interface** library such as **HID USB** and **TPUART**, written in **TypeScript**.

This project focuses on protocol strictness, reading and sending any kind of **EMI** or **CEMI** message, broad DPT (Data Point Type) support, connection stability, and direct hardware integration, specifically optimized to provide a reliable experience when used as a Gateway for ETS or as a core for custom KNX controllers.

## 🌟 Capabilities

- **Robust UDP Tunneling**: Implements a strict _Stop-and-Wait_ queue and sequence number management. This eliminates common "connection interrupted" issues in ETS or other applications during long sessions.
- **KNXnet/IP Routing**: Supports multicast routing (only in the **KNXnet/IP** server).
- **Discovery in the KNXnet/IP server**: Supports `SEARCH_REQUEST`, `SEARCH_REQUEST_EXTENDED`, `DESCRIPTION_REQUEST`, `CONNECT_REQUEST`, and `CONNECTIONSTATE_REQUEST` so applications such as ETS can discover it without manual configuration.
- **Direct Hardware Interfaces**: Native support for **KNX USB interfaces** (via `node-hid`) and **TPUART** serial chips (via `serialport`).
- **Program devices**: The library is now capable of fully programming KNX devices, including both the physical address and the program. *(This was tested with a router instance using the KNXnetIpServer and KNXUSB links. The KNXUSB was connected to the actual KNX bus. The device, a Zennio MAXinBOX 66, was deprogrammed and then fully programmed.)*
- **Learning Bridge (Router)**: Advanced multi-interface routing with Loop Prevention, Signature Tracking, and Individual Address (IA) learning, allowing you to bridge multiple physical interfaces and tunnels simultaneously.
- **Intuitive Address-Based Events**: Listen to specific telegrams using group addresses as event names (e.g., `server.on("1/1/1", ...)`).
- **Echo Cancellation**: Automatically filters loopback messages to prevent telegram processing loops.
- **High Performance**: Optimized for Node.js environments with minimal overhead.

## 🚧 Status: Experimental and In Development

According to `TODO.md`, several features are currently **experimental** or under development:

- **TCP Support**: The implementation is present, but testing is currently in an experimental phase.
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

- **Built-in Custom Logger**: A highly efficient, custom-built logger using `worker_threads` for asynchronous, non-blocking daily file rolling, module tagging, and ANSI colored console outputs.
- **[node-hid](https://github.com/node-hid/node-hid)**: Used by `KNXUSBConnection` to interact natively with KNX USB interfaces. Keep in mind that native modules may require build tools on some operating systems.
- **[serialport](https://serialport.io/)**: Used by `TPUARTConnection` for direct UART communication. Like `node-hid`, this is a native module.

## Gateways

If you are looking for a gateway to connect your KNX network to a web interface or an IoT platform, look for the `GatewaySources` repository, you can use `KNXWebSocketGateway` or `KNXMQTTGateway`. If you are looking for a gateway to connect your KNX network to a Modbus network, you can use `ModbusGateway`.

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

- `KnxDataDecode`: Static utility to decode raw `Buffer` payloads into standard JavaScript/TypeScript types (primitives like `boolean`, `number`, `string`, or structured objects with metadata/units like `{ value, unit }`, time breakdown, or RGBW color validity) according to KNX specifications. All methods feature complete English JSDocs and descriptive error handling.
- `KnxDataEncoder`: Static utility to validate and encode JavaScript/TypeScript values into `Buffer` payloads ready for KNX telegrams. Single-value DPTs accept either raw primitive values (e.g., `true`, `22.5`, `75`) or `{ value: ... }` wrapper objects, while complex multi-field DPTs accept structured objects. Includes granular input validation with detailed error diagnostics (`InvalidParametersForDpt`), pre-validation without encoding (`encodeThisOnlyVerify`), and full English JSDocs.

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
- `DPTs`: The library exports interfaces such as `DPT5001`, `DPT1`, or `DPT10001`. Single-value DPT types accept both direct primitive values and `{ value: T }` wrapper objects. These interfaces are used by `KnxDataDecode` for typing decoded outputs and by `KnxDataEncoder` to validate and convert inputs into `Buffer`s.
- `ServiceMessage` is an interface implemented by all CEMI and EMI messages, and also by NPDU, TPDU, and APCI layers. This is useful because they all expose two helpful methods: `toBuffer` to serialize the instance into a buffer and `describe` to provide a human-readable view of the instance. **Note**: most exported classes in this library that do not implement this interface, such as `APCI`, still provide a `describe` method.
- `CEMIInstance` is an type of all CEMI Instances.

## 🛠️ Quick Start

### Create a KNXnet/IP Server (Gateway)

Perfect for creating a bridge between your IP network and the KNX bus.

```typescript
import { KNXnetIPServer, CEMIInstance, KnxDataDecode } from "knx.ts";

const server = new KNXnetIPServer({
  localIp: "192.168.1.50",
  individualAddress: "1.1.0", // Be careful not to create conflicts
  friendlyName: "TypeScript KNX Gateway", // This name is shown in ETS
  clientAddrs: "1.1.10:5", // Provides 5 tunneling slots starting from 1.1.10
});

server.connect().then(() => {
  console.log("The KNXnet/IP server is running");
});

server.on("error",(err)=>{
  console.error(err)
})

server.on("indication", (cemi: CEMIInstance) => {
  console.log("New data:", cemi.TPDU.apdu.data); // Raw APDU data
  console.log("Decoded data:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Converted JavaScript value
});

// Specific listener for a Group Address
server.on("1/1/1", (cemi: CEMIInstance) => {
  console.log("New data on 1/1/1:", cemi.TPDU.apdu.data); // Raw APDU data
  console.log("Decoded data:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Converted JavaScript value
});
```

### Direct USB Connection

```typescript
import { KNXUSBConnection } from "knx.ts";

const usb = new KNXUSBConnection({
  // Omitting path/vendorId will automatically discover the first known KNX USB interface
});

usb.connect().then(() => {
  console.log("Connected directly to the KNX USB interface");
});

usb.on("error", (err) => {
  console.error(err)
})

usb.on("indication", (cemi) => {
  console.log("USB telegram source:", cemi.sourceAddress);
});
```

### Tunneling Client

```typescript
import { KNXTunneling } from "knx.ts";

const tunnel = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  localIp: "192.168.1.50",
});

tunnel.connect().then(() => {
  console.log("Connected to the KNX bus");
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

### Link Router

If you want to combine different KNX connections supported by the library and route their messages, you can instantiate them using the `Router` class. Each instance is optional, so various combinations are possible.

You can program real KNX devices by maintaining a KNXnetIpServer link to connect to ETS and a link that can communicate through the KNX bus (TPUART, KNXUSB). To achieve this, set the `handleHopCount` option to false or leave it at its default value, and set the `isUseSingleIA` option to true or leave it at its default value.

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
    toIpFilter: { // (Optional) Filter addresses towards Tunneling and KNXnetIPServer connections
      groupAddress: {
        addresses: [],
        groupAddressToIpFilterPolicie: "accept only"
      },
      individualAddress: {
        addresses: [],
        individualAddressToIpFilterPolicie: "discard all"
      }
    },
    toLocalFilter: { // (Optional) Filter addresses towards TPUART and KNXUSB connections
      groupAddress: {
        addresses: [],
        groupAddressToLocalFilterPolicie: "discard all"
      },
      individualAddress: {
        addresses: [],
        individualAddressToLocalFilterPolicie: "accept only"
      }
    },
    logOptions: { // The router can also be configured to log data
      level: "debug",
    },
  });

  router.connect()

  router.on("indication_link", (msg: {src: string, msg: CEMIInstance}) => {
    // Here you can capture all the messages from the links
    console.log(msg)
  })
```

## 🌐 (API)

### GroupAddressCache (Integrated Caching)

The gateways depend heavily on `GroupAddressCache` to know the corresponding DPT for each group address. This allows them to seamlessly decode values and encode short primitives without requiring payload metadata on every request.

Every `KNXService` (like `KNXnetIPServer`, `Router`, etc.) has an integrated `GroupAddressCache`. It listens to incoming telegrams and remembers the last known values as well as configured DPTs, which is critical for query actions or state tracking in the Gateways.

> **Important**: This cache is disabled by default to conserve memory, but if you plan to use the `KNXWebSocketGateway` or `KNXMQTTGateway` servers, it will be enabled.

To enable caching, you must explicitly enable it globally:

```typescript
import { GroupAddressCache } from "knx.ts";

// Enable the cache singleton
GroupAddressCache.getInstance().setEnabled(true);

// You can optionally configure its limits (max addresses, max messages per address)
GroupAddressCache.getInstance().configure(65535, 10);
```

If you create an instance of a router and register links with it, the router will handle cache management and do the same for destination address events.

```typescript
import { Router, KNXUSBConnection } from "knx.ts";

const router = new Router({});
const usb = new KNXUSBConnection({
  individualAddress: "1.1.250"
});
// The router will manage the link address cache and events related to destination addresses, rather than the link itself.
router.addLink(usb);

router.on("indication_link", (msg: { src: string, msg: CEMIInstance }) => {
  console.log("New data:", msg.msg.TPDU.apdu.data); // Raw APDU data
  console.log("Decoded data:", KnxDataDecode.decodeThis("1.001", msg.msg.TPDU.apdu.data)); // Converted JavaScript value
});

router.on("1/1/1", (cemi: CEMIInstance) => {
  // <--- it activates
  console.log("New data on 1/1/1:", cemi.TPDU.apdu.data); // Raw APDU data
  console.log("Decoded data:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Converted JavaScript value
});

usb.on("1/1/1", (cemi: CEMIInstance) => {
  // <--- it doesn't activate
  console.log("New data on 1/1/1:", cemi.TPDU.apdu.data); // Raw APDU data
  console.log("Decoded data:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data)); // Converted JavaScript value
});
```

## 📝 Logging

The library uses a single global custom logger running its I/O file operations via `worker_threads` to prevent event-loop blocking. You can configure it at the beginning of your application using `setupLogger`.

This is important because you do not need to instantiate a logger yourself; the internal `knxLogger` manages its state, daily file rolling, and semantic module tagging.

```typescript
import { setupLogger, knxLogger } from "knx.ts";

// Configure the global logger
setupLogger({
  level: "debug", // e.g. 'info', 'warn', 'error', 'debug'
  logToFile: true,
  logDir: "./logs",
});

// You can also use the global logger in your own application
knxLogger.info("Application started");
```

All internal components (`KNXnetIPServer`, `KNXTunneling`, `Router`, etc.) automatically use this shared logger.

## 📡 Events and Callbacks

The library is event-driven. Depending on the class you use, different events are emitted to provide detailed control and monitoring.

### Monitoring Connection State (FSM)

All connection classes (`KNXnetIPServer`, `KNXTunneling`, `KNXUSBConnection`, `TPUARTConnection`) share a unified Finite State Machine (FSM) engine. This ensures robust transitions, prevents race conditions, and handles graceful auto-reconnections seamlessly.
You can synchronously check the current state of any connection at any time by reading the `connectionState` property:

```typescript
import { KNXTunneling, KNXTunnelingState } from "knx.ts";

const tunnel = new KNXTunneling({ ip: "192.168.1.100", port: 3671 });

console.log(tunnel.connectionState); // "DISCONNECTED"

tunnel.connect().then(() => {
  console.log(tunnel.connectionState); // "CONNECTED"
});

// If the network drops, the FSM enters auto-recovery mode
// console.log(tunnel.connectionState); // "RECONNECTING"
```

The underlying state strings are strictly typed and exported as enums/objects (e.g., `KNXTunnelingState`, `KNXUSBState`, `KNXServerState`, `TPUARTState`), allowing you to handle precise states in your application logic.

### Common Events

All connection classes (`KNXnetIPServer`, `KNXTunneling`, `KNXUSBConnection`, `TPUARTConnection`) inherit from `KNXService` and emit the following standard events:

| Event            | Description                                                                               | Callback Arguments                                    |
| ---------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `connected`      | Connection established and hardware/socket ready.                                         | `void` (Server/USB/TPUART) / `{ channelId }` (Tunnel) |
| `disconnected`   | Connection lost or explicitly closed.                                                     | `void`                                                |
| `disconnected_client`   | The connection was lost or explicitly closed from a tunnel client in KNXNetIPServer.                                                     | `number` (ChannelId)                                                |
| `error`          | A fatal error occurred during operation.                                                  | `err: Error`                                          |
| `indication`     | Any incoming standard KNX telegram (cEMI / L_Data.ind).                                   | `cemi: CEMIInstance`                                  |
| `raw_indication` | The raw `Buffer` before parsing (EMI/cEMI/payload).                                       | `data: Buffer`                                        |
| `indication_emi` | Emitted when an older EMI1/EMI2-formatted message is received from legacy USB interfaces. | `emi: EMIInstance`                                    |
| `send`           | Emitted when a message is sent to the bus.                                                | `data: CEMIInstance`                                  |

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

- `indication_link`: Emitted when a packet is routed through the bridge. Argument: `{ src: string, msg: CEMIInstance }`, where `src` is the class name of the source connection.
- `error`: Emitted when an underlying link fails. Argument: `{ link: KNXService, error: Error }`.

### Understanding the Telegram Object

The `cemi` or `emi` object (implementing `ServiceMessage`) contains all the information about the KNX telegram. Here are the most relevant properties:

| Property                 | Type     | Description                                                     |
| ------------------------ | -------- | --------------------------------------------------------------- |
| `sourceAddress`          | `string` | Physical address of the sender (e.g., `"1.1.5"`).               |
| `destinationAddress`     | `string` | Group address (e.g., `"1/1/1"`) or physical address.            |
| `TPDU.apdu.data`         | `Buffer` | The raw payload data.                                           |
| `TPDU.apdu.apci.command` | `string` | Command type (`A_GroupValue_Write`, `A_GroupValue_Read`, etc.). |

#### Handling Data Payloads

KNX handles data in two ways depending on size:

- **Short Data (<= 6 bits)**: For DPT1 (Switch), DPT3 (Control), etc. `cemi.TPDU.apdu.data[0]` contains the value.
- **Extended Data (> 6 bits)**: For DPT5 (Scaling), DPT9 (Float), etc. The `cemi.TPDU.apdu.data` buffer contains the full payload (e.g., 2 bytes for DPT9).

## 🔢 Data Encoding and Decoding

The library provides static utilities to handle conversion of KNX Data Point Types (DPT) between raw buffers and high-level TypeScript objects.

### Decoding Incoming Data

Use `KnxDataDecode` to transform raw cEMI data into readable values. You can use the generic `decodeThis` method (which automatically infers types and delegates based on the DPT identifier) or specific `asDpt...` methods:

```typescript
import { KnxDataDecode } from "knx.ts";

server.on("1/1/1", (cemi) => {
  // Decode as DPT 1 (Boolean) -> returns boolean (true | false)
  const value = KnxDataDecode.decodeThis(1, cemi.TPDU.apdu.data);
  console.log("Decoded value:", value); // true or false

  // Decode directly using specific method
  const value1 = KnxDataDecode.asDpt1(cemi.TPDU.apdu.data);

  // Decode as DPT 9 (2-byte float, e.g. Temperature) -> returns number
  const temp = KnxDataDecode.decodeThis(9, cemi.TPDU.apdu.data);
  console.log("Temperature:", temp, "°C");

  // Strings with standard DPT notation are also supported
  const temp1 = KnxDataDecode.decodeThis("9.001", cemi.TPDU.apdu.data);
  const percentage = KnxDataDecode.decodeThis("5.001", cemi.TPDU.apdu.data);

  // Complex DPTs return descriptive structured objects:
  // DPT 10.001 (Time of Day) -> { day: 1, dayName: "Monday", hour: 14, minutes: 30, seconds: 0 }
  const time = KnxDataDecode.decodeThis(10001, cemi.TPDU.apdu.data);

  // DPT 251.600 (RGBW) -> { R: { value, valid }, G: { ... }, B: { ... }, W: { ... } }
  const rgbw = KnxDataDecode.decodeThis(251600, cemi.TPDU.apdu.data);
});
```

All `KnxDataDecode` methods feature complete English JSDocs and throw clear, descriptive errors if buffer sizes are insufficient or invalid.

### Encoding Data for Sending

Use `KnxDataEncoder` with the `encodeThis` method to validate and prepare buffers for KNX telegrams. There are also specific `encodeDpt...` methods, but `encodeThis` provides strict TypeScript inference and automatic delegation:

- **Single-value DPTs** (e.g., DPT 1, 5, 5.001, 5.002, 6, 7, 8, 9, 12, 13, 14, 20, 28.001, 29): Accept **either raw primitive values** directly or `{ value: ... }` wrapper objects.
- **Complex multi-field DPTs** (e.g., DPT 2, 3, 10.001, 11.001, 15, 27.001, 238.600, 245.600, 250.600, 251.600): Accept typed structured objects with their respective required fields.

```typescript
import { KnxDataEncoder } from "knx.ts";

// --- Single-Value DPTs: Direct Primitives or { value } Wrapper ---

// DPT 1 (Boolean): accepts boolean directly or { value: boolean }
const buf1Raw = KnxDataEncoder.encodeThis(1, true);
const buf1Obj = KnxDataEncoder.encodeThis(1, { value: true });

// DPT 5.001 (Percentage 0-100%): accepts number or { value: number }
const buf5Raw = KnxDataEncoder.encodeThis(5001, 75);
const buf5Obj = KnxDataEncoder.encodeThis("5.001", { value: 75 });

// DPT 9 (2-byte float / Temperature): accepts number or { value: number }
const buf9Raw = KnxDataEncoder.encodeThis(9, 21.5);
const buf9Obj = KnxDataEncoder.encodeThis("9.001", { value: 21.5 });

// DPT 28.001 (UTF-8 String) & DPT 29 (64-bit BigInt)
const buf28 = KnxDataEncoder.encodeThis(28001, "Living Room");
const buf29 = KnxDataEncoder.encodeThis(29, 123456789012345n);

// --- Complex Multi-Field DPTs: Structured Objects ---

// DPT 2 (1-bit control + 1-bit value)
const buf2 = KnxDataEncoder.encodeThis(2, { control: 1, value: 0 });

// DPT 3.007 / 3.008 (Dimming / Blinds Control)
const buf3 = KnxDataEncoder.encodeThis(3007, { control: 1, stepCode: 5 });

// DPT 10.001 (Time of Day: day, hour, minutes, seconds)
const bufTime = KnxDataEncoder.encodeThis(10001, {
  day: 1, // Monday
  hour: 14,
  minutes: 30,
  seconds: 0,
});

// DPT 11.001 (Date: day, month, year)
const bufDate = KnxDataEncoder.encodeThis(11001, {
  day: 25,
  month: 9,
  year: 2026,
});

// DPT 251.600 (RGBW with individual validity masks)
const bufRgbw = KnxDataEncoder.encodeThis(251600, {
  R: 255, G: 128, B: 0, W: 64,
  mR: 1, mG: 1, mB: 1, mW: 1,
});
```

### Granular Input Validation (`InvalidParametersForDpt`)

`KnxDataEncoder` validates incoming data before serializing it. If an input is invalid, it throws an `InvalidParametersForDpt` error containing detailed diagnostic properties:

- `error.dpt`: The DPT number being encoded.
- `error.received`: The raw payload that was passed.
- `error.property`: The specific property that failed validation (e.g. `'hour'`, `'value'`, `'cCT'`).
- `error.expected`: Description of the expected type or range (e.g. `'number (0 to 23)'`).
- `error.reason`: A descriptive explanation of why validation failed (e.g. `'Value 25 is out of range (0 to 23)'` or `'Missing required property "hour"'`).

```typescript
import { KnxDataEncoder, InvalidParametersForDpt } from "knx.ts";

try {
  KnxDataEncoder.encodeThis(10001, { day: 1, hour: 25, minutes: 0, seconds: 0 } as any);
} catch (error) {
  if (error instanceof InvalidParametersForDpt) {
    console.error(`DPT ${error.dpt} error on property "${error.property}":`);
    console.error(`Expected: ${error.expected}`);
    console.error(`Reason: ${error.reason}`);
  }
}
```

### Pre-Validation Without Encoding (`encodeThisOnlyVerify`)

If you want to validate incoming user input, API payloads, or form submissions without allocating or generating a `Buffer`, use `encodeThisOnlyVerify`:

```typescript
// Validates data according to DPT rules and returns the valid data, or throws InvalidParametersForDpt
const validatedData = KnxDataEncoder.encodeThisOnlyVerify(10001, userInput);
```

### Type Safety and IntelliSense

Both `KnxDataDecode.decodeThis()` and `KnxDataEncoder.encodeThis()` are strictly typed in TypeScript:

- **IntelliSense Support**: Your IDE will automatically suggest supported DPTs as you type the first parameter (numeric IDs or standard string notation like `"1.001"`, `"9.001"`).
- **Adaptive Parameter Typing**: The data parameter automatically adjusts its accepted type based on the selected DPT (allowing direct primitives or `{ value }` wrappers for single-value DPTs, or structured objects for complex DPTs).
- **Supported DPTs List**: You can programmatically inspect the array of supported DPT numbers:

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
import { APDU, APCI, APCIEnum } from "knx.ts";

const apci = new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit);
const apdu = new APDU(undefined, apci, Buffer.from([0x01]), true);
```

#### 2. TPDU (Transport Protocol Data Unit)

Wraps the APDU and defines the transport type.

```typescript
import { TPDU, TPCI, TPCIType } from "knx.ts";

const tpdu = new TPDU(new TPCI(TPCIType.T_DATA_GROUP_PDU), apdu, apdu.data);
```

#### 3. cEMI `L_Data.req`

In this library you do not build a generic `new CEMI()` for this case. You must instantiate the concrete cEMI service and pass its control fields, addresses, and `TPDU`.

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

#### 4. Additional Information (optional)

`AdditionalInformationField` is not filled by assigning `type` and `data` manually. You must create instances of the concrete types defined in `KNXAddInfoTypes` and add them to the field.

```typescript
import { AdditionalInformationField, ManufacturerSpecificData } from "knx.ts";

const addInfo = new AdditionalInformationField();
const manufacturerInfo = new ManufacturerSpecificData();
manufacturerInfo.data = Buffer.from([0x00, 0x01]);
addInfo.add(manufacturerInfo);

cemi.additionalInfo = addInfo;
```

#### 5. EMI (External Message Interface)

`EMI` is also not used as a generic instance with `new EMI()`. The class acts as a service container and parser (`EMI.fromBuffer(...)`). In connections such as `KNXUSBConnection`, the library automatically converts a cEMI `CEMIInstance` to EMI when needed.

> [!NOTE]
> EMI code is relatively old, but not obsolete; the arguments of EMI object class constructors may be redundant or arbitrary compared to those of CEMI (this refers only to the style of the code, not its specification).

### Final Assembly and Sending Example

Once the structure is built, you can send it directly as a `CEMIInstance`, or serialize it with `toBuffer()` if you really need the raw buffer.

```typescript
import { KNXTunneling } from "knx.ts";

const tunnel = new KNXTunneling({
  ip: "192.168.1.10",
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
