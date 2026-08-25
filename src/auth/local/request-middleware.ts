import { ATHENA_AUTH_DEFAULT_BASE_PATH } from "../contract/index.ts";
import {
	createMemoryAuthTraceRecorder,
	createNoopTrace,
	createPostgresAuthTraceRecorder,
	runWithAuthTrace,
} from "../observability/traces.ts";
import {
	AthenaAuthRuntimeError,
	createTraceId,
	errorResponse,
} from "./errors.ts";
import {
	attachAuthTimingHeaders,
	currentAuthRequestTiming,
	runWithAuthRequestTiming,
} from "./request-timing.ts";
import { enforceOrigin } from "./security.ts";
import type { AuthRuntimeDependencies } from "./runtime-dependencies.ts";
import { normalizePath } from "./runtime-helpers.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";

export interface AuthRequestMiddlewareOptions {
	deps: AuthRuntimeDependencies;
	handleRoute: (
		request: Request,
		path: string,
		currentStores: AthenaAuthStores,
		headers: Headers,
		traceId: string,
	) => Promise<Response>;
}

export function createAuthRequestMiddleware(
	options: AuthRequestMiddlewareOptions,
): (request: Request) => Promise<Response> {
	const { deps, handleRoute } = options;
	return async (request: Request): Promise<Response> => {
		const { config, observability, ensureReady } = deps;
		const database = deps.getDatabase();

		const started = performance.now();
		return runWithAuthRequestTiming(async () => {
			const parseStarted = performance.now();
			const traceId =
				request.headers.get("x-athena-trace-id")?.trim() ||
				request.headers.get("x-request-id")?.trim() ||
				createTraceId();
			const headers = new Headers();
			headers.set("x-athena-trace-id", traceId);
			headers.set("x-request-id", traceId);
			let path = "/";
			try {
				const url = new URL(request.url);
				path = normalizePath(
					url.pathname,
					config.basePath || ATHENA_AUTH_DEFAULT_BASE_PATH,
				);
			} catch {
				path = "/";
			}
			const traceRecorder = observability.traces.enabled
				? database
					? createPostgresAuthTraceRecorder(
							database,
							observability.traces.sampleRate,
						)
					: createMemoryAuthTraceRecorder(
							{ records: [] },
							observability.traces.sampleRate,
						)
				: { start: () => createNoopTrace() };
			const trace = traceRecorder.start({
				method: request.method.toUpperCase(),
				path,
				startedAt: new Date(),
				traceId,
			});
			return runWithAuthTrace(trace, async () => {
				try {
					const method = request.method.toUpperCase();
					const isStateProtectedSocialCallback =
						method === "POST" && /^\/callback\/[^/]+$/.test(path);
					if (!isStateProtectedSocialCallback) {
						enforceOrigin(request, config.security.trustedOrigins);
					}
					currentAuthRequestTiming()?.addSpan(
						"parse",
						performance.now() - parseStarted,
					);
					const currentStores = await ensureReady();
					const response = await handleRoute(
						request,
						path,
						currentStores,
						headers,
						traceId,
					);
					const totalMs = performance.now() - started;
					await trace.success(response.status, totalMs);
					return attachAuthTimingHeaders(response, totalMs);
				} catch (error) {
					const status =
						error instanceof AthenaAuthRuntimeError ? error.status : 500;
					const totalMs = performance.now() - started;
					await trace.failure(error, status, totalMs);
					return attachAuthTimingHeaders(
						errorResponse(error, traceId),
						totalMs,
					);
				}
			});
		});

	};
}

export function createRequestMiddleware(
	options: AuthRequestMiddlewareOptions,
): (request: Request) => Promise<Response> {
	return createAuthRequestMiddleware(options);
}
