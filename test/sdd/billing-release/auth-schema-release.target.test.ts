import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(new URL("../../..", import.meta.url)));

const AUTH_SCHEMA_RELEASE_PROOFS = {
  appendOnlyHistory: [
    "test/auth-migration-history.test.ts",
    "test/auth-schema-release-lock.test.ts",
  ],
  dataPreservation: [
    "test/sdd/athena-js-embedded-sql-migrate.pg.test.ts",
    "test/auth-schema-catalog-finality.test.ts",
  ],
  driftDetection: ["test/auth-schema-catalog-finality.test.ts"],
  freshInstall: ["test/sdd/athena-js-embedded-sql-migrate.pg.test.ts"],
  historicalChecksumCohorts: [
    "test/auth-local-schema-history.test.ts",
    "test/sdd/athena-js-embedded-sql-migrate.pg.test.ts",
  ],
  idempotency: [
    "test/sdd/athena-js-embedded-sql-migrate.pg.test.ts",
    "test/auth-schema-catalog-finality.test.ts",
  ],
  ledgerDivergence: ["test/auth-schema-catalog-finality.test.ts"],
  multiRole: [
    "test/sdd/athena-js-embedded-sql-migrate.pg.test.ts",
    "test/auth-schema-catalog-finality.test.ts",
  ],
  nMinusOneUpgrade: ["test/sdd/athena-js-embedded-sql-migrate.pg.test.ts"],
  remediation: ["test/auth-schema-catalog-finality.test.ts"],
} as const;

test("Auth schema release gate enumerates every schema proof", () => {
  for (const [proofKind, proofs] of Object.entries(
    AUTH_SCHEMA_RELEASE_PROOFS
  )) {
    assert.ok(proofs.length > 0, `${proofKind} has no proof`);
    for (const proof of proofs) {
      assert.equal(
        existsSync(join(packageRoot, proof)),
        true,
        `${proofKind}: ${proof}`
      );
    }
  }
});

test("Auth release proof upgrades an older physical generation to current", () => {
  const source = readFileSync(
    join(packageRoot, "test/sdd/athena-js-embedded-sql-migrate.pg.test.ts"),
    "utf8"
  );
  assert.match(source, /physical Auth generation 34 upgrades to current/);
  assert.match(source, /prepareAuthGeneration\(database, 34\)/);
  assert.match(
    source,
    /operationTimeoutMs:\s*ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS/
  );
  assert.match(source, /migrateAthenaAuthSchema/);
  assert.doesNotMatch(source, /DELETE FROM athena\.auth_schema_migrations/);
});

test("Auth schema release proof includes drift, divergence, and canonical remediation", () => {
  const source = readFileSync(
    join(packageRoot, "test/auth-schema-catalog-finality.test.ts"),
    "utf8"
  );
  assert.match(source, /physicalSchemaDrift/);
  assert.match(source, /compareAthenaAuthLedgers/);
  assert.match(source, /ATHENA_NPX_MIGRATE_COMMAND/);
  assert.match(source, /ATHENA_MIGRATE_REPAIR_YES_COMMAND/);
});

test("Auth schema release proof includes exact 5.7.0 history cohorts and append-only enforcement", () => {
  const migrationSource = readFileSync(
    join(packageRoot, "test/sdd/athena-js-embedded-sql-migrate.pg.test.ts"),
    "utf8"
  );
  const historySource = readFileSync(
    join(packageRoot, "test/auth-migration-history.test.ts"),
    "utf8"
  );
  assert.match(migrationSource, /pre-5\.7\.0 generation 45/);
  assert.match(migrationSource, /Athena JS 5\.7\.0 history is accepted/);
  assert.match(migrationSource, /fresh installation records canonical 033/);
  assert.match(
    migrationSource,
    /arbitrary migration 033 receipt still fails closed/
  );
  assert.match(historySource, /one-time 5\.7\.0 correction/);
  assert.match(historySource, /insertions before released versions/);
});
