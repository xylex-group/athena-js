/**
 * Embedded Admin Auth runtime + public namespace.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createAuthModule } from "../src/auth/client.ts";
import { ATHENA_AUTH_CREDENTIAL_PROVIDER_ID } from "../src/auth/contract/index.ts";
import {
  assertPublicAdminUserSafe,
  canAssignRole,
} from "../src/auth/local/admin-contract.ts";
import { MemoryAuthStores } from "../src/auth/local/memory-stores.ts";
import { withPasswordHash } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import {
  createAuthRequestMiddleware,
  createAuthRouter,
} from "../src/auth/local/runtime.ts";
import { createRuntimeDependencies } from "../src/auth/local/runtime-dependencies.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  ORGANIZATION_MEMBER_ROLE,
  ORGANIZATION_OWNER_ROLE,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_CUSTOMER_ROLE,
  PLATFORM_UNAUTHORIZED_ROLE,
} from "../src/runtime/authorization/templates.ts";
import { createClient } from "../src/v3-client.ts";

function createTestHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash() {
      return false;
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

async function seedAdmin(
  stores: MemoryAuthStores,
  hasher = createTestHasher()
) {
  const hash = await hasher.hash("AdminPass123!");
  await stores.createUser({
    email: "admin@example.com",
    emailVerified: true,
    id: "admin-1",
    metadata: withPasswordHash({}, hash),
    name: "Admin",
    username: "admin",
  });
  await stores.updateUser("admin-1", { role: "admin" });
  await stores.createAccount({
    accountId: "admin-1",
    id: "acct-admin",
    password: hash,
    providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
    userId: "admin-1",
  });
}

async function signIn(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  email = "admin@example.com",
  password = "AdminPass123!"
) {
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/sign-in/email", {
      body: JSON.stringify({ email, password }),
      headers: {
        "content-type": "application/json",
        origin: "http://app.local",
      },
      method: "POST",
    })
  );
  const cookie = response.headers.get("set-cookie") ?? "";
  const body = (await response.json()) as { token?: string };
  return { cookie, status: response.status, token: body.token };
}

test("T-ADMIN-01 canAssignRole prevents privilege escalation", () => {
  assert.equal(canAssignRole("admin", "user"), true);
  assert.equal(canAssignRole("admin", "admin"), false);
  assert.equal(canAssignRole("admin", "superadmin"), false);
  assert.equal(canAssignRole("admin", "owner"), false);
  assert.equal(canAssignRole("superadmin", "admin"), true);
  assert.equal(canAssignRole("superadmin", "owner"), false);
  assert.equal(canAssignRole("owner", "superadmin"), true);
  assert.equal(canAssignRole("user", "admin"), false);
});

test("T-ADMIN-02 runtime wires listUsers without FEATURE_UNSUPPORTED", async () => {
  const stores = new MemoryAuthStores();
  const hasher = createTestHasher();
  await seedAdmin(stores, hasher);
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher,
    stores,
  });
  const { cookie, status } = await signIn(runtime);
  assert.equal(status, 200);
  const listed = await runtime.handle(
    new Request("http://app.local/api/auth/admin/list-users", {
      headers: { cookie, origin: "http://app.local" },
    })
  );
  assert.equal(listed.status, 200);
  const body = (await listed.json()) as {
    users: Array<Record<string, unknown>>;
  };
  assert.ok(body.users.length >= 1);
  assertPublicAdminUserSafe(body.users[0]);
});

test("T-ADMIN-03 createUser produces a sign-inable credential", async () => {
  const stores = new MemoryAuthStores();
  const hasher = createTestHasher();
  await seedAdmin(stores, hasher);
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher,
    stores,
  });
  const { cookie } = await signIn(runtime);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/admin/create-user", {
      body: JSON.stringify({
        email: "member@example.com",
        name: "Member",
        password: "MemberPass123!",
      }),
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://app.local",
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200, await created.clone().text());
  const createdBody = (await created.json()) as { user: { id: string } };
  assertPublicAdminUserSafe(createdBody);
  const assignments = await stores.authorization.readUserRoleAssignmentsSnapshot({
    userIds: [createdBody.user.id],
  });
  assert.deepEqual(assignments.assignments[0]?.roleIds, [
    PLATFORM_UNAUTHORIZED_ROLE,
  ]);
  const signed = await signIn(runtime, "member@example.com", "MemberPass123!");
  assert.equal(signed.status, 200);
});

test("legacy platform role updates preserve additional role assignments", async () => {
  const stores = new MemoryAuthStores();
  await stores.createUser({ email: "admin@example.com", id: "admin-1" });
  await stores.updateUser("admin-1", { role: "admin" });
  await stores.createUser({ email: "target@example.com", id: "target-1" });
  const admin = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === PLATFORM_ADMIN_ROLE
  );
  assert.ok(admin);
  const snapshot = await stores.authorization.readUserRoleAssignmentsSnapshot();
  await stores.authorization.replaceUserRoleAssignments({
    actorRights: admin.rights,
    actorUserId: "admin-1",
    expectedVersion: snapshot.revision,
    roleIds: [PLATFORM_CUSTOMER_ROLE, "billing_admin"],
    userId: "target-1",
  });

  await stores.updateUser("target-1", { role: "admin" });

  const assigned = await stores.authorization.readUserRoleAssignmentsSnapshot({
    userIds: ["target-1"],
  });
  const assignment = assigned.assignments[0];
  assert.ok(assignment);
  assert.deepEqual([...assignment.roleIds].sort(), [
    "billing_admin",
    PLATFORM_ADMIN_ROLE,
  ]);
});

test("legacy organization role updates preserve additional role assignments", async () => {
  const stores = new MemoryAuthStores();
  await stores.createUser({ email: "member@example.com", id: "member-user" });
  await stores.addMember({
    id: "member-1",
    organizationId: "org-1",
    role: "member",
    userId: "member-user",
  });
  const owner = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === ORGANIZATION_OWNER_ROLE
  );
  assert.ok(owner);
  const reviewer = await stores.authorization.createRole({
    actorRights: owner.rights,
    actorUserId: "owner-1",
    name: "Security reviewer",
    organizationId: "org-1",
    rights: ["organization.members.read"],
    scopeKind: "organization",
    unrestrictedGrant: true,
  });
  const snapshot = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: "org-1",
  });
  await stores.authorization.replaceMemberRoleAssignments({
    actorRights: owner.rights,
    actorUserId: "owner-1",
    expectedVersion: snapshot.revision,
    memberId: "member-1",
    memberUserId: "member-user",
    organizationId: "org-1",
    roleIds: [ORGANIZATION_MEMBER_ROLE, reviewer.id],
  });

  await stores.updateMemberRole("org-1", "member-user", "admin");

  const assigned = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: "org-1",
  });
  const assignment = assigned.assignments[0];
  assert.ok(assignment);
  assert.deepEqual([...assignment.roleIds].sort(), [
    reviewer.id,
    "organization_admin",
  ]);
});

test("T-ADMIN-04 expired ban is treated as unbanned", async () => {
  const stores = new MemoryAuthStores();
  const hasher = createTestHasher();
  await seedAdmin(stores, hasher);
  const hash = await hasher.hash("BannedPass123!");
  await stores.createUser({
    email: "banned@example.com",
    id: "banned-1",
    metadata: withPasswordHash({}, hash),
    name: "Banned",
  });
  await stores.updateUser("banned-1", {
    banExpires: new Date(Date.now() - 60_000),
    banned: true,
    banReason: "old",
  });
  await stores.createAccount({
    accountId: "banned-1",
    id: "acct-banned",
    password: hash,
    providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
    userId: "banned-1",
  });
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher,
    stores,
  });
  const signed = await signIn(runtime, "banned@example.com", "BannedPass123!");
  assert.equal(signed.status, 200);
  const refreshed = await stores.getUserById("banned-1");
  assert.equal(refreshed?.banned, false);
});

test("T-ADMIN-05 active ban rejects sign-in and session", async () => {
  const stores = new MemoryAuthStores();
  const hasher = createTestHasher();
  await seedAdmin(stores, hasher);
  const hash = await hasher.hash("StillBanned123!");
  await stores.createUser({
    email: "still@example.com",
    id: "still-1",
    metadata: withPasswordHash({}, hash),
    name: "Still",
  });
  await stores.updateUser("still-1", { banned: true });
  await stores.createAccount({
    accountId: "still-1",
    id: "acct-still",
    password: hash,
    providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
    userId: "still-1",
  });
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher,
    stores,
  });
  const signed = await signIn(runtime, "still@example.com", "StillBanned123!");
  assert.equal(signed.status, 403);
});

test("T-ADMIN-06 non-admin is forbidden", async () => {
  const stores = new MemoryAuthStores();
  const hasher = createTestHasher();
  await seedAdmin(stores, hasher);
  const hash = await hasher.hash("UserPass123!");
  await stores.createUser({
    email: "user@example.com",
    id: "user-1",
    metadata: withPasswordHash({}, hash),
    name: "User",
  });
  await stores.createAccount({
    accountId: "user-1",
    id: "acct-user",
    password: hash,
    providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
    userId: "user-1",
  });
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher,
    stores,
  });
  const { cookie } = await signIn(runtime, "user@example.com", "UserPass123!");
  const listed = await runtime.handle(
    new Request("http://app.local/api/auth/admin/list-users", {
      headers: { cookie, origin: "http://app.local" },
    })
  );
  assert.equal(listed.status, 403);
  const oauthClients = await runtime.handle(
    new Request(
      "http://app.local/api/auth/admin/authorization-server/client/list",
      {
        headers: { cookie, origin: "http://app.local" },
      }
    )
  );
  assert.equal(oauthClients.status, 403);
});

test("Authorization Server admin manages pre-registered clients", async () => {
  const stores = new MemoryAuthStores();
  const hasher = createTestHasher();
  await seedAdmin(stores, hasher);
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher,
    stores,
  });
  const { cookie } = await signIn(runtime);
  const call = (path: string, method = "GET", body?: unknown) =>
    runtime.handle(
      new Request(`http://app.local/api/auth${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          cookie,
          origin: "http://app.local",
          "content-type": "application/json",
        },
        method,
      })
    );
  const created = await call(
    "/admin/authorization-server/client/create",
    "POST",
    {
      clientName: "Issuer app",
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://api.example"],
      scopes: ["read"],
    }
  );
  assert.equal(created.status, 200);
  const { client } = (await created.json()) as {
    client: Record<string, unknown>;
  };
  assert.equal(client.clientType, "public");
  assert.equal(client.registrationKind, "pre-registered");
  assert.equal(client.responseType, "code");
  assert.equal(client.grantType, "authorization_code");
  assert.equal(client.tokenEndpointAuthMethod, "none");
  assert.equal(typeof client.createdAt, "string");
  assert.equal(typeof client.updatedAt, "string");
  assert.equal(client.provider, undefined);
  const spoofedCreate = await call(
    "/admin/authorization-server/client/create",
    "POST",
    {
      clientName: "Spoofed app",
      clientType: "confidential",
      provider: "github",
      redirectUris: ["https://client.example/other"],
      resourceUris: ["https://api.example"],
      scopes: ["read"],
    }
  );
  assert.equal(spoofedCreate.status, 400);
  const listed = await call("/admin/authorization-server/client/list");
  assert.equal(listed.status, 200);
  const clientPage = (await listed.json()) as {
    clients: Record<string, unknown>[];
    limit: number;
    offset: number;
    total: number;
  };
  assert.equal(clientPage.total, 1);
  assert.equal(clientPage.limit, 50);
  assert.equal(clientPage.offset, 0);
  const clientId = client.id as string;
  const updated = await call(
    "/admin/authorization-server/client/update",
    "POST",
    {
      clientId,
      clientName: "Updated app",
    }
  );
  assert.equal(
    ((await updated.json()) as { client: { clientName: string } }).client
      .clientName,
    "Updated app"
  );
  const blankName = await call(
    "/admin/authorization-server/client/update",
    "POST",
    { clientId, clientName: "   " }
  );
  assert.equal(blankName.status, 400);
  const spoofedUpdate = await call(
    "/admin/authorization-server/client/update",
    "POST",
    { clientId, clientType: "confidential", id: "spoofed-id" }
  );
  assert.equal(spoofedUpdate.status, 400);
  const immutableFields = (await call(
    `/admin/authorization-server/client/get?clientId=${clientId}`
  ).then((response) => response.json())) as {
    client: { clientType: string; id: string; registrationKind: string };
  };
  assert.equal(immutableFields.client.id, clientId);
  assert.equal(immutableFields.client.clientType, "public");
  assert.equal(immutableFields.client.registrationKind, "pre-registered");
  const fetched = await call(
    `/admin/authorization-server/client/get?clientId=${clientId}`
  );
  assert.equal(fetched.status, 200);
  const disabled = await call(
    "/admin/authorization-server/client/disable",
    "POST",
    { clientId }
  );
  assert.equal(disabled.status, 200);
  const disabledAgain = await call(
    "/admin/authorization-server/client/disable",
    "POST",
    { clientId }
  );
  assert.equal(disabledAgain.status, 200);
  const disabledClient = await call(
    `/admin/authorization-server/client/get?clientId=${clientId}`
  );
  assert.equal(
    ((await disabledClient.json()) as { client: { isActive: boolean } }).client
      .isActive,
    false
  );
  const missing = await call(
    "/admin/authorization-server/client/get?clientId=missing"
  );
  assert.equal(missing.status, 404);
});

test("Authorization Server admin writes use transaction-scoped OAuth stores", async () => {
  const stores = new MemoryAuthStores();
  const hasher = createTestHasher();
  await seedAdmin(stores, hasher);
  const deps = createRuntimeDependencies({
    autoMigrate: false,
    hasher,
    stores,
  });
  const { handleRoute } = createAuthRouter(deps);
  const handle = createAuthRequestMiddleware({ deps, handleRoute });
  const login = await handle(
    new Request("http://app.local/api/auth/sign-in/email", {
      body: JSON.stringify({
        email: "admin@example.com",
        password: "AdminPass123!",
      }),
      headers: {
        "content-type": "application/json",
        origin: "http://app.local",
      },
      method: "POST",
    })
  );
  const cookie = login.headers.get("set-cookie") ?? "";
  const originalTransaction = deps.transaction;
  const originalGetOAuthStores = deps.getOAuthStores;
  let transactionCalls = 0;
  let unboundStoreCalls = 0;
  deps.transaction = async (fn) => {
    transactionCalls += 1;
    return originalTransaction(fn);
  };
  deps.getOAuthStores = async () => {
    unboundStoreCalls += 1;
    return originalGetOAuthStores();
  };
  const call = (path: string, method = "GET", body?: unknown) =>
    handle(
      new Request(`http://app.local/api/auth${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          cookie,
          origin: "http://app.local",
          "content-type": "application/json",
        },
        method,
      })
    );

  const invalid = await call(
    "/admin/authorization-server/client/create",
    "POST",
    {
      clientName: "Missing redirect",
      redirectUris: [],
      resourceUris: [],
      scopes: [],
    }
  );
  assert.equal(invalid.status, 400);
  assert.equal(transactionCalls, 0);
  const invalidRedirect = await call(
    "/admin/authorization-server/client/create",
    "POST",
    {
      clientName: "Invalid redirect",
      redirectUris: ["https://user:password@client.example/callback"],
      resourceUris: [],
      scopes: [],
    }
  );
  assert.equal(invalidRedirect.status, 400);
  assert.equal(transactionCalls, 0);

  const created = await call(
    "/admin/authorization-server/client/create",
    "POST",
    {
      clientName: "Issuer app",
      redirectUris: ["https://client.example/callback"],
      resourceUris: ["https://api.example/", "https://api.example"],
      scopes: ["read", " read ", ""],
    }
  );
  assert.equal(created.status, 200);
  assert.equal(transactionCalls, 1);
  assert.equal(unboundStoreCalls, 0);
  const createdClient = (await created.json()) as {
    client: { id: string; resourceUris: string[]; scopes: string[] };
  };
  assert.deepEqual(createdClient.client.resourceUris, ["https://api.example"]);
  assert.deepEqual(createdClient.client.scopes, ["read"]);

  const listed = await call("/admin/authorization-server/client/list");
  assert.equal(listed.status, 200);
  assert.equal(transactionCalls, 1);
  assert.equal(unboundStoreCalls, 1);

  const clientId = createdClient.client.id;
  await call("/admin/authorization-server/client/update", "POST", {
    clientId,
    clientName: "Updated app",
  });
  await call("/admin/authorization-server/client/disable", "POST", {
    clientId,
  });
  assert.equal(transactionCalls, 3);
  assert.equal(unboundStoreCalls, 1);
});

test("Authorization Server grant admin list filters and stamps the revoking admin", async () => {
  const stores = new MemoryAuthStores();
  const hasher = createTestHasher();
  await seedAdmin(stores, hasher);
  const deps = createRuntimeDependencies({
    autoMigrate: false,
    hasher,
    stores,
  });
  const { handleRoute } = createAuthRouter(deps);
  const handle = createAuthRequestMiddleware({ deps, handleRoute });
  const login = await handle(
    new Request("http://app.local/api/auth/sign-in/email", {
      body: JSON.stringify({
        email: "admin@example.com",
        password: "AdminPass123!",
      }),
      headers: {
        "content-type": "application/json",
        origin: "http://app.local",
      },
      method: "POST",
    })
  );
  const cookie = login.headers.get("set-cookie") ?? "";
  const oauth = await deps.getOAuthStores();
  await oauth.clients.create({
    clientName: "Issuer app",
    id: "grant-client",
    redirectUris: ["https://client.example/callback"],
    resourceUris: ["https://api.example"],
    scopes: ["read"],
  });
  const grant = await oauth.grants.authorize({
    clientId: "grant-client",
    organizationId: "org-1",
    resource: "https://api.example",
    scopes: ["read"],
    userId: "user-1",
  });
  const secondGrant = await oauth.grants.authorize({
    clientId: "grant-client",
    organizationId: "org-1",
    resource: "https://api.example",
    scopes: ["read"],
    userId: "user-2",
  });
  const unscopedGrant = await oauth.grants.authorize({
    clientId: "grant-client",
    organizationId: null,
    resource: "https://api.example",
    scopes: ["read"],
    userId: "user-3",
  });
  const originalTransaction = deps.transaction;
  const originalGetOAuthStores = deps.getOAuthStores;
  let transactionCalls = 0;
  let unboundStoreCalls = 0;
  deps.transaction = async (fn) => {
    transactionCalls += 1;
    return originalTransaction(fn);
  };
  deps.getOAuthStores = async () => {
    unboundStoreCalls += 1;
    return originalGetOAuthStores();
  };
  const call = (url: string, method = "GET", body?: unknown) =>
    handle(
      new Request(`http://app.local/api/auth${url}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          cookie,
          origin: "http://app.local",
          "content-type": "application/json",
        },
        method,
      })
    );
  const list = await call(
    "/admin/authorization-server/grant/list?clientId=grant-client&organizationId=org-1&resource=https%3A%2F%2Fapi.example&status=active&limit=1&offset=0"
  );
  assert.equal(list.status, 200);
  const grantPage = (await list.json()) as {
    grants: { authorizedAt: unknown; createdAt: unknown; id: string }[];
    limit: number;
    offset: number;
    total: number;
  };
  assert.equal(grantPage.grants.length, 1);
  assert.equal(grantPage.total, 2);
  assert.equal(grantPage.limit, 1);
  assert.equal(grantPage.offset, 0);
  assert.ok([grant.id, secondGrant.id].includes(grantPage.grants[0]?.id ?? ""));
  assert.equal(typeof grantPage.grants[0]?.authorizedAt, "string");
  assert.equal(typeof grantPage.grants[0]?.createdAt, "string");
  const nullOrganizationList = await call(
    "/admin/authorization-server/grant/list?organizationId="
  );
  assert.equal(nullOrganizationList.status, 200);
  const nullOrganizationPage = (await nullOrganizationList.json()) as {
    grants: { id: string; organizationId: string | null }[];
    total: number;
  };
  assert.deepEqual(
    nullOrganizationPage.grants.map((item) => item.id),
    [unscopedGrant.id]
  );
  assert.equal(nullOrganizationPage.grants[0]?.organizationId, null);
  assert.equal(nullOrganizationPage.total, 1);
  assert.equal(transactionCalls, 0);
  assert.equal(unboundStoreCalls, 2);
  const revoked = await call(
    "/admin/authorization-server/grant/revoke",
    "POST",
    { grantId: grant.id, reason: "user request", revokedBy: "spoofed-admin" }
  );
  assert.equal(revoked.status, 200);
  assert.equal((await oauth.grants.get(grant.id))?.revokedBy, "admin-1");
  assert.equal((await oauth.grants.get(grant.id))?.revokeReason, "user request");
  assert.equal(transactionCalls, 1);
  assert.equal(unboundStoreCalls, 2);
  const missing = await call(
    "/admin/authorization-server/grant/revoke",
    "POST",
    { grantId: "missing", reason: "administrator request" }
  );
  assert.equal(missing.status, 404);
});

test("T-ADMIN-07 admin cannot assign superadmin", async () => {
  const stores = new MemoryAuthStores();
  const hasher = createTestHasher();
  await seedAdmin(stores, hasher);
  const hash = await hasher.hash("TargetPass123!");
  await stores.createUser({
    email: "target@example.com",
    id: "target-1",
    metadata: withPasswordHash({}, hash),
    name: "Target",
  });
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher,
    stores,
  });
  const { cookie } = await signIn(runtime);
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/admin/set-role", {
      body: JSON.stringify({ role: "superadmin", userId: "target-1" }),
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://app.local",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 403);
});

test("T-ADMIN-08 public client namespace is athena.auth.admin.*", () => {
  const client = createAuthModule({
    apiKey: "k",
    baseUrl: "https://auth.example.test",
  });
  assert.equal(typeof client.auth.admin.listUsers, "function");
  assert.equal(typeof client.auth.admin.createUser, "function");
  assert.equal(typeof client.auth.admin.banUser, "function");
  assert.equal(typeof client.auth.admin.impersonateUser, "function");
  assert.equal(typeof client.auth.admin.stopImpersonating, "function");
});

test("T-ADMIN-09 createClient does not reject admin namespace usage", () => {
  const client = createClient({
    auth: { url: "https://auth.example.test" },
    env: {},
    key: "k",
    url: "https://athena.example.com",
  });
  assert.equal(typeof client.auth.admin.listUsers, "function");
});
