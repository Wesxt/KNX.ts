import { KnxConnectionTunneling } from './libs/KNXConnectionTunneling';
// import { AllDpts, KnxDataEncoder } from './libs/KNXDataEncode';

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

let value = 1;
function toggleValue() {
  value += 0.1;
  connectionKnx.Action('1/1/7', { valueDpt14: value }, 14);
}

// Iniciar la conexión y notificar al padre
connectionKnx.Connect(() => {
  console.log('Conexión establecida con KNX');
  process.send?.({ type: 'info', message: 'KNX conectado' });
  // toggleValue();
  setInterval(toggleValue, 1500);
  // Manejar mensajes del proceso padre
  // process.on(
  //   'message',
  //   (msg: { address: string; data: AllDpts<(typeof KnxDataEncoder.dptEnum)[number]>; dpt: (typeof KnxDataEncoder.dptEnum)[number] }) => {
  //     console.log('Mensaje del proceso padre:', msg);
  //     connectionKnx.Action(msg.address, msg.data, msg.dpt);
  //   },
  // );
  // setTimeout(toggleValue, 3000);
});

process.on('SIGINT', () => {
  console.log('Proceso interrumpido. Cerrando conexiones KNX...');
  connectionKnx.Disconnect(() => {
    console.log('Closing KNX connection');
    process.exit(0);
  });
});

// Manejo de cierre del proceso
// process.on('disconnect', () => {
//   console.log('Proceso hijo desconectado, cerrando conexión...');
//   connectionKnx.Disconnect(() => void 0);
// });
