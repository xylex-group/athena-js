import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type {
  AthenaAuthDatabase,
  AthenaAuthQueryResult,
} from "../src/auth/local/database.ts";
import { createPostgresAuthDatabase } from "../src/auth/local/database.ts";
import { migrateAthenaAuthSchema } from "../src/auth/local/schema.ts";
import { PostgresAuthStores } from "../src/auth/local/stores.ts";
import { MemoryAuthorizationStore } from "../src/runtime/authorization/memory.ts";
import { PostgresAuthorizationStore } from "../src/runtime/authorization/postgres.ts";
import { fingerprintAthenaAuthorizationSnapshotIr } from "../src/runtime/authorization/snapshot-ir/fingerprint.ts";
import { projectAthenaAccessGrantsFromAuthorizationSnapshot } from "../src/runtime/authorization/snapshot-ir/projection.ts";
import {
  ORGANIZATION_OWNER_ROLE,
  PLATFORM_ADMIN_ROLE,
} from "../src/runtime/authorization/templates.ts";

test("memory authority snapshot contains complete platform roles and persisted assignments", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("user-1", PLATFORM_ADMIN_ROLE, "operator-1");

  const snapshot = await store.readAuthoritySnapshot({
    scope: { kind: "platform" },
  });

  assert.equal(snapshot.scope.kind, "platform");
  assert.ok(snapshot.roles.roles.length > 0);
  assert.equal(snapshot.assignments.length, 1);
  assert.equal(snapshot.assignments[0]?.subject.kind, "user");
  assert.equal(snapshot.assignments[0]?.provenance.assignedBy, "operator-1");
  assert.equal(snapshot.metadata.assignmentRevision, 2);
});

test("legacy access grant listing projects every complete authorization scope", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole(
    "user-1",
    PLATFORM_ADMIN_ROLE,
    "platform-operator"
  );
  await store.assignMemberRole(
    "member-1",
    ORGANIZATION_OWNER_ROLE,
    "organization-operator",
    "org-1",
    "user-1"
  );
  const platform = await store.readAuthoritySnapshot({
    scope: { kind: "platform" },
  });
  const organization = await store.readAuthoritySnapshot({
    scope: { kind: "organization", organizationId: "org-1" },
  });
  const expected = [
    ...projectAthenaAccessGrantsFromAuthorizationSnapshot(platform),
    ...projectAthenaAccessGrantsFromAuthorizationSnapshot(organization),
  ].sort((left, right) => left.id.localeCompare(right.id));

  const grants = await store.listAccessGrants();
  assert.deepEqual(grants, expected);
  assert.deepEqual(grants.map((grant) => grant.subject.kind).sort(), [
    "member",
    "user",
  ]);
  assert.ok(Object.isFrozen(grants));
});

test("memory authority capture preserves identity-connection provenance", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignMemberRole(
    "member-1",
    ORGANIZATION_OWNER_ROLE,
    "provisioner-1",
    "org-1",
    "user-1",
    { sourceId: "connection-1", sourceKind: "identity_connection" }
  );

  const snapshot = await store.readAuthoritySnapshot({
    scope: { kind: "organization", organizationId: "org-1" },
  });
  assert.deepEqual(snapshot.assignments[0]?.provenance, {
    assignedAt: snapshot.assignments[0]?.provenance.assignedAt,
    assignedBy: "provisioner-1",
    sourceId: "connection-1",
    sourceKind: "identity_connection",
  });
});

const databaseUrl = (
  process.env.ATHENA_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  ""
).trim();
const postgresTest = /^postgres(?:ql)?:\/\//i.test(databaseUrl)
  ? test
  : test.skip;

postgresTest(
  "Postgres authority capture observes one repeatable-read assignment state",
  async () => {
    const database = await createPostgresAuthDatabase(databaseUrl);
    const suffix = crypto.randomUUID();
    const actorId = `snapshot-actor-${suffix}`;
    const targetId = `snapshot-target-${suffix}`;
    let releaseCapture: (() => void) | undefined;
    let signalRevisionRead: (() => void) | undefined;
    const revisionRead = new Promise<void>((resolve) => {
      signalRevisionRead = resolve;
    });
    const continueCapture = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    let pauseOnce = true;
    const gatedDatabase: AthenaAuthDatabase = {
      get inTransaction() {
        return database.inTransaction;
      },
      query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) =>
        database.query<T>(sql, values),
      transaction: <T>(
        run: (tx: AthenaAuthDatabase) => Promise<T>,
        options?: { operationTimeoutMs?: number }
      ) =>
        database.transaction(
          (tx) =>
            run({
              get inTransaction() {
                return tx.inTransaction;
              },
              query: async <R = Record<string, unknown>>(
                sql: string,
                values?: unknown[]
              ): Promise<AthenaAuthQueryResult<R>> => {
                const result = await tx.query<R>(sql, values);
                if (
                  pauseOnce &&
                  /FROM athena\.authorization_revisions/i.test(sql)
                ) {
                  pauseOnce = false;
                  signalRevisionRead?.();
                  await continueCapture;
                }
                return result;
              },
              transaction: <R>(
                nested: (nestedTx: AthenaAuthDatabase) => Promise<R>,
                nestedOptions?: { operationTimeoutMs?: number }
              ) => tx.transaction(nested, nestedOptions),
            }),
          options
        ),
    };
    try {
      await migrateAthenaAuthSchema(database);
      const authorization = new PostgresAuthorizationStore(database);
      await authorization.ensureCatalog();
      const stores = new PostgresAuthStores(database);
      await stores.createUser({
        email: `snapshot-actor-${suffix}@example.test`,
        id: actorId,
        name: "Snapshot actor",
      });
      await stores.createUser({
        email: `snapshot-target-${suffix}@example.test`,
        id: targetId,
        name: "Snapshot target",
      });
      await authorization.assignUserRole(actorId, PLATFORM_ADMIN_ROLE);
      await authorization.assignUserRole(targetId, "platform_customer");
      const before = await authorization.readAuthoritySnapshot({
        scope: { kind: "platform" },
      });
      const targetRevision = before.metadata.assignmentRevision;
      const snapshotStore = new PostgresAuthorizationStore(gatedDatabase);
      const pendingCapture = snapshotStore.readAuthoritySnapshot({
        scope: { kind: "platform" },
      });
      await revisionRead;
      const actorRights = await authorization.resolveEffectiveRights({
        getMember: async () => undefined,
        userId: actorId,
      });
      await authorization.replaceUserRoleAssignments({
        actorRights,
        actorUserId: actorId,
        expectedVersion: targetRevision,
        roleIds: [PLATFORM_ADMIN_ROLE],
        userId: targetId,
      });
      releaseCapture?.();
      const captured = await pendingCapture;
      const targetAssignment = captured.assignments.find(
        (entry) =>
          entry.subject.kind === "user" && entry.subject.userId === targetId
      );
      assert.equal(targetAssignment?.roleId, "platform_customer");
      assert.equal(captured.metadata.assignmentRevision, targetRevision);
      const after = await authorization.readAuthoritySnapshot({
        scope: { kind: "platform" },
      });
      assert.equal(
        after.assignments.find(
          (entry) =>
            entry.subject.kind === "user" && entry.subject.userId === targetId
        )?.roleId,
        PLATFORM_ADMIN_ROLE
      );
      assert.equal(after.metadata.assignmentRevision, targetRevision + 1);
    } finally {
      releaseCapture?.();
      await database.query(
        "DELETE FROM athena.users WHERE id = ANY($1::text[])",
        [[actorId, targetId]]
      );
      await database.close?.();
    }
  }
);

postgresTest(
  "Memory and Postgres authority snapshots share a semantic fingerprint",
  async () => {
    const database = await createPostgresAuthDatabase(databaseUrl);
    const suffix = crypto.randomUUID();
    const userId = `snapshot-parity-user-${suffix}`;
    const memberId = `snapshot-parity-member-${suffix}`;
    const organizationId = `snapshot-parity-org-${suffix}`;
    try {
      await migrateAthenaAuthSchema(database);
      const postgres = new PostgresAuthorizationStore(database);
      await postgres.ensureCatalog();
      const postgresStores = new PostgresAuthStores(database);
      await postgresStores.createUser({
        email: `snapshot-parity-${suffix}@example.test`,
        id: userId,
        name: "Snapshot parity",
      });
      await postgresStores.createOrganization({
        createdByUserId: userId,
        id: organizationId,
        name: "Snapshot parity",
        slug: organizationId,
      });
      await postgresStores.addMember({
        id: memberId,
        organizationId,
        role: "member",
        userId,
      });

      const memory = new MemoryAuthorizationStore();
      await memory.assignMemberRole(
        memberId,
        "organization_member",
        undefined,
        organizationId,
        userId
      );
      const memorySnapshot = await memory.readAuthoritySnapshot({
        scope: { kind: "organization", organizationId },
      });
      const assignedAt = memorySnapshot.assignments[0]?.provenance.assignedAt;
      assert.ok(assignedAt);
      await database.query(
        "UPDATE athena.authorization_member_roles SET created_at = $1 WHERE member_id = $2",
        [assignedAt, memberId]
      );
      const postgresSnapshot = await postgres.readAuthoritySnapshot({
        scope: { kind: "organization", organizationId },
      });
      assert.equal(
        fingerprintAthenaAuthorizationSnapshotIr(memorySnapshot),
        fingerprintAthenaAuthorizationSnapshotIr(postgresSnapshot)
      );
      const expectedGrants =
        projectAthenaAccessGrantsFromAuthorizationSnapshot(postgresSnapshot);
      const listedGrants = (await postgres.listAccessGrants()).filter(
        (grant) => grant.organizationId === organizationId
      );
      assert.deepEqual(listedGrants, expectedGrants);
    } finally {
      await database.query("DELETE FROM athena.organization WHERE id = $1", [
        organizationId,
      ]);
      await database.query("DELETE FROM athena.users WHERE id = $1", [userId]);
      await database.close?.();
    }
  }
);
