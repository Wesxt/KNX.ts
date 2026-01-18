/**
 * Es el identificador del punto de acceso de servicio en la Capa de Aplicación.
 *
 * En KNX, se usa para seleccionar la funcionalidad de aplicación a la que se entrega el APDU.
 *
 * **Advertencia:** No hay info clara con respecto a esto; incluso puede ser inexistente en la especificación
 */
export enum SAP {
  /**Se usa en Group Communication normal (la gran mayoría de los telegramas). */
  Application_Layer_SAP_default = 0,
  /**Usado para gestión de dispositivos, commissioning, etc. */
  Device_Management_SAP = 1,
  /**Para servicios PropertyValue_Read/Write (extensiones de gestión). */
  Property_Access_SAP = 2,
  /**Para servicios de transferencia de ficheros (raro en la práctica). */
  File_Transfer_SAP = 3,
  /**Acceso a objetos de aplicación. */
  Object_Access_SAP = 4,
}
