# athena-js

`@xylex-group/athena` is a database driver and API gateway SDK that lets you interact with SQL backends over HTTP through a fluent builder API.

## Gateway query builder

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(
  "https://athena-db.com",
  process.env.ATHENA_API_KEY,
);

const { data, error } = await athena.from("characters").select(`
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

The builder exposes `select`, `insert`, `update`, `delete`, and `upsert`, along with shared helpers such as `.eq()`, `.match()`, `.range()`, `.gt()`, `.ilike()`, `.contains()`, `.not()`, and `.or()`. Filters, modifiers, and mutation chaining all follow the same fluent pattern.

### Filters & modifiers

Filters accumulate on the builder, so you can stack conditions before executing the query:

```ts
const { data } = await athena
  .from("characters")
  .select("id, name")
  .gt("level", 5)
  .lte("created_at", "2024-01-01")
  .contains("tags", ["hero"])
  .range(0, 49);
```

Modifiers such as `.limit()`, `.offset()`, `.range()`, and `.match()` adjust pagination and filtering. Athena automatically applies `strip_nulls`, `count`, `head`, and `defaultToNull` when passed through the builder options.

### Mutations

Mutation methods return a `MutationQuery`, so you can call `.select()`, `.single()`, `.returning()`, `.then()`, `.catch()`, or `.finally()` after mutating rows:

```ts
const { data: inserted } = await athena
  .from("countries")
  .insert({ id: 1, name: "Mordor" })
  .select("id, name");

const { data: updated } = await athena
  .from("countries")
  .update({ name: "Gondor" })
  .eq("id", 1)
  .select();

const { data: upserted } = await athena
  .from("countries")
  .upsert({ id: 2, name: "Rohan" }, { updateBody: { name: "Rohan" }, onConflict: "id" })
  .select();
```

Insert and upsert calls accept options such as `defaultToNull`, `count`, `head`, `onConflict`, and `updateBody`. Delete operations accept `.eq()` filters or an explicit `options.resourceId` value.

## React hook

```tsx
"use client";

import { useAthenaGateway } from "athena-js/react";
import { useEffect } from "react";

export function UsersPanel() {
  const { fetchGateway, lastResponse, isLoading, error } = useAthenaGateway({
    baseUrl: "https://athena-db.com",
    apiKey: process.env.NEXT_PUBLIC_ATHENA_API_KEY,
  });

  useEffect(() => {
    fetchGateway({
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

## Learn more

- [API reference](docs/api-reference.md)
- [Getting started](docs/getting-started.md)
