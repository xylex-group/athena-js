import { encodeAthenaGatewayFailure } from "../../gateway/server/encode.ts";
import { getAthenaDevtoolsProcessEventBuffer } from "../buffer/index.ts";

/** Development event channel: GET /api/athena/devtools/v1/events */
export const ATHENA_DEVTOOLS_EVENTS_PATH = "/api/athena/devtools/v1/events";
/** Optional SSE: GET /api/athena/devtools/v1/stream */
export const ATHENA_DEVTOOLS_STREAM_PATH = "/api/athena/devtools/v1/stream";

export const ATHENA_DEVTOOLS_DISABLED = "ATHENA_DEVTOOLS_DISABLED";
export const ATHENA_DEVTOOLS_STREAM_UNAVAILABLE =
	"ATHENA_DEVTOOLS_STREAM_UNAVAILABLE";

export function isAthenaDevtoolsHttpEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return env.NODE_ENV !== "production";
}

function parseLimit(url: URL): number | undefined {
	const raw = url.searchParams.get("limit");
	if (!raw) {
		return 50;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return 50;
	}
	return parsed;
}

export function createAthenaDevtoolsDisabledResponse(requestId: string): Response {
	return encodeAthenaGatewayFailure({
		code: ATHENA_DEVTOOLS_DISABLED,
		message: "Athena DevTools event channel is disabled.",
		requestId,
		status: 404,
	});
}

export function handleAthenaDevtoolsEventsRequest(
	request: Request,
	requestId: string,
): Response {
	if (!isAthenaDevtoolsHttpEnabled()) {
		return createAthenaDevtoolsDisabledResponse(requestId);
	}
	if (request.method !== "GET" && request.method !== "HEAD") {
		return encodeAthenaGatewayFailure({
			code: "ATHENA_RUNTIME_UNSUPPORTED_OPERATION",
			message: `Athena DevTools does not accept ${request.method} for ${ATHENA_DEVTOOLS_EVENTS_PATH}.`,
			requestId,
			status: 405,
		});
	}
	const url = new URL(request.url);
	const events = getAthenaDevtoolsProcessEventBuffer().list({
		limit: parseLimit(url),
		since: url.searchParams.get("since") ?? undefined,
	});
	return new Response(JSON.stringify({ events }), {
		headers: {
			"content-type": "application/json; charset=utf-8",
			"x-athena-request-id": requestId,
			"x-request-id": requestId,
		},
		status: 200,
	});
}

export function handleAthenaDevtoolsStreamRequest(
	request: Request,
	requestId: string,
): Response {
	if (!isAthenaDevtoolsHttpEnabled()) {
		return createAthenaDevtoolsDisabledResponse(requestId);
	}
	if (request.method !== "GET" && request.method !== "HEAD") {
		return encodeAthenaGatewayFailure({
			code: ATHENA_DEVTOOLS_STREAM_UNAVAILABLE,
			message: `Athena DevTools does not accept ${request.method} for ${ATHENA_DEVTOOLS_STREAM_PATH}.`,
			requestId,
			status: 405,
		});
	}
	const url = new URL(request.url);
	const events = getAthenaDevtoolsProcessEventBuffer().list({
		limit: parseLimit(url),
		since: url.searchParams.get("since") ?? undefined,
	});
	const body = events
		.map((event) => `data: ${JSON.stringify(event)}\n\n`)
		.join("");
	return new Response(body, {
		headers: {
			"cache-control": "no-cache",
			"content-type": "text/event-stream; charset=utf-8",
			"x-athena-request-id": requestId,
			"x-request-id": requestId,
		},
		status: 200,
	});
}
