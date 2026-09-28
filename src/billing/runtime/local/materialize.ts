import { athenaAuthConfig } from "../../../auth/config.ts";
import { assertLocalAuthHooks } from "../../../auth/hooks/assert-local.ts";
import { assertLocalAuthObservability } from "../../../auth/observability/config.ts";
import {
  type AthenaClient,
  type AthenaClientConfig,
  createClientWithNormalizer,
  normalizeUniversalCreateClientConfig,
} from "../../../client/create-client.ts";
import { AthenaConfigurationError } from "../../../config/errors.ts";
import {
  AthenaBillingCapabilityError,
  AthenaBillingProviderError,
} from "../../errors.ts";
import {
  getAthenaClientInternals,
  type AthenaClientOwnedRuntime,
} from "../../../runtime/client-internals.ts";
import { assertDataLifecycleConfig } from "../../../runtime/data/lifecycle/assert.ts";
import { materializeDatabase } from "../../../runtime/materializers/database.ts";
import { resolveAthenaConstruction } from "../../../runtime/construction/resolve.ts";
import { createAthenaRuntimeReadiness } from "../../../runtime/readiness/index.ts";
import { normalizeUniversalConfig } from "../../../runtime/plan/normalize.ts";
import { resolveRuntimePlan } from "../../../runtime/plan/resolve.ts";
import { resolveDatabaseUri } from "../../../runtime/resolve.ts";
import type { AthenaBillingConfig } from "../../create-client-config.ts";
import { shouldAutomaticallyImportBillingCustomers } from "../../import/automatic.ts";
import { resolveBillingWebhookApplicationId } from "../../ingestion/application-id.ts";
import {
  assertAthenaBillingIngestion,
  signingSecretsFromWebhookConfig,
} from "../../ingestion/config.ts";
import {
  type BillingConnectionSigningSecretCache,
  createPostgresBillingWebhookSecretStore,
  rememberConnectionSigningSecret,
  rememberConnectionSigningSecretSet,
  resolveBillingWebhookMasterKey,
  signingSecretsForConnection,
} from "../../ingestion/secrets/index.ts";
import type { AthenaBillingModule } from "../../module.ts";
import type { AthenaBillingRuntimeDispatch } from "../dispatch.ts";
import type { BillingAdminBootstrapRetryResult } from "../admin/types.ts";
import { createBillingRuntimeFacade } from "../facade.ts";
import {
  assertLocalBillingObservability,
  normalizeAthenaBillingObservability,
} from "../../observability/config.ts";
import { purgeBillingObservability } from "../../observability/retention.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import {
  DEFAULT_BILLING_PLAN_CHANGE_RECOVERY_SCHEDULE,
  DEFAULT_BILLING_WEBHOOK_RECONCILIATION_SCHEDULE,
  registerEmbeddedBillingScheduler,
} from "../../reconciliation/scheduler.ts";
import { isBillingSelfPlanChangeEnabled } from "../../self-enrollment.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { AthenaBillingCatalogConfig } from "../../types.ts";
import { createPlanChangeRecoveryRuntime } from "../../workflows/plan-change/plan-change-recovery-runtime.ts";
import {
  type AthenaBillingInspectedConnection,
  patchBillingDiagnostics,
} from "../diagnostics.ts";
import { resolveBillingEnvironment } from "../environment.ts";
import type { BillingCredentialKind } from "../credentials.ts";
import { PROCESS_BILLING_INVOCATION } from "../invocation-authority.ts";
import {
  assertLocalBillingRuntimeEnvironment,
  type BillingRuntimeModePreference,
  resolveBillingRuntimeMode,
} from "../resolve-mode.ts";
import {
  getBoundPostgresRuntime,
  type AthenaPostgresRuntime,
} from "../../../postgres/owned-runtime.ts";
import {
  configuredBillingConnectionInitKey,
  configuredBillingConnectionConvergenceGeneration,
  type MaterializeConfiguredBillingConnectionsResult,
  type MaterializedBillingConnection,
  materializeConfiguredBillingConnections,
  retryConfiguredBillingConnectionMaterialize,
  singleFlightConfiguredBillingConnectionMaterialize,
} from "./connections/materialize.ts";
import { attachEventIngressRuntime } from "./ingress/attach.ts";
import {
  bindEmbeddedBillingRuntimeSurfaces,
  claimEmbeddedBillingRuntimeOwner,
  embeddedBillingRuntimeOwnerKey,
  fingerprintBillingDatabaseIdentity,
  retainEmbeddedBillingRuntimeScheduler,
  runEmbeddedBillingRuntimeRecoveryOnce,
  runExclusiveEmbeddedBillingRuntime,
} from "./process-ownership.ts";
import { assertBillingProviderRuntimeEnvironment } from "./providers/config.ts";
import { normalizeBillingProviderConfiguration } from "./providers/configuration/index.ts";
import { createBillingProviderRegistry } from "./providers/create-registry.ts";
import type { BillingProviderRegistry } from "./providers/registry.ts";
import { createLocalBillingRuntime } from "./runtime.ts";

export const BILLING_BOOTSTRAP_EVENT = {
  connectionMaterialized: "connection-materialized",
  importSchedulerRegistered: "import-scheduler-registered",
  planChangeRecoverySchedulerRegistered:
    "plan-change-recovery-scheduler-registered",
  postgresReady: "postgres-ready",
  providerRegistryReady: "provider-registry-ready",
  runtimeReady: "runtime-ready",
  webhookSchedulerRegistered: "webhook-scheduler-registered",
} as const;

function recordBillingBootstrapEvent(
  events: string[] | undefined,
  event: string
): void {
  events?.push(event);
}

function hasPlanChangeProvider(registry: BillingProviderRegistry): boolean {
  return registry
    .list()
    .some((runtime) => runtime.prices != null && runtime.subscriptions != null);
}

function billingSqlFromInternals(client: {
  billing: AthenaBillingModule;
}): BillingSqlExecutor | undefined {
  const internals = getAthenaClientInternals(client);
  const owned = internals?.postgresRuntime;
  if (!owned) {
    return;
  }
  return billingSqlFromPostgresRuntime(owned);
}

export function billingSqlFromPostgresRuntime(
  owned: AthenaClientOwnedRuntime | AthenaPostgresRuntime
): BillingSqlExecutor {
  return {
    async query(sql, params) {
      const result = await owned.query(
        sql,
        params != null && params.length > 0 ? [...params] : undefined
      );
      return { rows: result.rows as Record<string, unknown>[] };
    },
    async transaction<T>(fn: (transaction: BillingSqlExecutor) => Promise<T>) {
      return owned.transaction(async (transactionRuntime) =>
        fn({
          async query(sql, params) {
            const result = await transactionRuntime.query(
              sql,
              params != null && params.length > 0 ? [...params] : undefined
            );
            return { rows: result.rows as Record<string, unknown>[] };
          },
        })
      );
    },
  };
}

export interface MaterializedLocalBillingRuntime {
  bootstrapReadiness: {
    fail(error: unknown): void;
    reset(): void;
    succeed(): void;
    wait(): Promise<void>;
  };
  connectionState: {
    bootstrap: BillingBootstrapState;
    bootstrapRetry?: () => Promise<BillingAdminBootstrapRetryResult>;
    connections: MaterializedBillingConnection[];
    initializationFailed?: boolean;
    initializationMessage?: string;
    initialized: boolean;
    recoveryCoordinatorEnabled: boolean;
  };
  ingestion: ReturnType<typeof assertAthenaBillingIngestion>;
  observability: ReturnType<typeof normalizeAthenaBillingObservability>;
  readiness: ReturnType<typeof createAthenaRuntimeReadiness>;
  registry: BillingProviderRegistry;
  runtime: AthenaBillingRuntimeDispatch;
  sql?: BillingSqlExecutor;
  testMode: boolean;
  webhookApplicationId?: string;
}

export type BillingBootstrapPhase =
  | "uninitialized"
  | "provider-registry-ready"
  | "persistence-ready"
  | "materializing-connections"
  | "verifying-connections"
  | "reconciling-ingress"
  | "registering-schedulers"
  | "ready"
  | "failed"
  | "recovering";

export interface BillingBootstrapFailure {
  code: string;
  retryable: boolean;
  sanitizedMessage: string;
  stage: BillingBootstrapPhase;
}

export interface BillingBootstrapState {
  failedAt?: Date;
  generation: number;
  lastError?: BillingBootstrapFailure;
  lastSuccessAt?: Date;
  phase: BillingBootstrapPhase;
  recoveredAt?: Date;
}

function createRetryableBootstrapReadiness(): {
  bootstrapReadiness: MaterializedLocalBillingRuntime["bootstrapReadiness"];
} {
  let resolveCurrent: () => void = () => {};
  let rejectCurrent: (error: unknown) => void = () => {};
  let current = Promise.resolve();
  let settled = true;
  const reset = (): void => {
    current = new Promise<void>((resolve, reject) => {
      resolveCurrent = resolve;
      rejectCurrent = reject;
    });
    current.catch(() => undefined);
    settled = false;
  };
  reset();
  return {
    bootstrapReadiness: {
      fail(error) {
        if (!settled) {
          settled = true;
          rejectCurrent(error);
        }
      },
      reset,
      succeed() {
        if (!settled) {
          settled = true;
          resolveCurrent();
        }
      },
      wait() {
        return current;
      },
    },
  };
}

export function createLocalBillingRuntimeBinding(input: {
  appUrl?: string | null;
  applicationId?: string;
  catalog?: AthenaBillingCatalogConfig;
  configuredProviders?: BillingProviderConfigMap;
  customerImport?: AthenaBillingConfig["import"];
  ingestion?: AthenaBillingConfig["ingestion"];
  mode?: BillingRuntimeModePreference;
  observability?: AthenaBillingConfig["observability"];
  registry?: BillingProviderRegistry;
  selfEnrollment?: AthenaBillingConfig["selfEnrollment"];
  sql?: BillingSqlExecutor;
  testMode?: boolean;
  readiness?: ReturnType<typeof createAthenaRuntimeReadiness>;
}): MaterializedLocalBillingRuntime {
  const billingMode = resolveBillingRuntimeMode({
    configuredProviders: input.configuredProviders,
    mode: input.mode,
  });
  if (billingMode !== "local") {
    throw new AthenaBillingProviderError({
      code: "ATHENA_BILLING_CONFIG_CONFLICT",
      message: "Local Billing materialization requires local runtime intent.",
    });
  }
  const testMode = resolveBillingEnvironment({
    testMode: input.testMode,
  }).testMode;
  const mollieKind = normalizeBillingProviderConfiguration({
    configuredProviders: input.configuredProviders,
    environment: testMode ? "test" : "live",
  }).providers.get("mollie")?.defaultSlot?.credentialKind as
    | BillingCredentialKind
    | undefined;
  const ingestion = assertAthenaBillingIngestion({
    appUrl: input.appUrl,
    credentialKind: mollieKind,
    ingestion: input.ingestion,
    live: testMode === false,
  });
  const observability = normalizeAthenaBillingObservability(
    input.observability
  );
  const registry =
    input.registry ??
    createBillingProviderRegistry(input.configuredProviders, input.catalog);
  const webhookApplicationId = input.applicationId?.trim();
  if (
    ingestion.webhooks.enabled &&
    (webhookApplicationId == null || webhookApplicationId.length === 0)
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_BILLING_APPLICATION_ID_REQUIRED",
      "createClient({ app: { id } }) or client is required when billing webhook management is enabled. app.name is not a webhook ownership id.",
      "billing"
    );
  }
  const bootstrapReadiness = createRetryableBootstrapReadiness();
  const connectionState: MaterializedLocalBillingRuntime["connectionState"] = {
    bootstrap: {
      generation: 0,
      phase: "uninitialized",
    },
    connections: [],
    initialized: false,
    recoveryCoordinatorEnabled: false,
  };
  const readiness = input.readiness ?? createAthenaRuntimeReadiness();
  const runtime = createLocalBillingRuntime({
    applicationId: webhookApplicationId,
    appUrl: input.appUrl,
    configuredProviders: input.configuredProviders,
    connectionState,
    customerImport: input.customerImport,
    ingestion: input.ingestion,
    invocation: PROCESS_BILLING_INVOCATION,
    observability,
    waitForOperational: bootstrapReadiness.bootstrapReadiness.wait,
    registry,
    selfEnrollmentEnabled: input.selfEnrollment,
    sql: input.sql,
    testMode,
  });
  return {
    bootstrapReadiness: bootstrapReadiness.bootstrapReadiness,
    connectionState,
    ingestion,
    observability,
    readiness,
    registry,
    runtime,
    ...(input.sql ? { sql: input.sql } : {}),
    testMode,
    ...(webhookApplicationId ? { webhookApplicationId } : {}),
  };
}

export function bootstrapLocalBillingRuntime(
  client: { billing: AthenaBillingModule },
  input: {
    appUrl?: string | null;
    applicationId?: string;
    catalog?: AthenaBillingCatalogConfig;
    configuredProviders?: BillingProviderConfigMap;
    customerImport?: AthenaBillingConfig["import"];
    ingestion?: AthenaBillingConfig["ingestion"];
    mode?: BillingRuntimeModePreference;
    observability?: AthenaBillingConfig["observability"];
    registry?: BillingProviderRegistry;
    selfEnrollment?: AthenaBillingConfig["selfEnrollment"];
    testMode?: boolean;
    binding?: MaterializedLocalBillingRuntime;
  }
): void {
  const existing = getAthenaClientInternals(client);
  const binding =
    input.binding ??
    createLocalBillingRuntimeBinding({
      ...input,
      registry:
        input.registry ??
        existing?.billingProviderRegistry ??
        createBillingProviderRegistry(input.configuredProviders, input.catalog),
      sql: billingSqlFromInternals(client),
      readiness: existing?.runtimeReadiness,
    });
  const {
    bootstrapReadiness,
    connectionState,
    ingestion,
    observability,
    readiness: bindingReadiness,
    registry,
    runtime: localRuntime,
    sql: bindingSql,
    testMode,
    webhookApplicationId,
  } = binding;
  const bootstrapEvents: string[] = [];
  recordBillingBootstrapEvent(
    bootstrapEvents,
    BILLING_BOOTSTRAP_EVENT.providerRegistryReady
  );
  connectionState.bootstrap = {
    generation: 0,
    phase: "provider-registry-ready",
  };
  if (existing) {
    patchBillingDiagnostics(existing, {
      connectionCount: 0,
      phase: "provider-registry",
      startedAt: Date.now(),
    });
  }
  const sql = bindingSql ?? billingSqlFromInternals(client);
  const databaseIdentity = fingerprintBillingDatabaseIdentity(
    existing ? resolveDatabaseUri(existing.config) : undefined
  );
  const ownerKey = embeddedBillingRuntimeOwnerKey({
    applicationId: webhookApplicationId,
    databaseIdentity,
  });
  const ownership = claimEmbeddedBillingRuntimeOwner(ownerKey);
  if (existing) {
    existing.billingRuntimeGeneration = ownership.generation;
    existing.billingRuntimeOwnerKey = ownerKey;
    existing.billingSchedulerHandles = [];
  }
  if (sql != null) {
    recordBillingBootstrapEvent(
      bootstrapEvents,
      BILLING_BOOTSTRAP_EVENT.postgresReady
    );
  }
  const webhookMasterKey = resolveBillingWebhookMasterKey({
    configured: ingestion.webhooks.secretMasterKey,
    databaseUrl: existing ? resolveDatabaseUri(existing.config) : undefined,
  });
  const secretStore =
    sql != null && webhookMasterKey != null
      ? createPostgresBillingWebhookSecretStore({
          masterKey: webhookMasterKey,
          sql,
        })
      : undefined;
  const readiness =
    existing?.runtimeReadiness ?? bindingReadiness ?? createAthenaRuntimeReadiness();
  if (existing) {
    existing.billingBootstrapEvents = bootstrapEvents;
    existing.runtimeReadiness = readiness;
  }
  const billing = client.billing;
  void billing;
  const signingSecretCache: BillingConnectionSigningSecretCache = new Map();
  const configuredSecrets = signingSecretsFromWebhookConfig(ingestion.webhooks);
  const rememberSigningSecret = (entry: {
    connectionId: string;
    secret: string;
  }): void => {
    rememberConnectionSigningSecret(
      signingSecretCache,
      entry.connectionId,
      entry.secret
    );
  };
  const resolveSigningSecrets = (connectionId: string): readonly string[] =>
    signingSecretsForConnection(signingSecretCache, connectionId);
  if (existing) {
    existing.billingRuntime = localRuntime;
    existing.billingProviderRegistry = registry;
    patchBillingDiagnostics(existing, {
      phase: "attaching-ingress",
    });
    attachEventIngressRuntime(existing, {
      configuredProviders: input.configuredProviders,
      registry,
      resolveSigningSecrets,
      testMode,
    });
  }
  bindEmbeddedBillingRuntimeSurfaces(ownerKey, ownership.generation, {
    dispatch: localRuntime,
    ...(existing?.eventIngressRuntime === undefined
      ? {}
      : { eventIngress: existing.eventIngressRuntime }),
  });
  const retainScheduler = (
    handle: ReturnType<typeof registerEmbeddedBillingScheduler>,
    schedulerOwnership = ownership,
  ): void => {
    if (existing && handle) {
      existing.billingSchedulerHandles?.push(handle);
    }
    retainEmbeddedBillingRuntimeScheduler(
      ownerKey,
      schedulerOwnership.generation,
      handle
    );
  };
  const projectJoinedRecoveryResult = async (
    result: MaterializeConfiguredBillingConnectionsResult,
  ): Promise<void> => {
    if (
      connectionState.initialized &&
      connectionState.bootstrap.phase === "ready"
    ) {
      return;
    }
    bootstrapReadiness.reset();
    readiness.reset("billing");
    connectionState.connections = result.connections.map((connection) => ({
      accountReference: connection.accountReference,
      classicWebhookUrl: connection.classicWebhookUrl,
      credentialReference: connection.credentialReference,
      eventsWebhookUrl: connection.eventsWebhookUrl,
      id: connection.id,
      provider: connection.provider,
    }));
    const firstConnection = connectionState.connections[0];
    registry.ingress = {
      ...(firstConnection?.classicWebhookUrl
        ? { classicWebhookUrl: firstConnection.classicWebhookUrl }
        : {}),
      ...(connectionState.connections.length > 0
        ? {
            classicWebhookUrlsByConnectionId: Object.fromEntries(
              connectionState.connections.flatMap((connection) =>
                connection.classicWebhookUrl == null
                  ? []
                  : [[connection.id, connection.classicWebhookUrl] as const],
              ),
            ),
          }
        : {}),
    };
    if (existing) {
      existing.billingMaterializedConnections =
        connectionState.connections.map((connection) => ({
          accountReference: connection.accountReference,
          credentialReference: connection.credentialReference,
          id: connection.id,
          provider: connection.provider,
          ...(connection.classicWebhookUrl
            ? { classicWebhookUrl: connection.classicWebhookUrl }
            : {}),
          ...(connection.eventsWebhookUrl
            ? { eventsWebhookUrl: connection.eventsWebhookUrl }
            : {}),
        }));
    }
    for (const connection of connectionState.connections) {
      if (secretStore) {
        const stored = await secretStore.resolve(connection.id);
        rememberConnectionSigningSecretSet(
          signingSecretCache,
          connection.id,
          stored,
        );
      }
      if (connectionState.connections.length === 1) {
        rememberConnectionSigningSecretSet(
          signingSecretCache,
          connection.id,
          configuredSecrets,
        );
      }
    }
    connectionState.initialized = true;
    delete connectionState.initializationFailed;
    delete connectionState.initializationMessage;
    connectionState.bootstrap = {
      generation: connectionState.bootstrap.generation + 1,
      lastSuccessAt: new Date(),
      phase: "ready",
      recoveredAt: new Date(),
    };
    bootstrapReadiness.succeed();
    readiness.ready("billing");
  };
  const projectAdminRecoveryResult = async (
    result: BillingAdminBootstrapRetryResult,
  ): Promise<void> => {
    await projectJoinedRecoveryResult({
      connections: result.connections.map((connection) => ({
        accountReference: connection.accountReference,
        classicWebhookUrl: connection.classicWebhookUrl,
        credentialReference: connection.credentialReference,
        eventsWebhookUrl: connection.eventsWebhookUrl,
        id: connection.id,
        provider: connection.provider,
      })),
    });
  };
  let retryPromise: Promise<BillingAdminBootstrapRetryResult> | undefined;
  connectionState.bootstrapRetry = () => {
    if (retryPromise != null) {
      return retryPromise;
    }
    retryPromise = runEmbeddedBillingRuntimeRecoveryOnce(ownerKey, async () => {
      if (
        sql == null ||
        webhookApplicationId == null ||
        webhookApplicationId.length === 0
      ) {
        throw new AthenaBillingCapabilityError({
          operation: "admin.bootstrap.retry",
          reason: "runtime_unavailable",
        });
      }
      const key = configuredBillingConnectionInitKey({
        applicationId: webhookApplicationId,
        databaseIdentity,
        testMode,
      });
      const generation =
        configuredBillingConnectionConvergenceGeneration(key) + 1;
      const retryOwnership = claimEmbeddedBillingRuntimeOwner(ownerKey);
      if (existing) {
        existing.billingRuntimeGeneration = retryOwnership.generation;
        existing.billingSchedulerHandles = [];
      }
      bindEmbeddedBillingRuntimeSurfaces(
        ownerKey,
        retryOwnership.generation,
        {
          dispatch: localRuntime,
          ...(existing?.eventIngressRuntime === undefined
            ? {}
            : { eventIngress: existing.eventIngressRuntime }),
        },
      );
      connectionState.bootstrap = {
        generation,
        phase: "recovering",
      };
      bootstrapReadiness.reset();
      readiness.reset("billing");
      delete connectionState.initializationFailed;
      delete connectionState.initializationMessage;
      const materialized = await retryConfiguredBillingConnectionMaterialize(
        key,
        () =>
          runExclusiveEmbeddedBillingRuntime(
            ownerKey,
            retryOwnership.generation,
            () =>
              runBootstrapGeneration(
                retryOwnership,
                () =>
                  materializeConfiguredBillingConnections({
                    applicationId: webhookApplicationId,
                    appUrl: input.appUrl,
                    configuredProviders: input.configuredProviders,
                    publicBaseUrl: ingestion.webhooks.publicBaseUrl,
                    sql,
                    testMode,
                  }),
                true,
              ),
          ).then((result) => result ?? { connections: [] }),
        projectJoinedRecoveryResult,
      );
      return {
        connections: materialized.connections.map((connection) => ({
          accountReference: connection.accountReference,
          ...(connection.classicWebhookUrl
            ? { classicWebhookUrl: connection.classicWebhookUrl }
            : {}),
          credentialReference: connection.credentialReference,
          ...(connection.eventsWebhookUrl
            ? { eventsWebhookUrl: connection.eventsWebhookUrl }
            : {}),
          id: connection.id,
          provider: connection.provider,
        })),
        generation,
        phase: "ready" as const,
        recoveredAt: new Date().toISOString(),
      };
    }, projectAdminRecoveryResult)
      .catch((error) => {
        connectionState.initializationFailed = true;
        connectionState.initializationMessage =
          error instanceof Error ? error.message : String(error);
        connectionState.bootstrap = {
          failedAt: new Date(),
          generation: connectionState.bootstrap.generation,
          lastError: {
            code: "bootstrap_failed",
            retryable: true,
            sanitizedMessage:
              error instanceof Error ? error.message : String(error),
            stage: "recovering",
          },
          phase: "failed",
        };
        bootstrapReadiness.fail(error);
        throw error;
      })
      .finally(() => {
        retryPromise = undefined;
      });
    return retryPromise;
  };
  const runBootstrapGeneration = async (
    ownership: ReturnType<typeof claimEmbeddedBillingRuntimeOwner>,
    converge: () => Promise<MaterializeConfiguredBillingConnectionsResult>,
    rethrow: boolean,
  ): Promise<MaterializeConfiguredBillingConnectionsResult> => {
      if (!ownership.isCurrent()) {
        return { connections: [] };
      }
      let materialized: MaterializeConfiguredBillingConnectionsResult = {
        connections: [],
      };
      try {
        patchBillingDiagnostics(existing, {
          phase: "materializing-connections",
        });
        connectionState.bootstrap = {
          generation: configuredBillingConnectionConvergenceGeneration(
            configuredBillingConnectionInitKey({
              applicationId: webhookApplicationId ?? "",
              databaseIdentity,
              testMode,
            })
          ),
          phase: "materializing-connections",
        };
        if (
          sql != null &&
          webhookApplicationId != null &&
          webhookApplicationId.length > 0
        ) {
          materialized = await converge();
          connectionState.connections = [...materialized.connections];
          connectionState.bootstrap = {
            generation: configuredBillingConnectionConvergenceGeneration(
              configuredBillingConnectionInitKey({
                applicationId: webhookApplicationId,
                databaseIdentity,
                testMode,
              })
            ),
            phase: "verifying-connections",
          };
          const inspected: AthenaBillingInspectedConnection[] =
            connectionState.connections.map((row) => ({
              accountReference: row.accountReference,
              credentialReference: row.credentialReference,
              id: row.id,
              provider: row.provider,
              ...(row.classicWebhookUrl
                ? { classicWebhookUrl: row.classicWebhookUrl }
                : {}),
              ...(row.eventsWebhookUrl
                ? { eventsWebhookUrl: row.eventsWebhookUrl }
                : {}),
            }));
          const classicWebhookUrlsByConnectionId = Object.fromEntries(
            connectionState.connections
              .filter(
                (
                  row
                ): row is MaterializedBillingConnection & {
                  classicWebhookUrl: string;
                } => row.classicWebhookUrl != null
              )
              .map((row) => [row.id, row.classicWebhookUrl])
          );
          const firstConnection = connectionState.connections[0];
          registry.ingress = {
            ...(firstConnection?.classicWebhookUrl
              ? { classicWebhookUrl: firstConnection.classicWebhookUrl }
              : {}),
            ...(Object.keys(classicWebhookUrlsByConnectionId).length > 0
              ? { classicWebhookUrlsByConnectionId }
              : {}),
          };
          if (existing) {
            existing.billingMaterializedConnections = inspected;
            patchBillingDiagnostics(existing, {
              connectionCount: inspected.length,
            });
          }
          for (const connection of connectionState.connections) {
            if (secretStore) {
              try {
                const stored = await secretStore.resolve(connection.id);
                rememberConnectionSigningSecretSet(
                  signingSecretCache,
                  connection.id,
                  stored
                );
              } catch (error) {
                console.warn(
                  "[athena-billing] webhook signing secrets could not be loaded; apply embedded billing migrations through 0015",
                  {
                    connectionId: connection.id,
                    error:
                      error instanceof Error ? error.message : String(error),
                  }
                );
              }
            }
            if (connectionState.connections.length === 1) {
              rememberConnectionSigningSecretSet(
                signingSecretCache,
                connection.id,
                configuredSecrets
              );
            }
          }
        }
        recordBillingBootstrapEvent(
          bootstrapEvents,
          BILLING_BOOTSTRAP_EVENT.connectionMaterialized
        );
        connectionState.initialized = true;
        if (!ownership.isCurrent()) {
          return materialized;
        }
        const recoveryScheduler = registerEmbeddedBillingScheduler({
          enabled:
            sql != null &&
            isBillingSelfPlanChangeEnabled(input.selfEnrollment) &&
            connectionState.connections.length > 0 &&
            hasPlanChangeProvider(registry),
          isCurrent: ownership.isCurrent,
          run: async () => {
            await bootstrapReadiness.wait();
            const schedulerSql = billingSqlFromInternals(client);
            if (!schedulerSql) {
              return;
            }
            const recovery = createPlanChangeRecoveryRuntime({
              batchSize: 25,
              configuredProviders: input.configuredProviders,
              diagnostics: (event) => {
                console.info("[athena-billing] plan change recovery", event);
              },
              registry,
              sql: schedulerSql,
              testMode,
            });
            const result = await recovery.run();
            patchBillingDiagnostics(existing, {
              lastRecoveryBatch: {
                attentionRequired: result.attentionRequired,
                completed: result.completed,
                failed: result.failed,
                retried: result.retried,
                scanned: result.scanned,
              },
              ...(result.recoverableOperationBacklog === undefined
                ? {}
                : {
                    recoverableOperationBacklog:
                      result.recoverableOperationBacklog,
                  }),
            });
          },
          schedule: DEFAULT_BILLING_PLAN_CHANGE_RECOVERY_SCHEDULE,
        });
        retainScheduler(recoveryScheduler, ownership);
        connectionState.recoveryCoordinatorEnabled = recoveryScheduler != null;
        if (existing) {
          existing.billingPlanChangeRecoveryScheduler =
            recoveryScheduler ?? undefined;
          patchBillingDiagnostics(existing, {
            recoveryCoordinatorEnabled:
              connectionState.recoveryCoordinatorEnabled,
          });
        }
        if (recoveryScheduler) {
          recordBillingBootstrapEvent(
            bootstrapEvents,
            BILLING_BOOTSTRAP_EVENT.planChangeRecoverySchedulerRegistered
          );
        }
        recordBillingBootstrapEvent(
          bootstrapEvents,
          BILLING_BOOTSTRAP_EVENT.runtimeReady
        );
        patchBillingDiagnostics(existing, {
          phase: "registering-schedulers",
        });
        retainScheduler(
          registerEmbeddedBillingScheduler({
            enabled: ingestion.webhooks.enabled,
            execution: ingestion.webhooks.execution,
            isCurrent: ownership.isCurrent,
            run: async (trigger) => {
              await bootstrapReadiness.wait();
              const schedulerSql = billingSqlFromInternals(client);
              if (!schedulerSql || webhookApplicationId == null) {
                return;
              }
              const { runAutomaticBillingWebhookReconcileIfEnabled } =
                await import("../../ingestion/automatic.ts");
              await runAutomaticBillingWebhookReconcileIfEnabled({
                applicationId: webhookApplicationId,
                appUrl: input.appUrl,
                configuredProviders: input.configuredProviders,
                observability,
                registry,
                rememberSigningSecret,
                secretStore,
                sql: schedulerSql,
                testMode,
                trigger,
                webhooks: ingestion.webhooks,
              });
            },
            schedule: DEFAULT_BILLING_WEBHOOK_RECONCILIATION_SCHEDULE,
          }),
          ownership
        );
        recordBillingBootstrapEvent(
          bootstrapEvents,
          BILLING_BOOTSTRAP_EVENT.webhookSchedulerRegistered
        );
        retainScheduler(
          registerEmbeddedBillingScheduler({
            enabled: shouldAutomaticallyImportBillingCustomers({
              enabled: input.customerImport?.customers?.enabled === true,
              mode: input.customerImport?.customers?.mode,
            }),
            execution: input.customerImport?.customers?.execution,
            isCurrent: ownership.isCurrent,
            run: async (trigger) => {
              await bootstrapReadiness.wait();
              const schedulerSql = billingSqlFromInternals(client);
              if (!schedulerSql) {
                return;
              }
              const { runAutomaticBillingCustomerImportIfEnabled } =
                await import("../../import/assemble.ts");
              await runAutomaticBillingCustomerImportIfEnabled({
                configuredProviders: input.configuredProviders,
                customerImport: input.customerImport,
                observability,
                sql: schedulerSql,
                testMode,
                trigger,
              });
              await purgeBillingObservability({
                observability,
                sql: schedulerSql,
              });
            },
            schedule: input.customerImport?.customers?.schedule,
          }),
          ownership
        );
        recordBillingBootstrapEvent(
          bootstrapEvents,
          BILLING_BOOTSTRAP_EVENT.importSchedulerRegistered
        );
        patchBillingDiagnostics(existing, {
          connectionCount:
            existing?.billingMaterializedConnections?.length ??
            connectionState.connections.length,
          phase: "ready",
          readyAt: Date.now(),
        });
        connectionState.bootstrap = {
          generation: connectionState.bootstrap.generation,
          lastSuccessAt: new Date(),
          phase: "ready",
        };
        bootstrapReadiness.succeed();
        readiness.ready("billing");
      } catch (error) {
        console.error(
          "[athena-billing] configured billing connections failed to materialize",
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
        connectionState.initializationFailed = true;
        connectionState.initializationMessage =
          error instanceof Error ? error.message : String(error);
        connectionState.bootstrap = {
          failedAt: new Date(),
          generation: connectionState.bootstrap.generation,
          lastError: {
            code: "bootstrap_failed",
            retryable: true,
            sanitizedMessage:
              error instanceof Error ? error.message : String(error),
            stage: connectionState.bootstrap.phase,
          },
          phase: "failed",
        };
        const raw =
          error instanceof Error && error.message.trim().length > 0
            ? error.message.trim()
            : "billing initialization failed";
        const sanitized = /access_|live_|test_|sk_|secret|password|token/i.test(
          raw
        )
          ? "billing initialization failed"
          : raw.length > 240
            ? `${raw.slice(0, 237)}...`
            : raw;
        patchBillingDiagnostics(existing, {
          failure: {
            message: sanitized,
            stage: "materializing-connections",
          },
          phase: "failed",
        });
        readiness.fail("billing", error);
        bootstrapReadiness.fail(error);
        if (rethrow) {
          throw error;
        }
      }
      return materialized;
  };

  void runExclusiveEmbeddedBillingRuntime(
    ownerKey,
    ownership.generation,
    () =>
      runBootstrapGeneration(
        ownership,
        () =>
          singleFlightConfiguredBillingConnectionMaterialize(
            configuredBillingConnectionInitKey({
              applicationId: webhookApplicationId ?? "",
              databaseIdentity,
              testMode,
            }),
            () =>
              materializeConfiguredBillingConnections({
                applicationId: webhookApplicationId ?? "",
                appUrl: input.appUrl,
                configuredProviders: input.configuredProviders,
                publicBaseUrl: ingestion.webhooks.publicBaseUrl,
                sql: sql as BillingSqlExecutor,
                testMode,
              }),
          ),
        false,
      ),
  );
}

/** Core createClient plus local Billing overlay. Used by Cloudflare façades. */
export function createClientWithLocalBilling<
  TModels extends AthenaClientConfig["models"] = AthenaClientConfig["models"],
>(config: AthenaClientConfig<TModels>): AthenaClient<TModels> {
  assertDataLifecycleConfig(config);
  assertBillingProviderRuntimeEnvironment(config.billing?.providers);
  const normalized = normalizeUniversalConfig(config);
  const plan = resolveRuntimePlan(normalized, {
    environment: "node",
    trustedNode: true,
  });
  const construction = resolveAthenaConstruction(normalized, plan);
  const materializedDatabase = materializeDatabase(
    plan,
    construction.resources.db,
  );
  const materializedConfig = {
    ...normalized,
    ...(materializedDatabase.bindings.capabilities
      ? { capabilities: materializedDatabase.bindings.capabilities }
      : {}),
    ...(materializedDatabase.bindings.findManyAst === undefined
      ? {}
      : { findManyAst: materializedDatabase.bindings.findManyAst }),
    ...(materializedDatabase.bindings.gatewayTransport
      ? { gatewayTransport: materializedDatabase.bindings.gatewayTransport }
      : {}),
    ...(materializedDatabase.bindings.key === undefined
      ? {}
      : { key: materializedDatabase.bindings.key }),
    ...(materializedDatabase.bindings.db
      ? {
          db: {
            ...normalized.db,
            ...materializedDatabase.bindings.db,
          },
        }
      : {}),
  };
  const factory = createClientWithNormalizer as unknown as (
    input: unknown,
    normalizer: (c: unknown) => unknown,
    runtimeBindings?: { billing?: unknown }
  ) => unknown;
  const normalize = normalizeUniversalCreateClientConfig as unknown as (
    c: unknown
  ) => unknown;
  const billingMode = resolveBillingRuntimeMode({
    configuredProviders: config.billing?.providers,
    mode: config.billing?.mode,
  });
  const postgresRuntime = getBoundPostgresRuntime(
    materializedConfig.gatewayTransport,
  ) ?? materializedDatabase.postgresRuntime;
  const billingSql = postgresRuntime
    ? billingSqlFromPostgresRuntime(postgresRuntime)
    : undefined;
  const binding =
    billingMode === "local"
      ? createLocalBillingRuntimeBinding({
          applicationId: resolveBillingWebhookApplicationId({
            app: config.app,
            client: config.client,
          }),
          appUrl: config.app?.url,
          catalog: config.billing?.catalog,
          configuredProviders: config.billing?.providers,
          customerImport: config.billing?.import,
          ingestion: config.billing?.ingestion,
          mode: config.billing?.mode,
          observability: config.billing?.observability,
          selfEnrollment: config.billing?.selfEnrollment,
          testMode: config.billing?.testMode,
          sql: billingSql,
        })
      : undefined;
  const client = factory(
    materializedConfig,
    normalize,
    binding ? { billing: createBillingRuntimeFacade(binding.runtime) } : undefined
  ) as AthenaClient<TModels>;
  assertLocalAuthHooks(athenaAuthConfig(config.auth));
  assertLocalAuthObservability(athenaAuthConfig(config.auth));
  assertLocalBillingObservability(config.billing);
  if (binding) {
    bootstrapLocalBillingRuntime(client, {
      applicationId: resolveBillingWebhookApplicationId({
        app: config.app,
        client: config.client,
      }),
      appUrl: config.app?.url,
      catalog: config.billing?.catalog,
      configuredProviders: config.billing?.providers,
      customerImport: config.billing?.import,
      ingestion: config.billing?.ingestion,
      mode: config.billing?.mode,
      observability: config.billing?.observability,
      selfEnrollment: config.billing?.selfEnrollment,
      testMode: config.billing?.testMode,
      binding,
    });
  }
  assertLocalBillingRuntimeEnvironment({
    configuredProviders: config.billing?.providers,
    localMaterialized: true,
    mode: config.billing?.mode,
  });
  return client;
}
