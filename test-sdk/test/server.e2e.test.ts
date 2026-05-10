import { strict as assert } from "assert";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createAthenaTestSdkServer } from "../src/server.ts";

type CapturedFetchCall = {
  url: string;
  init?: RequestInit;
};

async function startServer() {
  const appServer = createAthenaTestSdkServer({
    config: {
      athenaUrl: "https://mock-athena.local",
      athenaApiKey: "test-key",
      athenaClient: "test-client",
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
              if (error) closeReject(error);
              else closeResolve();
            });
          }),
      });
    });
  });
}

function installAthenaFetchMock(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  const calls: CapturedFetchCall[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://mock-athena.local")) {
      calls.push({ url, init });
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
  body?: unknown,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : null;
  return { response, json };
}

test("test-sdk e2e: GET /health returns sdk status payload", async () => {
  const server = await startServer();
  try {
    const { response, json } = await httpJson<{ ok: boolean; sdk: string; responseTimeMs: number }>(
      server.baseUrl,
      "GET",
      "/health",
    );

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.sdk, "athena-js");
    assert.equal(typeof json.responseTimeMs, "number");
  } finally {
    await server.close();
  }
});

test("test-sdk e2e: GET /demo/products returns local demo payload without Athena call", async () => {
  const athenaMock = installAthenaFetchMock(async () => {
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
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
  const athenaMock = installAthenaFetchMock(async () => {
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
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
  const athenaMock = installAthenaFetchMock(async () => {
    return new Response(JSON.stringify({ data: [{ id: 1, name: "Aragorn" }] }), { status: 200 });
  });
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{ data: Array<{ id: number; name: string }> }>(
      server.baseUrl,
      "GET",
      "/table/characters?limit=5&offset=10",
    );

    assert.equal(response.status, 200);
    assert.equal(json.data.length, 1);
    assert.equal(json.data[0].name, "Aragorn");
    assert.equal(athenaMock.calls.length, 1);

    const outbound = athenaMock.calls[0];
    assert.ok(outbound.url.endsWith("/gateway/fetch"));
    assert.equal(outbound.init?.method, "POST");

    const outboundHeaders = outbound.init?.headers as Record<string, string>;
    assert.equal(outboundHeaders["apikey"], "test-key");
    assert.equal(outboundHeaders["X-Athena-Client"], "test-client");

    const outboundPayload = JSON.parse(outbound.init?.body as string) as Record<string, unknown>;
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
  const athenaMock = installAthenaFetchMock(async () => {
    return new Response(
      JSON.stringify({
        data: [{ [columnName]: uuidValue, state: "active" }],
      }),
      { status: 200 },
    );
  });
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      data: Record<string, string> | null;
    }>(
      server.baseUrl,
      "GET",
      `/table/form_sessions/by/${columnName}/${uuidValue}`,
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
      outboundPayload.query?.includes(
        `"${columnName}"::text = '${uuidValue}'`,
      ),
    );
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: validation errors are normalized with code and details", async () => {
  const athenaMock = installAthenaFetchMock(async () => {
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      error: { code: string; message: string; details: Record<string, unknown> | null };
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
  const athenaMock = installAthenaFetchMock(async () => {
    return new Response(
      JSON.stringify({
        data: [{ id: 1, email: "admin@example.com" }],
        count: 1,
      }),
      { status: 200 },
    );
  });
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      data: Array<{ id: number; email: string }>;
      count: number | null;
    }>(server.baseUrl, "POST", "/rpc/list_users", {
      args: { role: "admin" },
      select: ["id", "email"],
      schema: "public",
      count: "exact",
      filters: [{ column: "active", operator: "eq", value: true }],
      order: { column: "created_at", ascending: false },
      limit: 5,
      offset: 0,
    });

    assert.equal(response.status, 200);
    assert.equal(json.count, 1);
    assert.equal(json.data.length, 1);
    assert.equal(athenaMock.calls.length, 1);

    const outbound = athenaMock.calls[0];
    assert.ok(outbound.url.endsWith("/gateway/rpc"));
    const outboundPayload = JSON.parse(outbound.init?.body as string) as Record<string, unknown>;
    assert.equal(outboundPayload.function, "list_users");
    assert.equal(outboundPayload.schema, "public");
    assert.equal(outboundPayload.count, "exact");
    assert.equal(outboundPayload.select, "id,email");
    assert.equal(outboundPayload.limit, 5);
    assert.equal(outboundPayload.offset, 0);
    assert.deepEqual(outboundPayload.order, { column: "created_at", ascending: false });
    assert.deepEqual(outboundPayload.args, { role: "admin" });
    assert.deepEqual(outboundPayload.filters, [{ column: "active", operator: "eq", value: true }]);
  } finally {
    athenaMock.restore();
    await server.close();
  }
});

test("test-sdk e2e: POST /rpc/:functionName supports GET mode with filters and planned count", async () => {
  const athenaMock = installAthenaFetchMock(async () => {
    return new Response(
      JSON.stringify({
        data: [{ id: 2, email: "viewer@example.com" }],
        count: 1,
      }),
      { status: 200 },
    );
  });
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      data: Array<{ id: number; email: string }>;
      count: number | null;
    }>(server.baseUrl, "POST", "/rpc/list_users", {
      get: true,
      head: true,
      count: "planned",
      args: { role: "viewer" },
      filters: [
        { column: "active", operator: "eq", value: true },
        { column: "id", operator: "in", value: [2, 3] },
      ],
      select: "id,email",
      order: { column: "created_at", ascending: false },
      limit: 3,
      offset: 1,
    });

    assert.equal(response.status, 200);
    assert.equal(json.count, 1);
    assert.equal(json.data.length, 1);
    assert.equal(athenaMock.calls.length, 1);
    assert.equal(athenaMock.calls[0].init?.method, "GET");

    const outbound = new URL(athenaMock.calls[0].url);
    assert.equal(outbound.pathname, "/rpc/list_users");
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
  const athenaMock = installAthenaFetchMock(async () => {
    return new Response(JSON.stringify({ message: "missing gateway.rpc.execute" }), { status: 403 });
  });
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      error: {
        code: string;
        message: string;
        details: { gatewayStatus: number; gatewayErrorDetails: { code: string } | null };
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
