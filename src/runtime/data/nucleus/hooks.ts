import type { AthenaResourceLookup } from "../../../schema/resource.ts";
import type { AthenaRuntimeRequest } from "../types.ts";
import type { AthenaDataLifecycleHooks } from "../lifecycle/types.ts";
import { ATHENA_DATA_NUCLEUS_EVENTS } from "./catalog.ts";
import type { AthenaDataNucleusEnvelope } from "./envelope.ts";
import {
	dataHookErrorMessage,
	type AthenaDataHookErrorInput,
} from "./errors.ts";
import { snapshotDataMutationInput } from "./prepare.ts";
import { cloneSanitizeAndFreezeMutationInput } from "./sanitize.ts";
import type { AthenaDataMutationResult } from "./result.ts";
import type { AthenaDataTransactionSemantics } from "./transaction.ts";
import type { AthenaDataLifecyclePrincipal } from "./types.ts";
import type { AthenaDataMutationInput } from "./types.ts";

export type DataNucleusHookFrame = {
	envelope: AthenaDataNucleusEnvelope;
	modelIndex?: AthenaResourceLookup;
	principal?: AthenaDataLifecyclePrincipal;
	result?: AthenaDataMutationResult;
	transactionSemantics: AthenaDataTransactionSemantics;
};

function eventForHooks(
	request: AthenaRuntimeRequest,
	frame?: DataNucleusHookFrame,
): AthenaDataMutationInput | undefined {
	const base = snapshotDataMutationInput(request, frame?.modelIndex);
	if (!base) {
		return undefined;
	}
	if (!frame) {
		return base;
	}
	return cloneSanitizeAndFreezeMutationInput({
		...base,
		eventId: frame.envelope.eventId,
		requestId: frame.envelope.requestId,
		traceId: frame.envelope.traceId,
		transactionSemantics: frame.transactionSemantics,
		...(frame.principal ? { principal: frame.principal } : {}),
		...(frame.result ? { result: frame.result } : {}),
	});
}

function isImmutableAssignmentError(error: unknown): boolean {
	if (!(error instanceof TypeError)) {
		return false;
	}
	return /read only|frozen|cannot assign|not extensible/i.test(error.message);
}

export async function reportDataHookError(
	hooks: AthenaDataLifecycleHooks | undefined,
	input: AthenaDataHookErrorInput,
): Promise<void> {
	if (!hooks?.onError) {
		console.error("[athena-data]", {
			code: "ATHENA_DATA_HOOK_FAILED",
			error: dataHookErrorMessage(input.error),
			event: input.event,
			phase: input.phase,
		});
		return;
	}
	try {
		await hooks.onError(input);
	} catch (error) {
		console.error("[athena-data]", {
			code: "ATHENA_DATA_HOOK_ON_ERROR_FAILED",
			error: dataHookErrorMessage(error),
			event: input.event,
			phase: "onError",
		});
	}
}

/**
 * Veto only. Sees a frozen AthenaDataMutationInput. Must not rewrite transport bytes.
 */
export async function runDataBeforeHooks(
	hooks: AthenaDataLifecycleHooks | undefined,
	request: AthenaRuntimeRequest,
	frame?: DataNucleusHookFrame,
): Promise<void> {
	if (!hooks) {
		return;
	}
	const event = eventForHooks(request, frame);
	if (!event) {
		return;
	}
	try {
		if (event.event === ATHENA_DATA_NUCLEUS_EVENTS.upsert) {
			if (hooks.beforeUpsert) {
				await hooks.beforeUpsert(event);
			}
			return;
		}
		if (request.operation === "insert" && hooks.beforeInsert) {
			await hooks.beforeInsert(event);
			return;
		}
		if (request.operation === "update" && hooks.beforeUpdate) {
			await hooks.beforeUpdate(event);
			return;
		}
		if (request.operation === "delete" && hooks.beforeDelete) {
			await hooks.beforeDelete(event);
		}
	} catch (error) {
		if (isImmutableAssignmentError(error)) {
			return;
		}
		throw error;
	}
}

/**
 * Post-commit/accepted. Must not fail the client mutation or roll back success.
 */
export async function runDataAfterHooks(
	hooks: AthenaDataLifecycleHooks | undefined,
	request: AthenaRuntimeRequest,
	frame?: DataNucleusHookFrame,
): Promise<void> {
	if (!hooks) {
		return;
	}
	const event = eventForHooks(request, frame);
	if (!event) {
		return;
	}
	try {
		if (event.event === ATHENA_DATA_NUCLEUS_EVENTS.upsert) {
			if (hooks.afterUpsert) {
				await hooks.afterUpsert(event);
			}
			return;
		}
		if (request.operation === "insert" && hooks.afterInsert) {
			await hooks.afterInsert(event);
			return;
		}
		if (request.operation === "update" && hooks.afterUpdate) {
			await hooks.afterUpdate(event);
			return;
		}
		if (request.operation === "delete" && hooks.afterDelete) {
			await hooks.afterDelete(event);
		}
	} catch (error) {
		if (isImmutableAssignmentError(error)) {
			return;
		}
		await reportDataHookError(hooks, {
			error,
			event: event.event,
			phase: "after",
		});
	}
}
