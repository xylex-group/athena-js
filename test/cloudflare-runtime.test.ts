import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  ATHENA_EXECUTION_MODE_ENV_KEY,
  ATHENA_EXECUTION_PREFER_ENV_KEY,
  createAthenaFromWorkerEnv,
  createAthenaRuntime,
  createAthenaRuntimeClient,
  resolveAthenaExecutionMode,
} from "../src/cloudflare/index.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "../src/cloudflare/types.ts";
import { AthenaConfigurationError } from "../src/config/errors.ts";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import type { AthenaGatewayResponse } from "../src/gateway/types.ts";

function mockD1(): D1DatabaseLike {
  return {
    async batch(statements: D1PreparedStatementLike[]) {
      return Promise.all(statements.map((s) => s.run()));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    prepare(query: string): D1PreparedStatementLike {
      let bound: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          if (query.includes("SELECT 1")) {
            return { meta: {}, results: [{ ok: 1 } as T], success: true };
          }
          return { meta: {}, results: [] as T[], success: true };
        },
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async first() {
          return null;
        },
        async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
          void bound;
          return { meta: { changes: 1 }, results: [] as T[], success: true };
        },
      };
      return statement;
    },
  };
}

function mockGatewayTransport(): AthenaGatewayClient {
  return {
    baseUrl: "https://gateway.test",
    buildHeaders: () => ({}),
    deleteGateway: async <_T = unknown>() => ({
      data: null,
      ok: true,
      raw: null,
      status: 200,
    }),
    fetchGateway: async <T = unknown>() =>
      ({
        count: 0,
        data: [] as T,
        ok: true,
        raw: [],
        status: 200,
      }) as AthenaGatewayResponse<T>,
    insertGateway: async <T = unknown>() =>
      ({
        data: null,
        ok: true,
        raw: null,
        status: 200,
      }) as AthenaGatewayResponse<T>,
    queryGateway: async <T = unknown>() =>
      ({
        count: 1,
        data: [{ via: "gateway" }] as T,
        ok: true,
        raw: [{ via: "gateway" }],
        status: 200,
      }) as AthenaGatewayResponse<T>,
    resolveCallOptions: async (options) => options,
    rpcGateway: async <_T = unknown>() => ({
      data: null,
      ok: true,
      raw: null,
      status: 200,
    }),
    updateGateway: async <_T = unknown>() => ({
      data: null,
      ok: true,
      raw: null,
      status: 200,
    }),
    verifyConnection: async () => ({
      baseUrl: "https://gateway.test",
      ok: true,
      raw: null,
      reachable: true,
      status: 200,
      url: "https://gateway.test",
    }),
  };
}

test("resolveAthenaExecutionMode auto prefers edge when d1 is set", () => {
  assert.equal(
    resolveAthenaExecutionMode({
      d1: mockD1(),
      url: "https://athena.example.com",
    }),
    "edge"
  );
});

test("resolveAthenaExecutionMode auto falls back to gateway when only url", () => {
  assert.equal(
    resolveAthenaExecutionMode({ url: "https://athena.example.com" }),
    "gateway"
  );
});

test("resolveAthenaExecutionMode reads ATHENA_DB_URL / ATHENA_GATEWAY_URL env keys", () => {
  assert.equal(
    resolveAthenaExecutionMode({
      env: { ATHENA_DB_URL: "https://db-via-env.example.com" },
      mode: "gateway",
    }),
    "gateway"
  );
  assert.equal(
    resolveAthenaExecutionMode({
      d1: mockD1(),
      env: { ATHENA_GATEWAY_URL: "https://gateway-via-env.example.com" },
      prefer: "gateway",
    }),
    "gateway"
  );
  assert.equal(
    resolveAthenaExecutionMode({
      d1: mockD1(),
      env: { NEXT_PUBLIC_ATHENA_DB_API_URL: "https://public-db.example.com" },
      prefer: "gateway",
    }),
    "gateway"
  );
});

test("resolveAthenaExecutionMode honors explicit gateway over d1", () => {
  assert.equal(
    resolveAthenaExecutionMode({
      d1: mockD1(),
      mode: "gateway",
      url: "https://athena.example.com",
    }),
    "gateway"
  );
});

test("resolveAthenaExecutionMode honors env ATHENA_EXECUTION_MODE", () => {
  assert.equal(
    resolveAthenaExecutionMode({
      d1: mockD1(),
      env: { [ATHENA_EXECUTION_MODE_ENV_KEY]: "server" },
      url: "https://athena.example.com",
    }),
    "gateway"
  );
  assert.equal(
    resolveAthenaExecutionMode({
      d1: mockD1(),
      env: { [ATHENA_EXECUTION_MODE_ENV_KEY]: "d1" },
    }),
    "edge"
  );
});

test("resolveAthenaExecutionMode edge without d1 throws", () => {
  assert.throws(
    () => resolveAthenaExecutionMode({ mode: "edge" }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.message.includes("no D1 binding")
  );
});

test("resolveAthenaExecutionMode auto with neither throws", () => {
  assert.throws(
    () => resolveAthenaExecutionMode({}),
    (error: unknown) => error instanceof AthenaConfigurationError
  );
});

test("createAthenaRuntime edge mode uses cloudflare capabilities", async () => {
  const { mode, client } = createAthenaRuntime({
    d1: mockD1(),
    mode: "edge",
  });
  assert.equal(mode, "edge");
  assert.equal(client.capabilities.mode, "cloudflare-edge");
  const result = await client.query("SELECT 1 AS ok");
  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ ok: 1 }]);
});

test("createAthenaRuntime gateway mode uses gateway capabilities and transport", async () => {
  const transport = mockGatewayTransport();
  const { mode, client } = createAthenaRuntime({
    gatewayTransport: transport as AthenaGatewayClient,
    key: "test-key",
    mode: "gateway",
    url: "https://athena.example.com",
  });
  assert.equal(mode, "gateway");
  assert.equal(client.capabilities.mode, "gateway");
  const result = await client.query("SELECT 1");
  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ via: "gateway" }]);
});

test("createAthenaRuntimeClient auto switches with d1", () => {
  const client = createAthenaRuntimeClient({
    d1: mockD1(),
    key: "k",
    mode: "auto",
    url: "https://should-not-use.example.com",
  });
  assert.equal(client.capabilities.mode, "cloudflare-edge");
});

test("createAthenaRuntimeClient gateway when mode forced", () => {
  const client = createAthenaRuntimeClient({
    d1: mockD1(),
    key: "k",
    mode: "gateway",
    url: "https://athena.example.com",
  });
  assert.equal(client.capabilities.mode, "gateway");
});

test("auto with both d1 and url prefers edge by default", () => {
  assert.equal(
    resolveAthenaExecutionMode({
      d1: mockD1(),
      url: "https://athena.example.com",
    }),
    "edge"
  );
});

test("auto with both d1 and url can prefer gateway", () => {
  assert.equal(
    resolveAthenaExecutionMode({
      d1: mockD1(),
      prefer: "gateway",
      url: "https://athena.example.com",
    }),
    "gateway"
  );
  assert.equal(
    resolveAthenaExecutionMode({
      d1: mockD1(),
      env: { [ATHENA_EXECUTION_PREFER_ENV_KEY]: "server" },
      url: "https://athena.example.com",
    }),
    "gateway"
  );
});

test("createAthenaFromWorkerEnv maps standard bindings", async () => {
  const { mode, client, capabilities } = createAthenaFromWorkerEnv({
    ATHENA_API_KEY: "k",
    ATHENA_EXECUTION_MODE: "auto",
    ATHENA_URL: "https://should-not-win.example.com",
    DB: mockD1(),
  });
  assert.equal(mode, "edge");
  assert.equal(capabilities.mode, "cloudflare-edge");
  const result = await client.query("SELECT 1 AS ok");
  assert.equal(result.error, null);
});

test("createAthenaFromWorkerEnv can force gateway with prefer", () => {
  const { mode, capabilities } = createAthenaFromWorkerEnv(
    {
      ATHENA_API_KEY: "k",
      ATHENA_URL: "https://athena.example.com",
      DB: mockD1(),
    },
    { prefer: "gateway" }
  );
  assert.equal(mode, "gateway");
  assert.equal(capabilities.mode, "gateway");
});

test("P2: createAthenaFromWorkerEnv forwards ATHENA_DB_URL for gateway mode", () => {
  // No D1 binding — gateway-only Worker using ATHENA_DB_URL (not ATHENA_URL).
  const { mode, capabilities } = createAthenaFromWorkerEnv({
    ATHENA_API_KEY: "k",
    ATHENA_DB_URL: "https://db-via-worker-env.example.com",
  });
  assert.equal(mode, "gateway");
  assert.equal(capabilities.mode, "gateway");
  assert.equal(capabilities.db.local, false);
});

test("P2: createAthenaFromWorkerEnv forwards ATHENA_GATEWAY_URL for prefer gateway", () => {
  const { mode, capabilities } = createAthenaFromWorkerEnv(
    {
      ATHENA_API_KEY: "k",
      ATHENA_GATEWAY_URL: "https://gateway-via-worker-env.example.com",
      DB: mockD1(),
    },
    { prefer: "gateway" }
  );
  assert.equal(mode, "gateway");
  assert.equal(capabilities.mode, "gateway");
});

test("P2: createAthenaFromWorkerEnv prefers ATHENA_URL over ATHENA_DB_URL", () => {
  const { mode } = createAthenaFromWorkerEnv({
    ATHENA_API_KEY: "k",
    ATHENA_DB_URL: "https://secondary.example.com",
    ATHENA_URL: "https://primary.example.com",
  });
  assert.equal(mode, "gateway");
});

test("P2: createAthenaFromWorkerEnv accepts API-key aliases (no ATHENA_API_KEY)", () => {
  for (const keyName of [
    "NEXT_PUBLIC_ATHENA_API_KEY",
    "ATHENA_GATEWAY_API_KEY",
    "X_API_KEY",
  ] as const) {
    const { mode, capabilities } = createAthenaFromWorkerEnv({
      ATHENA_URL: "https://alias-key.example.com",
      [keyName]: `secret-via-${keyName}`,
    });
    assert.equal(mode, "gateway", keyName);
    assert.equal(capabilities.mode, "gateway", keyName);
  }
});
