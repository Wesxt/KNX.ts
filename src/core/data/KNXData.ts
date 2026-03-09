import { KnxDataDecode } from "./KNXDataDecode";
import { KnxDataEncoder } from "./KNXDataEncode";

export abstract class KNXData {
  /**
   * Normaliza el formato del DPT (número o string tipo "1.001") a su valor numérico interno.
   */
  protected static getDptNumber<T>(dpt: T) {
    if (typeof dpt === "number") return dpt;
    if (typeof dpt === "string") {
      if (dpt.includes(".")) {
        const parts = dpt.split(".");
        return parseInt(parts[0], 10) * 1000 + parseInt(parts[1], 10);
      }
      return parseInt(dpt, 10);
    }
    return null;
  }

  protected static fallbackDPT(dptNum: number) {
    if (!((this as unknown as typeof KnxDataDecode | typeof KnxDataEncoder).dptEnum).includes(dptNum as any)) {
      const fallback = Math.floor(dptNum / 1000);
      if (((this as unknown as typeof KnxDataDecode | typeof KnxDataEncoder).dptEnum).includes(fallback as any)) {
        dptNum = fallback;
      }
    }
    return dptNum;
  }

}