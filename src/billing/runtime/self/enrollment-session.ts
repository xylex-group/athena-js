import { AthenaBillingCapabilityError } from "../../errors.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingProviderName } from "../../types.ts";

export type BillingCheckoutSessionStatus =
  | "first_payment_required"
  | "first_payment_paid"
  | "first_payment_failed"
  | "first_payment_canceled"
  | "enrolled"
  | "late_paid"
  | "reconcile_required"
  | "refund_required";

export type BillingCheckoutSessionKind = "one_off" | "subscription_enrollment";

export interface BillingCheckoutSessionRecord {
  checkoutUrl: string | null;
  connectionId?: string | null;
  createdAt: string;
  enrollmentId?: string | null;
  expiresAt?: string | null;
  id: string;
  idempotencyKey: string;
  kind?: BillingCheckoutSessionKind;
  metadata: Record<string, unknown>;
  priceId: string;
  provider: BillingProviderName;
  providerCustomerId: string | null;
  providerPaymentId: string | null;
  providerSubscriptionId: string | null;
  returnNonceHash?: string | null;
  status: BillingCheckoutSessionStatus;
  subjectId: string;
  subjectKind: "user" | "organization";
}

/** Resume of `first_payment_required` checkout URLs after this age is rejected. */
export const CHECKOUT_SESSION_RESUME_TTL_MS = 24 * 60 * 60 * 1000;

export function isCheckoutSessionResumeExpired(
  session: BillingCheckoutSessionRecord,
  now = Date.now()
): boolean {
  if (session.status !== "first_payment_required") {
    return false;
  }
  if (session.expiresAt != null && session.expiresAt.trim() !== "") {
    const expires = Date.parse(session.expiresAt);
    if (Number.isFinite(expires)) {
      return now > expires;
    }
  }
  const created = Date.parse(session.createdAt);
  if (!Number.isFinite(created)) {
    return true;
  }
  return now - created > CHECKOUT_SESSION_RESUME_TTL_MS;
}

export function checkoutAttemptExpiresAtIso(now = Date.now()): string {
  return new Date(now + CHECKOUT_SESSION_RESUME_TTL_MS).toISOString();
}

function createdAtIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date().toISOString();
}

function asStatus(value: unknown): BillingCheckoutSessionStatus {
  if (
    value === "first_payment_paid" ||
    value === "first_payment_failed" ||
    value === "first_payment_canceled" ||
    value === "enrolled" ||
    value === "late_paid" ||
    value === "reconcile_required" ||
    value === "refund_required"
  ) {
    return value;
  }
  return "first_payment_required";
}

function asKind(value: unknown): BillingCheckoutSessionKind {
  return value === "one_off" ? "one_off" : "subscription_enrollment";
}

function asRecord(row: Record<string, unknown>): BillingCheckoutSessionRecord {
  const metadata = row.metadata;
  return {
    checkoutUrl: typeof row.checkout_url === "string" ? row.checkout_url : null,
    connectionId:
      typeof row.connection_id === "string" ? row.connection_id : null,
    createdAt: createdAtIso(row.created_at),
    enrollmentId:
      typeof row.enrollment_id === "string" ? row.enrollment_id : null,
    expiresAt:
      row.expires_at instanceof Date
        ? row.expires_at.toISOString()
        : typeof row.expires_at === "string"
          ? row.expires_at
          : null,
    id: String(row.id ?? ""),
    idempotencyKey: String(row.idempotency_key ?? ""),
    kind: asKind(row.kind),
    metadata:
      metadata !== null &&
        typeof metadata === "object" &&
        !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
    priceId: String(row.price_id ?? ""),
    provider: row.provider === "stripe" ? "stripe" : "mollie",
    providerCustomerId:
      typeof row.provider_customer_id === "string"
        ? row.provider_customer_id
        : null,
    providerPaymentId:
      typeof row.provider_payment_id === "string"
        ? row.provider_payment_id
        : null,
    providerSubscriptionId:
      typeof row.provider_subscription_id === "string"
        ? row.provider_subscription_id
        : null,
    returnNonceHash:
      typeof row.return_nonce_hash === "string" ? row.return_nonce_hash : null,
    status: asStatus(row.status),
    subjectId: String(row.subject_id ?? ""),
    subjectKind: row.subject_kind === "organization" ? "organization" : "user",
  };
}

export interface BillingCheckoutSessionLineRecord {
  amountCurrency: string;
  amountValue: string;
  checkoutSessionId: string;
  id: string;
  interval: string | null;
  ordinal: number;
  priceId: string;
  productId: string;
  quantity: number;
  relationId: string | null;
}

export function billingSqlTransactionOrThrow(
  sql: BillingSqlExecutor
): NonNullable<BillingSqlExecutor["transaction"]> {
  const transaction = sql.transaction;
  if (typeof transaction !== "function") {
    throw new AthenaBillingCapabilityError({
      message:
        "self.checkout.create requires a transactional Billing SQL runtime.",
      operation: "self.checkout.create",
      reason: "runtime_unavailable",
    });
  }
  return transaction;
}

export async function requireBillingSqlTransaction<T>(
  sql: BillingSqlExecutor,
  fn: (sql: BillingSqlExecutor) => Promise<T>
): Promise<T> {
  return billingSqlTransactionOrThrow(sql)(fn);
}

const CHECKOUT_LINE_INSERT_COLUMNS = 8;

export async function insertCheckoutSessionLines(input: {
  checkoutSessionId: string;
  lines: readonly {
    amountCurrency: string;
    amountValue: string;
    interval?: string | null;
    ordinal: number;
    priceId: string;
    productId: string;
    quantity: number;
    relationId?: string;
  }[];
  sql: BillingSqlExecutor;
}): Promise<void> {
  if (input.lines.length === 0) {
    return;
  }
  const values = input.lines.map((_, index) => {
    const offset = index * CHECKOUT_LINE_INSERT_COLUMNS;
    return `(gen_random_uuid(), $1::uuid, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
  });
  const params: unknown[] = [
    input.checkoutSessionId,
    ...input.lines.flatMap((line) => [
      line.ordinal,
      line.productId,
      line.priceId,
      line.amountCurrency,
      line.amountValue,
      line.interval ?? null,
      line.quantity,
      line.relationId ?? null,
    ]),
  ];
  await input.sql.query(
    `INSERT INTO billing.billing_checkout_session_lines (
				id,
				checkout_session_id,
				ordinal,
				product_id,
				price_id,
				amount_currency,
				amount_value,
				interval,
				quantity,
				relation_id
			) VALUES ${values.join(", ")}
			ON CONFLICT (checkout_session_id, ordinal) DO NOTHING`,
    params
  );
}

function asLineRecord(
  row: Record<string, unknown>
): BillingCheckoutSessionLineRecord {
  return {
    amountCurrency: String(row.amount_currency ?? ""),
    amountValue: String(row.amount_value ?? ""),
    checkoutSessionId: String(row.checkout_session_id ?? ""),
    id: String(row.id ?? ""),
    interval: typeof row.interval === "string" ? row.interval : null,
    ordinal: Number(row.ordinal ?? 0),
    priceId: String(row.price_id ?? ""),
    productId: String(row.product_id ?? ""),
    quantity: Number(row.quantity ?? 1),
    relationId: typeof row.relation_id === "string" ? row.relation_id : null,
  };
}

export async function listCheckoutSessionLines(input: {
  checkoutSessionId: string;
  sql: BillingSqlExecutor;
}): Promise<readonly BillingCheckoutSessionLineRecord[]> {
  const result = await input.sql.query(
    `SELECT *
		 FROM billing.billing_checkout_session_lines
		 WHERE checkout_session_id = $1
		 ORDER BY ordinal ASC`,
    [input.checkoutSessionId]
  );
  return result.rows.map(asLineRecord);
}

export async function getCheckoutSessionByIdempotency(input: {
  idempotencyKey: string;
  sql: BillingSqlExecutor;
  subjectId: string;
  subjectKind: "user" | "organization";
}): Promise<BillingCheckoutSessionRecord | undefined> {
  const result = await input.sql.query(
    `SELECT * FROM billing.billing_checkout_sessions
		 WHERE subject_kind = $1
		   AND subject_id = $2
		   AND idempotency_key = $3
		 LIMIT 1`,
    [input.subjectKind, input.subjectId, input.idempotencyKey]
  );
  const row = result.rows[0];
  return row ? asRecord(row) : undefined;
}

export async function getCheckoutSessionByPayment(input: {
  provider: BillingProviderName;
  providerPaymentId: string;
  sql: BillingSqlExecutor;
}): Promise<BillingCheckoutSessionRecord | undefined> {
  const result = await input.sql.query(
    `SELECT * FROM billing.billing_checkout_sessions
		 WHERE provider = $1
		   AND provider_payment_id = $2
		 LIMIT 1`,
    [input.provider, input.providerPaymentId]
  );
  const row = result.rows[0];
  return row ? asRecord(row) : undefined;
}

export async function getCheckoutSessionByReturnNonce(input: {
  returnNonceHash: string;
  sql: BillingSqlExecutor;
  subjectId: string;
  subjectKind: "user" | "organization";
}): Promise<BillingCheckoutSessionRecord | undefined> {
  const result = await input.sql.query(
    `SELECT * FROM billing.billing_checkout_sessions
		 WHERE return_nonce_hash = $1
		   AND subject_kind = $2
		   AND subject_id = $3
		 LIMIT 1`,
    [input.returnNonceHash, input.subjectKind, input.subjectId]
  );
  const row = result.rows[0];
  return row ? asRecord(row) : undefined;
}

export async function listUsableMandateSessions(input: {
  providerCustomerId: string;
  sql: BillingSqlExecutor;
  subjectId: string;
  subjectKind: "user" | "organization";
}): Promise<readonly BillingCheckoutSessionRecord[]> {
  const result = await input.sql.query(
    `SELECT * FROM billing.billing_checkout_sessions
		 WHERE subject_kind = $1
		   AND subject_id = $2
		   AND provider_customer_id = $3
		   AND status IN ('enrolled', 'first_payment_paid')`,
    [input.subjectKind, input.subjectId, input.providerCustomerId]
  );
  return result.rows.map(asRecord);
}

export async function insertCheckoutSession(
  input: Omit<BillingCheckoutSessionRecord, "createdAt"> & {
    connectionId?: string | null;
    createdAt?: string;
    enrollmentId?: string | null;
    expiresAt?: string | null;
    kind?: BillingCheckoutSessionKind;
    returnNonceHash?: string | null;
    sql: BillingSqlExecutor;
  }
): Promise<BillingCheckoutSessionRecord> {
  const result = await input.sql.query(
    `INSERT INTO billing.billing_checkout_sessions (
			id,
			idempotency_key,
			subject_kind,
			subject_id,
			price_id,
			provider,
			provider_customer_id,
			provider_payment_id,
			provider_subscription_id,
			status,
			checkout_url,
			metadata,
			kind,
			connection_id,
			return_nonce_hash,
			expires_at,
			enrollment_id
		) VALUES (
			COALESCE($1::uuid, gen_random_uuid()),
			$2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
			$13, $14, $15, $16::timestamptz, $17::uuid
		)
		ON CONFLICT (subject_kind, subject_id, idempotency_key)
		DO UPDATE SET updated_at = billing.billing_checkout_sessions.updated_at
		RETURNING *`,
    [
      input.id.trim() === "" ? null : input.id,
      input.idempotencyKey,
      input.subjectKind,
      input.subjectId,
      input.priceId,
      input.provider,
      input.providerCustomerId,
      input.providerPaymentId,
      input.providerSubscriptionId,
      input.status,
      input.checkoutUrl,
      JSON.stringify(input.metadata),
      input.kind ?? "subscription_enrollment",
      input.connectionId ?? null,
      input.returnNonceHash ?? null,
      input.expiresAt ?? null,
      input.enrollmentId ?? null,
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to persist billing checkout session.");
  }
  return asRecord(row);
}

export const CHECKOUT_SESSION_ADVANCE_CLAIM = "__claiming__";

export async function claimCheckoutSessionForSubscriptionAdvance(input: {
  id: string;
  sql: BillingSqlExecutor;
}): Promise<BillingCheckoutSessionRecord | undefined> {
  const result = await input.sql.query(
    `UPDATE billing.billing_checkout_sessions
		 SET status = CASE
		       WHEN status = 'first_payment_required' THEN 'first_payment_paid'
		       ELSE status
		     END,
		     provider_subscription_id = $2,
		     updated_at = now()
		 WHERE id = $1
		   AND provider_subscription_id IS NULL
		   AND status IN ('first_payment_required', 'first_payment_paid')
		 RETURNING *`,
    [input.id, CHECKOUT_SESSION_ADVANCE_CLAIM]
  );
  const row = result.rows[0];
  return row ? asRecord(row) : undefined;
}

export async function releaseCheckoutSessionAdvanceClaim(input: {
  id: string;
  sql: BillingSqlExecutor;
}): Promise<void> {
  await input.sql.query(
    `UPDATE billing.billing_checkout_sessions
		 SET provider_subscription_id = NULL,
		     updated_at = now()
		 WHERE id = $1
		   AND provider_subscription_id = $2`,
    [input.id, CHECKOUT_SESSION_ADVANCE_CLAIM]
  );
}

export async function updateCheckoutSession(input: {
  id: string;
  sql: BillingSqlExecutor;
  checkoutUrl?: string | null;
  enrollmentId?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
  providerCustomerId?: string | null;
  providerPaymentId?: string | null;
  providerSubscriptionId?: string | null;
  returnNonceHash?: string | null;
  status: BillingCheckoutSessionStatus;
}): Promise<BillingCheckoutSessionRecord> {
  const result = await input.sql.query(
    `UPDATE billing.billing_checkout_sessions
		 SET status = $2,
		     checkout_url = COALESCE($3, checkout_url),
		     provider_customer_id = COALESCE($4, provider_customer_id),
		     provider_payment_id = COALESCE($5, provider_payment_id),
		     provider_subscription_id = COALESCE($6, provider_subscription_id),
		     return_nonce_hash = COALESCE($7, return_nonce_hash),
		     expires_at = COALESCE($8::timestamptz, expires_at),
		     enrollment_id = COALESCE($9::uuid, enrollment_id),
		     metadata = CASE
		       WHEN $10::jsonb IS NULL THEN metadata
		       ELSE metadata || $10::jsonb
		     END,
		     updated_at = now()
		 WHERE id = $1
		 RETURNING *`,
    [
      input.id,
      input.status,
      input.checkoutUrl,
      input.providerCustomerId,
      input.providerPaymentId,
      input.providerSubscriptionId,
      input.returnNonceHash,
      input.expiresAt,
      input.enrollmentId ?? null,
      input.metadata == null ? null : JSON.stringify(input.metadata),
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to update billing checkout session.");
  }
  return asRecord(row);
}
