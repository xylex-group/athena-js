import type {
  AthenaOperationContext,
  NormalizedAthenaError,
  RetryConfig,
} from "./auxiliaries.ts";
import { normalizeAthenaError, withRetry } from "./auxiliaries.ts";
import type {
  AthenaGatewayErrorDetails,
  AthenaGatewayResponse,
} from "./gateway/types.ts";

const ATHENA_NORMALIZED_ERROR_KEY = "__athenaNormalizedError" as const;

const READ_RETRY_CONFIG: RetryConfig = {
  backoff: "exponential",
  baseDelayMs: 100,
  jitter: true,
  maxDelayMs: 1000,
  retries: 2,
};

export interface AthenaResult<T> {
  /**
   * Mutation affected-row count (insert/update/delete/upsert).
   * Omitted on reads. `null` means the backend did not provide honest meta —
   * never fabricated from returned-row length.
   */
  affectedRows?: number | null;
  count?: number | null;
  data: T | null;
  error: AthenaResultError | null;
  /**
   * @deprecated Prefer `error?.gatewayCode`, `error?.hint`, and related fields on `error`.
   */
  errorDetails?: AthenaGatewayErrorDetails | null;
  raw: unknown;
  status: number;
  statusText?: string | null;
}

export interface AthenaResultError {
  athenaCode: NormalizedAthenaError["code"];
  category: NormalizedAthenaError["category"];
  cause?: string;
  code: string | null;
  constraint?: string;
  details: unknown | null;
  endpoint?: AthenaGatewayErrorDetails["endpoint"];
  gatewayCode?: AthenaGatewayErrorDetails["code"] | null;
  hint: string | null;
  kind: NormalizedAthenaError["kind"];
  message: string;
  method?: AthenaGatewayErrorDetails["method"];
  operation?: string;
  raw: unknown;
  requestId?: string;
  retryable: boolean;
  status: number;
  statusText: string | null;
  table?: string;
}

export type AthenaResultFormatter = <T>(
  response: AthenaGatewayResponse<T>,
  context?: AthenaOperationContext
) => AthenaResult<T>;

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
  return undefined;
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
    context?: AthenaOperationContext
  ): AthenaResult<T> => {
    const result = formatResult(response);
    // D1 and some transports use `error: undefined` on success; only treat
    // non-nullish error / errorDetails as failures.
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

export async function executeRead<T>(
  behavior: { retryReads?: boolean } | undefined,
  runner: () => Promise<AthenaResult<T>>
): Promise<AthenaResult<T>> {
  if (!behavior?.retryReads) {
    return runner();
  }

  let lastRetryableResult: AthenaResult<T> | undefined;
  let lastRetrySignal: AthenaResultError | null = null;
  try {
    return await withRetry(
      {
        ...READ_RETRY_CONFIG,
        shouldRetry: (error) =>
          error === lastRetrySignal || normalizeAthenaError(error).retryable,
      },
      async () => {
        const result = await runner();
        if (result.error?.retryable) {
          lastRetryableResult = result;
          lastRetrySignal = result.error;
          throw lastRetrySignal;
        }
        return result;
      }
    );
  } catch (error) {
    if (lastRetryableResult && error === lastRetrySignal) {
      return lastRetryableResult;
    }
    throw error;
  }
}

export function toSingleResult<Result>(
  response: AthenaResult<Result>
): AthenaResult<
  Result extends Array<infer Item> ? Item | null : Result | null
> {
  const payload = response.data;
  const singleData = Array.isArray(payload)
    ? payload.length
      ? payload[0]
      : null
    : (payload ?? null);
  return {
    ...response,
    data: singleData as Result extends Array<infer Item>
      ? Item | null
      : Result | null,
  };
}

export type AthenaCardinalityMode = "single" | "maybeSingle";

/**
 * `.single()` / `.maybeSingle()` projection — same as `toSingleResult`
 * (first row or `null`). Reads and mutations share this contract.
 * Tightening 0 / 2+ into errors is a follow-up ADR, not this surface.
 */
export function applyCardinality<Result>(
  response: AthenaResult<Result>,
  _mode: AthenaCardinalityMode
): AthenaResult<
  Result extends Array<infer Item> ? Item | null : Result | null
> {
  return toSingleResult(response);
}
