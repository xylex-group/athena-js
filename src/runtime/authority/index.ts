/**
 * Canonical HTTP principal authority (internal).
 *
 * Request headers are authentication material. The resolved caller is
 * always AthenaResolvedPrincipal from runtime/data/principal.ts.
 */
export {
  NON_AUTHORITATIVE_IDENTITY_HEADERS,
  ORGANIZATION_HINT_HEADERS,
  headersFromContext,
  readOrganizationHint,
  readPresentedSessionToken,
} from "./headers.ts";
export {
  authModeFromMaterial,
  normalizeAthenaRuntimeAuth,
  resolveAthenaRuntimePrincipal,
  type AthenaPrincipalResolutionFailure,
  type AthenaPrincipalResolutionOutcome,
  type AthenaRuntimeAuthMaterial,
} from "./resolve.ts";
