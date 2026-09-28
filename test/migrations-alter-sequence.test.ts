import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeMigrationFile,
  compileMigrations,
} from "../src/migrations/analysis/index.ts";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import type { MigrationFile } from "../src/migrations/types.ts";

const SQL = `
CREATE TABLE public.notifications (id bigint NOT NULL);
CREATE SEQUENCE public.notifications_id_seq;
ALTER SEQUENCE public.notifications_id_seq
  OWNED BY public.notifications.id;
`;

function migration(): MigrationFile {
  return {
    checksum: checksumMigrationSql(SQL),
    filename: "0001_notifications_seq.sql",
    name: "notifications_seq",
    path: "0001_notifications_seq.sql",
    sql: SQL,
    version: 1,
  };
}

function label(item: {
  category: string;
  object: { kind: string; name: string; schema?: string; table?: string };
}): string {
  if (item.object.kind === "column" && item.object.table) {
    return `${item.category} ${item.object.schema ?? ""}.${item.object.table}.${item.object.name}`;
  }
  return `${item.category} ${item.object.schema ?? ""}.${item.object.name}`;
}

test("ALTER SEQUENCE OWNED BY requires the sequence and column", async () => {
  const analysis = await analyzeMigrationFile(migration());
  const labels = analysis.dependencies.map(label);
  assert.equal(labels.includes("REQUIRES_SEQUENCE public.notifications_id_seq"), true);
  assert.equal(labels.includes("REQUIRES_TABLE public.notifications"), true);
  assert.equal(labels.includes("REQUIRES_COLUMN public.notifications.id"), true);
  const tableIndex = labels.indexOf("REQUIRES_TABLE public.notifications");
  const columnIndex = labels.indexOf("REQUIRES_COLUMN public.notifications.id");
  assert.equal(tableIndex < columnIndex, true);
  assert.equal(
    analysis.dependencies.some(
      (item) =>
        item.category === "REQUIRES_TABLE" &&
        item.object.name === "notifications_id_seq"
    ),
    false
  );
  assert.equal(
    analysis.statements.some((statement) => statement.kind === "alter_sequence"),
    false
  );

  const compiled = await compileMigrations({
    appliedVersions: new Set(),
    files: [migration()],
    strict: true,
  });
  assert.deepEqual(compiled.diagnostics, []);
});

test("ALTER SEQUENCE OWNED BY a missing table fails strict preflight", async () => {
  const sql = "ALTER SEQUENCE public.s OWNED BY public.missing.id;";
  const file: MigrationFile = {
    checksum: checksumMigrationSql(sql),
    filename: "0003_missing_owner.sql",
    name: "missing_owner",
    path: "0003_missing_owner.sql",
    sql,
    version: 3,
  };
  const compiled = await compileMigrations({
    appliedVersions: new Set(),
    files: [file],
    strict: true,
  });
  assert.equal(
    compiled.diagnostics.some(
      (item) =>
        item.object.kind === "table" &&
        item.object.name === "missing"
    ),
    true
  );
});

test("ALTER SEQUENCE OWNED BY NONE does not require a column", async () => {
  const sql = `
    CREATE SEQUENCE public.notifications_id_seq;
    ALTER SEQUENCE public.notifications_id_seq OWNED BY NONE;
  `;
  const analysis = await analyzeMigrationFile({
    checksum: checksumMigrationSql(sql),
    filename: "0002_notifications_seq.sql",
    name: "notifications_seq_none",
    path: "0002_notifications_seq.sql",
    sql,
    version: 2,
  });
  assert.equal(
    analysis.dependencies.some(
      (item) =>
        item.category === "REQUIRES_SEQUENCE" &&
        item.object.name === "notifications_id_seq"
    ),
    true
  );
  assert.equal(
    analysis.dependencies.some((item) => item.category === "REQUIRES_COLUMN"),
    false
  );
});
