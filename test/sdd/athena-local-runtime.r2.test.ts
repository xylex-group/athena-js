/**
 * R2 — Trusted principal / Athena session (target suite).
 */
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
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
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import { defineModel } from "../../src/schema/index.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";
import { readRuntimeErrorCode } from "../../src/runtime/data/errors.ts";
import type {
	AthenaPrincipal,
	AthenaRuntimeSessionLookup,
} from "../../src/runtime/data/principal.ts";
import type { AthenaRuntimeRequestContext } from "../../src/runtime/data/types.ts";

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

const SESSIONS: Record<string, AthenaRuntimeSessionLookup> = {
	sess_a: {
		session: {
			activeOrganizationId: "org_1",
			id: "session-a",
			userId: "user-a",
		},
		user: { id: "user-a", role: "member" },
	},
	sess_b: {
		session: { id: "session-b", userId: "user-b" },
		user: { id: "user-b", role: "member" },
	},
	sess_expired: {
		session: {
			expiresAt: "2000-01-01T00:00:00.000Z",
			id: "session-expired",
			userId: "user-a",
		},
		user: { id: "user-a" },
	},
	sess_banned: {
		session: { id: "session-banned", userId: "user-banned" },
		user: { banned: true, id: "user-banned" },
	},
};

async function lookupSession(
	token: string,
): Promise<AthenaRuntimeSessionLookup | null> {
	return SESSIONS[token] ?? null;
}

const FORGED_HEADERS = {
	"x-grants": "admin",
	"x-organization-id": "org_evil",
	"x-rights": "invoice.read",
	"x-role": "admin",
	"x-service": "billing-worker",
	"x-user-id": "user-b",
};

function sessionCookie(token: string): string {
	return `${ATHENA_AUTH_SESSION_COOKIE_NAME}=${token}`;
}

async function executeFetch(
	runtime: ReturnType<typeof createAthenaServerRuntime>,
	context?: AthenaRuntimeRequestContext,
) {
	const captured: AthenaRuntimeRequestContext = { ...context };
	const result = await runtime.execute(
		{ operation: "fetch", payload: { table_name: "users" } },
		captured,
	);
	return { captured, result };
}

test("R2-001 anonymous trusted mode works", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		auth: false,
		security: { mode: "trusted" },
		transport,
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: FORGED_HEADERS,
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.authority, "anonymous");
	assert.equal(captured.resolvedPrincipal?.principal.authenticated, false);
	assert.equal(transport.calls.length, 1);
});

test("R2-002 authenticated mode rejects missing principal", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport,
	});
	const { result } = await executeFetch(runtime);
	assert.equal(result.ok, false);
	assert.equal(readRuntimeErrorCode(result), "ATHENA_AUTH_REQUIRED");
	assert.equal(result.status, 401);
	assert.equal(transport.calls.length, 0);
});

test("R2-003 valid Athena session resolves user", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport,
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: { cookie: sessionCookie("sess_a") },
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.authority, "athena-session");
	assert.equal(captured.resolvedPrincipal?.principal.authenticated, true);
	assert.equal(captured.resolvedPrincipal?.principal.userId, "user-a");
	assert.equal(captured.resolvedPrincipal?.principal.sessionId, "session-a");
	assert.equal(captured.resolvedPrincipal?.principal.role, "member");
	assert.equal(captured.resolvedPrincipal?.principal.organizationId, "org_1");
	assert.deepEqual(captured.resolvedPrincipal?.principal.rights, []);
	assert.deepEqual(captured.resolvedPrincipal?.principal.grants, []);
});

test("R2-004 forged user header ignored", async () => {
	const runtime = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: {
			cookie: sessionCookie("sess_a"),
			"x-user-id": "user-b",
		},
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.principal.userId, "user-a");
});

test("R2-005 forged admin role ignored", async () => {
	const runtime = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: {
			cookie: sessionCookie("sess_a"),
			"x-role": "admin",
		},
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.principal.role, "member");
});

test("R2-006 forged rights ignored", async () => {
	const runtime = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: {
			cookie: sessionCookie("sess_a"),
			"x-grants": "superuser",
			"x-rights": "invoice.read",
		},
	});
	assert.equal(result.ok, true);
	assert.deepEqual(captured.resolvedPrincipal?.principal.rights, []);
	assert.deepEqual(captured.resolvedPrincipal?.principal.grants, []);
});

test("R2: custom resolver cannot claim service authority", async () => {
	const runtime = createAthenaServerRuntime({
		auth: {
			mode: "custom",
			resolvePrincipal: () => ({
				authority: "service",
				principal: {
					authenticated: true,
					grants: [],
					rights: ["invoice.read"],
					userId: "custom-user",
				},
			}),
		},
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: FORGED_HEADERS,
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.authority, "custom-trusted");
	assert.equal(captured.resolvedPrincipal?.principal.userId, "custom-user");
	assert.equal(captured.resolvedPrincipal?.principal.service, undefined);
});

test("R2: configured service principal ignores request x-service", async () => {
	const servicePrincipal: AthenaPrincipal = {
		authenticated: true,
		grants: [],
		rights: [],
		service: "billing-worker",
	};
	const serviceRuntime = createAthenaServerRuntime({
		auth: { mode: "service", principal: servicePrincipal },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(serviceRuntime, {
		headers: { "x-service": "other-worker" },
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.authority, "service");
	assert.equal(captured.resolvedPrincipal?.principal.service, "billing-worker");

	const anonymousRuntime = createAthenaServerRuntime({
		auth: false,
		security: { mode: "trusted" },
		transport: createRecordingTransport(),
	});
	const forged = await executeFetch(anonymousRuntime, {
		headers: { "x-service": "billing-worker" },
	});
	assert.equal(forged.result.ok, true);
	assert.equal(forged.captured.resolvedPrincipal?.authority, "anonymous");
	assert.equal(forged.captured.resolvedPrincipal?.principal.service, undefined);
});

test("R2-009 invalid session fails closed", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport,
	});
	const missing = await executeFetch(runtime, {
		headers: { cookie: sessionCookie("sess_unknown") },
	});
	assert.equal(
		readRuntimeErrorCode(missing.result),
		"ATHENA_AUTH_INVALID_SESSION",
	);
	assert.equal(missing.result.status, 401);

	const expired = await executeFetch(runtime, {
		headers: { cookie: sessionCookie("sess_expired") },
	});
	assert.equal(
		readRuntimeErrorCode(expired.result),
		"ATHENA_AUTH_SESSION_EXPIRED",
	);

	const banned = await executeFetch(runtime, {
		headers: { cookie: sessionCookie("sess_banned") },
	});
	assert.equal(
		readRuntimeErrorCode(banned.result),
		"ATHENA_AUTH_INVALID_SESSION",
	);
	assert.equal(transport.calls.length, 0);
});

test("R2-011 organization membership is verified", async () => {
	const denied = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const unverified = await executeFetch(denied, {
		headers: {
			cookie: sessionCookie("sess_a"),
			"x-organization-id": "org_2",
		},
	});
	assert.equal(
		readRuntimeErrorCode(unverified.result),
		"ATHENA_AUTH_ORG_NOT_ALLOWED",
	);
	assert.equal(unverified.result.status, 403);

	const allowed = createAthenaServerRuntime({
		auth: {
			lookupSession,
			mode: "athena-session",
			verifyOrganizationMembership: ({ organizationId, userId }) =>
				userId === "user-a" && organizationId === "org_2",
		},
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const verified = await executeFetch(allowed, {
		headers: {
			cookie: sessionCookie("sess_a"),
			"x-organization-id": "org_2",
		},
	});
	assert.equal(verified.result.ok, true);
	assert.equal(
		verified.captured.resolvedPrincipal?.principal.organizationId,
		"org_2",
	);
});

test("R2-012 concurrent users do not share request state", async () => {
	const runtime = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const [first, second] = await Promise.all([
		executeFetch(runtime, { headers: { cookie: sessionCookie("sess_a") } }),
		executeFetch(runtime, { headers: { cookie: sessionCookie("sess_b") } }),
	]);
	assert.equal(first.captured.resolvedPrincipal?.principal.userId, "user-a");
	assert.equal(second.captured.resolvedPrincipal?.principal.userId, "user-b");
	assert.notEqual(
		first.captured.resolvedPrincipal,
		second.captured.resolvedPrincipal,
	);
});

test("R2: next/client source stays free of runtime/data", async () => {
	const client = await readFile(
		new URL("../../src/next/client.ts", import.meta.url),
		"utf8",
	);
	const core = await readFile(
		new URL("../../src/v3-client-core.ts", import.meta.url),
		"utf8",
	);
	const browser = await readFile(
		new URL("../../src/browser.ts", import.meta.url),
		"utf8",
	);
	for (const source of [client, core, browser]) {
		assert.equal(source.includes('from "pg"'), false);
		assert.equal(source.includes("runtime/data"), false);
		assert.equal(source.includes("auth/local/runtime"), false);
	}
});

test("R2: anonymous request plus admin header stays anonymous", async () => {
	const runtime = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "policy" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: { "x-role": "admin", "x-user-id": "user-b" },
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.authority, "anonymous");
	assert.equal(captured.resolvedPrincipal?.principal.role, undefined);
});

test("R2: authenticated + auth false is invalid config", () => {
	assert.throws(
		() =>
			createAthenaServerRuntime({
				auth: false,
				security: { mode: "authenticated" },
				transport: createRecordingTransport(),
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.message.includes("ATHENA_AUTH_CONFIG_INVALID"),
	);
});

test("R2: custom resolver exceptions normalize", async () => {
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		auth: {
			mode: "custom",
			resolvePrincipal: () => {
				throw new Error("secret connection string postgres://inner");
			},
		},
		security: { mode: "authenticated" },
		transport,
	});
	const { result } = await executeFetch(runtime);
	assert.equal(
		readRuntimeErrorCode(result),
		"ATHENA_AUTH_PRINCIPAL_RESOLUTION_FAILED",
	);
	assert.equal(result.error?.includes("postgres://"), false);
	assert.equal(transport.calls.length, 0);
});

test("R2: HTTP handlers resolve session and ignore forged identity", async () => {
	const transport = createRecordingTransport();
	const handlers = createAthenaDataHandlers({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport,
	});
	const response = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "users" }),
			headers: {
				"content-type": "application/json",
				cookie: sessionCookie("sess_a"),
				"x-role": "admin",
				"x-user-id": "user-b",
			},
			method: "POST",
		}),
	);
	assert.equal(response.status, 200);
	assert.equal(transport.calls.length, 1);

	const denied = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "users" }),
			headers: {
				"content-type": "application/json",
				"x-user-id": "user-a",
			},
			method: "POST",
		}),
	);
	assert.equal(denied.status, 401);
	const body = (await denied.json()) as { error?: { code?: string } };
	assert.equal(body.error?.code, "ATHENA_AUTH_REQUIRED");
});

test("R2: bearer token is accepted as a session credential", async () => {
	const runtime = createAthenaServerRuntime({
		auth: { lookupSession, mode: "athena-session" },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: { authorization: "Bearer sess_a" },
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.principal.userId, "user-a");
});

const usersModel = defineModel<{ email: string; id: string }>({
	meta: {
		columns: {
			email: { kind: "string" },
			id: { kind: "string" },
		},
		model: "users",
		primaryKey: ["id"],
		schema: "public",
		tableName: "users",
	},
});

async function seedAuthStores(): Promise<MemoryAuthStores> {
	const stores = new MemoryAuthStores();
	await stores.createUser({
		email: "a@example.com",
		id: "user-a",
		name: "User A",
	});
	await stores.updateUser("user-a", { role: "member" });
	await stores.createSession({
		activeOrganizationId: "org_1",
		expiresAt: new Date(Date.now() + 60_000),
		id: "session-a",
		token: "sess_store_a",
		userId: "user-a",
	});
	await stores.addMember({
		id: "member-a-org1",
		organizationId: "org_1",
		role: "member",
		userId: "user-a",
	});
	await stores.addMember({
		id: "member-a-org2",
		organizationId: "org_2",
		role: "member",
		userId: "user-a",
	});
	return stores;
}

test("R2-007 service identity cannot come from HTTP", async () => {
	const runtime = createAthenaServerRuntime({
		auth: false,
		security: { mode: "trusted" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: { "x-service": "billing-worker" },
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.authority, "anonymous");
	assert.equal(captured.resolvedPrincipal?.principal.service, undefined);
});

test("R2-008 custom trusted resolver works", async () => {
	const runtime = createAthenaServerRuntime({
		auth: {
			mode: "custom",
			resolvePrincipal: () => ({
				authority: "anonymous",
				principal: {
					authenticated: true,
					grants: [],
					rights: [],
					userId: "hook-user",
				},
			}),
		},
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(runtime);
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.authority, "custom-trusted");
	assert.equal(captured.resolvedPrincipal?.principal.userId, "hook-user");
});

test("R2-010 anonymous principal is explicit", async () => {
	const runtime = createAthenaServerRuntime({
		auth: false,
		security: { mode: "trusted" },
		transport: createRecordingTransport(),
	});
	const { captured, result } = await executeFetch(runtime);
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.authority, "anonymous");
	assert.equal(captured.resolvedPrincipal?.principal.authenticated, false);
	assert.deepEqual(captured.resolvedPrincipal?.principal.rights, []);
	assert.deepEqual(captured.resolvedPrincipal?.principal.grants, []);
});

test("R2-013 resolver exception produces stable public error", async () => {
	const runtime = createAthenaServerRuntime({
		auth: {
			mode: "custom",
			resolvePrincipal: () => {
				throw new Error("DATABASE_URL=postgres://secret");
			},
		},
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const { result } = await executeFetch(runtime);
	assert.equal(
		readRuntimeErrorCode(result),
		"ATHENA_AUTH_PRINCIPAL_RESOLUTION_FAILED",
	);
	assert.equal(String(result.error).includes("postgres://"), false);
	assert.equal(String(result.error).includes("DATABASE_URL"), false);
});

test("R2-014 browser / RN dependency graph remains Node-safe", async () => {
	const rn = await readFile(
		new URL("../../src/react-native/index.ts", import.meta.url),
		"utf8",
	);
	const principal = await readFile(
		new URL("../../src/runtime/data/principal.ts", import.meta.url),
		"utf8",
	);
	assert.equal(rn.includes('from "pg"'), false);
	assert.equal(rn.includes("runtime/data"), false);
	assert.equal(principal.includes('from "pg"'), false);
	assert.equal(principal.includes("auth/local/runtime"), false);
	assert.equal(principal.includes("auth/local/database"), false);
});

test('R2: { mode: "athena-session" } without stores or databaseUrl is invalid', () => {
	assert.throws(
		() =>
			createAthenaServerRuntime({
				auth: { mode: "athena-session" },
				security: { mode: "authenticated" },
				transport: createRecordingTransport(),
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.message.includes("ATHENA_AUTH_CONFIG_INVALID"),
	);
});

test('R2: Auth stores back { mode: "athena-session" } without lookupSession', async () => {
	const stores = await seedAuthStores();
	const transport = createRecordingTransport();
	const runtime = createAthenaServerRuntime({
		auth: { mode: "athena-session", stores },
		models: { usersModel },
		security: { mode: "authenticated" },
		transport,
	});
	const { captured, result } = await executeFetch(runtime, {
		headers: {
			cookie: sessionCookie("sess_store_a"),
			"x-role": "admin",
			"x-user-id": "user-b",
		},
	});
	assert.equal(result.ok, true);
	assert.equal(captured.resolvedPrincipal?.authority, "athena-session");
	assert.equal(captured.resolvedPrincipal?.principal.userId, "user-a");
	assert.equal(captured.resolvedPrincipal?.principal.role, "member");
	assert.equal(captured.resolvedPrincipal?.principal.organizationId, "org_1");
});

test("R2: Auth store membership verifies organization hint", async () => {
	const stores = await seedAuthStores();
	const runtime = createAthenaServerRuntime({
		auth: { mode: "athena-session", stores },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	const allowed = await executeFetch(runtime, {
		headers: {
			cookie: sessionCookie("sess_store_a"),
			"x-organization-id": "org_2",
		},
	});
	assert.equal(allowed.result.ok, true);
	assert.equal(
		allowed.captured.resolvedPrincipal?.principal.organizationId,
		"org_2",
	);

	const denied = await executeFetch(runtime, {
		headers: {
			cookie: sessionCookie("sess_store_a"),
			"x-organization-id": "org_evil",
		},
	});
	assert.equal(
		readRuntimeErrorCode(denied.result),
		"ATHENA_AUTH_ORG_NOT_ALLOWED",
	);
});

test("R2: createAthenaDataHandlers athena-session is identity-authoritative", async () => {
	const stores = await seedAuthStores();
	const transport = createRecordingTransport();
	const handlers = createAthenaDataHandlers({
		auth: { mode: "athena-session", stores },
		models: { usersModel },
		security: { mode: "authenticated" },
		transport,
	});
	const okResponse = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "users" }),
			headers: {
				"content-type": "application/json",
				cookie: sessionCookie("sess_store_a"),
				"x-user-id": "user-b",
			},
			method: "POST",
		}),
	);
	assert.equal(okResponse.status, 200);

	const missing = await handlers.POST(
		new Request("https://app.example/api/athena/gateway/fetch", {
			body: JSON.stringify({ table_name: "users" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(missing.status, 401);
	const body = (await missing.json()) as { error?: { code?: string } };
	assert.equal(body.error?.code, "ATHENA_AUTH_REQUIRED");
});

test('R2: { mode: "athena-session" } + databaseUrl materializes without lookupSession', () => {
	const handlers = createAthenaDataHandlers({
		auth: { mode: "athena-session" },
		databaseUrl: "postgres://athena:athena@127.0.0.1:5432/athena_r2_unused",
		models: { usersModel },
		security: { mode: "authenticated" },
		transport: createRecordingTransport(),
	});
	assert.equal(typeof handlers.POST, "function");
});
