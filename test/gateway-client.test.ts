import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import packageJson from "../package.json" with { type: "json" };
import {
  createAthenaGatewayClient,
  verifyAthenaGatewayUrl,
} from "../src/gateway/client.ts";
import { createGatewayHttpTransactionTransport } from "../src/gateway/transaction.ts";
import { AthenaGatewayError } from "../src/gateway/errors.ts";
import type { AthenaTransactionOperation } from "../src/db/transaction/types.ts";
import type { AthenaQueryDescriptor } from "../src/query/descriptor.ts";
import updateFixture from "../../../contracts/gateway/update-request-v1.json" with {
  type: "json",
};
import { serializeGatewayUpdateRequest } from "../src/gateway/serialize-update.ts";
import {
  ATHENA_DEFAULT_BASE_URL,
  normalizeAthenaGatewayBaseUrl,
} from "../src/gateway/url.ts";

interface Captured {
  init?: RequestInit;
  url: string;
}

function mockFetch() {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    return new Response(JSON.stringify({ data: [], status: 200 }), {
      status: 200,
    });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("buildHeaders sets client and strip nulls by default", () => {
  const client = createAthenaGatewayClient({ client: "c1" });
  const headers = client.buildHeaders();
  assert.equal(headers["X-Athena-Client"], "c1");
  assert.equal(headers["X-Strip-Nulls"], "true");
});

test("buildHeaders includes standard sdk identification header", () => {
  const client = createAthenaGatewayClient({});
  const headers = client.buildHeaders();
  assert.equal(
    headers["X-Athena-Sdk"],
    `@xylex-group/athena ${packageJson.version}`
  );
});

test("buildHeaders sets api key", () => {
  const client = createAthenaGatewayClient({ apiKey: "k1" });
  const headers = client.buildHeaders();
  assert.equal(headers["X-Athena-Key"], "k1");
});

test("buildHeaders merges custom headers and preserves athena client", () => {
  const client = createAthenaGatewayClient({
    client: "c1",
    headers: { "X-Custom": "v", "x-athena-client": "ignored" },
  });
  const headers = client.buildHeaders();
  assert.equal(headers["X-Athena-Client"], "c1");
  assert.equal(headers["X-Custom"], "v");
});

test("buildHeaders forwards publish event", () => {
  const client = createAthenaGatewayClient({ publishEvent: "evt" });
  const headers = client.buildHeaders();
  assert.equal(headers["X-Publish-Event"], "evt");
});

test("buildHeaders sets backend type", () => {
  const client = createAthenaGatewayClient({ backend: { type: "postgresql" } });
  const headers = client.buildHeaders();
  assert.equal(headers["X-Backend-Type"], "postgresql");
});

test("buildHeaders accepts stripNulls override", () => {
  const client = createAthenaGatewayClient({});
  const headers = client.buildHeaders({ stripNulls: false });
  assert.equal(headers["X-Strip-Nulls"], "false");
});

test("buildHeaders sets user and organization ids", () => {
  const client = createAthenaGatewayClient({
    organizationId: "o1",
    userId: "u1",
  });
  const headers = client.buildHeaders();
  assert.equal(headers["X-User-Id"], "u1");
  assert.equal(headers["X-Organization-Id"], "o1");
});

test("buildHeaders allows overriding client per call", () => {
  const client = createAthenaGatewayClient({ client: "base" });
  const headers = client.buildHeaders({ client: "override" });
  assert.equal(headers["X-Athena-Client"], "override");
});

test("buildHeaders per-call userId overrides config", () => {
  const client = createAthenaGatewayClient({ userId: "u1" });
  const headers = client.buildHeaders({ userId: "u2" });
  assert.equal(headers["X-User-Id"], "u2");
});

test("buildHeaders per-call organizationId overrides config", () => {
  const client = createAthenaGatewayClient({ organizationId: "o1" });
  const headers = client.buildHeaders({ organizationId: "o2" });
  assert.equal(headers["X-Organization-Id"], "o2");
});

test("buildHeaders honors stripNulls true per-call", () => {
  const client = createAthenaGatewayClient({});
  const headers = client.buildHeaders({ stripNulls: true });
  assert.equal(headers["X-Strip-Nulls"], "true");
});

test("fetchGateway uses default client header when none provided", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({});
    await client.fetchGateway({ table_name: "t" });
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.ok(
      headers["X-Athena-Client"],
      "default client header should be set"
    );
    assert.equal(
      headers["X-Athena-Sdk"],
      `@xylex-group/athena ${packageJson.version}`
    );
  } finally {
    restore();
  }
});

test("buildHeaders per-call apiKey overrides config", () => {
  const client = createAthenaGatewayClient({ apiKey: "base" });
  const headers = client.buildHeaders({ apiKey: "override" });
  assert.equal(headers["X-Athena-Key"], "override");
});

test("buildHeaders per-call publishEvent overrides config", () => {
  const client = createAthenaGatewayClient({ publishEvent: "base" });
  const headers = client.buildHeaders({ publishEvent: "override" });
  assert.equal(headers["X-Publish-Event"], "override");
});

test("buildHeaders merges options headers", () => {
  const client = createAthenaGatewayClient({ headers: { "X-Config": "1" } });
  const headers = client.buildHeaders({ headers: { "X-Call": "2" } });
  assert.equal(headers["X-Config"], "1");
  assert.equal(headers["X-Call"], "2");
});

test("buildHeaders forceNoCache sets Cache-Control and overrides cache-control headers", () => {
  const client = createAthenaGatewayClient({
    forceNoCache: true,
    headers: { "cache-control": "public, max-age=60" },
  });
  const headers = client.buildHeaders({
    headers: { "Cache-Control": "private, max-age=120" },
  });
  assert.equal(headers["Cache-Control"], "no-cache");
  assert.equal(headers["cache-control"], undefined);
});

test("buildHeaders mirrors auth session token from cookie headers", () => {
  const client = createAthenaGatewayClient({});
  const headers = client.buildHeaders({
    headers: {
      cookie: "existing=1; athena-auth.session_token=session-token-123",
    },
  });

  assert.equal(
    headers.cookie,
    "existing=1; athena-auth.session_token=session-token-123"
  );
  assert.equal(headers["X-Athena-Auth-Session-Token"], "session-token-123");
});

test("buildHeaders mirrors bearer token from authorization headers", () => {
  const client = createAthenaGatewayClient({});
  const headers = client.buildHeaders({
    headers: {
      Authorization: "Bearer bearer-token-123",
    },
  });

  assert.equal(headers.Authorization, "Bearer bearer-token-123");
  assert.equal(headers["X-Athena-Auth-Bearer-Token"], "bearer-token-123");
});

test("buildHeaders keeps stripNulls default when option undefined", () => {
  const client = createAthenaGatewayClient({});
  const headers = client.buildHeaders({});
  assert.equal(headers["X-Strip-Nulls"], "true");
});

test("buildHeaders sets backend when string provided", () => {
  const client = createAthenaGatewayClient({ backend: "postgresql" });
  const headers = client.buildHeaders();
  assert.equal(headers["X-Backend-Type"], "postgresql");
});

test("fetchGateway trims baseUrl trailing slash", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com/",
    });
    await client.fetchGateway({ table_name: "t" });
    assert.ok(calls[0].url.endsWith("/gateway/fetch"));
    assert.equal(calls[0].init?.method, "POST");
  } finally {
    restore();
  }
});

test("fetchGateway sends payload body", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    await client.fetchGateway({ columns: ["id"], table_name: "t" });
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.table_name, "t");
    assert.deepEqual(body.columns, ["id"]);
    assert.equal(calls[0].init?.method, "POST");
  } finally {
    restore();
  }
});

test("fetchGateway sends compatible select ASTs through Query V1", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
      backend: "postgresql",
    });
    await client.fetchGateway({
      cardinality: "many",
      kind: "select",
      selection: {
        fields: [{ column: "id", kind: "column" }],
      },
      source: { kind: "table", table: "users" },
    });
    assert.ok(calls[0].url.endsWith("/gateway/query/v1"));
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.version, 1);
    assert.equal(body.operation.kind, "select");
    assert.equal(body.operation.from.name, "users");
  } finally {
    restore();
  }
});

test("fetchGateway auto mode falls back only when Query V1 is unavailable", async () => {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    return new Response(JSON.stringify({ error: "not found" }), {
      status: calls.length === 1 ? 404 : 200,
    });
  };
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
      backend: "postgresql",
      queryProtocol: "auto",
    });
    const response = await client.fetchGateway({
      cardinality: "many",
      kind: "select",
      selection: {
        fields: [{ column: "id", kind: "column" }],
      },
      source: { kind: "table", table: "users" },
    });
    assert.equal(response.ok, true);
    assert.ok(calls[0].url.endsWith("/gateway/query/v1"));
    assert.ok(calls[1].url.endsWith("/gateway/fetch"));
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchGateway explicit V1 mode does not fall back on an unavailable endpoint", async () => {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
    });
  };
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
      backend: "postgrest",
      queryProtocol: "v1",
    });
    const response = await client.fetchGateway({
      cardinality: "many",
      kind: "select",
      selection: {
        fields: [{ column: "id", kind: "column" }],
      },
      source: { kind: "table", table: "users" },
    });
    assert.equal(response.status, 404);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchGateway keeps AST reads on legacy transport without a PostgreSQL target", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
      backend: "postgrest",
      queryProtocol: "auto",
    });
    await client.fetchGateway({
      cardinality: "many",
      kind: "select",
      selection: {
        fields: [{ column: "id", kind: "column" }],
      },
      source: { kind: "table", table: "users" },
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/gateway/fetch"));
  } finally {
    restore();
  }
});

test("fetchGateway does not silently downgrade semantically incompatible V1 queries", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
      backend: "postgresql",
      queryProtocol: "v1",
    });
    assert.throws(
      () =>
        client.fetchGateway({
        cardinality: "many",
        kind: "select",
        selection: {
          fields: [
            {
              kind: "relation",
              relation: "organization",
              query: {
                cardinality: "many",
                kind: "select",
                selection: { fields: [{ column: "id", kind: "column" }] },
                source: { kind: "table", table: "organizations" },
              },
            },
          ],
        },
        source: { kind: "table", table: "users" },
        }),
      (error: Error & { code?: string }) =>
        error.name === "AthenaQueryError" &&
        error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
    );
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("fetchGateway auto mode falls back for semantically incompatible V1 queries", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
      backend: "postgresql",
      queryProtocol: "auto",
    });
    await client.fetchGateway({
      cardinality: "many",
      kind: "select",
      selection: {
        fields: [
          {
            kind: "relation",
            relation: "organization",
            query: {
              cardinality: "many",
              kind: "select",
              selection: { fields: [{ column: "id", kind: "column" }] },
              source: { kind: "table", table: "organizations" },
            },
          },
        ],
      },
      source: { kind: "table", table: "users" },
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/gateway/fetch"));
  } finally {
    restore();
  }
});

test("fetchGateway auto mode falls back when V1 returns an unsupported PostgreSQL value", async () => {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ init, url: String(url) });
    const body =
      calls.length === 1
        ? {
            data: [
              {
                custom_type: {
                  __athena_unsupported: true,
                  detail: "no lossless mapping",
                  pg_type: "custom_type",
                },
              },
            ],
            status: "success",
          }
        : { data: [{ custom_type: "legacy-value" }], status: "success" };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
      backend: "postgresql",
      queryProtocol: "auto",
    });
    const response = await client.fetchGateway({
      cardinality: "many",
      kind: "select",
      selection: {
        fields: [{ column: "custom_type", kind: "column" }],
      },
      source: { kind: "table", table: "users" },
    });
    assert.deepEqual(response.data, [{ custom_type: "legacy-value" }]);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.endsWith("/gateway/query/v1"));
    assert.ok(calls[1].url.endsWith("/gateway/fetch"));
  } finally {
    globalThis.fetch = original;
  }
});

test("updateGateway serializes semantic update_body as gateway data", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    await client.updateGateway({ table_name: "t", update_body: { name: "n" } });
    const body = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(body.data, { name: "n" });
    assert.equal("update_body" in body, false);
    assert.equal("set" in body, false);
    assert.equal(calls[0].init?.method, "POST");
  } finally {
    restore();
  }
});

test("shared update fixture is the projection of the semantic update payload", () => {
  const wire = serializeGatewayUpdateRequest({
    conditions: [
      {
        eq_column: updateFixture.conditions[0].eq_column,
        eq_value: updateFixture.conditions[0].eq_value,
        operator: "eq",
      },
    ],
    schema_name: updateFixture.schema_name,
    table_name: updateFixture.table_name,
    update_body: updateFixture.data,
  });

  assert.deepEqual(wire, updateFixture);
});

test("gateway transactions serialize update operations with the direct update contract", async () => {
  let posted: unknown;
  const transport = createGatewayHttpTransactionTransport({
    async postTransaction(payload) {
      posted = payload;
      return {
        count: 1,
        data: { committed: true, results: [{ data: [], ok: true }] },
        error: undefined,
        errorDetails: null,
        ok: true,
        raw: { committed: true, results: [{ data: [], ok: true }] },
        status: 200,
        statusText: "OK",
      };
    },
  });
  const descriptor = {
    dependency: { fields: [], models: [], relations: [] },
    modelScopeKey: [],
    operation: "update",
    queryKey: [],
    target: { table: "t" },
    version: 1,
  } satisfies AthenaQueryDescriptor;
  const operation = {
    descriptor,
    id: "txop_1",
    index: 0,
    kind: "update",
    payload: {
      conditions: [{ eq_column: "id", eq_value: "1", operator: "eq" }],
      table_name: "t",
      update_body: { name: "n" },
    },
  } satisfies AthenaTransactionOperation;

  await transport.executeAtomic([operation]);

  assert.deepEqual(posted, {
    idempotency_key: null,
    operations: [
      {
        id: "txop_1",
        kind: "update",
        payload: {
          conditions: [{ eq_column: "id", eq_value: "1", operator: "eq" }],
          data: { name: "n" },
          table_name: "t",
        },
      },
    ],
    options: {
      deferrable: false,
      isolation_level: null,
      read_only: false,
    },
  });
});

test("insertGateway sends insert payload", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    await client.insertGateway({ insert_body: { name: "n" }, table_name: "t" });
    const body = JSON.parse(calls[0].init?.body as string);
    assert.deepEqual(body.insert_body, { name: "n" });
    assert.equal(calls[0].init?.method, "PUT");
  } finally {
    restore();
  }
});

test("deleteGateway sends delete payload", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    await client.deleteGateway({ resource_id: "r1", table_name: "t" });
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.resource_id, "r1");
    assert.equal(calls[0].init?.method, "DELETE");
  } finally {
    restore();
  }
});

test("rpcGateway sends rpc payload", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    await client.rpcGateway({
      args: { role: "admin" },
      function: "list_users",
      select: "id,name",
    });
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.function, "list_users");
    assert.deepEqual(body.args, { role: "admin" });
    assert.equal(body.select, "id,name");
    assert.equal(calls[0].init?.method, "POST");
    assert.ok(calls[0].url.endsWith("/gateway/rpc"));
  } finally {
    restore();
  }
});

test("rpcGateway supports planned and estimated count payload values", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    await client.rpcGateway({ count: "planned", function: "list_users" });
    await client.rpcGateway({ count: "estimated", function: "list_users" });
    const first = JSON.parse(calls[0].init?.body as string);
    const second = JSON.parse(calls[1].init?.body as string);
    assert.equal(first.count, "planned");
    assert.equal(second.count, "estimated");
  } finally {
    restore();
  }
});

test("rpcGateway forwards head when provided", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    await client.rpcGateway({ function: "list_users", head: true });
    const payload = JSON.parse(calls[0].init?.body as string);
    assert.equal(payload.head, true);
  } finally {
    restore();
  }
});

test("rpcGateway surfaces count from response envelope", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ count: 12, data: [{ id: 1 }] }), {
      status: 200,
    });
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    const response = await client.rpcGateway<{ id: number }[]>({
      function: "list_users",
    });
    assert.equal(response.ok, true);
    assert.equal(response.count, 12);
    assert.deepEqual(response.data, [{ id: 1 }]);
  } finally {
    globalThis.fetch = original;
  }
});

test("rpcGateway includes schema and forwards call-level client override", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
      client: "base_client",
    });
    await client.rpcGateway(
      { function: "list_users", schema: "private" },
      { client: "override_client" }
    );
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.schema, "private");
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers["X-Athena-Client"], "override_client");
  } finally {
    restore();
  }
});

test("rpcGateway ignores non-numeric count in envelope", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ count: "bad", data: [{ id: 1 }] }), {
      status: 200,
    });
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    const response = await client.rpcGateway<{ id: number }[]>({
      function: "list_users",
    });
    assert.equal(response.count, undefined);
    assert.deepEqual(response.data, [{ id: 1 }]);
  } finally {
    globalThis.fetch = original;
  }
});

test("rpcGateway supports GET mode with args, filters, and modifiers", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    await client.rpcGateway(
      {
        args: { role: "admin" },
        count: "planned",
        filters: [
          { column: "active", operator: "eq", value: true },
          { column: "id", operator: "in", value: [1, 2, 3] },
        ],
        function: "list_users",
        head: true,
        limit: 10,
        offset: 5,
        order: { ascending: false, column: "created_at" },
        schema: "public",
        select: "id,name",
      },
      { get: true }
    );

    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[0].init?.body, undefined);
    assert.ok(calls[0].url.includes("/rpc/list_users?"));

    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/rpc/list_users");
    assert.equal(url.searchParams.get("role"), "admin");
    assert.equal(url.searchParams.get("schema"), "public");
    assert.equal(url.searchParams.get("select"), "id,name");
    assert.equal(url.searchParams.get("active"), "eq.true");
    assert.equal(url.searchParams.get("id"), "in.{1,2,3}");
    assert.equal(url.searchParams.get("order"), "created_at.desc");
    assert.equal(url.searchParams.get("count"), "planned");
    assert.equal(url.searchParams.get("head"), "true");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("offset"), "5");
  } finally {
    restore();
  }
});

test("rpcGateway GET mode preserves repeated same-column filters in order", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    await client.rpcGateway(
      {
        filters: [
          {
            column: "created_at",
            operator: "gte",
            value: "2026-01-01T00:00:00Z",
          },
          {
            column: "created_at",
            operator: "lt",
            value: "2026-02-01T00:00:00Z",
          },
        ],
        function: "list_users",
      },
      { get: true }
    );

    const url = new URL(calls[0].url);
    assert.deepEqual(url.searchParams.getAll("created_at"), [
      "gte.2026-01-01T00:00:00Z",
      "lt.2026-02-01T00:00:00Z",
    ]);
  } finally {
    restore();
  }
});

test("rpcGateway GET mode throws on arg/filter column conflict", () => {
  const client = createAthenaGatewayClient({
    baseUrl: "https://athena-db.com",
  });
  assert.throws(
    () =>
      client.rpcGateway(
        {
          args: { role: "admin" },
          filters: [{ column: "role", operator: "eq", value: "admin" }],
          function: "list_users",
        },
        { get: true }
      ),
    /conflicts with RPC argument/
  );
});

test("fetchGateway merges config and call headers", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
      headers: { "X-From-Config": "1" },
    });
    await client.fetchGateway(
      { table_name: "t" },
      { headers: { "X-From-Call": "2" } }
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers["X-From-Config"], "1");
    assert.equal(headers["X-From-Call"], "2");
  } finally {
    restore();
  }
});

test("default baseUrl is used when not provided", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient();
    await client.fetchGateway({ table_name: "t" });
    assert.equal(client.baseUrl, ATHENA_DEFAULT_BASE_URL);
    assert.ok(calls[0].url.startsWith(ATHENA_DEFAULT_BASE_URL));
  } finally {
    restore();
  }
});

test("createAthenaGatewayClient throws on malformed baseUrl", () => {
  assert.throws(
    () => createAthenaGatewayClient({ baseUrl: "not-a-url" }),
    (error: unknown) =>
      error instanceof AthenaGatewayError &&
      error.code === "INVALID_URL" &&
      /valid absolute http\(s\) URL/.test(error.message)
  );
});

test("normalizeAthenaGatewayBaseUrl rejects missing values", () => {
  assert.throws(
    () => normalizeAthenaGatewayBaseUrl(undefined),
    /non-empty absolute http\(s\) URL/
  );
});

test("fetchGateway returns INVALID_URL for malformed per-call baseUrl override", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    const response = await client.fetchGateway(
      { table_name: "users" },
      { baseUrl: "not-a-url" }
    );
    assert.equal(response.ok, false);
    assert.equal(response.status, 0);
    assert.equal(response.errorDetails?.code, "INVALID_URL");
    assert.match(response.error ?? "", /valid absolute http\(s\) URL/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("verifyConnection probes the configured baseUrl root", async () => {
  const { calls, restore } = mockFetch();
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com/",
    });
    const response = await client.verifyConnection();
    assert.equal(response.ok, true);
    assert.equal(response.reachable, true);
    assert.equal(response.baseUrl, "https://athena-db.com");
    assert.equal(response.url, "https://athena-db.com/");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://athena-db.com/");
    assert.equal(calls[0].init?.method, "GET");
  } finally {
    restore();
  }
});

test("verifyConnection reports unreachable hosts as network failures", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("getaddrinfo ENOTFOUND athena.invalid");
  };
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena.invalid",
    });
    const response = await client.verifyConnection();
    assert.equal(response.ok, false);
    assert.equal(response.reachable, false);
    assert.equal(response.status, 0);
    assert.equal(response.errorDetails?.code, "NETWORK_ERROR");
    assert.match(
      response.error ?? "",
      /Network error while probing Athena gateway/
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("verifyAthenaGatewayUrl normalizes trailing slashes and probes root", async () => {
  const { calls, restore } = mockFetch();
  try {
    const response = await verifyAthenaGatewayUrl("https://athena-db.com/");
    assert.equal(response.ok, true);
    assert.equal(response.reachable, true);
    assert.equal(response.baseUrl, "https://athena-db.com");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://athena-db.com/");
  } finally {
    restore();
  }
});

test("non-2xx response includes structured HTTP error details", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "forbidden" }), {
      headers: { "x-request-id": "req_123" },
      status: 403,
    });
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    const response = await client.rpcGateway({ function: "list_users" });
    assert.equal(response.ok, false);
    assert.equal(response.status, 403);
    assert.equal(response.error, "forbidden");
    assert.equal(response.errorDetails?.code, "HTTP_ERROR");
    assert.equal(response.errorDetails?.requestId, "req_123");
    assert.equal(response.errorDetails?.endpoint, "/gateway/rpc");
    assert.equal(response.errorDetails?.method, "POST");
  } finally {
    globalThis.fetch = original;
  }
});

test("network failures include structured NETWORK_ERROR details", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("socket hang up");
  };
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    const response = await client.fetchGateway({ table_name: "users" });
    assert.equal(response.ok, false);
    assert.equal(response.status, 0);
    assert.equal(response.errorDetails?.code, "NETWORK_ERROR");
    assert.equal(response.errorDetails?.endpoint, "/gateway/fetch");
    assert.equal(response.errorDetails?.method, "POST");
    assert.match(
      response.error ?? "",
      /Network error while calling POST \/gateway\/fetch/
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("invalid json responses are classified as INVALID_JSON", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('{"broken"', {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  try {
    const client = createAthenaGatewayClient({
      baseUrl: "https://athena-db.com",
    });
    const response = await client.fetchGateway({ table_name: "users" });
    assert.equal(response.ok, false);
    assert.equal(response.status, 200);
    assert.equal(response.errorDetails?.code, "INVALID_JSON");
    assert.equal(response.error, "Gateway returned malformed JSON");
  } finally {
    globalThis.fetch = original;
  }
});
