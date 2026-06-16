# athena-js

current version: `2.7.0`
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

const { data, error } = await athenaClient.from("orchestral_sections").findMany({
  select: {
    name: true,
    instruments: {
      select: {
        name: true,
      },
    },
  },
});

if (error) {
  console.error("gateway error", error);
} else {
  console.table(data);
}
```

Example version baseline: SDK `@xylex-group/athena` `2.4.0`, Athena server `3.12.3` verified on 2026-06-04.

`.findMany({ select, where, orderBy, limit })` is the clean canonical read surface.
The existing string-based `.select(...)` chain remains fully supported for compatibility,
including alias/FK patterns like `from:sender_id(name)`.
For the full AST model, route contract, error behavior, and Athena server implications,
see [`docs/findmany-ast-and-server-contract.md`](docs/findmany-ast-and-server-contract.md).
For method-by-method runtime AST/state/payload models across `select(...)`, mutations,
`rpc(...)`, `query(...)`, and fluent builder filters, see
[`docs/runtime-method-ast-models.md`](docs/runtime-method-ast-models.md).

### Gateway auth-session forwarding

If you need Athena server-side auth rollout to inspect auth context on normal query requests, the SDK now mirrors available auth state into gateway headers while still forwarding the original headers too.

Current behavior:

- `headers.Cookie` containing an Athena auth session cookie keeps `Cookie` and also adds `X-Athena-Auth-Session-Token`
- `headers.Authorization: Bearer ...` keeps `Authorization` and also adds `X-Athena-Auth-Bearer-Token`
- `createClient(..., { auth: { bearerToken } })` mirrors that token onto gateway/query requests as `X-Athena-Auth-Bearer-Token`

Server-side cookie forwarding example:

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  headers: {
    Cookie: request.headers.get("cookie") ?? "",
  },
});
```

For the full contract, precedence rules, browser/server caveats, and rollout guidance, see [`docs/auth-session-forwarding.md`](docs/auth-session-forwarding.md).

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

#### React Email templates for admin HTML routes

If you use `@react-email/components`, you can pass component+props payloads directly on admin email/template routes:

```ts
import { Body, Html, Text } from "@react-email/components";

function WelcomeEmail(props: { name: string }) {
  return (
    <Html lang="en">
      <Body>
        <Text>Welcome {props.name}</Text>
      </Body>
    </Html>
  );
}

await athena.auth.admin.email.template.create({
  templateKey: "welcome",
  subjectTemplate: "Welcome",
  react: {
    component: WelcomeEmail,
    props: { name: "Ava" },
  },
});
```

For reusable templates, use `defineAuthEmailTemplate(...)`:

```ts
import { defineAuthEmailTemplate } from "@xylex-group/athena";

const welcomeTemplate = defineAuthEmailTemplate({
  component: WelcomeEmail,
  templateKey: "welcome",
  subjectTemplate: "Welcome",
});

await athena.auth.admin.email.template.create(
  welcomeTemplate.toTemplateCreate({
    props: { name: "Ava" },
  }),
);
```

You can also observe render timing/errors:

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  auth: {
    baseUrl: AUTH_BASE_URL,
    reactEmail: {
      observe: (event) => {
        console.log(JSON.stringify(event));
      },
    },
  },
});
```

Install support packages in your app:

```bash
pnpm add @react-email/components @react-email/render
```

Auth responses follow the same envelope style: `{ ok, status, data, error, errorDetails, raw }`.

#### Native auth bootstrap helpers

If you want to remove `better-auth` from an app that is already aligned to
Athena Auth session semantics, the SDK now ships a native bootstrap layer with
an Athena-native `athenaAuth({...})` export that matches the Better Auth
top-level contract:

```ts
import { athenaAuth } from "@xylex-group/athena";

export function getAuth(env: {
  DB: unknown;
  ATHENA_AUTH_URL: string;
  ATHENA_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}) {
  return athenaAuth({
    baseURL: env.ATHENA_AUTH_URL,
    secret: env.ATHENA_AUTH_SECRET,
    database: env.DB,
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        scope: ["repo", "read:org", "user:email"],
      },
    },
  });
}
```

The returned auth object now carries the Better Auth-style top-level contract:

- `handler(request)`
- `api`
- `options`
- `$context`
- `$ERROR_CODES`

This native layer currently covers:

- typed auth bootstrap config
- session cookie set/clear helpers via the SDK cookie primitives

It also supports dynamic `baseURL` host resolution plus static/dynamic
`trustedOrigins` and `trustedProviders` on the native server bootstrap.

For the full details and current scope, see [`docs/auth/server-bootstrap.mdx`](docs/auth/server-bootstrap.mdx).

### Typed schema registry (table-first)

You can keep `createClient(...).from<T>(...)` as-is, or opt into a typed registry with the new Zero-style table DSL:

```ts
import {
  boolean,
  createTypedClient,
  defineDatabase,
  defineRegistry,
  defineSchema,
  enumeration,
  json,
  string,
  table,
} from "@xylex-group/athena";

const users = table("users")
  .schema("public")
  .columns({
    id: string().generated(),
    email: string(),
    active: boolean().defaulted(),
    mood: enumeration(["happy", "sad"] as const).optional(),
    settings: json<{ theme: "light" | "dark" }>(),
  })
  .primaryKey("id");

const registry = defineRegistry({
  primary: defineDatabase({
    public: defineSchema({
      users,
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

const insert = users.schemas.form.parse({
  email: "ada@example.com",
  mood: "",
  settings: { theme: "light" },
});
```

You can also pass that native Athena table/model value directly into the root client to avoid repeating the string table target:

```ts
const result = await athena.from(users)
  .select("id, email, active")
  .eq("active", true)
  .order("created_at", { ascending: false })
  .limit(25);
```

This is the viable opt-in short form because the `users` value carries runtime target metadata. A generic-only call like `from<UserPublicSchema>()` cannot resolve a table at runtime after TypeScript erases types.

If you want compile-time validation for simple string selects and RPC column names, enable the experimental strict mode:

```ts
const strictAthena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  experimental: {
    typecheckColumns: true,
  },
});

await strictAthena.from(users).select("id, email").order("created_at");

// compile-time error
strictAthena.from(users).select("id, missing_column");
```

`defineModel(...)` remains fully supported for compatibility and manual contracts.

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

Out of the box, `athena-js generate` now works without an `athena.config.*` file in the common cases:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run
```

```bash
ATHENA_URL=https://athena-db.com ATHENA_API_KEY=secret ATHENA_GENERATOR_DB=app_db athena-js generate --dry-run
```

Smallest direct-mode config file:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
  },
});
```

Smallest table-builder config:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
  },
  output: {
    format: "table-builder",
  },
});
```

Common copy-paste starts:

```bash
# direct postgres, no config file
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run

# direct postgres + Zero-style output + multiple schemas
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db \
ATHENA_GENERATOR_OUTPUT_FORMAT=table-builder \
ATHENA_GENERATOR_SCHEMAS=public,analytics \
athena-js generate --dry-run

# gateway-only CI job, no config file
ATHENA_URL=https://athena-db.com \
ATHENA_API_KEY=secret \
ATHENA_GENERATOR_DB=app_db \
athena-js generate --dry-run
```

Smallest gateway table-builder config:

```ts
import { defineGeneratorConfig } from "@xylex-group/athena";

export default defineGeneratorConfig({
  provider: {
    kind: "postgres",
    mode: "gateway",
  },
  output: {
    format: "table-builder",
  },
});
```

Generator supports:

- PostgreSQL direct introspection (`provider.mode = "direct"`, `provider.connectionString` from your `PG_URL`/`DATABASE_URL`)
- PostgreSQL gateway-only introspection (`provider.mode = "gateway"` via Athena `POST /gateway/query`)
- Multiple schema syncs such as `public` plus `athena`, with schema-safe default output paths
- Two output formats: legacy `define-model` artifacts (default) or the new Zero-style `table-builder` format via `output.format`
- Placeholder-driven output paths
- Feature flags (`features.emitRegistry`, `features.emitRelations`)
- Typed env-backed config fields via `generatorEnv(...)` for connection strings, schema lists, naming styles, flags, and placeholder maps

For copy-paste quickstarts and more example profiles, see [`docs/generator-quickstart.md`](./docs/generator-quickstart.md).
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

Every query resolves to `{ data, error, errorDetails?, status, statusText?, count?, raw }`. `data` is `null` on error; `error` is `null` on success.

Failed results now include a structured `error` object with the useful fields inline:

- `message`
- `code`
- `details`
- `hint`
- `status`
- `statusText`
- normalized metadata such as `kind`, `table`, `operation`, and `retryable`

`errorDetails` is still present as a compatibility alias for low-level gateway metadata (`gatewayCode`, `endpoint`, `method`, `requestId`, etc.).

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

### Structured errors by default

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(ATHENA_URL, ATHENA_API_KEY);

const { data, error, status, statusText } = await athena.from("users").insert({ id: 1 }).select();
if (error) {
  console.error(error);
  console.error(error.hint ?? error.message, status, statusText);
  if (error.kind === "unique_violation") {
    // deterministic conflict handling
  }
}
```

`result.error` already carries normalized `kind` values (`unique_violation`, `validation`, `auth`, `rate_limit`, `transient`, etc.) plus operation metadata.

`normalizeAthenaError(...)` is deprecated. Prefer `result.error` on failed results and the structured fields already attached to thrown SDK errors.

### Query tracing (experimental)

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  experimental: { traceQueries: true, debugAst: true },
});
```

With `traceQueries: true`, the SDK logs every runtime execution (`select`, `insert`, `upsert`, `update`, `delete`, `rpc`, `query`) and includes:

- the gateway endpoint used
- synthesized SQL (or raw SQL for `query(...)` and SQL fallback reads)
- payload and call options
- full outcome (`status`, `error`, `count`, `data`, `raw`)
- callsite metadata (`filePath`, `fileName`, `line`, `column`)

For deferred chains, Athena captures that callsite from the public SDK seam that declared or finalized the operation and reuses it for the eventual network execution. That keeps traces pinned to user code instead of drifting into SDK internals when async stack shapes differ between local runs and CI.

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

If you also enable `debugAst: true`, every traced operation includes a normalized AST, and successful results expose the same AST through `getAthenaDebugAst(...)`:

```ts
import { createClient, getAthenaDebugAst } from "@xylex-group/athena";

const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  experimental: {
    debugAst: true,
  },
});

const result = await athena.from("users").eq("id", 1).select("id");
const ast = getAthenaDebugAst(result);
```

This works across the runtime operation families too:

```ts
const inserted = await athena
  .from("users")
  .insert({ email: "ada@example.com" })
  .select("id,email");

const insertedAst = getAthenaDebugAst(inserted);

const rpcResult = await athena
  .rpc("list_users", { role: "admin" })
  .eq("active", true)
  .select("id,email");

const rpcAst = getAthenaDebugAst(rpcResult);

const sqlResult = await athena.query<{ id: number }>("select id from users where active = true");
const sqlAst = getAthenaDebugAst(sqlResult);
```

If `traceQueries` is enabled too, the same normalized AST is emitted on each `AthenaQueryTraceEvent.ast`.

### Read retries (experimental)

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  experimental: {
    retryReads: true,
  },
});
```

With `retryReads: true`, the SDK automatically retries retryable read failures for `select`, `findMany(...)`, and `query(...)`.

- two additional attempts are applied internally
- retry classification follows the SDK's normalized `retryable` signal
- writes (`insert`, `upsert`, `update`, `delete`) are not retried by this flag

### findMany AST transport (experimental)

```ts
const athena = createClient(ATHENA_URL, ATHENA_API_KEY, {
  experimental: {
    findManyAst: true,
  },
});
```

With `findManyAst: true`, clean `findMany(...)` calls can send an AST-style body to `/gateway/fetch` instead of compiling the select tree down to `columns` and `conditions` first.

- this is opt-in and meant for gateways that explicitly support direct AST bodies
- existing compiled `findMany(...)` transport remains the default
- shorthand `where` filters are normalized to explicit operator objects before the AST body is sent
- UUID-like equality filters that need the SDK's `::text` comparison still fall back to the legacy query/compiled path
- nested relation select strings stay off the SQL query fallback path and continue through `/gateway/fetch`
- chained builder filters or pagination state that the AST body cannot represent losslessly yet continue to use the legacy compiled path
- trace output still includes synthesized SQL so diagnostics stay readable

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
```

Examples:

```ts
const slug = slugify("Customer Success / Q4 Report"); // customer-success-q4-report
const local = isLocalHostname("api.localhost"); // true
const normalized = trimTrailingSlashes("https://example.com///"); // https://example.com
const enabled = parseBooleanFlag(process.env.FEATURE_FLAG, false);
const count = asNumber("42"); // 42
const label = asString("  ready "); // ready
const active = asBooleanOrNull("yes"); // true
const tags = asStringArray([" alpha ", "", "beta"]); // ["alpha", "beta"]
const likePattern = escapeLikePatternValue("%admin_"); // \%admin\_

// Browser-only helper (safe no-op on server runtimes)
clearAuthCookies();

// Preserve forwarded headers when proxying auth requests
const upstreamHeaders = proxyRequestHeaders(request);

// Safely embed raw SQL values when using athena.query(...)
const emailLiteral = sqlText("floris@example.com");
const metadataLiteral = sqlJsonbLiteral({ role: "admin" });
const actorIdLiteral = sqlBigInt(42);
const exactLiteral = quoteSqlStringLiteral("Athena's SDK");
```

`clearAuthCookies()` clears cookies matching Athena/Better Auth prefixes (`athena-auth`, `__Secure-athena-auth`, `better-auth`, `__Secure-better-auth`) and also attempts parent-domain cleanup for subdomain deployments.
For SQL identifiers, keep using `identifier(...)`; `sqlText(...)`-style helpers are for literal values only.

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

Use `schema` either on `from(...)` itself or in table call options to qualify unqualified table names:

```ts
const { data } = await athena
  .from("users", { schema: "public" })
  .select("id,email");

const { data: sameTarget } = await athena
  .from("users")
  .select("id,email", { schema: "public" });

const { data: crossSchema } = await athena
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

Both resolve the table target to `public.users`.

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
