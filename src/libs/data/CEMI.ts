// ARCHIVO: CEMIMessage.ts

import { ControlFieldData, ControlFieldExtendedData } from "../@types/interfaces/KNXTP1";
import { KNXHelper } from "../utils/class/KNXHelper";
import { APCI } from "./APCI";
import { ControlField } from "./ControlField";
import { ExtendedControlField } from "./ControlFieldExtended";
import { TPCI, TPCIType } from "./TPCI";

/**
 * Enumeración para los códigos de mensaje cEMI (cEMI Message Codes).
 * Define los tipos de mensajes que se pueden intercambiar.
 */
export enum CEMIMessageCode {
  L_Data_req = 0x11, // Solicitud de envío de un paquete de datos (del Host al Bus)
  L_Data_con = 0x2e, // Confirmación del envío de un paquete de datos (del Bus al Host)
  L_Data_ind = 0x29, // Indicación de recepción de un paquete de datos (del Bus al Host)
  // Otros códigos de mensaje pueden ser añadidos aquí si es necesario
}

/**
 * Enumeración para el tipo de dirección de destino.
 */
export enum CEMIDestinationAddressType {
  Individual = 0,
  Group = 1,
}

/**
 * Interfaz que representa la estructura de una trama cEMI decodificada.
 */
export interface ICEMIMessage {
  messageCode: CEMIMessageCode;
  additionalInfoLength: number;
  additionalInfo: Buffer;
  controlField1: number;
  controlField2: number;
  sourceAddress: number;
  destinationAddress: number;
  dataLength: number;
  TCPI: TPCI;
  APCI?: APCI; // Opcional, para incluir el Application Protocol Control Information (APCI)
  destinationAddressType?: CEMIDestinationAddressType; // Opcional, para indicar si es Individual o Grupo
  npdu: Buffer;
}

/**
 * Clase para crear y analizar tramas cEMI (Common External Message Interface) de KNX.
 */
export class CEMIMessage implements ICEMIMessage {
  public messageCode: CEMIMessageCode;
  public additionalInfoLength: number;
  public additionalInfo: Buffer;
  public controlField1: number;
  public controlField2: number;
  public sourceAddress: number;
  public destinationAddress: number;
  public dataLength: number;
  public npdu: Buffer;
  TCPI: TPCI;
  APCI?: APCI | undefined;
  destinationAddressType?: CEMIDestinationAddressType | undefined;

  /**
   * Construye una instancia de CEMIMessage.
   * @param messageCode El código del mensaje (ej. L_Data.req).
   * @param sourceAddress La dirección individual de origen.
   * @param destinationAddress La dirección de grupo o individual de destino.
   * @param npdu El payload (Network Protocol Data Unit).
   */
  constructor(
    messageCode: CEMIMessageCode,
    sourceAddress: number,
    destinationAddress: number,
    controlField1: ControlField = new ControlField(), // Frame Type: 1, Repeat: 0, System Broadcast: 1, Priority: 3 (Low), ACK: 1, Confirm: 1, DestAddrType: 1 (Group)
    controlField2: ExtendedControlField = new ExtendedControlField(), // Extended Frame Format: 0, Hop Count: 6, Routing Counter: 1
    TPCI: TPCI = new TPCI(), // TPCI (Transport Protocol Control Information) - Opcional, se puede ajustar según el tipo de mensaje
    APCI: APCI = new APCI(), // APCI (Application Protocol Control Information) - Opcional, se puede ajustar según el tipo de mensaje
  ) {
    this.messageCode = messageCode;
    this.sourceAddress = sourceAddress;
    this.destinationAddress = destinationAddress;
    this.npdu = KNXHelper.;

    // Valores por defecto para una trama L_Data.req estándar
    this.additionalInfoLength = 0;
    this.additionalInfo = Buffer.alloc(0);
    this.controlField1 = controlField1.buffer.readInt8(); // Frame Type: 1, Repeat: 0, System Broadcast: 1, Priority: 3 (Low), ACK: 1, Confirm: 1, DestAddrType: 1 (Group)
    this.controlField2 = controlField2.getBuffer().readInt8(); // Extended Frame Format: 0, Hop Count: 6, Routing Counter: 1
    this.TCPI = TPCI;
    this.APCI = APCI;
    this.dataLength = npdu.length;

    // Ajustar el tipo de dirección en el campo de control 1
    // Esto es un ejemplo, se puede hacer más robusto
    const destAddressType = CEMIDestinationAddressType.Group; // Asumimos dirección de grupo por defecto
    this.setDestinationAddressType(destAddressType);
  }


  /**
   * Establece el tipo de dirección de destino en el campo de control 1.
   * @param addressType El tipo de dirección (Individual o Grupo).
   */
  public setDestinationAddressType(addressType: CEMIDestinationAddressType): void {
    if (addressType === CEMIDestinationAddressType.Individual) {
      this.controlField1 &= 0x7F; // Pone el bit 7 a 0
    } else {
      this.controlField1 |= 0x80; // Pone el bit 7 a 1
    }
  }

  /**
   * Analiza un buffer de datos y lo convierte en un objeto CEMIMessage.
   * @param buffer El buffer que contiene la trama cEMI.
   * @returns Una instancia de CEMIMessage.
   */
  public static fromBuffer(buffer: Buffer): CEMIMessage {
    const messageCode = buffer.readUInt8(0) as CEMIMessageCode;
    const additionalInfoLength = buffer.readUInt8(1);
    const additionalInfo = buffer.slice(2, 2 + additionalInfoLength);

    const baseOffset = 2 + additionalInfoLength;
    const controlField1 = buffer.readUInt8(baseOffset);
    const controlField2 = buffer.readUInt8(baseOffset + 1);
    const sourceAddress = buffer.readUInt16BE(baseOffset + 2);
    const destinationAddress = buffer.readUInt16BE(baseOffset + 4);
    const dataLength = buffer.readUInt8(baseOffset + 6);
    const npdu = buffer.slice(baseOffset + 7, baseOffset + 7 + dataLength);

    const msg = new CEMIMessage(messageCode, sourceAddress, destinationAddress, npdu);
    msg.additionalInfoLength = additionalInfoLength;
    msg.additionalInfo = additionalInfo;
    msg.controlField1 = controlField1;
    msg.controlField2 = controlField2;

    return msg;
  }

  /**
   * Convierte la instancia actual de CEMIMessage a un Buffer.
   * @returns Un Buffer que representa la trama cEMI.
   */
  public toBuffer(): Buffer {
    const buffer = Buffer.alloc(
      2 +
      this.additionalInfoLength +
      6 + // control fields, source, dest
      1 + // data length
      this.npdu.length
    );

    let offset = 0;
    buffer.writeUInt8(this.messageCode, offset);
    offset += 1;
    buffer.writeUInt8(this.additionalInfoLength, offset);
    offset += 1;

    if (this.additionalInfoLength > 0) {
      this.additionalInfo.copy(buffer, offset);
      offset += this.additionalInfoLength;
    }

    buffer.writeUInt8(this.controlField1, offset);
    offset += 1;
    buffer.writeUInt8(this.controlField2, offset);
    offset += 1;
    buffer.writeUInt16BE(this.sourceAddress, offset);
    offset += 2;
    buffer.writeUInt16BE(this.destinationAddress, offset);
    offset += 2;
    buffer.writeUInt8(this.npdu.length, offset);
    offset += 1;
    this.npdu.copy(buffer, offset);

    return buffer;
  }

  /**
   * Representación en cadena de la trama cEMI para depuración.
   */
  public toString(): string {
    return `CEMIMessage {
  Message Code: 0x${this.messageCode.toString(16)} (${CEMIMessageCode[this.messageCode]}),
  Source Addr: 0x${this.sourceAddress.toString(16)},
  Dest Addr: 0x${this.destinationAddress.toString(16)},
  NPDU: <${this.npdu.toString('hex').toUpperCase()}>
}`;
  }
}

// --- EJEMPLO DE USO ---

// 1. Crear una trama cEMI para escribir un valor (GroupValueWrite)

// El NPDU (payload) para una escritura de 1 bit (ej. encender una luz)
// TPCI (0x00) + APCI (GroupValueWrite, 0x80) + Datos (1 bit, valor 1)
const npduPayloadOn = Buffer.from([0x00, 0x81]); // 0b10000001 = GroupValueWrite, Data=1

const sourceAddress = 0x1101; // Dirección individual del dispositivo que envía (ej. 1.1.1)
const groupAddress = 0x0101;  // Dirección de grupo (ej. 1/1/1)

// Crear una nueva trama L_Data.req
const cemiMsgOn = new CEMIMessage(
  CEMIMessageCode.L_Data_req,
  sourceAddress,
  groupAddress,
  npduPayloadOn
);

// Convertir el mensaje a un Buffer para enviarlo
const cemiBufferOn = cemiMsgOn.toBuffer();

console.log("--- Creación de Trama cEMI (Encender) ---");
console.log(cemiMsgOn.toString());
console.log("Buffer generado:", cemiBufferOn.toString('hex').toUpperCase());
// Salida esperada del buffer: 1100BCC011010101020081

console.log("\n" + "-".repeat(40) + "\n");

// 2. Analizar una trama cEMI recibida desde el bus (ej. una indicación)

// Simular un buffer recibido de una interfaz KNX (L_Data.ind)
// que indica que se ha escrito el valor "off" (0) en la misma dirección de grupo.
const receivedBufferOff = Buffer.from('2900BCC011020101020080', 'hex');

// Analizar el buffer
const cemiMsgOff = CEMIMessage.fromBuffer(receivedBufferOff);

console.log("--- Análisis de Trama cEMI (Apagar) ---");
console.log(cemiMsgOff.toString());

// Se podría acceder a los datos así:
console.log(`Valor recibido: ${cemiMsgOff.npdu[1] & 0b00000001}`); // Extraer el último bit