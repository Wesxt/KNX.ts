import net from "node:net";
import {
  CEMI,
  ConnectionType,
  KNXnetIPErrorCodes,
  KNXnetIPServiceType,
  KNXTunneling,
  SecureSessionStatus,
  SecureWrapper,
  SessionAuthenticate,
  SessionRequest,
  SessionResponse,
  SessionStatus,
  TcpFrameReader,
  computeSessionKey,
  deriveDeviceAuthenticationCode,
  deriveUserPasswordKey,
  generateX25519KeyPair,
} from "../src";
import { KNXnetIPHeader } from "../src/core/KNXnetIPHeader";
import { CRD, HPAI } from "../src/core/KNXnetIPStructures";

const USER_PASSWORD = process.env.KNX_USER_PASSWORD || "secret";
const DEVICE_AUTH_PASSWORD = process.env.KNX_DEVICE_AUTH || "trustme";
const USER_ID = Number(process.env.KNX_USER_ID) || 2;

/**
 * Simulated KNX IP Secure TCP Server (03_08_04 & 03_08_09).
 * Note: `KNXnetIPServer` currently supports UDP (Tunneling + Secure Routing Multicast) only;
 * this local TCP server implements the KNX IP Secure Unicast handshake so we can exercise
 * `KNXTunneling` in real TCP + KNX Secure mode end-to-end.
 */
class SecureTcpManualServer {
  private server: net.Server | null = null;
  private clientSocket: net.Socket | null = null;
  private reader = new TcpFrameReader();
  public port = 0;

  private readonly serverKeys = generateX25519KeyPair();
  private clientPublicKey: Buffer | null = null;
  private sessionKey: Buffer | null = null;
  private readonly sessionId = 0x0042;
  private readonly channelId = 0x11;
  private readonly serverSerial = Buffer.from("00fa11223344", "hex");
  private txWrapperSeq = 0n;

  public async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        console.log(`[SecureTCP Server] Client TCP socket connected from ${socket.remoteAddress}:${socket.remotePort}`);
        this.clientSocket = socket;
        this.reader.reset();

        socket.on("error", (err) => console.error("[SecureTCP Server] Socket error:", err.message));
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

  public wrapAndSend(innerFrame: Buffer): void {
    const seq = this.txWrapperSeq++;
    const wrapped = SecureWrapper.wrap({
      sessionId: this.sessionId,
      sequenceNumber: seq,
      serialNumber: this.serverSerial,
      innerFrame,
      key: this.sessionKey!,
    });
    this.clientSocket?.write(wrapped);
  }

  public sendTunnelIndication(cemiHex = "2900bce011010901010081", seq = 0): void {
    const cemi = Buffer.from(cemiHex, "hex");
    const connHeader = Buffer.from([0x04, this.channelId, seq & 0xff, 0x00]);
    const header = new KNXnetIPHeader(
      KNXnetIPServiceType.TUNNELLING_REQUEST,
      6 + connHeader.length + cemi.length,
    );
    const frame = Buffer.concat([header.toBuffer(), connHeader, cemi]);
    console.log(`[SecureTCP Server] Sending wrapped TUNNELLING_REQUEST (L_Data.ind 1/1/1 = true)`);
    this.wrapAndSend(frame);
  }

  private onFrame(frame: Buffer): void {
    const header = KNXnetIPHeader.fromBuffer(frame);

    if (header.serviceType === KNXnetIPServiceType.SESSION_REQUEST) {
      const req = SessionRequest.fromBuffer(frame);
      this.clientPublicKey = req.clientPublicKey;
      this.sessionKey = computeSessionKey(this.serverKeys.privateKey, this.clientPublicKey);
      this.txWrapperSeq = 0n;

      console.log("[SecureTCP Server] <- Received SESSION_REQUEST (X25519 ECDH)");
      console.log("[SecureTCP Server]    Derived AES-128 Session Key:", this.sessionKey.toString("hex"));

      const devAuthCode = deriveDeviceAuthenticationCode(DEVICE_AUTH_PASSWORD);
      const resp = SessionResponse.createAuthenticated(
        this.sessionId,
        this.serverKeys.publicKeyRaw,
        this.clientPublicKey,
        devAuthCode,
      );
      console.log(`[SecureTCP Server] -> Sending SESSION_RESPONSE (Session ID: 0x${this.sessionId.toString(16).padStart(4, "0")})`);
      this.clientSocket?.write(resp.toBuffer());
      return;
    }

    if (header.serviceType === KNXnetIPServiceType.SECURE_WRAPPER) {
      const unwrapped = SecureWrapper.unwrap(frame, this.sessionKey!);
      const inner = unwrapped.innerFrame;
      const innerHeader = KNXnetIPHeader.fromBuffer(inner);

      if (innerHeader.serviceType === KNXnetIPServiceType.SESSION_AUTHENTICATE) {
        const auth = SessionAuthenticate.fromBuffer(inner);
        const expectedUserKey = deriveUserPasswordKey(USER_PASSWORD);
        const ok = auth.verifyMac(this.clientPublicKey!, this.serverKeys.publicKeyRaw, expectedUserKey);
        const statusVal = ok
          ? SecureSessionStatus.STATUS_AUTHENTICATION_SUCCESS
          : SecureSessionStatus.STATUS_AUTHENTICATION_FAILED;

        console.log(`[SecureTCP Server] <- Received SECURE_WRAPPER(SESSION_AUTHENTICATE) userId=${auth.userId}, valid=${ok}`);
        console.log(`[SecureTCP Server] -> Sending SECURE_WRAPPER(SESSION_STATUS=${ok ? "SUCCESS" : "FAILED"})`);
        this.wrapAndSend(new SessionStatus(statusVal).toBuffer());
        return;
      }

      if (innerHeader.serviceType === KNXnetIPServiceType.CONNECT_REQUEST) {
        console.log("[SecureTCP Server] <- Received SECURE_WRAPPER(CONNECT_REQUEST)");
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
        console.log("[SecureTCP Server] -> Sending SECURE_WRAPPER(CONNECT_RESPONSE, IA=1.1.250)");
        this.wrapAndSend(resp);
        return;
      }

      if (innerHeader.serviceType === KNXnetIPServiceType.TUNNELLING_REQUEST) {
        const cemiBuf = inner.subarray(10);
        const cemi = CEMI.fromBuffer(cemiBuf) as any;
        console.log(
          `[SecureTCP Server] <- Received SECURE_WRAPPER(TUNNELLING_REQUEST): ${cemi.sourceAddress} -> ${cemi.destinationAddress} (raw=${cemiBuf.toString("hex")})`,
        );
        return;
      }

      if (innerHeader.serviceType === KNXnetIPServiceType.DISCONNECT_REQUEST) {
        console.log("[SecureTCP Server] <- Received SECURE_WRAPPER(DISCONNECT_REQUEST)");
        const respHeader = new KNXnetIPHeader(KNXnetIPServiceType.DISCONNECT_RESPONSE, 8);
        const resp = Buffer.concat([
          respHeader.toBuffer(),
          Buffer.from([this.channelId, KNXnetIPErrorCodes.E_NO_ERROR]),
        ]);
        this.wrapAndSend(resp);
        return;
      }
    }
  }
}

async function main() {
  console.log("==================================================================");
  console.log("  KNX IP Secure TCP Manual Test (Simulated Server + KNXTunneling)");
  console.log("==================================================================\n");

  const server = new SecureTcpManualServer();
  const port = await server.start();
  console.log(`[SecureTCP Server] Listening on 127.0.0.1:${port}\n`);

  const client = new KNXTunneling({
    ip: "127.0.0.1",
    port,
    transport: "TCP",
    autoReconnect: false,
    logOptions: { level: "info", enabled: true },
    secure: {
      userId: USER_ID,
      userPassword: USER_PASSWORD,
      deviceAuthenticationPassword: DEVICE_AUTH_PASSWORD,
      requireDeviceAuthentication: true,
    },
  });

  client.on("indication", (cemi: any) => {
    console.log(
      `[TunnelClient] <- Decrypted indication received: ${cemi.sourceAddress} -> ${cemi.destinationAddress}`,
    );
  });

  client.on("error", (err) => {
    console.error("[TunnelClient] Error:", err.message);
  });

  try {
    console.log("[TunnelClient] Connecting via TCP + KNX IP Secure...");
    await client.connect();
    console.log(`[TunnelClient] Connected! Assigned IA: ${client.individualAddress}\n`);

    console.log('[TunnelClient] -> Sending encrypted write("1/1/1", "1.001", true)...');
    await client.write("1/1/1", "1.001", true);
    await new Promise((r) => setTimeout(r, 150));

    server.sendTunnelIndication();
    await new Promise((r) => setTimeout(r, 150));

    console.log("\n[TunnelClient] Disconnecting...");
    client.disconnect();
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    await server.stop();
    console.log("[SecureTCP Server] Stopped.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
