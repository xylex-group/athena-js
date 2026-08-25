import { repairAthenaAuthSchema } from "../../auth/local/schema.ts";
import type { RunMigrationsOptions } from "../types.ts";
import { openAuthDatabase } from "./plan.ts";

export async function repairEmbeddedAuthMigrations(
	options: RunMigrationsOptions,
	connectionString: string,
	dryRun: boolean,
): Promise<void> {
	if (options.repairAuthSchema) {
		await options.repairAuthSchema({ dryRun });
		return;
	}
	if (options.createBackend && !options.createAuthDatabase) {
		return;
	}
	const database = await openAuthDatabase(options, connectionString);
	if (!database) {
		return;
	}
	try {
		await repairAthenaAuthSchema(database, { dryRun });
	} finally {
		await database.close?.();
	}
}
