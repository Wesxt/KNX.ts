/**
 * Calcula el FCS (Frame Check Sequence) de un buffer KNX (sin incluir el FCS final)
 * @param buffer Buffer con el contenido del telegrama SIN el FCS
 * @returns Byte FCS calculado
 */
export function checksum(buffer: Buffer): number {
  let fcs = 0x00;
  for (let i = 0; i < buffer.length; i++) {
    fcs ^= buffer[i];
  }
  return fcs;
}
/**
 * Verifica el FCS (Frame Check Sequence) de un buffer KNX.
 * @param buffer Buffer completo del frame (incluyendo FCS al final)
 * @returns true si el FCS es válido, false en caso contrario
 */
export function verifyFCS(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  const receivedFCS = buffer[buffer.length - 1];
  const calculatedFCS = checksum(buffer.subarray(0, buffer.length - 1));

  return receivedFCS === calculatedFCS;
}

/**
 * Verifica y remueve el FCS de un buffer.
 * @param buffer Buffer completo del frame
 * @returns Buffer sin el FCS si es válido, lanza error si no lo es
 */
export function verifyAndRemoveFCS(buffer: Buffer): Buffer {
  if (!verifyFCS(buffer)) {
    throw new Error("Invalid FCS in frame");
  }
  return buffer.subarray(0, buffer.length - 1);
}
