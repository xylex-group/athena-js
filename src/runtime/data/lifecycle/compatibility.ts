/**
 * Public `createClient({ lifecycle: { data } })` adapter.
 * Maps public hook names onto the internal data nucleus.
 * Does not export nucleus types.
 */

export {
  reportDataHookError,
  runDataAfterHooks,
  runDataBeforeHooks,
} from "../nucleus/hooks.ts";
export {
  buildDataMutationInput as buildDataLifecycleEvent,
  lifecycleEventName,
  prepareDataMutation,
} from "../nucleus/prepare.ts";
export type {
  AthenaClientDataLifecycle,
  AthenaDataLifecycleHook,
  AthenaDataLifecycleHooks,
  AthenaDataLifecyclePrepare,
} from "./types.ts";
