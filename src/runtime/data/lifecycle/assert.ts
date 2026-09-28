import { AthenaConfigurationError } from "../../../config/errors.ts";

export const ATHENA_DATA_LIFECYCLE_TX_UNSUPPORTED =
  "ATHENA_DATA_LIFECYCLE_TX_UNSUPPORTED" as const;

type LifecycleConfigBag = {
  d1?: unknown;
  databaseUrl?: string | null;
  db?: { d1?: unknown; pgUri?: string | null };
  gatewayTransport?: unknown;
  lifecycle?: { data?: Record<string, unknown> };
};

function hasLocalMutationRuntime(config: LifecycleConfigBag): boolean {
  if (config.db?.d1 !== undefined && config.db.d1 !== null) {
    return true;
  }
  if (config.d1 !== undefined && config.d1 !== null) {
    return true;
  }
  if (typeof config.db?.pgUri === "string" && config.db.pgUri.trim()) {
    return true;
  }
  if (typeof config.databaseUrl === "string" && config.databaseUrl.trim()) {
    return true;
  }
  if (config.gatewayTransport) {
    return true;
  }
  return false;
}

export function assertDataLifecycleTransactionsUnsupported(): never {
  throw new AthenaConfigurationError(
    ATHENA_DATA_LIFECYCLE_TX_UNSUPPORTED,
    "Data lifecycle does not own a transaction-owning nucleus. Interactive transactions are unsupported until one exists.",
    "db"
  );
}

export function assertDataLifecycleConfig(config: LifecycleConfigBag): void {
  const data = config.lifecycle?.data;
  if (!data) {
    return;
  }
  if ("afterCommit" in data && data.afterCommit != null) {
    throw new AthenaConfigurationError(
      "ATHENA_DATA_LIFECYCLE_AFTER_COMMIT_UNSUPPORTED",
      "afterCommit is reserved until a transaction-owning data nucleus exists. It is not an alias of afterUpdate.",
      "db"
    );
  }
  if (!hasLocalMutationRuntime(config)) {
    throw new AthenaConfigurationError(
      "ATHENA_DATA_LIFECYCLE_REQUIRES_LOCAL_RUNTIME",
      "createClient({ lifecycle: { data } }) requires a mutation-owning local runtime (db.pgUri, databaseUrl, or db.d1). Remote/browser clients cannot register data lifecycle hooks.",
      "db"
    );
  }
}
