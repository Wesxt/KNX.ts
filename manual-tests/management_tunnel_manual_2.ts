import { ConnectionType, KNXManagement, KNXTunneling } from "../src";

const client = new KNXTunneling({
  ip: "192.168.0.204",
  localIp: "192.168.0.190",
  autoReconnect: false,
  useRouteBack: false,
  connectionType: ConnectionType.TUNNEL_CONNECTION,
});

const management = new KNXManagement(client);

client.connect();

client.on("connected", async (channelId) => {
  console.log(channelId);
  console.log("testing change the programing mode on once device");

  const list = await management.scanLine("1.1", {
    range: [1, 10],
  });

  console.log(list);
  let val = true;
  setTimeout(() => {
    setInterval(async () => {
      await management.setProgrammingMode("1.1.1", val);
      console.log("Changed!!!");
      val = !val;
    }, 3000);
  }, 3000);
});

process.once("SIGINT", async () => {
  client.disconnect();
  console.log("Disconnected!!");
});
