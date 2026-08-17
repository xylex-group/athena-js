/**
 * Product P0: the same findMany nested select against live PostgreSQL.
 * Skips when no reachable Postgres is configured.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { createClient } from "../src/index.ts";

const DEFAULT_LIVE_URI =
	"postgresql://postgres:postgres@127.0.0.1:5432/postgres";

function candidateUris(): string[] {
	const fromEnv = [process.env.ATHENA_PG_DIRECT_URI, process.env.DATABASE_URL]
		.map((value) => value?.trim() ?? "")
		.filter((value) => /^postgres(ql)?:\/\//i.test(value));
	return [...new Set([...fromEnv, DEFAULT_LIVE_URI])];
}

async function detectLiveUri(): Promise<string | undefined> {
	for (const uri of candidateUris()) {
		const client = new pg.Client({
			connectionString: uri,
			connectionTimeoutMillis: 500,
		});
		try {
			await client.connect();
			await client.query("select 1");
			await client.end();
			return uri;
		} catch {
			try {
				await client.end();
			} catch {
				// ignore
			}
		}
	}
	return undefined;
}

const LIVE_URI = await detectLiveUri();
const live = { skip: !LIVE_URI };

test(
	"P0 live: findMany nested orchestral_sections without Gateway",
	live,
	async () => {
		assert.ok(LIVE_URI);
		const admin = new pg.Client({ connectionString: LIVE_URI });
		await admin.connect();
		try {
			await admin.query(`
      CREATE TABLE IF NOT EXISTS orchestral_sections (
        id text PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS instruments (
        id text PRIMARY KEY,
        section_id text NOT NULL REFERENCES orchestral_sections(id),
        name text NOT NULL
      );
      INSERT INTO orchestral_sections (id, name) VALUES ('sec-brass', 'Brass')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      INSERT INTO instruments (id, section_id, name) VALUES
        ('ins-tuba', 'sec-brass', 'Tuba'),
        ('ins-horn', 'sec-brass', 'Horn')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, section_id = EXCLUDED.section_id;
    `);
		} finally {
			await admin.end();
		}

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			throw new Error("silent Gateway fallback is forbidden");
		};
		try {
			const athena = createClient({
				databaseUrl: LIVE_URI,
				env: {},
			});
			const { data, error } = await athena
				.from("orchestral_sections")
				.findMany({
					select: {
						instruments: {
							select: {
								name: true,
							},
						},
						name: true,
					},
					where: { name: { eq: "Brass" } },
				});
			assert.equal(error == null, true, String(error ?? ""));
			const rows = Array.isArray(data) ? data : [];
			assert.equal(rows.length, 1);
			const row = rows[0] as { instruments?: unknown; name?: string };
			assert.equal(row.name, "Brass");
			const children = Array.isArray(row.instruments)
				? row.instruments
				: typeof row.instruments === "string"
					? (JSON.parse(row.instruments) as unknown[])
					: [];
			const names = children
				.map((item) =>
					item && typeof item === "object"
						? String((item as { name?: unknown }).name ?? "")
						: "",
				)
				.sort();
			assert.deepEqual(names, ["Horn", "Tuba"]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	},
);

test(
	"P0 live: relation some() filters parents without Gateway",
	live,
	async () => {
		assert.ok(LIVE_URI);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			throw new Error("silent Gateway fallback is forbidden");
		};
		try {
			const athena = createClient({
				databaseUrl: LIVE_URI,
				env: {},
			});
			const { data, error } = await athena
				.from("orchestral_sections")
				.findMany({
					select: { name: true },
					where: { instruments: { some: { name: { eq: "Tuba" } } } },
				});
			assert.equal(error == null, true, String(error ?? ""));
			const rows = Array.isArray(data) ? data : [];
			assert.equal(rows.length, 1);
			assert.equal((rows[0] as { name?: string }).name, "Brass");
		} finally {
			globalThis.fetch = originalFetch;
		}
	},
);
