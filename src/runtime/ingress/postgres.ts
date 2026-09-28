import { ATHENA_POSTGRES_POOL_DEFAULTS } from "../../postgres/driver.ts";
import { PostgresDeadline } from "../../postgres/pool/deadline.ts";
import type { PostgresPoolManager } from "../../postgres/pool/manager.ts";
import type {
  EventIngressDatabase,
  EventIngressQueryResult,
} from "./persistence.ts";

function toEventIngressQueryResult<T>(result: {
  rowCount?: number | null;
  rows: unknown[];
}): EventIngressQueryResult<T> {
  return {
    rowCount: result.rowCount ?? result.rows.length,
    rows: result.rows as T[],
  };
}

export function eventIngressDatabaseFromManager(
  manager: PostgresPoolManager
): EventIngressDatabase {
  const query = async <T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => {
    const result = await manager.query(
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
    return toEventIngressQueryResult<T>(result);
  };
  return {
    query,
    async transaction(fn) {
      const lease = await manager.acquire({
        deadline: PostgresDeadline.after(
          ATHENA_POSTGRES_POOL_DEFAULTS.connectionTimeoutMillis
        ),
        target: "pooled",
        workload: "billing",
      });
      const client = lease.client;
      const tx: EventIngressDatabase = {
        async query<T = Record<string, unknown>>(
          text: string,
          values?: unknown[]
        ) {
          const result = await client.query(text, values);
          return toEventIngressQueryResult<T>(result);
        },
        transaction(inner) {
          return inner(tx);
        },
      };
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
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
