import { createAthenaRightsAuthority } from "../../../rights/authority.ts";
import { canonicalizeAthenaRolesIr } from "../../../roles/ir/canonicalize.ts";
import type { AthenaAuthorizationSnapshotIr } from "./types.ts";
import { validateAthenaAuthorizationSnapshotIr } from "./validate.ts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeAthenaAuthorizationSnapshotIr(
  value: unknown
): AthenaAuthorizationSnapshotIr {
  const validated = validateAthenaAuthorizationSnapshotIr(value);
  const rightsAuthority = createAthenaRightsAuthority(validated.rights);
  const provenance = [...new Set(validated.metadata.provenance ?? [])].sort(
    compareText
  );
  return {
    ...validated,
    assignments: [...validated.assignments].sort((left, right) =>
      compareText(left.id, right.id)
    ),
    metadata: {
      assignmentRevision: validated.metadata.assignmentRevision,
      capturedAt: validated.metadata.capturedAt,
      catalogVersion: validated.metadata.catalogVersion,
      rightsFingerprint: validated.metadata.rightsFingerprint,
      rolesFingerprint: validated.metadata.rolesFingerprint,
      ...(provenance.length === 0 ? {} : { provenance }),
    },
    roles: canonicalizeAthenaRolesIr(validated.roles, rightsAuthority),
  };
}
