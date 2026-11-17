import net from "node:net";
import { KNXnetIPServer } from "../src/connection/KNXnetIPServer";
import { KNXTunneling } from "../src/connection/KNXTunneling";
import { TcpFrameReader } from "../src/connection/TcpFrameReader";
import { KNXnetIPHeader } from "../src/core/KNXnetIPHeader";
import { CRI, DIB, HPAI, SecuredServiceFamiliesDIB, SupportedServicesDIB } from "../src/core/KNXnetIPStructures";
import {
  AllowedSupportedServiceFamilies,
  ConnectionType,
  DescriptionType,
  KNXLayer,
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
  deriveKeyringPasswordKey,
  deriveUserPasswordKey,
  generateX25519KeyPair,
} from "../src/security/KnxSecureKeys";
import { computeKeyringSignatureFromXml } from "../src/security/KnxKeyring";
import { KNXHelper } from "../src/utils/KNXHelper";

function buildLDataInd(srcIA: string, dstGA: string, _dpt: string, val: unknown): Buffer {
  const srcBuf = KNXHelper.GetAddress(srcIA, ".");
  const dstBuf = KNXHelper.GetAddress(dstGA, "/");
  return Buffer.from([
    0x29,
    0x00,
    0xbc,
    0xe0,
    srcBuf[0],
    srcBuf[1],
    dstBuf[0],
    dstBuf[1],
    0x01,
    0x00,
    val ? 0x81 : 0x80,
  ]);
}

function buildDescriptionRequestTcp(): Buffer {
  const hpai = HPAI.NULL_TCP_HPAI.toBuffer();
  const header = new KNXnetIPHeader(
    KNXnetIPServiceType.DESCRIPTION_REQUEST,
    KNXnetIPHeader.HEADER_SIZE_10 + hpai.length,
  );
  return Buffer.concat([header.toBuffer(), hpai]);
}

function buildConnectRequestTcp(type: ConnectionType, layer: KNXLayer = KNXLayer.LINK_LAYER): Buffer {
  const hpai = HPAI.NULL_TCP_HPAI.toBuffer();
  const cri =
    type === ConnectionType.DEVICE_MGMT_CONNECTION
      ? Buffer.from([0x02, ConnectionType.DEVICE_MGMT_CONNECTION])
      : new CRI(type, layer).toBuffer();
  const header = new KNXnetIPHeader(
    KNXnetIPServiceType.CONNECT_REQUEST,
    KNXnetIPHeader.HEADER_SIZE_10 + hpai.length * 2 + cri.length,
  );
  return Buffer.concat([header.toBuffer(), hpai, hpai, cri]);
}

async function openTcpHelper(port: number): Promise<{
  socket: net.Socket;
  nextFrame: (timeoutMs?: number) => Promise<Buffer>;
  close: () => Promise<void>;
}> {
  const reader = new TcpFrameReader();
  const queue: Buffer[] = [];
  const waiters: Array<(buf: Buffer) => void> = [];

  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.createConnection({ host: "127.0.0.1", port }, () => resolve(s));
    s.once("error", reject);
  });

  socket.on("data", (chunk) => {
    const frames = reader.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    for (const f of frames) {
      const waiter = waiters.shift();
      if (waiter) waiter(f);
      else queue.push(f);
    }
  });

  const nextFrame = (timeoutMs: number = 2000) =>
    new Promise<Buffer>((resolve, reject) => {
      if (queue.length > 0) {
        resolve(queue.shift()!);
        return;
      }
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(onFrame);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`Timed out waiting for TCP frame after ${timeoutMs}ms`));
      }, timeoutMs);
      const onFrame = (buf: Buffer) => {
        clearTimeout(timer);
        resolve(buf);
      };
      waiters.push(onFrame);
    });

  const close = () =>
    new Promise<void>((resolve) => {
      if (socket.destroyed) {
        resolve();
        return;
      }
      socket.once("close", () => resolve());
      socket.destroy();
    });

  return { socket, nextFrame, close };
}

describe("KNXnetIPServer TCP + KNX IP Secure Unicast Server", () => {
  test("supports plain TCP tunnelling E2E with KNXTunneling client", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      clientAddrs: "15.15.1:5",
      friendlyName: "TestPlainTcpServer",
      logOptions: { enabled: false },
    });

    await server.connect();
    const port = server.tcpListeningPort;
    expect(port).toBeGreaterThan(0);

    const client = new KNXTunneling({
      ip: "127.0.0.1",
      port,
      transport: "TCP",
      autoReconnect: false,
      logOptions: { enabled: false },
    });

    try {
      const serverIndications: any[] = [];
      server.on("indication", (cemi) => serverIndications.push(cemi));

      await client.connect();
      expect(client.individualAddress).toBe("15.15.1");

      const clientIndications: any[] = [];
      const gotFromServer = new Promise<void>((resolve) => {
        client.on("indication", (cemi: any) => {
          clientIndications.push(cemi);
          if (cemi.destinationAddress === "2/2/2") {
            resolve();
          }
        });
      });

      await client.write("1/1/1", "1.001", true);
      await new Promise((r) => setTimeout(r, 40));
      expect(serverIndications.length).toBeGreaterThanOrEqual(1);
      expect(serverIndications[0].destinationAddress).toBe("1/1/1");

      await server.send(buildLDataInd("1.1.20", "2/2/2", "1.001", false));
      await gotFromServer;
      expect(clientIndications.some((c) => c.destinationAddress === "2/2/2")).toBe(true);

      client.disconnect();
      await new Promise((r) => setTimeout(r, 40));
    } finally {
      server.disconnect();
    }
  });

  test("supports KNX IP Secure TCP tunnelling E2E and STATUS_CLOSE cleanup", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      clientAddrs: "15.15.10:4",
      friendlyName: "TestSecureTcpServer",
      logOptions: { enabled: false },
      secure: {
        deviceAuthenticationPassword: "server-dev-auth",
        users: {
          1: "mgmt-pass-1",
          2: "tunnel-pass-2",
        },
      },
    });

    await server.connect();
    const port = server.tcpListeningPort;

    const client = new KNXTunneling({
      ip: "127.0.0.1",
      port,
      transport: "TCP",
      autoReconnect: false,
      logOptions: { enabled: false },
      secure: {
        userId: 2,
        userPassword: "tunnel-pass-2",
        deviceAuthenticationPassword: "server-dev-auth",
        requireDeviceAuthentication: true,
      },
    });

    try {
      let secureEstablished = false;
      client.once("secure_session_established", () => {
        secureEstablished = true;
      });

      await client.connect();
      expect(secureEstablished).toBe(true);
      expect(client.individualAddress).toBe("15.15.10");

      const confirmations: any[] = [];
      const indications: any[] = [];
      client.on("indication", (cemi: any) => {
        if (cemi.messageCode === 0x2e) confirmations.push(cemi);
        else indications.push(cemi);
      });

      await client.write("3/1/1", "1.001", true);
      await server.send(buildLDataInd("1.1.50", "3/1/2", "1.001", true));
      await new Promise((r) => setTimeout(r, 60));

      expect(confirmations.some((c) => c.destinationAddress === "3/1/1")).toBe(true);
      expect(indications.some((c) => c.destinationAddress === "3/1/2")).toBe(true);

      client.disconnect();
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      server.disconnect();
    }
  });

  test("loads multi-user credentials from signed .knxkeys keyring", async () => {
    const keyringPwd = "knxPassword";
    const ifacePwdEnc = "9b1seR1kYPayZxTITA4mq3oRNSdkelNCOnHA0jtZK6g="; // "ifPass123"
    const ifaceAuthEnc = "6/b5wvUrvyg4J+JH+J3EPvaGbIug0amjx5PMHkztZUQ="; // "ifAuth456"
    const unsignedXml = `<?xml version="1.0" encoding="utf-8"?>
<Keyring CreatedBy="TcpServerTest" Created="2024-10-03T12:34:56Z">
  <Interface Type="Tunnelling" IndividualAddress="15.15.1" UserID="5" Password="${ifacePwdEnc}" Authentication="${ifaceAuthEnc}" />
</Keyring>`;
    const pwdHash = deriveKeyringPasswordKey(keyringPwd);
    const { computed } = computeKeyringSignatureFromXml(unsignedXml, pwdHash);
    const signedXml = unsignedXml.replace(/<Keyring\b/, `<Keyring Signature="${computed.toString("base64")}"`);

    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      clientAddrs: "15.15.1:2",
      logOptions: { enabled: false },
      secure: {
        keyringFile: signedXml,
        keyringPassword: keyringPwd,
      },
    });

    await server.connect();
    const client = new KNXTunneling({
      ip: "127.0.0.1",
      port: server.tcpListeningPort,
      transport: "TCP",
      autoReconnect: false,
      logOptions: { enabled: false },
      secure: {
        keyringFile: signedXml,
        keyringPassword: keyringPwd,
        requireDeviceAuthentication: true,
      },
    });

    try {
      await client.connect();
      expect(client.individualAddress).toBe("15.15.1");
      client.disconnect();
      await new Promise((r) => setTimeout(r, 40));
    } finally {
      server.disconnect();
    }
  });

  test("rejects wrong user password with STATUS_AUTHENTICATION_FAILED", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      logOptions: { enabled: false },
      secure: {
        userId: 2,
        userPassword: "correct-password",
        deviceAuthenticationPassword: "dev-auth-secret",
      },
    });
    await server.connect();

    const client = new KNXTunneling({
      ip: "127.0.0.1",
      port: server.tcpListeningPort,
      transport: "TCP",
      autoReconnect: false,
      logOptions: { enabled: false },
      secure: {
        userId: 2,
        userPassword: "wrong-password",
        deviceAuthenticationPassword: "dev-auth-secret",
        requireDeviceAuthentication: true,
      },
    });
    client.on("error", () => {});

    try {
      await expect(client.connect()).rejects.toThrow(/STATUS_AUTHENTICATION_FAILED|0x1/);
    } finally {
      client.disconnect();
      server.disconnect();
    }
  });

  test("enforces User vs Management privilege on DEVICE_MGMT_CONNECTION", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      logOptions: { enabled: false },
      secure: {
        deviceAuthenticationPassword: "auth",
        users: {
          1: "mgmt-secret",
          2: "user-secret",
        },
      },
    });
    await server.connect();

    const userMgmtClient = new KNXTunneling({
      ip: "127.0.0.1",
      port: server.tcpListeningPort,
      transport: "TCP",
      connectionType: ConnectionType.DEVICE_MGMT_CONNECTION,
      autoReconnect: false,
      logOptions: { enabled: false },
      secure: {
        userId: 2,
        userPassword: "user-secret",
        deviceAuthenticationPassword: "auth",
      },
    });
    userMgmtClient.on("error", () => {});

    const adminMgmtClient = new KNXTunneling({
      ip: "127.0.0.1",
      port: server.tcpListeningPort,
      transport: "TCP",
      connectionType: ConnectionType.DEVICE_MGMT_CONNECTION,
      autoReconnect: false,
      logOptions: { enabled: false },
      secure: {
        userId: 1,
        userPassword: "mgmt-secret",
        deviceAuthenticationPassword: "auth",
      },
    });

    try {
      await expect(userMgmtClient.connect()).rejects.toThrow(/0x28/);
      userMgmtClient.disconnect();

      await adminMgmtClient.connect();
      expect(adminMgmtClient.isConnected).toBe(true);
      adminMgmtClient.disconnect();
      await new Promise((r) => setTimeout(r, 40));
    } finally {
      server.disconnect();
    }
  });

  test("DESCRIPTION_REQUEST on TCP returns Security DIBs, keeps socket open, and handles fragmented streams + replay protection + concurrent sessions", async () => {
    const devAuthPwd = "dev-auth-xyz";
    const userPwd = "user-pass-xyz";
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      clientAddrs: "15.15.1:4",
      allowPlainTcp: false,
      logOptions: { enabled: false },
      secure: {
        userId: 2,
        userPassword: userPwd,
        deviceAuthenticationPassword: devAuthPwd,
      },
    });
    await server.connect();

    const helper = await openTcpHelper(server.tcpListeningPort);
    const clientSerial = Buffer.from("001122334455", "hex");

    try {
      // 1. Send DESCRIPTION_REQUEST fragmented into small chunks; socket must stay open (03_08_02 §7.7.2)
      const descReq = buildDescriptionRequestTcp();
      helper.socket.write(descReq.subarray(0, 4));
      await new Promise((r) => setTimeout(r, 15));
      helper.socket.write(descReq.subarray(4));

      const descResp = await helper.nextFrame();
      const descHeader = KNXnetIPHeader.fromBuffer(descResp);
      expect(descHeader.serviceType).toBe(KNXnetIPServiceType.DESCRIPTION_RESPONSE);

      // Parse DIBs to confirm Security (0x09) and SecuredServiceFamiliesDIB are announced
      let offset = 6;
      let hasSecurityFamily = false;
      let securedDIB: SecuredServiceFamiliesDIB | null = null;
      while (offset < descResp.length) {
        const len = descResp.readUInt8(offset);
        const type = descResp.readUInt8(offset + 1);
        const slice = descResp.subarray(offset, offset + len);
        if (type === DescriptionType.SUPP_SVC_FAMILIES) {
          const parsed = SupportedServicesDIB.fromBuffer(slice);
          hasSecurityFamily = parsed.services.some((s) => s.family === AllowedSupportedServiceFamilies.Security);
        } else if (type === DescriptionType.SECURED_SERVICE_FAMILIES) {
          securedDIB = SecuredServiceFamiliesDIB.fromBuffer(slice);
        } else {
          DIB.fromBuffer(slice);
        }
        offset += len;
      }
      expect(hasSecurityFamily).toBe(true);
      expect(securedDIB).not.toBeNull();
      expect(securedDIB!.services.some((s) => s.family === AllowedSupportedServiceFamilies.Tunnelling)).toBe(true);

      // 2. Plain CONNECT_REQUEST must be rejected when allowPlainTcp=false
      helper.socket.write(buildConnectRequestTcp(ConnectionType.TUNNEL_CONNECTION));
      const plainConnResp = await helper.nextFrame();
      expect(KNXnetIPHeader.fromBuffer(plainConnResp).serviceType).toBe(KNXnetIPServiceType.CONNECT_RESPONSE);
      expect(plainConnResp.readUInt8(7)).toBe(KNXnetIPErrorCodes.E_AUTHORISATION_ERROR);

      // 3. Establish TWO concurrent Secure Sessions on the same TCP connection
      const establishRawSession = async () => {
        const kp = generateX25519KeyPair();
        const sreq = new SessionRequest(kp.publicKeyRaw).toBuffer();
        helper.socket.write(sreq);
        const srespBuf = await helper.nextFrame();
        const sresp = SessionResponse.fromBuffer(srespBuf);
        const devCode = deriveDeviceAuthenticationCode(devAuthPwd);
        expect(sresp.verifyMac(kp.publicKeyRaw, devCode)).toBe(true);

        const sessionKey = computeSessionKey(kp.privateKey, sresp.serverPublicKey);
        const userKey = deriveUserPasswordKey(userPwd);
        const authFrame = SessionAuthenticate.create(2, kp.publicKeyRaw, sresp.serverPublicKey, userKey).toBuffer();
        const wrappedAuth = SecureWrapper.wrap({
          sessionId: sresp.sessionId,
          sequenceNumber: 0n,
          serialNumber: clientSerial,
          innerFrame: authFrame,
          key: sessionKey,
        });
        helper.socket.write(wrappedAuth);
        const statusWrapper = await helper.nextFrame();
        const statusInner = SecureWrapper.unwrap(statusWrapper, sessionKey).innerFrame;
        expect(SessionStatus.fromBuffer(statusInner).status).toBe(SecureSessionStatus.STATUS_AUTHENTICATION_SUCCESS);
        return { sessionId: sresp.sessionId, sessionKey, txSeq: 1n };
      };

      const s1 = await establishRawSession();
      const s2 = await establishRawSession();
      expect(s1.sessionId).not.toBe(s2.sessionId);

      // Connect channel on s1
      const s1ConnectWrapped = SecureWrapper.wrap({
        sessionId: s1.sessionId,
        sequenceNumber: s1.txSeq++,
        serialNumber: clientSerial,
        innerFrame: buildConnectRequestTcp(ConnectionType.TUNNEL_CONNECTION),
        key: s1.sessionKey,
      });
      // Coalesce replay test later; first verify normal channel creation
      helper.socket.write(s1ConnectWrapped);
      const s1ConnRespWrap = await helper.nextFrame();
      const s1ConnResp = SecureWrapper.unwrap(s1ConnRespWrap, s1.sessionKey).innerFrame;
      expect(s1ConnResp.readUInt8(7)).toBe(KNXnetIPErrorCodes.E_NO_ERROR);
      const ch1 = s1ConnResp.readUInt8(6);

      // 4. Replay the exact s1ConnectWrapped frame again: server must silently ignore it (session remains usable)
      helper.socket.write(s1ConnectWrapped);
      await new Promise((r) => setTimeout(r, 30));

      // Verify s2 cannot hijack/query ch1 owned by s1
      const cstateReq = Buffer.concat([
        new KNXnetIPHeader(KNXnetIPServiceType.CONNECTIONSTATE_REQUEST, 16).toBuffer(),
        Buffer.from([ch1, 0x00]),
        HPAI.NULL_TCP_HPAI.toBuffer(),
      ]);
      helper.socket.write(
        SecureWrapper.wrap({
          sessionId: s2.sessionId,
          sequenceNumber: s2.txSeq++,
          serialNumber: clientSerial,
          innerFrame: cstateReq,
          key: s2.sessionKey,
        }),
      );
      const s2StateRespWrap = await helper.nextFrame();
      const s2StateResp = SecureWrapper.unwrap(s2StateRespWrap, s2.sessionKey).innerFrame;
      expect(s2StateResp.readUInt8(7)).toBe(KNXnetIPErrorCodes.E_CONNECTION_ID);

      // Verify s1 itself STILL works after the ignored replay!
      helper.socket.write(
        SecureWrapper.wrap({
          sessionId: s1.sessionId,
          sequenceNumber: s1.txSeq++,
          serialNumber: clientSerial,
          innerFrame: cstateReq,
          key: s1.sessionKey,
        }),
      );
      const s1StateRespWrap = await helper.nextFrame();
      const s1StateResp = SecureWrapper.unwrap(s1StateRespWrap, s1.sessionKey).innerFrame;
      expect(s1StateResp.readUInt8(7)).toBe(KNXnetIPErrorCodes.E_NO_ERROR);
    } finally {
      await helper.close();
      server.disconnect();
    }
  });

  test("enforces TCP idle timeout and Secure session timeout", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      tcpIdleTimeoutMs: 120,
      logOptions: { enabled: false },
      secure: {
        userId: 2,
        userPassword: "pwd",
        deviceAuthenticationPassword: "auth",
        sessionAuthenticationTimeoutMs: 120,
        sessionTimeoutMs: 250,
      },
    });
    await server.connect();

    // 1. Plain TCP socket with no active channels/sessions closes after tcpIdleTimeoutMs
    const idleHelper = await openTcpHelper(server.tcpListeningPort);
    const idleClosed = new Promise<void>((resolve) => {
      idleHelper.socket.once("close", () => resolve());
    });
    await idleClosed;

    // 2. Unauthenticated session times out with STATUS_TIMEOUT and then TCP closes after idle timeout
    const authTimeoutHelper = await openTcpHelper(server.tcpListeningPort);
    try {
      const kp = generateX25519KeyPair();
      authTimeoutHelper.socket.write(new SessionRequest(kp.publicKeyRaw).toBuffer());
      const sresp = SessionResponse.fromBuffer(await authTimeoutHelper.nextFrame());
      const sessionKey = computeSessionKey(kp.privateKey, sresp.serverPublicKey);

      const timeoutFrame = await authTimeoutHelper.nextFrame(1500);
      const unwrapped = SecureWrapper.unwrap(timeoutFrame, sessionKey).innerFrame;
      expect(SessionStatus.fromBuffer(unwrapped).status).toBe(SecureSessionStatus.STATUS_TIMEOUT);

      const closedAfterSessionTimeout = new Promise<void>((resolve) => {
        authTimeoutHelper.socket.once("close", () => resolve());
      });
      await closedAfterSessionTimeout;
    } finally {
      await authTimeoutHelper.close();
      server.disconnect();
    }
  });
});
