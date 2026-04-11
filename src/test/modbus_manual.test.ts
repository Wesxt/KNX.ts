import { ModbusGateway } from "../server/ModbusGateway";
import { Router } from "../connection/Router";
import { setupLogger, knxLogger } from "../utils/Logger";
import ModbusRTU from "modbus-serial";

setupLogger({ level: "debug" });

async function runTest() {
  knxLogger.info("--- INICIANDO TEST MANUAL DE MODBUS GATEWAY ---");

  // 1. Contexto KNX
  // Usamos el Router como un bus simulado interno. En la vida real, tendrías un KNXTunneling o KNXUSBConnection enrutado aquí.
  const router = new Router({
    routerAddress: "1.1.0",
    knxNetIpServer: {
      useAllInterfaces: false,
    },
  });

  // ===================================
  // CÓDIGO PARA PRUEBAS RTU MANUALES
  // ===================================

  // Para probar RTU necesitas dos adaptadores USB RS485 o un emulador de pares tipo com0com.
  // Esclavo en COM1:
  // const slaveRTU = new ModbusGateway({ mode: "slave", protocol: "rtu", path: "COM1", baudRate: 9600, modbusId: 2 });
  // Maestro en COM2:
  const masterRTU = new ModbusGateway({
    mode: "master",
    protocol: "rtu",
    path: "/dev/ttyUSB0",
    modbusId: 4,
    serialPort: {
      baudRate: 9600,
      parity: "none",
    },
    knxContext: router,
    mqtt: {
      embeddedBroker: {
        host: "192.168.0.169",
        port: 1884,
      },
    },
    mappings: [
      {
        mqtt: {
          topic: "test/1",
          publishTemplate: JSON.stringify({
            state: "{{value}}",
          }),
        },
        type: "holding",
        address: 0x064,
        dataType: "uint16",
        interval: 1000,
        scale: 0.1,
      },
      {
        mqtt: {
          topic: "test/2",
          publishTemplate: JSON.stringify({
            state: "{{value}}",
          }),
        },
        type: "holding",
        address: 0x061,
        dataType: "uint16",
        interval: 1000,
        scale: 0.1,
      },
    ],
    logOptions: {
      level: "debug",
    },
  });

  masterRTU.start();
}

/**
 * Función tradicional para probar la lectura de Voltaje A y Corriente A
 * en un medidor Acrel ADL400 vía RS485.
 * * @param serialPath La ruta del puerto serie (ej. "/dev/ttyUSB0" o "COM3")
 * @param modbusId El ID del esclavo (por defecto suele ser 1)
 */
export async function testAdl400Modbus(serialPath: string = "/dev/ttyUSB0", modbusId: number = 4): Promise<void> {
  const client = new ModbusRTU();

  try {
    console.log(`Intentando abrir el puerto serie: ${serialPath}...`);

    // Configuramos la conexión física. El manual indica que la paridad por defecto es "None" (Ninguna).
    await new Promise<void>((resolve, reject) => {
      client.connectRTUBuffered(serialPath, { baudRate: 9600, parity: "none" }, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log("Puerto abierto con éxito. Configurando parámetros de red...");
    client.setID(modbusId);
    client.setTimeout(2000); // 2 segundos de timeout es una norma prudente

    // --- LECTURA DE VOLTAJE FASE A ---
    // Dirección: 0061H (97 Decimal) | Longitud: 1 registro (2 bytes) | Escala: x0.1
    const voltageAddress = 97;
    const voltageData = await client.readHoldingRegisters(voltageAddress, 1);
    const rawVoltage = voltageData.data[0];
    const realVoltage = rawVoltage * 0.1;

    console.log(`Voltaje Fase A (Registro 0x0061): ${rawVoltage} crudo -> ${realVoltage.toFixed(1)} V`);

    // Respiro obligatorio para el bus RS485 entre peticiones (50ms)
    await new Promise((r) => setTimeout(r, 1000));

    // --- LECTURA DE CORRIENTE FASE A ---
    // Dirección: 0064H (100 Decimal) | Longitud: 1 registro (2 bytes) | Escala: x0.01
    const currentAddress = 100;
    const currentData = await client.readHoldingRegisters(currentAddress, 1);
    const rawCurrent = currentData.data[0];
    const realCurrent = rawCurrent * 0.01;

    console.log(`Corriente Fase A (Registro 0x0064): ${rawCurrent} crudo -> ${realCurrent.toFixed(2)} A`);
  } catch (error: any) {
    console.error("Fallo durante la transacción Modbus. Detalles del error:");
    console.error(error);
  } finally {
    // Siempre cerrar el puerto al terminar para liberar el recurso de hardware
    if (client.isOpen) {
      console.log("Cerrando el puerto serie...");
      client.close(() => {
        console.log("Puerto cerrado.");
      });
    }
  }
}

// testAdl400Modbus();

runTest().catch((err) => {
  knxLogger.error(err, "Test failed");
});
