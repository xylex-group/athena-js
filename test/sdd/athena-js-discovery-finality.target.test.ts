/**
 * Discovery advertisement ↔ callable handlers. Topology SSOT is the
 * createAthenaNextHandlers plan (not Auth UI feature guessing).
 */
import { strict as assert } from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import {
  createAthenaNextHandler,
  createAthenaNextHandlers,
} from "../../src/next/data-handlers.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_finality_test";
const authUiSrc = join(here, "..", "..", "..", "athena-auth-ui", "src");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

async function capabilitiesBody(
  handlers: ReturnType<typeof createAthenaNextHandlers>
): Promise<Record<string, unknown>> {
  const response = await handlers.data.GET(
    new Request("http://localhost/api/athena/capabilities")
  );
  assert.equal(response.ok, true);
  const body = (await response.json()) as unknown;
  assert.ok(isRecord(body));
  return body;
}

function authCap(body: Record<string, unknown>): Record<string, unknown> {
  assert.ok(isRecord(body.capabilities));
  assert.ok(isRecord(body.capabilities.auth));
  return body.capabilities.auth;
}

test("embedded same-origin: advertised auth/storage/billing are callable", async () => {
  const storageRoot = mkdtempSync(join(tmpdir(), "athena-disc-"));
  const client = createClient({
    databaseUrl: SAMPLE_PG,
    env: {},
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root: storageRoot },
  });
  try {
    assert.equal(
      getAthenaClientInternals(client)?.plan.auth.runtime,
      "embedded"
    );
    const next = createAthenaNextHandlers({
      client,
      security: { mode: "trusted" },
      unsafeAllowUnauthenticated: true,
    });
    const body = await capabilitiesBody(next);
    const auth = authCap(body);
    assert.equal(auth.available, true);
    assert.equal(auth.transport, "same-origin");
    assert.ok(isRecord(body.endpoints));
    assert.equal(body.endpoints.auth, "/api/auth");
    assert.equal(body.capabilities.storage, true);
    assert.equal(typeof next.auth.GET, "function");
    assert.equal(typeof next.storage.GET, "function");
    if (body.capabilities.billing === true) {
      assert.equal(typeof next.billing.POST, "function");
    }
    const ok = await next.auth.GET(new Request("http://localhost/api/auth/ok"));
    assert.equal(ok.status, 200);
    const storage = await next.storage.GET(
      new Request("http://localhost/api/athena/storage")
    );
    assert.notEqual(storage.status, 404);
    const diagnostics = body.diagnostics;
    assert.ok(isRecord(diagnostics));
    assert.equal(diagnostics.auth, "embedded");
  } finally {
    void client.close();
  }
});

test("remote auth.url: advertised remote endpoint, local handlers not Auth SSOT", async () => {
  const client = createClient({
    auth: { mode: "remote", url: "https://auth.example.com/api/auth" },
    databaseUrl: SAMPLE_PG,
    env: {},
    gatewayTransport: mockTransport(),
    key: "publishable",
  });
  try {
    const next = createAthenaNextHandlers({
      client,
      security: { mode: "trusted" },
      unsafeAllowUnauthenticated: true,
    });
    const body = await capabilitiesBody(next);
    const auth = authCap(body);
    assert.equal(auth.available, true);
    assert.equal(auth.transport, "remote");
    assert.ok(isRecord(body.endpoints));
    assert.equal(body.endpoints.auth, "https://auth.example.com/api/auth");
    assert.equal(typeof next.auth.GET, "function");
  } finally {
    void client.close();
  }
});

test("unified Next handler advertises /api/athena/auth", async () => {
  const client = createClient({
    databaseUrl: SAMPLE_PG,
    env: {},
    gatewayTransport: mockTransport(),
  });
  try {
    const handler = createAthenaNextHandler({
      client,
      security: { mode: "trusted" },
      unsafeAllowUnauthenticated: true,
    });
    const response = await handler.GET(
      new Request("http://localhost/api/athena/capabilities")
    );
    assert.equal(response.ok, true);
    const body = (await response.json()) as Record<string, unknown>;
    const auth = authCap(body);
    assert.equal(auth.available, true);
    assert.equal(auth.transport, "same-origin");
    assert.ok(isRecord(body.endpoints));
    assert.equal(body.endpoints.auth, "/api/athena/auth");
    const ok = await handler.GET(
      new Request("http://localhost/api/athena/auth/ok")
    );
    assert.equal(ok.status, 200);
  } finally {
    void client.close();
  }
});

test("mixed remote-proxied Auth + Postgres Data is advertised same-origin", async () => {
  const client = createClient({
    auth: {
      mode: "remote",
      routing: "same-origin",
      upstreamUrl: "https://auth.example.com",
    },
    databaseUrl: SAMPLE_PG,
    env: {},
    gatewayTransport: mockTransport(),
  });
  try {
    assert.equal(client.system.runtime().auth, "remote");
    assert.equal(client.system.runtime().database, "postgres-direct");
    const next = createAthenaNextHandlers({
      client,
      security: { mode: "trusted" },
      unsafeAllowUnauthenticated: true,
    });
    const body = await capabilitiesBody(next);
    const auth = authCap(body);
    assert.equal(auth.available, true);
    assert.equal(auth.transport, "same-origin");
    assert.ok(isRecord(body.endpoints));
    assert.equal(body.endpoints.auth, "/api/auth");
  } finally {
    void client.close();
  }
});

test("Auth UI does not invent passkey capability independently of advertisement", () => {
  const plugin = readFileSync(
    join(authUiSrc, "lib", "auth", "core", "plugin-capability.ts"),
    "utf8"
  );
  assert.match(plugin, /isPluginCapabilityVisible/);
  assert.match(plugin, /capabilities\.status/);
  const passkeyPlugin = readFileSync(
    join(authUiSrc, "lib", "auth", "passkey", "passkey-plugin.ts"),
    "utf8"
  );
  assert.match(passkeyPlugin, /requiresCapability:\s*"passkeys"/);
  assert.doesNotMatch(passkeyPlugin, /passkeys:\s*true/);
});
