import { SerialPort } from "serialport";
import { ControlFieldData, ControlFieldExtendedData } from "../@types/interfaces/KNXTP1";
import { InvalidKnxDataException } from "../errors/InvalidKnxDataExeption";
import { KNXHelper } from "../utils/class/KNXHelper";
import { KNXTP1ControlField } from "./KNXTP1ControlField";
import { KNXTP1ExtendedControlField } from "./KNXTP1ControlFieldExtended";
import { KNXTPCI, TPCIType as TransportControlFieldType } from "./KNXTPCI";
import { BIT_1_TIME_IN_9600_BAUDIOS } from "./constants/1bitTimeIn9600Baudios";
import { ShortAckCode } from "./enum/KNXEnumShortACKFrame";
import { AddressType } from "./enum/KNXEnumControlFieldExtended";
import { APCIEnum, KNXAPCI } from "./KNXAPCI";

/**
 * Clase para construir frames KNX TP1 según la especificación.
 * Soporta:
 * 1. L_Data_Standard Frame (para mensajes de datos)
 * 2. L_Poll_Data Frame (para solicitudes de Poll Data)
 * 3. Short Acknowledgement Frame
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "KNX Standard Communication Media Twisted Pair 1"
 */
export class KNXTP1 {
  debug = false;
  static readonly DataLength_Data_APCI_In_L_Data_Standard = 15
  static readonly DataLength_Data_APCI_In_L_Data_Extended = 254
  /**
   * Crea un frame L_Data_Standard.
   * 
   * Estructura del frame:
   * 
   * | Octet | Campo                                    |
   * |-------|------------------------------------------|
   * |  0    | Control Field (CTRL)                     |
   * |  1    | Source Address (alta)                    |
   * |  2    | Source Address (baja)                    |
   * |  3    | Destination Address (alta)               |
   * |  4    | Destination Address (baja)               |
   * |  5    | Dirección: Bit 7 = AT (0: individual, 1: group)  |
   * |  6   | Valor fijo (0x00, reservado para APCI en esta posición) | 
   * |  7    | Longitud del TPDU (0…14)                  |
   * | 8..N  | TPDU (datos de usuario)                  |
   * | N+1   | Check Octet (NOT XOR de todos los anteriores) |
   * @param controlFieldData The Control field shall indicate the type of the request Frame: L_Data_Standard Frame L_Data_Extended Frame, L_Poll_Data request Frame or Acknowledgment Frame.
   * @param sourceAddr Individual Address, Each device, i.e. a Router or an end device, shall have a unique Individual Address (IA) in a network. The Individual Address shall be a 2 octet value that shall consist of an 8 bit Subnetwork Address (SNA) and an 8 bit Device Address (DA). The Device Address shall be unique within a Subnetwork. Routers shall always have the Device Address zero, i.e. other devices may have the Device Addresses with values 1 to 255.
   * @param groupAddress The Group Address shall be a 2 octet value that does not need to be unique. A Device may have more than one Group Address.
   * @param addressType The Destination Address (octets three and four) shall define the devices that shall receive the Frame. For an L_Data_Standard Frame, the Destination Address can be either an Individual Address (AT = 0) or a Group Address (AT = 1), depending on the Destination Address Type (AT) in octet five.
   * @param hopCount Controls how many line repeaters or couplers (Line Couplers or Area Couplers) can retransmit the message.
   * @param TransportControlFieldType 
   * @returns Buffer con el frame L_Data_Standard completo.
   */
  createLDataStandardFrame(controlFieldData: ControlFieldData, sourceAddr: string, groupAddress: string, addressType: AddressType, hopCount: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7, TransportControlFieldType: TransportControlFieldType, data: Buffer): Buffer {
    if (data.length > KNXTP1.DataLength_Data_APCI_In_L_Data_Standard) {
      throw new InvalidKnxDataException("La longitud del dato deben ser menos o igual a 15")
    }
    // Si la TPDU (datos) es de hasta 15 octetos, usamos el formato estándar

    // Formato L_Data_Standard:
    // Estructura:
    // [0] CTRL (Control Field, con FT = 1)
    // [1] Source Address (alta)
    // [2] Source Address (baja)
    // [3] Destination Address (alta)
    // [4] Destination Address (baja)
    // [5] Longitud: 4 bits de AddresType y HopCount + data.length en los 4 bits altos
    // [6] TPCI
    // [7] APCI (desde el bit1 del (octeto 6) al bit6 del (octeto 7)) + data, si es mayor a 6 bits entonces estos bits no se usan
    // [8+data.length-1] (datos, escritos con KNXHelper.WriteData)
    // [final] Check Octet (NOT XOR de todos los octetos anteriores)
    const headerLength = 7;
    const totalLength = headerLength + KNXHelper.GetDataLength(data) + 1; // +1 para el Check Octet
    const telegram = Buffer.alloc(totalLength);
    let offset = 0;

    // Construir Control Field para formato estándar (FT flag = 1)
    const controlField = new KNXTP1ControlField();
    controlField.frameKind = controlFieldData.frameKind
    controlField.frameType = controlFieldData.frameType
    controlField.priority = controlFieldData.priority;
    controlField.repeat = controlFieldData.repeat;
    if (this.debug) console.log(controlField.describe())

    telegram[offset++] = controlField.rawValue;
    const sourceAddrBuffer = KNXHelper.GetAddress_(sourceAddr)
    // Source Address (2 octetos)
    telegram[offset++] = sourceAddrBuffer[0];
    telegram[offset++] = sourceAddrBuffer[1];
    const groupAddressBuffer = KNXHelper.GetAddress_(groupAddress)
    // Destination Address (2 octetos)
    telegram[offset++] = groupAddressBuffer[0];
    telegram[offset++] = groupAddressBuffer[1];

    // Campo de longitud: 4 bits de data.length y 0xE0 en los 4 bits altos
    const field = (addressType << 7) | ((hopCount & 0x07) << 4);
    const lengthField = (data.length & 0x0F) | field;
    telegram[offset++] = lengthField;

    // // Octeto fijo (0x00), reservado en este formato
    // telegram[offset++] = 0x00;

    const apci = new KNXAPCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit)

    // TPCI: se crea una instancia del handler con un tipo de control
    const tpciHandler = new KNXTPCI(TransportControlFieldType);
    tpciHandler.reserved = (apci.value >> 4)
    telegram[offset++] = tpciHandler.getValue();

    telegram[offset] = 0x00 & (apci.value << 4);

    // Escribir Application User Data (APCI + datos) a partir del offset actual
    KNXHelper.WriteData(telegram, data, offset);
    // offset += data.length;

    // Calcular y agregar el Check Octet (NOT XOR de todos los octetos previos)
    const checksum = this.calculateChecksum(telegram.subarray(0, offset + data.length));
    telegram[offset + data.length] = checksum;

    return telegram;
  }

  /**
 * Crea un frame L_Data_Extended.
 * 
 * Estructura del frame:
 * 
 * | Octet | Campo                                    |
 * |-------|------------------------------------------|
 * |  0    | Control Field (CTRL)                     |
 * |  1    | CTRLE (Extended Control Field; aquí se fija el bit AT (AddressType)                    |
 * |  2    | Source Address (alta)                    |
 * |  3    | Source Address (baja)               |
 * |  4    | Destination Address (alta)               |
 * |  5    | Destination Address (bajo)  |
 * |  6    | Longitud extendida: 8 bits completos (data.length, debe ser ≤ 254)                  |
 * |  7  | Valor fijo (0x00, reservado para TPDU en esta posición)  |
 * | 8..N  | TPDU (datos de usuario)                  |
 * | N+1   | Check Octet (NOT XOR de todos los anteriores) |
 * @returns Buffer con el frame L_Data_Standard completo.
 */
  createLDataExtendedFrame(controlFieldData: ControlFieldData, controlFieldExtendedData: ControlFieldExtendedData, sourceAddr: string, groupAddress: string, TPCIType: TransportControlFieldType, data: Buffer): Buffer {
    if (data.length > KNXTP1.DataLength_Data_APCI_In_L_Data_Extended) {
      throw new Error("El TPDU extendido admite máximo 254 octetos");
    }
    // Si la TPDU es extendida (más de 15 octetos)
    // Usamos el formato L_Data_Extended:
    // Estructura:
    // [0] CTRL (Control Field, con FT = 0 para frame extendido)
    // [1] CTRLE (Extended Control Field; aquí se fija el bit AT (AddressType)
    // [2] Source Address (alta)
    // [3] Source Address (baja)
    // [4] Destination Address (alta)
    // [5] Destination Address (baja)
    // [6] Longitud extendida: 8 bits completos (data.length, debe ser ≤ 254)
    // [7] Valor fijo (0x00, reservado para TPDU en esta posición)
    // [8] TPCI
    // [9..9+data.length-1] NPDU (datos, escritos con KNXHelper.WriteData)
    // [final] Check Octet

    const headerLength = 8;
    const totalLength = headerLength + KNXHelper.GetDataLength(data) + 1;
    const telegram = Buffer.alloc(totalLength);
    let offset = 0;

    // Construir Control Field para formato extendido (FT flag = 0)
    const controlField = new KNXTP1ControlField();
    controlField.frameKind = controlFieldData.frameKind
    controlField.frameType = controlFieldData.frameType
    controlField.priority = controlFieldData.priority
    controlField.repeat = controlFieldData.repeat
    telegram[offset++] = controlField.rawValue;

    // Extended Control Field (CTRLE):
    // Para simplificar, fijamos el bit AT según destAddressType; sin hop count y con EFF = 0.
    const ctrle = new KNXTP1ExtendedControlField();
    ctrle.addressType = controlFieldExtendedData.addressType
    ctrle.hopCount = controlFieldExtendedData.hopCount
    ctrle.eff = controlFieldExtendedData.extendedFrameFormat
    telegram[offset++] = ctrle.toNumber();
    const sourceAddrBuffer = KNXHelper.GetAddress_(sourceAddr)
    // Source Address (2 octetos)
    telegram[offset++] = sourceAddrBuffer[0];
    telegram[offset++] = sourceAddrBuffer[1];
    const groupAddressBuffer = KNXHelper.GetAddress_(groupAddress)
    // Destination Address (2 octetos)
    telegram[offset++] = groupAddressBuffer[0];
    telegram[offset++] = groupAddressBuffer[1];

    // Campo de longitud extendida: se usa un octeto completo con data.length
    telegram[offset++] = KNXHelper.GetDataLength(data);

    // TPCI: mismo procedimiento que antes
    const tpciHandler = new KNXTPCI(TPCIType);
    telegram[offset] = tpciHandler.getValue();

    // Escribir TPDU (datos) a partir del offset actual
    KNXHelper.WriteData(telegram, data, offset);
    // offset += KNXHelper.GetDataLength(data);

    // Calcular y agregar el Check Octet
    const checksum = this.calculateChecksum(telegram.subarray(0, offset + data.length));

    telegram[offset + data.length] = checksum;

    return telegram;
  }

  /**
   * Crea un frame L_Poll_Data Request.
   * 
   * Estructura del frame:
   * 
   * | Octet | Campo                                  |
   * |-------|----------------------------------------|
   * |  0    | Control Field (fijo: 0xF0 = 11110000)  |
   * |  1    | Source Address (alta)                  |
   * |  2    | Source Address (baja)                  |
   * |  3    | Poll Group Address (alta)              |
   * |  4    | Poll Group Address (baja)              |
   * |  5    | Número de Poll Data esperados (1-15)   |
   * |  6    | Check Octet (NOT XOR de 0 a 5)           |
   * 
   * @param sourceAddr Dirección de origen [alta, baja]
   * @param pollGroupAddr Dirección de grupo de Poll Data [alta, baja]
   * @param noOfExpectedPollData Número de respuestas esperadas (entre 1 y 15)
   * @returns Buffer con el frame L_Poll_Data Request.
   * @deprecated No se ha probado
   */
  createLPollDataFrame(
    sourceAddr: number[],
    pollGroupAddr: number[],
    noOfExpectedPollData: number
  ): Buffer {
    if (sourceAddr.length !== 2) {
      throw new Error("sourceAddr debe tener 2 octetos");
    }
    if (pollGroupAddr.length !== 2) {
      throw new Error("pollGroupAddr debe tener 2 octetos");
    }
    if (noOfExpectedPollData < 1 || noOfExpectedPollData > 15) {
      throw new Error("noOfExpectedPollData debe estar entre 1 y 15");
    }

    // El frame tiene 7 octetos en total.
    const buffer = Buffer.alloc(7);
    // Control Field fijo para L_Poll_Data Request: 11110000 (0xF0)
    buffer[0] = 0xF0;
    // Source Address
    buffer[1] = sourceAddr[0];
    buffer[2] = sourceAddr[1];
    // Poll Group Address
    buffer[3] = pollGroupAddr[0];
    buffer[4] = pollGroupAddr[1];
    // Número de Poll Data esperados (solo los 4 bits bajos son válidos)
    buffer[5] = noOfExpectedPollData & 0x0F;
    // Check Octet
    buffer[6] = this.calculateChecksum(buffer.subarray(0, 6));

    return buffer;
  }

  /**
   * Crea un frame de Acknowledgement corto.
   * 
   * De acuerdo a la especificación, el frame de ACK consta de un único octeto.
   * Los códigos definidos son:
   * 
   * | Tipo       | Código (hex) | Binario       |
   * |------------|--------------|---------------|
   * | ACK        | 0xCC         | 11001100      |
   * | NAK        | 0x0C         | 00001100      |
   * | BUSY       | 0xC0         | 11000000      |
   * | NAK+BUSY   | 0x00         | 00000000      |
   * 
   * @param type Tipo de acknowledgment: 'ACK', 'NAK', 'BUSY' o 'NAK_BUSY'
   * @returns Buffer con el frame de Acknowledgement (1 octeto)
   */
  createAckFrame(type: 'ACK' | 'NAK' | 'BUSY' | 'NAK_BUSY', serialport: SerialPort) {
    let code: number;
    switch (type) {
      case 'ACK':
        code = 0xCC;
        break;
      case 'NAK':
        code = 0x0C;
        break;
      case 'BUSY':
        code = 0xC0;
        break;
      case 'NAK_BUSY':
        code = 0x00;
        break;
      default:
        throw new Error("Tipo de acknowledgment desconocido");
    }
    setTimeout(() => {
      serialport.write(Buffer.from([code]));
    }, BIT_1_TIME_IN_9600_BAUDIOS * 15);
  }

  parseShortAck(byte: number): ShortAckCode | null {
    switch (byte) {
      case 0xCC:
        return ShortAckCode.ACK;
      case 0x0C:
        return ShortAckCode.NAK;
      case 0xC0:
        return ShortAckCode.BUSY;
      case 0x00:
        return ShortAckCode.NAK_BUSY;
      default:
        return null; // no es un short ack válido
    }
  }

  private calculateChecksum(data: Buffer): number {
    return data.reduce((acc, byte) => acc ^ byte, 0) ^ 0xFF;
  }
}
