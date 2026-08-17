import { strict as assert } from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createAthenaTestSdkServer } from "../src/server.ts";

interface CapturedFetchCall {
  init?: RequestInit;
  url: string;
}

async function startServer() {
  const appServer = createAthenaTestSdkServer({
    config: {
      athenaApiKey: "test-key",
      athenaClient: "test-client",
      athenaUrl: "https://mock-athena.local",
    },
  });

  return await new Promise<{
    close: () => Promise<void>;
    baseUrl: string;
  }>((resolve) => {
    const server = appServer.expressApp.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
              } else {
                closeResolve();
              }
            });
          }),
      });
    });
  });
}

function installAthenaFetchMock(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response
) {
  const calls: CapturedFetchCall[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith("https://mock-athena.local")) {
      calls.push({ init, url });
      return handler(url, init);
    }
    return originalFetch(input, init);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function httpJson<T>(
  baseUrl: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    method,
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : null;
  return { json, response };
}

test("test-sdk e2e: GET /health returns sdk status payload", async () => {
  const server = await startServer();
  try {
    const { response, json } = await httpJson<{
      ok: boolean;
      sdk: string;
      responseTimeMs: number;
    }>(server.baseUrl, "GET", "/health");

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.sdk, "athena-js");
    assert.equal(typeof json.responseTimeMs, "number");
  } finally {
    await server.close();
  }
});

test("test-sdk e2e: GET /demo/products returns local demo payload without Athena call", async () => {
  const athenaMock = installAthenaFetchMock(
    async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      data: Array<{ id: string; name: string; price: number }>;
      responseTimeMs: number;
    }>(server.baseUrl, "GET", "/demo/products");

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(json.data), true);
    assert.equal(json.data.length, 2);
    assert.equal(json.data[0].id, "demo-1");
    assert.equal(athenaMock.calls.length, 0);
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: POST /demo/products creates product and returns it", async () => {
  const athenaMock = installAthenaFetchMock(
    async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      data: { id: string; name: string; price: number };
    }>(server.baseUrl, "POST", "/demo/products", {
      name: "Notebook",
      price: 12.5,
    });

    assert.equal(response.status, 201);
    assert.equal(json.data.id, "demo-3");
    assert.equal(json.data.name, "Notebook");
    assert.equal(json.data.price, 12.5);
    assert.equal(athenaMock.calls.length, 0);

    const afterCreate = await httpJson<{
      data: Array<{ id: string; name: string; price: number }>;
    }>(server.baseUrl, "GET", "/demo/products");
    assert.equal(afterCreate.response.status, 200);
    assert.equal(afterCreate.json.data.length, 3);
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: POST /demo/products validates bad payload", async () => {
  const server = await startServer();
  try {
    const { response, json } = await httpJson<{
      error: { code: string; details: { field: string } };
    }>(server.baseUrl, "POST", "/demo/products", {
      name: "",
      price: -1,
    });

    assert.equal(response.status, 400);
    assert.equal(json.error.code, "VALIDATION_ERROR");
    assert.equal(json.error.details.field, "name");
  } finally {
    await server.close();
  }
});

test("test-sdk e2e: GET /table/:name forwards pagination and headers to Athena gateway", async () => {
  const athenaMock = installAthenaFetchMock(
    async () =>
      new Response(JSON.stringify({ data: [{ id: 1, name: "Aragorn" }] }), {
        status: 200,
      })
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      data: Array<{ id: number; name: string }>;
    }>(server.baseUrl, "GET", "/table/characters?limit=5&offset=10");

    assert.equal(response.status, 200);
    assert.equal(json.data.length, 1);
    assert.equal(json.data[0].name, "Aragorn");
    assert.equal(athenaMock.calls.length, 1);

    const outbound = athenaMock.calls[0];
    assert.ok(outbound.url.endsWith("/gateway/fetch"));
    assert.equal(outbound.init?.method, "POST");

    const outboundHeaders = outbound.init?.headers as Record<string, string>;
    // Gateway requests emit the canonical key header only (legacy aliases are accepted as input, not mirrored).
    assert.equal(outboundHeaders["X-Athena-Key"], "test-key");
    assert.equal(outboundHeaders["X-Athena-Client"], "test-client");

    const outboundPayload = JSON.parse(outbound.init?.body as string) as Record<
      string,
      unknown
    >;
    assert.equal(outboundPayload.table_name, "characters");
    assert.equal(outboundPayload.limit, 5);
    assert.equal(outboundPayload.offset, 10);
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: GET /table/:name/by/:column/:value uses typed UUID comparison path", async () => {
  const columnName = "workflow_uuid";
  const uuidValue = "550e8400-e29b-41d4-a716-446655440000";
  const athenaMock = installAthenaFetchMock(
    async () =>
      new Response(
        JSON.stringify({
          data: [{ [columnName]: uuidValue, state: "active" }],
        }),
        { status: 200 }
      )
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      data: Record<string, string> | null;
    }>(
      server.baseUrl,
      "GET",
      `/table/form_sessions/by/${columnName}/${uuidValue}`
    );

    assert.equal(response.status, 200);
    assert.equal(json.data?.[columnName], uuidValue);
    assert.equal(json.data?.state, "active");
    assert.equal(athenaMock.calls.length, 1);

    const outbound = athenaMock.calls[0];
    assert.ok(outbound.url.endsWith("/gateway/query"));
    assert.equal(outbound.init?.method, "POST");

    const outboundPayload = JSON.parse(outbound.init?.body as string) as {
      query?: string;
    };
    assert.equal(typeof outboundPayload.query, "string");
    assert.ok(outboundPayload.query?.includes(`FROM "form_sessions"`));
    assert.ok(
      outboundPayload.query?.includes(`"${columnName}"::text = '${uuidValue}'`)
    );
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: validation errors are normalized with code and details", async () => {
  const athenaMock = installAthenaFetchMock(
    async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      error: {
        code: string;
        message: string;
        details: Record<string, unknown> | null;
      };
      responseTimeMs: number;
    }>(server.baseUrl, "GET", "/table/characters?limit=not-a-number");

    assert.equal(response.status, 400);
    assert.equal(json.error.code, "VALIDATION_ERROR");
    assert.equal(json.error.details?.field, "limit");
    assert.equal(athenaMock.calls.length, 0);
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: POST /rpc/:functionName executes /gateway/rpc and returns count", async () => {
  const athenaMock = installAthenaFetchMock(
    async () =>
      new Response(
        JSON.stringify({
          count: 1,
          data: [{ email: "admin@example.com", id: 1 }],
        }),
        { status: 200 }
      )
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      data: Array<{ id: number; email: string }>;
      count: number | null;
    }>(server.baseUrl, "POST", "/rpc/list_users", {
      args: { role: "admin" },
      count: "exact",
      filters: [{ column: "active", operator: "eq", value: true }],
      limit: 5,
      offset: 0,
      order: { ascending: false, column: "created_at" },
      schema: "public",
      select: ["id", "email"],
    });

    assert.equal(response.status, 200);
    assert.equal(json.count, 1);
    assert.equal(json.data.length, 1);
    assert.equal(athenaMock.calls.length, 1);

    const outbound = athenaMock.calls[0];
    assert.ok(outbound.url.endsWith("/gateway/rpc"));
    const outboundPayload = JSON.parse(outbound.init?.body as string) as Record<
      string,
      unknown
    >;
    assert.equal(outboundPayload.function, "list_users");
    assert.equal(outboundPayload.schema, "public");
    assert.equal(outboundPayload.count, "exact");
    assert.equal(outboundPayload.select, "id,email");
    assert.equal(outboundPayload.limit, 5);
    assert.equal(outboundPayload.offset, 0);
    assert.deepEqual(outboundPayload.order, {
      ascending: false,
      column: "created_at",
    });
    assert.deepEqual(outboundPayload.args, { role: "admin" });
    assert.deepEqual(outboundPayload.filters, [
      { column: "active", operator: "eq", value: true },
    ]);
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: POST /rpc/:functionName supports GET mode with filters and planned count", async () => {
  const athenaMock = installAthenaFetchMock(
    async () =>
      new Response(
        JSON.stringify({
          count: 1,
          data: [{ email: "viewer@example.com", id: 2 }],
        }),
        { status: 200 }
      )
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      data: Array<{ id: number; email: string }>;
      count: number | null;
    }>(server.baseUrl, "POST", "/rpc/list_users", {
      args: { role: "viewer" },
      count: "planned",
      filters: [
        { column: "active", operator: "eq", value: true },
        { column: "id", operator: "in", value: [2, 3] },
      ],
      get: true,
      head: true,
      limit: 3,
      offset: 1,
      order: { ascending: false, column: "created_at" },
      select: "id,email",
    });

    assert.equal(response.status, 200);
    assert.equal(json.count, 1);
    assert.equal(json.data.length, 1);
    assert.equal(athenaMock.calls.length, 1);
    assert.equal(athenaMock.calls[0].init?.method, "GET");

    const outbound = new URL(athenaMock.calls[0].url);
    // Unified-root createClient({ url }) routes db traffic through the /db service prefix.
    assert.equal(outbound.pathname, "/db/rpc/list_users");
    assert.equal(outbound.searchParams.get("role"), "viewer");
    assert.equal(outbound.searchParams.get("active"), "eq.true");
    assert.equal(outbound.searchParams.get("id"), "in.{2,3}");
    assert.equal(outbound.searchParams.get("count"), "planned");
    assert.equal(outbound.searchParams.get("head"), "true");
    assert.equal(outbound.searchParams.get("order"), "created_at.desc");
    assert.equal(outbound.searchParams.get("limit"), "3");
    assert.equal(outbound.searchParams.get("offset"), "1");
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: Athena gateway failures are surfaced with ATHENA_GATEWAY_ERROR", async () => {
  const athenaMock = installAthenaFetchMock(
    async () =>
      new Response(JSON.stringify({ message: "missing gateway.rpc.execute" }), {
        status: 403,
      })
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      error: {
        code: string;
        message: string;
        details: {
          gatewayStatus: number;
          gatewayErrorDetails: { code: string } | null;
        };
      };
    }>(server.baseUrl, "POST", "/rpc/list_users", { args: { role: "admin" } });

    assert.equal(response.status, 403);
    assert.equal(json.error.code, "ATHENA_GATEWAY_ERROR");
    assert.equal(json.error.message, "missing gateway.rpc.execute");
    assert.equal(json.error.details.gatewayStatus, 403);
    assert.equal(json.error.details.gatewayErrorDetails?.code, "HTTP_ERROR");
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: GET /sdk/surface reports next adapter construction surface", async () => {
  const server = await startServer();
  try {
    const { response, json } = await httpJson<{
      data: {
        constructors: { browser: string; server: string };
        namespaces: Record<string, boolean>;
        methods: Record<string, boolean | Record<string, boolean>>;
        coverage: {
          complete: boolean;
          missingCount: number;
          missing: string[];
          documentedAthenaMethodCount: number;
          presentCount: number;
        };
      };
    }>(server.baseUrl, "GET", "/sdk/surface");

    assert.equal(response.status, 200);
    assert.equal(json.data.constructors.browser, "createAthenaBrowserClient");
    assert.equal(json.data.constructors.server, "createAthenaServerClient");
    assert.equal(json.data.namespaces.from, true);
    assert.equal(json.data.namespaces.rpc, true);
    assert.equal(json.data.namespaces.query, true);
    assert.equal(json.data.namespaces.request, true);
    assert.equal(json.data.methods.findMany, true);
    assert.equal(json.data.methods.upsert, true);
    assert.equal(json.data.methods.eq, true);
    assert.equal(
      typeof json.data.coverage.documentedAthenaMethodCount,
      "number"
    );
    assert.ok(json.data.coverage.documentedAthenaMethodCount > 100);
    assert.equal(
      json.data.coverage.complete,
      true,
      `missing documented athena.* methods: ${json.data.coverage.missing.join(", ")}`
    );
    assert.equal(json.data.coverage.missingCount, 0);
    assert.equal(
      json.data.coverage.presentCount,
      json.data.coverage.documentedAthenaMethodCount
    );
  } finally {
    await server.close();
  }
});

test("test-sdk e2e: PUT /table/:name/upsert forwards upsert payload", async () => {
  const athenaMock = installAthenaFetchMock(
    async () =>
      new Response(JSON.stringify({ data: [{ id: "1", name: "Ada" }] }), {
        status: 200,
      })
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{ data: Array<{ id: string }> }>(
      server.baseUrl,
      "PUT",
      "/table/users/upsert",
      { id: "1", name: "Ada" }
    );

    assert.equal(response.status, 200);
    assert.equal(json.data[0]?.id, "1");
    assert.ok(athenaMock.calls.length >= 1);
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: POST /table/:name/find-many requires select shape", async () => {
  const server = await startServer();
  try {
    const { response, json } = await httpJson<{
      error: { code: string; message: string };
    }>(server.baseUrl, "POST", "/table/users/find-many", {});

    assert.equal(response.status, 400);
    assert.equal(json.error.code, "VALIDATION_ERROR");
    assert.match(json.error.message, /select/i);
  } finally {
    await server.close();
  }
});

test("test-sdk e2e: POST /table/:name/select applies fluent filter operators", async () => {
  const athenaMock = installAthenaFetchMock(
    async () =>
      new Response(JSON.stringify({ data: [{ id: "1" }] }), {
        status: 200,
      })
  );
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{ data: Array<{ id: string }> }>(
      server.baseUrl,
      "POST",
      "/table/users/select",
      {
        filters: [
          { column: "status", operator: "eq", value: "active" },
          { column: "role", operator: "in", value: ["admin", "owner"] },
        ],
        limit: 5,
        order: { ascending: true, column: "id" },
        select: "id",
      }
    );

    assert.equal(response.status, 200);
    assert.equal(json.data[0]?.id, "1");
    assert.ok(athenaMock.calls.length >= 1);
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: POST /query validates sql field", async () => {
  const server = await startServer();
  try {
    const { response, json } = await httpJson<{
      error: { code: string; details: { field: string } | null };
    }>(server.baseUrl, "POST", "/query", { sql: "   " });

    assert.equal(response.status, 400);
    assert.equal(json.error.code, "VALIDATION_ERROR");
    assert.equal(json.error.details?.field, "sql");
  } finally {
    await server.close();
  }
});
