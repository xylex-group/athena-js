/**
 * Optional live PostgreSQL 17 CAS + .or() + insert.single() acceptance.
 * Runs when ATHENA_PG_DIRECT_URI or DATABASE_URL is set.
 */
import { strict as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "../../src/index.ts";

const LIVE_URI = (
	process.env.ATHENA_PG_DIRECT_URI ??
	process.env.DATABASE_URL ??
	""
).trim();

const live = { skip: !LIVE_URI };

test(
	"live PG: Speedrun form create insert.single without Gateway",
	live,
	async () => {
		const client = createClient({ db: { pgUri: LIVE_URI }, env: {} });
		const setup = await client.query(`
    CREATE TABLE IF NOT EXISTS forms_cas_smoke (
      id uuid PRIMARY KEY,
      schema_revision int NOT NULL,
      name text
    )
  `);
		assert.equal(setup.error, undefined, String(setup.error ?? ""));

		const id = randomUUID();
		const inserted = await client
			.from("forms_cas_smoke")
			.insert({ id, name: "create", schema_revision: 10 })
			.single();
		assert.equal(inserted.error, null, String(inserted.error ?? ""));
		assert.ok(inserted.data);
		assert.equal(
			(inserted.data as { schema_revision: number }).schema_revision,
			10,
		);
	},
);

test("live PG: schema CAS affectedRows 1 then 0 is atomic", live, async () => {
	const client = createClient({ db: { pgUri: LIVE_URI }, env: {} });
	const id = randomUUID();
	await client
		.from("forms_cas_smoke")
		.insert({ id, name: "cas", schema_revision: 10 });

	const first = await client
		.from("forms_cas_smoke")
		.update({ schema_revision: 11 })
		.eq("id", id)
		.eq("schema_revision", 10);
	assert.equal(first.error, null, String(first.error ?? ""));
	assert.equal(first.affectedRows, 1);

	const stale = await client
		.from("forms_cas_smoke")
		.update({ schema_revision: 11 })
		.eq("id", id)
		.eq("schema_revision", 10);
	assert.equal(stale.error, null, String(stale.error ?? ""));
	assert.equal(stale.affectedRows, 0);
});

test("live PG: two concurrent CAS writers — only one wins", live, async () => {
	const a = createClient({ db: { pgUri: LIVE_URI }, env: {} });
	const b = createClient({ db: { pgUri: LIVE_URI }, env: {} });
	const id = randomUUID();
	await a
		.from("forms_cas_smoke")
		.insert({ id, name: "race", schema_revision: 10 });

	const [left, right] = await Promise.all([
		a
			.from("forms_cas_smoke")
			.update({ schema_revision: 11 })
			.eq("id", id)
			.eq("schema_revision", 10),
		b
			.from("forms_cas_smoke")
			.update({ schema_revision: 11 })
			.eq("id", id)
			.eq("schema_revision", 10),
	]);

	const counts = [left.affectedRows, right.affectedRows].sort();
	assert.deepEqual(counts, [0, 1]);
});

test("live PG: legacy or() inbox filter", live, async () => {
	const client = createClient({ db: { pgUri: LIVE_URI }, env: {} });
	await client.query(`
    CREATE TABLE IF NOT EXISTS notifications_or_smoke (
      id uuid PRIMARY KEY,
      deleted boolean
    )
  `);
	const a = randomUUID();
	const b = randomUUID();
	const c = randomUUID();
	await client.from("notifications_or_smoke").insert({ deleted: false, id: a });
	await client.from("notifications_or_smoke").insert({ deleted: null, id: b });
	await client.from("notifications_or_smoke").insert({ deleted: true, id: c });

	const result = await client
		.from("notifications_or_smoke")
		.or("deleted.eq.false,deleted.is.null")
		.select("id,deleted");
	assert.equal(result.error, null, String(result.error ?? ""));
	const rows = result.data as { id: string }[];
	const ids = new Set(rows.map((row) => row.id));
	assert.ok(ids.has(a));
	assert.ok(ids.has(b));
	assert.equal(ids.has(c), false);
});
