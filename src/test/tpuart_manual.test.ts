import { TPUARTConnection } from "../connection/TPUART";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";

async function testTPUART() {
  console.log("--- Testing TPUART ---");

  // Reemplaza con la ruta de tu puerto serial si es necesario (ej: COM3 en Windows o /dev/ttyUSB0)
  const serialPath = "/dev/ttyS0"; 

  const tpuart = new TPUARTConnection({
    path: serialPath,
    individualAddress: "1.1.250", // Dirección física para el TPUART
  });

  tpuart.on("connected", () => {
    console.log(`[TPUART] Connected to ${serialPath}!`);
    console.log("[TPUART] Waiting for indications on the bus...");
  });

  tpuart.on("error", (err: any) => {
    console.error("[TPUART] Error:", err.message || err);
  });

  tpuart.on("disconnected", () => {
    console.log("[TPUART] Disconnected");
  });

  tpuart.on("indication", (cemi: ServiceMessage) => {
    console.log(`[TPUART] CEMI Indication received:`, cemi.toBuffer().toString("hex").match(/../g)?.join(" "));
  });

  tpuart.on("busmonitor", (cemi: ServiceMessage) => {
    console.log(`[TPUART] Busmonitor received:`, cemi.toBuffer().toString("hex").match(/../g)?.join(" "));
  });

  tpuart.on("warning", (warn: string) => {
      console.warn(`[TPUART] Warning:`, warn);
  })

  try {
    console.log(`[TPUART] Connecting to ${serialPath}...`);
    await tpuart.connect();

    // Mantener la conexión abierta por 30 segundos para escuchar eventos
    await new Promise((resolve) => setTimeout(resolve, 30000));

    console.log("[TPUART] Closing connection...");
    await tpuart.disconnect();
  } catch (e: any) {
    console.error("[TPUART] Connection Failed:", e.message || e);
  }
}

testTPUART().catch((err) => {
    console.error("[TPUART] Unhandled test error:", err);
});
