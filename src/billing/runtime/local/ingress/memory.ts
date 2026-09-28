import type { CanonicalOutboxIntent } from "../../../../runtime/events/outbox.ts";
import { MemoryEventIngressDatabase } from "../../../../runtime/ingress/memory.ts";
import {
  type CanonicalBillingDocument,
  canonicalDocumentSubjectId,
} from "../../../canonical/document.ts";
import type { CanonicalBillingEvent } from "../../../canonical/transition.ts";
import type {
  BillingEventRepository,
  BillingIngressDocumentRepository,
  BillingOutboxRepository,
} from "./repository.ts";

function memoryDocumentKey(
  document: CanonicalBillingDocument,
  connectionId?: string
): string {
  return `${connectionId ?? ""}:${document.kind}:${canonicalDocumentSubjectId(document)}`;
}

export class MemoryBillingIngressStore {
  readonly database = new MemoryEventIngressDatabase();
  readonly documents = new Map<string, CanonicalBillingDocument>();
  readonly events: CanonicalBillingEvent[] = [];
  readonly outbox: CanonicalOutboxIntent[] = [];
}

export function createMemoryBillingRepositories(
  store: MemoryBillingIngressStore
): {
  documents: BillingIngressDocumentRepository;
  events: BillingEventRepository;
  outbox: BillingOutboxRepository;
} {
  return {
    documents: {
      async readCurrentForUpdate(_tx, document, connectionId) {
        const key = memoryDocumentKey(document, connectionId);
        return store.documents.get(key) ?? null;
      },
      async upsert(_tx, document, connectionId) {
        const key = memoryDocumentKey(document, connectionId);
        store.documents.set(key, document);
      },
    },
    events: {
      async append(_tx, events) {
        store.events.push(...events);
      },
    },
    outbox: {
      async enqueue(_tx, intents) {
        store.outbox.push(...intents);
      },
    },
  };
}
