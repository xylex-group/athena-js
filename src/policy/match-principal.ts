import type { AthenaPrincipal } from "../runtime/data/principal.ts";
import type { PolicyPrincipal } from "./types.ts";

const PRINCIPAL_KINDS = new Set([
  "public",
  "anonymous",
  "authenticated",
  "admin",
  "role",
  "permission",
  "service",
]);

export function isKnownPolicyPrincipalKind(kind: string): boolean {
  return PRINCIPAL_KINDS.has(kind);
}

function eqIgnoreCase(left: string | undefined, right: string): boolean {
  return left != null && left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function listHas(values: readonly string[] | undefined, name: string): boolean {
  return Boolean(values?.some((value) => eqIgnoreCase(value, name)));
}

/**
 * Rust oracle (`athena-policy` `principal_matches`):
 * multiple principals on one policy are OR.
 *
 * `permission:*` matches `AthenaPrincipal.rights` only (spec 08), not grants.
 * `service:*` matches `AthenaPrincipal.service`.
 */
export function matchPolicyPrincipal(
  target: PolicyPrincipal,
  principal: AthenaPrincipal
): boolean {
  switch (target.kind) {
    case "public":
      return true;
    case "anonymous":
      return principal.authenticated !== true;
    case "authenticated":
      return principal.authenticated === true;
    case "admin":
      return eqIgnoreCase(principal.role, "admin") || listHas(principal.rights, "admin");
    case "role":
      return eqIgnoreCase(principal.role, target.name);
    case "permission":
      return listHas(principal.rights, target.name);
    case "service":
      return eqIgnoreCase(principal.service, target.name);
    default:
      return false;
  }
}

export function policyAppliesToPrincipal(
  principals: readonly PolicyPrincipal[],
  principal: AthenaPrincipal
): boolean {
  if (principals.length === 0) {
    return true;
  }
  return principals.some((target) => matchPolicyPrincipal(target, principal));
}
