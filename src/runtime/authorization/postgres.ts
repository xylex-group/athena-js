import {
  type AthenaAuthDatabase,
  assertQueryResult,
} from "../../auth/local/database.ts";
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
	canonicalizeAthenaRolesIr,
	hydrateAthenaRoleDefinition,
	projectAuthorizationSnapshotRole,
	tryHydrateAthenaRoleDefinition,
} from "../../roles/index.ts";
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
  createAuthorizationAuthorityVersion,
  groupOrganizationMemberAssignments,
  groupPlatformUserAssignments,
  type OrganizationMemberAssignmentSnapshot,
  type OrganizationMemberRoleAssignment,
  type PlatformUserAssignmentSnapshot,
  type PlatformUserRoleAssignment,
} from "./assignment-snapshot.ts";
import {
  projectAthenaAccessGrants,
  type AthenaAccessGrant,
  type AthenaAccessGrantRecord,
} from "./access-grants.ts";
import { canonicalGrantId } from "./grant-identity.ts";
import { capabilitiesFromRights } from "./capabilities.ts";
import {
  AUTHORIZATION_CATALOG_VERSION,
  getAthenaAuthorizationRightsIr,
} from "./catalog.ts";
import {
  AUTHORIZATION_CATALOG_LOCK,
  AUTHORIZATION_CATALOG_STATE_SQL,
  authorizationRightsFingerprint,
  authorizationRolesFingerprint,
  catalogStateIsCurrent,
} from "./catalog-state.ts";
import { assertCloneRoleTenantBoundary } from "./clone-source.ts";
import type { AthenaAuthorizationInspectGraph } from "./inspect.ts";
import { toRoleDescriptor, toRoleDetail } from "./role-descriptor.ts";
import {
  assertAuthorizationDelegationAllowed,
  assertProtectedRoleImmutable,
  throwAssignmentVersionConflict,
  throwReassignmentInvalid,
  throwRoleHasAssignments,
  throwRoleNotFound,
  throwRoleVersionConflict,
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
  compatibilityMemberRole,
  LEGACY_PLATFORM_ROLE_KEYS,
  mapLegacyMemberRole,
  mapLegacyUserRole,
  ORGANIZATION_OWNER_ROLE,
  PLATFORM_ADMIN_ROLE,
  persistedMemberRole,
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

export const ATHENA_AUTHORIZATION_ROLE_KEY_MISMATCH =
  "ATHENA_AUTHORIZATION_ROLE_KEY_MISMATCH";

function throwAuthorizationRevisionMissing(): never {
  throw new AthenaAuthRuntimeError(
    500,
    "Authorization revision row is missing",
    { code: "ATHENA_AUTHORIZATION_REVISION_MISSING" }
  );
}

interface RoleRow {
  assignable: boolean;
  id: string;
  key: string;
  name: string;
  organization_id: string | null;
  protected: boolean;
  scope_kind: "platform" | "organization";
  system_kind: "owner" | "admin" | "member" | null;
  version: number;
}

function mapRoleRow(row: RoleRow): AthenaAuthorizationRoleRecord {
  return {
    assignable: row.assignable,
    id: row.id,
    key: row.key,
    name: row.name,
    organizationId: row.organization_id,
    protected: row.protected,
    scopeKind: row.scope_kind,
    systemKind: row.system_kind,
    version: row.version,
  };
}

export class PostgresAuthorizationStore implements AthenaAuthorizationStore {
  constructor(private readonly db: AthenaAuthDatabase) {}

  async ensureCatalog(): Promise<void> {
    // Reads only. Catalog writes go through materialize()'s locked transaction.
    if (!(await authorizationCatalogStateRelationVisible(this.db))) {
      await this.materialize();
      return;
    }
    if (catalogStateIsCurrent(await this.readCatalogState(this.db))) {
      return;
    }
    await this.materialize();
  }

  /** Sole catalog writer: xact lock, DDL, then writeCatalog on this transaction. */
  async materialize(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock($1)", [
        AUTHORIZATION_CATALOG_LOCK,
      ]);
      // CREATE TABLE IF NOT EXISTS before the first fingerprint read.
      await tx.query(AUTHORIZATION_CATALOG_STATE_SQL);
      if (catalogStateIsCurrent(await this.readCatalogState(tx))) {
        return;
      }
      await this.writeCatalog(tx);
    });
  }

  private async writeCatalog(db: AthenaAuthDatabase): Promise<void> {
    for (const right of getAthenaAuthorizationRightsIr().rights) {
      await db.query(
        `INSERT INTO athena.authorization_rights (
					key, domain, display_name, description, scope_kind, risk_level,
					assignable, source_version
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT (key) DO UPDATE SET
					domain = EXCLUDED.domain,
					display_name = EXCLUDED.display_name,
					description = EXCLUDED.description,
					scope_kind = EXCLUDED.scope_kind,
					risk_level = EXCLUDED.risk_level,
					assignable = EXCLUDED.assignable,
					source_version = EXCLUDED.source_version`,
        [
          right.key,
          right.domain,
          right.displayName,
          right.description,
          right.scopeKind,
          right.riskLevel,
          right.assignable,
          AUTHORIZATION_CATALOG_VERSION,
        ]
      );
    }
    for (const template of BUILTIN_AUTHORIZATION_ROLES) {
      const roleUpsert = await db.query(
        `INSERT INTO athena.authorization_roles (
					id, key, name, scope_kind, organization_id, system_kind,
					protected, assignable, version
				) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, 1)
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					scope_kind = EXCLUDED.scope_kind,
					system_kind = EXCLUDED.system_kind,
					protected = EXCLUDED.protected,
					assignable = EXCLUDED.assignable,
					updated_at = NOW()
				WHERE authorization_roles.key = EXCLUDED.key
				RETURNING id`,
        [
          template.id,
          template.key,
          template.name,
          template.scopeKind,
          template.systemKind,
          template.protected,
          template.assignable,
        ]
      );
      if (roleUpsert.rowCount !== 1) {
        throw new AthenaAuthRuntimeError(
          500,
          "Authorization catalog is inconsistent.",
          {
            code: ATHENA_AUTHORIZATION_ROLE_KEY_MISMATCH,
            internalMessage: `Built-in role ${template.id} has a different persisted key. Role keys are immutable identity.`,
          }
        );
      }
      await db.query(
        `WITH desired AS (
					SELECT UNNEST($2::text[]) AS right_key
				),
				deleted AS (
					DELETE FROM athena.authorization_role_rights existing
					WHERE existing.role_id = $1
					  AND NOT EXISTS (
					    SELECT 1 FROM desired d WHERE d.right_key = existing.right_key
					  )
					RETURNING existing.right_key
				)
				INSERT INTO athena.authorization_role_rights (role_id, right_key)
				SELECT $1, d.right_key
				FROM desired d
				ON CONFLICT DO NOTHING`,
        [template.id, [...template.rights]]
      );
    }
    const platformAssignments = await db.query(
      `INSERT INTO athena.authorization_user_roles (user_id, role_id)
       SELECT u.id, r.id
       FROM athena.users u
       JOIN athena.authorization_roles r
         ON r.key = CASE
           WHEN u.role = 'admin' THEN 'platform_admin'
           WHEN u.role = 'unauthorized' THEN 'platform_unauthorized'
           WHEN COALESCE(u.role, '') IN ('', 'customer') THEN 'platform_customer'
           ELSE 'platform_unauthorized'
         END
        AND r.organization_id IS NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM athena.authorization_user_roles a WHERE a.user_id = u.id
       )
       RETURNING user_id`
    );
    if (platformAssignments.rowCount > 0) {
      await new PostgresAuthorizationStore(db).bumpRevision(null);
    }
    const memberAssignments = await db.query<{ member_id: string }>(
      `INSERT INTO athena.authorization_member_roles (member_id, role_id)
			 SELECT m.id, r.id
			 FROM athena.member m
			 JOIN athena.authorization_roles r
			   ON r.id = CASE
			     WHEN m.role = 'owner' THEN 'organization_owner'
			     WHEN m.role = 'admin' THEN 'organization_admin'
			     ELSE 'organization_member'
			   END
       WHERE NOT EXISTS (
         SELECT 1 FROM athena.authorization_member_roles a WHERE a.member_id = m.id
       )
       RETURNING member_id`
    );
    if (memberAssignments.rowCount > 0) {
      const organizations = await db.query<{ organization_id: string }>(
        `SELECT DISTINCT organization_id
         FROM athena.member WHERE id = ANY($1::text[])`,
        [memberAssignments.rows.map((row) => row.member_id)]
      );
      for (const organizationId of organizations.rows.map(
        (row) => row.organization_id
      )) {
        await new PostgresAuthorizationStore(db).bumpRevision(
          organizationId
        );
      }
    }
    await this.persistCatalogState(db);
  }

  /** Fingerprint row. Caller must have probed `to_regclass` or applied `AUTHORIZATION_CATALOG_STATE_SQL`. */
  private async readCatalogState(db: AthenaAuthDatabase): Promise<
    | {
        catalogVersion: number;
        rightsFingerprint: string;
        rolesFingerprint: string;
      }
    | undefined
  > {
    const result = await db.query<{
      catalog_version: number;
      rights_fingerprint: string;
      roles_fingerprint: string;
    }>(
      `SELECT catalog_version, rights_fingerprint, roles_fingerprint
				 FROM athena.authorization_catalog_state
				 WHERE id = TRUE`
    );
    const row = result.rows[0];
    if (!row) {
      return;
    }
    return {
      catalogVersion: Number(row.catalog_version),
      rightsFingerprint: String(row.rights_fingerprint),
      rolesFingerprint: String(row.roles_fingerprint),
    };
  }

  private async persistCatalogState(db: AthenaAuthDatabase): Promise<void> {
    await db.query(
      `INSERT INTO athena.authorization_catalog_state (
				id, catalog_version, materialized_at, rights_fingerprint, roles_fingerprint
			) VALUES (TRUE, $1, NOW(), $2, $3)
			 ON CONFLICT (id) DO UPDATE SET
				catalog_version = EXCLUDED.catalog_version,
				materialized_at = NOW(),
				rights_fingerprint = EXCLUDED.rights_fingerprint,
				roles_fingerprint = EXCLUDED.roles_fingerprint`,
      [
        AUTHORIZATION_CATALOG_VERSION,
        authorizationRightsFingerprint(),
        authorizationRolesFingerprint(),
      ]
    );
  }

  async hasUserAssignment(userId: string): Promise<boolean> {
    const result = await this.db.query(
      "SELECT 1 FROM athena.authorization_user_roles WHERE user_id = $1",
      [userId]
    );
    return result.rowCount > 0;
  }

  async assignUserRole(
    userId: string,
    roleKey: string,
    assignedBy?: string
  ): Promise<void> {
    if (!this.db.inTransaction) {
      return this.db.transaction((tx) =>
        new PostgresAuthorizationStore(tx).assignUserRole(
          userId,
          roleKey,
          assignedBy
        )
      );
    }
    const normalizedLegacyRole = roleKey.trim();
    const isLegacyAlias =
      normalizedLegacyRole.length === 0 ||
      normalizedLegacyRole === "admin" ||
      normalizedLegacyRole === "customer" ||
      normalizedLegacyRole === "unauthorized";
    const key = isLegacyAlias ? mapLegacyUserRole(roleKey) : roleKey;
    let role = await this.db.query<{ id: string }>(
      `SELECT id FROM athena.authorization_roles
       WHERE key = $1 AND organization_id IS NULL AND scope_kind = 'platform'`,
      [key]
    );
    const fallbackKey = mapLegacyUserRole(roleKey);
    if (!role.rows[0] && fallbackKey !== key) {
      role = await this.db.query<{ id: string }>(
        `SELECT id FROM athena.authorization_roles
         WHERE key = $1 AND organization_id IS NULL AND scope_kind = 'platform'`,
        [fallbackKey]
      );
    }
    const roleId = role.rows[0]?.id;
    if (!roleId) {
      throw AthenaAuthRuntimeError.badRequest("Unknown platform role");
    }
    const assigned = await this.db.query(
      `INSERT INTO athena.authorization_user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_id) DO NOTHING
       RETURNING role_id`,
      [userId, roleId, assignedBy ?? null]
    );
    if (assigned.rowCount === 0) {
      return;
    }
    await this.bumpRevision(null);
    await this.writeAudit({
      action: "user.role.assign",
      actorUserId: assignedBy,
      after: { roleKey: key },
      targetId: userId,
      targetKind: "user",
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
    if (!this.db.inTransaction) {
      return this.db.transaction((tx) =>
        new PostgresAuthorizationStore(tx).assignMemberRole(
          memberId,
          roleKey,
          assignedBy,
          organizationId,
          memberUserId,
          source
        )
      );
    }
    const member = await this.db.query<{ organization_id: string }>(
      "SELECT organization_id FROM athena.member WHERE id = $1",
      [memberId]
    );
    const orgId = organizationId ?? member.rows[0]?.organization_id ?? null;
    if (!orgId) {
      throw AthenaAuthRuntimeError.badRequest("Member not found");
    }
    const role = await this.lookupAssignableOrganizationRole(orgId, roleKey);
    if (!role) {
      throw AthenaAuthRuntimeError.badRequest("Unknown or unassignable role");
    }
    if (
      source &&
      (source.sourceKind !== "identity_connection" ||
        source.sourceId.trim().length === 0)
    ) {
      throw AthenaAuthRuntimeError.badRequest(
        "Authorization assignment sourceId is required"
      );
    }
    const assigned = await this.db.query(
      `INSERT INTO athena.authorization_member_roles (
         member_id, role_id, assigned_by, source_kind, source_id
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (member_id, role_id) DO NOTHING
       RETURNING role_id`,
      [
        memberId,
        role.id,
        assignedBy ?? null,
        source?.sourceKind ?? null,
        source?.sourceId ?? null,
      ]
    );
    if (assigned.rowCount === 0) {
      return;
    }
    await this.bumpRevision(orgId);
    await this.writeAudit({
      action: "member.role.assign",
      actorUserId: assignedBy,
      after: { roleKey: role.key },
      organizationId: orgId,
      targetId: memberId,
      targetKind: "member",
    });
  }

  async replaceLegacyPlatformRole(input: {
    assignedBy?: string;
    role: string | null | undefined;
    userId: string;
  }): Promise<void> {
    if (!this.db.inTransaction) {
      return this.db.transaction((tx) =>
        new PostgresAuthorizationStore(tx).replaceLegacyPlatformRole(input)
      );
    }
    const user = await this.db.query<{ id: string }>(
      `SELECT id FROM athena.users WHERE id = $1 FOR UPDATE`,
      [input.userId]
    );
    if (!user.rows[0]) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    const roleKey = mapLegacyUserRole(input.role);
    const roleResult = await this.db.query<RoleRow>(
      `SELECT * FROM athena.authorization_roles
       WHERE key = $1 AND scope_kind = 'platform' AND organization_id IS NULL`,
      [roleKey]
    );
    const roleRow = roleResult.rows[0];
    if (!roleRow) {
      throw AthenaAuthRuntimeError.badRequest("Unknown platform role");
    }
    const role = mapRoleRow(roleRow);
    const current = await this.db.query<{ key: string; role_id: string }>(
      `SELECT r.key, ur.role_id
       FROM athena.authorization_user_roles ur
       JOIN athena.authorization_roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
       FOR UPDATE OF ur`,
      [input.userId]
    );
    const existingRoleIds = current.rows.map((row) => row.role_id);
    const existingLegacyRoleIds = current.rows
      .filter((row) => LEGACY_PLATFORM_ROLE_KEYS.includes(row.key))
      .map((row) => row.role_id);
    const existingHasTarget = existingRoleIds.includes(role.id);
    const assignmentChanges =
      existingLegacyRoleIds.some((id) => id !== role.id) ||
      (!existingHasTarget && existingLegacyRoleIds.length === 0);
    if (!assignmentChanges) {
      return;
    }
    const admins = await this.db.query<{ user_id: string }>(
      `SELECT DISTINCT ur.user_id
       FROM athena.authorization_user_roles ur
       JOIN athena.authorization_roles r ON r.id = ur.role_id
       WHERE r.key = $1`,
      [PLATFORM_ADMIN_ROLE]
    );
    const currentAdminUserIds = admins.rows.map((row) => row.user_id);
    if (
      role.key === PLATFORM_ADMIN_ROLE ||
      currentAdminUserIds.includes(input.userId)
    ) {
      assertNotLastPlatformAdmin({
        currentAdminUserIds,
        nextHasAdmin: role.key === PLATFORM_ADMIN_ROLE,
        targetUserId: input.userId,
      });
    }
    const removedIds = existingLegacyRoleIds.filter((id) => id !== role.id);
    if (removedIds.length > 0) {
      await this.db.query(
        `DELETE FROM athena.authorization_user_roles
         WHERE user_id = $1 AND role_id = ANY($2::text[])`,
        [input.userId, removedIds]
      );
    }
    if (!existingHasTarget) {
      await this.db.query(
        `INSERT INTO athena.authorization_user_roles (user_id, role_id, assigned_by)
         VALUES ($1, $2, $3)`,
        [input.userId, role.id, input.assignedBy ?? null]
      );
    }
    await this.bumpRevision(null);
    await this.writeAudit({
      action: "user.legacy_role.replace",
      actorUserId: input.assignedBy,
      after: { roleKey },
      before: { roleKeys: current.rows.map((row) => row.key) },
      targetId: input.userId,
      targetKind: "user",
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
    if (!this.db.inTransaction) {
      return this.db.transaction((tx) =>
        new PostgresAuthorizationStore(tx).replaceOrganizationBaseRole(input)
      );
    }
    const roleKey = mapLegacyMemberRole(input.role);
    const roleResult = await this.db.query<RoleRow>(
      `SELECT * FROM athena.authorization_roles
       WHERE key = $1 AND scope_kind = 'organization'
         AND protected = TRUE AND (organization_id IS NULL OR organization_id = $2)
       ORDER BY CASE WHEN organization_id IS NOT NULL THEN 0 ELSE 1 END
       LIMIT 1`,
      [roleKey, input.organizationId]
    );
    const roleRow = roleResult.rows[0];
    if (!roleRow) {
      throw AthenaAuthRuntimeError.badRequest("Unknown organization base role");
    }
    const role = mapRoleRow(roleRow);
    const member = await this.db.query<{ role: string }>(
      `SELECT role FROM athena.member
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [input.memberId, input.organizationId]
    );
    if (!member.rows[0]) {
      throw AthenaAuthRuntimeError.notFound("Member not found");
    }
    const current = await this.db.query<{ key: string; role_id: string }>(
      `SELECT r.key, mr.role_id
       FROM athena.authorization_member_roles mr
       JOIN athena.authorization_roles r ON r.id = mr.role_id
       WHERE mr.member_id = $1
       FOR UPDATE OF mr`,
      [input.memberId]
    );
    const currentRoleIds = current.rows.map((row) => row.role_id);
    const baseRoleIds = current.rows
      .filter((row) => ORGANIZATION_BASE_ROLE_KEYS.has(row.key))
      .map((row) => row.role_id);
    const nextRoleIds = [
      ...currentRoleIds.filter((id) => !baseRoleIds.includes(id)),
      role.id,
    ];
    const nextRoles: AthenaAuthorizationRoleRecord[] = [];
    for (const id of nextRoleIds) {
      nextRoles.push(await this.requireScopedRole(id, input.organizationId));
    }
    assertOrganizationAssignmentRoles({
      foundingOwnerUserId: input.foundingOwnerUserId,
      memberUserId: input.memberUserId,
      organizationId: input.organizationId,
      roles: nextRoles,
    });
    await this.db.query(
      "UPDATE athena.member SET role = $1 WHERE id = $2",
      [compatibilityMemberRole(role.key), input.memberId]
    );
    const unchanged =
      currentRoleIds.length === nextRoleIds.length &&
      currentRoleIds.every((id) => nextRoleIds.includes(id));
    if (unchanged) {
      return;
    }
    const removedIds = baseRoleIds.filter((id) => id !== role.id);
    if (removedIds.length > 0) {
      await this.db.query(
        `DELETE FROM athena.authorization_member_roles
         WHERE member_id = $1 AND role_id = ANY($2::text[])`,
        [input.memberId, removedIds]
      );
    }
    if (!currentRoleIds.includes(role.id)) {
      await this.db.query(
        `INSERT INTO athena.authorization_member_roles (member_id, role_id, assigned_by)
         VALUES ($1, $2, $3)`,
        [input.memberId, role.id, input.assignedBy ?? null]
      );
    }
    await this.bumpRevision(input.organizationId);
    await this.writeAudit({
      action: "member.legacy_role.replace",
      actorUserId: input.assignedBy,
      after: { roleKey },
      before: { roleKeys: current.rows.map((row) => row.key) },
      organizationId: input.organizationId,
      targetId: input.memberId,
      targetKind: "member",
    });
  }

  async lookupAssignableOrganizationRole(
    organizationId: string,
    roleRef: string
  ): Promise<AthenaAuthorizationRoleRecord | undefined> {
    const mapped = resolveMemberAssignmentRole(roleRef);
    const result = await this.db.query<RoleRow>(
      `SELECT * FROM athena.authorization_roles
			 WHERE scope_kind = 'organization'
			   AND assignable = TRUE
			   AND (
			     id = $2
			     OR key = $2
			     OR key = $3
			     OR ($2 IN ('owner', 'organization_owner') AND key = 'organization_owner')
			     OR ($2 IN ('admin', 'organization_admin') AND key = 'organization_admin')
			     OR ($2 IN ('member', 'organization_member') AND key = 'organization_member')
			   )
			   AND (organization_id IS NULL OR organization_id = $1)
			 ORDER BY CASE WHEN organization_id IS NOT NULL THEN 0 ELSE 1 END
			 LIMIT 1`,
      [organizationId, roleRef, mapped]
    );
    const row = result.rows[0];
    if (!row) {
      return;
    }
    return mapRoleRow(row);
  }

  async readUserRoleAssignmentsSnapshot(input?: {
    userIds?: readonly string[];
  }): Promise<PlatformUserAssignmentSnapshot> {
    const filterIds = input?.userIds;
    const result = await this.db.query<{
      revision: string | null;
      role_id: string | null;
      user_id: string | null;
    }>(
      filterIds && filterIds.length > 0
        ? `WITH rev AS (
						SELECT (
							SELECT revision FROM athena.authorization_revisions
							WHERE scope_kind = 'platform' AND organization_id IS NULL
						) AS revision
					),
					wanted AS (
						SELECT UNNEST($1::text[]) AS user_id
					)
					SELECT rev.revision::text AS revision, wanted.user_id, ur.role_id
					FROM rev
					CROSS JOIN wanted
					LEFT JOIN athena.authorization_user_roles ur
						ON ur.user_id = wanted.user_id`
        : `WITH rev AS (
						SELECT (
							SELECT revision FROM athena.authorization_revisions
							WHERE scope_kind = 'platform' AND organization_id IS NULL
						) AS revision
					)
					SELECT rev.revision::text AS revision, ur.user_id, ur.role_id
					FROM rev
					LEFT JOIN athena.authorization_user_roles ur ON TRUE`,
      filterIds && filterIds.length > 0 ? [filterIds] : []
    );
    const rawRevision = result.rows[0]?.revision;
    if (rawRevision == null) {
      throwAuthorizationRevisionMissing();
    }
    const revision = asPlatformAssignmentRevision(Number(rawRevision));
    const rows = result.rows.flatMap((row) =>
      row.user_id && row.role_id
        ? [{ roleId: row.role_id, userId: row.user_id }]
        : []
    );
    return {
      assignments: groupPlatformUserAssignments(rows, filterIds),
      authorityVersion: createAuthorizationAuthorityVersion(revision),
      revision,
    };
  }

  async listUserRoleAssignments(input?: {
    userIds?: readonly string[];
  }): Promise<readonly PlatformUserRoleAssignment[]> {
    return (await this.readUserRoleAssignmentsSnapshot(input)).assignments;
  }

  async readMemberRoleAssignmentsSnapshot(input: {
    organizationId: string;
  }): Promise<OrganizationMemberAssignmentSnapshot> {
    const result = await this.db.query<{
      member_id: string | null;
      revision: string | null;
      role_id: string | null;
      user_id: string | null;
    }>(
      `WITH rev AS (
					SELECT (
						SELECT revision FROM athena.authorization_revisions
						WHERE organization_id = $1
					) AS revision
				)
				SELECT rev.revision::text AS revision, mr.member_id, mr.role_id, m.user_id
				FROM rev
				LEFT JOIN athena.member m ON m.organization_id = $1
				LEFT JOIN athena.authorization_member_roles mr ON mr.member_id = m.id`,
      [input.organizationId]
    );
    const rawRevision = result.rows[0]?.revision;
    if (rawRevision == null) {
      throwAuthorizationRevisionMissing();
    }
    const revision = asOrganizationAssignmentRevision(Number(rawRevision));
    const rows = result.rows.flatMap((row) =>
      row.member_id && row.role_id && row.user_id
        ? [
            {
              memberId: row.member_id,
              roleId: row.role_id,
              userId: row.user_id,
            },
          ]
        : []
    );
    return {
      assignments: groupOrganizationMemberAssignments(rows),
      authorityVersion: createAuthorizationAuthorityVersion(revision),
      organizationId: input.organizationId,
      revision,
    };
  }

  async recordMemberRemoval(input: {
    memberId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    await this.bumpRevision(input.organizationId);
    await this.writeAudit({
      action: "member.delete",
      organizationId: input.organizationId,
      targetId: input.memberId,
      targetKind: "member",
      after: { userId: input.userId },
    });
  }

  async assertUserDeletionAllowed(input: { userId: string }): Promise<void> {
    if (!this.db.inTransaction) {
      return this.db.transaction((tx) =>
        new PostgresAuthorizationStore(tx).assertUserDeletionAllowed(input)
      );
    }
    await this.db.query<{ user_id: string; role_id: string }>(
      `SELECT ur.user_id, ur.role_id
       FROM athena.authorization_user_roles ur
       JOIN athena.authorization_roles r ON r.id = ur.role_id
       WHERE r.key = $1
       ORDER BY ur.user_id, ur.role_id
       FOR UPDATE OF ur`,
      [PLATFORM_ADMIN_ROLE]
    );
    const revision = await this.db.query<{ revision: string }>(
      `SELECT revision::text AS revision
       FROM athena.authorization_revisions
       WHERE scope_kind = 'platform' AND organization_id IS NULL
       FOR UPDATE`
    );
    if (revision.rows[0]?.revision == null) {
      throwAuthorizationRevisionMissing();
    }
    const admins = await this.db.query<{ user_id: string }>(
      `SELECT ur.user_id
       FROM athena.authorization_user_roles ur
       JOIN athena.authorization_roles r ON r.id = ur.role_id
       WHERE r.key = $1
       ORDER BY ur.user_id`,
      [PLATFORM_ADMIN_ROLE]
    );
    const currentAdminUserIds = admins.rows.map((row) => row.user_id);
    if (currentAdminUserIds.includes(input.userId)) {
      assertNotLastPlatformAdmin({
        currentAdminUserIds,
        nextHasAdmin: false,
        targetUserId: input.userId,
      });
    }
  }

  async recordUserDeletion(input: {
    memberships: readonly { memberId: string; organizationId: string }[];
    userId: string;
  }): Promise<void> {
    await this.bumpRevision(null);
    for (const organizationId of new Set(
      input.memberships.map((membership) => membership.organizationId)
    )) {
      await this.bumpRevision(organizationId);
    }
    await this.writeAudit({
      action: "user.delete",
      targetId: input.userId,
      targetKind: "user",
    });
  }

	async listMemberRoleAssignments(input: {
		organizationId: string;
	}): Promise<readonly OrganizationMemberRoleAssignment[]> {
		return (await this.readMemberRoleAssignmentsSnapshot(input)).assignments;
	}

	async readAuthoritySnapshot(input: {
		scope: AthenaAuthorizationSnapshotScope;
	}): Promise<AthenaAuthorizationSnapshotIr> {
		await this.ensureCatalog();
		return this.db.transaction(async (tx) => {
			await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
			const captured = await tx.query<{ captured_at: Date | string }>(
				"SELECT transaction_timestamp() AS captured_at"
			);
			const capturedAt = captured.rows[0]?.captured_at;
			if (capturedAt == null) {
				throw new Error("Authorization snapshot transaction timestamp is unavailable");
			}
			const catalogState = await this.readCatalogState(tx);
			if (catalogState == null || !catalogStateIsCurrent(catalogState)) {
				throw new Error("Authorization catalog changed during snapshot capture");
			}
			const revisionResult =
				input.scope.kind === "platform"
					? await tx.query<{ revision: string | null }>(
							`SELECT revision::text AS revision
							 FROM athena.authorization_revisions
							 WHERE scope_kind = 'platform' AND organization_id IS NULL`
						)
					: await tx.query<{ revision: string | null }>(
							`SELECT revision::text AS revision
							 FROM athena.authorization_revisions
							 WHERE scope_kind = 'organization' AND organization_id = $1`,
							[input.scope.organizationId]
						);
			const rawRevision = revisionResult.rows[0]?.revision;
			if (rawRevision == null) {
				throwAuthorizationRevisionMissing();
			}
			const assignmentRevision = Number(rawRevision);
			if (!Number.isSafeInteger(assignmentRevision) || assignmentRevision < 1) {
				throw new Error("Authorization assignment revision is invalid");
			}

			const roleResult =
				input.scope.kind === "platform"
					? await tx.query<RoleRow>(
							`SELECT * FROM athena.authorization_roles
							 WHERE scope_kind = 'platform' AND organization_id IS NULL`
						)
					: await tx.query<RoleRow>(
							`SELECT * FROM athena.authorization_roles
							 WHERE scope_kind = 'organization'
							   AND (organization_id IS NULL OR organization_id = $1)`,
							[input.scope.organizationId]
						);
			const roleIds = roleResult.rows.map((role) => role.id);
			const rightResult =
				roleIds.length === 0
					? { rowCount: 0, rows: [] }
					: await tx.query<{ role_id: string; right_key: string }>(
							`SELECT role_id, right_key FROM athena.authorization_role_rights
							 WHERE role_id = ANY($1::text[]) ORDER BY role_id, right_key`,
							[roleIds]
						);
			const rightsByRole = new Map<string, string[]>();
			for (const row of rightResult.rows) {
				const entries = rightsByRole.get(row.role_id) ?? [];
				entries.push(row.right_key);
				rightsByRole.set(row.role_id, entries);
			}
			const rights = getAthenaAuthorizationRightsIr();
			const rightsAuthority = createAthenaRightsAuthority(rights);
			const roles = roleResult.rows.map((row) =>
				hydrateAthenaRoleDefinition(
					{ record: mapRoleRow(row), rights: rightsByRole.get(row.id) ?? [] },
					rightsAuthority
				)
			);

			type AssignmentRow = {
				assigned_by: string | null;
				created_at: Date | string;
				member_id?: string;
				role_id: string;
				source_id?: string | null;
				source_kind?: string | null;
				user_id: string;
			};
			const assignmentResult =
				input.scope.kind === "platform"
					? await tx.query<AssignmentRow>(
							`SELECT user_id, role_id, assigned_by, created_at
							 FROM athena.authorization_user_roles ORDER BY user_id, role_id`
						)
					: await tx.query<AssignmentRow>(
							`SELECT mr.member_id, mr.role_id, mr.assigned_by, mr.created_at,
							        mr.source_kind, mr.source_id, m.user_id
							 FROM athena.authorization_member_roles mr
							 JOIN athena.member m ON m.id = mr.member_id
							 WHERE m.organization_id = $1
							 ORDER BY mr.member_id, mr.role_id`,
							[input.scope.organizationId]
						);
			const assignments: AthenaAuthorizationSnapshotIr["assignments"][number][] =
				assignmentResult.rows.map((row) => {
					let subject: AthenaAuthorizationSnapshotIr["assignments"][number]["subject"];
					if (input.scope.kind === "platform") {
						subject = { kind: "user", userId: row.user_id };
					} else {
						if (row.member_id == null) {
							throw new Error(
								"Organization assignment member identity is unavailable"
							);
						}
						subject = {
							kind: "member",
						memberId: row.member_id,
						userId: row.user_id,
						};
					}
					const subjectId = subject.kind === "user" ? subject.userId : subject.memberId;
					const sourceId = row.source_id ?? null;
					const sourceKind = row.source_kind ?? null;
					if (
						(sourceId == null) !== (sourceKind == null) ||
						(sourceKind != null &&
							(sourceKind !== "identity_connection" || sourceId?.trim().length === 0))
					) {
						throw new Error("ATHENA_AUTHORIZATION_INVENTORY_PROVENANCE_INVALID");
					}
					const provenance = {
						assignedAt: new Date(row.created_at).toISOString(),
						assignedBy: row.assigned_by,
						...(sourceId != null && sourceKind != null
							? { sourceId, sourceKind: "identity_connection" as const }
							: {}),
					};
					const roleId = row.role_id as AthenaAuthorizationSnapshotIr["assignments"][number]["roleId"];
					return {
						id: canonicalGrantId({
							organizationId: input.scope.kind === "organization" ? input.scope.organizationId : null,
							roleId,
						scopeKind: input.scope.kind,
							subjectId,
						subjectKind: subject.kind,
						}),
						provenance,
						roleId,
						subject,
					};
				});
			return canonicalizeAthenaAuthorizationSnapshotIr({
				assignments,
				irVersion: 1,
				kind: "athena.authorization.snapshot",
				metadata: {
					assignmentRevision,
					capturedAt: new Date(capturedAt).toISOString(),
					catalogVersion: catalogState.catalogVersion,
					rightsFingerprint: catalogState.rightsFingerprint,
					rolesFingerprint: catalogState.rolesFingerprint,
					provenance: ["authorization-store"],
				},
				rights,
				roles: canonicalizeAthenaRolesIr(
					{ irVersion: 1, kind: "athena.roles", metadata: {}, roles },
					rightsAuthority
				),
				scope: input.scope,
			});
		});
	}

  async listAccessGrants(): Promise<readonly AthenaAccessGrant[]> {
    await this.ensureCatalog();
    const result = await this.db.query<{
      assigned_at: Date | string;
      assigned_by: string | null;
      assignment_revision: string | null;
      member_id: string | null;
      organization_id: string | null;
      right_key: string | null;
      role_id: string;
      role_key: string;
      scope_kind: "organization" | "platform";
      source_id: string | null;
      source_kind: string | null;
      user_id: string;
    }>(
      `SELECT a.scope_kind, a.organization_id, a.member_id, a.user_id,
              a.role_id, a.role_key, a.assigned_by, a.assigned_at,
              a.source_kind, a.source_id,
              revisions.revision::text AS assignment_revision,
              role_rights.right_key
       FROM (
         SELECT 'platform'::text AS scope_kind, NULL::text AS organization_id,
                NULL::text AS member_id, ur.user_id, ur.role_id, r.key AS role_key,
                ur.assigned_by, ur.created_at AS assigned_at,
                NULL::text AS source_kind, NULL::text AS source_id
         FROM athena.authorization_user_roles ur
         JOIN athena.authorization_roles r ON r.id = ur.role_id
         UNION ALL
         SELECT 'organization'::text AS scope_kind, m.organization_id,
                mr.member_id, m.user_id, mr.role_id, r.key AS role_key,
                mr.assigned_by, mr.created_at AS assigned_at,
                mr.source_kind, mr.source_id
         FROM athena.authorization_member_roles mr
         JOIN athena.member m ON m.id = mr.member_id
         JOIN athena.authorization_roles r ON r.id = mr.role_id
       ) AS a
       LEFT JOIN athena.authorization_revisions revisions
         ON revisions.scope_kind = a.scope_kind
        AND revisions.organization_id IS NOT DISTINCT FROM a.organization_id
       LEFT JOIN athena.authorization_role_rights role_rights
         ON role_rights.role_id = a.role_id
       ORDER BY a.scope_kind, a.organization_id, a.user_id,
                a.member_id, a.role_id, role_rights.right_key`
    );
    const grouped = new Map<
      string,
      {
        assignmentRevision: number;
        record: Omit<AthenaAccessGrantRecord, "authorityVersion" | "rightKeys">;
        rightKeys: Set<string>;
      }
    >();

    for (const row of result.rows) {
      const revision = Number(row.assignment_revision);
      if (
        row.assignment_revision == null ||
        !Number.isSafeInteger(revision) ||
        revision < 1
      ) {
        throwAuthorizationRevisionMissing();
      }
      if (row.scope_kind !== "organization" && row.scope_kind !== "platform") {
        throw new Error("ATHENA_AUTHORIZATION_INVENTORY_IDENTITY_INVALID");
      }
      const isOrganization = row.scope_kind === "organization";
      if (
        !row.user_id ||
        !row.role_id ||
        !row.role_key ||
        (isOrganization && (!row.member_id || !row.organization_id))
      ) {
        throw new Error("ATHENA_AUTHORIZATION_INVENTORY_IDENTITY_INVALID");
      }
      const identity = {
        organizationId: row.organization_id,
        roleId: row.role_id,
        scopeKind: row.scope_kind,
        subjectId: isOrganization ? (row.member_id as string) : row.user_id,
        subjectKind: isOrganization ? ("member" as const) : ("user" as const),
      };
      const id = canonicalGrantId(identity);
      const assignedAt =
        row.assigned_at instanceof Date
          ? row.assigned_at.toISOString()
          : new Date(row.assigned_at).toISOString();
      let groupedGrant = grouped.get(id);
      if (!groupedGrant) {
        const record: Omit<
          AthenaAccessGrantRecord,
          "authorityVersion" | "rightKeys"
        > = {
          assignedAt,
          assignedBy: row.assigned_by,
          memberId: row.member_id,
          organizationId: row.organization_id,
          roleId: row.role_id,
          roleKey: row.role_key,
          scopeKind: row.scope_kind,
          sourceId: row.source_id,
          sourceKind: row.source_kind,
          userId: row.user_id,
        };
        groupedGrant = {
          assignmentRevision: revision,
          record,
          rightKeys: new Set(),
        };
        grouped.set(id, groupedGrant);
      } else if (
        groupedGrant.record.memberId !== row.member_id ||
        groupedGrant.record.organizationId !== row.organization_id ||
        groupedGrant.record.roleId !== row.role_id ||
        groupedGrant.record.roleKey !== row.role_key ||
        groupedGrant.record.scopeKind !== row.scope_kind ||
        groupedGrant.record.userId !== row.user_id ||
        groupedGrant.record.assignedAt !== assignedAt ||
        groupedGrant.record.assignedBy !== row.assigned_by ||
        groupedGrant.assignmentRevision !== revision ||
        groupedGrant.record.sourceId !== row.source_id ||
        groupedGrant.record.sourceKind !== row.source_kind
      ) {
        throw new Error("ATHENA_AUTHORIZATION_INVENTORY_ROW_INCONSISTENT");
      }
      if (row.right_key != null) {
        groupedGrant.rightKeys.add(row.right_key);
      }
    }

    const records = [...grouped.values()].map(
      ({ assignmentRevision, record, rightKeys }) => ({
        assignmentRevision,
        record: { ...record, rightKeys: [...rightKeys] },
      })
    );
    return projectAthenaAccessGrants(records);
  }

  async replaceUserRoleAssignments(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    roleIds: readonly string[];
    userId: string;
  }): Promise<{ revision: number }> {
    return this.db.transaction(async (tx) => {
      const nested = new PostgresAuthorizationStore(tx);
      return nested.replaceUserRoleAssignmentsInTransaction(input);
    });
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
    return this.db.transaction(async (tx) => {
      const nested = new PostgresAuthorizationStore(tx);
      return nested.replaceMemberRoleAssignmentsInTransaction(input);
    });
  }

  async cloneRole(input: {
    actorRights: readonly string[];
    actorUserId: string;
    name: string;
    organizationId?: string | null;
    sourceRoleId: string;
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
    return this.db.transaction(async (tx) => {
      const nested = new PostgresAuthorizationStore(tx);
      return nested.cloneRoleInTransaction(input);
    });
  }

  private async cloneRoleInTransaction(input: {
    actorRights: readonly string[];
    actorUserId: string;
    name: string;
    organizationId?: string | null;
    sourceRoleId: string;
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
    const id = crypto.randomUUID();
    const source = await this.db.query<RoleRow>(
      "SELECT * FROM athena.authorization_roles WHERE id = $1",
      [input.sourceRoleId]
    );
    const row = source.rows[0];
    if (!row) {
      throw AthenaAuthRuntimeError.badRequest("Source role not found");
    }
    const organizationId = input.organizationId ?? row.organization_id;
    assertCloneRoleTenantBoundary({
      sourceOrganizationId: row.organization_id,
      sourceScopeKind: row.scope_kind,
      targetOrganizationId: organizationId,
    });
    const sourceRights = await this.listRoleRights(input.sourceRoleId);
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights: sourceRights,
      beforeRights: [],
      organizationId,
      roleScope: row.scope_kind,
      unrestrictedGrant: input.unrestrictedGrant,
    });
    const key = `custom_${id.slice(0, 8)}`;
    const name = input.name.trim() || `${row.name} copy`;
    await this.db.query(
      `INSERT INTO athena.authorization_roles (
				id, key, name, scope_kind, organization_id, system_kind,
				protected, assignable, version
			) VALUES ($1, $2, $3, $4, $5, NULL, FALSE, TRUE, 1)`,
      [id, key, name, row.scope_kind, organizationId]
    );
    await this.db.query(
      `INSERT INTO athena.authorization_role_rights (role_id, right_key)
			 SELECT $1, right_key FROM athena.authorization_role_rights WHERE role_id = $2`,
      [id, input.sourceRoleId]
    );
    await this.bumpRevision(organizationId);
    const clonedRights = await this.listRoleRights(id);
    await this.writeAudit({
      action: "role.clone",
      actorUserId: input.actorUserId,
      after: { rights: [...clonedRights] },
      organizationId,
      targetId: id,
      targetKind: "role",
    });
    return {
      assignable: true,
      id,
      key,
      name,
      organizationId,
      protected: false,
      scopeKind: row.scope_kind,
      systemKind: null,
      version: 1,
    };
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
    return this.db.transaction(async (tx) => {
      const nested = new PostgresAuthorizationStore(tx);
      return nested.createRoleInTransaction(input);
    });
  }

  async getRole(
    id: string,
    organizationId?: string | null
  ): Promise<AthenaAuthorizationRoleDetail | undefined> {
    const role = await this.loadScopedRole(id, organizationId);
    if (!role) {
      return;
    }
    const rights = await this.listRoleRights(role.id);
    return toRoleDetail(role, rights, await this.countAssignments(role));
  }

  async listRoles(input: {
    organizationId?: string | null;
    scopeKind: "platform" | "organization";
  }): Promise<readonly RoleDescriptor[]> {
    const result = input.organizationId
      ? await this.db.query<
          RoleRow & { assignment_count: string; right_count: string }
        >(
          `SELECT r.*,
					        (SELECT COUNT(*)::text FROM athena.authorization_member_roles mr WHERE mr.role_id = r.id) AS assignment_count,
					        (SELECT COUNT(*)::text FROM athena.authorization_role_rights rr WHERE rr.role_id = r.id) AS right_count
					 FROM athena.authorization_roles r
					 WHERE r.scope_kind = 'organization'
					   AND (r.organization_id IS NULL OR r.organization_id = $1)
					 ORDER BY r.protected DESC, r.key`,
          [input.organizationId]
        )
      : await this.db.query<
          RoleRow & { assignment_count: string; right_count: string }
        >(
          `SELECT r.*,
					        (SELECT COUNT(*)::text FROM athena.authorization_user_roles ur WHERE ur.role_id = r.id) AS assignment_count,
					        (SELECT COUNT(*)::text FROM athena.authorization_role_rights rr WHERE rr.role_id = r.id) AS right_count
					 FROM athena.authorization_roles r
					 WHERE r.scope_kind = 'platform' AND r.organization_id IS NULL
					 ORDER BY r.protected DESC, r.key`
        );
    return result.rows
      .filter((row) => row.scope_kind === input.scopeKind)
      .map((row) =>
        toRoleDescriptor(mapRoleRow(row), {
          assignmentCount: Number(row.assignment_count),
          rightCount: Number(row.right_count),
        })
      );
  }

  async listRoleRights(roleId: string): Promise<readonly AthenaRightKey[]> {
    const result = await this.db.query<{ right_key: string }>(
      `SELECT right_key FROM athena.authorization_role_rights
			 WHERE role_id = $1 ORDER BY right_key`,
      [roleId]
    );
    return result.rows.map((row) => parseAthenaRightKey(row.right_key));
  }

  async updateRole(input: {
    actorUserId: string;
    expectedVersion: number;
    id: string;
    name: string;
    organizationId?: string | null;
    rights?: readonly string[];
    actorRights?: readonly string[];
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
    return this.db.transaction(async (tx) => {
      const nested = new PostgresAuthorizationStore(tx);
      if (input.rights) {
        return nested.replaceRoleDefinitionInTransaction({
          actorRights: input.actorRights ?? [],
          actorUserId: input.actorUserId,
          expectedVersion: input.expectedVersion,
          id: input.id,
          name: input.name,
          organizationId: input.organizationId,
          rights: input.rights,
          unrestrictedGrant: input.unrestrictedGrant,
        });
      }
      return nested.updateRoleInTransaction(input);
    });
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
    return this.db.transaction(async (tx) => {
      const nested = new PostgresAuthorizationStore(tx);
      return nested.replaceRoleRightsInTransaction(input);
    });
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
    return this.db.transaction(async (tx) => {
      const nested = new PostgresAuthorizationStore(tx);
      return nested.deleteRoleInTransaction(input);
    });
  }

  private async createRoleInTransaction(input: {
    actorRights: readonly string[];
    actorUserId: string;
    name: string;
    organizationId?: string | null;
    rights?: readonly string[];
    scopeKind: "platform" | "organization";
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
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
    const key = `custom_${id.slice(0, 8)}`;
    const organizationId =
      input.scopeKind === "organization"
        ? (input.organizationId ?? null)
        : null;
    await this.db.query(
      `INSERT INTO athena.authorization_roles (
				id, key, name, scope_kind, organization_id, system_kind,
				protected, assignable, version
			) VALUES ($1, $2, $3, $4, $5, NULL, FALSE, TRUE, 1)`,
      [id, key, name, input.scopeKind, organizationId]
    );
    await this.replaceMapping(id, rights);
    await this.bumpRevision(organizationId);
    await this.writeAudit({
      action: "role.create",
      actorUserId: input.actorUserId,
      after: { rights: [...rights].sort() },
      organizationId,
      targetId: id,
      targetKind: "role",
    });
    return {
      assignable: true,
      id,
      key,
      name,
      organizationId,
      protected: false,
      scopeKind: input.scopeKind,
      systemKind: null,
      version: 1,
    };
  }

  private async updateRoleInTransaction(input: {
    actorUserId: string;
    expectedVersion: number;
    id: string;
    name: string;
    organizationId?: string | null;
  }): Promise<AthenaAuthorizationRoleRecord> {
    const role = await this.requireScopedRole(input.id, input.organizationId);
    assertProtectedRoleImmutable(role);
    const name = input.name.trim();
    if (!name) {
      throw AthenaAuthRuntimeError.badRequest("name is required");
    }
    const updated = await this.bumpRoleVersion(role.id, input.expectedVersion);
    await this.db.query(
      "UPDATE athena.authorization_roles SET name = $1, updated_at = NOW() WHERE id = $2",
      [name, role.id]
    );
    await this.bumpRevision(role.organizationId);
    await this.writeAudit({
      action: "role.rename",
      actorUserId: input.actorUserId,
      after: { name },
      before: { name: role.name },
      organizationId: role.organizationId,
      targetId: role.id,
      targetKind: "role",
    });
    return { ...updated, name };
  }

  private async replaceRoleDefinitionInTransaction(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    id: string;
    name: string;
    organizationId?: string | null;
    rights: readonly string[];
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
    const role = await this.requireScopedRole(input.id, input.organizationId);
    assertProtectedRoleImmutable(role);
    const name = input.name.trim();
    if (!name) {
      throw AthenaAuthRuntimeError.badRequest("name is required");
    }
    const beforeRights = [...(await this.listRoleRights(role.id))].sort();
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights: input.rights,
      beforeRights,
      organizationId: role.organizationId,
      roleScope: role.scopeKind,
      unrestrictedGrant: input.unrestrictedGrant,
    });
    const after = [...new Set(input.rights)].sort();
    const updated = await this.bumpRoleVersion(role.id, input.expectedVersion);
    await this.db.query(
      "UPDATE athena.authorization_roles SET name = $1, updated_at = NOW() WHERE id = $2",
      [name, role.id]
    );
    await this.replaceMapping(role.id, after);
    await this.bumpRevision(role.organizationId);
    await this.writeAudit({
      action: "role.definition.update",
      actorUserId: input.actorUserId,
      after: { name, rights: after },
      before: { name: role.name, rights: beforeRights },
      organizationId: role.organizationId,
      targetId: role.id,
      targetKind: "role",
    });
    return { ...updated, name };
  }

  private async replaceRoleRightsInTransaction(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    id: string;
    organizationId?: string | null;
    rights: readonly string[];
    unrestrictedGrant?: boolean;
  }): Promise<AthenaAuthorizationRoleRecord> {
    const role = await this.requireScopedRole(input.id, input.organizationId);
    assertProtectedRoleImmutable(role);
    const before = [...(await this.listRoleRights(role.id))].sort();
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights: input.rights,
      beforeRights: before,
      organizationId: role.organizationId,
      roleScope: role.scopeKind,
      unrestrictedGrant: input.unrestrictedGrant,
    });
    const after = [...new Set(input.rights)].sort();
    const updated = await this.bumpRoleVersion(role.id, input.expectedVersion);
    await this.replaceMapping(role.id, after);
    await this.bumpRevision(role.organizationId);
    await this.writeAudit({
      action: "role.rights.replace",
      actorUserId: input.actorUserId,
      after: { rights: after },
      before: { rights: before },
      organizationId: role.organizationId,
      targetId: role.id,
      targetKind: "role",
    });
    return updated;
  }

  private async deleteRoleInTransaction(input: {
    actorUserId: string;
    expectedVersion: number;
    id: string;
    organizationId?: string | null;
    reassignmentRoleId?: string | null;
  }): Promise<{
    reassignedMemberIds: readonly string[];
    reassignedUserIds: readonly string[];
  }> {
    const role = await this.requireScopedRole(input.id, input.organizationId);
    assertProtectedRoleImmutable(role);
    await this.bumpRoleVersion(role.id, input.expectedVersion);
    const assigned = await this.countAssignments(role);
    const reassignedMemberIds: string[] = [];
    const reassignedUserIds: string[] = [];
    if (assigned > 0) {
      const replacementId = input.reassignmentRoleId?.trim() ?? "";
      if (!replacementId) {
        throwRoleHasAssignments();
      }
      const replacement = await this.requireScopedRole(
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
        const removed = await this.db.query<{ member_id: string }>(
          `DELETE FROM athena.authorization_member_roles
           WHERE role_id = $1
           RETURNING member_id`,
          [role.id]
        );
        for (const row of removed.rows) {
          reassignedMemberIds.push(row.member_id);
          await this.db.query(
            `INSERT INTO athena.authorization_member_roles
             (member_id, role_id, assigned_by, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (member_id, role_id) DO NOTHING`,
            [row.member_id, replacement.id, input.actorUserId]
          );
        }
      } else {
        const removed = await this.db.query<{ user_id: string }>(
          `DELETE FROM athena.authorization_user_roles
           WHERE role_id = $1
           RETURNING user_id`,
          [role.id]
        );
        for (const row of removed.rows) {
          reassignedUserIds.push(row.user_id);
          await this.db.query(
            `INSERT INTO athena.authorization_user_roles
             (user_id, role_id, assigned_by, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (user_id, role_id) DO NOTHING`,
            [row.user_id, replacement.id, input.actorUserId]
          );
        }
      }
    }
    const before = [...(await this.listRoleRights(role.id))].sort();
    await this.db.query(
      "DELETE FROM athena.authorization_roles WHERE id = $1",
      [role.id]
    );
    await this.bumpRevision(role.organizationId);
    await this.writeAudit({
      action: "role.delete",
      actorUserId: input.actorUserId,
      before: { rights: before },
      organizationId: role.organizationId,
      targetId: role.id,
      targetKind: "role",
    });
    return { reassignedMemberIds, reassignedUserIds };
  }

  async inspectGraph(): Promise<AthenaAuthorizationInspectGraph> {
    const roleResult = await this.db.query<
      RoleRow & { assignment_count: string; right_count: string }
    >(
      `SELECT r.*,
			        CASE
			          WHEN r.scope_kind = 'organization'
			          THEN (SELECT COUNT(*)::text FROM athena.authorization_member_roles mr WHERE mr.role_id = r.id)
			          ELSE (SELECT COUNT(*)::text FROM athena.authorization_user_roles ur WHERE ur.role_id = r.id)
			        END AS assignment_count,
			        (SELECT COUNT(*)::text FROM athena.authorization_role_rights rr WHERE rr.role_id = r.id) AS right_count
			 FROM athena.authorization_roles r
			 ORDER BY r.scope_kind, r.protected DESC, r.key`
    );
    const rightResult = await this.db.query<{
      right_key: string;
      role_id: string;
    }>(
      "SELECT role_id, right_key FROM athena.authorization_role_rights ORDER BY role_id, right_key"
    );
    const rightsByRole = new Map<string, AthenaRightKey[]>();
    for (const row of rightResult.rows) {
      const bucket = rightsByRole.get(row.role_id) ?? [];
      bucket.push(parseAthenaRightKey(row.right_key));
      rightsByRole.set(row.role_id, bucket);
    }
    const roles = roleResult.rows.map((row) => {
      const record = mapRoleRow(row);
      const rights = rightsByRole.get(record.id) ?? [];
      return {
        ...record,
        assignmentCount: Number(row.assignment_count),
        rightCount: Number(row.right_count),
        rights,
      };
    });
    const userAssignments = await this.db.query<{
      role_id: string;
      role_key: string;
      user_id: string;
    }>(
      `SELECT ur.user_id, ur.role_id, r.key AS role_key
			 FROM athena.authorization_user_roles ur
			 JOIN athena.authorization_roles r ON r.id = ur.role_id`
    );
    const memberAssignments = await this.db.query<{
      member_id: string;
      organization_id: string | null;
      role_id: string;
      role_key: string;
      user_id: string;
    }>(
      `SELECT mr.member_id, mr.role_id, m.user_id, m.organization_id, r.key AS role_key
			 FROM athena.authorization_member_roles mr
			 JOIN athena.member m ON m.id = mr.member_id
			 JOIN athena.authorization_roles r ON r.id = mr.role_id`
    );
    const assignments = [
      ...userAssignments.rows.map((row) => ({
        memberId: null,
        organizationId: null,
        roleId: row.role_id,
        roleKey: row.role_key,
        scopeKind: "platform" as const,
        userId: row.user_id,
      })),
      ...memberAssignments.rows.map((row) => ({
        memberId: row.member_id,
        organizationId: row.organization_id,
        roleId: row.role_id,
        roleKey: row.role_key,
        scopeKind: "organization" as const,
        userId: row.user_id,
      })),
    ];
    const auditResult = await this.db.query<{
      action: string;
      actor_user_id: string | null;
      created_at: Date | string | null;
      organization_id: string | null;
      target_id: string | null;
      target_kind: string | null;
    }>(
      `SELECT action, actor_user_id, created_at, organization_id, target_id, target_kind
			 FROM athena.authorization_audit_log
			 ORDER BY created_at DESC
			 LIMIT 100`
    );
    const audit = auditResult.rows.map((row) => ({
      action: row.action,
      actorUserId: row.actor_user_id,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : typeof row.created_at === "string"
            ? row.created_at
            : null,
      organizationId: row.organization_id,
      targetId: row.target_id,
      targetKind: row.target_kind,
    }));
    const revisionResult = await this.db.query<{ revision: string }>(
      `SELECT COALESCE(MAX(revision), 1)::text AS revision
			 FROM athena.authorization_revisions`
    );
    const revision = Number(revisionResult.rows[0]?.revision ?? 1);
    return {
      assignments,
      audit,
      revision: Number.isFinite(revision) ? revision : 1,
      roles,
    };
  }

  async listAudit(input: {
    limit?: number;
    organizationId?: string | null;
  }): Promise<readonly Record<string, unknown>[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM athena.authorization_audit_log
			 WHERE (
			   ($1::text IS NULL AND organization_id IS NULL)
			   OR ($1::text IS NOT NULL AND organization_id = $1)
			 )
			 ORDER BY created_at DESC
			 LIMIT $2`,
      [input.organizationId ?? null, input.limit ?? 50]
    );
    return result.rows;
  }

  async resolveEffectiveRights(input: {
    activeOrganizationId?: string | null;
    getMember: (
      organizationId: string,
      userId: string
    ) => Promise<AuthMemberRow | undefined>;
    userId: string;
  }): Promise<readonly AthenaRightKey[]> {
    const platform = await this.db.query<{ right_key: string }>(
      `SELECT rr.right_key
			 FROM athena.authorization_user_roles ur
			 JOIN athena.authorization_role_rights rr ON rr.role_id = ur.role_id
			 WHERE ur.user_id = $1`,
      [input.userId]
    );
    const keys = new Set(platform.rows.map((row) => row.right_key));
    const organizationId = input.activeOrganizationId?.trim() ?? "";
    if (organizationId.length > 0) {
      const member = await input.getMember(organizationId, input.userId);
      if (member) {
        const org = await this.db.query<{ right_key: string }>(
          `SELECT rr.right_key
					 FROM athena.authorization_member_roles mr
					 JOIN athena.authorization_role_rights rr ON rr.role_id = mr.role_id
					 WHERE mr.member_id = $1`,
          [member.id]
        );
        for (const row of org.rows) {
          keys.add(row.right_key);
        }
      }
    }
    return [...keys]
      .sort()
      .map((key) => tryParseAthenaRightKey(key))
      .filter((key): key is AthenaRightKey => key !== undefined);
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
    void input.foundingOwnerUserId;
    void input.listMembers;
    const effectiveRights = await this.resolveEffectiveRights(input);
    const capabilities = capabilitiesFromRights(effectiveRights);
    const roleRows = await this.db.query<{
      key: string;
      name: string;
      scope_kind: "platform" | "organization";
    }>(
      `SELECT r.key, r.name, r.scope_kind
			 FROM athena.authorization_user_roles ur
			 JOIN athena.authorization_roles r ON r.id = ur.role_id
			 WHERE ur.user_id = $1
			 UNION ALL
			 SELECT r.key, r.name, r.scope_kind
			 FROM athena.member m
			 JOIN athena.authorization_member_roles mr ON mr.member_id = m.id
			 JOIN athena.authorization_roles r ON r.id = mr.role_id
			 WHERE m.user_id = $1 AND $2::text IS NOT NULL AND m.organization_id = $2`,
      [input.userId, input.activeOrganizationId ?? null]
    );
    const roles: AssignedRoleSummary[] = roleRows.rows.map((row) => ({
      displayName: row.name,
      key: row.key,
      scopeKind: row.scope_kind,
    }));
    const assignable = await this.db.query<{
      assignable: boolean;
      assignment_count: string;
      id: string;
      key: string;
      name: string;
      organization_id: string | null;
      protected: boolean;
      right_count: string;
      right_keys: string[];
      scope_kind: "platform" | "organization";
      system_kind: "owner" | "admin" | "member" | null;
      version: number;
    }>(
      `SELECT r.id, r.key, r.name, r.scope_kind, r.organization_id, r.protected, r.assignable, r.system_kind, r.version,
			        (
			          CASE
			            WHEN r.scope_kind = 'organization' THEN (
			              SELECT COUNT(*)::text
			              FROM athena.authorization_member_roles mr
			              JOIN athena.member m ON m.id = mr.member_id
			              WHERE mr.role_id = r.id
			                AND ($1::text IS NULL OR m.organization_id = $1)
			            )
			            ELSE (
			              SELECT COUNT(*)::text FROM athena.authorization_user_roles ur WHERE ur.role_id = r.id
			            )
			          END
			        ) AS assignment_count,
			        (
			          SELECT COUNT(*)::text FROM athena.authorization_role_rights rr WHERE rr.role_id = r.id
			        ) AS right_count,
			        (
			          SELECT COALESCE(
			            ARRAY_AGG(rr.right_key ORDER BY rr.right_key),
			            ARRAY[]::text[]
			          )
			          FROM athena.authorization_role_rights rr
			          WHERE rr.role_id = r.id
			        ) AS right_keys
			 FROM athena.authorization_roles r
			 WHERE r.assignable = TRUE
			   AND (r.organization_id IS NULL OR r.organization_id = $1)
			 ORDER BY r.scope_kind, r.key`,
      [input.activeOrganizationId ?? null]
    );
    const hydratedAssignableRoles = assignable.rows
      .map((row) => {
        const record = mapRoleRow(row);
        const rights = Array.isArray(row.right_keys)
          ? row.right_keys.filter((key) => typeof key === "string")
          : [];
        const definition = tryHydrateAthenaRoleDefinition({
          record,
          rights,
        });
        if (!definition) {
          return;
        }
        return projectAuthorizationSnapshotRole(definition, {
          activeOrganizationId: input.activeOrganizationId,
          assignmentCount: Number(row.assignment_count),
          version: row.version,
        });
      })
      .filter((role) => role !== undefined);
    const assignableRoles = projectAssignableRoles({
      activeOrganizationId: input.activeOrganizationId,
      capabilities,
      roles: hydratedAssignableRoles,
    });
    const organizationId = input.activeOrganizationId?.trim() ?? "";
    const revisionRow = await this.db.query<{ revision: string }>(
      organizationId.length > 0
        ? `SELECT revision::text AS revision FROM athena.authorization_revisions
				   WHERE scope_kind = 'organization' AND organization_id = $1`
        : `SELECT revision::text AS revision FROM athena.authorization_revisions
				   WHERE scope_kind = 'platform' AND organization_id IS NULL`,
      organizationId.length > 0 ? [organizationId] : []
    );
    return {
      ...(organizationId.length > 0
        ? { activeOrganizationId: organizationId }
        : {}),
      assignableRoles,
      capabilities,
      effectiveRights,
      revision: Number(revisionRow.rows[0]?.revision ?? 1),
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
    const roleRow = await this.db.query<{
      id: string;
      key: string;
      name: string;
    }>(
      `SELECT r.id, r.key, r.name
			 FROM athena.authorization_member_roles mr
			 JOIN athena.authorization_roles r ON r.id = mr.role_id
			 WHERE mr.member_id = $1`,
      [member.id]
    );
    const assignedRoleIds = roleRow.rows.map((row) => row.id);
    const roleKey = roleRow.rows[0]?.key ?? mapLegacyMemberRole(member.role);
    const roleName = roleRow.rows[0]?.name ?? roleKey;
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
      roleKey === ORGANIZATION_OWNER_ROLE
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
      assignedRoleIds,
      canChangeRole: denialReasons.changeRole === undefined,
      canRemove: denialReasons.remove === undefined,
      denialReasons,
      roleDisplayName: roleName,
      roleKey,
    };
  }

  private async loadScopedRole(
    id: string,
    organizationId?: string | null
  ): Promise<AthenaAuthorizationRoleRecord | undefined> {
    const result = organizationId
      ? await this.db.query<RoleRow>(
          `SELECT * FROM athena.authorization_roles
					 WHERE id = $1 AND scope_kind = 'organization'
					   AND (organization_id IS NULL OR organization_id = $2)`,
          [id, organizationId]
        )
      : await this.db.query<RoleRow>(
          `SELECT * FROM athena.authorization_roles
					 WHERE id = $1 AND scope_kind = 'platform' AND organization_id IS NULL`,
          [id]
        );
    const row = result.rows[0];
    return row ? mapRoleRow(row) : undefined;
  }

  private async requireScopedRole(
    id: string,
    organizationId?: string | null
  ): Promise<AthenaAuthorizationRoleRecord> {
    const role = await this.loadScopedRole(id, organizationId);
    if (!role) {
      throwRoleNotFound();
    }
    return role;
  }

  private async countAssignments(
    role: Pick<AthenaAuthorizationRoleRecord, "id" | "scopeKind">
  ): Promise<number> {
    if (role.scopeKind === "organization") {
      const result = await this.db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM athena.authorization_member_roles WHERE role_id = $1",
        [role.id]
      );
      return Number(result.rows[0]?.count ?? 0);
    }
    const result = await this.db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM athena.authorization_user_roles WHERE role_id = $1",
      [role.id]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async replaceMapping(
    roleId: string,
    rights: readonly string[]
  ): Promise<void> {
    await this.db.query(
      "DELETE FROM athena.authorization_role_rights WHERE role_id = $1",
      [roleId]
    );
    for (const key of rights) {
      await this.db.query(
        `INSERT INTO athena.authorization_role_rights (role_id, right_key)
				 VALUES ($1, $2)`,
        [roleId, parseAthenaRightKey(key)]
      );
    }
  }

  private async replaceUserRoleAssignmentsInTransaction(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    roleIds: readonly string[];
    userId: string;
  }): Promise<{ revision: number }> {
    const current = await this.readRevision(null);
    if (input.expectedVersion !== current) {
      throwAssignmentVersionConflict();
    }
    const assignments = await this.db.query<{
      key: string;
      role_id: string;
    }>(
      `SELECT r.key, ur.role_id
       FROM athena.authorization_user_roles ur
       JOIN athena.authorization_roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
       FOR UPDATE OF ur`,
      [input.userId]
    );
    const currentRoleIds = assignments.rows.map((row) => row.role_id);
    const uniqueIds = [...new Set(input.roleIds)];
    const roles: AthenaAuthorizationRoleRecord[] = [];
    for (const id of uniqueIds) {
      roles.push(await this.requireScopedRole(id, null));
    }
    assertPlatformAssignmentRoles(roles);
    const beforeRights: AthenaRightKey[] = [];
    for (const id of currentRoleIds) {
      beforeRights.push(...(await this.listRoleRights(id)));
    }
    const afterRights: AthenaRightKey[] = [];
    for (const id of uniqueIds) {
      afterRights.push(...(await this.listRoleRights(id)));
    }
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights,
      beforeRights,
      roleScope: "platform",
    });
    const currentIds = new Set(currentRoleIds);
    const nextIds = new Set(uniqueIds);
    const unchanged =
      currentIds.size === nextIds.size &&
      [...currentIds].every((id) => nextIds.has(id));
    if (unchanged) {
      return { revision: current };
    }
    const admins = await this.db.query<{ user_id: string }>(
      `SELECT ur.user_id
			 FROM athena.authorization_user_roles ur
			 JOIN athena.authorization_roles r ON r.id = ur.role_id
			 WHERE r.key = $1`,
      [PLATFORM_ADMIN_ROLE]
    );
    const currentAdminUserIds = admins.rows.map((row) => row.user_id);
    const nextHasAdmin = roles.some((role) => role.key === PLATFORM_ADMIN_ROLE);
    if (currentAdminUserIds.includes(input.userId) || nextHasAdmin) {
      assertNotLastPlatformAdmin({
        currentAdminUserIds,
        nextHasAdmin,
        targetUserId: input.userId,
      });
    }
    const revision = await this.claimRevision(null, input.expectedVersion);
    const removedIds = currentRoleIds.filter((id) => !nextIds.has(id));
    if (removedIds.length > 0) {
      await this.db.query(
        `DELETE FROM athena.authorization_user_roles
         WHERE user_id = $1 AND role_id = ANY($2::text[])`,
        [input.userId, removedIds]
      );
    }
    for (const role of roles) {
      if (currentIds.has(role.id)) {
        continue;
      }
      await this.db.query(
        `INSERT INTO athena.authorization_user_roles (user_id, role_id, assigned_by)
				 VALUES ($1, $2, $3)`,
        [input.userId, role.id, input.actorUserId]
      );
    }
    await this.writeAudit({
      action: "user.roles.replace",
      actorUserId: input.actorUserId,
      after: { roleIds: uniqueIds },
      before: { roleIds: currentRoleIds },
      targetId: input.userId,
      targetKind: "user",
    });
    return { revision };
  }

  private async replaceMemberRoleAssignmentsInTransaction(input: {
    actorRights: readonly string[];
    actorUserId: string;
    expectedVersion: number;
    foundingOwnerUserId?: string | null;
    memberId: string;
    memberUserId: string;
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<{ revision: number }> {
    const current = await this.readRevision(input.organizationId);
    if (input.expectedVersion !== current) {
      throwAssignmentVersionConflict();
    }
    const member = await this.db.query<{ role: string }>(
      `SELECT role FROM athena.member
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [input.memberId, input.organizationId]
    );
    if (!member.rows[0]) {
      throw AthenaAuthRuntimeError.notFound("Member not found");
    }
    const assignments = await this.db.query<{
      key: string;
      role_id: string;
    }>(
      `SELECT r.key, mr.role_id
       FROM athena.authorization_member_roles mr
       JOIN athena.authorization_roles r ON r.id = mr.role_id
       WHERE mr.member_id = $1
       FOR UPDATE OF mr`,
      [input.memberId]
    );
    const currentRoleIds = assignments.rows.map((row) => row.role_id);
    const uniqueIds = [...new Set(input.roleIds)];
    const roles: AthenaAuthorizationRoleRecord[] = [];
    for (const id of uniqueIds) {
      roles.push(await this.requireScopedRole(id, input.organizationId));
    }
    assertOrganizationAssignmentRoles({
      foundingOwnerUserId: input.foundingOwnerUserId,
      memberUserId: input.memberUserId,
      organizationId: input.organizationId,
      roles,
    });
    const beforeRights: AthenaRightKey[] = [];
    for (const id of currentRoleIds) {
      beforeRights.push(...(await this.listRoleRights(id)));
    }
    const afterRights: AthenaRightKey[] = [];
    for (const id of uniqueIds) {
      afterRights.push(...(await this.listRoleRights(id)));
    }
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights,
      beforeRights,
      organizationId: input.organizationId,
      roleScope: "organization",
    });
    const currentIds = new Set(currentRoleIds);
    const nextIds = new Set(uniqueIds);
    const unchanged =
      currentIds.size === nextIds.size &&
      [...currentIds].every((id) => nextIds.has(id));
    const base = roles.find(
      (role) => role.protected && role.systemKind != null
    );
    if (unchanged) {
      if (base) {
        const nextLegacyRole = persistedMemberRole(base);
        if (member.rows[0].role !== nextLegacyRole) {
          await this.db.query(
            "UPDATE athena.member SET role = $1 WHERE id = $2",
            [nextLegacyRole, input.memberId]
          );
        }
      }
      return { revision: current };
    }
    const revision = await this.claimRevision(
      input.organizationId,
      input.expectedVersion
    );
    if (base) {
      const nextLegacyRole = persistedMemberRole(base);
      if (member.rows[0].role !== nextLegacyRole) {
        await this.db.query(
          "UPDATE athena.member SET role = $1 WHERE id = $2",
          [nextLegacyRole, input.memberId]
        );
      }
    }
    const removedIds = currentRoleIds.filter((id) => !nextIds.has(id));
    if (removedIds.length > 0) {
      await this.db.query(
        `DELETE FROM athena.authorization_member_roles
         WHERE member_id = $1 AND role_id = ANY($2::text[])`,
        [input.memberId, removedIds]
      );
    }
    for (const role of roles) {
      if (currentIds.has(role.id)) {
        continue;
      }
      await this.db.query(
        `INSERT INTO athena.authorization_member_roles (member_id, role_id, assigned_by)
				 VALUES ($1, $2, $3)`,
        [input.memberId, role.id, input.actorUserId]
      );
    }
    await this.writeAudit({
      action: "member.roles.replace",
      actorUserId: input.actorUserId,
      after: { roleIds: uniqueIds },
      before: { roleIds: currentRoleIds },
      organizationId: input.organizationId,
      targetId: input.memberId,
      targetKind: "member",
    });
    return { revision };
  }

  private async readRevision(organizationId: string | null): Promise<number> {
    const result = organizationId
      ? await this.db.query<{ revision: string }>(
          `SELECT revision::text AS revision
					 FROM athena.authorization_revisions
					 WHERE organization_id = $1`,
          [organizationId]
        )
      : await this.db.query<{ revision: string }>(
          `SELECT revision::text AS revision
					 FROM athena.authorization_revisions
					 WHERE scope_kind = 'platform' AND organization_id IS NULL`
        );
    const revision = result.rows[0]?.revision;
    if (revision == null) {
      throwAuthorizationRevisionMissing();
    }
    return Number(revision);
  }

  private async claimRevision(
    organizationId: string | null,
    expectedVersion: number
  ): Promise<number> {
    const result = organizationId
      ? await this.db.query<{ revision: string }>(
          `UPDATE athena.authorization_revisions
           SET revision = revision + 1, updated_at = NOW()
           WHERE scope_kind = 'organization'
             AND organization_id = $1 AND revision = $2
           RETURNING revision::text AS revision`,
          [organizationId, expectedVersion]
        )
      : await this.db.query<{ revision: string }>(
          `UPDATE athena.authorization_revisions
           SET revision = revision + 1, updated_at = NOW()
           WHERE scope_kind = 'platform' AND organization_id IS NULL
             AND revision = $1
           RETURNING revision::text AS revision`,
          [expectedVersion]
        );
    const revision = result.rows[0]?.revision;
    if (revision == null) {
      throwAssignmentVersionConflict();
    }
    return Number(revision);
  }

  private async bumpRoleVersion(
    id: string,
    expectedVersion: number
  ): Promise<AthenaAuthorizationRoleRecord> {
    const updated = await this.db.query<RoleRow>(
      `UPDATE athena.authorization_roles
			 SET version = version + 1, updated_at = NOW()
			 WHERE id = $1 AND version = $2
			 RETURNING *`,
      [id, expectedVersion]
    );
    const row = updated.rows[0];
    if (!row) {
      throwRoleVersionConflict();
    }
    return mapRoleRow(row);
  }

  private async bumpRevision(organizationId: string | null): Promise<void> {
    if (organizationId) {
      const updated = await this.db.query(
        `UPDATE athena.authorization_revisions
         SET revision = revision + 1, updated_at = NOW()
         WHERE scope_kind = 'organization' AND organization_id = $1`,
        [organizationId]
      );
      if (updated.rowCount !== 1) {
        throwAuthorizationRevisionMissing();
      }
      return;
    }
    const updated = await this.db.query(
      `UPDATE athena.authorization_revisions
			 SET revision = revision + 1, updated_at = NOW()
			 WHERE scope_kind = 'platform' AND organization_id IS NULL`
    );
    if (updated.rowCount !== 1) {
      throwAuthorizationRevisionMissing();
    }
  }

  private async writeAudit(input: {
    action: string;
    actorUserId?: string;
    after?: unknown;
    before?: unknown;
    organizationId?: string | null;
    targetId: string;
    targetKind: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO athena.authorization_audit_log (
				id, actor_user_id, action, target_kind, target_id, organization_id,
				before_state, after_state, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NOW())`,
      [
        crypto.randomUUID(),
        input.actorUserId ?? null,
        input.action,
        input.targetKind,
        input.targetId,
        input.organizationId ?? null,
        JSON.stringify(input.before ?? {}),
        JSON.stringify(input.after ?? {}),
      ]
    );
  }
}

async function authorizationCatalogStateRelationVisible(
  db: AthenaAuthDatabase,
): Promise<boolean> {
  const probed = assertQueryResult<Record<string, unknown>>(
    await db.query(
      "SELECT to_regclass('athena.authorization_catalog_state') AS oid",
    ),
    "probing authorization catalog state",
  );
  const oid = probed.rows[0]?.oid;
  return oid != null && String(oid).length > 0;
}
