import assert from "node:assert/strict";
import test from "node:test";
import {
	ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM,
	ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE,
	ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH,
	ATHENA_AUTH_PATH,
	ATHENA_AUTH_UPSTREAM_ENV_KEYS,
	ATHENA_AUTH_VERIFY_EMAIL_PATH,
	ATHENA_SESSION_DATA_HEADER,
	createFreshSessionLookupUrl,
	DEFAULT_ATHENA_AUTH_ORIGIN,
	isAbsoluteUrl,
	normalizeAthenaAuthBaseUrl,
	readAthenaAuthUpstreamUrlFromEnv,
	resolveAthenaAuthClientBaseUrl,
	resolveAthenaAuthRequestUrl,
	resolveAthenaAuthUpstreamUrl,
	resolveEmailVerificationCallbackUrl,
} from "../src/utils/athena-auth-url.ts";
import { readEnv, requireEnv } from "../src/utils/require-env.ts";

test("ATHENA_AUTH_UPSTREAM_ENV_KEYS precedence order", () => {
	assert.deepEqual(
		[...ATHENA_AUTH_UPSTREAM_ENV_KEYS],
		[
			"ATHENA_AUTH_UPSTREAM_URL",
			"ATHENA_AUTH_URL",
			"NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL",
			"NEXT_PUBLIC_ATHENA_AUTH_URL",
		],
	);
});

test("readAthenaAuthUpstreamUrlFromEnv walks keys in order", () => {
	assert.equal(
		readAthenaAuthUpstreamUrlFromEnv({
			ATHENA_AUTH_UPSTREAM_URL: " https://primary.example.com ",
			ATHENA_AUTH_URL: "https://secondary.example.com",
		}),
		"https://primary.example.com",
	);
	assert.equal(
		readAthenaAuthUpstreamUrlFromEnv({
			ATHENA_AUTH_URL: "https://legacy.example.com",
			NEXT_PUBLIC_ATHENA_AUTH_URL: "https://public.example.com",
		}),
		"https://legacy.example.com",
	);
	assert.equal(readAthenaAuthUpstreamUrlFromEnv({}), undefined);
});

test("isAbsoluteUrl only accepts http(s)", () => {
	assert.equal(isAbsoluteUrl("https://auth.example.com"), true);
	assert.equal(isAbsoluteUrl("http://localhost:3000"), true);
	assert.equal(isAbsoluteUrl("/api/auth"), false);
	assert.equal(isAbsoluteUrl("ftp://x"), false);
});

test("normalizeAthenaAuthBaseUrl appends /api/auth", () => {
	assert.equal(
		normalizeAthenaAuthBaseUrl("https://auth.example.com"),
		"https://auth.example.com/api/auth",
	);
	assert.equal(
		normalizeAthenaAuthBaseUrl("https://auth.example.com/api/auth/"),
		"https://auth.example.com/api/auth",
	);
	assert.equal(normalizeAthenaAuthBaseUrl("/api/auth"), ATHENA_AUTH_PATH);
	assert.equal(normalizeAthenaAuthBaseUrl(""), ATHENA_AUTH_PATH);
});

test("resolveAthenaAuthUpstreamUrl strips /api/auth and defaults", () => {
	assert.equal(
		resolveAthenaAuthUpstreamUrl("https://auth.example.com/api/auth"),
		"https://auth.example.com",
	);
	assert.equal(
		resolveAthenaAuthUpstreamUrl({
			ATHENA_AUTH_UPSTREAM_URL: "https://primary.example.com/api/auth",
			ATHENA_AUTH_URL: "https://legacy.example.com/api/auth",
		}),
		"https://primary.example.com",
	);
	assert.equal(resolveAthenaAuthUpstreamUrl({}), DEFAULT_ATHENA_AUTH_ORIGIN);
});

test("resolveAthenaAuthClientBaseUrl absolute and env map", () => {
	assert.equal(
		resolveAthenaAuthClientBaseUrl("https://auth.example.com"),
		"https://auth.example.com/api/auth",
	);
	assert.equal(
		resolveAthenaAuthClientBaseUrl(
			"https://auth.example.com/direct-auth",
			undefined,
			{ appendAuthPath: false },
		),
		"https://auth.example.com/direct-auth",
	);
	assert.equal(
		resolveAthenaAuthClientBaseUrl({
			ATHENA_AUTH_URL: "https://env.example.com",
		}),
		"https://env.example.com/api/auth",
	);
});

test("resolveAthenaAuthRequestUrl joins path under base", () => {
	assert.equal(
		resolveAthenaAuthRequestUrl("/get-session", "https://auth.example.com"),
		"https://auth.example.com/api/auth/get-session",
	);
	assert.equal(
		resolveAthenaAuthRequestUrl(
			"sign-in/email",
			"https://auth.example.com/api/auth",
		),
		"https://auth.example.com/api/auth/sign-in/email",
	);
});

test("resolveEmailVerificationCallbackUrl targets verify-email", () => {
	assert.equal(ATHENA_AUTH_VERIFY_EMAIL_PATH, "verify-email");
	assert.equal(
		resolveEmailVerificationCallbackUrl("https://auth.example.com"),
		"https://auth.example.com/api/auth/verify-email",
	);
	assert.equal(
		resolveEmailVerificationCallbackUrl("https://auth.example.com/api/auth"),
		"https://auth.example.com/api/auth/verify-email",
	);
});

test("createFreshSessionLookupUrl appends disableCookieCache on app origin", () => {
	assert.equal(ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH, "/api/auth/get-session");
	assert.equal(ATHENA_SESSION_DATA_HEADER, "x-session-data");

	const url = createFreshSessionLookupUrl("https://app.example.com");
	assert.equal(url.origin, "https://app.example.com");
	assert.equal(url.pathname, "/api/auth/get-session");
	assert.equal(
		url.searchParams.get(ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM),
		ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE,
	);

	const fromUrl = createFreshSessionLookupUrl(
		new URL("https://app.example.com/dashboard"),
	);
	assert.equal(
		fromUrl.toString(),
		"https://app.example.com/api/auth/get-session?disableCookieCache=true",
	);
});

test("requireEnv returns first non-empty trimmed value", () => {
	assert.equal(
		requireEnv(["MISSING", "AUTH_URL"], {
			AUTH_URL: " https://auth.example.com ",
			MISSING: "  ",
		}),
		"https://auth.example.com",
	);
});

test("requireEnv throws when no candidates are set", () => {
	assert.throws(
		() => requireEnv(["A", "B"], { A: "", B: undefined }),
		/Expected one of: A, B/,
	);
	assert.throws(() => requireEnv([]), /at least one/);
});

test("readEnv returns undefined instead of throwing", () => {
	assert.equal(readEnv(["A", "B"], {}), undefined);
	assert.equal(readEnv(["A", "B"], { B: "ok" }), "ok");
});
