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
  groupOrganizationMemberAssignments,
  groupPlatformUserAssignments,
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
import type { AthenaAuthorizationStore } from "./store.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
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
    await db.query(
      `INSERT INTO athena.authorization_user_roles (user_id, role_id)
			 SELECT u.id, r.id
			 FROM athena.users u
			 JOIN athena.authorization_roles r
			   ON r.id = $1
			  AND r.organization_id IS NULL
			 WHERE COALESCE(u.role, '') = 'admin'
			   AND NOT EXISTS (
			     SELECT 1 FROM athena.authorization_user_roles a WHERE a.user_id = u.id
			   )`,
      ["platform_admin"]
    );
    await db.query(
      `INSERT INTO athena.authorization_user_roles (user_id, role_id)
			 SELECT u.id, r.id
			 FROM athena.users u
			 JOIN athena.authorization_roles r
			   ON r.id = $1
			  AND r.organization_id IS NULL
			 WHERE COALESCE(u.role, '') = 'unauthorized'
			   AND NOT EXISTS (
			     SELECT 1 FROM athena.authorization_user_roles a WHERE a.user_id = u.id
			   )`,
      ["platform_unauthorized"]
    );
    await db.query(
      `INSERT INTO athena.authorization_user_roles (user_id, role_id)
			 SELECT u.id, r.id
			 FROM athena.users u
			 JOIN athena.authorization_roles r
			   ON r.id = $1
			  AND r.organization_id IS NULL
			 WHERE COALESCE(u.role, '') IN ('', 'customer')
			   AND NOT EXISTS (
			     SELECT 1 FROM athena.authorization_user_roles a WHERE a.user_id = u.id
			   )`,
      ["platform_customer"]
    );
    await db.query(
      `INSERT INTO athena.authorization_user_roles (user_id, role_id)
			 SELECT u.id, r.id
			 FROM athena.users u
			 JOIN athena.authorization_roles r
			   ON r.id = $1
			  AND r.organization_id IS NULL
			 WHERE u.role IS NOT NULL
			   AND u.role NOT IN ('admin', 'unauthorized', 'customer')
			   AND NOT EXISTS (
			     SELECT 1 FROM athena.authorization_user_roles a WHERE a.user_id = u.id
			   )`,
      ["platform_unauthorized"]
    );
    await db.query(
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
			 )`
    );
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
    const mapped = mapLegacyUserRole(
      roleKey === "admin" ||
        roleKey === "customer" ||
        roleKey === "unauthorized"
        ? roleKey
        : roleKey
    );
    const key = roleKey.startsWith("platform_") ? roleKey : mapped;
    const inserted = await this.db.query(
      "DELETE FROM athena.authorization_user_roles WHERE user_id = $1",
      [userId]
    );
    void inserted;
    const assigned = await this.db.query(
      `INSERT INTO athena.authorization_user_roles (user_id, role_id, assigned_by)
			 SELECT $1, id, $3
			 FROM athena.authorization_roles
			 WHERE key = $2 AND organization_id IS NULL AND scope_kind = 'platform'`,
      [userId, key, assignedBy ?? null]
    );
    if (assigned.rowCount < 1) {
      throw AthenaAuthRuntimeError.badRequest("Unknown platform role");
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
    organizationId?: string | null
  ): Promise<void> {
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
    await this.db.query(
      "DELETE FROM athena.authorization_member_roles WHERE member_id = $1",
      [memberId]
    );
    await this.db.query(
      `INSERT INTO athena.authorization_member_roles (member_id, role_id, assigned_by)
			 VALUES ($1, $2, $3)`,
      [memberId, role.id, assignedBy ?? null]
    );
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
      revision: string;
      role_id: string | null;
      user_id: string | null;
    }>(
      filterIds && filterIds.length > 0
        ? `WITH rev AS (
						SELECT COALESCE((
							SELECT revision FROM athena.authorization_revisions
							WHERE scope_kind = 'platform' AND organization_id IS NULL
						), 1) AS revision
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
						SELECT COALESCE((
							SELECT revision FROM athena.authorization_revisions
							WHERE scope_kind = 'platform' AND organization_id IS NULL
						), 1) AS revision
					)
					SELECT rev.revision::text AS revision, ur.user_id, ur.role_id
					FROM rev
					LEFT JOIN athena.authorization_user_roles ur ON TRUE`,
      filterIds && filterIds.length > 0 ? [filterIds] : []
    );
    const revision = asPlatformAssignmentRevision(
      Number(result.rows[0]?.revision ?? 1)
    );
    const rows = result.rows.flatMap((row) =>
      row.user_id && row.role_id
        ? [{ roleId: row.role_id, userId: row.user_id }]
        : []
    );
    return {
      assignments: groupPlatformUserAssignments(rows, filterIds),
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
      revision: string;
      role_id: string | null;
      user_id: string | null;
    }>(
      `WITH rev AS (
					SELECT COALESCE((
						SELECT revision FROM athena.authorization_revisions
						WHERE organization_id = $1
					), 1) AS revision
				)
				SELECT rev.revision::text AS revision, mr.member_id, mr.role_id, m.user_id
				FROM rev
				LEFT JOIN athena.member m ON m.organization_id = $1
				LEFT JOIN athena.authorization_member_roles mr ON mr.member_id = m.id`,
      [input.organizationId]
    );
    const revision = asOrganizationAssignmentRevision(
      Number(result.rows[0]?.revision ?? 1)
    );
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
      organizationId: input.organizationId,
      revision,
    };
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
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const nested = new PostgresAuthorizationStore(tx);
      await nested.deleteRoleInTransaction(input);
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
  }): Promise<void> {
    const role = await this.requireScopedRole(input.id, input.organizationId);
    assertProtectedRoleImmutable(role);
    await this.bumpRoleVersion(role.id, input.expectedVersion);
    const assigned = await this.countAssignments(role);
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
        await this.db.query(
          `UPDATE athena.authorization_member_roles SET role_id = $1, updated_at = NOW()
					 WHERE role_id = $2`,
          [replacement.id, role.id]
        );
      } else {
        await this.db.query(
          `UPDATE athena.authorization_user_roles SET role_id = $1, updated_at = NOW()
					 WHERE role_id = $2`,
          [replacement.id, role.id]
        );
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
    const uniqueIds = [...new Set(input.roleIds)];
    const roles: AthenaAuthorizationRoleRecord[] = [];
    for (const id of uniqueIds) {
      roles.push(await this.requireScopedRole(id, null));
    }
    assertPlatformAssignmentRoles(roles);
    const afterRights = (
      await Promise.all(uniqueIds.map((id) => this.listRoleRights(id)))
    ).flat();
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights,
      beforeRights: [],
      roleScope: "platform",
    });
    const admins = await this.db.query<{ user_id: string }>(
      `SELECT ur.user_id
			 FROM athena.authorization_user_roles ur
			 JOIN athena.authorization_roles r ON r.id = ur.role_id
			 WHERE r.key = $1`,
      [PLATFORM_ADMIN_ROLE]
    );
    assertNotLastPlatformAdmin({
      currentAdminUserIds: admins.rows.map((row) => row.user_id),
      nextHasAdmin: roles.some((role) => role.key === PLATFORM_ADMIN_ROLE),
      targetUserId: input.userId,
    });
    await this.db.query(
      "DELETE FROM athena.authorization_user_roles WHERE user_id = $1",
      [input.userId]
    );
    for (const role of roles) {
      await this.db.query(
        `INSERT INTO athena.authorization_user_roles (user_id, role_id, assigned_by)
				 VALUES ($1, $2, $3)`,
        [input.userId, role.id, input.actorUserId]
      );
    }
    await this.bumpRevision(null);
    await this.writeAudit({
      action: "user.roles.replace",
      actorUserId: input.actorUserId,
      after: { roleIds: uniqueIds },
      targetId: input.userId,
      targetKind: "user",
    });
    return { revision: current + 1 };
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
    const afterRights = (
      await Promise.all(uniqueIds.map((id) => this.listRoleRights(id)))
    ).flat();
    assertAuthorizationDelegationAllowed({
      actorRights: input.actorRights,
      afterRights,
      beforeRights: [],
      organizationId: input.organizationId,
      roleScope: "organization",
    });
    await this.db.query(
      "DELETE FROM athena.authorization_member_roles WHERE member_id = $1",
      [input.memberId]
    );
    for (const role of roles) {
      await this.db.query(
        `INSERT INTO athena.authorization_member_roles (member_id, role_id, assigned_by)
				 VALUES ($1, $2, $3)`,
        [input.memberId, role.id, input.actorUserId]
      );
    }
    const base = roles.find(
      (role) => role.protected && role.systemKind != null
    );
    if (base) {
      await this.db.query(
        "UPDATE athena.member SET role = $1, updated_at = NOW() WHERE id = $2",
        [persistedMemberRole(base), input.memberId]
      );
    }
    await this.bumpRevision(input.organizationId);
    await this.writeAudit({
      action: "member.roles.replace",
      actorUserId: input.actorUserId,
      after: { roleIds: uniqueIds },
      organizationId: input.organizationId,
      targetId: input.memberId,
      targetKind: "member",
    });
    return { revision: current + 1 };
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
    return Number(result.rows[0]?.revision ?? 1);
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
      await this.db.query(
        `WITH updated AS (
					UPDATE athena.authorization_revisions
					SET revision = revision + 1, updated_at = NOW()
					WHERE organization_id = $1
					RETURNING organization_id
				)
				INSERT INTO athena.authorization_revisions (scope_kind, organization_id, revision)
				SELECT 'organization', $1, 1
				WHERE NOT EXISTS (SELECT 1 FROM updated)`,
        [organizationId]
      );
      return;
    }
    await this.db.query(
      `UPDATE athena.authorization_revisions
			 SET revision = revision + 1, updated_at = NOW()
			 WHERE scope_kind = 'platform' AND organization_id IS NULL`
    );
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
