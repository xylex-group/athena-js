# Cloudflare Athena examples

Copy-paste Workers for `@xylex-group/athena/cloudflare`.

**Deployable monorepo Worker** (wired to this package):
[`apps/cloudflare-edge`](../../../../apps/cloudflare-edge) — D1 + R2 via `createAthenaFromWorkerEnv`, tests, Wrangler envs.

## Prefer this first

### One-call Worker setup (improved DX)

```ts
import { createAthenaFromWorkerEnv } from '@xylex-group/athena/cloudflare'

export default {
  async fetch(request: Request, env: Env) {
    // Maps DB, FILES, ATHENA_URL, ATHENA_API_KEY, ATHENA_EXECUTION_MODE, …
    const { mode, client: athena, capabilities } = createAthenaFromWorkerEnv(env)
    // Same fluent API whether edge (D1) or gateway (athena_rs)
    const { data } = await athena.query('SELECT 1 AS ok')
    return Response.json({ mode, capabilities, data })
  },
}
```

| Env / binding | Role |
| --- | --- |
| `DB` | D1 → edge when auto |
| `FILES` | R2 object storage (edge) |
| `ATHENA_URL` + `ATHENA_API_KEY` | Gateway when auto / forced |
| `ATHENA_EXECUTION_MODE` | `auto` \| `edge` \| `gateway` |
| `ATHENA_EXECUTION_PREFER` | When **both** D1 and URL exist: `edge` (default) or `gateway` |
| `ATHENA_AUTH_URL` | Hybrid remote auth on edge |

### Unified demo app (all routes ↔ 01–17)

Point Wrangler `main` at **[app.ts](./app.ts)** to exercise **every** numbered example without swapping files:

```jsonc
// wrangler.example.jsonc
"main": "app.ts"
```

Then `npx wrangler dev` and open `/` for the route catalog. `GET /` returns an `examples` map (`01`…`17` → path).

Extra routes beyond the original CRUD set:

| Route | Example |
| --- | --- |
| `POST /users/default-values` | 08 DEFAULT VALUES |
| `POST /users/default-to-null` | 08 `defaultToNull` |
| `DELETE /users/page` | 10 paged delete |
| `DELETE /users/by-resource/:id` | 10 by `resource_id` |
| `DELETE /users/by-id/:id` | 10 by primary key |
| `GET /tenant` (+ `X-User-Id`) | 17 `withContext` + tenant filter |

---

## Decision tree

```text
Need one Worker that can hit D1 OR athena_rs?
  └─ createAthenaFromWorkerEnv(env)   // or createAthenaRuntime({ mode: 'auto', … })

Always only D1 in this deploy?
  └─ createCloudflareClient({ d1: env.DB, r2: env.FILES })

Always only remote Athena?
  └─ createClient({ url, key })  // root package
     // or createAthenaRuntime({ mode: 'gateway', url, key })
```

---

## File layout (what to open)

| Role | Files | When |
| --- | --- | --- |
| **Canonical all-routes demo** | [app.ts](./app.ts) | Local try / copy-paste full Worker |
| **One concern each** | [01–17](#per-concern-snippets-0117) | Learn a single API |
| **Cookbooks** | [worker-basic.ts](./worker-basic.ts), [worker-crud.ts](./worker-crud.ts), [worker-switchable.ts](./worker-switchable.ts) | Longer multi-route samples |
| **Aliases** | [worker-storage.ts](./worker-storage.ts) → `14-…`, [worker-hybrid-auth.ts](./worker-hybrid-auth.ts) → `15-…` | Old links keep working |
| **Schema** | [schema/users.sql](./schema/users.sql) | `users` (+ `resource_id`) + `notes` |
| **Shared types** | [shared/env.ts](./shared/env.ts) | `ExampleEnv` / `UserRow` |

Typecheck from package root:

```bash
pnpm typecheck:examples
```

---

## Per-concern snippets (01–17)

Use when you want a minimal file for one API.

### Modes

| # | File | Shows |
| --- | --- | --- |
| 01 | [01-mode-edge-only.ts](./01-mode-edge-only.ts) | `createCloudflareClient` only |
| 02 | [02-mode-gateway-only.ts](./02-mode-gateway-only.ts) | `mode: 'gateway'` |
| 03 | [03-mode-auto-switch.ts](./03-mode-auto-switch.ts) | `mode: 'auto'` + prefer |
| 04 | [04-mode-env-force.ts](./04-mode-env-force.ts) | `ATHENA_EXECUTION_MODE` |

### L0 / L1 D1

| # | File | Shows |
| --- | --- | --- |
| 05 | [05-l0-raw-query.ts](./05-l0-raw-query.ts) | `query` + params |
| 06 | [06-l1-select-filter.ts](./06-l1-select-filter.ts) | filters / order / limit |
| 07 | [07-l1-insert-upsert.ts](./07-l1-insert-upsert.ts) | insert / upsert |
| 08 | [08-l1-insert-sparse-and-defaults.ts](./08-l1-insert-sparse-and-defaults.ts) | sparse + DEFAULT VALUES |
| 09 | [09-l1-update-paged.ts](./09-l1-update-paged.ts) | paged update |
| 10 | [10-l1-delete.ts](./10-l1-delete.ts) | delete by `resource_id` / `id` / page |
| 11 | [11-l1-head-count.ts](./11-l1-head-count.ts) | head COUNT |
| 12 | [12-l1-exact-count.ts](./12-l1-exact-count.ts) | page + total count |
| 13 | [13-l1-uuid-eq.ts](./13-l1-uuid-eq.ts) | UUID equality on D1 |

### R2 / hybrid

| # | File | Shows |
| --- | --- | --- |
| 14 | [14-l3a-r2-storage.ts](./14-l3a-r2-storage.ts) | R2 object I/O |
| 15 | [15-hybrid-auth.ts](./15-hybrid-auth.ts) | D1 + remote auth |
| 16 | [16-capabilities.ts](./16-capabilities.ts) | feature flags |
| 17 | [17-with-context-tenant.ts](./17-with-context-tenant.ts) | tenant filters |

### Config

| File | Purpose |
| --- | --- |
| [app.ts](./app.ts) | **All routes in one Worker** |
| [wrangler.example.jsonc](./wrangler.example.jsonc) | Bindings + mode env |
| [schema/users.sql](./schema/users.sql) | Sample tables (`resource_id` included) |
| [shared/env.ts](./shared/env.ts) | Shared Env type |

---

## Quick start

```bash
pnpm add @xylex-group/athena
# copy app.ts + wrangler.example.jsonc into your Worker
npx wrangler d1 create my-edge-db
# set database_id
npx wrangler d1 execute my-edge-db --local --file=./schema/users.sql
npx wrangler dev
```

Docs: [cloudflare-edge-local.md](../../docs/cloudflare-edge-local.md)
