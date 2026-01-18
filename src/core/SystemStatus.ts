import { DescribeEstructure } from "../@types/interfaces/ServiceMessage";
import { SystemStatusValues, StatusValues } from "../@types/interfaces/SystemStatus";

/**
 * In EMI1, layers shall be accessed by writing to the memory location “system status”. Locally this shall be
 * done by the PC_Set_Value.req service, remotely by the service A_Memory_Read.
 *
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - External Message Interface
 * @version 01.04.02 is a KNX Approved Standard.
 */
export class SystemStatus implements DescribeEstructure {
  constructor(value: SystemStatusValues) {
    if (typeof value !== "object" || value === null) {
      throw new Error("System status must be an object with specific properties.");
    }
    const allowedKeys = ["PROG", "LLM", "TLE", "ALE", "SE", "UE", "DM", "PARITY"];

    const invalidKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
    if (invalidKeys.length > 0) {
      throw new Error(`Invalid keys in system status: ${invalidKeys.join(", ")}`);
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
    if (typeof value !== "boolean") {
      throw new Error("LLM value must be a boolean.");
    }
    this.#value = (this.#value & 0xfd) | ((value ? 1 : 0) << 1);
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
    if (typeof value !== "boolean") {
      throw new Error("TLE value must be a boolean.");
    }
    this.#value = (this.#value & 0xfb) | ((value ? 1 : 0) << 2);
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
    if (typeof value !== "boolean") {
      throw new Error("ALE value must be a boolean.");
    }
    this.#value = (this.#value & 0xf7) | ((value ? 1 : 0) << 3);
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
    if (typeof value !== "boolean") {
      throw new Error("SE value must be a boolean.");
    }
    this.#value = (this.#value & 0xef) | ((value ? 1 : 0) << 4);
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
    if (typeof value !== "boolean") {
      throw new Error("UE value must be a boolean.");
    }
    this.#value = (this.#value & 0xdf) | ((value ? 1 : 0) << 5);
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
    if (typeof value !== "boolean") {
      throw new Error("PARITY value must be a boolean.");
    }
    this.#value = (this.#value & 0x7f) | ((value ? 1 : 0) << 7);
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
      PROG: `Programación: ${this.PROG ? "Activo" : "Inactivo (fijo a inactivo)"}`,
      LLM: `Modo Busmonitor: ${this.LLM ? "Desactivado" : "Activado"}`, // 1 = disabled, 0 = enabled
      TLE: `Capa de Transporte: ${this.TLE ? "Activado" : "Desactivado"}`,
      ALE: `Capa de Aplicación: ${this.ALE ? "Activado" : "Desactivado"}`,
      SE: `PEI: ${this.SE ? "Activado" : "Desactivado"}`,
      UE: `Programa de Usuario: ${this.UE ? "Activado" : "Desactivado"}`,
      DM: `DM: ${this.DM ? "Activo" : "Inactivo (fijo a inactivo)"}`, // 1 = enabled, 0 = disabled (fijo a 0)
      PARITY: `Paridad: ${this.PARITY ? "Paridad par (activada)" : "Desactivada"}`,
      rawValue: `Valor numérico: ${this.#value}`,
    };
  }

  /**
   * Crea una instancia de SystemStatus a partir de un byte
   * @param byte Byte de estado del sistema
   * @returns Instancia de SystemStatus
   */
  static fromByte(byte: number): SystemStatus {
    if (byte < 0 || byte > 255) {
      throw new Error("System status byte must be between 0 and 255");
    }

    const systemStatusObj: SystemStatusValues = {
      PROG: false, // Siempre false
      LLM: ((byte >> 1) & 0x01) === 1,
      TLE: ((byte >> 2) & 0x01) === 1,
      ALE: ((byte >> 3) & 0x01) === 1,
      SE: ((byte >> 4) & 0x01) === 1,
      UE: ((byte >> 5) & 0x01) === 1,
      DM: false, // Siempre false
      PARITY: ((byte >> 7) & 0x01) === 1,
    };

    return new SystemStatus(systemStatusObj);
  }
}

export class Status implements DescribeEstructure {
  constructor(value: StatusValues) {
    if (typeof value !== "object" || value === null) {
      throw new Error("Status must be an object with specific properties.");
    }
    const allowedKeys = ["frameError", "bitError", "parityError", "overflow", "lost", "sequenceNumber"] as const;

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
    if (typeof value !== "boolean") {
      throw new Error("frameError must be a boolean.");
    }
    this.#value = (this.#value & 0x7f) | ((value ? 1 : 0) << 7);
  }

  get frameError(): boolean {
    return ((this.#value >> 7) & 0x01) === 1;
  }

  /**
   * An invalid bit is detected in one or several of the frame characters.
   */
  set bitError(value: boolean) {
    if (typeof value !== "boolean") {
      throw new Error("bitError must be a boolean.");
    }
    this.#value = (this.#value & 0xbf) | ((value ? 1 : 0) << 6);
  }

  get bitError(): boolean {
    return ((this.#value >> 6) & 0x01) === 1;
  }

  /**
   * An invalid parity bit was detected in one or several of the frame bits.
   */
  set parityError(value: boolean) {
    if (typeof value !== "boolean") {
      throw new Error("parityError must be a boolean.");
    }
    this.#value = (this.#value & 0xdf) | ((value ? 1 : 0) << 5);
  }

  get parityError(): boolean {
    return ((this.#value >> 5) & 0x01) === 1;
  }

  /**
   * The overflow flag is set.
   */
  set overflow(value: boolean) {
    if (typeof value !== "boolean") {
      throw new Error("overflow must be a boolean.");
    }
    this.#value = (this.#value & 0xef) | ((value ? 1 : 0) << 4);
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
   * 
  with lost flag set may not reflect exactly the number of lost frames or frame pieces.
   */
  set lost(value: boolean) {
    if (typeof value !== "boolean") {
      throw new Error("lost must be a boolean.");
    }
    this.#value = (this.#value & 0xf7) | ((value ? 1 : 0) << 3);
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
    this.#value = (this.#value & 0xf8) | value;
  }

  get sequenceNumber(): 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | number {
    return this.#value & 0x07;
  }

  describe() {
    return {
      frameError: `Error de trama: ${this.frameError ? "Detectado" : "No detectado"}`,
      bitError: `Error de bit: ${this.bitError ? "Detectado" : "No detectado"}`,
      parityError: `Error de paridad: ${this.parityError ? "Detectado" : "No detectado"}`,
      overflow: `Desbordamiento: ${this.overflow ? "Activado" : "Desactivado"}`,
      lost: `Perdido: ${this.lost ? "Activado" : "Desactivado"}`,
      sequenceNumber: `Número de secuencia: ${this.sequenceNumber}`,
      rawValue: `Valor numérico: ${this.#value}`,
    };
  }

  /**
   * Crea una instancia de Status a partir de un byte
   * @param byte Byte de estado
   * @returns Instancia de Status
   */
  static fromByte(byte: number): Status {
    if (byte < 0 || byte > 255) {
      throw new Error("Status byte must be between 0 and 255");
    }

    const statusObj: StatusValues = {
      frameError: ((byte >> 7) & 0x01) === 1,
      bitError: ((byte >> 6) & 0x01) === 1,
      parityError: ((byte >> 5) & 0x01) === 1,
      overflow: ((byte >> 4) & 0x01) === 1,
      lost: ((byte >> 3) & 0x01) === 1,
      sequenceNumber: (byte & 0x07) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
    };

    return new Status(statusObj);
  }
}
