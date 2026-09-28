import { normalizeAthenaErrorForRetry } from "../error/normalize.ts";

export type RetryBackoffStrategy =
  | "linear"
  | "exponential"
  | ((attempt: number, error: unknown) => number);

export interface RetryConfig {
  backoff?: RetryBackoffStrategy;
  baseDelayMs?: number;
  jitter?: boolean | number;
  maxDelayMs?: number;
  retries: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
}

function defaultShouldRetry(error: unknown): boolean {
  const normalized = normalizeAthenaErrorForRetry(error);
  return normalized.kind === "transient" || normalized.kind === "rate_limit";
}

function computeDelayMs(
  attempt: number,
  error: unknown,
  config: Required<
    Pick<RetryConfig, "baseDelayMs" | "backoff" | "maxDelayMs" | "jitter">
  >
): number {
  const rawDelay =
    typeof config.backoff === "function"
      ? config.backoff(attempt, error)
      : config.backoff === "linear"
        ? config.baseDelayMs * attempt
        : config.baseDelayMs * 2 ** (attempt - 1);
  const safeDelay = Number.isFinite(rawDelay) ? Math.max(0, rawDelay) : 0;
  const clamped = Math.min(config.maxDelayMs, safeDelay);
  const jitterFactor =
    typeof config.jitter === "number"
      ? Math.max(0, Math.min(1, config.jitter))
      : config.jitter
        ? 0.2
        : 0;
  if (!jitterFactor) {
    return clamped;
  }
  const deviation = clamped * jitterFactor;
  const offset = (Math.random() * 2 - 1) * deviation;
  return Math.max(0, clamped + offset);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @deprecated Prefer capability-specific retry handling at the execution
 * boundary. This helper remains exported for compatibility.
 */
export async function withRetry<T>(
  config: RetryConfig,
  fn: () => Promise<T>
): Promise<T> {
  const retries = Math.max(0, Math.trunc(config.retries));
  const shouldRetry = config.shouldRetry ?? defaultShouldRetry;
  const resolvedConfig = {
    backoff: config.backoff ?? "exponential",
    baseDelayMs: config.baseDelayMs ?? 100,
    jitter: config.jitter ?? false,
    maxDelayMs: config.maxDelayMs ?? 10_000,
  } satisfies Required<
    Pick<RetryConfig, "baseDelayMs" | "backoff" | "maxDelayMs" | "jitter">
  >;

  for (let attempts = 0; attempts <= retries; attempts += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempts >= retries) {
        throw error;
      }
      const currentAttempt = attempts + 1;
      if (!(await shouldRetry(error, currentAttempt))) {
        throw error;
      }
      await sleep(computeDelayMs(currentAttempt, error, resolvedConfig));
    }
  }

  throw new Error("withRetry reached an unexpected state");
}
