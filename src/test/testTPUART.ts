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
            const telegramParsed = TelegramParser.parseTelegram(frame, undefined)
            console.log('Frame recibido sin decodificar el DPT: ', telegramParsed)
            const telegramParsedWithDecodeValue = TelegramParser.parseTelegram(frame, dpt)
            console.log("Frame recibido con el DPT decodificado: ", telegramParsedWithDecodeValue)
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
        const lDataExtended = KNXTP.defaultConfigLDataExtended()
        const lDataStandard = KNXTP.defaultConfigLDataStandard()
        lDataStandard.groupAddress = "1/0/0"
        lDataExtended.groupAddress = "0/0/1"
        setInterval(async () => {
            console.log("Se envio")
            value = !value
            lDataStandard.data = data.encodeThis(dpt, {value})
        try {
            await tpuart.sendGroupValueWriteInLDataStandard(lDataStandard);
        } catch (error) {
            console.error(error)
        }
        }, 5000);
        setInterval(async () => {
            console.log("Se envio")
            const buff = Buffer.from("Hola mundo Hola mundo hola mundo", "utf-8")
            lDataExtended.data = buff
        try {
            await tpuart.sendGroupValueWriteInLDataExtended(lDataExtended);
        } catch (error) {
            console.error(error)
        }
        }, 10000);
    }

    // Abrir conexión
    await tpuart.open()

    process.on("SIGINT", () => {
        console.log("Cerrando conexión TPUART...")
        tpuart.close()
        process.kill(0)
    })
})();
