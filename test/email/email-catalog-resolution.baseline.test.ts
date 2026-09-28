/**
 * Baseline — typed 014 catalog + override/locale resolution (CURRENT HEAD).
 * Spec: docs/sdd/xylex/athena-mail-runtime-finality/specs/02-template-resolution.md
 *
 * Host (never pnpm test:sdd):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit -- test/email/email-engine.target.test.ts test/email/email-transactional.target.test.ts test/email/email-catalog-resolution.baseline.test.ts test/email/email-catalog-resolution.target.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as emailPublic from "../../src/auth/email/index.ts";
import {
  type AthenaAuthEmailTemplateRow,
  AUTH_EMAIL_EVENT_CATALOG,
  authEmailEvents,
  builtinAuthEmailBody,
  builtinTemplateRow,
  createTestEmailDeliveryPort,
  emitAuthEmail,
  getAuthEmailEventDefinition,
  renderAuthEmailFragment,
} from "../../src/auth/email/index.ts";
import { MemoryAuthEmailStore } from "../../src/auth/local/email/store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const emailDir = join(pkgRoot, "src", "auth", "email");
const authSrcDir = join(pkgRoot, "src", "auth");

const SENDABLE: ReadonlyArray<{ eventType: string; templateKey: string }> = [
  {
    eventType: "user.email.verify",
    templateKey: "verification_email",
  },
  {
    eventType: "user.password.reset",
    templateKey: "password_reset_email",
  },
  {
    eventType: "user.email.change.confirmation",
    templateKey: "change_email_confirmation_email",
  },
  {
    eventType: "user.account.delete.confirmation",
    templateKey: "account_deletion_confirmation_email",
  },
  {
    eventType: "user.sign-in.otp",
    templateKey: "two_factor_otp_email",
  },
  {
    eventType: "organization.member.invite",
    templateKey: "organization_invitation_email",
  },
];

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(path));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

function readAuthSources(): string {
  return walkTsFiles(authSrcDir)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
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

test("B-CAT-NO-PUBLIC-EMAIL: no athena.auth.email / createEmailClient in auth source", () => {
  const sources = readAuthSources();
  assert.equal(sources.includes("createEmailClient"), false);
  assert.equal(sources.includes("athena.auth.email"), false);
  assert.equal(sources.includes("embeddedAuth.email"), false);
});

test("B-CAT-014: sendable keys are 014 event_type + default_template_key", () => {
  for (const row of SENDABLE) {
    const definition = getAuthEmailEventDefinition(row.eventType);
    assert.equal(definition?.default_template_key, row.templateKey);
    assert.ok(builtinAuthEmailBody(row.templateKey));
  }
  assert.equal(authEmailEvents.user.password.reset, "user.password.reset");
  assert.equal(
    AUTH_EMAIL_EVENT_CATALOG.some(
      (entry) =>
        entry.event_type.includes("auth.password-reset") ||
        entry.default_template_key === "auth.password-reset"
    ),
    false
  );
  const magic = getAuthEmailEventDefinition(authEmailEvents.user.signIn.email);
  assert.equal(magic?.default_template_key, "magic_link_email");
  assert.ok(builtinTemplateRow("user.sign-in.email", "en"));
});

test("B-CAT-LOCALE-COLUMN: identity is (template_key, locale); no *.nl key suffix", () => {
  for (const entry of AUTH_EMAIL_EVENT_CATALOG) {
    assert.equal(/\.(nl|en)$/i.test(entry.event_type), false);
    if (entry.default_template_key) {
      assert.equal(/\.(nl|en)$/i.test(entry.default_template_key), false);
    }
  }
  const builtin = builtinTemplateRow("user.password.reset", "nl");
  assert.equal(builtin?.template_key, "password_reset_email");
  assert.equal(builtin?.locale, "nl");
  assert.equal(builtin?.id, "builtin:password_reset_email:nl");
  assert.ok(builtinAuthEmailBody("password_reset_email"));
  assert.equal(builtinAuthEmailBody("password_reset_email.nl"), undefined);
  assert.equal(builtinAuthEmailBody("auth.password-reset.nl"), undefined);
});

const SUPERSEDED =
  "superseded by target suite test/email/email-catalog-resolution.target.test.ts";

test("B-CAT-PRIVATE-RESOLVE: resolveTemplate is private; no exported resolver", {
  skip: SUPERSEDED,
}, () => {
  const emitSrc = readFileSync(join(emailDir, "emit.ts"), "utf8");
  const indexSrc = readFileSync(join(emailDir, "index.ts"), "utf8");
  assert.match(emitSrc, /async function resolveTemplate\(/);
  assert.equal(
    emitSrc.includes("export async function resolveTemplate"),
    false
  );
  assert.equal(indexSrc.includes("resolveTemplate"), false);
  assert.equal(indexSrc.includes("resolveAuthEmailTemplate"), false);
  assert.equal("resolveAuthEmailTemplate" in emailPublic, false);
  assert.equal(existsSync(join(emailDir, "catalog.ts")), false);
});

test("B-CAT-FLAT-DATA: EmitAuthEmailInput.data is Record<string, string>; no PasswordResetTemplateData", {
  skip: SUPERSEDED,
}, () => {
  const emitSrc = readFileSync(join(emailDir, "emit.ts"), "utf8");
  assert.match(emitSrc, /data:\s*Record<string,\s*string>/);
  const emailSources = readdirSync(emailDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(emailDir, name), "utf8"))
    .join("\n");
  assert.equal(emailSources.includes("PasswordResetTemplateData"), false);
  assert.equal(emailSources.includes("VerifyEmailTemplateData"), false);
  assert.equal(emailSources.includes("flattenAuthEmailTemplateData"), false);
  assert.equal(
    emailSources.includes("assertAuthEmailRequiredVariables"),
    false
  );
  assert.equal("PasswordResetTemplateData" in emailPublic, false);
  assert.equal(
    renderAuthEmailFragment("Reset {{reset_url}}", {
      resetUrl: "https://app.example/reset",
    }),
    "Reset {{reset_url}}"
  );
});

test("B-CAT-NO-REQUIRED-CHECK: missing reset_url still renders/sends leftover {{reset_url}}", {
  skip: SUPERSEDED,
}, async () => {
  const store = new MemoryAuthEmailStore();
  const provider = createTestEmailDeliveryPort();
  const result = await emitAuthEmail(
    {
      data: {},
      eventType: "user.password.reset",
      recipient: "user@example.com",
    },
    { delivery: provider, store }
  );
  assert.equal(result.success, true);
  assert.equal(provider.messages.length, 1);
  assert.equal(provider.messages[0]?.subject, "Reset your password");
  assert.equal(
    provider.messages[0]?.text,
    "Reset your password: {{reset_url}}"
  );
  assert.match(String(provider.messages[0]?.html), /\{\{reset_url\}\}/);
  const emails = await store.listEmails();
  assert.equal(emails.length, 1);
  assert.equal(emails[0]?.flow, "user.password.reset");
});

test("B-CAT-INACTIVE: inactive stored row does not mask builtin", async () => {
  const store = new MemoryAuthEmailStore();
  const provider = createTestEmailDeliveryPort();
  await store.createTemplate(
    templateRow({
      id: "inactive-nl",
      is_active: false,
      locale: "nl",
      subject_template: "INACTIVE-NL",
      text_template: "INACTIVE-NL {{reset_url}}",
    })
  );
  await store.createTemplate(
    templateRow({
      id: "inactive-en",
      is_active: false,
      locale: "en",
      subject_template: "INACTIVE-EN",
      text_template: "INACTIVE-EN {{reset_url}}",
    })
  );
  const result = await emitAuthEmail(
    {
      data: { reset_url: "https://app.example/reset?token=abc123" },
      eventType: "user.password.reset",
      locale: "nl",
      recipient: "user@example.com",
    },
    { delivery: provider, store }
  );
  assert.equal(result.success, true);
  assert.equal(provider.messages[0]?.subject, "Reset your password");
  assert.equal(String(provider.messages[0]?.text).includes("INACTIVE"), false);
  assert.match(
    String(provider.messages[0]?.text),
    /https:\/\/app\.example\/reset/
  );
});

test("B-CAT-FALLBACK-EN: active en override used when requested locale has no row", async () => {
  const store = new MemoryAuthEmailStore();
  const provider = createTestEmailDeliveryPort();
  await store.createTemplate(
    templateRow({
      id: "active-en",
      locale: "en",
      subject_template: "OVERRIDE-EN",
      text_template: "OVERRIDE-EN {{reset_url}}",
    })
  );
  const result = await emitAuthEmail(
    {
      data: { reset_url: "https://app.example/reset?token=abc123" },
      eventType: "user.password.reset",
      locale: "nl",
      recipient: "user@example.com",
    },
    { delivery: provider, store }
  );
  assert.equal(result.success, true);
  assert.equal(provider.messages[0]?.subject, "OVERRIDE-EN");
  assert.match(String(provider.messages[0]?.text), /^OVERRIDE-EN /);
});

test("B-CAT-NO-PREFIX: request nl-NL does not pick stored nl (CURRENT gap vs Rust)", {
  skip: SUPERSEDED,
}, async () => {
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
  assert.equal(provider.messages[0]?.subject, "Reset your password");
  assert.equal(
    String(provider.messages[0]?.subject).includes("OVERRIDE-NL"),
    false
  );
  assert.equal(
    String(provider.messages[0]?.text).includes("OVERRIDE-NL"),
    false
  );
});

test("B-CAT-WORKFLOWS-DEFAULT-EN: emitMail call sites omit locale (defaults en)", () => {
  const runtimeSrc = readFileSync(
    join(pkgRoot, "src/auth/local/runtime.ts"),
    "utf8"
  );
  const extendedSrc = readFileSync(
    join(pkgRoot, "src/auth/local/extended-routes.ts"),
    "utf8"
  );
  const runtimeCalls = [
    ...runtimeSrc.matchAll(/await emitMail\(\{([\s\S]*?)\}\);/g),
  ];
  const extendedCalls = [
    ...extendedSrc.matchAll(/await ctx\.emitMail\?\.\(\{([\s\S]*?)\}\);/g),
  ];
  assert.ok(runtimeCalls.length >= 2);
  assert.ok(extendedCalls.length >= 4);
  for (const match of [...runtimeCalls, ...extendedCalls]) {
    assert.equal(/\blocale\b/.test(match[1] ?? ""), false);
  }
});

test("B-CAT-FUTURE: superseded — user.sign-in.email is a first-class builtin", async () => {
  const store = new MemoryAuthEmailStore();
  const provider = createTestEmailDeliveryPort();
  const result = await emitAuthEmail(
    {
      data: { sign_in_url: "https://app.example/magic" },
      eventType: "user.sign-in.email",
      recipient: "user@example.com",
    },
    { delivery: provider, store }
  );
  assert.equal(result.success, true);
  assert.equal(provider.messages.length, 1);
  assert.equal((await store.listEmails()).length, 1);
});
