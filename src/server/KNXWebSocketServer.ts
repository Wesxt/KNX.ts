import { WebSocketServer, WebSocket } from "ws";
import { GroupAddressCache } from "../core/cache/GroupAddressCache";
import { CEMIInstance } from "../core/CEMI";
import { WebSocketGatewayOptions } from "../@types/interfaces/servers";

export class KNXWebSocketGateway {
  private wss: WebSocketServer | null = null;
  private options: WebSocketGatewayOptions;

  // Track subscribed addresses: "*" means all
  private activeSubscriptions: Set<string> = new Set();

  constructor(options: WebSocketGatewayOptions) {
    this.options = options;
  }

  public start() {
    this.wss = new WebSocketServer({ port: this.options.port });
    this.wss.on("connection", (ws) => {
      ws.on("message", (message) => {
        try {
          const payload = JSON.parse(message.toString());
          this.handleClientMessage(ws, payload);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          this.sendError(ws, "Invalid JSON format");
        }
      });
      // Acknowledge connection
      ws.send(JSON.stringify({ action: "connected", message: "KNX WebSocket Gateway connected" }));
    });

    // Listen globally for events from knxContext to dispatch to WS clients
    this.options.knxContext.on("indication", (cemi: CEMIInstance) => {
      if (!("destinationAddress" in cemi)) return;
      const dest = cemi.destinationAddress;
      if (!dest) return;

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

  private handleClientMessage(ws: WebSocket, payload: any) {
    const { action, groupAddress, value, dpt } = payload;

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
        .write(groupAddress, targetDpt, value)
        .then(() => {
          ws.send(JSON.stringify({ action: "write_ack", groupAddress }));
        })
        .catch((err) => {
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
  }

  private broadcast(address: string, cemi: any, decodedValue?: any) {
    if (!this.wss) return;
    const msg = JSON.stringify({
      action: "event",
      groupAddress: address,
      decodedValue,
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
