/**
 * Target suite — Auth UI + Embedded Runtime Finality (SSOT, GREEN).
 *
 * Encodes protocol 1.1 runtime-capability discovery, plan-only handler ads,
 * ResolvedNextAthenaTopology auto-attach, diagnostic split, Auth UI consume-only,
 * and the four-step golden path. Does not rewrite inferEmbeddedAuthMode().
 * Supersedes auth-ui-embedded-runtime-finality.baseline.test.ts (deleted).
 *
 * Spec: docs/sdd/xylex/athena-auth-ui-embedded-runtime-finality/SPEC.md
 */
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { getAttachedAthenaAuthRouting } from "../../src/auth/resolve-routing.ts";
import {
	parseAthenaRuntimeDiscoveryDocument,
	type AthenaRuntimeDiscoveryDocument,
} from "../../src/gateway/discovery-types.ts";
import { isCompatibleAthenaRuntimeProtocol } from "../../src/gateway/protocol.ts";
import {
	createClient as createNextBrowserClient,
	resetAthenaDiscoverySessionCache,
} from "../../src/next/client.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { probeAthenaLocalRuntime } from "../../src/next/discovery.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { createClient } from "../../src/v3-client.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_finality_test";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SRC_ROOT = fileURLToPath(new URL("../../src/", import.meta.url));

const dataPrincipalDocument: AthenaRuntimeDiscoveryDocument = {
	athena: true,
	capabilities: {
		auth: false,
		delete: true,
		fetch: true,
		insert: true,
		models: "off",
		nestedRelations: false,
		policy: false,
		rawSql: false,
		rpc: false,
		update: true,
	},
	protocol: { major: 1, minor: 0 },
	runtime: "local",
	runtimeImplementation: "athena-js",
};

const protocol11AuthOn = {
	athena: true,
	capabilities: {
		auth: { available: true, transport: "same-origin" as const },
		data: true,
		delete: true,
		fetch: true,
		insert: true,
		models: "off" as const,
		nestedRelations: false,
		policy: false,
		rawSql: false,
		rpc: false,
		update: true,
	},
	endpoints: {
		auth: "/api/auth",
		data: "/api/athena",
	},
	protocol: { major: 1, minor: 1 },
	runtime: "next-local",
	runtimeImplementation: "athena-js",
};

const protocol11AuthOff = {
	...protocol11AuthOn,
	capabilities: {
		...protocol11AuthOn.capabilities,
		auth: { available: false },
	},
	endpoints: { data: "/api/athena" },
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function mockTransport() {
	const ok = async () =>
		({
			count: null,
			data: [{ id: "ok" }],
			error: null,
			ok: true,
			raw: { data: [{ id: "ok" }] },
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
		async resolveCallOptions(options: unknown) {
			return options;
		},
		rpcGateway: ok,
		updateGateway: ok,
		async verifyConnection() {
			return { ok: true } as never;
		},
	};
}

async function readSrc(relative: string): Promise<string> {
	return readFile(join(SRC_ROOT, relative), "utf8");
}

async function readRepo(relative: string): Promise<string> {
	return readFile(join(REPO_ROOT, relative), "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function authCapability(body: Record<string, unknown>): Record<string, unknown> {
	const caps = body.capabilities;
	assert.ok(isRecord(caps), "discovery document must include capabilities");
	assert.equal(
		typeof caps.auth === "object" && caps.auth !== null,
		true,
		"capabilities.auth must be { available, transport? }, not a Data principal scalar",
	);
	return caps.auth as Record<string, unknown>;
}

async function capabilitiesBody(
	handlers: ReturnType<typeof createAthenaNextHandlers>,
): Promise<Record<string, unknown>> {
	const response = await handlers.data.GET(
		new Request("http://localhost/api/athena/capabilities"),
	);
	assert.equal(response.ok, true, "capabilities GET must succeed");
	const body = (await response.json()) as unknown;
	assert.ok(isRecord(body), "capabilities body must be an object");
	return body;
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}
	if ("code" in error && typeof error.code === "string") {
		return error.code;
	}
	return undefined;
}

async function authAttemptCode(client: {
	auth: { getSession: () => Promise<unknown> };
}): Promise<string | undefined> {
	try {
		const result = await client.auth.getSession();
		if (isRecord(result)) {
			if (typeof result.error === "string") {
				return result.error;
			}
			if (isRecord(result.error) && typeof result.error.code === "string") {
				return result.error.code;
			}
			if (
				isRecord(result.errorDetails) &&
				typeof result.errorDetails.code === "string"
			) {
				return result.errorDetails.code;
			}
		}
		return undefined;
	} catch (error) {
		return errorCode(error);
	}
}

function withMockedFetch(
	handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): () => void {
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
		handler(String(input), init)) as typeof fetch;
	return () => {
		globalThis.fetch = original;
	};
}

function isApiAuthUrl(url: string): boolean {
	return /\/api\/auth(?:\/|$|\?)/.test(url) && !url.includes("/api/athena/auth");
}

// ---------------------------------------------------------------------------
// T-DOC-11 — Protocol 1.1 document
// ---------------------------------------------------------------------------

test("T-DOC-11: parser accepts 1.0 Data-only and 1.1 next-local + endpoints", () => {
	assert.ok(
		parseAthenaRuntimeDiscoveryDocument(dataPrincipalDocument),
		"1.0 runtime:local + scalar capabilities.auth must remain valid",
	);
	const parsed11 = parseAthenaRuntimeDiscoveryDocument(protocol11AuthOn);
	assert.ok(parsed11, "1.1 runtime:next-local + object capabilities.auth must parse");
	assert.equal(parsed11?.runtime, "next-local");
	assert.deepEqual(parsed11?.protocol, { major: 1, minor: 1 });
	assert.equal(isCompatibleAthenaRuntimeProtocol({ major: 1, minor: 1 }), true);
	assert.ok(
		isRecord(parsed11) && "endpoints" in parsed11,
		"1.1 document must retain endpoints",
	);
});

test("T-DOC-11: probe treats protocol 1.1 next-local as compatible Data+Auth runtime", async () => {
	const result = await probeAthenaLocalRuntime({
		fetchImpl: async (input) => {
			if (String(input).endsWith("/capabilities")) {
				return jsonResponse(protocol11AuthOn);
			}
			return new Response("missing", { status: 404 });
		},
		timeoutMs: 50,
	});
	assert.equal(result.status, "compatible");
	if (result.status === "compatible") {
		assert.equal(result.document.runtime, "next-local");
		assert.deepEqual(result.document.protocol, { major: 1, minor: 1 });
		assert.equal(result.endpoint, "/api/athena");
	}
});

// ---------------------------------------------------------------------------
// T-HAND-11 — handlers inspect AthenaClientInternals.plan only
// ---------------------------------------------------------------------------

test("T-HAND-11: createAthenaNextHandlers advertises 1.1 from plan, never re-infers", async () => {
	const handlersSrc = await readSrc("next/data-handlers.ts");
	assert.equal(
		handlersSrc.includes("inferEmbeddedAuthMode"),
		false,
		"adapter must not call inferEmbeddedAuthMode",
	);
	assert.match(
		handlersSrc,
		/plan\.auth\.runtime/,
		"adapter must read AthenaClientInternals.plan",
	);

	const client = createClient({
		auth: false,
		databaseUrl: SAMPLE_PG,
		env: { DATABASE_URL: SAMPLE_PG },
		gatewayTransport: mockTransport(),
	});
	try {
		assert.equal(getAthenaClientInternals(client)?.plan.auth.runtime, "disabled");
		const next = createAthenaNextHandlers({
			client,
			security: { mode: "trusted" },
			unsafeAllowUnauthenticated: true,
		});
		const body = await capabilitiesBody(next);
		assert.equal(body.runtime, "next-local");
		assert.deepEqual(body.protocol, { major: 1, minor: 1 });
		assert.equal(
			authCapability(body).available,
			false,
			"auth:false plan must win over env.DATABASE_URL (no second inference)",
		);
	} finally {
		void client.close();
	}
});

// ---------------------------------------------------------------------------
// T-HAND-12 — auth:false advertises unavailable
// ---------------------------------------------------------------------------

test("T-HAND-12: auth:false advertises auth.available=false and does not require Auth mount", async () => {
	const client = createClient({
		auth: false,
		databaseUrl: SAMPLE_PG,
		env: {},
		gatewayTransport: mockTransport(),
	});
	try {
		const next = createAthenaNextHandlers({
			client,
			security: { mode: "trusted" },
			unsafeAllowUnauthenticated: true,
		});
		const body = await capabilitiesBody(next);
		assert.equal(body.runtime, "next-local");
		assert.deepEqual(body.protocol, { major: 1, minor: 1 });
		const auth = authCapability(body);
		assert.equal(auth.available, false);
		const endpoints = isRecord(body.endpoints) ? body.endpoints : undefined;
		assert.equal(endpoints?.data, "/api/athena");
		assert.ok(
			endpoints?.auth == null || endpoints.auth === false,
			"disabled Auth must omit endpoints.auth",
		);
	} finally {
		void client.close();
	}
});

// ---------------------------------------------------------------------------
// T-HAND-13 — embedded / remote-proxied
// ---------------------------------------------------------------------------

test("T-HAND-13: embedded root advertises available + same-origin /api/auth", async () => {
	const client = createClient({
		databaseUrl: SAMPLE_PG,
		env: {},
		gatewayTransport: mockTransport(),
	});
	try {
		assert.equal(client.system.runtime().auth, "embedded");
		const next = createAthenaNextHandlers({
			client,
			security: { mode: "trusted" },
			unsafeAllowUnauthenticated: true,
		});
		const body = await capabilitiesBody(next);
		assert.equal(body.runtime, "next-local");
		assert.deepEqual(body.protocol, { major: 1, minor: 1 });
		assert.equal(isRecord(body.capabilities) && body.capabilities.data, true);
		const auth = authCapability(body);
		assert.equal(auth.available, true);
		assert.equal(auth.transport, "same-origin");
		assert.ok(isRecord(body.endpoints));
		assert.equal(body.endpoints.data, "/api/athena");
		assert.equal(body.endpoints.auth, "/api/auth");
		assert.equal(typeof next.auth.GET, "function");
	} finally {
		void client.close();
	}
});

test("T-HAND-13: remote-proxied root advertises available + same-origin /api/auth", async () => {
	const client = createClient({
		auth: {
			mode: "remote",
			routing: "same-origin",
			upstreamUrl: "https://auth.example.com",
		},
		databaseUrl: SAMPLE_PG,
		env: {},
		gatewayTransport: mockTransport(),
	});
	try {
		assert.equal(client.system.runtime().auth, "remote");
		const next = createAthenaNextHandlers({
			client,
			security: { mode: "trusted" },
			unsafeAllowUnauthenticated: true,
		});
		const body = await capabilitiesBody(next);
		assert.equal(body.runtime, "next-local");
		const auth = authCapability(body);
		assert.equal(auth.available, true);
		assert.equal(auth.transport, "same-origin");
		assert.equal(
			isRecord(body.endpoints) ? body.endpoints.auth : undefined,
			"/api/auth",
		);
	} finally {
		void client.close();
	}
});

// ---------------------------------------------------------------------------
// T-HAND-14 — remote-direct is not rewritten to same-origin
// ---------------------------------------------------------------------------

test("T-HAND-14: remote-direct (mode:remote + url) is not rewritten to same-origin", async () => {
	const client = createClient({
		auth: { mode: "remote", url: "https://auth.example.com" },
		databaseUrl: SAMPLE_PG,
		env: {},
		gatewayTransport: mockTransport(),
		key: "publishable",
	});
	try {
		assert.equal(client.system.runtime().auth, "remote");
		const next = createAthenaNextHandlers({
			client,
			security: { mode: "trusted" },
			unsafeAllowUnauthenticated: true,
		});
		const body = await capabilitiesBody(next);
		assert.equal(body.runtime, "next-local");
		assert.deepEqual(body.protocol, { major: 1, minor: 1 });
		const auth = authCapability(body);
		assert.notEqual(auth.transport, "same-origin");
		if (auth.available === true) {
			assert.equal(auth.transport, "remote");
		}
		assert.notEqual(
			isRecord(body.endpoints) ? body.endpoints.auth : undefined,
			"/api/auth",
		);

		resetAthenaDiscoverySessionCache();
		const restore = withMockedFetch((url) => {
			if (url.includes("/capabilities") || url.includes("/health")) {
				return jsonResponse(protocol11AuthOn);
			}
			return jsonResponse({ session: null, user: null });
		});
		try {
			const browser = createNextBrowserClient({
				auth: { mode: "remote", url: "https://auth.example.com" },
				topology: { discover: "next", fallback: "error" },
			});
			const diag = browser.system.inspectAuth();
			assert.ok(
				diag.browserRequestBaseUrl?.includes("auth.example.com"),
				`explicit remote url must win over discovered same-origin, got ${diag.browserRequestBaseUrl}`,
			);
			assert.equal(diag.browserRequestBaseUrl?.includes("/api/auth"), false);
		} finally {
			restore();
		}
	} finally {
		void client.close();
	}
});

// ---------------------------------------------------------------------------
// T-BRW-11 — ResolvedNextAthenaTopology
// ---------------------------------------------------------------------------

test("T-BRW-11: discover-next materializes ResolvedNextAthenaTopology without PG/embedded", async () => {
	const routingMod = (await import("../../src/auth/resolve-routing.ts")) as Record<
		string,
		unknown
	>;
	assert.equal(
		typeof routingMod.resolveExplicitAuthRouting,
		"function",
		"resolveExplicitAuthRouting must exist as a thin explicit-routing extract",
	);

	const topologySrc = await readSrc("next/topology.ts");
	const clientSrc = await readSrc("next/client.ts");
	assert.ok(
		topologySrc.includes("ResolvedNextAthenaTopology") ||
			clientSrc.includes("ResolvedNextAthenaTopology"),
		"browser discovery must materialize internal ResolvedNextAthenaTopology",
	);
	assert.equal(
		topologySrc.includes("inferEmbeddedAuthMode"),
		false,
		"topology must not re-infer embedded Auth",
	);
	assert.equal(clientSrc.includes("inferEmbeddedAuthMode"), false);

	resetAthenaDiscoverySessionCache();
	const restore = withMockedFetch((url) => {
		if (url.includes("/capabilities") || url.includes("/health")) {
			return jsonResponse(protocol11AuthOn);
		}
		return jsonResponse({ data: [], ok: true });
	});
	try {
		const client = createNextBrowserClient({
			topology: { discover: "next", fallback: "error" },
		});
		const internals = getAthenaClientInternals(client);
		assert.notEqual(internals?.plan.auth.runtime, "embedded");
		assert.notEqual(internals?.plan.db.transport, "postgres");
		assert.equal(
			JSON.stringify(internals?.plan ?? {}).includes(SAMPLE_PG),
			false,
			"browser must never store PostgreSQL / embedded runtime state",
		);
	} finally {
		restore();
	}
});

// ---------------------------------------------------------------------------
// T-BRW-12 — auto-attach without auth.routing
// ---------------------------------------------------------------------------

test("T-BRW-12: discover-next without auth.routing attaches usable athena.auth at /api/auth", async () => {
	const clientSrc = await readSrc("next/client.ts");
	assert.match(
		clientSrc,
		/resolveExplicitAuthRouting/,
		"browser attach path must use resolveExplicitAuthRouting(config.auth) ?? topology.auth",
	);
	assert.match(clientSrc, /attachAthenaAuthRouting/);

	resetAthenaDiscoverySessionCache();
	const urls: string[] = [];
	const restore = withMockedFetch((url) => {
		urls.push(url);
		if (url.includes("/capabilities") || url.includes("/health")) {
			return jsonResponse(protocol11AuthOn);
		}
		return jsonResponse({ session: null, user: null });
	});
	try {
		const client = createNextBrowserClient({
			topology: { discover: "next", fallback: "error" },
		});
		const diag = client.system.inspectAuth();
		assert.ok(
			diag.browserRequestBaseUrl === "/api/auth" ||
				diag.browserRequestBaseUrl?.endsWith("/api/auth"),
			`expected same-origin /api/auth, got ${diag.browserRequestBaseUrl}`,
		);
		assert.equal(
			diag.browserRequestBaseUrl?.includes("/api/athena/auth"),
			false,
			"legacy Data-tree fold ${dataUrl}/auth must not win",
		);
		assert.notEqual(diag.mode, "legacy");

		const attached = getAttachedAthenaAuthRouting(client);
		assert.ok(attached, "attachAthenaAuthRouting must run from discovered topology");
		assert.ok(
			attached.browserRequestBaseUrl === "/api/auth" ||
				attached.browserRequestBaseUrl.endsWith("/api/auth"),
		);

		const code = await authAttemptCode(client);
		assert.notEqual(code, "ATHENA_SERVICE_NOT_CONFIGURED");
		assert.ok(
			urls.some(isApiAuthUrl),
			`getSession must target /api/auth, got ${urls.join(", ")}`,
		);
		assert.equal(
			urls.some((url) => url.includes("/api/athena/auth")),
			false,
		);
	} finally {
		restore();
	}
});

// ---------------------------------------------------------------------------
// T-ERR-11 — diagnostic split
// ---------------------------------------------------------------------------

test("T-ERR-11: ATHENA_DISCOVERY_UNAVAILABLE is Data-probe failure", async () => {
	const errorsSrc = await readSrc("config/errors.ts");
	const typesSrc = await readSrc("gateway/types.ts");
	const topologySrc = await readSrc("next/topology.ts");
	assert.match(
		`${errorsSrc}\n${typesSrc}\n${topologySrc}`,
		/ATHENA_AUTH_NOT_AVAILABLE/,
		"ATHENA_AUTH_NOT_AVAILABLE must exist as a first-class diagnostic",
	);

	resetAthenaDiscoverySessionCache();
	const restore = withMockedFetch(() => new Response("nope", { status: 404 }));
	try {
		const client = createNextBrowserClient({
			topology: { discover: "next", fallback: "error" },
		});
		const result = await client.from("users").select();
		assert.equal(result.error?.code, "ATHENA_DISCOVERY_UNAVAILABLE");
		assert.notEqual(result.error?.code, "ATHENA_AUTH_NOT_AVAILABLE");
	} finally {
		restore();
	}
});

test("T-ERR-11: Data-ok / Auth-off is ATHENA_AUTH_NOT_AVAILABLE, not discovery failure", async () => {
	resetAthenaDiscoverySessionCache();
	const restore = withMockedFetch((url) => {
		if (url.includes("/capabilities") || url.includes("/health")) {
			return jsonResponse(protocol11AuthOff);
		}
		if (isApiAuthUrl(url)) {
			return jsonResponse({ error: "ATHENA_AUTH_NOT_AVAILABLE" }, 404);
		}
		return jsonResponse({ data: [{ id: "ok" }], ok: true });
	});
	try {
		const client = createNextBrowserClient({
			topology: { discover: "next", fallback: "error" },
		});
		const data = await client.from("users").select();
		assert.notEqual(data.error?.code, "ATHENA_DISCOVERY_UNAVAILABLE");
		assert.notEqual(data.error?.gatewayCode, "ATHENA_DISCOVERY_UNAVAILABLE");

		const code = await authAttemptCode(client);
		assert.equal(code, "ATHENA_AUTH_NOT_AVAILABLE");
		assert.notEqual(code, "ATHENA_DISCOVERY_UNAVAILABLE");
		assert.notEqual(code, "ATHENA_SERVICE_NOT_CONFIGURED");
	} finally {
		restore();
	}
});

test("T-ERR-11: 1.0 Data-only document never implies Auth endpoints", async () => {
	resetAthenaDiscoverySessionCache();
	const restore = withMockedFetch((url) => {
		if (url.includes("/capabilities") || url.includes("/health")) {
			return jsonResponse(dataPrincipalDocument);
		}
		return jsonResponse({ data: [{ id: "ok" }], ok: true });
	});
	try {
		const client = createNextBrowserClient({
			topology: { discover: "next", fallback: "error" },
		});
		const data = await client.from("users").select();
		assert.notEqual(data.error?.code, "ATHENA_DISCOVERY_UNAVAILABLE");
		const code = await authAttemptCode(client);
		assert.equal(code, "ATHENA_AUTH_NOT_AVAILABLE");
	} finally {
		restore();
	}
});

// ---------------------------------------------------------------------------
// T-UI-11 — Auth UI consume-only
// ---------------------------------------------------------------------------

test("T-UI-11: resolveAuthUiClient / AthenaProviders consume discovered auth", async () => {
	const clientSrc = await readRepo(
		"packages/athena-auth-ui/packages/heroui/src/lib/athena/client.ts",
	);
	const resolveFn = clientSrc.slice(
		clientSrc.indexOf("export function resolveAuthUiClient"),
		clientSrc.indexOf("export function createAthenaAuthClient"),
	);
	assert.match(resolveFn, /export function resolveAuthUiClient/);
	assert.equal(resolveFn.includes("DATABASE_URL"), false);
	assert.equal(resolveFn.includes("inferEmbeddedAuthMode"), false);
	assert.equal(
		resolveFn.includes("/api/auth"),
		false,
		"resolveAuthUiClient must not invent /api/auth",
	);
	assert.equal(resolveFn.includes("ATHENA_AUTH_URL"), false);
	assert.equal(
		/location\.origin|window\.origin/.test(resolveFn),
		false,
		"resolveAuthUiClient must not invent origin",
	);

	const providersSrc = await readRepo(
		"packages/athena-auth-ui/packages/heroui/src/components/auth/athena-providers.tsx",
	);
	assert.match(providersSrc, /resolveAuthUiClient/);
	assert.equal(providersSrc.includes("DATABASE_URL"), false);
	assert.equal(providersSrc.includes("inferEmbeddedAuthMode"), false);
	assert.equal(providersSrc.includes('mode: "local"'), false);

	resetAthenaDiscoverySessionCache();
	const restore = withMockedFetch((url) => {
		if (url.includes("/capabilities") || url.includes("/health")) {
			return jsonResponse(protocol11AuthOn);
		}
		return jsonResponse({ session: null, user: null });
	});
	try {
		const client = createNextBrowserClient({
			topology: { discover: "next", fallback: "error" },
		});
		const diag = client.system.inspectAuth();
		assert.ok(
			diag.browserRequestBaseUrl === "/api/auth" ||
				diag.browserRequestBaseUrl?.endsWith("/api/auth"),
			"AthenaProviders must receive a client already attached at /api/auth",
		);
		assert.notEqual(
			await authAttemptCode(client),
			"ATHENA_SERVICE_NOT_CONFIGURED",
		);
	} finally {
		restore();
	}
});

// ---------------------------------------------------------------------------
// T-APP-11 — next-minimal + create-athena-app four-step golden path
// ---------------------------------------------------------------------------

test("T-APP-11: next-minimal is createClient(databaseUrl, autoMigrate) + discover next + AthenaProviders", async () => {
	const root = await readRepo(
		"packages/athena-auth-ui/examples/next-minimal/src/lib/athena/root.ts",
	);
	const browser = await readRepo(
		"packages/athena-auth-ui/examples/next-minimal/src/lib/athena/browser.ts",
	);
	const handlers = await readRepo(
		"packages/athena-auth-ui/examples/next-minimal/src/lib/athena/handlers.ts",
	);
	const providers = await readRepo(
		"packages/athena-auth-ui/examples/next-minimal/src/components/providers.tsx",
	);

	assert.match(root, /createClient\(/);
	assert.match(root, /databaseUrl/);
	assert.match(root, /autoMigrate/);
	assert.equal(
		/mode:\s*"local"/.test(root),
		false,
		"root must rely on constructor inference, not explicit mode:local",
	);
	assert.match(handlers, /createAthenaNextHandlers\(\{\s*client/);
	assert.match(browser, /createClient\(/);
	assert.match(browser, /discover:\s*"next"/);
	assert.equal(browser.includes("createAthenaBrowserClient"), false);
	assert.equal(browser.includes("auth: { routing:"), false);
	assert.match(providers, /AthenaProviders/);
	assert.equal(
		providers.includes('basePath="/api/auth"'),
		false,
		"AthenaProviders must not repair topology with basePath",
	);
});

test("T-APP-11: create-athena-app golden path drops createAthenaBrowserClient and explicit local", async () => {
	const clients = await readRepo("packages/create-athena-app/src/next/clients.ts");
	const browserFn = clients.slice(
		clients.indexOf("export function renderAthenaBrowserClient"),
		clients.indexOf("export function renderAthenaBrowserClientAlias"),
	);
	const rootFn = clients.slice(
		clients.indexOf("export function renderAthenaRootClient"),
		clients.indexOf("export function renderAthenaDataRoute"),
	);
	assert.match(browserFn, /createClient\(/);
	assert.match(browserFn, /discover:\s*"next"/);
	assert.match(rootFn, /databaseUrl/);
	assert.match(rootFn, /autoMigrate/);
	assert.equal(clients.includes("createAthenaBrowserClient"), false);
	assert.equal(
		/mode:\s*"local"/.test(rootFn),
		false,
		"generator must not require explicit mode:local",
	);
	assert.equal(
		browserFn.includes('routing: "same-origin"') ||
			rootFn.includes('routing: "same-origin"'),
		false,
		"canonical generated path must not require explicit same-origin",
	);
});

// ---------------------------------------------------------------------------
// T-PKG-12 — browser/Edge still exclude pg + embedded Auth (and new topology)
// ---------------------------------------------------------------------------

test("T-PKG-12: next/client + topology stay browser-safe and do not store embedded/PG", async () => {
	const clientSrc = await readSrc("next/client.ts");
	const topologySrc = await readSrc("next/topology.ts");
	for (const [label, src] of [
		["next/client.ts", clientSrc],
		["next/topology.ts", topologySrc],
	] as const) {
		assert.equal(src.includes('from "../postgres'), false, `${label} must not import postgres`);
		assert.equal(src.includes("createAthenaAuthRuntime"), false, `${label} must not embed Auth`);
		assert.equal(src.includes("inferEmbeddedAuthMode"), false, `${label} must not re-infer`);
	}
	assert.match(
		`${clientSrc}\n${topologySrc}`,
		/ResolvedNextAthenaTopology/,
		"packaging contract includes internal ResolvedNextAthenaTopology",
	);
	assert.equal(
		/AthenaNextRuntimeConfig|EmbeddedAuthRuntimeConfig|AuthUiRuntimeConfig/.test(
			`${clientSrc}\n${topologySrc}`,
		),
		false,
		"must not invent extra runtime config types",
	);
});
