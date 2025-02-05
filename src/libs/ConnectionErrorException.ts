export class ConnectionErrorException extends Error {
  constructor(msg: string, cause?: any) {
    super(msg);
  }
}
