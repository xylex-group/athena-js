import { normalizeAthenaErrorForRetry } from "../error/normalize.ts";
import { type RetryConfig, withRetry } from "../auxiliaries/retry.ts";
import type { AthenaResult, AthenaResultError } from "./types.ts";

const READ_RETRY_CONFIG: RetryConfig = {
  backoff: "exponential",
  baseDelayMs: 100,
  jitter: true,
  maxDelayMs: 1000,
  retries: 2,
};

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
          error === lastRetrySignal ||
          normalizeAthenaErrorForRetry(error).retryable,
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
