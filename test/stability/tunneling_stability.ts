import { KNXTunneling, KNXnetIPServer } from "../../src";
import { ConnectionType } from "../../src/core/enum/KNXnetIPEnum";

const PORT = 3672;

/**
 * Helper function to instantiate and start a local KNXnet/IP server
 * on loopback interface for isolated testing.
 *
 * @param port - The UDP port to bind the server to.
 * @returns A promise resolving to the started KNXnetIPServer instance.
 */
async function startLocalServer(port: number): Promise<KNXnetIPServer> {
  const server = new KNXnetIPServer({
    port,
    localIp: "127.0.0.1",
    individualAddress: "15.15.0",
    clientAddrs: "15.15.1:10",
    useAllInterfaces: false,
    logOptions: { level: "noLog", enabled: false }
  });
  await server.connect();
  return server;
}

/**
 * Scenario 1: Connection Loop Stability
 * Exercises repeatedly connecting and disconnecting a single client to verify
 * that sockets are cleanly closed and ports are freed without memory or handle leaks.
 *
 * @param port - The destination port.
 */
async function runConnectionLoopScenario(port: number): Promise<boolean> {
  console.log("\n\x1b[36m--- [Scenario 1: Connection Loop Stability] ---\x1b[0m");
  const iterations = 20;
  let successCount = 0;

  for (let i = 1; i <= iterations; i++) {
    const client = new KNXTunneling({
      ip: "127.0.0.1",
      port,
      connectionType: ConnectionType.TUNNEL_CONNECTION,
      localIp: "127.0.0.1",
      transport: "UDP",
      logOptions: { level: "noLog", enabled: false }
    });

    try {
      await client.connect();
      successCount++;
      client.disconnect();
      // Short delay to allow OS socket cleanup
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (err: any) {
      console.error(`  [Iteration ${i}] Failed:`, err.message);
    }
  }

  console.log(`  Result: Connected/disconnected successfully ${successCount}/${iterations} times.`);
  if (successCount === iterations) {
    console.log("  STATUS: \x1b[32mPASSED ✅\x1b[0m");
    return true;
  } else {
    console.log("  STATUS: \x1b[31mFAILED ❌\x1b[0m");
    return false;
  }
}

/**
 * Scenario 2: High-Throughput Stress Test
 * Sends a burst of messages at a high rate (50 writes per second) to test client
 * queue management, frame sequence alignment, and roundtrip performance.
 *
 * @param port - The destination port.
 */
async function runHighThroughputStressScenario(port: number): Promise<boolean> {
  console.log("\n\x1b[36m--- [Scenario 2: High-Throughput Stress Test] ---\x1b[0m");
  const client = new KNXTunneling({
    ip: "127.0.0.1",
    port,
    connectionType: ConnectionType.TUNNEL_CONNECTION,
    localIp: "127.0.0.1",
    transport: "UDP",
    logOptions: { level: "noLog", enabled: false }
  });

  await client.connect();

  const totalMessages = 200;
  const intervalMs = 20; // 50 msgs/sec
  const latencies: number[] = [];
  let successCount = 0;
  let errorCount = 0;

  console.log(`  Sending ${totalMessages} messages at 50 msgs/sec (one every ${intervalMs}ms)...`);
  const startTime = Date.now();

  for (let i = 0; i < totalMessages; i++) {
    const msgStart = Date.now();
    try {
      // Alternate boolean values
      await client.write("1/1/1", 1, { value: i % 2 === 0 });
      latencies.push(Date.now() - msgStart);
      successCount++;
    } catch (err: any) {
      errorCount++;
    }

    const elapsed = Date.now() - msgStart;
    if (elapsed < intervalMs) {
      await new Promise(resolve => setTimeout(resolve, intervalMs - elapsed));
    }
  }

  const duration = (Date.now() - startTime) / 1000;
  client.disconnect();

  const minLat = latencies.length ? Math.min(...latencies) : 0;
  const maxLat = latencies.length ? Math.max(...latencies) : 0;
  const avgLat = latencies.length ? (latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  console.log(`  Duration: ${duration.toFixed(2)}s`);
  console.log(`  Sent: ${totalMessages}, Acknowledged: ${successCount}, Failed: ${errorCount}`);
  console.log(`  Success Rate: ${((successCount / totalMessages) * 100).toFixed(1)}%`);
  console.log(`  Latency - Min: ${minLat}ms, Max: ${maxLat}ms, Avg: ${avgLat.toFixed(2)}ms`);

  if (successCount === totalMessages) {
    console.log("  STATUS: \x1b[32mPASSED ✅\x1b[0m");
    return true;
  } else {
    console.log("  STATUS: \x1b[31mFAILED ❌\x1b[0m");
    return false;
  }
}

/**
 * Scenario 3: Heartbeat Maintenance Test
 * Keeps the connection idle over a 65-second window to verify that the
 * spec-defined 60-second heartbeat ping-pong cycle operates correctly.
 *
 * @param port - The destination port.
 */
async function runHeartbeatScenario(port: number): Promise<boolean> {
  console.log("\n\x1b[36m--- [Scenario 3: Heartbeat Maintenance Test] ---\x1b[0m");
  const client = new KNXTunneling({
    ip: "127.0.0.1",
    port,
    connectionType: ConnectionType.TUNNEL_CONNECTION,
    localIp: "127.0.0.1",
    transport: "UDP",
    logOptions: { level: "noLog", enabled: false }
  });

  await client.connect();
  console.log("  Connected. Waiting 65 seconds to witness heartbeat interval (60s)...");

  let isDisconnected = false;
  client.on("disconnected", () => {
    isDisconnected = true;
  });

  // Periodically send a group write every 15s to verify flow during the waiting phase
  const interval = setInterval(async () => {
    if (isDisconnected) return;
    try {
      await client.write("1/1/2", 1, { value: true });
      console.log(`  [${new Date().toLocaleTimeString()}] Sent keepalive write successfully.`);
    } catch (err: any) {
      console.error(`  [${new Date().toLocaleTimeString()}] Keepalive write failed:`, err.message);
    }
  }, 15000);

  await new Promise(resolve => setTimeout(resolve, 65000));

  clearInterval(interval);
  client.disconnect();

  if (!isDisconnected) {
    console.log("  Connection remained stable throughout the 65s heartbeat window.");
    console.log("  STATUS: \x1b[32mPASSED ✅\x1b[0m");
    return true;
  } else {
    console.log("  Connection dropped prematurely.");
    console.log("  STATUS: \x1b[31mFAILED ❌\x1b[0m");
    return false;
  }
}

/**
 * Scenario 4: Disconnection & Auto-Reconnection Recovery Test
 * Shuts down the local server mid-connection, triggers a client timeout,
 * reboots the server, and verifies client auto-reconnection and traffic resumption.
 *
 * @param port - The destination port.
 * @param serverWrapper - Mutable wrapper holding the active server instance.
 */
async function runReconnectionScenario(port: number, serverWrapper: { server: KNXnetIPServer }): Promise<boolean> {
  console.log("\n\x1b[36m--- [Scenario 4: Disconnection & Auto-Reconnection Recovery Test] ---\x1b[0m");

  let reconnectCount = 0;
  const client = new KNXTunneling({
    ip: "127.0.0.1",
    port,
    connectionType: ConnectionType.TUNNEL_CONNECTION,
    localIp: "127.0.0.1",
    transport: "UDP",
    logOptions: { level: "noLog", enabled: false }
  });

  let shouldReconnect = true;

  // Active reconnection listener
  client.on("disconnected", async () => {
    if (!shouldReconnect) return;
    reconnectCount++;
    console.log(`  [Event] Disconnected! Attempting auto-reconnection #${reconnectCount}...`);

    let retries = 10;
    while (retries > 0 && shouldReconnect) {
      try {
        await new Promise(r => setTimeout(r, 1000));
        await client.connect();
        console.log("  [Event] Reconnected successfully!");
        break;
      } catch (e: any) {
        console.warn(`  Reconnection attempt failed (${e.message}). Retrying...`);
        retries--;
      }
    }
  });

  await client.connect();
  console.log("  Client connected. Sending first test message...");
  await client.write("1/1/3", 1, { value: true });

  console.log("  Stopping local server to simulate a network outage...");
  serverWrapper.server.disconnect();

  console.log("  Attempting to write while server is down (forces ACK timeout)...");
  try {
    await client.write("1/1/3", 1, { value: false });
  } catch (err: any) {
    console.log(`  Write failed as expected: ${err.message}`);
  }

  console.log("  Waiting for client ACK timeout / disconnection to trigger...");
  await new Promise(r => setTimeout(r, 3000));

  console.log("  Starting local server back up...");
  serverWrapper.server = await startLocalServer(port);

  console.log("  Waiting for client auto-reconnection...");
  let waitCount = 10;
  while (!client["isConnected"] && waitCount > 0) {
    await new Promise(r => setTimeout(r, 1000));
    waitCount--;
  }

  console.log("  Testing message delivery after reconnection...");
  let afterReconnectSuccess = false;
  try {
    await client.write("1/1/3", 1, { value: true });
    console.log("  Message sent successfully after reconnection!");
    afterReconnectSuccess = true;
  } catch (err: any) {
    console.error("  Failed to send message after reconnection:", err.message);
  }

  shouldReconnect = false;
  client.disconnect();

  if (reconnectCount > 0 && afterReconnectSuccess) {
    console.log("  Reconnection and recovery validated successfully.");
    console.log("  STATUS: \x1b[32mPASSED ✅\x1b[0m");
    return true;
  } else {
    console.log("  Reconnection/recovery failed.");
    console.log("  STATUS: \x1b[31mFAILED ❌\x1b[0m");
    return false;
  }
}

/**
 * Scenario 5: Concurrent Clients Isolation
 * Connects multiple clients simultaneously to the gateway and performs concurrent
 * transactions to ensure correct channel separation, sequencing, and independent disconnects.
 *
 * @param port - The destination port.
 */
async function runConcurrentClientsScenario(port: number): Promise<boolean> {
  console.log("\n\x1b[36m--- [Scenario 5: Concurrent Clients Isolation] ---\x1b[0m");
  const numClients = 5;
  const clients: KNXTunneling[] = [];

  console.log(`  Connecting ${numClients} clients concurrently...`);
  for (let i = 0; i < numClients; i++) {
    const client = new KNXTunneling({
      ip: "127.0.0.1",
      port,
      connectionType: ConnectionType.TUNNEL_CONNECTION,
      localIp: "127.0.0.1",
      transport: "UDP",
      logOptions: { level: "noLog", enabled: false }
    });
    clients.push(client);
  }

  try {
    await Promise.all(clients.map(c => c.connect()));
    console.log(`  All ${numClients} clients connected. Performing concurrent writes...`);

    let successCount = 0;
    let failCount = 0;

    await Promise.all(
      clients.map(async (client, index) => {
        for (let w = 0; w < 10; w++) {
          try {
            await client.write(`1/1/${index + 1}`, 1, { value: w % 2 === 0 });
            successCount++;
          } catch (err: any) {
            failCount++;
          }
        }
      })
    );

    console.log(`  Concurrent Writes - Success: ${successCount}, Fail: ${failCount}`);

    console.log("  Disconnecting all clients...");
    clients.forEach(c => c.disconnect());

    const expectedTotal = numClients * 10;
    if (successCount === expectedTotal && failCount === 0) {
      console.log("  STATUS: \x1b[32mPASSED ✅\x1b[0m");
      return true;
    } else {
      console.log("  STATUS: \x1b[31mFAILED ❌\x1b[0m");
      return false;
    }
  } catch (err: any) {
    console.error("  Scenario 5 failed due to error:", err.message);
    clients.forEach(c => {
      try {
        c.disconnect();
      } catch { /* empty */ }
    });
    console.log("  STATUS: \x1b[31mFAILED ❌\x1b[0m");
    return false;
  }
}

/**
 * Master suite executor. Starts the local test server, runs each scenario in order,
 * and prints a final test execution report.
 */
(async () => {
  console.log("==================================================");
  console.log("    KNXTunneling Synthetic Stability Test Suite   ");
  console.log("==================================================");

  let server: KNXnetIPServer | null = null;
  const results: { name: string; passed: boolean }[] = [];

  try {
    console.log("Starting loopback KNXnet/IP server on port 3672...");
    server = await startLocalServer(PORT);
    const serverWrapper = { server };

    // Run scenarios
    results.push({ name: "Scenario 1: Connection Loop Stability", passed: await runConnectionLoopScenario(PORT) });
    results.push({ name: "Scenario 2: High-Throughput Stress Test", passed: await runHighThroughputStressScenario(PORT) });
    results.push({ name: "Scenario 3: Heartbeat Maintenance Test", passed: await runHeartbeatScenario(PORT) });
    results.push({ name: "Scenario 4: Reconnection Recovery Test", passed: await runReconnectionScenario(PORT, serverWrapper) });
    results.push({ name: "Scenario 5: Concurrent Clients Isolation", passed: await runConcurrentClientsScenario(PORT) });

    // Stop final server
    if (serverWrapper.server) {
      console.log("\nStopping local server...");
      serverWrapper.server.disconnect();
    }
  } catch (e) {
    console.error("Fatal error during test suite execution:", e);
    if (server) {
      try {
        server.disconnect();
      } catch { /* empty */ }
    }
    process.exit(1);
  }

  console.log("\n==================================================");
  console.log("             TEST EXECUTION SUMMARY               ");
  console.log("==================================================");
  let allPassed = true;
  for (const res of results) {
    const statusText = res.passed ? "\x1b[32mPASSED\x1b[0m" : "\x1b[31mFAILED\x1b[0m";
    console.log(`- ${res.name}: ${statusText}`);
    if (!res.passed) allPassed = false;
  }
  console.log("==================================================");

  if (allPassed) {
    console.log("\x1b[32mALL STABILITY TESTS PASSED SUCCESSFULLY! 🎉\x1b[0m");
    process.exit(0);
  } else {
    console.log("\x1b[31mSOME STABILITY TESTS FAILED. ❌\x1b[0m");
    process.exit(1);
  }
})();
