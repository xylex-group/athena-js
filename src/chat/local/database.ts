import type { AthenaPostgresPool } from "../../postgres/driver.ts";

export type AthenaChatPoolOwnership = "borrowed" | "owned";

export interface AthenaChatQueryResult<TRow = Record<string, unknown>> {
	rows: TRow[];
}

export interface AthenaChatDatabase {
	close(): Promise<void>;
	query<TRow = Record<string, unknown>>(
		text: string,
		values?: unknown[],
	): Promise<AthenaChatQueryResult<TRow>>;
	readonly ownership: AthenaChatPoolOwnership;
	transaction<T>(fn: (database: AthenaChatDatabase) => Promise<T>): Promise<T>;
}

class BorrowedPoolDatabase implements AthenaChatDatabase {
	readonly ownership: AthenaChatPoolOwnership = "borrowed";

	constructor(private readonly pool: AthenaPostgresPool) {}

	async close(): Promise<void> {
		// Borrowed from root getPool(); Chat never ends the pool.
	}

	async query<TRow = Record<string, unknown>>(
		text: string,
		values?: unknown[],
	): Promise<AthenaChatQueryResult<TRow>> {
		const result = await this.pool.query(text, values);
		return { rows: (result.rows ?? []) as TRow[] };
	}

	async transaction<T>(fn: (database: AthenaChatDatabase) => Promise<T>): Promise<T> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const scoped: AthenaChatDatabase = {
				close: async () => {},
				ownership: "borrowed",
				query: async (text, values) => {
					const result = await client.query(text, values);
					return { rows: (result.rows ?? []) as never };
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
	}
}

export function createChatDatabaseFromPool(pool: AthenaPostgresPool): AthenaChatDatabase {
	return new BorrowedPoolDatabase(pool);
}

export function createChatDatabaseFromRuntime(runtime: {
	getPool(): Promise<AthenaPostgresPool>;
}): AthenaChatDatabase {
	const resolve = async (): Promise<AthenaChatDatabase> =>
		createChatDatabaseFromPool(await runtime.getPool());

	return {
		async close() {},
		ownership: "borrowed",
		async query(text, values) {
			return (await resolve()).query(text, values);
		},
		async transaction(fn) {
			return (await resolve()).transaction(fn);
		},
	};
}
