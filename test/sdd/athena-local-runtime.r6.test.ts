/**
 * R6 — Query AST / nested relation direct-PG parity.
 *
 * Same public query against: resolved AST, direct PG, Local Runtime HTTP→PG,
 * and Hosted Gateway when a fixture URL is present. No Local Runtime compiler.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { ATHENA_GATEWAY_ROUTES } from "../../src/gateway/routes.ts";
import { createClient } from "../../src/index.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import {
	compilePostgresAst,
	compilePostgresAstCount,
} from "../../src/postgres/compile-ast.ts";
import { AthenaQueryError } from "../../src/query/engine/errors.ts";
import {
	type AthenaRelationCatalog,
	normalizeFindManyInput,
	normalizeTransportPayload,
	resetQueryPlanAliases,
	resolveQueryPlan,
} from "../../src/query/engine/index.ts";
import { serializeAthenaRuntimeDiscoveryDocument } from "../../src/runtime/data/discovery-document.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";

const DEFAULT_LIVE_URI =
	"postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const SCHEMA = "athena_lr_r6";
const BASE = "http://localhost/api/athena";
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

interface GatewayBody {
	count?: number | null;
	data?: unknown;
	error?: { code?: string; hint?: string; message?: string };
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
const hosted = { skip: !(HOSTED_URL && HOSTED_KEY) };

const catalog: AthenaRelationCatalog = {
	entries: [
		{
			cardinality: "many-to-one",
			from: {
				columns: ["section_id"],
				schema: SCHEMA,
				table: "instruments",
			},
			id: `${SCHEMA}.instruments.instruments_section_id_fkey`,
			name: "sections",
			to: { columns: ["id"], schema: SCHEMA, table: "sections" },
		},
		{
			cardinality: "many-to-one",
			from: {
				columns: ["instrument_id"],
				schema: SCHEMA,
				table: "players",
			},
			id: `${SCHEMA}.players.players_instrument_id_fkey`,
			name: "instruments",
			to: { columns: ["id"], schema: SCHEMA, table: "instruments" },
		},
		{
			cardinality: "many-to-many",
			from: { columns: ["id"], schema: SCHEMA, table: "instruments" },
			id: `${SCHEMA}.instruments.tags`,
			junction: {
				fromColumns: ["instrument_id"],
				schema: SCHEMA,
				table: "instrument_tags",
				toColumns: ["tag_id"],
			},
			name: "tags",
			to: { columns: ["id"], schema: SCHEMA, table: "tags" },
		},
	],
};

const nestedToMany = {
	orderBy: { name: "asc" as const },
	select: {
		instruments: {
			orderBy: { name: "asc" as const },
			select: { name: true as const },
		},
		name: true as const,
	},
	table: `${SCHEMA}.sections`,
};

function asRows(data: unknown): Record<string, unknown>[] {
	if (Array.isArray(data)) {
		return data.filter(
			(row): row is Record<string, unknown> =>
				Boolean(row) && typeof row === "object" && !Array.isArray(row),
		);
	}
	return [];
}

function parseJson(value: unknown): unknown {
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as unknown;
		} catch {
			return value;
		}
	}
	return value;
}

function namesOf(value: unknown): string[] {
	const parsed = parseJson(value);
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed.map((row) => {
		if (row && typeof row === "object" && !Array.isArray(row)) {
			return String((row as { name?: unknown }).name ?? "");
		}
		return String(row);
	});
}

const handlers = LIVE_URI
	? createAthenaDataHandlers({
			databaseUrl: LIVE_URI,
			security: { mode: "trusted" },
			unsafeAllowUnauthenticated: true,
		})
	: undefined;

const runtime = createAthenaServerRuntime({
	databaseUrl: LIVE_URI ?? DEFAULT_LIVE_URI,
	security: { mode: "trusted" },
});

const direct = LIVE_URI
	? createClient({ databaseUrl: LIVE_URI, env: {} })
	: undefined;

async function http(
	path: string,
	body?: unknown,
): Promise<{ body: GatewayBody; response: Response }> {
	assert.ok(handlers);
	const request = new Request(`${BASE}${path}`, {
		body: JSON.stringify(body ?? {}),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	const response = await handlers.POST(request);
	const parsed = (await response.json()) as GatewayBody;
	return { body: parsed, response };
}

async function setupLive(): Promise<void> {
	assert.ok(LIVE_URI);
	const client = new pg.Client({ connectionString: LIVE_URI });
	await client.connect();
	try {
		await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
		await client.query(`CREATE SCHEMA ${SCHEMA}`);
		await client.query(`
      CREATE TABLE ${SCHEMA}.sections (
        id text PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE ${SCHEMA}.instruments (
        id text PRIMARY KEY,
        section_id text NOT NULL REFERENCES ${SCHEMA}.sections(id),
        name text NOT NULL
      );
      CREATE TABLE ${SCHEMA}.players (
        id text PRIMARY KEY,
        instrument_id text REFERENCES ${SCHEMA}.instruments(id),
        name text NOT NULL
      );
      CREATE TABLE ${SCHEMA}.tags (
        id text PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE ${SCHEMA}.instrument_tags (
        instrument_id text NOT NULL REFERENCES ${SCHEMA}.instruments(id),
        tag_id text NOT NULL REFERENCES ${SCHEMA}.tags(id),
        PRIMARY KEY (instrument_id, tag_id)
      );
    `);
		await client.query(`
      INSERT INTO ${SCHEMA}.sections (id, name) VALUES
        ('sec-brass', 'Brass'),
        ('sec-wood', 'Woodwinds'),
        ('sec-empty', 'Empty');
      INSERT INTO ${SCHEMA}.instruments (id, section_id, name) VALUES
        ('ins-tuba', 'sec-brass', 'Tuba'),
        ('ins-trumpet', 'sec-brass', 'Trumpet'),
        ('ins-horn', 'sec-brass', 'Horn'),
        ('ins-flute', 'sec-wood', 'Flute');
      INSERT INTO ${SCHEMA}.players (id, instrument_id, name) VALUES
        ('ply-ada', 'ins-tuba', 'Ada'),
        ('ply-orphan', NULL, 'Orphan');
      INSERT INTO ${SCHEMA}.tags (id, name) VALUES ('tag-loud', 'loud');
      INSERT INTO ${SCHEMA}.instrument_tags (instrument_id, tag_id)
        VALUES ('ins-tuba', 'tag-loud');
    `);
	} finally {
		await client.end();
	}
}

test("R6: Local Runtime advertises nestedRelations from the PG compiler", () => {
	assert.equal(runtime.capabilities.nestedRelations, true);
	const document = serializeAthenaRuntimeDiscoveryDocument(runtime);
	assert.equal(document.capabilities.nestedRelations, true);
});

test("R6: resolved AST + PG compiler emit one nested json_agg statement", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		...nestedToMany,
		where: { name: { eq: "Brass" } },
	});
	const plan = resolveQueryPlan(ast, { catalog });
	const compiled = compilePostgresAst(plan);
	assert.equal(
		plan.selection.some((field) => field.kind === "relation"),
		true,
	);
	assert.match(compiled.text, /json_agg\(row_to_json\(/);
	assert.doesNotMatch(compiled.text, /for \(.*of/);
	assert.equal(compiled.text.includes("SELECT"), true);
	assert.equal((compiled.text.match(/SELECT/g) ?? []).length >= 2, true);
});

test("R6: nested many-to-one compiles to row_to_json LIMIT 1", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		select: {
			name: true,
			sections: { select: { name: true } },
		},
		table: `${SCHEMA}.instruments`,
		where: { name: { eq: "Tuba" } },
	});
	const compiled = compilePostgresAst(resolveQueryPlan(ast, { catalog }));
	assert.match(compiled.text, /row_to_json\(/);
	assert.match(compiled.text, /LIMIT 1/);
	assert.doesNotMatch(compiled.text, /json_agg/);
});

test("R6: parent limit vs child limit stay independent", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		limit: 1,
		select: {
			instruments: {
				limit: 2,
				orderBy: { name: "asc" },
				select: { name: true },
			},
			name: true,
		},
		table: `${SCHEMA}.sections`,
		where: { name: { eq: "Brass" } },
	});
	const compiled = compilePostgresAst(resolveQueryPlan(ast, { catalog }));
	assert.match(compiled.text, /LIMIT 2/);
	assert.match(compiled.text, /LIMIT 1$/);
});

test("R6: unknown relation is a typed query error", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		select: {
			ghosts: { select: { id: true } },
			name: true,
		},
		table: `${SCHEMA}.sections`,
	});
	assert.throws(
		() => resolveQueryPlan(ast, { catalog }),
		(error: unknown) =>
			error instanceof AthenaQueryError &&
			error.code === "ATHENA_QUERY_UNKNOWN_RELATION",
	);
});

test("R6: many-to-many resolves a junction alias for compilation", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		select: {
			name: true,
			tags: { select: { name: true } },
		},
		table: `${SCHEMA}.instruments`,
	});
	const plan = resolveQueryPlan(ast, { catalog });
	const tags = plan.selection.find(
		(field) => field.kind === "relation" && field.alias === "tags",
	);
	assert.ok(tags && tags.kind === "relation");
	assert.equal(tags.descriptor.cardinality, "many-to-many");
	assert.ok(tags.junctionAlias);
});

test("R6: schema-qualified relation resolves on the AST", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		select: {
			instruments: {
				schema: SCHEMA,
				select: { name: true },
			},
			name: true,
		},
		table: `${SCHEMA}.sections`,
	});
	const plan = resolveQueryPlan(ast, { catalog });
	const relation = plan.selection.find((field) => field.kind === "relation");
	assert.equal(relation?.kind, "relation");
	if (relation?.kind === "relation") {
		assert.equal(relation.plan.source.schema, SCHEMA);
		assert.equal(relation.plan.source.table, "instruments");
		assert.equal(relation.descriptor.cardinality, "one-to-many");
	}
});

test("R6: parent count SQL ignores nested selection", () => {
	resetQueryPlanAliases();
	const ast = normalizeTransportPayload({
		count: "exact",
		select: nestedToMany.select,
		table_name: `${SCHEMA}.sections`,
		where: { name: { eq: "Brass" } },
	});
	const compiled = compilePostgresAstCount(resolveQueryPlan(ast, { catalog }));
	assert.match(compiled.text, /COUNT\(\*\)::bigint/);
	assert.doesNotMatch(compiled.text, /json_agg/);
	assert.deepEqual(compiled.values, ["Brass"]);
});

test(
	"R6 live: nested one-to-many matches AST / direct PG / Local HTTP",
	live,
	async () => {
		await setupLive();
		assert.ok(direct);

		const ast = normalizeFindManyInput({
			orderBy: { name: "asc" },
			select: {
				instruments: {
					orderBy: { name: "asc" },
					select: { name: true },
				},
				name: true,
			},
			table: `${SCHEMA}.sections`,
			where: { name: { eq: "Brass" } },
		});
		const plan = resolveQueryPlan(ast, { catalog });
		assert.equal(
			plan.selection.some((field) => field.kind === "relation"),
			true,
		);

		const viaDirect = await direct.from(`${SCHEMA}.sections`).findMany({
			orderBy: { name: "asc" },
			select: {
				instruments: {
					orderBy: { name: "asc" },
					select: { name: true },
				},
				name: true,
			},
			where: { name: { eq: "Brass" } },
		});
		assert.equal(viaDirect.error == null, true, String(viaDirect.error ?? ""));
		const directRows = asRows(viaDirect.data);
		assert.equal(directRows.length, 1);
		assert.equal(directRows[0]?.name, "Brass");
		assert.deepEqual(namesOf(directRows[0]?.instruments), [
			"Horn",
			"Trumpet",
			"Tuba",
		]);

		const viaHttp = await http(ATHENA_GATEWAY_ROUTES.select, {
			orderBy: { name: "asc" },
			select: {
				instruments: {
					orderBy: { name: "asc" },
					select: { name: true },
				},
				name: true,
			},
			table_name: `${SCHEMA}.sections`,
			where: { name: { eq: "Brass" } },
		});
		assert.equal(viaHttp.body.ok, true, JSON.stringify(viaHttp.body.error));
		const httpRows = asRows(viaHttp.body.data);
		assert.deepEqual(
			namesOf(httpRows[0]?.instruments),
			namesOf(directRows[0]?.instruments),
		);
		assert.equal(httpRows[0]?.name, directRows[0]?.name);
	},
);

test("R6 live: nested many-to-one and null relation", live, async () => {
	await setupLive();
	assert.ok(direct);
	const viaDirect = await direct.from(`${SCHEMA}.players`).findMany({
		orderBy: { name: "asc" },
		select: {
			instruments: { select: { name: true } },
			name: true,
		},
	});
	assert.equal(viaDirect.error == null, true, String(viaDirect.error ?? ""));
	const rows = asRows(viaDirect.data).sort((left, right) =>
		String(left.name).localeCompare(String(right.name)),
	);
	const ada = rows.find((row) => row.name === "Ada");
	const orphan = rows.find((row) => row.name === "Orphan");
	const adaInstrument = parseJson(ada?.instruments);
	assert.equal(
		adaInstrument && typeof adaInstrument === "object"
			? (adaInstrument as { name?: string }).name
			: undefined,
		"Tuba",
	);
	assert.equal(orphan?.instruments ?? null, null);

	const viaHttp = await http(ATHENA_GATEWAY_ROUTES.select, {
		orderBy: { name: "asc" },
		select: {
			instruments: { select: { name: true } },
			name: true,
		},
		table_name: `${SCHEMA}.players`,
	});
	assert.equal(viaHttp.body.ok, true, JSON.stringify(viaHttp.body.error));
	const httpOrphan = asRows(viaHttp.body.data).find(
		(row) => row.name === "Orphan",
	);
	assert.equal(httpOrphan?.instruments ?? null, null);
});

test(
	"R6 live: nested filter / order / limit and empty children",
	live,
	async () => {
		await setupLive();
		const viaHttp = await http(ATHENA_GATEWAY_ROUTES.select, {
			orderBy: { name: "asc" },
			select: {
				instruments: {
					limit: 1,
					orderBy: { name: "desc" },
					select: { name: true },
					where: { name: { ilike: "T%" } },
				},
				name: true,
			},
			table_name: `${SCHEMA}.sections`,
		});
		assert.equal(viaHttp.body.ok, true, JSON.stringify(viaHttp.body.error));
		const rows = asRows(viaHttp.body.data);
		const brass = rows.find((row) => row.name === "Brass");
		const empty = rows.find((row) => row.name === "Empty");
		assert.deepEqual(namesOf(brass?.instruments), ["Tuba"]);
		assert.deepEqual(namesOf(empty?.instruments), []);
	},
);

test("R6 live: parent limit vs child limit", live, async () => {
	await setupLive();
	const viaHttp = await http(ATHENA_GATEWAY_ROUTES.select, {
		limit: 1,
		orderBy: { name: "asc" },
		select: {
			instruments: {
				limit: 2,
				orderBy: { name: "asc" },
				select: { name: true },
			},
			name: true,
		},
		table_name: `${SCHEMA}.sections`,
		where: { name: { eq: "Brass" } },
	});
	assert.equal(viaHttp.body.ok, true, JSON.stringify(viaHttp.body.error));
	const rows = asRows(viaHttp.body.data);
	assert.equal(rows.length, 1);
	assert.equal(namesOf(rows[0]?.instruments).length, 2);
});

test("R6 live: count with nested select is parent count", live, async () => {
	await setupLive();
	const viaHttp = await http(ATHENA_GATEWAY_ROUTES.select, {
		count: "exact",
		select: {
			instruments: { select: { name: true } },
			name: true,
		},
		table_name: `${SCHEMA}.sections`,
	});
	assert.equal(viaHttp.body.ok, true, JSON.stringify(viaHttp.body.error));
	assert.equal(viaHttp.body.count, 3);
	assert.equal(asRows(viaHttp.body.data).length, 3);
});

test(
	"R6 live: unknown relation and unsupported m2m stay typed",
	live,
	async () => {
		await setupLive();
		const unknown = await http(ATHENA_GATEWAY_ROUTES.select, {
			select: {
				ghosts: { select: { id: true } },
				name: true,
			},
			table_name: `${SCHEMA}.sections`,
		});
		assert.equal(unknown.body.ok, false);
		const unknownText = JSON.stringify(unknown.body);
		assert.match(unknownText, /ATHENA_QUERY_UNKNOWN_RELATION|Unknown relation/);

		const unsupported = await http(ATHENA_GATEWAY_ROUTES.select, {
			select: {
				name: true,
				tags: { select: { name: true } },
			},
			table_name: `${SCHEMA}.instruments`,
		});
		assert.equal(unsupported.body.ok, false);
		const unsupportedText = JSON.stringify(unsupported.body);
		assert.match(
			unsupportedText,
			/ATHENA_QUERY_UNKNOWN_RELATION|ATHENA_QUERY_UNSUPPORTED_CAPABILITY|Unknown relation|Many-to-many/,
		);
	},
);

test("R6 live: schema-qualified relation over Local HTTP", live, async () => {
	await setupLive();
	const viaHttp = await http(ATHENA_GATEWAY_ROUTES.select, {
		select: {
			instruments: {
				schema: SCHEMA,
				select: { name: true },
			},
			name: true,
		},
		table_name: `${SCHEMA}.sections`,
		where: { name: { eq: "Woodwinds" } },
	});
	assert.equal(viaHttp.body.ok, true, JSON.stringify(viaHttp.body.error));
	assert.deepEqual(namesOf(asRows(viaHttp.body.data)[0]?.instruments), [
		"Flute",
	]);
});

test(
	"R6 live: concurrent nested queries share the runtime pool",
	live,
	async () => {
		await setupLive();
		const results = await Promise.all([
			http(ATHENA_GATEWAY_ROUTES.select, {
				select: { instruments: { select: { name: true } }, name: true },
				table_name: `${SCHEMA}.sections`,
				where: { name: { eq: "Brass" } },
			}),
			http(ATHENA_GATEWAY_ROUTES.select, {
				select: { instruments: { select: { name: true } }, name: true },
				table_name: `${SCHEMA}.sections`,
				where: { name: { eq: "Woodwinds" } },
			}),
			http(ATHENA_GATEWAY_ROUTES.select, {
				select: { instruments: { select: { name: true } }, name: true },
				table_name: `${SCHEMA}.players`,
				where: { name: { eq: "Ada" } },
			}),
		]);
		for (const result of results) {
			assert.equal(result.body.ok, true, JSON.stringify(result.body.error));
		}
		assert.equal(asRows(results[0]?.body.data)[0]?.name, "Brass");
		assert.equal(asRows(results[1]?.body.data)[0]?.name, "Woodwinds");
		assert.equal(asRows(results[2]?.body.data)[0]?.name, "Ada");
	},
);

test(
	"R6 hosted: same findMany call site when fixture exists",
	hosted,
	async () => {
		const client = createClient({
			env: {},
			key: HOSTED_KEY,
			url: HOSTED_URL,
		});
		const result = await client.from(`${SCHEMA}.sections`).findMany({
			select: {
				instruments: { select: { name: true } },
				name: true,
			},
			where: { name: { eq: "Brass" } },
		});
		if (result.error) {
			const text = String(result.error);
			assert.match(
				text,
				/ATHENA_QUERY_UNSUPPORTED_CAPABILITY|does not exist|Unknown relation|HTTP_ERROR/,
			);
			return;
		}
		assert.ok(Array.isArray(result.data));
	},
);
