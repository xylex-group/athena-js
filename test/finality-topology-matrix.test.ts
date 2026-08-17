import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { AthenaConfigurationError } from "../src/config/errors.ts";
import { ATHENA_TOPOLOGY_MATRIX } from "../src/runtime/topology-matrix.ts";
import { resolveAthenaRuntime } from "../src/runtime/resolve.ts";

test("ATHENA_TOPOLOGY_MATRIX is the executable topology authority", () => {
  assert.ok(ATHENA_TOPOLOGY_MATRIX.length >= 10);
  for (const row of ATHENA_TOPOLOGY_MATRIX) {
    if (row.throws) {
      assert.throws(
        () =>
          resolveAthenaRuntime(row.input, {
            environment: row.environment,
            trustedNode: row.trustedNode,
          }),
        (error: unknown) =>
          error instanceof AthenaConfigurationError && error.code === row.throws
      );
      continue;
    }
    const plan = resolveAthenaRuntime(row.input, {
      environment: row.environment,
      trustedNode: row.trustedNode,
    });
    assert.equal(plan.auth.runtime, row.expect.auth, row.id);
    assert.equal(plan.db.transport, row.expect.db, row.id);
    assert.equal(plan.storage.transport, row.expect.storage, row.id);
    assert.equal(plan.runtime.environment, row.environment, row.id);
  }
});
