require "./address"

class KNX
  # APCI type
  enum ActionType
    GroupRead  =    0
    GroupResp  = 0x40
    GroupWrite = 0x80

    IndividualWrite = 0x0C0
    IndividualRead  = 0x100
    IndividualResp  = 0x140

    AdcRead = 0x180
    AdcResp = 0x1C0

    SysNetParamRead  = 0x1C4
    SysNetParamResp  = 0x1C9
    SysNetParamWrite = 0x1CA

    MemoryRead  = 0x200
    MemoryResp  = 0x240
    MemoryWrite = 0x280

    UserMemoryRead  = 0x2C0
    UserMemoryResp  = 0x2C1
    UserMemoryWrite = 0x2C2

    UserManufacturerInfoRead = 0x2C5
    UserManufacturerInfoResp = 0x2C6

    FunctionPropertyCommand   = 0x2C7
    FunctionPropertyStateRead = 0x2C8
    FunctionPropertyStateResp = 0x2C9

    DeviceDescriptorRead = 0x300
    DeviceDescriptorResp = 0x340

    Restart = 0x380
    Escape  = 0x3C0 # Not sure about this one

    AuthorizeRequest = 0x3D1
    AuthorizeResp    = 0x3D2

    KeyWrite = 0x3D3
    KeyResp  = 0x3D4

    PropertyValueRead  = 0x3D5
    PropertyValueResp  = 0x3D6
    PropertyValueWrite = 0x3D7

    PropertyDescriptionRead = 0x3D8
    PropertyDescriptionResp = 0x3D9

    NetworkParamRead = 0x3DA
    NetworkParamResp = 0x3DB

    IndividualSerialNumRead  = 0x3DC
    IndividualSerialNumResp  = 0x3DD
    IndividualSerialNumWrite = 0x3DF

    DomainWrite         = 0x3E0
    DomainRead          = 0x3E1
    DomainResp          = 0x3E2
    DomainSelectiveRead = 0x3E3

    NetworkParamWrite = 0x3E4

    LinkRead  = 0x3E5
    LinkResp  = 0x3E6
    LinkWrite = 0x3E7

    GroupPropValueRead  = 0x3E8
    GroupPropValueResp  = 0x3E9
    GroupPropValueWrite = 0x3EA
    GroupPropValueInfo  = 0x3EB

    DomainSerialNumRead  = 0x3EC
    DomainSerialNumResp  = 0x3ED
    DomainSerialNumWrite = 0x3EE

    FilesystemInfo = 0x3F0
  end

  enum TpciType
    UnnumberedData    = 0b00
    NumberedData      = 0b01
    UnnumberedControl = 0b10
    NumberedControl   = 0b11
  end

  enum MsgCode : UInt8
    RawRequest              = 0x10
    DataRequest             = 0x11
    PollDataRequest         = 0x13
    PollDataConnection      = 0x25
    DataIndicator           = 0x29
    BusmonIndicator         = 0x2B
    RawIndicator            = 0x2D
    DataConnection          = 0x2E
    RawConnection           = 0x2F
    DataConnectionRequest   = 0x41
    DataIndividualRequest   = 0x4A
    DataConnectionIndicator = 0x89
    DataIndividualIndicator = 0x94
    ResetIndicator          = 0xF0
    ResetRequest            = 0xF1
    PropwriteConnection     = 0xF5
    PropwriteRequest        = 0xF6
    PropinfoIndicator       = 0xF7
    FuncPropComRequest      = 0xF8
    FuncPropStatReadRequest = 0xF9
    FuncPropComConnection   = 0xFA
    PropReadConnection      = 0xFB
    PropReadRequest         = 0xFC
  end

  enum Priority
    SYSTEM = 0
    ALARM
    HIGH
    LOW
  end

  ERROR_CODES = {
    0x00 => "Unspecified Error",
    0x01 => "Out of range",
    0x02 => "Out of maxrange",
    0x03 => "Out of minrange",
    0x04 => "Memory Error",
    0x05 => "Read only",
    0x06 => "Illegal command",
    0x07 => "Void DP",
    0x08 => "Type conflict",
    0x09 => "Prop. Index range error",
    0x0A => "Value temporarily not writeable",
  }

  # CEMI == Common External Message Interface
  # +--------+--------+--------+--------+----------------+----------------+--------+----------------+
  # |  Msg   |Add.Info| Ctrl 1 | Ctrl 2 | Source Address | Dest. Address  |  Data  |      APDU      |
  # | Code   | Length |        |        |                |                | Length |                |
  # +--------+--------+--------+--------+----------------+----------------+--------+----------------+
  #   1 byte   1 byte   1 byte   1 byte      2 bytes          2 bytes       1 byte      2 bytes
  #
  #  Message Code    = 0x11 - a L_Data.req primitive
  #      COMMON EMI MESSAGE CODES FOR DATA LINK LAYER PRIMITIVES
  #          FROM NETWORK LAYER TO DATA LINK LAYER
  #          +---------------------------+--------------+-------------------------+---------------------+------------------+
  #          | Data Link Layer Primitive | Message Code | Data Link Layer Service | Service Description | Common EMI Frame |
  #          +---------------------------+--------------+-------------------------+---------------------+------------------+
  #          |        L_Raw.req          |    0x10      |                         |                     |                  |
  #          +---------------------------+--------------+-------------------------+---------------------+------------------+
  #          |                           |              |                         | Primitive used for  | Sample Common    |
  #          |        L_Data.req         |    0x11      |      Data Service       | transmitting a data | EMI frame        |
  #          |                           |              |                         | frame               |                  |
  #          +---------------------------+--------------+-------------------------+---------------------+------------------+
  #          |        L_Poll_Data.req    |    0x13      |    Poll Data Service    |                     |                  |
  #          +---------------------------+--------------+-------------------------+---------------------+------------------+
  #          |        L_Raw.req          |    0x10      |                         |                     |                  |
  #          +---------------------------+--------------+-------------------------+---------------------+------------------+
  #          FROM DATA LINK LAYER TO NETWORK LAYER
  #          +---------------------------+--------------+-------------------------+---------------------+
  #          | Data Link Layer Primitive | Message Code | Data Link Layer Service | Service Description |
  #          +---------------------------+--------------+-------------------------+---------------------+
  #          |        L_Poll_Data.con    |    0x25      |    Poll Data Service    |                     |
  #          +---------------------------+--------------+-------------------------+---------------------+
  #          |                           |              |                         | Primitive used for  |
  #          |        L_Data.ind         |    0x29      |      Data Service       | receiving a data    |
  #          |                           |              |                         | frame               |
  #          +---------------------------+--------------+-------------------------+---------------------+
  #          |        L_Busmon.ind       |    0x2B      |   Bus Monitor Service   |                     |
  #          +---------------------------+--------------+-------------------------+---------------------+
  #          |        L_Raw.ind          |    0x2D      |                         |                     |
  #          +---------------------------+--------------+-------------------------+---------------------+
  #          |                           |              |                         | Primitive used for  |
  #          |                           |              |                         | local confirmation  |
  #          |        L_Data.con         |    0x2E      |      Data Service       | that a frame was    |
  #          |                           |              |                         | sent (does not mean |
  #          |                           |              |                         | successful receive) |
  #          +---------------------------+--------------+-------------------------+---------------------+
  #          |        L_Raw.con          |    0x2F      |                         |                     |
  #          +---------------------------+--------------+-------------------------+---------------------+

  #  Add.Info Length = 0x00 - no additional info
  #  Control Field 1 = see the bit structure above
  #  Control Field 2 = see the bit structure above
  #  Source Address  = 0x0000 - filled in by router/gateway with its source address which is
  #                    part of the KNX subnet
  #  Dest. Address   = KNX group or individual address (2 byte)
  #  Data Length     = Number of bytes of data in the APDU excluding the TPCI/APCI bits
  #  APDU            = Application Protocol Data Unit - the actual payload including transport
  #                    protocol control information (TPCI), application protocol control
  #                    information (APCI) and data passed as an argument from higher layers of
  #                    the KNX communication stack
  #
  class CEMI < BinData
    endian :big

    field msg_code : MsgCode = MsgCode::RawRequest
    field info_length : UInt8, value: ->{ additional_info.size }
    field additional_info : Bytes, length: ->{ info_length }

    # ---------------------
    #    Control Fields
    # ---------------------

    # Bit order
    # +---+---+---+---+---+---+---+---+
    # | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
    # +---+---+---+---+---+---+---+---+

    #  Control Field 1

    #   Bit  |
    #  ------+---------------------------------------------------------------
    #    7   | Frame Type  - 0x0 for extended frame
    #        |               0x1 for standard frame
    #  ------+---------------------------------------------------------------
    #    6   | Reserved
    #        |
    #  ------+---------------------------------------------------------------
    #    5   | Repeat Flag - 0x0 repeat frame on medium in case of an error
    #        |               0x1 do not repeat
    #  ------+---------------------------------------------------------------
    #    4   | System Broadcast - 0x0 system broadcast
    #        |                    0x1 broadcast
    #  ------+---------------------------------------------------------------
    #    3   | Priority    - 0x0 system
    #        |               0x1 normal (also called alarm priority)
    #  ------+               0x2 urgent (also called high priority)
    #    2   |               0x3 low
    #        |
    #  ------+---------------------------------------------------------------
    #    1   | Acknowledge Request - 0x0 no ACK requested
    #        | (L_Data.req)          0x1 ACK requested
    #  ------+---------------------------------------------------------------
    #    0   | Confirm      - 0x0 no error
    #        | (L_Data.con) - 0x1 error
    #  ------+---------------------------------------------------------------
    bit_field do
      bool is_standard_frame
      bits 1, :_reserved_ # default: 0_u8
      bool no_repeat
      bool broadcast
      bits 2, priority : Priority = Priority::LOW
      bool no_ack_wanted
      bool no_error_confirmation

      #  Control Field 2

      #   Bit  |
      #  ------+---------------------------------------------------------------
      #    7   | Destination Address Type - 0x0 individual address
      #        |                          - 0x1 group address
      #  ------+---------------------------------------------------------------
      #   6-4  | Hop Count (0-7)
      #  ------+---------------------------------------------------------------
      #   3-0  | Extended Frame Format - 0x0 standard frame
      #  ------+---------------------------------------------------------------
      bool is_group_address
      bits 3, :hop_count
      bits 4, :extended_frame_format
    end

    # When sending, setting the source address to 0 allows the router to configure
    field source_address : IndividualAddress = IndividualAddress.new
    field destination_raw : Bytes, length: ->{ 2 }

    property two_level_group : Bool = false
    property destination_address : Address do
      if !is_group_address
        IndividualAddress.parse(destination_raw)
      elsif two_level_group
        GroupAddress2Level.parse(destination_raw)
      else
        GroupAddress.parse(destination_raw)
      end
    end

    field data_length : UInt8, value: ->{ data_ext.size + 1 }

    # In the Common EMI frame, the APDU payload is defined as follows:

    # +--------+--------+--------+--------+--------+
    # | TPCI + | APCI + |  Data  |  Data  |  Data  |
    # |  APCI  |  Data  |        |        |        |
    # +--------+--------+--------+--------+--------+
    #   byte 1   byte 2  byte 3     ...     byte 16

    # For data that is 6 bits or less in length, only the first two bytes are used in a Common EMI
    # frame. Common EMI frame also carries the information of the expected length of the Protocol
    # Data Unit (PDU). Data payload can be at most 14 bytes long.  <p>

    # The first byte is a combination of transport layer control information (TPCI) and application
    # layer control information (APCI). First 6 bits are dedicated for TPCI while the two least
    # significant bits of first byte hold the two most significant bits of APCI field, as follows:

    #   Bit 1    Bit 2    Bit 3    Bit 4    Bit 5    Bit 6    Bit 7    Bit 8      Bit 1   Bit 2
    # +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
    # |        |        |        |        |        |        |        |        ||        |
    # |  TPCI  |  TPCI  |  TPCI  |  TPCI  |  TPCI  |  TPCI  | APCI   |  APCI  ||  APCI  |
    # |        |        |        |        |        |        |(bit 1) |(bit 2) ||(bit 3) |
    # +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
    # +                            B  Y  T  E    1                            ||       B Y T E  2
    # +-----------------------------------------------------------------------++-------------....

    # Total number of APCI control bits can be either 4 or 10. The second byte bit structure is as follows:

    #   Bit 1    Bit 2    Bit 3    Bit 4    Bit 5    Bit 6    Bit 7    Bit 8      Bit 1   Bit 2
    # +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
    # |        |        |        |        |        |        |        |        ||        |
    # |  APCI  |  APCI  | APCI/  |  APCI/ |  APCI/ |  APCI/ | APCI/  |  APCI/ ||  Data  |  Data
    # |(bit 3) |(bit 4) | Data   |  Data  |  Data  |  Data  | Data   |  Data  ||        |
    # +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
    # +                            B  Y  T  E    2                            ||       B Y T E  3
    # +-----------------------------------------------------------------------++-------------....
    bit_field do
      # transport protocol control information
      bits 2, tpci : TpciType = TpciType::UnnumberedData
      bits 4, :tpci_seq_num # Sequence number when tpci is sequenced
      bits 4, :apci         # application protocol control information (What we trying to do: Read, write, respond etc)
      bits 6, :data_short   # Or the tail end of APCI depending on the message type
    end

    field data_ext : Bytes, length: ->{ data_length > 1 ? data_length - 1 : 0 }

    property action_type : ActionType = ActionType::GroupRead
    property data : Bytes = Bytes.new(0)

    before_serialize do
      value = action_type.to_i
      self.apci = (value >> 6).to_u8

      self.destination_raw = destination_address.to_slice

      if value & 0x111111 > 0
        # the action bleeds into the data_short field
        self.data_short = (value & 0b111111).to_u8
      elsif data.size == 1 && data[0] <= 0b111111
        # we can store the 6 bits if we wanted
        self.data_short = data[0]
        self.data_ext = Bytes.new(0)
      else
        # we use the extended data
        self.data_short = 0_u8
        self.data_ext = data
      end
    end

    after_deserialize do
      # anything bigger than an Individual Resp (0b0101) does not use data_short
      # any anything using extended data also is not using it
      if data_ext.size > 0 || apci > 0b0101_u8
        # simple to determine the packet type where data ext is used
        self.data = data_ext
        self.action_type = ActionType.from_value((apci.to_i << 6) | data_short.to_i)
      else
        self.data = Bytes[data_short]
        self.action_type = ActionType.from_value(apci.to_i << 6)
      end
    end
  end
end