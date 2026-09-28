import pg from "pg";

const databaseUrl = (
  process.env.ATHENA_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  ""
).trim();
const userId = process.env.ATHENA_CROSS_PROCESS_USER_ID?.trim() ?? "";
const roleKey = process.env.ATHENA_CROSS_PROCESS_ROLE_KEY?.trim() ?? "";
const usersRole =
  process.env.ATHENA_CROSS_PROCESS_USERS_ROLE?.trim() ?? "admin";

if (!/^postgres(ql)?:\/\//i.test(databaseUrl) || userId.length === 0) {
  throw new Error(
    "cross-process authorization mutate requires DATABASE_URL and ATHENA_CROSS_PROCESS_USER_ID"
  );
}
if (roleKey !== "platform_admin" && roleKey !== "platform_customer") {
  throw new Error(
    "ATHENA_CROSS_PROCESS_ROLE_KEY must be platform_admin or platform_customer"
  );
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(
    "DELETE FROM athena.authorization_user_roles WHERE user_id = $1",
    [userId]
  );
  const assigned = await client.query(
    `INSERT INTO athena.authorization_user_roles (user_id, role_id)
		 SELECT $1, id
		 FROM athena.authorization_roles
		 WHERE key = $2
		   AND organization_id IS NULL
		   AND scope_kind = 'platform'`,
    [userId, roleKey]
  );
  if (assigned.rowCount !== 1) {
    throw new Error(`failed to persist ${roleKey} for ${userId}`);
  }
  await client.query("UPDATE athena.users SET role = $2 WHERE id = $1", [
    userId,
    usersRole,
  ]);
  await client.query(
    `UPDATE athena.authorization_revisions
		 SET revision = revision + 1
		 WHERE scope_kind = 'platform' AND organization_id IS NULL`
  );
} finally {
  await client.end();
}
