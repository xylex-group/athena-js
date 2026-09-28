import type { CanonicalEventIR } from "./ir.ts";

export interface CanonicalOutboxIntent {
  readonly eventId: string;
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
}

export function projectOutboxIntents(
  events: readonly CanonicalEventIR[]
): CanonicalOutboxIntent[] {
  return events.map((event) => ({
    eventId: event.id,
    id: crypto.randomUUID(),
    name: event.name,
    payload: event.payload,
  }));
}
