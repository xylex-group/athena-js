import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { createPostgresIntrospectionProvider } from "../src/index.ts";

const connectionString = process.env.PG_INTROSPECTION_URL;
const initSql = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "integration/postgres/init/01-schema.sql"
  ),
  "utf8"
);

async function ensureIntrospectionFixtures(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT to_regclass('public.type_lab') AS table_name"
    );
    if (existing.rows[0]?.table_name) {
      return;
    }
    await client.query(initSql);
  } finally {
    await client.end();
  }
}

test("postgres introspection provider captures exhaustive type metadata and relations", async (t) => {
  if (!connectionString) {
    t.skip("PG_INTROSPECTION_URL is required for integration tests");
    return;
  }

  await ensureIntrospectionFixtures(connectionString);

  const provider = createPostgresIntrospectionProvider({
    connectionString,
    database: "athena_js",
  });

  const snapshot = await provider.inspect({
    schemas: ["public", "analytics"],
  });

  const publicSchema = snapshot.schemas.public;
  assert.ok(publicSchema);

  const typeLab = publicSchema.tables.type_lab;
  assert.ok(typeLab);
  assert.deepEqual(typeLab.primaryKey, ["id"]);
  assert.equal(typeLab.columns.table.isNullable, false);
  assert.equal(typeLab.columns.user.isNullable, true);
  assert.equal(typeLab.columns.order.isNullable, true);
  assert.equal(typeLab.columns.MixedCase.typeKind, "scalar");
  assert.equal(typeLab.columns["space name"].typeKind, "scalar");
  assert.equal(typeLab.columns.mood.typeKind, "enum");
  assert.deepEqual(typeLab.columns.mood.enumValues, [
    "happy",
    "sad",
    "neutral",
  ]);
  assert.equal(typeLab.columns.price_domain.typeKind, "domain");
  assert.equal(typeLab.columns.int_range.typeKind, "range");
  assert.equal(typeLab.columns.int_multirange.typeKind, "multirange");
  assert.equal(typeLab.columns.address.typeKind, "composite");
  assert.equal(typeLab.columns.full_name.isGenerated, true);
  assert.equal(typeLab.columns.first_name.hasDefault, true);
  assert.equal(typeLab.columns.tags.arrayDimensions, 1);
  assert.equal(typeLab.columns.matrix.arrayDimensions, 2);

  const projects = publicSchema.tables.projects;
  assert.ok(projects.relations.owner);
  assert.equal(projects.relations.owner.kind, "many-to-one");

  const users = publicSchema.tables.users;
  assert.ok(users.relations.projects);
  assert.equal(users.relations.projects.kind, "one-to-many");

  const tags = publicSchema.tables.tags;
  assert.ok(tags.relations.projects);
  assert.equal(tags.relations.projects.kind, "many-to-many");

  const analyticsSchema = snapshot.schemas.analytics;
  assert.ok(analyticsSchema.tables.users);
});
