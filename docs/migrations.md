# Athena JS SQL migrations

Production-grade **application** SQL migrations for Athena projects.

> **Schema IR / Diff:** canonical structure is Schema IR v2
> ([`schema-ir.md`](./schema-ir.md)). Structured compare of desired vs actual
> lives in [`schema-diff.md`](./schema-diff.md). Diff does not emit SQL or run
> migrations — it feeds future planning layers. Independent of ADR 0036
> (SQL migrate compiler).

Migrations are **tooling-only**. They never run because application code
imported `@xylex-group/athena` or constructed a client.

## Commands

```bash
pnpm exec athena-js migrate
pnpm exec athena-js migrate status
pnpm exec athena-js migrate plan
pnpm exec athena-js migrate check --strict
pnpm exec athena-js migrate graph
pnpm exec athena-js migrate explain 0007
pnpm exec athena-js migrate drift
pnpm exec athena-js migrate reconcile
pnpm exec athena-js migrate reconcile --json
pnpm exec athena-js migrate reconcile --apply --yes
pnpm exec athena-js migrate --dry-run
pnpm exec athena-js migrate --allow-dirty-migrations --yes
pnpm exec athena-js migrate --config ./athena.config.ts
pnpm exec athena-js migrate auth sync
```

Help:

```bash
athena-js --help
athena-js migrate --help
athena-js migrate status --help
```

## Directory layout

Project-root Athena workspace (default):

```text
athena/migrations/
  Project-owned, editable, authoritative application SQL.
  Ledger: athena.schema_migrations.

athena/managed/auth/migrations/
  Athena-owned, generated, read-only local representation of
  embedded Auth generations. Runtime apply never executes these
  files. Canonical SQL lives in @xylex-group/athena.

athena/generated/
  Generated TypeScript database/schema/model contracts.
```

Default application directory (project cwd):

```text
athena/migrations/
  0001_initial.sql
  0002_form_schema_revision.sql
  0003_add_indexes.sql
```

`athena-js migrate` creates `athena/`, `athena/migrations/` (with `.gitkeep`),
and `athena/managed/auth/migrations/` when they are missing. A missing
application migrations directory is not an error.

Materialized Auth files use the package generation names
(`001_create_core_tables.sql`, …) plus an AUTO-GENERATED header. If a local
copy is edited, `migrate status` / `migrate check` report
`ATHENA-MIG-AUTH-MANAGED-001`. Restore with:

```bash
athena-js migrate auth sync
```

`migrate` apply rematerializes the canonical files before executing package-owned
Auth SQL on the dedicated Auth ledger/lock.

Override in `athena.config.ts`:

```ts
import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL"),
    schemas: ["public"],
  },
  migrations: {
    directory: "./athena/migrations",
  },
});
```

### Filename rules

- Canonical pattern: `<digits>_<name>.sql` (example: `0002_add_users.sql`)
- Ordering is by **numeric version** (gaps allowed; `0001`, `0002`, `0005` is valid)
- Duplicate versions are rejected
- Malformed `*.sql` names are rejected
- Incidental non-SQL files are ignored (`README.md`, `.gitkeep`, dotfiles)

## Provider support

| Provider | Support |
| --- | --- |
| `postgres` + `mode: "direct"` | **Supported** (production) |
| `postgres` + `mode: "gateway"` | Not supported — fail closed |
| D1 / Scylla | Not supported in v1 |

Raw DDL needs privileged database access. Do not route arbitrary migration SQL
through ordinary Athena data/query gateway endpoints.

## Compiler model

Application migrate reconciles **three truths**: ledger rows, local SQL
semantics, and the live PostgreSQL catalog. A ledger row is not proof that
`CREATE TABLE` effects still exist.

Each file is parsed with libpg-query (`pgsql-parser`). Function bodies
(`LANGUAGE sql`) are parsed as SQL so `FROM forms.forms` is a table
dependency. The runner projects pending files onto the catalog
statement-by-statement and **preflights the whole pending batch**. If a later
file is unsafe, earlier pending files are not applied.

Ledger-applied providers whose objects are missing classify as
`physical_schema_drift` (`ATHENA-MIG-DRIFT-001`) and fail closed before
`BEGIN`. Restore the object (or add a forward migration) rather than editing
an applied file.

`stripSqlCommentsAndLiterals()` remains the cheap transaction-control scanner
only. See [ADR 0036 technical](../../docs/adr/technical/0036-athena-js-sql-migration-compiler.md).

## Three-way reconciliation

Neither the checkout nor the ledger is authoritative. `athena-js migrate reconcile`
compares three inputs and asks which combination best explains the live database:

```text
A. Repository  — committed SQL, Git blob/commit provenance
B. Ledger      — version, name, checksum, archived SQL, fingerprints
C. Physical    — schemas/tables/columns/functions present in pg_catalog
```

`reconcile` never executes migration SQL. It diagnoses and prints a repair plan.
`--apply` performs **HIGH-confidence metadata repairs only** (ledger checksum
or restore archived SQL into the working tree). Off-TTY `--apply` requires `--yes`.

Confidence:

| Level | Meaning | `--apply` |
| --- | --- | --- |
| HIGH | Athena can prove the intended repair | Eligible |
| MEDIUM | Evidence favors one repair | Refused |
| AMBIGUOUS | Multiple histories explain the database | Refused |

Example HIGH ledger repair (repo + physical agree, no competing archive):

```text
Classification: LEDGER_SOURCE_DIVERGENCE
Confidence: HIGH
Recommended repair: Update ledger checksum 6d93… → 25b36…
Migration SQL will NOT be executed.
```

If Git creates `forms.forms`, the ledger/archive created `organizations`, and
both objects exist: `AMBIGUOUS_HISTORY` — automatic repair is unsafe.

Physical drift when repo and ledger already agree produces
`create-forward-repair` (a new migration). Athena never silently reruns an
applied file.

Authority order when reconstructing history:

1. Exact archived executed SQL (`athena.schema_migration_sources`)
2. Ledger checksum + recorded Git blob/commit
3. Git history / committed migrations
4. Semantic migration effects
5. Physical database state
6. Current uncommitted filesystem state (weakest)

Successful apply archives the exact SQL bytes and SHA-256 fingerprints of the
catalog before and after execution. Repairs are journaled in
`athena.schema_migration_reconciliations`.

Apply and repair **fail closed** when Git reports uncommitted changes under
the migrations directory, or to Athena migrate config files
(`athena.config.ts`, `athena-js.config.ts`, …). App-only dirty files do not
block. `migrate plan` warns and includes the Git state; it does not fail.
Override apply with `--allow-dirty-migrations --yes` only when recording
uncommitted bytes is intentional. That execution is stored with
`source_dirty = true`.

## Safety model

1. **Discovery** of local ordered SQL files
2. **SHA-256 checksum** of exact UTF-8 file bytes (no silent normalization)
3. **Ledger** table `athena.schema_migrations` in the application database
4. **PostgreSQL session advisory lock** for the full run (concurrent deploy safe)
5. **Planner** compares local files vs ledger (applied / pending / conflicts)
6. **One transaction per migration**: execute full SQL file → insert ledger row → commit
7. Failure → rollback that migration, no ledger row, later migrations not attempted
8. Applied migrations are **immutable** (checksum mismatch fails closed; no `--force`)
9. Database-ahead history (ledger version missing locally) fails closed on apply/status
10. Migration SQL must **not** contain transaction control (`COMMIT`, `ROLLBACK`, `START TRANSACTION`, `BEGIN TRANSACTION`, …). The runner owns the outer transaction so schema changes and the ledger row stay atomic. PL/pgSQL `BEGIN`/`END` inside functions is allowed.

### Ledger schema

```sql
CREATE SCHEMA IF NOT EXISTS athena;

CREATE TABLE IF NOT EXISTS athena.schema_migrations (
  version BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_ms BIGINT NOT NULL
);
```

Bootstrap is idempotent and runs only for `athena-js migrate` (apply mode).
`status`, `plan`, and `--dry-run` never create the schema or ledger table; a
missing ledger is treated as empty history so inspection stays non-mutating
(and works with read-only CI credentials).

### Advisory locking

Session-level `pg_advisory_lock(ATHA, MIGS)` covers the connected run:

```text
apply: ledger bootstrap → read applied → integrity → plan → apply
inspect: read applied (empty if missing) → integrity → plan/status/dry-run
```

Released in `finally`. If the session dies, PostgreSQL drops session locks.

This lock covers **application** migrations only (`athena.schema_migrations`).
Embedded Auth opens a separate `AthenaAuthDatabase` connection and takes its
own session lock (`ATHENA_AUTH_MIGRATION_ADVISORY_LOCK`, also used as a
transaction lock inside `migrateAthenaAuthSchema` / `repairAthenaAuthSchema`).
Do not consolidate those ledgers: application SQL is project-owned; Auth
generations are package-owned.

```text
athena-js migrate
       │
       ├── Application migrations     pg_advisory_lock(ATHA, MIGS)
       │     project-owned SQL
       │     athena.schema_migrations
       │
       └── Embedded Auth migrations   pg_advisory_lock(ATHENA_AUTH_MIGRATION_ADVISORY_LOCK)
             Athena-owned schema
             package-defined generations
             plan / drift / repair
```

## Deployment usage

Prefer an explicit migrate step **before** deploy:

```bash
pnpm exec athena-js migrate
pnpm run deploy
```

CI:

```yaml
- run: pnpm exec athena-js migrate
- run: pnpm run deploy
```

Do **not** run migrations as a side effect of request handling or `createClient`.

## Programmatic API (Node only)

```ts
import { runMigrations } from "@xylex-group/athena/migrations";

await runMigrations({
  cwd: process.cwd(),
  configPath: "./athena.config.ts",
  dryRun: false,
});
```

This subpath is server/CLI only. Do not import it from browser or React Native bundles.

## Missing directory

- `migrate status` with no directory and empty history reports that no directory was found
- `migrate` does **not** auto-create the directory
- Empty / missing migrations with a clean ledger exits successfully (“No migrations found” / up to date)

## Speedrun Formations migration path

Replace bespoke scripts such as `scripts/apply-form-schema-revision-migration.mjs` with:

```text
athena/migrations/
  0001_forms_bootstrap.sql
  0002_form_schema_revision.sql
```

```json
{
  "scripts": {
    "db:migrate": "athena-js migrate",
    "db:migrate:status": "athena-js migrate status"
  }
}
```

## Related

- [CLI command reference](cli-command-reference.md)
- [Generator config](generator-config.md)
- ADR 0022 canonical app layout (runtime never imports `athena.config.ts`)
