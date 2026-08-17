import type { AthenaGatewayResponse } from "../gateway/types.ts";
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
import type {
  AthenaPostgresClient,
  AthenaPostgresPool,
} from "./driver.ts";
import { executePostgresTransactionOperation } from "./execute.ts";
import type { PostgresIdentityCache } from "./identity.ts";

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
  getPool: () => Promise<AthenaPostgresPool>;
  identityCache: PostgresIdentityCache;
}): AthenaTransactionTransport {
  return {
    capabilities: POSTGRES_DIRECT_TRANSACTION_CAPABILITIES,
    async beginInteractive(options?: AthenaResolvedTransactionOptions) {
      const pool = await input.getPool();
      const client = await pool.connect();
      let released = false;
      const release = (err?: Error | boolean) => {
        if (released) {
          return;
        }
        released = true;
        client.release(err);
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
    async executeAtomic(
      operations: readonly AthenaTransactionOperation[],
      options?: AthenaResolvedTransactionOptions
    ): Promise<AthenaTransactionTransportResult> {
      const pool = await input.getPool();
      const client = await pool.connect();
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
        } catch {
          // Prefer the original failure.
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export { nextInternalSavepointName };
