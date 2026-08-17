import type {
  AthenaResult,
  AthenaResultError,
} from "../../src/client-result.ts";

/**
 * Minimal AthenaResultError for unit tests.
 * Leave kind/category/athenaCode unset so normalizeAthenaError can classify
 * from status + message (same as loosely shaped gateway errors).
 */
export function makeResultError(
  message: string,
  overrides: Partial<AthenaResultError> = {}
): AthenaResultError {
  return {
    athenaCode: undefined as unknown as AthenaResultError["athenaCode"],
    category: undefined as unknown as AthenaResultError["category"],
    code: null,
    details: null,
    hint: null,
    kind: undefined as unknown as AthenaResultError["kind"],
    message,
    raw: message,
    retryable: false,
    status: overrides.status ?? 500,
    statusText: null,
    ...overrides,
  };
}

export function makeResult<T>(
  overrides: Omit<Partial<AthenaResult<T>>, "error"> & {
    error?: AthenaResultError | string | null;
  } = {}
): AthenaResult<T> {
  // Keep string errors as strings so normalizeAthenaError can parse message
  // (constraint, kind from status) the same way production loosely-typed results do.
  if (typeof overrides.error === "string") {
    return {
      count: null,
      data: null,
      raw: null,
      status: 200,
      ...overrides,
      error: overrides.error as unknown as AthenaResultError,
    } as AthenaResult<T>;
  }

  const { error: _ignored, ...rest } = overrides;
  return {
    count: null,
    data: null,
    raw: null,
    status: 200,
    ...rest,
    error: overrides.error ?? null,
  } as AthenaResult<T>;
}
