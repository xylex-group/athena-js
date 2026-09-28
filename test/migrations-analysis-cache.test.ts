import { strict as assert } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ANALYSIS_CACHE_FILENAME,
  ANALYSIS_IR_VERSION,
  ANALYZER_ID,
  compileMigrations,
  PARSER_ID,
} from "../src/migrations/analysis/index.ts";
import { catalogToProjected } from "../src/migrations/analysis/projected-schema.ts";
import type { MigrationAnalysis } from "../src/migrations/analysis/semantic-ir.ts";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import type { MigrationFile } from "../src/migrations/types.ts";

const SQL = `
WITH normalized_source AS (
  SELECT id, name, metadata FROM public.files
)
INSERT INTO athena.files (id)
SELECT id FROM normalized_source;
SELECT btrim(' x '), now(), jsonb_typeof('{}'::jsonb);
`;

function migrationFile(): MigrationFile {
  return {
    checksum: checksumMigrationSql(SQL),
    filename: "0006_files_cutover.sql",
    name: "files_cutover",
    path: "0006_files_cutover.sql",
    sql: SQL,
    version: 6,
  };
}

function staleAnalysis(file: MigrationFile): MigrationAnalysis {
  return {
    checksum: file.checksum,
    dependencies: [
      {
        category: "REQUIRES_FUNCTION",
        confidence: "certain",
        object: { kind: "function", name: "btrim", schema: "public" },
      },
      {
        category: "REQUIRES_TABLE",
        confidence: "certain",
        object: {
          kind: "table",
          name: "normalized_source",
          schema: "public",
        },
      },
    ],
    effects: { creates: [], drops: [], modifies: [] },
    filename: file.filename,
    name: file.name,
    parserId: PARSER_ID,
    statements: [],
    version: file.version,
    warnings: [],
  };
}

function catalog() {
  return {
    objects: [],
    schema: catalogToProjected([
      { kind: "schema", name: "public" },
      { kind: "schema", name: "athena" },
      { kind: "table", name: "files", schema: "public" },
      { kind: "column", name: "id", schema: "public", table: "files" },
      { kind: "column", name: "name", schema: "public", table: "files" },
      {
        kind: "column",
        name: "metadata",
        schema: "public",
        table: "files",
      },
      { kind: "table", name: "files", schema: "athena" },
      { kind: "column", name: "id", schema: "athena", table: "files" },
    ]),
  };
}

function bogusBlockers(
  result: Awaited<ReturnType<typeof compileMigrations>>
): string[] {
  return result.diagnostics
    .filter((item) => {
      if (
        item.object.kind === "function" &&
        (item.object.name === "btrim" ||
          item.object.name === "now" ||
          item.object.name === "jsonb_typeof")
      ) {
        return true;
      }
      if (
        item.object.kind === "table" &&
        item.object.name === "normalized_source"
      ) {
        return true;
      }
      return false;
    })
    .map(
      (item) =>
        `${item.object.kind}:${"schema" in item.object ? item.object.schema : ""}.${item.object.name}`
    );
}

test("v1 analysis cache is ignored after analyzer semantics change", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-cache-v1-"));
  const file = migrationFile();
  const dir = join(root, ".athena", "migrations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "analysis-v1.json"),
    `${JSON.stringify(
      {
        irVersion: 1,
        parserId: PARSER_ID,
        records: {
          [`${file.checksum}:${file.filename}`]: staleAnalysis(file),
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await compileMigrations({
    appliedVersions: new Set(),
    cacheDir: root,
    catalog: catalog(),
    files: [file],
  });

  assert.deepEqual(bogusBlockers(result), []);
  assert.equal(
    result.analyses[0]?.dependencies.some(
      (item) =>
        item.object.kind === "table" && item.object.name === "normalized_source"
    ),
    false
  );
  assert.equal(
    result.analyses[0]?.dependencies.some(
      (item) =>
        item.object.kind === "function" &&
        item.object.schema === "public" &&
        item.object.name === "btrim"
    ),
    false
  );

  const saved = JSON.parse(
    readFileSync(join(dir, ANALYSIS_CACHE_FILENAME), "utf8")
  ) as { analyzerId?: string };
  assert.equal(saved.analyzerId, ANALYZER_ID);
  rmSync(root, { force: true, recursive: true });
});

test("analysis-v2 cache without analyzer identity is discarded", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-cache-v2-"));
  const file = migrationFile();
  const dir = join(root, ".athena", "migrations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, ANALYSIS_CACHE_FILENAME),
    `${JSON.stringify(
      {
        irVersion: 1,
        parserId: PARSER_ID,
        records: {
          [`${file.checksum}:${file.filename}`]: staleAnalysis(file),
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await compileMigrations({
    appliedVersions: new Set(),
    cacheDir: root,
    catalog: catalog(),
    files: [file],
  });

  assert.deepEqual(bogusBlockers(result), []);
  assert.equal(
    result.analyses.some((analysis) =>
      analysis.dependencies.some(
        (item) =>
          item.object.kind === "function" &&
          item.object.schema === "public" &&
          item.object.name === "btrim"
      )
    ),
    false
  );
  rmSync(root, { force: true, recursive: true });
});

test("analyzer v3 cache with stale ctid column deps is recomputed at v4", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-cache-v3-"));
  const file = migrationFile();
  const dir = join(root, ".athena", "migrations");
  mkdirSync(dir, { recursive: true });
  const v3Id = "athena-migration-analyzer@3";
  const stale = staleAnalysis(file);
  stale.dependencies.push({
    category: "REQUIRES_COLUMN",
    confidence: "certain",
    object: {
      kind: "column",
      name: "ctid",
      schema: "public",
      table: "notifications",
    },
  });
  writeFileSync(
    join(dir, ANALYSIS_CACHE_FILENAME),
    `${JSON.stringify(
      {
        analyzerId: v3Id,
        analyzerSemanticsVersion: 3,
        irVersion: ANALYSIS_IR_VERSION,
        parserId: PARSER_ID,
        records: {
          [`${v3Id}:${file.checksum}:${file.filename}`]: stale,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await compileMigrations({
    appliedVersions: new Set(),
    cacheDir: root,
    catalog: catalog(),
    files: [file],
  });

  assert.equal(
    result.analyses[0]?.dependencies.some(
      (item) =>
        item.category === "REQUIRES_COLUMN" &&
        item.object.kind === "column" &&
        item.object.name === "ctid"
    ),
    false
  );
  const saved = JSON.parse(
    readFileSync(join(dir, ANALYSIS_CACHE_FILENAME), "utf8")
  ) as { analyzerId?: string; analyzerSemanticsVersion?: number };
  assert.equal(saved.analyzerId, ANALYZER_ID);
  assert.equal(saved.analyzerSemanticsVersion, 4);
  rmSync(root, { force: true, recursive: true });
});
