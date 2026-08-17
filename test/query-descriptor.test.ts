import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient, enumeration, string, table } from "../src/index.ts";
import {
	compileAthenaQueryDescriptor,
	isAthenaExecutable,
} from "../src/query/descriptor.ts";
import { createAthenaQueryClient } from "../src/react/query-client.ts";

interface Capture {
	init?: RequestInit;
	url: string;
}

function mockFetch() {
	const calls: Capture[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		return new Response(JSON.stringify({ data: [], status: 200 }), {
			status: 200,
		});
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

const File = table("File")
	.schema("public")
	.from("files")
	.columns({
		category: enumeration(["documents", "contracts"] as const),
		displayName: string(),
		fileId: string().generated(),
		organizationId: string(),
	})
	.primaryKey("fileId");

test("from(model) retains the AthenaModelTarget on the builder", () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const builder = client.from(File);
	assert.equal(builder.model, File);
	assert.equal(client.from("files").model, undefined);
});

test("select chain is AthenaExecutable and compiles a descriptor", () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const query = client
		.from(File)
		.select("*")
		.eq("organizationId", "org-a")
		.eq("category", "documents")
		.order("displayName", { ascending: false });

	assert.equal(isAthenaExecutable(query), true);
	assert.equal(query.model, File);

	const descriptor = query.getDescriptor();
	assert.equal(descriptor.version, 2);
	assert.equal(descriptor.operation, "select");
	assert.equal(descriptor.target.schema, "public");
	assert.equal(descriptor.target.table, "files");
	assert.equal(descriptor.target.model, File.meta.model);
	assert.equal(descriptor.projection?.star, true);
	assert.equal(descriptor.projection?.kind, "full-model");
	assert.ok(Object.isFrozen(descriptor));
	assert.deepEqual(descriptor.filters?.map((filter) => filter.column).sort(), [
		"category",
		"organizationId",
	]);
	assert.deepEqual(descriptor.order, [
		{ ascending: false, column: "displayName" },
	]);
	assert.ok(
		descriptor.dependency?.models.some((model) => model.table === "files"),
	);
	assert.ok(
		descriptor.dependency?.fields.some((field) => field.column === "category"),
	);
});

test("descriptor filter order is normalized for identity", () => {
	const left = compileAthenaQueryDescriptor({
		conditions: [
			{ column: "category", operator: "eq", value: "documents" },
			{ column: "organizationId", operator: "eq", value: "org-a" },
		],
		model: File,
		operation: "select",
		tableName: "public.files",
	});
	const right = compileAthenaQueryDescriptor({
		conditions: [
			{ column: "organizationId", operator: "eq", value: "org-a" },
			{ column: "category", operator: "eq", value: "documents" },
		],
		model: File,
		operation: "select",
		tableName: "public.files",
	});
	assert.deepEqual(left.queryKey, right.queryKey);
	assert.deepEqual(left.filters, right.filters);
});

test("modelScopeKey is a structural prefix of queryKey", () => {
	const descriptor = compileAthenaQueryDescriptor({
		conditions: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		context: { organizationId: "org-a" },
		model: File,
		operation: "select",
		tableName: "public.files",
	});
	assert.deepEqual(
		descriptor.queryKey.slice(0, descriptor.modelScopeKey.length),
		[...descriptor.modelScopeKey],
	);
	assert.equal(descriptor.modelScopeKey[0], "athena");
	assert.equal(descriptor.modelScopeKey[1], "model");
	assert.deepEqual(descriptor.modelScopeKey[2], { organizationId: "org-a" });
	assert.equal(descriptor.modelScopeKey[3], "public.files");
});

test("sync withContext tenant identity changes modelScopeKey", () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const orgA = client.withContext({ organizationId: "org-a" });
	const orgB = client.withContext({ organizationId: "org-b" });
	const keyA = orgA.from(File).select("*").getDescriptor().modelScopeKey;
	const keyB = orgB.from(File).select("*").getDescriptor().modelScopeKey;
	assert.notDeepEqual(keyA, keyB);
});

test("string from() is executable but not model-normalized", () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const query = client.from("files").select("id").eq("id", "1");
	const descriptor = query.getDescriptor();
	assert.equal(query.model, undefined);
	assert.equal(descriptor.target.table, "files");
	assert.equal(descriptor.target.model, undefined);
	assert.equal(descriptor.projection?.star, undefined);
	assert.equal(descriptor.projection?.kind, "unknown");
	assert.deepEqual(descriptor.projection?.columns, ["id"]);
});

test("descriptor identity changes with table, filter, projection, order, and range", () => {
	const base = {
		model: File,
		operation: "select" as const,
		tableName: "public.files",
	};
	const a = compileAthenaQueryDescriptor({
		...base,
		conditions: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		projection: "*",
	});
	const same = compileAthenaQueryDescriptor({
		...base,
		conditions: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		projection: "*",
	});
	const otherTable = compileAthenaQueryDescriptor({
		...base,
		conditions: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		projection: "*",
		tableName: "public.folders",
	});
	const otherFilter = compileAthenaQueryDescriptor({
		...base,
		conditions: [{ column: "organizationId", operator: "eq", value: "org-b" }],
		projection: "*",
	});
	const otherProjection = compileAthenaQueryDescriptor({
		...base,
		conditions: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		projection: "fileId",
	});
	const otherOrder = compileAthenaQueryDescriptor({
		...base,
		conditions: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		order: { direction: "descending", field: "displayName" },
		projection: "*",
	});
	const otherRange = compileAthenaQueryDescriptor({
		...base,
		conditions: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		limit: 10,
		projection: "*",
	});

	assert.deepEqual(a.queryKey, same.queryKey);
	assert.notDeepEqual(a.queryKey, otherTable.queryKey);
	assert.notDeepEqual(a.queryKey, otherFilter.queryKey);
	assert.notDeepEqual(a.queryKey, otherProjection.queryKey);
	assert.notDeepEqual(a.queryKey, otherOrder.queryKey);
	assert.notDeepEqual(a.queryKey, otherRange.queryKey);
	assert.equal(otherProjection.projection?.kind, "partial-model");
});

test("model and equivalent qualified string share query identity; only model is graph-eligible", () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const fromModel = client
		.from(File)
		.select("*")
		.eq("organizationId", "org-a")
		.getDescriptor();
	const fromString = client
		.from("public.files")
		.select("*")
		.eq("organizationId", "org-a")
		.getDescriptor();
	assert.deepEqual(fromModel.queryKey, fromString.queryKey);
	assert.equal(fromModel.projection?.kind, "full-model");
	assert.equal(fromString.projection?.kind, "unknown");
});

test("field dependencies record filter, order, and identity roles", () => {
	const descriptor = compileAthenaQueryDescriptor({
		conditions: [
			{ column: "organizationId", operator: "eq", value: "org-a" },
			{ column: "category", operator: "eq", value: "documents" },
		],
		model: File,
		operation: "select",
		order: { direction: "descending", field: "displayName" },
		projection: "*",
		tableName: "public.files",
	});
	const byColumn = Object.fromEntries(
		descriptor.dependency.fields.map((field) => [field.column, field.roles]),
	);
	assert.ok(byColumn.organizationId?.includes("filter"));
	assert.ok(byColumn.category?.includes("filter"));
	assert.ok(byColumn.displayName?.includes("order"));
	assert.ok(byColumn.fileId?.includes("identity"));
});

test("insert update and delete expose the same executable protocol", () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const insert = client.from(File).insert({
		category: "documents",
		displayName: "a.pdf",
		organizationId: "org-a",
	});
	const update = client
		.from(File)
		.update({ displayName: "b.pdf" })
		.eq("fileId", "1");
	const remove = client.from(File).delete({ resourceId: "1" });

	assert.equal(isAthenaExecutable(insert), true);
	assert.equal(isAthenaExecutable(update), true);
	assert.equal(isAthenaExecutable(remove), true);
	assert.equal(insert.getDescriptor().operation, "insert");
	assert.equal(update.getDescriptor().operation, "update");
	assert.equal(remove.getDescriptor().operation, "delete");
	assert.equal(update.getDescriptor().filters?.[0]?.column, "fileId");
});

test("AthenaQueryClient.getQueryKey reads the compiled descriptor queryKey", () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const queryClient = createAthenaQueryClient();
	const query = client.from(File).select("*").eq("organizationId", "org-a");
	assert.deepEqual(
		queryClient.getQueryKey(query),
		query.getDescriptor().queryKey,
	);
});

test("execute() hits the same select transport as awaiting the chain", async () => {
	const client = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	});
	const { calls, restore } = mockFetch();
	try {
		const query = client
			.from(File)
			.select("fileId")
			.eq("organizationId", "org-a");
		await query.execute();
		await client.from(File).select("fileId").eq("organizationId", "org-a");
		assert.equal(calls.length, 2);
		assert.deepEqual(
			JSON.parse(calls[0].init?.body as string),
			JSON.parse(calls[1].init?.body as string),
		);
	} finally {
		restore();
	}
});
