import { AthenaAuthRuntimeError } from "../../auth/local/errors.ts";
import type { AuthMemberRow } from "../../auth/local/models.ts";
import {
  FOUNDING_OWNER_REMOVE_FORBIDDEN,
  FOUNDING_OWNER_ROLE_LOCKED,
} from "../../auth/local/organization-invariants.ts";
import {
  type AthenaRightKey,
  parseAthenaRightKey,
  tryParseAthenaRightKey,
} from "../../rights/key.ts";
import {
  projectAuthorizationSnapshotRole,
  tryHydrateAthenaRoleDefinition,
} from "../../roles/index.ts";
import {
  assertNotLastPlatformAdmin,
  assertOrganizationAssignmentRoles,
  assertPlatformAssignmentRoles,
} from "./assignment-replace.ts";
import {
  asOrganizationAssignmentRevision,
  asPlatformAssignmentRevision,
  cloneOrganizationMemberAssignment,
  clonePlatformUserAssignment,
  freezeRoleIds,
  type OrganizationMemberAssignmentSnapshot,
  type OrganizationMemberRoleAssignment,
  type PlatformUserAssignmentSnapshot,
  type PlatformUserRoleAssignment,
} from "./assignment-snapshot.ts";
import { capabilitiesFromRights } from "./capabilities.ts";
import {
  AUTHORIZATION_CATALOG_VERSION,
  getAthenaAuthorizationRightsIr,
} from "./catalog.ts";
import { assertCloneRoleTenantBoundary } from "./clone-source.ts";
import type { AthenaAuthorizationInspectGraph } from "./inspect.ts";
import { toRoleDescriptor, toRoleDetail } from "./role-descriptor.ts";
import {
  assertAuthorizationDelegationAllowed,
  assertExpectedVersion,
  assertProtectedRoleImmutable,
  throwAssignmentVersionConflict,
  throwReassignmentInvalid,
  throwRoleHasAssignments,
  throwRoleNotFound,
} from "./role-invariants.ts";
import { projectAssignableRoles } from "./snapshot-catalog.ts";
import type { AthenaAuthorizationStore } from "./store.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  builtinRoleRecord,
  mapLegacyMemberRole,
  mapLegacyUserRole,
  ORGANIZATION_OWNER_ROLE,
  PLATFORM_ADMIN_ROLE,
  resolveMemberAssignmentRole,
} from "./templates.ts";
import type {
  AssignedRoleSummary,
  AthenaAuthorizationRoleDetail,
  AthenaAuthorizationRoleRecord,
  AuthorizationSnapshot,
  MemberAuthorizationActions,
  RoleDescriptor,
} from "./types.ts";

function uniqueRights(keys: readonly string[]): AthenaRightKey[] {
  return [...new Set(keys)].flatMap((key) => {
    const parsed = tryParseAthenaRightKey(key);
    return parsed ? [parsed] : [];
  });
}

export class MemoryAuthorizationStore implements AthenaAuthorizationStore {
  private readonly audit: Record<string, unknown>[] = [];
  private readonly memberOrganizationIds = new Map<string, string>();
  private readonly memberRoles = new Map<string, Set<string>>();
  private readonly organizationRevisions = new Map<string, number>();
  private readonly platformRevision = { value: 1 };
  private readonly roleRights = new Map<string, Set<string>>();
  private readonly roles = new Map<string, AthenaAuthorizationRoleRecord>();
  private readonly userRoles = new Map<string, Set<string>>();
  private materialized = false;

  async ensureCatalog(): Promise<void> {
    if (this.materialized) {
      return;
    }
    await this.materialize();
  }

  async materialize(): Promise<void> {
    for (const template of BUILTIN_AUTHORIZATION_ROLES) {
      this.roles.set(template.id, builtinRoleRecord(template));
      this.roleRights.set(template.id, new Set(template.rights));
    }
    this.materialized = true;
    void AUTHORIZATION_CATALOG_VERSION;
    void getAthenaAuthorizationRightsIr();
  }

  async hasUserAssignment(userId: string): Promise<boolean> {
    await this.ensure();
    return this.userRoles.has(userId);
  }

  async assignUserRole(
    userId: string,
    roleKey: string,
    assignedBy?: string
  ): Promise<void> {
    await this.ensure();
    const role = this.requireRole(roleKey);
    if (role.scopeKind !== "platform") {
      throw new Error(`Role ${roleKey} is not a platform role`);
    }
    this.userRoles.set(userId, new Set([role.id]));
    this.platformRevision.value += 1;
    this.audit.push({
      action: "user.role.assign",
      actor_user_id: assignedBy ?? null,
      after_state: { roleKey },
      target_id: userId,
      target_kind: "user",
    });
  }

  async assignMemberRole(
    memberId: string,
    roleKey: string,
    assignedBy?: string,
    organizationId?: string | null
  ): Promise<void> {
    await this.ensure();
    const role = this.resolveOrganizationRole(roleKey, organizationId);
    this.memberRoles.set(memberId, new Set([role.id]));
    if (organizationId) {
      this.memberOrganizationIds.set(memberId, organizationId);
      this.bumpOrganizationRevision(organizationId);
    }
    this.audit.push({
      action: "member.role.assign",
      actor_user_id: assignedBy ?? null,
      after_state: { roleKey: role.key },
      organization_id: organizationId ?? null,
      target_id: memberId,
      target_kind: "member",
    });
  }

  async lookupAssignableOrganizationRole(
    organizationId: string,
    roleRef: string
  ): Promise<AthenaAuthorizationRoleRecord | undefined> {
    await this.ensure();
    try {
      return this.resolveOrganizationRole(roleRef, organizationId);
    } catch {
      /* role is not registered */
    }
  }

  async readUserRoleAssignmentsSnapshot(input?: {
    userIds?: readonly string[];
  }): Promise<PlatformUserAssignmentSnapshot> {
    await this.ensure();
    const wanted =
      input?.userIds == null ? [...this.userRoles.keys()] : input.userIds;
    const assignments = wanted.map((userId) =>
      clonePlatformUserAssignment({
        roleIds: freezeRoleIds([...(this.userRoles.get(userId) ?? [])]),
        userId,
      })
    );
    return Object.freeze({
      assignments: Object.freeze(assignments),
      revision: asPlatformAssignmentRevision(this.platformRevision.value),
    });
  }

  async listUserRoleAssignments(input?: {
    userIds?: readonly string[];
  }): Promise<readonly PlatformUserRoleAssignment[]> {
    return (await this.readUserRoleAssignmentsSnapshot(input)).assignments;
  }

  async readMemberRoleAssignmentsSnapshot(input: {
    organizationId: string;
  }): Promise<OrganizationMemberAssignmentSnapshot> {
    await this.ensure();
    const assignments: OrganizationMemberRoleAssignment[] = [];
    for (const [memberId, roleIds] of this.memberRoles.entries()) {
      const mappedOrg = this.memberOrganizationIds.get(memberId);
      if (mappedOrg != null && mappedOrg !== input.organizationId) {
        continue;
      }
      assignments.push(
        cloneOrganizationMemberAssignment({
          memberId,
          roleIds: freezeRoleIds([...roleIds]),
          userId: "",
        })
      );
    }
    return Object.freeze({
      assignments: Object.freeze(assignments),
      organizationId: input.organizationId,
      revision: asOrganizationAssignmentRevision(
        this.organizationRevisions.get(input.organizationId) ?? 1
      ),
    });
  }

  async listMemberRoleAssignments(input: {
    organizationId: string;
  }): Promise<readonly OrganizationMemberRoleAssignment[]> {
    return (await this.readMemberRoleAssignmentsSnapshot(input)).assignments;
  }

  async replaceUserRoleAssignments(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    roleIds: readonly string[];
    userId: string;
  }): Promise<{ revision: number }> {
    await this.ensure();
    if (input.expectedVersion !== this.platformRevision.value) {
      throwAssignmentVersionConflict();
    }
    const uniqueIds = [...new Set(input.roleIds)];
    const roles = uniqueIds.map((id) => this.requireRoleById(id));
    assertPlatformAssignmentRoles(roles);
    const afterRights = uniqueIds.flatMap((id) => [
      ...(this.roleRights.get(id) ?? []),
    ]);
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights,
      beforeRights: [],
      roleScope: "platform",
    });
    const currentAdmins = [...this.userRoles.entries()]
      .filter(([, roleIds]) =>
        [...roleIds].some(
          (roleId) => this.roles.get(roleId)?.key === PLATFORM_ADMIN_ROLE
        )
      )
      .map(([userId]) => userId);
    assertNotLastPlatformAdmin({
      currentAdminUserIds: currentAdmins,
      nextHasAdmin: roles.some((role) => role.key === PLATFORM_ADMIN_ROLE),
      targetUserId: input.userId,
    });
    this.userRoles.set(input.userId, new Set(uniqueIds));
    this.platformRevision.value += 1;
    this.audit.push({
      action: "user.roles.replace",
      actor_user_id: input.actorUserId,
      after_state: { roleIds: uniqueIds },
      target_id: input.userId,
      target_kind: "user",
    });
    return { revision: this.platformRevision.value };
  }

  async replaceMemberRoleAssignments(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    foundingOwnerUserId?: string | null;
    memberId: string;
    memberUserId: string;
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<{ revision: number }> {
    await this.ensure();
    const revision = this.organizationRevisions.get(input.organizationId) ?? 1;
    if (input.expectedVersion !== revision) {
      throwAssignmentVersionConflict();
    }
    const uniqueIds = [...new Set(input.roleIds)];
    const roles = uniqueIds.map((id) => this.requireRoleById(id));
    assertOrganizationAssignmentRoles({
      foundingOwnerUserId: input.foundingOwnerUserId,
      memberUserId: input.memberUserId,
      organizationId: input.organizationId,
      roles,
    });
    const afterRights = uniqueIds.flatMap((id) => [
      ...(this.roleRights.get(id) ?? []),
    ]);
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights,
      beforeRights: [],
      organizationId: input.organizationId,
      roleScope: "organization",
    });
    this.memberRoles.set(input.memberId, new Set(uniqueIds));
    this.memberOrganizationIds.set(input.memberId, input.organizationId);
    this.bumpOrganizationRevision(input.organizationId);
    this.audit.push({
      action: "member.roles.replace",
      actor_user_id: input.actorUserId,
      after_state: { roleIds: uniqueIds },
      organization_id: input.organizationId,
      target_id: input.memberId,
      target_kind: "member",
    });
    return {
      revision: this.organizationRevisions.get(input.organizationId) ?? 1,
    };
  }

  async cloneRole(input: {
    actorRights: readonly string[];
    actorUserId: string;
    name: string;
    organizationId?: string | null;
    sourceRoleId: string;
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
    await this.ensure();
    const source = this.roles.get(input.sourceRoleId);
    if (!source) {
      throw AthenaAuthRuntimeError.badRequest("Source role not found");
    }
    const targetOrganizationId = input.organizationId ?? source.organizationId;
    assertCloneRoleTenantBoundary({
      sourceOrganizationId: source.organizationId,
      sourceScopeKind: source.scopeKind,
      targetOrganizationId,
    });
    const sourceRights = [...(this.roleRights.get(source.id) ?? [])];
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights: sourceRights,
      beforeRights: [],
      organizationId: targetOrganizationId,
      roleScope: source.scopeKind,
      unrestrictedGrant: input.unrestrictedGrant,
    });
    const id = crypto.randomUUID();
    const record: AthenaAuthorizationRoleRecord = {
      assignable: true,
      id,
      key: `custom_${id.slice(0, 8)}`,
      name: input.name.trim() || `${source.name} copy`,
      organizationId: targetOrganizationId,
      protected: false,
      scopeKind: source.scopeKind,
      systemKind: null,
      version: 1,
    };
    if (source.scopeKind === "organization") {
      record.organizationId = targetOrganizationId;
    }
    this.roles.set(id, record);
    this.roleRights.set(id, new Set(this.roleRights.get(source.id) ?? []));
    if (record.organizationId) {
      this.bumpOrganizationRevision(record.organizationId);
    } else {
      this.platformRevision.value += 1;
    }
    const rights = [...(this.roleRights.get(id) ?? [])].sort();
    this.audit.push({
      action: "role.clone",
      actor_user_id: input.actorUserId,
      after_state: { rights },
      organization_id: record.organizationId,
      target_id: id,
      target_kind: "role",
    });
    return record;
  }

  async createRole(input: {
    actorRights: readonly string[];
    actorUserId: string;
    name: string;
    organizationId?: string | null;
    rights?: readonly string[];
    scopeKind: "platform" | "organization";
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
    await this.ensure();
    const name = input.name.trim();
    if (!name) {
      throw AthenaAuthRuntimeError.badRequest("name is required");
    }
    if (input.scopeKind === "organization" && !input.organizationId) {
      throw AthenaAuthRuntimeError.badRequest("organizationId is required");
    }
    const rights = input.rights ?? [];
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights: rights,
      beforeRights: [],
      organizationId: input.organizationId,
      roleScope: input.scopeKind,
      unrestrictedGrant: input.unrestrictedGrant,
    });
    const id = crypto.randomUUID();
    const record: AthenaAuthorizationRoleRecord = {
      assignable: true,
      id,
      key: `custom_${id.slice(0, 8)}`,
      name,
      organizationId:
        input.scopeKind === "organization"
          ? (input.organizationId ?? null)
          : null,
      protected: false,
      scopeKind: input.scopeKind,
      systemKind: null,
      version: 1,
    };
    this.roles.set(id, record);
    this.roleRights.set(
      id,
      new Set(rights.map((key) => parseAthenaRightKey(key)))
    );
    this.bumpScopeRevision(record.organizationId);
    this.audit.push({
      action: "role.create",
      actor_user_id: input.actorUserId,
      after_state: { rights: [...rights].sort() },
      organization_id: record.organizationId,
      target_id: id,
      target_kind: "role",
    });
    return record;
  }

  async getRole(
    id: string,
    organizationId?: string | null
  ): Promise<AthenaAuthorizationRoleDetail | undefined> {
    await this.ensure();
    const role = this.roles.get(id);
    if (!(role && this.roleVisibleInScope(role, organizationId))) {
      return;
    }
    const rights = uniqueRights([...(this.roleRights.get(id) ?? [])]);
    return toRoleDetail(role, rights, this.assignmentCount(role.id));
  }

  async listRoles(input: {
    organizationId?: string | null;
    scopeKind: "platform" | "organization";
  }): Promise<readonly RoleDescriptor[]> {
    await this.ensure();
    return [...this.roles.values()]
      .filter((role) => {
        if (role.scopeKind !== input.scopeKind) {
          return false;
        }
        return this.roleVisibleInScope(role, input.organizationId);
      })
      .map((role) =>
        toRoleDescriptor(role, {
          assignmentCount: this.assignmentCount(role.id),
          rightCount: this.roleRights.get(role.id)?.size ?? 0,
        })
      );
  }

  async listRoleRights(roleId: string): Promise<readonly AthenaRightKey[]> {
    await this.ensure();
    return uniqueRights([...(this.roleRights.get(roleId) ?? [])]);
  }

  async updateRole(input: {
    actorRights?: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    id: string;
    name: string;
    organizationId?: string | null;
    rights?: readonly string[];
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
    await this.ensure();
    const role = this.requireScopedRole(input.id, input.organizationId);
    assertProtectedRoleImmutable(role);
    assertExpectedVersion(role, input.expectedVersion);
    const name = input.name.trim();
    if (!name) {
      throw AthenaAuthRuntimeError.badRequest("name is required");
    }
    const beforeRights = [...(this.roleRights.get(role.id) ?? [])].sort();
    if (input.rights) {
      assertAuthorizationDelegationAllowed({
        actorRights: input.actorRights ?? [],
        afterRights: input.rights,
        beforeRights,
        organizationId: role.organizationId,
        roleScope: role.scopeKind,
        unrestrictedGrant: input.unrestrictedGrant,
      });
      const after = [...new Set(input.rights)].sort();
      this.roleRights.set(
        role.id,
        new Set(after.map((key) => parseAthenaRightKey(key)))
      );
      const next = { ...role, name, version: role.version + 1 };
      this.roles.set(role.id, next);
      this.bumpScopeRevision(next.organizationId);
      this.audit.push({
        action: "role.definition.update",
        actor_user_id: input.actorUserId,
        after_state: { name, rights: after },
        before_state: { name: role.name, rights: beforeRights },
        organization_id: next.organizationId,
        target_id: next.id,
        target_kind: "role",
      });
      return next;
    }
    const next = { ...role, name, version: role.version + 1 };
    this.roles.set(role.id, next);
    this.bumpScopeRevision(next.organizationId);
    this.audit.push({
      action: "role.rename",
      actor_user_id: input.actorUserId,
      after_state: { name },
      before_state: { name: role.name },
      organization_id: next.organizationId,
      target_id: next.id,
      target_kind: "role",
    });
    return next;
  }

  async replaceRoleRights(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    id: string;
    organizationId?: string | null;
    rights: readonly string[];
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
    await this.ensure();
    const role = this.requireScopedRole(input.id, input.organizationId);
    assertProtectedRoleImmutable(role);
    assertExpectedVersion(role, input.expectedVersion);
    const before = [...(this.roleRights.get(role.id) ?? [])].sort();
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights: input.rights,
      beforeRights: before,
      organizationId: role.organizationId,
      roleScope: role.scopeKind,
      unrestrictedGrant: input.unrestrictedGrant,
    });
    const after = [...new Set(input.rights)].sort();
    this.roleRights.set(
      role.id,
      new Set(after.map((key) => parseAthenaRightKey(key)))
    );
    const next = { ...role, version: role.version + 1 };
    this.roles.set(role.id, next);
    this.bumpScopeRevision(next.organizationId);
    this.audit.push({
      action: "role.rights.replace",
      actor_user_id: input.actorUserId,
      after_state: { rights: after },
      before_state: { rights: before },
      organization_id: next.organizationId,
      target_id: next.id,
      target_kind: "role",
    });
    return next;
  }

  async deleteRole(input: {
    actorUserId: string;
    expectedVersion: number;
    id: string;
    organizationId?: string | null;
    reassignmentRoleId?: string | null;
  }): Promise<void> {
    await this.ensure();
    const role = this.requireScopedRole(input.id, input.organizationId);
    assertProtectedRoleImmutable(role);
    assertExpectedVersion(role, input.expectedVersion);
    const assigned = this.assignmentCount(role.id);
    if (assigned > 0) {
      const replacementId = input.reassignmentRoleId?.trim() ?? "";
      if (!replacementId) {
        throwRoleHasAssignments();
      }
      const replacement = this.requireScopedRole(
        replacementId,
        input.organizationId
      );
      if (
        replacement.id === role.id ||
        !replacement.assignable ||
        replacement.scopeKind !== role.scopeKind
      ) {
        throwReassignmentInvalid();
      }
      if (role.scopeKind === "organization") {
        for (const [, roleIds] of this.memberRoles) {
          if (roleIds.has(role.id)) {
            roleIds.delete(role.id);
            roleIds.add(replacement.id);
          }
        }
      } else {
        for (const [, roleIds] of this.userRoles) {
          if (roleIds.has(role.id)) {
            roleIds.delete(role.id);
            roleIds.add(replacement.id);
          }
        }
      }
    }
    const before = [...(this.roleRights.get(role.id) ?? [])].sort();
    this.roles.delete(role.id);
    this.roleRights.delete(role.id);
    this.bumpScopeRevision(role.organizationId);
    this.audit.push({
      action: "role.delete",
      actor_user_id: input.actorUserId,
      before_state: { rights: before },
      organization_id: role.organizationId,
      target_id: role.id,
      target_kind: "role",
    });
  }

  async inspectGraph(): Promise<AthenaAuthorizationInspectGraph> {
    await this.ensure();
    const roles = [...this.roles.values()].map((role) => {
      const rights = uniqueRights([...(this.roleRights.get(role.id) ?? [])]);
      return {
        ...role,
        assignmentCount: this.assignmentCount(role.id),
        rightCount: rights.length,
        rights,
      };
    });
    const assignments = [
      ...[...this.userRoles.entries()].flatMap(([userId, roleIds]) =>
        [...roleIds].map((roleId) => {
          const role = this.roles.get(roleId);
          return {
            memberId: null,
            organizationId: null,
            roleId,
            roleKey: role?.key ?? roleId,
            scopeKind: "platform" as const,
            userId,
          };
        })
      ),
      ...[...this.memberRoles.entries()].flatMap(([memberId, roleIds]) =>
        [...roleIds].map((roleId) => {
          const role = this.roles.get(roleId);
          return {
            memberId,
            organizationId:
              this.memberOrganizationIds.get(memberId) ??
              role?.organizationId ??
              null,
            roleId,
            roleKey: role?.key ?? roleId,
            scopeKind: "organization" as const,
            userId: null,
          };
        })
      ),
    ];
    const audit = this.audit
      .slice(-100)
      .reverse()
      .map((entry) => ({
        action: typeof entry.action === "string" ? entry.action : "unknown",
        actorUserId:
          typeof entry.actor_user_id === "string" ? entry.actor_user_id : null,
        createdAt: null,
        organizationId:
          typeof entry.organization_id === "string"
            ? entry.organization_id
            : null,
        targetId: typeof entry.target_id === "string" ? entry.target_id : null,
        targetKind:
          typeof entry.target_kind === "string" ? entry.target_kind : null,
      }));
    const organizationMax = Math.max(0, ...this.organizationRevisions.values());
    return {
      assignments,
      audit,
      revision: Math.max(this.platformRevision.value, organizationMax),
      roles,
    };
  }

  async listAudit(input: {
    limit?: number;
    organizationId?: string | null;
  }): Promise<readonly Record<string, unknown>[]> {
    const scoped = this.audit.filter((entry) => {
      if (input.organizationId === undefined) {
        return true;
      }
      if (input.organizationId === null) {
        return entry.organization_id == null;
      }
      return entry.organization_id === input.organizationId;
    });
    return scoped.slice(-(input.limit ?? 50));
  }

  async resolveEffectiveRights(input: {
    activeOrganizationId?: string | null;
    getMember: (
      organizationId: string,
      userId: string
    ) => Promise<AuthMemberRow | undefined>;
    userId: string;
  }): Promise<readonly AthenaRightKey[]> {
    await this.ensure();
    const platformRoleIds = [...(this.userRoles.get(input.userId) ?? [])];
    const rights = new Set<string>();
    for (const roleId of platformRoleIds) {
      this.addRoleRights(roleId, rights);
    }
    const organizationId = input.activeOrganizationId?.trim() ?? "";
    if (organizationId.length > 0) {
      const member = await input.getMember(organizationId, input.userId);
      if (member) {
        const memberRoleIds = this.memberRoles.get(member.id);
        if (memberRoleIds && memberRoleIds.size > 0) {
          for (const memberRoleId of memberRoleIds) {
            this.addRoleRights(memberRoleId, rights);
          }
        } else {
          this.addRoleRights(
            this.requireRole(mapLegacyMemberRole(member.role)).id,
            rights
          );
        }
      }
    }
    return uniqueRights([...rights]);
  }

  async readSnapshot(input: {
    activeOrganizationId?: string | null;
    foundingOwnerUserId?: string | null;
    getMember: (
      organizationId: string,
      userId: string
    ) => Promise<AuthMemberRow | undefined>;
    listMembers: (organizationId: string) => Promise<AuthMemberRow[]>;
    userId: string;
  }): Promise<AuthorizationSnapshot> {
    const effectiveRights = await this.resolveEffectiveRights(input);
    const capabilities = capabilitiesFromRights(effectiveRights);
    const roles: AssignedRoleSummary[] = [];
    for (const roleId of this.userRoles.get(input.userId) ?? []) {
      const role = this.roles.get(roleId);
      if (role) {
        roles.push({
          displayName: role.name,
          key: role.key,
          scopeKind: role.scopeKind,
        });
      }
    }
    const organizationId = input.activeOrganizationId?.trim() ?? "";
    if (organizationId.length > 0) {
      const member = await input.getMember(organizationId, input.userId);
      if (member) {
        for (const roleId of this.memberRoles.get(member.id) ?? []) {
          const role = this.roles.get(roleId);
          if (role) {
            roles.push({
              displayName: role.name,
              key: role.key,
              scopeKind: role.scopeKind,
            });
          }
        }
      }
    }
    const members =
      organizationId.length > 0 ? await input.listMembers(organizationId) : [];
    const assignableRoles = projectAssignableRoles({
      activeOrganizationId: organizationId,
      capabilities,
      roles: this.listAssignableRoleDescriptors(organizationId, members.length),
    });
    return {
      ...(organizationId.length > 0
        ? { activeOrganizationId: organizationId }
        : {}),
      assignableRoles,
      capabilities,
      effectiveRights,
      revision: organizationId
        ? (this.organizationRevisions.get(organizationId) ?? 1)
        : this.platformRevision.value,
      roles,
    };
  }

  async annotateMember(
    member: AuthMemberRow,
    actor: {
      foundingOwnerUserId: string | null;
      getMember: (
        organizationId: string,
        userId: string
      ) => Promise<AuthMemberRow | undefined>;
      userId: string;
    }
  ): Promise<MemberAuthorizationActions> {
    await this.ensure();
    const assignedIds = this.memberRoles.get(member.id);
    const roleId =
      assignedIds && assignedIds.size > 0
        ? ([...assignedIds].find((id) => {
            const assigned = this.roles.get(id);
            return assigned?.protected === true;
          }) ?? [...assignedIds][0])
        : this.requireRole(mapLegacyMemberRole(member.role)).id;
    const role = this.requireRoleById(roleId);
    const actorRights = await this.resolveEffectiveRights({
      activeOrganizationId: member.organization_id,
      getMember: actor.getMember,
      userId: actor.userId,
    });
    const capabilities = capabilitiesFromRights(actorRights);
    const denialReasons: MemberAuthorizationActions["denialReasons"] = {};
    if (actor.foundingOwnerUserId === member.user_id) {
      denialReasons.changeRole = FOUNDING_OWNER_ROLE_LOCKED;
      denialReasons.remove = FOUNDING_OWNER_REMOVE_FORBIDDEN;
    } else if (
      actor.userId === member.user_id &&
      role.key === ORGANIZATION_OWNER_ROLE
    ) {
      denialReasons.changeRole =
        "Owners can't change their own role from the members table.";
      denialReasons.remove =
        "Owners can't suspend or remove themselves from the members table.";
    } else if (!capabilities.canChangeMemberRole) {
      denialReasons.changeRole = "Not allowed to change member roles.";
      denialReasons.remove = "Not allowed to remove members.";
    }
    return {
      assignedRoleIds: assignedIds ? [...assignedIds] : [roleId],
      canChangeRole: denialReasons.changeRole === undefined,
      canRemove: denialReasons.remove === undefined,
      denialReasons,
      roleDisplayName: role.name,
      roleKey: role.key,
    };
  }

  async ensureUserAssigned(
    userId: string,
    legacyRole?: string | null
  ): Promise<void> {
    await this.ensure();
    if (!this.userRoles.has(userId)) {
      await this.assignUserRole(userId, mapLegacyUserRole(legacyRole));
    }
  }

  async ensureMemberAssigned(
    memberId: string,
    legacyRole?: string | null
  ): Promise<void> {
    await this.ensure();
    if (!this.memberRoles.has(memberId)) {
      await this.assignMemberRole(memberId, mapLegacyMemberRole(legacyRole));
    }
  }

  private listAssignableRoleDescriptors(
    organizationId: string,
    memberCount: number
  ): RoleDescriptor[] {
    void memberCount;
    const projected: RoleDescriptor[] = [];
    for (const role of this.roles.values()) {
      if (!role.assignable) {
        continue;
      }
      const definition = tryHydrateAthenaRoleDefinition({
        record: role,
        rights: [...(this.roleRights.get(role.id) ?? [])],
      });
      if (!definition) {
        continue;
      }
      const descriptor = projectAuthorizationSnapshotRole(definition, {
        activeOrganizationId: organizationId,
        assignmentCount: this.assignmentCount(role.id),
        version: role.version,
      });
      if (descriptor) {
        projected.push(descriptor);
      }
    }
    return projected;
  }

  private requireScopedRole(
    roleId: string,
    organizationId?: string | null
  ): AthenaAuthorizationRoleRecord {
    const role = this.roles.get(roleId);
    if (!(role && this.roleVisibleInScope(role, organizationId))) {
      throwRoleNotFound();
    }
    return role;
  }

  private roleVisibleInScope(
    role: AthenaAuthorizationRoleRecord,
    organizationId?: string | null
  ): boolean {
    if (organizationId) {
      if (role.scopeKind !== "organization") {
        return false;
      }
      return (
        role.organizationId === null || role.organizationId === organizationId
      );
    }
    return role.scopeKind === "platform" && role.organizationId === null;
  }

  private assignmentCount(roleId: string): number {
    let count = 0;
    for (const roleIds of this.userRoles.values()) {
      if (roleIds.has(roleId)) {
        count += 1;
      }
    }
    for (const roleIds of this.memberRoles.values()) {
      if (roleIds.has(roleId)) {
        count += 1;
      }
    }
    return count;
  }

  private bumpScopeRevision(organizationId: string | null): void {
    if (organizationId) {
      this.bumpOrganizationRevision(organizationId);
      return;
    }
    this.platformRevision.value += 1;
  }

  private resolveOrganizationRole(
    roleRef: string,
    organizationId?: string | null
  ): AthenaAuthorizationRoleRecord {
    const mapped = resolveMemberAssignmentRole(roleRef);
    const matches = [...this.roles.values()].filter((role) => {
      if (role.scopeKind !== "organization" || !role.assignable) {
        return false;
      }
      const hit =
        role.id === roleRef || role.key === roleRef || role.key === mapped;
      if (!hit) {
        return false;
      }
      return (
        role.organizationId === null || role.organizationId === organizationId
      );
    });
    const specific = matches.find(
      (role) => role.organizationId === organizationId
    );
    const template = matches.find((role) => role.organizationId === null);
    const role = specific ?? template;
    if (!role) {
      throw new Error(`Unknown role ${roleRef}`);
    }
    return role;
  }

  private bumpOrganizationRevision(organizationId: string): void {
    this.organizationRevisions.set(
      organizationId,
      (this.organizationRevisions.get(organizationId) ?? 1) + 1
    );
  }

  private addRoleRights(roleId: string | undefined, into: Set<string>): void {
    if (!roleId) {
      return;
    }
    for (const key of this.roleRights.get(roleId) ?? []) {
      into.add(key);
    }
  }

  private requireRole(roleKey: string): AthenaAuthorizationRoleRecord {
    for (const role of this.roles.values()) {
      if (role.key === roleKey && role.organizationId === null) {
        return role;
      }
    }
    throw new Error(`Unknown role ${roleKey}`);
  }

  private requireRoleById(roleId: string): AthenaAuthorizationRoleRecord {
    const role = this.roles.get(roleId);
    if (!role) {
      throw new Error(`Unknown role id ${roleId}`);
    }
    return role;
  }

  private async ensure(): Promise<void> {
    if (!this.materialized) {
      await this.materialize();
    }
  }
}
