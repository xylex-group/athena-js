import type { AthenaRightsIr } from "../../../rights/types.ts";
import type { AthenaRoleId, AthenaRolesIr } from "../../../roles/index.ts";

export const ATHENA_AUTHORIZATION_SNAPSHOT_IR_KIND =
  "athena.authorization.snapshot" as const;
export const ATHENA_AUTHORIZATION_SNAPSHOT_IR_VERSION = 1 as const;

export type AthenaAuthorizationSnapshotScope =
  | { readonly kind: "platform" }
  | { readonly kind: "organization"; readonly organizationId: string };

export type AthenaAuthorizationSnapshotSubject =
  | { readonly kind: "user"; readonly userId: string }
  | {
      readonly kind: "member";
      readonly memberId: string;
      readonly userId: string;
    };

export interface AthenaAuthorizationAssignmentProvenance {
  readonly assignedAt: string;
  readonly assignedBy: string | null;
  readonly sourceId?: string;
  readonly sourceKind?: "identity_connection";
}

export interface AthenaAuthorizationSnapshotAssignment {
  readonly id: string;
  readonly provenance: AthenaAuthorizationAssignmentProvenance;
  readonly roleId: AthenaRoleId;
  readonly subject: AthenaAuthorizationSnapshotSubject;
}

export interface AthenaAuthorizationSnapshotMetadata {
  readonly assignmentRevision: number;
  readonly capturedAt: string;
  readonly catalogVersion: number;
  readonly provenance?: readonly string[];
  readonly rightsFingerprint: string;
  readonly rolesFingerprint: string;
}

export interface AthenaAuthorizationSnapshotIr {
  readonly assignments: readonly AthenaAuthorizationSnapshotAssignment[];
  readonly irVersion: typeof ATHENA_AUTHORIZATION_SNAPSHOT_IR_VERSION;
  readonly kind: typeof ATHENA_AUTHORIZATION_SNAPSHOT_IR_KIND;
  readonly metadata: AthenaAuthorizationSnapshotMetadata;
  readonly rights: AthenaRightsIr;
  readonly roles: AthenaRolesIr;
  readonly scope: AthenaAuthorizationSnapshotScope;
}
