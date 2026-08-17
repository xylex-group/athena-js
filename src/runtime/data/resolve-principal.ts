import {
  readBearerToken,
  readSessionTokenFromCookies,
} from "../../auth/local/cookies.ts";
import { AthenaConfigurationError } from "../../config/errors.ts";
import {
  createDeferredPostgresAuthStores,
  createLookupSessionFromAuthStores,
  createMembershipVerifierFromAuthStores,
} from "./athena-session.ts";
import {
  anonymousResolvedPrincipal,
  normalizeAthenaPrincipal,
  type AthenaPrincipalResolutionInput,
  type AthenaResolvedPrincipal,
  type AthenaRuntimeAuthConfig,
  type AthenaRuntimeAuthMaterial,
  type AthenaRuntimeSessionLookup,
} from "./principal.ts";
import type {
  AthenaRuntimeAuthMode,
  AthenaRuntimeErrorCode,
  AthenaRuntimeRequestContext,
  AthenaRuntimeSecurityMode,
} from "./types.ts";

export type { AthenaRuntimeAuthMaterial };

export interface AthenaPrincipalResolutionFailure {
  code: AthenaRuntimeErrorCode;
  message: string;
  status: number;
}

export type AthenaPrincipalResolutionOutcome =
  | { ok: true; resolved: AthenaResolvedPrincipal }
  | { ok: false; failure: AthenaPrincipalResolutionFailure };

function authConfigInvalid(message: string): AthenaConfigurationError {
  return new AthenaConfigurationError(
    "ATHENA_RUNTIME_CONFIG_INVALID",
    `ATHENA_AUTH_CONFIG_INVALID: ${message}`,
    "auth"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAthenaRuntimeAuth(
  auth: AthenaRuntimeAuthConfig | { mode: string } | undefined,
  security: AthenaRuntimeSecurityMode,
  options: { databaseUrl?: string } = {}
): AthenaRuntimeAuthMaterial {
  if (auth === undefined || auth === false) {
    if (security === "authenticated") {
      throw authConfigInvalid(
        "security.mode \"authenticated\" requires a configured Auth resolver."
      );
    }
    return { mode: false };
  }

  if (!isRecord(auth) || typeof auth.mode !== "string") {
    throw authConfigInvalid("auth must be false or an object with a mode.");
  }

  if (auth.mode === "jwt") {
    throw authConfigInvalid(
      "JWT principal resolution is not implemented. Use athena-session, custom, or service."
    );
  }

  const configured = auth as AthenaRuntimeAuthConfig;
  if (configured === false) {
    return { mode: false };
  }

  if (configured.mode === "athena-session") {
    const stores =
      configured.stores ??
      (options.databaseUrl
        ? createDeferredPostgresAuthStores(options.databaseUrl)
        : undefined);
    const lookupSession =
      configured.lookupSession ??
      (stores ? createLookupSessionFromAuthStores(stores) : undefined);
    if (typeof lookupSession !== "function") {
      throw authConfigInvalid(
        'auth.mode "athena-session" requires Athena Auth stores, lookupSession, or databaseUrl.'
      );
    }
    const verifyOrganizationMembership =
      configured.verifyOrganizationMembership ??
      (stores ? createMembershipVerifierFromAuthStores(stores) : undefined);
    return {
      lookupSession,
      mode: "athena-session",
      ...(verifyOrganizationMembership
        ? { verifyOrganizationMembership }
        : {}),
    };
  }

  if (configured.mode === "custom") {
    if (typeof configured.resolvePrincipal !== "function") {
      throw authConfigInvalid(
        "auth.mode \"custom\" requires resolvePrincipal."
      );
    }
    return {
      mode: "custom",
      resolvePrincipal: configured.resolvePrincipal,
    };
  }

  if (configured.mode === "service") {
    if (!isRecord(configured.principal)) {
      throw authConfigInvalid(
        "auth.mode \"service\" requires a server-configured principal."
      );
    }
    const principal = normalizeAthenaPrincipal(configured.principal);
    if (!principal.authenticated || !principal.service) {
      throw authConfigInvalid(
        "service principal must be authenticated and include principal.service."
      );
    }
    return { mode: "service", principal };
  }

  throw authConfigInvalid(`Unsupported auth.mode "${String(auth.mode)}".`);
}

export function authModeFromMaterial(
  material: AthenaRuntimeAuthMaterial
): AthenaRuntimeAuthMode {
  return material.mode;
}

function headersFromContext(
  context?: AthenaRuntimeRequestContext
): Headers {
  if (context?.request) {
    return context.request.headers;
  }
  const headers = new Headers();
  if (context?.headers) {
    for (const [name, value] of Object.entries(context.headers)) {
      if (value) {
        headers.set(name, value);
      }
    }
  }
  return headers;
}

function readOrganizationHint(headers: Headers): string | undefined {
  const hinted =
    headers.get("x-athena-organization") ?? headers.get("x-organization-id");
  const trimmed = hinted?.trim();
  return trimmed ? trimmed : undefined;
}

function readPresentedSessionToken(headers: Headers): string | undefined {
  return (
    readBearerToken(headers.get("authorization")) ??
    readSessionTokenFromCookies(headers.get("cookie"))
  );
}

function isExpired(expiresAt: string | Date | null | undefined): boolean {
  if (expiresAt == null) {
    return false;
  }
  const millis =
    expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (Number.isNaN(millis)) {
    return false;
  }
  return millis <= Date.now();
}

function deny(
  code: AthenaRuntimeErrorCode,
  message: string,
  status: number
): AthenaPrincipalResolutionOutcome {
  return { failure: { code, message, status }, ok: false };
}

function allow(
  resolved: AthenaResolvedPrincipal
): AthenaPrincipalResolutionOutcome {
  return { ok: true, resolved };
}

async function resolveSessionPrincipal(
  material: Extract<AthenaRuntimeAuthMaterial, { mode: "athena-session" }>,
  input: AthenaPrincipalResolutionInput
): Promise<AthenaPrincipalResolutionOutcome> {
  const token = readPresentedSessionToken(input.headers);
  if (!token) {
    return allow(anonymousResolvedPrincipal());
  }

  let lookup: AthenaRuntimeSessionLookup | null;
  try {
    lookup = await material.lookupSession(token);
  } catch {
    return deny(
      "ATHENA_AUTH_PRINCIPAL_RESOLUTION_FAILED",
      "Athena could not resolve the caller principal.",
      401
    );
  }

  if (!lookup) {
    return deny(
      "ATHENA_AUTH_INVALID_SESSION",
      "Athena session is missing or invalid.",
      401
    );
  }

  if (lookup.session.revoked === true || lookup.user.banned === true) {
    return deny(
      "ATHENA_AUTH_INVALID_SESSION",
      "Athena session is missing or invalid.",
      401
    );
  }

  if (isExpired(lookup.session.expiresAt)) {
    return deny(
      "ATHENA_AUTH_SESSION_EXPIRED",
      "Athena session has expired.",
      401
    );
  }

  const userId = lookup.user.id.trim();
  if (!userId) {
    return deny(
      "ATHENA_AUTH_INVALID_SESSION",
      "Athena session is missing or invalid.",
      401
    );
  }

  const sessionOrg = lookup.session.activeOrganizationId?.trim() || undefined;
  const hintedOrg = readOrganizationHint(input.headers);
  let organizationId = sessionOrg;

  if (hintedOrg && hintedOrg !== sessionOrg) {
    if (!material.verifyOrganizationMembership) {
      return deny(
        "ATHENA_AUTH_ORG_NOT_ALLOWED",
        "Requested organization is not verified for this principal.",
        403
      );
    }
    let allowed: boolean;
    try {
      allowed = await material.verifyOrganizationMembership({
        organizationId: hintedOrg,
        userId,
      });
    } catch {
      return deny(
        "ATHENA_AUTH_PRINCIPAL_RESOLUTION_FAILED",
        "Athena could not resolve the caller principal.",
        401
      );
    }
    if (!allowed) {
      return deny(
        "ATHENA_AUTH_ORG_NOT_ALLOWED",
        "Requested organization is not verified for this principal.",
        403
      );
    }
    organizationId = hintedOrg;
  }

  const role = lookup.user.role?.trim() || undefined;
  return allow({
    authority: "athena-session",
    principal: normalizeAthenaPrincipal({
      authenticated: true,
      grants: lookup.user.grants ?? [],
      ...(organizationId ? { organizationId } : {}),
      ...(role ? { role } : {}),
      rights: lookup.user.rights ?? [],
      sessionId: lookup.session.id,
      userId,
    }),
  });
}

async function resolveCustomPrincipal(
  material: Extract<AthenaRuntimeAuthMaterial, { mode: "custom" }>,
  input: AthenaPrincipalResolutionInput
): Promise<AthenaPrincipalResolutionOutcome> {
  let resolved: AthenaResolvedPrincipal | null;
  try {
    resolved = await material.resolvePrincipal(input);
  } catch {
    return deny(
      "ATHENA_AUTH_PRINCIPAL_RESOLUTION_FAILED",
      "Athena could not resolve the caller principal.",
      401
    );
  }
  if (!resolved) {
    return allow(anonymousResolvedPrincipal());
  }
  return allow({
    authority: "custom-trusted",
    principal: normalizeAthenaPrincipal(resolved.principal),
  });
}

export async function resolveAthenaRuntimePrincipal(
  material: AthenaRuntimeAuthMaterial,
  security: AthenaRuntimeSecurityMode,
  context?: AthenaRuntimeRequestContext
): Promise<AthenaPrincipalResolutionOutcome> {
  const headers = headersFromContext(context);
  const input: AthenaPrincipalResolutionInput = {
    headers,
    ...(context?.request ? { request: context.request } : {}),
    ...(context?.requestId ? { requestId: context.requestId } : {}),
  };

  let outcome: AthenaPrincipalResolutionOutcome;
  try {
    if (material.mode === false) {
      outcome = allow(anonymousResolvedPrincipal());
    } else if (material.mode === "service") {
      outcome = allow({
        authority: "service",
        principal: material.principal,
      });
    } else if (material.mode === "athena-session") {
      outcome = await resolveSessionPrincipal(material, input);
    } else {
      outcome = await resolveCustomPrincipal(material, input);
    }
  } catch {
    outcome = deny(
      "ATHENA_AUTH_PRINCIPAL_RESOLUTION_FAILED",
      "Athena could not resolve the caller principal.",
      401
    );
  }

  if (!outcome.ok) {
    return outcome;
  }

  if (
    security === "authenticated" &&
    outcome.resolved.principal.authenticated !== true
  ) {
    return deny(
      "ATHENA_AUTH_REQUIRED",
      "Authentication is required for this Athena Local Runtime.",
      401
    );
  }

  return outcome;
}
