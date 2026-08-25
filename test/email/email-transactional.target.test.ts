/**
 * Target — transactional Auth mail through the canonical engine.
 * RED on CURRENT (hooks + missing routes). GREEN after wiring.
 *
 * Spec: docs/sdd/xylex/athena-mail-runtime-finality/
 * Host (never pnpm test:sdd):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit -- test/email/email-transactional.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import {
  authEmailEvents,
  createTestEmailDeliveryPort,
} from "../../src/auth/email/index.ts";
import { MemoryAuthEmailStore } from "../../src/auth/local/email/store.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

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

async function signUp(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  email: string,
  name = "User"
) {
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({ email, name, password: "Password123!" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  return {
    cookie: response.headers.get("set-cookie") ?? "",
    body: await json(response),
  };
}

test("T-MAIL-NO-HOOK: built-in flows do not call ctx.email?.send", () => {
  const extended = readFileSync(
    join(pkgRoot, "src/auth/local/extended-routes.ts"),
    "utf8"
  );
  const runtime = readFileSync(
    join(pkgRoot, "src/auth/local/runtime.ts"),
    "utf8"
  );
  assert.equal(extended.includes("ctx.email?.send"), false);
  assert.equal(runtime.includes("options.email?.send?.("), false);
  assert.equal(runtime.includes("options.email?.provider"), false);
  assert.equal(runtime.includes("config.email.provider"), false);
});

test("T-MAIL-EMIT-RESET: forget-password emits user.password.reset once without storing the raw token", async () => {
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
  });
  await signUp(runtime, "reset@example.com");
  const forgot = await runtime.handle(
    new Request("http://app.local/api/auth/forget-password", {
      body: JSON.stringify({
        email: "reset@example.com",
        redirectTo: "https://app.example/reset",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(forgot.status, 200);
  const resetMail = provider.messages.at(-1);
  assert.equal(resetMail?.to, "reset@example.com");
  assert.match(String(resetMail?.text), /https:\/\/app\.example\/reset/);
  const listed = await runtime.handle(
    new Request("http://app.local/api/auth/email/list", {
      headers: {
        cookie: (
          await runtime.handle(
            new Request("http://app.local/api/auth/sign-in/email", {
              body: JSON.stringify({
                email: "reset@example.com",
                password: "Password123!",
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            })
          )
        ).headers.get("set-cookie") ?? "",
      },
    })
  );
  assert.equal(listed.status, 200);
  const body = await json(listed);
  const emails = body.emails as Array<Record<string, unknown>>;
  const resetRow = emails.find((row) => row.flow === "user.password.reset");
  assert.ok(resetRow);
  const rawToken = /token=([^&\s]+)/.exec(String(resetMail?.text))?.[1];
  assert.ok(rawToken);
  assert.equal(String(emails[0]?.text_body ?? "").includes(rawToken), false);
});

test("T-MAIL-HOOK-COMPAT: legacy send hook still receives the verify URL", async () => {
  let captured: { type?: string; url?: string } | undefined;
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
    legacySend: (message) => {
      captured = message;
    },
  });
  await signUp(runtime, "verify@example.com");
  const send = await runtime.handle(
    new Request("http://app.local/api/auth/send-verification-email", {
      body: JSON.stringify({
        callbackURL: "https://app.example/verify",
        email: "verify@example.com",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(send.status, 200);
  assert.equal(captured?.type, "verify-email");
  assert.match(String(captured?.url), /^https:\/\/app\.example\/verify\?token=/);
  assert.equal(provider.messages.at(-1)?.to, "verify@example.com");
});

test("T-MAIL-VERIFY-GET-CHANGE: GET /change-email/verify consumes the token", async () => {
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
  });
  const { cookie } = await signUp(runtime, "old@example.com");
  const requestChange = await runtime.handle(
    new Request("http://app.local/api/auth/change-email", {
      body: JSON.stringify({ newEmail: "new@example.com" }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(requestChange.status, 200);
  const url = String(provider.messages.at(-1)?.text);
  const token = /token=([^&\s]+)/.exec(url)?.[1];
  assert.ok(token);
  const confirm = await runtime.handle(
    new Request(
      `http://app.local/api/auth/change-email/verify?token=${encodeURIComponent(token ?? "")}`
    )
  );
  assert.equal(confirm.status, 200);
  assert.equal(((await json(confirm)).user as { email?: string }).email, "new@example.com");
});

test("T-MAIL-GET-RESET: GET /reset-password/{token} inspects without consuming", async () => {
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
  });
  await signUp(runtime, "reset-get@example.com");
  await runtime.handle(
    new Request("http://app.local/api/auth/forget-password", {
      body: JSON.stringify({ email: "reset-get@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const match = /token=([^&\s]+)/.exec(String(provider.messages.at(-1)?.text));
  const token = match?.[1];
  assert.ok(token);
  const inspected = await runtime.handle(
    new Request(`http://app.local/api/auth/reset-password/${encodeURIComponent(token ?? "")}`)
  );
  assert.ok(inspected.status === 200 || inspected.status === 302);
  const reset = await runtime.handle(
    new Request("http://app.local/api/auth/reset-password", {
      body: JSON.stringify({ newPassword: "ResetPassword123!", token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(reset.status, 200);
  const reuse = await runtime.handle(
    new Request("http://app.local/api/auth/reset-password", {
      body: JSON.stringify({ newPassword: "ResetPassword123!", token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(reuse.status, 400);
});

test("T-MAIL-OTP: two-factor send-otp uses user.sign-in.otp", async () => {
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
  });
  const { cookie } = await signUp(runtime, "otp@example.com");
  const sent = await runtime.handle(
    new Request("http://app.local/api/auth/two-factor/send-otp", {
      headers: { cookie },
      method: "POST",
    })
  );
  assert.equal(sent.status, 200);
  assert.match(String(provider.messages.at(-1)?.text), /\d{6}/);
});

test("T-MAIL-INVITE: organization invite emits organization.member.invite", async () => {
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
  });
  const { cookie } = await signUp(runtime, "owner@example.com", "Owner");
  const org = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Acme", slug: "acme-mail" }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(org.status, 200);
  const invited = await runtime.handle(
    new Request("http://app.local/api/auth/organization/invite-member", {
      body: JSON.stringify({ email: "member@example.com", role: "member" }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(invited.status, 200);
  assert.match(String(provider.messages.at(-1)?.text), /Acme/);
});

test("T-MAIL-DELETE-GET: passwordless delete-user confirms via GET /delete-user/verify", async () => {
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
  });
  const { cookie } = await signUp(runtime, "gone-mail@example.com");
  const requested = await runtime.handle(
    new Request("http://app.local/api/auth/delete-user", {
      body: JSON.stringify({}),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(requested.status, 200);
  const sessionStill = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", { headers: { cookie } })
  );
  assert.equal(sessionStill.status, 200);
  const token = /token=([^&\s]+)/.exec(String(provider.messages.at(-1)?.text))?.[1];
  assert.ok(token);
  const verified = await runtime.handle(
    new Request(
      `http://app.local/api/auth/delete-user/verify?token=${encodeURIComponent(token ?? "")}`
    )
  );
  assert.equal(verified.status, 200);
  const sessionGone = await runtime.handle(
    new Request("http://app.local/api/auth/get-session", { headers: { cookie } })
  );
  assert.equal(sessionGone.status, 401);
});

test("T-MAIL-EVENTS: emit uses frozen 014 event types", () => {
  assert.equal(authEmailEvents.user.password.reset, "user.password.reset");
  assert.equal(authEmailEvents.user.email.verify, "user.email.verify");
  assert.equal(
    authEmailEvents.organization.member.invite,
    "organization.member.invite"
  );
});

test("T-MAIL-STORE: MemoryAuthEmailStore still lists deliveries", async () => {
  const store = new MemoryAuthEmailStore();
  const stamp = new Date().toISOString();
  await store.createEmail({
    created_at: stamp,
    flow: "user.password.reset",
    from_address: "athena@localhost",
    from_name: null,
    html_body: null,
    id: "e1",
    metadata: { event_type: "user.password.reset" },
    provider: "test",
    recipient_email: "a@example.com",
    subject: "Reset",
    text_body: "ok",
    updated_at: stamp,
  });
  const rows = await store.listEmails();
  assert.equal(rows.length, 1);
});
