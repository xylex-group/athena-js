import assert from "node:assert/strict";
import { test } from "node:test";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { normalizeAthenaAuthConfig } from "../src/auth/config.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";

const APP_ORIGIN = "http://localhost:3000";

function createTestHasher() {
	return {
		async hash(password: string) {
			return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
		},
		needsRehash(hash: string) {
			return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
		},
		async verify(password: string, hash: string) {
			return hash.endsWith(Buffer.from(password).toString("base64url"));
		},
	};
}

function createBridgeRuntime(
	bridge: { allowedOrigins?: string[]; enabled?: boolean } = {
		allowedOrigins: [APP_ORIGIN],
	},
) {
	return createAthenaAuthRuntime({
		autoMigrate: false,
		config: normalizeAthenaAuthConfig({
			bridge,
			mode: "local",
		}),
		hasher: createTestHasher(),
	});
}

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

async function signUp(
	runtime: ReturnType<typeof createAthenaAuthRuntime>,
	email = "bridge@example.com",
) {
	const signup = await runtime.handle(
		new Request("http://auth.local/api/auth/sign-up/email", {
			body: JSON.stringify({
				email,
				name: "Bridge",
				password: "Password123!",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(signup.status, 200);
	const cookie = signup.headers.get("set-cookie");
	assert.ok(cookie);
	const body = await json(signup);
	assert.equal(typeof body.token, "string");
	return { cookie, token: String(body.token) };
}

test("normalizeAthenaAuthConfig enables bridge from allowlist and fail-closes on enabled:false", () => {
	const implied = normalizeAthenaAuthConfig({
		bridge: { allowedOrigins: [APP_ORIGIN, "not a url"] },
		mode: "local",
	});
	assert.equal(implied.bridge.enabled, true);
	assert.deepEqual(implied.bridge.allowedOrigins, [APP_ORIGIN]);

	const forcedOff = normalizeAthenaAuthConfig({
		bridge: { allowedOrigins: [APP_ORIGIN], enabled: false },
		mode: "local",
	});
	assert.equal(forcedOff.bridge.enabled, false);
	assert.deepEqual(forcedOff.bridge.allowedOrigins, [APP_ORIGIN]);

	const defaults = normalizeAthenaAuthConfig({ mode: "local" });
	assert.equal(defaults.bridge.enabled, false);
	assert.deepEqual(defaults.bridge.allowedOrigins, []);
});

test("disabled bridge issue is 404 and exchange is generic 401", async () => {
	const runtime = createBridgeRuntime({ enabled: false });
	const { cookie } = await signUp(runtime);
	const issue = await runtime.handle(
		new Request("http://auth.local/api/auth/session/bridge/issue", {
			body: JSON.stringify({
				destinationOrigin: APP_ORIGIN,
				redirectPath: "/settings",
			}),
			headers: {
				"content-type": "application/json",
				cookie,
			},
			method: "POST",
		}),
	);
	assert.equal(issue.status, 404);

	const exchange = await runtime.handle(
		new Request("http://auth.local/api/auth/session/bridge/exchange", {
			body: JSON.stringify({
				code: "ath_brc_dead",
				destinationOrigin: APP_ORIGIN,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(exchange.status, 401);
	const body = await json(exchange);
	assert.equal(body.code, "ATHENA_AUTH_BRIDGE_EXCHANGE_INVALID");
});

test("issue requires a session and allowlisted destination", async () => {
	const runtime = createBridgeRuntime();
	const anonymous = await runtime.handle(
		new Request("http://auth.local/api/auth/session/bridge/issue", {
			body: JSON.stringify({
				destinationOrigin: APP_ORIGIN,
				redirectPath: "/",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(anonymous.status, 401);

	const { cookie } = await signUp(runtime);
	const forbidden = await runtime.handle(
		new Request("http://auth.local/api/auth/session/bridge/issue", {
			body: JSON.stringify({
				destinationOrigin: "https://evil.example",
				redirectPath: "/",
			}),
			headers: {
				"content-type": "application/json",
				cookie,
			},
			method: "POST",
		}),
	);
	assert.equal(forbidden.status, 403);
});

test("two-origin issue then exchange returns the live session token once", async () => {
	const runtime = createBridgeRuntime();
	const { cookie, token } = await signUp(runtime);
	const issue = await runtime.handle(
		new Request("http://auth.local/api/auth/session/bridge/issue", {
			body: JSON.stringify({
				destinationOrigin: APP_ORIGIN,
				redirectPath: "/settings/account",
			}),
			headers: {
				"content-type": "application/json",
				cookie,
			},
			method: "POST",
		}),
	);
	assert.equal(issue.status, 200);
	const issued = await json(issue);
	assert.equal(typeof issued.code, "string");
	assert.match(String(issued.code), /^ath_brc_/);
	assert.equal(issued.destinationOrigin, APP_ORIGIN);
	assert.equal(issued.redirectPath, "/settings/account");
	assert.equal(issued.sessionToken, undefined);
	assert.equal(issued.token, undefined);

	const exchange = await runtime.handle(
		new Request("http://app.local/api/auth/session/bridge/exchange", {
			body: JSON.stringify({
				code: issued.code,
				destinationOrigin: APP_ORIGIN,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(exchange.status, 200);
	const exchanged = await json(exchange);
	assert.equal(exchanged.sessionToken, token);
	assert.equal(typeof exchanged.sessionId, "string");
	assert.equal(typeof exchanged.userId, "string");
	assert.equal(typeof exchanged.expiresAt, "string");

	const replay = await runtime.handle(
		new Request("http://app.local/api/auth/session/bridge/exchange", {
			body: JSON.stringify({
				code: issued.code,
				destinationOrigin: APP_ORIGIN,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(replay.status, 401);
	assert.equal((await json(replay)).code, "ATHENA_AUTH_BRIDGE_EXCHANGE_INVALID");
});

test("destination mismatch burns the code", async () => {
	const runtime = createBridgeRuntime();
	const { cookie } = await signUp(runtime);
	const issue = await runtime.handle(
		new Request("http://auth.local/api/auth/session/bridge/issue", {
			body: JSON.stringify({
				destinationOrigin: APP_ORIGIN,
				redirectPath: "/",
			}),
			headers: {
				"content-type": "application/json",
				cookie,
			},
			method: "POST",
		}),
	);
	const issued = await json(issue);
	const mismatch = await runtime.handle(
		new Request("http://app.local/api/auth/session/bridge/exchange", {
			body: JSON.stringify({
				code: issued.code,
				destinationOrigin: "http://127.0.0.1:3000",
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(mismatch.status, 401);
	assert.equal(
		(await json(mismatch)).code,
		"ATHENA_AUTH_BRIDGE_EXCHANGE_INVALID",
	);

	const replay = await runtime.handle(
		new Request("http://app.local/api/auth/session/bridge/exchange", {
			body: JSON.stringify({
				code: issued.code,
				destinationOrigin: APP_ORIGIN,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(replay.status, 401);
});

test("sign-out revokes unused bridge codes", async () => {
	const runtime = createBridgeRuntime();
	const { cookie } = await signUp(runtime);
	const issue = await runtime.handle(
		new Request("http://auth.local/api/auth/session/bridge/issue", {
			body: JSON.stringify({
				destinationOrigin: APP_ORIGIN,
				redirectPath: "/",
			}),
			headers: {
				"content-type": "application/json",
				cookie,
			},
			method: "POST",
		}),
	);
	const issued = await json(issue);
	const signOut = await runtime.handle(
		new Request("http://auth.local/api/auth/sign-out", {
			headers: { cookie },
			method: "POST",
		}),
	);
	assert.equal(signOut.status, 200);

	const exchange = await runtime.handle(
		new Request("http://app.local/api/auth/session/bridge/exchange", {
			body: JSON.stringify({
				code: issued.code,
				destinationOrigin: APP_ORIGIN,
			}),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	assert.equal(exchange.status, 401);
	assert.equal(
		(await json(exchange)).code,
		"ATHENA_AUTH_BRIDGE_EXCHANGE_INVALID",
	);
});
