import { KNXMQTTGateway } from "../server/KNXMQTTGateway";
import { KNXWebSocketGateway } from "../server/KNXWebSocketServer";
import { Router } from "../connection/Router";
import { RouterConnOptions } from "../@types/interfaces/connection";

/**
 * MANUAL TEST FOR WEBSOCKET AND MQTT GATEWAYS
 */

async function startTest() {
  console.log("--- Starting Servers Manual Test ---");

  const options: RouterConnOptions = {
    routerAddress: "15.15.254",
    knxNetIpServer: {
      localIp: "192.168.0.238",
      friendlyName: "Test",
      useAllInterfaces: false,
    },
    usb: {},
    tunneling: [
      {
        ip: "192.168.0.174",
      },
    ],
  };

  const routerLinks = new Router(options);

  // 1. Setup WebSocket Gateway
  const wsGateway = new KNXWebSocketGateway({
    host: "10.144.195.17",
    port: 8090,
    knxContext: routerLinks,
  });

  // 2. Setup MQTT Gateway with embedded broker
  const mqttGateway = new KNXMQTTGateway({
    knxContext: routerLinks,
    embeddedBroker: {
      port: 1888,
      host: "10.144.195.17",
    },
    topicPrefix: "knx",
  });

  routerLinks.on("connected", () => {
    console.log("[KNX] Connected to Tunneling interface");
  });

  routerLinks.on("error", (err) => {
    console.error("[KNX] Error:", err.message);
  });

  try {
    await routerLinks.connect();

    wsGateway.start();
    console.log("[WS] WebSocket Gateway started on ws://10.144.195.17:8090");

    await mqttGateway.start();
    console.log("[MQTT] MQTT Gateway started with embedded broker on mqtt://10.144.195.17:1888");

    console.log("\nServers are running. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("Failed to start test:", error);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log("\nShutting down...");
    wsGateway.stop();
    mqttGateway.stop();
    routerLinks.disconnect();
    setTimeout(() => process.exit(0), 500);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startTest().catch(console.error);
