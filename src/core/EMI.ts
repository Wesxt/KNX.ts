import { KNXHelper } from "../utils/KNXHelper";
import { AddressType } from "./enum/EnumControlFieldExtended";
import { ControlField } from "./ControlField";
import { MESSAGE_CODE_FIELD } from "./MessageCodeField";
import { APCI } from "./layers/interfaces/APCI";
import { APCIEnum } from "./enum/APCIEnum";
import {
  PEI_Switch_req,
  bits4,
  L_Busmon_ind,
  L_Plain_Data_req,
  L_Data_req,
  L_Data_con,
  L_Data_ind,
  L_Poll_Data_Req,
  L_Poll_Data_Con,
  L_SystemBroadcast_req,
  L_SystemBroadcast_con,
  L_SystemBroadcast_ind,
  N_Data_Individual_req_Ctor,
  N_Data_Individual_con_Ctor,
  N_Data_Individual_ind_Ctor,
  N_Data_Group_req_Ctor,
  N_Data_Group_con_Ctor,
  N_Data_Group_ind_Ctor,
  NPCI,
  N_Data_Broadcast_req_Ctor,
  N_Data_Broadcast_con_Ctor,
  N_Data_Broadcast_ind_Ctor,
  N_Poll_Data_Req,
  N_Poll_Data_Con,
  T_Connect_req,
  T_Connect_ind,
  T_Disconnect_con,
  T_Data_Connected_req,
  T_Data_Connected_con,
  T_Data_Connected_ind,
  T_Data_Group_req,
  T_Data_Group_con,
  T_Data_Group_ind,
  T_Data_Individual_req,
  T_Data_Individual_con,
  T_Data_Individual_ind,
  T_Data_Broadcast_req,
  T_Data_Broadcast_con,
  T_Data_Broadcast_ind,
  T_Poll_Data_req,
  T_Poll_Data_con,
  M_Connect_ind,
  M_User_Data_Connected_req,
  M_User_Data_Connected_con,
  M_User_Data_Connected_ind,
  A_Data_Group_req,
  A_Data_Group_con,
  A_Data_Group_ind,
  M_User_Data_Individual_req,
  M_User_Data_Individual_con,
  M_User_Data_Individual_ind,
  A_Poll_Data_req,
  A_Poll_Data_con,
} from "../@types/interfaces/EMI";
import { ServiceMessage } from "../@types/interfaces/ServiceMessage";
import { checksum } from "../utils/checksumFrame";
import { SystemStatus, Status } from "./SystemStatus";
import { SAP } from "./enum/SAP";

class InvalidInputObject extends Error {
  constructor(className: string) {
    super(`The input object in the ${className} is must be an object with specific properties`);
  }
}

/**
 * @alias External_Message_Interface
 * @description The External Message Interface (EMI) is a standardized interface for communication between external devices and KNX systems. It allows for the integration of various external systems, such as building management systems, into the KNX network.
 * @version Version 01.04.02 is a KNX Approved Standard.
 * @author Arnold Beleño Zuletta
 */
export class EMI {
  constructor() {
    throw new Error("This class is static");
  }

  /**
   * Crea una instancia de un servicio EMI a partir de un buffer
   * @param buffer Buffer completo del mensaje EMI (incluyendo Message Code)
   * @returns Instancia del servicio correspondiente
   */
  static fromBuffer(buffer: Buffer): ServiceMessage {
    if (buffer.length === 0) {
      throw new Error("Buffer is empty");
    }

    const messageCode = buffer.readUInt8(0);

    // Buscar el nombre del servicio en MESSAGE_CODE_FIELD
    let serviceName: string | undefined;

    // Priorizamos EMI2/IMI2, luego CEMI
    for (const [key, val] of Object.entries(MESSAGE_CODE_FIELD)) {
      // @ts-ignore
      const codes = val as Record<string, { value: number }>;
      if (codes["EMI2/IMI2"] && codes["EMI2/IMI2"].value === messageCode) {
        serviceName = key;
        break;
      }
      if (codes["CEMI"] && codes["CEMI"].value === messageCode) {
        serviceName = key;
        break;
      }
    }

    if (!serviceName) {
      throw new Error(`Unknown message code: 0x${messageCode.toString(16).toUpperCase()}`);
    }

    // Buscar la clase en los grupos estáticos
    const groups = [
      EMI.LayerAccess,
      EMI.BusmonitorEMI,
      EMI.DataLinkLayerEMI,
      EMI.NetworkLayerEMI,
      EMI.TransportLayerEMI,
      EMI.ApplicationLayerEMI,
    ];

    for (const group of groups) {
      // @ts-ignore
      const ServiceClass = group[serviceName];
      if (ServiceClass && typeof ServiceClass.fromBuffer === "function") {
        return ServiceClass.fromBuffer(buffer);
      }
    }

    throw new Error(
      `Service class not implemented for ${serviceName} (Code: 0x${messageCode.toString(16).toUpperCase()})`,
    );
  }

  /**
   * @deprecated **No uses esto, está en desuso**
   */
  static LayerAccess = {
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
      systemStatus: SystemStatus;
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
        this.#LL = value;
      }

      get LL() {
        return this.#LL;
      }

      set NL(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'NL' must be 4 bits");
        this.#NL = value;
      }

      get NL() {
        return this.#NL;
      }

      set TLG(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'TLG' must be 4 bits");
        this.#TLG = value;
      }

      get TLG() {
        return this.#TLG;
      }

      set TLC(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'TLC' must be 4 bits");
        this.#TLC = value;
      }

      get TLC() {
        return this.#TLC;
      }

      set TLL(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'TLL' must be 4 bits");
        this.#TLL = value;
      }

      get TLL() {
        return this.#TLL;
      }

      set AL(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'AL' must be 4 bits");
        this.#AL = value;
      }

      get AL() {
        return this.#AL;
      }

      set MAN(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'MAN' must be 4 bits");
        this.#MAN = value;
      }

      get MAN() {
        return this.#MAN;
      }

      set PEI(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'PEI' must be 4 bits");
        this.#PEI = value;
      }

      get PEI() {
        return this.#PEI;
      }

      set USR(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'USR' must be 4 bits");
        this.#USR = value;
      }

      get USR() {
        return this.#USR;
      }

      set res(value: bits4) {
        if (value < 0 || value > 7) throw new TypeError("The property 'res' must be 4 bits");
        this.#res = value;
      }

      get res() {
        return this.#res;
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
        octet5 = octet5 | this.#AL;
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

        return buffer;
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
          res: this.#res.toString(),
        };
      }
    },
  } as const;

  /**
   * In Busmonitor mode exactly the L_Busmon.ind message, the L_Plain_Data.req message, and the
   * LM_Reset.ind message shall be available.
   *
   * **Note:** The LM_Reset.ind message is not implemented.
   */
  static BusmonitorEMI = {
    "L_Busmon.ind": class LBusmonInd implements ServiceMessage {
      constructor(value: L_Busmon_ind) {
        if (typeof value !== "object" || value === null) {
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
        if (typeof value !== "number" || value < 0 || value > 65535) {
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
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      /**
       * Crea una instancia de LBusmonInd a partir de un buffer
       * @param buffer Buffer completo incluyendo FCS
       * @returns Instancia de LBusmonInd
       */
      static fromBuffer(buffer: Buffer): LBusmonInd {
        // Verificar longitud mínima
        if (buffer.length < 5) {
          throw new Error(`Buffer too short for L_Busmon.ind: ${buffer.length} bytes`);
        }

        // Extraer componentes
        const messageCode = buffer.readUInt8(0);
        const expectedCode = MESSAGE_CODE_FIELD["L_Busmon.ind"]["EMI2/IMI2"].value;

        if (messageCode !== expectedCode) {
          throw new Error(`Invalid message code for L_Busmon.ind: ${messageCode} (expected ${expectedCode})`);
        }

        // Status byte
        const statusByte = buffer.readUInt8(1);
        const statusObj = {
          frameError: ((statusByte >> 7) & 0x01) === 1,
          bitError: ((statusByte >> 6) & 0x01) === 1,
          parityError: ((statusByte >> 5) & 0x01) === 1,
          overflow: ((statusByte >> 4) & 0x01) === 1,
          lost: ((statusByte >> 3) & 0x01) === 1,
          sequenceNumber: (statusByte & 0x07) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
        };
        const status = new Status(statusObj);

        // Timestamp (2 bytes, big endian)
        const timeStamp = buffer.readUInt16BE(2);

        // Control Field (1 byte)
        const controlFieldByte = buffer.readUInt8(4);
        const controlField1 = new ControlField(controlFieldByte);

        // LPDU (resto del buffer)
        const LPDU = buffer.subarray(5);

        return new LBusmonInd({
          status,
          timeStamp,
          controlField1,
          LPDU,
        });
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
        if (typeof value !== "object" || value === null) {
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
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }

      describe() {
        return {
          time: `Tiempo: ${this.time}`,
          data: `Datos: ${this.data.toString("hex")}`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }
      /**
       * Crea una instancia de LPlainDataReq a partir de un buffer
       * @param buffer Buffer completo incluyendo FCS
       * @returns Instancia de LPlainDataReq
       */
      static fromBuffer(buffer: Buffer): LPlainDataReq {
        // Verificar longitud mínima
        if (buffer.length < 6) {
          throw new Error(`Buffer too short for L_Plain_Data.req: ${buffer.length} bytes`);
        }

        // Extraer componentes
        const messageCode = buffer.readUInt8(0);
        const expectedCode = MESSAGE_CODE_FIELD["L_Plain_Data.req"]["EMI2/IMI2"].value;

        if (messageCode !== expectedCode) {
          throw new Error(`Invalid message code for L_Plain_Data.req: ${messageCode} (expected ${expectedCode})`);
        }

        // Verificar octeto de control (debe ser 0x00 según especificación)
        const controlByte = buffer.readUInt8(1);
        if (controlByte !== 0x00) {
          console.warn(`Warning: Control byte in L_Plain_Data.req is ${controlByte.toString(16)}, expected 0x00`);
        }

        // Time (4 bytes, big endian, en posición 2-5)
        const time = buffer.readUInt32BE(2);

        // Data (resto del buffer desde posición 6)
        const data = buffer.subarray(6);

        // Verificar longitud máxima (28 octetos según especificación)
        if (data.length > 28) {
          throw new Error(`Data too long for L_Plain_Data.req: ${data.length} bytes (max 28)`);
        }

        return new LPlainDataReq({
          time,
          data,
        });
      }
    },
  } as const;

  /**
   * In normal operation mode of the Data Link Layer, exactly the L_Data.req, the L_Data.ind, the
   * L_Data.con, the L_Poll_Data.req and the L_Poll_Data.con messages shall be available.
   */
  static DataLinkLayerEMI = {
    "L_Data.req": class LDataReq implements ServiceMessage {
      constructor(value: L_Data_req) {
        if (typeof value !== "object" || value === null) {
          throw new Error("L_Data.req must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.priority = value.control.priority;
        this.controlField1.ackRequest = value.control.ackRequest;
        if (
          KNXHelper.isValidGroupAddress(value.destinationAddress) ||
          KNXHelper.isValidIndividualAddress(value.destinationAddress)
        ) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType;
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
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0f));
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
          npdu: `NPDU: ${this.npdu.toString("hex")}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): LDataReq {
        const messageCode = MESSAGE_CODE_FIELD["L_Data.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(`Invalid message code for L_Data.req. Expected ${messageCode}, got ${buffer.readUInt8(0)}`);
        }
        if (buffer.length < 7) {
          throw new Error("Buffer too short for L_Data.req");
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField1 = new ControlField(controlFieldByte);

        //[cite_start]// Bytes 2 and 3 are unused in Req [cite: 273]

        const destinationAddressBuf = buffer.subarray(4, 6);
        // Nota: Asumimos dirección de grupo por defecto si no podemos distinguir, pero el AT nos dirá
        const octet6 = buffer.readUInt8(6);
        const addressType = (octet6 >> 7) & 0x01;
        const NPCI = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        const destinationAddress = KNXHelper.GetAddress(
          destinationAddressBuf,
          addressType === AddressType.GROUP ? "/" : ".",
        );

        const npdu = buffer.subarray(7, 7 + length);

        return new LDataReq({
          control: {
            priority: controlField1.priority,
            ackRequest: controlField1.ackRequest,
          },
          destinationAddress: destinationAddress as string,
          addressType: addressType,
          NPCI: NPCI as NPCI,
          NPDU: npdu,
        });
      }
    },
    "L_Data.con": class LDataCon implements ServiceMessage {
      constructor(value: L_Data_con) {
        if (typeof value !== "object" || value === null) {
          throw new Error("L_Data.req must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.priority = value.control.priority;
        this.controlField1.confirm = value.control.confirm;
        if (
          KNXHelper.isValidGroupAddress(value.destinationAddress) ||
          KNXHelper.isValidIndividualAddress(value.destinationAddress)
        ) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType;
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
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0f));
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
          npdu: `NPDU: ${this.npdu.toString("hex")}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): LDataCon {
        const messageCode = MESSAGE_CODE_FIELD["L_Data.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(`Invalid message code for L_Data.con. Expected ${messageCode}, got ${buffer.readUInt8(0)}`);
        }
        if (buffer.length < 7) {
          throw new Error("Buffer too short for L_Data.con");
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField1 = new ControlField(controlFieldByte);

        const octet6 = buffer.readUInt8(6);
        const addressType = (octet6 >> 7) & 0x01;
        const NPCI = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        //[cite_start]// Bytes 2 and 3 unused [cite: 282]
        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(
          destinationAddressBuf,
          addressType === AddressType.GROUP ? "/" : ".",
        );

        const npdu = buffer.subarray(7, 7 + length);

        return new LDataCon({
          control: {
            priority: controlField1.priority,
            confirm: controlField1.confirm,
          },
          destinationAddress: destinationAddress as string,
          addressType: addressType,
          NPCI: NPCI as NPCI,
          NPDU: npdu,
        });
      }
    },
    "L_Data.ind": class LDataInd implements ServiceMessage {
      constructor(value: L_Data_ind) {
        if (typeof value !== "object" || value === null) {
          throw new Error("L_Data.ind must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.priority = value.control.priority;
        if (
          KNXHelper.isValidGroupAddress(value.destinationAddress) ||
          KNXHelper.isValidIndividualAddress(value.destinationAddress)
        ) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.sourceAddress = value.sourceAddress;
        this.addressType = value.addressType;
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
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0f));
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
          npdu: `NPDU: ${this.npdu.toString("hex")}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): LDataInd {
        const messageCode = MESSAGE_CODE_FIELD["L_Data.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(`Invalid message code for L_Data.ind. Expected ${messageCode}, got ${buffer.readUInt8(0)}`);
        }
        if (buffer.length < 7) {
          throw new Error("Buffer too short for L_Data.ind");
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField1 = new ControlField(controlFieldByte);

        const sourceAddressBuf = buffer.subarray(2, 4);
        const sourceAddress = KNXHelper.GetAddress(sourceAddressBuf, ".");

        const octet6 = buffer.readUInt8(6);
        const addressType = (octet6 >> 7) & 0x01;
        const NPCI = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(
          destinationAddressBuf,
          addressType === AddressType.GROUP ? "/" : ".",
        );

        const npdu = buffer.subarray(7, 7 + length);

        return new LDataInd({
          control: {
            priority: controlField1.priority,
          },
          sourceAddress: sourceAddress as string,
          destinationAddress: destinationAddress as string,
          addressType: addressType,
          NPCI: NPCI as NPCI,
          NPDU: npdu,
        });
      }
    },
    "L_Poll_Data.req": class LPollDataReq implements ServiceMessage {
      constructor(value: L_Poll_Data_Req) {
        this.#pollingGroup = value.pollingGroup;
        this.#nrOfSlots = value.nrOfSlots;
      }
      messageCode = MESSAGE_CODE_FIELD["L_Poll_Data.req"]["EMI2/IMI2"].value;
      control = 0xf0;
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
        octet7 = octet7 | (this.#nrOfSlots & 0x0f);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.control, 1);
        buffer.writeUInt8(0, 2);
        buffer.writeUInt8(0, 3);
        buffer.writeUInt8(this.#pollingGroup & 0xff00, 4);
        buffer.writeUInt8(this.#pollingGroup & 0x00ff, 5);
        buffer.writeUInt8(octet7, 6);
        return buffer;
      }

      describe(): Record<string, string> {
        return {
          messageCode: `Codigo de mensaje: ${this.messageCode}`,
          control: `Control: ${this.control}`,
          pollingGroup: `${this.#pollingGroup}`,
          nrOfGroup: `${this.#nrOfSlots}`,
        };
      }

      static fromBuffer(buffer: Buffer): LPollDataReq {
        const messageCode = MESSAGE_CODE_FIELD["L_Poll_Data.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for L_Poll_Data.req. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }
        if (buffer.length < 7) {
          throw new Error("Buffer too short for L_Poll_Data.req");
        }

        const pollingGroup = buffer.readUInt16BE(4);
        const nrOfSlots = (buffer.readUInt8(6) & 0x0f) as bits4;

        return new LPollDataReq({
          pollingGroup,
          nrOfSlots,
        });
      }
    },
    "L_Poll_Data.con": class LPollDataCon implements ServiceMessage {
      constructor(value: L_Poll_Data_Con) {
        this.#pollingGroup = value.pollingGroup;
        this.#nrOfSlots = value.nrOfSlots;
        this.control.confirm = value.control.confirm;
      }

      control = new ControlField(0xf0);
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
        octet7 = octet7 | (this.#nrOfSlots & 0x0f);
        buffer.writeUInt8(MESSAGE_CODE_FIELD["L_Poll_Data.con"]["EMI2/IMI2"].value, 0);
        this.control.buffer.copy(buffer, 1);
        buffer.writeUInt8(0, 2);
        buffer.writeUInt8(0, 3);
        buffer.writeUInt8(this.#pollingGroup & 0xff00, 4);
        buffer.writeUInt8(this.#pollingGroup & 0x00ff, 5);
        buffer.writeUInt8(octet7, 6);
        return buffer;
      }

      describe(): Record<string, string> {
        return {
          messageCode: `Codigo de mensaje: ${MESSAGE_CODE_FIELD["L_Poll_Data.con"]["EMI2/IMI2"].value}`,
          control: `Control: ${this.control}`,
          pollingGroup: `${this.#pollingGroup}`,
          nrOfGroup: `${this.#nrOfSlots}`,
        };
      }

      static fromBuffer(buffer: Buffer): LPollDataCon {
        const messageCode = MESSAGE_CODE_FIELD["L_Poll_Data.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for L_Poll_Data.con. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }
        const controlByte = buffer.readInt8(1);
        const pollingGroup = buffer.readUInt16BE(4);
        const nrOfSlots = (buffer.readUInt8(6) & 0x0f) as bits4;

        return new LPollDataCon({
          pollingGroup,
          nrOfSlots,
          control: {
            confirm: controlByte << 7 === 1 ? true : false,
          },
        });
      }
    },
    "L_SystemBroadcast.req": class LSystemBroadcastReq implements ServiceMessage {
      constructor(value: L_SystemBroadcast_req) {
        if (typeof value !== "object" || value === null) {
          throw new Error("L_Data.ind must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0b10000000);
        this.controlField1.priority = value.control.priority;
        this.controlField1.confirm = value.control.confirm;
        this.messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.req"]["EMI2/IMI2"].value;
        if (
          KNXHelper.isValidGroupAddress(value.destinationAddress) ||
          KNXHelper.isValidIndividualAddress(value.destinationAddress)
        ) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType;
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
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0f));
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
          npdu: `NPDU: ${this.npdu.toString("hex")}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): LSystemBroadcastReq {
        const messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for L_SystemBroadcast.req. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField1 = new ControlField(controlFieldByte);

        const octet6 = buffer.readUInt8(6);
        const addressType = (octet6 >> 7) & 0x01;
        const NPCI = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        const destinationAddressBuf = buffer.subarray(4, 6);
        //[cite_start]// Usually System Broadcast destination is 0/0/0 or specific [cite: 297]
        const destinationAddress = KNXHelper.GetAddress(
          destinationAddressBuf,
          addressType === AddressType.GROUP ? "/" : ".",
        );

        const npdu = buffer.subarray(7, 7 + length);

        return new LSystemBroadcastReq({
          control: {
            priority: controlField1.priority,
            confirm: controlField1.confirm,
            ackRequest: controlField1.ackRequest,
          },
          destinationAddress: destinationAddress as string,
          addressType: addressType as 0 | 1,
          NPCI: NPCI as NPCI,
          NPDU: npdu,
        });
      }
    },
    "L_SystemBroadcast.con": class LSystemBroadcastCon implements ServiceMessage {
      constructor(value: L_SystemBroadcast_con) {
        if (typeof value !== "object" || value === null) {
          throw new Error("L_Data.ind must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.repeat = value.control.notRepeat;
        this.controlField1.priority = value.control.priority;
        this.controlField1.confirm = value.control.confirm;
        this.messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.con"]["EMI2/IMI2"].value;
        if (
          KNXHelper.isValidGroupAddress(value.destinationAddress) ||
          KNXHelper.isValidIndividualAddress(value.destinationAddress)
        ) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType;
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
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] = 0x00 | ((this.addressType << 7) | (this.NPCI << 4) | (this.npdu.length & 0x0f));
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
          npdu: `NPDU: ${this.npdu.toString("hex")}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): LSystemBroadcastCon {
        const messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for L_SystemBroadcast.con. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField1 = new ControlField(controlFieldByte);

        const octet6 = buffer.readUInt8(6);
        const addressType = (octet6 >> 7) & 0x01;
        const NPCI = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(
          destinationAddressBuf,
          addressType === AddressType.GROUP ? "/" : ".",
        );

        const npdu = buffer.subarray(7, 7 + length);

        return new LSystemBroadcastCon({
          control: {
            priority: controlField1.priority,
            confirm: controlField1.confirm,
            notRepeat: controlField1.repeat,
          },
          destinationAddress: destinationAddress as string,
          addressType: addressType,
          NPCI: NPCI as NPCI,
          NPDU: npdu,
        });
      }
    },
    "L_SystemBroadcast.ind": class LSystemBroadcastInd implements ServiceMessage {
      constructor(value: L_SystemBroadcast_ind) {
        if (typeof value !== "object" || value === null) {
          throw new Error("L_Data.ind must be an object with specific properties.");
        }
        this.controlField1 = new ControlField(0);
        this.controlField1.priority = value.control.priority;
        if (
          KNXHelper.isValidGroupAddress(value.destinationAddress) ||
          KNXHelper.isValidIndividualAddress(value.destinationAddress)
        ) {
          this.destinationAddress = value.destinationAddress;
        } else {
          throw new Error("The Destination Address is invalid Group Address or Individual Address");
        }
        if (
          KNXHelper.isValidGroupAddress(value.sourceAddress) ||
          KNXHelper.isValidIndividualAddress(value.sourceAddress)
        ) {
          this.sourceAddress = value.sourceAddress;
        } else {
          throw new Error("The Source Address is invalid Group Address or Individual Address");
        }
        this.addressType = value.addressType;
        this.NPCI = value.NPCI;
        this.npdu = value.NPDU;
      }
      messageCode = MESSAGE_CODE_FIELD["L_SystemBroadcast.ind"]["EMI2/IMI2"].value;

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
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);

        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] = 0x00 | (this.NPCI << 4) | (this.npdu.length & 0x0f);
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
          npdu: `NPDU: ${this.npdu.toString("hex")}`,
          octNumber: this.npdu.length.toString(),
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): LSystemBroadcastInd {
        //[cite_start]// Spec[cite: 147]: L_SystemBroadcast.ind -> 28h
        // Note: The class property 'messageCode' above references L_SystemBroadcast.CON (error in original class?),
        // I will try to match the code found in the buffer.

        // Strict check:
        if (buffer.readUInt8(0) !== MESSAGE_CODE_FIELD["L_SystemBroadcast.ind"]["EMI2/IMI2"].value) {
          throw new Error("This messageCode is not L_SystemBroadcast.ind");
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField1 = new ControlField(controlFieldByte);

        const sourceAddressBuf = buffer.subarray(2, 4);
        const sourceAddress = KNXHelper.GetAddress(sourceAddressBuf, ".");

        const octet6 = buffer.readUInt8(6);
        //[cite_start]// Address type not strictly in bit 7 for SystemBroadcast Indication according to [cite: 312] diagram?
        //[cite_start]// Diagram [cite: 313] shows Octet 6 (byte 7 in 1-based, so index 6) has NPCI and LG.
        // Address Type is implicit in System Broadcast?
        // But your constructor demands AddressType.
        // Assuming standard L_Data frame layout for consistency with your class structure.
        const addressType = (octet6 >> 7) & 0x01; // May be always 1 (Group)?
        const NPCI = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(
          destinationAddressBuf,
          addressType === AddressType.GROUP ? "/" : ".",
        );

        const npdu = buffer.subarray(7, 7 + length);

        return new LSystemBroadcastInd({
          control: {
            priority: controlField1.priority,
            confirm: controlField1.confirm,
            notRepeat: controlField1.repeat,
          },
          sourceAddress: sourceAddress as string,
          destinationAddress: destinationAddress as string,
          addressType: addressType,
          NPCI: NPCI as NPCI,
          NPDU: npdu,
        });
      }
    },
  } as const;
  /**
   * In Network Layer mode exactly the N_Data_Individual.req, N_Data_Individual.con,
   * N_Data_Individual.ind, N_Data_Group.req, N_Data_Group.con, N_Data_Group.ind,
   * N_Data_Broadcast.req, N_Data_Broadcast.con, N_Data_Broadcast.ind, N_Poll_Data.req and
   * N_Poll_Data.con messages are available. All NL services belong to EMI/IMI2 only.
   */
  static NetworkLayerEMI = {
    "N_Data_Individual.req": class NDataIndividualReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Individual.req"]["EMI2/IMI2"].value;
      controlField: ControlField;
      destinationAddress: string; // Individual address
      TPDU: Buffer; // Transport Layer Protocol Data Unit

      constructor(value: N_Data_Individual_req_Ctor) {
        if (typeof value !== "object" || value === null) {
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
          APDU: `APDU: ${this.TPDU.toString("hex")}`,
          APDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): NDataIndividualReq {
        const messageCode = MESSAGE_CODE_FIELD["N_Data_Individual.req"]["EMI2/IMI2"].value;
        if (buffer.length < 7) {
          throw new Error("Buffer too short for N_Data_Individual.req message.");
        }
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for N_Data_Individual.req. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField = new ControlField(controlFieldByte);

        // Octets 3-4 (index 2-3) son 0x0000 (unused) en la Request.

        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(destinationAddressBuf, ".");

        const length = buffer.readUInt8(6) & 0x0f; // Octet 7: LG (lower 4 bits)

        if (buffer.length < 7 + length) {
          throw new Error(`Buffer length mismatch. Expected at least ${7 + length} bytes, got ${buffer.length}`);
        }

        const TPDU = buffer.subarray(7, 7 + length);

        return new NDataIndividualReq({
          control: {
            frameType: controlField.frameType,
            repeat: controlField.repeat,
            systemBroadcast: controlField.systemBroadcast,
            priority: controlField.priority,
            ackRequest: controlField.ackRequest,
            confirm: controlField.confirm,
          },
          destinationAddress: destinationAddress as string,
          TPDU: TPDU,
        });
      }
    },
    "N_Data_Individual.con": class NDataIndividualCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Individual.con"]["EMI2/IMI2"].value;
      controlField: ControlField;
      destinationAddress: string; // Destination address
      TPDU: Buffer;

      constructor(value: N_Data_Individual_con_Ctor) {
        if (typeof value !== "object" || value === null) {
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
        buffer.writeUInt8(this.TPDU.length & 0x0f, 6); // Octet 7: LG (octet count)
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
          TPDU: `TPDU: ${this.TPDU.toString("hex")}`,
          TPDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): NDataIndividualCon {
        const messageCode = MESSAGE_CODE_FIELD["N_Data_Individual.con"]["EMI2/IMI2"].value;
        if (buffer.length < 7) {
          throw new Error("Buffer too short for N_Data_Individual.con message.");
        }
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for N_Data_Individual.con. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField = new ControlField(controlFieldByte);

        // Octets 3-4 (index 2-3) son 0x0000 (unused).

        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(destinationAddressBuf, ".");

        const length = buffer.readUInt8(6) & 0x0f; // Octet 7: LG (lower 4 bits)

        if (buffer.length < 7 + length) {
          throw new Error(`Buffer length mismatch. Expected at least ${7 + length} bytes, got ${buffer.length}`);
        }

        const TPDU = buffer.subarray(7, 7 + length);

        return new NDataIndividualCon({
          control: {
            confirm: controlField.confirm,
          },
          destinationAddress: destinationAddress as string,
          TPDU: TPDU,
        });
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
        if (typeof value !== "object" || value === null) {
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
        const buffer = Buffer.alloc(7 + this.TPDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2); // Octets 3-4: Source Address
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        // Octet 7: hop_count_type (bits 6-4) | octet count (LG) (bits 3-0)
        buffer.writeUInt8(((this.hopCount & 0x0f) << 4) | (this.TPDU.length & 0x0f), 6);
        this.TPDU.copy(buffer, 7); // Octet 8...n: TPDU
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
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
          APDU: `APDU: ${this.TPDU.toString("hex")}`,
          APDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): NDataIndividualInd {
        const messageCode = MESSAGE_CODE_FIELD["N_Data_Individual.ind"]["EMI2/IMI2"].value;
        if (buffer.length < 7) {
          throw new Error("Buffer too short for N_Data_Individual.ind message.");
        }
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for N_Data_Individual.ind. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField = new ControlField(controlFieldByte);

        const sourceAddressBuf = buffer.subarray(2, 4);
        const sourceAddress = KNXHelper.GetAddress(sourceAddressBuf, ".");

        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(destinationAddressBuf, ".");

        const octet7 = buffer.readUInt8(6);
        const hopCount = (octet7 >> 4) & 0x0f; // Octet 7: Hop Count (upper 4 bits)
        const length = octet7 & 0x0f; // Octet 7: LG (lower 4 bits)

        if (buffer.length < 7 + length) {
          throw new Error(`Buffer length mismatch. Expected at least ${7 + length} bytes, got ${buffer.length}`);
        }

        const TPDU = buffer.subarray(7, 7 + length);

        return new NDataIndividualInd({
          control: {
            priority: controlField.priority,
          },
          sourceAddress: sourceAddress as string,
          destinationAddress: destinationAddress as string,
          hopCount: hopCount,
          TPDU: TPDU,
        });
      }
    },
    "N_Data_Group.req": class NDataGroupReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Group.req"]["EMI2/IMI2"].value;
      controlField: ControlField;
      destinationAddress: string; // Group address
      APDU: Buffer;

      constructor(value: N_Data_Group_req_Ctor) {
        if (typeof value !== "object" || value === null) {
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
        const buffer = Buffer.alloc(7 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt16BE(0x0000, 2); // Octets 3-4: unused (Source Address)
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        // Octet 7: hop_count_type (bits 7-4, default 0) | octet count (LG) (bits 3-0)
        buffer.writeUInt8(this.APDU.length & 0x0f, 6); // Default hop_count_type is 0
        this.APDU.copy(buffer, 7); // Octet 8...n: TPDU
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
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
          APDU: `APDU: ${this.APDU.toString("hex")}`,
          APDU_Length: `${this.APDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): NDataGroupReq {
        const messageCode = MESSAGE_CODE_FIELD["N_Data_Group.req"]["EMI2/IMI2"].value;
        if (buffer.length < 7) {
          throw new Error("Buffer too short for N_Data_Group.req message.");
        }
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for N_Data_Group.req. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField = new ControlField(controlFieldByte);

        // Octets 3-4 (index 2-3) son 0x0000 (unused) en la Request.

        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(destinationAddressBuf, "/"); // Dirección de Grupo

        const length = buffer.readUInt8(6) & 0x0f; // Octet 7: LG (lower 4 bits), upper 4 bits unused (hop count = 0)

        if (buffer.length < 7 + length) {
          throw new Error(`Buffer length mismatch. Expected at least ${7 + length} bytes, got ${buffer.length}`);
        }

        const APDU = buffer.subarray(7, 7 + length);

        return new NDataGroupReq({
          control: {
            priority: controlField.priority,
          },
          destinationAddress: destinationAddress as string,
          APDU: APDU,
        });
      }
    },
    "N_Data_Group.con": class NDataGroupCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Group.con"]["EMI2/IMI2"].value;
      controlField: ControlField;
      destinationAddress: string; // Group address
      APDU: Buffer;

      constructor(value: N_Data_Group_con_Ctor) {
        if (typeof value !== "object" || value === null) {
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
        const buffer = Buffer.alloc(7 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt16BE(0x0000, 2); // Octets 3-4: unused (Source Address)
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        buffer.writeUInt8(this.APDU.length & 0x0f, 6); // Octet 7: LG (octet count), upper 4 bits unused
        this.APDU.copy(buffer, 7); // Octet 8...n: TPDU
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
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
          APDU: `APDU: ${this.APDU.toString("hex")}`,
          APDU_Length: `${this.APDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): NDataGroupCon {
        const messageCode = MESSAGE_CODE_FIELD["N_Data_Group.con"]["EMI2/IMI2"].value;
        if (buffer.length < 7) {
          throw new Error("Buffer too short for N_Data_Group.con message.");
        }
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for N_Data_Group.con. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField = new ControlField(controlFieldByte);

        // Octets 3-4 (index 2-3) son 0x0000 (unused) en la Confirmation.

        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(destinationAddressBuf, "/"); // Dirección de Grupo

        const length = buffer.readUInt8(6) & 0x0f; // Octet 7: LG (lower 4 bits), upper 4 bits unused

        if (buffer.length < 7 + length) {
          throw new Error(`Buffer length mismatch. Expected at least ${7 + length} bytes, got ${buffer.length}`);
        }

        const APDU = buffer.subarray(7, 7 + length);

        return new NDataGroupCon({
          control: {
            confirm: controlField.confirm,
          },
          destinationAddress: destinationAddress as string,
          APDU: APDU,
        });
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
        if (typeof value !== "object" || value === null) {
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
        const buffer = Buffer.alloc(7 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt16BE(0x0000, 2); // Octets 3-4: unused (Source Address in diagram, but text implies unused for Group.ind)
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4); // Octets 5-6: Destination Address
        // Octet 7: hop_count_type (bits 7-4) | octet count (LG) (bits 3-0)
        buffer.writeUInt8(((this.hopCount & 0x0f) << 4) | (this.APDU.length & 0x0f), 6);
        this.APDU.copy(buffer, 7); // Octet 8...n: TPDU
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
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
          APDU: `APDU: ${this.APDU.toString("hex")}`,
          APDU_Length: `${this.APDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): NDataGroupInd {
        const messageCode = MESSAGE_CODE_FIELD["N_Data_Group.ind"]["EMI2/IMI2"].value;
        if (buffer.length < 7) {
          throw new Error("Buffer too short for N_Data_Group.ind message.");
        }
        if (buffer.readUInt8(0) !== messageCode) {
          throw new Error(
            `Invalid message code for N_Data_Group.ind. Expected ${messageCode}, got ${buffer.readUInt8(0)}`,
          );
        }

        const controlFieldByte = buffer.readUInt8(1);
        const controlField = new ControlField(controlFieldByte);

        // ATENCIÓN: Tu toBuffer para esta clase escribe 0x0000 en el Source Address (índice 2-3).
        // Sin embargo, la especificación KNX (y tu constructor) requiere una Source Address (Individual).
        // Asumiré la estructura CORRECTA del protocolo (Source Address en 2-3) para la lectura.
        const sourceAddressBuf = buffer.subarray(2, 4);
        const sourceAddress = KNXHelper.GetAddress(sourceAddressBuf, "."); // Dirección Individual

        const destinationAddressBuf = buffer.subarray(4, 6);
        const destinationAddress = KNXHelper.GetAddress(destinationAddressBuf, "/"); // Dirección de Grupo

        const octet7 = buffer.readUInt8(6);
        const hopCount = (octet7 >> 4) & 0x0f; // Octet 7: Hop Count (upper 4 bits)
        const length = octet7 & 0x0f; // Octet 7: LG (lower 4 bits)

        if (buffer.length < 7 + length) {
          throw new Error(`Buffer length mismatch. Expected at least ${7 + length} bytes, got ${buffer.length}`);
        }

        const APDU = buffer.subarray(7, 7 + length);

        return new NDataGroupInd({
          control: {
            priority: controlField.priority,
          },
          sourceAddress: sourceAddress as string,
          destinationAddress: destinationAddress as string,
          hopCount: hopCount,
          APDU: APDU,
        });
      }
    },
    "N_Data_Broadcast.req": class NDataBroadcastReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Broadcast.req"]["EMI2/IMI2"].value;
      controlField: ControlField;
      hopCount: NPCI;
      TPDU: Buffer;

      constructor(value: N_Data_Broadcast_req_Ctor) {
        if (typeof value !== "object" || value === null) {
          throw new Error("N_Data_Broadcast.req must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.priority = value.control.priority;
        // The spec (3.3.5.8) for N_Data_Broadcast.req control field is "unused priority unused".
        // Therefore, ackRequest should not be set here.
        this.hopCount = value.hopCountType;
        this.TPDU = value.TPDU;
      }

      /**
       * Converts the N_Data_Broadcast.req message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Unused (2) + Unused (2) + hopCount/LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + APDU.length + 1 = 8 + APDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.TPDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        buffer.writeUInt16BE(0x0000, 2); // Octets 3-4: unused (Source Address)
        buffer.writeUInt16BE(0x0000, 4); // Octets 5-6: unused (Destination Address)
        // Octet 7: hop_count_type (bits 7-4, default 0) | octet count (LG) (bits 3-0)
        buffer.writeUInt8((this.hopCount << 4) | (this.TPDU.length & 0x0f), 6); // Default hop_count_type is 0
        this.TPDU.copy(buffer, 7); // Octet 8...n: TPDU
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
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
          TPDU: `TPDU: ${this.TPDU.toString("hex")}`,
          TPDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): NDataBroadcastReq {
        const expectedCode = MESSAGE_CODE_FIELD["N_Data_Broadcast.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error(`Invalid message code.`);

        const controlField = new ControlField(buffer.readUInt8(1));

        // Broadcast suele asumir destino 0/0/0 implícito o explícito en bytes 4-5
        // const dest = KNXHelper.GetAddress(buffer.subarray(4, 6), "/");

        const octet6 = buffer.readUInt8(6);
        const hopCount = octet6 & 0x70;
        const length = octet6 & 0x0f;
        const TPDU = buffer.subarray(7, 7 + length);

        return new NDataBroadcastReq({
          control: {
            priority: controlField.priority,
          },
          hopCountType: hopCount as NPCI,
          TPDU: TPDU,
        });
      }
    },
    "N_Data_Broadcast.con": class NDataBroadcastCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Broadcast.con"]["EMI2/IMI2"].value;
      controlField: ControlField;
      TPDU: Buffer;

      constructor(value: N_Data_Broadcast_con_Ctor) {
        if (typeof value !== "object" || value === null) {
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
        buffer.writeUInt8(this.TPDU.length & 0x0f, 6); // Octet 7: LG (octet count), upper 4 bits unused
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
          APDU: `APDU: ${this.TPDU.toString("hex")}`,
          APDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      /**
       * Creates an instance of NDataBroadcastCon from a Buffer.
       * Expected Structure based on spec and toBuffer:
       * [0]: Message Code
       * [1]: Control Field (Confirm/Error)
       * [2-3]: Unused (Source Address placeholder)
       * [4-5]: Unused (Destination Address placeholder)
       * [6]: Length (lower 4 bits)
       * [7...]: TPDU
       */
      static fromBuffer(buffer: Buffer): NDataBroadcastCon {
        const expectedCode = MESSAGE_CODE_FIELD["N_Data_Broadcast.con"]["EMI2/IMI2"].value;
        const actualCode = buffer.readUInt8(0);

        if (actualCode !== expectedCode) {
          throw new Error(
            `Invalid message code for N_Data_Broadcast.con. Expected 0x${expectedCode.toString(16)}, got 0x${actualCode.toString(16)}`,
          );
        }

        if (buffer.length < 7) {
          throw new Error("Buffer too short for N_Data_Broadcast.con");
        }

        // Octet 1: Control Field. Recuperamos el estado de 'confirm' (error flag)
        const controlField = new ControlField(buffer.readUInt8(1));

        // Octet 2-3 y 4-5: Ignoramos Source y Destination ya que son 'unused' en esta trama

        // Octet 6: Length
        const length = buffer.readUInt8(6) & 0x0f;

        // Validación de integridad de datos
        if (buffer.length < 7 + length) {
          throw new Error(`Buffer mismatch: Expected ${length} bytes of TPDU, available ${buffer.length - 7}`);
        }

        const TPDU = buffer.subarray(7, 7 + length);

        return new NDataBroadcastCon({
          control: {
            confirm: controlField.confirm,
          },
          TPDU: TPDU,
        });
      }
    },
    "N_Data_Broadcast.ind": class NDataBroadcastInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Data_Broadcast.ind"]["EMI2/IMI2"].value;
      controlField: ControlField;
      sourceAddress: string; // Individual address
      hopCount: number; // 4 bits (formerly NPCI)
      TPDU: Buffer;

      constructor(value: N_Data_Broadcast_ind_Ctor) {
        if (typeof value !== "object" || value === null) {
          throw new Error("N_Data_Broadcast.ind must be an object with specific properties.");
        }
        this.controlField = new ControlField(0);
        this.controlField.priority = value.control.priority;

        if (!KNXHelper.isValidIndividualAddress(value.sourceAddress)) {
          throw new Error("The Source Address must be a valid Individual Address");
        }
        this.sourceAddress = value.sourceAddress;
        this.hopCount = value.hopCount;
        this.TPDU = value.TPDU;
      }

      /**
       * Converts the N_Data_Broadcast.ind message to a Buffer.
       * Format: Message Code (1) + Control Field (1) + Source Addr (2) + Unused (2) + hopCount/LG (1) + APDU (variable) + FCS (1)
       * Total Length: 1 + 1 + 2 + 2 + 1 + TPDU.length + 1 = 8 + TPDU.length
       * @returns The Buffer representation of the message.
       */
      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.TPDU.length);
        buffer.writeUInt8(this.messageCode, 0); // Octet 1: m_code
        this.controlField.buffer.copy(buffer, 1); // Octet 2: Control
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2); // Octets 3-4: Source Address
        buffer.writeUInt16BE(0x0000, 4); // Octets 5-6: unused (Destination Address)
        // Octet 7: hop_count_type (bits 7-4) | octet count (LG) (bits 3-0)
        buffer.writeUInt8(((this.hopCount & 0x0f) << 4) | (this.TPDU.length & 0x0f), 6);
        this.TPDU.copy(buffer, 7); // Octet 8...n: TPDU
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
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
          TPDU: `TPDU: ${this.TPDU.toString("hex")}`,
          TPDU_Length: `${this.TPDU.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): NDataBroadcastInd {
        const expectedCode = MESSAGE_CODE_FIELD["N_Data_Broadcast.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error(`Invalid message code.`);

        const controlField = new ControlField(buffer.readUInt8(1));
        const sourceAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        if (!sourceAddress)
          throw new Error(
            "The sourceAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddress !== "string")
          throw new Error("The sourceAddress is not string, this fatal error is from GetAddress, dont be ignore it");

        const octet6 = buffer.readUInt8(6);
        const hopCount = octet6 & 0x70;
        const length = octet6 & 0x0f;
        const TPDU = buffer.subarray(7, 7 + length);

        return new NDataBroadcastInd({
          control: { priority: controlField.priority },
          sourceAddress: sourceAddress,
          hopCount: hopCount,
          TPDU: TPDU,
        });
      }
    },
    "N_Poll_Data.req": class NPollDataReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Poll_Data.req"]["EMI2/IMI2"].value;
      control = 0xf0; // Fixed control byte for N_Poll_Data.req (similar to L_Poll_Data)
      #pollingGroup: Buffer = Buffer.alloc(1, 0);
      #nrOfSlots: bits4 = 0;

      constructor(value: N_Poll_Data_Req) {
        if (typeof value !== "object" || value === null) {
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
        return KNXHelper.GetAddress(this.#pollingGroup, "/", true) as string; // Se supone que es un dirección de grupo;
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
        octet7 = octet7 | (this.#nrOfSlots & 0x0f); // NrOfSlots in lower 4 bits
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
          control: `Control: ${this.control.toString(16).padStart(2, "0")}`,
          pollingGroup: `Grupo de sondeo: ${this.#pollingGroup}`,
          nrOfSlots: `Número de ranuras: ${this.#nrOfSlots}`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      static fromBuffer(buffer: Buffer): NPollDataReq {
        const expectedCode = MESSAGE_CODE_FIELD["N_Poll_Data.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error(`Invalid message code.`);

        // Estructura: MC (1) | Control (1) | Source (2) | PollingGroup (2) | Count (1) | Data...
        // Nota: Revisa tu especificación exacta, a veces Poll Data tiene estructura propia
        // !! No es necesario el control field ya que es fijo
        // const control = buffer.readUInt8(1); // O new ControlField(...)
        const pollingGroup = KNXHelper.GetAddress(buffer.subarray(4, 6), "/");
        if (!pollingGroup)
          throw new Error(
            "The pollingGroup is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof pollingGroup !== "string")
          throw new Error("The pollingGroup is not string, this fatal error is from GetAddress, dont be ignore it");
        const octet6 = buffer.readUInt8(6);
        const nrOfSlots = octet6 & 0x0f; // Ejemplo, ver spec

        return new NPollDataReq({
          // Ajustar propiedades al constructor
          pollingGroup: pollingGroup,
          nrOfSlots: nrOfSlots as bits4,
        });
      }
    },
    "N_Poll_Data.con": class NPollDataCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["N_Poll_Data.con"]["EMI2/IMI2"].value;
      control = 0xf0; // Fixed control byte for N_Poll_Data.con
      #pollingGroup: Buffer = Buffer.alloc(1, 0);
      #nrOfSlots: bits4 = 0;
      pollData: Buffer; // Polled data

      constructor(value: N_Poll_Data_Con) {
        if (typeof value !== "object" || value === null) {
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
        return KNXHelper.GetAddress(this.#pollingGroup, "/", true) as string; // Se supone que es un dirección de grupo;
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

        buffer.writeUInt8(this.messageCode, 0); // Octet 1
        buffer.writeUInt8(this.control, 1); // Octet 2

        // Rellenar Octetos 3-4 (Source) con ceros explícitos si es necesario
        buffer.writeUInt16BE(0x0000, 2);

        this.#pollingGroup.copy(buffer, 4); // Octets 5-6

        const octet7 = this.#nrOfSlots & 0x0f;
        buffer.writeUInt8(octet7, 6); // Octet 7

        this.pollData.copy(buffer, 7); // Octet 8...
        return buffer;
      }

      /**
       * Provides a human-readable description of the N_Poll_Data.con message.
       * @returns A record of message properties and their string values.
       */
      describe(): Record<string, string> {
        return {
          messageCode: `Codigo de mensaje: ${this.messageCode}`,
          control: `Control: ${this.control.toString(16).padStart(2, "0")}`,
          pollingGroup: `Grupo de sondeo: ${this.#pollingGroup}`,
          nrOfSlots: `Número de ranuras: ${this.#nrOfSlots}`,
          pollData: `pollData: ${this.pollData.toString("hex")}`,
          pollData_Length: `${this.pollData.length} octets`,
          rawValue: `Valor numérico: ${this.toBuffer().toString("hex")}`,
        };
      }

      /**
       * Creates an instance of NPollDataCon from a Buffer.
       * Expected Structure:
       * [0]: Message Code
       * [1]: Control Field (Fixed 0xF0 usually)
       * [2-3]: Unused / Source Address (Ignored in Con)
       * [4-5]: Polling Group Address
       * [6]: NrOfSlots (lower 4 bits)
       * [7...]: Poll Data
       */
      static fromBuffer(buffer: Buffer): NPollDataCon {
        const expectedCode = MESSAGE_CODE_FIELD["N_Poll_Data.con"]["EMI2/IMI2"].value;
        const actualCode = buffer.readUInt8(0);

        if (actualCode !== expectedCode) {
          throw new Error(
            `Invalid message code for N_Poll_Data.con. Expected 0x${expectedCode.toString(16)}, got 0x${actualCode.toString(16)}`,
          );
        }

        if (buffer.length < 7) {
          throw new Error("Buffer too short for N_Poll_Data.con");
        }

        // Octet 1: Control (Se ignora o valida según necesidad, el constructor lo fija a 0xF0)
        // Octet 2-3: Source Address (Se ignora en esta implementación de Con)

        // Octet 4-5: Polling Group
        // Asumimos que es una dirección de grupo, usamos separador "/"
        const pollingGroupStr = KNXHelper.GetAddress(buffer.subarray(4, 6), "/");
        if (!pollingGroupStr)
          throw new Error(
            "The pollingGroupStr is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof pollingGroupStr !== "string")
          throw new Error("The pollingGroupStr is not string, this fatal error is from GetAddress, dont be ignore it");

        // Octet 6: NrOfSlots (bits 0-3)
        // Nota: El usuario usa los bits bajos. En spec estándar a veces es Length.
        // Nos ceñimos a tu lógica de 'nrOfSlots & 0x0f'.
        const nrOfSlots = buffer.readUInt8(6) & 0x0f;

        // Octet 7...: Poll Data
        // Todo lo que resta del buffer es data
        const pollData = buffer.subarray(7);

        return new NPollDataCon({
          pollingGroup: pollingGroupStr,
          nrOfSlots: nrOfSlots as bits4, // Cast a 'bits4' o number según tu tipo
          pollData: pollData,
        });
      }
    },
  } as const;
  static TransportLayerEMI = {
    "T_Connect.req": class TConnectReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Connect.req"]["EMI2/IMI2"].value;
      control = 0x00;
      destinationAddress: string;

      constructor(value: T_Connect_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TConnectReq.name);
        }
        this.destinationAddress = value.destinationAddress;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.control, 1);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }
      describe(): Record<string, string | number> {
        return {
          messageCode: this.messageCode,
          control: this.control,
          destinationAddress: this.destinationAddress,
        };
      }

      static fromBuffer(buffer: Buffer): TConnectReq {
        const expectedCode = MESSAGE_CODE_FIELD["T_Connect.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Message Code");

        // T_Connect.req es de 6 bytes: MC | Ctrl | Unused(2) | Dest(2)
        if (buffer.length < 6) throw new Error("Buffer too short for T_Connect.req");

        // Destination está en bytes 4-5
        const destinationAddress = KNXHelper.GetAddress(buffer.subarray(4, 6), ".");

        if (!destinationAddress)
          throw new Error(
            "The destinationAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof destinationAddress !== "string")
          throw new Error(
            "The destinationAddress is not string, this fatal error is from GetAddress, dont be ignore it",
          );

        return new TConnectReq({
          destinationAddress: destinationAddress,
        });
      }
    },
    "T_Connect.con": class TConnectCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Connect.con"]["EMI2/IMI2"].value;
      control = 0x00;
      destinationAddress: string;

      constructor(value: T_Connect_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TConnectCon.name);
        }
        this.destinationAddress = value.destinationAddress;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6);
        buffer.writeUInt8(this.messageCode, 0);
        buffer.writeUInt8(this.control, 1);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 2);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }
      describe(): Record<string, string | number> {
        return {
          messageCode: this.messageCode,
          control: this.control,
          destinationAddress: this.destinationAddress,
        };
      }

      static fromBuffer(buffer: Buffer): TConnectCon {
        const expectedCode = MESSAGE_CODE_FIELD["T_Connect.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Message Code");
        if (buffer.length < 6) throw new Error("Buffer too short for T_Connect.con");

        // Según tu toBuffer, escribes la dirección en el offset 2 (posición Source)
        const destinationAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        if (!destinationAddress)
          throw new Error(
            "The destinationAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof destinationAddress !== "string")
          throw new Error(
            "The destinationAddress is not string, this fatal error is from GetAddress, dont be ignore it",
          );

        return new TConnectCon({
          destinationAddress: destinationAddress,
        });
      }
    },
    "T_Connect.ind": class TConnectInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Connect.ind"]["EMI2/IMI2"].value;
      control = new ControlField();
      sourceAddress: string;

      constructor(value: T_Connect_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TConnectInd.name);
        }
        this.sourceAddress = value.sourceAddress;
        this.control.ackRequest = value.control.ackRequest;
        this.control.frameType = value.control.frameType;
        this.control.repeat = value.control.repeat;
        this.control.systemBroadcast = value.control.systemBroadcast;
        this.control.priority = value.control.priority;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }
      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control,
          sourceAddress: this.sourceAddress,
        };
      }

      static fromBuffer(buffer: Buffer): TConnectInd {
        const expectedCode = MESSAGE_CODE_FIELD["T_Connect.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Message Code");
        if (buffer.length < 6) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));
        // Source Address en bytes 2-3
        const sourceAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        if (!sourceAddress)
          throw new Error(
            "The sourceAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddress !== "string")
          throw new Error("The sourceAddress is not string, this fatal error is from GetAddress, dont be ignore it");

        return new TConnectInd({
          control: {
            ackRequest: control.ackRequest,
            frameType: control.frameType,
            repeat: control.repeat,
            systemBroadcast: control.systemBroadcast,
            priority: control.priority,
            confirm: control.confirm,
          },
          sourceAddress: sourceAddress,
        });
      }
    },
    "T_Disconnect.req": class TDisconnectReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Disconnect.req"]["EMI2/IMI2"].value;
      control = 0x00;

      constructor(value: object) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDisconnectReq.name);
        }
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6);
        buffer.writeUInt8(this.messageCode, 0);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }
      describe() {
        return {
          messageCode: this.messageCode,
        };
      }

      static fromBuffer(buffer: Buffer): TDisconnectReq {
        const expectedCode = MESSAGE_CODE_FIELD["T_Disconnect.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 6) throw new Error("Buffer too short");

        // No hay datos adicionales en req
        return new TDisconnectReq({});
      }
    },
    "T_Disconnect.con": class TDisconnectCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Disconnect.con"]["EMI2/IMI2"].value;
      control = new ControlField();

      constructor(value: T_Disconnect_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDisconnectCon.name);
        }
        this.control.ackRequest = value.control.ackRequest;
        this.control.frameType = value.control.frameType;
        this.control.repeat = value.control.repeat;
        this.control.systemBroadcast = value.control.systemBroadcast;
        this.control.priority = value.control.priority;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }
      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control,
        };
      }

      static fromBuffer(buffer: Buffer): TDisconnectCon {
        const expectedCode = MESSAGE_CODE_FIELD["T_Disconnect.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 6) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));

        return new TDisconnectCon({
          control: {
            ackRequest: control.ackRequest,
            frameType: control.frameType,
            repeat: control.repeat,
            systemBroadcast: control.systemBroadcast,
            priority: control.priority,
            confirm: control.confirm,
          },
        });
      }
    },
    "T_Disconnect.ind": class TDisconnectInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Disconnect.ind"]["EMI2/IMI2"].value;
      control = new ControlField();

      constructor(value: T_Disconnect_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDisconnectInd.name);
        }
        this.control.ackRequest = value.control.ackRequest;
        this.control.frameType = value.control.frameType;
        this.control.repeat = value.control.repeat;
        this.control.systemBroadcast = value.control.systemBroadcast;
        this.control.priority = value.control.priority;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }
      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control,
        };
      }

      static fromBuffer(buffer: Buffer): TDisconnectInd {
        const expectedCode = MESSAGE_CODE_FIELD["T_Disconnect.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 6) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));

        return new TDisconnectInd({
          control: {
            ackRequest: control.ackRequest,
            frameType: control.frameType,
            repeat: control.repeat,
            systemBroadcast: control.systemBroadcast,
            priority: control.priority,
            confirm: control.confirm,
          },
        });
      }
    },
    "T_Data_Connected.req": class TDataConnectedReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Data_Connected.req"]["EMI2/IMI2"].value;
      control = new ControlField();
      APDU: Buffer;
      hopCount: number;

      constructor(value: T_Data_Connected_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TDataConnectedReq.name);
        }
        this.control.priority = value.control.priority;
        this.APDU = value.APDU;
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (buffer.length & 0x0f);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1); // Calculate FCS
        return buffer;
      }
      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control,
          hopCount: this.hopCount,
        };
      }
      static fromBuffer(buffer: Buffer): TDataConnectedReq {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Connected.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        // Requiere al menos 7 bytes (Header 6 + Len 1) + Data
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));

        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        // Validar integridad
        if (buffer.length < 7 + length) throw new Error("Buffer data incomplete");

        const apdu = buffer.subarray(7, 7 + length);

        return new TDataConnectedReq({
          control: { priority: control.priority },
          hopCount: hopCount as NPCI,
          APDU: apdu,
        });
      }
    },
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
        buffer[6] |= this.APDU.length & 0x0f;
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          APDU: this.APDU.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): TDataConnectedCon {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Connected.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));
        const length = buffer.readUInt8(6) & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new TDataConnectedCon({
          control: { confirm: control.confirm },
          APDU: apdu,
        });
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
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        // Octeto 5-6 no utilizados
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0f);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          APDU: this.APDU.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): TDataConnectedInd {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Connected.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));
        // Tu toBuffer escribe Source en offset 2
        const sourceAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        if (!sourceAddress)
          throw new Error(
            "The sourceAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddress !== "string")
          throw new Error("The sourceAddress is not string, this fatal error is from GetAddress, dont be ignore it");

        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        const apdu = buffer.subarray(7, 7 + length);

        return new TDataConnectedInd({
          control: { priority: control.priority },
          sourceAddress: sourceAddress,
          hopCount: hopCount as NPCI,
          APDU: apdu,
        });
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
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0f);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          hopCount: this.hopCount,
          APDU: this.APDU.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): TDataGroupReq {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Group.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));

        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new TDataGroupReq({
          control: { priority: control.priority },
          hopCount: hopCount,
          APDU: apdu,
        });
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
        this.data = value.data;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.data.length); // Tamaño mínimo según documento
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        buffer[6] = this.data.length & 0x0f;
        buffer[7] = 0; // El buffer en la posicion 8 debe ser la otra parte del APCI con APDU
        KNXHelper.WriteData(buffer, this.data, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
        };
      }

      static fromBuffer(buffer: Buffer): TDataGroupCon {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Group.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));
        const length = buffer.readUInt8(6) & 0x0f;
        const data = buffer.subarray(7, 7 + length);

        return new TDataGroupCon({
          control: { confirm: control.confirm },
          data: data,
        });
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
        buffer[6] |= this.APDU.length & 0x0f;
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          APDU: this.APDU.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): TDataGroupInd {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Group.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));

        const octet6 = buffer.readUInt8(6);
        const length = octet6 & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new TDataGroupInd({
          control: { priority: control.priority },
          APDU: apdu,
        });
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
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0f);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          destinationAddress: this.destinationAddress,
          hopCount: this.hopCount,
          APDU: this.APDU.toString("hex"),
        };
      }
      static fromBuffer(buffer: Buffer): TDataIndividualReq {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Individual.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));
        // Tu toBuffer usa offset 4 para Destino
        const destinationAddress = KNXHelper.GetAddress(buffer.subarray(4, 6), ".");
        if (!destinationAddress)
          throw new Error(
            "The destinationAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof destinationAddress !== "string")
          throw new Error(
            "The destinationAddress is not string, this fatal error is from GetAddress, dont be ignore it",
          );
        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new TDataIndividualReq({
          control: { priority: control.priority },
          destinationAddress: destinationAddress,
          hopCount: hopCount,
          APDU: apdu,
        });
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
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer[6] = this.APDU.length & 0x0f;
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          destinationAddress: this.destinationAddress,
        };
      }

      static fromBuffer(buffer: Buffer): TDataIndividualCon {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Individual.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));
        // Tu toBuffer usa offset 4 para Destino en .con
        const destinationAddress = KNXHelper.GetAddress(buffer.subarray(4, 6), ".");
        if (!destinationAddress)
          throw new Error(
            "The destinationAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof destinationAddress !== "string")
          throw new Error(
            "The destinationAddress is not string, this fatal error is from GetAddress, dont be ignore it",
          );
        const length = buffer.readUInt8(6) & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new TDataIndividualCon({
          control: { confirm: control.confirm },
          destinationAddress: destinationAddress,
          APDU: apdu,
        });
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
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0f);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          destinationAddress: this.destinationAddress,
          APDU: this.APDU.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): TDataIndividualInd {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Individual.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));
        // Ind: Source en 2, Dest en 4
        const sourceAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        const destinationAddress = KNXHelper.GetAddress(buffer.subarray(4, 6), ".");
        if (!destinationAddress)
          throw new Error(
            "The destinationAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof destinationAddress !== "string")
          throw new Error(
            "The destinationAddress is not string, this fatal error is from GetAddress, dont be ignore it",
          );
        if (!sourceAddress)
          throw new Error(
            "The sourceAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddress !== "string")
          throw new Error("The sourceAddress is not string, this fatal error is from GetAddress, dont be ignore it");
        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new TDataIndividualInd({
          control: { priority: control.priority },
          sourceAddress: sourceAddress,
          destinationAddress: destinationAddress,
          hopCount: hopCount as NPCI,
          APDU: apdu,
        });
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
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0f); // podría no ser usado
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          hopCount: this.hopCount,
          APDU: this.APDU.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): TDataBroadcastReq {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Broadcast.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));

        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new TDataBroadcastReq({
          control: { priority: control.priority },
          hopCount: hopCount,
          APDU: apdu,
        });
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
        this.APDU = value.APDU;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
        };
      }

      static fromBuffer(buffer: Buffer): TDataBroadcastCon {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Broadcast.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));

        const length = buffer.readUInt8(6) & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new TDataBroadcastCon({
          control: { confirm: control.confirm },
          APDU: apdu,
        });
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
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0f);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          APDU: this.APDU.toString("hex"),
        };
      }
      static fromBuffer(buffer: Buffer): TDataBroadcastInd {
        const expectedCode = MESSAGE_CODE_FIELD["T_Data_Broadcast.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));
        const sourceAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        if (!sourceAddress)
          throw new Error(
            "The sourceAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddress !== "string")
          throw new Error("The sourceAddress is not string, this fatal error is from GetAddress, dont be ignore it");

        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new TDataBroadcastInd({
          control: { priority: control.priority },
          sourceAddress: sourceAddress,
          hopCount: hopCount as NPCI,
          APDU: apdu,
        });
      }
    },
    "T_Poll_Data.req": class TPollDataReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Poll_Data.req"]["EMI2/IMI2"].value;
      control = new ControlField(0xf0);
      pollingGroup: string;
      numberOfSlots: number;

      constructor(value: T_Poll_Data_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TPollDataReq.name);
        }
        this.pollingGroup = value.pollingGroup;
        this.numberOfSlots = value.numberOfSlots;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.pollingGroup).copy(buffer, 4);
        buffer[6] = this.numberOfSlots & 0x0f;
        // No hay checksum en este mensaje según el documento
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          pollingGroup: this.pollingGroup,
          numberOfSlots: this.numberOfSlots,
        };
      }

      static fromBuffer(buffer: Buffer): TPollDataReq {
        const expectedCode = MESSAGE_CODE_FIELD["T_Poll_Data.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");

        // Estructura: MC(0) | Ctrl(1) | Unused(2-3) | PollGroup(4-5) | Slots(6)
        // Usamos separador "/" para grupos
        const control = new ControlField(buffer.readUInt8(1));
        const pollingGroup = KNXHelper.GetAddress(buffer.subarray(4, 6), "/");
        if (!pollingGroup)
          throw new Error(
            "The pollingGroup is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof pollingGroup !== "string")
          throw new Error("The pollingGroup is not string, this fatal error is from GetAddress, dont be ignore it");
        const slots = buffer.readUInt8(6) & 0x0f;

        return new TPollDataReq({
          control,
          pollingGroup: pollingGroup,
          numberOfSlots: slots as NPCI,
        });
      }
    },
    "T_Poll_Data.con": class TPollDataCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["T_Poll_Data.con"]["EMI2/IMI2"].value;
      control = new ControlField(0xf0);
      sourceAddress: string;
      pollingGroup: string;
      pollData: Buffer;
      nrOfSlots: number;

      constructor(value: T_Poll_Data_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(TPollDataCon.name);
        }
        this.sourceAddress = value.sourceAddress;
        this.pollingGroup = value.pollingGroup;
        this.pollData = value.pollData;
        this.nrOfSlots = value.nrOfSlots;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.pollData.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        KNXHelper.GetAddress_(this.pollingGroup).copy(buffer, 4);
        buffer[6] = this.nrOfSlots & 0x0f;
        this.pollData.copy(buffer, 7);
        // No hay checksum en este mensaje según el documento

        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          pollingGroup: this.pollingGroup,
          pollData: this.pollData.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): TPollDataCon {
        const expectedCode = MESSAGE_CODE_FIELD["T_Poll_Data.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 7) throw new Error("Buffer too short");
        const control = new ControlField(buffer.readUInt8(1));
        const sourceAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        const pollingGroup = KNXHelper.GetAddress(buffer.subarray(4, 6), "/");
        if (!sourceAddress)
          throw new Error(
            "The sourceAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddress !== "string")
          throw new Error("The sourceAddress is not string, this fatal error is from GetAddress, dont be ignore it");
        if (!pollingGroup)
          throw new Error(
            "The pollingGroup is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof pollingGroup !== "string")
          throw new Error("The pollingGroup is not string, this fatal error is from GetAddress, dont be ignore it");
        const slots = buffer.readUInt8(6) & 0x0f;
        const data = buffer.subarray(7);

        return new TPollDataCon({
          control,
          sourceAddress: sourceAddress,
          pollingGroup: pollingGroup,
          nrOfSlots: slots as NPCI,
          pollData: data,
        });
      }
    },
  } as const;

  /**
   * The full Application Layer EMI consists of the group-oriented Application Layer and the management parts.
   * The group-oriented Application Layer part consists of exactly the A_Data_Group.req,
   * A_Data_Group.ind, A_Data_Group.con, A_Poll_Data.req and A_Poll_Data.con services.
   * The management part consists of exactly the M_Connect.ind, M_Disconnect.ind,
   * M_User_Data_Connected.req, M_User_Data_Connected.ind, M_User_Data_Connected.con,
   * M_User_Data_Individual.req, M_User_Data_Individual.ind and M_User_Data_Individual.con services.
   */
  static ApplicationLayerEMI = {
    "M_Connect.ind": class MConnectInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["M_Connect.ind"]["EMI2/IMI2"].value;
      sourceAddress: string;

      constructor(value: M_Connect_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(MConnectInd.name);
        }
        this.sourceAddress = value.sourceAddress;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6);
        buffer.writeUInt8(this.messageCode, 0);
        // Octeto 2 no utilizado
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        // Octetos 5-6 no utilizados o 0x00
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          sourceAddress: this.sourceAddress,
        };
      }

      static fromBuffer(buffer: Buffer): MConnectInd {
        const expectedCode = MESSAGE_CODE_FIELD["M_Connect.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Message Code");
        if (buffer.length < 6) throw new Error("Buffer too short");

        // Según tu toBuffer, Source está en offset 2
        const sourceAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        if (!sourceAddress)
          throw new Error(
            "The sourceAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddress !== "string")
          throw new Error("The sourceAddress is not string, this fatal error is from GetAddress, dont be ignore it");
        return new MConnectInd({
          sourceAddress: sourceAddress,
        });
      }
    },
    "M_Disconnect.ind": class MDisconnectInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["M_Disconnect.ind"]["EMI2/IMI2"].value;

      constructor() {
        // No tiene parámetros
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(6);
        buffer.writeUInt8(this.messageCode, 0);
        // Octetos 2-6 no utilizados o 0x00
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
        };
      }

      static fromBuffer(buffer: Buffer): MDisconnectInd {
        const expectedCode = MESSAGE_CODE_FIELD["M_Disconnect.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        // Sin datos extra
        return new MDisconnectInd();
      }
    },
    "M_User_Data_Connected.req": class MUserDataConnectedReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["M_User_Data_Connected.req"]["EMI2/IMI2"].value;
      control = new ControlField();
      APDU: Buffer;
      hopCount: number;

      constructor(value: M_User_Data_Connected_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(MUserDataConnectedReq.name);
        }
        this.control.priority = value.control.priority;
        this.APDU = value.APDU;
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        // Octetos 2-5 no utilizados
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.APDU.length & 0x0f);
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer[7] = 0x02;
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          hopCount: this.hopCount,
          APDU: this.APDU.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): MUserDataConnectedReq {
        const expectedCode = MESSAGE_CODE_FIELD["M_User_Data_Connected.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 8) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));

        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        // Validación del byte hardcodeado en tu toBuffer
        if (buffer.readUInt8(7) !== 0x02) {
          console.warn("Byte 7 en M_User_Data_Connected.req no es 0x02");
        }

        // Asumiendo que APDU sigue al byte 7 (offset 8?) o si WriteData escribe en 7...
        // Tu toBuffer escribe Data en 7 pero luego pone 0x02 en 7. ¡ESTO ES UN BUG EN TU TOBUFFER!
        // Asumiré para leer que la Data real empieza en 8 dado el conflicto, o leeremos desde 7 si el 0x02 es parte de la data.
        // Estandarizando: Leemos el buffer restante como APDU.
        const apdu = buffer.subarray(7, 7 + length);

        return new MUserDataConnectedReq({
          control: { priority: control.priority },
          hopCount: hopCount,
          APDU: apdu,
        });
      }
    },
    "M_User_Data_Connected.con": class MUserDataConnectedCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["M_User_Data_Connected.con"]["EMI2/IMI2"].value;
      control = new ControlField();
      APDU: Buffer;

      constructor(value: M_User_Data_Connected_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(MUserDataConnectedCon.name);
        }
        this.control.confirm = value.control.confirm;
        this.APDU = value.APDU;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        // Octetos 3-6 no utilizados
        buffer[6] |= this.APDU.length & 0x0f;
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer[7] = 0x02;
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          APDU: this.APDU.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): MUserDataConnectedCon {
        const expectedCode = MESSAGE_CODE_FIELD["M_User_Data_Connected.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");

        const control = new ControlField(buffer.readUInt8(1));
        const length = buffer.readUInt8(6) & 0x0f;

        // Mismo conflicto del byte 7 (0x02). Leemos length bytes desde 7.
        const apdu = buffer.subarray(7, 7 + length);

        return new MUserDataConnectedCon({
          control: { confirm: control.confirm },
          APDU: apdu,
        });
      }
    },
    "M_User_Data_Connected.ind": class MUserDataConnectedInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["M_User_Data_Connected.ind"]["EMI2/IMI2"].value;
      control = new ControlField();
      sourceAddress: string;
      APDU: Buffer;

      constructor(value: M_User_Data_Connected_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(MUserDataConnectedInd.name);
        }
        this.control.priority = value.control.priority;
        this.sourceAddress = value.sourceAddress;
        this.APDU = value.APDU;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.APDU.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        // Octetos 5-6 no utilizados
        buffer[6] |= this.APDU.length & 0x0f;
        KNXHelper.WriteData(buffer, this.APDU, 7);
        buffer[7] = 0x02;
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          APDU: this.APDU.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): MUserDataConnectedInd {
        const expectedCode = MESSAGE_CODE_FIELD["M_User_Data_Connected.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");

        const control = new ControlField(buffer.readUInt8(1));
        const sourceAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        if (!sourceAddress)
          throw new Error(
            "The sourceAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddress !== "string")
          throw new Error("The sourceAddress is not string, this fatal error is from GetAddress, dont be ignore it");
        const length = buffer.readUInt8(6) & 0x0f;
        const apdu = buffer.subarray(7, 7 + length);

        return new MUserDataConnectedInd({
          control: { priority: control.priority },
          sourceAddress: sourceAddress,
          APDU: apdu,
        });
      }
    },
    "A_Data_Group.req": class ADataGroupReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["A_Data_Group.req"]["EMI2/IMI2"].value;
      control = new ControlField();
      sap: SAP;
      apci: APCI;
      data: Buffer;
      hopCount: number;

      constructor(value: A_Data_Group_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(ADataGroupReq.name);
        }
        this.control.priority = value.control.priority;
        this.sap = value.sap;
        this.apci = value.apci;
        this.data = value.data;
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(8 + this.data.length);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        // Octetos 2-4 no utilizados
        buffer.writeUInt8(this.sap, 5);
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (this.data.length & 0x0f);
        const apci = this.apci.packNumber();
        // Esta escritura del APCI se tiene que hacer antes debido a la logica de escritura del metodo WriteData
        buffer[7] = apci[0];
        buffer[8] = apci[1];
        KNXHelper.WriteData(buffer, this.data, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sap: this.sap,
          hopCount: this.hopCount,
          apci: this.apci.describe(),
          data: this.data.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): ADataGroupReq {
        const expectedCode = MESSAGE_CODE_FIELD["A_Data_Group.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");
        if (buffer.length < 8) throw new Error("Buffer too short");

        const control = new ControlField(buffer.readUInt8(1));
        const sap = buffer.readUInt8(5); // Offset 5 según tu toBuffer

        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        // Recuperar APDU completa (APCI + Data) desde offset 7
        const fullAPDU = buffer.subarray(7, 7 + length);
        const apci1 = buffer[7] & 0x03;
        const apci2 = buffer[8] & 0xc0;
        const fullAPCI = apci1 | (apci2 >> 4);

        const newAPCI = new APCI(fullAPCI);

        // La data suele empezar en el byte 1 de la APDU (masked) o byte 2, depende de la longitud (<= 6 bits o > 6 bits).
        // Por simplicidad devolvemos el payload crudo, ajusta según tu parser APCI.
        const data = fullAPDU;

        return new ADataGroupReq({
          control: { priority: control.priority },
          sap: sap,
          apci: newAPCI,
          data: data,
          hopCount: hopCount,
        });
      }
    },
    "A_Data_Group.con": class ADataGroupCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["A_Data_Group.con"]["EMI2/IMI2"].value;
      control = new ControlField();
      sap: SAP;
      apci: APCI;
      data: Buffer;

      constructor(value: A_Data_Group_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(ADataGroupCon.name);
        }
        this.control.confirm = value.control.confirm;
        this.sap = value.sap;
        this.apci = value.apci;
        this.data = value.data;
      }

      toBuffer(): Buffer {
        const totalLength = this.data.length;
        const buffer = Buffer.alloc(8 + totalLength);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        buffer.writeUInt8(this.sap, 5);
        buffer[6] |= totalLength & 0x0f;
        const apci = this.apci.packNumber();
        // Esta escritura del APCI se tiene que hacer antes debido a la logica de escritura del metodo WriteData
        buffer[7] = apci[0];
        buffer[8] = apci[1];
        KNXHelper.WriteData(buffer, this.data, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sap: this.sap,
          apci: this.apci.describe(),
          data: this.data.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): ADataGroupCon {
        const expectedCode = MESSAGE_CODE_FIELD["A_Data_Group.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");

        const control = new ControlField(buffer.readUInt8(1));
        const sap = buffer.readUInt8(5);
        const length = buffer.readUInt8(6) & 0x0f;

        const fullAPDU = buffer.subarray(7, 7 + length);
        const apci1 = buffer[7] & 0x03;
        const apci2 = buffer[8] & 0xc0;
        const fullAPCI = apci1 | (apci2 >> 4);
        const apci = new APCI(fullAPCI);

        return new ADataGroupCon({
          control: { confirm: control.confirm },
          sap: sap,
          apci: apci,
          data: fullAPDU,
        });
      }
    },
    "A_Data_Group.ind": class ADataGroupInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["A_Data_Group.ind"]["EMI2/IMI2"].value;
      control = new ControlField();
      sap: SAP;
      apci: APCI;
      data: Buffer;

      constructor(value: A_Data_Group_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(ADataGroupInd.name);
        }
        this.control.priority = value.control.priority;
        this.sap = value.sap;
        this.apci = value.apci;
        this.data = value.data;
      }

      toBuffer(): Buffer {
        const totalLength = this.data.length;
        const buffer = Buffer.alloc(8 + totalLength);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        buffer.writeUInt8(this.sap, 5);
        buffer[6] |= totalLength & 0x0f;
        const apci = this.apci.packNumber();
        // Esta escritura del APCI se tiene que hacer antes debido a la logica de escritura del metodo WriteData
        buffer[7] = apci[0];
        buffer[8] = apci[1];
        KNXHelper.WriteData(buffer, this.data, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sap: this.sap,
          apci: this.apci.describe(),
          data: this.data.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): ADataGroupInd {
        const expectedCode = MESSAGE_CODE_FIELD["A_Data_Group.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");

        const control = new ControlField(buffer.readUInt8(1));
        const sap = buffer.readUInt8(5);
        const length = buffer.readUInt8(6) & 0x0f;

        const fullAPDU = buffer.subarray(7, 7 + length);
        const apci1 = buffer[7] & 0x03;
        const apci2 = buffer[8] & 0xc0;
        const fullAPCI = apci1 | (apci2 >> 4);
        const apci = new APCI(fullAPCI);

        return new ADataGroupInd({
          control: { priority: control.priority },
          sap: sap,
          apci: apci,
          data: fullAPDU,
        });
      }
    },
    "M_User_Data_Individual.req": class MUserDataIndividualReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["M_User_Data_Individual.req"]["EMI2/IMI2"].value;
      control = new ControlField();
      destinationAddress: string;
      apci: APCI = new APCI(APCIEnum.A_UserMemory_Read_Protocol_Data_Unit);
      data: Buffer;
      hopCount: number;

      constructor(value: M_User_Data_Individual_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(MUserDataIndividualReq.name);
        }
        this.control.priority = value.control.priority;
        this.destinationAddress = value.destinationAddress;
        this.apci.command = APCIEnum.A_UserMemory_Read_Protocol_Data_Unit; // 2C0
        this.data = value.data;
        this.hopCount = value.hopCount;
      }

      toBuffer(): Buffer {
        const totalLength = this.data.length;
        const buffer = Buffer.alloc(8 + totalLength);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] |= ((this.hopCount & 0x07) << 4) | (totalLength & 0x0f);
        const apci = this.apci.packNumber();
        buffer[7] = apci[0];
        buffer[8] = apci[1];
        KNXHelper.WriteData(buffer, this.data, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          destinationAddress: this.destinationAddress,
          hopCount: this.hopCount,
          apci: this.apci.describe(),
          data: this.data.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): MUserDataIndividualReq {
        const expectedCode = MESSAGE_CODE_FIELD["M_User_Data_Individual.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");

        const control = new ControlField(buffer.readUInt8(1));
        const destAddr = KNXHelper.GetAddress(buffer.subarray(4, 6), ".");
        if (!destAddr)
          throw new Error("The destAddr is undefined or null, this fatal error is from GetAddress, dont be ignore it");
        if (typeof destAddr !== "string")
          throw new Error("The destAddr is not string, this fatal error is from GetAddress, dont be ignore it");

        const octet6 = buffer.readUInt8(6);
        const hopCount = (octet6 >> 4) & 0x07;
        const length = octet6 & 0x0f;

        const data = buffer.subarray(7, 7 + length);

        return new MUserDataIndividualReq({
          control: { priority: control.priority },
          destinationAddress: destAddr,
          hopCount: hopCount,
          data: data,
        });
      }
    },
    "M_User_Data_Individual.con": class MUserDataIndividualCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["M_User_Data_Individual.con"]["EMI2/IMI2"].value;
      control = new ControlField();
      destinationAddress: string;
      apci: APCI = new APCI(APCIEnum.A_UserMemory_Read_Protocol_Data_Unit);
      data: Buffer;

      constructor(value: M_User_Data_Individual_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(MUserDataIndividualCon.name);
        }
        this.control.confirm = value.control.confirm;
        this.destinationAddress = value.destinationAddress;
        this.apci.command = APCIEnum.A_UserMemory_Read_Protocol_Data_Unit; // 2C0
        this.data = value.data;
      }

      toBuffer(): Buffer {
        const totalLength = this.data.length;
        const buffer = Buffer.alloc(8 + totalLength);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] |= totalLength & 0x0f;
        const apci = this.apci.packNumber();
        buffer[7] = apci[0];
        buffer[8] = apci[1];
        KNXHelper.WriteData(buffer, this.data, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          destinationAddress: this.destinationAddress,
          apci: this.apci.describe(),
          data: this.data.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): MUserDataIndividualCon {
        const expectedCode = MESSAGE_CODE_FIELD["M_User_Data_Individual.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");

        const control = new ControlField(buffer.readUInt8(1));
        const destAddr = KNXHelper.GetAddress(buffer.subarray(4, 6), ".");
        if (!destAddr)
          throw new Error("The destAddr is undefined or null, this fatal error is from GetAddress, dont be ignore it");
        if (typeof destAddr !== "string")
          throw new Error("The destAddr is not string, this fatal error is from GetAddress, dont be ignore it");
        const length = buffer.readUInt8(6) & 0x0f;
        const data = buffer.subarray(7, 7 + length);

        return new MUserDataIndividualCon({
          control: { confirm: control.confirm },
          destinationAddress: destAddr,
          data: data,
        });
      }
    },
    "M_User_Data_Individual.ind": class MUserDataIndividualInd implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["M_User_Data_Individual.ind"]["EMI2/IMI2"].value;
      control = new ControlField();
      sourceAddress: string;
      destinationAddress: string;
      apci: APCI = new APCI(APCIEnum.A_UserMemory_Read_Protocol_Data_Unit);
      data: Buffer;

      constructor(value: M_User_Data_Individual_ind) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(MUserDataIndividualInd.name);
        }
        this.control.priority = value.control.priority;
        this.sourceAddress = value.sourceAddress;
        this.destinationAddress = value.destinationAddress;
        this.apci.command = APCIEnum.A_UserMemory_Read_Protocol_Data_Unit; // 2C0
        this.data = value.data;
      }

      toBuffer(): Buffer {
        const totalLength = this.data.length;
        const buffer = Buffer.alloc(8 + totalLength);
        buffer.writeUInt8(this.messageCode, 0);
        this.control.buffer.copy(buffer, 1);
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        KNXHelper.GetAddress_(this.destinationAddress).copy(buffer, 4);
        buffer[6] |= totalLength & 0x0f;
        const apci = this.apci.packNumber();
        buffer[7] = apci[0];
        buffer[8] = apci[1];
        KNXHelper.WriteData(buffer, this.data, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          destinationAddress: this.destinationAddress,
          apci: this.apci.toHex(),
          data: this.data.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): MUserDataIndividualInd {
        const expectedCode = MESSAGE_CODE_FIELD["M_User_Data_Individual.ind"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");

        const control = new ControlField(buffer.readUInt8(1));
        const sourceAddr = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        const destAddr = KNXHelper.GetAddress(buffer.subarray(4, 6), ".");
        if (!sourceAddr)
          throw new Error(
            "The sourceAddr is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddr !== "string")
          throw new Error("The sourceAddr is not string, this fatal error is from GetAddress, dont be ignore it");
        if (!destAddr)
          throw new Error("The destAddr is undefined or null, this fatal error is from GetAddress, dont be ignore it");
        if (typeof destAddr !== "string")
          throw new Error("The destAddr is not string, this fatal error is from GetAddress, dont be ignore it");

        const length = buffer.readUInt8(6) & 0x0f;
        const data = buffer.subarray(7, 7 + length);

        return new MUserDataIndividualInd({
          control: { priority: control.priority },
          sourceAddress: sourceAddr,
          destinationAddress: destAddr,
          data: data,
        });
      }
    },
    "A_Poll_Data.req": class APollDataReq implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["A_Poll_Data.req"]["EMI2/IMI2"].value;
      pollingGroup: string;
      numberOfSlots: number;
      control: ControlField;

      constructor(value: A_Poll_Data_req) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(APollDataReq.name);
        }
        this.pollingGroup = value.pollingGroup;
        this.numberOfSlots = value.numberOfSlots;
        this.control = new ControlField(0xf0);
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7);
        buffer.writeUInt8(this.messageCode, 0);
        // Octeto 3-4 no utilizados
        buffer[1] = this.control.buffer.readUInt8();
        KNXHelper.GetAddress_(this.pollingGroup).copy(buffer, 4);
        buffer[6] = this.numberOfSlots & 0x0f;
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          pollingGroup: this.pollingGroup,
          numberOfSlots: this.numberOfSlots,
        };
      }

      static fromBuffer(buffer: Buffer): APollDataReq {
        const expectedCode = MESSAGE_CODE_FIELD["A_Poll_Data.req"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");

        // Estructura según tu toBuffer: MC(0), Ctrl(1), Unused(2-3), Group(4-5), Slots(6)
        const pollGroup = KNXHelper.GetAddress(buffer.subarray(4, 6), "/");
        if (!pollGroup)
          throw new Error("The pollGroup is undefined or null, this fatal error is from GetAddress, dont be ignore it");
        if (typeof pollGroup !== "string")
          throw new Error("The pollGroup is not string, this fatal error is from GetAddress, dont be ignore it");
        const slots = buffer.readUInt8(6) & 0x0f;

        return new APollDataReq({
          pollingGroup: pollGroup,
          numberOfSlots: slots,
        });
      }
    },
    "A_Poll_Data.con": class APollDataCon implements ServiceMessage {
      messageCode = MESSAGE_CODE_FIELD["A_Poll_Data.con"]["EMI2/IMI2"].value;
      sourceAddress: string;
      pollingGroup: string;
      numberOfSlots: number;
      pollData: Buffer;
      control: ControlField;

      constructor(value: A_Poll_Data_con) {
        if (typeof value !== "object" || value === null) {
          throw new InvalidInputObject(APollDataCon.name);
        }
        this.sourceAddress = value.sourceAddress;
        this.pollingGroup = value.pollingGroup;
        this.numberOfSlots = value.numberOfSlots;
        this.pollData = value.pollData;
        this.control = new ControlField(0xf0);
      }

      toBuffer(): Buffer {
        const buffer = Buffer.alloc(7 + this.pollData.length);
        buffer.writeUInt8(this.messageCode, 0);
        buffer[1] = this.control.buffer.readUInt8();
        KNXHelper.GetAddress_(this.sourceAddress).copy(buffer, 2);
        KNXHelper.GetAddress_(this.pollingGroup).copy(buffer, 4);
        buffer[6] = this.numberOfSlots & 0x0f;
        this.pollData.copy(buffer, 7);
        // buffer.writeUInt8(checksum(buffer.subarray(0, buffer.length - 1)), buffer.length - 1);
        return buffer;
      }

      describe() {
        return {
          messageCode: this.messageCode,
          control: this.control.describe(),
          sourceAddress: this.sourceAddress,
          pollingGroup: this.pollingGroup,
          numberOfSlots: this.numberOfSlots,
          pollData: this.pollData.toString("hex"),
        };
      }

      static fromBuffer(buffer: Buffer): APollDataCon {
        const expectedCode = MESSAGE_CODE_FIELD["A_Poll_Data.con"]["EMI2/IMI2"].value;
        if (buffer.readUInt8(0) !== expectedCode) throw new Error("Invalid Code");

        // Offset 2: Source
        const sourceAddress = KNXHelper.GetAddress(buffer.subarray(2, 4), ".");
        if (!sourceAddress)
          throw new Error(
            "The sourceAddress is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof sourceAddress !== "string")
          throw new Error("The sourceAddress is not string, this fatal error is from GetAddress, dont be ignore it");
        // Offset 4: Polling Group
        const pollingGroup = KNXHelper.GetAddress(buffer.subarray(4, 6), "/");
        if (!pollingGroup)
          throw new Error(
            "The pollingGroup is undefined or null, this fatal error is from GetAddress, dont be ignore it",
          );
        if (typeof pollingGroup !== "string")
          throw new Error("The pollingGroup is not string, this fatal error is from GetAddress, dont be ignore it");
        // Offset 6: Slots
        const slots = buffer.readUInt8(6) & 0x0f;
        // Offset 7: Data
        const pollData = buffer.subarray(7);

        return new APollDataCon({
          sourceAddress: sourceAddress,
          pollingGroup: pollingGroup,
          numberOfSlots: slots,
          pollData: pollData,
        });
      }
    },
  } as const;
}

// !! Type check in all class

type KeysOfEMI = "BusmonitorEMI" | "DataLinkLayerEMI" | "NetworkLayerEMI" | "TransportLayerEMI" | "ApplicationLayerEMI";

/**
 * List of services that do not implement the static fromBuffer method yet.
 */
type ExcludedServices = never;

/**
 * Validates that a class constructor has a static fromBuffer method
 * that returns an instance of that same class.
 */
type EMIServiceConstructor<T> = T extends { new (...args: any[]): infer I }
  ? {
      new (...args: any[]): I;
      fromBuffer(buffer: Buffer): I;
    }
  : never;

/**
 * Validator for the EMI class structure.
 * Checks that every service in each layer (except LayerAccess and ExcludedServices)
 * correctly implements the static fromBuffer method.
 */
type EMIValidator = {
  [K in KeysOfEMI]: {
    [S in keyof (typeof EMI)[K]]: S extends ExcludedServices
      ? any
      : (typeof EMI)[K][S] extends { new (...args: any[]): any }
        ? EMIServiceConstructor<(typeof EMI)[K][S]>
        : any;
  };
};
// !! This is for verify all class if have the method fromBuffer
EMI satisfies EMIValidator;
