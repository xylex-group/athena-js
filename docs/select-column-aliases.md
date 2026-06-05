# Select Column Aliases

This page covers the response alias syntax supported by Athena JS column lists.

Use this when you want the returned payload to use app-facing field names without changing the underlying database column names.

## 1) Core syntax

The `columns` argument accepts a comma-separated string.

To rename a returned field, use:

```ts
customName:columnName
```

Example:

```ts
const { data, error } = await athena
  .from("users")
  .select("user_id:id, user_email:email, createdAt:created_at");
```

Returned row shape:

```ts
{
  user_id: "u_1",
  user_email: "user@example.com",
  createdAt: "2026-06-03T12:00:00Z"
}
```

## 2) Comma-separated string form

The most common form is a single string:

```ts
const result = await athena
  .from("users")
  .select("user_id:id, user_email:email, user_name:name");
```

This works alongside normal unaliased columns:

```ts
const result = await athena
  .from("users")
  .select("user_id:id, email, name");
```

## 3) Array form

If you prefer array-based column lists, the same alias form works there too:

```ts
const result = await athena
  .from("users")
  .select(["user_id:id", "user_email:email", "createdAt:created_at"]);
```

## 4) Schema-qualified columns

Aliases can target schema-qualified or table-qualified column references. The base table can be
qualified either in `from(...)` or inside the alias expression itself:

```ts
const result = await athena
  .from("users", { schema: "public" })
  .select("user_id:id, user_email:email");

const explicitQualifiedResult = await athena
  .from("public.users")
  .select("user_id:public.users.id, user_email:public.users.email");
```

This is useful when the SDK falls back to synthesized SQL for quoting or cast-aware comparisons.

## 5) Where this works

The same `columns` contract is used anywhere Athena JS accepts a column list, including:

- `.from(...).select(...)`
- `.single(...)`
- `.maybeSingle(...)`
- mutation `.select(...)`
- mutation `.returning(...)`
- `.rpc(...).select(...)`

Examples:

```ts
await athena.from("users").insert({ email: "a@b.com" }).select("user_id:id, user_email:email");

await athena.from("users").eq("id", "u_1").single("user_id:id, user_email:email");

await athena.rpc("list_users").select("user_id:id, user_email:email");
```

## 6) Relation to SQL `AS`

Athena JS also preserves simple SQL-style aliases in column lists:

```ts
await athena.from("users").select("id as user_id, email as user_email");
```

For SDK-level docs and examples, prefer `customName:columnName` because it is shorter and matches the runtime contract directly.

## 7) When not to use this

Use `customName:columnName` for simple identifier-to-identifier renames.

If you need complex SQL expressions, function calls, or computed projections, pass the raw expression yourself:

```ts
await athena
  .from("users")
  .select("concat(first_name, ' ', last_name) as full_name, email");
```

Complex expressions are preserved as written instead of being auto-rewritten by the SDK.

## 8) Practical guidance

- Use aliases when your API payload naming should differ from the database.
- Keep alias names stable across your app to avoid unnecessary mapper layers.
- Prefer generated model types for storage contracts, then alias only at the query edge when shaping UI/API responses.

## 9) Related pages

- [`getting-started.md`](getting-started.md) for runtime query examples
- [`api-reference.md`](api-reference.md) for exact method signatures
- [`typed-schema-registry.md`](typed-schema-registry.md) if you also need model-driven typing
