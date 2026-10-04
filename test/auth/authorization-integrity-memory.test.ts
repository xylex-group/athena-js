import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { MemoryAdminAuthStore } from "../../src/auth/local/admin-store.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createMemoryAuthMutationTransaction } from "../../src/auth/local/mutation-transaction.ts";
import { AUTHORIZATION_LAST_PLATFORM_ADMIN } from "../../src/runtime/authorization/role-invariants.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  ORGANIZATION_OWNER_ROLE,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_CUSTOMER_ROLE,
} from "../../src/runtime/authorization/templates.ts";

test("Memory member and user removal advance authorization revisions", async () => {
  const stores = new MemoryAuthStores();
  const organizationId = "authorization-integrity-org";
  const userId = "authorization-integrity-user";
  await stores.createUser({ email: "authz@example.com", id: userId });
  await stores.createOrganization({
    createdByUserId: userId,
    id: organizationId,
    name: "Authorization Integrity",
    slug: organizationId,
  });
  await stores.addMember({
    id: "authorization-integrity-member",
    organizationId,
    role: "member",
    userId,
  });

  const memberBefore =
    await stores.authorization.readMemberRoleAssignmentsSnapshot({
      organizationId,
    });
  assert.equal(memberBefore.assignments[0]?.userId, userId);
  assert.equal(await stores.removeMember(organizationId, userId), true);
  const memberAfter =
    await stores.authorization.readMemberRoleAssignmentsSnapshot({
      organizationId,
    });
  assert.ok(memberAfter.revision > memberBefore.revision);
  assert.equal(memberAfter.assignments.length, 0);

  await stores.addMember({
    id: "authorization-integrity-member-again",
    organizationId,
    role: "member",
    userId,
  });
  const platformBefore =
    await stores.authorization.readUserRoleAssignmentsSnapshot({
      userIds: [userId],
    });
  const organizationBefore =
    await stores.authorization.readMemberRoleAssignmentsSnapshot({
      organizationId,
    });
  await stores.deleteUser(userId);
  const platformAfter =
    await stores.authorization.readUserRoleAssignmentsSnapshot({
      userIds: [userId],
    });
  const organizationAfter =
    await stores.authorization.readMemberRoleAssignmentsSnapshot({
      organizationId,
    });
  assert.ok(platformAfter.revision > platformBefore.revision);
  assert.ok(organizationAfter.revision > organizationBefore.revision);
  assert.deepEqual(platformAfter.assignments[0]?.roleIds, []);
  assert.equal(organizationAfter.assignments.length, 0);
});

test("Memory deletion paths preserve the final platform administrator", async () => {
  const stores = new MemoryAuthStores();
  const admin = new MemoryAdminAuthStore(stores);
  await stores.createUser({
    email: "last-admin@example.com",
    id: "last-admin",
  });
  await stores.createUser({
    email: "other-admin@example.com",
    id: "other-admin",
  });
  await stores.updateUser("last-admin", { role: "admin" });
  await stores.updateUser("other-admin", { role: "admin" });
  await stores.updateUser("other-admin", { role: "customer" });

  const before = await stores.authorization.readUserRoleAssignmentsSnapshot();
  const rejectLastAdmin = (error: { code?: string }) =>
    error.code === AUTHORIZATION_LAST_PLATFORM_ADMIN;
  await assert.rejects(admin.deleteUser("last-admin"), rejectLastAdmin);
  assert.ok(await stores.getUserById("last-admin"));
  assert.equal(
    (await stores.authorization.readUserRoleAssignmentsSnapshot()).revision,
    before.revision
  );

  await assert.rejects(stores.deleteUser("last-admin"), rejectLastAdmin);
  assert.ok(await stores.getUserById("last-admin"));
});

test("failed Memory admin creation removes its candidate before role promotion", async () => {
  class AccountFailureStores extends MemoryAuthStores {
    override async createAccount(
      input: Parameters<MemoryAuthStores["createAccount"]>[0]
    ): Promise<never> {
      throw new Error(`credential persistence failed for ${input.userId}`);
    }
  }

  const stores = new AccountFailureStores();
  const admin = new MemoryAdminAuthStore(stores);
  await assert.rejects(
    admin.createUser(
      {
        email: "failed-admin@example.com",
        id: "failed-admin",
        metadata: { password_hash: "hash" },
        role: "admin",
      },
      "creator"
    ),
    /credential persistence failed/
  );
  assert.equal(await stores.getUserById("failed-admin"), undefined);
});

test("Memory organization deletion removes its grants from the access inventory", async () => {
  const stores = new MemoryAuthStores();
  const organizationId = "authorization-integrity-delete-org";
  const userId = "authorization-integrity-delete-user";
  await stores.createUser({
    email: "authz-delete@example.com",
    id: userId,
  });
  await stores.createOrganization({
    createdByUserId: userId,
    id: organizationId,
    name: "Authorization Integrity Deletion",
    slug: organizationId,
  });
  const member = await stores.addMember({
    id: "authorization-integrity-delete-member",
    organizationId,
    role: "owner",
    userId,
  });
  const ownerRole = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === ORGANIZATION_OWNER_ROLE
  );
  assert.ok(ownerRole);
  const customRole = await stores.authorization.createRole({
    actorRights: ownerRole.rights,
    actorUserId: userId,
    name: "Security reviewer",
    organizationId,
    rights: ["organization.members.read"],
    scopeKind: "organization",
  });
  await stores.authorization.assignMemberRole(
    member.id,
    customRole.key,
    userId,
    organizationId,
    userId
  );

  const before = await stores.authorization.listAccessGrants();
  assert.ok(
    before.some(
      (grant) =>
        grant.organizationId === organizationId &&
        grant.role.id === customRole.id
    )
  );

  const transaction = createMemoryAuthMutationTransaction(stores);
  await assert.rejects(
    transaction(async (scope) => {
      await scope.stores.deleteOrganization(organizationId);
      throw new Error("force rollback after organization deletion");
    }),
    /force rollback after organization deletion/
  );
  assert.ok(await stores.getOrganization(organizationId));
  assert.ok(
    (await stores.authorization.listAccessGrants()).some(
      (grant) =>
        grant.organizationId === organizationId &&
        grant.role.id === customRole.id
    )
  );

  await transaction(async (scope) => {
    await scope.stores.deleteOrganization(organizationId);
  });

  const after = await stores.authorization.listAccessGrants();
  assert.equal(
    after.some((grant) => grant.organizationId === organizationId),
    false
  );
  assert.equal(
    await stores.authorization.getRole(customRole.id, organizationId),
    undefined
  );
});

test("Memory Auth mutation rollback restores authorization state", async () => {
  const stores = new MemoryAuthStores();
  const admin = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === PLATFORM_ADMIN_ROLE
  );
  assert.ok(admin);
  await stores.authorization.assignUserRole("admin", PLATFORM_ADMIN_ROLE);
  await stores.authorization.assignUserRole("subject", PLATFORM_CUSTOMER_ROLE);
  const before = stores.authorization.snapshot();
  const snapshot = await stores.authorization.readUserRoleAssignmentsSnapshot();
  const transaction = createMemoryAuthMutationTransaction(stores);

  await assert.rejects(
    transaction(async (scope) => {
      await scope.stores.authorization.replaceUserRoleAssignments({
        actorRights: admin.rights,
        actorUserId: "admin",
        expectedVersion: snapshot.revision,
        roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
        userId: "subject",
      });
      throw new Error("force rollback after authorization mutation");
    }),
    /force rollback after authorization mutation/
  );

  assert.deepEqual(stores.authorization.snapshot(), before);
});

test("Memory assignment replacement preserves provenance for retained grants", async () => {
  const stores = new MemoryAuthStores();
  const admin = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === PLATFORM_ADMIN_ROLE
  );
  assert.ok(admin);
  await stores.authorization.assignUserRole("admin", PLATFORM_ADMIN_ROLE);
  await stores.authorization.assignUserRole(
    "subject",
    PLATFORM_CUSTOMER_ROLE,
    "original-grantor"
  );
  const before = await stores.authorization.listAccessGrants();
  const retainedBefore = before.find(
    (grant) =>
      grant.subject.userId === "subject" &&
      grant.role.key === PLATFORM_CUSTOMER_ROLE
  );
  assert.ok(retainedBefore);
  const assignments =
    await stores.authorization.readUserRoleAssignmentsSnapshot();

  await stores.authorization.replaceUserRoleAssignments({
    actorRights: admin.rights,
    actorUserId: "admin",
    expectedVersion: assignments.revision,
    roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
    userId: "subject",
  });

  const after = await stores.authorization.listAccessGrants();
  const retainedAfter = after.find((grant) => grant.id === retainedBefore.id);
  assert.ok(retainedAfter);
  assert.deepEqual(retainedAfter.provenance, retainedBefore.provenance);
  const added = after.find(
    (grant) =>
      grant.subject.userId === "subject" && grant.role.key === "billing_admin"
  );
  assert.equal(added?.provenance.assignedBy, "admin");
});
