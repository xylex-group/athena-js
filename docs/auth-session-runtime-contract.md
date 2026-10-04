# Auth session runtime contract (4.0)

Canonical application session APIs for `@xylex-group/athena`.

## Types

| Layer | Type | Role |
| ----- | ---- | ---- |
| Transport / wire | `AthenaAuthSessionResponse` | Auth `get-session` JSON (`session`, `user`, `rights`, `grants`, and optional `authorization`) |
| Application | `AthenaSessionData` | Immutable snapshot preserving `session`, `user`, `rights`, `grants`, optional `authorization`, and adding `organization.activeId` / `rawActiveId` |

Never treat transport and app session as the same public type.
Normalization preserves validated authorization state while the organization scope remains the same. Supplied authorization snapshots are copied into immutable application snapshots.
If server-side organization resolution changes the active organization from the transport scope, the normalized snapshot omits authorization and exposes no rights until the caller reads a fresh session for that organization.
`x-session-data` authorization is accepted only when `GetServerSessionOptions.trustSessionDataHeader` is true and the caller guarantees the header came from trusted middleware; untrusted header authorization and rights are discarded.

## Server

- Session **lookup:** `@xylex-group/athena/next/session` (`getServerSession`)
- Composition root (still re-exports session helpers): `@xylex-group/athena/next/server`

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
- Resolver-managed upstream call budget hard max **3**: 0..1 session fetch,
  0..1 organization list, 0..1 setActive. A refresh nested inside `setActive`
  is a client mutation side effect and is not included in this metadata.

### Request credential continuity

`createServerSessionResolver` resolves one request authentication context per
session resolution. Client-backed organization repair forwards that context to
`organization.list` and `organization.setActive`. The `setActive` session
refresh receives the same call options. Cookies and bearer tokens are
forwarded, while session identity data and identity headers never become
authentication credentials.

The resolver does not mutate a root client. Request options stay local to the
resolution, which keeps concurrent repairs isolated. User-provided
`ensureActiveOrganization` callbacks remain unchanged.

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

Its `data` preserves transport `authorization`, `rights`, and legacy `grants` while adding organization context. The server and browser paths use the same `toSessionData` snapshot shape.

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
