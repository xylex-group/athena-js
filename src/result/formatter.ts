import {
  normalizeAthenaError,
  type NormalizedAthenaError,
} from "../auxiliaries.ts";
import type { AthenaGatewayResponse } from "../gateway/types.ts";
import type {
  AthenaResult,
  AthenaResultError,
  AthenaResultFormatter,
} from "./types.ts";

const ATHENA_NORMALIZED_ERROR_KEY = "__athenaNormalizedError" as const;

function formatResult<T>(response: AthenaGatewayResponse<T>): AthenaResult<T> {
  const result: AthenaResult<T> = {
    data: response.data ?? null,
    error: null,
    errorDetails: response.errorDetails ?? null,
    raw: response.raw,
    status: response.status,
    statusText: response.statusText ?? null,
  };
  if (response.count !== undefined) {
    result.count = response.count;
  }
  if (response.affectedRows !== undefined) {
    result.affectedRows = response.affectedRows;
  }
  return result;
}

function attachNormalizedError<T>(
  result: AthenaResult<T>,
  normalizedError: NormalizedAthenaError
): void {
  Object.defineProperty(result, ATHENA_NORMALIZED_ERROR_KEY, {
    configurable: true,
    enumerable: false,
    value: normalizedError,
    writable: false,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
}

function resolveStructuredErrorPayload(
  raw: unknown
): Record<string, unknown> | null {
  if (!isRecord(raw)) {
    return null;
  }
  return isRecord(raw.error) ? raw.error : raw;
}

function resolveStructuredErrorDetails(
  payload: Record<string, unknown> | null,
  message: string
): unknown | null {
  if (!(payload && "details" in payload)) {
    return null;
  }
  const details = payload.details;
  if (details === null) {
    return null;
  }
  if (typeof details === "string" && details.trim() === message.trim()) {
    return null;
  }
  return details;
}

function createResultError<T>(
  response: AthenaGatewayResponse<T>,
  result: AthenaResult<T>,
  normalized: NormalizedAthenaError
): AthenaResultError {
  const rawRecord = isRecord(response.raw) ? response.raw : null;
  const payload = resolveStructuredErrorPayload(response.raw);
  const message =
    firstNonEmptyString(
      response.error,
      payload?.message,
      payload?.error,
      payload?.details,
      response.errorDetails?.message,
      normalized.message
    ) ?? normalized.message;
  const statusText =
    firstNonEmptyString(response.statusText, rawRecord?.statusText) ?? null;
  const hint =
    firstNonEmptyString(payload?.hint, response.errorDetails?.hint) ?? null;
  const code = firstNonEmptyString(payload?.code) ?? normalized.code;
  const details =
    resolveStructuredErrorDetails(payload, message) ??
    response.errorDetails?.cause ??
    null;

  return {
    athenaCode: normalized.code,
    category: normalized.category,
    cause: response.errorDetails?.cause,
    code,
    constraint: normalized.constraint,
    details,
    endpoint: response.errorDetails?.endpoint,
    gatewayCode: response.errorDetails?.code ?? null,
    hint,
    kind: normalized.kind,
    message,
    method: response.errorDetails?.method,
    operation: normalized.operation,
    raw: result.raw,
    requestId: response.errorDetails?.requestId,
    retryable: normalized.retryable,
    status: result.status,
    statusText,
    table: normalized.table,
  };
}

export function createResultFormatter(): AthenaResultFormatter {
  return <T>(
    response: AthenaGatewayResponse<T>,
    context?: Parameters<AthenaResultFormatter>[1]
  ): AthenaResult<T> => {
    const result = formatResult(response);
    if (response.error == null && response.errorDetails == null) {
      return result;
    }
    const normalizedError = normalizeAthenaError(
      {
        ...result,
        error: response.error ?? response.errorDetails?.message ?? null,
      },
      context
    );
    result.error = createResultError(response, result, normalizedError);
    attachNormalizedError(result, normalizedError);
    return result;
  };
}
