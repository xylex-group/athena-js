import { strict as assert } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as browserEntry from "../src/browser.ts";
import {
  ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED,
  AthenaEmailError,
  createClient,
  defineAthenaEmailProvider,
} from "../src/index.ts";
import {
  normalizeAthenaEmailConfig,
  toAthenaEmailDiagnostics,
} from "../src/email/normalize-config.ts";
import { resolveAthenaEmailMessage } from "../src/email/runtime.ts";
import type {
  AthenaEmailDeliveryResult,
  AthenaEmailMessage,
  AthenaResolvedEmailMessage,
} from "../src/email/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const emailSrc = join(pkgRoot, "src", "email");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(next));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(next);
    }
  }
  return out;
}

const NODE_ONLY_IMPORT =
  /from\s+["'](?:node:|nodemailer|smtp|net|tls|fs|dns)[^"']*["']|require\(["'](?:node:|nodemailer)/;

function captureProvider() {
  const sent: AthenaResolvedEmailMessage[] = [];
  const provider = defineAthenaEmailProvider({
    id: "memory",
    async send(message) {
      sent.push(message);
      return {
        accepted: message.to,
        messageId: "msg_1",
        provider: "memory",
        rejected: [],
        response: { envelopeTime: 12 },
        success: true,
      } as unknown as AthenaEmailDeliveryResult;
    },
  });
  return { provider, sent };
}

test("normalizeAthenaEmailConfig treats missing config as unconfigured", () => {
  const empty = normalizeAthenaEmailConfig();
  assert.equal(empty.provider, null);
  assert.deepEqual(empty.defaults, {});
  assert.equal(empty.attachmentFailureMode, "fail");
  assert.equal(toAthenaEmailDiagnostics(empty).configured, false);
  assert.equal(toAthenaEmailDiagnostics(empty).providerId, null);
});

test("normalizeAthenaEmailConfig trims defaults and assigns custom id when provider has send only", () => {
  const normalized = normalizeAthenaEmailConfig({
    attachments: { failureMode: "skip" },
    defaults: {
      from: "  no-reply@example.com  ",
      fromName: " Athena ",
      locale: " en ",
      replyTo: " support@example.com ",
    },
    provider: {
      send: async () => ({
        accepted: [],
        provider: "x",
        rejected: [],
        success: true,
      }),
    } as unknown as import("../src/email/types.ts").AthenaEmailProvider,
  });
  assert.equal(normalized.provider?.id, "custom");
  assert.deepEqual(normalized.defaults, {
    from: "no-reply@example.com",
    fromName: "Athena",
    locale: "en",
    replyTo: "support@example.com",
  });
  assert.equal(normalized.attachmentFailureMode, "skip");
});

test("createClient materializes athena.email without email config", async () => {
  const client = createClient({
    key: "key",
    url: "https://athena.example.com",
  });
  assert.equal(client.email.configured, false);
  assert.equal(client.email.diagnostics.configured, false);
  assert.equal(client.email.diagnostics.providerId, null);
  await assert.rejects(
    () =>
      client.email.send({
        subject: "Hi",
        to: "user@example.com",
      }),
    (error: unknown) =>
      error instanceof AthenaEmailError &&
      error.code === ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED
  );
});

test("createClient with email.provider merges defaults and strips native delivery fields", async () => {
  const { provider, sent } = captureProvider();
  const client = createClient({
    email: {
      defaults: {
        from: "no-reply@example.com",
        fromName: "Athena",
        locale: "en",
        replyTo: "support@example.com",
      },
      provider,
    },
    key: "key",
    url: "https://athena.example.com",
  });

  assert.equal(client.email.configured, true);
  assert.equal(client.email.diagnostics.providerId, "memory");
  assert.equal(client.email.diagnostics.defaults.from, "no-reply@example.com");

  const result = await client.email.send({
    subject: "Welcome",
    text: "Hello",
    to: "user@example.com",
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.from, "no-reply@example.com");
  assert.equal(sent[0]?.fromName, "Athena");
  assert.equal(sent[0]?.replyTo, "support@example.com");
  assert.equal(sent[0]?.locale, "en");
  assert.equal(sent[0]?.subject, "Welcome");
  assert.deepEqual(sent[0]?.to, ["user@example.com"]);

  assert.deepEqual(result, {
    accepted: ["user@example.com"],
    from: "no-reply@example.com",
    fromName: "Athena",
    messageId: "msg_1",
    provider: "memory",
    rejected: [],
    success: true,
  });
  assert.equal("response" in result, false);
});

test("message fields override email.defaults", () => {
  const normalized = normalizeAthenaEmailConfig({
    defaults: {
      from: "no-reply@example.com",
      fromName: "Athena",
      locale: "en",
      replyTo: "support@example.com",
    },
    provider: captureProvider().provider,
  });
  const message: AthenaEmailMessage = {
    from: "alerts@example.com",
    fromName: "Alerts",
    locale: "nl",
    replyTo: "ops@example.com",
    subject: "Override",
    to: ["a@example.com", " b@example.com "],
  };
  const resolved = resolveAthenaEmailMessage(message, normalized);
  assert.equal(resolved.from, "alerts@example.com");
  assert.equal(resolved.fromName, "Alerts");
  assert.equal(resolved.locale, "nl");
  assert.equal(resolved.replyTo, "ops@example.com");
  assert.deepEqual(resolved.to, ["a@example.com", "b@example.com"]);
});

test("withContext preserves the email capability view", async () => {
  const { provider } = captureProvider();
  const client = createClient({
    email: { provider },
    key: "key",
    url: "https://athena.example.com",
  });
  const scoped = client.withContext({ userId: "user_1" });
  assert.equal(scoped.email.configured, true);
  assert.equal(scoped.email.diagnostics.providerId, "memory");
  const result = await scoped.email.send({
    from: "no-reply@example.com",
    subject: "Scoped",
    to: "user@example.com",
  });
  assert.equal(result.success, true);
  assert.equal(result.provider, "memory");
});

test("public barrel exports root email types and does not export createEmailModule", () => {
  const root = createClient as unknown as { name?: string };
  void root;
  assert.equal(typeof defineAthenaEmailProvider, "function");
  assert.equal(ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED, "ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED");
  assert.equal("createEmailModule" in browserEntry, false);
  assert.equal(typeof browserEntry.createClient, "function");
  assert.equal(typeof browserEntry.defineAthenaEmailProvider, "function");
});

test("src/email stays Node-free for the browser createClient path", () => {
  for (const file of listTsFiles(emailSrc)) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      NODE_ONLY_IMPORT.test(source),
      false,
      `${file} must not import Node-only or SMTP modules`
    );
    assert.equal(
      source.includes("email-node"),
      false,
      `${file} must not import the Node SMTP entry`
    );
  }

  const core = readFileSync(join(pkgRoot, "src", "v3-client-core.ts"), "utf8");
  assert.match(core, /createEmailModule/);
  assert.equal(core.includes('from "./email/module.ts"'), true);
  assert.equal(core.includes("email-node"), false);
});

test("browser createClient exposes unconfigured email without pulling SMTP", async () => {
  const client = browserEntry.createClient({
    key: "key",
    url: "https://athena.example.com",
  });
  assert.equal(client.email.configured, false);
  await assert.rejects(
    () => client.email.send({ subject: "Hi", to: "a@example.com" }),
    (error: unknown) =>
      error instanceof browserEntry.AthenaEmailError &&
      error.code === browserEntry.ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED
  );
});
