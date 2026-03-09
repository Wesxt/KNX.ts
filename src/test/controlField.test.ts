import { ControlField } from "../core/ControlField";
import { ExtendedControlField } from "../core/ControlFieldExtended";

const cf1 = new ControlField(0xbc);

console.log(cf1.constructor.name, cf1.describe());

const cf2 = new ExtendedControlField(0xe0);

cf2.addressType = 0;

console.log(cf2.constructor.name, cf2.describe());