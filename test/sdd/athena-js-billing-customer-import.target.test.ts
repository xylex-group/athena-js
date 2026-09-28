/**
 * Target: billing customer import.
 * See docs/sdd/xylex/athena-js-billing-customer-import/
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createMemoryBillingImportBindingStore,
  createMemoryBillingImportCursorStore,
} from "../../src/billing/import/apply.ts";
import { createMemoryBillingImportAuditStore } from "../../src/billing/import/audit.ts";
import { shouldAutomaticallyImportBillingCustomers } from "../../src/billing/import/automatic.ts";
import {
  ATHENA_BILLING_IMPORT_PROVIDER_FAILED,
  AthenaBillingImportError,
} from "../../src/billing/import/errors.ts";
import { runBillingCustomerImport } from "../../src/billing/import/importer.ts";
import { createMemoryBillingImportDocumentStore } from "../../src/billing/import/project.ts";
import { projectMollieImportCustomer } from "../../src/billing/import/providers/mollie.ts";
import { formatBillingImportPlan } from "../../src/billing/import/report.ts";
import type {
  BillingImportCustomer,
  BillingSubjectDirectory,
  BillingSubjectRecord,
} from "../../src/billing/import/types.ts";
import { parse, run } from "../../src/cli/commands/billing/index.ts";
import { ATHENA_BILLING_ERROR_DESCRIPTORS } from "../../src/runtime/error/generated/billing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function user(
  id: string,
  email?: string,
  verified?: boolean
): BillingSubjectRecord {
  return {
    email: email ?? null,
    emailVerified: verified === true,
    subject: { id, kind: "user" },
  };
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

function discovery(
  items: readonly BillingImportCustomer[],
  nextCursor?: string | null
) {
  return {
    async listCustomers() {
      return { items, nextCursor: nextCursor ?? null };
    },
  };
}

const CONN = "11111111-1111-1111-1111-111111111111";
const EMAIL_POLICY = {
  allowSecondaryBindings: false,
  allowUniqueEmailAutoBind: true,
};

test("P?: metadata subject ID creates an active binding", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const report = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_123", "a@example.com")]),
    discovery: discovery([
      customer({
        id: "cst_abc",
        metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false,
  });
  assert.equal(report.bindingsCreated, 1);
  assert.equal(bindings.records[0]?.subjectId, "user_123");
  assert.equal(bindings.records[0]?.status, "active");
  assert.equal(bindings.records[0]?.source, "imported");
  assert.equal(bindings.records[0]?.isPrimary, true);
});

test("P?: unique email creates an active binding when auto-bind is enabled", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const report = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_123", "user@example.com", true)]),
    discovery: discovery([
      customer({ email: "user@example.com", id: "cst_abc" }),
    ]),
    dryRun: false,
    policy: EMAIL_POLICY,
  });
  assert.equal(report.plans[0]?.reason, "unique email match");
  assert.equal(report.bindingsCreated, 1);
  assert.equal(bindings.records[0]?.emailSnapshot, "user@example.com");
});

test("P?: unique email auto-bind stays quarantined without verified ownership", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const report = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_123", "user@example.com")]),
    discovery: discovery([
      customer({ email: "user@example.com", id: "cst_abc" }),
    ]),
    dryRun: false,
    policy: EMAIL_POLICY,
  });
  assert.equal(report.plans[0]?.reason, "unique email unverified");
  assert.equal(report.plans[0]?.decision, "conflict");
  assert.equal(bindings.records.length, 0);
});

test("P?: duplicate email creates no automatic binding", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const report = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([
      user("user_1", "dup@example.com"),
      user("user_2", "dup@example.com"),
    ]),
    discovery: discovery([
      customer({ email: "dup@example.com", id: "cst_xyz" }),
    ]),
    dryRun: false,
    includeAmbiguous: true,
    policy: EMAIL_POLICY,
  });
  assert.equal(report.bindingsCreated, 0);
  assert.equal(report.plans[0]?.decision, "conflict");
  assert.equal(report.plans[0]?.reason, "duplicate email");
  assert.match(formatBillingImportPlan(report.plans[0]!), /user_1/);
  assert.equal(bindings.records.length, 0);
});

test("P?: no email stays unresolved", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const report = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_123")]),
    discovery: discovery([customer({ id: "cst_none" })]),
    dryRun: false,
  });
  assert.equal(report.plans[0]?.confidence, "none");
  assert.equal(report.bindingsCreated, 0);
});

test("P?: unknown metadata subject is a conflict", async () => {
  const report = await runBillingCustomerImport({
    bindings: createMemoryBillingImportBindingStore(),
    connectionId: CONN,
    directory: directory([]),
    discovery: discovery([
      customer({
        id: "cst_missing",
        metadata: { athenaSubjectId: "missing", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: true,
  });
  assert.equal(report.plans[0]?.decision, "conflict");
  assert.match(report.plans[0]?.reason ?? "", /nonexistent subject/);
});

test("P?: existing same binding is a noop", async () => {
  const bindings = createMemoryBillingImportBindingStore([
    {
      connectionId: CONN,
      emailSnapshot: "user@example.com",
      id: "bind_1",
      isPrimary: true,
      providerSubjectId: "cst_abc",
      providerSubjectKind: "customer",
      source: "imported",
      status: "active",
      subjectId: "user_123",
      subjectKind: "user",
    },
  ]);
  const report = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_123", "user@example.com")]),
    discovery: discovery([
      customer({ email: "user@example.com", id: "cst_abc" }),
    ]),
    dryRun: false,
    policy: EMAIL_POLICY,
  });
  assert.equal(report.plans[0]?.action, "noop");
  assert.equal(bindings.records.length, 1);
});

test("P?: existing different binding is a conflict", async () => {
  const bindings = createMemoryBillingImportBindingStore([
    {
      connectionId: CONN,
      emailSnapshot: null,
      id: "bind_1",
      isPrimary: true,
      providerSubjectId: "cst_abc",
      providerSubjectKind: "customer",
      source: "imported",
      status: "active",
      subjectId: "user_a",
      subjectKind: "user",
    },
  ]);
  const report = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_b")]),
    discovery: discovery([
      customer({
        id: "cst_abc",
        metadata: { athenaSubjectId: "user_b", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false,
  });
  assert.equal(report.plans[0]?.decision, "conflict");
  assert.equal(bindings.records[0]?.subjectId, "user_a");
});

test("P?: same provider customer cannot bind two users", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_a")]),
    discovery: discovery([
      customer({
        id: "cst_one",
        metadata: { athenaSubjectId: "user_a", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false,
  });
  const second = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_b")]),
    discovery: discovery([
      customer({
        id: "cst_one",
        metadata: { athenaSubjectId: "user_b", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false,
  });
  assert.equal(second.plans[0]?.decision, "conflict");
  assert.equal(bindings.records.length, 1);
  assert.equal(bindings.records[0]?.subjectId, "user_a");
});

test("P?: same Athena user may bind Mollie and Stripe", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const dir = directory([user("user_123")]);
  await runBillingCustomerImport({
    bindings,
    connectionId: "conn_mollie",
    directory: dir,
    discovery: discovery([
      customer({
        id: "cst_m",
        metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false,
  });
  await runBillingCustomerImport({
    bindings,
    connectionId: "conn_stripe",
    directory: dir,
    discovery: discovery([
      customer({
        id: "cus_s",
        metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false,
  });
  assert.equal(bindings.records.length, 2);
});

test("P?: same Athena user may bind test and live", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const dir = directory([user("user_123")]);
  await runBillingCustomerImport({
    bindings,
    connectionId: "conn_test",
    directory: dir,
    discovery: discovery([
      customer({
        id: "cst_t",
        metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false,
  });
  await runBillingCustomerImport({
    bindings,
    connectionId: "conn_live",
    directory: dir,
    discovery: discovery([
      customer({
        id: "cst_l",
        metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false,
  });
  assert.equal(bindings.records.length, 2);
});

test("P?: email change does not change binding", async () => {
  const bindings = createMemoryBillingImportBindingStore([
    {
      connectionId: CONN,
      emailSnapshot: "old@example.com",
      id: "bind_1",
      isPrimary: true,
      providerSubjectId: "cst_abc",
      providerSubjectKind: "customer",
      source: "imported",
      status: "active",
      subjectId: "user_123",
      subjectKind: "user",
    },
  ]);
  await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([
      user("user_123", "new@example.com"),
      user("other", "old@example.com"),
    ]),
    discovery: discovery([
      customer({ email: "old@example.com", id: "cst_abc" }),
    ]),
    dryRun: false,
    policy: EMAIL_POLICY,
  });
  assert.equal(bindings.records[0]?.subjectId, "user_123");
  assert.equal(bindings.records.length, 1);
});

test("P?: provider metadata beats email", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const report = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([
      user("user_meta", "shared@example.com"),
      user("user_email", "shared@example.com"),
    ]),
    discovery: discovery([
      customer({
        email: "shared@example.com",
        id: "cst_meta",
        metadata: {
          athenaSubjectId: "user_meta",
          athenaSubjectKind: "user",
        },
      }),
    ]),
    dryRun: false,
    policy: EMAIL_POLICY,
  });
  assert.equal(report.plans[0]?.confidence, "exact");
  assert.equal(bindings.records[0]?.subjectId, "user_meta");
});

test("P?: dry-run mutates nothing", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const cursors = createMemoryBillingImportCursorStore();
  const documents = createMemoryBillingImportDocumentStore([
    {
      connectionId: CONN,
      id: "inv_1",
      kind: "invoice",
      ownershipStatus: "unresolved",
      providerCustomerId: "cst_abc",
    },
  ]);
  await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    cursors,
    directory: directory([user("user_123", "user@example.com")]),
    discovery: discovery(
      [customer({ email: "user@example.com", id: "cst_abc" })],
      "next"
    ),
    documents,
    dryRun: true,
    policy: EMAIL_POLICY,
  });
  assert.equal(bindings.records.length, 0);
  assert.equal(cursors.cursors.size, 0);
  assert.equal(documents.documents[0]?.ownershipStatus, "unresolved");
});

test("P?: apply is idempotent", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const input = {
    bindings,
    connectionId: CONN,
    directory: directory([user("user_123")]),
    discovery: discovery([
      customer({
        id: "cst_abc",
        metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false as const,
  };
  await runBillingCustomerImport(input);
  const second = await runBillingCustomerImport(input);
  assert.equal(bindings.records.length, 1);
  assert.equal(second.plans[0]?.action, "noop");
});

test("P?: cursor resumes correctly", async () => {
  const cursors = createMemoryBillingImportCursorStore();
  let calls = 0;
  const port = {
    async listCustomers(input: { cursor?: string }) {
      calls += 1;
      if (calls === 1) {
        assert.equal(input.cursor, undefined);
        return {
          items: [
            customer({
              id: "cst_1",
              metadata: {
                athenaSubjectId: "user_123",
                athenaSubjectKind: "user",
              },
            }),
          ],
          nextCursor: "page-2",
        };
      }
      assert.equal(input.cursor, "page-2");
      return { items: [], nextCursor: null };
    },
  };
  const bindings = createMemoryBillingImportBindingStore();
  const dir = directory([user("user_123")]);
  await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    cursors,
    directory: dir,
    discovery: port,
    dryRun: false,
  });
  assert.equal(cursors.cursors.get(CONN), "page-2");
  await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    cursors,
    directory: dir,
    discovery: port,
    dryRun: false,
  });
  assert.equal(cursors.cursors.get(CONN), null);
});

test("P?: provider failure preserves safe state", async () => {
  const cursors = createMemoryBillingImportCursorStore();
  cursors.cursors.set(CONN, "keep-me");
  const bindings = createMemoryBillingImportBindingStore();
  await assert.rejects(
    () =>
      runBillingCustomerImport({
        bindings,
        connectionId: CONN,
        cursors,
        directory: directory([]),
        discovery: {
          async listCustomers() {
            throw new Error("upstream");
          },
        },
        dryRun: false,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingImportError &&
      error.code === ATHENA_BILLING_IMPORT_PROVIDER_FAILED
  );
  assert.equal(cursors.cursors.get(CONN), "keep-me");
  assert.equal(bindings.records.length, 0);
});

test("P?: document projection sets resolved ownership", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const documents = createMemoryBillingImportDocumentStore([
    {
      connectionId: CONN,
      id: "pay_1",
      kind: "payment",
      ownershipStatus: "unresolved",
      providerCustomerId: "cst_abc",
    },
    {
      connectionId: CONN,
      id: "sub_1",
      kind: "subscription",
      ownershipStatus: "unresolved",
      providerCustomerId: "cst_abc",
    },
    {
      connectionId: CONN,
      id: "inv_1",
      kind: "invoice",
      ownershipStatus: "unresolved",
      providerCustomerId: "cst_abc",
    },
  ]);
  await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_123")]),
    discovery: discovery([
      customer({
        id: "cst_abc",
        metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
      }),
    ]),
    documents,
    dryRun: false,
  });
  assert.equal(
    documents.documents.every(
      (row) =>
        row.ownershipStatus === "resolved" && row.subject?.id === "user_123"
    ),
    true
  );
});

test("P?: conflicting existing ownership is not overwritten", async () => {
  const documents = createMemoryBillingImportDocumentStore([
    {
      connectionId: CONN,
      id: "inv_a",
      kind: "invoice",
      ownershipStatus: "resolved",
      providerCustomerId: "cst_abc",
      subject: { id: "user_A", kind: "user" },
    },
  ]);
  await runBillingCustomerImport({
    bindings: createMemoryBillingImportBindingStore(),
    connectionId: CONN,
    directory: directory([user("user_B")]),
    discovery: discovery([
      customer({
        id: "cst_abc",
        metadata: { athenaSubjectId: "user_B", athenaSubjectKind: "user" },
      }),
    ]),
    documents,
    dryRun: false,
  });
  assert.equal(documents.documents[0]?.ownershipStatus, "conflict");
  assert.equal(documents.documents[0]?.subject?.id, "user_A");
});

test("P?: unique email is candidate-only unless auto-bind is enabled", async () => {
  const bindings = createMemoryBillingImportBindingStore();
  const report = await runBillingCustomerImport({
    bindings,
    connectionId: CONN,
    directory: directory([user("user_123", "user@example.com")]),
    discovery: discovery([
      customer({ email: "user@example.com", id: "cst_abc" }),
    ]),
    dryRun: false,
  });
  assert.equal(report.plans[0]?.decision, "conflict");
  assert.equal(report.plans[0]?.action, "mark_conflict");
  assert.equal(bindings.records.length, 0);
  assert.equal(bindings.conflicts.length, 1);
});

test("P?: email_snapshot is never used as an ownership lookup", () => {
  const apply = readFileSync(join(srcRoot, "billing/import/apply.ts"), "utf8");
  const importer = readFileSync(
    join(srcRoot, "billing/import/importer.ts"),
    "utf8"
  );
  assert.equal(apply.includes("WHERE email_snapshot"), false);
  assert.equal(importer.includes("WHERE email_snapshot"), false);
  const postgres = readFileSync(
    join(srcRoot, "billing/import/postgres.ts"),
    "utf8"
  );
  assert.equal(postgres.includes("WHERE email_snapshot"), false);
  const sql = readFileSync(
    join(
      srcRoot,
      "migrations/embedded-billing/sql/0002_billing_subject_bindings.sql"
    ),
    "utf8"
  );
  assert.equal(sql.includes("UNIQUE(email"), false);
  const uniqueness = readFileSync(
    join(
      srcRoot,
      "migrations/embedded-billing/sql/0011_billing_subject_binding_uniqueness.sql"
    ),
    "utf8"
  );
  assert.match(uniqueness, /idx_billing_subject_bindings_one_live/);
  assert.match(postgres, /isBillingUniqueViolation/);
});

test("P?: CLI catalog documents reconcile-subjects import flags", () => {
  const catalog = readFileSync(
    join(srcRoot, "cli/commands/billing/catalog.ts"),
    "utf8"
  );
  assert.match(catalog, /reconcile-subjects/);
  assert.match(catalog, /--provider/);
  assert.match(catalog, /--customer/);
  assert.match(catalog, /--include-ambiguous/);
  const parsed = parse([
    "reconcile-subjects",
    "--connection",
    "c1",
    "--dry-run",
    "--json",
  ]);
  assert.equal(parsed.command, "billing-reconcile-subjects");
  if (parsed.command === "billing-reconcile-subjects") {
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.apply, false);
  }
});

test("P?: importer lives under billing/import not Mollie runtime", () => {
  assert.equal(existsSync(join(srcRoot, "billing/import/importer.ts")), true);
  assert.equal(existsSync(join(srcRoot, "billing/import/planner.ts")), true);
  assert.equal(existsSync(join(srcRoot, "billing/import/postgres.ts")), true);
  assert.equal(
    existsSync(join(srcRoot, "billing/import/providers/mollie.ts")),
    true
  );
  const mollieRuntime = readFileSync(
    join(srcRoot, "billing/runtime/local/providers/mollie/runtime.ts"),
    "utf8"
  );
  assert.equal(mollieRuntime.includes("planBillingImport"), false);
  const projected = projectMollieImportCustomer({
    email: "a@example.com",
    id: "cst_1",
    metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
    name: "Ada",
  });
  assert.equal(projected.providerCustomerId, "cst_1");
  assert.equal(projected.email, "a@example.com");
});

test("P?: billing import error codes exist in the catalog", () => {
  const codes = new Set(
    ATHENA_BILLING_ERROR_DESCRIPTORS.map((entry) => entry.code)
  );
  assert.equal(codes.has("billing_import_conflict"), true);
  assert.equal(codes.has("billing_import_ambiguous_subject"), true);
  assert.equal(codes.has("billing_import_provider_failed"), true);
  assert.equal(codes.has("billing_import_subject_not_found"), true);
  assert.equal(codes.has("billing_import_binding_conflict"), true);
  assert.equal(codes.has("billing_import_cursor_invalid"), true);
  const conflict = ATHENA_BILLING_ERROR_DESCRIPTORS.find(
    (entry) => entry.code === "billing_import_conflict"
  );
  assert.equal(conflict?.errorNumber, 4015);
});

test("P?: operations billing exposes customer import not customer settings", () => {
  const ops = readFileSync(
    join(
      pkgRoot,
      "..",
      "athena-auth-ui",
      "src/components/auth/billing/billing-settings.tsx"
    ),
    "utf8"
  );
  const customer = readFileSync(
    join(
      pkgRoot,
      "..",
      "athena-auth-ui",
      "src/components/auth/billing/customer-billing-settings.tsx"
    ),
    "utf8"
  );
  assert.match(ops, /customerImport/);
  const card = readFileSync(
    join(
      pkgRoot,
      "..",
      "athena-auth-ui",
      "src/components/auth/billing/billing-customer-import-card.tsx"
    ),
    "utf8"
  );
  assert.match(card, /Customer import/);
  assert.equal(customer.includes("customerImport"), false);
  assert.equal(customer.includes("billing_import_runs"), false);
});

test("P?: CLI reconcile-subjects run calls the importer engine", async () => {
  const parsed = parse([
    "reconcile-subjects",
    "--connection",
    "c1",
    "--dry-run",
    "--json",
  ]);
  assert.equal(parsed.command, "billing-reconcile-subjects");
  if (parsed.command !== "billing-reconcile-subjects") {
    return;
  }
  let called = false;
  const lines: string[] = [];
  await run(
    {
      capabilities: {
        color: false,
        isTty: false,
        mode: "json",
        quiet: false,
        verbose: false,
      },
      cwd: process.cwd(),
      errorLog: () => undefined,
      globals: {
        debug: false,
        output: "json",
        plain: true,
        strict: false,
        verbosity: "normal",
      },
      log: (message) => {
        lines.push(message);
      },
      logRaw: (message) => {
        lines.push(message);
      },
      output: "json",
      presentation: { noColor: true },
      runtime: {
        runBillingReconcileSubjects: async (input) => {
          called = true;
          assert.equal(input.parsed.connectionId, "c1");
          assert.equal(input.parsed.dryRun, true);
          assert.equal(input.parsed.apply, false);
          return {
            bindingsActivated: 0,
            bindingsCreated: 0,
            conflicts: 0,
            connectionId: "c1",
            customersScanned: 0,
            dryRun: true,
            errors: 0,
            plans: [],
            skipped: 0,
          };
        },
      },
      verbosity: "normal",
    },
    parsed
  );
  assert.equal(called, true);
  assert.equal(
    lines.some((line) => line.includes("billing.reconcile-subjects")),
    true
  );
});

test("P?: postgres import adapter targets bindings runs and candidates", () => {
  const postgres = readFileSync(
    join(srcRoot, "billing/import/postgres.ts"),
    "utf8"
  );
  const audit = readFileSync(join(srcRoot, "billing/import/audit.ts"), "utf8");
  assert.match(postgres, /billing\.billing_subject_bindings/);
  assert.match(postgres, /billing\.billing_import_state/);
  assert.match(postgres, /ownership_status = CASE/);
  assert.match(postgres, /wrapBillingSqlExecutorAsDatabase/);
  assert.equal(postgres.includes("SET ownership_status = 'conflict'"), false);
  assert.match(audit, /billing\.billing_import_runs/);
  assert.match(audit, /billing\.billing_import_candidates/);
  assert.equal(postgres.includes("WHERE email_snapshot"), false);
});

test("P?: apply audit writes running then completed", async () => {
  const audit = createMemoryBillingImportAuditStore();
  const report = await runBillingCustomerImport({
    audit,
    bindings: createMemoryBillingImportBindingStore(),
    connectionId: CONN,
    directory: directory([user("user_123")]),
    discovery: discovery([
      customer({
        id: "cst_abc",
        metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: false,
    provider: "mollie",
  });
  assert.equal(report.bindingsCreated, 1);
  assert.equal(audit.runs[0]?.status, "completed");
  assert.equal(audit.candidates.length, 1);
});

test("P?: dry-run does not write import audit rows", async () => {
  const audit = createMemoryBillingImportAuditStore();
  await runBillingCustomerImport({
    audit,
    bindings: createMemoryBillingImportBindingStore(),
    connectionId: CONN,
    directory: directory([user("user_123")]),
    discovery: discovery([
      customer({
        id: "cst_abc",
        metadata: { athenaSubjectId: "user_123", athenaSubjectKind: "user" },
      }),
    ]),
    dryRun: true,
  });
  assert.equal(audit.runs.length, 0);
  assert.equal(audit.candidates.length, 0);
});

test("P?: automatic import stays off unless enabled", () => {
  assert.equal(shouldAutomaticallyImportBillingCustomers(undefined), false);
  assert.equal(
    shouldAutomaticallyImportBillingCustomers({ enabled: false }),
    false
  );
  assert.equal(
    shouldAutomaticallyImportBillingCustomers({
      enabled: true,
      mode: "manual",
    }),
    false
  );
  assert.equal(
    shouldAutomaticallyImportBillingCustomers({ enabled: true }),
    true
  );
  assert.equal(
    shouldAutomaticallyImportBillingCustomers({
      enabled: true,
      mode: "automatic",
    }),
    true
  );
});
