import type { AthenaPostgresClient } from "../driver.ts";

export interface PostgresLease {
  readonly acquireDurationMs: number;
  readonly acquiredAt: number;
  readonly client: AthenaPostgresClient;
  destroy(reason?: unknown): void;
  release(): void;
  readonly target: PostgresTarget;
  readonly workload: PostgresWorkload;
}

export type PostgresTarget = "pooled" | "direct";

export type PostgresWorkload =
  | "query"
  | "transaction"
  | "auth"
  | "billing"
  | "chat"
  | "migration"
  | "storage"
  | "notifications"
  | "introspection"
  | "background";

export function destroyUnclaimedPostgresClient(
  client: AthenaPostgresClient
): void {
  client.release(true);
}

export function createPostgresLease(input: {
  acquiredAt: number;
  acquireDurationMs: number;
  client: AthenaPostgresClient;
  target: PostgresTarget;
  workload: PostgresWorkload;
}): PostgresLease {
  let settled = false;

  const settle = (reason?: unknown): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (reason === undefined) {
      input.client.release();
    } else {
      input.client.release(reason instanceof Error ? reason : true);
    }
  };

  return {
    acquireDurationMs: input.acquireDurationMs,
    acquiredAt: input.acquiredAt,
    client: input.client,
    destroy: (reason) => settle(reason ?? true),
    release: () => settle(),
    target: input.target,
    workload: input.workload,
  };
}
