import { WebSocketServer, WebSocket } from "ws";
import { GroupAddressCache } from "../core/cache/GroupAddressCache";
import { CEMIInstance } from "../core/CEMI";
import { WebSocketGatewayOptions, WSClientPayload } from "../@types/interfaces/servers";
import { Router } from "../connection/Router";
import { IndicationRouterLink } from "../@types/interfaces/connection";

export class KNXWebSocketGateway {
  private wss: WebSocketServer | null = null;
  private options: WebSocketGatewayOptions;

  // Track subscribed addresses: "*" means all
  private activeSubscriptions: Set<string> = new Set();

  constructor(options: WebSocketGatewayOptions) {
    this.options = options;
    // Enable the cache singleton
    GroupAddressCache.getInstance().setEnabled(true);
  }

  public start() {
    this.wss = new WebSocketServer({
      host: this.options.host,
      port: this.options.port,
    });
    this.wss.on("connection", (ws) => {
      ws.on("message", (message) => {
        try {
          const payload = JSON.parse(message.toString());
          if (typeof payload !== "object" || payload === null) {
            throw new Error("Payload must be a JSON object");
          }
          this.handleClientMessage(ws, payload);
        } catch (e: any) {
          this.sendError(ws, e.message || "Invalid JSON format");
        }
      });
      // Acknowledge connection
      ws.send(JSON.stringify({ action: "connected", message: "KNX WebSocket Gateway connected" }));
    });

    if (this.options.knxContext instanceof Router) {
      // Listen globally for events from knxContext to dispatch to WS clients
      this.options.knxContext.on("indication_link", (data: IndicationRouterLink) => {
        const { msg: cemi, src } = data;
        if (!("destinationAddress" in cemi)) return;
        const dest = cemi.destinationAddress;

        if (this.activeSubscriptions.has(dest) || this.activeSubscriptions.has("*")) {
          const cache = GroupAddressCache.getInstance();
          const entries = cache.query(dest, undefined, undefined, true);
          let decodedValue = undefined;

          if (entries && entries.length > 0) {
            decodedValue = entries[0].decodedValue;
          }

          this.broadcast(dest, cemi, decodedValue, src);
        }
      });
    } else {
      // Listen globally for events from knxContext to dispatch to WS clients
      this.options.knxContext.on("indication", (cemi: CEMIInstance) => {
        if (!("destinationAddress" in cemi)) return;
        const dest = cemi.destinationAddress;

        if (this.activeSubscriptions.has(dest) || this.activeSubscriptions.has("*")) {
          const cache = GroupAddressCache.getInstance();
          const entries = cache.query(dest, undefined, undefined, true);
          let decodedValue = undefined;

          if (entries && entries.length > 0) {
            decodedValue = entries[0].decodedValue;
          }

          this.broadcast(dest, cemi, decodedValue);
        }
      });
    }
  }

  private handleClientMessage(ws: WebSocket, payload: WSClientPayload) {
    const { action, groupAddress, value, dpt } = payload;
    if (typeof value !== "object") this.sendError(ws, "The value is must be object");
    if (!action) {
      this.sendError(ws, "Missing action in payload");
      return;
    }

    if (action === "config_dpt" && groupAddress && dpt) {
      GroupAddressCache.getInstance().setAddressDPT(groupAddress, dpt);
      ws.send(JSON.stringify({ action: "config_dpt_ack", groupAddress, dpt }));
      return;
    }

    if (action === "read" && groupAddress) {
      GroupAddressCache.getInstance()
        .readDirectAsync(groupAddress, this.options.knxContext)
        .then((res) => {
          ws.send(JSON.stringify({ action: "read_result", groupAddress, data: res }));
        })
        .catch((err) => this.sendError(ws, err.message));
      return;
    }

    if (action === "query" && groupAddress) {
      const results = GroupAddressCache.getInstance().query(
        groupAddress,
        payload.startDate ? new Date(payload.startDate) : undefined,
        payload.endDate ? new Date(payload.endDate) : undefined,
        payload.onlyLatest ?? false,
      );
      ws.send(JSON.stringify({ action: "query_result", groupAddress, results }));
      return;
    }

    if (action === "write" && groupAddress && value !== undefined) {
      // Try getting dpt from payload, or fallback to cache
      const targetDpt = dpt || GroupAddressCache.getInstance().getAddressDPT(groupAddress);

      // Context .write naturally encodes using KNXDataEncoder internally if dpt is provided
      this.options.knxContext
        .write(groupAddress, targetDpt as any, value)
        .then(() => {
          ws.send(JSON.stringify({ action: "write_ack", groupAddress }));
        })
        .catch((err: any) => {
          console.error(err);
          this.sendError(ws, err.message);
        });
      return;
    }

    if (action === "subscribe") {
      const target = groupAddress || "*";
      this.activeSubscriptions.add(target);
      ws.send(JSON.stringify({ action: "subscribe_ack", groupAddress: target }));
      return;
    }

    if (action === "unsubscribe") {
      const target = groupAddress || "*";
      this.activeSubscriptions.delete(target);
      ws.send(JSON.stringify({ action: "unsubscribe_ack", groupAddress: target }));
      return;
    }

    this.sendError(ws, `Unknown action or missing parameters for action: ${action}`);
  }

  private broadcast(address: string, cemi: CEMIInstance, decodedValue?: any, sourceLinkKey?: string) {
    if (!this.wss) return;
    const msg = JSON.stringify({
      action: "event",
      groupAddress: address,
      cemi: cemi.describe(),
      decodedValue: decodedValue ?? null,
      sourceLinkKey,
    });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  private sendError(ws: WebSocket, message: string) {
    ws.send(JSON.stringify({ action: "error", message }));
  }

  public stop() {
    if (this.wss) this.wss.close();
  }
}
