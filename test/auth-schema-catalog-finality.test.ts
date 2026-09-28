import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
  inspectAthenaAuthSchema,
  listAthenaAuthCanonicalMigrations,
  migrateAthenaAuthSchema,
} from "../src/auth/local/schema.ts";
import {
  ATHENA_AUTH_MIGRATION_EXPECTATIONS,
  type SchemaExpectation,
} from "../src/auth/local/schema-manifest.ts";
import {
  ATHENA_AUTH_CANONICAL_MIGRATIONS,
  ATHENA_AUTH_LATEST_MIGRATION,
} from "../src/auth/schema/migrations.ts";
import {
  ATHENA_MIGRATE_COMMAND,
  ATHENA_MIGRATE_REPAIR_COMMAND,
  ATHENA_MIGRATE_REPAIR_YES_COMMAND,
  ATHENA_NPX_MIGRATE_COMMAND,
} from "../src/migrations/commands.ts";
import {
  AUTHORIZATION_CATALOG_VERSION,
  authorizationRightsFingerprint,
  authorizationRolesFingerprint,
} from "../src/runtime/authorization/catalog-state.ts";
import { createObservingAuthDatabase } from "./auth-schema-observer.ts";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("package source never recommends the nonexistent athena-js package", () => {
  const source = sourceFiles(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src")
  )
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert.doesNotMatch(source, /@xylex-group\/athena-js/);
});

test("migration remediation commands use the canonical package and binary", () => {
  assert.equal(ATHENA_MIGRATE_COMMAND, "athena-js migrate");
  assert.equal(ATHENA_NPX_MIGRATE_COMMAND, "npx @xylex-group/athena migrate");
  assert.equal(ATHENA_MIGRATE_REPAIR_COMMAND, "athena-js migrate repair");
  assert.equal(
    ATHENA_MIGRATE_REPAIR_YES_COMMAND,
    "athena-js migrate repair --yes"
  );
});

test("Auth generation is derived from the latest canonical migration", () => {
  const versions = ATHENA_AUTH_CANONICAL_MIGRATIONS.map(
    (migration) => migration.version
  );
  const names = ATHENA_AUTH_CANONICAL_MIGRATIONS.map(
    (migration) => migration.name
  );
  const latest = ATHENA_AUTH_CANONICAL_MIGRATIONS.at(-1);

  assert.ok(latest);
  assert.equal(ATHENA_AUTH_LATEST_MIGRATION, latest);
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION, latest.version);
  assert.deepEqual(
    versions,
    [...versions].sort((left, right) => left - right)
  );
  assert.equal(new Set(versions).size, versions.length);
  assert.equal(new Set(names).size, names.length);
  assert.equal(latest.name, "045_session_authentication_context");
  assert.deepEqual(
    listAthenaAuthCanonicalMigrations().map(({ name, version }) => ({
      name,
      version,
    })),
    ATHENA_AUTH_CANONICAL_MIGRATIONS.map(({ name, version }) => ({
      name,
      version,
    }))
  );
  assert.deepEqual(
    getAthenaAuthExpectedLedger().map(({ name, version }) => ({
      name,
      version,
    })),
    ATHENA_AUTH_CANONICAL_MIGRATIONS.map(({ name, version }) => ({
      name,
      version,
    }))
  );
});

test("generation-35 Auth migration protects multi-role primary keys and supporting indexes", () => {
  const expectations = ATHENA_AUTH_MIGRATION_EXPECTATIONS[35];
  const objects = new Set(
    expectations?.map((expectation) => expectation.object)
  );

  for (const object of [
    "athena.authorization_user_roles.authorization_user_roles_pkey",
    "athena.authorization_member_roles.authorization_member_roles_pkey",
    "athena.idx_authorization_user_roles_user",
    "athena.idx_authorization_member_roles_member",
  ]) {
    assert.equal(objects.has(object), true, object);
  }
  assert.deepEqual(
    expectations
      ?.filter((expectation) => expectation.kind === "constraint")
      .map((expectation) => expectation.definition),
    ["PRIMARY KEY (user_id, role_id)", "PRIMARY KEY (member_id, role_id)"]
  );
});

test("generation-37 Auth migration protects API-key scope constraints", () => {
  const expectations = ATHENA_AUTH_MIGRATION_EXPECTATIONS[37] ?? [];
  assert.deepEqual(
    expectations
      .filter((expectation) => expectation.kind === "constraint")
      .map((expectation) => [expectation.name, expectation.definition]),
    [
      ["api_keys_organization_id_fkey", undefined],
      [
        "api_keys_scope_kind_check",
        "CHECK (((scope_kind = 'organization'::text) AND (organization_id IS NOT NULL)) OR ((scope_kind = ANY (ARRAY['legacy'::text, 'platform'::text])) AND (organization_id IS NULL)))",
      ],
    ]
  );
});

test("Auth ledger reports the latest migration as missing", () => {
  const expected = getAthenaAuthExpectedLedger();
  const previous = expected.filter(
    (entry) => entry.version < ATHENA_AUTH_SCHEMA_GENERATION
  );
  const status = compareAthenaAuthLedgers(previous);

  assert.equal(status.current, expected.at(-2)?.version);
  assert.equal(status.expected, ATHENA_AUTH_SCHEMA_GENERATION);
  assert.deepEqual(status.missing, [ATHENA_AUTH_SCHEMA_GENERATION]);
  assert.equal(status.direction, "upgrade-required");
});

test("Auth outdated diagnostics name the latest missing migration", async () => {
  const expected = getAthenaAuthExpectedLedger();
  const previous = expected.filter(
    (entry) => entry.version < ATHENA_AUTH_SCHEMA_GENERATION
  );
  const database: AthenaAuthDatabase = {
    async close() {},
    inTransaction: false,
    async query<T = Record<string, unknown>>(text: string) {
      if (/auth_schema_migrations/i.test(text)) {
        return { rowCount: previous.length, rows: previous as T[] };
      }
      return { rowCount: 0, rows: [] as T[] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };

  await assert.rejects(
    () => assertAthenaAuthSchemaCompatible(database),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_SCHEMA_OUTDATED" &&
      error.publicMessage.includes(ATHENA_NPX_MIGRATE_COMMAND) &&
      error.publicMessage.includes("045_session_authentication_context")
  );
});

test("Auth readiness separates matching ledger generation from physical schema drift", async () => {
  const expected = getAthenaAuthExpectedLedger();
  const database: AthenaAuthDatabase = {
    async close() {},
    inTransaction: false,
    async query<T = Record<string, unknown>>(text: string) {
      if (/to_regclass/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{ oid: "auth_schema_migrations" }] as T[],
        };
      }
      if (/auth_schema_migrations/i.test(text)) {
        return { rowCount: expected.length, rows: expected as T[] };
      }
      return { rowCount: 0, rows: [] as T[] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };

  const readiness = await inspectAthenaAuthSchema(database);

  assert.equal(readiness.currentGeneration, ATHENA_AUTH_SCHEMA_GENERATION);
  assert.equal(readiness.requiredGeneration, ATHENA_AUTH_SCHEMA_GENERATION);
  assert.deepEqual(readiness.missingMigrations, []);
  assert.equal(readiness.physicalSchemaValid, false);
  assert.equal(readiness.ready, false);
  assert.ok(
    readiness.physicalSchemaDrift.some(
      (item) =>
        item.object ===
        "athena.authorization_user_roles.authorization_user_roles_pkey"
    )
  );
  await assert.rejects(
    () => assertAthenaAuthSchemaCompatible(database, { inspectSchema: true }),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_SCHEMA_INVALID" &&
      error.publicMessage.includes(ATHENA_MIGRATE_REPAIR_YES_COMMAND)
  );
});

test("Auth readiness batches physical catalog inspection across migration expectations", async () => {
  const database = createObservingAuthDatabase({
    ledger: getAthenaAuthExpectedLedger(),
    physical: true,
  });

  await inspectAthenaAuthSchema(database);

  const once = [
    /FROM pg_catalog\.pg_namespace/i,
    /SELECT table_schema, table_name\s+FROM information_schema\.tables/i,
    /SELECT table_schema, table_name, column_name/i,
    /SELECT schemaname, indexname/i,
    /SELECT table_schema, table_name, constraint_name/i,
    /SELECT n\.nspname AS table_schema/i,
  ];
  for (const pattern of once) {
    assert.equal(
      database.statements.filter((statement) => pattern.test(statement)).length,
      1,
      String(pattern)
    );
  }
});

test("Auth readiness rejects missing migration-37 API-key constraints", async () => {
  const readiness = await inspectAthenaAuthSchema(
    createObservingAuthDatabase({
      ledger: getAthenaAuthExpectedLedger(),
      physical: true,
      physicalConstraints: {
        omit: ["api_keys_organization_id_fkey", "api_keys_scope_kind_check"],
      },
    })
  );

  assert.equal(readiness.physicalSchemaValid, false);
  assert.ok(
    readiness.physicalSchemaDrift.filter(
      (item) => item.kind === "missing-constraint"
    ).length >= 2
  );
});

test("Auth readiness rejects altered migration-37 API-key constraints", async () => {
  const readiness = await inspectAthenaAuthSchema(
    createObservingAuthDatabase({
      ledger: getAthenaAuthExpectedLedger(),
      physical: true,
      physicalConstraints: {
        definitions: {
          api_keys_scope_kind_check: "CHECK (scope_kind IS NOT NULL)",
        },
        foreignKeys: {
          api_keys_organization_id_fkey: { onDelete: "set-null" },
        },
      },
    })
  );

  assert.equal(readiness.physicalSchemaValid, false);
  assert.ok(
    readiness.physicalSchemaDrift.filter(
      (item) => item.kind === "constraint-mismatch"
    ).length >= 2
  );
});

test("Auth readiness accepts a correctly bound FK when PostgreSQL deparses its schema unqualified", async () => {
  const readiness = await inspectAthenaAuthSchema(
    createObservingAuthDatabase({
      ledger: getAthenaAuthExpectedLedger(),
      physical: true,
      physicalConstraints: {
        definitions: {
          api_keys_scope_kind_check:
            "CHECK (((scope_kind = 'organization'::text) AND (organization_id IS NOT NULL)) OR ((scope_kind = ANY (ARRAY['legacy'::text, 'platform'::text])) AND (organization_id IS NULL)))",
        },
      },
    })
  );

  assert.equal(
    readiness.physicalSchemaDrift.some(
      (item) => item.object === "athena.api_keys.api_keys_organization_id_fkey"
    ),
    false
  );
});

test("Auth readiness rejects a structurally different FK reference", async () => {
  const readiness = await inspectAthenaAuthSchema(
    createObservingAuthDatabase({
      ledger: getAthenaAuthExpectedLedger(),
      physical: true,
      physicalConstraints: {
        foreignKeys: {
          api_keys_organization_id_fkey: { referencedSchema: "public" },
        },
      },
    })
  );

  assert.ok(
    readiness.physicalSchemaDrift.some(
      (item) =>
        item.kind === "constraint-mismatch" &&
        item.object === "athena.api_keys.api_keys_organization_id_fkey"
    )
  );
});

test("Auth readiness rejects a structurally different FK delete action", async () => {
  const readiness = await inspectAthenaAuthSchema(
    createObservingAuthDatabase({
      ledger: getAthenaAuthExpectedLedger(),
      physical: true,
      physicalConstraints: {
        foreignKeys: {
          api_keys_organization_id_fkey: { onDelete: "set-null" },
        },
      },
    })
  );

  assert.ok(
    readiness.physicalSchemaDrift.some(
      (item) =>
        item.kind === "constraint-mismatch" &&
        item.object === "athena.api_keys.api_keys_organization_id_fkey"
    )
  );
});

test("Auth readiness rejects a structurally different FK update action", async () => {
  const readiness = await inspectAthenaAuthSchema(
    createObservingAuthDatabase({
      ledger: getAthenaAuthExpectedLedger(),
      physical: true,
      physicalConstraints: {
        foreignKeys: {
          api_keys_organization_id_fkey: { onUpdate: "cascade" },
        },
      },
    })
  );

  assert.ok(
    readiness.physicalSchemaDrift.some(
      (item) =>
        item.kind === "constraint-mismatch" &&
        item.object === "athena.api_keys.api_keys_organization_id_fkey"
    )
  );
});

function rowsForExpectations<T extends Record<string, string>>(
  expectations: readonly SchemaExpectation[],
  kind: SchemaExpectation["kind"],
  map: (parts: string[]) => T
): T[] {
  return expectations
    .filter((expectation) => expectation.kind === kind)
    .map((expectation) => map(expectation.object.split(".")));
}

function createMigratingAuthDatabase(): AthenaAuthDatabase {
  let ledger = getAthenaAuthExpectedLedger().filter(
    (entry) => entry.version < ATHENA_AUTH_SCHEMA_GENERATION
  );
  const expectations = Object.values(ATHENA_AUTH_MIGRATION_EXPECTATIONS).flat();

  return {
    async close() {},
    inTransaction: false,
    async query<T = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[]
    ) {
      if (/pg_advisory_(?:xact_)?lock|pg_advisory_unlock/i.test(text)) {
        return { rowCount: 1, rows: [{ acquired: true }] as T[] };
      }
      if (/authorization_catalog_state/i.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              catalog_version: AUTHORIZATION_CATALOG_VERSION,
              rights_fingerprint: authorizationRightsFingerprint(),
              roles_fingerprint: authorizationRolesFingerprint(),
            },
          ] as T[],
        };
      }
      if (/to_regclass/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{ oid: "auth_schema_migrations" }] as T[],
        };
      }
      if (
        /information_schema\.columns/i.test(text) &&
        /auth_schema_migrations/i.test(text)
      ) {
        return {
          rowCount: 1,
          rows: [{ column_name: "checksum" }] as T[],
        };
      }
      if (/INSERT INTO athena\.auth_schema_migrations/i.test(text) && values) {
        const version = Number(values[0]);
        const entry = getAthenaAuthExpectedLedger().find(
          (candidate) => candidate.version === version
        );
        if (
          entry &&
          !ledger.some((candidate) => candidate.version === version)
        ) {
          ledger = [...ledger, entry];
        }
        return { rowCount: 1, rows: [] as T[] };
      }
      if (/auth_schema_migrations/i.test(text)) {
        return { rowCount: ledger.length, rows: ledger as T[] };
      }
      if (
        /pg_catalog\.pg_constraint/i.test(text) &&
        /referenced_schema/i.test(text)
      ) {
        const foreignKey = ATHENA_AUTH_MIGRATION_EXPECTATIONS[37]?.find(
          (expectation) => expectation.name === "api_keys_organization_id_fkey"
        );
        const definition = foreignKey?.foreignKey;
        const rows = definition
          ? [
              {
                columns: [...definition.columns],
                condeferrable: false,
                condeferred: false,
                confdeltype: "c",
                confmatchtype: "s",
                confupdtype: "a",
                constraint_name: foreignKey.name,
                referenced_columns: [...definition.references.columns],
                referenced_schema: definition.references.schema,
                referenced_table: definition.references.table,
                table_name: "api_keys",
                table_schema: "athena",
              },
            ]
          : [];
        return { rowCount: rows.length, rows: rows as T[] };
      }
      if (/pg_catalog\.pg_constraint/i.test(text)) {
        const rows = expectations
          .filter(
            (expectation) =>
              expectation.kind === "constraint" &&
              expectation.definition != null
          )
          .map((expectation) => {
            const [table_schema, table_name, constraint_name] =
              expectation.object.split(".");
            return {
              constraint_name,
              definition: expectation.definition,
              table_name,
              table_schema,
            };
          });
        return { rowCount: rows.length, rows: rows as T[] };
      }
      if (/pg_catalog\.pg_namespace/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{ nspname: "athena" }] as T[],
        };
      }
      if (/information_schema\.tables/i.test(text)) {
        const rows = rowsForExpectations(
          expectations,
          "table",
          ([table_schema, table_name]) => ({ table_name, table_schema })
        );
        return { rowCount: rows.length, rows: rows as T[] };
      }
      if (/information_schema\.columns/i.test(text)) {
        const rows = rowsForExpectations(
          expectations,
          "column",
          ([table_schema, table_name, column_name]) => ({
            column_name,
            table_name,
            table_schema,
          })
        );
        return { rowCount: rows.length, rows: rows as T[] };
      }
      if (/pg_catalog\.pg_indexes/i.test(text)) {
        const rows = rowsForExpectations(
          expectations,
          "index",
          ([schemaname, indexname]) => ({ indexname, schemaname })
        );
        return { rowCount: rows.length, rows: rows as T[] };
      }
      if (/information_schema\.table_constraints/i.test(text)) {
        const rows = rowsForExpectations(
          expectations,
          "constraint",
          ([table_schema, table_name, constraint_name]) => ({
            constraint_name,
            table_name,
            table_schema,
          })
        );
        return { rowCount: rows.length, rows: rows as T[] };
      }
      return { rowCount: 0, rows: [] as T[] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

test("Auth migration apply and readiness inspection converge on current generation", async () => {
  const database = createMigratingAuthDatabase();
  const migrated = await migrateAthenaAuthSchema(database);
  const readiness = await inspectAthenaAuthSchema(database);

  assert.equal(migrated.current, ATHENA_AUTH_SCHEMA_GENERATION);
  assert.equal(migrated.expected, ATHENA_AUTH_SCHEMA_GENERATION);
  assert.equal(migrated.compatible, true);
  assert.equal(readiness.currentGeneration, ATHENA_AUTH_SCHEMA_GENERATION);
  assert.equal(readiness.requiredGeneration, ATHENA_AUTH_SCHEMA_GENERATION);
  assert.deepEqual(readiness.missingMigrations, []);
  assert.equal(readiness.physicalSchemaValid, true);
  assert.equal(readiness.ready, true);
});
