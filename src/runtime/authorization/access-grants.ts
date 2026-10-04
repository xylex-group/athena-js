import type { AthenaRightKey } from "../../rights/key.ts";
import { tryParseAthenaRightKey } from "../../rights/key.ts";
import type { AthenaRightsAuthority } from "../../rights/authority.ts";
import type { AthenaRightRiskLevel } from "../../rights/types.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { AthenaAuthorizationGrantScopeKind } from "./grant-identity.ts";
import { canonicalGrantId } from "./grant-identity.ts";
import { getAthenaAuthorizationRight } from "./catalog.ts";
import {
  createAuthorizationAuthorityVersion,
  type AuthorizationAuthorityVersion,
} from "./assignment-snapshot.ts";

export interface AthenaAccessGrant {
  readonly authorityVersion: AuthorizationAuthorityVersion;
  readonly id: string;
  readonly organizationId: string | null;
  readonly provenance: {
    readonly assignedAt: string;
    readonly assignedBy: string | null;
    readonly sourceId?: string;
    readonly sourceKind?: "identity_connection";
  };
  readonly rights: readonly AthenaRightKey[];
  readonly riskLevel: AthenaRightRiskLevel;
  readonly role: {
    readonly id: string;
    readonly key: string;
  };
  readonly subject: {
    readonly kind: "user" | "member";
    readonly memberId?: string;
    readonly userId: string;
  };
}

export interface AthenaAccessGrantRecord {
  assignedAt: string;
  assignedBy: string | null;
  authorityVersion: AuthorizationAuthorityVersion;
  memberId: string | null;
  organizationId: string | null;
  rightKeys: readonly string[];
  roleId: string;
  roleKey: string;
  scopeKind: AthenaAuthorizationGrantScopeKind;
  sourceId: string | null;
  sourceKind: string | null;
  userId: string;
}

export type AthenaAccessGrantRoleFingerprintRecord = Pick<
  AthenaAccessGrantRecord,
  "organizationId" | "rightKeys" | "roleId" | "roleKey" | "scopeKind"
>;

export interface AthenaAccessGrantAuthorityContext {
  catalogVersion: number;
  rightsAuthority: AthenaRightsAuthority;
  rightsFingerprint: string;
  rolesFingerprint: string;
}

const RISK_WEIGHT: Record<AthenaRightRiskLevel, number> = {
  critical: 2,
  elevated: 1,
  low: 0,
};

function accessGrantAuthorityScopeKey(
  scopeKind: AthenaAuthorizationGrantScopeKind,
  organizationId: string | null
): string {
  return scopeKind === "platform"
    ? "platform"
    : `organization:${organizationId ?? ""}`;
}

export function createAccessGrantAuthorityVersion(
  input: {
    assignmentRevision: number;
    roleAssignments: readonly AthenaAccessGrantRoleFingerprintRecord[];
  },
  authority?: AthenaAccessGrantAuthorityContext
): AuthorizationAuthorityVersion {
  const roles = new Map<
    string,
    {
      organizationId: string | null;
      rightKeys: readonly string[];
      roleId: string;
      roleKey: string;
      scopeKind: AthenaAuthorizationGrantScopeKind;
    }
  >();
  for (const assignment of input.roleAssignments) {
    const rightKeys = [...new Set(assignment.rightKeys)].sort();
    const existing = roles.get(assignment.roleId);
    if (existing) {
      if (
        existing.organizationId !== assignment.organizationId ||
        existing.roleKey !== assignment.roleKey ||
        existing.scopeKind !== assignment.scopeKind ||
        JSON.stringify(existing.rightKeys) !== JSON.stringify(rightKeys)
      ) {
        throw new Error("ATHENA_AUTHORIZATION_INVENTORY_ROLE_INCONSISTENT");
      }
      continue;
    }
    roles.set(assignment.roleId, {
      organizationId: assignment.organizationId,
      rightKeys,
      roleId: assignment.roleId,
      roleKey: assignment.roleKey,
      scopeKind: assignment.scopeKind,
    });
  }
  const base = authority
    ? {
        assignmentRevision: input.assignmentRevision,
        catalogVersion: authority.catalogVersion,
        rightsFingerprint: authority.rightsFingerprint,
        rolesFingerprint: authority.rolesFingerprint,
      }
    : createAuthorizationAuthorityVersion(input.assignmentRevision);
  const rolesFingerprint = bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify({
          catalogFingerprint: base.rolesFingerprint,
          roles: [...roles.values()].sort((left, right) =>
            left.roleId.localeCompare(right.roleId)
          ),
        })
      )
    )
  );
  return Object.freeze({ ...base, rolesFingerprint });
}

export function projectAthenaAccessGrants(
  entries: readonly {
    assignmentRevision: number;
    record: Omit<AthenaAccessGrantRecord, "authorityVersion">;
  }[],
  authority?: AthenaAccessGrantAuthorityContext
): readonly AthenaAccessGrant[] {
  const scopedRecords = new Map<
    string,
    {
      assignmentRevision: number;
      roleAssignments: Omit<AthenaAccessGrantRecord, "authorityVersion">[];
    }
  >();
  for (const { assignmentRevision, record } of entries) {
    const key = accessGrantAuthorityScopeKey(
      record.scopeKind,
      record.organizationId
    );
    const scope = scopedRecords.get(key) ?? {
      assignmentRevision,
      roleAssignments: [],
    };
    if (scope.assignmentRevision !== assignmentRevision) {
      throw new Error("ATHENA_AUTHORIZATION_INVENTORY_VERSION_INCONSISTENT");
    }
    scope.roleAssignments.push(record);
    scopedRecords.set(key, scope);
  }

  const authorityVersions = new Map<
    string,
    ReturnType<typeof createAccessGrantAuthorityVersion>
  >();
  for (const [key, scope] of scopedRecords) {
    authorityVersions.set(
      key,
      createAccessGrantAuthorityVersion({
        assignmentRevision: scope.assignmentRevision,
        roleAssignments: scope.roleAssignments,
      }, authority)
    );
  }

  const grants = entries.map(({ record }) => {
    const key = accessGrantAuthorityScopeKey(
      record.scopeKind,
      record.organizationId
    );
    const authorityVersion = authorityVersions.get(key);
    if (!authorityVersion) {
      throw new Error("ATHENA_AUTHORIZATION_INVENTORY_VERSION_MISSING");
    }
    return projectAthenaAccessGrant({ ...record, authorityVersion }, authority);
  });
  const grantIds = new Set<string>();
  for (const grant of grants) {
    if (grantIds.has(grant.id)) {
      throw new Error("ATHENA_AUTHORIZATION_INVENTORY_GRANT_DUPLICATE");
    }
    grantIds.add(grant.id);
  }
  return Object.freeze(grants.sort((left, right) => left.id.localeCompare(right.id)));
}

export function projectAthenaAccessGrant(
  record: AthenaAccessGrantRecord,
  authority?: AthenaAccessGrantAuthorityContext
): AthenaAccessGrant {
  if (
    !isNonEmptyString(record.roleId) ||
    !isNonEmptyString(record.roleKey) ||
    !isNonEmptyString(record.userId) ||
    (record.assignedBy != null && !isNonEmptyString(record.assignedBy))
  ) {
    throw new Error("ATHENA_AUTHORIZATION_INVENTORY_IDENTITY_INVALID");
  }

  if (record.scopeKind !== "platform" && record.scopeKind !== "organization") {
    throw new Error("ATHENA_AUTHORIZATION_INVENTORY_IDENTITY_INVALID");
  }
  const isOrganization = record.scopeKind === "organization";
  if (
    isOrganization &&
    (!isNonEmptyString(record.memberId) ||
      !isNonEmptyString(record.organizationId))
  ) {
    throw new Error("ATHENA_AUTHORIZATION_INVENTORY_IDENTITY_INVALID");
  }
  if (
    !isOrganization &&
    (record.memberId != null || record.organizationId != null)
  ) {
    throw new Error("ATHENA_AUTHORIZATION_INVENTORY_IDENTITY_INVALID");
  }

  const sourceKind = record.sourceKind;
  const sourceId = record.sourceId;
  if (
    (!isOrganization && (sourceKind != null || sourceId != null)) ||
    (sourceKind == null) !== (sourceId == null) ||
    (sourceKind != null &&
      (sourceKind !== "identity_connection" ||
        !isNonEmptyString(sourceId)))
  ) {
    throw new Error("ATHENA_AUTHORIZATION_INVENTORY_PROVENANCE_INVALID");
  }

  const assignedAt = new Date(record.assignedAt);
  if (Number.isNaN(assignedAt.valueOf())) {
    throw new Error("ATHENA_AUTHORIZATION_INVENTORY_PROVENANCE_INVALID");
  }
  if (
    !Number.isSafeInteger(record.authorityVersion.assignmentRevision) ||
    record.authorityVersion.assignmentRevision < 1 ||
    !Number.isSafeInteger(record.authorityVersion.catalogVersion) ||
    record.authorityVersion.catalogVersion < 1 ||
    !isNonEmptyString(record.authorityVersion.rightsFingerprint) ||
    !isNonEmptyString(record.authorityVersion.rolesFingerprint)
  ) {
    throw new Error("ATHENA_AUTHORIZATION_INVENTORY_VERSION_INVALID");
  }

  const rights = new Map<AthenaRightKey, AthenaRightRiskLevel>();
  for (const rawKey of record.rightKeys) {
    const key = tryParseAthenaRightKey(rawKey);
    const definition = key
      ? authority
        ? authority.rightsAuthority.byKey.get(key)
        : getAthenaAuthorizationRight(key)
      : undefined;
    if (!(key && definition)) {
      throw new Error("ATHENA_AUTHORIZATION_INVENTORY_RIGHT_UNKNOWN");
    }
    rights.set(key, definition.riskLevel);
  }
  const sortedRights = [...rights.keys()].sort((left, right) =>
    String(left).localeCompare(String(right))
  );
  let riskLevel: AthenaRightRiskLevel = "low";
  for (const right of rights.values()) {
    if (RISK_WEIGHT[right] > RISK_WEIGHT[riskLevel]) {
      riskLevel = right;
    }
  }

  const subject = Object.freeze({
    kind: isOrganization ? ("member" as const) : ("user" as const),
    ...(isOrganization ? { memberId: record.memberId as string } : {}),
    userId: record.userId,
  });
  const provenance = Object.freeze({
    assignedAt: assignedAt.toISOString(),
    assignedBy: record.assignedBy,
    ...(sourceKind != null && sourceId != null
      ? { sourceId, sourceKind: "identity_connection" as const }
      : {}),
  });
  const authorityVersion = Object.freeze({ ...record.authorityVersion });
  const identity = {
    organizationId: record.organizationId,
    roleId: record.roleId,
    scopeKind: record.scopeKind,
    subjectId: isOrganization ? (record.memberId as string) : record.userId,
    subjectKind: isOrganization ? ("member" as const) : ("user" as const),
  };

  return Object.freeze({
    authorityVersion,
    id: canonicalGrantId(identity),
    organizationId: record.organizationId,
    provenance,
    rights: Object.freeze(sortedRights),
    riskLevel,
    role: Object.freeze({ id: record.roleId, key: record.roleKey }),
    subject,
  });
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return value != null && value.trim().length > 0;
}
