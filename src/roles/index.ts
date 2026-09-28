export {
  ATHENA_BUILTIN_ROLE_DEFINITIONS,
  createAthenaBuiltinRoleDefinitions,
} from "./builtin.ts";
export {
  ATHENA_ROLE_ID_INVALID,
  ATHENA_ROLE_KEY_INVALID,
  ATHENA_ROLES_IR_INVALID,
  AthenaRoleIdentityError,
  AthenaRolesIrValidationError,
} from "./errors.ts";
export type { AthenaRoleId } from "./id.ts";
export {
  athenaRoleIdString,
  parseAthenaRoleId,
  tryParseAthenaRoleId,
} from "./id.ts";
export { canonicalizeAthenaRolesIr } from "./ir/canonicalize.ts";
export { fingerprintAthenaRolesIr } from "./ir/fingerprint.ts";
export { validateAthenaRolesIr } from "./ir/validate.ts";
export type { AthenaRoleKey } from "./key.ts";
export {
  athenaRoleKeyString,
  parseAthenaRoleKey,
  tryParseAthenaRoleKey,
} from "./key.ts";
export {
  hydrateAthenaRoleDefinition,
  tryHydrateAthenaRoleDefinition,
} from "./persistence.ts";
export { projectAuthorizationSnapshotRole } from "./projection.ts";
export type {
  AthenaRoleDefinition,
  AthenaRoleDefinitionScope,
  AthenaRoleSnapshotProjection,
  AthenaRoleSystemKind,
  AthenaRolesIr,
  AthenaRolesMetadata,
} from "./types.ts";
export {
  ATHENA_ROLES_IR_KIND,
  ATHENA_ROLES_IR_VERSION,
} from "./types.ts";
