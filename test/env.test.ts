import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	createAthenaFromWorkerEnv,
	resolveAthenaExecutionMode,
} from "../src/cloudflare/runtime.ts";
import {
	ATHENA_ENV_API_KEY_KEYS,
	ATHENA_ENV_CLIENT_KEYS,
	ATHENA_ENV_DB_URL_KEYS,
	ATHENA_ENV_GATEWAY_URL_KEYS,
	ATHENA_ENV_PRIMARY_KEYS,
	ATHENA_ENV_URL_KEYS,
	requireAthenaEnv,
	resolveAthenaEnv,
} from "../src/env/index.ts";
import { createClient } from "../src/v3-client.ts";

test("resolveAthenaEnv uses primary keys only by default", () => {
	const resolved = resolveAthenaEnv({
		env: {
			ATHENA_API_KEY: "primary-key",
			ATHENA_AUTH_URL: "https://auth.example.com",
			ATHENA_CLIENT: "app",
			ATHENA_URL: "https://primary.example.com",
			NEXT_PUBLIC_ATHENA_URL: "https://legacy.example.com",
		},
	});

	assert.equal(resolved.url, "https://primary.example.com");
	assert.equal(resolved.apiKey, "primary-key");
	assert.equal(resolved.client, "app");
	assert.equal(resolved.authUrl, "https://auth.example.com");
	assert.equal(resolved.sources.url, ATHENA_ENV_PRIMARY_KEYS.url);
	assert.equal(resolved.ignored.length, 0);
});

test("resolveAthenaEnv ignores legacy keys unless legacyAliases is true", () => {
	const withoutLegacy = resolveAthenaEnv({
		env: {
			ATHENA_KEY: "legacy-key",
			NEXT_PUBLIC_ATHENA_URL: "https://legacy.example.com",
		},
	});
	assert.equal(withoutLegacy.url, undefined);
	assert.equal(withoutLegacy.apiKey, undefined);

	const withLegacy = resolveAthenaEnv({
		env: {
			ATHENA_KEY: "legacy-key",
			ATHENA_URL: "https://primary.example.com",
			NEXT_PUBLIC_ATHENA_URL: "https://legacy.example.com",
		},
		legacyAliases: true,
	});
	assert.equal(withLegacy.url, "https://primary.example.com");
	assert.equal(withLegacy.apiKey, "legacy-key");
	assert.equal(
		withLegacy.ignored.some(
			(item) => item.field === "url" && item.key === "NEXT_PUBLIC_ATHENA_URL",
		),
		true,
	);
});

test("requireAthenaEnv throws when url or apiKey missing", () => {
	assert.throws(
		() =>
			requireAthenaEnv({
				env: { ATHENA_URL: "https://x.example.com" },
			}),
		/ATHENA_API_KEY/,
	);

	const ok = requireAthenaEnv({
		env: {
			ATHENA_API_KEY: "k",
			ATHENA_URL: "https://x.example.com",
		},
	});
	assert.equal(ok.url, "https://x.example.com");
	assert.equal(ok.apiKey, "k");
});

test("SSOT: GATEWAY_URL keys are URL + DB catalogs in priority order", () => {
	assert.deepEqual(
		[...ATHENA_ENV_GATEWAY_URL_KEYS],
		[...ATHENA_ENV_URL_KEYS, ...ATHENA_ENV_DB_URL_KEYS],
	);
});

/**
 * Key → field table for createClient / Workers / execution-mode.
 * Adding an alias to the env SSOT must make every consumer accept it.
 */
test("SSOT: each gateway URL key is accepted by createClient, Workers, and execution-mode", () => {
	for (const key of ATHENA_ENV_GATEWAY_URL_KEYS) {
		const baseUrl = `https://ssot-${key.toLowerCase()}.example.com`;
		const env: Record<string, string> = {
			ATHENA_API_KEY: "ssot-key",
			[key]: baseUrl,
		};

		// createClient: constructs without throw
		const client = createClient({ env });
		assert.equal(
			client.capabilities.mode,
			"gateway",
			`createClient should accept ${key}`,
		);

		// execution-mode: gateway when only that key is set
		assert.equal(
			resolveAthenaExecutionMode({ env, mode: "auto" }),
			"gateway",
			`resolveAthenaExecutionMode should accept ${key}`,
		);

		// Worker façade: same key set
		const worker = createAthenaFromWorkerEnv(env);
		assert.equal(
			worker.mode,
			"gateway",
			`createAthenaFromWorkerEnv should accept ${key}`,
		);
	}
});

test("SSOT: each API key alias is accepted by createClient and Workers", () => {
	for (const key of ATHENA_ENV_API_KEY_KEYS) {
		const env: Record<string, string> = {
			ATHENA_URL: "https://ssot-api-key.example.com",
			[key]: `value-for-${key}`,
		};

		const client = createClient({ env });
		assert.equal(
			client.capabilities.mode,
			"gateway",
			`createClient should accept API key alias ${key}`,
		);

		const worker = createAthenaFromWorkerEnv(env);
		assert.equal(
			worker.mode,
			"gateway",
			`createAthenaFromWorkerEnv should accept API key alias ${key}`,
		);
	}
});

test("SSOT: client-name aliases include shared createClient membership", () => {
	assert.deepEqual(
		[...ATHENA_ENV_CLIENT_KEYS],
		[
			"ATHENA_CLIENT",
			"ATHENA_GATEWAY_CLIENT",
			"ATHENA_GENERATOR_CLIENT",
			"NEXT_PUBLIC_ATHENA_CLIENT",
			"NEXT_PUBLIC_ATHENA_GATEWAY_CLIENT",
		],
	);

	for (const key of ATHENA_ENV_CLIENT_KEYS) {
		const client = createClient({
			env: {
				ATHENA_API_KEY: "k",
				ATHENA_URL: "https://ssot-client.example.com",
				[key]: `client-via-${key}`,
			},
		});
		assert.equal(client.capabilities.mode, "gateway");
	}
});
