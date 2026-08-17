import { runtimeConfigError } from "./errors.ts";
import {
  resolveAthenaRuntimeLimits,
  type ResolvedAthenaRuntimeLimits,
} from "./limits.ts";
import {
  headerOrigin,
  isAllowedRequestOrigin,
  requestOrigin,
} from "./origin.ts";
import type {
  AthenaRuntimeHttpProfile,
  AthenaRuntimeOperation,
  CreateAthenaServerRuntimeConfig,
} from "./types.ts";

const MUTATION_OPERATIONS = new Set<AthenaRuntimeOperation>([
  "insert",
  "update",
  "delete",
  "query",
  "rpc",
]);

export function resolveAthenaRuntimeHttpProfile(
  config: CreateAthenaServerRuntimeConfig
): AthenaRuntimeHttpProfile {
  const httpEnabled = config.http === true;
  const limits = resolveAthenaRuntimeLimits(config.limits);
  const extra = config.security.http;
  return {
    allowUnboundedMutations: extra?.allowUnboundedMutations === true,
    allowedOrigins: extra?.allowedOrigins ?? [],
    enabled: httpEnabled,
    limits,
    requireCsrfOnCookieMutations:
      httpEnabled &&
      config.security.mode !== "trusted" &&
      extra?.csrf !== "disabled",
    requireSameOrigin:
      httpEnabled &&
      extra?.allowCrossOrigin !== true &&
      config.security.mode !== "trusted",
  };
}

export function assertBrowserPolicyProfile(
  config: CreateAthenaServerRuntimeConfig
): void {
  if (config.security.mode !== "policy" || config.http !== true) {
    return;
  }
  const missing: string[] = [];
  if (config.models == null) {
    missing.push("models");
  }
  if (config.auth === false || config.auth == null) {
    missing.push("auth");
  }
  const definitions = config.policies?.definitions;
  const emptyArray = Array.isArray(definitions) && definitions.length === 0;
  if (definitions == null || emptyArray) {
    missing.push("policies.definitions");
  }
  if (missing.length > 0) {
    throw runtimeConfigError(
      `ATHENA_RUNTIME_CONFIG_INVALID: security.mode "policy" HTTP handlers require ${missing.join(", ")}. ` +
        "Athena does not silently downgrade to trusted mode."
    );
  }
}

export function requestHasCookieCredentials(request: Request): boolean {
  const cookie = request.headers.get("cookie");
  return Boolean(cookie && cookie.trim());
}

export function isMutationOperation(operation: AthenaRuntimeOperation): boolean {
  return MUTATION_OPERATIONS.has(operation);
}

export function evaluateHttpRequestGuard(
  request: Request,
  operation: AthenaRuntimeOperation | "health" | "preflight",
  profile: AthenaRuntimeHttpProfile
):
  | { ok: true }
  | { ok: false; code: "ATHENA_CSRF_REJECTED"; message: string; status: number } {
  if (!profile.enabled) {
    return { ok: true };
  }
  const originHeader = request.headers.get("origin");
  const incoming = headerOrigin(request);
  if (originHeader && originHeader.trim() && !incoming) {
    return {
      code: "ATHENA_CSRF_REJECTED",
      message: "Athena rejected a request with an invalid Origin.",
      ok: false,
      status: 403,
    };
  }
  if (
    incoming &&
    profile.requireSameOrigin &&
    !isAllowedRequestOrigin(request, profile.allowedOrigins)
  ) {
    return {
      code: "ATHENA_CSRF_REJECTED",
      message: "Athena rejected a cross-origin Local Runtime request.",
      ok: false,
      status: 403,
    };
  }
  if (operation === "health" || operation === "preflight" || operation === "fetch") {
    return { ok: true };
  }
  if (
    profile.requireCsrfOnCookieMutations &&
    isMutationOperation(operation) &&
    requestHasCookieCredentials(request)
  ) {
    if (!incoming) {
      return {
        code: "ATHENA_CSRF_REJECTED",
        message:
          "Cookie-authenticated mutations require a trusted same-origin Origin.",
        ok: false,
        status: 403,
      };
    }
    if (!isAllowedRequestOrigin(request, profile.allowedOrigins)) {
      return {
        code: "ATHENA_CSRF_REJECTED",
        message: "Athena rejected a cross-origin Local Runtime request.",
        ok: false,
        status: 403,
      };
    }
  }
  return { ok: true };
}

export function corsHeadersForRequest(
  request: Request,
  profile: AthenaRuntimeHttpProfile
): HeadersInit {
  if (!profile.enabled) {
    return {};
  }
  const incoming = headerOrigin(request);
  if (!incoming || !isAllowedRequestOrigin(request, profile.allowedOrigins)) {
    return { vary: "Origin" };
  }
  return {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers":
      "authorization, content-type, x-athena-request-id, x-request-id",
    "access-control-allow-methods": "DELETE, GET, OPTIONS, PATCH, POST",
    "access-control-allow-origin": incoming,
    vary: "Origin",
  };
}

export function requestTargetOrigin(request: Request): string | null {
  return requestOrigin(request);
}

export type { ResolvedAthenaRuntimeLimits };
