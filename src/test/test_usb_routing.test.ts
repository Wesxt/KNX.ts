import { KNXnetIPServer } from "../connection/KNXnetIPServer";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { MessageCodeTranslator } from "../utils/MessageCodeTranslator";

const MULTICAST_IP = "224.0.23.12";
const PORT = 3671;

let server: KNXnetIPServer;

async function testRouting() {
  console.log(`--- Testing Routing (Multicast Group: ${MULTICAST_IP}:${PORT}) ---`);

  const localIp = "192.168.0.169";
  console.log(`Using Local IP: ${localIp}`);

  // Create IP Server with embedded USB routing
  server = new KNXnetIPServer({
    ip: MULTICAST_IP,
    port: PORT,
    localIp: localIp,
    friendlyName: "KNX.ts USB Router",
    clientAddrs: "1.15.1:8",
    individualAddress: "1.15.0", // Router IA
    logOptions: {
      logDir: "./log",
      logToFile: true,
      level: "debug"
    },
    useAllInterfaces: false,
    // Provide USB config in the externals block so Router connects it automatically
    externals: {
      usb: {
        path: '/dev/hidraw0' // Or leave empty to auto-detect
      }
    }
  });

  server.on("connected", () => {
    console.log("[Routing] Socket Bound & Member of Multicast Group!");
    console.log("[Routing] USB Device should be connected via internal Router.");
  });

  server.on("error", (err: any) => {
    console.error("[Routing] Error:", err.message);
  });

  // Monitor traffic flowing out to the IP network or being parsed
  server.on("indication", (cemi: ServiceMessage) => {
    console.log("\n[SERVER <- INDICATION]", cemi.constructor.name, "sourceAddress" in cemi ? cemi.sourceAddress : null, "->", "destinationAddress" in cemi ? cemi.destinationAddress : null);
    // console.log(cemi);
  });

  // server.externalManager?.on("indication_link", (msg: { src: string, msg: ServiceMessage; }) => {
  //   if (msg.src !== KNXnetIPServer.constructor.name) {
  //     console.log('[SERVER <- Link]', msg.src, msg.msg);
  //   }
  // });

  try {
    console.log("[Routing] Connecting Server (will connect IP & USB)...");
    await server.connect();
    console.log("[Routing] Setup Complete. Listening for traffic on IP and USB.");
  } catch (e: any) {
    console.error("[Routing] Failed:", e.message);
  }
}

testRouting().catch(console.error);

async function gracefulShutdown(reason: string) {
  console.log(`\n[Shutdown] ${reason}`);
  try {
    if (server) {
      server.disconnect();
    }
    await new Promise((res) => setTimeout(res, 200));
  } catch (err) {
    console.error("[Shutdown] Error during disconnect:", err);
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", () => gracefulShutdown("SIGINT received (Ctrl+C)"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM received"));
