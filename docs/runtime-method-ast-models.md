# Athena JS 3 runtime and AST model

Athena JS 3 has one construction AST and one client identity.

```ts
const client = createClient({
  key,
  client: "formations",
  db: { url: dbUrl, pgUri },
  auth: { url: authUrl },
  chat: { url: chatUrl, wsUrl: chatWsUrl },
  storage: { url: storageUrl, directUpload },
  models,
  retryReads: true,
  traceQueries: false,
  debugAst: false,
  findManyAst: false,
})
```

## Immutable core

The core owns normalized service routes, transports, backend selection, API key, model registry, retry policy, tracing, and AST-debug behavior. Every client exposes stable `db`, `auth`, `chat`, and `storage` namespaces. An unroutable namespace fails at operation time with `AthenaConfigurationError` and code `ATHENA_SERVICE_NOT_CONFIGURED`.

## Context views

`withContext(context)` creates a lightweight view that shares the normalized core and adds request context. It does not retarget services, rebuild the public client type, or introduce a capability-specific return type.

## Query AST

`from`, `rpc`, and `query` retain their domain-specific builder ASTs. Model-derived table and column types are inferred from `models`; explicit row types remain available for dynamic callers. There is no strictness generic or runtime typing flag.

`findManyAst` is a stable top-level compatibility option. It controls only the documented direct-AST transport behavior and does not change client identity.

## Runtime neutrality

The default and browser conditional exports expose the same `createClient(config)` declaration contract. Runtime-specific behavior is supplied through configuration such as `chat.webSocketFactory`, `storage.directUpload`, request context, and the package export condition—not through different constructors.
