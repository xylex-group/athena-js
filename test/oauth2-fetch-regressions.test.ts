import assert from "node:assert/strict";
import test from "node:test";
import { athenaFetch } from "../src/auth/fetch/index.ts";
import type { ProviderOptions } from "../src/auth/oauth2/index.ts";
import { createRefreshAccessTokenRequest } from "../src/auth/oauth2/refresh-access-token.ts";
import { createAuthorizationCodeRequest } from "../src/auth/oauth2/validate-authorization-code.ts";
import { microsoft, zoom } from "../src/social-providers/index.ts";

function createJwt(payload: Record<string, unknown>) {
	const header = { alg: "none", typ: "JWT" };
	return [
		Buffer.from(JSON.stringify(header)).toString("base64url"),
		Buffer.from(JSON.stringify(payload)).toString("base64url"),
		"",
	].join(".");
}

test("athenaFetch waits for async onResponse hooks before returning", async () => {
	const originalFetch = globalThis.fetch;
	let hookCompleted = false;

	globalThis.fetch = async () =>
		new Response(JSON.stringify({ ok: true }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});

	try {
		const result = await athenaFetch<{ ok: boolean }>("https://example.com", {
			onResponse: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
				hookCompleted = true;
			},
		});

		assert.equal(result.error, null);
		assert.deepEqual(result.data, { ok: true });
		assert.equal(hookCompleted, true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("microsoft getUserInfo waits for async photo hook before returning image", async () => {
	const originalFetch = globalThis.fetch;
	const provider = microsoft({ clientId: "client-id" });
	const idToken = createJwt({
		email: "jane@example.com",
		name: "Jane Doe",
		sub: "user_1",
	});

	globalThis.fetch = async (url: string | URL | Request) => {
		assert.match(String(url), /graph\.microsoft\.com/);
		return new Response(Uint8Array.from([1, 2, 3, 4]), {
			headers: { "content-type": "image/jpeg" },
			status: 200,
		});
	};

	try {
		const result = await provider.getUserInfo({
			accessToken: "access-token",
			idToken,
		});

		assert.ok(result);
		assert.equal(result.user.image, "data:image/jpeg;base64, AQIDBA==");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("authorization-code and refresh helpers omit client_id when clientId is missing", () => {
	const authorizationCodeRequest = createAuthorizationCodeRequest({
		authentication: "post",
		code: "code-123",
		options: {
			clientKey: "tiktok-client-key",
			clientSecret: "secret",
		},
		redirectURI: "https://app.example.com/callback",
	});

	assert.equal(
		authorizationCodeRequest.body.get("client_key"),
		"tiktok-client-key",
	);
	assert.equal(authorizationCodeRequest.body.get("client_secret"), "secret");
	assert.equal(authorizationCodeRequest.body.has("client_id"), false);

	const refreshRequest = createRefreshAccessTokenRequest({
		authentication: "post",
		extraParams: {
			client_key: "tiktok-client-key",
		},
		options: {
			clientSecret: "secret",
		} as ProviderOptions,
		refreshToken: "refresh-token",
	});

	assert.equal(refreshRequest.body.get("client_secret"), "secret");
	assert.equal(refreshRequest.body.get("client_key"), "tiktok-client-key");
	assert.equal(refreshRequest.body.has("client_id"), false);
});

test("zoom provider uses HTTP Basic auth for token exchange and refresh", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; headers: Headers; body: URLSearchParams }> =
		[];
	const provider = zoom({
		clientId: "zoom-client-id",
		clientSecret: "zoom-client-secret",
	});

	globalThis.fetch = async (url, init) => {
		calls.push({
			body: init?.body as URLSearchParams,
			headers: new Headers(init?.headers),
			url: String(url),
		});

		return new Response(
			JSON.stringify({
				access_token: "access-token",
				refresh_token: "refresh-token",
				token_type: "Bearer",
			}),
			{
				headers: { "content-type": "application/json" },
				status: 200,
			},
		);
	};

	try {
		await provider.validateAuthorizationCode({
			code: "auth-code",
			codeVerifier: "verifier-012345678901234567890123456789",
			redirectURI: "https://app.example.com/callback",
		});
		await provider.refreshAccessToken?.("refresh-token");

		assert.equal(calls.length, 2);

		for (const call of calls) {
			assert.equal(call.url, "https://zoom.us/oauth/token");
			assert.equal(
				call.headers.get("authorization"),
				"Basic em9vbS1jbGllbnQtaWQ6em9vbS1jbGllbnQtc2VjcmV0",
			);
			assert.equal(call.body.has("client_id"), false);
			assert.equal(call.body.has("client_secret"), false);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});
