import { Router } from "../connection/Router";
import { EventEmitter } from "events";

// Interceptamos el módulo Logger para evitar que Pino levante hilos en segundo plano.
jest.mock("../utils/Logger", () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    // child() suele devolver una nueva instancia del logger, así que devolvemos el mismo mock
    child: jest.fn().mockReturnThis(),
  };
  return {
    knxLogger: mockLogger,
    setupLogger: jest.fn(), // Evitamos que el constructor intente reconfigurar Pino
  };
});

// 1. Mockeamos las dependencias. Sin rodeos, objetos falsos pero funcionales.
class MockKNXService extends EventEmitter {
  options: any = { individualAddress: "1.1.1" };
  sendMock = jest.fn().mockResolvedValue(undefined);

  async connect() {}
  disconnect() {}
  async send(msg: any) {
    return this.sendMock(msg);
  }
}

class MockServiceMessage {
  sourceAddress: string;
  destinationAddress: string;
  controlField2: any;
  private buf: Buffer;

  constructor(src: string, dest: string, hops: number, isRepeated: boolean = false, isGroup: boolean = true) {
    this.sourceAddress = src;
    this.destinationAddress = dest;
    this.controlField2 = { hopCount: hops, addressType: isGroup ? 1 : 0 };

    // Construimos un buffer falso para engañar al método getSignature y loop prevention.
    // CEMI format básico: [0, addIL, ctrl1, ctrl2, ...dst...]
    this.buf = Buffer.alloc(15);
    this.buf[1] = 0; // addIL = 0
    // Bit 5 de ctrl1 (0x20) es Repeat. Activo en BAJO (0 = repetido, 1 = no repetido)
    this.buf[2] = isRepeated ? 0x00 : 0x20;

    // Firma falsa basada en el destino (offset 6 aprox en el buffer real)
    this.buf.write(dest, 6, "utf8");
  }

  toBuffer() {
    return this.buf;
  }
}

describe("Pruebas rigurosas de la clase Router", () => {
  let router: Router;
  let link1: MockKNXService;
  let link2: MockKNXService;

  beforeEach(() => {
    // Instanciamos el router con un pool pequeño para ver cómo fracasa cuando se queda sin direcciones.
    router = new Router({
      clientAddrs: "15.15.10:2", // Solo 2 direcciones disponibles
      logOptions: { level: "silent" }, // Callamos el logger para no ensuciar la consola de tests
    } as any);

    link1 = new MockKNXService();
    link2 = new MockKNXService();

    router.registerLink(link1 as any);
    router.registerLink(link2 as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
    router.disconnect();
  });

  test("Debe fallar al solicitar direcciones cuando el pool se agota", () => {
    // Consumimos las direcciones normales
    const addr1 = router.getClientAddress();
    const addr2 = router.getClientAddress();

    expect(addr1).toBe("15.15.10");
    expect(addr2).toBe("15.15.11");

    // Aquí es donde fracasa (como debe ser) si un tercer cliente se conecta
    const addr3 = router.getClientAddress();
    expect(addr3).toBeNull();

    // Liberamos una y verificamos que el sistema se recupera
    router.releaseClientAddress("15.15.10");
    const addr4 = router.getClientAddress();
    expect(addr4).toBe("15.15.10");
  });

  test("Debe descartar mensajes destructivos (Hop Count = 0)", () => {
    const msg = new MockServiceMessage("1.1.2", "0/1/1", 0); // 0 saltos restantes

    // Emitimos el mensaje desde el link1
    link1.emit("indication", msg);

    // El link2 NO debe recibir nada porque el paquete murió en el router
    expect(link2.sendMock).not.toHaveBeenCalled();
  });

  test("Prevención de bucles: Debe descartar tramas repetidas idénticas", () => {
    // Mensaje repetido (isRepeated = true)
    const msg = new MockServiceMessage("1.1.2", "0/1/2", 6, true);

    // Primer intento: el router lo deja pasar y registra la firma
    link1.emit("indication", msg);
    expect(link2.sendMock).toHaveBeenCalledTimes(1);

    // Segundo intento (eco/bucle físico): el router debe detectar la firma y bloquearlo
    link1.emit("indication", msg);

    // Verificamos que fracasa en su intento de inundar la red (se mantiene en 1 llamada)
    expect(link2.sendMock).toHaveBeenCalledTimes(1);
  });

  test("Validación de origen: Previene el spoofing desde enlaces incorrectos", () => {
    // Paso 1: El router aprende que '2.2.2' vive en el link1
    const msgLearn = new MockServiceMessage("2.2.2", "0/1/3", 6);
    link1.emit("indication", msgLearn);

    // Paso 2: Un atacante o configuración errónea envía un paquete diciendo ser '2.2.2' pero desde el link2
    const msgSpoof = new MockServiceMessage("2.2.2", "0/1/4", 6);
    link2.emit("indication", msgSpoof);

    // El router debe ignorar esto y proteger la topología
    expect(link1.sendMock).not.toHaveBeenCalled();
  });

  test("Parcheo de origen (Source Patching): Reemplaza la IA 0.0.0", () => {
    // Mensaje con origen vacío
    const msg = new MockServiceMessage("0.0.0", "0/1/5", 6);
    link1.emit("indication", msg);

    // El mensaje enrutado debe tener la IA modificada.
    // Según tu lógica en Router.ts, toma el individualAddress de las opciones de la interfaz de origen ('1.1.1').
    expect(msg.sourceAddress).toBe("1.1.1");
    expect(link2.sendMock).toHaveBeenCalled();
  });
});

describe("Pruebas de Enrutamiento Central (Routing Logic)", () => {
  let router: Router;
  let link1: MockKNXService;
  let link2: MockKNXService;
  let link3: MockKNXService;

  beforeEach(() => {
    router = new Router({ logOptions: { level: "silent" }, routerAddress: "15.15.0" } as any);
    link1 = new MockKNXService();
    link2 = new MockKNXService();
    link3 = new MockKNXService();

    router.registerLink(link1 as any);
    router.registerLink(link2 as any);
    router.registerLink(link3 as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
    router.disconnect();
  });

  test("Enrutamiento de Grupo: Debe inundar (flood) a todos los enlaces excepto al origen", () => {
    // isGroup = true (dirección de grupo como 1/1/1)
    const msgGroup = new MockServiceMessage("1.1.2", "1/1/1", 6, false, true);

    link1.emit("indication", msgGroup);

    // Siendo un mensaje de grupo, el router debe enviarlo a link2 y link3, pero NO devolverlo a link1
    expect(link2.sendMock).toHaveBeenCalledTimes(1);
    expect(link3.sendMock).toHaveBeenCalledTimes(1);
    expect(link1.sendMock).not.toHaveBeenCalled();
  });

  test("Enrutamiento Selectivo (IA): Debe enviar SOLO al enlace destino si lo conoce", () => {
    // Paso 1: El router aprende pasivamente dónde está '2.2.2' (en link3)
    const msgLearn = new MockServiceMessage("2.2.2", "0/1/1", 6, false, true);
    link3.emit("indication", msgLearn);

    // Limpiamos los mocks después de la fase de aprendizaje
    jest.clearAllMocks();

    // Paso 2: Un mensaje individual (isGroup = false) destinado específicamente a '2.2.2' entra por link1
    const msgIA = new MockServiceMessage("1.1.2", "2.2.2", 6, false, false);
    link1.emit("indication", msgIA);

    // El router debe ser inteligente y rutearlo SOLO al link3. El link2 no debe enterarse.
    expect(link3.sendMock).toHaveBeenCalledTimes(1);
    expect(link2.sendMock).not.toHaveBeenCalled(); // Cero inundación
  });

  test("Consumo Local: No debe rutear mensajes dirigidos a la dirección propia del Router", () => {
    // Mensaje individual dirigido a la dirección física del router (15.15.0)
    const msgLocal = new MockServiceMessage("1.1.2", "15.15.0", 6, false, false);

    // Espiamos el emisor de eventos del propio router
    const indicationLinkSpy = jest.fn();
    router.on("indication_link", indicationLinkSpy);

    link1.emit("indication", msgLocal);

    // Los otros enlaces no deben recibir el mensaje
    expect(link2.sendMock).not.toHaveBeenCalled();
    expect(link3.sendMock).not.toHaveBeenCalled();

    // Pero el router debe haber emitido el evento hacia las capas superiores
    expect(indicationLinkSpy).toHaveBeenCalled();
  });
});
