import { getKNXManufacturerName } from "./KNXManufacturers";

/**
 * Metadata describing an official KNX-USB HID interface from ETS6 `knx_interfaces.xml`.
 */
export interface KnxUsbInterfaceDescriptor {
  /** 16-bit USB Vendor ID (VID). */
  vendorId: number;
  /** 16-bit USB Product ID (PID). */
  productId: number;
  /** 16-bit KNX Association Manufacturer ID (`PID_MANUFACTURER_ID`). */
  knxManufacturerId: number;
  /** Default English / fallback display name. */
  defaultDisplayText: string;
  /** Optional localized display names indexed by BCP-47 tag (e.g. `"es-ES"`, `"de-DE"`). */
  translations?: Readonly<Record<string, string>>;
  /** Whether the interface persists its programmed Individual Address across power cycles (default: `true`). */
  persistsIndividualAddress: boolean;
  /** Legacy flag indicating the interface requires the ETS KNX-USB HID descriptor fix on Windows. */
  requiresKnxUsbFix: boolean;
  /** Optional vendor-specific timing parameters `[initWaitMs, stepWaitMs]` from ETS `Timing="..."`. */
  timing?: readonly [number, number];
}

/**
 * ETS6 `knx_interfaces.xml` catalog version.
 */
export const KNX_USB_INTERFACES_VERSION = 68;

/**
 * USB Vendor IDs dedicated exclusively to KNX hardware (safe for fallback auto-discovery when a brand-new
 * PID is not yet in `KNX_USB_INTERFACES`). Generic shared VIDs (such as `0x0403` FTDI, `0x04CC` NXP,
 * `0x0681`/`0x0908` Siemens, `0x16D0` MCS, `0x16DE` Schneider, `0x24D5` SATEL) are intentionally
 * excluded here and matched strictly by exact `(vendorId, productId)` pair to prevent false positives.
 */
export const KNX_USB_DEDICATED_VENDOR_IDS: readonly number[] = [
  0x0e77, // Weinzierl Engineering (and OEM KNX-USB modules)
  0x10a6, // MDT legacy KNX-USB
  0x135e, // Insta GmbH (Berker, Gira, Jung, Hager, Merten, Feller, etc.)
  0x145c, // ABB / Busch-Jaeger KNX-USB
  0x147b, // ABB Stotz-Kontakt KNX-USB
  0x28c2, // TAPKO Technologies (Zennio, Ekinex, HDL, ESYLUX, Interra, MEAN WELL, etc.)
  0x2a07, // KNX RF / TP USB-Sticks
  0x2d72, // PEAKnx KNX-USB
];

/**
 * Official KNX-USB HID interfaces catalog generated from ETS6 `knx_interfaces.xml` (Version 68, 78 interfaces).
 */
export const KNX_USB_INTERFACES: readonly KnxUsbInterfaceDescriptor[] = [
  {
    vendorId: 0x0403,
    productId: 0x6898,
    knxManufacturerId: 0x00ab,
    defaultDisplayText: "KNX-USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
  },
  {
    vendorId: 0x04cc,
    productId: 0x0301,
    knxManufacturerId: 0x00df,
    defaultDisplayText: "EIBWeiche USB",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "EIBWeiche USB" },
  },
  {
    vendorId: 0x0681,
    productId: 0x0014,
    knxManufacturerId: 0x00fd,
    defaultDisplayText: "Siemens Interface OCI700 USB",
    persistsIndividualAddress: false,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "Siemens Schnittstelle OCI700 USB" },
  },
  {
    vendorId: 0x0908,
    productId: 0x02dc,
    knxManufacturerId: 0x00fd,
    defaultDisplayText: "Siemens Interface OCI702 USB",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "Siemens Schnittstelle OCI702 USB" },
  },
  {
    vendorId: 0x0908,
    productId: 0x02dd,
    knxManufacturerId: 0x0001,
    defaultDisplayText: "Siemens Interface N 148/12 USB",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "Siemens Schnittstelle N 148/12 USB" },
  },
  {
    vendorId: 0x0908,
    productId: 0x02e6,
    knxManufacturerId: 0x014f,
    defaultDisplayText: "Interface USB KXIK00RU--",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "Schnittstelle USB KXIK00RU--" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x0102,
    knxManufacturerId: 0x00c5,
    defaultDisplayText: "KNX-USB Interface (Flush mounted)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Interface (UP)" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x0103,
    knxManufacturerId: 0x00c5,
    defaultDisplayText: "KNX-USB Interface (RS232)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Interface (RS232)" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x0104,
    knxManufacturerId: 0x00c5,
    defaultDisplayText: "KNX-USB Interface (TP)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: {
      "en-US": "KNX-USB Interface (TP)",
      "de-DE": "KNX-USB Interface (TP)",
      "es-ES": "KNX-USB Interfaz (TP)",
      "it-IT": "KNX/USB Interfaccia (TP)",
    },
  },
  {
    vendorId: 0x0e77,
    productId: 0x0111,
    knxManufacturerId: 0x0001,
    defaultDisplayText: "KNX/EIB-USB Interface (Flush mounted)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    timing: [1000, 100],
    translations: { "de-DE": "KNX/EIB-USB Schnittstelle UP" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x0112,
    knxManufacturerId: 0x0001,
    defaultDisplayText: "KNX/EIB-USB Interface (DIN rail)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX/EIB-USB Schnittstelle N" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x0121,
    knxManufacturerId: 0x00cd,
    defaultDisplayText: "KNX-USB Interface (Rail mounted)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Interface (Reiheneinbau)" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x0141,
    knxManufacturerId: 0x00f9,
    defaultDisplayText: "KNX-USB Interface (Flush mounted)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Interface (UP)" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x2001,
    knxManufacturerId: 0x00c5,
    defaultDisplayText: "KNX-USB Interface (RF)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "KNX-USB Interface (RF)" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x6910,
    knxManufacturerId: 0x0007,
    defaultDisplayText: "Mxx 6910-0016",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "Mxx 6910-0016" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0020,
    knxManufacturerId: 0x000a,
    defaultDisplayText: "KNX-USB Data Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Datenschnittstelle" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0320,
    knxManufacturerId: 0x000a,
    defaultDisplayText: "USB data interface, RMD",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "USB-Datenschnittstelle REG", "en-US": "USB data interface, RMD" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0021,
    knxManufacturerId: 0x0006,
    defaultDisplayText: "KNX-USB Data Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Datenschnittstelle" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0022,
    knxManufacturerId: 0x0008,
    defaultDisplayText: "KNX-USB Data Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Datenschnittstelle" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0023,
    knxManufacturerId: 0x0004,
    defaultDisplayText: "KNX-USB Data Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Datenschnittstelle" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0323,
    knxManufacturerId: 0x0004,
    defaultDisplayText: "USB-Datenschnittstelle",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: {
      "en-US": "USB data interface",
      "de-DE": "KNX-USB Datenschnittstelle",
      "nl-NL": "USB-data-aansluiting",
      "fr-FR": "Interface USB",
      "nb-NO": "USB-datagrensesnitt",
      "es-ES": "Módulo comunicación USB",
      "it-IT": "Interfaccia USB",
      "ru-RU": "USB-интерфейс",
      "pt-PT": "Módulo comunicação USB",
      "zh-CN": "USB数据接口",
    },
  },
  {
    vendorId: 0x135e,
    productId: 0x0024,
    knxManufacturerId: 0x000c,
    defaultDisplayText: "KNX-USB Data Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Datenschnittstelle" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0025,
    knxManufacturerId: 0x0009,
    defaultDisplayText: "KNX-USB Data Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Datenschnittstelle" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0026,
    knxManufacturerId: 0x001e,
    defaultDisplayText: "KNX-USB Data Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Datenschnittstelle" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0027,
    knxManufacturerId: 0x008b,
    defaultDisplayText: "KNX-USB Data Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Datenschnittstelle" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0122,
    knxManufacturerId: 0x0008,
    defaultDisplayText: "KNX RF USB data interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "KNX RF USB Datenschnittstelle", "en-US": "KNX RF USB data interface" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0123,
    knxManufacturerId: 0x0004,
    defaultDisplayText: "KNX Radio USB stick",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "KNX Funk-USB Stick", "en-US": "KNX Radio USB stick" },
  },
  {
    vendorId: 0x145c,
    productId: 0x1330,
    knxManufacturerId: 0x0007,
    defaultDisplayText: "KNX-USB Interface (Flush mounted)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    timing: [1000, 100],
    translations: { "de-DE": "KNX-USB Interface (UP)" },
  },
  {
    vendorId: 0x145c,
    productId: 0x1490,
    knxManufacturerId: 0x0007,
    defaultDisplayText: "KNX-USB Interface (surface mounted)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: { "de-DE": "KNX-USB Interface (AP)" },
  },
  {
    vendorId: 0x147b,
    productId: 0x5120,
    knxManufacturerId: 0x0002,
    defaultDisplayText: "USB Interface (MDRC)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: true,
    translations: {
      "de-DE": "USB Schnittstelle (REG)",
      "fr-FR": "USB Interface (MRD)",
      "nl-NL": "USB Interface (DIN-rail)",
      "it-IT": "USB Interfaccia (MDRC)",
      "pl-PL": "USB Złącze (MDRC)",
      "ru-RU": "USB интерфейс (MDRC)",
      "es-ES": "USB Interfaz (MDRC)",
    },
  },
  {
    vendorId: 0x147b,
    productId: 0x2200,
    knxManufacturerId: 0x0002,
    defaultDisplayText: "Control4 USB Interface (MDRC)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: {
      "de-DE": "Control4 USB-Schnittstelle (REG)",
      "fr-FR": "Control4 Interface USB (MRD)",
      "nl-NL": "Control4 USB interface (DIN-rail)",
      "it-IT": "Control4 Interfaccia USB (MDRC)",
      "pl-PL": "Control4 Interfejs USB (MDRC)",
      "ru-RU": "Control4 USB интерфейс (MDRC)",
      "es-ES": "Control4 Interfaz USB (MDRC)",
    },
  },
  {
    vendorId: 0x16d0,
    productId: 0x0490,
    knxManufacturerId: 0x0072,
    defaultDisplayText: "Tapko USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "Tapko USB Interface" },
  },
  {
    vendorId: 0x16d0,
    productId: 0x0491,
    knxManufacturerId: 0x0083,
    defaultDisplayText: "MDT KNX_USB_Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "MDT KNX_USB_Interface" },
  },
  {
    vendorId: 0x16d0,
    productId: 0x0492,
    knxManufacturerId: 0x0092,
    defaultDisplayText: "preussen automation USB2KNX",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "preussen automation USB2KNX" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0002,
    knxManufacturerId: 0x0071,
    defaultDisplayText: "Zennio KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: {
      "en-US": "Zennio KNX USB Interface",
      "es-ES": "Zennio KNX USB Interface",
      "de-DE": "Zennio KNX USB Interface",
      "fr-FR": "Zennio KNX USB Interface",
    },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0003,
    knxManufacturerId: 0x00b6,
    defaultDisplayText: "Ekinex KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "it-IT": "Ekinex Interfaccia USB" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0004,
    knxManufacturerId: 0x0072,
    defaultDisplayText: "KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
  },
  {
    vendorId: 0x28c2,
    productId: 0x0005,
    knxManufacturerId: 0x00b3,
    defaultDisplayText: "Philips KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
  },
  {
    vendorId: 0x28c2,
    productId: 0x0006,
    knxManufacturerId: 0x0073,
    defaultDisplayText: "HDL USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
  },
  {
    vendorId: 0x28c2,
    productId: 0x0007,
    knxManufacturerId: 0x0079,
    defaultDisplayText: "Zueblin USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
  },
  {
    vendorId: 0x28c2,
    productId: 0x0008,
    knxManufacturerId: 0x0072,
    defaultDisplayText: "Tapko RF USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "Tapko RF USB Interface" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x000b,
    knxManufacturerId: 0x00fb,
    defaultDisplayText: "KNX/USB Interface VIVO",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "KNX/USB Interface VIVO" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x000c,
    knxManufacturerId: 0x0080,
    defaultDisplayText: "ESYLUX KNX-USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: {
      "de-DE": "ESYLUX KNX-USB Schnittstelle",
      "en-US": "ESYLUX KNX-USB Interface",
      "nl-NL": "ESYLUX KNX-USB Interface",
      "it-IT": "ESYLUX KNX-USB Interfaccia",
      "ru-RU": "ESYLUX KNX-USB интерфейс",
      "es-ES": "ESYLUX KNX-USB Interfaz",
      "se-SE": "ESYLUX KNX-USB Interface",
    },
  },
  {
    vendorId: 0x28c2,
    productId: 0x000d,
    knxManufacturerId: 0x00fb,
    defaultDisplayText: "VIVO Deneb USB RF S-Mode",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "VIVO Deneb USB RF S-Mode" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x000e,
    knxManufacturerId: 0x00a2,
    defaultDisplayText: "Apricum UIM RF",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "Apricum UIM RF" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x000f,
    knxManufacturerId: 0x00a2,
    defaultDisplayText: "Apricum UIM KNX 42",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "Apricum UIM KNX 42" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0012,
    knxManufacturerId: 0x00ee,
    defaultDisplayText: "gUSB USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "gUSB USB Interface" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0015,
    knxManufacturerId: 0x009e,
    defaultDisplayText: "BES KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "BES KNX USB Interface" },
  },
  {
    vendorId: 0x2a07,
    productId: 0x0001,
    knxManufacturerId: 0x007c,
    defaultDisplayText: "KNX RF USB-Stick",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "KNX RF USB-Stick" },
  },
  {
    vendorId: 0x2a07,
    productId: 0x0002,
    knxManufacturerId: 0x00c9,
    defaultDisplayText: "KNX RF USB-Stick",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "KNX RF USB-Stick" },
  },
  {
    vendorId: 0x7660,
    productId: 0x0002,
    knxManufacturerId: 0x00fa,
    defaultDisplayText: "KNX RF - USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
  },
  {
    vendorId: 0x28c2,
    productId: 0x0011,
    knxManufacturerId: 0x00ee,
    defaultDisplayText: "IFUSB USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "IFUSB USB Interface" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0010,
    knxManufacturerId: 0x0085,
    defaultDisplayText: "KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "KNX USB Interface", "de-DE": "KNX USB Schnittstelle" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0013,
    knxManufacturerId: 0x0162,
    defaultDisplayText: "MEAN WELL KNX_USB_Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "MEAN WELL KNX_USB_Interface" },
  },
  {
    vendorId: 0x0111,
    productId: 0x1022,
    knxManufacturerId: 0x0111,
    defaultDisplayText: "KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "KNX USB Interface" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0014,
    knxManufacturerId: 0x01be,
    defaultDisplayText: "Ergo3 KNX/USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "Ergo3 KNX/USB Interface" },
  },
  {
    vendorId: 0x24d5,
    productId: 0x0106,
    knxManufacturerId: 0x0144,
    defaultDisplayText: "SATEL KNX-USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "SATEL KNX-USB Interface" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0028,
    knxManufacturerId: 0x001f,
    defaultDisplayText: "LMS USB Data Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "LMS USB Datenschnittstelle", "en-US": "LMS USB Data Interface" },
  },
  {
    vendorId: 0x2d72,
    productId: 0x0002,
    knxManufacturerId: 0x018f,
    defaultDisplayText: "PEAKnx USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "PEAKnx USB Interface" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x0115,
    knxManufacturerId: 0x0087,
    defaultDisplayText: "KNX-USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "KNX-USB Interface", "de-DE": "KNX-USB Interface" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0017,
    knxManufacturerId: 0x0107,
    defaultDisplayText: "Interra KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: {
      "en-US": "Interra KNX USB Interface",
      "de-DE": "Interra Schnittstelle KNX/USB",
      "es-ES": "Interra Interfaz KNX/USB",
      "it-IT": "Interra Interfaccia KNX/USB",
      "tr-TR": "Interra KNX/USB Arabirimi",
    },
  },
  {
    vendorId: 0x28c2,
    productId: 0x001a,
    knxManufacturerId: 0x002c,
    defaultDisplayText: "01540.1 USB-Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "01540.1 USB-Interface" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0326,
    knxManufacturerId: 0x001e,
    defaultDisplayText: "USB-Datenschnittstelle KNX-S",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: {
      "de-DE": "USB-Datenschnittstelle KNX-S",
      "fr-FR": "Interface de données USB KNX-S",
      "it-IT": "Interfaccia dati USB KNX-S",
    },
  },
  {
    vendorId: 0x135e,
    productId: 0x0322,
    knxManufacturerId: 0x0008,
    defaultDisplayText: "KNX USB data interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: {
      "en-US": "KNX USB data interface",
      "de-DE": "KNX USB Datenschnittstelle",
      "nl-NL": "KNX USB-gegevensinterface",
      "fr-FR": "KNX Interface de données USB",
      "nb-NO": "KNX USB-datagrensesnitt",
      "es-ES": "KNX Interfaz de datos USB",
      "it-IT": "KNX Interfaccia dati USB",
      "ru-RU": "KNX USB-интерфейс передачи данных",
      "zh-CN": "KNX USB 数据接口",
      "pl-PL": "KNX Złącze magistralne USB",
      "sv-SV": "KNX USB-datagränssnitt",
      "is-IS": "KNX USB-gagnatengi",
      "si-SI": "KNX USB podatkovni vmesnik",
      "el-GR": "KNX Διεπαφή δεδομένων USB",
    },
  },
  {
    vendorId: 0x135e,
    productId: 0x0329,
    knxManufacturerId: 0x00c8,
    defaultDisplayText: "USB-IF/KNX REG",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "USB-IF/KNX REG" },
  },
  {
    vendorId: 0x16de,
    productId: 0x008e,
    knxManufacturerId: 0x0064,
    defaultDisplayText: "SpaceLogic KNX USB Interface DIN Rail",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: {
      "en-US": "SpaceLogic KNX USB Interface DIN Rail",
      "de-DE": "SpaceLogic KNX USB Schnittstelle REG-K",
    },
  },
  {
    vendorId: 0x28c2,
    productId: 0x001d,
    knxManufacturerId: 0x008b,
    defaultDisplayText: "KNX USB GATEWAY",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "KNX USB GATEWAY", "de-DE": "KNX USB GATEWAY", "fr-FR": "KNX USB GATEWAY" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x001e,
    knxManufacturerId: 0x0187,
    defaultDisplayText: "Shenzhen HeGuang USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "Shenzhen HeGuang Interface" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x001f,
    knxManufacturerId: 0x01c6,
    defaultDisplayText: "USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "USB Interface", "ru-RU": "USB Интерфейс" },
  },
  {
    vendorId: 0x135e,
    productId: 0x0325,
    knxManufacturerId: 0x0009,
    defaultDisplayText: "USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: {
      "en-US": "USB Interface",
      "de-DE": "USB Datenschnittstelle",
      "nl-NL": "USB-interface",
      "fr-FR": "Interface USB",
      "nb-NO": "USB grensesnitt",
      "es-ES": "Interfaz USB",
      "it-IT": "Interfaccia USB",
      "sv-SV": "USB-gränssnitt",
      "pt-PT": "Interface USB",
    },
  },
  {
    vendorId: 0x28c2,
    productId: 0x001c,
    knxManufacturerId: 0x0163,
    defaultDisplayText: "OSiX KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "OSiX KNX USB Interface" },
  },
  {
    vendorId: 0x2a07,
    productId: 0x0003,
    knxManufacturerId: 0x007c,
    defaultDisplayText: "KNX TP USB-Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "de-DE": "KNX TP USB-Interface" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x2002,
    knxManufacturerId: 0x0008,
    defaultDisplayText: "KNX-USB Interface (RF)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "KNX-USB Interface (RF)", "de-DE": "KNX-USB Datenschnittstelle (RF)" },
  },
  {
    vendorId: 0x0e77,
    productId: 0x0117,
    knxManufacturerId: 0x027b,
    defaultDisplayText: "KNX USB Interface (TP)",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "KNX USB Interface (TP)", "de-DE": "KNX USB Schnittstelle (TP)" },
  },
  {
    vendorId: 0x135e,
    productId: 0x032a,
    knxManufacturerId: 0x00a0,
    defaultDisplayText: "USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "USB Interface", "it-IT": "Interfaccia USB" },
  },
  {
    vendorId: 0x28c2,
    productId: 0x0020,
    knxManufacturerId: 0x01b3,
    defaultDisplayText: "USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "USB Interface" },
  },
  {
    vendorId: 0x135e,
    productId: 0x032b,
    knxManufacturerId: 0x008e,
    defaultDisplayText: "USB Interface USB100 KNX",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
  },
  {
    vendorId: 0x36ce,
    productId: 0x0001,
    knxManufacturerId: 0x0085,
    defaultDisplayText: "KNX USB Interface",
    persistsIndividualAddress: true,
    requiresKnxUsbFix: false,
    translations: { "en-US": "KNX USB Interface" },
  },
];

const KNX_USB_INTERFACE_MAP = new Map<number, KnxUsbInterfaceDescriptor>();
for (const entry of KNX_USB_INTERFACES) {
  KNX_USB_INTERFACE_MAP.set(((entry.vendorId & 0xffff) << 16) | (entry.productId & 0xffff), entry);
}

const KNX_USB_DEDICATED_VID_SET = new Set<number>(KNX_USB_DEDICATED_VENDOR_IDS);

/**
 * Looks up an official KNX-USB interface descriptor by exact `(vendorId, productId)` pair.
 */
export function findKnxUsbInterface(vendorId: number, productId: number): KnxUsbInterfaceDescriptor | undefined {
  return KNX_USB_INTERFACE_MAP.get(((vendorId & 0xffff) << 16) | (productId & 0xffff));
}

/**
 * Returns the localized display name for a `KnxUsbInterfaceDescriptor` (supports exact BCP-47 tag
 * such as `"es-ES"` or language prefix such as `"es"`, falling back to `defaultDisplayText`).
 */
export function getKnxUsbInterfaceDisplayName(descriptor: KnxUsbInterfaceDescriptor, language?: string): string {
  if (language && descriptor.translations) {
    const target = language.trim().toLowerCase();
    if (target) {
      for (const [lang, text] of Object.entries(descriptor.translations)) {
        if (lang.toLowerCase() === target) return text;
      }
      const prefix = target.split("-")[0];
      for (const [lang, text] of Object.entries(descriptor.translations)) {
        if (lang.toLowerCase().split("-")[0] === prefix) return text;
      }
    }
  }
  return descriptor.defaultDisplayText;
}

/**
 * Returns the KNX Association manufacturer name associated with a `KnxUsbInterfaceDescriptor`.
 */
export function getKnxUsbInterfaceManufacturerName(descriptor: KnxUsbInterfaceDescriptor): string | undefined {
  return getKNXManufacturerName(descriptor.knxManufacturerId);
}

/**
 * Determines whether a HID device descriptor represents a KNX-USB interface.
 * Matches in priority order: (1) exact `(vendorId, productId)` in `KNX_USB_INTERFACES`,
 * (2) dedicated KNX-only USB Vendor ID, or (3) product string mentioning `"knx"` / `"eib"`.
 */
export function isKnownKnxUsbDevice(device: { vendorId?: number; productId?: number; product?: string }): boolean {
  if (device.vendorId !== undefined && device.productId !== undefined) {
    if (findKnxUsbInterface(device.vendorId, device.productId)) return true;
  }
  if (device.vendorId !== undefined && KNX_USB_DEDICATED_VID_SET.has(device.vendorId)) {
    return true;
  }
  if (device.product) {
    const lower = device.product.toLowerCase();
    if (lower.includes("knx") || lower.includes("eib")) return true;
  }
  return false;
}
