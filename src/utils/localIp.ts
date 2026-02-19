import os from 'os';

export function getLocalIP() {
  const networkInterfaces = os.networkInterfaces();

  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName] as os.NetworkInterfaceInfo[];
    for (const net of interfaces) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }

  return 'localhost';
}

export function getLocalMac() {
  const info = getNetworkInfo();
  return info.mac;
}

export function getNetworkInfo() {
  const networkInterfaces = os.networkInterfaces();

  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName] as os.NetworkInterfaceInfo[];
    for (const net of interfaces) {
      if (net.family === 'IPv4' && !net.internal) {
        return {
          address: net.address,
          netmask: net.netmask,
          mac: net.mac
        };
      }
    }
  }

  return {
    address: '0.0.0.0',
    netmask: '0.0.0.0',
    mac: '00:00:00:00:00:00'
  };
}