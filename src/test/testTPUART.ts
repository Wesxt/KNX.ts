// index.ts
import { TPUARTConnection } from "../libs/connection/TPUART";
import { KnxDataEncoder } from "../libs/data/KNXDataEncode";
import { KNXTP1 } from "../libs/data/KNXTP1";
import { TelegramParser } from "../libs/data/TelegramParser";

(async () => {
    const tpuart = new TPUARTConnection('/dev/serial0');
    const dpt = 1
    // Eventos
    tpuart.on('open', () => {
        console.log('Conexión abierta')
        Action()
    });
    tpuart.on('error', (err) => console.error('Error:', err));
    tpuart.on('frame', (frame) => {
        try {
            const telegramParsed = TelegramParser.parseTelegram(frame, dpt)
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
        const KNXTP = new KNXTP1()
        const lDataStandard = KNXTP.defaultConfigLDataStandard()
        // lDataStandard.groupAddress = "1/3/0"
        lDataStandard.groupAddress = "1/0/0"
        setInterval(async () => {
            // number = number.concat(number, "1")
            // value = BigInt(number)
            value = !value;
            // if (value >= 255) {
            //     value = 240
            // }
            lDataStandard.data = data.encodeThis(dpt, {value})
        try {
            await tpuart.sendGroupValueWriteInLDataStandard(lDataStandard);
        } catch (error) {
            console.error(error)
        }
        }, 3000);
    }

    // Abrir conexión
    await tpuart.open()

    process.on("SIGINT", () => {
        console.log("Cerrando conexión TPUART...")
        tpuart.close()
        process.kill(0)
    })
})();
