import type { AuthMemberRow } from "../../auth/local/models.ts";
import type { AthenaRightKey } from "../../rights/key.ts";
import type {
  OrganizationMemberAssignmentSnapshot,
  OrganizationMemberRoleAssignment,
  PlatformUserAssignmentSnapshot,
  PlatformUserRoleAssignment,
} from "./assignment-snapshot.ts";
import type { AthenaAuthorizationInspectGraph } from "./inspect.ts";
import type {
  AthenaAuthorizationRoleDetail,
  AthenaAuthorizationRoleRecord,
  AthenaAuthorizationRoleScope,
  AuthorizationSnapshot,
  MemberAuthorizationActions,
  RoleDescriptor,
} from "./types.ts";

export interface AthenaAuthorizationStore {
  annotateMember(
    member: AuthMemberRow,
    actor: {
      foundingOwnerUserId: string | null;
      getMember: (
        organizationId: string,
        userId: string
      ) => Promise<AuthMemberRow | undefined>;
      userId: string;
    }
  ): Promise<MemberAuthorizationActions>;
  assignMemberRole(
    memberId: string,
    roleKey: string,
    assignedBy?: string,
    organizationId?: string | null
  ): Promise<void>;
  assignUserRole(
    userId: string,
    roleKey: string,
    assignedBy?: string
  ): Promise<void>;
  cloneRole(input: {
    actorRights: readonly string[];
    actorUserId: string;
    name: string;
    sourceRoleId: string;
    organizationId?: string | null;
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord>;
  createRole(input: {
    actorRights: readonly string[];
    actorUserId: string;
    name: string;
    organizationId?: string | null;
    rights?: readonly string[];
    scopeKind: AthenaAuthorizationRoleScope;
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord>;
  deleteRole(input: {
    actorUserId: string;
    expectedVersion: number;
    id: string;
    organizationId?: string | null;
    reassignmentRoleId?: string | null;
  }): Promise<void>;
  ensureCatalog(): Promise<void>;
  getRole(
    id: string,
    organizationId?: string | null
  ): Promise<AthenaAuthorizationRoleDetail | undefined>;
  hasUserAssignment(userId: string): Promise<boolean>;
  inspectGraph?(): Promise<AthenaAuthorizationInspectGraph>;
  listAudit(input: {
    limit?: number;
    organizationId?: string | null;
  }): Promise<readonly Record<string, unknown>[]>;
  listMemberRoleAssignments(input: {
    organizationId: string;
  }): Promise<readonly OrganizationMemberRoleAssignment[]>;
  listRoleRights(roleId: string): Promise<readonly AthenaRightKey[]>;
  listRoles(input: {
    organizationId?: string | null;
    scopeKind: AthenaAuthorizationRoleScope;
  }): Promise<readonly RoleDescriptor[]>;
  listUserRoleAssignments(input?: {
    userIds?: readonly string[];
  }): Promise<readonly PlatformUserRoleAssignment[]>;
  lookupAssignableOrganizationRole(
    organizationId: string,
    roleRef: string
  ): Promise<AthenaAuthorizationRoleRecord | undefined>;
  materialize(): Promise<void>;
  readMemberRoleAssignmentsSnapshot(input: {
    organizationId: string;
  }): Promise<OrganizationMemberAssignmentSnapshot>;
  readSnapshot(input: {
    activeOrganizationId?: string | null;
    foundingOwnerUserId?: string | null;
    getMember: (
      organizationId: string,
      userId: string
    ) => Promise<AuthMemberRow | undefined>;
    listMembers: (organizationId: string) => Promise<AuthMemberRow[]>;
    userId: string;
  }): Promise<AuthorizationSnapshot>;
  readUserRoleAssignmentsSnapshot(input?: {
    userIds?: readonly string[];
  }): Promise<PlatformUserAssignmentSnapshot>;
  replaceMemberRoleAssignments(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    foundingOwnerUserId?: string | null;
    memberId: string;
    memberUserId: string;
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<{ revision: number }>;
  replaceRoleRights(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    id: string;
    organizationId?: string | null;
    rights: readonly string[];
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord>;
  replaceUserRoleAssignments(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    roleIds: readonly string[];
    userId: string;
  }): Promise<{ revision: number }>;
  resolveEffectiveRights(input: {
    activeOrganizationId?: string | null;
    getMember: (
      organizationId: string,
      userId: string
    ) => Promise<AuthMemberRow | undefined>;
    userId: string;
  }): Promise<readonly AthenaRightKey[]>;
  updateRole(input: {
    actorRights?: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    id: string;
    name: string;
    organizationId?: string | null;
    rights?: readonly string[];
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord>;
}

function isStoreMethod(
  value: unknown,
  key: keyof AthenaAuthorizationStore
): boolean {
  return typeof (value as AthenaAuthorizationStore)[key] === "function";
}

/** Persisted Authorization store (not the HTTP `auth.authorization` client). */
export function isPersistedAuthorizationStore(
  value: unknown
): value is AthenaAuthorizationStore {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    isStoreMethod(value, "hasUserAssignment") &&
    isStoreMethod(value, "readSnapshot") &&
    isStoreMethod(value, "resolveEffectiveRights")
  );
}

/** Store that can project the DevTools inspect graph. */
export function isInspectableAuthorizationStore(
  value: unknown
): value is AthenaAuthorizationStore {
  return (
    isPersistedAuthorizationStore(value) && isStoreMethod(value, "inspectGraph")
  );
}
