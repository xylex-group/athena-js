import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  executeD1Batch,
  executeD1Query,
  isMultiStatement,
  splitSqlStatements,
  sqlFirstKeywordOutsideLiterals,
  statementExpectsResultRows,
} from "../src/cloudflare/d1/runner.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/cloudflare/types.ts";

function createMockD1(options?: {
  rows?: unknown[];
  changes?: number;
}): D1DatabaseLike & { lastSql?: string; lastParams?: unknown[] } {
  const db: D1DatabaseLike & { lastSql?: string; lastParams?: unknown[] } = {
    async batch(statements: D1PreparedStatementLike[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    async exec() {
      return { count: 1, duration: 1 };
    },
    prepare(query: string): D1PreparedStatementLike {
      db.lastSql = query;
      const statement: D1PreparedStatementLike = {
        async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          return {
            meta: { duration: 2 },
            results: (options?.rows ?? []) as T[],
            success: true,
          };
        },
        bind(...values: unknown[]) {
          db.lastParams = values;
          return statement;
        },
        async first() {
          return null;
        },
        async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          return {
            meta: { changes: options?.changes ?? 1, duration: 1 },
            results: (options?.rows ?? []) as T[],
            success: true,
          };
        },
      };
      return statement;
    },
  };
  return db as D1DatabaseLike & { lastSql?: string; lastParams?: unknown[] };
}

test("executeD1Query runs SELECT via all()", async () => {
  const db = createMockD1({ rows: [{ ok: 1 }] });
  const result = await executeD1Query(db as D1DatabaseLike, {
    query: "SELECT 1 AS ok",
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.rows, [{ ok: 1 }]);
  assert.equal(result.count, 1);
  assert.equal(db.lastSql, "SELECT 1 AS ok");
});

test("executeD1Query binds params on writes", async () => {
  const db = createMockD1({ changes: 1 });
  const result = await executeD1Query(db as D1DatabaseLike, {
    params: ["a@example.com"],
    query: "INSERT INTO users (email) VALUES (?)",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(db.lastParams, ["a@example.com"]);
});

test("executeD1Query uses run() when RETURNING only appears inside a string", async () => {
  const calls: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      void query;
      const statement: D1PreparedStatementLike = {
        async all() {
          calls.push("all");
          return {
            meta: { changes: 3 },
            results: [],
            success: true,
          };
        },
        bind(...values: unknown[]) {
          void values;
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          calls.push("run");
          return {
            meta: { changes: 3 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };
  const result = await executeD1Query(db as D1DatabaseLike, {
    params: ["n1"],
    query: `UPDATE notes SET body = 'RETURNING' WHERE id = ?`,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.count, 3);
  assert.deepEqual(calls, ["run"]);
});

test("executeD1Query uses all() for INSERT RETURNING", async () => {
  const calls: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      void query;
      const statement: D1PreparedStatementLike = {
        async all() {
          calls.push("all");
          return {
            meta: { changes: 1 },
            results: [{ email: "a@example.com", id: "1" }],
            success: true,
          };
        },
        bind(...values: unknown[]) {
          void values;
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          calls.push("run");
          return {
            meta: { changes: 1 },
            results: [],
            success: true,
          };
        },
      };
      return statement;
    },
  };
  const result = await executeD1Query(db as D1DatabaseLike, {
    params: ["a@example.com"],
    query: "INSERT INTO users (email) VALUES (?) RETURNING id, email",
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.rows, [{ email: "a@example.com", id: "1" }]);
  assert.deepEqual(calls, ["all"]);
});

test("executeD1Query rejects multi-statement with params", async () => {
  const db = createMockD1();
  const result = await executeD1Query(db as D1DatabaseLike, {
    params: [1],
    query: "SELECT 1; SELECT 2",
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.error, "invalid_query");
});

test("executeD1Batch requires statements", async () => {
  const db = createMockD1();
  const result = await executeD1Batch(db, { statements: [] });
  assert.equal(result.ok, false);
});

test("isMultiStatement ignores semicolons inside strings and comments", () => {
  assert.equal(isMultiStatement("SELECT ';' AS value"), false);
  assert.equal(isMultiStatement('SELECT "a;b" AS value'), false);
  assert.equal(isMultiStatement("SELECT 1 AS `a;b`"), false);
  assert.equal(isMultiStatement("SELECT 1 AS [a;b]"), false);
  assert.equal(isMultiStatement("SELECT '/* not a comment */' AS x"), false);
  assert.equal(
    isMultiStatement("-- only a comment; still one segment\nSELECT 1"),
    false
  );
  assert.equal(isMultiStatement("SELECT 1; SELECT 2"), true);
  assert.equal(isMultiStatement("SELECT 1; -- tail\nSELECT 2"), true);
});

test("splitSqlStatements keeps CREATE TRIGGER body as one statement", () => {
  const ddl = `
CREATE TEMP TRIGGER IF NOT EXISTS bump AFTER INSERT ON t
BEGIN
  UPDATE t SET n = n + 1 WHERE id = NEW.id;
  INSERT INTO log(msg) VALUES ('ins');
END
`.trim();
  const parts = splitSqlStatements(ddl);
  assert.equal(parts.length, 1);
  assert.match(parts[0]!, /UPDATE t SET n/i);
  assert.match(parts[0]!, /INSERT INTO log/i);
  assert.equal(isMultiStatement(ddl), false);
});

test("splitSqlStatements keeps CREATE TRIGGER body when comments separate keywords", () => {
  const withBlockComment = `
CREATE /* audit */ TRIGGER t1 AFTER INSERT ON items
BEGIN
  UPDATE items SET n = n + 1 WHERE id = NEW.id;
  INSERT INTO audit(msg) VALUES ('ins');
END
`.trim();
  const withLineComment = `
CREATE -- temp-ish
TEMP -- keyword
TRIGGER t2 AFTER UPDATE ON items
BEGIN
  INSERT INTO audit(msg) VALUES ('upd');
END
`.trim();
  for (const ddl of [withBlockComment, withLineComment]) {
    const parts = splitSqlStatements(ddl);
    assert.equal(parts.length, 1, ddl);
    assert.match(parts[0]!, /INSERT INTO audit/i);
    assert.equal(isMultiStatement(ddl), false);
  }
});

test("multi-statement with session uses batch not exec", async () => {
  const batchCalls: string[] = [];
  let execCalled = false;
  const db = {
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      batchCalls.push(`batch:${statements.length}`);
      return Promise.all(statements.map((statement) => statement.run()));
    },
    async exec() {
      execCalled = true;
      return { count: 0, duration: 0 };
    },
    prepare(query: string) {
      const sql = query;
      return {
        async all() {
          return this.run();
        },
        bind() {
          return this;
        },
        async first() {
          return null;
        },
        async run() {
          // Real D1 batch returns SELECT rows on the result object.
          if (/^\s*SELECT\s+1\b/i.test(sql)) {
            return { meta: {}, results: [{ a: 1 }], success: true };
          }
          if (/^\s*SELECT\s+2\b/i.test(sql)) {
            return { meta: {}, results: [{ b: 2 }], success: true };
          }
          return { meta: {}, results: [], success: true };
        },
      };
    },
    withSession() {
      return {
        batch: db.batch.bind(db),
        // no exec on session
        getBookmark: () => "bm-1",
        prepare: db.prepare.bind(db),
      };
    },
  };

  const result = await executeD1Query(db as D1DatabaseLike, {
    query: "SELECT 1; SELECT 2",
    sessionMode: "first-unconstrained",
  });
  assert.equal(result.ok, true);
  assert.equal(execCalled, false);
  assert.deepEqual(batchCalls, ["batch:2"]);
  if (!result.ok) {
    return;
  }
  // P2: Preserve result rows from multi-statement queries
  assert.deepEqual(result.rows, [{ a: 1 }, { b: 2 }]);
  assert.equal(result.count, 2);
});

test("P2: multi-statement SELECT without session uses batch and returns rows", async () => {
  let execCalled = false;
  const db = {
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    async exec() {
      execCalled = true;
      return { count: 2, duration: 1 };
    },
    prepare(query: string) {
      const sql = query;
      return {
        async all() {
          return this.run();
        },
        bind() {
          return this;
        },
        async first() {
          return null;
        },
        async run() {
          if (/SELECT\s+1\s+AS\s+a/i.test(sql)) {
            return { meta: {}, results: [{ a: 1 }], success: true };
          }
          if (/SELECT\s+2\s+AS\s+b/i.test(sql)) {
            return { meta: {}, results: [{ b: 2 }], success: true };
          }
          return { meta: {}, results: [], success: true };
        },
      };
    },
  };

  const result = await executeD1Query(db as D1DatabaseLike, {
    query: "SELECT 1 AS a; SELECT 2 AS b",
  });
  assert.equal(result.ok, true);
  // Prefer batch so rows are available (exec only returns counts).
  assert.equal(execCalled, false);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.rows, [{ a: 1 }, { b: 2 }]);
  assert.equal(result.count, 2);
});

test("P2: VALUES statements are row-producing (use all(), not run())", async () => {
  assert.equal(statementExpectsResultRows("VALUES (1)"), true);
  assert.equal(statementExpectsResultRows("VALUES (1), (2)"), true);
  assert.equal(
    statementExpectsResultRows("WITH x(a) AS (VALUES (1)) VALUES (2)"),
    true
  );
  assert.equal(
    statementExpectsResultRows("WITH x(a) AS (VALUES (1)) SELECT * FROM x"),
    true
  );
  // INSERT … VALUES is still a mutation without RETURNING
  assert.equal(
    statementExpectsResultRows("INSERT INTO t (x) VALUES (1)"),
    false
  );

  const calls: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(): D1PreparedStatementLike {
      const statement: D1PreparedStatementLike = {
        async all() {
          calls.push("all");
          return {
            meta: { changes: 0 },
            results: [{ column1: 1 }],
            success: true,
          };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          calls.push("run");
          return { meta: { changes: 0 }, results: [], success: true };
        },
      };
      return statement;
    },
  };
  const result = await executeD1Query(db as D1DatabaseLike, {
    query: "VALUES (1)",
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.rows, [{ column1: 1 }]);
  assert.deepEqual(calls, ["all"]);
});

test("P2: Skip leading comments when classifying row-producing SQL", async () => {
  assert.equal(
    sqlFirstKeywordOutsideLiterals("-- diagnostic\nSELECT 1"),
    "SELECT"
  );
  assert.equal(
    sqlFirstKeywordOutsideLiterals(
      "/* block */\nWITH x AS (SELECT 1) SELECT * FROM x"
    ),
    "WITH"
  );
  assert.equal(
    statementExpectsResultRows("-- diagnostic\nSELECT 1 AS ok"),
    true
  );
  assert.equal(
    statementExpectsResultRows("/* skip */ INSERT INTO t (x) VALUES (1)"),
    false
  );

  // WITH … SELECT is row-producing; WITH … UPDATE without RETURNING is not.
  assert.equal(
    statementExpectsResultRows("WITH x AS (SELECT 1 AS id) SELECT * FROM x"),
    true
  );
  assert.equal(
    statementExpectsResultRows(
      "WITH ids AS (SELECT id FROM items WHERE active = 1) UPDATE items SET flag = 1 WHERE id IN (SELECT id FROM ids)"
    ),
    false
  );
  assert.equal(
    statementExpectsResultRows(
      "WITH ids AS (SELECT id FROM items) DELETE FROM items WHERE id IN ids RETURNING id"
    ),
    true
  );

  const calls: string[] = [];
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      void query;
      const statement: D1PreparedStatementLike = {
        async all() {
          calls.push("all");
          return {
            meta: { duration: 1 },
            results: [{ ok: 1 }],
            success: true,
          };
        },
        bind(...values: unknown[]) {
          void values;
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          calls.push("run");
          return { meta: { changes: 0 }, results: [], success: true };
        },
      };
      return statement;
    },
  };

  const result = await executeD1Query(db as D1DatabaseLike, {
    query: "-- diagnostic\nSELECT 1 AS ok",
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(calls, ["all"]);
  assert.deepEqual(result.rows, [{ ok: 1 }]);
});

test("executeD1Query treats semicolon-in-string as single statement", async () => {
  const db = createMockD1({ rows: [{ value: ";" }] });
  const result = await executeD1Query(db as D1DatabaseLike, {
    query: "SELECT ';' AS value",
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.rows, [{ value: ";" }]);
  assert.equal(db.lastSql, "SELECT ';' AS value");
});

test("P2: WITH CTE mutation uses run() and meta.changes for count", async () => {
  const calls: string[] = [];
  const sql =
    "WITH ids AS (SELECT id FROM items WHERE active = 1) UPDATE items SET flag = 1 WHERE id IN (SELECT id FROM ids)";
  const db = {
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(): D1PreparedStatementLike {
      const statement: D1PreparedStatementLike = {
        async all() {
          calls.push("all");
          return { meta: { changes: 42 }, results: [], success: true };
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          calls.push("run");
          return { meta: { changes: 42 }, results: [], success: true };
        },
      };
      return statement;
    },
  };

  const result = await executeD1Query(db as D1DatabaseLike, { query: sql });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(calls, ["run"]);
  assert.equal(result.count, 42);
  assert.deepEqual(result.rows, []);
});

test("P2: multi-statement mutations sum meta.changes for count", async () => {
  const db = {
    async batch(statements: D1PreparedStatementLike[]) {
      return Promise.all(statements.map((s) => s.run()));
    },
    async exec() {
      return { count: 2, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      const statement: D1PreparedStatementLike = {
        async all() {
          return statement.run();
        },
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async run() {
          const changes = /SET a/.test(query) ? 60 : 40;
          return { meta: { changes }, results: [], success: true };
        },
      };
      return statement;
    },
  };

  const result = await executeD1Query(db as D1DatabaseLike, {
    query:
      "UPDATE t SET a = 1 WHERE id < 100; UPDATE t SET b = 2 WHERE id >= 100",
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.rows, []);
  assert.equal(result.count, 100);
  assert.equal(result.statementCount, 2);
});
