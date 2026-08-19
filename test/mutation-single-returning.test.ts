/**
 * Regression: insert()/update()/delete().single() without args must keep the
 * default "*" projection so direct Postgres emits RETURNING.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import { createClient } from "../src/index.ts";

test("P?: insert().single() without args keeps default RETURNING projection", async () => {
  const payloads: unknown[] = [];
  const ok = async <T>(payload?: unknown) => {
    if (payload) {
      payloads.push(payload);
    }
    return {
      count: 1,
      data: [{ id: "1", name: "n" }],
      error: null,
      ok: true,
      raw: { data: [{ id: "1", name: "n" }] },
      status: 200,
      statusText: "OK",
    } as never as {
      count: number;
      data: T;
      error: null;
      ok: true;
      raw: unknown;
      status: number;
      statusText: string;
    };
  };

  const transport = {
    baseUrl: "https://athena.local/gateway",
    buildHeaders() {
      return {};
    },
    deleteGateway: ok,
    fetchGateway: ok,
    insertGateway: async <T>(payload: unknown) => ok<T>(payload),
    queryGateway: ok,
    async resolveCallOptions(options: unknown) {
      return options;
    },
    rpcGateway: ok,
    updateGateway: async <T>(payload: unknown) => ok<T>(payload),
    async verifyConnection() {
      return { ok: true } as never;
    },
  } as AthenaGatewayClient;

  const client = createClient({
    auth: false,
    gatewayTransport: transport,
    url: "https://athena.local",
    key: "test",
  });

  const inserted = await client
    .from("forms_cas_smoke")
    .insert({ id: "1", name: "create", schema_revision: 10 })
    .single();

  assert.equal(inserted.error, null);
  assert.ok(inserted.data);
  assert.equal(payloads.length, 1);
  const payload = payloads[0] as { columns?: string | string[] };
  assert.ok(
    payload.columns === "*" ||
      (Array.isArray(payload.columns) && payload.columns.includes("*")),
    `expected default columns projection, got ${JSON.stringify(payload.columns)}`
  );
});
