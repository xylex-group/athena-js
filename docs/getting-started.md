# Getting started with athena-js

Athena is a database driver and API gateway SDK. Create a client and the builder lets you read and mutate rows with optional filtering and pagination.

## 1. Install

```bash
npm install @xylex-group/athena
```

## 2. Create a client

```ts
import { createClient } from "@xylex-group/athena";

const athena = createClient(
  "https://athena-db.com",
  process.env.ATHENA_API_KEY,
);

const { data, error } = await athena
  .from("users")
  .select("id, name, email")
  .eq("is_active", true)
  .limit(25);

if (error) throw new Error(error);
console.table(data);
```

## 3. Create and update rows

```ts
const { data: inserted } = await athena
  .from("users")
  .insert({ name: "Bilbo" })
  .select("id, name");

const { data: updated } = await athena
  .from("users")
  .update({ name: "Bilbo Baggins" })
  .eq("id", inserted?.[0]?.id ?? 0)
  .select();

await athena
  .from("users")
  .upsert(
    { id: 1, name: "Bilbo" },
    { updateBody: { name: "Bilbo Baggins" }, onConflict: "id" },
  )
  .select("id, name");
```

## 4. Filters & pagination

You can chain filters and modifiers to narrow results:

```ts
const { data: page2 } = await athena
  .from("users")
  .select("id, email")
  .contains("roles", ["admin"])
  .or("status.eq.active,status.eq.suspended")
  .range(10, 19);
```

## 5. React

Use the hook for client-side calls with loading and error state:

```tsx
import { useAthenaGateway } from "athena-js";
```

See the [API reference](api-reference.md) for full options.
