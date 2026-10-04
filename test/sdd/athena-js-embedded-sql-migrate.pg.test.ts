/**
 * Optional live apply of packaged Chat / Event Ingress / Billing ledgers.
 * Skips unless DATABASE_URL is set. Refuses Neon unless ATHENA_EMBEDDED_MIGRATE_PG=1.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "../../src/auth/contract/index.ts";
import {
  ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS,
  createAuthDatabaseFromPool,
  createPostgresAuthDatabase,
} from "../../src/auth/local/database.ts";
import { AthenaAuthRuntimeError } from "../../src/auth/local/errors.ts";
import {
  getAthenaAuthExpectedLedger,
  inspectAthenaAuthSchema,
  migrateAthenaAuthSchema,
  withAthenaAuthMigrationLock,
} from "../../src/auth/local/schema.ts";
import { ATHENA_AUTH_CANONICAL_MIGRATIONS } from "../../src/auth/schema/migrations.ts";
import type { AthenaCliUI } from "../../src/cli/ui/index.ts";
import { checksumMigrationSql } from "../../src/migrations/checksum.ts";
import {
  EMBEDDED_BILLING_LEDGER,
  EMBEDDED_BILLING_MIGRATIONS,
  EMBEDDED_BILLING_REQUIRED_ATHENA_TABLES,
  EMBEDDED_BILLING_REQUIRED_INTERNAL_TABLES,
  EMBEDDED_BILLING_REQUIRED_RELATIONS,
  EMBEDDED_BILLING_REQUIRED_TABLES,
} from "../../src/migrations/embedded-billing/catalog.ts";
import {
  EMBEDDED_CHAT_LEDGER,
  EMBEDDED_CHAT_MIGRATIONS,
} from "../../src/migrations/embedded-chat/catalog.ts";
import {
  EMBEDDED_EVENT_INGRESS_LEDGER,
  EMBEDDED_EVENT_INGRESS_MIGRATIONS,
} from "../../src/migrations/embedded-event-ingress/catalog.ts";
import {
  applyEmbeddedSqlMigrations,
  inspectEmbeddedSqlLedger,
} from "../../src/migrations/embedded-sql-apply.ts";
import { createPostgresPool } from "../../src/postgres/driver.ts";
import { createPostgresPoolManager } from "../../src/postgres/pool/manager.ts";

const silentUi = { info() { } } as unknown as AthenaCliUI;
const CANONICAL_033_CHECKSUM =
  "483af951e47a72cdffb6b8a21f5878a1e9c2ce250079e7535bad35a47d5a1418";
const ATHENA_570_033_CHECKSUM =
  "044557ff8b79810d05e43f4fb9f0203e42b68ad0ea9c62c4e1c1970440a6b764";

function liveUrl(): string | undefined {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return;
  }
  if (
    connectionString.includes("neon.tech") &&
    process.env.ATHENA_EMBEDDED_MIGRATE_PG !== "1"
  ) {
    return;
  }
  return connectionString;
}

function disposableAuthFinalityUrl(): string | undefined {
  const connectionString =
    process.env.ATHENA_AUTH_FINALITY_DATABASE_URL?.trim();
  return connectionString && /^postgres(ql)?:\/\//i.test(connectionString)
    ? connectionString
    : undefined;
}

async function applyAuthMigrationsThrough(
  database: Awaited<ReturnType<typeof createPostgresAuthDatabase>>,
  generation: number,
): Promise<void> {
  await withAthenaAuthMigrationLock(database, async (tx) => {
    await tx.query("CREATE SCHEMA IF NOT EXISTS athena");
    await tx.query(`
      CREATE TABLE IF NOT EXISTS athena.auth_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL DEFAULT '',
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of ATHENA_AUTH_CANONICAL_MIGRATIONS) {
      if (migration.version > generation) {
        break;
      }
      await tx.query(migration.sql);
      await tx.query(
        "INSERT INTO athena.auth_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, checksumMigrationSql(migration.sql)],
      );
    }
  });
}

async function seedAuthorizationAssignments(
  database: Awaited<ReturnType<typeof createPostgresAuthDatabase>>,
): Promise<void> {
  await database.query(`
    INSERT INTO athena.users (id, name, email, email_verified, role)
    VALUES
      ('user_owner', 'Owner User', 'owner@example.test', TRUE, 'owner'),
      ('user_member', 'Member User', 'member@example.test', TRUE, 'member')
  `);
  await database.query(`
    INSERT INTO athena.organization (id, name, slug)
    VALUES ('org_acme', 'Acme', 'acme')
  `);
  await database.query(`
    INSERT INTO athena.member (id, organization_id, user_id, role)
    VALUES ('member_acme_owner', 'org_acme', 'user_owner', 'owner')
  `);
  await database.query(`
    INSERT INTO athena.authorization_roles
      (id, key, name, scope_kind, organization_id, system_kind, protected)
    VALUES
      ('role_platform_owner', 'platform_owner', 'Platform owner', 'platform', NULL, 'owner', TRUE),
      ('role_platform_admin', 'admin', 'Platform admin', 'platform', NULL, 'admin', TRUE),
      ('organization_owner', 'organization_owner', 'Organization owner', 'organization', NULL, 'owner', TRUE),
      ('role_org_billing', 'billing', 'Billing manager', 'organization', 'org_acme', NULL, FALSE)
  `);
  await database.query(`
    INSERT INTO athena.authorization_user_roles (user_id, role_id, assigned_by)
    VALUES ('user_owner', 'role_platform_owner', 'system')
  `);
  await database.query(`
    INSERT INTO athena.authorization_member_roles (member_id, role_id, assigned_by)
    VALUES ('member_acme_owner', 'organization_owner', 'system')
  `);
}

async function prepareAuthGeneration(
  database: Awaited<ReturnType<typeof createPostgresAuthDatabase>>,
  generation: number,
): Promise<void> {
  await database.transaction(
    async (tx) => {
      await tx.query("DROP SCHEMA IF EXISTS athena CASCADE");
      await applyAuthMigrationsThrough(tx, generation);
      await seedAuthorizationAssignments(tx);
    },
    {
      operationTimeoutMs: ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS,
    },
  );
}

async function prepareAthena570AuthGeneration(
  database: Awaited<ReturnType<typeof createPostgresAuthDatabase>>
): Promise<void> {
  await prepareAuthGeneration(database, 32);
  const migration033 = ATHENA_AUTH_CANONICAL_MIGRATIONS.find(
    (migration) => migration.version === 33
  );
  assert.ok(migration033);
  const accidentalSql = migration033.sql.replace(
    "ON athena.auth_signing_keys (issuer)",
    "ON athena.auth_signing_keys (issuer, algorithm)"
  );
  assert.notEqual(accidentalSql, migration033.sql);
  assert.equal(checksumMigrationSql(accidentalSql), ATHENA_570_033_CHECKSUM);

  await withAthenaAuthMigrationLock(database, async (tx) => {
    await tx.query(accidentalSql);
    await tx.query(
      "INSERT INTO athena.auth_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
      [33, migration033.name, ATHENA_570_033_CHECKSUM]
    );
    for (const migration of ATHENA_AUTH_CANONICAL_MIGRATIONS) {
      if (migration.version <= 33) {
        continue;
      }
      await tx.query(migration.sql);
      await tx.query(
        "INSERT INTO athena.auth_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, checksumMigrationSql(migration.sql)]
      );
    }
  });
}

async function readActiveSigningKeyIndexDefinition(
  database: Awaited<ReturnType<typeof createPostgresAuthDatabase>>
): Promise<string> {
  const result = await database.query<{ indexdef: string }>(`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'athena'
      AND indexname = 'uq_auth_signing_keys_active_issuer'
  `);
  const definition = result.rows[0]?.indexdef;
  assert.ok(definition, "active signing key index must exist");
  return definition;
}

test("P?: packaged embedded ledgers apply on a live database and stay idempotent", async (t) => {
  const connectionString = liveUrl();
  if (!connectionString) {
    t.skip(
      "DATABASE_URL is not set (or Neon without ATHENA_EMBEDDED_MIGRATE_PG=1)",
    );
    return;
  }
  const pool = await createPostgresPool(connectionString, { max: 2, min: 0 });
  const manager = createPostgresPoolManager({ ownership: "borrowed", pool });
  try {
    await applyEmbeddedSqlMigrations({
      ledgerTable: EMBEDDED_CHAT_LEDGER,
      manager,
      migrations: EMBEDDED_CHAT_MIGRATIONS,
      ui: silentUi,
    });
    const authDatabase = createAuthDatabaseFromPool(pool);
    const authStatus = await migrateAthenaAuthSchema(authDatabase);
    const authReadiness = await inspectAthenaAuthSchema(authDatabase);
    const authSecondStatus = await migrateAthenaAuthSchema(authDatabase);
    const primaryKeys = await authDatabase.query<{
      constraint_name: string;
      relation: string;
    }>(
      `SELECT conname AS constraint_name, conrelid::regclass::text AS relation
       FROM pg_catalog.pg_constraint
       WHERE contype = 'p'
         AND conrelid IN (
           'athena.authorization_user_roles'::regclass,
           'athena.authorization_member_roles'::regclass
         )`,
    );
    const supportingIndexes = await authDatabase.query<{
      indexname: string;
    }>(
      `SELECT indexname
       FROM pg_catalog.pg_indexes
       WHERE schemaname = 'athena'
         AND indexname = ANY($1::text[])`,
      [
        [
          "idx_authorization_user_roles_user",
          "idx_authorization_member_roles_member",
        ],
      ],
    );
    await applyEmbeddedSqlMigrations({
      ledgerTable: EMBEDDED_EVENT_INGRESS_LEDGER,
      manager,
      migrations: EMBEDDED_EVENT_INGRESS_MIGRATIONS,
      ui: silentUi,
    });
    await applyEmbeddedSqlMigrations({
      ledgerTable: EMBEDDED_BILLING_LEDGER,
      manager,
      migrations: EMBEDDED_BILLING_MIGRATIONS,
      ui: silentUi,
    });
    await applyEmbeddedSqlMigrations({
      ledgerTable: EMBEDDED_CHAT_LEDGER,
      manager,
      migrations: EMBEDDED_CHAT_MIGRATIONS,
      ui: silentUi,
    });
    const chat = await inspectEmbeddedSqlLedger({
      ledgerTable: EMBEDDED_CHAT_LEDGER,
      migrations: EMBEDDED_CHAT_MIGRATIONS,
      queryable: pool,
    });
    const ingress = await inspectEmbeddedSqlLedger({
      ledgerTable: EMBEDDED_EVENT_INGRESS_LEDGER,
      migrations: EMBEDDED_EVENT_INGRESS_MIGRATIONS,
      queryable: pool,
    });
    const billing = await inspectEmbeddedSqlLedger({
      ledgerTable: EMBEDDED_BILLING_LEDGER,
      migrations: EMBEDDED_BILLING_MIGRATIONS,
      queryable: pool,
    });
    const requiredTables = await pool.query<{
      table_name: string;
      table_schema: string;
    }>(
      `SELECT table_name, table_schema
       FROM information_schema.tables
       WHERE (table_schema = 'billing' AND table_name = ANY($1::text[]))
          OR (table_schema = 'athena_internal' AND table_name = ANY($2::text[]))
          OR (table_schema = 'athena' AND table_name = ANY($3::text[]))`,
      [
        EMBEDDED_BILLING_REQUIRED_TABLES,
        EMBEDDED_BILLING_REQUIRED_INTERNAL_TABLES,
        EMBEDDED_BILLING_REQUIRED_ATHENA_TABLES,
      ],
    );
    assert.equal(
      chat.entries.every((entry) => entry.status === "applied"),
      true,
    );
    assert.equal(
      ingress.entries.every((entry) => entry.status === "applied"),
      true,
    );
    assert.equal(
      billing.entries.every((entry) => entry.status === "applied"),
      true,
    );
    assert.equal(billing.entries.length, EMBEDDED_BILLING_MIGRATIONS.length);
    assert.deepEqual(
      requiredTables.rows
        .map((row) => `${row.table_schema}.${row.table_name}`)
        .sort(),
      EMBEDDED_BILLING_REQUIRED_RELATIONS.map(
        (relation) => `${relation.schema}.${relation.table}`,
      ).sort(),
    );
    assert.equal(authStatus.current, authStatus.expected);
    assert.equal(authStatus.compatible, true);
    assert.equal(
      authReadiness.currentGeneration,
      authReadiness.requiredGeneration,
    );
    assert.deepEqual(authReadiness.missingMigrations, []);
    assert.equal(authReadiness.physicalSchemaValid, true);
    assert.equal(authReadiness.ready, true);
    assert.equal(authSecondStatus.compatible, true);
    assert.deepEqual(
      primaryKeys.rows
        .map((row) => `${row.relation}.${row.constraint_name}`)
        .sort(),
      [
        "athena.authorization_member_roles.authorization_member_roles_pkey",
        "athena.authorization_user_roles.authorization_user_roles_pkey",
      ],
    );
    assert.deepEqual(
      supportingIndexes.rows.map((row) => row.indexname).sort(),
      [
        "idx_authorization_member_roles_member",
        "idx_authorization_user_roles_user",
      ],
    );
  } finally {
    await manager.close();
    await pool.end();
  }
});

test("P?: physical Auth generation 34 upgrades to current without losing assignments", async (t) => {
  const connectionString = disposableAuthFinalityUrl();
  if (!connectionString) {
    t.skip(
      "ATHENA_AUTH_FINALITY_DATABASE_URL must point to a disposable PostgreSQL database",
    );
    return;
  }

  const database = await createPostgresAuthDatabase(connectionString);
  const generation = ATHENA_AUTH_SCHEMA_GENERATION;
  try {
    await prepareAuthGeneration(database, 34);

    const beforeAssignments = await database.query<{
      assigned_by: string;
      member_id: string | null;
      role_id: string;
      user_id: string | null;
    }>(`
      SELECT NULL::text AS user_id, member_id, role_id, assigned_by
      FROM athena.authorization_member_roles
      UNION ALL
      SELECT user_id, NULL::text AS member_id, role_id, assigned_by
      FROM athena.authorization_user_roles
      ORDER BY user_id NULLS LAST, member_id NULLS LAST, role_id
    `);
    const beforeUpgrade = await inspectAthenaAuthSchema(database);
    assert.equal(beforeUpgrade.ready, false);
    assert.equal(beforeUpgrade.currentGeneration, 34);
    assert.deepEqual(
      beforeUpgrade.missingMigrations,
      ATHENA_AUTH_CANONICAL_MIGRATIONS.filter((migration) => migration.version > 34).map(
        (migration) => migration.version,
      ),
    );
    assert.equal(beforeUpgrade.physicalSchemaValid, true);

    const beforePrimaryKeys = await database.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid IN (
        'athena.authorization_user_roles'::regclass,
        'athena.authorization_member_roles'::regclass
      )
        AND contype = 'p'
      ORDER BY conrelid::regclass::text
    `);
    assert.deepEqual(
      beforePrimaryKeys.rows.map((row) => row.definition).sort(),
      ["PRIMARY KEY (member_id)", "PRIMARY KEY (user_id)"].sort(),
    );

    const upgraded = await migrateAthenaAuthSchema(database);
    const afterUpgrade = await inspectAthenaAuthSchema(database);
    const second = await migrateAthenaAuthSchema(database);
    assert.equal(upgraded.compatible, true);
    assert.equal(second.compatible, true);
    assert.equal(afterUpgrade.ready, true);
    assert.equal(afterUpgrade.currentGeneration, generation);
    assert.equal(afterUpgrade.requiredGeneration, generation);
    assert.deepEqual(afterUpgrade.missingMigrations, []);
    assert.equal(afterUpgrade.physicalSchemaValid, true);
    const oidcColumns = await database.query<{
      column_name: string;
      table_name: string;
    }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'athena'
        AND table_name = ANY($1::text[])
        AND column_name = ANY($2::text[])
    `, [
      [
        "oauth_authorization_grants",
        "oauth_authorization_requests",
        "oauth_authorization_codes",
      ],
      ["identity_scopes", "nonce", "max_age", "prompt"],
    ]);
    assert.deepEqual(
      oidcColumns.rows
        .map((row) => `${row.table_name}.${row.column_name}`)
        .sort(),
      [
        "oauth_authorization_codes.identity_scopes",
        "oauth_authorization_codes.nonce",
        "oauth_authorization_grants.identity_scopes",
        "oauth_authorization_requests.identity_scopes",
        "oauth_authorization_requests.max_age",
        "oauth_authorization_requests.nonce",
        "oauth_authorization_requests.prompt",
      ].sort(),
    );

    const afterAssignments = await database.query<{
      assigned_by: string;
      member_id: string | null;
      role_id: string;
      user_id: string | null;
    }>(`
      SELECT NULL::text AS user_id, member_id, role_id, assigned_by
      FROM athena.authorization_member_roles
      UNION ALL
      SELECT user_id, NULL::text AS member_id, role_id, assigned_by
      FROM athena.authorization_user_roles
      ORDER BY user_id NULLS LAST, member_id NULLS LAST, role_id
    `);
    for (const expected of beforeAssignments.rows) {
      assert.ok(
        afterAssignments.rows.some(
          (row) =>
            row.assigned_by === expected.assigned_by &&
            row.member_id === expected.member_id &&
            row.role_id === expected.role_id &&
            row.user_id === expected.user_id
        ),
        `upgrade lost assignment ${JSON.stringify(expected)}`
      );
    }

    const afterPrimaryKeys = await database.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid IN (
        'athena.authorization_user_roles'::regclass,
        'athena.authorization_member_roles'::regclass
      )
        AND contype = 'p'
      ORDER BY conrelid::regclass::text
    `);
    assert.deepEqual(
      afterPrimaryKeys.rows.map((row) => row.definition).sort(),
      [
        "PRIMARY KEY (member_id, role_id)",
        "PRIMARY KEY (user_id, role_id)",
      ].sort(),
    );
    const supportingIndexes = await database.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'athena'
        AND indexname IN (
          'idx_authorization_user_roles_user',
          'idx_authorization_member_roles_member'
        )
      ORDER BY indexname
    `);
    assert.deepEqual(
      supportingIndexes.rows.map((row) => row.indexname),
      [
        "idx_authorization_member_roles_member",
        "idx_authorization_user_roles_user",
      ],
    );

    await database.query(`
      INSERT INTO athena.authorization_user_roles (user_id, role_id, assigned_by)
      VALUES ('user_owner', 'role_platform_admin', 'system')
    `);
    await database.query(`
      INSERT INTO athena.authorization_member_roles (member_id, role_id, assigned_by)
      VALUES ('member_acme_owner', 'role_org_billing', 'system')
    `);
    const multiRoleCounts = await database.query<{
      member_roles: number;
      user_roles: number;
    }>(`
      SELECT
        (SELECT count(*)::int
         FROM athena.authorization_user_roles
         WHERE user_id = 'user_owner') AS user_roles,
        (SELECT count(*)::int
         FROM athena.authorization_member_roles
         WHERE member_id = 'member_acme_owner') AS member_roles
    `);
    assert.deepEqual(multiRoleCounts.rows[0], {
      member_roles: 2,
      user_roles: 2,
    });
  } finally {
    await database.close?.();
  }
});

test("Auth migration history cohorts preserve 033 receipts and converge through 047", async (t) => {
  const connectionString = disposableAuthFinalityUrl();
  if (!connectionString) {
    t.skip(
      "ATHENA_AUTH_FINALITY_DATABASE_URL must point to a disposable PostgreSQL database"
    );
    return;
  }

  const database = await createPostgresAuthDatabase(connectionString);
  try {
    await t.test(
      "pre-5.7.0 generation 45 upgrades from canonical issuer-only 033",
      async () => {
        await prepareAuthGeneration(database, 45);
        const before = await database.query<{ checksum: string }>(`
          SELECT checksum FROM athena.auth_schema_migrations WHERE version = 33
        `);
        assert.equal(before.rows[0]?.checksum, CANONICAL_033_CHECKSUM);
        assert.match(
          await readActiveSigningKeyIndexDefinition(database),
          /\(issuer\)/
        );
        assert.doesNotMatch(
          await readActiveSigningKeyIndexDefinition(database),
          /\(issuer, algorithm\)/
        );

        const upgraded = await migrateAthenaAuthSchema(database);
        const readiness = await inspectAthenaAuthSchema(database);
        const after = await database.query<{ checksum: string }>(`
          SELECT checksum FROM athena.auth_schema_migrations WHERE version = 33
        `);
        assert.equal(upgraded.compatible, true);
        assert.equal(readiness.ready, true);
        assert.equal(after.rows[0]?.checksum, CANONICAL_033_CHECKSUM);
        assert.match(
          await readActiveSigningKeyIndexDefinition(database),
          /\(issuer, algorithm\)/
        );
      }
    );

    await t.test(
      "Athena JS 5.7.0 history is accepted without rewriting its receipt",
      async () => {
        await prepareAthena570AuthGeneration(database);
        const before = await database.query<{ checksum: string }>(`
          SELECT checksum FROM athena.auth_schema_migrations WHERE version = 33
        `);
        assert.equal(before.rows[0]?.checksum, ATHENA_570_033_CHECKSUM);
        assert.match(
          await readActiveSigningKeyIndexDefinition(database),
          /\(issuer, algorithm\)/
        );

        const upgraded = await migrateAthenaAuthSchema(database);
        const readiness = await inspectAthenaAuthSchema(database);
        const second = await migrateAthenaAuthSchema(database);
        const after = await database.query<{ checksum: string }>(`
          SELECT checksum FROM athena.auth_schema_migrations WHERE version = 33
        `);
        assert.equal(upgraded.compatible, true);
        assert.equal(second.compatible, true);
        assert.equal(readiness.ready, true);
        assert.equal(after.rows[0]?.checksum, ATHENA_570_033_CHECKSUM);
        assert.match(
          await readActiveSigningKeyIndexDefinition(database),
          /\(issuer, algorithm\)/
        );
      }
    );

    await t.test(
      "fresh installation records canonical 033 and reaches composite index through 047",
      async () => {
        await database.query("DROP SCHEMA IF EXISTS athena CASCADE");
        const migrated = await migrateAthenaAuthSchema(database);
        const readiness = await inspectAthenaAuthSchema(database);
        const ledger = await database.query<{ checksum: string }>(`
          SELECT checksum FROM athena.auth_schema_migrations WHERE version = 33
        `);
        const migration047 = ATHENA_AUTH_CANONICAL_MIGRATIONS.find(
          (migration) => migration.version === 47
        );
        assert.ok(migration047);
        assert.match(migration047.sql, /\(issuer, algorithm\)/);
        assert.equal(migrated.compatible, true);
        assert.equal(readiness.ready, true);
        assert.equal(ledger.rows[0]?.checksum, CANONICAL_033_CHECKSUM);
        assert.match(
          await readActiveSigningKeyIndexDefinition(database),
          /\(issuer, algorithm\)/
        );
        assert.deepEqual(
          getAthenaAuthExpectedLedger().find(
            (migration) => migration.version === 33
          )?.checksum,
          CANONICAL_033_CHECKSUM
        );
      }
    );

    await t.test(
      "arbitrary migration 033 receipt still fails closed as schema drift",
      async () => {
        await prepareAuthGeneration(database, 45);
        await database.query(
          "UPDATE athena.auth_schema_migrations SET checksum = $1 WHERE version = 33",
          ["deadbeef"]
        );

        await assert.rejects(
          () => migrateAthenaAuthSchema(database),
          (error: unknown) =>
            error instanceof AthenaAuthRuntimeError &&
            error.code === "ATHENA_AUTH_SCHEMA_DRIFT"
        );

        const receipt = await database.query<{ checksum: string }>(`
          SELECT checksum FROM athena.auth_schema_migrations WHERE version = 33
        `);
        assert.equal(receipt.rows[0]?.checksum, "deadbeef");
      }
    );
  } finally {
    try {
      await database.query("DROP SCHEMA IF EXISTS athena CASCADE");
    } finally {
      await database.close();
    }
  }
});
