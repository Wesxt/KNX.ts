import { Aedes } from "aedes";
import { createServer, Server } from "aedes-server-factory";
import * as mqtt from "mqtt";

import { GroupAddressCache } from "../core/cache/GroupAddressCache";
import { CEMIInstance } from "../core/CEMI";
import { MQTTCommandPayload, MQTTGatewayOptions } from "../@types/interfaces/servers";

export class KNXMQTTGateway {
  private options: MQTTGatewayOptions;
  private aedesBroker: Aedes | null = null;
  private server: Server | null = null;
  private client: mqtt.MqttClient | null = null;
  private topicPrefix: string;

  constructor(options: MQTTGatewayOptions) {
    this.options = options;
    this.topicPrefix = options.topicPrefix || "knx";
    // Enable the cache singleton
    GroupAddressCache.getInstance().setEnabled(true);
  }

  public async start(): Promise<void> {
    // 1. Setup embedded broker if requested
    if (this.options.embeddedBroker) {
      this.aedesBroker = await Aedes.createBroker();
      this.server = createServer(this.aedesBroker);
      const port = this.options.embeddedBroker.port;
      const host = this.options.embeddedBroker.host || "127.0.0.1";

      await new Promise<void>((serverResolve, serverReject) => {
        if (!this.server) return serverReject(new Error("The server is null"));
        this.server.on("error", (err: any) => {
          serverReject(new Error(`MQTT Server error: ${err.message}`));
        });
        this.server.listen(port, host, () => {
          serverResolve();
        });
      });
    }

    await new Promise<void>((resolve, reject) => {
      // 2. Setup Client to bridge KNX to MQTT
      const url =
        this.options.brokerUrl ||
        (this.options.embeddedBroker
          ? `mqtt://${this.options.embeddedBroker.host ?? "127.0.0.1"}:${this.options.embeddedBroker.port}`
          : null);

      if (!url) {
        throw new Error("No Broker URL provided nor embedded broker requested.");
      }

      this.client = mqtt.connect(url, {
        username: this.options.mqttUsername,
        password: this.options.mqttPassword,
        connectTimeout: 5000, // Add timeout
      });

      this.client.on("connect", () => {
        // Subscribe to command topics: prefix/command/action/groupAddress
        // Actions: write, read, config_dpt
        this.client?.subscribe(`${this.topicPrefix}/command/write/#`);
        this.client?.subscribe(`${this.topicPrefix}/command/read/#`);
        this.client?.subscribe(`${this.topicPrefix}/command/config_dpt/#`);
        resolve();
      });

      this.client.on("error", (err) => {
        reject(new Error(`MQTT Client error: ${err.message}`));
      });

      this.client.on("message", (topic, message) => {
        this.handleMQTTMessage(topic, message);
      });

      // Global Listener from KNXContext
      this.options.knxContext.on("indication", (cemi: CEMIInstance) => {
        if (!("destinationAddress" in cemi)) return;
        const dest = cemi.destinationAddress;
        if (!dest) return;

        const cache = GroupAddressCache.getInstance();
        const entries = cache.query(dest, undefined, undefined, true);
        let decodedValue = undefined;

        if (entries && entries.length > 0) {
          decodedValue = entries[0].decodedValue;
        }

        // Publish to mqtt
        const pubTopic = `${this.topicPrefix}/state/${dest}`;
        const payload = JSON.stringify({
          decodedValue: decodedValue,
        });

        if (this.client?.connected) {
          this.client.publish(pubTopic, payload, { retain: true });
        }
      });
    });
  }

  private handleMQTTMessage(topic: string, message: Buffer) {
    const parts = topic.split("/");
    // knx/command/write/1/2/3
    if (parts.length < 4) return;

    const action = parts[2];
    const groupAddress = parts.slice(3).join("/"); // To handle 1/2/3

    let payload: MQTTCommandPayload = {};
    try {
      const msgStr = message.toString();
      payload = msgStr ? JSON.parse(msgStr) : {};
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // simple value fallback
      payload = { value: message.toString() };
    }
    if (!("value" in payload) || !("dpt" in payload)) return;
    const { value, dpt } = payload;

    if (action === "config_dpt" && dpt) {
      GroupAddressCache.getInstance().setAddressDPT(groupAddress, dpt);
      return;
    }

    if (action === "read") {
      GroupAddressCache.getInstance()
        .readDirectAsync(groupAddress, this.options.knxContext as any)
        .catch((err) => {
          this.publishError(groupAddress, err.message);
        });
      return;
    }

    if (action === "write" && value !== undefined) {
      const targetDpt = dpt || GroupAddressCache.getInstance().getAddressDPT(groupAddress);

      this.options.knxContext.write(groupAddress, targetDpt as any, value).catch((err: any) => {
        this.publishError(groupAddress, err.message);
      });
    }
  }

  private publishError(address: string, error: string) {
    if (!this.client?.connected) return;
    this.client.publish(`${this.topicPrefix}/error`, JSON.stringify({ groupAddress: address, error }));
  }

  public stop() {
    if (this.client) {
      this.client.end();
    }
    if (this.server) {
      this.server.close();
    }
    if (this.aedesBroker) {
      this.aedesBroker.close();
    }
  }
}
