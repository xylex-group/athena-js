/**
 * Target: billing ingestion control plane around reconciliation.
 * See docs/sdd/xylex/athena-js-billing-ingestion-control-plane/
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBillingWebhookApplicationId } from "../../src/billing/ingestion/application-id.ts";
import {
  assertAthenaBillingIngestion,
  flattenSigningSecrets,
  normalizeAthenaBillingWebhooks,
  signingSecretsFromWebhookConfig,
} from "../../src/billing/ingestion/config.ts";
import {
  billingWebhookOwnershipMarker,
  isAthenaOwnedWebhookName,
  MOLLIE_WEBHOOK_OWNERSHIP_NAME_MAX,
} from "../../src/billing/ingestion/ownership.ts";
import { buildDesiredBillingWebhookState } from "../../src/billing/ingestion/reconciliation/desired-state.ts";
import { planBillingWebhookReconciliation } from "../../src/billing/ingestion/reconciliation/planner.ts";
import {
  BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
  BILLING_MOLLIE_EVENTS_WEBHOOK_PATH,
  billingWebhookIngressBindingToken,
  billingWebhookPathKind,
  billingWebhookUrlIsLoopback,
  billingWebhookUrlTemplate,
  isBillingWebhookIngressBindingToken,
  resolveBillingIngressEndpoints,
} from "../../src/billing/ingestion/urls.ts";
import {
  BILLING_RECONCILIATION_RESOURCE_WEBHOOK_REGISTRATIONS,
  createMemoryBillingReconciliationLeaseStore,
} from "../../src/billing/reconciliation/lease.ts";
import { BillingSecret } from "../../src/billing/runtime/credentials.ts";
import { paymentCreateBody } from "../../src/billing/runtime/local/providers/mollie/dialect/payments.ts";
import {
  mapCreateWebhookToMollieSdk,
  readMollieWebhookSigningSecret,
} from "../../src/billing/runtime/local/providers/mollie/dialect/webhooks.ts";
import { resolveMollieWebhookManagementCapability } from "../../src/billing/runtime/local/providers/mollie/webhook-capability.ts";
import type {
  BillingProviderBinding,
  BillingProviderExecutionContext,
} from "../../src/billing/runtime/local/providers/types.ts";
import { parse } from "../../src/cli/commands/billing/index.ts";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import { EMBEDDED_BILLING_MIGRATIONS } from "../../src/migrations/embedded-billing/catalog.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

function apiKeyBinding(): BillingProviderBinding {
  return {
    credentials: {
      test: {
        kind: "api_key",
        secret: new BillingSecret("test_x"),
      },
    },
    kind: "configured",
    provider: "mollie",
    providerConfig: {},
  };
}

function accessTokenBinding(): BillingProviderBinding {
  return {
    credentials: {
      live: {
        kind: "oauth_access_token",
        secret: new BillingSecret("access_x"),
      },
    },
    kind: "configured",
    provider: "mollie",
    providerConfig: {
      authority: {
        permissions: {
          webhooks: { read: true, write: true },
        },
        scope: { kind: "organization" },
      },
    },
  };
}

test("T-ING-WEBHOOKS-SHORTHAND: P?: webhooks true normalizes provider defaults", () => {
  const normalized = normalizeAthenaBillingWebhooks(true);
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.management, "automatic");
  assert.equal(normalized.providers.mollie.classic.enabled, true);
  assert.equal(normalized.providers.mollie.nextGen.enabled, "auto");
  assert.ok(
    normalized.providers.mollie.nextGen.eventTypes.includes("payment.paid")
  );
});

test("T-ING-MOLLIE-WEBHOOK-SDK-BODY: P?: create uses requestBody with eventTypes", () => {
  const mapped = mapCreateWebhookToMollieSdk({
    input: {
      eventTypes: ["payment.paid", "payment.failed"],
      idempotencyKey: "idemp_webhook",
      name: "athena.next-minimal",
      url: "https://example.test/api/athena/billing/webhook/mollie/events",
    },
    testMode: true,
  });
  assert.equal("webhookRequest" in mapped, false);
  assert.deepEqual(mapped.requestBody, {
    eventTypes: "payment.paid,payment.failed",
    name: "athena.next-minimal",
    testmode: true,
    url: "https://example.test/api/athena/billing/webhook/mollie/events",
  });
  const portSrc = readFileSync(
    join(pkgRoot, "src/billing/runtime/local/providers/mollie/webhooks.ts"),
    "utf8"
  );
  assert.doesNotMatch(portSrc, /webhookRequest/);
  assert.match(portSrc, /mapCreateWebhookToMollieSdk/);
  assert.match(portSrc, /sendMollieJson/);
});

test("T-ING-MOLLIE-LOOPBACK-CREATE-REJECT: P?: dialect refuses localhost before Mollie POST", () => {
  assert.throws(
    () =>
      mapCreateWebhookToMollieSdk({
        input: {
          eventTypes: ["payment.paid"],
          idempotencyKey: "idemp_loopback",
          name: "athena.local",
          url: "http://localhost:3010/api/athena/billing/webhook/mollie/events",
        },
        testMode: true,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "AthenaBillingProviderRequestError" &&
      error.message.includes("loopback")
  );
});

test("T-ING-URL-AUTHORITY: P?: publicBaseUrl beats app.url; Host is never consulted", () => {
  const endpoints = resolveBillingIngressEndpoints({
    appUrl: "https://app.example",
    publicBaseUrl: "https://hooks.example",
  });
  assert.equal(
    endpoints?.classicUrl,
    `https://hooks.example${BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH}`
  );
  assert.equal(
    endpoints?.eventsUrl,
    `https://hooks.example${BILLING_MOLLIE_EVENTS_WEBHOOK_PATH}`
  );
});

test("T-ING-LIVE-HTTPS: P?: live automatic management requires HTTPS public URL", () => {
  assert.throws(
    () =>
      assertAthenaBillingIngestion({
        appUrl: "http://localhost:3000",
        ingestion: { webhooks: true },
        live: true,
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_BILLING_INGESTION_PUBLIC_URL_REQUIRED"
  );
});

test("T-ING-NEXTGEN-REQUIRED: P?: required Next-gen fails closed for API keys", () => {
  assert.throws(
    () =>
      assertAthenaBillingIngestion({
        appUrl: "https://app.example",
        credentialKind: "api_key",
        ingestion: {
          webhooks: {
            providers: {
              mollie: { nextGen: { enabled: "required" } },
            },
          },
        },
        live: true,
      }),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_BILLING_INGESTION_NEXT_GEN_REQUIRED"
  );
});

test("T-ING-CAPABILITY: P?: API key is Classic-only with an explicit reason", () => {
  const apiKey = resolveMollieWebhookManagementCapability(apiKeyBinding());
  assert.equal(apiKey.classic, true);
  assert.equal(apiKey.nextGen.available, false);
  assert.equal(apiKey.nextGen.list, false);
  assert.equal(apiKey.nextGen.write, false);
  assert.equal(apiKey.nextGen.reason, "api_key_classic_only");
  const oauth = resolveMollieWebhookManagementCapability(accessTokenBinding());
  assert.equal(oauth.nextGen.available, true);
  assert.equal(oauth.nextGen.list, true);
  assert.equal(oauth.nextGen.write, true);
});

test("T-ING-CAPABILITY-READ: read-only Mollie authority only exposes webhook reads", () => {
  const binding: BillingProviderBinding = {
    ...accessTokenBinding(),
    providerConfig: {
      authority: {
        permissions: { webhooks: { read: true } },
        scope: { kind: "organization" },
      },
    },
  };
  const capability = resolveMollieWebhookManagementCapability(binding);
  assert.equal(capability.nextGen.available, false);
  assert.equal(capability.nextGen.list, true);
  assert.equal(capability.nextGen.write, false);
});

test("T-ING-CAPABILITY-WRITE: write-only Mollie authority only exposes webhook writes", () => {
  const binding: BillingProviderBinding = {
    ...accessTokenBinding(),
    providerConfig: {
      authority: {
        permissions: { webhooks: { write: true } },
        scope: { kind: "organization" },
      },
    },
  };
  const capability = resolveMollieWebhookManagementCapability(binding);
  assert.equal(capability.nextGen.available, true);
  assert.equal(capability.nextGen.list, false);
  assert.equal(capability.nextGen.write, true);
});

test("T-ING-CLASSIC-INJECT: P?: caller webhookUrl never overrides the trusted URL", () => {
  const context = {
    ingress: {
      classicWebhookUrl:
        "https://app.example/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa",
    },
  } as BillingProviderExecutionContext;
  const body = paymentCreateBody(
    {
      amount: { currency: "EUR", value: "10.00" },
      description: "test",
      idempotencyKey: "k",
      webhookUrl: "https://evil.example/hook",
    },
    undefined,
    context
  );
  assert.equal(
    body.webhookUrl,
    "https://app.example/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa"
  );
});

test("T-ING-PATH-KIND: trailing slash still classifies classic and events", () => {
  assert.equal(
    billingWebhookPathKind(`${BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH}/`),
    "classic"
  );
  assert.equal(
    billingWebhookPathKind(`${BILLING_MOLLIE_EVENTS_WEBHOOK_PATH}/`),
    "events"
  );
});

test("T-ING-PATH-BINDING: opaque token classifies and is extracted", () => {
  const token = "whtok_aaaaaaaaaaaaaa";
  const classic = `${BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH}/${token}`;
  const events = `${BILLING_MOLLIE_EVENTS_WEBHOOK_PATH}/${token}`;
  assert.equal(billingWebhookPathKind(classic), "classic");
  assert.equal(billingWebhookPathKind(events), "events");
  assert.equal(billingWebhookIngressBindingToken(classic), token);
  assert.equal(billingWebhookIngressBindingToken(events), token);
  assert.equal(
    billingWebhookIngressBindingToken(BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH),
    undefined
  );
  const endpoints = resolveBillingIngressEndpoints({
    publicBaseUrl: "https://hooks.example",
    webhookIngressToken: token,
  });
  assert.equal(endpoints?.classicUrl, `https://hooks.example${classic}`);
  assert.equal(endpoints?.eventsUrl, `https://hooks.example${events}`);
});

test("T-ING-DIAGNOSTICS: webhook URL templates do not expose binding tokens", () => {
  const exact =
    "https://hooks.example/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa";
  assert.equal(
    billingWebhookUrlTemplate(exact),
    "https://hooks.example/api/athena/billing/webhook/mollie/classic/<binding-token>"
  );
  assert.equal(billingWebhookUrlTemplate(exact).includes("whtok_"), false);
  assert.equal(
    isBillingWebhookIngressBindingToken("whtok_aaaaaaaaaaaaaa"),
    true
  );
  assert.equal(isBillingWebhookIngressBindingToken("short"), false);
});

test("T-ING-OWNERSHIP: P?: Athena only plans mutations for owned webhooks", () => {
  const marker = billingWebhookOwnershipMarker({
    applicationId: "next-minimal",
    connectionId: "conn-1",
  });
  assert.equal(marker.length <= MOLLIE_WEBHOOK_OWNERSHIP_NAME_MAX, true);
  assert.equal(
    billingWebhookOwnershipMarker({
      applicationId: "next-minimal",
      connectionId: "11111111-1111-4111-8111-111111111111",
    }).length <= MOLLIE_WEBHOOK_OWNERSHIP_NAME_MAX,
    true
  );
  assert.match(
    billingWebhookOwnershipMarker({
      applicationId: "next-minimal",
      connectionId: "11111111-1111-4111-8111-111111111111",
    }),
    /^athena:[0-9a-f]{16}$/
  );
  assert.equal(isAthenaOwnedWebhookName("foreign-hook", marker), false);
  const desired = buildDesiredBillingWebhookState({
    applicationId: "next-minimal",
    capability: { classic: true, nextGen: { available: true } },
    connectionId: "conn-1",
    endpoints: {
      classic: "https://app.example/classic",
      nextGen: "https://app.example/events",
    },
    environment: "live",
    management: "automatic",
    provider: "mollie",
    webhooks: normalizeAthenaBillingWebhooks(true),
  });
  const planned = planBillingWebhookReconciliation({
    actual: [
      {
        environment: "live",
        eventTypes: ["payment.paid"],
        id: "wh_foreign",
        name: "someone-else",
        provider: "mollie",
        status: "active",
        url: "https://other.example",
      },
      {
        environment: "live",
        eventTypes: ["payment.paid"],
        id: "wh_owned",
        name: marker,
        provider: "mollie",
        status: "active",
        url: "https://wrong.example",
      },
    ],
    desired,
    management: "automatic",
  });
  assert.equal(planned.foreign.length, 1);
  assert.equal(planned.foreign[0]?.id, "wh_foreign");
  const nextGen = planned.plans.find((plan) => plan.kind === "next_gen");
  assert.equal(nextGen?.action, "update");
  assert.equal(nextGen?.owned, true);
});

test("T-ING-FOREIGN-UNTOUCHED: P?: missing owned webhook is create; foreign stays noop", () => {
  const desired = buildDesiredBillingWebhookState({
    applicationId: "app",
    capability: { classic: true, nextGen: { available: true } },
    connectionId: "c1",
    endpoints: {
      classic: "https://app.example/classic",
      nextGen: "https://app.example/events",
    },
    environment: "live",
    management: "automatic",
    provider: "mollie",
    webhooks: normalizeAthenaBillingWebhooks(true),
  });
  const planned = planBillingWebhookReconciliation({
    actual: [
      {
        environment: "live",
        eventTypes: [],
        id: "wh_other",
        name: "not-ours",
        provider: "mollie",
        status: "active",
        url: "https://other.example",
      },
    ],
    desired,
    management: "automatic",
  });
  assert.equal(planned.foreign.length, 1);
  assert.equal(
    planned.plans.find((plan) => plan.kind === "next_gen")?.action,
    "create"
  );
});

test("T-ING-LOOPBACK-URL: P?: localhost events URL is not planned as Mollie create", () => {
  assert.equal(
    billingWebhookUrlIsLoopback(
      "http://localhost:3010/api/athena/billing/webhook/mollie/events"
    ),
    true
  );
  assert.equal(
    billingWebhookUrlIsLoopback(
      "https://pay.example.com/api/athena/billing/webhook/mollie/events"
    ),
    false
  );
  const desired = buildDesiredBillingWebhookState({
    applicationId: "app",
    capability: { classic: true, nextGen: { available: true } },
    connectionId: "c1",
    endpoints: {
      classic:
        "http://localhost:3010/api/athena/billing/webhook/mollie/classic",
      nextGen: "http://localhost:3010/api/athena/billing/webhook/mollie/events",
    },
    environment: "test",
    management: "automatic",
    provider: "mollie",
    webhooks: normalizeAthenaBillingWebhooks(true),
  });
  const planned = planBillingWebhookReconciliation({
    actual: [],
    desired,
    management: "automatic",
  });
  const nextGen = planned.plans.find((plan) => plan.kind === "next_gen");
  assert.equal(nextGen?.action, "noop");
  assert.equal(nextGen?.reason, "loopback_webhook_url");
});

test("T-ING-LEASE: P?: webhook_registrations lease permits one writer", async () => {
  const { store } = createMemoryBillingReconciliationLeaseStore();
  const first = await store.acquire({
    connectionId: "11111111-1111-1111-1111-111111111111",
    ownerId: "a",
    resourceKind: BILLING_RECONCILIATION_RESOURCE_WEBHOOK_REGISTRATIONS,
  });
  const second = await store.acquire({
    connectionId: "11111111-1111-1111-1111-111111111111",
    ownerId: "b",
    resourceKind: BILLING_RECONCILIATION_RESOURCE_WEBHOOK_REGISTRATIONS,
  });
  assert.ok(first);
  assert.equal(second, null);
});

test("T-ING-SECRETS: P?: verification set is current plus previous", () => {
  const webhooks = normalizeAthenaBillingWebhooks({
    providers: {
      mollie: {
        nextGen: {
          previousSigningSecrets: ["old"],
          signingSecret: "current",
        },
      },
    },
  });
  const set = signingSecretsFromWebhookConfig(webhooks);
  assert.deepEqual(flattenSigningSecrets(set), ["current", "old"]);
});

test("T-ING-MOLLIE-CREATE-SECRET: create projection reads webhookSecret once", () => {
  assert.equal(
    readMollieWebhookSigningSecret({
      id: "hook_1",
      webhookSecret: "VpQ3WukU6uSCGQ8TPTD3WPDpac3GyNEj",
    }),
    "VpQ3WukU6uSCGQ8TPTD3WPDpac3GyNEj"
  );
  assert.equal(readMollieWebhookSigningSecret({ id: "hook_1" }), undefined);
});

test("T-ING-MIGRATION-0006: P?: webhook registrations SQL exists", () => {
  const path = join(
    pkgRoot,
    "src/migrations/embedded-billing/sql/0006_billing_webhook_management.sql"
  );
  assert.equal(existsSync(path), true);
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /billing_webhook_registrations/);
  assert.match(sql, /webhook_registrations/);
  assert.doesNotMatch(sql, /signing_secret/);
});

test("T-ING-MIGRATION-0031: webhook registration lifecycle is in the embedded ledger", () => {
  const migration = EMBEDDED_BILLING_MIGRATIONS.find(
    (entry) => entry.version === 31
  );
  assert.ok(migration);
  assert.equal(migration.filename, "0031_billing_webhook_lifecycle.sql");
  assert.match(migration.sql, /provider_registration_idempotency_key/);
  assert.match(migration.sql, /provider_registered_secret_pending/);
  assert.match(migration.sql, /secret_persisted_activation_pending/);
  assert.match(migration.sql, /verification_pending/);
  assert.match(migration.sql, /lifecycle_error/);
  assert.doesNotMatch(migration.sql, /providerSigningSecret/);
});

test("T-ING-CLI: P?: billing webhooks commands parse", () => {
  const parsed = parse(["webhooks", "reconcile", "--dry-run", "--json"]);
  assert.equal(parsed.command, "billing-webhooks");
  if (parsed.command === "billing-webhooks") {
    assert.equal(parsed.action, "reconcile");
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.json, true);
  }
});

test("T-ING-OPS-UI: P?: operations surface includes webhook ingestion", () => {
  const presets = readFileSync(
    join(
      pkgRoot,
      "..",
      "athena-auth-ui",
      "src/components/auth/billing/billing-query-presets.ts"
    ),
    "utf8"
  );
  assert.match(presets, /webhookRegistrations/);
  const card = readFileSync(
    join(
      pkgRoot,
      "..",
      "athena-auth-ui",
      "src/components/auth/billing/billing-webhook-ingestion-card.tsx"
    ),
    "utf8"
  );
  assert.match(card, /Reconcile/);
  assert.doesNotMatch(card, /signingSecret/);
});

test("T-ING-PORT: P?: BillingWebhooksPort exposes list/create", () => {
  const src = readFileSync(
    join(pkgRoot, "src/billing/runtime/local/providers/types.ts"),
    "utf8"
  );
  assert.match(src, /export interface BillingWebhooksPort/);
  assert.match(src, /list\(/);
  assert.match(src, /create\(/);
});

test("T-ING-APP-ID: P?: webhook ownership id is not app.name", () => {
  assert.equal(
    resolveBillingWebhookApplicationId({
      app: { id: "app_install_1", name: "My Platform" },
      client: "ignored-when-id-present",
    }),
    "app_install_1"
  );
  assert.equal(
    resolveBillingWebhookApplicationId({
      app: { name: "My App" },
    }),
    undefined
  );
  assert.equal(
    resolveBillingWebhookApplicationId({
      app: { name: "My App" },
      client: "next-minimal",
    }),
    "next-minimal"
  );
});

test("T-ING-MIGRATION-0007: P?: connections store credential_reference", () => {
  const path = join(
    pkgRoot,
    "src/migrations/embedded-billing/sql/0007_billing_connection_credential_reference.sql"
  );
  assert.equal(existsSync(path), true);
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /credential_reference/);
  assert.doesNotMatch(sql, /live_key|test_key|api_key_secret/);
});

test("T-ING-OPS-ADMIN: P?: operator billing operations exist and map to dialect Rights", () => {
  const rights = readFileSync(
    join(pkgRoot, "src/billing/runtime/operation-policy.ts"),
    "utf8"
  );
  assert.match(
    rights,
    /policy\("admin.reconciliation.run", "admin", \[ADMIN_RECONCILIATION_WRITE\]\)/
  );
  assert.match(
    rights,
    /policy\("admin.webhooks.reconcile", "admin", \[ADMIN_WEBHOOKS_WRITE\]\)/
  );
  assert.match(
    rights,
    /policy\("admin.webhooks.status", "admin", \[ADMIN_WEBHOOKS_READ\]\)/
  );
  assert.match(
    rights,
    /policy\("admin.conflicts.resolve", "admin", \[ADMIN_CONFLICTS_WRITE\]\)/
  );
  assert.match(
    rights,
    /policy\("admin.ingestion.health", "admin", \[ADMIN_INGESTION_READ\]\)/
  );
  assert.match(
    rights,
    /policy\("admin.connections.materialize", "admin", \[\s*ADMIN_RECONCILIATION_WRITE\s*,?\s*\]\)/
  );
  const attach = readFileSync(
    join(pkgRoot, "src/billing/runtime/local/materialize.ts"),
    "utf8"
  );
  const body = attach.slice(
    attach.indexOf("export function bootstrapLocalBillingRuntime")
  );
  const materializeAt = body.indexOf(
    "materializeConfiguredBillingConnections({"
  );
  const firstSchedulerAt = body.indexOf("registerEmbeddedBillingScheduler({");
  assert.ok(materializeAt >= 0);
  assert.ok(firstSchedulerAt > materializeAt);
  assert.match(body, /createAthenaRuntimeReadiness/);
  assert.match(attach, /bootstrapReadiness/);
  assert.match(body, /retainEmbeddedBillingRuntimeScheduler/);
  assert.match(body, /claimEmbeddedBillingRuntimeOwner/);
  assert.match(body, /billingSchedulerHandles/);
  assert.match(attach, /waitForOperational/);
  assert.match(body, /await bootstrapReadiness\.wait\(\)/);
  assert.doesNotMatch(attach, /\bbillingReady\b/);
  const handlers = readFileSync(
    join(pkgRoot, "src/next/billing-handlers.ts"),
    "utf8"
  );
  assert.match(handlers, /admin.reconciliation.run/);
  assert.match(handlers, /admin.webhooks.reconcile/);
  assert.match(handlers, /admin.connections.materialize/);
  assert.match(handlers, /admin.bootstrap.retry/);
  const ui = readFileSync(
    join(
      pkgRoot,
      "..",
      "athena-auth-ui",
      "src/components/auth/billing/use-billing-admin.ts"
    ),
    "utf8"
  );
  assert.match(ui, /admin\?\.reconciliation\.run/);
  assert.doesNotMatch(ui, /UPDATE billing_subject_bindings/);
  assert.doesNotMatch(ui, /role === ["']admin["']/);
});
