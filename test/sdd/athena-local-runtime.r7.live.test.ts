/**
 * R7 live security + topology: Alice/Bob/Admin/Anonymous against real PostgreSQL.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ATHENA_GATEWAY_ROUTES } from "../../src/gateway/routes.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import type {
	PolicyDefinition,
	PolicyIrDocument,
} from "../../src/policy/types.ts";
import { serializeAthenaRuntimeDiscoveryDocument } from "../../src/runtime/data/discovery-document.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { number, string, table } from "../../src/schema/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "../../../../test/fixtures/policy-ir");
const SCHEMA = "athena_lr_r7";
const BASE = "http://localhost/api/athena";
const DEFAULT_LIVE_URI =
	"postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const HOSTED_URL = (
	process.env.ATHENA_URL ??
	process.env.ATHENA_GATEWAY_URL ??
	""
).trim();
const HOSTED_KEY = (
	process.env.ATHENA_API_KEY ??
	process.env.ATHENA_GATEWAY_API_KEY ??
	""
).trim();

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
const hosted = { skip: !(HOSTED_URL && HOSTED_KEY) };

const invoices = table("invoices")
	.schema(SCHEMA)
	.columns({
		amount: number(),
		id: string(),
		status: string(),
		user_id: string(),
	})
	.primaryKey("id");

const ownInvoices: PolicyDefinition = {
	actions: 15,
	check: {
		left: {
			column: { logical: "userId", physical: "user_id" },
			kind: "column",
		},
		op: "eq",
		right: { kind: "subject", subject: { slot: "userId" } },
	},
	composition: "permissive",
	id: "r7-own-invoices",
	principals: [{ kind: "authenticated" }],
	resource: { schema: SCHEMA, table: "invoices" },
	visibility: {
		left: {
			column: { logical: "userId", physical: "user_id" },
			kind: "column",
		},
		op: "eq",
		right: { kind: "subject", subject: { slot: "userId" } },
	},
};

const principals: Record<string, AthenaPrincipal> = {
	admin: {
		authenticated: true,
		grants: [],
		rights: ["admin"],
		role: "admin",
		userId: "admin",
	},
	alice: {
		authenticated: true,
		grants: [],
		rights: [],
		userId: "alice",
	},
	anonymous: {
		authenticated: false,
		grants: [],
		rights: [],
	},
	bob: {
		authenticated: true,
		grants: [],
		rights: [],
		userId: "bob",
	},
};

function principalFor(headers: Headers): AthenaPrincipal {
	const token = headers.get("x-athena-test-principal");
	return principals[token ?? ""] ?? principals.anonymous;
}

async function setup(): Promise<void> {
	assert.ok(LIVE_URI);
	const client = new pg.Client({ connectionString: LIVE_URI });
	await client.connect();
	try {
		await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
		await client.query(`CREATE SCHEMA ${SCHEMA}`);
		await client.query(`
      CREATE TABLE ${SCHEMA}.invoices (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        amount integer NOT NULL,
        status text NOT NULL
      );
      INSERT INTO ${SCHEMA}.invoices (id, user_id, amount, status) VALUES
        ('inv-alice', 'alice', 10, 'open'),
        ('inv-bob', 'bob', 20, 'open');
    `);
	} finally {
		await client.end();
	}
}

const handlers = LIVE_URI
	? createAthenaDataHandlers({
			auth: {
				mode: "custom",
				resolvePrincipal: ({ headers }) => ({
					authority: "custom-trusted",
					principal: principalFor(headers),
				}),
			},
			databaseUrl: LIVE_URI,
			models: { invoices },
			policies: { definitions: [ownInvoices], enforce: true },
			security: { mode: "policy" },
		})
	: undefined;

async function http(
	path: string,
	body: unknown,
	who: string,
	origin = BASE,
): Promise<{ body: Record<string, unknown>; status: number; text: string }> {
	assert.ok(handlers);
	const request = new Request(`${BASE}${path}`, {
		body: JSON.stringify(body),
		headers: {
			"content-type": "application/json",
			origin,
			"x-athena-test-principal": who,
		},
		method: "POST",
	});
	const response = await handlers.POST(request);
	const text = await response.text();
	const parsed = JSON.parse(text) as Record<string, unknown>;
	return { body: parsed, status: response.status, text };
}

function rowsOf(body: Record<string, unknown>): Record<string, unknown>[] {
	const data = body.data;
	return Array.isArray(data)
		? data.filter(
				(row): row is Record<string, unknown> =>
					Boolean(row) && typeof row === "object",
			)
		: [];
}

test("R7 live: Alice sees only Alice invoices", live, async () => {
	await setup();
	const result = await http(
		ATHENA_GATEWAY_ROUTES.select,
		{
			table_name: `${SCHEMA}.invoices`,
		},
		"alice",
	);
	assert.equal(result.body.ok, true, result.text);
	const ids = rowsOf(result.body).map((row) => row.id);
	assert.deepEqual(ids, ["inv-alice"]);
	assert.equal(result.text.includes("postgresql://"), false);
});

test("R7 live: Bob sees only Bob invoices", live, async () => {
	await setup();
	const result = await http(
		ATHENA_GATEWAY_ROUTES.select,
		{
			table_name: `${SCHEMA}.invoices`,
		},
		"bob",
	);
	assert.equal(result.body.ok, true, result.text);
	assert.deepEqual(
		rowsOf(result.body).map((row) => row.id),
		["inv-bob"],
	);
});

test("R7 live: Alice cannot mutate Bob rows", live, async () => {
	await setup();
	const updated = await http(
		ATHENA_GATEWAY_ROUTES.update,
		{
			table_name: `${SCHEMA}.invoices`,
			update_body: { status: "paid", user_id: "alice" },
			where: { id: { eq: "inv-bob" } },
		},
		"alice",
	);
	assert.equal(updated.body.ok, true, updated.text);
	assert.equal(Number(updated.body.count ?? rowsOf(updated.body).length), 0);

	const client = new pg.Client({ connectionString: LIVE_URI });
	await client.connect();
	const check = await client.query(
		`SELECT status FROM ${SCHEMA}.invoices WHERE id = 'inv-bob'`,
	);
	await client.end();
	assert.equal(check.rows[0]?.status, "open");
});

test("R7 live: Alice cannot change owner to Bob", live, async () => {
	await setup();
	const updated = await http(
		ATHENA_GATEWAY_ROUTES.update,
		{
			table_name: `${SCHEMA}.invoices`,
			update_body: { user_id: "bob" },
			where: { id: { eq: "inv-alice" } },
		},
		"alice",
	);
	assert.equal(updated.body.ok, false);
	const raw = updated.body as { error?: { code?: string } };
	const code =
		typeof raw.error === "object" && raw.error ? raw.error.code : undefined;
	assert.equal(
		code === "ATHENA_POLICY_WRITE_CONFLICT" || updated.status === 403,
		true,
	);
});

test("R7 live: forged admin header has no effect", live, async () => {
	await setup();
	assert.ok(handlers);
	const request = new Request(`${BASE}${ATHENA_GATEWAY_ROUTES.select}`, {
		body: JSON.stringify({ table_name: `${SCHEMA}.invoices` }),
		headers: {
			"content-type": "application/json",
			"x-athena-role": "admin",
			"x-athena-admin": "true",
			"x-athena-test-principal": "alice",
		},
		method: "POST",
	});
	const response = await handlers.POST(request);
	const body = (await response.json()) as Record<string, unknown>;
	assert.equal(body.ok, true);
	assert.deepEqual(
		rowsOf(body).map((row) => row.id),
		["inv-alice"],
	);
});

test(
	"R7 live: anonymous follows Policy (denied without public policy)",
	live,
	async () => {
		await setup();
		const result = await http(
			ATHENA_GATEWAY_ROUTES.select,
			{ table_name: `${SCHEMA}.invoices` },
			"anonymous",
		);
		assert.equal(result.body.ok, false);
	},
);

test(
	"R7 live: foreign Origin mutation rejected; raw SQL and RPC denied",
	live,
	async () => {
		await setup();
		const csrf = await http(
			ATHENA_GATEWAY_ROUTES.update,
			{
				table_name: `${SCHEMA}.invoices`,
				update_body: { status: "paid" },
				where: { id: { eq: "inv-alice" } },
			},
			"alice",
			"https://evil.example",
		);
		assert.equal(csrf.body.ok, false);

		const raw = await http(
			ATHENA_GATEWAY_ROUTES.rawQuery,
			{ query: "select 1" },
			"alice",
		);
		assert.equal(raw.body.ok, false);
		assert.equal(raw.text.toLowerCase().includes("postgresql://"), false);

		const rpc = await http(
			ATHENA_GATEWAY_ROUTES.rpc,
			{ function: "version" },
			"alice",
		);
		assert.equal(rpc.body.ok, false);
	},
);

test(
	"R7 live: topology discover document + policy + models + session",
	live,
	async () => {
		await setup();
		assert.ok(LIVE_URI);
		const runtime = createAthenaServerRuntime({
			auth: {
				mode: "service",
				principal: {
					...principals.alice,
					service: "r7-live",
				},
			},
			databaseUrl: LIVE_URI,
			models: { invoices },
			policies: { definitions: [ownInvoices], enforce: true },
			security: { mode: "policy" },
		});
		const document = serializeAthenaRuntimeDiscoveryDocument(runtime);
		assert.equal(document.athena, true);
		assert.equal(document.capabilities.policy, true);
		assert.equal(document.capabilities.nestedRelations, true);
		const context: Record<string, unknown> = {};
		const selected = await runtime.execute(
			{
				operation: "fetch",
				payload: { table_name: `${SCHEMA}.invoices` },
			},
			context,
		);
		assert.equal(
			selected.ok,
			true,
			`${String(selected.error)} ${JSON.stringify(context.policyDecision ?? {})}`,
		);
		const data = Array.isArray(selected.data) ? selected.data : [];
		assert.equal(data.length, 1);
	},
);

test("R7: shared policy document still parses as Policy IR", () => {
	const policies = JSON.parse(
		readFileSync(join(fixtureDir, "r7-policies.json"), "utf8"),
	) as PolicyIrDocument;
	assert.equal(policies.irVersion, 1);
	assert.ok(policies.policies.length >= 8);
});

test(
	"R7 hosted: same logical Alice select when fixture exists",
	hosted,
	async () => {
		const { createClient } = await import("../../src/index.ts");
		const client = createClient({
			env: {},
			key: HOSTED_KEY,
			url: HOSTED_URL,
		});
		const result = await client.from("invoices").select();
		if (result.error) {
			assert.match(
				String(result.error),
				/HTTP_ERROR|denied|does not exist|policy/i,
			);
			return;
		}
		assert.ok(Array.isArray(result.data));
	},
);
