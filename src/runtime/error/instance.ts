import type { AthenaErrorIR } from "./ir.ts";

export interface AthenaErrorInstance<
  Error extends AthenaErrorIR = AthenaErrorIR,
> {
  readonly cause?: unknown;
  readonly details?: unknown;
  readonly error: Error;
  readonly message: string;
}

export function createAthenaErrorInstance<Error extends AthenaErrorIR>(
  error: Error,
  input: {
    readonly cause?: unknown;
    readonly details?: unknown;
    readonly message?: string;
  } = {}
): AthenaErrorInstance<Error> {
  return Object.freeze({
    cause: input.cause,
    details: input.details,
    error,
    message: input.message ?? error.description,
  });
}

export interface AthenaErrorResult {
  readonly error: {
    readonly code: string;
    readonly errorNumber: number;
    readonly message: string;
    readonly missing?: readonly string[];
    readonly operation?: string;
  };
  readonly ok: false;
  readonly status: number;
}

export function athenaErrorResult(
  instance: AthenaErrorInstance
): AthenaErrorResult {
  const envelope = authorizationEnvelopeFromDetails(instance.details);
  return {
    error: {
      code: instance.error.code,
      errorNumber: instance.error.errorNumber,
      message: instance.message,
      ...envelope,
    },
    ok: false,
    status: instance.error.status,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function authorizationEnvelopeFromDetails(details: unknown): {
  missing?: readonly string[];
  operation?: string;
} {
  if (!isRecord(details)) {
    return {};
  }
  const extra: {
    missing?: readonly string[];
    operation?: string;
  } = {};
  if (typeof details.operation === "string" && details.operation.length > 0) {
    extra.operation = details.operation;
  }
  if (
    Array.isArray(details.missing) &&
    details.missing.length > 0 &&
    details.missing.every((entry) => typeof entry === "string")
  ) {
    extra.missing = details.missing;
  }
  return extra;
}
