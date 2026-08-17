# Athena JS examples

Runnable / copy-paste samples for `@xylex-group/athena`.

| Area | Location | Covers |
| --- | --- | --- |
| **Cloudflare Workers (complete)** | [cloudflare/](./cloudflare/README.md) | Modes 01–04, L0/L1 CRUD 05–13, R2 14, hybrid auth 15, capabilities 16, `withContext` tenant 17 + unified [app.ts](./cloudflare/app.ts) |
| **Session stack (useSession + server + bridge)** | [session/](./session/README.md) | `toSessionData`, `deriveSessionView`, `useSession`, `useAthenaSessionClient`, `getServerSession` / resolver, cookie bridge — **CI-tested** |
| **Node gateway client** | [node/create-client.ts](./node/create-client.ts) | Root `createClient`, `from().select()`, `query`, `rpc` |
| **Auth session (Node)** | [node/auth-session.ts](./node/auth-session.ts) | `auth.getSession`, cookie/bearer forwarding |
| **Billing** | [node/billing.ts](./node/billing.ts) | `createClient(...).billing` live helpers |
| **Storage** | [node/storage.ts](./node/storage.ts) | Managed file / object helpers (gateway) |
| **Admin permission** | [node/admin-permission.ts](./node/admin-permission.ts) | `@xylex-group/athena/admin` |
| **Env helpers** | [node/env.ts](./node/env.ts) | `@xylex-group/athena/env` / `requireEnv` |
| **React hooks** | [../test-sdk/examples/react-hooks](../test-sdk/examples/react-hooks/README.md) | `useQuery` / `useMutation` style panels |
| **Next adapters** | [../test-sdk/examples/next/adapters.ts](../test-sdk/examples/next/adapters.ts) | browser + server client factories |
| **Generator** | [../test-sdk/examples/generator](../test-sdk/examples/generator/README.md) | full generator utilization |

## Cloudflare: prefer the unified Worker

```bash
# from packages/athena-js
pnpm typecheck:examples
# point wrangler main at examples/cloudflare/app.ts — GET / lists every route ↔ example #
```

Single-concern snippets stay in `cloudflare/01-…` through `cloudflare/17-…`.

## Session examples (CI-guarded)

```bash
pnpm example:session          # typecheck examples/session
pnpm test -- test/examples-session.test.ts
```

## Node samples

```bash
# requires ATHENA_URL (+ ATHENA_API_KEY where needed)
pnpm example:node
pnpm example:auth-session
pnpm example:billing
pnpm example:storage
pnpm example:admin
pnpm example:env
```

Docs: [docs/getting-started.md](../docs/getting-started.md) · [docs/cloudflare-edge-local.md](../docs/cloudflare-edge-local.md)
