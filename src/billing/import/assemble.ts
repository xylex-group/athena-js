import type { AthenaPostgresPool } from "../../postgres/driver.ts";
import type { AthenaBillingConfig } from "../create-client-config.ts";
import {
  ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH,
  AthenaBillingCredentialError,
} from "../errors.ts";
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
  reconcileBillingCustomer,
  reconcileBillingCustomers,
} from "../reconciliation/index.ts";
import { createPostgresBillingReconciliationLeaseStore } from "../reconciliation/lease.ts";
import { resolveBillingReconciliationLimits } from "../reconciliation/policy.ts";
import type { BillingReconciliationLimits } from "../reconciliation/types.ts";
import { resolveBillingEnvironment } from "../runtime/environment.ts";
import {
  billingConnectionHasConfiguredCredential,
  billingConnectionMatchesProcessTestMode,
  createConnectionProviderExecutionContext,
  firstConfiguredMollieProvider,
  mollieConfigForCredentialReference,
  parseBillingCredentialReference,
} from "../runtime/local/providers/connection-binding.ts";
import { normalizeMollieRuntimeConfig } from "../runtime/local/providers/mollie/config.ts";
import { MollieSdkClientPool } from "../runtime/local/providers/mollie/sdk/client-factory.ts";
import type { BillingSqlExecutor } from "../subject/repository.ts";
import { createPostgresBillingImportAuditStore } from "./audit.ts";
import { shouldAutomaticallyImportBillingCustomers } from "./automatic.ts";
import type { BillingImportDatabase } from "./database.ts";
import { runBillingCustomerImportPage } from "./importer.ts";
import {
  createPostgresBillingImportBindingStore,
  createPostgresBillingImportCursorStore,
  createPostgresBillingImportDocumentStore,
  createPostgresBillingSubjectDirectory,
  listActiveBillingImportConnections,
  resolveBillingImportConnection,
} from "./postgres.ts";
import { createMollieBillingCustomerImportPort } from "./providers/mollie.ts";
import {
  type BillingImportPolicy,
  type BillingImportRunReport,
  DEFAULT_BILLING_IMPORT_POLICY,
} from "./types.ts";

export function importPolicyFromBillingConfig(
  billing?: AthenaBillingConfig
): BillingImportPolicy {
  return {
    allowSecondaryBindings:
      DEFAULT_BILLING_IMPORT_POLICY.allowSecondaryBindings,
    allowUniqueEmailAutoBind:
      billing?.import?.customers?.allowUniqueEmailAutoBind === true,
  };
}

function isDefaultMollieCredentialReference(reference: string): boolean {
  try {
    const parsed = parseBillingCredentialReference(reference);
    return parsed.provider === "mollie" && parsed.accountId == null;
  } catch {
    return false;
  }
}

function mollieConfigFromProviders(
  configured?: BillingProviderConfigMap
): import("../providers/types.ts").MollieBillingProviderConfig | undefined {
  return firstConfiguredMollieProvider(configured);
}

function toImportReport(
  result: Awaited<ReturnType<typeof reconcileBillingCustomers>>
): BillingImportRunReport {
  return {
    bindingsActivated: result.bindingsActivated,
    bindingsCreated: result.bindingsCreated,
    conflicts: result.conflicts,
    connectionId: result.connectionId,
    correlationId: result.correlationId,
    cursorAfter: result.cursorAfter,
    cursorBefore: result.cursorBefore,
    customersScanned: result.customersScanned,
    dryRun: result.dryRun,
    environment: result.environment,
    errors: result.errors,
    hasMore: result.hasMore,
    pagesProcessed: result.pagesProcessed,
    plans: result.plans,
    provider: result.provider,
    runId: result.runId,
    skipped: result.skipped,
    status: result.status,
    traceId: result.traceId,
  };
}

export async function runBillingCustomerImportWithPostgres(input: {
  configuredProviders?: BillingProviderConfigMap;
  connectionId?: string;
  cursor?: string;
  customerId?: string;
  database?: BillingImportDatabase;
  dryRun: boolean;
  includeAmbiguous?: boolean;
  limit?: number;
  limits?: Partial<BillingReconciliationLimits>;
  policy?: BillingImportPolicy;
  pool?: AthenaPostgresPool;
  provider?: string;
  sql: BillingSqlExecutor;
  subjectId?: string;
  testMode?: boolean;
  trigger?: "bootstrap" | "manual" | "scheduled" | "webhook";
  observability?: NormalizedAthenaBillingObservability;
  reconciliationContext?: import("../observability/types.ts").BillingReconciliationContext;
}): Promise<BillingImportRunReport> {
  const connection = await resolveBillingImportConnection(input.sql, {
    connectionId: input.connectionId,
    provider: input.provider,
  });
  if (input.testMode !== undefined && input.testMode !== connection.testMode) {
    throw new AthenaBillingCredentialError({
      code: ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH,
      environment: connection.environment,
      message:
        "billing.testMode does not match billing_provider_connections.environment.",
      provider: connection.provider,
    });
  }
  const providerName = (input.provider ?? connection.provider)
    .trim()
    .toLowerCase();
  if (providerName !== "mollie") {
    throw new Error(
      `Billing customer import supports Mollie in this slice (got "${providerName}").`
    );
  }
  const mollie =
    mollieConfigForCredentialReference(
      input.configuredProviders,
      connection.credentialReference
    ) ??
    (isDefaultMollieCredentialReference(connection.credentialReference)
      ? mollieConfigFromProviders(input.configuredProviders)
      : undefined);
  if (mollie == null) {
    throw new Error(
      `Mollie is not configured for credential_reference "${connection.credentialReference}". Set billing.providers.mollie or billing.providers.mollieAccounts.`
    );
  }
  const normalized = normalizeMollieRuntimeConfig(mollie);
  const pool = new MollieSdkClientPool(normalized);
  const execution = createConnectionProviderExecutionContext({
    configuredProviders: {
      ...input.configuredProviders,
      mollie,
    },
    connection,
    operationScope: "organization",
  });
  const discovery = createMollieBillingCustomerImportPort({
    connection,
    context: execution,
    pool,
  });
  const policy = input.policy ?? DEFAULT_BILLING_IMPORT_POLICY;
  const observability =
    input.observability ?? normalizeAthenaBillingObservability();
  const traces = observability.traces.enabled
    ? createPostgresBillingTraceRecorder(
        input.sql,
        observability.traces.sampleRate
      )
    : createDisabledBillingTraceRecorder();
  const semanticAudit =
    input.dryRun || observability.auditLog === false
      ? undefined
      : createPostgresBillingAuditWriter(input.sql);
  const context =
    input.reconciliationContext ??
    (input.trigger === "scheduled"
      ? mintScheduledBillingReconciliationContext({
          connectionId: connection.id,
          provider: connection.provider,
          schedulerExecutionId: crypto.randomUUID(),
        })
      : mintManualBillingReconciliationContext({
          connectionId: connection.id,
          provider: connection.provider,
          trigger: input.trigger === "bootstrap" ? "bootstrap" : "manual",
        }));
  const limits = resolveBillingReconciliationLimits({
    maxCustomers: input.limits?.maxCustomers,
    maxDurationMs: input.limits?.maxDurationMs,
    maxPages: input.limits?.maxPages,
    pageSize: input.limit ?? input.limits?.pageSize,
  });
  const result =
    input.customerId === null
      ? await reconcileBillingCustomers({
          audit: input.dryRun
            ? undefined
            : createPostgresBillingImportAuditStore(input.sql),
          connection,
          context,
          cursors: createPostgresBillingImportCursorStore(input.sql),
          dryRun: input.dryRun,
          lease: input.dryRun
            ? undefined
            : createPostgresBillingReconciliationLeaseStore(input.sql),
          limits,
          rootSql: input.sql,
          runPage: ({ cursor, limit, sql }) =>
            runBillingCustomerImportPage({
              audit: input.dryRun
                ? undefined
                : createPostgresBillingImportAuditStore(sql),
              bindings: createPostgresBillingImportBindingStore(sql),
              connectionId: connection.id,
              context,
              cursor: cursor ?? undefined,
              cursors: createPostgresBillingImportCursorStore(sql),
              directory: createPostgresBillingSubjectDirectory(sql),
              discovery,
              documents: createPostgresBillingImportDocumentStore(sql),
              dryRun: input.dryRun,
              includeAmbiguous: input.includeAmbiguous,
              limit,
              policy,
              provider: connection.provider,
              semanticAudit:
                semanticAudit === null
                  ? undefined
                  : createPostgresBillingAuditWriter(sql),
              subjectId: input.subjectId,
            }),
          semanticAudit,
          traces,
        })
      : await reconcileBillingCustomer({
          connection,
          context,
          dryRun: input.dryRun,
          lease: input.dryRun
            ? undefined
            : createPostgresBillingReconciliationLeaseStore(input.sql),
          rootSql: input.sql,
          runTargetedPage: (sql) =>
            runBillingCustomerImportPage({
              audit: input.dryRun
                ? undefined
                : createPostgresBillingImportAuditStore(sql),
              bindings: createPostgresBillingImportBindingStore(sql),
              connectionId: connection.id,
              context,
              cursors: createPostgresBillingImportCursorStore(sql),
              customerId: input.customerId,
              directory: createPostgresBillingSubjectDirectory(sql),
              discovery,
              documents: createPostgresBillingImportDocumentStore(sql),
              dryRun: input.dryRun,
              includeAmbiguous: input.includeAmbiguous,
              limit: limits.pageSize,
              policy,
              provider: connection.provider,
              semanticAudit:
                semanticAudit === null
                  ? undefined
                  : createPostgresBillingAuditWriter(sql),
              skipCursorAdvance: true,
              subjectId: input.subjectId,
            }),
          semanticAudit,
          traces,
        });
  return toImportReport(result);
}

const warnedSkippedImportConnections = new Set<string>();

export async function runAutomaticBillingCustomerImportIfEnabled(input: {
  configuredProviders?: BillingProviderConfigMap;
  customerImport?: AthenaBillingConfig["import"];
  database?: BillingImportDatabase;
  observability?: NormalizedAthenaBillingObservability;
  pool?: AthenaPostgresPool;
  sql: BillingSqlExecutor;
  testMode?: boolean;
  trigger?: "bootstrap" | "scheduled";
}): Promise<readonly BillingImportRunReport[]> {
  if (
    !shouldAutomaticallyImportBillingCustomers(input.customerImport?.customers)
  ) {
    return [];
  }
  const connections = await listActiveBillingImportConnections(
    input.sql,
    "mollie"
  );
  const reports: BillingImportRunReport[] = [];
  const policy = importPolicyFromBillingConfig({
    import: input.customerImport,
  });
  const limits = input.customerImport?.customers?.limits;
  for (const connection of connections) {
    if (
      !billingConnectionMatchesProcessTestMode(
        connection.testMode,
        input.testMode
      )
    ) {
      const skipKey = `env:${connection.id}`;
      if (!warnedSkippedImportConnections.has(skipKey)) {
        warnedSkippedImportConnections.add(skipKey);
        console.warn(
          "[athena-billing] skipping customer import; connection environment does not match process billing.testMode",
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
      if (!warnedSkippedImportConnections.has(skipKey)) {
        warnedSkippedImportConnections.add(skipKey);
        console.warn(
          "[athena-billing] skipping customer import; connection environment has no configured credential",
          {
            connectionId: connection.id,
            environment: connection.environment,
          }
        );
      }
      continue;
    }
    reports.push(
      await runBillingCustomerImportWithPostgres({
        configuredProviders: input.configuredProviders,
        connectionId: connection.id,
        database: input.database,
        dryRun: false,
        limits,
        observability: input.observability,
        policy,
        pool: input.pool,
        provider: "mollie",
        sql: input.sql,
        testMode: connection.testMode,
        trigger: input.trigger ?? "bootstrap",
      })
    );
  }
  return reports;
}
