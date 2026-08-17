import { ATHENA_AUTH_TABLES } from "../contract/index.ts";
import type { AthenaAuthDatabase } from "./database.ts";
import type {
  AuthAccountRow,
  AuthInvitationRow,
  AuthMemberRow,
  AuthOrganizationRow,
  AuthSessionRow,
  AuthUserRow,
  AuthVerificationRow,
} from "./models.ts";
import { parseMetadata } from "./models.ts";

export interface CreateUserInput {
  displayUsername?: string;
  email?: string;
  emailVerified?: boolean;
  id: string;
  image?: string;
  metadata?: Record<string, unknown>;
  name?: string;
  username?: string;
}

export interface UpdateUserPatch {
  banned?: boolean;
  banExpires?: Date | null;
  banReason?: string | null;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  lastSignInAt?: Date;
  metadata?: Record<string, unknown>;
  name?: string | null;
  role?: string | null;
  twoFactorEnabled?: boolean;
}

export interface AuthApiKeyRow {
  created_at: Date | string;
  enabled: boolean;
  expires_at: Date | string | null;
  id: string;
  key: string;
  last_request: Date | string | null;
  metadata: string | null;
  name: string | null;
  permissions: string | null;
  prefix: string | null;
  remaining: number | null;
  start: string | null;
  updated_at: Date | string;
  user_id: string;
}

export interface AuthTwoFactorRow {
  backup_codes: string | null;
  created_at: Date | string;
  id: string;
  secret: string;
  updated_at: Date | string;
  user_id: string;
}

export interface CreateSessionInput {
  activeOrganizationId?: string | null;
  expiresAt: Date;
  id: string;
  impersonatedBy?: string | null;
  ipAddress?: string | null;
  token: string;
  userAgent?: string | null;
  userId: string;
}

export class PostgresAuthStores {
  constructor(private readonly db: AthenaAuthDatabase) {}

  async getUserById(id: string): Promise<AuthUserRow | undefined> {
    const result = await this.db.query<AuthUserRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.users} WHERE id = $1`,
      [id]
    );
    return hydrateUser(result.rows[0]);
  }

  async getUserByEmail(email: string): Promise<AuthUserRow | undefined> {
    const result = await this.db.query<AuthUserRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.users} WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    return hydrateUser(result.rows[0]);
  }

  async getUserByUsername(username: string): Promise<AuthUserRow | undefined> {
    const result = await this.db.query<AuthUserRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.users} WHERE username = $1`,
      [username]
    );
    return hydrateUser(result.rows[0]);
  }

  async createUser(input: CreateUserInput): Promise<AuthUserRow> {
    const result = await this.db.query<AuthUserRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.users}
        (id, email, name, image, email_verified, username, display_username, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *`,
      [
        input.id,
        input.email ?? null,
        input.name ?? null,
        input.image ?? null,
        input.emailVerified ?? false,
        input.username ?? null,
        input.displayUsername ?? null,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
    const row = hydrateUser(result.rows[0]);
    if (!row) {
      throw new Error("Failed to create user");
    }
    return row;
  }

  async updateUser(id: string, patch: UpdateUserPatch): Promise<AuthUserRow> {
    const result = await this.db.query<AuthUserRow>(
      `UPDATE ${ATHENA_AUTH_TABLES.users}
       SET
         name = COALESCE($2, name),
         email = COALESCE($3, email),
         email_verified = COALESCE($4, email_verified),
         image = CASE WHEN $5::boolean THEN $6 ELSE image END,
         last_sign_in_at = COALESCE($7, last_sign_in_at),
         metadata = COALESCE($8::jsonb, metadata),
         banned = COALESCE($9, banned),
         two_factor_enabled = COALESCE($10, two_factor_enabled),
         role = CASE WHEN $11::boolean THEN $12 ELSE role END,
         ban_reason = CASE WHEN $13::boolean THEN $14 ELSE ban_reason END,
         ban_expires = CASE WHEN $15::boolean THEN $16 ELSE ban_expires END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.name === undefined ? null : patch.name,
        patch.email ?? null,
        patch.emailVerified ?? null,
        patch.image !== undefined,
        patch.image ?? null,
        patch.lastSignInAt ?? null,
        patch.metadata ? JSON.stringify(patch.metadata) : null,
        patch.banned ?? null,
        patch.twoFactorEnabled ?? null,
        patch.role !== undefined,
        patch.role ?? null,
        patch.banReason !== undefined,
        patch.banReason ?? null,
        patch.banExpires !== undefined,
        patch.banExpires?.toISOString() ?? null,
      ]
    );
    const row = hydrateUser(result.rows[0]);
    if (!row) {
      throw new Error("User not found");
    }
    return row;
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.query(`DELETE FROM ${ATHENA_AUTH_TABLES.users} WHERE id = $1`, [
      id,
    ]);
  }

  async createSession(input: CreateSessionInput): Promise<AuthSessionRow> {
    const result = await this.db.query<AuthSessionRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.sessions}
        (id, user_id, token, expires_at, ip_address, user_agent, impersonated_by, active_organization_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.token,
        input.expiresAt.toISOString(),
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.impersonatedBy ?? null,
        input.activeOrganizationId ?? null,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create session");
    }
    return row;
  }

  async getSessionByToken(token: string): Promise<AuthSessionRow | undefined> {
    const result = await this.db.query<AuthSessionRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.sessions}
       WHERE token = $1 AND active = TRUE AND expires_at > NOW()`,
      [token]
    );
    return result.rows[0];
  }

  async updateSessionExpiry(token: string, expiresAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE ${ATHENA_AUTH_TABLES.sessions}
       SET expires_at = $2, updated_at = NOW()
       WHERE token = $1`,
      [token, expiresAt.toISOString()]
    );
  }

  async setSessionActiveOrganization(
    token: string,
    organizationId: string | null
  ): Promise<void> {
    await this.db.query(
      `UPDATE ${ATHENA_AUTH_TABLES.sessions}
       SET active_organization_id = $2, updated_at = NOW()
       WHERE token = $1`,
      [token, organizationId]
    );
  }

  async listUserSessions(userId: string): Promise<AuthSessionRow[]> {
    const result = await this.db.query<AuthSessionRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.sessions}
       WHERE user_id = $1 AND active = TRUE AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async deleteSession(token: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.sessions} WHERE token = $1`,
      [token]
    );
    return result.rowCount > 0;
  }

  async deleteUserSessions(userId: string, exceptToken?: string): Promise<number> {
    if (exceptToken) {
      const result = await this.db.query(
        `DELETE FROM ${ATHENA_AUTH_TABLES.sessions} WHERE user_id = $1 AND token <> $2`,
        [userId, exceptToken]
      );
      return result.rowCount;
    }
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.sessions} WHERE user_id = $1`,
      [userId]
    );
    return result.rowCount;
  }

  async createAccount(input: {
    accountId: string;
    id: string;
    password?: string;
    providerId: string;
    userId: string;
  }): Promise<AuthAccountRow> {
    const result = await this.db.query<AuthAccountRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.accounts}
        (id, account_id, provider_id, user_id, password)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.id,
        input.accountId,
        input.providerId,
        input.userId,
        input.password ?? null,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create account");
    }
    return row;
  }

  async listAccounts(userId: string): Promise<AuthAccountRow[]> {
    const result = await this.db.query<AuthAccountRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.accounts} WHERE user_id = $1`,
      [userId]
    );
    return result.rows;
  }

  async createVerification(input: {
    expiresAt: Date;
    id: string;
    identifier: string;
    value: string;
  }): Promise<AuthVerificationRow> {
    const result = await this.db.query<AuthVerificationRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.verifications}
        (id, identifier, value, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.id, input.identifier, input.value, input.expiresAt.toISOString()]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create verification");
    }
    return row;
  }

  async consumeVerification(value: string): Promise<AuthVerificationRow | undefined> {
    const result = await this.db.query<AuthVerificationRow>(
      `DELETE FROM ${ATHENA_AUTH_TABLES.verifications}
       WHERE value = $1 AND expires_at > NOW()
       RETURNING *`,
      [value]
    );
    return result.rows[0];
  }

  async createOrganization(input: {
    id: string;
    name: string;
    slug: string;
  }): Promise<AuthOrganizationRow> {
    const result = await this.db.query<AuthOrganizationRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.organization} (id, name, slug)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.id, input.name, input.slug]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create organization");
    }
    return row;
  }

  async getOrganization(id: string): Promise<AuthOrganizationRow | undefined> {
    const result = await this.db.query<AuthOrganizationRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.organization} WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  async getOrganizationBySlug(
    slug: string
  ): Promise<AuthOrganizationRow | undefined> {
    const result = await this.db.query<AuthOrganizationRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.organization} WHERE slug = $1`,
      [slug]
    );
    return result.rows[0];
  }

  async listOrganizationsForUser(userId: string): Promise<AuthOrganizationRow[]> {
    const result = await this.db.query<AuthOrganizationRow>(
      `SELECT o.* FROM ${ATHENA_AUTH_TABLES.organization} o
       INNER JOIN ${ATHENA_AUTH_TABLES.member} m ON m.organization_id = o.id
       WHERE m.user_id = $1
       ORDER BY o.created_at ASC`,
      [userId]
    );
    return result.rows;
  }

  async updateOrganization(
    id: string,
    patch: { logo?: string | null; name?: string; slug?: string }
  ): Promise<AuthOrganizationRow> {
    const result = await this.db.query<AuthOrganizationRow>(
      `UPDATE ${ATHENA_AUTH_TABLES.organization}
       SET
         name = COALESCE($2, name),
         slug = COALESCE($3, slug),
         logo = CASE WHEN $4::boolean THEN $5 ELSE logo END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.name ?? null,
        patch.slug ?? null,
        patch.logo !== undefined,
        patch.logo ?? null,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Organization not found");
    }
    return row;
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.organization} WHERE id = $1`,
      [id]
    );
  }

  async addMember(input: {
    id: string;
    organizationId: string;
    role: string;
    userId: string;
  }): Promise<AuthMemberRow> {
    const result = await this.db.query<AuthMemberRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.member}
        (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.id, input.organizationId, input.userId, input.role]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to add member");
    }
    return row;
  }

  async getMember(
    organizationId: string,
    userId: string
  ): Promise<AuthMemberRow | undefined> {
    const result = await this.db.query<AuthMemberRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.member}
       WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    );
    return result.rows[0];
  }

  async listMembers(organizationId: string): Promise<AuthMemberRow[]> {
    const result = await this.db.query<AuthMemberRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.member}
       WHERE organization_id = $1
       ORDER BY created_at ASC`,
      [organizationId]
    );
    return result.rows;
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: string
  ): Promise<AuthMemberRow | undefined> {
    const result = await this.db.query<AuthMemberRow>(
      `UPDATE ${ATHENA_AUTH_TABLES.member}
       SET role = $3
       WHERE organization_id = $1 AND user_id = $2
       RETURNING *`,
      [organizationId, userId, role]
    );
    return result.rows[0];
  }

  async removeMember(organizationId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.member}
       WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    );
    return result.rowCount > 0;
  }

  async createInvitation(input: {
    email: string;
    expiresAt: Date;
    id: string;
    inviterId: string;
    organizationId: string;
    role: string;
  }): Promise<AuthInvitationRow> {
    const result = await this.db.query<AuthInvitationRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.invitation}
        (id, organization_id, email, role, status, inviter_id, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING *`,
      [
        input.id,
        input.organizationId,
        input.email,
        input.role,
        input.inviterId,
        input.expiresAt.toISOString(),
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create invitation");
    }
    return row;
  }

  async getInvitation(id: string): Promise<AuthInvitationRow | undefined> {
    const result = await this.db.query<AuthInvitationRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.invitation} WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  async listInvitations(organizationId: string): Promise<AuthInvitationRow[]> {
    const result = await this.db.query<AuthInvitationRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.invitation}
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    );
    return result.rows;
  }

  async listInvitationsForEmail(email: string): Promise<AuthInvitationRow[]> {
    const result = await this.db.query<AuthInvitationRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.invitation}
       WHERE lower(email) = lower($1)
       ORDER BY created_at DESC`,
      [email]
    );
    return result.rows;
  }

  async updateInvitationStatus(
    id: string,
    status: string
  ): Promise<AuthInvitationRow | undefined> {
    const result = await this.db.query<AuthInvitationRow>(
      `UPDATE ${ATHENA_AUTH_TABLES.invitation}
       SET status = $2
       WHERE id = $1
       RETURNING *`,
      [id, status]
    );
    return result.rows[0];
  }

  async getVerificationByValue(
    value: string
  ): Promise<AuthVerificationRow | undefined> {
    const result = await this.db.query<AuthVerificationRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.verifications}
       WHERE value = $1 AND expires_at > NOW()`,
      [value]
    );
    return result.rows[0];
  }

  async createTwoFactor(input: {
    backupCodes?: string;
    id: string;
    secret: string;
    userId: string;
  }): Promise<AuthTwoFactorRow> {
    const result = await this.db.query<AuthTwoFactorRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.twoFactor}
        (id, secret, backup_codes, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET secret = EXCLUDED.secret,
             backup_codes = EXCLUDED.backup_codes,
             updated_at = NOW()
       RETURNING *`,
      [input.id, input.secret, input.backupCodes ?? null, input.userId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create two-factor record");
    }
    return row;
  }

  async getTwoFactorByUserId(
    userId: string
  ): Promise<AuthTwoFactorRow | undefined> {
    const result = await this.db.query<AuthTwoFactorRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.twoFactor} WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0];
  }

  async updateTwoFactorBackupCodes(
    userId: string,
    backupCodes: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE ${ATHENA_AUTH_TABLES.twoFactor}
       SET backup_codes = $2, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, backupCodes]
    );
  }

  async deleteTwoFactor(userId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.twoFactor} WHERE user_id = $1`,
      [userId]
    );
  }

  async createApiKey(input: AuthApiKeyRow): Promise<AuthApiKeyRow> {
    const result = await this.db.query<AuthApiKeyRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.apiKeys}
        (id, name, start, prefix, key, user_id, enabled, remaining, expires_at, permissions, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.id,
        input.name,
        input.start,
        input.prefix,
        input.key,
        input.user_id,
        input.enabled,
        input.remaining,
        input.expires_at,
        input.permissions,
        input.metadata,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create API key");
    }
    return row;
  }

  async getApiKeyByHash(hash: string): Promise<AuthApiKeyRow | undefined> {
    const result = await this.db.query<AuthApiKeyRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.apiKeys} WHERE key = $1`,
      [hash]
    );
    return result.rows[0];
  }

  async getApiKeyById(id: string): Promise<AuthApiKeyRow | undefined> {
    const result = await this.db.query<AuthApiKeyRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.apiKeys} WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  async listApiKeys(userId: string): Promise<AuthApiKeyRow[]> {
    const result = await this.db.query<AuthApiKeyRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.apiKeys}
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async deleteApiKey(id: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.apiKeys} WHERE id = $1`,
      [id]
    );
    return result.rowCount > 0;
  }

  async deleteExpiredApiKeys(): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.apiKeys}
       WHERE expires_at IS NOT NULL AND expires_at <= NOW()`
    );
    return result.rowCount;
  }

  async touchApiKey(id: string): Promise<void> {
    await this.db.query(
      `UPDATE ${ATHENA_AUTH_TABLES.apiKeys}
       SET last_request = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  async updateApiKey(
    id: string,
    patch: {
      enabled?: boolean;
      metadata?: string | null;
      name?: string | null;
      permissions?: string | null;
    }
  ): Promise<AuthApiKeyRow | undefined> {
    const result = await this.db.query<AuthApiKeyRow>(
      `UPDATE ${ATHENA_AUTH_TABLES.apiKeys}
       SET
         enabled = COALESCE($2, enabled),
         metadata = COALESCE($3, metadata),
         name = COALESCE($4, name),
         permissions = COALESCE($5, permissions),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
       id,
       patch.enabled ?? null,
       patch.metadata ?? null,
       patch.name ?? null,
       patch.permissions ?? null,
      ]
    );
    return result.rows[0];
  }
}

function hydrateUser(row: AuthUserRow | undefined): AuthUserRow | undefined {
  if (!row) {
    return undefined;
  }
  return {
    ...row,
    metadata: parseMetadata(row.metadata),
  };
}
