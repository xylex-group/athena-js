import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import { billingSubjectNotFound } from "../../subject/errors.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingPage, BillingSelfPaymentView } from "../types.ts";
import { clampSelfListLimit } from "./invoices.ts";

const LIST_OWNED_PAYMENTS_SQL = `
SELECT
  id,
  provider,
  provider_payment_id,
  status,
  amount_currency,
  amount_value,
  description,
  created_at,
  ingested_at,
  paid_at,
  metadata->>'priceId' AS price_id
FROM billing.billing_payments
WHERE subject_kind = $1
  AND subject_id = $2
  AND ownership_status = 'resolved'
ORDER BY ingested_at DESC
LIMIT $3
`;

const GET_OWNED_PAYMENT_SQL = `
SELECT
  id,
  provider,
  provider_payment_id,
  status,
  amount_currency,
  amount_value,
  description,
  created_at,
  ingested_at,
  paid_at,
  metadata->>'priceId' AS price_id
FROM billing.billing_payments
WHERE id = $1
  AND subject_kind = $2
  AND subject_id = $3
  AND ownership_status = 'resolved'
`;

function isoDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
}

export function asSelfPaymentView(
  row: Record<string, unknown>
): BillingSelfPaymentView {
  const createdAt =
    isoDate(row.created_at) ??
    isoDate(row.ingested_at) ??
    new Date(0).toISOString();
  const paidAt = isoDate(row.paid_at);
  const description =
    typeof row.description === "string" && row.description.trim().length > 0
      ? row.description
      : undefined;
  const metadata = row.metadata;
  const metadataPriceId =
    metadata != null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    typeof (metadata as { priceId?: unknown }).priceId === "string"
      ? (metadata as { priceId: string }).priceId
      : undefined;
  const priceId =
    typeof row.price_id === "string" && row.price_id.trim().length > 0
      ? row.price_id
      : metadataPriceId && metadataPriceId.trim().length > 0
        ? metadataPriceId
        : undefined;
  const reference =
    typeof row.provider_payment_id === "string" &&
    row.provider_payment_id.trim().length > 0
      ? row.provider_payment_id
      : undefined;
  return {
    amount: {
      currency:
        typeof row.amount_currency === "string" ? row.amount_currency : "EUR",
      value: String(row.amount_value ?? "0"),
    },
    createdAt,
    id: String(row.id ?? ""),
    provider: row.provider === "stripe" ? "stripe" : "mollie",
    status: String(row.status ?? "pending"),
    ...(description ? { description } : {}),
    ...(paidAt ? { paidAt } : {}),
    ...(priceId ? { priceId } : {}),
    ...(reference ? { reference } : {}),
  };
}

export async function listSelfPayments(input: {
  limit?: number;
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<BillingPage<BillingSelfPaymentView>> {
  const result = await input.sql.query(LIST_OWNED_PAYMENTS_SQL, [
    "user",
    input.principal.userId,
    clampSelfListLimit(input.limit),
  ]);
  return { items: result.rows.map(asSelfPaymentView) };
}

export async function getSelfPayment(input: {
  paymentId: string;
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<BillingSelfPaymentView> {
  const result = await input.sql.query(GET_OWNED_PAYMENT_SQL, [
    input.paymentId,
    "user",
    input.principal.userId,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw billingSubjectNotFound();
  }
  return asSelfPaymentView(row);
}
