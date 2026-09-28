import type { AthenaPostgresPool } from "../../postgres/driver.ts";
import {
  type AthenaPostgresRuntime,
  createAthenaPostgresRuntime,
} from "../../postgres/owned-runtime.ts";

export type AthenaChatPoolOwnership = "borrowed" | "owned";
const CHAT_DATABASE_OPERATION_TIMEOUT_MS = 15_000;

export interface AthenaChatQueryResult<TRow = Record<string, unknown>> {
  rows: TRow[];
}

export interface AthenaChatDatabase {
  close(): Promise<void>;
  readonly ownership: AthenaChatPoolOwnership;
  query<TRow = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<AthenaChatQueryResult<TRow>>;
  transaction<T>(fn: (database: AthenaChatDatabase) => Promise<T>): Promise<T>;
}

function chatDatabaseFromRuntime(
  runtime: Pick<AthenaPostgresRuntime, "query" | "transaction">,
  ownership: AthenaChatPoolOwnership
): AthenaChatDatabase {
  return {
    async close() {},
    ownership,
    async query(text, values) {
      const result = await runtime.query(text, values, {
        deadlineMs: CHAT_DATABASE_OPERATION_TIMEOUT_MS,
        workload: "chat",
      });
      return { rows: (result.rows ?? []) as never };
    },
    async transaction(fn) {
      return runtime.transaction(
        async (tx) => fn(chatDatabaseFromRuntime(tx, "borrowed")),
        {
          deadlineMs: CHAT_DATABASE_OPERATION_TIMEOUT_MS,
          workload: "chat",
        }
      );
    },
  };
}

export function createChatDatabaseFromPool(
  pool: AthenaPostgresPool
): AthenaChatDatabase {
  return chatDatabaseFromRuntime(
    createAthenaPostgresRuntime({ ownership: "borrowed", pool }),
    "borrowed"
  );
}

export function createChatDatabaseFromRuntime(
  runtime: Pick<AthenaPostgresRuntime, "query" | "transaction">
): AthenaChatDatabase {
  return chatDatabaseFromRuntime(runtime, "borrowed");
}
