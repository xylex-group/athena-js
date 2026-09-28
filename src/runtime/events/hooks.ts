import type { CanonicalBillingEventName } from "./catalog.ts";
import type { CanonicalEventIR } from "./ir.ts";

export type CanonicalEventHook = (
  event: CanonicalEventIR<CanonicalBillingEventName>
) => void | Promise<void>;

const hooks = new Map<string, CanonicalEventHook[]>();

export function onCanonicalEvent(
  name: CanonicalBillingEventName,
  hook: CanonicalEventHook
): void {
  const existing = hooks.get(name) ?? [];
  existing.push(hook);
  hooks.set(name, existing);
}

export async function dispatchCanonicalEventAfterCommit(
  events: readonly CanonicalEventIR<CanonicalBillingEventName>[]
): Promise<void> {
  for (const event of events) {
    const registered = hooks.get(event.name) ?? [];
    for (const hook of registered) {
      await hook(event);
    }
  }
}

/** @deprecated Mutation lifecycle hooks are not this registry. Prefer dispatchCanonicalEventAfterCommit. */
export async function dispatchCanonicalEventHooks(
  events: readonly CanonicalEventIR<CanonicalBillingEventName>[]
): Promise<void> {
  await dispatchCanonicalEventAfterCommit(events);
}
