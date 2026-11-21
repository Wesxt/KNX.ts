# knx.ts

Spanish version: see [readme-es.md](./readme-es.md).

A high-performance **KNXnet/IP** and **Hardware Interface** library such as **HID USB** and **TPUART**, written in **TypeScript**.

This project focuses on protocol strictness, reading and sending any kind of **EMI** or **CEMI** message, broad DPT (Data Point Type) support, connection stability, and direct hardware integration, specifically optimized to provide a reliable experience when used as a Gateway for ETS or as a core for custom KNX controllers.

## 🌟 Capabilities

- **Robust UDP & TCP Tunneling (v1 & v2)**: Implements a strict _Stop-and-Wait_ queue for UDP, specification-compliant TCP stream framing (`TcpFrameReader`, no `TUNNELLING_ACK` overhead per `03_08_04` §2.6.2), NAT/VPN Route Back HPAI (`0.0.0.0:0`), Extended CRI (specific Individual Address requests), Busmonitor/Raw layers, and **Tunnelling v2 Interface Features** (`TUNNELLING_FEATURE_GET`, `TUNNELLING_FEATURE_SET`, `TUNNELLING_FEATURE_INFO` per `03_08_04` §3).
- **KNXnet/IP Server (UDP, TCP & ETS Gateway)**: Acts as a full KNXnet/IP server supporting multi-slot tunnelling pools (`clientAddrs`), `SEARCH_REQUEST` & Core v2 `SEARCH_REQUEST_EXTENDED` (over UDP and TCP with SRP filtering), `DESCRIPTION_RESPONSE` DIBs (`TUNNELLING_INFO`, `DEVICE_INFO_EXTENDED`, `KNX_ADDRESSES`, `SECURED_SERVICE_FAMILIES`), and ETS **Group Monitor & Busmonitor** (`L_Busmon.ind` conversion for TP1 Standard/Extended frames and `L_Raw.ind`).
- **KNXnet/IP Secure (`03_08_09`)**:
  - **Secure Tunneling Client & Server (TCP Unicast)**: Full X25519 ECDH key exchange, PBKDF2-HMAC-SHA256 user and device authentication (`SESSION_REQUEST`, `SESSION_RESPONSE`, `SESSION_AUTHENTICATE`, `SESSION_STATUS`), and AES-128-CCM frame wrapping (`SECURE_WRAPPER`) in both `KNXTunneling` and `KNXnetIPServer` (`ServerSecureSession`).
  - **Secure Routing Multicast**: Multicast `SECURE_WRAPPER` encryption/authentication and the 48-bit `TIMER_NOTIFY` synchronization state machine (`SecureRoutingTimer`) in `KNXnetIPServer`.
  - **Zero-Dependency ETS `.knxkeys` Reader (`KnxKeyring`)**: Loads, verifies the canonical ETS signature, and decrypts `.knxkeys` files using built-in Node.js `crypto` and `zlib` (including ETS5 integer and ETS6 3-level group address normalization).
- **KNX Data Secure (`03_03_07` §5, `03_05_01` §6.3, `03_05_02` §4)**:
  - **Transparent Application-Layer Security (`KnxDataSecure`)**: End-to-end AES-128-CCM (`APCISec = 0x03F1`, `S-A_Data` with both *Authentication + Confidentiality* and *Authentication-only* modes, automatic *Extended Frame* `FT=0` switching for payloads > 15 bytes) attachable to any `KNXService` (`KNXTunneling`, `KNXnetIPServer`, `KNXUSBConnection`, `TPUARTConnection`).
  - **48-bit Sequence Number & `S-A_Sync` Engine**: Anti-replay validation per sender IA, optional JSON file persistence (`sequenceNumberFile`), `DM_SecureSync_RCl` (point-to-point / connected) and `DM_SecureSync_SBC` (broadcast / system broadcast) with `ToolKey` ↔ `FDSK` fallback.
  - **Secure Device Management & Security Interface Object (Type 17)**: Secure `KNXManagement` sessions (`openSession(ia, { secure: true })` / `withSession`) with helpers for `PID_SECURITY_MODE`, `PID_GRP_KEY_TABLE`, `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`, `PID_SECURITY_FAILURES_LOG`, and `PID_SEQUENCE_NUMBER_SENDING`. *(Validated against official `03_03_07` Annex C vectors and a real physical Zennio MAXinBOX 66 v3.)*
- **Core v2 Extended Discovery (`KNXTunneling.discover` / `KNXnetIPServer.discover`)**: Discovers KNXnet/IP servers over UDP multicast/unicast or TCP unicast with Search Request Parameters (SRP: programming mode, MAC address, minimum service version, requested DIBs) and decodes enriched human-readable metadata (`KNXDiscoveredDevice`).
- **Full KNX Network & Device Management (`KNXManagement` & `KNXManagementSession`)**: Complete implementation of the KNX Management stack (`03_05_02 Management Procedures`, `03_03_07 Application Layer`, `03_05_01 Resources`, and `03_08_03 / 03_06_03 Local cEMI Management`) over a point-to-point connection-oriented Transport Layer (`TransportConnection`, `03_03_04`) as well as broadcast, system broadcast, and connectionless modes:
  - **Individual & Domain Address Management (`NM_*`)**: Read devices in programming mode (with duplicate detection), program Individual Addresses by programming button (`writeIndividualAddress`) or by 6-byte KNX Serial Number (`writeIndividualAddressBySerial`), reset Individual Address to `15.15.255` (`resetIndividualAddress`), read/write Domain Addresses (`readDomainAddress`, `writeDomainAddress`, `readDomainAddressSelective`, `readDomainAddressBySerial`, `writeDomainAddressBySerial`), and read/write Network & System Network Parameters.
  - **Device Management (`DM_*`)**: Persistent authenticated sessions (`openSession` / `withSession`), access authorization (`authorize` / `A_Authorize_Request`) and key programming (`setKey` / `A_Key_Write`), remote programming mode switching (`setProgrammingMode`), standard and extended Interface Object Property & Function Property read/write/description/scan, 16-bit standard memory / 20-bit user memory / 24-bit extended memory / bit-level memory read & write with automatic chunking and read-back verification (`DMP_MemWrite_RCoV`), Load & Run State Machine control (`PID_LOAD_STATE_CONTROL` / `PID_RUN_STATE_CONTROL`), Group Object Link read/write (`A_Link_Read` / `A_Link_Write`), and Basic Restart or confirmed *Master Reset* (`A_Restart` with `RestartEraseCode`).
  - **Local Interface Management (`M_PropRead` / `M_PropWrite` / `M_FuncPropCommand` / `M_Reset`)**: Direct cEMI local device management over `DEVICE_MGMT_CONNECTION` or USB.
- **KNXnet/IP Routing**: Supports plain and secure multicast routing (in the **KNXnet/IP** server).
- **Discovery in the KNXnet/IP server**: Supports `SEARCH_REQUEST`, `SEARCH_REQUEST_EXTENDED`, `DESCRIPTION_REQUEST`, `CONNECT_REQUEST`, and `CONNECTIONSTATE_REQUEST` so applications such as ETS can discover it without manual configuration.
- **Direct Hardware Interfaces**: Native support for **KNX USB interfaces** (via `node-hid`) and **TPUART** serial chips (via `serialport`).
- **Program devices via ETS**: The library is capable of fully programming KNX devices through ETS when bridging a `KNXnetIPServer` and a physical link (`KNXUSBConnection` / `TPUART`). *(Tested with a Zennio MAXinBOX 66 over a real KNX bus.)*
- **Learning Bridge (Router)**: Advanced multi-interface routing with Loop Prevention, Signature Tracking, and Individual Address (IA) learning, allowing you to bridge multiple physical interfaces and tunnels simultaneously.
- **Intuitive Address-Based Events**: Listen to specific telegrams using group addresses as event names (e.g., `server.on("1/1/1", ...)`).
- **Echo Cancellation**: Automatically filters loopback messages to prevent telegram processing loops.
- **High Performance**: Optimized for Node.js environments with minimal overhead.

## 🚧 Status: Experimental and Hardware Validation

According to `TODO.md`, several features are verified through automated suites and ETS integration while others still await broader physical hardware validation:

- **ETS5 Integration & Protocol Compliance**: Discovery (`SEARCH_REQUEST` / `SEARCH_REQUEST_EXTENDED` with SRPs), `DESCRIPTION_RESPONSE`, UDP/TCP Tunneling, Tunnelling v2 Features, Secure Unicast Session handshake, and ETS Busmonitor / Group Monitor are implemented and verified against automated tests and live ETS5 sessions.
- **KNX IP Secure Routing, KNX Data Secure & `KNXManagement` (Hardware Validated)**: Implemented according to the KNX Standard v3.0.0 and verified against official Annex A (`03_08_09`) & Annex C (`03_03_07`) cryptographic test vectors, real ETS `.knxkeys` files, real ETS XML captures, and **live physical hardware** (KNX IP Secure Routing `SECURE_WRAPPER` + `TIMER_NOTIFY` with LogicMachine, and end-to-end KNX Data Secure group communication + `ToolKey` `S-A_Sync` / Security Interface Object 17 management with a Zennio MAXinBOX 66 v3). Full memory/download procedures remain to be validated on additional physical bus devices.
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

- `KNXnetIPServer`: Creates a KNXnet/IP server (Gateway) supporting UDP & TCP listeners (`tcp`, `tcpPort`, `tcpHost`, `allowPlainTcp`), KNX IP Secure unicast sessions (`secure.users`, `secure.deviceAuthenticationPassword`), optional Secure multicast routing (`secure.backboneKey` / `keyringFile`), Core v2 Extended Search (SRP evaluation), Tunnelling v2 Interface Features, and ETS Group/Busmonitor (`L_Busmon.ind`).
- `KNXTunneling`: Connects as a client to an existing KNXnet/IP gateway over UDP (`useRouteBack`), plain TCP (`transport: "TCP"`), or **KNX IP Secure over TCP** (`secure: { ... }`), with Extended CRI (`individualAddress`, `knxLayer`), Tunnelling v2 Interface Features (`getFeature`, `setFeature`), and static Extended Discovery (`KNXTunneling.discover`).
- `KNXManagement`, `KNXManagementSession` & `TransportConnection`: Full KNX Network and Device Management stack (`03_05_02`, `03_03_07`, `03_08_03`) for reading and writing Individual/Domain Addresses, Interface Object Properties, Function Properties, Device/User/Extended Memory, Authorization Keys, Load/Run State Machines, Group Object Links, and Device Restarts/Master Resets without depending on ETS.
- `KnxKeyring`: Zero-dependency loader and decryptor for ETS `.knxkeys` files.
- `KnxDataSecure` & `KnxDataSecureCcm`: Full KNX Data Security Application Layer (`S-AL`, `03_03_07` §5) supporting `S-A_Data` (A+C and A-only), `S-A_Sync`, 48-bit sequence number persistence, transparent `KNXService` encryption/decryption, and secure `KNXManagement` sessions with `ToolKey` / `P2PKey`.
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
- `SRP`: Builds and parses Search Request Parameter blocks (`selectByProgrammingMode`, `selectByMacAddress`, `selectByService`, `requestDibs`) for Core v2 `SEARCH_REQUEST_EXTENDED`.
- `KNXnetIPStructures` / `KNXnetIPEnum`: Includes DIBs, HPAIs, CRIs, CRDs, `DescriptionType`, `KNXLayer`, `InterfaceFeatureId`, `TunnellingFeatureReturnCode`, `AllowedSupportedServiceFamilies`, and `SRPType`.
- Connection Option & Discovery Types: `KNXnetIPServerOptions`, `KNXTunnelingOptions`, `KNXSecureOptions`, `KNXDiscoverOptions`, `KNXDiscoveredDevice`, `RouterConnOptions`, `TPUARTOptions`, `KNXUSBOptions`, and `KNXLoggerOptions`.
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

### Detailed Discovery Guide (`KNXTunneling.discover` & `KNXnetIPServer.discover`)

Both `KNXTunneling.discover(options?: KNXDiscoverOptions)` and `KNXnetIPServer.discover(...)` perform KNXnet/IP Core v1 (`SEARCH_REQUEST`) and Core v2 (`SEARCH_REQUEST_EXTENDED` with SRPs) discovery, returning enriched `KNXDiscoveredDevice[]` objects with human-readable fields (`individualAddressText`, `knxMedium`, `deviceStatus`, `supportedServices`, `tunnellingInfo.slots`, `extendedDeviceInfo`, `supportsTcp`, `supportsSecurity`, etc.).

```typescript
import {
  KNXTunneling,
  KNXnetIPServer,
  AllowedSupportedServiceFamilies,
  DescriptionType,
  SRP,
} from "knx.ts";

// 1. Standard UDP Multicast Discovery (sends SEARCH_REQUEST_EXTENDED + SEARCH_REQUEST)
const devices = await KNXTunneling.discover({
  timeout: 3000,
  ipLocal: "192.168.1.50", // Optional local NIC IP
});

for (const dev of devices) {
  console.log(
    `${dev.friendlyName} @ ${dev.ip}:${dev.port} | IA: ${dev.individualAddressText} | Medium: ${dev.knxMedium} | TCP: ${dev.supportsTcp} | Secure: ${dev.supportsSecurity}`,
  );
  console.log("Services:", dev.supportedServices); // e.g. [{ family: 4, familyName: "Tunnelling", version: 2 }]
  console.log("Tunnel Slots:", dev.tunnellingInfo?.slots); // [{ addressText: "1.1.2", usable: true, authorised: true, free: true }]
}

// 2. Extended UDP Discovery with convenience SRP filters
// When SRPs are specified, includeLegacySearch defaults to false so only servers matching the SRPs reply
const progDevices = await KNXTunneling.discover({
  programmingModeOnly: true,
  timeout: 2000,
});

// Filter by MAC address or minimum service family version (e.g. Security v1)
const secureRouters = await KNXTunneling.discover({
  minService: {
    family: AllowedSupportedServiceFamilies.Security,
    version: 1,
    mandatory: true,
  },
  requestDibs: [
    DescriptionType.DEVICE_INFO,
    DescriptionType.SUPP_SVC_FAMILIES,
    DescriptionType.SECURED_SERVICE_FAMILIES,
    DescriptionType.TUNNELLING_INFO,
  ],
});

// 3. Unicast Discovery over TCP (Core v2 SEARCH_REQUEST_EXTENDED over TCP)
const tcpDevices = await KNXTunneling.discover({
  ip: "192.168.1.100",
  port: 3671,
  transport: "TCP",
  srps: [SRP.requestDibs([DescriptionType.DEVICE_INFO, DescriptionType.TUNNELLING_INFO], false)],
});

// 4. Shorthand positional helper on KNXnetIPServer:
const simpleList = await KNXnetIPServer.discover("192.168.1.50", "224.0.23.12", 3671, 3000, true);
```

### Detailed `KNXTunneling` Guide (UDP, TCP, Route Back, Layers & Tunnelling v2 Features)

`KNXTunneling` supports UDP (`useRouteBack`), plain TCP (`03_08_04` §2.6.2), KNX IP Secure over TCP (`03_08_09`), Extended CRI for requesting a specific Individual Address, Raw/Busmonitor link layers, and Tunnelling v2 Interface Features (`03_08_04` §3):

```typescript
import {
  KNXTunneling,
  ConnectionType,
  KNXLayer,
  InterfaceFeatureId,
} from "knx.ts";

// 1. Plain TCP Tunneling requesting a specific Individual Address via Extended CRI (0x08)
const tunnelV2 = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  transport: "TCP", // Automatically uses Null TCP HPAI (0.0.0.0:0) and omits TUNNELLING_ACK
  connectionType: ConnectionType.TUNNEL_CONNECTION,
  knxLayer: KNXLayer.LINK_LAYER, // Options: LINK_LAYER (0x02), RAW_LAYER (0x04), BUSMONITOR_LAYER (0x80)
  individualAddress: "1.1.15", // Optional: requests a specific IA via Extended CRI
  maxQueueSize: 100,
});

// Listen for asynchronous feature notifications from the server (TUNNELLING_FEATURE_INFO)
tunnelV2.on("feature_info", (featureId: number, value: Buffer) => {
  console.log(`Feature 0x${featureId.toString(16)} changed:`, value.toString("hex"));
});

await tunnelV2.connect();
console.log("Assigned IA:", tunnelV2.individualAddress);

// 2. Tunnelling v2 Interface Features (TUNNELLING_FEATURE_GET / TUNNELLING_FEATURE_SET)
const maxApduBuf = await tunnelV2.getFeature(InterfaceFeatureId.MAX_APDU_LENGTH);
const dd0Buf = await tunnelV2.getFeature(InterfaceFeatureId.DEVICE_DESCRIPTOR_TYPE_0);
const assignedIaBuf = await tunnelV2.getFeature(InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS);

// Enable TUNNELLING_FEATURE_INFO notifications (1 = enable, 0 = disable)
await tunnelV2.setFeature(InterfaceFeatureId.INTERFACE_FEATURE_INFO_ENABLE, Buffer.from([0x01]));

// Always release the channel on shutdown (especially important for UDP slots)
await tunnelV2.disconnect();
```

> **Tip for VPN / ZeroTier / NAT (`UDP`)**: Set `useRouteBack: true` on UDP connections so the client sends a Route Back HPAI (`0.0.0.0:0`), allowing gateways behind NAT or VPN tunnels to reply directly to your source IP and port.

### Detailed `KNXnetIPServer` Guide (UDP, TCP, Secure Sessions, Routing & ETS Busmonitor)

`KNXnetIPServer` acts simultaneously as a KNXnet/IP Tunnelling v1/v2 server (UDP and TCP), KNXnet/IP Router (plain and Secure Routing multicast), and KNX IP Secure Unicast Session server:

```typescript
import { KNXnetIPServer } from "knx.ts";

const server = new KNXnetIPServer({
  ip: "224.0.23.12",
  localIp: "192.168.1.50",
  port: 3671, // Use 0 for an OS-assigned ephemeral UDP/TCP port
  individualAddress: "1.15.1",
  friendlyName: "KNX.ts IP Gateway",
  clientAddrs: "1.15.2:8", // Pool of 8 tunnelling slots (1.15.2 .. 1.15.9)
  useAllInterfaces: true, // Multi-homing multicast discovery across active NICs
  routingDelay: 20, // Minimum ms between outgoing multicast frames (default 20ms)
  ignoreACKTimeout: false,
  MAX_PENDING_REQUESTS_PER_CLIENT: 100,

  // TCP Unicast Server Options (03_08_02 §8.4.3)
  tcp: true, // Enable TCP listener (default: true)
  tcpHost: "0.0.0.0", // Bind host for TCP server
  tcpPort: 3671, // Defaults to `port`
  tcpIdleTimeoutMs: 10000, // Closes idle TCP sockets with no active channel/session
  allowPlainTcp: true, // Set false to enforce KNX IP Secure on TCP

  // Optional KNXnet/IP Secure (Unicast TCP + Multicast Routing)
  secure: {
    deviceAuthenticationPassword: "myDeviceAuthPassword", // FDSK / commissioning password (optional)
    users: {
      1: "myManagementPassword", // User ID 1 = Management / Commissioning (ETS)
      2: "myTunnellingPassword", // User ID >= 2 = Tunnelling client
    },
    // Optionally enable Secure Multicast Routing (or load everything from an ETS .knxkeys file):
    // keyringFile: "./project.knxkeys",
    // keyringPassword: "keyringPassword",
    multicastLatencyToleranceMs: 2000,
    sessionAuthenticationTimeoutMs: 10000,
    sessionTimeoutMs: 60000,
    sessionKeepAliveIntervalMs: 30000,
  },
});

await server.connect();
console.log("UDP Port:", server.udpListeningPort, "TCP Port:", server.tcpListeningPort);
```

- **ETS Busmonitor & Group Monitor**: When ETS (or any client) opens a tunnel with `KNXLayer.BUSMONITOR_LAYER` (`0x80`), `KNXnetIPServer` automatically converts bridged `L_Data.ind`, `L_Data.con`, `L_Data.req`, `L_Raw.ind`, and `L_Raw.req` frames into valid `L_Busmon.ind` (`0x2b`) frames with TP1 Standard (`FT=1`, `LG = dataLen`) or TP1 Extended (`FT=0`) headers and `FCS`, plus `BusmonitorStatusInfo` (`0x03`) and `TimestampRelative` (`0x04`) additional information. Note that per KNX `03_08_04`, Busmonitor Mode accepts one exclusive client while no active link-layer tunnels are open.
- **Pre-Security Compatible Discovery**: Even when `secure.users` or `secure.deviceAuthenticationPassword` are configured, `DESCRIPTION_RESPONSE` / `SEARCH_RESPONSE_EXTENDED` announce `SUPP_SVC_FAMILIES` (`Core v2`, `DeviceManagement v1`, `Tunnelling v2`, `Routing v1`, `Security v1`) alongside `SECURED_SERVICE_FAMILIES` (`0x06`), allowing ETS to perform plaintext discovery and establish encrypted TCP Secure Sessions seamlessly.

### KNX IP Secure & TCP Guide (`KNXTunneling`, `KNXnetIPServer`, `KnxKeyring`)

> **Note**: Validated against KNX Standard `03_08_09` Annex A test vectors, real ETS `.knxkeys` files, and physical KNX IP Secure Routing hardware (LogicMachine + Zennio MAXinBOX 66 v3). KNX IP Secure Tunneling is validated against `03_08_09` test vectors and simulated gateways.

#### 0. ETS Setup & Exporting the `.knxkeys` Keyring

Before using KNX IP Secure in `KNX.ts`, configure security in ETS and export the project keyring:

1. **Protect the ETS Project with a Password**: Open your project settings in ETS5/ETS6 and set a **Project Password** (ETS requires this to enable KNX Secure).
2. **Configure IP Secure in ETS**:
   - **For IP Secure Tunneling**: Add your KNX IP Interface / IP Router to the topology, enable **Secure Commissioning** / **IP Secure** (entering its **FDSK** / QR code when prompted), review the **Tunneling** slots (each slot has its own Individual Address and user password), and download the IP device.
   - **For IP Secure Routing (Backbone)**: Select the **Backbone** (`0.0`) or IP Router in ETS, enable **Security / Secure Routing**, verify the multicast IP (default `224.0.23.12`) and **Backbone Key**, and download the IP Router. *(If you use a third-party router such as LogicMachine, inspect the 32-hex-char Backbone Key via `keyring.getBackbone()?.decryptedKey?.toString("hex")` and paste it into its routing encryption key field.)*
3. **Export the `.knxkeys` File**:
   - **ETS5**: Go to the **Projects** list → select your project → **Details** → **Security** → **Export Keys** (`.knxkeys`) and enter an **Export Password**.
   - **ETS6**: Open the project → **Overview** (top-left) → **Security** → **Export Keyring** (`.knxkeys`) and enter an **Export Password**.
   - Use that export password as `keyringPassword` in `KNX.ts`. Re-export the `.knxkeys` file whenever you add secure devices, change tunneling slots, or regenerate keys.

#### 1. Plain TCP Tunneling (`03_08_04` §2.6.2)

```typescript
import { KNXTunneling } from "knx.ts";

const tcpTunnel = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  transport: "TCP", // Uses Null HPAI (0.0.0.0:0) and omits TUNNELLING_ACK per specification
});

await tcpTunnel.connect();
```

#### 2. KNX IP Secure Tunneling Client over TCP (`03_08_09`)

You can authenticate a Secure Tunneling session either by providing the passwords directly or by passing the `.knxkeys` keyring file exported from ETS:

```typescript
import { KNXTunneling, KnxKeyring } from "knx.ts";

// Option A: Using explicit credentials
const secureTunnel = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  secure: {
    userId: 2, // 1 = Management, >= 2 = Tunnelling channel user
    userPassword: "myTunnelPassword",
    deviceAuthenticationPassword: "myDeviceAuthOrFDSK",
  },
});

// Option B: Loading directly from an ETS .knxkeys file
const secureTunnelFromKeyring = new KNXTunneling({
  ip: "192.168.1.100",
  port: 3671,
  secure: {
    keyringFile: "./project.knxkeys",
    keyringPassword: "myKeyringPassword",
    tunnelInterfaceAddress: "1.1.1", // Optional: picks the matching Tunnelling slot from the keyring
  },
});

// Inspecting a .knxkeys file directly:
const keyring = KnxKeyring.fromSource("./project.knxkeys", "myKeyringPassword");
console.log("Backbone Key:", keyring.getBackbone()?.decryptedKey?.toString("hex"));
console.log("Interfaces:", Array.from(keyring.getInterfaces().values()));
```

#### 3. KNX IP Secure Multicast Routing in `KNXnetIPServer`

```typescript
import { KNXnetIPServer } from "knx.ts";

const secureServer = new KNXnetIPServer({
  localIp: "192.168.1.50",
  individualAddress: "1.1.200",
  friendlyName: "Secure TypeScript KNX Router",
  secure: {
    // Provide a 16-byte Backbone Key directly or load it from .knxkeys:
    keyringFile: "./project.knxkeys",
    keyringPassword: "myKeyringPassword",
    multicastLatencyToleranceMs: 2000,
  },
});

await secureServer.connect();
```

---

### KNX Data Secure Guide (`KnxDataSecure`, `03_03_07` §5)

#### 1. ETS Setup: Assigning an Individual Address & Exporting `.knxkeys`

Every KNX Data Secure device maintains an internal **Security Individual Address Table** (`PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE`). For encrypted group communication (`GroupValue_Write` / `GroupValue_Read`), a target device **only accepts secure telegrams whose sender Individual Address (IA) was explicitly authorized in ETS**—otherwise it silently discards the frame and increments its security failure counter.

Follow these steps in **ETS5 / ETS6** before connecting with `KNX.ts`:

1. **Set a Project Password**: Ensure the ETS project has a password configured so KNX Secure is enabled.
2. **Commission Secure Devices & Group Addresses**:
   - Add your KNX Data Secure devices (e.g., actuators, sensors) to the topology and enter each device's **FDSK** (Factory Default Setup Key / QR code) when prompted by ETS.
   - Create your Group Addresses and verify that **Security** is enabled (*Automatic* or *On*) in each Group Address's properties.
3. **Assign an Individual Address for `KNX.ts` in the ETS Project**:
   - **If connecting via IP Routing (`KNXnetIPServer`), USB, or TP-UART**:
     1. In the target line of your ETS Topology, add a **Dummy / Visualization** device (e.g., *KNX Association → Dummy*) or an **IP Router** interface, and assign it a free Individual Address (for example, `1.1.200`).
     2. Associate all secure Group Addresses that `KNX.ts` will read/write with that Dummy/IP Router (drag the Group Addresses onto the device/interface associations or its group objects so ETS registers `1.1.200` as an authorized communication partner).
   - **If connecting via IP Tunneling (`KNXTunneling`)**:
     1. Select your KNX IP Interface / IP Router in the ETS Topology and open its **Tunneling** slots (each slot has its own IA, e.g., `1.1.250`).
     2. Associate the required secure Group Addresses with the specific Tunneling slot IA that `KNX.ts` will use (under the IP interface/tunnel slot **Associations / Group Addresses**).
4. **Download (Program) the KNX Data Secure Devices**:
   - Perform a **Download Application / Partial Download** to **every KNX Data Secure device** that shares those Group Addresses.
   - During download, ETS writes your assigned IA (`1.1.200` or the tunnel slot IA) into each target device's `PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE` along with the shared Group Keys.
5. **Export the `.knxkeys` Keyring**:
   - **ETS5**: *Projects* → select your project → **Details** → **Security** → **Export Keys** (`.knxkeys`) and define an export password.
   - **ETS6**: Open the project → **Overview** → **Security** → **Export Keyring** (`.knxkeys`) and define an export password.
   - **Important**: Always export `.knxkeys` **after** assigning the IA, linking the Group Addresses, and downloading the devices so the file contains the latest group keys, `ToolKey`s, and sequence numbers.
6. **Match the Individual Address in `KNX.ts`**:
   - For **IP Routing (`KNXnetIPServer`)**, pass the exact IA assigned in ETS to both `individualAddress` and `dataSecure.sourceAddress` (e.g., `"1.1.200"`).
   - For **Tunneling (`KNXTunneling`)**, the gateway assigns the tunnel IA on connection—verify it matches the slot IA authorized in ETS.
   - *Tip for Management Sessions*: Secure management sessions (`KNXManagement` with `{ secure: true }`) use the target device's `ToolKey` from `.knxkeys` and do not require group IA authorization; however, if you route over an IP router/gateway (such as LogicMachine), make sure *"Pass individual telegrams via IP routing"* is enabled.

#### 2. Usage Example in `KNX.ts`

Attach `dataSecure` to any `KNXService` (`KNXTunneling`, `KNXnetIPServer`, `KNXUSBConnection`, or `TPUARTConnection`) to transparently encrypt outgoing secure group telegrams (`write`, `read`, `respond`) and decrypt incoming `S-A_Data` frames (`0x03F1`), or use it with `KNXManagement` for `ToolKey` secure sessions:

```typescript
import { KNXnetIPServer, KNXManagement, KnxDataSecure, KnxDataDecode, DataSecureCEMI } from "knx.ts";

const dataSecure = new KnxDataSecure({
  keyringFile: "./project.knxkeys",
  keyringPassword: "myKeyringPassword",
  sourceAddress: "1.1.200", // Must match the IA authorized in ETS (Step 3 above)
  sequenceNumberFile: "./seq_state.json", // Persists 48-bit sequence numbers across restarts
});

const knx = new KNXnetIPServer({
  ip: "224.0.23.12",
  localIp: "192.168.1.50",
  individualAddress: "1.1.200",
  tcp: false,
  dataSecure,
});

knx.on("indication", (cemi: DataSecureCEMI) => {
  if (cemi.dataSecure) {
    console.log("Decrypted Data Secure telegram:", cemi.sourceAddress, "->", cemi.destinationAddress, "seq:", cemi.dataSecure.sequenceNumber);
    console.log("Value:", KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data));
  }
});

await knx.connect();
await knx.write("1/0/1", "1.001", true); // Automatically encrypted with Group Key (A+C)

// Secure Management session using ToolKey + automatic S-A_Sync:
const mgmt = new KNXManagement(knx, { dataSecure });
await mgmt.withSession("1.1.1", async (session) => {
  console.log("Security Mode:", await session.readSecurityMode());
  console.log("Security IA Table:", await session.readSecurityIndividualAddressTable());
  console.log("Failures Log:", await session.readSecurityFailuresLog());
}, { secure: true });
```

---

### Complete Device & Network Management Guide (`KNXManagement`)

> **Note**: Implements the full KNX Management stack (`03_05_02`, `03_03_07`, `03_08_03`) without read-only restrictions. Validated against real ETS telegram captures (`test_xml/`), simulated devices, and physical KNX Data Secure hardware (Security Interface Object Type 17 & `ToolKey` sessions on Zennio MAXinBOX 66 v3).

```typescript
import {
  KNXManagement,
  KNXPropertyId,
  LoadEvent,
  RunEvent,
  RestartEraseCode,
} from "knx.ts";

const mgmt = new KNXManagement(tunnel, {
  sourceAddress: "1.1.250",
  minFrameDelayMs: 20,
});
```

#### 1. Individual Address & Domain Address Programming (`NM_*`)

```typescript
// A. Read all devices with their Programming Mode button active (detects duplicate addresses)
const prog = await mgmt.readProgrammingModeDevices();
console.log("In programming mode:", prog.addresses, "Duplicates:", prog.duplicates);

// B. Program Individual Address of the device in Programming Mode (NM_IndividualAddress_Write)
// Automatically checks if 1.1.10 is occupied, writes IA, verifies DD0, and runs Basic Restart
const writeRes = await mgmt.writeIndividualAddress("1.1.10");

// C. Program Individual Address by 6-byte KNX Serial Number without pressing the button
const serialRes = await mgmt.writeIndividualAddressBySerial(
  Buffer.from("00FA12345678", "hex"),
  "1.1.12",
);

// D. Reset Individual Address of the device in Programming Mode back to default 15.15.255
await mgmt.resetIndividualAddress();

// E. Read & Write Domain Address (PL110 2-byte / RF 6-byte)
const domains = await mgmt.readDomainAddress();
await mgmt.writeDomainAddress(Buffer.from([0x00, 0x1a]));
await mgmt.writeDomainAddressBySerial(
  Buffer.from("00FA12345678", "hex"),
  Buffer.from([0x00, 0x1a]),
);
```

#### 2. Device Discovery, Diagnostics & Inventory

```typescript
// Check if an address is occupied on the bus (handles both DD0 response and immediate T_Disconnect)
const occupied = await mgmt.isAddressOccupied("1.1.10");

// Run the exact ETS "Individual Address Check" sequence (DD0 + PID_MAX_APDULENGTH + PID_PROG_MODE)
const check = await mgmt.checkIndividualAddress("1.1.10");

// Full device identification (DM_Identify_RCo2: DD0, Manufacturer ID, Serial, HW Type, Order Info, Firmware)
const identity = await mgmt.identifyDevice("1.1.10");

// Scan a line (method: "connect" or "descriptor") and export JSON inventory
const activeAddresses = await mgmt.scanLine("1.1", { range: [1, 64], method: "connect" });
const inventory = await mgmt.exportInventory(activeAddresses);
```

#### 3. Persistent Sessions (`withSession` / `openSession`), Authorization & Keys

When a device requires authorization (`A_Authorize_Request`), the granted access level stays valid only for the duration of the `T_Connect` session. Use `mgmt.withSession(ia, async (session) => { ... })` to execute multiple operations over the same Transport Layer connection:

```typescript
await mgmt.withSession("1.1.10", async (session) => {
  // 1. Authenticate with a 4-byte key (default factory key is 0xFFFFFFFF)
  const accessLevel = await session.authorize(0xffffffff);
  console.log("Granted access level:", accessLevel);

  // 2. Optionally program a new key for access level 1 (DM_SetKey_RCo)
  await session.setKey(1, 0x11223344);

  // 3. Remotely toggle the device's Programming LED ON or OFF (DM_ProgMode_Switch)
  await session.setProgrammingMode(true);
  console.log("Programming LED active:", await session.readProgrammingMode());
  await session.setProgrammingMode(false);
});
```

#### 4. Interface Object Properties & Function Properties (Standard & Extended)

```typescript
// Scan all available properties on Interface Object 0 (Device Object)
const propDescriptions = await mgmt.scanObjectProperties("1.1.10", 0);

// Read and Write standard Interface Object Properties (A_PropertyValue_Read / Write)
const routingCount = await mgmt.readProperty("1.1.10", {
  objectIndex: 0,
  propertyId: KNXPropertyId.PID_ROUTING_COUNT,
});

await mgmt.writeProperty(
  "1.1.10",
  {
    objectIndex: 0,
    propertyId: KNXPropertyId.PID_ROUTING_COUNT,
    data: Buffer.from([0x60]),
  },
  { verify: true, authKey: 0xffffffff },
);

// Call a Function Property (A_FunctionPropertyCommand) or read its state
const fnResult = await mgmt.callFunctionProperty("1.1.10", {
  objectIndex: 0,
  propertyId: 50,
  data: Buffer.from([0x01, 0x02]),
});

// Extended Property addressing (by 16-bit Object Type, 12-bit Instance, 12-bit PID)
const extVal = await mgmt.readPropertyExtended("1.1.10", {
  objectType: 0,
  objectInstance: 1,
  propertyId: KNXPropertyId.PID_SERIAL_NUMBER,
});
```

#### 5. Memory Read/Write (16-bit, 20-bit User, 24-bit Extended) & State Machines

```typescript
await mgmt.withSession("1.1.10", async (session) => {
  await session.authorize(0xffffffff);

  // 1. Standard 16-bit memory read/write with automatic chunking and read-back verification (DMP_MemWrite_RCoV)
  const memDump = await session.readMemory(0x0100, 32);
  await session.writeMemory(0x0100, Buffer.alloc(32, 0xaa), { verify: true, maxChunkSize: 12 });

  // 2. Bit-level memory modification (A_MemoryBit_Write)
  await session.writeMemoryBit(0x0060, Buffer.from([0xfe]), Buffer.from([0x01]));

  // 3. 20-bit User Memory (A_UserMemory_Read / Write) & 24-bit Extended Memory (A_MemoryExtended_Read / Write)
  const userMem = await session.readUserMemory(0x00100, 16);
  await session.writeUserMemory(0x00100, userMem, { verify: true });
  await session.writeExtendedMemory(0x010000, Buffer.from([0x01, 0x02, 0x03, 0x04]));

  // 4. Load State Machine (PID_LOAD_STATE_CONTROL = 5) & Run State Machine (PID_RUN_STATE_CONTROL = 6)
  await session.writeLoadState(3, LoadEvent.UNLOAD);
  await session.writeLoadState(3, LoadEvent.START_LOADING);
  // ... write table/application memory ...
  await session.writeLoadState(3, LoadEvent.LOAD_COMPLETED);
  await session.writeRunState(3, RunEvent.RESTART);
});
```

#### 6. Reading All Device Group Addresses, Group Object Links & Device Restart / Master Reset

```typescript
// Read ALL Group Addresses programmed in a device's Group Address Table (GrAT, 03_05_01 §4.16)
// Automatically detects System B / System 7 PID_TABLE (23), BCU2 / BIM PID_TABLE_REFERENCE (7),
// BCU1 fixed memory (0x0116 / 0x4000), or Group Object Link services
const gaTable = await mgmt.readDeviceGroupAddresses("1.1.10");
console.log("Programmed Group Addresses:", gaTable.groupAddresses, "via:", gaTable.method);

// Read Group Addresses linked to a specific Group Object #1 (A_Link_Read)
const links = await mgmt.readGroupObjectLinks("1.1.10", 1);

// Add or delete a Group Address link on Group Object #1 (A_Link_Write)
await mgmt.writeGroupObjectLink("1.1.10", 1, "1/1/5", { sending: true });

// Basic Restart (restart_type = 0)
await mgmt.restartDevice("1.1.10", { type: "basic" });

// Confirmed Master Reset (restart_type = 1, e.g. Factory Reset without erasing Individual Address)
const resetInfo = await mgmt.restartDevice("1.1.10", {
  type: "master",
  eraseCode: RestartEraseCode.FACTORY_RESET_WITHOUT_IA,
  channelNumber: 0,
  authKey: 0xffffffff,
});
console.log("Master Reset process time (s):", resetInfo?.processTimeSeconds);
```

#### 7. Local Interface cEMI Management (`M_PropRead` / `M_PropWrite` / `M_Reset`)

When connected via `DEVICE_MGMT_CONNECTION` or local USB cEMI, you can read/write properties of the local interface itself:

```typescript
const localSerial = await mgmt.readLocalProperty({
  objectType: 0,
  objectInstance: 1,
  propertyId: KNXPropertyId.PID_SERIAL_NUMBER,
});

await mgmt.writeLocalProperty({
  objectType: 0,
  objectInstance: 1,
  propertyId: KNXPropertyId.PID_PROG_MODE,
  data: Buffer.from([0x00]),
});

await mgmt.resetLocalDevice();
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
- `routing_busy`: Emitted when a `ROUTING_BUSY` frame is received (`RoutingBusy` with `waitTime`).
- `routing_ready`: Emitted when the `ROUTING_BUSY` wait backoff finishes and routing resumes.
- `routing_lost_message`: Emitted when a `ROUTING_LOST_MESSAGE` indication is received (`RoutingLostMessage`).
- `routing_system_broadcast`: Emitted with the raw cEMI payload of an incoming `ROUTING_SYSTEM_BROADCAST`.
- `<GroupAddress>` (e.g., `"1/1/1"`): Listen directly to specific group addresses (e.g., `server.on("1/1/1", (cemi) => {...})`).

#### **TPUARTConnection**

- `busmonitor`: Emitted in Busmonitor mode with raw cEMI frames.
- `bus_ack`: Emitted when the bus confirms a transmission (Ack, Nack, Busy).
- `warning`: Emitted for non-fatal hardware warnings (e.g., slave collision detected, transmission error).

#### **KNXUSBConnection**

- `indication_emi`: Emitted when an older EMI1/EMI2-formatted message is received from legacy USB interfaces.

#### **KNXTunneling**

- `feature_info`: Emitted when receiving a `TUNNELLING_FEATURE_INFO` notification from the server (`(featureId: number, value: Buffer) => void`).
- `secure_session_established`: Emitted when a TCP KNX IP Secure session authenticates (`({ sessionId }) => void`).
- `secure_session_closed`: Emitted when the server sends `SESSION_STATUS` ending or rejecting the secure session (`(status: number) => void`).
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

To build and verify the project:

```bash
# Build TypeScript output into dist/
npm run build

# Run full Jest unit & integration test suite
npm test

# Lint TypeScript sources
npx eslint src/
```

Stability & manual test scripts (from `package.json`):

```bash
# Connection stability scripts
npm run test:stability
npm run test:server-stability

# Manual scripts (hardware / ETS testing)
npm run manualTest:routing
npm run manualTest:tunneling
npm run manualTest:management
npm run manualTest:secureTcp
npm run manualTest:router
npm run manualTest:usb
npm run manualTest:routingUsb
npm run manualTest:tpuart
```

## 👤 Author

- **Arnold Steven Beleño Zuletta (Wesxt)**

## ⚖️ License

This project is licensed under the MIT License.
