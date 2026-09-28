import type { CanonicalEventIR } from "../events/ir.ts";
import type { AthenaIngressIR } from "./ir.ts";
import type {
  EventIngressDatabase,
  EventIngressPersistence,
} from "./persistence.ts";

export interface EventIngressResult<
  TDocument = unknown,
  TEvent extends CanonicalEventIR = CanonicalEventIR,
> {
  document?: TDocument;
  duplicate: boolean;
  events: readonly TEvent[];
  ignored?: boolean;
  /**
   * Downstream customer import / reconciliation after the ingress row is
   * persisted. HTTP 202 can still report `failed` here.
   */
  reconciliation?: "completed" | "failed" | "skipped";
}

export interface EventIngressRuntimeContext<TDomain = unknown> {
  database: EventIngressDatabase;
  domain: TDomain;
  persistence: EventIngressPersistence;
}

export interface EventIngressDomainHandler<
  TDomain = unknown,
  TDocument = unknown,
  TEvent extends CanonicalEventIR = CanonicalEventIR,
> {
  ingest(
    ingress: AthenaIngressIR,
    runtime: EventIngressRuntimeContext<TDomain>
  ): Promise<EventIngressResult<TDocument, TEvent>>;
}

export interface EventIngressRuntime<
  TDocument = unknown,
  TEvent extends CanonicalEventIR = CanonicalEventIR,
> {
  ingest(
    ingress: AthenaIngressIR
  ): Promise<EventIngressResult<TDocument, TEvent>>;
}

export function createEventIngressRuntime<
  TDomain = unknown,
  TDocument = unknown,
  TEvent extends CanonicalEventIR = CanonicalEventIR,
>(input: {
  context: EventIngressRuntimeContext<TDomain>;
  handler: EventIngressDomainHandler<TDomain, TDocument, TEvent>;
}): EventIngressRuntime<TDocument, TEvent> {
  return {
    ingest(ingress) {
      return input.handler.ingest(ingress, input.context);
    },
  };
}
