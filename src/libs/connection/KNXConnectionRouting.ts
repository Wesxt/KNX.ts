import { getLocalIP } from "../utils/function/localIp";
import { KNXConnection } from "./KNXConnection";

class KnxConnectionRouting extends KNXConnection {
  localIpAddress: string | undefined
  constructor(localIpAddress: string = getLocalIP(), localPort: number = 13671, localIpMulticast: string = "224.0.23.12", localPortMulticast: number = 3671) {
    super(localIpAddress, localPort);
  }
}