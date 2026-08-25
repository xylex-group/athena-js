import type { AthenaServerRuntime } from "../types.ts";

/**
 * Honesty: do not advertise `atomic` until a nucleus-owned transaction exists.
 * Direct Postgres today is still per-statement autocommit unless a later
 * executeDataMutation wraps an owned transaction.
 */
export type AthenaDataTransactionSemantics =
	| "atomic"
	| "backend-managed"
	| "unknown";

export function resolveDataTransactionSemantics(
	runtime: Pick<AthenaServerRuntime, "capabilities">,
): AthenaDataTransactionSemantics {
	if (runtime.capabilities.transport === "d1") {
		return "backend-managed";
	}
	return "unknown";
}
