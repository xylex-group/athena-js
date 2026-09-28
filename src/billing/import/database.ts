import { ATHENA_POSTGRES_POOL_DEFAULTS } from "../../postgres/driver.ts";
import { PostgresDeadline } from "../../postgres/pool/deadline.ts";
import type { PostgresPoolManager } from "../../postgres/pool/manager.ts";
import type { BillingSqlExecutor } from "../subject/repository.ts";

export interface BillingImportDatabase
  extends Omit<BillingSqlExecutor, "transaction"> {
  transaction<T>(fn: (tx: BillingSqlExecutor) => Promise<T>): Promise<T>;
}

export function createBillingSqlExecutor(input: {
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
}): BillingSqlExecutor {
  return {
    async query(sql, params) {
      const result = await input.query(sql, params ? [...params] : undefined);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
}

export function createBillingSqlExecutorFromManager(
  manager: PostgresPoolManager
): BillingSqlExecutor {
  return createBillingSqlExecutor({
    async query(text, values) {
      return manager.query(
        {
          deadline: PostgresDeadline.after(
            ATHENA_POSTGRES_POOL_DEFAULTS.connectionTimeoutMillis
          ),
          target: "pooled",
          workload: "billing",
        },
        text,
        values
      );
    },
  });
}

export function createBillingImportDatabaseFromManager(
  manager: PostgresPoolManager
): BillingImportDatabase {
  const root = createBillingSqlExecutorFromManager(manager);
  return {
    query: root.query.bind(root),
    async transaction(fn) {
      const lease = await manager.acquire({
        deadline: PostgresDeadline.after(
          ATHENA_POSTGRES_POOL_DEFAULTS.connectionTimeoutMillis
        ),
        target: "pooled",
        workload: "billing",
      });
      const client = lease.client;
      try {
        await client.query("BEGIN");
        const tx = createBillingSqlExecutor(client);
        const value = await fn(tx);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          lease.destroy(rollbackError);
          throw error;
        }
        throw error;
      } finally {
        lease.release();
      }
    },
  };
}

export function wrapBillingSqlExecutorAsDatabase(
  sql: BillingSqlExecutor
): BillingImportDatabase {
  return {
    query: sql.query.bind(sql),
    async transaction(fn) {
      return fn(sql);
    },
  };
}
