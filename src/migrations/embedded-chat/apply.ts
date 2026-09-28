import type { AthenaCliUI } from "../../cli/ui/index.ts";
import { applyEmbeddedSqlMigrationsWithRuntime } from "../embedded-sql-apply.ts";
import type { RunMigrationsOptions } from "../types.ts";
import { EMBEDDED_CHAT_LEDGER, EMBEDDED_CHAT_MIGRATIONS } from "./catalog.ts";
import {
  type AthenaChatMigrationModules,
  shouldApplyEmbeddedChatMigrations,
} from "./enablement.ts";

export async function applyEmbeddedChatMigrations(
  options: RunMigrationsOptions,
  connectionString: string,
  ui: AthenaCliUI,
  modules: AthenaChatMigrationModules | undefined
): Promise<void> {
  if (!shouldApplyEmbeddedChatMigrations(modules)) {
    return;
  }
  if (options.createBackend && !options.createAuthDatabase) {
    return;
  }
  ui.info("→ Embedded Chat schema applying");
  await applyEmbeddedSqlMigrationsWithRuntime({
    connectionString,
    ledgerTable: EMBEDDED_CHAT_LEDGER,
    migrations: EMBEDDED_CHAT_MIGRATIONS,
    postgresRuntime: options.postgresRuntime,
    ui,
  });
  ui.success("✓ Embedded Chat schema applied");
}
