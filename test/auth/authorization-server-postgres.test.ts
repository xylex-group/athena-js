import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  generateOpaqueSecret,
  hashOAuthSecret,
} from "../../src/auth/authorization-server/index.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { generateCodeChallenge } from "../../src/auth/oauth2/pkce.ts";
import { createPostgresOAuthAuthorizationServerStores } from "../../src/auth/local/authorization-server/postgres-stores.ts";
import { ATHENA_AUTH_TABLES } from "../../src/auth/contract/index.ts";
import { OAuthAuthorizationServerService } from "../../src/auth/local/authorization-server/service.ts";
import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import { PostgresAdminAuthStore } from "../../src/auth/local/admin-store.ts";
import { migrateAthenaAuthSchema } from "../../src/auth/local/schema.ts";
import { MemoryTokenKeyStore } from "../../src/auth/local/token-key-store.ts";
import { createTestOAuthSigning } from "./oauth-test-signing.ts";
import { PostgresTokenKeyStore } from "../../src/auth/local/postgres-token-key-store.ts";
import { PostgresAuthStores } from "../../src/auth/local/stores.ts";
import { PostgresAuthorizationStore } from "../../src/runtime/authorization/postgres.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  ORGANIZATION_MEMBER_ROLE,
  ORGANIZATION_OWNER_ROLE,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_CUSTOMER_ROLE,
} from "../../src/runtime/authorization/templates.ts";

class FailingTokenKeyStore extends MemoryTokenKeyStore {
  override async compareAndActivate(): Promise<void> {
    throw new Error("signing key persistence failed");
  }
}

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

maybe("Postgres OAuth authorization completion and code consume are single-winner", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const userId = `oauth-pg-user-${suffix}`;
  try {
    await migrateAthenaAuthSchema(database);
    await new PostgresAuthorizationStore(database).ensureCatalog();
    const authStores = new PostgresAuthStores(database);
    await authStores.createUser({
      email: `oauth-pg-${suffix}@example.com`,
      id: userId,
      name: "OAuth PG User",
    });
    const stores = createPostgresOAuthAuthorizationServerStores(database);
    const activeBefore = await stores.clients.list({ isActive: true });
    const client = await stores.clients.create({
      clientName: "Postgres concurrency test",
      id: `oauth-pg-client-${suffix}`,
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://resource.example/", "https://resource.example"],
      scopes: ["invoice:read", " invoice:read "],
    });
    assert.deepEqual(client.resourceUris, ["https://resource.example"]);
    assert.deepEqual(client.scopes, ["invoice:read"]);
    const clientPage = await stores.clients.list({
      isActive: true,
      limit: 1,
      offset: 0,
    });
    assert.equal(clientPage.total, activeBefore.total + 1);
    assert.equal(clientPage.clients[0]?.id, client.id);
    const inactiveBefore = await stores.clients.list({ isActive: false });
    const inactiveClient = await stores.clients.create({
      clientName: "Postgres inactive test",
      id: `oauth-pg-inactive-client-${suffix}`,
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://resource.example"],
      scopes: ["invoice:read"],
    });
    await stores.clients.disable(inactiveClient.id);
    await stores.clients.disable(inactiveClient.id);
    const inactivePage = await stores.clients.list({
      isActive: false,
      limit: 1000,
      offset: 0,
    });
    assert.equal(inactivePage.total, inactiveBefore.total + 1);
    assert.ok(inactivePage.clients.some((value) => value.id === inactiveClient.id));
    const updatedClient = await stores.clients.update(client.id, {
      clientName: "Updated Postgres client",
    });
    assert.equal(updatedClient?.clientName, "Updated Postgres client");
    const request = await stores.authorizationRequests.create({
      clientId: client.id,
      codeChallenge: "a".repeat(43),
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 60_000),
      id: `oauth-pg-request-${suffix}`,
      identityScopes: ["openid", "email"],
      maxAge: 300,
      nonce: `oauth-pg-nonce-${suffix}`,
      prompt: ["consent"],
      redirectUri: "https://client.example/callback",
      requestHash: `oauth-pg-request-hash-${suffix}`,
      requestedScopes: ["invoice:read"],
      resource: "https://resource.example",
      stateCiphertext: "state",
    });
    const completions = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const rawCode = generateOpaqueSecret();
        try {
          const completed = await stores.completeAuthorization({
            authenticatedAt: new Date("2026-10-01T12:00:00.000Z"),
            authenticationMethods: ["passkey", "totp"],
            clientId: client.id,
            codeChallenge: request.codeChallenge,
            codeChallengeMethod: "S256",
            codeHash: await hashOAuthSecret(rawCode),
            expiresAt: new Date(Date.now() + 60_000),
            grantId: `oauth-pg-grant-${suffix}-${index}`,
            id: `oauth-pg-code-${suffix}-${index}`,
            identityScopes: request.identityScopes,
            nonce: request.nonce,
            organizationId: null,
            redirectUri: request.redirectUri,
            requestId: request.id,
            resource: request.resource,
            scopes: request.requestedScopes,
            userId,
          });
          return { completed, ok: true as const, rawCode };
        } catch {
          return { ok: false as const };
        }
      })
    );
    const winners = completions.filter((result) => result.ok);
    assert.equal(winners.length, 1);
    const winner = winners[0];
    if (!winner || !winner.ok) {
      throw new Error("expected one OAuth authorization completion winner");
    }
    assert.deepEqual(
      winner.completed.request.identityScopes,
      ["openid", "email"]
    );
    assert.deepEqual(
      winner.completed.grant.identityScopes,
      ["openid", "email"]
    );
    const completedCode = await stores.authorizationCodes.getByHash(
      await hashOAuthSecret(winner.rawCode)
    );
    assert.equal(completedCode?.nonce, `oauth-pg-nonce-${suffix}`);
    assert.deepEqual(completedCode?.identityScopes, ["openid", "email"]);
    assert.equal(
      completedCode?.authenticatedAt.toISOString(),
      "2026-10-01T12:00:00.000Z"
    );
    assert.deepEqual(completedCode?.authenticationMethods, ["passkey", "totp"]);
    const silentUserId = `${userId}-silent`;
    await authStores.createUser({
      email: `oauth-pg-silent-${suffix}@example.com`,
      id: silentUserId,
      name: "OAuth PG Silent User",
    });
    const silentGrant = await stores.grants.authorize({
      clientId: client.id,
      organizationId: null,
      resource: request.resource,
      scopes: request.requestedScopes,
      userId: silentUserId,
    });
    const silentRequest = await stores.authorizationRequests.create({
      clientId: client.id,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 60_000),
      id: `oauth-pg-silent-${suffix}`,
      identityScopes: [],
      redirectUri: request.redirectUri,
      requestHash: `oauth-pg-silent-hash-${suffix}`,
      requestedScopes: request.requestedScopes,
      resource: request.resource,
      stateCiphertext: "state",
    });
    const authorizedAt = silentGrant.authorizedAt.toISOString();
    const silent = await stores.completeAuthorization({
      authenticatedAt: new Date("2026-10-02T12:00:00.000Z"),
      authenticationMethods: ["passkey"],
      clientId: client.id,
      codeChallenge: silentRequest.codeChallenge,
      codeChallengeMethod: "S256",
      codeHash: await hashOAuthSecret(generateOpaqueSecret()),
      expiresAt: new Date(Date.now() + 60_000),
      grantId: `oauth-pg-silent-grant-${suffix}`,
      id: `oauth-pg-silent-code-${suffix}`,
      identityScopes: [],
      nonce: null,
      organizationId: null,
      preserveExistingGrant: true,
      redirectUri: silentRequest.redirectUri,
      requestId: silentRequest.id,
      resource: silentRequest.resource,
      scopes: silentRequest.requestedScopes,
      userId: silentUserId,
    });
    assert.equal(silent.grant.id, silentGrant.id);
    assert.equal(silent.grant.authorizedAt.toISOString(), authorizedAt);
    await stores.grants.revoke({ grantId: silent.grant.id, reason: "test revoke" });
    const revokedSilentRequest = await stores.authorizationRequests.create({
      ...silentRequest,
      id: `oauth-pg-silent-revoked-${suffix}`,
      requestHash: `oauth-pg-silent-revoked-hash-${suffix}`,
    });
    await assert.rejects(
      stores.completeAuthorization({
        authenticatedAt: new Date(),
        authenticationMethods: ["passkey"],
        clientId: client.id,
        codeChallenge: revokedSilentRequest.codeChallenge,
        codeChallengeMethod: "S256",
        codeHash: await hashOAuthSecret(generateOpaqueSecret()),
        expiresAt: new Date(Date.now() + 60_000),
        grantId: `must-not-exist-${suffix}`,
        id: `must-not-be-issued-${suffix}`,
        identityScopes: [],
        nonce: null,
        organizationId: null,
        preserveExistingGrant: true,
        redirectUri: revokedSilentRequest.redirectUri,
        requestId: revokedSilentRequest.id,
        resource: revokedSilentRequest.resource,
        scopes: revokedSilentRequest.requestedScopes,
        userId: silentUserId,
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "consent_required"
    );
    const reauthorization = await stores.authorizationRequests.create({
      clientId: client.id,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 60_000),
      id: `oauth-pg-reauthorization-${suffix}`,
      identityScopes: [],
      redirectUri: request.redirectUri,
      requestHash: `oauth-pg-reauthorization-hash-${suffix}`,
      requestedScopes: ["invoice:read"],
      resource: request.resource,
      stateCiphertext: "state",
    });
    const refreshedGrant = await stores.completeAuthorization({
      authenticatedAt: new Date("2026-10-02T12:00:00.000Z"),
      authenticationMethods: ["password"],
      clientId: client.id,
      codeChallenge: reauthorization.codeChallenge,
      codeChallengeMethod: "S256",
      codeHash: await hashOAuthSecret(generateOpaqueSecret()),
      expiresAt: new Date(Date.now() + 60_000),
      grantId: `oauth-pg-grant-refresh-${suffix}`,
      id: `oauth-pg-code-refresh-${suffix}`,
      identityScopes: [],
      organizationId: null,
      redirectUri: reauthorization.redirectUri,
      requestId: reauthorization.id,
      resource: reauthorization.resource,
      scopes: ["invoice:read"],
      userId,
    });
    assert.equal(refreshedGrant.grant.id, winner.completed.grant.id);
    assert.deepEqual(refreshedGrant.grant.identityScopes, []);
    const activeGrantPage = await stores.grants.list({
      clientId: client.id,
      limit: 1,
      offset: 0,
      organizationId: null,
      resource: request.resource,
      status: "active",
      userId,
    });
    assert.equal(activeGrantPage.total, 1);
    assert.equal(activeGrantPage.grants[0]?.id, winner.completed.grant.id);
    const grants = await stores.grants.list({
      clientId: client.id,
      resource: request.resource,
      userId,
    });
    assert.equal(grants.total, 1);
    assert.equal(grants.grants[0]?.id, winner.completed.grant.id);

    const codeHash = await hashOAuthSecret(winner.rawCode);
    const consumed = await Promise.all(
      Array.from({ length: 20 }, () =>
        stores.authorizationCodes.consume({
          clientId: client.id,
          codeChallenge: request.codeChallenge,
          codeHash,
          redirectUri: request.redirectUri,
          resource: request.resource,
        })
      )
    );
    assert.equal(consumed.filter(Boolean).length, 1);

    const rawRefresh = generateOpaqueSecret();
    const familyId = `oauth-pg-family-${suffix}`;
    await stores.refreshTokens.create({
      clientId: client.id,
      expiresAt: new Date(Date.now() + 60_000),
      familyId,
      grantId: winner.completed.grant.id,
      id: `oauth-pg-refresh-${suffix}`,
      identityScopes: ["openid", "email"],
      organizationId: null,
      resource: request.resource,
      scopes: request.requestedScopes,
      tokenHash: await hashOAuthSecret(rawRefresh),
      userId,
    });
    const rotations = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const replacement = generateOpaqueSecret();
        return stores.refreshTokens.rotate({
          clientId: client.id,
          replacement: {
            clientId: client.id,
            expiresAt: new Date(Date.now() + 60_000),
            familyId,
            grantId: winner.completed.grant.id,
            id: `oauth-pg-refresh-${suffix}-${index}`,
            identityScopes: ["openid"],
            organizationId: null,
            parentTokenId: `oauth-pg-refresh-${suffix}`,
            resource: request.resource,
            scopes: request.requestedScopes,
            tokenHash: await hashOAuthSecret(replacement),
            userId,
          },
          resource: request.resource,
          tokenHash: await hashOAuthSecret(rawRefresh),
        });
      })
    );
    assert.equal(
      rotations.filter((result) => result.kind === "rotated").length,
      1
    );
    assert.equal(
      rotations.filter((result) => result.kind === "replay").length,
      19
    );
    const rotated = rotations.find((result) => result.kind === "rotated");
    assert.ok(rotated && rotated.kind === "rotated");
    assert.deepEqual(rotated.previous.identityScopes, ["openid", "email"]);
    assert.deepEqual(rotated.replacement.identityScopes, ["openid"]);
    await database.query(
      `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
       SET expires_at = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [winner.completed.grant.id]
    );
    const expiredGrantPage = await stores.grants.list({ status: "expired" });
    assert.ok(
      expiredGrantPage.grants.some(
        (value) => value.id === winner.completed.grant.id
      )
    );
    await stores.grants.revoke({
      grantId: winner.completed.grant.id,
      reason: "test revocation",
      revokedBy: userId,
    });
    const revokedGrantPage = await stores.grants.list({
      status: "revoked",
      userId,
    });
    assert.equal(revokedGrantPage.total, 1);
    assert.equal(revokedGrantPage.grants[0]?.revokedBy, userId);
  } finally {
    await database.close?.();
  }
});

maybe("Postgres OAuth code exchange rolls back code consumption on issuance failure", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const userId = `oauth-pg-atomic-user-${suffix}`;
  const issuer = "https://issuer.example";
  const config = normalizeAthenaAuthConfig({
    authorizationServer: {
      enabled: true,
      issuer,
      resources: {
        "https://resource.example": {
          scopes: { "invoice:read": {} },
        },
      },
    },
    mode: "local",
    secret: `oauth-pg-atomic-secret-${suffix}`,
  });
  try {
    await migrateAthenaAuthSchema(database);
    await new PostgresAuthorizationStore(database).ensureCatalog();
    const authStores = new PostgresAuthStores(database);
    await authStores.createUser({
      email: `oauth-pg-atomic-${suffix}@example.com`,
      id: userId,
      name: "Atomic OAuth PG User",
    });
    const stores = createPostgresOAuthAuthorizationServerStores(database);
    const client = await stores.clients.create({
      clientName: "Postgres atomic exchange",
      id: `oauth-pg-atomic-client-${suffix}`,
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://resource.example"],
      scopes: ["invoice:read"],
    });
    const verifier = "a".repeat(43);
    const code = generateOpaqueSecret();
    const codeHash = await hashOAuthSecret(code);
    const codeChallenge = await generateCodeChallenge(verifier);
    const grant = await stores.grants.authorize({
      clientId: client.id,
      organizationId: null,
      resource: "https://resource.example",
      scopes: ["invoice:read"],
      userId,
    });
    await stores.authorizationCodes.create({
      authenticationMethods: ["passkey"],
      authenticatedAt: new Date("2026-01-01T00:00:00Z"),
      clientId: client.id,
      codeChallenge,
      codeChallengeMethod: "S256",
      codeHash,
      expiresAt: new Date(Date.now() + 60_000),
      grantId: grant.id,
      id: `oauth-pg-atomic-code-${suffix}`,
      identityScopes: [],
      organizationId: null,
      redirectUri: "https://client.example/callback",
      resource: "https://resource.example",
      scopes: ["invoice:read"],
      userId,
    });
    const keyStore = new MemoryTokenKeyStore();
    const service = new OAuthAuthorizationServerService({
      config: config.authorizationServer,
      issuer,
      keyStore,
      signing: createTestOAuthSigning(config.authorizationServer, keyStore),
      stateSecret: config.secret as string,
      stores,
      userIsEligible: () => true,
    });
    const input = {
      clientId: client.id,
      code,
      codeVerifier: verifier,
      redirectUri: "https://client.example/callback",
      resource: "https://resource.example",
    };

    await assert.rejects(
      database.transaction(async (txDb) =>
        service
          .withMutationScope({
            oauth: createPostgresOAuthAuthorizationServerStores(txDb, {
              transactionBound: true,
            }),
            stores: new PostgresAuthStores(txDb),
            tokenKeys: new FailingTokenKeyStore(),
          })
          .exchangeAuthorizationCode(input)
      ),
      /signing key persistence failed/
    );

    const retry = await database.transaction(async (txDb) =>
      service
        .withMutationScope({
          oauth: createPostgresOAuthAuthorizationServerStores(txDb, {
            transactionBound: true,
          }),
          stores: new PostgresAuthStores(txDb),
          tokenKeys: new PostgresTokenKeyStore({
            database: txDb,
            encryptionSecret: config.secret as string,
            issuer,
            transactionBound: true,
          }),
        })
        .exchangeAuthorizationCode(input)
    );
    assert.ok(retry.accessToken);
    assert.ok(retry.refreshToken);
  } finally {
    await database.close?.();
  }
});

maybe("Postgres legacy role writers preserve canonical additional assignments", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const adminId = `authz-admin-${suffix}`;
  const userId = `authz-user-${suffix}`;
  const organizationId = `authz-org-${suffix}`;
  try {
    await migrateAthenaAuthSchema(database);
    const authorization = new PostgresAuthorizationStore(database);
    await authorization.ensureCatalog();
    const stores = new PostgresAuthStores(database);
    const platformAdmin = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === PLATFORM_ADMIN_ROLE
    );
    const organizationOwner = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === ORGANIZATION_OWNER_ROLE
    );
    assert.ok(platformAdmin);
    assert.ok(organizationOwner);

    await database.transaction((tx) =>
      new PostgresAdminAuthStore(tx).createUser(
        {
          email: `${adminId}@example.com`,
          id: adminId,
          role: "admin",
        },
        adminId
      )
    );
    await database.transaction((tx) =>
      new PostgresAdminAuthStore(tx).createUser(
        {
          email: `${userId}@example.com`,
          id: userId,
          role: "customer",
        },
        adminId
      )
    );
    const createdAssignment = await authorization.readUserRoleAssignmentsSnapshot({
      userIds: [userId],
    });
    assert.deepEqual(createdAssignment.assignments[0]?.roleIds, [
      PLATFORM_CUSTOMER_ROLE,
    ]);
    await authorization.replaceUserRoleAssignments({
      actorRights: platformAdmin.rights,
      actorUserId: adminId,
      expectedVersion: createdAssignment.revision,
      roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
      userId,
    });
    await database.transaction((tx) =>
      new PostgresAdminAuthStore(tx).updateUser({ role: "admin", userId }, adminId)
    );
    const platformAssignments = await authorization.readUserRoleAssignmentsSnapshot({
      userIds: [userId],
    });
    const platformAssignment = platformAssignments.assignments[0];
    assert.ok(platformAssignment);
    assert.deepEqual(
      [...platformAssignment.roleIds].sort(),
      [
        "billing_admin",
        PLATFORM_ADMIN_ROLE,
      ]
    );
    const platformProvenance = await database.query<{
      assigned_by: string | null;
    }>(
      `SELECT ur.assigned_by
       FROM athena.authorization_user_roles ur
       JOIN athena.authorization_roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.key = $2`,
      [userId, PLATFORM_ADMIN_ROLE]
    );
    assert.equal(platformProvenance.rows[0]?.assigned_by, adminId);

    await stores.createOrganization({
      createdByUserId: adminId,
      id: organizationId,
      name: "Authorization Integrity",
      slug: organizationId,
    });
    await stores.addMember({
      id: `${organizationId}-member`,
      organizationId,
      role: "member",
      userId,
    });
    const reviewer = await authorization.createRole({
      actorRights: organizationOwner.rights,
      actorUserId: adminId,
      name: "Security reviewer",
      organizationId,
      rights: ["organization.members.read"],
      scopeKind: "organization",
    });
    const memberAssignments =
      await authorization.readMemberRoleAssignmentsSnapshot({
        organizationId,
      });
    await authorization.replaceMemberRoleAssignments({
      actorRights: organizationOwner.rights,
      actorUserId: adminId,
      expectedVersion: memberAssignments.revision,
      memberId: `${organizationId}-member`,
      memberUserId: userId,
      organizationId,
      roleIds: [ORGANIZATION_MEMBER_ROLE, reviewer.id],
    });
    await stores.updateMemberRole(organizationId, userId, "admin", adminId);
    const organizationAssignments =
      await authorization.readMemberRoleAssignmentsSnapshot({
        organizationId,
      });
    const organizationAssignment = organizationAssignments.assignments[0];
    assert.ok(organizationAssignment);
    assert.deepEqual(
      [...organizationAssignment.roleIds].sort(),
      [reviewer.id, "organization_admin"]
    );
    const memberProvenance = await database.query<{
      assigned_by: string | null;
    }>(
      `SELECT mr.assigned_by
       FROM athena.authorization_member_roles mr
       JOIN athena.authorization_roles r ON r.id = mr.role_id
       WHERE mr.member_id = $1 AND r.key = 'organization_admin'`,
      [`${organizationId}-member`]
    );
    assert.equal(memberProvenance.rows[0]?.assigned_by, adminId);
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

maybe("Postgres assignment replacement retains provenance and treats reductions and no-ops correctly", async () => {
  const database = await createPostgresAuthDatabase(url as string);
  const suffix = crypto.randomUUID();
  const adminId = `authz-diff-admin-${suffix}`;
  const userId = `authz-diff-user-${suffix}`;
  const organizationId = `authz-diff-org-${suffix}`;
  const memberId = `${organizationId}-member`;
  try {
    await migrateAthenaAuthSchema(database);
    const authorization = new PostgresAuthorizationStore(database);
    await authorization.ensureCatalog();
    const stores = new PostgresAuthStores(database);
    const adminStore = new PostgresAdminAuthStore(database);
    const platformAdmin = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === PLATFORM_ADMIN_ROLE
    );
    const organizationOwner = BUILTIN_AUTHORIZATION_ROLES.find(
      (role) => role.key === ORGANIZATION_OWNER_ROLE
    );
    assert.ok(platformAdmin);
    assert.ok(organizationOwner);
    await adminStore.createUser({
      email: `${adminId}@example.com`,
      id: adminId,
      role: "admin",
    });
    await stores.createUser({
      email: `${userId}@example.com`,
      id: userId,
    });

    const platform = await authorization.readUserRoleAssignmentsSnapshot({
      userIds: [userId],
    });
    const basePlatform = await authorization.replaceUserRoleAssignments({
      actorRights: platformAdmin.rights,
      actorUserId: adminId,
      expectedVersion: platform.revision,
      roleIds: [PLATFORM_CUSTOMER_ROLE],
      userId,
    });
    const beforePlatformGrant = await database.query<{
      assigned_by: string | null;
      created_at: string;
    }>(
      `SELECT ur.assigned_by, ur.created_at::text
       FROM athena.authorization_user_roles ur
       JOIN athena.authorization_roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.key = $2`,
      [userId, PLATFORM_CUSTOMER_ROLE]
    );
    const expanded = await authorization.replaceUserRoleAssignments({
      actorRights: platformAdmin.rights,
      actorUserId: adminId,
      expectedVersion: basePlatform.revision,
      roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
      userId,
    });
    const afterPlatformGrant = await database.query<{
      assigned_by: string | null;
      created_at: string;
      key: string;
    }>(
      `SELECT ur.assigned_by, ur.created_at::text, r.key
       FROM athena.authorization_user_roles ur
       JOIN athena.authorization_roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.key = ANY($2::text[])
       ORDER BY r.key`,
      [userId, [PLATFORM_CUSTOMER_ROLE, "billing_admin"]]
    );
    const originalPlatformGrant = beforePlatformGrant.rows[0];
    const retainedPlatformGrant = afterPlatformGrant.rows.find(
      (row) => row.key === PLATFORM_CUSTOMER_ROLE
    );
    const addedPlatformGrant = afterPlatformGrant.rows.find(
      (row) => row.key === "billing_admin"
    );
    assert.ok(originalPlatformGrant);
    assert.ok(retainedPlatformGrant);
    assert.ok(addedPlatformGrant);
    assert.equal(retainedPlatformGrant.assigned_by, originalPlatformGrant.assigned_by);
    assert.equal(retainedPlatformGrant.created_at, originalPlatformGrant.created_at);
    assert.equal(addedPlatformGrant.assigned_by, adminId);

    const beforeNoop = await authorization.readUserRoleAssignmentsSnapshot({
      userIds: [userId],
    });
    const auditBeforeNoop = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM athena.authorization_audit_log
       WHERE action = 'user.roles.replace' AND target_id = $1`,
      [userId]
    );
    const noOp = await authorization.replaceUserRoleAssignments({
      actorRights: platformAdmin.rights,
      actorUserId: adminId,
      expectedVersion: beforeNoop.revision,
      roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
      userId,
    });
    const auditAfterNoop = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM athena.authorization_audit_log
       WHERE action = 'user.roles.replace' AND target_id = $1`,
      [userId]
    );
    assert.equal(noOp.revision, beforeNoop.revision);
    assert.equal(auditAfterNoop.rows[0]?.count, auditBeforeNoop.rows[0]?.count);
    assert.ok(expanded.revision > basePlatform.revision);

    await stores.createOrganization({
      createdByUserId: adminId,
      id: organizationId,
      name: "Authorization assignment differential",
      slug: organizationId,
    });
    await stores.addMember({
      assignedBy: adminId,
      id: memberId,
      organizationId,
      role: "member",
      userId,
    });
    const reviewer = await authorization.createRole({
      actorRights: organizationOwner.rights,
      actorUserId: adminId,
      name: "Review access",
      organizationId,
      rights: ["organization.members.read"],
      scopeKind: "organization",
    });
    const beforeMember = await authorization.readMemberRoleAssignmentsSnapshot({
      organizationId,
    });
    const expandedMember = await authorization.replaceMemberRoleAssignments({
      actorRights: organizationOwner.rights,
      actorUserId: adminId,
      expectedVersion: beforeMember.revision,
      memberId,
      memberUserId: userId,
      organizationId,
      roleIds: [ORGANIZATION_MEMBER_ROLE, reviewer.id],
    });
    const beforeMemberGrant = await database.query<{
      assigned_by: string | null;
      created_at: string;
    }>(
      `SELECT mr.assigned_by, mr.created_at::text
       FROM athena.authorization_member_roles mr
       JOIN athena.authorization_roles r ON r.id = mr.role_id
       WHERE mr.member_id = $1 AND r.key = $2`,
      [memberId, ORGANIZATION_MEMBER_ROLE]
    );
    const reducedMember = await authorization.replaceMemberRoleAssignments({
      actorRights: [],
      actorUserId: adminId,
      expectedVersion: expandedMember.revision,
      memberId,
      memberUserId: userId,
      organizationId,
      roleIds: [ORGANIZATION_MEMBER_ROLE],
    });
    const afterMemberGrant = await database.query<{
      assigned_by: string | null;
      created_at: string;
    }>(
      `SELECT mr.assigned_by, mr.created_at::text
       FROM athena.authorization_member_roles mr
       JOIN athena.authorization_roles r ON r.id = mr.role_id
       WHERE mr.member_id = $1 AND r.key = $2`,
      [memberId, ORGANIZATION_MEMBER_ROLE]
    );
    assert.equal(
      afterMemberGrant.rows[0]?.assigned_by,
      beforeMemberGrant.rows[0]?.assigned_by
    );
    assert.equal(
      afterMemberGrant.rows[0]?.created_at,
      beforeMemberGrant.rows[0]?.created_at
    );
    const memberNoOp = await authorization.replaceMemberRoleAssignments({
      actorRights: [],
      actorUserId: adminId,
      expectedVersion: reducedMember.revision,
      memberId,
      memberUserId: userId,
      organizationId,
      roleIds: [ORGANIZATION_MEMBER_ROLE],
    });
    assert.equal(memberNoOp.revision, reducedMember.revision);
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
