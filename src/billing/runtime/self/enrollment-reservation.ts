import { randomUUID } from "node:crypto";
import { billingSubscriptionAlreadyActive } from "../../subject/errors.ts";
import { isBillingUniqueViolation } from "../../subject/postgres.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";

export const LIVE_ENROLLMENT_STATES = [
  "reserved",
  "first_payment_pending",
  "advancing",
  "active",
] as const;

export const CLAIMABLE_ENROLLMENT_STATES = [
  "reserved",
  "first_payment_pending",
  "advancing",
] as const;

export type BillingEnrollmentState =
  | "reserved"
  | "first_payment_pending"
  | "advancing"
  | "active"
  | "failed"
  | "canceled"
  | "expired"
  | "superseded";

export interface BillingSubscriptionEnrollmentRecord {
  attemptCount: number;
  connectionId: string;
  fencingEpoch: number;
  id: string;
  idempotencyKey: string;
  journalIntent: string | null;
  lastError: string | null;
  leaseExpiresAt: string | null;
  leaseToken: string | null;
  priceId: string;
  providerIdempotencyKey: string | null;
  providerPaymentId: string | null;
  providerSubscriptionId: string | null;
  state: BillingEnrollmentState;
  subjectId: string;
  subjectKind: "user" | "organization";
}

const LIVE_LIST = LIVE_ENROLLMENT_STATES.map((state) => `'${state}'`).join(
  ", "
);

export function enrollmentProviderEffectIdempotencyKey(
  enrollment: Pick<
    BillingSubscriptionEnrollmentRecord,
    "idempotencyKey" | "providerIdempotencyKey"
  >
): string {
  return enrollment.providerIdempotencyKey ?? enrollment.idempotencyKey;
}

function asState(value: unknown): BillingEnrollmentState {
  switch (value) {
    case "reserved":
    case "first_payment_pending":
    case "advancing":
    case "active":
    case "failed":
    case "canceled":
    case "expired":
    case "superseded":
      return value;
    default:
      return "reserved";
  }
}

function asRecord(
  row: Record<string, unknown>
): BillingSubscriptionEnrollmentRecord {
  return {
    attemptCount: Number(row.attempt_count ?? 0),
    connectionId: String(row.connection_id),
    fencingEpoch: Number(row.fencing_epoch ?? 0),
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    journalIntent:
      typeof row.journal_intent === "string" ? row.journal_intent : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    leaseExpiresAt:
      row.lease_expires_at instanceof Date
        ? row.lease_expires_at.toISOString()
        : typeof row.lease_expires_at === "string"
          ? row.lease_expires_at
          : null,
    leaseToken: typeof row.lease_token === "string" ? row.lease_token : null,
    priceId: String(row.price_id),
    providerIdempotencyKey:
      typeof row.provider_idempotency_key === "string"
        ? row.provider_idempotency_key
        : null,
    providerPaymentId:
      typeof row.provider_payment_id === "string"
        ? row.provider_payment_id
        : null,
    providerSubscriptionId:
      typeof row.provider_subscription_id === "string"
        ? row.provider_subscription_id
        : null,
    state: asState(row.state),
    subjectId: String(row.subject_id),
    subjectKind: row.subject_kind === "organization" ? "organization" : "user",
  };
}

export async function getEnrollmentById(input: {
  id: string;
  sql: BillingSqlExecutor;
}): Promise<BillingSubscriptionEnrollmentRecord | undefined> {
  const result = await input.sql.query(
    `SELECT *
		 FROM billing.billing_subscription_enrollments
		 WHERE id = $1
		 LIMIT 1`,
    [input.id]
  );
  const row = result.rows[0];
  return row ? asRecord(row) : undefined;
}

export async function getLiveEnrollmentForSubject(input: {
  sql: BillingSqlExecutor;
  subjectId: string;
  subjectKind: "user" | "organization";
}): Promise<BillingSubscriptionEnrollmentRecord | undefined> {
  const result = await input.sql.query(
    `SELECT *
		 FROM billing.billing_subscription_enrollments
		 WHERE subject_kind = $1
		   AND subject_id = $2
		   AND state IN (${LIVE_LIST})
		 LIMIT 1`,
    [input.subjectKind, input.subjectId]
  );
  const row = result.rows[0];
  return row ? asRecord(row) : undefined;
}

export async function expireStaleReservations(input: {
  sql: BillingSqlExecutor;
  subjectId: string;
  subjectKind: "user" | "organization";
}): Promise<void> {
  await input.sql.query(
    `UPDATE billing.billing_subscription_enrollments
		 SET state = 'expired',
		     updated_at = now()
		 WHERE subject_kind = $1
		   AND subject_id = $2
		   AND state = 'reserved'
		   AND lease_expires_at IS NOT NULL
		   AND lease_expires_at < now()`,
    [input.subjectKind, input.subjectId]
  );
}

export async function reserveSubjectEnrollment(input: {
  connectionId: string;
  idempotencyKey: string;
  priceId: string;
  sql: BillingSqlExecutor;
  subjectId: string;
  subjectKind: "user" | "organization";
}): Promise<BillingSubscriptionEnrollmentRecord> {
  await expireStaleReservations(input);
  const existing = await getLiveEnrollmentForSubject(input);
  if (existing) {
    if (existing.idempotencyKey === input.idempotencyKey) {
      return existing;
    }
    throw billingSubscriptionAlreadyActive();
  }
  const id = randomUUID();
  try {
    const result = await input.sql.query(
      `INSERT INTO billing.billing_subscription_enrollments (
				id,
				connection_id,
				subject_kind,
				subject_id,
				price_id,
				idempotency_key,
				state,
				provider_idempotency_key,
				fencing_epoch
			) VALUES (
				$1::uuid, $2::uuid, $3, $4, $5, $6, 'reserved', $1::text, 0
			)
			RETURNING *`,
      [
        id,
        input.connectionId,
        input.subjectKind,
        input.subjectId,
        input.priceId,
        input.idempotencyKey,
      ]
    );
    const row = result.rows[0];
    if (row) {
      return asRecord(row);
    }
  } catch (error) {
    if (!isBillingUniqueViolation(error)) {
      throw error;
    }
    const raced = await getLiveEnrollmentForSubject(input);
    if (raced && raced.idempotencyKey === input.idempotencyKey) {
      return raced;
    }
    throw billingSubscriptionAlreadyActive();
  }
  throw billingSubscriptionAlreadyActive();
}

export async function ensureActiveCoordinatorForSubscription(input: {
  connectionId: string;
  idempotencyKey: string;
  priceId: string;
  providerSubscriptionId: string;
  sql: BillingSqlExecutor;
  subjectId: string;
  subjectKind: "user" | "organization";
}): Promise<BillingSubscriptionEnrollmentRecord> {
  const live = await getLiveEnrollmentForSubject(input);
  if (live) {
    return live;
  }
  const id = randomUUID();
  try {
    const result = await input.sql.query(
      `INSERT INTO billing.billing_subscription_enrollments (
				id,
				connection_id,
				subject_kind,
				subject_id,
				price_id,
				idempotency_key,
				state,
				provider_subscription_id,
				provider_idempotency_key,
				fencing_epoch
			) VALUES (
				$1::uuid, $2::uuid, $3, $4, $5, $6, 'active', $7, $1::text, 0
			)
			RETURNING *`,
      [
        id,
        input.connectionId,
        input.subjectKind,
        input.subjectId,
        input.priceId,
        input.idempotencyKey,
        input.providerSubscriptionId,
      ]
    );
    const row = result.rows[0];
    if (row) {
      return asRecord(row);
    }
  } catch (error) {
    if (!isBillingUniqueViolation(error)) {
      throw error;
    }
    const raced = await getLiveEnrollmentForSubject(input);
    if (raced) {
      return raced;
    }
  }
  throw billingSubscriptionAlreadyActive();
}

export async function updateEnrollment(input: {
  expectedFencingEpoch?: number;
  expectedLeaseToken?: string | null;
  expectedState?: BillingEnrollmentState;
  id: string;
  journalIntent?: string | null;
  lastError?: string | null;
  providerPaymentId?: string | null;
  providerSubscriptionId?: string | null;
  sql: BillingSqlExecutor;
  state?: BillingEnrollmentState;
}): Promise<BillingSubscriptionEnrollmentRecord | undefined> {
  const result = await input.sql.query(
    `UPDATE billing.billing_subscription_enrollments
		 SET state = COALESCE($2, state),
		     provider_payment_id = COALESCE($3, provider_payment_id),
		     provider_subscription_id = COALESCE($4, provider_subscription_id),
		     journal_intent = COALESCE($5, journal_intent),
		     last_error = COALESCE($6, last_error),
		     updated_at = now()
		 WHERE id = $1
		   AND ($7::text IS NULL OR state = $7)
		   AND ($8::integer IS NULL OR fencing_epoch = $8)
		   AND ($9::text IS NULL OR lease_token = $9)
		 RETURNING *`,
    [
      input.id,
      input.state ?? null,
      input.providerPaymentId ?? null,
      input.providerSubscriptionId ?? null,
      input.journalIntent ?? null,
      input.lastError ?? null,
      input.expectedState ?? null,
      input.expectedFencingEpoch ?? null,
      input.expectedLeaseToken ?? null,
    ]
  );
  const row = result.rows[0];
  return row ? asRecord(row) : undefined;
}

export async function claimEnrollmentForAdvance(input: {
  id: string;
  leaseToken: string;
  sql: BillingSqlExecutor;
}): Promise<BillingSubscriptionEnrollmentRecord | undefined> {
  const result = await input.sql.query(
    `UPDATE billing.billing_subscription_enrollments
		 SET state = 'advancing',
		     lease_token = $2,
		     lease_expires_at = now() + interval '30 seconds',
		     fencing_epoch = fencing_epoch + 1,
		     attempt_count = attempt_count + 1,
		     updated_at = now()
		 WHERE id = $1
		   AND (
		     state IN ('reserved', 'first_payment_pending')
		     OR (
		       state = 'advancing'
		       AND lease_expires_at IS NOT NULL
		       AND lease_expires_at < now()
		     )
		   )
		   AND (
		     lease_expires_at IS NULL
		     OR lease_expires_at < now()
		     OR lease_token = $2
		   )
		 RETURNING *`,
    [input.id, input.leaseToken]
  );
  const row = result.rows[0];
  return row ? asRecord(row) : undefined;
}

export async function heartbeatEnrollmentLease(input: {
  id: string;
  leaseToken: string;
  sql: BillingSqlExecutor;
}): Promise<boolean> {
  const result = await input.sql.query(
    `UPDATE billing.billing_subscription_enrollments
		 SET lease_expires_at = now() + interval '30 seconds',
		     updated_at = now()
		 WHERE id = $1
		   AND lease_token = $2
		   AND state = 'advancing'
		 RETURNING id`,
    [input.id, input.leaseToken]
  );
  return result.rows[0] != null;
}

export async function markEnrollmentActive(input: {
  expectedFencingEpoch?: number;
  expectedLeaseToken?: string | null;
  id: string;
  providerSubscriptionId: string;
  sql: BillingSqlExecutor;
}): Promise<boolean> {
  const result = await input.sql.query(
    `UPDATE billing.billing_subscription_enrollments
		 SET state = 'active',
		     provider_subscription_id = $2,
		     journal_intent = 'subscription_persisted',
		     lease_token = NULL,
		     lease_expires_at = NULL,
		     last_error = NULL,
		     updated_at = now()
		 WHERE id = $1
		   AND state IN ('reserved', 'first_payment_pending', 'advancing')
		   AND ($3::integer IS NULL OR fencing_epoch = $3)
		   AND ($4::text IS NULL OR lease_token = $4)
		   AND (
		     state IN ('reserved', 'first_payment_pending')
		     OR lease_expires_at IS NULL
		     OR lease_expires_at >= now()
		   )
		 RETURNING id`,
    [
      input.id,
      input.providerSubscriptionId,
      input.expectedFencingEpoch ?? null,
      input.expectedLeaseToken ?? null,
    ]
  );
  return result.rows[0] != null;
}

export async function recordEnrollmentJournal(input: {
  id: string;
  intent: string;
  sql: BillingSqlExecutor;
}): Promise<void> {
  await input.sql.query(
    `UPDATE billing.billing_subscription_enrollments
		 SET journal_intent = $2,
		     updated_at = now()
		 WHERE id = $1`,
    [input.id, input.intent]
  );
}

export async function recordEnrollmentAdvanceFailure(input: {
  expectedLeaseToken?: string;
  id: string;
  lastError: string;
  sql: BillingSqlExecutor;
}): Promise<void> {
  await input.sql.query(
    `UPDATE billing.billing_subscription_enrollments
		 SET last_error = $2,
		     updated_at = now()
		 WHERE id = $1
		   AND state = 'advancing'
		   AND ($3::text IS NULL OR lease_token = $3)`,
    [input.id, input.lastError, input.expectedLeaseToken ?? null]
  );
}
