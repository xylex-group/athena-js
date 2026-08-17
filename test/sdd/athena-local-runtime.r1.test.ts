/**
 * R1 — Models as Local Runtime resource authority.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
	AthenaDeletePayload,
	AthenaGatewayCallOptions,
	AthenaGatewayResponse,
	AthenaInsertPayload,
	AthenaQueryPayload,
	AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { handleAthenaGatewayRequest } from "../../src/gateway/server/adapter.ts";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import { defineModel, string, table } from "../../src/schema/index.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { readRuntimeErrorCode } from "../../src/runtime/data/errors.ts";

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

const users = table("users")
	.schema("public")
	.columns({
		email: string(),
		id: string(),
		name: string(),
	})
	.primaryKey("id");

const posts = defineModel<{
	author_id: string;
	id: string;
	title: string;
}>({
	meta: {
		columns: {
			author_id: { kind: "string" },
			id: { kind: "string" },
			title: { kind: "string" },
		},
		model: "posts",
		primaryKey: ["id"],
		relations: {
			author: {
				kind: "many-to-one",
				sourceColumns: ["author_id"],
				targetColumns: ["id"],
				targetModel: "users",
				targetSchema: "public",
			},
		},
		schema: "public",
		tableName: "posts",
	},
});

test("R1: off leaves unknown tables on the transport (M1 compatible)", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport,
	});
	assert.equal(runtime.capabilities.modelEnforcement, "off");
	const result = await runtime.execute({
		operation: "fetch",
		payload: { table_name: "secrets" },
	});
	assert.equal(result.ok, true);
	assert.equal(transport.calls[0]?.op, "fetch");
});

test("R1: unknown table rejected under known-only", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		modelEnforcement: "known-only",
		models: { users },
		security: { mode: "trusted" },
		transport,
	});
	const result = await runtime.execute({
		operation: "fetch",
		payload: { table_name: "secrets" },
	});
	assert.equal(result.ok, false);
	assert.equal(readRuntimeErrorCode(result), "ATHENA_MODEL_NOT_EXPOSED");
	assert.equal(transport.calls.length, 0);
});

test("R1: unknown schema-qualified resource rejected", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		modelEnforcement: "known-only",
		models: { users },
		security: { mode: "trusted" },
		transport,
	});
	const result = await runtime.execute({
		operation: "fetch",
		payload: { table_name: "other.users" },
	});
	assert.equal(result.ok, false);
	assert.equal(readRuntimeErrorCode(result), "ATHENA_MODEL_NOT_EXPOSED");
});

test("R1: known table accepted under known-only", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		modelEnforcement: "known-only",
		models: { users },
		security: { mode: "trusted" },
		transport,
	});
	const result = await runtime.execute({
		operation: "fetch",
		payload: { columns: ["nope"], table_name: "public.users" },
	});
	assert.equal(result.ok, true);
	assert.equal(transport.calls.length, 1);
});

test("R1: unknown field rejected in strict", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		modelEnforcement: "strict",
		models: { users },
		security: { mode: "trusted" },
		transport,
	});
	const result = await runtime.execute({
		operation: "fetch",
		payload: {
			columns: ["id", "password_hash"],
			table_name: "users",
		},
	});
	assert.equal(result.ok, false);
	assert.equal(readRuntimeErrorCode(result), "ATHENA_MODEL_UNKNOWN_FIELD");
	assert.equal(transport.calls.length, 0);
});

test("R1: known field accepted in strict", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		modelEnforcement: "strict",
		models: { users },
		security: { mode: "trusted" },
		transport,
	});
	const result = await runtime.execute({
		operation: "fetch",
		payload: {
			columns: ["id", "email"],
			conditions: [{ column: "email", operator: "eq", value: "a@b.c" }],
			table_name: "users",
		},
	});
	assert.equal(result.ok, true);
});

test("R1: relation lookup uses existing model relation metadata", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		modelEnforcement: "strict",
		models: { posts, users },
		security: { mode: "trusted" },
		transport,
	});
	const allowed = await runtime.execute({
		operation: "fetch",
		payload: {
			select: { author: true, id: true, title: true },
			table_name: "posts",
		},
	});
	assert.equal(allowed.ok, true);
	const denied = await runtime.execute({
		operation: "fetch",
		payload: {
			select: { comments: true, id: true },
			table_name: "posts",
		},
	});
	assert.equal(denied.ok, false);
	assert.equal(readRuntimeErrorCode(denied), "ATHENA_MODEL_UNKNOWN_RELATION");
	assert.equal(transport.calls.length, 1);
});

test("R1: duplicate resource mapping rejected at init", () => {
	const otherUsers = table("users")
		.schema("public")
		.columns({ id: string() })
		.primaryKey("id");
	assert.throws(
		() =>
			createAthenaServerRuntime({
				modelEnforcement: "known-only",
				models: { otherUsers, users },
				security: { mode: "trusted" },
				transport: createRecordingTransport(),
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.message.includes("ATHENA_MODEL_INVALID_REGISTRY"),
	);
});

test("R1: policy profile defaults to strict when models are provided", () => {
	const runtime = createAthenaServerRuntime({
		models: { users },
		security: { mode: "policy" },
		transport: createRecordingTransport(),
		unsafeAllowUnauthenticated: true,
	});
	assert.equal(runtime.capabilities.modelEnforcement, "strict");
});

test("R1: HTTP known-only surfaces ATHENA_MODEL_NOT_EXPOSED", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		modelEnforcement: "known-only",
		models: { users },
		security: { mode: "trusted" },
		transport,
		unsafeAllowUnauthenticated: true,
	});
	const response = await handleAthenaGatewayRequest(
		new Request("http://localhost/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "nope" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		runtime,
	);
	assert.equal(response.status, 403);
	const body = (await response.json()) as { error?: { code?: string } };
	assert.equal(body.error?.code, "ATHENA_MODEL_NOT_EXPOSED");
});
