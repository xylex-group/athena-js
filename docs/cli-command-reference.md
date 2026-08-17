# Athena JS CLI Command Reference

This page is the source of truth for `athena-js` CLI usage.

If you only need generated contract output, this page plus
[`generator-config.md`](generator-config.md) is enough.

## Command surface

Current CLI scope:

- root help + global `-v` / `--version` + full inventory via `--commands` / `-C`
- `generate` subcommand (introspect + write models/registry; optional config ensure)
- `init` subcommand (create or intelligently update `athena.config.ts`)
- `migrate` subcommand (apply/status/plan application SQL migrations; direct Postgres)
- `env check` / `env validate` (validate `.env` / `.env.local` keys and URLs)
- `api-key generate` (local secret scaffolding)
- `api-key create` / `api-key list` (gateway admin `POST/GET /admin/api-keys`)
- `rights list` / `rights catalog` / `rights create` (gateway admin rights surfaces)

## Root commands

```bash
athena-js
athena-js --help
athena-js -h
athena-js help
athena-js help generate
athena-js help init
athena-js help migrate
athena-js help env
athena-js help api-key
athena-js help commands
athena-js --version
athena-js -v
athena-js version
athena-js v
athena-js version --short
athena-js --commands
athena-js -C
athena-js commands
athena-js list-commands
athena-js cmds
athena-js commands --json
athena-js commands --plain
athena-js commands --groups
```

Behavior:

- `athena-js`, `--help`, `-h`, and `help` print root usage
- `athena-js help generate` prints `generate` usage
- `athena-js help init` prints `init` usage
- `-v`, `--version`, `version`, and `v` print `@xylex-group/athena <semver>`
- `version --short` / `-q` print only the semver
- `--commands`, `-C`, `commands`, `list-commands`, `cmds`, `--list-commands`, and `--cmds` print the full command catalog (aliases + common flags)
- `commands --json` / `--plain` / `--groups` change catalog output format

## Version

```bash
athena-js --version
athena-js -v
athena-js version
athena-js v
athena-js version --short
```

Prints the installed package version from `@xylex-group/athena` (`package.json`).

## Commands inventory

```bash
athena-js --commands
athena-js -C
athena-js commands
athena-js list-commands
athena-js cmds
athena-js --list-commands
athena-js --cmds
athena-js commands --json
athena-js commands --plain
athena-js commands --groups
athena-js help commands
```

Prints the SSOT command catalog (`src/cli/commands-catalog.ts`):

| Format | Flag | Output |
| --- | --- | --- |
| full (default) | _(none)_ | Grouped inventory with descriptions, aliases, flags, help topics |
| json | `--json` | Machine-readable `{ sdkVersion, count, commands[] }` |
| plain | `--plain` | One command path / word alias per line (scripting) |
| groups | `--groups` | Compact group → command list |

Use `athena-js <command> --help` for detailed flags on a single command.

## Env check

```bash
athena-js env
athena-js env check
athena-js env validate
athena-js env check --file .env.local --mode gateway
athena-js env check --mode direct --strict
athena-js env check --json
athena-js env --help
```

Validates Athena-related keys and URLs from project env files and process env.

Default file load order (same as the generator):

1. `.env`
2. `.env.local`
3. `.env.<NODE_ENV>`
4. `.env.<NODE_ENV>.local`

Process env wins over file values. Use `--file` (repeatable) to inspect specific paths only.

| Option | Effect |
| --- | --- |
| `--file <path>` / `-f` | Inspect only this file (repeatable) |
| `--mode auto\|direct\|gateway` | Expected connection mode (default `auto`) |
| `--strict` | Promote soft warnings (e.g. short secrets) to errors |
| `--json` | Machine-readable JSON report |
| `--help`, `-h` | Env help |

Checks include:

- gateway URL absolute `http(s)` (`ATHENA_URL`, `ATHENA_GATEWAY_URL`, …)
- API key presence / non-placeholder (`ATHENA_API_KEY`, …)
- direct Postgres URL shape (`DATABASE_URL`, `PG_URL`, …)
- optional `ATHENA_CLIENT`, `ATHENA_AUTH_URL`

Exit code `1` when any check is `error`.

## API keys

```bash
# Local scaffold (no network)
athena-js api-key generate
athena-js api-key generate --write
athena-js key generate --prefix "" --bytes 24

# Gateway admin (static admin key)
athena-js api-key list
athena-js api-key create --name analytics --rights gateway.query --client-name analytics --write
athena-js api-key create --name app --rights gateway.query,gateway.read --json
athena-js api-key --help
```

### Local `generate`

Cryptographically strong offline secret for scaffolding `ATHENA_API_KEY`.

| Option | Effect |
| --- | --- |
| `--bytes <n>` | Entropy bytes before base64url (16–64, default 32) |
| `--prefix <str>` | Prefix (default `ath_`; use `--prefix ""` for none) |
| `--write` | Write into env file (default `.env.local`) |
| `--env-file <path>` | Target file (implies `--write`) |
| `--env-key <name>` | Variable name (default `ATHENA_API_KEY`) |
| `--force` | Overwrite an existing value |

### Gateway `create` / `list`

Calls Athena gateway admin routes with the **static admin key**
(`ATHENA_KEY_12` / `ATHENA_P12_KEY` / `ATHENA_ADMIN_KEY`), not the runtime app key.

| Subcommand | Route |
| --- | --- |
| `api-key list` | `GET /admin/api-keys` |
| `api-key create` | `POST /admin/api-keys` |

| Option | Effect |
| --- | --- |
| `--name <name>` | Display name (**create**, required) |
| `--rights <a,b>` | Comma-separated rights (must already exist in `api_key_rights`) |
| `--client-name <c>` | Bind key to `X-Athena-Client` |
| `--description <text>` | Optional description |
| `--expires-at <iso>` | Optional expiration |
| `--url <gateway>` | Override `ATHENA_URL` / `ATHENA_GATEWAY_URL` |
| `--admin-key <secret>` | Override static admin secret |
| `--write` | Save returned plaintext to env as `ATHENA_API_KEY` |
| `--env-file` / `--env-key` / `--force` | Env write controls (same as generate) |
| `--json` | Machine-readable output |

Plaintext `ath_{public}.{secret}` is returned **once** on create.

This is **not** Auth `POST /api-key/create` (user keys via `client.auth.apiKey.*`).

## Rights

```bash
athena-js rights catalog
athena-js rights list
athena-js rights create --name gateway.query --description "Run /gateway/query"
athena-js rights catalog --json
athena-js rights --help
```

| Subcommand | Route | Purpose |
| --- | --- | --- |
| `rights catalog` | `GET /admin/rights/catalog` | Unified native + dynamic rights catalog |
| `rights list` | `GET /admin/api-key-rights` | Dynamic rights store rows |
| `rights create` | `POST /admin/api-key-rights` | Bootstrap a right before granting it on a key |

Auth: same static admin key + gateway URL as `api-key create/list`.

Typical flow:

```bash
athena-js rights catalog
athena-js rights create --name gateway.query --description "Run /gateway/query"
athena-js api-key create --name app --rights gateway.query --write
athena-js env check --mode gateway
```

## Migrate command

```bash
athena-js migrate
athena-js migrate --dry-run
athena-js migrate status
athena-js migrate plan
athena-js migrate --config ./athena.config.ts
athena-js migrate --help
```

Applies ordered SQL files from `athena/migrations` (or `migrations.directory`) against a
**direct** PostgreSQL database. See [migrations.md](migrations.md) for ledger, checksum,
advisory lock, and immutability guarantees.

| Option / subcommand | Effect |
| --- | --- |
| `(default)` | Apply pending migrations |
| `status` | Print applied/pending/conflict table (no writes beyond ledger bootstrap/lock) |
| `plan` | Show plan; fail closed on history conflicts |
| `--dry-run` | List pending migrations without applying |
| `--config <path>` | Explicit config path |
| `--help`, `-h` | Migrate help |

## Generate command

```bash
athena-js generate
athena-js generate --dry-run
athena-js generate --config ./athena.config.ts
athena-js generate --config ./athena.config.ts --dry-run
athena-js generate --no-write-config
athena-js generate --no-discover-schemas
athena-js generate --help
```

Options:

| Option | Effect |
| --- | --- |
| `--config <path>` | Explicit config file (relative or absolute) |
| `--dry-run` | Render artifacts and print mode/target hints without writing model/registry files; config ensure is also dry-run only |
| `--no-write-config` | Do not create or update `athena.config.ts` (pure env-only / locked-config CI) |
| `--no-discover-schemas` | Skip live schema discovery; use only configured or env schema lists |
| `--write-config` | Explicitly enable config ensure (default) |
| `--help`, `-h` | Show generate-specific help |

### What generate does by default

1. Load `athena.config.*` or env-only provider defaults
2. **Discover** non-system PostgreSQL schemas that contain tables (direct `pg` or gateway `/gateway/query`)
3. Expand the effective schema list used for introspection (never removes configured schemas)
4. **Ensure** `athena.config.ts` intelligently:
   - create when missing
   - surgically patch `provider.schemas` when discovery finds new schemas
   - skip write when schemas already match (safe for typecheck / CI)
5. Introspect → render → write model/schema/database/registry artifacts

```bash
# Full default pipeline
athena-js generate

# Review only (no model files, no config writes)
athena-js generate --dry-run

# Pure env-only CI that must not touch athena.config.ts
athena-js generate --no-write-config --no-discover-schemas
```

### Migrate command

```bash
athena-js migrate
athena-js migrate --dry-run
athena-js migrate status
athena-js migrate plan
athena-js migrate --config ./athena.config.ts
athena-js migrate --help
```

Applies ordered SQL files from `athena/migrations` (or `migrations.directory`) against a
**direct** PostgreSQL database. See [migrations.md](migrations.md) for ledger, checksum,
advisory lock, and immutability guarantees.

| Option / subcommand | Effect |
| --- | --- |
| `(default)` | Apply pending migrations |
| `status` | Print applied/pending/conflict table (no writes beyond ledger bootstrap/lock) |
| `plan` | Show plan; fail closed on history conflicts |
| `--dry-run` | List pending migrations without applying |
| `--config <path>` | Explicit config path |
| `--help`, `-h` | Migrate help |

## Generate command matrix

| Command | Effect |
| --- | --- |
| `athena-js generate` | Load config/env, discover schemas, ensure config, introspect, write artifacts |
| `athena-js generate --dry-run` | Same pipeline without disk writes for artifacts or config; prints mode/target/config lines |
| `athena-js generate --config <path>` | Uses provided config path instead of discovery |
| `athena-js generate --no-write-config` | Never create/update `athena.config.ts` |
| `athena-js generate --no-discover-schemas` | Use only configured/env schemas for introspection |
| `athena-js generate --help` | Prints `generate` usage and exits |

Dry-run and write mode both print a `[config]` summary line when config ensure ran:

```text
[config] unchanged athena.config.ts schemas=public,athena,forms,billing
[config] reason: schemas already match discovered/configured set
```

or:

```text
[config] created athena.config.ts schemas=public,athena
[config] reason: config file missing
```

## Init command

```bash
athena-js init
athena-js init --mode direct
athena-js init --mode gateway
athena-js init --force
athena-js init --dry-run
athena-js init --no-discover-schemas
athena-js init --config ./athena.config.ts
athena-js init --help
```

Options:

| Option | Effect |
| --- | --- |
| `--config <path>` | Target path (default: discovered config or `athena.config.ts` in cwd) |
| `--mode direct\|gateway\|auto` | Provider mode for new files (`auto` = direct if `DATABASE_URL`/PG URL, else gateway if `ATHENA_URL`+`ATHENA_API_KEY`) |
| `--force` | Rewrite the full modern template even if a config already exists |
| `--dry-run` | Print planned action (and planned content when creating/updating) without writing |
| `--no-discover-schemas` | Do not query the database; keep `public` or existing schemas |
| `--help`, `-h` | Show init-specific help |

### Init intelligence rules

| Situation | Behavior |
| --- | --- |
| Config missing | Write modern `athena-direct` + `table-builder` template with `generatorEnv` secrets |
| Config exists, schemas already match | **No write** (`unchanged`) |
| Config exists, discovery finds extra schemas | Surgical patch of `provider.schemas` only |
| Custom output / naming / features | Preserved unless `--force` |
| Gateway mode | `generatorEnv("ATHENA_URL")` + `generatorEnv("ATHENA_API_KEY")` |

Examples:

```bash
# Bootstrap a committed config from env
athena-js init

# Explicit gateway template + live schema auto-fill
ATHENA_URL=https://athena.example.com ATHENA_API_KEY=secret \
  athena-js init --mode gateway

# Preview only
athena-js init --dry-run
```

Created template shape (abbreviated):

```ts
import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct", // or "gateway"
    connectionString: generatorEnv("DATABASE_URL"),
    // gateway: gatewayUrl / apiKey via generatorEnv
    schemas: ["public", "athena" /* …discovered */],
  },
  output: {
    format: "table-builder",
    preset: "athena-direct",
    targets: {
      model: "athena/models/{schema_kebab}/{model_kebab}.ts",
      schema: "athena/schemas/{schema_kebab}.ts",
      database: "athena/relations.ts",
      registry: "src/lib/athena/generated/registry.ts",
    },
  },
  // naming + features + experimental defaults…
});
```

## Config discovery order

When `--config` is omitted, resolution order is:

1. `athena.config.ts`
2. `athena.config.js`
3. `athena-js.config.ts`
4. `athena-js.config.js`
5. `.athena.config.ts`
6. `.athena.config.js`

If none of those files exist, `athena-js generate` still runs when either of these env-only profiles is present:

- direct mode: `DATABASE_URL` or another supported Postgres URL key
- gateway mode: `ATHENA_URL`, `ATHENA_API_KEY`, and usually `ATHENA_GENERATOR_DB`

By default, generate will then **create** `athena.config.ts` from those env defaults (unless `--no-write-config`).

Examples:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run
```

```bash
ATHENA_URL=https://athena-db.com ATHENA_API_KEY=secret ATHENA_GENERATOR_DB=app_db athena-js generate --dry-run
```

## Local vs global execution

For reproducible CI and team workflows, prefer local execution from the project:

```bash
pnpm exec athena-js generate --dry-run
pnpm exec athena-js init --dry-run
```

If you need a global binary:

```bash
pnpm add -g @xylex-group/athena
```

## Windows global shim troubleshooting

If `athena-js` behaves differently than `node_modules/@xylex-group/athena/dist/cli/index.js`, verify which shim PowerShell resolves:

```powershell
Get-Command athena-js | Format-List Source,Definition
```

Typical stale-path symptom:

- command resolves to an old global shim still pointing to an outdated package path

Recovery:

```powershell
pnpm remove -g @xylex-group/athena
pnpm add -g @xylex-group/athena
```

Then re-check:

```powershell
athena-js --help
athena-js generate --help
athena-js init --help
```

## Dry-run review behavior

`athena-js generate --dry-run` prints:

- the active `output.preset`
- the active `output.format`
- the resolved provider mode/database/schema selection (after discovery merge)
- the resolved `model`, `schema`, `database`, and `registry` targets
- config ensure action (`created` / `updated` / `unchanged` / `skipped`) when write-config is enabled
- a warning when registry output still points at `athena/config.ts`
- the generated file list

The default generator mode is `preset=athena-direct` plus `format=table-builder`. `legacy` and `define-model` are compatibility-only when explicitly selected.

Normal write mode also prints protected skip lines when existing `database` or
`registry` artifacts are preserved instead of overwritten.

Recommended direct Athena layout:

```ts
output: {
  preset: "athena-direct",
  format: "table-builder",
}
```

That keeps model output in `athena/models/{schema}/*` while moving registry
generation to `src/lib/athena/generated/registry.ts`.

## Common failures and exact meaning

### `ERR_MODULE_NOT_FOUND` for `dist/cli/index.js`

Example pattern:

```text
Cannot find module .../@xylex-group/athena/dist/cli/index.js
```

Meaning:

- global package install is missing generated CLI bundle files
- common with old/broken published versions or stale shims

Fix:

- reinstall globally with pnpm, or run from project-local dependency with `pnpm exec`

### Postgres `3D000` (`database "<name>" does not exist`)

Example:

```text
PostgreSQL database "app_db" does not exist (code 3D000).
```

Meaning:

- provider config points to a database name that is not present on the Postgres server

Fix:

- create the database, or
- update `provider.connectionString` and (if set) `provider.database` in your config

### `Unknown option "--help"` on `generate`

This should not occur on current code. If it does, your CLI binary is older than the latest SDK branch/package containing generate-help support.

Fix:

- refresh local/global install, then re-run `athena-js generate --help`

### `No generator config found in <cwd>`

Meaning:

- no discoverable config file in current working directory
- and no usable env-only provider (`DATABASE_URL` / `ATHENA_URL`+`ATHENA_API_KEY`)

Fix:

- run `athena-js init` after setting env, or
- add one of the supported config filenames, or
- pass `--config <path>`, or
- export a supported connection string / gateway pair

### Schema discovery failed (config ensure note)

Meaning:

- live schema listing could not reach Postgres or the gateway
- generate continues with configured/env schemas when possible

Fix:

- verify connectivity (same as introspection)
- use `--no-discover-schemas` if you want a fixed list only

## Debugging mode

By default, the CLI prints message-first errors for readability.

To print full stack traces from the bootstrap layer:

```powershell
$env:ATHENA_JS_DEBUG="1"
athena-js generate --config ./athena.config.ts --dry-run
```

## Athena JS and Athena RS positioning

`athena-js` and `athena-rs` are complementary, not mutually exclusive:

- `athena-rs`: best fit for Rust services, high-throughput backend execution, and low-level runtime performance
- `athena-js`: best fit for TypeScript/Node apps, React integration, and typed schema generation workflows close to frontend/fullstack teams

A practical split:

- use `athena-rs` inside Rust services
- use `athena-js` in web apps/tooling where TypeScript contracts and React hooks are needed

Both are standalone SDKs with different runtime strengths.

## Recommended team baseline

1. Pin `@xylex-group/athena` in project dependencies.
2. Run CLI through `pnpm exec` in scripts and CI.
3. Keep global install only for ad-hoc local usage.
4. Keep `athena.config.ts` in repo root unless monorepo structure requires explicit `--config`.
5. Prefer `athena-js init` once, then `athena-js generate` for model/registry artifacts.
6. In locked CI, use `--no-write-config` when the config file must not change in the job.
