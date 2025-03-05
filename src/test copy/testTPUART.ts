// index.ts
import { WriteKNXTp } from "../libs/@types/interfaces/writeTPUARTKNX";
import { TPUARTConnection } from "../libs/connection/TPUART";
import { KnxDataEncoder } from "../libs/data/KNXDataEncode";
import { TelegramParser } from "../libs/data/TelegramParser";
import { KNXHelper } from "../libs/utils/class/KNXHelper";

(async () => {
    const tpuart = new TPUARTConnection('/dev/serial0');
    let dpt = 1
    // Eventos
    tpuart.on('open', () => console.log('Conexión abierta'));
    tpuart.on('error', (err) => console.error('Error:', err));
    tpuart.on('frame', (frame) => {
        const telegramParsed = TelegramParser.parseTelegram(frame, 1)
        console.log('Frame recibido:', frame, telegramParsed)
        if(process.send) process.send(telegramParsed)
    });

    // Abrir conexión
    await tpuart.open();
    const groupAddress = Array.from(KNXHelper.GetAddress_("1/1/1")); // Ejemplo: 1/1/34
    const data = new KnxDataEncoder(); // Valor a enviar
    let value = true
    setInterval(async () => {
        value = !value
    try {
        await tpuart.sendGroupValue(groupAddress, data.encodeThis(1, {value: value}) as Buffer);
    } catch (error) {
        console.error(error)
    }
    }, 3000);
    // process.on("message", async (message: WriteKNXTp) => {
    //     // Enviar valor a una dirección de grupo
    //     const groupAddress = Array.from(KNXHelper.GetAddress_(message.addressGroup)); // Ejemplo: 1/1/34
    //     const data = new KnxDataEncoder(); // Valor a enviar
    //     await tpuart.sendGroupValue(groupAddress, data.encodeThis(message.dpt, message.data as Buffer) as Buffer);
    // })
})();
