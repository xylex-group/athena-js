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
import { sanitizeHookMember, sanitizeHookOrganization } from "../src/auth/hooks/sanitize.ts";
import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";
import { MemoryAuthStores } from "../src/auth/local/memory-stores.ts";
import {
  createMemoryAuthMutationTransaction,
  createPostgresAuthMutationTransaction,
} from "../src/auth/local/mutation-transaction.ts";
import { createApplicationAuthorizationLifecycle } from "../src/auth/local/application-authorization-lifecycle.ts";
import {
  createMemoryAuthAuditWriter,
  type MemoryAuthAuditSink,
} from "../src/auth/observability/audit.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { AthenaConfigurationError, createClient } from "../src/v3-client.ts";
import { getAthenaAuthorizationRightsIr } from "../src/runtime/authorization/catalog.ts";
import { parseAthenaRightKey } from "../src/rights/key.ts";
import { resolveAthenaRightsIr } from "../src/rights/resolver.ts";

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

function waLifecycleTestRights() {
  const applicationRight = {
    assignable: true,
    description: "Test application Right",
    displayName: "WA test access",
    domain: "wa",
    key: parseAthenaRightKey("wa.test.read"),
    riskLevel: "low" as const,
    scopeKind: "organization" as const,
  };
  const builtInRights = getAthenaAuthorizationRightsIr().rights.map(
    (definition) => ({ definition, source: "athena:builtin" }),
  );
  return {
    applicationRightKeys: ["authorization.roles.read", "wa.test.read"],
    authorizationRightsIr: resolveAthenaRightsIr(
      [...builtInRights, { definition: applicationRight, source: "test:wa" }],
    ),
  };
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
    "local/authorization-routes.ts",
    "local/identity-connections/admin-routes.ts",
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
    auth: {
      applicationAuthorization: { application: "wa" },
      hooks,
      mode: "local",
    },
    db: { pgUri },
  });
  const reused = createClient({
    auth: {
      applicationAuthorization: { application: "wa" },
      hooks,
      mode: "local",
    },
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
  assert.throws(
    () =>
      createClient({
        auth: {
          applicationAuthorization: { application: "other" },
          hooks,
          mode: "local",
        },
        db: { pgUri },
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_RUNTIME_CONFIG_CONFLICT",
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
  const lifecycleMembers: string[] = [];
  const { applicationRightKeys, authorizationRightsIr } = waLifecycleTestRights();
  let lifecycleAuthorization: import("../src/auth/hooks/types.ts").AthenaAuthLifecycleAuthorization | undefined;
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    applicationRightKeys,
    applicationAuthorization: { application: "wa" },
    authorizationRightsIr,
    hasher: createTestHasher(),
    hooks: {
      lifecycle: {
        "organization.create": async ({ result, authorization }) => {
          lifecycleAuthorization = authorization;
          lifecycleMembers.push(result.member.userId);
          await authorization.reconcileOrganizationRoles({
            application: "wa",
            organizationId: result.organization.id,
            roles: [
              { key: "owner", name: "WA Owner", rights: ["wa.test.read"] },
            ],
          });
          await authorization.replaceMemberApplicationRole({
            application: "wa",
            organizationId: result.organization.id,
            roleKey: "owner",
            userId: result.member.userId,
          });
        },
      },
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
  const ownerUserId = ((await json(signup)).user as { id: string }).id;
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
  assert.deepEqual(lifecycleMembers, [ownerUserId]);
  assert.ok(lifecycleAuthorization);
  const createdOrganization = (await json(org)).organization as { id: string };
  const stores = await runtime.getStores();
  await assert.rejects(
    lifecycleAuthorization.reconcileOrganizationRoles({
      application: "wa",
      organizationId: createdOrganization.id,
      roles: [{ key: "late", name: "Late Role", rights: ["wa.test.read"] }],
    }),
    /lifecycle authorization is no longer active/i,
  );
  const authorization = createApplicationAuthorizationLifecycle(
    stores,
    applicationRightKeys,
    { kind: "user", userId: ownerUserId },
    {
      actorUserId: ownerUserId,
      application: "wa",
      isActive: () => true,
      organizationId: createdOrganization.id,
      userId: ownerUserId,
    },
  );
  const roles = await stores.authorization.listRoles({
    organizationId: createdOrganization.id,
    scopeKind: "organization",
  });
  const waOwner = roles.find(({ key }) => key === "application_wa_owner");
  assert.ok(waOwner);
  assert.equal(waOwner.protected, true);
  assert.equal(waOwner.assignable, false);
  assert.deepEqual(
    await stores.authorization.listRoleRights(waOwner.id),
    ["wa.test.read"],
  );
  await assert.rejects(
    stores.authorization.createRole({
      actorRights: [],
      actorUserId: ownerUserId,
      applicationManaged: true,
      applicationKey: "application_wa_forged",
      name: "Forged Role",
      organizationId: createdOrganization.id,
      rights: ["wa.test.read"],
      scopeKind: "organization",
      unrestrictedGrant: true,
    }),
    /lifecycle authorization/i,
  );
  await assert.rejects(
    authorization.reconcileOrganizationRoles({
      application: "foo",
      organizationId: createdOrganization.id,
      roles: [{ key: "bar", name: "Other Application Role", rights: ["wa.test.read"] }],
    }),
    /lifecycle authorization is scoped/i,
  );
  assert.equal(
    (await stores.authorization.listRoles({
      organizationId: createdOrganization.id,
      scopeKind: "organization",
    })).some(({ key }) => key === "application_foo_bar"),
    false,
  );
  await assert.rejects(
    authorization.reconcileOrganizationRoles({
      application: "wa",
      organizationId: createdOrganization.id,
      roles: [
        { key: "admin", name: "WA Admin", rights: ["authorization.roles.write"] },
      ],
    }),
    /not contributed by the application/,
  );
  await authorization.reconcileOrganizationRoles({
    application: "wa",
    organizationId: createdOrganization.id,
    roles: [
      { key: "candidate", name: "WA Candidate", rights: ["wa.test.read"] },
    ],
  });
  await assert.rejects(
    stores.authorization.replaceRoleRights({
      actorRights: [],
      expectedVersion: waOwner.version,
      id: waOwner.id,
      organizationId: createdOrganization.id,
      rights: [],
      unrestrictedGrant: true,
    }),
    /protected/i,
  );
  await assert.rejects(
    stores.authorization.updateRole({
      expectedVersion: waOwner.version,
      id: waOwner.id,
      name: "Renamed WA Owner",
      organizationId: createdOrganization.id,
    }),
    /protected/i,
  );
  await assert.rejects(
    stores.authorization.deleteRole({
      actorUserId: ownerUserId,
      expectedVersion: waOwner.version,
      id: waOwner.id,
      organizationId: createdOrganization.id,
    }),
    /protected/i,
  );
  const currentAssignments = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: createdOrganization.id,
  });
  const currentAssignment = currentAssignments.assignments[0];
  assert.ok(currentAssignment);
  const waCandidate = (await stores.authorization.listRoles({
    organizationId: createdOrganization.id,
    scopeKind: "organization",
  })).find(({ key }) => key === "application_wa_candidate");
  assert.ok(waCandidate);
  await assert.rejects(
    stores.authorization.replaceMemberRoleAssignments({
      actorRights: [],
      expectedVersion: currentAssignments.revision,
      memberId: currentAssignment.memberId,
      memberUserId: ownerUserId,
      organizationId: createdOrganization.id,
      roleIds: [...currentAssignment.roleIds, waCandidate.id],
      unrestrictedGrant: true,
    }),
    /not assignable/i,
  );
  await assert.rejects(
    stores.authorization.replaceMemberRoleAssignments({
      actorRights: [],
      expectedVersion: currentAssignments.revision,
      memberId: currentAssignment.memberId,
      memberUserId: ownerUserId,
      organizationId: createdOrganization.id,
      roleIds: currentAssignment.roleIds.filter((id) => id !== waOwner.id),
      unrestrictedGrant: true,
    }),
    /not assignable/i,
  );
  const originalGetRole = stores.authorization.getRole.bind(stores.authorization);
  stores.authorization.getRole = async (id, organizationId) => {
    const detail = await originalGetRole(id, organizationId);
    return detail?.id === waOwner.id
      ? { ...detail, rights: [parseAthenaRightKey("authorization.roles.write")] }
      : detail;
  };
  await assert.rejects(
    authorization.replaceMemberApplicationRole({
      application: "wa",
      organizationId: createdOrganization.id,
      roleKey: "owner",
      userId: ownerUserId,
    }),
    /not contributed by the application/,
  );
  stores.authorization.getRole = originalGetRole;
  assert.ok(
    (await stores.authorization.listAudit({ organizationId: createdOrganization.id }))
      .some((entry) => entry.actor_user_id === ownerUserId),
  );
  const assignments = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: createdOrganization.id,
  });
  assert.ok(assignments.assignments[0]?.roleIds.includes(waOwner.id));

  await authorization.reconcileOrganizationRoles({
    application: "wa",
    organizationId: createdOrganization.id,
    roles: ["owner", "admin", "member", "auditor"].map((key) => ({
      key,
      name: `WA ${key[0]?.toUpperCase()}${key.slice(1)}`,
      rights: ["authorization.roles.read"],
    })),
  });
  const allRoles = await stores.authorization.listRoles({
    organizationId: createdOrganization.id,
    scopeKind: "organization",
  });
  const admin = await authorization.replaceMemberApplicationRole({
    application: "wa",
    organizationId: createdOrganization.id,
    roleKey: "admin",
    userId: ownerUserId,
  });
  assert.equal(admin.changed, true);
  const afterDowngrade = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: createdOrganization.id,
  });
  const waAdmin = allRoles.find(({ key }) => key === "application_wa_admin");
  assert.ok(waAdmin);
  const ownerDetail = await stores.authorization.getRole(waOwner.id, createdOrganization.id);
  assert.deepEqual(ownerDetail?.rights, ["authorization.roles.read"]);
  assert.ok(afterDowngrade.assignments[0]?.roleIds.includes(waAdmin.id));
  assert.equal(afterDowngrade.assignments[0]?.roleIds.includes(waOwner.id), false);

  await authorization.replaceMemberApplicationRole({
    application: "wa",
    organizationId: createdOrganization.id,
    roleKey: "member",
    userId: ownerUserId,
  });
  const afterMemberDowngrade = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: createdOrganization.id,
  });
  const waMember = allRoles.find(({ key }) => key === "application_wa_member");
  assert.ok(waMember);
  assert.ok(afterMemberDowngrade.assignments[0]?.roleIds.includes(waMember.id));
  assert.equal(afterMemberDowngrade.assignments[0]?.roleIds.includes(waAdmin.id), false);

  await authorization.replaceMemberApplicationRole({
    application: "wa",
    organizationId: createdOrganization.id,
    roleKey: "auditor",
    userId: ownerUserId,
  });
  const waAuditor = allRoles.find(({ key }) => key === "application_wa_auditor");
  assert.ok(waAuditor);
  const auditorAssignment = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: createdOrganization.id,
  });
  const memberAssignment = auditorAssignment.assignments[0];
  assert.ok(memberAssignment);
  await assert.rejects(
    stores.authorization.replaceMemberRoleAssignments({
      actorRights: [],
      expectedVersion: auditorAssignment.revision,
      memberId: memberAssignment.memberId,
      memberUserId: ownerUserId,
      organizationId: createdOrganization.id,
      roleIds: [...memberAssignment.roleIds, waOwner.id],
      unrestrictedGrant: true,
    }),
    /not assignable/i,
  );
  const retainedAuditor = await authorization.replaceMemberApplicationRole({
    application: "wa",
    organizationId: createdOrganization.id,
    preserveRoleKeys: ["auditor"],
    roleKey: "member",
    userId: ownerUserId,
  });
  assert.equal(retainedAuditor.changed, false);
  const afterAuditor = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: createdOrganization.id,
  });
  assert.ok(afterAuditor.assignments[0]?.roleIds.includes(waAuditor.id));
  assert.equal(afterAuditor.assignments[0]?.roleIds.includes(waOwner.id), false);
  assert.equal(afterAuditor.assignments[0]?.roleIds.includes(waMember.id), false);
});

test("organization.member.add lifecycle provisions an application role with the triggering actor", async () => {
  const { applicationRightKeys, authorizationRightsIr } = waLifecycleTestRights();
  let ownerUserId = "";
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    applicationRightKeys,
    applicationAuthorization: { application: "wa" },
    authorizationRightsIr,
    hasher: createTestHasher(),
    hooks: {
      lifecycle: {
        "organization.member.add": async ({ actor, authorization, result }) => {
          assert.equal(actor.userId, ownerUserId);
          await authorization.reconcileOrganizationRoles({
            application: "wa",
            organizationId: result.member.organizationId,
            roles: [
              { key: "member", name: "WA Member", rights: ["wa.test.read"] },
            ],
          });
          await authorization.replaceMemberApplicationRole({
            application: "wa",
            organizationId: result.member.organizationId,
            roleKey: "member",
            userId: result.member.userId,
          });
        },
      },
    },
  });
  const register = async (email: string) => {
    const response = await runtime.handle(
      new Request("http://app.local/api/auth/sign-up/email", {
        body: JSON.stringify({ email, password: "Password123!" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    assert.equal(response.status, 200);
    return response;
  };
  try {
    const ownerSignup = await register("member-add-owner@example.com");
    ownerUserId = ((await json(ownerSignup)).user as { id: string }).id;
    const targetSignup = await register("member-add-target@example.com");
    const targetUserId = ((await json(targetSignup)).user as { id: string }).id;
    const ownerCookie = cookieHeader(ownerSignup);
    const created = await runtime.handle(
      new Request("http://app.local/api/auth/organization/create", {
        body: JSON.stringify({ name: "Member Add", slug: "member-add" }),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        method: "POST",
      })
    );
    assert.equal(created.status, 200);
    const organizationId = ((await json(created)).organization as { id: string }).id;
    const added = await runtime.handle(
      new Request("http://app.local/api/auth/organization/add-member", {
        body: JSON.stringify({
          organizationId,
          role: "member",
          userId: targetUserId,
        }),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        method: "POST",
      })
    );
    assert.equal(added.status, 200);
    const stores = await runtime.getStores();
    const member = (await stores.listMembers(organizationId)).find(
      ({ user_id }) => user_id === targetUserId
    );
    assert.ok(member);
    const role = (await stores.authorization.listRoles({
      organizationId,
      scopeKind: "organization",
    })).find(({ key }) => key === "application_wa_member");
    assert.ok(role);
    const assignment = await stores.authorization.readMemberRoleAssignmentsSnapshot({
      organizationId,
    });
    assert.ok(assignment.assignments.find(({ memberId }) => memberId === member.id)?.roleIds.includes(role.id));
    assert.ok(
      (await stores.authorization.listAudit({ organizationId }))
        .some((entry) => entry.actor_user_id === ownerUserId),
    );
  } finally {
    await runtime.close();
  }
});

test("organization lifecycle authorization failures roll back Auth and authorization writes", async () => {
  const { applicationRightKeys, authorizationRightsIr } = waLifecycleTestRights();
  let failedOrganizationId: string | undefined;
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    applicationRightKeys,
    applicationAuthorization: { application: "wa" },
    authorizationRightsIr,
    hasher: createTestHasher(),
    hooks: {
      lifecycle: {
        "organization.create": async ({ authorization, result }) => {
          failedOrganizationId = result.organization.id;
          await authorization.reconcileOrganizationRoles({
            application: "wa",
            organizationId: result.organization.id,
            roles: [
              { key: "owner", name: "WA Owner", rights: ["wa.test.read"] },
            ],
          });
          await authorization.replaceMemberApplicationRole({
            application: "wa",
            organizationId: result.organization.id,
            roleKey: "owner",
            userId: result.member.userId,
          });
          throw new Error("WA role provisioning unavailable");
        },
      },
    },
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({ email: "lifecycle@example.com", password: "Password123!" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(signup.status, 200);
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Lifecycle", slug: "lifecycle" }),
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(signup),
      },
      method: "POST",
    }),
  );
  assert.equal(created.status, 500);
  assert.equal((await json(created)).code, "ATHENA_AUTH_INTERNAL");
  assert.ok(failedOrganizationId);

  const stores = await runtime.getStores();
  assert.equal(await stores.getOrganization(failedOrganizationId), undefined);
  assert.deepEqual(await stores.listMembers(failedOrganizationId), []);
  assert.equal(
    (await stores.authorization.listRoles({
      organizationId: failedOrganizationId,
      scopeKind: "organization",
    })).some(({ key }) => key.startsWith("application_wa_")),
    false,
  );
  const assignments = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: failedOrganizationId,
  });
  assert.deepEqual(assignments.assignments, []);
  assert.equal(assignments.revision, 1);
});

test("lifecycle authorization cannot be used after its handler returns", async () => {
  const { applicationRightKeys, authorizationRightsIr } = waLifecycleTestRights();
  const stores = new MemoryAuthStores({ rightsIr: authorizationRightsIr });
  let retained: import("../src/auth/hooks/types.ts").AthenaAuthLifecycleAuthorization | undefined;

  await executeAuthMutation({
    context: {
      actor: { kind: "user", userId: "user-lifecycle-lease" },
      request: { method: "POST", path: "/organization/create" },
      traceId: "trace-lifecycle-lease",
    },
    event: "organization.create",
    execute: async ({ stores: mutationStores }) => {
      await mutationStores.createUser({
        email: "lease@example.com",
        id: "user-lifecycle-lease",
      });
      const organization = await mutationStores.createOrganization({
        createdByUserId: "user-lifecycle-lease",
        id: "org-lifecycle-lease",
        name: "Lease",
        slug: "lease",
      });
      const member = await mutationStores.addMember({
        id: "member-lifecycle-lease",
        organizationId: organization.id,
        role: "owner",
        userId: "user-lifecycle-lease",
      });
      return { member, organization };
    },
    hooks: {
      lifecycle: {
        "organization.create": async ({ authorization }) => {
          retained = authorization;
        },
      },
    },
    input: { name: "Lease", slug: "lease" },
    lifecycleAuthorization: (scope, actor, _event, result, isActive) =>
      createApplicationAuthorizationLifecycle(
        scope.stores,
        applicationRightKeys,
        actor,
        {
          actorUserId: actor.userId,
          application: "wa",
          isActive,
          organizationId: result.organization.id,
          userId: result.member.userId,
        },
      ),
    resultOf: ({ member, organization }) => ({
      member: sanitizeHookMember(member),
      organization: sanitizeHookOrganization(organization),
    }),
    transaction: createMemoryAuthMutationTransaction(stores),
  });

  assert.ok(retained);
  await assert.rejects(
    retained.reconcileOrganizationRoles({
      application: "wa",
      organizationId: "org-lifecycle-lease",
      roles: [{ key: "owner", name: "WA Owner", rights: ["wa.test.read"] }],
    }),
    /lifecycle authorization is no longer active/i,
  );
  assert.deepEqual(
    (await stores.authorization.listRoles({
      organizationId: "org-lifecycle-lease",
      scopeKind: "organization",
    })).map(({ key }) => key),
    ["organization_owner", "organization_admin", "organization_member"],
  );
});

test("application role reconciliation is idempotent after trimming the role name", async () => {
  const { applicationRightKeys, authorizationRightsIr } = waLifecycleTestRights();
  const stores = new MemoryAuthStores({ rightsIr: authorizationRightsIr });
  await stores.createUser({ email: "trimmed-role@example.com", id: "user-trimmed-role" });
  await stores.createOrganization({
    createdByUserId: "user-trimmed-role",
    id: "org-trimmed-role",
    name: "Trimmed Role",
    slug: "trimmed-role",
  });

  const authorization = createApplicationAuthorizationLifecycle(
    stores,
    applicationRightKeys,
    { kind: "user", userId: "user-trimmed-role" },
    {
      actorUserId: "user-trimmed-role",
      application: "wa",
      isActive: () => true,
      organizationId: "org-trimmed-role",
      userId: "user-trimmed-role",
    },
  );
  const reconcile = () => authorization.reconcileOrganizationRoles({
    application: "wa",
    organizationId: "org-trimmed-role",
    roles: [{ key: "owner", name: " WA Owner ", rights: ["wa.test.read"] }],
  });
  await reconcile();
  const beforeRole = (await stores.authorization.listRoles({
    organizationId: "org-trimmed-role",
    scopeKind: "organization",
  })).find(({ key }) => key === "application_wa_owner");
  assert.ok(beforeRole);
  const beforeAssignments = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: "org-trimmed-role",
  });
  const beforeAudit = await stores.authorization.listAudit({ organizationId: "org-trimmed-role" });

  await reconcile();

  const afterRole = (await stores.authorization.listRoles({
    organizationId: "org-trimmed-role",
    scopeKind: "organization",
  })).find(({ key }) => key === "application_wa_owner");
  const afterAssignments = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: "org-trimmed-role",
  });
  const afterAudit = await stores.authorization.listAudit({ organizationId: "org-trimmed-role" });
  assert.equal(afterRole?.version, beforeRole.version);
  assert.equal(afterAssignments.revision, beforeAssignments.revision);
  assert.equal(afterAudit.length, beforeAudit.length);
});

test("lifecycle authorization cannot target another application or organization", async () => {
  const { applicationRightKeys, authorizationRightsIr } = waLifecycleTestRights();
  const stores = new MemoryAuthStores({ rightsIr: authorizationRightsIr });
  for (const userId of ["user-scope-a", "user-scope-b"]) {
    await stores.createUser({ email: `${userId}@example.com`, id: userId });
    await stores.createOrganization({
      createdByUserId: userId,
      id: `org-${userId}`,
      name: userId,
      slug: userId,
    });
    await stores.addMember({
      id: `member-${userId}`,
      organizationId: `org-${userId}`,
      role: "owner",
      userId,
    });
  }
  const authorization = createApplicationAuthorizationLifecycle(
    stores,
    applicationRightKeys,
    { kind: "user", userId: "user-scope-a" },
    {
      actorUserId: "user-scope-a",
      application: "wa",
      isActive: () => true,
      organizationId: "org-user-scope-a",
      userId: "user-scope-a",
    },
  );

  await assert.rejects(
    authorization.reconcileOrganizationRoles({
      application: "foo",
      organizationId: "org-user-scope-b",
      roles: [{ key: "owner", name: "Other Owner", rights: ["wa.test.read"] }],
    }),
    /lifecycle authorization is scoped/i,
  );
  assert.equal(
    (await stores.authorization.listRoles({
      organizationId: "org-user-scope-b",
      scopeKind: "organization",
    })).some(({ key }) => key === "application_foo_owner"),
    false,
  );
});

test("organization lifecycle failure rolls back its Auth audit row", async () => {
  const { applicationRightKeys, authorizationRightsIr } = waLifecycleTestRights();
  const stores = new MemoryAuthStores({ rightsIr: authorizationRightsIr });
  const auditSink: MemoryAuthAuditSink = { entries: [] };
  let lifecycleWritesCompleted = false;

  await assert.rejects(
    executeAuthMutation({
      auditWriter: createMemoryAuthAuditWriter(auditSink),
      context: {
        actor: { kind: "user", userId: "user-lifecycle-rollback" },
        request: { method: "POST", path: "/organization/create" },
        traceId: "trace-lifecycle-rollback",
      },
      event: "organization.create",
      execute: async ({ stores: mutationStores }) => {
        await mutationStores.createUser({
          email: "rollback@example.com",
          id: "user-lifecycle-rollback",
        });
        const organization = await mutationStores.createOrganization({
          createdByUserId: "user-lifecycle-rollback",
          id: "org-lifecycle-rollback",
          name: "Rollback",
          slug: "rollback",
        });
        const member = await mutationStores.addMember({
          id: "member-lifecycle-rollback",
          organizationId: organization.id,
          role: "owner",
          userId: "user-lifecycle-rollback",
        });
        return { member, organization };
      },
      hooks: {
        lifecycle: {
          "organization.create": async ({ authorization, result }) => {
            await authorization.reconcileOrganizationRoles({
              application: "wa",
              organizationId: result.organization.id,
              roles: [
                { key: "owner", name: "WA Owner", rights: ["wa.test.read"] },
              ],
            });
            await authorization.replaceMemberApplicationRole({
              application: "wa",
              organizationId: result.organization.id,
              roleKey: "owner",
              userId: result.member.userId,
            });
            lifecycleWritesCompleted = true;
            throw new Error("fail after WA role assignment");
          },
        },
      },
      input: { name: "Rollback", slug: "rollback" },
      lifecycleAuthorization: (scope, actor, _event, result, isActive) =>
        createApplicationAuthorizationLifecycle(
          scope.stores,
          applicationRightKeys,
        actor,
        {
            actorUserId: actor.userId,
          application: "wa",
            isActive,
            organizationId: result.organization.id,
            userId: result.member.userId,
          },
        ),
      resultOf: ({ member, organization }) => ({
        member: sanitizeHookMember(member),
        organization: sanitizeHookOrganization(organization),
      }),
      transaction: createMemoryAuthMutationTransaction(
        stores,
        undefined,
        auditSink,
      ),
    }),
    /fail after WA role assignment/,
  );

  assert.equal(lifecycleWritesCompleted, true);
  assert.equal(await stores.getOrganization("org-lifecycle-rollback"), undefined);
  assert.deepEqual(await stores.listMembers("org-lifecycle-rollback"), []);
  assert.equal(
    (await stores.authorization.listRoles({
      organizationId: "org-lifecycle-rollback",
      scopeKind: "organization",
    })).some(({ key }) => key === "application_wa_owner"),
    false,
  );
  const assignments = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: "org-lifecycle-rollback",
  });
  assert.deepEqual(assignments.assignments, []);
  assert.equal(assignments.revision, 1);
  assert.deepEqual(auditSink.entries, []);
});

test("member role update exposes previous.role to before and result.member.role after", async () => {
  const seen: { previous?: string; result?: string } = {};
  const { applicationRightKeys, authorizationRightsIr } = waLifecycleTestRights();
  const applicationRoles = ["owner", "admin", "member", "auditor"].map((key) => ({
    key,
    name: `WA ${key[0]?.toUpperCase()}${key.slice(1)}`,
    rights: [],
  }));
  const provisionApplicationRole = async (
    authorization: import("../src/auth/hooks/types.ts").AthenaAuthLifecycleAuthorization,
    organizationId: string,
    userId: string,
    roleKey: string,
  ) => {
    await authorization.reconcileOrganizationRoles({
      application: "wa",
      organizationId,
      roles: applicationRoles,
    });
    await authorization.replaceMemberApplicationRole({
      application: "wa",
      organizationId,
      roleKey,
      userId,
    });
  };
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    applicationRightKeys,
    applicationAuthorization: { application: "wa" },
    authorizationRightsIr,
    hasher: createTestHasher(),
    hooks: {
      lifecycle: {
        "organization.invitation.accept": async ({ authorization, actor, result }) => {
          assert.ok(actor.userId);
          await provisionApplicationRole(
            authorization,
            result.invitation.organizationId,
            actor.userId,
            "member",
          );
        },
        "organization.member.role.update": async ({ authorization, result }) => {
          await provisionApplicationRole(
            authorization,
            result.member.organizationId,
            result.member.userId,
            result.member.role,
          );
        },
      },
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
  const stores = await runtime.getStores();
  const applicationRoleCatalog = await stores.authorization.listRoles({
    organizationId: orgId,
    scopeKind: "organization",
  });
  const waMember = applicationRoleCatalog.find(({ key }) => key === "application_wa_member");
  assert.ok(waMember);
  const assignmentsBeforeAdmin = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: orgId,
  });
  const invitedAssignment = assignmentsBeforeAdmin.assignments.find(
    ({ userId }) => userId === memberRow.userId,
  );
  assert.ok(invitedAssignment?.roleIds.includes(waMember.id));
  const invitedAuthorization = await stores.authorization.readSnapshot({
    activeOrganizationId: orgId,
    getMember: (organizationId, userId) => stores.getMember(organizationId, userId),
    listMembers: (organizationId) => stores.listMembers(organizationId),
    userId: memberRow.userId,
  });
  assert.equal(invitedAuthorization.effectiveRights.includes(parseAthenaRightKey("authorization.roles.read")), false);
  assert.equal(invitedAuthorization.effectiveRights.includes(parseAthenaRightKey("organization.members.write")), false);
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
  const assignmentsAfterAdmin = await stores.authorization.readMemberRoleAssignmentsSnapshot({
    organizationId: orgId,
  });
  const waAdmin = applicationRoleCatalog.find(({ key }) => key === "application_wa_admin");
  assert.ok(waAdmin);
  const updatedAssignment = assignmentsAfterAdmin.assignments.find(
    ({ userId }) => userId === memberRow.userId,
  );
  assert.ok(updatedAssignment?.roleIds.includes(waAdmin.id));
  assert.equal(updatedAssignment?.roleIds.includes(waMember.id), false);
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
