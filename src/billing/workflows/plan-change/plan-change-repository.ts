import { randomUUID } from "node:crypto";

import type { BillingSqlExecutor } from "../../subject/repository.ts";
import {
  assertBillingPlanChangeTransition,
  type BillingPlanChangeState,
  parseBillingPlanChangeState,
} from "./plan-change-state.ts";

export interface BillingPlanChangeOperationRecord {
  connectionId?: string;
  createdAt?: string | null;
  enrollmentId?: string | null;
  expectedRowVersion: number;
  fencingEpoch: number;
  id: string;
  idempotencyKey: string;
  lastError: string | null;
  lastOutcome?: string | null;
  leaseExpiresAt: string | null;
  leaseToken: string | null;
  nextRetryAt?: string | null;
  ownedSubscriptionId: string;
  priceId: string;
  retryCount?: number;
  replacementProviderSubscriptionId: string | null;
  state: BillingPlanChangeState;
  subjectId: string;
  subjectKind: "user" | "organization";
  updatedAt?: string | null;
}

export interface BillingPlanChangeCreateInput {
  connectionId: string;
  enrollmentId?: string | null;
  expectedRowVersion: number;
  idempotencyKey: string;
  ownedSubscriptionId: string;
  priceId: string;
  subjectId: string;
  subjectKind: "user" | "organization";
}

export interface BillingPlanChangeRecoveryCandidate {
  expectedFencingEpoch: number;
  id: string;
  retryCount: number;
}

export interface BillingOwnedSubscriptionVersion {
  connectionId?: string;
  id: string;
  rowVersion: number;
}

export class BillingPlanChangeRepositoryError extends Error {
  readonly code = "ATHENA_BILLING_PLAN_CHANGE_REPOSITORY_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "BillingPlanChangeRepositoryError";
  }
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

function asRecord(
  row: Record<string, unknown>,
): BillingPlanChangeOperationRecord {
  const subjectKind = row.subject_kind;
  if (subjectKind !== "user" && subjectKind !== "organization") {
    throw new BillingPlanChangeRepositoryError(
      `Invalid plan-change subject kind: ${String(subjectKind)}.`,
    );
  }
  return {
    connectionId: String(row.connection_id),
    createdAt: nullableTimestamp(row.created_at),
    enrollmentId: nullableString(row.enrollment_id),
    expectedRowVersion: Number(row.expected_row_version),
    fencingEpoch: Number(row.fencing_epoch),
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    lastError: nullableString(row.last_error),
    lastOutcome: nullableString(row.last_outcome),
    leaseExpiresAt: nullableTimestamp(row.lease_expires_at),
    leaseToken: nullableString(row.lease_token),
    nextRetryAt: nullableTimestamp(row.next_retry_at),
    ownedSubscriptionId: String(row.owned_subscription_id),
    priceId: String(row.price_id),
    retryCount: Number(row.retry_count ?? 0),
    replacementProviderSubscriptionId: nullableString(
      row.replacement_provider_subscription_id,
    ),
    state: parseBillingPlanChangeState(row.state),
    subjectId: String(row.subject_id),
    subjectKind,
    updatedAt: nullableTimestamp(row.updated_at),
  };
}

function assertCreateIdentity(
  existing: BillingPlanChangeOperationRecord,
  input: BillingPlanChangeCreateInput,
): void {
  if (
    existing.connectionId !== input.connectionId ||
    (existing.enrollmentId ?? null) !== (input.enrollmentId ?? null) ||
    existing.idempotencyKey !== input.idempotencyKey ||
    existing.ownedSubscriptionId !== input.ownedSubscriptionId ||
    existing.priceId !== input.priceId ||
    existing.subjectId !== input.subjectId ||
    existing.subjectKind !== input.subjectKind
  ) {
    throw new BillingPlanChangeRepositoryError(
      "Plan-change idempotency key was reused with different operation data.",
    );
  }
}

export interface BillingPlanChangeRepository {
  attentionRequired(input: {
    error: string;
    expectedFencingEpoch: number;
    expectedState: BillingPlanChangeState;
    id: string;
    leaseToken: string;
  }): Promise<BillingPlanChangeOperationRecord | undefined>;
  completeTerminal(input: {
    expectedFencingEpoch: number;
    expectedState: BillingPlanChangeState;
    id: string;
    leaseToken: string;
  }): Promise<BillingPlanChangeOperationRecord | undefined>;
  claim(input: {
    expectedFencingEpoch: number;
    expectedState?: BillingPlanChangeState;
    id: string;
    leaseToken: string;
  }): Promise<BillingPlanChangeOperationRecord | undefined>;
  complete(input: {
    expectedFencingEpoch: number;
    expectedState: BillingPlanChangeState;
    id: string;
    leaseToken: string;
  }): Promise<BillingPlanChangeOperationRecord | undefined>;
  create(
    input: BillingPlanChangeCreateInput,
  ): Promise<BillingPlanChangeOperationRecord>;
  fail(input: {
    error: string;
    expectedFencingEpoch: number;
    expectedState: BillingPlanChangeState;
    id: string;
    leaseToken: string;
  }): Promise<BillingPlanChangeOperationRecord | undefined>;
  findExpired(input?: {
    limit?: number;
  }): Promise<readonly BillingPlanChangeRecoveryCandidate[]>;
  heartbeat(input: {
    expectedFencingEpoch: number;
    id: string;
    leaseToken: string;
  }): Promise<boolean>;
  loadOwnedSubscriptionVersion(input: {
    subjectId: string;
    subjectKind: "user" | "organization";
    subscriptionId: string;
  }): Promise<BillingOwnedSubscriptionVersion | undefined>;
  load(
    id: string,
  ): Promise<BillingPlanChangeOperationRecord | undefined>;
  countRecoverable(): Promise<number>;
  markAttentionRequired(input: {
    error: string;
    expectedFencingEpoch: number;
    expectedState: BillingPlanChangeState;
    id: string;
    leaseToken: string;
  }): Promise<BillingPlanChangeOperationRecord | undefined>;
  markOwnedSubscriptionCanceled(input: {
    expectedRowVersion: number;
    subjectId: string;
    subscriptionId: string;
  }): Promise<boolean>;
  release(input: {
    expectedFencingEpoch: number;
    id: string;
    leaseToken: string;
  }): Promise<boolean>;
  scheduleRetry(input: {
    expectedFencingEpoch: number;
    id: string;
    lastError?: string | null;
    leaseToken: string;
    nextRetryAt: string;
    retryCount: number;
    state: BillingPlanChangeState;
  }): Promise<BillingPlanChangeOperationRecord | undefined>;
  updateOwnedSubscription(input: {
    amountCurrency: string;
    amountValue: string;
    description: string;
    expectedRowVersion: number;
    interval: string;
    metadata: unknown;
    subjectId: string;
    subscriptionId: string;
    subjectKind: "user" | "organization";
  }): Promise<Record<string, unknown> | undefined>;
  transition(input: {
    expectedFencingEpoch: number;
    expectedState: BillingPlanChangeState;
    id: string;
    lastError?: string | null;
    leaseToken: string;
    replacementProviderSubscriptionId?: string | null;
    state: BillingPlanChangeState;
  }): Promise<BillingPlanChangeOperationRecord | undefined>;
  transaction?<T>(fn: (sql: BillingSqlExecutor) => Promise<T>): Promise<T>;
}

export function createBillingPlanChangeRepository(
  sql: BillingSqlExecutor,
): BillingPlanChangeRepository {
  const loadOwnedSubscriptionVersion = async (input: {
    subjectId: string;
    subjectKind: "user" | "organization";
    subscriptionId: string;
  }): Promise<BillingOwnedSubscriptionVersion | undefined> => {
    const result = await sql.query(
      `SELECT id, connection_id::text AS connection_id, row_version, updated_at
       FROM billing.billing_subscriptions
       WHERE id = $1::uuid
         AND subject_kind = $2
         AND subject_id = $3
         AND ownership_status = 'resolved'
       LIMIT 1`,
      [input.subscriptionId, input.subjectKind, input.subjectId],
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      connectionId:
        typeof row.connection_id === "string"
          ? row.connection_id
          : undefined,
      id: String(row.id),
      rowVersion: Number(row.row_version ?? 1),
    };
  };

  const load = async (
    id: string,
  ): Promise<BillingPlanChangeOperationRecord | undefined> => {
    const result = await sql.query(
      `SELECT *
       FROM billing.billing_plan_change_operations
       WHERE id = $1::uuid
       LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? asRecord(row) : undefined;
  };

  const findByIdentity = async (
    input: BillingPlanChangeCreateInput,
  ): Promise<BillingPlanChangeOperationRecord | undefined> => {
    const result = await sql.query(
      `SELECT *
       FROM billing.billing_plan_change_operations
       WHERE subject_kind = $1
         AND subject_id = $2
         AND idempotency_key = $3
       LIMIT 1`,
      [input.subjectKind, input.subjectId, input.idempotencyKey],
    );
    const row = result.rows[0];
    return row ? asRecord(row) : undefined;
  };

  const transition = async (
    input: Parameters<BillingPlanChangeRepository["transition"]>[0],
  ): Promise<BillingPlanChangeOperationRecord | undefined> => {
    assertBillingPlanChangeTransition(input.expectedState, input.state);
    const result = await sql.query(
      `UPDATE billing.billing_plan_change_operations
       SET state = $2,
           replacement_provider_subscription_id = COALESCE($3, replacement_provider_subscription_id),
           last_error = COALESCE($4, last_error),
           fencing_epoch = fencing_epoch + 1,
           lease_expires_at = now() + interval '30 seconds',
           updated_at = now()
       WHERE id = $1::uuid
         AND state = $5
         AND lease_token = $6
         AND fencing_epoch = $7
         AND lease_expires_at > now()
       RETURNING *`,
      [
        input.id,
        input.state,
        input.replacementProviderSubscriptionId ?? null,
        input.lastError ?? null,
        input.expectedState,
        input.leaseToken,
        input.expectedFencingEpoch,
      ],
    );
    const row = result.rows[0];
    return row ? asRecord(row) : undefined;
  };

  const attentionRequired = async (
    input: Parameters<BillingPlanChangeRepository["attentionRequired"]>[0],
  ): Promise<BillingPlanChangeOperationRecord | undefined> =>
    transition({
      expectedFencingEpoch: input.expectedFencingEpoch,
      expectedState: input.expectedState,
      id: input.id,
      lastError: input.error,
      leaseToken: input.leaseToken,
      state: "attention_required",
    });

  const complete = async (
    input: Parameters<BillingPlanChangeRepository["complete"]>[0],
  ): Promise<BillingPlanChangeOperationRecord | undefined> => {
    assertBillingPlanChangeTransition(input.expectedState, "completed");
    const result = await sql.query(
      `UPDATE billing.billing_plan_change_operations
       SET state = 'completed',
           lease_token = NULL,
           lease_expires_at = NULL,
           fencing_epoch = fencing_epoch + 1,
           updated_at = now()
       WHERE id = $1::uuid
         AND state = $4
         AND lease_token = $2
         AND fencing_epoch = $3
         AND lease_expires_at > now()
       RETURNING *`,
      [
        input.id,
        input.leaseToken,
        input.expectedFencingEpoch,
        input.expectedState,
      ],
    );
    const row = result.rows[0];
    return row ? asRecord(row) : undefined;
  };

  const transaction = sql.transaction;
  const transactionMethods = transaction
    ? {
        transaction<T>(fn: (sql: BillingSqlExecutor) => Promise<T>) {
          return transaction(fn);
        },
      }
    : {};

  return {
    attentionRequired,

    async claim(input) {
      if (input.expectedState === "requested") {
        assertBillingPlanChangeTransition("requested", "claimed");
      }
      const result = await sql.query(
        `UPDATE billing.billing_plan_change_operations
         SET state = CASE WHEN state = 'requested' THEN 'claimed' ELSE state END,
             lease_token = $2,
             lease_expires_at = now() + interval '30 seconds',
             fencing_epoch = fencing_epoch + 1,
             updated_at = now()
         WHERE id = $1::uuid
           AND fencing_epoch = $3
           AND ($4::text IS NULL OR state = $4)
           AND state NOT IN ('completed', 'attention_required', 'failed')
           AND (next_retry_at IS NULL OR next_retry_at <= now())
           AND (
             lease_token IS NULL
             OR lease_expires_at IS NULL
             OR lease_expires_at < now()
             OR lease_token = $2
           )
         RETURNING *`,
        [
          input.id,
          input.leaseToken,
          input.expectedFencingEpoch,
          input.expectedState ?? null,
        ],
      );
      const row = result.rows[0];
      return row ? asRecord(row) : undefined;
    },

    complete,
    completeTerminal: complete,

    async countRecoverable() {
      const result = await sql.query(
        `SELECT COUNT(*)::int AS count
         FROM billing.billing_plan_change_operations
         WHERE state NOT IN ('completed', 'attention_required', 'failed')
           AND (lease_expires_at IS NULL OR lease_expires_at < now())
           AND (next_retry_at IS NULL OR next_retry_at <= now())`
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async create(input) {
      const result = await sql.query(
        `INSERT INTO billing.billing_plan_change_operations (
           id,
           connection_id,
           subject_kind,
           subject_id,
           owned_subscription_id,
           enrollment_id,
           idempotency_key,
           expected_row_version,
           fencing_epoch,
           state,
           price_id
         ) VALUES (
           $1::uuid,
           $2::uuid,
           $3,
           $4,
           $5::uuid,
           $6::uuid,
           $7,
           $8,
           0,
           'requested',
           $9
         )
         ON CONFLICT (subject_kind, subject_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          input.connectionId,
          input.subjectKind,
          input.subjectId,
          input.ownedSubscriptionId,
          input.enrollmentId ?? null,
          input.idempotencyKey,
          input.expectedRowVersion,
          input.priceId,
        ],
      );
      const inserted = result.rows[0];
      if (inserted) {
        return asRecord(inserted);
      }
      const existing = await findByIdentity(input);
      if (!existing) {
        throw new BillingPlanChangeRepositoryError(
          "Plan-change operation disappeared after an idempotent insert.",
        );
      }
      assertCreateIdentity(existing, input);
      return existing;
    },

    async fail(input) {
      return transition({
        expectedFencingEpoch: input.expectedFencingEpoch,
        expectedState: input.expectedState,
        id: input.id,
        lastError: input.error,
        leaseToken: input.leaseToken,
        state: "failed",
      });
    },

    async findExpired(input = {}) {
      const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 100));
      const result = await sql.query(
        `SELECT id, fencing_epoch, retry_count
         FROM billing.billing_plan_change_operations
         WHERE state NOT IN ('completed', 'attention_required', 'failed')
           AND (lease_expires_at IS NULL OR lease_expires_at < now())
           AND (next_retry_at IS NULL OR next_retry_at <= now())
         ORDER BY updated_at
         LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({
        expectedFencingEpoch: Number(row.fencing_epoch ?? 0),
        id: String(row.id),
        retryCount: Number(row.retry_count ?? 0),
      }));
    },

    async heartbeat(input) {
      const result = await sql.query(
        `UPDATE billing.billing_plan_change_operations
         SET lease_expires_at = now() + interval '30 seconds',
             updated_at = now()
         WHERE id = $1::uuid
           AND lease_token = $2
           AND fencing_epoch = $3
           AND state NOT IN ('completed', 'attention_required', 'failed')
           AND lease_expires_at > now()
         RETURNING id`,
        [input.id, input.leaseToken, input.expectedFencingEpoch],
      );
      return result.rows.length > 0;
    },

    async loadOwnedSubscriptionVersion(input) {
      return loadOwnedSubscriptionVersion(input);
    },

    load,
    markAttentionRequired: attentionRequired,

    async markOwnedSubscriptionCanceled(input) {
      const result = await sql.query(
        `UPDATE billing.billing_subscriptions
         SET status = 'canceled',
             canceled_at = now(),
             row_version = row_version + 1
         WHERE id = $1::uuid
           AND subject_id = $2
           AND row_version = $3
         RETURNING id`,
        [input.subscriptionId, input.subjectId, input.expectedRowVersion],
      );
      return result.rows.length > 0;
    },

    async release(input) {
      const result = await sql.query(
        `UPDATE billing.billing_plan_change_operations
         SET lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = now()
         WHERE id = $1::uuid
           AND lease_token = $2
           AND fencing_epoch = $3
           AND state NOT IN ('completed', 'attention_required', 'failed')
         RETURNING id`,
        [input.id, input.leaseToken, input.expectedFencingEpoch],
      );
      return result.rows.length > 0;
    },

    async scheduleRetry(input) {
      const result = await sql.query(
        `UPDATE billing.billing_plan_change_operations
         SET retry_count = $5,
             next_retry_at = $6,
             last_error = COALESCE($7, last_error),
             last_outcome = 'retry_scheduled',
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = now()
         WHERE id = $1::uuid
           AND state = $4
           AND lease_token = $2
           AND fencing_epoch = $3
           AND lease_expires_at > now()
         RETURNING *`,
        [
          input.id,
          input.leaseToken,
          input.expectedFencingEpoch,
          input.state,
          input.retryCount,
          input.nextRetryAt,
          input.lastError ?? null,
        ],
      );
      const row = result.rows[0];
      return row ? asRecord(row) : undefined;
    },

    transition,

    async updateOwnedSubscription(input) {
      const result = await sql.query(
        `UPDATE billing.billing_subscriptions
         SET amount_currency = $4,
             amount_value = $5,
             interval = $6,
             description = $7,
             metadata = COALESCE(metadata, '{}'::jsonb) || $8::jsonb,
             row_version = row_version + 1,
             updated_at = now()
         WHERE id = $1::uuid
           AND subject_kind = $2
           AND subject_id = $3
           AND ownership_status = 'resolved'
           AND row_version = $9
         RETURNING *`,
        [
          input.subscriptionId,
          input.subjectKind,
          input.subjectId,
          input.amountCurrency,
          input.amountValue,
          input.interval,
          input.description,
          JSON.stringify(input.metadata),
          input.expectedRowVersion,
        ],
      );
      return result.rows[0];
    },
    ...transactionMethods,
  };
}

export const createPostgresBillingPlanChangeRepository =
  createBillingPlanChangeRepository;
