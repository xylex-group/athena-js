# Getting started with athena-js

Athena is a database driver API gateway SDK. Use the Supabase-style client to query structured data over HTTP.

## 1. Install

```bash
npm install athena-js
```

## 2. Create a client

```ts
import { createClient } from "athena-js";

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

## 2. Insert & upsert

```ts
const { data: inserted } = await athena
  .from("users")
  .insert({ name: "Bilbo" })
  .select("id, name")

const { data: updated } = await athena
  .from("users")
  .update({ name: "Bilbo Baggins" })
  .eq("id", inserted?.[0]?.id ?? 0)
  .select()

// Supabase-style upsert with conflict resolution
await athena
  .from("users")
  .upsert(
    { id: 1, name: "Bilbo" },
    { updateBody: { name: "Bilbo Baggins" }, onConflict: "id" },
  )
  .select("id, name")
```

## 3. Filters & pagination

Use dot-chain helpers exactly as in Supabase:

```ts
const { data: page2 } = await athena
  .from("users")
  .select("id, email")
  .contains("roles", ["admin"])
  .or("status.eq.active,status.eq.suspended")
  .range(10, 19)
```

## 4. React

Use the hook for client-side calls with loading and error state:

```tsx
import { useAthenaGateway } from "athena-js";
```

See the [API reference](api-reference.md) for full options.
