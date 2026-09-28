import {
  assertBillingWebhookObservabilitySchema,
  withBillingObservabilitySchemaGuard,
} from "../../observability/schema-guard.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingWebhookRegistrationRecord } from "../reconciliation/types.ts";
import type {
  BillingWebhookKind,
  ResolvedBillingIngressEndpoints,
} from "../types.ts";
import type {
  BillingWebhookDeliveryEvent,
  BillingWebhookDeliveryHealthRow,
} from "./delivery-health.ts";
import {
  createMemoryBillingWebhookDeliveryHealthStore,
  createPostgresBillingWebhookDeliveryHealthStore,
} from "./delivery-health.ts";
import type {
  BillingWebhookIngressStage,
  BillingWebhookReconciliationOutcome,
} from "./stages.ts";
import type {
  BillingRejectedIngressClassification,
  BillingRejectedIngressPayloadEvidence,
} from "./rejection-evidence.ts";

export interface BillingWebhookIngressStageRecord {
  connectionId?: string;
  correlationId?: string;
  errorMessage?: string;
  ingressId?: string;
  kind: BillingWebhookKind;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
  operation?: string;
  provider?: string;
  rejectionCode?: string;
  stage: BillingWebhookIngressStage | "failed";
  status?: string;
  traceId?: string;
}

export interface BillingWebhookIngressRejectionEvidence {
  payload: BillingRejectedIngressPayloadEvidence;
  expectedEnvelope: Record<string, unknown>;
}

export interface BillingWebhookIngressRejectionRecord {
  bytes: number;
  classification: BillingRejectedIngressClassification;
  code: string;
  connectionId?: string;
  contentType?: string;
  digest?: string;
  expectedEnvelope: Record<string, unknown>;
  ingressId?: string;
  kind: BillingWebhookKind;
  occurredAt: Date;
  truncated?: boolean;
}

export interface BillingWebhookIngressObservabilityWrite {
  connectionId?: string;
  correlationId?: string;
  ingressId?: string;
  kind: BillingWebhookKind;
  metadata?: Record<string, unknown>;
  stage: BillingWebhookIngressStage | "failed";
  traceId?: string;
}

export interface BillingWebhookIngressObservability {
  aggregateRecent(
    connectionId: string,
    windowMs?: number
  ): Promise<{
    accepted: number;
    duplicates: number;
    received: number;
    reconciliationFailures: number;
    rejected: number;
  }>;
  listDelivery(
    connectionId: string
  ): Promise<readonly BillingWebhookDeliveryHealthRow[]>;
  listRecentStages(
    connectionId: string,
    limit?: number
  ): Promise<readonly BillingWebhookIngressStageRecord[]>;
  recordAccepted(
    input: BillingWebhookIngressObservabilityWrite & { connectionId: string }
  ): Promise<void>;
  recordDelivery(input: {
    code?: string;
    connectionId: string;
    event: BillingWebhookDeliveryEvent;
    kind: BillingWebhookKind;
    message?: string;
  }): Promise<void>;
  recordReconciliation(
    input: BillingWebhookIngressObservabilityWrite & {
      connectionId: string;
      outcome: BillingWebhookReconciliationOutcome;
    }
  ): Promise<void>;
  recordRejected(
    input: BillingWebhookIngressObservabilityWrite & {
      code: string;
      evidence?: BillingWebhookIngressRejectionEvidence;
    }
  ): Promise<void>;
  recordStage(input: BillingWebhookIngressStageRecord): Promise<void>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: string | undefined): string | null {
  if (value == null || value.length === 0) {
    return null;
  }
  return UUID_RE.test(value) ? value : null;
}

function stageRecord(
  input: BillingWebhookIngressObservabilityWrite & { rejectionCode?: string }
): BillingWebhookIngressStageRecord {
  return {
    kind: input.kind,
    occurredAt: new Date(),
    stage: input.stage,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.ingressId ? { ingressId: input.ingressId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.rejectionCode ? { rejectionCode: input.rejectionCode } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
}

export function createMemoryBillingWebhookIngressObservability(): {
  delivery: ReturnType<
    typeof createMemoryBillingWebhookDeliveryHealthStore
  >["rows"];
  rejections: BillingWebhookIngressRejectionRecord[];
  stages: BillingWebhookIngressStageRecord[];
  store: BillingWebhookIngressObservability;
} {
  const stages: BillingWebhookIngressStageRecord[] = [];
  const rejections: BillingWebhookIngressRejectionRecord[] = [];
  const delivery = createMemoryBillingWebhookDeliveryHealthStore();
  const store: BillingWebhookIngressObservability = {
    async aggregateRecent(connectionId, windowMs = 24 * 60 * 60 * 1000) {
      const cutoff = Date.now() - windowMs;
      const recent = stages.filter(
        (row) =>
          row.connectionId === connectionId &&
          row.occurredAt.getTime() >= cutoff
      );
      return {
        accepted: recent.filter((row) => row.stage === "persisted").length,
        duplicates: recent.filter((row) => row.stage === "duplicate").length,
        received: recent.filter((row) => row.stage === "received").length,
        reconciliationFailures: recent.filter(
          (row) => row.stage === "reconciliation_failed"
        ).length,
        rejected: recent.filter(
          (row) => row.stage === "rejected" || row.stage === "failed"
        ).length,
      };
    },
    async listDelivery(connectionId) {
      return delivery.store.list(connectionId);
    },
    async listRecentStages(connectionId, limit = 32) {
      return stages
        .filter((row) => row.connectionId === connectionId)
        .slice()
        .reverse()
        .slice(0, limit);
    },
    async recordAccepted(input) {
      await store.recordStage(stageRecord(input));
      await delivery.store.recordDelivery({
        connectionId: input.connectionId,
        event: input.stage === "duplicate" ? "duplicate" : "accepted",
        kind: input.kind,
      });
    },
    async recordDelivery(input) {
      await delivery.store.recordDelivery(input);
    },
    async recordReconciliation(input) {
      await store.recordStage(stageRecord(input));
      await delivery.store.recordReconciliation({
        connectionId: input.connectionId,
        kind: input.kind,
        outcome: input.outcome,
        phase:
          input.stage === "reconciliation_failed"
            ? "failed"
            : input.stage === "reconciliation_started"
              ? "started"
              : "completed",
      });
    },
    async recordRejected(input) {
      await store.recordStage(
        stageRecord({ ...input, rejectionCode: input.code })
      );
      if (input.evidence) {
        rejections.push({
          bytes: input.evidence.payload.bytes,
          classification: input.evidence.payload.classification,
          code: input.code,
          ...(input.evidence.payload.digest
            ? { digest: input.evidence.payload.digest }
            : {}),
          expectedEnvelope: input.evidence.expectedEnvelope,
          kind: input.kind,
          occurredAt: new Date(),
          ...(input.evidence.payload.truncated
            ? { truncated: true }
            : {}),
          ...(input.evidence.payload.contentType
            ? { contentType: input.evidence.payload.contentType }
            : {}),
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.ingressId ? { ingressId: input.ingressId } : {}),
        });
      }
      if (input.connectionId) {
        await delivery.store.recordDelivery({
          code: input.code,
          connectionId: input.connectionId,
          event: "rejected",
          kind: input.kind,
        });
      }
    },
    async recordStage(input) {
      stages.push({ ...input, occurredAt: input.occurredAt ?? new Date() });
    },
  };
  return { delivery: delivery.rows, rejections, stages, store };
}

export function createPostgresBillingWebhookIngressObservability(
  rawSql: BillingSqlExecutor
): BillingWebhookIngressObservability {
  const sql = withBillingObservabilitySchemaGuard(rawSql);
  let schemaAsserted: Promise<void> | undefined;
  const ensureSchema = () => {
    schemaAsserted ??= assertBillingWebhookObservabilitySchema(sql);
    return schemaAsserted;
  };
  const delivery = createPostgresBillingWebhookDeliveryHealthStore(rawSql);
  const store: BillingWebhookIngressObservability = {
    async aggregateRecent(connectionId, windowMs = 24 * 60 * 60 * 1000) {
      await ensureSchema();
      const result = await sql.query(
        `
SELECT
	count(*) FILTER (WHERE stage = 'received')::int AS received,
	count(*) FILTER (WHERE stage = 'persisted')::int AS accepted,
	count(*) FILTER (WHERE stage IN ('rejected', 'failed'))::int AS rejected,
	count(*) FILTER (WHERE stage = 'duplicate')::int AS duplicates,
	count(*) FILTER (WHERE stage = 'reconciliation_failed')::int AS reconciliation_failures
FROM billing.billing_webhook_ingress_stages
WHERE connection_id = $1::uuid
	AND occurred_at >= $2::timestamptz
`,
        [connectionId, new Date(Date.now() - windowMs)]
      );
      const row = result.rows[0] ?? {};
      return {
        accepted: Number(row.accepted ?? 0),
        duplicates: Number(row.duplicates ?? 0),
        received: Number(row.received ?? 0),
        reconciliationFailures: Number(row.reconciliation_failures ?? 0),
        rejected: Number(row.rejected ?? 0),
      };
    },
    async listDelivery(connectionId) {
      return delivery.list(connectionId);
    },
    async listRecentStages(connectionId, limit = 32) {
      await ensureSchema();
      const result = await sql.query(
        `
SELECT connection_id, ingress_id, kind, stage, rejection_code, correlation_id, trace_id, occurred_at
FROM billing.billing_webhook_ingress_stages
WHERE connection_id = $1::uuid
ORDER BY occurred_at DESC
LIMIT $2
`,
        [connectionId, limit]
      );
      return result.rows.map((row) => {
        const occurredAt =
          row.occurred_at instanceof Date
            ? row.occurred_at
            : new Date(String(row.occurred_at));
        return {
          kind: row.kind === "classic" ? "classic" : "next_gen",
          occurredAt,
          stage: String(row.stage) as BillingWebhookIngressStage,
          ...(typeof row.connection_id === "string"
            ? { connectionId: row.connection_id }
            : {}),
          ...(typeof row.ingress_id === "string"
            ? { ingressId: row.ingress_id }
            : {}),
          ...(typeof row.rejection_code === "string"
            ? { rejectionCode: row.rejection_code }
            : {}),
          ...(typeof row.correlation_id === "string"
            ? { correlationId: row.correlation_id }
            : {}),
          ...(typeof row.trace_id === "string"
            ? { traceId: row.trace_id }
            : {}),
        };
      });
    },
    async recordAccepted(input) {
      await ensureSchema();
      await sql.query(
        `
UPDATE billing.billing_webhook_registrations
SET last_delivery_at = now(),
	last_accepted_at = now(),
	last_ingress_stage = $3,
	updated_at = now()
WHERE connection_id = $1::uuid AND kind = $2
`,
        [input.connectionId, input.kind, input.stage]
      );
      await store.recordStage(stageRecord(input));
      await delivery.recordDelivery({
        connectionId: input.connectionId,
        event: input.stage === "duplicate" ? "duplicate" : "accepted",
        kind: input.kind,
      });
    },
    async recordDelivery(input) {
      await delivery.recordDelivery(input);
    },
    async recordReconciliation(input) {
      await sql.query(
        `
UPDATE billing.billing_webhook_registrations
SET last_reconciliation_outcome = $3,
	last_ingress_stage = $4,
	updated_at = now()
WHERE connection_id = $1::uuid AND kind = $2
`,
        [input.connectionId, input.kind, input.outcome, input.stage]
      );
      await store.recordStage(stageRecord(input));
      await delivery.recordReconciliation({
        connectionId: input.connectionId,
        kind: input.kind,
        outcome: input.outcome,
        phase:
          input.stage === "reconciliation_failed"
            ? "failed"
            : input.stage === "reconciliation_started"
              ? "started"
              : "completed",
      });
    },
    async recordRejected(input) {
      await ensureSchema();
      if (input.connectionId) {
        await sql.query(
          `
UPDATE billing.billing_webhook_registrations
SET last_rejected_at = now(),
	last_rejection_code = $3,
	last_error = jsonb_build_object('code', $3::text),
	last_ingress_stage = $4,
	updated_at = now()
WHERE connection_id = $1::uuid AND kind = $2
`,
          [input.connectionId, input.kind, input.code, input.stage]
        );
        await delivery.recordDelivery({
          code: input.code,
          connectionId: input.connectionId,
          event: "rejected",
          kind: input.kind,
          message: input.code,
        });
      }
      if (input.evidence) {
        await sql.query(
          `
INSERT INTO billing.billing_webhook_ingress_rejections (
	connection_id, ingress_id, kind, code, content_type, body_kind, body_bytes,
	classification, digest, truncated, expected_envelope, occurred_at
) VALUES (
	$1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now()
)
`,
          [
            uuidOrNull(input.connectionId),
            uuidOrNull(input.ingressId),
            input.kind,
            input.code,
            input.evidence.payload.contentType ??
              (typeof input.metadata?.contentType === "string"
                ? input.metadata.contentType
                : null),
            input.evidence.payload.classification,
            input.evidence.payload.bytes,
            input.evidence.payload.classification,
            input.evidence.payload.digest ?? null,
            input.evidence.payload.truncated ?? false,
            JSON.stringify(input.evidence.expectedEnvelope),
          ]
        );
      }
      await store.recordStage(
        stageRecord({ ...input, rejectionCode: input.code })
      );
    },
    async recordStage(input) {
      await ensureSchema();
      await sql.query(
        `
INSERT INTO billing.billing_webhook_ingress_stages (
	connection_id, ingress_id, kind, stage, rejection_code, correlation_id, trace_id, occurred_at,
	provider, operation, status, error_message, metadata
) VALUES (
	$1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
)
`,
        [
          uuidOrNull(input.connectionId),
          uuidOrNull(input.ingressId),
          input.kind,
          input.stage,
          input.rejectionCode ?? null,
          input.correlationId ?? null,
          input.traceId ?? null,
          input.occurredAt,
          input.provider ?? "mollie",
          input.operation ?? null,
          input.status ?? null,
          input.errorMessage ?? null,
          JSON.stringify(input.metadata ?? {}),
        ]
      );
    },
  };
  return store;
}

export function createLazyBillingWebhookIngressObservability(
  getSql: () => Promise<BillingSqlExecutor | undefined>
): BillingWebhookIngressObservability {
  const run = async (
    work: (store: BillingWebhookIngressObservability) => Promise<void>
  ): Promise<void> => {
    const sql = await getSql();
    if (!sql) {
      return;
    }
    await work(createPostgresBillingWebhookIngressObservability(sql));
  };
  const resolve = async () => {
    const sql = await getSql();
    return sql
      ? createPostgresBillingWebhookIngressObservability(sql)
      : undefined;
  };
  return {
    async aggregateRecent(connectionId, windowMs) {
      const store = await resolve();
      if (!store) {
        return {
          accepted: 0,
          duplicates: 0,
          received: 0,
          reconciliationFailures: 0,
          rejected: 0,
        };
      }
      return store.aggregateRecent(connectionId, windowMs);
    },
    async listDelivery(connectionId) {
      const store = await resolve();
      return store ? store.listDelivery(connectionId) : [];
    },
    async listRecentStages(connectionId, limit = 32) {
      const store = await resolve();
      return store ? store.listRecentStages(connectionId, limit) : [];
    },
    async recordAccepted(input) {
      await run((store) => store.recordAccepted(input));
    },
    async recordDelivery(input) {
      await run((store) => store.recordDelivery(input));
    },
    async recordReconciliation(input) {
      await run((store) => store.recordReconciliation(input));
    },
    async recordRejected(input) {
      await run((store) => store.recordRejected(input));
    },
    async recordStage(input) {
      await run((store) => store.recordStage(input));
    },
  };
}

function billingWebhookDiagnosticDetail(error: unknown): { error: string } {
  return {
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Best-effort operator stderr. Do not pass `Error` to `console.error` (Node
 * prints the stack). Skip under `node:test` so expected swallows stay quiet.
 */
export function reportBillingWebhookIngressDiagnostic(
  label: string,
  error: unknown
): void {
  if (process.env.NODE_TEST_CONTEXT) {
    return;
  }
  console.error(label, billingWebhookDiagnosticDetail(error));
}

export async function recordBillingWebhookIngressQuietly(
  store: BillingWebhookIngressObservability | undefined,
  work: (store: BillingWebhookIngressObservability) => Promise<void>
): Promise<void> {
  if (!store) {
    return;
  }
  try {
    await work(store);
  } catch (error) {
    reportBillingWebhookIngressDiagnostic(
      "[athena.billing] webhook ingress observability failed",
      error
    );
  }
}

export interface BillingWebhookChannelDeliveryHealth {
  lastAcceptedAt?: string;
  lastDeliveryAt?: string;
  lastIngressStage?: string;
  lastReconciliationOutcome?: string;
  lastRejectedAt?: string;
  lastRejectionCode?: string;
}

export interface BillingWebhookOperatorHealth {
  classic: BillingWebhookChannelDeliveryHealth;
  nextGen: BillingWebhookChannelDeliveryHealth;
  routeMounted: boolean;
  signingSecretConfigured: boolean;
  verification: {
    classic: "authoritative_refetch";
    nextGen: "signature_and_refetch";
  };
}

function iso(value: Date | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function channelHealth(
  row: BillingWebhookRegistrationRecord | undefined
): BillingWebhookChannelDeliveryHealth {
  return {
    ...(iso(row?.lastAcceptedAt)
      ? { lastAcceptedAt: iso(row?.lastAcceptedAt) }
      : {}),
    ...(iso(row?.lastDeliveryAt)
      ? { lastDeliveryAt: iso(row?.lastDeliveryAt) }
      : {}),
    ...(row?.lastIngressStage
      ? { lastIngressStage: row.lastIngressStage }
      : {}),
    ...(row?.lastReconciliationOutcome
      ? { lastReconciliationOutcome: row.lastReconciliationOutcome }
      : {}),
    ...(iso(row?.lastRejectedAt)
      ? { lastRejectedAt: iso(row?.lastRejectedAt) }
      : {}),
    ...(row?.lastRejectionCode
      ? { lastRejectionCode: row.lastRejectionCode }
      : {}),
  };
}

export function billingWebhookOperatorHealth(input: {
  classic?: BillingWebhookRegistrationRecord;
  endpoints?: ResolvedBillingIngressEndpoints;
  nextGen?: BillingWebhookRegistrationRecord;
  signingSecretConfigured: boolean;
}): BillingWebhookOperatorHealth {
  return {
    classic: channelHealth(input.classic),
    nextGen: channelHealth(input.nextGen),
    routeMounted: Boolean(input.endpoints),
    signingSecretConfigured: input.signingSecretConfigured,
    verification: {
      classic: "authoritative_refetch",
      nextGen: "signature_and_refetch",
    },
  };
}
