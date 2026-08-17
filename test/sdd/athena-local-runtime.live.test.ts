/**
 * R0 live PG — Request → Local Runtime → createPostgresDirectTransport → PostgreSQL.
 *
 * Skips when no reachable Postgres is available. Prefers
 * ATHENA_PG_DIRECT_URI / ATHENA_LOCAL_RUNTIME_PG_URI / DATABASE_URL, then a
 * local default used by athena-js integration fixtures.
 */
import { strict as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { ATHENA_GATEWAY_ROUTES } from "../../src/gateway/routes.ts";
import { createClient } from "../../src/index.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import { ATHENA_PG_DIRECT_BASE_URL } from "../../src/postgres/constants.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";

const DEFAULT_LIVE_URI =
	"postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const SCHEMA = "athena_lr_r0";
const TABLE = `${SCHEMA}.cases`;
const BASE = "http://localhost/api/athena";

interface GatewayBody {
	count?: number | null;
	data?: unknown;
	error?: { code?: string; message?: string; status?: number };
	ok?: boolean;
}

function candidateUris(): string[] {
	const fromEnv = [
		process.env.ATHENA_PG_DIRECT_URI,
		process.env.ATHENA_LOCAL_RUNTIME_PG_URI,
		process.env.DATABASE_URL,
	]
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

const secretNeedle = LIVE_URI
	? (LIVE_URI.match(/:\/\/[^:@/]+:([^@/]+)@/)?.[1] ?? "")
	: "";

function assertNoSecretLeak(value: unknown): void {
	const text = JSON.stringify(value);
	assert.equal(/postgres(?:ql)?:\/\/[^\s"'\\]+/i.test(text), false, text);
	if (secretNeedle && secretNeedle !== "postgres") {
		assert.equal(text.includes(secretNeedle), false, text);
	}
}

function asRows(data: unknown): Record<string, unknown>[] {
	if (Array.isArray(data)) {
		return data.filter(
			(row): row is Record<string, unknown> =>
				Boolean(row) && typeof row === "object" && !Array.isArray(row),
		);
	}
	if (data && typeof data === "object" && !Array.isArray(data)) {
		return [data as Record<string, unknown>];
	}
	return [];
}

function normalizeValue(value: unknown): unknown {
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
		return { bytea: value.toString("hex") };
	}
	if (typeof value === "string" && /^\\x[0-9a-fA-F]*$/.test(value)) {
		return { bytea: value.slice(2).toLowerCase() };
	}
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		(value as { type?: unknown }).type === "Buffer" &&
		Array.isArray((value as { data?: unknown }).data)
	) {
		return {
			bytea: Buffer.from((value as { data: number[] }).data).toString("hex"),
		};
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (Array.isArray(value)) {
		return value.map(normalizeValue);
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			out[key] = normalizeValue(entry);
		}
		return out;
	}
	return value;
}

function normalizeRows(data: unknown): unknown[] {
	return asRows(data)
		.map((row) => normalizeValue(row) as Record<string, unknown>)
		.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

const handlers = LIVE_URI
	? createAthenaDataHandlers({
			databaseUrl: LIVE_URI,
			security: { mode: "trusted" },
			unsafeAllowUnauthenticated: true,
		})
	: undefined;

const runtime = LIVE_URI
	? createAthenaServerRuntime({
			databaseUrl: LIVE_URI,
			security: { mode: "trusted" },
		})
	: undefined;

const direct = LIVE_URI
	? createClient({ databaseUrl: LIVE_URI, env: {} })
	: undefined;

async function http(
	path: string,
	body?: unknown,
	method = "POST",
): Promise<{ body: GatewayBody; response: Response }> {
	assert.ok(handlers);
	const init: RequestInit = {
		headers: { "content-type": "application/json" },
		method,
	};
	if (body !== undefined) {
		init.body = typeof body === "string" ? body : JSON.stringify(body);
	}
	const request = new Request(`${BASE}${path}`, init);
	const response = await handlers.POST(request);
	const parsed = (await response.json()) as GatewayBody;
	assertNoSecretLeak(parsed);
	return { body: parsed, response };
}

async function setup(): Promise<void> {
	assert.ok(LIVE_URI);
	const client = new pg.Client({ connectionString: LIVE_URI });
	await client.connect();
	try {
		await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
		await client.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id uuid PRIMARY KEY,
        email text NOT NULL UNIQUE,
        name text,
        rank integer,
        amount numeric(12,4),
        big_count bigint,
        payload jsonb,
        tags text[],
        raw_bytes bytea,
        created_at timestamptz NOT NULL DEFAULT now(),
        local_ts timestamp,
        note text,
        parent_id uuid REFERENCES ${TABLE}(id),
        CONSTRAINT athena_lr_r0_rank_nonneg CHECK (rank IS NULL OR rank >= 0)
      )
    `);
		await client.query(`TRUNCATE TABLE ${TABLE} CASCADE`);
	} finally {
		await client.end();
	}
}

test("R0 live: fixture Postgres is reachable", live, async () => {
	await setup();
	assert.ok(LIVE_URI);
	assert.ok(runtime);
	assert.equal(runtime.transport.baseUrl, ATHENA_PG_DIRECT_BASE_URL);
	assert.equal(runtime.capabilities.transport, "postgres-direct");
});

test(
	"R0 live: select / insert / update / delete HTTP parity",
	live,
	async () => {
		await setup();
		const id = randomUUID();
		const email = `r0-${id.slice(0, 8)}@example.com`;

		const inserted = await http(ATHENA_GATEWAY_ROUTES.insert, {
			columns: "*",
			insert_body: { email, id, name: "Ada" },
			table_name: TABLE,
		});
		assert.equal(inserted.response.status, 200);
		assert.equal(inserted.body.ok, true);
		assert.equal(asRows(inserted.body.data)[0]?.email, email);

		const selected = await http(ATHENA_GATEWAY_ROUTES.select, {
			conditions: [{ column: "email", operator: "eq", value: email }],
			table_name: TABLE,
		});
		assert.equal(selected.body.ok, true);
		assert.equal(asRows(selected.body.data)[0]?.name, "Ada");

		const updated = await http(ATHENA_GATEWAY_ROUTES.update, {
			columns: "*",
			conditions: [{ column: "id", operator: "eq", value: id }],
			table_name: TABLE,
			update_body: { name: "Grace" },
		});
		assert.equal(updated.body.ok, true);
		assert.equal(asRows(updated.body.data)[0]?.name, "Grace");

		const deleted = await http(ATHENA_GATEWAY_ROUTES.delete, {
			columns: "*",
			conditions: [{ column: "id", operator: "eq", value: id }],
			table_name: TABLE,
		});
		assert.equal(deleted.body.ok, true);

		const missing = await http(ATHENA_GATEWAY_ROUTES.select, {
			conditions: [{ column: "id", operator: "eq", value: id }],
			table_name: TABLE,
		});
		assert.deepEqual(asRows(missing.body.data), []);

		assert.ok(direct);
		const viaClient = await direct
			.from(TABLE)
			.insert({
				email: `direct-${id.slice(0, 8)}@example.com`,
				id: randomUUID(),
				name: "Direct",
			})
			.select("email,name");
		assert.equal(viaClient.error, null, String(viaClient.error ?? ""));
	},
);

test("R0 live: null comparison", live, async () => {
	await setup();
	const withNote = randomUUID();
	const withoutNote = randomUUID();
	await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: [
			{ email: "n1@example.com", id: withNote, note: "present" },
			{ email: "n2@example.com", id: withoutNote },
		],
		table_name: TABLE,
	});
	const nulls = await http(ATHENA_GATEWAY_ROUTES.select, {
		conditions: [{ column: "note", operator: "is", value: null }],
		table_name: TABLE,
	});
	assert.equal(nulls.body.ok, true);
	const ids = asRows(nulls.body.data).map((row) => row.id);
	assert.equal(ids.includes(withoutNote), true);
	assert.equal(ids.includes(withNote), false);
});

test("R0 live: IN and empty IN", live, async () => {
	await setup();
	const a = randomUUID();
	const b = randomUUID();
	const c = randomUUID();
	await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: [
			{ email: "in-a@example.com", id: a, name: "A" },
			{ email: "in-b@example.com", id: b, name: "B" },
			{ email: "in-c@example.com", id: c, name: "C" },
		],
		table_name: TABLE,
	});
	const included = await http(ATHENA_GATEWAY_ROUTES.select, {
		conditions: [{ column: "id", operator: "in", value: [a, b] }],
		table_name: TABLE,
	});
	assert.equal(asRows(included.body.data).length, 2);
	const empty = await http(ATHENA_GATEWAY_ROUTES.select, {
		conditions: [{ column: "id", operator: "in", value: [] }],
		table_name: TABLE,
	});
	assert.equal(empty.body.ok, true);
	assert.deepEqual(asRows(empty.body.data), []);
});

test("R0 live: order / limit / offset", live, async () => {
	await setup();
	await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: [
			{ email: "o1@example.com", id: randomUUID(), name: "c", rank: 3 },
			{ email: "o2@example.com", id: randomUUID(), name: "a", rank: 1 },
			{ email: "o3@example.com", id: randomUUID(), name: "b", rank: 2 },
		],
		table_name: TABLE,
	});
	const ordered = await http(ATHENA_GATEWAY_ROUTES.select, {
		sort_by: { direction: "ascending", field: "rank" },
		table_name: TABLE,
	});
	assert.deepEqual(
		asRows(ordered.body.data).map((row) => row.name),
		["a", "b", "c"],
	);
	const page = await http(ATHENA_GATEWAY_ROUTES.select, {
		limit: 1,
		offset: 1,
		sort_by: { direction: "ascending", field: "rank" },
		table_name: TABLE,
	});
	assert.equal(asRows(page.body.data)[0]?.name, "b");
});

test("R0 live: supported count mode", live, async () => {
	await setup();
	await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: [
			{ email: "c1@example.com", id: randomUUID() },
			{ email: "c2@example.com", id: randomUUID() },
			{ email: "c3@example.com", id: randomUUID() },
		],
		table_name: TABLE,
	});
	const counted = await http(ATHENA_GATEWAY_ROUTES.select, {
		count: "exact",
		limit: 1,
		sort_by: { direction: "ascending", field: "email" },
		table_name: TABLE,
	});
	assert.equal(counted.body.ok, true);
	assert.equal(counted.body.count, 3);
	assert.equal(asRows(counted.body.data).length, 1);
});

test("R0 live: unique / FK / not-null / check SQLSTATE", live, async () => {
	await setup();
	const parent = randomUUID();
	await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: { email: "unique@example.com", id: parent },
		table_name: TABLE,
	});

	const unique = await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: { email: "unique@example.com", id: randomUUID() },
		table_name: TABLE,
	});
	assert.equal(unique.response.status, 409);
	assert.equal(unique.body.ok, false);
	assert.match(String(unique.body.error?.code ?? ""), /unique/i);

	const fk = await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: {
			email: "fk@example.com",
			id: randomUUID(),
			parent_id: randomUUID(),
		},
		table_name: TABLE,
	});
	assert.equal(fk.response.status, 409);
	assert.match(String(fk.body.error?.code ?? ""), /foreign_key/i);

	const notNull = await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: { id: randomUUID(), name: "no-email" },
		table_name: TABLE,
	});
	assert.equal(notNull.response.status, 400);
	assert.match(String(notNull.body.error?.code ?? ""), /not_null/i);

	const check = await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: {
			email: "check@example.com",
			id: randomUUID(),
			rank: -1,
		},
		table_name: TABLE,
	});
	assert.equal(check.response.status, 400);
	assert.match(String(check.body.error?.code ?? ""), /check/i);
});

test(
	"R0 live: timestamp / int8 / numeric / json / arrays / bytea",
	live,
	async () => {
		await setup();
		const id = randomUUID();
		const createdAt = "2026-08-16T12:00:00.000Z";
		const localTs = "2026-08-16T12:00:00.000";
		const bytes = Buffer.from("athena-r0", "utf8");
		const inserted = await http(ATHENA_GATEWAY_ROUTES.insert, {
			columns: "*",
			insert_body: {
				amount: "12.5000",
				big_count: "9223372036854775807",
				created_at: createdAt,
				email: "types@example.com",
				id,
				local_ts: localTs,
				payload: { nested: true, n: 2 },
				raw_bytes: `\\x${bytes.toString("hex")}`,
				tags: ["alpha", "beta"],
			},
			table_name: TABLE,
		});
		assert.equal(inserted.body.ok, true, JSON.stringify(inserted.body));
		const row = asRows(inserted.body.data)[0];
		assert.ok(row);
		assert.equal(String(row.big_count), "9223372036854775807");
		assert.equal(String(row.amount), "12.5000");
		assert.deepEqual(row.payload, { n: 2, nested: true });
		assert.deepEqual(row.tags, ["alpha", "beta"]);
		const created = normalizeValue(row.created_at);
		assert.equal(typeof created, "string");
		assert.match(String(created), /2026-08-16T12:00:00/);
		const encodedBytes = normalizeValue(row.raw_bytes) as { bytea?: string };
		assert.equal(encodedBytes.bytea, bytes.toString("hex"));

		assert.ok(direct);
		const viaClient = await direct
			.from(TABLE)
			.eq("id", id)
			.select("id,big_count,amount,payload,tags");
		assert.equal(viaClient.error, null, String(viaClient.error ?? ""));
		const clientRow = asRows(viaClient.data)[0];
		assert.equal(String(clientRow?.big_count), "9223372036854775807");
		assert.deepEqual(clientRow?.payload, { n: 2, nested: true });
	},
);

test(
	"R0 live: malformed body / unsupported route / raw + RPC deny",
	live,
	async () => {
		const malformed = await http(ATHENA_GATEWAY_ROUTES.select, "{not-json");
		assert.equal(malformed.response.status, 400);
		assert.equal(malformed.body.ok, false);

		const unknown = await http("/gateway/not-a-route", { table_name: TABLE });
		assert.equal(unknown.response.status, 404);
		assert.equal(
			unknown.body.error?.code,
			"ATHENA_RUNTIME_UNSUPPORTED_OPERATION",
		);

		const raw = await http(ATHENA_GATEWAY_ROUTES.rawQuery, {
			query: "select 1",
		});
		assert.equal(raw.response.status, 403);
		assert.equal(raw.body.error?.code, "ATHENA_RAW_SQL_FORBIDDEN");

		const rpc = await http(ATHENA_GATEWAY_ROUTES.rpc, {
			function: "public.do_thing",
		});
		assert.equal(rpc.response.status, 403);
		assert.equal(rpc.body.error?.code, "ATHENA_RPC_FORBIDDEN");
	},
);

test(
	"R0 live: concurrent HTTP reuses one postgres-direct transport",
	live,
	async () => {
		await setup();
		assert.ok(runtime);
		assert.equal(runtime.transport.baseUrl, ATHENA_PG_DIRECT_BASE_URL);
		const ids = Array.from({ length: 8 }, () => randomUUID());
		const results = await Promise.all(
			ids.map((id, index) =>
				http(ATHENA_GATEWAY_ROUTES.insert, {
					columns: "*",
					insert_body: { email: `conc-${index}@example.com`, id },
					table_name: TABLE,
				}),
			),
		);
		assert.equal(
			results.every((result) => result.body.ok === true),
			true,
		);
		const listed = await http(ATHENA_GATEWAY_ROUTES.select, {
			table_name: TABLE,
		});
		assert.equal(asRows(listed.body.data).length, 8);
	},
);

test("R0 live: no hosted Gateway network call", live, async () => {
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
		fetchCalls += 1;
		return originalFetch(...args);
	}) as typeof fetch;
	try {
		const result = await http(ATHENA_GATEWAY_ROUTES.select, {
			limit: 1,
			table_name: TABLE,
		});
		assert.equal(result.body.ok, true);
		assert.equal(fetchCalls, 0);
		assert.ok(runtime);
		assert.equal(runtime.transport.baseUrl, ATHENA_PG_DIRECT_BASE_URL);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("R0 live: HTTP matches in-process execute on overlap", live, async () => {
	await setup();
	assert.ok(runtime);
	const id = randomUUID();
	const email = `overlap-${id.slice(0, 8)}@example.com`;
	await http(ATHENA_GATEWAY_ROUTES.insert, {
		columns: "*",
		insert_body: { email, id, name: "Overlap" },
		table_name: TABLE,
	});
	const viaHttp = await http(ATHENA_GATEWAY_ROUTES.select, {
		conditions: [{ column: "id", operator: "eq", value: id }],
		table_name: TABLE,
	});
	const viaExecute = await runtime.execute({
		operation: "fetch",
		payload: {
			conditions: [{ column: "id", operator: "eq", value: id }],
			table_name: TABLE,
		},
	});
	assert.equal(viaExecute.ok, true);
	assert.deepEqual(
		normalizeRows(viaHttp.body.data),
		normalizeRows(viaExecute.data),
	);
});
