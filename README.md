## KNX.ts
KNX.ts is a collection of two communication protocols of the KNX standard: KNXnet/IP and KNX TP.

Both implementations are partial in terms of their full specification.

## What does the KNX IP implementation offer?
The KNXnet/IP Tunneling was implemented by [estbeetoo](https://github.com/estbeetoo) along with its contributors. The repository is [knx.js](https://github.com/estbeetoo/knx.js). All the code from this repository was typed and modified to be more modern. Additionally, the KNXData class used to decode incoming DPTs was extensively extended. The transition of the code to TypeScript is almost 1:1.

That said, this implementation can receive and send KNX telegrams by connecting to a KNX Router or KNX IP Interface. It appears that it can only send GroupValue_Write considering its APCI (Application Layer Control Field).

**Note:** It is unclear how much is missing for it to be more reliable according to its specification.  
**Note 2:** None of the contributors or the creator of this repository were contacted.

## What does the KNX TP implementation offer?
This implementation was designed for serial ports connecting to a TPUART. It was tested on a Raspberry Pi 3 Model B+. To use it on a Raspberry Pi, the serial interface must be freed, and the Bluetooth must be disabled to avoid conflicts, as both interfaces usually use the same port. You can ask an AI for help with the process.

Once the serial port is configured for TPUART, you can connect with the `TPUARTConnection` class, which will receive the port. Once done, you can listen to the `"frame"` event to receive a data buffer, which can be analyzed with the `TelegramParser` class. You can also send telegrams using the `sendTelegram` method of the `TPUARTConnection` instance. This method receives a buffer that you can build with the methods of the `KNXTP1` class. These methods allow you to configure each piece of data in the telegram according to the KNX TP1 specification. If you get confused, you can rely on the JSDoc annotations for each parameter or directly use the `defaultConfig` methods to configure only the necessary parameters. If it is an `L_Data_Standard` or `L_Data_Extended`, one of these parameters will require a data buffer where you will place the desired DPT. You can either construct it yourself or use the `KnxDataEncoder` class, which supports multiple DPTs and can be analyzed by the `TelegramParser`.

The `KnxDataEncoder` (encoding) and `KnxData` (decoding, used in `TelegramParser`) classes have enumerated supported DPTs via the static parameter `dptEnum`. All their methods represent the DPTs they can interpret and intuitively have the prefixes `encodeDptxxx` / `asDptxxx`. Both classes include a simple method for easier handling: `encodeThis` in `KnxDataEncoder` receives the DPT number and an object with values, while `decodeThis` in `KnxData` receives the DPT number.

Once the telegram with the DPT is constructed, it is sent using `sendTelegram`.

**Warning:** The `KNXTP1` and `TelegramParser` classes only faithfully follow the specification of L_Data_Standard Frame and L_Data_Extended Frame. The L_Poll_Data Frame and the Acknowledge Frame have not been tested or implemented.

## KNX TP Example
```typescript
// testTPUART.ts
import { TPUARTConnection } from "../libs/connection/TPUART";
import { KnxDataEncoder } from "../libs/data/KNXDataEncode";
import { KNXTP1 } from "../libs/data/KNXTP1";
import { TelegramParser } from "../libs/data/TelegramParser";

(async () => {
    const tpuart = new TPUARTConnection('/dev/serial0');
    const dpt = 1;
    // Events
    tpuart.on('open', () => {
        console.log('Connection opened');
        Action();
    });
    tpuart.on('error', (err) => console.error('Error:', err));
    tpuart.on('frame', (frame) => {
        try {
            const telegramParsed = TelegramParser.parseTelegram(frame, undefined);
            console.log('Frame received without DPT decoding: ', telegramParsed);
            const telegramParsedWithDecodeValue = TelegramParser.parseTelegram(frame, dpt);
            console.log("Frame received with DPT decoded: ", telegramParsedWithDecodeValue);
        } catch (error) {
            console.error(error);
            console.log("Unprocessed frame", frame);
        }
    });

    function Action() {
        const data = new KnxDataEncoder(); // Value to send
        let value = true;
        const KNXTP = new KNXTP1();
        const lDataExtended = KNXTP.defaultConfigLDataExtended();
        const lDataStandard = KNXTP.defaultConfigLDataStandard();
        lDataStandard.groupAddress = "1/0/0";
        lDataExtended.groupAddress = "0/0/1";
        setInterval(async () => {
            console.log("Sent");
            value = !value;
            lDataStandard.data = data.encodeThis(dpt, {value});
            try {
                await tpuart.sendGroupValueWriteInLDataStandard(lDataStandard);
            } catch (error) {
                console.error(error);
            }
        }, 5000);
        setInterval(async () => {
            console.log("Sent");
            const buff = Buffer.from("Hello world Hello world Hello world", "utf-8");
            lDataExtended.data = buff;
            try {
                await tpuart.sendGroupValueWriteInLDataExtended(lDataExtended);
            } catch (error) {
                console.error(error);
            }
        }, 10000);
    }

    // Open connection
    await tpuart.open();

    process.on("SIGINT", () => {
        console.log("Closing TPUART connection...");
        tpuart.close();
        process.kill(0);
    });
})();
```

## KNX IP Tunneling Example
```typescript
// KNXIP.ts
import { KnxConnectionTunneling } from "../libs/connection/KNXConnectionTunneling";

const connectionKnx = new KnxConnectionTunneling('192.168.0.174', 3671);
connectionKnx.debug = true;

connectionKnx.on('event', (event) => {
  console.log('Event received', event);
  process.send?.({ type: 'event', data: event });
});

connectionKnx.on('status', (status) => {
  console.log('Status received', status);
  process.send?.({ type: 'status', data: status });
});

let value = true;
function toggleValue() {
  value = !value;
  connectionKnx.Action('1/1/1', 1, {value});
}

// Start connection and notify parent
connectionKnx.Connect(() => {
  console.log('Connected to KNX');
  process.send?.({ type: 'info', message: 'KNX connected' });
});

process.on('SIGINT', () => {
  console.log('Process interrupted. Closing KNX connections...');
  connectionKnx.Disconnect(() => {
    console.log('Closing KNX connection');
    process.exit(0);
  });
});
```

