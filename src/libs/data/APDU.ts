import { KNXHelper } from "../utils/class/KNXHelper";
import { APCI } from "./APCI";
import { ServiceMessage } from "./EMI";
import { APCIEnum } from "./enum/APCIEnum";
import { TPCI, TPCIType } from "./TPCI";

/**
 * This is the Application Protocol Data Unit (TPDU).
 * - **Warning**: This class is practically the same implementation as the TPDU. It's structured this way because of how APCI is implemented in the code, which depends on the byte responsible for TPCI.
 * - **Warning**: It is completely arbitrary to use it as an APDU or as a TPDU; however, according to the specification, this is exactly like a TPDU.
 */
export class APDU implements ServiceMessage {
  _tpci: TPCI;
  _apci: APCI;
  _data: Buffer;

  constructor(
    tpci: TPCI = new TPCI(TPCIType.T_DATA_GROUP_PDU),
    apci: APCI = new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit),
    data: Buffer = Buffer.alloc(0)
  ) {
    this._tpci = tpci;
    this._apci = apci;
    this._data = data;
  }

  get length(): number {
    return KNXHelper.GetDataLength(this._data);
  }

  /**
   * Devuelve un buffer con TPCI/APCI + data
   */
  toBuffer(): Buffer {
    const buffer = Buffer.alloc(1 + (this._data.length > 0 ? this._data.length : 1));
    const packNumber = this._apci.packNumber();
    this._tpci.first2bitsOfAPCI = packNumber[0];
    buffer[0] = this._tpci.getValue();
    buffer[1] = packNumber[1];
    KNXHelper.WriteData(buffer, this._data, 1);
    return buffer;
  }

  describe() {
    return {
      layer: "Application Layer (APDU)",
      tpci: this._tpci.describe(),
      apci: this._apci.describe(),
      data: this._data,
    };
  }
}
