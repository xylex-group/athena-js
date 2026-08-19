import { serializeAthenaRuntimeDiscoveryDocument } from "../../runtime/data/discovery-document.ts";
import {
  corsHeadersForRequest,
  evaluateHttpRequestGuard,
} from "../../runtime/data/http-profile.ts";
import { publicRuntimeErrorMessage } from "../../runtime/data/redact.ts";
import type { AthenaServerRuntime } from "../../runtime/data/types.ts";
import { decodeAthenaGatewayJsonBody, resolveIncomingRequestId } from "./decode.ts";
import { encodeAthenaGatewayFailure, encodeAthenaGatewayResult } from "./encode.ts";
import { resolveAthenaGatewayServerRoute } from "./route.ts";

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
    return withCors(
      new Response(null, { status: 204 }),
      request,
      runtime
    );
  }

  if (route.kind === "health" || route.kind === "capabilities") {
    const document =
      runtime.discoveryDocument ??
      serializeAthenaRuntimeDiscoveryDocument(runtime);
    return withCors(
      new Response(
        JSON.stringify({
          ...document,
          ok: true,
          transport: runtime.capabilities.transport,
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-athena-request-id": requestId,
            "x-athena-runtime": document.runtime,
          },
          status: 200,
        }
      ),
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

  try {
    const result = await runtime.execute(
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
    return withCors(
      encodeAthenaGatewayResult(result, requestId),
      request,
      runtime
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
