import { KNXHelper } from "../utils/class/KNXHelper";
import { Priority } from "./enum/EnumControlField";
import { AddressType } from "./enum/EnumControlFieldExtended";
import { ControlField } from "./ControlField";
import { MESSAGE_CODE_FIELD } from "./MessageCodeField";

interface DescribeEstructure {
  /**
   * Proporciona una descripción legible del estado actual de las propiedades del sistema.
   * @returns Un objeto que describe el estado de cada propiedad.
   */
  describe(): Record<string, string | number | Buffer | Record<string, any>>;
}

interface ServiceMessage extends DescribeEstructure {
  /** Write the service to the buffer */
  toBuffer(): Buffer;
}

interface SystemStatusValues {
  PROG?: false; // PROG should always be false as per your original logic
  LLM?: boolean;
  TLE?: boolean;
  ALE?: boolean;
  SE?: boolean;
  UE?: boolean;
  DM?: false; // DM should always be false as per your original logic
  PARITY?: boolean;
}

/**
 * In EMI1, layers shall be accessed by writing to the memory location “system status”. Locally this shall be
 * done by the PC_Set_Value.req service, remotely by the service A_Memory_Read.
 *
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - External Message Interface
 * @version 01.04.02 is a KNX Approved Standard.
 */
class SystemStatus implements DescribeEstructure {
  constructor(value: SystemStatusValues) {
    if (typeof value !== 'object' || value === null) {
      throw new Error("System status must be an object with specific properties.");
    }
    const allowedKeys = [
      'PROG', 'LLM', 'TLE', 'ALE', 'SE', 'UE', 'DM', 'PARITY'
    ];

    const invalidKeys = Object.keys(value).filter(key => !allowedKeys.includes(key));
    if (invalidKeys.length > 0) {
      throw new Error(`Invalid keys in system status: ${invalidKeys.join(', ')}`);
    }

    // Initialize with default false values (0 in bit representation)
    this.PROG = value.PROG ?? false;
    this.LLM = value.LLM ?? false;
    this.TLE = value.TLE ?? false;
    this.ALE = value.ALE ?? false;
    this.SE = value.SE ?? false;
    this.UE = value.UE ?? false;
    this.DM = value.DM ?? false;
    this.PARITY = value.PARITY ?? false;
  }

  #value: number = 0;

  get value(): number {
    return this.#value;
  }

  set value(newValue: number) {
    if (newValue < 0 || newValue > 255) {
      throw new Error("System status value must be between 0 and 255.");
    }
    this.#value = newValue;
  }

  set PROG(value: false) {
    if (value !== false) {
      throw new Error("PROG value must be false, as it's not used.");
    }
    // No change to #value as PROG is always 0 (false)
  }

  get PROG(): boolean {
    return false; // PROG is always false
  }

  /**
   * enable Busmonitor mode
   * true = disabled, false = enabled
   * @param value boolean
   */
  set LLM(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("LLM value must be a boolean.");
    }
    this.#value = (this.#value & 0xFD) | ((value ? 1 : 0) << 1);
  }

  get LLM(): boolean {
    return ((this.#value >> 1) & 0x01) === 1;
  }

  /**
   * enable Transport Layer
   * true = enabled, false = disabled
   * @param value boolean
   */
  set TLE(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("TLE value must be a boolean.");
    }
    this.#value = (this.#value & 0xFB) | ((value ? 1 : 0) << 2);
  }

  get TLE(): boolean {
    return ((this.#value >> 2) & 0x01) === 1;
  }

  /**
   * enable Application Layer
   * true = enabled, false = disabled
   * @param value boolean
   */
  set ALE(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("ALE value must be a boolean.");
    }
    this.#value = (this.#value & 0xF7) | ((value ? 1 : 0) << 3);
  }

  get ALE(): boolean {
    return ((this.#value >> 3) & 0x01) === 1;
  }

  /**
   * enable PEI
   * true = enabled, false = disabled
   * @param value boolean
   */
  set SE(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("SE value must be a boolean.");
    }
    this.#value = (this.#value & 0xEF) | ((value ? 1 : 0) << 4);
  }

  get SE(): boolean {
    return ((this.#value >> 4) & 0x01) === 1;
  }

  /**
   * enable user program
   * true = enabled, false = disabled
   * @param value boolean
   */
  set UE(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("UE value must be a boolean.");
    }
    this.#value = (this.#value & 0xDF) | ((value ? 1 : 0) << 5);
  }

  get UE(): boolean {
    return ((this.#value >> 5) & 0x01) === 1;
  }

  /**
   * DM is always disabled (false)
   * @param value false
   */
  set DM(value: false) {
    if (value !== false) {
      throw new Error("DM value must be false, as it's not used.");
    }
    // No change to #value as DM is always 0 (false)
  }

  get DM(): boolean {
    return false; // DM is always false
  }

  /**
   * true = even parity for the “system status” octet, false = disabled
   * @param value boolean
   */
  set PARITY(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("PARITY value must be a boolean.");
    }
    this.#value = (this.#value & 0x7F) | ((value ? 1 : 0) << 7);
  }

  get PARITY(): boolean {
    return ((this.#value >> 7) & 0x01) === 1;
  }

  /**
 * Proporciona una descripción legible del estado actual de las propiedades del sistema.
 * @returns Un objeto que describe el estado de cada propiedad.
 */
  describe() {
    return {
      PROG: `Programación: ${this.PROG ? 'Activo' : 'Inactivo (fijo a inactivo)'}`,
      LLM: `Modo Busmonitor: ${this.LLM ? 'Desactivado' : 'Activado'}`, // 1 = disabled, 0 = enabled
      TLE: `Capa de Transporte: ${this.TLE ? 'Activado' : 'Desactivado'}`,
      ALE: `Capa de Aplicación: ${this.ALE ? 'Activado' : 'Desactivado'}`,
      SE: `PEI: ${this.SE ? 'Activado' : 'Desactivado'}`,
      UE: `Programa de Usuario: ${this.UE ? 'Activado' : 'Desactivado'}`,
      DM: `DM: ${this.DM ? 'Activo' : 'Inactivo (fijo a inactivo)'}`, // 1 = enabled, 0 = disabled (fijo a 0)
      PARITY: `Paridad: ${this.PARITY ? 'Paridad par (activada)' : 'Desactivada'}`,
      rawValue: `Valor numérico: ${this.#value}`
    };
  }
}

interface StatusValues {
  frameError: boolean;
  bitError: boolean;
  parityError: boolean;
  overflow: boolean;
  lost: boolean;
  sequenceNumber: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

class Status implements DescribeEstructure {
  constructor(value: StatusValues) {
    if (typeof value !== 'object' || value === null) {
      throw new Error("Status must be an object with specific properties.");
    }
    const allowedKeys = [
      "frameError",
      "bitError",
      "parityError",
      "overflow",
      "lost",
      "sequenceNumber"
    ] as const;

    for (const key of allowedKeys) {
      if (!(key in value)) {
        throw new Error(`Missing property: ${key}`);
      }
    }

    this.frameError = value.frameError;
    this.bitError = value.bitError;
    this.parityError = value.parityError;
    this.overflow = value.overflow;
    this.lost = value.lost;
    this.sequenceNumber = value.sequenceNumber;
  }

  #value: number = 0;

  set value(newValue: number) {
    if (newValue < 0 || newValue > 255) {
      throw new Error("Status value must be between 0 and 255.");
    }
    this.#value = newValue;
  }

  get value(): number {
    return this.#value;
  }


  /**
   * A frame error was detected in one or several of the frame bits.
   */
  set frameError(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("frameError must be a boolean.");
    }
    this.#value = (this.#value & 0x7F) | ((value ? 1 : 0) << 7);
  }

  get frameError(): boolean {
    return ((this.#value >> 7) & 0x01) === 1;
  }

  /**
   * An invalid bit is detected in one or several of the frame characters.
   */
  set bitError(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("bitError must be a boolean.");
    }
    this.#value = (this.#value & 0xBF) | ((value ? 1 : 0) << 6);
  }

  get bitError(): boolean {
    return ((this.#value >> 6) & 0x01) === 1;
  }

  /**
   * An invalid parity bit was detected in one or several of the frame bits.
   */
  set parityError(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("parityError must be a boolean.");
    }
    this.#value = (this.#value & 0xDF) | ((value ? 1 : 0) << 5);
  }

  get parityError(): boolean {
    return ((this.#value >> 5) & 0x01) === 1;
  }

  /**
   * The overflow flag is set.
   */
  set overflow(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("overflow must be a boolean.");
    }
    this.#value = (this.#value & 0xEF) | ((value ? 1 : 0) << 4);
  }

  get overflow(): boolean {
    return ((this.#value >> 4) & 0x01) === 1;
  }

  /**
   * The Lost flag shall be set if at least one frame or frame piece is lost by
   * the Busmonitor
   * 
   * **Note:** The difference between the sequence number of the previous
   * BUSMON.ind without lost flag set and the sequence number of the BUSMON.ind
  with lost flag set may not reflect exactly the number of lost frames or frame pieces.
   */
  set lost(value: boolean) {
    if (typeof value !== 'boolean') {
      throw new Error("lost must be a boolean.");
    }
    this.#value = (this.#value & 0xF7) | ((value ? 1 : 0) << 3);
  }

  get lost(): boolean {
    return ((this.#value >> 3) & 0x01) === 1;
  }

  /**
   * Each received frame shall let the Data Link Layer increment the modulo
   * 8 value of the sequence number. The least significant bit of octet 2 shall
   * also be the least significant bit of the sequence number.
   */
  set sequenceNumber(value: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7) {
    if (value < 0 || value > 7) {
      throw new Error("sequenceNumber must be between 0 and 7.");
    }
    this.#value = (this.#value & 0xF8) | value;
  }

  get sequenceNumber(): 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | number {
    return this.#value & 0x07;
  }

  describe() {
    return {
      frameError: `Error de trama: ${this.frameError ? 'Detectado' : 'No detectado'}`,
      bitError: `Error de bit: ${this.bitError ? 'Detectado' : 'No detectado'}`,
      parityError: `Error de paridad: ${this.parityError ? 'Detectado' : 'No detectado'}`,
      overflow: `Desbordamiento: ${this.overflow ? 'Activado' : 'Desactivado'}`,
      lost: `Perdido: ${this.lost ? 'Activado' : 'Desactivado'}`,
      sequenceNumber: `Número de secuencia: ${this.sequenceNumber}`,
      rawValue: `Valor numérico: ${this.#value}`
    };
  }
}

type bits4 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface PEI_Switch_req {
  systemStatus: SystemStatus,
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

interface L_Busmon_ind {
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
interface L_Plain_Data_req {
  time: number;
  data: Buffer;
}

/**
 * The NPDU shall correspond to the LPDU of an L_Data-Frame without the Control Field, Source
 * Address, Destination Address, Address Type Flag and the octet count.
 * 
 * As far as is understood, for example in octet 5 of the L_Data_Standard Frame of the TP1 medium the NPCI corresponds to the hop count which is 3 bits
 */
type NPCI = 0 | 1 | 2 | 3 | 4 | 6 | 7

interface L_Data_req {
  control: {
    priority: Priority;
    ackRequest: boolean;
  }
  destinationAddress: string;
  addressType: AddressType,
  NPCI: NPCI;
  NPDU: Buffer;
}

interface L_Data_con extends Omit<L_Data_req, "control"> {
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
  }
}

interface L_Data_ind extends Omit<L_Data_req, "control"> {
  sourceAddress: string;
  control: {
    priority: Priority;
  }
}

interface L_Poll_Data_Req {
  pollingGroup: number;
  nrOfSlots: bits4;
}

type L_SystemBroadcast_req = L_Data_con

interface L_SystemBroadcast_con extends Omit<L_Data_con, "control"> {
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
  }
  destinationAddress: string;
}

interface L_SystemBroadcast_ind extends L_SystemBroadcast_con {
  sourceAddress: string;
}

// Interfaces for constructor values for the Network Layer messages
interface N_Data_Individual_req_Ctor {
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

interface N_Data_Individual_con_Ctor {
  control: {
    confirm: boolean;
  };
  destinationAddress: string; // Individual address
  TPDU: Buffer;
}

interface N_Data_Individual_ind_Ctor {
  control: {
    priority: number; // 0-3
  };
  sourceAddress: string; // Individual address
  destinationAddress: string; // Individual address
  hopCount: number; // 4 bits (formerly NPCI)
  TPDU: Buffer;
}

interface N_Data_Group_req_Ctor {
  control: {
    priority: number; // 0-3
  };
  destinationAddress: string; // Group address
  APDU: Buffer;
}

interface N_Data_Group_con_Ctor {
  control: {
    confirm: boolean;
  };
  destinationAddress: string; // Group address
  APDU: Buffer;
}

interface N_Data_Group_ind_Ctor {
  control: {
    priority: number; // 0-3
  };
  sourceAddress: string; // Individual address
  destinationAddress: string; // Group address
  hopCount: number; // 4 bits (formerly NPCI)
  APDU: Buffer;
}

interface N_Data_Broadcast_req_Ctor {
  control: {
    priority: number; // 0-3
  };
  APDU: Buffer;
}

interface N_Data_Broadcast_con_Ctor {
  control: {
    confirm: boolean;
  };
  TPDU: Buffer;
}

interface N_Data_Broadcast_ind_Ctor {
  control: {
    priority: number; // 0-3
  };
  sourceAddress: string; // Individual address
  hopCount: number; // 4 bits (formerly NPCI)
  APDU: Buffer;
}

interface N_Poll_Data_Req {
  pollingGroup: string; // 16 bits
  nrOfSlots: bits4; // 4 bits
}

interface N_Poll_Data_Con {
  pollingGroup: string; // 16 bits
  nrOfSlots: bits4; // 4 bits
  pollData: Buffer; // Polled data
}

interface T_Connect_req {
  destinationAddress: string;
}

interface T_Connect_ind {
  sourceAddress: string;
  control: Omit<InstanceType<typeof ControlField>, "describe" | "buffer">
}

interface T_Disconnect_con {
  control: Omit<InstanceType<typeof ControlField>, "describe" | "buffer">
}

interface T_Data_Connected_req {
  control: {
    priority: InstanceType<typeof ControlField>["priority"]
  };
  hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  APDU: Buffer
}

interface T_Data_Connected_con { control: { confirm: boolean; }; APDU: Buffer; }
interface T_Data_Connected_ind { control: { priority: number; }; sourceAddress: string; APDU: Buffer; hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}
interface T_Data_Group_req { control: { priority: number; }; APDU: Buffer; hopCount: number; }
interface T_Data_Group_con { control: { confirm: boolean; }; data: Buffer; }
interface T_Data_Group_ind { control: { priority: number; }; APDU: Buffer; }
interface T_Data_Individual_req { control: { priority: number; }; destinationAddress: string; APDU: Buffer; hopCount: number; }
interface T_Data_Individual_con { control: { confirm: boolean; }; destinationAddress: string; APDU: Buffer; }
interface T_Data_Individual_ind { control: { priority: number; }; sourceAddress: string; destinationAddress: string; APDU: Buffer; hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}
interface T_Data_Broadcast_req { control: { priority: number; }; APDU: Buffer; hopCount: number; }
interface T_Data_Broadcast_con { control: { confirm: boolean; }; APDU: Buffer; }
interface T_Data_Broadcast_ind { control: { priority: number; }; sourceAddress: string; APDU: Buffer; hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 }
interface T_Poll_Data_req { control: any, pollingGroup: string, numberOfSlots: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15}
interface T_Poll_Data_con { control: any, sourceAddress: string, pollingGroup: string, pollData: Buffer, nrOfSlots: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 }

class InvalidInputObject extends Error {
  constructor(className: string) {
    super(`The input object in the ${className} is must be an object with specific properties`)
  }
}

/**
 * Calcula el FCS (Frame Check Sequence) de un buffer KNX (sin incluir el FCS final)
 * @param buffer Buffer con el contenido del telegrama SIN el FCS
 * @returns Byte FCS calculado
 */
function checksum(buffer: Buffer): number {
  let fcs = 0x00;
  for (let i = 0; i < buffer.length; i++) {
    fcs ^= buffer[i];
  }
  return fcs;
}

/**
 * @alias External_Message_Interface
 * @description The External Message Interface (EMI) is a standardized interface for communication between external devices and KNX systems. It allows for the integration of various external systems, such as building management systems, into the KNX network.
 * @version Version 01.04.02 is a KNX Approved Standard.
 * 
 * TODO: Hay que hacer que los servicios tengan un metodo "describe" que devuelva un objecto con valores legibles
 * TODO: Hay que corregir que los Destination Address or Source Address peudadn ser Individual Address o Group Address
 * TODO: Hay que hacer un metodo estatico que reciba un buffer para instanciar el servicio
 * TODO: Hay que verificar el byte checksum y construirlo en todos los servicios
 */
export class EMI {
  constructor() { }

  LayerAccess = {
    "PEI_Switch.req": class PEISwitchReq implements ServiceMessage {
      constructor(value: PEI_Switch_req) {
        this.systemStatus = value.systemStatus;
        this.LL = value.LL;
        this.NL = value.NL;
        this.TLG = value.TLG;
        this.TLC = value.TLC;
        this.TLL = value.TLL;
        this.AL = value.AL;
        this.MAN = value.MAN;
        this.PEI = value.PEI;
        this.USR = value.USR;
        this.res = value.res;
      }

      messageCode = MESSAGE_CODE_FIELD["PEI_Switch.req"]["EMI2/IMI2"].value;
      systemStatus: SystemStatus
      #LL: bits4 = 0;
      #NL: bits4 = 0;
      #TLG: bits4 = 0;
      #TLC: bits4 = 0;
      #TLL: bits4 = 0;
      #AL: bits4 = 0;
      #MAN: bits4 = 0;
      #PEI: bits4 = 0;
      #USR: bits4 = 0;
      #res: bits4 = 0;

      set LL(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'LL' must be 4 bits");
        this.#LL = value
      }

      get LL() {
        return this.#LL
      }

      set NL(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'NL' must be 4 bits");
        this.#NL = value
      }

      get NL() {
        return this.#NL;
      }

      set TLG(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'TLG' must be 4 bits");
        this.#TLG = value
      }

      get TLG() {
        return this.#TLG
      }

      set TLC(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'TLC' must be 4 bits");
        this.#TLC = value
      }

      get TLC() {
        return this.#TLC
      }

      set TLL(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'TLL' must be 4 bits");
        this.#TLL = value
      }

      get TLL() {
        return this.#TLL
      }

      set AL(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'AL' must be 4 bits");
        this.#AL = value
      }

      get AL() {
        return this.#AL
      }

      set MAN(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'MAN' must be 4 bits");
        this.#MAN = value
      }

      get MAN() {
        return this.#MAN
      }

      set PEI(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'PEI' must be 4 bits");
        this.#PEI = value
      }

      get PEI() {
        return this.#PEI
      }

      set USR(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'USR' must be 4 bits");
        this.#USR = value
      }

      get USR() {
        return this.#USR
      }

      set res(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'res' must be 4 bits");
        this.#res = value
      }

      get res() {
        return this.#res
      }

      toBuffer(): Buffer {
        let octet3 = 0;
        octet3 = octet3 | (this.#LL << 4);
        octet3 = octet3 | this.#NL;
        let octet4 = 0;
        octet4 = octet4 | (this.#TLG << 4);
        octet4 = octet4 | this.#TLC;
        let octet5 = 0;
        octet5 = octet5 | (this.#TLL << 4);
        octet5 = octet5 | this.#AL
        let octet6 = 0;
        octet6 = octet6 | (this.#MAN << 4);
        octet6 = octet6 | this.#PEI;
        let octet7 = 0;
        octet7 = octet7 | (this.#USR << 4);
        octet7 = octet7 | this.#res;

        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.systemStatus.value, 1);
        buffer.writeUint8(octet3, 2);
        buffer.writeUint8(octet4, 3);
        buffer.writeUint8(octet5, 4);
        buffer.writeUint8(octet6, 5);
        buffer.writeUint8(octet7, 6);

        return buffer
      }
      describe(): Record<keyof PEI_Switch_req, string> {
        return {
          systemStatus: `${this.systemStatus.describe()}`,
          LL: this.#LL.toString(),
          NL: this.#NL.toString(),
          TLG: this.#TLG.toString(),
          TLC: this.#TLC.toString(),
          TLL: this.#TLL.toString(),
          AL: this.#AL.toString(),
          MAN: this.#MAN.toString(),
          PEI: this.#PEI.toString(),
          USR: this.#USR.toString(),
          res: this.#res.toString()
        }
      }
    }
  } as const;

  /**
   * In Busmonitor mode exactly the L_Busmon.ind message, the L_Plain_Data.req message, and the
   * LM_Reset.ind message shall be available.
   * 
   * **Note:** The LM_Reset.ind message is not implemented.
   */
  BusmonitorEMI = {
    "L_Busmon.ind": class LBusmonInd implements ServiceMessage {
      constructor(value: L_Busmon_ind) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("L_Busmon.ind must be an object with specific properties.");
        }
        // Initialize properties based on the value provided
        this.messageCode = MESSAGE_CODE_FIELD["L_Busmon.ind"]["EMI2/IMI2"].value;
        this.status = value.status;
        this.timeStamp = value.timeStamp;
        this.controlField1 = value.controlField1;
        this.LPDU = value.LPDU;
      }
      messageCode: number;
      status: Status;
      #timeStamp: number = 0;
      controlField1: ControlField;
      /**
       * Data Link Protocol Data Unit (LPDU) - This is the actual data payload of the message.
       * It contains the information that is being monitored on the bus.
       * 
       * For example, a telegram might contain a control field, a source address, a destination address, and the actual data being transmitted.
       */
      LPDU: Buffer;

      get timeStamp(): number {
        return this.#timeStamp;
      }

      set timeStamp(value: number) {
        if (typeof value !== 'number' || value < 0 || value > 65535) {
          throw new Error("timeStamp must be a number between 0 and 65535.");
        }
        this.#timeStamp = value;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(5 + this.LPDU.length + 1); // bit 5 + lpdu + Checksum
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.status.value, 1);
        buffer.writeInt16BE(this.timeStamp, 2);
        this.controlField1.buffer.copy(buffer, 4); // Assuming controlField1 is a Buffer
        this.LPDU.copy(buffer, 5);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }

      describe() {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          status: `Estado: ${this.status.describe()}`,
          timeStamp: `Marca de tiempo: ${this.timeStamp}`,
          controlField1: `Campo de control 1: ${this.controlField1.describe()}`,
          LPDU: `LPDU: ${this.LPDU}`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    /**
     * It shall be possible to send up to 28 octets of plain data by this service.
     * 
     * In “time” optionally a time delay before sending the message on the bus can be specified. If
     * “time”=00000000h the frame shall be sent immediately. Otherwise the frame shall be sent if the free
     * running system counter of the sending device equals the value given in “time”.
    */
    "L_Plain_Data.req": class LPlainDataReq implements ServiceMessage {
      constructor(value: L_Plain_Data_req) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("L_Plain_Data.req must be an object with specific properties.");
        }
        this.time = value.time;
        this.data = value.data;
      }
      time: number; // Time delay before sending the message
      data: Buffer; // Data to be sent

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6 + this.data.length);
        buffer.writeUInt8(MESSAGE_CODE_FIELD["L_Plain_Data.req"]["EMI2/IMI2"].value, 0);
        buffer.writeUInt32BE(this.time, 2); // byte 3-6
        this.data.copy(buffer, 6);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }

      describe() {
        return {
          time: `Tiempo: ${this.time}`,
          data: `Datos: ${this.data.toString('hex')}`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    }
  } as const;

  /**
   * In normal operation mode of the Data Link Layer, exactly the L_Data.req, the L_Data.ind, the
   * L_Data.con, the L_Poll_Data.req and the L_Poll_Data.con messages shall be available.
   */
  DataLinkLayerEMI = {
    "L_Data.req": class LDataReq implements ServiceMessage {
      constructor(value: L_Data_req) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("L_Data.req must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.priority = value.control.priority
        this.controlField1.ackRequest = value.control.ackRequest;
        if (KNXHelper.isValidGroupAddress(value.destinationAddress) || KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType
        this.NPCI = value.NPCI;
        this.npdu = value.NPDU;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Data.req"]["EMI2/IMI2"].value;
      controlField1: ControlField; // Control field 1
      destinationAddress: string; // Destination address
      addressType: AddressType;
      NPCI: number;
      octNumber: number = 0;
      npdu: Buffer; // Network Protocol Data Unit (NPDU)

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.npdu.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.controlField1.buffer.copy(buffer, 1); // Assuming controlField1 is a Buffer
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4)
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0F))
        this.npdu.copy(buffer, 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField1: `Campo de control 1: ${this.controlField1.describe()}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          addressType: `AT: ${AddressType[this.addressType]}`,
          npci: `NPCI: ${this.NPCI}`,
          npdu: `NPDU: ${this.npdu.toString('hex')}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "L_Data.con": class LDataCon implements ServiceMessage {
      constructor(value: L_Data_con) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("L_Data.req must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.priority = value.control.priority
        this.controlField1.confirm = value.control.confirm;
        if (KNXHelper.isValidGroupAddress(value.destinationAddress) || KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType
        this.NPCI = value.NPCI;
        this.npdu = value.NPDU;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Data.con"]["EMI2/IMI2"].value;
      controlField1: ControlField; // Control field 1
      destinationAddress: string; // Destination address
      addressType: AddressType;
      NPCI: number;
      octNumber: number = 0;
      npdu: Buffer; // Network Protocol Data Unit (NPDU)

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.npdu.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.controlField1.buffer.copy(buffer, 1); // Assuming controlField1 is a Buffer
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4)
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0F))
        this.npdu.copy(buffer, 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField1: `Campo de control 1: ${this.controlField1.describe()}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          addressType: `AT: ${AddressType[this.addressType]}`,
          npci: `NPCI: ${this.NPCI}`,
          npdu: `NPDU: ${this.npdu.toString('hex')}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "L_Data.ind": class LDataInd implements ServiceMessage {
      constructor(value: L_Data_ind) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("L_Data.ind must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.priority = value.control.priority
        if (KNXHelper.isValidGroupAddress(value.destinationAddress) || KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.sourceAddress = value.sourceAddress
        this.addressType = value.addressType
        this.NPCI = value.NPCI;
        this.npdu = value.NPDU;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Data.ind"]["EMI2/IMI2"].value;
      controlField1: ControlField; // Control field 1
      sourceAddress: string;
      destinationAddress: string; // Destination address
      addressType: AddressType;
      NPCI: number;
      octNumber: number = 0;
      npdu: Buffer; // Network Protocol Data Unit (NPDU)

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.npdu.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.controlField1.buffer.copy(buffer, 1); // Assuming controlField1 is a Buffer
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4)
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0F))
        this.npdu.copy(buffer, 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField1: `Campo de control 1: ${this.controlField1.describe()}`,
          sourceAddress: `Dirección de fuente: ${this.sourceAddress}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          addressType: `AT: ${AddressType[this.addressType]}`,
          npci: `NPCI: ${this.NPCI}`,
          npdu: `NPDU: ${this.npdu.toString('hex')}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "L_Poll_Data.req": class LPollDataReq implements ServiceMessage {
      constructor(value: L_Poll_Data_Req) {
        this.#pollingGroup = value.pollingGroup;
        this.#nrOfSlots = value.nrOfSlots;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Poll_Data.req"]["EMI2/IMI2"].value;
      control = 0xF0;
      #pollingGroup = 0;
      #nrOfSlots: bits4 = 0;


      set pollingGroup(value: number) {
        if (value < 0 || value > 65.535) throw new Error("The value must be 16 bits");
        this.#pollingGroup = value;
      }

      get pollingGroup() {
        return this.#pollingGroup;
      }

      set nrOfSlots(value: bits4) {
        if (value < 0 || value > 7) throw new Error("The value must be 4 bits");
        this.#nrOfSlots = value;
      }

      get nrOfSlots() {
        return this.#nrOfSlots;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        let octet7 = 0;
        octet7 = octet7 | (this.#nrOfSlots & 0x0F);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.control, 1);
        buffer.writeUInt8(0, 2);
        buffer.writeUInt8(0, 3);
        buffer.writeUInt8(this.#pollingGroup & 0xFF00, 4);
        buffer.writeUInt8(this.#pollingGroup & 0x00FF, 5);
        buffer.writeUInt8(octet7, 6);
        return buffer;
      }

      describe(): Record<string, string> {
        return {
          messageCode: `Codigo de mensaje: ${this.messageCode}`,
          control: `Control: ${this.control}`,
          pollingGroup: `${this.#pollingGroup}`,
          nrOfGroup: `${this.#nrOfSlots}`
        }
      }
    },
    "L_Poll_Data.con": class LPollDataCon implements ServiceMessage {
      constructor(value: L_Poll_Data_Req) {
        this.#pollingGroup = value.pollingGroup;
        this.#nrOfSlots = value.nrOfSlots;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Poll_Data.req"]["EMI2/IMI2"].value;
      control = 0xF0;
      #pollingGroup = 0;
      #nrOfSlots: bits4 = 0;


      set pollingGroup(value: number) {
        if (value < 0 || value > 65.535) throw new Error("The value must be 16 bits");
        this.#pollingGroup = value;
      }

      get pollingGroup() {
        return this.#pollingGroup;
      }

      set nrOfSlots(value: bits4) {
        if (value < 0 || value > 7) throw new Error("The value must be 4 bits");
        this.#nrOfSlots = value;
      }

      get nrOfSlots() {
        return this.#nrOfSlots;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        let octet7 = 0;
        octet7 = octet7 | (this.#nrOfSlots & 0x0F);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.control, 1);
        buffer.writeUInt8(0, 2);
        buffer.writeUInt8(0, 3);
        buffer.writeUInt8(this.#pollingGroup & 0xFF00, 4);
        buffer.writeUInt8(this.#pollingGroup & 0x00FF, 5);
        buffer.writeUInt8(octet7, 6);
        return buffer;
      }

      describe(): Record<string, string> {
        return {
          messageCode: `Codigo de mensaje: ${this.messageCode}`,
          control: `Control: ${this.control}`,
          pollingGroup: `${this.#pollingGroup}`,
          nrOfGroup: `${this.#nrOfSlots}`
        }
      }
    },
    "L_SystemBroadcast.req": class LSystemBroadcastReq implements ServiceMessage {
      constructor(value: L_SystemBroadcast_req) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("L_Data.ind must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0b10000000);
        this.controlField1.priority = value.control.priority
        this.controlField1.confirm = value.control.confirm
        this.messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.req"]["EMI2/IMI2"].value;
        if (KNXHelper.isValidGroupAddress(value.destinationAddress) || KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType
        this.NPCI = value.NPCI;
        this.npdu = value.NPDU;
      }
      messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.req"]["EMI2/IMI2"].value;
      controlField1: ControlField; // Control field 1
      destinationAddress: string; // Destination address
      addressType: AddressType;
      NPCI: number;
      octNumber: number = 0;
      npdu: Buffer; // Network Protocol Data Unit (NPDU)

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.npdu.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.controlField1.buffer.copy(buffer, 1); // Assuming controlField1 is a Buffer
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4)
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0F))
        this.npdu.copy(buffer, 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField1: `Campo de control 1: ${this.controlField1.describe()}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          addressType: `AT: ${AddressType[this.addressType]}`,
          npci: `NPCI: ${this.NPCI}`,
          npdu: `NPDU: ${this.npdu.toString('hex')}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "L_SystemBroadcast.con": class LSystemBroadcastCon implements ServiceMessage {
      constructor(value: L_SystemBroadcast_con) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("L_Data.ind must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.repeat = value.control.notRepeat
        this.controlField1.priority = value.control.priority
        this.controlField1.confirm = value.control.confirm
        this.messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.con"]["EMI2/IMI2"].value;
        if (KNXHelper.isValidGroupAddress(value.destinationAddress) || KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType
        this.NPCI = value.NPCI;
        this.npdu = value.NPDU;
      }
      messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.con"]["EMI2/IMI2"].value;
      controlField1: ControlField; // Control field 1
      destinationAddress: string; // Destination address
      addressType: AddressType;
      NPCI: number;
      octNumber: number = 0;
      npdu: Buffer; // Network Protocol Data Unit (NPDU)

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.npdu.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.controlField1.buffer.copy(buffer, 1); // Assuming controlField1 is a Buffer
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4)
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0F))
        this.npdu.copy(buffer, 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField1: `Campo de control 1: ${this.controlField1.describe()}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          addressType: `AT: ${AddressType[this.addressType]}`,
          npci: `NPCI: ${this.NPCI}`,
          npdu: `NPDU: ${this.npdu.toString('hex')}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "L_SystemBroadcast.ind": class LSystemBroadcastInd implements ServiceMessage {
      constructor(value: L_SystemBroadcast_ind) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("L_Data.ind must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.priority = value.control.priority
        if (KNXHelper.isValidGroupAddress(value.destinationAddress) || KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        if (KNXHelper.isValidGroupAddress(value.sourceAddress) || KNXHelper.isValidIndividualAddress(value.sourceAddress)) {
          this.sourceAddress = value.sourceAddress;
        } else {
          throw new Error("The Source Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType;
        this.NPCI = value.NPCI;
        this.npdu = value.NPDU;
      }
      messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.con"]["EMI2/IMI2"].value;
      controlField1: ControlField; // Control field 1
      destinationAddress: string; // Destination address
      sourceAddress: string; // Source address
      addressType: AddressType;
      NPCI: number;
      octNumber: number = 0;
      npdu: Buffer; // Network Protocol Data Unit (NPDU)

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.npdu.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.controlField1.buffer.copy(buffer, 1); // Assuming controlField1 is a Buffer
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 2)
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4)
        buffer[6] = 0x00 | (this.NPCI << 4) | (this.npdu.length & 0x0F)
        this.npdu.copy(buffer, 7);
        return buffer;
      }

      describe() {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField1: `Campo de control 1: ${this.controlField1.describe()}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          addressType: `AT: ${AddressType[this.addressType]}`,
          npci: `NPCI: ${this.NPCI}`,
          npdu: `NPDU: ${this.npdu.toString('hex')}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    }
  } as const;
  /**
   * In Network Layer mode exactly the N_Data_Individual.req, N_Data_Individual.con,
   * N_Data_Individual.ind, N_Data_Group.req, N_Data_Group.con, N_Data_Group.ind,
   * N_Data_Broadcast.req, N_Data_Broadcast.con, N_Data_Broadcast.ind, N_Poll_Data.req and
   * N_Poll_Data.con messages are available. All NL services belong to EMI/IMI2 only.
   */
  NetworkLayerEMI = {
    "N_Data_Individual.req": class NDataIndividualReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Individual.req"]["EMI2/IMI2"].value;
      controlField: ControlField;
      destinationAddress: string; // Individual address
      TPDU: Buffer; // Transport Layer Protocol Data Unit

      constructor(value: N_Data_Individual_req_Ctor) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Data_Individual.req must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.frameType = value.control.frameType;
        this.controlField.repeat = value.control.repeat;
        this.controlField.systemBroadcast = value.control.systemBroadcast;
        this.controlField.priority = value.control.priority;
        this.controlField.ackRequest = value.control.ackRequest;
        this.controlField.confirm = value.control.confirm;

        if (!KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          throw new Error("The Destination Address must be a valid Individual Address");
        }
        this.destinationAddress = value.destinationAddress;
        this.TPDU = value.TPDU;
      }

      /**
       * Converts the N_Data_Individual.req message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Unused (2) + Dest Addr (2) + LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + APDU.length = 8 + APDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.TPDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt8(0x00, 2); // Octet 3: unused
        buffer.writeUInt8(0x00, 3); // Octet 6: unused (LG high in diagram, but treated as unused)
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        buffer.writeUInt8(this.TPDU.length, 6); // Octet 7: LG (octet count)
        this.TPDU.copy(buffer, 7); // Octet 8...n: TPDU
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Data_Individual.req message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField: `Campo de control: ${this.controlField.describe()}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          APDU: `APDU: ${this.TPDU.toString('hex')}`,
          APDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "N_Data_Individual.con": class NDataIndividualCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Individual.con"]["EMI2/IMI2"].value;
      controlField: ControlField;
      destinationAddress: string; // Destination address
      TPDU: Buffer;

      constructor(value: N_Data_Individual_con_Ctor) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Data_Individual.con must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.confirm = value.control.confirm; // Set confirm bit
        // The spec (3.3.5.3) for N_Data_Individual.con control field is "unused c".
        // Therefore, priority should not be set here.

        if (!KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          throw new Error("The Destination Address must be a valid Individual Address");
        }
        this.destinationAddress = value.destinationAddress;
        this.TPDU = value.TPDU;
      }

      /**
       * Converts the N_Data_Individual.con message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Unused (1) + Dest Addr (2) + Unused (1) + LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + APDU.length + 1 = 8 + APDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.TPDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt8(0x00, 2); // Octet 3: unused
        buffer.writeUInt8(0x00, 3); // Octet 4: unused (LG high in diagram, but treated as unused)
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        buffer.writeUInt8(this.TPDU.length & 0x0F, 6); // Octet 7: LG (octet count)
        this.TPDU.copy(buffer, 7); // Octet 8...n: TPDU
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Data_Individual.con message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField: `Campo de control: ${this.controlField.describe()}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          TPDU: `TPDU: ${this.TPDU.toString('hex')}`,
          TPDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "N_Data_Individual.ind": class NDataIndividualInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Individual.ind"]["EMI2/IMI2"].value;
      controlField: ControlField;
      sourceAddress: string; // Individual address
      destinationAddress: string; // Individual address
      hopCount: number; // 4 bits (formerly NPCI)
      TPDU: Buffer;

      constructor(value: N_Data_Individual_ind_Ctor) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Data_Individual.ind must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.priority = value.control.priority;

        if (!KNXHelper.isValidIndividualAddress(value.sourceAddress)) {
          throw new Error("The Source Address must be a valid Individual Address");
        }
        this.sourceAddress = value.sourceAddress;

        if (!KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          throw new Error("The Destination Address must be a valid Individual Address");
        }
        this.destinationAddress = value.destinationAddress;
        this.hopCount = value.hopCount;
        this.TPDU = value.TPDU;
      }

      /**
       * Converts the N_Data_Individual.ind message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Source Addr (2) + Dest Addr (2) + hopCount/LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + APDU.length + 1 = 8 + APDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.TPDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2); // Octets 3-4: Source Address
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        // Octet 7: hop_count_type (bits 6-4) | octet count (LG) (bits 3-0)
        buffer.writeUInt8(((this.hopCount & 0x0F) << 4) | (this.TPDU.length & 0x0F), 6);
        this.TPDU.copy(buffer, 7); // Octet 8...n: TPDU
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Data_Individual.ind message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField: `Campo de control: ${this.controlField.describe()}`,
          sourceAddress: `Dirección de fuente: ${this.sourceAddress}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          hopCount: `Conteo de saltos: ${this.hopCount}`,
          APDU: `APDU: ${this.TPDU.toString('hex')}`,
          APDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "N_Data_Group.req": class NDataGroupReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Group.req"]["EMI2/IMI2"].value;
      controlField: ControlField;
      destinationAddress: string; // Group address
      APDU: Buffer;

      constructor(value: N_Data_Group_req_Ctor) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Data_Group.req must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.priority = value.control.priority;
        // The spec (3.3.5.5) for N_Data_Group.req control field is "unused priority unused".
        // Therefore, ackRequest should not be set here.

        if (!KNXHelper.isValidGroupAddress(value.destinationAddress)) {
          throw new Error("The Destination Address must be a valid Group Address");
        }
        this.destinationAddress = value.destinationAddress;
        this.APDU = value.APDU;
      }

      /**
       * Converts the N_Data_Group.req message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Unused (2) + Dest Addr (2) + hopCount/LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + APDU.length + 1 = 8 + APDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt16BE(0x0000, 2); // Octets 3-4: unused (Source Address)
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        // Octet 7: hop_count_type (bits 7-4, default 0) | octet count (LG) (bits 3-0)
        buffer.writeUInt8(this.APDU.length & 0x0F, 6); // Default hop_count_type is 0
        this.APDU.copy(buffer, 7); // Octet 8...n: TPDU
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Data_Group.req message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField: `Campo de control: ${this.controlField.describe()}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          APDU: `APDU: ${this.APDU.toString('hex')}`,
          APDU_Length: `${this.APDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "N_Data_Group.con": class NDataGroupCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Group.con"]["EMI2/IMI2"].value;
      controlField: ControlField;
      destinationAddress: string; // Group address
      APDU: Buffer;

      constructor(value: N_Data_Group_con_Ctor) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Data_Group.con must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.confirm = value.control.confirm;
        // The spec (3.3.5.6) for N_Data_Group.con control field is "unused c".
        // Therefore, priority should not be set here.

        if (!KNXHelper.isValidGroupAddress(value.destinationAddress)) {
          throw new Error("The Destination Address must be a valid Group Address");
        }
        this.destinationAddress = value.destinationAddress;
        this.APDU = value.APDU;
      }

      /**
       * Converts the N_Data_Group.con message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Unused (2) + Dest Addr (2) + LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + APDU.length + 1 = 8 + APDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt16BE(0x0000, 2); // Octets 3-4: unused (Source Address)
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        buffer.writeUInt8(this.APDU.length & 0x0F, 6); // Octet 7: LG (octet count), upper 4 bits unused
        this.APDU.copy(buffer, 7); // Octet 8...n: TPDU
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Data_Group.con message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField: `Campo de control: ${this.controlField.describe()}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          APDU: `APDU: ${this.APDU.toString('hex')}`,
          APDU_Length: `${this.APDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "N_Data_Group.ind": class NDataGroupInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Group.ind"]["EMI2/IMI2"].value;
      controlField: ControlField;
      sourceAddress: string; // Individual address
      destinationAddress: string; // Group address
      hopCount: number; // 4 bits (formerly NPCI)
      APDU: Buffer;

      constructor(value: N_Data_Group_ind_Ctor) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Data_Group.ind must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.priority = value.control.priority;

        if (!KNXHelper.isValidIndividualAddress(value.sourceAddress)) {
          throw new Error("The Source Address must be a valid Individual Address");
        }
        this.sourceAddress = value.sourceAddress;

        if (!KNXHelper.isValidGroupAddress(value.destinationAddress)) {
          throw new Error("The Destination Address must be a valid Group Address");
        }
        this.destinationAddress = value.destinationAddress;
        this.hopCount = value.hopCount;
        this.APDU = value.APDU;
      }

      /**
       * Converts the N_Data_Group.ind message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Unused (2) + Dest Addr (2) + hopCount/LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + APDU.length + 1 = 8 + APDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt16BE(0x0000, 2); // Octets 3-4: unused (Source Address in diagram, but text implies unused for Group.ind)
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        // Octet 7: hop_count_type (bits 7-4) | octet count (LG) (bits 3-0)
        buffer.writeUInt8(((this.hopCount & 0x0F) << 4) | (this.APDU.length & 0x0F), 6);
        this.APDU.copy(buffer, 7); // Octet 8...n: TPDU
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Data_Group.ind message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField: `Campo de control: ${this.controlField.describe()}`,
          sourceAddress: `Dirección de fuente: ${this.sourceAddress}`,
          destinationAddress: `Dirección de destino: ${this.destinationAddress}`,
          hopCount: `Conteo de saltos: ${this.hopCount}`,
          APDU: `APDU: ${this.APDU.toString('hex')}`,
          APDU_Length: `${this.APDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "N_Data_Broadcast.req": class NDataBroadcastReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Broadcast.req"]["EMI2/IMI2"].value;
      controlField: ControlField;
      TPDU: Buffer;

      constructor(value: N_Data_Broadcast_req_Ctor) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Data_Broadcast.req must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.priority = value.control.priority;
        // The spec (3.3.5.8) for N_Data_Broadcast.req control field is "unused priority unused".
        // Therefore, ackRequest should not be set here.

        this.TPDU = value.APDU;
      }

      /**
       * Converts the N_Data_Broadcast.req message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Unused (2) + Unused (2) + hopCount/LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + APDU.length + 1 = 8 + APDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.TPDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt16BE(0x0000, 2); // Octets 3-4: unused (Source Address)
        buffer.writeUInt16BE(0x0000, 4); // Octets 5-6: unused (Destination Address)
        // Octet 7: hop_count_type (bits 7-4, default 0) | octet count (LG) (bits 3-0)
        buffer.writeUInt8(this.TPDU.length & 0x0F, 6); // Default hop_count_type is 0
        this.TPDU.copy(buffer, 7); // Octet 8...n: TPDU
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Data_Broadcast.req message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField: `Campo de control: ${this.controlField.describe()}`,
          TPDU: `TPDU: ${this.TPDU.toString('hex')}`,
          TPDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "N_Data_Broadcast.con": class NDataBroadcastCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Broadcast.con"]["EMI2/IMI2"].value;
      controlField: ControlField;
      TPDU: Buffer;

      constructor(value: N_Data_Broadcast_con_Ctor) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Data_Broadcast.con must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.confirm = value.control.confirm;
        // The spec (3.3.5.9) for N_Data_Broadcast.con control field is "unused unused unused c".
        // Therefore, priority should not be set here.

        this.TPDU = value.TPDU;
      }

      /**
       * Converts the N_Data_Broadcast.con message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Unused (2) + Unused (2) + LG (1) + TPDU (variable)
       * Total Length: 1 + 1 + 2 + 2 + 1 + TPDU.length + 1 = 7 + TPDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.TPDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt16BE(0x0000, 2); // Octets 3-4: unused (Source Address)
        buffer.writeUInt16BE(0x0000, 4); // Octets 5-6: unused (Destination Address)
        buffer.writeUInt8(this.TPDU.length & 0x0F, 6); // Octet 7: LG (octet count), upper 4 bits unused
        this.TPDU.copy(buffer, 7); // Octet 8...n: TPDU
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Data_Broadcast.con message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField: `Campo de control: ${this.controlField.describe()}`,
          APDU: `APDU: ${this.TPDU.toString('hex')}`,
          APDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "N_Data_Broadcast.ind": class NDataBroadcastInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Broadcast.ind"]["EMI2/IMI2"].value;
      controlField: ControlField;
      sourceAddress: string; // Individual address
      hopCount: number; // 4 bits (formerly NPCI)
      TPDU: Buffer;

      constructor(value: N_Data_Broadcast_ind_Ctor) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Data_Broadcast.ind must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.priority = value.control.priority;

        if (!KNXHelper.isValidIndividualAddress(value.sourceAddress)) {
          throw new Error("The Source Address must be a valid Individual Address");
        }
        this.sourceAddress = value.sourceAddress;
        this.hopCount = value.hopCount;
        this.TPDU = value.APDU;
      }

      /**
       * Converts the N_Data_Broadcast.ind message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Source Addr (2) + Unused (2) + hopCount/LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + TPDU.length + 1 = 8 + TPDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.TPDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2); // Octets 3-4: Source Address
        buffer.writeUInt16BE(0x0000, 4); // Octets 5-6: unused (Destination Address)
        // Octet 7: hop_count_type (bits 7-4) | octet count (LG) (bits 3-0)
        buffer.writeUInt8(((this.hopCount & 0x0F) << 4) | (this.TPDU.length & 0x0F), 6);
        this.TPDU.copy(buffer, 7); // Octet 8...n: TPDU
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Data_Broadcast.ind message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Código de mensaje: ${this.messageCode}`,
          controlField: `Campo de control: ${this.controlField.describe()}`,
          sourceAddress: `Dirección de fuente: ${this.sourceAddress}`,
          hopCount: `Conteo de saltos: ${this.hopCount}`,
          TPDU: `TPDU: ${this.TPDU.toString('hex')}`,
          TPDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        };
      }
    },
    "N_Poll_Data.req": class NPollDataReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Poll_Data.req"]["EMI2/IMI2"].value;
      control = 0xF0; // Fixed control byte for N_Poll_Data.req (similar to L_Poll_Data)
      #pollingGroup: Buffer = Buffer.alloc(1, 0);
      #nrOfSlots: bits4 = 0;

      constructor(value: N_Poll_Data_Req) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Poll_Data.req must be an object with specific properties.");
        }
        this.nrOfSlots = value.nrOfSlots;
        this.pollingGroup = value.pollingGroup;
      }

      set pollingGroup(value: string) {
        const convertToAddress = KNXHelper.GetAddress_(value);
        this.#pollingGroup = convertToAddress;
      }

      get pollingGroup() {
        return KNXHelper.GetAddress(this.#pollingGroup, "/", true) as string // Se supone que es un dirección de grupo;
      }

      set nrOfSlots(value: bits4) {
        if (value < 0 || value > 7) throw new Error("The nrOfSlots value must be 4 bits (0-7)");
        this.#nrOfSlots = value;
      }

      get nrOfSlots() {
        return this.#nrOfSlots;
      }

      /**
       * Converts the N_Poll_Data.req message to a Buffer.
       * Format: Message Code (1) + Control (1) + Polling Group (2) + NrOfSlots/Reserved (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 = 7
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        let octet7 = 0;
        octet7 = octet7 | (this.#nrOfSlots & 0x0F); // NrOfSlots in lower 4 bits
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        buffer.writeUInt8(this.control, 1); // Octet 2: Control
        this.#pollingGroup.copy(buffer, 0); // Octets 5-6: Polling Group
        buffer.writeUInt8(octet7, 6); // Octet 7: NrOfSlots (bits 3-0)
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Poll_Data.req message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Codigo de mensaje: ${this.messageCode}`,
          control: `Control: ${this.control.toString(16).padStart(2, '0')}`,
          pollingGroup: `Grupo de sondeo: ${this.#pollingGroup}`,
          nrOfSlots: `Número de ranuras: ${this.#nrOfSlots}`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        }
      }
    },
    "N_Poll_Data.con": class NPollDataCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Poll_Data.con"]["EMI2/IMI2"].value;
      control = 0xF0; // Fixed control byte for N_Poll_Data.con
      #pollingGroup: Buffer = Buffer.alloc(1, 0);
      #nrOfSlots: bits4 = 0;
      pollData: Buffer; // Polled data

      constructor(value: N_Poll_Data_Con) {
        if (typeof value !== 'object' || value === null) {
          throw new Error("N_Poll_Data.con must be an object with specific properties.");
        }
        this.pollingGroup = value.pollingGroup;
        this.nrOfSlots = value.nrOfSlots;
        this.pollData = value.pollData;
      }

      set pollingGroup(value: string) {
        const convertToAddress = KNXHelper.GetAddress_(value);
        this.#pollingGroup = convertToAddress;
      }

      get pollingGroup() {
        return KNXHelper.GetAddress(this.#pollingGroup, "/", true) as string // Se supone que es un dirección de grupo;
      }

      set nrOfSlots(value: bits4) {
        if (value < 0 || value > 7) throw new Error("The nrOfSlots value must be 4 bits (0-7)");
        this.#nrOfSlots = value;
      }

      get nrOfSlots() {
        return this.#nrOfSlots;
      }

      /**
       * Converts the N_Poll_Data.con message to a Buffer.
       * Format: Message Code (1) + Control (1) + Polling Group (2) + NrOfSlots/Reserved (1) + PollData (variable)
       * Total Length: 1 + 1 + 2 + 1 + APDU.length + 1 = 8 + APDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.pollData.length);
        let octet7 = 0;
        octet7 = octet7 | (this.#nrOfSlots & 0x0F); // NrOfSlots in lower 4 bits
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        buffer.writeUInt8(this.control, 1); // Octet 2: Control
        this.#pollingGroup.copy(buffer, 0); // Octets 5-6: Polling Group
        buffer.writeUInt8(octet7, 6); // Octet 7: NrOfSlots (bits 3-0)
        this.pollData.copy(buffer, 7); // Octet 8...n: Poll Data
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Poll_Data.con message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Codigo de mensaje: ${this.messageCode}`,
          control: `Control: ${this.control.toString(16).padStart(2, '0')}`,
          pollingGroup: `Grupo de sondeo: ${this.#pollingGroup}`,
          nrOfSlots: `Número de ranuras: ${this.#nrOfSlots}`,
          pollData: `pollData: ${this.pollData.toString('hex')}`,
          pollData_Length: `${this.pollData.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString('hex')}`
        }
      }
    }
  } as const
  TransportLayerEMI = {
    "T_Connect.req": class TConnectReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Connect.req"]["EMI2/IMI2"].value;
      control = 0x00;
      destinationAddress: string;

      constructor(value: T_Connect_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TConnectReq.name)
        }
        this.destinationAddress = value.destinationAddress
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.control, 1);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer
      }
      describe(): Record<string, string | number> {
        return {
          messageCode: this.messageCode,
          control: this.control,
          destinationAddress: this.destinationAddress
        }
      }
    },
    "T_Connect.con": class TConnectCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Connect.con"]["EMI2/IMI2"].value;
      control = 0x00;
      destinationAddress: string;

      constructor(value: T_Connect_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TConnectCon.name)
        }
        this.destinationAddress = value.destinationAddress
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.control, 1);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 2);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer
      }
      describe(): Record<string, string | number> {
        return {
          messageCode: this.messageCode,
          control: this.control,
          destinationAddress: this.destinationAddress
        }
      }
    },
    "T_Connect.ind": class TConnectCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Connect.ind"]["EMI2/IMI2"].value;
      control = new ControlField();
      sourceAddress: string;

      constructor(value: T_Connect_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TConnectCon.name)
        }
        this.sourceAddress = value.sourceAddress
        this.control.ackRequest = value.control.ackRequest
        this.control.frameType = value.control.frameType
        this.control.repeat = value.control.repeat
        this.control.systemBroadcast = value.control.systemBroadcast
        this.control.priority = value.control.priority
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer
      }
      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control,
          sourceAddress: this.sourceAddress
        }
      }
    },
    "T_Disconnect.req": class TDisconnectReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Disconnect.req"]["EMI2/IMI2"].value;
      control = 0x00;

      constructor(value: object) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDisconnectReq.name)
        }
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer
      }
      describe() {
        return {
          messageCode: this.messageCode
        }
      }
    },
    "T_Disconnect.con": class TDisconnectCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Disconnect.con"]["EMI2/IMI2"].value;
      control = new ControlField();

      constructor(value: T_Disconnect_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDisconnectCon.name)
        }
        this.control.ackRequest = value.control.ackRequest
        this.control.frameType = value.control.frameType
        this.control.repeat = value.control.repeat
        this.control.systemBroadcast = value.control.systemBroadcast
        this.control.priority = value.control.priority
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1)
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer
      }
      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control
        }
      }
    },
    "T_Disconnect.ind": class TDisconnectCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Disconnect.ind"]["EMI2/IMI2"].value;
      control = new ControlField();

      constructor(value: T_Disconnect_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDisconnectCon.name)
        }
        this.control.ackRequest = value.control.ackRequest
        this.control.frameType = value.control.frameType
        this.control.repeat = value.control.repeat
        this.control.systemBroadcast = value.control.systemBroadcast
        this.control.priority = value.control.priority
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1)
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer
      }
      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control
        }
      }
    },
    "T_Data_Connected_req": class TDataConnectedReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Connected.req"]["EMI2/IMI2"].value;
      control = new ControlField();
      APDU: Buffer;
      hopCount: number;

      constructor(value: T_Data_Connected_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataConnectedReq.name)
        }
        this.control.priority = value.control.priority;
        this.APDU = value.APDU
        this.hopCount = value.hopCount
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1)
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (buffer.length & 0x0F)
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer
      }
      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control,
          hopCount: this.hopCount
        }
      }
    },
    // SERVICIOS COMPLETADOS
    // #region Por revisar
    "T_Data_Connected.con": class TDataConnectedCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Connected.con"]["EMI2/IMI2"].value;
      control = new ControlField();
      APDU: Buffer;

      constructor(value: T_Data_Connected_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataConnectedCon.name);
        }
        this.control.confirm = value.control.confirm;
        this.APDU = value.APDU;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        // Octetos 3-5 no utilizados
        buffer[6] |= (this.APDU.length & 0x0F);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          APDU: this.APDU.toString('hex')
        };
      }
    },
    "T_Data_Connected.ind": class TDataConnectedInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Connected.ind"]["EMI2/IMI2"].value;
      control = new ControlField();
      sourceAddress: string;
      APDU: Buffer;
      hopCount: number;

      constructor(value: T_Data_Connected_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataConnectedInd.name);
        }
        this.control.priority = value.control.priority;
        this.sourceAddress = value.sourceAddress;
        this.APDU = value.APDU;
        this.hopCount = value.hopCount
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        // Octeto 5-6 no utilizados
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0F);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          APDU: this.APDU.toString('hex')
        };
      }
    },
    "T_Data_Group.req": class TDataGroupReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Group.req"]["EMI2/IMI2"].value;
      control = new ControlField();
      APDU: Buffer;
      hopCount: number;

      constructor(value: T_Data_Group_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataGroupReq.name);
        }
        this.control.priority = value.control.priority;
        this.APDU = value.APDU;
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        // Octetos 3-6 no utilizados
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0F);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          hopCount: this.hopCount,
          APDU: this.APDU.toString('hex')
        };
      }
    },
    "T_Data_Group.con": class TDataGroupCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Group.con"]["EMI2/IMI2"].value;
      control = new ControlField();
      data: Buffer;

      constructor(value: T_Data_Group_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataGroupCon.name);
        }
        this.control.confirm = value.control.confirm;
        this.data = value.data
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.data.length); // Tamaño mínimo según documento
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        buffer[6] = (this.data.length & 0x0F)
        KNXHelper.WriteData(buffer, this.data, 7)
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe()
        };
      }
    },
    "T_Data_Group.ind": class TDataGroupInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Group.ind"]["EMI2/IMI2"].value;
      control = new ControlField();
      APDU: Buffer;

      constructor(value: T_Data_Group_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataGroupInd.name);
        }
        this.control.priority = value.control.priority;
        this.APDU = value.APDU;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        // Octetos 3-6 no utilizados
        buffer[6] |= (this.APDU.length & 0x0F);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          APDU: this.APDU.toString('hex')
        };
      }
    },
    "T_Data_Individual.req": class TDataIndividualReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Individual.req"]["EMI2/IMI2"].value;
      control = new ControlField();
      destinationAddress: string;
      APDU: Buffer;
      hopCount: number;

      constructor(value: T_Data_Individual_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataIndividualReq.name);
        }
        this.control.priority = value.control.priority;
        this.destinationAddress = value.destinationAddress;
        this.APDU = value.APDU;
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0F);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          destinationAddress: this.destinationAddress,
          hopCount: this.hopCount,
          APDU: this.APDU.toString('hex')
        };
      }
    },
    "T_Data_Individual.con": class TDataIndividualCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Individual.con"]["EMI2/IMI2"].value;
      control = new ControlField();
      destinationAddress: string;
      APDU: Buffer;

      constructor(value: T_Data_Individual_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataIndividualCon.name);
        }
        this.control.confirm = value.control.confirm;
        this.destinationAddress = value.destinationAddress;
        this.APDU = value.APDU;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        KNXHelper.WriteData(buffer, this.APDU, 7)
        buffer[6] = (this.APDU.length & 0x0F)
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          destinationAddress: this.destinationAddress
        };
      }
    },
    "T_Data_Individual.ind": class TDataIndividualInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Individual.ind"]["EMI2/IMI2"].value;
      control = new ControlField();
      sourceAddress: string;
      destinationAddress: string;
      APDU: Buffer;
      hopCount: number;

      constructor(value: T_Data_Individual_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataIndividualInd.name);
        }
        this.control.priority = value.control.priority;
        this.sourceAddress = value.sourceAddress;
        this.destinationAddress = value.destinationAddress;
        this.APDU = value.APDU;
        this.hopCount = value.hopCount
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0F);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          destinationAddress: this.destinationAddress,
          APDU: this.APDU.toString('hex')
        };
      }
    },
    "T_Data_Broadcast.req": class TDataBroadcastReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Broadcast.req"]["EMI2/IMI2"].value;
      control = new ControlField();
      APDU: Buffer;
      hopCount: number;

      constructor(value: T_Data_Broadcast_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataBroadcastReq.name);
        }
        this.control.priority = value.control.priority;
        this.APDU = value.APDU;
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0F); // podría no ser usado
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          hopCount: this.hopCount,
          APDU: this.APDU.toString('hex')
        };
      }
    },
    "T_Data_Broadcast.con": class TDataBroadcastCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Broadcast.con"]["EMI2/IMI2"].value;
      control = new ControlField();
      APDU: Buffer;

      constructor(value: T_Data_Broadcast_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataBroadcastCon.name);
        }
        this.control.confirm = value.control.confirm;
        this.APDU = value.APDU
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.WriteData(buffer, this.APDU, 7)
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe()
        };
      }
    },
    "T_Data_Broadcast.ind": class TDataBroadcastInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Broadcast.ind"]["EMI2/IMI2"].value;
      control = new ControlField();
      sourceAddress: string;
      APDU: Buffer;
      hopCount: number;

      constructor(value: T_Data_Broadcast_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataBroadcastInd.name);
        }
        this.control.priority = value.control.priority;
        this.sourceAddress = value.sourceAddress;
        this.APDU = value.APDU;
        this.hopCount = value.hopCount
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0F);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          APDU: this.APDU.toString('hex')
        };
      }
    },
    "T_Poll_Data.req": class TPollDataReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Poll_Data.req"]["EMI2/IMI2"].value;
      control = new ControlField();
      pollingGroup: string;
      numberOfSlots: number;

      constructor(value: T_Poll_Data_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TPollDataReq.name)
        }
        this.pollingGroup = value.pollingGroup;
        this.numberOfSlots = value.numberOfSlots;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.pollingGroup).copy(buffer, 4);
        buffer[6] = this.numberOfSlots & 0x0F;
        // No hay checksum en este mensaje según el documento
        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          pollingGroup: this.pollingGroup,
          numberOfSlots: this.numberOfSlots
        };
      }
    },

    "T_Poll_Data.con": class TPollDataCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Poll_Data.con"]["EMI2/IMI2"].value;
      control = new ControlField();
      sourceAddress: string;
      pollingGroup: string;
      pollData: Buffer;
      nrOfSlots: number;

      constructor(value: T_Poll_Data_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TPollDataCon.name)
        }
        this.sourceAddress = value.sourceAddress;
        this.pollingGroup = value.pollingGroup;
        this.pollData = value.pollData;
        this.nrOfSlots = value.nrOfSlots;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.pollData.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        KNXHelper.GetAddress_(this.pollingGroup).copy(buffer, 4);
        buffer[6] = this.nrOfSlots & 0x0F;
        this.pollData.copy(buffer, 7);
        // No hay checksum en este mensaje según el documento

        buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          pollingGroup: this.pollingGroup,
          pollData: this.pollData.toString('hex')
        };
      }
    }
    // #endregion
  } as const
}