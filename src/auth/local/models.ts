import type {
  AthenaAuthenticationMethod,
} from "./authentication-context.ts";

export interface AuthUserRow {
  ban_expires: Date | string | null;
  ban_reason: string | null;
  banned: boolean;
  created_at: Date | string;
  display_username: string | null;
  email: string | null;
  email_verified: boolean;
  id: string;
  image: string | null;
  last_sign_in_at: Date | string | null;
  metadata: Record<string, unknown> | string;
  name: string | null;
  role: string | null;
  two_factor_enabled: boolean;
  updated_at: Date | string;
  username: string | null;
}

export interface AuthSessionRow {
  active: boolean;
  active_organization_id: string | null;
  authenticated_at: Date | string;
  authentication_methods: AthenaAuthenticationMethod[] | string;
  created_at: Date | string;
  expires_at: Date | string;
  id: string;
  impersonated_by: string | null;
  ip_address: string | null;
  token: string;
  updated_at: Date | string;
  user_agent: string | null;
  user_id: string;
}

export interface AuthAccountRow {
  access_token: string | null;
  access_token_expires_at: Date | string | null;
  account_id: string;
  created_at: Date | string;
  id: string;
  id_token: string | null;
  password: string | null;
  provider_id: string;
  refresh_token: string | null;
  refresh_token_expires_at: Date | string | null;
  scope: string | null;
  updated_at: Date | string;
  user_id: string;
}

export interface AuthVerificationRow {
  created_at: Date | string;
  expires_at: Date | string;
  id: string;
  identifier: string;
  updated_at: Date | string;
  value: string;
}

export interface AuthOrganizationRow {
  created_at: Date | string;
  created_by_user_id: string | null;
  id: string;
  logo: string | null;
  metadata: Record<string, unknown> | string;
  name: string;
  slug: string;
  updated_at: Date | string;
}

export interface AuthMemberRow {
  created_at: Date | string;
  id: string;
  organization_id: string;
  role: string;
  user_id: string;
}

export interface AuthInvitationRow {
  created_at: Date | string;
  email: string;
  expires_at: Date | string;
  id: string;
  inviter_id: string;
  organization_id: string;
  role: string;
  status: string;
}

export interface AuthPasskeyRow {
  aaguid: string | null;
  backed_up: boolean;
  counter: bigint | string | number;
  created_at: Date | string;
  credential_id: string;
  device_type: string;
  id: string;
  name: string;
  public_key: string;
  resident_key: boolean | null;
  transports: string | null;
  updated_at: Date | string;
  user_id: string;
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function asIsoRequired(value: Date | string): string {
  return asIso(value) ?? new Date().toISOString();
}

export function parseMetadata(
  value: Record<string, unknown> | string | null | undefined
): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value;
}

export function toPublicUser(row: AuthUserRow) {
  return {
    banExpires: asIso(row.ban_expires),
    banned: Boolean(row.banned),
    banReason: row.ban_reason,
    createdAt: asIsoRequired(row.created_at),
    displayUsername: row.display_username,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    id: row.id,
    image: row.image,
    lastSignInAt: asIso(row.last_sign_in_at),
    name: row.name,
    role: row.role,
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    updatedAt: asIsoRequired(row.updated_at),
    username: row.username,
  };
}

export function toPublicSession(row: AuthSessionRow) {
  return {
    activeOrganizationId: row.active_organization_id,
    createdAt: asIsoRequired(row.created_at),
    expiresAt: asIsoRequired(row.expires_at),
    id: row.id,
    impersonatedBy: row.impersonated_by,
    ipAddress: row.ip_address,
    token: row.token,
    updatedAt: asIsoRequired(row.updated_at),
    userAgent: row.user_agent,
    userId: row.user_id,
  };
}

export function toPublicOrganization(row: AuthOrganizationRow) {
  return {
    createdAt: asIsoRequired(row.created_at),
    createdByUserId: row.created_by_user_id,
    id: row.id,
    logo: row.logo,
    metadata: parseMetadata(row.metadata),
    name: row.name,
    slug: row.slug,
    updatedAt: asIsoRequired(row.updated_at),
  };
}

function rowString(row: object, snake: string, camel: string): string {
  const record = row as Record<string, unknown>;
  const snakeValue = record[snake];
  if (typeof snakeValue === "string" && snakeValue.length > 0) {
    return snakeValue;
  }
  const camelValue = record[camel];
  if (typeof camelValue === "string" && camelValue.length > 0) {
    return camelValue;
  }
  return "";
}

function memberUserId(row: AuthMemberRow): string {
  return rowString(row, "user_id", "userId");
}

function memberCreatedAt(row: AuthMemberRow): Date | string {
  return row.created_at;
}

export function toPublicMember(
  row: AuthMemberRow,
  user?: AuthUserRow | null,
  authorization?: {
    canChangeRole: boolean;
    canRemove: boolean;
    denialReasons: {
      changeRole?: string;
      remove?: string;
    };
    roleDisplayName: string;
    roleKey: string;
  }
) {
  const publicUser = user ? toPublicUser(user) : undefined;
  return {
    createdAt: asIsoRequired(memberCreatedAt(row)),
    email: publicUser?.email ?? null,
    id: row.id,
    organizationId: rowString(row, "organization_id", "organizationId"),
    role: row.role,
    user: publicUser,
    userId: memberUserId(row),
    ...(authorization ? { authorization } : {}),
  };
}

export async function toPublicMemberWithUser(
  row: AuthMemberRow,
  getUserById: (id: string) => Promise<AuthUserRow | undefined>
) {
  return toPublicMember(row, await getUserById(memberUserId(row)));
}

export async function toPublicMembersWithUsers(
  members: readonly AuthMemberRow[],
  getUserById: (id: string) => Promise<AuthUserRow | undefined>
) {
  const uniqueIds = [
    ...new Set(members.map((member) => memberUserId(member)).filter(Boolean)),
  ];
  const users = await Promise.all(
    uniqueIds.map(async (id) => {
      const user = await getUserById(id);
      return [id, user] as const;
    })
  );
  const byId = new Map(users);
  return members.map((row) => toPublicMember(row, byId.get(memberUserId(row))));
}

export function toPublicInvitation(row: AuthInvitationRow) {
  return {
    createdAt: asIsoRequired(row.created_at),
    email: row.email,
    expiresAt: asIsoRequired(row.expires_at),
    id: row.id,
    inviterId: row.inviter_id,
    organizationId: row.organization_id,
    role: row.role,
    status: row.status,
  };
}

export function toPublicAccount(row: AuthAccountRow) {
  return {
    accountId: row.account_id,
    createdAt: asIsoRequired(row.created_at),
    id: row.id,
    providerId: row.provider_id,
    userId: row.user_id,
  };
}
