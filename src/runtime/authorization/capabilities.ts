import type { AthenaRightKey } from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import {
  AUTHORIZATION_PLATFORM_WRITE,
  AUTHORIZATION_ROLES_WRITE,
  ORGANIZATION_LIFECYCLE_DELETE,
  ORGANIZATION_MEMBERS_INVITE,
  ORGANIZATION_MEMBERS_WRITE,
} from "./capability-rights.ts";
import type { AuthorizationCapabilities } from "./types.ts";

export function authorizationAffordancesFromRights(
  rights: readonly AthenaRightKey[]
): AuthorizationCapabilities {
  const holds = (required: AthenaRightKey) =>
    missingRequiredRights(rights, [required]).length === 0;
  const canManagePlatform = holds(AUTHORIZATION_PLATFORM_WRITE);
  const canManageMembers =
    holds(ORGANIZATION_MEMBERS_WRITE) || canManagePlatform;
  return {
    canChangeMemberRole: canManageMembers,
    canDeleteOrganization: holds(ORGANIZATION_LIFECYCLE_DELETE),
    canInviteMembers: canManageMembers || holds(ORGANIZATION_MEMBERS_INVITE),
    canManageOrganizationRoles:
      holds(AUTHORIZATION_ROLES_WRITE) || canManagePlatform,
    canManagePlatformRoles: canManagePlatform,
    canRemoveMember: canManageMembers,
  };
}

/** @deprecated Use authorizationAffordancesFromRights for new code. */
export function capabilitiesFromRights(
  rights: readonly AthenaRightKey[]
): AuthorizationCapabilities {
  return authorizationAffordancesFromRights(rights);
}
