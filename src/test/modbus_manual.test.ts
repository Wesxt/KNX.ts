import { ModbusGateway } from "../server/ModbusGateway";
import { Router } from "../connection/Router";
import { setupLogger, knxLogger } from "../utils/Logger";
import * as mqtt from "mqtt";
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

  // 2. Gateway Esclavo (Simulando un PLC externo vía TCP)
  // Este PLC tiene un holding register en la direccion 10 que el Maestro buscará leer
  const slavePLC = new ModbusGateway({
    mode: "slave",
    protocol: "tcp",
    host: "127.0.0.1",
    port: 8502,
    modbusId: 1,
  });

  await slavePLC.start();
  knxLogger.info("✅ PLC Esclavo (Simulado) corriendo en TCP 8502.");

  // 3. Gateway Maestro (Integrando el PLC hacia KNX y un Broker MQTT embebido)
  const gatewayMaster = new ModbusGateway({
    mode: "master",
    protocol: "tcp",
    host: "127.0.0.1",
    port: 8502,
    modbusId: 1,
    knxContext: router,
    defaultPollingInterval: 2000,
    mqtt: {
      embeddedBroker: { port: 1883 },
    },
    mappings: [
      {
        type: "holding",
        address: 10,
        scale: 0.1, // Escala de ejemplo: Si el PLC tiene 255, KNX/MQTT verán 25.5
        knx: {
          groupAddress: "1/1/1",
          dpt: "9.001", // Temperatura
        },
        mqtt: {
          topic: "test/temperatura",
          publishTemplate: '{"temperatura": {{value}}}',
        },
      },
      {
        type: "coil",
        address: 5,
        interval: 1000,
        knx: {
          groupAddress: "1/1/2",
          dpt: "1.001", // Switch
        },
        mqtt: {
          topic: "test/switch",
          publishTemplate: '{"estado": {{value}}}',
        },
      },
      {
        type: "holding",
        address: 20,
        dataType: "float32",
        interval: 1000,
        mqtt: {
          topic: "test/potencia",
        },
      },
    ],
  });

  await gatewayMaster.start();
  knxLogger.info("✅ Gateway Maestro corriendo. Mapeando TCP 8502 hacia KNX y MQTT embebido (1883).");

  // --- ESPERAMOS PARA QUE CONECTEN LOS CLIENTES INTERNOS ---
  await new Promise((r) => setTimeout(r, 1000));

  // --- SIMULACIÓN DE TRÁFICO ---

  // A. El PLC cambia internamente el Holding Register 10 (Temperatura a "28.5")
  knxLogger.info(">> EVENTO: El PLC cambia su temperatura a 285 en raw (28.5 escalado).");
  // Usaremos un cliente puro para escribirle al esclavo y ver cómo nuestro Maestro reacciona
  const rawClient = new ModbusRTU();
  await new Promise((resolve) => rawClient.connectTCP("127.0.0.1", { port: 8502 }, resolve));
  rawClient.setID(1);
  await rawClient.writeRegister(10, 285);
  rawClient.close();

  // El Maestro leerá esto en unos ~2 segundos, lo cual debería verse en los logs enviando DPT9 a 1/1/1 y publicando a test/temperatura.

  await new Promise((r) => setTimeout(r, 1000));

  // D. Simular que el esclavo PLC recibe un registro compuesto (32 bit Float)
  knxLogger.info(">> EVENTO: El PLC cambia su potencia a 3450.75W (Float32).");
  const floatBuf = Buffer.alloc(4);
  floatBuf.writeFloatBE(3450.75, 0);
  const rawClient2 = new ModbusRTU();
  await new Promise((resolve) => rawClient2.connectTCP("127.0.0.1", { port: 8502 }, resolve));
  rawClient2.setID(1);
  await rawClient2.writeRegisters(20, [floatBuf.readUInt16BE(0), floatBuf.readUInt16BE(2)]);
  rawClient2.close();

  await new Promise((r) => setTimeout(r, 3000));

  // B. Alguien escribe a la dirección KNX "1/1/2"
  knxLogger.info(">> EVENTO: Se recibe un telegrama KNX Write a 1/1/2 encendiendo la luz (true).");
  // Como router está enlazado como contexto, enviarle un write hará que el Gateway Modbus lo intercepte.
  await router.write("1/1/2", "1.001", { value: true } as any);

  await new Promise((r) => setTimeout(r, 1000));

  // C. Alguien envía un comando MQTT a test/switch/set
  knxLogger.info(">> EVENTO: App móvil publica a MQTT 'test/switch/set' con false.");
  const mqttClient = mqtt.connect("mqtt://127.0.0.1:1883");
  mqttClient.on("connect", () => {
    mqttClient.publish("test/switch/set", JSON.stringify({ value: false }));
  });

  await new Promise((r) => setTimeout(r, 2000));

  // ===================================
  // CÓDIGO PARA PRUEBAS RTU MANUALES
  // ===================================
  /*
  knxLogger.info("--- PRUEBA RTU (Comentada por defecto) ---");
  // Para probar RTU necesitas dos adaptadores USB RS485 o un emulador de pares tipo com0com.
  // Esclavo en COM1:
  const slaveRTU = new ModbusGateway({ mode: "slave", protocol: "rtu", path: "COM1", baudRate: 9600, modbusId: 2 });
  // Maestro en COM2:
  const masterRTU = new ModbusGateway({ mode: "master", protocol: "rtu", path: "COM2", baudRate: 9600, modbusId: 2, ... });
  */

  knxLogger.info("--- TEST FINALIZADO ---");
  process.exit(0); // Forzar salir debido a los eventos de los puertos y servidores
}

runTest().catch((err) => {
  knxLogger.error(err, "Test failed");
  process.exit(1);
});
