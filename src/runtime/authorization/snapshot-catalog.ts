import type { AuthorizationCapabilities, RoleDescriptor } from "./types.ts";

export function projectAssignableRoles(input: {
  activeOrganizationId?: string | null;
  capabilities: AuthorizationCapabilities;
  roles: readonly RoleDescriptor[];
}): RoleDescriptor[] {
  const organizationId = input.activeOrganizationId?.trim() ?? "";
  const { capabilities } = input;
  return input.roles.filter((role) => {
    if (!role.assignable) {
      return false;
    }
    if (role.scopeKind === "platform") {
      return capabilities.canManagePlatformRoles;
    }
    if (organizationId.length === 0) {
      return false;
    }
    if (
      role.organizationId !== null &&
      role.organizationId !== organizationId
    ) {
      return false;
    }
    if (role.organizationId === organizationId) {
      return (
        capabilities.canManageOrganizationRoles ||
        capabilities.canChangeMemberRole ||
        capabilities.canInviteMembers
      );
    }
    return (
      capabilities.canManageOrganizationRoles ||
      capabilities.canChangeMemberRole ||
      capabilities.canInviteMembers
    );
  });
}
