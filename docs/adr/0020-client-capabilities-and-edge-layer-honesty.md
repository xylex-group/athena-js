# ADR 0020: Client capabilities and edge layer honesty

**Date:** 2026-07-24  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Depends on:** [0002](0002-single-athena-client-type-and-stable-namespaces.md), [0015](0015-execution-transport-and-cloudflare-edge.md), [0016](0016-drop-in-edge-bindings-on-create-client.md), [0018](0018-hybrid-edge-remote-service-routing.md)  
**Extended by:** [0025](0025-athena-database-transactions.md)  
**Pinned versions:**
- `@xylex-group/athena` — current package line in this repo
- Node.js `>=18.0.0` — declared engine range

## Context

Gateway mode exposes a wide surface: nested relations, RPC, findMany AST, storage catalogs, backups. Edge-local D1/R2 deliberately ships a **subset**. If the SDK pretends full parity, apps fail at runtime with opaque SQL errors. If the SDK fails closed without discovery, apps cannot branch cleanly.

Consumers need a **stable, queryable capability bag** on every client:

```ts
if (client.capabilities.db.layers.rpc) { … }
if (client.capabilities.storage.objects) { … }
```

## Decision

**Decision:** Every `AthenaClient` exposes non-optional `readonly capabilities: AthenaClientCapabilities`. Edge mode reports only what is actually supported. Hybrid mode reports local vs remote storage accurately (ADR 0018).

### Shape

```ts
type AthenaClientCapabilities = {
  mode: 'gateway' | 'cloudflare-edge'
  db: {
    engine: 'postgresql' | 'cloudflare-d1' | string
    local: boolean
    layers: {
      query: boolean      // L0 raw SQL
      flatCrud: boolean   // L1 from().select/insert/update/delete
      findManyAst: boolean
      rpc: boolean
      relations: boolean
    }
  }
  storage: {
    local: boolean       // true only when R2 binding backs objects
    objects: boolean     // local R2 and/or remote HTTP storage available
    catalogs: boolean
    backups: boolean
  }
  auth: {
    remote: boolean
  }
}
```

### Default matrices

| Field | Gateway | Edge (D1 only) | Edge + R2 | Hybrid D1 + remote `url` (no R2) |
| --- | --- | --- | --- | --- |
| `mode` | `gateway` | `cloudflare-edge` | `cloudflare-edge` | `cloudflare-edge` |
| `db.engine` | `postgresql` (default) | `cloudflare-d1` | `cloudflare-d1` | `cloudflare-d1` |
| `db.local` | `false` | `true` | `true` | `true` |
| `db.layers.query` | `true` | `true` | `true` | `true` |
| `db.layers.flatCrud` | `true` | `true` | `true` | `true` |
| `db.layers.findManyAst` | `true` | `false` (until enabled) | `false` | `false` |
| `db.layers.rpc` | `true` | `false` | `false` | `false` |
| `db.layers.relations` | `true` | `false` | `false` | `false` |
| `storage.local` | `false` | `false` | `true` | `false` |
| `storage.objects` | `true` | `false` | `true` | `true` (remote) |
| `storage.catalogs` | `true` (typical) | `false` | `false` | `false` on edge bag* |
| `storage.backups` | `true` (typical) | `false` | `false` | `false` on edge bag* |
| `auth.remote` | per config | `false` unless auth/url | per config | `true` when url/auth set |

\*Edge capability bag keeps catalogs/backups `false` even in hybrid until edge mode explicitly wires those remote modules into the bag; hybrid apps that need catalog APIs should feature-detect carefully or use gateway mode for storage admin. Object I/O via remote HTTP when `objects` is true remains allowed through the configured storage module when no R2 is present.

### Layer naming (L0–L3)

| Layer | Meaning |
| --- | --- |
| L0 | Raw `query()` SQL |
| L1 | Flat CRUD via gateway payloads compiled for D1 |
| L2 | Reserved (e.g. findMany AST / richer planning) when enabled |
| L3a | Local R2 object helpers (`putObject` / `getObject` / `listObjects` / `deleteObject`) |
| L3b+ | Catalogs, backups, multipart, signed URLs — gateway/storage HTTP, not edge R2 subset |

### Honesty rules

1. **Do not set a layer flag true** until the transport implements it.
2. **Unsupported ops fail deterministically** with clear errors (e.g. RPC on D1 transport).
3. **`storage.objects`** is true when the app can perform object operations through **either** R2 **or** remote storage configuration.
4. **`storage.local`** is true only for in-process R2.
5. Explicit `capabilities` in config overrides auto-derivation (tests / advanced).

### Context views

`withContext` preserves the same `capabilities` object (or equivalent) as the core client; context views must not reset mode to gateway.

## Contract

- `createGatewayCapabilities` and `createCloudflareEdgeCapabilities` are the sole builders used by construction (unless caller injects a full bag).
- Edge materialization sets edge capabilities when `db.d1` is present and caller did not pass `capabilities`.
- Gateway + only `storage.r2` may advertise local objects while keeping `mode: 'gateway'` and remote DB layers.
- Public docs and examples teach feature detection via `capabilities`, not string matching on errors.

## Consequences

- UI and server code can hide relation/RPC paths on edge without try/catch.
- Expanding edge support is an explicit capability flip + compiler/transport work, not a silent behavior change.
- Hybrid storage detection stays aligned with ADR 0018.

## Validation

- Capability assertions in client, transport, and runtime tests for pure edge, R2, hybrid, and gateway.
- RPC on edge returns a clear unsupported error while `capabilities.db.layers.rpc === false`.
- `withContext` preserves `capabilities.mode`.
- Hybrid without R2: `objects === true`, `local === false`.
