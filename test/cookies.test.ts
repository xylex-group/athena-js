import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { AthenaCookieContextRuntime } from "../src/cookies/index.ts";
import {
	getCookieCache,
	getSessionCookie,
	hasAuthSessionCookie,
	parseSetCookieHeader,
	SESSION_COOKIE_PATTERNS,
	setCookieToHeader,
	setRequestCookie,
	setSessionCookie,
	splitSetCookieHeader,
} from "../src/cookies/index.ts";

type MutableCookieContext = AthenaCookieContextRuntime & {
	__cookies: Map<string, string>;
};

function serializeCookieMap(cookies: Map<string, string>): string {
	return Array.from(cookies.entries())
		.map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
		.join("; ");
}

function createCookieContext(
	secret = "super-secret-value",
): MutableCookieContext {
	const cookies = new Map<string, string>();
	const headers = new Headers();

	const context: MutableCookieContext = {
		__cookies: cookies,
		context: {
			authCookies: {
				accountData: {
					attributes: {
						httpOnly: true,
						path: "/",
						sameSite: "lax",
						secure: false,
					},
					name: "athena-auth.account_data",
				},
				dontRememberToken: {
					attributes: {
						httpOnly: true,
						path: "/",
						sameSite: "lax",
						secure: false,
					},
					name: "athena-auth.dont_remember",
				},
				sessionData: {
					attributes: {
						httpOnly: true,
						maxAge: 300,
						path: "/",
						sameSite: "lax",
						secure: false,
					},
					name: "athena-auth.session_data",
				},
				sessionToken: {
					attributes: {
						httpOnly: true,
						path: "/",
						sameSite: "lax",
						secure: false,
					},
					name: "athena-auth.session_token",
				},
			},
			options: {
				session: {
					cookieCache: {
						enabled: true,
						maxAge: 300,
						strategy: "compact",
					},
				},
			},
			secret,
			sessionConfig: {
				expiresIn: 60 * 60 * 24 * 7,
			},
			setNewSession: () => undefined,
		},
		getCookie: (name: string) => cookies.get(name) ?? null,
		headers,
		setCookie: (name: string, value: string) => {
			cookies.set(name, value);
			headers.set("cookie", serializeCookieMap(cookies));
		},
	};

	return context;
}

test("getSessionCookie resolves athena-auth and secure cookie names by default", () => {
	const headers = new Headers();
	headers.set(
		"cookie",
		"__Secure-athena-auth.session_token=secure-token; athena-auth.session_data=cache-data",
	);

	const token = getSessionCookie(headers);
	assert.equal(token, "secure-token");
});

test("getSessionCookie supports explicit cookiePrefix override", () => {
	const headers = new Headers();
	headers.set("cookie", "better-auth.session_token=legacy-token");

	const token = getSessionCookie(headers, {
		cookiePrefix: "better-auth",
	});
	assert.equal(token, "legacy-token");
});

test("getSessionCookie does not apply implicit legacy prefix fallback", () => {
	const headers = new Headers();
	headers.set("cookie", "better-auth.session_token=legacy-token");
	assert.equal(getSessionCookie(headers), null);
});

test("setSessionCookie writes token + compact cache and getCookieCache validates it", async () => {
	const ctx = createCookieContext();
	await setSessionCookie(
		ctx,
		{
			session: {
				id: "session-1",
				token: "token-123",
				userId: "user-1",
			},
			user: {
				email: "user@example.com",
				id: "user-1",
			},
		},
		false,
	);

	assert.ok(ctx.headers);
	const token = getSessionCookie(ctx.headers);
	assert.equal(token, "token-123");

	const cache = await getCookieCache(ctx.headers, {
		secret: "super-secret-value",
	});
	assert.ok(cache);
	assert.equal(cache?.session.id, "session-1");
	assert.equal(cache?.user.email, "user@example.com");
});

test("setRequestCookie mutates request cookie header without comma-joining", () => {
	const headers = new Headers();
	headers.set("cookie", "a=1; b=2");

	setRequestCookie(headers, "b", "updated");
	setRequestCookie(headers, "c", "hello world");

	assert.equal(headers.get("cookie"), "a=1; b=updated; c=hello%20world");
});

test("splitSetCookieHeader and parseSetCookieHeader handle combined set-cookie values", () => {
	const combined =
		"athena-auth.session_token=abc; Path=/; HttpOnly, athena-auth.session_data=xyz; Max-Age=300; Path=/";

	const split = splitSetCookieHeader(combined);
	assert.equal(split.length, 2);

	const parsed = parseSetCookieHeader(combined);
	assert.equal(parsed.get("athena-auth.session_token")?.value, "abc");
	assert.equal(parsed.get("athena-auth.session_data")?.["max-age"], 300);
});

test("setCookieToHeader merges response set-cookie into downstream request cookie header", () => {
	const targetHeaders = new Headers();
	targetHeaders.set("cookie", "existing=1");
	const proxy = setCookieToHeader(targetHeaders);

	const response = new Response(null, {
		headers: {
			"set-cookie": "athena-auth.session_token=abc; Path=/; HttpOnly",
		},
	});

	proxy({ response });
	const updated = targetHeaders.get("cookie");
	assert.equal(updated, "existing=1; athena-auth.session_token=abc");
});

test("package exports expose ./cookies entrypoint", async () => {
	const packageJson = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as {
		exports: Record<
			string,
			{
				types?: string;
				import?: string;
				require?: string;
				default?: string;
			}
		>;
	};

	assert.equal(packageJson.exports["./cookies"]?.types, "./dist/cookies.d.ts");
	assert.equal(packageJson.exports["./cookies"]?.import, "./dist/cookies.js");
	assert.equal(packageJson.exports["./cookies"]?.require, "./dist/cookies.cjs");
	assert.equal(packageJson.exports["./cookies"]?.default, "./dist/cookies.js");
});

test("hasAuthSessionCookie detects Athena and Better Auth session cookies", () => {
	assert.equal(hasAuthSessionCookie(null), false);
	assert.equal(hasAuthSessionCookie(undefined), false);
	assert.equal(hasAuthSessionCookie(""), false);
	assert.equal(hasAuthSessionCookie("other=1; foo=bar"), false);

	assert.equal(
		hasAuthSessionCookie("athena-auth.session-token=sess_abc"),
		true,
	);
	assert.equal(
		hasAuthSessionCookie("foo=1; athena-auth.session-token=sess_abc; bar=2"),
		true,
	);
	assert.equal(
		hasAuthSessionCookie("athena-auth-session-token=sess_abc"),
		true,
	);
	assert.equal(
		hasAuthSessionCookie("better-auth.session_token=sess_abc"),
		true,
	);
	assert.equal(
		hasAuthSessionCookie("better-auth-session_token=sess_abc"),
		true,
	);
	assert.equal(
		hasAuthSessionCookie("__Secure-athena-auth.session-token=sess_abc"),
		true,
	);
	assert.equal(
		hasAuthSessionCookie("__Secure-better-auth.session_token=sess_abc"),
		true,
	);

	// Name fragment without assignment must not match
	assert.equal(hasAuthSessionCookie("note=athena-auth.session-token"), false);
	for (const expectedPattern of [
		"better-auth.session_token",
		"better-auth-session_token",
		"athena-auth.session_token",
		"athena-auth.session-token",
		"athena-auth-session_token",
		"athena-auth-session-token",
	]) {
		assert.equal(
			SESSION_COOKIE_PATTERNS.some((pattern) =>
				pattern.source.includes(expectedPattern.replace(".", "\\.")),
			),
			true,
		);
	}
});
