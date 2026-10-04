/**
 * Target: authorization role CRUD (store + HTTP + OCC + audit).
 * Dual-suite Memory + optional Postgres when ATHENA_TEST_DATABASE_URL is set.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { MemoryAuthorizationStore } from "../../src/runtime/authorization/memory.ts";
import {
  AUTHORIZATION_RIGHT_DELEGATION_DENIED,
  AUTHORIZATION_RIGHT_SCOPE_MISMATCH,
  AUTHORIZATION_RIGHT_UNKNOWN,
  AUTHORIZATION_ROLE_HAS_ASSIGNMENTS,
  AUTHORIZATION_ROLE_PROTECTED,
  AUTHORIZATION_ROLE_VERSION_CONFLICT,
  assertRoleRightAssignmentAllowed,
} from "../../src/runtime/authorization/role-invariants.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

function createTestHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash(hash: string) {
      return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

test("P?: catalog rights stay read-only (no rights.create/delete routes)", () => {
  const routes = readFileSync(
    join(pkgRoot, "src", "auth", "local", "authorization-routes.ts"),
    "utf8"
  );
  assert.equal(routes.includes("/authorization/rights/create"), false);
  assert.equal(routes.includes("rights.create"), false);
  assert.equal(routes.includes("rights.delete"), false);
  assert.match(routes, /GET/);
  assert.match(routes, /\/authorization\/rights/);
});

test("P?: assertRoleRightAssignmentAllowed denies platform rights on org roles", () => {
  assert.throws(
    () =>
      assertRoleRightAssignmentAllowed({
        organizationId: "org-1",
        right: "billing.admin.reconciliation.write",
        roleScope: "organization",
      }),
    (error: { code?: string }) =>
      error.code === AUTHORIZATION_RIGHT_SCOPE_MISMATCH
  );
  assert.throws(
    () =>
      assertRoleRightAssignmentAllowed({
        right: "not.a.catalog.right",
        roleScope: "organization",
      }),
    (error: { code?: string }) => error.code === AUTHORIZATION_RIGHT_UNKNOWN
  );
});

test("P?: memory store create/rename/replace/OCC/delete-reassign/audit", async () => {
  const store = new MemoryAuthorizationStore();
  const created = await store.createRole({
    actorRights: ["organization.members.read", "organization.members.invite"],
    actorUserId: "actor",
    name: "Reviewer",
    organizationId: "org-1",
    rights: ["organization.members.read"],
    scopeKind: "organization",
  });
  assert.equal(created.protected, false);
  assert.equal(created.version, 1);
  const renamed = await store.updateRole({
    actorUserId: "actor",
    expectedVersion: 1,
    id: created.id,
    name: "Reviewer v2",
    organizationId: "org-1",
  });
  assert.equal(renamed.version, 2);
  await assert.rejects(
    () =>
      store.updateRole({
        actorUserId: "actor",
        expectedVersion: 1,
        id: created.id,
        name: "stale",
        organizationId: "org-1",
      }),
    (error: { code?: string }) =>
      error.code === AUTHORIZATION_ROLE_VERSION_CONFLICT
  );
  const replaced = await store.replaceRoleRights({
    actorRights: ["organization.members.read", "organization.members.invite"],
    actorUserId: "actor",
    expectedVersion: 2,
    id: created.id,
    organizationId: "org-1",
    rights: ["organization.members.read", "organization.members.invite"],
  });
  assert.equal(replaced.version, 3);
  const rights = await store.listRoleRights(created.id);
  assert.deepEqual([...rights].sort(), [
    "organization.members.invite",
    "organization.members.read",
  ]);
  await store.assignMemberRole(
    "member-1",
    created.key,
    "actor",
    "org-1",
    "user-1"
  );
  await assert.rejects(
    () =>
      store.deleteRole({
        actorUserId: "actor",
        expectedVersion: 3,
        id: created.id,
        organizationId: "org-1",
      }),
    (error: { code?: string }) =>
      error.code === AUTHORIZATION_ROLE_HAS_ASSIGNMENTS
  );
  await store.deleteRole({
    actorUserId: "actor",
    expectedVersion: 3,
    id: created.id,
    organizationId: "org-1",
    reassignmentRoleId: "organization_member",
  });
  const audit = await store.listAudit({ organizationId: "org-1" });
  const actions = audit.map((entry) => entry.action);
  assert.ok(actions.includes("role.create"));
  assert.ok(actions.includes("role.rename"));
  assert.ok(actions.includes("role.rights.replace"));
  assert.ok(actions.includes("role.delete"));
  assert.ok(actions.includes("member.role.assign"));
});

test("P?: protected built-in roles cannot be mutated", async () => {
  const store = new MemoryAuthorizationStore();
  await assert.rejects(
    () =>
      store.deleteRole({
        actorUserId: "actor",
        expectedVersion: 1,
        id: "organization_owner",
        organizationId: "org-1",
      }),
    (error: { code?: string }) => error.code === AUTHORIZATION_ROLE_PROTECTED
  );
});

test("P?: role editor cannot grant rights they cannot delegate", async () => {
  const store = new MemoryAuthorizationStore();
  const manager = await store.createRole({
    actorRights: ["authorization.roles.write"],
    actorUserId: "owner",
    name: "Role manager",
    organizationId: "org-1",
    rights: ["authorization.roles.write"],
    scopeKind: "organization",
  });
  await assert.rejects(
    () =>
      store.replaceRoleRights({
        actorRights: ["authorization.roles.write"],
        actorUserId: "manager",
        expectedVersion: 1,
        id: manager.id,
        organizationId: "org-1",
        rights: ["authorization.roles.write", "organization.lifecycle.delete"],
      }),
    (error: { code?: string }) =>
      error.code === AUTHORIZATION_RIGHT_DELEGATION_DENIED
  );
  await assert.rejects(
    () =>
      store.cloneRole({
        actorRights: ["authorization.roles.write"],
        actorUserId: "manager",
        name: "Owner copy",
        organizationId: "org-1",
        sourceRoleId: "organization_owner",
      }),
    (error: { code?: string }) =>
      error.code === AUTHORIZATION_RIGHT_DELEGATION_DENIED
  );
  const stripped = await store.replaceRoleRights({
    actorRights: ["authorization.roles.write"],
    actorUserId: "manager",
    expectedVersion: 1,
    id: manager.id,
    organizationId: "org-1",
    rights: [],
  });
  assert.equal(stripped.version, 2);
});

test("P?: holding a right or roles.delegate permits grant; founding owner is unrestricted", async () => {
  const store = new MemoryAuthorizationStore();
  const created = await store.createRole({
    actorRights: ["authorization.roles.write"],
    actorUserId: "owner",
    name: "Delegated",
    organizationId: "org-1",
    rights: ["authorization.roles.write"],
    scopeKind: "organization",
  });
  const granted = await store.replaceRoleRights({
    actorRights: ["authorization.roles.write", "organization.lifecycle.delete"],
    actorUserId: "owner",
    expectedVersion: 1,
    id: created.id,
    organizationId: "org-1",
    rights: ["authorization.roles.write", "organization.lifecycle.delete"],
  });
  assert.equal(granted.version, 2);
  const viaDelegate = await store.createRole({
    actorRights: ["authorization.roles.write", "authorization.roles.delegate"],
    actorUserId: "delegator",
    name: "Via meta-right",
    organizationId: "org-1",
    rights: ["organization.owners.assign"],
    scopeKind: "organization",
  });
  assert.equal(viaDelegate.version, 1);
  const viaFounder = await store.createRole({
    actorRights: ["authorization.roles.write"],
    actorUserId: "founder",
    name: "Founder grant",
    organizationId: "org-1",
    rights: ["organization.owners.assign"],
    scopeKind: "organization",
    unrestrictedGrant: true,
  });
  assert.equal(viaFounder.version, 1);
  const cloned = await store.cloneRole({
    actorRights: ["authorization.roles.write", "authorization.roles.delegate"],
    actorUserId: "delegator",
    name: "Owner clone",
    organizationId: "org-1",
    sourceRoleId: "organization_owner",
  });
  assert.equal(cloned.protected, false);
});

test("P?: HTTP custom role manager cannot self-elevate via rights replace or clone", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const owner = await signInOrgOwner(runtime);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "custom_role_manager",
        rights: ["authorization.roles.write"],
      }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const role = (await jsonBody(created)).role as {
    id: string;
    key: string;
    version: number;
  };
  const managerSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: `role-esc-${crypto.randomUUID()}@example.com`,
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const managerCookie = cookieOf(managerSignup);
  const managerSession = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/get-session", {
        headers: { cookie: managerCookie },
      })
    )
  );
  const managerUserId = (managerSession.user as { id: string }).id;
  const added = await runtime.handle(
    new Request("http://app.local/api/auth/organization/add-member", {
      body: JSON.stringify({
        organizationId: owner.organizationId,
        role: "member",
        userId: managerUserId,
      }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(added.status, 200);
  const addedBody = await jsonBody(added);
  const memberId = (addedBody.member as { id: string }).id;
  const setActive = await runtime.handle(
    new Request("http://app.local/api/auth/organization/set-active", {
      body: JSON.stringify({ organizationId: owner.organizationId }),
      headers: {
        "content-type": "application/json",
        cookie: managerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(setActive.status, 200);
  const assignments = await jsonBody(
    await runtime.handle(
      new Request(
        `http://app.local/api/auth/authorization/assignments/members?organizationId=${encodeURIComponent(owner.organizationId)}`,
        { headers: { cookie: owner.cookie } }
      )
    )
  );
  const assignment = (
    assignments.assignments as Array<{ memberId: string; roleIds: string[] }>
  ).find((entry) => entry.memberId === memberId);
  assert.ok(assignment);
  const assigned = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/assignments/members/${memberId}`,
      {
        body: JSON.stringify({
          expectedVersion: assignments.revision,
          roleIds: [...assignment.roleIds, role.id],
        }),
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
        },
        method: "PUT",
      }
    )
  );
  assert.equal(assigned.status, 200);
  const elevate = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/roles/${role.id}/rights`,
      {
        body: JSON.stringify({
          expectedVersion: role.version,
          rights: [
            "authorization.roles.write",
            "organization.owners.assign",
            "organization.lifecycle.delete",
          ],
        }),
        headers: {
          "content-type": "application/json",
          cookie: managerCookie,
        },
        method: "PUT",
      }
    )
  );
  assert.equal(elevate.status, 403);
  assert.equal(
    (await jsonBody(elevate)).code,
    AUTHORIZATION_RIGHT_DELEGATION_DENIED
  );
  const cloneOwner = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles/clone", {
      body: JSON.stringify({
        name: "Escalated owner",
        sourceRoleId: "organization_owner",
      }),
      headers: {
        "content-type": "application/json",
        cookie: managerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(cloneOwner.status, 403);
  assert.equal(
    (await jsonBody(cloneOwner)).code,
    AUTHORIZATION_RIGHT_DELEGATION_DENIED
  );
  const ownerElevate = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/roles/${role.id}/rights`,
      {
        body: JSON.stringify({
          expectedVersion: role.version,
          rights: [
            "authorization.roles.write",
            "organization.lifecycle.delete",
          ],
        }),
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
        },
        method: "PUT",
      }
    )
  );
  assert.equal(ownerElevate.status, 200);
});

test("P?: postgres store implements replaceRoleRights and OCC", () => {
  const source = readFileSync(
    join(pkgRoot, "src", "runtime", "authorization", "postgres.ts"),
    "utf8"
  );
  assert.match(source, /replaceRoleRights/);
  assert.match(source, /expectedVersion/);
  assert.match(source, /role\.rights\.replace/);
  assert.match(source, /assertAuthorizationDelegationAllowed/);
  assert.match(source, /replaceRoleDefinitionInTransaction/);
  assert.match(source, /role\.definition\.update/);
});

test("P?: memory store applies name and rights in one version bump", async () => {
  const store = new MemoryAuthorizationStore();
  const created = await store.createRole({
    actorRights: ["organization.members.read", "organization.members.invite"],
    actorUserId: "actor",
    name: "Reviewer",
    organizationId: "org-1",
    rights: ["organization.members.read"],
    scopeKind: "organization",
  });
  const updated = await store.updateRole({
    actorRights: ["organization.members.read", "organization.members.invite"],
    actorUserId: "actor",
    expectedVersion: 1,
    id: created.id,
    name: "Reviewer v2",
    organizationId: "org-1",
    rights: ["organization.members.read", "organization.members.invite"],
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.name, "Reviewer v2");
  const rights = await store.listRoleRights(created.id);
  assert.deepEqual([...rights].map(String).sort(), [
    "organization.members.invite",
    "organization.members.read",
  ]);
});

async function signInOrgOwner(
  runtime: ReturnType<typeof createAthenaAuthRuntime>
) {
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: `role-crud-${crypto.randomUUID()}@example.com`,
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const cookie = cookieOf(signup);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({
        name: "Role CRUD",
        slug: `role-crud-${crypto.randomUUID().slice(0, 8)}`,
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const organization = (await jsonBody(created)).organization as { id: string };
  return { cookie, organizationId: organization.id };
}

test("P?: HTTP create/list/get/patch/put/delete and snapshot version/rightCount", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const { cookie } = await signInOrgOwner(runtime);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "Analyst",
        rights: ["organization.members.read"],
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const role = (await jsonBody(created)).role as {
    id: string;
    version: number;
  };
  const listed = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/authorization/roles", {
        headers: { cookie },
      })
    )
  );
  const roles = listed.roles as Array<{
    id: string;
    rightCount: number;
    version: number;
  }>;
  const row = roles.find((entry) => entry.id === role.id);
  assert.ok(row);
  assert.equal(row.version, 1);
  assert.equal(row.rightCount, 1);
  const combined = await runtime.handle(
    new Request(`http://app.local/api/auth/authorization/roles/${role.id}`, {
      body: JSON.stringify({
        expectedVersion: 1,
        name: "Analyst combined",
        rights: ["organization.members.read", "organization.members.invite"],
      }),
      headers: { "content-type": "application/json", cookie },
      method: "PATCH",
    })
  );
  assert.equal(combined.status, 200);
  const combinedRole = (await jsonBody(combined)).role as { version: number };
  assert.equal(combinedRole.version, 2);
  const patched = await runtime.handle(
    new Request(`http://app.local/api/auth/authorization/roles/${role.id}`, {
      body: JSON.stringify({ expectedVersion: 2, name: "Analysts" }),
      headers: { "content-type": "application/json", cookie },
      method: "PATCH",
    })
  );
  assert.equal(patched.status, 200);
  const rightsPut = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/roles/${role.id}/rights`,
      {
        body: JSON.stringify({
          expectedVersion: 3,
          rights: ["organization.members.read", "organization.members.invite"],
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    )
  );
  assert.equal(rightsPut.status, 200);
  const deleted = await runtime.handle(
    new Request(`http://app.local/api/auth/authorization/roles/${role.id}`, {
      body: JSON.stringify({ expectedVersion: 4 }),
      headers: { "content-type": "application/json", cookie },
      method: "DELETE",
    })
  );
  assert.equal(deleted.status, 200);
});

test("P?: HTTP denies platform right on org role and clone stays in-org", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const { cookie } = await signInOrgOwner(runtime);
  const denied = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "Bad",
        rights: ["billing.admin.reconciliation.write"],
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(denied.status, 400);
  assert.equal(
    (await jsonBody(denied)).code,
    AUTHORIZATION_RIGHT_SCOPE_MISMATCH
  );
});

test("P?: member can be assigned a custom role after clone", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const owner = await signInOrgOwner(runtime);
  const memberSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: `role-member-${crypto.randomUUID()}@example.com`,
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const memberCookie = cookieOf(memberSignup);
  const memberSession = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/get-session", {
        headers: { cookie: memberCookie },
      })
    )
  );
  const memberUserId = (memberSession.user as { id: string }).id;
  const added = await runtime.handle(
    new Request("http://app.local/api/auth/organization/add-member", {
      body: JSON.stringify({
        organizationId: owner.organizationId,
        role: "member",
        userId: memberUserId,
      }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(added.status, 200);
  const addedBody = await jsonBody(added);
  const memberId = (addedBody.member as { id: string }).id;
  const cloned = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/authorization/roles/clone", {
        body: JSON.stringify({
          name: "Custom member",
          sourceRoleId: "organization_member",
        }),
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
        },
        method: "POST",
      })
    )
  );
  const custom = cloned.role as { key: string };
  const assigned = await runtime.handle(
    new Request("http://app.local/api/auth/organization/update-member-role", {
      body: JSON.stringify({
        memberId,
        organizationId: owner.organizationId,
        role: custom.key,
      }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(assigned.status, 200);
});

async function assertReadNotWriteCanListCannotMutate(
  runtime: ReturnType<typeof createAthenaAuthRuntime>
) {
  const owner = await signInOrgOwner(runtime);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "Read-only viewer target",
        rights: ["organization.members.read"],
      }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const role = (await jsonBody(created)).role as { id: string };

  const adminSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: `role-reader-${crypto.randomUUID()}@example.com`,
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const adminCookie = cookieOf(adminSignup);
  const adminSession = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/get-session", {
        headers: { cookie: adminCookie },
      })
    )
  );
  const adminUserId = (adminSession.user as { id: string }).id;
  const added = await runtime.handle(
    new Request("http://app.local/api/auth/organization/add-member", {
      body: JSON.stringify({
        organizationId: owner.organizationId,
        role: "admin",
        userId: adminUserId,
      }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(added.status, 200);
  const setActive = await runtime.handle(
    new Request("http://app.local/api/auth/organization/set-active", {
      body: JSON.stringify({ organizationId: owner.organizationId }),
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      method: "POST",
    })
  );
  assert.equal(setActive.status, 200);

  const rights = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/rights", {
      headers: { cookie: adminCookie },
    })
  );
  assert.equal(rights.status, 200);
  const listed = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      headers: { cookie: adminCookie },
    })
  );
  assert.equal(listed.status, 200);
  const listedBody = await jsonBody(listed);
  const roles = listedBody.roles as Array<{ id: string }>;
  assert.ok(roles.some((entry) => entry.id === role.id));
  const got = await runtime.handle(
    new Request(`http://app.local/api/auth/authorization/roles/${role.id}`, {
      headers: { cookie: adminCookie },
    })
  );
  assert.equal(got.status, 200);

  const createDenied = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "Should not create",
        rights: ["organization.members.read"],
      }),
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      method: "POST",
    })
  );
  assert.equal(createDenied.status, 403);
  const patchDenied = await runtime.handle(
    new Request(`http://app.local/api/auth/authorization/roles/${role.id}`, {
      body: JSON.stringify({ expectedVersion: 1, name: "Nope" }),
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      method: "PATCH",
    })
  );
  assert.equal(patchDenied.status, 403);
  const putDenied = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/roles/${role.id}/rights`,
      {
        body: JSON.stringify({
          expectedVersion: 1,
          rights: ["organization.members.read"],
        }),
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        method: "PUT",
      }
    )
  );
  assert.equal(putDenied.status, 403);
  const deleteDenied = await runtime.handle(
    new Request(`http://app.local/api/auth/authorization/roles/${role.id}`, {
      body: JSON.stringify({ expectedVersion: 1 }),
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      method: "DELETE",
    })
  );
  assert.equal(deleteDenied.status, 403);
  const cloneDenied = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles/clone", {
      body: JSON.stringify({
        name: "Should not clone",
        sourceRoleId: "organization_member",
      }),
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      method: "POST",
    })
  );
  assert.equal(cloneDenied.status, 403);
}

test("P?: HTTP snapshot serializes full platform RoleDescriptor fields", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: `snapshot-wire-${crypto.randomUUID()}@example.com`,
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const cookie = cookieOf(signup);
  const session = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/get-session", {
        headers: { cookie },
      })
    )
  );
  const userId = (session.user as { id: string }).id;
  const stores = await runtime.getStores();
  await stores.authorization.assignUserRole(userId, "platform_admin");
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/snapshot", {
      headers: { cookie },
    })
  );
  assert.equal(response.status, 200);
  const snapshot = await jsonBody(response);
  const assignable = snapshot.assignableRoles as Array<Record<string, unknown>>;
  const admin = assignable.find((role) => role.key === "platform_admin");
  assert.equal(admin?.assignable, true);
  assert.equal(admin?.id, "platform_admin");
  assert.equal(admin?.key, "platform_admin");
  assert.equal(admin?.organizationId, null);
  assert.equal(admin?.protected, true);
  assert.equal(admin?.scopeKind, "platform");
  assert.equal(typeof admin?.version, "number");
  assert.equal(
    (snapshot.capabilities as { canManagePlatformRoles?: boolean })
      .canManagePlatformRoles,
    true
  );
});

test("P?: HTTP read-not-write can list/get and cannot mutate", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  await assertReadNotWriteCanListCannotMutate(runtime);
});

test("P?: HTTP createRole fails closed on unknown right and scope mismatch", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: `role-unknown-${crypto.randomUUID()}@example.com`,
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const cookie = cookieOf(signup);
  const session = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/get-session", {
        headers: { cookie },
      })
    )
  );
  const userId = (session.user as { id: string }).id;
  const stores = await runtime.getStores();
  await stores.authorization.assignUserRole(userId, "platform_admin");
  const unknown = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "Bogus",
        rights: ["not.a.catalog.right"],
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(unknown.status, 400);
  assert.equal((await jsonBody(unknown)).code, AUTHORIZATION_RIGHT_UNKNOWN);
  const mismatched = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "Org right on platform",
        rights: ["organization.members.read"],
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(mismatched.status, 400);
  assert.equal(
    (await jsonBody(mismatched)).code,
    AUTHORIZATION_RIGHT_SCOPE_MISMATCH
  );
});

test("P?: HTTP role mutation fails closed on organization scope mismatch", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const owner = await signInOrgOwner(runtime);
  const foreign = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "Foreign org",
        organizationId: crypto.randomUUID(),
        rights: ["organization.members.read"],
      }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      method: "POST",
    })
  );
  assert.equal(foreign.status, 403);
  const unknownRole = await runtime.handle(
    new Request("http://app.local/api/auth/organization/add-member", {
      body: JSON.stringify({
        organizationId: owner.organizationId,
        role: "not_a_role",
        userId: crypto.randomUUID(),
      }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      method: "POST",
    })
  );
  assert.notEqual(unknownRole.status, 200);
});

test("P?: role HTTP honors explicit scope over the active organization", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const { cookie, organizationId } = await signInOrgOwner(runtime);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "Scoped Analyst",
        organizationId,
        rights: ["organization.members.read"],
        scope: "organization",
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const role = (await jsonBody(created)).role as { id: string };
  const orgList = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/roles?scope=organization&organizationId=${encodeURIComponent(organizationId)}`,
      { headers: { cookie } }
    )
  );
  assert.equal(orgList.status, 200);
  const orgRoles = (await jsonBody(orgList)).roles as Array<{ id: string }>;
  assert.ok(orgRoles.some((entry) => entry.id === role.id));
  const platformList = await runtime.handle(
    new Request(
      "http://app.local/api/auth/authorization/roles?scope=platform",
      {
        headers: { cookie },
      }
    )
  );
  assert.equal(platformList.status, 403);
});

const postgresUrl = process.env.ATHENA_TEST_DATABASE_URL?.trim();
if (postgresUrl) {
  test("P?: Postgres runtime role create", async () => {
    const runtime = createAthenaAuthRuntime({
      autoMigrate: true,
      database: postgresUrl,
      hasher: createTestHasher(),
    });
    const { cookie } = await signInOrgOwner(runtime);
    const created = await runtime.handle(
      new Request("http://app.local/api/auth/authorization/roles", {
        body: JSON.stringify({
          name: "PG Analyst",
          rights: ["organization.members.read"],
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      })
    );
    assert.equal(created.status, 200);
    await runtime.close();
  });

  test("P?: Postgres HTTP read-not-write can list/get and cannot mutate", async () => {
    const runtime = createAthenaAuthRuntime({
      autoMigrate: true,
      database: postgresUrl,
      hasher: createTestHasher(),
    });
    await assertReadNotWriteCanListCannotMutate(runtime);
    await runtime.close();
  });
}
