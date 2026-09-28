import {
  handleAthenaDevtoolsEventsRequest,
  handleAthenaDevtoolsStreamRequest,
  isAthenaDevtoolsHttpEnabled,
} from "../../devtools/http/index.ts";
import {
  loadAthenaDevtoolsPostgresAuthorities,
  produceAthenaDevtoolsSnapshot,
  resolveAthenaDevtoolsProduceInput,
} from "../../devtools/produce/index.ts";
import { resolveAthenaRuntimePrincipal } from "../../runtime/authority/index.ts";
import type { AthenaClientInternals } from "../../runtime/client-internals.ts";
import {
  attachAthenaDevtoolsCorrelationHeaders,
  requestWantsAthenaDevtools,
  wrapRuntimeForAthenaDevtools,
} from "../../runtime/data/devtools-nucleus.ts";
import { serializeAthenaRuntimeDiscoveryDocument } from "../../runtime/data/discovery-document.ts";
import {
  corsHeadersForRequest,
  evaluateHttpRequestGuard,
} from "../../runtime/data/http-profile.ts";
import { publicRuntimeErrorMessage } from "../../runtime/data/redact.ts";
import type { AthenaServerRuntime } from "../../runtime/data/types.ts";
import {
  decodeAthenaGatewayJsonBody,
  resolveIncomingRequestId,
} from "./decode.ts";
import {
  encodeAthenaGatewayFailure,
  encodeAthenaGatewayResult,
} from "./encode.ts";
import { resolveAthenaGatewayServerRoute } from "./route.ts";

function isAthenaClientInternals(
  value: unknown
): value is AthenaClientInternals {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "config" in value && "plan" in value;
}

function withCors(
  response: Response,
  request: Request,
  runtime: AthenaServerRuntime
): Response {
  const extra = corsHeadersForRequest(request, runtime.httpProfile);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function authorizeAthenaDevtoolsEventChannel(
  request: Request,
  runtime: AthenaServerRuntime,
  requestId: string
): Promise<
  { ok: true } | { ok: false; code: string; message: string; status: number }
> {
  if (
    runtime.capabilities.security !== "authenticated" &&
    runtime.capabilities.security !== "policy"
  ) {
    return { ok: true };
  }
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const resolution = await resolveAthenaRuntimePrincipal(
    runtime.authMaterial,
    runtime.capabilities.security,
    { headers, request, requestId }
  );
  if (!resolution.ok) {
    return {
      code: resolution.failure.code,
      message: resolution.failure.message,
      ok: false,
      status: resolution.failure.status,
    };
  }
  if (resolution.resolved.principal.authenticated !== true) {
    return {
      code: "ATHENA_AUTH_REQUIRED",
      message:
        "Authentication is required to read the Athena DevTools event channel.",
      ok: false,
      status: 401,
    };
  }
  return { ok: true };
}

async function resolveDevtoolsAuthorizationSession(
  request: Request,
  runtime: AthenaServerRuntime,
  requestId: string
): Promise<{
  authenticated: boolean;
  organizationId: string | null;
  principalRights: readonly string[];
  sessionId: string | null;
  userId: string | null;
} | null> {
  if (
    runtime.capabilities.security !== "authenticated" &&
    runtime.capabilities.security !== "policy"
  ) {
    return null;
  }
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  try {
    const resolution = await resolveAthenaRuntimePrincipal(
      runtime.authMaterial,
      runtime.capabilities.security,
      { headers, request, requestId }
    );
    if (!resolution.ok) {
      return {
        authenticated: false,
        organizationId: null,
        principalRights: [],
        sessionId: null,
        userId: null,
      };
    }
    const principal = resolution.resolved.principal;
    return {
      authenticated: principal.authenticated === true,
      organizationId: principal.organizationId ?? null,
      principalRights: [...principal.rights],
      sessionId: principal.sessionId ?? null,
      userId: principal.userId ?? null,
    };
  } catch {
    return null;
  }
}

function methodAllowed(method: string, operation: string): boolean {
  if (method === "POST") {
    return true;
  }
  if (method === "GET") {
    return operation === "fetch";
  }
  if (method === "PATCH") {
    return operation === "update";
  }
  if (method === "DELETE") {
    return operation === "delete";
  }
  return false;
}

export async function handleAthenaGatewayRequest(
  request: Request,
  runtime: AthenaServerRuntime
): Promise<Response> {
  const requestId = resolveIncomingRequestId(request);
  const url = new URL(request.url);
  const route = resolveAthenaGatewayServerRoute(url.pathname);
  const fail = (options: {
    code: string;
    message: string;
    status: number;
  }): Response =>
    withCors(
      encodeAthenaGatewayFailure({
        ...options,
        requestId,
      }),
      request,
      runtime
    );

  if (
    runtime.capabilities.security === "trusted" &&
    !runtime.allowsUnauthenticatedHttp
  ) {
    return fail({
      code: "ATHENA_AUTH_REQUIRED",
      message:
        "Trusted Local Runtime HTTP requires unsafeAllowUnauthenticated: true.",
      status: 403,
    });
  }

  if (request.method === "OPTIONS") {
    const guard = evaluateHttpRequestGuard(
      request,
      "preflight",
      runtime.httpProfile
    );
    if (!guard.ok) {
      return fail(guard);
    }
    return withCors(new Response(null, { status: 204 }), request, runtime);
  }

  if (route.kind === "devtools-events" || route.kind === "devtools-stream") {
    const access = await authorizeAthenaDevtoolsEventChannel(
      request,
      runtime,
      requestId
    );
    if (!access.ok) {
      return fail(access);
    }
    const channel =
      route.kind === "devtools-events"
        ? handleAthenaDevtoolsEventsRequest(request, requestId)
        : handleAthenaDevtoolsStreamRequest(request, requestId);
    return withCors(channel, request, runtime);
  }

  if (route.kind === "health" || route.kind === "capabilities") {
    const document =
      runtime.discoveryDocument ??
      serializeAthenaRuntimeDiscoveryDocument(runtime);
    const payload: Record<string, unknown> = {
      ...document,
      ok: true,
      transport: runtime.capabilities.transport,
    };
    if (route.kind === "capabilities" && isAthenaDevtoolsHttpEnabled()) {
      const produceInput = runtime.devtoolsProduceInput ?? {};
      const resolved =
        runtime.capabilities.transport === "postgres-direct"
          ? await resolveAthenaDevtoolsProduceInput(produceInput, {
              loadLiveAuthorities: loadAthenaDevtoolsPostgresAuthorities,
            })
          : produceInput;
      const session = await resolveDevtoolsAuthorizationSession(
        request,
        runtime,
        requestId
      );
      payload.devtools = await produceAthenaDevtoolsSnapshot(resolved, {
        internals: isAthenaClientInternals(runtime.devtoolsClientInternals)
          ? runtime.devtoolsClientInternals
          : undefined,
        ...(session
          ? {
              principalRights: session.principalRights,
              sessionAuthenticated: session.authenticated,
              subject: {
                organizationId: session.organizationId,
                sessionId: session.sessionId,
                userId: session.userId,
              },
            }
          : {}),
      });
    }
    return withCors(
      new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-athena-request-id": requestId,
          "x-athena-runtime": document.runtime,
        },
        status: 200,
      }),
      request,
      runtime
    );
  }

  if (route.kind === "unknown") {
    return fail({
      code: "ATHENA_RUNTIME_UNSUPPORTED_OPERATION",
      message: `Athena Local Runtime does not serve ${url.pathname}.`,
      status: 404,
    });
  }

  if (!methodAllowed(request.method, route.operation)) {
    return fail({
      code: "ATHENA_RUNTIME_UNSUPPORTED_OPERATION",
      message: `Athena Local Runtime does not accept ${request.method} for ${route.operation}.`,
      status: 405,
    });
  }

  const guard = evaluateHttpRequestGuard(
    request,
    route.operation,
    runtime.httpProfile
  );
  if (!guard.ok) {
    return fail(guard);
  }

  const decoded = await decodeAthenaGatewayJsonBody(request, {
    maxBodyBytes: runtime.httpProfile.enabled
      ? runtime.httpProfile.limits.maxBodyBytes
      : undefined,
  });
  if (!decoded.ok) {
    return fail({
      code: decoded.code,
      message: decoded.message,
      status: decoded.status,
    });
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });

  const captureDevtools =
    requestWantsAthenaDevtools(request) && isAthenaDevtoolsHttpEnabled();
  const captured: { traceId?: string | null } = {};
  const executeRuntime = captureDevtools
    ? wrapRuntimeForAthenaDevtools(runtime, undefined, captured)
    : runtime;

  try {
    const result = await executeRuntime.execute(
      {
        operation: route.operation,
        payload: decoded.payload,
      },
      {
        headers,
        request,
        requestId,
      }
    );
    const encoded = withCors(
      encodeAthenaGatewayResult(result, requestId),
      request,
      runtime
    );
    if (!captureDevtools) {
      return encoded;
    }
    return attachAthenaDevtoolsCorrelationHeaders(
      encoded,
      request.headers.get("x-athena-trace-id") ?? captured.traceId
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "request failed";
    return fail({
      code: "ATHENA_RUNTIME_UNAVAILABLE",
      message: publicRuntimeErrorMessage(raw),
      status: 500,
    });
  }
}
