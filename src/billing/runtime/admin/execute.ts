import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import {
  ATHENA_BILLING_PROVIDER_MATERIALIZATION_UNSUPPORTED,
  AthenaBillingCapabilityError,
  AthenaBillingProviderError,
} from "../../errors.ts";
import { runBillingCustomerImportWithPostgres } from "../../import/assemble.ts";
import {
  createPostgresBillingImportBindingStore,
  createPostgresBillingImportDocumentStore,
  listActiveBillingImportConnections,
  resolveBillingImportConnection,
} from "../../import/postgres.ts";
import { reconcileBillingDocumentsForBinding } from "../../import/project.ts";
import {
  type BillingImportRunReport,
  DEFAULT_BILLING_IMPORT_POLICY,
} from "../../import/types.ts";
import { runAutomaticBillingWebhookReconcileIfEnabled } from "../../ingestion/automatic.ts";
import { assertAthenaBillingIngestion } from "../../ingestion/config.ts";
import {
  billingWebhookOperatorHealth,
  createPostgresBillingWebhookIngressObservability,
} from "../../ingestion/observability/health.ts";
import { billingWebhookOperationalStatus } from "../../ingestion/observability/operational-status.ts";
import {
  billingWebhookConfigHash,
  buildDesiredBillingWebhookState,
} from "../../ingestion/reconciliation/desired-state.ts";
import { connectionIngestionHealthFromRegistrations } from "../../ingestion/reconciliation/health.ts";
import { createPostgresBillingWebhookRegistrationStore } from "../../ingestion/reconciliation/repository.ts";
import type {
  AthenaBillingIngestionConfig,
  NormalizedAthenaBillingIngestionConfig,
} from "../../ingestion/types.ts";
import {
  BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
  BILLING_MOLLIE_EVENTS_WEBHOOK_PATH,
  resolveBillingIngressEndpoints,
} from "../../ingestion/urls.ts";
import { createPostgresBillingAuditWriter } from "../../observability/audit.ts";
import { normalizeAthenaBillingObservability } from "../../observability/config.ts";
import { billingEventDefinition } from "../../observability/events.ts";
import type { AthenaBillingAuditEntry } from "../../observability/types.ts";
import {
  mintBillingAuditIdentity,
  validateBillingAuditEntry,
} from "../../observability/validate.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import type { BillingSelfEnrollmentSetting } from "../../self-enrollment.ts";
import { mintManualBillingReconciliationContext } from "../../reconciliation/context.ts";
import { prepareBillingCommand } from "../../safety/prepare.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingOperation } from "../capabilities.ts";
import type { BillingInvocationAuthority } from "../invocation-authority.ts";
import { materializeConfiguredBillingConnections } from "../local/connections/materialize.ts";
import { createConnectionProviderExecutionContext } from "../local/providers/connection-binding.ts";
import { resolveMollieWebhookManagementCapability } from "../local/providers/mollie/webhook-capability.ts";
import type { BillingProviderRegistry } from "../local/providers/registry.ts";
import { denyBillingInvocation } from "../rights.ts";
import {
  ADMIN_OP,
  type AdminBillingOperation,
  isAdminBillingOperation,
} from "./operations.ts";
import type {
  BillingAdminBootstrapRetryResult,
  BillingAdminConflictResolveInput,
  BillingAdminConflictResolveResult,
  BillingAdminConnectionInput,
  BillingAdminIngestionHealth,
  BillingAdminPort,
  BillingAdminWebhookReconcileInput,
  BillingAdminWebhookStatus,
  BillingWebhookDesiredActualRow,
} from "./types.ts";

export interface BillingAdminRuntimeOptions {
  applicationId?: string;
  appUrl?: string | null;
  configuredProviders?: BillingProviderConfigMap;
  customerImport?: {
    customers?: { allowUniqueEmailAutoBind?: boolean };
  };
  ingestion?: AthenaBillingIngestionConfig;
  observability?: Parameters<typeof normalizeAthenaBillingObservability>[0];
  registry: BillingProviderRegistry;
  selfEnrollmentEnabled?: BillingSelfEnrollmentSetting;
  sql?: BillingSqlExecutor;
  testMode?: boolean;
  bootstrapRetry?: () => Promise<BillingAdminBootstrapRetryResult>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function requireSql(
  sql: BillingSqlExecutor | undefined,
  operation: AdminBillingOperation
): BillingSqlExecutor {
  if (!sql) {
    throw new AthenaBillingCapabilityError({
      operation,
      reason: "runtime_unavailable",
    });
  }
  return sql;
}

function actorFromPrincipal(
  principal: AthenaPrincipal
): AthenaBillingAuditEntry["actor"] {
  if (
    principal.authenticated === true &&
    typeof principal.userId === "string"
  ) {
    return { kind: "user", userId: principal.userId };
  }
  return { kind: "system" };
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`ATHENA_BILLING_FIELD_REQUIRED:${key}`);
  }
  return value;
}

async function latestImportRun(
  sql: BillingSqlExecutor,
  connectionId?: string
): Promise<{ completedAt: string | null; status: string } | null> {
  const result = connectionId
    ? await sql.query(
        `SELECT status, completed_at FROM billing.billing_import_runs
				 WHERE connection_id = $1::uuid
				 ORDER BY started_at DESC LIMIT 1`,
        [connectionId]
      )
    : await sql.query(
        `SELECT status, completed_at FROM billing.billing_import_runs
				 ORDER BY started_at DESC LIMIT 1`
      );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at.toISOString()
        : typeof row.completed_at === "string"
          ? row.completed_at
          : null,
    status: String(row.status ?? ""),
  };
}

async function conflictCount(
  sql: BillingSqlExecutor,
  connectionId?: string
): Promise<number> {
  const result = connectionId
    ? await sql.query(
        `SELECT
				 (SELECT count(*)::int FROM billing.billing_import_candidates
				  WHERE connection_id = $1::uuid
				    AND decision IN ('conflict', 'manual_review')
				    AND resolved_at IS NULL)
				 +
				 (SELECT count(*)::int FROM billing.billing_binding_conflicts
				  WHERE connection_id = $1::uuid AND status = 'open')
				 AS n`,
        [connectionId]
      )
    : await sql.query(
        `SELECT
				 (SELECT count(*)::int FROM billing.billing_import_candidates
				  WHERE decision IN ('conflict', 'manual_review')
				    AND resolved_at IS NULL)
				 +
				 (SELECT count(*)::int FROM billing.billing_binding_conflicts
				  WHERE status = 'open')
				 AS n`
      );
  const n = result.rows[0]?.n;
  return typeof n === "number" ? n : Number(n ?? 0);
}

async function resolveConnectionId(
  sql: BillingSqlExecutor,
  input: BillingAdminConnectionInput | undefined,
  provider: string
): Promise<string> {
  if (
    typeof input?.connectionId === "string" &&
    input.connectionId.length > 0
  ) {
    return input.connectionId;
  }
  const connections = await listActiveBillingImportConnections(sql, provider);
  const first = connections[0];
  if (!first) {
    throw new AthenaBillingCapabilityError({
      operation: "admin.ingestion.health",
      reason: "missing_connection",
    });
  }
  return first.id;
}

function webhookRejectionCode(error: unknown): string | null {
  if (error == null || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }
  if (!("code" in error)) {
    return null;
  }
  const code = error.code;
  if (typeof code !== "string" || code.length === 0 || /secret/i.test(code)) {
    return null;
  }
  return code;
}

async function webhookStatus(input: {
  applicationId: string;
  appUrl?: string | null;
  configuredProviders?: BillingProviderConfigMap;
  connectionId: string;
  ingestion: NormalizedAthenaBillingIngestionConfig;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<BillingAdminWebhookStatus> {
  const webhooks = input.ingestion.webhooks;
  const connection = await resolveBillingImportConnection(input.sql, {
    connectionId: input.connectionId,
    provider: "mollie",
  });
  const endpoints = resolveBillingIngressEndpoints({
    appUrl: input.appUrl,
    publicBaseUrl: webhooks.publicBaseUrl,
    webhookIngressToken: connection.webhookIngressToken,
  });
  const execution = createConnectionProviderExecutionContext({
    configuredProviders: input.configuredProviders,
    connection,
    operationScope: "organization",
  });
  const capability = resolveMollieWebhookManagementCapability(
    execution.binding
  );
  const environment = connection.environment;
  const desired = endpoints
    ? buildDesiredBillingWebhookState({
        applicationId: input.applicationId,
        capability,
        connectionId: input.connectionId,
        endpoints,
        environment,
        management: webhooks.management,
        provider: "mollie",
        webhooks,
      })
    : undefined;
  const store = createPostgresBillingWebhookRegistrationStore(input.sql);
  const rows = await store.list(input.connectionId);
  const classic = rows.find((row) => row.kind === "classic");
  const nextGen = rows.find((row) => row.kind === "next_gen");
  const health = connectionIngestionHealthFromRegistrations(rows);
  const desiredClassicUrl = desired?.classic?.url ?? null;
  const desiredEvents = desired?.nextGen?.eventTypes.length ?? 0;
  const actualEvents = nextGen?.eventTypes.length ?? 0;
  const desiredHash = desired?.nextGen
    ? billingWebhookConfigHash({
        eventTypes: desired.nextGen.eventTypes,
        kind: "next_gen",
        url: desired.nextGen.url,
      })
    : null;
  const comparison: BillingWebhookDesiredActualRow[] = [
    {
      actual: health.classic,
      desired: desired?.classic ? "enabled" : "disabled",
      key: "classic",
    },
    {
      actual: health.nextGen,
      desired:
        desired?.nextGen == null
          ? "disabled"
          : desired.nextGen.enabled
            ? "auto"
            : "unsupported",
      key: "nextGen",
    },
    {
      actual: classic?.url ?? nextGen?.url ?? null,
      desired: desiredClassicUrl ?? desired?.nextGen?.url ?? null,
      key: "endpoint",
    },
    {
      actual: actualEvents,
      desired: desiredEvents,
      key: "events",
    },
    {
      actual: nextGen?.configHash ?? classic?.configHash ?? null,
      desired: desiredHash,
      key: "configHash",
    },
    {
      actual: "authoritative_refetch",
      desired: "authoritative_refetch",
      key: "verification.classic",
    },
    {
      actual: "signature_and_refetch",
      desired: "signature_and_refetch",
      key: "verification.nextGen",
    },
    {
      actual: desiredClassicUrl,
      desired: desiredClassicUrl,
      key: "classic.url.configured",
    },
    {
      actual: classic?.url ?? null,
      desired: desiredClassicUrl,
      key: "classic.url.registered",
    },
    {
      actual: desired?.nextGen?.url ?? null,
      desired: desired?.nextGen?.url ?? null,
      key: "nextGen.url.configured",
    },
    {
      actual: nextGen?.url ?? null,
      desired: desired?.nextGen?.url ?? null,
      key: "nextGen.url.registered",
    },
    {
      actual: classic?.lastDeliveryAt?.toISOString() ?? null,
      desired: null,
      key: "classic.lastDeliveryAt",
    },
    {
      actual: nextGen?.lastDeliveryAt?.toISOString() ?? null,
      desired: null,
      key: "nextGen.lastDeliveryAt",
    },
    {
      actual:
        classic?.lastRejectionCode ??
        nextGen?.lastRejectionCode ??
        webhookRejectionCode(classic?.lastError ?? nextGen?.lastError),
      desired: null,
      key: "lastRejectionCode",
    },
    {
      actual: Boolean(endpoints),
      desired: Boolean(endpoints),
      key: "routeMounted",
    },
    {
      actual: classic?.lastAcceptedAt?.toISOString() ?? null,
      desired: null,
      key: "classic.lastAcceptedAt",
    },
    {
      actual: classic?.lastIngressStage ?? null,
      desired: null,
      key: "classic.lastIngressStage",
    },
    {
      actual: classic?.lastReconciliationOutcome ?? null,
      desired: null,
      key: "classic.lastReconciliationOutcome",
    },
    {
      actual: nextGen?.lastAcceptedAt?.toISOString() ?? null,
      desired: null,
      key: "nextGen.lastAcceptedAt",
    },
    {
      actual: nextGen?.lastIngressStage ?? null,
      desired: null,
      key: "nextGen.lastIngressStage",
    },
    {
      actual: nextGen?.lastReconciliationOutcome ?? null,
      desired: null,
      key: "nextGen.lastReconciliationOutcome",
    },
  ];
  const secretRow = nextGen ?? classic;
  const signingSecretConfigured = Boolean(
    webhooks.providers.mollie.nextGen.signingSecret
  );
  const previousSigningSecretsConfigured =
    webhooks.providers.mollie.nextGen.previousSigningSecrets.length;
  const deliveryRows = await createPostgresBillingWebhookIngressObservability(
    input.sql
  ).listDelivery(input.connectionId);
  const classicDelivery = deliveryRows.find((row) => row.kind === "classic");
  const nextGenDelivery = deliveryRows.find((row) => row.kind === "next_gen");
  const mounted = endpoints ? ("unknown" as const) : false;
  const channels = {
    classic: billingWebhookOperationalStatus({
      connectionId: input.connectionId,
      endpoint: endpoints?.classicUrl ?? BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
      kind: "classic",
      mounted,
      previousSigningSecretsConfigured: 0,
      signingSecretConfigured: false,
      ...(classic ? { registration: classic } : {}),
      ...(classicDelivery ? { delivery: classicDelivery } : {}),
    }),
    nextGen: billingWebhookOperationalStatus({
      connectionId: input.connectionId,
      endpoint: endpoints?.eventsUrl ?? BILLING_MOLLIE_EVENTS_WEBHOOK_PATH,
      kind: "next_gen",
      mounted,
      previousSigningSecretsConfigured,
      signingSecretConfigured,
      ...(nextGen ? { registration: nextGen } : {}),
      ...(nextGenDelivery ? { delivery: nextGenDelivery } : {}),
    }),
  };
  return {
    channels,
    classic: health.classic,
    configSource: "application_configuration",
    connectionId: input.connectionId,
    delivery: billingWebhookOperatorHealth({
      ...(classic ? { classic } : {}),
      ...(endpoints ? { endpoints } : {}),
      ...(nextGen ? { nextGen } : {}),
      signingSecretConfigured,
    }),
    drift: health.drifted || desiredEvents !== actualEvents,
    environment,
    management: webhooks.management,
    nextGen: health.nextGen,
    provider: "mollie",
    rows: comparison,
    secret: {
      configured: signingSecretConfigured,
      ...(typeof secretRow?.secretFingerprint === "string"
        ? { fingerprint: secretRow.secretFingerprint }
        : {}),
      ...(typeof secretRow?.secretVersion === "number"
        ? { version: secretRow.secretVersion }
        : {}),
    },
    strategy: webhooks.providers.mollie.strategy,
  };
}

async function runReconciliation(input: {
  configuredProviders?: BillingProviderConfigMap;
  connectionId?: string;
  customerImport?: BillingAdminRuntimeOptions["customerImport"];
  dryRun?: boolean;
  observability?: BillingAdminRuntimeOptions["observability"];
  provider?: string;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<BillingImportRunReport> {
  return runBillingCustomerImportWithPostgres({
    configuredProviders: input.configuredProviders,
    connectionId: input.connectionId,
    dryRun: input.dryRun === true,
    observability: normalizeAthenaBillingObservability(input.observability),
    policy: {
      ...DEFAULT_BILLING_IMPORT_POLICY,
      allowUniqueEmailAutoBind:
        input.customerImport?.customers?.allowUniqueEmailAutoBind === true,
    },
    provider: input.provider,
    sql: input.sql,
    testMode: input.testMode,
    trigger: "manual",
  });
}

async function resolveConflict(input: {
  payload: BillingAdminConflictResolveInput;
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<BillingAdminConflictResolveResult> {
  const context = mintManualBillingReconciliationContext({
    connectionId: input.payload.connectionId,
    provider: "mollie",
    trigger: "manual",
  });
  const bindings = createPostgresBillingImportBindingStore(input.sql);
  const existing = await bindings.findByLocator({
    connectionId: input.payload.connectionId,
    providerCustomerId: input.payload.providerCustomerId,
  });
  if (input.payload.action === "keep") {
    return {
      action: "keep",
      bindingId: existing?.id,
      traceId: context.traceId,
    };
  }
  const subject = input.payload.subject;
  if (!subject) {
    throw new Error("ATHENA_BILLING_FIELD_REQUIRED:subject");
  }
  if (input.payload.action === "reassign") {
    if (input.payload.confirmReassign !== true) {
      throw new Error("ATHENA_BILLING_FIELD_REQUIRED:confirmReassign");
    }
    if (existing) {
      await input.sql.query(
        `UPDATE billing.billing_subject_bindings
				 SET status = 'revoked', is_primary = false, updated_at = now()
				 WHERE id = $1::uuid`,
        [existing.id]
      );
      const audit = createPostgresBillingAuditWriter(input.sql);
      const ir = billingEventDefinition("billing.subject.binding.revoked");
      const entry: AthenaBillingAuditEntry = {
        actor: actorFromPrincipal(input.principal),
        causationId: context.causationId,
        connectionId: input.payload.connectionId,
        correlationId: context.correlationId,
        event: "billing.subject.binding.revoked",
        ...mintBillingAuditIdentity(),
        outcome: "success",
        previous: existing,
        provider: "mollie",
        providerSubject: {
          id: input.payload.providerCustomerId,
          kind: "customer",
        },
        result: { action: "reassign" },
        subject,
        traceId: context.traceId,
      };
      validateBillingAuditEntry(entry, ir);
      await audit.write(entry);
    }
  }
  const created = await bindings.insertActive({
    connectionId: input.payload.connectionId,
    providerCustomerId: input.payload.providerCustomerId,
    source: "reconciled",
    subject,
  });
  await reconcileBillingDocumentsForBinding(
    createPostgresBillingImportDocumentStore(input.sql),
    {
      connectionId: input.payload.connectionId,
      providerCustomerId: input.payload.providerCustomerId,
      subject,
    }
  );
  await input.sql.query(
    `UPDATE billing.billing_import_candidates
		 SET decision = 'bind', subject_kind = $3, subject_id = $4, resolved_at = now()
		 WHERE connection_id = $1::uuid
		   AND provider_customer_id = $2
		   AND resolved_at IS NULL`,
    [
      input.payload.connectionId,
      input.payload.providerCustomerId,
      subject.kind,
      subject.id,
    ]
  );
  const audit = createPostgresBillingAuditWriter(input.sql);
  const ir = billingEventDefinition("billing.subject.binding.created");
  const entry: AthenaBillingAuditEntry = {
    actor: actorFromPrincipal(input.principal),
    causationId: context.causationId,
    connectionId: input.payload.connectionId,
    correlationId: context.correlationId,
    event: "billing.subject.binding.created",
    ...mintBillingAuditIdentity(),
    outcome: "success",
    provider: "mollie",
    providerSubject: {
      id: input.payload.providerCustomerId,
      kind: "customer",
    },
    result: { action: input.payload.action, bindingId: created.id },
    subject,
    traceId: context.traceId,
  };
  validateBillingAuditEntry(entry, ir);
  await audit.write(entry);
  return {
    action: input.payload.action,
    bindingId: created.id,
    traceId: context.traceId,
  };
}

export async function executeAdminBillingOperation(input: {
  authority: BillingInvocationAuthority;
  operation: string;
  options: BillingAdminRuntimeOptions;
  payload: unknown;
  principal: AthenaPrincipal;
}): Promise<unknown> {
  if (!isAdminBillingOperation(input.operation)) {
    throw new AthenaBillingCapabilityError({
      operation: input.operation,
      reason: "unsupported_operation",
    });
  }
  const operation = input.operation;
  const denied = denyBillingInvocation(
    input.principal,
    operation as BillingOperation,
    input.authority
  );
  if (denied) {
    throw denied;
  }
  prepareBillingCommand({
    operation: operation as BillingOperation,
    payload: asRecord(input.payload),
    testMode: input.options.testMode,
  });
  if (operation === "admin.bootstrap.retry") {
    if (input.options.bootstrapRetry == null) {
      throw new AthenaBillingCapabilityError({
        operation,
        reason: "runtime_unavailable",
      });
    }
    return input.options.bootstrapRetry();
  }
  const sql = requireSql(input.options.sql, operation);
  const applicationId = input.options.applicationId?.trim();
  if (applicationId == null || applicationId.length === 0) {
    throw new AthenaBillingCapabilityError({
      operation,
      reason: "runtime_unavailable",
    });
  }
  const payload = asRecord(input.payload);
  const ingestion = assertAthenaBillingIngestion({
    appUrl: input.options.appUrl,
    ingestion: input.options.ingestion,
    live: input.options.testMode === false,
  });
  if (operation === "admin.connections.materialize") {
    const provider =
      typeof payload.provider === "string" && payload.provider.trim().length > 0
        ? payload.provider.trim().toLowerCase()
        : undefined;
    if (provider != null && !input.options.registry.has(provider)) {
      throw new AthenaBillingProviderError({
        code: ATHENA_BILLING_PROVIDER_MATERIALIZATION_UNSUPPORTED,
        message: `Billing provider "${provider}" is not registered for connection materialization.`,
      });
    }
    return materializeConfiguredBillingConnections({
      applicationId,
      appUrl: input.options.appUrl,
      configuredProviders: input.options.configuredProviders,
      ...(provider == null ? {} : { provider }),
      publicBaseUrl: ingestion.webhooks.publicBaseUrl,
      sql,
      testMode: input.options.testMode,
    });
  }
  if (operation === "admin.reconciliation.run") {
    return runReconciliation({
      configuredProviders: input.options.configuredProviders,
      connectionId:
        typeof payload.connectionId === "string"
          ? payload.connectionId
          : undefined,
      customerImport: input.options.customerImport,
      dryRun: payload.dryRun === true,
      observability: input.options.observability,
      provider:
        typeof payload.provider === "string" ? payload.provider : undefined,
      sql,
      testMode: input.options.testMode,
    });
  }
  if (operation === "admin.reconciliation.retry") {
    const runId = requireString(payload, "runId");
    const run = await sql.query(
      "SELECT connection_id, provider FROM billing.billing_import_runs WHERE id = $1::uuid",
      [runId]
    );
    const row = run.rows[0];
    if (!row) {
      throw new AthenaBillingCapabilityError({
        operation,
        reason: "unsupported_operation",
      });
    }
    return runReconciliation({
      configuredProviders: input.options.configuredProviders,
      connectionId: String(row.connection_id),
      customerImport: input.options.customerImport,
      observability: input.options.observability,
      provider: String(row.provider ?? "mollie"),
      sql,
      testMode: input.options.testMode,
    });
  }
  if (operation === "admin.webhooks.reconcile") {
    await runAutomaticBillingWebhookReconcileIfEnabled({
      applicationId,
      appUrl: input.options.appUrl,
      configuredProviders: input.options.configuredProviders,
      observability: normalizeAthenaBillingObservability(
        input.options.observability
      ),
      registry: input.options.registry,
      sql,
      testMode: input.options.testMode,
      trigger: "manual",
      webhooks: ingestion.webhooks,
    });
    const connectionId = await resolveConnectionId(
      sql,
      payload as BillingAdminWebhookReconcileInput,
      "mollie"
    );
    return webhookStatus({
      applicationId,
      appUrl: input.options.appUrl,
      configuredProviders: input.options.configuredProviders,
      connectionId,
      ingestion,
      sql,
      testMode: input.options.testMode,
    });
  }
  if (
    operation === "admin.webhooks.status" ||
    operation === "admin.webhooks.verify"
  ) {
    const connectionId = await resolveConnectionId(
      sql,
      payload as BillingAdminConnectionInput,
      "mollie"
    );
    if (operation === "admin.webhooks.verify") {
      const store = createPostgresBillingWebhookRegistrationStore(sql);
      const listed = await store.list(connectionId);
      for (const row of listed) {
        await store.upsert({
          ...row,
          lastVerifiedAt: new Date(),
        });
      }
    }
    return webhookStatus({
      applicationId,
      appUrl: input.options.appUrl,
      configuredProviders: input.options.configuredProviders,
      connectionId,
      ingestion,
      sql,
      testMode: input.options.testMode,
    });
  }
  if (operation === "admin.ingestion.health") {
    const connectionId =
      typeof payload.connectionId === "string"
        ? payload.connectionId
        : (await listActiveBillingImportConnections(sql, "mollie"))[0]?.id;
    const warnings: string[] = [];
    if (!connectionId) {
      return {
        classic: "unsupported",
        conflicts: 0,
        connectionStatus: "missing",
        drift: false,
        enabled: false,
        healthy: false,
        nextGen: "unsupported",
        provider: "mollie",
        reconciliation: "unknown",
        warnings: ["No billing provider connection"],
        webhookIngestion: "unsupported",
      } satisfies BillingAdminIngestionHealth;
    }
    const connection = await resolveBillingImportConnection(sql, {
      connectionId,
    });
    const status = await webhookStatus({
      applicationId,
      appUrl: input.options.appUrl,
      configuredProviders: input.options.configuredProviders,
      connectionId,
      ingestion,
      sql,
      testMode: input.options.testMode,
    });
    const conflicts = await conflictCount(sql, connectionId);
    const lastRun = await latestImportRun(sql, connectionId);
    if (status.drift) {
      warnings.push("Webhook config drift");
    }
    if (
      status.channels.classic.registration.health === "unhealthy" ||
      status.channels.nextGen.registration.health === "unhealthy"
    ) {
      warnings.push("Webhook registration is not operationally healthy");
    }
    if (conflicts > 0) {
      warnings.push(`${conflicts} unresolved identity conflicts`);
    }
    if (lastRun?.status === "checkpointed") {
      warnings.push("Reconciliation behind");
    }
    const webhookIngestion =
      status.classic === "error" || status.nextGen === "error"
        ? "error"
        : status.drift
          ? "degraded"
          : status.classic;
    const recent =
      await createPostgresBillingWebhookIngressObservability(
        sql
      ).aggregateRecent(connectionId);
    const healthy =
      warnings.length === 0 &&
      recent.rejected === 0 &&
      recent.reconciliationFailures === 0;
    return {
      classic: status.classic,
      conflicts,
      connectionId,
      connectionStatus: connection.status,
      drift: status.drift,
      enabled: ingestion.webhooks.enabled,
      healthy,
      ...(status.rows.find((row) => row.key === "endpoint") ? {} : {}),
      lastReconcileAt: lastRun?.completedAt ?? undefined,
      nextGen: status.nextGen,
      provider: connection.provider,
      recent: { ...recent, window: "24h" },
      reconciliation:
        lastRun?.status === "checkpointed"
          ? "behind"
          : lastRun
            ? "caught_up"
            : "unknown",
      routes: {
        classic: {
          expected: BILLING_MOLLIE_CLASSIC_WEBHOOK_PATH,
          mounted: status.channels.classic.route.mounted,
        },
        nextGen: {
          expected: BILLING_MOLLIE_EVENTS_WEBHOOK_PATH,
          mounted: status.channels.nextGen.route.mounted,
        },
      },
      warnings,
      webhookIngestion,
    } satisfies BillingAdminIngestionHealth;
  }
  if (operation === "admin.conflicts.list") {
    const connectionId =
      typeof payload.connectionId === "string"
        ? payload.connectionId
        : undefined;
    const result = connectionId
      ? await sql.query(
          `SELECT id::text AS id, subject_kind, subject_id, connection_id::text AS connection_id,
				        candidate_provider_customer_id, reason, confidence, status,
				        last_observed_at, observation_count
				 FROM billing.billing_binding_conflicts
				 WHERE connection_id = $1::uuid AND status = 'open'
				 ORDER BY last_observed_at DESC, created_at DESC
				 LIMIT 100`,
          [connectionId]
        )
      : await sql.query(
          `SELECT id::text AS id, subject_kind, subject_id, connection_id::text AS connection_id,
				        candidate_provider_customer_id, reason, confidence, status,
				        last_observed_at, observation_count
				 FROM billing.billing_binding_conflicts
				 WHERE status = 'open'
				 ORDER BY last_observed_at DESC, created_at DESC
				 LIMIT 100`
        );
    return {
      items: result.rows.map((row) => ({
        candidateProviderCustomerId: String(
          row.candidate_provider_customer_id ?? ""
        ),
        confidence: String(row.confidence ?? "none"),
        connectionId: String(row.connection_id ?? ""),
        id: String(row.id ?? ""),
        lastObservedAt:
          row.last_observed_at instanceof Date
            ? row.last_observed_at.toISOString()
            : typeof row.last_observed_at === "string"
              ? row.last_observed_at
              : undefined,
        observationCount:
          typeof row.observation_count === "number"
            ? row.observation_count
            : Number(row.observation_count ?? 1),
        reason: String(row.reason ?? "manual_review_required"),
        status: String(row.status ?? "open"),
        subjectId:
          typeof row.subject_id === "string" ? row.subject_id : undefined,
        subjectKind:
          row.subject_kind === "organization" ? "organization" : "user",
      })),
    };
  }
  if (operation === "admin.conflicts.resolve") {
    const action = payload.action;
    if (action !== "bind" && action !== "keep" && action !== "reassign") {
      throw new Error("ATHENA_BILLING_FIELD_REQUIRED:action");
    }
    const subjectRaw = payload.subject;
    const subject =
      subjectRaw != null &&
      typeof subjectRaw === "object" &&
      !Array.isArray(subjectRaw)
        ? {
            id: requireString(subjectRaw as Record<string, unknown>, "id"),
            kind:
              (subjectRaw as Record<string, unknown>).kind === "organization"
                ? ("organization" as const)
                : ("user" as const),
          }
        : undefined;
    return resolveConflict({
      payload: {
        action,
        confirmReassign: payload.confirmReassign === true,
        connectionId: requireString(payload, "connectionId"),
        providerCustomerId: requireString(payload, "providerCustomerId"),
        ...(subject ? { subject } : {}),
      },
      principal: input.principal,
      sql,
    });
  }
  throw new AthenaBillingCapabilityError({
    operation,
    reason: "unsupported_operation",
  });
}

export function createBillingAdminPort(input: {
  authority: BillingInvocationAuthority;
  options: BillingAdminRuntimeOptions;
  principal: AthenaPrincipal;
}): BillingAdminPort {
  const bind = (key: keyof typeof ADMIN_OP) => (payload: unknown) =>
    executeAdminBillingOperation({
      authority: input.authority,
      operation: ADMIN_OP[key],
      options: input.options,
      payload,
      principal: input.principal,
    });
  return {
    bootstrap: {
      retry: bind("bootstrapRetry") as BillingAdminPort["bootstrap"]["retry"],
    },
    conflicts: {
      list: bind("conflictsList") as BillingAdminPort["conflicts"]["list"],
      resolve: bind(
        "conflictsResolve"
      ) as BillingAdminPort["conflicts"]["resolve"],
    },
    connections: {
      materialize: bind(
        "connectionsMaterialize"
      ) as BillingAdminPort["connections"]["materialize"],
    },
    ingestion: {
      health: bind(
        "ingestionHealth"
      ) as BillingAdminPort["ingestion"]["health"],
    },
    reconciliation: {
      retry: bind(
        "reconciliationRetry"
      ) as BillingAdminPort["reconciliation"]["retry"],
      run: bind(
        "reconciliationRun"
      ) as BillingAdminPort["reconciliation"]["run"],
    },
    webhooks: {
      reconcile: bind(
        "webhooksReconcile"
      ) as BillingAdminPort["webhooks"]["reconcile"],
      status: bind("webhooksStatus") as BillingAdminPort["webhooks"]["status"],
      verify: bind("webhooksVerify") as BillingAdminPort["webhooks"]["verify"],
    },
  };
}
