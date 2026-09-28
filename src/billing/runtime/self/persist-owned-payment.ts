import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import { AthenaBillingCapabilityError } from "../../errors.ts";
import { billingSubjectConflict } from "../../subject/errors.ts";
import { requireBillingPrincipalUserId } from "../../subject/principal-user.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import {
  requireReadyBillingConnectionId,
  resolveActiveBillingConnection,
} from "../../subject/sole-connection.ts";
import type { BillingPayment } from "../../types.ts";
import type { BillingSelfPaymentView } from "../types.ts";
import { asSelfPaymentView } from "./payments.ts";

const PERSIST_OWNED_PAYMENT_SQL = `
INSERT INTO billing.billing_payments (
	connection_id,
	provider,
	provider_payment_id,
	provider_customer_id,
	status,
	amount_currency,
	amount_value,
	description,
	metadata,
	raw,
	paid_at,
	created_at,
	subject_kind,
	subject_id,
	ownership_status
) VALUES (
	$1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, 'user', $13, 'resolved'
)
ON CONFLICT (connection_id, provider_payment_id) WHERE connection_id IS NOT NULL DO UPDATE SET
	status = EXCLUDED.status,
	amount_currency = EXCLUDED.amount_currency,
	amount_value = EXCLUDED.amount_value,
	description = EXCLUDED.description,
	metadata = EXCLUDED.metadata,
	raw = EXCLUDED.raw,
	paid_at = EXCLUDED.paid_at,
	subject_kind = EXCLUDED.subject_kind,
	subject_id = EXCLUDED.subject_id,
	ownership_status = 'resolved'
WHERE
	billing.billing_payments.ownership_status IS DISTINCT FROM 'resolved'
	OR (
		billing.billing_payments.subject_kind IS NOT DISTINCT FROM EXCLUDED.subject_kind
		AND billing.billing_payments.subject_id IS NOT DISTINCT FROM EXCLUDED.subject_id
	)
RETURNING *
`;

export async function persistOwnedPayment(input: {
  connectionId?: string | null;
  payment: BillingPayment;
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<BillingSelfPaymentView> {
  const connectionId =
    input.connectionId?.trim() ||
    requireReadyBillingConnectionId(
      await resolveActiveBillingConnection(input.sql),
      "self.checkout.resume"
    );
  if (connectionId.length === 0) {
    throw new AthenaBillingCapabilityError({
      operation: "self.checkout.resume",
      reason: "provider_connection_missing",
    });
  }
  const result = await input.sql.query(PERSIST_OWNED_PAYMENT_SQL, [
    connectionId,
    input.payment.provider,
    input.payment.providerPaymentId,
    input.payment.providerCustomerId ?? null,
    input.payment.status,
    input.payment.amount.currency,
    input.payment.amount.value,
    input.payment.description ?? null,
    JSON.stringify(input.payment.metadata ?? {}),
    JSON.stringify(input.payment.raw ?? {}),
    input.payment.paidAt ?? null,
    input.payment.createdAt ?? null,
    requireBillingPrincipalUserId(input.principal),
  ]);
  const row = result.rows[0];
  if (!row) {
    throw billingSubjectConflict(
      "This provider payment is already bound to another billing subject."
    );
  }
  return asSelfPaymentView(row);
}
