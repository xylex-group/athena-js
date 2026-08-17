import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../src/v3-client.ts";

function createMockResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

test("storage.directUpload sends file bytes to R2 while preserving managed upload results", async () => {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const requestUrl = String(url);
		calls.push({ init, url: requestUrl });
		if (requestUrl.startsWith("https://athena.example.com/")) {
			return createMockResponse({
				data: {
					file: {
						bucket: "documents",
						created_at: "2026-07-13T00:00:00.000Z",
						id: "file_1",
						is_public: false,
						metadata: {},
						name: "hello.txt",
						organization_id: "org_1",
						status: "pending",
						storage_key: "uploads/hello.txt",
						updated_at: "2026-07-13T00:00:00.000Z",
					},
					upload: {
						bucket: "documents",
						cache_hit: false,
						cache_layer: "none",
						expires_at: "2026-07-13T01:00:00.000Z",
						expires_at_epoch_seconds: 1_781_312_400,
						expires_in: 3600,
						file_id: "file_1",
						headers: { "Content-Type": "text/plain" },
						purpose: "upload",
						storage_key: "uploads/hello.txt",
						url: "https://server-presigned.example.com/should-not-be-used",
					},
				},
				message: "created",
				status: "ok",
			});
		}
		return new Response(null, { status: 200 });
	};

	try {
		const client = createClient({
			client: "direct_upload_test",
			key: "secret",
			storage: {
				directUpload: {
					accessKeyId: "a".repeat(32),
					bucket: "documents",
					endpoint: "https://account.r2.cloudflarestorage.com",
					region: "auto",
					secretAccessKey: "secret-key",
				},
				url: "https://athena.example.com",
			},
		});

		const result = await client.storage.file.upload({
			fileName: "hello.txt",
			files: new Blob(["hello"], { type: "text/plain" }),
			s3_id: "s3_1",
			storage_key: "uploads/hello.txt",
		});

		assert.equal(result.count, 1);
		assert.equal(result.files[0].file.id, "file_1");
		assert.equal(calls.length, 2);
		assert.equal(
			new URL(calls[1].url).pathname,
			"/documents/uploads/hello.txt",
		);
		assert.equal(
			new URL(calls[1].url).hostname,
			"account.r2.cloudflarestorage.com",
		);
		const directHeaders = calls[1].init?.headers as Record<string, string>;
		assert.match(
			directHeaders.authorization,
			/^AWS4-HMAC-SHA256 Credential=a{32}\/\d{8}\/auto\/s3\/aws4_request/,
		);
		assert.equal(directHeaders["x-amz-content-sha256"]?.length, 64);
		assert.equal(directHeaders["x-amz-date"]?.length, 16);
		const uploadBody = calls[1].init?.body;
		assert.ok(uploadBody instanceof Blob);
		assert.equal(uploadBody.size, 5);
		assert.equal(calls[0].init?.method, "POST");
		assert.deepEqual(JSON.parse(calls[0].init?.body as string), {
			content_type: "text/plain",
			mime_type: "text/plain",
			name: "hello.txt",
			original_name: "hello.txt",
			s3_id: "s3_1",
			size_bytes: 5,
			storage_key: "uploads/hello.txt",
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});
