/**
 * Retired characterization baseline for Direct S3 Storage Provider.
 * SSOT: test/sdd/athena-js-s3-storage-provider.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { getAthenaClientInternals } from "../../../src/runtime/client-internals.ts";
import { materializeStorage } from "../../../src/runtime/materializers/storage.ts";
import { resolveRuntimePlan } from "../../../src/runtime/plan/resolve.ts";
import { getStorageProvider } from "../../../src/storage/runtime/index.ts";
import { createClient } from "../../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

function stubS3Client() {
	return {
		deleteObject: async () => ({}),
		getObject: async () => ({}),
		headObject: async () => ({}),
		listObjectsV2: async () => ({}),
		putObject: async () => ({}),
	};
}

test("B-S3-NO-FILE: P?: storage runtime has no s3-provider module", () => {
	assert.equal(
		existsSync(join(srcRoot, "storage", "runtime", "providers", "s3-provider.ts")),
		false,
	);
	const providers = readdirSync(join(srcRoot, "storage", "runtime", "providers"));
	assert.equal(providers.includes("s3-provider.ts"), false);
	assert.equal(providers.includes("local-provider.ts"), true);
	assert.equal(providers.includes("r2-provider.ts"), true);
});

test("B-S3-TRANSPORT: P?: AthenaStorageTransport does not include s3", () => {
	const resolveSrc = readSrc("runtime/resolve.ts");
	assert.match(
		resolveSrc,
		/export type AthenaStorageTransport = "http" \| "r2" \| "local" \| "none"/,
	);
	assert.equal(/"s3"/.test(resolveSrc.split("AthenaStorageTransport")[1]?.slice(0, 80) ?? ""), false);
	const plan = resolveRuntimePlan(
		{
			storage: {
				bucket: "athena-objects",
				provider: "s3",
				s3: stubS3Client(),
			},
		},
		{ environment: "node", trustedNode: true },
	);
	assert.equal(plan.storage.transport, "none");
	assert.notEqual(plan.storage.transport, "s3");
});

test("B-S3-MATERIALIZE: P?: materializeStorage ignores provider s3", () => {
	const storage = {
		bucket: "athena-objects",
		provider: "s3" as const,
		s3: stubS3Client(),
	};
	const next = materializeStorage({ storage });
	assert.equal(getStorageProvider(next.storage), undefined);
	assert.equal(readSrc("runtime/materializers/storage.ts").includes("s3-provider"), false);
});

test("B-S3-CREATE: P?: createClient provider s3 does not attach StorageRuntime", () => {
	const client = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_s3_sdd",
		gatewayTransport: {
			baseUrl: "https://athena.local/postgres-direct",
			buildHeaders() {
				return {};
			},
			deleteGateway: async () => ({ ok: true }) as never,
			fetchGateway: async () => ({ ok: true }) as never,
			insertGateway: async () => ({ ok: true }) as never,
			queryGateway: async () => ({ ok: true }) as never,
			async resolveCallOptions(options) {
				return options;
			},
			rpcGateway: async () => ({ ok: true }) as never,
			updateGateway: async () => ({ ok: true }) as never,
			async verifyConnection() {
				return { ok: true } as never;
			},
		},
		storage: {
			bucket: "athena-objects",
			provider: "s3",
			s3: stubS3Client(),
		},
	});
	assert.equal(getAthenaClientInternals(client)?.storageRuntime, undefined);
});

test("B-S3-NO-AWS-DEP: P?: package.json does not depend on @aws-sdk/client-s3", () => {
	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
	};
	for (const bag of [
		pkg.dependencies,
		pkg.devDependencies,
		pkg.optionalDependencies,
		pkg.peerDependencies,
	]) {
		const keys = Object.keys(bag ?? {});
		assert.equal(keys.some((name) => name.startsWith("@aws-sdk/")), false);
	}
});

test("B-S3-NO-CTOR: P?: createStorageClient is not a package export", async () => {
	const mod = await import("../../../src/index.ts");
	assert.equal("createStorageClient" in mod, false);
	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
		exports?: Record<string, unknown>;
	};
	assert.equal(pkg.exports?.["./storage-client"], undefined);
});
