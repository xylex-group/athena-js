export type PostgresTimeoutPhase =
  | "admission"
  | "queue"
  | "acquire"
  | "begin"
  | "statement"
  | "transaction"
  | "commit"
  | "rollback";

export type PostgresClock = () => number;

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export class PostgresDeadline {
  readonly durationMs: number;
  readonly startedAt: number;
  readonly expiresAt: number;

  private constructor(
    durationMs: number,
    private readonly clock: PostgresClock
  ) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError(
        "PostgreSQL deadline must be finite and non-negative"
      );
    }
    this.durationMs = durationMs;
    this.startedAt = clock();
    this.expiresAt = this.startedAt + durationMs;
  }

  static after(
    durationMs: number,
    clock: PostgresClock = monotonicNow
  ): PostgresDeadline {
    return new PostgresDeadline(durationMs, clock);
  }

  elapsedMs(): number {
    return Math.min(
      this.durationMs,
      Math.max(0, this.clock() - this.startedAt)
    );
  }

  remainingMs(): number {
    return Math.max(0, this.expiresAt - this.clock());
  }

  expired(): boolean {
    return this.remainingMs() <= 0;
  }
}
