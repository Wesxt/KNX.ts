# knx.ts

A high-performance **KNXnet/IP** library written in **TypeScript**. This project focuses on protocol strictness and connection stability, specifically optimized to provide a reliable experience when used as a Gateway for ETS.

## 🌟 Current Capabilities

- **Robust UDP Tunnelling**: Implements a strict *Stop-and-Wait* queue and sequence number management (KNX Spec Vol 3/8/4). This eliminates common "connection broken" issues in ETS during long sessions.
- **KNXnet/IP Routing**: Supports standard multicast routing for seamless bus integration.
- **Intuitive Address-Based Events**: Listen to specific telegrams using group addresses as event names (e.g., `server.on("1/1/1", ...)`).
- **Echo Cancellation**: Automatically filters out loopback messages to prevent telegram processing loops.
- **High Performance**: Optimized for Node.js environments with minimal overhead.

## 🚧 Status: Experimental & Work-In-Progress

As per the `TODO.md`, several features are currently in an **experimental** state or under development:

- **TCP Support**: Implementation is present but testing is currently in an experimental phase.
- **TPUART Hardware**: Integration with TPUART chips via serial is implemented but awaits full hardware verification, this implementation is based from the knxd.
- **Advanced Routing**: Complex routing between multiple Tunnels and TPUART via the `Router` class is under evaluation.
- **Device Parameterization**: Support for *Programming Mode* (progMode) is planned to allow full device configuration via ETS.
- **Source Filtering**: Filtering based on source addresses and selective routing is on the roadmap.

## 📦 Installation

```bash
git clone https://github.com/Wesxt/KNX.ts.git
cd KNX.ts
```

## 🛠️ Quick Start

### Create a KNXnet/IP Server (Gateway)

Perfect for creating a bridge between your IP network and the KNX bus.

```typescript
import { KNXnetIPServer } from './src/index.ts';

const server = new KNXnetIPServer({
  localIp: '192.168.1.50',
  individualAddress: '1.1.0', 
  friendlyName: 'TypeScript KNX Gateway',
  clientAddrs: '1.1.10:5' // Provide 5 tunneling slots starting from 1.1.10
});

server.connect().then(() => {
  console.log('KNXnet/IP Server is up and running');
});

// Specific listening for a Group Address
server.on('1/1/1', (cemi) => {
  console.log('New data on 1/1/1:', cemi.TPDU.apdu.data);
});
```

### Tunneling Client

```typescript
import { KNXTunneling } from './src/index.ts';

const tunnel = new KNXTunneling({
  ip: '192.168.1.100', 
  port: 3671,
  localIp: '192.168.1.50'
});

tunnel.connect().then(() => {
  console.log('Connected to KNX Bus');
});
```

## 📝 Logging

The library uses a global singleton logger based on [Pino](https://github.com/pinojs/pino). You can configure it at the very beginning of your application using `setupLogger`.

```typescript
import { setupLogger, knxLogger } from './src/index.ts';

// Configure the global logger
setupLogger({
  level: 'debug', // e.g., 'info', 'warn', 'error', 'debug'
  logToFile: true,
  logDir: './logs',
});

// You can also use the global logger in your own application
knxLogger.info("Application started");
```

All internal components (`KNXnetIPServer`, `KNXTunneling`, `Router`, etc.) automatically use this shared logger to avoid spawning multiple Pino instances.

## 📡 Events & Callbacks

The library is event-driven. You can listen for system events or specific KNX Group Addresses.

### Common Events

Both `KNXnetIPServer` and `KNXTunneling` emit the following events:

| Event | Description | Callback Arguments |
|-------|-------------|--------------------|
| `connected` | Connection established and ready. | `void` (Server) / `{ channelId }` (Tunnel) |
| `disconnected` | Connection lost or closed. | `void` |
| `error` | An error occurred during operation. | `Error` |
| `indication` | Any incoming KNX telegram (L_Data.ind). | `cemi: L_Data_ind` |

### Address-Based Events (Server Only)

You can listen to specific Group Addresses directly:

```typescript
server.on("1/1/1", (cemi) => {
  // Triggered only for telegrams to 1/1/1
});
```

### Understanding the `cemi` Object

The `cemi` object (specifically `L_Data_ind`) contains all the information about the KNX telegram. Here are the most relevant properties:

| Property | Type | Description |
|----------|------|-------------|
| `sourceAddress` | `string` | Physical address of the sender (e.g., `"1.1.5"`). |
| `destinationAddress` | `string` | Group address (e.g., `"1/1/1"`) or Physical address. |
| `TPDU.apdu.data` | `Buffer` | The raw payload data. |
| `TPDU.apdu.apci.command` | `string` | Command type (`A_GroupValue_Write`, `A_GroupValue_Read`, etc.). |

#### Handling Data Payloads

KNX handles data in two ways depending on the size:

- **Short Data (<= 6 bits)**: For DPT1 (Switch), DPT3 (Control), etc. The `cemi.TPDU.apdu.data[0]` contains the value.
- **Extended Data (> 6 bits)**: For DPT5 (Scaling), DPT9 (Float), etc. The `cemi.TPDU.apdu.data` Buffer contains the full payload (e.g., 2 bytes for DPT9).

## 🔢 Data Encoding & Decoding

The library provides static utilities to handle KNX Data Point Types (DPT) conversion between raw Buffers and high-level TypeScript objects.

### Decoding Incoming Data

Use `KnxDataDecode` to transform raw CEMI data into readable values:

```typescript
import { KnxDataDecode } from './src/core/data/KNXDataDecode';

server.on('1/1/1', (cemi) => {
  // Decode as DPT 1 (Boolean)
  const value = KnxDataDecode.decodeThis(1, cemi.TPDU.apdu.data);
  console.log('Decoded value:', value); // true or false

  // Decode as DPT 9 (2-byte Float, e.g., Temperature)
  const temp = KnxDataDecode.decodeThis(9, cemi.TPDU.apdu.data);
  console.log('Temperature:', temp, '°C');
});
```

### Encoding Data for Sending

Use `KnxDataEncoder` with the `encodeThis` method to prepare buffers for KNX telegrams; the second parameter is always an object (Problem: all DPTs other than DPT1 belonging to a property are different keys instead of just "value" values; this will be fixed in the future):

```typescript
import { KnxDataEncoder } from './src/core/data/KNXDataEncode';

// Encode a Boolean (DPT 1)
const buf1 = KnxDataEncoder.encodeThis(1, { value: true });

// Encode a Percentage (DPT 5.001)
const buf5 = KnxDataEncoder.encodeThis(5.001, { valueDpt5001: 50 });

// Encode a Temperature (DPT 9.001)
const buf9 = KnxDataEncoder.encodeThis(9, { valueDpt9: 22.5 });
```

### Type Safety & IntelliSense

Both `KnxDataDecode.decodeThis()` and `KnxDataEncoder.encodeThis()` are strictly typed. This means:

- **IntelliSense Support**: Your IDE will automatically suggest the supported DPTs as you type the first parameter.
- **Automatic Data Validation**: The second parameter (the data object) automatically adjusts its required properties based on the DPT selected in the first parameter.
- **Supported DPTs**: You can programmatically check the list of supported DPTs by accessing the static `dptEnum` property:

  ```typescript
  console.log(KnxDataDecode.dptEnum);
  console.log(KnxDataEncoder.dptEnum);
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

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) and [NOTICE](NOTICE) files for details.
