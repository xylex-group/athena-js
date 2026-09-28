import {
  ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID,
  ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID,
  AthenaEventIngressError,
} from "../../../../../runtime/ingress/errors.ts";
import { deriveIngressProviderEventId } from "../../../../../runtime/ingress/identity.ts";
import type { AthenaIngressIR } from "../../../../../runtime/ingress/ir.ts";
import {
  type CanonicalBillingDocument,
  canonicalDocumentRevision,
  canonicalDocumentSubjectId,
} from "../../../../canonical/document.ts";
import { canonicalizeBillingEvents } from "../../../../canonical/transition.ts";
import type {
  BillingProviderWebhookPort,
  BillingWebhookVerificationStrategy,
} from "../webhook-port.ts";
import {
  type MollieWebhookChannel,
  requireMollieWebhookChannel,
} from "./channel.ts";
import {
  classifyMollieWebhookBody,
  type MollieWebhookEnvelope,
  parseMollieWebhookForChannel,
} from "./parse-webhook.ts";
import { projectMollieResourceToCanonical } from "./project-document.ts";
import {
  MOLLIE_WEBHOOK_MAX_BODY_BYTES,
  verifyMollieWebhookSignature,
} from "./verify-webhook.ts";

export interface MollieWebhookResource {
  kind: "payment" | "subscription" | "invoice";
  raw: unknown;
}

export interface BillingWebhookResolution {
  provider: "mollie";
  providerEventId: string;
  resourceId: string;
  resourceKind: "payment" | "subscription" | "invoice";
}

export function mollieResourceKind(
  envelope: MollieWebhookEnvelope
): "payment" | "subscription" | "invoice" {
  if (envelope.kind === "classic") {
    return "payment";
  }
  if (
    envelope.eventType.startsWith("subscription.") ||
    envelope.resource === "subscription"
  ) {
    return "subscription";
  }
  if (
    envelope.eventType.startsWith("sales-invoice.") ||
    envelope.eventType.startsWith("invoice.") ||
    envelope.resource === "invoice"
  ) {
    return "invoice";
  }
  return "payment";
}

export function mollieEnvelopeResourceId(
  envelope: MollieWebhookEnvelope
): string {
  return envelope.kind === "classic" ? envelope.resourceId : envelope.entityId;
}

function signingSecretsForIngress(
  input: {
    resolveSigningSecrets?: (connectionId: string) => readonly string[];
    signingSecrets?: readonly string[];
  },
  connectionId: string | undefined
): readonly string[] {
  if (input.resolveSigningSecrets) {
    if (connectionId == null || connectionId.length === 0) {
      return [];
    }
    return input.resolveSigningSecrets(connectionId);
  }
  return input.signingSecrets ?? [];
}

function channelForIngress(ingress: AthenaIngressIR): MollieWebhookChannel {
  try {
    return requireMollieWebhookChannel(ingress.operation);
  } catch {
    throw new AthenaEventIngressError({
      code: ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID,
      diagnostics: classifyMollieWebhookBody(
        ingress.body,
        ingress.headers["content-type"]
      ),
      domain: "billing",
      message:
        "Mollie webhook channel must be bound from the route, not inferred from the body.",
      provider: "mollie",
      retryable: false,
    });
  }
}

export function mollieDeterministicEventId(input: {
  connectionId?: string;
  document: CanonicalBillingDocument;
}): string {
  const revision = canonicalDocumentRevision(input.document);
  return deriveIngressProviderEventId({
    authoritativeStateOrVersion: revision.sequence ?? input.document.status,
    connectionId: input.connectionId,
    provider: "mollie",
    resourceId: canonicalDocumentSubjectId(input.document),
    resourceKind: input.document.kind,
  });
}

export function resolveBillingWebhookResolution(input: {
  connectionId?: string;
  document: CanonicalBillingDocument;
  envelope: MollieWebhookEnvelope;
}): BillingWebhookResolution {
  const resourceKind = mollieResourceKind(input.envelope);
  const resourceId = mollieEnvelopeResourceId(input.envelope);
  const providerEventId =
    input.envelope.kind === "next_gen"
      ? input.envelope.eventId
      : mollieDeterministicEventId({
          document: input.document,
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
        });
  return {
    provider: "mollie",
    providerEventId,
    resourceId,
    resourceKind,
  };
}

export function createMollieWebhookPort(input: {
  signingSecrets?: readonly string[];
  resolveSigningSecrets?: (connectionId: string) => readonly string[];
  requireSignature?: boolean;
  verification?: BillingWebhookVerificationStrategy;
  resolveResource: (input: {
    connectionId?: string;
    kind: "payment" | "subscription" | "invoice";
    id: string;
  }) => Promise<unknown>;
}): BillingProviderWebhookPort<MollieWebhookEnvelope, MollieWebhookResource> {
  return {
    canonicalizeEvents(context) {
      return canonicalizeBillingEvents(context);
    },
    parseIngress(ingress: AthenaIngressIR): MollieWebhookEnvelope {
      if (ingress.body.byteLength > MOLLIE_WEBHOOK_MAX_BODY_BYTES) {
        throw new AthenaEventIngressError({
          code: ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID,
          diagnostics: classifyMollieWebhookBody(
            ingress.body,
            ingress.headers["content-type"]
          ),
          domain: "billing",
          message: "Mollie webhook payload exceeds size limit.",
          provider: "mollie",
          retryable: false,
        });
      }
      const channel = channelForIngress(ingress);
      return parseMollieWebhookForChannel(
        channel.kind,
        ingress.body,
        ingress.headers["content-type"]
      );
    },
    projectDocument(resource) {
      return projectMollieResourceToCanonical(resource.raw, resource.kind);
    },
    providerEventIdBeforeRefetch(envelope) {
      return envelope.kind === "next_gen" ? envelope.eventId : undefined;
    },
    async resolveAuthoritativeState(envelope, ingress) {
      if (input.verification === "signature") {
        throw new AthenaEventIngressError({
          code: ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID,
          domain: "billing",
          message:
            "Mollie ingest requires authoritative refetch; signature-only is not supported.",
          provider: "mollie",
          retryable: false,
        });
      }
      const kind = mollieResourceKind(envelope);
      const id = mollieEnvelopeResourceId(envelope);
      const raw = await input.resolveResource({
        id,
        kind,
        ...(ingress.connectionId ? { connectionId: ingress.connectionId } : {}),
      });
      return { kind, raw };
    },
    resolveProviderEventId(envelope, document, ingress) {
      return resolveBillingWebhookResolution({
        document,
        envelope,
        ...(ingress.connectionId ? { connectionId: ingress.connectionId } : {}),
      }).providerEventId;
    },
    verification: "signature_and_refetch",
    verifyIngress(envelope, ingress) {
      const channel = channelForIngress(ingress);
      if (channel.kind !== "next_gen" || envelope.kind !== "next_gen") {
        return;
      }
      const signature = ingress.headers["x-mollie-signature"];
      const signingSecrets = signingSecretsForIngress(
        input,
        ingress.connectionId
      );
      if (signingSecrets.length === 0) {
        throw new AthenaEventIngressError({
          code: ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID,
          domain: "billing",
          message:
            "Mollie next-gen webhook HMAC secret is not configured. Set billing.ingestion.webhooks.providers.mollie.nextGen.signingSecret to the webhook secret Mollie returned at create, or let automatic registration persist that secret.",
          provider: "mollie",
          retryable: false,
        });
      }
      if (
        !verifyMollieWebhookSignature({
          body: ingress.body,
          signatureHeader: signature,
          signingSecrets,
        })
      ) {
        throw new AthenaEventIngressError({
          code: ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID,
          domain: "billing",
          message: "Mollie webhook signature is invalid.",
          provider: "mollie",
          retryable: false,
        });
      }
    },
  };
}
