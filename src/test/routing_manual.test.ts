import { KNXnetIPServer } from "../connection/KNXnetIPServer";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { MessageCodeTranslator } from "../utils/MessageCodeTranslator";
// import { getLocalIP } from "../utils/localIp";

// Configuration for KNX Routing
// Standard Multicast Address for KNXnet/IP Routing
const MULTICAST_IP = "224.0.23.12";
const PORT = 3671;

let routing: KNXnetIPServer;

async function testRouting() {
  console.log(`
--- Testing Routing (Multicast Group: ${MULTICAST_IP}:${PORT}) ---`);

  const localIp = "192.168.0.169";
  console.log(`Using Local IP: ${localIp}`);

  const client = new KNXnetIPServer({
    ip: MULTICAST_IP,
    port: PORT,
    localIp: localIp,
    friendlyName: "Arnold",
    routingDelay: 0,
    clientAddrs: "1.15.1:8",
    individualAddress: "1.15.1",
    MAX_PENDING_REQUESTS_PER_CLIENT: 50
  });

  routing = client;

  client.on("connected", () => {
    console.log("[Routing] Socket Bound & Member of Multicast Group!");
  });

  client.on("error", (err: any) => {
    console.error("[Routing] Error:", err.message);
  });

  client.on("indication", (msg: ServiceMessage) => {
    // If you want to see the raw data:
    console.log("[CEMI]", msg.constructor.name, msg.toBuffer());
  });

  client.on("1/1/2", (cemi: ServiceMessage) => {
    console.log("[Listen in 1/1/2]:", cemi.toBuffer());
  });

  client.on("raw_indication", (msg: Buffer) => {
    console.log(
      "[RAWI]",
      MessageCodeTranslator.getServiceName(msg.readUint8(0), "CEMI"),
      msg,
    );
  });

  client.on("routing_busy", (busy: any) => {
    console.warn("[Routing] Server is BUSY. Wait time:", busy.waitTime, "ms");
  });

  client.on("routing_lost_message", (lost: any) => {
    console.error("[Routing] Messages LOST:", lost.lostMessages);
  });

  try {
    console.log("[Routing] Connecting...");
    await client.connect();
  } catch (e: any) {
    console.error("[Routing] Failed:", e.message);
  }
}

testRouting().catch(console.error);

async function gracefulShutdown(reason: string) {
  console.log(`[Shutdown] ${reason}`);
  try {
    if (routing) {
      console.log("[Routing] Disconnecting...");
      routing.disconnect();
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
process.once("SIGBREAK", () => gracefulShutdown("SIGBREAK received (Windows)"));
process.once("SIGUSR2" as any, () =>
  gracefulShutdown("SIGUSR2 received (restart)"),
);
process.once("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  void gracefulShutdown("uncaughtException");
});
