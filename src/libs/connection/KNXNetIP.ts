// src/knxnetip.ts
import dgram from 'dgram';

class KNXNetIPRouting {
  constructor(ipMulticast: string = '224.0.23.12', port: number = 3671) {
    this.MULTICAST_IP = ipMulticast;
    this.PORT = port;
  }
  MULTICAST_IP;
  PORT;

  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  initialize() {
    this.socket.on('listening', () => {
      const address = this.socket.address();
      console.log(`Listening on ${address.address}:${address.port}`);
      this.socket.addMembership(this.MULTICAST_IP);
    });

    this.socket.on('message', (msg, rinfo) => {
      console.log(`KNXnet/IP message from ${rinfo.address}:${rinfo.port}`);
      // Decodifica el paquete KNX aquí
    });

    this.socket.bind(this.PORT);
  }

}

