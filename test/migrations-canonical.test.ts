import assert from "node:assert/strict";
import test from "node:test";
import { toCanonicalMigration } from "../src/migrations/canonical.ts";

test("canonical migration adapter separates source, definition, and execution identity", () => {
  const migration = {
    checksum: "source-checksum",
    executionSql: "CREATE TABLE users (id uuid PRIMARY KEY);",
    executionTransform: { id: "athena.migration.inline-sql", version: "1" },
    filename: "0001_users.sql",
    name: "users",
    path: "athena/migrations/0001_users.sql",
    sql: "CREATE TABLE users (id uuid PRIMARY KEY);\n",
    version: 1,
  };
  const canonical = toCanonicalMigration(migration, "postgres");
  assert.equal(canonical.id, "0001");
  assert.equal(canonical.sourceChecksum, "source-checksum");
  assert.notEqual(canonical.execution.checksum, canonical.sourceChecksum);
  assert.equal(canonical.definitionChecksum.length, 64);
});
