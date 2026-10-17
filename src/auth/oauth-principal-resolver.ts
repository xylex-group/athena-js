/**
 * Supported server façade: OAuth access token → AthenaResolvedPrincipal.
 *
 * Application-owned MCP / BFF bindings should use this instead of importing
 * internal `runtime/authority/*` modules.
 */

import { requireAthenaRootClientInternals } from "../runtime/client-internals.ts";
import type {
  AthenaResolvedPrincipal,
  AthenaRuntimeJwtVerifier,
} from "../runtime/data/principal.ts";

export type {
  AthenaOAuthPrincipalContext,
  AthenaPrincipal,
  AthenaResolvedPrincipal,
  AthenaRuntimeJwtVerifier,
} from "../runtime/data/principal.ts";

export class AthenaOAuthAuthorizationServerRequiredError extends Error {
  readonly code = "ATHENA_OAUTH_AUTHORIZATION_SERVER_REQUIRED";

  constructor(message = "OAuth authorization server is not configured on this Athena client.") {
    super(message);
    this.name = "AthenaOAuthAuthorizationServerRequiredError";
  }
}

export interface CreateAthenaOAuthPrincipalResolverOptions {
  /** Process-wide createClient() root (not a request view). */
  client: object;
  /** Absolute resource URI announced to OAuth clients (audience). */
  resource: string;
}

/**
 * Build a verifier that maps `Authorization: Bearer <access_token>` into a
 * canonical {@link AthenaResolvedPrincipal} with `authority: "jwt"`.
 */
export async function createAthenaOAuthPrincipalResolver(
  options: CreateAthenaOAuthPrincipalResolverOptions
): Promise<AthenaRuntimeJwtVerifier> {
  const internals = requireAthenaRootClientInternals(
    options.client,
    "createAthenaOAuthPrincipalResolver"
  );
  const getVerifier = internals.authRuntime?.getOAuthRuntimeJwtVerifier;
  if (!getVerifier) {
    throw new AthenaOAuthAuthorizationServerRequiredError();
  }
  return getVerifier(options.resource);
}

/**
 * Resolve an OAuth bearer from request headers into an Athena principal.
 * Returns `null` when no bearer is present. Throws on invalid/revoked tokens.
 */
export async function resolveAthenaOAuthPrincipal(input: {
  headers: Headers;
  resolver: AthenaRuntimeJwtVerifier;
}): Promise<AthenaResolvedPrincipal | null> {
  return input.resolver({ headers: input.headers });
}
