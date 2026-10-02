import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createAuthRouter } from "../../src/auth/local/router.ts";
import { createRuntimeDependencies } from "../../src/auth/local/runtime-dependencies.ts";

function testHasher() {
  return {
    async hash(password: string) {
      return `hash:${password}`;
    },
    needsRehash() {
      return false;
    },
    async verify(password: string, hash: string) {
      return hash === `hash:${password}`;
    },
  };
}

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

test("identity connection admin routes validate and manage OIDC connection records", async () => {
  const stores = new MemoryAuthStores();
  const auditEvents: unknown[] = [];
  const deps = createRuntimeDependencies({
    config: normalizeAthenaAuthConfig({
      mode: "local",
      secret: "identity-connection-test-secret",
    }),
    hasher: testHasher(),
    hooks: {
      after: {
        "identity.connection.create": (event) => auditEvents.push(event),
        "identity.connection.disable": (event) => auditEvents.push(event),
        "identity.connection.update": (event) => auditEvents.push(event),
      },
    },
    stores,
  });
  const ready = await deps.ensureReady();
  const router = createAuthRouter(deps);
  const signUp = await router.handleRoute(
    new Request("https://auth.example/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "identity-admin@example.com",
        name: "Identity Admin",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    "/sign-up/email",
    ready,
    new Headers(),
    "trace-identity-connection"
  );
  const cookie = cookieOf(signUp);
  const user = await stores.getUserByEmail("identity-admin@example.com");
  assert.ok(user);
  await stores.updateUser(user.id, { role: "admin" });
  await stores.createOrganization({
    createdByUserId: user.id,
    id: "org-identity-test",
    name: "Identity Test",
    slug: "identity-test",
  });
  const defaultRole = await stores.authorization.lookupAssignableOrganizationRole(
    "org-identity-test",
    "organization_member"
  );
  assert.ok(defaultRole);
  const call = (path: string, request: Request) =>
    router.handleRoute(
      request,
      path,
      ready,
      new Headers(),
      "trace-identity-connection"
    );
  await assert.rejects(
    call(
      "/admin/identity-connection/create",
      new Request("https://auth.example/api/auth/admin/identity-connection/create", {
        body: JSON.stringify({
          clientId: "insecure-client",
          issuer: "http://id.example.com/tenant",
          name: "Insecure SSO",
          organizationId: "org-identity-test",
        }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      })
    ),
    { status: 400 }
  );
  await assert.rejects(
    call(
      "/admin/identity-connection/create",
      new Request("https://auth.example/api/auth/admin/identity-connection/create", {
        body: JSON.stringify({
          clientId: "invalid-role-client",
          issuer: "https://id.example.com/tenant",
          jitDefaultRoleId: "missing-role",
          jitEnabled: true,
          name: "Invalid role SSO",
          organizationId: "org-identity-test",
        }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      })
    ),
    { status: 400 }
  );
  const create = await call(
    "/admin/identity-connection/create",
    new Request("https://auth.example/api/auth/admin/identity-connection/create", {
      body: JSON.stringify({
        clientId: "enterprise-client",
        credentialRef: "vault://enterprise-secret",
        domains: ["EXAMPLE.COM", "example.com"],
        issuer: "https://id.example.com/tenant/v2.0",
        jitDefaultRoleId: defaultRole.id,
        jitEnabled: true,
        name: "Enterprise SSO",
        organizationId: "org-identity-test",
        tokenEndpointAuthMethod: "client_secret_post",
      }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(create.status, 201);
  const created = (await create.json()) as {
    connection: {
      clientId: string;
      credentialRef: string | null;
      domains: string[];
      enabled: boolean;
      id: string;
      issuer: string;
      jitEnabled: boolean;
      jitDefaultRoleId: string | null;
      tokenEndpointAuthMethod: string;
    };
  };
  assert.equal(created.connection.clientId, "enterprise-client");
  assert.equal(created.connection.credentialRef, "vault://enterprise-secret");
  assert.deepEqual(created.connection.domains, ["example.com"]);
  assert.equal(created.connection.enabled, false);
  assert.equal(created.connection.jitEnabled, true);
  assert.equal(created.connection.jitDefaultRoleId, defaultRole.id);

  assert.equal(created.connection.tokenEndpointAuthMethod, "client_secret_post");

  await assert.rejects(
    call(
      "/admin/identity-connection/update",
      new Request("https://auth.example/api/auth/admin/identity-connection/update", {
        body: JSON.stringify({
          clientId: "rotated-client",
          connectionId: created.connection.id,
          enabled: true,
          issuer: "https://evil.example",
        }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      })
    ),
    { status: 400 }
  );
  await assert.rejects(
    call(
      "/admin/identity-connection/update",
      new Request("https://auth.example/api/auth/admin/identity-connection/update", {
        body: JSON.stringify({
          connectionId: created.connection.id,
          jitDefaultRoleId: "missing-role",
        }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      })
    ),
    { status: 400 }
  );
  const updated = await call(
    "/admin/identity-connection/update",
    new Request("https://auth.example/api/auth/admin/identity-connection/update", {
      body: JSON.stringify({
        clientId: "rotated-client",
        connectionId: created.connection.id,
        enabled: true,
      }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(updated.status, 200);
  const updatedBody = (await updated.json()) as { connection: { clientId: string; enabled: boolean; issuer: string } };
  assert.equal(updatedBody.connection.clientId, "rotated-client");
  assert.equal(updatedBody.connection.enabled, true);
  assert.equal(updatedBody.connection.issuer, "https://id.example.com/tenant/v2.0");

  await assert.rejects(
    call(
      "/admin/identity-connection/create",
      new Request("https://auth.example/api/auth/admin/identity-connection/create", {
        body: JSON.stringify({
          clientId: "duplicate-domain-client",
          domains: ["example.com"],
          enabled: true,
          issuer: "https://other-id.example.com",
          name: "Duplicate SSO",
          organizationId: "org-identity-test",
        }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      })
    ),
    { status: 409 }
  );

  const list = await call(
    "/admin/identity-connection/list",
    new Request("https://auth.example/api/auth/admin/identity-connection/list?organizationId=org-identity-test", {
      headers: { cookie },
    })
  );
  assert.equal(list.status, 200);
  const listed = (await list.json()) as { connections: { id: string }[]; total: number };
  assert.equal(listed.total, 1);
  assert.equal(listed.connections[0]?.id, created.connection.id);

  const disable = () =>
    call(
      "/admin/identity-connection/disable",
      new Request("https://auth.example/api/auth/admin/identity-connection/disable", {
        body: JSON.stringify({ connectionId: created.connection.id }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      })
    );
  assert.equal((await disable()).status, 200);
  assert.equal((await disable()).status, 200);
  assert.equal(auditEvents.length, 4);
  assert.doesNotMatch(JSON.stringify(auditEvents), /credentialRef|vault:\/\//);
  await deps.close();
});

test("identity connection admin routes deny a normal session", async () => {
  const deps = createRuntimeDependencies({
    config: normalizeAthenaAuthConfig({ mode: "local", secret: "identity-connection-test-secret" }),
    hasher: testHasher(),
    stores: new MemoryAuthStores(),
  });
  const stores = await deps.ensureReady();
  const router = createAuthRouter(deps);
  const signUp = await router.handleRoute(
    new Request("https://auth.example/api/auth/sign-up/email", {
      body: JSON.stringify({ email: "ordinary@example.com", password: "Password123!" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    "/sign-up/email",
    stores,
    new Headers(),
    "trace-identity-connection"
  );
  await assert.rejects(
    router.handleRoute(
      new Request("https://auth.example/api/auth/admin/identity-connection/list?organizationId=org", {
        headers: { cookie: cookieOf(signUp) },
      }),
      "/admin/identity-connection/list",
      stores,
      new Headers(),
      "trace-identity-connection"
    ),
    { status: 403 }
  );
  await deps.close();
});
