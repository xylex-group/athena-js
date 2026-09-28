import { AthenaAuthRuntimeError } from "../../auth/runtime-error.ts";
import { tryParseAthenaRightKey } from "../../rights/key.ts";
import {
  AUTHORIZATION_PLATFORM_DELEGATE,
  AUTHORIZATION_ROLES_DELEGATE,
  getAthenaAuthorizationRight,
} from "./catalog.ts";
import type {
  AthenaAuthorizationRoleRecord,
  AthenaAuthorizationRoleScope,
  AthenaAuthorizationScopeKind,
} from "./types.ts";

export const AUTHORIZATION_ROLE_PROTECTED = "AUTHORIZATION_ROLE_PROTECTED";
export const AUTHORIZATION_ROLE_VERSION_CONFLICT =
  "AUTHORIZATION_ROLE_VERSION_CONFLICT";
export const AUTHORIZATION_ROLE_HAS_ASSIGNMENTS =
  "AUTHORIZATION_ROLE_HAS_ASSIGNMENTS";
export const AUTHORIZATION_RIGHT_UNKNOWN = "AUTHORIZATION_RIGHT_UNKNOWN";
export const AUTHORIZATION_RIGHT_NOT_ASSIGNABLE =
  "AUTHORIZATION_RIGHT_NOT_ASSIGNABLE";
export const AUTHORIZATION_RIGHT_SCOPE_MISMATCH =
  "AUTHORIZATION_RIGHT_SCOPE_MISMATCH";
export const AUTHORIZATION_RIGHT_DELEGATION_DENIED =
  "AUTHORIZATION_RIGHT_DELEGATION_DENIED";
export const AUTHORIZATION_ROLE_NOT_FOUND = "AUTHORIZATION_ROLE_NOT_FOUND";
export const AUTHORIZATION_REASSIGNMENT_INVALID =
  "AUTHORIZATION_REASSIGNMENT_INVALID";
export const AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT =
  "AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT";
export const AUTHORIZATION_LAST_PLATFORM_ADMIN =
  "AUTHORIZATION_LAST_PLATFORM_ADMIN";
export const AUTHORIZATION_FOUNDING_OWNER_PROTECTED =
  "AUTHORIZATION_FOUNDING_OWNER_PROTECTED";
export const AUTHORIZATION_CROSS_ORGANIZATION_ROLE =
  "AUTHORIZATION_CROSS_ORGANIZATION_ROLE";
export const AUTHORIZATION_BASE_ROLE_REQUIRED =
  "AUTHORIZATION_BASE_ROLE_REQUIRED";

function authorizationError(
  status: number,
  code: string,
  message: string
): AthenaAuthRuntimeError {
  return new AthenaAuthRuntimeError(status, message, { code });
}

export function throwRoleProtected(): never {
  throw authorizationError(
    403,
    AUTHORIZATION_ROLE_PROTECTED,
    "Protected roles cannot be renamed, deleted, or have their rights changed"
  );
}

export function throwRoleVersionConflict(): never {
  throw authorizationError(
    409,
    AUTHORIZATION_ROLE_VERSION_CONFLICT,
    "Role version conflict"
  );
}

export function throwRoleHasAssignments(): never {
  throw authorizationError(
    409,
    AUTHORIZATION_ROLE_HAS_ASSIGNMENTS,
    "Role has assignments"
  );
}

export function throwRoleNotFound(): never {
  throw authorizationError(404, AUTHORIZATION_ROLE_NOT_FOUND, "Role not found");
}

export function throwReassignmentInvalid(
  message = "Invalid reassignment role"
): never {
  throw authorizationError(400, AUTHORIZATION_REASSIGNMENT_INVALID, message);
}

export function throwAssignmentVersionConflict(): never {
  throw authorizationError(
    409,
    AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT,
    "Assignment version conflict"
  );
}

export function throwLastPlatformAdmin(): never {
  throw authorizationError(
    409,
    AUTHORIZATION_LAST_PLATFORM_ADMIN,
    "The last platform administrator cannot be removed"
  );
}

export function throwFoundingOwnerProtected(): never {
  throw authorizationError(
    403,
    AUTHORIZATION_FOUNDING_OWNER_PROTECTED,
    "The organization's founding owner cannot be reassigned"
  );
}

export function throwCrossOrganizationRole(): never {
  throw authorizationError(
    403,
    AUTHORIZATION_CROSS_ORGANIZATION_ROLE,
    "Role does not belong to this organization"
  );
}

export function throwBaseRoleRequired(): never {
  throw authorizationError(
    400,
    AUTHORIZATION_BASE_ROLE_REQUIRED,
    "Exactly one protected organization base role is required"
  );
}

export function assertProtectedRoleImmutable(
  role: Pick<AthenaAuthorizationRoleRecord, "protected">
): void {
  if (role.protected) {
    throwRoleProtected();
  }
}

export function assertExpectedVersion(
  role: Pick<AthenaAuthorizationRoleRecord, "version">,
  expectedVersion: number
): void {
  if (role.version !== expectedVersion) {
    throwRoleVersionConflict();
  }
}

function rightAllowedOnRoleScope(
  roleScope: AthenaAuthorizationRoleScope,
  rightScope: AthenaAuthorizationScopeKind
): boolean {
  if (rightScope === "self") {
    return true;
  }
  if (roleScope === "platform") {
    return rightScope === "platform";
  }
  return rightScope === "organization";
}

export function assertRoleRightAssignmentAllowed(input: {
  organizationId?: string | null;
  right: string;
  roleScope: AthenaAuthorizationRoleScope;
}): void {
  void input.organizationId;
  const parsed = tryParseAthenaRightKey(input.right);
  if (!parsed) {
    throw authorizationError(
      400,
      AUTHORIZATION_RIGHT_UNKNOWN,
      "Unknown authorization right"
    );
  }
  const definition = getAthenaAuthorizationRight(parsed);
  if (!definition) {
    throw authorizationError(
      400,
      AUTHORIZATION_RIGHT_UNKNOWN,
      "Unknown authorization right"
    );
  }
  if (!definition.assignable) {
    throw authorizationError(
      400,
      AUTHORIZATION_RIGHT_NOT_ASSIGNABLE,
      "Right is not assignable"
    );
  }
  if (!rightAllowedOnRoleScope(input.roleScope, definition.scopeKind)) {
    throw authorizationError(
      400,
      AUTHORIZATION_RIGHT_SCOPE_MISMATCH,
      "Right is not allowed on this role scope"
    );
  }
}

export function assertRightsReplaceAllowed(input: {
  organizationId?: string | null;
  rights: readonly string[];
  roleScope: AthenaAuthorizationRoleScope;
}): void {
  for (const right of input.rights) {
    assertRoleRightAssignmentAllowed({
      organizationId: input.organizationId,
      right,
      roleScope: input.roleScope,
    });
  }
}

export function addedAuthorizationRights(
  beforeRights: readonly string[],
  afterRights: readonly string[]
): string[] {
  const before = new Set(beforeRights);
  return [...new Set(afterRights)].filter((right) => !before.has(right));
}

export function actorMayDelegateRight(input: {
  actorRights: readonly string[];
  right: string;
  unrestrictedGrant: boolean;
}): boolean {
  if (input.unrestrictedGrant) {
    return true;
  }
  const held = new Set(input.actorRights);
  if (held.has(input.right)) {
    return true;
  }
  const parsed = tryParseAthenaRightKey(input.right);
  if (!parsed) {
    return false;
  }
  const definition = getAthenaAuthorizationRight(parsed);
  if (!definition) {
    return false;
  }
  if (
    definition.scopeKind === "platform" &&
    held.has(AUTHORIZATION_PLATFORM_DELEGATE)
  ) {
    return true;
  }
  if (
    (definition.scopeKind === "organization" ||
      definition.scopeKind === "self") &&
    held.has(AUTHORIZATION_ROLES_DELEGATE)
  ) {
    return true;
  }
  return false;
}

export function assertAuthorizationDelegationAllowed(input: {
  actorRights: readonly string[];
  afterRights: readonly string[];
  beforeRights: readonly string[];
  organizationId?: string | null;
  roleScope: AthenaAuthorizationRoleScope;
  unrestrictedGrant?: boolean;
}): void {
  assertRightsReplaceAllowed({
    organizationId: input.organizationId,
    rights: input.afterRights,
    roleScope: input.roleScope,
  });
  const unrestrictedGrant = input.unrestrictedGrant === true;
  for (const right of addedAuthorizationRights(
    input.beforeRights,
    input.afterRights
  )) {
    if (
      actorMayDelegateRight({
        actorRights: input.actorRights,
        right,
        unrestrictedGrant,
      })
    ) {
      continue;
    }
    throw authorizationError(
      403,
      AUTHORIZATION_RIGHT_DELEGATION_DENIED,
      "Cannot grant a right beyond the actor's delegation authority"
    );
  }
}

export function requireExpectedVersion(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (parsed >= 1) {
      return parsed;
    }
  }
  throw AthenaAuthRuntimeError.badRequest("expectedVersion is required");
}
