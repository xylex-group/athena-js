import { strict as assert } from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createBillingEventIngressHandler } from "../../src/billing/runtime/local/ingress/handler.ts";
import {
  createMemoryBillingRepositories,
  MemoryBillingIngressStore,
} from "../../src/billing/runtime/local/ingress/memory.ts";
import { classifyStuckBillingIngress } from "../../src/billing/runtime/local/ingress/replay.ts";
import { createMollieWebhookPort } from "../../src/billing/runtime/local/providers/mollie/webhook-port.ts";
import { parseCommand } from "../../src/cli/parse-command.ts";
import {
  ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID,
  ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID,
  AthenaEventIngressError,
} from "../../src/runtime/ingress/errors.ts";
import { classifyIngressFailure } from "../../src/runtime/ingress/failure.ts";
import type { AthenaIngressIR } from "../../src/runtime/ingress/ir.ts";
import {
  createMemoryEventIngressPersistence,
  MemoryEventIngressDatabase,
} from "../../src/runtime/ingress/memory.ts";
import type {
  EventIngressDatabase,
  EventIngressPersistence,
  EventIngressRecord,
} from "../../src/runtime/ingress/persistence.ts";
import { createEventIngressRuntime } from "../../src/runtime/ingress/runtime.ts";

const SECRET = "conn-a-secret";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function nextGenBody(): string {
  return JSON.stringify({
    createdAt: new Date().toISOString(),
    entityId: "tr_xxx",
    id: "evt_1",
    resource: "payment",
    type: "payment.paid",
  });
}

function ingress(overrides: Partial<AthenaIngressIR> = {}): AthenaIngressIR {
  return {
    body: new TextEncoder().encode(nextGenBody()),
    connectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    domain: "billing",
    headers: {},
    id: "11111111-1111-4111-8111-111111111111",
    operation: "webhook.mollie.events",
    receivedAt: new Date("2026-08-27T12:00:00.000Z"),
    transport: { kind: "http" },
    ...overrides,
  };
}

function runtimeFor(port: ReturnType<typeof createMollieWebhookPort>) {
  const store = new MemoryBillingIngressStore();
  const persistence = createMemoryEventIngressPersistence(store.database);
  const repos = createMemoryBillingRepositories(store);
  return {
    runtime: createEventIngressRuntime({
      context: {
        database: store.database,
        domain: repos,
        persistence,
      },
      handler: createBillingEventIngressHandler({ port }),
    }),
    store,
  };
}

test("signature and envelope failures are terminal and do not mark processed", async () => {
  const body = nextGenBody();
  const port = createMollieWebhookPort({
    resolveResource: async () => {
      throw new Error("must not refetch");
    },
    signingSecrets: [SECRET],
    verification: "signature_and_refetch",
  });
  const signed = runtimeFor(port);
  await assert.rejects(
    () =>
      signed.runtime.ingest(
        ingress({
          body: new TextEncoder().encode(body),
          headers: { "x-mollie-signature": sign(body, "other-connection") },
        })
      ),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID
  );
  const signatureRow = signed.store.database.ingress.get(ingress().id);
  assert.equal(signatureRow?.status, "terminal_failure");
  assert.equal(signatureRow?.failureStage, "verify");

  const envelope = runtimeFor(
    createMollieWebhookPort({
      resolveResource: async () => {
        throw new Error("must not refetch");
      },
      verification: "authoritative_refetch",
    })
  );
  await assert.rejects(
    () =>
      envelope.runtime.ingest(
        ingress({
          body: new TextEncoder().encode("not-a-mollie-envelope"),
          operation: "webhook.mollie.events",
        })
      ),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID
  );
  assert.equal(
    envelope.store.database.ingress.get(ingress().id)?.status,
    "terminal_failure"
  );
  assert.equal(
    envelope.store.database.ingress.get(ingress().id)?.failureStage,
    "parse"
  );
});

test("transient refetch failures are retryable", async () => {
  const port = createMollieWebhookPort({
    resolveResource: async () => {
      throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    },
    verification: "authoritative_refetch",
  });
  const { store, runtime } = runtimeFor(port);
  await assert.rejects(() =>
    runtime.ingest(
      ingress({
        body: new TextEncoder().encode("id=tr_xxx"),
        operation: "webhook.mollie.classic",
      })
    )
  );
  const row = store.database.ingress.get(ingress().id);
  assert.equal(row?.status, "retryable_failure");
  assert.equal(row?.failureStage, "refetch");
  assert.notEqual(row?.status, "processed");
});

test("classifyIngressFailure exhausts the retry budget as terminal", () => {
  const classified = classifyIngressFailure({
    attemptCount: 8,
    error: Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }),
    stage: "refetch",
  });
  assert.equal(classified.status, "terminal_failure");
  assert.equal(classified.retryable, false);
});

test("stuck resolving with a valid envelope is retryable, never processed", async () => {
  const record: EventIngressRecord = {
    attemptCount: 0,
    body: new TextEncoder().encode("id=tr_stuck"),
    connectionId: null,
    correlationId: null,
    domain: "billing",
    headers: {},
    id: "33333333-3333-4333-8333-333333333333",
    operation: "webhook.mollie.classic",
    provider: "mollie",
    providerEventId: null,
    receivedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "resolving",
    traceId: null,
  };
  const persistenceStore = new MemoryEventIngressDatabase();
  persistenceStore.ingress.set(record.id, record);
  const persistence = createMemoryEventIngressPersistence(persistenceStore);
  const database: EventIngressDatabase = {
    async query() {
      return { rowCount: 1, rows: [{ id: record.id }] };
    },
    async transaction(fn) {
      return fn(database);
    },
  };
  const result = await classifyStuckBillingIngress({
    database,
    persistence,
  });
  assert.equal(result.classified, 1);
  assert.equal(result.retryable, 1);
  assert.equal(result.terminal, 0);
  assert.equal(
    persistenceStore.ingress.get(record.id)?.status,
    "retryable_failure"
  );
  assert.notEqual(persistenceStore.ingress.get(record.id)?.status, "processed");
});

test("stuck resolving with an invalid envelope is terminal_failure", async () => {
  const record: EventIngressRecord = {
    attemptCount: 0,
    body: new TextEncoder().encode("{"),
    connectionId: null,
    correlationId: null,
    domain: "billing",
    headers: {},
    id: "44444444-4444-4444-8444-444444444444",
    operation: "webhook.mollie.events",
    provider: "mollie",
    providerEventId: null,
    receivedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "resolving",
    traceId: null,
  };
  const persistenceStore = new MemoryEventIngressDatabase();
  persistenceStore.ingress.set(record.id, record);
  const persistence: EventIngressPersistence =
    createMemoryEventIngressPersistence(persistenceStore);
  const database: EventIngressDatabase = {
    async query() {
      return { rowCount: 1, rows: [{ id: record.id }] };
    },
    async transaction(fn) {
      return fn(database);
    },
  };
  const result = await classifyStuckBillingIngress({
    database,
    persistence,
  });
  assert.equal(result.terminal, 1);
  assert.equal(
    persistenceStore.ingress.get(record.id)?.status,
    "terminal_failure"
  );
});

test("parseCommand supports billing ingress replay", () => {
  assert.deepEqual(parseCommand(["billing", "ingress", "replay", "--json"]), {
    classifyOnly: false,
    command: "billing-ingress-replay",
    configPath: undefined,
    dryRun: false,
    json: true,
    limit: undefined,
  });
  assert.equal(
    parseCommand(["billing", "ingress", "replay", "--classify-only"]).command,
    "billing-ingress-replay"
  );
});
