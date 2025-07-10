import { KNXHelper } from "../utils/class/KNXHelper";
import { FrameKind, FrameType, Priority } from "./enum/KNXEnumControlField";
import { AddressType } from "./enum/KNXEnumControlFieldExtended";
import { KNXTP1ControlField } from "./KNXTP1ControlField";
import { MESSAGE_CODE_FIELD } from "./MessageCodeField";

interface DescribeEstructure {
  /**
   * Proporciona una descripción legible del estado actual de las propiedades del sistema.
   * @returns Un objeto que describe el estado de cada propiedad.
   */
  describe(): Record<string, string>;
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

interface L_Busmon_ind {
  status: Status;
  timeStamp: number;
  controlField1: KNXTP1ControlField; // Control field 1
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

interface L_Data_ind extends Omit<L_Data_req, "control"> {
  sourceAddress: string;
  control: {
    priority: Priority;
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
 */
export class EMI {
  constructor() { }

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
      controlField1: KNXTP1ControlField;
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
        const buffer = Buffer.alloc(8); // Adjust size as needed
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.status.value, 1);
        buffer.writeInt16BE(this.timeStamp, 2);
        this.controlField1.buffer.copy(buffer, 4); // Assuming controlField1 is a Buffer
        this.LPDU.copy(buffer, 5);
        buffer.writeUInt8(checksum(buffer.subarray(0, 6)), buffer.length - 1); // Calculate FCS
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
        const buffer = Buffer.alloc(2 + this.data.length);
        buffer.writeUInt8(MESSAGE_CODE_FIELD["L_Plain_Data.req"]["EMI2/IMI2"].value, 0);
        buffer.writeUInt32BE(this.time, 2);
        this.data.copy(buffer, 6);
        buffer.writeUInt8(checksum(buffer.subarray(0, 1 + this.data.length)), buffer.length - 1); // Calculate FCS
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
        this.controlField1 = new KNXTP1ControlField(0);
        this.controlField1.priority = value.control.priority
        this.controlField1.lastTwoBits = value.control.ackRequest ? 0b10 : 0b00;
        this.messageCode = MESSAGE_CODE_FIELD["L_Data.req"]["EMI2/IMI2"].value;
        if (KNXHelper.isValidGroupAddress(value.destinationAddress) || KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is valid Group Address or Individual Address");
        }
        this.addressType = value.addressType
        this.NPCI = value.NPCI;
        this.npdu = value.NPDU;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Data.req"]["EMI2/IMI2"].value;
      controlField1: KNXTP1ControlField; // Control field 1
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
        this.controlField1 = new KNXTP1ControlField(0);
        this.controlField1.priority = value.control.priority
        this.messageCode = MESSAGE_CODE_FIELD["L_Data.ind"]["EMI2/IMI2"].value;
        if (KNXHelper.isValidGroupAddress(value.destinationAddress) || KNXHelper.isValidIndividualAddress(value.destinationAddress)) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is valid Group Address or Individual Address");
        }
        this.sourceAddress = value.sourceAddress
        this.addressType = value.addressType
        this.NPCI = value.NPCI;
        this.npdu = value.NPDU;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Data.ind"]["EMI2/IMI2"].value;
      controlField1: KNXTP1ControlField; // Control field 1
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
  } as const;
}