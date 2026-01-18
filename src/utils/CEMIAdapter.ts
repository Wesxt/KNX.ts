import { MessageCodeTranslator } from "./MessageCodeTranslator";
import { CEMI } from "../core/CEMI";

export class CEMIAdapter {
  /**
   * Convierte un objeto CEMI a un Buffer EMI
   */
  static toEMI(cemi: CEMI): Buffer {
    throw new Error("Conversión no implementada");
  }

  /**
   * Convierte un Buffer crudo EMI (de TPUART por ejemplo) a un objeto CEMI
   */
  static fromEMI(buffer: Buffer): CEMI {
    const emiCode = buffer.readUInt8(0);

    let cemiCode: number | null = null;
    cemiCode = MessageCodeTranslator.translate(emiCode, "EMI2/IMI2", "CEMI"); // Primer intento para EMI2/IMI2
    if (!cemiCode) {
      cemiCode = MessageCodeTranslator.translate(emiCode, "EMI1", "CEMI");
    }

    if (cemiCode === null) {
      throw new Error(`Código EMI1 0x${emiCode.toString(16)} no tiene equivalente cEMI soportado.`);
    }

    const cemi = new CEMI(cemiCode);

    // 3. Rellenamos el resto de datos (Payload)
    // Aquí todavía necesitas lógica manual porque la estructura del payload cambia
    // entre EMI1 y cEMI, aunque el código signifique lo mismo.

    const serviceName = MessageCodeTranslator.getServiceName(emiCode, "EMI1");

    if (serviceName === "L_Data.ind" || serviceName === "L_Data.req") {
      // Lógica específica para L_Data (Extraer direcciones, control, etc.)
      // ...
    } else if (serviceName === "L_Busmon.ind") {
      // Lógica específica para Monitor
    }

    return cemi;
  }
}
