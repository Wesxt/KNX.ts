import { KnxConnectionTunneling } from "./libs/KNXConnectionTunneling";
const connectionKnx = new KnxConnectionTunneling('192.168.0.174', 3671)
connectionKnx.debug = true
console.log(connectionKnx.eventNames())

connectionKnx.on('event', (event) => console.log('Event received', event))
connectionKnx.on('status', status => console.log('Status received', status));

let value = false;

function toggleValue() {
  value = !value
  connectionKnx.Action('0/0/1', value)
}


connectionKnx.Connect(() => {
  connectionKnx.ConnectRequest((event) => {
    console.log(event)
  })
  setTimeout(toggleValue, 3000)
})
