/**
 * Node database transport materializer (postgres / D1 already on config).
 */

import { createPostgresDirectCapabilities } from "../../cloudflare/capabilities.ts";
import {
  ATHENA_PG_DIRECT_API_KEY,
  ATHENA_PG_DIRECT_BASE_URL,
} from "../../postgres/constants.ts";
import type { AthenaPostgresPool } from "../../postgres/driver.ts";
import {
  bindPostgresRuntime,
  createAthenaPostgresRuntime,
  getBoundPostgresRuntime,
} from "../../postgres/owned-runtime.ts";
import {
  createPostgresDirectTransport,
  disposePostgresDirectTransport,
} from "../../postgres/transport.ts";
import { catalogFromModels } from "../../query/engine/index.ts";
import type { AthenaClientModelsInput } from "../../schema/types.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";
import type {
  AthenaDatabaseRuntimeResources,
  AthenaRuntimeConfigBindings,
} from "../construction/types.ts";
import { createSqliteLocalTransport, sqliteLocalTransactionCapabilities } from "../../sqlite-local/transport.ts";
import { createSqliteLocalCapabilities } from "../../sqlite-local/materialize.ts";

export { disposePostgresDirectTransport };

/**
 * Wire `db.pgUri` into a direct PostgreSQL AthenaGatewayClient transport.
 * Runs after edge materialize so D1 wins only when selected; d1+pgUri is rejected.
 */
export interface AthenaMaterializedDatabase<
  TModels extends AthenaClientModelsInput | undefined,
> {
  readonly bindings: AthenaRuntimeConfigBindings<TModels>;
  readonly postgresRuntime?: ReturnType<typeof createAthenaPostgresRuntime>;
  readonly sqliteExecutor?: AthenaDatabaseRuntimeResources["sqliteExecutor"];
}

export function materializeDatabase<
  TModels extends AthenaClientModelsInput | undefined,
>(
  plan: AthenaRuntimePlan,
  resources: AthenaDatabaseRuntimeResources,
): AthenaMaterializedDatabase<TModels> {
  const existingRuntime = resources.gatewayTransport
    ? getBoundPostgresRuntime(resources.gatewayTransport)
    : undefined;
  if (plan.db.transport !== "postgres" || plan.db.source === "none") {
    if (plan.db.transport === "sqlite" && resources.sqliteExecutor) {
      const executor = resources.sqliteExecutor;
      const tx = sqliteLocalTransactionCapabilities(
        executor,
        resources.sqliteCompiler,
      );
      return {
        bindings: {
          capabilities: createSqliteLocalCapabilities({
            atomicTransactions: tx.atomic,
            interactiveTransactions: tx.interactive,
            structuredCrud: Boolean(resources.sqliteCompiler),
          }),
          findManyAst: false,
          gatewayTransport: createSqliteLocalTransport(
            executor,
            resources.sqliteCompiler,
          ),
          key: "sqlite-local",
        },
        sqliteExecutor: executor,
      };
    }
    return {
      bindings: {},
      ...(existingRuntime ? { postgresRuntime: existingRuntime } : {}),
    };
  }

  let capabilities = plan.db.capabilities;
  if (!capabilities) {
    const base = createPostgresDirectCapabilities({
      authRemote: plan.db.hasRemoteAuth,
      findManyAst: true,
      flatCrud: true,
      query: true,
      relations: true,
      rpc: true,
      storageLocal: plan.storage.transport === "local",
      storageConfigured:
        plan.db.hasRemoteStorage ||
        plan.storage.transport === "local" ||
        plan.storage.transport === "s3",
    });
    capabilities = {
      ...base,
      storage: {
        ...base.storage,
        ...(plan.storage.transport === "local" || plan.storage.transport === "s3"
          ? { local: plan.storage.transport === "local", objects: true }
          : {}),
      },
    };
  }
  const postgresRuntime =
    existingRuntime ??
    createAthenaPostgresRuntime(
      resources.pool
        ? { pool: resources.pool as AthenaPostgresPool }
        : { connectionString: plan.db.pgUri as string },
    );
  const gatewayTransport =
    resources.gatewayTransport ??
    createPostgresDirectTransport({
      relationCatalog: catalogFromModels(plan.db.models),
      runtime: postgresRuntime,
    });
  bindPostgresRuntime(gatewayTransport, postgresRuntime);
  return {
    bindings: {
      capabilities,
      db: {
        pgUri: plan.db.pgUri,
        url: plan.db.hasRemoteDbGateway
          ? undefined
          : ATHENA_PG_DIRECT_BASE_URL,
      },
      findManyAst: plan.db.findManyAst ?? true,
      gatewayTransport,
      ...(plan.db.requestedKey || !plan.db.hasRemoteServices
        ? { key: plan.db.requestedKey ?? ATHENA_PG_DIRECT_API_KEY }
        : {}),
      postgresRuntime,
    },
    postgresRuntime,
  };
}

export function disposeMaterializedDatabase(
  transport: Parameters<typeof disposePostgresDirectTransport>[0]
): Promise<void> {
  return disposePostgresDirectTransport(transport);
}
