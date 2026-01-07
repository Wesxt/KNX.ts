import { MESSAGE_CODE_FIELD } from "../../data/MessageCodeField";


type StandardType = "EMI1" | "EMI2/IMI2" | "IMI1" | "CEMI";

export class MessageCodeTranslator {
  // Mapas para búsqueda rápida: Code -> ServiceName
  private static emi1Map = new Map<number, string>();
  private static emi2Map = new Map<number, string>();
  private static cemiMap = new Map<number, string>();

  // Inicialización estática (se ejecuta una sola vez)
  static {
    for (const [serviceName, standards] of Object.entries(MESSAGE_CODE_FIELD)) {
      if (!standards) continue;

      // Mapear EMI1
      if ("EMI1" in standards && standards.EMI1) {
        this.emi1Map.set(standards.EMI1.value, serviceName);
      }
      // Mapear EMI2
      if ("EMI2/IMI2" in standards && standards["EMI2/IMI2"]) {
        this.emi2Map.set(standards["EMI2/IMI2"].value, serviceName);
      }
      // Mapear CEMI
      if ("CEMI" in standards && standards.CEMI) {
        this.cemiMap.set(standards.CEMI.value, serviceName);
      }
    }
  }

  /**
   * Traduce un código de mensaje de un estándar origen a un estándar destino.
   * @param sourceCode El byte recibido (ej. 0x49)
   * @param from El estándar origen (ej. "EMI1")
   * @param to El estándar destino (ej. "CEMI")
   * @returns El código traducido (ej. 0x29) o null si no existe equivalencia.
   */
  public static translate(sourceCode: number, from: StandardType, to: StandardType): number | null {
    // 1. Identificar el nombre del servicio (ej. "L_Data.ind")
    let serviceName: string | undefined;

    switch (from) {
      case "EMI1": serviceName = this.emi1Map.get(sourceCode); break;
      case "EMI2/IMI2": serviceName = this.emi2Map.get(sourceCode); break;
      case "CEMI": serviceName = this.cemiMap.get(sourceCode); break;
    }

    if (!serviceName) return null; // Código no reconocido en el origen

    // 2. Obtener el valor en el estándar destino
    const targetStandard = MESSAGE_CODE_FIELD[serviceName as keyof typeof MESSAGE_CODE_FIELD];

    // Verificación de tipo segura
    if (targetStandard && to in targetStandard) {
      // @ts-ignore: TypeScript puede quejarse del acceso dinámico, pero la lógica es sólida
      return targetStandard[to]?.value ?? null;
    }

    return null;
  }

  /**
   * Obtiene el nombre legible del servicio dado un código (útil para logs/debug)
   */
  public static getServiceName(code: number, standard: StandardType): string | null {
    switch (standard) {
      case "EMI1": return this.emi1Map.get(code) || null;
      case "EMI2/IMI2": return this.emi2Map.get(code) || null;
      case "CEMI": return this.cemiMap.get(code) || null;
      default: return null;
    }
  }
}