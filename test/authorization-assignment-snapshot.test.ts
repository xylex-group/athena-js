import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalGrantId,
  grantIdentityFromAssignment,
} from "../src/runtime/authorization/grant-identity.ts";
import { MemoryAuthorizationStore } from "../src/runtime/authorization/memory.ts";
import {
  AUTHORIZATION_CATALOG_VERSION,
  authorizationRightsFingerprint,
  authorizationRolesFingerprint,
} from "../src/runtime/authorization/catalog-state.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_CUSTOMER_ROLE,
} from "../src/runtime/authorization/templates.ts";

test("no-op user assignment replacement preserves revision and audit", async () => {
  const store = new MemoryAuthorizationStore();
  const admin = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === PLATFORM_ADMIN_ROLE
  );
  assert.ok(admin);
  await store.assignUserRole("admin-1", PLATFORM_ADMIN_ROLE);
  await store.assignUserRole("user-1", PLATFORM_CUSTOMER_ROLE);
  const current = await store.readUserRoleAssignmentsSnapshot();
  const audit = await store.listAudit({ organizationId: null });

  const result = await store.replaceUserRoleAssignments({
    actorRights: admin.rights,
    actorUserId: "admin-1",
    expectedVersion: current.revision,
    roleIds: [PLATFORM_CUSTOMER_ROLE],
    userId: "user-1",
  });

  assert.equal(result.revision, current.revision);
  assert.deepEqual(await store.listAudit({ organizationId: null }), audit);
});

test("removing assignments does not re-delegate retained rights", async () => {
  const store = new MemoryAuthorizationStore();
  const admin = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === PLATFORM_ADMIN_ROLE
  );
  assert.ok(admin);
  await store.assignUserRole("admin-1", PLATFORM_ADMIN_ROLE);
  await store.assignUserRole("user-1", PLATFORM_CUSTOMER_ROLE);
  const beforeAdd = await store.readUserRoleAssignmentsSnapshot();
  const added = await store.replaceUserRoleAssignments({
    actorRights: admin.rights,
    actorUserId: "admin-1",
    expectedVersion: beforeAdd.revision,
    roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
    userId: "user-1",
  });

  const removed = await store.replaceUserRoleAssignments({
    actorRights: [],
    actorUserId: "limited-reviewer",
    expectedVersion: added.revision,
    roleIds: ["billing_admin"],
    userId: "user-1",
  });

  assert.ok(removed.revision > added.revision);
  const final = await store.readUserRoleAssignmentsSnapshot({
    userIds: ["user-1"],
  });
  assert.deepEqual(final.assignments[0]?.roleIds, ["billing_admin"]);
});

test("adding a role still requires authority to delegate its new rights", async () => {
  const store = new MemoryAuthorizationStore();
  const admin = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === PLATFORM_ADMIN_ROLE
  );
  assert.ok(admin);
  await store.assignUserRole("admin-1", PLATFORM_ADMIN_ROLE);
  await store.assignUserRole("user-1", PLATFORM_CUSTOMER_ROLE);
  const current = await store.readUserRoleAssignmentsSnapshot();

  await assert.rejects(
    () =>
      store.replaceUserRoleAssignments({
        actorRights: [],
        actorUserId: "limited-reviewer",
        expectedVersion: current.revision,
        roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
        userId: "user-1",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code ===
        "AUTHORIZATION_RIGHT_DELEGATION_DENIED"
  );
});

test("platform assignment snapshot revision is isolated from organization CAS", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("admin-1", PLATFORM_ADMIN_ROLE);
  await store.assignMemberRole(
    "member-1",
    "organization_owner",
    "admin-1",
    "org-a",
    "user-1"
  );
  await store.assignMemberRole(
    "member-2",
    "organization_member",
    "admin-1",
    "org-a",
    "user-2"
  );
  const platform = await store.readUserRoleAssignmentsSnapshot({
    userIds: ["admin-1"],
  });
  const organization = await store.readMemberRoleAssignmentsSnapshot({
    organizationId: "org-a",
  });
  const snapshot = await store.readSnapshot({
    getMember: async () => undefined,
    listMembers: async () => [],
    userId: "admin-1",
  });
  assert.equal(platform.revision, snapshot.revision);
  assert.notEqual(platform.revision, organization.revision);
  assert.equal(platform.authorityVersion.assignmentRevision, platform.revision);
  assert.equal(
    organization.authorityVersion.assignmentRevision,
    organization.revision
  );
  assert.deepEqual(platform.authorityVersion, {
    assignmentRevision: platform.revision,
    catalogVersion: AUTHORIZATION_CATALOG_VERSION,
    rightsFingerprint: authorizationRightsFingerprint(),
    rolesFingerprint: authorizationRolesFingerprint(),
  });
  assert.equal(Object.isFrozen(platform.authorityVersion), true);
  assert.deepEqual(
    [...(platform.assignments[0]?.roleIds ?? [])],
    [PLATFORM_ADMIN_ROLE]
  );
  assert.equal(organization.assignments[0]?.userId, "user-1");
});

test("returned assignment snapshots are immutable copies", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("admin-1", PLATFORM_ADMIN_ROLE);
  const first = await store.readUserRoleAssignmentsSnapshot({
    userIds: ["admin-1"],
  });
  const mutation = first.assignments[0]?.roleIds as string[];
  assert.throws(() => {
    mutation.push("billing_admin");
  });
  await store.assignUserRole("admin-2", PLATFORM_ADMIN_ROLE);
  const second = await store.readUserRoleAssignmentsSnapshot({
    userIds: ["admin-1"],
  });
  assert.deepEqual(
    [...(second.assignments[0]?.roleIds ?? [])],
    [PLATFORM_ADMIN_ROLE]
  );
});

test("stale same-target replace is rejected and does not overwrite", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("user-a", PLATFORM_ADMIN_ROLE);
  await store.assignUserRole("user-b", "platform_customer");
  const opened = await store.readUserRoleAssignmentsSnapshot();
  const rights = await store.resolveEffectiveRights({
    getMember: async () => undefined,
    userId: "user-a",
  });
  await store.replaceUserRoleAssignments({
    actorRights: rights,
    actorUserId: "user-a",
    expectedVersion: opened.revision,
    roleIds: [PLATFORM_ADMIN_ROLE, "billing_admin"],
    userId: "user-b",
  });
  await assert.rejects(
    () =>
      store.replaceUserRoleAssignments({
        actorRights: rights,
        actorUserId: "user-a",
        expectedVersion: opened.revision,
        roleIds: [PLATFORM_ADMIN_ROLE, "billing_admin"],
        userId: "user-a",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code ===
        "AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT"
  );
  const final = await store.readUserRoleAssignmentsSnapshot({
    userIds: ["user-a"],
  });
  assert.deepEqual(
    [...(final.assignments[0]?.roleIds ?? [])],
    [PLATFORM_ADMIN_ROLE]
  );
});

test("unrelated-target update can rebase onto the new assignment revision", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("user-a", PLATFORM_ADMIN_ROLE);
  await store.assignUserRole("user-c", "platform_customer");
  const opened = await store.readUserRoleAssignmentsSnapshot();
  const rights = await store.resolveEffectiveRights({
    getMember: async () => undefined,
    userId: "user-a",
  });
  const afterOther = await store.replaceUserRoleAssignments({
    actorRights: rights,
    actorUserId: "user-a",
    expectedVersion: opened.revision,
    roleIds: ["billing_admin"],
    userId: "user-c",
  });
  const retried = await store.replaceUserRoleAssignments({
    actorRights: rights,
    actorUserId: "user-a",
    expectedVersion: afterOther.revision,
    roleIds: [PLATFORM_ADMIN_ROLE, "billing_admin"],
    userId: "user-a",
  });
  assert.ok(retried.revision > afterOther.revision);
  const final = await store.readUserRoleAssignmentsSnapshot({
    userIds: ["user-a"],
  });
  assert.deepEqual(
    [...(final.assignments[0]?.roleIds ?? [])].sort(),
    ["billing_admin", PLATFORM_ADMIN_ROLE].sort()
  );
});

test("grant IDs differ by organization for the same role", () => {
  const left = canonicalGrantId(
    grantIdentityFromAssignment({
      memberId: "member-1",
      organizationId: "org-a",
      roleId: "organization_owner",
      scopeKind: "organization",
      userId: "user-1",
    })
  );
  const right = canonicalGrantId(
    grantIdentityFromAssignment({
      memberId: "member-2",
      organizationId: "org-b",
      roleId: "organization_owner",
      scopeKind: "organization",
      userId: "user-1",
    })
  );
  assert.notEqual(left, right);
  assert.match(left, /grant:organization:org-a:member:member-1:/);
  const again = canonicalGrantId(
    grantIdentityFromAssignment({
      memberId: "member-1",
      organizationId: "org-a",
      roleId: "organization_owner",
      scopeKind: "organization",
      userId: "user-1",
    })
  );
  assert.equal(left, again);
});
