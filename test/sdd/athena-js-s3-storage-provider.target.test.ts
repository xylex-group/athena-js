/**
 * Target: direct S3 StorageObjectProvider on Embedded Storage Runtime.
 * See docs/sdd/xylex/athena-js-s3-storage-provider/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { AthenaConfigurationError } from "../../src/config/errors.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { materializeStorage } from "../../src/runtime/materializers/storage.ts";
import { resolveRuntimePlan } from "../../src/runtime/plan/resolve.ts";
import { validateRuntimePlan } from "../../src/runtime/plan/validate.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";
import { createR2StorageProvider } from "../../src/storage/runtime/providers/r2-provider.ts";
import { createS3StorageProvider } from "../../src/storage/runtime/providers/s3-provider.ts";
import type {
	AuthorizedStorageOperation,
	StorageObjectProvider,
} from "../../src/storage/runtime/types.ts";
import { createClient as createBrowserClient } from "../../src/browser.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

const PRINCIPAL = normalizeAthenaPrincipal({
	authenticated: true,
	rights: ["storage.*"],
	userId: "user_s3_sdd",
});

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) {
		return out;
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectTsFiles(full));
		} else if (entry.name.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

type StoredObject = {
	body: Uint8Array;
	contentType?: string;
	metadata?: Record<string, string>;
};

function createMemoryS3(options?: { failGet?: Error }) {
	const objects = new Map<string, StoredObject>();
	const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
	return {
		calls,
		objects,
		async deleteObject(input: { Bucket: string; Key: string }) {
			calls.push({ input, method: "deleteObject" });
			objects.delete(input.Key);
			return {};
		},
		async getObject(input: { Bucket: string; Key: string }) {
			calls.push({ input, method: "getObject" });
			if (options?.failGet) {
				throw options.failGet;
			}
			const found = objects.get(input.Key);
			if (!found) {
				const error = new Error("The specified key does not exist.");
				error.name = "NoSuchKey";
				(error as { Code?: string }).Code = "NoSuchKey";
				throw error;
			}
			return {
				Body: {
					transformToByteArray: async () => found.body,
				},
				ContentLength: found.body.byteLength,
				ContentType: found.contentType,
				Metadata: found.metadata,
			};
		},
		async headObject(input: { Bucket: string; Key: string }) {
			calls.push({ input, method: "headObject" });
			const found = objects.get(input.Key);
			if (!found) {
				const error = new Error("Not Found");
				error.name = "NotFound";
				(error as { $metadata?: { httpStatusCode: number } }).$metadata = {
					httpStatusCode: 404,
				};
				throw error;
			}
			return {
				ContentLength: found.body.byteLength,
				ContentType: found.contentType,
				Metadata: found.metadata,
			};
		},
		async listObjectsV2(input: {
			Bucket: string;
			ContinuationToken?: string;
			MaxKeys?: number;
			Prefix?: string;
		}) {
			calls.push({ input, method: "listObjectsV2" });
			const prefix = input.Prefix ?? "";
			const keys = [...objects.keys()]
				.filter((key) => key.startsWith(prefix))
				.sort();
			const start = input.ContinuationToken
				? keys.indexOf(input.ContinuationToken) + 1
				: 0;
			const max = input.MaxKeys ?? keys.length;
			const page = keys.slice(Math.max(0, start), Math.max(0, start) + max);
			const last = page.at(-1);
			const truncated = start + page.length < keys.length;
			return {
				Contents: page.map((key) => ({
					ETag: `"${key}"`,
					Key: key,
					LastModified: new Date("2026-01-01T00:00:00.000Z"),
					Size: objects.get(key)?.body.byteLength ?? 0,
				})),
				IsTruncated: truncated,
				KeyCount: page.length,
				NextContinuationToken: truncated ? last : undefined,
			};
		},
		async putObject(input: {
			Body?: Uint8Array;
			Bucket: string;
			ContentType?: string;
			Key: string;
			Metadata?: Record<string, string>;
		}) {
			calls.push({ input, method: "putObject" });
			objects.set(input.Key, {
				body: input.Body ?? new Uint8Array(),
				contentType: input.ContentType,
				metadata: input.Metadata,
			});
			return { ETag: `"${input.Key}"` };
		},
	};
}

function authorized(
	op: AuthorizedStorageOperation["op"],
	extra: Partial<AuthorizedStorageOperation> & {
		cursor?: string;
		limit?: number;
		metadata?: Record<string, string>;
	} = {},
): AuthorizedStorageOperation {
	return {
		op,
		principal: PRINCIPAL,
		...extra,
	} as AuthorizedStorageOperation;
}

function createMemoryR2() {
	const objects = new Map<string, { body: Uint8Array; httpMetadata?: { contentType?: string } }>();
	return {
		async delete(key: string) {
			objects.delete(key);
		},
		async get(key: string) {
			const found = objects.get(key);
			if (!found) {
				return null;
			}
			return {
				arrayBuffer: async () =>
					found.body.buffer.slice(
						found.body.byteOffset,
						found.body.byteOffset + found.body.byteLength,
					),
				httpMetadata: found.httpMetadata,
				key,
				size: found.body.byteLength,
			};
		},
		async list(options?: { prefix?: string }) {
			const prefix = options?.prefix ?? "";
			const objectsList = [...objects.entries()]
				.filter(([key]) => key.startsWith(prefix))
				.map(([key, value]) => ({ key, size: value.body.byteLength }));
			return { objects: objectsList, truncated: false };
		},
		async put(
			key: string,
			body: Uint8Array,
			options?: { httpMetadata?: { contentType?: string } },
		) {
			objects.set(key, { body, httpMetadata: options?.httpMetadata });
			return { key };
		},
	};
}

test("T-S3-PROVIDER: P?: createS3StorageProvider implements StorageObjectProvider", () => {
	assert.equal(
		existsSync(join(srcRoot, "storage", "runtime", "providers", "s3-provider.ts")),
		true,
	);
	const provider: StorageObjectProvider = createS3StorageProvider({
		bucket: "athena-objects",
		s3: createMemoryS3(),
	});
	assert.equal(typeof provider.execute, "function");
});

test("T-S3-OPS: P?: S3 provider supports get put head list delete", async () => {
	const s3 = createMemoryS3();
	const provider = createS3StorageProvider({
		bucket: "athena-objects",
		s3,
	});
	const key = "docs/readme.txt";
	const body = new TextEncoder().encode("hello-s3");
	const put = await provider.execute(
		authorized("put", { body, contentType: "text/plain", key }),
	);
	assert.equal(put.ok, true);
	const got = await provider.execute(authorized("get", { key }));
	assert.equal(got.ok, true);
	assert.ok(got.data instanceof Uint8Array);
	assert.equal(new TextDecoder().decode(got.data as Uint8Array), "hello-s3");
	const head = await provider.execute(authorized("head", { key }));
	assert.equal(head.ok, true);
	const listed = await provider.execute(authorized("list", { prefix: "docs/" }));
	assert.equal(listed.ok, true);
	const deleted = await provider.execute(authorized("delete", { key }));
	assert.equal(deleted.ok, true);
	const missing = await provider.execute(authorized("get", { key }));
	assert.equal(missing.ok, false);
	assert.equal(missing.error?.errorNumber, 3005);
	const blank = await provider.execute(authorized("put", { body }));
	assert.equal(blank.ok, false);
	assert.equal(blank.error?.errorNumber, 3000);
	assert.equal(blank.error?.code, "storage_invalid_request");
	const unknown = await provider.execute(authorized("copy" as never, { key }));
	assert.equal(unknown.ok, false);
	assert.equal(unknown.error?.errorNumber, 3000);
	const gone = await provider.execute(authorized("delete", { key: "never-existed.bin" }));
	assert.equal(gone.ok, true);
});

test("T-S3-ADAPTER: P?: S3 provider has no Rights Policy HTTP session or browser logic", () => {
	const src = readSrc("storage/runtime/providers/s3-provider.ts");
	assert.equal(src.includes("authorizeStorageOperation"), false);
	assert.equal(src.includes("missingRequiredRights"), false);
	assert.equal(src.includes("decideAthenaPolicy"), false);
	assert.equal(src.includes("resolveAthenaRuntimePrincipal"), false);
	assert.equal(src.includes("createBrowserStorageTransport"), false);
	assert.equal(/lookupSession|ATHENA_AUTH_SESSION/.test(src), false);
	assert.equal(src.includes("from \"../rights"), false);
	assert.equal(src.includes("runtime/authority"), false);
	const dto = readSrc("storage/runtime/types.ts");
	assert.equal(/\bBucket\b/.test(dto), false);
	assert.equal(dto.includes("ContinuationToken"), false);
	assert.match(dto, /cursor\?:/);
	assert.match(dto, /limit\?:/);
	assert.match(dto, /metadata\?:/);
});

test("T-S3-INJECTED: P?: S3 provider uses injected client not global AWS credentials", async () => {
	const s3 = createMemoryS3();
	const provider = createS3StorageProvider({
		bucket: "athena-objects",
		s3,
	});
	await provider.execute(
		authorized("put", { body: new Uint8Array([1]), key: "a.bin" }),
	);
	assert.equal(s3.calls.some((call) => call.method === "putObject"), true);
	assert.equal(s3.calls[0]?.input.Bucket, "athena-objects");
	const src = readSrc("storage/runtime/providers/s3-provider.ts");
	assert.equal(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(src), false);
	assert.equal(src.includes("from \"@aws-sdk/client-s3\""), false);
	assert.equal(src.includes("new S3Client"), false);
	assert.equal(src.includes("fromEnv"), false);
});

test("T-S3-ERRORS: P?: S3 NoSuchKey maps to storage_file_not_found 3005", async () => {
	const provider = createS3StorageProvider({
		bucket: "athena-objects",
		s3: createMemoryS3(),
	});
	const missing = await provider.execute(authorized("get", { key: "nope.txt" }));
	assert.equal(missing.ok, false);
	assert.equal(missing.error?.errorNumber, 3005);
	assert.equal(missing.error?.code, "storage_file_not_found");
	assert.equal(missing.status, 404);

	const failing = createS3StorageProvider({
		bucket: "athena-objects",
		s3: createMemoryS3({
			failGet: Object.assign(new Error("SlowDown"), {
				name: "SlowDown",
				$metadata: { httpStatusCode: 503 },
			}),
		}),
	});
	const slow = await failing.execute(authorized("get", { key: "k" }));
	assert.equal(slow.ok, false);
	assert.equal(slow.error?.errorNumber, 3010);
	assert.equal(slow.error?.code, "storage_internal");
	assert.notEqual(slow.error?.errorNumber, 3007);
	assert.notEqual(slow.error?.code, "storage_unavailable");
	assert.equal(slow.status, 500);
	assert.notEqual(slow.status, 503);
});

test("T-S3-PREFIX: P?: S3 provider applies bucket prefix contentType metadata and list cursor", async () => {
	const s3 = createMemoryS3();
	const provider = createS3StorageProvider({
		bucket: "athena-objects",
		prefix: "tenant-a",
		s3,
	});
	const put = await provider.execute(
		authorized("put", {
			body: new TextEncoder().encode("meta"),
			contentType: "application/json",
			key: "one.json",
			metadata: { role: "docs" },
		}),
	);
	assert.equal(put.ok, true);
	assert.equal(s3.calls.at(-1)?.input.Key, "tenant-a/one.json");
	assert.equal(s3.calls.at(-1)?.input.ContentType, "application/json");
	assert.deepEqual(s3.calls.at(-1)?.input.Metadata, { role: "docs" });

	await provider.execute(
		authorized("put", {
			body: new Uint8Array([2]),
			key: "two.json",
		}),
	);
	await provider.execute(
		authorized("put", {
			body: new Uint8Array([3]),
			key: "three.json",
		}),
	);
	const page = await provider.execute(
		authorized("list", { cursor: undefined, limit: 2, prefix: "" }),
	);
	assert.equal(page.ok, true);
	const data = page.data as {
		cursor?: string;
		objects: Array<{ key: string }>;
		truncated: boolean;
	};
	assert.equal(data.truncated, true);
	assert.equal(data.objects.length, 2);
	assert.equal(
		data.objects.every((object) => !object.key.startsWith("tenant-a/")),
		true,
	);
	const nextPage = await provider.execute(
		authorized("list", { cursor: data.cursor, limit: 2 }),
	);
	assert.equal(nextPage.ok, true);
	const nextData = nextPage.data as { objects: Array<{ key: string }> };
	assert.equal(
		nextData.objects.some((object) => object.key === "two.json"),
		true,
	);
	const head = await provider.execute(authorized("head", { key: "one.json" }));
	assert.equal(head.ok, true);
	const headData = head.data as {
		contentType?: string;
		metadata?: Record<string, string>;
	};
	assert.equal(headData.contentType, "application/json");
	assert.equal(headData.metadata?.role, "docs");
});

test("T-S3-PLAN: P?: Runtime Plan transport s3 materializes without createStorageClient", () => {
	const s3 = createMemoryS3();
	const plan = resolveRuntimePlan(
		{
			storage: {
				bucket: "athena-objects",
				prefix: "uploads/",
				provider: "s3",
				s3,
			},
		},
		{ environment: "node", trustedNode: true },
	);
	assert.equal(plan.storage.transport, "s3");
	assert.equal(plan.storage.wantsS3, true);
	const materialized = materializeStorage(
		{
			storage: {
				bucket: "athena-objects",
				prefix: "uploads/",
				provider: "s3",
				s3,
			},
		},
		plan,
	);
	assert.ok(materialized.storage);
	const client = createClient({
		storage: {
			bucket: "athena-objects",
			provider: "s3",
			s3,
		},
	});
	assert.ok(getAthenaClientInternals(client)?.storageRuntime);
	assert.equal(client.capabilities.storage.objects, true);
	assert.equal(readSrc("v3-client-core.ts").includes("createStorageClient"), false);
	assert.equal(readSrc("runtime/materializers/storage.ts").includes("s3-provider"), true);
	assert.equal(readSrc("runtime/materializers/storage.ts").includes("createStorageClient"), false);
	assert.match(readSrc("runtime/plan/types.ts"), /wantsS3: boolean/);
});

test("T-S3-FAIL-CLOSED: P?: S3 combined with local R2 or url fails closed", () => {
	const s3 = createMemoryS3();
	assert.throws(
		() =>
			validateRuntimePlan(
				resolveRuntimePlan(
					{
						storage: {
							bucket: "athena-objects",
							provider: "s3",
							root: "/tmp/athena-s3-local",
							s3,
						},
					},
					{ environment: "node", trustedNode: true },
				),
			),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_RUNTIME_CONFIG_INVALID",
	);
	assert.throws(
		() =>
			validateRuntimePlan(
				resolveRuntimePlan(
					{
						storage: {
							bucket: "athena-objects",
							provider: "s3",
							r2: { get: () => null, put: () => null },
							s3,
						},
					},
					{ environment: "node", trustedNode: true },
				),
			),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_RUNTIME_CONFIG_INVALID",
	);
	assert.throws(
		() =>
			validateRuntimePlan(
				resolveRuntimePlan(
					{
						storage: {
							bucket: "athena-objects",
							provider: "s3",
							s3,
							url: "https://storage.example.com",
						},
					},
					{ environment: "node", trustedNode: true },
				),
			),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_RUNTIME_CONFIG_INVALID",
	);
	assert.throws(
		() =>
			materializeStorage({
				storage: {
					provider: "s3",
					s3,
				},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_RUNTIME_CONFIG_INVALID",
	);
	assert.throws(
		() =>
			materializeStorage({
				storage: {
					bucket: "athena-objects",
					provider: "s3",
				},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_RUNTIME_CONFIG_INVALID",
	);
});

test("T-S3-BUNDLE: P?: browser graph has no s3-provider AWS SDK or secret access keys", () => {
	const files = [
		"browser.ts",
		"v3-client-core.ts",
		"next/client.ts",
		"react-native/index.ts",
		"storage/runtime/browser-transport.ts",
		"storage/runtime/index.ts",
		"storage/runtime/nucleus.ts",
		"storage/runtime/overlays.ts",
	];
	const blob = files.map((rel) => readSrc(rel)).join("\n");
	assert.equal(blob.includes("providers/s3-provider"), false);
	assert.equal(blob.includes("@aws-sdk/client-s3"), false);
	assert.equal(/aws_secret_access_key|secretAccessKey/.test(blob), false);
	assert.equal(/AWS_SECRET_ACCESS_KEY/.test(blob), false);
	const coreFiles = collectTsFiles(join(srcRoot)).filter((path) =>
		/browser\.ts|next[/\\]client\.ts|react-native[/\\]index\.ts|v3-client-core\.ts/.test(
			path,
		),
	);
	for (const file of coreFiles) {
		const text = readFileSync(file, "utf8");
		assert.equal(text.includes("s3-provider"), false, file);
	}
	const audit = readFileSync(
		join(pkgRoot, "scripts", "audit-browser-bundle-safety.mjs"),
		"utf8",
	);
	assert.equal(audit.includes("s3-provider"), true);
	assert.equal(audit.includes("@aws-sdk/client-s3"), true);
});

test("T-S3-NODE: P?: provider s3 requires trusted Node runtime", () => {
	const s3 = createMemoryS3();
	assert.throws(
		() =>
			resolveRuntimePlan(
				{
					storage: {
						bucket: "athena-objects",
						provider: "s3",
						s3,
					},
				},
				{ environment: "browser", trustedNode: false },
			),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_STORAGE_S3_NODE_REQUIRED",
	);
	assert.throws(
		() =>
			createBrowserClient({
				storage: {
					bucket: "athena-objects",
					provider: "s3",
					s3,
				},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_STORAGE_S3_NODE_REQUIRED",
	);
	for (const rel of ["browser.ts", "next/client.ts", "react-native/client.ts"]) {
		const src = readSrc(rel);
		assert.equal(src.includes("assertS3StorageRequiresNodeRuntime"), true, rel);
	}
	assert.match(
		readSrc("config/errors.ts"),
		/\| "ATHENA_STORAGE_S3_NODE_REQUIRED"/,
	);
});

test("T-S3-NO-CTOR: P?: createStorageClient is not recommended or exported", async () => {
	const mod = await import("../../src/index.ts");
	assert.equal("createStorageClient" in mod, false);
	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
		exports?: Record<string, unknown>;
	};
	assert.equal(pkg.exports?.["./storage-client"], undefined);
	assert.equal(pkg.exports?.["./s3"], undefined);
	const deps = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
	};
	for (const bag of [
		deps.dependencies,
		deps.devDependencies,
		deps.optionalDependencies,
		deps.peerDependencies,
	]) {
		assert.equal(Object.keys(bag ?? {}).some((name) => name.startsWith("@aws-sdk/")), false);
	}
});

test("T-S3-CONFORM: P?: S3 get put head list delete match R2 overlapping error and round-trip semantics", async () => {
	const s3 = createMemoryS3();
	const s3Provider = createS3StorageProvider({
		bucket: "athena-objects",
		s3,
	});
	const r2Provider = createR2StorageProvider(createMemoryR2() as never);
	const key = "overlap.bin";
	const body = new TextEncoder().encode("same-bytes");
	for (const provider of [s3Provider, r2Provider]) {
		const missingGet = await provider.execute(authorized("get", { key }));
		assert.equal(missingGet.ok, false);
		assert.equal(missingGet.error?.errorNumber, 3005);
		const missingHead = await provider.execute(authorized("head", { key }));
		assert.equal(missingHead.ok, false);
		assert.equal(missingHead.error?.errorNumber, 3005);
		const noKey = await provider.execute(authorized("put", { body }));
		assert.equal(noKey.ok, false);
		assert.equal(noKey.error?.errorNumber, 3000);
		const put = await provider.execute(authorized("put", { body, key }));
		assert.equal(put.ok, true);
		const got = await provider.execute(authorized("get", { key }));
		assert.equal(got.ok, true);
		assert.equal(new TextDecoder().decode(got.data as Uint8Array), "same-bytes");
		const listed = await provider.execute(authorized("list", { prefix: "overlap" }));
		assert.equal(listed.ok, true);
		const deleted = await provider.execute(authorized("delete", { key }));
		assert.equal(deleted.ok, true);
		const missingAgain = await provider.execute(authorized("delete", { key }));
		assert.equal(missingAgain.ok, true);
	}

	const client = createClient({
		storage: {
			bucket: "athena-objects",
			provider: "s3",
			s3: createMemoryS3(),
		},
	});
	await client.storage.file.upload({
		name: "via-file.txt",
		source: new TextEncoder().encode("facade"),
		storage_key: "via-file.txt",
	} as never);
	const fetched = await client.storage.file.get({
		storage_key: "via-file.txt",
	} as never);
	assert.equal(new TextDecoder().decode(fetched as Uint8Array), "facade");
});
