# Athena JS Test SDK

Express test service that exercises `@xylex-group/athena` through HTTP routes.
It also includes React runtime examples showing Athena DB calls inside `useQuery` / `useMutation`.

## Setup

From the repository root:

```bash
pnpm build
cd test-sdk
pnpm install
```

## Run

```bash
pnpm start
# or
pnpm dev
```

## Run E2E tests

```bash
pnpm test:e2e
```

The E2E tests boot the Express server and verify route behavior and gateway forwarding, including structured error responses.

From repository root, you can also run the React runtime integration tests that use `test-sdk` as a backend:

```bash
node --import tsx --test test/react-test-sdk-hooks-integration.test.ts
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ATHENA_URL` | `https://mirror3.athena-db.com` | Athena gateway base URL |
| `ATHENA_API_KEY` | _required_ | Athena gateway API key |
| `ATHENA_CLIENT` | `athena_logging` | Client routing key (`X-Athena-Client`) |
| `PORT` | `3000` | Local server port |

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness endpoint |
| `GET` | `/demo/products` | Local demo list used by integration tests |
| `POST` | `/demo/products` | Local demo create route used by integration tests |
| `GET` | `/table/:name?limit=&offset=` | Read rows with pagination |
| `GET` | `/table/:name/by/:column/:value` | Read one row by equality filter |
| `POST` | `/table/:name` | Insert row(s) |
| `PATCH` | `/table/:name/by/:column/:value` | Update row(s) by equality filter |
| `DELETE` | `/table/:name/:resourceId` | Delete row by `resource_id` |
| `POST` | `/rpc/:functionName` | Execute RPC through `POST /gateway/rpc` |

`POST /rpc/:functionName` also supports compatibility GET-mode by sending `{ "get": true }` in body, plus `filters`, `count` (`exact`/`planned`/`estimated`), `head`, `order`, `limit`, and `offset`.

## React runtime examples

Example files are available in:

- `test-sdk/examples/react-hooks/products-panel.tsx`
- `test-sdk/examples/react-hooks/manual-query.tsx`
- `test-sdk/examples/react-hooks/adapters.ts`

These examples call Athena through `createClient(...).from(...).select()/insert()` (not `fetch` wrappers).
The hook files themselves contain direct query-builder calls (`athena.from(...).select()/insert()/eq()`).
See `test-sdk/examples/react-hooks/README.md` for wiring and usage details.

## Generator full-utilization examples

Generator examples are available in:

- `test-sdk/examples/generator/full-utilization.ts`
- `test-sdk/examples/generator/README.md`

The suite demonstrates:

- direct PostgreSQL mode via `provider.mode = "direct"` and `connectionString` (`pg_url`)
- gateway-only mode via `provider.mode = "gateway"` over Athena `/gateway/query`
- config discovery/loading (`athena.config.ts`)
- dry-run vs write generation
- placeholder + naming strategy behavior
- feature toggles (`emitRelations`, `emitRegistry`)
- type mapping showcase (`resolvePostgresColumnType`)

These examples are validated by:

```bash
node --import tsx --test test/generator-full-utilization.e2e.test.ts
```

## Error response shape

All server-side validation and upstream failures are normalized:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "limit must be a non-negative integer",
    "details": {
      "field": "limit",
      "received": "abc"
    }
  },
  "responseTimeMs": 2
}
```
