# Contributing to KNX.ts

First off, thank you for considering contributing to `KNX.ts`! It's people like you who make this tool better for the home automation and KNX developer communities.

This document contains a set of guidelines and instructions to help you get started with contributing. Please take a moment to review them before making your contribution.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Pull Requests](#pull-requests)
  - [Development Style](#development-style)
- [Development Setup](#development-setup)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Building the Project](#building-the-project)
  - [Formatting & Linting](#formatting--linting)
- [Testing Guidelines](#testing-guidelines)
  - [Running Unit Tests](#running-unit-tests)
  - [Running Stability & Integration Tests](#running-stability--integration-tests)
  - [Running Manual Hardware Tests](#running-manual-hardware-tests)
- [Project Directory Layout](#project-directory-layout)
- [Hardware & ETS Integration Testing](#hardware--ets-integration-testing)

---

## Code of Conduct

We aim to foster an open, welcoming, and collaborative environment. Please be respectful, constructive, and patient when interacting with other contributors and maintainers.

---

## How Can I Contribute?

### Reporting Bugs

Before submitting a bug report, please check the [Issues](https://github.com/Wesxt/KNX.ts/issues) section to verify if the issue has already been reported.

If you find a new bug, please open an issue and include:
- A clear and descriptive title.
- Steps to reproduce the issue.
- **Hardware setup details**: Since KNX relies heavily on physical hardware, please specify:
  - The interface used (e.g., IP Tunneling interface, IP Router, USB HID Interface, or TPUART serial passthrough).
  - The physical device model (e.g., Zennio MAXinBOX, Siemens, etc.).
- Expected vs. actual behavior.
- Debug logs (our custom logger outputs are highly appreciated!).
- Relevant code snippets or configuration.

### Suggesting Enhancements

We are always looking to improve strictness, stability, and feature support (like DPTs, programming modes, NPDU/TPDU layers). To suggest an enhancement:
- Check existing issues/PRs to see if it is already planned.
- Explain the use case and why this feature is useful.
- Provide examples of how the new API or behavior should look.

### Pull Requests

1. Fork the repository and create your branch from `main`.
2. Write clean, readable code following the project styling guidelines.
3. Add or update tests as appropriate.
4. Ensure all lint rules and tests pass.
5. Submit a pull request with a descriptive title and detailed description of the changes.

### Development Style

The style is focused on OOP (Object-Oriented Programming) to separate each abstraction or protocol component into its own class. The implementation of EMI or cEMI demonstrates this. The downside is a clear deviation from the DRY (Don't Repeat Yourself) principle, leaning more towards a WET approach (Write Everything Twice or We Enjoy Typing). The advantage, however, is that it is much easier to read, understand, and develop code that matches the official KNX specification documents. It is far simpler to prototype something like cEMI directly than to over-engineer it with DRY patterns, which often complicate debugging and error handling.

- Write comments that explain bit manipulation whenever possible or when the implementation is complex. A clear example of this is APCI; since 10 bits are written across two separate bytes, comments explaining the steps and components are highly recommended.
- Despite focusing on library performance, certain techniques are avoided for safety or ease of development. For instance, methods like `Buffer.allocUnsafe()` or dual-pointer buffer operations are discouraged.
- Avoid abbreviating variable and function names unless they are part of the official KNX specification.
- Do not create functions that perform bitwise operations; this creates confusion where it should be much simpler and more understandable to use operators like `&` or `|` or the `Buffer` methods.

---

## Development Setup

### Prerequisites

- **Node.js**: (e.g., Node.js v18 or newer recommended)
- **C/C++ Build Tools**: Required on some operating systems to compile native modules (`node-hid` and `serialport`).
  - **Linux**: `sudo apt-get install build-essential libudev-dev`
  - **macOS**: Xcode Command Line Tools.
  - **Windows**: Visual Studio Build Tools with C++ desktop workload.

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/Wesxt/KNX.ts.git
cd KNX.ts
npm install
```

### Building the Project

The project is compiled using the TypeScript compiler:

```bash
# Single compile
npm run build

# Watch mode for development
npm run watch
```

### Formatting & Linting

We enforce clean code styling using ESLint and Prettier. Please make sure your code passes checks before submitting:

```bash
# Run linting
npx eslint src/
```

> [!NOTE]
> Make sure your IDE (like VS Code) is configured to use the local `.prettierrc` configuration to format on save.

---

## Testing Guidelines

We have different levels of tests depending on whether you have access to physical KNX hardware.

### Running Unit Tests

Unit tests do not require physical hardware and mock communication channels. You can run them using Jest:

```bash
npm run test
```

### Running Stability & Integration Tests

These scripts run longer sessions to test connection robustness and sequencing, particularly for ETS gateway emulation:

```bash
# Test tunneling stability
npm run test:stability

# Test server tunneling stability
npm run test:server-stability
```

### Running Manual Hardware Tests

We have specific manual test scripts inside the `manual-tests/` directory to test interfaces.

> [!WARNING]
> Running these tests requires physical hardware (USB interface, TPUART adapter, IP Router/Interface) connected to your local network or machine.

You can run specific manual tests via `tsx`:

```bash
# Router manual test
npm run manualTest:router

# Tunneling connection manual test
npm run manualTest:tunneling

# Multicast routing manual test
npm run manualTest:routing

# USB HID interface manual test
npm run manualTest:usb

# USB routing manual test
npm run manualTest:routingUsb

# TPUART serial interface manual test
npm run manualTest:tpuart
```

---

## Project Directory Layout

Here is a quick overview of the key directories in the project:

- `src/`: Core TypeScript source files.
- `test/`: Automated test suites and stability testing frameworks.
- `manual-tests/`: Manual verification scripts using physical KNX equipment.
- `eslint.config.mjs` / `.prettierrc`: Linting and code styling configurations.
- `TODO.md`: Roadmap and experimental features currently in progress.

---

## Hardware & ETS Integration Testing

### KNXnetIPServer

- Ensure you do not have firewall rules blocking multicast/broadcast IP traffic.
- If you run into issues receiving messages, disable the `useAllInterfaces` option and/or check port availability.
- Clients must be on the same subnet to connect.
- KNX Router devices must be on the same broadcast IP network to route messages.
- Avoid configuring physical addresses for clients or the KNXnetIPServer itself that already exist in the active KNX topology.
- If you have USB, TPUART, or KNX IP Interface devices and want to route their telegrams through the `KNXnetIPServer`, use the `Router` class and configure the connections.
- The ETS software can discover the `KNXnetIPServer` automatically. Once connected, you can use Group Monitor, Bus Monitor (experimental/has bugs), Discover devices in programming mode, Discover individual address, Line scan, and Program/Deprogram devices.

### KNXTunneling

- You can connect to a KNX IP Interface or a KNX Router as long as they have available simultaneous connection slots.
- Always use the `disconnect()` method before stopping any service using `KNXTunneling` to release the slot on the KNXnet/IP device. This is particularly important for UDP connections (less critical for TCP).
- You can program devices through the tunnel as long as the connected KNXnet/IP device supports this capability.

### KNXUSB (USB HID)

- On Linux, you must join the `plugdev` group to gain permissions for USB HID devices. We recommend creating permanent `udev` rules.
- The `KNXUSB` interface will attempt to connect automatically to any USB device in its list of known manufacturers. If your device is not found, you must manually configure the vendor ID, product ID, and port path.
- Once connected, `KNXUSB` will detect if the device uses EMI or cEMI. After detection, it will start receiving messages. If the device uses EMI, incoming messages are automatically translated to cEMI, and outgoing cEMI messages are translated to EMI.

### TPUART

- If using a Raspberry Pi, enable the serial port in its configuration and disable Bluetooth to free up `/dev/ttyAMA0`.
- You must join the `dialout` group to obtain permissions for serial ports.
- Since TPUART typically uses EMI messages, outgoing messages are translated from cEMI to EMI, and incoming messages are translated from EMI to cEMI.
- Note that the connection baudrate used for TPUART is 19200, even though the KNX bus runs at 9600. For reasons unknown, this configuration was necessary to prevent message parsing issues. If you experience problems, try adjusting this baudrate.
