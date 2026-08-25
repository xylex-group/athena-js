import { createAuthorizationURL } from "../../oauth2/index.ts";
import { AthenaSocialServerError, AthenaSocialServerNotWiredError } from "./errors.ts";

export async function buildSocialAuthorizationURL(
	input: Parameters<typeof createAuthorizationURL>[0],
) {
	return createAuthorizationURL(input);
}

export interface SocialRedirectPort {
	issue(input: { url: string }): Promise<never>;
}

/** Redirect issuance after authorize is a follow-on HTTP slice. */
export function createSocialRedirectPort(): SocialRedirectPort {
	return {
		issue() {
			return Promise.reject(new AthenaSocialServerNotWiredError());
		},
	};
}

const TOKEN_QUERY_KEYS = [
	"access_token",
	"id_token",
	"refresh_token",
	"session_token",
	"token",
] as const;

function socialRedirectError(code: string, message: string): AthenaSocialServerError {
	return new AthenaSocialServerError(code, message);
}

function stripDefaultPort(url: URL): string {
	const protocol = url.protocol.toLowerCase();
	const host = url.hostname.toLowerCase();
	const port =
		url.port === "" ||
		(protocol === "https:" && url.port === "443") ||
		(protocol === "http:" && url.port === "80")
			? ""
			: `:${url.port}`;
	return `${protocol}//${host}${port}`;
}

function parseHttpUrl(value: string): URL {
	if (value.startsWith("//") || value.includes(":///") ) {
		throw socialRedirectError(
			"ATHENA_AUTH_REDIRECT_UNTRUSTED",
			"protocol-relative redirects are not trusted",
		);
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw socialRedirectError(
			"ATHENA_AUTH_REDIRECT_UNTRUSTED",
			"redirect URL is invalid",
		);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw socialRedirectError(
			"ATHENA_AUTH_REDIRECT_UNTRUSTED",
			"redirect URL must be http or https",
		);
	}
	if (parsed.username !== "" || parsed.password !== "") {
		throw socialRedirectError(
			"ATHENA_AUTH_REDIRECT_UNTRUSTED",
			"redirect URL must not contain credentials",
		);
	}
	return parsed;
}

function originAllowed(
	candidate: URL,
	trustedOrigins: readonly string[],
): boolean {
	const candidateOrigin = stripDefaultPort(candidate);
	for (const origin of trustedOrigins) {
		try {
			if (stripDefaultPort(new URL(origin)) === candidateOrigin) {
				return true;
			}
		} catch {
			continue;
		}
	}
	return false;
}

function stripTokenQuery(url: URL): URL {
	for (const key of TOKEN_QUERY_KEYS) {
		url.searchParams.delete(key);
	}
	return url;
}

export function resolveSocialCallbackUri(input: {
	basePath?: string;
	baseURL: string;
	provider: string;
}): string {
	const base = String(input.baseURL ?? "").replace(/\/+$/, "");
	const path = String(input.basePath ?? "/api/auth").replace(/\/+$/, "") ||
		"/api/auth";
	const provider = encodeURIComponent(String(input.provider ?? "").trim());
	return `${base}${path}/callback/${provider}`;
}

export function validateSocialCallbackUri(
	url: string,
	options: { production: boolean; trustedOrigins: readonly string[] },
): string {
	const parsed = stripTokenQuery(parseHttpUrl(url));
	if (!parsed.pathname.includes("/callback/")) {
		throw socialRedirectError(
			"ATHENA_AUTH_CALLBACK_URL_INVALID",
			"callback URL path must include /callback/{provider}",
		);
	}
	if (
		options.production &&
		options.trustedOrigins.length === 0
	) {
		throw socialRedirectError(
			"ATHENA_AUTH_REDIRECT_UNTRUSTED",
			"production callback URL requires trusted origins",
		);
	}
	if (
		options.trustedOrigins.length > 0 &&
		!originAllowed(parsed, options.trustedOrigins)
	) {
		throw socialRedirectError(
			"ATHENA_AUTH_REDIRECT_UNTRUSTED",
			"callback URL origin is not trusted",
		);
	}
	return parsed.toString();
}

export function validatePostAuthRedirect(
	url: string,
	options: { production: boolean; trustedOrigins: readonly string[] },
): string {
	const parsed = stripTokenQuery(parseHttpUrl(url));
	if (options.production && options.trustedOrigins.length === 0) {
		throw socialRedirectError(
			"ATHENA_AUTH_REDIRECT_UNTRUSTED",
			"production post-auth redirect requires trusted origins",
		);
	}
	if (
		options.trustedOrigins.length > 0 &&
		!originAllowed(parsed, options.trustedOrigins)
	) {
		throw socialRedirectError(
			"ATHENA_AUTH_REDIRECT_UNTRUSTED",
			"post-auth redirect origin is not trusted",
		);
	}
	return parsed.toString();
}
