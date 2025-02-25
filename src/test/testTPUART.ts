// index.ts
import { TPUARTConnection } from "../libs/connection/TPUART";
import { KnxDataEncoder } from "../libs/data/KNXDataEncode";
import { TelegramParser } from "../libs/data/TelegramParser";
import { KNXHelper } from "../libs/utils/class/KNXHelper";

(async () => {
    const tpuart = new TPUARTConnection('/dev/serial0');

    // Eventos
    tpuart.on('open', () => console.log('Conexión abierta'));
    tpuart.on('error', (err) => console.error('Error:', err));
    tpuart.on('frame', (frame) => console.log('Frame recibido:', frame, TelegramParser.parseTelegram(frame)));
    
    // Abrir conexión
    await tpuart.open();
    // Enviar valor a una dirección de grupo
    const groupAddress = Array.from(KNXHelper.GetAddress_("1/1/1")); // Ejemplo: 1/1/34
    const data = new KnxDataEncoder(); // Valor a enviar
    let value = true
    setInterval(async () => {
        value = !value
        await tpuart.sendGroupValue(groupAddress, data.encodeDpt1({value: value}));
    }, 2000)
})();
