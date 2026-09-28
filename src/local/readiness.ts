import { setTimeout as delay } from "node:timers/promises";

import { PostgresDeadline } from "../postgres/pool/deadline.ts";
import {
  createPostgresPoolManager,
  type PostgresPoolManager,
} from "../postgres/pool/manager.ts";

type ReadinessManager = Pick<PostgresPoolManager, "query" | "close">;

export interface PostgresReadinessOptions {
  connectionString: string;
  createManager?: (connectionString: string) => ReadinessManager;
  intervalMs?: number;
  timeoutMs: number;
}

export async function waitForPostgres(
  options: PostgresReadinessOptions
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  let lastError: unknown;
  const manager =
    options.createManager?.(options.connectionString) ??
    createPostgresPoolManager({
      connectionString: options.connectionString,
    });

  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());

      try {
        await withDeadline(
          manager.query(
            {
              deadline: PostgresDeadline.after(remaining),
              target: "pooled",
              workload: "introspection",
            },
            "SELECT 1",
          ),
          deadline,
        );

        return;
      } catch (error) {
        lastError = error;

        const remainingAfterAttempt = deadline - Date.now();
        if (remainingAfterAttempt <= 0) {
          break;
        }

        await delay(
          Math.min(
            options.intervalMs ?? 250,
            Math.max(1, remainingAfterAttempt),
          ),
        );
      }
    }
  } finally {
    try {
      await manager.close();
    } catch (error) {
      lastError ??= error;
    }
  }

  throw new Error(
    `Local PostgreSQL did not become ready within ${options.timeoutMs}ms.`,
    { cause: lastError }
  );
}

function withDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  onLateValue?: (value: T) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error("Local PostgreSQL readiness deadline exceeded."));
    }, Math.max(0, deadline - Date.now()));

    operation.then(
      (value) => {
        if (settled) {
          onLateValue?.(value);
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
