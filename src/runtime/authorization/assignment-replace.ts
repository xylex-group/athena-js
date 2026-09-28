import { tryParseAthenaRightKey } from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import {
  throwBaseRoleRequired,
  throwCrossOrganizationRole,
  throwFoundingOwnerProtected,
  throwLastPlatformAdmin,
} from "./role-invariants.ts";
import {
  ORGANIZATION_ADMIN_ROLE,
  ORGANIZATION_MEMBER_ROLE,
  ORGANIZATION_OWNER_ROLE,
  PLATFORM_ADMIN_ROLE,
} from "./templates.ts";
import type { AthenaAuthorizationRoleRecord } from "./types.ts";

const ORGANIZATION_BASE_ROLE_KEYS = new Set([
  ORGANIZATION_OWNER_ROLE,
  ORGANIZATION_ADMIN_ROLE,
  ORGANIZATION_MEMBER_ROLE,
]);

export function assertPlatformAssignmentRoles(
  roles: readonly AthenaAuthorizationRoleRecord[]
): void {
  for (const role of roles) {
    if (role.scopeKind !== "platform" || role.organizationId != null) {
      throwCrossOrganizationRole();
    }
  }
}

export function assertOrganizationAssignmentRoles(input: {
  foundingOwnerUserId?: string | null;
  memberUserId: string;
  organizationId: string;
  roles: readonly AthenaAuthorizationRoleRecord[];
}): void {
  const base = input.roles.filter(
    (role) => role.protected && ORGANIZATION_BASE_ROLE_KEYS.has(role.key)
  );
  if (base.length !== 1) {
    throwBaseRoleRequired();
  }
  for (const role of input.roles) {
    if (role.scopeKind !== "organization") {
      throwCrossOrganizationRole();
    }
    if (
      role.organizationId != null &&
      role.organizationId !== input.organizationId
    ) {
      throwCrossOrganizationRole();
    }
  }
  const nextBase = base[0];
  if (
    input.foundingOwnerUserId != null &&
    input.foundingOwnerUserId === input.memberUserId &&
    nextBase?.key !== ORGANIZATION_OWNER_ROLE
  ) {
    throwFoundingOwnerProtected();
  }
}

export function assertActorCanGrantRoles(input: {
  actorRights: readonly string[];
  roles: readonly { rights: readonly string[] }[];
}): void {
  const granted = [
    ...new Set(
      input.roles.flatMap((role) =>
        role.rights.flatMap((key) => {
          const parsed = tryParseAthenaRightKey(key);
          return parsed ? [parsed] : [];
        })
      )
    ),
  ];
  const actor = input.actorRights.flatMap((key) => {
    const parsed = tryParseAthenaRightKey(key);
    return parsed ? [parsed] : [];
  });
  if (missingRequiredRights(actor, granted).length > 0) {
    throw new Error("AUTHORIZATION_RIGHT_DELEGATION_DENIED");
  }
}

export function wouldRemoveLastPlatformAdmin(input: {
  currentAdminUserIds: readonly string[];
  nextHasAdmin: boolean;
  targetUserId: string;
}): boolean {
  const remaining = new Set(input.currentAdminUserIds);
  if (input.nextHasAdmin) {
    remaining.add(input.targetUserId);
  } else {
    remaining.delete(input.targetUserId);
  }
  return remaining.size === 0;
}

export function assertNotLastPlatformAdmin(input: {
  currentAdminUserIds: readonly string[];
  nextHasAdmin: boolean;
  targetUserId: string;
}): void {
  if (wouldRemoveLastPlatformAdmin(input)) {
    throwLastPlatformAdmin();
  }
}

export { ORGANIZATION_BASE_ROLE_KEYS, PLATFORM_ADMIN_ROLE };
