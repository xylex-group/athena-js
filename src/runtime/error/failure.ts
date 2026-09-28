/**
 * Transport/provider/runtime input to Error Classification.
 *
 * Failure IR deliberately contains occurrence facts only. It cannot carry
 * canonical error numbers, retry policy, or domain meaning.
 */
export interface AthenaFailureBase {
  readonly cause?: unknown;
  readonly code?: string;
  readonly details?: unknown;
  readonly message?: string;
  readonly status?: number;
}

export interface AthenaHttpFailureIR extends AthenaFailureBase {
  readonly source: "http";
}

export interface AthenaProviderFailureIR extends AthenaFailureBase {
  readonly provider?: string;
  readonly providerCode?: string;
  readonly source: "provider";
}

export interface AthenaRuntimeFailureIR extends AthenaFailureBase {
  readonly reason?: string;
  readonly source: "runtime";
}

export type AthenaFailureIR =
  | AthenaHttpFailureIR
  | AthenaProviderFailureIR
  | AthenaRuntimeFailureIR;

export function failureFromUnknown(
  source: AthenaFailureIR["source"],
  error: unknown,
  input: Omit<Partial<AthenaFailureIR>, "source"> = {}
): AthenaFailureIR {
  const fromOccurrence = occurrenceFields(error);
  return {
    ...fromOccurrence,
    ...input,
    cause: input.cause ?? error,
    message: input.message ?? messageFromUnknown(error),
    source,
  } as AthenaFailureIR;
}

function occurrenceFields(
  error: unknown
): Omit<Partial<AthenaFailureIR>, "source"> {
  if (!error || typeof error !== "object") {
    return {};
  }
  const record = error as {
    code?: unknown;
    details?: unknown;
    status?: unknown;
  };
  return {
    ...(typeof record.code === "string" && record.code.length > 0
      ? { code: record.code }
      : {}),
    ...(record.details === undefined ? {} : { details: record.details }),
    ...(typeof record.status === "number" ? { status: record.status } : {}),
  };
}

export function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function failureRecord(
  failure: AthenaFailureIR
): Record<string, unknown> {
  return failure as unknown as Record<string, unknown>;
}
