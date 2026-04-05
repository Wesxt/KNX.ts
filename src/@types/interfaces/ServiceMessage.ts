export interface DescribeEstructure {
  /**
   * Proporciona una descripción legible del estado actual de las propiedades del sistema.
   * @returns Un objeto que describe el estado de cada propiedad.
   */
  describe(): { obj: string; [key: string]: string | number | Buffer | boolean | Record<string, any> };
}

export interface ServiceMessage extends DescribeEstructure {
  /** Write the service to the buffer */
  toBuffer(): Buffer;
}
