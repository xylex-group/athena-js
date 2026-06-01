# athena-js

current version: `2.1.2`
`@xylex-group/athena` is a database driver and API gateway SDK that lets you interact with SQL backends over HTTP through a fluent builder API. It ships a typed query builder for Node.js / server environments plus Athena-native React hooks for client-side use.

## Install

```bash
npm install @xylex-group/athena
# or
pnpm add @xylex-group/athena
# or
yarn add @xylex-group/athena
```

React peer dependency is optional — only needed if you use `@xylex-group/athena/react` hooks.

```bash
npm install react  # React >=17 required for the hook
```

## Quick start

```ts
import { createClient } from "@xylex-group/athena";

const athenaClient = createClient(ATHENA_URL, ATHENA_API_KEY, {
  client: "CLIENT_NAME",
  backend: { type: "athena" },
});

const { data, error } = await athenaClient.from("characters").select(`
    id,
    name,
    from:sender_id(name),
    to:receiver_id(name)
  `);

if (error) {
  console.error("gateway error", error);
} else {
  console.table(data);
}
```

### Auth client (Athena Auth server)

If your auth backend is now Athena Auth, you can keep core login/session flows in this SDK:

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  client: "CLIENT_NAME",
  auth: {
    baseUrl: "http://localhost:3001/api/auth",
    // optional: bearer token if you are not using cookie-based sessions
    bearerToken: process.env.AUTH_BEARER_TOKEN,
  },
});

const login = await athena.auth.signIn.email({
  email: "demo@example.com",
  password: "super-secret",
  rememberMe: true,
});

const session = await athena.auth.getSession();
const sessions = await athena.auth.session.list();

// clear one session
await athena.auth.session.revoke({ token: "session_token_here" });
// or clear all sessions
await athena.auth.session.revoke([{ token: "session_token_here" }, { token: "session_token_2" }]);

await athena.auth.signOut();

// additional core flows
await athena.auth.forgetPassword({ email: "demo@example.com", redirectTo: "https://app/reset-password" });
await athena.auth.resetPassword({ newPassword: "new-secret", token: "reset_token" });
await athena.auth.verifyEmail({ token: "verify_token", callbackURL: "https://app/verified" });
await athena.auth.changePassword({ currentPassword: "old-secret", newPassword: "new-secret" });
await athena.auth.user.update({ name: "Demo User" });
```

Auth responses follow the same envelope style: `{ ok, status, data, error, errorDetails, raw }`.

### Typed schema registry (model-first)

You can keep `createClient(...).from<T>(...)` as-is, or opt into a typed registry:

```ts
import {
  createTypedClient,
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from "@xylex-group/athena";

const registry = defineRegistry({
  primary: defineDatabase({
    public: defineSchema({
      users: defineModel<{ id: string; email: string }>({
        meta: {
          primaryKey: ["id"],
          nullable: { id: false, email: false },
        },
      }),
    }),
  }),
});

const typed = createTypedClient(registry, ATHENA_URL, ATHENA_API_KEY, {
  tenantKeyMap: {
    organizationId: "X-Organization-Id",
  },
});

await typed
  .withTenantContext({ organizationId: "org_1" })
  .fromModel("primary", "public", "users")
  .select("*");
```

For full details, see [`docs/typed-schema-registry.md`](./docs/typed-schema-registry.md).

For exhaustive method-by-method documentation with usage snippets (root client, runtime builders, auth bindings, react runtime, cookies, and utils), see [`docs/complete-method-reference.md`](./docs/complete-method-reference.md).

### Typed schema generator

Schema generation is additive. Existing `createClient(...).from<T>(...)` usage remains valid while teams migrate to generated registry files.

CLI:

```bash
athena-js generate
athena-js generate --dry-run
athena-js generate --config ./athena.config.ts
athena-js generate --help
athena-js help generate
```

Generator supports:

- PostgreSQL direct introspection (`provider.mode = "direct"`, `provider.connectionString` from your `PG_URL`/`DATABASE_URL`)
- PostgreSQL gateway-only introspection (`provider.mode = "gateway"` via Athena `POST /gateway/query`)
- Multiple schema syncs such as `public` plus `athena`, with schema-safe default output paths
- Placeholder-driven output paths
- Feature flags (`features.emitRegistry`, `features.emitRelations`)

For full generator configuration and troubleshooting, see [`docs/generator-config.md`](./docs/generator-config.md).
For full CLI commands, help behavior, and troubleshooting, see [`docs/cli-command-reference.md`](./docs/cli-command-reference.md).
For CI/CD pipelines and generated-file branch policy, see [`docs/generator-cicd.md`](./docs/generator-cicd.md).
For prompt-ready documentation handoff text, see [`docs/generator-codex-handoff-prompt-pack.md`](./docs/generator-codex-handoff-prompt-pack.md).

### Athena JS and Athena RS

`athena-js` is designed to be standalone for TypeScript/Node and React-native workflows:

- query builder + hooks
- typed registry and generator pipeline
- CLI-driven codegen in JS/TS projects

`athena-rs` remains the faster fit for Rust service execution paths. Teams can run both in parallel:

- `athena-rs` for Rust backend throughput
- `athena-js` for app/tooling layers that need TypeScript contracts and frontend-facing ergonomics

Every query resolves to `{ data, error, errorDetails?, status, count?, raw }`. `data` is `null` on error; `error` is `null` on success.

For richer handling, inspect `errorDetails` (`code`, `status`, `endpoint`, `method`, `requestId`, etc.) or use `AthenaGatewayError` / `isAthenaGatewayError` from the package exports.

## Reliability helper APIs

The SDK exports composable helpers to reduce repetitive route-handler logic.

### Result unwrapping and success guards

```ts
import {
  isOk,
  unwrap,
  unwrapRows,
  unwrapOne,
  requireSuccess,
  requireAffected,
} from "@xylex-group/athena";

const result = await athena.from("users").select("id,name");

if (isOk(result)) {
  const rows = unwrapRows(result); // typed User[]
  console.log(rows.length);
}

const one = await athena.from("users").eq("id", 1).single("id,name");
const user = unwrapOne(one, { allowNull: true });

const inserted = await athena
  .from("users")
  .insert({ name: "Alice" })
  .select("id", { count: "exact" });

requireSuccess(inserted, { table: "users", operation: "insert" });
requireAffected(inserted, { min: 1 }, { table: "users", operation: "insert" });
```

`requireAffected` uses `result.count`; request it on writes with `{ count: "exact" }` when you need enforced postconditions.

### Error normalization

```ts
import { createClient, normalizeAthenaError } from "@xylex-group/athena";

const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  experimental: { enableErrorNormalization: true },
});

const result = await athena.from("users").insert({ id: 1 }).select();
if (result.error) {
  const err = normalizeAthenaError(result);
  if (err.kind === "unique_violation") {
    // deterministic conflict handling
  }
}
```

Normalized errors expose stable `kind` values (`unique_violation`, `validation`, `auth`, `rate_limit`, `transient`, etc.) plus operation metadata.

`experimental.enableErrorNormalization` keeps the existing `AthenaResult<T>` shape intact and pre-attaches context-aware metadata so `normalizeAthenaError(result)` can resolve table/operation without extra per-call context objects.

### Query tracing (experimental)

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  experimental: { traceQueries: true },
});
```

With `traceQueries: true`, the SDK logs every runtime execution (`select`, `insert`, `upsert`, `update`, `delete`, `rpc`, `query`) and includes:

- the gateway endpoint used
- synthesized SQL (or raw SQL for `query(...)` and SQL fallback reads)
- payload and call options
- full outcome (`status`, `error`, `count`, `data`, `raw`)
- callsite metadata (`filePath`, `fileName`, `line`, `column`)

Use a custom sink:

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  experimental: {
    traceQueries: {
      logger(event) {
        // Forward into your logger/observability sink
        console.log(event.operation, event.endpoint, event.sql, event.callsite);
      },
    },
  },
});
```

### Numeric coercion

```ts
import { coerceInt, assertInt } from "@xylex-group/athena";

const maybeCaseId = coerceInt(req.query.case_id, { min: 1 });
if (maybeCaseId == null) throw new Error("Invalid case id");

const caseId = assertInt(req.query.case_id, "case_id", { min: 1 });
```

### Utilities subpath

Utilities that are intentionally not exported from the root package are available from `@xylex-group/athena/utils`.

```ts
import {
  slugify,
  trimTrailingSlashes,
  parseBooleanFlag,
  isLocalHostname,
  clearAuthCookies,
  proxyRequestHeaders,
} from "@xylex-group/athena/utils";
```

Examples:

```ts
const slug = slugify("Customer Success / Q4 Report"); // customer-success-q4-report
const local = isLocalHostname("api.localhost"); // true
const normalized = trimTrailingSlashes("https://example.com///"); // https://example.com
const enabled = parseBooleanFlag(process.env.FEATURE_FLAG, false);

// Browser-only helper (safe no-op on server runtimes)
clearAuthCookies();

// Preserve forwarded headers when proxying auth requests
const upstreamHeaders = proxyRequestHeaders(request);
```

`clearAuthCookies()` clears cookies matching Athena/Better Auth prefixes (`athena-auth`, `__Secure-athena-auth`, `better-auth`, `__Secure-better-auth`) and also attempts parent-domain cleanup for subdomain deployments.

### Retry helper

```ts
import { withRetry } from "@xylex-group/athena";

const result = await withRetry(
  {
    retries: 3,
    backoff: "exponential",
    baseDelayMs: 100,
    jitter: true,
  },
  () => athena.from("users").select("id,name"),
);
```

By default, retries target transient/rate-limit failures; use `shouldRetry` for custom policies.

## Query builder

### DB module namespace

`createClient()` keeps root methods (`from`, `rpc`, `query`) and now also exposes `db` as an additive namespace.

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY);

await athena.db.from("users").select("id,name").eq("active", true).limit(20);

await athena.db.select("users", "id,name").eq("id", 1).single();

await athena.db.insert("users", { id: 1, name: "Alice" }).select("id");
await athena.db.update("users", { name: "Updated" }).eq("id", 1).select("id,name");
await athena.db.delete("users", { resourceId: "r-1" }).select("id");
```

`db` mirrors the existing query builder semantics while providing a module seam for future database-surface expansion.

### Reading rows

```ts
// select all columns
const { data } = await athena.from("users").select();

// select specific columns
const { data } = await athena.from("users").select("id, name, email");

// select with type annotation
const { data } = await athena.from<User>("users").select("id, name");
```

### Filters

Filters accumulate on the builder and are sent together when the query executes.

```ts
const { data } = await athena
  .from("characters")
  .select("id, name")
  .eq("active", true) // column = value
  .eqUuid("session_id", "550e8400-e29b-41d4-a716-446655440000") // explicit UUID cast
  .eqCast("session_id", "550e8400-e29b-41d4-a716-446655440000", "uuid") // explicit cast type
  .neq("role", "guest") // column != value
  .gt("level", 5) // column > value
  .gte("score", 100) // column >= value
  .lt("age", 30) // column < value
  .lte("created_at", "2024-01-01") // column <= value
  .like("name", "Ali%") // SQL LIKE (case-sensitive)
  .ilike("email", "%@example%") // SQL ILIKE (case-insensitive)
  .is("deleted_at", null) // IS NULL / IS TRUE etc.
  .in("status", ["active", "pending"]) // IN (…)
  .contains("tags", ["hero"]) // array contains value
  .containedBy("tags", ["hero", "villain"]) // array is subset of value
  .match({ role: "admin", active: true }) // multiple eq filters at once
  .not("role", "eq", "banned") // NOT col op val
  .or("status.eq.active,status.eq.pending"); // OR expression
```

`eq()` now auto-detects UUID-like values on identifier columns (for example `id`, `*_id`, `*uuid*`) and uses a safe typed comparison path so UUID columns no longer require app-side manual `::uuid` / `::text` casts.

Canonical style for reads is to call `.select(...)` first, then apply filters:

```ts
const { data } = await athena
  .from("instruments")
  .select("name, section_id")
  .eq("name", "violin");
```

### Pagination

Two styles, pick whichever matches your UI / backend. Both live on the shared `FilterChain`, so they work before or after `.select()`.

```ts
// 1. offset / limit — contiguous windows
const { data } = await athena.from("users").select().limit(25).offset(50);

// range shorthand: offset = from, limit = to - from + 1
const { data: firstTwentyFive } = await athena.from("users").select().range(0, 24);

// 2. page based — maps to current_page / page_size / total_pages
const { data: page2 } = await athena
  .from("orders")
  .select("id, total")
  .currentPage(2)
  .pageSize(25);

// .totalPages() is an optional hint some backends use in the response envelope
const { data: hinted } = await athena
  .from("orders")
  .select("id, total")
  .currentPage(1)
  .pageSize(25)
  .totalPages(10);
```

| Method | Body field |
|--------|------------|
| `.limit(n)` | `limit` |
| `.offset(n)` | `offset` |
| `.range(from, to)` | `offset` + `limit` |
| `.currentPage(n)` | `current_page` |
| `.pageSize(n)` | `page_size` |
| `.totalPages(n)` | `total_pages` |

### Ordering

`.order(column, { ascending? })` is available on the table builder, select chain, update chain, and delete — before or after the operation terminator. It serializes to `sort_by: { field, direction }` on the gateway payload and defaults to ascending.

```ts
// descending + limit
// SELECT * FROM rsf_messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 100
const { data } = await athena
  .from("rsf_messages")
  .eq("room_id", roomId)
  .select("*", { stripNulls: false })
  .order("created_at", { ascending: false })
  .limit(100);

// ascending (default) + page-based pagination
const { data: page } = await athena
  .from("orders")
  .select("id, total, created_at")
  .order("created_at")
  .currentPage(1)
  .pageSize(25);

// combine with .single() to grab the newest / oldest row
const { data: latest } = await athena
  .from("messages")
  .eq("room_id", roomId)
  .select("*")
  .order("created_at", { ascending: false })
  .single();
```

Only the last `.order()` wins — the SDK does not support multi-column ordering on the table builder. Use `.rpc()` or `.query()` for that.

### Single row

```ts
// returns the first row or null instead of an array
const { data: user } = await athena
  .from("users")
  .select("id, name")
  .eq("id", 42)
  .single();
```

`maybeSingle` behaves identically — both return the first element of the result set.

### Table schema targeting

Use `schema` in table call options to qualify unqualified table names:

```ts
const { data } = await athena
  .from("users")
  .select("id,email", { schema: "public" });
```

This resolves the table target to `public.users`.

### RPC

Use `athena.rpc(...)` for Postgres function calls. By default it calls `POST /gateway/rpc`, and with `{ get: true }` it uses the compatibility route `GET /rpc/{function_name}`.

```ts
const { data, count } = await athena
  .rpc("list_users", { role: "admin" }, { count: "exact", schema: "public" })
  .eq("active", true)
  .order("created_at", { ascending: false })
  .range(0, 24)
  .select(["id", "email"]);

const { data: firstUser } = await athena
  .rpc<{ id: number; email: string }>("list_users", { role: "admin" })
  .single("id,email");

const { data: readOnlyUser } = await athena
  .rpc<{
    id: number;
    email: string;
  }>(
    "list_users",
    { role: "admin" },
    { get: true, count: "planned", head: true },
  )
  .eq("id", 1)
  .single("id,email");
```

RPC chain methods: `.eq()`, `.neq()`, `.gt()`, `.gte()`, `.lt()`, `.lte()`, `.like()`, `.ilike()`, `.is()`, `.in()`, `.order()`, `.limit()`, `.offset()`, `.range()`, `.select()`, `.single()`, `.maybeSingle()`.
RPC options: `schema`, `count` (`"exact" | "planned" | "estimated"`), `head`, `get`.

### Options

Pass options as the second argument to `.select()`:

| Option       | Type                                  | Description                                  |
| ------------ | ------------------------------------- | -------------------------------------------- |
| `schema`     | `string`                              | qualify unqualified table names for table calls |
| `count`      | `"exact" \| "planned" \| "estimated"` | request a row count alongside the data       |
| `head`       | `boolean`                             | return response headers only (no rows)       |
| `stripNulls` | `boolean`                             | strip null values from rows (default `true`) |

```ts
const { data } = await athena
  .from("orders")
  .select("id", { count: "exact", stripNulls: false });
```

## Mutations

Insert, update, upsert, and delete all return a `MutationQuery` that you can await directly or chain further calls onto before the request fires.

### Insert

```ts
const { data: inserted } = await athena
  .from("countries")
  .insert({ name: "Mordor" })
  .select("id, name");

// insert multiple rows
const { data } = await athena
  .from("characters")
  .insert([{ name: "Frodo" }, { name: "Sam" }])
  .select();

// Type inference differs by payload shape:
// - insert(one) => AthenaResult<Row>
// - insert(many) => AthenaResult<Row[]>
```

### Update

```ts
const { data: updated } = await athena
  .from("countries")
  .update({ name: "Gondor" })
  .eq("id", 1)
  .select();
```

Filters (`.eq()`, `.match()`, etc.) applied before `.update()` are used as `WHERE` conditions.

### Upsert

```ts
const { data } = await athena
  .from("countries")
  .upsert(
    { id: 2, name: "Rohan" },
    { updateBody: { name: "Rohan" }, onConflict: "id" },
  )
  .select();

// Type inference differs by payload shape:
// - upsert(one) => AthenaResult<Row>
// - upsert(many) => AthenaResult<Row[]>
```

| Option          | Type                                  | Description                              |
| --------------- | ------------------------------------- | ---------------------------------------- |
| `onConflict`    | `string \| string[]`                  | column(s) that determine a conflict      |
| `updateBody`    | `object`                              | fields to apply when a conflict occurs   |
| `defaultToNull` | `boolean`                             | write explicit `null` for missing fields |
| `count`         | `"exact" \| "planned" \| "estimated"` | request a row count                      |
| `head`          | `boolean`                             | return headers only                      |

### Delete

```ts
// delete by id filter
await athena.from("countries").eq("id", 1).delete();

// delete with explicit resourceId option
await athena.from("countries").delete({ resourceId: "abc-123" });

// chain .select() to get the deleted row back
const { data: deleted } = await athena
  .from("countries")
  .eq("resource_id", "abc-123")
  .delete()
  .select("id, name");
```

Delete requires either `.eq("resource_id", …)`, `.eq("id", …)`, or `options.resourceId` — calling `.delete()` without any of these throws an error.

### MutationQuery chaining

All mutation methods return a `MutationQuery` which supports:

```ts
const mutation = athena.from("users").insert({ name: "Alice" });

await mutation.select("id, name");        // fire request, return rows
await mutation.returning("id");           // alias for .select()
await mutation.single("id");              // return first row or null
await mutation.maybeSingle("id");         // same as .single()
await mutation;                           // fire request, return default columns
mutation.then(({ data }) => …);           // thenable
mutation.catch(err => …);
mutation.finally(() => …);
```

The request fires only once regardless of how many times you call `.then()` or await the object.

## React hooks

```tsx
"use client";

import {
  AthenaQueryClientProvider,
  createAthenaQueryClient,
  useAthenaGateway,
  useMutation,
  useQuery,
} from "@xylex-group/athena/react";
import { createClient } from "@xylex-group/athena";

const queryClient = createAthenaQueryClient({
  cache: { mode: "none" }, // default: no persistent data cache, inflight dedupe only
});

const athena = createClient(
  process.env.NEXT_PUBLIC_ATHENA_URL!,
  process.env.NEXT_PUBLIC_ATHENA_API_KEY!,
);

type Product = {
  id: string;
  name: string;
  price: number;
};

type CreateProductInput = {
  name: string;
  price: number;
};

function ProductsInner() {
  const products = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () =>
      athena.from("products").select("id,name,price").limit(50),
  });

  const createProduct = useMutation<CreateProductInput, Product>({
    mutationFn: (input) =>
      athena.from("products").insert(input).select("id,name,price").single(),
    onSuccess: () => {
      void products.refetch();
    },
  });

  if (products.isLoading) return <div>Loading...</div>;
  if (products.error) return <div>{products.error.message}</div>;

  return (
    <div>
      <button
        onClick={() => {
          createProduct.mutate({ name: "New product", price: 99 });
        }}
      >
        Add Product
      </button>
      {products.data?.map((product) => (
        <div key={product.id}>
          {product.name} - {product.price}
        </div>
      ))}
    </div>
  );
}

export function Products() {
  return (
    <AthenaQueryClientProvider client={queryClient}>
      <ProductsInner />
    </AthenaQueryClientProvider>
  );
}
```

Available React APIs:

- `useAthenaGateway`: low-level gateway hook (`fetchGateway`, `insertGateway`, `updateGateway`, `deleteGateway`, `rpcGateway`) with request/response logging.
- `createAthenaQueryClient` + `AthenaQueryClientProvider`: Athena query runtime boundary for scoped state and subscriptions.
- `useQuery`: lightweight read lifecycle hook (`status`, `isFetching`, `refetch`, `reset`) with normalized Athena error/result handling.
- `useMutation`: lightweight write lifecycle hook (`mutate`, `mutateAsync`, `reset`) with manual refetch/invalidation flow.

By design this is not a cache-heavy React Query clone:

- No TanStack/React Query dependency.
- No persistent data cache by default (`cache.mode = "none"`).
- Inflight dedupe for identical query keys is enabled.
- Manual `refetch()` after mutations is the default invalidation strategy.

`test-sdk` includes runnable local examples for these hooks in
`test-sdk/examples/react-hooks`, where `queryFn`/`mutationFn` call Athena directly via `createClient(...).from(...).select()/insert()/eq()`.

`useAthenaGateway` example:

```tsx
import { useAthenaGateway } from "@xylex-group/athena/react";
import { useEffect } from "react";

export function UsersPanel() {
  const { fetchGateway, lastResponse, isLoading, error } = useAthenaGateway({
    baseUrl: "https://athena-db.com",
    apiKey: process.env.NEXT_PUBLIC_ATHENA_API_KEY,
  });

  useEffect(() => {
    void fetchGateway({
      table_name: "users",
      columns: ["id", "email"],
      limit: 25,
    });
  }, [fetchGateway]);

  if (error) return <div>Error: {error}</div>;
  if (isLoading) return <div>Loading…</div>;

  return <pre>{JSON.stringify(lastResponse?.data, null, 2)}</pre>;
}
```

`useAthenaGateway` config options mirror the client options: `baseUrl`, `apiKey`, `headers`, `userId`, `organizationId`, `publishEvent`.

## User context headers

Pass user and tenant context to every request without repeating it on each call:

```ts
const athena = createClient(
  "https://athena-db.com",
  process.env.ATHENA_API_KEY,
  {
    headers: {
      "X-User-Id": currentUser.id,
      "X-Organization-Id": currentUser.organizationId ?? "",
    },
  },
);
```

Or pass per-call via options. The Athena server interprets `url` and `key` based on the configured backend type.

## Custom headers

```ts
const athena = createClient(
  "https://athena-db.com",
  process.env.ATHENA_API_KEY,
  {
    headers: {
      "X-Custom-Header": "value",
    },
  },
);
```

Per-call headers are merged with the client-level headers, with per-call values winning on conflict.

The SDK also sends a standard identification header on every request:

- `X-Athena-Sdk: xylex-group/athena <version>`

## TypeScript

The package is written in TypeScript and ships declaration files. Pass a row type to `.from()` for fully-typed builder methods and results:

```ts
interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

const { data } = await athena
  .from<User>("users")
  .select("id, name")
  .eq("active", true);
// data is User[] | null
```

## Development Validation

For local quality checks:

```bash
pnpm typecheck   # compile-time type compatibility checks
pnpm check:all   # lint + typecheck + test + build
```

CI and publish workflows run `typecheck` before build/publish.

## Learn more

- [Documentation index](docs/index.md) — complete documentation map
- [Getting started](docs/getting-started.md) — step-by-step walkthrough
- [CLI command reference](docs/cli-command-reference.md) — all `athena-js` commands, help flows, and troubleshooting
- [Typed schema registry](docs/typed-schema-registry.md) — typed contracts and migration path
- [Generator config](docs/generator-config.md) — generator provider and output pipeline
- [Generator CI/CD](docs/generator-cicd.md) — pipeline patterns, secret mapping, retries, and branch policy
- [API reference](docs/api-reference.md) — complete method and type reference
