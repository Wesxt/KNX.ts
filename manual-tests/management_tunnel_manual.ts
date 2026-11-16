import {
  ConnectionType,
  DeviceIdentity,
  GroupAddressTableResult,
  KNXManagement,
  KNXTunneling,
  KNXTunnelingOptions,
  ProgrammingModeReadResult,
} from "../src";
import { getLocalIP } from "../src/utils/localIp";

// Configuration (can be overridden via environment variables)
const GATEWAY_IP = process.env.KNX_IP || "192.168.0.204";
const GATEWAY_PORT = Number(process.env.KNX_PORT) || 3671;
const SCAN_START = Number(process.env.SCAN_START) || 1;
const SCAN_END = Number(process.env.SCAN_END) || 10;

let clientTunneling: KNXTunneling | null = null;

interface TestStepResult {
  step: string;
  status: "PASSED" | "FAILED" | "SKIPPED";
  details?: any;
  error?: string;
}

const results: TestStepResult[] = [];

async function gracefulShutdown(reason: string, exitCode = 0) {
  console.log(`\n[Shutdown] ${reason}`);
  try {
    if (clientTunneling) {
      console.log("[Tunneling] Disconnecting client...");
      clientTunneling.disconnect();
    }
    await new Promise((res) => setTimeout(res, 300));
  } catch (err) {
    console.error("[Shutdown] Error during disconnect:", err);
  } finally {
    process.exit(exitCode);
  }
}

process.once("SIGINT", () => gracefulShutdown("SIGINT received (Ctrl+C)", 0));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM received", 0));

async function runManagementManualTest() {
  console.log("==================================================================");
  console.log("  KNXManagement Manual Test Suite over KNXnet/IP Tunnel");
  console.log(`  Target Gateway : ${GATEWAY_IP}:${GATEWAY_PORT}`);
  console.log(`  Local IP       : ${getLocalIP()}`);
  console.log("==================================================================\n");

  const options: KNXTunnelingOptions = {
    ip: GATEWAY_IP,
    port: GATEWAY_PORT,
    connectionType: ConnectionType.TUNNEL_CONNECTION,
    localIp: getLocalIP(),
    transport: "UDP",
    useRouteBack: false,
  };

  clientTunneling = new KNXTunneling(options);

  clientTunneling.on("error", (err: Error) => {
    console.error("[Tunneling Error]:", err.message);
  });

  console.log(`[Tunneling] Connecting to ${GATEWAY_IP}:${GATEWAY_PORT}...`);
  await clientTunneling.connect();
  console.log(`[Tunneling] Connected successfully!`);
  console.log(`[Tunneling] Assigned Individual Address: ${clientTunneling.individualAddress}`);
  console.log(`[Tunneling] Channel ID: ${clientTunneling["channelId"]}`);

  // Determine line / subnetwork from assigned address or env
  const assignedAddr = clientTunneling.individualAddress || "1.1.250";
  const addrParts = assignedAddr.split(".");
  const defaultSubnetwork = addrParts.length >= 2 ? `${addrParts[0]}.${addrParts[1]}` : "1.1";
  const subnetwork = process.env.TARGET_LINE || defaultSubnetwork;

  // Initialize KNXManagement with the active tunnel
  const mgmt = new KNXManagement(clientTunneling, {
    minFrameDelayMs: 25,
    ackTimeoutMs: 3000,
    responseTimeoutMs: 3000,
  });

  console.log(`[Management] Management client initialized with source address: ${mgmt.sourceAddress}`);

  let discoveredDevices: string[] = [];
  let candidateTargetAddress: string = process.env.TARGET_DEVICE || "";
  let identifiedIdentity: DeviceIdentity | null = null;

  // --------------------------------------------------------------------------
  // STEP 1: readProgrammingModeDevices
  // --------------------------------------------------------------------------
  console.log("\n------------------------------------------------------------------");
  console.log("[STEP 1/7] Testing: readProgrammingModeDevices()");
  console.log("------------------------------------------------------------------");
  try {
    const progModeRes: ProgrammingModeReadResult = await mgmt.readProgrammingModeDevices(3000);
    console.log("Devices in Programming Mode:", progModeRes.addresses);
    if (progModeRes.duplicates.length > 0) {
      console.warn("⚠️ Duplicate Individual Addresses detected:", progModeRes.duplicates);
    }
    if (progModeRes.addresses.length > 0 && !candidateTargetAddress) {
      candidateTargetAddress = progModeRes.addresses[0];
      console.log(`-> Picked target device from programming mode: ${candidateTargetAddress}`);
    }
    results.push({
      step: "readProgrammingModeDevices",
      status: "PASSED",
      details: progModeRes,
    });
  } catch (err: any) {
    console.error("❌ readProgrammingModeDevices failed:", err.message);
    results.push({
      step: "readProgrammingModeDevices",
      status: "FAILED",
      error: err.message,
    });
  }

  // --------------------------------------------------------------------------
  // STEP 2: scanLine
  // --------------------------------------------------------------------------
  console.log("\n------------------------------------------------------------------");
  console.log(`[STEP 2/7] Testing: scanLine("${subnetwork}", range: [${SCAN_START}, ${SCAN_END}])`);
  console.log("------------------------------------------------------------------");
  try {
    console.log(`Scanning subnetwork ${subnetwork} addresses ${SCAN_START} to ${SCAN_END}...`);
    discoveredDevices = await mgmt.scanLine(subnetwork, {
      range: [SCAN_START, SCAN_END],
      timeoutPerAddressMs: 350,
      method: "connect",
    });
    console.log(`Scan completed! Discovered ${discoveredDevices.length} device(s):`, discoveredDevices);

    if (discoveredDevices.length > 0 && !candidateTargetAddress) {
      candidateTargetAddress = discoveredDevices[0];
      console.log(`-> Selected target device from scan: ${candidateTargetAddress}`);
    }

    results.push({
      step: "scanLine",
      status: "PASSED",
      details: { subnetwork, scannedRange: [SCAN_START, SCAN_END], discovered: discoveredDevices },
    });
  } catch (err: any) {
    console.error("❌ scanLine failed:", err.message);
    results.push({
      step: "scanLine",
      status: "FAILED",
      error: err.message,
    });
  }

  // Fallback target address if none found yet
  if (!candidateTargetAddress) {
    candidateTargetAddress = `${subnetwork}.1`;
    console.log(`-> No device found in scan or prog mode. Using fallback target address: ${candidateTargetAddress}`);
  }

  // --------------------------------------------------------------------------
  // STEP 3: isAddressOccupied
  // --------------------------------------------------------------------------
  console.log("\n------------------------------------------------------------------");
  console.log(`[STEP 3/7] Testing: isAddressOccupied("${candidateTargetAddress}")`);
  console.log("------------------------------------------------------------------");
  try {
    const isOccupied = await mgmt.isAddressOccupied(candidateTargetAddress, 2000);
    console.log(`Address ${candidateTargetAddress} is occupied: ${isOccupied}`);

    // Also test an address unlikely to exist on the line (e.g. .248)
    const emptyAddress = `${subnetwork}.248`;
    console.log(`Testing address unlikely to exist: ${emptyAddress}...`);
    const isEmpty = await mgmt.isAddressOccupied(emptyAddress, 1000);
    console.log(`Address ${emptyAddress} is occupied: ${isEmpty}`);

    results.push({
      step: "isAddressOccupied",
      status: "PASSED",
      details: {
        [candidateTargetAddress]: isOccupied,
        [emptyAddress]: isEmpty,
      },
    });
  } catch (err: any) {
    console.error("❌ isAddressOccupied failed:", err.message);
    results.push({
      step: "isAddressOccupied",
      status: "FAILED",
      error: err.message,
    });
  }

  // --------------------------------------------------------------------------
  // STEP 4: identifyDevice
  // --------------------------------------------------------------------------
  console.log("\n------------------------------------------------------------------");
  console.log(`[STEP 4/7] Testing: identifyDevice("${candidateTargetAddress}")`);
  console.log("------------------------------------------------------------------");
  try {
    const identity: DeviceIdentity = await mgmt.identifyDevice(candidateTargetAddress);
    identifiedIdentity = identity;
    console.log("Device Identity Info:");
    console.log(`  - Individual Address : ${identity.individualAddress}`);
    console.log(`  - Mask / Descriptor0 : 0x${identity.descriptorType0.toString(16).padStart(4, "0")} (${identity.maskName ?? "Unknown"})`);
    console.log(
      `  - Manufacturer       : ${identity.manufacturerName ?? "Unknown"} (${
        identity.manufacturerId !== undefined ? `0x${identity.manufacturerId.toString(16).padStart(4, "0")} / ${identity.manufacturerId}` : "N/A"
      })`,
    );
    console.log(`  - Serial Number      : ${identity.serialNumber ?? "N/A"}`);
    console.log(`  - Hardware Type      : ${identity.hardwareType ?? "N/A"}`);
    console.log(
      `  - Order Info         : ${identity.orderInfoText ? `${identity.orderInfoText} (raw: ${identity.orderInfo})` : (identity.orderInfo ?? "N/A")}`,
    );
    console.log(`  - Firmware Revision  : ${identity.firmwareRevision ?? "N/A"}`);
    console.log(`  - Max APDU Length    : ${identity.maxApduLength ?? "N/A"}`);
    console.log(`  - Programming Mode   : ${identity.programmingMode ?? "N/A"}`);

    results.push({
      step: "identifyDevice",
      status: "PASSED",
      details: identity,
    });
  } catch (err: any) {
    console.error(`❌ identifyDevice("${candidateTargetAddress}") failed:`, err.message);
    results.push({
      step: "identifyDevice",
      status: "FAILED",
      error: err.message,
    });
  }

  // --------------------------------------------------------------------------
  // STEP 5: readDeviceGroupAddresses
  // --------------------------------------------------------------------------
  console.log("\n------------------------------------------------------------------");
  console.log(`[STEP 5/7] Testing: readDeviceGroupAddresses("${candidateTargetAddress}")`);
  console.log("------------------------------------------------------------------");
  try {
    const gaResult: GroupAddressTableResult = await mgmt.readDeviceGroupAddresses(candidateTargetAddress);
    console.log("Group Address Table Info:");
    console.log(`  - Target Address     : ${gaResult.individualAddress}`);
    console.log(`  - Read Method        : ${gaResult.method}`);
    if (gaResult.tableAddress !== undefined) {
      console.log(`  - Table Address      : 0x${gaResult.tableAddress.toString(16).padStart(4, "0")}`);
    }
    console.log(`  - Group Addresses (${gaResult.groupAddresses.length}):`, gaResult.groupAddresses);

    results.push({
      step: "readDeviceGroupAddresses",
      status: "PASSED",
      details: gaResult,
    });
  } catch (err: any) {
    console.error(`❌ readDeviceGroupAddresses("${candidateTargetAddress}") failed:`, err.message);
    results.push({
      step: "readDeviceGroupAddresses",
      status: "FAILED",
      error: err.message,
    });
  }

  // --------------------------------------------------------------------------
  // STEP 6: exportInventory
  // --------------------------------------------------------------------------
  console.log("\n------------------------------------------------------------------");
  const inventoryTargets = discoveredDevices.length > 0 ? discoveredDevices : [candidateTargetAddress];
  console.log(`[STEP 6/7] Testing: exportInventory([${inventoryTargets.join(", ")}])`);
  console.log("------------------------------------------------------------------");
  try {
    console.log(`Exporting inventory for ${inventoryTargets.length} device(s)...`);
    const inventory: DeviceIdentity[] = await mgmt.exportInventory(inventoryTargets);
    console.log("Inventory Export Result:");
    console.log(JSON.stringify(inventory, null, 2));

    results.push({
      step: "exportInventory",
      status: "PASSED",
      details: inventory,
    });
  } catch (err: any) {
    console.error("❌ exportInventory failed:", err.message);
    results.push({
      step: "exportInventory",
      status: "FAILED",
      error: err.message,
    });
  }

  // --------------------------------------------------------------------------
  // STEP 7: writeIndividualAddressBySerial (Change to 1.1.2 and restore)
  // --------------------------------------------------------------------------
  console.log("\n------------------------------------------------------------------");
  console.log(`[STEP 7/7] Testing: Individual Address Change -> 1.1.2 -> Restore`);
  console.log("------------------------------------------------------------------");
  if (!identifiedIdentity?.serialNumber) {
    console.warn("⚠️ Skipping Individual Address change test: no Serial Number available from Step 4.");
    results.push({
      step: "writeIndividualAddress",
      status: "SKIPPED",
      error: "No Serial Number available",
    });
  } else {
    const originalAddress = identifiedIdentity.individualAddress;
    const tempAddress = process.env.TEMP_ADDRESS || (originalAddress === "1.1.2" ? "1.1.3" : "1.1.2");
    const serialBuf = Buffer.from(identifiedIdentity.serialNumber, "hex");
    let changedToTemp = false;

    try {
      console.log(`Original Address : ${originalAddress}`);
      console.log(`Serial Number    : ${identifiedIdentity.serialNumber}`);
      console.log(`Target Temp Addr : ${tempAddress}`);

      console.log(`\n1) Changing Individual Address to ${tempAddress}...`);
      const writeRes = await mgmt.writeIndividualAddressBySerial(serialBuf, tempAddress, {
        checkOccupied: true,
        verifyTimeoutMs: 3000,
      });
      changedToTemp = true;
      console.log(`✅ Verified via SerialNumber_Read: device is now at ${writeRes.individualAddress}`);

      const occupiedAtTemp = await mgmt.isAddressOccupied(tempAddress, 2000);
      console.log(`✅ isAddressOccupied("${tempAddress}") => ${occupiedAtTemp}`);

      console.log(`\n2) Restoring Individual Address back to ${originalAddress}...`);
      const restoreRes = await mgmt.writeIndividualAddressBySerial(serialBuf, originalAddress, {
        checkOccupied: true,
        verifyTimeoutMs: 3000,
      });
      changedToTemp = false;
      console.log(`✅ Verified via SerialNumber_Read: device restored to ${restoreRes.individualAddress}`);

      const occupiedAtOrig = await mgmt.isAddressOccupied(originalAddress, 2000);
      console.log(`✅ isAddressOccupied("${originalAddress}") => ${occupiedAtOrig}`);

      results.push({
        step: "writeIndividualAddress",
        status: "PASSED",
        details: { originalAddress, tempAddress, restoredAddress: restoreRes.individualAddress },
      });
    } catch (err: any) {
      console.error("❌ Individual Address change test failed:", err.message);
      if (changedToTemp) {
        console.warn(`⚠️ Attempting emergency restore to ${originalAddress}...`);
        try {
          await mgmt.writeIndividualAddressBySerial(serialBuf, originalAddress, {
            checkOccupied: false,
            verifyTimeoutMs: 3000,
          });
          console.log(`✅ Emergency restore to ${originalAddress} succeeded.`);
        } catch (restoreErr: any) {
          console.error(`❌ Emergency restore to ${originalAddress} FAILED:`, restoreErr.message);
        }
      }
      results.push({
        step: "writeIndividualAddress",
        status: "FAILED",
        error: err.message,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log("\n==================================================================");
  console.log("  TEST SUMMARY");
  console.log("==================================================================");
  for (const res of results) {
    const symbol = res.status === "PASSED" ? "✅" : res.status === "FAILED" ? "❌" : "⚠️";
    console.log(`  ${symbol} ${res.step.padEnd(28)} : ${res.status}${res.error ? ` (${res.error})` : ""}`);
  }
  console.log("==================================================================\n");

  const hasFailures = results.some((r) => r.status === "FAILED");
  await gracefulShutdown("Manual test sequence completed.", hasFailures ? 1 : 0);
}

runManagementManualTest().catch(async (err) => {
  console.error("\n❌ Fatal error in test suite:", err);
  await gracefulShutdown("Fatal error", 1);
});
