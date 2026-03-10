import * as hid from 'node-hid';

console.log("Looking for USB HID devices...");
const devices = hid.devices();
const knxDevices = devices.filter(d => d.vendorId === 0x28c2 || (d.product && d.product.includes('KNX')));

console.log("Found KNX USB devices:", knxDevices);

if (knxDevices.length > 0) {
  try {
    console.log(`Attempting to open ${knxDevices[0].path}`);
    const device = new hid.HID(knxDevices[0].path!);
    console.log("Successfully opened device.");
    
    device.on("data", (data) => {
      console.log("Received data:", data);
    });
    
    device.on("error", (err) => {
      console.error("Device error:", err);
    });
    
    setTimeout(() => {
      console.log("Closing device");
      device.close();
      process.exit(0);
    }, 2000);
  } catch(e: any) {
    console.error("Failed to open device:", e.message);
    if (e.message.includes("cannot open device")) {
      console.log("\\nTip: You might need udev rules to access the device without sudo.");
    }
  }
} else {
  console.log("No KNX USB interface found.");
}
