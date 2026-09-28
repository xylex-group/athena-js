import type { CanonicalOutboxIntent } from "../../../../runtime/events/outbox.ts";
import type {
  CanonicalEventRepository,
  CanonicalOutboxRepository,
} from "../../../../runtime/events/sql.ts";
import type { EventIngressDatabase } from "../../../../runtime/ingress/persistence.ts";
import type { CanonicalBillingDocument } from "../../../canonical/document.ts";
import type { CanonicalBillingEvent } from "../../../canonical/transition.ts";

export interface BillingIngressDocumentRepository {
  readCurrentForUpdate(
    tx: EventIngressDatabase,
    document: CanonicalBillingDocument,
    connectionId?: string
  ): Promise<CanonicalBillingDocument | null>;
  upsert(
    tx: EventIngressDatabase,
    document: CanonicalBillingDocument,
    connectionId?: string
  ): Promise<void>;
}

export interface BillingEventRepository extends CanonicalEventRepository {
  append(
    tx: EventIngressDatabase,
    events: readonly CanonicalBillingEvent[]
  ): Promise<void>;
}

export interface BillingOutboxRepository extends CanonicalOutboxRepository {
  enqueue(
    tx: EventIngressDatabase,
    intents: readonly CanonicalOutboxIntent[]
  ): Promise<void>;
}

export interface BillingIngressDomainContext {
  documents: BillingIngressDocumentRepository;
  events: BillingEventRepository;
  outbox: BillingOutboxRepository;
}
