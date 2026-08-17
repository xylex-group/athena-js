import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient, defineModelView, string, table } from "../src/index.ts";
import { buildIncludeJoinSelectQuery } from "../src/client-sql.ts";
import {
	canonicalizeAthenaValue,
	hashAthenaValue,
} from "../src/query/canonicalize.ts";
import { compileAthenaQueryDescriptor } from "../src/query/descriptor.ts";
import { explainAthenaQuery } from "../src/query/explain.ts";
import {
	athenaEntityKeyToken,
	createAthenaEntityKey,
} from "../src/query/model-identity.ts";
import { createAthenaQueryClient } from "../src/react/query-client.ts";

const File = table("File")
	.schema("public")
	.from("files")
	.columns({
		displayName: string(),
		fileId: string().generated(),
		organizationId: string(),
	})
	.primaryKey("fileId");

test("canonicalization tags NaN, Infinity, Date, and key order", () => {
	assert.equal(canonicalizeAthenaValue(Number.NaN), "n:NaN");
	assert.equal(canonicalizeAthenaValue(Number.POSITIVE_INFINITY), "n:Infinity");
	assert.notEqual(
		canonicalizeAthenaValue(Number.NaN),
		canonicalizeAthenaValue(null),
	);
	const date = new Date("2026-01-02T03:04:05.000Z");
	assert.equal(canonicalizeAthenaValue(date), "date:2026-01-02T03:04:05.000Z");
	assert.equal(
		hashAthenaValue({ b: 1, a: 2 }),
		hashAthenaValue({ a: 2, b: 1 }),
	);
});

test("different access envelopes never share entity keys", () => {
	const row = { fileId: "1" };
	const sameOrg = { organizationId: "org-a", userId: "user-1" };
	const otherRole = {
		accessScope: "role:admin",
		organizationId: "org-a",
		userId: "user-1",
	};
	const otherPolicy = {
		organizationId: "org-a",
		policyRevision: "rev-2",
		userId: "user-1",
	};
	assert.notEqual(
		athenaEntityKeyToken(createAthenaEntityKey(File, row, sameOrg)),
		athenaEntityKeyToken(createAthenaEntityKey(File, row, otherRole)),
	);
	assert.notEqual(
		athenaEntityKeyToken(createAthenaEntityKey(File, row, sameOrg)),
		athenaEntityKeyToken(createAthenaEntityKey(File, row, otherPolicy)),
	);
});

test("star select without include does not depend on unused model relations", () => {
	const Related = table("Invoice")
		.schema("public")
		.from("invoices")
		.columns({ fileId: string(), invoiceId: string() })
		.primaryKey("invoiceId");
	const FileWithRel = table("FileRel")
		.schema("public")
		.from("files")
		.columns({
			displayName: string(),
			fileId: string(),
		})
		.primaryKey("fileId");
	(
		FileWithRel.meta as { relations?: Record<string, { targetModel: string }> }
	).relations = {
		invoices: { targetModel: Related.meta.model ?? "Invoice" },
	};

	const descriptor = compileAthenaQueryDescriptor({
		model: FileWithRel,
		operation: "select",
		projection: "fileId,displayName",
		tableName: "public.files",
	});
	assert.equal(descriptor.dependency.relations.length, 0);
	assert.ok(
		!descriptor.dependency.models.some((model) => model.table === "Invoice"),
	);
});

test("include() emits nested gateway select AST and join SQL", async () => {
	const Organization = table("Organization")
		.schema("public")
		.from("organizations")
		.columns({ id: string(), name: string() })
		.primaryKey("id");
	const FileWithOrg = table("FileOrg")
		.schema("public")
		.from("files")
		.columns({
			displayName: string(),
			fileId: string(),
			organizationId: string(),
		})
		.primaryKey("fileId");
	(
		FileWithOrg.meta as {
			relations?: Record<
				string,
				{
					sourceColumns: string[];
					targetColumns: string[];
					targetModel: string;
					targetSchema: string;
				}
			>;
		}
	).relations = {
		organization: {
			sourceColumns: ["organizationId"],
			targetColumns: ["id"],
			targetModel: Organization.meta.model ?? "Organization",
			targetSchema: "public",
		},
	};

	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const calls: Array<{ body: string; signal?: AbortSignal }> = [];
	const original = globalThis.fetch;
	const controller = new AbortController();
	globalThis.fetch = async (_url, init) => {
		calls.push({
			body: String(init?.body ?? ""),
			signal: init?.signal ?? undefined,
		});
		return new Response(JSON.stringify({ data: [], status: 200 }), {
			status: 200,
		});
	};
	try {
		await client
			.from(FileWithOrg)
			.include({
				organization: { select: ["id", "name"] },
			})
			.select("fileId,displayName")
			.execute({ signal: controller.signal });
	} finally {
		globalThis.fetch = original;
	}

	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.signal, controller.signal);
	const payload = JSON.parse(calls[0]?.body ?? "{}") as {
		select?: string;
		table_name?: string;
	};
	assert.equal(payload.table_name, "public.files");
	assert.match(String(payload.select), /organization:/);
	assert.match(String(payload.select), /public\./);
	assert.match(String(payload.select), /id/);

	const joinSql = buildIncludeJoinSelectQuery({
		columns: ["fileId", "displayName"],
		conditions: [],
		relations: [
			{
				columns: ["id", "name"],
				name: "organization",
				sourceColumns: ["organizationId"],
				targetColumns: ["id"],
				targetModel: "Organization",
				targetSchema: "public",
				via: "Organization",
			},
		],
		tableName: "public.files",
	});
	assert.match(String(joinSql), /LEFT JOIN/i);
	assert.match(String(joinSql), /organizationId/);
});

test("full-model query pages store entity ids, not independent row copies", async () => {
	const cache = createAthenaQueryClient();
	const descriptor = compileAthenaQueryDescriptor({
		context: { organizationId: "org-a" },
		model: File,
		operation: "select",
		projection: "*",
		tableName: "public.files",
	});
	await cache.executeQuery({
		cacheMode: "memory",
		descriptor,
		force: true,
		model: File,
		queryFn: async () => ({
			data: [{ displayName: "A", fileId: "1", organizationId: "org-a" }],
		}),
		queryKey: descriptor.queryKey,
		queryKeyToken: cache.getQueryKeyToken(descriptor.queryKey),
	});
	const page = cache.getNormalizedQueryPage(descriptor.queryKey);
	assert.ok(page);
	assert.equal(page?.envelope, "data-array");
	assert.equal(page?.entities.length, 1);
	assert.match(page?.entities[0] ?? "", /^entity:/);
	assert.equal(
		cache.getQueryData<{ data: Array<{ displayName: string }> }>(
			descriptor.queryKey,
		)?.data[0]?.displayName,
		"A",
	);
});

test("include() records only consumed relations on the descriptor", () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const descriptor = client
		.from(File)
		.include({ organization: { targetModel: "Organization" } })
		.select("fileId")
		.getDescriptor();
	assert.equal(descriptor.relations?.length, 1);
	assert.equal(descriptor.relations?.[0]?.name, "organization");
	assert.equal(
		descriptor.selection?.some((node) => node.name === "organization"),
		true,
	);
});

test("descriptor v2 carries predicate, selection, and scope", () => {
	const descriptor = compileAthenaQueryDescriptor({
		conditions: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		context: {
			accessScope: "scope-1",
			organizationId: "org-a",
			policyRevision: "r1",
		},
		model: File,
		operation: "select",
		projection: "fileId",
		tableName: "public.files",
	});
	assert.equal(descriptor.version, 2);
	assert.equal(descriptor.predicate?.kind, "compare");
	assert.ok(descriptor.selection?.length);
	assert.equal(descriptor.scope?.accessScope, "scope-1");
	assert.equal(descriptor.modelFingerprint?.length, 8);
});

test("cache transaction rolls back on throw", async () => {
	const cache = createAthenaQueryClient();
	const descriptor = compileAthenaQueryDescriptor({
		context: { organizationId: "org-a" },
		model: File,
		operation: "select",
		projection: "*",
		tableName: "public.files",
	});
	await cache.executeQuery({
		cacheMode: "memory",
		descriptor,
		force: true,
		model: File,
		queryFn: async () => ({ data: [{ displayName: "A", fileId: "1" }] }),
		queryKey: descriptor.queryKey,
		queryKeyToken: cache.getQueryKeyToken(descriptor.queryKey),
	});

	await assert.rejects(async () => {
		await cache.transaction(async (tx) => {
			tx.update(File, "1", { displayName: "B" });
			throw new Error("fail");
		});
	}, /fail/);

	assert.equal(
		cache.getEntity(
			createAthenaEntityKey(File, { fileId: "1" }, { organizationId: "org-a" }),
		)?.displayName,
		"A",
	);
});

test("dehydrate and hydrate preserve query data", async () => {
	const cache = createAthenaQueryClient();
	const descriptor = compileAthenaQueryDescriptor({
		model: File,
		operation: "select",
		projection: "*",
		tableName: "public.files",
	});
	await cache.executeQuery({
		cacheMode: "memory",
		descriptor,
		force: true,
		model: File,
		queryFn: async () => ({ data: [{ displayName: "A", fileId: "1" }] }),
		queryKey: descriptor.queryKey,
		queryKeyToken: cache.getQueryKeyToken(descriptor.queryKey),
	});
	const dehydrated = cache.dehydrate();
	const next = createAthenaQueryClient();
	next.hydrate(dehydrated);
	assert.equal(
		next.getQueryData<{ data: Array<{ displayName: string }> }>(
			descriptor.queryKey,
		)?.data[0]?.displayName,
		"A",
	);
});

test("explain() summarizes target, scope, and dependencies", () => {
	const descriptor = compileAthenaQueryDescriptor({
		conditions: [{ column: "fileId", operator: "eq", value: "1" }],
		context: { accessScope: "abc", organizationId: "org-a" },
		model: File,
		operation: "select",
		projection: "fileId,displayName",
		tableName: "public.files",
	});
	const explanation = explainAthenaQuery(descriptor);
	assert.equal(explanation.operation, "select");
	assert.match(explanation.target, /files/);
	assert.match(explanation.scope, /org=org-a/);
	assert.ok(explanation.dependencies.fieldCount >= 1);
});

test("defineModelView freezes presentation metadata", () => {
	const view = defineModelView(File, {
		defaultProjection: ["fileId", "displayName"],
		fields: { displayName: { editable: true, searchable: true } },
		label: "File",
		pluralLabel: "Files",
	});
	assert.equal(view.model, File);
	assert.equal(view.label, "File");
	assert.ok(Object.isFrozen(view));
});

test("createClient owns a shared cache across withContext views", () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
		query: { cache: "memory", staleTime: 1_000 },
	});
	const scoped = client.withContext({
		accessScope: "scope-a",
		organizationId: "org-a",
	});
	assert.equal(client.cache, scoped.cache);
	assert.ok(typeof client.explain === "function");
});
