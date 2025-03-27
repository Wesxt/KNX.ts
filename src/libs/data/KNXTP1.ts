import { SerialPort } from "serialport";
import { L_Data_Extended, L_Data_Standard } from "../@types/interfaces/KNXTP1";
import { InvalidKnxDataException } from "../errors/InvalidKnxDataExeption";
import { KNXHelper } from "../utils/class/KNXHelper";
import { KNXTP1ControlField } from "./KNXTP1ControlField";
import { KNXTP1ExtendedControlField } from "./KNXTP1ControlFieldExtended";
import { KNXTPCI, TPCIType } from "./KNXTPCI";
import { BIT_1_TIME_IN_9600_BAUDIOS } from "./constants/1bitTimeIn9600Baudios";
import { ShortAckCode } from "./enum/KNXEnumShortACKFrame";
import { AddressType, ExtendedFrameFormat } from "./enum/KNXEnumControlFieldExtended";
import { APCIEnum, KNXAPCI } from "./KNXAPCI";
import { FrameKind, FrameType, Priority } from "./enum/KNXEnumControlField";

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
  static readonly DataLength_Data_In_L_Data_Standard = 15
  static readonly DataLength_Data_In_L_Data_Extended = 254

  defaultConfigLDataStandard(groupAddress?: string): L_Data_Standard {
    return {
      controlFieldData: {
        frameType: FrameType.STANDARD,
        frameKind: FrameKind.L_DATA_FRAME,
        priority: Priority.LOW,
        repeat: true
      },
      sourceAddr: "0.0.1",
      groupAddress: groupAddress ? groupAddress : "0/0/1",
      addressType: AddressType.GROUP,
      hopCount: 6,
      TPCIType: TPCIType.T_DATA_BROADCAST_PDU,
      APCIType: APCIEnum.A_GroupValue_Write_Protocol_Data_Unit,
      data: Buffer.from([0])
    }
  }

  defaultConfigLDataExtended(groupAddress?: string): L_Data_Extended {
    return {
      controlFieldData: {
        frameType: FrameType.EXTENDED,
        frameKind: FrameKind.L_DATA_FRAME,
        priority: Priority.LOW,
        repeat: true
      },
      controlFieldExtendedData: {
        addressType: AddressType.GROUP,
        extendedFrameFormat: ExtendedFrameFormat.Point_To_Point_Or_Standard_Group_Addressed_L_Data_Extended_Frame,
        hopCount: 6
      },
      sourceAddr: "0.0.1",
      groupAddress: groupAddress ? groupAddress : "0/0/1",
      TPCIType: TPCIType.T_DATA_BROADCAST_PDU,
      APCIType: APCIEnum.A_GroupValue_Write_Protocol_Data_Unit,
      data: Buffer.from([0])
    }
  }

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
   * @param param0 {L_Data_Standard} An object that configures the L_Data_Standard
   * @returns Buffer con el frame L_Data_Standard completo.
   */
  createLDataStandardFrame({controlFieldData, sourceAddr, groupAddress, addressType, hopCount, TPCIType, APCIType, data}: L_Data_Standard): Buffer {
    if (data.length > KNXTP1.DataLength_Data_In_L_Data_Standard) {
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

    const field = (addressType << 7) | ((hopCount & 0x07) << 4);
    // Campo de longitud: 4 bits de data.length
    const lengthField = (data.length & 0x0F) | field;
    telegram[offset++] = lengthField;

    // // Octeto fijo (0x00), reservado en este formato
    // telegram[offset++] = 0x00;

    const apci = new KNXAPCI(APCIType)
    const tpci = new KNXTPCI(TPCIType)
  // Construir TPCI (0..63) y APCI (0..15)
  const tpciVal = tpci.getValue(); // Devuelve un número 0..63
  const apciVal = apci.value; // Devuelve un número 0..15

  // [6] TPCI + APCI(2 bits altos)
  telegram[offset++] = ((tpciVal & 0xFC) << 2) // bits 7..2
                     | ((apciVal >> 6) & 0x03); // bits 1..0

  // [7] 2 bits bajos de APCI en bits 7..6, bits 5..0 a 0
    telegram[offset] = ((apciVal << 2) & 0xC0);

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
 * |  7  | (6 bits del TPCI) + (2 bits del APCI)  |
 * |  8  | bits restantes del APCI o pueden ser de datos |
 * | 9..N  | NPDU (datos de usuario)                  |
 * | N+1   | Check Octet (NOT XOR de todos los anteriores) |
 * @returns Buffer con el frame L_Data_Standard completo.
 */
  createLDataExtendedFrame({controlFieldData, controlFieldExtendedData, sourceAddr, groupAddress, TPCIType, APCIType, data}: L_Data_Extended): Buffer {
    if (data.length > KNXTP1.DataLength_Data_In_L_Data_Extended) {
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
    // [7] (6 bits del TPCI) + (2 bits del APCI)
    // [8] bits restantes del APCI o pueden ser de datos
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

    const apci = new KNXAPCI(APCIType)
    const tpci = new KNXTPCI(TPCIType)
  // Construir TPCI (0..63) y APCI (0..15)
  const tpciVal = tpci.getValue(); // Devuelve un número 0..63
  const apciVal = apci.value; // Devuelve un número 0..15

  // [7] TPCI + APCI(2 bits altos)
  telegram[offset++] = ((tpciVal & 0xFC) << 2) // bits 7..2
                     | ((apciVal >> 6) & 0x03); // bits 1..0

  // [8] 2 bits bajos de APCI en bits 7..6, bits 5..0 a 0
    telegram[offset] = ((apciVal << 2) & 0xC0);

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
