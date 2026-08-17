import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { enumeration, string, table } from "../src/index.ts";
import { compileAthenaQueryDescriptor } from "../src/query/descriptor.ts";
import { createAthenaEntityKey } from "../src/query/model-identity.ts";
import { createAthenaQueryClient } from "../src/react/query-client.ts";

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

const context = { organizationId: "org-a" };

function listDescriptor() {
	return compileAthenaQueryDescriptor({
		conditions: [
			{ column: "organizationId", operator: "eq", value: "org-a" },
			{ column: "category", operator: "eq", value: "documents" },
		],
		context,
		model: File,
		operation: "select",
		projection: "*",
		tableName: "public.files",
	});
}

function fileRow(overrides: Record<string, unknown> = {}) {
	return {
		category: "documents",
		displayName: "A.pdf",
		fileId: "1",
		organizationId: "org-a",
		...overrides,
	};
}

async function seedList(
	client: ReturnType<typeof createAthenaQueryClient>,
	queryFn: () => Promise<unknown>,
) {
	const descriptor = listDescriptor();
	await client.executeQuery({
		cacheMode: "memory",
		descriptor,
		force: true,
		model: File,
		queryFn,
		queryKey: descriptor.queryKey,
		queryKeyToken: client.getQueryKeyToken(descriptor.queryKey),
	});
	return descriptor;
}

test("full-model query results normalize into the entity graph", async () => {
	const client = createAthenaQueryClient();
	const descriptor = await seedList(client, async () => ({
		data: [fileRow()],
	}));
	const key = createAthenaEntityKey(File, { fileId: "1" }, context);
	assert.equal(client.getEntity(key)?.displayName, "A.pdf");
	const cached = client.getQueryData<{ data: Array<{ displayName: string }> }>(
		descriptor.queryKey,
	);
	assert.equal(cached?.data[0]?.displayName, "A.pdf");
});

test("non-membership field updates patch lists without refetch", async () => {
	const client = createAthenaQueryClient();
	let fetches = 0;
	const descriptor = await seedList(client, async () => {
		fetches += 1;
		return { data: [fileRow()] };
	});
	client.subscribeQuery(
		client.getQueryKeyToken(descriptor.queryKey),
		() => undefined,
	);

	const mutation = compileAthenaQueryDescriptor({
		changedFields: ["displayName"],
		conditions: [{ column: "fileId", operator: "eq", value: "1" }],
		context,
		model: File,
		operation: "update",
		projection: "*",
		tableName: "public.files",
	});
	client.reconcileExecutable(
		mutation,
		{ data: fileRow({ displayName: "B.pdf" }) },
		File,
	);

	assert.equal(fetches, 1);
	assert.equal(
		client.getQueryData<{ data: Array<{ displayName: string }> }>(
			descriptor.queryKey,
		)?.data[0]?.displayName,
		"B.pdf",
	);
	assert.equal(
		client.getEntity(createAthenaEntityKey(File, { fileId: "1" }, context))
			?.displayName,
		"B.pdf",
	);
});

test("membership field updates invalidate the collection query", async () => {
	const client = createAthenaQueryClient();
	let fetches = 0;
	const descriptor = await seedList(client, async () => {
		fetches += 1;
		return { data: [fileRow()] };
	});
	client.subscribeQuery(
		client.getQueryKeyToken(descriptor.queryKey),
		() => undefined,
	);

	const mutation = compileAthenaQueryDescriptor({
		changedFields: ["category"],
		conditions: [{ column: "fileId", operator: "eq", value: "1" }],
		context,
		model: File,
		operation: "update",
		projection: "*",
		tableName: "public.files",
	});
	client.reconcileExecutable(
		mutation,
		{ data: fileRow({ category: "contracts" }) },
		File,
	);
	await Promise.resolve();
	await Promise.resolve();

	assert.ok(
		fetches >= 2,
		"collection query should refetch after membership change",
	);
});

test("insert invalidates model collections", async () => {
	const client = createAthenaQueryClient();
	let fetches = 0;
	const descriptor = await seedList(client, async () => {
		fetches += 1;
		return { data: [fileRow()] };
	});
	client.subscribeQuery(
		client.getQueryKeyToken(descriptor.queryKey),
		() => undefined,
	);

	const mutation = compileAthenaQueryDescriptor({
		changedFields: ["displayName", "organizationId", "category"],
		context,
		model: File,
		operation: "insert",
		projection: "*",
		tableName: "public.files",
	});
	client.reconcileExecutable(
		mutation,
		{ data: fileRow({ fileId: "2" }) },
		File,
	);
	await Promise.resolve();
	await Promise.resolve();
	assert.ok(fetches >= 2);
	assert.ok(
		client.getEntity(createAthenaEntityKey(File, { fileId: "2" }, context)),
	);
});

test("delete removes the entity and drops it from lists", async () => {
	const client = createAthenaQueryClient();
	const descriptor = await seedList(client, async () => ({
		data: [fileRow()],
	}));
	const mutation = compileAthenaQueryDescriptor({
		conditions: [{ column: "fileId", operator: "eq", value: "1" }],
		context,
		model: File,
		operation: "delete",
		tableName: "public.files",
	});
	client.reconcileExecutable(mutation, { data: null }, File);
	assert.equal(
		client.getEntity(createAthenaEntityKey(File, { fileId: "1" }, context)),
		undefined,
	);
	const cached = client.getQueryData<{ data: unknown[] }>(descriptor.queryKey);
	assert.equal(cached?.data.length, 0);
});

test("entity graph is isolated by access context", async () => {
	const client = createAthenaQueryClient();
	const orgA = listDescriptor();
	await client.executeQuery({
		descriptor: orgA,
		force: true,
		model: File,
		queryFn: async () => ({ data: [fileRow({ displayName: "A" })] }),
		queryKey: orgA.queryKey,
		queryKeyToken: client.getQueryKeyToken(orgA.queryKey),
	});
	const orgB = compileAthenaQueryDescriptor({
		conditions: [
			{ column: "organizationId", operator: "eq", value: "org-b" },
			{ column: "category", operator: "eq", value: "documents" },
		],
		context: { organizationId: "org-b" },
		model: File,
		operation: "select",
		projection: "*",
		tableName: "public.files",
	});
	await client.executeQuery({
		descriptor: orgB,
		force: true,
		model: File,
		queryFn: async () => ({
			data: [fileRow({ displayName: "B", organizationId: "org-b" })],
		}),
		queryKey: orgB.queryKey,
		queryKeyToken: client.getQueryKeyToken(orgB.queryKey),
	});

	assert.equal(
		client.getEntity(
			createAthenaEntityKey(File, { fileId: "1" }, { organizationId: "org-a" }),
		)?.displayName,
		"A",
	);
	assert.equal(
		client.getEntity(
			createAthenaEntityKey(File, { fileId: "1" }, { organizationId: "org-b" }),
		)?.displayName,
		"B",
	);
});

test("partial projections are not entity-normalized", async () => {
	const client = createAthenaQueryClient();
	const descriptor = compileAthenaQueryDescriptor({
		context,
		model: File,
		operation: "select",
		projection: "fileId,displayName",
		tableName: "public.files",
	});
	await client.executeQuery({
		descriptor,
		force: true,
		model: File,
		queryFn: async () => ({ data: [{ displayName: "A.pdf", fileId: "1" }] }),
		queryKey: descriptor.queryKey,
		queryKeyToken: client.getQueryKeyToken(descriptor.queryKey),
	});
	assert.equal(
		client.getEntity(createAthenaEntityKey(File, { fileId: "1" }, context)),
		undefined,
	);
});

test("forModel is cache-only and patches stored entities", async () => {
	const client = createAthenaQueryClient();
	const descriptor = await seedList(client, async () => ({
		data: [fileRow()],
	}));
	const files = client.forModel(File, context);
	files.update("1", { displayName: "Renamed.pdf" });
	assert.equal(files.get("1")?.displayName, "Renamed.pdf");
	assert.equal(
		client.getQueryData<{ data: Array<{ displayName: string }> }>(
			descriptor.queryKey,
		)?.data[0]?.displayName,
		"Renamed.pdf",
	);
});
