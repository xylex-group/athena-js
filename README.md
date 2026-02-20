# athena-js

Athena is a database driver + API gateway SDK that lets you interact with SQL backends using the familiar `supabase-js` syntax.

## Gateway query builder

```ts
import { createClient } from "athena-js";

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

Use `select`, `insert`, `update`, `delete`, and `upsert` just like Supabase. The builder now exposes Supabase-style helpers such as `.range()`, `.gt()`, `.lt()`, `.ilike()`, `.contains()`, `.not()`, `.or()`, and `.maybeSingle()` so existing Supabase code runs without changes.

### Filters & modifiers

Filters are cumulative and stack on the query builder:

```ts
const { data } = await athena
  .from('characters')
  .select('id, name')
  .gt('level', 5)
  .lte('created_at', '2024-01-01')
  .contains('tags', ['hero'])
  .range(0, 49)
```

Modifiers like `.limit()`, `.offset()`, `.range()`, and `.match()` behave the same as in Supabase. The fetch call automatically sends `strip_nulls`, `count`, `head`, and `defaultToNull` options when provided.

### Mutations

Mutation methods return a Supabase-compatible `MutationQuery` so you can chain `.select()`, `.single()`, and `.returning()` after invoking them:

```ts
const { data: inserted, error } = await athena
  .from('countries')
  .insert({ id: 1, name: 'Mordor' })
  .select('id, name')

const { data: updated } = await athena
  .from('countries')
  .update({ name: 'Gondor' })
  .eq('id', 1)
  .select()

const { data: upserted } = await athena
  .from('countries')
  .upsert({ id: 2, name: 'Rohan' }, { updateBody: { name: 'Rohan' }, onConflict: 'id' })
  .select()
```

Insert and upsert calls accept Supabase-compatible options such as `defaultToNull`, `count`, `head`, and `onConflict`. Delete operations allow filtering by `.eq()` or by passing `options.resourceId` as in Supabase.

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
