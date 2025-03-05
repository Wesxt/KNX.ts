/**
 * Enumeración de prioridades para el Data Link Layer TP1.
 * Los valores internos representan la prioridad según la interfaz,
 * pero la codificación en el frame se ajusta a la especificación:
 *   - SYSTEM:  00 (0)
 *   - NORMAL:  01 (1)
 *   - URGENT:  10 (2)
 *   - LOW:     11 (3)
 */
export enum Priority {
  SYSTEM = 0,  // 00
  NORMAL = 1,  // 01
  URGENT = 2,  // 10
  LOW = 3      // 11
}

export enum TelegramType {
  L_Data_Frame = 12,            // 1100 (bits 3-0)
  L_Poll_Data_Frame = 6,        // según convenga
  Acknowledgement_Frame = 5,    // etc.
  RESERVED = 3
}

/** Tipo de Frame según el bit 7 del Control Field */
export enum FrameType {
  EXTENDED = 0, // FT = 0 → L_Data_Extended Frame
  STANDARD = 1  // FT = 1 → L_Data_Standard Frame
}
