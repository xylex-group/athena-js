import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  AthenaError,
  AthenaErrorCategory,
  AthenaErrorCode,
  AthenaErrorKind,
  normalizeAthenaError,
} from "../src/index.ts";

test("AthenaError captures classification metadata and retryability", () => {
  const error = new AthenaError({
    category: AthenaErrorCategory.Transport,
    code: AthenaErrorCode.NetworkUnavailable,
    kind: AthenaErrorKind.Transient,
    message: "network failed",
    retryable: true,
    status: 0,
  });

  assert.equal(error.code, AthenaErrorCode.NetworkUnavailable);
  assert.equal(error.kind, AthenaErrorKind.Transient);
  assert.equal(error.category, AthenaErrorCategory.Transport);
  assert.equal(error.retryable, true);
});

test("normalizeAthenaError includes expanded classification details", () => {
  const normalized = normalizeAthenaError({
    data: null,
    error: "too many requests",
    raw: { reason: "rate limit" },
    status: 429,
  });
  assert.equal(normalized.kind, "rate_limit");
  assert.equal(normalized.code, AthenaErrorCode.RateLimited);
  assert.equal(normalized.category, AthenaErrorCategory.Server);
  assert.equal(normalized.retryable, true);
});
