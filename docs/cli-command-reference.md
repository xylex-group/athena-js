# Athena JS CLI Command Reference

This page is the source of truth for `athena-js` CLI usage.

If you only need generated contract output, this page plus
[`generator-config.md`](generator-config.md) is enough.

## Command surface

Current CLI scope is intentionally focused:

- root help
- `generate` subcommand

## Root commands

```bash
athena-js
athena-js --help
athena-js -h
athena-js help
athena-js help generate
```

Behavior:

- `athena-js`, `--help`, `-h`, and `help` print root usage
- `athena-js help generate` prints `generate` usage

## Generate command

```bash
athena-js generate
athena-js generate --dry-run
athena-js generate --config ./athena.config.ts
athena-js generate --config ./athena.config.ts --dry-run
athena-js generate --help
```

Options:

- `--config <path>`: explicit config file (relative or absolute)
- `--dry-run`: render artifacts and print output paths without writing files
- `--help`, `-h`: show generate-specific help

## What each command does

| Command | Effect |
| --- | --- |
| `athena-js generate` | Loads config, introspects provider, writes generated files |
| `athena-js generate --dry-run` | Same pipeline, no file writes |
| `athena-js generate --config <path>` | Uses provided config path instead of discovery |
| `athena-js generate --help` | Prints `generate` usage and exits |

## Config discovery order

When `--config` is omitted, resolution order is:

1. `athena.config.ts`
2. `athena.config.js`
3. `athena-js.config.ts`
4. `athena-js.config.js`
5. `.athena.config.ts`
6. `.athena.config.js`

## Local vs global execution

For reproducible CI and team workflows, prefer local execution from the project:

```bash
pnpm exec athena-js generate --dry-run
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
```

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

Fix:

- add one of the supported config filenames, or pass `--config <path>`

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
