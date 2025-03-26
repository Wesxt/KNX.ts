// index.ts
import { WriteKNXTp } from "../libs/@types/interfaces/KNXTP1";
import { TPUARTConnection } from "../libs/connection/TPUART";
import { KnxDataEncoder } from "../libs/data/KNXDataEncode";

(async () => {
    const tpuart = new TPUARTConnection('/dev/serial0');
    // Eventos
    tpuart.on('open', () => {
        if(process.send) process.send({msgType: "info", data: "Conexión abierta"})
    });
    tpuart.on('error', (err) => {
        if(process.send) process.send({msgType: "error", data: err})
    });
    tpuart.on('frame', (frame) => {
        if(process.send) process.send({msgType: "frame", data: frame})
    });

    // Abrir conexión
    await tpuart.open()

    process.on("SIGINT", () => {
        console.log("Cerrando conexión TPUART...")
        tpuart.close()
        process.kill(0)
    })

    process.on("message", async (message: WriteKNXTp) => {
        // Enviar valor a una dirección de grupo
        const groupAddress = message.addressGroup; // Ejemplo: 1/1/34
        const data = new KnxDataEncoder(); // Valor a enviar
        await tpuart.sendGroupValue(groupAddress, data.encodeThis(message.dpt, message.data as Buffer) as Buffer);
    })
})();
