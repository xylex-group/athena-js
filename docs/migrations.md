# Athena JS SQL migrations

Production-grade **application** SQL migrations for Athena projects.

> **Schema Diff foundation:** structured comparison of desired vs actual
> Athena-managed schema snapshots lives in [`schema-diff.md`](./schema-diff.md).
> Diff does not emit SQL or run migrations — it feeds future planning layers.

Migrations are **tooling-only**. They never run because application code
imported `@xylex-group/athena` or constructed a client.

## Commands

```bash
pnpm exec athena-js migrate
pnpm exec athena-js migrate status
pnpm exec athena-js migrate plan
pnpm exec athena-js migrate --dry-run
pnpm exec athena-js migrate --config ./athena.config.ts
```

Help:

```bash
athena-js --help
athena-js migrate --help
athena-js migrate status --help
```

## Directory layout

Default directory (project cwd):

```text
athena/migrations/
  0001_initial.sql
  0002_form_schema_revision.sql
  0003_add_indexes.sql
```

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
