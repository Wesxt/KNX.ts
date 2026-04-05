import { CEMI, CEMIInstance } from "../CEMI";
import { APCIEnum } from "../enum/APCIEnum";
import { KNXService } from "../../connection/KNXService";
import { KnxDataDecode } from "../data/KNXDataDecode";
import { KnxDataEncoder } from "../data/KNXDataEncode";
import { Router } from "../../connection/Router";
import { IndicationRouterLink } from "../../@types/interfaces/connection";

export interface CacheEntry {
  cemi: CEMIInstance;
  timestamp: Date;
  groupAddress: string;
  decodedValue?: any;
}

export class GroupAddressCache {
  private static instance: GroupAddressCache;

  private enabled: boolean = false;
  /**
   * Maximum number of group addresses to cache. Default is 65535 (all possible group addresses).
   */
  private maxAddresses: number = 65535;
  /**
   * Maximum number of messages to cache per group address. Default is 10.
   */
  private maxMessagesPerAddress: number = 10;

  private cache: Map<string, CacheEntry[]> = new Map();
  private dptConfig: Map<string, string | number> = new Map();

  private constructor() {}

  public static getInstance(): GroupAddressCache {
    if (!GroupAddressCache.instance) {
      GroupAddressCache.instance = new GroupAddressCache();
    }
    return GroupAddressCache.instance;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public configure(maxAddresses: number, maxMessagesPerAddress: number = 10): void {
    this.maxAddresses = maxAddresses;
    this.maxMessagesPerAddress = maxMessagesPerAddress;
  }

  public setAddressDPT(address: string, dpt: string | number): void {
    this.dptConfig.set(address, dpt);
  }

  public getAddressDPT(address: string): string | number | undefined {
    return this.dptConfig.get(address);
  }

  public encodeValue(address: string, value: any): Buffer | null {
    const dpt = this.dptConfig.get(address);
    if (!dpt) return null;
    try {
      return KnxDataEncoder.encodeThis(dpt as any, value);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      return null;
    }
  }

  /**
   * Processes an incoming CEMI message. If caching is enabled, saves the last messages
   * indicating a GroupValue_Read or GroupValue_Response targeted to a Group Address.
   */
  public processCEMI(cemi: CEMIInstance): void {
    if (!("controlField2" in cemi) || !("TPDU" in cemi)) return;
    if (!this.enabled) return;

    if (cemi.controlField2?.addressType !== 1) {
      return; // Not a group address
    }

    const apciObj = cemi.TPDU.apdu.apci;
    if (!apciObj) return;

    const apci = apciObj;
    if (
      apci.value !== APCIEnum.A_GroupValue_Read_Protocol_Data_Unit &&
      apci.value !== APCIEnum.A_GroupValue_Response_Protocol_Data_Unit
    ) {
      return;
    }

    const targetAddress = cemi.destinationAddress;
    if (!targetAddress) return;

    // Initialize list if needed
    if (!this.cache.has(targetAddress)) {
      if (this.cache.size >= this.maxAddresses) {
        // Enforce max addresses limit (naive approach: evict oldest entry by insertion order)
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
        }
      }
      this.cache.set(targetAddress, []);
    }

    const entries = this.cache.get(targetAddress)!;

    let decodedValue: any = undefined;
    const dpt = this.dptConfig.get(targetAddress);
    if (dpt && cemi.TPDU.apdu.data) {
      try {
        decodedValue = KnxDataDecode.decodeThis(dpt as any, cemi.TPDU.apdu.data);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (err) {
        // failed to decode
      }
    }

    // Create new entry
    const entry: CacheEntry = {
      cemi: cemi,
      timestamp: new Date(),
      groupAddress: targetAddress,
      decodedValue: decodedValue,
    };

    // Insert at front
    entries.unshift(entry);

    // Trim length
    if (entries.length > this.maxMessagesPerAddress) {
      entries.length = this.maxMessagesPerAddress;
    }
  }

  /**
   * Clears the entire cache map.
   */
  public clear(): void {
    this.cache.clear();
  }

  /**
   * Deletes a specific address from the cache.
   * @param address KNX Group Address e.g. '1/2/3'
   */
  public deleteAddress(address: string): boolean {
    return this.cache.delete(address);
  }

  /**
   * Core query method to retrieve messages for given address(es) within a time range.
   * If dates aren't specified, retrieves all currently cached items depending on the query payload.
   * By default, it retrieves the absolute latest if neither startDate nor endDate are applied.
   */
  public query(
    addresses: string | string[],
    startDate?: Date,
    endDate: Date = new Date(),
    returnOnlyLatest: boolean = true,
  ): CacheEntry[] {
    const addressArray = Array.isArray(addresses) ? addresses : [addresses];
    const results: CacheEntry[] = [];

    for (const address of addressArray) {
      const entries = this.cache.get(address) || [];
      if (entries.length === 0) continue;

      if (!startDate) {
        // If no start date, we return the very latest (index 0) if default or requested
        if (returnOnlyLatest) {
          results.push(entries[0]);
        } else {
          // Or return everything relative to the endDate
          results.push(...entries.filter((e) => e.timestamp <= endDate));
        }
      } else {
        // Filter by date range
        const validEntries = entries.filter((e) => e.timestamp >= startDate && e.timestamp <= endDate);
        if (returnOnlyLatest && validEntries.length > 0) {
          results.push(validEntries[0]);
        } else {
          results.push(...validEntries);
        }
      }
    }

    return results;
  }

  /**
   * Prompts the KNXService to issue an A_GroupValue_Read to the bus on the specified address
   * and awaits an A_GroupValue_Response. The response is automatically processed via standard
   * listeners (if processCEMI is hooked properly), but this method attaches an event
   * one-off listener or handles resolving it.
   */
  public async readDirectAsync(
    address: string,
    serviceContext: KNXService | Router,
    timeoutMs: number = 3000,
  ): Promise<CacheEntry | null> {
    return new Promise<CacheEntry | null>((resolve, reject) => {
      // eslint-disable-next-line prefer-const
      let timer: NodeJS.Timeout;
      const isRouter = serviceContext instanceof Router;
      // Listener context reference to intercept indications specifically for this read call
      const listener = (
        data: InstanceType<(typeof CEMI)["DataLinkLayerCEMI"]["L_Data.ind"]> | IndicationRouterLink,
      ) => {
        const cemi = "msg" in data ? data.msg : data;
        if (
          "controlField2" in cemi &&
          "TPDU" in cemi &&
          cemi.controlField2?.addressType === 1 &&
          cemi.destinationAddress === address
        ) {
          const apciObj = cemi.TPDU.apdu.apci;
          if (apciObj && apciObj.value === APCIEnum.A_GroupValue_Response_Protocol_Data_Unit) {
            // Clean up
            clearTimeout(timer);
            if (isRouter) {
              serviceContext.off("indication_link", listener);
            } else {
              serviceContext.off("indication", listener);
            }

            // Ensure caching happens if not processed previously (if processCEMI wasn't hooked at higher layer for some reason)
            this.processCEMI(cemi);

            // Find in cache
            const entries = this.cache.get(address);
            if (entries && entries.length > 0 && entries[0].cemi === cemi) {
              resolve(entries[0]);
            } else {
              // Return mock CacheEntry if cache processing was disabled or failed
              let decodedValue: any = undefined;
              const dpt = this.dptConfig.get(address);
              if (dpt && cemi.TPDU.apdu.data) {
                try {
                  decodedValue = KnxDataDecode.decodeThis(dpt as any, cemi.TPDU.apdu.data);
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                } catch (e) {
                  // empty
                }
              }

              resolve({
                cemi: cemi,
                timestamp: new Date(),
                groupAddress: address,
                decodedValue: decodedValue,
              });
            }
          }
        }
      };

      if (isRouter) {
        serviceContext.on("indication_link", listener);
      } else {
        // Set explicit listener on the service context
        serviceContext.on("indication", listener);
      }

      // Start the timer to abort request
      timer = setTimeout(() => {
        if (isRouter) {
          serviceContext.off("indication_link", listener);
        } else {
          serviceContext.off("indication", listener);
        }
        reject(new Error(`Timeout of ${timeoutMs}ms exceeded while waiting for GroupValue_Response on ${address}`));
      }, timeoutMs);

      // Issue the command to the bus
      serviceContext.read(address).catch((err) => {
        clearTimeout(timer);
        if (isRouter) {
          serviceContext.off("indication_link", listener);
        } else {
          serviceContext.off("indication", listener);
        }
        reject(err);
      });
    });
  }
}
