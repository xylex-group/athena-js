import { createAthenaRightsAuthority } from "../../../rights/authority.ts";
import {
  type AthenaAccessGrant,
  type AthenaAccessGrantRecord,
  projectAthenaAccessGrants,
} from "../access-grants.ts";
import { canonicalizeAthenaAuthorizationSnapshotIr } from "./canonicalize.ts";
import type { AthenaAuthorizationSnapshotIr } from "./types.ts";

export function projectAthenaAccessGrantsFromAuthorizationSnapshot(
  value: AthenaAuthorizationSnapshotIr
): readonly AthenaAccessGrant[] {
  const snapshot = canonicalizeAthenaAuthorizationSnapshotIr(value);
  const rolesById = new Map(
    snapshot.roles.roles.map((role) => [role.id, role])
  );
  const entries = snapshot.assignments.map((assignment) => {
    const role = rolesById.get(assignment.roleId);
    if (!role) {
      throw new Error(
        `Role ${assignment.roleId} is unavailable in the validated snapshot`
      );
    }
    const isMember = assignment.subject.kind === "member";
    const record: Omit<AthenaAccessGrantRecord, "authorityVersion"> = {
      assignedAt: assignment.provenance.assignedAt,
      assignedBy: assignment.provenance.assignedBy,
      memberId: isMember ? assignment.subject.memberId : null,
      organizationId:
        snapshot.scope.kind === "organization"
          ? snapshot.scope.organizationId
          : null,
      rightKeys: role.rights,
      roleId: role.id,
      roleKey: role.key,
      scopeKind: snapshot.scope.kind,
      sourceId: assignment.provenance.sourceId ?? null,
      sourceKind: assignment.provenance.sourceKind ?? null,
      userId: assignment.subject.userId,
    };
    return {
      assignmentRevision: snapshot.metadata.assignmentRevision,
      record,
    };
  });
  return projectAthenaAccessGrants(entries, {
    catalogVersion: snapshot.metadata.catalogVersion,
    rightsAuthority: createAthenaRightsAuthority(snapshot.rights),
    rightsFingerprint: snapshot.metadata.rightsFingerprint,
    rolesFingerprint: snapshot.metadata.rolesFingerprint,
  });
}
