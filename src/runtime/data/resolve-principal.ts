/**
 * Compatibility re-export. Canonical resolver lives in runtime/authority.
 */
export {
  type AthenaPrincipalResolutionFailure,
  type AthenaPrincipalResolutionOutcome,
  type AthenaRuntimeAuthMaterial,
  authModeFromMaterial,
  normalizeAthenaRuntimeAuth,
  resolveAthenaRuntimePrincipal,
} from "../authority/resolve.ts";
