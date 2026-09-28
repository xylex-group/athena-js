import type { AthenaDevtoolsDataEvent } from "../protocol/index.ts";
import { sanitizeAthenaDevtoolsDataEvent } from "../sanitize/index.ts";

export type AthenaDevtoolsEventBuffer = {
  clear: () => void;
  list: (options?: {
    limit?: number;
    since?: string;
  }) => AthenaDevtoolsDataEvent[];
  push: (event: AthenaDevtoolsDataEvent) => void;
  readonly capacity: number;
};

const DEFAULT_CAPACITY = 256;

export function createAthenaDevtoolsEventBuffer(options?: {
  capacity?: number;
  limit?: number;
  max?: number;
}): AthenaDevtoolsEventBuffer {
  const capacity = Math.max(
    1,
    options?.capacity ?? options?.limit ?? options?.max ?? DEFAULT_CAPACITY
  );
  const items: AthenaDevtoolsDataEvent[] = [];

  return {
    get capacity() {
      return capacity;
    },
    clear() {
      items.length = 0;
    },
    list(listOptions) {
      const since = listOptions?.since?.trim();
      let selected = items;
      if (since) {
        const index = items.findIndex(
          (event) => event.eventId === since || event.traceId === since
        );
        selected = index >= 0 ? items.slice(index + 1) : items;
      }
      const limit = listOptions?.limit;
      const chronological =
        typeof limit === "number" && Number.isFinite(limit) && limit >= 0
          ? selected.slice(Math.max(0, selected.length - limit))
          : [...selected];
      return chronological.reverse();
    },
    push(event) {
      const sanitized = sanitizeAthenaDevtoolsDataEvent(event);
      if (!sanitized) {
        return;
      }
      items.push(sanitized);
      while (items.length > capacity) {
        items.shift();
      }
    },
  };
}

const ATHENA_DEVTOOLS_RING = createAthenaDevtoolsEventBuffer({
  capacity: DEFAULT_CAPACITY,
});

export function getAthenaDevtoolsProcessEventBuffer(): AthenaDevtoolsEventBuffer {
  return ATHENA_DEVTOOLS_RING;
}

export function recordAthenaDevtoolsEvent(
  event: AthenaDevtoolsDataEvent
): void {
  ATHENA_DEVTOOLS_RING.push(event);
}
