import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmbeddedCapabilitySnapshot } from "../src/auth/capabilities.ts";
import { normalizeAthenaAuthConfig } from "../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import {
  createAthenaAuthRuntime,
  createAuthRequestMiddleware,
  createAuthRouter,
} from "../src/auth/local/runtime.ts";
import { createRuntimeDependencies } from "../src/auth/local/runtime-dependencies.ts";
import { AthenaConfigurationError, createClient } from "../src/v3-client.ts";

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

function createRuntime() {
  return createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function raceLiveness(
  response: Promise<Response>,
  message: string
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 500);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

test("GET /ok and HEAD /ok skip ensureReady and getSocialRuntime", async () => {
  const deps = createRuntimeDependencies({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  let ensureReadyCalled = false;
  let getSocialRuntimeCalled = false;
  deps.ensureReady = async () => {
    ensureReadyCalled = true;
    await new Promise(() => {});
    throw new Error("ensureReady must not be awaited for /ok");
  };
  deps.getSocialRuntime = async () => {
    getSocialRuntimeCalled = true;
    await new Promise(() => {});
    return null;
  };
  const { handleRoute } = createAuthRouter(deps);
  const handle = createAuthRequestMiddleware({ deps, handleRoute });

  const getOk = await raceLiveness(
    handle(new Request("http://app.local/api/auth/ok")),
    "GET /ok hung waiting for Auth bootstrap"
  );
  assert.equal(getOk.status, 200);
  assert.equal(ensureReadyCalled, false);
  assert.equal(getSocialRuntimeCalled, false);

  const headOk = await raceLiveness(
    handle(new Request("http://app.local/api/auth/ok", { method: "HEAD" })),
    "HEAD /ok hung waiting for Auth bootstrap"
  );
  assert.equal(headOk.status, 200);
  assert.equal(ensureReadyCalled, false);
  assert.equal(getSocialRuntimeCalled, false);
});

test("GET /ok and /health terminate locally without a remote service", async () => {
  const runtime = createRuntime();
  const ok = await runtime.handle(new Request("http://app.local/api/auth/ok"));
  assert.equal(ok.status, 200);
  assert.deepEqual(await json(ok), {
    capabilities: createEmbeddedCapabilitySnapshot(),
    ok: true,
  });

  const health = await runtime.handle(
    new Request("http://app.local/api/auth/health")
  );
  assert.equal(health.status, 200);
  const body = await json(health);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "athena-auth");
  assert.ok(health.headers.get("x-athena-trace-id"));
});

test("GET /ok advertises passkeys when auth.passkey.enabled is true", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    config: normalizeAthenaAuthConfig({
      mode: "local",
      passkey: { enabled: true, rpId: "localhost" },
    }),
    hasher: createTestHasher(),
  });
  const ok = await runtime.handle(new Request("http://app.local/api/auth/ok"));
  assert.equal(ok.status, 200);
  const body = await json(ok);
  assert.deepEqual(
    body.capabilities,
    createEmbeddedCapabilitySnapshot({
      passkeyEnabled: true,
    })
  );
});

test("unknown routes return a contract error envelope", async () => {
  const runtime = createRuntime();
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/not-a-route")
  );
  assert.equal(response.status, 404);
  const body = await json(response);
  assert.equal(typeof body.message, "string");
  assert.equal(typeof body.traceId, "string");
  assert.equal(typeof body.version, "string");
  assert.equal(body.traceId, response.headers.get("x-athena-trace-id"));
});

test("email signup, signin, get-session, and sign-out form one local loop", async () => {
  const runtime = createRuntime();
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "ada@example.com",
        name: "Ada",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const signupBody = await json(signup);
  assert.equal(typeof signupBody.token, "string");
  const cookie = signup.headers.get("set-cookie");
  assert.ok(cookie?.includes("athena-auth.session-token="));
  assert.ok(cookie?.includes("HttpOnly"));

  const session = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { cookie: cookie ?? "" },
    })
  );
  assert.equal(session.status, 200);
  const sessionBody = await json(session);
  const user = sessionBody.user as { email?: string };
  assert.equal(user.email, "ada@example.com");

  await runtime.handle(
    new Request("http://app.local/api/auth/sign-out", {
      headers: { cookie: cookie ?? "" },
      method: "POST",
    })
  );

  const signin = await runtime.handle(
    new Request("http://app.local/api/auth/sign-in/email", {
      body: JSON.stringify({
        email: "ada@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signin.status, 200);
  const signinBody = await json(signin);
  assert.equal(signinBody.redirect, false);
  assert.equal(typeof signinBody.token, "string");
});

test("authenticated get-session exposes rights and grants as arrays", async () => {
  const runtime = createRuntime();
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "session-shape@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);

  const response = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", {
      headers: { cookie: signup.headers.get("set-cookie") ?? "" },
    })
  );
  assert.equal(response.status, 200);
  const body = await json(response);

  assert.ok(Array.isArray(body.grants));
  assert.ok(Array.isArray(body.rights));
  const authorization = body.authorization as {
    effectiveRights?: readonly string[];
  };
  assert.deepEqual(body.rights, authorization.effectiveRights ?? []);
});

test("duplicate signup conflicts without leaking a stack", async () => {
  const runtime = createRuntime();
  const payload = {
    body: JSON.stringify({
      email: "dup@example.com",
      password: "Password123!",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  };
  const first = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", payload)
  );
  assert.equal(first.status, 200);
  const second = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", payload)
  );
  assert.equal(second.status, 409);
  const body = await json(second);
  assert.equal(body.message, "A user with this email already exists");
});

test("wrong password returns Invalid credentials", async () => {
  const runtime = createRuntime();
  await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "secret@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const failed = await runtime.handle(
    new Request("http://app.local/api/auth/sign-in/email", {
      body: JSON.stringify({
        email: "secret@example.com",
        password: "wrong-password",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(failed.status, 401);
  assert.equal((await json(failed)).message, "Invalid credentials");
});

test("forgot password is enumeration-resistant and reset consumes the token once", async () => {
  const runtime = createRuntime();
  await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "reset@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const missing = await runtime.handle(
    new Request("http://app.local/api/auth/forget-password", {
      body: JSON.stringify({ email: "missing@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(missing.status, 200);
  assert.equal((await json(missing)).status, true);

  let capturedToken: string | undefined;
  const capturing = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    legacySend: (message) => {
      capturedToken = message.url;
    },
  });
  await capturing.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "reset2@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  await capturing.handle(
    new Request("http://app.local/api/auth/forget-password", {
      body: JSON.stringify({ email: "reset2@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.ok(capturedToken);
  const reset = await capturing.handle(
    new Request("http://app.local/api/auth/reset-password", {
      body: JSON.stringify({
        newPassword: "NewPassword123!",
        token: capturedToken,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(reset.status, 200);
  const replay = await capturing.handle(
    new Request("http://app.local/api/auth/reset-password", {
      body: JSON.stringify({
        newPassword: "AnotherPassword123!",
        token: capturedToken,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(replay.status, 400);
});

test("organization create/list/invite/accept stay scoped to the member", async () => {
  const runtime = createRuntime();
  const owner = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const ownerCookie = owner.headers.get("set-cookie") ?? "";
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Acme", slug: "acme" }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const createdBody = await json(created);
  const organization = createdBody.organization as { id: string };
  assert.ok(organization.id);

  const selfInvite = await runtime.handle(
    new Request("http://app.local/api/auth/organization/invite-member", {
      body: JSON.stringify({
        email: "  Owner@Example.com ",
        organizationId: organization.id,
        role: "member",
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(selfInvite.status, 400);
  const selfInviteBody = await json(selfInvite);
  assert.equal(
    selfInviteBody.message,
    "You cannot invite your own email as a member"
  );

  const member = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "member@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const memberCookie = member.headers.get("set-cookie") ?? "";
  const invited = await runtime.handle(
    new Request("http://app.local/api/auth/organization/invite-member", {
      body: JSON.stringify({
        email: "member@example.com",
        organizationId: organization.id,
        role: "member",
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  const invitation = ((await json(invited)).invitation as { id: string }).id;
  const accepted = await runtime.handle(
    new Request("http://app.local/api/auth/organization/accept-invitation", {
      body: JSON.stringify({ invitationId: invitation }),
      headers: {
        "content-type": "application/json",
        cookie: memberCookie,
      },
      method: "POST",
    })
  );
  assert.equal(accepted.status, 200);

  const otherCreated = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Beta", slug: "beta" }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(otherCreated.status, 200);
  const otherOrganization = (await json(otherCreated)).organization as {
    id: string;
  };
  const createdRole = await runtime.handle(
    new Request("http://app.local/api/auth/authorization/roles", {
      body: JSON.stringify({
        name: "Readless member",
        organizationId: otherOrganization.id,
        rights: [],
        scope: "organization",
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(createdRole.status, 200);
  const role = (await json(createdRole)).role as { key: string };
  const invitedToOther = await runtime.handle(
    new Request("http://app.local/api/auth/organization/invite-member", {
      body: JSON.stringify({
        email: "member@example.com",
        organizationId: otherOrganization.id,
        role: role.key,
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(invitedToOther.status, 200);
  const otherInvitation = (await json(invitedToOther)).invitation as {
    id: string;
  };
  const acceptedOther = await runtime.handle(
    new Request("http://app.local/api/auth/organization/accept-invitation", {
      body: JSON.stringify({ invitationId: otherInvitation.id }),
      headers: {
        "content-type": "application/json",
        cookie: memberCookie,
      },
      method: "POST",
    })
  );
  assert.equal(acceptedOther.status, 200);
  for (const cookie of [ownerCookie, memberCookie]) {
    const activated = await runtime.handle(
      new Request("http://app.local/api/auth/organization/set-active", {
        body: JSON.stringify({ organizationId: organization.id }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      })
    );
    assert.equal(activated.status, 200);
  }

  const listedFromOtherMemberOrganization = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-members?organizationId=${otherOrganization.id}`,
      { headers: { cookie: memberCookie } }
    )
  );
  assert.equal(listedFromOtherMemberOrganization.status, 200);

  const listed = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-members?organizationId=${organization.id}`,
      { headers: { cookie: ownerCookie } }
    )
  );
  assert.equal(listed.status, 200);
  const listedFromActiveOrganization = await runtime.handle(
    new Request("http://app.local/api/auth/organization/list-members", {
      headers: { cookie: ownerCookie },
    })
  );
  assert.equal(listedFromActiveOrganization.status, 200);
  const listedBody = await json(listed);
  const listedMembers = listedBody.members as Array<{
    email?: string | null;
    user?: { email?: string };
    userId?: string;
  }>;
  assert.equal(listedMembers.length, 2);
  assert.deepEqual(
    new Set(listedMembers.map((item) => item.user?.email)),
    new Set(["owner@example.com", "member@example.com"])
  );
  assert.deepEqual(
    new Set(listedMembers.map((item) => item.email)),
    new Set(["owner@example.com", "member@example.com"])
  );
  for (const item of listedMembers) {
    assert.ok(item.user?.email);
    assert.notEqual(item.user.email, item.userId);
  }

  const crossRead = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-members?organizationId=${organization.id}`,
      {
        headers: {
          cookie:
            (
              await runtime.handle(
                new Request("http://app.local/api/auth/sign-up/email", {
                  body: JSON.stringify({
                    email: "outsider@example.com",
                    password: "Password123!",
                  }),
                  headers: { "content-type": "application/json" },
                  method: "POST",
                })
              )
            ).headers.get("set-cookie") ?? "",
        },
      }
    )
  );
  assert.equal(crossRead.status, 403);
});

test("createClient local mode requires pgUri", () => {
  assert.throws(
    () =>
      createClient({
        auth: { mode: "local" },
        key: "key",
        url: "https://athena.example.com",
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_LOCAL_DATABASE_REQUIRED"
  );
});

test("password PHC hashes from the Rust default profile do not need rehash", () => {
  const rustStyleHash = "$argon2id$v=19$m=1024,t=2,p=1$c29tZXNhbHQ$dGVzdGhhc2g";
  assert.equal(passwordHashNeedsRehash(rustStyleHash), false);
  assert.equal(
    passwordHashNeedsRehash("$argon2id$v=19$m=512,t=2,p=1$c29tZXNhbHQ$dGVzdA"),
    true
  );
  assert.equal(
    passwordHashNeedsRehash(
      "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$dGVzdA"
    ),
    false
  );
});

test("organization update applies Better Auth data envelope name, slug, and logo", async () => {
  const runtime = createRuntime();
  const owner = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "org-update@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const ownerCookie = owner.headers.get("set-cookie") ?? "";
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Acme", slug: "acme" }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const createdBody = await json(created);
  const organization = createdBody.organization as { id: string };

  const updated = await runtime.handle(
    new Request("http://app.local/api/auth/organization/update", {
      body: JSON.stringify({
        data: {
          image: "data:image/png;base64,abc",
          logo: "data:image/png;base64,abc",
          name: "Acme Labs",
          slug: "acme-labs",
        },
        organizationId: organization.id,
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(updated.status, 200);
  const updatedBody = await json(updated);
  const next = updatedBody.organization as {
    logo: string | null;
    name: string;
    slug: string;
  };
  assert.equal(next.name, "Acme Labs");
  assert.equal(next.slug, "acme-labs");
  assert.equal(next.logo, "data:image/png;base64,abc");

  const cleared = await runtime.handle(
    new Request("http://app.local/api/auth/organization/update", {
      body: JSON.stringify({
        data: { logo: "" },
        organizationId: organization.id,
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(cleared.status, 200);
  const clearedBody = await json(cleared);
  const afterClear = clearedBody.organization as { logo: string | null };
  assert.equal(afterClear.logo, null);
});

test("founding owner cannot be removed, role-downgraded, or leave", async () => {
  const runtime = createRuntime();
  const owner = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "founder@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const ownerCookie = owner.headers.get("set-cookie") ?? "";
  const ownerSession = await json(
    await runtime.handle(
      new Request("http://app.local/api/auth/get-session", {
        headers: { cookie: ownerCookie },
      })
    )
  );
  const founderUserId = (ownerSession.user as { id: string }).id;
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Foundry", slug: "foundry" }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const organization = (await json(created)).organization as {
    createdByUserId?: string | null;
    id: string;
  };
  assert.equal(organization.createdByUserId, founderUserId);

  const delegated = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "delegated-owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const delegatedCookie = delegated.headers.get("set-cookie") ?? "";
  const delegatedSession = await json(
    await runtime.handle(
      new Request("http://app.local/api/auth/get-session", {
        headers: { cookie: delegatedCookie },
      })
    )
  );
  const delegatedUserId = (delegatedSession.user as { id: string }).id;
  const added = await runtime.handle(
    new Request("http://app.local/api/auth/organization/add-member", {
      body: JSON.stringify({
        organizationId: organization.id,
        role: "owner",
        userId: delegatedUserId,
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(added.status, 200);

  const removeFounder = await runtime.handle(
    new Request("http://app.local/api/auth/organization/remove-member", {
      body: JSON.stringify({
        memberId: founderUserId,
        organizationId: organization.id,
      }),
      headers: {
        "content-type": "application/json",
        cookie: delegatedCookie,
      },
      method: "POST",
    })
  );
  assert.equal(removeFounder.status, 403);
  assert.equal(
    (await json(removeFounder)).message,
    "The founding owner cannot be removed from the organization"
  );

  const downgrade = await runtime.handle(
    new Request("http://app.local/api/auth/organization/update-member-role", {
      body: JSON.stringify({
        memberId: founderUserId,
        organizationId: organization.id,
        role: "admin",
      }),
      headers: {
        "content-type": "application/json",
        cookie: delegatedCookie,
      },
      method: "POST",
    })
  );
  assert.equal(downgrade.status, 403);
  assert.equal(
    (await json(downgrade)).message,
    "The founding owner role is locked."
  );

  const leave = await runtime.handle(
    new Request("http://app.local/api/auth/organization/leave", {
      body: JSON.stringify({ organizationId: organization.id }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(leave.status, 403);
  assert.equal(
    (await json(leave)).message,
    "The founding owner can't leave the organization."
  );
});

test("remove-member clears activeOrganizationId on every session for that user", async () => {
  const runtime = createRuntime();
  const owner = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "session-owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const ownerCookie = owner.headers.get("set-cookie") ?? "";
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Sessions", slug: "sessions-org" }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  const organization = (await json(created)).organization as { id: string };

  const memberSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "session-member@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const memberCookieA = memberSignup.headers.get("set-cookie") ?? "";
  const memberUserId = (
    (
      await json(
        await runtime.handle(
          new Request("http://app.local/api/auth/get-session", {
            headers: { cookie: memberCookieA },
          })
        )
      )
    ).user as { id: string }
  ).id;

  assert.equal(
    (
      await runtime.handle(
        new Request("http://app.local/api/auth/organization/add-member", {
          body: JSON.stringify({
            organizationId: organization.id,
            role: "owner",
            userId: memberUserId,
          }),
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          method: "POST",
        })
      )
    ).status,
    200
  );

  const memberSignInB = await runtime.handle(
    new Request("http://app.local/api/auth/sign-in/email", {
      body: JSON.stringify({
        email: "session-member@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const memberCookieB = memberSignInB.headers.get("set-cookie") ?? "";

  for (const cookie of [memberCookieA, memberCookieB]) {
    assert.equal(
      (
        await runtime.handle(
          new Request("http://app.local/api/auth/organization/set-active", {
            body: JSON.stringify({ organizationId: organization.id }),
            headers: {
              "content-type": "application/json",
              cookie,
            },
            method: "POST",
          })
        )
      ).status,
      200
    );
  }

  const listed = await json(
    await runtime.handle(
      new Request(
        `http://app.local/api/auth/organization/list-members?organizationId=${organization.id}`,
        { headers: { cookie: ownerCookie } }
      )
    )
  );
  const memberRow = (
    listed.members as Array<{ id: string; userId: string }>
  ).find((item) => item.userId === memberUserId);
  assert.ok(memberRow);

  const removed = await runtime.handle(
    new Request("http://app.local/api/auth/organization/remove-member", {
      body: JSON.stringify({
        memberId: memberRow.id,
        organizationId: organization.id,
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(removed.status, 200);

  for (const cookie of [memberCookieA, memberCookieB]) {
    const sessionBody = await json(
      await runtime.handle(
        new Request("http://app.local/api/auth/get-session", {
          headers: { cookie },
        })
      )
    );
    assert.equal(
      (sessionBody.session as { activeOrganizationId: string | null })
        .activeOrganizationId,
      null
    );
    assert.equal((sessionBody.user as { id: string }).id, memberUserId);
  }
});

test("get-session heals a stale activeOrganizationId when membership is already gone", async () => {
  const runtime = createRuntime();
  const owner = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "heal-owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const ownerCookie = owner.headers.get("set-cookie") ?? "";
  const organization = (
    await json(
      await runtime.handle(
        new Request("http://app.local/api/auth/organization/create", {
          body: JSON.stringify({ name: "Heal", slug: "heal-org" }),
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          method: "POST",
        })
      )
    )
  ).organization as { id: string };

  const memberSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "heal-member@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const memberCookie = memberSignup.headers.get("set-cookie") ?? "";
  const memberUserId = (
    (
      await json(
        await runtime.handle(
          new Request("http://app.local/api/auth/get-session", {
            headers: { cookie: memberCookie },
          })
        )
      )
    ).user as { id: string }
  ).id;

  assert.equal(
    (
      await runtime.handle(
        new Request("http://app.local/api/auth/organization/add-member", {
          body: JSON.stringify({
            organizationId: organization.id,
            role: "member",
            userId: memberUserId,
          }),
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          method: "POST",
        })
      )
    ).status,
    200
  );
  assert.equal(
    (
      await runtime.handle(
        new Request("http://app.local/api/auth/organization/set-active", {
          body: JSON.stringify({ organizationId: organization.id }),
          headers: {
            "content-type": "application/json",
            cookie: memberCookie,
          },
          method: "POST",
        })
      )
    ).status,
    200
  );

  const stores = await runtime.getStores();
  await stores.removeMember(organization.id, memberUserId);

  const healed = await json(
    await runtime.handle(
      new Request("http://app.local/api/auth/get-session", {
        headers: { cookie: memberCookie },
      })
    )
  );
  assert.equal(
    (healed.session as { activeOrganizationId: string | null })
      .activeOrganizationId,
    null
  );
  const healedToken = (healed.session as { token: string }).token;
  const stored = await stores.getSessionByToken(healedToken);
  assert.equal(stored?.active_organization_id, null);
  assert.equal((healed.user as { id: string }).id, memberUserId);
});

test("delete-organization clears activeOrganizationId on every session for that org", async () => {
  const runtime = createRuntime();
  const owner = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "delete-owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const ownerCookie = owner.headers.get("set-cookie") ?? "";
  const organization = (
    await json(
      await runtime.handle(
        new Request("http://app.local/api/auth/organization/create", {
          body: JSON.stringify({ name: "Gone", slug: "gone-org" }),
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          method: "POST",
        })
      )
    )
  ).organization as { id: string };

  const memberSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "delete-member@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const memberCookie = memberSignup.headers.get("set-cookie") ?? "";
  const memberUserId = (
    (
      await json(
        await runtime.handle(
          new Request("http://app.local/api/auth/get-session", {
            headers: { cookie: memberCookie },
          })
        )
      )
    ).user as { id: string }
  ).id;
  assert.equal(
    (
      await runtime.handle(
        new Request("http://app.local/api/auth/organization/add-member", {
          body: JSON.stringify({
            organizationId: organization.id,
            role: "owner",
            userId: memberUserId,
          }),
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          method: "POST",
        })
      )
    ).status,
    200
  );
  assert.equal(
    (
      await runtime.handle(
        new Request("http://app.local/api/auth/organization/set-active", {
          body: JSON.stringify({ organizationId: organization.id }),
          headers: {
            "content-type": "application/json",
            cookie: memberCookie,
          },
          method: "POST",
        })
      )
    ).status,
    200
  );

  const deleted = await runtime.handle(
    new Request("http://app.local/api/auth/organization/delete", {
      body: JSON.stringify({ organizationId: organization.id }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      method: "POST",
    })
  );
  assert.equal(deleted.status, 200);

  for (const cookie of [ownerCookie, memberCookie]) {
    const sessionBody = await json(
      await runtime.handle(
        new Request("http://app.local/api/auth/get-session", {
          headers: { cookie },
        })
      )
    );
    assert.equal(
      (sessionBody.session as { activeOrganizationId: string | null })
        .activeOrganizationId,
      null
    );
  }
});
