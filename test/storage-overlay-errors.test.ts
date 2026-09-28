import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { AthenaStorageError } from "../src/storage/runtime/errors.ts";
import {
  projectStorageRuntimeError,
  unwrapStorageRuntimeResult,
} from "../src/storage/runtime/overlays.ts";

test("storage overlay unwrap preserves runtime errorNumber and code", () => {
  const result = {
    error: {
      code: "storage_file_not_found",
      errorNumber: 3005,
      message: "missing.bin",
    },
    ok: false,
    status: 404,
  };
  const projected = projectStorageRuntimeError(result, "get");
  assert.equal(projected instanceof AthenaStorageError, true);
  assert.equal(projected.status, 404);
  assert.equal(projected.code, "storage_file_not_found");
  assert.equal(projected.errorNumber, 3005);
  assert.throws(
    () => unwrapStorageRuntimeResult(result, "get"),
    (error: unknown) =>
      error instanceof AthenaStorageError && error.status === 404
  );
});
