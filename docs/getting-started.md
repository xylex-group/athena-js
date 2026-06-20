# Athena JS SDK - Getting Started

This guide takes you from an untyped runtime client to a typed registry workflow with stable write contracts.

If you only need immediate runtime usage, complete sections 1 to 7.
If you need team-wide type consistency, continue through sections 8 to 13.

## 1) Prerequisites

- Node.js 18+
- Athena gateway URL
- Athena API key

Environment names recognized by `AthenaClient.fromEnvironment()`:

- `ATHENA_URL` or `ATHENA_GATEWAY_URL`
- `ATHENA_API_KEY` or `ATHENA_GATEWAY_API_KEY`

## 2) Install

```bash
pnpm add @xylex-group/athena
```

React runtime support is optional and shipped from `@xylex-group/athena/react`.

## 3) Create your first client

### `createClient` (fastest)

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  client: "web-dashboard",
  backend: { type: "athena" },
});
```

### `AthenaClient.builder()` (explicit configuration)

```ts
import { AthenaClient, Backend } from "@xylex-group/athena";

const athena = AthenaClient.builder()
  .url(process.env.ATHENA_URL!)
  .key(process.env.ATHENA_API_KEY!)
  .backend(Backend.Athena)
  .client("web-dashboard")
  .headers({ "X-App-Region": "eu" })
  .auth({ baseUrl: process.env.ATHENA_AUTH_URL })
  .experimental({ traceQueries: true })
  .build();
```

You can also batch-apply `createClient`-style options in one call:

```ts
const athenaWithOptions = AthenaClient.builder()
  .url(process.env.ATHENA_URL!)
  .key(process.env.ATHENA_API_KEY!)
  .options({
    client: "web-dashboard",
    backend: Backend.Athena,
    headers: { "X-App-Region": "eu" },
    auth: { baseUrl: process.env.ATHENA_AUTH_URL },
    experimental: { traceQueries: true },
  })
  .build();
```

Builder output is a drop-in `createClient(...)` replacement:

- same runtime surface: `from`, `db`, `rpc`, `query`, `auth`
- same auth bindings/types under `client.auth.*`
- same `experimental` flags support (`traceQueries`, `debugAst`, `retryReads`, `findManyAst`, `typecheckColumns`) plus compatibility acceptance of deprecated `enableErrorNormalization`

Repeated fluent configuration calls compose:

- `headers(...)` + `options({ headers })` merge headers
- `auth(...)` + `options({ auth })` merge auth config and auth headers
- `experimental(...)` + `options({ experimental })` merge experimental flags

### Bind request context with `withSession(...)`

If you already have a base client and only need request-scoped session or tenant context, bind a new client instead of rebuilding `url`, `key`, `client`, and auth defaults yourself.

```ts
const athena = AthenaClient.fromEnvironment({
  client: "web-dashboard",
  auth: {
    credentials: "include",
  },
  experimental: {
    retryReads: true,
  },
});

const requestAthena = athena.withSession(session, {
  requestHeaders: request.headers,
  forceNoCache: true,
  headers: { "X-Workspace-Id": "ws_123" },
});
```

`withSession(...)`:

- derives `userId`, `organizationId`, `bearerToken`, `sessionToken`, and request cookies for you
- can still merge extra headers and force `Cache-Control: no-cache`
- keeps the original client immutable

Use `withContext(...)` when you already have raw values instead of a session object:

- binds `userId`, `organizationId`, auth tokens/cookies, extra headers, and `forceNoCache`
- can force `Cache-Control: no-cache` onto SDK-managed gateway, auth, and storage requests
- keeps the original client immutable

Use `withOptions(...)` only for advanced re-targeting such as overriding `url`, `key`, `client`, or service URLs.

Passing `client: "web-dashboard"` already emits `X-Athena-Client`; you do not need to add that header manually.

## 3.0) Optional auth context forwarding for gateway requests

If you want Athena server-side auth rollout to inspect auth context on normal query requests, the SDK can now bind auth state once and mirror it into gateway headers.

Forwarded/mirrored behavior:

- `headers.Cookie` with an Athena auth session cookie keeps the original `Cookie` header and also adds `X-Athena-Auth-Session-Token`
- `headers.Authorization: Bearer ...` keeps the original `Authorization` header and also adds `X-Athena-Auth-Bearer-Token`
- `createClient(..., { auth: { bearerToken } })` mirrors that token onto gateway/query requests as `X-Athena-Auth-Bearer-Token`

Server-side request-scoped auth context example:

```ts
const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  auth: {
    baseUrl: process.env.ATHENA_AUTH_URL!,
    cookie: request.headers.get("cookie") ?? "",
    bearerToken: session?.session?.token,
    sessionToken: session?.session?.token,
    credentials: "include",
  },
})
```

Client-wide bearer example:

```ts
const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  auth: {
    baseUrl: process.env.ATHENA_AUTH_URL,
    cookie: request.headers.get("cookie") ?? "",
    bearerToken: process.env.ATHENA_AUTH_BEARER_TOKEN,
  },
})
```

Per-call auth overrides still win, so impersonation or one-off credentials can be passed through `client.auth.*(..., { bearerToken, cookie, sessionToken })` or per-call gateway headers without rebuilding the whole client contract.

For precedence rules, browser/server caveats, and rollout guidance, see [`auth-session-forwarding.md`](auth-session-forwarding.md).

### `AthenaClient.fromEnvironment()` (ops-friendly)

```ts
import { AthenaClient } from "@xylex-group/athena";

const athena = AthenaClient.fromEnvironment({
  auth: {
    credentials: "include",
  },
});
```

It resolves common app/runtime aliases too, including `NEXT_PUBLIC_ATHENA_URL`, `NEXT_PUBLIC_ATHENA_API_KEY`, `NEXT_PUBLIC_ATHENA_CLIENT`, `ATHENA_GATEWAY_API_KEY`, `X_API_KEY`, and `NEXT_PUBLIC_ATHENA_AUTH_URL`.

## 3.1) Optional query tracing (experimental)

Use this when you need to inspect exactly what executed and where the call originated.

```ts
const athena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  experimental: {
    traceQueries: true,
  },
});
```

Every execution logs:

- operation type (`select`, `insert`, `upsert`, `update`, `delete`, `rpc`, `query`)
- endpoint and SQL text
- payload and options
- full outcome (`status`, `error`, `count`, `data`, `raw`)
- invocation callsite (`filePath`, `fileName`, `line`, `column`)

For deferred chains, that callsite is captured from the public Athena SDK seam that declared or finalized the operation and then reused for the eventual request. This keeps traces stable in CI and production even when async stack frames differ from local development.

Custom sink:

```ts
const tracedClient = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  experimental: {
    traceQueries: {
      logger(event) {
        observability.emit("athena.query.trace", event);
      },
    },
  },
});
```

If you also enable `experimental.debugAst`, each traced event includes a normalized operation AST and successful results expose the same AST through `getAthenaDebugAst(...)`:

```ts
import { createClient, getAthenaDebugAst } from "@xylex-group/athena";

const debugClient = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  experimental: {
    debugAst: true,
    traceQueries: true,
  },
});

const result = await debugClient.from("users").eq("id", 1).select("id");
const ast = getAthenaDebugAst(result);
```

The same helper also works for inserts, RPC reads, and raw SQL queries:

```ts
const inserted = await debugClient
  .from("users")
  .insert({ email: "ada@example.com" })
  .select("id,email");

const insertedAst = getAthenaDebugAst(inserted);

const rpcResult = await debugClient
  .rpc("list_users", { role: "admin" })
  .eq("active", true)
  .select("id,email");

const rpcAst = getAthenaDebugAst(rpcResult);

const sqlResult = await debugClient.query<{ id: number }>("select id from users where active = true");
const sqlAst = getAthenaDebugAst(sqlResult);
```

## 3.2) Optional read retries (experimental)

Use this when you want the SDK to automatically retry retryable read failures without wrapping each call manually.

```ts
const retryingClient = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  experimental: {
    retryReads: true,
  },
});
```

This applies to `select`, `findMany(...)`, and `query(...)`.

- Athena performs two additional attempts internally
- retry decisions follow the normalized `retryable` classification on failed results
- writes are intentionally excluded from this flag

## 3.3) Optional `findMany(...)` AST transport (experimental)

Use this only when your Athena gateway supports direct `findMany` AST bodies.

```ts
const astClient = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  experimental: {
    findManyAst: true,
  },
});

await astClient.from('orchestral_sections').findMany({
  select: {
    name: true,
    instruments: {
      select: {
        name: true,
      },
    },
  },
  limit: 10,
});
```

When enabled, clean `findMany(...)` calls send the original object AST to `/gateway/fetch`.
Legacy compiled transport remains the default and is still used when a chain already carries filters or pagination state that the direct AST body cannot express exactly yet.

## 3.3) Utility helpers from subpath exports

Use `@xylex-group/athena/utils` for runtime helpers that are intentionally not in the root package export.

```ts
import {
  asString,
  asBoolean,
  asBooleanOrNull,
  asRecord,
  asIdentifier,
  firstString,
  readTrimmedString,
  asNumber,
  asStringArray,
  slugify,
  trimTrailingSlashes,
  parseBooleanFlag,
  isLocalHostname,
  clearAuthCookies,
  proxyRequestHeaders,
  sqlText,
  escapeLikePatternValue,
  quoteSqlStringLiteral,
  sqlNullableText,
  sqlJsonbLiteral,
  sqlBigInt,
} from "@xylex-group/athena/utils";

const modelSlug = slugify("Internal User Sessions");
const normalizedBase = trimTrailingSlashes("https://api.example.com///");
const useNewAuthFlow = parseBooleanFlag(process.env.NEW_AUTH_FLOW, false);
const isEnabled = asBoolean('yes');
const maybeArchived = asBooleanOrNull('off');
const displayName = asString('  Athena  ');
const tenantId = asIdentifier(42);
const score = asNumber('12.5');
const tags = asStringArray([' alpha ', '', 'beta']);
const localHost = isLocalHostname("api.localhost");
const upstreamHeaders = proxyRequestHeaders(request);
const likePattern = escapeLikePatternValue('%admin_');
const emailLiteral = sqlText("user@example.com");
const exactLiteral = quoteSqlStringLiteral("Athena's SDK");
const deletedAtLiteral = sqlNullableText(null);
const metadataLiteral = sqlJsonbLiteral({ plan: "pro" });
const tenantIdLiteral = sqlBigInt(42);
```

`clearAuthCookies()` is browser-oriented and safely no-ops in server runtimes.
Use `identifier(...)` from the root package for SQL identifiers and `sqlText(...)`-style helpers for literal values.

## 4) Read data with table builders

```ts
type UserRow = {
  id: string;
  email: string;
  active: boolean;
  created_at: string;
};

const result = await athena.from<UserRow>("users").findMany({
  select: {
    id: true,
    email: true,
    active: true,
  },
  where: {
    active: true,
  },
  orderBy: {
    created_at: "desc",
  },
  limit: 25,
});

const labeled = await athena
  .from<UserRow>("users")
  .select("user_id:id, user_email:email");
```

Version baseline for the `findMany(...)` examples in this section: SDK `@xylex-group/athena` `2.4.0`, Athena server `3.12.3` verified on 2026-06-04.

### Important chain behavior

- `.findMany(...)` is the canonical eager read API for object-based selection trees.
- `.select(...)` returns a `SelectChain`, not a promise.
- `await` on the chain triggers execution.
- `.single(...)` and `.maybeSingle(...)` are read terminators.
- String column lists support response aliases with `customName:columnName`.

Nested relation trees can compile into the existing gateway select transport:

```ts
const sections = await athena.from("orchestral_sections").findMany({
  select: {
    name: true,
    instruments: {
      select: {
        name: true,
      },
    },
  },
});
```

For the full `findMany(...)` AST model, transport mapping, live Athena route examples, and server compatibility notes, read [`findmany-ast-and-server-contract.md`](findmany-ast-and-server-contract.md).
For the normalized method/state/payload models behind `select(...)`, mutations, `rpc(...)`, `query(...)`, and the fluent filter chain, read [`runtime-method-ast-models.md`](runtime-method-ast-models.md).

```ts
const one = await athena.from<UserRow>("users").eq("id", "u-1").single("id, email");
```

## 5) Filter, paging, and schema-qualified calls

```ts
const page = await athena
  .from<UserRow>("users")
  .select("id, email")
  .currentPage(2)
  .pageSize(50)
  .order("created_at", { ascending: false });

const usersInPublic = await athena
  .from<UserRow>("users")
  .select("id, email", { schema: "public" });

const usersInAuth = await athena
  .from<UserRow>("users", { schema: "auth" })
  .select("id, email");

const usersTable = table("users")
  .schema("athena")
  .columns({
    id: string(),
    email: string(),
    active: boolean(),
    created_at: string(),
  })
  .primaryKey("id");

const usersInAthena = await athena
  .from(usersTable)
  .select("id, email")
  .eq("active", true);

const strictAthena = createClient(process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  experimental: {
    typecheckColumns: true,
  },
});

await strictAthena
  .from(usersTable)
  .select("id, email")
  .order("created_at", { ascending: false });

// compile-time error in strict mode
strictAthena.from(usersTable).select("id, missing_column");

const authSubscriptions = await athena
  .from("chat_subscriptions", { schema: "private" })
  .findMany({
    select: {
      user_id: true,
      user: {
        schema: "athena",
        select: {
          id: true,
        },
      },
    },
  });
```

`experimental.typecheckColumns` is type-only. It validates simple string column
lists, array literals, and RPC filter/order column names when the SDK already
knows the row keys from `from<Table>()`, `from(model)`, `fromModel(...)`, or
`db.from<Row>(...)`. Typed `db.select<Row>(table)` still works for row-aware
result typing, but inline typed columns should go through
`db.from<Row>(table).select(...)`.

The `columns` string is comma-separated. To rename fields in the returned payload, use `customName:columnName`, for example:

```ts
const renamed = await athena
  .from<UserRow>("users")
  .select("user_id:id, user_email:email");
```

Filter operators include:

- `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
- `like`, `ilike`, `is`, `in`
- `contains`, `containedBy`
- `or`, `not`, `match`

`eq()` has UUID-aware behavior for identifier-like columns (`id`, `*_id`, `*uuid*`).

## 6) Writes and mutation contracts

### Insert

```ts
await athena
  .from<{ id: string; email: string }, { email: string }>("users")
  .insert({ email: "user@example.com" })
  .select("id, email");
```

### Update

```ts
await athena
  .from<{ id: string; email: string }, { email: string }, { email?: string }>("users")
  .eq("id", "u-1")
  .update({ email: "new@example.com" })
  .select("id, email");
```

### Upsert

```ts
await athena
  .from<{ id: string; email: string }, { id: string; email: string }, { email?: string }>("users")
  .upsert(
    { id: "u-1", email: "user@example.com" },
    {
      onConflict: "id",
      updateBody: { email: "user@example.com" },
    },
  )
  .select("id, email");
```

### Delete guardrail

Delete requires one of:

- `eq("id", ...)`
- `eq("resource_id", ...)`
- `delete({ resourceId: ... })`

If none is present, the SDK throws before network execution.

## 7) RPC and SQL query path

### RPC

```ts
const rpcResult = await athena
  .rpc<{ count: number }, { active_only: boolean }>("list_users", { active_only: true })
  .single("count");
```

### Raw query

```ts
const rows = await athena.query<{ id: string; email: string }>(
  "select id, email from users where active = true",
);
```

Use `query(...)` when the shape is hard to express through table/RPC builders.

## 8) Handle responses safely

Every operation resolves to `AthenaResult<T>`:

- `data`
- `error`
- `statusText`
- `errorDetails`
- `status`
- optional `count`
- `raw`

On failures, `error` is already a structured object with fields such as `message`, `code`, `details`, `hint`, `kind`, `table`, and `operation`.

Use helpers for strict service-layer handling:

```ts
import { isOk, unwrapRows, unwrapOne, requireAffected } from "@xylex-group/athena";

const list = await athena.from<{ id: string }>("users").select("id");
if (!isOk(list)) throw new Error(list.error?.message ?? "Unknown error");
const rows = unwrapRows(list);

const single = await athena.from<{ id: string }>("users").eq("id", "u-1").single("id");
const user = unwrapOne(single, { allowNull: true });

const inserted = await athena.from<{ id: string }, { email: string }>("users").insert({ email: "a@b.com" });
requireAffected(inserted, { min: 1 });
```

## 9) Move to typed model registry

Prefer `table(...).schema(...).columns(...).primaryKey(...)` for new model authoring. The `defineModel(...)` example below is a deprecated compatibility path that still works when you need legacy/manual contracts.

When runtime strings and payload types start drifting, define model contracts once and use `fromModel(...)`.

```ts
import {
  createTypedClient,
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from "@xylex-group/athena";

const users = defineModel<
  { id: string; email: string; created_at: string | null },
  { email: string },
  { email?: string }
>({
  meta: {
    primaryKey: ["id"],
    nullable: { id: false, email: false, created_at: true },
  },
});

const registry = defineRegistry({
  app: defineDatabase({
    public: defineSchema({ users }),
  }),
});

const typed = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!);

await typed
  .fromModel("app", "public", "users")
  .select("id, email")
  .eq("email", "user@example.com");
```

What this gives you:

- row typing on reads
- insert typing on `insert/upsert`
- update typing on `update/upsert({ updateBody })`
- filter column keys tied to known row keys

## 10) Tenant header propagation

Use `tenantKeyMap` once, then apply tenant values per request context.

```ts
const scopedClient = createTypedClient(registry, process.env.ATHENA_URL!, process.env.ATHENA_API_KEY!, {
  tenantKeyMap: {
    organizationId: "X-Organization-Id",
    workspaceId: "X-Workspace-Id",
  },
});

const tenantBound = scopedClient.withTenantContext({ organizationId: "org-1", workspaceId: "ws-4" });

await tenantBound.fromModel("app", "public", "users").select("id, email");
```

`withTenantContext(...)` returns a new client and merges context values.

Use `withContext(...)` alongside it when you need request-scoped `userId`, `organizationId`, `forceNoCache`, or extra headers without encoding them into `tenantKeyMap`.

## 11) Form contracts with Zod and React Hook Form

This is the practical path to collapse form/model drift:

1. keep `Insert` and `Update` types in your model contract
2. derive form values from schema validation
3. pass parsed values directly into typed builder methods

```ts
import { z } from "zod";
import type { InsertOf, UpdateOf } from "@xylex-group/athena";

const userCreateSchema = z.object({
  email: z.string().email(),
  active: z.boolean().default(true),
});

type UserModel = typeof registry.app.schemas.public.models.users;
type UserInsert = InsertOf<UserModel>;
type UserUpdate = UpdateOf<UserModel>;

function toInsert(input: unknown): UserInsert {
  return userCreateSchema.parse(input);
}

function toUpdate(input: unknown): UserUpdate {
  return userCreateSchema.partial().parse(input);
}
```

If you use React Hook Form:

- validate with Zod at submit boundaries
- map create form to `InsertOf<Model>`
- map patch form to `UpdateOf<Model>`

This keeps UI payloads aligned with model contracts instead of duplicating ad-hoc DTO interfaces.

## 12) Generate registry code from PostgreSQL

Use code generation when the database schema changes often.

```bash
athena-js generate
athena-js generate --dry-run
athena-js generate --config ./athena.config.ts
athena-js generate --help
```

If your env already has a direct Postgres URL, you can start without a config file:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run
```

If you only have Athena gateway credentials:

```bash
ATHENA_URL=https://athena-db.com ATHENA_API_KEY=secret ATHENA_GENERATOR_DB=app_db athena-js generate --dry-run
```

Smallest direct mode config:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
  },
});
```

Minimal direct mode config with explicit env helpers:

```ts
import { defineGeneratorConfig, generatorEnv } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL"),
    database: generatorEnv("ATHENA_GENERATOR_DB", { default: "app_db" }),
    schemas: generatorEnv.list("ATHENA_GENERATOR_SCHEMAS", {
      default: ["public", "athena"],
    }),
  },
  filter: {
    includeTables: generatorEnv.list("ATHENA_GENERATOR_TABLES", { optional: true }),
  },
  output: {
    preset: "athena-direct",
    targets: {
      model: "athena/models/{schema_kebab}/{model_kebab}.ts",
      schema: "athena/schemas/{schema_kebab}.ts",
      database: "athena/relations.ts",
      registry: "athena/registry.generated.ts",
    },
  },
});
```

Minimal gateway config:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "gateway",
  },
});
```

Minimal Zero-style table-builder config:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
  },
  output: {
    preset: "athena-direct",
    format: "table-builder",
  },
});
```

Use `mode: "gateway"` when CI or runners cannot open direct PostgreSQL connections.
Use `ATHENA_GENERATOR_TABLES` / `filter.includeTables` when you only need a
small subset of tables from a large schema.
For a large example pack covering zero-config runs, minimal files, table-builder output, and path overrides, see [`generator-quickstart.md`](generator-quickstart.md).
For full env-backed config patterns, fallback env keys, and connection string notes, see [`generator-config.md`](generator-config.md).

## 13) Production checklist

- Use typed `fromModel(...)` on domains with frequent schema changes.
- Keep write contracts explicit (`Insert` and `Update`) for business-critical models.
- Run `athena-js generate --dry-run` in CI before writing artifacts.
- Keep generated file paths schema-aware to avoid collisions.
- Guard all service-layer writes with `requireAffected(...)` when mutation cardinality matters.
- Prefer helper-based error normalization for API boundary consistency.

## 14) Where to go next

- [`typed-schema-registry.md`](typed-schema-registry.md)
- [`type-safety-playbook.md`](type-safety-playbook.md)
- [`generator-config.md`](generator-config.md)
- [`api-reference.md`](api-reference.md)
