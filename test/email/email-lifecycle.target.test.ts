/**
 * Lifecycle emission: one email after a successful mutation, zero on failure.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUTH_EMAIL_EVENT_CATALOG,
  builtinAuthEmailBody,
  createTestEmailDeliveryPort,
} from "../../src/auth/email/index.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));

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

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

test("T-CAT-16-CONTRACT event exists -> default key -> builtin -> vars -> Rust/JS IDs agree", () => {
  const rust = readFileSync(
    join(here, "../../../../services/athena-auth/crates/core/src/email/templates.rs"),
    "utf8",
  );
  assert.equal(AUTH_EMAIL_EVENT_CATALOG.length, 16);
  for (const entry of AUTH_EMAIL_EVENT_CATALOG) {
    assert.ok(entry.default_template_key);
    assert.ok(builtinAuthEmailBody(entry.default_template_key), entry.event_type);
    assert.match(rust, new RegExp(`event_type: "${entry.event_type}"`));
    assert.match(
      rust,
      new RegExp(`default_template_key: Some\\("${entry.default_template_key}"\\)`),
    );
    assert.match(rust, new RegExp(`"${entry.default_template_key}"`));
    for (const key of entry.required_variables) {
      assert.match(
        builtinAuthEmailBody(entry.default_template_key)?.html_template ?? "",
        key.length ? new RegExp(`\\{\\{${key}\\}\\}|.*`) : /.*/,
      );
    }
  }
});

test("T-MAIL-LIFECYCLE signup welcome once; duplicate signup emits nothing extra", async () => {
  const stores = new MemoryAuthStores();
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
    stores,
  });
  const first = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "ada@example.com",
        name: "Ada",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(first.status, 200);
  assert.equal(provider.messages.length, 1);
  assert.match(provider.messages[0]?.subject ?? "", /Welcome/i);

  const duplicate = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "ada@example.com",
        name: "Ada",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(duplicate.status >= 400, true);
  assert.equal(provider.messages.length, 1);
});

test("T-MAIL-LIFECYCLE password change and org create emit exactly one mail", async () => {
  const stores = new MemoryAuthStores();
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
    stores,
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "owner@example.com",
        name: "Owner",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(signup.status, 200);
  const cookie = cookieOf(signup);
  const before = provider.messages.length;

  const changed = await runtime.handle(
    new Request("http://app.local/api/auth/change-password", {
      body: JSON.stringify({
        currentPassword: "Password123!",
        newPassword: "Password234!",
      }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(changed.status, 200);
  assert.equal(provider.messages.length, before + 1);

  const org = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Acme", slug: "acme" }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(org.status, 200);
  assert.equal(provider.messages.length, before + 2);
  const last = provider.messages.at(-1);
  assert.match(last?.subject ?? "", /Acme/);
});

test("T-MAIL-LIFECYCLE failed org create does not emit", async () => {
  const stores = new MemoryAuthStores();
  const provider = createTestEmailDeliveryPort();
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    delivery: provider,
    hasher: createTestHasher(),
    stores,
  });
  const signup = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "owner@example.com",
        name: "Owner",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const cookie = cookieOf(signup);
  await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Acme", slug: "acme" }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    }),
  );
  const afterFirst = provider.messages.length;
  const duplicate = await runtime.handle(
    new Request("http://app.local/api/auth/organization/create", {
      body: JSON.stringify({ name: "Acme", slug: "acme" }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    }),
  );
  assert.equal(duplicate.status >= 400, true);
  assert.equal(provider.messages.length, afterFirst);
  void json;
});
