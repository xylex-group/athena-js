/**
 * Target: Postgres-backed assignment + AuthorizationSnapshot.
 * GREEN after Phases 1–6. See
 * docs/sdd/xylex/athena-js-authorization-assignment/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { ATHENA_AUTHORIZATION_CONSTRAINTS_SQL } from "../../src/auth/local/authorization-sql.ts";
import {
  GRANT_HIGHER_ROLE_FORBIDDEN,
  LAST_OWNER_LEAVE_FORBIDDEN,
} from "../../src/auth/local/organization-invariants.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { BILLING_OPERATION_RIGHTS } from "../../src/billing/runtime/rights.ts";
import { capabilitiesFromRights } from "../../src/runtime/authorization/capabilities.ts";
import {
  assertBillingOperationsReferenceCatalog,
  BILLING_PAYMENTS_READ,
} from "../../src/runtime/authorization/catalog.ts";
import { MemoryAuthorizationStore } from "../../src/runtime/authorization/memory.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  mapLegacyMemberRole,
  mapLegacyUserRole,
  ORGANIZATION_ADMIN_ROLE,
  ORGANIZATION_MEMBER_ROLE,
  ORGANIZATION_OWNER_ROLE,
  PLATFORM_CUSTOMER_ROLE,
} from "../../src/runtime/authorization/templates.ts";
import { isPrivilegedHttpDataResource } from "../../src/runtime/data/privileged-http-models.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const nextMinimalRoot = join(
  pkgRoot,
  "..",
  "athena-auth-ui",
  "examples",
  "next-minimal",
  "src",
  "lib",
  "athena",
  "root.ts"
);

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(next));
      continue;
    }
    out.push(next);
  }
  return out;
}

test("P?: authorization assignment SQL exists", () => {
  const sqlFiles = [
    join(srcRoot, "auth", "local", "authorization-sql.ts"),
    join(srcRoot, "auth", "local", "schema.ts"),
  ];
  const combined = sqlFiles
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.match(combined, /athena\.authorization_roles/);
});

test("P?: AthenaAuthorizationStore exists", () => {
  assert.equal(
    existsSync(join(srcRoot, "runtime", "authorization", "store.ts")),
    true
  );
  assert.match(
    readFileSync(join(srcRoot, "runtime", "authorization", "store.ts"), "utf8"),
    /AthenaAuthorizationStore/
  );
});

test("P?: AuthorizationSnapshot type exists", () => {
  const source = readFileSync(
    join(srcRoot, "runtime", "authorization", "types.ts"),
    "utf8"
  );
  assert.match(source, /AuthorizationSnapshot/);
  assert.match(source, /effectiveRights/);
  assert.match(source, /capabilities/);
});

test("P?: next-minimal has no rightsByRole", () => {
  const source = readFileSync(nextMinimalRoot, "utf8");
  assert.equal(source.includes("rightsByRole"), false);
});

test("P?: no AuthorizationManager", () => {
  const resolution = readFileSync(
    join(srcRoot, "runtime", "data", "rights-resolution.ts"),
    "utf8"
  );
  assert.equal(resolution.includes("AuthorizationManager"), false);
});

test("P?: no NATIVE_RIGHTS dump", () => {
  const key = readFileSync(join(srcRoot, "rights", "key.ts"), "utf8");
  assert.equal(key.includes("NATIVE_RIGHTS"), false);
});

test("P?: BILLING_OPERATION_RIGHTS still maps operations to dialect rights", () => {
  const required = BILLING_OPERATION_RIGHTS["self.payments.list"];
  assert.deepEqual([...required], ["billing.self.payments.read"]);
  assertBillingOperationsReferenceCatalog();
});

test("P?: server last-owner invariant exists", () => {
  assert.match(LAST_OWNER_LEAVE_FORBIDDEN, /sole owner/);
});

test("P?: authorization tables are privileged HTTP data", () => {
  assert.equal(
    isPrivilegedHttpDataResource("athena.authorization_roles"),
    true
  );
  assert.equal(
    isPrivilegedHttpDataResource("athena.authorization_user_roles"),
    true
  );
});

test("P?: legacy role map uses distinct platform keys", () => {
  assert.equal(mapLegacyUserRole("admin"), "platform_admin");
  assert.equal(mapLegacyUserRole(null), PLATFORM_CUSTOMER_ROLE);
  assert.equal(mapLegacyMemberRole("owner"), "organization_owner");
});

test("P?: organization owner template includes lifecycle and owner-assign rights", () => {
  const owner = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === "organization_owner"
  );
  assert.ok(owner);
  assert.ok(owner.rights.includes("organization.lifecycle.delete"));
  assert.ok(owner.rights.includes("organization.owners.assign"));
});

test("P?: memory store unions platform customer rights", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("user-1", PLATFORM_CUSTOMER_ROLE);
  const rights = await store.resolveEffectiveRights({
    getMember: async () => undefined,
    userId: "user-1",
  });
  assert.ok(rights.includes("billing.self.payments.read"));
  assert.equal(rights.includes("billing.payments.read"), false);
});

test("P?: replaceUserRoleAssignments is atomic and protects last platform_admin", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("admin-1", "platform_admin");
  const snapshot = await store.readSnapshot({
    getMember: async () => undefined,
    listMembers: async () => [],
    userId: "admin-1",
  });
  await assert.rejects(
    () =>
      store.replaceUserRoleAssignments({
        actorRights: snapshot.effectiveRights,
        actorUserId: "admin-1",
        expectedVersion: snapshot.revision,
        roleIds: ["platform_customer"],
        userId: "admin-1",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "AUTHORIZATION_LAST_PLATFORM_ADMIN"
  );
  await store.assignUserRole("admin-2", "platform_admin");
  const afterSecond = await store.readSnapshot({
    getMember: async () => undefined,
    listMembers: async () => [],
    userId: "admin-1",
  });
  const next = await store.replaceUserRoleAssignments({
    actorRights: afterSecond.effectiveRights,
    actorUserId: "admin-1",
    expectedVersion: afterSecond.revision,
    roleIds: ["billing_admin"],
    userId: "admin-2",
  });
  assert.ok(next.revision > afterSecond.revision);
  const assigned = await store.listUserRoleAssignments({
    userIds: ["admin-2"],
  });
  assert.deepEqual(assigned[0]?.roleIds, ["billing_admin"]);
});

test("P?: assignment sources do not include AuthorizationManager files", () => {
  const files = walkFiles(join(srcRoot, "runtime", "authorization"));
  for (const file of files) {
    assert.equal(
      readFileSync(file, "utf8").includes("AuthorizationManager"),
      false
    );
  }
});

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

test("P?: generation 32 constrains role and assignment scope", () => {
  assert.match(
    ATHENA_AUTHORIZATION_CONSTRAINTS_SQL,
    /authorization_roles_scope_organization_id/
  );
  assert.match(
    ATHENA_AUTHORIZATION_CONSTRAINTS_SQL,
    /authorization_revisions_scope_nullability/
  );
  assert.match(
    ATHENA_AUTHORIZATION_CONSTRAINTS_SQL,
    /authorization_assert_user_role_platform/
  );
  assert.match(
    ATHENA_AUTHORIZATION_CONSTRAINTS_SQL,
    /authorization_assert_member_role_organization/
  );
  assert.match(
    readFileSync(
      join(srcRoot, "runtime", "authorization", "postgres.ts"),
      "utf8"
    ),
    /platform_unauthorized/
  );
});

test("P?: organization admin cannot invite or add an owner", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const owner = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const ownerCookie = cookieOf(owner);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "AA", slug: "aa-org" }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const organization = (await jsonBody(created)).organization as { id: string };

  const adminSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-admin@example.com",
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
        organizationId: organization.id,
        role: "admin",
        userId: adminUserId,
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    })
  );
  assert.equal(added.status, 200);

  const inviteOwner = await runtime.handle(
    new Request("http://app.local/api/auth/organization/invite-member", {
      body: JSON.stringify({
        email: "aa-escalation@example.com",
        organizationId: organization.id,
        role: "owner",
      }),
      headers: { "content-type": "application/json", cookie: adminCookie },
      method: "POST",
    })
  );
  assert.equal(inviteOwner.status, 403);
  assert.equal(
    (await jsonBody(inviteOwner)).message,
    GRANT_HIGHER_ROLE_FORBIDDEN
  );

  const outsider = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-outsider@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const outsiderId = (
    (
      await jsonBody(
        await runtime.handle(
          new Request("http://app.local/api/auth/get-session", {
            headers: { cookie: cookieOf(outsider) },
          })
        )
      )
    ).user as { id: string }
  ).id;
  const addOwner = await runtime.handle(
    new Request("http://app.local/api/auth/organization/add-member", {
      body: JSON.stringify({
        organizationId: organization.id,
        role: "owner",
        userId: outsiderId,
      }),
      headers: { "content-type": "application/json", cookie: adminCookie },
      method: "POST",
    })
  );
  assert.equal(addOwner.status, 403);

  const unknownRole = await runtime.handle(
    new Request("http://app.local/api/auth/organization/invite-member", {
      body: JSON.stringify({
        email: "aa-unknown-role@example.com",
        organizationId: organization.id,
        role: "not-a-real-role",
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    })
  );
  assert.equal(unknownRole.status, 400);

  const ownerInvite = await runtime.handle(
    new Request("http://app.local/api/auth/organization/invite-member", {
      body: JSON.stringify({
        email: "aa-second-owner@example.com",
        organizationId: organization.id,
        role: "owner",
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    })
  );
  assert.equal(ownerInvite.status, 200);
});

test("P?: authorization audit and clone stay in the active organization", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const first = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-a@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const firstCookie = cookieOf(first);
  const orgA = (
    (
      await jsonBody(
        await runtime.handle(
          new Request("http://app.local/api/auth/organization/create", {
            body: JSON.stringify({ name: "OrgA", slug: "aa-a" }),
            headers: {
              "content-type": "application/json",
              cookie: firstCookie,
            },
            method: "POST",
          })
        )
      )
    ).organization as { id: string }
  ).id;
  const second = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-b@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const secondCookie = cookieOf(second);
  const orgB = (
    (
      await jsonBody(
        await runtime.handle(
          new Request("http://app.local/api/auth/organization/create", {
            body: JSON.stringify({ name: "OrgB", slug: "aa-b" }),
            headers: {
              "content-type": "application/json",
              cookie: secondCookie,
            },
            method: "POST",
          })
        )
      )
    ).organization as { id: string }
  ).id;

  const audit = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/audit?organizationId=${orgB}`,
      { headers: { cookie: firstCookie } }
    )
  );
  assert.equal(audit.status, 403);

  const cloned = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles/clone", {
      body: JSON.stringify({
        name: "Stolen",
        organizationId: orgB,
        sourceRoleId: ORGANIZATION_MEMBER_ROLE,
      }),
      headers: { "content-type": "application/json", cookie: firstCookie },
      method: "POST",
    })
  );
  assert.equal(cloned.status, 403);
  void orgA;
});

test("P?: cloned organization roles appear in the snapshot and can be assigned", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const owner = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-clone-owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const ownerCookie = cookieOf(owner);
  const organization = (
    (
      await jsonBody(
        await runtime.handle(
          new Request("http://app.local/api/auth/organization/create", {
            body: JSON.stringify({ name: "CloneCo", slug: "aa-clone" }),
            headers: {
              "content-type": "application/json",
              cookie: ownerCookie,
            },
            method: "POST",
          })
        )
      )
    ).organization as { id: string }
  ).id;
  const cloned = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles/clone", {
      body: JSON.stringify({
        name: "Reviewer",
        sourceRoleId: ORGANIZATION_MEMBER_ROLE,
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    })
  );
  assert.equal(cloned.status, 200);
  const role = (await jsonBody(cloned)).role as { id: string; key: string };
  const snapshot = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/authorization/snapshot", {
        headers: { cookie: ownerCookie },
      })
    )
  );
  const assignable = snapshot.assignableRoles as Array<{ key: string }>;
  assert.equal(
    assignable.some((entry) => entry.key === role.key),
    true
  );
  assert.equal(
    assignable.some((entry) => entry.key === "platform_admin"),
    false
  );

  const memberSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-clone-member@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const memberId = (
    (
      await jsonBody(
        await runtime.handle(
          new Request("http://app.local/api/auth/get-session", {
            headers: { cookie: cookieOf(memberSignup) },
          })
        )
      )
    ).user as { id: string }
  ).id;
  const added = await runtime.handle(
    new Request("http://app.local/api/auth/organization/add-member", {
      body: JSON.stringify({
        organizationId: organization,
        role: role.key,
        userId: memberId,
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    })
  );
  assert.equal(added.status, 200);
  const listedResponse = await runtime.handle(
    new Request("http://app.local/api/auth/organization/list-members", {
      headers: { cookie: ownerCookie },
    })
  );
  const listed = await jsonBody(listedResponse);
  assert.equal(listedResponse.status, 200, JSON.stringify(listed));
  const members = listed.members as Array<{
    authorization?: { roleKey?: string };
    role?: string;
    userId?: string;
  }>;
  const assigned = members.find((row) => row.userId === memberId);
  assert.equal(assigned?.role, role.key);
  assert.equal(assigned?.authorization?.roleKey, role.key);
});

test("P?: organization custom roles cannot be cloned across tenants", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const first = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-clone-src@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const firstCookie = cookieOf(first);
  await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "SrcOrg", slug: "aa-clone-src" }),
      headers: { "content-type": "application/json", cookie: firstCookie },
      method: "POST",
    })
  );
  const sourceClone = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles/clone", {
      body: JSON.stringify({
        name: "Finance admin",
        sourceRoleId: ORGANIZATION_MEMBER_ROLE,
      }),
      headers: { "content-type": "application/json", cookie: firstCookie },
      method: "POST",
    })
  );
  assert.equal(sourceClone.status, 200);
  const sourceRole = (await jsonBody(sourceClone)).role as { id: string };

  const second = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-clone-dst@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const secondCookie = cookieOf(second);
  await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "DstOrg", slug: "aa-clone-dst" }),
      headers: { "content-type": "application/json", cookie: secondCookie },
      method: "POST",
    })
  );
  const stolen = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles/clone", {
      body: JSON.stringify({
        name: "Stolen finance",
        sourceRoleId: sourceRole.id,
      }),
      headers: { "content-type": "application/json", cookie: secondCookie },
      method: "POST",
    })
  );
  assert.equal(stolen.status, 403);

  const sameOrg = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles/clone", {
      body: JSON.stringify({
        name: "Finance copy",
        sourceRoleId: sourceRole.id,
      }),
      headers: { "content-type": "application/json", cookie: firstCookie },
      method: "POST",
    })
  );
  assert.equal(sameOrg.status, 200);
});

test("P?: AuthorizationCapabilities does not own Operations Billing", () => {
  const capabilities = capabilitiesFromRights([BILLING_PAYMENTS_READ]);
  assert.equal("canViewOperationsBilling" in capabilities, false);
  assert.deepEqual(Object.keys(capabilities).sort(), [
    "canChangeMemberRole",
    "canDeleteOrganization",
    "canInviteMembers",
    "canManageOrganizationRoles",
    "canManagePlatformRoles",
    "canRemoveMember",
  ]);
  assert.doesNotMatch(
    readFileSync(join(srcRoot, "runtime", "authorization", "types.ts"), "utf8"),
    /canViewOperationsBilling/
  );
  assert.doesNotMatch(
    readFileSync(
      join(srcRoot, "runtime", "authorization", "capabilities.ts"),
      "utf8"
    ),
    /canViewOperationsBilling/
  );
  assert.match(
    readFileSync(
      join(srcRoot, "runtime", "authorization", "clone-source.ts"),
      "utf8"
    ),
    /assertCloneRoleTenantBoundary/
  );
});

test("P?: organization admin cannot assign a role containing rights they do not hold", async () => {
  const store = new MemoryAuthorizationStore();
  const owner = BUILTIN_AUTHORIZATION_ROLES.find(
    (entry) => entry.id === ORGANIZATION_OWNER_ROLE
  );
  const admin = BUILTIN_AUTHORIZATION_ROLES.find(
    (entry) => entry.id === ORGANIZATION_ADMIN_ROLE
  );
  assert.ok(owner);
  assert.ok(admin);
  const custom = await store.createRole({
    actorRights: owner.rights,
    actorUserId: "owner-1",
    name: "Closer",
    organizationId: "org-1",
    rights: ["organization.lifecycle.delete", "organization.members.read"],
    scopeKind: "organization",
    unrestrictedGrant: true,
  });
  await assert.rejects(
    () =>
      store.replaceMemberRoleAssignments({
        actorRights: admin.rights,
        actorUserId: "admin-1",
        expectedVersion: 2,
        foundingOwnerUserId: "owner-1",
        memberId: "member-2",
        memberUserId: "member-2",
        organizationId: "org-1",
        roleIds: [ORGANIZATION_MEMBER_ROLE, custom.id],
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code ===
        "AUTHORIZATION_RIGHT_DELEGATION_DENIED"
  );
});

test("P?: member assignment HTTP requires organization.members.write not roles.write", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const owner = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-assign-owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const ownerCookie = cookieOf(owner);
  await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "AssignCo", slug: "aa-assign" }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  const memberSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "aa-assign-member@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const memberUserId = (
    (
      await jsonBody(
        await runtime.handle(
          new Request("http://app.local/api/auth/get-session", {
            headers: { cookie: cookieOf(memberSignup) },
          })
        )
      )
    ).user as { id: string }
  ).id;
  const added = await runtime.handle(
    new Request("http://app.local/api/auth/organization/add-member", {
      body: JSON.stringify({
        role: "member",
        userId: memberUserId,
      }),
      headers: { "content-type": "application/json", cookie: ownerCookie },
      method: "POST",
    })
  );
  assert.equal(added.status, 200, JSON.stringify(await jsonBody(added)));
  const listed = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/organization/list-members", {
        headers: { cookie: ownerCookie },
      })
    )
  );
  const memberRow = (
    listed.members as Array<{ id: string; userId?: string }>
  ).find((row) => row.userId === memberUserId);
  assert.ok(memberRow);
  const snapshot = await jsonBody(
    await runtime.handle(
      new Request("http://app.local/api/auth/authorization/snapshot", {
        headers: { cookie: ownerCookie },
      })
    )
  );
  const replaced = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/assignments/members/${memberRow.id}`,
      {
        body: JSON.stringify({
          expectedVersion: snapshot.revision,
          roleIds: [ORGANIZATION_ADMIN_ROLE],
        }),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        method: "PUT",
      }
    )
  );
  assert.equal(replaced.status, 200, JSON.stringify(await jsonBody(replaced)));
});
