/**
 * Compatibility re-export. Canonical resolver lives in runtime/authority.
 */
export {
  authModeFromMaterial,
  normalizeAthenaRuntimeAuth,
  resolveAthenaRuntimePrincipal,
  type AthenaPrincipalResolutionFailure,
  type AthenaPrincipalResolutionOutcome,
  type AthenaRuntimeAuthMaterial,
} from "../authority/resolve.ts";
