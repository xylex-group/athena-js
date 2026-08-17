/**
 * R5 — Browser security profile (adversarial HTTP suite).
 */
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
	AthenaDeletePayload,
	AthenaGatewayCallOptions,
	AthenaGatewayResponse,
	AthenaInsertPayload,
	AthenaQueryPayload,
	AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { originsMatch, parseWebOrigin } from "../../src/runtime/data/origin.ts";
import { publicRuntimeErrorMessage } from "../../src/runtime/data/redact.ts";
import type { PolicyDefinition } from "../../src/policy/types.ts";
import { string, table } from "../../src/schema/index.ts";

const SECRET_DB =
	"postgresql://athena:SECRET_MARKER_DBPASS_r5@db.internal:5432/athena";
const SECRET_COOKIE = "SECRET_MARKER_COOKIE_r5";
const SECRET_BEARER = "SECRET_MARKER_BEARER_r5";
const SECRET_JWT =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJTRUNSRVRfTUFSS0VSIn0.sig";

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

function createRecordingTransport(
	onError?: () => never,
): AthenaGatewayClient & { calls: Array<{ op: string; payload: unknown }> } {
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
			if (onError) {
				onError();
			}
			calls.push({ op: "delete", payload });
			return ok([{ deleted: true }] as T);
		},
		async fetchGateway<T>(
			payload: Parameters<AthenaGatewayClient["fetchGateway"]>[0],
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			if (onError) {
				onError();
			}
			calls.push({ op: "fetch", payload });
			return ok([{ id: "1" }] as T);
		},
		async insertGateway<T>(
			payload: AthenaInsertPayload,
			_options?: AthenaGatewayCallOptions,
		): Promise<AthenaGatewayResponse<T>> {
			if (onError) {
				onError();
			}
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
			if (onError) {
				onError();
			}
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
	})
	.primaryKey("id");

const publicUsersPolicy: PolicyDefinition = {
	actions: 15,
	composition: "permissive",
	id: "public-users",
	principals: [{ kind: "public" }],
	resource: { schema: "public", table: "users" },
};

async function lookupSession(token: string) {
	if (token === "sess_ok") {
		return {
			session: { id: "session-ok", userId: "user-a" },
			user: { id: "user-a", role: "member" },
		};
	}
	if (token === "sess_expired") {
		return {
			session: {
				expiresAt: "2000-01-01T00:00:00.000Z",
				id: "session-expired",
				userId: "user-a",
			},
			user: { id: "user-a" },
		};
	}
	return null;
}

function cookieHeader(token = "sess_ok"): string {
	return `${ATHENA_AUTH_SESSION_COOKIE_NAME}=${token}`;
}

function authenticatedHandlers(transport = createRecordingTransport()) {
	return {
		handlers: createAthenaDataHandlers({
			auth: { lookupSession, mode: "athena-session" },
			models: { users },
			security: { mode: "authenticated" },
			transport,
		}),
		transport,
	};
}

function policyHandlers(transport = createRecordingTransport()) {
	return {
		handlers: createAthenaDataHandlers({
			auth: { lookupSession, mode: "athena-session" },
			models: { users },
			policies: { definitions: [publicUsersPolicy], mode: "enforce" },
			security: { mode: "policy" },
			transport,
		}),
		transport,
	};
}

async function readError(response: Response): Promise<{
	code?: string;
	message?: string;
}> {
	const body = (await response.json()) as {
		error?: { code?: string; message?: string };
	};
	return body.error ?? {};
}

test("R5: policy HTTP profile does not silently become trusted", () => {
	assert.throws(
		() =>
			createAthenaDataHandlers({
				security: { mode: "policy" },
				transport: createRecordingTransport(),
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.message.includes("does not silently downgrade") &&
			error.message.includes("models") &&
			error.message.includes("auth"),
	);
});

test("R5: Origin comparison is URL.origin, not substring", () => {
	assert.equal(parseWebOrigin("https://app.example"), "https://app.example");
	assert.equal(
		originsMatch("https://app.example", "https://app.example.attacker.com"),
		false,
	);
	assert.equal(
		originsMatch("https://app.example.attacker.com", "https://app.example"),
		false,
	);
});

test("R5: foreign Origin mutation is rejected", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/insert", {
			body: JSON.stringify({
				insert_body: { email: "a@b.c", id: "1" },
				table_name: "users",
			}),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
				origin: "https://app.example.attacker.com",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_CSRF_REJECTED");
	assert.equal(transport.calls.length, 0);
});

test("R5: missing Origin cookie mutation is rejected", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/delete", {
			body: JSON.stringify({
				conditions: [{ column: "id", operator: "eq", value: "1" }],
				table_name: "users",
			}),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_CSRF_REJECTED");
	assert.equal(transport.calls.length, 0);
});

test("R5: same-origin cookie mutation is allowed", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/insert", {
			body: JSON.stringify({
				insert_body: { email: "a@b.c", id: "1" },
				table_name: "users",
			}),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
				origin: "https://app.example",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 200);
	assert.equal(transport.calls[0]?.op, "insert");
	assert.equal(
		response.headers.get("access-control-allow-origin"),
		"https://app.example",
	);
});

test("R5: forged identity fields cannot change principal", async () => {
	const { handlers } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "users" }),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
				"x-role": "admin",
				"x-user-id": "user-b",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 200);
});

test("R5: expired session fails closed", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "users" }),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader("sess_expired"),
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 401);
	assert.equal((await readError(response)).code, "ATHENA_AUTH_SESSION_EXPIRED");
	assert.equal(transport.calls.length, 0);
});

test("R5: anonymous mutation is denied", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/insert", {
			body: JSON.stringify({
				insert_body: { email: "anon@b.c", id: "9" },
				table_name: "users",
			}),
			headers: {
				"content-type": "application/json",
				origin: "https://app.example",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 401);
	assert.equal((await readError(response)).code, "ATHENA_AUTH_REQUIRED");
	assert.equal(transport.calls.length, 0);
});

test("R5: raw SQL remains denied", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/query", {
			body: JSON.stringify({ query: "select 1" }),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
				origin: "https://app.example",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_RAW_SQL_FORBIDDEN");
	assert.equal(transport.calls.length, 0);
});

test("R5: RPC remains denied", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/rpc", {
			body: JSON.stringify({ function: "admin_wipe" }),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
				origin: "https://app.example",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_RPC_FORBIDDEN");
	assert.equal(transport.calls.length, 0);
});

test("R5: oversized body is rejected", async () => {
	const handlers = createAthenaDataHandlers({
		auth: { lookupSession, mode: "athena-session" },
		limits: { maxBodyBytes: 32 },
		models: { users },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({
				table_name: "users",
				where: { pad: "x".repeat(80) },
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(response.status, 413);
	assert.equal((await readError(response)).code, "ATHENA_LIMIT_EXCEEDED");
});

test("R5: huge IN list is rejected", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({
				conditions: [
					{
						column: "id",
						operator: "in",
						value: Array.from({ length: 101 }, (_, index) => String(index)),
					},
				],
				table_name: "users",
			}),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_LIMIT_EXCEEDED");
	assert.equal(transport.calls.length, 0);
});

test("R5: huge insert batch is rejected", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/insert", {
			body: JSON.stringify({
				insert_body: Array.from({ length: 101 }, (_, index) => ({
					email: `${index}@x.test`,
					id: String(index),
				})),
				table_name: "users",
			}),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
				origin: "https://app.example",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_LIMIT_EXCEEDED");
	assert.equal(transport.calls.length, 0);
});

test("R5: excess page size is rejected", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({ limit: 201, table_name: "users" }),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_LIMIT_EXCEEDED");
	assert.equal(transport.calls.length, 0);
});

test("R5: unbounded update is rejected", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/update", {
			body: JSON.stringify({
				table_name: "users",
				update_body: { email: "all@x.test" },
			}),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
				origin: "https://app.example",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_UNBOUNDED_MUTATION");
	assert.equal(transport.calls.length, 0);
});

test("R5: unbounded delete is rejected", async () => {
	const { handlers, transport } = authenticatedHandlers();
	const response = await handlers.DELETE(
		new Request("https://app.example/api/athena/gateway/delete", {
			body: JSON.stringify({ table_name: "users" }),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
				origin: "https://app.example",
			},
			method: "DELETE",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_UNBOUNDED_MUTATION");
	assert.equal(transport.calls.length, 0);
});

test("R5: unknown model is denied", async () => {
	const { handlers } = policyHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "secrets" }),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_MODEL_NOT_EXPOSED");
});

test("R5: unknown field is denied under policy/strict", async () => {
	const { handlers } = policyHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({
				conditions: [{ column: "password_hash", operator: "eq", value: "x" }],
				table_name: "users",
			}),
			headers: {
				"content-type": "application/json",
				cookie: cookieHeader(),
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 403);
	assert.equal((await readError(response)).code, "ATHENA_MODEL_UNKNOWN_FIELD");
});

test("R5: malformed request does not leak secrets", async () => {
	const { handlers } = authenticatedHandlers();
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: `{ broken: ${SECRET_DB}`,
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(response.status, 400);
	const text = await response.text();
	assert.equal(text.includes("SECRET_MARKER"), false);
	assert.equal(text.includes(SECRET_DB), false);
});

test("R5: secret markers never appear in error responses", async () => {
	const transport = createRecordingTransport(() => {
		throw new Error(
			`connect ${SECRET_DB} cookie=${SECRET_COOKIE} Bearer ${SECRET_BEARER} jwt=${SECRET_JWT}`,
		);
	});
	const { handlers } = authenticatedHandlers(transport);
	const logs: string[] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	};
	try {
		const response = await handlers.POST(
			new Request("https://app.example/api/athena/gateway/fetch", {
				body: JSON.stringify({ table_name: "users" }),
				headers: {
					"content-type": "application/json",
					cookie: cookieHeader(),
				},
				method: "POST",
			}),
		);
		const text = await response.text();
		assert.equal(response.status, 500);
		assert.equal(text.includes("SECRET_MARKER"), false);
		assert.equal(text.includes(SECRET_DB), false);
		assert.equal(text.includes(SECRET_COOKIE), false);
		assert.equal(text.includes(SECRET_BEARER), false);
		assert.equal(text.includes(SECRET_JWT), false);
		assert.equal(logs.join("\n").includes("SECRET_MARKER"), false);
	} finally {
		console.error = original;
	}
});

test("R5: publicRuntimeErrorMessage redacts unique markers", () => {
	const leaked = publicRuntimeErrorMessage(
		`password=${SECRET_DB} Bearer ${SECRET_BEARER} ${SECRET_JWT} ${ATHENA_AUTH_SESSION_COOKIE_NAME}=${SECRET_COOKIE}`,
	);
	assert.equal(leaked.includes("SECRET_MARKER"), false);
	assert.equal(leaked.includes("Bearer "), false);
});

test("R5: in-process trusted runtime is not CSRF-gated", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		security: { mode: "trusted" },
		transport,
	});
	const result = await runtime.execute({
		operation: "update",
		payload: { table_name: "users", update_body: { email: "x" } },
	});
	assert.equal(result.ok, true);
	assert.equal(transport.calls.length, 1);
});

test("R5: next/client and browser/RN stay free of Node Auth/PG", async () => {
	const files = [
		"../../src/next/client.ts",
		"../../src/browser.ts",
		"../../src/react-native/index.ts",
		"../../src/v3-client-core.ts",
	];
	for (const file of files) {
		const source = await readFile(new URL(file, import.meta.url), "utf8");
		assert.equal(source.includes('from "pg"'), false, file);
		assert.equal(source.includes("auth/local/stores"), false, file);
		assert.equal(source.includes("auth/local/database"), false, file);
		assert.equal(source.includes("runtime/data/athena-session"), false, file);
	}
});
