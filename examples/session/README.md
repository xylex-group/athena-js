# Session examples (useSession + server + bridge)

Copy-paste surfaces for the **canonical session stack** in `@xylex-group/athena`.

| File | API | Use when |
| --- | --- | --- |
| [session-snapshot.ts](./session-snapshot.ts) | `toSessionData`, `deriveSessionView` | Normalize transport → `AthenaSessionData` |
| [use-session-panel.tsx](./use-session-panel.tsx) | `useSession` | Client Components / Better Auth–style hook |
| [use-athena-session-client-panel.tsx](./use-athena-session-client-panel.tsx) | `useAthenaSessionClient` | Auto `withContext` from session |
| [server-session.ts](./server-session.ts) | `getServerSession`, `createServerSessionResolver` | RSC / route handlers / middleware data |
| [session-bridge.ts](./session-bridge.ts) | session cookie bridge | Auth origin ≠ app origin |

## Quick client

```tsx
import { createClient } from '@xylex-group/athena'
import { SessionStatusPanel } from './use-session-panel'

const athena = createClient({
  url: process.env.NEXT_PUBLIC_ATHENA_URL!,
  key: process.env.NEXT_PUBLIC_ATHENA_API_KEY,
  auth: { url: process.env.NEXT_PUBLIC_ATHENA_AUTH_URL ?? '/api/auth' },
})

export default function AccountPage() {
  return <SessionStatusPanel authClient={athena} />
}
```

## Quick server

```ts
import { createClient } from '@xylex-group/athena'
import { createExampleServerSessionResolver } from './server-session'

const athena = createClient({ url, key, auth: { url } })
const session = createExampleServerSessionResolver(athena)

export async function loadAccount() {
  const data = await session.require()
  return data.user
}
```

## Anti-stale tests

These modules are imported by package tests so renames/export drift fail CI:

```bash
pnpm test -- test/examples-session.test.ts
```

Docs: [auth-session-bridge.md](../../docs/auth-session-bridge.md) · [auth-session-runtime-contract.md](../../docs/auth-session-runtime-contract.md)
