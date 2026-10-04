import { AthenaAuthRuntimeError } from "../../auth/local/errors.ts";
import type { AuthMemberRow } from "../../auth/local/models.ts";
import {
	FOUNDING_OWNER_REMOVE_FORBIDDEN,
	FOUNDING_OWNER_ROLE_LOCKED,
} from "../../auth/local/organization-invariants.ts";
import { createAthenaRightsAuthority } from "../../rights/authority.ts";
import {
  type AthenaRightKey,
  parseAthenaRightKey,
  tryParseAthenaRightKey,
} from "../../rights/key.ts";
import {
	projectAuthorizationSnapshotRole,
	tryHydrateAthenaRoleDefinition,
} from "../../roles/index.ts";
import { canonicalizeAthenaRolesIr } from "../../roles/ir/canonicalize.ts";
import { hydrateAthenaRoleDefinition } from "../../roles/persistence.ts";
import {
  type AthenaAccessGrant,
  type AthenaAccessGrantRecord,
  projectAthenaAccessGrants,
} from "./access-grants.ts";
import {
  assertNotLastPlatformAdmin,
  assertOrganizationAssignmentRoles,
  assertPlatformAssignmentRoles,
  ORGANIZATION_BASE_ROLE_KEYS,
} from "./assignment-replace.ts";
import {
  type AthenaAuthorizationAssignmentSource,
  asOrganizationAssignmentRevision,
  asPlatformAssignmentRevision,
  cloneOrganizationMemberAssignment,
  clonePlatformUserAssignment,
  createAuthorizationAuthorityVersion,
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
import { authorizationRolesFingerprint } from "./catalog-state.ts";
import { fingerprintAthenaRightsIr } from "../../rights/ir/fingerprint.ts";
import { assertCloneRoleTenantBoundary } from "./clone-source.ts";
import { canonicalGrantId } from "./grant-identity.ts";
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
import { canonicalizeAthenaAuthorizationSnapshotIr } from "./snapshot-ir/canonicalize.ts";
import type {
	AthenaAuthorizationSnapshotIr,
	AthenaAuthorizationSnapshotScope,
} from "./snapshot-ir/types.ts";
import type { AthenaAuthorizationStore } from "./store.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  builtinRoleRecord,
  LEGACY_PLATFORM_ROLE_KEYS,
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

interface MemoryRoleAssignment {
  assignedAt: string;
  assignedBy: string | null;
  sourceId: string | null;
  sourceKind: AthenaAuthorizationAssignmentSource["sourceKind"] | null;
}

type MemoryRoleAssignments = Map<string, MemoryRoleAssignment>;

export interface MemoryAuthorizationStoreSnapshot {
  audit: Record<string, unknown>[];
  materialized: boolean;
  memberOrganizationIds: Map<string, string>;
  memberRoles: Map<string, MemoryRoleAssignments>;
  memberUserIds: Map<string, string>;
  organizationRevisions: Map<string, number>;
  platformRevision: number;
  roleRights: Map<string, Set<string>>;
  roles: Map<string, AthenaAuthorizationRoleRecord>;
  userRoles: Map<string, MemoryRoleAssignments>;
}

function createMemoryRoleAssignment(
  assignedBy?: string,
  source?: AthenaAuthorizationAssignmentSource
): MemoryRoleAssignment {
  return {
    assignedAt: new Date().toISOString(),
    assignedBy: assignedBy ?? null,
    sourceId: source?.sourceId ?? null,
    sourceKind: source?.sourceKind ?? null,
  };
}

export class MemoryAuthorizationStore implements AthenaAuthorizationStore {
  private readonly audit: Record<string, unknown>[] = [];
  private readonly memberOrganizationIds = new Map<string, string>();
  private readonly memberRoles = new Map<string, MemoryRoleAssignments>();
  private readonly memberUserIds = new Map<string, string>();
  private readonly organizationRevisions = new Map<string, number>();
  private readonly platformRevision = { value: 1 };
  private readonly roleRights = new Map<string, Set<string>>();
  private readonly roles = new Map<string, AthenaAuthorizationRoleRecord>();
  private readonly userRoles = new Map<string, MemoryRoleAssignments>();
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

  snapshot(): MemoryAuthorizationStoreSnapshot {
    return structuredClone({
      audit: this.audit,
      materialized: this.materialized,
      memberOrganizationIds: this.memberOrganizationIds,
      memberRoles: this.memberRoles,
      memberUserIds: this.memberUserIds,
      organizationRevisions: this.organizationRevisions,
      platformRevision: this.platformRevision.value,
      roleRights: this.roleRights,
      roles: this.roles,
      userRoles: this.userRoles,
    });
  }

  restore(snapshot: MemoryAuthorizationStoreSnapshot): void {
    this.audit.splice(0, this.audit.length, ...structuredClone(snapshot.audit));
    replaceMap(this.memberOrganizationIds, snapshot.memberOrganizationIds);
    replaceMap(this.memberRoles, snapshot.memberRoles);
    replaceMap(this.memberUserIds, snapshot.memberUserIds);
    replaceMap(this.organizationRevisions, snapshot.organizationRevisions);
    replaceMap(this.roleRights, snapshot.roleRights);
    replaceMap(this.roles, snapshot.roles);
    replaceMap(this.userRoles, snapshot.userRoles);
    this.platformRevision.value = snapshot.platformRevision;
    this.materialized = snapshot.materialized;
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
    const current = this.userRoles.get(userId) ?? new Map();
    if (current.has(role.id)) {
      return;
    }
    const next = new Map(current);
    next.set(role.id, createMemoryRoleAssignment(assignedBy));
    this.userRoles.set(userId, next);
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
    organizationId?: string | null,
    memberUserId?: string,
    source?: AthenaAuthorizationAssignmentSource
  ): Promise<void> {
    await this.ensure();
    const role = this.resolveOrganizationRole(roleKey, organizationId);
    if (organizationId) {
      this.memberOrganizationIds.set(memberId, organizationId);
    }
    if (memberUserId != null) {
      this.memberUserIds.set(memberId, memberUserId);
    }
    const current = this.memberRoles.get(memberId) ?? new Map();
    if (current.has(role.id)) {
      return;
    }
    const next = new Map(current);
    if (
      source &&
      (source.sourceKind !== "identity_connection" ||
        source.sourceId.trim().length === 0)
    ) {
      throw AthenaAuthRuntimeError.badRequest(
        "Authorization assignment sourceId is required"
      );
    }
    next.set(role.id, createMemoryRoleAssignment(assignedBy, source));
    this.memberRoles.set(memberId, next);
    if (organizationId) {
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

  async replaceLegacyPlatformRole(input: {
    assignedBy?: string;
    role: string | null | undefined;
    userId: string;
  }): Promise<void> {
    await this.ensure();
    const role = this.requireRole(mapLegacyUserRole(input.role));
    const current = this.userRoles.get(input.userId) ?? new Map();
    const legacyKeys = new Set(LEGACY_PLATFORM_ROLE_KEYS);
    const next = new Map(
      [...current].filter(
        ([id]) =>
          id === role.id || !legacyKeys.has(this.roles.get(id)?.key ?? "")
      )
    );
    if (!next.has(role.id)) {
      next.set(role.id, createMemoryRoleAssignment(input.assignedBy));
    }
    if (sameRoleIds(current, next)) {
      return;
    }
    const currentAdminUserIds = [...this.userRoles.entries()]
      .filter(([, roleIds]) =>
        [...roleIds.keys()].some(
          (roleId) => this.roles.get(roleId)?.key === PLATFORM_ADMIN_ROLE
        )
      )
      .map(([userId]) => userId);
    if (
      role.key === PLATFORM_ADMIN_ROLE ||
      currentAdminUserIds.includes(input.userId)
    ) {
      assertNotLastPlatformAdmin({
        currentAdminUserIds,
        nextHasAdmin: [...next.keys()].some(
          (id) => this.roles.get(id)?.key === PLATFORM_ADMIN_ROLE
        ),
        targetUserId: input.userId,
      });
    }
    this.userRoles.set(input.userId, next);
    this.platformRevision.value += 1;
    this.audit.push({
      action: "user.legacy_role.replace",
      actor_user_id: input.assignedBy ?? null,
      after_state: { roleKey: role.key },
      before_state: {
        roleKeys: [...current.keys()].map((id) => this.roles.get(id)?.key),
      },
      target_id: input.userId,
      target_kind: "user",
    });
  }

  async replaceOrganizationBaseRole(input: {
    assignedBy?: string;
    foundingOwnerUserId?: string | null;
    memberId: string;
    memberUserId: string;
    organizationId: string;
    role: string;
  }): Promise<void> {
    await this.ensure();
    const role = this.resolveOrganizationRole(
      mapLegacyMemberRole(input.role),
      input.organizationId
    );
    const current = this.memberRoles.get(input.memberId) ?? new Map();
    const next = new Map(
      [...current].filter(
        ([id]) =>
          id === role.id ||
          !ORGANIZATION_BASE_ROLE_KEYS.has(this.roles.get(id)?.key ?? "")
      )
    );
    if (!next.has(role.id)) {
      next.set(role.id, createMemoryRoleAssignment(input.assignedBy));
    }
    const nextRoles = [...next.keys()].map((id) => this.requireRoleById(id));
    assertOrganizationAssignmentRoles({
      foundingOwnerUserId: input.foundingOwnerUserId,
      memberUserId: input.memberUserId,
      organizationId: input.organizationId,
      roles: nextRoles,
    });
    this.memberOrganizationIds.set(input.memberId, input.organizationId);
    this.memberUserIds.set(input.memberId, input.memberUserId);
    if (sameRoleIds(current, next)) {
      return;
    }
    this.memberRoles.set(input.memberId, next);
    this.bumpOrganizationRevision(input.organizationId);
    this.audit.push({
      action: "member.legacy_role.replace",
      actor_user_id: input.assignedBy ?? null,
      after_state: { roleKey: role.key },
      before_state: {
        roleKeys: [...current.keys()].map((id) => this.roles.get(id)?.key),
      },
      organization_id: input.organizationId,
      target_id: input.memberId,
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
        roleIds: freezeRoleIds([...(this.userRoles.get(userId)?.keys() ?? [])]),
        userId,
      })
    );
    return Object.freeze({
      assignments: Object.freeze(assignments),
      authorityVersion: createAuthorizationAuthorityVersion(
        this.platformRevision.value
      ),
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
		for (const [memberId, roleAssignments] of this.memberRoles.entries()) {
			const mappedOrg = this.memberOrganizationIds.get(memberId);
			if (mappedOrg != null && mappedOrg !== input.organizationId) {
				continue;
			}
			assignments.push(
				cloneOrganizationMemberAssignment({
					memberId,
					roleIds: freezeRoleIds([...roleAssignments.keys()]),
					userId: this.requireMemberUserId(memberId),
				})
			);
		}
		return Object.freeze({
			assignments: Object.freeze(assignments),
			authorityVersion: createAuthorizationAuthorityVersion(
				this.organizationRevisions.get(input.organizationId) ?? 1
			),
			organizationId: input.organizationId,
			revision: asOrganizationAssignmentRevision(
				this.organizationRevisions.get(input.organizationId) ?? 1
			),
		});
	}

	async readAuthoritySnapshot(input: {
		scope: AthenaAuthorizationSnapshotScope;
	}): Promise<AthenaAuthorizationSnapshotIr> {
		await this.ensure();
		const rights = getAthenaAuthorizationRightsIr();
		const rightsAuthority = createAthenaRightsAuthority(rights);
		const organizationId =
			input.scope.kind === "organization" ? input.scope.organizationId : null;
		const roles = [...this.roles.values()]
			.filter((role) =>
				input.scope.kind === "platform"
					? role.scopeKind === "platform"
					: role.scopeKind === "organization" &&
						(role.organizationId === null || role.organizationId === organizationId)
			)
			.map((record) =>
				hydrateAthenaRoleDefinition(
					{
						record,
						rights: [...(this.roleRights.get(record.id) ?? [])],
					},
					rightsAuthority
				)
			);
		const assignments: AthenaAuthorizationSnapshotIr["assignments"][number][] = [];
		const roleAssignments =
			input.scope.kind === "platform" ? this.userRoles : this.memberRoles;
		for (const [subjectId, assignedRoles] of roleAssignments) {
			let subject: AthenaAuthorizationSnapshotIr["assignments"][number]["subject"];
			if (input.scope.kind === "platform") {
				subject = { kind: "user", userId: subjectId };
			} else {
				const assignedOrganizationId = this.memberOrganizationIds.get(subjectId);
				if (assignedOrganizationId !== organizationId) {
					continue;
				}
				const userId = this.memberUserIds.get(subjectId);
				if (!userId) {
					throw new Error(`Member ${subjectId} identity is unavailable`);
				}
				subject = { kind: "member", memberId: subjectId, userId };
			}
			const grantSubjectId = subject.kind === "user" ? subject.userId : subject.memberId;
			for (const [roleId, provenance] of assignedRoles) {
				if (
					(provenance.sourceId == null) !== (provenance.sourceKind == null) ||
					(provenance.sourceKind != null &&
						(provenance.sourceKind !== "identity_connection" ||
							provenance.sourceId?.trim().length === 0))
				) {
					throw new Error("ATHENA_AUTHORIZATION_INVENTORY_PROVENANCE_INVALID");
				}
				assignments.push({
					id: canonicalGrantId({
						organizationId,
						roleId,
						scopeKind: input.scope.kind,
						subjectId: grantSubjectId,
						subjectKind: subject.kind,
					}),
					provenance: {
						assignedAt: provenance.assignedAt,
						assignedBy: provenance.assignedBy,
						...(provenance.sourceId != null && provenance.sourceKind != null
							? { sourceId: provenance.sourceId, sourceKind: provenance.sourceKind }
							: {}),
					},
					roleId: roleId as AthenaAuthorizationSnapshotIr["assignments"][number]["roleId"],
					subject,
				});
			}
		}
		return canonicalizeAthenaAuthorizationSnapshotIr({
			assignments,
			irVersion: 1,
			kind: "athena.authorization.snapshot",
			metadata: {
				assignmentRevision:
					input.scope.kind === "platform"
						? this.platformRevision.value
						: (this.organizationRevisions.get(input.scope.organizationId) ?? 1),
				capturedAt: new Date().toISOString(),
				catalogVersion: AUTHORIZATION_CATALOG_VERSION,
				rightsFingerprint: fingerprintAthenaRightsIr(rights),
				rolesFingerprint: authorizationRolesFingerprint(),
				provenance: ["authorization-store"],
			},
			rights,
			roles: canonicalizeAthenaRolesIr(
				{ irVersion: 1, kind: "athena.roles", metadata: {}, roles },
				rightsAuthority
			),
			scope: input.scope,
		});
	}

  async recordMemberRemoval(input: {
    memberId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    await this.ensure();
    this.memberRoles.delete(input.memberId);
    this.memberOrganizationIds.delete(input.memberId);
    this.memberUserIds.delete(input.memberId);
    this.bumpOrganizationRevision(input.organizationId);
    this.audit.push({
      action: "member.delete",
      organization_id: input.organizationId,
      target_id: input.memberId,
      target_kind: "member",
      user_id: input.userId,
    });
  }

  async recordOrganizationDeletion(input: {
    organizationId: string;
  }): Promise<void> {
    await this.ensure();
    const organizationRoleIds = new Set(
      [...this.roles.values()]
        .filter(
          (role) =>
            role.scopeKind === "organization" &&
            role.organizationId === input.organizationId
        )
        .map((role) => role.id)
    );
    for (const [memberId, organizationId] of this.memberOrganizationIds) {
      if (organizationId === input.organizationId) {
        this.memberRoles.delete(memberId);
        this.memberOrganizationIds.delete(memberId);
        this.memberUserIds.delete(memberId);
      }
    }
    for (const [memberId, assignments] of this.memberRoles) {
      if (
        [...assignments.keys()].some((roleId) =>
          organizationRoleIds.has(roleId)
        )
      ) {
        this.memberRoles.delete(memberId);
        this.memberOrganizationIds.delete(memberId);
        this.memberUserIds.delete(memberId);
      }
    }
    for (const roleId of organizationRoleIds) {
      this.roles.delete(roleId);
      this.roleRights.delete(roleId);
    }
    this.organizationRevisions.delete(input.organizationId);
  }

  async recordUserDeletion(input: {
    memberships: readonly { memberId: string; organizationId: string }[];
    userId: string;
  }): Promise<void> {
    await this.ensure();
    this.assertPlatformAdminWillRemain(input.userId);
    this.userRoles.delete(input.userId);
    for (const membership of input.memberships) {
      this.memberRoles.delete(membership.memberId);
      this.memberOrganizationIds.delete(membership.memberId);
      this.memberUserIds.delete(membership.memberId);
    }
    this.platformRevision.value += 1;
    for (const organizationId of new Set(
      input.memberships.map((membership) => membership.organizationId)
    )) {
      this.bumpOrganizationRevision(organizationId);
    }
    this.audit.push({
      action: "user.delete",
      target_id: input.userId,
      target_kind: "user",
    });
  }

  async assertUserDeletionAllowed(input: { userId: string }): Promise<void> {
    await this.ensure();
    this.assertPlatformAdminWillRemain(input.userId);
  }

  private assertPlatformAdminWillRemain(userId: string): void {
    const currentAdminUserIds = [...this.userRoles.entries()]
      .filter(([, roleIds]) =>
        [...roleIds.keys()].some(
          (roleId) => this.roles.get(roleId)?.key === PLATFORM_ADMIN_ROLE
        )
      )
      .map(([assignedUserId]) => assignedUserId);
    if (currentAdminUserIds.includes(userId)) {
      assertNotLastPlatformAdmin({
        currentAdminUserIds,
        nextHasAdmin: false,
        targetUserId: userId,
      });
    }
  }

  async listMemberRoleAssignments(input: {
    organizationId: string;
  }): Promise<readonly OrganizationMemberRoleAssignment[]> {
    return (await this.readMemberRoleAssignmentsSnapshot(input)).assignments;
  }

  async listAccessGrants(): Promise<readonly AthenaAccessGrant[]> {
    await this.ensure();
    const records: Array<{
      assignmentRevision: number;
      record: Omit<AthenaAccessGrantRecord, "authorityVersion">;
    }> = [];

    for (const [userId, assignments] of this.userRoles) {
      for (const [roleId, assignment] of assignments) {
        const role = this.roles.get(roleId);
        if (!role) {
          throw new Error("ATHENA_AUTHORIZATION_INVENTORY_ROLE_MISSING");
        }
        records.push({
          assignmentRevision: this.platformRevision.value,
          record: {
            assignedAt: assignment.assignedAt,
            assignedBy: assignment.assignedBy,
            memberId: null,
            organizationId: null,
            rightKeys: [...(this.roleRights.get(roleId) ?? [])],
            roleId,
            roleKey: role.key,
            scopeKind: "platform",
            sourceId: assignment.sourceId,
            sourceKind: assignment.sourceKind,
            userId,
          },
        });
      }
    }

    for (const [memberId, assignments] of this.memberRoles) {
      const userId = this.memberUserIds.get(memberId);
      const organizationId = this.memberOrganizationIds.get(memberId);
      if (!(userId && organizationId)) {
        throw new Error("ATHENA_AUTHORIZATION_INVENTORY_IDENTITY_INVALID");
      }
      const revision = this.organizationRevisions.get(organizationId) ?? 1;
      for (const [roleId, assignment] of assignments) {
        const role = this.roles.get(roleId);
        if (!role) {
          throw new Error("ATHENA_AUTHORIZATION_INVENTORY_ROLE_MISSING");
        }
        records.push({
          assignmentRevision: revision,
          record: {
            assignedAt: assignment.assignedAt,
            assignedBy: assignment.assignedBy,
            memberId,
            organizationId,
            rightKeys: [...(this.roleRights.get(roleId) ?? [])],
            roleId,
            roleKey: role.key,
            scopeKind: "organization",
            sourceId: assignment.sourceId,
            sourceKind: assignment.sourceKind,
            userId,
          },
        });
      }
    }

    return projectAthenaAccessGrants(records);
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
    const current = this.userRoles.get(input.userId) ?? new Map();
    const uniqueIds = [...new Set(input.roleIds)];
    const roles = uniqueIds.map((id) => this.requireRoleById(id));
    assertPlatformAssignmentRoles(roles);
    const afterRights = uniqueIds.flatMap((id) => [
      ...(this.roleRights.get(id) ?? []),
    ]);
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights,
      beforeRights: [...current.keys()].flatMap((id) => [
        ...(this.roleRights.get(id) ?? []),
      ]),
      roleScope: "platform",
    });
    const unchanged =
      current.size === uniqueIds.length &&
      uniqueIds.every((id) => current.has(id));
    if (unchanged) {
      return { revision: this.platformRevision.value };
    }
    const currentAdmins = [...this.userRoles.entries()]
      .filter(([, roleIds]) =>
        [...roleIds.keys()].some(
          (roleId) => this.roles.get(roleId)?.key === PLATFORM_ADMIN_ROLE
        )
      )
      .map(([userId]) => userId);
    const nextHasAdmin = roles.some((role) => role.key === PLATFORM_ADMIN_ROLE);
    if (currentAdmins.includes(input.userId) || nextHasAdmin) {
      assertNotLastPlatformAdmin({
        currentAdminUserIds: currentAdmins,
        nextHasAdmin,
        targetUserId: input.userId,
      });
    }
    const next = new Map([...current].filter(([id]) => uniqueIds.includes(id)));
    for (const id of uniqueIds) {
      if (!next.has(id)) {
        next.set(id, createMemoryRoleAssignment(input.actorUserId));
      }
    }
    this.userRoles.set(input.userId, next);
    this.platformRevision.value += 1;
    this.audit.push({
      action: "user.roles.replace",
      actor_user_id: input.actorUserId,
      after_state: { roleIds: uniqueIds },
      before_state: { roleIds: [...current.keys()] },
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
    const current = this.memberRoles.get(input.memberId) ?? new Map();
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
      beforeRights: [...current.keys()].flatMap((id) => [
        ...(this.roleRights.get(id) ?? []),
      ]),
      organizationId: input.organizationId,
      roleScope: "organization",
    });
    const unchanged =
      current.size === uniqueIds.length &&
      uniqueIds.every((id) => current.has(id));
    this.memberOrganizationIds.set(input.memberId, input.organizationId);
    this.memberUserIds.set(input.memberId, input.memberUserId);
    if (unchanged) {
      return { revision };
    }
    const next = new Map([...current].filter(([id]) => uniqueIds.includes(id)));
    for (const id of uniqueIds) {
      if (!next.has(id)) {
        next.set(id, createMemoryRoleAssignment(input.actorUserId));
      }
    }
    this.memberRoles.set(input.memberId, next);
    this.bumpOrganizationRevision(input.organizationId);
    this.audit.push({
      action: "member.roles.replace",
      actor_user_id: input.actorUserId,
      after_state: { roleIds: uniqueIds },
      before_state: { roleIds: [...current.keys()] },
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
  }): Promise<{
    reassignedMemberIds: readonly string[];
    reassignedUserIds: readonly string[];
  }> {
    await this.ensure();
    const role = this.requireScopedRole(input.id, input.organizationId);
    assertProtectedRoleImmutable(role);
    assertExpectedVersion(role, input.expectedVersion);
    const assigned = this.assignmentCount(role.id);
    const reassignedMemberIds: string[] = [];
    const reassignedUserIds: string[] = [];
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
        for (const [memberId, roleIds] of this.memberRoles) {
          if (roleIds.has(role.id)) {
            roleIds.delete(role.id);
            if (!roleIds.has(replacement.id)) {
              roleIds.set(
                replacement.id,
                createMemoryRoleAssignment(input.actorUserId)
              );
            }
            reassignedMemberIds.push(memberId);
          }
        }
      } else {
        for (const [userId, roleIds] of this.userRoles) {
          if (roleIds.has(role.id)) {
            roleIds.delete(role.id);
            reassignedUserIds.push(userId);
            if (!roleIds.has(replacement.id)) {
              roleIds.set(
                replacement.id,
                createMemoryRoleAssignment(input.actorUserId)
              );
            }
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
    return { reassignedMemberIds, reassignedUserIds };
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
        [...roleIds.keys()].map((roleId) => {
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
        [...roleIds.keys()].map((roleId) => {
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
    const platformRoleIds = [
      ...(this.userRoles.get(input.userId)?.keys() ?? []),
    ];
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
          for (const memberRoleId of memberRoleIds.keys()) {
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
    for (const roleId of this.userRoles.get(input.userId)?.keys() ?? []) {
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
        for (const roleId of this.memberRoles.get(member.id)?.keys() ?? []) {
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
        ? ([...assignedIds.keys()].find((id) => {
            const assigned = this.roles.get(id);
            return assigned?.protected === true;
          }) ?? [...assignedIds.keys()][0])
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
      assignedRoleIds: assignedIds ? [...assignedIds.keys()] : [roleId],
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

  private requireMemberUserId(memberId: string): string {
    const userId = this.memberUserIds.get(memberId);
    if (userId == null || userId.length === 0) {
      throw new Error("ATHENA_AUTHORIZATION_MEMBER_USER_ID_MISSING");
    }
    return userId;
  }

  private async ensure(): Promise<void> {
    if (!this.materialized) {
      await this.materialize();
    }
  }
}

function sameRoleIds(
  left: ReadonlyMap<string, MemoryRoleAssignment>,
  right: ReadonlyMap<string, MemoryRoleAssignment>
) {
  return (
    left.size === right.size && [...left.keys()].every((id) => right.has(id))
  );
}

function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) {
    target.set(key, structuredClone(value));
  }
}
