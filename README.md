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

Use `select`, `insert`, `update`, and `delete` just like Supabase. The builder supports `.eq()`, `.match()`, `.limit()`, `.offset()`, and `.single()` / `.maybeSingle()`.

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
