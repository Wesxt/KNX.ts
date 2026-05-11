/* eslint-disable @typescript-eslint/no-unused-vars */
class A {
  a: string = "";
}
class B {
  b: number = 0;
}
class C {
  c: boolean = true;
}

const CEMI = {
  Group1: {
    A: A,
    B: B,
  },
  Group2: {
    C: C,
  },
  fromBuffer: (buf: any) => {},
};

type KeysOfCEMI = "Group1" | "Group2";

type CEMITypeDirty = (typeof CEMI)[keyof typeof CEMI];
// This includes the fromBuffer function!

// Correct way to get all classes from all groups
type CEMIClasses = { [K in KeysOfCEMI]: (typeof CEMI)[K][keyof (typeof CEMI)[K]] }[KeysOfCEMI];

type CEMIInstance = InstanceType<CEMIClasses>;

// Let's see if CEMIInstance is A | B | C.
// I'll check with a variable.
const x: CEMIInstance = new A();
