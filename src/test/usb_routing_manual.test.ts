import { KNXnetIPServer } from "../connection/KNXnetIPServer";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { getLocalIP } from "../utils/localIp";
import { CEMI } from "../core/CEMI";

// Configuración estándar para KNXnet/IP Routing
const MULTICAST_IP = "224.0.23.12";
const PORT = 3671;

let routing: KNXnetIPServer;

async function testUSBRouting() {
  console.log(`
---------------------------------------------------------
--- Prueba Manual: Enrutador KNXnet/IP <-> KNX USB    ---
---------------------------------------------------------`);

  // Intenta obtener la IP local dinámicamente, o cámbiala por la tuya (ej. 192.168.0.x)
  const localIp = getLocalIP();
  console.log(`[Red] Vinculando a la IP Local: ${localIp}`);

  const client = new KNXnetIPServer({
    ip: MULTICAST_IP,
    port: PORT,
    localIp: localIp,
    friendlyName: "KNX-USB-Bridge",
    // Asignamos un pool para los clientes IP que hagan tunneling hacia el USB
    clientAddrs: "15.15.100:5",
    // La dirección física de este enrutador en la topología KNX
    individualAddress: "15.15.0",
    externals: {
      usb: {
        // En la mayoría de implementaciones, dejar esto vacío fuerza a la librería
        // a auto-detectar el primer dispositivo KNX USB conectado.
        // Si tienes múltiples dispositivos USB, aquí deberías pasar el vendorId/productId.
      },
    },
    useAllInterfaces: false,
    logOptions: { level: "debug" }, // Crucial: Queremos ver el ruido interno del Router
  });

  routing = client;

  client.externalManager?.on("indication_link", (data: { src: string; msg: ServiceMessage }) => {
    console.log("Router", data.src);
  });
  client.on("connected", () => {
    console.log("\n[Estado] ¡Servidor IP levantado y en el grupo Multicast!");
    console.log("[Acción Requerida] Genera tráfico desde un sensor físico en el bus KNX.");
    console.log("[Acción Requerida] O envía un telegrama Multicast IP para ver si sale por el USB.\n");
  });

  client.on("error", (err: any) => {
    console.error("[Fallo Fatal] Error en el servidor o interfaz USB:", err.message);
  });

  // Escuchamos CUALQUIER indicación que pase por el servidor
  client.on("indication", (msg: ServiceMessage) => {
    const msgAny = msg as any;
    const src = msgAny.sourceAddress || "Desconocido";
    const dst = msgAny.destinationAddress || "Desconocido";

    console.log(`[Telegrama Enrutado] Origen: ${src} -> Destino: ${dst}`);
    console.log(`[CEMI Hex]`, (msg as InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.req"]>).TPDU.apdu.data);
  });

  // Listener específico para monitorear una dirección de grupo de prueba (ej. una luz)
  client.on("1/0/1", (cemi: ServiceMessage) => {
    console.log("\n>>> [Match 1/1/1] Telegrama detectado en el grupo de prueba <<<", cemi.toBuffer());
  });

  try {
    console.log("[Sistema] Iniciando conexiones y montando enlaces en el Router...");
    await client.connect();
  } catch (e: any) {
    console.error("[Falla de Arranque]:", e.message);
    console.error("¿Estás seguro de que tienes permisos (sudo/udev) para leer el puerto USB en Linux?");
  }
}

testUSBRouting().catch(console.error);

async function gracefulShutdown(reason: string) {
  console.log(`\n[Apagado] Motivo: ${reason}`);
  try {
    if (routing) {
      console.log("[Sistema] Desconectando enlaces físicos y sockets...");
      routing.disconnect();
    }
    // Damos un margen para que los puertos USB y sockets se liberen correctamente
    await new Promise((res) => setTimeout(res, 500));
  } catch (err) {
    console.error("[Fallo Crítico] Error durante la desconexión:", err);
  } finally {
    process.exit(0);
  }
}

// Interceptamos señales para no dejar el puerto USB "tomado" (zombie) en el SO
process.once("SIGINT", () => gracefulShutdown("SIGINT recibido (Ctrl+C)"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM recibido"));
process.once("uncaughtException", (err) => {
  console.error("Excepción no controlada:", err);
  void gracefulShutdown("uncaughtException");
});
