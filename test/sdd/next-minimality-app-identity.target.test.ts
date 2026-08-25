/**
 * Next minimality / Auth DX — app identity, RP, and origin TARGET.
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/next-minimality-app-identity.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { AthenaConfigurationError } from "../../src/config/errors.ts";
import {
	normalizeAthenaAuthConfig,
	resolveAthenaAppIdentity,
	resolveAthenaPasskeyOnboardingUser,
} from "../../src/auth/config.ts";
import { createPasskeyRelyingPartySnapshot } from "../../src/auth/passkey/server/relying-party.ts";

const EMPTY_PASSKEY = {
	authentication: { userVerification: "preferred" as const },
	challengeTtlSeconds: 60,
	enabled: true,
	onboardingCreateSession: true,
	onboardingEnabled: false,
	origins: [] as string[],
	registration: {
		authenticatorAttachment: undefined,
		residentKey: "preferred" as const,
		userVerification: "preferred" as const,
	},
	relatedOrigins: [] as string[],
	rpId: null as string | null,
	rpName: null as string | null,
};

function withEnv<T>(
	patch: Record<string, string | undefined>,
	run: () => T,
): T {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(patch)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return run();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

test("T-APP-01: APP_URL only → identity.origin and trustedOrigins contain that origin", () => {
	const identity = resolveAthenaAppIdentity({
		env: { APP_URL: "https://app.example.com/dashboard" },
	});
	assert.ok(identity);
	assert.equal(identity.origin, "https://app.example.com");
	assert.equal(identity.hostname, "app.example.com");

	const normalized = withEnv({ APP_URL: "https://app.example.com/dashboard" }, () =>
		normalizeAthenaAuthConfig({ mode: "local" }),
	);
	assert.equal(normalized.appIdentity?.origin, "https://app.example.com");
	assert.equal(
		normalized.security.trustedOrigins.includes("https://app.example.com"),
		true,
	);
});

test("T-APP-03: invalid app.url fails closed and does not fall back to APP_URL", () => {
	assert.throws(
		() =>
			resolveAthenaAppIdentity({
				app: { url: "not-a-url" },
				env: { APP_URL: "https://env.example.com" },
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_RUNTIME_CONFIG_INVALID",
	);
});

test("T-APP-04: non-http(s) app.url fails closed", () => {
	assert.throws(
		() =>
			resolveAthenaAppIdentity({
				app: { url: "ftp://files.example.com" },
				env: { APP_URL: "https://env.example.com" },
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_RUNTIME_CONFIG_INVALID",
	);
});

test("T-APP-05: whitespace-only app.url consults APP_URL", () => {
	const identity = resolveAthenaAppIdentity({
		app: { url: "   " },
		env: { APP_URL: "https://env.example.com/dashboard" },
	});
	assert.ok(identity);
	assert.equal(identity.origin, "https://env.example.com");
});

test("T-APP-06: valid app.url wins over conflicting APP_URL", () => {
	const identity = resolveAthenaAppIdentity({
		app: { url: "https://app.example.com/app" },
		env: { APP_URL: "https://env.example.com" },
	});
	assert.ok(identity);
	assert.equal(identity.origin, "https://app.example.com");
	assert.notEqual(identity.origin, "https://env.example.com");
});

test("T-APP-02: Host / x-forwarded-host are ignored for identity", () => {
	const identity = resolveAthenaAppIdentity({
		env: {
			APP_URL: "https://app.example.com",
			HOST: "evil.example",
			HTTP_HOST: "evil.example",
			"x-forwarded-host": "evil.example",
			X_FORWARDED_HOST: "evil.example",
		},
	});
	assert.ok(identity);
	assert.equal(identity.origin, "https://app.example.com");
	assert.equal(identity.hostname, "app.example.com");
	assert.notEqual(identity.hostname, "evil.example");
});

test("T-RP-01: default rpId is the app URL hostname", () => {
	const identity = resolveAthenaAppIdentity({
		env: { APP_URL: "http://localhost:3010" },
	});
	assert.ok(identity);
	const rp = createPasskeyRelyingPartySnapshot({
		appIdentity: identity,
		environment: "development",
		passkey: { ...EMPTY_PASSKEY, enabled: true },
		required: true,
		trustedOrigins: [
			identity.origin,
			"https://admin.example.com",
		],
	});
	assert.equal(rp.id, "localhost");
	assert.deepEqual([...rp.origins], ["http://localhost:3010"]);
});

test("T-RP-02: two WebAuthn hosts without rpId → ATHENA_PASSKEY_RP_AMBIGUOUS", () => {
	try {
		createPasskeyRelyingPartySnapshot({
			environment: "production",
			passkey: {
				...EMPTY_PASSKEY,
				enabled: true,
				origins: ["https://a.example.com", "https://b.example.com"],
			},
			required: true,
			trustedOrigins: ["https://a.example.com", "https://b.example.com"],
		});
		assert.fail("expected ATHENA_PASSKEY_RP_AMBIGUOUS");
	} catch (error) {
		assert.ok(error instanceof AthenaConfigurationError);
		assert.equal(error.code, "ATHENA_PASSKEY_RP_AMBIGUOUS");
	}
});

test("T-RP-03: production + passkeys + no URL → ATHENA_PASSKEY_APP_ORIGIN_REQUIRED", () => {
	try {
		createPasskeyRelyingPartySnapshot({
			environment: "production",
			passkey: { ...EMPTY_PASSKEY, enabled: true, origins: [] },
			required: true,
			trustedOrigins: [],
		});
		assert.fail("expected ATHENA_PASSKEY_APP_ORIGIN_REQUIRED");
	} catch (error) {
		assert.ok(error instanceof AthenaConfigurationError);
		assert.equal(error.code, "ATHENA_PASSKEY_APP_ORIGIN_REQUIRED");
	}
});

test("T-OR-01: passkey.origins ⊆ trustedOrigins", () => {
	const origin = "https://passkey.example.com";
	const normalized = normalizeAthenaAuthConfig({
		mode: "local",
		passkey: { enabled: true, origins: [origin] },
	});
	assert.equal(normalized.passkey.origins.includes(origin), true);
	assert.equal(normalized.security.trustedOrigins.includes(origin), true);
});

test("T-TRUST-01: losing env URL aliases are not independently trusted", () => {
	const normalized = normalizeAthenaAuthConfig(
		{ mode: "local" },
		{
			env: {
				APP_URL: "https://app.example.com",
				BETTER_AUTH_URL: "https://better.example.com",
				NEXT_PUBLIC_URL: "https://alias.example.com",
			},
		},
	);
	assert.equal(
		normalized.security.trustedOrigins.includes("https://app.example.com"),
		true,
	);
	assert.equal(
		normalized.security.trustedOrigins.includes("https://alias.example.com"),
		false,
	);
	assert.equal(
		normalized.security.trustedOrigins.includes("https://better.example.com"),
		false,
	);
});

test("T-OR-02: extra trusted origin does not become a WebAuthn origin", () => {
	const identity = resolveAthenaAppIdentity({
		app: { url: "https://app.example.com" },
	});
	assert.ok(identity);
	const rp = createPasskeyRelyingPartySnapshot({
		appIdentity: identity,
		environment: "production",
		passkey: { ...EMPTY_PASSKEY, enabled: true },
		required: true,
		trustedOrigins: [
			"https://app.example.com",
			"https://admin.example.com",
		],
	});
	assert.deepEqual([...rp.origins], ["https://app.example.com"]);
	assert.equal(rp.origins.includes("https://admin.example.com"), false);
});

test("production passkeys cannot derive WebAuthn origin from security.trustedOrigins", () => {
	assert.throws(
		() =>
			createPasskeyRelyingPartySnapshot({
				appIdentity: null,
				environment: "production",
				passkey: {
					...EMPTY_PASSKEY,
					origins: [],
				},
				required: true,
				trustedOrigins: ["https://admin.example.com"],
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_PASSKEY_APP_ORIGIN_REQUIRED",
	);
});

test("T-OR-03: trustedOrigins without identity are not ceremony origins", () => {
	const trusted = [
		"https://a.example.com",
		"https://b.example.com",
	] as const;
	const rp = createPasskeyRelyingPartySnapshot({
		appIdentity: null,
		environment: "development",
		passkey: { ...EMPTY_PASSKEY, enabled: true },
		required: true,
		trustedOrigins: [...trusted],
	});
	assert.equal(rp.origins.includes(trusted[0]), false);
	assert.equal(rp.origins.includes(trusted[1]), false);
});

test("T-ONB-shorthand: passkey onboarding true enables passkeys without resolveUser", () => {
	const normalized = normalizeAthenaAuthConfig({
		mode: "local",
		passkey: { onboarding: true },
	});
	assert.equal(normalized.passkey.enabled, true);
	assert.equal(normalized.passkey.onboardingEnabled, true);

	const flag = normalizeAthenaAuthConfig({
		mode: "local",
		passkey: true,
	});
	assert.equal(flag.passkey.enabled, true);
	assert.equal(flag.passkey.onboardingEnabled, false);
});

test("T-ONB-01: onboarding: true maps typed email without app resolveUser", () => {
	const normalized = normalizeAthenaAuthConfig({
		mode: "local",
		passkey: { onboarding: true },
	});
	assert.equal(normalized.passkey.onboardingEnabled, true);
	assert.deepEqual(resolveAthenaPasskeyOnboardingUser({ email: "ada@example.com" }), {
		create: { email: "ada@example.com" },
	});
	assert.deepEqual(
		resolveAthenaPasskeyOnboardingUser({
			email: "ada@example.com",
			name: "Ada",
		}),
		{ create: { email: "ada@example.com", name: "Ada" } },
	);
});

test("T-ONB-02: missing email is fail-closed", () => {
	assert.throws(
		() => resolveAthenaPasskeyOnboardingUser({}),
		/email is required to complete passkey onboarding/,
	);
	assert.throws(
		() => resolveAthenaPasskeyOnboardingUser({ name: "Ada" }),
		/email is required/,
	);
});
