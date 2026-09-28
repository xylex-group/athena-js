import { listActiveBillingImportConnections } from "../import/postgres.ts";
import { createPostgresBillingAuditWriter } from "../observability/audit.ts";
import { normalizeAthenaBillingObservability } from "../observability/config.ts";
import {
  createDisabledBillingTraceRecorder,
  createPostgresBillingTraceRecorder,
} from "../observability/traces.ts";
import type { NormalizedAthenaBillingObservability } from "../observability/types.ts";
import type { BillingProviderConfigMap } from "../providers/types.ts";
import {
  mintManualBillingReconciliationContext,
  mintScheduledBillingReconciliationContext,
} from "../reconciliation/context.ts";
import { createPostgresBillingReconciliationLeaseStore } from "../reconciliation/lease.ts";
import { resolveBillingEnvironment } from "../runtime/environment.ts";
import { supersedeOtherEnvironmentBillingConnections } from "../runtime/local/connections/materialize.ts";
import {
  billingConnectionHasConfiguredCredential,
  billingConnectionMatchesProcessTestMode,
  createConnectionProviderExecutionContext,
} from "../runtime/local/providers/connection-binding.ts";
import { resolveMollieWebhookManagementCapability } from "../runtime/local/providers/mollie/webhook-capability.ts";
import type { BillingProviderRegistry } from "../runtime/local/providers/registry.ts";
import type { BillingSqlExecutor } from "../subject/repository.ts";
import { reconcileBillingWebhookRegistrations } from "./reconciliation/coordinator.ts";
import { createPostgresBillingWebhookRegistrationStore } from "./reconciliation/repository.ts";
import type { BillingWebhookSecretStore } from "./secrets/types.ts";
import type { NormalizedAthenaBillingWebhooksConfig } from "./types.ts";
import {
  billingWebhookUrlIsLoopback,
  resolveBillingIngressEndpoints,
} from "./urls.ts";

const warnedLoopbackWebhookUrls = new Set<string>();
const warnedSkippedWebhookConnections = new Set<string>();

export async function runAutomaticBillingWebhookReconcileIfEnabled(input: {
  applicationId: string;
  appUrl?: string | null;
  configuredProviders?: BillingProviderConfigMap;
  observability?: NormalizedAthenaBillingObservability;
  registry?: BillingProviderRegistry;
  sql: BillingSqlExecutor;
  testMode?: boolean;
  trigger: "bootstrap" | "scheduled" | "manual";
  webhooks: NormalizedAthenaBillingWebhooksConfig;
  rememberSigningSecret?: (input: {
    connectionId: string;
    secret: string;
  }) => void;
  secretStore?: BillingWebhookSecretStore;
}): Promise<void> {
  if (!input.webhooks.enabled) {
    return;
  }
  const connections = await listActiveBillingImportConnections(
    input.sql,
    "mollie"
  );
  const observability =
    input.observability ?? normalizeAthenaBillingObservability();
  const traces = observability.traces.enabled
    ? createPostgresBillingTraceRecorder(
        input.sql,
        observability.traces.sampleRate
      )
    : createDisabledBillingTraceRecorder();
  const audit = observability.auditLog
    ? createPostgresBillingAuditWriter(input.sql)
    : undefined;
  const mollie = input.configuredProviders?.mollie;
  if (mollie == null && input.configuredProviders?.mollieAccounts == null) {
    return;
  }
  const runtime = input.registry?.get("mollie");
  for (const connection of connections) {
    if (
      !billingConnectionMatchesProcessTestMode(
        connection.testMode,
        input.testMode
      )
    ) {
      const skipKey = `env:${connection.id}`;
      if (!warnedSkippedWebhookConnections.has(skipKey)) {
        warnedSkippedWebhookConnections.add(skipKey);
        console.warn(
          "[athena-billing] skipping webhook reconciliation; connection environment does not match process billing.testMode",
          {
            connectionId: connection.id,
            environment: connection.environment,
            processTestMode: resolveBillingEnvironment({
              testMode: input.testMode,
            }).testMode,
          }
        );
      }
      continue;
    }
    if (
      !billingConnectionHasConfiguredCredential({
        configuredProviders: input.configuredProviders,
        connection,
      })
    ) {
      const skipKey = `cred:${connection.id}`;
      if (!warnedSkippedWebhookConnections.has(skipKey)) {
        warnedSkippedWebhookConnections.add(skipKey);
        console.warn(
          "[athena-billing] skipping webhook reconciliation; connection environment has no configured credential",
          {
            connectionId: connection.id,
            environment: connection.environment,
          }
        );
      }
      continue;
    }
    const endpoints = resolveBillingIngressEndpoints({
      appUrl: input.appUrl,
      publicBaseUrl: input.webhooks.publicBaseUrl,
      webhookIngressToken: connection.webhookIngressToken,
    });
    if (!endpoints) {
      continue;
    }
    const skipProviderWebhookApi = billingWebhookUrlIsLoopback(
      endpoints.eventsUrl
    );
    if (
      skipProviderWebhookApi &&
      !warnedLoopbackWebhookUrls.has(endpoints.eventsUrl)
    ) {
      warnedLoopbackWebhookUrls.add(endpoints.eventsUrl);
      console.warn(
        "[athena-billing] skipping Mollie next-gen webhook registration; the public URL is loopback and Mollie cannot reach it",
        { url: endpoints.eventsUrl }
      );
    }
    const context =
      input.trigger === "scheduled"
        ? mintScheduledBillingReconciliationContext({
            connectionId: connection.id,
            provider: connection.provider,
            schedulerExecutionId: crypto.randomUUID(),
          })
        : mintManualBillingReconciliationContext({
            connectionId: connection.id,
            provider: connection.provider,
            trigger: input.trigger === "bootstrap" ? "bootstrap" : "manual",
          });
    const execution = createConnectionProviderExecutionContext({
      configuredProviders: input.configuredProviders,
      connection,
      ingress: { classicWebhookUrl: endpoints.classicUrl },
      operationScope: "organization",
    });
    const capability = resolveMollieWebhookManagementCapability(
      execution.binding
    );
    const reconciled = await reconcileBillingWebhookRegistrations({
      audit,
      context,
      execution,
      lease: createPostgresBillingReconciliationLeaseStore(input.sql),
      port: skipProviderWebhookApi ? undefined : runtime?.webhooks,
      reconcile: {
        applicationId: input.applicationId,
        capability,
        connectionId: connection.id,
        endpoints,
        environment: connection.environment,
        management: input.webhooks.management,
        provider: connection.provider,
        webhooks: input.webhooks,
      },
      registrations: createPostgresBillingWebhookRegistrationStore(input.sql),
      rememberSigningSecret: input.rememberSigningSecret,
      secretStore: input.secretStore,
      traces,
    });
    if (skipProviderWebhookApi || connection.provider !== "mollie") {
      continue;
    }
    if (reconciled.plans.some((plan) => plan.action === "conflict")) {
      continue;
    }
    await supersedeOtherEnvironmentBillingConnections({
      applicationId: input.applicationId,
      credentialReference: connection.credentialReference,
      environment: connection.environment,
      id: connection.id,
      provider: "mollie",
      sql: input.sql,
    });
  }
}
