import path from "node:path";
import {
  ConnectionType,
  DataSecureCEMI,
  KNXManagement,
  KNXnetIPServer,
  KNXTunneling,
  KNXUSBConnection,
  KnxDataDecode,
  KnxDataSecure,
  KnxKeyring,
  TPUARTConnection,
  type KNXService,
} from "../src";

/**
 * Manual test script for KNX Data Secure (03_03_07 §5, 03_05_01 §6.3, 03_05_02 §4)
 * configured for `testKey/PRUEBA.knxkeys` and a Zennio MAXinBOX 66 v3 (IA `1.1.1`).
 *
 * Environment variables:
 *   KNX_KEYRING_FILE     Path to `.knxkeys` file (default: `./testKey/PRUEBA.knxkeys`)
 *   KNX_KEYRING_PASSWORD ETS export password for the `.knxkeys` file (REQUIRED)
 *   KNX_TRANSPORT        "usb" | "tunnel" | "tpuart" (default: "usb")
 *   KNX_IP               KNXnet/IP server IP (when KNX_TRANSPORT=tunnel)
 *   KNX_PORT             KNXnet/IP port (default: 3671)
 *   KNX_LOCAL_IA         Source Individual Address (default: "1.1.250")
 *   KNX_TARGET_IA        Target Data Secure device IA (default: "1.1.1" = MAXinBOX 66 v3)
 *   KNX_TEST_GA          Optional Group Address to toggle/read (e.g. "1/0/1")
 *   KNX_TPUART_PATH      Serial port path when KNX_TRANSPORT=tpuart (e.g. "/dev/ttyUSB0")
 *   KNX_SEQ_FILE         JSON file to persist sequence numbers across runs (default: "./testKey/seq_state.json")
 *
 * Example:
 *   KNX_KEYRING_PASSWORD="tu_password" KNX_TRANSPORT=usb npm run manualTest:dataSecure
 *   KNX_KEYRING_PASSWORD="tu_password" KNX_TRANSPORT=tunnel KNX_IP=192.168.1.50 KNX_TEST_GA=1/0/1 npm run manualTest:dataSecure
 */
async function main() {
  const keyringPath = process.env.KNX_KEYRING_FILE ?? path.resolve(__dirname, "../testKey/PRUEBA-ACTUALIZADO.knxkeys");
  const keyringPassword = process.env.KNX_KEYRING_PASSWORD;
  const transport = (process.env.KNX_TRANSPORT ?? "routing").toLowerCase();
  const localIA = process.env.KNX_LOCAL_IA ?? "1.1.200";
  const localIp = process.env.KNX_LOCAL_IP ?? "192.168.0.190";
  const targetIA = process.env.KNX_TARGET_IA ?? "1.1.1";
  const testGA = process.env.KNX_TEST_GA;
  const ipSecureRouting = process.env.KNX_IP_SECURE === "1" || process.env.KNX_IP_SECURE === "true";
  const logLevel = (process.env.KNX_LOG_LEVEL ?? (ipSecureRouting ? "debug" : "info")) as
    | "info"
    | "warn"
    | "error"
    | "debug"
    | "noLog";
  const seqFile = process.env.KNX_SEQ_FILE ?? path.resolve(__dirname, "../testKey/seq_state.json");

  if (!keyringPassword) {
    console.error("ERROR: Define KNX_KEYRING_PASSWORD con la contraseña de exportación de ETS para PRUEBA.knxkeys.");
    console.error('Ejemplo: KNX_KEYRING_PASSWORD="mi_password" npm run manualTest:dataSecure');
    process.exit(1);
  }

  console.log("=== 1. Cargando y verificando keyring ETS (.knxkeys) ===");
  const keyring = KnxKeyring.fromSource(keyringPath, keyringPassword);
  console.log(`Archivo: ${keyringPath} (CreatedBy: ${keyring.createdBy}, Created: ${keyring.created})`);
  const backbone = keyring.getBackbone();
  if (backbone?.decryptedKey) {
    console.log(
      `Backbone Key (KNX IP Secure Routing, Multicast=${backbone.multicastAddress ?? "224.0.23.12"}, Latency=${backbone.latency ?? 2000}ms): ${backbone.decryptedKey.toString("hex")}`,
    );
  }

  const dataSecure = new KnxDataSecure({
    keyring,
    sourceAddress: localIA,
    sequenceNumberFile: seqFile,
    autoEncryptOutgoingGroup: true,
    autoDecryptIncoming: true,
  });

  console.log(
    `Grupos Data Secure (${dataSecure.getConfiguredGroupAddresses().length}):`,
    dataSecure.getConfiguredGroupAddresses(),
  );
  const devEntry = keyring.getDevice(targetIA);
  if (devEntry) {
    console.log(
      `Dispositivo ${targetIA}: ToolKey=${devEntry.decryptedToolKey ? "OK (16B)" : "NO"}, SeqNr=${devEntry.sequenceNumberBigInt}`,
    );
  } else {
    console.warn(`Aviso: ${targetIA} no aparece en <Devices> del keyring.`);
  }

  dataSecure.on("security_failure", (evt) => {
    console.warn(
      `[DataSecure FAILURE] reason=${evt.reason} src=${evt.sourceAddress} dst=${evt.destinationAddress} seq=${evt.seqNr}`,
    );
  });
  dataSecure.on("decrypted", ({ plainCemi, metadata }) => {
    console.log(
      `[DataSecure RX] ${plainCemi.sourceAddress} -> ${plainCemi.destinationAddress} | seq=${metadata.sequenceNumber} | mode=${metadata.confidential ? "A+C" : "A-only"} | tool=${metadata.toolAccess}`,
    );
  });

  console.log(`\n=== 2. Conectando por transporte "${transport}" ===`);
  let service: KNXService;
  if (transport === "tunnel") {
    const ip = process.env.KNX_IP;
    if (!ip) throw new Error("Define KNX_IP cuando KNX_TRANSPORT=tunnel");
    service = new KNXTunneling({
      ip,
      port: Number(process.env.KNX_PORT ?? 3671),
      individualAddress: localIA,
      dataSecure,
      localIp,
      connectionType: ConnectionType.TUNNEL_CONNECTION,
      logOptions: { level: "info", enabled: true },
    });
  } else if (transport === "routing") {
    service = new KNXnetIPServer({
      ip: process.env.KNX_MULTICAST_IP ?? "224.0.23.15",
      port: Number(process.env.KNX_PORT ?? 3671),
      localIp,
      individualAddress: localIA,
      tcp: false,
      ...(ipSecureRouting
        ? {
            secure: {
              keyringFile: keyringPath,
              keyringPassword,
            },
          }
        : {}),
      dataSecure,
      logOptions: { level: logLevel, enabled: true },
    });
    if (ipSecureRouting) {
      console.log("KNX IP Secure Routing ACTIVADO (SECURE_WRAPPER + TIMER_NOTIFY).");
    }
  } else if (transport === "tpuart") {
    service = new TPUARTConnection({
      path: process.env.KNX_TPUART_PATH ?? "/dev/ttyUSB0",
      individualAddress: localIA,
      dataSecure,
      logOptions: { level: "info", enabled: true },
    });
  } else {
    const programUsbIa = process.env.KNX_USB_PROGRAM_IA === "1" || process.env.KNX_USB_PROGRAM_IA === "true";
    service = new KNXUSBConnection({
      ...(process.env.KNX_LOCAL_IA || programUsbIa ? { individualAddress: localIA } : {}),
      ...(programUsbIa ? { programHardwareAddress: true } : {}),
      dataSecure,
      logOptions: { level: logLevel, enabled: true },
    });
  }

  service.on("indication", (cemi: DataSecureCEMI) => {
    if (!("destinationAddress" in cemi) || !("TPDU" in cemi)) return;
    const tag = cemi.dataSecure ? `[SECURE seq=${cemi.dataSecure.sequenceNumber}]` : "[PLAIN]";
    const raw = cemi.TPDU.apdu.data;
    let decodedStr = raw.toString("hex");
    if (raw.length === 1) {
      decodedStr += ` (bool=${KnxDataDecode.decodeThis("1.001", raw)})`;
    }
    console.log(
      `${tag} ${cemi.sourceAddress} -> ${cemi.destinationAddress} | APCI=${cemi.TPDU.apdu.apci.command} | data=${decodedStr}`,
    );
  });

  await service.connect();
  console.log(`Conectado! IA asignada: ${service.individualAddress}`);
  // Asegurar que DataSecure firme con la IA real asignada por la interfaz/túnel
  dataSecure.sourceAddress = service.individualAddress;

  // En KNX IP Secure Routing, enviar TIMER_NOTIFY inmediato y esperar sincronización de mc_timer con el router físico
  if (ipSecureRouting && service instanceof KNXnetIPServer) {
    console.log("Enviando TIMER_NOTIFY inicial y esperando sincronización de mc_timer (1.5 s)...");
    service.sendTimerNotify();
    await new Promise((r) => setTimeout(r, 1500));
    console.log(`mc_timer sincronizado: ${service.secureRoutingTimerValue}`);
  }

  // === 3. Sincronización S-A_Sync y diagnóstico del Security Interface Object (Tipo 17) del MAXinBOX 66 v3 ===
  if (dataSecure.getDeviceToolKey(targetIA)) {
    const mgmt = new KNXManagement(service, { sourceAddress: service.individualAddress, dataSecure });
    console.log(`\n=== 3. Abriendo sesión Management Data Secure (ToolKey + S-A_Sync) con ${targetIA} ===`);
    try {
      await mgmt.withSession(
        targetIA,
        async (session) => {
          const secMode = await session.readSecurityMode();
          const seqSending = await session.readSequenceNumberSending();
          const failures = await session.readSecurityFailuresLog();
          const iaTable = await session.readSecurityIndividualAddressTable();

          console.log(`  Security Mode (PID 51):        ${secMode ? "ENABLED" : "DISABLED"}`);
          console.log(`  SeqNr Sending (PID 59):        ${seqSending}`);
          console.log(
            `  Failures Log (PID 55):         seq=${failures.seqNrErrors}, crypto=${failures.cryptoErrors}, access=${failures.accessRoleErrors}`,
          );
          console.log(`  Security IA Table (PID 54):    ${iaTable.length} entradas`);
          for (const entry of iaTable) {
            console.log(`    - IA ${entry.individualAddress} (LastValidSeqNr=${entry.lastValidSeqNr})`);
          }
          if (!iaTable.some((e) => e.individualAddress === service.individualAddress)) {
            console.warn(
              `\n  [AVISO IMPORTANTE] Tu IA actual (${service.individualAddress}) NO está en la Security Individual Address Table de ${targetIA}.`,
            );
            console.warn("  Para que el MAXinBOX 66 v3 acepte telegramas de grupo Data Secure enviados desde KNX.ts,");
            console.warn(
              "  debes añadir en ETS un dispositivo/túnel con esa IA asociado a los mismos grupos seguros y volver a descargar el MAXinBOX.",
            );
          }
        },
        { secure: true },
      );
    } catch (err: any) {
      console.error(`Error en sesión segura con ${targetIA}: ${err?.message ?? err}`);
    }
  }

  // === 4. Prueba opcional de escritura/lectura segura de grupo ===
  if (testGA) {
    console.log(`\n=== 4. Probando telegramas Data Secure en ${testGA} ===`);
    console.log(`Enviando GroupValue_Write(${testGA}, DPT 1.001, true)...`);
    await service.write(testGA, "1.001", true);
    await new Promise((r) => setTimeout(r, 1500));
    console.log(`Enviando GroupValue_Read(${testGA})...`);
    await service.read(testGA);
    await new Promise((r) => setTimeout(r, 1500));
    console.log(`Enviando GroupValue_Write(${testGA}, DPT 1.001, false)...`);
    await service.write(testGA, "1.001", false);
    console.log(service.individualAddress);
  }

  console.log("\nEscuchando telegramas en el bus (Ctrl+C para salir)...");
  process.on("SIGINT", () => {
    dataSecure.saveState();
    service.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
