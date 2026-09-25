export interface ValidationErrorDetail {
  dpt?: string | number;
  property?: string;
  expected?: string;
  received?: any;
  reason?: string;
}

export class InvalidParametersForDpt extends TypeError {
  public readonly dpt?: string | number;
  public readonly property?: string;
  public readonly expected?: string;
  public readonly received?: any;
  public readonly reason?: string;

  constructor(detail?: ValidationErrorDetail | string) {
    if (typeof detail === "string") {
      super(detail);
    } else if (detail) {
      let msg = `Invalid parameter for DPT ${detail.dpt ?? "unknown"}`;
      if (detail.property !== undefined) {
        msg += `: property "${detail.property}" is invalid. Expected ${detail.expected ?? "valid value"}, but received ${typeof detail.received === "object" ? JSON.stringify(detail.received) : String(detail.received)} (${typeof detail.received}).`;
      } else {
        msg += `: expected ${detail.expected ?? "valid value"}, but received ${typeof detail.received === "object" ? JSON.stringify(detail.received) : String(detail.received)} (${typeof detail.received}).`;
      }
      if (detail.reason) {
        msg += ` (${detail.reason})`;
      }
      super(msg);
      this.dpt = detail.dpt;
      this.property = detail.property;
      this.expected = detail.expected;
      this.received = detail.received;
      this.reason = detail.reason;
    } else {
      super("The object does not contain valid parameters to encode the dpt");
    }
    this.name = "InvalidParametersForDpt";
  }
}
export class DPTNotFound extends Error {
  constructor() {
    super("This DPT is not available for encoding or decoding, or it does not exist.");
  }
}
