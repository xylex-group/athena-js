import {
  buildPostgresBeginStatement,
  nextInternalSavepointName,
} from "../db/transaction/begin-sql.ts";
import { AthenaTransactionError } from "../db/transaction/errors.ts";
import type {
  AthenaInteractiveTransactionTransport,
  AthenaResolvedTransactionOptions,
  AthenaTransactionOperation,
  AthenaTransactionTransport,
  AthenaTransactionTransportResult,
} from "../db/transaction/types.ts";
import { POSTGRES_DIRECT_TRANSACTION_CAPABILITIES } from "../db/transaction/types.ts";
import type { AthenaGatewayResponse } from "../gateway/types.ts";
import type { AthenaPostgresClient } from "./driver.ts";
import { ATHENA_POSTGRES_POOL_DEFAULTS } from "./driver.ts";
import { executePostgresTransactionOperation } from "./execute.ts";
import type { PostgresIdentityCache } from "./identity.ts";
import { PostgresDeadline } from "./pool/deadline.ts";
import type { PostgresPoolManager } from "./pool/manager.ts";
import { classifyPostgresClientPoison } from "./pool/poison.ts";

function quoteSavepointIdent(name: string): string {
  if (!/^athena_sp_\d+$/.test(name)) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_OPTION_UNSUPPORTED",
      "Savepoint names must be generated internally"
    );
  }
  return `"${name}"`;
}

async function runControl(
  client: AthenaPostgresClient,
  sql: string
): Promise<void> {
  await client.query(sql);
}

export function createPostgresTransactionTransport(input: {
  defaultIdentityColumn?: string;
  getPoolManager: () => Promise<PostgresPoolManager>;
  identityCache: PostgresIdentityCache;
}): AthenaTransactionTransport {
  const getPoolManager = input.getPoolManager;
  return {
    async beginInteractive(options?: AthenaResolvedTransactionOptions) {
      const lease = await (await getPoolManager()).acquire({
        deadline: PostgresDeadline.after(
          options?.timeoutMs ??
            ATHENA_POSTGRES_POOL_DEFAULTS.connectionTimeoutMillis
        ),
        target: "pooled",
        workload: "transaction",
      });
      const client = lease.client;
      let released = false;
      const release = (err?: Error | boolean) => {
        if (released) {
          return;
        }
        released = true;
        if (err === undefined) {
          lease.release();
        } else {
          lease.destroy(err);
        }
      };
      try {
        await runControl(client, buildPostgresBeginStatement(options));
      } catch (error) {
        release(true);
        throw error;
      }
      const interactive: AthenaInteractiveTransactionTransport = {
        async commit() {
          try {
            await runControl(client, "COMMIT");
          } finally {
            release();
          }
        },
        async createSavepoint(name) {
          await runControl(client, `SAVEPOINT ${quoteSavepointIdent(name)}`);
        },
        async execute(operation: AthenaTransactionOperation) {
          return executePostgresTransactionOperation({
            cache: input.identityCache,
            callOptions: options?.callOptions,
            defaultIdentityColumn: input.defaultIdentityColumn,
            operation,
            queryable: client,
          });
        },
        async releaseSavepoint(name) {
          await runControl(
            client,
            `RELEASE SAVEPOINT ${quoteSavepointIdent(name)}`
          );
        },
        async rollback() {
          try {
            await runControl(client, "ROLLBACK");
          } finally {
            release();
          }
        },
        async rollbackToSavepoint(name) {
          await runControl(
            client,
            `ROLLBACK TO SAVEPOINT ${quoteSavepointIdent(name)}`
          );
        },
      };
      return interactive;
    },
    capabilities: POSTGRES_DIRECT_TRANSACTION_CAPABILITIES,
    async executeAtomic(
      operations: readonly AthenaTransactionOperation[],
      options?: AthenaResolvedTransactionOptions
    ): Promise<AthenaTransactionTransportResult> {
      const lease = await (await getPoolManager()).acquire({
        deadline: PostgresDeadline.after(
          options?.timeoutMs ??
            ATHENA_POSTGRES_POOL_DEFAULTS.connectionTimeoutMillis
        ),
        target: "pooled",
        workload: "transaction",
      });
      const client = lease.client;
      const results: AthenaGatewayResponse<unknown>[] = [];
      try {
        await runControl(client, buildPostgresBeginStatement(options));
        for (const operation of operations) {
          const result = await executePostgresTransactionOperation({
            cache: input.identityCache,
            callOptions: options?.callOptions,
            defaultIdentityColumn: input.defaultIdentityColumn,
            operation,
            queryable: client,
          });
          results.push(result);
          if (!result.ok) {
            await runControl(client, "ROLLBACK");
            return { committed: false, results };
          }
        }
        await runControl(client, "COMMIT");
        return { committed: true, results };
      } catch (error) {
        try {
          await runControl(client, "ROLLBACK");
        } catch (rollbackError) {
          lease.destroy(rollbackError);
          throw error;
        }
        if (classifyPostgresClientPoison(error) === "destroy") {
          lease.destroy(error);
          throw error;
        }
        throw error;
      } finally {
        lease.release();
      }
    },
  };
}

export { nextInternalSavepointName };
