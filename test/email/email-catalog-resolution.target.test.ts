/**
 * Target — typed 014 catalog + override/locale resolution.
 * Spec: docs/sdd/xylex/athena-mail-runtime-finality/specs/02-template-resolution.md
 *
 * Must FAIL on CURRENT (no exported catalog types, no resolveAuthEmailTemplate,
 * no required_variables gate, no nl-NL→nl prefix / case-insensitive locale).
 * GREEN after catalog types + exported resolver + emit wiring.
 *
 * Host (never pnpm test:sdd):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit -- test/email/email-engine.target.test.ts test/email/email-transactional.target.test.ts test/email/email-catalog-resolution.baseline.test.ts test/email/email-catalog-resolution.target.test.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as emailPublic from "../../src/auth/email/index.ts";
import {
  type AthenaAuthEmailTemplateRow,
  AUTH_EMAIL_EVENT_CATALOG,
  createTestEmailDeliveryPort,
  emitAuthEmail,
} from "../../src/auth/email/index.ts";
import { MemoryAuthEmailStore } from "../../src/auth/local/email/store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const emailDir = join(pkgRoot, "src", "auth", "email");

const VIEW_TYPES = [
  "PasswordResetTemplateData",
  "VerifyEmailTemplateData",
  "ChangeEmailTemplateData",
  "DeleteUserConfirmationTemplateData",
  "OrganizationInvitationTemplateData",
  "OtpTemplateData",
] as const;

function emailSources(): string {
  return readdirSync(emailDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(emailDir, name), "utf8"))
    .join("\n");
}

function requireExportFn(name: string): (...args: never[]) => unknown {
  const value = (emailPublic as Record<string, unknown>)[name];
  assert.equal(
    typeof value,
    "function",
    `expected ${name} exported from src/auth/email`
  );
  return value as (...args: never[]) => unknown;
}

function templateRow(
  partial: Partial<AthenaAuthEmailTemplateRow> &
    Pick<AthenaAuthEmailTemplateRow, "id" | "locale" | "subject_template">
): AthenaAuthEmailTemplateRow {
  const stamp = new Date(0).toISOString();
  return {
    attachment_failure_mode: "fail",
    attachments: [],
    created_at: stamp,
    event_type: "user.password.reset",
    html_template: "<p>OVERRIDE {{reset_url}}</p>",
    is_active: true,
    metadata: {},
    template_key: "password_reset_email",
    text_template: "OVERRIDE {{reset_url}}",
    updated_at: stamp,
    variable_bindings: [],
    variables: ["reset_url"],
    ...partial,
  };
}

async function resolveFor(
  store: MemoryAuthEmailStore,
  eventType: string,
  locale?: string
): Promise<AthenaAuthEmailTemplateRow | undefined> {
  const resolve = requireExportFn("resolveAuthEmailTemplate") as (
    store: MemoryAuthEmailStore,
    input: { eventType: string; locale?: string }
  ) => Promise<AthenaAuthEmailTemplateRow | undefined>;
  return resolve(store, { eventType, locale });
}

test("T-CAT-EXPORT typed catalog from src/auth/email", () => {
  const sources = emailSources();
  const indexSrc = readFileSync(join(emailDir, "index.ts"), "utf8");
  for (const typeName of VIEW_TYPES) {
    assert.match(sources, new RegExp(`\\b${typeName}\\b`));
    assert.match(indexSrc, new RegExp(`\\b${typeName}\\b`));
  }
  assert.match(indexSrc, /\bflattenAuthEmailTemplateData\b/);
  assert.match(indexSrc, /\bassertAuthEmailRequiredVariables\b/);
  assert.equal(typeof emailPublic.flattenAuthEmailTemplateData, "function");
  assert.equal(typeof emailPublic.assertAuthEmailRequiredVariables, "function");
});

test("T-CAT-FLATTEN maps resetUrl → reset_url onto frozen 014 keys", () => {
  const flatten = requireExportFn("flattenAuthEmailTemplateData") as (
    eventType: string,
    view: Record<string, unknown>
  ) => Record<string, string>;

  const reset = flatten("user.password.reset", {
    application: { name: "Acme", url: "https://app.example" },
    expiresAt: "2026-01-01T00:00:00.000Z",
    resetUrl: "https://app.example/reset?token=abc",
    user: { email: "ada@example.com", id: "u1", name: "Ada" },
  });
  assert.equal(reset.reset_url, "https://app.example/reset?token=abc");
  assert.equal(reset.app_name, "Acme");
  assert.equal(reset["auth.password-reset"], undefined);
  assert.equal(
    Object.keys(reset).some((key) => key.includes("auth.password-reset")),
    false
  );

  const verify = flatten("user.email.verify", {
    application: { name: "Acme" },
    verificationUrl: "https://app.example/verify?token=v1",
  });
  assert.equal(verify.verification_url, "https://app.example/verify?token=v1");

  const change = flatten("user.email.change.confirmation", {
    verificationUrl: "https://app.example/change?token=c1",
  });
  assert.equal(change.verification_url, "https://app.example/change?token=c1");

  const del = flatten("user.account.delete.confirmation", {
    verificationUrl: "https://app.example/delete?token=d1",
  });
  assert.equal(del.verification_url, "https://app.example/delete?token=d1");

  const otp = flatten("user.sign-in.otp", { otpCode: "123456" });
  assert.equal(otp.otp_code, "123456");

  const invite = flatten("organization.member.invite", {
    invitationUrl: "https://app.example/invite?token=i1",
    inviterIdentity: "Ada",
    organizationName: "Acme",
    role: "admin",
  });
  assert.equal(invite.organization_name, "Acme");
  assert.equal(invite.role, "admin");
  assert.equal(invite.inviter_identity, "Ada");
  assert.equal(invite.invitation_url, "https://app.example/invite?token=i1");

  assert.equal(
    AUTH_EMAIL_EVENT_CATALOG.some(
      (entry) =>
        entry.event_type.includes("auth.password-reset") ||
        entry.default_template_key === "auth.password-reset"
    ),
    false
  );
});

test("T-CAT-EMIT-USES catalog assert / flatten SSOT", () => {
  const emitSrc = readFileSync(join(emailDir, "emit.ts"), "utf8");
  assert.match(emitSrc, /\bassertAuthEmailRequiredVariables\b/);
  assert.match(emitSrc, /\bresolveAuthEmailTemplate\b/);
  assert.equal(emitSrc.includes("auth.password-reset"), false);
  assert.equal(
    /required_variables:\s*\[\s*"reset_url"/.test(emitSrc),
    false,
    "emit must not keep a parallel required_variables list"
  );
});

test("T-CAT-REQUIRED missing required_variables does not send", async () => {
  const cases: Array<{ data: Record<string, string>; eventType: string }> = [
    { data: {}, eventType: "user.password.reset" },
    { data: { reset_url: "" }, eventType: "user.password.reset" },
    { data: {}, eventType: "user.email.verify" },
    { data: {}, eventType: "user.sign-in.otp" },
    {
      data: { organization_name: "Acme" },
      eventType: "organization.member.invite",
    },
  ];

  for (const input of cases) {
    const store = new MemoryAuthEmailStore();
    const provider = createTestEmailDeliveryPort();
    const result = await emitAuthEmail(
      {
        data: input.data,
        eventType: input.eventType,
        recipient: "user@example.com",
      },
      { delivery: provider, store }
    );
    assert.equal(result.success, false, input.eventType);
    assert.equal(provider.messages.length, 0, input.eventType);
    assert.equal((await store.listEmails()).length, 0, input.eventType);
    const failures = await store.listFailures();
    assert.equal(failures.length, 1, input.eventType);
    const dumped = JSON.stringify(failures[0]);
    assert.equal(dumped.includes("abc123secret"), false);
  }
});

test("T-CAT-RES-EXPORT resolveAuthEmailTemplate exported", () => {
  const indexSrc = readFileSync(join(emailDir, "index.ts"), "utf8");
  assert.match(indexSrc, /\bresolveAuthEmailTemplate\b/);
  assert.equal("resolveAuthEmailTemplate" in emailPublic, true);
  assert.equal(typeof emailPublic.resolveAuthEmailTemplate, "function");
});

test("T-CAT-LOCALIZED-WINS active stored (key, nl) wins", async () => {
  const store = new MemoryAuthEmailStore();
  await store.createTemplate(
    templateRow({
      id: "active-nl",
      locale: "nl",
      subject_template: "OVERRIDE-NL",
    })
  );
  await store.createTemplate(
    templateRow({
      id: "active-en",
      locale: "en",
      subject_template: "OVERRIDE-EN",
    })
  );
  const resolved = await resolveFor(store, "user.password.reset", "nl");
  assert.equal(resolved?.id, "active-nl");
  assert.equal(resolved?.locale, "nl");
  assert.equal(resolved?.template_key, "password_reset_email");
  assert.equal(resolved?.subject_template, "OVERRIDE-NL");
});

test("T-CAT-FALLBACK missing nl stored → active en override", async () => {
  const store = new MemoryAuthEmailStore();
  await store.createTemplate(
    templateRow({
      id: "active-en",
      locale: "en",
      subject_template: "OVERRIDE-EN",
    })
  );
  const resolved = await resolveFor(store, "user.password.reset", "nl");
  assert.equal(resolved?.id, "active-en");
  assert.equal(resolved?.locale, "en");
  assert.equal(resolved?.subject_template, "OVERRIDE-EN");
});

test("T-CAT-BUILTIN no stored rows → builtin for sendable event", async () => {
  const store = new MemoryAuthEmailStore();
  const resolved = await resolveFor(store, "user.password.reset", "en");
  assert.ok(resolved);
  assert.equal(resolved.template_key, "password_reset_email");
  assert.equal(resolved.id.startsWith("builtin:"), true);
  assert.equal(resolved.subject_template, "Reset your password");
});

test("T-CAT-INACTIVE inactive stored row does not mask", async () => {
  const store = new MemoryAuthEmailStore();
  await store.createTemplate(
    templateRow({
      id: "inactive-nl",
      is_active: false,
      locale: "nl",
      subject_template: "INACTIVE-NL",
    })
  );
  const builtin = await resolveFor(store, "user.password.reset", "nl");
  assert.ok(builtin);
  assert.equal(builtin.id.startsWith("builtin:"), true);
  assert.equal(builtin.subject_template, "Reset your password");

  await store.createTemplate(
    templateRow({
      id: "active-en",
      locale: "en",
      subject_template: "OVERRIDE-EN",
    })
  );
  const fallback = await resolveFor(store, "user.password.reset", "nl");
  assert.equal(fallback?.id, "active-en");
  assert.equal(fallback?.subject_template, "OVERRIDE-EN");
});

test("T-CAT-PREFIX locale nl-NL selects stored nl before en", async () => {
  const store = new MemoryAuthEmailStore();
  const provider = createTestEmailDeliveryPort();
  await store.createTemplate(
    templateRow({
      id: "active-nl",
      locale: "nl",
      subject_template: "OVERRIDE-NL",
      text_template: "OVERRIDE-NL {{reset_url}}",
    })
  );
  await store.createTemplate(
    templateRow({
      id: "active-en",
      locale: "en",
      subject_template: "OVERRIDE-EN",
      text_template: "OVERRIDE-EN {{reset_url}}",
    })
  );

  const resolved = await resolveFor(store, "user.password.reset", "nl-NL");
  assert.equal(resolved?.id, "active-nl");
  assert.equal(resolved?.locale, "nl");

  const result = await emitAuthEmail(
    {
      data: { reset_url: "https://app.example/reset?token=abc123" },
      eventType: "user.password.reset",
      locale: "nl-NL",
      recipient: "user@example.com",
    },
    { delivery: provider, store }
  );
  assert.equal(result.success, true);
  assert.equal(provider.messages[0]?.subject, "OVERRIDE-NL");
  assert.match(String(provider.messages[0]?.text), /^OVERRIDE-NL /);
});

test("T-CAT-CASE locale NL matches stored nl", async () => {
  const store = new MemoryAuthEmailStore();
  const provider = createTestEmailDeliveryPort();
  await store.createTemplate(
    templateRow({
      id: "active-nl",
      locale: "nl",
      subject_template: "OVERRIDE-NL",
      text_template: "OVERRIDE-NL {{reset_url}}",
    })
  );

  const resolved = await resolveFor(store, "user.password.reset", "NL");
  assert.equal(resolved?.id, "active-nl");
  assert.equal(resolved?.locale, "nl");

  const result = await emitAuthEmail(
    {
      data: { reset_url: "https://app.example/reset?token=abc123" },
      eventType: "user.password.reset",
      locale: "NL",
      recipient: "user@example.com",
    },
    { delivery: provider, store }
  );
  assert.equal(result.success, true);
  assert.equal(provider.messages[0]?.subject, "OVERRIDE-NL");
});

test("T-CAT-NO-SUFFIX-KEY auth.password-reset.nl is not the mechanism", async () => {
  const store = new MemoryAuthEmailStore();
  await store.createTemplate(
    templateRow({
      event_type: "user.password.reset",
      html_template: "<p>SUFFIX</p>",
      id: "suffix-key",
      locale: "en",
      subject_template: "SUFFIX-KEY",
      template_key: "auth.password-reset.nl",
      text_template: "SUFFIX",
    })
  );
  const resolved = await resolveFor(store, "user.password.reset", "nl");
  assert.ok(resolved);
  assert.notEqual(resolved.template_key, "auth.password-reset.nl");
  assert.notEqual(resolved.id, "suffix-key");
  assert.equal(resolved.template_key, "password_reset_email");
  assert.equal(
    resolved.locale === "nl" || resolved.id.startsWith("builtin:"),
    true
  );
});

test("T-CAT-16 every canonical event has a default builtin", async () => {
  const store = new MemoryAuthEmailStore();
  const provider = createTestEmailDeliveryPort();
  assert.equal(AUTH_EMAIL_EVENT_CATALOG.length, 16);
  for (const entry of AUTH_EMAIL_EVENT_CATALOG) {
    assert.equal(typeof entry.default_template_key, "string");
    assert.ok(entry.default_template_key.length > 0);
    const resolved = await resolveFor(store, entry.event_type, "en");
    assert.ok(resolved, entry.event_type);
    assert.equal(resolved?.template_key, entry.default_template_key);
    const data: Record<string, string> = {};
    for (const key of entry.required_variables) {
      data[key] = `value-for-${key}`;
    }
    const result = await emitAuthEmail(
      {
        data,
        eventType: entry.event_type,
        recipient: "user@example.com",
      },
      { delivery: provider, store }
    );
    assert.equal(result.success, true, entry.event_type);
  }
  assert.equal(provider.messages.length, 16);
});
