import { migrateAthenaAuthSchema } from "../../auth/node/migrate.ts";

import type { AthenaCliUI } from "../../cli/ui/index.ts";
import type { RunMigrationsOptions } from "../types.ts";
import {
  type AthenaAuthMigrationModules,
  shouldApplyEmbeddedAuthMigrations,
} from "./enablement.ts";
import { openAuthDatabase } from "./plan.ts";

export async function applyEmbeddedAuthMigrations(
  options: RunMigrationsOptions,
  connectionString: string,
  ui: AthenaCliUI,
  modules?: AthenaAuthMigrationModules
): Promise<void> {
  if (!shouldApplyEmbeddedAuthMigrations(modules)) {
    return;
  }
  if (options.migrateAuthSchema) {
    ui.info("→ Embedded Auth schema applying");
    await options.migrateAuthSchema();
    ui.success("✓ Embedded Auth schema applied");
    return;
  }
  if (options.createBackend && !options.createAuthDatabase) {
    return;
  }
  ui.info("→ Embedded Auth schema applying");
  const database = await openAuthDatabase(options, connectionString);
  if (!database) {
    return;
  }
  try {
    await migrateAthenaAuthSchema(database, {
      onTiming: (phase, durationMs) =>
        ui.info(`Embedded Auth ${phase}: ${durationMs}ms`),
    });
  } finally {
    await database.close?.();
  }
  ui.success("✓ Embedded Auth schema applied");
}
