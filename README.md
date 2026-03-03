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
