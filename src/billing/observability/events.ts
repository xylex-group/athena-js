import type { BillingSubjectRef } from "../types.ts";
import type {
  AthenaBillingMutationKind,
  AthenaBillingPreviousPolicy,
  AthenaBillingResultPolicy,
} from "./contract.ts";
import type { AthenaBillingAuditEvent } from "./types.ts";

export interface AthenaBillingAuditResolveContext {
  connectionId: string;
  previous?: unknown;
  provider: string;
  providerCustomerId?: string;
  providerWebhookId?: string;
  result?: unknown;
  subject?: BillingSubjectRef;
}

export interface AthenaBillingEventSubject {
  id: string;
  kind: "organization" | "user";
}

export interface AthenaBillingEventDefinition {
  audit: true;
  mutationKind: AthenaBillingMutationKind;
  previous: AthenaBillingPreviousPolicy;
  resolveProviderSubject: (
    context: AthenaBillingAuditResolveContext
  ) => { id: string; kind: "customer" | "webhook" } | undefined;
  resolveSubject: (
    context: AthenaBillingAuditResolveContext
  ) => AthenaBillingEventSubject | undefined;
  result: AthenaBillingResultPolicy;
  subjectType: "billing_subject" | "billing_webhook_registration";
}

function subjectFrom(
  context: AthenaBillingAuditResolveContext
): AthenaBillingEventSubject | undefined {
  const subject = context.subject;
  if (!subject || subject.id.length === 0) {
    return;
  }
  return { id: subject.id, kind: subject.kind };
}

function providerCustomerFrom(
  context: AthenaBillingAuditResolveContext
): { id: string; kind: "customer" } | undefined {
  const id = context.providerCustomerId;
  if (typeof id !== "string" || id.length === 0) {
    return;
  }
  return { id, kind: "customer" };
}

function providerWebhookFrom(
  context: AthenaBillingAuditResolveContext
): { id: string; kind: "webhook" } | undefined {
  const id = context.providerWebhookId;
  if (typeof id !== "string" || id.length === 0) {
    return;
  }
  return { id, kind: "webhook" };
}

const webhookRegistrationIr = {
  audit: true as const,
  previous: "optional" as const,
  resolveProviderSubject: providerWebhookFrom,
  resolveSubject: () => undefined,
  result: "resource" as const,
  subjectType: "billing_webhook_registration" as const,
};

export const ATHENA_BILLING_EVENT_DEFINITIONS = {
  "billing.document.ownership.conflict": {
    audit: true,
    mutationKind: "update",
    previous: "optional",
    resolveProviderSubject: providerCustomerFrom,
    resolveSubject: subjectFrom,
    result: "resource",
    subjectType: "billing_subject",
  },
  "billing.document.ownership.resolved": {
    audit: true,
    mutationKind: "update",
    previous: "optional",
    resolveProviderSubject: providerCustomerFrom,
    resolveSubject: subjectFrom,
    result: "resource",
    subjectType: "billing_subject",
  },
  "billing.reconciliation.cursor.reset": {
    audit: true,
    mutationKind: "action",
    previous: "optional",
    resolveProviderSubject: () => undefined,
    resolveSubject: subjectFrom,
    result: "receipt",
    subjectType: "billing_subject",
  },
  "billing.reconciliation.failed": {
    audit: true,
    mutationKind: "action",
    previous: "optional",
    resolveProviderSubject: (context) =>
      providerCustomerFrom(context) ?? providerWebhookFrom(context),
    resolveSubject: subjectFrom,
    result: "receipt",
    subjectType: "billing_subject",
  },
  "billing.subject.binding.activated": {
    audit: true,
    mutationKind: "update",
    previous: "required",
    resolveProviderSubject: providerCustomerFrom,
    resolveSubject: subjectFrom,
    result: "resource",
    subjectType: "billing_subject",
  },
  "billing.subject.binding.conflict": {
    audit: true,
    mutationKind: "update",
    previous: "optional",
    resolveProviderSubject: providerCustomerFrom,
    resolveSubject: subjectFrom,
    result: "resource",
    subjectType: "billing_subject",
  },
  "billing.subject.binding.created": {
    audit: true,
    mutationKind: "create",
    previous: "none",
    resolveProviderSubject: providerCustomerFrom,
    resolveSubject: subjectFrom,
    result: "resource",
    subjectType: "billing_subject",
  },
  "billing.subject.binding.revoked": {
    audit: true,
    mutationKind: "delete",
    previous: "required",
    resolveProviderSubject: providerCustomerFrom,
    resolveSubject: subjectFrom,
    result: "receipt",
    subjectType: "billing_subject",
  },
  "billing.webhook.registration.created": {
    ...webhookRegistrationIr,
    mutationKind: "create",
    previous: "none",
  },
  "billing.webhook.registration.disabled": {
    ...webhookRegistrationIr,
    mutationKind: "update",
  },
  "billing.webhook.registration.drift_detected": {
    ...webhookRegistrationIr,
    mutationKind: "action",
  },
  "billing.webhook.registration.secret_rotated": {
    ...webhookRegistrationIr,
    mutationKind: "update",
  },
  "billing.webhook.registration.updated": {
    ...webhookRegistrationIr,
    mutationKind: "update",
  },
} as const satisfies Record<
  AthenaBillingAuditEvent,
  AthenaBillingEventDefinition
>;

export function billingEventDefinition(
  event: AthenaBillingAuditEvent
): AthenaBillingEventDefinition {
  return ATHENA_BILLING_EVENT_DEFINITIONS[event];
}
