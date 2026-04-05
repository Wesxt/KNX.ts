import { KNXTunneling } from "../connection/KNXTunneling";
import { ConnectionType } from "../core/enum/KNXnetIPEnum";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { KNXTunnelingOptions } from "../@types/interfaces/connection";
import { getLocalIP } from "../utils/localIp";
import { CEMI } from "../core/CEMI";

// Configuration for local knxd
const ip = "192.168.0.172"; // Change if knxd is on another machine
const PORT = 3671;

async function testTunneling() {
  console.log(`
--- Testing Tunneling (Target: ${ip}:${PORT}) ---`);

  const options: KNXTunnelingOptions = {
    ip: ip,
    port: PORT,
    connectionType: ConnectionType.TUNNEL_CONNECTION,
    localIp: getLocalIP(),
    transport: "UDP",
    useRouteBack: false,
  };

  const client = new KNXTunneling(options);

  let valueTest = 0;
  let bol = false;

  client.on("connected", (info) => {
    console.log("[Tunneling] Connected!");
    console.log(`[Tunneling] Channel ID: ${client["channelId"]}`);
    if (info) console.log("[Tunneling] Info:", info);
    setInterval(() => {
      valueTest++;
      bol = !bol;
      client.write("5/5/1", 1, { value: bol });
      client.write("5/5/2", 9, { value: valueTest });
      client.write("5/5/3", 9, { value: valueTest });
    }, 5000);
  });

  client.on("disconnected", () => {
    console.log("[Tunneling] Disconnected!");
  });

  client.on("error", (err) => {
    console.error("[Tunneling] Error:", err.message);
  });

  client.on("indication", (msg: ServiceMessage) => {
    console.log(
      "CEMI",
      msg.constructor.name,
      (msg as InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.req"]>).TPDU.apdu.data,
    );
  });

  client.on("raw_indication", (msg: Buffer) => {
    console.log("RAW", msg);
  });

  try {
    console.log("[Tunneling] Connecting...");
    await client.connect();
  } catch (e: any) {
    console.error("[Tunneling] Failed:", e.message);
  }
  return client;
}

let clientTunneling: KNXTunneling | null = null;

(async () => {
  try {
    clientTunneling = await testTunneling();
  } catch (e) {
    console.error("Test Suite Failed:", e);
    process.exit(1);
  }
})();

async function gracefulShutdown(reason: string) {
  console.log(`[Shutdown] ${reason}`);
  try {
    if (clientTunneling) {
      console.log("[Tunneling] Disconnecting...");
      clientTunneling.disconnect();
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
process.once("SIGUSR2" as any, () => gracefulShutdown("SIGUSR2 received (restart)"));
process.once("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  void gracefulShutdown("uncaughtException");
});
