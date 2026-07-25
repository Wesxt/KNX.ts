import { fork } from "child_process";
import { ConnectionType } from "../src/core/enum/KNXnetIPEnum";
import { CEMIInstance, KNXTunneling, KNXTunnelingOptions } from "../src";
import { getLocalIP } from "../src/utils/localIp";

// Configure target IPs from environment variables, defaulting to 192.168.0.238
const TARGET_IP_1 = process.env.IP1 || "192.168.0.206";
const TARGET_IP_2 = process.env.IP2 || "192.168.0.174";
const TARGET_PORT = 3671;

function runParent() {
  console.log(`[Parent] Starting test with 2 processes.`);
  console.log(`[Parent] Process 1 target IP: ${TARGET_IP_1}`);
  console.log(`[Parent] Process 2 target IP: ${TARGET_IP_2}`);

  const spawnChild = (id: string, targetIp: string, colorCode: string) => {
    const child = fork(__filename, [], {
      env: {
        ...process.env,
        IS_CHILD: "true",
        CHILD_ID: id,
        TARGET_IP: targetIp,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: process.execArgv,
    });

    const prefix = `${colorCode}[Process ${id}]\x1b[0m`;

    const handleStream = (stream: NodeJS.ReadableStream) => {
      let buffer = "";
      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          console.log(`${prefix} ${line}`);
        }
      });
      stream.on("end", () => {
        if (buffer) {
          console.log(`${prefix} ${buffer}`);
        }
      });
    };

    if (child.stdout) handleStream(child.stdout);
    if (child.stderr) handleStream(child.stderr);

    child.on("exit", (code, signal) => {
      console.log(`${prefix} Exited with code ${code} (signal: ${signal})`);
    });

    return child;
  };

  // Colors: \x1b[32m is green, \x1b[33m is yellow
  const child1 = spawnChild("1", TARGET_IP_1, "\x1b[32m");
  const child2 = spawnChild("2", TARGET_IP_2, "\x1b[33m");

  const cleanup = (signal: string) => {
    console.log(`[Parent] Received ${signal}, killing child processes...`);
    child1.kill(signal as NodeJS.Signals);
    child2.kill(signal as NodeJS.Signals);
    setTimeout(() => {
      process.exit(0);
    }, 500);
  };

  process.once("SIGINT", () => cleanup("SIGINT"));
  process.once("SIGTERM", () => cleanup("SIGTERM"));
}

async function runChild() {
  const childId = process.env.CHILD_ID || "unknown";
  const targetIp = process.env.TARGET_IP || "192.168.0.238";
  console.log(`Starting KNXTunneling connection to ${targetIp}...`);

  const options: KNXTunnelingOptions = {
    ip: targetIp,
    port: TARGET_PORT,
    connectionType: ConnectionType.TUNNEL_CONNECTION,
    localIp: getLocalIP(),
    transport: "UDP",
    useRouteBack: false,
    logOptions: {
      level: "debug",
      enabled: true,
    },
  };

  const client = new KNXTunneling(options);

  let activeInterval: NodeJS.Timeout | null = null;

  client.on("connected", (info) => {
    console.log(`Connected to ${targetIp}! Channel ID: ${client["channelId"]}`);
    if (info) {
      console.log(`Connection info:`, info);
    }

    // // Set up a periodic action to test stability and traffic
    // if (activeInterval) clearInterval(activeInterval);
    // activeInterval = setInterval(async () => {
    //   try {
    //     const addr = `5/5/${childId}`;
    //     const val = childId === "1";
    //     console.log(`Writing value ${val} to ${addr}...`);
    //     await client.write(addr, 1, { value: val });
    //     console.log(`Write to ${addr} successful`);
    //   } catch (err: any) {
    //     console.error(`Write failed: ${err.message}`);
    //   }
    // }, 5000);
  });

  client.on("disconnected", () => {
    console.log(`Disconnected!`);
    if (activeInterval) {
      clearInterval(activeInterval);
      activeInterval = null;
    }
  });

  client.on("error", (err) => {
    console.error(`Client error: ${err.message}`);
  });

  client.on("indication", (msg: CEMIInstance) => {
    console.log(`Indication message received:`, msg.toBuffer());
  });

  try {
    await client.connect();
  } catch (err: any) {
    console.error(`Failed to connect initially: ${err.message}`);
  }

  const gracefulShutdown = async (reason: string) => {
    console.log(`Shutting down due to ${reason}...`);
    if (activeInterval) {
      clearInterval(activeInterval);
    }
    try {
      client.disconnect();
      await new Promise((res) => setTimeout(res, 200));
    } catch (err) {
      console.error(`Error during disconnect:`, err);
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => gracefulShutdown("SIGINT"));
  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.once("uncaughtException", (err) => {
    console.error("Uncaught exception in child:", err);
    void gracefulShutdown("uncaughtException");
  });
}

if (process.env.IS_CHILD === "true") {
  runChild();
} else {
  runParent();
}
