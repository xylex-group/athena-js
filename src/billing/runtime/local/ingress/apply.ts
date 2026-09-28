import { projectOutboxIntents } from "../../../../runtime/events/outbox.ts";
import type { AthenaIngressIR } from "../../../../runtime/ingress/ir.ts";
import type {
  EventIngressDatabase,
  EventIngressPersistence,
} from "../../../../runtime/ingress/persistence.ts";
import type { CanonicalBillingDocument } from "../../../canonical/document.ts";
import {
  assertCanonicalBillingTransition,
  type CanonicalBillingEvent,
  canonicalizeBillingEvents,
} from "../../../canonical/transition.ts";
import type {
  BillingEventRepository,
  BillingIngressDocumentRepository,
  BillingOutboxRepository,
} from "./repository.ts";
import { assertRevisionIsNotStale } from "./revision.ts";

export interface ApplyCanonicalBillingIngressInput {
  canonicalizeEvents?: typeof canonicalizeBillingEvents;
  database: EventIngressDatabase;
  document: CanonicalBillingDocument;
  documents: BillingIngressDocumentRepository;
  events: BillingEventRepository;
  ingress: AthenaIngressIR;
  outbox: BillingOutboxRepository;
  persistence: EventIngressPersistence;
}

export interface ApplyCanonicalBillingIngressResult {
  document: CanonicalBillingDocument;
  duplicate: boolean;
  events: readonly CanonicalBillingEvent[];
}

export async function applyCanonicalBillingIngress(
  input: ApplyCanonicalBillingIngressInput
): Promise<ApplyCanonicalBillingIngressResult> {
  return input.database.transaction(async (tx) => {
    const locked = await input.persistence.lock(tx, input.ingress.id);
    if (locked?.status === "processed") {
      return {
        document: input.document,
        duplicate: true,
        events: [],
      };
    }

    const previous = await input.documents.readCurrentForUpdate(
      tx,
      input.document,
      input.ingress.connectionId
    );
    assertRevisionIsNotStale(previous, input.document);
    assertCanonicalBillingTransition(previous, input.document);
    await input.documents.upsert(
      tx,
      input.document,
      input.ingress.connectionId
    );

    const canonicalize = input.canonicalizeEvents ?? canonicalizeBillingEvents;
    const events = canonicalize({
      current: input.document,
      ingress: input.ingress,
      previous,
    });
    await input.events.append(tx, events);
    await input.outbox.enqueue(tx, projectOutboxIntents(events));
    await input.persistence.markProcessed(tx, {
      eventIds: events.map((event) => event.id),
      ingressId: input.ingress.id,
    });
    return { document: input.document, duplicate: false, events };
  });
}
