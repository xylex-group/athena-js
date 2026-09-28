/**
 * Phase 1: HTTP Data API must not expose privileged billing/auth schemas,
 * and Mollie next-gen signing secrets are per-connection (never metadata).
 */

import { strict as assert } from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import { fingerprintBillingSigningSecret } from "../../src/billing/ingestion/ownership.ts";
import {
  rememberConnectionSigningSecret,
  signingSecretsForConnection,
} from "../../src/billing/ingestion/secrets/cache.ts";
import {
  openBillingWebhookSecret,
  sealBillingWebhookSecret,
} from "../../src/billing/ingestion/secrets/envelope.ts";
import { createMemoryBillingWebhookSecretStore } from "../../src/billing/ingestion/secrets/memory.ts";
import { createMollieWebhookPort } from "../../src/billing/runtime/local/providers/mollie/webhook-port.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaUpdatePayload,
} from "../../src/gateway/types.ts";
import { EMBEDDED_BILLING_MIGRATIONS } from "../../src/migrations/embedded-billing/catalog.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import type { AthenaRuntimeSessionLookup } from "../../src/runtime/data/principal.ts";
import {
  ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID,
  AthenaEventIngressError,
} from "../../src/runtime/ingress/errors.ts";
import type { AthenaIngressIR } from "../../src/runtime/ingress/ir.ts";
import { defineModel } from "../../src/schema/index.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

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

function createRecordingTransport(): AthenaGatewayClient & {
  calls: Array<{ op: string; payload: unknown }>;
} {
  const calls: Array<{ op: string; payload: unknown }> = [];
  return {
    baseUrl: "https://athena.local/mock",
    buildHeaders() {
      return {};
    },
    calls,
    async deleteGateway<T>(
      payload: AthenaDeletePayload,
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "delete", payload });
      return ok([{ deleted: true }] as T);
    },
    async fetchGateway<T>(
      payload: Parameters<AthenaGatewayClient["fetchGateway"]>[0],
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "fetch", payload });
      return ok([{ id: "1" }] as T);
    },
    async insertGateway<T>(
      payload: AthenaInsertPayload,
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      return ok([payload.insert_body] as T);
    },
    async queryGateway<T>(
      payload: AthenaQueryPayload,
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "query", payload });
      return ok([{ sql: true }] as T);
    },
    async resolveCallOptions(options) {
      return options;
    },
    async rpcGateway<T>(
      payload: Parameters<AthenaGatewayClient["rpcGateway"]>[0],
      _options?: Parameters<AthenaGatewayClient["rpcGateway"]>[1]
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "rpc", payload });
      return ok([{ rpc: payload.function }] as T);
    },
    async updateGateway<T>(
      payload: AthenaUpdatePayload,
      _options?: AthenaGatewayCallOptions
    ): Promise<AthenaGatewayResponse<T>> {
      calls.push({ op: "update", payload });
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

async function lookupSession(
  token: string
): Promise<AthenaRuntimeSessionLookup | null> {
  if (token !== "sess_a") {
    return null;
  }
  return {
    session: { id: "session-a", userId: "user-a" },
    user: { id: "user-a" },
  };
}

const todos = defineModel<{ id: string; title: string }>({
  meta: {
    columns: {
      id: { kind: "string" },
      title: { kind: "string" },
    },
    model: "todos",
    primaryKey: ["id"],
    schema: "public",
    tableName: "todos",
  },
});

const billingRegistrations = defineModel<{ id: string; metadata: unknown }>({
  meta: {
    columns: {
      id: { kind: "string" },
      metadata: { kind: "json" },
    },
    model: "billing_webhook_registrations",
    primaryKey: ["id"],
    schema: "billing",
    tableName: "billing_webhook_registrations",
  },
});

test("HTTP authenticated Data API cannot read billing registration metadata", async () => {
  const transport = createRecordingTransport();
  const handlers = createAthenaDataHandlers({
    auth: { lookupSession, mode: "athena-session" },
    models: { billingRegistrations, todos },
    security: { mode: "authenticated" },
    transport,
  });
  const cookie = `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_a`;
  const denied = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/fetch", {
      body: JSON.stringify({
        table_name: "billing.billing_webhook_registrations",
      }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(denied.status, 403);
  const body = (await denied.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "ATHENA_MODEL_NOT_EXPOSED");
  assert.equal(transport.calls.length, 0);

  const allowed = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/fetch", {
      body: JSON.stringify({ table_name: "todos" }),
      headers: {
        "content-type": "application/json",
        cookie,
      },
      method: "POST",
    })
  );
  assert.equal(allowed.status, 200);
  assert.equal(transport.calls.length, 1);
});

test("HTTP authenticated Data API denies unqualified billing_ tables", async () => {
  const transport = createRecordingTransport();
  const handlers = createAthenaDataHandlers({
    auth: { lookupSession, mode: "athena-session" },
    security: { mode: "authenticated" },
    transport,
  });
  const denied = await handlers.POST(
    new Request("https://app.example/api/athena/gateway/fetch", {
      body: JSON.stringify({
        table_name: "billing_provider_connections",
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_a`,
      },
      method: "POST",
    })
  );
  assert.equal(denied.status, 403);
  assert.equal(transport.calls.length, 0);
  const body = (await denied.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "ATHENA_MODEL_NOT_EXPOSED");
});

test("registration repository never writes providerSigningSecret", () => {
  const repository = readFileSync(
    join(SRC, "billing/ingestion/reconciliation/repository.ts"),
    "utf8"
  );
  assert.equal(repository.includes("providerSigningSecret"), false);
  const types = readFileSync(
    join(SRC, "billing/ingestion/reconciliation/types.ts"),
    "utf8"
  );
  assert.equal(types.includes("providerSigningSecret"), false);
});

test("migration 0015 creates encrypted webhook secret storage", () => {
  const v15 = EMBEDDED_BILLING_MIGRATIONS.find((row) => row.version === 15);
  assert.ok(v15);
  assert.match(v15.sql, /athena_internal\.billing_webhook_signing_secrets/);
  assert.match(v15.sql, /ciphertext/);
  assert.equal(v15.sql.includes("providerSigningSecret"), true);
  assert.match(v15.sql, /metadata - 'providerSigningSecret'/);
});

test("envelope encryption round-trips and is not plaintext", () => {
  const sealed = sealBillingWebhookSecret("whsec_live", "master-key");
  assert.equal(sealed.includes("whsec_live"), false);
  assert.equal(openBillingWebhookSecret(sealed, "master-key"), "whsec_live");
  assert.throws(() => openBillingWebhookSecret(sealed, "other-key"));
});

test("connection A secret is rejected on connection B", () => {
  const cache = new Map<string, string[]>();
  rememberConnectionSigningSecret(cache, "conn-a", "secret-a");
  rememberConnectionSigningSecret(cache, "conn-b", "secret-b");
  const port = createMollieWebhookPort({
    resolveResource: async () => ({
      amount: { currency: "EUR", value: "10.00" },
      id: "tr_xxx",
      metadata: {},
      status: "paid",
    }),
    resolveSigningSecrets: (connectionId) =>
      signingSecretsForConnection(cache, connectionId),
    verification: "signature_and_refetch",
  });
  const body = JSON.stringify({
    createdAt: new Date().toISOString(),
    entityId: "tr_xxx",
    id: "evt_1",
    resource: "payment",
    type: "payment.paid",
  });
  const sign = (secret: string) =>
    createHmac("sha256", secret).update(body).digest("hex");
  const ingress = (connectionId: string, secret: string): AthenaIngressIR => ({
    body: new TextEncoder().encode(body),
    connectionId,
    domain: "billing",
    headers: { "x-mollie-signature": sign(secret) },
    id: "11111111-1111-4111-8111-111111111111",
    operation: "webhook.mollie.events",
    receivedAt: new Date("2026-08-29T00:00:00.000Z"),
    transport: { kind: "http" },
  });
  const accepted = ingress("conn-a", "secret-a");
  port.verifyIngress?.(port.parseIngress(accepted), accepted);
  const rejected = ingress("conn-b", "secret-a");
  assert.throws(
    () => port.verifyIngress?.(port.parseIngress(rejected), rejected),
    (error: unknown) =>
      error instanceof AthenaEventIngressError &&
      error.code === ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID
  );
});

test("secret store current and previous are connection-scoped; retired secrets stop working", async () => {
  const store = createMemoryBillingWebhookSecretStore();
  await store.storeCurrent({
    connectionId: "conn-a",
    fingerprint: fingerprintBillingSigningSecret("current-a"),
    secret: "current-a",
  });
  await store.storeCurrent({
    connectionId: "conn-a",
    fingerprint: fingerprintBillingSigningSecret("rotated-a"),
    secret: "rotated-a",
  });
  await store.storeCurrent({
    connectionId: "conn-b",
    fingerprint: fingerprintBillingSigningSecret("current-b"),
    secret: "current-b",
  });
  const a = await store.resolve("conn-a");
  const b = await store.resolve("conn-b");
  assert.equal(a.current, "rotated-a");
  assert.deepEqual(a.previous, ["current-a"]);
  assert.equal(b.current, "current-b");
  assert.deepEqual(b.previous, []);
  await store.storeCurrent({
    connectionId: "conn-a",
    fingerprint: fingerprintBillingSigningSecret("third-a"),
    secret: "third-a",
  });
  const after = await store.resolve("conn-a");
  assert.equal(after.current, "third-a");
  assert.deepEqual(after.previous, ["rotated-a"]);
  assert.equal(after.previous.includes("current-a"), false);
});
