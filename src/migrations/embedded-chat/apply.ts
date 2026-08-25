import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AthenaCliUI } from "../../cli/ui/index.ts";
import { createPostgresPool } from "../../postgres/driver.ts";
import type { RunMigrationsOptions } from "../types.ts";
import { EMBEDDED_CHAT_LEDGER, EMBEDDED_CHAT_MIGRATIONS } from "./catalog.ts";
import {
	shouldApplyEmbeddedChatMigrations,
	type AthenaChatMigrationModules,
} from "./enablement.ts";

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), "sql");

export async function applyEmbeddedChatMigrations(
	options: RunMigrationsOptions,
	connectionString: string,
	ui: AthenaCliUI,
	modules: AthenaChatMigrationModules | undefined,
): Promise<void> {
	if (!shouldApplyEmbeddedChatMigrations(modules)) {
		return;
	}
	if (options.createBackend && !options.createAuthDatabase) {
		return;
	}
	ui.info("→ Embedded Chat schema applying");
	const pool = await createPostgresPool(connectionString, { max: 4, min: 0 });
	try {
		for (const migration of EMBEDDED_CHAT_MIGRATIONS) {
			const sql = await readFile(join(sqlDir, migration.filename), "utf8");
			await pool.query(sql);
			const applied = await pool.query(
				`SELECT 1 FROM ${EMBEDDED_CHAT_LEDGER} WHERE version = $1`,
				[migration.version],
			);
			if ((applied.rows?.length ?? 0) > 0) {
				continue;
			}
			await pool.query(
				`INSERT INTO ${EMBEDDED_CHAT_LEDGER} (version, name, checksum)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (version) DO NOTHING`,
				[migration.version, migration.name, migration.checksum],
			);
			ui.info(`✓ ${migration.filename} applied`);
		}
	} finally {
		await pool.end();
	}
	ui.success("✓ Embedded Chat schema applied");
}
