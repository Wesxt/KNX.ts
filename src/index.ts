import dgram from 'dgram';

// Función para convertir una dirección de grupo (x/y/z) en bytes
function convertGroupAddressToBuffer(groupAddress: string): Buffer {
  const parts = groupAddress.split('/');
  if (parts.length !== 3) {
    throw new Error('La dirección de grupo debe estar en formato x/y/z');
  }

  const x = parseInt(parts[0], 10);
  const y = parseInt(parts[1], 10);
  const z = parseInt(parts[2], 10);

  const highByte = (x * 2048 + y * 32 + z) >> 8; // Primer byte
  const lowByte = (x * 2048 + y * 32 + z) & 0xFF; // Segundo byte

  return Buffer.from([highByte, lowByte]);
}

// Función para crear un telegrama personalizable
function createCustomKNXTelegram({
  sourceAddress,   // Dirección de origen, ejemplo: '0/0/1'
  destinationGroup, // Dirección de grupo, ejemplo: '1/1/2'
  messageType,     // Tipo de mensaje, ejemplo: 'GroupValue_Write'
  payload,         // Payload, ejemplo: true (0x01) o false (0x00)
  controlField = 0xbc, // Control field por defecto
}: {
  sourceAddress: string;
  destinationGroup: string;
  messageType: string;
  payload: Buffer;
  controlField?: number;
}): Buffer {
  // Convertir direcciones en sus buffers
  const srcBuffer = convertGroupAddressToBuffer(sourceAddress);
  const dstBuffer = convertGroupAddressToBuffer(destinationGroup);

  // Crear el telegrama
  const header = Buffer.from([
    0x06, 0x10, 0x04, 0x20,  // Header (KNXnet/IP Protocol, Service type: Tunneling)
    0x00, 0x1a,              // Total length (esto es solo un ejemplo, cambiar según la longitud real)
    0x04, 0x00,              // Connection header
    0x29,                    // Communication Channel ID
    0x00,                    // Sequence counter
    0x11,                    // CEMI: Message code (L_Data.req)
    0x00,                    // Additional info length
    controlField,            // Control field (por ejemplo, 0xbc)
  ]);

  const messageBody = Buffer.concat([
    srcBuffer,               // Dirección de origen
    dstBuffer,               // Dirección de grupo
    Buffer.from([payload.length]), // Longitud de datos
    payload,                 // Datos (payload)
  ]);

  // Concatenar todo para formar el telegrama final
  return Buffer.concat([header, messageBody]);
}

// Cliente KNX básico para enviar el telegrama
class KNXClient {
  private socket: dgram.Socket;
  private host: string;
  private port: number;
  private connected: boolean;

  constructor(host: string, port: number = 3671) {
    this.host = host;
    this.port = port;
    this.connected = false;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', this.handleMessage.bind(this));
    this.socket.on('error', this.handleError.bind(this));
  }

  connect() {
    console.log(`Connecting to KNX/IP Interface at ${this.host}:${this.port}`);
    this.connected = true; // Suponemos que se conecta correctamente
  }

  sendKNXTelegram(buffer: Buffer) {
    if (!this.connected) {
      console.error('Not connected to KNX/IP Interface');
      return;
    }
    this.socket.send(buffer, 0, buffer.length, this.port, this.host, (err) => {
      if (err) console.error('Error sending telegram:', err);
      else console.log('Telegram sent!');
    });
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
    console.log(`Received message from ${rinfo.address}:${rinfo.port}`);
    console.log(msg.toString('hex'));
  }

  private handleError(err: Error) {
    console.error('Socket error:', err);
  }

  disconnect() {
    this.connected = false;
    this.socket.close();
    console.log('Disconnected from KNX/IP Interface');
  }
}

// Ejemplo de uso: Enviar un telegrama a la dirección 1/1/2 con un payload de 0x01 (true)
const knxClient = new KNXClient('192.168.0.174', 3671);
knxClient.connect();

// Crear un telegrama personalizado con la dirección de grupo y payload
const knxTelegram = createCustomKNXTelegram({
  sourceAddress: '1/0/1',           // Dirección de origen
  destinationGroup: '0/0/1',        // Dirección de grupo
  messageType: 'GroupValue_Write',  // Tipo de mensaje
  payload: Buffer.from([0x01]),     // Payload (true = 0x01)
});

// Enviar el telegrama
knxClient.sendKNXTelegram(knxTelegram);
