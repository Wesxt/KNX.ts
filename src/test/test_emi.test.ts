import { inspect } from "util";
import { ControlField } from "../core/ControlField";
import { KnxDataEncoder } from "../core/data/KNXDataEncode";
import { EMI } from "../core/EMI";
import { APCIEnum } from "../core/enum/APCIEnum";
import { Priority } from "../core/enum/EnumControlField";
import { APDU } from "../core/layers/data/APDU";
import { NPDU } from "../core/layers/data/NPDU";
import { TPDU } from "../core/layers/data/TPDU";
import { APCI } from "../core/layers/interfaces/APCI";
import { TPCI } from "../core/layers/interfaces/TPCI";
import { CEMI } from "../core/CEMI";
import { ExtendedControlField } from "../core/ControlFieldExtended";

const controlField = new ControlField(0xbc);
const value = KnxDataEncoder.encodeThis("5", { valueDpt5: 100 });
const emi = new EMI.DataLinkLayerEMI["L_Data.req"](
  controlField,
  "0/0/1",
  new NPDU(
    new TPDU(
      new TPCI(),
      new APDU(
        undefined,
        new APCI(),
        value,
      ),
      value,

    ),
  ),
);

console.log("EMI", inspect(emi, { depth: Infinity, colors: true }));
console.log(emi.toBuffer());

console.log("===============================");

const cemi = new CEMI.DataLinkLayerCEMI["L_Data.req"](
  null,
  controlField,
  new ExtendedControlField(),
  "0.0.0",
  "0/0/1",
  new TPDU(
    new TPCI(),
    new APDU(
      undefined,
      new APCI(),
      value,
    ),
    value,
  )
);

console.log("CEMI", inspect(cemi, { depth: Infinity, colors: true }));
console.log(cemi.toBuffer());