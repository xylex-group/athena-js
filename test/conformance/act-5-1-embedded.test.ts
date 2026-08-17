/**
 * ACT-08 / ACT-13 / ACT-16 / ACT-22 — 5.1 embedded architecture conformance.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
  isCapabilityEnabled,
  isSocialCapabilityEnabled,
} from "../../src/auth/capabilities.ts";
import { createAuthModule } from "../../src/auth/client.ts";
import {
  createAthenaRuntimeExecutionEvent,
  redactAthenaRuntimeExecutionEvent,
} from "../../src/runtime/data/execution-event.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import { string, table } from "../../src/schema/index.ts";

const users = table("users")
  .schema("public")
  .columns({
    email: string(),
    id: string(),
  })
  .primaryKey("id");

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

function transport(): AthenaGatewayClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    baseUrl: "https://athena.local/mock",
    buildHeaders() {
      return {};
    },
    calls,
    async deleteGateway(payload: AthenaDeletePayload) {
      calls.push(payload);
      return ok([{ deleted: true }]);
    },
    async fetchGateway(payload: AthenaFetchPayload) {
      calls.push(payload);
      return ok([{ id: "1" }]);
    },
    async insertGateway(payload: AthenaInsertPayload) {
      calls.push(payload);
      return ok([payload.insert_body]);
    },
    async queryGateway(payload: AthenaQueryPayload) {
      calls.push(payload);
      return ok([{ sql: true }]);
    },
    async rpcGateway(payload: AthenaRpcPayload) {
      calls.push(payload);
      return ok([{ rpc: true }]);
    },
    async updateGateway(payload: AthenaUpdatePayload) {
      calls.push(payload);
      return ok([{ updated: true }]);
    },
  } as AthenaGatewayClient & { calls: unknown[] };
}

test("ACT-08/22: optional features are not advertised when absent", async () => {
  const snap = ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT;
  assert.equal(isCapabilityEnabled(snap, "passkeys"), false);
  assert.equal(isSocialCapabilityEnabled(snap), false);
  const auth = createAuthModule({ capabilities: snap }).auth;
  const result = await auth.signIn.social({ provider: "github" } as never);
  assert.equal(result.ok, false);
  assert.equal(result.errorDetails?.code, "ATHENA_AUTH_CAPABILITY_DISABLED");
});

test("ACT-13: unknown RPC is ATHENA_RPC_NOT_EXPOSED", async () => {
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
    models: { users },
    rpc: { enabled: true, expose: ["safe_fn"] },
    security: { mode: "authenticated" },
    transport: transport(),
  });
  const response = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/rpc", {
      body: JSON.stringify({ function: "admin_wipe" }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_ok`,
        origin: "https://app.example",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 403);
  const body = (await response.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "ATHENA_RPC_NOT_EXPOSED");
});

test("ACT-16: runtime execution events never include secrets", () => {
  const event = createAthenaRuntimeExecutionEvent({
    affectedRows: 1,
    backend: "postgres-direct",
    decision: "allow",
    executeMs: 2,
    operation: "fetch",
    principalAuthority: "athena-session",
    requestId: "req_1",
    resource: "users",
    runtime: "embedded",
  });
  const redacted = redactAthenaRuntimeExecutionEvent(event, [
    "password=supersecret",
    "Bearer SECRET",
  ]);
  const blob = JSON.stringify(redacted);
  assert.equal(blob.includes("supersecret"), false);
  assert.equal(blob.includes("Bearer SECRET"), false);
  assert.equal(redacted.runtime, "embedded");
  assert.equal(redacted.operation, "fetch");
  assert.equal("password" in redacted, false);
});
