export {
	assertDataLifecycleConfig,
	assertDataLifecycleTransactionsUnsupported,
	ATHENA_DATA_LIFECYCLE_TX_UNSUPPORTED,
} from "./assert.ts";
export {
	DATA_LIFECYCLE_EVENTS,
	type AthenaDataLifecycleEvent,
	type AthenaDataLifecycleEventName,
	type AthenaDataLifecycleSemanticOperation,
	type AthenaDataLifecycleTransportOperation,
} from "./events.ts";
export { executeDataMutation } from "./execute.ts";
export type { ExecuteDataMutationOptions } from "./execute.ts";
export {
	buildDataLifecycleEvent,
	lifecycleEventName,
	prepareDataMutation,
	reportDataHookError,
	runDataAfterHooks,
	runDataBeforeHooks,
} from "./compatibility.ts";
export {
	changedFieldsFromPayload,
	createDataMutationScope,
	type AthenaDataMutationScope,
} from "./scope.ts";
export type {
	AthenaClientDataLifecycle,
	AthenaDataLifecycleAuditConfig,
	AthenaDataLifecycleConfig,
	AthenaDataLifecycleHook,
	AthenaDataLifecycleHooks,
	AthenaDataLifecyclePrepare,
} from "./types.ts";
