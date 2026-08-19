# Athena JS release verification

Local verification is the release source of truth for `@xylex-group/athena`. GitHub CI mirrors the same command. CI is not the system.

ADR: [docs/adr/technical/0019-athena-js-local-verification-ssot.md](../../../docs/adr/technical/0019-athena-js-local-verification-ssot.md). Spec: [docs/sdd/xylex/athena-js-local-finality-gate/SPEC.md](../../../docs/sdd/xylex/athena-js-local-finality-gate/SPEC.md).

## Commands

```bash
pnpm --dir packages/athena-js test:finality
pnpm --dir packages/athena-js release:verify
```

| Script | Role |
| --- | --- |
| `test:finality` | Ordered fail-closed proof of the packed package (SSOT) |
| `release:verify` | `test:finality && test:tarball && test:examples` |
| `prepublishOnly` | `pnpm release:verify` (not weaker) |
| `check:all` / `check:release` | Iteration / static package checks only — **not** releasable |

Red cannot release. Green is releasable.

## `test:finality` order

Implemented by [`scripts/run-finality.mjs`](../scripts/run-finality.mjs):

1. typecheck
2. unit / regression (`pnpm test`)
3. ownership (`test/finality/ownership.test.ts`)
4. package build
5. package exports (`test/finality/exports.test.ts` + `check:exports`)
6. browser contamination (`test/finality/browser-boundary.test.ts` + `test:browser-bundle`)
7. `create-athena-app` fixture check (`test/fixtures/next-embedded`)
8. `pnpm pack --pack-destination .tmp/packages` and install the `.tgz` into `test/fixtures/{package-consumer,next-embedded}`
9. ephemeral PostgreSQL (`test/fixtures/postgres-runtime`)
10. Next embedded E2E (`test/finality/embedded-next.test.ts`) against **node_modules** from the tarball
11. cleanup + leak / process checks

First failure stops the run and writes a failed report.

## PostgreSQL

Resolution (never skip):

1. `ATHENA_TEST_DATABASE_URL` if it is a `postgres(ql)://` URI
2. else `DATABASE_URL` if it is a `postgres(ql)://` URI
3. else auto-launch ephemeral Postgres (`docker` or `podman`), allocate a fresh database, destroy on cleanup

Missing URL **and** missing Docker/Podman is a hard fail. Neon / Railway / GitHub `services:` are not the gate. Optional `test:integration:postgres` skip-if-no-URL files remain for iteration only.

## Packed artifact

E2E imports `@xylex-group/athena`, `@xylex-group/athena/server`, `@xylex-group/athena/next/client`, and `@xylex-group/athena/next/server` from the installed tarball. `file:../../src` and source aliases are illegal.

## Happy path and negatives

`test/finality/embedded-next.test.ts` proves, in one run:

root `createClient()` → Postgres runtime → migrations → embedded Auth (`auth.mode: "local"`) → `/api/athena` + `/api/auth` on the **root** → insert → browser-facing read → sign up → sign in → session `Set-Cookie` → server session resolve → organization create/select → organization-scoped query.

Same suite (plus ownership / exports / browser-boundary):

| ID | Invariant |
| --- | --- |
| N1 | Request client / `withContext` view cannot be the handler root |
| N2 | Browser bundle cannot resolve `pg` or `server-only` |
| N3 | `/server` has no browser export conditions |
| N4 | Second root with the same `DATABASE_URL` reuses the runtime |
| N5 | Different `DATABASE_URL` gets a different runtime |
| N6 | Request context does not mutate root state |
| N7 | Closing a request client does not close Postgres |
| N8 | A failed auth request does not poison later requests |

## Report

Path: `packages/athena-js/.tmp/athena-finality.json` (generated; do not commit).

```json
{
  "package": "@xylex-group/athena",
  "version": "<package.json version>",
  "commit": "<full git SHA of HEAD>",
  "passed": true,
  "checks": {
    "unit": true,
    "ownership": true,
    "exports": true,
    "browserIsolation": true,
    "tarballConsumer": true,
    "postgres": true,
    "embeddedAuth": true,
    "nextE2E": true
  }
}
```

`passed` is true iff every `checks` key is true. Failure still writes the file (overwrites a previous green report).

Mapping: steps 1–2 → `unit`; 3 → `ownership`; 4–5 → `exports`; 6 → `browserIsolation`; 7–8 → `tarballConsumer`; 9 → `postgres`; Auth boot + sign-up/in/cookie/session → `embeddedAuth`; full Next happy path → `nextE2E`.

## Publish

`scripts/publish.js` and `.github/workflows/athena-js-publish.yml` refuse unless:

1. the report exists
2. `passed === true`
3. `package` is `@xylex-group/athena`
4. `version` equals `package.json` `version`
5. `commit` equals `git rev-parse HEAD`
6. all eight `checks` keys exist and are `true`

A registry token is not sufficient.

## CI

`.github/workflows/athena-js.yml` runs `pnpm test:finality`. The publish workflow runs `pnpm release:verify` and re-checks the report. CI may set `ATHENA_TEST_DATABASE_URL` for speed; it must still be able to take the Docker/Podman path. Do not replace this command with a skip-friendly split.
