# Athena JS SDK – Express Test Client

Basic Express app that exercises the `@xylex-group/athena` SDK.

## Setup

From the athena-js repo root:

```bash
npm run build          # build the SDK first
cd test-sdk
npm install
```

## Run

```bash
npm run start
# or with auto-reload:
npm run dev
```

## Environment

| Variable         | Default              | Description                          |
|------------------|----------------------|--------------------------------------|
| `ATHENA_URL`     | `https://athena-db.com` | Athena gateway base URL            |
| `ATHENA_API_KEY` | _(required)_         | API key for Athena gateway           |
| `PORT`           | `3000`               | HTTP server port                     |

## Endpoints

| Method | Path                               | Description                    |
|--------|------------------------------------|--------------------------------|
| GET    | `/health`                          | Health check                   |
| GET    | `/table/:name?limit=&offset=`      | Select rows (paginated)        |
| GET    | `/table/:name/by/:column/:value`   | Select by column equality      |
| POST   | `/table/:name`                     | Insert rows (body = insert payload) |
| PATCH  | `/table/:name/by/:column/:value`   | Update by column match         |
| DELETE | `/table/:name/:resourceId`         | Delete by resource_id          |

## Example

```bash
curl http://localhost:3000/health
curl "http://localhost:3000/table/users?limit=5"
```
