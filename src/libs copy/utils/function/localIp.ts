import os from 'os';

export function getLocalIP() {
  const networkInterfaces = os.networkInterfaces();

  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName] as os.NetworkInterfaceInfo[];
    for (const net of interfaces) {
      // Verifica que la dirección sea IPv4 y no interna (no sea localhost)
      if (net.family === 'IPv4' && !net.internal) {
        return net.address; // Devuelve la IP local
      }
    }
  }

  return 'localhost'; // Retorna localhost si no encuentra otra IP
}