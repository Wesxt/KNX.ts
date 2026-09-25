// #region Interfaces of DPTs
export interface DPT1Object {
  value: boolean;
}
export type DPT1 = DPT1Object | boolean;

export interface DPT2 {
  control: 0 | 1;
  value: 0 | 1;
}
export interface DPT3 {
  control: 0 | 1;
  stepCode: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
}
export interface DPT4 {
  char: string;
}
export interface DPT5Object {
  value: number; // 0-255
}
export type DPT5 = DPT5Object | number;

export interface DPT5001Object {
  value: number; // 0-100 (Percentage)
}
export type DPT5001 = DPT5001Object | number;

export interface DPT5002Object {
  value: number; // 0-360 (Angle)
}
export type DPT5002 = DPT5002Object | number;

export interface DPT6Object {
  value: number; // -128 to 127
}
export type DPT6 = DPT6Object | number;

export interface DPT6020 {
  status: 0 | 1; // 0-1 (1 bit)
  mode: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; // 0-7 (3 bits)
}
export interface DPT7Object {
  value: number; // 0-65535
}
export type DPT7 = DPT7Object | number;

export interface DPT8Object {
  value: number;
}
export type DPT8 = DPT8Object | number;

export interface DPT9Object {
  value: number;
}
export type DPT9 = DPT9Object | number;

export interface DPT10001 {
  day: number;
  hour: number;
  minutes: number;
  seconds: number;
}
export interface DPT11001 {
  day: number;
  month: number;
  year: number;
}
export interface DPT12001Object {
  value: number;
}
export type DPT12001 = DPT12001Object | number;

export interface DPT13001Object {
  value: number;
}
export type DPT13001 = DPT13001Object | number;

export interface DPT14Object {
  value: number;
}
export type DPT14 = DPT14Object | number;

export interface DPT15 {
  D6: number; // 0-9
  D5: number; // 0-9
  D4: number; // 0-9
  D3: number; // 0-9
  D2: number; // 0-9
  D1: number; // 0-9
  E: 0 | 1;
  P: 0 | 1;
  D: 0 | 1;
  C: 0 | 1;
  index: number; // 0-15
}
export interface DPT16 {
  text: string;
}
export interface DPT16002 {
  hex: string; // Cadena hexadecimal (por ejemplo: "4A5F3C2E1AFF")
}
export interface DPT20Object {
  value: number;
}
export type DPT20 = DPT20Object | number;

export interface DPT27001 {
  mask: number; // valor entre 0 y 65535
  status: number; // valor entre 0 y 65535
}
export interface DPT28001Object {
  value: string;
}
export type DPT28001 = DPT28001Object | string;

export interface DPT29Object {
  value: bigint;
}
export type DPT29 = DPT29Object | bigint;

export interface DPT238600 {
  BF: 0 | 1;
  LF: 0 | 1;
  Addr: number; // Debe estar entre 0 y 63
}
export interface DPT245600 {
  LTRF: number; // 4 bits, 0..15
  LTRD: number; // 4 bits, 0..15
  LTRP: number; // 4 bits, 0..15
  SF: number; // 2 bits, 0..3
  SD: number; // 2 bits, 0..3
  SP: number; // 2 bits, 0..3
  LDTR: number; // 16 bits, 0..65535 (en la práctica, 0..510 min, pero se codifica en 16 bits)
  LPDTR: number; // 8 bits, 0..255
}
export interface DPT250600 {
  /** Control de Colour Temperature: 0 = decrease, 1 = increase */
  cCT: 0 | 1;
  /**
   * Step Code para Colour Temperature:
   * - 0: Break
   * - 1..7: Número de intervalos (step)
   */
  stepCodeCT: number; // 0 a 7
  /** Control de Brightness: 0 = decrease, 1 = increase */
  cB: 0 | 1;
  /**
   * Step Code para Brightness:
   * - 0: Break
   * - 1..7: Número de intervalos (step)
   */
  stepCodeB: number; // 0 a 7
  /**
   * Validez de los campos de Colour Temperature (bit 1 del octeto LSB):
   * 0: inválido, 1: válido
   */
  validCT: 0 | 1;
  /**
   * Validez de los campos de Brightness (bit 0 del octeto LSB):
   * 0: inválido, 1: válido
   */
  validB: 0 | 1;
}
export interface DPT251600 {
  R: number; // Red, valor entre 0 y 255
  G: number; // Green, valor entre 0 y 255
  B: number; // Blue, valor entre 0 y 255
  W: number; // White, valor entre 0 y 255
  mR: 0 | 1; // Validez del canal Red
  mG: 0 | 1; // Validez del canal Green
  mB: 0 | 1; // Validez del canal Blue
  mW: 0 | 1; // Validez del canal White
}
// #endregion
