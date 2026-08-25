import { AthenaChatError } from "../module.ts";

export function chatError(
	status: number,
	message: string,
	code: string,
): AthenaChatError {
	return new AthenaChatError({
		body: { code, message },
		endpoint: "local",
		message,
		method: "LOCAL",
		status,
	});
}

export function chatUnauthenticated(): AthenaChatError {
	return chatError(401, "Authentication required", "ATHENA_CHAT_UNAUTHENTICATED");
}

export function chatForbidden(message = "Insufficient permissions"): AthenaChatError {
	return chatError(403, message, "ATHENA_CHAT_FORBIDDEN");
}

export function chatNotFound(message = "Not found"): AthenaChatError {
	return chatError(404, message, "ATHENA_CHAT_NOT_FOUND");
}

export function chatConflict(message: string): AthenaChatError {
	return chatError(409, message, "ATHENA_CHAT_CONFLICT");
}

export function chatBadRequest(message: string): AthenaChatError {
	return chatError(400, message, "ATHENA_CHAT_BAD_REQUEST");
}

export function chatCapabilityUnsupported(
	capability: string,
	runtime: "local" | "remote" = "local",
): AthenaChatError {
	return new AthenaChatError({
		body: {
			capability,
			code: "ATHENA_CHAT_CAPABILITY_UNSUPPORTED",
			message: `Chat capability "${capability}" is unsupported on ${runtime} realtime.`,
			runtime,
		},
		endpoint: "local",
		message: `Chat capability "${capability}" is unsupported on ${runtime} realtime.`,
		method: "LOCAL",
		status: 501,
	});
}
