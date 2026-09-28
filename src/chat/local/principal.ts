import { isLocalAthenaAuthConfig } from "../../auth/config.ts";
import type {
  AthenaRequestContext,
  AthenaRequestContextProvider,
} from "../../client/request-context.ts";
import {
  normalizeAthenaRuntimeAuth,
  resolveAthenaRuntimePrincipal,
} from "../../runtime/authority/index.ts";
import type {
  AthenaPrincipal,
  AthenaPrincipalResolver,
  AthenaResolvedPrincipal,
} from "../../runtime/data/principal.ts";
import { normalizeAthenaPrincipal } from "../../runtime/data/principal.ts";
import { tryParseAthenaRightKey } from "../../rights/key.ts";
import type { AthenaChatCallOptions } from "../types.ts";
import { chatBadRequest, chatUnauthenticated } from "./errors.ts";

export interface ChatExecutionContext {
  readonly correlationId?: string;
  readonly organizationId: string;
  readonly principal: AthenaPrincipal;
  readonly rightsValid: boolean;
  readonly resolvedPrincipal: AthenaResolvedPrincipal;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly userId: string;
}

export function executionContextFromResolved(
  resolved: AthenaResolvedPrincipal | null | undefined,
  options?: AthenaChatCallOptions
): ChatExecutionContext {
  if (!resolved) {
    throw chatUnauthenticated();
  }
  const principal = normalizeAthenaPrincipal(resolved.principal, {
    source:
      resolved.authority === "service"
        ? "service"
        : resolved.authority === "athena-session"
          ? "athena-session"
          : "custom-trusted",
  });
  const normalizedResolved: AthenaResolvedPrincipal = {
    authority: resolved.authority,
    principal,
  };
  const rightsValid = resolved.principal.rights.every(
    (right) => tryParseAthenaRightKey(String(right)) !== undefined
  );
  const userId = principal.userId?.trim();
  const serviceId = principal.service?.trim();
  const organizationId = principal?.organizationId?.trim();
  if (!(principal?.authenticated && (userId || serviceId))) {
    throw chatUnauthenticated();
  }
  if (!organizationId) {
    throw chatBadRequest("Authenticated principal is missing organization_id.");
  }
  return {
    ...(options?.correlationId ? { correlationId: options.correlationId } : {}),
    organizationId,
    principal,
    rightsValid,
    resolvedPrincipal: normalizedResolved,
    ...(options?.requestId ? { requestId: options.requestId } : {}),
    ...(options?.traceId ? { traceId: options.traceId } : {}),
    userId: userId ?? serviceId ?? "",
  };
}

/**
 * INV-CHAT-011: actor identity comes only from the root principal resolver.
 * Call-option tokens may feed the resolver; payload fields never override it.
 */
export async function resolveChatContext(
  resolvePrincipal: AthenaPrincipalResolver,
  options?: AthenaChatCallOptions
): Promise<ChatExecutionContext> {
  const headers = new Headers(options?.headers);
  if (options?.bearerToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${options.bearerToken}`);
  }
  if (options?.sessionToken && !headers.has("cookie")) {
    headers.set("cookie", `athena_session=${options.sessionToken}`);
  }
  const resolved = await resolvePrincipal({ headers });
  return executionContextFromResolved(resolved, {
    ...options,
    correlationId:
      options?.correlationId ??
      headers.get("x-athena-correlation-id") ??
      undefined,
    requestId:
      options?.requestId ?? headers.get("x-athena-request-id") ?? undefined,
    traceId:
      options?.traceId ?? headers.get("x-athena-trace-id") ?? undefined,
  });
}

/** Payload fields that must never become actor identity. */
export interface ChatRootPrincipalSource {
  auth?: unknown;
  callOptions?: Pick<
    AthenaChatCallOptions,
    "bearerToken" | "cookie" | "headers" | "sessionToken"
  >;
  context?: AthenaRequestContext | AthenaRequestContextProvider;
  databaseUrl?: string;
  resolvedPrincipal?: AthenaResolvedPrincipal;
  resolvePrincipal?: AthenaPrincipalResolver;
}

async function resolveRootContext(
  context: ChatRootPrincipalSource["context"]
): Promise<AthenaRequestContext | undefined> {
  if (typeof context === "function") {
    return context();
  }
  return context;
}

function applyRootContextHeaders(
  headers: Headers,
  context?: AthenaRequestContext
): Headers {
  const next = new Headers(headers);
  if (context?.headers) {
    for (const [name, value] of Object.entries(context.headers)) {
      if (value && !next.has(name)) {
        next.set(name, value);
      }
    }
  }
  if (context?.bearerToken && !next.has("authorization")) {
    next.set("authorization", `Bearer ${context.bearerToken}`);
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
  resolvedPrincipal?: AthenaResolvedPrincipal
): AthenaResolvedPrincipal | null {
  if (resolvedPrincipal) {
    return resolvedPrincipal;
  }
  const userId = context?.userId?.trim();
  const organizationId = context?.organizationId?.trim();
  if (!(userId && organizationId)) {
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
  source: ChatRootPrincipalSource
): AthenaPrincipalResolver {
  if (source.resolvePrincipal) {
    return source.resolvePrincipal;
  }

  const authMaterial = isLocalAthenaAuthConfig(source.auth)
    ? normalizeAthenaRuntimeAuth({ mode: "athena-session" }, "trusted", {
        databaseUrl: source.databaseUrl,
      })
    : { mode: false as const };

  return async (input) => {
    const context = await resolveRootContext(source.context);
    if (source.resolvedPrincipal) {
      return source.resolvedPrincipal;
    }
    const headers = new Headers(source.callOptions?.headers);
    input.headers.forEach((value, name) => {
      headers.set(name, value);
    });
    if (source.callOptions?.bearerToken && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${source.callOptions.bearerToken}`);
    }
    if (source.callOptions?.sessionToken && !headers.has("cookie")) {
      headers.set(
        "cookie",
        `athena_session=${source.callOptions.sessionToken}`
      );
    } else if (source.callOptions?.cookie && !headers.has("cookie")) {
      headers.set("cookie", source.callOptions.cookie);
    }
    const resolvedHeaders = applyRootContextHeaders(headers, context);
    if (authMaterial.mode !== false) {
      const headerRecord: Record<string, string> = {};
      resolvedHeaders.forEach((value, name) => {
        headerRecord[name] = value;
      });
      const outcome = await resolveAthenaRuntimePrincipal(
        authMaterial,
        "trusted",
        {
          headers: headerRecord,
          request: input.request,
          requestId: input.requestId,
        }
      );
      if (outcome.ok && outcome.resolved.principal.authenticated) {
        return outcome.resolved;
      }
      return null;
    }
    return principalFromRootContext(context, source.resolvedPrincipal);
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
