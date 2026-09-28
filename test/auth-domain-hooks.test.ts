import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { defineAthenaAuthHooks } from "../src/auth/hooks/define.ts";
import {
  ATHENA_AUTH_DOMAIN_EVENTS,
  ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS,
  ATHENA_AUTH_RESERVED_DOMAIN_EVENTS,
} from "../src/auth/hooks/events.ts";
import { executeAuthMutation } from "../src/auth/hooks/execute.ts";
import type { AthenaAuthHooks } from "../src/auth/hooks/types.ts";
import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";
import { MemoryAuthStores } from "../src/auth/local/memory-stores.ts";
import {
  createMemoryAuthMutationTransaction,
  createPostgresAuthMutationTransaction,
} from "../src/auth/local/mutation-transaction.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
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

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function cookieHeader(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

test("reserved domain events are not hookable keys", () => {
  type ReservedHookKey = Extract<
    keyof NonNullable<AthenaAuthHooks["after"]>,
    (typeof ATHENA_AUTH_RESERVED_DOMAIN_EVENTS)[number]
  >;
  type ReservedUnhookable = ReservedHookKey extends never ? true : never;
  const reservedUnhookable: ReservedUnhookable = true;
  assert.equal(reservedUnhookable, true);
  assert.equal(
    ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("account.link"),
    true
  );
  assert.equal(
    ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("account.unlink"),
    true
  );
  assert.equal(ATHENA_AUTH_DOMAIN_EVENTS["account.link"].status, "implemented");
  assert.equal(
    ATHENA_AUTH_DOMAIN_EVENTS["account.unlink"].status,
    "implemented"
  );
  assert.equal(
    ATHENA_AUTH_DOMAIN_EVENTS["user.sign-in.social"].status,
    "implemented"
  );
  assert.equal(ATHENA_AUTH_DOMAIN_EVENTS["user.create"].status, "implemented");
});

test("defineAthenaAuthHooks keeps object identity and types after payloads", () => {
  const source = { after: {} };
  assert.equal(defineAthenaAuthHooks(source), source);
  const typed = defineAthenaAuthHooks({
    after: {
      "user.create": async ({ result }) => {
        assert.equal(typeof result.user.id, "string");
      },
    },
  });
  assert.equal(typeof typed.after?.["user.create"], "function");
});

test("implemented events have executeAuthMutation call sites; reserved have none", async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../src/auth");
  const files = [
    "local/runtime.ts",
    "local/runtime-dependencies.ts",
    "local/router.ts",
    "local/admin-routes.ts",
    "local/credential-password-routes.ts",
    "local/extended-routes.ts",
    "local/organization-invitation-routes.ts",
    "local/email/user-routes.ts",
    "local/passkey/verify-authentication.ts",
    "local/passkey/verify-registration.ts",
    "local/passkey/manage-passkeys.ts",
    "local/social/routes.ts",
    "local/social/runtime.ts",
    "local/authorization-server/routes.ts",
    "local/authorization-server/service.ts",
  ];
  const source = (
    await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))
  ).join("\n");
  for (const event of ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS) {
    assert.ok(
      source.includes(`event: "${event}"`),
      `implemented event ${event} must have an executeAuthMutation call site`
    );
  }
  for (const event of ATHENA_AUTH_RESERVED_DOMAIN_EVENTS) {
    assert.equal(
      source.includes(`event: "${event}"`),
      false,
      `reserved event ${event} must not be emitted`
    );
  }
});

test("executor and mutation scope do not import storage implementations", async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../src/auth");
  const executeSource = await readFile(join(root, "hooks/execute.ts"), "utf8");
  const scopeSource = await readFile(join(root, "hooks/scope.ts"), "utf8");
  for (const source of [executeSource, scopeSource]) {
    assert.equal(source.includes("memory-stores"), false);
    assert.equal(source.includes("PostgresAuthStores"), false);
    assert.equal(source.includes("PostgresAdminAuthStore"), false);
    assert.equal(/from ["'][^"']*\/database["']/.test(source), false);
    assert.equal(source.includes("database?:"), false);
  }
});

test("Postgres mutation factory binds persistAudit to the transaction, not a database field", async () => {
  const queries: string[] = [];
  const database: AthenaAuthDatabase = {
    async close() {},
    inTransaction: false,
    async query(text: string) {
      queries.push(text);
      return { rowCount: 1, rows: [] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
  const tx = createPostgresAuthMutationTransaction(database, true);
  await tx(async (scope) => {
    assert.equal("database" in scope, false);
    assert.equal(typeof scope.persistAudit, "function");
    await scope.persistAudit?.({
      actor: { kind: "user" },
      event: "user.create",
      eventId: "e1",
      id: "00000000-0000-0000-0000-000000000001",
      outcome: "success",
      request: {},
      traceId: "t1",
    });
  });
  assert.ok(
    queries.some((sql) => /insert into athena\.audit_log_auth/i.test(sql))
  );
});

test("remote auth.hooks throws ATHENA_AUTH_HOOKS_REQUIRE_LOCAL_RUNTIME", () => {
  assert.throws(
    () =>
      createClient({
        auth: {
          hooks: { after: {} },
          mode: "remote",
          url: "https://auth.example.com",
        },
        key: "key",
        url: "https://athena.example.com",
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_HOOKS_REQUIRE_LOCAL_RUNTIME"
  );
});

test("shared Postgres runtime reuses the same hooks reference and rejects a different object", () => {
  const pgUri = "postgres://hooks:hooks@127.0.0.1:1/athena-hooks-cache";
  const hooks: AthenaAuthHooks = {};
  const first = createClient({
    auth: { hooks, mode: "local" },
    db: { pgUri },
  });
  const reused = createClient({
    auth: { hooks, mode: "local" },
    db: { pgUri },
  });
  assert.ok(first);
  assert.ok(reused);
  assert.throws(
    () =>
      createClient({
        auth: { hooks: {}, mode: "local" },
        db: { pgUri },
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_RUNTIME_CONFIG_CONFLICT"
  );
});

test("before is fail-fast; after continues; onError throw does not fail HTTP", async () => {
  const beforeCalls: string[] = [];
  const afterCalls: string[] = [];
  let onErrorCalls = 0;
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    hooks: {
      after: {
        "user.create": [
          async () => {
            afterCalls.push("first");
            throw new Error("after boom");
          },
          async () => {
            afterCalls.push("second");
          },
        ],
      },
      before: {
        "user.create": [
          async () => {
            beforeCalls.push("first");
            throw new Error("before boom");
          },
          async () => {
            beforeCalls.push("second");
          },
        ],
      },
      onError: async () => {
        onErrorCalls += 1;
        throw new Error("onError boom");
      },
    },
  });
  const vetoed = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "veto@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(vetoed.status, 400);
  const vetoBody = await json(vetoed);
  assert.equal(vetoBody.code, "ATHENA_AUTH_HOOK_REJECTED");
  assert.deepEqual(beforeCalls, ["first"]);
  assert.deepEqual(afterCalls, []);
  assert.equal(onErrorCalls, 1);

  const continuedAfterCalls: string[] = [];
  const afterOnly = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    hooks: {
      after: {
        "user.create": [
          async () => {
            continuedAfterCalls.push("after-first");
            throw new Error("after boom");
          },
          async () => {
            continuedAfterCalls.push("after-second");
          },
        ],
      },
      onError: async () => {
        onErrorCalls += 1;
        throw new Error("onError boom");
      },
    },
  });
  const created = await afterOnly.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "ok@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  assert.deepEqual(continuedAfterCalls, ["after-first", "after-second"]);
  assert.ok(onErrorCalls >= 2);
});

test("before rejection rolls back organization create writes", async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    hooks: {
      before: {
        "organization.create": async () => {
          throw new Error("quota exceeded");
        },
      },
    },
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const create = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Acme" }),
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(signup),
      },
      method: "POST",
    })
  );
  assert.equal(create.status, 400);
  const stores = await runtime.getStores();
  assert.equal(
    (
      await stores.listOrganizationsForUser(
        ((await json(signup)).user as { id: string }).id
      )
    ).length,
    0
  );
});

test("before user.password.reset rejection keeps the reset token", async () => {
  let capturedToken: string | undefined;
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    hooks: {
      before: {
        "user.password.reset": async () => {
          throw new Error("reset blocked");
        },
      },
    },
    legacySend: (message) => {
      capturedToken = message.url;
    },
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "reset-hook@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  await runtime.handle(
    new Request("http://app.local/api/auth/forget-password", {
      body: JSON.stringify({ email: "reset-hook@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.ok(capturedToken);
  const vetoed = await runtime.handle(
    new Request("http://app.local/api/auth/reset-password", {
      body: JSON.stringify({
        newPassword: "NewPassword123!",
        token: capturedToken,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(vetoed.status, 400);
  assert.equal((await json(vetoed)).code, "ATHENA_AUTH_HOOK_REJECTED");
  const stores = await runtime.getStores();
  assert.ok(await stores.getVerificationByValue(capturedToken));
  const signIn = await runtime.handle(
    new Request("http://app.local/api/auth/sign-in/email", {
      body: JSON.stringify({
        email: "reset-hook@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signIn.status, 200);
});

test("GET /change-email/verify before hooks see the resolved user and email", async () => {
  let capturedToken: string | undefined;
  const beforeInputs: Array<{
    actorUserId?: string;
    email: string;
    userId: string;
  }> = [];
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    hooks: {
      before: {
        "user.email.update": async (payload) => {
          beforeInputs.push({
            actorUserId: payload.actor.userId,
            email: payload.input.email,
            userId: payload.input.userId,
          });
        },
      },
    },
    legacySend: (message) => {
      if (message.type === "change-email") {
        capturedToken = message.url;
      }
    },
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "old-hook@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const userId = ((await json(signup)).user as { id: string }).id;
  const cookie = cookieHeader(signup);
  await runtime.handle(
    new Request("http://app.local/api/auth/change-email", {
      body: JSON.stringify({ newEmail: "new-hook@example.com" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.ok(capturedToken);
  const confirm = await runtime.handle(
    new Request(
      `http://app.local/api/auth/change-email/verify?token=${encodeURIComponent(capturedToken)}`
    )
  );
  assert.equal(confirm.status, 200);
  assert.deepEqual(beforeInputs, [
    {
      actorUserId: userId,
      email: "new-hook@example.com",
      userId,
    },
  ]);
});

test("GET /delete-user/verify after hooks receive the deleted user ID", async () => {
  let capturedToken: string | undefined;
  const afterResults: string[] = [];
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    hooks: {
      after: {
        "user.delete": async (payload) => {
          afterResults.push(payload.result.userId);
        },
      },
    },
    legacySend: (message) => {
      if (message.type === "delete-account") {
        capturedToken = /[?&]token=([^&]+)/.exec(message.url ?? "")?.[1];
      }
    },
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "delete-hook@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const userId = ((await json(signup)).user as { id: string }).id;
  const cookie = cookieHeader(signup);
  await runtime.handle(
    new Request("http://app.local/api/auth/delete-user", {
      body: JSON.stringify({}),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.ok(capturedToken);
  const verified = await runtime.handle(
    new Request(
      `http://app.local/api/auth/delete-user/verify?token=${encodeURIComponent(capturedToken)}`
    )
  );
  assert.equal(verified.status, 200);
  assert.deepEqual(afterResults, [userId]);
});

test("org create emits one event; signup emits user.create then session.issue without secrets", async () => {
  const events: string[] = [];
  const payloads: unknown[] = [];
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    hooks: {
      after: {
        "organization.create": async (payload) => {
          events.push(payload.event);
          payloads.push(payload);
        },
        "session.issue": async (payload) => {
          events.push(payload.event);
          payloads.push(payload);
        },
        "user.create": async (payload) => {
          events.push(payload.event);
          payloads.push(payload);
        },
      },
    },
  });
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
  assert.deepEqual(events, ["user.create", "session.issue"]);
  const serialized = JSON.stringify(payloads);
  assert.equal(serialized.includes("Password123!"), false);
  assert.equal(serialized.includes("password_hash"), false);
  assert.equal(serialized.includes("$argon2id"), false);
  assert.equal(serialized.includes('"token"'), false);

  events.length = 0;
  const org = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Ada Labs", slug: "ada-labs" }),
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(signup),
      },
      method: "POST",
    })
  );
  assert.equal(org.status, 200);
  assert.deepEqual(events, ["organization.create"]);
});

test("member role update exposes previous.role to before and result.member.role after", async () => {
  const seen: { previous?: string; result?: string } = {};
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    hooks: {
      after: {
        "organization.member.role.update": async (payload) => {
          seen.result = payload.result.member.role;
        },
      },
      before: {
        "organization.member.role.update": async (payload) => {
          seen.previous = payload.previous?.role;
          assert.equal(payload.actor.kind, "user");
          assert.equal(typeof payload.actor.userId, "string");
        },
      },
    },
  });
  const ownerSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "owner@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const memberSignup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "member@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(ownerSignup.status, 200);
  assert.equal(memberSignup.status, 200);
  const org = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Roles" }),
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(ownerSignup),
      },
      method: "POST",
    })
  );
  assert.equal(org.status, 200);
  const orgId = ((await json(org)).organization as { id: string }).id;
  const invite = await runtime.handle(
    new Request("http://app.local/api/auth/organization/invite-member", {
      body: JSON.stringify({
        email: "member@example.com",
        organizationId: orgId,
        role: "member",
      }),
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(ownerSignup),
      },
      method: "POST",
    })
  );
  assert.equal(invite.status, 200);
  const invitationId = ((await json(invite)).invitation as { id: string }).id;
  const accept = await runtime.handle(
    new Request("http://app.local/api/auth/organization/accept-invitation", {
      body: JSON.stringify({ invitationId }),
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(memberSignup),
      },
      method: "POST",
    })
  );
  assert.equal(accept.status, 200);
  const members = await runtime.handle(
    new Request(
      `http://app.local/api/auth/organization/list-members?organizationId=${orgId}`,
      { headers: { cookie: cookieHeader(ownerSignup) } }
    )
  );
  const memberRow = (
    (await json(members)).members as {
      id: string;
      userId: string;
      role: string;
    }[]
  ).find((item) => item.role === "member");
  assert.ok(memberRow);
  const update = await runtime.handle(
    new Request("http://app.local/api/auth/organization/update-member-role", {
      body: JSON.stringify({
        memberId: memberRow.id,
        organizationId: orgId,
        role: "admin",
      }),
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(ownerSignup),
      },
      method: "POST",
    })
  );
  assert.equal(update.status, 200);
  assert.equal(seen.previous, "member");
  assert.equal(seen.result, "admin");
});

test("admin create-user emits user.create with actor.kind admin", async () => {
  const actors: string[] = [];
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    hooks: {
      after: {
        "user.create": async (payload) => {
          actors.push(payload.actor.kind);
        },
      },
    },
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "root@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  const userId = ((await json(signup)).user as { id: string }).id;
  const stores = await runtime.getStores();
  await stores.updateUser(userId, { role: "admin" });
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/admin/create-user", {
      body: JSON.stringify({
        email: "staff@example.com",
        password: "Password123!",
      }),
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(signup),
      },
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  assert.deepEqual(actors, ["user", "admin"]);
});

test("Memory transaction restores maps when execute throws", async () => {
  const stores = new MemoryAuthStores();
  const transaction = createMemoryAuthMutationTransaction(stores);
  await assert.rejects(
    () =>
      executeAuthMutation({
        context: {
          actor: { kind: "user" },
          request: { method: "POST", path: "/organization/create" },
          traceId: "t",
        },
        event: "organization.create",
        execute: async (scope) => {
          await scope.stores.createOrganization({
            createdByUserId: "u",
            id: "org-1",
            name: "Temp",
            slug: "temp",
          });
          throw new Error("boom");
        },
        input: { name: "Temp", slug: "temp" },
        resultOf: () => ({
          member: {
            createdAt: new Date().toISOString(),
            email: null,
            id: "m",
            organizationId: "org-1",
            role: "owner",
            user: undefined,
            userId: "u",
          },
          organization: {
            createdAt: new Date().toISOString(),
            createdByUserId: "u",
            id: "org-1",
            logo: null,
            metadata: {},
            name: "Temp",
            slug: "temp",
            updatedAt: new Date().toISOString(),
          },
        }),
        transaction,
      }),
    /boom/
  );
  assert.equal(await stores.getOrganization("org-1"), undefined);
});

test("Postgres mutation factory rolls back when the callback throws", async () => {
  let rolledBack = false;
  const database: AthenaAuthDatabase = {
    async close() {},
    inTransaction: false,
    async query() {
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      try {
        return await fn(this);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  };
  const transaction = createPostgresAuthMutationTransaction(database);
  await assert.rejects(
    () =>
      transaction(async () => {
        throw new Error("sql boom");
      }),
    /sql boom/
  );
  assert.equal(rolledBack, true);
});
