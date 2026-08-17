# ADR 0018: Hybrid edge + remote service routing

**Date:** 2026-07-24  
**Status:** Accepted  
**Author:** Floris  
**Accepted by:** Floris  
**Depends on:** [0008](0008-configuration-routing-and-service-errors.md), [0012](0012-stable-service-namespaces-and-options.md), [0015](0015-execution-transport-and-cloudflare-edge.md), [0016](0016-drop-in-edge-bindings-on-create-client.md)  
**Pinned versions:**
- `@xylex-group/athena` — current package line in this repo
- Node.js `>=18.0.0` — declared engine range

## Context

Edge-local Workers often need:

- **Local** DB (D1) and optional **local** objects (R2)
- **Remote** Athena services for auth, billing, and sometimes HTTP storage catalogs

`createClient` resolves service URLs in `resolveCore`. Billing historically preferred **`dbUrl` over unified `root`**, because on a normal gateway deployment billing shares the main Athena HTTP host with the DB/gateway surface.

When edge mode sets:

```ts
db: { url: 'https://athena.local/cloudflare-edge' } // sentinel, not a real host
url: 'https://athena.example.com'                   // real remote root
```

billing resolution became:

```text
billing = config.billing?.url ?? dbUrl ?? root
        → https://athena.local/cloudflare-edge   // wrong
```

Hybrid docs promised remote billing; feature-detection and runtime disagreed. The same class of bug affects any service that incorrectly inherits the D1 sentinel.

Separately, capability bags that derived `storage.objects` **only** from an R2 binding reported `false` when hybrid remote storage was available via `url` without R2, causing apps that trust `capabilities` to disable storage incorrectly.

## Decision

**Decision:** Hybrid configuration treats the **unified/remote `url`** (and explicit per-service overrides) as the source of truth for **non-local** services. The D1 sentinel is **only** a local DB routing token and must never be used as a real HTTP base for billing, auth, chat, or remote storage.

### Routing rules (edge / hybrid)

| Service | When `db.d1` is set |
| --- | --- |
| **DB** | Always local via D1 transport. `db.url` may be the sentinel for “service configured” bookkeeping only. |
| **Billing** | Prefer `billing.url`, else **remote root `url`**, never the D1 sentinel as an HTTP target. When materializing edge bindings with a remote `url`, set `billing.url` to that root unless the caller already overrode billing. |
| **Auth** | Prefer `auth.url`, else derived from remote root / env (unchanged ADR 0008). `auth.remote` capability follows presence of remote auth/root. |
| **Storage** | Prefer `storage.r2` (local L3a). Else prefer `storage.url` / root-derived `/storage` HTTP when remote root exists. |
| **Chat** | Unchanged root/env derivation; typically remote when root is set. |

### Sentinel constants

- `CLOUDFLARE_EDGE_BASE_URL = 'https://athena.local/cloudflare-edge'`
- `CLOUDFLARE_EDGE_API_KEY = 'cloudflare-edge-local'` (only when no key is provided for pure local edge)

These values must not appear in outbound hybrid HTTP calls for billing (or other remote services).

### Capabilities alignment

When hybrid remote root is present:

- `auth.remote === true` if auth URL or remote root is configured.
- `storage.objects === true` if **either** R2 is bound **or** a remote root enables HTTP storage routing.
- `storage.local === true` **only** when R2 is bound.

Full capability matrix: ADR 0020.

## Contract

- `materializeEdgeBindings` (or equivalent) runs before `resolveCore` and injects hybrid billing URL when `db.d1` + remote `url` are both set and `billing.url` is unset.
- Explicit `billing: { url }` always wins.
- Pure edge (D1 only, no remote `url`) may leave billing pointing at a non-routable or sentinel path; invoking billing without a real base must fail with structured configuration/HTTP errors rather than silently succeeding against a fake host.
- Feature-detection code that reads `client.capabilities.storage.objects` must match whether `client.storage` object operations (local or remote) are actually configured.

## Consequences

- Hybrid Workers can use one client for D1 CRUD + remote billing/auth without custom URL hacks.
- Billing resolution for **non-edge** gateway clients is unchanged: `dbUrl ?? root` remains valid when `db.url` is a real Athena host.
- Docs must show hybrid examples with `url` + `db.d1` and document that billing is remote.

## Validation

- `createClient({ db: { d1 }, url: 'https://athena.example.com', key })` → billing HTTP call matches `https://athena.example.com/…` and does not include `athena.local`.
- Same assertion for `createCloudflareClient({ d1, url, key })`.
- Hybrid without R2 → `capabilities.storage.objects === true` and `storage.local === false`.
- Edge with R2 → `storage.local === true` and `storage.objects === true`.
- Pure gateway billing tests still inherit db/root as today.
