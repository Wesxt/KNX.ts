import fs from "node:fs";
import path from "node:path";
import {
  ConnectionType,
  DeviceConfigSession,
  DownloadMode,
  KNXDeviceProgrammer,
  KNXnetIPServer,
  KNXService,
  KNXTunneling,
  KNXUSBConnection,
  KnxDataSecure,
  KnxKeyring,
  KnxProdParser,
} from "../src";
import { getLocalIP } from "../src/utils/localIp";

/**
 * Manual test & CLI utility for inspecting and programming real KNX System B (0x07B0) devices from a `.knxprod` file.
 * Supports plain and KNX Data Secure (`ToolKey` via `.knxkeys`) sessions over Tunneling, KNX USB, or Routing.
 *
 * SAFETY: Runs in `DRY_RUN=true` mode by default so it ONLY inspects the `.knxprod` and reads device info without
 * writing anything to flash memory. Pass `DRY_RUN=false` explicitly when you are ready to program the target device.
 *
 * Usage examples:
 *   # 1) Offline compile & plan only (no interface needed):
 *   OFFLINE=true KNXPROD="Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod" npm run manualTest:program
 *
 *   # 2) Live pre-flight + dry-run over Tunneling with KNX Data Secure (.knxkeys):
 *   KNX_IP=192.168.0.204 TARGET_DEVICE=1.1.1 \
 *   KNX_KEYRING_FILE="testKey/PRUEBA-ACTUALIZADO.knxkeys" KNX_KEYRING_PASSWORD="123456789" \
 *   KNXPROD="Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod" \
 *   npm run manualTest:program
 *
 *   # 3) Live pre-flight + dry-run over KNX USB with KNX Data Secure (.knxkeys):
 *   TRANSPORT=usb TARGET_DEVICE=1.1.1 \
 *   KNX_KEYRING_FILE="testKey/PRUEBA-ACTUALIZADO.knxkeys" KNX_KEYRING_PASSWORD="123456789" \
 *   KNXPROD="Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod" \
 *   npm run manualTest:program
 *
 *   # 4) Live pre-flight + dry-run over KNX IP Secure Routing + Data Secure:
 *   TRANSPORT=routing KNX_IP_SECURE=true TARGET_DEVICE=1.1.1 \
 *   KNX_KEYRING_FILE="testKey/PRUEBA-ACTUALIZADO.knxkeys" KNX_KEYRING_PASSWORD="123456789" \
 *   KNXPROD="Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod" \
 *   npm run manualTest:program
 */

const KNXPROD_PATH = path.resolve(
  process.cwd(),
  process.env.KNXPROD || "Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod",
);
const TRANSPORT = (process.env.TRANSPORT || process.env.KNX_TRANSPORT || "tunnel").toLowerCase(); // "tunnel" | "usb" | "routing"
const GATEWAY_IP = process.env.KNX_IP || "192.168.0.204";
const GATEWAY_PORT = Number(process.env.KNX_PORT) || 3671;
const LOCAL_IP = process.env.KNX_LOCAL_IP || getLocalIP();
const LOCAL_IA = process.env.KNX_LOCAL_IA || undefined;
const MULTICAST_IP = process.env.KNX_MULTICAST_IP || undefined;
const USB_PATH = process.env.USB_PATH || undefined;
const USB_IA = process.env.USB_IA || undefined;
const TARGET_DEVICE = process.env.TARGET_DEVICE || "1.1.1";
const MODE = (process.env.MODE || "ap1") as DownloadMode;
const OFFLINE = process.env.OFFLINE === "true";
const DRY_RUN = process.env.DRY_RUN !== "false";
const KNX_LANG = process.env.KNX_LANG || undefined; // e.g. "es-ES" or "en-US"
const CONFIG_JSON = process.env.CONFIG_JSON ? path.resolve(process.cwd(), process.env.CONFIG_JSON) : undefined;

// KNX Data Secure / KNX IP Secure options
const KEYRING_FILE = process.env.KNX_KEYRING_FILE
  ? path.resolve(process.cwd(), process.env.KNX_KEYRING_FILE)
  : undefined;
const KEYRING_PASSWORD = process.env.KNX_KEYRING_PASSWORD || undefined;
const SEQ_FILE = path.resolve(process.cwd(), process.env.KNX_SEQ_FILE || "testKey/seq_state.json");
const IP_SECURE = process.env.KNX_IP_SECURE === "1" || process.env.KNX_IP_SECURE === "true";
const FORCE_DATA_SECURE = process.env.KNX_DATA_SECURE === "1" || process.env.KNX_DATA_SECURE === "true";
const PROGRAM_SECURITY_OBJ = process.env.PROGRAM_SECURITY_OBJECT === "true";

async function main() {
  console.log("==================================================================");
  console.log("  KNX.ts Application Programmer (System B / MV-07B0 + Phase 2)");
  console.log(`  .knxprod  : ${KNXPROD_PATH}`);
  console.log(
    `  Transport : ${OFFLINE ? "offline" : TRANSPORT}  |  Mode: ${MODE}  |  DryRun: ${DRY_RUN}${KNX_LANG ? `  |  Lang: ${KNX_LANG}` : ""}`,
  );
  if (KEYRING_FILE) {
    console.log(`  Keyring   : ${KEYRING_FILE} (IPSecure=${IP_SECURE})`);
  }
  if (CONFIG_JSON) {
    console.log(`  Config    : ${CONFIG_JSON}`);
  }
  console.log("==================================================================\n");

  const t0 = Date.now();
  const parsed = await KnxProdParser.parseFile(KNXPROD_PATH, { language: KNX_LANG });
  const app = parsed.applications[0];
  console.log(`[1/3] Parsed "${app.name}" in ${Date.now() - t0} ms`);
  console.log(
    `  - App ID        : ${app.id} (Mfr=0x${app.manufacturerId.toString(16).padStart(4, "0")}, App=0x${app.applicationNumber.toString(16).padStart(4, "0")}, Ver=${app.applicationVersion})`,
  );
  console.log(`  - MaskVersion   : ${app.maskVersionId} (0x${app.maskVersion.toString(16).padStart(4, "0")})`);
  console.log(`  - ByteOrder     : ${app.options.parameterByteOrder}`);
  console.log(`  - ExtendedMem   : ${app.options.supportsExtendedMemoryServices}`);
  console.log(`  - Languages     : ${app.availableLanguages.join(", ") || app.defaultLanguage}`);
  console.log(
    `  - Counts        : ${app.parameters.size} params, ${app.comObjects.size} ComObjects, ${app.parameterCalculations.length} JS calcs`,
  );

  // Build interactive/JSON-serializable DeviceConfigSession (same API usable by web apps!)
  const session = CONFIG_JSON
    ? DeviceConfigSession.fromJSON(parsed, fs.readFileSync(CONFIG_JSON, "utf8"))
    : new DeviceConfigSession(parsed);

  const uiState = session.getUiState();
  console.log(
    `  - UI Schema     : ${uiState.channels.length} channels, ${uiState.stats.visibleParameters} visible params, ${uiState.stats.activeComObjects} active ComObjects`,
  );

  // Optional KNX Data Secure keyring initialization
  let keyring: KnxKeyring | undefined;
  let dataSecure: KnxDataSecure | undefined;
  let useDataSecureSession = FORCE_DATA_SECURE;

  if (KEYRING_FILE) {
    if (!KEYRING_PASSWORD) {
      throw new Error("KNX_KEYRING_PASSWORD is required when KNX_KEYRING_FILE is set");
    }
    keyring = KnxKeyring.fromSource(KEYRING_FILE, KEYRING_PASSWORD);
    dataSecure = new KnxDataSecure({
      keyring,
      sourceAddress: LOCAL_IA,
      sequenceNumberFile: SEQ_FILE,
      autoEncryptOutgoingGroup: true,
      autoDecryptIncoming: true,
    });
    const hasToolKey = Boolean(dataSecure.getDeviceToolKey(TARGET_DEVICE));
    if (hasToolKey) {
      useDataSecureSession = true;
    }
    session.setKeyring(keyring);
    if (PROGRAM_SECURITY_OBJ) {
      session.setSecurityConfig({ enabled: true });
    }
    console.log(
      `\n[Security] Loaded keyring (${keyring.createdBy ?? "ETS"}): ToolKey for ${TARGET_DEVICE}=${hasToolKey ? "YES" : "NO"}, DataSecureSession=${useDataSecureSession}`,
    );
  }

  const validation = session.validate();
  if (!validation.valid) {
    console.error("\n[Validation Errors]");
    for (const err of validation.errors) {
      console.error(`  - [${err.code}] ${err.path}: ${err.message}`);
    }
    process.exit(1);
  }

  if (OFFLINE) {
    const { image, plan } = session.planDownload({ mode: MODE });
    console.log("\n[2/3] Compiled System B Image:");
    console.log(`  - ProgramVersion : ${image.programVersion.toString("hex").toUpperCase()}`);
    console.log(`  - Active Params  : ${image.evaluated.activeParameterIds.size}`);
    console.log(`  - Active ComObjs : ${image.evaluated.activeComObjects.size} / ${image.groupObjectCount}`);
    console.log(`  - GrAT (Obj 1)   : ${image.groupAddressTable.length} B (${image.groupAddresses.length} GAs)`);
    console.log(
      `  - GrOAT (Obj 2)  : ${image.associationTable.length} B (${image.associationCount} assocs, Format ${image.associationTableFormat})`,
    );
    console.log(`  - GrOT (Obj 3)   : ${image.groupObjectTable.length} B (${image.groupObjectCount} slots)`);
    for (const [lsm, seg] of image.segments.entries()) {
      console.log(
        `  - Segment Obj ${lsm}  : ${seg.size} B (CRC16=0x${seg.crc16.toString(16).padStart(4, "0")}, patched=${seg.patchedByteCount} B)`,
      );
    }
    if (image.securityImage) {
      console.log(
        `  - Security Obj17 : ${image.securityImage.groupKeyTable.length} group keys, ${image.securityImage.securityIndividualAddressTable.length} IAs, ${image.securityImage.goSecurityFlags.length} GO flags`,
      );
    }
    for (const exp of image.expectedProperties) {
      console.log(
        `  - Expected HW    : Obj ${exp.objectIndex} PID ${exp.propertyId} (${exp.description}) = ${exp.expectedValue.toString("hex").toUpperCase()}`,
      );
    }
    console.log(
      `\n[3/3] Download Plan (${plan.actions.length} steps, ~${plan.estimatedBytesToWrite} bytes to transmit):`,
    );
    for (const [i, act] of plan.actions.entries()) {
      console.log(`  ${String(i + 1).padStart(2, " ")}. ${JSON.stringify(act)}`);
    }
    return;
  }

  let service: KNXService;
  let interfaceMaxApduLength = 220;

  if (TRANSPORT === "usb") {
    const usb = new KNXUSBConnection({
      path: USB_PATH,
      individualAddress: USB_IA ?? LOCAL_IA,
      programHardwareAddress: Boolean(USB_IA),
      dataSecure,
    });
    usb.on("error", (err: Error) => console.error("[KNX USB Error]", err.message));
    console.log(`\n[2/3] Opening KNX USB interface${USB_PATH ? ` (${USB_PATH})` : " (auto-detect)"}...`);
    await usb.connect();
    console.log(
      `  Connected! EMI=${usb.activeEmiType === 0x03 ? "cEMI" : usb.activeEmiType === 0x01 ? "EMI1" : "EMI2"}, IA=${usb.individualAddress} (HW=${usb.hardwareIndividualAddress ?? "N/A"})`,
    );
    if (usb.activeEmiType !== 0x03) {
      interfaceMaxApduLength = 15;
    }
    service = usb;
  } else if (TRANSPORT === "routing") {
    const backbone = keyring?.getBackbone();
    const multicastIp = MULTICAST_IP ?? backbone?.multicastAddress ?? "224.0.23.12";
    const routingIA = LOCAL_IA ?? keyring?.getInterface()?.individualAddress ?? "1.1.200";
    const router = new KNXnetIPServer({
      ip: multicastIp,
      port: GATEWAY_PORT,
      localIp: LOCAL_IP,
      individualAddress: routingIA,
      tcp: false,
      ...(IP_SECURE && KEYRING_FILE && KEYRING_PASSWORD
        ? {
            secure: {
              keyringFile: KEYRING_FILE,
              keyringPassword: KEYRING_PASSWORD,
            },
          }
        : {}),
      dataSecure,
    });
    console.log(
      `\n[2/3] Connecting KNX Routing ${multicastIp}:${GATEWAY_PORT} (localIp=${LOCAL_IP}, IA=${routingIA}, IPSecure=${IP_SECURE})...`,
    );
    await router.connect();
    if (IP_SECURE) {
      router.sendTimerNotify();
      await new Promise((r) => setTimeout(r, 1500));
      console.log(`  Secure Routing mc_timer synced: ${router.secureRoutingTimerValue}`);
    }
    service = router;
  } else {
    const client = new KNXTunneling({
      ip: GATEWAY_IP,
      port: GATEWAY_PORT,
      connectionType: ConnectionType.TUNNEL_CONNECTION,
      localIp: LOCAL_IP,
      individualAddress: LOCAL_IA,
      transport: IP_SECURE ? "TCP" : "UDP",
      useRouteBack: false,
      ...(IP_SECURE && KEYRING_FILE && KEYRING_PASSWORD
        ? {
            secure: {
              keyringFile: KEYRING_FILE,
              keyringPassword: KEYRING_PASSWORD,
            },
          }
        : {}),
      dataSecure,
    });
    client.on("error", (err: Error) => console.error("[Tunneling Error]", err.message));
    console.log(
      `\n[2/3] Connecting to gateway ${GATEWAY_IP}:${GATEWAY_PORT} (${IP_SECURE ? "KNX IP Secure TCP" : "UDP"})...`,
    );
    await client.connect();
    console.log(`  Connected! Assigned IA: ${client.individualAddress}`);
    service = client;
  }

  // Ensure Data Secure signs frames using the actual Individual Address assigned to this connection
  if (dataSecure && service.individualAddress) {
    dataSecure.sourceAddress = service.individualAddress;
  }

  try {
    const programmer = new KNXDeviceProgrammer(service, {
      sourceAddress: service.individualAddress,
      dataSecure,
      minFrameDelayMs: 25,
      ackTimeoutMs: 3000,
      responseTimeoutMs: 5000,
    });

    console.log(
      `\n[3/3] Starting ${DRY_RUN ? "DRY-RUN" : "REAL DOWNLOAD"} to ${TARGET_DEVICE} (${useDataSecureSession ? "KNX Data Secure" : "Plain"})...`,
    );
    const result = await session.download(programmer, TARGET_DEVICE, {
      mode: MODE,
      dryRun: DRY_RUN,
      interfaceMaxApduLength,
      verifyDeviceBeforeWrite: true,
      strictHardwareTypeCheck: true,
      sessionOptions: useDataSecureSession ? { secure: true } : undefined,
      onProgress: (ev) => {
        console.log(`  [${ev.percent.toString().padStart(3, " ")}%] (${ev.phase}) ${ev.message}`);
      },
    });

    console.log("\n--- RESULT ---");
    console.log(`  Target      : ${result.individualAddress}`);
    console.log(`  DryRun      : ${result.dryRun}`);
    console.log(`  Bytes       : ${result.bytesWritten} B (${result.framesSent} memory frames)`);
    console.log(`  Duration    : ${result.durationMs} ms`);
    if (result.preflight) {
      console.log(`  Device Mask : 0x${result.preflight.maskVersion.toString(16).padStart(4, "0")}`);
      console.log(
        `  Max APDU    : ${result.preflight.maxApduLength} (effective ${result.preflight.effectiveMaxApduLength})`,
      );
      console.log(`  Serial      : ${result.preflight.serialNumber ?? "N/A"}`);
      console.log(`  HW Type     : ${result.preflight.hardwareType?.toString("hex").toUpperCase() ?? "N/A"}`);
      console.log(`  Cur App Ver : ${result.preflight.currentProgramVersion?.toString("hex").toUpperCase() ?? "N/A"}`);
    }
    console.log("  Steps:");
    for (const s of result.executedSteps) {
      console.log(`    - ${s}`);
    }
  } finally {
    dataSecure?.saveState();
    service.disconnect();
    await new Promise((r) => setTimeout(r, 250));
  }
}

main().catch((err) => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
