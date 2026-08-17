import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	createInternalClientCore,
	createInternalClientView,
} from "../src/client.ts";
import * as root from "../src/index.ts";
import { AthenaConfigurationError, createClient } from "../src/index.ts";

test("v3 root exports one client constructor and no legacy constructor values", () => {
	assert.equal(typeof createClient, "function");
	assert.equal("AthenaClient" in root, false);
	assert.equal("createAuthClient" in root, false);
	assert.equal("createTypedClient" in root, false);
});

test("v3 client exposes stable service namespaces", () => {
	const client = createClient({
		key: "key",
		url: "https://athena.example.com",
	});
	assert.equal(typeof client.db, "object");
	assert.equal(typeof client.auth, "object");
	assert.equal(typeof client.chat, "object");
	assert.equal(typeof client.storage, "object");
	assert.equal(typeof client.billing, "object");
	assert.equal(typeof client.billing.getCapabilities, "function");
	// Unified root configures storage via /storage derivation.
	assert.equal(client.capabilities.storage.objects, true);
});

test("chat config sends session credentials through the shared header builder", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify({ items: [] }), { status: 200 });
	};

	try {
		const client = createClient({
			chat: { sessionToken: "chat-session-token" },
			url: "https://athena.example.com",
		});

		await client.chat.room.list();

		assert.equal(
			capturedHeaders[0]?.get("x-athena-auth-session-token"),
			"chat-session-token",
		);
		assert.equal(capturedHeaders[0]?.get("x-athena-key"), null);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("chat resolves direct rooms through the core idempotent endpoint", async () => {
	const originalFetch = globalThis.fetch;
	let capturedUrl = "";
	let capturedBody = "";
	globalThis.fetch = async (url, init) => {
		capturedUrl = String(url);
		capturedBody = String(init?.body);
		return new Response(
			JSON.stringify({
				id: "00000000-0000-0000-0000-000000000001",
				kind: "dm",
			}),
			{ status: 200 },
		);
	};

	try {
		const client = createClient({
			chat: { sessionToken: "chat-session-token" },
			url: "https://athena.example.com",
		});

		await client.chat.room.resolveDirect({
			participant_user_ids: ["user-b", "user-a"],
		});

		assert.equal(
			capturedUrl,
			"https://athena.example.com/chat/rooms/direct/resolve",
		);
		assert.deepEqual(JSON.parse(capturedBody), {
			participant_user_ids: ["user-b", "user-a"],
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("capabilities disable storage when only db service is configured", () => {
	const client = createClient({
		db: { url: "https://db.example.com" },
		key: "key",
	});
	assert.equal(client.capabilities.storage.objects, false);
	assert.equal(client.capabilities.storage.catalogs, false);
	assert.equal(client.capabilities.storage.backups, false);
});

test("createClient ignores unexpanded ATHENA_URL env placeholders when db.url is set", () => {
	// Shell / dotenv pollution like ATHENA_URL=${ATHENA_URL} must not crash chatWs derivation.
	const client = createClient({
		db: { url: "https://db.example.com" },
		env: {
			// Intentional unexpanded shell-style placeholders (not template strings).
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder fixture
			ATHENA_DB_URL: "${ATHENA_DB_URL}",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder fixture
			ATHENA_URL: "${ATHENA_URL}",
		},
		key: "key",
	});
	assert.equal(typeof client.db, "object");
	assert.equal(client.capabilities.storage.objects, false);
});

test("request context provider resolves per operation and withContext has higher precedence", async () => {
	const originalFetch = globalThis.fetch;
	const headers: Headers[] = [];
	let sequence = 0;
	globalThis.fetch = async (_url, init) => {
		headers.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const client = createClient({
			context: async () => ({
				headers: {
					"X-Provider-Call": String(sequence),
					"X-Source": "provider",
				},
				organizationId: `provider-${++sequence}`,
			}),
			headers: { "X-Source": "base" },
			key: "key",
			url: "https://athena.example.com",
		}).withContext({
			headers: { "X-Company-Id": "company-1", "X-Source": "view" },
			organizationId: "explicit-org",
		});

		await client.from("users").select();
		await client.request({ path: "/get-session", service: "auth" });

		assert.equal(sequence, 2);
		for (const captured of headers) {
			assert.equal(captured.get("x-organization-id"), "explicit-org");
			assert.equal(captured.get("x-company-id"), "company-1");
			assert.equal(captured.get("x-source"), "view");
		}
		// Provider fixture reads sequence before ++sequence, so calls emit "0" then "1".
		assert.equal(headers[0].get("x-provider-call"), "0");
		assert.equal(headers[1].get("x-provider-call"), "1");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("context views share one gateway transport and isolate per-operation context", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	globalThis.fetch = async (_url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		return new Response(JSON.stringify([]), { status: 200 });
	};

	try {
		const core = createInternalClientCore({
			apiKey: "key",
			baseUrl: "https://athena.example.com/db",
		});
		const transport = core.gatewayTransport;
		const first = createInternalClientView(core, () => ({ userId: "user-1" }));
		const second = createInternalClientView(core, () => ({ userId: "user-2" }));

		assert.equal(core.gatewayTransport, transport);
		await Promise.all([
			first.from("users").select(),
			second.from("users").select(),
		]);

		assert.equal(core.gatewayTransport, transport);
		assert.deepEqual(
			capturedHeaders
				.map((headers) => headers.get("x-user-id"))
				.sort((a, b) => String(a).localeCompare(String(b))),
			["user-1", "user-2"],
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("all HTTP namespaces resolve fresh context without reconstructing the root client", async () => {
	const originalFetch = globalThis.fetch;
	const capturedHeaders: Headers[] = [];
	let providerCalls = 0;
	globalThis.fetch = async (url, init) => {
		capturedHeaders.push(new Headers(init?.headers));
		const path = new URL(String(url)).pathname;
		const body = path.includes("/chat/")
			? { items: [] }
			: path.includes("/storage/")
				? { data: [] }
				: [];
		return new Response(JSON.stringify(body), { status: 200 });
	};

	try {
		const client = createClient({
			context: async () => ({
				userId: `user-${++providerCalls}`,
			}),
			key: "key",
			url: "https://athena.example.com",
		});

		await client.from("users").select();
		await client.auth.getSession();
		await client.chat.room.list();
		await client.storage.credentials.list();
		await client.request({ path: "/get-session", service: "auth" });

		assert.equal(capturedHeaders.length, 5);
		assert.deepEqual(
			capturedHeaders.map((headers) => headers.get("x-user-id")),
			capturedHeaders.map(
				(_, index) => `user-${index + 1 + (providerCalls - 5)}`,
			),
		);
		assert.ok(providerCalls >= 5);
		assert.equal(capturedHeaders[1].get("authorization"), null);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("unconfigured stable namespaces fail with structured service errors", () => {
	const client = createClient({
		auth: { url: "https://auth.example.com/api/auth" },
		key: "key",
	});

	assert.throws(
		() => client.from("users"),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_SERVICE_NOT_CONFIGURED" &&
			error.service === "db",
	);
});

test("missing API key fails with ATHENA_API_KEY_REQUIRED", () => {
	assert.throws(
		() => createClient({ url: "https://athena.example.com" }),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_API_KEY_REQUIRED",
	);
});

test("no routable service fails with ATHENA_NO_SERVICE_CONFIGURED", () => {
	assert.throws(
		() => createClient({ key: "key" }),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_NO_SERVICE_CONFIGURED",
	);
});

test("client.request allows absolute urls on clients without a configured db service", async () => {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		return new Response(JSON.stringify({ ok: true }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	};

	try {
		const client = createClient({
			auth: {
				url: "https://auth.example.com/api/auth",
			},
			key: "base-key",
		});

		const response = await client.request({
			url: "https://raw.example.com/custom-endpoint?from=absolute",
		});

		assert.equal(response.ok, true);
		assert.equal(calls.length, 1);
		assert.equal(
			calls[0]?.url,
			"https://raw.example.com/custom-endpoint?from=absolute",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
