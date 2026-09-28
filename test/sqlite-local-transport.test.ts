import { strict as assert } from "node:assert";
import { test } from "node:test";
import type {
  AthenaSqliteExecutionResult,
  AthenaSqliteExecutor,
} from "../src/sqlite-local/contracts.ts";
import { normalizeSqliteExecutionResult } from "../src/sqlite-local/binds.ts";
import { createSqliteLocalTransport } from "../src/sqlite-local/transport.ts";

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
  rows: readonly (readonly (string | number | null)[])[],
): AthenaSqliteExecutionResult {
  return {
    columns: ["id", "value"],
    rows,
    changes: rows.length,
  };
}

test("SQLite Local structured CRUD is gated until a canonical compiler is injected", async () => {
  let calls = 0;
  const transport = createSqliteLocalTransport(
    executor(async () => {
      calls += 1;
      return result([["row-1", undefined as never]]);
    }),
  );
  const response = await transport.fetchGateway({ table_name: "items" });

  assert.equal(response.ok, false);
  assert.match(String(response.errorDetails?.message ?? response.error), /AthenaCanonicalQueryCompiler/);
  assert.equal(calls, 0);
});

test("SQLite Local structured CRUD executes compiled SQL from the injected compiler", async () => {
  let sql = "";
  let parameters: readonly unknown[] | undefined;
  const transport = createSqliteLocalTransport(
    executor(async (statement, values) => {
      sql = statement;
      parameters = values;
      return result([["row-1", 1]]);
    }),
    {
      async compile() {
        return {
          version: 1 as const,
          sql: "SELECT \"id\", \"value\" FROM \"items\" WHERE \"id\" = ?",
          params: [{ integer: 1 }],
          operation: "select",
          mutability: "read",
          result_shape: "rows",
          expected_cardinality: "zero_or_more",
          returning: "none",
          backend_profile: "sqlite_local",
          validation: { level: "full" },
          compiler: { crate_name: "athena-query", profile: "sqlite_local" },
        };
      },
    },
  );

  const response = await transport.fetchGateway({
    table_name: "items",
    conditions: [{ column: "id", operator: "eq", value: 1 }],
  });

  assert.equal(response.ok, true);
  assert.equal(sql, "SELECT \"id\", \"value\" FROM \"items\" WHERE \"id\" = ?");
  assert.deepEqual(parameters, [1]);
});

test("SQLite Local raw query execution remains available without structured compilation", async () => {
  let sql = "";
  let parameters: readonly unknown[] | undefined;
  const transport = createSqliteLocalTransport(
    executor(async (statement, values) => {
      sql = statement;
      parameters = values;
      return result([["row-1", "12.3400"]]);
    }),
  );

  const response = await transport.queryGateway({
    operation: "select",
    params: ["12.3400"],
    query: "SELECT id, value FROM items WHERE value = ?",
  });

  assert.equal(response.ok, true);
  assert.equal(sql, "SELECT id, value FROM items WHERE value = ?");
  assert.deepEqual(parameters, ["12.3400"]);
});

test("SQLite Local verifyConnection probes the injected executor", async () => {
  let calls = 0;
  const transport = createSqliteLocalTransport(
    executor(async (statement) => {
      calls += 1;
      assert.equal(statement, "SELECT 1");
      return { columns: ["1"], rows: [[1]] };
    }),
  );

  const result = await transport.verifyConnection();

  assert.equal(result.ok, true);
  assert.equal(result.reachable, true);
  assert.equal(calls, 1);
});

test("SQLite Local verifyConnection normalizes probe failures", async () => {
  const transport = createSqliteLocalTransport(
    executor(async () => {
      throw new Error("database is locked");
    }),
  );

  const result = await transport.verifyConnection();

  assert.equal(result.ok, false);
  assert.equal(result.reachable, false);
  assert.equal(result.status, 503);
  assert.equal(result.errorDetails?.code, "data_backend_unavailable");
});

test("SQLite Local rejects executor rows with a mismatched width", async () => {
  assert.throws(
    () =>
      normalizeSqliteExecutionResult({
        columns: ["id", "value"],
        rows: [["row-1"]],
      }),
    /row width.*columns/i,
  );
});

test("SQLite Local transport preserves normalized error details", async () => {
  const cases = [
    ["database is locked", "data_backend_unavailable", 10009, 503, true],
    ["abort requested", "data_query_cancelled", 10008, 408, false],
    [
      "SQLITE_CONSTRAINT: unique failed",
      "data_constraint_violation",
      10004,
      400,
      false,
    ],
    ["no such table: users", "data_relation_not_found", 10000, 404, false],
  ] as const;

  for (const [nativeMessage, code, errorNumber, status, retryable] of cases) {
    const transport = createSqliteLocalTransport(
      executor(async () => {
        throw new Error(nativeMessage);
      }),
    );

    const response = await transport.queryGateway({
      operation: "select",
      query: "SELECT 1",
    });

    assert.equal(response.ok, false);
    assert.equal(response.status, status);
    assert.equal(response.errorDetails?.code, code);
    assert.deepEqual(response.raw, {
      error: {
        code,
        errorNumber,
        kind:
          code === "data_backend_unavailable" ||
          code === "data_query_cancelled"
            ? "unavailable"
            : code === "data_relation_not_found"
              ? "not_found"
              : "validation",
        message: response.error,
        retry: retryable ? "safe" : "never",
      },
    });
    assert.equal(
      (response.errorDetails as { retryable?: boolean } | null)?.retryable,
      retryable,
    );
  }
});

test("SQLite Local structured inserts remain gated", async () => {
  let calls = 0;
  const transport = createSqliteLocalTransport(
    executor(async () => {
      calls += 1;
      return result(
        calls === 1
          ? [["row-1", 1]]
          : [
              ["row-1", 1],
              ["row-2", 2],
            ],
      );
    }),
  );

  const single = await transport.insertGateway({
    table_name: "items",
    insert_body: { id: "row-1", value: 1 },
  });
  const many = await transport.insertGateway({
    table_name: "items",
    insert_body: [
      { id: "row-1", value: 1 },
      { id: "row-2", value: 2 },
    ],
  });

  assert.equal(single.errorDetails?.code, "SQLITE_LOCAL_UNSUPPORTED");
  assert.equal(many.errorDetails?.code, "SQLITE_LOCAL_UNSUPPORTED");
  assert.equal(calls, 0);
});
