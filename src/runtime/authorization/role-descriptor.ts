import type { AthenaRightKey } from "../../rights/key.ts";
import type {
  AthenaAuthorizationRoleDetail,
  AthenaAuthorizationRoleRecord,
  RoleDescriptor,
} from "./types.ts";

export function toRoleDescriptor(
  role: AthenaAuthorizationRoleRecord,
  counts: { assignmentCount: number; rightCount: number },
  description?: string
): RoleDescriptor {
  return {
    assignable: role.assignable,
    assignmentCount: counts.assignmentCount,
    ...(description ? { description } : {}),
    displayName: role.name,
    id: role.id,
    key: role.key,
    organizationId: role.organizationId,
    protected: role.protected,
    rightCount: counts.rightCount,
    scopeKind: role.scopeKind,
    systemKind: role.systemKind,
    version: role.version,
  };
}

export function toRoleDetail(
  role: AthenaAuthorizationRoleRecord,
  rights: readonly AthenaRightKey[],
  assignmentCount: number
): AthenaAuthorizationRoleDetail {
  return {
    ...role,
    assignmentCount,
    rightCount: rights.length,
    rights,
  };
}
