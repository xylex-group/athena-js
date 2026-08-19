# ADR 0010: Govern client modules, exports, declarations, and docs as one contract

**Date:** 2026-07-15
**Status:** Accepted
**Author:** Floris
**Accepted by:** Floris
**Pinned versions:**
- `athena-monorepo-root@3.29.0` - current repository manifest.
- `@xylex-group/athena@2.16.0` - current SDK baseline.
- `@xylex-group/athena@3.0.0` - current JS SDK package version.
- `athena-auth-ui@1.16.1` - current local dependent baseline.
- Node.js `>=18.0.0` - declared engine range.

## Context

At the `2.16.0` baseline, `src/client.ts` contained 3,575 lines spanning public types, configuration, environment resolution, service routing, query builders, request execution, namespace assembly, context cloning, conditional typing, and constructors. The accepted 3.0 implementation has since removed constructor/config/context ownership and extracted result normalization, SQL/debug compilation, and raw request dispatch into focused modules; fluent builder orchestration remains the largest transitional concern. Public symbols are mirrored across root/browser barrels, Next subpaths, tests, README pages, hand-written references, and generated method documentation.

A client refactor can appear complete in source while stale declarations or generated docs continue publishing removed contracts.

## Decision

**Proposition:** Client responsibilities will be split into explicit ownership modules, and source, export maps, declarations, tests, examples, and generated documentation will be validated as one release contract.

## Contract

- `create-client.ts` owns the sole materialization function and inference boundary.
- `public-types.ts` owns the consolidated public client/config/context contracts.
- `config.ts`, `environment.ts`, and `service-urls.ts` own deterministic normalization.
- `context.ts` owns credential/context resolution and precedence.
- `core.ts` owns stable transports, models, policies, and namespace factories.
- `view.ts` owns lightweight context views.
- Domain behavior remains in DB, auth, chat, storage, query, and generator modules.
- No replacement client file may grow into a second monolith; overlapping logic must be extracted at its ownership boundary.
- `package.json` exports are authoritative for consumer imports.
- `src/index.ts` and `src/browser.ts` expose equivalent client contracts while preserving runtime safety.
- Method-reference generation must remove deleted APIs at the source generator level, not by hand-editing generated markdown.
- Documentation and declaration drift is a release blocker.

## Consequences

- The migration touches many files but gives future changes clear seams.
- Internal import cycles must be actively prevented.
- Generated artifacts become explicit validation outputs.
- Package review can focus separately on config, context, core, and public typing.
- Build-entry and browser-safety checks remain necessary even when runtime tests pass.

## Validation

- Enforce source ownership with focused import-boundary checks or an architecture test.
- `src/client.ts` must continue shrinking toward fluent builder orchestration only; result/error handling, SQL/debug compilation, raw request dispatch, public configuration, and immutable core/view ownership belong in their focused modules.
- Run focused client, query, auth, chat, storage, Next, React, generator, and browser tests.
- Run `pnpm docs:methods` and require a clean second run.
- Run `pnpm typecheck`, `pnpm build`, and `pnpm check:all`.
- Publish requires `pnpm test:finality` / `release:verify` (monorepo ADR 0019), not `check:all` alone.
- Inspect `dist/index.d.ts`, `dist/browser.d.ts`, `dist/next/client.d.ts`, and `dist/next/server.d.ts` for forbidden symbols.
- Run `git diff --check` and verify only intentional generated artifacts changed.
