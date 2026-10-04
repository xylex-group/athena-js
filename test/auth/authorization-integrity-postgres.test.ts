import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import type {
  AthenaAuthDatabase,
  AthenaAuthTransactionOptions,
} from "../../src/auth/local/database.ts";
import { PostgresAdminAuthStore } from "../../src/auth/local/admin-store.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { migrateAthenaAuthSchema } from "../../src/auth/local/schema.ts";
import { PostgresAuthStores } from "../../src/auth/local/stores.ts";
import { AUTHORIZATION_LAST_PLATFORM_ADMIN } from "../../src/runtime/authorization/role-invariants.ts";
import { PostgresAuthorizationStore } from "../../src/runtime/authorization/postgres.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_CUSTOMER_ROLE,
} from "../../src/runtime/authorization/templates.ts";

function databaseUrl(): string | undefined {
  const value = (
    process.env.ATHENA_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  return /^postgres(?:ql)?:\/\//i.test(value) ? value : undefined;
}

const url = databaseUrl();
const maybe = url ? test : test.skip;

function revisionBarrierDatabase(
  database: AthenaAuthDatabase,
  waitForBothReads: () => Promise<void>,
  onBackendPid: (pid: number) => void
): AthenaAuthDatabase {
  return {
    inTransaction: false,
    query: (text, values) => database.query(text, values),
    transaction<T>(
      fn: (db: AthenaAuthDatabase) => Promise<T>,
      options?: AthenaAuthTransactionOptions
    ): Promise<T> {
      return database.transaction(async (tx) => {
        const backend = await tx.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid"
        );
        onBackendPid(Number(backend.rows[0]?.pid));
        return fn({
          inTransaction: true,
          query: async <Row = Record<string, unknown>>(
            text: string,
            values?: unknown[]
          ) => {
            const result = await tx.query<Row>(text, values);
            if (/SELECT revision::text AS revision/i.test(text)) {
              await waitForBothReads();
            }
            return result;
          },
          transaction: <Inner>(
            inner: (db: AthenaAuthDatabase) => Promise<Inner>,
            innerOptions?: AthenaAuthTransactionOptions
          ) => tx.transaction(inner, innerOptions),
        });
      }, options);
    },
  };
}

function observeLegacyRoleQueries(
  database: AthenaAuthDatabase,
  onQuery: (kind: "parent-lock" | "assignment-read") => void
): AthenaAuthDatabase {
  return {
    inTransaction: false,
    query: (text, values) => database.query(text, values),
    transaction<T>(
      fn: (db: AthenaAuthDatabase) => Promise<T>,
      options?: AthenaAuthTransactionOptions
    ): Promise<T> {
      return database.transaction(
        (tx) =>
          fn({
            inTransaction: true,
            query: async <Row = Record<string, unknown>>(
              text: string,
              values?: unknown[]
            ) => {
              if (
                /SELECT id FROM athena\.users WHERE id = \$1 FOR UPDATE/i.test(
                  text
                )
              ) {
                onQuery("parent-lock");
              } else if (/SELECT r\.key, ur\.role_id/i.test(text)) {
                onQuery("assignment-read");
              }
              return tx.query<Row>(text, values);
            },
            transaction: <Inner>(
              inner: (db: AthenaAuthDatabase) => Promise<Inner>,
              innerOptions?: AthenaAuthTransactionOptions
            ) => tx.transaction(inner, innerOptions),
          }),
        options
      );
    },
  };
}

maybe("Postgres assignment revisions are atomic across independent connections", async () => {
  const setup = await createPostgresAuthDatabase(url as string);
  const connectionA = await createPostgresAuthDatabase(url as string);
  const connectionB = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const adminId = `authz-cas-admin-${suffix}`;
  const userA = `authz-cas-a-${suffix}`;
  const userB = `authz-cas-b-${suffix}`;
  const organizationId = `authz-cas-org-${suffix}`;
  try {
    await migrateAthenaAuthSchema(setup);
    const admin = new PostgresAdminAuthStore(setup);
    await admin.createUser({
      email: `${adminId}@example.com`,
      id: adminId,
      role: "admin",
    });
    const stores = new PostgresAuthStores(setup);
    await stores.createUser({ email: `${userA}@example.com`, id: userA });
    await stores.createUser({ email: `${userB}@example.com`, id: userB });
    const authorization = new PostgresAuthorizationStore(setup);
    const expectedVersion = (
      await authorization.readUserRoleAssignmentsSnapshot()
    ).revision;
    const platformAdmin = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === PLATFORM_ADMIN_ROLE
    );
    assert.ok(platformAdmin);

    let releaseReads: () => void = () => {};
    const bothReads = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    let readCount = 0;
    const waitForBothReads = async () => {
      readCount += 1;
      if (readCount === 2) {
        releaseReads();
      }
      await bothReads;
    };
    const backendPids: number[] = [];
    const authA = new PostgresAuthorizationStore(
      revisionBarrierDatabase(connectionA, waitForBothReads, (pid) =>
        backendPids.push(pid)
      )
    );
    const authB = new PostgresAuthorizationStore(
      revisionBarrierDatabase(connectionB, waitForBothReads, (pid) =>
        backendPids.push(pid)
      )
    );
    const results = await Promise.allSettled([
      authA.replaceUserRoleAssignments({
        actorRights: platformAdmin.rights,
        actorUserId: adminId,
        expectedVersion,
        roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
        userId: userA,
      }),
      authB.replaceUserRoleAssignments({
        actorRights: platformAdmin.rights,
        actorUserId: adminId,
        expectedVersion,
        roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
        userId: userB,
      }),
    ]);
    assert.equal(new Set(backendPids).size, 2);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.equal(
      (rejected.reason as { code?: string }).code,
      "AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT"
    );
    const winner = results.find((result) => result.status === "fulfilled");
    assert.ok(winner && winner.status === "fulfilled");
    const persisted = await authorization.readUserRoleAssignmentsSnapshot({
      userIds: [userA, userB],
    });
    assert.equal(winner.value.revision, persisted.revision);
    assert.equal(persisted.revision, expectedVersion + 1);
    assert.equal(
      persisted.assignments.filter((assignment) =>
        assignment.roleIds.includes("billing_admin")
      ).length,
      1
    );
  } finally {
    await setup.query("DELETE FROM athena.organization WHERE id = $1", [
      organizationId,
    ]);
    await setup.query("DELETE FROM athena.users WHERE id = ANY($1::text[])", [
      [adminId, userA, userB],
    ]);
    await Promise.all([
      setup.close?.(),
      connectionA.close?.(),
      connectionB.close?.(),
    ]);
  }
});

maybe(
  "Postgres admin and store deletion preserve the final platform administrator",
  async () => {
    const database = await createPostgresAuthDatabase(url as string);
    const suffix = crypto.randomUUID();
    const adminId = `authz-last-admin-${suffix}`;
    const otherAdminId = `authz-other-admin-${suffix}`;
    try {
      await migrateAthenaAuthSchema(database);
      const admin = new PostgresAdminAuthStore(database);
      await admin.createUser({
        email: `${adminId}@example.com`,
        id: adminId,
        role: "admin",
      });
      await admin.createUser({
        email: `${otherAdminId}@example.com`,
        id: otherAdminId,
        role: "admin",
      });
      await admin.updateUser({ role: "customer", userId: otherAdminId });

      const authorization = new PostgresAuthorizationStore(database);
      const before = await authorization.readUserRoleAssignmentsSnapshot();
      const rejectLastAdmin = (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === AUTHORIZATION_LAST_PLATFORM_ADMIN;
      await assert.rejects(admin.deleteUser(adminId), rejectLastAdmin);
      assert.ok(await admin.getUser(adminId));
      assert.equal(
        (await authorization.readUserRoleAssignmentsSnapshot()).revision,
        before.revision
      );

      await assert.rejects(
        new PostgresAuthStores(database).deleteUser(adminId),
        rejectLastAdmin
      );
      assert.ok(await admin.getUser(adminId));
    } finally {
      await database.query("DELETE FROM athena.users WHERE id = ANY($1::text[])", [
        [adminId, otherAdminId],
      ]);
      await database.close?.();
    }
  }
);

maybe(
  "Postgres legacy role replacement locks the user before an empty assignment set",
  async () => {
    const setup = await createPostgresAuthDatabase(url as string);
    const connectionA = await createPostgresAuthDatabase(url as string);
    const connectionB = await createPostgresAuthDatabase(url as string);
    const suffix = crypto.randomUUID();
    const adminId = `authz-legacy-race-admin-${suffix}`;
    const subjectId = `authz-legacy-race-subject-${suffix}`;
    let releaseFirst: () => void = () => {};
    let markFirstReady: () => void = () => {};
    let markSecondQuery: (kind: "parent-lock" | "assignment-read") => void =
      () => {};
    const firstReady = new Promise<void>((resolve) => {
      markFirstReady = resolve;
    });
    const secondQuery = new Promise<"parent-lock" | "assignment-read">(
      (resolve) => {
        markSecondQuery = resolve;
      }
    );
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstTransaction: Promise<void> | undefined;
    let secondMutation: Promise<void> | undefined;
    try {
      await migrateAthenaAuthSchema(setup);
      const admin = new PostgresAdminAuthStore(setup);
      await admin.createUser({
        email: `${adminId}@example.com`,
        id: adminId,
        role: "admin",
      });
      await new PostgresAuthStores(setup).createUser({
        email: `${subjectId}@example.com`,
        id: subjectId,
      });
      await setup.query(
        "DELETE FROM athena.authorization_user_roles WHERE user_id = $1",
        [subjectId]
      );

      firstTransaction = connectionA.transaction(async (tx) => {
        await new PostgresAuthorizationStore(tx).replaceLegacyPlatformRole({
          role: "admin",
          userId: subjectId,
        });
        markFirstReady();
        await holdFirst;
      });
      await firstReady;
      secondMutation = new PostgresAuthorizationStore(
        observeLegacyRoleQueries(connectionB, markSecondQuery)
      ).replaceLegacyPlatformRole({
        role: "customer",
        userId: subjectId,
      });

      const secondQueryBeforeFirstCommit = await secondQuery;
      releaseFirst();
      await Promise.all([firstTransaction, secondMutation]);
      assert.equal(secondQueryBeforeFirstCommit, "parent-lock");

      const assignments = await setup.query<{ key: string }>(
        `SELECT r.key FROM athena.authorization_user_roles ur
         JOIN athena.authorization_roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND r.key = ANY($2::text[])
         ORDER BY r.key`,
        [subjectId, [PLATFORM_ADMIN_ROLE, PLATFORM_CUSTOMER_ROLE]]
      );
      assert.deepEqual(assignments.rows.map((row) => row.key), [
        PLATFORM_CUSTOMER_ROLE,
      ]);
    } finally {
      releaseFirst();
      await Promise.allSettled([firstTransaction, secondMutation].filter(Boolean));
      await setup.query("DELETE FROM athena.users WHERE id = ANY($1::text[])", [
        [adminId, subjectId],
      ]);
      await Promise.all([
        setup.close?.(),
        connectionA.close?.(),
        connectionB.close?.(),
      ]);
    }
  }
);

maybe("Postgres differential replacement preserves grants and allows reduction-only changes", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const adminId = `authz-diff-admin-${suffix}`;
  const subjectId = `authz-diff-subject-${suffix}`;
  try {
    await migrateAthenaAuthSchema(database);
    const admin = new PostgresAdminAuthStore(database);
    await admin.createUser({
      email: `${adminId}@example.com`,
      id: adminId,
      role: "admin",
    });
    await new PostgresAuthStores(database).createUser({
      email: `${subjectId}@example.com`,
      id: subjectId,
    });

    const authorization = new PostgresAuthorizationStore(database);
    const adminRole = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === PLATFORM_ADMIN_ROLE
    );
    const customerRole = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === PLATFORM_CUSTOMER_ROLE
    );
    const billingRole = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === "billing_admin"
    );
    assert.ok(adminRole && customerRole && billingRole);

    const opened = await authorization.readUserRoleAssignmentsSnapshot();
    const originalGrant = await database.query<{
      assigned_by: string | null;
      created_at: string;
      role_id: string;
    }>(
      `SELECT assigned_by, created_at::text AS created_at, role_id
       FROM athena.authorization_user_roles
       WHERE user_id = $1 AND role_id = $2`,
      [subjectId, customerRole.id]
    );
    assert.equal(originalGrant.rows.length, 1);

    const added = await authorization.replaceUserRoleAssignments({
      actorRights: adminRole.rights,
      actorUserId: adminId,
      expectedVersion: opened.revision,
      roleIds: [customerRole.id, billingRole.id],
      userId: subjectId,
    });
    assert.equal(added.revision, opened.revision + 1);
    const retainedGrant = await database.query<{
      assigned_by: string | null;
      created_at: string;
      role_id: string;
    }>(
      `SELECT assigned_by, created_at::text AS created_at, role_id
       FROM athena.authorization_user_roles
       WHERE user_id = $1 AND role_id = $2`,
      [subjectId, customerRole.id]
    );
    assert.deepEqual(retainedGrant.rows, originalGrant.rows);
    const addedGrant = await database.query<{ assigned_by: string | null }>(
      `SELECT assigned_by FROM athena.authorization_user_roles
       WHERE user_id = $1 AND role_id = $2`,
      [subjectId, billingRole.id]
    );
    assert.equal(addedGrant.rows[0]?.assigned_by, adminId);
    const auditAfterAdd = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM athena.authorization_audit_log
       WHERE target_id = $1 AND action = 'user.roles.replace'`,
      [subjectId]
    );
    assert.equal(auditAfterAdd.rows[0]?.count, "1");

    const noOp = await authorization.replaceUserRoleAssignments({
      actorRights: adminRole.rights,
      actorUserId: adminId,
      expectedVersion: added.revision,
      roleIds: [billingRole.id, customerRole.id],
      userId: subjectId,
    });
    assert.equal(noOp.revision, added.revision);
    const auditAfterNoOp = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM athena.authorization_audit_log
       WHERE target_id = $1 AND action = 'user.roles.replace'`,
      [subjectId]
    );
    assert.equal(auditAfterNoOp.rows[0]?.count, auditAfterAdd.rows[0]?.count);

    const reduced = await authorization.replaceUserRoleAssignments({
      actorRights: [],
      actorUserId: "limited-reviewer",
      expectedVersion: noOp.revision,
      roleIds: [billingRole.id],
      userId: subjectId,
    });
    assert.equal(reduced.revision, noOp.revision + 1);
    const final = await authorization.readUserRoleAssignmentsSnapshot({
      userIds: [subjectId],
    });
    assert.deepEqual(final.assignments[0]?.roleIds, [billingRole.id]);
  } finally {
    await database.query("DELETE FROM athena.users WHERE id = ANY($1::text[])", [
      [adminId, subjectId],
    ]);
    await database.close?.();
  }
});

maybe("Postgres and Memory legacy role writers preserve the same additional access", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const adminId = `authz-parity-admin-${suffix}`;
  const subjectId = `authz-parity-subject-${suffix}`;
  const organizationId = `authz-parity-org-${suffix}`;
  const memberId = `authz-parity-member-${suffix}`;
  try {
    await migrateAthenaAuthSchema(database);
    const postgresAdmin = new PostgresAdminAuthStore(database);
    const postgres = new PostgresAuthStores(database);
    const memory = new MemoryAuthStores();
    await postgresAdmin.createUser({
      email: `${adminId}@example.com`,
      id: adminId,
      role: "admin",
    });
    await memory.createUser({
      email: `${adminId}@example.com`,
      id: adminId,
    });
    await memory.updateUser(adminId, { role: "admin" });
    await postgres.createUser({ email: `${subjectId}@example.com`, id: subjectId });
    await memory.createUser({ email: `${subjectId}@example.com`, id: subjectId });

    const adminRole = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === PLATFORM_ADMIN_ROLE
    );
    const customerRole = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === PLATFORM_CUSTOMER_ROLE
    );
    const organizationOwner = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === "organization_owner"
    );
    const organizationAdmin = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === "organization_admin"
    );
    assert.ok(adminRole && customerRole && organizationOwner && organizationAdmin);

    const postgresPlatform =
      await postgres.authorization.readUserRoleAssignmentsSnapshot();
    const memoryPlatform =
      await memory.authorization.readUserRoleAssignmentsSnapshot();
    await postgres.authorization.replaceUserRoleAssignments({
      actorRights: adminRole.rights,
      actorUserId: adminId,
      expectedVersion: postgresPlatform.revision,
      roleIds: [customerRole.id, "billing_admin"],
      userId: subjectId,
    });
    await memory.authorization.replaceUserRoleAssignments({
      actorRights: adminRole.rights,
      actorUserId: adminId,
      expectedVersion: memoryPlatform.revision,
      roleIds: [customerRole.id, "billing_admin"],
      userId: subjectId,
    });
    await postgresAdmin.updateUser({ userId: subjectId, role: "admin" }, adminId);
    await memory.updateUser(subjectId, { role: "admin" }, adminId);

    const postgresPlatformGrants = (await postgres.authorization.listAccessGrants())
      .filter(
        (grant) =>
          grant.organizationId == null && grant.subject.userId === subjectId
      )
      .map((grant) => grant.role.key)
      .sort();
    const memoryPlatformGrants = (await memory.authorization.listAccessGrants())
      .filter(
        (grant) =>
          grant.organizationId == null && grant.subject.userId === subjectId
      )
      .map((grant) => grant.role.key)
      .sort();
    assert.deepEqual(postgresPlatformGrants, ["billing_admin", PLATFORM_ADMIN_ROLE].sort());
    assert.deepEqual(memoryPlatformGrants, postgresPlatformGrants);

    await postgres.createOrganization({
      createdByUserId: adminId,
      id: organizationId,
      name: "Authorization legacy role parity",
      slug: organizationId,
    });
    await memory.createOrganization({
      createdByUserId: adminId,
      id: organizationId,
      name: "Authorization legacy role parity",
      slug: organizationId,
    });
    await postgres.addMember({
      id: memberId,
      organizationId,
      role: "member",
      userId: subjectId,
    });
    await memory.addMember({
      id: memberId,
      organizationId,
      role: "member",
      userId: subjectId,
    });
    const createReviewer = (authorization: PostgresAuthorizationStore | MemoryAuthStores["authorization"]) =>
      authorization.createRole({
        actorRights: organizationOwner.rights,
        actorUserId: adminId,
        name: "Security reviewer",
        organizationId,
        rights: ["organization.members.read"],
        scopeKind: "organization",
        unrestrictedGrant: true,
      });
    const [postgresReviewer, memoryReviewer] = await Promise.all([
      createReviewer(postgres.authorization),
      createReviewer(memory.authorization),
    ]);
    await postgres.authorization.assignMemberRole(
      memberId,
      postgresReviewer.key,
      adminId,
      organizationId,
      subjectId
    );
    await memory.authorization.assignMemberRole(
      memberId,
      memoryReviewer.key,
      adminId,
      organizationId,
      subjectId
    );
    await postgres.updateMemberRole(organizationId, subjectId, "admin", adminId);
    await memory.updateMemberRole(organizationId, subjectId, "admin", adminId);

    const summarizeOrganizationGrants = async (
      authorization: PostgresAuthorizationStore | MemoryAuthStores["authorization"]
    ) =>
      (await authorization.listAccessGrants())
        .filter(
          (grant) =>
            grant.organizationId === organizationId &&
            grant.subject.userId === subjectId
        )
        .map((grant) => ({
          identity:
            grant.role.key === "organization_admin"
              ? "base:admin"
              : "custom:reviewer",
          rights: [...grant.rights],
        }))
        .sort((left, right) => left.identity.localeCompare(right.identity));
    assert.deepEqual(
      await summarizeOrganizationGrants(postgres.authorization),
      await summarizeOrganizationGrants(memory.authorization)
    );
    assert.deepEqual(await summarizeOrganizationGrants(memory.authorization), [
      {
        identity: "base:admin",
        rights: [...organizationAdmin.rights].sort(),
      },
      { identity: "custom:reviewer", rights: ["organization.members.read"] },
    ]);
  } finally {
    await database.query("DELETE FROM athena.organization WHERE id = $1", [
      organizationId,
    ]);
    await database.query("DELETE FROM athena.users WHERE id = ANY($1::text[])", [
      [adminId, subjectId],
    ]);
    await database.close?.();
  }
});

maybe("Postgres role-subject deletion advances every affected revision", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const adminId = `authz-delete-admin-${suffix}`;
  const userId = `authz-delete-user-${suffix}`;
  const organizationId = `authz-delete-org-${suffix}`;
  try {
    await migrateAthenaAuthSchema(database);
    const admin = new PostgresAdminAuthStore(database);
    await admin.createUser({
      email: `${adminId}@example.com`,
      id: adminId,
      role: "admin",
    });
    await admin.createUser({
      email: `${userId}@example.com`,
      id: userId,
      role: "customer",
    });
    const stores = new PostgresAuthStores(database);
    await stores.createOrganization({
      createdByUserId: adminId,
      id: organizationId,
      name: "Authorization deletion revisions",
      slug: organizationId,
    });
    await stores.addMember({
      id: `${organizationId}-member`,
      organizationId,
      role: "member",
      userId,
    });
    const authorization = new PostgresAuthorizationStore(database);
    const organizationBefore =
      await authorization.readMemberRoleAssignmentsSnapshot({ organizationId });
    assert.equal(await stores.removeMember(organizationId, userId), true);
    const organizationAfterRemoval =
      await authorization.readMemberRoleAssignmentsSnapshot({ organizationId });
    assert.ok(organizationAfterRemoval.revision > organizationBefore.revision);

    await stores.addMember({
      id: `${organizationId}-member-again`,
      organizationId,
      role: "member",
      userId,
    });
    const platformBefore =
      await authorization.readUserRoleAssignmentsSnapshot();
    const organizationBeforeUserDelete =
      await authorization.readMemberRoleAssignmentsSnapshot({ organizationId });
    assert.equal(await admin.deleteUser(userId), true);
    const platformAfter =
      await authorization.readUserRoleAssignmentsSnapshot();
    const organizationAfterUserDelete =
      await authorization.readMemberRoleAssignmentsSnapshot({ organizationId });
    assert.ok(platformAfter.revision > platformBefore.revision);
    assert.ok(
      organizationAfterUserDelete.revision > organizationBeforeUserDelete.revision
    );
  } finally {
    await database.query("DELETE FROM athena.organization WHERE id = $1", [
      organizationId,
    ]);
    await database.query("DELETE FROM athena.users WHERE id = ANY($1::text[])", [
      [adminId, userId],
    ]);
    await database.close?.();
  }
});

maybe("Postgres migration 49 backfills existing organization revisions", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const organizationId = `authz-backfill-org-${suffix}`;
  try {
    await migrateAthenaAuthSchema(database);
    await new PostgresAuthStores(database).createOrganization({
      createdByUserId: `authz-backfill-user-${suffix}`,
      id: organizationId,
      name: "Authorization revision backfill",
      slug: organizationId,
    });
    const createdRevision = await database.query<{ revision: string }>(
      `SELECT revision::text AS revision
       FROM athena.authorization_revisions WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(createdRevision.rows[0]?.revision, "1");
    await database.query(
      "DELETE FROM athena.authorization_revisions WHERE organization_id = $1",
      [organizationId]
    );
    await database.query(
      "DELETE FROM athena.auth_schema_migrations WHERE version = 49"
    );
    await migrateAthenaAuthSchema(database);
    const row = await database.query<{ revision: string }>(
      `SELECT revision::text AS revision
       FROM athena.authorization_revisions WHERE organization_id = $1`,
      [organizationId]
    );
    assert.equal(row.rows[0]?.revision, "1");
  } finally {
    await database.query("DELETE FROM athena.organization WHERE id = $1", [
      organizationId,
    ]);
    await database.close?.();
  }
});

maybe("Postgres catalog materialization versions backfilled assignments", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const userId = `authz-materialize-user-${suffix}`;
  const organizationId = `authz-materialize-org-${suffix}`;
  const memberId = `${organizationId}-member`;
  try {
    await migrateAthenaAuthSchema(database);
    const authorization = new PostgresAuthorizationStore(database);
    await authorization.ensureCatalog();
    const stores = new PostgresAuthStores(database);
    await stores.createUser({ email: `${userId}@example.com`, id: userId });
    await stores.createOrganization({
      createdByUserId: userId,
      id: organizationId,
      name: "Authorization materialization revisions",
      slug: organizationId,
    });
    await stores.addMember({
      id: memberId,
      organizationId,
      role: "member",
      userId,
    });
    const platformBefore =
      await authorization.readUserRoleAssignmentsSnapshot();
    const organizationBefore =
      await authorization.readMemberRoleAssignmentsSnapshot({ organizationId });
    await database.query(
      "DELETE FROM athena.authorization_user_roles WHERE user_id = $1",
      [userId]
    );
    await database.query(
      "DELETE FROM athena.authorization_member_roles WHERE member_id = $1",
      [memberId]
    );
    await database.query("DELETE FROM athena.authorization_catalog_state");

    await authorization.materialize();

    const platformAfter =
      await authorization.readUserRoleAssignmentsSnapshot();
    const organizationAfter =
      await authorization.readMemberRoleAssignmentsSnapshot({ organizationId });
    assert.ok(platformAfter.revision > platformBefore.revision);
    assert.ok(organizationAfter.revision > organizationBefore.revision);
  } finally {
    await database.query("DELETE FROM athena.organization WHERE id = $1", [
      organizationId,
    ]);
    await database.query("DELETE FROM athena.users WHERE id = $1", [userId]);
    await database.close?.();
  }
});

maybe("Postgres role reassignment records new grant provenance and retains existing grants", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const adminId = `authz-delete-admin-${suffix}`;
  const onlySourceUserId = `authz-delete-source-${suffix}`;
  const existingReplacementUserId = `authz-delete-existing-${suffix}`;
  const roleIds: string[] = [];
  try {
    await migrateAthenaAuthSchema(database);
    const authorization = new PostgresAuthorizationStore(database);
    await authorization.ensureCatalog();
    const adminRole = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === PLATFORM_ADMIN_ROLE
    );
    assert.ok(adminRole);
    await new PostgresAdminAuthStore(database).createUser({
      email: `${adminId}@example.com`,
      id: adminId,
      role: "admin",
    });
    const stores = new PostgresAuthStores(database);
    await stores.createUser({
      email: `${onlySourceUserId}@example.com`,
      id: onlySourceUserId,
    });
    await stores.createUser({
      email: `${existingReplacementUserId}@example.com`,
      id: existingReplacementUserId,
    });
    const createRole = (name: string) =>
      authorization.createRole({
        actorRights: adminRole.rights,
        actorUserId: adminId,
        name,
        scopeKind: "platform",
      });
    const source = await createRole("Role deletion source");
    const replacement = await createRole("Role deletion replacement");
    const sourceWithExisting = await createRole("Second deletion source");
    const existingReplacement = await createRole("Existing replacement");
    roleIds.push(source.id, replacement.id, sourceWithExisting.id, existingReplacement.id);

    await authorization.assignUserRole(onlySourceUserId, source.key, "original-grantor");
    const firstDelete = await authorization.deleteRole({
      actorUserId: adminId,
      expectedVersion: source.version,
      id: source.id,
      reassignmentRoleId: replacement.id,
    });
    assert.deepEqual(firstDelete.reassignedUserIds, [onlySourceUserId]);
    const newlyCreatedGrant = await database.query<{
      assigned_by: string | null;
      created_at: string;
    }>(
      `SELECT ur.assigned_by, ur.created_at::text AS created_at
       FROM athena.authorization_user_roles ur
       WHERE ur.user_id = $1 AND ur.role_id = $2`,
      [onlySourceUserId, replacement.id]
    );
    assert.equal(newlyCreatedGrant.rows[0]?.assigned_by, adminId);

    await authorization.assignUserRole(
      existingReplacementUserId,
      sourceWithExisting.key,
      "source-grantor"
    );
    await authorization.assignUserRole(
      existingReplacementUserId,
      existingReplacement.key,
      "replacement-grantor"
    );
    const beforeExistingGrant = await database.query<{
      assigned_by: string | null;
      created_at: string;
    }>(
      `SELECT assigned_by, created_at::text AS created_at
       FROM athena.authorization_user_roles
       WHERE user_id = $1 AND role_id = $2`,
      [existingReplacementUserId, existingReplacement.id]
    );
    const secondDelete = await authorization.deleteRole({
      actorUserId: adminId,
      expectedVersion: sourceWithExisting.version,
      id: sourceWithExisting.id,
      reassignmentRoleId: existingReplacement.id,
    });
    assert.deepEqual(secondDelete.reassignedUserIds, [existingReplacementUserId]);
    const afterExistingGrant = await database.query<{
      assigned_by: string | null;
      created_at: string;
    }>(
      `SELECT assigned_by, created_at::text AS created_at
       FROM athena.authorization_user_roles
       WHERE user_id = $1 AND role_id = $2`,
      [existingReplacementUserId, existingReplacement.id]
    );
    assert.deepEqual(afterExistingGrant.rows, beforeExistingGrant.rows);
  } finally {
    await database.query("DELETE FROM athena.users WHERE id = ANY($1::text[])", [
      [adminId, onlySourceUserId, existingReplacementUserId],
    ]);
    if (roleIds.length > 0) {
      await database.query(
        "DELETE FROM athena.authorization_roles WHERE id = ANY($1::text[])",
        [roleIds]
      );
    }
    await database.close?.();
  }
});

maybe("Postgres persists Identity Connection provisioning provenance on member grants", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const userId = `authz-jit-user-${suffix}`;
  const organizationId = `authz-jit-org-${suffix}`;
  const memberId = `authz-jit-member-${suffix}`;
  const connectionId = `authz-jit-connection-${suffix}`;
  try {
    await migrateAthenaAuthSchema(database);
    const stores = new PostgresAuthStores(database);
    await stores.createUser({
      email: `${userId}@example.com`,
      id: userId,
    });
    await stores.createOrganization({
      createdByUserId: userId,
      id: organizationId,
      name: "Authorization JIT provenance",
      slug: organizationId,
    });
    await stores.addMember({
      id: memberId,
      organizationId,
      provisioningSource: {
        sourceId: connectionId,
        sourceKind: "identity_connection",
      },
      role: "member",
      userId,
    });
    const result = await database.query<{
      assigned_by: string | null;
      source_id: string | null;
      source_kind: string | null;
    }>(
      `SELECT assigned_by, source_id, source_kind
       FROM athena.authorization_member_roles
       WHERE member_id = $1`,
      [memberId]
    );
    assert.deepEqual(result.rows, [
      {
        assigned_by: null,
        source_id: connectionId,
        source_kind: "identity_connection",
      },
    ]);
    const snapshot = await new PostgresAuthorizationStore(
      database
    ).readAuthoritySnapshot({
      scope: { kind: "organization", organizationId },
    });
    assert.deepEqual(
      snapshot.assignments[0]?.provenance,
      {
        assignedAt: snapshot.assignments[0]?.provenance.assignedAt,
        assignedBy: null,
        sourceId: connectionId,
        sourceKind: "identity_connection",
      }
    );
  } finally {
    await database.query(
      "DELETE FROM athena.organization WHERE id = $1",
      [organizationId]
    );
    await database.query("DELETE FROM athena.users WHERE id = $1", [userId]);
    await database.close?.();
  }
});
