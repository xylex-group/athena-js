/**
 * Target suite (no-delta lock-in): same acceptance as baseline / shipped behavior.
 * Dual-green intentional until a real product delta SDD supersedes baseline.
 * See docs/sdd/create-client-mode-nullish-telemetry-smoke.md.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../../src/v3-client.ts";
import { createSddMockD1, createSddMockR2 } from "./sdd-mocks.ts";

test("target: omitted mode/prefer is not a mode hint (storage-only R2 materializes)", async () => {
	const r2 = createSddMockR2();
	const client = createClient({
		storage: { prefix: "app/", r2 },
	});

	assert.equal(client.capabilities.mode, "cloudflare-edge");
	assert.equal(client.capabilities.storage.local, true);
	assert.equal(client.capabilities.storage.objects, true);
	assert.equal(client.capabilities.db.local, false);
	assert.equal(client.capabilities.db.layers.query, false);

	await client.storage.putObject({ body: "solo", key: "only.txt" });
	assert.ok(r2.objects.has("app/only.txt"));
});

test("target: explicit null mode/prefer is not a mode hint (storage-only R2 materializes)", async () => {
	const r2 = createSddMockR2();
	const client = createClient({
		mode: null,
		prefer: null,
		storage: { prefix: "nullish/", r2 },
	});

	assert.equal(client.capabilities.mode, "cloudflare-edge");
	assert.equal(client.capabilities.storage.local, true);
	assert.equal(client.capabilities.storage.objects, true);
	assert.equal(client.capabilities.db.local, false);

	await client.storage.putObject({ body: "null-mode", key: "n.txt" });
	assert.ok(r2.objects.has("nullish/n.txt"));
});

test("target: non-null mode/prefer still resolve (prefer gateway drops local db)", () => {
	const db = createSddMockD1();
	const client = createClient({
		d1: db,
		key: "k",
		mode: "auto",
		prefer: "gateway",
		url: "https://athena.example.com",
	});

	assert.equal(client.capabilities.mode, "gateway");
	assert.equal(client.capabilities.db.local, false);
});
