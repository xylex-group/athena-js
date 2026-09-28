import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import type { AthenaCliUI } from "../src/cli/ui/index.ts";
import { shouldApplyEmbeddedAuthMigrations } from "../src/migrations/embedded-auth/enablement.ts";
import {
  EMBEDDED_BILLING_LEDGER,
  EMBEDDED_BILLING_MIGRATIONS,
} from "../src/migrations/embedded-billing/catalog.ts";
import {
  EMBEDDED_CHAT_LEDGER,
  EMBEDDED_CHAT_MIGRATIONS,
} from "../src/migrations/embedded-chat/catalog.ts";
import { shouldApplyEmbeddedChatMigrations } from "../src/migrations/embedded-chat/enablement.ts";
import {
  EMBEDDED_EVENT_INGRESS_LEDGER,
  EMBEDDED_EVENT_INGRESS_MIGRATIONS,
} from "../src/migrations/embedded-event-ingress/catalog.ts";
import {
  applyEmbeddedSqlMigrations,
  type EmbeddedSqlMigration,
  inspectEmbeddedSqlLedger,
} from "../src/migrations/embedded-sql-apply.ts";
import { MigrationError } from "../src/migrations/types.ts";
import type {
  AthenaPostgresClient,
  AthenaPostgresPool,
} from "../src/postgres/driver.ts";
import { createPostgresPoolManager } from "../src/postgres/pool/manager.ts";

const silentUi = { info() { } } as unknown as AthenaCliUI;

function postgresDriverError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

type ScriptedPoolHarness = {
  markLedgerPresent: (oid: string) => void;
  physicalColumns: Set<string>;
  physicalQualified: Set<string>;
  pool: AthenaPostgresPool;
  queries: string[];
};

function createScriptedPool(input: {
  checksumByVersion: Map<number, string>;
  ledgerOid: string | null;
  physicalColumns?: ReadonlySet<string>;
  physicalQualified?: ReadonlySet<string>;
}): ScriptedPoolHarness {
  const queries: string[] = [];
  let inTx = false;
  let aborted = false;
  let ledgerOid = input.ledgerOid;
  const checksumByVersion = input.checksumByVersion;
  const physicalColumns = new Set(input.physicalColumns);
  const physicalQualified = new Set(input.physicalQualified);

  const client: AthenaPostgresClient = {
    async query(text: string, values?: unknown[]) {
      queries.push(text);
      if (aborted && !/^\s*ROLLBACK\b/i.test(text)) {
        throw postgresDriverError(
          "25P02",
          "current transaction is aborted, commands ignored until end of transaction block"
        );
      }
      if (/^\s*BEGIN\b/i.test(text)) {
        inTx = true;
        return { rows: [] } as never;
      }
      if (/^\s*COMMIT\b/i.test(text)) {
        inTx = false;
        return { rows: [] } as never;
      }
      if (/^\s*ROLLBACK\b/i.test(text)) {
        aborted = false;
        inTx = false;
        return { rows: [] } as never;
      }
      if (/\bto_regclass\b/.test(text)) {
        const target = String(values?.[0] ?? "");
        if (target.includes(".")) {
          return {
            rows: [{ oid: physicalQualified.has(target) ? "oid" : null }],
          } as never;
        }
        return { rows: [{ oid: ledgerOid }] } as never;
      }
      if (/information_schema\.columns/.test(text)) {
        const key = [
          String(values?.[0] ?? ""),
          String(values?.[1] ?? ""),
          String(values?.[2] ?? ""),
        ].join(".");
        return {
          rows: physicalColumns.has(key) ? [{ exists: true }] : [],
        } as never;
      }
      if (/SELECT checksum FROM/.test(text)) {
        if (ledgerOid == null) {
          if (inTx) {
            aborted = true;
          }
          throw postgresDriverError(
            "42P01",
            'relation "ledger" does not exist'
          );
        }
        const version = Number(values?.[0]);
        const checksum = checksumByVersion.get(version);
        return {
          rows: checksum == null ? [] : [{ checksum }],
        } as never;
      }
      if (/UPDATE /.test(text) && /SET checksum/.test(text)) {
        const checksum = String(values?.[0] ?? "");
        const version = Number(values?.[2]);
        checksumByVersion.set(version, checksum);
        return { rowCount: 1, rows: [] } as never;
      }
      if (/INSERT INTO/.test(text)) {
        const version = Number(values?.[0]);
        const checksum = String(values?.[2] ?? "");
        checksumByVersion.set(version, checksum);
        ledgerOid = "embedded_ledger";
        return { rows: [] } as never;
      }
      return { rows: [] } as never;
    },
    release() { },
  };

  const pool: AthenaPostgresPool = {
    async connect() {
      return client;
    },
    async end() { },
    async query(text, values) {
      return client.query(text, values);
    },
  };

  const harness: ScriptedPoolHarness = {
    markLedgerPresent(oid: string) {
      ledgerOid = oid;
    },
    physicalColumns,
    physicalQualified,
    pool,
    queries,
  };
  return harness;
}

test("auth enablement matches modules.auth === true when modules is set", () => {
  assert.equal(shouldApplyEmbeddedAuthMigrations(undefined), true);
  assert.equal(shouldApplyEmbeddedAuthMigrations({ auth: true }), true);
  assert.equal(shouldApplyEmbeddedAuthMigrations({ auth: false }), false);
  assert.equal(shouldApplyEmbeddedAuthMigrations({ chat: true }), false);
  assert.equal(shouldApplyEmbeddedChatMigrations({ chat: true }), true);
});

test("missing ledger is probed with to_regclass outside BEGIN", async () => {
  const scripted = createScriptedPool({
    checksumByVersion: new Map(),
    ledgerOid: null,
  });
  await applyEmbeddedSqlMigrations({
    ledgerTable: EMBEDDED_CHAT_LEDGER,
    manager: createPostgresPoolManager({ pool: scripted.pool }),
    migrations: EMBEDDED_CHAT_MIGRATIONS,
    ui: silentUi,
  });
  assert.equal(
    scripted.queries.some((sql) => /\bto_regclass\b/.test(sql)),
    true
  );
  const beginAt = scripted.queries.findIndex((sql) => /^\s*BEGIN\b/i.test(sql));
  assert.ok(beginAt > 0);
  assert.equal(
    scripted.queries
      .slice(0, beginAt)
      .some((sql) => /SELECT checksum FROM/.test(sql)),
    false
  );
  assert.equal(
    scripted.queries.some((sql) =>
      sql.includes(EMBEDDED_CHAT_MIGRATIONS[0].sql)
    ),
    true
  );
});

test("fresh apply is idempotent on a second pass", async () => {
  const scripted = createScriptedPool({
    checksumByVersion: new Map(),
    ledgerOid: null,
  });
  const input = {
    ledgerTable: EMBEDDED_CHAT_LEDGER,
    manager: createPostgresPoolManager({ pool: scripted.pool }),
    migrations: EMBEDDED_CHAT_MIGRATIONS,
    ui: silentUi,
  };
  await applyEmbeddedSqlMigrations(input);
  for (const relation of EMBEDDED_CHAT_MIGRATIONS[0].requiredRelations) {
    scripted.physicalQualified.add(`${relation.schema}.${relation.table}`);
  }
  const afterFirst = scripted.queries.filter((sql) =>
    /^\s*BEGIN\b/i.test(sql)
  ).length;
  await applyEmbeddedSqlMigrations(input);
  const afterSecond = scripted.queries.filter((sql) =>
    /^\s*BEGIN\b/i.test(sql)
  ).length;
  assert.equal(afterFirst, 1);
  assert.equal(afterSecond, 1);
});

test("checksum drift fails closed for chat, event ingress, and billing ledgers", async () => {
  const catalogs: readonly {
    ledger: string;
    migrations: readonly EmbeddedSqlMigration[];
  }[] = [
      { ledger: EMBEDDED_CHAT_LEDGER, migrations: EMBEDDED_CHAT_MIGRATIONS },
      {
        ledger: EMBEDDED_EVENT_INGRESS_LEDGER,
        migrations: EMBEDDED_EVENT_INGRESS_MIGRATIONS,
      },
      {
        ledger: EMBEDDED_BILLING_LEDGER,
        migrations: EMBEDDED_BILLING_MIGRATIONS,
      },
    ];
  for (const catalog of catalogs) {
    const first = catalog.migrations[0];
    const scripted = createScriptedPool({
      checksumByVersion: new Map([
        [first.version, "not-the-packaged-checksum"],
      ]),
      ledgerOid: catalog.ledger,
    });
    await assert.rejects(
      () =>
        applyEmbeddedSqlMigrations({
          ledgerTable: catalog.ledger,
          manager: createPostgresPoolManager({ pool: scripted.pool }),
          migrations: catalog.migrations,
          ui: silentUi,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MigrationError);
        assert.equal(error.code, "INTEGRITY");
        assert.match(error.message, /checksum mismatch/);
        return true;
      }
    );
    assert.equal(
      scripted.queries.some((sql) => /^\s*BEGIN\b/i.test(sql)),
      false
    );
    const inspection = await inspectEmbeddedSqlLedger({
      ledgerTable: catalog.ledger,
      migrations: catalog.migrations,
      queryable: scripted.pool,
    });
    assert.equal(inspection.entries[0]?.status, "checksum-mismatch");
  }
});

test("legacy chat-runtime-v4 checksum is adopted when physical relations exist", async () => {
  const first = EMBEDDED_CHAT_MIGRATIONS[0];
  const physicalQualified = new Set(
    first.requiredRelations.map(
      (relation) => `${relation.schema}.${relation.table}`
    )
  );
  const scripted = createScriptedPool({
    checksumByVersion: new Map([[first.version, "chat-runtime-v4"]]),
    ledgerOid: EMBEDDED_CHAT_LEDGER,
    physicalQualified,
  });
  const inspectionBefore = await inspectEmbeddedSqlLedger({
    ledgerTable: EMBEDDED_CHAT_LEDGER,
    migrations: EMBEDDED_CHAT_MIGRATIONS,
    queryable: scripted.pool,
  });
  assert.equal(inspectionBefore.entries[0]?.status, "legacy-compatible");
  await applyEmbeddedSqlMigrations({
    ledgerTable: EMBEDDED_CHAT_LEDGER,
    manager: createPostgresPoolManager({ pool: scripted.pool }),
    migrations: EMBEDDED_CHAT_MIGRATIONS,
    ui: silentUi,
  });
  assert.equal(
    scripted.queries.some(
      (sql) => /UPDATE /.test(sql) && /SET checksum/.test(sql)
    ),
    true
  );
  const inspectionAfter = await inspectEmbeddedSqlLedger({
    ledgerTable: EMBEDDED_CHAT_LEDGER,
    migrations: EMBEDDED_CHAT_MIGRATIONS,
    queryable: scripted.pool,
  });
  assert.equal(inspectionAfter.entries[0]?.status, "applied");
  assert.equal(inspectionAfter.entries[0]?.storedChecksum, first.checksum);
});

test("legacy chat-runtime-v4 checksum fails closed when a required relation is missing", async () => {
  const first = EMBEDDED_CHAT_MIGRATIONS[0];
  const physicalQualified = new Set(
    first.requiredRelations
      .slice(0, -1)
      .map((relation) => `${relation.schema}.${relation.table}`)
  );
  const scripted = createScriptedPool({
    checksumByVersion: new Map([[first.version, "chat-runtime-v4"]]),
    ledgerOid: EMBEDDED_CHAT_LEDGER,
    physicalQualified,
  });
  await assert.rejects(
    () =>
      applyEmbeddedSqlMigrations({
        ledgerTable: EMBEDDED_CHAT_LEDGER,
        manager: createPostgresPoolManager({ pool: scripted.pool }),
        migrations: EMBEDDED_CHAT_MIGRATIONS,
        ui: silentUi,
      }),
    (error: unknown) => {
      assert.ok(error instanceof MigrationError);
      assert.equal(error.code, "INTEGRITY");
      assert.match(error.message, /physical schema does not match/);
      return true;
    }
  );
  assert.equal(
    scripted.queries.some(
      (sql) => /UPDATE /.test(sql) && /SET checksum/.test(sql)
    ),
    false
  );
});

test("applied billing ledger fails closed when required relations are missing", async () => {
  const latest = EMBEDDED_BILLING_MIGRATIONS.at(-1);
  assert.ok(latest);
  const checksumByVersion = new Map(
    EMBEDDED_BILLING_MIGRATIONS.map((migration) => [
      migration.version,
      migration.checksum,
    ])
  );
  const scripted = createScriptedPool({
    checksumByVersion,
    ledgerOid: EMBEDDED_BILLING_LEDGER,
    physicalQualified: new Set(["billing.billing_payments"]),
  });
  await assert.rejects(
    () =>
      applyEmbeddedSqlMigrations({
        ledgerTable: EMBEDDED_BILLING_LEDGER,
        manager: createPostgresPoolManager({ pool: scripted.pool }),
        migrations: EMBEDDED_BILLING_MIGRATIONS,
        ui: silentUi,
      }),
    (error: unknown) => {
      assert.ok(error instanceof MigrationError);
      assert.equal(error.code, "INTEGRITY");
      assert.match(error.message, /required relations are missing/);
      assert.match(error.message, /billing_webhook_ingress_rejections/);
      return true;
    }
  );
  assert.ok("requiredRelations" in latest);
  assert.ok((latest.requiredRelations.length ?? 0) > 0);
});

test("applied billing ledger replays packaged SQL when the physical schema is incomplete", async () => {
  const latest = EMBEDDED_BILLING_MIGRATIONS.at(-1);
  assert.ok(latest);
  const checksumByVersion = new Map(
    EMBEDDED_BILLING_MIGRATIONS.map((migration) => [
      migration.version,
      migration.checksum,
    ])
  );
  const scripted = createScriptedPool({
    checksumByVersion,
    ledgerOid: EMBEDDED_BILLING_LEDGER,
    physicalQualified: new Set(["billing.billing_payments"]),
  });
  await assert.rejects(
    () =>
      applyEmbeddedSqlMigrations({
        ledgerTable: EMBEDDED_BILLING_LEDGER,
        manager: createPostgresPoolManager({ pool: scripted.pool }),
        migrations: EMBEDDED_BILLING_MIGRATIONS,
        ui: silentUi,
      }),
    (error: unknown) => {
      assert.ok(error instanceof MigrationError);
      assert.equal(error.code, "INTEGRITY");
      return true;
    }
  );
  const begins = scripted.queries.filter((sql) => /^\s*BEGIN\b/i.test(sql))
    .length;
  assert.equal(begins >= EMBEDDED_BILLING_MIGRATIONS.length, true);
});

test("applied billing ledger fails closed when required subscription columns are missing", async () => {
  const latest = EMBEDDED_BILLING_MIGRATIONS.at(-1);
  assert.ok(latest);
  const requiredColumns = (
    latest as EmbeddedSqlMigration & {
      requiredColumns?: readonly {
        readonly column: string;
        readonly schema: string;
        readonly table: string;
      }[];
    }
  ).requiredColumns;
  assert.ok(requiredColumns);
  assert.ok(
    requiredColumns.some(
      (column) =>
        column.schema === "billing" &&
        column.table === "billing_subscriptions" &&
        column.column === "updated_at"
    )
  );
  const checksumByVersion = new Map(
    EMBEDDED_BILLING_MIGRATIONS.map((migration) => [
      migration.version,
      migration.checksum,
    ])
  );
  const scripted = createScriptedPool({
    checksumByVersion,
    ledgerOid: EMBEDDED_BILLING_LEDGER,
    physicalColumns: new Set(["billing.billing_subscriptions.row_version"]),
    physicalQualified: new Set(
      ("requiredRelations" in latest ? latest.requiredRelations : []).map(
        (relation) => `${relation.schema}.${relation.table}`
      )
    ),
  });
  await assert.rejects(
    () =>
      applyEmbeddedSqlMigrations({
        ledgerTable: EMBEDDED_BILLING_LEDGER,
        manager: createPostgresPoolManager({ pool: scripted.pool }),
        migrations: EMBEDDED_BILLING_MIGRATIONS,
        ui: silentUi,
      }),
    (error: unknown) => {
      assert.ok(error instanceof MigrationError);
      assert.equal(error.code, "INTEGRITY");
      assert.match(error.message, /required columns are missing/);
      assert.match(error.message, /billing\.billing_subscriptions\.updated_at/);
      return true;
    }
  );
});

test("billing ledger inspection reports missing physical columns", async () => {
  const latest = EMBEDDED_BILLING_MIGRATIONS.at(-1);
  assert.ok(latest);
  const checksumByVersion = new Map(
    EMBEDDED_BILLING_MIGRATIONS.map((migration) => [
      migration.version,
      migration.checksum,
    ])
  );
  const scripted = createScriptedPool({
    checksumByVersion,
    ledgerOid: EMBEDDED_BILLING_LEDGER,
    physicalColumns: new Set(["billing.billing_subscriptions.row_version"]),
    physicalQualified: new Set(
      ("requiredRelations" in latest ? latest.requiredRelations : []).map(
        (relation) => `${relation.schema}.${relation.table}`
      )
    ),
  });
  const inspection = await inspectEmbeddedSqlLedger({
    ledgerTable: EMBEDDED_BILLING_LEDGER,
    migrations: EMBEDDED_BILLING_MIGRATIONS,
    queryable: scripted.pool,
  });
  assert.deepEqual(inspection.missingColumns, [
    "billing.billing_subscriptions.updated_at",
    "billing.billing_binding_conflicts.last_observed_at",
    "billing.billing_binding_conflicts.observation_count",
  ]);
});
