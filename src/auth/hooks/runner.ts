import { AthenaAuthRuntimeError } from "../local/errors.ts";
import type { AthenaAuthImplementedDomainEvent } from "./events.ts";
import type {
	AthenaAuthAfterHookPayload,
	AthenaAuthBeforeHookPayload,
	AthenaAuthHookContext,
	AthenaAuthHookErrorInput,
	AthenaAuthHookHandler,
	AthenaAuthHookHandlerList,
	AthenaAuthHooks,
} from "./types.ts";

function asHandlerList<
	E extends AthenaAuthImplementedDomainEvent,
	Phase extends "after" | "before",
>(
	value: AthenaAuthHookHandlerList<E, Phase> | undefined,
): AthenaAuthHookHandler<E, Phase>[] {
	if (!value) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

function toHookRejected(error: unknown): AthenaAuthRuntimeError {
	if (error instanceof AthenaAuthRuntimeError) {
		return error;
	}
	const message =
		error instanceof Error && error.message.trim()
			? error.message
			: "Auth hook rejected the operation";
	return new AthenaAuthRuntimeError(400, message, {
		cause: error,
		code: "ATHENA_AUTH_HOOK_REJECTED",
	});
}

async function reportHookError(
	hooks: AthenaAuthHooks | undefined,
	input: AthenaAuthHookErrorInput,
): Promise<void> {
	if (!hooks?.onError) {
		return;
	}
	try {
		await hooks.onError(input);
	} catch (error) {
		console.error("[athena-auth]", {
			code: "ATHENA_AUTH_HOOK_ON_ERROR_FAILED",
			error: error instanceof Error ? error.message : String(error),
			event: input.event,
			eventId: input.eventId,
			phase: "onError",
			traceId: input.traceId,
		});
	}
}

export async function runAuthBeforeHooks<
	E extends AthenaAuthImplementedDomainEvent,
>(
	hooks: AthenaAuthHooks | undefined,
	payload: AthenaAuthBeforeHookPayload<E>,
): Promise<void> {
	const handlers = asHandlerList(
		hooks?.before?.[payload.event] as
			| AthenaAuthHookHandlerList<E, "before">
			| undefined,
	);
	for (const handler of handlers) {
		try {
			await handler(payload);
		} catch (error) {
			await reportHookError(hooks, {
				error,
				event: payload.event,
				eventId: payload.eventId,
				phase: "before",
				traceId: payload.traceId,
			});
			throw toHookRejected(error);
		}
	}
}

export async function runAuthAfterHooks<
	E extends AthenaAuthImplementedDomainEvent,
>(
	hooks: AthenaAuthHooks | undefined,
	payload: AthenaAuthAfterHookPayload<E>,
): Promise<void> {
	const handlers = asHandlerList(
		hooks?.after?.[payload.event] as
			| AthenaAuthHookHandlerList<E, "after">
			| undefined,
	);
	for (const handler of handlers) {
		try {
			await handler(payload);
		} catch (error) {
			await reportHookError(hooks, {
				error,
				event: payload.event,
				eventId: payload.eventId,
				phase: "after",
				traceId: payload.traceId,
			});
		}
	}
}

export function createAuthHookContext(
	context: Omit<AthenaAuthHookContext, "eventId">,
	eventId = crypto.randomUUID(),
): AthenaAuthHookContext {
	return {
		actor: context.actor,
		eventId,
		request: context.request,
		traceId: context.traceId,
	};
}
