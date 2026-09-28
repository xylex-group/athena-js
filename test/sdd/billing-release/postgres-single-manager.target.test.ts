/**
 * RED: one PostgresPoolManager per root; Billing/Ingress must borrow it.
 */

import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { test } from "node:test";
import { collectTs, readSrc, srcRoot } from "./helpers.ts";

const MANAGER_FACTORY_ALLOWLIST = new Set([
  "src/postgres/owned-runtime.ts",
  "src/postgres/pool/manager.ts",
]);

test("root AthenaClientOwnedRuntime exposes getPoolManager", () => {
  const internals = readSrc("runtime", "client-internals.ts");
  assert.match(
    internals,
    /interface AthenaClientOwnedRuntime[\s\S]*getPoolManager\(\)/
  );
});

test("Event Ingress does not construct a manager from a raw pool", () => {
  const ingress = readSrc("runtime", "ingress", "postgres.ts");
  assert.equal(ingress.includes("createPostgresPoolManager"), false);
  assert.equal(ingress.includes("eventIngressDatabaseFromPool"), false);
  assert.match(ingress, /eventIngressDatabaseFromManager/);
});

test("Billing import does not construct a manager from a raw pool", () => {
  const database = readSrc("billing", "import", "database.ts");
  assert.equal(database.includes("createPostgresPoolManager"), false);
  assert.equal(database.includes("createBillingImportDatabase("), false);
  assert.match(database, /createBillingImportDatabaseFromManager/);
});

test("production ingress/observability never pass a pool into createBillingSqlExecutor", () => {
  const files = [
    readSrc("next", "billing-ingress-handlers.ts"),
    readSrc("billing", "ingestion", "observability", "from-internals.ts"),
    readSrc("billing", "runtime", "local", "ingress", "attach.ts"),
  ];
  for (const source of files) {
    assert.equal(
      /createBillingSqlExecutor\(\s*pool\s*\)/.test(source),
      false,
      "createBillingSqlExecutor(pool) uses the raw pool.query path"
    );
  }
});

test("createPostgresPoolManager imports stay on ownership factories", () => {
  const violations: string[] = [];
  for (const file of collectTs(srcRoot)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("createPostgresPoolManager")) {
      continue;
    }
    const rel = relative(srcRoot, file).replaceAll("\\", "/");
    const key = `src/${rel}`;
    if (MANAGER_FACTORY_ALLOWLIST.has(key)) {
      continue;
    }
    if (rel.includes(".test.")) {
      continue;
    }
    violations.push(key);
  }
  assert.deepEqual(violations, []);
});

test("billing and ingress constructors do not take a raw AthenaPostgresPool", () => {
  const violations: string[] = [];
  for (const file of collectTs(srcRoot)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(srcRoot, file).replaceAll("\\", "/");
    if (
      !(
        rel.startsWith("billing/") ||
        rel.startsWith("next/billing") ||
        rel.startsWith("runtime/ingress/")
      )
    ) {
      continue;
    }
    if (/\(\s*pool\s*:\s*AthenaPostgresPool/.test(text)) {
      violations.push(`src/${rel}`);
    }
  }
  assert.deepEqual(violations, []);
});
