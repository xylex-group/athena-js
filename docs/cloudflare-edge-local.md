# Cloudflare edge-local mode (D1 + R2)

Run `@xylex-group/athena` **inside** a Cloudflare Worker against **D1** and optional **R2** bindings, without an HTTP hop to `athena_rs` or `apps/cloudflare-d1-proxy`.

| Doc | Purpose |
| --- | --- |
| This page | When to use, setup, switching modes, layers, security |
| [ADR catalog](./adr/README.md) | Full decision index |
| [ADR 0015](./adr/0015-execution-transport-and-cloudflare-edge.md) | Execution transport + edge as backend |
| [ADR 0016](./adr/0016-drop-in-edge-bindings-on-create-client.md) | Drop-in `db.d1` / `storage.r2` on `createClient` |
| [ADR 0017](./adr/0017-d1-sql-compiler-and-mutation-bounds.md) | D1 SQL compiler, range-bounded deletes, batch counts |
| [ADR 0018](./adr/0018-hybrid-edge-remote-service-routing.md) | Hybrid billing/auth/storage routing |
| [ADR 0019](./adr/0019-execution-mode-resolution-and-runtime-facades.md) | `auto` / prefer / Worker env façades |
| [ADR 0020](./adr/0020-client-capabilities-and-edge-layer-honesty.md) | `client.capabilities` + L0–L3 honesty |
| [API surface](./api-reference.md#cloudflare-edge-local--switchable-runtime) | Signatures and types |
| [examples/cloudflare](../examples/cloudflare/README.md) | **One example per mode/API** (01–17) |

---

## When to use

| Topology | Use |
| --- | --- |
| App Worker owns D1/R2 | **Edge-local** via `createClient({ db: { d1 }, storage: { r2 } })` |
| Athena server talks to D1 | **Proxy** (`apps/cloudflare-d1-proxy` + catalog `cloudflare-d1`) |
| Default multi-tenant Athena | **Gateway HTTP** (`createClient({ url, key })`) |

These are complementary. Edge-local is **app-owned isolation**, not a multi-tenant Athena client registry. The **same** `createClient` materializer and fluent `from` / `query` / `storage.*` call sites work in both modes (ADR 0001 / 0015).

```text
Gateway mode:
  app --HTTP--> athena_rs --HTTP--> d1-proxy --binding--> D1

Edge-local mode:
  Worker + createClient({ db: { d1 }, storage: { r2 } }) --binding--> D1 / R2
```

---

## Single constructor: `createClient` (required path)

**Everything** materializes through root `createClient`. Edge D1/R2, hybrid remote
services, and edge↔gateway switching are config fields on that one API — not a
second client core.

```ts
import { createClient } from '@xylex-group/athena'

// Gateway HTTP
const gateway = createClient({ url: env.ATHENA_URL, key: env.ATHENA_API_KEY })

// Edge bindings (nested — preferred in shared code)
const edge = createClient({
  db: { d1: env.DB },
  storage: { r2: env.FILES, prefix: 'app/' },
})

// Top-level aliases (Worker DX; same as nested)
const edgeAlias = createClient({
  d1: env.DB,
  r2: env.FILES,
  storagePrefix: 'app/',
})

// Hybrid: local D1 + remote auth/billing
const hybrid = createClient({
  db: { d1: env.DB },
  url: env.ATHENA_URL,
  key: env.ATHENA_API_KEY,
})

// Switch when BOTH binding and URL exist
const switched = createClient({
  d1: env.DB,
  r2: env.FILES,
  url: env.ATHENA_URL,
  key: env.ATHENA_API_KEY,
  mode: 'auto', // edge | gateway | auto (env ATHENA_EXECUTION_MODE)
  prefer: 'edge', // when both: edge | gateway (env ATHENA_EXECUTION_PREFER)
})

await edge.from('users').select('id,email')
await edge.storage.putObject({ key: 'a.txt', body: 'hello' })
```

| Config | Backend |
| --- | --- |
| `db.url` / root `url` | HTTP gateway DB |
| `db.d1` or top-level `d1` | In-process D1 |
| `storage.url` | HTTP storage |
| `storage.r2` or top-level `r2` | In-process R2 (L3a objects) |
| `mode` / `prefer` | Choose edge vs gateway when both available |

Optional **thin façades** from `@xylex-group/athena/cloudflare` only map shapes into `createClient`:

```ts
import {
  createCloudflareClient, // → createClient({ db: { d1 }, storage: { r2 } })
  createAthenaRuntime, // → { mode, client: createClient(...) }
  createAthenaFromWorkerEnv, // maps env.DB / env.FILES / ATHENA_* → createClient
  resolveAthenaExecutionMode,
} from '@xylex-group/athena/cloudflare'
```

Do not pass D1/R2 bindings into **browser** bundles. Gateway `createClient({ url, key })` stays browser-safe.

---

## Switching edge ↔ gateway

Prefer `createClient({ mode, prefer, d1, url, key })` (above). Worker env helper:

```ts
import { createAthenaFromWorkerEnv } from '@xylex-group/athena/cloudflare'

export default {
  async fetch(request: Request, env: Env) {
    // Still ends in createClient under the hood
    const { mode, client: athena, capabilities } = createAthenaFromWorkerEnv(env, {
      storagePrefix: 'app/',
    })
    await athena.from('users').select('id,email')
    return Response.json({ mode, capabilities })
  },
}
```

Maps `env.DB`, `env.FILES`, `ATHENA_URL`, `ATHENA_API_KEY`, `ATHENA_AUTH_URL`,
`ATHENA_CLIENT`, `ATHENA_EXECUTION_MODE`, `ATHENA_EXECUTION_PREFER`.

| `mode` | Behavior |
| --- | --- |
| `edge` | Requires `d1`. DB via bindings. |
| `gateway` / `server` / `remote` | HTTP to `url` + `key` (athena_rs). |
| `auto` (default) | Only D1 → edge; only URL → gateway; **both** → `prefer` (default edge) |

| Env | Meaning |
| --- | --- |
| `ATHENA_EXECUTION_MODE` | `auto` \| `edge` \| `gateway` |
| `ATHENA_EXECUTION_PREFER` | When both backends available: `edge` \| `gateway` |

Unified demo Worker with **all** routes: [examples/cloudflare/app.ts](../examples/cloudflare/app.ts).  
Per-API snippets (01–17): [examples/cloudflare/README.md](../examples/cloudflare/README.md).

---

## Quick start (edge-only)

```ts
import { createClient } from '@xylex-group/athena'

export interface Env {
  DB: D1Database
  FILES?: R2Bucket
  ATHENA_AUTH_URL?: string
  ATHENA_API_KEY?: string
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const athena = createClient({
      db: { d1: env.DB },
      ...(env.FILES ? { storage: { r2: env.FILES, prefix: 'app/' } } : {}),
      ...(env.ATHENA_AUTH_URL
        ? { auth: { url: env.ATHENA_AUTH_URL }, key: env.ATHENA_API_KEY }
        : {}),
    })

    const { data, error } = await athena.query<{ ok: number }>('SELECT 1 AS ok')
    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ data, capabilities: athena.capabilities })
  },
}
```

`wrangler.jsonc` (minimal):

```jsonc
{
  "name": "my-edge-app",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-22",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-app-db",
      "database_id": "<your-d1-id>"
    }
  ],
  "r2_buckets": [
    {
      "binding": "FILES",
      "bucket_name": "my-app-files"
    }
  ]
}
```

---

## Construction API

### `createAthenaRuntime(config)` / `createAthenaRuntimeClient(config)`

| Field | Description |
| --- | --- |
| `mode` | `auto` \| `edge` \| `gateway` (+ aliases). Default `auto`. |
| `d1` / `r2` | Edge bindings |
| `url` / `key` | Gateway (and hybrid remote services) |
| Shared | `auth`, `models`, `context`, `headers`, `env`, diagnostics flags |

Returns `{ mode, client }` or just the client.

### `createCloudflareClient(config)`

Always edge. Requires `d1`. Optional `r2` types L3a storage methods.

### Capabilities

```ts
athena.capabilities
// edge:   { mode: 'cloudflare-edge', db: { local: true, engine: 'cloudflare-d1', ... } }
// gateway:{ mode: 'gateway', db: { local: false, engine: 'postgresql', ... } }
```

---

## Layered surface (edge)

| Layer | Surface | Notes |
| --- | --- | --- |
| **L0** | `athena.query(sql, { params? })` | SQLite-safe SQL + bind params |
| **L1** | Flat `from` / `db` CRUD + upsert | Filters, order, limit/offset, pages |
| **L1** | Head-only select | `{ head: true }` → COUNT; empty data |
| **L1** | Paged update/delete | `rowid IN (SELECT rowid … LIMIT/OFFSET)` |
| **L3a** | R2 object I/O | No catalogs / backups |

Gateway mode uses the full server feature set (relations/rpc/catalogs depend on backend).

---

## Security model

| Topic | Rule |
| --- | --- |
| Trust | Worker code is trusted; bindings are ambient authority |
| Browser | Never construct edge client in the browser |
| Multi-tenant registry | Out of scope on edge — filter in SQL/builders |
| AuthZ | `withContext` does not imply server RLS on D1 |
| Proxy token | `ATHENA_D1_PROXY_TOKEN` only for athena_rs → proxy |

---

## Testing

```bash
cd packages/athena-js
pnpm exec tsx --test test/cloudflare-*.test.ts
pnpm typecheck
```

| File | Coverage |
| --- | --- |
| `test/cloudflare-runtime.test.ts` | mode resolution + createAthenaRuntime |
| `test/cloudflare-d1-sql.test.ts` | SQL compile |
| `test/cloudflare-d1-runner.test.ts` | prepare/bind/session |
| `test/cloudflare-client.test.ts` | edge client + R2 |
| `test/cloudflare-transport.test.ts` | head, batch insert, pagination |

---

## Related

- [Cloudflare D1 limitations (server/proxy)](../../../docs/backends/cloudflare-d1-limitations.md)
- [cloudflare-d1-proxy README](../../../apps/cloudflare-d1-proxy/README.md)
- [Getting started](./getting-started.md) — gateway `createClient` path
