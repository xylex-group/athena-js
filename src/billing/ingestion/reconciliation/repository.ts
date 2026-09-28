import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingWebhookRegistrationRecord } from "./types.ts";
import {
  BILLING_WEBHOOK_REGISTRATION_LIFECYCLE_STATES,
  type BillingWebhookRegistrationLifecycleState,
} from "./lifecycle.ts";
import type { BillingWebhookReconciliationState } from "./types.ts";

export interface BillingWebhookRegistrationStore {
  get(input: {
    connectionId: string;
    kind: BillingWebhookRegistrationRecord["kind"];
  }): Promise<BillingWebhookRegistrationRecord | null>;
  list(
    connectionId: string
  ): Promise<readonly BillingWebhookRegistrationRecord[]>;
  touchLastDelivery(input: {
    connectionId: string;
    kind: BillingWebhookRegistrationRecord["kind"];
  }): Promise<void>;
  upsert(record: BillingWebhookRegistrationRecord): Promise<void>;
}

export function createMemoryBillingWebhookRegistrationStore(): {
  rows: BillingWebhookRegistrationRecord[];
  store: BillingWebhookRegistrationStore;
} {
  const rows: BillingWebhookRegistrationRecord[] = [];
  return {
    rows,
    store: {
      async get(input) {
        return (
          rows.find(
            (row) =>
              row.connectionId === input.connectionId && row.kind === input.kind
          ) ?? null
        );
      },
      async list(connectionId) {
        return rows.filter((row) => row.connectionId === connectionId);
      },
      async touchLastDelivery(input) {
        const row = rows.find(
          (entry) =>
            entry.connectionId === input.connectionId &&
            entry.kind === input.kind
        );
        if (row) {
          row.lastDeliveryAt = new Date();
        }
      },
      async upsert(record) {
        const index = rows.findIndex(
          (row) =>
            row.connectionId === record.connectionId && row.kind === record.kind
        );
        if (index >= 0) {
          rows[index] = record;
          return;
        }
        rows.push(record);
      },
    },
  };
}

export function createPostgresBillingWebhookRegistrationStore(
  sql: BillingSqlExecutor
): BillingWebhookRegistrationStore {
  return {
    async get(input) {
      const result = await sql.query(
        `
SELECT * FROM billing.billing_webhook_registrations
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
SELECT * FROM billing.billing_webhook_registrations
WHERE connection_id = $1::uuid
`,
        [connectionId]
      );
      return result.rows.map(mapRow);
    },
    async touchLastDelivery(input) {
      await sql.query(
        `
UPDATE billing.billing_webhook_registrations
SET last_delivery_at = now(), updated_at = now()
WHERE connection_id = $1::uuid AND kind = $2
`,
        [input.connectionId, input.kind]
      );
    },
    async upsert(record) {
      await sql.query(
        `
INSERT INTO billing.billing_webhook_registrations (
	id, connection_id, provider, provider_webhook_id, kind, environment,
	name, url, event_types, status, config_hash, secret_version, secret_fingerprint,
	last_reconciled_at, last_verified_at, last_delivery_at, last_error, metadata,
	provider_registration_idempotency_key, provider_registration_attempts,
	secret_persistence_attempts, activation_attempts, last_provider_evidence,
	lifecycle_error, lifecycle_updated_at, reconciliation_state, created_at, updated_at
) VALUES (
	$1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13,
	$14, $15, $16, $17::jsonb, $18::jsonb, $19, $20, $21, $22, $23::jsonb,
	$24::jsonb, $25, $26, now(), now()
)
	ON CONFLICT (connection_id, kind) DO UPDATE SET
	provider_webhook_id = EXCLUDED.provider_webhook_id,
	name = EXCLUDED.name,
	url = EXCLUDED.url,
	event_types = EXCLUDED.event_types,
	status = EXCLUDED.status,
	config_hash = EXCLUDED.config_hash,
	secret_version = EXCLUDED.secret_version,
	secret_fingerprint = EXCLUDED.secret_fingerprint,
	last_reconciled_at = EXCLUDED.last_reconciled_at,
	last_verified_at = EXCLUDED.last_verified_at,
	last_error = EXCLUDED.last_error,
	metadata = EXCLUDED.metadata,
	provider_registration_idempotency_key = EXCLUDED.provider_registration_idempotency_key,
	provider_registration_attempts = EXCLUDED.provider_registration_attempts,
	secret_persistence_attempts = EXCLUDED.secret_persistence_attempts,
	activation_attempts = EXCLUDED.activation_attempts,
	last_provider_evidence = EXCLUDED.last_provider_evidence,
	lifecycle_error = EXCLUDED.lifecycle_error,
	lifecycle_updated_at = EXCLUDED.lifecycle_updated_at,
	reconciliation_state = EXCLUDED.reconciliation_state,
	updated_at = now()
`,
        [
          record.id,
          record.connectionId,
          record.provider,
          record.providerWebhookId ?? null,
          record.kind,
          record.environment,
          record.name,
          record.url,
          JSON.stringify(record.eventTypes),
          record.status,
          record.configHash,
          record.secretVersion ?? null,
          record.secretFingerprint ?? null,
          record.lastReconciledAt ?? new Date(),
          record.lastVerifiedAt ?? null,
          record.lastDeliveryAt ?? null,
          JSON.stringify(record.lastError ?? null),
          JSON.stringify({}),
          record.providerRegistrationIdempotencyKey ?? null,
          record.providerRegistrationAttempts ?? 0,
          record.secretPersistenceAttempts ?? 0,
          record.activationAttempts ?? 0,
          JSON.stringify(record.lastProviderEvidence ?? null),
          JSON.stringify(record.lifecycleError ?? null),
          record.lifecycleUpdatedAt ?? new Date(),
          record.reconciliationState ?? null,
        ]
      );
    },
  };
}

function mapRow(
  row: Record<string, unknown>
): BillingWebhookRegistrationRecord {
  const eventTypes = Array.isArray(row.event_types)
    ? row.event_types.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];
  return {
    configHash: String(row.config_hash ?? ""),
    connectionId: String(row.connection_id),
    environment: row.environment === "live" ? "live" : "test",
    eventTypes,
    id: String(row.id),
    kind: row.kind === "classic" ? "classic" : "next_gen",
    name: String(row.name ?? ""),
    provider: String(row.provider),
    ...(typeof row.provider_webhook_id === "string"
      ? { providerWebhookId: row.provider_webhook_id }
      : {}),
    status:
      (row.status as BillingWebhookRegistrationRecord["status"]) ?? "pending",
    url: String(row.url ?? ""),
    ...(reconciliationState(row.reconciliation_state)
      ? { reconciliationState: reconciliationState(row.reconciliation_state) }
      : {}),
    ...(typeof row.secret_fingerprint === "string"
      ? { secretFingerprint: row.secret_fingerprint }
      : {}),
    ...(typeof row.secret_version === "number"
      ? { secretVersion: row.secret_version }
      : {}),
    ...(typeof row.provider_registration_idempotency_key === "string"
      ? {
          providerRegistrationIdempotencyKey:
            row.provider_registration_idempotency_key,
        }
      : {}),
    ...(typeof row.provider_registration_attempts === "number"
      ? { providerRegistrationAttempts: row.provider_registration_attempts }
      : {}),
    ...(typeof row.secret_persistence_attempts === "number"
      ? { secretPersistenceAttempts: row.secret_persistence_attempts }
      : {}),
    ...(typeof row.activation_attempts === "number"
      ? { activationAttempts: row.activation_attempts }
      : {}),
    ...(row.last_provider_evidence !== null &&
    row.last_provider_evidence !== undefined
      ? { lastProviderEvidence: row.last_provider_evidence }
      : {}),
    ...(row.lifecycle_error !== null && row.lifecycle_error !== undefined
      ? { lifecycleError: row.lifecycle_error }
      : {}),
    ...(row.lifecycle_updated_at instanceof Date
      ? { lifecycleUpdatedAt: row.lifecycle_updated_at }
      : typeof row.lifecycle_updated_at === "string"
        ? { lifecycleUpdatedAt: new Date(row.lifecycle_updated_at) }
        : {}),
    ...(row.last_verified_at instanceof Date
      ? { lastVerifiedAt: row.last_verified_at }
      : typeof row.last_verified_at === "string"
        ? { lastVerifiedAt: new Date(row.last_verified_at) }
        : {}),
    ...(row.last_delivery_at instanceof Date
      ? { lastDeliveryAt: row.last_delivery_at }
      : typeof row.last_delivery_at === "string"
        ? { lastDeliveryAt: new Date(row.last_delivery_at) }
        : {}),
    ...(row.last_reconciled_at instanceof Date
      ? { lastReconciledAt: row.last_reconciled_at }
      : typeof row.last_reconciled_at === "string"
        ? { lastReconciledAt: new Date(row.last_reconciled_at) }
        : {}),
    ...(row.last_accepted_at instanceof Date
      ? { lastAcceptedAt: row.last_accepted_at }
      : typeof row.last_accepted_at === "string"
        ? { lastAcceptedAt: new Date(row.last_accepted_at) }
        : {}),
    ...(row.last_rejected_at instanceof Date
      ? { lastRejectedAt: row.last_rejected_at }
      : typeof row.last_rejected_at === "string"
        ? { lastRejectedAt: new Date(row.last_rejected_at) }
        : {}),
    ...(typeof row.last_rejection_code === "string"
      ? { lastRejectionCode: row.last_rejection_code }
      : {}),
    ...(row.last_reconciliation_outcome === "completed" ||
    row.last_reconciliation_outcome === "failed" ||
    row.last_reconciliation_outcome === "skipped"
      ? { lastReconciliationOutcome: row.last_reconciliation_outcome }
      : {}),
    ...(typeof row.last_ingress_stage === "string"
      ? { lastIngressStage: row.last_ingress_stage }
      : {}),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
  };
}

const LEGACY_RECONCILIATION_STATES = [
  "create_pending",
  "remote_created_secret_pending",
  "rotation_required",
  "update_pending",
] as const;

function reconciliationState(
  value: unknown
): BillingWebhookReconciliationState | undefined {
  if (typeof value !== "string") {
    return;
  }
  if (
    (
      BILLING_WEBHOOK_REGISTRATION_LIFECYCLE_STATES as readonly string[]
    ).includes(value) ||
    (LEGACY_RECONCILIATION_STATES as readonly string[]).includes(value)
  ) {
    return value as
      | BillingWebhookRegistrationLifecycleState
      | (typeof LEGACY_RECONCILIATION_STATES)[number];
  }
}
