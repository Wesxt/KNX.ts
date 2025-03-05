export interface KNXTelegramParsed {
  origin: string;
  destination: string;
  rawTelegram: string;
  valueOfTheFirstByteInTheApdu: string;
  hops: string;
  event: string;
}