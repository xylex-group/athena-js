import type { AthenaCliUI } from "../../cli/ui/index.ts";
import type { AthenaEventIngressMigrationModules } from "../embedded-event-ingress/enablement.ts";
import { shouldApplyEmbeddedBillingMigrations } from "../embedded-event-ingress/enablement.ts";
import { applyEmbeddedSqlMigrationsWithRuntime } from "../embedded-sql-apply.ts";
import type { RunMigrationsOptions } from "../types.ts";
import {
  EMBEDDED_BILLING_LEDGER,
  EMBEDDED_BILLING_MIGRATIONS,
} from "./catalog.ts";

export async function applyEmbeddedBillingMigrations(
  options: RunMigrationsOptions,
  connectionString: string,
  ui: AthenaCliUI,
  modules: AthenaEventIngressMigrationModules | undefined
): Promise<void> {
  if (!shouldApplyEmbeddedBillingMigrations(modules)) {
    return;
  }
  if (options.createBackend && !options.createAuthDatabase) {
    return;
  }
  ui.info("→ Embedded Billing schema applying");
  await applyEmbeddedSqlMigrationsWithRuntime({
    connectionString,
    ledgerTable: EMBEDDED_BILLING_LEDGER,
    migrations: EMBEDDED_BILLING_MIGRATIONS,
    postgresRuntime: options.postgresRuntime,
    ui,
  });
  ui.success("✓ Embedded Billing schema applied");
}
