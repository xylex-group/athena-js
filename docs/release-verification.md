# Athena JS release verification

Local verification is the release source of truth for `@xylex-group/athena`. GitHub CI mirrors the same command. CI is not the system.

ADR: [docs/adr/technical/0019-athena-js-local-verification-ssot.md](../../../docs/adr/technical/0019-athena-js-local-verification-ssot.md). Spec: [docs/sdd/xylex/athena-js-local-finality-gate/SPEC.md](../../../docs/sdd/xylex/athena-js-local-finality-gate/SPEC.md).

## Commands

```bash
pnpm --dir packages/athena-js finality
pnpm --dir packages/athena-js test:finality
pnpm --dir packages/athena-js release:verify
```

| Script | Role |
| --- | --- |
| `finality` / `test:finality` | Same orchestrator. Ordered fail-closed proof of the tracked 21-cell hard matrix (`scripts/finality-matrix.mjs`) |
| `test:billing-release` | Explicit Billing financial-finality gate for enroll, change, cancel, and checkout |
| `test:auth-schema-release` | Explicit Auth schema gate for fresh install, physical N-1 upgrade, drift, divergence, and remediation |
| `release:verify` | Auth schema lock, then `test:finality && test:tarball && test:examples` (identical hard gates; tarball also runs inside finality) |
| `prepublishOnly` | `pnpm release:verify` (not weaker) |
| `check:all` / `check:release` | Iteration / static package checks only — **not** releasable |

Red cannot release. Green is releasable.

`test:billing-release` and `test:auth-schema-release` fail closed unless their
disposable PostgreSQL finality URL is present. Use `test:finality` for the
orchestrated path that provisions PostgreSQL and supplies those URLs; a
skip-if-no-URL result is not release evidence.

The Billing operation/dimension matrix enumerates required release cells. Its
evidence comes from executing the concrete suites listed by the release gate;
cell coverage is not inferred from a filename existing.

## Tracked matrix

Hard cells run from `pnpm finality`. Adjacent cells are documented and must not block npm publish.

| # | Cell | Lane |
| --- | --- | --- |
| 1 | Auth route parity | unit (`auth-route-inventory`) |
| 2 | Social OAuth packed Athena JS canary | packed golden + OAuth fixture |
| 3 | OAuth security vectors | unit + shared `contracts/auth/oauth-deny-vectors.json` |
| 4 | WebAuthn packed canary | packed `/ok` + registration options |
| 5 | JWT/JWKS durable Postgres TokenKeyStore | unit interop + child-process Postgres proof |
| 6 | Authorization golden path | packed next-minimal + production-proof scan |
| 7 | Postgres ownership architecture scan | unit |
| 8 | Postgres manager runtime tests | unit |
| 9 | Auth client public shape | unit + frozen fixture |
| 10 | Auth UI export tests | sibling vitest |
| 11 | Browser graph audit | `test:browser-bundle` |
| 12 | React Native graph audit | `audit:rn` |
| 13 | Tarball structure | `test:tarball` |
| 14 | Clean package install | packed fixture install |
| 15 | Next build | packed `embedded-next` |
| 16 | Fresh DB migration | packed golden migrate |
| 17 | Migration idempotency | unit |
| 18 | Docs/contract drift | `docs:check` |
| 19 | Packed athena-js + athena-auth-ui consumer | packed dual tarball |
| 21 | Packed Transport 1.2 topology | packed HTTP auth.url / proxy / credentials |
| 23 | Billing financial and Auth schema release gates | explicit release-gate scripts |

Adjacent: Chromium virtual authenticator (`packages/athena-auth-ui/e2e/tests/passkey-browser-finality.e2e.ts`). Physical Windows Hello / Touch ID: [`docs/auth/passkey-platform-matrix.md`](auth/passkey-platform-matrix.md).

## `test:finality` order

Implemented by [`scripts/run-finality.mjs`](../scripts/run-finality.mjs) against [`scripts/finality-matrix.mjs`](../scripts/finality-matrix.mjs):

1. typecheck
2. unit / regression (`pnpm test`)
3. ownership (`test/finality/ownership.test.ts`)
4. package build
5. package exports (`test/finality/exports.test.ts` + `check:exports`)
6. browser contamination (`test/finality/browser-boundary.test.ts` + `test:browser-bundle`)
7. `create-athena-app` fixture check (`test/fixtures/next-embedded`)
8. `pnpm pack` Athena JS + Auth UI tarballs; install both into `next-minimal-golden`
9. ephemeral PostgreSQL (`test/fixtures/postgres-runtime`)
10. Billing financial-finality and Auth schema release gates
11. Next embedded E2E (`test/finality/embedded-next.test.ts`) against **node_modules** from the tarball
12. packed next-minimal golden-path + Social + passkey + Auth UI pack + Transport 1.2 + Postgres JWT child-process
13. cleanup + leak / process checks

First failure stops the run and writes a failed report.

## PostgreSQL

Resolution (never skip):

1. `ATHENA_TEST_DATABASE_URL` if it is a `postgres(ql)://` URI
2. else `DATABASE_URL` if it is a `postgres(ql)://` URI
3. else auto-launch ephemeral Postgres (`docker` or `podman`), allocate a fresh database, destroy on cleanup

Missing URL **and** missing Docker/Podman is a hard fail. Neon / Railway / GitHub `services:` are not the gate. Optional `test:integration:postgres` skip-if-no-URL files remain for iteration only.

## Packed artifact

E2E imports `@xylex-group/athena`, `@xylex-group/athena/server`, `@xylex-group/athena/next/client`, and `@xylex-group/athena/next/server` from the installed tarball. `file:../../src` and source aliases are illegal.

Packed Social OAuth uses `test/fixtures/oauth-provider` and `test/finality/next-minimal-golden-social.test.ts`. Do not require live Google or GitHub.

Packed passkey canary (`next-minimal-golden-passkey.test.ts`) proves `APP_URL` + `auth.passkey.onboarding` → RP + first-paint `/ok` capabilities + registration options. Chromium virtual-authenticator registration/authentication is `packages/athena-auth-ui/e2e/tests/passkey-browser-finality.e2e.ts`. Physical Windows Hello / Touch ID is documented in [`docs/auth/passkey-platform-matrix.md`](auth/passkey-platform-matrix.md) and is **not** a `release:verify` gate.

JWT issuer finality (`athena-token-authority-finality` + `athena-token-authority-interop`) runs in unit/regression: issue → OIDC → JWKS → verify, process restart, rotation.

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
    "nextE2E": true,
    "nextMinimalGolden": true
  }
}
```

`passed` is true iff every `checks` key is true. Failure still writes the file (overwrites a previous green report).

Mapping: steps 1–2 → `unit`; 3 → `ownership`; 4–5 → `exports`; 6 → `browserIsolation`; 7–8 → `tarballConsumer`; 9 → `postgres`; Auth boot + sign-up/in/cookie/session → `embeddedAuth`; full Next happy path → `nextE2E`; empty-DB Auth-first migrate + snapshot capabilities → `nextMinimalGolden`.

## Publish

`scripts/publish.js` and `.github/workflows/athena-js-publish.yml` refuse unless:

1. the report exists
2. `passed === true`
3. `package` is `@xylex-group/athena`
4. `version` equals `package.json` `version`
5. `commit` equals `git rev-parse HEAD`
6. all eight `checks` keys exist and are `true`

A registry token is not sufficient.

## Auth schema generation lock

Embedded Auth schema generation is runtime compatibility. `release:verify` runs `scripts/verify-auth-schema-release.mjs` first; it also runs `scripts/verify-auth-migration-history.mjs` before reading or writing the schema lock. The lock at `src/auth/schema-release.lock.json` records `packageVersion`, `ATHENA_AUTH_SCHEMA_GENERATION`, and a SHA-256 of the canonical Auth migration files. Changing generation or those files without bumping `@xylex-group/athena` and rewriting the lock fails the gate.

The per-migration manifest is append-only across releases. Verification compares it with the pull request base branch or the preceding Athena JS release tag. Existing migration versions cannot be changed, removed, or renumbered; new versions must be appended. The only historical correction is migration 033's exact 5.7.0 checksum restoration for package version 5.7.1, tracked as issue #1108. `test:finality` and the publish preflight run the same guard through `verify-auth-schema-release.mjs --write` before running release checks. Direct lock verification remains fail-closed; use that command when updating the lock outside the release workflow.

## CI

`.github/workflows/athena-js.yml` runs `pnpm test:finality`. The publish workflow runs `pnpm release:verify` and re-checks the report. CI may set `ATHENA_TEST_DATABASE_URL` for speed; it must still be able to take the Docker/Podman path. Do not replace this command with a skip-friendly split.
