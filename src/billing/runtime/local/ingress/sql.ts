import { createSqlCanonicalEventRepositories } from "../../../../runtime/events/sql.ts";
import {
  ATHENA_EVENT_INGRESS_FAILED,
  AthenaEventIngressError,
} from "../../../../runtime/ingress/errors.ts";
import type { CanonicalBillingDocument } from "../../../canonical/document.ts";
import type {
  BillingEventRepository,
  BillingIngressDocumentRepository,
  BillingOutboxRepository,
} from "./repository.ts";

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function requirePersistConnectionId(connectionId: string | undefined): string {
  if (connectionId == null || connectionId.length === 0) {
    throw new AthenaEventIngressError({
      code: ATHENA_EVENT_INGRESS_FAILED,
      domain: "billing",
      message:
        "Billing document persist requires a billing connection id (uniqueness is connection-scoped).",
      retryable: false,
    });
  }
  return connectionId;
}

export function createSqlBillingDocumentRepository(): BillingIngressDocumentRepository {
  return {
    async readCurrentForUpdate(tx, document, connectionId) {
      const boundConnectionId = requirePersistConnectionId(connectionId);
      if (document.kind === "payment") {
        const result = await tx.query<CanonicalBillingDocument>(
          `
SELECT 'payment' AS kind, provider, provider_payment_id AS "providerPaymentId",
  status, amount_currency, amount_value, created_at AS "createdAt", paid_at AS "paidAt"
FROM billing.billing_payments
WHERE connection_id = $1::uuid AND provider_payment_id = $2
FOR UPDATE
`,
          [boundConnectionId, document.providerPaymentId]
        );
        return result.rows[0] ?? null;
      }
      if (document.kind === "subscription") {
        const result = await tx.query<CanonicalBillingDocument>(
          `
SELECT 'subscription' AS kind, provider,
  provider_subscription_id AS "providerSubscriptionId", status
FROM billing.billing_subscriptions
WHERE connection_id = $1::uuid AND provider_subscription_id = $2
FOR UPDATE
`,
          [boundConnectionId, document.providerSubscriptionId]
        );
        return result.rows[0] ?? null;
      }
      const result = await tx.query<CanonicalBillingDocument>(
        `
SELECT 'invoice' AS kind, provider, provider_invoice_id AS "providerInvoiceId", status
FROM billing.billing_invoices
WHERE connection_id = $1::uuid AND provider_invoice_id = $2
FOR UPDATE
`,
        [boundConnectionId, document.providerInvoiceId]
      );
      return result.rows[0] ?? null;
    },
    async upsert(tx, document, connectionId) {
      const boundConnectionId = requirePersistConnectionId(connectionId);
      if (document.kind === "payment") {
        await tx.query(
          `
INSERT INTO billing.billing_payments (
  connection_id, provider, provider_payment_id, provider_customer_id, provider_profile_id,
  provider_subscription_id, provider_payment_link_id, status,
  amount_currency, amount_value, description, metadata, raw, paid_at, created_at
) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)
ON CONFLICT (connection_id, provider_payment_id) WHERE connection_id IS NOT NULL DO UPDATE SET
  status = EXCLUDED.status,
  amount_currency = EXCLUDED.amount_currency,
  amount_value = EXCLUDED.amount_value,
  metadata = EXCLUDED.metadata,
  raw = EXCLUDED.raw,
  paid_at = EXCLUDED.paid_at
`,
          [
            boundConnectionId,
            document.provider,
            document.providerPaymentId,
            document.providerCustomerId ?? null,
            document.providerProfileId ?? null,
            document.providerSubscriptionId ?? null,
            document.providerPaymentLinkId ?? null,
            document.status,
            document.amount.currency,
            document.amount.value,
            document.description ?? null,
            jsonValue(document.metadata),
            jsonValue(document.raw),
            document.paidAt ?? null,
            document.createdAt ?? null,
          ]
        );
        return;
      }
      if (document.kind === "subscription") {
        await tx.query(
          `
INSERT INTO billing.billing_subscriptions (
  connection_id, provider, provider_subscription_id, provider_customer_id, provider_profile_id,
  status, description, metadata, raw, created_at, canceled_at
) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
ON CONFLICT (connection_id, provider_subscription_id) WHERE connection_id IS NOT NULL DO UPDATE SET
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  raw = EXCLUDED.raw,
  canceled_at = EXCLUDED.canceled_at
`,
          [
            boundConnectionId,
            document.provider,
            document.providerSubscriptionId,
            document.providerCustomerId,
            document.providerProfileId ?? null,
            document.status,
            document.description ?? null,
            jsonValue(document.metadata),
            jsonValue(document.raw),
            document.createdAt ?? null,
            document.canceledAt ?? null,
          ]
        );
        return;
      }
      await tx.query(
        `
INSERT INTO billing.billing_invoices (
  connection_id, provider, provider_invoice_id, provider_profile_id, provider_customer_id,
  status, description, metadata, raw, paid_at, created_at
) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
ON CONFLICT (connection_id, provider_invoice_id) WHERE connection_id IS NOT NULL DO UPDATE SET
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  raw = EXCLUDED.raw,
  paid_at = EXCLUDED.paid_at
`,
        [
          boundConnectionId,
          document.provider,
          document.providerInvoiceId,
          document.providerProfileId ?? null,
          document.providerCustomerId ?? null,
          document.status,
          document.description ?? null,
          jsonValue(document.metadata),
          jsonValue(document.raw),
          document.paidAt ?? null,
          document.createdAt ?? null,
        ]
      );
    },
  };
}

export function createSqlBillingRepositories(): {
  documents: BillingIngressDocumentRepository;
  events: BillingEventRepository;
  outbox: BillingOutboxRepository;
} {
  const ledger = createSqlCanonicalEventRepositories();
  return {
    documents: createSqlBillingDocumentRepository(),
    events: ledger.events,
    outbox: ledger.outbox,
  };
}
