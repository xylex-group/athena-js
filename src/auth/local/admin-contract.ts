import type { AuthSessionRow, AuthUserRow } from "./models.ts";

export const ATHENA_AUTH_ADMIN_PATHS = {
  banUser: "/admin/ban-user",
  createUser: "/admin/create-user",
  getUser: "/admin/get-user",
  impersonateUser: "/admin/impersonate-user",
  listUsers: "/admin/list-users",
  removeUser: "/admin/remove-user",
  revokeUserSessions: "/admin/revoke-user-sessions",
  setRole: "/admin/set-role",
  stopImpersonating: "/admin/stop-impersonating",
  unbanUser: "/admin/unban-user",
  updateUser: "/admin/update-user",
} as const;

export type AthenaAuthAdminPath =
  (typeof ATHENA_AUTH_ADMIN_PATHS)[keyof typeof ATHENA_AUTH_ADMIN_PATHS];

export interface AthenaAuthAdminListUsersInput {
  limit?: number;
  offset?: number;
  query?: string;
  role?: string;
  banned?: boolean;
}

export interface AthenaAuthAdminListUsersResult {
  limit: number;
  offset: number;
  total: number;
  users: AuthUserRow[];
}

export interface AthenaAuthAdminCreateUserInput {
  email: string;
  emailVerified?: boolean;
  name?: string;
  password?: string;
  role?: string;
  username?: string;
}

export interface AthenaAuthAdminUpdateUserInput {
  banned?: boolean;
  banExpires?: Date | null;
  banReason?: string | null;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  name?: string | null;
  role?: string | null;
  userId: string;
}

export interface AthenaAuthAdminStore {
  createUser(input: AthenaAuthAdminCreateUserInput & {
    id: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuthUserRow>;
  deleteSession(token: string): Promise<boolean>;
  deleteUser(userId: string): Promise<boolean>;
  deleteUserSessions(userId: string, exceptToken?: string): Promise<number>;
  getUser(userId: string): Promise<AuthUserRow | undefined>;
  getUserByEmail(email: string): Promise<AuthUserRow | undefined>;
  listUsers(input: AthenaAuthAdminListUsersInput): Promise<AthenaAuthAdminListUsersResult>;
  updateUser(input: AthenaAuthAdminUpdateUserInput): Promise<AuthUserRow>;
  createImpersonationSession(input: {
    activeOrganizationId?: string | null;
    expiresAt: Date;
    id: string;
    impersonatedBy: string;
    ipAddress?: string | null;
    token: string;
    userAgent?: string | null;
    userId: string;
  }): Promise<AuthSessionRow>;
}

export const ATHENA_AUTH_ADMIN_ROLES = ["user", "admin", "superadmin", "owner"] as const;

export type AthenaAuthAdminRole = (typeof ATHENA_AUTH_ADMIN_ROLES)[number];

const ADMIN_ROLE_RANK: Record<AthenaAuthAdminRole, number> = {
  user: 0,
  admin: 1,
  superadmin: 2,
  owner: 3,
};

export function normalizeAdminRole(
  role: string | null | undefined
): string | null {
  if (typeof role !== "string") {
    return null;
  }
  const trimmed = role.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  return ATHENA_AUTH_ADMIN_ROLES.includes(lower as AthenaAuthAdminRole)
    ? lower
    : trimmed;
}

export function isAthenaAdminRole(role: string | null | undefined): boolean {
  const normalized = normalizeAdminRole(role);
  return (
    normalized === "admin" ||
    normalized === "superadmin" ||
    normalized === "owner"
  );
}

export function adminRoleRank(role: string | null | undefined): number {
  const normalized = normalizeAdminRole(role);
  if (
    normalized &&
    ATHENA_AUTH_ADMIN_ROLES.includes(normalized as AthenaAuthAdminRole)
  ) {
    return ADMIN_ROLE_RANK[normalized as AthenaAuthAdminRole];
  }
  return ADMIN_ROLE_RANK.user;
}

/**
 * Administrative control-plane roles are ranked.
 * Unknown strings are application custom roles and may be assigned by any admin.
 */
export function canAssignRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
): boolean {
  if (!isAthenaAdminRole(actorRole)) {
    return false;
  }
  const assigned = normalizeAdminRole(targetRole);
  if (!assigned) {
    return false;
  }
  if (!ATHENA_AUTH_ADMIN_ROLES.includes(assigned as AthenaAuthAdminRole)) {
    return true;
  }
  return adminRoleRank(actorRole) > adminRoleRank(assigned);
}

export function canActOnAdminTarget(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
): boolean {
  if (!isAthenaAdminRole(targetRole)) {
    return isAthenaAdminRole(actorRole);
  }
  return adminRoleRank(actorRole) > adminRoleRank(targetRole);
}

export function isUserEffectivelyBanned(
  user: { banned?: boolean | null; ban_expires?: Date | string | null },
  now = new Date()
): boolean {
  if (!user.banned) {
    return false;
  }
  if (!user.ban_expires) {
    return true;
  }
  const expires = new Date(user.ban_expires);
  if (Number.isNaN(expires.getTime())) {
    return true;
  }
  return expires.getTime() > now.getTime();
}

const PUBLIC_ADMIN_SECRET_KEYS = [
  "password",
  "password_hash",
  "passwordHash",
  "metadata",
  "secret",
  "totp",
  "recovery",
  "refreshToken",
  "refresh_token",
  "accessToken",
  "access_token",
  "apiKey",
  "api_key",
];

export function assertPublicAdminUserSafe(
  value: unknown,
  label = "admin user"
): void {
  const serialized = JSON.stringify(value);
  if (!serialized) {
    throw new Error(`${label}: empty payload`);
  }
  if (serialized.includes("$argon2")) {
    throw new Error(`${label}: leaked password hash`);
  }
  for (const key of PUBLIC_ADMIN_SECRET_KEYS) {
    if (new RegExp(`"${key}"\\s*:`).test(serialized)) {
      throw new Error(`${label}: leaked secret field ${key}`);
    }
  }
}

export function clampAdminListLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 50;
  }
  return Math.min(100, Math.max(1, Math.trunc(limit ?? 50)));
}

export function clampAdminListOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.trunc(offset ?? 0));
}
