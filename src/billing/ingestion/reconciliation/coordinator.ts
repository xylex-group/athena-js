import type { AthenaBillingAuditWriter } from "../../observability/audit.ts";
import { billingEventDefinition } from "../../observability/events.ts";
import type { AthenaBillingTraceRecorder } from "../../observability/traces.ts";
import { runWithBillingTrace } from "../../observability/traces.ts";
import type {
  AthenaBillingAuditEntry,
  BillingReconciliationContext,
} from "../../observability/types.ts";
import {
  mintBillingAuditIdentity,
  validateBillingAuditEntry,
} from "../../observability/validate.ts";
import {
  BILLING_RECONCILIATION_RESOURCE_WEBHOOK_REGISTRATIONS,
  type BillingReconciliationLeaseStore,
  billingReconciliationLeaseTtlMs,
} from "../../reconciliation/lease.ts";
import { emitBillingAuditFailure } from "../../reconciliation/semantic-audit.ts";
import type {
  BillingProviderExecutionContext,
  BillingWebhooksPort,
} from "../../runtime/local/providers/types.ts";
import {
  billingWebhookOwnershipMarker,
  fingerprintBillingSigningSecret,
} from "../ownership.ts";
import type { BillingWebhookSecretStore } from "../secrets/types.ts";
import {
  billingWebhookConfigHash,
  buildDesiredBillingWebhookState,
} from "./desired-state.ts";
import {
  assertBillingWebhookRegistrationLifecycle,
  isBillingWebhookRegistrationLifecycleState,
} from "./lifecycle.ts";
import { planBillingWebhookReconciliation } from "./planner.ts";
import type { BillingWebhookRegistrationStore } from "./repository.ts";
import type {
  BillingWebhookReconcileInput,
  BillingWebhookReconciliationPlan,
  BillingWebhookRegistrationRecord,
} from "./types.ts";

export interface ReconcileBillingWebhooksResult {
  foreignUntouched: number;
  plans: readonly BillingWebhookReconciliationPlan[];
  traceId: string;
}

export async function reconcileBillingWebhookRegistrations(input: {
  audit?: AthenaBillingAuditWriter;
  context: BillingReconciliationContext;
  dryRun?: boolean;
  execution: BillingProviderExecutionContext;
  lease?: BillingReconciliationLeaseStore;
  port?: BillingWebhooksPort;
  reconcile: BillingWebhookReconcileInput;
  registrations?: BillingWebhookRegistrationStore;
  rememberSigningSecret?: (input: {
    connectionId: string;
    secret: string;
  }) => void;
  secretStore?: BillingWebhookSecretStore;
  traces?: AthenaBillingTraceRecorder;
}): Promise<ReconcileBillingWebhooksResult> {
  const desired = buildDesiredBillingWebhookState(input.reconcile);
  const trace = input.traces?.start({
    causationId: input.context.causationId,
    connectionId: input.reconcile.connectionId,
    correlationId: input.context.correlationId,
    operation: "billing.webhook.reconcile",
    provider: input.reconcile.provider,
    traceId: input.context.traceId,
    trigger: input.context.trigger,
  });
  const ownerId = crypto.randomUUID();
  const run = async (): Promise<ReconcileBillingWebhooksResult> => {
    let leaseEpoch: number | undefined;
    if (!input.dryRun && input.lease) {
      const leasePhase = trace?.phase("lease");
      const acquired = await input.lease.acquire({
        connectionId: input.reconcile.connectionId,
        ownerId,
        resourceKind: BILLING_RECONCILIATION_RESOURCE_WEBHOOK_REGISTRATIONS,
        ttlMs: billingReconciliationLeaseTtlMs(120_000),
      });
      leasePhase?.finish();
      if (!acquired) {
        throw new Error(
          "Another reconciler holds the webhook_registrations lease."
        );
      }
      leaseEpoch = acquired.epoch;
    }
    const fetchPhase = trace?.phase("provider_fetch");
    const listed = input.port
      ? await input.port.list(input.execution, {})
      : { items: [] };
    fetchPhase?.finish();
    const localSecretSet = input.secretStore
      ? await input.secretStore.resolve(input.reconcile.connectionId)
      : undefined;
    const diffPhase = trace?.phase("diff");
    const planned = planBillingWebhookReconciliation({
      actual: listed.items,
      desired,
      hasDecryptableLocalSecret:
        typeof input.reconcile.hasDecryptableLocalSecret === "boolean"
          ? input.reconcile.hasDecryptableLocalSecret
          : input.secretStore
            ? localSecretSet?.current != null
            : true,
      management: input.reconcile.management,
    });
    diffPhase?.finish();
    if (
      !input.dryRun &&
      input.reconcile.management === "automatic" &&
      input.port
    ) {
      if (desired.nextGen?.enabled && input.secretStore == null) {
        throw new Error(
          "Signed Events webhooks require a durable secret store (secret_rotation_required)."
        );
      }
      const applyPhase = trace?.phase("apply");
      if (input.lease && leaseEpoch != null) {
        const held = await input.lease.heartbeat({
          connectionId: input.reconcile.connectionId,
          epoch: leaseEpoch,
          ownerId,
          resourceKind: BILLING_RECONCILIATION_RESOURCE_WEBHOOK_REGISTRATIONS,
          ttlMs: billingReconciliationLeaseTtlMs(120_000),
        });
        if (!held) {
          throw new Error("Reconciliation lease was lost.");
        }
      }
      for (const plan of planned.plans) {
        if (plan.kind !== "next_gen" || !desired.nextGen?.enabled) {
          continue;
        }
        const registration = input.registrations
          ? await input.registrations.get({
              connectionId: input.reconcile.connectionId,
              kind: "next_gen",
            })
          : undefined;
        if (plan.action === "create") {
          const idempotencyKey =
            registration?.providerRegistrationIdempotencyKey ??
            crypto.randomUUID();
          await persistAndAudit(input, {
            event: "billing.webhook.registration.created",
            eventTypes: desired.nextGen.eventTypes,
            kind: "next_gen",
            providerWebhookId: "create_pending",
            providerRegistrationAttempts:
              (registration?.providerRegistrationAttempts ?? 0) + 1,
            providerRegistrationIdempotencyKey: idempotencyKey,
            reconciliationState: "provider_registration_pending",
            status: "pending",
            url: desired.nextGen.url,
          });
          const created = await input.port.create(input.execution, {
            eventTypes: desired.nextGen.eventTypes,
            idempotencyKey,
            name: desired.nextGen.name,
            url: desired.nextGen.url,
          });
          await persistAndAudit(input, {
            event: "billing.webhook.registration.created",
            eventTypes: created.eventTypes,
            kind: "next_gen",
            lastProviderEvidence: {
              eventTypes: created.eventTypes,
              providerWebhookId: created.id,
              url: created.url,
            },
            providerWebhookId: created.id,
            reconciliationState: "provider_registered_secret_pending",
            status: "pending",
            url: created.url,
          });
          if (!created.signingSecret) {
            await persistAndAudit(input, {
              event: "billing.webhook.registration.drift_detected",
              eventTypes: created.eventTypes,
              kind: "next_gen",
              lifecycleError: {
                code: "webhook_secret_missing_after_create",
              },
              providerWebhookId: created.id,
              reconciliationState: "attention_required",
              status: "drifted",
              url: created.url,
            });
            throw new Error(
              "Provider webhook secret missing after create; rotation_required / decrypt-only key ring."
            );
          }
          await persistSecretAndActivate(input, {
            event: "billing.webhook.registration.created",
            eventTypes: created.eventTypes,
            kind: "next_gen",
            providerSigningSecret: created.signingSecret,
            providerWebhookId: created.id,
            url: created.url,
          });
        } else if (
          plan.action === "noop" &&
          plan.providerWebhook &&
          (registration?.reconciliationState !== "active" ||
            localSecretSet?.current == null)
        ) {
          const state = registration?.reconciliationState;
          if (state === "active" && localSecretSet?.current == null) {
            await persistAndAudit(input, {
              event: "billing.webhook.registration.drift_detected",
              eventTypes: plan.providerWebhook.eventTypes,
              kind: "next_gen",
              lifecycleError: {
                code: "webhook_active_without_secret",
              },
              providerWebhookId: plan.providerWebhook.id,
              reconciliationState: "attention_required",
              status: "drifted",
              url: plan.providerWebhook.url,
            });
            throw new Error(
              "Active provider webhook has no durable signing secret."
            );
          }
          if (
            state !== "secret_persisted_activation_pending" &&
            state !== "verification_pending"
          ) {
            await persistAndAudit(input, {
              event: "billing.webhook.registration.updated",
              eventTypes: plan.providerWebhook.eventTypes,
              kind: "next_gen",
              providerWebhookId: plan.providerWebhook.id,
              reconciliationState: "secret_persisted_activation_pending",
              status: "pending",
              url: plan.providerWebhook.url,
            });
          }
          if (state !== "verification_pending") {
            await persistAndAudit(input, {
              event: "billing.webhook.registration.updated",
              eventTypes: plan.providerWebhook.eventTypes,
              kind: "next_gen",
              providerWebhookId: plan.providerWebhook.id,
              reconciliationState: "verification_pending",
              status: "pending",
              url: plan.providerWebhook.url,
            });
          }
          await persistAndAudit(input, {
            event: "billing.webhook.registration.updated",
            eventTypes: plan.providerWebhook.eventTypes,
            kind: "next_gen",
            providerWebhookId: plan.providerWebhook.id,
            reconciliationState: "active",
            status: "active",
            url: plan.providerWebhook.url,
          });
        } else if (
          plan.action === "update" &&
          plan.providerWebhook &&
          input.port.update
        ) {
          await persistAndAudit(input, {
            event: "billing.webhook.registration.updated",
            eventTypes: desired.nextGen.eventTypes,
            kind: "next_gen",
            previous: {
              eventTypes: plan.providerWebhook.eventTypes,
              url: plan.providerWebhook.url,
            },
            providerWebhookId: plan.providerWebhook.id,
            reconciliationState: "rotation_pending",
            status: "pending",
            url: desired.nextGen.url,
          });
          const updated = await input.port.update(input.execution, {
            eventTypes: desired.nextGen.eventTypes,
            id: plan.providerWebhook.id,
            name: desired.nextGen.name,
            url: desired.nextGen.url,
          });
          await persistAndAudit(input, {
            event: "billing.webhook.registration.updated",
            eventTypes: updated.eventTypes,
            kind: "next_gen",
            previous: {
              eventTypes: plan.providerWebhook.eventTypes,
              url: plan.providerWebhook.url,
            },
            providerWebhookId: updated.id,
            reconciliationState: "rotation_secret_pending",
            status: "pending",
            url: updated.url,
          });
          if (updated.signingSecret) {
            await persistSecretAndActivate(input, {
              event: "billing.webhook.registration.updated",
              eventTypes: updated.eventTypes,
              providerSigningSecret: updated.signingSecret,
              providerWebhookId: updated.id,
              url: updated.url,
            });
          } else {
            const durableSecret = input.secretStore
              ? await input.secretStore.resolve(input.reconcile.connectionId)
              : undefined;
            if (durableSecret?.current == null) {
              await persistAndAudit(input, {
                event: "billing.webhook.registration.drift_detected",
                eventTypes: updated.eventTypes,
                kind: "next_gen",
                lifecycleError: {
                  code: "webhook_secret_unrecoverable",
                },
                providerWebhookId: updated.id,
                reconciliationState: "attention_required",
                status: "drifted",
                url: updated.url,
              });
              throw new Error(
                "Provider webhook secret is unavailable after registration recovery."
              );
            }
            await persistAndAudit(input, {
              event: "billing.webhook.registration.updated",
              eventTypes: updated.eventTypes,
              kind: "next_gen",
              providerWebhookId: updated.id,
              reconciliationState: "active",
              status: "active",
              url: updated.url,
            });
          }
        } else if (
          plan.action === "update" &&
          plan.providerWebhook &&
          !input.port.update
        ) {
          await persistAndAudit(input, {
            event: "billing.webhook.registration.drift_detected",
            eventTypes: desired.nextGen.eventTypes,
            kind: "next_gen",
            lifecycleError: { code: "webhook_update_unavailable" },
            providerWebhookId: plan.providerWebhook.id,
            reconciliationState: "attention_required",
            status: "drifted",
            url: desired.nextGen.url,
          });
        } else if (plan.action === "conflict") {
          await persistAndAudit(input, {
            event: "billing.webhook.registration.drift_detected",
            eventTypes: desired.nextGen.eventTypes,
            kind: "next_gen",
            providerWebhookId: plan.providerWebhook?.id ?? "unregistered",
            status: "drifted",
            url: desired.nextGen.url,
          });
        }
      }
      applyPhase?.finish();
    } else if (
      !input.dryRun &&
      input.reconcile.management === "manual" &&
      planned.plans.some((plan) => plan.action === "conflict")
    ) {
      const drifted = planned.plans.find((plan) => plan.action === "conflict");
      if (drifted && desired.nextGen) {
        await persistAndAudit(input, {
          event: "billing.webhook.registration.drift_detected",
          eventTypes: desired.nextGen.eventTypes,
          kind: "next_gen",
          providerWebhookId: drifted.providerWebhook?.id ?? "unregistered",
          status: "drifted",
          url: desired.nextGen.url,
        });
      }
    }
    if (!input.dryRun && desired.classic && input.registrations) {
      await input.registrations.upsert({
        configHash: billingWebhookConfigHash({
          eventTypes: [],
          kind: "classic",
          url: desired.classic.url,
        }),
        connectionId: input.reconcile.connectionId,
        environment: input.reconcile.environment,
        eventTypes: [],
        id: crypto.randomUUID(),
        kind: "classic",
        name: desired.marker,
        provider: input.reconcile.provider,
        status: "active",
        url: desired.classic.url,
      });
    }
    await trace?.success();
    return {
      foreignUntouched: planned.foreign.length,
      plans: planned.plans,
      traceId: input.context.traceId,
    };
  };
  try {
    return await (trace ? runWithBillingTrace(trace, run) : run());
  } catch (error) {
    if (input.audit) {
      try {
        await emitBillingAuditFailure({
          context: input.context,
          error,
          writer: input.audit,
        });
      } catch {
        /* persistence of the failure row must not hide the original error */
      }
    }
    await trace?.failure(error, "apply");
    throw error;
  } finally {
    if (!input.dryRun && input.lease) {
      await input.lease.release({
        connectionId: input.reconcile.connectionId,
        ownerId,
        resourceKind: BILLING_RECONCILIATION_RESOURCE_WEBHOOK_REGISTRATIONS,
      });
    }
  }
}

async function persistAndAudit(
  input: {
    audit?: AthenaBillingAuditWriter;
    context: BillingReconciliationContext;
    reconcile: BillingWebhookReconcileInput;
    registrations?: BillingWebhookRegistrationStore;
    secretStore?: BillingWebhookSecretStore;
  },
  record: {
    event: AthenaBillingAuditEntry["event"];
    eventTypes: readonly string[];
    kind: BillingWebhookRegistrationRecord["kind"];
    previous?: unknown;
    providerSigningSecret?: string;
    providerWebhookId: string;
    reconciliationState?: BillingWebhookRegistrationRecord["reconciliationState"];
    activationAttempts?: number;
    lastProviderEvidence?: unknown;
    lifecycleError?: unknown;
    lifecycleUpdatedAt?: Date;
    providerRegistrationAttempts?: number;
    providerRegistrationIdempotencyKey?: string;
    secretPersistenceAttempts?: number;
    status: BillingWebhookRegistrationRecord["status"];
    url: string;
  }
): Promise<void> {
  const existing = input.registrations
    ? await input.registrations.get({
        connectionId: input.reconcile.connectionId,
        kind: record.kind,
      })
    : undefined;
  let secretFingerprint: string | undefined;
  if (record.providerSigningSecret && record.providerSigningSecret.length > 0) {
    if (!input.secretStore) {
      throw new Error(
        "Webhook provider secret cannot be activated without a durable secret store."
      );
    }
    secretFingerprint = fingerprintBillingSigningSecret(
      record.providerSigningSecret
    );
    await input.secretStore.storeCurrent({
      connectionId: input.reconcile.connectionId,
      fingerprint: secretFingerprint,
      secret: record.providerSigningSecret,
    });
  } else if (input.secretStore) {
    const existing = await input.secretStore.resolve(
      input.reconcile.connectionId
    );
    if (existing.current) {
      secretFingerprint = fingerprintBillingSigningSecret(existing.current);
    }
  } else if (existing) {
    secretFingerprint = existing?.secretFingerprint;
  }
  if (
    record.kind === "next_gen" &&
    record.status === "active" &&
    secretFingerprint == null
  ) {
    throw new Error(
      "Webhook registration cannot become active without durable secret material."
    );
  }
  if (
    existing?.reconciliationState &&
    record.reconciliationState &&
    existing.reconciliationState !== record.reconciliationState
  ) {
    const legacyStates = new Set([
      "create_pending",
      "remote_created_secret_pending",
      "rotation_required",
      "update_pending",
    ]);
    if (
      !legacyStates.has(existing.reconciliationState) &&
      isBillingWebhookRegistrationLifecycleState(
        existing.reconciliationState
      ) &&
      isBillingWebhookRegistrationLifecycleState(record.reconciliationState)
    ) {
      assertBillingWebhookRegistrationLifecycle(existing.reconciliationState, {
        hasSecret: secretFingerprint != null,
        next: record.reconciliationState,
      });
    }
  }
  const row: BillingWebhookRegistrationRecord = {
    configHash: billingWebhookConfigHash({
      eventTypes: record.eventTypes,
      kind: record.kind,
      url: record.url,
    }),
    connectionId: input.reconcile.connectionId,
    environment: input.reconcile.environment,
    eventTypes: record.eventTypes,
    id: existing?.id ?? crypto.randomUUID(),
    kind: record.kind,
    name: billingWebhookConfigHash({
      eventTypes: record.eventTypes,
      kind: record.kind,
      url: record.url,
    }),
    provider: input.reconcile.provider,
    providerWebhookId: record.providerWebhookId,
    status: record.status,
    url: record.url,
    lastReconciledAt: new Date(),
    ...(record.status === "active" ? { lastVerifiedAt: new Date() } : {}),
    ...(record.activationAttempts != null ||
    existing?.activationAttempts != null
      ? {
          activationAttempts:
            record.activationAttempts ?? existing?.activationAttempts,
        }
      : {}),
    ...(record.lastProviderEvidence !== undefined ||
    existing?.lastProviderEvidence !== undefined
      ? {
          lastProviderEvidence:
            record.lastProviderEvidence ?? existing?.lastProviderEvidence,
        }
      : {}),
    ...(record.lifecycleError !== undefined ||
    existing?.lifecycleError !== undefined
      ? {
          lifecycleError: record.lifecycleError ?? existing?.lifecycleError,
        }
      : {}),
    ...(record.lifecycleUpdatedAt || existing?.lifecycleUpdatedAt
      ? {
          lifecycleUpdatedAt:
            record.lifecycleUpdatedAt ?? existing?.lifecycleUpdatedAt,
        }
      : {}),
    ...(record.providerRegistrationAttempts != null ||
    existing?.providerRegistrationAttempts != null
      ? {
          providerRegistrationAttempts:
            record.providerRegistrationAttempts ??
            existing?.providerRegistrationAttempts,
        }
      : {}),
    ...(record.providerRegistrationIdempotencyKey ||
    existing?.providerRegistrationIdempotencyKey
      ? {
          providerRegistrationIdempotencyKey:
            record.providerRegistrationIdempotencyKey ??
            existing?.providerRegistrationIdempotencyKey,
        }
      : {}),
    ...(record.secretPersistenceAttempts != null ||
    existing?.secretPersistenceAttempts != null
      ? {
          secretPersistenceAttempts:
            record.secretPersistenceAttempts ??
            existing?.secretPersistenceAttempts,
        }
      : {}),
    ...(secretFingerprint ? { secretFingerprint } : {}),
    ...((record.reconciliationState ?? existing?.reconciliationState)
      ? {
          reconciliationState:
            record.reconciliationState ?? existing?.reconciliationState,
        }
      : {}),
  };
  if (input.registrations) {
    await input.registrations.upsert({
      ...row,
      name: billingWebhookOwnershipMarker({
        applicationId: input.reconcile.applicationId,
        connectionId: input.reconcile.connectionId,
      }),
    });
  }
  if (!input.audit) {
    return;
  }
  const ir = billingEventDefinition(record.event);
  const entry: AthenaBillingAuditEntry = {
    actor: { kind: "system" },
    causationId: input.context.causationId,
    connectionId: input.reconcile.connectionId,
    correlationId: input.context.correlationId,
    event: record.event,
    ...mintBillingAuditIdentity(),
    outcome: "success",
    previous: record.previous,
    provider: input.reconcile.provider,
    providerSubject: { id: record.providerWebhookId, kind: "webhook" },
    result: {
      eventTypes: record.eventTypes,
      status: record.status,
      url: record.url,
    },
    traceId: input.context.traceId,
  };
  validateBillingAuditEntry(entry, ir);
  await input.audit.write(entry);
}

async function persistSecretAndActivate(
  input: {
    audit?: AthenaBillingAuditWriter;
    context: BillingReconciliationContext;
    reconcile: BillingWebhookReconcileInput;
    registrations?: BillingWebhookRegistrationStore;
    rememberSigningSecret?: (input: {
      connectionId: string;
      secret: string;
    }) => void;
    secretStore?: BillingWebhookSecretStore;
  },
  record: {
    event: AthenaBillingAuditEntry["event"];
    eventTypes: readonly string[];
    kind?: "next_gen";
    previous?: unknown;
    providerSigningSecret: string;
    providerWebhookId: string;
    url: string;
  }
): Promise<void> {
  if (!input.secretStore) {
    throw new Error(
      "Webhook provider secret cannot be activated without a durable secret store."
    );
  }
  const fingerprint = fingerprintBillingSigningSecret(
    record.providerSigningSecret
  );
  await input.secretStore.storeCurrent({
    connectionId: input.reconcile.connectionId,
    fingerprint,
    secret: record.providerSigningSecret,
  });
  input.rememberSigningSecret?.({
    connectionId: input.reconcile.connectionId,
    secret: record.providerSigningSecret,
  });
  await persistAndAudit(input, {
    event: record.event,
    eventTypes: record.eventTypes,
    kind: record.kind ?? "next_gen",
    previous: record.previous,
    providerWebhookId: record.providerWebhookId,
    reconciliationState: "secret_persisted_activation_pending",
    secretPersistenceAttempts: 1,
    status: "pending",
    url: record.url,
  });
  await persistAndAudit(input, {
    event: record.event,
    eventTypes: record.eventTypes,
    kind: record.kind ?? "next_gen",
    previous: record.previous,
    providerWebhookId: record.providerWebhookId,
    reconciliationState: "verification_pending",
    status: "pending",
    url: record.url,
  });
  await persistAndAudit(input, {
    event: record.event,
    eventTypes: record.eventTypes,
    kind: record.kind ?? "next_gen",
    previous: record.previous,
    providerWebhookId: record.providerWebhookId,
    reconciliationState: "active",
    activationAttempts: 1,
    status: "active",
    url: record.url,
  });
}
