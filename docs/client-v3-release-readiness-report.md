# Athena JS 3.0 release-readiness report

**Date:** 2026-07-15

**Status:** **SDK implementation and package gates pass. Registry publication is blocked by missing npm authentication; the newly packed shared-core artifact must still replace the prior local tarball in each controlled consumer before publish.**

## Version pins

- implementation baseline `@xylex-group/athena@2.16.0` (pre-consolidation inspection)
- current JS SDK package `@xylex-group/athena@3.0.0`
- athena-rs / monorepo OpenAPI independently versioned at 4.x
- coordinated targets `@xylex-group/athena-auth-ui@2.0.0` and `@xylex-group/better-auth-athena@2.0.0`
- Node.js `>=18.0.0`

## ADR evidence

| ADR | Implementation evidence | Validation evidence |
| --- | --- | --- |
| 0001 | Root and browser barrels export object-form `createClient(config)` as the only **primitive** materializer | root/browser runtime tests, emitted declaration audit |
| 0002 | `AthenaClient<TModels>` always exposes `db`, `auth`, `chat`, and `storage` | namespace contract test, ESM/CJS/browser package smokes |
| 0003 | Model-aware clients derive table and column types without strictness generics | positive/negative compile fixture, forbidden-symbol audit |
| 0004 | Root `createClient({ models })` owns registry navigation and accepts model targets | typed-schema runtime and compile fixtures |
| 0005 | The synchronous factory is runtime-neutral; DB, auth, chat, storage, and raw HTTP context providers resolve once per operation | cross-namespace provider sequencing and precedence tests |
| 0006 | Context views share one immutable gateway transport, result formatter, tracer, routing config, and model registry | direct shared-transport identity and concurrent context-isolation tests |
| 0007 | Next subpaths expose context/session helpers; may compose thin façades without caching | Next adapter tests and declaration audit |
| 0008 | Structured service configuration and multi-code `AthenaConfigurationError` | missing-service, missing-key, and configuration precedence tests |
| 0009 | Packages are pinned to the hard-cut major versions with no v2 runtime aliases | package manifests, source/declaration forbidden-symbol audit |
| 0010 | Root/default/browser/Next/React declarations are generated in one build | `pnpm build`, method-catalog generation, package import smokes |
| 0011 | Storage is stable on every client without an enablement flag | storage direct-upload and route-parity suites |
| 0012 | `db`, `auth`, `chat`, and `storage` objects exclusively own service routing | config compile fixture and service-route tests |
| 0013 | `retryReads`, `traceQueries`, `debugAst`, and `findManyAst` are stable top-level options | query retry/trace/debug/find-many suites |
| 0014 | `createAthenaBrowserClient` / `createAthenaServerClient` delegate to `createClient` only | Next adapter tests, type-compatibility fixtures, next fixture typecheck |

## Removed client surface

The implementation and emitted declarations contain none of the following:

- positional `createClient(url, key, options)`
- runtime `AthenaClient` class, builder, or `fromEnvironment`
- `createTypedClient`, `TypedAthenaClient`, or strictness generics
- public auth-client constructors or auth-specific client identities
- `AthenaSdkClient*` and storage/capability-specific client return types
- `withOptions`, `withSession`, `typecheckColumns`, `athenaStorageBackend`, or `athenaKey`

Applications should still funnel construction through `createClient(...)` (directly or via Next façades). Server and scoped flows derive context views with `withContext(...)` or `createAthenaServerClient`; scope headers, cookies, bearer/session tokens, and no-cache state remain request-scoped. A context view no longer reconstructs gateway, auth, chat, or storage clients. The configured provider is resolved at operation dispatch and the immutable transport core is shared by every view.

## SDK validation executed

- `pnpm check:all`: passed.
  - lint: 0 errors; 33 existing explicit-`any`/unused warnings.
  - typecheck: passed, including removed-option and model-derived negative fixtures.
  - tests: 527 total; 521 passed, 6 intentional E2E skips, 0 failed.
  - build: ESM, CommonJS, browser, root, Next, React, admin, organization, cookies, utilities, social-provider, and CLI artifacts passed.
- `pnpm docs:methods`: generated 546 documented method paths in the SDK and mirrored docs application.
- Standalone SDK server/demo harness: project typecheck passed; React example fixture typecheck passed against the v3 declarations.
- `npm pack --dry-run`: passed for `@xylex-group/athena@3.0.0`; the current shared-core tarball has SHA-1 `29ebc1c04ba74d31d83cd5b8d165ba0bf89dec7e`.
- Clean install smokes of that tarball passed for root ESM, root CommonJS, explicit browser subpath, and root browser condition.
- Source and emitted declaration audit passed for all removed client/type/config symbols.

## Controlled-consumer validation

- Better Auth Athena 2.0: typecheck passed; 8 tests passed and 12 integration tests were intentionally skipped; ESM/CJS/declaration build passed. Update and update-many now use only the SDK query builder, and the gateway contract test rejects top-level `set` and `data` aliases in favor of canonical `update_body`.
- Auth UI 2.0, validated against the packed SDK: HeroUI typecheck and 54 tests passed; native typecheck and 18 tests passed; build, Bun pack, `publint`, ATTW, clean TypeScript smoke, and Vite browser smoke passed.
- Speedrun: TypeScript passed; focused one-client construction tests remain green; the six focused Athena/file-route suites pass 32/32 after stale service-mock and removed workflow-evidence assertions were reconciled; focused Ultracite passed. Its lockfile still points to the prior local validation artifact until the current shared-core tarball is installed.

## Registry and publication state

Registry checks on 2026-07-15 returned `E404` for:

- `@xylex-group/athena@3.0.0`
- `@xylex-group/better-auth-athena@2.0.0`
- `@xylex-group/athena-auth-ui@2.0.0`

Because the registry session is unauthenticated, those `E404` responses are not sufficient proof that private scoped versions are available. `npm whoami` returned `E401 Unauthorized`, so no publication was attempted.

Remaining release gates, in order:

1. Install the current shared-core Athena tarball into Better Auth Athena, Auth UI, and Speedrun and rerun their recorded gates.
2. Repack Better Auth Athena and Auth UI from those results and validate their clean installs.
3. Restore npm authentication, rerun the version-existence preflight, and abort if any target version exists.
4. Publish in dependency order, verify registry metadata/files and clean imports, then replace Speedrun's local tarballs with exact registry versions and rerun its gates.
