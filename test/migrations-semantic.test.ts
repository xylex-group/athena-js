import { strict as assert } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { listAthenaAuthCanonicalMigrations } from "../src/auth/schema/migrations.ts";
import { emptyPhysicalCatalog } from "../src/migrations/analysis/catalog.ts";
import {
  analyzeMigrationFile,
  compileMigrations,
  DIAGNOSTIC_CODES,
  formatPreflightFailure,
} from "../src/migrations/analysis/index.ts";
import { catalogToProjected } from "../src/migrations/analysis/projected-schema.ts";
import { compileApplicationSemantics } from "../src/migrations/application/semantics.ts";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import { runMigrations } from "../src/migrations/runner.ts";
import type {
  AppliedMigration,
  AppliedMigrationResult,
  MigrationBackend,
  MigrationFile,
} from "../src/migrations/types.ts";
import { MigrationError } from "../src/migrations/types.ts";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "migrations"
);

function file(version: number, filename: string, sql: string): MigrationFile {
  return {
    checksum: checksumMigrationSql(sql),
    filename,
    name: filename.replace(/^\d+_/, "").replace(/\.sql$/, ""),
    path: filename,
    sql,
    version,
  };
}

class MemoryBackend implements MigrationBackend {
  readonly kind = "memory";
  appliedSql: string[] = [];
  private readonly rows: AppliedMigration[];
  private readonly catalog;

  constructor(rows: AppliedMigration[] = [], catalog = emptyPhysicalCatalog()) {
    this.rows = [...rows];
    this.catalog = catalog;
  }

  async acquireLock(): Promise<void> {}
  async releaseLock(): Promise<void> {}
  async ensureLedger(): Promise<void> {}
  async listAppliedMigrations(): Promise<AppliedMigration[]> {
    return [...this.rows];
  }
  async inspectCatalog() {
    return this.catalog;
  }
  async applyMigration(
    migration: MigrationFile
  ): Promise<AppliedMigrationResult> {
    this.appliedSql.push(migration.sql);
    const row: AppliedMigrationResult = {
      appliedAt: new Date(),
      checksum: migration.checksum,
      executionMs: 1,
      filename: migration.filename,
      name: migration.name,
      version: migration.version,
    };
    this.rows.push(row);
    return row;
  }
  async close(): Promise<void> {}
}

function writeProject(root: string, sqlFiles: Record<string, string>): void {
  writeFileSync(
    join(root, "athena.config.ts"),
    `
export default {
  provider: {
    kind: 'postgres',
    mode: 'direct',
    connectionString: 'postgres://localhost/app_db',
    database: 'app_db',
    schemas: ['public', 'forms', 'athena'],
  },
  migrations: { directory: './athena/migrations' },
}
`,
    "utf8"
  );
  const dir = join(root, "athena", "migrations");
  mkdirSync(dir, { recursive: true });
  for (const [name, sql] of Object.entries(sqlFiles)) {
    writeFileSync(join(dir, name), sql, "utf8");
  }
}

const bootstrapSql = readFileSync(
  join(fixtures, "speedrun-0001-forms-bootstrap.sql"),
  "utf8"
);
const functionSql = readFileSync(
  join(fixtures, "speedrun-0007-admin-forms-records.sql"),
  "utf8"
);

test("function → table created earlier PASS", async () => {
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [
      file(1, "0001_forms_bootstrap.sql", bootstrapSql),
      file(7, "0007_athena_functions.sql", functionSql),
    ],
  });
  assert.equal(
    result.diagnostics.filter((d) => d.classification !== "dynamic_sql").length,
    0
  );
  assert.equal(
    result.analyses[1].dependencies.some(
      (d) =>
        d.object.kind === "table" &&
        d.object.schema === "forms" &&
        d.object.name === "forms"
    ),
    true
  );
});

test("function → table created later FAIL", async () => {
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [
      file(1, "0001_fn.sql", functionSql),
      file(2, "0002_table.sql", bootstrapSql),
    ],
  });
  assert.ok(
    result.diagnostics.some(
      (d) =>
        d.classification === "ordering" &&
        d.object.kind === "table" &&
        d.object.name === "forms"
    )
  );
});

test("function → nonexistent table FAIL", async () => {
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [file(7, "0007_athena_functions.sql", functionSql)],
  });
  assert.ok(
    result.diagnostics.some(
      (d) =>
        d.code === DIAGNOSTIC_CODES.DEP_MISSING &&
        d.object.kind === "table" &&
        d.object.name === "forms"
    )
  );
});

test("function → existing table missing column FAIL", async () => {
  const sql = `
CREATE OR REPLACE FUNCTION public.admin_forms_records()
RETURNS TABLE (deleted_at text)
LANGUAGE sql AS $$
  SELECT f.deleted_at::text FROM forms.forms AS f;
$$;
`;
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [
      file(1, "0001_forms_bootstrap.sql", bootstrapSql),
      file(7, "0007_fn.sql", sql),
    ],
  });
  assert.ok(
    result.diagnostics.some(
      (d) => d.object.kind === "column" && d.object.name === "deleted_at"
    )
  );
});

test("ledger applied + physical table missing is PHYSICAL_SCHEMA_DRIFT", async () => {
  const bootstrap = file(1, "0001_forms_bootstrap.sql", bootstrapSql);
  const fn = file(7, "0007_athena_functions.sql", functionSql);
  const result = await compileMigrations({
    appliedVersions: new Set([1]),
    catalog: emptyPhysicalCatalog(),
    files: [bootstrap, fn],
  });
  assert.ok(
    result.diagnostics.some(
      (d) =>
        d.classification === "physical_schema_drift" &&
        d.object.kind === "table" &&
        d.object.name === "forms" &&
        d.expectedProvider?.filename === "0001_forms_bootstrap.sql"
    )
  );
});

test("table created then dropped before function FAIL", async () => {
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [
      file(1, "0001_create.sql", bootstrapSql),
      file(2, "0002_drop.sql", "DROP TABLE forms.forms;\n"),
      file(3, "0003_fn.sql", functionSql),
    ],
  });
  assert.ok(
    result.diagnostics.some(
      (d) => d.object.kind === "table" && d.object.name === "forms"
    )
  );
});

test("table created in same migration before function PASS", async () => {
  const sql = `${bootstrapSql}\n${functionSql}\n`;
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [file(1, "0001_together.sql", sql)],
  });
  assert.equal(
    result.diagnostics.filter((d) => d.classification !== "dynamic_sql").length,
    0
  );
});

test("table created after function in same migration FAIL", async () => {
  const sql = `${functionSql}\n${bootstrapSql}\n`;
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [file(1, "0001_wrong_order.sql", sql)],
  });
  assert.ok(result.diagnostics.length > 0);
});

test("quoted identifiers, CTE, JOIN, LATERAL parse", async () => {
  const sql = `
CREATE VIEW public.v AS
WITH x AS (SELECT 1 AS id)
SELECT q."id"
FROM x AS q
JOIN x AS r ON r.id = q.id
LEFT JOIN LATERAL (SELECT q.id) AS lat ON true;
`;
  const analysis = await analyzeMigrationFile(file(1, "0001_view.sql", sql));
  assert.ok(analysis.statements.length >= 1);
});

test("dynamic EXECUTE is classified dynamic", async () => {
  const sql = `
CREATE FUNCTION public.execute_report(schema_name text, table_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('SELECT * FROM %I.%I', schema_name, table_name);
END;
$$;
`;
  const analysis = await analyzeMigrationFile(
    file(9, "0009_reporting.sql", sql)
  );
  assert.ok(analysis.dependencies.some((d) => d.confidence === "dynamic"));
});

test("speedrun-formations incident: migrate apply does not execute 0007", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-sem-"));
  const catalog = {
    objects: [],
    schema: catalogToProjected([{ kind: "schema", name: "forms" }]),
  };
  const backend = new MemoryBackend(
    [
      {
        appliedAt: new Date("2026-08-17T13:30:49.765Z"),
        checksum: checksumMigrationSql(bootstrapSql),
        executionMs: 163,
        name: "forms_bootstrap",
        version: 1,
      },
    ],
    catalog
  );
  try {
    writeProject(root, {
      "0001_forms_bootstrap.sql": bootstrapSql,
      "0007_athena_functions.sql": functionSql,
    });
    await assert.rejects(
      () =>
        runMigrations({
          createBackend: async () => backend,
          cwd: root,
          log: () => undefined,
          mode: "apply",
        }),
      (error: unknown) => {
        assert.ok(error instanceof MigrationError);
        assert.equal(error.code, "SEMANTIC");
        assert.match(error.message, /forms\.forms/);
        assert.match(error.message, /physical/i);
        assert.match(error.message, /No migrations were executed/);
        return true;
      }
    );
    assert.deepEqual(backend.appliedSql, []);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("replay speedrun-formations bootstrap+function from empty projected state", async () => {
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [
      file(1, "0001_forms_bootstrap.sql", bootstrapSql),
      file(
        3,
        "0003_deleted_at.sql",
        `
ALTER TABLE forms.forms
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone NULL;
`
      ),
      file(7, "0007_athena_functions.sql", functionSql),
    ],
  });
  assert.equal(
    result.diagnostics.filter((d) => d.classification !== "dynamic_sql").length,
    0
  );
});

test("CTE names are not treated as public tables", async () => {
  const withBeforeInsert = `
WITH normalized_source AS (
  SELECT id
  FROM public.files
)
INSERT INTO athena.files (id)
SELECT id
FROM normalized_source;
`;
  const insertThenWith = `
INSERT INTO athena.files (id)
WITH normalized_source AS (
  SELECT id FROM public.files AS legacy
)
SELECT id FROM normalized_source;
`;
  for (const sql of [withBeforeInsert, insertThenWith]) {
    const analysis = await analyzeMigrationFile(
      file(6, "0006_files_cutover.sql", sql)
    );
    const tables = analysis.dependencies.filter(
      (item) => item.object.kind === "table"
    );
    assert.equal(
      tables.some((item) => item.object.name === "normalized_source"),
      false
    );
    assert.equal(
      tables.some(
        (item) =>
          item.object.schema === "public" && item.object.name === "files"
      ),
      true
    );
    assert.equal(
      tables.some(
        (item) =>
          item.object.schema === "athena" && item.object.name === "files"
      ),
      true
    );
  }
});

test("PL/pgSQL function CTEs are not treated as public tables", async () => {
  const sql = `
CREATE FUNCTION public.resolve_file_id()
RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.files
  ),
  normalized AS (
    SELECT id FROM candidates
  ),
  matched AS (
    SELECT id FROM normalized
  )
  SELECT id FROM matched;
END;
$$;
`;
  const analysis = await analyzeMigrationFile(
    file(6, "0006_files_cutover.sql", sql)
  );
  const tables = analysis.dependencies.filter(
    (item) => item.object.kind === "table"
  );
  assert.equal(
    tables.some((item) =>
      ["candidates", "normalized", "matched"].includes(item.object.name)
    ),
    false
  );
  assert.equal(
    tables.some(
      (item) => item.object.schema === "public" && item.object.name === "files"
    ),
    true
  );
});

test("unqualified catalog functions do not invent public schema", async () => {
  const sql = `
SELECT setval('public.faqs_sort_order_seq', 1);
SELECT jsonb_build_object('a', 1);
SELECT pg_catalog.substring('abc', 1);
`;
  const result = await compileMigrations({
    appliedVersions: new Set(),
    catalog: {
      objects: [],
      schema: catalogToProjected([
        { kind: "schema", name: "public" },
        { kind: "sequence", name: "faqs_sort_order_seq", schema: "public" },
      ]),
    },
    files: [file(1, "0001_funcs.sql", sql)],
  });
  assert.equal(
    result.diagnostics.some(
      (item) =>
        item.object.kind === "function" &&
        (item.object.name === "setval" ||
          item.object.name === "jsonb_build_object" ||
          item.object.name === "substring")
    ),
    false
  );
});

test("requiredBy is the statement object not the first object in the file", async () => {
  const sql = `
CREATE TABLE public.faqs (id int);
INSERT INTO public.resource_routes (id) VALUES (1);
`;
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [file(4, "0004_help_faqs.sql", sql)],
  });
  const missing = result.diagnostics.find(
    (item) =>
      item.object.kind === "table" && item.object.name === "resource_routes"
  );
  assert.ok(missing);
  assert.equal(missing?.requiredBy, "public.resource_routes");
  assert.notEqual(missing?.requiredBy, "public.faqs");
});

test("CREATE SEQUENCE is projected and nextval requires it", async () => {
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [
      file(
        1,
        "0001_seq.sql",
        `
CREATE SEQUENCE public.faqs_sort_order_seq;
SELECT nextval('public.faqs_sort_order_seq');
`
      ),
    ],
  });
  assert.equal(
    result.diagnostics.filter((item) => item.object.kind === "sequence").length,
    0
  );
});

test("declared requires-table is a baseline prerequisite", async () => {
  const result = await compileMigrations({
    appliedVersions: new Set(),
    files: [
      file(
        6,
        "0006_files_cutover.sql",
        `
-- requires-table: public.files
SELECT 1 FROM public.files;
`
      ),
    ],
  });
  assert.ok(
    result.diagnostics.some(
      (item) =>
        item.classification === "baseline_prerequisite" &&
        item.object.kind === "table" &&
        item.object.name === "files"
    )
  );
});

test("formatPreflightFailure collapses duplicate findings per file", () => {
  const loc = {
    end: { column: 1, line: 1 },
    filename: "0006_files_cutover.sql",
    start: { column: 1, line: 1 },
  };
  const btrim = {
    classification: "missing_dependency" as const,
    code: DIAGNOSTIC_CODES.DEP_MISSING,
    location: loc,
    message: "requires public.btrim",
    object: { kind: "function" as const, name: "btrim", schema: "public" },
  };
  const cte = {
    classification: "missing_dependency" as const,
    code: DIAGNOSTIC_CODES.DEP_MISSING,
    location: loc,
    message: "requires public.normalized_source",
    object: {
      kind: "table" as const,
      name: "normalized_source",
      schema: "public",
    },
  };
  const text = formatPreflightFailure([btrim, btrim, btrim, cte]);
  assert.match(text, /4 blocking finding\(s\)/);
  assert.match(text, /4 blocking finding\(s\) · 2 unique/);
  assert.match(text, /3× ATHENA-MIG-DEP-001: public\.btrim/);
  assert.match(text, /ATHENA-MIG-DEP-001: public\.normalized_source/);
  assert.equal(text.split("ATHENA-MIG-DEP-001: public.btrim").length - 1, 1);
});

test("PL/pgSQL row variable is not a table dependency", async () => {
  const sql = `
CREATE FUNCTION public.test_fn()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_case public.cases%ROWTYPE;
BEGIN
  SELECT c.*
  INTO v_case
  FROM public.cases c
  LIMIT 1;

  RETURN v_case.id::text;
END;
$$;
`;
  const analysis = await analyzeMigrationFile(file(8, "0008_fn.sql", sql));
  const tables = analysis.dependencies.filter(
    (item) => item.object.kind === "table"
  );
  assert.equal(
    tables.some(
      (item) => item.object.schema === "public" && item.object.name === "cases"
    ),
    true
  );
  assert.equal(
    tables.some((item) => item.object.name === "v_case"),
    false
  );
});

test("PL/pgSQL scalar variable is not a table dependency", async () => {
  const sql = `
CREATE FUNCTION public.test_room()
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_room_id bigint;
BEGIN
  SELECT r.id
  INTO v_room_id
  FROM public.rsf_chat_rooms r
  LIMIT 1;
  RETURN v_room_id;
END;
$$;
`;
  const analysis = await analyzeMigrationFile(file(8, "0008_room.sql", sql));
  const tables = analysis.dependencies.filter(
    (item) => item.object.kind === "table"
  );
  assert.equal(
    tables.some((item) => item.object.name === "v_room_id"),
    false
  );
  assert.equal(
    tables.some(
      (item) =>
        item.object.schema === "public" && item.object.name === "rsf_chat_rooms"
    ),
    true
  );
});

test("pending embedded auth provider satisfies application dependency", async () => {
  const result = await compileApplicationSemantics({
    authPlan: {
      entries: listAthenaAuthCanonicalMigrations().map((entry) => ({
        action: "apply",
        ledgerState: "absent",
        version: entry.version,
      })),
    },
    backend: new MemoryBackend(),
    local: [
      file(
        8,
        "0008_athena_functions.sql",
        "SELECT id FROM athena.users;\nSELECT email FROM athena.emails;\n"
      ),
    ],
    plan: { applied: [], conflicts: [], pending: [] },
  });
  assert.equal(
    result.diagnostics.some(
      (item) =>
        item.object.kind === "table" &&
        item.object.schema === "athena" &&
        (item.object.name === "users" || item.object.name === "emails")
    ),
    false
  );
  assert.ok(
    result.packagedProviders.some(
      (provider) =>
        provider.source === "embedded-auth" &&
        provider.object.kind === "table" &&
        provider.object.schema === "athena" &&
        provider.object.name === "users"
    )
  );
});

test("packaged provider executes before application consumer", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-mig-auth-order-"));
  const order: string[] = [];
  const backend = new MemoryBackend();
  const originalApply = backend.applyMigration.bind(backend);
  backend.applyMigration = async (migration) => {
    order.push(`application:${migration.filename}`);
    return originalApply(migration);
  };
  try {
    writeProject(root, {
      "0001_uses_users.sql": "SELECT id FROM athena.users;\n",
    });
    await runMigrations({
      createBackend: async () => backend,
      cwd: root,
      log: () => undefined,
      migrateAuthSchema: async () => {
        order.push("auth");
      },
      mode: "apply",
    });
    assert.deepEqual(order, ["auth", "application:0001_uses_users.sql"]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
