export const ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED =
  "ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED" as const;
export const ATHENA_EMAIL_MESSAGE_INVALID = "ATHENA_EMAIL_MESSAGE_INVALID" as const;
export const ATHENA_EMAIL_DELIVERY_FAILED = "ATHENA_EMAIL_DELIVERY_FAILED" as const;
export const ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME =
  "ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME" as const;
export const ATHENA_EMAIL_PROVIDER_INVALID = "ATHENA_EMAIL_PROVIDER_INVALID" as const;

export type AthenaEmailErrorCode =
  | typeof ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED
  | typeof ATHENA_EMAIL_MESSAGE_INVALID
  | typeof ATHENA_EMAIL_DELIVERY_FAILED
  | typeof ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME
  | typeof ATHENA_EMAIL_PROVIDER_INVALID;

export class AthenaEmailError extends Error {
  readonly code: AthenaEmailErrorCode;

  constructor(
    code: AthenaEmailErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AthenaEmailError";
    this.code = code;
  }
}

export function isAthenaEmailError(value: unknown): value is AthenaEmailError {
  return value instanceof AthenaEmailError;
}
