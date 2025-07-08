/**
 * The default destination is the layer where the system shall direct the message to if no redirection is set.
 */
enum DefaultDestination {
  Data_Link_Layer = "DLL",
  Network_Layer = "NL",
  Transport_Layer = "TL",
  /**
   * (not in EMI1/IMI1)
   */
  Transport_Layer_Group_Oriented = "TLG",
  /**
   * (not in EMI1/IMI1)
   */
  Transport_Layer_Connection_Oriented = "TLC",
  /**
   * (not in EMI1/IMI1)
   */
  Transport_Layer_Local = "TLL",
  Application_Layer = "AL",
  Group_Oriented_Part_Of_The_AL = "ALG",
  Management_Part_Of_The_AL = "MAN",
  Physical_External_Interface = "PEI",
  /**
   * Application running in the BAU. If the User is not running, the messages are directed to the PEI.
   */
  USR = "USR",
}

/**
 * @alias MessageCodeField
 * @description The Message Code Field is a part of the External Message Interface (EMI) that defines the destination of a message within the KNX system. It specifies where the message should be directed, such as to the Data Link Layer, Network Layer, or Application Layer.
 * @version Version 01.04.02 is a KNX Approved Standard.
 */
export const MESSAGE_CODE_FIELD = {
  "Ph_Data.req": {
    "EMI2/IMI2": { value: 0x01 },
  },
  "Ph_data.con": {
    "EMI2/IMI2": { value: 0x1E }
  },
  "Ph_Data.ind": {
    "EMI2/IMI2": { value: 0x19 }
  },
  "L_Busmon.ind": {
    IMI1: { value: 0x29, destination: DefaultDestination.Physical_External_Interface },
    EMI1: { value: 0x49, destination: DefaultDestination.Physical_External_Interface },
    "EMI2/IMI2": { value: 0x2B, destination: DefaultDestination.Physical_External_Interface },
    CEMI: { value: 0x2B, destination: DefaultDestination.Physical_External_Interface },
  },
  "L_Data.req": {
    IMI1: { value: 0x11, destination: DefaultDestination.Data_Link_Layer },
    EMI1: { value: 0x11, destination: DefaultDestination.Data_Link_Layer },
    "EMI2/IMI2": { value: 0x11, destination: DefaultDestination.Data_Link_Layer },
    CEMI: { value: 0x11, destination: DefaultDestination.Data_Link_Layer },
  },
  "L_Data.con": {
    IMI1: { value: 0x2E, destination: DefaultDestination.Transport_Layer },
    EMI1: { value: 0x4E, destination: DefaultDestination.Transport_Layer },
    "EMI2/IMI2": { value: 0x2E, destination: DefaultDestination.Network_Layer },
    CEMI: { value: 0x2E, destination: DefaultDestination.Network_Layer },
  },
  "L_Data.ind": {
    IMI1: { value: 0x29, destination: DefaultDestination.Transport_Layer },
    EMI1: { value: 0x49, destination: DefaultDestination.Transport_Layer },
    "EMI2/IMI2": { value: 0x29, destination: DefaultDestination.Network_Layer },
    CEMI: { value: 0x29, destination: DefaultDestination.Network_Layer },
  },
  "L_SystemBroadcast.req": {
    IMI1: { value: 0x15 },
    EMI1: { value: 0x15 },
    "EMI2/IMI2": { value: 0x17 },
  },
  "L_SystemBroadcast.con": {
    IMI1: { value: 0x2C },
    EMI1: { value: 0x4C },
    "EMI2/IMI2": { value: 0x26 },
  },
  "L_SystemBroadcast.ind": {
    IMI1: { value: 0x2B },
    EMI1: { value: 0x4B },
    "EMI2/IMI2": { value: 0x28 },
  },
  "L_Plain_Data.req": {
    "EMI2/IMI2": { value: 0x10, destination: DefaultDestination.Data_Link_Layer },
  },
  "L_Raw.req": {
    "EMI2/IMI2": { value: 0x10, destination: DefaultDestination.Data_Link_Layer },
    CEMI: { value: 0x10, destination: DefaultDestination.Data_Link_Layer },
  },
  "L_Raw.ind": {
    CEMI: { value: 0x2D, destination: DefaultDestination.Network_Layer },
  },
  "L_Raw.con": {
    CEMI: { value: 0x2F, destination: DefaultDestination.Network_Layer },
  },
  "L_Poll_Data.req": {
    "EMI2/IMI2": { value: 0x13, destination: DefaultDestination.Data_Link_Layer },
    CEMI: { value: 0x13, destination: DefaultDestination.Data_Link_Layer },
  },
  "L_Poll_Data.con": {
    "EMI2/IMI2": { value: 0x25, destination: DefaultDestination.Network_Layer },
    CEMI: { value: 0x25, destination: DefaultDestination.Network_Layer },
  },
  "L_Meter.ind": {
    "EMI2/IMI2": { value: 0x24, destination: DefaultDestination.Network_Layer },
  },
  "N_Data_Individual.req": {
    "EMI2/IMI2": { value: 0x21, destination: DefaultDestination.Network_Layer },
  },
  "N_Data_Individual.con": {
    "EMI2/IMI2": { value: 0x4E, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
  },
  "N_Data_Individual.ind": {
    "EMI2/IMI2": { value: 0x49, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
  },
  "N_Data_Group.req": {
    "EMI2/IMI2": { value: 0x22, destination: DefaultDestination.Network_Layer },
  },
  "N_Data_Group.con": {
    "EMI2/IMI2": { value: 0x3E, destination: DefaultDestination.Transport_Layer_Group_Oriented },
  },
  "N_Data_Group.ind": {
    "EMI2/IMI2": { value: 0x3A, destination: DefaultDestination.Transport_Layer_Group_Oriented },
  },
  "N_Data_Broadcast.req": {
    "EMI2/IMI2": { value: 0x2C, destination: DefaultDestination.Network_Layer },
  },
  "N_Data_Broadcast.con": {
    "EMI2/IMI2": { value: 0x4F, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
  },
  "N_Data_Broadcast.ind": {
    "EMI2/IMI2": { value: 0x4D, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
  },
  "N_Poll_Data.req": {
    "EMI2/IMI2": { value: 0x23, destination: DefaultDestination.Network_Layer },
  },
  "N_Poll_Data.con": {
    "EMI2/IMI2": { value: 0x35, destination: DefaultDestination.Transport_Layer_Group_Oriented },
  },
  "T_Connect.req": {
    IMI1: { value: 0x23, destination: DefaultDestination.Transport_Layer },
    EMI1: { value: 0x23, destination: DefaultDestination.Transport_Layer },
    "EMI2/IMI2": { value: 0x43, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
  },
  "T_Connect.con": {
    "EMI2/IMI2": { value: 0x86, destination: DefaultDestination.Management_Part_Of_The_AL }
  },
  "T_Connect.ind": {
    IMI1: { value: 0x33, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x43, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x85, destination: DefaultDestination.Management_Part_Of_The_AL }
  },
  "T_Disconnect.req": {
    IMI1: { value: 0x24, destination: DefaultDestination.Transport_Layer },
    EMI1: { value: 0x24, destination: DefaultDestination.Transport_Layer },
    "EMI2/IMI2": { value: 0x44, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
  },
  "T_Disconnect.con": {
    "EMI2/IMI2": { value: 0x88, destination: DefaultDestination.Management_Part_Of_The_AL }
  },
  "T_Disconnect.ind": {
    IMI1: { value: 0x34, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x44, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x87, destination: DefaultDestination.Management_Part_Of_The_AL }
  },
  "T_Data_Connected.req": {
    IMI1: { value: 0x21, destination: DefaultDestination.Transport_Layer },
    EMI1: { value: 0x21, destination: DefaultDestination.Transport_Layer },
    "EMI2/IMI2": { value: 0x41, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
    CEMI: { value: 0x41, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
  },
  "T_Data_Connected.con": {
    "EMI2/IMI2": { value: 0x8E, destination: DefaultDestination.Management_Part_Of_The_AL }
  },
  "T_Data_Connected.ind": {
    IMI1: { value: 0x39, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x49, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x89, destination: DefaultDestination.Management_Part_Of_The_AL },
    CEMI: { value: 0x89, destination: DefaultDestination.Management_Part_Of_The_AL },
  },
  "T_Data_Group.req": {
    IMI1: { value: 0x22, destination: DefaultDestination.Transport_Layer },
    EMI1: { value: 0x22, destination: DefaultDestination.Transport_Layer },
    "EMI2/IMI2": { value: 0x32, destination: DefaultDestination.Transport_Layer_Group_Oriented },
  },
  "T_Data_Group.con": {
    IMI1: { value: 0x3E, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    EMI1: { value: 0x4E, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x7E, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL }
  },
  "T_Data_Group.ind": {
    IMI1: { value: 0x3A, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    EMI1: { value: 0x4A, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x7A, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL }
  },
  "T_Data_Broadcast.req": {
    IMI1: { value: 0x2B, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
    EMI1: { value: 0x2B, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
    "EMI2/IMI2": { value: 0x4C, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
  },
  "T_Data_Broadcast.con": {
    "EMI2/IMI2": { value: 0x8F, destination: DefaultDestination.Management_Part_Of_The_AL }
  },
  "T_Data_Broadcast.ind": {
    IMI1: { value: 0x38, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x48, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x8D, destination: DefaultDestination.Management_Part_Of_The_AL }
  },
  "T_Data_SystemBroadcast.req": {
    IMI1: { value: 0x25 },
    EMI1: { value: 0x25 },
  },
  "T_Data_SystemBroadcast.con": {
    IMI1: { value: 0x3C },
    EMI1: { value: 0x4C },
  },
  "T_Data_SystemBroadcast.ind": {
    IMI1: { value: 0x3D },
    EMI1: { value: 0x4D },
  },
  "T_Data_Individual.req": {
    IMI1: { value: 0x2A, destination: DefaultDestination.Transport_Layer },
    EMI1: { value: 0x2A, destination: DefaultDestination.Transport_Layer },
    "EMI2/IMI2": { value: 0x4A, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
    CEMI: { value: 0x4A, destination: DefaultDestination.Transport_Layer_Connection_Oriented },
  },
  "T_Data_Individual.con": {
    IMI1: { value: 0x3F, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x4F, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x9C, destination: DefaultDestination.Management_Part_Of_The_AL }
  },
  "T_Data_Individual.ind": {
    IMI1: { value: 0x32, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x42, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x94, destination: DefaultDestination.Management_Part_Of_The_AL },
    CEMI: { value: 0x94, destination: DefaultDestination.Management_Part_Of_The_AL },
  },
  "T_Poll_Data.req": {
    "EMI2/IMI2": { value: 0x33, destination: DefaultDestination.Transport_Layer_Group_Oriented },
  },
  "T_Poll_Data.con": {
    "EMI2/IMI2": { value: 0x75, destination: DefaultDestination.Transport_Layer_Group_Oriented },
  },
  "M_Connect.req": null,
  "M_Connect.con": null,
  "M_Connect.ind": {
    "EMI2/IMI2": { value: 0xD5, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "M_Disconnect.req": null,
  "M_Disconnect.con": null,
  "M_Disconnect.ind": {
    "EMI2/IMI2": { value: 0xD7, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "M_User_Data_Connected.req": {
    IMI1: { value: 0x31, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x31, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x82, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "M_User_Data_Connected.con": {
    "EMI2/IMI2": { value: 0xD1, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "M_User_Data_Connected.ind": {
    IMI1: { value: 0x59, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x49, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0xD2, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "A_Data_Group.req": {
    "EMI2/IMI2": { value: 0x72, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
  },
  "A_Data_Group.con": {
    "EMI2/IMI2": { value: 0xEE, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "A_Data_Group.ind": {
    "EMI2/IMI2": { value: 0xEA, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "M_User_Data_Individual.req": {
    "EMI2/IMI2": { value: 0x81, destination: DefaultDestination.Management_Part_Of_The_AL },
  },
  "M_User_Data_Individual.con": {
    "EMI2/IMI2": { value: 0xDE, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "M_User_Data_Individual.ind": {
    "EMI2/IMI2": { value: 0xD9, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "A_Poll_Data.req": {
    "EMI2/IMI2": { value: 0x73, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
  },
  "A_Poll_Data.con": {
    "EMI2/IMI2": { value: 0xE5, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "M_InterfaceObj_Data.req": {
    "EMI2/IMI2": { value: 0x9A, destination: DefaultDestination.Management_Part_Of_The_AL },
  },
  "M_InterfaceObj_Data.con": {
    "EMI2/IMI2": { value: 0xDC, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "M_InterfaceObj_Data.ind": {
    "EMI2/IMI2": { value: 0xD4, destination: [DefaultDestination.USR, DefaultDestination.Physical_External_Interface] },
  },
  "U_Value_Read.req": {
    IMI1: { value: 0x35, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    EMI1: { value: 0x35, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x74, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
  },
  "U_Value_Read.con": {
    IMI1: { value: 0x55, destination: DefaultDestination.USR },
    EMI1: { value: 0x45, destination: DefaultDestination.USR },
    "EMI2/IMI2": { value: 0xE4, destination: DefaultDestination.USR },
  },
  "U_Flags_Read.req": {
    IMI1: { value: 0x37, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    EMI1: { value: 0x37, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x7C, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
  },
  "U_Flags_Read.con": {
    IMI1: { value: 0x57, destination: DefaultDestination.USR },
    EMI1: { value: 0x47, destination: DefaultDestination.USR },
    "EMI2/IMI2": { value: 0xEC, destination: DefaultDestination.USR },
  },
  "U_Event.ind": {
    IMI1: { value: 0x5D, destination: DefaultDestination.USR },
    EMI1: { value: 0x4D, destination: DefaultDestination.USR },
    "EMI2/IMI2": { value: 0xE7, destination: DefaultDestination.USR },
  },
  "U_Value_Write.req": {
    IMI1: { value: 0x36, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    EMI1: { value: 0x36, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0x71, destination: DefaultDestination.Group_Oriented_Part_Of_The_AL },
  },
  "U_User_Data": {
    "EMI2/IMI2": { value: 0xD0, destination: DefaultDestination.USR },
  },
  "PC_Set_Value.req": {
    IMI1: { value: 0x46, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x46, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0xA6, destination: DefaultDestination.Management_Part_Of_The_AL },
  },
  "PC_Get_Value.req": {
    IMI1: { value: 0x4C, destination: DefaultDestination.Management_Part_Of_The_AL },
    EMI1: { value: 0x4C, destination: DefaultDestination.Management_Part_Of_The_AL },
    "EMI2/IMI2": { value: 0xAC, destination: DefaultDestination.Management_Part_Of_The_AL },
  },
  "PC_Get_Value.con": {
    IMI1: { value: 0x4B, destination: DefaultDestination.Physical_External_Interface },
    EMI1: { value: 0x4B, destination: DefaultDestination.Physical_External_Interface },
    "EMI2/IMI2": { value: 0xAB, destination: DefaultDestination.Physical_External_Interface },
  },
  "PEI_Identify.req": {
    "EMI2/IMI2": { value: 0xA7 },
  },
  "PEI_Identify.con": {
    "EMI2/IMI2": { value: 0xA8, destination: DefaultDestination.Physical_External_Interface },
  },
  "PEI_Switch.req": {
    "EMI2/IMI2": { value: 0xA9 },
  },
  "TM_Timer.ind": {
    "EMI2/IMI2": { value: 0xC1, destination: DefaultDestination.USR },
  },
  "M_PropRead.req": {
    CEMI: { value: 0xFC },
  },
  "M_PropRead.con": {
    CEMI: { value: 0xFB },
  },
  "M_PropWrite.req": {
    CEMI: { value: 0xF6 },
  },
  "M_PropWrite.con": {
    CEMI: { value: 0xF5 },
  },
  "M_PropInfo.ind": {
    CEMI: { value: 0xF7 },
  },
  "M_FuncPropCommand.req": {
    CEMI: { value: 0xF8 },
  },
  "M_FuncPropStateRead.req": {
    CEMI: { value: 0xF9 },
  },
  "M_FuncPropCommand.con": {
    CEMI: { value: 0xFA },
  },
  "M_FuncPropStateRead.con": {
    CEMI: { value: 0xFA },
  },
  "M_Reset.req": {
    CEMI: { value: 0xF1 },
  },
  "M_Reset.ind": {
    CEMI: { value: 0xF0 },
  },
} as const;