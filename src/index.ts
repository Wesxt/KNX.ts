import dgram from 'dgram';

class KNXClient {
  private socket: dgram.Socket;
  private host: string;
  private port: number;
  private connected: boolean;

  constructor(host: string, port: number = 3671) {
    this.host = host;
    this.port = port;
    this.connected = false;

    // Crear el socket UDP
    this.socket = dgram.createSocket('udp4');

    // Manejar eventos del socket
    this.socket.on('message', this.handleMessage.bind(this));
    this.socket.on('error', this.handleError.bind(this));
  }

  // Conectar al KNX Interface
  connect() {
    console.log(`Connecting to KNX/IP Interface at ${this.host}:${this.port}`);
    this.connected = true; // Aquí implementarás el handshake
  }

  // Enviar un telegrama KNX
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

  // Manejar mensajes recibidos
  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
    console.log(`Received message from ${rinfo.address}:${rinfo.port}`);
    console.log(msg.toString('hex'));
  }

  // Manejar errores
  private handleError(err: Error) {
    console.error('Socket error:', err);
  }

  // Desconectar
  disconnect() {
    this.connected = false;
    this.socket.close();
    console.log('Disconnected from KNX/IP Interface');
  }
}

export default KNXClient;


const knxClient = new KNXClient('192.168.0.174', 3671);
knxClient.connect();

// Crear un telegrama básico
const knxTelegram = Buffer.from([
  0x06, 0x10, 0x04, 0x20, // Header (KNXnet/IP Protocol, Service type: Tunneling)
  0x00, 0x1a,             // Total length
  0x04, 0x00,             // Connection header
  0x29,                   // Communication Channel ID
  0x00,                   // Sequence counter
  0x11,                   // CEMI: Message code (L_Data.req)
  0x00,                   // Additional info length
  0xbc,                   // Control field
  0xe0,                   // Source Address (part 1)
  0x11,                   // Source Address (part 2)
  0x00, 0x01,             // Group Address (1/1/0)
  0x01,                   // Data length
  0x00,                   // Data payload (e.g., false)
]);


// Enviar el telegrama
knxClient.sendKNXTelegram(knxTelegram);
