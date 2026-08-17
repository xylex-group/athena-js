import type {
  AuthAccountRow,
  AuthInvitationRow,
  AuthMemberRow,
  AuthOrganizationRow,
  AuthSessionRow,
  AuthUserRow,
  AuthVerificationRow,
} from "./models.ts";
import type {
  AuthApiKeyRow,
  AuthTwoFactorRow,
  CreateSessionInput,
  CreateUserInput,
  UpdateUserPatch,
} from "./stores.ts";

function now(): Date {
  return new Date();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryAuthStores {
  readonly accounts = new Map<string, AuthAccountRow>();
  readonly invitations = new Map<string, AuthInvitationRow>();
  readonly members = new Map<string, AuthMemberRow>();
  readonly organizations = new Map<string, AuthOrganizationRow>();
  readonly sessions = new Map<string, AuthSessionRow>();
  readonly users = new Map<string, AuthUserRow>();
  readonly verifications = new Map<string, AuthVerificationRow>();
  readonly apiKeys = new Map<string, AuthApiKeyRow>();
  readonly twoFactors = new Map<string, AuthTwoFactorRow>();

  async getUserById(id: string): Promise<AuthUserRow | undefined> {
    const row = this.users.get(id);
    return row ? clone(row) : undefined;
  }

  async getUserByEmail(email: string): Promise<AuthUserRow | undefined> {
    const needle = email.trim().toLowerCase();
    for (const user of this.users.values()) {
      if ((user.email ?? "").trim().toLowerCase() === needle) {
        return clone(user);
      }
    }
    return undefined;
  }

  async getUserByUsername(username: string): Promise<AuthUserRow | undefined> {
    for (const user of this.users.values()) {
      if (user.username === username) {
        return clone(user);
      }
    }
    return undefined;
  }

  async createUser(input: CreateUserInput): Promise<AuthUserRow> {
    if (input.email && (await this.getUserByEmail(input.email))) {
      const error = new Error("duplicate key value violates unique constraint");
      (error as { code?: string }).code = "23505";
      throw error;
    }
    const created = now();
    const row: AuthUserRow = {
      ban_expires: null,
      ban_reason: null,
      banned: false,
      created_at: created,
      display_username: input.displayUsername ?? null,
      email: input.email ?? null,
      email_verified: input.emailVerified ?? false,
      id: input.id,
      image: input.image ?? null,
      last_sign_in_at: null,
      metadata: input.metadata ?? {},
      name: input.name ?? null,
      role: null,
      two_factor_enabled: false,
      updated_at: created,
      username: input.username ?? null,
    };
    this.users.set(row.id, row);
    return clone(row);
  }

  async updateUser(id: string, patch: UpdateUserPatch): Promise<AuthUserRow> {
    const existing = this.users.get(id);
    if (!existing) {
      throw new Error("User not found");
    }
    const next: AuthUserRow = {
      ...existing,
      ban_expires:
        patch.banExpires !== undefined ? patch.banExpires : existing.ban_expires,
      ban_reason:
        patch.banReason !== undefined ? patch.banReason : existing.ban_reason,
      banned: patch.banned ?? existing.banned,
      email: patch.email ?? existing.email,
      email_verified: patch.emailVerified ?? existing.email_verified,
      image: patch.image !== undefined ? patch.image : existing.image,
      last_sign_in_at: patch.lastSignInAt ?? existing.last_sign_in_at,
      metadata: patch.metadata ?? existing.metadata,
      name: patch.name !== undefined ? patch.name : existing.name,
      role: patch.role !== undefined ? patch.role : existing.role,
      two_factor_enabled: patch.twoFactorEnabled ?? existing.two_factor_enabled,
      updated_at: now(),
    };
    this.users.set(id, next);
    return clone(next);
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
    for (const [key, session] of this.sessions) {
      if (session.user_id === id) {
        this.sessions.delete(key);
      }
    }
    for (const [key, account] of this.accounts) {
      if (account.user_id === id) {
        this.accounts.delete(key);
      }
    }
    for (const [key, member] of this.members) {
      if (member.user_id === id) {
        this.members.delete(key);
      }
    }
    this.twoFactors.delete(id);
    for (const [key, apiKey] of this.apiKeys) {
      if (apiKey.user_id === id) {
        this.apiKeys.delete(key);
      }
    }
  }

  async createSession(input: CreateSessionInput): Promise<AuthSessionRow> {
    const created = now();
    const row: AuthSessionRow = {
      active: true,
      active_organization_id: input.activeOrganizationId ?? null,
      created_at: created,
      expires_at: input.expiresAt,
      id: input.id,
      impersonated_by: input.impersonatedBy ?? null,
      ip_address: input.ipAddress ?? null,
      token: input.token,
      updated_at: created,
      user_agent: input.userAgent ?? null,
      user_id: input.userId,
    };
    this.sessions.set(row.token, row);
    return clone(row);
  }

  async getSessionByToken(token: string): Promise<AuthSessionRow | undefined> {
    const row = this.sessions.get(token);
    if (!row || !row.active || new Date(row.expires_at).getTime() <= Date.now()) {
      return undefined;
    }
    return clone(row);
  }

  async updateSessionExpiry(token: string, expiresAt: Date): Promise<void> {
    const row = this.sessions.get(token);
    if (!row) {
      return;
    }
    row.expires_at = expiresAt;
    row.updated_at = now();
  }

  async setSessionActiveOrganization(
    token: string,
    organizationId: string | null
  ): Promise<void> {
    const row = this.sessions.get(token);
    if (!row) {
      return;
    }
    row.active_organization_id = organizationId;
    row.updated_at = now();
  }

  async listUserSessions(userId: string): Promise<AuthSessionRow[]> {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.user_id === userId &&
          session.active &&
          new Date(session.expires_at).getTime() > Date.now()
      )
      .map((session) => clone(session));
  }

  async deleteSession(token: string): Promise<boolean> {
    return this.sessions.delete(token);
  }

  async deleteUserSessions(userId: string, exceptToken?: string): Promise<number> {
    let count = 0;
    for (const [token, session] of this.sessions) {
      if (session.user_id === userId && token !== exceptToken) {
        this.sessions.delete(token);
        count += 1;
      }
    }
    return count;
  }

  async createAccount(input: {
    accountId: string;
    id: string;
    password?: string;
    providerId: string;
    userId: string;
  }): Promise<AuthAccountRow> {
    const created = now();
    const row: AuthAccountRow = {
      access_token: null,
      access_token_expires_at: null,
      account_id: input.accountId,
      created_at: created,
      id: input.id,
      id_token: null,
      password: input.password ?? null,
      provider_id: input.providerId,
      refresh_token: null,
      refresh_token_expires_at: null,
      scope: null,
      updated_at: created,
      user_id: input.userId,
    };
    this.accounts.set(row.id, row);
    return clone(row);
  }

  async listAccounts(userId: string): Promise<AuthAccountRow[]> {
    return [...this.accounts.values()]
      .filter((account) => account.user_id === userId)
      .map((account) => clone(account));
  }

  async createVerification(input: {
    expiresAt: Date;
    id: string;
    identifier: string;
    value: string;
  }): Promise<AuthVerificationRow> {
    const created = now();
    const row: AuthVerificationRow = {
      created_at: created,
      expires_at: input.expiresAt,
      id: input.id,
      identifier: input.identifier,
      updated_at: created,
      value: input.value,
    };
    this.verifications.set(row.value, row);
    return clone(row);
  }

  async consumeVerification(value: string): Promise<AuthVerificationRow | undefined> {
    const row = this.verifications.get(value);
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      this.verifications.delete(value);
      return undefined;
    }
    this.verifications.delete(value);
    return clone(row);
  }

  async createOrganization(input: {
    id: string;
    name: string;
    slug: string;
  }): Promise<AuthOrganizationRow> {
    if (await this.getOrganizationBySlug(input.slug)) {
      const error = new Error("duplicate key value violates unique constraint");
      (error as { code?: string }).code = "23505";
      throw error;
    }
    const created = now();
    const row: AuthOrganizationRow = {
      created_at: created,
      id: input.id,
      logo: null,
      metadata: {},
      name: input.name,
      slug: input.slug,
      updated_at: created,
    };
    this.organizations.set(row.id, row);
    return clone(row);
  }

  async getOrganization(id: string): Promise<AuthOrganizationRow | undefined> {
    const row = this.organizations.get(id);
    return row ? clone(row) : undefined;
  }

  async getOrganizationBySlug(
    slug: string
  ): Promise<AuthOrganizationRow | undefined> {
    for (const organization of this.organizations.values()) {
      if (organization.slug === slug) {
        return clone(organization);
      }
    }
    return undefined;
  }

  async listOrganizationsForUser(userId: string): Promise<AuthOrganizationRow[]> {
    const orgIds = [...this.members.values()]
      .filter((member) => member.user_id === userId)
      .map((member) => member.organization_id);
    return orgIds
      .map((id) => this.organizations.get(id))
      .filter((row): row is AuthOrganizationRow => Boolean(row))
      .map((row) => clone(row));
  }

  async updateOrganization(
    id: string,
    patch: { logo?: string | null; name?: string; slug?: string }
  ): Promise<AuthOrganizationRow> {
    const existing = this.organizations.get(id);
    if (!existing) {
      throw new Error("Organization not found");
    }
    const next: AuthOrganizationRow = {
      ...existing,
      logo: patch.logo !== undefined ? patch.logo : existing.logo,
      name: patch.name ?? existing.name,
      slug: patch.slug ?? existing.slug,
      updated_at: now(),
    };
    this.organizations.set(id, next);
    return clone(next);
  }

  async deleteOrganization(id: string): Promise<void> {
    this.organizations.delete(id);
    for (const [key, member] of this.members) {
      if (member.organization_id === id) {
        this.members.delete(key);
      }
    }
    for (const [key, invitation] of this.invitations) {
      if (invitation.organization_id === id) {
        this.invitations.delete(key);
      }
    }
  }

  async addMember(input: {
    id: string;
    organizationId: string;
    role: string;
    userId: string;
  }): Promise<AuthMemberRow> {
    const created = now();
    const row: AuthMemberRow = {
      created_at: created,
      id: input.id,
      organization_id: input.organizationId,
      role: input.role,
      user_id: input.userId,
    };
    this.members.set(row.id, row);
    return clone(row);
  }

  async getMember(
    organizationId: string,
    userId: string
  ): Promise<AuthMemberRow | undefined> {
    for (const member of this.members.values()) {
      if (member.organization_id === organizationId && member.user_id === userId) {
        return clone(member);
      }
    }
    return undefined;
  }

  async listMembers(organizationId: string): Promise<AuthMemberRow[]> {
    return [...this.members.values()]
      .filter((member) => member.organization_id === organizationId)
      .map((member) => clone(member));
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: string
  ): Promise<AuthMemberRow | undefined> {
    for (const member of this.members.values()) {
      if (member.organization_id === organizationId && member.user_id === userId) {
        member.role = role;
        return clone(member);
      }
    }
    return undefined;
  }

  async removeMember(organizationId: string, userId: string): Promise<boolean> {
    for (const [key, member] of this.members) {
      if (member.organization_id === organizationId && member.user_id === userId) {
        this.members.delete(key);
        return true;
      }
    }
    return false;
  }

  async createInvitation(input: {
    email: string;
    expiresAt: Date;
    id: string;
    inviterId: string;
    organizationId: string;
    role: string;
  }): Promise<AuthInvitationRow> {
    const created = now();
    const row: AuthInvitationRow = {
      created_at: created,
      email: input.email,
      expires_at: input.expiresAt,
      id: input.id,
      inviter_id: input.inviterId,
      organization_id: input.organizationId,
      role: input.role,
      status: "pending",
    };
    this.invitations.set(row.id, row);
    return clone(row);
  }

  async getInvitation(id: string): Promise<AuthInvitationRow | undefined> {
    const row = this.invitations.get(id);
    return row ? clone(row) : undefined;
  }

  async listInvitations(organizationId: string): Promise<AuthInvitationRow[]> {
    return [...this.invitations.values()]
      .filter((invitation) => invitation.organization_id === organizationId)
      .map((invitation) => clone(invitation));
  }

  async listInvitationsForEmail(email: string): Promise<AuthInvitationRow[]> {
    const needle = email.toLowerCase();
    return [...this.invitations.values()]
      .filter((invitation) => invitation.email?.toLowerCase() === needle)
      .map((invitation) => clone(invitation));
  }

  async updateInvitationStatus(
    id: string,
    status: string
  ): Promise<AuthInvitationRow | undefined> {
    const row = this.invitations.get(id);
    if (!row) {
      return undefined;
    }
    row.status = status;
    return clone(row);
  }

  async getVerificationByValue(
    value: string
  ): Promise<AuthVerificationRow | undefined> {
    const row = this.verifications.get(value);
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      return undefined;
    }
    return clone(row);
  }

  async createTwoFactor(input: {
    backupCodes?: string;
    id: string;
    secret: string;
    userId: string;
  }): Promise<AuthTwoFactorRow> {
    const created = now();
    const row: AuthTwoFactorRow = {
      backup_codes: input.backupCodes ?? null,
      created_at: created,
      id: input.id,
      secret: input.secret,
      updated_at: created,
      user_id: input.userId,
    };
    this.twoFactors.set(input.userId, row);
    return clone(row);
  }

  async getTwoFactorByUserId(
    userId: string
  ): Promise<AuthTwoFactorRow | undefined> {
    const row = this.twoFactors.get(userId);
    return row ? clone(row) : undefined;
  }

  async updateTwoFactorBackupCodes(
    userId: string,
    backupCodes: string
  ): Promise<void> {
    const row = this.twoFactors.get(userId);
    if (row) {
      row.backup_codes = backupCodes;
      row.updated_at = now();
    }
  }

  async deleteTwoFactor(userId: string): Promise<void> {
    this.twoFactors.delete(userId);
  }

  async createApiKey(input: AuthApiKeyRow): Promise<AuthApiKeyRow> {
    this.apiKeys.set(input.id, { ...input });
    return clone(input);
  }

  async getApiKeyByHash(hash: string): Promise<AuthApiKeyRow | undefined> {
    for (const key of this.apiKeys.values()) {
      if (key.key === hash) {
        return clone(key);
      }
    }
    return undefined;
  }

  async getApiKeyById(id: string): Promise<AuthApiKeyRow | undefined> {
    const row = this.apiKeys.get(id);
    return row ? clone(row) : undefined;
  }

  async listApiKeys(userId: string): Promise<AuthApiKeyRow[]> {
    return [...this.apiKeys.values()]
      .filter((key) => key.user_id === userId)
      .map((key) => clone(key));
  }

  async deleteApiKey(id: string): Promise<boolean> {
    return this.apiKeys.delete(id);
  }

  async deleteExpiredApiKeys(): Promise<number> {
    let count = 0;
    const nowMs = Date.now();
    for (const [id, key] of this.apiKeys) {
      if (key.expires_at && new Date(key.expires_at).getTime() <= nowMs) {
        this.apiKeys.delete(id);
        count += 1;
      }
    }
    return count;
  }

  async touchApiKey(id: string): Promise<void> {
    const row = this.apiKeys.get(id);
    if (row) {
      row.last_request = now();
      row.updated_at = now();
    }
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
    const row = this.apiKeys.get(id);
    if (!row) {
      return undefined;
    }
    if (patch.enabled !== undefined) {
      row.enabled = patch.enabled;
    }
    if (patch.metadata !== undefined) {
      row.metadata = patch.metadata;
    }
    if (patch.name !== undefined) {
      row.name = patch.name;
    }
    if (patch.permissions !== undefined) {
      row.permissions = patch.permissions;
    }
    row.updated_at = now();
    return clone(row);
  }
}

export type AthenaAuthStores = MemoryAuthStores | import("./stores.ts").PostgresAuthStores;
