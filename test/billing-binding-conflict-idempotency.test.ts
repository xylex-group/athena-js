import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyBillingImportPlan,
  createMemoryBillingImportBindingStore,
} from "../src/billing/import/apply.ts";
import { planBillingImport } from "../src/billing/import/planner.ts";
import { createPostgresBillingImportBindingStore } from "../src/billing/import/postgres.ts";
import { DEFAULT_BILLING_IMPORT_POLICY } from "../src/billing/import/types.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function uniqueEmailConflictPlan() {
  return planBillingImport({
    connectionId: "d903bb81-3ead-4af9-bdba-5c9d640aef5c",
    customer: {
      email: "user@example.com",
      metadata: {},
      name: null,
      providerCustomerId: "cst_SCmie2445R",
      raw: {},
    },
    directorySubject: null,
    documentHints: [],
    emailMatches: [
      {
        email: "user@example.com",
        subject: { id: "user_1", kind: "user" },
      },
    ],
    existingLocator: null,
    existingPrimary: null,
    policy: DEFAULT_BILLING_IMPORT_POLICY,
  });
}

test("embedded billing 0036 is catalogued as conflict identity finality", () => {
  const catalog = readFileSync(
    join(pkgRoot, "src", "migrations", "embedded-billing", "catalog.ts"),
    "utf8"
  );
  assert.match(catalog, /0036_billing_binding_conflict_identity\.sql/);
  assert.match(catalog, /version: 36/);
  const sql = readFileSync(
    join(
      pkgRoot,
      "src",
      "migrations",
      "embedded-billing",
      "sql",
      "0036_billing_binding_conflict_identity.sql"
    ),
    "utf8"
  );
  assert.match(sql, /uq_billing_binding_conflicts_open_identity/);
  assert.match(sql, /system:conflict-deduplication/);
  assert.match(sql, /last_observed_at/);
  assert.match(sql, /observation_count/);
});

test("recordConflict upserts the open conflict identity", () => {
  const src = readFileSync(
    join(pkgRoot, "src", "billing", "import", "postgres.ts"),
    "utf8"
  );
  assert.match(src, /ON CONFLICT \(/);
  assert.match(src, /identity_subject_kind/);
  assert.match(
    src,
    /observation_count = billing\.billing_binding_conflicts\.observation_count \+ 1/
  );
});

test("repeated unique-email conflicts stay one open row", async () => {
  const store = createMemoryBillingImportBindingStore();
  const plan = uniqueEmailConflictPlan();
  assert.equal(plan.action, "mark_conflict");
  assert.equal(plan.reason, "unique email candidate only");
  await applyBillingImportPlan(store, { plan });
  await applyBillingImportPlan(store, { plan });
  await applyBillingImportPlan(store, { plan });
  assert.equal(store.conflicts.length, 1);
  assert.equal(store.conflicts[0]?.observationCount, 3);
  assert.equal(store.conflicts[0]?.providerCustomerId, "cst_SCmie2445R");
});

test("createPostgresBillingImportBindingStore recordConflict uses the open identity index", async () => {
  const statements: string[] = [];
  const store = createPostgresBillingImportBindingStore({
    async query(sql) {
      statements.push(sql);
      return { rows: [] };
    },
  });
  await store.recordConflict?.({
    confidence: "strong",
    connectionId: "d903bb81-3ead-4af9-bdba-5c9d640aef5c",
    providerCustomerId: "cst_SCmie2445R",
    reason: "manual_review_required",
    subject: { id: "user_1", kind: "user" },
  });
  assert.equal(statements.length, 1);
  assert.match(statements[0] ?? "", /ON CONFLICT/);
  assert.match(statements[0] ?? "", /WHERE status = 'open'/);
});
