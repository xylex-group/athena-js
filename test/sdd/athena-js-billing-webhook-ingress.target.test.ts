/**
 * Billing webhook ingress: Classic vs Next-gen trust, Next dispatch, validate.
 */

import { strict as assert } from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { persistableWebhookRejectionStage } from "../../src/billing/ingestion/observability/stages.ts";
import {
  classifyMollieWebhookBody,
  expectedMollieWebhookEnvelope,
  parseClassicMollieWebhook,
  parseMollieWebhookBody,
} from "../../src/billing/runtime/local/providers/mollie/parse-webhook.ts";
import { createMollieWebhookPort } from "../../src/billing/runtime/local/providers/mollie/webhook-port.ts";
import { collectBillingIngressRouteChecks } from "../../src/cli/commands/validate/validate-billing.ts";
import type { AthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import { createAthenaBillingHandlers } from "../../src/next/billing-handlers.ts";
import { createAthenaBillingIngressHandlers } from "../../src/next/billing-ingress-handlers.ts";
import { createAthenaNextHandler } from "../../src/next/data-handlers.ts";
import {
  attachAthenaClientInternals,
  createRootClientInternals,
  getAthenaClientInternals,
} from "../../src/runtime/client-internals.ts";
import {
  ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID,
  ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID,
  AthenaEventIngressError,
} from "../../src/runtime/ingress/errors.ts";
import type { AthenaIngressIR } from "../../src/runtime/ingress/ir.ts";
import type { PostgresPoolManager } from "../../src/postgres/pool/manager.ts";

const CURRENT_SECRET = "next-gen-current";
const PREVIOUS_SECRET = "next-gen-previous";

function nextGenBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    createdAt: new Date().toISOString(),
    entityId: "tr_xxx",
    id: "evt_1",
    resource: "payment",
    type: "payment.paid",
    ...overrides,
  });
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function ingress(input: {
  body: string;
  headers?: Record<string, string>;
  operation: string;
}): AthenaIngressIR {
  return {
    body: new TextEncoder().encode(input.body),
    domain: "billing",
    headers: input.headers ?? {},
    id: "11111111-1111-4111-8111-111111111111",
    operation: input.operation,
    receivedAt: new Date("2026-08-27T12:00:00.000Z"),
    transport: { kind: "http" },
  };
}

function port(refetch: { calls: number }) {
  return createMollieWebhookPort({
    resolveResource: async () => {
      refetch.calls += 1;
      return {
        amount: { currency: "EUR", value: "10.00" },
        id: "tr_xxx",
        metadata: {},
        status: "paid",
      };
    },
    signingSecrets: [CURRENT_SECRET, PREVIOUS_SECRET],
    verification: "signature_and_refetch",
  });
}

function parseWebhookEnvelope(
  webhook: ReturnType<typeof port>,
  ir: AthenaIngressIR
) {
  const envelope = webhook.parseIngress(ir);
  return Promise.resolve(envelope).then((parsed) => {
    webhook.verifyIngress?.(parsed, ir);
    return parsed;
  });
}

test("Classic form id does not require x-mollie-signature and refetches", async () => {
  const refetch = { calls: 0 };
  const webhook = port(refetch);
  const envelope = await parseWebhookEnvelope(
    webhook,
    ingress({
      body: "id=tr_xxx",
      operation: "webhook.mollie.classic",
    })
  );
  assert.equal(envelope.kind, "classic");
  if (envelope.kind === "classic") {
    assert.equal(envelope.resourceId, "tr_xxx");
    assert.equal(envelope.id, "tr_xxx");
  }
  await webhook.resolveAuthoritativeState(
    envelope,
    ingress({ body: "id=tr_xxx", operation: "webhook.mollie.classic" })
  );
  assert.equal(refetch.calls, 1);
  assert.equal(webhook.verification, "signature_and_refetch");
});

test("Classic form on compat webhook path does not require x-mollie-signature", async () => {
  const webhook = port({ calls: 0 });
  const envelope = await parseWebhookEnvelope(
    webhook,
    ingress({
      body: "id=tr_xxx",
      operation: "webhook",
    })
  );
  assert.equal(envelope.kind, "classic");
});

test("empty and non-JSON bodies classify without logging payload", () => {
  const empty = classifyMollieWebhookBody(new Uint8Array());
  assert.equal(empty.bodyKind, "empty");
  assert.equal(empty.bodyBytes, 0);
  const unknown = classifyMollieWebhookBody(new TextEncoder().encode("ping"));
  assert.equal(unknown.bodyKind, "unknown");
  const form = classifyMollieWebhookBody(new TextEncoder().encode("id=tr_xxx"));
  assert.equal(form.bodyKind, "form");
  assert.throws(
    () => parseClassicMollieWebhook(new Uint8Array()),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID &&
      error.diagnostics?.bodyKind === "empty" &&
      !JSON.stringify(error.diagnostics).includes("tr_")
  );
  assert.throws(
    () => parseClassicMollieWebhook(new TextEncoder().encode("not-json")),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.diagnostics?.bodyKind === "unknown"
  );
  assert.throws(
    () =>
      parseMollieWebhookBody(new TextEncoder().encode("id=tr_xxx"), {
        operation: "payments.list",
      }),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.message.includes("bound from the route")
  );
});

test("empty body on events path is envelope invalid with empty bodyKind", () => {
  const webhook = port({ calls: 0 });
  assert.throws(
    () =>
      webhook.parseIngress(
        ingress({
          body: "",
          operation: "webhook.mollie.events",
        })
      ),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID &&
      error.diagnostics?.bodyKind === "empty"
  );
});

test("persistable rejection stage matches v8 CHECK (failed not rejected)", () => {
  assert.equal(persistableWebhookRejectionStage(), "failed");
});

test("Classic form on events path is envelope invalid not signature invalid", () => {
  const webhook = port({ calls: 0 });
  assert.throws(
    () =>
      webhook.parseIngress(
        ingress({
          body: "id=tr_xxx",
          operation: "webhook.mollie.events",
        })
      ),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID
  );
});

test("non-Classic envelope on /classic is ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID", () => {
  const webhook = port({ calls: 0 });
  assert.throws(
    () =>
      webhook.parseIngress(
        ingress({
          body: nextGenBody(),
          operation: "webhook.mollie.classic",
        })
      ),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID
  );
});

test("Next-gen accepts current and previous signing secrets", async () => {
  const webhook = port({ calls: 0 });
  const body = nextGenBody();
  for (const secret of [CURRENT_SECRET, PREVIOUS_SECRET]) {
    const envelope = await parseWebhookEnvelope(
      webhook,
      ingress({
        body,
        headers: { "x-mollie-signature": sign(body, secret) },
        operation: "webhook.mollie.events",
      })
    );
    assert.equal(envelope.kind, "next_gen");
  }
});

test("Next-gen accepts one matching signature among rotation headers", async () => {
  const webhook = port({ calls: 0 });
  const body = nextGenBody();
  const envelope = await parseWebhookEnvelope(
    webhook,
    ingress({
      body,
      headers: {
        "x-mollie-signature": `${sign(body, "stale")}\nsha256=${sign(body, CURRENT_SECRET)}`,
      },
      operation: "webhook.mollie.events",
    })
  );
  assert.equal(envelope.kind, "next_gen");
});

test("Next-gen missing or invalid signature is 401-class error", () => {
  const webhook = port({ calls: 0 });
  const body = nextGenBody();
  const parsed = webhook.parseIngress(
    ingress({ body, operation: "webhook.mollie.events" })
  );
  const missing = () =>
    webhook.verifyIngress?.(
      parsed,
      ingress({ body, operation: "webhook.mollie.events" })
    );
  const invalid = () =>
    webhook.verifyIngress?.(
      parsed,
      ingress({
        body,
        headers: { "x-mollie-signature": sign(body, "wrong") },
        operation: "webhook.mollie.events",
      })
    );
  assert.throws(
    missing,
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID
  );
  assert.throws(
    invalid,
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID
  );
});

test("Next-gen events without a signing secret fail closed", () => {
  const webhook = createMollieWebhookPort({
    resolveResource: async () => ({
      amount: { currency: "EUR", value: "10.00" },
      id: "tr_xxx",
      metadata: {},
      status: "paid",
    }),
    signingSecrets: [],
    verification: "signature_and_refetch",
  });
  const body = nextGenBody();
  const ir = ingress({
    body,
    headers: { "x-mollie-signature": sign(body, CURRENT_SECRET) },
    operation: "webhook.mollie.events",
  });
  assert.throws(
    () => webhook.verifyIngress?.(webhook.parseIngress(ir), ir),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID &&
      error.message.includes("HMAC secret is not configured")
  );
});

test("Next-gen HMAC compares hex digest bytes, not UTF-8 of hex", async () => {
  const webhook = port({ calls: 0 });
  const body = nextGenBody();
  const hex = sign(body, CURRENT_SECRET);
  await parseWebhookEnvelope(
    webhook,
    ingress({
      body,
      headers: { "x-mollie-signature": `sha256=${hex.toUpperCase()}` },
      operation: "webhook.mollie.events",
    })
  );
  const invalidMac = ingress({
    body,
    headers: {
      "x-mollie-signature": `sha256=${Buffer.from(hex, "hex").toString("base64")}`,
    },
    operation: "webhook.mollie.events",
  });
  assert.throws(
    () => webhook.verifyIngress?.(webhook.parseIngress(invalidMac), invalidMac),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID
  );
});

test("Next-gen valid signature with invalid envelope is 400-class error", () => {
  const webhook = port({ calls: 0 });
  const body = JSON.stringify({ id: "evt_only" });
  assert.throws(
    () =>
      webhook.parseIngress(
        ingress({
          body,
          headers: { "x-mollie-signature": sign(body, CURRENT_SECRET) },
          operation: "webhook.mollie.events",
        })
      ),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID
  );
});

function stubRoot(
  ingest: (ingress: AthenaIngressIR) => Promise<{
    duplicate: boolean;
    events: readonly unknown[];
    reconciliation?: "completed" | "failed" | "skipped";
  }>
) {
  const client = {};
  attachAthenaClientInternals(
    client,
    createRootClientInternals({
      config: { auth: false },
      eventIngressRuntime: { ingest },
      plan: {
        auth: { runtime: "disabled" },
        db: { transport: "gateway" },
        runtime: { environment: "node" },
        storage: { transport: "none" },
      },
    })
  );
  return client;
}

function stubRootWithBindingLookup(
  rows: readonly Record<string, unknown>[],
  ingest: (ingress: AthenaIngressIR) => Promise<{
    duplicate: boolean;
    events: readonly unknown[];
    reconciliation?: "completed" | "failed" | "skipped";
  }>
) {
  const client = stubRoot(ingest);
  const internals = getAthenaClientInternals(client);
  assert.ok(internals);
  const manager = {
    async query() {
      return { rows };
    },
  } as unknown as PostgresPoolManager;
  internals.postgresRuntime = {
    getPoolManager: async () => manager,
  } as never;
  return client;
}

test("createAthenaBillingIngressHandlers Classic POST is not Billing RPC", async () => {
  const refetch = { calls: 0 };
  const webhook = port(refetch);
  const operations: string[] = [];
  const client = stubRoot(async (compiled) => {
    operations.push(compiled.operation);
    const envelope = await parseWebhookEnvelope(webhook, compiled);
    await webhook.resolveAuthoritativeState(envelope, compiled);
    return { duplicate: false, events: [], reconciliation: "completed" };
  });
  const handlers = createAthenaBillingIngressHandlers({
    client,
    connectionId: "connection-test",
  });
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/billing/webhook/mollie/classic", {
      body: "id=tr_xxx",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://api.mollie.com",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 202);
  const json = (await response.json()) as {
    ok: boolean;
    duplicate: boolean;
    reconciliation: string;
  };
  assert.equal(json.ok, true);
  assert.equal(json.duplicate, false);
  assert.equal(json.reconciliation, "completed");
  assert.deepEqual(operations, ["webhook.mollie.classic"]);
  assert.equal(refetch.calls, 1);
});

test("bare Classic ingress explains the missing binding in development", async () => {
  const handlers = createAthenaBillingIngressHandlers({
    client: stubRoot(async () => ({
      duplicate: false,
      events: [],
      reconciliation: "completed",
    })),
  });
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/billing/webhook/mollie/classic", {
      method: "POST",
    })
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    code: "ATHENA_BILLING_WEBHOOK_BINDING_MISSING",
    message:
      "A connection binding token is required for this Billing webhook endpoint.",
    reason: "binding_missing",
  });
});

test("unknown Classic binding explains the unresolved token in development", async () => {
  const handlers = createAthenaBillingIngressHandlers({
    client: stubRootWithBindingLookup([], async () => ({
      duplicate: false,
      events: [],
      reconciliation: "completed",
    })),
  });
  const response = await handlers.POST(
    new Request(
      "http://localhost/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa",
      { method: "POST" }
    )
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    code: "ATHENA_BILLING_WEBHOOK_BINDING_UNKNOWN",
    message: "The Billing webhook connection binding could not be resolved.",
    reason: "binding_unknown",
  });
});

test("valid Classic binding resolves the provider connection before ingest", async () => {
  let resolvedConnectionId: string | undefined;
  const handlers = createAthenaBillingIngressHandlers({
    client: stubRootWithBindingLookup(
      [{ id: "connection-test" }],
      async (ingress) => {
        resolvedConnectionId = ingress.connectionId;
        return {
          duplicate: false,
          events: [],
          reconciliation: "completed",
        };
      }
    ),
  });
  const response = await handlers.POST(
    new Request(
      "http://localhost/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa",
      {
        body: "id=tr_xxx",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }
    )
  );
  assert.equal(response.status, 202);
  assert.equal(resolvedConnectionId, "connection-test");
});

test("production bare Classic ingress stays an indistinguishable 404", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const handlers = createAthenaBillingIngressHandlers({
      client: stubRoot(async () => ({
        duplicate: false,
        events: [],
        reconciliation: "completed",
      })),
    });
    const response = await handlers.POST(
      new Request("http://localhost/api/athena/billing/webhook/mollie/classic", {
        method: "POST",
      })
    );
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
  } finally {
    if (previous == null) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
});

test("createAthenaBillingIngressHandlers duplicate Classic returns 200", async () => {
  const client = stubRoot(async () => ({
    duplicate: true,
    events: [],
    reconciliation: "skipped",
  }));
  const handlers = createAthenaBillingIngressHandlers({
    client,
    connectionId: "connection-test",
  });
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/billing/webhook/mollie/classic", {
      body: "id=tr_xxx",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const json = (await response.json()) as { duplicate: boolean };
  assert.equal(json.duplicate, true);
});

test("createAthenaBillingIngressHandlers Next-gen invalid signature is 401", async () => {
  const webhook = port({ calls: 0 });
  const client = stubRoot(async (compiled) => {
    await parseWebhookEnvelope(webhook, compiled);
    return { duplicate: false, events: [] };
  });
  const handlers = createAthenaBillingIngressHandlers({
    client,
    connectionId: "connection-test",
  });
  const body = nextGenBody();
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/billing/webhook/mollie/events", {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 401);
  const json = (await response.json()) as { code: string };
  assert.equal(json.code, ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID);
});

test("createAthenaBillingIngressHandlers logs attempted and expected envelope on reject", async () => {
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const handlers = createAthenaBillingIngressHandlers({
      client: stubRoot(async (compiled) => {
        throw new AthenaEventIngressError({
          code: ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID,
          diagnostics: classifyMollieWebhookBody(
            compiled.body,
            compiled.headers["content-type"]
          ),
          domain: "billing",
          message: "Mollie webhook envelope is invalid.",
          provider: "mollie",
          retryable: false,
        });
      }),
      connectionId: "connection-test",
    });
    const body = JSON.stringify({ id: "evt_only" });
    const response = await handlers.POST(
      new Request("http://localhost/api/athena/billing/webhook/mollie/events", {
        body,
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    assert.equal(response.status, 400);
  } finally {
    console.error = original;
  }
  const payload = logged
    .flat()
    .find(
      (entry) =>
        entry != null && typeof entry === "object" && "attemptedBody" in entry
    ) as { attemptedBody?: string; expectedEnvelope?: { kind?: string } };
  assert.ok(payload);
  assert.match(String(payload.attemptedBody), /evt_only/);
  assert.equal(payload.expectedEnvelope?.kind, "next_gen");
  assert.equal(
    expectedMollieWebhookEnvelope("webhook.mollie.events").kind,
    "next_gen"
  );
});

test("createAthenaNextHandler never sends /webhook/mollie/* to billing", async () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  const handler = createAthenaNextHandler({
    handlers: {
      auth: {
        DELETE: async () => json({ route: "auth" }),
        GET: async () => json({ route: "auth" }),
        POST: async () => json({ route: "auth" }),
      },
      billing: {
        GET: async () => json({ route: "billing" }),
        POST: async () => json({ route: "billing" }),
      },
      billingIngress: {
        POST: async () => json({ route: "billingIngress" }),
      },
      data: {
        DELETE: async () => json({ route: "data" }),
        GET: async () => json({ route: "data" }),
        PATCH: async () => json({ route: "data" }),
        POST: async () => json({ route: "data" }),
      },
      storage: {
        GET: async () => json({ route: "storage" }),
        POST: async () => json({ route: "storage" }),
      },
    },
  });
  const classic = await handler.POST(
    new Request("http://localhost/api/athena/billing/webhook/mollie/classic", {
      method: "POST",
    })
  );
  const events = await handler.POST(
    new Request("http://localhost/api/athena/billing/webhook/mollie/events", {
      method: "POST",
    })
  );
  const rpc = await handler.POST(
    new Request("http://localhost/api/athena/billing", { method: "POST" })
  );
  assert.deepEqual(await classic.json(), { route: "billingIngress" });
  assert.deepEqual(await events.json(), { route: "billingIngress" });
  assert.deepEqual(await rpc.json(), { route: "billing" });
});

const discovery: AthenaRuntimeDiscoveryDocument = {
  athena: true,
  capabilities: {
    auth: { available: false },
    delete: true,
    fetch: true,
    insert: true,
    models: "off",
    nestedRelations: false,
    policy: false,
    rawSql: false,
    rpc: false,
    update: true,
  },
  protocol: { major: 1, minor: 1 },
  runtime: "next-local",
  runtimeImplementation: "athena-js",
};

test("Billing RPC cross-origin POST is 403", async () => {
  const client = stubRoot(async () => ({ duplicate: false, events: [] }));
  const billing = createAthenaBillingHandlers({
    auth: {
      lookupSession: async () => null,
      mode: "athena-session",
    },
    client,
    discoveryDocument: discovery,
    security: { mode: "authenticated" },
  });
  const crossOrigin = await billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "payments.list" }),
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      method: "POST",
    })
  );
  assert.equal(crossOrigin.status, 403);
});

test("Next-gen oversized body is envelope invalid before HMAC", () => {
  const webhook = port({ calls: 0 });
  const body = "x".repeat(64 * 1024 + 1);
  assert.throws(
    () =>
      webhook.parseIngress(
        ingress({
          body,
          headers: { "x-mollie-signature": sign(body, CURRENT_SECRET) },
          operation: "webhook.mollie.events",
        })
      ),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID
  );
});

test("Next-gen stale createdAt is accepted for delivery-lag observability", async () => {
  const webhook = port({ calls: 0 });
  const body = nextGenBody({
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  const envelope = await parseWebhookEnvelope(
    webhook,
    ingress({
      body,
      headers: { "x-mollie-signature": sign(body, CURRENT_SECRET) },
      operation: "webhook.mollie.events",
    })
  );
  assert.equal(envelope.kind, "next_gen");
  if (envelope.kind === "next_gen") {
    assert.equal(envelope.createdAt, "2020-01-01T00:00:00.000Z");
    assert.equal(envelope.eventId, "evt_1");
    assert.equal(envelope.id, "evt_1");
    assert.equal(envelope.type, "payment.paid");
  }
});

test("collectBillingIngressRouteChecks errors when Next billing app omits webhook route", () => {
  const cwd = mkdtempSync(join(tmpdir(), "athena-billing-ingress-"));
  writeFileSync(join(cwd, "next.config.ts"), "export default {}\n");
  mkdirSync(
    join(cwd, "src", "app", "api", "athena", "billing", "[[...path]]"),
    {
      recursive: true,
    }
  );
  writeFileSync(
    join(cwd, "src/app/api/athena/billing/[[...path]]/route.ts"),
    'import { billing } from "@/lib/athena/handlers"\nexport const { GET, POST } = billing\n'
  );
  const missing = collectBillingIngressRouteChecks({
    billingEnabled: true,
    cwd,
  });
  assert.equal(missing[0]?.status, "error");
  assert.match(String(missing[0]?.detail), /BillingIngress/);

  mkdirSync(
    join(
      cwd,
      "src",
      "app",
      "api",
      "athena",
      "billing",
      "webhook",
      "[[...path]]"
    ),
    { recursive: true }
  );
  writeFileSync(
    join(cwd, "src/app/api/athena/billing/webhook/[[...path]]/route.ts"),
    'import { billingIngress } from "@/lib/athena/handlers"\nexport const { POST } = billingIngress\n'
  );
  const mounted = collectBillingIngressRouteChecks({
    billingEnabled: true,
    cwd,
  });
  assert.equal(mounted[0]?.status, "ok");
});

test("replay retains the persisted Mollie channel and does not sniff JSON bodies", () => {
  const replay = readFileSync(
    join(
      import.meta.dirname,
      "../../src/billing/runtime/local/ingress/replay.ts"
    ),
    "utf8"
  );
  assert.equal(replay.includes('startsWith("{")'), false);
  assert.match(replay, /persistedIngressOperation/);
  assert.match(replay, /parseMollieWebhookForChannel/);
  assert.equal(replay.includes("inferOperation"), false);
  const parser = readFileSync(
    join(
      import.meta.dirname,
      "../../src/billing/runtime/local/providers/mollie/parse-webhook.ts"
    ),
    "utf8"
  );
  assert.equal(parser.includes("createdAt is stale"), false);
  assert.match(parser, /parseClassicMollieWebhook/);
  assert.match(parser, /parseNextGenMollieWebhook/);
});
