/**
 * Target: Athena JS Event Ingress Spine (ADR 0060).
 * See docs/sdd/xylex/athena-js-event-ingress/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CanonicalPayment } from "../../src/billing/canonical/document.ts";
import {
  AthenaBillingIllegalTransitionError,
  assertCanonicalBillingTransition,
  canonicalizeBillingEvents,
} from "../../src/billing/canonical/transition.ts";
import { createBillingEventIngressHandler } from "../../src/billing/runtime/local/ingress/handler.ts";
import {
  createMemoryBillingRepositories,
  MemoryBillingIngressStore,
} from "../../src/billing/runtime/local/ingress/memory.ts";
import {
  AthenaBillingRevisionStaleError,
  assertRevisionIsNotStale,
} from "../../src/billing/runtime/local/ingress/revision.ts";
import { createMollieWebhookPort } from "../../src/billing/runtime/local/providers/mollie/webhook-port.ts";
import { CANONICAL_BILLING_EVENT_NAMES } from "../../src/runtime/events/catalog.ts";
import { compileHttpWebhookIngress } from "../../src/runtime/ingress/compiler/http.ts";
import type { AthenaIngressIR } from "../../src/runtime/ingress/ir.ts";
import { createMemoryEventIngressPersistence } from "../../src/runtime/ingress/memory.ts";
import type {
  EventIngressDatabase,
  EventIngressQueryResult,
} from "../../src/runtime/ingress/persistence.ts";
import { createEventIngressRuntime } from "../../src/runtime/ingress/runtime.ts";
import { createSqlEventIngressPersistence } from "../../src/runtime/ingress/sql.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function collectTs(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTs(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function joined(dir: string): string {
  return collectTs(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function paidPayment(
  status: CanonicalPayment["status"] = "paid"
): CanonicalPayment {
  return {
    amount: { currency: "EUR", value: "10.00" },
    createdAt: "2026-08-26T12:00:00.000Z",
    kind: "payment",
    metadata: {},
    paidAt: status === "paid" ? "2026-08-26T12:01:00.000Z" : null,
    provider: "mollie",
    providerPaymentId: "tr_test",
    raw: { id: "tr_test", status },
    status,
  };
}

function eventIngressQueryResult<T>(
  rows: readonly unknown[]
): EventIngressQueryResult<T> {
  return {
    rowCount: rows.length,
    rows: rows as T[],
  };
}

function ingress(overrides: Partial<AthenaIngressIR> = {}): AthenaIngressIR {
  return {
    body: new TextEncoder().encode("id=tr_test"),
    domain: "billing",
    headers: {},
    id: "11111111-1111-1111-1111-111111111111",
    operation: "webhook",
    receivedAt: new Date("2026-08-26T12:00:00.000Z"),
    transport: { kind: "direct" },
    ...overrides,
  };
}

test("ACT-EIS-DIR: ingress and events modules exist", () => {
  assert.equal(existsSync(join(srcRoot, "runtime", "ingress", "ir.ts")), true);
  assert.equal(
    existsSync(join(srcRoot, "runtime", "ingress", "runtime.ts")),
    true
  );
  assert.equal(existsSync(join(srcRoot, "runtime", "events", "ir.ts")), true);
  assert.equal(
    existsSync(join(srcRoot, "runtime", "events", "catalog.ts")),
    true
  );
  assert.equal(
    existsSync(join(srcRoot, "billing", "canonical", "document.ts")),
    true
  );
});

test("ACT-EIS-EXPORT: package.json does not export ./ingress or ./events", () => {
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as { exports?: Record<string, unknown> };
  assert.equal(pkg.exports?.["./ingress"], undefined);
  assert.equal(pkg.exports?.["./events"], undefined);
});

test("ACT-EIS-NO-MOLLIE-INGRESS: runtime/ingress MUST NOT import mollie", () => {
  const sources = joined(join(srcRoot, "runtime", "ingress"));
  assert.doesNotMatch(sources, /providers\/mollie|mollie\//i);
});

test("ACT-EIS-NO-MOLLIE-EVENTS: runtime/events MUST NOT import mollie", () => {
  const sources = joined(join(srcRoot, "runtime", "events"));
  assert.doesNotMatch(sources, /mollie/i);
});

test("ACT-EIS-NO-PROVIDER-TRANSPORT: runtime/transport MUST NOT import billing providers", () => {
  const sources = joined(join(srcRoot, "runtime", "transport"));
  assert.doesNotMatch(sources, /billing\/runtime\/local\/providers/i);
});

test("ACT-EIS-NO-NUCLEUS: Mollie webhook code MUST NOT call executeDataNucleusMutation", () => {
  const sources = joined(
    join(srcRoot, "billing", "runtime", "local", "providers", "mollie")
  );
  assert.doesNotMatch(sources, /executeDataNucleusMutation/);
});

test("ACT-EIS-NO-BILLING-INGEST-OP: command dispatcher MUST NOT contain billing.event.ingest", () => {
  const handlers = readSrc("next/billing-handlers.ts");
  const dispatch = readSrc("billing/runtime/dispatch.ts");
  assert.equal(handlers.includes("billing.event.ingest"), false);
  assert.equal(dispatch.includes("billing.event.ingest"), false);
  assert.equal(handlers.includes("arrayBuffer"), false);
});

test("ACT-EIS-HTTP-NO-TABLES: HTTP webhook adapter MUST NOT call billing tables", () => {
  const adapter = readSrc("next/billing-ingress-handlers.ts");
  assert.equal(adapter.includes("billing.billing_"), false);
  assert.match(adapter, /EventIngressRuntime/);
  assert.match(adapter, /compileHttpWebhookIngress/);
});

test("ACT-EIS-NO-ONMOLLIE: hooks MUST NOT expose onMollie*", () => {
  const sources = `${joined(join(srcRoot, "runtime", "events"))}\n${joined(join(srcRoot, "billing"))}`;
  assert.doesNotMatch(sources, /onMollie/);
});

test("ACT-EIS-OUTBOX-TX: outbox inserts MUST occur inside billing apply transaction", () => {
  const apply = readSrc("billing/runtime/local/ingress/apply.ts");
  const outboxIdx = apply.indexOf("outbox.enqueue");
  const processedIdx = apply.indexOf("markProcessed");
  assert.ok(outboxIdx > 0);
  assert.ok(processedIdx > outboxIdx);
  assert.match(apply, /database\.transaction/);
});

test("ACT-EIS-REFETCH-BEFORE-PROJECT: handler resolves state before projectDocument", () => {
  const handler = readSrc("billing/runtime/local/ingress/handler.ts");
  const resolveIdx = handler.indexOf("resolveAuthoritativeState");
  const projectIdx = handler.indexOf("projectDocument");
  assert.ok(resolveIdx > 0 && projectIdx > resolveIdx);
});

test("ACT-EIS-INGRESS-LOCK: insertReceived and lock share the first transaction", () => {
  const handler = readSrc("billing/runtime/local/ingress/handler.ts");
  const txIdx = handler.indexOf("runtime.database.transaction");
  const insertIdx = handler.indexOf("insertReceived");
  const lockIdx = handler.indexOf(".lock(");
  assert.ok(txIdx >= 0 && insertIdx > txIdx && lockIdx > insertIdx);
  assert.match(
    handler,
    /assertCanonicalBillingTransition|applyCanonicalBillingIngress/
  );
});

test("ACT-EIS-CATALOG: closed CanonicalBillingEventName set", () => {
  assert.ok(CANONICAL_BILLING_EVENT_NAMES.includes("billing.payment.paid"));
  assert.equal(
    CANONICAL_BILLING_EVENT_NAMES.includes(
      "payment.paid" as (typeof CANONICAL_BILLING_EVENT_NAMES)[number]
    ),
    false
  );
});

test("ACT-EIS-MIGRATIONS: separate event-ingress and billing ledgers", () => {
  const ingressCatalog = readSrc(
    "migrations/embedded-event-ingress/catalog.ts"
  );
  const billingCatalog = readSrc("migrations/embedded-billing/catalog.ts");
  assert.match(ingressCatalog, /athena_event_ingress_migrations/);
  assert.match(billingCatalog, /athena_billing_migrations/);
  assert.equal(
    existsSync(
      join(
        srcRoot,
        "migrations",
        "embedded-event-ingress",
        "sql",
        "0001_event_ingress.sql"
      )
    ),
    true
  );
  assert.equal(
    existsSync(
      join(
        srcRoot,
        "migrations",
        "embedded-event-ingress",
        "sql",
        "0002_event_ingress_failure_machine.sql"
      )
    ),
    true
  );
  assert.equal(
    existsSync(
      join(
        srcRoot,
        "migrations",
        "embedded-event-ingress",
        "sql",
        "0003_event_ingress_operation.sql"
      )
    ),
    true
  );
  assert.equal(
    existsSync(
      join(
        srcRoot,
        "migrations",
        "embedded-billing",
        "sql",
        "0001_billing_canonical.sql"
      )
    ),
    true
  );
  assert.equal(
    existsSync(
      join(
        srcRoot,
        "migrations",
        "embedded-billing",
        "sql",
        "0002_billing_subject_bindings.sql"
      )
    ),
    true
  );
  const runner = readSrc("migrations/runner.ts");
  assert.match(runner, /applyEmbeddedEventIngressMigrations/);
  assert.match(runner, /applyEmbeddedBillingMigrations/);
});

test("ACT-EIS-TRANSITION: previous pending → paid emits billing.payment.paid", () => {
  const events = canonicalizeBillingEvents({
    current: paidPayment("paid"),
    ingress: ingress(),
    previous: paidPayment("pending"),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.name, "billing.payment.paid");
  assert.equal(events[0]?.source.provider, "mollie");
  assert.equal(events[0]?.subject.id, "tr_test");
});

test("ACT-EIS-STALE: paid then pending is rejected", () => {
  assert.throws(
    () => assertRevisionIsNotStale(paidPayment("paid"), paidPayment("pending")),
    AthenaBillingRevisionStaleError
  );
});

test("ACT-EIS-FSM: refunded cannot become paid", () => {
  assert.throws(
    () =>
      assertCanonicalBillingTransition(
        paidPayment("refunded"),
        paidPayment("paid")
      ),
    AthenaBillingIllegalTransitionError
  );
});

test("ACT-EIS-INGEST: Direct EventIngressRuntime applies payment and outbox", async () => {
  const store = new MemoryBillingIngressStore();
  const persistence = createMemoryEventIngressPersistence(store.database);
  const repos = createMemoryBillingRepositories(store);
  const port = createMollieWebhookPort({
    resolveResource: async () => ({
      amount: { currency: "EUR", value: "10.00" },
      id: "tr_test",
      metadata: {},
      status: "paid",
    }),
    verification: "authoritative_refetch",
  });
  const runtime = createEventIngressRuntime({
    context: {
      database: store.database,
      domain: repos,
      persistence,
    },
    handler: createBillingEventIngressHandler({ port }),
  });
  const result = await runtime.ingest(ingress());
  assert.equal(result.duplicate, false);
  assert.equal(result.reconciliation, "skipped");
  assert.equal(result.events[0]?.name, "billing.payment.paid");
  assert.equal(store.outbox.length, 1);
  assert.equal(store.outbox[0]?.name, "billing.payment.paid");
  assert.equal(store.database.ingress.get(ingress().id)?.status, "processed");

  const again = await runtime.ingest(ingress());
  assert.equal(again.duplicate, true);
  assert.equal(again.reconciliation, "skipped");

  const replay = await runtime.ingest(
    ingress({ id: "22222222-2222-2222-2222-222222222222" })
  );
  assert.equal(replay.duplicate, true);
  assert.equal(replay.reconciliation, "skipped");
  assert.equal(store.outbox.length, 1);
});

test("ACT-EIS-HTTP-COMPILER: raw HTTP request becomes AthenaIngressIR", async () => {
  const request = new Request("http://localhost/api/athena/billing/webhook", {
    body: "id=tr_test",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const compiled = await compileHttpWebhookIngress({
    domain: "billing",
    operation: "webhook",
    request,
  });
  assert.equal(compiled.transport.kind, "http");
  assert.equal(compiled.domain, "billing");
  assert.equal(new TextDecoder().decode(compiled.body), "id=tr_test");
});

test("ACT-EIS-HTTP-BODY-LIMIT: oversized Content-Length is rejected before buffering", async () => {
  const { AthenaHttpBodyLimitError } = await import(
    "../../src/runtime/transport/http/incoming.ts"
  );
  const request = new Request("http://localhost/api/athena/billing/webhook", {
    body: "id=tr_test",
    headers: {
      "content-length": "999999",
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  await assert.rejects(
    () =>
      compileHttpWebhookIngress({
        domain: "billing",
        maxBodyBytes: 64,
        operation: "webhook",
        request,
      }),
    (error: unknown) => error instanceof AthenaHttpBodyLimitError
  );
});

test("ACT-EIS-NEXT-ROUTE: webhook path is dispatched before billing command surface", () => {
  const next = readSrc("next/data-handlers.ts");
  const dispatch = next.slice(next.indexOf("const dispatch = "));
  const webhookIdx = dispatch.indexOf(
    "DEFAULT_ATHENA_NEXT_BILLING_WEBHOOK_ENDPOINT"
  );
  const billingIdx = dispatch.indexOf("handlers.billing,");
  assert.ok(webhookIdx > 0);
  assert.ok(billingIdx > webhookIdx);
  assert.ok(next.includes("billingIngress"));
});

test("ACT-EIS-NO-BILLING-IN-INGRESS: runtime/ingress MUST NOT import billing types", () => {
  const sources = joined(join(srcRoot, "runtime", "ingress"));
  assert.doesNotMatch(sources, /CanonicalBillingDocument/);
  assert.doesNotMatch(sources, /billing\/canonical/);
  assert.doesNotMatch(sources, /billing\/runtime/);
});

test("ACT-EIS-BILLING-SQL-OWNERSHIP: billing table SQL lives under billing ingress", () => {
  const genericSql = readSrc("runtime/ingress/sql.ts");
  const billingSql = readSrc("billing/runtime/local/ingress/sql.ts");
  assert.equal(genericSql.includes("billing.billing_"), false);
  assert.match(billingSql, /billing\.billing_payments/);
  assert.match(
    billingSql,
    /ON CONFLICT \(connection_id, provider_payment_id\) WHERE connection_id IS NOT NULL/
  );
  assert.match(
    billingSql,
    /ON CONFLICT \(connection_id, provider_subscription_id\) WHERE connection_id IS NOT NULL/
  );
  assert.match(
    billingSql,
    /ON CONFLICT \(connection_id, provider_invoice_id\) WHERE connection_id IS NOT NULL/
  );
  assert.equal(
    billingSql.includes("ON CONFLICT (provider, provider_payment_id)"),
    false
  );
  assert.match(
    readSrc("migrations/embedded-billing/sql/0001_billing_canonical.sql"),
    /billing\.billing_payments/
  );
  assert.match(
    readSrc("migrations/embedded-event-ingress/sql/0001_event_ingress.sql"),
    /athena\.event_ingress/
  );
  assert.match(
    readSrc("migrations/embedded-event-ingress/sql/0001_event_ingress.sql"),
    /athena\.event_ledger/
  );
  assert.match(
    readSrc("migrations/embedded-event-ingress/sql/0001_event_ingress.sql"),
    /athena\.event_outbox/
  );
  assert.match(
    readSrc("migrations/embedded-event-ingress/sql/0001_event_ingress.sql"),
    /ON athena\.event_ingress \(domain, provider, provider_event_id\)/
  );
  assert.match(
    genericSql,
    /ON CONFLICT \(domain, provider, provider_event_id\) WHERE provider_event_id IS NOT NULL/
  );
  assert.match(genericSql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.equal(
    genericSql.includes("ON CONFLICT (id) DO UPDATE SET\n  provider_event_id"),
    false
  );
  assert.match(genericSql, /DO NOTHING\s+RETURNING id/);
  assert.equal(genericSql.includes("ROLLBACK TO SAVEPOINT"), false);
  assert.equal(genericSql.includes('code === "23505"'), false);
  assert.match(genericSql, /pg_advisory_xact_lock/);
  assert.match(genericSql, /json_build_array\(\$2::text, \$3::text\)/);
  assert.equal(genericSql.includes("\\u0000"), false);
});

test("ACT-EIS-NO-MEMORY-FALLBACK: attach does not silently use in-memory persistence", () => {
  const attach = readSrc("billing/runtime/local/ingress/attach.ts");
  assert.equal(attach.includes("MemoryEventIngressDatabase"), false);
  assert.equal(attach.includes("createMemoryBillingRepositories"), false);
  assert.match(attach, /ATHENA_EVENT_INGRESS_PERSISTENCE_REQUIRED/);
});

test("ACT-EIS-ENROLL-USES-CATALOG-REGISTRY: webhook enrollment does not rebuild a catalog-less registry", () => {
  const attach = readSrc("billing/runtime/local/ingress/attach.ts");
  const materialize = readSrc("billing/runtime/local/materialize.ts");
  assert.equal(attach.includes("createBillingProviderRegistry("), false);
  assert.match(attach, /registry: input\.registry/);
  assert.match(materialize, /attachEventIngressRuntime\([\s\S]*registry,/);
});

test("ACT-EIS-VERIFICATION-STRATEGY: Mollie port declares verification strategy", () => {
  const port = readSrc("billing/runtime/local/providers/webhook-port.ts");
  assert.match(port, /authoritative_refetch/);
  assert.match(port, /signature_and_refetch/);
  const mollie = readSrc(
    "billing/runtime/local/providers/mollie/webhook-port.ts"
  );
  assert.match(mollie, /verification/);
});

test("ACT-EIS-TRANSPORT-INCOMING: webhook compiler parses Request through Transport IR", () => {
  const compiler = readSrc("runtime/ingress/compiler/http.ts");
  assert.match(compiler, /parseAthenaIncomingHttpRequest/);
  assert.match(compiler, /compileIngressFromIncomingHttp/);
});

test("ACT-EIS-PROVIDER-EVENT-REPLAY: existing unique provider_event_id is duplicate without insert", async () => {
  const existingId = "11111111-1111-1111-1111-111111111111";
  const claimedRow = {
    attempt_count: 1,
    body: Buffer.from("id=tr_test"),
    connection_id: null,
    correlation_id: null,
    domain: "billing",
    headers: {},
    id: existingId,
    provider: "mollie",
    provider_event_id: "c6c61626-evt",
    received_at: new Date("2026-08-26T12:00:00.000Z"),
    status: "processed" as const,
    trace_id: null,
  };
  const statements: string[] = [];
  const tx: EventIngressDatabase = {
    async query<T = Record<string, unknown>>(
      text: string,
      _values?: unknown[]
    ): Promise<EventIngressQueryResult<T>> {
      statements.push(text);
      if (text.includes("INSERT")) {
        throw new Error("duplicate replay must not insert");
      }
      if (text.includes("provider_event_id = $3")) {
        return eventIngressQueryResult<T>([claimedRow]);
      }
      return eventIngressQueryResult<T>([]);
    },
    async transaction(fn) {
      return fn(tx);
    },
  };
  const persistence = createSqlEventIngressPersistence();
  const result = await persistence.insertReceived(
    tx,
    ingress({ id: "22222222-2222-2222-2222-222222222222" }),
    {
      provider: "mollie",
      providerEventId: "c6c61626-evt",
    }
  );
  assert.equal(result.duplicate, true);
  assert.equal(result.ingressId, existingId);
  assert.equal(
    statements.some((text) => text.includes("INSERT")),
    false
  );
});

test("ACT-EIS-PROVIDER-EVENT-ON-CONFLICT: lost insert is duplicate via SELECT, not 23505", async () => {
  const existingId = "11111111-1111-1111-1111-111111111111";
  let providerLookups = 0;
  let inserted = false;
  let uniqueViolation = false;
  const tx: EventIngressDatabase = {
    async query<T = Record<string, unknown>>(
      text: string,
      _values?: unknown[]
    ): Promise<EventIngressQueryResult<T>> {
      if (text.includes("pg_advisory_xact_lock")) {
        return eventIngressQueryResult<T>([{}]);
      }
      if (text.includes("INSERT")) {
        inserted = true;
        return eventIngressQueryResult<T>([]);
      }
      if (text.includes("UPDATE athena.event_ingress AS target")) {
        return eventIngressQueryResult<T>([]);
      }
      if (text.includes("provider_event_id = $3")) {
        providerLookups += 1;
        if (providerLookups < 3) {
          return eventIngressQueryResult<T>([]);
        }
        return eventIngressQueryResult<T>([
          { id: existingId, status: "processed" },
        ]);
      }
      if (text.includes("23505") || text.includes("ROLLBACK TO SAVEPOINT")) {
        uniqueViolation = true;
      }
      return eventIngressQueryResult<T>([]);
    },
    async transaction(fn) {
      return fn(tx);
    },
  };
  const persistence = createSqlEventIngressPersistence();
  const result = await persistence.insertReceived(
    tx,
    ingress({ id: "22222222-2222-2222-2222-222222222222" }),
    {
      provider: "mollie",
      providerEventId: "evt-1",
    }
  );
  assert.equal(result.duplicate, true);
  assert.equal(result.ingressId, existingId);
  assert.equal(inserted, true);
  assert.equal(uniqueViolation, false);
  assert.ok(providerLookups >= 2);
});
