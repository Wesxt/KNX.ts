// index.ts
import { TPUARTConnection } from "../libs/connection/TPUART";
import { KnxDataEncoder } from "../libs/data/KNXDataEncode";
import { TelegramParser } from "../libs/data/TelegramParser";

(async () => {
    const tpuart = new TPUARTConnection('/dev/serial0');
    let dpt = 1
    // Eventos
    tpuart.on('open', () => {
        console.log('Conexión abierta')
        Action()
    });
    tpuart.on('error', (err) => console.error('Error:', err));
    tpuart.on('frame', (frame) => {
        try {
            const telegramParsed = TelegramParser.parseTelegram(frame, 1)
            console.log('Frame recibido:', telegramParsed)
        } catch (error) {
            console.error(error)
            console.log("Frame sin procesar", frame)
        }
    });

    function Action() {
        const data = new KnxDataEncoder(); // Valor a enviar
        // let number = "1"
        let value = true
        setInterval(async () => {
            // number = number.concat(number, "1")
            // value = BigInt(number)
            value = !value
        try {
            await tpuart.sendGroupValue("1/1/1", Buffer.from([0]));
        } catch (error) {
            console.error(error)
        }
        }, 5000);
    }

    // Abrir conexión
    await tpuart.open()

    process.on("SIGINT", () => {
        console.log("Cerrando conexión TPUART...")
        tpuart.close()
        process.kill(0)
    })
})();
