import { recordAthenaDevtoolsEvent } from "../../devtools/buffer/index.ts";
import type { AthenaDevtoolsDataEvent } from "../../devtools/protocol/index.ts";
import {
	ATHENA_DEVTOOLS_DATA_HEADER,
	ATHENA_DEVTOOLS_REQUEST_HEADER,
	ATHENA_DEVTOOLS_TRACE_HEADER,
} from "../../devtools/protocol/index.ts";
import { sanitizeAthenaDevtoolsDataEvent } from "../../devtools/sanitize/index.ts";
import { executeAthenaRequest } from "./executor.ts";
import type { AthenaRuntimeExecutionEvent, AthenaServerRuntime } from "./types.ts";

export {
	ATHENA_DEVTOOLS_DATA_HEADER,
	ATHENA_DEVTOOLS_REQUEST_HEADER,
	ATHENA_DEVTOOLS_TRACE_HEADER,
};
export type { AthenaDevtoolsDataEvent };

function nucleusEventName(event: AthenaRuntimeExecutionEvent): string {
	const semantic = event.semanticOperation;
	if (
		semantic === "insert" ||
		semantic === "update" ||
		semantic === "delete" ||
		semantic === "upsert"
	) {
		return `data.${semantic}`;
	}
	if (
		event.operation === "insert" ||
		event.operation === "update" ||
		event.operation === "delete"
	) {
		return `data.${event.operation}`;
	}
	return event.operation;
}

function nullableNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function transactionSemantics(
	value: AthenaRuntimeExecutionEvent["transactionSemantics"],
): AthenaDevtoolsDataEvent["transactionSemantics"] {
	if (
		value === "atomic" ||
		value === "backend-managed" ||
		value === "unknown"
	) {
		return value;
	}
	return null;
}

/** Allowlisted projection — no payload, records, or secrets. */
export function toAthenaDevtoolsDataEvent(
	event: AthenaRuntimeExecutionEvent,
): AthenaDevtoolsDataEvent {
	const projected = sanitizeAthenaDevtoolsDataEvent({
		affectedRows: nullableNumber(event.affectedRows),
		errorPhase: nullableString(event.errorPhase),
		event: nucleusEventName(event),
		eventId: nullableString(event.eventId),
		operation: event.operation,
		policyIds: Array.isArray(event.policyIds)
			? event.policyIds.filter(
					(id): id is string => typeof id === "string" && Boolean(id.trim()),
				)
			: null,
		policyOutcome: nullableString(event.decision),
		principal: {
			authority: nullableString(event.principalAuthority),
		},
		requestId: nullableString(event.requestId),
		resource: nullableString(event.resource),
		timings: {
			afterHooksMs: nullableNumber(event.afterHooksMs),
			authorizeMs: nullableNumber(event.authorizeMs),
			beforeHooksMs: nullableNumber(event.beforeHooksMs),
			executeMs: nullableNumber(event.executeMs),
			prepareMs: nullableNumber(event.prepareMs),
			totalMs: nullableNumber(event.totalMs),
		},
		traceId: nullableString(event.traceId),
		transactionSemantics: transactionSemantics(event.transactionSemantics),
	});
	if (projected) {
		return projected;
	}
	return {
		affectedRows: null,
		errorPhase: null,
		event: nucleusEventName(event),
		eventId: null,
		operation: event.operation,
		policyIds: null,
		policyOutcome: null,
		principal: { authority: null },
		requestId: null,
		resource: null,
		timings: {
			afterHooksMs: null,
			authorizeMs: null,
			beforeHooksMs: null,
			executeMs: null,
			prepareMs: null,
			totalMs: null,
		},
		traceId: null,
		transactionSemantics: null,
	};
}

export function requestWantsAthenaDevtools(request: Request): boolean {
	return request.headers.get(ATHENA_DEVTOOLS_REQUEST_HEADER)?.trim() === "1";
}

export function wrapRuntimeForAthenaDevtools(
	runtime: AthenaServerRuntime,
	sink?: AthenaDevtoolsDataEvent[],
	correlation?: { traceId?: string | null },
): AthenaServerRuntime {
	const previous = runtime.onExecutionEvent;
	const wrapped: AthenaServerRuntime = {
		...runtime,
		execute(request, context) {
			return executeAthenaRequest(wrapped, request, context);
		},
		onExecutionEvent(event) {
			previous?.(event);
			const sanitized = toAthenaDevtoolsDataEvent(event);
			sink?.push(sanitized);
			if (correlation && sanitized.traceId) {
				correlation.traceId = sanitized.traceId;
			}
			if (process.env.NODE_ENV !== "production") {
				recordAthenaDevtoolsEvent(sanitized);
			}
		},
	};
	return wrapped;
}

/** Lightweight correlation headers only — never URL-encoded event payloads. */
export function attachAthenaDevtoolsCorrelationHeaders(
	response: Response,
	traceId?: string | null,
): Response {
	const headers = new Headers(response.headers);
	const resolvedTrace = traceId?.trim();
	if (resolvedTrace) {
		headers.set(ATHENA_DEVTOOLS_TRACE_HEADER, resolvedTrace);
	}
	headers.delete(ATHENA_DEVTOOLS_DATA_HEADER);
	const extra = [
		ATHENA_DEVTOOLS_TRACE_HEADER,
		"x-athena-request-id",
		"x-request-id",
	].join(", ");
	const exposed = headers.get("Access-Control-Expose-Headers");
	headers.set(
		"Access-Control-Expose-Headers",
		exposed ? `${exposed}, ${extra}` : extra,
	);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}
