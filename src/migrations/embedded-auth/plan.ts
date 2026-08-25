import {
	type AthenaAuthDatabase,
	createPostgresAuthDatabase,
} from "../../auth/local/database.ts";
import { AthenaAuthRuntimeError } from "../../auth/local/errors.ts";
import {
	classifyAuthLedgerQueryError,
	healthFromAuthPlan,
} from "../../auth/local/ledger-health.ts";
import {
	type AthenaAuthMigrationPlan,
	getAthenaAuthExpectedLedger,
	planAthenaAuthSchema,
} from "../../auth/local/schema.ts";
import { repairabilityForAuthMigration } from "../../auth/local/schema-manifest.ts";
import { MigrationError, type RunMigrationsOptions } from "../types.ts";

export function offlineExpectedAuthPlan(): AthenaAuthMigrationPlan {
	const expected = getAthenaAuthExpectedLedger();
	const entries = expected.map((entry) => ({
		version: entry.version,
		name: entry.name,
		checksum: entry.checksum ?? "",
		ledgerState: "absent" as const,
		schemaState: "unknown" as const,
		action: "apply" as const,
		repairability: repairabilityForAuthMigration(),
	}));
	const plan = {
		entries,
		appliedCount: 0,
		pendingCount: entries.length,
		driftCount: 0,
		conflictCount: 0,
		hasBlockingDrift: false,
		health: healthFromAuthPlan({
			conflictCount: 0,
			entries,
			hasBlockingDrift: false,
		}),
	} satisfies AthenaAuthMigrationPlan;
	return plan;
}

export async function openAuthDatabase(
	options: RunMigrationsOptions,
	connectionString: string,
): Promise<AthenaAuthDatabase | undefined> {
	if (options.createAuthDatabase) {
		return options.createAuthDatabase(connectionString);
	}
	if (options.createBackend) {
		// Test backends typically skip live Auth DB access.
		return undefined;
	}
	return createPostgresAuthDatabase(connectionString);
}

function withPlanHealth(plan: AthenaAuthMigrationPlan): AthenaAuthMigrationPlan {
	return {
		...plan,
		health: plan.health ?? healthFromAuthPlan(plan),
	};
}

function authPlanLoadError(error: unknown): MigrationError {
	if (error instanceof MigrationError) {
		return error;
	}
	if (error instanceof AthenaAuthRuntimeError) {
		const kind = classifyAuthLedgerQueryError(error);
		if (kind === "PERMISSION_DENIED") {
			return new MigrationError("PROVIDER", error.publicMessage, {
				cause: error,
			});
		}
		if (kind === "INVALID_LEDGER") {
			return new MigrationError("EXECUTION", error.publicMessage, {
				cause: error,
			});
		}
		if (kind === "UNREACHABLE") {
			return new MigrationError("PROVIDER", error.publicMessage, {
				cause: error,
			});
		}
		return new MigrationError("EXECUTION", error.publicMessage, {
			cause: error,
		});
	}
	const kind = classifyAuthLedgerQueryError(error);
	const message = error instanceof Error ? error.message : String(error);
	if (kind === "PERMISSION_DENIED") {
		return new MigrationError(
			"PROVIDER",
			`ATHENA_AUTH_LEDGER_PERMISSION_DENIED\n\n${message}`,
			{ cause: error },
		);
	}
	return new MigrationError(
		"PROVIDER",
		`ATHENA_AUTH_LEDGER_UNREACHABLE\n\nEmbedded Auth could not reach the database to read the migration ledger.\n\n${message}`,
		{ cause: error },
	);
}

/**
 * Load the Embedded Auth plan. Only UNINITIALIZED (no ledger yet, or test
 * backends without an Auth database) falls back to the offline expected ledger.
 * Connection / permission / malformed-adapter failures fail closed.
 */
export async function loadAuthPlan(
	options: RunMigrationsOptions,
	connectionString: string,
	inspectSchema: boolean,
): Promise<AthenaAuthMigrationPlan> {
	if (options.planAuthSchema) {
		return withPlanHealth(await options.planAuthSchema());
	}
	let database: AthenaAuthDatabase | undefined;
	try {
		database = await openAuthDatabase(options, connectionString);
	} catch (error) {
		const kind = classifyAuthLedgerQueryError(error);
		if (kind === "UNINITIALIZED") {
			return offlineExpectedAuthPlan();
		}
		throw authPlanLoadError(error);
	}
	if (!database) {
		return offlineExpectedAuthPlan();
	}
	try {
		return withPlanHealth(
			await planAthenaAuthSchema(database, { inspectSchema }),
		);
	} catch (error) {
		const kind = classifyAuthLedgerQueryError(error);
		if (kind === "UNINITIALIZED") {
			return offlineExpectedAuthPlan();
		}
		throw authPlanLoadError(error);
	} finally {
		await database.close?.();
	}
}
