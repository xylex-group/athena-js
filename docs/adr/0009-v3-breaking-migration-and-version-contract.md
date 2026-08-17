# ADR 0009: Ship client consolidation as a bounded v3 breaking migration

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

The proposed architecture removes runtime exports, positional overloads, capability types, strictness types, typed-client constructors, and framework constructors. Preserving all old declarations indefinitely would reintroduce the exact complexity v3 is meant to eliminate.

Controlled consumers include local Athena packages and external applications such as formations. `athena-auth-ui@1.16.1` currently references legacy Athena client types directly.

## Decision

**Decision:** The consolidated contract ships as a coordinated hard cut at `@xylex-group/athena@3.0.0`, without a final 2.x bridge, beta release, or permanent legacy client aliases.

## Contract

- The final v3 public declarations contain only the consolidated constructor/client contracts from ADRs 0001-0008.
- No transition release, prerelease channel, or compatibility alias is published.
- `@xylex-group/athena@3.0.0` is not published until identified first-party consumers compile against its local package tarball.
- `@xylex-group/athena-auth-ui@2.0.0` and `@xylex-group/better-auth-athena@2.0.0` are coordinated consumers with `@xylex-group/athena@^3.0.0` peer contracts.
- Migration documentation includes builder, environment, storage, typed registry, strict columns, Next server, and Next browser replacements.
- Release notes enumerate every removed runtime symbol and type.
- No automatic codemod may rewrite secrets into browser-visible configuration.
- The current baseline pins are evidence inputs, not claims that v3 is already released.

## Consequences

- Consumers face one deliberate breaking migration instead of prolonged incremental ambiguity.
- Coordinated first-party releases are required.
- Local tarball validation absorbs declaration and bundler risk before the irreversible registry publish.
- Major-version release discipline prevents compatibility shims from becoming permanent.
- Downstream applications may need separate browser-safe and server-secret config even though the constructor name is unified.

## Validation

- Build a machine-readable removed-symbol inventory and compare it to release notes.
- Compile `athena-auth-ui` and at least one browser/server application against the v3 package tarball.
- Run `npm pack` or the repository publish dry-run and inspect included declarations/exports.
- Verify package version is exactly `3.0.0` only in the release commit; ADR creation does not change it.
- Verify no legacy client aliases remain in emitted v3 declarations.
- Run package `check:all`, consumer typechecks, browser builds, server builds, and release validation before publish.
