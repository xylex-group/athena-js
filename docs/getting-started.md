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

## 3. React

Use the hook for client-side calls with loading and error state:

```tsx
import { useAthenaGateway } from "athena-js";
```

See the [API reference](api-reference.md) for full options.
