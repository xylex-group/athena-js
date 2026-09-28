import type { BillingSqlExecutor } from "../subject/repository.ts";
import type { AthenaBillingAuditEntry } from "./types.ts";

export interface AthenaBillingAuditWriter {
  write(entry: AthenaBillingAuditEntry): Promise<void>;
}

export interface MemoryBillingAuditSink {
  entries: AthenaBillingAuditEntry[];
}

export function createMemoryBillingAuditWriter(
  sink: MemoryBillingAuditSink
): AthenaBillingAuditWriter {
  return {
    async write(entry) {
      sink.entries.push({
        ...entry,
        previous: redactBillingAuditSnapshot(entry.previous),
        result: redactBillingAuditSnapshot(entry.result),
      });
    },
  };
}

export function createPostgresBillingAuditWriter(
  sql: BillingSqlExecutor
): AthenaBillingAuditWriter {
  return {
    async write(entry) {
      await insertAuditLogBilling(sql, entry);
    },
  };
}

function redactBillingAuditSnapshot(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactBillingAuditSnapshot(entry));
  }
  if (typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const drop = new Set([
    "email",
    "emailSnapshot",
    "raw",
    "metadata",
    "amount",
    "amountRefunded",
    "description",
    "name",
    "customer",
    "billingAddress",
    "shippingAddress",
  ]);
  for (const [key, entry] of Object.entries(record)) {
    if (drop.has(key)) {
      continue;
    }
    if (
      key === "subject" ||
      key === "providerSubject" ||
      key === "result" ||
      key === "previous"
    ) {
      out[key] = redactBillingAuditSnapshot(entry);
      continue;
    }
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry == null
    ) {
      out[key] = entry;
      continue;
    }
    if (typeof entry === "object") {
      out[key] = redactBillingAuditSnapshot(entry);
    }
  }
  return out;
}

export async function insertAuditLogBilling(
  sql: BillingSqlExecutor,
  entry: AthenaBillingAuditEntry
): Promise<void> {
  await sql.query(
    `
INSERT INTO athena.audit_log_billing (
	id,
	event_id,
	trace_id,
	correlation_id,
	causation_id,
	event,
	actor_kind,
	actor_user_id,
	connection_id,
	provider,
	subject_kind,
	subject_id,
	provider_subject_kind,
	provider_subject_id,
	previous,
	result,
	outcome,
	created_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11, $12, $13, $14,
	$15::jsonb, $16::jsonb, $17, now()
)
`,
    [
      entry.id,
      entry.eventId,
      entry.traceId,
      entry.correlationId ?? null,
      entry.causationId ?? null,
      entry.event,
      entry.actor.kind,
      entry.actor.userId ?? null,
      entry.connectionId,
      entry.provider,
      entry.subject?.kind ?? null,
      entry.subject?.id ?? null,
      entry.providerSubject?.kind ?? null,
      entry.providerSubject?.id ?? null,
      JSON.stringify(redactBillingAuditSnapshot(entry.previous ?? null)),
      JSON.stringify(redactBillingAuditSnapshot(entry.result ?? null)),
      entry.outcome,
    ]
  );
}
