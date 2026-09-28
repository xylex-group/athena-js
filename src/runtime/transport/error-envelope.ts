export type AthenaTransportErrorEnvelope = {
  readonly code: string;
  readonly details?: unknown;
  readonly errorNumber?: number;
  readonly message: string;
  readonly requestId?: string;
  readonly retryable?: boolean;
  readonly status: number;
};

export type AthenaTransportResult<T> =
  | {
      readonly data: T;
      /** Wire used the `{ ok, data? }` dialect. Unenveloped JSON is `false`. */
      readonly enveloped?: boolean;
      readonly ok: true;
    }
  | { readonly error: AthenaTransportErrorEnvelope; readonly ok: false };

export class AthenaTransportError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly errorNumber?: number;
  readonly requestId?: string;
  readonly retryable?: boolean;
  readonly status: number;

  constructor(input: AthenaTransportErrorEnvelope) {
    super(input.message);
    this.name = "AthenaTransportError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.errorNumber = input.errorNumber;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
  }
}
