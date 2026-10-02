import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import { migrateAthenaAuthSchema } from "../../src/auth/local/schema.ts";
import { PostgresAuthStores } from "../../src/auth/local/stores.ts";

const databaseUrl = (
  process.env.ATHENA_TEST_DATABASE_URL || process.env.DATABASE_URL || ""
).trim();
const postgresTest = /^postgres(?:ql)?:\/\//i.test(databaseUrl)
  ? test
  : test.skip;

postgresTest("Postgres identity connections and federated identities persist with unique subjects", async () => {
  const database = await createPostgresAuthDatabase(databaseUrl);
  const stores = new PostgresAuthStores(database);
  const suffix = crypto.randomUUID();
  const userId = `identity-user-${suffix}`;
  const orgId = `identity-org-${suffix}`;
  const connectionId = `identity-connection-${suffix}`;
  try {
    await migrateAthenaAuthSchema(database);
    await stores.createUser({ id: userId, email: `${suffix}@example.com` });
    await stores.createOrganization({
      createdByUserId: userId,
      id: orgId,
      name: "Federation test",
      slug: `federation-${suffix}`,
    });
    await stores.authorization.ensureCatalog();
    const defaultRole = await stores.authorization.lookupAssignableOrganizationRole(
      orgId,
      "organization_member"
    );
    assert.ok(defaultRole);
    const created = await stores.createIdentityConnection({
      authenticationRequired: true,
      clientId: "enterprise-client",
      connectionType: "oidc",
      credentialRef: "secret://enterprise/oidc",
      domains: ["example.com"],
      enabled: true,
      id: connectionId,
      issuer: "https://id.example.com/tenant",
      jitDefaultRoleId: defaultRole.id,
      jitEnabled: true,
      name: "Enterprise OIDC",
      organizationId: orgId,
      resource: "https://api.example/resource",
      tokenEndpointAuthMethod: "client_secret_post",
    });
    assert.equal(created.issuer, "https://id.example.com/tenant");
    await assert.rejects(
      database.query("DELETE FROM athena.authorization_roles WHERE id = $1", [defaultRole.id]),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23503"
    );
    assert.equal((await stores.listIdentityConnections(orgId))[0]?.id, connectionId);
    const linked = await stores.linkFederatedIdentity({
      connectionId,
      id: `federated-${suffix}`,
      issuer: created.issuer,
      subject: "subject-123",
      userId,
    });
    const existing = await stores.linkFederatedIdentity({
      connectionId,
      id: `ignored-${suffix}`,
      issuer: created.issuer,
      subject: "subject-123",
      userId,
    });
    assert.equal(existing.id, linked.id);
    assert.equal(
      (await stores.findFederatedIdentity(connectionId, created.issuer, "subject-123"))?.user_id,
      userId
    );
    await assert.rejects(
      stores.linkFederatedIdentity({
        connectionId,
        id: `conflict-${suffix}`,
        issuer: created.issuer,
        subject: "subject-123",
        userId: `other-${suffix}`,
      })
    );
    assert.equal(await stores.touchFederatedIdentity(linked.id, new Date()), true);
    assert.equal(await stores.disableIdentityConnection(connectionId), true);
    assert.equal(await stores.disableIdentityConnection(connectionId), true);
  } finally {
    await database.query("DELETE FROM athena.organization WHERE id = $1", [orgId]);
    await database.query("DELETE FROM athena.users WHERE id = $1", [userId]);
    await database.close();
  }
});
