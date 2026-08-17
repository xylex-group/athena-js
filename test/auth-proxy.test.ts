import assert from "node:assert/strict";
import test from "node:test";
import { AthenaConfigurationError } from "../src/config/errors.ts";
import {
	createAthenaAuthHandlers,
	createAthenaAuthProxyHandlers,
	proxyAthenaAuthRequest,
	resolveAthenaAuthProxyUpstreamBaseUrl,
} from "../src/next/auth-proxy.ts";
import { createClient } from "../src/v3-client.ts";

test("proxy upstream from client uses attached same-origin routing", () => {
	const client = createClient({
		auth: {
			routing: "same-origin",
			upstreamUrl: "https://auth.example.com",
		},
		key: "k",
		url: "https://gateway.example.com",
	});
	assert.equal(
		resolveAthenaAuthProxyUpstreamBaseUrl({ client }),
		"https://auth.example.com",
	);
});

test("proxy client without upstream throws ATHENA_AUTH_UPSTREAM_REQUIRED", () => {
	const client = createClient({
		auth: { routing: "same-origin" },
		key: "k",
		url: "https://gateway.example.com",
	});
	assert.throws(
		() => resolveAthenaAuthProxyUpstreamBaseUrl({ client }),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_AUTH_UPSTREAM_REQUIRED",
	);
});

test("proxy rejects client + upstreamUrl dual authority", () => {
	const client = createClient({
		auth: { routing: "same-origin", upstreamUrl: "https://a.example.com" },
		key: "k",
		url: "https://gateway.example.com",
	});
	assert.throws(
		() =>
			resolveAthenaAuthProxyUpstreamBaseUrl({
				client,
				upstreamUrl: "https://b.example.com",
			} as never),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_AUTH_PROXY_CONFIGURATION_INVALID",
	);
});

test("proxyAthenaAuthRequest forwards path, body, and rewrites Set-Cookie Domain", async () => {
	const calls: Array<{
		url: string;
		method: string;
		body: string | undefined;
	}> = [];
	const fetchImplementation: typeof fetch = async (input, init) => {
		calls.push({
			body: typeof init?.body === "string" ? init.body : undefined,
			method: String(init?.method ?? "GET"),
			url: String(input),
		});
		return new Response(JSON.stringify({ ok: true }), {
			headers: {
				"set-cookie":
					"athena-auth.session_token=abc; Path=/; Domain=auth.example.com; Secure; SameSite=None",
			},
			status: 200,
		});
	};

	const request = new Request(
		"https://app.example.com/api/auth/sign-in/email",
		{
			body: JSON.stringify({ email: "a@b.c", password: "x" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		},
	);

	const response = await proxyAthenaAuthRequest(request, {
		fetchImplementation,
		rewriteSetCookiesToRequestOrigin: true,
		upstreamUrl: "https://auth.example.com",
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.url, "https://auth.example.com/sign-in/email");
	assert.equal(calls[0]?.method, "POST");
	assert.ok(calls[0]?.body?.includes("a@b.c"));

	const setCookie = response.headers.get("set-cookie") ?? "";
	assert.ok(setCookie.includes("athena-auth.session_token=abc"));
	assert.ok(!/domain=/i.test(setCookie));
});

test("createAthenaAuthProxyHandlers({ client }) GET reachability", async () => {
	const client = createClient({
		auth: {
			routing: "same-origin",
			upstreamUrl: "https://auth.example.com",
		},
		key: "k",
		url: "https://gateway.example.com",
	});

	let hit = "";
	const handlers = createAthenaAuthProxyHandlers({
		client,
		fetchImplementation: async (input) => {
			hit = String(input);
			return new Response("{}", { status: 200 });
		},
	});

	const res = await handlers.GET(
		new Request("https://app.example.com/api/auth/get-session"),
	);
	assert.equal(res.status, 200);
	assert.equal(hit, "https://auth.example.com/get-session");
});

test("session cookie becomes Authorization when missing", async () => {
	let authHeader: string | null = null;
	await proxyAthenaAuthRequest(
		new Request("https://app.example.com/api/auth/get-session", {
			headers: {
				cookie: "athena-auth.session_token=tok-123",
			},
		}),
		{
			fetchImplementation: async (_url, init) => {
				authHeader = new Headers(init?.headers).get("authorization");
				return new Response("{}", { status: 200 });
			},
			upstreamUrl: "https://auth.example.com",
		},
	);
	assert.equal(authHeader, "Bearer tok-123");
});

test("proxyAthenaAuthRequest sets Accept-Encoding identity (ACT-PROXY-337)", async () => {
	let acceptEncoding: string | null = null;
	await proxyAthenaAuthRequest(
		new Request("https://app.example.com/api/auth/get-session", {
			headers: { "accept-encoding": "gzip, deflate, br" },
		}),
		{
			fetchImplementation: async (_url, init) => {
				acceptEncoding = new Headers(init?.headers).get("accept-encoding");
				return new Response(JSON.stringify({ ok: true }), {
					headers: {
						"content-encoding": "gzip",
						"content-type": "application/json",
					},
					status: 200,
				});
			},
			upstreamUrl: "https://auth.example.com",
		},
	);
	assert.equal(acceptEncoding, "identity");
});

test("proxy strips content-encoding from upstream response", async () => {
	const response = await proxyAthenaAuthRequest(
		new Request("https://app.example.com/api/auth/get-session"),
		{
			fetchImplementation: async () =>
				new Response("{}", {
					headers: {
						"content-encoding": "br",
						"content-type": "application/json",
					},
					status: 200,
				}),
			upstreamUrl: "https://auth.example.com",
		},
	);
	assert.equal(response.headers.get("content-encoding"), null);
	assert.equal(response.headers.get("content-type"), "application/json");
});

test("createAthenaAuthHandlers(client) derives upstream from client only", async () => {
	const client = createClient({
		auth: {
			routing: "same-origin",
			upstreamUrl: "https://auth.example.com",
		},
		key: "k",
		url: "https://gateway.example.com",
	});

	let hit = "";
	const handlers = createAthenaAuthHandlers(client, {
		fetchImplementation: async (input) => {
			hit = String(input);
			return new Response("{}", { status: 200 });
		},
	});

	const res = await handlers.GET(
		new Request("https://app.example.com/api/auth/get-session"),
	);
	assert.equal(res.status, 200);
	assert.equal(hit, "https://auth.example.com/get-session");
});

test("createAthenaAuthHandlers rejects dual upstream authority", () => {
	const client = createClient({
		auth: {
			routing: "same-origin",
			upstreamUrl: "https://auth.example.com",
		},
		key: "k",
		url: "https://gateway.example.com",
	});
	assert.throws(
		() =>
			createAthenaAuthHandlers(client, {
				upstreamUrl: "https://other.example.com",
			} as never),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_AUTH_PROXY_CONFIGURATION_INVALID",
	);
});
