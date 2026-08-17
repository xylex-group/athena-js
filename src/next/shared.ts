import { AthenaConfigurationError } from "../config/errors.ts";
import type { AthenaRequestContext } from "../v3-client-core.ts";

export interface AthenaRequestHeadersBag {
	get: (name: string) => string | null;
}

export interface AthenaRequestCookiesBag {
	getAll: () => Array<{ name: string; value: string }>;
}

export type AthenaRequestHeadersInput =
	| AthenaRequestHeadersBag
	| Record<string, string | null | undefined>;

export type AthenaRequestCookiesInput =
	| AthenaRequestCookiesBag
	| string
	| null
	| undefined;

export interface AthenaServerRequestOptions {
	forceNoCache?: boolean;
	headers?: Record<string, string>;
	requestCookies?: AthenaRequestCookiesInput;
	requestHeaders?: AthenaRequestHeadersInput;
}

function normalizeOptional(
	value: string | null | undefined,
): string | undefined {
	const normalized = value?.trim();
	return normalized || undefined;
}

function readHeader(
	headers: AthenaRequestHeadersInput | undefined,
	target: string,
): string | undefined {
	if (!headers) {
		return undefined;
	}
	if (typeof (headers as AthenaRequestHeadersBag).get === "function") {
		return normalizeOptional((headers as AthenaRequestHeadersBag).get(target));
	}

	const normalizedTarget = target.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === normalizedTarget) {
			return normalizeOptional(value ?? undefined);
		}
	}
	return undefined;
}

function serializeCookies(
	cookies: AthenaRequestCookiesInput,
): string | undefined {
	if (typeof cookies === "string") {
		return normalizeOptional(cookies);
	}
	if (!cookies) {
		return undefined;
	}
	const values = cookies
		.getAll()
		.map((cookie) => {
			const name = normalizeOptional(cookie.name);
			return name ? `${name}=${cookie.value}` : undefined;
		})
		.filter((value): value is string => Boolean(value));
	return values.length ? values.join("; ") : undefined;
}

function resolveBearerToken(
	authorization: string | undefined,
): string | undefined {
	const match = authorization?.match(/^Bearer\s+(.+)$/i);
	return normalizeOptional(match?.[1]);
}

const NEXT_SERVER_RUNTIME_REQUIRED_MESSAGE =
	"Athena Next server helpers require a Next.js server runtime. Call them from a Server Component or Route Handler, or pass requestHeaders/requestCookies explicitly.";

function throwNextServerRuntimeRequired(cause: unknown): never {
	// AthenaConfigurationError forwards `options.cause` to Error via super(message, options).
	throw new AthenaConfigurationError(
		"ATHENA_NEXT_SERVER_RUNTIME_REQUIRED",
		NEXT_SERVER_RUNTIME_REQUIRED_MESSAGE,
		undefined,
		{ cause },
	);
}

async function loadNextHeadersModule() {
	try {
		return await import("next/headers");
	} catch (error) {
		throwNextServerRuntimeRequired(error);
	}
}

/**
 * Load request headers/cookies from Next.js. Import can succeed when `next` is
 * installed as a dependency but `headers()`/`cookies()` still throw outside a
 * Server Component / Route Handler request scope — map that to the same
 * configuration error callers and tests expect.
 */
async function loadNextRequestInputs(): Promise<{
	requestCookies: AthenaRequestCookiesInput;
	requestHeaders: AthenaRequestHeadersInput;
}> {
	const nextHeaders = await loadNextHeadersModule();
	try {
		const [headersList, cookiesList] = await Promise.all([
			nextHeaders.headers(),
			nextHeaders.cookies(),
		]);
		return {
			requestCookies: cookiesList,
			requestHeaders: headersList,
		};
	} catch (error) {
		throwNextServerRuntimeRequired(error);
	}
}

export async function resolveNextRequestContext(
	options: AthenaServerRequestOptions = {},
): Promise<AthenaRequestContext> {
	let requestHeaders = options.requestHeaders;
	let requestCookies = options.requestCookies;

	if (!(requestHeaders || requestCookies)) {
		const nextRequest = await loadNextRequestInputs();
		requestHeaders = nextRequest.requestHeaders;
		requestCookies = nextRequest.requestCookies;
	}

	const cookie =
		serializeCookies(requestCookies) ?? readHeader(requestHeaders, "cookie");
	const authorization = readHeader(requestHeaders, "authorization");

	return {
		bearerToken: resolveBearerToken(authorization),
		cookie,
		forceNoCache: options.forceNoCache,
		headers: {
			...(options.headers ?? {}),
			...(cookie ? { cookie } : {}),
			...(authorization ? { authorization } : {}),
		},
	};
}

export const resolveServerRequestContext = resolveNextRequestContext;
