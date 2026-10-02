import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createSqliteLocalTransport } from "../src/sqlite-local/transport.ts";
import { createSqliteLocalCapabilities } from "../src/sqlite-local/materialize.ts";
import type {
  AthenaSqliteExecutor,
  AthenaSqliteExecutionResult,
} from "../src/sqlite-local/contracts.ts";
import type { AthenaCanonicalQueryCompiler } from "../src/sqlite-local/compiler.ts";
import { runMigrations } from "../src/migrations/runner.ts";
import { runSqliteMigrations } from "../src/migrations/sqlite.ts";
import { createClient } from "../src/v3-client.ts";
import {
  createSqliteAuthDatabase,
  createSqliteAuthRuntime,
  SqliteAuthStores,
} from "../src/auth/local/sqlite.ts";
import type { AthenaTransactionOperation } from "../src/db/transaction/types.ts";

const here = dirname(fileURLToPath(import.meta.url));

function executor(
  execute: AthenaSqliteExecutor["execute"],
  transaction: AthenaSqliteExecutor["transaction"] = async (callback) =>
    callback({ execute }),
): AthenaSqliteExecutor {
  return {
    capabilities: {
      interrupt: true,
      returning: true,
      savepoints: false,
      transactions: "interactive",
    },
    execute,
    transaction,
  };
}

function result(
  rows: readonly (readonly (string | number | null)[])[] = [["u-1", 1]],
): AthenaSqliteExecutionResult {
  return { columns: ["id", "value"], rows, changes: rows.length };
}

const compiler: AthenaCanonicalQueryCompiler = {
  async compile() {
    return {
      version: 1,
      sql: 'INSERT INTO "users" ("id") VALUES (?)',
      params: [{ text: "u-1" }],
      operation: "insert",
      mutability: "write",
      result_shape: "rows",
      expected_cardinality: "exactly_one",
      returning: "none",
      backend_profile: "sqlite_local",
      validation: { level: "full" },
      compiler: { crate_name: "athena-query", profile: "sqlite_local" },
    };
  },
};

function insertOperation(): AthenaTransactionOperation {
  return {
    descriptor: { kind: "insert" } as AthenaTransactionOperation["descriptor"],
    id: "op-1",
    index: 0,
    kind: "insert",
    payload: { table_name: "users", insert_body: { id: "u-1" } },
  };
}

test("structured atomic TX executes compiled SQL on the host transaction", async () => {
  const sql: string[] = [];
  const transport = createSqliteLocalTransport(
    executor(async (statement) => {
      sql.push(statement);
      return result();
    }),
    compiler,
  );
  assert.equal(transport.transactions.capabilities.atomic, true);
  assert.equal(transport.transactions.capabilities.interactive, true);
  assert.deepEqual(transport.transactions.capabilities.isolationLevels, []);
  const executed = await transport.transactions.executeAtomic([insertOperation()]);
  assert.equal(executed.committed, true);
  assert.equal(sql[0], 'INSERT INTO "users" ("id") VALUES (?)');
});

test("capability matrix matches advertised JS product flags when a compiler is present", () => {
  const matrix = JSON.parse(
    readFileSync(join(here, "fixtures/sqlite-local-capability-matrix.json"), "utf8"),
  ) as {
    layers: {
      athenaJs: {
        flatCrud: boolean;
        nestedRelations: boolean;
        transactions: {
          atomic: boolean;
          interactive: boolean;
          isolationLevels: unknown[];
          savepoints: boolean;
        };
      };
    };
  };
  const caps = createSqliteLocalCapabilities({
    atomicTransactions: true,
    interactiveTransactions: true,
    structuredCrud: true,
  });
  assert.equal(caps.db.layers.flatCrud, matrix.layers.athenaJs.flatCrud);
  assert.equal(caps.db.layers.relations, matrix.layers.athenaJs.nestedRelations);
  assert.equal(caps.db.transactions.atomic, matrix.layers.athenaJs.transactions.atomic);
  assert.equal(
    caps.db.transactions.interactive,
    matrix.layers.athenaJs.transactions.interactive,
  );
  assert.deepEqual(caps.db.transactions.isolationLevels, []);
  assert.equal(caps.db.transactions.savepoints, false);
});

test("createClient with compiler advertises structured CRUD and TX", async () => {
  const client = createClient({
    auth: false,
    db: { sqlite: { compiler, executor: executor(async () => result()) } },
  });
  assert.equal(client.capabilities.db.layers.flatCrud, true);
  assert.equal(client.capabilities.db.transactions.atomic, true);
  assert.equal(client.capabilities.db.transactions.interactive, true);
  await client.close();
});

test("runMigrations sqliteExecutor uses SqliteLocalMigrationBackend without PG translation", async () => {
  const sql: string[] = [];
  const injected = executor(async (statement) => {
    sql.push(statement);
    if (statement.includes("SELECT version, name")) {
      return {
        columns: [
          "version",
          "name",
          "checksum",
          "applied_at",
          "execution_ms",
          "execution_checksum",
        ],
        rows: [],
        changes: 0,
      };
    }
    return { columns: [], rows: [], changes: 0 };
  });
  const summary = await runMigrations({
    sqliteExecutor: injected,
    sqliteMigrations: [
      {
        checksum: "chk",
        filename: "0001_items.sql",
        name: "items",
        path: "migrations/0001_items.sql",
        sql: "CREATE TABLE items (id TEXT PRIMARY KEY)",
        version: 1,
      },
    ],
  });
  assert.equal(summary.providerLabel, "sqlite-local");
  assert.equal(summary.newlyApplied.length, 1);
  assert.equal(sql.some((statement) => statement.includes("CREATE TABLE items")), true);
  assert.equal(sql.some((statement) => /CREATE SCHEMA/i.test(statement)), false);
  const again = await runSqliteMigrations({
    executor: injected,
    migrations: [
      {
        checksum: "chk",
        filename: "0001_items.sql",
        name: "items",
        path: "migrations/0001_items.sql",
        sql: "CREATE TABLE items (id TEXT PRIMARY KEY)",
        version: 1,
      },
    ],
    dryRun: true,
  });
  assert.equal(again.databaseLabel, "sqlite-local");
});

test("TypeScript sqlite-local structured path does not emit SQL", () => {
  const sources = [
    "compiler.ts",
    "compatibility.ts",
    "transport.ts",
    "host-compiler.ts",
  ].map((name) =>
    readFileSync(
      join(here, "../src/sqlite-local", name),
      "utf8",
    ),
  );
  for (const source of sources) {
    assert.equal(/SELECT\s+\*\s+FROM\s+"/i.test(source), false);
    assert.equal(/INSERT INTO "/.test(source), false);
  }
});

test("SQLite Auth stores persist with SQLite placeholders and handlers start", async () => {
  const sql: string[] = [];
  const host = executor(async (statement, parameters) => {
    sql.push(statement);
    if (statement.startsWith("SELECT * FROM athena_auth_user")) {
      return {
        columns: ["id", "email", "name", "created_at", "updated_at", "email_verified", "banned", "two_factor_enabled", "metadata"],
        rows: [],
        changes: 0,
      };
    }
    if (statement.startsWith("SELECT")) {
      return { columns: [], rows: [], changes: 0 };
    }
    return { columns: [], rows: [], changes: 0, parameters };
  });
  const db = createSqliteAuthDatabase({ executor: host });
  const stores = await SqliteAuthStores.connect(db);
  const user = await stores.createUser({
    email: "ada@example.com",
    id: "user-1",
    name: "Ada",
  });
  assert.equal(user.id, "user-1");
  const connection = await stores.createIdentityConnection({
    authenticationRequired: true,
    clientId: "enterprise-client",
    connectionType: "oidc",
    credentialRef: null,
    domains: ["example.com"],
    enabled: true,
    id: "connection-1",
    issuer: "https://id.example.com",
    jitDefaultRoleId: null,
    jitEnabled: true,
    name: "Enterprise SSO",
    organizationId: "org-1",
    resource: null,
    tokenEndpointAuthMethod: "none",
  });
  assert.equal(connection.id, "connection-1");
  assert.equal(
    (await stores.findIdentityConnectionByDomain("EXAMPLE.COM"))?.id,
    "connection-1"
  );
  assert.equal(
    sql.some((statement) => statement.includes("INSERT INTO athena_auth_user") && statement.includes("?")),
    true,
  );
  assert.equal(
    sql.some((statement) => statement.includes("INSERT INTO athena_auth_identity_connection") && statement.includes("?")),
    true,
  );
  assert.equal(sql.some((statement) => statement.includes("$1")), false);
  const runtime = await createSqliteAuthRuntime({
    executor: host,
    secret: "test-secret-test-secret-test-secret",
    stores,
    database: db,
  });
  const response = await runtime.handle(new Request("http://localhost/api/auth/ok"));
  assert.equal(response.status < 500, true);
  await runtime.close();
});
