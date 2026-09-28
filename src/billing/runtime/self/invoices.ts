import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import { billingSubjectNotFound } from "../../subject/errors.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingInvoice } from "../../types.ts";
import type { BillingPage } from "../types.ts";

export const SELF_LIST_LIMIT_DEFAULT = 50;
export const SELF_LIST_LIMIT_MAX = 100;

export function clampSelfListLimit(limit: unknown): number {
  const raw =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.trunc(limit)
      : SELF_LIST_LIMIT_DEFAULT;
  return Math.min(SELF_LIST_LIMIT_MAX, Math.max(1, raw));
}

const LIST_OWNED_INVOICES_SQL = `
SELECT *
FROM billing.billing_invoices
WHERE subject_kind = $1
  AND subject_id = $2
  AND ownership_status = 'resolved'
ORDER BY ingested_at DESC
LIMIT $3
`;

const GET_OWNED_INVOICE_SQL = `
SELECT *
FROM billing.billing_invoices
WHERE id = $1
  AND subject_kind = $2
  AND subject_id = $3
  AND ownership_status = 'resolved'
`;

function asInvoice(row: Record<string, unknown>): BillingInvoice {
  return {
    amount: {
      currency:
        typeof row.amount_currency === "string" ? row.amount_currency : "EUR",
      value: String(row.amount_value ?? "0"),
    },
    metadata: row.metadata ?? {},
    provider: row.provider === "stripe" ? "stripe" : "mollie",
    providerInvoiceId: String(row.provider_invoice_id ?? ""),
    raw: row.raw ?? {},
    status: String(row.status ?? "open"),
  } as BillingInvoice;
}

export async function listSelfInvoices(input: {
  limit?: number;
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<BillingPage<BillingInvoice>> {
  const result = await input.sql.query(LIST_OWNED_INVOICES_SQL, [
    "user",
    input.principal.userId,
    clampSelfListLimit(input.limit),
  ]);
  return { items: result.rows.map(asInvoice) };
}

export async function getSelfInvoice(input: {
  invoiceId: string;
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<BillingInvoice> {
  const result = await input.sql.query(GET_OWNED_INVOICE_SQL, [
    input.invoiceId,
    "user",
    input.principal.userId,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw billingSubjectNotFound();
  }
  return asInvoice(row);
}
