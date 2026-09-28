/**
 * Canonical HTTP principal authority (internal).
 *
 * Request headers are authentication material. The resolved caller is
 * always AthenaResolvedPrincipal from runtime/data/principal.ts.
 */
export {
  headersFromContext,
  NON_AUTHORITATIVE_IDENTITY_HEADERS,
  ORGANIZATION_HINT_HEADERS,
  readOrganizationHint,
  readPresentedSessionToken,
} from "./headers.ts";
export {
  type AthenaPrincipalResolutionFailure,
  type AthenaPrincipalResolutionOutcome,
  type AthenaRuntimeAuthMaterial,
  authModeFromMaterial,
  normalizeAthenaRuntimeAuth,
  resolveAthenaRuntimePrincipal,
} from "./resolve.ts";
export {
  asJwtPrincipalVerifier,
  createOAuthAccessTokenVerifier,
  createOAuthRuntimeJwtVerifier,
} from "./oauth-verifier.ts";
