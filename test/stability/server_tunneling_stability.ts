import { KNXTunneling, KNXnetIPServer } from "../../src";
import { ConnectionType } from "../../src/core/enum/KNXnetIPEnum";

const PORT = 3673;

/**
 * Interface to track process resource usage.
 */
interface ResourceMetrics {
  cpu: NodeJS.CpuUsage;
  memory: NodeJS.MemoryUsage;
  time: number;
}

/**
 * Captures the current CPU usage, memory usage, and high-resolution time.
 *
 * @returns ResourceMetrics object containing current stats.
 */
function captureMetrics(): ResourceMetrics {
  return {
    cpu: process.cpuUsage(),
    memory: process.memoryUsage(),
    time: performance.now()
  };
}

/**
 * Helper to calculate metrics delta (CPU percentage and heap delta).
 *
 * @param start - Start metrics captured.
 * @param end - End metrics captured.
 * @returns A formatted description of resource utilization.
 */
function calculateDelta(start: ResourceMetrics, end: ResourceMetrics) {
  const elapsedMs = end.time - start.time;
  const userCpuDelta = end.cpu.user - start.cpu.user;
  const systemCpuDelta = end.cpu.system - start.cpu.system;
  const totalCpuTimeUs = userCpuDelta + systemCpuDelta;
  const cpuPercent = (totalCpuTimeUs / (elapsedMs * 1000)) * 100;

  const heapDeltaMb = (end.memory.heapUsed - start.memory.heapUsed) / 1024 / 1024;
  const rssDeltaMb = (end.memory.rss - start.memory.rss) / 1024 / 1024;

  return {
    cpuPercent: cpuPercent.toFixed(1),
    heapDeltaMb: (heapDeltaMb >= 0 ? "+" : "") + heapDeltaMb.toFixed(2),
    rssDeltaMb: (rssDeltaMb >= 0 ? "+" : "") + rssDeltaMb.toFixed(2),
    rssFinalMb: (end.memory.rss / 1024 / 1024).toFixed(1)
  };
}

/**
 * Phase 1: Single-Client Throughput & Latency Benchmark
 * Measures raw sequential roundtrip performance by sending 1,000 writes back-to-back.
 */
async function runSingleClientStress(port: number): Promise<{ throughput: number; avgLat: number; passed: boolean }> {
  console.log("\n\x1b[36m--- [Phase 1: Single-Client Throughput & Latency Benchmark] ---\x1b[0m");

  const server = new KNXnetIPServer({
    port,
    localIp: "127.0.0.1",
    individualAddress: "15.15.0",
    clientAddrs: "15.15.1:10",
    useAllInterfaces: false,
    routingDelay: 0, // disable routing delay to benchmark maximum tunneling throughput
    MAX_PENDING_REQUESTS_PER_CLIENT: 2000, // high limit
    logOptions: { level: "noLog", enabled: false }
  });

  await server.connect();

  const client = new KNXTunneling({
    ip: "127.0.0.1",
    port,
    connectionType: ConnectionType.TUNNEL_CONNECTION,
    localIp: "127.0.0.1",
    transport: "UDP",
    logOptions: { level: "noLog", enabled: false }
  });

  await client.connect();

  const totalWrites = 1000;
  const latencies: number[] = [];
  let successCount = 0;

  console.log(`  Sending ${totalWrites} sequential writes as fast as possible...`);
  const metricsStart = captureMetrics();

  for (let i = 0; i < totalWrites; i++) {
    const start = performance.now();
    try {
      await client.write("1/1/1", 1, { value: i % 2 === 0 });
      latencies.push(performance.now() - start);
      successCount++;
    } catch (err: any) {
      console.error(`  Write failed at iteration ${i}:`, err.message);
      break;
    }
  }

  const metricsEnd = captureMetrics();
  client.disconnect();
  server.disconnect();

  const elapsedSec = (metricsEnd.time - metricsStart.time) / 1000;
  const throughput = successCount / elapsedSec;
  const avgLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const resources = calculateDelta(metricsStart, metricsEnd);

  console.log(`  Writes Succeeded: ${successCount}/${totalWrites}`);
  console.log(`  Duration: ${elapsedSec.toFixed(2)}s`);
  console.log(`  Throughput: ${throughput.toFixed(1)} msgs/sec`);
  console.log(`  Latency - Min: ${Math.min(...latencies).toFixed(2)}ms, Max: ${Math.max(...latencies).toFixed(2)}ms, Avg: ${avgLat.toFixed(2)}ms`);
  console.log(`  Resource Usage - CPU: ${resources.cpuPercent}%, Heap Delta: ${resources.heapDeltaMb}MB, RSS: ${resources.rssFinalMb}MB`);

  const passed = successCount === totalWrites;
  console.log(`  STATUS: ${passed ? "\x1b[32mPASSED ✅\x1b[0m" : "\x1b[31mFAILED ❌\x1b[0m"}`);

  return { throughput, avgLat, passed };
}

/**
 * Phase 2: Multi-Client Concurrent Load Test
 * Evaluates performance and thread safety under multi-client concurrency.
 */
async function runMultiClientStress(port: number): Promise<{ throughput: number; passed: boolean }> {
  console.log("\n\x1b[36m--- [Phase 2: Multi-Client Concurrent Load Test] ---\x1b[0m");

  const server = new KNXnetIPServer({
    port,
    localIp: "127.0.0.1",
    individualAddress: "15.15.0",
    clientAddrs: "15.15.1:15",
    useAllInterfaces: false,
    routingDelay: 0,
    MAX_PENDING_REQUESTS_PER_CLIENT: 2000,
    logOptions: { level: "noLog", enabled: false }
  });

  await server.connect();

  const numClients = 5;
  const writesPerClient = 300;
  const clients: KNXTunneling[] = [];

  for (let i = 0; i < numClients; i++) {
    clients.push(new KNXTunneling({
      ip: "127.0.0.1",
      port,
      connectionType: ConnectionType.TUNNEL_CONNECTION,
      localIp: "127.0.0.1",
      transport: "UDP",
      logOptions: { level: "noLog", enabled: false }
    }));
  }

  await Promise.all(clients.map(c => c.connect()));
  console.log(`  Connected ${numClients} clients. Launching concurrent writes (${numClients * writesPerClient} total)...`);

  const metricsStart = captureMetrics();
  let totalSuccess = 0;
  const clientLatencies: number[][] = Array.from({ length: numClients }, () => []);

  await Promise.all(
    clients.map(async (client, clientIdx) => {
      for (let i = 0; i < writesPerClient; i++) {
        const start = performance.now();
        try {
          await client.write(`1/1/${clientIdx + 1}`, 1, { value: i % 2 === 0 });
          clientLatencies[clientIdx].push(performance.now() - start);
          totalSuccess++;
        } catch (err: any) {
          console.error(`  Client #${clientIdx} write failed:`, err.message);
          break;
        }
      }
    })
  );

  const metricsEnd = captureMetrics();
  clients.forEach(c => c.disconnect());
  server.disconnect();

  const elapsedSec = (metricsEnd.time - metricsStart.time) / 1000;
  const throughput = totalSuccess / elapsedSec;
  const allLatencies = clientLatencies.flat();
  const avgLat = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
  const resources = calculateDelta(metricsStart, metricsEnd);

  console.log(`  Writes Succeeded: ${totalSuccess}/${numClients * writesPerClient}`);
  console.log(`  Duration: ${elapsedSec.toFixed(2)}s`);
  console.log(`  Aggregate Throughput: ${throughput.toFixed(1)} msgs/sec`);
  console.log(`  Latency - Avg: ${avgLat.toFixed(2)}ms`);
  console.log(`  Resource Usage - CPU: ${resources.cpuPercent}%, Heap Delta: ${resources.heapDeltaMb}MB, RSS: ${resources.rssFinalMb}MB`);

  const passed = totalSuccess === numClients * writesPerClient;
  console.log(`  STATUS: ${passed ? "\x1b[32mPASSED ✅\x1b[0m" : "\x1b[31mFAILED ❌\x1b[0m"}`);

  return { throughput, passed };
}

/**
 * Phase 3: Gateway Protection & Flood Limits Test
 * Verifies that the server correctly enforces client rate-limits and drops
 * abusive connections to maintain global service stability.
 */
async function runGatewayProtectionTest(port: number): Promise<boolean> {
  console.log("\n\x1b[36m--- [Phase 3: Gateway Protection & Flood Limits Test] ---\x1b[0m");

  const server = new KNXnetIPServer({
    port,
    localIp: "127.0.0.1",
    individualAddress: "15.15.0",
    clientAddrs: "15.15.1:10",
    useAllInterfaces: false,
    MAX_PENDING_REQUESTS_PER_CLIENT: 30, // rate limit: 30 req/sec
    logOptions: { level: "noLog", enabled: false }
  });

  await server.connect();

  const client = new KNXTunneling({
    ip: "127.0.0.1",
    port,
    connectionType: ConnectionType.TUNNEL_CONNECTION,
    localIp: "127.0.0.1",
    transport: "UDP",
    logOptions: { level: "noLog", enabled: false }
  });

  await client.connect();

  let gotDisconnected = false;
  client.on("disconnected", () => {
    gotDisconnected = true;
  });

  console.log("  Flooding the gateway with 100 fast writes (limit is 30/sec)...");

  let errorCount = 0;
  for (let i = 0; i < 100; i++) {
    try {
      await client.write("1/1/1", 1, { value: true });
    } catch (err) {
      errorCount++;
      break;
    }
  }

  // Allow events to process
  await new Promise(resolve => setTimeout(resolve, 500));

  client.disconnect();
  server.disconnect();

  console.log(`  Abort/Error detected during flood: ${errorCount > 0}`);
  console.log(`  Client 'disconnected' event fired: ${gotDisconnected}`);

  const passed = gotDisconnected || errorCount > 0;
  if (passed) {
    console.log("  Verify: Server successfully terminated the abusive connection.");
    console.log("  STATUS: \x1b[32mPASSED ✅\x1b[0m");
    return true;
  } else {
    console.log("  Verify: Server allowed the client to exceed rate limits.");
    console.log("  STATUS: \x1b[31mFAILED ❌\x1b[0m");
    return false;
  }
}

/**
 * Phase 4: Heavy Load & System Resource Profiling
 * Simulates a sustained benchmark of 10 clients sending messages continuously
 * for 10 seconds to inspect memory/CPU stability and check for memory leaks.
 */
async function runSustainedLoadProfiling(port: number): Promise<boolean> {
  console.log("\n\x1b[36m--- [Phase 4: Heavy Load & System Resource Profiling] ---\x1b[0m");

  const server = new KNXnetIPServer({
    port,
    localIp: "127.0.0.1",
    individualAddress: "15.15.0",
    clientAddrs: "15.15.1:20",
    useAllInterfaces: false,
    routingDelay: 0,
    MAX_PENDING_REQUESTS_PER_CLIENT: 500,
    logOptions: { level: "noLog", enabled: false }
  });

  await server.connect();

  const numClients = 10;
  const clients: KNXTunneling[] = [];

  for (let i = 0; i < numClients; i++) {
    clients.push(new KNXTunneling({
      ip: "127.0.0.1",
      port,
      connectionType: ConnectionType.TUNNEL_CONNECTION,
      localIp: "127.0.0.1",
      transport: "UDP",
      logOptions: { level: "noLog", enabled: false }
    }));
  }

  console.log(`  Connecting ${numClients} clients...`);
  await Promise.all(clients.map(c => c.connect()));

  console.log("  Sustaining traffic of 20 writes/sec per client for 10 seconds...");
  const metricsStart = captureMetrics();
  let keepSending = true;
  let totalSent = 0;
  let totalErrors = 0;

  // Start traffic generation
  const sendIntervals = clients.map((client, idx) => {
    return setInterval(async () => {
      if (!keepSending) return;
      try {
        await client.write(`1/1/${idx + 1}`, 1, { value: Math.random() > 0.5 });
        totalSent++;
      } catch (err) {
        totalErrors++;
      }
    }, 50); // 20 writes/sec per client
  });

  // Print memory stats every 2 seconds
  const statsInterval = setInterval(() => {
    const mem = process.memoryUsage();
    console.log(`    [Progress] Sent: ${totalSent} | Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB | RSS: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
  }, 2000);

  // Wait 10 seconds
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Stop traffic
  keepSending = false;
  sendIntervals.forEach(clearInterval);
  clearInterval(statsInterval);

  const metricsEnd = captureMetrics();

  console.log("  Disconnecting clients...");
  clients.forEach(c => c.disconnect());
  server.disconnect();

  const elapsedSec = (metricsEnd.time - metricsStart.time) / 1000;
  const throughput = totalSent / elapsedSec;
  const resources = calculateDelta(metricsStart, metricsEnd);

  console.log(`  Total Writes Completed: ${totalSent}`);
  console.log(`  Total Write Errors: ${totalErrors}`);
  console.log(`  Average Throughput: ${throughput.toFixed(1)} msgs/sec`);
  console.log(`  Heap delta over 10s: ${resources.heapDeltaMb}MB (RSS delta: ${resources.rssDeltaMb}MB)`);

  // Memory leaks verification:
  // If memory growth is excessive (e.g. > 15MB on a 10-second loopback run), it might point to leaks.
  // Generally, garbage collection can delay, but on localhost 10s, delta should remain small.
  const passed = totalErrors === 0 && Math.abs(parseFloat(resources.heapDeltaMb)) < 15.0;
  console.log(`  STATUS: ${passed ? "\x1b[32mPASSED ✅\x1b[0m" : "\x1b[31mFAILED ❌\x1b[0m"}`);

  return passed;
}

/**
 * Suite runner
 */
(async () => {
  console.log("=========================================================");
  console.log("    KNXnetIPServer & KNXTunneling Benchmark Suite        ");
  console.log("=========================================================");

  const results: { name: string; passed: boolean; score?: string }[] = [];

  try {
    // Phase 1
    const p1 = await runSingleClientStress(PORT);
    results.push({
      name: "Phase 1: Single-Client Benchmark",
      passed: p1.passed,
      score: `${p1.throughput.toFixed(1)} msgs/s (lat: ${p1.avgLat.toFixed(2)}ms)`
    });

    // Phase 2
    const p2 = await runMultiClientStress(PORT);
    results.push({
      name: "Phase 2: Multi-Client Concurrent Load",
      passed: p2.passed,
      score: `${p2.throughput.toFixed(1)} msgs/s`
    });

    // Phase 3
    const p3 = await runGatewayProtectionTest(PORT);
    results.push({
      name: "Phase 3: Gateway Flood Protection",
      passed: p3
    });

    // Phase 4
    const p4 = await runSustainedLoadProfiling(PORT);
    results.push({
      name: "Phase 4: Sustained Load & Resource Profiling",
      passed: p4
    });

  } catch (err) {
    console.error("Fatal error during benchmark suite execution:", err);
    process.exit(1);
  }

  console.log("\n=========================================================");
  console.log("                  BENCHMARK SUMMARY                      ");
  console.log("=========================================================");
  let allPassed = true;
  for (const res of results) {
    const statusText = res.passed ? "\x1b[32mPASSED\x1b[0m" : "\x1b[31mFAILED\x1b[0m";
    const scoreText = res.score ? ` (${res.score})` : "";
    console.log(`- ${res.name}: ${statusText}${scoreText}`);
    if (!res.passed) allPassed = false;
  }
  console.log("=========================================================");

  if (allPassed) {
    console.log("\x1b[32mALL PERFORMANCE AND STABILITY BENCHMARKS PASSED! 🎉\x1b[0m");
    process.exit(0);
  } else {
    console.log("\x1b[31mSOME BENCHMARKS FAILED. ❌\x1b[0m");
    process.exit(1);
  }
})();
