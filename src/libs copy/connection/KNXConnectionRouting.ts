import dgram from "dgram";
import { getLocalIP } from "../utils/function/localIp";
import { KNXConnection } from "./KNXConnection";



export class KnxConnectionRouting extends KNXConnection {
  localIpAddress: string;
  localPort: number;
  localIpMulticast: string;
  localPortMulticast: number;
  multicastSocket: dgram.Socket | null = null;
  private enumNotifications = {
    /**
     * Depending on the configuration a KNXnet/IP Router can receive more messages from the LAN than it
      can send to the KNX Subnetwork. This can lead to an overflow of the LAN-to-KNX queue and
      subsequent loss of a KNXnet/IP message because it cannot be transferred from the network buffer to the
      queue.
      In this event the Property PID_QUEUE_OVERFLOW_TO_KNX value shall be incremented and a
      ROUTING_LOST_MESSAGE notification shall be multicast to the KNXnet/IP Routing Multicast
      Address.
     */
    PID_QUEUE_OVERFLOW_TO_KNX: 0,
    /**If the connection of the KNXnet/IP Router to the LAN is broken it cannot forward telegrams from the
    KNX Subnetwork to the LAN. This can lead to an overflow of the KNX-to-LAN queue and subsequent
    loss of a KNX message because it cannot be transferred from the KNX Subnetwork buffer to the queue.
    In this event the Property PID_QUEUE_OVERFLOW_TO_IP value shall be incremented.
    This notification allows a central supervising entity to log the routing traffic and determine potential
    problems with the system network design. */
    PID_QUEUE_OVERFLOW_TO_IP: 0,
    ROUTING_LOST_MESSAGE: 0
  }
  private enumRoutingBusy = {
    /**
     * **tw** SHOULD
      resemble the time required to empty the incoming queue.
      The value of tw used by a device shall be stored in Property **PID_ROUTING_BUSY_WAIT_TIME**. **tw**
      SHALL be at least 20 ms and SHALL not exceed 100 ms.
     */
    PID_ROUTING_BUSY_WAIT_TIME: 20,
    /**The threshold for sending a ROUTING_BUSY Frame with the Individual Address from the last
    ROUTING_INDICATION Frame SHOULD be set at five messages in the incoming queue **The recommended values are based on a system simulation assuming that up to 255 devices send 50
    ROUTING_INDICATION datagrams per second** */
    ROUTING_INDICATION: 5
  }
  constructor(
    localIpAddress: string = getLocalIP(),
    localPort: number = 13671,
    localIpMulticast: string = "224.0.23.12",
    localPortMulticast: number = 3671
  ) {
    super(localIpAddress, localPort);
    this.localIpAddress = localIpAddress;
    this.localPort = localPort;
    this.localIpMulticast = localIpMulticast;
    this.localPortMulticast = localPortMulticast;

    // Join the multicast group using IGMP
    this.joinMulticastGroup();
  }
  get notifications() {
    return this.enumNotifications
  }
  resetNotifications() {
    for (const key in this.enumNotifications) {
      this.enumNotifications[key as keyof typeof this.enumNotifications] = 0
    }
    return this.notifications
  }
  /**
   * Initializes the UDP socket and joins the KNX/IP multicast group (224.0.23.12).
   */
  private joinMulticastGroup() {
    this.multicastSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this.multicastSocket.on("listening", () => {
      if (!this.multicastSocket) return;

      // Bind to multicast port
      this.multicastSocket.setBroadcast(true);
      this.multicastSocket.setMulticastTTL(255);
      this.multicastSocket.setMulticastLoopback(true);

      // Select the network interface
      this.multicastSocket.setMulticastInterface(this.localIpAddress);

      console.log(`✅ Joined KNX/IP multicast group ${this.localIpMulticast}`);
    });

    this.multicastSocket.on("message", (msg, rinfo) => {
      console.log(`📩 Received multicast message from ${rinfo.address}:`, msg);
    });

    this.multicastSocket.bind(this.localPortMulticast, () => {
      if (!this.multicastSocket) return;

      // Join the IGMP multicast group
      this.multicastSocket.addMembership(this.localIpMulticast, this.localIpAddress);
    });
  }

  /**
   * Sends a KNX/IP multicast message.
   * @param data - The Buffer containing the message.
   */
  sendMulticastMessage(data: Buffer) {
    if (!this.multicastSocket) {
      console.error("⚠️ Multicast socket is not initialized.");
      return;
    }

    this.multicastSocket.send(data, 0, data.length, this.localPortMulticast, this.localIpMulticast, (err) => {
      if (err) {
        console.error("❌ Error sending multicast message:", err);
        this.enumNotifications.PID_QUEUE_OVERFLOW_TO_IP++
      } else {
        console.log("📤 Multicast message sent!");
      }
    });
  }

  /**
   * Leaves the KNX/IP multicast group and closes the socket.
   */
  closeMulticast() {
    if (this.multicastSocket) {
      this.multicastSocket.dropMembership(this.localIpMulticast, this.localIpAddress);
      this.multicastSocket.close();
      console.log(`🚪 Left KNX/IP multicast group ${this.localIpMulticast}`);
    }
  }
}
