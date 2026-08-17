/**
 * R2 characterization — current trusted / unauthenticated Local Runtime identity.
 * These must stay GREEN after principal resolution lands.
 */
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { handleAthenaGatewayRequest } from "../../src/gateway/server/adapter.ts";
import type {
	AthenaDeletePayload,
	AthenaGatewayCallOptions,
	AthenaGatewayResponse,
	AthenaInsertPayload,
	AthenaQueryPayload,
	AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";

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

test("R2-C: trusted + auth false executes without a principal", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		auth: false,
		security: { mode: "trusted" },
		transport,
	});
	const result = await runtime.execute({
		operation: "fetch",
		payload: { table_name: "users" },
	});
	assert.equal(runtime.capabilities.auth, false);
	assert.equal(result.ok, true);
	assert.equal(transport.calls.length, 1);
});

test("R2-C: omitted auth remains disabled on trusted runtimes", () => {
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport: createRecordingTransport(),
	});
	assert.equal(runtime.capabilities.auth, false);
});

test("R2-C: trusted HTTP still requires unsafeAllowUnauthenticated", async () => {
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport: createRecordingTransport(),
	});
	const response = await handleAthenaGatewayRequest(
		new Request("http://localhost/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "users" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		runtime,
	);
	assert.equal(response.status, 403);
});

test("R2-C: next/client and browser core stay free of Local Runtime auth modules", async () => {
	const client = await readFile(
		new URL("../../src/next/client.ts", import.meta.url),
		"utf8",
	);
	const core = await readFile(
		new URL("../../src/v3-client-core.ts", import.meta.url),
		"utf8",
	);
	for (const source of [client, core]) {
		assert.equal(source.includes("runtime/data"), false);
		assert.equal(source.includes("auth/local/runtime"), false);
		assert.equal(source.includes("resolve-principal"), false);
	}
});
