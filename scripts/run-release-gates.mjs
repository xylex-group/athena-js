#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const billingFiles = [
  "test/sdd/billing-release/financial-finality.target.test.ts",
  "test/sdd/billing-release/workflow-layout.target.test.ts",
  "test/sdd/athena-js-billing-checkout-finality.target.test.ts",
  "test/sdd/athena-js-billing-checkout-return-finality.target.test.ts",
  "test/sdd/athena-js-billing-self-subscription-enroll.target.test.ts",
  "test/sdd/athena-js-billing-plan-change-repository.pg.test.ts",
  "test/sdd/athena-js-billing-subscription-schema-finality.pg.test.ts",
  "test/sdd/athena-js-billing-connection-supersession.pg.test.ts",
  "test/sdd/athena-js-billing-webhook-finality.pg.test.ts",
  "test/billing-plan-change-crash.test.ts",
  "test/billing-plan-change-recovery.test.ts",
  "test/billing-plan-change-durability.test.ts",
  "test/billing-self-enrollment.test.ts",
  "test/billing-connection-affinity.test.ts",
  "test/billing-contact-provenance.test.ts",
  "test/sdd/athena-js-billing-reconciliation-finality.target.test.ts",
  "test/sdd/athena-js-local-billing-mollie-authority.target.test.ts",
];

const authSchemaFiles = [
  "test/sdd/billing-release/auth-schema-release.target.test.ts",
  "test/sdd/billing-release/upgrade-fixtures.target.test.ts",
  "test/auth-schema-catalog-finality.test.ts",
  "test/sdd/athena-js-embedded-sql-migrate.pg.test.ts",
];

const mode = process.argv[2];
const files =
  mode === "--billing"
    ? billingFiles
    : mode === "--auth-schema"
      ? authSchemaFiles
      : undefined;
if (!files) {
  console.error(
    "Usage: node scripts/run-release-gates.mjs --billing|--auth-schema"
  );
  process.exit(2);
}

const requiredDatabaseEnvironment =
  mode === "--billing"
    ? "ATHENA_BILLING_FINALITY_DATABASE_URL"
    : "ATHENA_AUTH_FINALITY_DATABASE_URL";
const requiredDatabaseUrl = process.env[requiredDatabaseEnvironment]?.trim();
if (
  !requiredDatabaseUrl ||
  !/^postgres(ql)?:\/\//i.test(requiredDatabaseUrl)
) {
  console.error(
    `${mode} release gate requires ${requiredDatabaseEnvironment} to execute PostgreSQL proofs.`
  );
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "./test/register-server-only.mjs",
    "--import",
    "tsx",
    "--test",
    "--test-force-exit",
    "--test-concurrency=1",
    ...files,
  ],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
    shell: false,
  }
);

process.exit(result.status ?? 1);
