/**
 * Target — Athena DevTools Billing V2 inspector (protocol + producer).
 *
 * Host:
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-devtools-billing-inspector.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { billingTraceToDevtoolsEvent } from "../../src/billing/observability/traces.ts";
import { produceAthenaDevtoolsSnapshot } from "../../src/devtools/produce/index.ts";
import type { AthenaClientInternals } from "../../src/runtime/client-internals.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const produceBillingDir = join(
  pkgRoot,
  "src",
  "devtools",
  "produce",
  "billing"
);

function collectTs(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTs(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function blob(dir: string): string {
  return collectTs(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

test("billing panel is ready and snapshot.billing exists", async () => {
  const snapshot = await produceAthenaDevtoolsSnapshot({
    billing: {
      providers: {
        mollie: { testKey: "test_secret_value_must_not_leak" },
      },
      testMode: true,
    },
  });
  assert.equal(snapshot.protocolVersion, 3);
  const billingPanel = snapshot.panels.find((row) => row.panelId === "billing");
  assert.ok(billingPanel);
  assert.equal(billingPanel.status, "ready");
  assert.ok(snapshot.billing);
  assert.notEqual(billingPanel.status, "stub");
  assert.equal(snapshot.billing.runtime.environment, "test");
  assert.equal(snapshot.billing.connections.length >= 1, true);
  assert.equal(snapshot.billing.connections[0]?.provider, "mollie");
  assert.equal(snapshot.billing.connections[0]?.environment, "test");
  const encoded = JSON.stringify(snapshot);
  assert.equal(encoded.includes("test_secret_value_must_not_leak"), false);
  assert.equal(encoded.includes("webhookIngressToken"), false);
});

test("configured, materialized, and failed runtime states are distinguishable", async () => {
  const configured = await produceAthenaDevtoolsSnapshot({
    billing: { providers: { mollie: { testKey: "test_x" } } },
  });
  assert.equal(configured.billing.status, "initializing");
  assert.equal(configured.billing.connections[0]?.source, "application_config");

  const readyInternals = {
    billingBootstrapEvents: ["runtime-ready"],
    billingProviderRegistry: {
      ingress: {
        classicWebhookUrl:
          "https://hooks.example/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa",
      },
    },
    billingDiagnostics: {
      connectionCount: 1,
      phase: "ready" as const,
      readyAt: 1,
      startedAt: 0,
    },
    billingMaterializedConnections: [
      {
        accountReference: "app-mollie-test",
        credentialReference: "providers.mollie:test",
        id: "5ee00000-0000-4000-8000-000000000001",
        provider: "mollie" as const,
        classicWebhookUrl:
          "https://hooks.example/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa",
        eventsWebhookUrl:
          "https://hooks.example/api/athena/billing/webhook/mollie/events/whtok_aaaaaaaaaaaaaa",
      },
    ],
    config: {},
    internalProtocolVersion: 1,
    lifecycle: {
      closed: false,
      requestViewsCreated: 0,
    },
    ownership: "root" as const,
    plan: {},
    runtimeOwnership: "owned" as const,
    sdkVersion: "test",
  } as unknown as AthenaClientInternals;

  const ready = await produceAthenaDevtoolsSnapshot(
    {
      billing: { providers: { mollie: { testKey: "test_x" } } },
    },
    { internals: readyInternals }
  );
  assert.equal(ready.billing.status, "ready");
  assert.equal(ready.billing.runtime.initialized, true);
  assert.equal(
    ready.billing.connections[0]?.id,
    "5ee00000-0000-4000-8000-000000000001"
  );
  assert.equal(ready.billing.connections[0]?.source, "materialized");
  assert.deepEqual(ready.billing.connections[0]?.webhookUrlTemplates, {
    classic:
      "https://hooks.example/api/athena/billing/webhook/mollie/classic/<binding-token>",
    events:
      "https://hooks.example/api/athena/billing/webhook/mollie/events/<binding-token>",
  });
  assert.equal(
    ready.billing.webhooks.desired.publicUrl,
    "https://hooks.example/api/athena/billing/webhook/mollie/classic/<binding-token>"
  );
  assert.equal(
    JSON.stringify(ready).includes("whtok_aaaaaaaaaaaaaa"),
    false
  );
  assert.equal(ready.billing.subjects.routes[0]?.resolution, "bound");

  const failed = await produceAthenaDevtoolsSnapshot(
    { billing: { providers: { mollie: { testKey: "test_x" } } } },
    {
      internals: {
        ...readyInternals,
        billingDiagnostics: {
          connectionCount: 0,
          failure: {
            message: "billing initialization failed",
            stage: "materializing-connections",
          },
          phase: "failed",
        },
        billingMaterializedConnections: [],
      },
    }
  );
  assert.equal(failed.billing.status, "failed");
  assert.equal(failed.billing.runtime.phase, "failed");
  assert.ok(
    failed.billing.health.findings.some(
      (row) => row.code === "BILLING_RUNTIME_FAILED"
    )
  );
});

test("ambiguous connections are visible", async () => {
  const internals = {
    billingDiagnostics: {
      connectionCount: 2,
      phase: "ready" as const,
    },
    billingMaterializedConnections: [
      {
        accountReference: "a",
        credentialReference: "providers.mollie:a",
        id: "conn-a",
        provider: "mollie" as const,
      },
      {
        accountReference: "b",
        credentialReference: "providers.mollie:b",
        id: "conn-b",
        provider: "mollie" as const,
      },
    ],
    config: {},
    plan: {},
  } as unknown as AthenaClientInternals;
  const snapshot = await produceAthenaDevtoolsSnapshot(
    {
      billing: {
        providers: {
          mollie: { testKey: "test_a" },
          mollieAccounts: { extra: { testKey: "test_b" } },
        },
      },
    },
    { internals }
  );
  assert.equal(snapshot.billing.subjects.routes[0]?.resolution, "ambiguous");
  assert.ok(
    snapshot.billing.health.findings.some(
      (row) => row.code === "BILLING_CONNECTION_AMBIGUOUS"
    )
  );
});

test("advanced access-token authority is explicit without leaking the token", async () => {
  const snapshot = await produceAthenaDevtoolsSnapshot({
    billing: {
      providers: {
        mollie: {
          accessToken: "access_never_serialize_this",
          authority: {
            modes: { live: true, test: true },
            scope: { kind: "organization" },
          },
          credentialKind: "advanced_access_token",
        },
      },
      testMode: false,
    },
  });
  const connection = snapshot.billing.connections[0];
  assert.equal(connection?.credential.kind, "advanced_access_token");
  assert.equal(connection?.authority.scopeKind, "organization");
  assert.equal(connection?.authority.liveAllowed, true);
  assert.equal(connection?.environment, "live");
  assert.equal(
    JSON.stringify(snapshot).includes("access_never_serialize_this"),
    false
  );
  assert.equal(connection?.credential.secret.kind, "secret");
});

test("webhook desired state is separate from provider registration", async () => {
  const snapshot = await produceAthenaDevtoolsSnapshot({
    billing: {
      ingestion: {
        webhooks: {
          enabled: true,
          providers: {
            mollie: {
              classic: { enabled: true },
              nextGen: { enabled: true, signingSecret: "whsec_never" },
            },
          },
          publicBaseUrl: "https://app.example/api/athena/billing/webhook",
        },
      },
      providers: { mollie: { testKey: "test_x" } },
    },
  });
  assert.equal(snapshot.billing.webhooks.desired.classicEnabled, true);
  assert.equal(snapshot.billing.webhooks.desired.nextGenEnabled, true);
  assert.equal(snapshot.billing.webhooks.provider.registration, "unknown");
  assert.equal(snapshot.billing.webhooks.ingress.signingSecret.kind, "secret");
  assert.equal(JSON.stringify(snapshot).includes("whsec_never"), false);
});

test("billing traces carry phase timings", () => {
  const event = billingTraceToDevtoolsEvent({
    completedAt: new Date(),
    connectionId: "conn",
    id: "tr",
    metadata: { resourceId: "pay_1", resourceKind: "payment" },
    operation: "self.checkout.create",
    outcome: "success",
    provider: "mollie",
    providerMs: 83,
    resolveMs: 2,
    startedAt: new Date(),
    totalMs: 90,
    traceId: "trace-1",
    transactionMs: 4,
    trigger: "manual",
  });
  assert.equal(event.timings.totalMs, 90);
  assert.equal(event.timings.billing.phaseTimings.providerMs, 83);
  assert.equal(event.timings.billing.resourceKind, "payment");
});

test("producer does not call provider APIs", () => {
  const source = blob(produceBillingDir);
  assert.equal(source.includes("getCapabilities("), false);
  assert.equal(source.includes("fetch("), false);
});
