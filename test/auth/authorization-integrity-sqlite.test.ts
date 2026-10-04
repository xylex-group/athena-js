import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import type { AthenaAuthDatabase } from "../../src/auth/local/database.ts";
import { createAuthMutationTransaction } from "../../src/auth/local/mutation-transaction.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { SqliteAuthStores } from "../../src/auth/local/sqlite-stores.ts";

function database(
  queryRows: (sql: string) => unknown[] = () => [],
  queryLabels: string[] = []
): AthenaAuthDatabase {
  const create = (inTransaction: boolean): AthenaAuthDatabase => ({
    close: async () => {},
    inTransaction,
    query: async <T>(sql: string) => {
      queryLabels.push(inTransaction ? "transaction" : "root");
      const rows = queryRows(sql) as T[];
      return { rowCount: rows.length, rows };
    },
    transaction: async (fn) => fn(create(true)),
  });
  return create(false);
}

test("SQLite Auth mutation dispatch keeps the SQLite store", async () => {
  const queryLabels: string[] = [];
  let transactionCount = 0;
  const db = database(() => [], queryLabels);
  const baseTransaction = db.transaction;
  db.transaction = async (fn) => {
    transactionCount += 1;
    return baseTransaction(fn);
  };
  const stores = new SqliteAuthStores(db);
  const transaction = createAuthMutationTransaction({
    database: db,
    stores,
  });

  await transaction(async (scope) => {
    assert.ok(scope.stores instanceof SqliteAuthStores);
    await scope.stores.createUser({ email: "sqlite@example.com", id: "u-1" });
  });
  assert.ok(await stores.getUserById("u-1"));
  await assert.rejects(
    transaction(async (scope) => {
      await scope.stores.createUser({
        email: "rollback@example.com",
        id: "u-2",
      });
      throw new Error("rollback SQLite mutation");
    }),
    /rollback SQLite mutation/
  );
  assert.equal(await stores.getUserById("u-2"), undefined);
  assert.equal(transactionCount, 2);
  assert.deepEqual(queryLabels, [
    "transaction",
    "transaction",
    "transaction",
    "transaction",
  ]);
});

test("SQLite authorization hydration retains multiple persisted role rows", async () => {
  const db = database((sql) => {
    if (sql.includes("FROM athena_auth_member_role")) {
      return [
        {
          member_id: "member-1",
          role_key: "organization_member",
          source_id: "connection-1",
          source_kind: "identity_connection",
        },
        { member_id: "member-1", role_key: "organization_admin" },
      ];
    }
    if (sql.includes("FROM athena_auth_member")) {
      return [
        {
          id: "member-1",
          organization_id: "org-1",
          role: "member",
          user_id: "user-1",
        },
      ];
    }
    if (sql.includes("FROM athena_auth_user_role")) {
      return [
        { role_key: "platform_admin", user_id: "user-1" },
        { role_key: "platform_customer", user_id: "user-1" },
      ];
    }
    return [];
  });
  const stores = new SqliteAuthStores(db);
  await stores.hydrate();

  const [assignment] = await stores.authorization.listUserRoleAssignments({
    userIds: ["user-1"],
  });
  assert.equal(assignment?.roleIds.length, 2);
  assert.notEqual(assignment?.roleIds[0], assignment?.roleIds[1]);
  const [memberAssignment] =
    await stores.authorization.listMemberRoleAssignments({
      organizationId: "org-1",
    });
  assert.equal(memberAssignment?.roleIds.length, 2);
  assert.equal(memberAssignment?.userId, "user-1");
  const grants = stores.authorization.snapshot().memberRoles.get("member-1");
  const provisionedGrant = [...(grants?.values() ?? [])].find(
    (grant) => (grant as { sourceKind?: string }).sourceKind != null
  ) as { sourceId?: string; sourceKind?: string } | undefined;
  assert.deepEqual(
    {
      sourceId: provisionedGrant?.sourceId,
      sourceKind: provisionedGrant?.sourceKind,
    },
    { sourceId: "connection-1", sourceKind: "identity_connection" }
  );
});

test("SQLite member role persistence stores provisioning source", async () => {
  const statements: string[] = [];
  const db = database((sql) => {
    statements.push(sql);
    return [];
  });
  const stores = new SqliteAuthStores(db);
  await stores.addMember({
    id: "member-provenance",
    organizationId: "org-provenance",
    provisioningSource: {
      sourceId: "connection-provenance",
      sourceKind: "identity_connection",
    },
    role: "member",
    userId: "user-provenance",
  });
  assert.ok(
    statements.some(
      (sql) =>
        sql.includes("INSERT INTO athena_auth_member_role") &&
        sql.includes("source_kind") &&
        sql.includes("source_id")
    )
  );
});

test("SQLite Auth advertises and enforces unsupported assignment management", async () => {
  const db = database();
  const runtime = createAthenaAuthRuntime({
    database: db,
    secret: "sqlite-auth-capability-test-secret-0001",
    stores: new SqliteAuthStores(db),
  });
  const ok = await runtime.handle(new Request("http://localhost/api/auth/ok"));
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as {
    capabilities: { authorizationAssignments: boolean };
  };
  assert.equal(body.capabilities.authorizationAssignments, false);

  const response = await runtime.handle(
    new Request("http://localhost/api/auth/authorization/roles", {
      method: "GET",
    })
  );
  assert.equal(response.status, 501);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "ATHENA_AUTH_CAPABILITY_DISABLED"
  );

  for (const path of [
    "/admin/create-user",
    "/admin/remove-user",
    "/admin/set-role",
    "/organization/accept-invitation",
    "/organization/add-member",
    "/organization/create",
    "/organization/delete",
    "/organization/invite-member",
    "/organization/leave",
    "/organization/remove-member",
    "/organization/update-member-role",
  ]) {
    const lifecycleResponse = await runtime.handle(
      new Request(`http://localhost/api/auth${path}`, {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    assert.notEqual(
      lifecycleResponse.status,
      501,
      `${path} should not be disabled by authorizationAssignments`
    );
  }

  const assignmentWrite = await runtime.handle(
    new Request(
      "http://localhost/api/auth/authorization/assignments/users/user-1",
      {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    )
  );
  assert.equal(assignmentWrite.status, 501);
  const auditRead = await runtime.handle(
    new Request("http://localhost/api/auth/authorization/audit")
  );
  assert.equal(auditRead.status, 501);
  await runtime.close();
});
