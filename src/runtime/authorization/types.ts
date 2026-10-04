import type { AthenaRightKey } from "../../rights/key.ts";
import type {
  AthenaRightDefinition,
  AthenaRightRiskLevel,
  AthenaRightScopeKind,
} from "../../rights/types.ts";

export type AthenaAuthorizationScopeKind = AthenaRightScopeKind;
export type AthenaAuthorizationRiskLevel = AthenaRightRiskLevel;
export type AthenaAuthorizationRoleScope = "platform" | "organization";

export type AthenaAuthorizationRightDefinition = AthenaRightDefinition;

/** Persistence compatibility projection; canonical meaning lives in Roles IR. */
export interface AthenaAuthorizationRoleRecord {
  assignable: boolean;
  id: string;
  key: string;
  name: string;
  organizationId: string | null;
  protected: boolean;
  scopeKind: AthenaAuthorizationRoleScope;
  systemKind: "owner" | "admin" | "member" | null;
  version: number;
}

export interface AssignedRoleSummary {
  displayName: string;
  key: string;
  scopeKind: AthenaAuthorizationRoleScope;
}

/** Snapshot/admin compatibility projection; not canonical role-definition state. */
export interface RoleDescriptor {
  assignable: boolean;
  assignmentCount: number;
  description?: string;
  displayName: string;
  id: string;
  key: string;
  organizationId: string | null;
  protected: boolean;
  rightCount: number;
  scopeKind: AthenaAuthorizationRoleScope;
  systemKind: "owner" | "admin" | "member" | null;
  version: number;
}

export interface AthenaAuthorizationRoleDetail
  extends AthenaAuthorizationRoleRecord {
  assignmentCount: number;
  rightCount: number;
  rights: readonly AthenaRightKey[];
}

export interface AuthorizationCapabilities {
  canChangeMemberRole: boolean;
  canDeleteOrganization: boolean;
  canInviteMembers: boolean;
  canManageOrganizationRoles: boolean;
  canManagePlatformRoles: boolean;
  canRemoveMember: boolean;
}

export interface MemberAuthorizationActions {
  assignedRoleIds: readonly string[];
  canChangeRole: boolean;
  canRemove: boolean;
  denialReasons: {
    changeRole?: string;
    remove?: string;
  };
  roleDisplayName: string;
  roleKey: string;
}

export interface AuthorizationSnapshot {
  activeOrganizationId?: string;
  assignableRoles: RoleDescriptor[];
  capabilities: AuthorizationCapabilities;
  effectiveRights: readonly AthenaRightKey[];
  revision: number;
  roles: AssignedRoleSummary[];
}

export type {
  AuthorizationAuthorityVersion,
  OrganizationAssignmentRevision,
  OrganizationMemberAssignmentSnapshot,
  OrganizationMemberRoleAssignment,
  PlatformAssignmentRevision,
  PlatformUserAssignmentSnapshot,
  PlatformUserRoleAssignment,
} from "./assignment-snapshot.ts";

export const ATHENA_AUTHORIZATION_SHADOW_KIND =
  "athena_authorization_shadow" as const;

export interface AthenaAuthorizationShadowDiagnostic {
  assignedRights: readonly string[];
  kind: typeof ATHENA_AUTHORIZATION_SHADOW_KIND;
  legacyRights: readonly string[];
  matched: boolean;
  userId: string;
}
