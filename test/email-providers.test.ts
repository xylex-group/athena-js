import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { consoleEmailProvider } from "../src/email/public.ts";
import {
  ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME,
  assertAthenaEmailProviderRuntime,
  createClient,
  createConsoleEmailProvider,
  httpEmailProvider,
  resend,
} from "../src/index.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

test("consoleEmailProvider requires explicit construction", async () => {
  assert.equal(typeof consoleEmailProvider, "function");
  assert.equal(typeof createConsoleEmailProvider, "function");
  const lines: string[] = [];
  const provider = consoleEmailProvider({ log: (line) => lines.push(line) });
  assert.equal(provider.id, "console");
  assert.deepEqual(provider.capabilities?.runtimes, [
    "node",
    "browser",
    "edge",
  ]);

  const client = createClient({
    email: {
      defaults: { from: "no-reply@example.com" },
      provider,
    },
    key: "key",
    url: "https://athena.example.com",
  });
  assert.equal(client.email.diagnostics.providerDelivery, "console");
  const result = await client.email.send({
    subject: "Hi",
    text: "Hello",
    to: "user@example.com",
  });
  assert.equal(result.provider, "console");
  assert.equal(result.success, true);
  assert.equal("response" in result, false);
  assert.match(lines[0] ?? "", /provider=console/);
});

test("httpEmailProvider posts JSON and returns a public delivery result", async () => {
  const bodies: unknown[] = [];
  const provider = httpEmailProvider({
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ id: "http_1" });
    },
    headers: { authorization: "Bearer test" },
    url: "https://mail.example.com/send",
  });
  const result = await provider.send({
    attachmentFailureMode: "fail",
    attachments: [],
    bcc: [],
    cc: [],
    from: "no-reply@example.com",
    fromName: "Athena",
    headers: {},
    html: "<p>Hi</p>",
    metadata: {},
    subject: "Hello",
    text: "Hi",
    to: ["user@example.com"],
  });
  assert.equal(result.success, true);
  assert.equal(result.messageId, "http_1");
  assert.equal(result.provider, "http");
  const body = bodies[0] as { from: string; html: string };
  assert.equal(body.from, "Athena <no-reply@example.com>");
  assert.equal(body.html, "<p>Hi</p>");
});

test("resend uses HTTP POST /emails and strips SDK-like extras", async () => {
  let authorization = "";
  let payload: Record<string, unknown> = {};
  const provider = resend({
    apiKey: "re_test",
    fetchImpl: async (_url, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        id: "re_123",
        object: "email",
        raw: { native: true },
      });
    },
  });
  const result = await provider.send({
    attachmentFailureMode: "fail",
    attachments: [
      {
        content: "hello",
        contentType: "text/plain",
        filename: "note.txt",
      },
    ],
    bcc: [],
    cc: [],
    from: "no-reply@example.com",
    headers: {},
    html: "<p>Hi</p>",
    metadata: {},
    replyTo: "support@example.com",
    subject: "Hello",
    text: "Hi",
    to: ["user@example.com"],
  });
  assert.equal(authorization, "Bearer re_test");
  assert.equal(payload.from, "no-reply@example.com");
  assert.equal(payload.reply_to, "support@example.com");
  assert.equal(Array.isArray(payload.attachments), true);
  assert.equal(result.messageId, "re_123");
  assert.equal(result.provider, "resend");
  assert.equal("object" in result, false);
  assert.equal("raw" in result, false);
});

test("assertAthenaEmailProviderRuntime rejects SMTP on edge", () => {
  const smtpShaped = {
    capabilities: { delivery: "smtp" as const, runtimes: ["node" as const] },
    id: "smtp",
    send: async () => ({
      accepted: [],
      provider: "smtp",
      rejected: [],
      success: true,
    }),
  };
  assert.throws(
    () => assertAthenaEmailProviderRuntime(smtpShaped, "cloudflare"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code ===
        ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME
  );
});
