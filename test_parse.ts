import { CEMI } from "./src/core/CEMI";
const buf = Buffer.from([0x29, 0x00, 0xbc, 0xe0, 0x11, 0x02, 0x08, 0x02, 0x01, 0x00, 0x81]);
try {
  const cemi = CEMI.fromBuffer(buf);
  console.log("Success:", cemi);
} catch(e) {
  console.error("Error:", e);
}
