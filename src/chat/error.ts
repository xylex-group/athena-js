export class AthenaChatError extends Error {
  code?: string;
  errorNumber?: number;
  status: number;
  endpoint: string;
  method: string;
  requestId?: string;
  body: unknown;

  constructor(input: {
    message: string;
    status: number;
    endpoint: string;
    method: string;
    requestId?: string;
    body: unknown;
  }) {
    super(input.message);
    this.name = "AthenaChatError";
    this.status = input.status;
    this.endpoint = input.endpoint;
    this.method = input.method;
    this.requestId = input.requestId;
    this.body = input.body;
    if (isRecord(input.body)) {
      if (typeof input.body.code === "string") {
        this.code = input.body.code;
      }
      const errorNumber = input.body.error_number ?? input.body.errorNumber;
      if (typeof errorNumber === "number" && Number.isFinite(errorNumber)) {
        this.errorNumber = errorNumber;
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
