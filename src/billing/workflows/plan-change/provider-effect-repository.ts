import { createHash, randomUUID } from "node:crypto";

import type { BillingProviderName } from "../../types.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";

export const BILLING_PROVIDER_EFFECT_STATES = [
  "pending",
  "claimed",
  "applied",
  "unknown",
  "failed",
  "attention_required",
] as const;

export type BillingProviderEffectState =
  (typeof BILLING_PROVIDER_EFFECT_STATES)[number];

const BILLING_PROVIDER_EFFECT_STATE_SET = new Set<BillingProviderEffectState>(
  BILLING_PROVIDER_EFFECT_STATES,
);

export function isBillingProviderEffectState(
  value: unknown,
): value is BillingProviderEffectState {
  return (
    typeof value === "string" &&
    BILLING_PROVIDER_EFFECT_STATE_SET.has(value as BillingProviderEffectState)
  );
}

export interface BillingProviderEffectRecord {
  attempts: number;
  claimedAt: string | null;
  completedAt: string | null;
  connectionId: string;
  createdAt: string | null;
  effectType: string;
  failedAt: string | null;
  fencingEpoch: number;
  id: string;
  idempotencyKey: string;
  lastError: string | null;
  leaseExpiresAt: string | null;
  leaseToken: string | null;
  observedEvidence: unknown | null;
  observedResult: unknown | null;
  operationId: string;
  provider: BillingProviderName;
  providerResourceId: string | null;
  requestFingerprint: string;
  state: BillingProviderEffectState;
  unknownAt: string | null;
  updatedAt: string | null;
}

export class BillingProviderEffectStateError extends Error {
  readonly code = "ATHENA_BILLING_PROVIDER_EFFECT_INVALID_STATE";

  constructor(value: unknown) {
    super(`Invalid provider-effect state: ${String(value)}.`);
    this.name = "BillingProviderEffectStateError";
  }
}

export class BillingProviderEffectIdentityError extends Error {
  readonly code = "ATHENA_BILLING_PROVIDER_EFFECT_IDENTITY_CONFLICT";

  constructor(operationId: string, effectType: string) {
    super(
      `Provider effect identity already exists with different request metadata: ${operationId}/${effectType}.`,
    );
    this.name = "BillingProviderEffectIdentityError";
  }
}

function effectState(value: unknown): BillingProviderEffectState {
  if (isBillingProviderEffectState(value)) {
    return value;
  }
  throw new BillingProviderEffectStateError(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" ? value : null;
}

function asRecord(row: Record<string, unknown>): BillingProviderEffectRecord {
  return {
    attempts: Number(row.attempts ?? 0),
    claimedAt: nullableTimestamp(row.claimed_at),
    completedAt: nullableTimestamp(row.completed_at),
    connectionId: String(row.connection_id),
    createdAt: nullableTimestamp(row.created_at),
    effectType: String(row.effect_type),
    failedAt: nullableTimestamp(row.failed_at),
    fencingEpoch: Number(row.fencing_epoch ?? 0),
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    lastError: nullableString(row.last_error),
    leaseExpiresAt: nullableTimestamp(row.lease_expires_at),
    leaseToken: nullableString(row.lease_token),
    observedEvidence: row.observed_evidence ?? null,
    observedResult: row.observed_result ?? null,
    operationId: String(row.operation_id),
    provider: String(row.provider),
    providerResourceId: nullableString(row.provider_resource_id),
    requestFingerprint: String(row.request_fingerprint),
    state: effectState(row.state),
    unknownAt: nullableTimestamp(row.unknown_at),
    updatedAt: nullableTimestamp(row.updated_at),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fingerprintBillingProviderEffect(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input) ?? "", "utf8")
    .digest("hex");
}

export interface BillingProviderEffectCreateInput {
  connectionId: string;
  effectType: string;
  idempotencyKey: string;
  operationId: string;
  provider: BillingProviderName;
  requestFingerprint: string;
}

export type BillingProviderEffectFindInput =
  | { effectId: string }
  | { effectType: string; operationId: string };

export interface BillingProviderEffectRepository {
  claim(input: {
    effectId: string;
    expectedFencingEpoch: number;
    leaseToken: string;
  }): Promise<BillingProviderEffectRecord | undefined>;
  complete(input: {
    effectId: string;
    expectedFencingEpoch: number;
    leaseToken: string;
    observedEvidence?: unknown;
    observedResult?: unknown;
    providerResourceId?: string | null;
  }): Promise<BillingProviderEffectRecord | undefined>;
  create(
    input: BillingProviderEffectCreateInput,
  ): Promise<BillingProviderEffectRecord>;
  fail(input: {
    effectId: string;
    error: string;
    expectedFencingEpoch: number;
    leaseToken: string;
  }): Promise<BillingProviderEffectRecord | undefined>;
  find(
    input: BillingProviderEffectFindInput,
  ): Promise<BillingProviderEffectRecord | undefined>;
  markUnknown(input: {
    effectId: string;
    error: string;
    expectedFencingEpoch: number;
    leaseToken: string;
    observedEvidence?: unknown;
  }): Promise<BillingProviderEffectRecord | undefined>;
  markApplied(input: {
    effectId: string;
    expectedFencingEpoch: number;
    observedEvidence?: unknown;
    observedResult?: unknown;
    providerResourceId?: string | null;
  }): Promise<BillingProviderEffectRecord | undefined>;
  markAttentionRequired(input: {
    effectId: string;
    error: string;
    expectedFencingEpoch: number;
    observedEvidence?: unknown;
  }): Promise<BillingProviderEffectRecord | undefined>;
  list(
    operationId: string,
  ): Promise<readonly BillingProviderEffectRecord[]>;
  retry(input: {
    effectId: string;
    expectedFencingEpoch: number;
  }): Promise<BillingProviderEffectRecord | undefined>;
}

function assertCreateIdentity(
  existing: BillingProviderEffectRecord,
  input: BillingProviderEffectCreateInput,
): void {
  if (
    existing.connectionId !== input.connectionId ||
    existing.effectType !== input.effectType ||
    existing.idempotencyKey !== input.idempotencyKey ||
    existing.operationId !== input.operationId ||
    existing.provider !== input.provider ||
    existing.requestFingerprint !== input.requestFingerprint
  ) {
    throw new BillingProviderEffectIdentityError(
      input.operationId,
      input.effectType,
    );
  }
}

export function createBillingProviderEffectRepository(
  sql: BillingSqlExecutor,
): BillingProviderEffectRepository {
  const find = async (
    input: BillingProviderEffectFindInput,
  ): Promise<BillingProviderEffectRecord | undefined> => {
    const result =
      "effectId" in input
        ? await sql.query(
            `SELECT *
             FROM billing.billing_provider_effects
             WHERE id = $1::uuid
             LIMIT 1`,
            [input.effectId],
          )
        : await sql.query(
            `SELECT *
             FROM billing.billing_provider_effects
             WHERE operation_id = $1::uuid
               AND effect_type = $2
             LIMIT 1`,
            [input.operationId, input.effectType],
          );
    const row = result.rows[0];
    return row ? asRecord(row) : undefined;
  };

  return {
    async claim(input) {
      const result = await sql.query(
        `UPDATE billing.billing_provider_effects
         SET state = 'claimed',
             lease_token = $2,
             lease_expires_at = now() + interval '30 seconds',
             fencing_epoch = fencing_epoch + 1,
             attempts = attempts + 1,
             claimed_at = now(),
             updated_at = now()
         WHERE id = $1::uuid
           AND fencing_epoch = $3
           AND state IN ('pending', 'claimed')
           AND (
             state = 'pending'
             OR lease_token = $2
             OR lease_expires_at IS NULL
             OR lease_expires_at < now()
           )
         RETURNING *`,
        [input.effectId, input.leaseToken, input.expectedFencingEpoch],
      );
      const row = result.rows[0];
      return row ? asRecord(row) : undefined;
    },

    async complete(input) {
      const result = await sql.query(
        `UPDATE billing.billing_provider_effects
         SET state = 'applied',
             provider_resource_id = COALESCE($4, provider_resource_id),
             observed_result = $5::jsonb,
             observed_evidence = $6::jsonb,
             lease_token = NULL,
             lease_expires_at = NULL,
             completed_at = now(),
             last_error = NULL,
             fencing_epoch = fencing_epoch + 1,
             updated_at = now()
         WHERE id = $1::uuid
           AND lease_token = $2
           AND fencing_epoch = $3
           AND state = 'claimed'
           AND lease_expires_at > now()
         RETURNING *`,
        [
          input.effectId,
          input.leaseToken,
          input.expectedFencingEpoch,
          input.providerResourceId ?? null,
          json(input.observedResult),
          json(input.observedEvidence),
        ],
      );
      const row = result.rows[0];
      return row ? asRecord(row) : undefined;
    },

    async create(input) {
      const result = await sql.query(
        `INSERT INTO billing.billing_provider_effects (
           id,
           operation_id,
           effect_type,
           provider,
           connection_id,
           idempotency_key,
           state,
           request_fingerprint
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, 'pending', $7)
         ON CONFLICT (operation_id, effect_type) DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          input.operationId,
          input.effectType,
          input.provider,
          input.connectionId,
          input.idempotencyKey,
          input.requestFingerprint,
        ],
      );
      const inserted = result.rows[0];
      if (inserted) {
        return asRecord(inserted);
      }
      const existing = await find({
        effectType: input.effectType,
        operationId: input.operationId,
      });
      if (!existing) {
        throw new Error("Provider effect disappeared after an idempotent insert.");
      }
      assertCreateIdentity(existing, input);
      return existing;
    },

    async fail(input) {
      const result = await sql.query(
        `UPDATE billing.billing_provider_effects
         SET state = 'failed',
             last_error = $4,
             lease_token = NULL,
             lease_expires_at = NULL,
             failed_at = now(),
             fencing_epoch = fencing_epoch + 1,
             updated_at = now()
         WHERE id = $1::uuid
           AND lease_token = $2
           AND fencing_epoch = $3
           AND state = 'claimed'
           AND lease_expires_at > now()
         RETURNING *`,
        [
          input.effectId,
          input.leaseToken,
          input.expectedFencingEpoch,
          input.error,
        ],
      );
      const row = result.rows[0];
      return row ? asRecord(row) : undefined;
    },

    find,

    async markUnknown(input) {
      const result = await sql.query(
        `UPDATE billing.billing_provider_effects
         SET state = 'unknown',
             last_error = $4,
             observed_evidence = $5::jsonb,
             lease_token = NULL,
             lease_expires_at = NULL,
             unknown_at = now(),
             fencing_epoch = fencing_epoch + 1,
             updated_at = now()
         WHERE id = $1::uuid
           AND lease_token = $2
           AND fencing_epoch = $3
           AND state = 'claimed'
           AND lease_expires_at > now()
         RETURNING *`,
        [
          input.effectId,
          input.leaseToken,
          input.expectedFencingEpoch,
          input.error,
          json(input.observedEvidence),
        ],
      );
      const row = result.rows[0];
      return row ? asRecord(row) : undefined;
    },

    async markApplied(input) {
      const result = await sql.query(
        `UPDATE billing.billing_provider_effects
         SET state = 'applied',
             provider_resource_id = COALESCE($3, provider_resource_id),
             observed_result = $4::jsonb,
             observed_evidence = $5::jsonb,
             completed_at = now(),
             last_error = NULL,
             fencing_epoch = fencing_epoch + 1,
             updated_at = now()
         WHERE id = $1::uuid
           AND fencing_epoch = $2
           AND state = 'unknown'
         RETURNING *`,
        [
          input.effectId,
          input.expectedFencingEpoch,
          input.providerResourceId ?? null,
          json(input.observedResult),
          json(input.observedEvidence),
        ],
      );
      const row = result.rows[0];
      return row ? asRecord(row) : undefined;
    },

    async markAttentionRequired(input) {
      const result = await sql.query(
        `UPDATE billing.billing_provider_effects
         SET state = 'attention_required',
             last_error = $3,
             observed_evidence = $4::jsonb,
             fencing_epoch = fencing_epoch + 1,
             updated_at = now()
         WHERE id = $1::uuid
           AND fencing_epoch = $2
           AND state = 'unknown'
         RETURNING *`,
        [
          input.effectId,
          input.expectedFencingEpoch,
          input.error,
          json(input.observedEvidence),
        ],
      );
      const row = result.rows[0];
      return row ? asRecord(row) : undefined;
    },

    async list(operationId) {
      const result = await sql.query(
        `SELECT *
         FROM billing.billing_provider_effects
         WHERE operation_id = $1::uuid
         ORDER BY created_at, effect_type`,
        [operationId],
      );
      return result.rows.map(asRecord);
    },

    async retry(input) {
      const result = await sql.query(
        `UPDATE billing.billing_provider_effects
         SET state = 'pending',
             fencing_epoch = fencing_epoch + 1,
             updated_at = now()
         WHERE id = $1::uuid
           AND fencing_epoch = $2
           AND state = 'unknown'
         RETURNING *`,
        [input.effectId, input.expectedFencingEpoch],
      );
      const row = result.rows[0];
      return row ? asRecord(row) : undefined;
    },
  };
}

export const createPostgresBillingProviderEffectRepository =
  createBillingProviderEffectRepository;
