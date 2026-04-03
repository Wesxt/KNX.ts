import { KNXnetIPServer } from "../../connection/KNXnetIPServer";
import { KNXService } from "../../connection/KNXService";
import { Router } from "../../connection/Router";

export interface MQTTGatewayOptions {
  knxContext: Router | KNXnetIPServer;

  // Either spin up an internal Aedes broker
  embeddedBroker?: {
    port: number;
    host?: string;
  };

  // And/Or connect to an existing broker (if embeddedBroker is set, this can connect locally or can be pointed outwards)
  brokerUrl?: string;
  mqttUsername?: string;
  mqttPassword?: string;

  // Topics base
  topicPrefix?: string; // defaults to 'knx'
}

export interface WebSocketGatewayOptions {
  port: number;
  knxContext: KNXService;
}
