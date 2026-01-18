/**
 * The two priority bits of the Control field shall control the priority of the Frame, if two devices start
transmission simultaneously.
 *   - SYSTEM:  00 (0) - Reserved for high priority, system configuration and management procedures
 *   - NORMAL:  01 (1) - Default for short Frames
 *   - URGENT:  10 (2) - Reserved for urgent Frames
 *   - LOW:     11 (3) - Mandatory for long Frames, burst traffic...
 */
export enum Priority {
  SYSTEM = 0,  // 00
  NORMAL = 1,  // 01
  URGENT = 2,  // 10
  LOW = 3      // 11
}

// export enum TelegramType {
//   L_Data_Frame = 12,            // 1100 (bits 3-0)
//   L_Poll_Data_Frame = 6,        // según convenga
//   Acknowledgement_Frame = 5,    // etc.
//   RESERVED = 3
// }

/** Tipo de Frame según el bit 7 del Control Field */
export enum FrameType {
  EXTENDED = 0, // FT = 0 → L_Data_Extended Frame
  STANDARD = 1  // FT = 1 → L_Data_Standard Frame
}


export enum FrameKind {
  L_DATA_FRAME = "L_DATA_FRAME",
  L_POLL_DATA_FRAME = "L_POLL_DATA_FRAME",
  ACKNOWLEDGEMENT_FRAME = "ACKNOWLEDGEMENT_FRAME"
}