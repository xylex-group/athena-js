import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	requireStorageManifestRoute,
	storageLiveHttpRoutes,
	storageSdkManifest,
} from "../src/storage/module.ts";
import { createClient } from "../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const inventoryPath = join(repoRoot, "contracts/storage/live-http-routes.json");
const jsMirrorPath = join(here, "../src/storage/live-http-routes.json");

interface InventoryRoute {
	method: string;
	path: string;
	surface?: string;
}

interface InventoryDocument {
	domain: string;
	routes: InventoryRoute[];
	schemaVersion: number;
}

function createMockResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function routeKey(method: string, path: string): string {
	return `${method.toUpperCase()} ${path}`;
}

function loadInventory(path: string): InventoryDocument {
	return JSON.parse(
		readFileSync(path, "utf8").replace(/^\uFEFF/, ""),
	) as InventoryDocument;
}

function inventoryKeys(doc: InventoryDocument): Set<string> {
	return new Set(doc.routes.map((row) => routeKey(row.method, row.path)));
}

function manifestKeys(): Set<string> {
	return new Set(
		storageSdkManifest.methods.map(({ method, path }) =>
			routeKey(method, path),
		),
	);
}

test("storage live inventory is present and non-empty", () => {
	const inventory = loadInventory(inventoryPath);
	assert.equal(inventory.schemaVersion, 1);
	assert.equal(inventory.domain, "storage");
	assert.ok(inventory.routes.length >= 70);
	assert.equal(
		(inventory as InventoryDocument & { sourceOfTruth?: string }).sourceOfTruth,
		"packages/athena-js/src/storage/module.ts storageSdkManifest",
	);
});

test("JS storage inventory mirror matches contracts/storage/live-http-routes.json", () => {
	const canonical = loadInventory(inventoryPath);
	const mirror = loadInventory(jsMirrorPath);
	assert.deepEqual(inventoryKeys(mirror), inventoryKeys(canonical));
	assert.deepEqual(
		inventoryKeys(storageLiveHttpRoutes as InventoryDocument),
		inventoryKeys(canonical),
	);
});

test("storageSdkManifest matches live inventory METHOD+path set exactly", () => {
	const inventory = inventoryKeys(loadInventory(inventoryPath));
	const manifest = manifestKeys();

	const missingInManifest = [...inventory]
		.filter((key) => !manifest.has(key))
		.sort((a, b) => String(a).localeCompare(String(b)));
	const extraInManifest = [...manifest]
		.filter((key) => !inventory.has(key))
		.sort((a, b) => String(a).localeCompare(String(b)));

	assert.deepEqual(
		missingInManifest,
		[],
		`storageSdkManifest missing inventory routes: ${missingInManifest.join(", ")}`,
	);
	assert.deepEqual(
		extraInManifest,
		[],
		`storageSdkManifest has routes not in inventory: ${extraInManifest.join(", ")}`,
	);
});

test("storageSdkManifest METHOD+path set is non-empty and unique", () => {
	const routes = storageSdkManifest.methods.map(({ method, path }) =>
		routeKey(method, path),
	);
	assert.ok(routes.length >= 70);
	assert.equal(new Set(routes).size, routes.length);
	// Dual visibility verbs must both remain first-class (PATCH + POST).
	assert.ok(routes.includes("PATCH /storage/files/{file_id}/visibility"));
	assert.ok(routes.includes("POST /storage/files/{file_id}/visibility"));
	// Inventory extras that the old one-way expectedRoutes list omitted:
	assert.ok(routes.includes("GET /storage/files/{file_id}/proxy-url"));
	assert.ok(routes.includes("POST /storage/objects/post-policy"));
	assert.ok(routes.includes("POST /storage/buckets/lifecycle/delete"));
	assert.ok(routes.includes("POST /storage/folders/move"));
	assert.ok(routes.includes("GET /admin/backups"));
	assert.ok(routes.includes("GET /storage/files/{file_id}/retention"));
});

test("inventory-only fake route fails exact-set parity (RED proof shape)", () => {
	// Simulates adding a route to the live inventory without wiring storageSdkManifest.
	// Exact-set parity must fail until the manifest (and thin binder) are updated.
	const inventory = inventoryKeys(loadInventory(inventoryPath));
	const fake = "POST /storage/__inventory_only_fake_route__";
	const poisoned = new Set(inventory);
	poisoned.add(fake);
	const manifest = manifestKeys();
	const missingInManifest = [...poisoned]
		.filter((key) => !manifest.has(key))
		.sort((a, b) => String(a).localeCompare(String(b)));
	assert.deepEqual(missingInManifest, [fake]);
});

test("requireStorageManifestRoute is the SSOT lookup for thin route binding", () => {
	const listObjects = requireStorageManifestRoute("listStorageObjects");
	assert.equal(listObjects.method, "POST");
	assert.equal(listObjects.path, "/storage/objects");
	assert.equal(listObjects.responseEnvelope, "athena");

	const getFile = requireStorageManifestRoute("getStorageFile");
	assert.equal(getFile.method, "GET");
	assert.equal(getFile.path, "/storage/files/{file_id}");

	assert.throws(
		() =>
			requireStorageManifestRoute(
				"notARealStorageRoute" as typeof listObjects.name,
			),
		/Unknown storageSdkManifest route/,
	);
});

test("createClient().storage thin routes map methodâ†’fetch from storageSdkManifest", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ method: string; path: string }> = [];

	globalThis.fetch = async (url, init) => {
		const parsed = new URL(String(url));
		calls.push({
			method: (init?.method ?? "GET").toUpperCase(),
			path: parsed.pathname,
		});
		return createMockResponse({
			data: { ok: true },
			message: "ok",
			status: "success",
		});
	};

	try {
		const client = createClient({
			client: "storage_manifest_matrix",
			key: "secret",
			storage: { url: "https://athena-db.com/storage" },
		});

		// Simple file GETs (path-param) first â€” incremental SSOT slice.
		await client.storage.file.get("file_1");
		await client.storage.file.publicUrl("file_1");
		await client.storage.file.versions("file_1");
		await client.storage.file.url("file_1", { purpose: "download" });

		// Static-path object / bucket / permission / folder / audit thin POSTs.
		const conn = { s3_id: "catalog-1" as const };
		const objectBody = { ...conn, bucket: "documents", key: "a.txt" };
		const bucketBody = { ...conn, bucket: "documents" };
		await client.storage.object.list(bucketBody);
		await client.storage.object.head(objectBody);
		await client.storage.object.exists(objectBody);
		await client.storage.object.validate(objectBody);
		await client.storage.object.update({
			...objectBody,
			metadata: {} as Record<string, string>,
		});
		await client.storage.object.copy({
			...bucketBody,
			destination_key: "b.txt",
			source_key: "a.txt",
		});
		await client.storage.object.url(objectBody);
		await client.storage.object.publicUrl(objectBody);
		await client.storage.object.delete(objectBody);
		await client.storage.object.uploadUrl(objectBody);
		await client.storage.object.postPolicy(objectBody);
		await client.storage.object.versions(objectBody);
		await client.storage.object.restoreVersion({
			...objectBody,
			version_id: "v1",
		});
		await client.storage.object.deleteVersion({
			...objectBody,
			version_id: "v1",
		});
		await client.storage.object.folder.create({
			...bucketBody,
			prefix: "reports/",
		});
		await client.storage.object.folder.delete({
			...bucketBody,
			prefix: "reports/",
		});
		await client.storage.object.folder.rename({
			...bucketBody,
			from_prefix: "reports/",
			to_prefix: "archive/",
		});

		await client.storage.bucket.list({});
		await client.storage.bucket.create(bucketBody);
		await client.storage.bucket.delete(bucketBody);
		await client.storage.bucket.lifecycle.get(bucketBody);
		await client.storage.bucket.lifecycle.set({
			...bucketBody,
			rules: [],
		});
		await client.storage.bucket.lifecycle.delete(bucketBody);
		await client.storage.bucket.policy.get(bucketBody);
		await client.storage.bucket.policy.set({
			...bucketBody,
			policy: {},
		});
		await client.storage.bucket.policy.delete(bucketBody);
		await client.storage.bucket.publicAccess.get(bucketBody);
		await client.storage.bucket.publicAccess.set({
			...bucketBody,
			block_public_acls: true,
		});
		await client.storage.bucket.publicAccess.delete(bucketBody);
		await client.storage.bucket.cors.get(bucketBody);
		await client.storage.bucket.cors.set({ ...bucketBody, rules: [] });
		await client.storage.bucket.cors.delete(bucketBody);

		await client.storage.permission.list({ file_id: "file_1" });
		await client.storage.permission.grant({
			file_id: "file_1",
			permission: "read",
			principal_id: "user_1",
			principal_type: "user",
		});
		await client.storage.permission.revoke({
			file_id: "file_1",
			permission: "read",
			principal_id: "user_1",
			principal_type: "user",
		});
		await client.storage.permission.check({
			file_id: "file_1",
			permission: "read",
		});

		await client.storage.folder.list({ prefix: "a/", s3_id: "catalog-1" });
		await client.storage.folder.tree({ prefix: "a/", s3_id: "catalog-1" });
		await client.storage.folder.move({
			from_prefix: "a/",
			s3_id: "catalog-1",
			to_prefix: "b/",
		});
		await client.storage.folder.delete({
			prefix: "a/",
			s3_id: "catalog-1",
		});

		await client.storage.audit.list({ limit: 10 });

		const observed = new Set(
			calls.map((call) => routeKey(call.method, call.path)),
		);

		const expectedThin = [
			"GET /storage/files/file_1",
			"GET /storage/files/file_1/public-url",
			"GET /storage/files/file_1/versions",
			"GET /storage/files/file_1/url",
			"POST /storage/objects",
			"POST /storage/objects/head",
			"POST /storage/objects/exists",
			"POST /storage/objects/validate",
			"POST /storage/objects/update",
			"POST /storage/objects/copy",
			"POST /storage/objects/url",
			"POST /storage/objects/public-url",
			"POST /storage/objects/delete",
			"POST /storage/objects/upload-url",
			"POST /storage/objects/post-policy",
			"POST /storage/objects/versions",
			"POST /storage/objects/versions/restore",
			"POST /storage/objects/versions/delete",
			"POST /storage/objects/folder",
			"POST /storage/objects/folder/delete",
			"POST /storage/objects/folder/rename",
			"POST /storage/buckets/list",
			"POST /storage/buckets/create",
			"POST /storage/buckets/delete",
			"POST /storage/buckets/lifecycle",
			"POST /storage/buckets/lifecycle/set",
			"POST /storage/buckets/lifecycle/delete",
			"POST /storage/buckets/policy",
			"POST /storage/buckets/policy/set",
			"POST /storage/buckets/policy/delete",
			"POST /storage/buckets/public-access",
			"POST /storage/buckets/public-access/set",
			"POST /storage/buckets/public-access/delete",
			"POST /storage/buckets/cors",
			"POST /storage/buckets/cors/set",
			"POST /storage/buckets/cors/delete",
			"POST /storage/permissions/list",
			"POST /storage/permissions/grant",
			"POST /storage/permissions/revoke",
			"POST /storage/permissions/check",
			"POST /storage/folders/list",
			"POST /storage/folders/tree",
			"POST /storage/folders/move",
			"POST /storage/folders/delete",
			"POST /storage/audit/list",
		];

		for (const key of expectedThin) {
			assert.ok(
				observed.has(key),
				`thin binder did not hit ${key}; observed=${[...observed].join(", ")}`,
			);
		}

		// Every observed call must still be a concrete instance of a manifest template.
		for (const call of calls) {
			const matched = storageSdkManifest.methods.some((route) => {
				if (route.method !== call.method) {
					return false;
				}
				const pattern = `^${route.path
					.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
					.replace(/\\\{[^/]+\\\}/g, "[^/]+")}$`;
				return new RegExp(pattern).test(call.path);
			});
			assert.ok(
				matched,
				`fetch ${call.method} ${call.path} does not match any storageSdkManifest route`,
			);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("storage visibility helpers route PATCH, POST, and bulk POST correctly", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const file = {
		bucket: "documents",
		created_at: "2026-06-18T00:00:00Z",
		id: "file_1",
		is_public: true,
		metadata: {},
		name: "report.pdf",
		organization_id: "org_1",
		status: "ready",
		storage_key: "reports/report.pdf",
		updated_at: "2026-06-18T00:00:00Z",
	};

	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		const parsedUrl = new URL(String(url));

		if (parsedUrl.pathname === "/storage/files/visibility-many") {
			return createMockResponse({
				data: {
					count: 1,
					files: [file],
				},
				message: "ok",
				status: "success",
			});
		}

		if (parsedUrl.pathname === "/storage/files/file_1/visibility") {
			return createMockResponse({
				data: {
					file,
				},
				message: "ok",
				status: "success",
			});
		}

		return createMockResponse(
			{ error: `unexpected ${init?.method} ${parsedUrl.pathname}` },
			404,
		);
	};

	try {
		const client = createClient({
			client: "storage_visibility",
			key: "secret",
			storage: { url: "https://athena-db.com/storage" },
		});

		await client.storage.setStorageFileVisibility("file_1", { public: true });
		await client.storage.file.visibility.update("file_1", {
			visibility: "organization",
		});
		await client.storage.file.visibility.set("file_1", { public: false });
		await client.storage.file.visibility.setMany({
			file_ids: ["file_1"],
			visibility: "public",
		});

		const observed = calls.map((call) => {
			const parsedUrl = new URL(call.url);
			return {
				body: call.init?.body
					? JSON.parse(call.init.body as string)
					: undefined,
				client:
					call.init?.headers instanceof Headers
						? call.init.headers.get("X-Athena-Client")
						: (call.init?.headers as Record<string, string> | undefined)?.[
								"X-Athena-Client"
							],
				method: call.init?.method,
				path: parsedUrl.pathname,
			};
		});

		assert.deepEqual(observed, [
			{
				body: { public: true },
				client: "storage_visibility",
				method: "PATCH",
				path: "/storage/files/file_1/visibility",
			},
			{
				body: { visibility: "organization" },
				client: "storage_visibility",
				method: "PATCH",
				path: "/storage/files/file_1/visibility",
			},
			{
				body: { public: false },
				client: "storage_visibility",
				method: "POST",
				path: "/storage/files/file_1/visibility",
			},
			{
				body: { file_ids: ["file_1"], visibility: "public" },
				client: "storage_visibility",
				method: "POST",
				path: "/storage/files/visibility-many",
			},
		]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("storage.object.uploadUrl accepts catalog-backed raw requests without inline secrets", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];

	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		return createMockResponse({
			data: {
				headers: {},
				url: "https://example.test/upload",
			},
			message: "ok",
			status: "success",
		});
	};

	try {
		const client = createClient({
			client: "storage_raw_catalog",
			key: "secret",
			storage: { url: "https://athena-db.com/storage" },
		});

		await client.storage.object.uploadUrl({
			bucket: "documents",
			content_type: "application/pdf",
			key: "reports/q1.pdf",
			s3_id: "catalog-1",
		});

		assert.equal(calls.length, 1);
		const request = calls[0];
		assert.equal(new URL(request.url).pathname, "/storage/objects/upload-url");
		assert.equal(request.init?.method, "POST");
		assert.deepEqual(JSON.parse(request.init?.body as string), {
			bucket: "documents",
			content_type: "application/pdf",
			key: "reports/q1.pdf",
			s3_id: "catalog-1",
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("storage.object.uploadUrl preserves inline credential serialization for compatibility callers", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];

	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		return createMockResponse({
			data: {
				headers: {},
				url: "https://example.test/upload",
			},
			message: "ok",
			status: "success",
		});
	};

	try {
		const client = createClient({
			client: "storage_raw_inline",
			key: "secret",
			storage: { url: "https://athena-db.com/storage" },
		});

		await client.storage.object.uploadUrl({
			access_key_id: "access-key",
			bucket: "documents",
			content_type: "application/pdf",
			endpoint: "https://account.r2.cloudflarestorage.com",
			key: "reports/q1.pdf",
			region: "auto",
			secret_key: "secret-key",
		});

		assert.equal(calls.length, 1);
		const request = calls[0];
		assert.equal(new URL(request.url).pathname, "/storage/objects/upload-url");
		assert.equal(request.init?.method, "POST");
		assert.deepEqual(JSON.parse(request.init?.body as string), {
			access_key_id: "access-key",
			bucket: "documents",
			content_type: "application/pdf",
			endpoint: "https://account.r2.cloudflarestorage.com",
			key: "reports/q1.pdf",
			region: "auto",
			secret_key: "secret-key",
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("getStorageFileProxy returns a raw binary Response without JSON parsing", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const payload = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		return new Response(payload, {
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Disposition": 'inline; filename="report.pdf"',
				"Content-Length": String(payload.byteLength),
				"Content-Type": "application/pdf",
				ETag: '"etag-1"',
			},
			status: 200,
		});
	};

	try {
		const client = createClient({
			client: "storage_proxy_client",
			key: "secret",
			storage: { url: "https://athena-db.com/storage" },
		});

		const response = await client.storage.getStorageFileProxy("file_1", {
			purpose: "stream",
		});

		assert.equal(calls.length, 1);
		const request = calls[0];
		const parsedUrl = new URL(request.url);
		assert.equal(request.init?.method, "GET");
		assert.equal(parsedUrl.pathname, "/storage/files/file_1/proxy");
		assert.equal(parsedUrl.searchParams.get("purpose"), "stream");

		const requestHeaders = request.init?.headers;
		const clientHeader =
			requestHeaders instanceof Headers
				? requestHeaders.get("X-Athena-Client")
				: (requestHeaders as Record<string, string> | undefined)?.[
						"X-Athena-Client"
					];
		assert.equal(clientHeader, "storage_proxy_client");

		assert.ok(response instanceof Response);
		assert.equal(response.ok, true);
		assert.equal(response.headers.get("content-type"), "application/pdf");
		assert.equal(
			response.headers.get("content-disposition"),
			'inline; filename="report.pdf"',
		);
		assert.equal(response.headers.get("etag"), '"etag-1"');
		assert.equal(response.headers.get("cache-control"), "private, no-store");

		const bytes = new Uint8Array(await response.arrayBuffer());
		assert.deepEqual(Array.from(bytes), Array.from(payload));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("getStorageFileProxy throws on non-JSON error bodies without treating success as JSON", async () => {
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async () =>
		new Response("proxy upstream failed", {
			headers: { "Content-Type": "text/plain" },
			status: 502,
		});

	try {
		const client = createClient({
			client: "storage_proxy_error",
			key: "secret",
			storage: { url: "https://athena-db.com/storage" },
		});

		await assert.rejects(
			() =>
				client.storage.getStorageFileProxy("file_1", { purpose: "download" }),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.match(error.message, /502|proxy upstream failed|storage/i);
				return true;
			},
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("getStorageFileUrl remains JSON-envelope based and is unchanged by proxy support", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; init?: RequestInit }> = [];

	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		return createMockResponse({
			data: {
				expires_at: "2026-07-01T00:00:00Z",
				url: "https://signed.example/file",
			},
			message: "ok",
			status: "success",
		});
	};

	try {
		const client = createClient({
			client: "storage_url_client",
			key: "secret",
			storage: { url: "https://athena-db.com/storage" },
		});

		const result = await client.storage.getStorageFileUrl("file_1", {
			purpose: "download",
		});

		assert.equal(calls.length, 1);
		const parsedUrl = new URL(calls[0].url);
		assert.equal(parsedUrl.pathname, "/storage/files/file_1/url");
		assert.equal(parsedUrl.searchParams.get("purpose"), "download");
		assert.equal(result.url, "https://signed.example/file");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
