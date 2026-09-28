import { dispatchCanonicalEventAfterCommit } from "../../../../runtime/events/hooks.ts";
import {
  classifyIngressFailure,
  INGRESS_PROCESSING_LEASE_MS,
  wrapIngressProcessingError,
  type IngressFailureStage,
} from "../../../../runtime/ingress/failure.ts";
import { deriveIngressProviderEventId } from "../../../../runtime/ingress/identity.ts";
import type { AthenaIngressIR } from "../../../../runtime/ingress/ir.ts";
import type {
  EventIngressDomainHandler,
  EventIngressRuntimeContext,
} from "../../../../runtime/ingress/runtime.ts";
import {
  type CanonicalBillingDocument,
  canonicalDocumentRevision,
  canonicalDocumentSubjectId,
} from "../../../canonical/document.ts";
import type { CanonicalBillingEvent } from "../../../canonical/transition.ts";
import {
  type BillingWebhookIngressObservability,
  recordBillingWebhookIngressQuietly,
  reportBillingWebhookIngressDiagnostic,
} from "../../../ingestion/observability/health.ts";
import {
  type BillingWebhookIngressStage,
  billingWebhookRegistrationKind,
} from "../../../ingestion/observability/stages.ts";
import { mollieWebhookChannel } from "../providers/mollie/channel.ts";
import { mollieWebhookDeliveryLagMs } from "../providers/mollie/parse-webhook.ts";
import type { BillingProviderWebhookPort } from "../providers/webhook-port.ts";
import {
  type ApplyCanonicalBillingIngressResult,
  applyCanonicalBillingIngress,
} from "./apply.ts";
import type { BillingIngressDomainContext } from "./repository.ts";

export function billingDeterministicEventId(input: {
  provider: string;
  connectionId?: string;
  document: CanonicalBillingDocument;
}): string {
  const revision = canonicalDocumentRevision(input.document);
  return deriveIngressProviderEventId({
    authoritativeStateOrVersion:
      revision.sequence ??
      `${input.document.status}:${revision.providerUpdatedAt?.toISOString() ?? ""}`,
    connectionId: input.connectionId,
    provider: input.provider,
    resourceId: canonicalDocumentSubjectId(input.document),
    resourceKind: input.document.kind,
  });
}

function observeContext(ingress: AthenaIngressIR) {
  return {
    kind: billingWebhookRegistrationKind(ingress.operation),
    ...(ingress.connectionId ? { connectionId: ingress.connectionId } : {}),
    ...(ingress.correlationId ? { correlationId: ingress.correlationId } : {}),
    ingressId: ingress.id,
    ...(ingress.traceId ? { traceId: ingress.traceId } : {}),
  };
}

function observabilityWrite(
  ctx: ReturnType<typeof observeContext>,
  connectionId: string,
  stage: BillingWebhookIngressStage
) {
  return {
    connectionId,
    ingressId: ctx.ingressId,
    kind: ctx.kind,
    stage,
    ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
    ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
  };
}

export function createBillingEventIngressHandler<TEnvelope, TResource>(input: {
  observability?: BillingWebhookIngressObservability;
  onAuthoritativeDocument?: (input: {
    document: CanonicalBillingDocument;
    ingress: AthenaIngressIR;
  }) => Promise<void> | void;
  port: BillingProviderWebhookPort<TEnvelope, TResource>;
  provider?: string;
}): EventIngressDomainHandler<
  BillingIngressDomainContext,
  CanonicalBillingDocument,
  CanonicalBillingEvent
> {
  const provider = input.provider ?? "mollie";
  return {
    async ingest(ingress, runtime) {
      const ctx = observeContext(ingress);
      const connectionId = ctx.connectionId;
      const note = async (stage: BillingWebhookIngressStage) => {
        await recordBillingWebhookIngressQuietly(input.observability, (store) =>
          store.recordStage({
            ...ctx,
            occurredAt: new Date(),
            stage,
          })
        );
      };
      const acceptDuplicate = async () => {
        if (connectionId) {
          await recordBillingWebhookIngressQuietly(
            input.observability,
            (store) =>
              store.recordAccepted(
                observabilityWrite(ctx, connectionId, "duplicate")
              )
          );
        } else {
          await note("duplicate");
        }
        return {
          duplicate: true,
          events: [],
          reconciliation: "skipped" as const,
        };
      };
      const early = await runtime.database.transaction(async (tx) => {
        await runtime.persistence.insertReceived(tx, ingress, {
          provider,
        });
        const existing = await runtime.persistence.lock(tx, ingress.id);
        if (existing?.status === "processed") {
          return { duplicate: true as const };
        }
        await runtime.persistence.markStatus(tx, {
          ingressId: ingress.id,
          leaseExpiresAt: new Date(Date.now() + INGRESS_PROCESSING_LEASE_MS),
          status: "resolving",
        });
        return { duplicate: false as const };
      });
      if (early.duplicate) {
        return acceptDuplicate();
      }
      let stage: IngressFailureStage = "parse";
      let result: ApplyCanonicalBillingIngressResult;
      let canonicalDocument: CanonicalBillingDocument | undefined;
      try {
        const envelope = await input.port.parseIngress(ingress);
        if (
          envelope != null &&
          typeof envelope === "object" &&
          "kind" in envelope &&
          envelope.kind === "next_gen" &&
          "createdAt" in envelope &&
          typeof envelope.createdAt === "string"
        ) {
          const createdAt = envelope.createdAt;
          await recordBillingWebhookIngressQuietly(
            input.observability,
            (store) =>
              store.recordStage({
                ...ctx,
                metadata: {
                  createdAt,
                  deliveryLagMs: mollieWebhookDeliveryLagMs(
                    createdAt,
                    ingress.receivedAt
                  ),
                },
                occurredAt: new Date(),
                stage: "parsed",
              })
          );
        } else {
          await note("parsed");
        }
        if (
          mollieWebhookChannel(ingress.operation)?.kind === "next_gen" &&
          input.port.verifyIngress
        ) {
          stage = "verify";
          await input.port.verifyIngress(envelope, ingress);
          await note("verified");
        }
        const earlyProviderEventId =
          input.port.providerEventIdBeforeRefetch?.(envelope);
        if (earlyProviderEventId) {
          const claimed = await runtime.database.transaction((tx) =>
            runtime.persistence.insertReceived(tx, ingress, {
              provider,
              providerEventId: earlyProviderEventId,
            })
          );
          if (claimed.duplicate) {
            return acceptDuplicate();
          }
        }
        stage = "refetch";
        await note("authoritative_refetch_started");
        const resource = await input.port.resolveAuthoritativeState(
          envelope,
          ingress
        );
        await note("authoritative_refetch_completed");
        stage = "project";
        canonicalDocument = input.port.projectDocument(resource);
        const document = canonicalDocument;
        await note("canonicalized");
        const providerEventId =
          input.port.resolveProviderEventId?.(envelope, document, ingress) ??
          billingDeterministicEventId({
            connectionId: ingress.connectionId,
            document,
            provider,
          });
        const claimed = await runtime.database.transaction((tx) =>
          runtime.persistence.insertReceived(tx, ingress, {
            provider,
            providerEventId,
          })
        );
        if (claimed.duplicate) {
          return acceptDuplicate();
        }
        stage = "persist";
        result = await applyCanonicalBillingIngress({
          canonicalizeEvents: (context) =>
            input.port.canonicalizeEvents(context),
          database: runtime.database,
          document,
          documents: runtime.domain.documents,
          events: runtime.domain.events,
          ingress,
          outbox: runtime.domain.outbox,
          persistence: runtime.persistence,
        });
      } catch (error) {
        const wrapped = wrapIngressProcessingError({
          ...(connectionId ? { connectionId } : {}),
          error,
          stage,
        });
        await persistIngressFailure(runtime, ingress.id, wrapped, stage);
        throw wrapped;
      }
      const acceptStage: BillingWebhookIngressStage = result.duplicate
        ? "duplicate"
        : "persisted";
      if (connectionId) {
        await recordBillingWebhookIngressQuietly(input.observability, (store) =>
          store.recordAccepted(
            observabilityWrite(ctx, connectionId, acceptStage)
          )
        );
      } else {
        await note(acceptStage);
      }
      let reconciliation: "completed" | "failed" | "skipped" = "skipped";
      if (!result.duplicate) {
        try {
          await dispatchCanonicalEventAfterCommit(result.events);
          if (input.onAuthoritativeDocument) {
            if (canonicalDocument == null) {
              throw new Error(
                "Billing webhook accepted without a canonical document."
              );
            }
            await note("reconciliation_started");
            await input.onAuthoritativeDocument({
              document: canonicalDocument,
              ingress,
            });
            if (connectionId) {
              await recordBillingWebhookIngressQuietly(
                input.observability,
                (store) =>
                  store.recordReconciliation({
                    ...observabilityWrite(
                      ctx,
                      connectionId,
                      "reconciliation_completed"
                    ),
                    outcome: "completed",
                  })
              );
            } else {
              await note("reconciliation_completed");
            }
            reconciliation = "completed";
          } else if (connectionId) {
            await recordBillingWebhookIngressQuietly(
              input.observability,
              (store) =>
                store.recordReconciliation({
                  ...observabilityWrite(ctx, connectionId, acceptStage),
                  outcome: "skipped",
                })
            );
          }
        } catch (error) {
          reportBillingWebhookIngressDiagnostic(
            "[athena.billing] webhook reconciliation failed after accept",
            error
          );
          if (connectionId) {
            await recordBillingWebhookIngressQuietly(
              input.observability,
              (store) =>
                store.recordReconciliation({
                  ...observabilityWrite(
                    ctx,
                    connectionId,
                    "reconciliation_failed"
                  ),
                  outcome: "failed",
                })
            );
          } else {
            await note("reconciliation_failed");
          }
          reconciliation = "failed";
        }
      }
      return {
        ...result,
        reconciliation,
      };
    },
  };
}

async function persistIngressFailure(
  runtime: EventIngressRuntimeContext,
  ingressId: string,
  error: unknown,
  stage: IngressFailureStage
): Promise<void> {
  try {
    await runtime.database.transaction(async (tx) => {
      const locked = await runtime.persistence.lock(tx, ingressId);
      if (locked?.status === "processed") {
        return;
      }
      const classified = classifyIngressFailure({
        attemptCount: (locked?.attemptCount ?? 0) + 1,
        error,
        firstFailedAt: locked?.firstFailedAt ?? undefined,
        stage,
      });
      await runtime.persistence.markStatus(tx, {
        error: classified.error,
        failureStage: classified.stage,
        firstFailedAt: new Date(classified.error.firstFailedAt),
        ingressId,
        lastFailedAt: new Date(classified.error.lastFailedAt),
        status: classified.status,
        ...(classified.nextAttemptAt
          ? { nextAttemptAt: classified.nextAttemptAt }
          : {}),
      });
    });
  } catch {
    /* persistence of the failure row must not hide the original error */
  }
}
