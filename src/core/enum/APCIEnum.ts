/**
 * Enumeración para los comandos del Application Control Field (APCI)
 *
 * Esta enumeración define los diferentes comandos que pueden ser utilizados
 * en el campo de control de aplicación (APCI) de los mensajes KNX.
 * 
 * ***Warning:*** Esta enumeración asume todos comandos dentro de 10 bits o 2 bytes pero dentro de la mascara 0x3FF, los que son de longitud de 4 bits simplemente están en una mascara 0x3C0
 *
 * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "Application Layer of the KNX System"
 */
export enum APCIEnum {
  /**
   * A_GroupValue_Read_Protocol_Data_Unit es el comando utilizado para solicitar
   * la lectura de un valor de un grupo de direcciones KNX.
   */
  A_GroupValue_Read_Protocol_Data_Unit = 0x00,
  /**
   * A_GroupValue_Response_Protocol_Data_Unit es el comando utilizado para responder
   * a una solicitud de lectura de un grupo de direcciones KNX.
   */
  A_GroupValue_Response_Protocol_Data_Unit = 0x40,
  /**
   * A_GroupValue_Write_Protocol_Data_Unit es el comando utilizado para escribir
   * un valor en un grupo de direcciones KNX.
   */
  A_GroupValue_Write_Protocol_Data_Unit = 0x80,
  /**
   * A_IndividualAddress_Write_Protocol_Data_Unit es el comando utilizado para
   * escribir un valor en una dirección individual en KNX.
   */
  A_IndividualAddress_Write_Protocol_Data_Unit = 0xC0,
  /**
   * A_IndividualAddress_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura de una dirección individual en KNX.
   */
  A_IndividualAddress_Read_Protocol_Data_Unit = 0x100,
  /**
   * A_IndividualAddress_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de una dirección individual en KNX.
   */
  A_IndividualAddress_Response_Protocol_Data_Unit = 0x140,
  /**
   * A_Analog_to_Digital_Converter_Write_Protocol_Data_Unit es el comando utilizado
   * para escribir un valor en un convertidor analógico a digital en KNX.
   */
  A_Analog_to_Digital_Converter_Read_Protocol_Data_Unit = 0x180,
  /**
   * A_Analog_to_Digital_Converter_Response_Protocol_Data_Unit es el comando utilizado
   * para responder a una solicitud de lectura de un convertidor analógico a digital en KNX.
   */
  A_Analog_to_Digital_Converter_Response_Protocol_Data_Unit = 0x1C0,
  /**
   * A_SystemNetworkParameter_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura de parámetros de red del sistema en KNX.
   */
  A_SystemNetworkParameter_Read_Protocol_Data_Unit = 0x1C8,
  /**
   * A_SystemNetworkParameter_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de parámetros de red del sistema en KNX.
   */
  A_SystemNetworkParameter_Response_Protocol_Data_Unit = 0x1C9,
  /**
   * A_SystemNetworkParameter_Write_Protocol_Data_Unit es el comando utilizado para
   * escribir parámetros de red del sistema en KNX.
   */
  A_SystemNetworkParameter_Write_Protocol_Data_Unit = 0x1CA,
  /**
   * planned for future system broadcast service
   */
  planned_for_future_system_broadcast_service = 0x1CB,
  /**
   * A_PropertyExtValue_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura de un valor extendido de propiedad en KNX.
   */
  A_PropertyExtValue_Read_Protocol_Data_Unit = 0x1CC,
  /**
   * A_PropertyExtValue_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de un valor extendido de propiedad en KNX.
   */
  A_PropertyExtValue_Response_Protocol_Data_Unit = 0x1CD,
  /**
   * A_PropertyExtValue_WriteCon_Protocol_Data_Unit es el comando utilizado para
   * escribir un valor extendido de propiedad en KNX.
   */
  A_PropertyExtValue_WriteCon_Protocol_Data_Unit = 0x1CE,
  /**
   * A_PropertyExtValue_WriteConRes_Protocol_Data_Unit es el comando utilizado para
   * escribir un valor extendido de propiedad con confirmación en KNX.
   */
  A_PropertyExtValue_WriteConRes_Protocol_Data_Unit = 0x1CF,
  /**
   * A_PropertyExtValue_WriteUnCon_Protocol_Data_Unit es el comando utilizado para
   * escribir un valor extendido de propiedad sin confirmación en KNX.
   */
  A_PropertyExtValue_WriteUnCon_Protocol_Data_Unit = 0x1D0,
  /**
   * A_PropertyExtValue_InfoReport_Protocol_Data_Unit es el comando utilizado para
   * informar sobre un valor extendido de propiedad en KNX.
   */
  A_PropertyExtValue_InfoReport_Protocol_Data_Unit = 0x1D1,
  /**
   * A_PropertyExtDescription_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura de una descripción extendida de propiedad en KNX.
   */
  A_PropertyExtDescription_Read_Protocol_Data_Unit = 0x1D2,
  /**
   * A_PropertyExtDescription_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de una descripción extendida de propiedad en KNX.
   */
  A_PropertyExtDescription_Response_Protocol_Data_Unit = 0x1D3,
  /**
   * A_FunctionPropertyExtCommand_Protocol_Data_Unit es el comando utilizado para
   * ejecutar un comando extendido de propiedad de función en KNX.
   */
  A_FunctionPropertyExtCommand_Protocol_Data_Unit = 0x1D4,
  /**
   * A_FunctionPropertyExtState_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura del estado extendido de una propiedad de función en KNX.
   */
  A_FunctionPropertyExtState_Read_Protocol_Data_Unit = 0x1D5,
  /**
   * A_FunctionPropertyExtState_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura del estado extendido de una propiedad de función en KNX.
   */
  A_FunctionPropertyExtState_Response_Protocol_Data_Unit = 0x1D6,
    /**
   * A_MemoryExtended_Write_Protocol_Data_Unit es el comando utilizado para escribir datos extendidos en la memoria de un dispositivo KNX.
   * 
   * Este comando forma parte de la especificación avanzada del Application Layer y permite la transferencia de bloques de datos a la memoria interna de dispositivos KNX,
   * facilitando operaciones como la programación, actualización o configuración avanzada de dispositivos desde la capa de aplicación.
   * 
   * @see {@link https://my.knx.org/es/shop/knx-specifications?product_type=knx-specifications} - "Application Layer of the KNX System"
   */
  A_MemoryExtended_Write_Protocol_Data_Unit = 0x1FB,
  /**
   * A_MemoryExtended_Read_Protocol_Data_Unit es el comando utilizado para leer datos extendidos de la memoria de un dispositivo KNX.
   * 
   * Este comando permite acceder a bloques de datos almacenados en la memoria interna de dispositivos KNX, facilitando la recuperación de información
   * necesaria para la configuración o monitoreo de dispositivos desde la capa de aplicación.
   */
  A_MemoryExtended_WriteResponse_Protocol_Data_Unit = 0x1FC,
  /**
   * A_MemoryExtended_Read_Protocol_Data_Unit es el comando utilizado para leer datos extendidos de la memoria de un dispositivo KNX.
   * 
   * Este comando permite acceder a bloques de datos almacenados en la memoria interna de dispositivos KNX, facilitando la recuperación de información
   * necesaria para la configuración o monitoreo de dispositivos desde la capa de aplicación.
   */
  A_MemoryExtended_Read_Protocol_Data_Unit = 0x1FD,
  /**
   * A_MemoryExtended_ReadResponse_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de datos extendidos de la memoria de un dispositivo KNX.
   */
  A_MemoryExtended_ReadResponse_Protocol_Data_Unit = 0x1FE,
  /**
   * A_Memory_Read_Protocol_Data_Unit es el comando utilizado para leer datos de la memoria de un dispositivo KNX.
   * 
   * Este comando permite acceder a bloques de datos almacenados en la memoria interna de dispositivos KNX, facilitando la recuperación de información
   * necesaria para la configuración o monitoreo de dispositivos desde la capa de aplicación.
   */
  A_Memory_Read_Protocol_Data_Unit = 0x200,
  /**
   * A_Memory_Response_Protocol_Data_Unit es el comando utilizado para responder a una solicitud de lectura de datos de la memoria de un dispositivo KNX.
   * 
   * Este comando permite enviar los datos leídos desde la memoria interna de dispositivos KNX, facilitando la comunicación efectiva entre dispositivos en la red KNX.
   */
  A_Memory_Response_Protocol_Data_Unit = 0x240,
  /**
   * A_Memory_Write_Protocol_Data_Unit es el comando utilizado para escribir datos en la memoria de un dispositivo KNX.
   * 
   * Este comando permite transferir bloques de datos a la memoria interna de dispositivos KNX, facilitando la configuración o actualización de dispositivos desde la capa de aplicación.
   */
  A_Memory_Write_Protocol_Data_Unit = 0x280,
  /**
   * A_UserMemory_Read_Protocol_Data_Unit es el comando utilizado para solicitar la lectura de datos de memoria de usuario en un dispositivo KNX.
   * 
   * Este comando permite acceder a bloques de datos específicos almacenados en la memoria de usuario, facilitando la recuperación de información personalizada o configuraciones específicas del dispositivo.
   */
  A_UserMemory_Read_Protocol_Data_Unit = 0x2C0,
  /**
   * A_UserMemory_Response_Protocol_Data_Unit es el comando utilizado para responder a una solicitud de lectura de datos de memoria de usuario en un dispositivo KNX.
   * 
   * Este comando permite enviar los datos leídos desde la memoria de usuario, facilitando la comunicación efectiva y la recuperación de información personalizada en la red KNX.
   */
  A_UserMemory_Response_Protocol_Data_Unit = 0x2C1,
  /**
   * A_UserMemory_Write_Protocol_Data_Unit es el comando utilizado para escribir datos en la memoria de usuario de un dispositivo KNX.
   * 
   * Este comando permite transferir bloques de datos a la memoria de usuario, facilitando la configuración o actualización de información personalizada en dispositivos KNX desde la capa de aplicación.
   */
  A_UserMemory_Write_Protocol_Data_Unit = 0x2C2,
  /**
   * A_UserMemoryBit_Write_Protocol_Data_Unit es el comando utilizado para escribir un bit específico en la memoria de usuario de un dispositivo KNX.
   * 
   * Este comando permite modificar un único bit en la memoria de usuario, facilitando operaciones de configuración o actualización de estados específicos en dispositivos KNX desde la capa de aplicación.
   *
   * *Warning:* This service shall not be used for future Profile definitions.
   */
  A_UserMemoryBit_Write_Protocol_Data_Unit = 0x2C4,
  /**
   * A_UserManufacturerInfo_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura de información del fabricante de un dispositivo KNX.
   * 
   * Este comando permite acceder a datos específicos del fabricante, como el nombre, modelo y versión del dispositivo, facilitando la identificación y gestión de dispositivos en la red KNX.
   */
  A_UserManufacturerInfo_Read_Protocol_Data_Unit = 0x2C5,
  /**
   * A_UserManufacturerInfo_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de información del fabricante de un dispositivo KNX.
   * 
   * Este comando permite enviar los datos del fabricante, como el nombre, modelo y versión del dispositivo, facilitando la comunicación efectiva y la identificación de dispositivos en la red KNX.
   */
  A_UserManufacturerInfo_Response_Protocol_Data_Unit = 0x2C6,
  /**
   * A_FunctionPropertyCommand_Protocol_Data_Unit es el comando utilizado para
   * gestionar propiedades de función en un dispositivo KNX.
   * 
   * Este comando permite la configuración y control de propiedades específicas de función, facilitando la personalización y adaptación de dispositivos en la red KNX.
   */
  A_FunctionPropertyCommand_Protocol_Data_Unit = 0x2C7,
  /**
   * A_FunctionPropertyState_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura del estado de una propiedad de función en un dispositivo KNX.
   * 
   * Este comando permite acceder al estado actual de propiedades específicas de función, facilitando la monitorización y gestión de dispositivos en la red KNX.
   */
  A_FunctionPropertyState_Read_Protocol_Data_Unit = 0x2C8,
  /**
   * A_FunctionPropertyState_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura del estado de una propiedad de función en un dispositivo KNX.
   * 
   * Este comando permite enviar el estado actual de propiedades específicas de función, facilitando la comunicación efectiva y la monitorización de dispositivos en la red KNX.
   */
  A_FunctionPropertyState_Response_Protocol_Data_Unit = 0x2C9,
  /**
   * Reserved USERMSG
   */
  Reserved_USERMSG = 0x2CA,
  Reserved_USERMSG_2 = 0x2F7,
  Reserved_USERMSG_3 = 0x2F8,
  Reserved_USERMSG_4 = 0x2FE,
  /**
   * A_DeviceDescriptor_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura de un descriptor de dispositivo en KNX.
   * 
   * Este comando permite acceder a información detallada sobre el dispositivo, como su tipo, versión y capacidades, facilitando la identificación y gestión de dispositivos en la red KNX.
   */
  A_DeviceDescriptor_Read_Protocol_Data_Unit = 0x300,
  /**
   * A_DeviceDescriptor_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de un descriptor de dispositivo en KNX.
   * 
   * Este comando permite enviar la información del descriptor del dispositivo, como su tipo, versión y capacidades, facilitando la comunicación efectiva y la identificación de dispositivos en la red KNX.
   */
  A_DeviceDescriptor_Response_Protocol_Data_Unit = 0x340,
  /**
   * A_Restart_Protocol_Data_Unit es el comando utilizado para reiniciar un dispositivo KNX.
   * 
   * Este comando permite iniciar un proceso de reinicio en el dispositivo, facilitando la recuperación de estados o la aplicación de nuevas configuraciones desde la capa de aplicación.
   */
  A_Restart_Protocol_Data_Unit = 0x380,
  /**
   * A_FilterTable_Open_Protocol_Data_Unit es el comando utilizado para abrir una tabla de filtros en un dispositivo KNX.
   * 
   * Este comando permite iniciar la configuración o modificación de filtros en el dispositivo, facilitando la gestión de datos y eventos en la red KNX.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_FilterTable_Open_Protocol_Data_Unit = 0x3C0,
  /**
   * A_FilterTable_Read_Protocol_Data_Unit es el comando utilizado para solicitar la lectura de una tabla de filtros en un dispositivo KNX.
   * 
   * Este comando permite acceder a los datos de configuración de filtros, facilitando la monitorización y gestión de eventos en la red KNX.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_FilterTable_Read_Protocol_Data_Unit = 0x3C1,
  /**
   * A_FilterTable_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de una tabla de filtros en un dispositivo KNX.
   * 
   * Este comando permite enviar los datos de configuración de filtros, facilitando la comunicación efectiva y la gestión de eventos en la red KNX.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_FilterTable_Response_Protocol_Data_Unit = 0x3C2,
  /**
   * A_FilterTable_Write_Protocol_Data_Unit es el comando utilizado para escribir
   * datos en una tabla de filtros en un dispositivo KNX.
   * 
   * Este comando permite modificar la configuración de filtros, facilitando la adaptación de eventos y datos en la red KNX desde la capa de aplicación.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_FilterTable_Write_Protocol_Data_Unit = 0x3C3,
  /**
   * A_RouterMemory_Read_Protocol_Data_Unit es el comando utilizado para solicitar
   * la lectura de datos de memoria de un router en un dispositivo KNX.
   * 
   * Este comando permite acceder a bloques de datos específicos almacenados en la memoria del router, facilitando la recuperación de información necesaria para la configuración o monitoreo de dispositivos en la red KNX.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_RouterMemory_Read_Protocol_Data_Unit = 0x3C8,
  /**
   * A_RouterMemory_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de datos de memoria de un router en un dispositivo KNX.
   * 
   * Este comando permite enviar los datos de memoria solicitados, facilitando la comunicación efectiva y la gestión de dispositivos en la red KNX.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_RouterMemory_Response_Protocol_Data_Unit = 0x3C9,
  /**
   * A_RouterMemory_Write_Protocol_Data_Unit es el comando utilizado para escribir
   * datos en la memoria de un router en un dispositivo KNX.
   * 
   * Este comando permite transferir bloques de datos a la memoria del router, facilitando la configuración o actualización de dispositivos desde la capa de aplicación.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_RouterMemory_Write_Protocol_Data_Unit = 0x3CA,
  /**
   * A_RouterStatus_Read_Protocol_Data_Unit es el comando utilizado para solicitar
   * la lectura del estado de un router en un dispositivo KNX.
   * 
   * Este comando permite acceder a información sobre el estado operativo del router, facilitando la monitorización y gestión de dispositivos en la red KNX.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_RouterStatus_Read_Protocol_Data_Unit = 0x3CD,
  /**
   * A_RouterStatus_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura del estado de un router en un dispositivo KNX.
   * 
   * Este comando permite enviar información sobre el estado operativo del router, facilitando la comunicación efectiva y la monitorización de dispositivos en la red KNX.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_RouterStatus_Response_Protocol_Data_Unit = 0x3CE,
  /**
   * A_RouterStatus_Write_Protocol_Data_Unit es el comando utilizado para escribir
   * datos de estado en un router en un dispositivo KNX.
   * 
   * Este comando permite modificar el estado operativo del router, facilitando la configuración o actualización de dispositivos desde la capa de aplicación.
   * 
   * *Warning:* This service shall not be used for future Profile definitions.
   * 
   */
  A_RouterStatus_Write_Protocol_Data_Unit = 0x3CF,
  /**
   * A_MemoryBit_Read_Protocol_Data_Unit es el comando utilizado para solicitar
   * la lectura de un bit específico en la memoria de un dispositivo KNX.
   * 
   * Este comando permite acceder a un único bit en la memoria, facilitando la recuperación de información específica o el estado de un dispositivo desde la capa de aplicación.
   * 
   * *Warning:* Not for future use
   */
  A_MemoryBit_Write_Protocol_Data_Unit = 0x3D0,
  /**
   * A_Authorize_Request_Protocol_Data_Unit es el comando utilizado para solicitar
   * autorización en un dispositivo KNX.
   * 
   * Este comando permite iniciar un proceso de autorización, facilitando la gestión de accesos y permisos en la red KNX desde la capa de aplicación.
   */
  A_Authorize_Request_Protocol_Data_Unit = 0x3D1,
  /**
   * A_Authorize_Response_Protocol_Data_Unit es el comando utilizado para responder
   * a una solicitud de autorización en un dispositivo KNX.
   * 
   * Este comando permite enviar la respuesta a una solicitud de autorización, facilitando la gestión de accesos y permisos en la red KNX desde la capa de aplicación.
   */
  A_Authorize_Response_Protocol_Data_Unit = 0x3D2,
  /**
   * A_Key_Write_Protocol_Data_Unit es el comando utilizado para escribir una clave
   * en un dispositivo KNX.
   * 
   * Este comando permite transferir una clave de seguridad a un dispositivo, facilitando la configuración de seguridad y autenticación en la red KNX desde la capa de aplicación.
   */
  A_Key_Write_Protocol_Data_Unit = 0x3D3,
  /**
   * A_Key_Response_Protocol_Data_Unit es el comando utilizado para responder a una
   * solicitud de clave en un dispositivo KNX.
   * 
   * Este comando permite enviar una respuesta a una solicitud de clave, facilitando la gestión de seguridad y autenticación en la red KNX desde la capa de aplicación.
   */
  A_Key_Response_Protocol_Data_Unit = 0x3D4,
  /**
   * A_PropertyValue_Read_Protocol_Data_Unit es el comando utilizado para solicitar
   * la lectura de un valor de propiedad en un dispositivo KNX.
   * 
   * Este comando permite acceder a un valor de propiedad específico, facilitando la
   * recuperación de información desde la capa de aplicación.
   */
  A_PropertyValue_Read_Protocol_Data_Unit = 0x3D5,
  /**
   * A_PropertyValue_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de un valor de propiedad en un dispositivo KNX.
   * 
   * Este comando permite enviar el valor de propiedad solicitado, facilitando la
   * comunicación efectiva y la recuperación de información desde la capa de aplicación.
   */
  A_PropertyValue_Response_Protocol_Data_Unit = 0x3D6,
  /**
   * A_PropertyValue_Write_Protocol_Data_Unit es el comando utilizado para escribir
   * un valor de propiedad en un dispositivo KNX.
   * 
   * Este comando permite transferir un valor de propiedad a un dispositivo, facilitando la configuración o actualización de propiedades desde la capa de aplicación.
   */
  A_PropertyValue_Write_Protocol_Data_Unit = 0x3D7,
  /**
   * A_PropertyDescription_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura de una descripción de propiedad en un dispositivo KNX.
   * 
   * Este comando permite acceder a información detallada sobre una propiedad específica, facilitando la identificación y gestión de propiedades desde la capa de aplicación.
   */
  A_PropertyDescription_Read_Protocol_Data_Unit = 0x3D8,
  /**
   * A_PropertyDescription_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de una descripción de propiedad en un dispositivo KNX.
   * 
   * Este comando permite enviar la descripción de propiedad solicitada, facilitando la comunicación efectiva y la identificación de propiedades desde la capa de aplicación.
   */
  A_PropertyDescription_Response_Protocol_Data_Unit = 0x3D9,
  /**
   * A_NetworkParameter_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura de parámetros de red en un dispositivo KNX.
   * 
   * Este comando permite acceder a información sobre la configuración de red del dispositivo, facilitando la gestión y monitorización de la red KNX desde la capa de aplicación.
   */
  A_NetworkParameter_Read_Protocol_Data_Unit = 0x3DA,
  /**
   * A_NetworkParameter_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de parámetros de red en un dispositivo KNX.
   * 
   * Este comando permite enviar los parámetros de red solicitados, facilitando la comunicación efectiva y la gestión de la red KNX desde la capa de aplicación.
   */
  A_NetworkParameter_Response_Protocol_Data_Unit = 0x3DB,
  /**
   * A_IndividualAddressSerialNumber_Read_Protocol_Data_Unit es el comando utilizado
   * para solicitar la lectura del número de serie de una dirección individual en un dispositivo KNX.
   * 
   * Este comando permite acceder al número de serie asociado a una dirección individual, facilitando la identificación y gestión de dispositivos en la red KNX desde la capa de aplicación.
   */
  A_IndividualAddressSerialNumber_Read_Protocol_Data_Unit = 0x3DC,
  /**
   * A_IndividualAddressSerialNumber_Response_Protocol_Data_Unit es el comando utilizado
   * para responder a una solicitud de lectura del número de serie de una dirección individual en un dispositivo KNX.
   * 
   * Este comando permite enviar el número de serie asociado a una dirección individual, facilitando la identificación y gestión de dispositivos en la red KNX desde la capa de aplicación.
   */
  A_IndividualAddressSerialNumber_Response_Protocol_Data_Unit = 0x3DD,
  /**
   * A_IndividualAddressSerialNumber_Write_Protocol_Data_Unit es el comando utilizado
   * para escribir un número de serie en una dirección individual en un dispositivo KNX.
   * 
   * Este comando permite transferir un número de serie a una dirección individual, facilitando la configuración o actualización de dispositivos desde la capa de aplicación.
   */
  A_IndividualAddressSerialNumber_Write_Protocol_Data_Unit = 0x3DE,
  /**
   * Reserved_2 es un comando reservado en el protocolo KNX.
   * 
   * Este comando no se utiliza actualmente y se reserva para futuros propósitos o extensiones del protocolo.
   * * *Warning:* This APCI-value 3DFh has been used in the past for the service A_ServiceInformation_Indication. This APCI shall not be used for new implementations.
   */
  Reserved_2 = 0x3DF,
  /**
   * A_DomainAddress_Write_Protocol_Data_Unit es el comando utilizado para escribir
   * una dirección de dominio en un dispositivo KNX.
   * 
   * Este comando permite transferir una dirección de dominio a un dispositivo, facilitando la configuración o actualización de direcciones de dominio desde la capa de aplicación.
   */
  A_DomainAddress_Write_Protocol_Data_Unit = 0x3E0,
  /**
   * A_DomainAddress_Read_Protocol_Data_Unit es el comando utilizado para solicitar
   * la lectura de una dirección de dominio en un dispositivo KNX.
   * 
   * Este comando permite acceder a la dirección de dominio configurada en un dispositivo, facilitando la identificación y gestión de direcciones de dominio desde la capa de aplicación.
   */
  A_DomainAddress_Read_Protocol_Data_Unit = 0x3E1,
  /**
   * A_DomainAddress_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de una dirección de dominio en un dispositivo KNX.
   * 
   * Este comando permite enviar la dirección de dominio configurada en un dispositivo, facilitando la comunicación efectiva y la gestión de direcciones de dominio desde la capa de aplicación.
   */
  A_DomainAddress_Response_Protocol_Data_Unit = 0x3E2,
  /**
   * A_DomainAddressSelective_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura selectiva de una dirección de dominio en un dispositivo KNX.
   * 
   * Este comando permite acceder a información específica de una dirección de dominio, facilitando la recuperación de datos relevantes desde la capa de aplicación.
   */
  A_DomainAddressSelective_Read_Protocol_Data_Unit = 0x3E3,
  /**
   * A_NetworkParameter_Write_Protocol_Data_Unit es el comando utilizado para
   * escribir parámetros de red en un dispositivo KNX.
   * 
   * Este comando permite transferir bloques de datos de configuración de red a un dispositivo, facilitando la actualización o configuración de parámetros de red desde la capa de aplicación.
   */
  A_NetworkParameter_Write_Protocol_Data_Unit = 0x3E4,
  /**
   * A_Link_Read_Protocol_Data_Unit es el comando utilizado para solicitar la lectura
   * de datos de enlace en un dispositivo KNX.
   * 
   * Este comando permite acceder a información específica del enlace, facilitando la monitorización y gestión de la comunicación entre dispositivos en la red KNX desde la capa de aplicación.
   */
  A_Link_Read_Protocol_Data_Unit = 0x3E5,
  /**
   * A_Link_Response_Protocol_Data_Unit es el comando utilizado para responder a una
   * solicitud de lectura de datos de enlace en un dispositivo KNX.
   * 
   * Este comando permite enviar los datos de enlace solicitados, facilitando la comunicación efectiva y la gestión de la comunicación entre dispositivos en la red KNX desde la capa de aplicación.
   */
  A_Link_Response_Protocol_Data_Unit = 0x3E6,
  /**
   * A_Link_Write_Protocol_Data_Unit es el comando utilizado para escribir datos de enlace
   * en un dispositivo KNX.
   * 
   * Este comando permite transferir bloques de datos de enlace a un dispositivo, facilitando la configuración o actualización de la comunicación entre dispositivos en la red KNX desde la capa de aplicación.
   */
  A_Link_Write_Protocol_Data_Unit = 0x3E7,
  /**
   * A_GroupPropValue_Read_Protocol_Data_Unit es el comando utilizado para solicitar
   * la lectura de un valor de propiedad de grupo en un dispositivo KNX.
   * 
   * Este comando permite acceder a un valor de propiedad específico asociado a un grupo, facilitando la recuperación de información desde la capa de aplicación.
   */
  A_GroupPropValue_Read_Protocol_Data_Unit = 0x3E8,
  /**
   * A_GroupPropValue_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura de un valor de propiedad de grupo en un dispositivo KNX.
   * 
   * Este comando permite enviar el valor de propiedad solicitado, facilitando la comunicación efectiva y la recuperación de información desde la capa de aplicación.
   */
  A_GroupPropValue_Response_Protocol_Data_Unit = 0x3E9,
  /**
   * A_GroupPropValue_Write_Protocol_Data_Unit es el comando utilizado para escribir
   * un valor de propiedad de grupo en un dispositivo KNX.
   * 
   * Este comando permite transferir un valor de propiedad a un grupo, facilitando la configuración o actualización de propiedades de grupo desde la capa de aplicación.
   */
  A_GroupPropValue_Write_Protocol_Data_Unit = 0x3EA,
  /**
   * A_GroupPropValue_InfoReport_Protocol_Data_Unit es el comando utilizado para
   * informar sobre un valor de propiedad de grupo en un dispositivo KNX.
   * 
   * Este comando permite enviar información sobre un valor de propiedad de grupo, facilitando la comunicación efectiva y la monitorización de propiedades de grupo desde la capa de aplicación.
   */
  A_GroupPropValue_InfoReport_Protocol_Data_Unit = 0x3EB,
  /**
   * A_DomainAddressSerialNumber_Read_Protocol_Data_Unit es el comando utilizado para
   * solicitar la lectura del número de serie de una dirección de dominio en un dispositivo KNX.
   * 
   * Este comando permite acceder al número de serie asociado a una dirección de dominio, facilitando la identificación y gestión de dispositivos en la red KNX desde la capa de aplicación.
   */
  A_DomainAddressSerialNumber_Read_Protocol_Data_Unit = 0x3EC,
  /**
   * A_DomainAddressSerialNumber_Response_Protocol_Data_Unit es el comando utilizado para
   * responder a una solicitud de lectura del número de serie de una dirección de dominio en un dispositivo KNX.
   * 
   * Este comando permite enviar el número de serie asociado a una dirección de dominio, facilitando la identificación y gestión de dispositivos en la red KNX desde la capa de aplicación.
   */
  A_DomainAddressSerialNumber_Response_Protocol_Data_Unit = 0x3ED,
  /**
   * A_DomainAddressSerialNumber_Write_Protocol_Data_Unit es el comando utilizado para
   * escribir el número de serie de una dirección de dominio en un dispositivo KNX.
   * 
   * Este comando permite transferir un nuevo número de serie a una dirección de dominio, facilitando la configuración o actualización de dispositivos en la red KNX desde la capa de aplicación.
   */
  A_DomainAddressSerialNumber_Write_Protocol_Data_Unit = 0x3EE,
  /**
   * A_FileStream_InforReport_Protocol_Data_Unit es el comando utilizado para
   * informar sobre un flujo de datos de archivo en un dispositivo KNX.
   * 
   * Este comando permite enviar información sobre un flujo de datos de archivo, facilitando la gestión y transferencia de archivos en la red KNX desde la capa de aplicación.
   */
  A_FileStream_InfoReport_Protocol_Data_Unit = 0x3F0,
}