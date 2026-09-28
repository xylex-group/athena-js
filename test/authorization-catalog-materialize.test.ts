import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_INIT_ADVISORY_LOCK } from "../src/auth/contract/index.ts";
import type {
  AthenaAuthDatabase,
  AthenaAuthQueryResult,
} from "../src/auth/local/database.ts";
import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import {
  AUTHORIZATION_CATALOG_VERSION,
  listAthenaAuthorizationRights,
} from "../src/runtime/authorization/catalog.ts";
import {
  AUTHORIZATION_CATALOG_LOCK,
  authorizationRightsFingerprint,
  authorizationRolesFingerprint,
} from "../src/runtime/authorization/catalog-state.ts";
import {
  ATHENA_AUTHORIZATION_ROLE_KEY_MISMATCH,
  PostgresAuthorizationStore,
} from "../src/runtime/authorization/postgres.ts";

const postgresSrc = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "runtime",
    "authorization",
    "postgres.ts"
  ),
  "utf8"
);

function sessionAdvisoryLock(sql: string): boolean {
  return (
    /pg_advisory_lock\s*\(/.test(sql) && !/pg_advisory_xact_lock\s*\(/.test(sql)
  );
}

test("authorization catalog materialization uses a transaction-owned xact lock", () => {
  assert.notEqual(AUTHORIZATION_CATALOG_LOCK, ATHENA_AUTH_INIT_ADVISORY_LOCK);
  assert.match(postgresSrc, /SELECT pg_advisory_xact_lock\(\$1\)/);
  assert.match(
    postgresSrc,
    /to_regclass\('athena\.authorization_catalog_state'\)/
  );
  const ensureCatalog = postgresSrc.slice(
    postgresSrc.indexOf("async ensureCatalog()"),
    postgresSrc.indexOf("async materialize()")
  );
  assert.match(
    ensureCatalog,
    /authorizationCatalogStateRelationVisible[\s\S]*readCatalogState/
  );
  assert.doesNotMatch(
    ensureCatalog,
    /FROM athena\.authorization_catalog_state/
  );
  const materialize = postgresSrc.slice(
    postgresSrc.indexOf("async materialize()"),
    postgresSrc.indexOf("private async writeCatalog")
  );
  assert.match(
    materialize,
    /AUTHORIZATION_CATALOG_STATE_SQL[\s\S]*readCatalogState/
  );
  assert.doesNotMatch(
    materialize,
    /readCatalogState[\s\S]*AUTHORIZATION_CATALOG_STATE_SQL/
  );
  assert.match(materialize, /this\.writeCatalog\(tx\)/);
  assert.equal((postgresSrc.match(/this\.writeCatalog\(/g) ?? []).length, 1);
  assert.doesNotMatch(ensureCatalog, /\bINSERT\b|\bUPDATE\b|\bCREATE TABLE\b/);
  const persistCatalogState = postgresSrc.slice(
    postgresSrc.indexOf("private async persistCatalogState"),
    postgresSrc.indexOf("async hasUserAssignment")
  );
  assert.doesNotMatch(persistCatalogState, /AUTHORIZATION_CATALOG_STATE_SQL/);
  assert.doesNotMatch(postgresSrc, /isUndefinedSqlRelationError/);
  assert.doesNotMatch(postgresSrc, /code === "42P01"/);
  assert.equal(sessionAdvisoryLock(postgresSrc), false);
  assert.match(postgresSrc, /UNNEST\(\$2::text\[\]\)/);
  assert.match(postgresSrc, /WITH desired AS \(/);
  const writeCatalog = postgresSrc.slice(
    postgresSrc.indexOf("private async writeCatalog"),
    postgresSrc.indexOf("private async readCatalogState")
  );
  assert.match(writeCatalog, /UNNEST\(\$2::text\[\]\)/);
  assert.doesNotMatch(writeCatalog, /VALUES \(\$1, \$2\)/);
  assert.match(writeCatalog, /getAthenaAuthorizationRightsIr\(\)\.rights/);
  assert.match(
    writeCatalog,
    /WHERE authorization_roles\.key = EXCLUDED\.key/
  );
  assert.match(writeCatalog, /RETURNING id/);
});

type CatalogRow = {
  catalog_version: number;
  rights_fingerprint: string;
  roles_fingerprint: string;
};

function createCatalogDatabase(
  initial?: CatalogRow,
  options: { roleUpsertRowCount?: number } = {}
): {
  database: AthenaAuthDatabase;
  events: string[];
  rightUpserts: { count: number };
  roleRightReplaces: { count: number };
} {
  let state = initial;
  let tableExists = initial !== undefined;
  const events: string[] = [];
  const rightUpserts = { count: 0 };
  const roleRightReplaces = { count: 0 };
  let txChain: Promise<void> = Promise.resolve();

  const run = async (
    client: "pool" | "tx",
    text: string,
    values?: unknown[]
  ): Promise<AthenaAuthQueryResult> => {
    events.push(`${client}:${text.replace(/\s+/g, " ").trim().slice(0, 80)}`);
    assert.equal(sessionAdvisoryLock(text), false);
    if (/pg_advisory_xact_lock/.test(text)) {
      assert.equal(values?.[0], AUTHORIZATION_CATALOG_LOCK);
      return { rowCount: 1, rows: [{}] };
    }
    if (/\bto_regclass\b/.test(text)) {
      return {
        rowCount: 1,
        rows: [{ oid: tableExists ? "authorization_catalog_state" : null }],
      };
    }
    if (/CREATE TABLE IF NOT EXISTS athena\.authorization_catalog_state/.test(text)) {
      tableExists = true;
      return { rowCount: 0, rows: [] };
    }
    if (
      /FROM athena\.authorization_catalog_state/.test(text) &&
      /SELECT catalog_version/.test(text)
    ) {
      if (!state) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [state] };
    }
    if (/INSERT INTO athena\.authorization_rights/.test(text)) {
      rightUpserts.count += 1;
      return { rowCount: 1, rows: [] };
    }
    if (/INSERT INTO athena\.authorization_roles/.test(text)) {
      return {
        rowCount: options.roleUpsertRowCount ?? 1,
        rows: options.roleUpsertRowCount === 0 ? [] : [{}],
      };
    }
    if (/INSERT INTO athena\.authorization_role_rights/.test(text)) {
      roleRightReplaces.count += 1;
      return { rowCount: 1, rows: [] };
    }
    if (/INSERT INTO athena\.authorization_catalog_state/.test(text)) {
      state = {
        catalog_version: Number(values?.[0]),
        rights_fingerprint: String(values?.[1]),
        roles_fingerprint: String(values?.[2]),
      };
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  };

  const tx: AthenaAuthDatabase = {
    inTransaction: true,
    async query(text, values) {
      return run("tx", text, values);
    },
    async transaction(fn) {
      return fn(tx);
    },
  };

  const database: AthenaAuthDatabase = {
    inTransaction: false,
    async query(text, values) {
      return run("pool", text, values);
    },
    async transaction(fn) {
      const previous = txChain;
      let release = (): void => undefined;
      txChain = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await fn(tx);
      } finally {
        release();
      }
    },
  };

  return { database, events, rightUpserts, roleRightReplaces };
}

test("ensureCatalog skips work when the fingerprint is already current", async () => {
  const harness = createCatalogDatabase({
    catalog_version: AUTHORIZATION_CATALOG_VERSION,
    rights_fingerprint: authorizationRightsFingerprint(),
    roles_fingerprint: authorizationRolesFingerprint(),
  });
  await new PostgresAuthorizationStore(harness.database).ensureCatalog();
  assert.ok(
    harness.events.some((event) => event.includes("to_regclass"))
  );
  assert.equal(harness.rightUpserts.count, 0);
  assert.equal(
    harness.events.some((event) => event.startsWith("tx:")),
    false
  );
  assert.ok(harness.events.some((event) => event.startsWith("pool:")));
});

test("materialize writes the catalog on the locked transaction client", async () => {
  const harness = createCatalogDatabase();
  await new PostgresAuthorizationStore(harness.database).materialize();
  assert.equal(
    harness.rightUpserts.count,
    listAthenaAuthorizationRights().length
  );
  assert.ok(harness.roleRightReplaces.count > 0);
  const catalogWrite = /INSERT INTO athena\.authorization_(rights|roles|role_rights|catalog_state|user_roles|member_roles)/;
  assert.equal(
    harness.events.some(
      (event) => event.startsWith("pool:") && catalogWrite.test(event)
    ),
    false
  );
  const txEvents = harness.events.filter((event) => event.startsWith("tx:"));
  assert.match(txEvents[0] ?? "", /pg_advisory_xact_lock/);
  assert.ok(
    txEvents.some((event) =>
      event.includes("INSERT INTO athena.authorization_rights")
    )
  );
});

test("materialize fails closed when a built-in role key is immutable but mismatched", async () => {
  const harness = createCatalogDatabase(undefined, { roleUpsertRowCount: 0 });
  await assert.rejects(
    () => new PostgresAuthorizationStore(harness.database).materialize(),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === ATHENA_AUTHORIZATION_ROLE_KEY_MISMATCH
  );
});

test("missing catalog state table is probed with to_regclass so the transaction stays open", async () => {
  let aborted = false;
  let tableExists = false;
  const queries: string[] = [];
  const tx: AthenaAuthDatabase = {
    inTransaction: true,
    async query(text) {
      queries.push(text);
      if (aborted) {
        throw Object.assign(
          new Error(
            "current transaction is aborted, commands ignored until end of transaction block"
          ),
          { code: "25P02" }
        );
      }
      if (/\bto_regclass\b/.test(text)) {
        return {
          rowCount: 1,
          rows: [{ oid: tableExists ? "authorization_catalog_state" : null }],
        };
      }
      if (/CREATE TABLE IF NOT EXISTS athena\.authorization_catalog_state/.test(text)) {
        tableExists = true;
        return { rowCount: 0, rows: [] };
      }
      if (
        /FROM athena\.authorization_catalog_state/.test(text) &&
        /SELECT catalog_version/.test(text)
      ) {
        if (!tableExists) {
          aborted = true;
          throw Object.assign(
            new Error(
              'relation "athena.authorization_catalog_state" does not exist'
            ),
            { code: "42P01" }
          );
        }
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [{}] };
    },
    async transaction(fn) {
      return fn(tx);
    },
  };
  const database: AthenaAuthDatabase = {
    inTransaction: false,
    query: tx.query.bind(tx),
    transaction: tx.transaction.bind(tx),
  };
  await new PostgresAuthorizationStore(database).ensureCatalog();
  const firstToRegclass = queries.findIndex((sql) => /\bto_regclass\b/.test(sql));
  const firstCatalogSelect = queries.findIndex(
    (sql) =>
      /FROM athena\.authorization_catalog_state/.test(sql) &&
      /SELECT catalog_version/.test(sql)
  );
  const firstCreate = queries.findIndex((sql) =>
    /CREATE TABLE IF NOT EXISTS athena\.authorization_catalog_state/.test(sql)
  );
  assert.ok(firstToRegclass >= 0);
  assert.equal(firstCatalogSelect === -1 || firstToRegclass < firstCatalogSelect, true);
  assert.equal(firstCatalogSelect === -1 || firstCreate < firstCatalogSelect, true);
  aborted = false;
  await database.query("SELECT 1");
});

test("Fresh DB + authorization ensureCatalog() produces no 42P01", async () => {
  const harness = createCatalogDatabase();
  await new PostgresAuthorizationStore(harness.database).ensureCatalog();
  assert.equal(
    harness.events.some((event) => event.includes("42P01")),
    false
  );
  assert.ok(harness.rightUpserts.count > 0);
});

test("a second waiter re-reads the fingerprint and does not rewrite rights", async () => {
  const harness = createCatalogDatabase();
  const store = new PostgresAuthorizationStore(harness.database);
  await Promise.all([store.ensureCatalog(), store.ensureCatalog()]);
  assert.equal(
    harness.rightUpserts.count,
    listAthenaAuthorizationRights().length
  );
});
