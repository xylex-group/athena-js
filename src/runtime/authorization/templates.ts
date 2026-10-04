import type { AthenaRightKey } from "../../rights/key.ts";
import { ATHENA_BUILTIN_ROLE_DEFINITIONS } from "../../roles/builtin.ts";
import type { AthenaAuthorizationRoleRecord } from "./types.ts";

export const PLATFORM_ADMIN_ROLE = "platform_admin";
export const PLATFORM_BILLING_ADMIN_ROLE = "billing_admin";
export const PLATFORM_CUSTOMER_ROLE = "platform_customer";
export const PLATFORM_UNAUTHORIZED_ROLE = "platform_unauthorized";
export const LEGACY_PLATFORM_ROLE_KEYS: readonly string[] = Object.freeze([
  PLATFORM_ADMIN_ROLE,
  PLATFORM_CUSTOMER_ROLE,
  PLATFORM_UNAUTHORIZED_ROLE,
]);
export const ORGANIZATION_OWNER_ROLE = "organization_owner";
export const ORGANIZATION_ADMIN_ROLE = "organization_admin";
export const ORGANIZATION_MEMBER_ROLE = "organization_member";

/** Legacy persistence template projection of the canonical Roles IR built-ins. */
export type BuiltInAuthorizationRoleTemplate = {
  assignable: boolean;
  description: string;
  id: string;
  key: string;
  name: string;
  protected: boolean;
  rights: readonly AthenaRightKey[];
  scopeKind: "platform" | "organization";
  systemKind: "owner" | "admin" | "member" | null;
};

/** Compatibility projection for existing authorization persistence callers. */
export const BUILTIN_AUTHORIZATION_ROLES: readonly BuiltInAuthorizationRoleTemplate[] =
  Object.freeze(
    ATHENA_BUILTIN_ROLE_DEFINITIONS.map(
      (role): BuiltInAuthorizationRoleTemplate => ({
        assignable: role.assignable,
        description: role.description ?? role.displayName,
        id: role.id,
        key: role.key,
        name: role.displayName,
        protected: role.protected,
        rights: role.rights,
        scopeKind: role.scope.kind === "platform" ? "platform" : "organization",
        systemKind: role.systemKind,
      })
    )
  );

export function mapLegacyUserRole(role: string | null | undefined): string {
  const trimmed = role?.trim() ?? "";
  if (trimmed === "admin") {
    return PLATFORM_ADMIN_ROLE;
  }
  if (trimmed === "unauthorized") {
    return PLATFORM_UNAUTHORIZED_ROLE;
  }
  if (trimmed === "" || trimmed === "customer") {
    return PLATFORM_CUSTOMER_ROLE;
  }
  return PLATFORM_UNAUTHORIZED_ROLE;
}

export function mapLegacyMemberRole(role: string | null | undefined): string {
  const trimmed = role?.trim().toLowerCase() ?? "member";
  if (trimmed === "owner") {
    return ORGANIZATION_OWNER_ROLE;
  }
  if (trimmed === "admin") {
    return ORGANIZATION_ADMIN_ROLE;
  }
  if (trimmed === "member") {
    return ORGANIZATION_MEMBER_ROLE;
  }
  return ORGANIZATION_MEMBER_ROLE;
}

export function resolveMemberAssignmentRole(
  role: string | null | undefined
): string {
  const trimmed = role?.trim() ?? "member";
  const lower = trimmed.toLowerCase();
  if (lower === "owner" || lower === ORGANIZATION_OWNER_ROLE) {
    return ORGANIZATION_OWNER_ROLE;
  }
  if (lower === "admin" || lower === ORGANIZATION_ADMIN_ROLE) {
    return ORGANIZATION_ADMIN_ROLE;
  }
  if (lower === "member" || lower === ORGANIZATION_MEMBER_ROLE) {
    return ORGANIZATION_MEMBER_ROLE;
  }
  return trimmed;
}

export function persistedMemberRole(
  role: Pick<AthenaAuthorizationRoleRecord, "key" | "systemKind">
): string {
  if (role.systemKind === "owner") {
    return "owner";
  }
  if (role.systemKind === "admin") {
    return "admin";
  }
  if (role.systemKind === "member") {
    return "member";
  }
  return role.key;
}

export function grantRankRole(
  role: Pick<AthenaAuthorizationRoleRecord, "key" | "systemKind">
): string {
  if (role.systemKind === "owner" || role.key === ORGANIZATION_OWNER_ROLE) {
    return "owner";
  }
  if (role.systemKind === "admin" || role.key === ORGANIZATION_ADMIN_ROLE) {
    return "admin";
  }
  if (role.systemKind === "member" || role.key === ORGANIZATION_MEMBER_ROLE) {
    return "member";
  }
  return "admin";
}

export function builtinRoleRecord(
  template: BuiltInAuthorizationRoleTemplate
): AthenaAuthorizationRoleRecord {
  return {
    assignable: template.assignable,
    id: template.id,
    key: template.key,
    name: template.name,
    organizationId: null,
    protected: template.protected,
    scopeKind: template.scopeKind,
    systemKind: template.systemKind,
    version: 1,
  };
}

export function compatibilityMemberRole(roleKey: string): string {
  if (roleKey === ORGANIZATION_OWNER_ROLE) {
    return "owner";
  }
  if (roleKey === ORGANIZATION_ADMIN_ROLE) {
    return "admin";
  }
  return "member";
}

export function compatibilityUserRole(roleKey: string): string | null {
  if (roleKey === PLATFORM_ADMIN_ROLE) {
    return "admin";
  }
  if (roleKey === PLATFORM_UNAUTHORIZED_ROLE) {
    return "unauthorized";
  }
  if (roleKey === PLATFORM_CUSTOMER_ROLE) {
    return "customer";
  }
  return null;
}
