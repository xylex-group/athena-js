import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAthenaAuthConfig } from "../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { generateApiKey } from "../src/auth/local/api-key.ts";
import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";
import { createPasskeyRepository } from "../src/auth/local/passkey/repository.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import type { AthenaAuthHooks } from "../src/auth/hooks/types.ts";
import { PostgresAuthStores } from "../src/auth/local/stores.ts";
import { decodeBase32, generateTotpCode } from "../src/auth/local/totp.ts";
import { parseAthenaRightKey } from "../src/rights/key.ts";

function createTestHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash(hash: string) {
      return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

function createRuntime(
  email?: (message: { to: string; type: string; url?: string }) => void,
  auditLog?: boolean,
  hooks?: AthenaAuthHooks
) {
  return createAthenaAuthRuntime({
    autoMigrate: false,
    config: normalizeAthenaAuthConfig({
      mode: "local",
      ...(auditLog === undefined ? {} : { observability: { auditLog } }),
      security: { trustedOrigins: ["http://app.local"] },
    }),
    hasher: createTestHasher(),
    hooks,
    legacySend: email,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function signUp(
  runtime: ReturnType<typeof createRuntime>,
  email: string
) {
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email,
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  return {
    body: await json(response),
    cookie: response.headers.get("set-cookie") ?? "",
  };
}

test("verify-email consumes a one-time token and marks the user verified", async () => {
  let captured: string | undefined;
  const runtime = createRuntime((message) => {
    captured = message.url;
  });
  await signUp(runtime, "verify@example.com");
  const send = await runtime.handle(
    new Request("http://app.local/api/auth/send-verification-email", {
      body: JSON.stringify({ email: "verify@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(send.status, 200);
  assert.ok(captured?.startsWith("verify_"));
  const verified = await runtime.handle(
    new Request(
      `http://app.local/api/auth/verify-email?token=${encodeURIComponent(captured ?? "")}`
    )
  );
  assert.equal(verified.status, 200);
  const body = await json(verified);
  assert.equal(body.status, true);
  assert.equal((body.user as { emailVerified?: boolean }).emailVerified, true);
});

test("change-email requires confirmation and applies after verify", async () => {
  let captured: string | undefined;
  const runtime = createRuntime((message) => {
    if (message.type === "change-email") {
      captured = message.url;
    }
  });
  const { cookie } = await signUp(runtime, "old@example.com");
  const requestChange = await runtime.handle(
    new Request("http://app.local/api/auth/change-email", {
      body: JSON.stringify({ newEmail: "new@example.com" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(requestChange.status, 200);
  assert.ok(captured);
  const confirm = await runtime.handle(
    new Request("http://app.local/api/auth/change-email/verify", {
      body: JSON.stringify({ token: captured }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(confirm.status, 200);
  assert.equal(
    ((await json(confirm)).user as { email?: string }).email,
    "new@example.com"
  );
});

test("delete-user removes the account and clears the session cookie", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "gone@example.com");
  const deleted = await runtime.handle(
    new Request("http://app.local/api/auth/delete-user", {
      body: JSON.stringify({ password: "Password123!" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(deleted.status, 200);
  assert.equal((await json(deleted)).message, "User deleted");
  const session = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { cookie },
    })
  );
  assert.equal(session.status, 401);
});

test("API keys are hashed, returned once, and can authenticate get-session", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "keys@example.com");
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({ name: "ci", prefix: "ak_" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const createdBody = await json(created);
  const fullKey = createdBody.key as string;
  assert.ok(fullKey.startsWith("ak_"));
  const verify = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/verify", {
      body: JSON.stringify({ key: fullKey }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal((await json(verify)).valid, true);
  const viaHeader = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { "x-api-key": fullKey },
    })
  );
  assert.equal(viaHeader.status, 200);
  const viaHeaderBody = await json(viaHeader);
  assert.ok(Array.isArray(viaHeaderBody.grants));
  assert.ok(Array.isArray(viaHeaderBody.rights));
  assert.equal(
    (viaHeaderBody.user as { email?: string }).email,
    "keys@example.com"
  );
  const listed = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/list", {
      headers: { cookie },
    })
  );
  const apiKeys =
    ((await json(listed)).apiKeys as Array<{ key?: string }>) ?? [];
  assert.equal(apiKeys.length, 1);
  assert.equal(apiKeys[0]?.key, undefined);
});

test("new API keys without permissions are rights-empty", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "empty-permissions@example.com");
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({ name: "empty" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const fullKey = (await json(created)).key as string;

  const session = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { "x-api-key": fullKey },
    })
  );
  assert.equal(session.status, 200);
  const body = await json(session);
  assert.deepEqual(body.rights, []);
  assert.deepEqual(
    (body.authorization as { effectiveRights: string[] }).effectiveRights,
    []
  );
});

test("API key creation binds ownership to the authenticated principal", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "owner@example.com");
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        name: "delegated",
        userId: "attacker-controlled-user",
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const body = await json(created);
  assert.notEqual(body.userId, "attacker-controlled-user");
  const stores = await runtime.getStores();
  const owner = await stores.getUserByEmail("owner@example.com");
  assert.equal(body.userId, owner?.id);
});

test("API key creation rejects malformed lifetime and usage limits", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "limits@example.com");
  for (const payload of [
    { expiresIn: "0" },
    { expiresIn: "-1" },
    { expiresIn: "not-a-number" },
    { remaining: "-1" },
  ]) {
    const response = await runtime.handle(
      new Request("http://app.local/api/auth/api-key/create", {
        body: JSON.stringify(payload),
        headers: {
          "content-type": "application/json",
          cookie,
        },
        method: "POST",
      })
    );
    assert.ok(response.status >= 400, JSON.stringify(payload));
  }
});

test("API key permissions cannot exceed the authenticated principal rights", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "permissions@example.com");
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ "authorization.roles": ["write"] }),
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 403);
});

test("API key sessions are bounded by the key permissions", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "bounded-key@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("bounded-key@example.com");
  assert.ok(user);
  await stores.authorization.assignUserRole(user.id, "platform_admin");

  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({
          authorization: ["platform.read"],
        }),
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const fullKey = (await json(created)).key as string;

  const session = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { "x-api-key": fullKey },
    })
  );
  assert.equal(session.status, 200);
  const body = await json(session);
  assert.deepEqual(body.rights, ["authorization.platform.read"]);
  assert.deepEqual(
    (body.authorization as { effectiveRights: string[] }).effectiveRights,
    ["authorization.platform.read"]
  );
});

test("API key sessions retain the active organization authorization scope", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "organization-key@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("organization-key@example.com");
  assert.ok(user);
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "organization-key-scope",
    name: "Scoped organization",
    slug: "scoped-organization",
  });
  await stores.addMember({
    id: "organization-key-member",
    organizationId: organization.id,
    role: "admin",
    userId: user.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);

  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({
          organization: ["members.read"],
        }),
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const fullKey = (await json(created)).key as string;

  const authenticated = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { "x-api-key": fullKey },
    })
  );
  assert.equal(authenticated.status, 200);
  const body = await json(authenticated);
  assert.deepEqual(body.rights, ["organization.members.read"]);
});

test("organization-scoped authorization read keys are limited to their organization and right", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(
    runtime,
    "authorization-read-key@example.com"
  );
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail(
    "authorization-read-key@example.com"
  );
  assert.ok(user);
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "authorization-read-scope",
    name: "Authorization read scope",
    slug: "authorization-read-scope",
  });
  await stores.addMember({
    id: "authorization-read-member",
    organizationId: organization.id,
    role: "owner",
    userId: user.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);

  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ authorization: ["roles.read"] }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const fullKey = (await json(created)).key as string;
  const request = (path: string, method = "GET") =>
    runtime.handle(
      new Request(`http://app.local/api/auth${path}`, {
        headers: { authorization: `Bearer ${fullKey}` },
        method,
      })
    );

  const assignments = await request(
    `/authorization/assignments/members?organizationId=${organization.id}`
  );
  assert.equal(assignments.status, 200);
  assert.equal(Array.isArray((await json(assignments)).assignments), true);

  const roles = await request(
    `/authorization/roles?organizationId=${organization.id}`
  );
  assert.equal(roles.status, 200);
  const role = ((await json(roles)).roles as Array<{ id: string }>)[0];
  assert.ok(role);
  const detail = await request(
    `/authorization/roles/${role.id}?organizationId=${organization.id}`
  );
  assert.equal(detail.status, 200);
  assert.equal(
    (await request("/authorization/rights?organizationId=" + organization.id))
      .status,
    200
  );
  assert.equal(
    (
      await request(
        `/authorization/roles?organizationId=${organization.id}&scope=platform`
      )
    ).status,
    403
  );
  assert.equal(
    (
      await request(
        `/authorization/roles/${role.id}?organizationId=${organization.id}&scope=platform`
      )
    ).status,
    403
  );
  assert.equal(
    (
      await request(
        `/authorization/rights?organizationId=${organization.id}&scope=platform`
      )
    ).status,
    403
  );

  assert.equal(
    (await request("/authorization/roles?organizationId=another-organization"))
      .status,
    403
  );
  assert.equal((await request("/authorization/roles", "POST")).status, 401);
});

test("authority snapshot route requires an explicit scope and binds organization authority to the caller's membership", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "authority-snapshot@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("authority-snapshot@example.com");
  assert.ok(user);
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "authority-snapshot-org",
    name: "Authority snapshot",
    slug: "authority-snapshot-org",
  });
  await stores.addMember({
    id: "authority-snapshot-member",
    organizationId: organization.id,
    role: "owner",
    userId: user.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);

  const request = (query: string) => runtime.handle(new Request(
    `http://app.local/api/auth/authorization/authority-snapshot${query}`,
    { headers: { cookie } },
  ));
  const response = await request(`?scope=organization&organizationId=${organization.id}`);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await json(response);
  assert.match(body.fingerprint as string, /^[a-f0-9]{64}$/);
  const snapshot = body.snapshot as { scope: { organizationId: string }; assignments: Array<{ subject: { userId: string } }> };
  assert.equal(snapshot.scope.organizationId, organization.id);
  assert.equal(snapshot.assignments[0]?.subject.userId, user.id);
  assert.equal((await request(`?scope=organization&organizationId=other-org`)).status, 403);
  assert.equal((await request("?scope=platform")).status, 403);
  assert.equal((await request(`?scope=organization&organizationId=${organization.id}&limit=1`)).status, 400);
  assert.equal((await request(`?organizationId=${organization.id}`)).status, 400);

  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ authorization: ["roles.read"] }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const apiKey = (await json(created)).key as string;
  const apiKeySnapshot = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/authority-snapshot?scope=organization&organizationId=${organization.id}`,
      { headers: { "x-api-key": apiKey } }
    )
  );
  assert.equal(apiKeySnapshot.status, 200, await apiKeySnapshot.clone().text());
  assert.match((await json(apiKeySnapshot)).fingerprint as string, /^[a-f0-9]{64}$/);
  const platformSnapshot = await runtime.handle(
    new Request(
      "http://app.local/api/auth/authorization/authority-snapshot?scope=platform",
      { headers: { "x-api-key": apiKey } }
    )
  );
  assert.equal(platformSnapshot.status, 403);
});

test("organization authorization routes reject keys without authorization.roles.read", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "authorization-no-read@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("authorization-no-read@example.com");
  assert.ok(user);
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "authorization-no-read-scope",
    name: "Authorization no read scope",
    slug: "authorization-no-read-scope",
  });
  await stores.addMember({
    id: "authorization-no-read-member",
    organizationId: organization.id,
    role: "owner",
    userId: user.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);

  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ organization: ["members.read"] }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const fullKey = (await json(created)).key as string;
  const response = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/roles?organizationId=${organization.id}`,
      { headers: { "x-api-key": fullKey } }
    )
  );
  assert.equal(response.status, 403);
});

test("organization authentication posture reads require their own right and expose safe facts", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(
    runtime,
    "authentication-posture@example.com"
  );
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail(
    "authentication-posture@example.com"
  );
  assert.ok(user);
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "authentication-posture-scope",
    name: "Authentication posture scope",
    slug: "authentication-posture-scope",
  });
  await stores.addMember({
    id: "authentication-posture-member",
    organizationId: organization.id,
    role: "owner",
    userId: user.id,
  });
  const secondUser = await stores.createUser({
    email: "authentication-posture-second@example.com",
    id: "authentication-posture-second-user",
  });
  await stores.addMember({
    id: "authentication-posture-second-member",
    organizationId: organization.id,
    role: "member",
    userId: secondUser.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);
  await stores.updateUser(user.id, { twoFactorEnabled: true });
  await stores.createAccount({
    accountId: "social-user",
    id: "social-account",
    providerId: "google",
    userId: user.id,
  });
  await createPasskeyRepository(stores).create({
    aaguid: null,
    backedUp: true,
    counter: 0n,
    credentialId: new Uint8Array([1, 2, 3]),
    deviceType: "multiDevice",
    name: "Primary passkey",
    publicKey: new Uint8Array([4, 5, 6]),
    residentKey: true,
    transports: ["internal"],
    userId: user.id,
  });
  const keyResponse = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ organization: ["authentication.read"] }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(keyResponse.status, 200);
  const key = (await json(keyResponse)).key as string;
  const response = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-authentication-posture?organizationId=${organization.id}`,
      { headers: { authorization: `Bearer ${key}` } }
    )
  );
  assert.equal(response.status, 200);
  const page = (await json(response)) as {
    limit: number;
    members: Array<Record<string, unknown>>;
    offset: number;
    total: number;
  };
  assert.equal(page.total, 2);
  assert.equal(page.limit, 50);
  assert.equal(page.offset, 0);
  const member = page.members.find((candidate) => candidate.userId === user.id);
  assert.deepEqual(member, {
    phishResistant: true,
    registeredMethods: ["passkey", "password", "social", "totp"],
    twoFactorEnabled: true,
    userId: user.id,
  });
  const laterPage = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-authentication-posture?organizationId=${organization.id}&limit=1&offset=1`,
      { headers: { authorization: `Bearer ${key}` } }
    )
  );
  assert.equal(laterPage.status, 200);
  const laterPageBody = (await json(laterPage)) as {
    limit: number;
    members: unknown[];
    offset: number;
    total: number;
  };
  assert.equal(laterPageBody.limit, 1);
  assert.equal(laterPageBody.offset, 1);
  assert.equal(laterPageBody.total, 2);
  assert.deepEqual(laterPageBody.members, [page.members[1]]);
  const excessivePage = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-authentication-posture?organizationId=${organization.id}&limit=101`,
      { headers: { authorization: `Bearer ${key}` } }
    )
  );
  assert.equal(excessivePage.status, 400);

  const memberReadKey = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ organization: ["members.read"] }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(memberReadKey.status, 200);
  const denied = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-authentication-posture?organizationId=${organization.id}`,
      { headers: { "x-api-key": (await json(memberReadKey)).key as string } }
    )
  );
  assert.equal(denied.status, 403);

  const crossOrganization = await runtime.handle(
    new Request(
      "http://app.local/api/auth/organization/list-authentication-posture?organizationId=another-org",
      { headers: { authorization: `Bearer ${key}` } }
    )
  );
  assert.equal(crossOrganization.status, 403);
});

test("Postgres authentication posture reads batch factors with bounded paging", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    inTransaction: false,
    async query<T>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      const rows = sql.includes("COUNT(*)")
        ? [{ total: "4" }]
        : [
            {
              hasPasskey: true,
              hasPassword: true,
              hasSocial: false,
              twoFactorEnabled: true,
              userId: "user-1",
            },
          ];
      return { rowCount: rows.length, rows: rows as T[] };
    },
    async transaction<T>(fn: (db: AthenaAuthDatabase) => Promise<T>) {
      return fn(database as unknown as AthenaAuthDatabase);
    },
  } as unknown as AthenaAuthDatabase;
  const page = await new PostgresAuthStores(database).listAuthenticationPosture(
    {
      limit: 50,
      offset: 100,
      organizationId: "org-1",
    }
  );
  assert.deepEqual(page, {
    members: [
      {
        hasPasskey: true,
        hasPassword: true,
        hasSocial: false,
        twoFactorEnabled: true,
        userId: "user-1",
      },
    ],
    total: 4,
  });
  assert.equal(queries.length, 2);
  assert.match(queries[0]?.sql ?? "", /EXISTS[\s\S]*athena\.accounts/);
  assert.match(queries[0]?.sql ?? "", /EXISTS[\s\S]*athena\.passkeys/);
  assert.deepEqual(queries[0]?.values, ["org-1", 50, 100]);
  assert.deepEqual(queries[1]?.values, ["org-1"]);
});

test("organization Auth lifecycle reads paginate sanitized typed member events", async () => {
  const roleChanges: Array<Record<string, unknown>> = [];
  let beforeRoleChangeCount = 0;
  const runtime = createRuntime(undefined, undefined, {
    after: {
      "authorization.member.roles.replace": async (payload) => {
        beforeRoleChangeCount += 1;
        roleChanges.push(payload.result.changes[0] as Record<string, unknown>);
      },
    },
    before: {
      "authorization.member.roles.replace": async (payload) => {
        assert.deepEqual(payload.input.changes[0]?.roleIds, ["organization_member"]);
        assert.ok(Array.isArray(payload.previous?.changes[0]?.roleIds));
      },
    },
  });
  const { cookie } = await signUp(runtime, "auth-lifecycle-owner@example.com");
  const stores = await runtime.getStores();
  const owner = await stores.getUserByEmail("auth-lifecycle-owner@example.com");
  assert.ok(owner);
  const organization = await stores.createOrganization({
    createdByUserId: owner.id,
    id: "auth-lifecycle-scope",
    name: "Auth lifecycle scope",
    slug: "auth-lifecycle-scope",
  });
  await stores.addMember({
    id: "auth-lifecycle-owner-member",
    organizationId: organization.id,
    role: "owner",
    userId: owner.id,
  });
  const ownerSession = (await stores.listUserSessions(owner.id))[0];
  assert.ok(ownerSession);
  await stores.setSessionActiveOrganization(
    ownerSession.token,
    organization.id
  );

  await signUp(runtime, "auth-lifecycle-one@example.com");
  const target = await stores.getUserByEmail("auth-lifecycle-one@example.com");
  assert.ok(target);
  const add = await runtime.handle(
    new Request("http://app.local/api/auth/organization/add-member", {
      body: JSON.stringify({
        organizationId: organization.id,
        role: "member",
        userId: target.id,
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(add.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 3));
  const member = (await stores.listMembers(organization.id)).find(
    (item) => item.user_id === target.id
  );
  assert.ok(member);
  const update = await runtime.handle(
    new Request("http://app.local/api/auth/organization/update-member-role", {
      body: JSON.stringify({
        memberId: member.id,
        organizationId: organization.id,
        role: "admin",
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(update.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 3));
  const assignmentSnapshot =
    await stores.authorization.readMemberRoleAssignmentsSnapshot({
      organizationId: organization.id,
    });
  const assignmentUpdate = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/assignments/members/${member.id}`,
      {
        body: JSON.stringify({
          expectedVersion: assignmentSnapshot.revision,
          roleIds: ["organization_member"],
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    )
  );
  assert.equal(assignmentUpdate.status, 200);
  assert.equal(roleChanges.length, 1);
  assert.equal(beforeRoleChangeCount, 1);
  assert.deepEqual(roleChanges[0]?.roleIds, ["organization_member"]);
  const noOpSnapshot =
    await stores.authorization.readMemberRoleAssignmentsSnapshot({
      organizationId: organization.id,
    });
  const noOp = await runtime.handle(
    new Request(
      `http://app.local/api/auth/authorization/assignments/members/${member.id}`,
      {
        body: JSON.stringify({
          expectedVersion: noOpSnapshot.revision,
          roleIds: ["organization_member"],
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    )
  );
  assert.equal(noOp.status, 200);
  assert.equal(roleChanges.length, 1);
  assert.equal(beforeRoleChangeCount, 1);
  await new Promise((resolve) => setTimeout(resolve, 3));
  const remove = await runtime.handle(
    new Request("http://app.local/api/auth/organization/remove-member", {
      body: JSON.stringify({
        memberId: member.id,
        organizationId: organization.id,
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(remove.status, 200);

  const keyResponse = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ organization: ["auth_events.read"] }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(keyResponse.status, 200);
  const key = (await json(keyResponse)).key as string;
  const url = `http://app.local/api/auth/organization/list-lifecycle-events?organizationId=${organization.id}&limit=1`;
  const first = await runtime.handle(
    new Request(url, { headers: { authorization: `Bearer ${key}` } })
  );
  assert.equal(first.status, 200);
  const firstPage = await json(first);
  const firstEvents = firstPage.events as Array<Record<string, unknown>>;
  assert.equal(firstEvents.length, 1);
  assert.equal(firstEvents[0]?.event, "organization.member.remove");
  assert.equal(firstEvents[0]?.subjectUserId, target.id);
  assert.equal(typeof firstEvents[0]?.subjectUserId, "string");
  assert.equal(typeof firstEvents[0]?.occurredAt, "string");
  assert.deepEqual(Object.keys(firstEvents[0] ?? {}).sort(), [
    "event",
    "eventId",
    "occurredAt",
    "subjectUserId",
  ]);
  assert.equal(typeof firstPage.nextCursor, "string");
  const second = await runtime.handle(
    new Request(
      `${url}&cursor=${encodeURIComponent(firstPage.nextCursor as string)}`,
      {
        headers: { authorization: `Bearer ${key}` },
      }
    )
  );
  assert.equal(second.status, 200);
  const secondPage = await json(second);
  const secondEvents = secondPage.events as Array<Record<string, unknown>>;
  assert.equal(secondEvents.length, 1);
  assert.equal(secondEvents[0]?.event, "organization.member.role.update");
  assert.equal(secondEvents[0]?.subjectUserId, target.id);
  assert.equal(typeof secondEvents[0]?.eventId, "string");
  assert.equal(typeof secondPage.nextCursor, "string");
  const third = await runtime.handle(
    new Request(
      `${url}&cursor=${encodeURIComponent(secondPage.nextCursor as string)}`,
      { headers: { authorization: `Bearer ${key}` } }
    )
  );
  assert.equal(third.status, 200);
  const thirdPage = await json(third);
  const thirdEvents = thirdPage.events as Array<Record<string, unknown>>;
  assert.equal(thirdEvents.length, 1);
  assert.equal(thirdEvents[0]?.event, "organization.member.role.update");
  assert.equal(thirdEvents[0]?.subjectUserId, target.id);
  assert.notEqual(thirdEvents[0]?.eventId, secondEvents[0]?.eventId);
  assert.equal(typeof thirdPage.nextCursor, "string");
  const fourth = await runtime.handle(
    new Request(
      `${url}&cursor=${encodeURIComponent(thirdPage.nextCursor as string)}`,
      { headers: { authorization: `Bearer ${key}` } }
    )
  );
  assert.equal(fourth.status, 200);
  const fourthPage = await json(fourth);
  const fourthEvents = fourthPage.events as Array<Record<string, unknown>>;
  assert.deepEqual(
    fourthEvents.map((event) => event.event),
    ["organization.member.add"]
  );
  assert.equal(fourthEvents[0]?.subjectUserId, target.id);
  assert.equal(fourthPage.nextCursor, null);

  const otherOrganization = await stores.createOrganization({
    createdByUserId: owner.id,
    id: "auth-lifecycle-other-scope",
    name: "Other Auth lifecycle scope",
    slug: "auth-lifecycle-other-scope",
  });
  await stores.addMember({
    id: "auth-lifecycle-other-owner-member",
    organizationId: otherOrganization.id,
    role: "owner",
    userId: owner.id,
  });
  const isolated = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-lifecycle-events?organizationId=${otherOrganization.id}`,
      { headers: { authorization: `Bearer ${key}` } }
    )
  );
  assert.equal(isolated.status, 403);

  const memberReadKeyResponse = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ organization: ["members.read"] }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(memberReadKeyResponse.status, 200);
  const denied = await runtime.handle(
    new Request(url, {
      headers: {
        authorization: `Bearer ${(await json(memberReadKeyResponse)).key as string}`,
      },
    })
  );
  assert.equal(denied.status, 403);
});

test("organization lifecycle reads fail when audit logging is disabled", async () => {
  const runtime = createRuntime(undefined, false);
  const { cookie } = await signUp(
    runtime,
    "auth-lifecycle-disabled@example.com"
  );
  const stores = await runtime.getStores();
  const owner = await stores.getUserByEmail(
    "auth-lifecycle-disabled@example.com"
  );
  assert.ok(owner);
  const organization = await stores.createOrganization({
    createdByUserId: owner.id,
    id: "auth-lifecycle-disabled-scope",
    name: "Disabled lifecycle audit",
    slug: "auth-lifecycle-disabled-scope",
  });
  await stores.addMember({
    id: "auth-lifecycle-disabled-owner-member",
    organizationId: organization.id,
    role: "owner",
    userId: owner.id,
  });
  const ownerSession = (await stores.listUserSessions(owner.id))[0];
  assert.ok(ownerSession);
  await stores.setSessionActiveOrganization(
    ownerSession.token,
    organization.id
  );
  const response = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-lifecycle-events?organizationId=${organization.id}`,
      { headers: { cookie } }
    )
  );
  assert.equal(response.status, 501);
  assert.equal((await json(response)).code, "ATHENA_AUTH_CAPABILITY_DISABLED");
});

test("role deletion emits one paginated lifecycle event per reassigned member", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(
    runtime,
    "auth-role-delete-owner@example.com"
  );
  const stores = await runtime.getStores();
  const owner = await stores.getUserByEmail(
    "auth-role-delete-owner@example.com"
  );
  assert.ok(owner);
  const organization = await stores.createOrganization({
    createdByUserId: owner.id,
    id: "auth-role-delete-scope",
    name: "Auth role delete scope",
    slug: "auth-role-delete-scope",
  });
  await stores.addMember({
    id: "auth-role-delete-owner-member",
    organizationId: organization.id,
    role: "owner",
    userId: owner.id,
  });
  const ownerSession = (await stores.listUserSessions(owner.id))[0];
  assert.ok(ownerSession);
  await stores.setSessionActiveOrganization(
    ownerSession.token,
    organization.id
  );

  const cloned = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles/clone", {
      body: JSON.stringify({
        name: "Reviewer",
        sourceRoleId: "organization_member",
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(cloned.status, 200);
  const role = (await json(cloned)).role as {
    id: string;
    key: string;
    version: number;
  };
  const memberIds: string[] = [];
  for (const email of [
    "auth-role-delete-one@example.com",
    "auth-role-delete-two@example.com",
  ]) {
    await signUp(runtime, email);
    const memberUser = await stores.getUserByEmail(email);
    assert.ok(memberUser);
    memberIds.push(memberUser.id);
    const added = await runtime.handle(
      new Request("http://app.local/api/auth/organization/add-member", {
        body: JSON.stringify({
          organizationId: organization.id,
          role: role.key,
          userId: memberUser.id,
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      })
    );
    assert.equal(added.status, 200);
  }

  const deleted = await runtime.handle(
    new Request(`http://app.local/api/auth/authorization/roles/${role.id}`, {
      body: JSON.stringify({
        expectedVersion: role.version,
        reassignmentRoleId: "organization_member",
      }),
      headers: { "content-type": "application/json", cookie },
      method: "DELETE",
    })
  );
  assert.equal(deleted.status, 200);
  const roleChanges: Array<{ event: string; eventId: string; subjectUserId: string }> = [];
  let cursor: string | null = null;
  do {
    const response = await runtime.handle(
      new Request(
        `http://app.local/api/auth/organization/list-lifecycle-events?organizationId=${organization.id}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { headers: { cookie } }
      )
    );
    assert.equal(response.status, 200);
    const page = (await json(response)) as {
      events: Array<{ event: string; eventId: string; subjectUserId: string }>;
      nextCursor: string | null;
    };
    assert.ok(page.events.length <= 1);
    roleChanges.push(
      ...page.events.filter((event) => event.event === "organization.member.role.update")
    );
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(
    roleChanges.map((event) => event.subjectUserId).sort(),
    memberIds.sort()
  );
  assert.equal(new Set(roleChanges.map((event) => event.eventId)).size, 2);
});

test("legacy API keys remain rights-empty after organization scope migration", async () => {
  const runtime = createRuntime();
  await signUp(runtime, "legacy-key@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("legacy-key@example.com");
  assert.ok(user);
  await stores.authorization.assignUserRole(user.id, "platform_admin");

  const generated = await generateApiKey("legacy_");
  await stores.createApiKey({
    created_at: new Date(),
    enabled: true,
    expires_at: null,
    id: "legacy-api-key",
    key: generated.hash,
    last_request: null,
    metadata: null,
    name: "legacy",
    permissions: null,
    prefix: "legacy_",
    remaining: null,
    start: generated.start,
    updated_at: new Date(),
    user_id: user.id,
  });

  const response = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { "x-api-key": generated.fullKey },
    })
  );
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.deepEqual(body.rights, []);
  assert.deepEqual((body.authorization as { roles: unknown[] }).roles, []);
});

test("API key permission validation uses canonical wildcard matching", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "wildcard-key@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("wildcard-key@example.com");
  assert.ok(user);
  await stores.authorization.assignUserRole(user.id, "platform_admin");
  const readSnapshot = stores.authorization.readSnapshot.bind(
    stores.authorization
  );
  stores.authorization.readSnapshot = async (input) => ({
    ...(await readSnapshot(input)),
    effectiveRights: [
      parseAthenaRightKey("*"),
      parseAthenaRightKey("storage.*"),
      parseAthenaRightKey("*.read"),
    ],
  });

  for (const permissions of [
    { storage: ["read"] },
    { authorization: ["read"] },
    { "*": ["*"] },
  ]) {
    const created = await runtime.handle(
      new Request("http://app.local/api/auth/api-key/create", {
        body: JSON.stringify({ permissions: JSON.stringify(permissions) }),
        headers: {
          "content-type": "application/json",
          cookie,
        },
        method: "POST",
      })
    );
    assert.equal(created.status, 200, JSON.stringify(permissions));
  }
});

test("API key remaining-use limits are enforced atomically", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "remaining@example.com");
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({ remaining: 1 }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const fullKey = (await json(created)).key as string;
  const first = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { "x-api-key": fullKey },
    })
  );
  assert.equal(first.status, 200);
  const verify = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/verify", {
      body: JSON.stringify({ key: fullKey }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal((await json(verify)).valid, false);
  const second = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { "x-api-key": fullKey },
    })
  );
  assert.equal(second.status, 401);
});

test("API key verification consumes remaining uses and enforces requested permissions", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "verify-key@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("verify-key@example.com");
  assert.ok(user);
  await stores.authorization.assignUserRole(user.id, "platform_admin");
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ authorization: ["platform.read"] }),
        remaining: 1,
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const fullKey = (await json(created)).key as string;

  const denied = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/verify", {
      body: JSON.stringify({
        key: fullKey,
        permissions: { authorization: ["platform.write"] },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal((await json(denied)).valid, false);

  const verified = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/verify", {
      body: JSON.stringify({
        key: fullKey,
        permissions: { authorization: ["platform.read"] },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const verifiedBody = await json(verified);
  assert.equal(verifiedBody.valid, true);
  assert.equal(
    (verifiedBody.key as { remaining?: number | null }).remaining,
    0
  );

  const exhausted = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/verify", {
      body: JSON.stringify({ key: fullKey }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal((await json(exhausted)).valid, false);
});

test("API key verification applies the current organization scope", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "scoped-verify@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("scoped-verify@example.com");
  assert.ok(user);
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "scoped-verify-organization",
    name: "Scoped verify organization",
    slug: "scoped-verify-organization",
  });
  await stores.addMember({
    id: "scoped-verify-member",
    organizationId: organization.id,
    role: "admin",
    userId: user.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ organization: ["members.read"] }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const createdBody = await json(created);
  const fullKey = String(createdBody.key);
  assert.equal(createdBody.scopeKind, "organization");
  assert.equal(createdBody.organizationId, organization.id);

  await stores.removeMember(organization.id, user.id);
  const verified = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/verify", {
      body: JSON.stringify({
        key: fullKey,
        permissions: { organization: ["members.read"] },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal((await json(verified)).valid, false);
});

test("organization API keys cannot delegate platform rights", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "scoped-platform@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("scoped-platform@example.com");
  assert.ok(user);
  await stores.authorization.assignUserRole(user.id, "platform_admin");
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "scoped-platform-organization",
    name: "Scoped platform organization",
    slug: "scoped-platform-organization",
  });
  await stores.addMember({
    id: "scoped-platform-member",
    organizationId: organization.id,
    role: "admin",
    userId: user.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);

  const response = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({
          authorization: ["platform.read"],
        }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(response.status, 403);
});

test("organization API keys become invalid when membership is removed", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "membership-revoked@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("membership-revoked@example.com");
  assert.ok(user);
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "membership-revoked-organization",
    name: "Membership revoked organization",
    slug: "membership-revoked-organization",
  });
  await stores.addMember({
    id: "membership-revoked-member",
    organizationId: organization.id,
    role: "admin",
    userId: user.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ organization: ["members.read"] }),
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const fullKey = String((await json(created)).key);
  await stores.removeMember(organization.id, user.id);

  const sessionResponse = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { "x-api-key": fullKey },
    })
  );
  assert.equal(sessionResponse.status, 401);
  const verifyResponse = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/verify", {
      body: JSON.stringify({ key: fullKey }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal((await json(verifyResponse)).valid, false);
});

test("Postgres rate limits reject attempts after the configured limit", async () => {
  let count = 0;
  const database: AthenaAuthDatabase = {
    inTransaction: false,
    async query<T = Record<string, unknown>>(text: string, values?: unknown[]) {
      if (text.includes("INSERT INTO athena.auth_rate_limits")) {
        const limit = Number(values?.[1]);
        const admitted = count < limit;
        if (text.includes("WHERE auth_rate_limits") && !admitted) {
          return { rowCount: 0, rows: [] as T[] };
        }
        count = admitted ? count + 1 : count;
        return { rowCount: 1, rows: [{ count } as T] };
      }
      return { rowCount: 0, rows: [] as T[] };
    },
    async transaction<T>(fn: (db: AthenaAuthDatabase) => Promise<T>) {
      return fn(database);
    },
  };
  const stores = new PostgresAuthStores(database);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(await stores.consumeRateLimit("otp", 5, 300_000), true);
  }
  assert.equal(await stores.consumeRateLimit("otp", 5, 300_000), false);
});

test("API key updates cannot grant permissions beyond current owner rights", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "update-key@example.com");
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({ name: "updatable" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const createdBody = await json(created);

  const updated = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/update", {
      body: JSON.stringify({
        id: createdBody.id,
        permissions: JSON.stringify({ authorization: ["roles.write"] }),
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(updated.status, 403);
});

test("organization API key updates cannot grant platform rights", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "update-scoped-key@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("update-scoped-key@example.com");
  assert.ok(user);
  await stores.authorization.assignUserRole(user.id, "platform_admin");
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "update-scoped-key-organization",
    name: "Update scoped key organization",
    slug: "update-scoped-key-organization",
  });
  await stores.addMember({
    id: "update-scoped-key-member",
    organizationId: organization.id,
    role: "admin",
    userId: user.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);

  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({
        permissions: JSON.stringify({ organization: ["members.read"] }),
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const createdBody = await json(created);

  const updated = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/update", {
      body: JSON.stringify({
        id: createdBody.id,
        permissions: JSON.stringify({ authorization: ["platform.read"] }),
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(updated.status, 403);
});

test("deleting an organization revokes organization-scoped API keys", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "deleted-org-key@example.com");
  const stores = await runtime.getStores();
  const user = await stores.getUserByEmail("deleted-org-key@example.com");
  assert.ok(user);
  const organization = await stores.createOrganization({
    createdByUserId: user.id,
    id: "deleted-key-organization",
    name: "Deleted key organization",
    slug: "deleted-key-organization",
  });
  await stores.addMember({
    id: "deleted-key-member",
    organizationId: organization.id,
    role: "admin",
    userId: user.id,
  });
  const session = (await stores.listUserSessions(user.id))[0];
  assert.ok(session);
  await stores.setSessionActiveOrganization(session.token, organization.id);

  const created = await runtime.handle(
    new Request("http://app.local/api/auth/api-key/create", {
      body: JSON.stringify({ name: "organization-key" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const keyId = String((await json(created)).id);

  await stores.deleteOrganization(organization.id);
  assert.equal(await stores.getApiKeyById(keyId), undefined);
});

test("email OTPs use cryptographic codes, invalidate resends, and consume atomically", async () => {
  const sent: string[] = [];
  const runtime = createRuntime((message) => {
    if (message.type === "two-factor-otp" && message.url) {
      sent.push(message.url);
    }
  });
  const { cookie } = await signUp(runtime, "otp-security@example.com");
  const send = () =>
    runtime.handle(
      new Request("http://app.local/api/auth/two-factor/send-otp", {
        headers: { cookie },
        method: "POST",
      })
    );
  assert.equal((await send()).status, 200);
  const first = sent.at(-1);
  assert.equal((await send()).status, 200);
  const second = sent.at(-1);
  assert.ok(first && second && first !== second);
  const verifyOld = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/verify-otp", {
      body: JSON.stringify({ code: first }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.ok(verifyOld.status >= 400);
  const verify = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/verify-otp", {
      body: JSON.stringify({ code: second }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(verify.status, 200);
  const replay = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/verify-otp", {
      body: JSON.stringify({ code: second }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.ok(replay.status >= 400);
});

test("concurrent email OTP resends leave only one current code", async () => {
  const sent: string[] = [];
  const runtime = createRuntime((message) => {
    if (message.type === "two-factor-otp" && message.url) {
      sent.push(message.url);
    }
  });
  const { cookie } = await signUp(runtime, "otp-concurrent@example.com");
  const send = () =>
    runtime.handle(
      new Request("http://app.local/api/auth/two-factor/send-otp", {
        headers: { cookie },
        method: "POST",
      })
    );
  const responses = await Promise.all([send(), send()]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200]
  );
  assert.equal(sent.length, 2);
  const results = await Promise.all(
    sent.map((code) =>
      runtime.handle(
        new Request("http://app.local/api/auth/two-factor/verify-otp", {
          body: JSON.stringify({ code }),
          headers: { "content-type": "application/json", cookie },
          method: "POST",
        })
      )
    )
  );
  assert.equal(results.filter((response) => response.status === 200).length, 1);
  const stores = await runtime.getStores();
  assert.equal(stores.verificationReplacementLocks.size, 0);
});

test("email OTP verification throttles failed guesses across resends", async () => {
  const sent: string[] = [];
  const runtime = createRuntime((message) => {
    if (message.type === "two-factor-otp" && message.url) {
      sent.push(message.url);
    }
  });
  const { cookie } = await signUp(runtime, "otp-attempts@example.com");
  const send = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/send-otp", {
      headers: { cookie },
      method: "POST",
    })
  );
  assert.equal(send.status, 200);
  const code = sent.at(-1);
  assert.ok(code);

  const wrongCode = code === "000000" ? "000001" : "000000";
  const verify = (candidate: string) =>
    runtime.handle(
      new Request("http://app.local/api/auth/two-factor/verify-otp", {
        body: JSON.stringify({ code: candidate }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      })
    );
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await verify(wrongCode)).status, 400);
  }

  const resend = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/send-otp", {
      headers: { cookie },
      method: "POST",
    })
  );
  assert.equal(resend.status, 200);
  const replacementCode = sent.at(-1);
  assert.ok(replacementCode);

  assert.equal((await verify(wrongCode)).status, 400);
  assert.equal((await verify(wrongCode)).status, 429);
  assert.equal((await verify(replacementCode)).status, 429);
});

test("TOTP enable, sign-in challenge, and verify-totp issue a session", async () => {
  const runtime = createRuntime();
  const { cookie } = await signUp(runtime, "totp@example.com");
  const enabled = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/enable", {
      body: JSON.stringify({ password: "Password123!" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(enabled.status, 200);
  const enabledBody = await json(enabled);
  const uri = enabledBody.totpURI as string;
  const secret = new URL(uri).searchParams.get("secret");
  assert.ok(secret);
  const codes = enabledBody.backupCodes as string[];
  assert.equal(codes.length, 10);

  const signin = await runtime.handle(
    new Request("http://app.local/api/auth/sign-in/email", {
      body: JSON.stringify({
        email: "totp@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const signinBody = await json(signin);
  assert.equal(signinBody.twoFactorRedirect, true);
  const pending = signinBody.token as string;
  const otp = await generateTotpCode(decodeBase32(secret));
  const verified = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/verify-totp", {
      body: JSON.stringify({ code: otp, token: pending }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(verified.status, 200);
  const verifiedBody = await json(verified);
  assert.equal(verifiedBody.status, true);
  assert.equal(typeof verifiedBody.token, "string");
  assert.ok(
    verified.headers.get("set-cookie")?.includes("athena-auth.session-token=")
  );
});

test("email OTP completes a pending two-factor sign-in", async () => {
  const sent: string[] = [];
  const runtime = createRuntime((message) => {
    if (message.type === "two-factor-otp" && message.url) {
      sent.push(message.url);
    }
  });
  const { cookie } = await signUp(runtime, "pending-otp@example.com");
  const enabled = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/enable", {
      body: JSON.stringify({ password: "Password123!" }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.equal(enabled.status, 200);

  const signin = await runtime.handle(
    new Request("http://app.local/api/auth/sign-in/email", {
      body: JSON.stringify({
        email: "pending-otp@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signin.status, 200);
  const pendingToken = String((await json(signin)).token);
  assert.ok(pendingToken.startsWith("2fa_"));

  const send = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/send-otp", {
      body: JSON.stringify({ token: pendingToken }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(send.status, 200);
  const code = sent.at(-1);
  assert.ok(code);

  const verify = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/verify-otp", {
      body: JSON.stringify({ code, token: pendingToken }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(verify.status, 200);
  const verified = await json(verify);
  assert.equal(typeof verified.token, "string");
  assert.ok((verified.token as string).length > 0);
});
