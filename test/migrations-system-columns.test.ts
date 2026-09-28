import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeMigrationFile,
  DIAGNOSTIC_CODES,
  emptyProjectedSchema,
  verifyMigrationAgainstSchema,
} from "../src/migrations/analysis/index.ts";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import type { MigrationFile } from "../src/migrations/types.ts";

const SYSTEM_COLUMNS = [
  "tableoid",
  "xmin",
  "cmin",
  "xmax",
  "cmax",
  "ctid",
] as const;

const DEDUPE_SQL = `
WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, user_id, notification_id
    ) AS rn
  FROM public.notifications
)
DELETE FROM public.notifications AS notification
USING ranked
WHERE notification.ctid = ranked.ctid
  AND ranked.rn > 1
  AND notification.organization_id IS NOT NULL
  AND notification.user_id IS NOT NULL
  AND notification.notification_id IS NOT NULL;
`;

function migration(sql: string): MigrationFile {
  return {
    checksum: checksumMigrationSql(sql),
    filename: "0001_notifications.sql",
    name: "notifications",
    path: "0001_notifications.sql",
    sql,
    version: 1,
  };
}

function notificationsSchema() {
  const projected = emptyProjectedSchema();
  projected.tables.set("public.notifications", {
    columns: new Set(["organization_id", "user_id", "notification_id"]),
    indexes: new Set(),
    name: "notifications",
    schema: "public",
  });
  return projected;
}

function columnDeps(sql: string) {
  return analyzeMigrationFile(migration(sql)).then((analysis) =>
    analysis.dependencies.filter((item) => item.category === "REQUIRES_COLUMN")
  );
}

test("qualified ctid is not a required column and does not fail preflight", async () => {
  const analysis = await analyzeMigrationFile(migration(DEDUPE_SQL));
  const columns = analysis.dependencies.filter(
    (item) => item.category === "REQUIRES_COLUMN"
  );
  const names = columns.map((item) => item.object.name);
  assert.equal(
    analysis.dependencies.some(
      (item) =>
        item.category === "REQUIRES_TABLE" &&
        item.object.kind === "table" &&
        item.object.schema === "public" &&
        item.object.name === "notifications"
    ),
    true
  );
  assert.equal(names.includes("organization_id"), true);
  assert.equal(names.includes("user_id"), true);
  assert.equal(names.includes("notification_id"), true);
  assert.equal(names.includes("ctid"), false);

  const diagnostics = verifyMigrationAgainstSchema({
    analyses: [analysis],
    analysis,
    appliedVersions: new Set(),
    projected: notificationsSchema(),
  });
  assert.equal(
    diagnostics.some(
      (item) =>
        item.code === DIAGNOSTIC_CODES.COL_MISSING &&
        item.object.kind === "column" &&
        item.object.name === "ctid"
    ),
    false
  );
});

for (const column of SYSTEM_COLUMNS) {
  test(`PostgreSQL system column ${column} is not REQUIRES_COLUMN`, async () => {
    const sql = `
      DELETE FROM public.notifications AS notification
      WHERE notification.${column} IS NOT NULL;
    `;
    const columns = await columnDeps(sql);
    assert.equal(
      columns.some((item) => item.object.name === column),
      false
    );
  });
}

test("ordinary missing columns still fail preflight", async () => {
  const sql = `
    DELETE FROM public.notifications AS notification
    WHERE notification.nonexistent_column = 'x';
  `;
  const analysis = await analyzeMigrationFile(migration(sql));
  assert.equal(
    analysis.dependencies.some(
      (item) =>
        item.category === "REQUIRES_COLUMN" &&
        item.object.kind === "column" &&
        item.object.schema === "public" &&
        item.object.table === "notifications" &&
        item.object.name === "nonexistent_column"
    ),
    true
  );
  const diagnostics = verifyMigrationAgainstSchema({
    analyses: [analysis],
    analysis,
    appliedVersions: new Set(),
    projected: notificationsSchema(),
  });
  assert.equal(
    diagnostics.some(
      (item) =>
        item.code === DIAGNOSTIC_CODES.COL_MISSING &&
        item.object.kind === "column" &&
        item.object.name === "nonexistent_column"
    ),
    true
  );
});
