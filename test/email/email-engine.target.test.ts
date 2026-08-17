import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTH_EMAIL_EVENT_CATALOG,
  authEmailEvents,
  createTestEmailProvider,
  flattenAuthEmailEvents,
  renderAuthEmailFragment,
} from "../../src/auth/email/index.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";

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

async function signInAdmin(runtime: ReturnType<typeof createAthenaAuthRuntime>, stores: MemoryAuthStores) {
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "admin@example.com",
        name: "Admin",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signup.status, 200);
  for (const user of stores.users.values()) {
    user.role = "admin";
  }
  return signup.headers.get("set-cookie") ?? "";
}

test("EMAIL-01 authEmailEvents flatten to the Rust 014 catalog", () => {
  const flat = flattenAuthEmailEvents(authEmailEvents);
  assert.equal(flat.length, AUTH_EMAIL_EVENT_CATALOG.length);
  assert.ok(flat.includes("user.email.verify"));
  assert.ok(flat.includes("organization.member.invite"));
  assert.equal(
    AUTH_EMAIL_EVENT_CATALOG.find((entry) => entry.event_type === "user.email.verify")
      ?.default_template_key,
    "verification_email"
  );
});

test("EMAIL-12 renderer matches Rust {{variable}} and {{ variable }}", () => {
  assert.equal(
    renderAuthEmailFragment("Hello {{user_name}}", { user_name: "Ada" }),
    "Hello Ada"
  );
  assert.equal(
    renderAuthEmailFragment("Hello {{ user_name }}", { user_name: "Ada" }),
    "Hello Ada"
  );
  assert.equal(
    renderAuthEmailFragment("Hello {{missing}}", {}),
    "Hello {{missing}}"
  );
});

test("EMAIL-02/03/04/07/19 embedded template CRUD and send match Rust envelopes", async () => {
  const stores = new MemoryAuthStores();
  const provider = createTestEmailProvider();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    email: { provider },
    hasher: createTestHasher(),
    stores,
  });
  const cookie = await signInAdmin(runtime, stores);
  const headers = {
    cookie,
    "content-type": "application/json",
  };

  const events = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-event-type/list", {
      headers: { cookie },
    })
  );
  assert.equal(events.status, 200);
  const eventBody = await json(events);
  assert.ok(Array.isArray(eventBody.emailEventTypes));
  assert.ok(Number(eventBody.total) >= 1);

  const created = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/create", {
      body: JSON.stringify({
        event_type: "user.password.reset",
        html_template: "<p>Reset {{reset_url}}</p>",
        subject_template: "Reset your password",
        template_key: "password_reset_email",
        text_template: "Reset {{reset_url}}",
      }),
      headers,
      method: "POST",
    })
  );
  assert.equal(created.status, 200);
  const createdBody = await json(created);
  assert.equal(createdBody.template_key, "password_reset_email");
  assert.equal(createdBody.attachment_failure_mode, "fail");
  const templateId = String(createdBody.id);

  const listed = await runtime.handle(
    new Request(
      "http://app.local/api/auth/admin/email-template/list?template_key=password_reset_email",
      { headers: { cookie } }
    )
  );
  assert.equal(listed.status, 200);
  const listBody = await json(listed);
  assert.ok(Array.isArray(listBody.email_templates));
  assert.equal((listBody.email_templates as unknown[]).length, 1);

  const sent = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/send", {
      body: JSON.stringify({
        recipient_email: "user@example.com",
        render_variables: { reset_url: "https://app.example/reset?token=1" },
        template_id: templateId,
      }),
      headers,
      method: "POST",
    })
  );
  assert.equal(sent.status, 200);
  const sendBody = await json(sent);
  assert.equal(sendBody.success, true);
  assert.equal(sendBody.flow, "admin.email_template.send");
  assert.equal(sendBody.subject, "Reset your password");
  assert.equal(provider.messages.length, 1);
  assert.equal(provider.messages[0]?.to, "user@example.com");
  assert.match(String(provider.messages[0]?.html), /https:\/\/app.example\/reset/);
});

test("EMAIL-19 production send without provider fails closed and persists a failure", async () => {
  const stores = new MemoryAuthStores();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
    stores,
  });
  const cookie = await signInAdmin(runtime, stores);
  const headers = {
    cookie,
    "content-type": "application/json",
  };
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/create", {
      body: JSON.stringify({
        subject_template: "Hello",
        template_key: "invoice_ready",
        text_template: "Hi",
      }),
      headers,
      method: "POST",
    })
  );
  const createdBody = await json(created);
  const sent = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/send", {
      body: JSON.stringify({
        recipient_email: "user@example.com",
        template_id: createdBody.id,
      }),
      headers,
      method: "POST",
    })
  );
  assert.equal(sent.status, 503);
  const sendBody = await json(sent);
  assert.equal(sendBody.success, false);
  assert.equal(sendBody.flow, "admin.email_template.send");
  assert.ok(sendBody.email_send_failure_id);

  const failures = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-failure/list", {
      headers: { cookie },
    })
  );
  assert.equal(failures.status, 200);
  const failureBody = await json(failures);
  const rows = (failureBody.email_send_failures ?? failureBody.emailSendFailures) as
    | unknown[]
    | undefined;
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 1);
});

test("EMAIL-18 private-network attachment URLs are rejected", async () => {
  const stores = new MemoryAuthStores();
  const provider = createTestEmailProvider();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    email: { provider },
    hasher: createTestHasher(),
    stores,
  });
  const cookie = await signInAdmin(runtime, stores);
  const headers = {
    cookie,
    "content-type": "application/json",
  };
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/create", {
      body: JSON.stringify({
        attachments: [{ file_url: "http://127.0.0.1/secret.txt" }],
        subject_template: "With attach",
        template_key: "attach_fail",
        text_template: "body",
      }),
      headers,
      method: "POST",
    })
  );
  const createdBody = await json(created);
  const sent = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/send", {
      body: JSON.stringify({
        recipient_email: "user@example.com",
        template_id: createdBody.id,
      }),
      headers,
      method: "POST",
    })
  );
  assert.equal(sent.status, 400);
  assert.equal(provider.messages.length, 0);
});

test("EMAIL-23 inactive template send is rejected", async () => {
  const stores = new MemoryAuthStores();
  const provider = createTestEmailProvider();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    email: { provider },
    hasher: createTestHasher(),
    stores,
  });
  const cookie = await signInAdmin(runtime, stores);
  const headers = {
    cookie,
    "content-type": "application/json",
  };
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/create", {
      body: JSON.stringify({
        is_active: false,
        subject_template: "Nope",
        template_key: "inactive_tmpl",
        text_template: "nope",
      }),
      headers,
      method: "POST",
    })
  );
  const createdBody = await json(created);
  const sent = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/send", {
      body: JSON.stringify({
        recipient_email: "user@example.com",
        template_id: createdBody.id,
      }),
      headers,
      method: "POST",
    })
  );
  assert.equal(sent.status, 400);
  assert.equal(provider.messages.length, 0);
});

test("EMAIL-14 session token bindings are denied", async () => {
  const stores = new MemoryAuthStores();
  const provider = createTestEmailProvider();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    email: { provider },
    hasher: createTestHasher(),
    stores,
  });
  const cookie = await signInAdmin(runtime, stores);
  const headers = {
    cookie,
    "content-type": "application/json",
  };
  const created = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/create", {
      body: JSON.stringify({
        subject_template: "Token {{session_token}}",
        template_key: "secret_bind",
        text_template: "{{session_token}}",
        variable_bindings: [
          {
            name: "session_token",
            required: true,
            source: "athena.sessions.token",
          },
        ],
      }),
      headers,
      method: "POST",
    })
  );
  const createdBody = await json(created);
  const sent = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/send", {
      body: JSON.stringify({
        recipient_email: "user@example.com",
        session_token: "should-not-leak",
        template_id: createdBody.id,
      }),
      headers,
      method: "POST",
    })
  );
  assert.equal(sent.status, 400);
  assert.equal(provider.messages.length, 0);
});
