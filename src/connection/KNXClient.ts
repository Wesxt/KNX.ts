import { EventEmitter } from "events";
import dgram from "dgram";
import net from "net";
import { KNXnetIPHeader } from "../core/KNXnetIPHeader";
import { HPAI, DIB, SRP } from "../core/KNXnetIPStructures";
import { KNXnetIPServiceType, HostProtocolCode } from "../core/enum/KNXnetIPEnum";
import { getLocalIP } from "../utils/localIp";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { KnxDataEncoder } from "../core/data/KNXDataEncode";
import { CEMI } from "../core/CEMI";
import { ControlField } from "../core/ControlField";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { TPDU } from "../core/layers/data/TPDU";
import { TPCI, TPCIType } from "../core/layers/interfaces/TPCI";
import { APDU } from "../core/layers/data/APDU";
import { APCI } from "../core/layers/interfaces/APCI";
import { APCIEnum } from "../core/enum/APCIEnum";
import { AllDpts } from "../@types/types/AllDpts";

export interface KNXClientOptions {
  ip?: string;
  port?: number;
  localIp?: string;
  localPort?: number;
  [key: string]: any;
}

export abstract class KNXClient extends EventEmitter {
  protected socket: dgram.Socket | net.Socket | null = null;
  protected options: KNXClientOptions;
  protected _transport: "UDP" | "TCP" = "UDP";

  constructor(options: KNXClientOptions = {}) {
    super();
    this.options = {
      ip: "224.0.23.12",
      port: 3671,
      localIp: getLocalIP(),
      localPort: 0,
      ...options,
    };
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  abstract send(data: Buffer | ServiceMessage): Promise<void> | void;

  /**
   * Send a GroupValue_Write telegram to a group address.
   * @param destination The group address (e.g., "1/1/1")
   * @param value The value to write.
   * @param dpt Optional Datapoint Type to help with encoding.
   */
  public async write<T extends (typeof KnxDataEncoder.dptEnum)[number] | string | null>(destination: string, dpt: T, value: AllDpts<T>): Promise<void> {
    let data: Buffer;
    if (dpt !== undefined) {
      data = KnxDataEncoder.encodeThis(dpt, value);
    } else if (typeof value === "boolean") {
      data = Buffer.from([value ? 1 : 0]);
      (data as any).isShort = true;
    } else if (Buffer.isBuffer(value)) {
      data = value;
    } else if (typeof value === "number") {
      data = Buffer.from([value]);
    } else {
      throw new Error("Cannot encode value without DPT or basic type (boolean/number/Buffer)");
    }

    const cf1 = new ControlField(0xbc);
    const cf2 = new ExtendedControlField(0xe0);
    const tpdu = new TPDU(
      new TPCI(TPCIType.T_DATA_GROUP_PDU),
      new APDU(
        new TPCI(TPCIType.T_DATA_GROUP_PDU),
        new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit),
        data
      ),
      data
    );

    const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
      null,
      cf1,
      cf2,
      "0.0.0",
      destination,
      tpdu
    );
    console.log('SEND', cemi.constructor.name, cemi.toBuffer());

    return this.send(cemi) as Promise<void>;
  }

  /**
   * Send a GroupValue_Read telegram to a group address.
   * @param destination The group address (e.g., "1/1/1")
   */
  public async read(destination: string): Promise<void> {
    const cf1 = new ControlField(0xbc);
    const cf2 = new ExtendedControlField(0xe0);
    const tpdu = new TPDU(
      new TPCI(TPCIType.T_DATA_GROUP_PDU),
      new APDU(
        new TPCI(TPCIType.T_DATA_GROUP_PDU),
        new APCI(APCIEnum.A_GroupValue_Read_Protocol_Data_Unit),
        Buffer.alloc(0)
      ),
      Buffer.alloc(0)
    );

    const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
      null,
      cf1,
      cf2,
      "0.0.0",
      destination,
      tpdu
    );

    return this.send(cemi) as Promise<void>;
  }

  /**
   * Discovery Process (Search Request)
   */
  public static async discover(timeout: number = 3000, localIp?: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket("udp4");
      const devices: any[] = [];
      const _localIp = localIp || getLocalIP();

      socket.on("message", (msg, rinfo) => {
        try {
          const header = KNXnetIPHeader.fromBuffer(msg);
          if (header.serviceType === KNXnetIPServiceType.SEARCH_RESPONSE) {
            const hpaiData = msg.subarray(6, 14);
            const hpai = HPAI.fromBuffer(hpaiData);

            // Parse DIBs starting from byte 14
            const dibs: DIB[] = [];
            let offset = 14;
            while (offset < msg.length) {
              const dibLen = msg.readUInt8(offset);
              if (offset + dibLen > msg.length) break;
              const dibBuffer = msg.subarray(offset, offset + dibLen);
              dibs.push(DIB.fromBuffer(dibBuffer));
              offset += dibLen;
            }

            devices.push({
              ip: hpai.ipAddress,
              port: hpai.port,
              dibs,
            });
          }
        } catch (e) {
          // Ignore malformed packets
        }
      });

      socket.bind(() => {
        const localHPAI = new HPAI(HostProtocolCode.IPV4_UDP, _localIp, socket.address().port);
        const header = new KNXnetIPHeader(KNXnetIPServiceType.SEARCH_REQUEST, 0);
        const hpaiBuffer = localHPAI.toBuffer();
        header.totalLength = header.toBuffer().length + hpaiBuffer.length;

        const packet = Buffer.concat([header.toBuffer(), hpaiBuffer]);

        // Send to Multicast Address
        socket.send(packet, 3671, "224.0.23.12");

        setTimeout(() => {
          socket.close();
          resolve(devices);
        }, timeout);
      });
    });
  }

  /**
   * Extended Discovery Process (Search Request Extended)
   * Allows searching with filters (SRPs).
   */
  public static async discoverExtended(srps: SRP[], timeout: number = 3000, localIp?: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const devices: any[] = [];
      const _localIp = localIp || getLocalIP();

      socket.on('message', (msg, rinfo) => {
        try {
          const header = KNXnetIPHeader.fromBuffer(msg);
          if (header.serviceType === KNXnetIPServiceType.SEARCH_RESPONSE ||
            header.serviceType === KNXnetIPServiceType.SEARCH_RESPONSE_EXTENDED) {
            // Extract IP/Port from HPAI
            const hpai = HPAI.fromBuffer(msg.subarray(6, 14));
            const dibs: DIB[] = [];
            let offset = 14;
            while (offset < msg.length) {
              const dibLen = msg.readUInt8(offset);
              if (dibLen === 0) break;
              dibs.push(DIB.fromBuffer(msg.subarray(offset, offset + dibLen)));
              offset += dibLen;
            }
            devices.push({ ip: hpai.ipAddress, port: hpai.port, dibs });
          }
        } catch (e) { }
      });

      socket.bind(() => {
        const localHPAI = new HPAI(HostProtocolCode.IPV4_UDP, _localIp, socket.address().port);
        const header = new KNXnetIPHeader(KNXnetIPServiceType.SEARCH_REQUEST_EXTENDED, 0);
        const hpaiBuf = localHPAI.toBuffer();
        const srpBufs = srps.map(s => s.toBuffer());
        const body = Buffer.concat([hpaiBuf, ...srpBufs]);
        header.totalLength = 6 + body.length;

        socket.send(Buffer.concat([header.toBuffer(), body]), 3671, '224.0.23.12');
        setTimeout(() => { socket.close(); resolve(devices); }, timeout);
      });
    });
  }

  /**
   * Description Request (Self Description)   * Queries a specific device for its capabilities.
*/
  public async describe(): Promise<any> {
    return new Promise((resolve, reject) => {
      // Description is usually connectionless via UDP on the Control Endpoint
      const descSocket = dgram.createSocket("udp4");
      const targetIp = this.options.ip!;
      const targetPort = this.options.port!;

      const timeout = setTimeout(() => {
        descSocket.close();
        reject(new Error("Description request timed out"));
      }, 2000);

      descSocket.on("message", (msg) => {
        try {
          const header = KNXnetIPHeader.fromBuffer(msg);
          if (header.serviceType === KNXnetIPServiceType.DESCRIPTION_RESPONSE) {
            clearTimeout(timeout);
            // Similar parsing logic as Discovery
            const dibs: DIB[] = [];
            let offset = 6; // Header length
            while (offset < msg.length) {
              const dibLen = msg.readUInt8(offset);
              const dibBuffer = msg.subarray(offset, offset + dibLen);
              dibs.push(DIB.fromBuffer(dibBuffer));
              offset += dibLen;
            }
            descSocket.close();
            resolve({ dibs });
          }
        } catch (e) { }
      });

      descSocket.bind(() => {
        const localHPAI = new HPAI(HostProtocolCode.IPV4_UDP, this.options.localIp!, descSocket.address().port);
        const header = new KNXnetIPHeader(KNXnetIPServiceType.DESCRIPTION_REQUEST, 0);
        const hpaiBuffer = localHPAI.toBuffer();
        header.totalLength = 6 + hpaiBuffer.length;
        const packet = Buffer.concat([header.toBuffer(), hpaiBuffer]);

        descSocket.send(packet, targetPort, targetIp);
      });
    });
  }
}
