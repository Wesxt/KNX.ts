import { EventEmitter } from "events";
import dgram from "dgram";
import net from "net";
import { getLocalIP } from "../utils/localIp";
import { KnxDataEncoder } from "../core/data/KNXDataEncode";
import { CEMI, CEMIInstance } from "../core/CEMI";
import { ControlField } from "../core/ControlField";
import { ExtendedControlField } from "../core/ControlFieldExtended";
import { TPDU } from "../core/layers/data/TPDU";
import { TPCI, TPCIType } from "../core/layers/interfaces/TPCI";
import { APDU } from "../core/layers/data/APDU";
import { APCI } from "../core/layers/interfaces/APCI";
import { APCIEnum } from "../core/enum/APCIEnum";
import { AllDpts } from "../@types/types/AllDpts";
import { AllConnectionOptions } from "../@types/interfaces/connection";
import { KnxDataSecure, KNXDataSecureOptions } from "../security/KnxDataSecure";
import { KNXHelper } from "../utils/KNXHelper";

import { knxLogger, setupLogger, Logger } from "../utils/Logger";

export abstract class KNXService<TOptions extends AllConnectionOptions = AllConnectionOptions> extends EventEmitter {
  protected socket: dgram.Socket | net.Socket | null = null;
  public readonly options: TOptions;
  protected _transport: "UDP" | "TCP" = "UDP";
  protected logger: Logger;
  public individualAddress: string = "1.0.1";
  public isCacheDelegated: boolean = false;
  public isEventsDelegated: boolean = false;
  public dataSecure: KnxDataSecure | null = null;

  constructor(options: TOptions = {} as TOptions) {
    super();
    this.options = {
      localIp: getLocalIP(),
      localPort: 0,
      ...options,
    };

    const optIa = (options as { individualAddress?: string | number }).individualAddress;
    if (typeof optIa === "string" && optIa.trim().length > 0) {
      this.individualAddress = optIa;
    } else if (typeof optIa === "number") {
      this.individualAddress = KNXHelper.individualAddressToString(optIa);
    }

    if (options.dataSecure) {
      this.setDataSecure(options.dataSecure);
    }

    if (this.options.logOptions) {
      setupLogger(this.options.logOptions);
    }
    this.logger = knxLogger;
  }

  /**
   * Attaches, replaces, or disables KNX Data Security (`03_03_07` §5) on this service.
   */
  public setDataSecure(config: KnxDataSecure | KNXDataSecureOptions | null): KnxDataSecure | null {
    if (!config) {
      this.dataSecure = null;
      return null;
    }
    this.dataSecure = config instanceof KnxDataSecure ? config : new KnxDataSecure(config);
    return this.dataSecure;
  }

  /**
   * Applies KNX Data Security encryption to outgoing CEMI frames when `dataSecure` is attached.
   */
  protected prepareOutgoingCemi(data: Buffer | CEMIInstance): Buffer | CEMIInstance {
    if (!this.dataSecure) return data;
    return this.dataSecure.prepareOutgoingCemi(data, this.individualAddress);
  }

  /**
   * Applies KNX Data Security verification/decryption and `S-A_Sync` handling to incoming CEMI frames.
   * Returns the CEMI to emit (plain or decrypted), or `null` if the frame was consumed or rejected.
   */
  protected processIncomingCemi(cemi: CEMIInstance): CEMIInstance | null {
    if (!this.dataSecure) return cemi;
    return this.dataSecure.handleIncomingCemi(cemi, this);
  }

  /**
   * Start the connection
   */
  abstract connect(): Promise<void>;
  /**
   * Safe disconnection of the connection
   */
  abstract disconnect(): void;
  /**
   * Send a telegram
   * @param data A data buffer CEMI or EMI or an instance of a CEMI message
   */
  abstract send(data: Buffer | CEMIInstance): Promise<void>;
  /**
   * Returns the current connection state of the service as a string.
   */
  abstract get connectionState(): string;

  /**
   * Send a GroupValue_Write telegram to a group address.
   * @param destination The group address (e.g., "1/1/1")
   * @param value The value to write.
   * @param dpt Optional Datapoint Type to help with encoding.
   */
  public async write<T extends (typeof KnxDataEncoder.dptEnum)[number] | string | null>(
    destination: string,
    dpt: T,
    value: AllDpts<T>,
  ): Promise<void> {
    let data: Buffer;
    let isShort = false;
    // data validation
    if (dpt !== undefined) {
      data = KnxDataEncoder.encodeThis(dpt, value);
      isShort = KnxDataEncoder.isShortDpt(dpt);
    } else if (typeof value === "boolean") {
      data = Buffer.from([value ? 1 : 0]);
      isShort = true;
    } else if (Buffer.isBuffer(value)) {
      data = value;
      isShort = data.length === 1 && data[0] <= 0x3f;
    } else if (typeof value === "number") {
      data = Buffer.from([value]);
      isShort = value <= 0x3f;
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
        data,
        isShort,
      ),
      data,
    );

    const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, this.individualAddress, destination, tpdu);
    this.logger.debug({ service: cemi.constructor.name }, "Sending GroupValue_Write");

    return this.send(cemi) as Promise<void>;
  }

  /**
   * Send a GroupValue_Response telegram to a group address.
   * @param destination The group address (e.g., "1/1/1")
   * @param dpt Datapoint Type to help with encoding.
   * @param value The value to respond with.
   */
  public async respond<T extends (typeof KnxDataEncoder.dptEnum)[number] | string | null>(
    destination: string,
    dpt: T,
    value: AllDpts<T>,
  ): Promise<void> {
    let data: Buffer;
    let isShort = false;
    if (dpt !== undefined) {
      data = KnxDataEncoder.encodeThis(dpt, value);
      isShort = KnxDataEncoder.isShortDpt(dpt);
    } else if (typeof value === "boolean") {
      data = Buffer.from([value ? 1 : 0]);
      isShort = true;
    } else if (Buffer.isBuffer(value)) {
      data = value;
      isShort = data.length === 1 && data[0] <= 0x3f;
    } else if (typeof value === "number") {
      data = Buffer.from([value]);
      isShort = value <= 0x3f;
    } else {
      throw new Error("Cannot encode value without DPT or basic type (boolean/number/Buffer)");
    }

    const cf1 = new ControlField(0xbc);
    const cf2 = new ExtendedControlField(0xe0);
    const tpdu = new TPDU(
      new TPCI(TPCIType.T_DATA_GROUP_PDU),
      new APDU(
        new TPCI(TPCIType.T_DATA_GROUP_PDU),
        new APCI(APCIEnum.A_GroupValue_Response_Protocol_Data_Unit),
        data,
        isShort,
      ),
      data,
    );

    const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, this.individualAddress, destination, tpdu);
    this.logger.debug({ service: cemi.constructor.name }, "Sending GroupValue_Response");

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
        Buffer.alloc(1),
        true,
      ),
      Buffer.alloc(1),
    );

    const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](null, cf1, cf2, this.individualAddress, destination, tpdu);

    return this.send(cemi) as Promise<void>;
  }
}
