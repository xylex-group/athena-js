# Column typing in Athena JS 3

`typecheckColumns` was removed in Athena JS 3. It was a type-only boolean that multiplied client and builder identities without changing runtime behavior.

Column safety now derives automatically from model values, configured registries, and explicit row types:

```ts
const athena = createClient({ url, key, models: registry })
const users = registry.app.schemas.public.models.users

await athena.from(users).select('id,email')
```

Unknown model columns fail TypeScript compilation. Dynamic callers can use a client without a closed registry and provide a row type explicitly.

There is no runtime option, strict client alias, or capability-specific return type.
