import { ATHENA_DATA_NUCLEUS_EVENTS } from "../nucleus/catalog.ts";
import type { AthenaDataMutationInput } from "../nucleus/types.ts";

export const DATA_LIFECYCLE_EVENTS = ATHENA_DATA_NUCLEUS_EVENTS;

export type AthenaDataLifecycleEventName =
  (typeof DATA_LIFECYCLE_EVENTS)[keyof typeof DATA_LIFECYCLE_EVENTS];

export type AthenaDataLifecycleSemanticOperation =
  | "insert"
  | "update"
  | "delete"
  | "upsert";

export type AthenaDataLifecycleTransportOperation =
  | "insert"
  | "update"
  | "delete";

export type AthenaDataLifecycleEvent = AthenaDataMutationInput;
