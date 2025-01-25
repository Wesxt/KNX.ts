export class ConnectionErrorException extends Error {
  constructor(msg: string) {
    super(msg)
  }
}