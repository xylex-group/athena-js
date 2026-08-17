# ADR 0008: Standardize configuration precedence, routing, and service errors

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

The SDK accepts unified URLs, service objects, legacy top-level aliases, environment aliases, builder state, and framework adapter options. Configuration normalization is capable but distributed. Stable service namespaces require a consistent result when an endpoint cannot be resolved.

Environment construction currently reads global `process.env` through a static constructor. Browser and server consumers need explicit control over which environment object is visible.

## Decision

**Proposition:** `AthenaClientConfig` will define one deterministic routing and environment precedence contract, and unavailable service calls will fail through structured `AthenaConfigurationError` semantics.

## Contract

- Direct service object fields take precedence over unified-root derivation.
- Direct root/key/client fields take precedence over supplied `env` aliases.
- `config.env` is explicit; global environment reads are not implicit unless separately documented for a specific bundle.
- Unified root routing derives canonical DB, auth, chat, chat WebSocket, and storage paths.
- Flat service URL aliases and the duplicate `gateway` configuration object are absent from v3.
- Missing API key fails during `createClient` validation.
- Construction fails when no service is routable.
- A stable namespace whose service URL is unavailable fails on invocation with code `ATHENA_SERVICE_NOT_CONFIGURED` and the exact service name.
- Configuration errors are distinct from HTTP, auth, gateway, chat, and storage transport errors.
- Error messages contain no API key, bearer token, cookie, session token, PostgreSQL URI, or other credential.
- Header precedence follows ADR 0005.

## Consequences

- Environment behavior becomes deterministic and testable.
- Consumers must pass `env: process.env` when using alias resolution.
- Stable namespaces can exist without pretending every endpoint is configured.
- Legacy service aliases can be removed cleanly in a later major if retained for v3 migration.
- Centralized normalization becomes a prerequisite for source modularization.

## Validation

- Table-driven tests must cover every direct field, service object, alias, env alias, and precedence collision.
- Tests must assert exact service error code and service name for DB/auth/chat/storage.
- Secret-redaction tests must inspect thrown messages and serialized error details.
- Unified-root and direct-service routing tests must preserve current endpoint paths.
- Browser tests must use an explicit public env object.
- `pnpm typecheck`, construction/routing tests, and `pnpm build` must pass.
