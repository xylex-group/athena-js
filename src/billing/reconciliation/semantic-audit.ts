import type { BillingImportPlan } from "../import/types.ts";
import type { AthenaBillingAuditWriter } from "../observability/audit.ts";
import {
  ATHENA_BILLING_EVENT_DEFINITIONS,
  billingEventDefinition,
} from "../observability/events.ts";
import type {
  AthenaBillingAuditEntry,
  AthenaBillingAuditEvent,
  BillingReconciliationContext,
} from "../observability/types.ts";
import {
  mintBillingAuditIdentity,
  validateBillingAuditEntry,
} from "../observability/validate.ts";
import type { BillingSubjectBindingRecord } from "../subject/repository.ts";
import type { BillingSubjectRef } from "../types.ts";

export async function emitBillingImportSemanticAudit(input: {
  applied: "activated" | "conflict" | "created" | "noop";
  context: BillingReconciliationContext;
  plan: BillingImportPlan;
  previous: BillingSubjectBindingRecord | null;
  projectionConflicts: number;
  writer: AthenaBillingAuditWriter;
}): Promise<void> {
  const events: AthenaBillingAuditEvent[] = [];
  if (input.applied === "created") {
    events.push("billing.subject.binding.created");
  } else if (input.applied === "activated") {
    events.push("billing.subject.binding.activated");
  } else if (input.applied === "conflict") {
    events.push("billing.subject.binding.conflict");
  }
  if (input.projectionConflicts > 0) {
    events.push("billing.document.ownership.conflict");
  } else if (
    (input.applied === "created" || input.applied === "activated") &&
    input.plan.subject
  ) {
    events.push("billing.document.ownership.resolved");
  }
  for (const event of events) {
    const ir = billingEventDefinition(event);
    const resolveContext = {
      connectionId: input.context.connectionId,
      previous: input.previous,
      provider: input.context.provider,
      providerCustomerId: input.plan.providerCustomerId,
      result: {
        action: input.applied,
        decision: input.plan.decision,
        subject: input.plan.subject,
      },
      subject: input.plan.subject,
    };
    const subject = ir.resolveSubject(resolveContext);
    const providerSubject = ir.resolveProviderSubject(resolveContext);
    const entry: AthenaBillingAuditEntry = {
      actor: { kind: "system" },
      causationId: input.context.causationId,
      connectionId: input.context.connectionId,
      correlationId: input.context.correlationId,
      event,
      ...mintBillingAuditIdentity(),
      outcome: "success",
      previous: input.previous ?? undefined,
      provider: input.context.provider,
      providerSubject,
      result: resolveContext.result,
      subject,
      traceId: input.context.traceId,
    };
    validateBillingAuditEntry(entry, ir);
    await input.writer.write(entry);
  }
}

export async function emitBillingAuditFailure(input: {
  context: BillingReconciliationContext;
  error: unknown;
  providerCustomerId?: string;
  providerWebhookId?: string;
  subject?: BillingSubjectRef;
  writer: AthenaBillingAuditWriter;
}): Promise<void> {
  const ir = billingEventDefinition("billing.reconciliation.failed");
  const resolveContext = {
    connectionId: input.context.connectionId,
    provider: input.context.provider,
    providerCustomerId: input.providerCustomerId,
    providerWebhookId: input.providerWebhookId,
    result: {
      error:
        input.error instanceof Error
          ? input.error.message
          : "billing operation failed",
    },
    subject: input.subject,
  };
  const entry: AthenaBillingAuditEntry = {
    actor: { kind: "system" },
    causationId: input.context.causationId,
    connectionId: input.context.connectionId,
    correlationId: input.context.correlationId,
    event: "billing.reconciliation.failed",
    ...mintBillingAuditIdentity(),
    outcome: "failure",
    provider: input.context.provider,
    providerSubject: ir.resolveProviderSubject(resolveContext),
    result: resolveContext.result,
    subject: ir.resolveSubject(resolveContext),
    traceId: input.context.traceId,
  };
  validateBillingAuditEntry(entry, ir);
  await input.writer.write(entry);
}

export function billingAuditEventCatalogKeys(): readonly string[] {
  return Object.keys(ATHENA_BILLING_EVENT_DEFINITIONS);
}
