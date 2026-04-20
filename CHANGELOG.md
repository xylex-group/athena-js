# changelog

all notable changes to athena-js will be documented here.

## [Unreleased] - 2026-04-20

### added
- `eqUuid(column, value)` and `eqCast(column, value, cast)` on the shared fluent filter chain.
- Optional cast hints on `AthenaGatewayCondition` (`value_cast`, `column_cast`, plus legacy `eq_*_cast` companions).

### changed
- UUID-like `.eq()` filters on identifier columns (`id`, `*_id`, `*uuid*`) now use a typed-safe select fallback path, avoiding Postgres `uuid = text` comparison failures without requiring app-side raw SQL casts.

## [0.1.0] - 2025-12-01

### initial release

athena-js — Athena query builder client for the Athena HTTP gateway.

#### features
-[x] `createClient(url, apiKey)` — Fluent Athena query builder
-[x] `athena.from(table).select()`, `.insert()`, `.update()`, `.delete()`
-[x] `.eq()`, `.match()`, `.limit()`, `.offset()`, `.single()`, `.maybeSingle()`
-[x] `useAthenaGateway` React hook — loading state, error handling, request/response logs
-[x] gateway types for typed fetch/insert/update/delete payloads
