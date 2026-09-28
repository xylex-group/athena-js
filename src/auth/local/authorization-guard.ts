import type { AthenaRightKey } from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import {
  ORGANIZATION_LIFECYCLE_DELETE,
  ORGANIZATION_MEMBERS_INVITE,
  ORGANIZATION_MEMBERS_WRITE,
  ORGANIZATION_OWNERS_ASSIGN,
} from "../../runtime/authorization/catalog.ts";
import {
  grantRankRole,
  persistedMemberRole,
} from "../../runtime/authorization/templates.ts";
import type { AthenaAuthorizationRoleRecord } from "../../runtime/authorization/types.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import type { AuthMemberRow } from "./models.ts";
import {
  assertMemberRoleAssignmentAllowed,
  GRANT_HIGHER_ROLE_FORBIDDEN,
  GRANT_OWNER_FORBIDDEN,
  SELF_ELEVATION_FORBIDDEN,
} from "./organization-invariants.ts";

export {
  assertMemberRoleAssignmentAllowed,
  GRANT_HIGHER_ROLE_FORBIDDEN,
  GRANT_OWNER_FORBIDDEN,
  SELF_ELEVATION_FORBIDDEN,
};

async function actorRights(
  stores: AthenaAuthStores,
  userId: string,
  organizationId: string
) {
  return stores.authorization.resolveEffectiveRights({
    activeOrganizationId: organizationId,
    getMember: (orgId, memberUserId) => stores.getMember(orgId, memberUserId),
    userId,
  });
}

export async function actorHoldsRight(
  stores: AthenaAuthStores,
  userId: string,
  organizationId: string,
  required: readonly AthenaRightKey[]
): Promise<boolean> {
  const rights = await actorRights(stores, userId, organizationId);
  return missingRequiredRights(rights, required).length === 0;
}

export async function requireOrgMemberManager(
  stores: AthenaAuthStores,
  userId: string,
  organizationId: string,
  actor: AuthMemberRow | undefined
): Promise<void> {
  if (!actor) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  if (
    await actorHoldsRight(stores, userId, organizationId, [
      ORGANIZATION_MEMBERS_WRITE,
    ])
  ) {
    return;
  }
  throw AthenaAuthRuntimeError.forbidden();
}

export async function requireOrgInviteManager(
  stores: AthenaAuthStores,
  userId: string,
  organizationId: string,
  actor: AuthMemberRow | undefined
): Promise<void> {
  if (!actor) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  if (
    await actorHoldsRight(stores, userId, organizationId, [
      ORGANIZATION_MEMBERS_WRITE,
    ])
  ) {
    return;
  }
  if (
    await actorHoldsRight(stores, userId, organizationId, [
      ORGANIZATION_MEMBERS_INVITE,
    ])
  ) {
    return;
  }
  throw AthenaAuthRuntimeError.forbidden();
}

export async function requireOrgDelete(
  stores: AthenaAuthStores,
  userId: string,
  organizationId: string,
  actor: AuthMemberRow | undefined
): Promise<void> {
  if (!actor) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  if (
    await actorHoldsRight(stores, userId, organizationId, [
      ORGANIZATION_LIFECYCLE_DELETE,
    ])
  ) {
    return;
  }
  throw AthenaAuthRuntimeError.forbidden();
}

export async function actorCanAssignOwner(
  stores: AthenaAuthStores,
  userId: string,
  organizationId: string
): Promise<boolean> {
  return actorHoldsRight(stores, userId, organizationId, [
    ORGANIZATION_OWNERS_ASSIGN,
  ]);
}

export function verifiedOrganizationScope(input: {
  activeOrganizationId: string | null | undefined;
  requestedOrganizationId?: string | null;
}): string {
  const active = input.activeOrganizationId?.trim() ?? "";
  const requested = input.requestedOrganizationId?.trim() ?? "";
  if (requested.length > 0 && active.length > 0 && requested !== active) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  if (requested.length > 0 && active.length === 0) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  const organizationId = active || requested;
  if (!organizationId) {
    throw AthenaAuthRuntimeError.badRequest("organizationId is required");
  }
  return organizationId;
}

export function resolveAuthorizationCommandScope(input: {
  activeOrganizationId: string | null | undefined;
  canManageOrganizationRoles: boolean;
  canManagePlatformRoles: boolean;
  requestedOrganizationId?: string | null;
  requestedScope?: "organization" | "platform";
  defaultScope?: "organization" | "platform";
}): { kind: "organization" | "platform"; organizationId: string | null } {
  const active = input.activeOrganizationId?.trim() ?? "";
  const requested = input.requestedOrganizationId?.trim() ?? "";
  if (input.requestedScope === "platform") {
    if (!input.canManagePlatformRoles) {
      throw AthenaAuthRuntimeError.forbidden();
    }
    return { kind: "platform", organizationId: null };
  }
  if (input.requestedScope === "organization") {
    if (
      !input.canManageOrganizationRoles ||
      active.length === 0 ||
      (requested.length > 0 && requested !== active)
    ) {
      throw AthenaAuthRuntimeError.forbidden();
    }
    return { kind: "organization", organizationId: active };
  }
  if (requested.length > 0 && (active.length === 0 || requested !== active)) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  const preferOrganization =
    input.defaultScope !== "platform" && active.length > 0;
  if (preferOrganization && input.canManageOrganizationRoles) {
    return { kind: "organization", organizationId: active };
  }
  if (input.canManagePlatformRoles) {
    return { kind: "platform", organizationId: null };
  }
  if (active.length > 0 && input.canManageOrganizationRoles) {
    return { kind: "organization", organizationId: active };
  }
  throw AthenaAuthRuntimeError.forbidden();
}

export function verifiedAuthorizationCommandScope(input: {
  activeOrganizationId: string | null | undefined;
  canManageOrganizationRoles: boolean;
  canManagePlatformRoles: boolean;
  requestedOrganizationId?: string | null;
  requestedScope?: "organization" | "platform";
  defaultScope?: "organization" | "platform";
}): { kind: "organization" | "platform"; organizationId: string | null } {
  return resolveAuthorizationCommandScope({
    ...input,
    defaultScope: input.defaultScope ?? "organization",
  });
}

export async function requireOrganizationRoleGrant(
  stores: AthenaAuthStores,
  userId: string,
  organizationId: string,
  actor: AuthMemberRow | undefined,
  requestedRole: string,
  target?: {
    role: string;
    userId: string;
  }
): Promise<{
  persistedRole: string;
  role: AthenaAuthorizationRoleRecord;
}> {
  if (!actor) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  const role = await stores.authorization.lookupAssignableOrganizationRole(
    organizationId,
    requestedRole
  );
  if (!role) {
    throw AthenaAuthRuntimeError.badRequest("Role is not assignable");
  }
  assertMemberRoleAssignmentAllowed({
    actorCanAssignOwner: await actorCanAssignOwner(
      stores,
      userId,
      organizationId
    ),
    actorRole: actor.role,
    actorUserId: userId,
    nextRole: grantRankRole(role),
    targetRole: target?.role ?? "member",
    targetUserId: target?.userId ?? userId,
  });
  return {
    persistedRole: persistedMemberRole(role),
    role,
  };
}
