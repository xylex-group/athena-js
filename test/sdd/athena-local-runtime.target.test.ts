/**
 * Target suite — Athena Local Runtime Milestone 1.
 * Titles match dual-suite/dual-suite-spec.md (T-01…T-08).
 */
import { strict as assert } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
	AthenaDeletePayload,
	AthenaGatewayCallOptions,
	AthenaGatewayResponse,
	AthenaInsertPayload,
	AthenaQueryPayload,
	AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { ATHENA_PG_DIRECT_BASE_URL } from "../../src/postgres/constants.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import { handleAthenaGatewayRequest } from "../../src/gateway/server/adapter.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_direct_test";
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

function ok<T>(data: T): AthenaGatewayResponse<T> {
	return {
		count: Array.isArray(data) ? data.length : 1,
		data,
		error: undefined,
		errorDetails: null,
		ok: true,
		raw: { data },
		status: 200,
		statusText: "OK",
	};
}

function createRecordingTransport(): AthenaGatewayClient & {
	calls: Array<{ op: string; payload: unknown }>;
} {
	const calls: Array<{ op: string; payload: unknown }> = [];
	return {
		baseUrl: "https://athena.local/mock",
		buildHeaders() {
			return {};
		},
		calls,
		async deleteGateway<T>(
			payload: AthenaDeletePayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "delete", payload });
			return ok([{ deleted: true }] as T);
		},
		async fetchGateway<T>(
			payload: Parameters<AthenaGatewayClient["fetchGateway"]>[0],
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "fetch", payload });
			const tableName =
				"table_name" in payload && typeof payload.table_name === "string"
					? payload.table_name
					: "unknown";
			return ok([{ id: "1", table: tableName }] as T);
		},
		async insertGateway<T>(
			payload: AthenaInsertPayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "insert", payload });
			return ok([payload.insert_body] as T);
		},
		async queryGateway<T>(
			payload: AthenaQueryPayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "query", payload });
			return ok([{ sql: true }] as T);
		},
		async resolveCallOptions(options) {
			return options;
		},
		async rpcGateway<T>(
			payload: Parameters<AthenaGatewayClient["rpcGateway"]>[0],
			_options?: Parameters<AthenaGatewayClient["rpcGateway"]>[1],
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "rpc", payload });
			return ok([{ rpc: payload.function }] as T);
		},
		async updateGateway<T>(
			payload: AthenaUpdatePayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			calls.push({ op: "update", payload });
			return ok([payload.update_body] as T);
		},
		async verifyConnection() {
			return {
				baseUrl: "https://athena.local/mock",
				error: undefined,
				errorDetails: null,
				ok: true,
				raw: null,
				reachable: true,
				status: 200,
				statusText: "OK",
				url: "https://athena.local/mock/health",
			};
		},
	};
}

test("P1: createAthenaServerRuntime materializes existing PG transport", () => {
	const runtime = createAthenaServerRuntime({
		databaseUrl: SAMPLE_PG,
		security: { mode: "trusted" },
	});
	assert.equal(typeof runtime.execute, "function");
	assert.equal(runtime.transport.baseUrl, ATHENA_PG_DIRECT_BASE_URL);
	assert.equal(runtime.capabilities.transport, "postgres-direct");
	assert.equal(runtime.capabilities.security, "trusted");
	assert.equal(runtime.capabilities.rawSql, false);
	assert.equal(runtime.capabilities.policies, false);
	assert.equal(runtime.capabilities.auth, false);
});

test("P1: Local Runtime CRUD parity with direct createClient", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport,
	});

	const fetchResult = await runtime.execute({
		operation: "fetch",
		payload: { limit: 1, table_name: "users" },
	});
	const insertResult = await runtime.execute({
		operation: "insert",
		payload: { insert_body: { email: "a@b.c" }, table_name: "users" },
	});
	const updateResult = await runtime.execute({
		operation: "update",
		payload: {
			conditions: [{ column: "id", operator: "eq", value: "1" }],
			table_name: "users",
			update_body: { email: "b@c.d" },
		},
	});
	const deleteResult = await runtime.execute({
		operation: "delete",
		payload: {
			conditions: [{ column: "id", operator: "eq", value: "1" }],
			table_name: "users",
		},
	});

	assert.equal(fetchResult.ok, true);
	assert.equal(insertResult.ok, true);
	assert.equal(updateResult.ok, true);
	assert.equal(deleteResult.ok, true);
	assert.deepEqual(
		transport.calls.map((call) => call.op),
		["fetch", "insert", "update", "delete"],
	);
});

test("P1: one PG pool per runtime", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport,
	});
	await Promise.all([
		runtime.execute({ operation: "fetch", payload: { table_name: "a" } }),
		runtime.execute({ operation: "fetch", payload: { table_name: "b" } }),
	]);
	assert.equal(runtime.transport, transport);
	assert.equal(transport.calls.length, 2);
});

test("P1: trusted HTTP requires unsafeAllowUnauthenticated", () => {
	assert.throws(
		() =>
			createAthenaDataHandlers({
				databaseUrl: SAMPLE_PG,
				security: { mode: "trusted" },
			}),
		(error: unknown) =>
			error instanceof Error &&
			error.message.includes("unsafeAllowUnauthenticated"),
	);
});

test("P2: HTTP encode uses PostgreSQL hex for bytea", async () => {
	const transport = createRecordingTransport();
	transport.fetchGateway = async () =>
		ok([{ raw_bytes: Buffer.from("athena-r0", "utf8") }]);
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport,
		unsafeAllowUnauthenticated: true,
	});
	const response = await handleAthenaGatewayRequest(
		new Request("http://localhost/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "blobs" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		runtime,
	);
	const body = (await response.json()) as {
		data?: Array<{ raw_bytes?: unknown }>;
	};
	assert.equal(body.data?.[0]?.raw_bytes, "\\x617468656e612d7230");
});

test("P2: handleAthenaGatewayRequest preserves gateway fetch contract", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport,
		unsafeAllowUnauthenticated: true,
	});
	const response = await handleAthenaGatewayRequest(
		new Request("http://localhost/api/athena/gateway/fetch", {
			body: JSON.stringify({ limit: 2, table_name: "users" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		runtime,
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("x-athena-runtime"), "local");
	const body = (await response.json()) as { data?: unknown; ok?: boolean };
	assert.equal(body.ok, true);
	assert.ok(body.data);
	assert.equal(transport.calls[0]?.op, "fetch");
});

test("P2: raw SQL forbidden on Local Runtime HTTP", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport,
		unsafeAllowUnauthenticated: true,
	});
	const response = await handleAthenaGatewayRequest(
		new Request("http://localhost/api/athena/gateway/query", {
			body: JSON.stringify({ query: "select 1" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		runtime,
	);
	assert.equal(response.status, 403);
	const body = (await response.json()) as {
		error?: { code?: string };
	};
	assert.equal(body.error?.code, "ATHENA_RAW_SQL_FORBIDDEN");
	assert.equal(
		transport.calls.some((call) => call.op === "query"),
		false,
	);
});

test("P3: browser URL contract hits Local Runtime", async () => {
	const transport = createRecordingTransport();
	const handlers = createAthenaDataHandlers({
		security: { mode: "trusted" },
		transport,
		unsafeAllowUnauthenticated: true,
	});
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/insert", {
			body: JSON.stringify({
				insert_body: { email: "n@e.w" },
				table_name: "users",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(response.status, 200);
	assert.equal(transport.calls[0]?.op, "insert");
});

test("P3: no Next imports in runtime/data or gateway/server", async () => {
	const roots = [join(SRC, "runtime", "data"), join(SRC, "gateway", "server")];
	for (const root of roots) {
		const names = await readdir(root);
		for (const name of names) {
			if (!name.endsWith(".ts")) {
				continue;
			}
			const source = await readFile(join(root, name), "utf8");
			assert.equal(
				/from\s+["']next(?:\/|$)/.test(source),
				false,
				`${name} must not import Next`,
			);
		}
	}
});
