import { AthenaBillingCapabilityError } from "../errors.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import type {
	AthenaBillingRuntime,
	BillingRuntimeDispatchOperation,
} from "./types.ts";
import type { BillingExecutionTarget } from "../types.ts";

export type { BillingRuntimeDispatchOperation };

export interface AthenaBillingRuntimeDispatch extends AthenaBillingRuntime {
	execute(
		operation: BillingRuntimeDispatchOperation,
		payload: unknown,
		principal: AthenaPrincipal,
	): Promise<unknown>;
}

export async function invokeBillingRuntimePort(
	runtime: AthenaBillingRuntime,
	operation: BillingRuntimeDispatchOperation,
	payload: unknown,
): Promise<unknown> {
	if (operation === "getCapabilities") {
		return runtime.getCapabilities(
			(payload && typeof payload === "object"
				? payload
				: {}) as BillingExecutionTarget,
		);
	}
	const separator = operation.indexOf(".");
	if (separator <= 0) {
		throw new AthenaBillingCapabilityError({
			operation,
			reason: "unsupported_operation",
		});
	}
	const portName = operation.slice(0, separator);
	const method = operation.slice(separator + 1);
	const port = (runtime as unknown as Record<string, unknown>)[portName];
	if (!port || typeof port !== "object") {
		throw new AthenaBillingCapabilityError({
			operation,
			reason: "unsupported_operation",
		});
	}
	const fn = (port as Record<string, unknown>)[method];
	if (typeof fn !== "function") {
		throw new AthenaBillingCapabilityError({
			operation,
			reason: "unsupported_operation",
		});
	}
	return (fn as (input: unknown) => Promise<unknown>)(payload ?? {});
}
