import type { EventIngressDatabase } from "../ingress/persistence.ts";
import type { CanonicalEventIR } from "./ir.ts";
import type { CanonicalOutboxIntent } from "./outbox.ts";

export interface CanonicalEventRepository {
  append(
    tx: EventIngressDatabase,
    events: readonly CanonicalEventIR[]
  ): Promise<void>;
}

export interface CanonicalOutboxRepository {
  enqueue(
    tx: EventIngressDatabase,
    intents: readonly CanonicalOutboxIntent[]
  ): Promise<void>;
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function createSqlCanonicalEventRepositories(): {
  events: CanonicalEventRepository;
  outbox: CanonicalOutboxRepository;
} {
  return {
    events: {
      async append(tx, events) {
        for (const event of events) {
          await tx.query(
            `
INSERT INTO athena.event_ledger (
  id, name, domain, provider, subject_type, subject_id, ingress_id, payload, occurred_at, observed_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
ON CONFLICT (id) DO NOTHING
`,
            [
              event.id,
              event.name,
              event.source.domain,
              event.source.provider ?? null,
              event.subject.type,
              event.subject.id,
              event.ingressId ?? null,
              jsonValue(event.payload),
              event.occurredAt.toISOString(),
              event.observedAt.toISOString(),
            ]
          );
        }
      },
    },
    outbox: {
      async enqueue(tx, intents) {
        for (const intent of intents) {
          await tx.query(
            `
INSERT INTO athena.event_outbox (id, event_id, name, payload, created_at)
VALUES ($1,$2,$3,$4::jsonb, now())
ON CONFLICT (id) DO NOTHING
`,
            [intent.id, intent.eventId, intent.name, jsonValue(intent.payload)]
          );
        }
      },
    },
  };
}
