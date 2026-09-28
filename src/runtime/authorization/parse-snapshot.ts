import {
  type AthenaRightKey,
  tryParseAthenaRightKey,
} from "../../rights/key.ts";
import { capabilitiesFromRights } from "./capabilities.ts";
import type {
  AssignedRoleSummary,
  AuthorizationCapabilities,
  AuthorizationSnapshot,
  RoleDescriptor,
} from "./types.ts";

export const ATHENA_AUTHORIZATION_SNAPSHOT_INVALID =
  "ATHENA_AUTHORIZATION_SNAPSHOT_INVALID";

export class AuthorizationSnapshotInvalidError extends Error {
  readonly code = ATHENA_AUTHORIZATION_SNAPSHOT_INVALID;

  constructor(message = "Authorization snapshot is invalid.") {
    super(message);
    this.name = "AuthorizationSnapshotInvalidError";
  }
}

const LEGACY_ROLE_NAME_KEYS = new Set([
  "admin",
  "customer",
  "member",
  "owner",
  "unauthorized",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIntegerAtLeast(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

function parseNonEmptyId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function invalid(): never {
  throw new AuthorizationSnapshotInvalidError();
}

function parseCapabilities(value: unknown): AuthorizationCapabilities {
  if (!isRecord(value)) {
    invalid();
  }
  const canChangeMemberRole = value.canChangeMemberRole;
  const canDeleteOrganization = value.canDeleteOrganization;
  const canInviteMembers = value.canInviteMembers;
  const canManageOrganizationRoles = value.canManageOrganizationRoles;
  const canManagePlatformRoles = value.canManagePlatformRoles;
  const canRemoveMember = value.canRemoveMember;
  if (
    typeof canChangeMemberRole !== "boolean" ||
    typeof canDeleteOrganization !== "boolean" ||
    typeof canInviteMembers !== "boolean" ||
    typeof canManageOrganizationRoles !== "boolean" ||
    typeof canManagePlatformRoles !== "boolean" ||
    typeof canRemoveMember !== "boolean"
  ) {
    invalid();
  }
  return {
    canChangeMemberRole,
    canDeleteOrganization,
    canInviteMembers,
    canManageOrganizationRoles,
    canManagePlatformRoles,
    canRemoveMember,
  };
}

function parseAssignedRole(value: unknown): AssignedRoleSummary {
  if (!isRecord(value)) {
    invalid();
  }
  if (
    typeof value.displayName !== "string" ||
    typeof value.key !== "string" ||
    (value.scopeKind !== "platform" && value.scopeKind !== "organization")
  ) {
    invalid();
  }
  assertAssignableRoleKey(value.key);
  return {
    displayName: value.displayName,
    key: value.key,
    scopeKind: value.scopeKind,
  };
}

function parseRoleDescriptor(value: unknown): RoleDescriptor {
  if (!isRecord(value)) {
    invalid();
  }
  const id = parseNonEmptyId(value.id);
  const organizationId =
    value.organizationId === null
      ? null
      : parseNonEmptyId(value.organizationId);
  if (
    typeof value.assignable !== "boolean" ||
    !isIntegerAtLeast(value.assignmentCount, 0) ||
    (value.description !== undefined &&
      typeof value.description !== "string") ||
    typeof value.displayName !== "string" ||
    id === null ||
    typeof value.key !== "string" ||
    (organizationId === null && value.organizationId !== null) ||
    typeof value.protected !== "boolean" ||
    !isIntegerAtLeast(value.rightCount, 0) ||
    (value.scopeKind !== "platform" && value.scopeKind !== "organization") ||
    (value.systemKind !== null &&
      value.systemKind !== "owner" &&
      value.systemKind !== "admin" &&
      value.systemKind !== "member") ||
    !isIntegerAtLeast(value.version, 1)
  ) {
    invalid();
  }
  assertAssignableRoleKey(value.key);
  if (value.scopeKind === "platform" && organizationId !== null) {
    invalid();
  }
  if (value.scopeKind === "organization" && organizationId === null) {
    invalid();
  }
  return {
    assignable: value.assignable,
    assignmentCount: value.assignmentCount,
    ...(value.description === undefined
      ? {}
      : { description: value.description }),
    displayName: value.displayName,
    id,
    key: value.key,
    organizationId,
    protected: value.protected,
    rightCount: value.rightCount,
    scopeKind: value.scopeKind,
    systemKind: value.systemKind,
    version: value.version,
  };
}

function assertAssignableRoleKey(key: string): void {
  if (LEGACY_ROLE_NAME_KEYS.has(key) || !/^[a-z][a-z0-9_]{0,127}$/.test(key)) {
    invalid();
  }
}

function capabilitiesMatch(
  actual: AuthorizationCapabilities,
  expected: AuthorizationCapabilities
): boolean {
  return (
    actual.canChangeMemberRole === expected.canChangeMemberRole &&
    actual.canDeleteOrganization === expected.canDeleteOrganization &&
    actual.canInviteMembers === expected.canInviteMembers &&
    actual.canManageOrganizationRoles === expected.canManageOrganizationRoles &&
    actual.canManagePlatformRoles === expected.canManagePlatformRoles &&
    actual.canRemoveMember === expected.canRemoveMember
  );
}

/**
 * Fail-closed wire parser for GET /authorization/snapshot.
 * Browser-safe: rights + capability projection only (no Postgres / Node stores).
 */
export function parseAuthorizationSnapshot(
  value: unknown
): AuthorizationSnapshot {
  if (!isRecord(value)) {
    invalid();
  }
  const capabilities = parseCapabilities(value.capabilities);
  if (!isIntegerAtLeast(value.revision, 1)) {
    invalid();
  }
  if (
    !(
      Array.isArray(value.effectiveRights) &&
      Array.isArray(value.roles) &&
      Array.isArray(value.assignableRoles)
    )
  ) {
    invalid();
  }
  const effectiveRights: AthenaRightKey[] = [];
  for (const entry of value.effectiveRights) {
    if (typeof entry !== "string") {
      invalid();
    }
    const key = tryParseAthenaRightKey(entry);
    if (key === undefined) {
      invalid();
    }
    effectiveRights.push(key);
  }
  if (
    !capabilitiesMatch(capabilities, capabilitiesFromRights(effectiveRights))
  ) {
    invalid();
  }
  const roles: AssignedRoleSummary[] = [];
  const assignedKeys = new Set<string>();
  for (const entry of value.roles) {
    const role = parseAssignedRole(entry);
    const assignedId = `${role.scopeKind}:${role.key}`;
    if (assignedKeys.has(assignedId)) {
      invalid();
    }
    assignedKeys.add(assignedId);
    roles.push(role);
  }
  const assignableRoles: RoleDescriptor[] = [];
  for (const entry of value.assignableRoles) {
    assignableRoles.push(parseRoleDescriptor(entry));
  }
  let activeOrganizationId: string | undefined;
  if (
    value.activeOrganizationId !== undefined &&
    value.activeOrganizationId !== null
  ) {
    const parsed = parseNonEmptyId(value.activeOrganizationId);
    if (parsed === null) {
      invalid();
    }
    activeOrganizationId = parsed;
    for (const role of assignableRoles) {
      if (
        role.scopeKind === "organization" &&
        role.organizationId !== activeOrganizationId
      ) {
        invalid();
      }
    }
  }
  return {
    ...(activeOrganizationId === undefined ? {} : { activeOrganizationId }),
    assignableRoles,
    capabilities,
    effectiveRights,
    revision: value.revision,
    roles,
  };
}
