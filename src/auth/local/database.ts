import {
	type AthenaPostgresPool,
	createPostgresPool,
} from "../../postgres/driver.ts";
import { assertNodePostgresRuntime } from "../../postgres/runtime.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import { currentAuthRequestTiming } from "./request-timing.ts";

export interface AthenaAuthQueryResult<T = Record<string, unknown>> {
	rowCount: number;
	rows: T[];
}

export interface AthenaAuthDatabase {
	close?(): Promise<void>;
	query<T = Record<string, unknown>>(
		text: string,
		values?: unknown[],
	): Promise<AthenaAuthQueryResult<T>>;
	transaction<T>(fn: (db: AthenaAuthDatabase) => Promise<T>): Promise<T>;
}

/**
 * Normalize any driver-shaped query result into the Auth database contract.
 * Never let callers hit `undefined.rows` / `undefined.length`.
 */
export function assertQueryResult<T = Record<string, unknown>>(
	value: unknown,
	context: string,
): AthenaAuthQueryResult<T> {
	if (Array.isArray(value)) {
		return {
			rowCount: value.length,
			rows: value as T[],
		};
	}

	if (value === null || value === undefined || typeof value !== "object") {
		throw new AthenaAuthRuntimeError(
			500,
			[
				"ATHENA_AUTH_DATABASE_RESULT_INVALID",
				"",
				"Embedded Auth database adapter returned an unexpected query result.",
				"",
				`Context: ${context}`,
				"",
				"Run with:",
				"  ATHENA_JS_DEBUG=1 athena-js migrate",
			].join("\n"),
			{ code: "ATHENA_AUTH_DATABASE_RESULT_INVALID" },
		);
	}

	const record = value as Record<string, unknown>;
	const rows = record.rows;
	if (!Array.isArray(rows)) {
		throw new AthenaAuthRuntimeError(
			500,
			[
				"ATHENA_AUTH_DATABASE_RESULT_INVALID",
				"",
				"Embedded Auth database adapter returned an invalid result while",
				`${context}: expected result.rows to be an array.`,
				"",
				"Run with:",
				"  ATHENA_JS_DEBUG=1 athena-js migrate",
			].join("\n"),
			{ code: "ATHENA_AUTH_DATABASE_RESULT_INVALID" },
		);
	}

	const rawCount = record.rowCount;
	const rowCount =
		typeof rawCount === "number" && Number.isFinite(rawCount)
			? rawCount
			: rows.length;

	return {
		rowCount,
		rows: rows as T[],
	};
}

function normalizeDriverResult<T>(
	result: unknown,
	context: string,
): AthenaAuthQueryResult<T> {
	return assertQueryResult<T>(result, context);
}

class PoolDatabase implements AthenaAuthDatabase {
	constructor(
		private readonly pool: AthenaPostgresPool,
		private readonly ownership: "owned" | "borrowed" = "owned",
	) {}

	close = async (): Promise<void> => {
		if (this.ownership === "borrowed") {
			return;
		}
		await this.pool.end();
	};

	query = async <T = Record<string, unknown>>(
		text: string,
		values?: unknown[],
	): Promise<AthenaAuthQueryResult<T>> => {
		const timing = currentAuthRequestTiming();
		const acquireStarted = performance.now();
		const client = await this.pool.connect();
		timing?.addSqlAcquire(performance.now() - acquireStarted);
		try {
			const execStarted = performance.now();
			const result = await client.query<T & Record<string, unknown>>(
				text,
				values,
			);
			if (timing) {
				timing.addSqlExec(performance.now() - execStarted);
				timing.addSqlCount(1);
			}
			return normalizeDriverResult<T>(result, "pool.query");
		} finally {
			client.release();
		}
	};

	transaction = async <T>(
		fn: (db: AthenaAuthDatabase) => Promise<T>,
	): Promise<T> => {
		const acquireStarted = performance.now();
		const client = await this.pool.connect();
		currentAuthRequestTiming()?.addSqlAcquire(
			performance.now() - acquireStarted,
		);
		try {
			await client.query("BEGIN");
			const scoped: AthenaAuthDatabase = {
				query: async <TRow = Record<string, unknown>>(
					text: string,
					values?: unknown[],
				) => {
					const execStarted = performance.now();
					const result = await client.query(text, values);
					const timing = currentAuthRequestTiming();
					if (timing) {
						timing.addSqlExec(performance.now() - execStarted);
						timing.addSqlCount(1);
					}
					return normalizeDriverResult<TRow>(result, "transaction.query");
				},
				transaction: (inner) => inner(scoped),
			};
			const value = await fn(scoped);
			await client.query("COMMIT");
			return value;
		} catch (error) {
			try {
				await client.query("ROLLBACK");
			} catch {
				// ignore rollback failure
			}
			throw error;
		} finally {
			client.release();
		}
	};
}

export async function createPostgresAuthDatabase(
	connectionString: string,
): Promise<AthenaAuthDatabase> {
	assertNodePostgresRuntime();
	const pool = await createPostgresPool(connectionString, {
		max: 20,
		min: 4,
	});
	return new PoolDatabase(pool);
}

export function createAuthDatabaseFromPool(
	pool: AthenaPostgresPool,
): AthenaAuthDatabase {
	return new PoolDatabase(pool, "borrowed");
}

export const createPostgresAuthDatabaseFromPool = createAuthDatabaseFromPool;

export function createAuthDatabaseFromRuntime(runtime: {
	getPool(): Promise<AthenaPostgresPool>;
}): AthenaAuthDatabase {
	const resolve = async (): Promise<AthenaAuthDatabase> =>
		createAuthDatabaseFromPool(await runtime.getPool());

	const adapter: AthenaAuthDatabase = {
		async close() {},
		async query(text, values) {
			const result = await (await resolve()).query(text, values);
			return assertQueryResult(result, "runtime.query");
		},
		async transaction(fn) {
			return (await resolve()).transaction(fn);
		},
	};
	return adapter;
}
