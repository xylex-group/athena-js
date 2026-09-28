import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { AthenaConfigurationError } from "../src/config/errors.ts";
import type { AthenaPostgresPool } from "../src/postgres/driver.ts";
import {
  inferEmbeddedAuthMode,
  resolveAthenaRuntime,
} from "../src/runtime/resolve.ts";
import { createClient } from "../src/v3-client.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_finality_test";

test("resolveAthenaRuntime: Node + databaseUrl → postgres + embedded", () => {
  const plan = resolveAthenaRuntime(
    { databaseUrl: SAMPLE_PG, env: {} },
    { environment: "node", trustedNode: true }
  );
  assert.deepEqual(plan, {
    auth: { runtime: "embedded" },
    chat: { transport: "none" },
    db: { transport: "postgres" },
    runtime: { environment: "node" },
    storage: { transport: "none" },
  });
});

test("resolveAthenaRuntime: auth:false disables Auth and keeps postgres", () => {
  const plan = resolveAthenaRuntime(
    { auth: false, databaseUrl: SAMPLE_PG, env: {} },
    { environment: "node", trustedNode: true }
  );
  assert.equal(plan.auth.runtime, "disabled");
  assert.equal(plan.chat.transport, "none");
  assert.equal(plan.db.transport, "postgres");
});

test("resolveAthenaRuntime: auth.url wins over database URI", () => {
  const plan = resolveAthenaRuntime(
    {
      auth: { url: "https://auth.example.com" },
      databaseUrl: SAMPLE_PG,
      env: {},
    },
    { environment: "node", trustedNode: true }
  );
  assert.equal(plan.auth.runtime, "remote");
  assert.equal(plan.chat.transport, "none");
});

test("resolveAthenaRuntime: browser never embeds Auth or uses postgres", () => {
  const plan = resolveAthenaRuntime(
    { databaseUrl: SAMPLE_PG, env: {} },
    { environment: "browser", trustedNode: false }
  );
  assert.equal(plan.auth.runtime, "remote");
  assert.equal(plan.chat.transport, "none");
  assert.equal(plan.db.transport, "gateway");
  assert.equal(plan.runtime.environment, "browser");
});

test("resolveAthenaRuntime: explicit local off Node fails closed", () => {
  assert.throws(
    () =>
      resolveAthenaRuntime(
        { auth: { mode: "local" }, databaseUrl: SAMPLE_PG, env: {} },
        { environment: "browser", trustedNode: false }
      ),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_AUTH_LOCAL_NODE_REQUIRED" &&
      error.service === "auth"
  );
});

function inferredAuthRuntime(
  config: Parameters<typeof inferEmbeddedAuthMode>[0]
): "embedded" | "remote" | "disabled" {
  const next = inferEmbeddedAuthMode(config);
  if (next.auth === false) {
    return "disabled";
  }
  const mode =
    next.auth && typeof next.auth === "object" && "mode" in next.auth
      ? next.auth.mode
      : undefined;
  if (mode === "local") {
    return "embedded";
  }
  return "remote";
}

test("inferEmbeddedAuthMode: omitted mode + pgUri → local", () => {
  const next = inferEmbeddedAuthMode({
    auth: {},
    db: { pgUri: SAMPLE_PG },
  });
  assert.equal(
    next.auth && "mode" in next.auth ? next.auth.mode : undefined,
    "local"
  );
});

test("T-RES-10: inferEmbeddedAuthMode treats databaseUrl as the database URI", () => {
  const next = inferEmbeddedAuthMode({
    auth: {},
    databaseUrl: SAMPLE_PG,
    env: {},
  });
  assert.equal(
    next.auth && typeof next.auth === "object" && "mode" in next.auth
      ? next.auth.mode
      : undefined,
    "local"
  );
});

test("T-RES-11: inferEmbeddedAuthMode treats env.DATABASE_URL as the database URI", () => {
  const next = inferEmbeddedAuthMode({
    auth: {},
    env: { DATABASE_URL: SAMPLE_PG },
  });
  assert.equal(
    next.auth && typeof next.auth === "object" && "mode" in next.auth
      ? next.auth.mode
      : undefined,
    "local"
  );
});

test("T-RES-13: inferEmbeddedAuthMode treats db.pool as embedded Auth storage", () => {
  const next = inferEmbeddedAuthMode({
    auth: {},
    db: { pool: {} as AthenaPostgresPool },
  });
  assert.equal(
    next.auth && typeof next.auth === "object" && "mode" in next.auth
      ? next.auth.mode
      : undefined,
    "local"
  );
});

test("T-RES-12: inferEmbeddedAuthMode and resolveAthenaRuntime agree on Node raw configs", () => {
  const cases: Parameters<typeof inferEmbeddedAuthMode>[0][] = [
    { databaseUrl: SAMPLE_PG, env: {} },
    { env: { DATABASE_URL: SAMPLE_PG } },
    { db: { pgUri: SAMPLE_PG }, env: {} },
    { db: { pool: {} as AthenaPostgresPool }, env: {} },
    {
      auth: { url: "https://auth.example.com" },
      databaseUrl: SAMPLE_PG,
      env: {},
    },
    { auth: false, databaseUrl: SAMPLE_PG, env: {} },
    { auth: { mode: "remote" }, databaseUrl: SAMPLE_PG, env: {} },
    { env: {}, key: "k", url: "https://gw.example.com" },
  ];
  for (const config of cases) {
    const plan = resolveAthenaRuntime(config, {
      environment: "node",
      trustedNode: true,
    });
    assert.equal(
      inferredAuthRuntime(config),
      plan.auth.runtime,
      `disagreement on ${JSON.stringify(config)}`
    );
  }
});

test("createClient exposes redacted system.runtime() snapshot", () => {
  const client = createClient({
    databaseUrl: SAMPLE_PG,
    env: {},
  });
  assert.deepEqual(client.system.runtime(), {
    auth: "embedded",
    chat: "none",
    database: "postgres-direct",
    runtime: "node",
    storage: "none",
  });
});

test("resolveAthenaRuntime reports a local Chat runtime when Chat is configured", () => {
  const plan = resolveAthenaRuntime(
    { chat: true, databaseUrl: SAMPLE_PG, env: {} },
    { environment: "node", trustedNode: true }
  );
  assert.equal(plan.chat.transport, "local");
});

test("resolveAthenaRuntime reports remote Chat without claiming local materialization", () => {
  const plan = resolveAthenaRuntime(
    {
      chat: { url: "https://chat.example.com" },
      databaseUrl: SAMPLE_PG,
      env: {},
    },
    { environment: "node", trustedNode: true }
  );
  assert.equal(plan.chat.transport, "remote");
});
