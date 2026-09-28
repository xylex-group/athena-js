import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EMBEDDED_BILLING_MIGRATIONS,
  EMBEDDED_BILLING_REQUIRED_COLUMNS,
  EMBEDDED_BILLING_REQUIRED_RELATIONS,
} from "../../../src/migrations/embedded-billing/catalog.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sqlDir = join(pkgRoot, "src", "migrations", "embedded-billing", "sql");
const billingSourceDir = join(pkgRoot, "src", "billing");

function collectTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(path));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

test("packaged billing migrations have a contiguous, filesystem-complete catalog", () => {
  const versions = EMBEDDED_BILLING_MIGRATIONS.map(
    (migration) => migration.version
  );
  const latest = EMBEDDED_BILLING_MIGRATIONS.at(-1);
  assert.ok(latest);
  assert.equal(latest.version, versions.length);
  assert.deepEqual(
    versions,
    Array.from({ length: versions.length }, (_, index) => index + 1)
  );

  for (const [property, values] of [
    ["version", versions],
    [
      "filename",
      EMBEDDED_BILLING_MIGRATIONS.map((migration) => migration.filename),
    ],
    ["name", EMBEDDED_BILLING_MIGRATIONS.map((migration) => migration.name)],
  ] as const) {
    assert.equal(
      new Set<string | number>(values).size,
      values.length,
      `duplicate billing migration ${property}`
    );
  }
  for (const migration of EMBEDDED_BILLING_MIGRATIONS) {
    const prefix = migration.filename.match(/^(\d+)_/)?.[1];
    assert.equal(Number(prefix), migration.version, migration.filename);
  }

  const packagedFiles = EMBEDDED_BILLING_MIGRATIONS.map(
    (migration) => migration.filename
  ).sort();
  const sqlFiles = readdirSync(sqlDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.deepEqual(packagedFiles, sqlFiles);
  for (const filename of packagedFiles) {
    assert.equal(existsSync(join(sqlDir, filename)), true, filename);
  }
});

test("billing migrations produce every relation required by the current runtime", () => {
  const latest = EMBEDDED_BILLING_MIGRATIONS.at(-1);
  assert.ok(latest);
  assert.ok("requiredRelations" in latest);
  assert.deepEqual(latest.requiredRelations, EMBEDDED_BILLING_REQUIRED_RELATIONS);

  const migrationSql = EMBEDDED_BILLING_MIGRATIONS.map(
    (migration) => migration.sql
  ).join("\n");
  for (const relation of EMBEDDED_BILLING_REQUIRED_RELATIONS) {
    assert.match(
      migrationSql,
      new RegExp(
        `(?:CREATE TABLE|ALTER TABLE)\\s+(?:IF NOT EXISTS\\s+)?${relation.schema}\\.${relation.table}\\b`,
        "i"
      ),
      `no packaged migration creates or alters ${relation.schema}.${relation.table}`
    );
  }

  const runtimeRelations = new Set<string>();
  for (const file of collectTypeScriptFiles(billingSourceDir)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /\b(billing|athena_internal)\.(billing_[a-z0-9_]+)\b|\b(athena)\.(audit_log_billing|traces_billing)\b/gi
    )) {
      const schema = match[1] ?? match[3];
      const table = match[2] ?? match[4];
      if (schema && table) {
        runtimeRelations.add(`${schema}.${table}`);
      }
    }
  }
  const requiredRelations = new Set(
    EMBEDDED_BILLING_REQUIRED_RELATIONS.map(
      (relation) => `${relation.schema}.${relation.table}`
    )
  );
  assert.deepEqual(
    [...runtimeRelations].filter((relation) => !requiredRelations.has(relation)),
    [],
    "billing runtime references a relation missing from the finality manifest"
  );
});

test("billing migrations declare the physical subscription fencing columns", () => {
  const latest = EMBEDDED_BILLING_MIGRATIONS.at(-1);
  assert.ok(latest);
  assert.ok("requiredColumns" in latest);
  assert.deepEqual(latest.requiredColumns, EMBEDDED_BILLING_REQUIRED_COLUMNS);
  for (const column of EMBEDDED_BILLING_REQUIRED_COLUMNS) {
    assert.match(
      EMBEDDED_BILLING_MIGRATIONS.map((migration) => migration.sql).join("\n"),
      new RegExp(
        `ALTER TABLE\\s+${column.schema}\\.${column.table}[\\s\\S]*\\b${column.column}\\b`,
        "i"
      ),
      `no packaged migration declares ${column.schema}.${column.table}.${column.column}`
    );
  }
});

test("billing ingress stage writes use columns produced by packaged migrations", () => {
  const health = readFileSync(
    join(billingSourceDir, "ingestion", "observability", "health.ts"),
    "utf8"
  );
  const insert = health.match(
    /INSERT INTO billing\.billing_webhook_ingress_stages\s*\(([\s\S]*?)\)\s*VALUES/i
  );
  assert.ok(insert?.[1]);

  const columns = insert[1]
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  const migrationSql = EMBEDDED_BILLING_MIGRATIONS.map(
    (migration) => migration.sql
  ).join("\n");
  const stageColumnSql = [
    migrationSql.match(
      /CREATE TABLE IF NOT EXISTS billing\.billing_webhook_ingress_stages[\s\S]*?\n\);/i
    )?.[0],
    ...[...migrationSql.matchAll(
      /ALTER TABLE billing\.billing_webhook_ingress_stages[\s\S]*?;/gi
    )].map((match) => match[0]),
  ]
    .filter((sql): sql is string => sql != null)
    .join("\n");
  assert.ok(stageColumnSql);

  for (const column of columns) {
    assert.match(
      stageColumnSql,
      new RegExp(`\\b${column}\\b`, "i"),
      `billing ingress stage column ${column} is not in the packaged schema`
    );
  }
});
