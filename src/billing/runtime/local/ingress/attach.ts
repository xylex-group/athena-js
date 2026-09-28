import type { PostgresPoolManager } from "../../../../postgres/pool/manager.ts";
import {
  ATHENA_EVENT_INGRESS_PERSISTENCE_REQUIRED,
  ATHENA_INGRESS_MOLLIE_UNAVAILABLE,
  AthenaEventIngressError,
} from "../../../../runtime/ingress/errors.ts";
import type { AthenaIngressIR } from "../../../../runtime/ingress/ir.ts";
import { eventIngressDatabaseFromManager } from "../../../../runtime/ingress/postgres.ts";
import { createEventIngressRuntime } from "../../../../runtime/ingress/runtime.ts";
import { createSqlEventIngressPersistence } from "../../../../runtime/ingress/sql.ts";
import { runBillingCustomerImportWithPostgres } from "../../../import/assemble.ts";
import {
  createBillingImportDatabaseFromManager,
  createBillingSqlExecutorFromManager,
} from "../../../import/database.ts";
import {
  listActiveBillingImportConnections,
  resolveBillingImportConnection,
} from "../../../import/postgres.ts";
import { createLazyBillingWebhookIngressObservability } from "../../../ingestion/observability/health.ts";
import { createPostgresBillingWebhookRegistrationStore } from "../../../ingestion/reconciliation/repository.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import { billingReconciliationContextFromIngress } from "../../../reconciliation/webhook.ts";
import type { BillingSqlExecutor } from "../../../subject/repository.ts";
import { advanceSelfSubscriptionEnrollment } from "../../self/advance-enrollment.ts";
import {
  createConnectionProviderExecutionContext,
  eligibleBillingConnectionsForProcess,
  mollieConfigForCredentialReference,
  pickSoleEligibleBillingConnection,
} from "../providers/connection-binding.ts";
import { normalizeMollieRuntimeConfig } from "../providers/mollie/config.ts";
import { resolveMollieWebhookResource } from "../providers/mollie/resolve-resource.ts";
import { MollieSdkClientPool } from "../providers/mollie/sdk/client-factory.ts";
import { createMollieWebhookPort } from "../providers/mollie/webhook-port.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { createBillingEventIngressHandler } from "./handler.ts";
import { createSqlBillingRepositories } from "./sql.ts";

export interface EventIngressAttachHost {
  eventIngressRuntime?: unknown;
  postgresRuntime?: {
    getPoolManager(): Promise<PostgresPoolManager>;
  };
}

async function postgresManager(
  internals: EventIngressAttachHost
): Promise<PostgresPoolManager | undefined> {
  const owned = internals.postgresRuntime;
  if (!owned) {
    return;
  }
  return owned.getPoolManager();
}

export function attachEventIngressRuntime(
  internals: EventIngressAttachHost,
  input: {
    configuredProviders?: BillingProviderConfigMap;
    registry: BillingProviderRegistry;
    testMode?: boolean;
    resolveSigningSecrets?: (connectionId: string) => readonly string[];
    signingSecrets?: readonly string[];
  }
): void {
  const getSql = async (): Promise<BillingSqlExecutor | undefined> => {
    const manager = await postgresManager(internals);
    if (!manager) {
      return;
    }
    return createBillingSqlExecutorFromManager(manager);
  };
  const handler = createBillingEventIngressHandler({
    observability: createLazyBillingWebhookIngressObservability(getSql),
    onAuthoritativeDocument: async ({ document, ingress }) => {
      const manager = await postgresManager(internals);
      if (!manager) {
        return;
      }
      const sql = createBillingSqlExecutorFromManager(manager);
      if (document.kind === "payment") {
        try {
          await advanceSelfSubscriptionEnrollment({
            configuredProviders: input.configuredProviders,
            document,
            registry: input.registry,
            sql,
            testMode: input.testMode,
          });
        } catch (error) {
          console.error("[athena-billing] enrollment advance failed", {
            error: error instanceof Error ? error.message : String(error),
            ingressId: ingress.id,
          });
          throw error;
        }
      }
      const providerCustomerId = document.providerCustomerId;
      const connectionId = ingress.connectionId;
      if (
        typeof providerCustomerId !== "string" ||
        providerCustomerId.length === 0 ||
        typeof connectionId !== "string" ||
        connectionId.length === 0
      ) {
        return;
      }
      try {
        if (typeof connectionId === "string" && connectionId.length > 0) {
          const kind =
            ingress.operation === "webhook.mollie.classic"
              ? "classic"
              : "next_gen";
          await createPostgresBillingWebhookRegistrationStore(
            sql
          ).touchLastDelivery({
            connectionId,
            kind,
          });
        }
        await runBillingCustomerImportWithPostgres({
          configuredProviders: input.configuredProviders,
          connectionId,
          customerId: providerCustomerId,
          database: createBillingImportDatabaseFromManager(manager),
          dryRun: false,
          reconciliationContext: billingReconciliationContextFromIngress({
            connectionId,
            correlationId: ingress.correlationId,
            ingressId: ingress.id,
            provider: document.provider,
            traceId: ingress.traceId,
          }),
          sql,
          testMode: input.testMode,
          trigger: "webhook",
        });
      } catch (error) {
        console.error("[athena-billing] webhook reconciliation failed", {
          connectionId,
          error: error instanceof Error ? error.message : String(error),
          ingressId: ingress.id,
        });
        throw error;
      }
    },
    port: createMollieWebhookPort({
      resolveResource: createMollieResourceResolver({
        configuredProviders: input.configuredProviders,
        getSql,
        testMode: input.testMode,
      }),
      ...(input.resolveSigningSecrets
        ? { resolveSigningSecrets: input.resolveSigningSecrets }
        : {}),
      signingSecrets: input.signingSecrets,
      verification:
        input.resolveSigningSecrets ||
        (input.signingSecrets && input.signingSecrets.length > 0)
          ? "signature_and_refetch"
          : "authoritative_refetch",
    }),
  });

  internals.eventIngressRuntime = {
    async ingest(ingress: AthenaIngressIR) {
      const manager = await postgresManager(internals);
      if (!manager) {
        throw new AthenaEventIngressError({
          code: ATHENA_EVENT_INGRESS_PERSISTENCE_REQUIRED,
          domain: "billing",
          message:
            "Financial webhook ingest requires durable PostgreSQL persistence.",
          retryable: true,
        });
      }
      const sql = createBillingSqlExecutorFromManager(manager);
      const bound = await bindBillingIngressConnection(ingress, sql, {
        configuredProviders: input.configuredProviders,
        testMode: input.testMode,
      });
      const sqlRepos = createSqlBillingRepositories();
      const runtime = createEventIngressRuntime({
        context: {
          database: eventIngressDatabaseFromManager(manager),
          domain: sqlRepos,
          persistence: createSqlEventIngressPersistence(),
        },
        handler,
      });
      return runtime.ingest(bound);
    },
  };
}

async function bindBillingIngressConnection(
  ingress: AthenaIngressIR,
  sql: BillingSqlExecutor,
  input: {
    configuredProviders?: BillingProviderConfigMap;
    testMode?: boolean;
  }
): Promise<AthenaIngressIR> {
  if (ingress.connectionId != null && ingress.connectionId.length > 0) {
    return ingress;
  }
  const only = await resolveSoleActiveMollieConnection(sql, input);
  return { ...ingress, connectionId: only.id };
}

function unavailableMollieRefetch(message: string): never {
  throw new AthenaEventIngressError({
    code: ATHENA_INGRESS_MOLLIE_UNAVAILABLE,
    domain: "billing",
    message,
    provider: "mollie",
    retryable: false,
  });
}

function createMollieResourceResolver(input: {
  configuredProviders?: BillingProviderConfigMap;
  getSql: () => Promise<BillingSqlExecutor | undefined>;
  testMode?: boolean;
}): (request: {
  connectionId?: string;
  id: string;
  kind: "payment" | "subscription" | "invoice";
}) => Promise<unknown> {
  const pools = new Map<string, MollieSdkClientPool>();
  return async (request) => {
    const sql = await input.getSql();
    if (sql == null) {
      unavailableMollieRefetch(
        "Mollie webhook resource refetch requires PostgreSQL so the connection credential can be resolved."
      );
    }
    const connection =
      request.connectionId != null && request.connectionId.length > 0
        ? await resolveBillingImportConnection(sql, {
            connectionId: request.connectionId,
            provider: "mollie",
          })
        : await resolveSoleActiveMollieConnection(sql, {
            configuredProviders: input.configuredProviders,
            testMode: input.testMode,
          });
    const mollie = mollieConfigForCredentialReference(
      input.configuredProviders,
      connection.credentialReference
    );
    if (mollie == null) {
      unavailableMollieRefetch(
        `Mollie is not configured for credential_reference "${connection.credentialReference}".`
      );
    }
    let pool = pools.get(connection.credentialReference);
    if (pool == null) {
      pool = new MollieSdkClientPool(normalizeMollieRuntimeConfig(mollie));
      pools.set(connection.credentialReference, pool);
    }
    const context = createConnectionProviderExecutionContext({
      configuredProviders: input.configuredProviders,
      connection,
      operationScope: request.kind === "invoice" ? "organization" : "profile",
    });
    return resolveMollieWebhookResource({
      credential: context.credential,
      id: request.id,
      kind: request.kind,
      operationScope: context.operationScope,
      pool,
      profileId: context.target.profileId,
    });
  };
}

async function resolveSoleActiveMollieConnection(
  sql: BillingSqlExecutor,
  input: {
    configuredProviders?: BillingProviderConfigMap;
    testMode?: boolean;
  }
) {
  const active = await listActiveBillingImportConnections(sql, "mollie");
  const eligible = eligibleBillingConnectionsForProcess({
    configuredProviders: input.configuredProviders,
    connections: active,
    processTestMode: input.testMode,
  });
  const only = pickSoleEligibleBillingConnection(eligible);
  if (only == null && eligible.length > 1) {
    unavailableMollieRefetch(
      `Multiple active Mollie billing connections: webhook refetch requires ingress.connectionId (${eligible
        .map((connection) => `${connection.id}:${connection.environment}`)
        .join(", ")}).`
    );
  }
  if (only == null) {
    unavailableMollieRefetch(
      "No active Mollie billing connection is available for webhook resource refetch."
    );
  }
  return only;
}
