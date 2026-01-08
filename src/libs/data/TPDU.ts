import { APDU } from "./APDU";
import { TPCI, TPCIType } from "./TPCI";
import { ServiceMessage } from "./EMI";

export class TPDU implements ServiceMessage {
  private _tpci: TPCI;
  private _apdu: APDU;

  constructor(tpci: TPCI = new TPCI(TPCIType.T_DATA_GROUP_PDU), apdu: APDU = new APDU()) {
    this._tpci = tpci;
    this._apdu = apdu;
    this._apdu._tpci = tpci; // Es necesario que lo tenga para la codificación del APCI
  }

  get length(): number {
    // longitud del APDU con TPCI
    return this._apdu.length;
  }

  toBuffer(): Buffer {}

  describe(): any {
    return {
      layer: "Transport Layer (TPDU)",
      tpci: this._tpci.describe(),
      APDU: this._apdu.describe(),
    };
  }
}
