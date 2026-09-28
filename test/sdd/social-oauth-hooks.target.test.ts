/**
 * Slice 03 TARGET — Social OAuth domain-hook contract (Phase 1, write first).
 * DESIRED: user.sign-in.social implemented; account.link / account.unlink
 * implemented; AthenaAuthHookAccount sanitized (no tokens/state/PKCE);
 * social mutations go through deps.mutate → executeAuthMutation; no
 * oauth.callback event; before veto rolls back; audit via MemoryAuthAuditSink.
 *
 * RED on CURRENT. Filename stays in RED_CONTRACT_FREEZE until GREEN.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/specs/03-http-hooks-auth-ui.md
 *
 * Host (never `pnpm test:sdd`):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/social-oauth-hooks.baseline.test.ts
 *   test/sdd/social-oauth-hooks.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import {
  ATHENA_AUTH_EVENT_DEFINITIONS,
  isAuditedAuthEvent,
} from "../../src/auth/domain/catalog.ts";
import { defineAthenaAuthHooks } from "../../src/auth/hooks/define.ts";
import {
  ATHENA_AUTH_DOMAIN_EVENTS,
  ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS,
} from "../../src/auth/hooks/events.ts";
import { executeAuthMutation } from "../../src/auth/hooks/execute.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createMemoryAuthMutationTransaction } from "../../src/auth/local/mutation-transaction.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import {
  createMemoryAuthAuditWriter,
  type MemoryAuthAuditSink,
} from "../../src/auth/observability/audit.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const localSocialDir = join(pkgRoot, "src", "auth", "local", "social");

const RUNTIME_SECRET = "athena-social-oauth-hooks-target-secret";
const USER_ID = "11111111-1111-4111-8111-111111111111";

type JsonRecord = Record<string, unknown>;

function readPkg(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

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

function socialSource(): string {
  const parts: string[] = [];
  for (const rel of [
    "src/auth/local/social/routes.ts",
    "src/auth/local/social/runtime.ts",
    "src/auth/local/router.ts",
  ]) {
    if (existsSync(join(pkgRoot, rel))) {
      parts.push(readPkg(rel));
    }
  }
  return parts.join("\n");
}

test("T-SOH-SIGN-IN-SOCIAL: P?: user.sign-in.social is implemented with input.provider and sanitized result {user,account,session}", () => {
  assert.equal("user.sign-in.social" in ATHENA_AUTH_DOMAIN_EVENTS, true);
  assert.equal(
    ATHENA_AUTH_DOMAIN_EVENTS["user.sign-in.social" as "user.sign-in.email"]
      .status,
    "implemented"
  );
  assert.equal(
    ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes(
      "user.sign-in.social" as never
    ),
    true
  );
  const typesSrc = readPkg("src/auth/hooks/types.ts");
  assert.match(typesSrc, /"user\.sign-in\.social":/);
  assert.match(typesSrc, /input:\s*\{\s*provider:/);
  assert.match(
    typesSrc,
    /"user\.sign-in\.social":[\s\S]{0,400}result:[\s\S]{0,200}user/
  );
  assert.match(
    typesSrc,
    /"user\.sign-in\.social":[\s\S]{0,400}result:[\s\S]{0,200}account/
  );
  assert.match(
    typesSrc,
    /"user\.sign-in\.social":[\s\S]{0,400}result:[\s\S]{0,200}session/
  );
  const typed = defineAthenaAuthHooks({
    after: {
      "user.sign-in.social": async ({ input, result }) => {
        assert.equal(typeof input.provider, "string");
        assert.ok(result.user);
        assert.ok(result.account);
        assert.ok(result.session);
      },
    },
    before: {
      "user.sign-in.social": async ({ input }) => {
        assert.equal(typeof input.provider, "string");
      },
    },
  });
  assert.equal(typeof typed.after?.["user.sign-in.social"], "function");
});

test("T-SOH-ACCOUNT-LINK: P?: account.link is implemented with input {provider,userId} and result {account,user}", () => {
  assert.equal(ATHENA_AUTH_DOMAIN_EVENTS["account.link"].status, "implemented");
  assert.equal(
    ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS.includes("account.link" as never),
    true
  );
  const typesSrc = readPkg("src/auth/hooks/types.ts");
  assert.match(typesSrc, /"account\.link":/);
  assert.match(
    typesSrc,
    /"account\.link":[\s\S]{0,240}input:[\s\S]{0,80}provider/
  );
  assert.match(
    typesSrc,
    /"account\.link":[\s\S]{0,240}input:[\s\S]{0,80}userId/
  );
  assert.match(
    typesSrc,
    /"account\.link":[\s\S]{0,400}result:[\s\S]{0,120}account/
  );
  const typed = defineAthenaAuthHooks({
    after: {
      "account.link": async ({ input, result }) => {
        assert.equal(typeof input.provider, "string");
        assert.equal(typeof input.userId, "string");
        assert.ok(result.account);
        assert.ok(result.user);
      },
    },
  });
  assert.equal(typeof typed.after?.["account.link"], "function");
});

test("T-SOH-ACCOUNT-UNLINK: P?: account.unlink is implemented with previous.account snapshot and result {accountId,provider,userId}", () => {
  assert.equal(
    ATHENA_AUTH_DOMAIN_EVENTS["account.unlink"].status,
    "implemented"
  );
  const typesSrc = readPkg("src/auth/hooks/types.ts");
  assert.match(typesSrc, /"account\.unlink":/);
  assert.match(
    typesSrc,
    /"account\.unlink":[\s\S]{0,240}previous:[\s\S]{0,80}account/
  );
  assert.match(
    typesSrc,
    /"account\.unlink":[\s\S]{0,400}result:[\s\S]{0,80}accountId/
  );
  const typed = defineAthenaAuthHooks({
    after: {
      "account.unlink": async ({ input, previous, result }) => {
        assert.equal(typeof input.accountId, "string");
        assert.equal(typeof input.provider, "string");
        assert.equal(typeof input.userId, "string");
        assert.ok(previous?.account);
        assert.equal(typeof result.accountId, "string");
      },
    },
  });
  assert.equal(typeof typed.after?.["account.unlink"], "function");
});

test("T-SOH-HOOK-ACCOUNT-SANITIZE: P?: AthenaAuthHookAccount never includes access/refresh/id token, provider secret, OAuth state, or PKCE verifier", async () => {
  const sanitizeSrc = readPkg("src/auth/hooks/sanitize.ts");
  assert.match(sanitizeSrc, /\bAthenaAuthHookAccount\b/);
  assert.match(sanitizeSrc, /\bsanitizeHookAccount\b/);
  const sanitizeMod = (await import("../../src/auth/hooks/sanitize.ts")) as {
    sanitizeHookAccount?: (row: Record<string, unknown>) => JsonRecord;
  };
  assert.equal(typeof sanitizeMod.sanitizeHookAccount, "function");
  const sanitizeHookAccount = sanitizeMod.sanitizeHookAccount;
  assert.ok(sanitizeHookAccount);
  const dto = sanitizeHookAccount({
    access_token: "secret-access",
    account_id: "acct-1",
    clientSecret: "provider-secret",
    id: "row-1",
    id_token: "secret-id",
    nonce: "oauth-nonce",
    pkce_verifier_ciphertext: "enc-verifier",
    pkceVerifier: "plain-verifier",
    provider_id: "google",
    refresh_token: "secret-refresh",
    state: "oauth-state",
    state_hash: "hashed-state",
    user_id: USER_ID,
  });
  const serialized = JSON.stringify(dto);
  for (const leaked of [
    "secret-access",
    "secret-refresh",
    "secret-id",
    "provider-secret",
    "oauth-state",
    "plain-verifier",
    "enc-verifier",
    "hashed-state",
    "oauth-nonce",
  ]) {
    assert.equal(
      serialized.includes(leaked),
      false,
      `AthenaAuthHookAccount must not leak ${leaked}`
    );
  }
  assert.equal("accessToken" in dto, false);
  assert.equal("access_token" in dto, false);
  assert.equal("refreshToken" in dto, false);
  assert.equal("idToken" in dto, false);
  assert.equal("clientSecret" in dto, false);
  assert.equal("state" in dto, false);
  assert.equal("pkceVerifier" in dto, false);
});

test("T-SOH-MUTATE: P?: social sign-in/link/unlink go through deps.mutate → executeAuthMutation", () => {
  assert.equal(existsSync(join(localSocialDir, "routes.ts")), true);
  assert.equal(existsSync(join(localSocialDir, "runtime.ts")), true);
  const blob = socialSource();
  assert.match(blob, /\bmutate\b/);
  assert.match(blob, /event:\s*"user\.sign-in\.social"/);
  assert.match(blob, /event:\s*"account\.link"/);
  assert.match(blob, /event:\s*"account\.unlink"/);
  const executeSrc = readPkg("src/auth/hooks/execute.ts");
  assert.match(executeSrc, /export async function executeAuthMutation/);
  assert.equal(
    /\bcreateAthenaSocialServerEngine\b/.test(
      existsSync(join(localSocialDir, "routes.ts"))
        ? readPkg("src/auth/local/social/routes.ts")
        : ""
    ),
    false
  );
});

test("T-SOH-NO-OAUTH-CALLBACK: P?: oauth.callback is not a domain event", () => {
  assert.equal("oauth.callback" in ATHENA_AUTH_DOMAIN_EVENTS, false);
  assert.equal("oauth.callback" in ATHENA_AUTH_EVENT_DEFINITIONS, false);
  const eventsSrc = readPkg("src/auth/hooks/events.ts");
  const typesSrc = readPkg("src/auth/hooks/types.ts");
  const opsSrc = readPkg("src/auth/contract/operations.generated.ts");
  assert.equal(/\boauth\.callback\b/.test(eventsSrc), false);
  assert.equal(/\boauth\.callback\b/.test(typesSrc), false);
  assert.equal(
    /domainEvent":\s*"oauth\.callback"/.test(opsSrc),
    false,
    "GET /callback/{provider} must not retarget a domain event named oauth.callback"
  );
});

test("T-SOH-BEFORE-VETO: P?: defineAthenaAuthHooks before veto rolls back social mutation", async () => {
  assert.equal(
    (ATHENA_AUTH_DOMAIN_EVENTS as Record<string, { status: string }>)[
      "user.sign-in.social"
    ]?.status,
    "implemented"
  );
  const stores = new MemoryAuthStores();
  await stores.createUser({
    email: "veto-social@example.test",
    id: USER_ID,
    name: "Veto",
  });
  let executed = false;
  const sink: MemoryAuthAuditSink = { entries: [] };
  await assert.rejects(
    () =>
      executeAuthMutation({
        auditWriter: createMemoryAuthAuditWriter(sink),
        context: {
          actor: { type: "user", userId: USER_ID },
          request: { method: "GET", path: "/callback/google" },
          traceId: "trace-social-veto",
        },
        event: "user.sign-in.social" as never,
        execute: async () => {
          executed = true;
          return { ok: true };
        },
        hooks: defineAthenaAuthHooks({
          before: {
            "user.sign-in.social": async () => {
              throw new Error("social before veto");
            },
          },
        }) as never,
        input: { provider: "google" } as never,
        resultOf: () =>
          ({
            account: { id: "acct", providerId: "google", userId: USER_ID },
            session: { id: "sess", userId: USER_ID },
            user: { id: USER_ID },
          }) as never,
        transaction: createMemoryAuthMutationTransaction(stores),
      }),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code: string }).code === "ATHENA_AUTH_HOOK_REJECTED"
      )
  );
  assert.equal(executed, false, "before veto must not run execute()");
  assert.equal(
    sink.entries.length,
    0,
    "vetoed mutation must not audit success"
  );
});

test("T-SOH-AFTER-PRESERVE: P?: after-hook exception preserves committed social mutation semantics", async () => {
  assert.equal(
    (ATHENA_AUTH_DOMAIN_EVENTS as Record<string, { status: string }>)[
      "user.sign-in.social"
    ]?.status,
    "implemented"
  );
  const stores = new MemoryAuthStores();
  await stores.createUser({
    email: "after-social@example.test",
    id: USER_ID,
    name: "After",
  });
  let executed = false;
  const sink: MemoryAuthAuditSink = { entries: [] };
  await executeAuthMutation({
    auditWriter: createMemoryAuthAuditWriter(sink),
    context: {
      actor: { type: "user", userId: USER_ID },
      request: { method: "GET", path: "/callback/google" },
      traceId: "trace-social-after",
    },
    event: "user.sign-in.social" as never,
    execute: async (scope) => {
      executed = true;
      assert.ok(scope);
      return { ok: true };
    },
    hooks: defineAthenaAuthHooks({
      after: {
        "user.sign-in.social": async () => {
          throw new Error("after boom");
        },
      },
    }) as never,
    input: { provider: "google" } as never,
    resultOf: () =>
      ({
        account: { id: "acct", providerId: "google", userId: USER_ID },
        session: { id: "sess", userId: USER_ID },
        user: { id: USER_ID },
      }) as never,
    transaction: createMemoryAuthMutationTransaction(stores),
  });
  assert.equal(executed, true, "after exception must not un-commit execute()");
});

test("T-SOH-AUDIT: P?: MemoryAuthAuditSink records account.link / account.unlink / user.sign-in.social", () => {
  for (const event of [
    "user.sign-in.social",
    "account.link",
    "account.unlink",
  ] as const) {
    assert.equal(event in ATHENA_AUTH_EVENT_DEFINITIONS, true, event);
    assert.equal(
      isAuditedAuthEvent(event as never),
      true,
      `${event} must be audit: true`
    );
  }
  assert.equal(
    (ATHENA_AUTH_EVENT_DEFINITIONS as Record<string, { subjectType: string }>)[
      "user.sign-in.social"
    ]?.subjectType,
    "user"
  );
  assert.equal(
    (ATHENA_AUTH_EVENT_DEFINITIONS as Record<string, { subjectType: string }>)[
      "account.link"
    ]?.subjectType,
    "account"
  );
  assert.equal(
    (ATHENA_AUTH_EVENT_DEFINITIONS as Record<string, { subjectType: string }>)[
      "account.unlink"
    ]?.subjectType,
    "account"
  );
});

test("T-SOH-COMPANION-SCAN: P?: implemented-event companion scan includes local/social/routes.ts and local/social/runtime.ts", () => {
  assert.equal(existsSync(join(localSocialDir, "routes.ts")), true);
  assert.equal(existsSync(join(localSocialDir, "runtime.ts")), true);
  const companions = readPkg("test/auth-domain-hooks.test.ts");
  assert.match(companions, /local\/social\/routes\.ts/);
  assert.match(companions, /local\/social\/runtime\.ts/);
});

test("T-SOH-NO-HOOK-AT-AUTHORIZE: P?: POST /sign-in/social does not emit domain hooks", async () => {
  const routesSrc = existsSync(join(localSocialDir, "routes.ts"))
    ? readPkg("src/auth/local/social/routes.ts")
    : "";
  assert.equal(existsSync(join(localSocialDir, "routes.ts")), true);
  assert.equal(
    /path === ["']\/sign-in\/social["'][\s\S]{0,1200}mutate\(/.test(routesSrc),
    false,
    "authorization start must not call mutate"
  );
  let socialHooks = 0;
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    config: normalizeAthenaAuthConfig({
      mode: "local",
      secret: RUNTIME_SECRET,
      security: { trustedOrigins: ["https://app.example.test"] },
      social: {
        providers: {
          google: { clientId: "google-client", clientSecret: "google-secret" },
        },
      },
    }),
    hasher: createTestHasher(),
    hooks: defineAthenaAuthHooks({
      after: {
        "account.link": async () => {
          socialHooks += 1;
        },
        "user.sign-in.social": async () => {
          socialHooks += 1;
        },
      },
      before: {
        "account.link": async () => {
          socialHooks += 1;
        },
        "user.sign-in.social": async () => {
          socialHooks += 1;
        },
      },
    }) as never,
    secret: RUNTIME_SECRET,
  });
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/sign-in/social", {
      body: JSON.stringify({
        callbackURL: "https://app.example.test/dashboard",
        provider: "google",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  assert.equal(
    socialHooks,
    0,
    "POST /sign-in/social must not fire domain hooks"
  );
});
