import {
	migrateAthenaAuthSchema,
} from "../../auth/local/schema.ts";
import type { AthenaCliUI } from "../../cli/ui/index.ts";
import type { RunMigrationsOptions } from "../types.ts";
import { openAuthDatabase } from "./plan.ts";

export async function applyEmbeddedAuthMigrations(
	options: RunMigrationsOptions,
	connectionString: string,
	ui: AthenaCliUI,
): Promise<void> {
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
		await migrateAthenaAuthSchema(database);
	} finally {
		await database.close?.();
	}
	ui.success("✓ Embedded Auth schema applied");
}
