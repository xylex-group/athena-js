import { isLocalAthenaAuthConfig } from "../../auth/config.ts";
import type {
	AthenaRequestContext,
	AthenaRequestContextProvider,
} from "../../client/request-context.ts";
import type { AthenaChatCallOptions } from "../types.ts";
import type {
	AthenaPrincipalResolver,
	AthenaResolvedPrincipal,
} from "../../runtime/data/principal.ts";
import {
	normalizeAthenaRuntimeAuth,
	resolveAthenaRuntimePrincipal,
} from "../../runtime/authority/index.ts";
import { chatBadRequest, chatUnauthenticated } from "./errors.ts";

export type ChatActor = {
	organizationId: string;
	userId: string;
};

export function actorFromResolved(
	resolved: AthenaResolvedPrincipal | null | undefined,
): ChatActor {
	const userId = resolved?.principal.userId?.trim();
	const organizationId = resolved?.principal.organizationId?.trim();
	if (!resolved?.principal.authenticated || !userId) {
		throw chatUnauthenticated();
	}
	if (!organizationId) {
		throw chatBadRequest("Authenticated principal is missing organization_id.");
	}
	return { organizationId, userId };
}

/**
 * INV-CHAT-011: actor identity comes only from the root principal resolver.
 * Call-option tokens may feed the resolver; payload fields never override it.
 */
export async function resolveChatActor(
	resolvePrincipal: AthenaPrincipalResolver,
	options?: AthenaChatCallOptions,
): Promise<ChatActor> {
	const headers = new Headers(options?.headers);
	if (options?.bearerToken && !headers.has("authorization")) {
		headers.set("authorization", "Bearer " + options.bearerToken);
	}
	if (options?.sessionToken && !headers.has("cookie")) {
		headers.set("cookie", `athena_session=${options.sessionToken}`);
	}
	const resolved = await resolvePrincipal({ headers });
	return actorFromResolved(resolved);
}

/** Payload fields that must never become actor identity. */
export type ChatRootPrincipalSource = {
	auth?: unknown;
	context?: AthenaRequestContext | AthenaRequestContextProvider;
	databaseUrl?: string;
	resolvePrincipal?: AthenaPrincipalResolver;
};

async function resolveRootContext(
	context: ChatRootPrincipalSource["context"],
): Promise<AthenaRequestContext | undefined> {
	if (typeof context === "function") {
		return context();
	}
	return context;
}

function applyRootContextHeaders(headers: Headers, context?: AthenaRequestContext): Headers {
	const next = new Headers(headers);
	if (context?.headers) {
		for (const [name, value] of Object.entries(context.headers)) {
			if (value && !next.has(name)) {
				next.set(name, value);
			}
		}
	}
	if (context?.bearerToken && !next.has("authorization")) {
		next.set("authorization", "Bearer " + context.bearerToken);
	}
	if (context?.sessionToken && !next.has("cookie")) {
		next.set("cookie", `athena_session=${context.sessionToken}`);
	} else if (context?.cookie && !next.has("cookie")) {
		next.set("cookie", context.cookie);
	}
	if (context?.organizationId && !next.has("x-athena-organization")) {
		next.set("x-athena-organization", context.organizationId);
	}
	return next;
}

function principalFromRootContext(
	context?: AthenaRequestContext,
): AthenaResolvedPrincipal | null {
	const userId = context?.userId?.trim();
	const organizationId = context?.organizationId?.trim();
	if (!userId || !organizationId) {
		return null;
	}
	return {
		authority: "custom-trusted",
		principal: {
			authenticated: true,
			grants: [],
			organizationId,
			rights: [],
			userId,
		},
	};
}

/**
 * INV-CHAT-011 composition: explicit resolver, then Embedded Auth session,
 * then server-owned request context. Payload fields never enter this graph.
 */
export function createRootChatPrincipalResolver(
	source: ChatRootPrincipalSource,
): AthenaPrincipalResolver {
	if (source.resolvePrincipal) {
		return source.resolvePrincipal;
	}

	const authMaterial = isLocalAthenaAuthConfig(source.auth)
		? normalizeAthenaRuntimeAuth(
				{ mode: "athena-session" },
				"trusted",
				{ databaseUrl: source.databaseUrl },
			)
		: { mode: false as const };

	return async (input) => {
		const context = await resolveRootContext(source.context);
		const headers = applyRootContextHeaders(input.headers, context);
		if (authMaterial.mode !== false) {
			const headerRecord: Record<string, string> = {};
			headers.forEach((value, name) => {
				headerRecord[name] = value;
			});
			const outcome = await resolveAthenaRuntimePrincipal(authMaterial, "trusted", {
				headers: headerRecord,
				request: input.request,
				requestId: input.requestId,
			});
			if (outcome.ok && outcome.resolved.principal.authenticated) {
				return outcome.resolved;
			}
		}
		return principalFromRootContext(context);
	};
}

export const CHAT_NON_AUTHORITATIVE_IDENTITY_KEYS = [
	"sender_id",
	"senderId",
	"user_id",
	"userId",
	"organization_id",
	"organizationId",
	"created_by",
	"createdBy",
] as const;
