/**
 * Public `createClient({ lifecycle: { data } })` adapter.
 * Maps public hook names onto the internal data nucleus.
 * Does not export nucleus types.
 */
export {
	prepareDataMutation,
	lifecycleEventName,
	buildDataMutationInput as buildDataLifecycleEvent,
} from "../nucleus/prepare.ts";
export {
	reportDataHookError,
	runDataAfterHooks,
	runDataBeforeHooks,
} from "../nucleus/hooks.ts";
export type {
	AthenaClientDataLifecycle,
	AthenaDataLifecycleHook,
	AthenaDataLifecycleHooks,
	AthenaDataLifecyclePrepare,
} from "./types.ts";
