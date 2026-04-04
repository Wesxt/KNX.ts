import { KNXService } from "../../connection/KNXService";

export interface MQTTGatewayOptions {
  knxContext: KNXService;

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

export interface WSClientPayload {
  action: "read" | "query" | "write" | "config_dpt" | "subscribe" | "unsubscribe";
  groupAddress?: string;
  dpt?: string | number;
  value?: any;
  onlyLatest?: boolean;
  startDate?: string | Date;
  endDate?: string | Date;
}

export interface WSServerPayload {
  action:
    | "connected"
    | "error"
    | "event"
    | "config_dpt_ack"
    | "write_ack"
    | "subscribe_ack"
    | "unsubscribe_ack"
    | "read_result"
    | "query_result";
  message?: string;
  groupAddress?: string;
  dpt?: string | number;
  decodedValue?: any;
  data?: any;
  results?: any[];
}

export interface MQTTCommandPayload {
  value?: any;
  dpt?: string | number;
}

export interface MQTTStatePayload {
  decodedValue: any;
}
