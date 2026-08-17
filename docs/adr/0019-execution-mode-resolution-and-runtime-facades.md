# ADR 0019: Execution mode resolution and runtime façades

**Date:** 2026-07-24  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Depends on:** [0001](0001-single-create-client-constructor.md), [0014](0014-next-client-construction-facades.md), [0015](0015-execution-transport-and-cloudflare-edge.md), [0016](0016-drop-in-edge-bindings-on-create-client.md), [0018](0018-hybrid-edge-remote-service-routing.md)  
**Pinned versions:**
- `@xylex-group/athena` — current package line in this repo
- Node.js `>=18.0.0` — declared engine range

## Context

Some deployments fix edge-only or gateway-only at build time. Others (Workers, OpenNext on Cloudflare, local vs prod) must **choose** D1 bindings vs remote Athena from env at runtime:

- Dev: remote gateway only
- Staging Worker: D1 binding present + optional remote URL for auth
- Ops toggle: force gateway even when D1 exists (migrations, incident)

Without a single resolution contract, each app invents `if (env.DB) … else …` and drifts from SDK behavior.

## Decision

**Decision:** Provide **optional runtime façades** that resolve an execution mode and then call `createClient` / binding materialization. Mode resolution is pure and testable; façades never own a second transport implementation.

### Modes

| Mode | Meaning |
| --- | --- |
| `edge` | Require D1; use edge-local DB (and optional R2). |
| `gateway` | HTTP to Athena (`url` / key / env). Aliases: `server`, `remote`, `http`. |
| `auto` | Infer from available backends (default when mode omitted). |

Aliases for edge: `cloudflare`, `cloudflare-edge`, `d1`, `local`.

### Auto resolution

1. Read explicit `mode`, else env `ATHENA_EXECUTION_MODE`, else `auto`.
2. Detect D1 binding presence and gateway URL presence (`url` / `db.url` / env URL keys as implemented).
3. If only D1 → `edge`.
4. If only URL → `gateway`.
5. If neither → configuration error.
6. If **both** → use `prefer` (`edge` \| `gateway`), default **`edge`**, overridable by config or env `ATHENA_EXECUTION_PREFER`.

### Public façades (`@xylex-group/athena/cloudflare`)

| API | Returns | Notes |
| --- | --- | --- |
| `resolveAthenaExecutionMode(input)` | `'edge' \| 'gateway'` | Pure; no client construction. |
| `createAthenaRuntime(config)` | `{ mode, client, capabilities }` | Builds client for resolved mode. |
| `createAthenaRuntimeClient(config)` | `client` only | Convenience. |
| `createAthenaFromWorkerEnv(env, options?)` | `{ mode, client, capabilities }` | Maps standard Worker keys. |
| `createCloudflareClient(config)` | client | Always edge; requires `d1`; maps to `createClient` (ADR 0016). |

### Standard Worker env keys

| Key | Use |
| --- | --- |
| `DB` | D1 binding (overridable name via options) |
| `FILES` | R2 binding (overridable) |
| `ATHENA_URL` | Remote / gateway root |
| `ATHENA_API_KEY` | API key |
| `ATHENA_AUTH_URL` | Optional auth override |
| `ATHENA_CLIENT` | Client name header |
| `ATHENA_EXECUTION_MODE` | `auto` \| `edge` \| `gateway` |
| `ATHENA_EXECUTION_PREFER` | When both backends: `edge` \| `gateway` |

## Contract

- Façades **must** delegate construction to `createClient` (or `createCloudflareClient` which itself delegates to `createClient`).
- Façades **must not** cache request-bound clients (ADR 0014).
- Edge branch requires a real D1 binding; missing D1 with `mode: 'edge'` throws `AthenaConfigurationError`.
- Gateway branch fills `url` / `key` / `client` from env when omitted, consistent with gateway construction elsewhere.
- Resolved mode is never `auto` after resolution.
- Application code owns singleton lifetime of the returned client.

## Consequences

- One documented switch for Workers that support both topologies.
- Prefer-edge default matches “use the binding when present” local-first Worker deployments; ops can force gateway without removing bindings.
- Root `createClient({ db: { d1 } })` remains the drop-in path when mode switching is unnecessary (ADR 0016).

## Validation

- Unit tests for every auto/prefer/env combination and failure path.
- `createAthenaFromWorkerEnv` maps `DB` / `FILES` / URL / key and honors prefer-gateway.
- `createAthenaRuntime({ mode: 'gateway', d1, url })` uses gateway capabilities even when D1 is present.
- No second gateway client implementation in runtime façade source.
