# ADR 0016: Drop-in edge bindings on `createClient` (`db.d1` / `storage.r2`)

**Date:** 2026-07-24  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Depends on:** [0001](0001-single-create-client-constructor.md), [0011](0011-graduate-storage-into-base-client.md), [0012](0012-stable-service-namespaces-and-options.md), [0014](0014-next-client-construction-facades.md), [0015](0015-execution-transport-and-cloudflare-edge.md)  
**Pinned versions:**
- `@xylex-group/athena` — current package line in this repo
- Node.js `>=18.0.0` — declared engine range

## Context

ADR 0015 introduced edge-local execution via an injectable `gatewayTransport` and a Cloudflare-oriented helper. Early integration surface used a **second constructor shape**:

```ts
createCloudflareClient({ d1: env.DB, r2: env.FILES })
```

That worked, but it broke the drop-in story for existing apps:

- Gateway apps already call `createClient({ db: { url }, storage: { url }, key })`.
- Switching to edge required a different import, different top-level keys (`d1` / `r2`), and a mental model of “another client”.
- ADR 0001 / 0014 require that **only** `createClient` materializes a client core; alternate public constructors may only be thin façades.

Edge D1/R2 must therefore be a **backend selection on the same config spine**, not a parallel product API.

## Decision

**Decision:** Cloudflare D1 and R2 are configured as **drop-in backends** on the normal service options of `createClient`. The same fluent DB and storage call sites work for gateway HTTP and edge bindings.

### Canonical shapes

**All construction goes through `createClient`.** Façades only map config.

```ts
// Gateway HTTP (unchanged)
createClient({
  url: env.ATHENA_URL,
  key: env.ATHENA_API_KEY,
  // or:
  db: { url: dbUrl },
  storage: { url: storageUrl },
})

// Edge-local (drop-in backends)
createClient({
  db: { d1: env.DB, sessionMode: 'first-unconstrained' },
  storage: { r2: env.FILES, prefix: 'app/' },
})

// Top-level Worker aliases (folded into db/storage)
createClient({ d1: env.DB, r2: env.FILES, storagePrefix: 'app/' })

// Hybrid: local data plane + remote root for other services
createClient({
  db: { d1: env.DB },
  url: env.ATHENA_URL,
  key: env.ATHENA_API_KEY,
})

// Switch when both binding and URL exist
createClient({
  d1: env.DB,
  url: env.ATHENA_URL,
  key: env.ATHENA_API_KEY,
  mode: 'auto',
  prefer: 'edge', // or 'gateway'
})
```

### Materialization rules

When `createClient` sees edge bindings it **normalizes config before** `resolveCore`:

| Input | Effect |
| --- | --- |
| `db.d1` present | Build D1 `gatewayTransport` (unless already injected); set `db.url` to the local sentinel if unset; default `key` to the edge sentinel when unset; set edge `capabilities` (ADR 0020) |
| `storage.r2` present | Attach L3a R2 storage module on `client.storage` (overrides HTTP storage for object I/O when both exist) |
| `url` + `db.d1` | Hybrid remote services (ADR 0018); billing must not inherit the D1 sentinel |

### Façades remain allowed

| Entrypoint | Role |
| --- | --- |
| `createCloudflareClient({ d1, r2, storagePrefix, ... })` | Thin map to `createClient({ db: { d1 }, storage: { r2, prefix }, ... })` |
| `createAthenaRuntime` / `createAthenaFromWorkerEnv` | Mode switching and Worker env mapping (ADR 0019) |

Façades must not reimplement fluent builders, transport cores, or capability bags.

## Contract

- `AthenaDbConfig` may include `d1?: D1DatabaseLike | null` and `sessionMode?: string | null`.
- `AthenaStorageConfig` may include `r2?: R2BucketLike | null` and `prefix?: string | null`.
- `db.d1` and `storage.r2` are structural binding types (no hard Workers types package).
- Presence of `db.d1` is sufficient to configure the DB service for `from` / `query` / mutations without a real HTTP `db.url`.
- Presence of `storage.r2` is sufficient to configure object storage without a storage HTTP URL.
- R2 and HTTP storage config fields that are not applicable (`r2`, `prefix`) must not be forwarded into the HTTP storage client options bag.
- When `storage.r2` is set, TypeScript may narrow via `AthenaClientConfigWithR2` / `AthenaClientWithR2Storage` overloads so `putObject` / `getObject` / `listObjects` / `deleteObject` are typed on `storage`.
- Explicit `gatewayTransport` still wins over auto-built D1 transport when both are provided (advanced tests / injection).
- Explicit `capabilities` still wins over auto-derived edge capabilities when provided.
- Root package `createClient` remains the supported drop-in path; `@xylex-group/athena/cloudflare` is optional convenience.

## Consequences

- Apps migrate gateway → edge by swapping backend fields, not rewriting query/storage call sites.
- ADR 0001’s single-materializer invariant holds; Cloudflare helpers are façades (ADR 0014 style).
- Browser bundles that import root `createClient` may include D1/R2 materialization code paths; call sites must not pass bindings in the browser. Gateway-only apps are unaffected at runtime when bindings are absent.
- Documentation leads with `createClient({ db: { d1 }, storage: { r2 } })`; `createCloudflareClient` is documented as a mapping helper.

## Validation

- `createClient({ db: { d1 } })` executes L0 `query` and L1 insert against mock D1.
- `createClient({ db: { d1 }, storage: { r2, prefix } })` round-trips R2 put/get with prefix.
- `createCloudflareClient({ d1, r2 })` remains equivalent (same capabilities + fluent behavior).
- Hybrid `createClient({ db: { d1 }, url, key })` keeps billing off the local sentinel (ADR 0018).
- Gateway-only `createClient({ url, key })` tests remain green with no binding fields.
