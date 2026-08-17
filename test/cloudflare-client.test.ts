import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  createCloudflareClient,
  createCloudflareD1GatewayTransport,
} from "../src/cloudflare/index.ts";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import type { AthenaGatewayResponse } from "../src/gateway/types.ts";
import { createClient } from "../src/v3-client.ts";
import { createMockD1, createMockR2 } from "./helpers/d1-r2-mocks.ts";

test("createClient accepts injected gatewayTransport", async () => {
  const calls: string[] = [];
  const fake = {
    baseUrl: "https://fake.test",
    buildHeaders: (_options?: any) => ({}),
    deleteGateway: async () => ({
      data: null,
      ok: true,
      raw: null,
      status: 200,
    }),
    fetchGateway: async () => {
      calls.push("fetch");
      return {
        count: 0,
        data: [],
        ok: true,
        raw: [],
        status: 200,
      } as AthenaGatewayResponse;
    },
    insertGateway: async () => ({
      data: null,
      ok: true,
      raw: null,
      status: 200,
    }),
    queryGateway: async () => {
      calls.push("query");
      return {
        count: 1,
        data: [{ ok: 1 }],
        ok: true,
        raw: [{ ok: 1 }],
        status: 200,
      };
    },
    resolveCallOptions: async (options?: unknown) => options,
    rpcGateway: async () => ({ data: null, ok: true, raw: null, status: 200 }),
    updateGateway: async () => ({
      data: null,
      ok: true,
      raw: null,
      status: 200,
    }),
    verifyConnection: async () => ({
      baseUrl: "https://fake.test",
      ok: true,
      raw: null,
      reachable: true,
      status: 200,
      url: "https://fake.test",
    }),
  };

  const client = createClient({
    gatewayTransport: fake as AthenaGatewayClient,
    key: "k",
    url: "https://example.test",
  });
  const result = await client.query("SELECT 1");
  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ ok: 1 }]);
  assert.deepEqual(calls, ["query"]);
  assert.equal(client.capabilities.mode, "gateway");
});

test("createCloudflareClient L0 query + capabilities", async () => {
  const db = createMockD1({
    rowsBySql: new Map([["SELECT 1 AS ok", [{ ok: 1 }]]]),
  });
  const client = createCloudflareClient({ d1: db });
  assert.equal(client.capabilities.mode, "cloudflare-edge");
  assert.equal(client.capabilities.db.local, true);
  assert.equal(client.capabilities.db.layers.query, true);
  assert.equal(client.capabilities.db.layers.rpc, false);
  assert.equal(client.capabilities.storage.objects, false);

  const result = await client.query<{ ok: number }>("SELECT 1 AS ok");
  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ ok: 1 }]);
});

test("createClient drop-in db.d1 + storage.r2 (same fluent API)", async () => {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const db = createMockD1({
    inserts,
    rowsBySql: new Map([["SELECT 1 AS ok", [{ ok: 1 }]]]),
  });
  const r2 = createMockR2();
  const client = createClient({
    db: { d1: db },
    storage: { prefix: "app/", r2 },
  });
  assert.equal(client.capabilities.mode, "cloudflare-edge");
  assert.equal(client.capabilities.db.local, true);
  assert.equal(client.capabilities.storage.local, true);
  assert.equal(client.capabilities.storage.objects, true);

  const q = await client.query<{ ok: number }>("SELECT 1 AS ok");
  assert.equal(q.error, null);
  assert.deepEqual(q.data, [{ ok: 1 }]);

  const ins = await client.from("users").insert({ email: "a@example.com" });
  assert.equal(ins.error, null);
  assert.ok(inserts.length >= 1);

  await client.storage.putObject({ body: "hello", key: "notes/a.txt" });
  assert.ok(r2.objects.has("app/notes/a.txt"));
  const got = await client.storage.getObject({ key: "notes/a.txt" });
  assert.ok(got);
  assert.equal(await got.body.text(), "hello");
});

test("createClient accepts top-level d1/r2 aliases", async () => {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const db = createMockD1({
    inserts,
    rowsBySql: new Map([["SELECT 1 AS ok", [{ ok: 1 }]]]),
  });
  const r2 = createMockR2();
  const client = createClient({
    d1: db,
    r2,
    storagePrefix: "app/",
  });
  assert.equal(client.capabilities.mode, "cloudflare-edge");
  assert.equal(client.capabilities.storage.local, true);
  const q = await client.query<{ ok: number }>("SELECT 1 AS ok");
  assert.equal(q.error, null);
  await client.storage.putObject({ body: "hi", key: "x.txt" });
  assert.ok(r2.objects.has("app/x.txt"));
});

test("createClient mode prefer gateway ignores d1 when url is set", () => {
  const db = createMockD1({});
  const client = createClient({
    d1: db,
    key: "k",
    mode: "auto",
    prefer: "gateway",
    url: "https://athena.example.com",
  });
  assert.equal(client.capabilities.mode, "gateway");
  assert.equal(client.capabilities.db.local, false);
});

test("createClient hybrid db.d1 + url keeps remote billing root", async () => {
  const db = createMockD1({});
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(url);
    return new Response(JSON.stringify({ data: {} }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;
  try {
    const client = createClient({
      db: { d1: db },
      key: "k",
      url: "https://athena.example.com",
    });
    assert.equal(client.capabilities.auth.remote, true);
    assert.equal(client.capabilities.storage.objects, true);
    assert.equal(client.capabilities.storage.local, false);
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /^https:\/\/athena\.example\.com\//);
    assert.equal(calls[0]?.includes("athena.local"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createCloudflareClient hybrid honors env API key when top-level key is omitted", async () => {
  const db = createMockD1({});
  const keyHeaders: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    keyHeaders.push(
      headers.get("X-Athena-Key") ??
        headers.get("x-athena-key") ??
        headers.get("X-Api-Key") ??
        headers.get("x-api-key") ??
        ""
    );
    return new Response(JSON.stringify({ data: {} }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;
  try {
    const client = createCloudflareClient({
      d1: db,
      env: {
        ATHENA_API_KEY: "from-env-via-facade",
      },
      url: "https://athena.example.com",
    });
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.ok(keyHeaders.length >= 1);
    assert.ok(
      keyHeaders.some((value) => value.includes("from-env-via-facade")),
      `expected env API key in request headers, got: ${JSON.stringify(keyHeaders)}`
    );
    assert.equal(
      keyHeaders.some((value) => value.includes("cloudflare-edge-local")),
      false,
      "createCloudflareClient must not pre-fill the edge-local sentinel for hybrid"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createClient hybrid honors env API key when top-level key is omitted", async () => {
  const db = createMockD1({});
  const keyHeaders: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    keyHeaders.push(
      headers.get("X-Athena-Key") ??
        headers.get("x-athena-key") ??
        headers.get("X-Api-Key") ??
        headers.get("x-api-key") ??
        ""
    );
    return new Response(JSON.stringify({ data: {} }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;
  try {
    const client = createClient({
      db: { d1: db },
      env: {
        ATHENA_API_KEY: "from-env-secret",
      },
      url: "https://athena.example.com",
    });
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.ok(keyHeaders.length >= 1);
    assert.ok(
      keyHeaders.some((value) => value.includes("from-env-secret")),
      `expected env API key in request headers, got: ${JSON.stringify(keyHeaders)}`
    );
    assert.equal(
      keyHeaders.some((value) => value.includes("cloudflare-edge-local")),
      false,
      "must not send the edge-local sentinel key for hybrid remote calls"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createClient hybrid via env ATHENA_URL does not prefill sentinel key", async () => {
  const db = createMockD1({});
  const keyHeaders: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    keyHeaders.push(
      headers.get("X-Athena-Key") ??
        headers.get("x-athena-key") ??
        headers.get("X-Api-Key") ??
        headers.get("x-api-key") ??
        ""
    );
    return new Response(JSON.stringify({ data: {} }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;
  try {
    // No top-level url/key â€” hybrid remote root + key come only from env.
    const client = createClient({
      db: { d1: db },
      env: {
        ATHENA_API_KEY: "env-only-secret",
        ATHENA_URL: "https://athena.example.com",
      },
    });
    assert.equal(client.capabilities.auth.remote, true);
    assert.equal(client.capabilities.storage.objects, true);
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.ok(
      keyHeaders.some((value) => value.includes("env-only-secret")),
      `expected env API key, got: ${JSON.stringify(keyHeaders)}`
    );
    assert.equal(
      keyHeaders.some((value) => value.includes("cloudflare-edge-local")),
      false,
      "env ATHENA_URL hybrid must not use the edge-local sentinel key"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createClient hybrid via auth.url alone does not prefill sentinel key", async () => {
  const db = createMockD1({});
  const keyHeaders: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    keyHeaders.push(
      headers.get("X-Athena-Key") ??
        headers.get("x-athena-key") ??
        headers.get("X-Api-Key") ??
        headers.get("x-api-key") ??
        ""
    );
    return new Response(JSON.stringify({ data: {} }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;
  try {
    const client = createClient({
      auth: { url: "https://auth.example.com" },
      db: { d1: db },
      env: {
        ATHENA_API_KEY: "auth-hybrid-secret",
      },
    });
    assert.equal(client.capabilities.auth.remote, true);
    // Trigger a request that uses the configured API key.
    await client.request({
      method: "GET",
      path: "/get-session",
      service: "auth",
    });
    assert.ok(
      keyHeaders.some((value) => value.includes("auth-hybrid-secret")),
      `expected env API key for auth.url hybrid, got: ${JSON.stringify(keyHeaders)}`
    );
    assert.equal(
      keyHeaders.some((value) => value.includes("cloudflare-edge-local")),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createClient d1 + explicit storage.url advertises storage.objects", () => {
  const db = createMockD1({});
  const client = createClient({
    db: { d1: db },
    key: "k",
    storage: { url: "https://storage.example.com" },
  });
  assert.equal(client.capabilities.mode, "cloudflare-edge");
  assert.equal(client.capabilities.storage.objects, true);
  assert.equal(client.capabilities.storage.local, false);
  assert.equal(client.capabilities.db.local, true);
});

test("createClient hybrid db.url gateway does not prefill sentinel key", async () => {
  const db = createMockD1({});
  const keyHeaders: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    keyHeaders.push(
      headers.get("X-Athena-Key") ??
        headers.get("x-athena-key") ??
        headers.get("X-Api-Key") ??
        headers.get("x-api-key") ??
        ""
    );
    return new Response(JSON.stringify({ data: {} }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;
  try {
    // Nested db.url is a remote gateway; prefer edge keeps D1 for DB execution but
    // remote services must still use env API key (not the edge-local sentinel).
    const client = createClient({
      db: { d1: db, url: "https://gateway.example.com" },
      env: {
        ATHENA_API_KEY: "gateway-env-key",
      },
      prefer: "edge",
    });
    await client.billing.getCapabilities({ connectionId: "conn_1" });
    assert.ok(
      keyHeaders.some((value) => value.includes("gateway-env-key")),
      `expected env API key, got: ${JSON.stringify(keyHeaders)}`
    );
    assert.equal(
      keyHeaders.some((value) => value.includes("cloudflare-edge-local")),
      false,
      "nested remote db.url must count as hybrid for key selection"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createCloudflareClient L1 insert via from()", async () => {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const db = createMockD1({ inserts });
  const client = createCloudflareClient({ d1: db });
  const result = await client.from("users").insert({ email: "a@example.com" });
  assert.equal(result.error, null);
  assert.ok(inserts.length >= 1);
  assert.match(inserts[0]?.sql, /INSERT INTO "users"/);
  assert.deepEqual(inserts[0]?.params, ["a@example.com"]);
});

test("P1: Give bounded-mutation tests a schema identity", async () => {
  // Shared createMockD1 must answer PRAGMA table_info with a real single-column
  // INTEGER PRIMARY KEY so bounded UPDATE/DELETE succeed (not no_unique_identity).
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const db = createMockD1({ inserts });
  const client = createCloudflareClient({ d1: db });
  const del = await client
    .from("events")
    .eq("expired", true)
    .range(0, 9)
    .delete();
  assert.equal(del.error, null);
  assert.ok(inserts.length >= 1);
  assert.match(inserts[0]?.sql, /DELETE FROM "events"/);
  assert.match(inserts[0]?.sql, /"id" IN/);
  assert.match(inserts[0]?.sql, /LIMIT 10/);
  assert.equal(
    /DELETE FROM "events" WHERE "expired" = \?$/.test(inserts[0]?.sql),
    false
  );

  inserts.length = 0;
  const upd = await client
    .from("events")
    .eq("pending", true)
    .limit(1)
    .update({ done: true });
  assert.equal(upd.error, null);
  assert.ok(inserts.length >= 1);
  assert.match(inserts[0]?.sql, /UPDATE "events"/);
  assert.match(inserts[0]?.sql, /"id" IN/);
  assert.match(inserts[0]?.sql, /LIMIT 1/);
  assert.equal(
    /UPDATE "events" SET .* WHERE "pending" = \?$/.test(inserts[0]?.sql),
    false
  );
});

test("createCloudflareClient delete range without order bounds SQL", async () => {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const db = createMockD1({ inserts });
  const client = createCloudflareClient({ d1: db });
  const result = await client
    .from("events")
    .eq("expired", true)
    .range(0, 9)
    .delete();
  assert.equal(result.error, null);
  assert.ok(inserts.length >= 1);
  assert.match(inserts[0]?.sql, /DELETE FROM "events"/);
  assert.match(inserts[0]?.sql, /"id" IN/);
  assert.match(inserts[0]?.sql, /LIMIT 10/);
  // Must not fall through to unbounded DELETE ... WHERE "expired" = ?
  assert.equal(
    /DELETE FROM "events" WHERE "expired" = \?$/.test(inserts[0]?.sql),
    false
  );
});

test("createCloudflareClient update limit without order bounds SQL", async () => {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const db = createMockD1({ inserts });
  const client = createCloudflareClient({ d1: db });
  const result = await client
    .from("events")
    .eq("pending", true)
    .limit(1)
    .update({ done: true });
  assert.equal(result.error, null);
  assert.ok(inserts.length >= 1);
  assert.match(inserts[0]?.sql, /UPDATE "events"/);
  assert.match(inserts[0]?.sql, /"id" IN/);
  assert.match(inserts[0]?.sql, /LIMIT 1/);
  assert.equal(
    /UPDATE "events" SET .* WHERE "pending" = \?$/.test(inserts[0]?.sql),
    false
  );
});

test("createCloudflareClient hybrid url advertises remote storage without R2", () => {
  const db = createMockD1({});
  const client = createCloudflareClient({
    d1: db,
    key: "k",
    url: "https://athena.example.com",
  });
  assert.equal(client.capabilities.storage.objects, true);
  assert.equal(client.capabilities.storage.local, false);
});

test("createCloudflareD1GatewayTransport rejects RPC", async () => {
  const db = createMockD1({});
  const transport = createCloudflareD1GatewayTransport({ d1: db });
  const response = await transport.rpcGateway({ function: "nope" });
  assert.equal(response.ok, false);
  assert.match(response.error ?? "", /RPC is unsupported/);
});

test("createCloudflareClient R2 L3a put/get/list is typed on storage", async () => {
  const db = createMockD1({
    rowsBySql: new Map([["SELECT 1 AS ok", [{ ok: 1 }]]]),
  });
  const r2 = createMockR2();
  const client = createCloudflareClient({
    d1: db,
    r2,
    storagePrefix: "app/",
  });
  assert.equal(client.capabilities.storage.objects, true);

  // No cast: overload types storage with L3a object methods when r2 is set.
  await client.storage.putObject({ body: "hello", key: "notes/a.txt" });
  assert.ok(r2.objects.has("app/notes/a.txt"));

  const got = await client.storage.getObject({ key: "notes/a.txt" });
  assert.ok(got);
  assert.equal(await got.body.text(), "hello");

  const listed = await client.storage.listObjects({ prefix: "notes/" });
  assert.equal(listed.objects.length, 1);
  // Logical keys are reusable with get/delete (no double-prefix).
  assert.equal(listed.objects[0]?.key, "notes/a.txt");
  const putResult = await client.storage.putObject({
    body: "b",
    key: "notes/b.txt",
  });
  assert.equal(putResult.key, "notes/b.txt");
  assert.ok(r2.objects.has("app/notes/b.txt"));
  const gotFromPutKey = await client.storage.getObject({ key: putResult.key });
  assert.ok(gotFromPutKey);
  assert.equal(gotFromPutKey.key, "notes/b.txt");

  // Logical keys that happen to start with the prefix stay distinct objects.
  await client.storage.putObject({ body: "x", key: "app/collision.txt" });
  assert.ok(r2.objects.has("app/app/collision.txt"));
  assert.equal(r2.objects.has("app/collision.txt"), false);
});

test("createClient storage.r2 alone configures storage-only client", async () => {
  const r2 = createMockR2();
  const client = createClient({
    storage: { prefix: "app/", r2 },
  });
  assert.equal(client.capabilities.mode, "cloudflare-edge");
  assert.equal(client.capabilities.storage.local, true);
  assert.equal(client.capabilities.storage.objects, true);
  assert.equal(client.capabilities.storage.catalogs, false);
  assert.equal(client.capabilities.storage.backups, false);
  assert.equal(client.capabilities.db.local, false);
  assert.equal(client.capabilities.db.layers.query, false);

  await client.storage.putObject({ body: "solo", key: "only.txt" });
  assert.ok(r2.objects.has("app/only.txt"));

  // Pure R2: managed HTTP ports stay unsupported (nested path throws documented error).
  // Proxy throws synchronously so assert.throws, not rejects.
  assert.throws(() => {
    void client.storage.catalog.list();
  }, /storage\.catalog\.list is not available in Cloudflare edge-local R2 object mode/);

  // DB surfaces stay unavailable without d1/url (sync guard before the promise).
  assert.throws(
    () => {
      void client.query("SELECT 1");
    },
    (error: unknown) =>
      error instanceof Error &&
      /not configured/i.test(error.message) &&
      (error as { code?: string }).code === "ATHENA_SERVICE_NOT_CONFIGURED"
  );
});

test("hybrid createClient url + storage.r2 composes HTTP ports with L3a R2", async () => {
  const r2 = createMockR2();
  const fetchCalls: Array<{ method: string; path: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const parsed = new URL(url);
    fetchCalls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      path: parsed.pathname,
    });
    if (parsed.pathname.endsWith("/storage/catalogs")) {
      return new Response(JSON.stringify({ data: [{ id: "cat_1" }] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }
    if (parsed.pathname.endsWith("/storage/files/list")) {
      return new Response(
        JSON.stringify({
          data: { files: [], total: 0 },
          message: "ok",
          status: "success",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      );
    }
    return new Response(
      JSON.stringify({ error: `unexpected ${parsed.pathname}` }),
      { status: 404 }
    );
  }) as typeof fetch;

  try {
    const client = createClient({
      key: "k",
      storage: { prefix: "app/", r2 },
      url: "https://athena.example.com",
    });

    // Capability matrix matches callable hybrid surface.
    assert.equal(client.capabilities.storage.local, true);
    assert.equal(client.capabilities.storage.objects, true);
    assert.equal(client.capabilities.storage.catalogs, true);
    assert.equal(client.capabilities.storage.backups, true);

    // HTTP product ports hit the remote storage service.
    await client.storage.catalog.list();
    await client.storage.file.list({ s3_id: "catalog_1" });
    assert.ok(
      fetchCalls.some(
        (c) => c.path.includes("/storage/catalogs") && c.method === "GET"
      )
    );
    assert.ok(
      fetchCalls.some(
        (c) => c.path.includes("/storage/files/list") && c.method === "POST"
      )
    );
    assert.equal(
      fetchCalls.every((c) => !c.path.includes("athena.local")),
      true
    );

    // L3a object helpers hit the R2 binding, not fetch.
    const fetchBeforePut = fetchCalls.length;
    await client.storage.putObject({ body: "hybrid", key: "notes/a.txt" });
    assert.ok(r2.objects.has("app/notes/a.txt"));
    assert.equal(fetchCalls.length, fetchBeforePut);

    const got = await client.storage.getObject({ key: "notes/a.txt" });
    assert.ok(got);
    assert.equal(await got.body.text(), "hybrid");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hybrid storage.url + r2 without root still composes HTTP catalogs", async () => {
  const r2 = createMockR2();
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    fetchCalls.push(url);
    return new Response(JSON.stringify({ data: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const client = createClient({
      key: "k",
      storage: {
        prefix: "t/",
        r2,
        url: "https://storage.example.com",
      },
    });

    assert.equal(client.capabilities.storage.catalogs, true);
    assert.equal(client.capabilities.storage.backups, true);
    assert.equal(client.capabilities.storage.local, true);

    await client.storage.catalog.list();
    assert.ok(
      fetchCalls.some((u) => u.includes("https://storage.example.com"))
    );
    await client.storage.putObject({ body: "x", key: "a.txt" });
    assert.ok(r2.objects.has("t/a.txt"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createCloudflareClient hybrid url + r2 composes HTTP storage with L3a", async () => {
  const r2 = createMockR2();
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    fetchCalls.push(url);
    return new Response(JSON.stringify({ data: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const client = createCloudflareClient({
      d1: createMockD1({}),
      key: "k",
      r2,
      storagePrefix: "edge/",
      url: "https://athena.example.com",
    });

    assert.equal(client.capabilities.storage.local, true);
    assert.equal(client.capabilities.storage.objects, true);
    assert.equal(client.capabilities.storage.catalogs, true);
    assert.equal(client.capabilities.storage.backups, true);

    await client.storage.catalog.list();
    assert.ok(
      fetchCalls.some((u) =>
        u.startsWith("https://athena.example.com/storage/catalogs")
      )
    );

    await client.storage.putObject({ body: "cf", key: "x.txt" });
    assert.ok(r2.objects.has("edge/x.txt"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R2 rejects path-traversal and empty object keys", async () => {
  const db = createMockD1({});
  const r2 = createMockR2();
  const client = createCloudflareClient({
    d1: db,
    r2,
    storagePrefix: "app/",
  });

  await assert.rejects(
    () => client.storage.putObject({ body: "x", key: "../escape.txt" }),
    /must not contain "\.\." path segments/
  );
  await assert.rejects(
    () => client.storage.putObject({ body: "x", key: "" }),
    /Object key is required/
  );
  await assert.rejects(
    () => client.storage.getObject({ key: "a/../../b" }),
    /must not contain "\.\." path segments/
  );
  assert.equal(r2.objects.size, 0);
});

test("withContext preserves cloudflare capabilities", () => {
  const db = createMockD1({});
  const client = createCloudflareClient({ d1: db });
  const scoped = client.withContext({ userId: "u1" });
  assert.equal(scoped.capabilities.mode, "cloudflare-edge");
});
