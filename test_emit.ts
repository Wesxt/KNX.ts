import { EventEmitter } from "events";
const emitter = new EventEmitter();
emitter.on("ind", (b) => {
  b.toBuffer();
});
try {
  emitter.emit("ind", Buffer.from([1]));
  console.log("Success");
} catch(e: any) {
  console.log("Caught:", e.message);
}
