import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingWebhookKind } from "../types.ts";
import type { BillingWebhookReconciliationOutcome } from "./stages.ts";

export interface BillingWebhookDeliveryHealthRow {
  acceptedCount: number;
  connectionId: string;
  duplicateCount: number;
  kind: BillingWebhookKind;
  lastAcceptedAt?: Date;
  lastReceivedAt?: Date;
  lastReconciliationCompletedAt?: Date;
  lastReconciliationError?: string;
  lastReconciliationFailedAt?: Date;
  lastReconciliationOutcome?: BillingWebhookReconciliationOutcome;
  lastReconciliationStartedAt?: Date;
  lastRejectedAt?: Date;
  lastRejectionCode?: string;
  lastRejectionMessage?: string;
  rejectedCount: number;
}

export type BillingWebhookDeliveryEvent =
  | "received"
  | "accepted"
  | "rejected"
  | "duplicate";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: string | undefined): string | null {
  if (value == null || value.length === 0) {
    return null;
  }
  return UUID_RE.test(value) ? value : null;
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    return new Date(value);
  }
}

function mapRow(row: Record<string, unknown>): BillingWebhookDeliveryHealthRow {
  const lastReconciliationOutcome = row.last_reconciliation_outcome;
  return {
    acceptedCount: Number(row.accepted_count ?? 0),
    connectionId: String(row.connection_id),
    duplicateCount: Number(row.duplicate_count ?? 0),
    kind: row.kind === "classic" ? "classic" : "next_gen",
    rejectedCount: Number(row.rejected_count ?? 0),
    ...(asDate(row.last_received_at)
      ? { lastReceivedAt: asDate(row.last_received_at) }
      : {}),
    ...(asDate(row.last_accepted_at)
      ? { lastAcceptedAt: asDate(row.last_accepted_at) }
      : {}),
    ...(asDate(row.last_rejected_at)
      ? { lastRejectedAt: asDate(row.last_rejected_at) }
      : {}),
    ...(typeof row.last_rejection_code === "string"
      ? { lastRejectionCode: row.last_rejection_code }
      : {}),
    ...(typeof row.last_rejection_message === "string"
      ? { lastRejectionMessage: row.last_rejection_message }
      : {}),
    ...(asDate(row.last_reconciliation_started_at)
      ? {
          lastReconciliationStartedAt: asDate(
            row.last_reconciliation_started_at
          ),
        }
      : {}),
    ...(asDate(row.last_reconciliation_completed_at)
      ? {
          lastReconciliationCompletedAt: asDate(
            row.last_reconciliation_completed_at
          ),
        }
      : {}),
    ...(asDate(row.last_reconciliation_failed_at)
      ? {
          lastReconciliationFailedAt: asDate(row.last_reconciliation_failed_at),
        }
      : {}),
    ...(lastReconciliationOutcome === "completed" ||
    lastReconciliationOutcome === "failed" ||
    lastReconciliationOutcome === "skipped"
      ? { lastReconciliationOutcome }
      : {}),
    ...(typeof row.last_reconciliation_error === "string"
      ? { lastReconciliationError: row.last_reconciliation_error }
      : {}),
  };
}

export interface BillingWebhookDeliveryHealthStore {
  get(input: {
    connectionId: string;
    kind: BillingWebhookKind;
  }): Promise<BillingWebhookDeliveryHealthRow | null>;
  list(
    connectionId: string
  ): Promise<readonly BillingWebhookDeliveryHealthRow[]>;
  recordDelivery(input: {
    code?: string;
    connectionId: string;
    event: BillingWebhookDeliveryEvent;
    kind: BillingWebhookKind;
    message?: string;
  }): Promise<void>;
  recordReconciliation(input: {
    connectionId: string;
    error?: string;
    kind: BillingWebhookKind;
    outcome: BillingWebhookReconciliationOutcome;
    phase: "started" | "completed" | "failed";
  }): Promise<void>;
}

export function createMemoryBillingWebhookDeliveryHealthStore(): {
  rows: BillingWebhookDeliveryHealthRow[];
  store: BillingWebhookDeliveryHealthStore;
} {
  const rows: BillingWebhookDeliveryHealthRow[] = [];
  const find = (connectionId: string, kind: BillingWebhookKind) =>
    rows.find((row) => row.connectionId === connectionId && row.kind === kind);
  const ensure = (
    connectionId: string,
    kind: BillingWebhookKind
  ): BillingWebhookDeliveryHealthRow => {
    const existing = find(connectionId, kind);
    if (existing) {
      return existing;
    }
    const created: BillingWebhookDeliveryHealthRow = {
      acceptedCount: 0,
      connectionId,
      duplicateCount: 0,
      kind,
      rejectedCount: 0,
    };
    rows.push(created);
    return created;
  };
  return {
    rows,
    store: {
      async get(input) {
        return find(input.connectionId, input.kind) ?? null;
      },
      async list(connectionId) {
        return rows.filter((row) => row.connectionId === connectionId);
      },
      async recordDelivery(input) {
        const row = ensure(input.connectionId, input.kind);
        const now = new Date();
        row.lastReceivedAt = now;
        if (input.event === "accepted") {
          row.lastAcceptedAt = now;
          row.acceptedCount += 1;
        } else if (input.event === "duplicate") {
          row.lastAcceptedAt = now;
          row.duplicateCount += 1;
        } else if (input.event === "rejected") {
          row.lastRejectedAt = now;
          row.rejectedCount += 1;
          if (input.code) {
            row.lastRejectionCode = input.code;
          }
          if (input.message) {
            row.lastRejectionMessage = input.message;
          }
        }
      },
      async recordReconciliation(input) {
        const row = ensure(input.connectionId, input.kind);
        const now = new Date();
        row.lastReconciliationOutcome = input.outcome;
        if (input.phase === "started") {
          row.lastReconciliationStartedAt = now;
        } else if (input.phase === "completed") {
          row.lastReconciliationCompletedAt = now;
        } else {
          row.lastReconciliationFailedAt = now;
          if (input.error) {
            row.lastReconciliationError = input.error;
          }
        }
      },
    },
  };
}

export function createPostgresBillingWebhookDeliveryHealthStore(
  sql: BillingSqlExecutor
): BillingWebhookDeliveryHealthStore {
  return {
    async get(input) {
      const result = await sql.query(
        `
SELECT * FROM billing.billing_webhook_delivery_health
WHERE connection_id = $1::uuid AND kind = $2
`,
        [input.connectionId, input.kind]
      );
      const row = result.rows[0];
      return row ? mapRow(row) : null;
    },
    async list(connectionId) {
      const result = await sql.query(
        `
SELECT * FROM billing.billing_webhook_delivery_health
WHERE connection_id = $1::uuid
`,
        [connectionId]
      );
      return result.rows.map(mapRow);
    },
    async recordDelivery(input) {
      const connectionId = uuidOrNull(input.connectionId);
      if (!connectionId) {
        return;
      }
      await sql.query(
        `
INSERT INTO billing.billing_webhook_delivery_health (
	connection_id, kind, last_received_at, last_accepted_at, last_rejected_at,
	last_rejection_code, last_rejection_message, accepted_count, rejected_count, duplicate_count
) VALUES (
	$1::uuid, $2, now(),
	CASE WHEN $3 IN ('accepted', 'duplicate') THEN now() ELSE NULL END,
	CASE WHEN $3 = 'rejected' THEN now() ELSE NULL END,
	CASE WHEN $3 = 'rejected' THEN $4 ELSE NULL END,
	CASE WHEN $3 = 'rejected' THEN $5 ELSE NULL END,
	CASE WHEN $3 = 'accepted' THEN 1 ELSE 0 END,
	CASE WHEN $3 = 'rejected' THEN 1 ELSE 0 END,
	CASE WHEN $3 = 'duplicate' THEN 1 ELSE 0 END
)
ON CONFLICT (connection_id, kind) DO UPDATE SET
	last_received_at = now(),
	last_accepted_at = CASE
		WHEN $3 IN ('accepted', 'duplicate') THEN now()
		ELSE billing.billing_webhook_delivery_health.last_accepted_at
	END,
	last_rejected_at = CASE
		WHEN $3 = 'rejected' THEN now()
		ELSE billing.billing_webhook_delivery_health.last_rejected_at
	END,
	last_rejection_code = CASE
		WHEN $3 = 'rejected' THEN $4
		ELSE billing.billing_webhook_delivery_health.last_rejection_code
	END,
	last_rejection_message = CASE
		WHEN $3 = 'rejected' THEN $5
		ELSE billing.billing_webhook_delivery_health.last_rejection_message
	END,
	accepted_count = billing.billing_webhook_delivery_health.accepted_count
		+ CASE WHEN $3 = 'accepted' THEN 1 ELSE 0 END,
	rejected_count = billing.billing_webhook_delivery_health.rejected_count
		+ CASE WHEN $3 = 'rejected' THEN 1 ELSE 0 END,
	duplicate_count = billing.billing_webhook_delivery_health.duplicate_count
		+ CASE WHEN $3 = 'duplicate' THEN 1 ELSE 0 END,
	updated_at = now()
`,
        [
          connectionId,
          input.kind,
          input.event,
          input.code ?? null,
          input.message ?? null,
        ]
      );
    },
    async recordReconciliation(input) {
      const connectionId = uuidOrNull(input.connectionId);
      if (!connectionId) {
        return;
      }
      await sql.query(
        `
INSERT INTO billing.billing_webhook_delivery_health (
	connection_id, kind, last_reconciliation_started_at, last_reconciliation_completed_at,
	last_reconciliation_failed_at, last_reconciliation_outcome, last_reconciliation_error
) VALUES (
	$1::uuid, $2,
	CASE WHEN $3 = 'started' THEN now() ELSE NULL END,
	CASE WHEN $3 = 'completed' THEN now() ELSE NULL END,
	CASE WHEN $3 = 'failed' THEN now() ELSE NULL END,
	$4, $5
)
ON CONFLICT (connection_id, kind) DO UPDATE SET
	last_reconciliation_started_at = CASE
		WHEN $3 = 'started' THEN now()
		ELSE billing.billing_webhook_delivery_health.last_reconciliation_started_at
	END,
	last_reconciliation_completed_at = CASE
		WHEN $3 = 'completed' THEN now()
		ELSE billing.billing_webhook_delivery_health.last_reconciliation_completed_at
	END,
	last_reconciliation_failed_at = CASE
		WHEN $3 = 'failed' THEN now()
		ELSE billing.billing_webhook_delivery_health.last_reconciliation_failed_at
	END,
	last_reconciliation_outcome = $4,
	last_reconciliation_error = COALESCE($5, billing.billing_webhook_delivery_health.last_reconciliation_error),
	updated_at = now()
`,
        [
          connectionId,
          input.kind,
          input.phase,
          input.outcome,
          input.error ?? null,
        ]
      );
    },
  };
}
