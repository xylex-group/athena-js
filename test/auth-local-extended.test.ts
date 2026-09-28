import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAthenaAuthConfig } from "../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { generateApiKey } from "../src/auth/local/api-key.ts";
import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
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
  email?: (message: { to: string; type: string; url?: string }) => void
) {
  return createAthenaAuthRuntime({
    autoMigrate: false,
    config: normalizeAthenaAuthConfig({
      mode: "local",
      security: { trustedOrigins: ["http://app.local"] },
    }),
    hasher: createTestHasher(),
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
    async query<T = Record<string, unknown>>(
      text: string,
      values?: unknown[]
    ) {
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
    [200, 200],
  );
  assert.equal(sent.length, 2);
  const results = await Promise.all(
    sent.map((code) =>
      runtime.handle(
        new Request("http://app.local/api/auth/two-factor/verify-otp", {
          body: JSON.stringify({ code }),
          headers: { "content-type": "application/json", cookie },
          method: "POST",
        }),
      ),
    ),
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
