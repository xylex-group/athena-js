# ADR 0013: Promote stable experimental settings into createClient options

**Date:** 2026-07-15
**Status:** Accepted
**Author:** Floris
**Accepted by:** Floris
**Pinned versions:**
- `athena-monorepo-root@3.29.0` - current repository manifest.
- `@xylex-group/athena@2.16.0` - implementation baseline before the hard cut.
- `@xylex-group/athena@3.0.0` - current JS SDK package version.
- `athena-auth-ui@1.16.1` - current local dependent baseline.
- Node.js `>=18.0.0` - declared engine range.

## Context

The v2 `AthenaClientExperimentalOptions` bag mixes mature query behavior, storage capability enablement, storage transport configuration, a type-only column mode, and an obsolete error-normalization switch. Capability flags also change the inferred client identity.

## Decision

Stable query settings become normal `createClient` options, storage settings move under `storage`, and obsolete or type-only flags are removed. The v3 client has no general-purpose `experimental` bag.

## Contract

- `retryReads`, `traceQueries`, `debugAst`, and `findManyAst` are normal top-level `AthenaClientConfig` fields.
- `storage.directUpload` and storage runtime hooks belong to `storage`.
- `athenaStorageBackend`, `typecheckColumns`, `directStorageUpload`, and `enableErrorNormalization` are absent.
- Compile-time table and column checking derives from known models and explicit row types under ADR 0003.
- `retryReads` applies only to documented idempotent reads.
- Trace and debug outputs redact API keys, bearer/session tokens, cookies, database URIs, and storage credentials.
- New preview behavior must use a narrowly named, feature-owned boundary with an exit criterion rather than recreating a catch-all bag.
- Context views preserve stable option behavior without changing client identity.

## Consequences

- Stable behavior is discoverable on the main constructor and protected by normal semantic versioning.
- Storage configuration has one owner.
- The client type no longer contains a strictness or storage capability state machine.
- Consumers must remove the v2 experimental nesting during the v3 migration.

## Validation

- `test/type-compatibility-v3.ts` proves stable options are accepted directly and removed flags are rejected.
- `test/v3-client.test.ts` proves context views preserve one public client identity.
- Runtime tests cover read retry boundaries, trace/debug behavior, AST transport fallback, and stable storage availability.
- Emitted root/browser declarations expose no `AthenaClientExperimentalOptions`, `typecheckColumns`, or capability-specific client type.
- `pnpm typecheck`, `pnpm test`, `pnpm docs:methods`, and `pnpm build` pass before release.
