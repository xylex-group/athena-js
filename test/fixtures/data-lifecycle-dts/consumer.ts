/**
 * Consumer DTS surface for data-lifecycle types. Compiled with tsc against
 * published dist declarations (not package source).
 */
import {
  type AthenaDataLifecycleEvent,
  createClient,
} from "@xylex-group/athena";
import type { AthenaDataLifecycleEvent as RuntimeLifecycleEvent } from "@xylex-group/athena/runtime";

type IsAny<T> = 0 extends 1 & T ? true : false;
type EventsMatch = RuntimeLifecycleEvent extends AthenaDataLifecycleEvent
  ? AthenaDataLifecycleEvent extends RuntimeLifecycleEvent
    ? true
    : false
  : false;
const _rootAndRuntimeEventsMatch: EventsMatch = true;
void _rootAndRuntimeEventsMatch;

createClient({
  databaseUrl: "postgres://localhost/test",
  lifecycle: {
    data: {
      afterInsert(event) {
        const _eventIsNotAny: IsAny<typeof event> = false;
        const _asRootEvent: AthenaDataLifecycleEvent = event;
        const _asRuntimeEvent: RuntimeLifecycleEvent = event;
        void _eventIsNotAny;
        void _asRootEvent;
        void _asRuntimeEvent;
        void event.record;
        void event.records;
        void event.schema;
        void event.table;
      },
    },
  },
});
