import type {
  AthenaRoleDefinition,
  AthenaRoleSnapshotProjection,
} from "./types.ts";

export function projectAuthorizationSnapshotRole(
  role: AthenaRoleDefinition,
  state: {
    activeOrganizationId?: string | null;
    assignmentCount: number;
    version: number;
  }
): AthenaRoleSnapshotProjection | undefined {
  let scopeKind: "platform" | "organization";
  let organizationId: string | null;
  if (role.scope.kind === "platform") {
    scopeKind = "platform";
    organizationId = null;
  } else {
    scopeKind = "organization";
    const activeOrganizationId = state.activeOrganizationId?.trim() ?? "";
    if (role.scope.kind === "organization-template") {
      if (activeOrganizationId.length === 0) {
        return undefined;
      }
      organizationId = activeOrganizationId;
    } else {
      if (
        activeOrganizationId.length === 0 ||
        role.scope.organizationId !== activeOrganizationId
      ) {
        return undefined;
      }
      organizationId = role.scope.organizationId;
    }
  }
  return {
    assignable: role.assignable,
    assignmentCount: state.assignmentCount,
    ...(role.description === undefined
      ? {}
      : { description: role.description }),
    displayName: role.displayName,
    id: role.id,
    key: role.key,
    organizationId,
    protected: role.protected,
    rightCount: role.rights.length,
    scopeKind,
    systemKind: role.systemKind,
    version: state.version,
  };
}
