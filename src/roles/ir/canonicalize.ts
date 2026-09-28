import type { AthenaRightsAuthority } from "../../rights/authority.ts";
import { parseAthenaRoleId } from "../id.ts";
import { parseAthenaRoleKey } from "../key.ts";
import type { AthenaRoleDefinition, AthenaRolesIr } from "../types.ts";
import { validateAthenaRolesIr } from "./validate.ts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scopeRank(role: AthenaRoleDefinition): number {
  if (role.scope.kind === "platform") {
    return 0;
  }
  return role.scope.kind === "organization-template" ? 1 : 2;
}

function compareRoles(
  left: AthenaRoleDefinition,
  right: AthenaRoleDefinition
): number {
  const rank = scopeRank(left) - scopeRank(right);
  if (rank !== 0) {
    return rank;
  }
  const leftOrganization =
    left.scope.kind === "organization" ? left.scope.organizationId : "";
  const rightOrganization =
    right.scope.kind === "organization" ? right.scope.organizationId : "";
  return (
    compareText(leftOrganization, rightOrganization) ||
    compareText(left.key, right.key) ||
    compareText(left.id, right.id)
  );
}

export function canonicalizeAthenaRolesIr(
  value: AthenaRolesIr,
  rightsAuthority?: AthenaRightsAuthority
): AthenaRolesIr {
  validateAthenaRolesIr(value, rightsAuthority);
  const roles = value.roles
    .map((role) => ({
      ...role,
      id: parseAthenaRoleId(role.id),
      key: parseAthenaRoleKey(role.key),
      scope:
        role.scope.kind === "organization"
          ? {
              kind: "organization" as const,
              organizationId: role.scope.organizationId,
            }
          : { kind: role.scope.kind },
      ...(role.description === undefined
        ? {}
        : { description: role.description }),
      rights: [...role.rights].sort(compareText),
    }))
    .sort(compareRoles);
  const provenance = [...new Set(value.metadata.provenance ?? [])].sort();
  return {
    irVersion: value.irVersion,
    kind: value.kind,
    metadata: {
      ...(provenance.length === 0 ? {} : { provenance }),
    },
    roles,
  };
}
