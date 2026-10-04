export {
  assertBillingOperationsReferenceCatalog,
  defineAthenaRight,
  getAthenaAuthorizationRight,
  listAthenaAuthorizationRights,
} from "./catalog.ts";
export type {
  AthenaAuthorizationGrantIdentity,
  AthenaAuthorizationGrantSubject,
} from "./grant-identity.ts";
export {
  canonicalGrantId,
  grantIdentityFromAssignment,
} from "./grant-identity.ts";
export { MemoryAuthorizationStore } from "./memory.ts";
export { PostgresAuthorizationStore } from "./postgres.ts";
export { hasLegacyRoleMap } from "./shadow.ts";
export type { AthenaAuthorizationStore } from "./store.ts";
export {
  BUILTIN_AUTHORIZATION_ROLES,
  mapLegacyMemberRole,
  mapLegacyUserRole,
} from "./templates.ts";
export type {
  AthenaAuthorizationRightDefinition,
  AuthorizationAuthorityVersion,
  AuthorizationSnapshot,
  OrganizationMemberAssignmentSnapshot,
  OrganizationMemberRoleAssignment,
  PlatformUserAssignmentSnapshot,
  PlatformUserRoleAssignment,
} from "./types.ts";
export {
  canonicalizeAthenaAuthorizationSnapshotIr,
  fingerprintAthenaAuthorizationSnapshotIr,
  projectAthenaAccessGrantsFromAuthorizationSnapshot,
  validateAthenaAuthorizationSnapshotIr,
} from "./snapshot-ir/index.ts";
export type {
  AthenaAuthorizationAssignmentProvenance,
  AthenaAuthorizationSnapshotAssignment,
  AthenaAuthorizationSnapshotIr,
  AthenaAuthorizationSnapshotMetadata,
  AthenaAuthorizationSnapshotScope,
  AthenaAuthorizationSnapshotSubject,
} from "./snapshot-ir/index.ts";
