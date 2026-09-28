/**
 * Billing webhook ingress operator observability (SUI-2465).
 * See docs/sdd/xylex/athena-js-billing-webhook-ingress-observability/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  billingWebhookOperatorHealth,
  createMemoryBillingWebhookIngressObservability,
  recordBillingWebhookIngressQuietly,
} from "../../src/billing/ingestion/observability/health.ts";
import {
  BILLING_WEBHOOK_INGRESS_STAGES,
  billingWebhookRegistrationKind,
  persistableWebhookRejectionStage,
  publicBillingRejectionCode,
} from "../../src/billing/ingestion/observability/stages.ts";
import { resolveBillingIngressEndpoints } from "../../src/billing/ingestion/urls.ts";
import { rewriteMissingBillingObservabilityRelation } from "../../src/billing/observability/schema-guard.ts";
import { createBillingEventIngressHandler } from "../../src/billing/runtime/local/ingress/handler.ts";
import {
  createMemoryBillingRepositories,
  MemoryBillingIngressStore,
} from "../../src/billing/runtime/local/ingress/memory.ts";
import { createMollieWebhookPort } from "../../src/billing/runtime/local/providers/mollie/webhook-port.ts";
import { EMBEDDED_BILLING_MIGRATIONS } from "../../src/migrations/embedded-billing/catalog.ts";
import type { AthenaIngressIR } from "../../src/runtime/ingress/ir.ts";
import { createMemoryEventIngressPersistence } from "../../src/runtime/ingress/memory.ts";
import { createEventIngressRuntime } from "../../src/runtime/ingress/runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function paidResource() {
  return {
    amount: { currency: "EUR", value: "10.00" },
    id: "tr_test",
    metadata: {},
    status: "paid",
  };
}

function ingress(overrides: Partial<AthenaIngressIR> = {}): AthenaIngressIR {
  return {
    body: new TextEncoder().encode("id=tr_test"),
    domain: "billing",
    headers: {},
    id: "11111111-1111-4111-8111-111111111111",
    operation: "webhook.mollie.classic",
    receivedAt: new Date("2026-08-27T12:00:00.000Z"),
    transport: { kind: "direct" },
    ...overrides,
  };
}

function runtimeWith(input: {
  observability?: ReturnType<
    typeof createMemoryBillingWebhookIngressObservability
  >["store"];
  onAuthoritativeDocument?: (payload: {
    document: unknown;
    ingress: AthenaIngressIR;
  }) => Promise<void> | void;
}) {
  const store = new MemoryBillingIngressStore();
  const persistence = createMemoryEventIngressPersistence(store.database);
  const repos = createMemoryBillingRepositories(store);
  const port = createMollieWebhookPort({
    resolveResource: async () => paidResource(),
    verification: "authoritative_refetch",
  });
  return createEventIngressRuntime({
    context: {
      database: store.database,
      domain: repos,
      persistence,
    },
    handler: createBillingEventIngressHandler({
      ...(input.observability ? { observability: input.observability } : {}),
      ...(input.onAuthoritativeDocument
        ? { onAuthoritativeDocument: input.onAuthoritativeDocument }
        : {}),
      port,
    }),
  });
}

test("T-OBS-STAGES: closed stage catalog", () => {
  assert.deepEqual(
    [...BILLING_WEBHOOK_INGRESS_STAGES],
    [
      "received",
      "parsed",
      "verified",
      "authoritative_refetch_started",
      "authoritative_refetch_completed",
      "canonicalized",
      "persisted",
      "reconciliation_started",
      "reconciliation_completed",
      "reconciliation_failed",
      "subject_projection_refreshed",
      "entitlements_refreshed",
      "completed",
      "duplicate",
      "rejected",
    ]
  );
});

test("T-OBS-SQL-NO-SECRETS: ledger SQL has no payload or signing-secret columns", () => {
  const sql = readSrc(
    "migrations/embedded-billing/sql/0008_billing_webhook_ingress_observability.sql"
  );
  const ddl = sql.replace(/--[^\n]*/g, "");
  assert.match(sql, /billing_webhook_ingress_stages/);
  assert.match(sql, /last_accepted_at/);
  assert.match(sql, /last_rejection_code/);
  assert.doesNotMatch(ddl, /signing_secret/);
  assert.doesNotMatch(ddl, /payload/);
  assert.doesNotMatch(ddl, /raw_body/);
});

test("T-OBS-LEDGER-V8: embedded billing migration v8 and required table", () => {
  const v8 = EMBEDDED_BILLING_MIGRATIONS.find((row) => row.version === 8);
  assert.equal(v8?.name, "billing_webhook_ingress_observability");
  assert.equal(v8?.checksum, "billing-webhook-ingress-observability-v1");
  const v9 = EMBEDDED_BILLING_MIGRATIONS.find((row) => row.version === 9);
  assert.equal(v9?.name, "billing_webhook_delivery_health");
  const v17 = EMBEDDED_BILLING_MIGRATIONS.find((row) => row.version === 17);
  assert.equal(v17?.name, "billing_webhook_ingress_stage_catalog");
  assert.match(v17?.sql ?? "", /'rejected'/);
  assert.match(v17?.sql ?? "", /'failed'/);
  const v22 = EMBEDDED_BILLING_MIGRATIONS.find((row) => row.version === 22);
  assert.equal(v22?.name, "billing_webhook_ingress_rejection_evidence");
  assert.match(v22?.sql ?? "", /attempted_body/);
  assert.match(v22?.sql ?? "", /expected_envelope/);
  const v38 = EMBEDDED_BILLING_MIGRATIONS.find((row) => row.version === 38);
  assert.equal(v38?.name, "billing_webhook_ingress_nullable_digest");
  assert.match(v38?.sql ?? "", /DROP NOT NULL/);
});

test("T-OBS-REJECTION-CODE: public rejection code never includes secret", () => {
  assert.equal(
    publicBillingRejectionCode({
      code: "ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID",
    }),
    "ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID"
  );
  assert.equal(
    publicBillingRejectionCode({ code: "mollie_signing_secret_mismatch" }),
    "ATHENA_EVENT_INGRESS_FAILED"
  );
  assert.equal(
    publicBillingRejectionCode("nope"),
    "ATHENA_EVENT_INGRESS_FAILED"
  );
});

test("T-OBS-ROUTE-MOUNTED: routeMounted follows configured ingress URLs", () => {
  const without = billingWebhookOperatorHealth({
    signingSecretConfigured: false,
  });
  assert.equal(without.routeMounted, false);
  const endpoints = resolveBillingIngressEndpoints({
    appUrl: "https://app.example.test",
  });
  assert.ok(endpoints);
  const withUrls = billingWebhookOperatorHealth({
    endpoints,
    signingSecretConfigured: true,
  });
  assert.equal(withUrls.routeMounted, true);
  assert.equal(withUrls.signingSecretConfigured, true);
  assert.equal(withUrls.verification.classic, "authoritative_refetch");
  assert.equal(withUrls.verification.nextGen, "signature_and_refetch");
});

test("T-OBS-MEMORY-LEDGER: memory store records stages without bodies", async () => {
  const { stages, store } = createMemoryBillingWebhookIngressObservability();
  await store.recordStage({
    connectionId: "conn-1",
    kind: "classic",
    occurredAt: new Date(),
    stage: "parsed",
  });
  const recent = await store.listRecentStages("conn-1");
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.stage, "parsed");
  assert.equal("body" in (recent[0] ?? {}), false);
  assert.equal(JSON.stringify(stages).includes("id=tr_"), false);
});

test("T-OBS-HANDLER-STAGES: Classic ingest emits parse refetch persist", async () => {
  const { stages, store } = createMemoryBillingWebhookIngressObservability();
  const runtime = runtimeWith({ observability: store });
  const result = await runtime.ingest(ingress());
  assert.equal(result.duplicate, false);
  assert.equal(result.reconciliation, "skipped");
  assert.deepEqual(
    stages.map((row) => row.stage),
    [
      "parsed",
      "authoritative_refetch_started",
      "authoritative_refetch_completed",
      "canonicalized",
      "persisted",
    ]
  );
});

test("T-OBS-DUPLICATE: duplicate ingest records duplicate", async () => {
  const { stages, store } = createMemoryBillingWebhookIngressObservability();
  const runtime = runtimeWith({ observability: store });
  await runtime.ingest(ingress());
  stages.length = 0;
  const again = await runtime.ingest(ingress());
  assert.equal(again.duplicate, true);
  assert.deepEqual(
    stages.map((row) => row.stage),
    ["duplicate"]
  );
});

test("T-OBS-RECON-FAILED: authoritative-document failure is reconciliation failed not ingest throw", async () => {
  const { stages, store } = createMemoryBillingWebhookIngressObservability();
  const runtime = runtimeWith({
    observability: store,
    onAuthoritativeDocument: async () => {
      throw new Error("import boom");
    },
  });
  const result = await runtime.ingest(ingress());
  assert.equal(result.duplicate, false);
  assert.equal(result.reconciliation, "failed");
  assert.ok(stages.some((row) => row.stage === "reconciliation_started"));
  assert.ok(stages.some((row) => row.stage === "reconciliation_failed"));
  assert.equal(
    stages.some((row) => row.stage === "reconciliation_completed"),
    false
  );
});

test("T-OBS-NOT-FAIL-CLOSED: observability throw does not fail ingest", async () => {
  const exploding = {
    async aggregateRecent() {
      return {
        accepted: 0,
        duplicates: 0,
        received: 0,
        reconciliationFailures: 0,
        rejected: 0,
      };
    },
    async listDelivery() {
      return [];
    },
    async listRecentStages() {
      return [];
    },
    async recordAccepted() {
      throw new Error("telemetry down");
    },
    async recordDelivery() {
      throw new Error("telemetry down");
    },
    async recordReconciliation() {
      throw new Error("telemetry down");
    },
    async recordRejected() {
      throw new Error("telemetry down");
    },
    async recordStage() {
      throw new Error("telemetry down");
    },
  };
  const runtime = runtimeWith({ observability: exploding });
  const result = await runtime.ingest(ingress());
  assert.equal(result.duplicate, false);
  assert.equal(result.reconciliation, "skipped");
  await recordBillingWebhookIngressQuietly(exploding, async (store) => {
    await store.recordStage({
      kind: "classic",
      occurredAt: new Date(),
      stage: "failed",
    });
  });
});

test("T-OBS-REJECT-STAGE: recordRejected persists v8-legal failed", async () => {
  const { stages, store } = createMemoryBillingWebhookIngressObservability();
  await store.recordRejected({
    code: "ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID",
    kind: "next_gen",
    metadata: { bodyBytes: 0, bodyKind: "empty" },
    stage: persistableWebhookRejectionStage(),
  });
  assert.equal(stages[0]?.stage, "failed");
  assert.equal(stages[0]?.metadata?.bodyKind, "empty");
});

test("T-OBS-REJECT-EVIDENCE: recordRejected stores bounded evidence and expectations", async () => {
  const { rejections, stages, store } =
    createMemoryBillingWebhookIngressObservability();
  await store.recordRejected({
    code: "ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID",
    evidence: {
      payload: {
        bytes: 16,
        classification: "json",
        digest: "a".repeat(64),
      },
      expectedEnvelope: {
        contentType: "application/json",
        kind: "next_gen",
      },
    },
    kind: "next_gen",
    metadata: {
      bodyBytes: 16,
      bodyKind: "json",
      contentType: "application/json",
    },
    stage: persistableWebhookRejectionStage(),
  });
  assert.equal(stages[0]?.metadata?.attemptedBody, undefined);
  assert.equal(rejections[0]?.digest, "a".repeat(64));
  assert.equal(rejections[0]?.bytes, 16);
  assert.equal(rejections[0]?.classification, "json");
  assert.equal(rejections[0]?.expectedEnvelope.kind, "next_gen");
});

test("T-OBS-KIND: Classic vs events registration kind", () => {
  assert.equal(
    billingWebhookRegistrationKind("webhook.mollie.classic"),
    "classic"
  );
  assert.equal(
    billingWebhookRegistrationKind("webhook.mollie.events"),
    "next_gen"
  );
});

test("T-OBS-HTTP-NO-TABLES: HTTP adapter still has no billing.billing_ SQL", () => {
  const adapter = readSrc("next/billing-ingress-handlers.ts");
  assert.equal(adapter.includes("billing.billing_"), false);
  assert.match(adapter, /recordBillingWebhookIngressQuietly/);
  assert.match(adapter, /stage: "received"/);
  assert.match(adapter, /createBillingRejectedIngressEvidence/);
  assert.match(adapter, /expectedEnvelope/);
  assert.match(
    readSrc("billing/runtime/local/ingress/handler.ts"),
    /reportBillingWebhookIngressDiagnostic/
  );
  assert.match(
    readSrc("billing/ingestion/observability/health.ts"),
    /console\.error/
  );
});

test("T-OBS-DUAL-TABLES: runtime writes stages and rejection evidence", () => {
  const health = readSrc("billing/ingestion/observability/health.ts");
  assert.match(health, /INSERT INTO billing\.billing_webhook_ingress_stages/);
  assert.match(
    health,
    /INSERT INTO billing\.billing_webhook_ingress_rejections/
  );
  assert.match(health, /assertBillingWebhookObservabilitySchema/);
});

test("T-OBS-SCHEMA-GUARD: missing rejections table maps to migrate v22", () => {
  const error = Object.assign(
    new Error(
      'relation "billing.billing_webhook_ingress_rejections" does not exist'
    ),
    { code: "42P01" }
  );
  const rewritten = rewriteMissingBillingObservabilityRelation(error);
  assert.match(rewritten.message, /athena migrate/);
  assert.match(rewritten.message, /v22/);
  assert.match(rewritten.message, /billing_webhook_ingress_rejections/);
});
