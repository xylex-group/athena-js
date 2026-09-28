import type { AthenaRuntimeDiscoveryDocument } from "../gateway/discovery-types.ts";
import {
  isNotificationOperation,
  NOTIFICATION_OPERATIONS,
  type NotificationOperation,
} from "../notifications/contract/operations.ts";
import { AthenaNotificationsError } from "../notifications/errors.ts";
import type { AthenaNotificationsModule } from "../notifications/types.ts";
import {
  type AthenaPrincipalResolutionFailure,
  normalizeAthenaRuntimeAuth,
  resolveAthenaRuntimePrincipal,
} from "../runtime/authority/index.ts";
import { requireAthenaRootClientInternals } from "../runtime/client-internals.ts";
import {
  createAthenaSessionAuthFromStores,
  readAuthRightsProjection,
} from "../runtime/data/athena-session.ts";
import { isAllowedRequestOrigin } from "../runtime/data/origin.ts";
import type { AthenaRuntimeAuthConfig } from "../runtime/data/principal.ts";
import {
  extraAllowedAppHttpOrigins,
  shouldEnforceCookieAwareRequestOrigin,
} from "../runtime/data/request-origin-policy.ts";
import type {
  AthenaRuntimeHttpSecurity,
  AthenaRuntimeSecurityMode,
} from "../runtime/data/types.ts";
import {
  isAthenaHttpBodyLimitError,
  parseAthenaIncomingHttpRequest,
} from "../runtime/transport/http/incoming.ts";

export const DEFAULT_ATHENA_NEXT_NOTIFICATIONS_ENDPOINT =
  "/api/athena/notifications";

export interface AthenaNotificationsHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}

export interface CreateAthenaNotificationsHandlersOptions {
  auth?: AthenaRuntimeAuthConfig;
  client: object;
  discoveryDocument: AthenaRuntimeDiscoveryDocument;
  security?: {
    http?: AthenaRuntimeHttpSecurity;
    mode?: AthenaRuntimeSecurityMode;
  };
}

type NotificationsClient = {
  notifications: AthenaNotificationsModule;
  withContext: (context: { userId?: string }) => NotificationsClient;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function jsonError(
  body: { code: string; message: string; errorNumber?: number },
  status: number
): Response {
  return Response.json({ error: body, ok: false, status }, { status });
}

function extraAllowedOrigins(
  clientConfig: { app?: { url?: string | null } },
  security?: CreateAthenaNotificationsHandlersOptions["security"]
): string[] {
  return extraAllowedAppHttpOrigins(clientConfig, security);
}

function shouldEnforceOrigin(
  request: Request,
  explicitTrusted: boolean
): boolean {
  return shouldEnforceCookieAwareRequestOrigin(request, explicitTrusted);
}

function principalFailure(failure: AthenaPrincipalResolutionFailure): {
  code: string;
  message: string;
} {
  if (failure.code === "ATHENA_AUTH_ORG_NOT_ALLOWED") {
    return {
      code: "ATHENA_NOTIFICATIONS_UNAUTHENTICATED",
      message: failure.message,
    };
  }
  return {
    code: "ATHENA_NOTIFICATIONS_UNAUTHENTICATED",
    message: failure.message,
  };
}

function encodeNotificationsError(error: unknown): Response {
  if (error instanceof AthenaNotificationsError) {
    const status =
      error.code === "ATHENA_NOTIFICATIONS_UNAUTHENTICATED"
        ? 401
        : error.code === "ATHENA_NOTIFICATIONS_EVENT_NOT_FOUND"
          ? 404
          : error.code === "ATHENA_NOTIFICATIONS_UNAVAILABLE"
            ? 503
            : 400;
    return jsonError(
      {
        code: error.code,
        errorNumber: error.errorNumber,
        message: error.message,
      },
      status
    );
  }
  return jsonError(
    {
      code: "ATHENA_NOTIFICATIONS_UNAVAILABLE",
      message: error instanceof Error ? error.message : "notifications failed",
    },
    503
  );
}

async function dispatchOperation(
  ns: AthenaNotificationsModule,
  operation: NotificationOperation,
  payload: Record<string, unknown>
): Promise<unknown> {
  switch (operation) {
    case NOTIFICATION_OPERATIONS.catalogList:
      return ns.catalog.list();
    case NOTIFICATION_OPERATIONS.eventsList:
      return ns.list({
        unread:
          typeof payload.unread === "boolean" ? payload.unread : undefined,
      });
    case NOTIFICATION_OPERATIONS.eventsMarkAllRead:
      return ns.markAllRead();
    case NOTIFICATION_OPERATIONS.eventsMarkRead:
      return ns.markRead({ id: String(payload.id ?? "") });
    case NOTIFICATION_OPERATIONS.preferencesList:
      return ns.preferences.list({
        organizationId:
          typeof payload.organizationId === "string"
            ? payload.organizationId
            : payload.organizationId === null
              ? null
              : undefined,
      });
    case NOTIFICATION_OPERATIONS.preferencesApplyMany:
      return ns.preferences.applyMany({
        mutations: Array.isArray(payload.mutations)
          ? (payload.mutations as never)
          : [],
      });
    case NOTIFICATION_OPERATIONS.preferencesReset:
      return ns.preferences.reset({
        channel: payload.channel as never,
        organizationId:
          typeof payload.organizationId === "string"
            ? payload.organizationId
            : null,
        topic: String(payload.topic ?? ""),
      });
    case NOTIFICATION_OPERATIONS.preferencesResetMany:
      return ns.preferences.resetMany({
        items: Array.isArray(payload.items) ? (payload.items as never) : [],
      });
    case NOTIFICATION_OPERATIONS.preferencesSetChannel:
      return ns.preferences.setChannel({
        channel: payload.channel as never,
        enabled: Boolean(payload.enabled),
        organizationId:
          typeof payload.organizationId === "string"
            ? payload.organizationId
            : payload.organizationId === null
              ? null
              : undefined,
      });
    case NOTIFICATION_OPERATIONS.preferencesUpdate:
      return ns.preferences.update({
        channel: payload.channel as never,
        digest:
          payload.digest === undefined ? undefined : (payload.digest as never),
        enabled: Boolean(payload.enabled),
        organizationId:
          typeof payload.organizationId === "string"
            ? payload.organizationId
            : payload.organizationId === null
              ? null
              : undefined,
        topic: String(payload.topic ?? ""),
      });
    case NOTIFICATION_OPERATIONS.preferencesUpdateMany:
      return ns.preferences.updateMany({
        items: Array.isArray(payload.items) ? (payload.items as never) : [],
      });
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

export function createAthenaNotificationsHandlers(
  options: CreateAthenaNotificationsHandlersOptions
): AthenaNotificationsHandlers {
  const internals = requireAthenaRootClientInternals(
    options.client,
    "createAthenaNotificationsHandlers({ client })"
  );

  const discovery: AthenaRuntimeDiscoveryDocument = {
    ...options.discoveryDocument,
    endpoints: {
      data: options.discoveryDocument.endpoints?.data ?? "/api/athena",
      ...(options.discoveryDocument.endpoints?.storage
        ? { storage: options.discoveryDocument.endpoints.storage }
        : {}),
      ...(options.discoveryDocument.endpoints?.billing
        ? { billing: options.discoveryDocument.endpoints.billing }
        : {}),
      notifications: DEFAULT_ATHENA_NEXT_NOTIFICATIONS_ENDPOINT,
      ...(options.discoveryDocument.endpoints?.auth === undefined
        ? {}
        : { auth: options.discoveryDocument.endpoints.auth }),
    },
  };

  const securityMode: AthenaRuntimeSecurityMode =
    options.security?.mode ??
    (options.auth !== undefined || internals.getAuthStores
      ? "authenticated"
      : "trusted");
  let auth: AthenaRuntimeAuthConfig | undefined = options.auth;
  if (auth === undefined && internals.getAuthStores) {
    auth = createAthenaSessionAuthFromStores({
      authorization: readAuthRightsProjection(internals.config),
      getStores: internals.getAuthStores,
    });
  }
  const authMaterial = normalizeAthenaRuntimeAuth(auth, securityMode);

  return {
    async GET() {
      return Response.json(discovery);
    },
    async POST(request: Request) {
      if (
        shouldEnforceOrigin(request, options.security?.mode === "trusted") &&
        !isAllowedRequestOrigin(
          request,
          extraAllowedOrigins(internals.config, options.security)
        )
      ) {
        return jsonError(
          {
            code: "ATHENA_NOTIFICATIONS_UNAUTHENTICATED",
            message: "cross-origin notifications request denied",
          },
          403
        );
      }

      let body: unknown;
      try {
        const incoming = await parseAthenaIncomingHttpRequest(request);
        if (incoming.body.byteLength === 0) {
          body = {};
        } else {
          body = JSON.parse(new TextDecoder().decode(incoming.body));
        }
      } catch (error) {
        if (isAthenaHttpBodyLimitError(error)) {
          return jsonError(
            {
              code: error.code,
              message: error.message,
            },
            error.status
          );
        }
        return jsonError(
          {
            code: "ATHENA_NOTIFICATIONS_UNAVAILABLE",
            message: "invalid JSON body",
          },
          400
        );
      }

      const envelope = asRecord(body);
      const operation = envelope.operation;
      if (
        typeof operation !== "string" ||
        !isNotificationOperation(operation)
      ) {
        return jsonError(
          {
            code: "ATHENA_NOTIFICATIONS_UNAVAILABLE",
            message: "operation is required",
          },
          400
        );
      }

      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => {
        headers[name] = value;
      });
      const resolution = await resolveAthenaRuntimePrincipal(
        authMaterial,
        securityMode,
        { headers, request }
      );
      if (!resolution.ok) {
        return jsonError(
          principalFailure(resolution.failure),
          resolution.failure.status
        );
      }
      if (resolution.resolved.principal.authenticated !== true) {
        return jsonError(
          {
            code: "ATHENA_NOTIFICATIONS_UNAUTHENTICATED",
            message: "Authentication is required for notifications.",
          },
          401
        );
      }
      const userId = resolution.resolved.principal.userId?.trim();
      if (!userId) {
        return jsonError(
          {
            code: "ATHENA_NOTIFICATIONS_UNAUTHENTICATED",
            message:
              "A signed-in user is required for this notifications operation.",
          },
          401
        );
      }

      const root = options.client as NotificationsClient;
      const scoped = root.withContext({ userId });
      const payload = asRecord(envelope.payload);
      try {
        const data = await dispatchOperation(
          scoped.notifications,
          operation,
          payload
        );
        return Response.json({ data, ok: true, status: 200 });
      } catch (error) {
        return encodeNotificationsError(error);
      }
    },
  };
}
