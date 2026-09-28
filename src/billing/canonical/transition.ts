import type { CanonicalBillingEventName } from "../../runtime/events/catalog.ts";
import { causalityFromIngress } from "../../runtime/events/causality.ts";
import { deriveCanonicalEventId } from "../../runtime/events/identity.ts";
import type { CanonicalEventIR } from "../../runtime/events/ir.ts";
import type { AthenaIngressIR } from "../../runtime/ingress/ir.ts";
import {
  type CanonicalBillingDocument,
  canonicalDocumentRevision,
  canonicalDocumentSubjectId,
} from "./document.ts";

export type CanonicalBillingEvent = CanonicalEventIR<
  CanonicalBillingEventName,
  CanonicalBillingDocument
>;

export class AthenaBillingIllegalTransitionError extends Error {
  readonly code = "ATHENA_BILLING_ILLEGAL_TRANSITION";

  constructor(previous: string, current: string) {
    super(
      `Canonical billing transition ${previous} → ${current} is not allowed.`
    );
    this.name = "AthenaBillingIllegalTransitionError";
  }
}

const PAYMENT_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  authorized: new Set(["authorized", "paid", "failed", "canceled"]),
  canceled: new Set(["canceled"]),
  failed: new Set(["failed"]),
  paid: new Set(["paid", "refunded", "canceled"]),
  pending: new Set(["pending", "authorized", "paid", "failed", "canceled"]),
  refunded: new Set(["refunded"]),
};

const SUBSCRIPTION_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  active: new Set(["active", "past_due", "canceled", "paused"]),
  canceled: new Set(["canceled"]),
  past_due: new Set(["past_due", "active", "canceled", "paused"]),
  paused: new Set(["paused", "active", "canceled"]),
  trialing: new Set(["trialing", "active", "past_due", "canceled", "paused"]),
};

const INVOICE_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  draft: new Set(["draft", "open", "void"]),
  open: new Set(["open", "paid", "void", "uncollectible"]),
  paid: new Set(["paid"]),
  uncollectible: new Set(["uncollectible"]),
  void: new Set(["void"]),
};

function allowedStatuses(
  kind: CanonicalBillingDocument["kind"],
  status: string
): ReadonlySet<string> | undefined {
  if (kind === "payment") {
    return PAYMENT_TRANSITIONS[status];
  }
  if (kind === "subscription") {
    return SUBSCRIPTION_TRANSITIONS[status];
  }
  return INVOICE_TRANSITIONS[status];
}

export function assertCanonicalBillingTransition(
  previous: CanonicalBillingDocument | null,
  current: CanonicalBillingDocument
): void {
  if (previous == null || previous.kind !== current.kind) {
    return;
  }
  const allowed = allowedStatuses(previous.kind, previous.status);
  if (allowed == null || !allowed.has(current.status)) {
    throw new AthenaBillingIllegalTransitionError(
      `${previous.kind}:${previous.status}`,
      `${current.kind}:${current.status}`
    );
  }
}

function eventNameForTransition(
  previous: CanonicalBillingDocument | null,
  current: CanonicalBillingDocument
): CanonicalBillingEventName | undefined {
  if (current.kind === "payment") {
    if (previous == null) {
      if (current.status === "paid") {
        return "billing.payment.paid";
      }
      if (current.status === "failed") {
        return "billing.payment.failed";
      }
      if (current.status === "canceled") {
        return "billing.payment.canceled";
      }
      if (current.status === "refunded") {
        return "billing.payment.refunded";
      }
      if (current.status === "pending") {
        return "billing.payment.pending";
      }
      return "billing.payment.created";
    }
    if (previous.kind === "payment" && previous.status === current.status) {
      return;
    }
    if (current.status === "paid") {
      return "billing.payment.paid";
    }
    if (current.status === "failed") {
      return "billing.payment.failed";
    }
    if (current.status === "canceled") {
      return "billing.payment.canceled";
    }
    if (current.status === "refunded") {
      return "billing.payment.refunded";
    }
    if (current.status === "pending") {
      return "billing.payment.pending";
    }
    return "billing.payment.created";
  }
  if (current.kind === "subscription") {
    if (current.status === "canceled") {
      return "billing.subscription.canceled";
    }
    if (current.status === "active") {
      return previous == null
        ? "billing.subscription.created"
        : "billing.subscription.active";
    }
    return previous == null ? "billing.subscription.created" : undefined;
  }
  if (current.status === "paid") {
    return "billing.invoice.paid";
  }
  return previous == null ? "billing.invoice.created" : undefined;
}

export function canonicalizeBillingEvents(input: {
  ingress: AthenaIngressIR;
  previous: CanonicalBillingDocument | null;
  current: CanonicalBillingDocument;
}): readonly CanonicalBillingEvent[] {
  const name = eventNameForTransition(input.previous, input.current);
  if (!name) {
    return [];
  }
  const revision = canonicalDocumentRevision(input.current);
  return [
    {
      causality: causalityFromIngress(input.ingress),
      id: deriveCanonicalEventId(
        [
          input.ingress.id,
          name,
          input.current.kind,
          canonicalDocumentSubjectId(input.current),
          input.current.status,
        ].join("\0")
      ),
      ingressId: input.ingress.id,
      name,
      observedAt: input.ingress.receivedAt,
      occurredAt: revision.providerUpdatedAt ?? input.ingress.receivedAt,
      payload: input.current,
      revision,
      source: {
        domain: "billing",
        provider:
          typeof input.current.provider === "string"
            ? input.current.provider
            : undefined,
      },
      subject: {
        id: canonicalDocumentSubjectId(input.current),
        type: input.current.kind,
      },
    },
  ];
}
