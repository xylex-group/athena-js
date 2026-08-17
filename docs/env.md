# Environment resolution (`@xylex-group/athena/env`)

Canonical helpers for Athena connection settings, plus the **single source of
truth** for createClient / Workers / execution-mode env alias catalogs. Prefer
**primary keys only** in new apps; enable legacy aliases only when migrating
older codebases.

## Primary keys

| Field | Env key |
| --- | --- |
| Gateway / data URL | `ATHENA_URL` |
| API key | `ATHENA_API_KEY` |
| Client name | `ATHENA_CLIENT` |
| Auth base URL | `ATHENA_AUTH_URL` |

```ts
import { requireAthenaEnv, resolveAthenaEnv } from '@xylex-group/athena/env'

const { url, apiKey, client, authUrl, sources } = requireAthenaEnv({
  env: process.env,
})

// Optional debug: ATHENA_ENV_DEBUG=1 or { debug: true }
resolveAthenaEnv({ env: process.env, debug: true })
```

## createClient / Workers catalogs (SSOT)

`createClient`, Cloudflare Worker façades, and `resolveAthenaExecutionMode`
always consult these ordered lists (not gated by `legacyAliases`). Export names
live in `@xylex-group/athena/env` — do not re-copy them elsewhere.

| Field / surface | Export | Keys (priority order) |
| --- | --- | --- |
| Root `url` | `ATHENA_ENV_URL_KEYS` | `ATHENA_URL`, `NEXT_PUBLIC_ATHENA_URL` |
| DB / gateway service | `ATHENA_ENV_DB_URL_KEYS` | `ATHENA_DB_URL`, `ATHENA_GATEWAY_URL`, `NEXT_PUBLIC_ATHENA_DB_API_URL` |
| Combined gateway URL (mode + Workers) | `ATHENA_ENV_GATEWAY_URL_KEYS` | URL keys then DB keys |
| API key | `ATHENA_ENV_API_KEY_KEYS` | `ATHENA_API_KEY`, `NEXT_PUBLIC_ATHENA_API_KEY`, `ATHENA_GATEWAY_API_KEY`, `X_API_KEY` |
| Client name | `ATHENA_ENV_CLIENT_KEYS` | `ATHENA_CLIENT`, `ATHENA_GATEWAY_CLIENT`, `ATHENA_GENERATOR_CLIENT`, `NEXT_PUBLIC_ATHENA_CLIENT`, `NEXT_PUBLIC_ATHENA_GATEWAY_CLIENT` |

Service-specific keys (`ATHENA_AUTH_URL`, `ATHENA_CHAT_URL`, `ATHENA_STORAGE_URL`,
… and their `NEXT_PUBLIC_*` twins) stay local to createClient. Generator-only
keys (`ATHENA_GENERATOR_URL`, `ATHENA_GENERATOR_API_KEY`) stay local to the
generator; the generator reuses `ATHENA_ENV_CLIENT_KEYS` for client name.

```ts
import {
  ATHENA_ENV_API_KEY_KEYS,
  ATHENA_ENV_GATEWAY_URL_KEYS,
} from '@xylex-group/athena/env'
```

## Legacy aliases

```ts
resolveAthenaEnv({
  env: process.env,
  legacyAliases: true, // NEXT_PUBLIC_*, ATHENA_GATEWAY_URL, ATHENA_KEY, …
})
```

When multiple keys are set, the highest-priority key wins; lower-priority
non-empty keys appear in `ignored` for diagnostics.

Legacy membership for `resolveAthenaEnv` intentionally differs from createClient
catalogs (e.g. `ATHENA_KEY`, `ATHENA_CLIENT_NAME`, `NEXT_PUBLIC_ATHENA_GATEWAY_URL`).
Do not merge those sets without a product decision.

## Auth path constant

`ATHENA_AUTH_PATH` (`/api/auth`) and base-URL helpers live in
`@xylex-group/athena/utils` (and are re-exported from `next/server`). Prefer that
ownership over duplicate constants in UI packages.
