import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../src/auth/contract/index.ts";
import { createAthenaDataHandlers } from "../src/next/data-handlers.ts";
import {
  AthenaRuntimeOwnershipError,
  attachAthenaClientInternals,
  getAthenaClientInternals,
  getAthenaRuntimeDiagnostics,
} from "../src/runtime/client-internals.ts";
import { athenaRuntimeCounters } from "../src/runtime/ownership.ts";
import { createAthenaPostgresRuntime } from "../src/postgres/owned-runtime.ts";
import { createClient } from "../src/v3-client.ts";

function mockTransport(): AthenaGatewayClient {
  const ok = async () =>
    ({
      count: null,
      data: [],
      error: null,
      ok: true,
      raw: { data: [] },
      status: 200,
      statusText: "OK",
    }) as never;
  return {
    baseUrl: "https://athena.local/postgres-direct",
    buildHeaders() {
      return {};
    },
    deleteGateway: ok,
    fetchGateway: ok,
    insertGateway: ok,
    queryGateway: ok,
    async resolveCallOptions(options) {
      return options;
    },
    rpcGateway: ok,
    updateGateway: ok,
    async verifyConnection() {
      return { ok: true } as never;
    },
  };
}

test("HMR remounts reuse one Postgres runtime and one Auth runtime", () => {
  const uri = "postgresql://postgres@127.0.0.1:5432/athena_hmr_ownership";
  const before = { ...athenaRuntimeCounters() };
  const roots = Array.from({ length: 100 }, () =>
    createClient({
      auth: { mode: "local" },
      databaseUrl: uri,
      gatewayTransport: mockTransport(),
    }),
  );
  const after = athenaRuntimeCounters();
  assert.equal(after.postgresPoolsCreated - before.postgresPoolsCreated, 1);
  assert.equal(after.authRuntimesCreated - before.authRuntimesCreated, 1);

  const first = getAthenaRuntimeDiagnostics(roots[0]);
  const last = getAthenaRuntimeDiagnostics(roots[99]);
  assert.ok(first);
  assert.ok(last);
  assert.equal(first.ownership, "root");
});

test("root internals stay readable after freeze via the process-global map", () => {
	const root = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_global_map",
		gatewayTransport: mockTransport(),
	});
	assert.ok(Object.isFrozen(root));
	assert.ok(getAthenaClientInternals(root));
	const mapKey = Symbol.for("@xylex-group/athena.clientInternalsMap");
	const map = (globalThis as Record<symbol, WeakMap<object, unknown>>)[mapKey];
	assert.ok(map instanceof WeakMap);
	assert.ok(map.get(root));
});

test("request views share the root runtime id and cannot close it", async () => {
  const root = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_view_close",
    gatewayTransport: mockTransport(),
  });
  const view = root.withContext({ userId: "u1" });
  await (view as unknown as typeof root).close();
  const afterViewClose = getAthenaRuntimeDiagnostics(root);
  assert.equal(afterViewClose?.closed, false);
  assert.equal(afterViewClose?.requestViewsCreated, 1);
});

test("incompatible internals protocol is a foreign-runtime mismatch", () => {
  const root = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_protocol",
    gatewayTransport: mockTransport(),
  });
  const internals = getAthenaClientInternals(root);
  assert.ok(internals);
  attachAthenaClientInternals(root, {
    ...internals,
    internalProtocolVersion: 0,
  });
  assert.throws(
    () =>
      createAthenaDataHandlers({
        client: root,
        security: { mode: "trusted" },
        unsafeAllowUnauthenticated: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaRuntimeOwnershipError);
      assert.equal(error.code, "ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH");
      assert.equal(error.received, "foreign-runtime");
      return true;
    },
  );
});

test("session cookie identity reaches authenticated data handlers on the root", async () => {
  const root = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_identity",
    gatewayTransport: mockTransport(),
  });
  const handlers = createAthenaDataHandlers({
    auth: {
      lookupSession: async (token: string) =>
        token === "sess_ok"
          ? {
              session: { id: "session-ok", userId: "user-a" },
              user: { id: "user-a", role: "member" },
            }
          : null,
      mode: "athena-session",
    },
    client: root,
    security: { mode: "authenticated" },
  });

  const fetchBody = JSON.stringify({ table_name: "users" });
  const denied = await handlers.POST(
    new Request("http://localhost/api/athena/gateway/fetch", {
      body: fetchBody,
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      method: "POST",
    }),
  );
  assert.equal(denied.status, 401);

  const allowed = await handlers.POST(
    new Request("http://localhost/api/athena/gateway/fetch", {
      body: fetchBody,
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_ok`,
        origin: "http://localhost",
      },
      method: "POST",
    }),
  );
  assert.equal(allowed.ok, true);
});

test("unknown objects are foreign-runtime mismatches, not request views", () => {
  assert.throws(
    () =>
      createAthenaDataHandlers({
        client: { from() {} } as never,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaRuntimeOwnershipError);
      assert.equal(error.code, "ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH");
      assert.equal(error.received, "foreign-runtime");
      return true;
    },
  );
});

test("shared Postgres runtime stays open until the last borrower closes", async () => {
  const uri = "postgresql://postgres@127.0.0.1:5432/athena_refcount";
  const first = createAthenaPostgresRuntime({ connectionString: uri });
  const second = createAthenaPostgresRuntime({ connectionString: uri });
  assert.equal(first, second);
  await first.close();
  const stillShared = createAthenaPostgresRuntime({ connectionString: uri });
  assert.equal(stillShared, first);
  await second.close();
  await stillShared.close();
  const replacement = createAthenaPostgresRuntime({ connectionString: uri });
  assert.notEqual(replacement, first);
});
