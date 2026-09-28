import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { parseCommand } from "../src/cli/index.ts";
import { analyzeMigrationFile } from "../src/migrations/analysis/analyzer.ts";
import type { PhysicalCatalog } from "../src/migrations/analysis/catalog.ts";
import { emptyPhysicalCatalog } from "../src/migrations/analysis/catalog.ts";
import { catalogToProjected } from "../src/migrations/analysis/projected-schema.ts";
import type { MigrationAnalysis } from "../src/migrations/analysis/semantic-ir.ts";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import { assembleReconciliationReport } from "../src/migrations/reconciliation/assemble.ts";
import {
  isHighAutoRepair,
  reconcileVersion,
} from "../src/migrations/reconciliation/engine.ts";
import { formatVersionReconciliation } from "../src/migrations/reconciliation/format.ts";
import type { ArchivedMigrationSource } from "../src/migrations/reconciliation/types.ts";
import { runMigrations } from "../src/migrations/runner.ts";
import type {
  AppliedMigration,
  AppliedMigrationResult,
  MigrationBackend,
  MigrationFile,
} from "../src/migrations/types.ts";

const FORMS_SQL = `
CREATE SCHEMA IF NOT EXISTS forms;
CREATE TABLE IF NOT EXISTS forms.forms (
  id uuid PRIMARY KEY,
  title text NOT NULL
);
`.trim();

const ORGS_SQL = `
CREATE SCHEMA IF NOT EXISTS organizations;
CREATE TABLE IF NOT EXISTS organizations.organizations (
  id uuid PRIMARY KEY
);
`.trim();

function file(
  version: number,
  filename: string,
  sql: string,
  committed = true
): MigrationFile {
  return {
    checksum: checksumMigrationSql(sql),
    filename,
    name: filename.replace(/^\d+_/, "").replace(/\.sql$/, ""),
    path: filename,
    provenance: committed
      ? {
          dirty: false,
          gitBlobSha: "blob-sha",
          headCommit: "abc123",
          relativePath: `athena/migrations/${filename}`,
          repositoryRoot: "/repo",
          tracked: true,
          vcs: "git",
        }
      : undefined,
    sql,
    version,
  };
}

function ledger(version: number, name: string, sql: string): AppliedMigration {
  return {
    appliedAt: new Date("2026-01-01T00:00:00Z"),
    checksum: checksumMigrationSql(sql),
    executionMs: 1,
    name,
    version,
  };
}

function archive(
  version: number,
  sql: string,
  sourcePath?: string
): ArchivedMigrationSource {
  return {
    checksum: checksumMigrationSql(sql),
    sourcePath,
    sql,
    version,
  };
}

function physicalFromSqlCreates(
  ...objects: Parameters<typeof catalogToProjected>[0]
): ReturnType<typeof catalogToProjected> {
  return catalogToProjected(objects);
}

class MemoryBackend implements MigrationBackend {
  readonly kind = "memory";
  appliedSql: string[] = [];
  journals: unknown[] = [];
  private readonly rows: AppliedMigration[];
  private readonly archives: ArchivedMigrationSource[];
  private readonly catalog: PhysicalCatalog;

  constructor(
    input: {
      archives?: ArchivedMigrationSource[];
      catalog?: PhysicalCatalog;
      rows?: AppliedMigration[];
    } = {}
  ) {
    this.rows = [...(input.rows ?? [])];
    this.archives = [...(input.archives ?? [])];
    this.catalog = input.catalog ?? emptyPhysicalCatalog();
  }

  async acquireLock(): Promise<void> {}
  async releaseLock(): Promise<void> {}
  async ensureLedger(): Promise<void> {}
  async listAppliedMigrations(): Promise<AppliedMigration[]> {
    return [...this.rows];
  }
  async listArchivedSources(): Promise<ArchivedMigrationSource[]> {
    return [...this.archives];
  }
  async inspectCatalog(): Promise<PhysicalCatalog> {
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
  async insertReconciliation(row: unknown): Promise<void> {
    this.journals.push(row);
  }
  async close(): Promise<void> {}
}

function gitInit(root: string): void {
  const run = (args: string[]) =>
    spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
  run(["init"]);
  run(["config", "user.email", "reconcile@test"]);
  run(["config", "user.name", "Reconcile Test"]);
  run(["add", "-A"]);
  const commit = run(["commit", "-m", "init"]);
  if (commit.status !== 0) {
    throw new Error(commit.stderr || commit.stdout || "git commit failed");
  }
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
    schemas: ['public', 'forms', 'organizations', 'athena'],
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

test("parseCommand supports migrate reconcile --apply --json", () => {
  assert.deepEqual(parseCommand(["migrate", "reconcile"]), {
    allowDirty: false,
    applyReconcile: false,
    command: "migrate",
    configPath: undefined,
    dryRun: false,
    explainTarget: undefined,
    json: false,
    mode: "reconcile",
    plain: false,
    strict: false,
    yes: false,
  });
  assert.deepEqual(parseCommand(["migrate", "reconcile", "--apply", "--yes"]), {
    allowDirty: false,
    applyReconcile: true,
    command: "migrate",
    configPath: undefined,
    dryRun: false,
    explainTarget: undefined,
    json: false,
    mode: "reconcile",
    plain: false,
    strict: false,
    yes: true,
  });
  assert.equal(
    parseCommand(["migrate", "reconcile", "--json"]).command === "migrate" &&
      parseCommand(["migrate", "reconcile", "--json"]).json,
    true
  );
  assert.throws(
    () => parseCommand(["migrate", "--apply"]),
    /Unexpected "--apply"/
  );
  assert.throws(
    () => parseCommand(["migrate", "reconcile", "--dry-run"]),
    /--dry-run cannot be combined with migrate reconcile/
  );
});

test("case 1: ledger wrong, repo + physical agree → HIGH ledger-drift event", async () => {
  const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
  const analysis = await analyzeMigrationFile(repo);
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: checksumMigrationSql(ORGS_SQL),
      name: repo.name,
      version: 7,
    },
    physical: catalogToProjected(analysis.effects.creates),
    repository: {
      checksum: repo.checksum,
      committed: true,
      filename: repo.filename,
      name: repo.name,
      path: repo.path,
      sql: repo.sql,
      version: 7,
    },
    repositoryAnalysis: analysis,
  });
  assert.equal(diagnosis.classification, "LEDGER_SOURCE_DIVERGENCE");
  assert.equal(diagnosis.confidence, "HIGH");
  assert.equal(diagnosis.action.kind, "record-ledger-drift");
  assert.equal(isHighAutoRepair(diagnosis), true);
  if (diagnosis.action.kind === "record-ledger-drift") {
    assert.equal(diagnosis.action.fromChecksum, checksumMigrationSql(ORGS_SQL));
    assert.equal(diagnosis.action.toChecksum, repo.checksum);
  }
});

test("mixed CREATE + MODIFY evidence cannot become HIGH auto-repair", async () => {
  const repo = file(
    8,
    "0008_audit_log.sql",
    `
CREATE TABLE public.audit_log (id integer);
ALTER TABLE public.users ADD COLUMN status bigint;
`.trim()
  );
  const analysis = await analyzeMigrationFile(repo);
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: checksumMigrationSql(ORGS_SQL),
      name: repo.name,
      version: repo.version,
    },
    physical: catalogToProjected([
      ...analysis.effects.creates,
      { kind: "table", name: "users", schema: "public" },
    ]),
    repository: {
      checksum: repo.checksum,
      committed: true,
      filename: repo.filename,
      name: repo.name,
      path: repo.path,
      sql: repo.sql,
      version: repo.version,
    },
    repositoryAnalysis: analysis,
  });

  assert.equal(diagnosis.action.kind, "manual-review");
  assert.equal(diagnosis.autoEligible, false);
  assert.notEqual(diagnosis.confidence, "HIGH");
});

test("applied ALTER-only effects remain incomplete physical evidence", async () => {
  const repo = file(
    12,
    "0012_add_status.sql",
    "ALTER TABLE public.users ADD COLUMN status bigint;"
  );
  const analysis = await analyzeMigrationFile(repo);
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: repo.checksum,
      name: repo.name,
      version: repo.version,
    },
    physical: catalogToProjected([
      { kind: "table", name: "users", schema: "public" },
      { kind: "column", name: "status", schema: "public", table: "users" },
    ]),
    repository: {
      checksum: repo.checksum,
      committed: true,
      filename: repo.filename,
      name: repo.name,
      path: repo.path,
      sql: repo.sql,
      version: repo.version,
    },
    repositoryAnalysis: analysis,
  });

  assert.equal(diagnosis.evidence.physicalMatchesRepository, "unknown");
  assert.equal(diagnosis.classification, "MISSING_PHYSICAL_EFFECT");
  assert.equal(diagnosis.action.kind, "manual-review");
  assert.notEqual(diagnosis.confidence, "HIGH");
});

test("already represented CREATE + MODIFY effects do not become physical drift", async () => {
  const repo = file(
    13,
    "0013_add_audit_status.sql",
    `
CREATE TABLE public.audit_log (id integer);
ALTER TABLE public.users ADD COLUMN status bigint;
`.trim()
  );
  const analysis = await analyzeMigrationFile(repo);
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: repo.checksum,
      name: repo.name,
      version: repo.version,
    },
    physical: catalogToProjected([
      ...analysis.effects.creates,
      { kind: "table", name: "users", schema: "public" },
      { kind: "column", name: "status", schema: "public", table: "users" },
    ]),
    repository: {
      checksum: repo.checksum,
      committed: true,
      filename: repo.filename,
      name: repo.name,
      path: repo.path,
      sql: repo.sql,
      version: repo.version,
    },
    repositoryAnalysis: analysis,
  });

  assert.equal(diagnosis.evidence.physicalMatchesRepository, "unknown");
  assert.equal(diagnosis.classification, "MISSING_PHYSICAL_EFFECT");
  assert.equal(diagnosis.action.kind, "manual-review");
  assert.notEqual(diagnosis.confidence, "HIGH");
});

test("mixed CREATE + DROP evidence cannot become HIGH auto-repair", async () => {
  const repo = file(
    9,
    "0009_audit_log.sql",
    `
CREATE TABLE public.audit_log (id integer);
DROP TABLE public.legacy;
`.trim()
  );
  const analysis = await analyzeMigrationFile(repo);
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: checksumMigrationSql(ORGS_SQL),
      name: repo.name,
      version: repo.version,
    },
    physical: catalogToProjected(analysis.effects.creates),
    repository: {
      checksum: repo.checksum,
      committed: true,
      filename: repo.filename,
      name: repo.name,
      path: repo.path,
      sql: repo.sql,
      version: repo.version,
    },
    repositoryAnalysis: analysis,
  });

  assert.equal(diagnosis.action.kind, "manual-review");
  assert.equal(diagnosis.autoEligible, false);
  assert.notEqual(diagnosis.confidence, "HIGH");
});

test("dependency proof validates objects introduced by ADD COLUMN semantics", async () => {
  const providerFile = file(
    10,
    "0010_add_status.sql",
    "ALTER TABLE public.users ADD COLUMN status bigint;"
  );
  const statusColumn = {
    kind: "column" as const,
    name: "status",
    schema: "public",
    table: "users",
  };
  const provider: MigrationAnalysis = {
    checksum: providerFile.checksum,
    declaredRequires: [],
    dependencies: [],
    effects: {
      creates: [],
      drops: [],
      modifies: [{ kind: "add_column", object: statusColumn }],
    },
    filename: providerFile.filename,
    name: providerFile.name,
    parserId: "test",
    statements: [],
    version: providerFile.version,
    warnings: [],
  };
  const consumer = file(
    11,
    "0011_user_status_view.sql",
    "CREATE VIEW public.user_status AS SELECT users.status FROM public.users users;"
  );
  const consumerAnalysis = await analyzeMigrationFile(consumer);
  assert.equal(
    consumerAnalysis.dependencies.some(
      (dependency) =>
        dependency.category === "REQUIRES_COLUMN" &&
        dependency.object.kind === "column" &&
        dependency.object.name === "status"
    ),
    true
  );

  const report = await assembleReconciliationReport({
    analyses: [provider, consumerAnalysis],
    applied: [
      ledger(provider.version, provider.name, providerFile.sql),
      ledger(consumer.version, consumer.name, consumer.sql),
    ],
    archives: [],
    files: [providerFile, consumer],
    physical: catalogToProjected([
      { kind: "table", name: "users", schema: "public" },
    ]),
  });
  const diagnosis = report.diagnoses.find(
    (item) => item.version === provider.version
  );
  assert.ok(diagnosis);
  assert.equal(diagnosis.evidence.laterDependenciesSatisfied, false);
});

test("case 2: repo wrong, ledger + archived source agree → HIGH restore-local-source", async () => {
  const archived = archive(7, FORMS_SQL, "0007_restore_forms_forms.sql");
  const archiveAnalysis = await analyzeMigrationFile(
    file(7, "0007_restore_forms_forms.sql", FORMS_SQL)
  );
  const repoFile = file(7, "0007_restore_forms_forms.sql", ORGS_SQL);
  const repoAnalysis = await analyzeMigrationFile(repoFile);
  const diagnosis = reconcileVersion({
    archive: archived,
    archiveAnalysis,
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: archived.checksum,
      name: "restore_forms_forms",
      version: 7,
    },
    physical: catalogToProjected(archiveAnalysis.effects.creates),
    repository: {
      checksum: repoFile.checksum,
      committed: true,
      filename: repoFile.filename,
      name: repoFile.name,
      path: repoFile.path,
      sql: repoFile.sql,
      version: 7,
    },
    repositoryAnalysis: repoAnalysis,
  });
  assert.equal(diagnosis.classification, "SOURCE_DRIFT");
  assert.equal(diagnosis.confidence, "HIGH");
  assert.equal(diagnosis.action.kind, "restore-local-source");
  assert.equal(isHighAutoRepair(diagnosis), true);
});

test("case 3: physical wrong, repo + ledger agree → PHYSICAL_DRIFT forward repair, never rewrite history", async () => {
  const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
  const analysis = await analyzeMigrationFile(repo);
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: repo.checksum,
      name: repo.name,
      version: 7,
    },
    physical: physicalFromSqlCreates({ kind: "schema", name: "public" }),
    repository: {
      checksum: repo.checksum,
      committed: true,
      filename: repo.filename,
      name: repo.name,
      path: repo.path,
      sql: repo.sql,
      version: 7,
    },
    repositoryAnalysis: analysis,
  });
  assert.equal(diagnosis.classification, "PHYSICAL_DRIFT");
  assert.equal(diagnosis.confidence, "HIGH");
  assert.equal(diagnosis.action.kind, "create-forward-repair");
  assert.equal(isHighAutoRepair(diagnosis), false);
  assert.match(
    formatVersionReconciliation(diagnosis),
    /execution provenance matches repository/
  );
});

test("execution provenance drift never reports a migration as consistent", async () => {
  const authoredSql = FORMS_SQL;
  const repository = {
    ...file(7, "0007_restore_forms_forms.sql", authoredSql),
    executionSql: authoredSql.replace("forms.forms", "tenant.forms"),
    executionTransform: { id: "tenant-scope", version: "2" },
  };
  const repositoryAnalysis = await analyzeMigrationFile(repository);
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: repository.checksum,
      executionChecksum: checksumMigrationSql(
        authoredSql.replace("forms.forms", "account.forms")
      ),
      executionTransformId: "tenant-scope",
      executionTransformVersion: "1",
      name: repository.name,
      version: repository.version,
    },
    physical: catalogToProjected(repositoryAnalysis.effects.creates),
    repository: {
      checksum: repository.checksum,
      committed: true,
      executionSql: repository.executionSql,
      executionTransform: repository.executionTransform,
      filename: repository.filename,
      name: repository.name,
      path: repository.path,
      sql: repository.sql,
      version: repository.version,
    },
    repositoryAnalysis,
  });

  assert.equal(diagnosis.classification, "AMBIGUOUS_HISTORY");
  assert.equal(diagnosis.action.kind, "manual-review");
  assert.equal(diagnosis.evidence.executionMatchesLedger, false);
  assert.match(
    formatVersionReconciliation(diagnosis),
    /execution provenance does not match repository/
  );
});

test("missing repository source does not report ledger provenance as a match", () => {
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: checksumMigrationSql(FORMS_SQL),
      name: "restore_forms_forms",
      version: 7,
    },
    physical: physicalFromSqlCreates(),
  });

  assert.equal(diagnosis.classification, "MISSING_SOURCE");
  const formatted = formatVersionReconciliation(diagnosis);
  assert.match(formatted, /execution provenance unavailable/);
  assert.doesNotMatch(formatted, /execution provenance matches repository/);
});

test(
  "P2: archive execution provenance mismatch blocks missing-source restoration",
  async () => {
    const archiveSource = archive(7, FORMS_SQL, "0007_restore_forms_forms.sql");
    const archiveAnalysis = await analyzeMigrationFile(
      file(7, "0007_restore_forms_forms.sql", FORMS_SQL)
    );
    const archivedExecutionSql = FORMS_SQL.replace(
      "forms.forms",
      "tenant.forms"
    );
    const ledgerExecutionSql = FORMS_SQL.replace(
      "forms.forms",
      "account.forms"
    );
    const diagnosis = reconcileVersion({
      archive: {
        ...archiveSource,
        executionChecksum: checksumMigrationSql(archivedExecutionSql),
        executionTransformId: "tenant-scope",
        executionTransformVersion: "2",
      },
      archiveAnalysis,
      laterDependenciesSatisfied: true,
      ledger: {
        checksum: archiveSource.checksum,
        executionChecksum: checksumMigrationSql(ledgerExecutionSql),
        executionTransformId: "tenant-scope",
        executionTransformVersion: "1",
        name: "restore_forms_forms",
        version: 7,
      },
      physical: catalogToProjected(archiveAnalysis.effects.creates),
    });

    assert.equal(diagnosis.action.kind, "manual-review");
    assert.equal(diagnosis.autoEligible, false);
    assert.equal(diagnosis.classification, "MISSING_SOURCE");
  }
);

test("P2: archive provenance is unavailable when the ledger is absent", () => {
  const diagnosis = {
    action: {
      kind: "manual-review" as const,
      reason: "Repository has a migration with no ledger row.",
    },
    archive: archive(7, FORMS_SQL, "0007_restore_forms_forms.sql"),
    autoEligible: false,
    classification: "MISSING_LEDGER" as const,
    confidence: "AMBIGUOUS" as const,
    evidence: {
      archiveChecksum: checksumMigrationSql(FORMS_SQL),
      archiveExecutionMatchesLedger: true,
      competingArchive: false,
      executionMatchesLedger: true,
      laterDependenciesSatisfied: true,
      physicalMatchesArchive: false,
      physicalMatchesRepository: false,
      repositoryCommitted: true,
    },
    version: 7,
  };

  const formatted = formatVersionReconciliation(diagnosis);
  assert.match(formatted, /archived execution provenance unavailable/);
  assert.doesNotMatch(formatted, /archived execution provenance matches ledger/);
});

test(
  "P2: transformed archive execution provenance requires manual restoration",
  async () => {
    const executionSql = FORMS_SQL.replace("forms.forms", "tenant.forms");
    const archiveSource = archive(7, FORMS_SQL, "0007_restore_forms_forms.sql");
    const archiveAnalysis = await analyzeMigrationFile(
      file(7, "0007_restore_forms_forms.sql", FORMS_SQL)
    );
    const diagnosis = reconcileVersion({
      archive: {
        ...archiveSource,
        executionChecksum: checksumMigrationSql(executionSql),
        executionSql,
        executionTransformId: "tenant-scope",
        executionTransformVersion: "2",
      },
      archiveAnalysis,
      laterDependenciesSatisfied: true,
      ledger: {
        checksum: archiveSource.checksum,
        executionChecksum: checksumMigrationSql(executionSql),
        executionTransformId: "tenant-scope",
        executionTransformVersion: "2",
        name: "restore_forms_forms",
        version: 7,
      },
      physical: catalogToProjected(archiveAnalysis.effects.creates),
    });

    assert.equal(diagnosis.action.kind, "manual-review");
    assert.equal(diagnosis.autoEligible, false);
    assert.equal(diagnosis.confidence, "AMBIGUOUS");
  }
);

test("execution provenance drift blocks ledger repair even when authored checksums differ", async () => {
  const repository = {
    ...file(7, "0007_restore_forms_forms.sql", FORMS_SQL),
    executionSql: FORMS_SQL.replace("forms.forms", "tenant.forms"),
    executionTransform: { id: "tenant-scope", version: "2" },
  };
  const repositoryAnalysis = await analyzeMigrationFile(repository);
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: checksumMigrationSql(ORGS_SQL),
      executionChecksum: checksumMigrationSql(
        FORMS_SQL.replace("forms.forms", "account.forms")
      ),
      executionTransformId: "tenant-scope",
      executionTransformVersion: "1",
      name: repository.name,
      version: repository.version,
    },
    physical: catalogToProjected(repositoryAnalysis.effects.creates),
    repository: {
      checksum: repository.checksum,
      committed: true,
      executionSql: repository.executionSql,
      executionTransform: repository.executionTransform,
      filename: repository.filename,
      name: repository.name,
      path: repository.path,
      sql: repository.sql,
      version: repository.version,
    },
    repositoryAnalysis,
  });

  assert.equal(diagnosis.action.kind, "manual-review");
  assert.equal(diagnosis.evidence.executionMatchesLedger, false);
});

test("assemble reconciliation matches physical schema against transformed execution SQL", async () => {
  const authoredSql = FORMS_SQL;
  const executionSql = authoredSql.replace("forms.forms", "tenant.forms");
  const repository = {
    ...file(7, "0007_restore_forms_forms.sql", authoredSql),
    executionSql,
    executionTransform: { id: "tenant-scope", version: "2" },
  };
  const authoredAnalysis = await analyzeMigrationFile(repository);
  const executionAnalysis = await analyzeMigrationFile({
    ...repository,
    checksum: checksumMigrationSql(executionSql),
    sql: executionSql,
  });
  const applied = {
    ...ledger(7, repository.name, authoredSql),
    executionChecksum: checksumMigrationSql(executionSql),
    executionTransformId: "tenant-scope",
    executionTransformVersion: "2",
  };

  const report = await assembleReconciliationReport({
    analyses: [authoredAnalysis],
    applied: [applied],
    archives: [],
    files: [repository],
    physical: catalogToProjected(executionAnalysis.effects.creates),
  });

  assert.equal(report.diagnoses[0]?.classification, "CONSISTENT");
  assert.equal(report.diagnoses[0]?.evidence.physicalMatchesRepository, true);
});

test("case 4: Git forms + ledger orgs + both objects exist → AMBIGUOUS refuse", async () => {
  const repoFile = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
  const repoAnalysis = await analyzeMigrationFile(repoFile);
  const archiveAnalysis = await analyzeMigrationFile(
    file(7, "0007_orgs.sql", ORGS_SQL)
  );
  const diagnosis = reconcileVersion({
    archive: archive(7, ORGS_SQL),
    archiveAnalysis,
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: checksumMigrationSql(ORGS_SQL),
      name: "organizations",
      version: 7,
    },
    physical: catalogToProjected([
      ...repoAnalysis.effects.creates,
      ...archiveAnalysis.effects.creates,
    ]),
    repository: {
      checksum: repoFile.checksum,
      committed: true,
      filename: repoFile.filename,
      name: repoFile.name,
      path: repoFile.path,
      sql: repoFile.sql,
      version: 7,
    },
    repositoryAnalysis: repoAnalysis,
  });
  assert.equal(diagnosis.classification, "AMBIGUOUS_HISTORY");
  assert.equal(diagnosis.confidence, "AMBIGUOUS");
  assert.equal(diagnosis.action.kind, "manual-review");
  assert.equal(isHighAutoRepair(diagnosis), false);
  assert.match(
    diagnosis.action.kind === "manual-review" ? diagnosis.action.reason : "",
    /Cannot determine which migration was actually executed/
  );
  assert.match(
    diagnosis.action.kind === "manual-review" ? diagnosis.action.reason : "",
    /Automatic repair is unsafe/
  );
});

test("uncommitted repository bytes are not HIGH auto-repair even when physical matches", async () => {
  const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL, false);
  const analysis = await analyzeMigrationFile(repo);
  const diagnosis = reconcileVersion({
    laterDependenciesSatisfied: true,
    ledger: {
      checksum: checksumMigrationSql(ORGS_SQL),
      name: repo.name,
      version: 7,
    },
    physical: catalogToProjected(analysis.effects.creates),
    repository: {
      checksum: repo.checksum,
      committed: false,
      filename: repo.filename,
      name: repo.name,
      path: repo.path,
      sql: repo.sql,
      version: 7,
    },
    repositoryAnalysis: analysis,
  });
  assert.equal(isHighAutoRepair(diagnosis), false);
  assert.equal(diagnosis.confidence, "AMBIGUOUS");
});

test("assembleReconciliationReport classifies case 1 from files + ledger + catalog", async () => {
  const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
  const analysis = await analyzeMigrationFile(repo);
  const report = await assembleReconciliationReport({
    analyses: [analysis],
    applied: [ledger(7, repo.name, ORGS_SQL)],
    archives: [],
    files: [repo],
    physical: catalogToProjected(analysis.effects.creates),
  });
  assert.equal(report.diagnoses[0]?.classification, "LEDGER_SOURCE_DIVERGENCE");
  assert.equal(report.autoEligibleCount, 1);
});

test("assemble reconciliation selects the ledger-matching archive over a stale competitor", async () => {
  const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
  const analysis = await analyzeMigrationFile(repo);
  const stale = {
    ...archive(7, ORGS_SQL, "0007_stale.sql"),
    executionChecksum: checksumMigrationSql(ORGS_SQL),
    executionTransformId: "tenant-scope",
    executionTransformVersion: "1",
  };
  const matching = archive(7, FORMS_SQL, "0007_restore_forms_forms.sql");
  const report = await assembleReconciliationReport({
    analyses: [analysis],
    applied: [ledger(7, repo.name, FORMS_SQL)],
    archives: [stale, matching],
    files: [repo],
    physical: catalogToProjected(analysis.effects.creates),
  });

  const diagnosis = report.diagnoses[0];
  assert.ok(diagnosis);
  assert.equal(diagnosis.classification, "CONSISTENT");
  assert.equal(diagnosis.action.kind, "no-op");
  assert.equal(diagnosis.archive?.checksum, matching.checksum);
});

test("assemble reconciliation reports competing unmatched archives for manual review", async () => {
  const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
  const analysis = await analyzeMigrationFile(repo);
  const report = await assembleReconciliationReport({
    analyses: [analysis],
    applied: [
      ledger(
        7,
        "0007_missing.sql",
        "CREATE SCHEMA IF NOT EXISTS missing;"
      ),
    ],
    archives: [
      archive(7, ORGS_SQL, "0007_orgs.sql"),
      archive(7, "CREATE SCHEMA IF NOT EXISTS billing;", "0007_billing.sql"),
    ],
    files: [repo],
    physical: catalogToProjected(analysis.effects.creates),
  });

  const diagnosis = report.diagnoses[0];
  assert.ok(diagnosis);
  assert.equal(diagnosis.classification, "AMBIGUOUS_HISTORY");
  assert.equal(diagnosis.confidence, "AMBIGUOUS");
  assert.equal(diagnosis.action.kind, "manual-review");
  assert.equal(diagnosis.evidence.competingArchive, true);
  assert.match(
    diagnosis.action.kind === "manual-review" ? diagnosis.action.reason : "",
    /multiple archives/i
  );
});

test("migrate reconcile diagnoses checksum mismatch without executing SQL", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-reconcile-"));
  const backend = new MemoryBackend({
    catalog: {
      objects: [],
      schema: catalogToProjected(
        (
          await analyzeMigrationFile(
            file(7, "0007_restore_forms_forms.sql", FORMS_SQL)
          )
        ).effects.creates
      ),
    },
    rows: [ledger(7, "restore_forms_forms", ORGS_SQL)],
  });
  try {
    writeProject(root, { "0007_restore_forms_forms.sql": FORMS_SQL });
    const logs: string[] = [];
    const summary = await runMigrations({
      createBackend: async () => backend,
      cwd: root,
      log: (message) => {
        logs.push(message);
      },
      mode: "reconcile",
    });
    assert.equal(backend.appliedSql.length, 0);
    assert.ok(summary.reconciliation);
    assert.equal(
      logs.join("\n").includes("Migration SQL will NOT be executed"),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("migrate reconcile --apply repairs HIGH ledger checksum and never runs migration SQL", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-reconcile-apply-"));
  const repo = file(7, "0007_restore_forms_forms.sql", FORMS_SQL);
  const analysis = await analyzeMigrationFile(repo);
  const backend = new MemoryBackend({
    catalog: {
      objects: analysis.effects.creates,
      schema: catalogToProjected(analysis.effects.creates),
    },
    rows: [ledger(7, repo.name, ORGS_SQL)],
  });
  try {
    writeProject(root, { "0007_restore_forms_forms.sql": FORMS_SQL });
    gitInit(root);
    await runMigrations({
      applyReconcile: true,
      createBackend: async () => backend,
      cwd: root,
      mode: "reconcile",
      yes: true,
    });
    assert.equal(backend.appliedSql.length, 0);
    assert.equal(backend.rows[0]?.checksum, checksumMigrationSql(ORGS_SQL));
    assert.equal(backend.journals.length, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("migrate reconcile --apply restores archived SQL into the repository", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-reconcile-restore-"));
  const archived = archive(7, FORMS_SQL, "0007_restore_forms_forms.sql");
  const archiveAnalysis = await analyzeMigrationFile(
    file(7, "0007_restore_forms_forms.sql", FORMS_SQL)
  );
  const backend = new MemoryBackend({
    archives: [archived],
    catalog: {
      objects: archiveAnalysis.effects.creates,
      schema: catalogToProjected(archiveAnalysis.effects.creates),
    },
    rows: [
      {
        appliedAt: new Date(),
        checksum: archived.checksum,
        executionMs: 1,
        name: "restore_forms_forms",
        version: 7,
      },
    ],
  });
  try {
    writeProject(root, { "0007_restore_forms_forms.sql": ORGS_SQL });
    gitInit(root);
    await runMigrations({
      applyReconcile: true,
      createBackend: async () => backend,
      cwd: root,
      mode: "reconcile",
      yes: true,
    });
    assert.equal(backend.appliedSql.length, 0);
    assert.equal(
      readFileSync(
        join(root, "athena", "migrations", "0007_restore_forms_forms.sql"),
        "utf8"
      ).trim(),
      FORMS_SQL
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
