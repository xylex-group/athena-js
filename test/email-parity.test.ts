/**
 * Dual-runtime Auth email parity: dedicated Rust Auth vs embedded JS.
 * Logical envelopes and catalogs, not identical SMTP libraries.
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit test/email-parity.test.ts
 */

import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
  authEmailEvents,
  builtinAuthEmailBody,
  emitAuthEmail,
} from "../src/auth/email/index.ts";
import { MemoryAuthEmailStore } from "../src/auth/local/email/store.ts";
import { createEmailDeliveryPort } from "../src/email/delivery-port.ts";
import {
  ATHENA_EMAIL_MESSAGE_INVALID,
  AthenaEmailError,
} from "../src/email/errors.ts";
import { createEmailModule } from "../src/email/module.ts";
import { normalizeAthenaEmailConfig } from "../src/email/normalize-config.ts";
import { resolveAthenaEmailMessage } from "../src/email/runtime.ts";
import { buildSmtpMime } from "../src/email-node/mime.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const rustTemplates = readFileSync(
  join(repoRoot, "services/athena-auth/crates/core/src/email/templates.rs"),
  "utf8"
);
const rustTypes = readFileSync(
  join(repoRoot, "services/athena-auth/crates/core/src/types.rs"),
  "utf8"
);

const RUST_DEFAULTS = {
  account_deletion_confirmation_email: {
    html: '<p>Click the link below to confirm the deletion of your account:</p><p><a href="{{verification_url}}">Confirm Account Deletion</a></p><p>If you did not request this, please ignore this email.</p>',
    subject: "Confirm account deletion",
    text: "Confirm account deletion: {{verification_url}}",
  },
  change_email_confirmation_email: {
    html: '<p>Click the link below to confirm your new email address:</p><p><a href="{{verification_url}}">Confirm Email Change</a></p>',
    subject: "Confirm your email change",
    text: "Confirm your email change: {{verification_url}}",
  },
  organization_invitation_email: {
    html: '<p>You were invited to join <strong>{{organization_name}}</strong>.</p><p>Role: <strong>{{role}}</strong></p><p>Invited by: <strong>{{inviter_identity}}</strong></p><p><a href="{{invitation_url}}">Open invitation</a></p><p>If you are not signed in yet, create or verify your account first, then open the invitation link again.</p>',
    subject: "Invitation to join {{organization_name}}",
    text: "You were invited to join {{organization_name}}.\nRole: {{role}}\nInvited by: {{inviter_identity}}\nInvitation link: {{invitation_url}}",
  },
  password_reset_email: {
    html: '<p>Click the link below to reset your password:</p><p><a href="{{reset_url}}">Reset Password</a></p>',
    subject: "Reset your password",
    text: "Reset your password: {{reset_url}}",
  },
  two_factor_otp_email: {
    html: "<p>Your 2FA verification code is: <strong>{{otp_code}}</strong></p>",
    subject: "Your verification code",
    text: "Your 2FA verification code is: {{otp_code}}",
  },
  verification_email: {
    html: '<p>Click the link below to verify your email address:</p><p><a href="{{verification_url}}">Verify Email</a></p>',
    subject: "Verify your email address",
    text: "Verify your email address: {{verification_url}}",
  },
} as const;

function rustHas(fragment: string): void {
  assert.ok(
    rustTemplates.includes(fragment),
    `Rust templates.rs missing ${fragment}`
  );
}

function mimeFor(input: {
  attachments?: Array<{
    content: string;
    contentType?: string;
    filename?: string;
  }>;
  html?: string;
  text?: string;
}): string {
  const normalized = normalizeAthenaEmailConfig({
    defaults: { from: "no-reply@example.com" },
    provider: {
      id: "fixture",
      async send() {
        return {
          accepted: ["user@example.com"],
          provider: "fixture",
          rejected: [],
          success: true,
        };
      },
    },
  });
  const resolved = resolveAthenaEmailMessage(
    {
      attachments: input.attachments,
      html: input.html,
      subject: "Parity",
      text: input.text,
      to: "user@example.com",
    },
    normalized
  );
  return buildSmtpMime(resolved);
}

async function emitFlow(input: {
  data: Record<string, string>;
  eventType: string;
  recipient: string;
  send?: () => Promise<{ provider: string; success: boolean }>;
}) {
  const store = new MemoryAuthEmailStore();
  const result = await emitAuthEmail(
    {
      data: input.data,
      eventType: input.eventType,
      recipient: input.recipient,
    },
    {
      delivery: {
        async send() {
          if (input.send) {
            const next = await input.send();
            return {
              accepted: [input.recipient],
              provider: next.provider,
              rejected: [],
              success: next.success,
            };
          }
          return {
            accepted: [input.recipient],
            provider: "smtp",
            rejected: [],
            success: true,
          };
        },
      },
      store,
    }
  );
  return { result, store };
}

test("EMAIL-PARITY-01 plaintext MIME matches a single text/plain part", () => {
  const mime = mimeFor({ text: "Hello plaintext" });
  assert.match(mime, /Content-Type: text\/plain; charset=utf-8/);
  assert.equal(mime.includes("multipart/alternative"), false);
  assert.equal(mime.includes("multipart/mixed"), false);
});

test("EMAIL-PARITY-02 html MIME matches a single text/html part", () => {
  const mime = mimeFor({ html: "<p>Hello html</p>" });
  assert.match(mime, /Content-Type: text\/html; charset=utf-8/);
  assert.equal(mime.includes("multipart/alternative"), false);
});

test("EMAIL-PARITY-03 multipart alternative wraps text+html", () => {
  const mime = mimeFor({ html: "<p>Hello</p>", text: "Hello" });
  assert.match(mime, /multipart\/alternative/);
  assert.match(mime, /text\/plain/);
  assert.match(mime, /text\/html/);
});

test("EMAIL-PARITY-04 attachment uses multipart/mixed", () => {
  const mime = mimeFor({
    attachments: [
      {
        content: "file-bytes",
        contentType: "text/plain",
        filename: "note.txt",
      },
    ],
    text: "See attached",
  });
  assert.match(mime, /multipart\/mixed/);
  assert.match(mime, /Content-Disposition: attachment; filename="note.txt"/);
});

test("EMAIL-PARITY-05 invalid recipient fails closed like an invalid Auth message", async () => {
  const module = createEmailModule({
    defaults: { from: "no-reply@example.com" },
    provider: {
      id: "never",
      async send() {
        throw new Error("must not send");
      },
    },
  });
  await assert.rejects(
    () => module.send({ subject: "Hi", text: "body", to: "   " }),
    (error: unknown) =>
      error instanceof AthenaEmailError &&
      error.code === ATHENA_EMAIL_MESSAGE_INVALID
  );
});

test("EMAIL-PARITY-06 provider failure persists Auth failure metadata", async () => {
  assert.match(rustTypes, /struct EmailSendFailure/);
  assert.match(rustTypes, /error_message/);
  const { result, store } = await emitFlow({
    data: { reset_url: "https://app.example/reset?token=abc" },
    eventType: authEmailEvents.user.password.reset,
    recipient: "fail@example.com",
    async send() {
      throw new Error("upstream 550");
    },
  });
  assert.equal(result.success, false);
  const failures = await store.listFailures();
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.recipient_email, "fail@example.com");
  assert.equal(failures[0]?.flow, "user.password.reset");
  assert.equal(failures[0]?.resolved, false);
  assert.match(failures[0]?.error_message ?? "", /upstream 550/);
  assert.equal(
    (failures[0]?.metadata as { event_type?: string } | undefined)?.event_type,
    "user.password.reset"
  );
});

test("EMAIL-PARITY-07 verification email matches Rust builtin envelope", async () => {
  rustHas("Verify your email address");
  rustHas("user.email.verify");
  const expected = RUST_DEFAULTS.verification_email;
  assert.deepEqual(builtinAuthEmailBody("verification_email"), {
    html_template: expected.html,
    subject_template: expected.subject,
    text_template: expected.text,
  });
  const { result, store } = await emitFlow({
    data: { verification_url: "https://app.example/verify?token=v1" },
    eventType: authEmailEvents.user.email.verify,
    recipient: "verify@example.com",
  });
  assert.equal(result.success, true);
  const emails = await store.listEmails();
  assert.equal(emails[0]?.subject, expected.subject);
  assert.match(emails[0]?.text_body ?? "", /https:\/\/app\.example\/verify/);
  assert.equal(
    (emails[0]?.metadata as { event_type?: string } | undefined)?.event_type,
    "user.email.verify"
  );
});

test("EMAIL-PARITY-08 password reset matches Rust builtin envelope", async () => {
  rustHas("Reset your password");
  const expected = RUST_DEFAULTS.password_reset_email;
  assert.equal(
    builtinAuthEmailBody("password_reset_email")?.subject_template,
    expected.subject
  );
  const { store } = await emitFlow({
    data: { reset_url: "https://app.example/reset?token=r1" },
    eventType: authEmailEvents.user.password.reset,
    recipient: "reset@example.com",
  });
  const emails = await store.listEmails();
  assert.equal(emails[0]?.flow, "user.password.reset");
  assert.equal(emails[0]?.subject, expected.subject);
});

test("EMAIL-PARITY-09 OTP matches Rust builtin envelope", async () => {
  rustHas("Your 2FA verification code is");
  const expected = RUST_DEFAULTS.two_factor_otp_email;
  assert.equal(
    builtinAuthEmailBody("two_factor_otp_email")?.text_template,
    expected.text
  );
  const { store } = await emitFlow({
    data: { otp_code: "123456" },
    eventType: authEmailEvents.user.signIn.otp,
    recipient: "otp@example.com",
  });
  const emails = await store.listEmails();
  assert.equal(emails[0]?.flow, "user.sign-in.otp");
  assert.equal(emails[0]?.subject, expected.subject);
  assert.equal(String(emails[0]?.text_body ?? "").includes("123456"), false);
  assert.match(emails[0]?.text_body ?? "", /\[redacted\]/);
});

test("EMAIL-PARITY-10 organization invitation matches Rust builtin envelope", async () => {
  rustHas("Invitation to join {{organization_name}}");
  const expected = RUST_DEFAULTS.organization_invitation_email;
  assert.equal(
    builtinAuthEmailBody("organization_invitation_email")?.subject_template,
    expected.subject
  );
  const { store } = await emitFlow({
    data: {
      invitation_url: "https://app.example/invite?id=1",
      inviter_identity: "Ada",
      organization_name: "Acme",
      role: "member",
    },
    eventType: authEmailEvents.organization.member.invite,
    recipient: "invite@example.com",
  });
  const emails = await store.listEmails();
  assert.equal(emails[0]?.flow, "organization.member.invite");
  assert.equal(emails[0]?.subject, "Invitation to join Acme");
});

test("EMAIL-PARITY-11 persisted success metadata matches Rust emails columns", async () => {
  assert.match(rustTypes, /struct SentEmail/);
  assert.match(rustTypes, /recipient_email/);
  assert.match(rustTypes, /from_address/);
  const { store } = await emitFlow({
    data: { reset_url: "https://app.example/reset?token=ok" },
    eventType: authEmailEvents.user.password.reset,
    recipient: "ok@example.com",
  });
  const row = (await store.listEmails())[0];
  assert.ok(row);
  assert.equal(typeof row.id, "string");
  assert.equal(row.recipient_email, "ok@example.com");
  assert.equal(typeof row.subject, "string");
  assert.equal(typeof row.from_address, "string");
  assert.equal(row.provider, "smtp");
  assert.equal(row.flow, "user.password.reset");
  assert.equal(typeof row.created_at, "string");
  assert.equal(typeof row.updated_at, "string");
  assert.equal(
    (row.metadata as { event_type?: string; template_key?: string })
      .template_key,
    "password_reset_email"
  );
  assert.equal((await store.listFailures()).length, 0);
});

test("EMAIL-PARITY-12 persisted failure metadata matches Rust email_send_failures", async () => {
  const store = new MemoryAuthEmailStore();
  const result = await emitAuthEmail(
    {
      data: { reset_url: "https://app.example/reset?token=x" },
      eventType: authEmailEvents.user.password.reset,
      recipient: "missing-provider@example.com",
    },
    {
      delivery: createEmailDeliveryPort(createEmailModule()),
      store,
    }
  );
  assert.equal(result.success, false);
  const failure = (await store.listFailures())[0];
  assert.ok(failure);
  assert.equal(failure.error_code, ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED);
  assert.equal(failure.recipient_email, "missing-provider@example.com");
  assert.equal(failure.flow, "user.password.reset");
  assert.equal(failure.resolved, false);
  assert.equal(typeof failure.created_at, "string");
  assert.equal(
    (failure.metadata as { event_type?: string }).event_type,
    "user.password.reset"
  );
});
