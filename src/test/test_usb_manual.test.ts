import { inspect } from "node:util";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { KNXUSBConnection } from "../connection/KNXUSBConnection";

let usb: KNXUSBConnection;

async function testUsb() {
  usb = new KNXUSBConnection({ path: "/dev/hidraw1" });

  usb.on("connected", (msg) => console.log("connected", msg));

  usb.on("indication", (cemi: ServiceMessage) => {
    console.log("RAW", cemi.toBuffer());
    console.log("IND", cemi.constructor.name, inspect(cemi.describe(), { depth: Infinity, colors: true }));
  });
  // usb.on("indication_emi", (cemi: ServiceMessage) => console.log("IND", cemi.constructor.name, cemi));
  const num = 0;
  let bol = false;
  setInterval(() => {
    // const value = KnxDataEncoder.encodeThis("5", { value: num++ })
    // usb.read("1/0/4");
    // const dptValue = KnxDataEncoder.encodeThis(1, { value: bol });
    // const controlField = new ControlField(0xbc);
    bol = !bol;
    usb.write("0/0/1", "1", { value: bol }).then(() => {
      console.log("Enviado", bol, num);
    });
    // usb.write("0/0/2", "1", { value: bol }).then((value) => { console.log("Enviado", bol, num); });
  }, 3000);

  try {
    await usb.connect();
  } catch (err) {
    console.error(err);
  }
}

testUsb().catch(console.error);

async function gracefulShutdown(reason: string) {
  console.log(`\n[Shutdown] ${reason}`);
  try {
    if (usb) {
      usb.disconnect();
    }
    await new Promise((res) => setTimeout(res, 200));
  } catch (err) {
    console.error("[Shutdown] Error during disconnect:", err);
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", () => gracefulShutdown("SIGINT received (Ctrl+C)"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM received"));
