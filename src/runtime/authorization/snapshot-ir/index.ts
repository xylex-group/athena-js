export type { AthenaAccessGrant } from "../access-grants.ts";
export type { AuthorizationAuthorityVersion } from "../assignment-snapshot.ts";
export { canonicalizeAthenaAuthorizationSnapshotIr } from "./canonicalize.ts";
export { AthenaAuthorizationSnapshotIrValidationError } from "./errors.ts";
export { fingerprintAthenaAuthorizationSnapshotIr } from "./fingerprint.ts";
export { projectAthenaAccessGrantsFromAuthorizationSnapshot } from "./projection.ts";
export type {
  AthenaAuthorizationAssignmentProvenance,
  AthenaAuthorizationSnapshotAssignment,
  AthenaAuthorizationSnapshotIr,
  AthenaAuthorizationSnapshotMetadata,
  AthenaAuthorizationSnapshotScope,
  AthenaAuthorizationSnapshotSubject,
} from "./types.ts";
export {
  ATHENA_AUTHORIZATION_SNAPSHOT_IR_KIND,
  ATHENA_AUTHORIZATION_SNAPSHOT_IR_VERSION,
} from "./types.ts";
export { validateAthenaAuthorizationSnapshotIr } from "./validate.ts";
