import { ModbusGateway } from "../server/ModbusGateway";
import { Router } from "../connection/Router";
import { setupLogger, knxLogger } from "../utils/Logger";

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
    modbusId: 1,
    serialPort: {
      baudRate: 9600,
      parity: "even",
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
          publishTemplate: '{"state": {{value}}}',
        },
        type: "holding",
        address: 0x061,
        dataType: "int16",
        interval: 2000,
        scale: 0.1,
      },
    ],
    logOptions: {
      level: "debug",
    },
  });

  masterRTU.start();
}

runTest().catch((err) => {
  knxLogger.error(err, "Test failed");
});
