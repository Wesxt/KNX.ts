import { ControlField } from "../../core/ControlField";
import { Priority } from "../../core/enum/EnumControlField";
import { AddressType } from "../../core/enum/EnumControlFieldExtended";
import { SAP } from "../../core/enum/SAP";
import { APCI } from "../../core/layers/interfaces/APCI";
import { SystemStatus, Status } from "../../core/SystemStatus";

export type bits4 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PEI_Switch_req {
  systemStatus: SystemStatus;
  LL: bits4;
  NL: bits4;
  TLG: bits4;
  TLC: bits4;
  TLL: bits4;
  AL: bits4;
  MAN: bits4;
  PEI: bits4;
  USR: bits4;
  res: bits4;
}

export interface L_Busmon_ind {
  status: Status;
  timeStamp: number;
  controlField1: ControlField; // Control field 1
  /**
   * Data Link Protocol Data Unit (LPDU) - This is the actual data payload of the message.
   * It contains the information that is being monitored on the bus.
   *
   * For example, a telegram might contain a control field, a source address, a destination address, and the actual data being transmitted.
   */
  LPDU: Buffer;
}

/**
 * It shall be possible to send up to 28 octets of plain data by this service.
 *
 * In “time” optionally a time delay before sending the message on the bus can be specified. If
 * “time”=00000000h the frame shall be sent immediately. Otherwise the frame shall be sent if the free
 * running system counter of the sending device equals the value given in “time”.
 */
export interface L_Plain_Data_req {
  time: number;
  data: Buffer;
}

/**
 * The NPDU shall correspond to the LPDU of an L_Data-Frame without the Control Field, Source
 * Address, Destination Address, Address Type Flag and the octet count.
 *
 * As far as is understood, for example in octet 5 of the L_Data_Standard Frame of the TP1 medium the NPCI corresponds to the hop count which is 3 bits
 */
export type NPCI = 0 | 1 | 2 | 3 | 4 | 6 | 7;

export interface L_Data_req {
  control: {
    priority: Priority;
    ackRequest: boolean;
  };
  destinationAddress: string;
  addressType: AddressType;
  NPCI: NPCI;
  NPDU: Buffer;
}

export interface L_Data_con {
  control: {
    priority: Priority;
    /**
     * This Confirm flag shall indicate whether this L_Data.con is a positive
     * confirmation or a negative confirmation
     *
     * - false - This shall be a positive confirmation.
     *
     * - true - This shall be a negative confirmation.
     */
    confirm: boolean;
  };
  destinationAddress: string;
  addressType: AddressType;
  NPCI: NPCI;
  NPDU: Buffer;
}

export interface L_Data_ind extends Omit<L_Data_req, "control"> {
  sourceAddress: string;
  control: {
    priority: Priority;
  };
}

export interface L_Poll_Data_Req {
  pollingGroup: number;
  nrOfSlots: bits4;
}

export interface L_Poll_Data_Con {
  pollingGroup: number;
  nrOfSlots: bits4;
  control: {
    confirm: boolean;
  };
}

export interface L_SystemBroadcast_req {
  destinationAddress: string;
  addressType: 1 | 0;
  NPCI: NPCI;
  control: L_Data_con["control"] & {
    /**
     * This flag shall indicate whether a Data Link Layer acknowledge shall be requested when the frame is transmitted on KNX or whether this is don’t care.
     * - false = Don't care
     * - true = no L2-acknowledge requested
     */
    ackRequest: boolean;
  };
  NPDU: Buffer;
}

export interface L_SystemBroadcast_con extends Omit<L_Data_con, "control"> {
  control: {
    notRepeat: boolean;
    priority: Priority;
    /**
     * This Confirm flag shall indicate whether this L_Data.con is a positive
     * confirmation or a negative confirmation
     *
     * - false - This shall be a positive confirmation.
     *
     * - true - This shall be a negative confirmation.
     */
    confirm: boolean;
  };
}

export interface L_SystemBroadcast_ind extends L_SystemBroadcast_con {
  sourceAddress: string;
}

// Interfaces for constructor values for the Network Layer messages
export interface N_Data_Individual_req_Ctor {
  control: {
    frameType: boolean;
    repeat: boolean;
    systemBroadcast: boolean;
    priority: Priority;
    ackRequest: boolean;
    confirm: boolean;
  };
  destinationAddress: string; // Individual address
  TPDU: Buffer; // Application Protocol Data Unit
}

export interface N_Data_Individual_con_Ctor {
  control: {
    confirm: boolean;
  };
  destinationAddress: string; // Individual address
  TPDU: Buffer;
}

export interface N_Data_Individual_ind_Ctor {
  control: {
    priority: number; // 0-3
  };
  sourceAddress: string; // Individual address
  destinationAddress: string; // Individual address
  hopCount: number; // 4 bits (formerly NPCI)
  TPDU: Buffer;
}

export interface N_Data_Group_req_Ctor {
  control: {
    priority: number; // 0-3
  };
  destinationAddress: string; // Group address
  APDU: Buffer;
}

export interface N_Data_Group_con_Ctor {
  control: {
    confirm: boolean;
  };
  destinationAddress: string; // Group address
  APDU: Buffer;
}

export interface N_Data_Group_ind_Ctor {
  control: {
    priority: number; // 0-3
  };
  sourceAddress: string; // Individual address
  destinationAddress: string; // Group address
  hopCount: number; // 4 bits (formerly NPCI)
  APDU: Buffer;
}

export interface N_Data_Broadcast_req_Ctor {
  control: {
    priority: number; // 0-3
  };
  hopCountType: NPCI;
  TPDU: Buffer;
}

export interface N_Data_Broadcast_con_Ctor {
  control: {
    confirm: boolean;
  };
  TPDU: Buffer;
}

export interface N_Data_Broadcast_ind_Ctor {
  control: {
    priority: number; // 0-3
  };
  sourceAddress: string; // Individual address
  hopCount: number; // 4 bits (formerly NPCI)
  TPDU: Buffer;
}

export interface N_Poll_Data_Req {
  pollingGroup: string; // 16 bits
  nrOfSlots: bits4; // 4 bits
}

export interface N_Poll_Data_Con {
  pollingGroup: string; // 16 bits
  nrOfSlots: bits4; // 4 bits
  pollData: Buffer; // Polled data
}

export interface T_Connect_req {
  destinationAddress: string;
}

export interface T_Connect_ind {
  sourceAddress: string;
  control: Omit<InstanceType<typeof ControlField>, "describe" | "buffer">;
}

export interface T_Disconnect_con {
  control: Omit<InstanceType<typeof ControlField>, "describe" | "buffer">;
}

export interface T_Data_Connected_req {
  control: {
    priority: InstanceType<typeof ControlField>["priority"];
  };
  hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  APDU: Buffer;
}

export interface T_Data_Connected_con {
  control: { confirm: boolean };
  APDU: Buffer;
}
export interface T_Data_Connected_ind {
  control: { priority: number };
  sourceAddress: string;
  APDU: Buffer;
  hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
}
export interface T_Data_Group_req {
  control: { priority: number };
  APDU: Buffer;
  hopCount: number;
}
export interface T_Data_Group_con {
  control: { confirm: boolean };
  data: Buffer;
}
export interface T_Data_Group_ind {
  control: { priority: number };
  APDU: Buffer;
}
export interface T_Data_Individual_req {
  control: { priority: number };
  destinationAddress: string;
  APDU: Buffer;
  hopCount: number;
}
export interface T_Data_Individual_con {
  control: { confirm: boolean };
  destinationAddress: string;
  APDU: Buffer;
}
export interface T_Data_Individual_ind {
  control: { priority: number };
  sourceAddress: string;
  destinationAddress: string;
  APDU: Buffer;
  hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
}
export interface T_Data_Broadcast_req {
  control: { priority: number };
  APDU: Buffer;
  hopCount: number;
}
export interface T_Data_Broadcast_con {
  control: { confirm: boolean };
  APDU: Buffer;
}
export interface T_Data_Broadcast_ind {
  control: { priority: number };
  sourceAddress: string;
  APDU: Buffer;
  hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
}
export interface T_Poll_Data_req {
  control: any;
  pollingGroup: string;
  numberOfSlots: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
}
export interface T_Poll_Data_con {
  control: any;
  sourceAddress: string;
  pollingGroup: string;
  pollData: Buffer;
  nrOfSlots: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
}
export interface M_Connect_ind {
  sourceAddress: string;
}
export interface M_User_Data_Connected_req {
  control: { priority: number };
  APDU: Buffer;
  hopCount: number;
}
export interface M_User_Data_Connected_con {
  control: { confirm: boolean };
  APDU: Buffer;
}
export interface M_User_Data_Connected_ind {
  control: { priority: number };
  sourceAddress: string;
  APDU: Buffer;
}
export interface A_Data_Group_req {
  control: { priority: number };
  sap: SAP;
  apci: APCI;
  data: Buffer;
  hopCount: number;
}
export interface A_Data_Group_con {
  control: { confirm: boolean };
  sap: SAP;
  apci: APCI;
  data: Buffer;
}
export interface A_Data_Group_ind {
  control: { priority: number };
  sap: SAP;
  apci: APCI;
  data: Buffer;
}
export interface M_User_Data_Individual_req {
  control: { priority: number };
  destinationAddress: string;
  data: Buffer;
  hopCount: number;
}
export interface M_User_Data_Individual_con {
  control: { confirm: boolean };
  destinationAddress: string;
  data: Buffer;
}
export interface M_User_Data_Individual_ind {
  control: { priority: number };
  sourceAddress: string;
  destinationAddress: string;
  data: Buffer;
}
export interface A_Poll_Data_req {
  pollingGroup: string;
  numberOfSlots: number;
}
export interface A_Poll_Data_con {
  sourceAddress: string;
  pollingGroup: string;
  numberOfSlots: number;
  pollData: Buffer;
}
