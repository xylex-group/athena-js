export type BillingConvergenceState = "running" | "succeeded" | "failed";

export interface BillingConvergenceAttempt<T> {
  readonly error?: unknown;
  readonly generation: number;
  readonly promise: Promise<T>;
  readonly result?: T;
  readonly state: BillingConvergenceState;
}

export interface BillingConvergenceController<T> {
  current(key: string): BillingConvergenceAttempt<T> | undefined;
  retry(key: string, run: () => Promise<T>): Promise<T>;
  start(key: string, run: () => Promise<T>): Promise<T>;
}

interface MutableAttempt<T> {
  error?: unknown;
  generation: number;
  promise: Promise<T>;
  result?: T;
  state: BillingConvergenceState;
}

function snapshot<T>(
  attempt: MutableAttempt<T>
): BillingConvergenceAttempt<T> {
  return {
    ...(attempt.error === undefined ? {} : { error: attempt.error }),
    generation: attempt.generation,
    promise: attempt.promise,
    ...(attempt.result === undefined ? {} : { result: attempt.result }),
    state: attempt.state,
  };
}

export function createBillingConvergenceController<
  T,
>(): BillingConvergenceController<T> {
  const attempts = new Map<string, MutableAttempt<T>>();

  const execute = (
    key: string,
    generation: number,
    run: () => Promise<T>
  ): Promise<T> => {
    const attempt: MutableAttempt<T> = {
      generation,
      promise: Promise.resolve().then(run),
      state: "running",
    };
    attempts.set(key, attempt);
    attempt.promise = attempt.promise.then(
      (result) => {
        if (attempts.get(key) === attempt) {
          attempt.result = result;
          attempt.state = "succeeded";
        }
        return result;
      },
      (error: unknown) => {
        if (attempts.get(key) === attempt) {
          attempt.error = error;
          attempt.state = "failed";
        }
        throw error;
      }
    );
    attempt.promise.catch(() => undefined);
    return attempt.promise;
  };

  return {
    current(key) {
      const attempt = attempts.get(key);
      return attempt == null ? undefined : snapshot(attempt);
    },
    retry(key, run) {
      const current = attempts.get(key);
      if (current?.state === "running") {
        return current.promise;
      }
      return execute(key, (current?.generation ?? 0) + 1, run);
    },
    start(key, run) {
      const current = attempts.get(key);
      if (current != null) {
        return current.promise;
      }
      return execute(key, 1, run);
    },
  };
}
