# Organization membership patterns

How to list orgs and verify membership with Athena Auth bindings versus the
gateway `member` table.

## Mental model

| Goal | API | Scope |
|------|-----|--------|
| Orgs for the **signed-in** user | `auth.organization.list()` | Session principal only |
| Is **current** session in org X? | `list()` + check `id`, or active member / permissions | Session principal |
| Orgs for an **arbitrary** `userId` | Gateway `.from("member").eq("user_id", …)` | Needs gateway access to membership rows |
| Is user U in org O? (admin/jobs) | Gateway member query | Not parameterized on auth `list()` |

There is **no** `auth.user.organization.list(userId)`.

Route map: [`auth/organization.mdx`](auth/organization.mdx),
[`auth/organization-members.mdx`](auth/organization-members.mdx).

---

## Current user org IDs

```ts
const { data, error } = await athena.auth.organization.list()
if (error) {
  // handle
  return []
}
const orgIds = (data ?? []).map((org) => org.id).filter(Boolean)
```

Returns full organization objects for the **current session** (`GET /organization/list`).

### Arbitrary user (keep gateway)

```ts
const { data, error } = await athena
  .from<{ organization_id: string | null }>("member")
  .eq("user_id", userId)
  .select("organization_id", { schema: "athena", stripNulls: false })

const orgIds = (data ?? [])
  .map((row) => row.organization_id)
  .filter((id): id is string => Boolean(id))
```

Use this for admin tooling, background jobs, or any path without that user’s
session on the auth client.

---

## Verify membership

### Session user in org

```ts
const { data } = await athena.auth.organization.list()
const isMember = (data ?? []).some((org) => org.id === organizationId)
```

Related (different semantics):

| Call | Meaning |
|------|---------|
| `organization.member.getActive()` | Active org membership for current session only |
| `organization.hasPermission(...)` | Permission check, not bare membership |
| `organization.member.list(...)` | Members of an org (heavier; needs access) |

### Arbitrary user + org

```ts
const { data, error } = await athena
  .from<{ id: string }>("member")
  .eq("user_id", userId)
  .eq("organization_id", organizationId)
  .limit(1)
  .select("id", { schema: "athena", stripNulls: false })

const ok = !error && Array.isArray(data) && data.length > 0
```

Do **not** invent `auth.organization.member.verify({ userId, organizationId })`
without a real auth route — that would break the binding = route contract.

---

## App helpers to keep local

Pure shaping (not Athena domain):

```ts
function normalizeOrganizationIds(orgIds: string[]): { id: string }[] {
  return [
    ...new Set(
      orgIds.map((id) => id.trim()).filter((id) => id.length > 0),
    ),
  ].map((id) => ({ id }))
}
```

Fine as app code. Prefer `auth.organization.list()` when the source of IDs is
the current session.

---

## Ensure active organization (session bootstrap)

Framework-agnostic helper (same behavior as the speedrun-formations package).
**Additive** — apps inject list/set-active; the helper never throws.

```ts
import { ensureActiveOrganization } from "@xylex-group/athena/organization"
// or: import { ensureActiveOrganization } from "@xylex-group/athena"

const { activeOrganizationId, didSetActiveOrganization } =
  await ensureActiveOrganization({
    session,
    listOrganizations: async () => {
      const { data } = await athena.auth.organization.list()
      return data ?? []
    },
    setActiveOrganization: async organizationId => {
      await athena.auth.organization.setActive({ organizationId })
    },
    // optional product policy:
    // selectOrganizationId: orgs => resolveFormationsOrganizationId(orgs),
  })
```

## Admin role vs org membership

```ts
import { hasAdminRole } from "@xylex-group/athena/admin"

hasAdminRole(session) // global user.role contains "admin"
```

That is **not** the same as organization membership or org-level permissions.
Use `organization.hasPermission` / `requirePermission` for org RBAC.

---

## See also

- [`utils-and-helpers.md`](utils-and-helpers.md) — shared SDK helpers  
- [`typecheck-columns.md`](typecheck-columns.md) — typing `member` queries  
- Auth bindings: [`auth/organization.mdx`](auth/organization.mdx)
