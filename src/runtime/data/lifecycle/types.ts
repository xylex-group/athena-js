import type { AthenaDataLifecycleEvent } from "./events.ts";
import type { AthenaDataHookErrorInput } from "../nucleus/errors.ts";

export type AthenaDataLifecycleHook = (
	event: AthenaDataLifecycleEvent,
) => Promise<unknown> | unknown;

export type AthenaDataLifecyclePrepare = (
	event: AthenaDataLifecycleEvent,
) => unknown;

export type AthenaDataLifecycleHooks = {
	afterDelete?: AthenaDataLifecycleHook;
	afterInsert?: AthenaDataLifecycleHook;
	afterUpdate?: AthenaDataLifecycleHook;
	afterUpsert?: AthenaDataLifecycleHook;
	beforeDelete?: AthenaDataLifecycleHook;
	beforeInsert?: AthenaDataLifecycleHook;
	beforeUpdate?: AthenaDataLifecycleHook;
	beforeUpsert?: AthenaDataLifecycleHook;
	onError?: (input: AthenaDataHookErrorInput) => Promise<unknown> | unknown;
	/**
	 * @deprecated One-release: return is never applied. Use `beforeDelete` to veto;
	 * Policy scopes delete predicates. `scopeDelete` is not this slice.
	 */
	prepareDelete?: AthenaDataLifecyclePrepare;
	prepareInsert?: AthenaDataLifecyclePrepare;
	prepareUpdate?: AthenaDataLifecyclePrepare;
	prepareUpsert?: AthenaDataLifecyclePrepare;
};

export type AthenaDataLifecycleAuditConfig = {
	resources?: readonly string[];
};

export type AthenaDataLifecycleConfig = AthenaDataLifecycleHooks & {
	audit?: AthenaDataLifecycleAuditConfig;
};

export type AthenaClientDataLifecycle = {
	data?: AthenaDataLifecycleConfig;
};
