import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_SCHEMA_GENERATION } from "../src/auth/contract/index.ts";
import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";
import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import {
  assertAthenaAuthSchemaCompatible,
  compareAthenaAuthLedgers,
  getAthenaAuthExpectedLedger,
  getAthenaAuthSchemaManifest,
  readAthenaAuthSchemaStatus,
} from "../src/auth/local/schema.ts";
import { ATHENA_AUTH_CANONICAL_MIGRATIONS } from "../src/auth/schema/migrations.ts";
import { checksumMigrationSql } from "../src/migrations/checksum.ts";
import { ATHENA_NPX_MIGRATE_COMMAND } from "../src/migrations/commands.ts";

const CANONICAL_033_CHECKSUM =
  "483af951e47a72cdffb6b8a21f5878a1e9c2ce250079e7535bad35a47d5a1418";
const ATHENA_570_033_CHECKSUM =
  "044557ff8b79810d05e43f4fb9f0203e42b68ad0ea9c62c4e1c1970440a6b764";

function createLedgerDatabase(
  rows: Array<{ checksum?: string | null; name?: string; version: number }>
): AthenaAuthDatabase {
  return {
    async close() {},
    inTransaction: false,
    async query(text) {
      if (/auth_schema_migrations/i.test(text)) {
        return { rowCount: rows.length, rows };
      }
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

test("T-schema-history: missing-middle ledger is not compatible", async () => {
  const database = createLedgerDatabase([
    { name: "001_create_core_tables", version: 1 },
    { name: "002_create_organization_tables", version: 2 },
    { name: "021_runtime_key_and_ledger", version: 21 },
  ]);

  const status = await readAthenaAuthSchemaStatus(database);
  assert.equal(status.current, 21);
  assert.equal(status.expected, ATHENA_AUTH_SCHEMA_GENERATION);
  assert.equal(status.compatible, false);
  assert.equal(status.direction, "history-diverged");
  assert.ok(status.missing?.includes(4));
  assert.ok(status.missing?.includes(5));

  await assert.rejects(
    () => assertAthenaAuthSchemaCompatible(database),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_SCHEMA_DRIFT" &&
      error.publicMessage.includes(ATHENA_NPX_MIGRATE_COMMAND) &&
      /004_create_api_key_table|missing/i.test(error.publicMessage)
  );
});

test("T-schema-history: checksum mismatch is history-diverged", async () => {
  const database = createLedgerDatabase([
    {
      checksum: "deadbeef",
      name: "001_create_core_tables",
      version: 1,
    },
    {
      checksum: "deadbeef",
      name: "002_create_organization_tables",
      version: 2,
    },
    {
      checksum: "deadbeef",
      name: "003_create_two_factor_table",
      version: 3,
    },
    {
      checksum: "deadbeef",
      name: "004_create_api_key_table",
      version: 4,
    },
    {
      checksum: "deadbeef",
      name: "005_create_passkey_table",
      version: 5,
    },
    {
      checksum: "deadbeef",
      name: "006_create_email_send_failures_table",
      version: 6,
    },
    {
      checksum: "deadbeef",
      name: "007_create_emails_table",
      version: 7,
    },
    {
      checksum: "deadbeef",
      name: "009_add_last_sign_in_at_to_users",
      version: 9,
    },
    {
      checksum: "deadbeef",
      name: "011_create_email_templates_table",
      version: 11,
    },
    {
      checksum: "deadbeef",
      name: "012_email_multitenancy_admin_ops",
      version: 12,
    },
    {
      checksum: "deadbeef",
      name: "014_email_event_types_and_template_assignment",
      version: 14,
    },
    {
      checksum: "deadbeef",
      name: "015_email_template_attachments",
      version: 15,
    },
    {
      checksum: "deadbeef",
      name: "021_runtime_key_and_ledger",
      version: 21,
    },
  ]);

  const status = await readAthenaAuthSchemaStatus(database);
  assert.equal(status.compatible, false);
  assert.equal(status.direction, "history-diverged");
  assert.ok((status.checksumMismatch ?? []).includes(1));

  await assert.rejects(
    () => assertAthenaAuthSchemaCompatible(database),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_SCHEMA_DRIFT" &&
      error.publicMessage.includes(ATHENA_NPX_MIGRATE_COMMAND)
  );
});

test("T-schema-history: exact checksummed ledger is compatible", async () => {
  const ledger = getAthenaAuthExpectedLedger();
  const database = createLedgerDatabase(ledger);
  const status = await readAthenaAuthSchemaStatus(database);
  assert.equal(status.compatible, true);
  assert.equal(status.direction, "current");
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.checksumMismatch, []);
  await assertAthenaAuthSchemaCompatible(database);
});

test("T-schema-history: canonical migration 033 remains issuer-only and 047 transitions to composite", () => {
  const migration033 = ATHENA_AUTH_CANONICAL_MIGRATIONS.find(
    (entry) => entry.version === 33
  );
  const migration047 = ATHENA_AUTH_CANONICAL_MIGRATIONS.find(
    (entry) => entry.version === 47
  );
  assert.ok(migration033);
  assert.ok(migration047);
  assert.equal(checksumMigrationSql(migration033.sql), CANONICAL_033_CHECKSUM);
  assert.match(migration033.sql, /ON athena\.auth_signing_keys\s+\(issuer\)/);
  assert.doesNotMatch(
    migration033.sql,
    /ON athena\.auth_signing_keys\s+\(issuer\s*,\s*algorithm\)/
  );
  assert.match(
    migration047.sql,
    /ON athena\.auth_signing_keys\s+\(issuer, algorithm\)/
  );

  const expected = getAthenaAuthSchemaManifest();
  assert.equal(expected["033"], CANONICAL_033_CHECKSUM);
});

test("T-schema-history: accepts only the exact Athena 5.7.0 migration 033 checksum alias", () => {
  const expected = [
    {
      checksum: CANONICAL_033_CHECKSUM,
      name: "033_auth_signing_keys",
      version: 33,
    },
  ];
  const compatible = compareAthenaAuthLedgers(
    [{ checksum: ATHENA_570_033_CHECKSUM, version: 33 }],
    expected
  );
  assert.equal(compatible.compatible, true);
  assert.deepEqual(compatible.checksumMismatch, []);

  const corrupt = compareAthenaAuthLedgers(
    [{ checksum: "deadbeef", version: 33 }],
    expected
  );
  assert.equal(corrupt.compatible, false);
  assert.equal(corrupt.direction, "history-diverged");
  assert.deepEqual(corrupt.checksumMismatch, [33]);

  const wrongVersion = compareAthenaAuthLedgers(
    [{ checksum: ATHENA_570_033_CHECKSUM, version: 34 }],
    [
      {
        checksum:
          "c1a4b64c48205a33c3a51e5c036655ff527e084072e75fce525a8760b31366a4",
        name: "034_email_failure_provenance",
        version: 34,
      },
    ]
  );
  assert.equal(wrongVersion.compatible, false);
  assert.equal(wrongVersion.direction, "history-diverged");
  assert.deepEqual(wrongVersion.checksumMismatch, [34]);
});

test("T-schema-history: arbitrary migration 033 checksum is reported as schema drift", async () => {
  const database = createLedgerDatabase([
    { checksum: "deadbeef", name: "033_auth_signing_keys", version: 33 },
  ]);
  const status = await readAthenaAuthSchemaStatus(database);
  assert.equal(status.compatible, false);
  assert.equal(status.direction, "history-diverged");
  assert.deepEqual(status.checksumMismatch, [33]);
  await assert.rejects(
    () => assertAthenaAuthSchemaCompatible(database),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_SCHEMA_DRIFT"
  );
});

test("T-schema-history: committed manifest matches expected ledger checksums", () => {
  const computed = getAthenaAuthSchemaManifest();
  const ledger = getAthenaAuthExpectedLedger();
  const manifestPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../contracts/auth/schema-migrations.manifest.json"
  );
  const committed = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    string
  >;
  assert.deepEqual(committed, computed);
  for (const entry of ledger) {
    assert.match(entry.checksum ?? "", /^[0-9a-f]{64}$/);
  }
});
