# Migration: session API 3.x → 4.0

See full contract: [auth-session-runtime-contract.md](./auth-session-runtime-contract.md).

## Breaking changes

1. **`getServerSession` result shape** is a discriminated union with `ok` / `authenticated` / `data` / `error` / `meta`.
2. **Application session type** is `AthenaSessionData` (not raw `AthenaAuthSessionResponse`).
3. **`getServerSessionOrNull`** is not a no-throw helper — it throws on upstream/protocol/config failure.
4. **Public net**: prefer `getServerSession`, `getServerSessionOrNull`, `requireServerSession`, `createServerSessionResolver`, `useSession`.

## Codemod sketch

```ts
// before
const s = await getServerSession(opts);
if (!s.session) redirect("/login");
const org = s.organizationId;

// after
const s = await getServerSession(opts);
if (!s.ok) throw s.error; // or map to your error UI
if (!s.authenticated) redirect("/login");
const org = s.data.organization.activeId;
```

Protected routes:

```ts
const data = await requireServerSession(opts);
// data: AthenaSessionData
```

## Speedrun (Program B)

Defer dual-core removal until `@xylex-group/athena@4.0.0-rc` is consumed in a branch.
Use `test/fixtures/speedrun-session-consumer` as the API shape reference.

## Known deferred (post-RC / Speedrun)

- **Shared session generation / sign-out invalidation** across multiple useSession mounts is not in 4.0.0-rc.0. Per-hook request IDs ignore Abort/Timeout only; a store-level generation token remains a follow-up.
- **ensureActiveOrganization** is intentionally **last-write-wins** (max one list + one setActive; no post-setActive session recheck). Concurrent repairs may race at the auth upstream.

