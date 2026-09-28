import type { AthenaClientCapabilities } from "../cloudflare/types.ts";
import { AthenaConfigurationError } from "../config/errors.ts";
import type { AthenaGatewayClient } from "../gateway/client.ts";
import type { AthenaSqliteConfig } from "./contracts.ts";
import { createSqliteLocalTransport, sqliteLocalTransactionCapabilities } from "./transport.ts";

export interface AthenaSqliteLocalMaterialization {
  readonly capabilities: AthenaClientCapabilities;
  readonly gatewayTransport: AthenaGatewayClient;
  readonly key: string;
  readonly close?: () => Promise<void>;
}

function assertExecutor(config: AthenaSqliteConfig): void {
  const executor = config.executor;
  const capabilities = executor?.capabilities;
  if (
    !executor ||
    typeof executor.execute !== "function" ||
    typeof executor.transaction !== "function" ||
    !capabilities ||
    typeof capabilities.interrupt !== "boolean" ||
    typeof capabilities.returning !== "boolean" ||
    typeof capabilities.savepoints !== "boolean" ||
    !["none", "batch", "interactive"].includes(capabilities.transactions)
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "db.sqlite.executor must provide execute(), transaction(), and explicit capability metadata.",
      "db",
    );
  }
}

export function createSqliteLocalCapabilities(options?: {
  readonly structuredCrud?: boolean;
  readonly atomicTransactions?: boolean;
  readonly interactiveTransactions?: boolean;
  readonly savepoints?: boolean;
  readonly interrupt?: boolean;
}): AthenaClientCapabilities {
  return {
    auth: { remote: false },
    db: {
      engine: "sqlite",
      layers: {
        findManyAst: false,
        flatCrud: options?.structuredCrud === true,
        query: true,
        relations: false,
        rpc: false,
      },
      local: true,
      transactions: {
        atomic: options?.atomicTransactions === true,
        backend: "sqlite-local",
        deferrable: false,
        interactive: options?.interactiveTransactions === true,
        isolationLevels: [],
        readOnly: false,
        savepoints: options?.savepoints === true,
      },
    },
    mode: "sqlite-local",
    storage: {
      backups: false,
      catalogs: false,
      local: false,
      objects: false,
    },
  };
}

export function materializeSqliteLocal(
  config: AthenaSqliteConfig,
): AthenaSqliteLocalMaterialization {
  assertExecutor(config);
  const executor = config.executor;
  let closed = false;
  const tx = sqliteLocalTransactionCapabilities(executor, config.compiler);
  return {
    capabilities: createSqliteLocalCapabilities({
      atomicTransactions: tx.atomic,
      interactiveTransactions: tx.interactive,
      structuredCrud: Boolean(config.compiler),
    }),
    gatewayTransport: createSqliteLocalTransport(executor, config.compiler),
    key: "sqlite-local",
    ...(config.ownership === "owned" && executor.close
      ? {
          close: async () => {
            if (closed) {
              return;
            }
            closed = true;
            await executor.close?.();
          },
        }
      : {}),
  };
}
