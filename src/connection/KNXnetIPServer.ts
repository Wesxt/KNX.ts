import dgram from "dgram";
import net from "node:net";
import crypto from "node:crypto";
import { KNXService } from "./KNXService";
import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import {
  KNXnetIPServiceType,
  KNXMedium,
  HostProtocolCode,
  KNXnetIPErrorCodes,
  ConnectionType,
  AllowedSupportedServiceFamilies,
  KNXLayer,
  KNXTimeoutConstants,
} from "../core/enum/KNXnetIPEnum";
import { CEMI, CEMIInstance } from "../core/CEMI";
import {
  RoutingBusy,
  RoutingLostMessage,
  HPAI,
  DIB,
  DeviceInformationDIB,
  SupportedServicesDIB,
  SecuredServiceFamiliesDIB,
  ExtendedDeviceInformationDIB,
  IPConfigDIB,
  IPCurrentConfigDIB,
  TunnellingInfoDIB,
  CRI,
  CRD,
  StatusTunnelingSlot,
} from "../core/KNXnetIPStructures";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { KNXHelper } from "../utils/KNXHelper";
import { KNXDiscoveredDevice, KNXnetIPServerOptions } from "../@types/interfaces/connection";
import { getNetworkInfo } from "../utils/localIp";
import os from "node:os";
import { DeviceDescriptorType0 } from "../core/resources/DeviceDescriptorType";
import { TunnelConnection, TunnelTransportTarget } from "./TunnelConnection";
import { InvalidKnxAddressException } from "../errors/InvalidKnxAddresExeption";
import { GroupAddressCache } from "../core/cache/GroupAddressCache";
import { FSM } from "./FSM";
import { SecureRoutingTimer } from "./SecureRoutingTimer";
import { KnxKeyring } from "../security/KnxKeyring";
import { TcpFrameReader } from "./TcpFrameReader";
import { ServerSecureSession, ServerSecureSessionState } from "./ServerSecureSession";
import { SecureWrapper, SessionRequest } from "../core/KNXnetIPSecureStructures";
import { deriveDeviceAuthenticationCode, deriveUserPasswordKey } from "../security/KnxSecureKeys";

/**
 * States for the KNXnetIPServer Finite State Machine.
 */
export enum KNXServerState {
  STOPPED = "STOPPED",
  STARTING = "STARTING",
  RUNNING = "RUNNING",
  FAULTED = "FAULTED",
}

/**
 * Events triggering transitions in the KNXnetIPServer FSM.
 */
export enum KNXServerEvent {
  START = "START",
  STOP = "STOP",
  RUNNING = "RUNNING",
  ERROR = "ERROR",
}

interface TcpClientContext {
  id: string;
  socket: net.Socket;
  remoteAddress: string;
  remotePort: number;
  frameReader: TcpFrameReader;
  sessions: Map<number, ServerSecureSession>;
  idleTimer: NodeJS.Timeout | null;
  closed: boolean;
}

interface RequestContext {
  transport: "udp" | "tcp";
  remoteAddress: string;
  remotePort: number;
  rinfo?: dgram.RemoteInfo;
  tcpContext?: TcpClientContext;
  secureSession?: ServerSecureSession;
  secureUserId?: number;
  sendToEndpoint: (buf: Buffer, hpai?: HPAI) => void;
}

/**
 * Implements a KNXnet/IP Server (Gateway) that supports Routing and Tunneling protocols
 * over UDP and TCP, including KNXnet/IP Secure (Multicast Routing & Unicast TCP Sessions).
 * This class handles device discovery (Search/Description), manages multiple concurrent
 * tunneling connections, and bridges communication between IP multicast (Routing) and
 * point-to-point (Tunneling) clients. It includes implementation for flow control
 * (RoutingBusy), rate limiting, and echo cancellation.
 */
export class KNXnetIPServer extends KNXService<KNXnetIPServerOptions> {
  private fsm: FSM<KNXServerState, KNXServerEvent>;
  private isRoutingBusy: boolean = false;
  private routingBusyTimer: NodeJS.Timeout | null = null;
  private msgQueue: Buffer[] = [];
  private isProcessingQueue: boolean = false;
  private lastSentTime: number = 0;

  private busyCounter: number = 0; // N for random wait time calculation
  private lastBusyTime: number = 0;
  private decrementTimer: NodeJS.Timeout | null = null;
  private decrementInterval: NodeJS.Timeout | null = null;

  // [MEJORA] Almacenamos la IA en formato entero para el filtro anti-eco rápido
  private serverIAInt: number;

  private _tunnelConnections = new Map<number, TunnelConnection>();

  private tcpServer: net.Server | null = null;
  private tcpClients = new Map<string, TcpClientContext>();
  private tcpClientCounter: number = 0;
  private _udpPort: number = 0;
  private _tcpPort: number = 0;
  private readonly tcpEnabled: boolean;
  private readonly tcpIdleTimeoutMs: number;
  private readonly allowPlainTcp: boolean;

  private readonly userPasswordHashes = new Map<number, Buffer>();
  private deviceAuthenticationCode: Buffer | null = null;
  private readonly sessionAuthTimeoutMs: number;
  private readonly sessionTimeoutMs: number;

  private readonly MAX_QUEUE_SIZE = 100;
  private readonly BUSY_THRESHOLD = 15;
  private readonly HEARTBEAT_TIMEOUT = KNXTimeoutConstants.CONNECTION_ALIVE_TIME * 1000;
  private readonly RETRANSMIT_TIMEOUT = KNXTimeoutConstants.TUNNELING_REQUEST_TIMEOUT * 1000;
  private MAX_PENDING_REQUESTS_PER_CLIENT = 100; // [MEJORA] Límite de ráfagas
  private ignoreACKTimeout: boolean;
  private maxTunnelConnections: number;
  private clientAddrsStartInt: number;
  private secureRoutingTimer: SecureRoutingTimer | null = null;

  constructor(options: KNXnetIPServerOptions) {
    super(options);
    this._transport = "UDP";

    // Initialize FSM
    this.fsm = new FSM<KNXServerState, KNXServerEvent>(
      KNXServerState.STOPPED,
      {
        [KNXServerState.STOPPED]: {
          [KNXServerEvent.START]: KNXServerState.STARTING,
        },
        [KNXServerState.STARTING]: {
          [KNXServerEvent.RUNNING]: KNXServerState.RUNNING,
          [KNXServerEvent.ERROR]: KNXServerState.FAULTED,
          [KNXServerEvent.STOP]: KNXServerState.STOPPED,
        },
        [KNXServerState.RUNNING]: {
          [KNXServerEvent.ERROR]: KNXServerState.FAULTED,
          [KNXServerEvent.STOP]: KNXServerState.STOPPED,
        },
        [KNXServerState.FAULTED]: {
          [KNXServerEvent.START]: KNXServerState.STARTING,
          [KNXServerEvent.STOP]: KNXServerState.STOPPED,
        },
      },
      (newState, oldState) => this.handleStateChange(newState, oldState),
    );

    // Set defaults for discovery if not provided
    const routingOptions = this.options;
    const netInfo = getNetworkInfo();
    this.options.ip = options.ip || "224.0.23.12";
    this.options.port = options.port ?? 3671;
    this.options.localIp = options.localIp || netInfo.address;
    this.tcpEnabled = options.tcp ?? true;
    this.tcpIdleTimeoutMs = options.tcpIdleTimeoutMs ?? 10000;
    this.allowPlainTcp = options.allowPlainTcp ?? true;
    this.sessionAuthTimeoutMs = options.secure?.sessionAuthenticationTimeoutMs ?? 10000;
    this.sessionTimeoutMs = options.secure?.sessionTimeoutMs ?? 60000;
    routingOptions.individualAddress = options.individualAddress || "15.15.0";
    this.individualAddress = routingOptions.individualAddress;
    if (!KNXHelper.isValidIndividualAddress(routingOptions.individualAddress)) {
      throw new InvalidKnxAddressException(`This ${routingOptions.individualAddress} is not individual address`);
    }

    // Setup options for clients who do not comply with the rules
    this.ignoreACKTimeout = options.ignoreACKTimeout ?? false;

    // Setup Logger
    this.logger = this.logger.child({ module: this.constructor.name });

    // Serial must be deterministic and unique per instance (MAC + Port), similar to knxd
    if (!options.serialNumber) {
      // eslint-disable-next-line no-useless-escape
      const macBuf = Buffer.from(netInfo.mac.replace(/[:\-]/g, ""), "hex");
      const port = this.options.port;
      const serial = Buffer.from(macBuf);
      serial[0] ^= (port >> 8) & 0xff;
      serial[1] ^= port & 0xff;
      routingOptions.serialNumber = serial;
    } else {
      routingOptions.serialNumber = options.serialNumber;
    }

    routingOptions.friendlyName = options.friendlyName || "KNX.ts";
    routingOptions.macAddress = options.macAddress || netInfo.mac;
    routingOptions.routingDelay = options.routingDelay ?? 20;
    if (routingOptions.MAX_PENDING_REQUESTS_PER_CLIENT)
      this.MAX_PENDING_REQUESTS_PER_CLIENT = routingOptions.MAX_PENDING_REQUESTS_PER_CLIENT;

    this.logger.info(`Initialized on ${this.options.localIp}:${this.options.port}`);
    this.logger.info(`Serial Number: ${routingOptions.serialNumber.toString("hex").toUpperCase()}`);

    const serverIA = KNXHelper.GetAddress(routingOptions.individualAddress, ".").readUInt16BE();
    this.serverIAInt = serverIA;

    if (options.clientAddrs) {
      const parts = options.clientAddrs.split(":");
      if (parts.length === 2) {
        this.clientAddrsStartInt = KNXHelper.GetAddress(parts[0], ".").readUInt16BE();
        this.maxTunnelConnections = parseInt(parts[1], 10);
      } else {
        this.maxTunnelConnections = 15;
        this.clientAddrsStartInt = serverIA + 1;
      }
    } else {
      this.maxTunnelConnections = 15;
      this.clientAddrsStartInt = serverIA + 1;
    }

    if (options.secure) {
      let backboneKey = options.secure.backboneKey;
      let latencyMs = options.secure.multicastLatencyToleranceMs;
      let keyring: KnxKeyring | null = null;
      if (options.secure.keyringFile) {
        keyring = KnxKeyring.fromSource(options.secure.keyringFile, options.secure.keyringPassword ?? "");
        const bb = keyring.getBackbone();
        if (!backboneKey && bb?.decryptedKey) {
          backboneKey = bb.decryptedKey;
        }
        if (latencyMs === undefined && bb?.latency !== undefined) {
          latencyMs = bb.latency;
        }
      }

      this.initUnicastSecurityCredentials(keyring);

      if (backboneKey) {
        this.secureRoutingTimer = new SecureRoutingTimer({
          backboneKey,
          serialNumber: options.secure.serialNumber ?? routingOptions.serialNumber,
          latencyToleranceMs: latencyMs,
          onSendTimerNotify: (notifyFrame) => {
            if (this.socket) {
              (this.socket as dgram.Socket).send(notifyFrame, this.routingSendPort, this.options.ip!, (err) => {
                if (err) this.emit("error", err);
              });
            }
          },
        });
      }
    }
  }

  private resolveKey16(input: string | Buffer, type: "user" | "device"): Buffer {
    if (Buffer.isBuffer(input)) {
      if (input.length !== 16) {
        throw new Error(`Invalid pre-derived ${type} key length: ${input.length} (expected 16)`);
      }
      return Buffer.from(input);
    }
    return type === "user" ? deriveUserPasswordKey(input) : deriveDeviceAuthenticationCode(input);
  }

  private initUnicastSecurityCredentials(keyring: KnxKeyring | null): void {
    const sec = this.options.secure;
    if (!sec) return;

    if (keyring) {
      const targetIa = sec.tunnelInterfaceAddress;
      for (const [, iface] of keyring.getInterfaces()) {
        if (targetIa && iface.individualAddress !== targetIa) continue;
        if (iface.userId !== undefined && iface.decryptedPassword) {
          this.userPasswordHashes.set(iface.userId, this.resolveKey16(iface.decryptedPassword, "user"));
        }
        if (!this.deviceAuthenticationCode && iface.decryptedAuthentication) {
          this.deviceAuthenticationCode = this.resolveKey16(iface.decryptedAuthentication, "device");
        }
      }
    }

    if (sec.users) {
      const entries =
        sec.users instanceof Map ? Array.from(sec.users.entries()) : Object.entries(sec.users).map(([k, v]) => [Number(k), v] as const);
      for (const [uid, pwd] of entries) {
        if (uid >= 1 && uid <= 0x7f) {
          this.userPasswordHashes.set(uid, this.resolveKey16(pwd, "user"));
        }
      }
    }

    if (sec.userPassword !== undefined) {
      const uid = sec.userId ?? 2;
      this.userPasswordHashes.set(uid, this.resolveKey16(sec.userPassword, "user"));
    }

    if (sec.deviceAuthenticationPassword !== undefined) {
      this.deviceAuthenticationCode = this.resolveKey16(sec.deviceAuthenticationPassword, "device");
    }

    if (this.userPasswordHashes.size > 0 && !this.deviceAuthenticationCode) {
      this.deviceAuthenticationCode = Buffer.alloc(16, 0);
    }
  }

  private get hasUnicastSecurity(): boolean {
    return this.userPasswordHashes.size > 0;
  }

  /**
   * Returns the active TCP listening port (or UDP port if TCP is disabled).
   */
  public get listeningPort(): number {
    return this._tcpPort || this._udpPort || (this.options.port ?? 3671);
  }

  /**
   * Returns the bound TCP port, or 0 if TCP listener is not running.
   */
  public get tcpListeningPort(): number {
    return this._tcpPort;
  }

  /**
   * Returns the bound UDP port, or 0 if UDP socket is not bound.
   */
  public get udpListeningPort(): number {
    return this._udpPort;
  }

  /**
   * Returns the current FSM state as a string.
   */
  public get connectionState(): string {
    return this.fsm.state;
  }

  async connect(): Promise<void> {
    if (this.fsm.state === KNXServerState.RUNNING) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const onRunning = () => {
        this.removeListener("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        this.removeListener("connected", onRunning);
        reject(err);
      };
      this.once("connected", onRunning);
      this.once("error", onError);

      this.fsm.transition(KNXServerEvent.START);
    });
  }

  private isMulticastIp(ip?: string): boolean {
    if (!ip) return false;
    const parts = ip.split(".");
    if (parts.length !== 4) return false;
    const first = Number(parts[0]);
    return Number.isInteger(first) && first >= 224 && first <= 239;
  }

  private async performConnect(): Promise<void> {
    if (this.socket || this.tcpServer) {
      return;
    }

    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this.socket.on("message", (msg, rinfo) => {
      this.handleMessage(msg, rinfo);
    });

    this.socket.on("error", (err) => {
      this.fsm.transition(KNXServerEvent.ERROR);
      this.emit("error", err);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const socket = this.socket as dgram.Socket;
        const onBindError = (err: Error) => {
          reject(err);
        };
        socket.once("error", onBindError);
        socket.bind(this.options.port ?? 3671, () => {
          socket.removeListener("error", onBindError);
          try {
            this._udpPort = socket.address().port;
            socket.setBroadcast(true);
            socket.setMulticastTTL(128);
            socket.setMulticastLoopback(true);

            if (this.isMulticastIp(this.options.ip)) {
              const interfaces = os.networkInterfaces();
              const joinedInterfaces = new Set<string>();
              const useAllInterfaces = this.options.useAllInterfaces ?? true;

              if (this.options.localIp && this.options.localIp !== "0.0.0.0" && this.options.ip) {
                try {
                  socket.addMembership(this.options.ip, this.options.localIp);
                  joinedInterfaces.add(this.options.localIp);
                  this.logger.info(`Joined multicast on primary interface (${this.options.ip})`);
                } catch (e) {
                  this.logger.debug(`Failed to join multicast on primary interface ${this.options.localIp}`, e);
                }
              }

              if (useAllInterfaces) {
                for (const name of Object.keys(interfaces)) {
                  for (const iface of interfaces[name]!) {
                    if (iface.family === "IPv4" && !iface.internal) {
                      if (!joinedInterfaces.has(iface.address)) {
                        try {
                          socket.addMembership(this.options.ip as string, iface.address);
                          joinedInterfaces.add(iface.address);
                          this.logger.info(`Joined multicast on interface ${name} (${iface.address})`);
                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        } catch (err) {
                          // Ignora interfaces virtuales que no soportan IGMP
                        }
                      }
                    }
                  }
                }
              } else {
                this.logger.info("Multi-homing disabled. Only primary interface used for multicast.");
              }
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      if (this.tcpEnabled) {
        await this.startTcpServer();
      }

      if (this.secureRoutingTimer) {
        this.secureRoutingTimer.start(true);
      }

      this.fsm.transition(KNXServerEvent.RUNNING);
    } catch (err) {
      this.closeServer();
      this.fsm.transition(KNXServerEvent.ERROR);
      throw err;
    }
  }

  private async startTcpServer(): Promise<void> {
    const desiredPort = this.options.tcpPort ?? (this._udpPort || this.options.port || 3671);
    const bindHost = this.options.tcpHost ?? "0.0.0.0";

    const server = net.createServer((socket) => {
      this.handleTcpConnection(socket);
    });
    this.tcpServer = server;

    server.on("error", (err) => {
      this.logger.error(`TCP server error: ${err.message}`);
      this.emit("error", err);
    });

    await new Promise<void>((resolve, reject) => {
      const onListenError = (err: Error) => {
        server.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onListenError);
        const addr = server.address();
        this._tcpPort = typeof addr === "object" && addr ? addr.port : desiredPort;
        this.logger.info(`TCP server listening on ${bindHost}:${this._tcpPort}`);
        resolve();
      };
      server.once("error", onListenError);
      server.once("listening", onListening);
      server.listen(desiredPort, bindHost);
    });
  }

  disconnect(): void {
    this.fsm.transition(KNXServerEvent.STOP);
  }

  private closeServer(): void {
    if (this.secureRoutingTimer) {
      this.secureRoutingTimer.stop();
    }
    for (const ctx of Array.from(this.tcpClients.values())) {
      this.cleanupTcpContext(ctx);
    }
    this.tcpClients.clear();

    if (this.tcpServer) {
      try {
        this.tcpServer.close();
      } catch {
        /* Ignore */
      }
      this.tcpServer = null;
    }
    this._tcpPort = 0;

    if (this.socket) {
      try {
        (this.socket as dgram.Socket).close();
      } catch {
        /* Ignore */
      }
      this.socket = null;
    }
    this._udpPort = 0;
    this.clearTimers();
  }

  private async handleStateChange(newState: KNXServerState, oldState: KNXServerState): Promise<void> {
    this.logger.info(`FSM: State transition from ${oldState} to ${newState}`);

    switch (newState) {
      case KNXServerState.STARTING:
        try {
          await this.performConnect();
        } catch (err: any) {
          this.emit("error", err);
        }
        break;

      case KNXServerState.RUNNING:
        this.emit("connected");
        break;

      case KNXServerState.STOPPED:
      case KNXServerState.FAULTED:
        this.closeServer();
        this.emit("disconnected");
        break;
    }
  }

  /**
   * Discovers KNXnet/IP devices on the network by sending SEARCH_REQUEST and SEARCH_REQUEST_EXTENDED
   * multicasts to 224.0.23.12:3671. Returns an array of discovered devices with their properties.
   *
   * @param timeout Wait time in milliseconds for responses
   * @param useExtended Whether to send SEARCH_REQUEST_EXTENDED alongside SEARCH_REQUEST
   * @returns Promise resolving to an array of discovered devices
   */
  public static async discover(
    ipLocal: string = "",
    ipMulticast: string = "224.0.23.12",
    port: number = 3671,
    timeout: number = 3000,
    useExtended: boolean = true,
  ): Promise<KNXDiscoveredDevice[]> {
    return new Promise<KNXDiscoveredDevice[]>((resolve, reject) => {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      const discoveredDevices = new Map<string, KNXDiscoveredDevice>();

      socket.on("message", (msg: Buffer) => {
        try {
          const header = KNXnetIPHeader.fromBuffer(msg);
          if (
            header.serviceType === KNXnetIPServiceType.SEARCH_RESPONSE ||
            header.serviceType === KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED
          ) {
            const body = msg.subarray(KNXnetIPHeader.HEADER_SIZE_10);
            if (body.length < 8) return;
            const hpai = HPAI.fromBuffer(body);
            let offset = 8; // Size of HPAI

            let deviceInfo: DeviceInformationDIB | null = null;
            while (offset < body.length) {
              const dibLen = body.readUInt8(offset);
              if (dibLen === 0) break;
              if (offset + dibLen > body.length) break;
              const dibBuffer = body.subarray(offset, offset + dibLen);
              const dib = DIB.fromBuffer(dibBuffer);
              if (dib instanceof DeviceInformationDIB) {
                deviceInfo = dib;
              }
              offset += dibLen;
            }

            if (deviceInfo) {
              const deviceKey = `${hpai.ipAddress}:${hpai.port}`; // Unique by IP/Port
              if (!discoveredDevices.has(deviceKey)) {
                let knxMediumStr = `Unknown (${deviceInfo.knxMedium})`;
                if (deviceInfo.knxMedium === KNXMedium.TP1) knxMediumStr = "TP1";
                else if (deviceInfo.knxMedium === KNXMedium.PL110) knxMediumStr = "PL110";
                else if (deviceInfo.knxMedium === KNXMedium.RF) knxMediumStr = "RF";
                else if (deviceInfo.knxMedium === KNXMedium.KNXIP) knxMediumStr = "KNXIP";

                const deviceStatusStr =
                  deviceInfo.deviceStatus === 1
                    ? "Programmed"
                    : deviceInfo.deviceStatus === 0
                      ? "Not Programmed"
                      : `Unknown (${deviceInfo.deviceStatus})`;

                discoveredDevices.set(deviceKey, {
                  ip: hpai.ipAddress,
                  port: hpai.port,
                  knxMediumRaw: deviceInfo.knxMedium,
                  knxMedium: knxMediumStr,
                  deviceStatusRaw: deviceInfo.deviceStatus,
                  deviceStatus: deviceStatusStr,
                  individualAddress: deviceInfo.individualAddress,
                  projectInstallationId: deviceInfo.projectInstallationId,
                  serialNumber: deviceInfo.serialNumber,
                  routingMulticastAddress: deviceInfo.routingMulticastAddress,
                  macAddress: deviceInfo.macAddress,
                  friendlyName: deviceInfo.friendlyName,
                });
              }
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          // Ignore parsing errors for individual packets
        }
      });

      const timer: NodeJS.Timeout = setTimeout(() => {
        socket.close();
        resolve(Array.from(discoveredDevices.values()));
      }, timeout);

      socket.on("error", (err) => {
        clearTimeout(timer);
        socket.close();
        reject(err);
      });

      socket.bind(0, () => {
        const netInfo = getNetworkInfo();
        const serverHPAI = new HPAI(
          HostProtocolCode.IPV4_UDP,
          ipLocal !== "" ? ipLocal : netInfo.address,
          socket.address().port,
        );

        const sendRequest = (serviceType: KNXnetIPServiceType) => {
          const hpaiBuf = serverHPAI.toBuffer();
          const header = new KNXnetIPHeader(serviceType, KNXnetIPHeader.HEADER_SIZE_10 + hpaiBuf.length);
          const packet = Buffer.concat([header.toBuffer(), hpaiBuf]);
          socket.send(packet, port, ipMulticast);
        };

        try {
          socket.setBroadcast(true);
          socket.setMulticastTTL(128);
          sendRequest(KNXnetIPServiceType.SEARCH_REQUEST);
          if (useExtended) {
            sendRequest(KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED);
          }
        } catch (e) {
          clearTimeout(timer);
          socket.close();
          reject(e);
        }
      });
    });
  }

  // [MEJORA] Validación estricta Route Back (NAT Traversal) según Especificación 8.6.2.2
  private resolveRouteBack(hpai: HPAI, rinfo: dgram.RemoteInfo): boolean {
    const isIpZero = hpai.ipAddress === "0.0.0.0";
    const isPortZero = hpai.port === 0;

    if (isIpZero && isPortZero) {
      // Modo "Route Back" válido
      hpai.ipAddress = rinfo.address;
      hpai.port = rinfo.port;
      return true;
    } else if (isIpZero || isPortZero) {
      // Si solo UNO de los dos es 0, es un HPAI INVÁLIDO según la spec.
      return false;
    }
    // Es un HPAI estándar, se queda tal cual
    return true;
  }

  private clearTimers() {
    if (this.routingBusyTimer) clearTimeout(this.routingBusyTimer);
    if (this.decrementTimer) clearTimeout(this.decrementTimer);
    if (this.decrementInterval) clearInterval(this.decrementInterval);
    this.routingBusyTimer = null;
    this.decrementTimer = null;
    this.decrementInterval = null;

    this._tunnelConnections.forEach((conn) => {
      conn.close();
    });
    this._tunnelConnections.clear();
    this.removeAllListeners();
  }

  private handleTcpConnection(socket: net.Socket): void {
    socket.setNoDelay(true);
    const id = `tcp-${++this.tcpClientCounter}`;
    const rawAddr = socket.remoteAddress || "0.0.0.0";
    const remoteAddress = rawAddr.startsWith("::ffff:") ? rawAddr.slice(7) : rawAddr;
    const remotePort = socket.remotePort || 0;

    const ctx: TcpClientContext = {
      id,
      socket,
      remoteAddress,
      remotePort,
      frameReader: new TcpFrameReader(),
      sessions: new Map<number, ServerSecureSession>(),
      idleTimer: null,
      closed: false,
    };
    this.tcpClients.set(id, ctx);
    this.logger.debug(`Accepted TCP connection ${id} from ${remoteAddress}:${remotePort}`);
    this.refreshTcpIdleTimer(ctx);

    socket.on("data", (chunk: Buffer | string) => {
      if (ctx.closed) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      let frames: Buffer[];
      try {
        frames = ctx.frameReader.push(buf);
      } catch (err: any) {
        this.logger.warn(`Closing TCP connection ${id} due to invalid frame stream: ${err?.message ?? err}`);
        this.cleanupTcpContext(ctx);
        return;
      }

      for (const frame of frames) {
        if (ctx.closed) break;
        try {
          this.handleTcpFrame(ctx, frame);
        } catch (err: any) {
          this.logger.error(`Error handling TCP frame on ${id}: ${err?.message ?? err}`);
          this.emit("error", err);
        }
      }
      this.refreshTcpIdleTimer(ctx);
    });

    socket.on("end", () => {
      // 03_08_02 §8.4.3.5: half-closed TCP connection shall be terminated and inner channels discarded
      this.logger.debug(`TCP client ${id} initiated half-close (FIN)`);
      this.cleanupTcpContext(ctx);
    });

    socket.on("close", () => {
      this.cleanupTcpContext(ctx);
    });

    socket.on("error", (err) => {
      this.logger.debug(`TCP socket ${id} error: ${err.message}`);
      this.cleanupTcpContext(ctx);
    });
  }

  private hasActiveTcpWork(ctx: TcpClientContext): boolean {
    if (ctx.sessions.size > 0) return true;
    for (const conn of this._tunnelConnections.values()) {
      if (conn.tcpConnectionId === ctx.id) return true;
    }
    return false;
  }

  private refreshTcpIdleTimer(ctx?: TcpClientContext): void {
    if (!ctx) return;
    if (ctx.idleTimer) {
      clearTimeout(ctx.idleTimer);
      ctx.idleTimer = null;
    }
    if (ctx.closed || this.hasActiveTcpWork(ctx) || this.tcpIdleTimeoutMs <= 0) {
      return;
    }
    ctx.idleTimer = setTimeout(() => {
      ctx.idleTimer = null;
      if (!ctx.closed && !this.hasActiveTcpWork(ctx)) {
        this.logger.debug(`Closing idle TCP connection ${ctx.id} after ${this.tcpIdleTimeoutMs} ms`);
        this.cleanupTcpContext(ctx);
      }
    }, this.tcpIdleTimeoutMs);
  }

  private cleanupTcpContext(ctx: TcpClientContext): void {
    if (ctx.closed) return;
    ctx.closed = true;

    if (ctx.idleTimer) {
      clearTimeout(ctx.idleTimer);
      ctx.idleTimer = null;
    }

    for (const session of Array.from(ctx.sessions.values())) {
      session.forceClose();
    }
    ctx.sessions.clear();

    // Close any remaining plain TCP channels bound to this socket without DISCONNECT_REQUEST
    for (const [cid, conn] of Array.from(this._tunnelConnections.entries())) {
      if (conn.tcpConnectionId === ctx.id) {
        this.closeConnection(cid, false);
      }
    }

    ctx.frameReader.reset();
    this.tcpClients.delete(ctx.id);
    if (!ctx.socket.destroyed) {
      ctx.socket.destroy();
    }
  }

  private closeChannelsForSession(tcpConnectionId: string, sessionId: number): void {
    for (const [cid, conn] of Array.from(this._tunnelConnections.entries())) {
      if (conn.tcpConnectionId === tcpConnectionId && conn.secureSessionId === sessionId) {
        this.closeConnection(cid, false);
      }
    }
  }

  private allocateSecureSessionId(ctx: TcpClientContext): number | null {
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = crypto.randomInt(1, 0x10000);
      if (!ctx.sessions.has(candidate)) {
        return candidate;
      }
    }
    for (let id = 1; id <= 0xffff; id++) {
      if (!ctx.sessions.has(id)) {
        return id;
      }
    }
    return null;
  }

  private handleTcpFrame(ctx: TcpClientContext, frame: Buffer): void {
    const header = KNXnetIPHeader.fromBuffer(frame);

    if (header.serviceType === KNXnetIPServiceType.SESSION_REQUEST) {
      if (!this.hasUnicastSecurity) {
        this.logger.debug(`Ignoring SESSION_REQUEST on ${ctx.id}: server has no unicast security credentials`);
        return;
      }
      let req: SessionRequest;
      try {
        req = SessionRequest.fromBuffer(frame, true);
      } catch (err: any) {
        this.logger.warn(`Discarding invalid SESSION_REQUEST on ${ctx.id}: ${err?.message ?? err}`);
        return;
      }

      const sessionId = this.allocateSecureSessionId(ctx);
      if (sessionId === null) {
        this.logger.warn(`Discarding SESSION_REQUEST on ${ctx.id}: no free session IDs`);
        return;
      }

      const session = new ServerSecureSession({
        sessionId,
        serverSerial: this.options.serialNumber!,
        deviceAuthenticationCode: this.deviceAuthenticationCode ?? Buffer.alloc(16, 0),
        userPasswordHashes: this.userPasswordHashes,
        authenticationTimeoutMs: this.sessionAuthTimeoutMs,
        sessionTimeoutMs: this.sessionTimeoutMs,
        onSend: (outFrame) => {
          if (!ctx.closed && !ctx.socket.destroyed) {
            ctx.socket.write(outFrame);
          }
        },
        onCloseChannels: (sid) => this.closeChannelsForSession(ctx.id, sid),
        onDeallocate: (sid) => {
          ctx.sessions.delete(sid);
          this.refreshTcpIdleTimer(ctx);
        },
        parentLogger: this.logger,
      });

      ctx.sessions.set(sessionId, session);
      this.refreshTcpIdleTimer(ctx);

      const responseFrame = session.start(req.clientPublicKey);
      if (!ctx.closed && !ctx.socket.destroyed) {
        ctx.socket.write(responseFrame);
      }
      return;
    }

    if (header.serviceType === KNXnetIPServiceType.SECURE_WRAPPER) {
      if (!this.hasUnicastSecurity) return;

      let wrapperInfo: ReturnType<typeof SecureWrapper.parseHeader>;
      try {
        wrapperInfo = SecureWrapper.parseHeader(frame);
      } catch (err: any) {
        this.logger.warn(`Discarding malformed SECURE_WRAPPER on ${ctx.id}: ${err?.message ?? err}`);
        return;
      }
      if (wrapperInfo.sessionId === 0) return;

      const session = ctx.sessions.get(wrapperInfo.sessionId);
      if (!session) {
        this.logger.debug(`Ignoring SECURE_WRAPPER for unknown session 0x${wrapperInfo.sessionId.toString(16)}`);
        return;
      }

      const authResult = session.handleWrappedFrame(frame);
      if (!authResult) return;

      const reqCtx: RequestContext = {
        transport: "tcp",
        remoteAddress: ctx.remoteAddress,
        remotePort: ctx.remotePort,
        tcpContext: ctx,
        secureSession: session,
        secureUserId: authResult.userId,
        sendToEndpoint: (buf: Buffer) => {
          if (ctx.closed || ctx.socket.destroyed || session.state !== ServerSecureSessionState.AUTHENTICATED) return;
          try {
            ctx.socket.write(session.wrap(buf));
          } catch (err: any) {
            this.logger.debug(`Failed writing wrapped frame on ${ctx.id}: ${err?.message ?? err}`);
          }
        },
      };

      this.dispatchUnicastFrame(authResult.innerFrame, reqCtx);
      return;
    }

    // Plaintext KNXnet/IP frame on TCP
    if (!this.allowPlainTcp && header.serviceType !== KNXnetIPServiceType.DESCRIPTION_REQUEST) {
      if (header.serviceType === KNXnetIPServiceType.CONNECT_REQUEST) {
        const errResp = Buffer.concat([
          new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_RESPONSE, 8).toBuffer(),
          Buffer.from([0x00, KNXnetIPErrorCodes.E_AUTHORISATION_ERROR]),
        ]);
        if (!ctx.closed && !ctx.socket.destroyed) {
          ctx.socket.write(errResp);
        }
      } else {
        this.logger.debug(`Ignoring plaintext service 0x${header.serviceType.toString(16)} on ${ctx.id} (allowPlainTcp=false)`);
      }
      return;
    }

    const reqCtx: RequestContext = {
      transport: "tcp",
      remoteAddress: ctx.remoteAddress,
      remotePort: ctx.remotePort,
      tcpContext: ctx,
      sendToEndpoint: (buf: Buffer) => {
        if (!ctx.closed && !ctx.socket.destroyed) {
          ctx.socket.write(buf);
        }
      },
    };
    this.dispatchUnicastFrame(frame, reqCtx);
  }

  /**
   * Send a CEMI message or buffer CEMI to the bus.
   * @param data The CEMI message or buffer to send.
   */
  async send(data: Buffer | CEMIInstance): Promise<void> {
    let cemiBuffer: Buffer;
    let cemi: CEMIInstance | undefined = undefined;
    if (Buffer.isBuffer(data)) {
      cemiBuffer = data;
      try {
        cemi = CEMI.fromBuffer(data);
        if ("controlField2" in cemi) {
          const cf2 = cemi.controlField2 as ExtendedControlField;
          const hopCount = cf2.hopCount;
          if (hopCount === 0) return;
          if (hopCount < 7) cf2.hopCount = hopCount - 1;
        }
      } catch (e: any) {
        this.logger.debug("Error parsing CEMI buffer" + e.message);
      }
    } else {
      cemi = data;
      if ("controlField2" in cemi) {
        const cf2 = cemi.controlField2 as ExtendedControlField;
        const hopCount = cf2.hopCount;
        if (hopCount === 0) return;
        if (hopCount < 7) cf2.hopCount = hopCount - 1;
      }
      cemiBuffer = data.toBuffer();
    }

    if (cemi) {
      this.emit("send", cemi);
      if (!this.isCacheDelegated) {
        GroupAddressCache.getInstance().processCEMI(cemi);
      }
      if (!this.isEventsDelegated && "destinationAddress" in cemi) {
        this.emit(cemi.destinationAddress, cemi);
      }
      const body = cemiBuffer;
      const srcIAStr = "sourceAddress" in cemi ? cemi.sourceAddress : "";
      let busmonBody: Buffer | null = null;
      this._tunnelConnections.forEach((conn) => {
        // Echo cancellation: Don't forward back to the client that originated this message
        if (srcIAStr === conn.knxAddressStr) {
          return;
        }

        if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER) {
          if (!busmonBody) busmonBody = this.convertDataIndToBusmonInd(body);
          conn.enqueue(busmonBody, KNXnetIPServiceType.TUNNELLING_REQUEST);
        } else {
          // Link Layer or Raw Layer
          conn.enqueue(body, KNXnetIPServiceType.TUNNELLING_REQUEST);
        }
      });
    }

    await this.enqueuePacket(cemiBuffer);
  }

  /**
   * Send a raw CEMI buffer to the bus.
   * @param cemiBuffer The CEMI buffer to send.
   */
  async sendRaw(cemiBuffer: Buffer): Promise<void> {
    let cemi: CEMIInstance | undefined = undefined;
    try {
      cemi = CEMI.fromBuffer(cemiBuffer);
    } catch (e: any) {
      this.logger.debug("Error parsing CEMI buffer" + e.message);
    }
    if (!cemi) return;
    this.emit("send", cemi);
    if (!this.isEventsDelegated && "destinationAddress" in cemi) {
      this.emit(cemi.destinationAddress, cemi);
    }
    const body = cemiBuffer;
    const srcIAStr = "sourceAddress" in cemi ? cemi.sourceAddress : "";
    let busmonBody: Buffer | null = null;
    this._tunnelConnections.forEach((conn) => {
      // Echo cancellation: Don't forward back to the client that originated this message
      if (srcIAStr === conn.knxAddressStr) {
        return;
      }

      if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER) {
        if (!busmonBody) busmonBody = this.convertDataIndToBusmonInd(body);
        conn.enqueue(busmonBody, KNXnetIPServiceType.TUNNELLING_REQUEST);
      } else {
        // Link Layer or Raw Layer
        conn.enqueue(body, KNXnetIPServiceType.TUNNELLING_REQUEST);
      }
    });
    await this.enqueuePacket(cemiBuffer);
  }

  private async enqueuePacket(cemiBuffer: Buffer): Promise<void> {
    if (this.msgQueue.length >= this.MAX_QUEUE_SIZE) {
      this.sendLostMessage(1);
      this.emit("queue_overflow");
      return;
    }

    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_INDICATION, 0);
    header.totalLength = KNXnetIPHeader.HEADER_SIZE_10 + cemiBuffer.length;
    const packet = Buffer.concat([header.toBuffer(), cemiBuffer]);

    this.msgQueue.push(packet);

    if (this.msgQueue.length >= this.BUSY_THRESHOLD && !this.isRoutingBusy) {
      const routingOptions = this.options;
      const waitTime = (routingOptions.routingDelay ?? 20) * this.msgQueue.length;
      this.sendRoutingBusy(Math.min(100, waitTime));
    }

    this.processQueue();
  }

  private get routingSendPort(): number {
    return this._udpPort || this.options.port || 3671;
  }

  private sendLostMessage(count: number): void {
    const lostMsg = new RoutingLostMessage(0, count);
    const msgBody = lostMsg.toBuffer();
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.ROUTING_LOST_MESSAGE,
      KNXnetIPHeader.HEADER_SIZE_10 + msgBody.length,
    );
    const packet = Buffer.concat([header.toBuffer(), msgBody]);
    const outPacket = this.secureRoutingTimer ? this.secureRoutingTimer.wrapMulticastFrame(packet) : packet;

    if (this.socket && this.routingSendPort > 0) {
      (this.socket as dgram.Socket).send(outPacket, this.routingSendPort, this.options.ip!, (err) => {
        if (err) this.emit("error", err);
      });
    }
  }

  private sendRoutingBusy(waitTime: number): void {
    const busyMsg = new RoutingBusy(0, waitTime, 0x0000);
    const msgBody = busyMsg.toBuffer();
    const header = new KNXnetIPHeader(KNXnetIPServiceType.ROUTING_BUSY, KNXnetIPHeader.HEADER_SIZE_10 + msgBody.length);
    const packet = Buffer.concat([header.toBuffer(), msgBody]);
    const outPacket = this.secureRoutingTimer ? this.secureRoutingTimer.wrapMulticastFrame(packet) : packet;

    if (this.socket && this.routingSendPort > 0) {
      (this.socket as dgram.Socket).send(outPacket, this.routingSendPort, this.options.ip!, (err) => {
        if (err) this.emit("error", err);
      });
    }
  }

  private processQueue() {
    if (this.isProcessingQueue || this.isRoutingBusy || this.msgQueue.length === 0) return;

    this.isProcessingQueue = true;
    const routingOptions = this.options;
    const delay = routingOptions.routingDelay ?? 20;

    const executeSend = () => {
      if (!this.socket || this.isRoutingBusy) {
        this.isProcessingQueue = false;
        return;
      }

      const packet = this.msgQueue.shift();
      if (packet) {
        const outPacket = this.secureRoutingTimer ? this.secureRoutingTimer.wrapMulticastFrame(packet) : packet;
        const startTime = Date.now();
        (this.socket as dgram.Socket).send(outPacket, this.routingSendPort, this.options.ip!, (err) => {
          if (err) this.emit("error", err);
          this.lastSentTime = Date.now();
          this.isProcessingQueue = false;
          if (this.msgQueue.length > 0) {
            const elapsed = this.lastSentTime - startTime;
            const nextWait = Math.max(0, delay - elapsed);
            if (nextWait === 0) setImmediate(() => this.processQueue());
            else setTimeout(() => this.processQueue(), nextWait);
          }
        });
      } else {
        this.isProcessingQueue = false;
      }
    };

    const now = Date.now();
    const initialWait = Math.max(0, delay - (now - this.lastSentTime));
    if (initialWait === 0) executeSend();
    else setTimeout(executeSend, initialWait);
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo, isFromSecureWrapper: boolean = false) {
    try {
      const header = KNXnetIPHeader.fromBuffer(msg);
      const body = msg.subarray(6);
      const ourAddress = this.socket ? (this.socket as dgram.Socket).address() : null;

      // Filtro Anti-Eco inicial por IP/Puerto
      if (
        !isFromSecureWrapper &&
        ourAddress &&
        rinfo.address === this.options.localIp &&
        rinfo.port === ourAddress.port
      )
        return;
      this.logger.debug(
        `Received message from ${rinfo.address}:${rinfo.port} with service type ${header.serviceType} => ${KNXnetIPServiceType[header.serviceType]}`,
      );
      switch (header.serviceType) {
        case KNXnetIPServiceType.TIMER_NOTIFY: {
          if (this.secureRoutingTimer && !isFromSecureWrapper) {
            try {
              this.secureRoutingTimer.handleTimerNotify(msg);
            } catch (err: any) {
              this.logger.debug(`Ignored invalid TIMER_NOTIFY from ${rinfo.address}: ${err?.message ?? err}`);
            }
          }
          break;
        }
        case KNXnetIPServiceType.SECURE_WRAPPER: {
          if (!this.secureRoutingTimer || isFromSecureWrapper) {
            return;
          }
          try {
            const inner = this.secureRoutingTimer.unwrapMulticastFrame(msg);
            if (inner) {
              this.handleMessage(inner, rinfo, true);
            }
          } catch (err: any) {
            this.logger.debug(`Discarded multicast SECURE_WRAPPER from ${rinfo.address}: ${err?.message ?? err}`);
          }
          break;
        }
        case KNXnetIPServiceType.ROUTING_INDICATION: {
          if (this.secureRoutingTimer && !isFromSecureWrapper) {
            this.logger.debug(`Discarding plain ROUTING_INDICATION from ${rinfo.address} in secure routing mode`);
            return;
          }
          // [MEJORA] Filtro Anti-Eco Seguro leyendo la Individual Address (IA) origen del CEMI
          const addInfoLen = body[1];
          if (body.length >= 6 + addInfoLen) {
            const srcIA = body.readUInt16BE(4 + addInfoLen);
            if (srcIA === this.serverIAInt) {
              return; // Es nuestro propio paquete Multicast reenviado por el router
            }
          }
          this.emit("raw_indication", body);
          try {
            const cemi = CEMI.fromBuffer(body);
            this.emit("indication", cemi);
            if (!this.isCacheDelegated) {
              GroupAddressCache.getInstance().processCEMI(
                cemi as InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]>,
              );
            }
            if ("destinationAddress" in cemi) this.emit(cemi.destinationAddress, cemi);
            const srcIAStr = "sourceAddress" in cemi ? cemi.sourceAddress : "";
            let busmonBody: Buffer | null = null;
            this._tunnelConnections.forEach((conn) => {
              // Echo cancellation: Don't forward back to the client that originated this message
              if (srcIAStr === conn.knxAddressStr) {
                return;
              }

              if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER) {
                if (!busmonBody) busmonBody = this.convertDataIndToBusmonInd(body);
                conn.enqueue(busmonBody, KNXnetIPServiceType.TUNNELLING_REQUEST);
              } else {
                // Link Layer or Raw Layer
                conn.enqueue(body, KNXnetIPServiceType.TUNNELLING_REQUEST);
              }
            });
          } catch (e) {
            this.logger.error(e);
          }
          break;
        }
        case KNXnetIPServiceType.ROUTING_BUSY:
          if (this.secureRoutingTimer && !isFromSecureWrapper) {
            this.logger.debug(`Discarding plain ROUTING_BUSY from ${rinfo.address} in secure routing mode`);
            return;
          }
          this.handleRoutingBusy(RoutingBusy.fromBuffer(body));
          break;
        case KNXnetIPServiceType.ROUTING_LOST_MESSAGE:
          if (this.secureRoutingTimer && !isFromSecureWrapper) {
            return;
          }
          this.emit("routing_lost_message", RoutingLostMessage.fromBuffer(body));
          break;
        case KNXnetIPServiceType.ROUTING_SYSTEM_BROADCAST:
          this.emit("routing_system_broadcast", body);
          break;
        default: {
          const ctx = this.createUdpContext(rinfo);
          this.dispatchUnicastFrame(msg, ctx);
          break;
        }
      }
    } catch (e) {
      this.emit("error", e);
    }
  }

  private createUdpContext(rinfo: dgram.RemoteInfo): RequestContext {
    return {
      transport: "udp",
      remoteAddress: rinfo.address,
      remotePort: rinfo.port,
      rinfo,
      sendToEndpoint: (buf: Buffer, targetHPAI?: HPAI) => {
        if (!this.socket) return;
        const port = targetHPAI ? targetHPAI.port : rinfo.port;
        const addr = targetHPAI ? targetHPAI.ipAddress : rinfo.address;
        if (port > 0 && addr !== "" && addr !== "0.0.0.0") {
          (this.socket as dgram.Socket).send(buf, port, addr);
        }
      },
    };
  }

  private dispatchUnicastFrame(msg: Buffer, ctx: RequestContext): void {
    const header = KNXnetIPHeader.fromBuffer(msg);
    switch (header.serviceType) {
      case KNXnetIPServiceType.SEARCH_REQUEST:
        if (ctx.transport === "udp" && ctx.rinfo) {
          this.handleSearchRequest(msg, ctx.rinfo, false);
        }
        break;
      case KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED:
        if (ctx.transport === "udp" && ctx.rinfo) {
          this.handleSearchRequest(msg, ctx.rinfo, true);
        }
        break;
      case KNXnetIPServiceType.DESCRIPTION_REQUEST:
        this.handleDescriptionRequest(msg, ctx);
        break;
      case KNXnetIPServiceType.CONNECT_REQUEST:
        this.handleConnectRequest(msg, ctx);
        break;
      case KNXnetIPServiceType.CONNECTIONSTATE_REQUEST:
        this.handleConnectionStateRequest(msg, ctx);
        break;
      case KNXnetIPServiceType.DISCONNECT_REQUEST:
        this.handleDisconnectRequest(msg, ctx);
        break;
      case KNXnetIPServiceType.TUNNELLING_REQUEST:
        this.handleTunnelingRequest(msg, ctx);
        break;
      case KNXnetIPServiceType.TUNNELLING_ACK:
        this.handleTunnelingAck(msg, ctx);
        break;
      case KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK:
        this.handleDeviceConfigAck(msg, ctx);
        break;
      case KNXnetIPServiceType.TUNNELLING_FEATURE_GET:
        this.handleTunnelingFeatureGet(msg, ctx);
        break;
      case KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST:
        this.handleDeviceConfigurationRequest(msg, ctx);
        break;
      default:
        this.logger.debug(
          `Unhandled unicast service 0x${header.serviceType.toString(16)} on ${ctx.transport} from ${ctx.remoteAddress}:${ctx.remotePort}`,
        );
    }
  }

  private validateHPAIForContext(hpai: HPAI, ctx: RequestContext): { valid: boolean; protocolError: boolean } {
    if (ctx.transport === "tcp") {
      if (hpai.protocol !== HostProtocolCode.IPV4_TCP) {
        return { valid: false, protocolError: true };
      }
      const isIpZero = hpai.ipAddress === "0.0.0.0";
      const isPortZero = hpai.port === 0;
      if (isIpZero !== isPortZero) {
        return { valid: false, protocolError: false };
      }
      return { valid: true, protocolError: false };
    }

    if (hpai.protocol !== HostProtocolCode.IPV4_UDP) {
      return { valid: false, protocolError: true };
    }
    const ok = this.resolveRouteBack(hpai, ctx.rinfo!);
    return { valid: ok, protocolError: false };
  }

  private isChannelOwnedByContext(conn: TunnelConnection, ctx: RequestContext): boolean {
    if (ctx.transport === "tcp") {
      if (!conn.isTcp || conn.tcpConnectionId !== ctx.tcpContext?.id) {
        return false;
      }
      const expectedSid = ctx.secureSession ? ctx.secureSession.sessionId : null;
      return conn.secureSessionId === expectedSid;
    }
    return !conn.isTcp;
  }

  private getLocalIpForContext(ctx: RequestContext): string {
    if (ctx.transport === "tcp" && ctx.tcpContext) {
      const local = ctx.tcpContext.socket.localAddress;
      if (local) {
        return local.startsWith("::ffff:") ? local.slice(7) : local;
      }
    }
    return this.getHPAI(ctx.rinfo).ipAddress;
  }

  private handleTunnelingAck(msg: Buffer, ctx: RequestContext) {
    // 03_08_04 §2.6.2: On TCP, received TUNNELLING_ACK frames shall be ignored
    if (ctx.transport === "tcp") return;

    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const status = msg.readUInt8(9);
    this.logger.debug(`Received Tunnelling ACK for channel ${channelId}, seq ${seq}, status ${status}`);
    const conn = this._tunnelConnections.get(channelId);
    if (conn && this.isChannelOwnedByContext(conn, ctx)) {
      conn.handleAck(seq, status);
    }
  }

  private handleSearchRequest(msg: Buffer, rinfo: dgram.RemoteInfo, isExtended: boolean) {
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));

    // [MEJORA] Route Back validation
    if (!this.resolveRouteBack(clientHPAI, rinfo)) {
      return; // Silently drop invalid HPAI
    }

    const responseType = isExtended
      ? KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED
      : KNXnetIPServiceType.SEARCH_RESPONSE;

    const serverHPAI = this.getHPAI(rinfo);
    const localIp = serverHPAI.ipAddress;
    const localPort = serverHPAI.port;

    this.logger.debug(
      `Responding to search from ${clientHPAI.ipAddress}:${clientHPAI.port} with ${localIp}:${localPort}`,
    );

    const dibs = this.getIdentificationDIBs(responseType, localIp);
    const body = Buffer.concat([serverHPAI.toBuffer(), ...dibs.map((d) => d.toBuffer())]);
    const responseHeader = new KNXnetIPHeader(responseType, KNXnetIPHeader.HEADER_SIZE_10 + body.length);

    if (this.socket) {
      (this.socket as dgram.Socket).send(
        Buffer.concat([responseHeader.toBuffer(), body]),
        clientHPAI.port,
        clientHPAI.ipAddress,
      );
    }
  }

  private handleDescriptionRequest(msg: Buffer, ctx: RequestContext) {
    const clientHPAI = HPAI.fromBuffer(msg.subarray(6));
    const check = this.validateHPAIForContext(clientHPAI, ctx);
    if (!check.valid) return;

    const localIp = this.getLocalIpForContext(ctx);
    const dibs = this.getIdentificationDIBs(KNXnetIPServiceType.DESCRIPTION_RESPONSE, localIp);
    const body = Buffer.concat(dibs.map((d) => d.toBuffer()));
    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.DESCRIPTION_RESPONSE,
      KNXnetIPHeader.HEADER_SIZE_10 + body.length,
    );

    this.logger.debug(
      `Responding to description request on ${ctx.transport} from ${ctx.remoteAddress}:${ctx.remotePort}`,
    );

    // 03_08_02 §7.7.2: On TCP, server sends DESCRIPTION_RESPONSE on the same TCP socket and keeps it open
    ctx.sendToEndpoint(Buffer.concat([responseHeader.toBuffer(), body]), clientHPAI);
  }

  private getHPAI(rinfo?: dgram.RemoteInfo): HPAI {
    let localIp = this.options.localIp!;
    if (localIp === "0.0.0.0") {
      localIp = getNetworkInfo().address;
    }

    // [MEJORA] Multi-homed IP matching.
    // Ensure we report the local IP of the interface that can actually route back to the client.
    if (rinfo && rinfo.address) {
      const interfaces = os.networkInterfaces();
      const rinfoNum = rinfo.address.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
      for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]!) {
          if (net.family === "IPv4" && !net.internal) {
            const netNum = net.address.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
            const maskNum = net.netmask.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
            if ((rinfoNum & maskNum) === (netNum & maskNum)) {
              localIp = net.address;
            }
          }
        }
      }
    }

    const udpPort = this.socket ? (this.socket as dgram.Socket).address().port : this._udpPort;
    return new HPAI(HostProtocolCode.IPV4_UDP, localIp, udpPort);
  }

  private handleConnectRequest(msg: Buffer, ctx: RequestContext) {
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(6));
    const clientDataHPAI = HPAI.fromBuffer(msg.subarray(14));

    const ctrlCheck = this.validateHPAIForContext(clientControlHPAI, ctx);
    if (!ctrlCheck.valid) {
      if (ctrlCheck.protocolError && ctx.transport === "tcp") {
        const errResp = Buffer.concat([
          new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_RESPONSE, 8).toBuffer(),
          Buffer.from([0x00, KNXnetIPErrorCodes.E_HOST_PROTOCOL_TYPE]),
        ]);
        ctx.sendToEndpoint(errResp);
      } else {
        this.logger.warn(`Invalid Control HPAI from ${ctx.remoteAddress}. Dropping.`);
      }
      return;
    }

    const dataCheck = this.validateHPAIForContext(clientDataHPAI, ctx);
    if (!dataCheck.valid) {
      if (dataCheck.protocolError) {
        const errResp = Buffer.concat([
          new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_RESPONSE, 8).toBuffer(),
          Buffer.from([0x00, KNXnetIPErrorCodes.E_HOST_PROTOCOL_TYPE]),
        ]);
        ctx.sendToEndpoint(errResp, clientControlHPAI);
      } else {
        this.logger.warn(`Invalid Data HPAI from ${ctx.remoteAddress}. Dropping.`);
      }
      return;
    }

    const cri = CRI.fromBuffer(msg.subarray(22));
    let status = KNXnetIPErrorCodes.E_NO_ERROR;
    let channelId = 0;

    // 03_08_02 §8.4.3.4.3: On TCP, server responds with Null TCP HPAI (0.0.0.0:0)
    const serverDataHPAI = ctx.transport === "tcp" ? HPAI.NULL_TCP_HPAI : this.getHPAI(ctx.rinfo);

    this.logger.info(
      `Connect Request (${ctx.transport}${ctx.secureSession ? "/secure" : ""}) from ${ctx.remoteAddress}, Type: ${cri.connectionType}, IA: ${cri.individualAddress}, Layer: ${cri.knxLayer}`,
    );

    // 03_08_09 §2.2.3.8.3: Device Management connection in a Secure Session requires Management Level (userId === 1)
    if (
      cri.connectionType === ConnectionType.DEVICE_MGMT_CONNECTION &&
      ctx.secureSession &&
      ctx.secureUserId !== 1
    ) {
      this.logger.warn(
        `Connect Request refused: userId=${ctx.secureUserId} is not authorized for DEVICE_MGMT_CONNECTION (requires userId=1)`,
      );
      const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_RESPONSE, 8);
      ctx.sendToEndpoint(
        Buffer.concat([responseHeader.toBuffer(), Buffer.from([0, KNXnetIPErrorCodes.E_AUTHORISATION_ERROR])]),
        clientControlHPAI,
      );
      return;
    }

    // Check if a stale connection from the same remote IP already exists with the same IA (UDP / same host)
    let knxAddress = cri.individualAddress;
    if (knxAddress !== null && knxAddress !== 0) {
      for (const [cid, conn] of this._tunnelConnections.entries()) {
        if (
          conn.knxAddress === knxAddress &&
          ((ctx.transport === "udp" && !conn.isTcp && conn.controlHPAI.ipAddress === ctx.remoteAddress) ||
            (ctx.transport === "tcp" && conn.tcpConnectionId === ctx.tcpContext?.id))
        ) {
          this.logger.warn(
            `IA ${knxAddress} already in use by stale connection on channel ${cid}. Replacing channel.`,
          );
          this.closeConnection(cid, true);
          break;
        }
      }
    }

    for (let i = 1; i <= this.maxTunnelConnections; i++) {
      if (!this._tunnelConnections.has(i)) {
        channelId = i;
        break;
      }
    }

    const transportTarget: TunnelTransportTarget =
      ctx.transport === "tcp"
        ? {
            kind: "tcp",
            tcpConnectionId: ctx.tcpContext!.id,
            secureSessionId: ctx.secureSession?.sessionId,
            secureUserId: ctx.secureUserId,
            sendPacket: (packet: Buffer) => ctx.sendToEndpoint(packet),
          }
        : {
            kind: "udp",
            socket: this.socket as dgram.Socket,
          };

    if (channelId === 0) {
      this.logger.warn("Connect Request refused: No more channels available.");
      status = KNXnetIPErrorCodes.E_NO_MORE_CONNECTIONS;
    } else if (cri.connectionType === ConnectionType.DEVICE_MGMT_CONNECTION) {
      // Management connections don't usually have a dedicated IA assigned in the CRD
      this.logger.info(`Management Connection established! Channel: ${channelId} (${ctx.transport})`);
      this._tunnelConnections.set(
        channelId,
        new TunnelConnection(
          channelId,
          clientControlHPAI,
          clientDataHPAI,
          0,
          "0.0.0",
          cri.knxLayer,
          transportTarget,
          this.HEARTBEAT_TIMEOUT,
          this.RETRANSMIT_TIMEOUT,
          this.MAX_PENDING_REQUESTS_PER_CLIENT,
          this.ignoreACKTimeout,
          (cid: number, sendDisconnect: boolean) => this.closeConnection(cid, sendDisconnect),
          this.logger,
        ),
      );
      if (ctx.tcpContext) this.refreshTcpIdleTimer(ctx.tcpContext);

      const body = Buffer.concat([
        Buffer.from([channelId, status]),
        serverDataHPAI.toBuffer(),
        Buffer.from([0x02, ConnectionType.DEVICE_MGMT_CONNECTION]),
      ]);
      const responseHeader = new KNXnetIPHeader(
        KNXnetIPServiceType.CONNECT_RESPONSE,
        KNXnetIPHeader.HEADER_SIZE_10 + body.length,
      );
      ctx.sendToEndpoint(Buffer.concat([responseHeader.toBuffer(), body]), clientControlHPAI);
      return;
    } else if (cri.connectionType === ConnectionType.TUNNEL_CONNECTION) {
      if (knxAddress === null || knxAddress === 0) {
        knxAddress = this.clientAddrsStartInt + channelId - 1;
      }

      if (
        cri.knxLayer !== KNXLayer.LINK_LAYER &&
        cri.knxLayer !== KNXLayer.BUSMONITOR_LAYER &&
        cri.knxLayer !== KNXLayer.RAW_LAYER
      ) {
        this.logger.warn(`Connect Request refused: Invalid layer ${cri.knxLayer}`);
        status = KNXnetIPErrorCodes.E_TUNNELLING_LAYER;
      }

      if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
        for (const [cid, conn] of this._tunnelConnections.entries()) {
          if (conn.knxAddress === knxAddress) {
            this.logger.warn(`Connect Request refused: IA ${knxAddress} already in use by channel ${cid}`);
            status = KNXnetIPErrorCodes.E_NO_MORE_UNIQUE_CONNECTIONS;
            break;
          }
        }
      }

      if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
        const addrBuf = Buffer.alloc(2);
        addrBuf.writeUInt16BE(knxAddress);
        const knxAddressStr = KNXHelper.GetAddress(addrBuf, ".") as string;

        this.logger.info(
          `Tunnel Connection established! Channel: ${channelId}, IA: ${knxAddressStr}, Layer: ${cri.knxLayer} (${ctx.transport})`,
        );
        this._tunnelConnections.set(
          channelId,
          new TunnelConnection(
            channelId,
            clientControlHPAI,
            clientDataHPAI,
            knxAddress,
            knxAddressStr,
            cri.knxLayer,
            transportTarget,
            this.HEARTBEAT_TIMEOUT,
            this.RETRANSMIT_TIMEOUT,
            this.MAX_PENDING_REQUESTS_PER_CLIENT,
            this.ignoreACKTimeout,
            (cid: number, sendDisconnect: boolean) => this.closeConnection(cid, sendDisconnect),
            this.logger,
          ),
        );
        if (ctx.tcpContext) this.refreshTcpIdleTimer(ctx.tcpContext);

        const crd = new CRD(cri.connectionType, knxAddress);
        const body = Buffer.concat([Buffer.from([channelId, status]), serverDataHPAI.toBuffer(), crd.toBuffer()]);
        const responseHeader = new KNXnetIPHeader(
          KNXnetIPServiceType.CONNECT_RESPONSE,
          KNXnetIPHeader.HEADER_SIZE_10 + body.length,
        );
        ctx.sendToEndpoint(Buffer.concat([responseHeader.toBuffer(), body]), clientControlHPAI);
        return;
      }
    } else {
      status = KNXnetIPErrorCodes.E_CONNECTION_TYPE;
    }

    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_RESPONSE, 8);
    ctx.sendToEndpoint(Buffer.concat([responseHeader.toBuffer(), Buffer.from([0, status])]), clientControlHPAI);
  }

  private resetHeartbeat(channelId: number) {
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      conn.resetHeartbeat();
    }
  }

  private closeConnection(channelId: number, sendDisconnect: boolean = false) {
    const conn = this._tunnelConnections.get(channelId);
    if (conn) {
      const controlHPAI = conn.controlHPAI;
      const tcpConnId = conn.tcpConnectionId;
      conn.close();

      if (sendDisconnect) {
        if (conn.isTcp && tcpConnId) {
          const ctx = this.tcpClients.get(tcpConnId);
          if (ctx && !ctx.closed && !ctx.socket.destroyed) {
            const body = Buffer.concat([Buffer.from([channelId, 0x00]), HPAI.NULL_TCP_HPAI.toBuffer()]);
            const header = new KNXnetIPHeader(
              KNXnetIPServiceType.DISCONNECT_REQUEST,
              KNXnetIPHeader.HEADER_SIZE_10 + body.length,
            );
            const frame = Buffer.concat([header.toBuffer(), body]);
            const session = conn.secureSessionId ? ctx.sessions.get(conn.secureSessionId) : undefined;
            try {
              if (session && session.isAuthenticated) {
                ctx.socket.write(session.wrap(frame));
              } else if (!conn.secureSessionId) {
                ctx.socket.write(frame);
              }
            } catch {
              /* Ignore send error during disconnect */
            }
          }
        } else if (!conn.isTcp && this.socket) {
          // Send DISCONNECT_REQUEST to UDP client (Spec 5.4/5.5)
          const body = Buffer.concat([Buffer.from([channelId, 0x00]), this.getHPAI().toBuffer()]);
          const header = new KNXnetIPHeader(
            KNXnetIPServiceType.DISCONNECT_REQUEST,
            KNXnetIPHeader.HEADER_SIZE_10 + body.length,
          );
          (this.socket as dgram.Socket).send(
            Buffer.concat([header.toBuffer(), body]),
            controlHPAI.port,
            controlHPAI.ipAddress,
          );
        }
      }

      this._tunnelConnections.delete(channelId);
      if (tcpConnId) {
        this.refreshTcpIdleTimer(this.tcpClients.get(tcpConnId));
      }
      this.emit("disconnected_client", channelId);
    }
  }

  private handleConnectionStateRequest(msg: Buffer, ctx: RequestContext) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));

    const check = this.validateHPAIForContext(clientControlHPAI, ctx);
    if (!check.valid) return;

    const conn = this._tunnelConnections.get(channelId);
    let status = KNXnetIPErrorCodes.E_CONNECTION_ID;
    if (conn && this.isChannelOwnedByContext(conn, ctx)) {
      status = KNXnetIPErrorCodes.E_NO_ERROR;
      this.resetHeartbeat(channelId);
    }

    const body = Buffer.from([channelId, status]);
    const responseHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE, 6 + body.length);
    ctx.sendToEndpoint(Buffer.concat([responseHeader.toBuffer(), body]), clientControlHPAI);
  }

  private handleDisconnectRequest(msg: Buffer, ctx: RequestContext) {
    const channelId = msg.readUInt8(6);
    const clientControlHPAI = HPAI.fromBuffer(msg.subarray(8));

    const check = this.validateHPAIForContext(clientControlHPAI, ctx);
    if (!check.valid) return;

    const conn = this._tunnelConnections.get(channelId);
    let status = KNXnetIPErrorCodes.E_CONNECTION_ID;
    if (conn && this.isChannelOwnedByContext(conn, ctx)) {
      status = KNXnetIPErrorCodes.E_NO_ERROR;
      this.closeConnection(channelId, false);
    }

    const body = Buffer.from([channelId, status]);
    const responseHeader = new KNXnetIPHeader(
      KNXnetIPServiceType.DISCONNECT_RESPONSE,
      KNXnetIPHeader.HEADER_SIZE_10 + body.length,
    );
    ctx.sendToEndpoint(Buffer.concat([responseHeader.toBuffer(), body]), clientControlHPAI);
  }

  private handleTunnelingRequest(msg: Buffer, ctx: RequestContext) {
    const headerLen = msg.readUInt8(6);
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const cemiBuffer = Buffer.from(msg.subarray(6 + headerLen));

    const conn = this._tunnelConnections.get(channelId);
    if (!conn || !this.isChannelOwnedByContext(conn, ctx)) {
      if (ctx.transport === "udp") {
        this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_CONNECTION_ID, ctx.rinfo);
      }
      return;
    }

    // [MEJORA] Rate Limiting (Pacing) para evitar Flooding por parte del cliente
    const now = Date.now();
    if (now - conn.lastRxTime > 1000) {
      conn.rxCount = 0;
      conn.lastRxTime = now;
    }
    conn.rxCount++;
    if (this.MAX_PENDING_REQUESTS_PER_CLIENT > 0 && conn.rxCount > this.MAX_PENDING_REQUESTS_PER_CLIENT) {
      this.logger.warn(
        `Client ${ctx.remoteAddress} is flooding (${conn.rxCount} req/s). Terminating connection on channel ${channelId}.`,
      );
      this.closeConnection(channelId, true);
      return;
    }

    const { action, status } = conn.validateRequest(seq);

    if (action === "retransmit_ack") {
      if (ctx.transport === "udp") {
        this.sendTunnelACK(channelId, seq, status, ctx.rinfo);
      }
      return;
    }

    if (action === "discard") return;

    // 03_08_04 §2.6.2: On TCP, no TUNNELLING_ACK shall be sent
    if (ctx.transport === "udp") {
      this.sendTunnelACK(channelId, seq, status, ctx.rinfo);
    }

    const msgCode = cemiBuffer[0];
    const addInfoLen = cemiBuffer[1];

    if (conn.knxLayer === KNXLayer.BUSMONITOR_LAYER && (msgCode === 0x11 || msgCode === 0x10)) return;

    if (msgCode === 0x11) {
      const srcIAOffset = 2 + addInfoLen + 2;
      if (cemiBuffer.readUInt16BE(srcIAOffset) === 0) {
        cemiBuffer.writeUInt16BE(conn.knxAddress, srcIAOffset);
      }
    }

    this.emit("indication", CEMI.fromBuffer(cemiBuffer));

    let routingCemiBuffer = cemiBuffer;
    if (msgCode === 0x11) {
      routingCemiBuffer = Buffer.from(cemiBuffer);
      routingCemiBuffer[0] = 0x29;
    } else if (msgCode === 0x10) {
      routingCemiBuffer = Buffer.from(cemiBuffer);
      routingCemiBuffer[0] = 0x2d;
    }
    this.sendRaw(routingCemiBuffer);

    if (msgCode === 0x11 || msgCode === 0x10) {
      const conCemiBuffer = Buffer.from(cemiBuffer);
      conCemiBuffer[0] = msgCode + 0x1d; // 0x11 -> 0x2E, 0x10 -> 0x2F
      conCemiBuffer[2 + addInfoLen] &= 0xfe;
      conn.enqueue(conCemiBuffer, KNXnetIPServiceType.TUNNELLING_REQUEST);
    }
  }

  private sendTunnelACK(channelId: number, seq: number, status: number, rinfo?: dgram.RemoteInfo) {
    const body = Buffer.from([0x04, channelId, seq, status]);
    const header = new KNXnetIPHeader(KNXnetIPServiceType.TUNNELLING_ACK, KNXnetIPHeader.HEADER_SIZE_10 + body.length);
    const conn = this._tunnelConnections.get(channelId);
    if (conn?.isTcp) return;
    if (this.socket) {
      const port = conn ? conn.dataHPAI.port : rinfo ? rinfo.port : 0;
      const addr = conn ? conn.dataHPAI.ipAddress : rinfo ? rinfo.address : "";
      if (port > 0 && addr !== "") {
        (this.socket as dgram.Socket).send(Buffer.concat([header.toBuffer(), body]), port, addr);
      }
    }
  }

  private handleTunnelingFeatureGet(msg: Buffer, ctx: RequestContext) {
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const featId = msg.readUInt8(10);
    const conn = this._tunnelConnections.get(channelId);
    if (!conn || !this.isChannelOwnedByContext(conn, ctx)) {
      if (ctx.transport === "udp") {
        this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_CONNECTION_ID, ctx.rinfo);
      }
      return;
    }

    const { action, status } = conn.validateRequest(seq);
    this.logger.debug(`Feature Get for channel ${channelId}, feat: ${featId}, seq: ${seq}`);
    if (action === "retransmit_ack") {
      if (ctx.transport === "udp") {
        this.sendTunnelACK(channelId, seq, status, ctx.rinfo);
      }
      return;
    }
    if (action === "discard") return;

    if (ctx.transport === "udp") {
      this.sendTunnelACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR, ctx.rinfo);
    }

    let featVal: Buffer;
    let retCode = 0x00;
    switch (featId) {
      case 0x07:
        featVal = Buffer.alloc(2);
        featVal.writeUInt16BE(254);
        break;
      case 0x06:
        featVal = Buffer.alloc(2);
        featVal.writeUInt16BE(conn.knxAddress);
        break;
      default:
        featVal = Buffer.alloc(0);
        retCode = 0x01;
    }
    const featBody = Buffer.concat([Buffer.from([featId, retCode]), featVal]);
    conn.enqueue(featBody, KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE);
  }

  private handleDeviceConfigurationRequest(msg: Buffer, ctx: RequestContext) {
    const headerLen = msg.readUInt8(6);
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const cemiBuffer = msg.subarray(6 + headerLen);

    const conn = this._tunnelConnections.get(channelId);
    if (!conn || !this.isChannelOwnedByContext(conn, ctx)) {
      if (ctx.transport === "udp") {
        this.sendDeviceConfigACK(channelId, seq, KNXnetIPErrorCodes.E_CONNECTION_ID);
      }
      return;
    }

    const { action, status } = conn.validateRequest(seq);
    if (action === "retransmit_ack") {
      if (ctx.transport === "udp") {
        this.sendDeviceConfigACK(channelId, seq, status);
      }
      return;
    }
    if (action === "discard") return;

    if (ctx.transport === "udp") {
      this.sendDeviceConfigACK(channelId, seq, KNXnetIPErrorCodes.E_NO_ERROR);
    }

    try {
      const msgCode = cemiBuffer.readUInt8(0);
      if (msgCode === 0xfc) {
        // M_PropRead.req
        const req = CEMI.ManagementCEMI["M_PropRead.req"].fromBuffer(cemiBuffer);
        this.logger.debug(
          `Management PropRead: Obj=${req.interfaceObjectType}, Prop=${req.propertyId} on channel ${channelId}`,
        );

        let data = Buffer.alloc(0);
        const routingOptions = this.options;

        // Respond to Individual Address (Prop 1) of Device Object (Obj 0)
        if (req.interfaceObjectType === 0 && req.propertyId === 1) {
          data = Buffer.alloc(2);
          data.writeUInt16BE(KNXHelper.GetAddress(routingOptions.individualAddress!, ".").readUInt16BE());
        }

        const resCemi = new CEMI.ManagementCEMI["M_PropRead.con"](
          req.interfaceObjectType,
          req.objectInstance,
          req.propertyId,
          req.numberOfElements,
          req.startIndex,
          data,
        );

        conn.enqueue(resCemi.toBuffer(), KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST);
      }
    } catch (e: any) {
      this.logger.error(`Error processing management config request on channel ${channelId}: ${e.message}`);
    }
  }

  private handleDeviceConfigAck(msg: Buffer, ctx: RequestContext) {
    if (ctx.transport === "tcp") return;
    const channelId = msg.readUInt8(7);
    const seq = msg.readUInt8(8);
    const status = msg.readUInt8(9);
    this.logger.debug(`Received Management ACK for channel ${channelId}, seq ${seq}, status ${status}`);
    const conn = this._tunnelConnections.get(channelId);
    if (conn && this.isChannelOwnedByContext(conn, ctx)) {
      conn.handleAck(seq, status);
    }
  }

  private sendDeviceConfigACK(channelId: number, seq: number, status: number) {
    const body = Buffer.from([0x04, channelId, seq, status]);
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK,
      KNXnetIPHeader.HEADER_SIZE_10 + body.length,
    );
    const conn = this._tunnelConnections.get(channelId);
    if (conn && !conn.isTcp && this.socket) {
      (this.socket as dgram.Socket).send(
        Buffer.concat([header.toBuffer(), body]),
        conn.dataHPAI.port,
        conn.dataHPAI.ipAddress,
      );
    }
  }

  private getIdentificationDIBs(serviceType?: KNXnetIPServiceType, requestLocalIp?: string) {
    const routingOptions = this.options;
    const netInfo = getNetworkInfo();
    const effectiveLocalIp = requestLocalIp || netInfo.address;
    let effectiveNetmask = netInfo.netmask;

    if (requestLocalIp && requestLocalIp !== netInfo.address) {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]!) {
          if (net.address === requestLocalIp) {
            effectiveNetmask = net.netmask;
          }
        }
      }
    }

    // Spec says use TP1 (0x02) for gateway reporting
    const devInfo = new DeviceInformationDIB(
      KNXMedium.KNXIP,
      0,
      KNXHelper.GetAddress(routingOptions.individualAddress as string, ".").readUint16BE(),
      0,
      routingOptions.serialNumber!,
      this.options.ip!,
      routingOptions.macAddress!,
      routingOptions.friendlyName!,
    );

    const services: { family: number; version: number }[] = [
      { family: AllowedSupportedServiceFamilies.Core, version: 1 },
      { family: AllowedSupportedServiceFamilies.DeviceManagement, version: 1 },
      { family: AllowedSupportedServiceFamilies.Tunnelling, version: 1 },
      { family: AllowedSupportedServiceFamilies.Routing, version: 1 },
    ];

    const hasSecurity = this.hasUnicastSecurity || !!this.secureRoutingTimer;
    if (serviceType !== KNXnetIPServiceType.SEARCH_RESPONSE && hasSecurity) {
      services.push({ family: AllowedSupportedServiceFamilies.Security, version: 1 });
    }

    const suppSvc = new SupportedServicesDIB(services);

    if (serviceType === KNXnetIPServiceType.SEARCH_RESPONSE) {
      return [devInfo, suppSvc];
    }
    const deviceDescriptorType0 = DeviceDescriptorType0.KNXNET_IP_ROUTER;
    const extDevInfo = new ExtendedDeviceInformationDIB(false, 254, deviceDescriptorType0);
    const ipConfig = new IPConfigDIB(effectiveLocalIp, effectiveNetmask, "0.0.0.0", 0x01, 0x02);
    const ipCurrent = new IPCurrentConfigDIB(effectiveLocalIp, effectiveNetmask, "0.0.0.0", "0.0.0.0", 0x02);
    const slots: { address: number; status: StatusTunnelingSlot }[] = [];
    for (let i = 1; i <= this.maxTunnelConnections; i++) {
      const conn = this._tunnelConnections.get(i);
      const status = new StatusTunnelingSlot();
      status.authorised = true;
      status.usable = !!conn;
      status.free = !conn;
      slots.push({
        address: conn ? conn.knxAddress : this.clientAddrsStartInt + i - 1,
        status: status,
      });
    }

    const dibs: DIB[] = [devInfo, suppSvc, extDevInfo, ipConfig, ipCurrent, new TunnellingInfoDIB(254, slots)];

    if (hasSecurity) {
      let securedList: { family: number; securityVersion: number }[];
      if (this.options.secure?.securedServiceFamilies) {
        securedList = this.options.secure.securedServiceFamilies.map((s) => ({
          family: s.family,
          securityVersion: s.version,
        }));
      } else {
        securedList = [];
        if (this.hasUnicastSecurity) {
          securedList.push(
            { family: AllowedSupportedServiceFamilies.Core, securityVersion: 1 },
            { family: AllowedSupportedServiceFamilies.DeviceManagement, securityVersion: 1 },
            { family: AllowedSupportedServiceFamilies.Tunnelling, securityVersion: 1 },
          );
        } else if (this.secureRoutingTimer) {
          securedList.push({ family: AllowedSupportedServiceFamilies.Core, securityVersion: 1 });
        }
        if (this.secureRoutingTimer) {
          securedList.push({ family: AllowedSupportedServiceFamilies.Routing, securityVersion: 1 });
        }
      }
      dibs.push(new SecuredServiceFamiliesDIB(securedList));
    }

    return dibs;
  }

  private handleRoutingBusy(busy: RoutingBusy) {
    const now = Date.now();
    if (now - this.lastBusyTime > 10) {
      this.busyCounter++;
      this.resetDecrementTimer();
    }
    this.lastBusyTime = now;
    if (busy.routingBusyControl === 0x0000) {
      this.pauseSending(busy.waitTime + Math.floor(Math.random() * this.busyCounter * 50));
    }
    this.emit("routing_busy", busy);
  }

  private resetDecrementTimer() {
    if (this.decrementTimer) clearTimeout(this.decrementTimer);
    if (this.decrementInterval) clearInterval(this.decrementInterval);
    this.decrementTimer = setTimeout(() => {
      this.decrementInterval = setInterval(() => {
        if (this.busyCounter > 0) this.busyCounter--;
        else {
          if (this.decrementInterval) clearInterval(this.decrementInterval);
          this.decrementInterval = null;
        }
      }, 5);
    }, this.busyCounter * 100);
  }

  private pauseSending(waitTime: number) {
    this.isRoutingBusy = true;
    if (this.routingBusyTimer) clearTimeout(this.routingBusyTimer);
    this.routingBusyTimer = setTimeout(() => {
      this.isRoutingBusy = false;
      this.routingBusyTimer = null;
      this.emit("routing_ready");
      this.processQueue();
    }, waitTime);
  }

  private convertDataIndToBusmonInd(cemiBuffer: Buffer): Buffer {
    const msgCode = cemiBuffer[0];
    if (msgCode !== 0x29 && msgCode !== 0x2d && msgCode !== 0x2e && msgCode !== 0x11 && msgCode !== 0x10)
      return cemiBuffer;
    const addInfoLen = cemiBuffer[1];
    const baseOffset = 2 + addInfoLen;
    const cf1 = cemiBuffer[baseOffset];
    const cf2 = cemiBuffer[baseOffset + 1];
    const src = cemiBuffer.subarray(baseOffset + 2, baseOffset + 4);
    const dst = cemiBuffer.subarray(baseOffset + 4, baseOffset + 6);
    const dataLen = cemiBuffer[baseOffset + 6];
    const tpdu = cemiBuffer.subarray(baseOffset + 7);
    const lpdu = Buffer.concat([
      Buffer.from([cf1]),
      src,
      dst,
      Buffer.from([(cf2 & 0xf0) | (dataLen + 1)]),
      tpdu,
      Buffer.alloc(1),
    ]);
    let xor = 0;
    for (let i = 0; i < lpdu.length - 1; i++) xor ^= lpdu[i];
    lpdu[lpdu.length - 1] = ~xor & 0xff;
    return new (CEMI.DataLinkLayerCEMI["L_Busmon.ind"] as any)(null, lpdu).toBuffer();
  }
}
