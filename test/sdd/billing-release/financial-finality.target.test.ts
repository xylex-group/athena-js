import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(new URL("../../..", import.meta.url)));

const DIMENSIONS = [
  "idempotency",
  "concurrency",
  "process-restart",
  "provider-timeout",
  "provider-5xx",
  "database-failure",
  "uncertain-provider-outcome",
  "reconciliation",
  "multi-account-isolation",
] as const;

const FINANCIAL_OPERATIONS = [
  "checkout.create",
  "self.subscription.cancel",
  "self.subscription.change",
  "self.subscription.enroll",
] as const;

const PROOFS = [
  "test/billing-plan-change-crash.test.ts",
  "test/billing-plan-change-durability.test.ts",
  "test/billing-plan-change-recovery.test.ts",
  "test/billing-connection-affinity.test.ts",
  "test/billing-contact-provenance.test.ts",
  "test/sdd/athena-js-billing-checkout-finality.target.test.ts",
  "test/sdd/athena-js-billing-checkout-return-finality.target.test.ts",
  "test/sdd/athena-js-billing-reconciliation-finality.target.test.ts",
  "test/sdd/athena-js-billing-self-subscription-enroll.target.test.ts",
  "test/sdd/athena-js-local-billing-mollie-authority.target.test.ts",
  "test/sdd/athena-js-billing-plan-change-repository.pg.test.ts",
  "test/sdd/athena-js-billing-subscription-schema-finality.pg.test.ts",
  "test/sdd/athena-js-billing-connection-supersession.pg.test.ts",
  "test/sdd/athena-js-billing-webhook-finality.pg.test.ts",
  "test/billing-self-enrollment.test.ts",
] as const;

const RELEASE_CELLS = FINANCIAL_OPERATIONS.flatMap((operation) =>
  DIMENSIONS.map((dimension) => `${operation}/${dimension}`)
);

test("Billing release gate enumerates every required operation and finality dimension", () => {
  assert.deepEqual([...FINANCIAL_OPERATIONS].sort(), [
    "checkout.create",
    "self.subscription.cancel",
    "self.subscription.change",
    "self.subscription.enroll",
  ]);
  assert.equal(RELEASE_CELLS.length, 36);
  assert.equal(new Set(RELEASE_CELLS).size, RELEASE_CELLS.length);
});

test("Billing release gate proof corpus contains all listed concrete proof files", () => {
  for (const proof of PROOFS) {
    assert.equal(existsSync(join(packageRoot, proof)), true, proof);
    const source = readFileSync(join(packageRoot, proof), "utf8");
    assert.ok(source.length > 0, proof);
    assert.match(source, /\btest\s*\(/, `${proof} has no executable test`);
  }
});

test("release CI wires separate Billing financial and Auth schema gates", () => {
  const packageJson = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8")
  ) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:billing-release"],
    "node scripts/run-release-gates.mjs --billing"
  );
  assert.equal(
    packageJson.scripts?.["test:auth-schema-release"],
    "node scripts/run-release-gates.mjs --auth-schema"
  );
  const gate = readFileSync(
    join(packageRoot, "scripts/run-release-gates.mjs"),
    "utf8"
  );
  for (const proof of PROOFS) {
    assert.equal(gate.includes(proof), true, proof);
  }
});

test("release gates fail closed instead of silently skipping PostgreSQL proofs", () => {
  const gate = join(packageRoot, "scripts", "run-release-gates.mjs");
  const result = spawnSync(process.execPath, [gate, "--billing"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ATHENA_BILLING_FINALITY_DATABASE_URL: undefined,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout ?? ""}${result.stderr ?? ""}`,
    /ATHENA_BILLING_FINALITY_DATABASE_URL/
  );
});
