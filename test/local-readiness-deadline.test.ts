import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import { waitForPostgres } from "../src/local/readiness.ts";

test("local postgres readiness bounds a hanging query by its deadline", async () => {
  let ended = false;
  const pending = waitForPostgres({
    createManager: () => ({
      async close() {
        ended = true;
      },
      async query<T extends QueryResultRow = QueryResultRow>(): Promise<
        QueryResult<T>
      > {
        return new Promise<QueryResult<T>>(() => {});
      },
    }),
    connectionString: "postgres://localhost/postgres",
    timeoutMs: 40,
  });
  const result = await Promise.race([
    pending.then(
      () => "ready" as const,
      (error: unknown) => error,
    ),
    new Promise<"deadline">((resolve) =>
      setTimeout(() => resolve("deadline"), 150),
    ),
  ]);
  assert.notEqual(result, "deadline", "readiness query ignored its deadline");
  assert.ok(result instanceof Error);
  assert.match(result.message, /did not become ready/i);
  assert.equal(ended, true);
});

test("local postgres readiness preserves query errors while closing the client", async () => {
  const queryError = new Error("database is still starting");
  let ended = false;
  await assert.rejects(
    waitForPostgres({
      createManager: () => ({
        async close() {
          ended = true;
        },
        async query() {
          throw queryError;
        },
      }),
      connectionString: "postgres://localhost/postgres",
      intervalMs: 1,
      timeoutMs: 20,
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.cause === queryError &&
      /did not become ready/i.test(error.message),
  );
  assert.equal(ended, true);
});

test("local postgres readiness closes the manager after a hanging query", async () => {
  let ended = false;
  const pending = waitForPostgres({
    createManager: () => ({
      async close() {
        ended = true;
      },
      async query<T extends QueryResultRow = QueryResultRow>(): Promise<
        QueryResult<T>
      > {
        return new Promise<QueryResult<T>>(() => {});
      },
    }),
    connectionString: "postgres://localhost/postgres",
    timeoutMs: 40,
  });
  const result = await Promise.race([
    pending.then(
      () => "ready" as const,
      (error: unknown) => error,
    ),
    new Promise<"deadline">((resolve) =>
      setTimeout(() => resolve("deadline"), 150),
    ),
  ]);
  assert.notEqual(
    result,
    "deadline",
    "readiness connection ignored its deadline",
  );
  assert.ok(result instanceof Error);
  assert.match(result.message, /did not become ready/i);
  assert.equal(ended, true);
});
