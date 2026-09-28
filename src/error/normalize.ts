import { normalizeAthenaError } from "../auxiliaries.ts";
import type { AthenaErrorKind } from "./types.ts";

export interface RetryNormalizedAthenaError {
  kind: AthenaErrorKind;
  retryable: boolean;
}

export function normalizeAthenaErrorForRetry(
  error: unknown
): RetryNormalizedAthenaError {
  const normalized = normalizeAthenaError(error);
  return {
    kind: normalized.kind,
    retryable: normalized.retryable,
  };
}
