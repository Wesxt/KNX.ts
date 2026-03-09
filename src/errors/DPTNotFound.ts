export class InvalidParametersForDpt extends TypeError {
  constructor() {
    super("The object does not contain valid parameters to encode the dpt");
  }
}
export class DPTNotFound extends Error {
  constructor() {
    super("This DPT is not available for encoding or decoding, or it does not exist.");
  }
}
