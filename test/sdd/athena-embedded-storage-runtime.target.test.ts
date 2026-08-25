/**
 * Target dual-suite T1–T12 for Athena Embedded Storage Runtime.
 */
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import {
	parseAthenaRuntimeDiscoveryDocument,
	type AthenaRuntimeDiscoveryDocument,
} from "../../src/gateway/discovery-types.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { createPolicyRegistry } from "../../src/policy/registry.ts";
import { ACTION_BITS } from "../../src/policy/types.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { materializeStorage } from "../../src/runtime/materializers/storage.ts";
import type { AthenaStorageFileUploadInput } from "../../src/storage/file.ts";
import {
	bindStorageProvider,
	bindStorageRuntime,
	createStorageRuntime,
	DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT,
	decodeAthenaStorageBytes,
	executeStorageOverlay,
	getStorageProvider,
	isAthenaStorageBytesEnvelope,
	resolveBrowserStorageEndpoint,
} from "../../src/storage/runtime/index.ts";
import type {
	AuthorizedStorageOperation,
	StorageObjectProvider,
} from "../../src/storage/runtime/types.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import { createMockR2 } from "../helpers/d1-r2-mocks.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

const PRINCIPAL = {
	authenticated: true,
	grants: [] as const,
	rights: [parseAthenaRightKey("storage.*")],
	userId: "user_storage_sdd",
};

function mockTransport(): AthenaGatewayClient {
	const ok = async () =>
		({
			count: null,
			data: [],
			error: null,
			ok: true,
			raw: { data: [] },
			status: 200,
			statusText: "OK",
		}) as never;
	return {
		baseUrl: "https://athena.local/postgres-direct",
		buildHeaders() {
			return {};
		},
		deleteGateway: ok,
		fetchGateway: ok,
		insertGateway: ok,
		queryGateway: ok,
		async resolveCallOptions(options) {
			return options;
		},
		rpcGateway: ok,
		updateGateway: ok,
		async verifyConnection() {
			return { ok: true } as never;
		},
	};
}

function localRoot(): string {
	return mkdtempSync(join(tmpdir(), "athena-storage-sdd-t-"));
}

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

function asBytes(value: unknown): Uint8Array {
	const decoded = decodeAthenaStorageBytes(value);
	if (decoded) {
		return decoded;
	}
	if (typeof value === "string") {
		return new TextEncoder().encode(value);
	}
	if (value && typeof value === "object" && "body" in value) {
		return asBytes((value as { body: unknown }).body);
	}
	if (value && typeof value === "object" && "data" in value) {
		return asBytes((value as { data: unknown }).data);
	}
	throw new Error(`expected bytes, got ${typeof value}`);
}

test("T1: StorageRuntime exists internally; createStorageClient stays unpublished", async () => {
	const runtime = createStorageRuntime({
		provider: {
			async execute() {
				return { ok: true, status: 200, data: { key: "x" } };
			},
		},
	});
	assert.equal(typeof runtime.execute, "function");
	const pub = await import("../../src/index.ts");
	assert.equal("createStorageClient" in pub, false);
});

test("T2: provider port exists; local/r2 providers do not import Policy or Next", () => {
	const localSrc = readSrc("storage/runtime/providers/local-provider.ts");
	const r2Src = readSrc("storage/runtime/providers/r2-provider.ts");
	assert.match(localSrc, /StorageObjectProvider|AuthorizedStorageOperation/);
	assert.match(r2Src, /StorageObjectProvider|AuthorizedStorageOperation/);
	for (const src of [localSrc, r2Src]) {
		assert.equal(/from ["'].*policy\//.test(src), false);
		assert.equal(/from ["'].*next\//.test(src), false);
	}
});

test("T3: materializer returns a provider handle for local and r2", () => {
	const root = localRoot();
	const local = materializeStorage({
		storage: { provider: "local", root },
	});
	assert.ok(getStorageProvider(local.storage));

	const r2 = materializeStorage({
		storage: { r2: createMockR2() },
	});
	assert.ok(getStorageProvider(r2.storage));
});

test("T4: Nucleus executes object ops; unknown Policy action is denied", async () => {
	const root = localRoot();
	const materialized = materializeStorage({
		storage: { provider: "local", root },
	});
	const provider = getStorageProvider(materialized.storage);
	assert.ok(provider);
	const allowRead = createPolicyRegistry({
		definitions: [
			{
				actions: ACTION_BITS["storage.object.read"],
				composition: "permissive",
				id: "sto-read",
				principals: [{ kind: "authenticated" }],
				resource: { schema: "storage", table: "object" },
			},
		],
		mode: "enforce",
	});
	const runtime = createStorageRuntime({
		policies: allowRead,
		provider,
	});
	const denied = await runtime.execute(
		{ body: new TextEncoder().encode("nope"), key: "denied.txt", op: "put" },
		PRINCIPAL,
	);
	assert.equal(denied.ok, false);
	assert.equal(denied.error?.errorNumber, 3003);

	const open = createStorageRuntime({ provider });
	const put = await open.execute(
		{ body: new TextEncoder().encode("hello"), key: "ok.txt", op: "put" },
		PRINCIPAL,
	);
	assert.equal(put.ok, true);
	const got = await open.execute({ key: "ok.txt", op: "get" }, PRINCIPAL);
	assert.equal(got.ok, true);
	assert.equal(new TextDecoder().decode(asBytes(got.data)), "hello");
});

test("T5: lifecycle.storage is invoked around execute", async () => {
	const phases: string[] = [];
	const runtime = createStorageRuntime({
		lifecycle: {
			after: () => {
				phases.push("after");
			},
			before: () => {
				phases.push("before");
			},
		},
		provider: {
			async execute() {
				phases.push("provider");
				return { data: { key: "k" }, ok: true, status: 200 };
			},
		},
	});
	await runtime.execute({ key: "k", op: "get" }, PRINCIPAL);
	assert.deepEqual(phases, ["before", "provider", "after"]);
});

test("T6: createAthenaNextHandlers().storage is a method map", () => {
	const client = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
		gatewayTransport: mockTransport(),
		storage: { provider: "local", root: localRoot() },
	});
	const handlers = createAthenaNextHandlers({
		client,
		security: { mode: "trusted" },
		unsafeAllowUnauthenticated: true,
	});
	assert.equal(typeof handlers.storage.GET, "function");
	assert.equal(typeof handlers.storage.POST, "function");
});

test("T7: discovery endpoints.storage is a string and JSON has no secrets", async () => {
	const client = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
		gatewayTransport: mockTransport(),
		storage: { provider: "local", root: localRoot() },
	});
	const handlers = createAthenaNextHandlers({
		client,
		security: { mode: "trusted" },
		unsafeAllowUnauthenticated: true,
	});
	const response = await handlers.storage.GET(
		new Request("http://localhost/api/athena/storage"),
	);
	assert.equal(response.ok, true);
	const body = (await response.json()) as AthenaRuntimeDiscoveryDocument;
	assert.equal(typeof body.endpoints?.storage, "string");
	const parsed = parseAthenaRuntimeDiscoveryDocument(body);
	assert.equal(typeof parsed?.endpoints?.storage, "string");
	const json = JSON.stringify(body);
	assert.equal(/secret|password|accessKey|privateKey/i.test(json), false);
});

test("T8: browser transport uses /api/athena/storage or discovery endpoint", () => {
	assert.equal(DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT, "/api/athena/storage");
	assert.equal(resolveBrowserStorageEndpoint(undefined), "/api/athena/storage");
	assert.equal(
		resolveBrowserStorageEndpoint({ storage: "/custom/storage" }),
		"/custom/storage",
	);
});

test("T9: same operation identity server-direct vs HTTP", async () => {
	const root = localRoot();
	const client = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
		gatewayTransport: mockTransport(),
		storage: { provider: "local", root },
	});
	const internals = getAthenaClientInternals(client);
	const runtime = internals?.storageRuntime;
	assert.ok(runtime);
	const key = "same-op.bin";
	const payload = new TextEncoder().encode("same-bytes");
	const direct = await runtime.execute(
		{ body: payload, key, op: "put" },
		PRINCIPAL,
	);
	assert.equal(direct.ok, true);
	const handlers = createAthenaNextHandlers({
		auth: {
			lookupSession: async (token) =>
				token === "sess_storage"
					? {
							session: { id: "session-storage", userId: "user_storage_sdd" },
							user: {
								id: "user_storage_sdd",
								rights: ["storage.*"],
							},
						}
					: null,
			mode: "athena-session",
		},
		client,
		security: { mode: "authenticated" },
	});
	const sessionHeaders = {
		"content-type": "application/json",
		cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_storage`,
		origin: "http://localhost",
	};
	const httpPut = await handlers.storage.POST(
		new Request("http://localhost/api/athena/storage", {
			body: JSON.stringify({
				operation: "put",
				payload: {
					body: Buffer.from(payload).toString("base64"),
					key,
				},
			}),
			headers: sessionHeaders,
			method: "POST",
		}),
	);
	assert.equal(httpPut.ok, true);
	const httpGet = await handlers.storage.POST(
		new Request("http://localhost/api/athena/storage", {
			body: JSON.stringify({ operation: "get", payload: { key } }),
			headers: sessionHeaders,
			method: "POST",
		}),
	);
	assert.equal(httpGet.ok, true);
	const httpBody = (await httpGet.json()) as { data?: unknown };
	const viaHttp = asBytes(httpBody.data);
	const viaDirect = await runtime.execute({ key, op: "get" }, PRINCIPAL);
	assert.deepEqual(asBytes(viaDirect.data), viaHttp);
	assert.equal(new TextDecoder().decode(viaHttp), "same-bytes");
});

test("T13: Embedded Storage HTTP preserves binary bytes without UTF-8 decoding", async () => {
	const handlersSrc = readSrc("next/storage-handlers.ts");
	assert.equal(handlersSrc.includes("TextDecoder"), false);
	assert.match(handlersSrc, /serializeAthenaStorageData|athena\.storage\.bytes/);

	const objects = new Map<string, Uint8Array>();
	const provider: StorageObjectProvider = {
		async execute(op: AuthorizedStorageOperation) {
			if (op.op === "put" && op.key) {
				objects.set(op.key, op.body ?? new Uint8Array());
				return { data: { key: op.key }, ok: true, status: 200 };
			}
			if (op.op === "get" && op.key) {
				const body = objects.get(op.key);
				if (!body) {
					return {
						error: {
							code: "storage_file_not_found",
							errorNumber: 3005,
							message: "missing",
						},
						ok: false,
						status: 404,
					};
				}
				return { data: body, ok: true, status: 200 };
			}
			return {
				error: {
					code: "storage_invalid_request",
					errorNumber: 3000,
					message: `unsupported ${op.op}`,
				},
				ok: false,
				status: 400,
			};
		},
	};
	const runtime = createStorageRuntime({ provider });
	const client = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
		gatewayTransport: mockTransport(),
		storage: bindStorageRuntime(bindStorageProvider({}, provider), runtime),
	});
	const key = "binary.bin";
	const payload = Uint8Array.from([0, 127, 128, 255, 10]);
	assert.notDeepEqual(
		new TextEncoder().encode(new TextDecoder().decode(payload)),
		payload,
	);
	const put = await runtime.execute({ body: payload, key, op: "put" }, PRINCIPAL);
	assert.equal(put.ok, true);
	const handlers = createAthenaNextHandlers({
		auth: {
			lookupSession: async (token) =>
				token === "sess_storage"
					? {
							session: { id: "session-storage", userId: "user_storage_sdd" },
							user: {
								id: "user_storage_sdd",
								rights: ["storage.*"],
							},
						}
					: null,
			mode: "athena-session",
		},
		client,
		security: { mode: "authenticated" },
	});
	const sessionHeaders = {
		"content-type": "application/json",
		cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_storage`,
		origin: "http://localhost",
	};
	const httpGet = await handlers.storage.POST(
		new Request("http://localhost/api/athena/storage", {
			body: JSON.stringify({ operation: "get", payload: { key } }),
			headers: sessionHeaders,
			method: "POST",
		}),
	);
	assert.equal(httpGet.ok, true);
	const httpBody = (await httpGet.json()) as { data?: unknown };
	assert.equal(isAthenaStorageBytesEnvelope(httpBody.data), true);
	assert.deepEqual(asBytes(httpBody.data), payload);
	const rawGet = await handlers.storage.GET(
		new Request(
			`http://localhost/api/athena/storage?key=${encodeURIComponent(key)}`,
			{
				headers: {
					cookie: sessionHeaders.cookie,
					origin: sessionHeaders.origin,
				},
			},
		),
	);
	assert.equal(rawGet.ok, true);
	assert.match(rawGet.headers.get("content-type") ?? "", /octet-stream/i);
	assert.deepEqual(new Uint8Array(await rawGet.arrayBuffer()), payload);
});

test("T10: browser graph cannot materialize credentialed S3/R2", () => {
	const browser = readSrc("browser.ts");
	const core = readSrc("v3-client-core.ts");
	const transport = readSrc("storage/runtime/browser-transport.ts");
	for (const src of [browser, core, transport]) {
		assert.equal(src.includes("storage/local.ts"), false);
		assert.equal(/from ["']node:fs/.test(src), false);
		assert.equal(/secretAccessKey|aws_secret_access_key/.test(src), false);
	}
});

test("T11: upload input type allows omitted s3_id when runtime authorized", () => {
	const without: AthenaStorageFileUploadInput = {
		files: new Uint8Array(),
		name: "notes.txt",
		storage_key: "notes.txt",
	};
	assert.equal(without.s3_id, undefined);
});

test("T12: overlay path calls Nucleus, not the provider", async () => {
	const seen: string[] = [];
	const provider: StorageObjectProvider = {
		async execute(op: AuthorizedStorageOperation) {
			seen.push(`provider:${op.op}`);
			return { data: { key: op.key }, ok: true, status: 200 };
		},
	};
	const runtime = createStorageRuntime({
		lifecycle: {
			before: () => {
				seen.push("nucleus");
			},
		},
		provider,
	});
	await executeStorageOverlay(runtime, {
		key: "overlay.txt",
		op: "put",
		source: new TextEncoder().encode("via-nucleus"),
	});
	assert.ok(seen.includes("nucleus"));
	assert.ok(seen.some((item) => item.startsWith("provider:")));
});
