import { strict as assert } from "node:assert/strict";
import pg from "pg";
import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import { PostgresAuthStores } from "../../src/auth/local/stores.ts";
import type { AuthorizationSnapshot } from "../../src/runtime/authorization/types.ts";

export async function persistPlatformRoleAssignment(input: {
  databaseUrl: string;
  roleKey: "platform_admin" | "platform_customer";
  userId: string;
  usersRole: string;
}): Promise<void> {
  const client = new pg.Client({ connectionString: input.databaseUrl });
  await client.connect();
  try {
    await client.query(
      "DELETE FROM athena.authorization_user_roles WHERE user_id = $1",
      [input.userId]
    );
    const assigned = await client.query(
      `INSERT INTO athena.authorization_user_roles (user_id, role_id)
			 SELECT $1, id
			 FROM athena.authorization_roles
			 WHERE key = $2
			   AND organization_id IS NULL
			   AND scope_kind = 'platform'`,
      [input.userId, input.roleKey]
    );
    assert.ok(
      assigned.rowCount === 1,
      `persisted ${input.roleKey} for ${input.userId}`
    );
    await client.query("UPDATE athena.users SET role = $2 WHERE id = $1", [
      input.userId,
      input.usersRole,
    ]);
    await client.query(
      `UPDATE athena.authorization_revisions
			 SET revision = revision + 1
			 WHERE scope_kind = 'platform' AND organization_id IS NULL`
    );
  } finally {
    await client.end();
  }
}

export async function readPersistedAssignmentKeys(input: {
  databaseUrl: string;
  memberId?: string;
  userId: string;
}): Promise<{ memberRoleKeys: string[]; platformRoleKeys: string[] }> {
  const client = new pg.Client({ connectionString: input.databaseUrl });
  await client.connect();
  try {
    const platform = await client.query<{ key: string }>(
      `SELECT r.key
			 FROM athena.authorization_user_roles ur
			 JOIN athena.authorization_roles r ON r.id = ur.role_id
			 WHERE ur.user_id = $1
			 ORDER BY r.key`,
      [input.userId]
    );
    const member =
      input.memberId == null
        ? { rows: [] as Array<{ key: string }> }
        : await client.query<{ key: string }>(
          `SELECT r.key
						 FROM athena.authorization_member_roles mr
						 JOIN athena.authorization_roles r ON r.id = mr.role_id
						 WHERE mr.member_id = $1
						 ORDER BY r.key`,
          [input.memberId]
        );
    return {
      memberRoleKeys: member.rows.map((row) => row.key),
      platformRoleKeys: platform.rows.map((row) => row.key),
    };
  } finally {
    await client.end();
  }
}

export async function injectAssignmentStoreFailure(
  databaseUrl: string
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
			ALTER TABLE athena.authorization_user_roles
			RENAME TO authorization_user_roles_injected_down
		`);
  } finally {
    await client.end();
  }
}

export async function expectedAuthorizationSnapshot(input: {
  activeOrganizationId?: string | null;
  databaseUrl: string;
  userId: string;
}): Promise<AuthorizationSnapshot> {
  const database = await createPostgresAuthDatabase(input.databaseUrl);
  const stores = new PostgresAuthStores(database);
  try {
    return await stores.authorization.readSnapshot({
      activeOrganizationId: input.activeOrganizationId,
      getMember: (organizationId, userId) =>
        stores.getMember(organizationId, userId),
      listMembers: (organizationId) => stores.listMembers(organizationId),
      userId: input.userId,
    });
  } finally {
    await database.close?.();
  }
}

export function normalizeAuthorizationSnapshot(
  value: unknown
): AuthorizationSnapshot {
  assert.ok(value && typeof value === "object", "AuthorizationSnapshot object");
  const snapshot = value as AuthorizationSnapshot;
  return {
    ...(typeof snapshot.activeOrganizationId === "string"
      ? { activeOrganizationId: snapshot.activeOrganizationId }
      : {}),
    assignableRoles: [...snapshot.assignableRoles].sort((left, right) =>
      left.key.localeCompare(right.key)
    ),
    capabilities: snapshot.capabilities,
    effectiveRights: [...snapshot.effectiveRights].sort(),
    revision: snapshot.revision,
    roles: [...snapshot.roles].sort((left, right) =>
      left.key.localeCompare(right.key)
    ),
  };
}

export async function postBilling(
  origin: string,
  cookie: string,
  operation: string,
  payload: Record<string, unknown> = {}
): Promise<{ json: Record<string, unknown>; status: number; text: string }> {
  const response = await fetch(`${origin}/api/athena/billing`, {
    body: JSON.stringify({ operation, payload }),
    headers: {
      "content-type": "application/json",
      cookie,
      origin,
    },
    method: "POST",
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`billing JSON expected, got: ${text.slice(0, 2000)}`);
    }
  }
  return { json, status: response.status, text };
}

export async function postStorage(
  origin: string,
  cookie: string,
  operation: "list" | "put",
  payload: Record<string, unknown> = {}
): Promise<{ json: Record<string, unknown>; status: number; text: string }> {
  const response = await fetch(`${origin}/api/athena/storage`, {
    body: JSON.stringify({ operation, payload }),
    headers: {
      "content-type": "application/json",
      cookie,
      origin,
    },
    method: "POST",
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`storage JSON expected, got: ${text.slice(0, 2000)}`);
    }
  }
  return { json, status: response.status, text };
}

export async function assertBillingOutcome(input: {
  allowed: boolean;
  cookie: string;
  operation: string;
  origin: string;
}): Promise<void> {
  const result = await postBilling(input.origin, input.cookie, input.operation);
  if (input.allowed) {
    assert.notEqual(
      result.status,
      401,
      `${input.operation} must not be unauthenticated: ${result.text}`
    );
    assert.notEqual(
      (result.json.error as { code?: string } | undefined)?.code,
      "ATHENA_BILLING_AUTHORIZATION_DENIED",
      `${input.operation} must not be rights-denied: ${result.text}`
    );
    return;
  }
  assert.equal(result.status, 403, result.text);
  assert.equal(
    (result.json.error as { code?: string } | undefined)?.code,
    "ATHENA_BILLING_AUTHORIZATION_DENIED",
    result.text
  );
}

export async function assertStorageOutcome(input: {
  allowed: boolean;
  cookie: string;
  operation: "list" | "put";
  origin: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const result = await postStorage(
    input.origin,
    input.cookie,
    input.operation,
    input.payload ??
    (input.operation === "put"
      ? {
        body: Buffer.from("golden", "utf8").toString("base64"),
        key: "golden/object.txt",
      }
      : { prefix: "golden/" })
  );
  if (input.allowed) {
    assert.equal(result.status, 200, result.text);
    assert.equal(result.json.ok, true, result.text);
    return;
  }
  assert.equal(result.status, 403, result.text);
  assert.equal(
    (result.json.error as { code?: string } | undefined)?.code,
    "storage_authorization_denied",
    result.text
  );
}

export async function assertSessionFailsClosedWithoutRoleFallback(input: {
  cookie: string;
  origin: string;
}): Promise<void> {
  const session = await fetch(`${input.origin}/api/auth/get-session`, {
    headers: { cookie: input.cookie },
  });
  const sessionText = await session.text();
  assert.notEqual(
    session.status,
    200,
    `get-session must not succeed from users.role after assignment-store failure: ${sessionText}`
  );

  const snapshot = await fetch(
    `${input.origin}/api/auth/authorization/snapshot`,
    {
      headers: { cookie: input.cookie },
    }
  );
  assert.notEqual(
    snapshot.status,
    200,
    "authorization snapshot must fail closed with the assignment store down"
  );

  const billing = await postBilling(
    input.origin,
    input.cookie,
    "products.list"
  );
  assert.equal(billing.status, 401, billing.text);
  assert.equal(
    (billing.json.error as { code?: string } | undefined)?.code,
    "ATHENA_BILLING_UNAUTHENTICATED",
    billing.text
  );

  const storage = await postStorage(input.origin, input.cookie, "list", {
    prefix: "golden/",
  });
  assert.equal(storage.status, 401, storage.text);
}
