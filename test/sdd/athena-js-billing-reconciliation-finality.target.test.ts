/**
 * Target: billing reconciliation finality.
 * See docs/sdd/xylex/athena-js-billing-reconciliation-finality/
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isAthenaBillingProviderRequestError } from "../../src/billing/errors.ts";
import {
  createMemoryBillingImportBindingStore,
  createMemoryBillingImportCursorStore,
} from "../../src/billing/import/apply.ts";
import { runBillingCustomerImportPage } from "../../src/billing/import/importer.ts";
import type {
  BillingImportCustomer,
  BillingSubjectDirectory,
  BillingSubjectRecord,
} from "../../src/billing/import/types.ts";
import { createMemoryBillingAuditWriter } from "../../src/billing/observability/audit.ts";
import { ATHENA_BILLING_EVENT_DEFINITIONS } from "../../src/billing/observability/events.ts";
import {
  billingTraceToDevtoolsEvent,
  createMemoryBillingTraceRecorder,
} from "../../src/billing/observability/traces.ts";
import type {
  AthenaBillingAuditEntry,
  AthenaBillingTraceRecord,
} from "../../src/billing/observability/types.ts";
import {
  AthenaBillingAuditError,
  validateBillingAuditEntry,
} from "../../src/billing/observability/validate.ts";
import { inheritWebhookBillingReconciliationContext } from "../../src/billing/reconciliation/context.ts";
import {
  reconcileBillingCustomer,
  reconcileBillingCustomers,
} from "../../src/billing/reconciliation/coordinator.ts";
import { createMemoryBillingReconciliationLeaseStore } from "../../src/billing/reconciliation/lease.ts";
import {
  AthenaBillingReconciliationError,
  billingReconciliationBackoff,
  classifyBillingReconciliationFailure,
} from "../../src/billing/reconciliation/retry.ts";
import { registerBillingReconciliationScheduler } from "../../src/billing/reconciliation/scheduler.ts";
import type { ResolvedBillingProviderConnection } from "../../src/billing/reconciliation/types.ts";
import { createMollieProviderRequestError } from "../../src/billing/runtime/local/providers/mollie/errors.ts";
import type { BillingSqlExecutor } from "../../src/billing/subject/repository.ts";
import { parse } from "../../src/cli/commands/billing/index.ts";
import { sanitizeAthenaDevtoolsDataEvent } from "../../src/devtools/sanitize/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

const dummySql: BillingSqlExecutor = {
  async query() {
    return { rows: [] };
  },
};

function user(id: string, email?: string): BillingSubjectRecord {
  return { email: email ?? null, subject: { id, kind: "user" } };
}

function directory(
  users: readonly BillingSubjectRecord[]
): BillingSubjectDirectory {
  return {
    async findUsersByEmail(email) {
      const normalized = email.trim().toLowerCase();
      return users.filter(
        (row) => row.email?.trim().toLowerCase() === normalized
      );
    },
    async getById(subject) {
      return (
        users.find(
          (row) =>
            row.subject.kind === subject.kind && row.subject.id === subject.id
        ) ?? null
      );
    },
  };
}

function customer(input: {
  email?: string | null;
  id: string;
  metadata?: Record<string, unknown>;
}): BillingImportCustomer {
  return {
    email: input.email,
    metadata: input.metadata ?? {},
    name: null,
    providerCustomerId: input.id,
    raw: input,
  };
}

function pagedDiscovery(pages: readonly (readonly BillingImportCustomer[])[]) {
  return {
    async getCustomer(input: { customerId: string }) {
      for (const page of pages) {
        const found = page.find(
          (item) => item.providerCustomerId === input.customerId
        );
        if (found) {
          return found;
        }
      }
      throw new Error("not found");
    },
    async listCustomers(input: { cursor?: string; limit?: number }) {
      const index = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
      return {
        items: pages[index] ?? [],
        nextCursor: index + 1 < pages.length ? String(index + 1) : null,
      };
    },
  };
}

const connection: ResolvedBillingProviderConnection = {
  accountReference: "org_1",
  credentialReference: "providers.mollie",
  environment: "test",
  id: "11111111-1111-1111-1111-111111111111",
  provider: "mollie",
  status: "active",
  testMode: true,
};

test("T-REC-LAYOUT: P?: observability, reconciliation, and 0005 exist", () => {
  assert.equal(
    existsSync(join(srcRoot, "billing/observability/types.ts")),
    true
  );
  assert.equal(
    existsSync(join(srcRoot, "billing/reconciliation/coordinator.ts")),
    true
  );
  assert.equal(
    existsSync(
      join(
        srcRoot,
        "migrations/embedded-billing/sql/0005_billing_reconciliation_observability.sql"
      )
    ),
    true
  );
  const sql = readFileSync(
    join(
      srcRoot,
      "migrations/embedded-billing/sql/0005_billing_reconciliation_observability.sql"
    ),
    "utf8"
  );
  assert.match(sql, /athena\.traces_billing/);
  assert.match(sql, /athena\.audit_log_billing/);
  assert.match(sql, /billing_reconciliation_leases/);
  assert.match(sql, /completed_with_conflicts/);
  assert.equal(
    existsSync(
      join(
        srcRoot,
        "migrations/embedded-billing/sql/0013_billing_audit_failure_outcome.sql"
      )
    ),
    true
  );
});

test("T-REC-EVENTS: P?: billing Event IR catalog is explicit", () => {
  assert.equal(
    "billing.subject.binding.created" in ATHENA_BILLING_EVENT_DEFINITIONS,
    true
  );
  assert.equal(
    "billing.reconciliation.failed" in ATHENA_BILLING_EVENT_DEFINITIONS,
    true
  );
  assert.equal(
    ATHENA_BILLING_EVENT_DEFINITIONS["billing.subject.binding.created"]
      .mutationKind,
    "create"
  );
});

test("T-REC-PAGES: P?: one run drains three Mollie pages", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const cursors = createMemoryBillingImportCursorStore();
  const discovery = pagedDiscovery([
    [
      customer({
        id: "cst_1",
        metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
      }),
    ],
    [
      customer({
        id: "cst_2",
        metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
      }),
    ],
    [
      customer({
        id: "cst_3",
        metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
      }),
    ],
  ]);
  const dir = directory([user("u1", "a@example.com")]);
  const result = await reconcileBillingCustomers({
    connection,
    context: {
      connectionId: connection.id,
      correlationId: "run_1",
      provider: "mollie",
      traceId: "trace_1",
      trigger: "manual",
    },
    cursors,
    dryRun: false,
    lease: createMemoryBillingReconciliationLeaseStore().store,
    limits: {
      maxCustomers: 50,
      maxDurationMs: 10_000,
      maxPages: 10,
      pageSize: 1,
    },
    rootSql: dummySql,
    runPage: ({ cursor, limit }) =>
      runBillingCustomerImportPage({
        bindings,
        connectionId: connection.id,
        cursor: cursor ?? undefined,
        cursors,
        directory: dir,
        discovery,
        dryRun: false,
        limit,
        policy: {
          allowSecondaryBindings: true,
          allowUniqueEmailAutoBind: false,
        },
      }),
  });
  assert.equal(result.pagesProcessed, 3);
  assert.equal(result.customersScanned, 3);
  assert.equal(result.hasMore, false);
  assert.equal(result.status, "completed");
});

test("T-REC-BUDGET: P?: maxPages checkpoints and resumes", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const cursors = createMemoryBillingImportCursorStore();
  const discovery = pagedDiscovery([
    [
      customer({
        id: "cst_1",
        metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
      }),
    ],
    [
      customer({
        id: "cst_2",
        metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
      }),
    ],
    [
      customer({
        id: "cst_3",
        metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
      }),
    ],
  ]);
  const dir = directory([user("u1")]);
  const first = await reconcileBillingCustomers({
    connection,
    context: {
      connectionId: connection.id,
      correlationId: "run_a",
      provider: "mollie",
      traceId: "t_a",
      trigger: "scheduled",
    },
    cursors,
    lease: createMemoryBillingReconciliationLeaseStore().store,
    limits: {
      maxCustomers: 50,
      maxDurationMs: 10_000,
      maxPages: 1,
      pageSize: 1,
    },
    rootSql: dummySql,
    runPage: ({ cursor, limit }) =>
      runBillingCustomerImportPage({
        bindings,
        connectionId: connection.id,
        cursor: cursor ?? undefined,
        cursors,
        directory: dir,
        discovery,
        dryRun: false,
        limit,
        policy: {
          allowSecondaryBindings: true,
          allowUniqueEmailAutoBind: false,
        },
      }),
  });
  assert.equal(first.status, "checkpointed");
  assert.equal(first.pagesProcessed, 1);
  const second = await reconcileBillingCustomers({
    connection,
    context: {
      connectionId: connection.id,
      correlationId: "run_b",
      provider: "mollie",
      traceId: "t_b",
      trigger: "scheduled",
    },
    cursors,
    lease: createMemoryBillingReconciliationLeaseStore().store,
    limits: {
      maxCustomers: 50,
      maxDurationMs: 10_000,
      maxPages: 10,
      pageSize: 1,
    },
    rootSql: dummySql,
    runPage: ({ cursor, limit }) =>
      runBillingCustomerImportPage({
        bindings,
        connectionId: connection.id,
        cursor: cursor ?? undefined,
        cursors,
        directory: dir,
        discovery,
        dryRun: false,
        limit,
        policy: {
          allowSecondaryBindings: true,
          allowUniqueEmailAutoBind: false,
        },
      }),
  });
  assert.equal(second.customersScanned, 2);
  assert.equal(second.hasMore, false);
});

test("T-REC-LEASE: P?: concurrent second coordinator cannot acquire", async () => {
  const shared = createMemoryBillingReconciliationLeaseStore();
  const first = await shared.store.acquire({
    connectionId: connection.id,
    ownerId: "owner_a",
  });
  assert.ok(first);
  const second = await shared.store.acquire({
    connectionId: connection.id,
    ownerId: "owner_b",
  });
  assert.equal(second, null);
});

test("T-REC-LEASE-RECOVERY: P?: expired owner can be replaced", async () => {
  let now = new Date("2026-01-01T00:00:00.000Z");
  const shared = createMemoryBillingReconciliationLeaseStore(() => now);
  const original = await shared.store.acquire({
    connectionId: connection.id,
    ownerId: "owner_a",
    ttlMs: 1000,
  });
  now = new Date("2026-01-01T00:00:05.000Z");
  const recovered = await shared.store.acquire({
    connectionId: connection.id,
    ownerId: "owner_b",
    ttlMs: 1000,
  });
  assert.ok(recovered);
  assert.equal(recovered.ownerId, "owner_b");
  assert.ok(recovered.epoch > (original?.epoch ?? 0));
});

test("T-REC-CURSOR: P?: page failure does not advance cursor", async () => {
  const cursors = createMemoryBillingImportCursorStore();
  await cursors.set(connection.id, "page_0");
  let calls = 0;
  await assert.rejects(() =>
    reconcileBillingCustomers({
      connection,
      context: {
        connectionId: connection.id,
        correlationId: "run_fail",
        provider: "mollie",
        traceId: "t_fail",
        trigger: "manual",
      },
      cursors,
      lease: createMemoryBillingReconciliationLeaseStore().store,
      limits: {
        maxCustomers: 10,
        maxDurationMs: 5000,
        maxPages: 3,
        pageSize: 1,
      },
      rootSql: dummySql,
      runPage: async () => {
        calls += 1;
        throw new Error("apply failed");
      },
    })
  );
  assert.equal(calls, 1);
  assert.equal(await cursors.get(connection.id), "page_0");
});

test("T-REC-IDEMPOTENT: P?: rerun produces the same binding", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const cursors = createMemoryBillingImportCursorStore();
  const discovery = pagedDiscovery([
    [
      customer({
        id: "cst_1",
        metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
      }),
    ],
  ]);
  const dir = directory([user("u1")]);
  const run = () =>
    reconcileBillingCustomers({
      connection,
      context: {
        connectionId: connection.id,
        correlationId: crypto.randomUUID(),
        provider: "mollie",
        traceId: crypto.randomUUID(),
        trigger: "manual",
      },
      cursors,
      lease: createMemoryBillingReconciliationLeaseStore().store,
      limits: {
        maxCustomers: 10,
        maxDurationMs: 5000,
        maxPages: 3,
        pageSize: 10,
      },
      rootSql: dummySql,
      runPage: ({ cursor, limit }) =>
        runBillingCustomerImportPage({
          bindings,
          connectionId: connection.id,
          cursor: cursor ?? undefined,
          cursors,
          directory: dir,
          discovery,
          dryRun: false,
          limit,
          policy: {
            allowSecondaryBindings: false,
            allowUniqueEmailAutoBind: false,
          },
        }),
    });
  const first = await run();
  const second = await run();
  assert.equal(first.bindingsCreated, 1);
  assert.equal(second.bindingsCreated, 0);
  assert.equal(bindings.records.length, 1);
});

test("T-REC-AUDIT: P?: binding apply emits semantic audit", async () => {
  const sink = { entries: [] };
  const writer = createMemoryBillingAuditWriter(sink);
  const bindings = createMemoryBillingImportBindingStore();
  await runBillingCustomerImportPage({
    bindings,
    connectionId: connection.id,
    context: {
      connectionId: connection.id,
      correlationId: "c1",
      provider: "mollie",
      traceId: "t1",
      trigger: "manual",
    },
    directory: directory([user("u1")]),
    discovery: pagedDiscovery([
      [
        customer({
          id: "cst_1",
          metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
        }),
      ],
    ]),
    dryRun: false,
    policy: { allowSecondaryBindings: false, allowUniqueEmailAutoBind: false },
    semanticAudit: writer,
  });
  assert.equal(
    sink.entries.some(
      (entry) => entry.event === "billing.subject.binding.created"
    ),
    true
  );
});

test("T-REC-AUDIT-REDACT: P?: audit snapshots drop email and provider raw", async () => {
  const sink = { entries: [] as AthenaBillingAuditEntry[] };
  const writer = createMemoryBillingAuditWriter(sink);
  await writer.write({
    actor: { kind: "service" },
    connectionId: "11111111-1111-4111-8111-111111111111",
    event: "billing.subject.binding.created",
    eventId: "22222222-2222-4222-8222-222222222222",
    id: "33333333-3333-4333-8333-333333333333",
    outcome: "success",
    previous: {
      amount: { currency: "EUR", value: "10.00" },
      email: "user@example.com",
    },
    provider: "mollie",
    result: {
      emailSnapshot: "user@example.com",
      id: "cst_1",
      raw: { secret: "live_xxx" },
    },
    subject: { id: "u1", kind: "user" },
    traceId: "t1",
  });
  const stored = sink.entries[0];
  assert.ok(stored);
  assert.equal(
    JSON.stringify(stored.previous ?? {}).includes("user@example.com"),
    false
  );
  assert.equal(
    JSON.stringify(stored.result ?? {}).includes("user@example.com"),
    false
  );
  assert.equal(JSON.stringify(stored.result ?? {}).includes("live_xxx"), false);
  assert.equal((stored.result as { id?: string }).id, "cst_1");
});

test("T-REC-AUDIT-OUTCOME: P?: failure outcome is a valid audit row", () => {
  const ir = ATHENA_BILLING_EVENT_DEFINITIONS["billing.reconciliation.failed"];
  assert.doesNotThrow(() =>
    validateBillingAuditEntry(
      {
        actor: { kind: "system" },
        connectionId: connection.id,
        event: "billing.reconciliation.failed",
        eventId: "44444444-4444-4444-8444-444444444444",
        id: "55555555-5555-4555-8555-555555555555",
        outcome: "failure",
        provider: "mollie",
        result: { error: "provider timeout" },
        traceId: "t1",
      },
      ir
    )
  );
  assert.throws(
    () =>
      validateBillingAuditEntry(
        {
          actor: { kind: "system" },
          connectionId: connection.id,
          event: "billing.reconciliation.failed",
          eventId: "not-a-uuid",
          id: "55555555-5555-4555-8555-555555555555",
          outcome: "failure",
          provider: "mollie",
          result: { error: "provider timeout" },
          traceId: "t1",
        },
        ir
      ),
    AthenaBillingAuditError
  );
});

test("T-REC-AUDIT-CONFLICT-PREVIOUS: P?: first-seen binding conflict does not require previous", () => {
  const ir = ATHENA_BILLING_EVENT_DEFINITIONS["billing.subject.binding.conflict"];
  assert.equal(ir.previous, "optional");
  assert.doesNotThrow(() =>
    validateBillingAuditEntry(
      {
        actor: { kind: "system" },
        connectionId: connection.id,
        event: "billing.subject.binding.conflict",
        eventId: "44444444-4444-4444-8444-444444444444",
        id: "55555555-5555-4555-8555-555555555555",
        outcome: "success",
        provider: "mollie",
        providerSubject: { id: "cst_1", kind: "customer" },
        result: { action: "conflict", decision: "conflict" },
        subject: { id: "u1", kind: "user" },
        traceId: "t1",
      },
      ir
    )
  );
});

test("T-REC-PAGE-TX: P?: assemble does not wrap Mollie pages in a Postgres transaction", () => {
  const assemble = readFileSync(
    join(srcRoot, "billing/import/assemble.ts"),
    "utf8"
  );
  assert.equal(
    assemble.includes("transaction: (fn) => database.transaction"),
    false
  );
});

test("T-REC-AUDIT-FAILURE-TRAIL: P?: apply errors write outcome failure", async () => {
  const sink = { entries: [] as AthenaBillingAuditEntry[] };
  const writer = createMemoryBillingAuditWriter(sink);
  const bindings = createMemoryBillingImportBindingStore();
  const original = bindings.insertActive.bind(bindings);
  bindings.insertActive = async () => {
    throw new Error("binding insert failed");
  };
  await assert.rejects(() =>
    runBillingCustomerImportPage({
      bindings,
      connectionId: connection.id,
      context: {
        connectionId: connection.id,
        correlationId: "c1",
        provider: "mollie",
        traceId: "t1",
        trigger: "manual",
      },
      directory: directory([user("u1", "a@example.com")]),
      discovery: pagedDiscovery([
        [
          customer({
            email: "a@example.com",
            id: "cst_fail",
            metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
          }),
        ],
      ]),
      dryRun: false,
      policy: {
        allowSecondaryBindings: false,
        allowUniqueEmailAutoBind: true,
      },
      semanticAudit: writer,
      skipCursorAdvance: true,
    })
  );
  assert.equal(
    sink.entries.some(
      (entry) =>
        entry.event === "billing.reconciliation.failed" &&
        entry.outcome === "failure"
    ),
    true
  );
  bindings.insertActive = original;
});

test("T-REC-AUDIT-FAIL: P?: audit failure rolls back the page transaction", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  await assert.rejects(() =>
    reconcileBillingCustomers({
      connection,
      context: {
        connectionId: connection.id,
        correlationId: "c1",
        provider: "mollie",
        traceId: "t1",
        trigger: "manual",
      },
      lease: createMemoryBillingReconciliationLeaseStore().store,
      limits: {
        maxCustomers: 10,
        maxDurationMs: 5000,
        maxPages: 1,
        pageSize: 10,
      },
      rootSql: dummySql,
      runPage: async () =>
        runBillingCustomerImportPage({
          bindings,
          connectionId: connection.id,
          context: {
            connectionId: connection.id,
            correlationId: "c1",
            provider: "mollie",
            traceId: "t1",
            trigger: "manual",
          },
          directory: directory([user("u1")]),
          discovery: pagedDiscovery([
            [
              customer({
                id: "cst_1",
                metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
              }),
            ],
          ]),
          dryRun: false,
          policy: {
            allowSecondaryBindings: false,
            allowUniqueEmailAutoBind: false,
          },
          semanticAudit: {
            async write() {
              throw new Error("audit unavailable");
            },
          },
        }),
      transaction: async (fn) => {
        const snapshot = bindings.records.map((row) => ({ ...row }));
        try {
          return await fn(dummySql);
        } catch (error) {
          bindings.records.length = 0;
          bindings.records.push(...snapshot);
          throw error;
        }
      },
    })
  );
  assert.equal(bindings.records.length, 0);
});

test("T-REC-TRACE-FAIL: P?: trace persistence failure keeps reconciliation committed", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const cursors = createMemoryBillingImportCursorStore();
  const recorder = createMemoryBillingTraceRecorder({ records: [] });
  const failing = {
    start(input: Parameters<typeof recorder.start>[0]) {
      const active = recorder.start(input);
      return {
        ...active,
        async success() {
          throw new Error("traces_billing insert failed");
        },
      };
    },
  };
  const result = await reconcileBillingCustomers({
    connection,
    context: {
      connectionId: connection.id,
      correlationId: "c-trace",
      provider: "mollie",
      traceId: "t-trace",
      trigger: "manual",
    },
    cursors,
    lease: createMemoryBillingReconciliationLeaseStore().store,
    limits: {
      maxCustomers: 10,
      maxDurationMs: 5000,
      maxPages: 2,
      pageSize: 10,
    },
    rootSql: dummySql,
    runPage: ({ cursor, limit }) =>
      runBillingCustomerImportPage({
        bindings,
        connectionId: connection.id,
        cursor: cursor ?? undefined,
        cursors,
        directory: directory([user("u1")]),
        discovery: pagedDiscovery([
          [
            customer({
              id: "cst_1",
              metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
            }),
          ],
        ]),
        dryRun: false,
        limit,
        policy: {
          allowSecondaryBindings: false,
          allowUniqueEmailAutoBind: false,
        },
      }),
    traces: failing,
  });
  assert.equal(result.bindingsCreated, 1);
});

test("T-REC-CAUSALITY: P?: webhook IDs propagate", () => {
  const context = inheritWebhookBillingReconciliationContext({
    causationId: "ingress_9",
    connectionId: connection.id,
    correlationId: "corr_9",
    provider: "mollie",
    traceId: "trace_9",
  });
  assert.equal(context.traceId, "trace_9");
  assert.equal(context.correlationId, "corr_9");
  assert.equal(context.causationId, "ingress_9");
  assert.equal(context.trigger, "webhook");
});

test("T-REC-ENV: P?: assemble uses connection.testMode not global fallback", () => {
  const assemble = readFileSync(
    join(srcRoot, "billing/import/assemble.ts"),
    "utf8"
  );
  assert.equal(assemble.includes("testMode: input.testMode ?? true"), false);
  assert.match(assemble, /testMode: connection\.testMode/);
});

test("T-REC-429: P?: rate limit is retryable", () => {
  const error = createMollieProviderRequestError({
    fallbackMessage: "rate limited",
    kind: "rate_limited",
    operation: "customers.list",
    status: 429,
  });
  assert.equal(isAthenaBillingProviderRequestError(error), true);
  assert.equal(
    classifyBillingReconciliationFailure(error),
    "provider_rate_limited"
  );
  const decision = billingReconciliationBackoff({ attempt: 0, error });
  assert.equal(decision.retry, true);
  assert.ok(decision.delayMs >= 60_000);
});

test("T-REC-401: P?: auth failure is permanent", () => {
  const error = createMollieProviderRequestError({
    fallbackMessage: "unauthorized",
    kind: "authentication",
    operation: "customers.list",
    status: 401,
  });
  const decision = billingReconciliationBackoff({ attempt: 0, error });
  assert.equal(decision.retry, false);
  assert.equal(decision.kind, "provider_auth_failed");
});

test("T-REC-TARGET: P?: targeted reconcile uses getCustomer", async () => {
  let listed = 0;
  let got = 0;
  const discovery = {
    async getCustomer(input: { customerId: string }) {
      got += 1;
      return customer({
        id: input.customerId,
        metadata: { athenaSubjectId: "u1", athenaSubjectKind: "user" },
      });
    },
    async listCustomers() {
      listed += 1;
      return { items: [], nextCursor: null };
    },
  };
  const bindings = createMemoryBillingImportBindingStore();
  await reconcileBillingCustomer({
    connection,
    context: inheritWebhookBillingReconciliationContext({
      causationId: "ing",
      connectionId: connection.id,
      correlationId: "corr",
      provider: "mollie",
      traceId: "tr",
    }),
    lease: createMemoryBillingReconciliationLeaseStore().store,
    rootSql: dummySql,
    runTargetedPage: (sql) => {
      assert.equal(sql, dummySql);
      return runBillingCustomerImportPage({
        bindings,
        connectionId: connection.id,
        customerId: "cst_hook",
        directory: directory([user("u1")]),
        discovery,
        dryRun: false,
        policy: {
          allowSecondaryBindings: false,
          allowUniqueEmailAutoBind: false,
        },
        skipCursorAdvance: true,
      });
    },
  });
  assert.equal(got, 1);
  assert.equal(listed, 0);
});

test("T-REC-SECRETS: P?: traces redact credential-shaped metadata", () => {
  const projected = billingTraceToDevtoolsEvent({
    completedAt: new Date(),
    connectionId: connection.id,
    id: "1",
    metadata: {},
    operation: "customer.reconcile",
    outcome: "success",
    provider: "mollie",
    startedAt: new Date(),
    totalMs: 12,
    traceId: "abc",
    trigger: "manual",
  });
  const sanitized = sanitizeAthenaDevtoolsDataEvent(projected);
  assert.equal(sanitized?.domain, "billing");
  assert.equal(sanitized?.operation, "customer.reconcile");
  assert.equal(JSON.stringify(sanitized).includes("live_"), false);
});

test("T-REC-CLI: P?: apply routes through coordinator flags", () => {
  const parsed = parse([
    "reconcile-subjects",
    "--connection",
    "c1",
    "--apply",
    "--max-pages",
    "3",
    "--max-customers",
    "50",
    "--max-duration",
    "120000",
  ]);
  assert.equal(parsed.command, "billing-reconcile-subjects");
  if (parsed.command === "billing-reconcile-subjects") {
    assert.equal(parsed.apply, true);
    assert.equal(parsed.maxPages, 3);
    assert.equal(parsed.maxCustomers, 50);
  }
  const execute = readFileSync(
    join(srcRoot, "cli/commands/billing/execute.ts"),
    "utf8"
  );
  assert.match(execute, /runBillingCustomerImportWithPostgres/);
  const assemble = readFileSync(
    join(srcRoot, "billing/import/assemble.ts"),
    "utf8"
  );
  assert.match(assemble, /reconcileBillingCustomers/);
});

test("T-REC-SCHEDULER: P?: external execution does not attach a timer", () => {
  let ran = 0;
  const handle = registerBillingReconciliationScheduler({
    enabled: true,
    execution: "external",
    mode: "automatic",
    run: async () => {
      ran += 1;
    },
  });
  assert.equal(handle, null);
  assert.equal(ran, 0);
});

test("T-REC-LEASE-ABORT: P?: lease loss throws before further pages", async () => {
  const leases = createMemoryBillingReconciliationLeaseStore();
  let pages = 0;
  await assert.rejects(
    () =>
      reconcileBillingCustomers({
        connection,
        context: {
          connectionId: connection.id,
          correlationId: "lease",
          provider: "mollie",
          traceId: "t",
          trigger: "scheduled",
        },
        lease: {
          async acquire(input) {
            return leases.store.acquire(input);
          },
          async heartbeat() {
            return false;
          },
          async release(input) {
            return leases.store.release(input);
          },
        },
        limits: {
          maxCustomers: 10,
          maxDurationMs: 5000,
          maxPages: 5,
          pageSize: 1,
        },
        rootSql: dummySql,
        runPage: async () => {
          pages += 1;
          return {
            bindingsActivated: 0,
            bindingsCreated: 0,
            conflicts: 0,
            cursorAfter: String(pages),
            cursorBefore: null,
            customersScanned: 1,
            hasMore: true,
            plans: [],
            skipped: 0,
          };
        },
      }),
    (error: unknown) =>
      error instanceof AthenaBillingReconciliationError &&
      error.kind === "lease_lost"
  );
});

test("T-REC-OPS-UI: P?: operations presets include trace and trigger", () => {
  const presets = readFileSync(
    join(
      pkgRoot,
      "..",
      "athena-auth-ui",
      "src/components/auth/billing/billing-query-presets.ts"
    ),
    "utf8"
  );
  assert.match(presets, /trace_id/);
  assert.match(presets, /trigger/);
  const card = readFileSync(
    join(
      pkgRoot,
      "..",
      "athena-auth-ui",
      "src/components/auth/billing/billing-customer-import-card.tsx"
    ),
    "utf8"
  );
  assert.match(card, /Reconcile now/);
});

test("T-REC-TRACE-CAUSATION: P?: causationId is persisted on the trace record", async () => {
  const sink = { records: [] as AthenaBillingTraceRecord[] };
  const recorder = createMemoryBillingTraceRecorder(sink, 1);
  const trace = recorder.start({
    causationId: "cause-1",
    connectionId: connection.id,
    correlationId: "corr-1",
    operation: "customer.reconcile",
    provider: "mollie",
    traceId: "trace-1",
    trigger: "webhook",
  });
  await trace.success();
  assert.equal(sink.records[0]?.causationId, "cause-1");
  assert.equal(sink.records[0]?.traceId, "trace-1");
});

test("T-REC-TRACE-SAMPLE: P?: sampleRate 0 records no traces", async () => {
  const sink = { records: [] as AthenaBillingTraceRecord[] };
  const recorder = createMemoryBillingTraceRecorder(sink, 0);
  const trace = recorder.start({
    connectionId: connection.id,
    operation: "customer.reconcile",
    provider: "mollie",
    traceId: "trace-drop",
    trigger: "manual",
  });
  await trace.success();
  assert.equal(sink.records.length, 0);
});

test("T-REC-SCHEDULER-CATCH: P?: rejected runs are handed to onError", async () => {
  const errors: unknown[] = [];
  const handle = registerBillingReconciliationScheduler({
    enabled: true,
    mode: "automatic",
    onError: (error) => {
      errors.push(error);
    },
    run: async () => {
      throw new Error("scheduled-boom");
    },
    schedule: { intervalMs: 60_000, jitterMs: 0 },
  });
  assert.ok(handle);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(errors.length, 1);
  handle?.cancel();
});
