import net from "node:net";
import { KNXTunneling } from "../src/connection/KNXTunneling";
import { KNXnetIPHeader } from "../src/core/KNXnetIPHeader";
import { CRD, HPAI } from "../src/core/KNXnetIPStructures";
import {
  ConnectionType,
  HostProtocolCode,
  KNXnetIPErrorCodes,
  KNXnetIPServiceType,
  SecureSessionStatus,
} from "../src/core/enum/KNXnetIPEnum";
import {
  SecureWrapper,
  SessionAuthenticate,
  SessionRequest,
  SessionResponse,
  SessionStatus,
} from "../src/core/KNXnetIPSecureStructures";
import {
  computeSessionKey,
  deriveDeviceAuthenticationCode,
  deriveUserPasswordKey,
  generateX25519KeyPair,
} from "../src/security/KnxSecureKeys";
import { TcpFrameReader } from "../src/connection/TcpFrameReader";

class SimulatedSecureTcpServer {
  private server: net.Server | null = null;
  private clientSocket: net.Socket | null = null;
  private reader = new TcpFrameReader();
  public port: number = 0;

  private readonly serverKeys = generateX25519KeyPair();
  private clientPublicKey: Buffer | null = null;
  public sessionKey: Buffer | null = null;
  public readonly sessionId: number = 0x0042;
  public readonly channelId: number = 0x11;
  public readonly serverSerial = Buffer.from("00fa11223344", "hex");
  private txWrapperSeq: bigint = 0n;

  public receivedPlainServices: number[] = [];
  public receivedWrappedServices: number[] = [];
  public receivedTunnelAcks: number = 0;
  public lastSessionStatusFromClient: number | null = null;

  constructor(
    private readonly opts: {
      secure: boolean;
      userPassword?: string;
      deviceAuthPassword?: string;
      corruptSessionResponseMac?: boolean;
      use7ByteSessionStatus?: boolean;
    },
  ) {}

  public async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        this.clientSocket = socket;
        this.reader.reset();
        socket.on("error", () => {});
        socket.on("data", (chunk) => {
          const frames = this.reader.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          for (const frame of frames) {
            this.onFrame(frame);
          }
        });
      });
      this.server.listen(0, "127.0.0.1", () => {
        this.port = (this.server!.address() as net.AddressInfo).port;
        resolve(this.port);
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.clientSocket) {
      this.clientSocket.destroy();
      this.clientSocket = null;
    }
    if (this.server) {
      await new Promise<void>((r) => this.server!.close(() => r()));
      this.server = null;
    }
  }

  public wrapFromServer(innerFrame: Buffer, seqOverride?: bigint, sidOverride?: number): Buffer {
    const seq = seqOverride ?? this.txWrapperSeq++;
    if (seqOverride !== undefined && seqOverride >= this.txWrapperSeq) {
      this.txWrapperSeq = seqOverride + 1n;
    }
    return SecureWrapper.wrap({
      sessionId: sidOverride ?? this.sessionId,
      sequenceNumber: seq,
      serialNumber: this.serverSerial,
      innerFrame,
      key: this.sessionKey!,
    });
  }

  public sendRawToClient(buf: Buffer): void {
    this.clientSocket?.write(buf);
  }

  private onFrame(frame: Buffer): void {
    const header = KNXnetIPHeader.fromBuffer(frame);

    if (!this.opts.secure) {
      this.receivedPlainServices.push(header.serviceType);
      this.handleInnerKnxFrame(frame, false);
      return;
    }

    if (header.serviceType === KNXnetIPServiceType.SESSION_REQUEST) {
      const req = SessionRequest.fromBuffer(frame);
      this.clientPublicKey = req.clientPublicKey;
      this.sessionKey = computeSessionKey(this.serverKeys.privateKey, this.clientPublicKey);
      this.txWrapperSeq = 0n;

      const devAuthCode = deriveDeviceAuthenticationCode(this.opts.deviceAuthPassword ?? "trustme");
      const resp = SessionResponse.createAuthenticated(
        this.sessionId,
        this.serverKeys.publicKeyRaw,
        this.clientPublicKey,
        devAuthCode,
      );
      const buf = resp.toBuffer();
      if (this.opts.corruptSessionResponseMac) {
        buf[buf.length - 1] ^= 0xff;
      }
      this.sendRawToClient(buf);
      return;
    }

    if (header.serviceType === KNXnetIPServiceType.SECURE_WRAPPER) {
      const unwrapped = SecureWrapper.unwrap(frame, this.sessionKey!);
      const inner = unwrapped.innerFrame;
      const innerHeader = KNXnetIPHeader.fromBuffer(inner);
      this.receivedWrappedServices.push(innerHeader.serviceType);

      if (innerHeader.serviceType === KNXnetIPServiceType.SESSION_AUTHENTICATE) {
        const auth = SessionAuthenticate.fromBuffer(inner);
        const expectedUserKey = deriveUserPasswordKey(this.opts.userPassword ?? "secret");
        const ok = auth.verifyMac(this.clientPublicKey!, this.serverKeys.publicKeyRaw, expectedUserKey);
        const statusVal = ok
          ? SecureSessionStatus.STATUS_AUTHENTICATION_SUCCESS
          : SecureSessionStatus.STATUS_AUTHENTICATION_FAILED;

        let statusBuf = new SessionStatus(statusVal).toBuffer();
        if (this.opts.use7ByteSessionStatus) {
          statusBuf = Buffer.from([0x06, 0x10, 0x09, 0x54, 0x00, 0x07, statusVal]);
        }
        this.sendRawToClient(this.wrapFromServer(statusBuf));
        return;
      }

      if (innerHeader.serviceType === KNXnetIPServiceType.SESSION_STATUS) {
        const st = SessionStatus.fromBuffer(inner);
        this.lastSessionStatusFromClient = st.status;
        return;
      }

      this.handleInnerKnxFrame(inner, true);
    }
  }

  private handleInnerKnxFrame(inner: Buffer, wrapReply: boolean): void {
    const header = KNXnetIPHeader.fromBuffer(inner);
    if (header.serviceType === KNXnetIPServiceType.CONNECT_REQUEST) {
      const hpai = HPAI.NULL_TCP_HPAI.toBuffer();
      const crd = new CRD(ConnectionType.TUNNEL_CONNECTION, 0x11fa).toBuffer(); // 1.1.250
      const respHeader = new KNXnetIPHeader(
        KNXnetIPServiceType.CONNECT_RESPONSE,
        6 + 2 + hpai.length + crd.length,
      );
      const resp = Buffer.concat([
        respHeader.toBuffer(),
        Buffer.from([this.channelId, KNXnetIPErrorCodes.E_NO_ERROR]),
        hpai,
        crd,
      ]);
      this.sendRawToClient(wrapReply ? this.wrapFromServer(resp) : resp);
      return;
    }

    if (header.serviceType === KNXnetIPServiceType.TUNNELLING_ACK) {
      this.receivedTunnelAcks++;
      return;
    }

    if (header.serviceType === KNXnetIPServiceType.DISCONNECT_REQUEST) {
      const respHeader = new KNXnetIPHeader(KNXnetIPServiceType.DISCONNECT_RESPONSE, 8);
      const resp = Buffer.concat([
        respHeader.toBuffer(),
        Buffer.from([this.channelId, KNXnetIPErrorCodes.E_NO_ERROR]),
      ]);
      this.sendRawToClient(wrapReply ? this.wrapFromServer(resp) : resp);
    }
  }

  public buildTunnelIndicationFrame(seq: number = 0): Buffer {
    // GroupValue_Write 1/1/1 = 1 from 1.1.1
    const cemi = Buffer.from("2900bce011010901010081", "hex");
    const connHeader = Buffer.from([0x04, this.channelId, seq & 0xff, 0x00]);
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.TUNNELLING_REQUEST,
      6 + connHeader.length + cemi.length,
    );
    return Buffer.concat([header.toBuffer(), connHeader, cemi]);
  }
}

describe("KNXTunneling TCP & KNX IP Secure Unicast (03_08_04 §2.6.2 & 03_08_09)", () => {
  let simServer: SimulatedSecureTcpServer | null = null;
  let client: KNXTunneling | null = null;

  afterEach(async () => {
    if (client) {
      client.disconnect();
      client = null;
    }
    if (simServer) {
      await simServer.stop();
      simServer = null;
    }
  });

  test("Plain TCP mode connects with route-back HPAI, sends without waiting for TUNNELLING_ACK, and sends no ACK on indications", async () => {
    simServer = new SimulatedSecureTcpServer({ secure: false });
    const port = await simServer.start();

    client = new KNXTunneling({
      ip: "127.0.0.1",
      port,
      transport: "TCP",
      autoReconnect: false,
      logOptions: { enabled: false },
    });

    await client.connect();
    expect(client.isConnected).toBe(true);
    expect(client.individualAddress).toBe("1.1.250");

    // Outgoing write over TCP resolves immediately without waiting for TUNNELLING_ACK
    await client.write("1/1/1", "1.001", true);
    await new Promise((r) => setTimeout(r, 30));
    expect(simServer.receivedPlainServices).toContain(KNXnetIPServiceType.TUNNELLING_REQUEST);

    // Two incoming indications with the SAME sequence number (0) must both be delivered and produce 0 ACKs
    const receivedIndications: any[] = [];
    client.on("indication", (cemi) => receivedIndications.push(cemi));

    const indFrame = simServer.buildTunnelIndicationFrame(0);
    simServer.sendRawToClient(indFrame);
    simServer.sendRawToClient(indFrame);

    await new Promise((r) => setTimeout(r, 80));
    expect(receivedIndications).toHaveLength(2);
    expect(simServer.receivedTunnelAcks).toBe(0);
  });

  test("Secure TCP mode completes ECDH + mutual auth handshake, wraps frames, and rejects replays/wrong sessionIds", async () => {
    simServer = new SimulatedSecureTcpServer({
      secure: true,
      userPassword: "secret",
      deviceAuthPassword: "trustme",
      use7ByteSessionStatus: true, // Also exercises 7-byte SESSION_STATUS tolerance
    });
    const port = await simServer.start();

    client = new KNXTunneling({
      ip: "127.0.0.1",
      port,
      autoReconnect: false,
      logOptions: { enabled: false },
      secure: {
        userId: 2,
        userPassword: "secret",
        deviceAuthenticationPassword: " trustme ", // Also exercises whitespace trim fallback
        requireDeviceAuthentication: true,
      },
    });

    await client.connect();
    expect(client.isConnected).toBe(true);
    expect(client.individualAddress).toBe("1.1.250");

    await client.write("1/1/1", "1.001", true);
    await new Promise((r) => setTimeout(r, 30));
    expect(simServer.receivedWrappedServices).toContain(KNXnetIPServiceType.TUNNELLING_REQUEST);

    const indications: any[] = [];
    client.on("indication", (cemi) => indications.push(cemi));

    const innerInd = simServer.buildTunnelIndicationFrame(0);
    // 1. Valid wrapped indication (seq = 2) -> accepted
    const validWrapper = simServer.wrapFromServer(innerInd, 2n);
    simServer.sendRawToClient(validWrapper);

    // 2. Replayed wrapper (seq = 2 again) -> discarded
    simServer.sendRawToClient(validWrapper);

    // 3. Wrapper with wrong sessionId (seq = 3, sid = 0x9999) -> discarded
    simServer.sendRawToClient(simServer.wrapFromServer(innerInd, 3n, 0x9999));

    // 4. Plaintext frame inside secure session -> discarded
    simServer.sendRawToClient(innerInd);

    // 5. Next valid wrapped indication (seq = 4) -> accepted
    simServer.sendRawToClient(simServer.wrapFromServer(innerInd, 4n));

    await new Promise((r) => setTimeout(r, 100));
    expect(indications).toHaveLength(2);

    // Disconnect sends wrapped DISCONNECT_REQUEST and wrapped SESSION_STATUS(STATUS_CLOSE = 0x05)
    client.disconnect();
    await new Promise((r) => setTimeout(r, 80));
    expect(simServer.lastSessionStatusFromClient).toBe(SecureSessionStatus.STATUS_CLOSE);
    client = null;
  });

  test("Secure TCP mode rejects forged SESSION_RESPONSE MAC when deviceAuthenticationPassword is set", async () => {
    simServer = new SimulatedSecureTcpServer({
      secure: true,
      userPassword: "secret",
      deviceAuthPassword: "trustme",
      corruptSessionResponseMac: true,
    });
    const port = await simServer.start();

    client = new KNXTunneling({
      ip: "127.0.0.1",
      port,
      autoReconnect: false,
      logOptions: { enabled: false },
      secure: {
        userId: 2,
        userPassword: "secret",
        deviceAuthenticationPassword: "trustme",
      },
    });

    await expect(client.connect()).rejects.toThrow(/MAC verification failed/);
  });
});
