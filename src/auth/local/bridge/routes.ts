import { issueAuthBridgeCode } from "../../bridge/service.ts";
import {
	normalizeAuthBridgeDestinationOrigin,
	normalizeAuthBridgeRedirectPath,
} from "../../bridge/code.ts";
import { isUserEffectivelyBanned } from "../admin-contract.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import type { AuthRuntimeDependencies } from "../runtime-dependencies.ts";
import { asStringField, readJsonBody } from "../security.ts";

export const ATHENA_AUTH_BRIDGE_ISSUE_PATH = "/session/bridge/issue";
export const ATHENA_AUTH_BRIDGE_EXCHANGE_PATH = "/session/bridge/exchange";
export const ATHENA_AUTH_BRIDGE_EXCHANGE_INVALID =
	"ATHENA_AUTH_BRIDGE_EXCHANGE_INVALID";

export interface AuthBridgeExchangeResult {
	expiresAt: string;
	sessionId: string;
	sessionToken: string;
	userId: string;
}

function exchangeInvalid(): AthenaAuthRuntimeError {
	return new AthenaAuthRuntimeError(401, "Invalid bridge exchange", {
		code: ATHENA_AUTH_BRIDGE_EXCHANGE_INVALID,
	});
}

function isOriginAllowlisted(
	destinationOrigin: string,
	allowedOrigins: string[],
): boolean {
	return allowedOrigins.includes(destinationOrigin);
}

function sessionIsLive(expiresAt: Date | string): boolean {
	return new Date(expiresAt).getTime() > Date.now();
}

export async function handleAuthBridgeRoutes(
	request: Request,
	path: string,
	method: string,
	ctx: {
		deps: AuthRuntimeDependencies;
		headers: Headers;
		stores: AthenaAuthStores;
		traceId: string;
	},
): Promise<Response | undefined> {
	if (path === "/session/bridge/issue" && method === "POST") {
		if (!ctx.deps.config.bridge.enabled) {
			throw AthenaAuthRuntimeError.notFound("Not found");
		}
		const resolved = await ctx.deps.requireSession(request, ctx.stores);
		if (isUserEffectivelyBanned(resolved.user)) {
			throw AthenaAuthRuntimeError.forbidden();
		}
		const body = await readJsonBody(
			request,
			ctx.deps.config.security.bodyLimitBytes,
		);
		let destinationOrigin: string;
		try {
			destinationOrigin = normalizeAuthBridgeDestinationOrigin(
				asStringField(body, "destinationOrigin") ?? "",
			);
		} catch {
			throw AthenaAuthRuntimeError.badRequest("Invalid destination origin");
		}
		if (
			!isOriginAllowlisted(
				destinationOrigin,
				ctx.deps.config.bridge.allowedOrigins,
			)
		) {
			throw AthenaAuthRuntimeError.forbidden();
		}
		let redirectPath: string;
		try {
			redirectPath = normalizeAuthBridgeRedirectPath(
				asStringField(body, "redirectPath") ?? "/",
			);
		} catch {
			throw AthenaAuthRuntimeError.badRequest("Invalid redirect path");
		}
		const ttlMs = ctx.deps.config.bridge.codeTtlSeconds * 1000;
		const expiresAt = new Date(Date.now() + ttlMs);
		const issued = await issueAuthBridgeCode({
			destinationOrigin,
			expiresAt,
			organizationId: resolved.session.active_organization_id,
			redirectPath,
			sessionId: resolved.session.id,
			store: ctx.deps.getBridgeCodeStore(),
			userId: resolved.user.id,
		});
		return jsonResponse(
			200,
			{
				code: issued.code,
				destinationOrigin,
				expiresAt: expiresAt.toISOString(),
				redirectPath,
			},
			ctx.headers,
			ctx.traceId,
		);
	}

	if (path === "/session/bridge/exchange" && method === "POST") {
		if (!ctx.deps.config.bridge.enabled) {
			throw exchangeInvalid();
		}
		const body = await readJsonBody(
			request,
			ctx.deps.config.security.bodyLimitBytes,
		);
		const code = asStringField(body, "code");
		if (!code) {
			throw exchangeInvalid();
		}
		let destinationOrigin: string;
		try {
			destinationOrigin = normalizeAuthBridgeDestinationOrigin(
				asStringField(body, "destinationOrigin") ?? "",
			);
		} catch {
			throw exchangeInvalid();
		}
		const consumed = await ctx.deps.getBridgeCodeStore().consume({
			code,
			destinationOrigin,
		});
		if (!consumed) {
			throw exchangeInvalid();
		}
		const user = await ctx.stores.getUserById(consumed.userId);
		if (!user || isUserEffectivelyBanned(user)) {
			throw exchangeInvalid();
		}
		const sessions = await ctx.stores.listUserSessions(consumed.userId);
		const session = sessions.find((row) => row.id === consumed.sessionId);
		if (
			!session ||
			!session.active ||
			session.user_id !== user.id ||
			!sessionIsLive(session.expires_at)
		) {
			throw exchangeInvalid();
		}
		const result: AuthBridgeExchangeResult = {
			expiresAt: new Date(session.expires_at).toISOString(),
			sessionId: session.id,
			sessionToken: session.token,
			userId: user.id,
		};
		return jsonResponse(200, result, ctx.headers, ctx.traceId);
	}

	return undefined;
}
