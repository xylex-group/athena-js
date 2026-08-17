/**
 * Regression: storage.backup must share AthenaStorageError + onError with the
 * rest of client.storage (no hand-rolled Error name=AthenaStorageError stack).
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { AthenaStorageError, createClient } from "../src/index.ts";

function createMockResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: {
			"Content-Type": "application/json",
			"x-athena-request-id": "req_backup_test_1",
		},
		status,
	});
}

test("storage.backup 4xx throws AthenaStorageError with .code and fires onError", async () => {
	const originalFetch = globalThis.fetch;
	const observed: AthenaStorageError[] = [];

	globalThis.fetch = async () =>
		createMockResponse(
			{
				error: "backup not found",
				message: "No archive for key",
			},
			404,
		);

	try {
		const client = createClient({
			client: "backup_error_client",
			key: "secret",
			storage: {
				onError: (error) => {
					observed.push(error);
				},
				url: "https://athena.example.com",
			},
		});

		await assert.rejects(
			() => client.storage.backup.list({ limit: 5 }),
			(error: unknown) => {
				assert.ok(
					error instanceof AthenaStorageError,
					"expected real AthenaStorageError instance",
				);
				assert.equal(error.name, "AthenaStorageError");
				assert.equal(error.code, "HTTP_ERROR");
				assert.equal(error.status, 404);
				assert.equal(error.requestId, "req_backup_test_1");
				assert.match(error.message, /No archive for key|404|backup/i);
				assert.ok(error.normalized);
				assert.equal(typeof error.normalized.operation, "string");
				return true;
			},
		);

		assert.equal(observed.length, 1);
		assert.ok(observed[0] instanceof AthenaStorageError);
		assert.equal(observed[0]?.code, "HTTP_ERROR");
		assert.equal(observed[0]?.requestId, "req_backup_test_1");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("storage.backup list/create succeed through shared transport", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ method?: string; url: string }> = [];

	globalThis.fetch = async (url, init) => {
		calls.push({ method: init?.method, url: String(url) });
		const href = String(url);
		if (href.includes("/admin/backups") && (init?.method ?? "GET") === "GET") {
			return createMockResponse({
				backups: [
					{
						client_name: "demo",
						completed_at: "2026-07-01T00:00:00Z",
						job_id: 9,
						s3_bucket: "backups",
						s3_key: "demo/archive.dump",
						size_bytes: 100,
					},
				],
				next_cursor: null,
			});
		}
		if (href.endsWith("/admin/backups") && init?.method === "POST") {
			return createMockResponse({
				client_name: "demo",
				job_id: 42,
				status: "pending",
			});
		}
		return createMockResponse({ error: "unexpected" }, 500);
	};

	try {
		const client = createClient({
			client: "backup_ok_client",
			key: "secret",
			storage: { url: "https://athena.example.com" },
		});

		const page = await client.storage.backup.list({ limit: 10 });
		assert.equal(page.backups.length, 1);
		assert.equal(page.backups[0]?.key, "demo/archive.dump");
		assert.equal(page.next_cursor, null);

		const queued = await client.storage.backup.create({ client_name: "demo" });
		assert.equal(queued.job_id, 42);
		assert.equal(queued.status, "pending");
		assert.equal(queued.client_name, "demo");

		assert.ok(calls.some((c) => c.url.includes("/admin/backups")));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("storage.backup delete missing key throws AthenaStorageError", async () => {
	const client = createClient({
		client: "backup_key_client",
		key: "secret",
		storage: { url: "https://athena.example.com" },
	});

	await assert.rejects(
		() => client.storage.backup.delete("  "),
		(error: unknown) => {
			assert.ok(error instanceof AthenaStorageError);
			assert.equal(error.code, "HTTP_ERROR");
			assert.equal(error.status, 400);
			assert.match(error.message, /Backup object key is required/);
			return true;
		},
	);
});
