import type { AthenaIngressIR } from "./ir.ts";
import type {
  EventIngressDatabase,
  EventIngressPersistence,
  EventIngressRecord,
} from "./persistence.ts";

function asRecord(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  return {};
}

export type EventIngressRow = {
  id: string;
  domain: string;
  operation: string | null;
  provider: string | null;
  provider_event_id: string | null;
  connection_id: string | null;
  status: EventIngressRecord["status"];
  body: Buffer;
  headers: unknown;
  received_at: Date;
  correlation_id: string | null;
  trace_id: string | null;
  attempt_count: number;
  failure_stage?: string | null;
  first_failed_at?: Date | null;
  next_attempt_at?: Date | null;
  lease_expires_at?: Date | null;
};

export function mapIngressRow(row: EventIngressRow): EventIngressRecord {
  const headers = asRecord(row.headers);
  return {
    attemptCount: row.attempt_count,
    body: new Uint8Array(row.body),
    connectionId: row.connection_id,
    correlationId: row.correlation_id,
    domain: row.domain,
    failureStage: row.failure_stage ?? null,
    firstFailedAt: row.first_failed_at ? new Date(row.first_failed_at) : null,
    headers,
    id: row.id,
    leaseExpiresAt: row.lease_expires_at
      ? new Date(row.lease_expires_at)
      : null,
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : null,
    operation: row.operation,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    receivedAt: new Date(row.received_at),
    status: row.status,
    traceId: row.trace_id,
  };
}

function insertValues(
  ingress: AthenaIngressIR,
  meta: { provider: string | null; providerEventId: string | null }
): unknown[] {
  return [
    ingress.id,
    ingress.domain,
    ingress.operation,
    meta.provider,
    meta.providerEventId,
    ingress.connectionId ?? null,
    ingress.receivedAt.toISOString(),
    Buffer.from(ingress.body),
    JSON.stringify(ingress.headers),
    ingress.correlationId ?? null,
    ingress.traceId ?? null,
  ];
}

async function lockProviderEventClaim(
  tx: EventIngressDatabase,
  input: {
    domain: string;
    provider: string | null;
    providerEventId: string;
  }
): Promise<void> {
  await tx.query(
    `SELECT pg_advisory_xact_lock(
			hashtext($1::text),
			hashtext(json_build_array($2::text, $3::text)::text)
		)`,
    [input.domain, input.provider ?? "", input.providerEventId]
  );
}

async function selectByProviderEvent(
  tx: EventIngressDatabase,
  input: {
    domain: string;
    provider: string | null;
    providerEventId: string;
  }
): Promise<{ id: string } | undefined> {
  const result = await tx.query<{ id: string }>(
    `
SELECT id, status
FROM athena.event_ingress
WHERE domain = $1
  AND provider IS NOT DISTINCT FROM $2
  AND provider_event_id = $3
`,
    [input.domain, input.provider, input.providerEventId]
  );
  return result.rows[0];
}

function duplicateFromRow(
  row: { id: string },
  ingressId: string
): { duplicate: boolean; ingressId: string } {
  if (row.id !== ingressId) {
    return {
      duplicate: true,
      ingressId: row.id,
    };
  }
  return {
    duplicate: false,
    ingressId: row.id,
  };
}

async function insertReceivedById(
  tx: EventIngressDatabase,
  ingress: AthenaIngressIR,
  provider: string | null
): Promise<void> {
  await tx.query(
    `
INSERT INTO athena.event_ingress (
  id, domain, operation, provider, provider_event_id, connection_id,
  received_at, body, headers, status, correlation_id, trace_id, attempt_count
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'received', $10, $11, 0
)
ON CONFLICT (id) DO NOTHING
`,
    insertValues(ingress, { provider, providerEventId: null })
  );
}

async function claimProviderEventOnRow(
  tx: EventIngressDatabase,
  input: {
    ingressId: string;
    domain: string;
    provider: string | null;
    providerEventId: string;
  }
): Promise<string | undefined> {
  const result = await tx.query<{ id: string }>(
    `
UPDATE athena.event_ingress AS target
SET provider_event_id = $4
WHERE target.id = $1
  AND (target.provider_event_id IS NULL OR target.provider_event_id = $4)
  AND NOT EXISTS (
    SELECT 1
    FROM athena.event_ingress AS claimed
    WHERE claimed.domain = $2
      AND claimed.provider IS NOT DISTINCT FROM $3
      AND claimed.provider_event_id = $4
      AND claimed.id <> $1
  )
RETURNING target.id
`,
    [input.ingressId, input.domain, input.provider, input.providerEventId]
  );
  return result.rows[0]?.id;
}

async function insertReceivedByProviderEvent(
  tx: EventIngressDatabase,
  ingress: AthenaIngressIR,
  meta: { provider: string | null; providerEventId: string }
): Promise<string | undefined> {
  const result = await tx.query<{ id: string }>(
    `
INSERT INTO athena.event_ingress (
  id, domain, operation, provider, provider_event_id, connection_id,
  received_at, body, headers, status, correlation_id, trace_id, attempt_count
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'received', $10, $11, 0
)
ON CONFLICT (domain, provider, provider_event_id) WHERE provider_event_id IS NOT NULL
DO NOTHING
RETURNING id
`,
    insertValues(ingress, meta)
  );
  return result.rows[0]?.id;
}

export function createSqlEventIngressPersistence(): EventIngressPersistence {
  return {
    async insertReceived(tx, ingress, meta) {
      const provider = meta.provider ?? null;
      const providerEventId = meta.providerEventId;
      if (!providerEventId) {
        await insertReceivedById(tx, ingress, provider);
        return {
          duplicate: false,
          ingressId: ingress.id,
        };
      }
      await lockProviderEventClaim(tx, {
        domain: ingress.domain,
        provider,
        providerEventId,
      });
      const existing = await selectByProviderEvent(tx, {
        domain: ingress.domain,
        provider,
        providerEventId,
      });
      if (existing) {
        return duplicateFromRow(existing, ingress.id);
      }
      const claimedOnRow = await claimProviderEventOnRow(tx, {
        domain: ingress.domain,
        ingressId: ingress.id,
        provider,
        providerEventId,
      });
      if (claimedOnRow) {
        return {
          duplicate: false,
          ingressId: claimedOnRow,
        };
      }
      const afterClaim = await selectByProviderEvent(tx, {
        domain: ingress.domain,
        provider,
        providerEventId,
      });
      if (afterClaim) {
        return duplicateFromRow(afterClaim, ingress.id);
      }
      const inserted = await insertReceivedByProviderEvent(tx, ingress, {
        provider,
        providerEventId,
      });
      if (inserted) {
        return {
          duplicate: false,
          ingressId: inserted,
        };
      }
      const afterInsert = await selectByProviderEvent(tx, {
        domain: ingress.domain,
        provider,
        providerEventId,
      });
      if (afterInsert) {
        return duplicateFromRow(afterInsert, ingress.id);
      }
      return {
        duplicate: false,
        ingressId: ingress.id,
      };
    },
    async lock(tx, ingressId) {
      const result = await tx.query<EventIngressRow>(
        "SELECT * FROM athena.event_ingress WHERE id = $1 FOR UPDATE",
        [ingressId]
      );
      const row = result.rows[0];
      if (!row) {
        return;
      }
      return mapIngressRow(row);
    },
    async markProcessed(tx, input) {
      await tx.query(
        `
UPDATE athena.event_ingress
SET status = 'processed', processed_at = now()
WHERE id = $1
`,
        [input.ingressId]
      );
      void input.eventIds;
    },
    async markStatus(tx, input) {
      await tx.query(
        `
UPDATE athena.event_ingress
SET status = $2,
    attempt_count = CASE
      WHEN $2 IN ('retryable_failure', 'terminal_failure') THEN attempt_count + 1
      ELSE attempt_count
    END,
    failed_at = CASE WHEN $2 IN ('retryable_failure', 'terminal_failure') THEN now() ELSE failed_at END,
    error = $3::jsonb,
    failure_stage = $4,
    next_attempt_at = $5,
    lease_owner = CASE WHEN $2 = 'resolving' THEN lease_owner ELSE NULL END,
    lease_expires_at = CASE
      WHEN $2 = 'resolving' THEN COALESCE($6::timestamptz, now() + interval '5 minutes')
      WHEN $2 IN ('retryable_failure', 'terminal_failure', 'processed', 'ignored') THEN NULL
      ELSE lease_expires_at
    END,
    first_failed_at = COALESCE(first_failed_at, $7::timestamptz),
    last_failed_at = $8::timestamptz
WHERE id = $1
`,
        [
          input.ingressId,
          input.status,
          input.error == null ? null : JSON.stringify(input.error),
          input.failureStage ?? null,
          input.nextAttemptAt?.toISOString() ?? null,
          input.leaseExpiresAt?.toISOString() ?? null,
          input.firstFailedAt?.toISOString() ?? null,
          input.lastFailedAt?.toISOString() ?? null,
        ]
      );
    },
  };
}

export function toDirectIngress(ingress: AthenaIngressIR): AthenaIngressIR {
  return { ...ingress, transport: { kind: "direct" } };
}
