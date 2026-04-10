# Athena JS Test SDK

Express test service that exercises `@xylex-group/athena` through HTTP routes.

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
| `GET` | `/table/:name?limit=&offset=` | Read rows with pagination |
| `GET` | `/table/:name/by/:column/:value` | Read one row by equality filter |
| `POST` | `/table/:name` | Insert row(s) |
| `PATCH` | `/table/:name/by/:column/:value` | Update row(s) by equality filter |
| `DELETE` | `/table/:name/:resourceId` | Delete row by `resource_id` |
| `POST` | `/rpc/:functionName` | Execute RPC through `POST /gateway/rpc` |

`POST /rpc/:functionName` also supports compatibility GET-mode by sending `{ "get": true }` in body, plus `filters`, `count` (`exact`/`planned`/`estimated`), `head`, `order`, `limit`, and `offset`.

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
