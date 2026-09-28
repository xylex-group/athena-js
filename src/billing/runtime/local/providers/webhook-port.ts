import type { AthenaIngressIR } from "../../../../runtime/ingress/ir.ts";
import type { CanonicalBillingDocument } from "../../../canonical/document.ts";
import type { CanonicalBillingEvent } from "../../../canonical/transition.ts";

export type BillingWebhookVerificationStrategy =
  | "authoritative_refetch"
  | "signature"
  | "signature_and_refetch";

export interface BillingProviderWebhookPort<TEnvelope, TResource> {
  canonicalizeEvents(context: {
    ingress: AthenaIngressIR;
    previous: CanonicalBillingDocument | null;
    current: CanonicalBillingDocument;
  }): readonly CanonicalBillingEvent[];
  parseIngress(ingress: AthenaIngressIR): Promise<TEnvelope> | TEnvelope;
  projectDocument(resource: TResource): CanonicalBillingDocument;
  providerEventIdBeforeRefetch?(envelope: TEnvelope): string | undefined;
  resolveAuthoritativeState(
    envelope: TEnvelope,
    ingress: AthenaIngressIR
  ): Promise<TResource>;
  resolveProviderEventId?(
    envelope: TEnvelope,
    document: CanonicalBillingDocument,
    ingress: AthenaIngressIR
  ): string;
  readonly verification: BillingWebhookVerificationStrategy;
  verifyIngress?(
    envelope: TEnvelope,
    ingress: AthenaIngressIR
  ): Promise<void> | void;
}
