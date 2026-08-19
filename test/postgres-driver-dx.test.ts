import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { AthenaConfigurationError } from "../src/config/errors.ts";
import {
  ATHENA_POSTGRES_DRIVER_MISSING_MESSAGE,
  postgresDriverMissingError,
} from "../src/postgres/driver.ts";
import { createAthenaPostgresRuntime } from "../src/postgres/owned-runtime.ts";

test("pg missing error uses ATHENA_POSTGRES_DRIVER_MISSING", () => {
  const error = postgresDriverMissingError();
  assert.ok(error instanceof AthenaConfigurationError);
  assert.equal(error.code, "ATHENA_POSTGRES_DRIVER_MISSING");
  assert.equal(error.message, ATHENA_POSTGRES_DRIVER_MISSING_MESSAGE);
  assert.match(error.message, /pnpm add pg/);
});

test("owned postgres runtimes are reused for the same connection string", () => {
  const uri = "postgresql://postgres@127.0.0.1:5432/athena_hmr_pool";
  const first = createAthenaPostgresRuntime({ connectionString: uri });
  const second = createAthenaPostgresRuntime({ connectionString: uri });
  assert.equal(first, second);
  assert.equal(first.ownership, "owned");
});

test("closing an owned runtime evicts the HMR cache", async () => {
  const uri = "postgresql://postgres@127.0.0.1:5432/athena_hmr_pool_close";
  const first = createAthenaPostgresRuntime({ connectionString: uri });
  await first.close();
  const second = createAthenaPostgresRuntime({ connectionString: uri });
  assert.notEqual(first, second);
});
