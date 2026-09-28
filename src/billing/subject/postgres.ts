import type { BillingSubjectRef } from "../types.ts";
import type {
  BillingSqlExecutor,
  BillingSubjectBindingRecord,
  BillingSubjectRepository,
} from "./repository.ts";

export function isBillingUniqueViolation(error: unknown): boolean {
  if (error == null || typeof error !== "object") {
    return false;
  }
  return (error as { code?: unknown }).code === "23505";
}

function asBinding(row: Record<string, unknown>): BillingSubjectBindingRecord {
  return {
    connectionId: String(row.connection_id),
    emailSnapshot:
      typeof row.email_snapshot === "string" ? row.email_snapshot : null,
    emailVerificationSource:
      row.email_verification_source === "athena-auth"
        ? "athena-auth"
        : null,
    verifiedEmailObservedAt:
      row.email_observed_at instanceof Date
        ? row.email_observed_at.toISOString()
        : typeof row.email_observed_at === "string"
          ? row.email_observed_at
          : null,
    id: String(row.id),
    isPrimary: row.is_primary === true,
    providerSubjectId: String(row.provider_subject_id),
    providerSubjectKind:
      row.provider_subject_kind === "recipient" ? "recipient" : "customer",
    reservationToken:
      typeof row.reservation_token === "string" ? row.reservation_token : null,
    source:
      row.source === "imported" || row.source === "reconciled"
        ? row.source
        : "created",
    status:
      row.status === "active" ||
      row.status === "conflict" ||
      row.status === "revoked"
        ? row.status
        : "pending",
    subjectId: String(row.subject_id),
    subjectKind: row.subject_kind === "organization" ? "organization" : "user",
  };
}

export function createPostgresBillingSubjectRepository(
  sql: BillingSqlExecutor
): BillingSubjectRepository {
  return {
    async activate(input) {
      const result = await sql.query(
        `UPDATE billing.billing_subject_bindings
				 SET provider_subject_id = $1,
				     status = 'active',
				     is_primary = true,
				     reservation_token = NULL,
				     reservation_expires_at = NULL
				 WHERE id = $2
				   AND status = 'pending'
				   AND ($3::text IS NULL OR reservation_token = $3)
				 RETURNING *`,
        [input.providerSubjectId, input.id, input.reservationToken ?? null]
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Failed to activate billing subject binding.");
      }
      return asBinding(row);
    },
    async getBinding(id) {
      const result = await sql.query(
        "SELECT * FROM billing.billing_subject_bindings WHERE id = $1",
        [id]
      );
      const row = result.rows[0];
      return row ? asBinding(row) : undefined;
    },
    async listActiveBindings(input) {
      const result = await sql.query(
        `SELECT * FROM billing.billing_subject_bindings
				 WHERE connection_id = $1
				   AND subject_kind = $2
				   AND subject_id = $3
				   AND status <> 'revoked'`,
        [input.connectionId, input.subject.kind, input.subject.id]
      );
      return result.rows.map(asBinding);
    },
    async reserve(input) {
      try {
        const result = await sql.query(
          `INSERT INTO billing.billing_subject_bindings (
						connection_id,
						subject_kind,
						subject_id,
						provider_subject_kind,
						provider_subject_id,
						status,
						source,
						is_primary,
						reservation_token,
						reservation_expires_at,
						lease_epoch,
						email_snapshot,
						email_verification_source,
						email_observed_at
					) VALUES ($1, $2, $3, $4, $5, 'pending', $6, false, $7, now() + interval '15 minutes', 1, $8, $9, $10::timestamptz)
					ON CONFLICT (connection_id, subject_kind, subject_id, provider_subject_kind)
						WHERE status IN ('pending', 'active')
					DO NOTHING
					RETURNING *`,
          [
            input.connectionId,
            input.subject.kind,
            input.subject.id,
            input.providerSubjectKind,
            input.providerSubjectId ?? `reserve:${input.subject.id}`,
            input.source,
            crypto.randomUUID(),
            input.contact?.email ?? null,
            input.contact?.source ?? null,
            input.contact?.verifiedEmailObservedAt ?? null,
          ]
        );
        const inserted = result.rows[0];
        if (inserted) {
          return { binding: asBinding(inserted), inserted: true };
        }
      } catch (error) {
        if (
          !isBillingUniqueViolation(error) &&
          (error as { code?: string }).code !== "42P10"
        ) {
          throw error;
        }
      }
      const reclaimed = await sql.query(
        `UPDATE billing.billing_subject_bindings
				 SET reservation_token = $5,
				     reservation_expires_at = now() + interval '15 minutes',
				     lease_epoch = lease_epoch + 1,
				     last_error = NULL,
				     attempt_count = attempt_count + 1
				 WHERE connection_id = $1
				   AND subject_kind = $2
				   AND subject_id = $3
				   AND provider_subject_kind = $4
				   AND status = 'pending'
				   AND reservation_expires_at IS NOT NULL
				   AND reservation_expires_at < now()
				 RETURNING *`,
        [
          input.connectionId,
          input.subject.kind,
          input.subject.id,
          input.providerSubjectKind,
          crypto.randomUUID(),
        ]
      );
      if (reclaimed.rows[0]) {
        return { binding: asBinding(reclaimed.rows[0]), inserted: true };
      }
      const existing = await sql.query(
        `SELECT * FROM billing.billing_subject_bindings
				 WHERE connection_id = $1
				   AND subject_kind = $2
				   AND subject_id = $3
				   AND provider_subject_kind = $4
				   AND status IN ('pending', 'active')
				 ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END
				 LIMIT 1`,
        [
          input.connectionId,
          input.subject.kind,
          input.subject.id,
          input.providerSubjectKind,
        ]
      );
      const row = existing.rows[0];
      if (!row) {
        throw new Error("Failed to reserve billing subject binding.");
      }
      return { binding: asBinding(row), inserted: false };
    },
    async recordContact(input) {
      const result = await sql.query(
        `UPDATE billing.billing_subject_bindings
         SET email_snapshot = $2,
             email_verification_source = $3,
             email_observed_at = $4::timestamptz,
             updated_at = now()
         WHERE id = $1
           AND subject_id = $5
           AND subject_kind = $6
             AND status IN ('active')
         RETURNING *`,
        [
          input.bindingId,
          input.contact.email,
          input.contact.source,
          input.contact.verifiedEmailObservedAt,
          input.contact.subjectId,
          "user",
        ],
      );
      const row = result.rows[0];
      return row ? asBinding(row) : undefined;
    },
  };
}

export function subjectFromPrincipalUser(userId: string): BillingSubjectRef {
  return { id: userId, kind: "user" };
}
