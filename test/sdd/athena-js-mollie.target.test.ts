/**
 * Target — Phase 1 official Mollie adapter contract (ACT-MOLLIE-SDK-001…004).
 *
 * See docs/sdd/xylex/athena-js-mollie/matrices/m-42-conformance-act.md
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AthenaBillingProviderRequestError } from "../../src/billing/errors.ts";
import { createOfficialMollieAdapter } from "../../src/billing/runtime/local/providers/mollie/sdk/official-adapter.ts";
import { assertMollieSdkClient } from "../../src/billing/runtime/local/providers/mollie/sdk/assertions.ts";
import type { MollieSdkClientOptions } from "../../src/billing/providers/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readPkg(rel: string): string {
	return readFileSync(join(pkgRoot, rel), "utf8");
}

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

test("ACT-MOLLIE-SDK-001: adapter contract files exist and Client is not object", () => {
	assert.equal(
		existsSync(
			join(
				srcRoot,
				"billing/runtime/local/providers/mollie/sdk/contracts.ts",
			),
		),
		true,
	);
	assert.equal(
		existsSync(
			join(
				srcRoot,
				"billing/runtime/local/providers/mollie/sdk/official-adapter.ts",
			),
		),
		true,
	);
	assert.equal(
		existsSync(
			join(
				srcRoot,
				"billing/runtime/local/providers/mollie/sdk/assertions.ts",
			),
		),
		true,
	);
	const types = readSrc("billing/providers/types.ts");
	assert.doesNotMatch(types, /export type MollieSdkClient = object/);
	assert.match(types, /export interface MollieSdkClient/);
	const manifest = readPkg("package.json");
	assert.match(manifest, /"mollie-api-typescript"/);
	assert.match(manifest, /"peerDependencies"/);
});

function unusedMollieResource(): Record<string, () => Promise<unknown>> {
	return {
		cancel: async () => ({}),
		create: async () => ({}),
		delete: async () => ({}),
		get: async () => ({}),
		list: async () => ({}),
		update: async () => ({}),
	};
}

test("ACT-MOLLIE-SDK-002: official adapter constructs apiKey / advanced / OAuth shapes", () => {
	const seen: MollieSdkClientOptions[] = [];
	class RecordingSdk {
		payments = unusedMollieResource();
		customers = unusedMollieResource();
		refunds = unusedMollieResource();
		paymentLinks = unusedMollieResource();
		subscriptions = unusedMollieResource();
		invoices = unusedMollieResource();
		constructor(options?: MollieSdkClientOptions) {
			seen.push(options ?? {});
		}
	}
	const adapter = createOfficialMollieAdapter(RecordingSdk);
	adapter({ security: { apiKey: "test_key" } });
	adapter({
		security: { advancedAccessToken: "access_xxx" },
		testmode: true,
	});
	adapter({ security: { oAuth: "access_oauth" }, profileId: "pfl_1" });
	assert.deepEqual(seen[0]?.security, { apiKey: "test_key" });
	assert.deepEqual(seen[1]?.security, { advancedAccessToken: "access_xxx" });
	assert.equal(seen[1]?.testmode, true);
	assert.deepEqual(seen[2]?.security, { oAuth: "access_oauth" });
	assert.equal(seen[2]?.profileId, "pfl_1");
});

test("ACT-MOLLIE-SDK-003: missing required resource fails at adapter construct", () => {
	class IncompleteSdk {
		constructor() {}
	}
	const adapter = createOfficialMollieAdapter(IncompleteSdk);
	assert.throws(
		() => adapter({}),
		(error: unknown) =>
			error instanceof AthenaBillingProviderRequestError &&
			error.kind === "unsupported_operation" &&
			String(error.message).includes("payments"),
	);
	assert.throws(
		() => assertMollieSdkClient({ payments: {} }, "probe"),
		(error: unknown) =>
			error instanceof AthenaBillingProviderRequestError &&
			error.kind === "unsupported_operation",
	);
	class MissingPaymentCreateSdk {
		payments = {
			cancel: async () => ({}),
			get: async () => ({}),
			list: async () => ({}),
		};
		customers = unusedMollieResource();
		refunds = unusedMollieResource();
		paymentLinks = unusedMollieResource();
		subscriptions = unusedMollieResource();
		invoices = unusedMollieResource();
	}
	assert.throws(
		() => createOfficialMollieAdapter(MissingPaymentCreateSdk)({}),
		(error: unknown) =>
			error instanceof AthenaBillingProviderRequestError &&
			error.kind === "unsupported_operation" &&
			String(error.message).includes("payments.create"),
	);
});

test("ACT-MOLLIE-SDK-004: official package is not imported from core or browser entries", () => {
	const entries = [
		"browser.ts",
		"index.ts",
		"v3-client-core.ts",
		"v3-client.ts",
		"billing/module.ts",
		"billing/index.ts",
	];
	for (const rel of entries) {
		assert.doesNotMatch(readSrc(rel), /mollie-api-typescript/);
	}
	const officialAdapter = readSrc(
		"billing/runtime/local/providers/mollie/sdk/official-adapter.ts",
	);
	assert.doesNotMatch(
		officialAdapter,
		/from\s+["']mollie-api-typescript["']/,
	);
});
