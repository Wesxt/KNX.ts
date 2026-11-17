import dgram from "node:dgram";
import net from "node:net";
import { KNXnetIPServer } from "../src/connection/KNXnetIPServer";
import { KNXTunneling } from "../src/connection/KNXTunneling";
import { TcpFrameReader } from "../src/connection/TcpFrameReader";
import { CEMI } from "../src/core/CEMI";
import { KNXnetIPHeader } from "../src/core/KNXnetIPHeader";
import {
  CRI,
  DIB,
  HPAI,
  SRP,
  SecuredServiceFamiliesDIB,
  SupportedServicesDIB,
  TunnellingInfoDIB,
} from "../src/core/KNXnetIPStructures";
import {
  AllowedSupportedServiceFamilies,
  ConnectionType,
  DescriptionType,
  HostProtocolCode,
  InterfaceFeatureId,
  KNXLayer,
  KNXnetIPErrorCodes,
  KNXnetIPServiceType,
  SRPType,
  SecureSessionStatus,
  TunnellingFeatureReturnCode,
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

function buildSearchRequestExtendedTcp(srps: SRP[] = []): Buffer {
  const hpai = HPAI.NULL_TCP_HPAI.toBuffer();
  const srpBufs = srps.map((s) => s.toBuffer());
  const body = Buffer.concat([hpai, ...srpBufs]);
  const header = new KNXnetIPHeader(
    KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED,
    KNXnetIPHeader.HEADER_SIZE_10 + body.length,
  );
  return Buffer.concat([header.toBuffer(), body]);
}

function parseDibs(
  buffer: Buffer,
  startOffset: number,
): {
  supported: SupportedServicesDIB | null;
  secured: SecuredServiceFamiliesDIB | null;
  tunnellingInfo: TunnellingInfoDIB | null;
  types: number[];
} {
  let offset = startOffset;
  let supported: SupportedServicesDIB | null = null;
  let secured: SecuredServiceFamiliesDIB | null = null;
  let tunnellingInfo: TunnellingInfoDIB | null = null;
  const types: number[] = [];

  while (offset < buffer.length) {
    const len = buffer.readUInt8(offset);
    const type = buffer.readUInt8(offset + 1);
    types.push(type);
    const slice = buffer.subarray(offset, offset + len);
    if (type === DescriptionType.SUPP_SVC_FAMILIES) {
      supported = SupportedServicesDIB.fromBuffer(slice);
    } else if (type === DescriptionType.SECURED_SERVICE_FAMILIES) {
      secured = SecuredServiceFamiliesDIB.fromBuffer(slice);
    } else if (type === DescriptionType.TUNNELLING_INFO) {
      tunnellingInfo = TunnellingInfoDIB.fromBuffer(slice);
    } else {
      DIB.fromBuffer(slice);
    }
    offset += len;
  }

  return { supported, secured, tunnellingInfo, types };
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

      // 03_08_02 Tables 3-5 & 08_TSSK §2.6.20: DESCRIPTION_RESPONSE reports Core v2 / Tunnelling v2
      // and pre-security DIBs only (no Security 0x09 or SecuredServiceFamiliesDIB)
      const descDibs = parseDibs(descResp, 6);
      expect(descDibs.supported?.services.find((s) => s.family === AllowedSupportedServiceFamilies.Core)?.version).toBe(
        2,
      );
      expect(
        descDibs.supported?.services.find((s) => s.family === AllowedSupportedServiceFamilies.Tunnelling)?.version,
      ).toBe(2);
      expect(descDibs.supported?.services.some((s) => s.family === AllowedSupportedServiceFamilies.Security)).toBe(
        false,
      );
      expect(descDibs.secured).toBeNull();
      expect(descDibs.tunnellingInfo).toBeNull();
      expect(descDibs.types).not.toContain(DescriptionType.DEVICE_INFO_EXTENDED);

      // 1b. SEARCH_REQUEST_EXTENDED on TCP returns Security (0x09), SecuredServiceFamiliesDIB,
      // TunnellingInfoDIB (usable=true, authorised=false outside session) and UDP control HPAI
      helper.socket.write(buildSearchRequestExtendedTcp());
      const searchExtResp = await helper.nextFrame();
      expect(KNXnetIPHeader.fromBuffer(searchExtResp).serviceType).toBe(KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED);
      const advertisedHPAI = HPAI.fromBuffer(searchExtResp.subarray(6, 14));
      expect(advertisedHPAI.protocol).toBe(HostProtocolCode.IPV4_UDP);

      const extDibs = parseDibs(searchExtResp, 14);
      expect(extDibs.supported?.services.find((s) => s.family === AllowedSupportedServiceFamilies.Core)?.version).toBe(
        2,
      );
      expect(extDibs.supported?.services.some((s) => s.family === AllowedSupportedServiceFamilies.Security)).toBe(true);
      expect(extDibs.secured).not.toBeNull();
      expect(extDibs.secured!.services.some((s) => s.family === AllowedSupportedServiceFamilies.Tunnelling)).toBe(true);
      expect(extDibs.tunnellingInfo).not.toBeNull();
      expect(extDibs.tunnellingInfo!.slots[0].status.usable).toBe(true);
      expect(extDibs.tunnellingInfo!.slots[0].status.free).toBe(true);
      expect(extDibs.tunnellingInfo!.slots[0].status.authorised).toBe(false);

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

  test("announces Core v2 when TCP is enabled (Core v1 when disabled) and evaluates SEARCH_REQUEST_EXTENDED SRPs", async () => {
    const serverWithTcp = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      macAddress: "00:11:22:33:44:55",
      logOptions: { enabled: false },
    });
    const serverUdpOnly = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcp: false,
      port: 0,
      individualAddress: "15.15.0",
      logOptions: { enabled: false },
    });

    await serverWithTcp.connect();
    await serverUdpOnly.connect();

    const udpClient = dgram.createSocket("udp4");
    await new Promise<void>((resolve) => udpClient.bind(0, "127.0.0.1", () => resolve()));
    const clientPort = udpClient.address().port;

    const sendUdpAndAwait = (targetPort: number, packet: Buffer, timeoutMs = 300): Promise<Buffer | null> =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          udpClient.removeListener("message", onMsg);
          resolve(null);
        }, timeoutMs);
        const onMsg = (msg: Buffer) => {
          clearTimeout(timer);
          udpClient.removeListener("message", onMsg);
          resolve(msg);
        };
        udpClient.on("message", onMsg);
        udpClient.send(packet, targetPort, "127.0.0.1");
      });

    try {
      const udpHpai = new HPAI(HostProtocolCode.IPV4_UDP, "127.0.0.1", clientPort).toBuffer();

      // 1. SEARCH_REQUEST: Core v2 when TCP enabled, Core v1 when TCP disabled
      const searchReq = Buffer.concat([
        new KNXnetIPHeader(KNXnetIPServiceType.SEARCH_REQUEST, 6 + udpHpai.length).toBuffer(),
        udpHpai,
      ]);

      const respTcp = await sendUdpAndAwait(serverWithTcp.udpListeningPort, searchReq);
      expect(respTcp).not.toBeNull();
      expect(KNXnetIPHeader.fromBuffer(respTcp!).serviceType).toBe(KNXnetIPServiceType.SEARCH_RESPONSE);
      const dibsTcp = parseDibs(respTcp!, 14);
      expect(dibsTcp.supported?.services.find((s) => s.family === AllowedSupportedServiceFamilies.Core)?.version).toBe(
        2,
      );
      expect(
        dibsTcp.supported?.services.find((s) => s.family === AllowedSupportedServiceFamilies.Tunnelling)?.version,
      ).toBe(2);

      const respUdpOnly = await sendUdpAndAwait(serverUdpOnly.udpListeningPort, searchReq);
      expect(respUdpOnly).not.toBeNull();
      const dibsUdpOnly = parseDibs(respUdpOnly!, 14);
      expect(
        dibsUdpOnly.supported?.services.find((s) => s.family === AllowedSupportedServiceFamilies.Core)?.version,
      ).toBe(1);

      // 2. SEARCH_REQUEST_EXTENDED with Select By Service (Core >= 2) matches TCP server, drops UDP-only
      const buildExtUdp = (srps: SRP[]) => {
        const body = Buffer.concat([udpHpai, ...srps.map((s) => s.toBuffer())]);
        return Buffer.concat([
          new KNXnetIPHeader(KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED, 6 + body.length).toBuffer(),
          body,
        ]);
      };

      const selectCoreV2 = new SRP(SRPType.SELECT_BY_SERVICE, Buffer.from([AllowedSupportedServiceFamilies.Core, 2]));
      const extMatch = await sendUdpAndAwait(serverWithTcp.udpListeningPort, buildExtUdp([selectCoreV2]));
      expect(extMatch).not.toBeNull();
      expect(KNXnetIPHeader.fromBuffer(extMatch!).serviceType).toBe(KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED);

      const extMismatch = await sendUdpAndAwait(serverUdpOnly.udpListeningPort, buildExtUdp([selectCoreV2]), 120);
      expect(extMismatch).toBeNull();

      // 3. Select By MAC Address + Request DIBs SRP
      const selectMac = new SRP(SRPType.SELECT_BY_MAC_ADDRESS, Buffer.from("001122334455", "hex"));
      const reqDibs = new SRP(
        SRPType.REQUEST_DIBS,
        Buffer.from([DescriptionType.DEVICE_INFO, DescriptionType.SUPP_SVC_FAMILIES]),
        false,
      );
      const extDibsResp = await sendUdpAndAwait(serverWithTcp.udpListeningPort, buildExtUdp([selectMac, reqDibs]));
      expect(extDibsResp).not.toBeNull();
      const filteredDibs = parseDibs(extDibsResp!, 14);
      expect(filteredDibs.types).toEqual([DescriptionType.DEVICE_INFO, DescriptionType.SUPP_SVC_FAMILIES]);

      // 4. Unknown mandatory SRP (M=1) drops, optional unknown SRP (M=0) responds
      const unknownMandatory = new SRP(0x7e, Buffer.from([0x01, 0x02]), true);
      const unknownOptional = new SRP(0x7e, Buffer.from([0x01, 0x02]), false);
      expect(await sendUdpAndAwait(serverWithTcp.udpListeningPort, buildExtUdp([unknownMandatory]), 120)).toBeNull();
      expect(await sendUdpAndAwait(serverWithTcp.udpListeningPort, buildExtUdp([unknownOptional]))).not.toBeNull();
    } finally {
      udpClient.close();
      serverWithTcp.disconnect();
      serverUdpOnly.disconnect();
    }
  });

  test("KNXTunneling.discover and KNXnetIPServer.discover return full info by default and support SRPs over UDP/TCP", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      clientAddrs: "15.15.1:2",
      macAddress: "AA:BB:CC:DD:EE:FF",
      friendlyName: "DiscoverSrpGateway",
      logOptions: { enabled: false },
      secure: {
        userId: 2,
        userPassword: "pwd",
        deviceAuthenticationPassword: "auth",
      },
    });

    await server.connect();

    try {
      // 0. Default discovery without filters returns all available DIB info
      const defaultDiscover = await KNXTunneling.discover({
        ip: "127.0.0.1",
        port: server.udpListeningPort,
        timeout: 200,
      });
      expect(defaultDiscover).toHaveLength(1);
      expect(defaultDiscover[0].supportsTcp).toBe(true);
      expect(defaultDiscover[0].supportsSecurity).toBe(true);
      expect(defaultDiscover[0].ipConfig?.ipAddress).toBe("127.0.0.1");
      expect(defaultDiscover[0].ipCurrentConfig?.ipAddress).toBe("127.0.0.1");
      expect(defaultDiscover[0].knxAddresses?.additionalIndividualAddresses).toHaveLength(2);
      expect(defaultDiscover[0].knxAddresses?.individualAddressText).toBe("15.15.0");
      expect(defaultDiscover[0].knxAddresses?.additionalIndividualAddressesText).toEqual(["15.15.1", "15.15.2"]);
      expect(defaultDiscover[0].supportedServices?.find((s) => s.family === 2)?.familyName).toBe("Core");
      expect(defaultDiscover[0].ipConfig?.ipCapabilitiesText).toEqual(["BootP"]);
      expect(defaultDiscover[0].ipCurrentConfig?.ipAssignmentMethodText).toBe("BootP");
      expect(defaultDiscover[0].tunnellingInfo?.slots).toHaveLength(2);
      expect(defaultDiscover[0].tunnellingInfo?.slots[0].addressText).toBe("15.15.1");
      expect(defaultDiscover[0].extendedDeviceInfo?.maximalLocalApduLength).toBe(254);
      expect(defaultDiscover[0].extendedDeviceInfo?.deviceDescriptorType0Hex).toBe("0x091A");
      expect(defaultDiscover[0].extendedDeviceInfo?.deviceDescriptorType0Name).toContain("Router");
      expect(defaultDiscover[0].securedServices?.length).toBeGreaterThan(0);

      // KNXnetIPServer.discover also populates full DIB info by default
      const serverDiscover = await KNXnetIPServer.discover(
        "127.0.0.1",
        "127.0.0.1",
        server.udpListeningPort,
        200,
        true,
      );
      expect(serverDiscover).toHaveLength(1);
      expect(serverDiscover[0].supportsTcp).toBe(true);
      expect(serverDiscover[0].knxAddresses?.additionalIndividualAddresses).toHaveLength(2);
      expect(serverDiscover[0].tunnellingInfo?.slots).toHaveLength(2);

      // 1. KNXTunneling.discover over UDP with Select By Service (Core >= 2) + odd-length Request DIBs (padded with 0x00)
      const matched = await KNXTunneling.discover({
        ip: "127.0.0.1",
        port: server.udpListeningPort,
        timeout: 200,
        minService: { family: AllowedSupportedServiceFamilies.Core, version: 2 },
        requestDibs: [DescriptionType.DEVICE_INFO, DescriptionType.SUPP_SVC_FAMILIES, DescriptionType.TUNNELLING_INFO],
      });
      expect(matched).toHaveLength(1);
      expect(matched[0].friendlyName).toBe("DiscoverSrpGateway");
      expect(matched[0].supportsTcp).toBe(true);
      expect(matched[0].supportsSecurity).toBe(true);
      expect(matched[0].tunnellingInfo?.slots).toHaveLength(2);
      expect(matched[0].tunnellingInfo?.slots[0].usable).toBe(true);
      expect(matched[0].ipConfig).toBeUndefined();

      // 2. Select By MAC Address (mismatch returns empty) & Select By Programming Mode (returns empty)
      const macMismatch = await KNXTunneling.discover({
        ip: "127.0.0.1",
        port: server.udpListeningPort,
        timeout: 120,
        macAddress: "11:22:33:44:55:66",
      });
      expect(macMismatch).toHaveLength(0);

      const progMode = await KNXTunneling.discover({
        ip: "127.0.0.1",
        port: server.udpListeningPort,
        timeout: 120,
        programmingModeOnly: true,
      });
      expect(progMode).toHaveLength(0);

      // 3. KNXTunneling.discover over TCP unicast with Select By Service (Security >= 1)
      const tcpDiscovered = await KNXTunneling.discover({
        ip: "127.0.0.1",
        port: server.tcpListeningPort,
        transport: "TCP",
        timeout: 500,
        srps: [
          SRP.selectByMacAddress("AA:BB:CC:DD:EE:FF"),
          SRP.selectByService(AllowedSupportedServiceFamilies.Security, 1),
        ],
      });
      expect(tcpDiscovered).toHaveLength(1);
      expect(tcpDiscovered[0].extendedDeviceInfo?.maximalLocalApduLength).toBe(254);
      expect(
        tcpDiscovered[0].securedServices?.some((s) => s.family === AllowedSupportedServiceFamilies.Tunnelling),
      ).toBe(true);

      const tcpFilteredOut = await KNXTunneling.discover({
        ip: "127.0.0.1",
        port: server.tcpListeningPort,
        transport: "TCP",
        timeout: 200,
        minService: { family: AllowedSupportedServiceFamilies.Core, version: 3 },
      });
      expect(tcpFilteredOut).toHaveLength(0);
    } finally {
      server.disconnect();
    }
  });

  test("TunnellingInfoDIB reports slots by IA without duplicating Extended CRI addresses and auto-assigns free slots", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      clientAddrs: "15.15.1:3",
      logOptions: { enabled: false },
    });
    await server.connect();

    const helper = await openTcpHelper(server.tcpListeningPort);
    const autoClient = new KNXTunneling({
      ip: "127.0.0.1",
      port: server.tcpListeningPort,
      transport: "TCP",
      autoReconnect: false,
      logOptions: { enabled: false },
    });

    try {
      // Connect channel 1 requesting the 3rd slot (15.15.3) via Extended CRI
      const requestedIA = KNXHelper.GetAddress("15.15.3", ".").readUInt16BE(0);
      const hpai = HPAI.NULL_TCP_HPAI.toBuffer();
      const extCri = new CRI(ConnectionType.TUNNEL_CONNECTION, KNXLayer.LINK_LAYER, requestedIA).toBuffer();
      const req = Buffer.concat([
        new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_REQUEST, 6 + hpai.length * 2 + extCri.length).toBuffer(),
        hpai,
        hpai,
        extCri,
      ]);
      helper.socket.write(req);
      const connResp = await helper.nextFrame();
      expect(connResp.readUInt8(7)).toBe(KNXnetIPErrorCodes.E_NO_ERROR);

      // Verify TunnellingInfoDIB lists 15.15.1 (free), 15.15.2 (free), 15.15.3 (occupied), with no duplicates
      const [discovered1] = await KNXTunneling.discover({
        ip: "127.0.0.1",
        port: server.tcpListeningPort,
        transport: "TCP",
        timeout: 500,
      });
      expect(discovered1.tunnellingInfo?.slots.map((s) => ({ addr: s.addressText, free: s.free }))).toEqual([
        { addr: "15.15.1", free: true },
        { addr: "15.15.2", free: true },
        { addr: "15.15.3", free: false },
      ]);

      // Now connect a second client with IA=0 (auto-assign): should get 15.15.1 without colliding
      await autoClient.connect();
      expect(autoClient.individualAddress).toBe("15.15.1");

      const [discovered2] = await KNXTunneling.discover({
        ip: "127.0.0.1",
        port: server.tcpListeningPort,
        transport: "TCP",
        timeout: 500,
      });
      expect(discovered2.tunnellingInfo?.slots.map((s) => ({ addr: s.addressText, free: s.free }))).toEqual([
        { addr: "15.15.1", free: false },
        { addr: "15.15.2", free: true },
        { addr: "15.15.3", free: false },
      ]);
    } finally {
      autoClient.disconnect();
      await helper.close();
      await new Promise((r) => setTimeout(r, 40));
      server.disconnect();
    }
  });

  test("handles TUNNELLING_FEATURE_GET and TUNNELLING_FEATURE_SET per 03_08_04 §3", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      clientAddrs: "15.15.1:2",
      logOptions: { enabled: false },
    });
    await server.connect();

    const helper = await openTcpHelper(server.tcpListeningPort);
    const buildFeatureGet = (channelId: number, featId: number) => {
      const body = Buffer.from([0x04, channelId, 0x00, 0x00, featId, 0x00]);
      return Buffer.concat([
        new KNXnetIPHeader(KNXnetIPServiceType.TUNNELLING_FEATURE_GET, 6 + body.length).toBuffer(),
        body,
      ]);
    };
    const buildFeatureSet = (channelId: number, featId: number, val: Buffer) => {
      const body = Buffer.concat([Buffer.from([0x04, channelId, 0x00, 0x00, featId, 0x00]), val]);
      return Buffer.concat([
        new KNXnetIPHeader(KNXnetIPServiceType.TUNNELLING_FEATURE_SET, 6 + body.length).toBuffer(),
        body,
      ]);
    };

    try {
      helper.socket.write(buildConnectRequestTcp(ConnectionType.TUNNEL_CONNECTION));
      const connResp = await helper.nextFrame();
      const channelId = connResp.readUInt8(6);
      expect(connResp.readUInt8(7)).toBe(KNXnetIPErrorCodes.E_NO_ERROR);

      // 1. Read all features 0x01..0x08 and unknown 0x00
      const expectedGet: Array<[number, number, Buffer]> = [
        [InterfaceFeatureId.SUPPORTED_EMI_TYPE, TunnellingFeatureReturnCode.E_NO_ERROR, Buffer.from([0x00, 0x04])],
        [
          InterfaceFeatureId.DEVICE_DESCRIPTOR_TYPE_0,
          TunnellingFeatureReturnCode.E_NO_ERROR,
          Buffer.from([0x09, 0x1a]),
        ],
        [InterfaceFeatureId.BUS_CONNECTION_STATUS, TunnellingFeatureReturnCode.E_NO_ERROR, Buffer.from([0x01])],
        [InterfaceFeatureId.KNX_MANUFACTURER_CODE, TunnellingFeatureReturnCode.E_NO_ERROR, Buffer.from([0x00, 0x00])],
        [InterfaceFeatureId.ACTIVE_EMI_TYPE, TunnellingFeatureReturnCode.E_NO_ERROR, Buffer.from([0x03])],
        [
          InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS,
          TunnellingFeatureReturnCode.E_NO_ERROR,
          Buffer.from([0xff, 0x01]),
        ],
        [InterfaceFeatureId.MAX_APDU_LENGTH, TunnellingFeatureReturnCode.E_NO_ERROR, Buffer.from([0x00, 0xfe])],
        [InterfaceFeatureId.INTERFACE_FEATURE_INFO_ENABLE, TunnellingFeatureReturnCode.E_NO_ERROR, Buffer.from([0x00])],
        [0x00, TunnellingFeatureReturnCode.E_ADDRESS_VOID, Buffer.alloc(0)],
      ];

      for (const [featId, code, val] of expectedGet) {
        helper.socket.write(buildFeatureGet(channelId, featId));
        const resp = await helper.nextFrame();
        expect(KNXnetIPHeader.fromBuffer(resp).serviceType).toBe(KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE);
        expect(resp.readUInt8(10)).toBe(featId);
        expect(resp.readUInt8(11)).toBe(code);
        expect(resp.subarray(12)).toEqual(val);
      }

      // 2. Read-only feature SET returns E_ACCESS_READ_ONLY
      helper.socket.write(buildFeatureSet(channelId, InterfaceFeatureId.MAX_APDU_LENGTH, Buffer.from([0x00, 0x37])));
      const roResp = await helper.nextFrame();
      expect(roResp.readUInt8(11)).toBe(TunnellingFeatureReturnCode.E_ACCESS_READ_ONLY);

      // 3. Invalid value & wrong size for Feature 0x08
      helper.socket.write(
        buildFeatureSet(channelId, InterfaceFeatureId.INTERFACE_FEATURE_INFO_ENABLE, Buffer.from([0x02])),
      );
      const voidValResp = await helper.nextFrame();
      expect(voidValResp.readUInt8(11)).toBe(TunnellingFeatureReturnCode.E_DATA_VOID);
      expect(voidValResp.subarray(12)).toEqual(Buffer.from([0x02]));

      helper.socket.write(
        buildFeatureSet(channelId, InterfaceFeatureId.INTERFACE_FEATURE_INFO_ENABLE, Buffer.from([0x00, 0x01])),
      );
      const typeConflictResp = await helper.nextFrame();
      expect(typeConflictResp.readUInt8(11)).toBe(TunnellingFeatureReturnCode.E_DATA_TYPE_CONFLICT);

      // 4. Enable Feature Info Service (0x08 = 1)
      helper.socket.write(
        buildFeatureSet(channelId, InterfaceFeatureId.INTERFACE_FEATURE_INFO_ENABLE, Buffer.from([0x01])),
      );
      const enableResp = await helper.nextFrame();
      expect(enableResp.readUInt8(11)).toBe(TunnellingFeatureReturnCode.E_NO_ERROR);
      expect(enableResp.subarray(12)).toEqual(Buffer.from([0x01]));

      // 5. Setting Feature 0x06 to host IA returns E_DATA_VOID
      const hostIA = KNXHelper.GetAddress("15.15.0", ".");
      helper.socket.write(buildFeatureSet(channelId, InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS, hostIA));
      const hostIaResp = await helper.nextFrame();
      expect(hostIaResp.readUInt8(11)).toBe(TunnellingFeatureReturnCode.E_DATA_VOID);
      expect(hostIaResp.subarray(12)).toEqual(hostIA);

      // 6. Setting Feature 0x06 to free external IA succeeds and emits TUNNELLING_FEATURE_INFO
      const newIA = KNXHelper.GetAddress("15.15.20", ".");
      helper.socket.write(buildFeatureSet(channelId, InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS, newIA));
      const f1 = await helper.nextFrame();
      const f2 = await helper.nextFrame();
      const frames = [f1, f2];
      const setResp = frames.find(
        (f) => KNXnetIPHeader.fromBuffer(f).serviceType === KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE,
      );
      const infoFrame = frames.find(
        (f) => KNXnetIPHeader.fromBuffer(f).serviceType === KNXnetIPServiceType.TUNNELLING_FEATURE_INFO,
      );
      expect(setResp).toBeDefined();
      expect(setResp!.readUInt8(11)).toBe(TunnellingFeatureReturnCode.E_NO_ERROR);
      expect(setResp!.subarray(12)).toEqual(newIA);
      expect(infoFrame).toBeDefined();
      expect(infoFrame!.readUInt8(10)).toBe(InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS);
      expect(infoFrame!.subarray(12)).toEqual(newIA);
    } finally {
      await helper.close();
      server.disconnect();
    }
  });

  test("KNXTunneling supports Extended CRI, setFeature, UDP feature ACK confirmation, and feature_info IA updates", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      clientAddrs: "15.15.1:3",
      logOptions: { enabled: false },
    });
    await server.connect();

    const udpClient = new KNXTunneling({
      ip: "127.0.0.1",
      port: server.udpListeningPort,
      transport: "UDP",
      knxLayer: KNXLayer.LINK_LAYER,
      individualAddress: "15.15.2",
      autoReconnect: false,
      logOptions: { enabled: false },
    });

    try {
      await udpClient.connect();
      expect(udpClient.individualAddress).toBe("15.15.2");

      // Send an incoming indication first so server sno (1) != client sno (0) over UDP
      await server.send(buildLDataInd("1.1.20", "2/2/2", "1.001", true));
      await new Promise((r) => setTimeout(r, 40));

      // getFeature & setFeature over UDP must confirm with TUNNELLING_ACK and not desync rxSequenceNumber
      const maxApdu = await udpClient.getFeature(InterfaceFeatureId.MAX_APDU_LENGTH);
      expect(maxApdu.readUInt16BE(0)).toBe(254);

      const enabled = await udpClient.setFeature(InterfaceFeatureId.INTERFACE_FEATURE_INFO_ENABLE, Buffer.from([0x01]));
      expect(enabled).toEqual(Buffer.from([0x01]));

      const infoEvents: Array<{ featureId: number; val: Buffer }> = [];
      udpClient.on("feature_info", (featureId: number, val: Buffer) => {
        infoEvents.push({ featureId, val });
      });

      const newIaBuf = KNXHelper.GetAddress("15.15.25", ".");
      await udpClient.setFeature(InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS, newIaBuf);
      await new Promise((r) => setTimeout(r, 40));

      expect(udpClient.individualAddress).toBe("15.15.25");
      expect(
        infoEvents.some(
          (e) => e.featureId === InterfaceFeatureId.INTERFACE_INDIVIDUAL_ADDRESS && e.val.equals(newIaBuf),
        ),
      ).toBe(true);

      // Verify subsequent telegram still works on UDP after Feature ACKs
      await udpClient.write("1/1/2", "1.001", false);
      await new Promise((r) => setTimeout(r, 40));
    } finally {
      udpClient.disconnect();
      await new Promise((r) => setTimeout(r, 40));
      server.disconnect();
    }
  });

  test("Busmonitor mode converts L_Data.ind (Standard and Extended) to valid L_Busmon.ind LPDU with exact length and FCS", async () => {
    const server = new KNXnetIPServer({
      ip: "127.0.0.1",
      localIp: "127.0.0.1",
      tcpHost: "127.0.0.1",
      port: 0,
      individualAddress: "15.15.0",
      clientAddrs: "15.15.1:2",
      logOptions: { enabled: false },
    });
    await server.connect();

    const busmonClient = new KNXTunneling({
      ip: "127.0.0.1",
      port: server.tcpListeningPort,
      transport: "TCP",
      knxLayer: KNXLayer.BUSMONITOR_LAYER,
      autoReconnect: false,
      logOptions: { enabled: false },
    });

    try {
      await busmonClient.connect();

      const received: any[] = [];
      busmonClient.on("indication", (cemi: any) => received.push(cemi));

      // 1. Standard Frame: 1-bit GroupValueWrite to 2/2/2 (dataLen = 1, TPDU = [0x00, 0x81])
      await server.send(buildLDataInd("1.1.20", "2/2/2", "1.001", true));
      await new Promise((r) => setTimeout(r, 40));

      // 2. Extended Frame: FT=0 (cf1=0x3c), 4-byte payload (dataLen=4)
      const extLDataInd = Buffer.from([
        0x29, 0x00, 0x3c, 0xe0, 0x11, 0x14, 0x12, 0x02, 0x04, 0x00, 0x80, 0xaa, 0xbb, 0xcc,
      ]);
      await server.send(extLDataInd);
      await new Promise((r) => setTimeout(r, 40));

      expect(received).toHaveLength(2);

      // Verify Standard Frame LPDU: [cf1, src(2), dst(2), (cf2&0xf0)|1, tpdu(2), FCS] -> 9 bytes
      const stdBusmon = received[0] as InstanceType<(typeof CEMI.DataLinkLayerCEMI)["L_Busmon.ind"]>;
      expect(stdBusmon.messageCode).toBe(0x2b);
      expect(stdBusmon.additionalInfo.items.length).toBeGreaterThanOrEqual(2);
      const stdLpdu = stdBusmon.data;
      expect(stdLpdu).toHaveLength(9);
      expect(stdLpdu[5] & 0x0f).toBe(1); // LG = 1 (NOT 2)
      let stdXor = 0;
      for (let i = 0; i < stdLpdu.length - 1; i++) stdXor ^= stdLpdu[i];
      expect(stdLpdu[stdLpdu.length - 1]).toBe(~stdXor & 0xff);

      // Verify Extended Frame LPDU: [cf1, cf2, src(2), dst(2), dataLen(1), tpdu(5), FCS] -> 13 bytes
      const extBusmon = received[1] as InstanceType<(typeof CEMI.DataLinkLayerCEMI)["L_Busmon.ind"]>;
      expect(extBusmon.messageCode).toBe(0x2b);
      const extLpdu = extBusmon.data;
      expect(extLpdu).toHaveLength(13);
      expect(extLpdu[0] & 0x80).toBe(0); // FT=0
      expect(extLpdu[6]).toBe(4); // L = 4
      let extXor = 0;
      for (let i = 0; i < extLpdu.length - 1; i++) extXor ^= extLpdu[i];
      expect(extLpdu[extLpdu.length - 1]).toBe(~extXor & 0xff);
    } finally {
      busmonClient.disconnect();
      await new Promise((r) => setTimeout(r, 40));
      server.disconnect();
    }
  });
});
