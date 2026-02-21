# changelog

all notable changes to athena-js will be documented here.

## [0.1.0] - 2025-12-01

### initial release

athena-js — Athena query builder client for the Athena HTTP gateway.

#### features
-[x] `createClient(url, apiKey)` — Fluent Athena query builder
-[x] `athena.from(table).select()`, `.insert()`, `.update()`, `.delete()`
-[x] `.eq()`, `.match()`, `.limit()`, `.offset()`, `.single()`, `.maybeSingle()`
-[x] `useAthenaGateway` React hook — loading state, error handling, request/response logs
-[x] gateway types for typed fetch/insert/update/delete payloads
