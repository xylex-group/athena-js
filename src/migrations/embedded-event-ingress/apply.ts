import type { AthenaCliUI } from "../../cli/ui/index.ts";
import { applyEmbeddedSqlMigrationsWithRuntime } from "../embedded-sql-apply.ts";
import type { RunMigrationsOptions } from "../types.ts";
import {
  EMBEDDED_EVENT_INGRESS_LEDGER,
  EMBEDDED_EVENT_INGRESS_MIGRATIONS,
} from "./catalog.ts";
import {
  type AthenaEventIngressMigrationModules,
  shouldApplyEmbeddedEventIngressMigrations,
} from "./enablement.ts";

export async function applyEmbeddedEventIngressMigrations(
  options: RunMigrationsOptions,
  connectionString: string,
  ui: AthenaCliUI,
  modules: AthenaEventIngressMigrationModules | undefined
): Promise<void> {
  if (!shouldApplyEmbeddedEventIngressMigrations(modules)) {
    return;
  }
  if (options.createBackend && !options.createAuthDatabase) {
    return;
  }
  ui.info("→ Embedded Event Ingress schema applying");
  await applyEmbeddedSqlMigrationsWithRuntime({
    connectionString,
    ledgerTable: EMBEDDED_EVENT_INGRESS_LEDGER,
    migrations: EMBEDDED_EVENT_INGRESS_MIGRATIONS,
    postgresRuntime: options.postgresRuntime,
    ui,
  });
  ui.success("✓ Embedded Event Ingress schema applied");
}
