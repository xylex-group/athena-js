import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import {
  ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
  authEmailEvents,
  emitAuthEmail,
} from "../src/auth/email/index.ts";
import { MemoryAuthEmailStore } from "../src/auth/local/email/store.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { createEmailDeliveryPort } from "../src/email/delivery-port.ts";
import { createEmailModule } from "../src/email/module.ts";
import { httpEmailProvider } from "../src/email/providers/http.ts";
import { createMemorySmtpTransport, smtp } from "../src/email-node/smtp.ts";
import {
  AthenaConfigurationError,
  createClient,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

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

async function signUp(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  email: string
) {
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({ email, name: "User", password: "Password123!" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
}

async function forgetPassword(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  email: string
) {
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/forget-password", {
      body: JSON.stringify({
        email,
        redirectTo: "https://app.example/reset",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
}

test("auth source does not import SMTP, Resend, or generic HTTP providers", () => {
  const files = [
    "src/auth/email/emit.ts",
    "src/auth/local/runtime.ts",
    "src/auth/local/email/routes.ts",
    "src/auth/local/email/postgres-store.ts",
    "src/auth/local/email/schema-sql.ts",
    "src/auth/local/email/store.ts",
    "src/auth/local/email/user-routes.ts",
  ];
  for (const rel of files) {
    const source = readFileSync(join(pkgRoot, rel), "utf8");
    assert.equal(source.includes("email-node"), false, rel);
    assert.equal(source.includes("email/providers"), false, rel);
    assert.equal(source.includes('from "../../email/providers'), false, rel);
    assert.equal(/\bsmtp\s*\(/.test(source), false, rel);
    assert.equal(/\bresend\s*\(/.test(source), false, rel);
    assert.equal(source.includes("config.email.provider"), false, rel);
  }
});

test("createClient rejects auth.email.provider transport ownership", () => {
  assert.throws(
    () =>
      createClient({
        auth: {
          email: { provider: { id: "stolen" } },
          mode: "local",
        },
        key: "key",
        url: "https://athena.example.com",
      } as never),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED"
  );
});

test("embedded Auth + SMTP sends through the injected root email module", async () => {
  const transport = createMemorySmtpTransport();
  const email = createEmailModule({
    defaults: { from: "no-reply@example.com" },
    provider: smtp({
      auth: { pass: "secret", user: "smtp-user" },
      host: "smtp.example.com",
      transport,
    }),
  });
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: createEmailDeliveryPort(email),
    hasher: createTestHasher(),
  });
  await signUp(runtime, "reset-smtp@example.com");
  await forgetPassword(runtime, "reset-smtp@example.com");
  assert.ok(transport.commands.includes("MAIL FROM:<no-reply@example.com>"));
  assert.ok(transport.commands.includes("RCPT TO:<reset-smtp@example.com>"));
});

test("embedded Auth + HTTP provider sends through the injected root email module", async () => {
  const bodies: unknown[] = [];
  const email = createEmailModule({
    defaults: { from: "no-reply@example.com" },
    provider: httpEmailProvider({
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "http_auth_1" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      },
      url: "https://mail.example.com/send",
    }),
  });
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: createEmailDeliveryPort(email),
    hasher: createTestHasher(),
  });
  await signUp(runtime, "reset-http@example.com");
  await forgetPassword(runtime, "reset-http@example.com");
  assert.equal(bodies.length, 2);
  const body = bodies[1] as { to: unknown; subject: string };
  assert.equal(body.subject.includes("password") || body.subject.length > 0, true);
});

test("missing root provider yields a deterministic Auth email error", async () => {
  const store = new MemoryAuthEmailStore();
  const result = await emitAuthEmail(
    {
      data: { reset_url: "https://app.example/reset?token=abc" },
      eventType: authEmailEvents.user.password.reset,
      recipient: "missing@example.com",
    },
    {
      delivery: createEmailDeliveryPort(createEmailModule()),
      store,
    }
  );
  assert.equal(result.success, false);
  const failures = await store.listFailures();
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.error_code, ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED);
  assert.equal(failures[0]?.error_message, ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED);
});

test("remote Auth ignores the local root email provider", async () => {
  const sent: unknown[] = [];
  const originalFetch = globalThis.fetch;
  const authUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    authUrls.push(url);
    if (url.includes("/forget-password")) {
      return new Response(JSON.stringify({ status: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const client = createClient({
      auth: {
        mode: "remote",
        url: "https://auth.example.com/api/auth",
      },
      email: {
        defaults: { from: "local-root@example.com" },
        provider: {
          id: "capture",
          async send(message) {
            sent.push(message);
            return {
              accepted: ["captured"],
              provider: "capture",
              rejected: [],
              success: true,
            };
          },
        },
      },
      key: "key",
      url: "https://athena.example.com",
    });
    await client.auth.forgetPassword({ email: "remote@example.com" });
    assert.equal(sent.length, 0);
    assert.ok(authUrls.some((url) => url.includes("/forget-password")));
    const rootSend = await client.email.send({
      subject: "Direct",
      text: "ok",
      to: "app@example.com",
    });
    assert.equal(rootSend.success, true);
    assert.equal(sent.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider failure persists an Auth failure record", async () => {
  const store = new MemoryAuthEmailStore();
  const result = await emitAuthEmail(
    {
      data: { reset_url: "https://app.example/reset?token=abc" },
      eventType: authEmailEvents.user.password.reset,
      recipient: "fail@example.com",
    },
    {
      delivery: {
        async send() {
          throw new Error("smtp connection refused");
        },
      },
      store,
    }
  );
  assert.equal(result.success, false);
  const failures = await store.listFailures();
  assert.equal(failures.length, 1);
  assert.match(failures[0]?.error_message ?? "", /smtp connection refused/);
  const emails = await store.listEmails();
  assert.equal(emails.length, 0);
});

test("successful delivery does not create a failure record", async () => {
  const store = new MemoryAuthEmailStore();
  const result = await emitAuthEmail(
    {
      data: { reset_url: "https://app.example/reset?token=abc" },
      eventType: authEmailEvents.user.password.reset,
      recipient: "ok@example.com",
    },
    {
      delivery: {
        async send() {
          return {
            accepted: ["ok@example.com"],
            provider: "test",
            rejected: [],
            success: true,
          };
        },
      },
      store,
    }
  );
  assert.equal(result.success, true);
  assert.equal((await store.listFailures()).length, 0);
  const emails = await store.listEmails();
  assert.equal(emails.length, 1);
  assert.equal(emails[0]?.provider, "test");
});
