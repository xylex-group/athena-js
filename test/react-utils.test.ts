import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { AthenaGatewayError } from "../src/gateway/errors.ts";
import {
  matchesQueryKey,
  normalizeAthenaError,
  normalizeAthenaResult,
  runWithRetry,
  safeSerializeQueryKey,
} from "../src/react/utils.ts";

test("matchesQueryKey uses structural tuple prefix and never string prefix", () => {
  assert.equal(
    matchesQueryKey(
      ["athena", "read-query", "files", 1],
      ["athena", "read-query"]
    ),
    true
  );
  assert.equal(
    matchesQueryKey(["athena-read-query"], ["athena"]),
    false,
    "first tuple element must equal, not start with, the filter"
  );
  assert.equal(matchesQueryKey("athena-files", "athena"), false);
  assert.equal(matchesQueryKey("athena", "athena"), true);
  assert.equal(matchesQueryKey(["athena"], "athena"), false);
  assert.equal(matchesQueryKey("athena", ["athena"]), false);
  assert.equal(
    matchesQueryKey(
      ["athena", "read-query", "files"],
      ["athena", "read-query"],
      true
    ),
    false
  );
  assert.equal(
    matchesQueryKey(
      ["athena", { org: "a" }, "files"],
      ["athena", { org: "a" }]
    ),
    true
  );
  assert.equal(
    matchesQueryKey(["athena", { org: "a" }], ["athena", { org: "b" }]),
    false
  );
});

test("safeSerializeQueryKey handles primitive arrays and strings consistently", () => {
  const a = safeSerializeQueryKey(["users", 1, true, null, undefined]);
  const b = safeSerializeQueryKey(["users", 1, true, null, undefined]);
  const c = safeSerializeQueryKey("users");

  assert.equal(a, b);
  assert.equal(c, "key:users");
});

test("safeSerializeQueryKey handles circular objects safely", () => {
  const obj: Record<string, unknown> = { name: "circle" };
  obj.self = obj;

  const token = safeSerializeQueryKey(["k", obj]);
  assert.equal(token.includes("[circular]"), true);
});

test("safeSerializeQueryKey avoids primitive-array token collisions with delimiter characters", () => {
  const first = safeSerializeQueryKey(["a|str:b", "c"]);
  const second = safeSerializeQueryKey(["a", "b", "c"]);
  assert.notEqual(first, second);
});

test("normalizeAthenaResult unwraps envelope success and applies select", () => {
  const result = normalizeAthenaResult<{ id: number }[], number[]>(
    {
      data: [{ id: 1 }, { id: 2 }],
      error: null,
      raw: { source: "x" },
      status: 200,
    },
    (rows) => rows.map((row) => row.id)
  );

  assert.equal(result.error, null);
  assert.deepEqual(result.data, [1, 2]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.raw, { source: "x" });
});

test("normalizeAthenaResult maps envelope errors to AthenaQueryError", () => {
  const result = normalizeAthenaResult({
    data: null,
    error: "denied",
    raw: { code: "E403" },
    status: 403,
  });

  assert.equal(result.data, undefined);
  assert.equal(result.error?.message, "denied");
  assert.equal(result.error?.status, 403);
  assert.equal(result.status, 403);
});

test("normalizeAthenaResult treats non-envelope status fields as raw data", () => {
  const result = normalizeAthenaResult({ id: 1, status: "active" });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { id: 1, status: "active" });
  assert.equal(result.status, 200);
});

test("normalizeAthenaResult preserves explicit null data from Athena envelopes", () => {
  const result = normalizeAthenaResult({
    data: null,
    error: null,
    raw: { source: "null" },
    status: 200,
  });
  assert.equal(result.error, null);
  assert.equal(result.data, null);
  assert.equal(result.status, 200);
});

test("normalizeAthenaError converts AthenaGatewayError to query error shape", () => {
  const gatewayError = new AthenaGatewayError({
    code: "HTTP_ERROR",
    endpoint: "/gateway/fetch",
    message: "gateway failed",
    method: "POST",
    status: 500,
  });

  const normalized = normalizeAthenaError(gatewayError);
  assert.equal(normalized.message, "gateway failed");
  assert.equal(normalized.status, 500);
  assert.equal(normalized.code, "HTTP_ERROR");
});

test("runWithRetry retries until success with retryDelay callback", async () => {
  let attempts = 0;
  const seenDelayAttempts: number[] = [];

  const result = await runWithRetry(
    async (attempt) => {
      attempts = attempt;
      if (attempt < 3) {
        throw new Error(`attempt-${attempt}`);
      }
      return "ok";
    },
    {
      retry: 2,
      retryDelay: (attempt) => {
        seenDelayAttempts.push(attempt);
        return 0;
      },
    }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(seenDelayAttempts, [1, 2]);
});
