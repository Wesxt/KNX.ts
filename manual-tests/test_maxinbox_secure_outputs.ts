import path from "node:path";
import { ConnectionType, DataSecureCEMI, KNXTunneling, KnxDataDecode, KnxDataSecure, KnxKeyring } from "../src";
import { getLocalIP } from "../src/utils/localIp";

/**
 * Script de prueba para las 6 salidas seguras del Zennio MAXinBOX 66 v3 (1.1.1):
 * - Enciende y apaga secuencialmente Salidas A1..C6 (1/0/1 .. 1/0/6) con KNX Data Secure (A+C)
 * - Escucha y valida las respuestas de estado cifradas en 1/1/1 .. 1/1/6
 *
 * Uso:
 *   npx tsx manual-tests/test_maxinbox_secure_outputs.ts
 *
 * Variables opcionales:
 *   KNX_IP=192.168.0.204
 *   KNX_PORT=3671
 *   KNX_LOCAL_IA=1.1.200
 *   TARGET_DEVICE=1.1.1
 *   OUTPUTS=1,2,3,4,5,6          # Qué salidas probar (por defecto todas: 1..6)
 *   HOLD_MS=1500                 # Tiempo encendida cada salida (ms)
 */

const GATEWAY_IP = process.env.KNX_IP || "192.168.0.204";
const GATEWAY_PORT = Number(process.env.KNX_PORT) || 3671;
const LOCAL_IP = process.env.KNX_LOCAL_IP || getLocalIP();
const LOCAL_IA = process.env.KNX_LOCAL_IA || "1.1.200";
const TARGET_DEVICE = process.env.TARGET_DEVICE || "1.1.1";
const KEYRING_FILE = path.resolve(process.cwd(), process.env.KNX_KEYRING_FILE || "testKey/PRUEBA-ACTUALIZADO.knxkeys");
const KEYRING_PASSWORD = process.env.KNX_KEYRING_PASSWORD || "123456789";
const SEQ_FILE = path.resolve(process.cwd(), process.env.KNX_SEQ_FILE || "testKey/seq_state.json");
const HOLD_MS = Number(process.env.HOLD_MS) || 1500;
const OUTPUTS = (process.env.OUTPUTS || "1,2,3,4,5,6")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => n >= 1 && n <= 6);

const OUTPUT_LABELS: Record<number, string> = {
  1: "Salida A1",
  2: "Salida A2",
  3: "Salida B3",
  4: "Salida B4",
  5: "Salida C5",
  6: "Salida C6",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const keyring = KnxKeyring.fromSource(KEYRING_FILE, KEYRING_PASSWORD);
  const dataSecure = new KnxDataSecure({
    keyring,
    sourceAddress: LOCAL_IA,
    sequenceNumberFile: SEQ_FILE,
    autoEncryptOutgoingGroup: true,
    autoDecryptIncoming: true,
  });

  dataSecure.on("failure", (ev) => {
    console.warn(`[DataSecure FAILURE] reason=${ev.reason} ${ev.sourceAddress} -> ${ev.destinationAddress}`);
  });

  const tunnel = new KNXTunneling({
    ip: GATEWAY_IP,
    port: GATEWAY_PORT,
    connectionType: ConnectionType.TUNNEL_CONNECTION,
    localIp: LOCAL_IP,
    individualAddress: LOCAL_IA,
    transport: "UDP",
    useRouteBack: false,
    dataSecure,
  });

  const statusUpdates = new Map<string, { value: boolean; seq: bigint; secure: boolean }>();

  tunnel.on("error", (err) => console.error("[Tunnel Error]", err.message));
  tunnel.on("indication", (cemi: DataSecureCEMI) => {
    if (!("destinationAddress" in cemi) || !("TPDU" in cemi)) return;
    const dst = cemi.destinationAddress;
    if (!dst.startsWith("1/1/") && !dst.startsWith("1/0/")) return;

    const apciCmd = cemi.TPDU.apdu.apci.command;
    if (apciCmd !== "A_GroupValue_Write_Protocol_Data_Unit" && apciCmd !== "A_GroupValue_Response_Protocol_Data_Unit") {
      return;
    }

    const val = Boolean(KnxDataDecode.decodeThis("1.001", cemi.TPDU.apdu.data));
    const secTag = cemi.dataSecure
      ? `SEGURO (${cemi.dataSecure.confidential ? "A+C" : "A"}, seq=${cemi.dataSecure.sequenceNumber})`
      : "PLANO";
    console.log(`  <-- RX [${secTag}] ${cemi.sourceAddress} -> ${dst} = ${val ? "ON (1)" : "OFF (0)"}`);

    if (dst.startsWith("1/1/")) {
      statusUpdates.set(dst, {
        value: val,
        seq: cemi.dataSecure?.sequenceNumber ?? 0n,
        secure: Boolean(cemi.dataSecure),
      });
    }
  });

  console.log("=============================================================");
  console.log(`  Prueba KNX Data Secure — MAXinBOX 66 v3 (${TARGET_DEVICE})`);
  console.log(`  Gateway : ${GATEWAY_IP}:${GATEWAY_PORT} | Local IA: ${LOCAL_IA}`);
  console.log(`  Salidas : ${OUTPUTS.map((n) => `${n} (${OUTPUT_LABELS[n]})`).join(", ")}`);
  console.log("=============================================================\n");

  await tunnel.connect();
  if (tunnel.individualAddress) {
    dataSecure.sourceAddress = tunnel.individualAddress;
  }
  console.log(`Conectado! IA asignada: ${tunnel.individualAddress}`);

  try {
    // Sincronizar contadores de secuencia de 48 bits con 1.1.1 tras el reinicio
    try {
      const sync = await dataSecure.syncSequenceNumber(tunnel, TARGET_DEVICE, {
        commMode: "individual",
        toolAccess: true,
        timeoutMs: 3000,
        retries: 1,
      });
      console.log(`S-A_Sync OK con ${TARGET_DEVICE}: seqRemote=${sync.seqNrRemote}, seqLocal=${sync.seqNrLocal}\n`);
    } catch (err: any) {
      console.warn(`Aviso S-A_Sync (${err?.message ?? err}); continuando con contadores guardados...\n`);
    }

    let okCount = 0;
    const totalChecks = OUTPUTS.length * 2;

    for (const num of OUTPUTS) {
      const cmdGa = `1/0/${num}`;
      const statusGa = `1/1/${num}`;
      const label = OUTPUT_LABELS[num];

      // 1. ENCENDER
      statusUpdates.delete(statusGa);
      console.log(`--> TX [ON ] ${label}: ${cmdGa} = 1`);
      await tunnel.write(cmdGa, "1.001", true);
      await sleep(HOLD_MS);

      const onRx = statusUpdates.get(statusGa);
      if (onRx && onRx.secure && onRx.value === true) {
        console.log(`  [OK] ${label} confirmó estado SEGURO ON en ${statusGa}`);
        okCount++;
      } else {
        console.warn(`  [!!] ${label} NO confirmó estado seguro ON en ${statusGa} (recibido: ${JSON.stringify(onRx)})`);
      }

      // 2. APAGAR
      statusUpdates.delete(statusGa);
      console.log(`--> TX [OFF] ${label}: ${cmdGa} = 0`);
      await tunnel.write(cmdGa, "1.001", false);
      await sleep(Math.min(1000, HOLD_MS));

      const offRx = statusUpdates.get(statusGa);
      if (offRx && offRx.secure && offRx.value === false) {
        console.log(`  [OK] ${label} confirmó estado SEGURO OFF en ${statusGa}\n`);
        okCount++;
      } else {
        console.warn(
          `  [!!] ${label} NO confirmó estado seguro OFF en ${statusGa} (recibido: ${JSON.stringify(offRx)})\n`,
        );
      }
    }

    console.log("=============================================================");
    console.log(`  RESUMEN: ${okCount}/${totalChecks} confirmaciones seguras recibidas`);
    console.log("=============================================================");
  } finally {
    dataSecure.saveState();
    tunnel.disconnect();
    await sleep(250);
  }
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
