import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  AthenaAuthOperationError,
  isAuthorizationAssignmentConflict,
  requireAthenaAuthResult,
} from "../src/auth/authorization/result.ts";
import type { AthenaAuthResult } from "../src/auth/types.ts";

test("requireAthenaAuthResult throws structured conflict errors", () => {
  const result: AthenaAuthResult<never> = {
    data: null,
    error: "Assignment version conflict",
    errorDetails: {
      code: "AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT",
      message: "Assignment version conflict",
      status: 409,
    },
    ok: false,
    raw: { code: "AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT" },
    status: 409,
  };
  assert.throws(
    () => requireAthenaAuthResult(result),
    (error: unknown) =>
      error instanceof AthenaAuthOperationError &&
      isAuthorizationAssignmentConflict(error) &&
      error.status === 409 &&
      error.retry === true
  );
});

test("requireAthenaAuthResult returns data on ok", () => {
  const result: AthenaAuthResult<{ revision: number }> = {
    data: { revision: 6 },
    error: null,
    errorDetails: null,
    ok: true,
    raw: { revision: 6 },
    status: 200,
  };
  assert.deepEqual(requireAthenaAuthResult(result), { revision: 6 });
});
