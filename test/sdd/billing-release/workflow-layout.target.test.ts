import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(new URL("../../..", import.meta.url)));
const workflowRoot = join(packageRoot, "src/billing/workflows/plan-change");

const WORKFLOW_FILES = [
  "change-operation.ts",
  "plan-change-coordinator.ts",
  "plan-change-reconciliation.ts",
  "plan-change-recovery.ts",
  "plan-change-repository.ts",
  "plan-change-state.ts",
  "provider-effect-repository.ts",
] as const;

test("plan-change semantics have one billing workflow source", () => {
  for (const filename of WORKFLOW_FILES) {
    assert.equal(existsSync(join(workflowRoot, filename)), true, filename);
  }
  assert.equal(
    existsSync(
      join(packageRoot, "src/billing/runtime/self/plan-change-saga.ts")
    ),
    false
  );
  assert.equal(
    existsSync(join(packageRoot, "src/billing/subject/connection-resolver.ts")),
    false
  );
});

test("plan-change callers use the workflow source rather than request-owned saga helpers", () => {
  const change = readFileSync(
    join(packageRoot, "src/billing/runtime/self/change.ts"),
    "utf8"
  );
  assert.match(change, /workflows\/plan-change/);
  assert.doesNotMatch(change, /plan-change-saga/);
  const soleConnection = readFileSync(
    join(packageRoot, "src/billing/subject/sole-connection.ts"),
    "utf8",
  );
  assert.doesNotMatch(soleConnection, /resolveSoleActiveBillingConnectionId/);
});
