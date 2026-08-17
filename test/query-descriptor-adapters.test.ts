import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	descriptorFromReadQueryDefinition,
	readQueryDefinitionFromDescriptor,
} from "../src/query/read-query-descriptor.ts";
import {
	normalizeAthenaReadQueryOrderBy,
	type AthenaReadQueryDefinition,
} from "../src/query/read-query.ts";

test("descriptorFromReadQueryDefinition compiles portable page reads", () => {
	const descriptor = descriptorFromReadQueryDefinition(
		{
			columns: [
				{ column: "fileId", key: "fileId" },
				{ column: "displayName", key: "name" },
			],
			countColumn: "fileId",
			filters: [{ column: "organizationId", operator: "eq", value: "org-a" }],
			mode: "findMany",
			orderBy: { column: "displayName", direction: "desc" },
			schema: "public",
			table: "files",
		},
		{ page: 2, pageSize: 20 },
	);

	assert.equal(descriptor.operation, "findMany");
	assert.equal(descriptor.target.schema, "public");
	assert.equal(descriptor.target.table, "files");
	assert.equal(descriptor.projection?.kind, "unknown");
	assert.deepEqual(descriptor.projection?.columns, ["displayName", "fileId"]);
	assert.equal(descriptor.range?.currentPage, 2);
	assert.equal(descriptor.range?.pageSize, 20);
});

test("readQueryDefinitionFromDescriptor round-trips table, filters, and order", () => {
	const original: AthenaReadQueryDefinition = {
		columns: [
			{ column: "fileId", key: "fileId" },
			{ column: "displayName", key: "displayName" },
		],
		countColumn: "fileId",
		filters: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		mode: "select",
		orderBy: [{ column: "displayName", direction: "desc" }],
		schema: "public",
		table: "files",
	};
	const back = readQueryDefinitionFromDescriptor(
		descriptorFromReadQueryDefinition(original),
	);
	assert.equal(back.table, "files");
	assert.equal(back.schema, "public");
	assert.equal(back.mode, "select");
	assert.equal(back.filters?.[0]?.column, "organizationId");
	assert.equal(
		normalizeAthenaReadQueryOrderBy(back.orderBy)[0]?.column,
		"displayName",
	);
});
