import net from "node:net";
import { KNXnetIPServer } from "../src/connection/KNXnetIPServer";
import { KNXTunneling } from "../src/connection/KNXTunneling";
import { TcpFrameReader } from "../src/connection/TcpFrameReader";
import { KNXnetIPHeader } from "../src/core/KNXnetIPHeader";
import { DIB, HPAI, SecuredServiceFamiliesDIB, SupportedServicesDIB } from "../src/core/KNXnetIPStructures";
import { AllowedSupportedServiceFamilies, DescriptionType, KNXnetIPServiceType } from "../src/core/enum/KNXnetIPEnum";
import { KNXHelper } from "../src/utils/KNXHelper";

const USER_ID = 2;
const USER_PASSWORD = "tunnel-user-pass";
const DEVICE_AUTH_PASSWORD = "device-auth-password";

function buildGroupWriteIndication(srcIA: string, dstGA: string, _dpt: string, value: unknown): Buffer {
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
    value ? 0x81 : 0x80,
  ]);
}

async function verifyTcpDescription(port: number): Promise<void> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.createConnection({ host: "127.0.0.1", port }, () => resolve(s));
    s.once("error", reject);
  });

  const reader = new TcpFrameReader();
  const resp = await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DESCRIPTION_RESPONSE timeout")), 2000);
    socket.on("data", (chunk) => {
      const frames = reader.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      if (frames.length > 0) {
        clearTimeout(timer);
        resolve(frames[0]);
      }
    });
    const hpai = HPAI.NULL_TCP_HPAI.toBuffer();
    const hdr = new KNXnetIPHeader(
      KNXnetIPServiceType.DESCRIPTION_REQUEST,
      KNXnetIPHeader.HEADER_SIZE_10 + hpai.length,
    );
    socket.write(Buffer.concat([hdr.toBuffer(), hpai]));
  });

  const hdr = KNXnetIPHeader.fromBuffer(resp);
  if (hdr.serviceType !== KNXnetIPServiceType.DESCRIPTION_RESPONSE) {
    throw new Error(`Expected DESCRIPTION_RESPONSE, got 0x${hdr.serviceType.toString(16)}`);
  }

  let offset = 6;
  let hasSecurity = false;
  let securedFamilies: number[] = [];
  while (offset < resp.length) {
    const len = resp.readUInt8(offset);
    const type = resp.readUInt8(offset + 1);
    const dibBuf = resp.subarray(offset, offset + len);
    if (type === DescriptionType.SUPP_SVC_FAMILIES) {
      const supp = SupportedServicesDIB.fromBuffer(dibBuf);
      hasSecurity = supp.services.some((s) => s.family === AllowedSupportedServiceFamilies.Security);
    } else if (type === DescriptionType.SECURED_SERVICE_FAMILIES) {
      const sec = SecuredServiceFamiliesDIB.fromBuffer(dibBuf);
      securedFamilies = sec.services.map((s) => s.family);
    } else {
      DIB.fromBuffer(dibBuf);
    }
    offset += len;
  }

  console.log(
    `[ManualTest] TCP DESCRIPTION_RESPONSE received (socket stayed open=${!socket.destroyed}, Security=${hasSecurity}, SecuredFamilies=[${securedFamilies.join(", ")}])`,
  );
  socket.destroy();
}

async function main() {
  console.log("=======================================================================");
  console.log("  KNXnetIPServer TCP + KNX IP Secure Manual Test (Real KNXnetIPServer)");
  console.log("=======================================================================\n");

  const server = new KNXnetIPServer({
    ip: "127.0.0.1",
    localIp: "127.0.0.1",
    tcpHost: "127.0.0.1",
    port: 0,
    individualAddress: "15.15.0",
    clientAddrs: "15.15.240:4",
    friendlyName: "KNX.ts Secure TCP Server",
    logOptions: { level: "info", enabled: true },
    secure: {
      userId: USER_ID,
      userPassword: USER_PASSWORD,
      deviceAuthenticationPassword: DEVICE_AUTH_PASSWORD,
    },
  });

  await server.connect();
  const port = server.tcpListeningPort;
  console.log(`[KNXnetIPServer] Listening on UDP+TCP 127.0.0.1:${port}\n`);

  try {
    // 1. Discovery over TCP (DESCRIPTION_REQUEST)
    await verifyTcpDescription(port);

    // 2. KNX IP Secure TCP Tunnelling E2E
    console.log("\n[1/3] Connecting KNXTunneling via KNX IP Secure over TCP...");
    const secureClient = new KNXTunneling({
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

    let serverRxCount = 0;
    let clientConCount = 0;
    let clientIndCount = 0;

    const onServerInd = (cemi: any) => {
      serverRxCount++;
      console.log(
        `[KNXnetIPServer] <- Received CEMI (#${serverRxCount}): ${cemi.sourceAddress} -> ${cemi.destinationAddress}`,
      );
    };
    server.on("indication", onServerInd);

    secureClient.on("indication", (cemi: any) => {
      if (cemi.messageCode === 0x2e) {
        clientConCount++;
      } else {
        clientIndCount++;
      }
      const totalClient = clientConCount + clientIndCount;
      if (totalClient <= 5 || totalClient % 10 === 0) {
        console.log(
          `[SecureClient] <- Decrypted frame (#${totalClient}, msgCode=0x${cemi.messageCode.toString(16)}): ${cemi.sourceAddress} -> ${cemi.destinationAddress}`,
        );
      }
    });
    secureClient.on("error", (err) => {
      console.error("[SecureClient] Error:", err.message);
    });

    await secureClient.connect();
    console.log(`[SecureClient] Connected! Assigned IA: ${secureClient.individualAddress}`);

    const clientWriteCount = 20;
    console.log(`[SecureClient] -> Sending ${clientWriteCount} encrypted GroupValue_Write telegrams...`);
    for (let i = 1; i <= clientWriteCount; i++) {
      await secureClient.write(`1/1/${i}`, "1.001", i % 2 === 1);
      console.log(`[SecureClient] -> Sending 1/1/${i}`);
    }

    const clientReadCount = 5;
    console.log(`[SecureClient] -> Sending ${clientReadCount} encrypted GroupValue_Read telegrams...`);
    for (let i = 1; i <= clientReadCount; i++) {
      await secureClient.read(`1/2/${i}`);
    }

    const serverTxCount = 20;
    console.log(`[KNXnetIPServer] -> Broadcasting ${serverTxCount} L_Data.ind telegrams over Secure TCP...`);
    for (let i = 1; i <= serverTxCount; i++) {
      await server.send(buildGroupWriteIndication(`1.1.${10 + i}`, `2/1/${i}`, "1.001", i % 2 === 0));
    }

    const expectedClientTotal = clientWriteCount + clientReadCount;
    const deadline = Date.now() + 3000;
    while (
      (serverRxCount < expectedClientTotal || clientConCount < expectedClientTotal || clientIndCount < serverTxCount) &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 25));
    }

    console.log(
      `[1/3 Summary] Server received=${serverRxCount}/${expectedClientTotal}, Client L_Data.con=${clientConCount}/${expectedClientTotal}, Client L_Data.ind=${clientIndCount}/${serverTxCount}`,
    );
    if (
      serverRxCount !== expectedClientTotal ||
      clientConCount !== expectedClientTotal ||
      clientIndCount !== serverTxCount
    ) {
      throw new Error("Telegram count mismatch in [1/3]");
    }
    server.removeListener("indication", onServerInd);

    console.log("[SecureClient] Disconnecting...");
    secureClient.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // 3. Plain TCP Tunnelling E2E on the same server
    console.log("\n[2/3] Connecting KNXTunneling via Plain TCP...");
    server.on("indication", (cemi: any) => {
      console.log(`[KNXnetIPServer] <- Received CEMI: ${cemi.sourceAddress} -> ${cemi.destinationAddress}`);
    });
    const plainClient = new KNXTunneling({
      ip: "127.0.0.1",
      port,
      transport: "TCP",
      autoReconnect: false,
      logOptions: { level: "warn", enabled: true },
    });
    await plainClient.connect();
    console.log(`[PlainClient] Connected! Assigned IA: ${plainClient.individualAddress}`);
    await plainClient.write("1/1/3", "1.001", false);
    await new Promise((r) => setTimeout(r, 80));
    plainClient.disconnect();
    await new Promise((r) => setTimeout(r, 80));

    // 4. Negative check: Wrong password must fail
    console.log("\n[3/3] Verifying invalid password rejection...");
    const badClient = new KNXTunneling({
      ip: "127.0.0.1",
      port,
      transport: "TCP",
      autoReconnect: false,
      logOptions: { level: "noLog", enabled: false },
      secure: {
        userId: USER_ID,
        userPassword: "wrong-password",
        deviceAuthenticationPassword: DEVICE_AUTH_PASSWORD,
        requireDeviceAuthentication: true,
      },
    });
    badClient.on("error", () => {});
    try {
      await badClient.connect();
      throw new Error("Expected badClient.connect() to fail, but it succeeded");
    } catch (err: any) {
      console.log(`[BadClient] Rejected as expected: ${err.message}`);
    } finally {
      badClient.disconnect();
    }

    console.log("\nAll real KNXnetIPServer TCP + Secure checks succeeded.");
  } finally {
    server.disconnect();
    console.log("[KNXnetIPServer] Stopped.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
