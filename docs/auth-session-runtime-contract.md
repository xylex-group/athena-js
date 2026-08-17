# Auth session runtime contract (4.0)

Canonical application session APIs for `@xylex-group/athena`.

## Types

| Layer | Type | Role |
| ----- | ---- | ---- |
| Transport / wire | `AthenaAuthSessionResponse` | Auth `get-session` JSON (`session` + `user`) |
| Application | `AthenaSessionData` | Immutable snapshot with `organization.activeId` / `rawActiveId` |

Never treat transport and app session as the same public type.

## Server (`@xylex-group/athena/next/server`)

### `getServerSession(options?) → GetServerSessionResult`

Discriminated result (**always** includes `meta`):

```ts
| { ok: true; authenticated: true; data: AthenaSessionData; error: null; meta }
| { ok: true; authenticated: false; data: null; error: null; meta }
| { ok: false; authenticated: false; data: null; error: AthenaAuthErrorDetails; meta }
```

- Upstream / protocol / configuration failures are `ok: false` — **not** logged-out.
- Logged-out is only `ok: true && authenticated: false`.

### Helpers

| Helper | Behavior |
| ------ | -------- |
| `getServerSessionOrNull` | `null` **only** when unauthenticated; **throws** on `!ok` |
| `requireServerSession` | returns `AthenaSessionData` or throws typed session errors |
| `createServerSessionResolver({ client, ... })` | returns `{ getSession, getSessionOrNull, requireSession }` (object, not callable) |

### Organization policy

```ts
organization: {
  ensureActive: true | {
    persist: boolean;
    strategy?: "first-accessible" | (({ organizations }) => string | null);
    onEmpty?: "allow-null" | "error";
  }
}
// or injectable ensureActiveOrganization: { list, setActive, persist?, onEmpty? }
```

- No silent `setActive` without `ensureActive` / injectables.
- `onEmpty: "error"` → `ATHENA_SESSION_NO_ACCESSIBLE_ORGANIZATION`.
- Upstream call budget hard max **3**: 0..1 session fetch, 0..1 organization list, 0..1 setActive.

### Errors

Thrown helpers use `toAthenaSessionError` →:

- `AthenaUnauthenticatedError`
- `AthenaAuthUpstreamError`
- `AthenaAuthConfigurationError`
- `AthenaAuthProtocolError`
- `AthenaSessionOrganizationError`

`AbortError` / `TimeoutError` are rethrown unchanged from fetch.

## React (`@xylex-group/athena/react`)

`useSession(client)` returns:

- `data: AthenaSessionData | null`
- derived: `isAuthenticated`, `user`, `session`, `organization`, `organizationId`
- status: `isPending`, `isRefetching`, `error`, `refetch`

Browser path: `organization.activeId === organization.rawActiveId` (no server repair).
Concurrent default `getSession` calls are deduped in-process per getter.

### Session data header

- missing header → normal get-session fetch fallback
- present valid header → use it (no fetch)
- present invalid header → protocol failure (no fetch fallback)


### Organization consistency

ensureActive uses at most one list and one setActive. Concurrent requests that both
repair a missing active org are **last-write-wins** at the auth upstream; this package
does not re-fetch session after setActive.

### React lifecycle follow-up

useSession ignores Abort/Timeout and uses per-hook request IDs. A shared
session-generation / invalidation token (sign-out races across hooks) is deferred
until multi-hook measurement / Speedrun migration — not part of 4.0.0-rc.0 public API.

## Migration (3.x → 4.0)

| 3.x | 4.0 |
| --- | --- |
| `result.userId` / `result.session` flat fields | `result.data.user` / `result.data.session` when `ok && authenticated` |
| `result.fromSessionDataHeader` | `result.meta.fromSessionDataHeader` |
| `result.organizationId` | `result.data.organization.activeId` |
| `result.didEnsureActiveOrganization` | `result.meta.organizationResolution?.repaired` |
| fetch failure → null-ish session | `ok: false` with `error` |
| OrNull as soft fail | OrNull throws on `!ok` |

## Rollback

1. Pin consumers to `@xylex-group/athena@3.7.x`.
2. Do not mix 3.x flat `GetServerSessionResult` readers with 4.x packages.
3. Program B (Speedrun dual-core removal) only after this RC is published and validated.

## Version

Package target: **4.0.0** (prerelease `4.0.0-rc.0` first).
