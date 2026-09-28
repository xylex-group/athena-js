import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../src/gateway/types.ts";
import { createAthenaDataHandlers } from "../src/next/data-handlers.ts";
import {
  ATHENA_DEVTOOLS_DATA_HEADER,
  ATHENA_DEVTOOLS_REQUEST_HEADER,
  ATHENA_DEVTOOLS_TRACE_HEADER,
} from "../src/runtime/data/devtools-nucleus.ts";

function ok<T>(data: T): AthenaGatewayResponse<T> {
  return {
    count: Array.isArray(data) ? data.length : 1,
    data,
    error: undefined,
    errorDetails: null,
    ok: true,
    raw: { data },
    status: 200,
    statusText: "OK",
  };
}

function createRecordingTransport(): AthenaGatewayClient {
  return {
    baseUrl: "https://athena.local/mock",
    buildHeaders() {
      return {};
    },
    async deleteGateway<T>(
      _payload: AthenaDeletePayload
    ): Promise<AthenaGatewayResponse<T>> {
      void _payload;
      return ok([{ deleted: true }] as T);
    },
    async fetchGateway<T>(): Promise<AthenaGatewayResponse<T>> {
      return ok([{ id: "1" }] as T);
    },
    async insertGateway<T>(
      payload: AthenaInsertPayload
    ): Promise<AthenaGatewayResponse<T>> {
      return ok([payload.insert_body] as T);
    },
    async queryGateway<T>(): Promise<AthenaGatewayResponse<T>> {
      return ok([{ sql: true }] as T);
    },
    async resolveCallOptions(options) {
      return options;
    },
    async rpcGateway<T>(
      payload: Parameters<AthenaGatewayClient["rpcGateway"]>[0]
    ): Promise<AthenaGatewayResponse<T>> {
      return ok([{ rpc: payload.function }] as T);
    },
    async updateGateway<T>(
      payload: AthenaUpdatePayload
    ): Promise<AthenaGatewayResponse<T>> {
      return ok([payload.update_body] as T);
    },
    async verifyConnection() {
      return {
        baseUrl: "https://athena.local/mock",
        error: undefined,
        errorDetails: null,
        ok: true,
        raw: null,
        reachable: true,
        status: 200,
        statusText: "OK",
        url: "https://athena.local/mock/health",
      };
    },
  };
}

function createHandlers() {
  return createAthenaDataHandlers({
    security: { mode: "trusted" },
    transport: createRecordingTransport(),
    unsafeAllowUnauthenticated: true,
  });
}

function eventsFromBody(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (
    body &&
    typeof body === "object" &&
    Array.isArray((body as { events?: unknown }).events)
  ) {
    return (body as { events: unknown[] }).events;
  }
  return [];
}

test("DevTools bulky header is omitted even when x-athena-devtools is set", async () => {
  const handlers = createHandlers();
  const response = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/insert", {
      body: JSON.stringify({
        insert_body: { email: "secret@example.com" },
        table_name: "users",
      }),
      headers: {
        "content-type": "application/json",
        [ATHENA_DEVTOOLS_REQUEST_HEADER]: "1",
        [ATHENA_DEVTOOLS_TRACE_HEADER]: "trace-devtools",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get(ATHENA_DEVTOOLS_DATA_HEADER), null);
  assert.equal(
    response.headers.get(ATHENA_DEVTOOLS_TRACE_HEADER),
    "trace-devtools"
  );
  assert.ok(response.headers.get("x-athena-request-id"));
});

test("DevTools attaches generated x-athena-trace-id when the request omits it", async () => {
  const handlers = createHandlers();
  const response = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/insert", {
      body: JSON.stringify({
        insert_body: { email: "secret@example.com" },
        table_name: "users",
      }),
      headers: {
        "content-type": "application/json",
        [ATHENA_DEVTOOLS_REQUEST_HEADER]: "1",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  const generated = response.headers.get(ATHENA_DEVTOOLS_TRACE_HEADER);
  assert.ok(generated);
  assert.notEqual(generated, "");
});

test("DevTools event channel carries allowlisted Data Nucleus summaries, not rows", async () => {
  const handlers = createHandlers();
  const insert = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/insert", {
      body: JSON.stringify({
        insert_body: { email: "secret@example.com" },
        table_name: "users",
      }),
      headers: {
        "content-type": "application/json",
        [ATHENA_DEVTOOLS_REQUEST_HEADER]: "1",
        [ATHENA_DEVTOOLS_TRACE_HEADER]: "trace-devtools-channel",
      },
      method: "POST",
    })
  );
  assert.equal(insert.status, 200);
  assert.equal(insert.headers.get(ATHENA_DEVTOOLS_DATA_HEADER), null);

  const listed = await handlers.GET(
    new Request("https://app.example/api/athena/devtools/v1/events?limit=50")
  );
  assert.equal(listed.status, 200);
  const body: unknown = await listed.json();
  const events = eventsFromBody(body);
  assert.ok(events.length >= 1);
  const first = events[0] as {
    event?: string;
    operation?: string;
    resource?: string;
    traceId?: string;
  };
  assert.equal(first.operation, "insert");
  assert.equal(first.event, "data.insert");
  assert.equal(first.resource, "users");
  assert.equal(first.traceId, "trace-devtools-channel");
  const blob = JSON.stringify(events);
  assert.equal(blob.includes("secret@example.com"), false);
  assert.equal(blob.includes("insert_body"), false);
});
