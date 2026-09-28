import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  ATHENA_EMAIL_PROVIDER_INVALID,
  AthenaEmailError,
} from "../src/email/errors.ts";
import { createMemorySmtpTransport, smtp } from "../src/email-node/smtp.ts";
import { createClient } from "../src/index.ts";

const message = {
  attachmentFailureMode: "fail" as const,
  attachments: [
    {
      content: "file-bytes",
      contentType: "text/plain",
      filename: "note.txt",
    },
  ],
  bcc: [],
  cc: [],
  from: "no-reply@example.com",
  fromName: "Athena",
  headers: {},
  html: "<p>Hello</p>",
  metadata: {},
  subject: "Welcome",
  text: "Hello",
  to: ["user@example.com"],
};

test("smtp() requires host and auth", () => {
  assert.throws(
    () =>
      smtp({
        auth: { pass: "p", user: "u" },
        host: " ",
      }),
    (error: unknown) =>
      error instanceof AthenaEmailError &&
      error.code === ATHENA_EMAIL_PROVIDER_INVALID
  );
});

test("smtp STARTTLS session sends multipart MIME through an injectable transport", async () => {
  const transport = createMemorySmtpTransport();
  const provider = smtp({
    auth: { pass: "secret", user: "smtp-user" },
    host: "smtp.example.com",
    transport,
  });
  assert.equal(provider.id, "smtp");
  assert.deepEqual(provider.capabilities?.runtimes, ["node"]);

  const client = createClient({
    email: {
      defaults: { from: "fallback@example.com" },
      provider,
    },
    key: "key",
    url: "https://athena.example.com",
  });
  assert.equal(client.email.diagnostics.providerDelivery, "smtp");

  const result = await client.email.send({
    attachments: message.attachments,
    from: message.from,
    html: message.html,
    subject: message.subject,
    text: message.text,
    to: message.to,
  });

  assert.equal(result.success, true);
  assert.equal(result.provider, "smtp");
  assert.equal(result.messageId, "smtp-test-id@smtp.example.com");
  assert.equal("response" in result, false);

  assert.ok(transport.commands.includes("STARTTLS"));
  assert.ok(transport.commands.includes("STARTTLS-UPGRADE"));
  assert.ok(transport.commands.some((line) => line.startsWith("AUTH PLAIN ")));
  assert.ok(transport.commands.includes("MAIL FROM:<no-reply@example.com>"));
  assert.ok(transport.commands.includes("RCPT TO:<user@example.com>"));
  assert.ok(
    transport.payloads.some((payload) => payload.includes("multipart/"))
  );
  assert.ok(
    transport.payloads.some((payload) => payload.includes("text/html"))
  );
  assert.ok(
    transport.payloads.some((payload) => payload.includes("text/plain"))
  );
  assert.ok(
    transport.payloads.some((payload) =>
      payload.includes('filename="note.txt"')
    )
  );
  assert.equal(
    transport.payloads.some((payload) => payload.includes("secret")),
    false
  );
});

test("smtp does not silently skip a failed SMTP reply", async () => {
  const transport = createMemorySmtpTransport([
    { code: 220, lines: ["ok"] },
    { code: 250, lines: ["ehlo"] },
    { code: 454, lines: ["TLS not available"] },
  ]);
  const provider = smtp({
    auth: { pass: "secret", user: "smtp-user" },
    host: "smtp.example.com",
    transport,
  });
  await assert.rejects(
    () =>
      provider.send({
        ...message,
        attachments: [],
      }),
    (error: unknown) =>
      error instanceof AthenaEmailError && error.message.includes("STARTTLS")
  );
});
