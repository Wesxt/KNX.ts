import { inspect } from "node:util";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { KNXUSBConnection } from "../connection/KNXUSBConnection";
import { EMI } from "../core/EMI";
import { ControlField } from "../core/ControlField";
import { Priority } from "../core/enum/EnumControlField";
import { NPDU } from "../core/layers/data/NPDU";
import { TPDU } from "../core/layers/data/TPDU";
import { APCI } from "../core/layers/interfaces/APCI";
import { TPCI } from "../core/layers/interfaces/TPCI";
import { APCIEnum } from "../core/enum/APCIEnum";
import { KnxDataEncoder } from "../core/data/KNXDataEncode";
import { APDU } from "../core/layers/data/APDU";
import { CEMI } from "../core/CEMI";
import { ExtendedControlField } from "../core/ControlFieldExtended";

const MULTICAST_IP = "224.0.23.12";
const PORT = 3671;

// let server: KNXnetIPServer;
let usb: KNXUSBConnection;

async function testRouting() {
  console.log(
    `--- Testing Routing (Multicast Group: ${MULTICAST_IP}:${PORT}) ---`,
  );

  // const localIp = "192.168.0.169";
  // console.log(`Using Local IP: ${localIp}`);

  usb = new KNXUSBConnection({ path: "/dev/hidraw0" });

  usb.on("connected", (msg) => console.log("connected", msg));

  usb.on("indication", (cemi: ServiceMessage) => {
    console.log("RAW", cemi.toBuffer());
    console.log(
      "IND",
      cemi.constructor.name,
      inspect(cemi.describe(), { depth: Infinity, colors: true }),
    );
  });
  // usb.on("indication_emi", (cemi: ServiceMessage) => console.log("IND", cemi.constructor.name, cemi));
  let num = 0;
  let bol = false;
  setInterval(() => {
    // const value = KnxDataEncoder.encodeThis("5", { valueDpt5: num++ })
    // usb.read("1/0/4");
    bol = !bol;
    const dptValue = KnxDataEncoder.encodeThis(1, { value: bol });
    // usb.read("1.1.1");
    const controlField = new ControlField(0xbc);
    // let x = new EMI.DataLinkLayerEMI["L_Data.req"](
    //   controlField,
    //   "1/0/4",
    //   new NPDU(
    //     new TPDU(
    //       new TPCI(),
    //       new APDU(
    //         undefined,
    //         new APCI(APCIEnum["A_GroupValue_Read_Protocol_Data_Unit"]),
    //         Buffer.alloc(1),
    //       ),
    //       Buffer.alloc(1),
    //     ),
    //   ),
    // ).toBuffer();
    // x = Buffer.concat([x.subarray(0, 1), Buffer.alloc(1), x.subarray(1)]);
    // console.log(x);
    // usb.send(x).then(() => console.log("enviado"));
    // const z = new EMI.DataLinkLayerEMI["L_Data.req"](
    //   controlField,
    //   "0/0/1",
    //   new NPDU(
    //     new TPDU(
    //       new TPCI(),
    //       new APDU(
    //         undefined,
    //         new APCI(APCIEnum["A_GroupValue_Read_Protocol_Data_Unit"]),
    //         Buffer.alloc(1),
    //       ),
    //       Buffer.alloc(1),
    //     ),
    //   ),
    // );
    // usb.send(z).then(() => console.log('read enviado'));
    // usb.read("1.1.1");
    // usb.read("1/0/1");
    usb.write("0/0/1", "1", { value: bol }).then((value) => { console.log("Enviado", bol, num); });
    // let cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
    //   null,
    //   controlField,
    //   new ExtendedControlField(),
    //   "0.0.0",
    //   "1/0/4",
    //   new TPDU(
    //     new TPCI(),
    //     new APDU(
    //       undefined,
    //       new APCI(APCIEnum["A_GroupValue_Read_Protocol_Data_Unit"]),
    //       Buffer.alloc(1),
    //     ),
    //     Buffer.alloc(1),
    //   )
    // ).toBuffer();
    // cemi = Buffer.concat([cemi.subarray(0, 3), cemi.subarray(4)]);
    // console.log(cemi);
    // usb.send(cemi).then(() => console.log("enviado"));
  }, 3000);

  try {
    await usb.connect();
  } catch (err) {
    console.error(err);
  }
  // Create IP Server with embedded USB routing
  // server = new KNXnetIPServer({
  //   ip: MULTICAST_IP,
  //   port: PORT,
  //   localIp: localIp,
  //   friendlyName: "KNX.ts USB Router",
  //   clientAddrs: "1.15.1:8",
  //   individualAddress: "1.15.0", // Router IA
  //   logOptions: {
  //     logDir: "./log",
  //     logToFile: true,
  //     level: "debug"
  //   },
  //   useAllInterfaces: false,
  //   // Provide USB config in the externals block so Router connects it automatically
  //   externals: {
  //     usb: {
  //       path: '/dev/hidraw0' // Or leave empty to auto-detect
  //     }
  //   }
  // });

  // server.on("connected", () => {
  //   console.log("[Routing] Socket Bound & Member of Multicast Group!");
  //   console.log("[Routing] USB Device should be connected via internal Router.");
  // });

  // server.on("error", (err: any) => {
  //   console.error("[Routing] Error:", err.message);
  // });

  // // Monitor traffic flowing out to the IP network or being parsed
  // server.on("indication", (cemi: ServiceMessage) => {
  //   console.log("\n[SERVER <- INDICATION]", cemi.constructor.name, "sourceAddress" in cemi ? cemi.sourceAddress : null, "->", "destinationAddress" in cemi ? cemi.destinationAddress : null);
  //   // console.log(cemi);
  // });

  // server.externalManager?.on("indication_link", (msg: { src: string, msg: ServiceMessage; }) => {
  //   if (msg.src !== KNXnetIPServer.constructor.name) {
  //     console.log('[SERVER <- Link]', msg.src, msg.msg);
  //   }
  // });

  // try {
  //   console.log("[Routing] Connecting Server (will connect IP & USB)...");
  //   await server.connect();
  //   console.log("[Routing] Setup Complete. Listening for traffic on IP and USB.");
  // } catch (e: any) {
  //   console.error("[Routing] Failed:", e.message);
  // }
}

testRouting().catch(console.error);

async function gracefulShutdown(reason: string) {
  console.log(`\n[Shutdown] ${reason}`);
  try {
    // if (server) {
    //   server.disconnect();
    // }
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
