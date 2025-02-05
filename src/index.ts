import { KnxConnectionTunneling } from './libs/KNXConnectionTunneling';

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

// let number = 1;
// function toggleValue() {
//   number++;
//   connectionKnx.Action('1/1/7', { valueDpt5: number }, 5);
// }

// Iniciar la conexión y notificar al padre
connectionKnx.Connect(() => {
  console.log('Conexión establecida con KNX');
  process.send?.({ type: 'info', message: 'KNX conectado' });
  // Manejar mensajes del proceso padre
  process.on('message', (msg: any) => {
    console.log('Mensaje del proceso padre:', msg);
    connectionKnx.Action(msg.address, msg.data, msg.dpt);
  });
  // setTimeout(toggleValue, 3000);
});

// Manejo de cierre del proceso
process.on('disconnect', () => {
  console.log('Proceso hijo desconectado, cerrando conexión...');
  connectionKnx.Disconnect(() => void 0);
});
