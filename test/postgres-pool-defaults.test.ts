import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  ATHENA_POSTGRES_POOL_DEFAULTS,
  createPostgresPool,
} from "../src/postgres/driver.ts";

test("createPostgresPool applies a connection timeout by default", async () => {
  const pool = await createPostgresPool(
    "postgresql://postgres@127.0.0.1:1/athena_pool_defaults"
  );
  try {
    const options = (
      pool as unknown as {
        options: {
          application_name?: string;
          connectionTimeoutMillis?: number;
          idleTimeoutMillis?: number;
          max?: number;
        };
      }
    ).options;
    assert.equal(
      options.connectionTimeoutMillis,
      ATHENA_POSTGRES_POOL_DEFAULTS.connectionTimeoutMillis
    );
    assert.equal(
      options.idleTimeoutMillis,
      ATHENA_POSTGRES_POOL_DEFAULTS.idleTimeoutMillis
    );
    assert.equal(options.max, ATHENA_POSTGRES_POOL_DEFAULTS.max);
    assert.equal(
      options.application_name,
      ATHENA_POSTGRES_POOL_DEFAULTS.application_name
    );
  } finally {
    await pool.end();
  }
});

test("createPostgresPool lets callers override connectionTimeoutMillis", async () => {
  const pool = await createPostgresPool(
    "postgresql://postgres@127.0.0.1:1/athena_pool_override",
    { connectionTimeoutMillis: 500, max: 2 }
  );
  try {
    const options = (
      pool as unknown as {
        options: { connectionTimeoutMillis?: number; max?: number };
      }
    ).options;
    assert.equal(options.connectionTimeoutMillis, 500);
    assert.equal(options.max, 2);
  } finally {
    await pool.end();
  }
});
