import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient, getAthenaDebugAst } from "../src/index.ts";

function createMockResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

test("debugAst attaches compiled select ASTs to results", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => createMockResponse([{ id: 1 }], 200);

	try {
		const client = createClient({
			debugAst: true,
			key: "secret",
			url: "https://athena-db.com",
		});

		const result = await client
			.from("users")
			.eq("id", 1)
			.order("created_at", { ascending: false })
			.limit(5)
			.select("id");

		const ast = getAthenaDebugAst(result);
		assert.ok(ast);
		assert.equal(ast.kind, "select");
		assert.equal(ast.tableName, "users");
		assert.equal(ast.input.columns, "id");
		assert.deepEqual(ast.input.state.conditions, [
			{ column: "id", eq_column: "id", eq_value: 1, operator: "eq", value: 1 },
		]);
		assert.equal(ast.transport.mode, "compiled-fetch");
		assert.equal(ast.transport.payload.table_name, "users");
		assert.equal(ast.transport.payload.columns, "id");
		assert.deepEqual(ast.transport.payload.sort_by, {
			direction: "descending",
			field: "created_at",
		});
		assert.equal(ast.transport.payload.limit, 5);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("debugAst captures direct findMany AST transport on results", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => createMockResponse([{ id: 1 }], 200);

	try {
		const client = createClient({
			debugAst: true,
			findManyAst: true,
			key: "secret",
			url: "https://athena-db.com",
		});

		const result = await client.from("orders").findMany({
			limit: 1,
			select: {
				id: true,
			},
			where: {
				status: "open",
			},
		});

		const ast = getAthenaDebugAst(result);
		assert.ok(ast);
		assert.equal(ast.kind, "findMany");
		assert.equal(ast.tableName, "orders");
		assert.equal(ast.compiled.columns, "id");
		assert.equal(ast.transport.mode, "direct-ast-fetch");
		assert.deepEqual(ast.transport.payload, {
			limit: 1,
			select: {
				id: true,
			},
			table_name: "orders",
			where: {
				status: {
					eq: "open",
				},
			},
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});
